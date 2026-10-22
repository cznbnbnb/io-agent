import test from 'node:test';
import assert from 'node:assert/strict';
import {loadApp} from './load-app.mjs';

const clone=value=>JSON.parse(JSON.stringify(value));
const turn=()=>new Promise(setImmediate);
const gate=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};

// Only the mature recorder and durable ASR read boundary is represented by a
// fixture. The ownership adapter, journal validation and expiry checks are real.
function fixture(){
 let now=1792304000000,peer='synthetic-peer',epoch=7,available=true,disk='',writeFault=false;
 let prepare,beforeCurrent,afterCurrent,reservedHook,returnHandle;
 const calls={starts:0,microphoneWrites:0,stops:[],reads:[],writes:[]};
 class Clock extends Date{static now(){return now;}}
 const globals={Date:Clock};
 const model=loadApp('TaskRecordingCapture',{},globals),bindingModel=loadApp('TaskReplyDraft',{},globals);
 const binding=Object.assign(new bindingModel.TaskReplyBinding(),{context_key:'test-context',operation_id:'operation-1',request_id:'request-1',request_revision:3,
  task_id:'task-1',route:{computer_id:'pc',agent_id:'hermes',project_id:'project',session_id:'original-session'},
  expires_at:new Date(now+60000).toISOString(),question:'采用新价格吗？',mode:'free_text'});
 const attempt='voice-'+'a'.repeat(32),token=JSON.stringify({format:'turboio-task-voice/1',attempt_id:attempt,peer,reply:binding});
 const handle={ownerId:attempt,cleanupId:'b'.repeat(32),uuid:'recording-1',directory:'/synthetic/recordings/take-'+'c'.repeat(32),peer,connectionEpoch:2};
 let result={state:'capturing',exitEvidence:'none',text:'',origin:null};
 const origin={schema:1,name:'take-'+'c'.repeat(32),uuid:handle.uuid,owner_id:attempt,cleanup_id:handle.cleanupId,peer,
  raw_bytes:2400,raw_sha256:'d'.repeat(64),result_sha256:'e'.repeat(64),material_id:'material-1',material_revision:2,exit_evidence:'device_event'};
 const ports=Object.freeze({
  async start(options){calls.starts++;assert.equal(options.ownerId,attempt);assert.equal(options.maxDurationMs,15000);await options.guard();if(prepare)await prepare();
   options.reserved(clone(handle));if(reservedHook)reservedHook();if(beforeCurrent)await beforeCurrent();
   if(!options.current())throw Error('synthetic owner authorization fenced');calls.microphoneWrites++;if(afterCurrent)await afterCurrent();
   return clone(returnHandle||handle);},
  async stop(value){calls.stops.push(clone(value));assert.deepEqual(value,handle,'only the exact original owner may be stopped');},
  read(value){calls.reads.push(clone(value));assert.deepEqual(value,handle,'never read latest or foreign recording');return clone(result);},
  peer:()=>peer,epoch:()=>epoch,available:()=>available,load:()=>disk,
  save(value){if(writeFault)throw Error('synthetic durable write failed');disk=value;calls.writes.push(value);}
 });
 const create=()=>{const v=new model.TaskRecordingCapture(ports);v.initialize();return v;};
 const adapter=create();
 return {adapter,create,calls,ports,handle,origin,token,binding,
  get disk(){return disk;},setDisk:v=>disk=v,get now(){return now;},advance:v=>now+=v,
  setPeer:v=>peer=v,setEpoch:v=>epoch=v,setAvailable:v=>available=v,failWrite:v=>writeFault=v,
  onPrepare:v=>prepare=v,onBeforeCurrent:v=>beforeCurrent=v,onReserved:v=>reservedHook=v,onAfterCurrent:v=>afterCurrent=v,
  setReturnHandle:v=>returnHandle=v,setResult:v=>result={...result,...clone(v)},
  complete(text='用新价格，但运费沿用上次。\n最后一句：只出预览。'){result={state:'complete',exitEvidence:'device_event',text,origin:clone(origin)};return text;}
 };
}

test('explicit owner is durable before microphone write; auth and recorder epochs remain distinct',async()=>{
 const f=fixture();f.onReserved(()=>{
  const record=JSON.parse(f.disk);assert.equal(record.schema,1);assert.equal(record.token,f.token);assert.equal(record.auth_epoch,7);
  assert.deepEqual(record.handle,f.handle);assert.equal(record.handle.connectionEpoch,2);assert.equal(f.calls.microphoneWrites,0);
 });
 await f.adapter.start(f.token,async()=>{});assert.equal(f.calls.microphoneWrites,1);assert.equal(f.adapter.state.phase,'listening');assert(f.adapter.state.active);
 assert.equal(Object.keys(f.ports).length,8,'no global callback slot is installed or replaced');
});

test('waiting for the existing sealed ASR remains active and only the full durable source becomes a draft',async()=>{
 const f=fixture();await f.adapter.start(f.token,async()=>{});await f.adapter.stop(false);
 f.setResult({state:'waiting',exitEvidence:'device_event'});f.adapter.tick();assert(f.adapter.state.active);assert(!f.adapter.state.valid);
 const text=f.complete(' 首句。\n'+'全部条件。'.repeat(1000)+'最终条件不得丢失。 ');f.adapter.tick();
 assert.equal(f.adapter.state.phase,'draft');assert.equal(f.adapter.state.active,false);assert.equal(f.adapter.state.text,text);assert(f.adapter.state.valid);
 assert.equal(JSON.parse(f.disk).text,text);assert.equal(JSON.parse(f.disk).phase,'complete');assert.equal(f.adapter.sourceEpoch(f.token,text),7);
 const copy=f.adapter.sourceOrigin(f.token,text);copy.raw_sha256='f'.repeat(64);assert.equal(f.adapter.sourceOrigin(f.token,text).raw_sha256,f.origin.raw_sha256);
 f.adapter.clear();assert.equal(f.disk,'');assert.equal(f.adapter.state.phase,'idle');assert.equal(f.calls.stops.length,1);
});

test('a foreign returned handle is never adopted, read or stopped',async()=>{
 const f=fixture();f.setReturnHandle({...f.handle,uuid:'foreign-uuid'});await assert.rejects(f.adapter.start(f.token,async()=>{}),/START_UNCONFIRMED/);
 assert(f.calls.stops.length>=1);assert(f.calls.stops.every(h=>h.uuid===f.handle.uuid));assert(f.calls.reads.every(h=>h.uuid===f.handle.uuid));
 assert.equal(f.adapter.state.valid,false);assert.equal(f.adapter.state.phase,'cleanup_pending');
});

test('known recorder exit during ASR wait suppresses redundant stop while retaining the full final transcript',async()=>{
 const f=fixture();await f.adapter.start(f.token,async()=>{});f.setResult({state:'waiting',exitEvidence:'device_event'});
 await f.adapter.stop(false);assert.equal(f.calls.stops.length,0);assert.equal(f.adapter.state.phase,'transcribing');assert(f.adapter.state.active);
 assert(JSON.parse(f.disk).stop_requested);const text=f.complete('首句。\n补充条件完整尾句。');f.adapter.tick();
 assert.equal(f.adapter.state.phase,'draft');assert.equal(f.adapter.state.text,text);assert(f.adapter.state.valid);assert.equal(f.calls.stops.length,0);
 const cancelled=fixture();await cancelled.adapter.start(cancelled.token,async()=>{});
 cancelled.setResult({state:'waiting',exitEvidence:'user_confirmation'});await cancelled.adapter.stop(true);
 assert.equal(cancelled.calls.stops.length,0);assert.equal(cancelled.adapter.state.phase,'failed');assert(!cancelled.adapter.state.valid);
 cancelled.complete();cancelled.adapter.tick();assert(!cancelled.adapter.state.valid);assert.equal(cancelled.adapter.state.text,'');
});

test('normal stop during submitted native start wait retains complete ASR while explicit cancel remains cancelled',async()=>{
 for(const cancelled of [false,true]){
  const f=fixture(),wait=gate();f.onAfterCurrent(()=>wait.promise);
  const start=f.adapter.start(f.token,async()=>{});await turn();assert.equal(f.calls.microphoneWrites,1);
  await f.adapter.stop(cancelled);assert.equal(f.calls.stops.length,1);wait.resolve();
  if(cancelled)await assert.rejects(start,/START_UNCONFIRMED/);else await start;
  const text=f.complete('开始已提交。\n正常结束后的完整最后条件。');f.adapter.tick();
  assert.equal(f.adapter.state.valid,!cancelled);assert.equal(f.adapter.state.phase,cancelled?'failed':'draft');
  assert.equal(f.adapter.state.text,cancelled?'':text);
 }
});

test('unreadable completed source invalidates the answer but preserves its already proven microphone exit',async()=>{
 const f=fixture();await f.adapter.start(f.token,async()=>{});const text=f.complete();f.adapter.tick();
 f.setResult({state:'complete',text,origin:null});f.adapter.tick();
 assert.equal(f.adapter.state.phase,'failed');assert(!f.adapter.state.valid);assert.equal(f.adapter.state.active,false);
 assert.equal(f.adapter.state.exitEvidence,'device_event');assert.equal(JSON.parse(f.disk).origin.exit_evidence,'device_event');
 assert.throws(()=>f.adapter.sourceOrigin(f.token,text),/UNVERIFIED/);f.adapter.clear();assert.equal(f.adapter.state.phase,'idle');
});

test('legal failed-without-source reread cannot erase a completed origin exit or create microphone cleanup debt',async()=>{
 const f=fixture();await f.adapter.start(f.token,async()=>{});const text=f.complete();f.adapter.tick();
 f.setResult({state:'failed',exitEvidence:'none',text:'',origin:null});f.adapter.tick();
 assert.equal(f.adapter.state.phase,'failed');assert.equal(f.adapter.state.active,false);assert(!f.adapter.state.valid);
 assert.equal(f.adapter.state.exitEvidence,'device_event');assert.equal(JSON.parse(f.disk).origin.exit_evidence,'device_event');
 assert.throws(()=>f.adapter.sourceOrigin(f.token,text),/UNVERIFIED/);assert.equal(f.calls.stops.length,0);
 f.adapter.clear();assert.equal(f.adapter.state.phase,'idle');assert.equal(f.disk,'');
});

test('cancel during awaited preparation fences mic, retains any subsequently reserved exact handle, and never emits a draft',async()=>{
 const f=fixture(),wait=gate();f.onPrepare(()=>wait.promise);
 const pending=f.adapter.start(f.token,async()=>{});await turn();await f.adapter.stop(true);wait.resolve();
 await assert.rejects(pending,/START_UNCONFIRMED/);assert.equal(f.calls.microphoneWrites,0);
 assert.deepEqual(JSON.parse(f.disk).handle,f.handle);assert(JSON.parse(f.disk).cancelled);assert.equal(f.adapter.state.valid,false);
 assert.throws(()=>f.adapter.clear(),/PROTECTED/);f.complete();f.adapter.tick();assert.equal(f.adapter.state.phase,'failed');assert(!f.adapter.state.valid);f.adapter.clear();
});

test('cancel after reservation but before native write fences the original attempt across await',async()=>{
 const f=fixture(),wait=gate();f.onBeforeCurrent(()=>wait.promise);
 const pending=f.adapter.start(f.token,async()=>{});await turn();await f.adapter.stop(true);wait.resolve();
 await assert.rejects(pending,/START_UNCONFIRMED/);assert.equal(f.calls.microphoneWrites,0);assert(f.calls.stops.every(h=>h.cleanupId===f.handle.cleanupId));
});

test('peer, authentication generation, availability and request expiry are rechecked after asynchronous consent validation',async()=>{
 for(const change of [f=>f.setPeer('different-peer'),f=>f.setEpoch(8),f=>f.setAvailable(false),f=>f.advance(60000)]){
  const f=fixture(),wait=gate();const pending=f.adapter.start(f.token,async()=>wait.promise);await turn();change(f);wait.resolve();
  await assert.rejects(pending,/START_UNCONFIRMED/);assert.equal(f.calls.microphoneWrites,0);assert.equal(f.calls.stops.length,0);
 }
});

test('expired request stops only its own recording and cannot become valid when a late complete transcript arrives',async()=>{
 const f=fixture();await f.adapter.start(f.token,async()=>{});f.advance(60000);f.adapter.tick();await turn();
 assert(f.calls.stops.length);assert(f.calls.stops.every(h=>h.ownerId===f.handle.ownerId));f.complete();f.adapter.tick();
 assert(!f.adapter.state.valid);assert.equal(f.adapter.state.phase,'failed');assert.throws(()=>f.adapter.sourceOrigin(f.token,'wrong'),/UNVERIFIED/);
});

test('cold unfinished journal never starts mic or pretends partial ASR is a recovered answer',async()=>{
 const f=fixture();await f.adapter.start(f.token,async()=>{});const starts=f.calls.starts,mics=f.calls.microphoneWrites;
 const cold=f.create();assert.equal(f.calls.starts,starts);assert.equal(f.calls.microphoneWrites,mics);assert.equal(cold.state.phase,'cleanup_pending');
 f.complete();cold.tick();assert.equal(cold.state.phase,'failed');assert(!cold.state.valid);assert.equal(cold.state.text,'');
});

test('saved complete draft recovers only while the exact raw/result/revision and original source still match',async()=>{
 const f=fixture();await f.adapter.start(f.token,async()=>{});const text=f.complete();f.adapter.tick();const before=f.calls.starts;
 const cold=f.create();assert.equal(f.calls.starts,before);assert.equal(cold.state.text,text);assert(cold.state.valid);
 assert.deepEqual(cold.sourceOrigin(f.token,text),f.origin);
 f.setResult({origin:{...f.origin,material_revision:3}});cold.tick();assert(!cold.state.valid);assert.equal(cold.state.phase,'failed');
 assert.throws(()=>cold.sourceOrigin(f.token,text),/UNVERIFIED/);
});

test('changes to raw hash, ASR hash, text or actual exit invalidate a previously complete draft',async()=>{
 for(const mutate of [f=>f.setResult({origin:{...f.origin,raw_sha256:'f'.repeat(64)}}),
  f=>f.setResult({origin:{...f.origin,result_sha256:'f'.repeat(64)}}),f=>f.setResult({text:'different full transcript'}),
  f=>f.setResult({state:'cleanup_pending',exitEvidence:'none',origin:null,text:''})]){
  const f=fixture();await f.adapter.start(f.token,async()=>{});const text=f.complete();f.adapter.tick();assert(f.adapter.state.valid);
  mutate(f);f.adapter.tick();assert(!f.adapter.state.valid);assert.throws(()=>f.adapter.sourceOrigin(f.token,text),/UNVERIFIED/);
 }
});

test('complete-looking text without exact source identity and confirmed exit is never accepted',async()=>{
 for(const mutate of [f=>f.setResult({origin:{...f.origin,owner_id:'voice-'+'f'.repeat(32)}}),
  f=>f.setResult({origin:{...f.origin,cleanup_id:'f'.repeat(32)}}),f=>f.setResult({origin:{...f.origin,name:'take-'+'f'.repeat(32)}}),
  f=>f.setResult({origin:{...f.origin,uuid:'foreign'}}),f=>f.setResult({exitEvidence:'none'}),f=>f.setResult({origin:null}),f=>f.setResult({text:' '})]){
  const f=fixture();await f.adapter.start(f.token,async()=>{});f.complete();mutate(f);f.adapter.tick();assert(!f.adapter.state.valid);
 }
});

test('strict token and journal schema reject unknown fields, oversized data and invalid handles without starting',async()=>{
 for(const mutate of [t=>({...t,extra:true}),t=>({...t,attempt_id:'voice-invalid'}),t=>({...t,peer:'bad peer'}),t=>({...t,reply:{...t.reply,request_revision:0}})]){
  const f=fixture();await assert.rejects(f.adapter.start(JSON.stringify(mutate(JSON.parse(f.token))),async()=>{}),/NOT_READY/);assert.equal(f.calls.starts,0);
 }
 const f=fixture();await f.adapter.start(f.token,async()=>{});const valid=JSON.parse(f.disk),starts=f.calls.starts;
 for(const value of [{...valid,extra:1},{...valid,auth_epoch:0},{...valid,handle:{...valid.handle,directory:'/synthetic/../take-'+'c'.repeat(32)}},'x'.repeat(262145)]){
  f.setDisk(typeof value==='string'?value:JSON.stringify(value));const cold=f.create();assert.equal(cold.state.phase,'cleanup_pending');assert(!cold.state.valid);
  assert.throws(()=>cold.clear(),/PROTECTED/);await assert.rejects(cold.start(f.token,async()=>{}),/NOT_READY/);assert.equal(f.calls.starts,starts);
 }
});

test('journal failure before microphone reservation or before complete publication fails closed',async()=>{
 const f=fixture();f.failWrite(true);await assert.rejects(f.adapter.start(f.token,async()=>{}),/JOURNAL_WRITE/);assert.equal(f.calls.starts,0);assert(!f.adapter.state.valid);
 const g=fixture();await g.adapter.start(g.token,async()=>{});g.complete();g.failWrite(true);g.adapter.tick();assert(!g.adapter.state.valid);assert.equal(g.adapter.state.phase,'cleanup_pending');
 assert.throws(()=>g.adapter.sourceOrigin(g.token,'anything'),/UNVERIFIED/);
});

test('a journal failure during stop never vetoes the precise recorder stop or releases cleanup occupancy',async()=>{
 for(const cancelled of [false,true]){
  const f=fixture();await f.adapter.start(f.token,async()=>{});f.failWrite(true);
  await assert.rejects(f.adapter.stop(cancelled),/JOURNAL_WRITE/);assert.equal(f.calls.stops.length,1);assert.deepEqual(f.calls.stops[0],f.handle);
  assert.equal(f.adapter.state.phase,'cleanup_pending');assert(f.adapter.state.active);assert(!f.adapter.state.valid);
  f.complete();f.adapter.tick();assert(!f.adapter.state.valid);assert.throws(()=>f.adapter.clear(),/PROTECTED/);
 }
});

test('numeric identifiers cannot pass string patterns by implicit coercion at reservation or restart',async()=>{
 const f=fixture();f.handle.uuid=123;await assert.rejects(f.adapter.start(f.token,async()=>{}),/START_UNCONFIRMED/);assert.equal(f.calls.microphoneWrites,0);
 const g=fixture();await g.adapter.start(g.token,async()=>{});const journal=JSON.parse(g.disk);journal.handle.uuid=123;g.setDisk(JSON.stringify(journal));
 const cold=g.create();assert.equal(cold.state.phase,'cleanup_pending');assert(!cold.state.valid);assert.throws(()=>cold.clear(),/PROTECTED/);
});

test('disconnection retains an owned cleanup debt and never stops a replacement peer',async()=>{
 const f=fixture();await f.adapter.start(f.token,async()=>{});f.setPeer('replacement-peer');f.setEpoch(8);f.adapter.disconnected();
 assert.equal(f.adapter.state.phase,'cleanup_pending');assert(!f.adapter.state.valid);assert.equal(f.calls.stops.length,0);
 assert.throws(()=>f.adapter.clear(),/PROTECTED/);await assert.rejects(f.adapter.start(f.token,async()=>{}),/NOT_READY/);
});

test('late audio taints only the exact sealed source before ASR registration and never ordinary capture packets',async()=>{
 const f=fixture();await f.adapter.start(f.token,async()=>{});
 f.adapter.lateAudio(f.handle.peer,7,f.handle.uuid);assert.equal(f.adapter.state.phase,'listening');assert.equal(JSON.parse(f.disk).cancelled,false);
 f.setResult({state:'waiting',exitEvidence:'device_event'});f.adapter.tick();const waiting=f.disk;
 for(const [peer,epoch,uuid] of [[f.handle.peer,7,'foreign-uuid'],['foreign-peer',7,f.handle.uuid],[f.handle.peer,8,f.handle.uuid]]){
  f.adapter.lateAudio(peer,epoch,uuid);assert.equal(f.disk,waiting);assert.equal(f.adapter.state.phase,'transcribing');
 }
 f.adapter.lateAudio(f.handle.peer,7,f.handle.uuid);assert.equal(f.adapter.state.phase,'failed');assert(!f.adapter.state.valid);
 assert(JSON.parse(f.disk).cancelled);assert(JSON.parse(f.disk).stop_requested);assert.equal(f.calls.stops.length,0);
 const text=f.complete();f.adapter.tick();assert.equal(f.adapter.state.phase,'failed');assert(!f.adapter.state.valid);assert.equal(f.adapter.state.text,'');
 assert.throws(()=>f.adapter.sourceOrigin(f.token,text),/UNVERIFIED/);assert.equal(f.calls.stops.length,0);
});
