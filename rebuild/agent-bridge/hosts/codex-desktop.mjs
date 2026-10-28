import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import {createHash, randomUUID} from 'node:crypto';

const PROFILE=JSON.parse(fs.readFileSync(new URL('./codex-desktop-profile.json',import.meta.url),'utf8'));
const MAX_FRAME=256*1024*1024;
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value);
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);

export class DesktopError extends Error {
  constructor(code,{outcomeUnknown=false}={}){super(code);this.code=code;this.outcomeUnknown=outcomeUnknown;}
}
function requireValue(value,code){if(!value)throw new DesktopError(code);}

// This is a private desktop protocol, not the public app-server endpoint. An
// unreviewed app update must disable it rather than guess a new wire format.
export function verifyDesktopBuild(asar='/Applications/ChatGPT.app/Contents/Resources/app.asar') {
  let fd;
  try {
    fd=fs.openSync(asar,'r');const prefix=Buffer.alloc(16);
    requireValue(fs.readSync(fd,prefix,0,16,0)===16,'CODEX_DESKTOP_VERSION_UNVERIFIED');
    const headerSize=prefix.readUInt32LE(12),dataOffset=8+prefix.readUInt32LE(4);
    requireValue(headerSize>0&&headerSize<16*1024*1024&&dataOffset>=16+headerSize,'CODEX_DESKTOP_VERSION_UNVERIFIED');
    const header=Buffer.alloc(headerSize);requireValue(fs.readSync(fd,header,0,header.length,16)===header.length,'CODEX_DESKTOP_VERSION_UNVERIFIED');
    const tree=JSON.parse(header.toString('utf8'));
    for(const source of PROFILE.sources){
      let entry=tree;for(const component of source.path.split('/'))entry=entry.files?.[component];
      requireValue(entry?.size===source.bytes&&/^\d+$/.test(entry.offset),'CODEX_DESKTOP_VERSION_UNVERIFIED');
      const offset=dataOffset+Number(entry.offset);requireValue(Number.isSafeInteger(offset),'CODEX_DESKTOP_VERSION_UNVERIFIED');
      const bytes=Buffer.alloc(source.bytes);requireValue(fs.readSync(fd,bytes,0,bytes.length,offset)===bytes.length&&createHash('sha256').update(bytes).digest('hex')===source.sha256,'CODEX_DESKTOP_VERSION_UNVERIFIED');
    }
    return true;
  } catch {throw new DesktopError('CODEX_DESKTOP_VERSION_UNVERIFIED');}
  finally {if(fd!==undefined)fs.closeSync(fd);}
}

function verifiedSocket(socketPath){
  try {
    const uid=process.getuid?.(),parent=fs.lstatSync(path.dirname(socketPath)),file=fs.lstatSync(socketPath);
    requireValue(uid!==undefined&&parent.isDirectory()&&file.isSocket()&&parent.uid===uid&&file.uid===uid&&!(parent.mode&0o077)&&!(file.mode&0o077),'CODEX_DESKTOP_SOCKET_UNTRUSTED');
    requireValue(fs.realpathSync(path.dirname(socketPath))===path.dirname(socketPath),'CODEX_DESKTOP_SOCKET_UNTRUSTED');
  } catch(error){if(error instanceof DesktopError)throw error;throw new DesktopError('CODEX_DESKTOP_UNAVAILABLE');}
}

/** One bounded connection to the already running owner. It never launches an
 * app/server, takes ownership, resumes a thread, retries input or changes policy. */
export class DesktopChannel {
  #socket;#pending=new Map();#listeners=new Set();#head=Buffer.alloc(4);#headAt=0;#body=null;#bodyAt=0;#client='initializing-client';#closed=false;
  constructor(socketPath,{timeoutMs=5000}={}){
    requireValue(Number.isSafeInteger(timeoutMs)&&timeoutMs>=50&&timeoutMs<=30000,'CODEX_DESKTOP_TIMEOUT_INVALID');
    this.socketPath=socketPath;this.timeoutMs=timeoutMs;
  }
  async connect(){
    requireValue(!this.#socket&&!this.#closed,'CODEX_DESKTOP_ALREADY_CONNECTED');verifiedSocket(this.socketPath);
    this.#socket=net.createConnection(this.socketPath);
    this.#socket.on('data',chunk=>this.#ingest(chunk));
    this.#socket.on('error',()=>this.#fail('CODEX_DESKTOP_DISCONNECTED'));
    this.#socket.on('close',()=>this.#fail('CODEX_DESKTOP_DISCONNECTED'));
    try{
      await new Promise((resolve,reject)=>{
        const timer=setTimeout(()=>finish(new DesktopError('CODEX_DESKTOP_CONNECT_TIMEOUT')),this.timeoutMs);
        const finish=error=>{clearTimeout(timer);this.#socket.off('connect',connected);this.#socket.off('error',failed);error?reject(error):resolve();};
        const connected=()=>finish(),failed=()=>finish(new DesktopError('CODEX_DESKTOP_UNAVAILABLE'));
        this.#socket.once('connect',connected);this.#socket.once('error',failed);
      });
      const reply=await this.request('initialize',{clientType:'io-agent-session-bridge'},{version:0});
      requireValue(uuid(reply.result?.clientId),'CODEX_DESKTOP_PROTOCOL');this.#client=reply.result.clientId;return this;
    }catch(error){this.close();throw error;}
  }
  #send(frame){
    requireValue(!this.#closed&&this.#socket?.writable,'CODEX_DESKTOP_DISCONNECTED');
    const body=Buffer.from(JSON.stringify(frame),'utf8');requireValue(body.length>0&&body.length<=MAX_FRAME,'CODEX_DESKTOP_FRAME_LIMIT');
    const head=Buffer.alloc(4);head.writeUInt32LE(body.length);this.#socket.write(Buffer.concat([head,body]));
  }
  request(method,params,{targetClientId,version=PROFILE.versions[method],mutation=false}={}){
    requireValue(Number.isInteger(version),'CODEX_DESKTOP_METHOD_UNSUPPORTED');
    requireValue(this.#pending.size<8,'CODEX_DESKTOP_PENDING_LIMIT');
    const requestId=randomUUID();
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{this.#pending.delete(requestId);reject(new DesktopError('CODEX_DESKTOP_REPLY_TIMEOUT',{outcomeUnknown:mutation}));},this.timeoutMs);
      this.#pending.set(requestId,{method,targetClientId,mutation,resolve,reject,timer});
      try{this.#send({type:'request',requestId,sourceClientId:this.#client,method,version,params,timeoutMs:this.timeoutMs,...(targetClientId?{targetClientId}:{})});}
      catch(error){clearTimeout(timer);this.#pending.delete(requestId);reject(error);}
    });
  }
  broadcast(method,params,targetClientId){this.#send({type:'broadcast',method,version:PROFILE.versions[method],sourceClientId:this.#client,targetClientIds:[targetClientId],params});}
  listen(listener){this.#listeners.add(listener);return()=>this.#listeners.delete(listener);}
  #ingest(chunk){
    if(this.#closed)return;
    try{
      let position=0;
      while(position<chunk.length){
        if(this.#body===null){const size=Math.min(4-this.#headAt,chunk.length-position);chunk.copy(this.#head,this.#headAt,position,position+size);position+=size;this.#headAt+=size;if(this.#headAt<4)return;const length=this.#head.readUInt32LE();requireValue(length>0&&length<=MAX_FRAME,'CODEX_DESKTOP_FRAME_LIMIT');this.#body=Buffer.allocUnsafe(length);this.#bodyAt=0;this.#headAt=0;}
        const copied=Math.min(this.#body.length-this.#bodyAt,chunk.length-position);chunk.copy(this.#body,this.#bodyAt,position,position+copied);this.#bodyAt+=copied;position+=copied;if(this.#bodyAt<this.#body.length)return;
        const frame=JSON.parse(this.#body.toString('utf8'));this.#body=null;this.#bodyAt=0;
        requireValue(object(frame)&&typeof frame.type==='string','CODEX_DESKTOP_PROTOCOL');
        if(frame.type==='client-discovery-request'){
          // We are a consumer, never another owner or approval handler.
          this.#send({type:'client-discovery-response',requestId:frame.requestId,response:{canHandle:false}});
        }else if(frame.type==='response'){
          const pending=this.#pending.get(frame.requestId);if(!pending)continue;
          this.#pending.delete(frame.requestId);clearTimeout(pending.timer);
          if(frame.resultType==='error'){
            const error=new DesktopError(frame.error==='no-client-found'?'CODEX_DESKTOP_OWNER_UNAVAILABLE':'CODEX_DESKTOP_REQUEST_FAILED',{outcomeUnknown:pending.mutation&&frame.error!=='no-client-found'});
            error.nativeReason=typeof frame.error==='string'?frame.error.slice(0,512):null;pending.reject(error);
          }
          else if(frame.resultType!=='success'||frame.method!==pending.method||pending.targetClientId&&frame.handledByClientId!==pending.targetClientId||!object(frame.result))pending.reject(new DesktopError('CODEX_DESKTOP_PROTOCOL',{outcomeUnknown:pending.mutation}));
          else pending.resolve(frame);
        }else if(frame.type==='broadcast')for(const listener of this.#listeners)listener(frame);
        else if(frame.type==='request')this.#send({type:'response',requestId:frame.requestId,resultType:'error',error:'no-client-found'});
        else throw new DesktopError('CODEX_DESKTOP_PROTOCOL');
      }
    }catch(error){this.#fail(error instanceof DesktopError?error.code:'CODEX_DESKTOP_PROTOCOL');}
  }
  #fail(code){
    if(this.#closed)return;this.#closed=true;this.#socket?.destroy();this.#body=null;this.#bodyAt=this.#headAt=0;
    for(const pending of this.#pending.values()){clearTimeout(pending.timer);pending.reject(new DesktopError(code,{outcomeUnknown:pending.mutation}));}this.#pending.clear();
    for(const listener of this.#listeners)listener({type:'closed',code});this.#listeners.clear();
  }
  close(){this.#fail('CODEX_DESKTOP_DISCONNECTED');}
}

export function turnsOf(state){
  if(state.turnHistory?.kind==='canonical'){
    const history=state.turnHistory.history;
    requireValue(object(history?.entitiesByKey)&&Array.isArray(history.islands),'CODEX_DESKTOP_STATE_UNSUPPORTED');
    const turns=history.islands.flatMap(island=>island.entries.map(entry=>history.entitiesByKey[entry.value]));
    requireValue(turns.every(object),'CODEX_DESKTOP_STATE_UNCERTAIN');
    // Native q(state) merges canonical history with the live legacy overlay.
    // Dropping the overlay can hide an in-flight or newly accepted turn. We
    // conservatively retain inProgress and reject conflicting terminal data.
    const merged=[...turns],positions=new Map();
    const key=turn=>turn.turnId!=null?`turn:${turn.turnId}`:turn.params?.clientUserMessageId!=null?`message:${turn.params.clientUserMessageId}`:null;
    for(let index=0;index<merged.length;index++){const id=key(merged[index]);if(id!==null){requireValue(!positions.has(id),'CODEX_DESKTOP_STATE_UNCERTAIN');positions.set(id,index);}}
    for(const overlay of state.turns??[]){
      requireValue(object(overlay),'CODEX_DESKTOP_STATE_UNCERTAIN');const id=key(overlay),index=id===null?undefined:positions.get(id);
      if(index===undefined){if(id!==null)positions.set(id,merged.length);merged.push(overlay);continue;}
      const existing=merged[index],a=existing.params?.clientUserMessageId,b=overlay.params?.clientUserMessageId;
      requireValue(a==null||b==null||a===b,'CODEX_DESKTOP_OPERATION_AMBIGUOUS');
      const active=existing.status==='inProgress'||overlay.status==='inProgress';
      requireValue(active||existing.status===overlay.status,'CODEX_DESKTOP_STATE_UNCERTAIN');
      merged[index]={...existing,...overlay,status:active?'inProgress':overlay.status,params:{clientUserMessageId:b??a??null}};
    }
    return merged;
  }
  if(Array.isArray(state.turns))return state.turns;
  throw new DesktopError('CODEX_DESKTOP_STATE_UNSUPPORTED');
}
function projectTurn(turn,includeItems=false){return{turnId:turn?.turnId??null,status:turn?.status??null,params:{clientUserMessageId:turn?.params?.clientUserMessageId??null},...(includeItems?{items:structuredClone(turn?.items??[])}:{})};}
function projectHistory(history,includeItems=false){
  requireValue(object(history?.entitiesByKey)&&Array.isArray(history.islands),'CODEX_DESKTOP_STATE_UNSUPPORTED');
  const entries=Object.entries(history.entitiesByKey);requireValue(entries.length<=10000,'CODEX_DESKTOP_STATE_LIMIT');
  return{entitiesByKey:Object.fromEntries(entries.map(([key,turn])=>[key,projectTurn(turn,includeItems)])),islands:structuredClone(history.islands)};
}
function projectState(state,includeItems=false){
  return{id:state.id,cwd:state.cwd??null,threadRuntimeStatus:state.threadRuntimeStatus??null,resumeState:state.resumeState??null,
    unconfirmedTurnSubmissions:Array.isArray(state.unconfirmedTurnSubmissions)?state.unconfirmedTurnSubmissions.map(projectSubmission):[],turns:Array.isArray(state.turns)?state.turns.map(t=>projectTurn(t,includeItems)):[],
    ...(state.turnHistory?.kind==='canonical'?{turnHistory:{kind:'canonical',history:projectHistory(state.turnHistory.history,includeItems)}}:{})};
}
function projectSubmission(submission){return{terminal:submission?.terminal??null};}
const SKIP=Symbol('irrelevant');
function projectPatch(parts,value,includeItems=false){
  if(parts.length===0)return projectState(value,includeItems);
  if(['id','cwd','threadRuntimeStatus','resumeState'].includes(parts[0]))return value;
  if(parts[0]==='unconfirmedTurnSubmissions')return parts.length===1?value.map(projectSubmission):parts.length===2?projectSubmission(value):parts.length===3&&parts[2]==='terminal'?value:SKIP;
  let rest;
  if(parts[0]==='turns'){
    if(parts.length===1)return value.map(t=>projectTurn(t,includeItems));if(parts.length===2)return projectTurn(value,includeItems);rest=parts.slice(2);
  }else if(parts[0]==='turnHistory'){
    if(parts.length===1)return value?.kind==='canonical'?{kind:'canonical',history:projectHistory(value.history,includeItems)}:{kind:value?.kind??null};
    if(parts[1]==='kind')return value;
    if(parts[1]!=='history')return SKIP;
    if(parts.length===2)return projectHistory(value,includeItems);
    if(parts[2]==='islands')return value;
    if(parts[2]!=='entitiesByKey')return SKIP;
    if(parts.length===3)return Object.fromEntries(Object.entries(value).map(([key,turn])=>[key,projectTurn(turn,includeItems)]));
    if(parts.length===4)return projectTurn(value,includeItems);rest=parts.slice(4);
  }else return SKIP;
  if(rest[0]==='turnId'||rest[0]==='status')return value;
  if(includeItems&&rest[0]==='items')return structuredClone(value);
  if(rest[0]==='params')return rest.length===1?{clientUserMessageId:value?.clientUserMessageId??null}:rest[1]==='clientUserMessageId'?value:SKIP;
  return SKIP;
}
export function applyMetadataPatches(state,patches,{includeItems=false}={}){
  requireValue(Array.isArray(patches)&&patches.length<=10000,'CODEX_DESKTOP_STATE_LIMIT');
  for(const patch of patches){
    const parts=patch.path;requireValue(Array.isArray(parts)&&parts.length<=64&&parts.every(part=>(typeof part==='string'||Number.isSafeInteger(part))&&!['__proto__','prototype','constructor'].includes(part))&&['add','replace','remove'].includes(patch.op),'CODEX_DESKTOP_PATCH_INVALID');
    // Determine relevance independently of the value so a remove never needs
    // the removed transcript or an invented replacement object.
    let value;
    if(patch.op==='remove'){
      const relevant=parts.length===0||['id','cwd','threadRuntimeStatus','resumeState'].includes(parts[0])||parts[0]==='unconfirmedTurnSubmissions'&&(parts.length<=2||parts.length===3&&parts[2]==='terminal')||parts[0]==='turns'&&(parts.length<=2||['status','turnId'].includes(parts[2])||parts[2]==='params'&&(parts.length===3||parts[3]==='clientUserMessageId'))||parts[0]==='turnHistory'&&(parts.length<=2||parts[2]==='islands'||parts[2]==='entitiesByKey'&&(parts.length<=4||['status','turnId'].includes(parts[4])||parts[4]==='params'&&(parts.length===5||parts[5]==='clientUserMessageId')));
      const itemPath=includeItems&&(parts[0]==='turns'&&parts[2]==='items'||parts[0]==='turnHistory'&&parts[2]==='entitiesByKey'&&parts[4]==='items');
      if(!relevant&&!itemPath)continue;
    }else{value=projectPatch(parts,patch.value,includeItems);if(value===SKIP)continue;}
    if(parts.length===0){requireValue(patch.op!=='remove','CODEX_DESKTOP_PATCH_INVALID');state=value;continue;}
    let parent=state;for(const part of parts.slice(0,-1)){requireValue(object(parent)||Array.isArray(parent),'CODEX_DESKTOP_PATCH_INVALID');requireValue(Object.hasOwn(parent,part),'CODEX_DESKTOP_PATCH_INVALID');parent=parent[part];}
    const key=parts.at(-1);requireValue(object(parent)||Array.isArray(parent),'CODEX_DESKTOP_PATCH_INVALID');
    if(Array.isArray(parent)){
      requireValue(Number.isSafeInteger(key)&&key>=0&&key<=(patch.op==='add'?parent.length:parent.length-1),'CODEX_DESKTOP_PATCH_INVALID');
      if(patch.op==='add')parent.splice(key,0,value);else if(patch.op==='remove')parent.splice(key,1);else parent[key]=value;
    }else{if(patch.op!=='add')requireValue(Object.hasOwn(parent,key),'CODEX_DESKTOP_PATCH_INVALID');if(patch.op==='remove')delete parent[key];else parent[key]=value;}
  }
  return state;
}
export function summarizeState(state,conversationId){
  requireValue(object(state)&&state.id===conversationId,'CODEX_DESKTOP_SESSION_MISMATCH');
  const turns=turnsOf(state);requireValue(turns.length<=10000,'CODEX_DESKTOP_STATE_LIMIT');
  const running=turns.filter(turn=>turn?.status==='inProgress');
  requireValue(running.length<=1,'CODEX_DESKTOP_STATE_UNCERTAIN');
  const active=running[0]??null,latest=turns.at(-1)??null;
  // Even terminal-marked unconfirmed submissions remain fenced by the native
  // owner's O_(state) until reconciliation removes them. A resuming owner is
  // also not idle merely because its first turn has not appeared yet.
  return {conversationId,busy:active!==null||state.threadRuntimeStatus?.type==='active'||state.resumeState==='resuming'||(state.unconfirmedTurnSubmissions?.length??0)>0,activeTurnId:active?.turnId??null,
    latestTurnId:latest?.turnId??null,latestStatus:latest?.status??null,
    // Metadata only; transcript and user inputs are never returned by status.
    workspace:state.cwd??null,loadedTurns:turns.length};
}

// Pure receipt validation for a future verified idle-only admission endpoint.
// It does not enable delivery. A transport success without a native turn is
// still an unknown outcome, never proof that a user message was accepted.
export function validateStartReceipt(reply){
  const turn=reply?.result?.result?.turn;
  if(!object(turn)||typeof turn.id!=='string'||!turn.id.trim()||turn.id.length>160||!['inProgress','completed','failed','interrupted'].includes(turn.status))throw new DesktopError('CODEX_DESKTOP_START_RECEIPT_INVALID',{outcomeUnknown:true});
  return{turnId:turn.id,status:turn.status};
}

const CAPABILITIES=Object.freeze({atomic_idle_start:false,exact_turn_interrupt:true});

export class CodexDesktopSession {
  #channel;#owner;#snapshotPromise=null;#state=null;#stateError=null;#revision=-1;#unlisten=null;#snapshotReject=null;#snapshotTimer=null;
  #shared;
  constructor(channel,conversationId,{sharedConversation=false}={}){requireValue(uuid(conversationId),'CODEX_DESKTOP_SESSION_INVALID');this.#channel=channel;this.conversationId=conversationId;this.#shared=sharedConversation;}
  get capabilities(){return this.#shared?{...CAPABILITIES,shared_conversation_input:true,final_result_evidence:true}:CAPABILITIES;}
  lifecycle(){return{closed:this.#stateError!==null,reason:this.#stateError};}
  static async connect(conversationId,{socketPath=path.join(os.homedir(),'.codex/ipc/ipc.sock'),asar,timeoutMs=5000,sharedConversation=false}={}){
    verifyDesktopBuild(asar);const channel=await new DesktopChannel(socketPath,{timeoutMs}).connect();
    try{return await new CodexDesktopSession(channel,conversationId,{sharedConversation}).attach();}catch(error){channel.close();throw error;}
  }
  async attach(){
    const reply=await this.#channel.request('thread-owner-discovery',{hostId:'local',conversationId:this.conversationId});
    requireValue(uuid(reply.handledByClientId)&&reply.result.supportsUntrustedAppInput===true,'CODEX_DESKTOP_OWNER_UNSUPPORTED');this.#owner=reply.handledByClientId;
    const settings=await this.#channel.request('thread-follower-read-model-settings',{conversationId:this.conversationId},{targetClientId:this.#owner});
    requireValue(object(settings.result.settings),'CODEX_DESKTOP_SESSION_UNAVAILABLE');return this;
  }
  snapshot(){
    if(this.#stateError)throw new DesktopError(this.#stateError);
    if(this.#state)return Promise.resolve(this.#state);
    if(this.#snapshotPromise)return this.#snapshotPromise;
    requireValue(uuid(this.#owner),'CODEX_DESKTOP_NOT_ATTACHED');
    this.#snapshotPromise=new Promise((resolve,reject)=>{
      this.#snapshotReject=reject;
      this.#snapshotTimer=setTimeout(()=>{this.#invalidate('CODEX_DESKTOP_STATE_TIMEOUT');},this.#channel.timeoutMs);
      this.#unlisten=this.#channel.listen(frame=>{
        if(frame.type==='closed'){this.#invalidate(frame.code);return;}
        if(frame.type!=='broadcast'||frame.sourceClientId!==this.#owner)return;
        if(frame.method!=='thread-stream-state-changed')return;
        const p=frame.params;if(p?.hostId!=='local'||p.conversationId!==this.conversationId)return;
        try{
          requireValue(frame.version===PROFILE.versions[frame.method],'CODEX_DESKTOP_STATE_UNSUPPORTED');
          const change=p.change;requireValue(Number.isSafeInteger(change?.revision)&&change.revision>=0,'CODEX_DESKTOP_PATCH_INVALID');
          if(change.type==='snapshot'){
            requireValue(change.revision>=this.#revision,'CODEX_DESKTOP_STATE_GAP');
            const projected=projectState(change.conversationState,this.#shared);summarizeState(projected,this.conversationId);this.#state=projected;
          }else if(change.type==='patches'){
            requireValue(this.#state&&change.baseRevision===this.#revision&&change.revision>this.#revision,'CODEX_DESKTOP_STATE_GAP');
            this.#state=applyMetadataPatches(this.#state,change.patches,{includeItems:this.#shared});summarizeState(this.#state,this.conversationId);
          }else throw new DesktopError('CODEX_DESKTOP_STATE_UNSUPPORTED');
          this.#revision=change.revision;clearTimeout(this.#snapshotTimer);this.#snapshotReject=null;resolve(this.#state);
        }catch(error){this.#invalidate(error instanceof DesktopError?error.code:'CODEX_DESKTOP_PATCH_INVALID');}
      });
      try{this.#channel.broadcast('thread-stream-following-changed',{hostId:'local',conversationId:this.conversationId,following:true},this.#owner);}catch(error){this.#invalidate(error.code??'CODEX_DESKTOP_DISCONNECTED');}
    });return this.#snapshotPromise;
  }
  #invalidate(code){this.#stateError=code;this.#state=null;clearTimeout(this.#snapshotTimer);this.#snapshotReject?.(new DesktopError(code));this.#snapshotReject=null;this.#unlisten?.();this.#unlisten=null;}
  async status(){
    await this.snapshot();
    // A live response from the pinned owner plus an uninterrupted revision
    // stream is required; a disconnected cached status is never actionable.
    await this.#channel.request('thread-follower-read-model-settings',{conversationId:this.conversationId},{targetClientId:this.#owner});
    if(this.#stateError)throw new DesktopError(this.#stateError);return summarizeState(this.#state,this.conversationId);
  }
  async start({text,clientUserMessageId,additionalContext}){
    requireValue(typeof text==='string'&&text.trim()&&Buffer.byteLength(text)<=32768&&uuid(clientUserMessageId),'CODEX_DESKTOP_INPUT_INVALID');
    requireValue(this.#shared,'CODEX_DESKTOP_IDLE_ADMISSION_UNVERIFIED');
    const current=await this.status();if(current.busy)throw new DesktopError('CODEX_DESKTOP_BUSY');
    // Normal delivery waits for idle. If desktop input wins admission after
    // this check, let the native owner's shared-message admission associate
    // this input with that same conversation; never start another model owner.
    const reply=await this.#channel.request('thread-follower-start-turn',{conversationId:this.conversationId,turnStart:{
      request:{threadId:this.conversationId,input:[{type:'text',text,text_elements:[]}],clientUserMessageId,...(additionalContext?{additionalContext}:{})},
      context:{clientUserMessageId,inheritThreadSettings:true}
    }},{targetClientId:this.#owner,mutation:true});
    return{accepted:true,clientUserMessageId,...validateStartReceipt(reply)};
  }
  async settings(){const reply=await this.#channel.request('thread-follower-read-model-settings',{conversationId:this.conversationId},{targetClientId:this.#owner});return reply.result.settings;}
  async interrupt(expectedTurnId){
    requireValue(typeof expectedTurnId==='string'&&expectedTurnId.length>0&&expectedTurnId.length<=160,'CODEX_DESKTOP_TURN_INVALID');
    const current=await this.status();if(current.activeTurnId!==expectedTurnId)return{requested:false,expectedTurnId,reason:'turn_no_longer_active'};
    const reply=await this.#channel.request('thread-follower-interrupt-turn',{conversationId:this.conversationId,mode:'user-stop',expectedTurnId},{targetClientId:this.#owner,mutation:true});
    if(reply.result.ok!==true||![null,expectedTurnId].includes(reply.result.interruptedTurnId))throw new DesktopError('CODEX_DESKTOP_INTERRUPT_RECEIPT_INVALID',{outcomeUnknown:true});
    return {requested:reply.result.interruptedTurnId===expectedTurnId,expectedTurnId,confirmedStopped:false,goalPauseFailed:typeof reply.result.goalPauseError==='string'};
  }
  async inspectOperation(clientUserMessageId){
    requireValue(uuid(clientUserMessageId),'CODEX_DESKTOP_INPUT_INVALID');await this.status();const state=await this.snapshot();
    const matches=turnsOf(state).filter(turn=>turn?.params?.clientUserMessageId===clientUserMessageId||this.#shared&&turn.items.some(item=>item.type==='steeringUserMessage'&&item.clientUserMessageId===clientUserMessageId||item.type==='userMessage'&&item.clientId===clientUserMessageId));
    requireValue(matches.length<=1,'CODEX_DESKTOP_OPERATION_AMBIGUOUS');
    if(!matches.length)return{found:false,outcomeUnknown:true};
    const turn=matches[0],result={found:true,turnId:turn.turnId??null,status:turn.status??null};
    if(this.#shared&&turn.status==='completed'){
      const messages=turn.items.filter(item=>item.type==='agentMessage'&&item.phase==='final_answer'&&typeof item.text==='string');
      if(messages.length){const text=messages.map(item=>item.text).join('\n\n');requireValue(Buffer.byteLength(text)<=1024*1024,'CODEX_DESKTOP_RESULT_LIMIT');return{...result,resultComplete:true,result:{type:'text',text}};}
    }
    return result;
  }
  close(){try{if(this.#owner)this.#channel.broadcast('thread-stream-following-changed',{hostId:'local',conversationId:this.conversationId,following:false},this.#owner);}catch{}this.#invalidate('CODEX_DESKTOP_DISCONNECTED');this.#channel.close();}
}
