import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {createHash} from 'node:crypto';
import {loadApp} from './load-app.mjs';import {loadCore} from './load-core.mjs';
const peer='aabbccddeeff',other='112233445566',op=n=>'tdel-'+n.toString(16).padStart(32,'0');
const {businessEnvelope}=loadCore('./BusinessCommands'),{readLauncherEnvelope}=loadCore('./LauncherStatus');
const event=(type,body)=>businessEnvelope(type,new TextEncoder().encode(JSON.stringify(body)));
const tick=async()=>{for(let i=0;i<8;i++)await new Promise(r=>setImmediate(r));};
const hash=s=>createHash('sha256').update(s).digest('hex');
const row=(id=101,p=peer)=>({id,title:'合成待办'+id,completed:false,important:false,created:1700000000,modified:1700000000,revision:1,peer:p,delivery:p?'submitted':'local',observed:-1});
const archive={id:'original-conversation',kind:'conversation',title:'原始对话',text:'原始资料',answer:'原始答案',model:'synthetic',created:1700000000000};
const oldRaw=()=>JSON.stringify({version:1,todos:[row()],entries:[archive]});
function setup(t,initial=oldRaw()){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'todo095-')),file=path.join(root,'preferences.json');
 fs.writeFileSync(file,JSON.stringify({data:initial}));let counter=0,flushCount=0,failAt=0,failAfterWrite=false;
 const disk=()=>JSON.parse(fs.readFileSync(file,'utf8'));
 function open(){let buffered=disk();const prefs={get:async(k,d)=>Object.hasOwn(buffered,k)?buffered[k]:d,put:async(k,v)=>{buffered[k]=v;},flush:async()=>{
   flushCount++;if(flushCount===failAt&&!failAfterWrite)throw Error('synthetic disk failure');
   const temp=file+'.tmp';fs.writeFileSync(temp,JSON.stringify(buffered));const fd=fs.openSync(temp,'r+');fs.fsyncSync(fd);fs.closeSync(fd);fs.renameSync(temp,file);
   if(flushCount===failAt)throw Error('synthetic uncertain flush');
 }};
 const module=loadApp('LocalWorkspace',{'@kit.AbilityKit':{},'@kit.ArkData':{preferences:{getPreferences:async()=>prefs}},'@kit.CryptoArchitectureKit':{cryptoFramework:{createRandom:()=>({generateRandomSync:n=>({data:new Uint8Array(n).fill(++counter)})})}}},{setTimeout,clearTimeout});
 const store=new module.LocalWorkspace();return {store,module,prefs};}
 const first=open();const stores=[first.store];t.after(()=>{for(const s of stores)s.setTodoTransport(undefined);fs.rmSync(root,{recursive:true,force:true});});
 return {...first,disk,raw:()=>disk().data,flushes:()=>flushCount,cold(){const next=open();stores.push(next.store);return next;},failNext(after=false){failAt=flushCount+1;failAfterWrite=after;},failAt(n,after=false){failAt=n;failAfterWrite=after;}};
}
function transport(store,write=async()=>{}){
 const state={peer,ready:false,foreground:true,lease:1,writes:[]};
 store.setTodoTransport({peer:()=>state.peer,ready:()=>state.ready,foreground:()=>state.foreground,lease:()=>state.lease,send:async(b,p)=>{state.writes.push({b,p:new Uint8Array(p)});await write(b,p);}});
 state.change=(patch)=>{Object.assign(state,patch);state.lease++;store.todoConnectionChanged();};return state;
}
const full=(ids=[],patch={})=>({scheduleTotal:0,todoTotal:ids.length,batchNo:1,isLastBatch:true,needFullData:true,chunkInfo:{chunkId:3,batchNo:1,isLastBatch:true,currentItems:ids.length},dataList:ids.map(id=>({eventType:1,eventID:id,status:0,createTime:1700000000,lastModifiedTime:1700000001,isImportant:0,title:'合成眼镜条目'+id})),...patch});

test('v1 stays byte-identical on read; first single delete backs up exact raw before v2 and keeps unrelated archives',async t=>{
 const original=oldRaw(),s=setup(t,original);await s.store.load({});assert(s.store.ready);assert.equal(s.flushes(),0);assert.equal(s.raw(),original);
 const ref=s.store.todoSnapshot(101).reference;const result=await s.store.deleteTodo(op(1),ref);
 assert.equal(result.phase,'pending');assert.equal(result.attempts,0);assert.equal(s.store.todos.length,0);
 const saved=JSON.parse(s.raw());assert.equal(saved.version,2);assert.equal(s.disk().data_v1_backup,original);assert.equal(saved.legacy_backup_sha256,hash(original));assert.deepEqual(saved.entries,[archive]);assert.equal(s.flushes(),2);
 const cold=s.cold();await cold.store.load({});assert(cold.store.ready);assert.equal(cold.store.todos.length,0);assert.equal(cold.store.todoDeleteStatus(op(1)).phase,'pending');
});
test('stale or changed references and operation rebind are refused without writes; same operation replay is idempotent',async t=>{
 const s=setup(t);await s.store.load({});const ref=s.store.todoSnapshot(101).reference;await s.store.editTodo(101,'新标题',false);let before=s.raw();
 await assert.rejects(s.store.deleteTodo(op(1),ref),/TODO_STALE/);assert.equal(s.raw(),before);
 const fresh=s.store.todoSnapshot(101).reference;await s.store.deleteTodo(op(1),fresh);await s.store.deleteTodo(op(1),fresh);assert.equal(s.store.todoPage('deleted').deletions.length,1);
 before=s.raw();await assert.rejects(s.store.deleteTodo(op(1),ref),/TODO_STALE/);assert.equal(s.raw(),before);
});
test('pure local deletion sends nothing and only unsent cancellation restores a new revision',async t=>{
 const s=setup(t,JSON.stringify({version:1,todos:[row(101,'')],entries:[archive]}));await s.store.load({});const tr=transport(s.store);tr.change({ready:true});
 const ref=s.store.todoSnapshot(101).reference,d=await s.store.deleteTodo(op(1),ref);await tick();assert.equal(d.phase,'local_deleted');assert.equal(tr.writes.length,0);
 await s.store.cancelTodoDelete(op(1),d.state_sha256);assert.equal(s.store.todos.length,1);assert.equal(s.store.todos[0].revision,2);assert.equal(s.store.todoDeleteStatus(op(1)).phase,'cancelled');
 await assert.rejects(s.store.deleteTodo(op(2),ref),/TODO_STALE/);
});
test('offline intent cold-recovers and original ready foreground peer gets one exact type7 after durable attempt claim',async t=>{
 const s=setup(t);await s.store.load({});await s.store.deleteTodo(op(1),s.store.todoSnapshot(101).reference);
 const c=s.cold();await c.store.load({});const tr=transport(c.store,async(b,p)=>{
   const disk=JSON.parse(s.raw()).deletions[0];assert.equal(disk.phase,'sending');assert.equal(disk.attempts,1);
   assert.equal(b,22);const envelope=readLauncherEnvelope(p);assert.equal(envelope.type,7);assert.deepEqual(JSON.parse(new TextDecoder().decode(envelope.json)),{eventType:1,scheduleTotal:0,todoTotal:1,eventIDList:[101]});
 });tr.change({ready:true,peer:other});await tick();assert.equal(tr.writes.length,0);
 tr.change({peer,foreground:false});await tick();assert.equal(tr.writes.length,0);tr.change({foreground:true});await tick();
 assert.equal(tr.writes.length,1);assert.equal(c.store.todoDeleteStatus(op(1)).phase,'submitted');tr.change({});await tick();assert.equal(tr.writes.length,1);
 const next=s.cold();await next.store.load({});const ntr=transport(next.store);ntr.change({ready:true});await tick();assert.equal(ntr.writes.length,0);assert.equal(next.store.todoDeleteStatus(op(1)).phase,'submitted');
});
test('ambiguous send failure never auto-replays or allows cancellation; explicit CAS retries have a three-attempt budget',async t=>{
 const s=setup(t);await s.store.load({});await s.store.deleteTodo(op(1),s.store.todoSnapshot(101).reference);const tr=transport(s.store,async()=>{throw Error('link lost after possible write');});tr.change({ready:true});await tick();
 let d=s.store.todoDeleteStatus(op(1));assert.equal(d.phase,'uncertain');assert.equal(d.attempts,1);assert(!d.can_cancel);await assert.rejects(s.store.cancelTodoDelete(op(1),d.state_sha256),/TODO_ALREADY_SENT/);
 tr.change({});await tick();assert.equal(tr.writes.length,1);
 for(let n=2;n<=3;n++){await s.store.sendTodoDelete(op(1),s.store.todoDeleteStatus(op(1)).state_sha256);assert.equal(s.store.todoDeleteStatus(op(1)).attempts,n);}
 d=s.store.todoDeleteStatus(op(1));assert(!d.can_send);await assert.rejects(s.store.sendTodoDelete(op(1),d.state_sha256),/TODO_LIMIT/);assert.equal(tr.writes.length,3);
});
test('crash after durable sending claim has no automatic replay; lease change makes a late resolution uncertain',async t=>{
 const s=setup(t);await s.store.load({});await s.store.deleteTodo(op(1),s.store.todoSnapshot(101).reference);let release;
 const tr=transport(s.store,()=>new Promise(r=>release=r));tr.change({ready:true});await tick();assert.equal(JSON.parse(s.raw()).deletions[0].phase,'sending');
 const c=s.cold();await c.store.load({});const ctr=transport(c.store);ctr.change({ready:true});await tick();assert.equal(ctr.writes.length,0);assert.equal(c.store.todoDeleteStatus(op(1)).phase,'uncertain');
 tr.change({ready:false});release();await tick();assert.equal(s.store.todoDeleteStatus(op(1)).phase,'uncertain');assert.equal(tr.writes.length,1);
});
test('backup failure and uncertain main flush block writes and never send, while originals survive cold reopen',async t=>{
 for(const failure of [1,2]){
   const s=setup(t);await s.store.load({});s.failAt(failure,failure===2);const tr=transport(s.store);tr.change({ready:true});
   await assert.rejects(s.store.deleteTodo(op(failure),s.store.todoSnapshot(101).reference));assert(!s.store.ready);assert.equal(tr.writes.length,0);assert.equal(s.store.todos.length,1);await assert.rejects(s.store.addTodo('不可覆盖'));
   const c=s.cold();await c.store.load({});assert(c.store.ready);assert.equal(c.store.todos.length,failure===1?1:0);
 }
});
test('interrupted migration resumes before a normal edit, preserving the committed original backup',async t=>{
 const original=oldRaw(),s=setup(t,original);await s.store.load({});s.failAt(2,false);
 await assert.rejects(s.store.deleteTodo(op(1),s.store.todoSnapshot(101).reference));assert.equal(s.raw(),original);assert.equal(s.disk().data_v1_backup,original);
 const c=s.cold();await c.store.load({});assert(c.store.ready);await c.store.editTodo(101,'恢复后正常编辑',false);
 assert.equal(JSON.parse(s.raw()).version,2);assert.equal(s.disk().data_v1_backup,original);
 await c.store.deleteTodo(op(2),c.store.todoSnapshot(101).reference);assert.equal(c.store.todoDeleteStatus(op(2)).phase,'pending');
 const next=s.cold();await next.store.load({});assert(next.store.ready);assert.equal(next.store.todos.length,0);assert.equal(s.disk().data_v1_backup,original);
});
test('late metadata and completion packets queued around deletion cannot resurrect a tombstoned original ID',async t=>{
 const s=setup(t);await s.store.load({});const ref=s.store.todoSnapshot(101).reference;
 const deletion=s.store.deleteTodo(op(1),ref);s.store.receiveTodo(peer,event(16,full([101])));s.store.receiveTodo(peer,event(4,{eventID:101,status:1}));await deletion;await tick();
 assert.equal(s.store.todos.length,0);const before=s.store.todoDeleteStatus(op(1));assert.equal(before.todo.title,'合成待办101');
 s.store.receiveTodo(peer,event(16,full([101])));await tick();assert.equal(s.store.todos.length,0);
 const c=s.cold();await c.store.load({});c.store.receiveTodo(peer,event(16,full([101])));await tick();assert.equal(c.store.todos.length,0);
});
test('type14 successCount is only unattributed observation; unrelated source or peer and invalid negative codes are ignored',async t=>{
 const s=setup(t);await s.store.load({});await s.store.deleteTodo(op(1),s.store.todoSnapshot(101).reference);const tr=transport(s.store);tr.change({ready:true});await tick();
 for(const [p,body] of [[other,{sourceType:7,successCount:1}],[peer,{sourceType:2,successCount:1}],[peer,{sourceType:7,successCount:1,failList:[{eventID:101,errorCode:-2}]}]])s.store.receiveTodo(p,event(14,body));await tick();assert(!s.store.todoDeleteStatus(op(1)).receipt_observed);
 s.store.receiveTodo(peer,event(14,{sourceType:7,successCount:1}));await tick();let d=s.store.todoDeleteStatus(op(1));assert(d.receipt_observed);assert.equal(d.receipt_correlation,'unattributed');assert.equal(d.phase,'submitted');
 s.store.receiveTodo(peer,event(14,{sourceType:7,successCount:0,failList:[{eventID:101,errorCode:3,errorMessage:'synthetic'}]}));await tick();d=s.store.todoDeleteStatus(op(1));assert.equal(d.receipt_correlation,'failure_id');assert.equal(d.receipt_failure_code,3);assert.equal(d.phase,'submitted');
});
test('complete bounded query stores only absent observation; incomplete terminal response does not infer deletion',async t=>{
 const s=setup(t);await s.store.load({});await s.store.deleteTodo(op(1),s.store.todoSnapshot(101).reference);const tr=transport(s.store);tr.change({ready:true});await tick();
 await s.store.queryCurrentTodos();s.store.receiveTodo(peer,event(16,full([])));await tick();assert.equal(s.store.todoQueryStatus().phase,'complete');assert.equal(s.store.todoDeleteStatus(op(1)).query_observation,'absent');assert.equal(s.store.todoDeleteStatus(op(1)).phase,'submitted');assert.equal(s.store.todoQueryStatus().absence_is_confirmation,false);
 await s.store.queryCurrentTodos();s.store.receiveTodo(peer,event(16,{dataList:[],isLastBatch:true}));await tick();assert.equal(s.store.todoQueryStatus().phase,'incomplete');assert.equal(s.store.todoDeleteStatus(op(1)).query_observation,'incomplete');assert.equal(s.store.todos.length,0);
});
test('disconnect invalidates query, late response cannot complete it, and query status is a detached value',async t=>{
 const s=setup(t);await s.store.load({});const tr=transport(s.store);tr.change({ready:true});await s.store.queryCurrentTodos();tr.change({ready:false});s.store.receiveTodo(peer,event(16,full([])));await tick();assert.equal(s.store.todoQueryStatus().phase,'disconnected');
 const detached=s.store.todoQueryStatus();detached.phase='complete';assert.equal(s.store.todoQueryStatus().phase,'disconnected');
});
test('invalid query peer never leaves waiting and a repaired identity can query normally',async t=>{
 const s=setup(t);await s.store.load({});const tr=transport(s.store);tr.change({ready:true,peer:'invalid'});
 await assert.rejects(s.store.queryCurrentTodos(),/TODO_WRONG_PEER/);assert.equal(s.store.todoQueryStatus().phase,'idle');assert.equal(tr.writes.length,0);
 tr.change({peer});await s.store.queryCurrentTodos();assert.equal(tr.writes.length,1);assert.equal(s.store.todoQueryStatus().phase,'waiting');
});
test('reentrant lifecycle loss while publishing a query prevents the old transport send',async t=>{
 const s=setup(t);await s.store.load({});const tr=transport(s.store);tr.change({ready:true});let once=true;
 s.store.changed=()=>{if(once&&s.store.todoQueryStatus().phase==='waiting'){once=false;s.store.setTodoTransport(undefined);}};
 const result=await s.store.queryCurrentTodos();assert.equal(result.phase,'disconnected');assert.equal(tr.writes.length,0);
});
test('v2 backup tampering or tombstone identity mutation fail closed without rewriting original bytes',async t=>{
 const s=setup(t);await s.store.load({});await s.store.deleteTodo(op(1),s.store.todoSnapshot(101).reference);
 for(const field of ['backup','identity']){
   const bad=structuredClone(s.disk());if(field==='backup')bad.data_v1_backup+=' ';else{const data=JSON.parse(bad.data);data.deletions[0].todo.id=102;bad.data=JSON.stringify(data);}
   const f=setup(t,bad.data);await f.prefs.put('data_v1_backup',bad.data_v1_backup);await f.prefs.flush();const c=f.cold();await c.store.load({});assert(!c.store.ready);const before=f.raw();await assert.rejects(c.store.addTodo('不可重建'));assert.equal(f.raw(),before);
 }
});
test('list and status are read-only, deleted pagination is stable only until its persisted snapshot changes',async t=>{
 const s=setup(t);await s.store.load({});for(let i=0;i<11;i++)await s.store.addTodo('合成'+i);for(const r of [...s.store.todos])await s.store.deleteTodo(op(r.id),s.store.todoSnapshot(r.id).reference);
 const flushes=s.flushes(),page=s.store.todoPage('deleted',10);assert.equal(page.deletions.length,10);assert(page.has_more);assert.equal(s.store.todoPage('deleted',10,page.next_cursor).deletions.length,2);assert.equal(s.flushes(),flushes);
 const local=page.deletions.find(d=>d.can_cancel);await s.store.cancelTodoDelete(local.operation_id,local.state_sha256);assert.throws(()=>s.store.todoPage('deleted',10,page.next_cursor),/TODO_STALE/);
 assert.equal(s.store.todoDeleteStatus(op(999)).phase,'missing');assert.throws(()=>s.store.todoPage('active',11),/TODO_INVALID/);
});
test('todo-only firmware query filter returns a complete readback while preserving a deleted original ID',async t=>{
 const s=setup(t);await s.store.load({});await s.store.deleteTodo(op(1),s.store.todoSnapshot(101).reference);
 const tr=transport(s.store,async(b,packet)=>{
  assert.equal(b,22);const envelope=readLauncherEnvelope(packet);
  if(envelope.type!==15)return;
  const request=JSON.parse(new TextDecoder().decode(envelope.json));
  // OpenRayneo 2449baaf's captured-and-device-tested todo query uses eventType 1.
  // A peer that only answers this filter exposes the previous local silent timeout.
  if(request.eventType===1)s.store.receiveTodo(peer,event(16,full([101,102])));
 });
 tr.change({ready:true});await tick();
 const beforeAttempts=s.store.todoDeleteStatus(op(1)).attempts;
 await s.store.queryCurrentTodos();await tick();
 assert.equal(s.store.todoQueryStatus().phase,'complete');
 assert.equal(s.store.todoQueryStatus().received,2);
 assert.equal(s.store.todoQueryStatus().absence_is_confirmation,false);
 assert.equal(s.store.todoDeleteStatus(op(1)).query_observation,'present');
 assert.equal(s.store.todoDeleteStatus(op(1)).attempts,beforeAttempts);
 assert(!s.store.todos.some(row=>row.id===101),'even a complete late metadata batch cannot revive the deleted ID');
 assert(s.store.todos.some(row=>row.id===102),'the other returned todo is still imported');
});
test('current todo query accepts bounded top-level-only batches and never revives its tombstone',async t=>{
 const s=setup(t);await s.store.load({});await s.store.deleteTodo(op(1),s.store.todoSnapshot(101).reference);
 const tr=transport(s.store,async(b,packet)=>{
  const envelope=readLauncherEnvelope(packet);if(envelope.type!==15)return;
  const data=full([101,102],{scheduleTotal:3});delete data.chunkInfo;s.store.receiveTodo(peer,event(16,data));
 });
 tr.change({ready:true});await tick();await s.store.queryCurrentTodos();await tick();
 assert.equal(s.store.todoQueryStatus().phase,'complete');assert.equal(s.store.todoQueryStatus().todo_total,2);
 assert.equal(s.store.todoQueryStatus().schedule_total,3);assert.equal(s.store.todoQueryStatus().absence_is_confirmation,false);
 assert.equal(s.store.todoDeleteStatus(op(1)).phase,'submitted');assert(!s.store.todos.some(row=>row.id===101));assert(s.store.todos.some(row=>row.id===102));
});

test('an actual-shape empty chunk query completes without replaying deletion or reviving its target',async t=>{
 const s=setup(t);await s.store.load({});await s.store.deleteTodo(op(1),s.store.todoSnapshot(101).reference);
 const tr=transport(s.store,async(b,packet)=>{
  const envelope=readLauncherEnvelope(packet);if(envelope.type!==15)return;
  s.store.receiveTodo(peer,event(16,full([102],{todoTotal:1,chunkInfo:{}})));
 });
 tr.change({ready:true});await tick();await s.store.queryCurrentTodos();await tick();
 assert.equal(s.store.todoQueryStatus().phase,'complete');assert.equal(s.store.todoQueryStatus().absence_is_confirmation,false);
 const deletion=s.store.todoDeleteStatus(op(1));assert.equal(deletion.query_observation,'absent');assert.equal(deletion.attempts,1);assert.equal(deletion.phase,'submitted');
 assert(!s.store.todos.some(row=>row.id===101));assert(s.store.todos.some(row=>row.id===102));
});
