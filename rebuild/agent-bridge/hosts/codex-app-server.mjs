import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {createHash, randomBytes, randomUUID} from 'node:crypto';

// Public app-server v2, checked against installed 0.164.0 experimental schemas.
// Explicit event subscription joins an already-loaded thread with no settings
// overrides. No desktop IPC, process launch, approval response, or reconnect.
const MAX_FRAME=16*1024*1024,MAX_RESULT=1024*1024,MAX_LIVE_COMMAND_ITEMS=1000;
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const id=v=>typeof v==='string'&&v.length>0&&v.length<=256;
const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(v);
const digest=v=>createHash('sha256').update(v).digest('hex');
const terminal=new Set(['completed','failed','interrupted']);
const turnStates=new Set(['inProgress',...terminal]);
const processId=v=>typeof v==='string'&&/^[0-9]{1,10}$/.test(v)&&Number(v)>0&&Number(v)<=2147483647;
// expiresAt gates initial admission only. Native queue/add has no expiry field;
// accepted work may execute later, and this adapter does not delete queued work.
const capabilities=Object.freeze({atomic_idle_start:false,atomic_queue_append:true,atomic_queued_resume:true,native_queue_expiry:false,exact_turn_interrupt:true,exact_turn_child_stop:true,final_result_evidence:true});

export class CodexAppServerError extends Error {
  constructor(code,{outcomeUnknown=false,nativeCode,nativeReason,threadId,nativeMethod}={}) {
    super(code);this.code=code;this.outcomeUnknown=outcomeUnknown;
    if(Number.isInteger(nativeCode))this.nativeCode=nativeCode;
    if(nativeReason==='thread_not_materialized'&&uuid(threadId)){this.nativeReason=nativeReason;this.threadId=threadId;}
    if(nativeReason==='method_not_supported'&&['thread/items/list','thread/turns/list'].includes(nativeMethod)){this.nativeReason=nativeReason;this.nativeMethod=nativeMethod;}
  }
}
const need=(value,code,options)=>{if(!value)throw new CodexAppServerError(code,options);};

function endpointOptions(endpoint,bearerToken) {
  need(typeof endpoint==='string','CODEX_APP_SERVER_ENDPOINT_INVALID');
  let url;try{url=new URL(endpoint);}catch{throw new CodexAppServerError('CODEX_APP_SERVER_ENDPOINT_INVALID');}
  need(!url.username&&!url.password&&!url.hash&&!url.search,'CODEX_APP_SERVER_ENDPOINT_INVALID');
  if(url.protocol==='unix:'){
    need(!url.hostname&&path.isAbsolute(url.pathname)&&url.pathname!=='/','CODEX_APP_SERVER_ENDPOINT_INVALID');
    let socketPath;try{socketPath=decodeURIComponent(url.pathname);}catch{throw new CodexAppServerError('CODEX_APP_SERVER_ENDPOINT_INVALID');}
    try{
      const parent=fs.lstatSync(path.dirname(socketPath)),socket=fs.lstatSync(socketPath),uid=process.getuid?.();
      // The private directory prevents other users reaching the socket even
      // when the native server creates the socket with its ordinary umask.
      need(uid!==undefined&&parent.isDirectory()&&!parent.isSymbolicLink()&&parent.uid===uid&&!(parent.mode&0o077)&&socket.isSocket()&&socket.uid===uid,'CODEX_APP_SERVER_SOCKET_UNTRUSTED');
    }catch(error){if(error instanceof CodexAppServerError)throw error;throw new CodexAppServerError('CODEX_APP_SERVER_UNAVAILABLE');}
    need(bearerToken===undefined,'CODEX_APP_SERVER_ENDPOINT_INVALID');
    return{socketPath,path:'/',host:'localhost'};
  }
  need(url.protocol==='ws:'&&['127.0.0.1','[::1]'].includes(url.hostname)&&url.port,'CODEX_APP_SERVER_ENDPOINT_INVALID');
  need(bearerToken===undefined||(typeof bearerToken==='string'&&bearerToken.length>0&&bearerToken.length<=8192&&!/[\r\n]/.test(bearerToken)),'CODEX_APP_SERVER_AUTH_INVALID');
  return{hostname:url.hostname.replace(/^\[|\]$/g,''),port:Number(url.port),path:url.pathname||'/',...(bearerToken?{authHeader:`Bearer ${bearerToken}`}:{})};
}

/** A bounded RFC6455 client for local official app-server endpoints. The
 * native Node WebSocket API cannot connect to Unix-domain sockets. */
export class CodexAppServerChannel {
  #socket;#http;#pending=new Map();#listeners=new Set();#buffer=Buffer.alloc(0);#parts=[];#partBytes=0;#closed=false;#connected=false;#options;#diagnostic;
  constructor(endpoint,{timeoutMs=5000,bearerToken,onDiagnostic}={}){
    need(Number.isSafeInteger(timeoutMs)&&timeoutMs>=50&&timeoutMs<=60000,'CODEX_APP_SERVER_TIMEOUT_INVALID');
    need(onDiagnostic===undefined||typeof onDiagnostic==='function','CODEX_APP_SERVER_DIAGNOSTIC_INVALID');
    this.endpoint=endpoint;this.timeoutMs=timeoutMs;this.#options=endpointOptions(endpoint,bearerToken);this.#diagnostic=onDiagnostic;
  }
  async connect(){
    need(!this.#http&&!this.#closed,'CODEX_APP_SERVER_ALREADY_CONNECTED');
    const key=randomBytes(16).toString('base64');
    try{
      await new Promise((resolve,reject)=>{
        const{authHeader,...options}=this.#options;
        const request=this.#http=http.request({...options,method:'GET',headers:{Upgrade:'websocket',Connection:'Upgrade','Sec-WebSocket-Version':'13','Sec-WebSocket-Key':key,...(authHeader?{Authorization:authHeader}:{})}});
        let settled=false;
        const finish=error=>{if(settled)return;settled=true;clearTimeout(timer);error?reject(error):resolve();};
        const timer=setTimeout(()=>{request.destroy();finish(new CodexAppServerError('CODEX_APP_SERVER_CONNECT_TIMEOUT'));},this.timeoutMs);
        request.on('error',()=>finish(new CodexAppServerError('CODEX_APP_SERVER_UNAVAILABLE')));
        request.on('response',response=>{response.resume();finish(new CodexAppServerError('CODEX_APP_SERVER_UPGRADE_REJECTED'));});
        request.on('upgrade',(response,socket,head)=>{
          const accept=createHash('sha1').update(key+'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
          if(response.statusCode!==101||response.headers['sec-websocket-accept']!==accept||String(response.headers.upgrade).toLowerCase()!=='websocket'||response.headers['sec-websocket-extensions']||response.headers['sec-websocket-protocol']){
            socket.destroy();finish(new CodexAppServerError('CODEX_APP_SERVER_UPGRADE_INVALID'));return;
          }
          this.#socket=socket;this.#connected=true;
          socket.on('data',chunk=>this.#ingest(chunk));
          socket.on('error',()=>this.#fail('CODEX_APP_SERVER_DISCONNECTED'));
          socket.on('close',()=>this.#fail('CODEX_APP_SERVER_DISCONNECTED'));
          if(head.length)this.#ingest(head);finish();
        });
        request.end();
      });
      const reply=await this.request('initialize',{clientInfo:{name:'io-agent-session-bridge',title:'iO Agent session bridge',version:'1'},capabilities:{experimentalApi:true}});
      need(object(reply)&&typeof reply.userAgent==='string'&&typeof reply.platformFamily==='string'&&typeof reply.platformOs==='string'&&path.isAbsolute(reply.codexHome??''),'CODEX_APP_SERVER_INITIALIZE_INVALID');
      this.serverInfo=Object.freeze({userAgent:reply.userAgent,platformFamily:reply.platformFamily,platformOs:reply.platformOs});
      this.#send({method:'initialized'});return this;
    }catch(error){this.close();throw error;}
  }
  #write(opcode,payload){
    need(!this.#closed&&this.#connected&&this.#socket?.writable,'CODEX_APP_SERVER_DISCONNECTED');
    need(payload.length<=MAX_FRAME,'CODEX_APP_SERVER_FRAME_LIMIT');
    const extra=payload.length<126?0:payload.length<=65535?2:8,header=Buffer.alloc(2+extra+4);
    header[0]=0x80|opcode;header[1]=0x80|(extra===0?payload.length:extra===2?126:127);
    if(extra===2)header.writeUInt16BE(payload.length,2);if(extra===8)header.writeBigUInt64BE(BigInt(payload.length),2);
    const mask=randomBytes(4);mask.copy(header,2+extra);const body=Buffer.alloc(payload.length);
    for(let i=0;i<payload.length;i++)body[i]=payload[i]^mask[i%4];
    this.#socket.write(Buffer.concat([header,body]));
  }
  #send(value){this.#write(1,Buffer.from(JSON.stringify(value)));}
  request(method,params={}, {mutation=false}={}){
    need(id(method)&&object(params),'CODEX_APP_SERVER_REQUEST_INVALID');
    need(!this.#closed&&this.#connected,'CODEX_APP_SERVER_DISCONNECTED');
    need(this.#pending.size<32,'CODEX_APP_SERVER_PENDING_LIMIT');
    const requestId=randomUUID();
    return new Promise((resolve,reject)=>{
      const pending={resolve,reject,method,threadId:params.threadId,mutation,sent:false,timer:null};
      pending.timer=setTimeout(()=>{this.#pending.delete(requestId);reject(new CodexAppServerError('CODEX_APP_SERVER_REPLY_TIMEOUT',{outcomeUnknown:mutation&&pending.sent}));},this.timeoutMs);
      this.#pending.set(requestId,pending);
      try{this.#send({id:requestId,method,params});pending.sent=true;}
      catch(error){clearTimeout(pending.timer);this.#pending.delete(requestId);reject(error);}
    });
  }
  listen(listener){this.#listeners.add(listener);return()=>this.#listeners.delete(listener);}
  #emit(message){for(const listener of this.#listeners){try{listener(message);}catch{}}}
  #ingest(chunk){
    if(this.#closed)return;
    try{
      need(this.#buffer.length+chunk.length<=MAX_FRAME+65536,'CODEX_APP_SERVER_FRAME_LIMIT');
      this.#buffer=Buffer.concat([this.#buffer,chunk]);
      while(this.#buffer.length>=2){
        const b=this.#buffer,first=b[0],opcode=first&15,fin=Boolean(first&128);let length=b[1]&127,at=2;
        need(!(first&0x70)&&!(b[1]&0x80),'CODEX_APP_SERVER_FRAME_INVALID');
        if(length===126){if(b.length<4)return;length=b.readUInt16BE(2);at=4;need(length>=126,'CODEX_APP_SERVER_FRAME_INVALID');}
        else if(length===127){if(b.length<10)return;const large=b.readBigUInt64BE(2);need(large<=BigInt(MAX_FRAME)&&large>65535n,'CODEX_APP_SERVER_FRAME_LIMIT');length=Number(large);at=10;}
        need(length<=MAX_FRAME&&[0,1,8,9,10].includes(opcode),'CODEX_APP_SERVER_FRAME_INVALID');
        if(opcode>=8)need(fin&&length<=125,'CODEX_APP_SERVER_FRAME_INVALID');
        if(b.length<at+length)return;
        const payload=Buffer.from(b.subarray(at,at+length));this.#buffer=b.subarray(at+length);
        if(opcode===8){this.#fail('CODEX_APP_SERVER_DISCONNECTED');return;}
        if(opcode===9){this.#write(10,payload);continue;}if(opcode===10)continue;
        need(opcode===0?this.#parts.length>0:this.#parts.length===0,'CODEX_APP_SERVER_FRAME_INVALID');
        this.#partBytes+=payload.length;need(this.#partBytes<=MAX_FRAME,'CODEX_APP_SERVER_FRAME_LIMIT');this.#parts.push(payload);
        if(fin){const text=new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(this.#parts));this.#parts=[];this.#partBytes=0;this.#message(JSON.parse(text));}
      }
    }catch(error){this.#fail(error instanceof CodexAppServerError?error.code:'CODEX_APP_SERVER_PROTOCOL_INVALID');}
  }
  #message(message){
    need(object(message),'CODEX_APP_SERVER_PROTOCOL_INVALID');
    if(typeof message.method==='string'){
      // Server requests belong to the native UI/owner. Never fabricate an
      // approval or an answer just because another client also sees it.
      this.#emit(message);return;
    }
    need(Object.hasOwn(message,'id'),'CODEX_APP_SERVER_PROTOCOL_INVALID');
    const pending=this.#pending.get(message.id);if(!pending)return;
    this.#pending.delete(message.id);clearTimeout(pending.timer);
    if(Object.hasOwn(message,'error')){
      // Opt-in isolated diagnostics only. Native messages may contain paths or
      // submitted content: they are never placed on public errors or logged.
      try{this.#diagnostic?.({method:pending.method,nativeCode:message.error?.code,nativeMessage:typeof message.error?.message==='string'?message.error.message.slice(0,4096):null});}catch{}
      const notMaterialized=message.error?.code===-32600&&['thread/turns/list','thread/items/list','thread/read'].includes(pending.method)&&uuid(pending.threadId)&&
        message.error?.message===`thread ${pending.threadId} is not materialized yet; ${pending.method} is unavailable before first user message`;
      const unsupported=message.error?.code===-32601&&['thread/items/list','thread/turns/list'].includes(pending.method)&&message.error?.message===`${pending.method} is not supported yet`;
      pending.reject(new CodexAppServerError('CODEX_APP_SERVER_RPC_ERROR',{outcomeUnknown:pending.mutation,nativeCode:message.error?.code,
        ...(notMaterialized?{nativeReason:'thread_not_materialized',threadId:pending.threadId}:unsupported?{nativeReason:'method_not_supported',nativeMethod:pending.method}:{})}));return;
    }
    if(!Object.hasOwn(message,'result')){pending.reject(new CodexAppServerError('CODEX_APP_SERVER_RECEIPT_INVALID',{outcomeUnknown:pending.mutation}));return;}
    pending.resolve(message.result);
  }
  #fail(code){
    if(this.#closed)return;this.#closed=true;this.#connected=false;this.#socket?.destroy();this.#http?.destroy();
    for(const pending of this.#pending.values()){clearTimeout(pending.timer);pending.reject(new CodexAppServerError(code,{outcomeUnknown:pending.mutation&&pending.sent}));}
    this.#pending.clear();this.#emit({method:'channel/closed',params:{code}});this.#listeners.clear();
  }
  close(){this.#fail('CODEX_APP_SERVER_DISCONNECTED');}
}

const normalizedWorkspace=value=>{need(typeof value==='string'&&path.isAbsolute(value),'CODEX_APP_SERVER_WORKSPACE_INVALID');try{return fs.realpathSync(value);}catch{return path.normalize(value);}};
const inputText=input=>Array.isArray(input)&&input.length===1&&input[0]?.type==='text'&&typeof input[0].text==='string'&&(!input[0].text_elements||Array.isArray(input[0].text_elements)&&input[0].text_elements.length===0)?input[0].text:null;
function submission(value){need(object(value)&&id(value.id)&&id(value.clientUserMessageId)&&Array.isArray(value.input),'CODEX_APP_SERVER_QUEUE_INVALID');return value;}
function turn(value){need(object(value)&&id(value.id)&&turnStates.has(value.status),'CODEX_APP_SERVER_TURN_INVALID');return value;}

/** One explicitly bound, already-loaded thread on an explicitly supplied
 * official app-server. SessionControl owns the durable write-ahead intent;
 * callers must retain that journal across process restarts. This adapter has
 * no retry/reconnect loop, and an ambiguous write is never resent here. */
export class CodexAppServerSession {
  #stopObservations=new Map();
  #observedTurnStarts=new Set();
  #observedTurnEnds=new Set();#observedKinds=new Map();#unknownToolTurns=new Set();
  #subscribeEvents;#joined=false;
  #channel;#attempts=new Map();#turnIds=new Map();#maxPages;#closed=false;#workspace;#inFlight=new Set();#interrupts=new Map();#hasHistory=false;#legacyItems=false;#legacyTurns=false;#queueStarts=new Map();#cleanups=new Map();#cleanupPreparing=new Set();#liveCommandItems=new Map();#liveItemsOverflow=false;#unlisten;
  constructor(channel,conversationId,{workspace,maxPages=10,subscribeEvents=false}={}){
    need(channel&&typeof channel.request==='function'&&uuid(conversationId),'CODEX_APP_SERVER_BINDING_INVALID');
    need(Number.isSafeInteger(maxPages)&&maxPages>=1&&maxPages<=100,'CODEX_APP_SERVER_LIMIT_INVALID');
    need(typeof subscribeEvents==='boolean','CODEX_APP_SERVER_BINDING_INVALID');
    this.#channel=channel;this.conversationId=conversationId;this.#workspace=normalizedWorkspace(workspace);this.#maxPages=maxPages;this.#subscribeEvents=subscribeEvents;
    if(typeof channel.listen==='function')this.#unlisten=channel.listen(message=>this.#observeNativeItem(message));
  }
  get capabilities(){return capabilities;}
  static async connect(conversationId,{endpoint,workspace,timeoutMs=5000,bearerToken,maxPages,metadataOnly=false,subscribeEvents=false,onDiagnostic}={}){
    need(typeof metadataOnly==='boolean','CODEX_APP_SERVER_BINDING_INVALID');
    const channel=await new CodexAppServerChannel(endpoint,{timeoutMs,bearerToken,onDiagnostic}).connect();
    try{return await new CodexAppServerSession(channel,conversationId,{workspace,maxPages,subscribeEvents}).attach({metadataOnly});}catch(error){channel.close();throw error;}
  }
  #check(){need(!this.#closed,'CODEX_APP_SERVER_CLOSED');}
  #observeNativeItem(message){
    if(!this.#closed && !Object.hasOwn(message??{},'id') && message?.method==='turn/started' &&
        message.params?.threadId===this.conversationId && id(message.params?.turn?.id)) {
      if(this.#observedTurnStarts.size>=1000)this.#liveItemsOverflow=true;
      else this.#observedTurnStarts.add(message.params.turn.id);
    }
    if(!this.#closed && !Object.hasOwn(message??{},'id') && message?.method==='turn/completed' &&
        message.params?.threadId===this.conversationId && id(message.params?.turn?.id)) {
      if(this.#observedTurnEnds.size>=1000)this.#liveItemsOverflow=true;
      else this.#observedTurnEnds.add(message.params.turn.id);
    }
    if(this.#closed||!object(message)||Object.hasOwn(message,'id')||!['item/started','item/completed'].includes(message.method))return;
    const params=message.params,item=params?.item,timestamp=params?.[message.method==='item/started'?'startedAtMs':'completedAtMs'];
    if(params?.threadId===this.conversationId && id(params.turnId) && object(item) && id(item.type)) {
      if(this.#observedKinds.size>=1000&&!this.#observedKinds.has(params.turnId))this.#liveItemsOverflow=true;
      else {
        const kinds=this.#observedKinds.get(params.turnId)??new Set();
        kinds.add(item.type);this.#observedKinds.set(params.turnId,kinds);
        if(kinds.size>64)this.#liveItemsOverflow=true;
      }
      if(item.type==='commandExecution' && (!processId(item.processId)||!id(item.id)||!Number.isSafeInteger(timestamp)))
        this.#unknownToolTurns.add(params.turnId);
    }
    if(!object(params)||params.threadId!==this.conversationId||!id(params.turnId)||!Number.isSafeInteger(timestamp)||timestamp<0||!object(item)||item.type!=='commandExecution'||!id(item.id)||!processId(item.processId))return;
    const prior=this.#liveCommandItems.get(item.id);
    if(prior){
      // Native item IDs cannot migrate between turns or process handles. Keep
      // contradictory evidence instead of allowing a later event to replace it.
      if(prior.turnId!==params.turnId||prior.processId!==item.processId)prior.conflicted=true;
      if(!prior.sources.includes(message.method))prior.sources.push(message.method);
      if(message.method==='item/completed' && ['completed','failed'].includes(item.status) && Number.isInteger(item.exitCode))
        Object.assign(prior,{status:item.status,exitCode:item.exitCode});
      return;
    }
    if(this.#liveCommandItems.size>=MAX_LIVE_COMMAND_ITEMS){this.#liveItemsOverflow=true;return;}
    // Never retain commands, output or other user content. Only native routing
    // identity and lifecycle provenance are needed for a later double match.
    this.#liveCommandItems.set(item.id,{id:item.id,turnId:params.turnId,processId:item.processId,sources:[message.method],conflicted:false,
      ...(message.method==='item/completed' && ['completed','failed'].includes(item.status) && Number.isInteger(item.exitCode) ?
        {status:item.status,exitCode:item.exitCode} : {})});
  }
  async #pages(method,params,visit){
    let cursor;const seen=new Set();
    for(let page=0;page<this.#maxPages;page++){
      const reply=await this.#channel.request(method,{...params,limit:100,...(cursor?{cursor}:{})});
      need(object(reply)&&Array.isArray(reply.data)&&(reply.nextCursor==null||id(reply.nextCursor)),'CODEX_APP_SERVER_HISTORY_INVALID');
      if(await visit(reply.data))return true;
      if(!reply.nextCursor)return false;
      need(!seen.has(reply.nextCursor),'CODEX_APP_SERVER_CURSOR_LOOP');seen.add(reply.nextCursor);cursor=reply.nextCursor;
    }
    throw new CodexAppServerError('CODEX_APP_SERVER_HISTORY_LIMIT');
  }
  async attach({metadataOnly=false}={}){
    need(typeof metadataOnly==='boolean','CODEX_APP_SERVER_BINDING_INVALID');
    if(metadataOnly)await this.readiness();else await this.status();
    if(this.#subscribeEvents&&!this.#joined){
      const before=await this.#metadata();
      // The official protocol uses resume to JOIN a thread already owned by
      // this shared server. No history/path/settings overrides, new server,
      // session discovery or implicit reconnect. A closing thread rejects it.
      const reply=await this.#channel.request('thread/resume',{threadId:this.conversationId,excludeTurns:true},{mutation:true});
      need(reply?.thread?.id===this.conversationId&&normalizedWorkspace(reply.thread.cwd)===this.#workspace&&
        reply.thread.canAcceptDirectInput===true&&!reply.thread.parentThreadId&&!reply.thread.ephemeral&&
        (before.createdAt===undefined||before.createdAt===reply.thread.createdAt),'CODEX_APP_SERVER_JOIN_INVALID',{outcomeUnknown:true});
      this.#joined=true;
    }
    return this;
  }
  async #metadata(){
    this.#check();
    const loaded=await this.#pages('thread/loaded/list',{},values=>{need(values.every(id),'CODEX_APP_SERVER_HISTORY_INVALID');return values.includes(this.conversationId);});
    need(loaded,'CODEX_APP_SERVER_THREAD_NOT_LOADED');
    const reply=await this.#channel.request('thread/read',{threadId:this.conversationId,includeTurns:false}),thread=reply?.thread;
    need(object(thread)&&thread.id===this.conversationId,'CODEX_APP_SERVER_THREAD_MISMATCH');
    need(normalizedWorkspace(thread.cwd)===this.#workspace,'CODEX_APP_SERVER_WORKSPACE_MISMATCH');
    need(['idle','active','systemError'].includes(thread.status?.type),'CODEX_APP_SERVER_THREAD_NOT_LOADED');
    need(!thread.parentThreadId&&thread.canAcceptDirectInput===true&&!thread.ephemeral,'CODEX_APP_SERVER_THREAD_UNSUPPORTED');
    return thread;
  }
  async #turns(){
    if(this.#legacyTurns)return this.#legacyHistory();
    const rows=new Map();try{await this.#pages('thread/turns/list',{threadId:this.conversationId,sortDirection:'desc',itemsView:'notLoaded'},values=>{
      for(const value of values){const current=turn(value),old=rows.get(current.id);need(!old||old.status===current.status,'CODEX_APP_SERVER_HISTORY_CHANGED');rows.set(current.id,current);}return false;
    });}catch(error){
      if(!rows.size&&error.nativeReason==='method_not_supported'&&error.nativeMethod==='thread/turns/list'){this.#legacyTurns=true;return this.#legacyHistory();}
      if(rows.size||!await this.#freshEmpty(error))throw error;
    }
    if(rows.size)this.#hasHistory=true;return[...rows.values()];
  }
  async #legacyHistory(){
    // The installed alpha advertises item pagination in generated schemas but
    // returns an explicit unsupported-method error at runtime. The documented
    // includeTurns read is an exact-thread fallback, never a session resume.
    let reply;try{reply=await this.#channel.request('thread/read',{threadId:this.conversationId,includeTurns:true});}
    catch(error){if(await this.#freshEmpty(error))return[];throw error;}
    const thread=reply?.thread;
    need(object(thread)&&thread.id===this.conversationId,'CODEX_APP_SERVER_THREAD_MISMATCH');
    need(normalizedWorkspace(thread.cwd)===this.#workspace,'CODEX_APP_SERVER_WORKSPACE_MISMATCH');
    need(Array.isArray(thread.turns)&&thread.turns.length<=this.#maxPages*100,'CODEX_APP_SERVER_HISTORY_LIMIT');
    let itemCount=0;const seen=new Set();
    for(const value of thread.turns){
      turn(value);need(!seen.has(value.id)&&Array.isArray(value.items)&&(value.itemsView==null||value.itemsView==='full'),'CODEX_APP_SERVER_HISTORY_INVALID');seen.add(value.id);
      itemCount+=value.items.length;need(itemCount<=this.#maxPages*100,'CODEX_APP_SERVER_HISTORY_LIMIT');
      need(value.items.every(item=>object(item)&&id(item.id)),'CODEX_APP_SERVER_HISTORY_INVALID');
    }
    if(thread.turns.length)this.#hasHistory=true;return thread.turns;
  }
  async #freshEmpty(error){
    if(this.#hasHistory||error?.nativeReason!=='thread_not_materialized'||error.threadId!==this.conversationId)return false;
    // This exact native error is evidence that a just-created, loaded thread
    // has no history store yet. Re-read it; generic invalid-request errors,
    // active threads and a previously observed history never become empty.
    const thread=await this.#metadata();
    return thread.status.type==='idle'&&thread.preview===''&&Array.isArray(thread.turns)&&thread.turns.length===0;
  }
  async status(){
    const thread=await this.#metadata();
    // Read every bounded metadata page so an older active turn is not silently
    // replaced by a newer terminal record. Failure stays non-actionable.
    const turns=await this.#turns(),active=turns.filter(t=>t.status==='inProgress');
    need(active.length<=1,'CODEX_APP_SERVER_ACTIVE_TURN_AMBIGUOUS');
    return{conversationId:this.conversationId,workspace:this.#workspace,busy:thread.status.type!=='idle'||active.length>0,activeTurnId:active[0]?.id??null,nativeStatus:thread.status.type};
  }
  async readiness(){
    // Directory probes must not enter turns/items pagination or its full
    // history fallback. Native metadata may include a preview; neither retain
    // it nor return it. Execution still uses status()'s stronger turn fence.
    const thread=await this.#metadata(),nativeStatus=thread.status.type;
    return{conversationId:this.conversationId,workspace:this.#workspace,
      busy:nativeStatus==='systemError'?null:nativeStatus==='active',
      canExecute:nativeStatus!=='systemError',nativeStatus,
      reason:nativeStatus==='systemError'?'CODEX_APP_SERVER_SYSTEM_ERROR':null};
  }
  async #items(turnId){
    if(this.#legacyItems)return(await this.#legacyHistory()).filter(t=>!turnId||t.id===turnId).flatMap(t=>t.items.map(item=>({turnId:t.id,item})));
    const rows=new Map();try{await this.#pages('thread/items/list',{threadId:this.conversationId,...(turnId?{turnId}:{}),sortDirection:'asc'},values=>{
      for(const entry of values){need(object(entry)&&id(entry.turnId)&&object(entry.item)&&id(entry.item.id),'CODEX_APP_SERVER_HISTORY_INVALID');if(turnId)need(entry.turnId===turnId,'CODEX_APP_SERVER_TURN_MISMATCH');const key=`${entry.turnId}:${entry.item.id}`;rows.set(key,entry);}return false;
    });}catch(error){
      if(!rows.size&&error.nativeReason==='method_not_supported'&&error.nativeMethod==='thread/items/list'){this.#legacyItems=true;return this.#items(turnId);}
      if(turnId||rows.size||!await this.#freshEmpty(error))throw error;
    }
    if(rows.size)this.#hasHistory=true;return[...rows.values()];
  }
  async #queue(){const rows=[];await this.#pages('thread/queue/list',{threadId:this.conversationId},values=>{rows.push(...values.map(submission));return false;});return rows;}
  async inspectOperation(clientUserMessageId){
    need(uuid(clientUserMessageId),'CODEX_APP_SERVER_INPUT_INVALID');await this.#metadata();
    const known=this.#turnIds.get(clientUserMessageId),items=await this.#items(known);
    const matches=items.filter(e=>e.item.type==='userMessage'&&e.item.clientId===clientUserMessageId),matchedTurns=new Set(matches.map(e=>e.turnId));
    need(matchedTurns.size<=1,'CODEX_APP_SERVER_OPERATION_AMBIGUOUS');
    if(matches.length){
      const turnId=matches[0].turnId;need(!known||known===turnId,'CODEX_APP_SERVER_TURN_MISMATCH');this.#turnIds.set(clientUserMessageId,turnId);
      const turns=await this.#turns(),current=turns.find(t=>t.id===turnId);need(current,'CODEX_APP_SERVER_TURN_NOT_PROVEN');
      const content=inputText(matches[0].item.content),result={found:true,clientUserMessageId,turnId,status:current.status,inputDigest:content===null?null:digest(content)};
      if(current.status==='completed'){
        result.resultComplete=false;
        // The first item read may precede the completion notification/history
        // commit. Fetch this exact turn again after observing terminal status.
        const finalSnapshot=await this.#items(turnId);
        need(finalSnapshot.some(e=>e.item.type==='userMessage'&&e.item.clientId===clientUserMessageId),'CODEX_APP_SERVER_OPERATION_NOT_PROVEN');
        const finalItems=finalSnapshot.filter(e=>e.turnId===turnId&&e.item.type==='agentMessage'&&e.item.phase==='final_answer'&&typeof e.item.text==='string');
        const text=finalItems.map(e=>e.item.text).join('\n\n');
        // phase:null is not promoted to final, even in historical records.
        if(finalItems.length&&Buffer.byteLength(text)<=MAX_RESULT){
          if(text)result.result={type:'text',text};
          result.resultComplete=true;result.resultEvidence={source:'native_agent_message',item_ids:finalItems.map(e=>e.item.id),phase:'final_answer'};
        }
      }
      return result;
    }
    if(known)throw new CodexAppServerError('CODEX_APP_SERVER_OPERATION_NOT_PROVEN');
    const queued=(await this.#queue()).filter(q=>q.clientUserMessageId===clientUserMessageId);
    need(queued.length<=1,'CODEX_APP_SERVER_OPERATION_AMBIGUOUS');
    if(queued.length){const content=inputText(queued[0].input);return{found:true,clientUserMessageId,turnId:null,status:'queued',queueId:queued[0].id,inputDigest:content===null?null:digest(content)};}
    // Queue removal, an empty page or a dropped reply is never execution or
    // rejection evidence. The durable caller must keep the intent unknown.
    return{found:false,outcomeUnknown:true};
  }
  async start(input={}){
    need(uuid(input.clientUserMessageId),'CODEX_APP_SERVER_INPUT_INVALID');
    need(!this.#inFlight.has(input.clientUserMessageId),'CODEX_APP_SERVER_INPUT_IN_FLIGHT',{outcomeUnknown:true});
    this.#inFlight.add(input.clientUserMessageId);
    try{return await this.#start(input);}finally{this.#inFlight.delete(input.clientUserMessageId);}
  }
  async #start({text,clientUserMessageId,expiresAt}={}){
    this.#check();need(typeof text==='string'&&text.trim()&&Buffer.byteLength(text)<=32768&&uuid(clientUserMessageId),'CODEX_APP_SERVER_INPUT_INVALID');
    const hash=digest(text),prior=this.#attempts.get(clientUserMessageId);
    if(prior){
      need(prior.digest===hash,'CODEX_APP_SERVER_INPUT_CONFLICT');
      if(prior.receipt)return{...prior.receipt};
      const observed=await this.inspectOperation(clientUserMessageId);
      if(observed.found){need(observed.inputDigest===hash,'CODEX_APP_SERVER_INPUT_CONFLICT');return{accepted:true,clientUserMessageId,queueId:observed.queueId??null,reconciled:true};}
      throw new CodexAppServerError('CODEX_APP_SERVER_OUTCOME_UNKNOWN',{outcomeUnknown:true});
    }
    need(typeof expiresAt==='string'&&Number.isFinite(Date.parse(expiresAt))&&Date.parse(expiresAt)>Date.now(),'CODEX_APP_SERVER_INPUT_EXPIRED');
    await this.#metadata();
    need(Date.parse(expiresAt)>Date.now(),'CODEX_APP_SERVER_INPUT_EXPIRED');
    need(this.#attempts.size<1000,'CODEX_APP_SERVER_OPERATION_LIMIT');
    const attempt={digest:hash};this.#attempts.set(clientUserMessageId,attempt);
    try{
      const reply=await this.#channel.request('thread/queue/add',{threadId:this.conversationId,input:[{type:'text',text,text_elements:[]}],clientUserMessageId},{mutation:true});
      const queued=submission(reply?.queuedSubmission);
      need(queued.clientUserMessageId===clientUserMessageId&&inputText(queued.input)===text,'CODEX_APP_SERVER_QUEUE_RECEIPT_INVALID',{outcomeUnknown:true});
      attempt.receipt={accepted:true,clientUserMessageId,queueId:queued.id,status:'queued'};return{...attempt.receipt};
    }catch(error){
      // Preserve the attempt even when receipt parsing fails. Never retry the
      // mutation merely because a server reply was absent or malformed.
      throw new CodexAppServerError(error instanceof CodexAppServerError?error.code:'CODEX_APP_SERVER_QUEUE_RECEIPT_INVALID',{outcomeUnknown:true,nativeCode:error.nativeCode});
    }
  }
  async interrupt(expectedTurnId){
    need(id(expectedTurnId),'CODEX_APP_SERVER_TURN_INVALID');
    if(this.#interrupts.has(expectedTurnId)){
      const prior=this.#interrupts.get(expectedTurnId);
      if(prior)return{...prior};
      throw new CodexAppServerError('CODEX_APP_SERVER_INTERRUPT_OUTCOME_UNKNOWN',{outcomeUnknown:true});
    }
    need(this.#interrupts.size<1000,'CODEX_APP_SERVER_OPERATION_LIMIT');
    // Reserve before awaiting status so simultaneous callers cannot both send.
    this.#interrupts.set(expectedTurnId,null);
    const status=await this.status();if(status.activeTurnId!==expectedTurnId)return{requested:false,expectedTurnId,reason:'turn_no_longer_active'};
    const reply=await this.#channel.request('turn/interrupt',{threadId:this.conversationId,turnId:expectedTurnId},{mutation:true});
    need(object(reply)&&Object.keys(reply).length===0,'CODEX_APP_SERVER_INTERRUPT_RECEIPT_INVALID',{outcomeUnknown:true});
    const receipt={requested:true,expectedTurnId,confirmedStopped:false};this.#interrupts.set(expectedTurnId,receipt);return{...receipt};
  }
  async startQueued(clientUserMessageId,{expiresAt}={}){
    this.#check();need(uuid(clientUserMessageId),'CODEX_APP_SERVER_INPUT_INVALID');
    if(expiresAt!==undefined)need(typeof expiresAt==='string'&&Number.isFinite(Date.parse(expiresAt)),'CODEX_APP_SERVER_INPUT_INVALID');
    need(!this.#inFlight.has(clientUserMessageId),'CODEX_APP_SERVER_INPUT_IN_FLIGHT',{outcomeUnknown:true});
    const original=this.#attempts.get(clientUserMessageId);
    need(original,'CODEX_APP_SERVER_OPERATION_UNKNOWN');
    const prior=this.#queueStarts.get(clientUserMessageId);
    if(prior){
      if(prior.receipt)return structuredClone(prior.receipt);
      need(prior.sent,'CODEX_APP_SERVER_INPUT_IN_FLIGHT',{outcomeUnknown:true});
      // A lost start receipt can be reconciled by the original message ID,
      // never by blindly starting the queued submission again.
      const observed=await this.inspectOperation(clientUserMessageId);
      if(observed.found&&observed.turnId){
        need(observed.inputDigest===original.digest,'CODEX_APP_SERVER_INPUT_CONFLICT');
        return{requested:true,clientUserMessageId,queueId:prior.queueId,turnId:observed.turnId,reconciled:true};
      }
      throw new CodexAppServerError('CODEX_APP_SERVER_QUEUE_START_OUTCOME_UNKNOWN',{outcomeUnknown:true});
    }
    need(this.#queueStarts.size<1000,'CODEX_APP_SERVER_OPERATION_LIMIT');
    const attempt={sent:false,queueId:null};this.#queueStarts.set(clientUserMessageId,attempt);
    try{
      const observed=await this.inspectOperation(clientUserMessageId);
      need(observed.found,'CODEX_APP_SERVER_OPERATION_NOT_PROVEN');
      need(observed.inputDigest===original.digest,'CODEX_APP_SERVER_INPUT_CONFLICT');
      if(observed.turnId){this.#queueStarts.delete(clientUserMessageId);return{requested:false,clientUserMessageId,turnId:observed.turnId,reason:'operation_already_started'};}
      need(observed.status==='queued'&&id(observed.queueId),'CODEX_APP_SERVER_QUEUE_INVALID');
      need(!original.receipt||original.receipt.queueId===observed.queueId,'CODEX_APP_SERVER_QUEUE_CHANGED');
      const status=await this.status();
      if(status.busy){this.#queueStarts.delete(clientUserMessageId);return{requested:false,clientUserMessageId,queueId:observed.queueId,reason:'thread_busy'};}
      const fresh=(await this.#queue()).filter(q=>q.clientUserMessageId===clientUserMessageId);
      need(fresh.length===1&&fresh[0].id===observed.queueId&&digest(inputText(fresh[0].input)??'')===original.digest,'CODEX_APP_SERVER_QUEUE_CHANGED');
      need(expiresAt===undefined||Date.parse(expiresAt)>Date.now(),'CODEX_APP_SERVER_INPUT_EXPIRED');
      attempt.queueId=observed.queueId;attempt.sent=true;
      // The explicit submission selects the first turn, but the native queue
      // then drains already-authorized queued inputs in their existing order.
      // The phone explicitly describes this restoration of session execution.
      // Busy rejection avoids turn/start's steer race; it is not an isolated
      // single-operation continuation or permission to rewrite other entries.
      const reply=await this.#channel.request('thread/queue/start',{threadId:this.conversationId,queuedSubmissionId:attempt.queueId},{mutation:true});
      const started=turn(reply?.turn);
      attempt.receipt={requested:true,clientUserMessageId,queueId:attempt.queueId,turnId:started.id,confirmedStarted:false};
      return structuredClone(attempt.receipt);
    }catch(error){
      if(!attempt.sent){this.#queueStarts.delete(clientUserMessageId);throw error;}
      throw new CodexAppServerError(error instanceof CodexAppServerError?error.code:'CODEX_APP_SERVER_QUEUE_START_RECEIPT_INVALID',{outcomeUnknown:true,nativeCode:error.nativeCode});
    }
  }
  async #terminals(){
    const rows=[],seen=new Set();
    await this.#pages('thread/backgroundTerminals/list',{threadId:this.conversationId},values=>{
      for(const value of values){
        need(object(value)&&id(value.itemId)&&processId(value.processId)&&typeof value.command==='string'&&typeof value.cwd==='string'&&!seen.has(value.processId),'CODEX_APP_SERVER_TERMINAL_INVALID');
        seen.add(value.processId);rows.push(value);
      }
      return false;
    });return rows;
  }
  async #turnCommands(turnId){
    need(!this.#liveItemsOverflow,'CODEX_APP_SERVER_LIVE_ITEM_LIMIT');
    const rows=new Map();
    for(const entry of await this.#items(turnId)){
      const item=entry.item;if(item.type!=='commandExecution'||!processId(item.processId))continue;
      rows.set(item.id,{id:item.id,processId:item.processId,sources:['history']});
    }
    // Some code-mode nested commands appear in native item notifications but
    // not in model-visible history. Only this channel's exact-thread events
    // may supplement history; source code/text and OS process scans cannot.
    for(const live of this.#liveCommandItems.values()){
      const old=rows.get(live.id);
      if(live.turnId!==turnId&&!old)continue;
      need(!live.conflicted&&(!old||live.turnId===turnId&&old.processId===live.processId),'CODEX_APP_SERVER_TERMINAL_AMBIGUOUS');
      if(live.turnId!==turnId)continue;
      if(old)old.sources.push(...live.sources);else rows.set(live.id,{id:live.id,processId:live.processId,sources:[...live.sources]});
    }
    need(!this.#liveItemsOverflow,'CODEX_APP_SERVER_LIVE_ITEM_LIMIT');return[...rows.values()];
  }
  async terminateTurnTerminals(turnId){
    this.#check();need(id(turnId),'CODEX_APP_SERVER_TURN_INVALID');
    if(this.#cleanups.has(turnId))return structuredClone(this.#cleanups.get(turnId));
    need(!this.#cleanupPreparing.has(turnId),'CODEX_APP_SERVER_CLEANUP_IN_FLIGHT',{outcomeUnknown:true});
    need(this.#cleanups.size<1000,'CODEX_APP_SERVER_OPERATION_LIMIT');this.#cleanupPreparing.add(turnId);
    try{
      await this.#metadata();const targetTurn=(await this.#turns()).find(t=>t.id===turnId);
      need(targetTurn&&terminal.has(targetTurn.status),'CODEX_APP_SERVER_TURN_NOT_TERMINAL');
      const items=await this.#turnCommands(turnId);
      const live=await this.#terminals(),seen=new Set(),targets=[];
      for(const item of items){
        need(!seen.has(item.processId),'CODEX_APP_SERVER_TERMINAL_AMBIGUOUS');seen.add(item.processId);
        if(live.some(value=>value.itemId===item.id&&value.processId===item.processId))targets.push({itemId:item.id,processId:item.processId,sources:item.sources,requested:false,terminated:null,outcomeUnknown:false});
      }
      const attempt={conversationId:this.conversationId,turnId,complete:false,terminals:targets,descendantsStopped:false};
      // Freeze the selected set before any terminate write. Repeated calls
      // return this ledger, including unknown receipts; they never discover
      // new targets or resend a previous termination.
      this.#cleanups.set(turnId,attempt);
      for(const target of targets){
        try{
          const currentItems=await this.#turnCommands(turnId),currentLive=await this.#terminals();
          const sameItem=currentItems.some(item=>item.id===target.itemId&&item.processId===target.processId);
          const sameTerminal=currentLive.some(value=>value.itemId===target.itemId&&value.processId===target.processId);
          const cached=this.#liveCommandItems.get(target.itemId);
          need(!this.#liveItemsOverflow,'CODEX_APP_SERVER_LIVE_ITEM_LIMIT');
          need(!cached||!cached.conflicted&&cached.turnId===turnId&&cached.processId===target.processId,'CODEX_APP_SERVER_TERMINAL_AMBIGUOUS');
          if(!sameItem||!sameTerminal){target.reason='target_no_longer_matches';target.outcomeUnknown=true;continue;}
          target.requested=true;target.outcomeUnknown=true;
          const reply=await this.#channel.request('thread/backgroundTerminals/terminate',{threadId:this.conversationId,processId:target.processId},{mutation:true});
          need(object(reply)&&typeof reply.terminated==='boolean','CODEX_APP_SERVER_TERMINATE_RECEIPT_INVALID',{outcomeUnknown:true});
          target.terminated=reply.terminated;target.outcomeUnknown=false;
        }catch(error){target.outcomeUnknown=true;target.reason=error instanceof CodexAppServerError?error.code:'CODEX_APP_SERVER_TERMINATE_UNCONFIRMED';}
      }
      attempt.complete=true;return structuredClone(attempt);
    }finally{this.#cleanupPreparing.delete(turnId);}
  }
  async inspectStop(turnId){
    need(id(turnId),'CODEX_APP_SERVER_TURN_INVALID');await this.#metadata();const current=(await this.#turns()).find(t=>t.id===turnId);
    const result={conversationId:this.conversationId,turnId,terminal:current?terminal.has(current.status):false,nativeStatus:current?.status??null,descendantsStopped:false};
    if(current?.status!=='interrupted' || this.#liveItemsOverflow || !this.#observedTurnStarts.has(turnId) ||
      !this.#observedTurnEnds.has(turnId) || this.#unknownToolTurns.has(turnId))return result;
    const items=(await this.#items(turnId)).map(e=>e.item),commands=await this.#turnCommands(turnId),live=await this.#terminals();
    // An external/MCP/child-agent job has a separate lifecycle. Its absence
    // from the terminal table cannot certify that work stopped.
    const synchronous=new Set(['userMessage','agentMessage','reasoning','fileChange','webSearch','imageView','contextCompaction','plan']);
    const unsupported=items.some(item=>item.type!=='commandExecution'&&!synchronous.has(item.type)) ||
      [...(this.#observedKinds.get(turnId)??[])].some(kind=>kind!=='commandExecution'&&!synchronous.has(kind));
    let settled=true;
    for (const item of commands) {
      const history=items.find(v=>v.id===item.id),event=this.#liveCommandItems.get(item.id);
      const completed=event?.turnId===turnId&&!event.conflicted&&event.processId===item.processId&&
        ['completed','failed'].includes(event.status)&&Number.isInteger(event.exitCode);
      const historical=history&&['completed','failed'].includes(history.status)&&Number.isInteger(history.exitCode);
      if(!completed&&!historical || live.some(v=>v.itemId===item.id&&v.processId===item.processId))settled=false;
    }
    // A live terminal with this turn's item ID but a contradictory handle is
    // unknown work, never evidence that the old process disappeared.
    if(live.some(v=>commands.some(c=>c.id===v.itemId&&c.processId!==v.processId)))settled=false;
    const noHandle=items.filter(v=>v.type==='commandExecution'&&!processId(v.processId));
    if(noHandle.some(v=>!['completed','failed'].includes(v.status)||!Number.isInteger(v.exitCode)))settled=false;
    const observation=digest(JSON.stringify({turn:current.status,commands:commands.map(c=>({id:c.id,processId:c.processId})).sort((a,b)=>a.id.localeCompare(b.id)),
      settled,unsupported})),previous=this.#stopObservations.get(turnId),now=Date.now();
    if(!previous || previous.digest!==observation){
      need(this.#stopObservations.size<1000||this.#stopObservations.has(turnId),'CODEX_APP_SERVER_OPERATION_LIMIT');
      this.#stopObservations.set(turnId,{digest:observation,at:now});
    }
    result.descendantsStopped=!unsupported&&settled&&previous?.digest===observation&&now-previous.at>=450;
    result.workStop={scope:'native_turn_and_managed_process_groups',commandsSettled:settled,unsupportedWork:unsupported};
    return result;
  }
  async stopChildren(turnId){return this.terminateTurnTerminals(turnId);}
  close(){if(this.#closed)return;this.#closed=true;this.#unlisten?.();this.#liveCommandItems.clear();this.#channel.close();}
}
