import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {randomUUID} from 'node:crypto';
import {DesktopChannel,CodexDesktopSession,applyMetadataPatches,summarizeState,verifyDesktopBuild} from '../hosts/codex-desktop.mjs';

const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const THREAD='10000000-0000-4000-8000-000000000001',OWNER='20000000-0000-4000-8000-000000000002',CLIENT='30000000-0000-4000-8000-000000000003';
const encode=frame=>{const body=Buffer.from(JSON.stringify(frame));const header=Buffer.alloc(4);header.writeUInt32LE(body.length);return Buffer.concat([header,body]);};
const turn=(id,status,messageId=null)=>({turnId:id,status,params:{clientUserMessageId:messageId},items:[{text:'private transcript that must not enter status'}]});
function state(turns=[]){return{id:THREAD,cwd:'/synthetic/selected-workspace',turns,threadRuntimeStatus:{type:turns.some(t=>t.status==='inProgress')?'active':'idle'}};}

async function fixture(t,{timeoutMs=300,initial=state(),handler,fragment=true}={}){
  const dir=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'io-desktop-')));fs.chmodSync(dir,0o700);
  const socketPath=path.join(dir,'ipc.sock'),messages=[],sockets=new Set();let current=initial,revision=0,snapshots=0;
  function write(socket,frame){const bytes=encode(frame);if(fragment){socket.write(bytes.subarray(0,2));socket.write(bytes.subarray(2,7));socket.write(bytes.subarray(7));}else socket.write(bytes);}
  function broadcast(socket,change,extra={}){write(socket,{type:'broadcast',method:'thread-stream-state-changed',sourceClientId:OWNER,version:11,params:{hostId:'local',conversationId:THREAD,change},...extra});}
  const server=net.createServer(socket=>{
    sockets.add(socket);socket.on('close',()=>sockets.delete(socket));socket.on('error',()=>{});let buffered=Buffer.alloc(0);
    socket.on('data',chunk=>{buffered=Buffer.concat([buffered,chunk]);while(buffered.length>=4){const n=buffered.readUInt32LE();if(buffered.length<n+4)break;const frame=JSON.parse(buffered.subarray(4,n+4));buffered=buffered.subarray(n+4);messages.push(frame);
      const reply=(result,extra={})=>write(socket,{type:'response',requestId:frame.requestId,resultType:'success',method:frame.method,handledByClientId:frame.method==='initialize'?CLIENT:OWNER,result,...extra});
      if(handler?.({frame,reply,socket,write,broadcast})===true)continue;
      if(frame.type==='request'){
        if(frame.method==='initialize')reply({clientId:CLIENT});
        else if(frame.method==='thread-owner-discovery')reply({supportsUntrustedAppInput:true});
        else if(frame.method==='thread-follower-read-model-settings')reply({settings:{model:'unchanged',resumeState:'resumed'}});
        else if(frame.method==='thread-follower-start-turn')reply({result:{turn:{id:'native-turn'}}});
        else if(frame.method==='thread-follower-interrupt-turn')reply({ok:true,interruptedTurnId:frame.params.expectedTurnId});
      }else if(frame.type==='broadcast'&&frame.params.following){snapshots++;broadcast(socket,{type:'snapshot',revision,conversationState:current});}
    }});
  });
  await new Promise(resolve=>server.listen(socketPath,resolve));fs.chmodSync(socketPath,0o600);
  const channel=await new DesktopChannel(socketPath,{timeoutMs}).connect();
  const session=await new CodexDesktopSession(channel,THREAD).attach();
  t.after(async()=>{session.close();for(const socket of sockets)socket.destroy();await new Promise(resolve=>server.close(resolve));fs.rmSync(dir,{recursive:true});});
  return{channel,session,messages,dir,socketPath,get snapshots(){return snapshots;},
    broadcast(change,extra){for(const socket of sockets)broadcast(socket,change,extra);},
    patch(patches){const change={type:'patches',baseRevision:revision,revision:++revision,patches};for(const socket of sockets)broadcast(socket,change);},
    replace(next){current=next;revision++;for(const socket of sockets)broadcast(socket,{type:'snapshot',revision,conversationState:current});},
    writeRaw(bytes){for(const socket of sockets)socket.write(bytes);},disconnect(){for(const socket of sockets)socket.destroy();}};
}

test('private socket, split frames and pinned owner expose metadata only',async t=>{
  const f=await fixture(t,{initial:state([turn('one','inProgress')])});
  assert.deepEqual(await f.session.status(),{conversationId:THREAD,busy:true,activeTurnId:'one',latestTurnId:'one',latestStatus:'inProgress',workspace:'/synthetic/selected-workspace',loadedTurns:1});
  await f.session.status();assert.equal(f.snapshots,1);assert(!JSON.stringify(await f.session.snapshot()).includes('private transcript'));
  assert(f.messages.filter(v=>v.method.startsWith('thread-follower-')).every(v=>v.targetClientId===OWNER&&!('hostId'in v)));
  fs.chmodSync(f.socketPath,0o666);await assert.rejects(new DesktopChannel(f.socketPath).connect(),{code:'CODEX_DESKTOP_SOCKET_UNTRUSTED'});
});

test('canonical timeline order takes precedence over empty legacy turns',()=>{
  const canonical={...state(),turns:[],turnHistory:{kind:'canonical',history:{entitiesByKey:{b:turn('new','inProgress'),a:turn('old','completed')},islands:[{entries:[{value:'a'},{value:'b'}]}]}}};
  assert.equal(summarizeState(canonical,THREAD).activeTurnId,'new');assert.equal(summarizeState(canonical,THREAD).latestTurnId,'new');
  assert.throws(()=>summarizeState({...canonical,id:randomUUID()},THREAD),{code:'CODEX_DESKTOP_SESSION_MISMATCH'});
});

test('metadata projection follows real revision patches without retaining transcript',async t=>{
  const f=await fixture(t,{initial:state([turn('one','inProgress')])});await f.session.status();
  f.patch([{op:'add',path:['turns',0,'items',1],value:{text:'another sensitive result'}},{op:'replace',path:['turns',0,'status'],value:'completed'},{op:'replace',path:['threadRuntimeStatus','type'],value:'idle'}]);
  assert.equal((await f.session.status()).busy,false);assert.equal(f.snapshots,1);assert(!JSON.stringify(await f.session.snapshot()).includes('sensitive'));
  f.patch([{op:'add',path:['turns',1],value:turn('two','inProgress')},{op:'replace',path:['threadRuntimeStatus','type'],value:'active'}]);assert.equal((await f.session.status()).activeTurnId,'two');
  f.patch([{op:'remove',path:['turns',0]}]);assert.equal((await f.session.status()).loadedTurns,1);
});

test('canonical turn and params patches keep operation mapping',async t=>{
  const messageId=randomUUID(),initial={...state(),turnHistory:{kind:'canonical',history:{entitiesByKey:{a:turn('one','inProgress')},islands:[{id:'tail',entries:[{value:'a'}]}]}}};
  const f=await fixture(t,{initial});await f.session.status();f.patch([{op:'replace',path:['turnHistory','history','entitiesByKey','a','params'],value:{clientUserMessageId:messageId,input:[{text:'not retained'}]}},{op:'replace',path:['turnHistory','history','entitiesByKey','a','status'],value:'interrupted'}]);
  await f.session.status();assert.deepEqual(await f.session.inspectOperation(messageId),{found:true,turnId:'one',status:'interrupted'});assert(!JSON.stringify(await f.session.snapshot()).includes('not retained'));
});

test('wrong-owner snapshots are ignored, missing revisions invalidate actionability',async t=>{
  const f=await fixture(t,{initial:state([turn('one','inProgress')])});await f.session.status();
  f.broadcast({type:'snapshot',revision:99,conversationState:state()},{sourceClientId:randomUUID()});assert.equal((await f.session.status()).activeTurnId,'one');
  f.broadcast({type:'patches',baseRevision:99,revision:100,patches:[]});await delay(10);
  await assert.rejects(async()=>f.session.status(),{code:'CODEX_DESKTOP_STATE_GAP'});
  await assert.rejects(async()=>f.session.interrupt('one'),{code:'CODEX_DESKTOP_STATE_GAP'});assert(!f.messages.some(v=>v.method==='thread-follower-interrupt-turn'));
});

test('input goes once to original owner and inherits existing permissions/model',async t=>{
  const f=await fixture(t);const id=randomUUID();assert.equal((await f.session.start({text:'Only answer this isolated test.',clientUserMessageId:id})).accepted,true);
  const sent=f.messages.filter(v=>v.method==='thread-follower-start-turn');assert.equal(sent.length,1);assert.equal(sent[0].version,2);assert.equal(sent[0].params.conversationId,THREAD);
  assert.deepEqual(sent[0].params.turnStart,{request:{threadId:THREAD,input:[{type:'text',text:'Only answer this isolated test.',text_elements:[]}],clientUserMessageId:id},context:{inheritThreadSettings:true,useUserMessageAdmission:false}});
  assert(!f.messages.some(v=>/resume|approval|permissions/.test(v.method)));
});

test('ordinary input while busy sends nothing and stale interrupt cannot affect new turn',async t=>{
  const f=await fixture(t,{initial:state([turn('new','inProgress')])});
  await assert.rejects(f.session.start({text:'queued elsewhere',clientUserMessageId:randomUUID()}),{code:'CODEX_DESKTOP_BUSY'});
  assert.deepEqual(await f.session.interrupt('old'),{requested:false,expectedTurnId:'old',reason:'turn_no_longer_active'});
  assert(!f.messages.some(v=>['thread-follower-start-turn','thread-follower-interrupt-turn'].includes(v.method)));
});

test('interrupt carries exact turn fence; acknowledgement is never stopped proof',async t=>{
  const f=await fixture(t,{initial:state([turn('one','inProgress')])});
  assert.deepEqual(await f.session.interrupt('one'),{requested:true,expectedTurnId:'one',confirmedStopped:false,goalPauseFailed:false});
  const sent=f.messages.find(v=>v.method==='thread-follower-interrupt-turn');assert.equal(sent.version,4);assert.deepEqual(sent.params,{conversationId:THREAD,mode:'user-stop',expectedTurnId:'one'});
  assert.equal((await f.session.status()).busy,true);
});

test('unexpected interrupt receipt stays unknown and never targets a replacement turn',async t=>{
  const f=await fixture(t,{initial:state([turn('one','inProgress')]),handler:({frame,reply})=>{if(frame.method==='thread-follower-interrupt-turn'){reply({ok:true,interruptedTurnId:'two'});return true;}}});
  await assert.rejects(f.session.interrupt('one'),e=>e.code==='CODEX_DESKTOP_INTERRUPT_RECEIPT_INVALID'&&e.outcomeUnknown===true);
  assert.equal(f.messages.filter(v=>v.method==='thread-follower-interrupt-turn').length,1);
});

test('a delayed older snapshot cannot replace the active turn',async t=>{
  const f=await fixture(t);await f.session.status();f.patch([{op:'add',path:['turns',0],value:turn('new','inProgress')}]);await f.session.status();
  f.broadcast({type:'snapshot',revision:0,conversationState:state()});await delay(10);
  await assert.rejects(async()=>f.session.status(),{code:'CODEX_DESKTOP_STATE_GAP'});
});

test('lost start reply is unknown; it is not retried or reported as complete',async t=>{
  const f=await fixture(t,{handler:({frame,socket})=>{if(frame.method==='thread-follower-start-turn'){socket.destroy();return true;}}});
  await assert.rejects(f.session.start({text:'one request',clientUserMessageId:randomUUID()}),e=>e.code==='CODEX_DESKTOP_DISCONNECTED'&&e.outcomeUnknown===true);
  assert.equal(f.messages.filter(v=>v.method==='thread-follower-start-turn').length,1);await assert.rejects(async()=>f.session.status(),{code:'CODEX_DESKTOP_DISCONNECTED'});
});

test('timeout does not retry, and operation absent from loaded history stays unknown',async t=>{
  const f=await fixture(t,{timeoutMs:80,handler:({frame})=>frame.method==='thread-follower-start-turn'});const id=randomUUID();
  await assert.rejects(f.session.start({text:'lost acknowledgement',clientUserMessageId:id}),e=>e.code==='CODEX_DESKTOP_REPLY_TIMEOUT'&&e.outcomeUnknown===true);
  assert.deepEqual(await f.session.inspectOperation(id),{found:false,outcomeUnknown:true});assert.equal(f.messages.filter(v=>v.method==='thread-follower-start-turn').length,1);
});

test('oversized frame and prototype patch fail closed without mutating global prototypes',async t=>{
  const f=await fixture(t);await f.session.status();const head=Buffer.alloc(4);head.writeUInt32LE(256*1024*1024+1);f.writeRaw(head);await delay(10);
  await assert.rejects(async()=>f.session.status(),{code:'CODEX_DESKTOP_FRAME_LIMIT'});
  assert.throws(()=>applyMetadataPatches(state(),[{op:'add',path:['__proto__','polluted'],value:true}]),{code:'CODEX_DESKTOP_PATCH_INVALID'});assert.equal({}.polluted,undefined);
  assert.throws(()=>verifyDesktopBuild('/synthetic/missing.asar'),{code:'CODEX_DESKTOP_VERSION_UNVERIFIED'});
});
