import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {createHash,randomUUID} from 'node:crypto';
import {CodexAppServerChannel,CodexAppServerSession} from '../hosts/codex-app-server.mjs';

// This local protocol peer is a fixture, not Codex/model E2E evidence. Shapes
// follow the installed CLI's generated experimental v2 schema. In particular,
// userMessage.clientId carries the submitted clientUserMessageId, and only an
// explicit final_answer can become SessionControl's {type:'text',text} result.
function frame(data,{opcode=1,fin=true}={}){
  const bytes=Buffer.isBuffer(data)?data:Buffer.from(typeof data==='string'?data:JSON.stringify(data));
  const extra=bytes.length<126?0:bytes.length<=65535?2:8,head=Buffer.alloc(2+extra);
  head[0]=(fin?128:0)|opcode;head[1]=extra===0?bytes.length:extra===2?126:127;
  if(extra===2)head.writeUInt16BE(bytes.length,2);if(extra===8)head.writeBigUInt64BE(BigInt(bytes.length),2);
  return Buffer.concat([head,bytes]);
}
async function fixture(t,{transport='unix',timeoutMs=300}={}){
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'cas-'));fs.chmodSync(directory,0o700);
  const threadId=randomUUID(),calls=[],sockets=new Set(),channels=[];
  const f={directory,threadId,calls,loaded:true,status:'idle',canAcceptDirectInput:true,turns:[],items:[],queue:[],terminals:[],overrides:new Map(),socket:null,
    input(text='Synthetic operation'){return{text,clientUserMessageId:randomUUID(),expiresAt:new Date(Date.now()+60000).toISOString()};},
    addTurn(input,{status='completed',turnId=randomUUID(),final='Synthetic final answer',phase='final_answer'}={}){
      this.turns.unshift({id:turnId,status,items:[],itemsView:'notLoaded'});
      this.items.push({turnId,item:{type:'userMessage',id:randomUUID(),clientId:input.clientUserMessageId,content:[{type:'text',text:input.text,text_elements:[]}]}});
      if(final!==null)this.items.push({turnId,item:{type:'agentMessage',id:randomUUID(),text:final,phase}});
      this.queue=this.queue.filter(q=>q.clientUserMessageId!==input.clientUserMessageId);return turnId;
    },
    async dispatch(message){
      calls.push(message);if(!Object.hasOwn(message,'id'))return;
      if(this.overrides.has(message.method))return this.overrides.get(message.method)(message);
      const p=message.params;
      if(p?.threadId)assert.equal(p.threadId,threadId);
      switch(message.method){
        case'initialize':return{userAgent:'synthetic-codex/0.163',platformFamily:'unix',platformOs:'macos',codexHome:directory};
        case'thread/loaded/list':return{data:this.loaded?[threadId]:[],nextCursor:null};
        case'thread/read':return{thread:{id:threadId,cwd:this.cwd??directory,status:{type:this.status},canAcceptDirectInput:this.canAcceptDirectInput,ephemeral:false,parentThreadId:null,preview:this.preview??'',turns:p.includeTurns?this.turns.map(t=>({...t,itemsView:'full',items:this.items.filter(e=>e.turnId===t.id).map(e=>e.item)})):[]}};
        case'thread/turns/list':return{data:this.turns,nextCursor:null};
        case'thread/items/list':return{data:this.items.filter(e=>!p.turnId||e.turnId===p.turnId),nextCursor:null};
        case'thread/queue/list':return{data:this.queue,nextCursor:null};
        case'thread/queue/add':{const entry={id:randomUUID(),clientUserMessageId:p.clientUserMessageId,input:p.input};this.queue.push(entry);return{queuedSubmission:entry};}
        case'thread/queue/start':{const selected=this.queue.find(q=>q.id===p.queuedSubmissionId);assert(selected);const turnId=this.addTurn({clientUserMessageId:selected.clientUserMessageId,text:selected.input[0].text},{status:'inProgress',final:null});this.status='active';return{turn:this.turns.find(t=>t.id===turnId)};}
        case'thread/backgroundTerminals/list':return{data:this.terminals,nextCursor:null};
        case'thread/backgroundTerminals/terminate':{const index=this.terminals.findIndex(terminal=>terminal.processId===p.processId);if(index<0)return{terminated:false};this.terminals.splice(index,1);return{terminated:true};}
        case'turn/interrupt':return{};
        default:throw new Error('Unexpected mutating or unsupported method '+message.method);
      }
    }
  };
  const server=http.createServer((req,res)=>res.writeHead(400).end());
  server.on('upgrade',(req,socket,head)=>{
    assert.equal(req.headers['sec-websocket-version'],'13');sockets.add(socket);f.socket=socket;f.upgradePath=req.url;
    socket.on('close',()=>sockets.delete(socket));socket.on('error',()=>{});
    const accept=createHash('sha1').update(req.headers['sec-websocket-key']+'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
    socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: '+accept+'\r\n\r\n');
    let buffer=head;
    const ingest=chunk=>{
      buffer=Buffer.concat([buffer,chunk]);
      while(buffer.length>=2){
        let length=buffer[1]&127,at=2;
        assert(buffer[1]&128,'client frames must be masked');
        if(length===126){if(buffer.length<4)return;length=buffer.readUInt16BE(2);at=4;}
        if(length===127){if(buffer.length<10)return;length=Number(buffer.readBigUInt64BE(2));at=10;}
        if(buffer.length<at+4+length)return;
        const opcode=buffer[0]&15,mask=buffer.subarray(at,at+4),body=Buffer.from(buffer.subarray(at+4,at+4+length));buffer=buffer.subarray(at+4+length);
        for(let i=0;i<body.length;i++)body[i]^=mask[i%4];if(opcode!==1)continue;
        const message=JSON.parse(body.toString());
        void f.dispatch(message).then(result=>{if(result!==undefined&&!socket.destroyed)socket.write(frame({id:message.id,result}));}).catch(error=>{f.peerError=error;if(!socket.destroyed)socket.write(frame({id:message.id,error:{code:-32603,message:'synthetic failure'}}));});
      }
    };
    socket.on('data',ingest);if(head.length)ingest(Buffer.alloc(0));
  });
  await new Promise(resolve=>transport==='unix'?server.listen(path.join(directory,'s'),resolve):server.listen(0,'127.0.0.1',resolve));
  f.endpoint=transport==='unix'?'unix://'+path.join(directory,'s'):`ws://127.0.0.1:${server.address().port}`;
  f.connect=async()=>{const channel=await new CodexAppServerChannel(f.endpoint,{timeoutMs}).connect();channels.push(channel);return channel;};
  f.session=async()=>new CodexAppServerSession(await f.connect(),threadId,{workspace:directory}).attach();
  t.after(async()=>{for(const c of channels)c.close();for(const s of sockets)s.destroy();await new Promise(resolve=>server.close(resolve));fs.rmSync(directory,{recursive:true,force:true});if(f.peerError)throw f.peerError;});
  return f;
}

test('connects a private Unix official endpoint and only reads the explicitly loaded thread',async t=>{
  const f=await fixture(t),session=await f.session(),status=await session.status();
  assert.equal(status.conversationId,f.threadId);assert.equal(status.busy,false);assert.equal(status.workspace,fs.realpathSync(f.directory));
  assert.deepEqual(session.capabilities,{atomic_idle_start:false,atomic_queue_append:true,atomic_queued_resume:true,native_queue_expiry:false,exact_turn_interrupt:true,exact_turn_child_stop:true,final_result_evidence:true});
  assert.deepEqual(f.calls[0].params.capabilities,{experimentalApi:true});assert.equal(f.calls[1].method,'initialized');
  assert(f.calls.every(m=>['initialize','initialized','thread/loaded/list','thread/read','thread/turns/list'].includes(m.method)));
});
test('transparent owner transport preserves RPC ids and relays approval only from the original owner',async t=>{
  const f=await fixture(t),channel=await new CodexAppServerChannel(f.endpoint,{transparent:true}).connect(),received=[];t.after(()=>channel.close());
  channel.listen(message=>received.push(message));assert.equal(f.calls.length,0);
  channel.sendWire({id:7,method:'initialize',params:{clientInfo:{name:'original-desktop',version:'1'}}});
  for(let n=0;n<50&&!received.some(m=>m.id===7);n++)await new Promise(r=>setTimeout(r,10));
  assert.equal(received.find(m=>m.id===7).result.platformFamily,'unix');assert.equal(f.calls[0].id,7);assert.equal(f.calls[0].params.clientInfo.name,'original-desktop');
  const nativeDispatch=f.dispatch.bind(f);let approval;
  f.dispatch=async m=>{if(m.id==='approval-1'&&!m.method){approval=m;return;}return nativeDispatch(m);};
  const request={id:'approval-1',method:'item/commandExecution/requestApproval',params:{threadId:f.threadId,turnId:'owned-turn',itemId:'owned-item'}};
  f.socket.write(frame(request));
  for(let n=0;n<50&&!received.some(m=>m.id==='approval-1');n++)await new Promise(r=>setTimeout(r,10));
  assert.deepEqual(received.find(m=>m.id==='approval-1'),request);assert.equal(approval,undefined);
  const ownerReply={id:'approval-1',result:{decision:'decline'}};channel.sendWire(ownerReply);
  for(let n=0;n<50&&!approval;n++)await new Promise(r=>setTimeout(r,10));assert.deepEqual(approval,ownerReply);
});

test('metadata-only connect and readiness never query turns, items, queues or dialogue history',async t=>{
  const f=await fixture(t);f.preview='Private conversation preview';
  const session=await CodexAppServerSession.connect(f.threadId,{endpoint:f.endpoint,workspace:f.directory,metadataOnly:true});
  t.after(()=>session.close());
  let status=await session.readiness();assert.equal(status.busy,false);assert.equal(status.canExecute,true);
  f.status='active';status=await session.readiness();assert.equal(status.busy,true);assert.equal(status.canExecute,true);
  f.status='systemError';status=await session.readiness();assert.equal(status.busy,null);assert.equal(status.canExecute,false);assert.equal(status.reason,'CODEX_APP_SERVER_SYSTEM_ERROR');
  assert(!JSON.stringify(status).includes('Private conversation'));
  assert(f.calls.every(m=>['initialize','initialized','thread/loaded/list','thread/read'].includes(m.method)));
  assert(f.calls.filter(m=>m.method==='thread/read').every(m=>m.params.includeTurns===false));
  f.loaded=false;await assert.rejects(session.readiness(),{code:'CODEX_APP_SERVER_THREAD_NOT_LOADED'});
  f.loaded=true;f.cwd='/different';await assert.rejects(session.readiness(),{code:'CODEX_APP_SERVER_WORKSPACE_MISMATCH'});
  f.cwd=f.directory;f.canAcceptDirectInput=false;await assert.rejects(session.readiness(),{code:'CODEX_APP_SERVER_THREAD_UNSUPPORTED'});
});

test('metadata-only attachment retains normal execution checks when a later task is explicitly dispatched',async t=>{
  const f=await fixture(t),session=await CodexAppServerSession.connect(f.threadId,{endpoint:f.endpoint,workspace:f.directory,metadataOnly:true});
  t.after(()=>session.close());
  const input=f.input();
  const [metadata,status,receipt]=await Promise.all([session.readiness(),session.status(),session.start(input)]);
  assert.equal(metadata.canExecute,true);assert.equal(status.busy,false);assert.equal(receipt.accepted,true);
  assert.equal(f.calls.filter(m=>m.method==='thread/queue/add').length,1);
  assert(f.calls.some(m=>m.method==='thread/turns/list'),'execution retains the original status/history fence');
  assert.equal((await session.inspectOperation(input.clientUserMessageId)).status,'queued');
  assert(!f.calls.some(m=>['thread/start','thread/resume','turn/start'].includes(m.method)));
});

test('busy input appends atomically to the native queue with the original stable ID, never turn/start',async t=>{
  const f=await fixture(t),session=await f.session(),input=f.input();f.status='active';f.turns=[{id:randomUUID(),status:'inProgress',items:[]}];
  const receipt=await session.start(input);assert.equal(receipt.accepted,true);assert.equal(receipt.clientUserMessageId,input.clientUserMessageId);
  assert.deepEqual(await session.start(input),receipt);assert.equal(f.calls.filter(m=>m.method==='thread/queue/add').length,1);
  const submitted=f.calls.find(m=>m.method==='thread/queue/add');assert.deepEqual(Object.keys(submitted.params).sort(),['clientUserMessageId','input','threadId']);
  const observed=await session.inspectOperation(input.clientUserMessageId);assert.equal(observed.found,true);assert.equal(observed.status,'queued');assert.equal(observed.turnId,null);
  await assert.rejects(session.start({...input,text:'conflicting text'}),{code:'CODEX_APP_SERVER_INPUT_CONFLICT'});
  assert(!f.calls.some(m=>['turn/start','thread/resume','thread/settings/update'].includes(m.method)));
});

test('concurrent duplicate starts cannot pass the preflight await twice',async t=>{
  const f=await fixture(t),session=await f.session(),input=f.input();let release;
  f.overrides.set('thread/read',()=>new Promise(resolve=>{release=()=>resolve({thread:{id:f.threadId,cwd:f.directory,status:{type:'idle'},canAcceptDirectInput:true,ephemeral:false}});}));
  const first=session.start(input);await assert.rejects(session.start(input),{code:'CODEX_APP_SERVER_INPUT_IN_FLIGHT'});
  while(!release)await new Promise(resolve=>setImmediate(resolve));release();await first;
  assert.equal(f.calls.filter(m=>m.method==='thread/queue/add').length,1);
});

test('unknown native receipt is never blindly resent and can reconcile by stable history identity',async t=>{
  const f=await fixture(t,{timeoutMs:60}),session=await f.session(),input=f.input();
  f.overrides.set('thread/queue/add',()=>undefined);
  await assert.rejects(session.start(input),{code:'CODEX_APP_SERVER_REPLY_TIMEOUT',outcomeUnknown:true});
  await assert.rejects(session.start(input),{code:'CODEX_APP_SERVER_OUTCOME_UNKNOWN',outcomeUnknown:true});
  f.addTurn(input);const recovered=await session.start(input);assert.equal(recovered.reconciled,true);
  assert.equal(f.calls.filter(m=>m.method==='thread/queue/add').length,1);
});

test('queue receipt must echo exact client ID and exact input; malformed success remains ambiguous',async t=>{
  const f=await fixture(t),session=await f.session(),input=f.input();
  f.overrides.set('thread/queue/add',()=>({queuedSubmission:{id:randomUUID(),clientUserMessageId:randomUUID(),input:[{type:'text',text:input.text}]}}));
  await assert.rejects(session.start(input),{code:'CODEX_APP_SERVER_QUEUE_RECEIPT_INVALID',outcomeUnknown:true});
  await assert.rejects(session.start(input),{code:'CODEX_APP_SERVER_OUTCOME_UNKNOWN'});assert.equal(f.calls.filter(m=>m.method==='thread/queue/add').length,1);
});

test('unloaded, mismatched workspace and direct-input-disabled threads cannot be adopted or mutated',async t=>{
  const f=await fixture(t),channel=await f.connect();f.loaded=false;
  await assert.rejects(new CodexAppServerSession(channel,f.threadId,{workspace:f.directory}).attach(),{code:'CODEX_APP_SERVER_THREAD_NOT_LOADED'});
  f.loaded=true;f.cwd='/different';await assert.rejects(new CodexAppServerSession(channel,f.threadId,{workspace:f.directory}).attach(),{code:'CODEX_APP_SERVER_WORKSPACE_MISMATCH'});
  f.cwd=f.directory;f.canAcceptDirectInput=false;await assert.rejects(new CodexAppServerSession(channel,f.threadId,{workspace:f.directory}).attach(),{code:'CODEX_APP_SERVER_THREAD_UNSUPPORTED'});
  assert(!f.calls.some(m=>['thread/start','thread/resume','thread/queue/add'].includes(m.method)));
});

test('expired input is not queued and preflight expiry is rechecked',async t=>{
  const f=await fixture(t),session=await f.session();await assert.rejects(session.start({...f.input(),expiresAt:'2000-01-01T00:00:00.000Z'}),{code:'CODEX_APP_SERVER_INPUT_EXPIRED'});
  f.overrides.set('thread/read',async()=>{await new Promise(resolve=>setTimeout(resolve,50));return{thread:{id:f.threadId,cwd:f.directory,status:{type:'idle'},canAcceptDirectInput:true,ephemeral:false}};});
  await assert.rejects(session.start({...f.input(),expiresAt:new Date(Date.now()+20).toISOString()}),{code:'CODEX_APP_SERVER_INPUT_EXPIRED'});
  assert(!f.calls.some(m=>m.method==='thread/queue/add'));
});

test('final result comes only from the exact operation turn explicit final_answer after terminal completion',async t=>{
  const f=await fixture(t),session=await f.session(),input=f.input();
  f.addTurn(f.input('another task'),{final:'Other task answer'});
  const turnId=f.addTurn(input,{status:'inProgress',final:'Correct final'});
  f.items.push({turnId,item:{id:randomUUID(),type:'agentMessage',text:'Commentary must not leak',phase:'commentary'}},{turnId,item:{id:randomUUID(),type:'agentMessage',text:'Null phase must not leak',phase:null}},{turnId,item:{id:randomUUID(),type:'commandExecution',aggregatedOutput:'Tool output must not leak'}});
  assert.equal((await session.inspectOperation(input.clientUserMessageId)).result,undefined);
  f.turns.find(t=>t.id===turnId).status='completed';const result=await session.inspectOperation(input.clientUserMessageId);
  assert.deepEqual(result.result,{type:'text',text:'Correct final'});assert.equal(result.turnId,turnId);assert.equal(result.resultEvidence.phase,'final_answer');assert.equal(result.resultComplete,true);
  f.items=f.items.filter(e=>e.item.phase!=='final_answer'||e.turnId!==turnId);
  const pending=await session.inspectOperation(input.clientUserMessageId);assert.equal(pending.result,undefined);assert.equal(pending.resultComplete,false);
});

test('same text is never used as receipt evidence and multiple native turns for one ID fail closed',async t=>{
  const f=await fixture(t),session=await f.session(),input=f.input();f.addTurn(f.input(input.text));
  assert.deepEqual(await session.inspectOperation(input.clientUserMessageId),{found:false,outcomeUnknown:true});
  f.addTurn(input);f.addTurn(input);await assert.rejects(session.inspectOperation(input.clientUserMessageId),{code:'CODEX_APP_SERVER_OPERATION_AMBIGUOUS'});
});

test('native pagination is followed, but cursor loops and malformed history never become idle proof',async t=>{
  const f=await fixture(t),session=await f.session(),input=f.input(),turnId=f.addTurn(input);
  f.overrides.set('thread/items/list',message=>message.params.cursor?{data:f.items,nextCursor:null}:{data:[],nextCursor:'second'});
  assert.equal((await session.inspectOperation(input.clientUserMessageId)).turnId,turnId);
  assert(f.calls.some(m=>m.method==='thread/items/list'&&m.params.cursor==='second'));
  f.overrides.set('thread/turns/list',()=>({data:[],nextCursor:'repeat'}));
  await assert.rejects(session.status(),{code:'CODEX_APP_SERVER_CURSOR_LOOP'});
});

test('exact-turn interrupt never stops a replacement and receipt alone proves no descendant shutdown',async t=>{
  const f=await fixture(t),session=await f.session(),turnId=f.addTurn(f.input(),{status:'inProgress'});f.status='active';
  const stale=await session.interrupt('old-turn');assert.equal(stale.requested,false);assert(!f.calls.some(m=>m.method==='turn/interrupt'));
  const receipt=await session.interrupt(turnId);assert.deepEqual(receipt,{requested:true,expectedTurnId:turnId,confirmedStopped:false});
  await session.interrupt(turnId);assert.equal(f.calls.filter(m=>m.method==='turn/interrupt').length,1);
  assert.equal((await session.inspectStop(turnId)).terminal,false);f.turns[0].status='interrupted';f.status='idle';
  const proof=await session.inspectStop(turnId);assert.equal(proof.terminal,true);assert.equal(proof.descendantsStopped,false);
});

test('lost interrupt receipt is not resent',async t=>{
  const f=await fixture(t,{timeoutMs:60}),session=await f.session(),turnId=f.addTurn(f.input(),{status:'inProgress'});f.status='active';
  f.overrides.set('turn/interrupt',()=>undefined);
  await assert.rejects(session.interrupt(turnId),{code:'CODEX_APP_SERVER_REPLY_TIMEOUT',outcomeUnknown:true});
  await assert.rejects(session.interrupt(turnId),{code:'CODEX_APP_SERVER_INTERRUPT_OUTCOME_UNKNOWN'});
  assert.equal(f.calls.filter(m=>m.method==='turn/interrupt').length,1);
});

test('loopback transport handles fragmented responses, ping and unrelated server approvals without answering them',async t=>{
  const f=await fixture(t,{transport:'tcp'}),channel=await f.connect();let receive;
  const notification=new Promise(resolve=>{receive=resolve;});
  channel.listen(message=>{if(message.method==='item/commandExecution/requestApproval')receive(message);});
  f.overrides.set('synthetic/fragment',message=>{
    const bytes=Buffer.from(JSON.stringify({id:message.id,result:{text:'分片成功'}})),at=bytes.length-4;
    f.socket.write(frame(bytes.subarray(0,at),{fin:false}));f.socket.write(frame('ping',{opcode:9}));f.socket.write(frame(bytes.subarray(at),{opcode:0}));
    f.socket.write(frame({id:'native-approval',method:'item/commandExecution/requestApproval',params:{threadId:randomUUID()}}));return undefined;
  });
  assert.deepEqual(await channel.request('synthetic/fragment'),{text:'分片成功'});
  // Approval is a later TCP frame, not necessarily the next event-loop tick.
  let timer;try{
    const received=await Promise.race([notification,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('native approval notification timed out')),300);})]);
    assert.equal(received.id,'native-approval');
  }finally{clearTimeout(timer);}
  assert(!f.calls.some(m=>m.id==='native-approval'));
});

test('nonlocal endpoint, credentials in URL and public Unix parent are rejected before connection',async t=>{
  assert.throws(()=>new CodexAppServerChannel('ws://192.0.2.1:8000'),{code:'CODEX_APP_SERVER_ENDPOINT_INVALID'});
  assert.throws(()=>new CodexAppServerChannel('ws://user:secret@127.0.0.1:8000'),{code:'CODEX_APP_SERVER_ENDPOINT_INVALID'});
  const f=await fixture(t);fs.chmodSync(f.directory,0o755);
  assert.throws(()=>new CodexAppServerChannel(f.endpoint),{code:'CODEX_APP_SERVER_SOCKET_UNTRUSTED'});fs.chmodSync(f.directory,0o700);
});

test('transport disconnect after a write marks it unknown and never reconnects implicitly',async t=>{
  const f=await fixture(t),channel=await f.connect();f.overrides.set('synthetic/disconnect',()=>{f.socket.destroy();return undefined;});
  await assert.rejects(channel.request('synthetic/disconnect',{}, {mutation:true}),{code:'CODEX_APP_SERVER_DISCONNECTED',outcomeUnknown:true});
  assert.throws(()=>channel.request('thread/read',{}),{code:'CODEX_APP_SERVER_DISCONNECTED'});assert.equal(f.calls.filter(m=>m.method==='initialize').length,1);
});

test('exact native not-materialized error permits a verified fresh idle thread, never generic errors',async t=>{
  const f=await fixture(t);let errorThread=f.threadId,errorMessage=null;
  const unavailable=message=>{f.socket.write(frame({id:message.id,error:{code:-32600,message:errorMessage??`thread ${errorThread} is not materialized yet; ${message.method} is unavailable before first user message`}}));return undefined;};
  f.overrides.set('thread/turns/list',unavailable);f.overrides.set('thread/items/list',unavailable);
  const session=await f.session();assert.equal((await session.status()).busy,false);
  assert.deepEqual(await session.inspectOperation(randomUUID()),{found:false,outcomeUnknown:true});
  errorThread=randomUUID();await assert.rejects(session.status(),{code:'CODEX_APP_SERVER_RPC_ERROR'});
  errorThread=f.threadId;errorMessage='generic invalid request';await assert.rejects(session.status(),{code:'CODEX_APP_SERVER_RPC_ERROR'});
  errorMessage=null;f.status='active';await assert.rejects(session.status(),{code:'CODEX_APP_SERVER_RPC_ERROR'});
  f.status='idle';f.preview='existing history';await assert.rejects(session.status(),{code:'CODEX_APP_SERVER_RPC_ERROR'});
  assert(!f.calls.some(m=>m.method==='thread/resume'||m.method==='turn/start'));
});

test('a disappearing materialized history never turns into a fresh empty thread',async t=>{
  const f=await fixture(t);f.addTurn(f.input());const session=await f.session();
  f.overrides.set('thread/turns/list',message=>{f.socket.write(frame({id:message.id,error:{code:-32600,message:`thread ${f.threadId} is not materialized yet; thread/turns/list is unavailable before first user message`}}));return undefined;});
  await assert.rejects(session.status(),{code:'CODEX_APP_SERVER_RPC_ERROR',nativeReason:'thread_not_materialized'});
});

test('native diagnostic text is opt-in and never attached to a public error',async t=>{
  const f=await fixture(t);let diagnostic;
  const channel=await new CodexAppServerChannel(f.endpoint,{onDiagnostic:value=>diagnostic=value}).connect();t.after(()=>channel.close());
  f.overrides.set('synthetic/error',message=>{f.socket.write(frame({id:message.id,error:{code:-32600,message:'synthetic private path /do/not/log'}}));return undefined;});
  await assert.rejects(channel.request('synthetic/error'),error=>error.code==='CODEX_APP_SERVER_RPC_ERROR'&&error.nativeCode===-32600&&!JSON.stringify(error).includes('/do/not/log'));
  assert.deepEqual(diagnostic,{method:'synthetic/error',nativeCode:-32600,nativeMessage:'synthetic private path /do/not/log'});
});

test('precisely unsupported item pagination falls back to bounded exact-thread includeTurns history',async t=>{
  const f=await fixture(t),session=await f.session(),input=f.input(),turnId=f.addTurn(input,{final:'Legacy wire, explicit final phase'});
  f.overrides.set('thread/items/list',message=>{f.socket.write(frame({id:message.id,error:{code:-32601,message:'thread/items/list is not supported yet'}}));return undefined;});
  const found=await session.inspectOperation(input.clientUserMessageId);assert.equal(found.turnId,turnId);assert.deepEqual(found.result,{type:'text',text:'Legacy wire, explicit final phase'});
  await session.inspectOperation(input.clientUserMessageId);assert.equal(f.calls.filter(m=>m.method==='thread/items/list').length,1);
  assert(f.calls.some(m=>m.method==='thread/read'&&m.params.includeTurns===true));
  assert(!f.calls.some(m=>m.method==='thread/resume'));
});

test('generic missing-method failure does not silently switch history contracts',async t=>{
  const f=await fixture(t),session=await f.session();
  f.overrides.set('thread/items/list',message=>{f.socket.write(frame({id:message.id,error:{code:-32601,message:'unknown method'}}));return undefined;});
  await assert.rejects(session.inspectOperation(randomUUID()),{code:'CODEX_APP_SERVER_RPC_ERROR'});
  assert(!f.calls.some(m=>m.method==='thread/read'&&m.params.includeTurns===true));
});

test('completion re-reads exact-turn items after the terminal observation before releasing a final result',async t=>{
  const f=await fixture(t),session=await f.session(),input=f.input(),turnId=f.addTurn(input,{status:'inProgress',final:null});
  f.overrides.set('thread/turns/list',()=>{
    f.turns[0].status='completed';
    if(!f.items.some(e=>e.item.phase==='final_answer'))f.items.push({turnId,item:{type:'agentMessage',id:randomUUID(),phase:'final_answer',text:'Final persisted after initial item read'}});
    return{data:f.turns,nextCursor:null};
  });
  const observed=await session.inspectOperation(input.clientUserMessageId);
  assert.equal(observed.resultComplete,true);assert.equal(observed.result.text,'Final persisted after initial item read');
  assert(f.calls.some(m=>m.method==='thread/items/list'&&m.params.turnId===turnId));
});

test('explicit empty final is complete evidence while an absent final remains pending',async t=>{
  const f=await fixture(t),session=await f.session(),input=f.input();f.addTurn(input,{final:''});
  const observed=await session.inspectOperation(input.clientUserMessageId);
  assert.equal(observed.resultComplete,true);assert.equal(observed.result,undefined);assert.equal(observed.resultEvidence.item_ids.length,1);
  f.items=f.items.filter(e=>e.item.phase!=='final_answer');const missing=await session.inspectOperation(input.clientUserMessageId);
  assert.equal(missing.resultComplete,false);assert.equal(missing.result,undefined);
});

test('startQueued selects only its own original queue ID and keeps its receipt idempotent',async t=>{
  const f=await fixture(t),session=await f.session(),input=f.input();
  const other={id:randomUUID(),clientUserMessageId:randomUUID(),input:[{type:'text',text:'Another owner queue head',text_elements:[]}]};f.queue.push(other);
  const added=await session.start(input),started=await session.startQueued(input.clientUserMessageId);
  assert.equal(started.requested,true);assert.equal(started.confirmedStarted,false);assert.equal(started.queueId,added.queueId);
  assert.deepEqual(await session.startQueued(input.clientUserMessageId),started);
  assert.deepEqual(f.calls.filter(m=>m.method==='thread/queue/start').map(m=>m.params),[{threadId:f.threadId,queuedSubmissionId:added.queueId}]);
  assert.deepEqual(f.queue,[other]);assert(!f.calls.some(m=>m.method==='turn/start'));
  assert.equal((await session.inspectOperation(input.clientUserMessageId)).turnId,started.turnId);
  await assert.rejects(session.startQueued(other.clientUserMessageId),{code:'CODEX_APP_SERVER_OPERATION_UNKNOWN'});
  await assert.rejects(session.startQueued('not-an-id'),{code:'CODEX_APP_SERVER_INPUT_INVALID'});
});

test('startQueued does not write while busy and refuses changed queue identity or input',async t=>{
  const f=await fixture(t),session=await f.session(),input=f.input(),added=await session.start(input);f.status='active';
  assert.equal((await session.startQueued(input.clientUserMessageId)).reason,'thread_busy');
  f.status='idle';f.queue[0].id=randomUUID();await assert.rejects(session.startQueued(input.clientUserMessageId),{code:'CODEX_APP_SERVER_QUEUE_CHANGED'});
  f.queue[0].id=added.queueId;f.queue[0].input[0].text='Changed input';await assert.rejects(session.startQueued(input.clientUserMessageId),{code:'CODEX_APP_SERVER_INPUT_CONFLICT'});
  f.queue[0].input[0].text=input.text;
  let reads=0;f.overrides.set('thread/queue/list',()=>({data:++reads===1?f.queue:[{...f.queue[0],id:randomUUID()}],nextCursor:null}));
  await assert.rejects(session.startQueued(input.clientUserMessageId),{code:'CODEX_APP_SERVER_QUEUE_CHANGED'});
  assert(!f.calls.some(m=>m.method==='thread/queue/start'));
});

test('startQueued unknown write is never resent, and only original-ID history reconciles it',async t=>{
  const f=await fixture(t,{timeoutMs:60}),session=await f.session(),input=f.input();await session.start(input);
  f.overrides.set('thread/queue/start',()=>undefined);
  await assert.rejects(session.startQueued(input.clientUserMessageId),{code:'CODEX_APP_SERVER_REPLY_TIMEOUT',outcomeUnknown:true});
  await assert.rejects(session.startQueued(input.clientUserMessageId),{code:'CODEX_APP_SERVER_QUEUE_START_OUTCOME_UNKNOWN',outcomeUnknown:true});
  const turnId=f.addTurn(input);const reconciled=await session.startQueued(input.clientUserMessageId);
  assert.equal(reconciled.reconciled,true);assert.equal(reconciled.turnId,turnId);
  assert.equal(f.calls.filter(m=>m.method==='thread/queue/start').length,1);
});

test('startQueued rejects a racing busy server without falling back to steer or retry',async t=>{
  const f=await fixture(t),session=await f.session(),input=f.input();await session.start(input);
  f.overrides.set('thread/queue/start',message=>{f.status='active';f.socket.write(frame({id:message.id,error:{code:-32600,message:'thread already has an active turn'}}));return undefined;});
  await assert.rejects(session.startQueued(input.clientUserMessageId),{code:'CODEX_APP_SERVER_RPC_ERROR',outcomeUnknown:true});
  await assert.rejects(session.startQueued(input.clientUserMessageId),{code:'CODEX_APP_SERVER_QUEUE_START_OUTCOME_UNKNOWN'});
  assert.equal(f.calls.filter(m=>m.method==='thread/queue/start').length,1);assert(!f.calls.some(m=>m.method==='turn/start'));
});

test('startQueued malformed receipt is unknown and concurrent preflight cannot double start',async t=>{
  const f=await fixture(t),session=await f.session(),input=f.input();await session.start(input);
  f.overrides.set('thread/queue/start',()=>({turn:{id:randomUUID(),status:'not-a-native-status'}}));
  const first=session.startQueued(input.clientUserMessageId);await assert.rejects(session.startQueued(input.clientUserMessageId),{code:'CODEX_APP_SERVER_INPUT_IN_FLIGHT'});
  await assert.rejects(first,{code:'CODEX_APP_SERVER_TURN_INVALID',outcomeUnknown:true});
  await assert.rejects(session.startQueued(input.clientUserMessageId),{code:'CODEX_APP_SERVER_QUEUE_START_OUTCOME_UNKNOWN'});
  assert.equal(f.calls.filter(m=>m.method==='thread/queue/start').length,1);
});

test('startQueued cannot race an outstanding original queue-add receipt',async t=>{
  const f=await fixture(t),session=await f.session(),input=f.input();let release;
  f.overrides.set('thread/queue/add',message=>new Promise(resolve=>{
    const entry={id:randomUUID(),clientUserMessageId:message.params.clientUserMessageId,input:message.params.input};f.queue.push(entry);
    release=()=>resolve({queuedSubmission:entry});
  }));
  const adding=session.start(input);while(!release)await new Promise(resolve=>setImmediate(resolve));
  await assert.rejects(session.startQueued(input.clientUserMessageId),{code:'CODEX_APP_SERVER_INPUT_IN_FLIGHT'});
  release();await adding;assert(!f.calls.some(m=>m.method==='thread/queue/start'));
});

function commandTerminal(f,turnId,processId,itemId=randomUUID()){
  const item={type:'commandExecution',id:itemId,processId,status:'completed',command:'synthetic fixture command',cwd:f.directory};
  f.items.push({turnId,item});const terminal={itemId,processId,command:item.command,cwd:item.cwd};f.terminals.push(terminal);return terminal;
}

test('terminateTurnTerminals only terminates the fixed exact-turn item/process intersection',async t=>{
  const f=await fixture(t),session=await f.session(),turnId=f.addTurn(f.input(),{status:'interrupted',final:null});
  const own=commandTerminal(f,turnId,'101'),otherTurn=f.addTurn(f.input()),other=commandTerminal(f,otherTurn,'202');
  const mismatched=commandTerminal(f,turnId,'303');mismatched.itemId=randomUUID();
  const proof=await session.terminateTurnTerminals(turnId);
  assert.deepEqual(proof.terminals,[{itemId:own.itemId,processId:'101',sources:['history'],requested:true,terminated:true,outcomeUnknown:false}]);
  assert.equal(proof.complete,true);assert.equal(proof.descendantsStopped,false);assert.equal((await session.inspectStop(turnId)).descendantsStopped,false);
  assert.deepEqual(f.calls.filter(m=>m.method==='thread/backgroundTerminals/terminate').map(m=>m.params),[{threadId:f.threadId,processId:'101'}]);
  assert.deepEqual(f.terminals,[other,mismatched]);assert(!f.calls.some(m=>m.method==='thread/backgroundTerminals/clean'));
  commandTerminal(f,turnId,'404');assert.deepEqual(await session.terminateTurnTerminals(turnId),proof);
  assert.equal(f.calls.filter(m=>m.method==='thread/backgroundTerminals/terminate').length,1);
});

test('terminateTurnTerminals rechecks both native IDs immediately before every stored write',async t=>{
  const f=await fixture(t),session=await f.session(),turnId=f.addTurn(f.input(),{status:'interrupted',final:null});commandTerminal(f,turnId,'101');
  let reads=0;f.overrides.set('thread/backgroundTerminals/list',()=>({data:++reads===1?f.terminals:f.terminals.map(v=>({...v,itemId:randomUUID()})),nextCursor:null}));
  const proof=await session.terminateTurnTerminals(turnId);assert.equal(proof.terminals[0].requested,false);assert.equal(proof.terminals[0].outcomeUnknown,true);assert.equal(proof.terminals[0].reason,'target_no_longer_matches');
  assert(!f.calls.some(m=>m.method==='thread/backgroundTerminals/terminate'));
});

test('terminateTurnTerminals unknown and malformed receipts are preserved without retry',async t=>{
  const f=await fixture(t,{timeoutMs:60}),session=await f.session(),turnId=f.addTurn(f.input(),{status:'interrupted',final:null});commandTerminal(f,turnId,'101');commandTerminal(f,turnId,'202');
  f.overrides.set('thread/backgroundTerminals/terminate',message=>message.params.processId==='101'?undefined:{terminated:'true'});
  const proof=await session.terminateTurnTerminals(turnId);assert.equal(proof.complete,true);
  for(const terminal of proof.terminals){assert.equal(terminal.requested,true);assert.equal(terminal.terminated,null);assert.equal(terminal.outcomeUnknown,true);}
  assert.deepEqual(await session.terminateTurnTerminals(turnId),proof);assert.equal(f.calls.filter(m=>m.method==='thread/backgroundTerminals/terminate').length,2);
});

test('terminateTurnTerminals fails closed for active, ambiguous and malformed targets',async t=>{
  const f=await fixture(t),session=await f.session(),turnId=f.addTurn(f.input(),{status:'inProgress',final:null});commandTerminal(f,turnId,'101');
  await assert.rejects(session.terminateTurnTerminals(''),{code:'CODEX_APP_SERVER_TURN_INVALID'});
  await assert.rejects(session.terminateTurnTerminals(turnId),{code:'CODEX_APP_SERVER_TURN_NOT_TERMINAL'});
  f.turns[0].status='interrupted';f.terminals.push({...f.terminals[0]});
  await assert.rejects(session.terminateTurnTerminals(turnId),{code:'CODEX_APP_SERVER_TERMINAL_INVALID'});f.terminals.pop();
  f.items.push({turnId,item:{id:randomUUID(),type:'commandExecution',processId:'101'}});
  await assert.rejects(session.terminateTurnTerminals(turnId),{code:'CODEX_APP_SERVER_TERMINAL_AMBIGUOUS'});
  assert(!f.calls.some(m=>m.method==='thread/backgroundTerminals/terminate'));
});

function nativeCommandEvent(f,turnId,terminal,{method='item/started',threadId=f.threadId,...overrides}={}){
  return{method,params:{threadId,turnId,[method==='item/started'?'startedAtMs':'completedAtMs']:Date.now(),item:{type:'commandExecution',id:terminal.itemId,processId:terminal.processId,status:method==='item/started'?'inProgress':'completed'},...overrides}};
}

test('native code-mode item events recover exact-turn terminal targets missing from historical items',async t=>{
  const f=await fixture(t),session=await f.session(),turnId=f.addTurn(f.input(),{status:'interrupted',final:null});
  const native={itemId:randomUUID(),processId:'101',command:'synthetic nested command',cwd:f.directory};f.terminals.push(native);
  f.socket.write(frame(nativeCommandEvent(f,turnId,native)));
  f.socket.write(frame(nativeCommandEvent(f,turnId,native,{method:'item/completed'})));
  // This reproduces the supported includeTurns fallback: it contains the
  // outer code-mode transcript, not the nested native CommandExecution item.
  f.overrides.set('thread/items/list',message=>{f.socket.write(frame({id:message.id,error:{code:-32601,message:'thread/items/list is not supported yet'}}));return undefined;});
  const proof=await session.terminateTurnTerminals(turnId);
  assert.deepEqual(proof.terminals,[{itemId:native.itemId,processId:'101',sources:['item/started','item/completed'],requested:true,terminated:true,outcomeUnknown:false}]);
  assert.equal(proof.descendantsStopped,false);assert.equal(f.calls.filter(m=>m.method==='thread/backgroundTerminals/terminate').length,1);
});

test('history and native lifecycle evidence merge once without retaining command contents',async t=>{
  const f=await fixture(t),session=await f.session(),turnId=f.addTurn(f.input(),{status:'interrupted',final:null});
  const target=commandTerminal(f,turnId,'101');f.socket.write(frame(nativeCommandEvent(f,turnId,target)));
  const proof=await session.terminateTurnTerminals(turnId);
  assert.equal(proof.terminals.length,1);assert.deepEqual(proof.terminals[0].sources,['history','item/started']);
  assert(!JSON.stringify(proof).includes('synthetic fixture command'));assert.equal(proof.terminals[0].terminated,true);
});

test('live cache ignores other threads, other turns, malformed notifications and server requests',async t=>{
  const f=await fixture(t),session=await f.session(),turnId=f.addTurn(f.input(),{status:'interrupted',final:null}),otherTurn=randomUUID();
  for(let i=1;i<=5;i++)f.terminals.push({itemId:randomUUID(),processId:String(100+i),command:'not owned',cwd:f.directory});
  const [foreign,other,malformed,request,wrongType]=f.terminals;
  f.socket.write(frame(nativeCommandEvent(f,turnId,foreign,{threadId:randomUUID()})));
  f.socket.write(frame(nativeCommandEvent(f,otherTurn,other)));
  f.socket.write(frame(nativeCommandEvent(f,turnId,malformed,{startedAtMs:null})));
  f.socket.write(frame({...nativeCommandEvent(f,turnId,request),id:'server-request'}));
  f.socket.write(frame(nativeCommandEvent(f,turnId,wrongType,{item:{type:'agentMessage',id:wrongType.itemId,processId:wrongType.processId}})));
  const proof=await session.terminateTurnTerminals(turnId);assert.deepEqual(proof.terminals,[]);
  assert(!f.calls.some(m=>m.method==='thread/backgroundTerminals/terminate'));
});

test('live events cannot remap an existing item to another turn or process',async t=>{
  const f=await fixture(t),session=await f.session(),turnId=f.addTurn(f.input(),{status:'interrupted',final:null});
  const target={itemId:randomUUID(),processId:'101',command:'synthetic',cwd:f.directory};f.terminals.push(target);
  f.socket.write(frame(nativeCommandEvent(f,turnId,target)));
  f.socket.write(frame(nativeCommandEvent(f,randomUUID(),{...target,processId:'202'},{method:'item/completed'})));
  await assert.rejects(session.terminateTurnTerminals(turnId),{code:'CODEX_APP_SERVER_TERMINAL_AMBIGUOUS'});
  assert(!f.calls.some(m=>m.method==='thread/backgroundTerminals/terminate'));
});

test('conflicting live evidence arriving during terminal refresh cancels the stored write',async t=>{
  const f=await fixture(t),session=await f.session(),turnId=f.addTurn(f.input(),{status:'interrupted',final:null});
  const target=commandTerminal(f,turnId,'101');let reads=0;
  f.overrides.set('thread/backgroundTerminals/list',()=>{
    if(++reads===2)f.socket.write(frame(nativeCommandEvent(f,randomUUID(),target)));
    return{data:f.terminals,nextCursor:null};
  });
  const proof=await session.terminateTurnTerminals(turnId);
  assert.equal(proof.terminals[0].requested,false);assert.equal(proof.terminals[0].outcomeUnknown,true);assert.equal(proof.terminals[0].reason,'CODEX_APP_SERVER_TERMINAL_AMBIGUOUS');
  assert(!f.calls.some(m=>m.method==='thread/backgroundTerminals/terminate'));
});

test('live evidence still requires a fresh exact item/process intersection',async t=>{
  const f=await fixture(t),session=await f.session(),turnId=f.addTurn(f.input(),{status:'interrupted',final:null});
  const target={itemId:randomUUID(),processId:'101',command:'synthetic',cwd:f.directory};f.terminals.push(target);
  f.socket.write(frame(nativeCommandEvent(f,turnId,target)));let reads=0;
  f.overrides.set('thread/backgroundTerminals/list',()=>({data:++reads===1?f.terminals:[{...target,itemId:randomUUID()}],nextCursor:null}));
  const proof=await session.terminateTurnTerminals(turnId);assert.equal(proof.terminals[0].requested,false);assert.equal(proof.terminals[0].reason,'target_no_longer_matches');
  assert(!f.calls.some(m=>m.method==='thread/backgroundTerminals/terminate'));
});

test('live command metadata cache is bounded and overflow never becomes empty proof',async t=>{
  const f=await fixture(t),session=await f.session(),turnId=f.addTurn(f.input(),{status:'interrupted',final:null});
  for(let i=1;i<=1001;i++)f.socket.write(frame(nativeCommandEvent(f,turnId,{itemId:randomUUID(),processId:String(i)})));
  await assert.rejects(session.terminateTurnTerminals(turnId),{code:'CODEX_APP_SERVER_LIVE_ITEM_LIMIT'});
  assert(!f.calls.some(m=>m.method==='thread/backgroundTerminals/terminate'));
});

test('terminal disappearance and a terminate receipt cannot replace exact native process completion',async t=>{
  const f=await fixture(t),session=await f.session(),turnId=f.addTurn(f.input(),{status:'interrupted',final:null});
  const own=commandTerminal(f,turnId,'401'),other=commandTerminal(f,f.addTurn(f.input()),'402');
  f.socket.write(frame({method:'turn/started',params:{threadId:f.threadId,turn:{id:turnId,status:'inProgress'}}}));
  f.socket.write(frame({method:'turn/completed',params:{threadId:f.threadId,turn:{id:turnId,status:'interrupted'}}}));
  await session.stopChildren(turnId);assert.deepEqual(f.terminals,[other]);
  assert.equal((await session.inspectStop(turnId)).descendantsStopped,false);
  const item=f.items.find(e=>e.item.id===own.itemId).item;item.status='failed';item.exitCode=137;
  assert.equal((await session.inspectStop(turnId)).descendantsStopped,false);
  await new Promise(r=>setTimeout(r,500));
  assert.equal((await session.inspectStop(turnId)).descendantsStopped,true);
  f.terminals.push({...own,processId:'403'});
  assert.equal((await session.inspectStop(turnId)).descendantsStopped,false);
});
test('unmanaged external work remains unconfirmed even with no live terminal',async t=>{
  const f=await fixture(t),session=await f.session(),turnId=f.addTurn(f.input(),{status:'interrupted',final:null});
  f.items.push({turnId,item:{id:randomUUID(),type:'mcpToolCall',status:'inProgress'}});
  await session.inspectStop(turnId);await new Promise(r=>setTimeout(r,500));
  assert.equal((await session.inspectStop(turnId)).descendantsStopped,false);
  assert(!f.calls.some(m=>m.method==='thread/backgroundTerminals/terminate'));
});

test('history-only connection with empty interrupted history never proves that omitted native work stopped',async t=>{
  const f=await fixture(t),session=await f.session(),turnId=f.addTurn(f.input(),{status:'interrupted',final:null});
  await session.inspectStop(turnId);await new Promise(r=>setTimeout(r,500));
  assert.equal((await session.inspectStop(turnId)).descendantsStopped,false);
});
test('explicit live-session subscription joins only the exact loaded thread without configuration overrides',async t=>{
  const f=await fixture(t);
  f.overrides.set('thread/resume',message=>{
    assert.deepEqual(message.params,{threadId:f.threadId,excludeTurns:true});
    return {thread:{id:f.threadId,cwd:f.directory,canAcceptDirectInput:true,ephemeral:false,parentThreadId:null,turns:[]}};
  });
  const session=await CodexAppServerSession.connect(f.threadId,{endpoint:f.endpoint,workspace:f.directory,metadataOnly:true,subscribeEvents:true});t.after(()=>session.close());
  assert.equal(f.calls.filter(m=>m.method==='thread/resume').length,1);
  assert(!f.calls.some(m=>['thread/start','turn/start','thread/settings/update'].includes(m.method)));
});


test('explicit queue continuation cannot activate an expired input or change queue contents',async t=>{
  const f=await fixture(t),session=await f.session(),input=f.input();await session.start(input);
  const before=structuredClone(f.queue);
  await assert.rejects(session.startQueued(input.clientUserMessageId,{expiresAt:new Date(Date.now()-1000).toISOString()}),{code:'CODEX_APP_SERVER_INPUT_EXPIRED'});
  assert.deepEqual(f.queue,before);assert(!f.calls.some(m=>m.method==='thread/queue/start'||m.method==='turn/start'));
  await assert.rejects(session.startQueued(input.clientUserMessageId,{expiresAt:'bad-date'}),{code:'CODEX_APP_SERVER_INPUT_INVALID'});
});


test('shared-daemon Unix RPC path is explicit and cannot inject an HTTP request',async t=>{
 const f=await fixture(t),channel=await new CodexAppServerChannel(f.endpoint,{rpcPath:'/rpc'}).connect();channel.close();
 assert.equal(f.upgradePath,'/rpc');
 for(const rpcPath of ['/rpc\r\nX-Injected: yes','/../rpc','//elsewhere'])assert.throws(()=>new CodexAppServerChannel(f.endpoint,{rpcPath}),{code:'CODEX_APP_SERVER_ENDPOINT_INVALID'});
});
test('observed local turn is controllable metadata and never submitted again',async t=>{
 const f=await fixture(t),session=await f.session(),input=f.input('Private local instruction not uploaded');
 const turnId=f.addTurn(input,{status:'inProgress',final:null});f.status='active';
 let rows=await session.activitySnapshot();assert.equal(rows.length,1);assert.equal(rows[0].turnId,turnId);assert.equal(rows[0].coverage,0);
 assert.equal((await session.inspectOperation(rows[0].operationId)).status,'inProgress');assert(!f.calls.some(m=>m.method==='thread/queue/add'||m.method==='turn/start'));
 f.socket.write(frame({method:'turn/started',params:{threadId:f.threadId,turn:{id:turnId,status:'inProgress'}}}));await new Promise(r=>setTimeout(r,20));
 rows=await session.activitySnapshot();assert.equal(rows[0].coverage,1);assert.equal(rows[0].createdAt,(await session.activitySnapshot())[0].createdAt);
 f.turns[0].status='completed';f.items.push({turnId,item:{type:'agentMessage',id:randomUUID(),text:'Actual local result',phase:'final_answer'}});
 const final=await session.inspectOperation(rows[0].operationId);assert.equal(final.resultComplete,true);assert.equal(final.result.text,'Actual local result');
});
test('our remote queued turn does not also become an observed native task',async t=>{
 const f=await fixture(t),session=await f.session(),input=f.input();await session.start(input);
 const turnId=f.addTurn(input,{status:'inProgress',final:null});f.status='active';
 f.socket.write(frame({method:'turn/started',params:{threadId:f.threadId,turn:{id:turnId,status:'inProgress'}}}));await new Promise(r=>setTimeout(r,20));
 assert.deepEqual(await session.activitySnapshot(),[]);
});

async function lifecycleFixture(t){
 const f=await fixture(t),channel=await f.connect(),session=await new CodexAppServerSession(channel,f.threadId,{workspace:f.directory}).attach();
 f.overrides.set('synthetic/barrier',()=>({}));
 return{...f,channel,session,async notify(message){f.socket.write(frame(message));await channel.request('synthetic/barrier');}};
}
test('only exact thread lifecycle notifications permanently close a session; closed hosts never rejoin or execute',async t=>{
 for(const method of ['thread/closed','thread/archived'])await t.test(method,async t=>{
  const f=await lifecycleFixture(t);assert.deepEqual(f.session.lifecycle(),{closed:false});
  await f.notify({method,params:{threadId:f.threadId}});const before=f.calls.length;
  assert.deepEqual(f.session.lifecycle(),{closed:true,reason:method==='thread/archived'?'session_archived':'session_closed'});
  const readiness=await f.session.readiness(),status=await f.session.status();assert.equal(readiness.canExecute,false);assert.equal(status.canExecute,false);assert.equal(status.busy,true);
  assert.equal(readiness.reason,'CODEX_APP_SERVER_SESSION_CLOSED');assert.equal(f.calls.length,before,'closed status is local, with no metadata/history/resume requests');
  await assert.rejects(f.session.attach({metadataOnly:true}),{code:'CODEX_APP_SERVER_SESSION_CLOSED'});
  await assert.rejects(f.session.start(f.input()),{code:'CODEX_APP_SERVER_SESSION_CLOSED'});
  assert(!f.calls.some(c=>['thread/resume','thread/queue/add','thread/queue/start','turn/start'].includes(c.method)));
  f.channel.close();assert.equal(f.session.lifecycle().closed,true,'native closure survives later transport teardown');
 });
});
test('foreign, malformed and request-shaped lifecycle events do not close this session or fabricate transport loss',async t=>{
 const f=await lifecycleFixture(t);
 for(const message of [
  {method:'thread/closed',params:{threadId:randomUUID()}},
  {method:'thread/archived',params:{threadId:randomUUID()}},
  {method:'thread/closed',params:{id:f.threadId}},
  {method:'thread/closed',params:{threadId:null}},
  {method:'thread/closed',params:null},
  {id:'server-request',method:'thread/closed',params:{threadId:f.threadId}},
  {id:null,method:'thread/archived',params:{threadId:f.threadId}},
  {method:'channel/closed',params:{code:'FAKE_WIRE_CLOSURE'}},
 ]){await f.notify(message);assert.deepEqual(f.session.lifecycle(),{closed:false});}
 assert.equal((await f.session.readiness()).canExecute,true);
 assert(!f.calls.some(c=>c.id==='server-request'),'the bridge never answers native server requests');
});
test('transport loss is reconnectable but never executable or confused with an ended original session',async t=>{
 const f=await lifecycleFixture(t);f.channel.close();
 assert.deepEqual(f.session.lifecycle(),{closed:false,reason:'transport_closed'});
 const before=f.calls.length;assert.equal((await f.session.readiness()).canExecute,false);assert.equal((await f.session.status()).canExecute,false);assert.equal(f.calls.length,before);
 await assert.rejects(f.session.attach({metadataOnly:true}),{code:'CODEX_APP_SERVER_DISCONNECTED'});
 const replacement=await new CodexAppServerSession(await f.connect(),f.threadId,{workspace:f.directory}).attach({metadataOnly:true});
 assert.deepEqual(replacement.lifecycle(),{closed:false});assert.equal((await replacement.readiness()).canExecute,true);
 assert.deepEqual(f.session.lifecycle(),{closed:false,reason:'transport_closed'},'the disconnected instance cannot revive itself');
});
test('a closure arriving during a metadata read prevents stale readiness or an implicit resume',async t=>{
 const f=await lifecycleFixture(t);
 f.overrides.set('thread/read',()=>{f.socket.write(frame({method:'thread/closed',params:{threadId:f.threadId}}));return{thread:{id:f.threadId,cwd:f.directory,status:{type:'idle'},canAcceptDirectInput:true,ephemeral:false,parentThreadId:null,turns:[]}};});
 await assert.rejects(f.session.readiness(),{code:'CODEX_APP_SERVER_SESSION_CLOSED'});
 assert.equal(f.session.lifecycle().closed,true);assert.equal((await f.session.readiness()).canExecute,false);
 await assert.rejects(f.session.attach({metadataOnly:true}),{code:'CODEX_APP_SERVER_SESSION_CLOSED'});
 assert(!f.calls.some(c=>c.method==='thread/resume'));
});
