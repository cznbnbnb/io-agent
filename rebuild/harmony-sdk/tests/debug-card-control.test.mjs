import test from 'node:test';import assert from 'node:assert/strict';
import {loadApp} from './load-app.mjs';
function fixture(){
 let command,foreground=true,shows=0,removes=0,failSave=false,handler,reviewHandler,restoreHandler,uid='p10-synthetic-1',voiceCalls=[],reviewCalls=[],taskReads=0,recoveryReads=0;
 let recoveryState={phase:'protected',inspection_sha256:'e'.repeat(64),transaction_id:'',can_resume:false,reason:'',
  main:{present:true,valid:true,eligible:true,bytes:300,text_length:22,sha256:'f'.repeat(64),stage:'review',reason:''},
  partial:{present:false,valid:false,eligible:false,bytes:0,text_length:0,sha256:'',stage:'',reason:'missing'}};
 const restoreAttempts=[],restoreCalls=[],disk=new Map();
 const {DebugCardControl,DebugCardState}=loadApp('DebugCardControl');
 const ports={command:()=>command,result:id=>disk.get(id),save(id,json){if(failSave)throw Error('disk');disk.set(id,json);},foreground:()=>foreground,
  status(){const s=new DebugCardState();s.uid=uid;s.foreground=foreground;return s;},async show(){shows++;if(handler)await handler();},async remove(expected){if(expected!==uid)throw Error('uid');removes++;},
  taskStatus(){taskReads++;return {stage:'voice_authorized',draft_saved:false,capture_phase:'stopping'};},async voice(action,expected){voiceCalls.push([action,expected]);},
  async reviewCard(expected){reviewCalls.push(expected);if(reviewHandler)await reviewHandler(expected);},
  recoveryStatus(){recoveryReads++;return JSON.parse(JSON.stringify(recoveryState));},restoreDraft(source,expected){
   restoreAttempts.push([source,expected]);if(expected!==recoveryState.inspection_sha256)throw Error('TASK_RECOVERY_CHANGED');
   restoreCalls.push([source,expected]);if(restoreHandler)restoreHandler(source,expected);}};
 const c=new DebugCardControl(ports);c.enable(true);
 function put(action='show-card',extra={}){const now=Date.now(),r={schema:1,id:'dbg-'+'a'.repeat(32),action,created_at:new Date(now).toISOString(),expires_at:new Date(now+60000).toISOString(),expected_uid:action==='remove-card'?uid:'',...extra};command=JSON.stringify(r);return r;}
 return{c,ports,disk,put,result:id=>JSON.parse(disk.get(id)),reload:()=>{const n=new DebugCardControl(ports);n.enable(true);return n;},setForeground:v=>foreground=v,failSave:v=>failSave=v,onShow:f=>handler=f,onReview:f=>reviewHandler=f,onRestore:f=>restoreHandler=f,setRecovery:v=>recoveryState=v,get recovery(){return recoveryState;},get shows(){return shows;},get removes(){return removes;},voiceCalls,reviewCalls,restoreAttempts,restoreCalls,get taskReads(){return taskReads;},get recoveryReads(){return recoveryReads;}};
}
test('debug command claims before the real port, and exact retries never repeat a send',async()=>{
 const f=fixture(),r=f.put();f.onShow(()=>assert.equal(f.result(r.id).state,'running'));await f.c.poll();await f.c.poll();await f.reload().poll();
 assert.equal(f.shows,1);assert.equal(f.result(r.id).state,'complete');
});
test('release build and background commands never read the inbox or write a device',async()=>{
 const f=fixture();f.put();f.c.enable(false);await f.c.poll();f.c.enable(true);f.setForeground(false);await f.c.poll();assert.equal(f.shows,0);assert.equal(f.disk.size,0);
});
test('expired, malformed, path-like and extended commands cannot touch a device',async()=>{
 const f=fixture(),now=Date.now();let r=f.put('show-card',{created_at:new Date(now-120000).toISOString(),expires_at:new Date(now-60000).toISOString()});await f.c.poll();assert.equal(f.result(r.id).error,'DEBUG_COMMAND_EXPIRED');
 for(const extra of [{id:'../escape'},{arbitrary_payload:'not allowed'},{expires_at:new Date(now+600001).toISOString()},{expected_uid:'unrelated'},{action:'answer-task'},{action:'start-microphone'}]){f.put('show-card',extra);await f.c.poll();}
 assert.equal(f.shows,0);assert.equal(f.removes,0);
});
test('a failed durable claim sends nothing, and a cold ambiguous running record is never replayed',async()=>{
 const f=fixture(),r=f.put();f.failSave(true);await f.c.poll();assert.equal(f.shows,0);f.failSave(false);
 let release;f.onShow(()=>new Promise(resolve=>release=resolve));const work=f.c.poll();while(!release)await new Promise(setImmediate);
 assert.equal(f.result(r.id).state,'running');await f.reload().poll();assert.equal(f.shows,1);release();await work;
});
test('mutating the bytes under a used command ID fails closed instead of sending another card',async()=>{
 const f=fixture(),r=f.put();await f.c.poll();const saved=f.disk.get(r.id);f.put('remove-card',{...r,action:'remove-card',expected_uid:'p10-synthetic-1'});await f.c.poll();
 assert.equal(f.c.note,'DEBUG_JOURNAL_INVALID');assert.equal(f.disk.get(r.id),saved);assert.equal(f.removes,0);
});
test('removal is pinned to the observed experiment UID, and an uncertain write is not auto retried',async()=>{
 const f=fixture(),r=f.put('remove-card',{expected_uid:'p10-stale-uid'});await f.c.poll();assert.equal(f.result(r.id).state,'error');assert.equal(f.removes,0);
 f.put('remove-card',{id:'dbg-'+'b'.repeat(32)});await f.c.poll();assert.equal(f.removes,1);
 const g=fixture(),q=g.put();g.onShow(()=>{throw Error('uncertain transport');});await g.c.poll();await g.c.poll();assert.equal(g.shows,1);assert.equal(g.result(q.id).state,'error');
});
test('dispose during a send leaves a durable ambiguous claim, without rewriting it as complete',async()=>{
 const f=fixture(),r=f.put();let release;f.onShow(()=>new Promise(resolve=>release=resolve));const work=f.c.poll();while(!release)await new Promise(setImmediate);f.c.dispose();release();await work;
 assert.equal(f.result(r.id).state,'running');await f.reload().poll();assert.equal(f.shows,1);
});
test('schema2 read-only status never calls voice and successful finish is not a saved draft',async()=>{
 const f=fixture(),r=f.put('task-status',{schema:2,expected_voice_binding:''});await f.c.poll();assert.equal(f.voiceCalls.length,0);assert.equal(f.taskReads,1);assert.equal(f.result(r.id).task_snapshot.draft_saved,false);
 const q=f.put('voice-finish',{schema:2,id:'dbg-'+'b'.repeat(32),expected_voice_binding:'c'.repeat(64)});await f.c.poll();await f.reload().poll();
 assert.deepEqual(f.voiceCalls,[['voice-finish','c'.repeat(64)]]);assert.equal(f.result(q.id).control_call_completed,true);assert.equal(f.result(q.id).task_snapshot.capture_phase,'stopping');assert.equal(f.result(q.id).task_snapshot.draft_saved,false);assert.equal(f.shows,0);
});
test('schema separation, missing/extra fields and weak voice CAS are rejected before any claim or action',async()=>{
 const f=fixture(),invalid=[{schema:1,action:'voice-finish'},
  {schema:2,action:'show-card',expected_voice_binding:''},{schema:2,action:'voice-start',expected_voice_binding:'a'.repeat(64)},
  {schema:2,action:'voice-finish'},{schema:2,action:'voice-finish',expected_voice_binding:''},
  {schema:2,action:'voice-finish',expected_voice_binding:'A'.repeat(64)},
  {schema:2,action:'voice-cancel',expected_voice_binding:'a'.repeat(64),expected_uid:'p10-other'},
  {schema:2,action:'task-status',expected_voice_binding:'a'.repeat(64)},
  {schema:2,action:'voice-recover',expected_voice_binding:'a'.repeat(64),text:'injected'}];
 for(const extra of invalid){f.put('status',extra);await f.c.poll();}assert.equal(f.disk.size,0);assert.equal(f.taskReads,0);assert.equal(f.voiceCalls.length,0);assert.equal(f.shows,0);
});
test('cancel and recover retain durable command claims, and a changed same ID cannot choose another action',async()=>{
 const f=fixture(),r=f.put('voice-cancel',{schema:2,expected_voice_binding:'b'.repeat(64)});
 f.ports.voice=async(action,binding)=>{assert.equal(f.result(r.id).state,'running');f.voiceCalls.push([action,binding]);};await f.c.poll();
 const prior=f.disk.get(r.id);f.put('voice-recover',{...r,action:'voice-recover'});await f.c.poll();assert.equal(f.c.note,'DEBUG_JOURNAL_INVALID');assert.equal(f.disk.get(r.id),prior);assert.equal(f.voiceCalls.length,1);
});

test('schema3 displays the original review through its own port once, with a durable claim and task snapshot',async()=>{
 const f=fixture(),hash='d'.repeat(64),r=f.put('review-card',{schema:3,expected_reply_binding:hash});
 f.onReview(expected=>{assert.equal(expected,hash);assert.equal(f.result(r.id).state,'running');});
 await f.c.poll();await f.c.poll();await f.reload().poll();
 assert.deepEqual(f.reviewCalls,[hash]);assert.deepEqual(f.voiceCalls,[]);assert.equal(f.shows,0);assert.equal(f.removes,0);
 const result=f.result(r.id);assert.equal(result.state,'complete');assert.equal(result.control_call_completed,true);
 assert.equal(result.task_snapshot.draft_saved,false);assert.equal(result.task_snapshot.stage,'voice_authorized');
});

test('schema3 rejects missing, mixed, weak or injected bindings and cannot reach old card or voice actions',async()=>{
 const f=fixture(),hash='a'.repeat(64),invalid=[
  {schema:1,action:'review-card'}, {schema:2,action:'review-card',expected_voice_binding:hash},
  {schema:3,action:'review-card'}, {schema:3,action:'review-card',expected_reply_binding:''},
  {schema:3,action:'review-card',expected_reply_binding:'A'.repeat(64)},
  {schema:3,action:'review-card',expected_reply_binding:hash,expected_voice_binding:''},
  {schema:3,action:'review-card',expected_reply_binding:hash,expected_uid:'p10-other'},
  {schema:3,action:'review-card',expected_reply_binding:hash,text:'forged complete answer'},
  ...['status','task-status','show-card','remove-card','voice-finish','voice-start','submit','semantic-cmd'].map(action=>({schema:3,action,expected_reply_binding:hash}))];
 for(const extra of invalid){f.put('status',extra);await f.c.poll();}
 assert.equal(f.disk.size,0);assert.deepEqual(f.reviewCalls,[]);assert.deepEqual(f.voiceCalls,[]);assert.equal(f.taskReads,0);assert.equal(f.shows,0);
});

test('review display failure or cold running evidence is never replayed or converted into answer success',async()=>{
 const f=fixture(),r=f.put('review-card',{schema:3,expected_reply_binding:'a'.repeat(64)});let release;
 f.onReview(()=>new Promise(resolve=>release=resolve));const work=f.c.poll();while(!release)await new Promise(setImmediate);
 await f.reload().poll();assert.equal(f.reviewCalls.length,1);assert.equal(f.result(r.id).state,'running');
 f.c.dispose();release();await work;assert.equal(f.result(r.id).state,'running');
 const g=fixture(),q=g.put('review-card',{schema:3,expected_reply_binding:'b'.repeat(64)});g.onReview(()=>{throw Error('original binding changed');});
 await g.c.poll();await g.reload().poll();assert.equal(g.reviewCalls.length,1);assert.equal(g.result(q.id).state,'error');
 assert.equal(g.result(q.id).control_call_completed,false);assert.equal(g.result(q.id).task_snapshot.draft_saved,false);
});

test('schema4 read-only recovery status returns metadata after its durable claim without selecting a source',async()=>{
 const f=fixture(),r=f.put('recovery-status',{schema:4,expected_recovery_binding:'',recovery_source:''});
 const inspect=f.ports.recoveryStatus;f.ports.recoveryStatus=()=>{assert.equal(f.result(r.id).state,'running');return inspect();};
 await f.c.poll();await f.c.poll();await f.reload().poll();
 const result=f.result(r.id);assert.equal(Object.keys(JSON.parse(result.request_json)).length,8);assert.equal(result.state,'complete');
 assert.equal(result.control_call_completed,true);assert.deepEqual(result.recovery_snapshot,f.recovery);assert.equal(result.recovery_snapshot.main.text_length,22);
 assert.equal(result.task_snapshot.draft_saved,false);assert.equal(f.recoveryReads,1);assert.deepEqual(f.restoreAttempts,[]);
 assert.equal(f.shows,0);assert.equal(f.removes,0);assert.deepEqual(f.voiceCalls,[]);assert.deepEqual(f.reviewCalls,[]);
 for(const forbidden of ['private question','private condition','text','binding','route'])assert.equal(Object.hasOwn(result.recovery_snapshot,forbidden),false);
});

test('schema4 explicit local restore claims first and is never repeated by the same command or cold poller',async()=>{
 for(const source of ['main','partial','resume']){
  const f=fixture(),hash=f.recovery.inspection_sha256,r=f.put('recovery-restore',{schema:4,expected_recovery_binding:hash,recovery_source:source});
  f.onRestore((selected,expected)=>{assert.equal(selected,source);assert.equal(expected,hash);assert.equal(f.result(r.id).state,'running');});
  await f.c.poll();await f.c.poll();await f.reload().poll();const result=f.result(r.id);
  assert.deepEqual(f.restoreCalls,[[source,hash]]);assert.equal(result.state,'complete');assert.equal(result.control_call_completed,true);
  assert.equal(result.task_snapshot.draft_saved,false,'control completion is not an answered task');assert.deepEqual(result.recovery_snapshot,f.recovery);
  assert.equal(f.shows,0);assert.equal(f.removes,0);assert.deepEqual(f.voiceCalls,[]);assert.deepEqual(f.reviewCalls,[]);
 }
});

test('schema4 rejects weak or mixed bindings, injected contents and arbitrary paths before any claim',async()=>{
 const f=fixture(),hash='e'.repeat(64),valid={schema:4,action:'recovery-restore',expected_recovery_binding:hash,recovery_source:'partial'},invalid=[
  {...valid,id:'../escape'}, {...valid,expected_recovery_binding:''}, {...valid,expected_recovery_binding:'E'.repeat(64)},
  {...valid,expected_recovery_binding:'e'.repeat(63)}, {...valid,recovery_source:'unknown'}, {...valid,recovery_source:'../main'},
  {...valid,recovery_source:'D:/private/task-decision-draft.json'}, {...valid,recovery_source:''}, {...valid,expected_uid:'p10-other'},
  {...valid,text:'injected complete answer'}, {...valid,path:'task-decision-draft.json'}, {...valid,expected_voice_binding:''},
  {...valid,expected_reply_binding:hash}, {...valid,schema:1}, {...valid,schema:2}, {...valid,schema:3},
  {schema:4,action:'recovery-restore',expected_recovery_binding:hash}, {schema:4,action:'recovery-restore',recovery_source:'main'},
  {schema:4,action:'recovery-status',expected_recovery_binding:hash,recovery_source:''},
  {schema:4,action:'recovery-status',expected_recovery_binding:'',recovery_source:'main'},
  ...['status','show-card','remove-card','task-status','voice-finish','review-card','voice-start','submit'].map(action=>({...valid,action}))];
 for(const extra of invalid){f.put('status',extra);await f.c.poll();}
 assert.equal(f.disk.size,0);assert.equal(f.taskReads,0);assert.equal(f.recoveryReads,0);assert.deepEqual(f.restoreAttempts,[]);
 assert.equal(f.shows,0);assert.equal(f.removes,0);assert.deepEqual(f.voiceCalls,[]);assert.deepEqual(f.reviewCalls,[]);
});

test('wrong recovery CAS is a terminal control error and returns current metadata without claiming task completion',async()=>{
 const f=fixture(),r=f.put('recovery-restore',{schema:4,expected_recovery_binding:'b'.repeat(64),recovery_source:'partial'});
 await f.c.poll();await f.reload().poll();const result=f.result(r.id);
 assert.equal(result.state,'error');assert.equal(result.error,'DEBUG_OPERATION_FAILED');assert.equal(result.control_call_completed,false);
 assert.deepEqual(f.restoreAttempts,[['partial','b'.repeat(64)]]);assert.deepEqual(f.restoreCalls,[]);assert.deepEqual(result.recovery_snapshot,f.recovery);
 assert.equal(result.task_snapshot.draft_saved,false);assert.equal(f.shows,0);assert.deepEqual(f.voiceCalls,[]);
});

test('interrupted restore returns resumable metadata but neither retries its ID nor treats the task as answered',async()=>{
 const f=fixture(),hash=f.recovery.inspection_sha256,r=f.put('recovery-restore',{schema:4,expected_recovery_binding:hash,recovery_source:'partial'});
 f.onRestore(()=>{f.setRecovery({...f.recovery,inspection_sha256:'a'.repeat(64),can_resume:true});throw Error('synthetic local rename interrupted');});
 await f.c.poll();await f.c.poll();await f.reload().poll();const result=f.result(r.id);
 assert.equal(result.state,'error');assert.equal(result.control_call_completed,false);assert.equal(result.recovery_snapshot.can_resume,true);
 assert.equal(result.recovery_snapshot.inspection_sha256,'a'.repeat(64));assert.equal(result.task_snapshot.draft_saved,false);assert.equal(f.restoreCalls.length,1);
 assert.equal(f.shows,0);assert.equal(f.removes,0);assert.deepEqual(f.voiceCalls,[]);assert.deepEqual(f.reviewCalls,[]);
});

test('failed recovery claim and cold running recovery never execute or replay a local restoration',async()=>{
 const f=fixture();f.put('recovery-restore',{schema:4,expected_recovery_binding:f.recovery.inspection_sha256,recovery_source:'main'});
 f.failSave(true);await f.c.poll();assert.deepEqual(f.restoreAttempts,[]);assert.equal(f.recoveryReads,0);
 const g=fixture(),r=g.put('recovery-restore',{schema:4,expected_recovery_binding:g.recovery.inspection_sha256,recovery_source:'partial'});
 g.onRestore(()=>g.c.dispose());await g.c.poll();assert.equal(g.result(r.id).state,'running');await g.reload().poll();assert.equal(g.restoreCalls.length,1);
 assert.equal(g.result(r.id).control_call_completed,false);assert.equal(g.shows,0);assert.deepEqual(g.voiceCalls,[]);
});

test('changing source or CAS under an already claimed recovery ID cannot restore another selection',async()=>{
 const f=fixture(),r=f.put('recovery-restore',{schema:4,expected_recovery_binding:f.recovery.inspection_sha256,recovery_source:'main'});
 await f.c.poll();const prior=f.disk.get(r.id);f.put('recovery-restore',{...r,recovery_source:'partial'});await f.c.poll();
 assert.equal(f.c.note,'DEBUG_JOURNAL_INVALID');assert.equal(f.disk.get(r.id),prior);assert.equal(f.restoreCalls.length,1);
 f.put('recovery-restore',{...r,expected_recovery_binding:'b'.repeat(64)});await f.c.poll();assert.equal(f.c.note,'DEBUG_JOURNAL_INVALID');assert.equal(f.disk.get(r.id),prior);assert.equal(f.restoreCalls.length,1);
});

const localFilter=(extra={})=>({from:0,to:0,keyword:'运费',speaker:'',limit:10,cursor:'',...extra});
test('schema5 local search returns actual references and incomplete coverage without touching task, recovery, voice or card controls',async()=>{
 const f=fixture(),filter=localFilter(),r=f.put('search-local',{schema:5,local_query:filter});let queries=0;
 const page={schema:1,scope:'local_canonical_only',hits:[{reference:{material_id:'local-material',revision:3,text_revision:2,utterance_id:'utterance-1',content_sha256:'d'.repeat(64),
  source_range:{parent_utterance_id:'parent-1',parent_revision:1,start_ms:100,end_ms:900,text_start:0,text_end:4}},start_ms:null,end_ms:null,excerpt:'运费沿用上次',speaker_id:'speaker-0',speaker_label:'发言人A',transcription_state:'partial'}],
  next_cursor:'a'.repeat(64)+':1',has_more:true,snapshot_sha256:'a'.repeat(64),scanned:1,unreadable:1,incomplete:true,incomplete_reason:'unreadable',legacy_not_indexed:true};
 f.ports.localQuery=value=>{queries++;assert.equal(f.result(r.id).state,'running');assert.deepEqual(value,filter);return page;};
 await f.c.poll();await f.c.poll();await f.reload().poll();const result=f.result(r.id);
 assert.equal(queries,1);assert.equal(result.state,'complete');assert.equal(result.control_call_completed,true);assert.deepEqual(result.local_query,page);
 assert.equal(Object.keys(JSON.parse(result.request_json)).length,7);assert.equal(Object.hasOwn(result,'task_snapshot'),false);assert.equal(Object.hasOwn(result,'recovery_snapshot'),false);
 assert.equal(f.taskReads,0);assert.equal(f.recoveryReads,0);assert.equal(f.shows,0);assert.equal(f.removes,0);assert.deepEqual(f.voiceCalls,[]);assert.deepEqual(f.reviewCalls,[]);assert.deepEqual(f.restoreAttempts,[]);
});
test('schema5 rejects mixed commands, date-only or malformed filters before reading any local material',async()=>{
 const f=fixture();let queries=0;f.ports.localQuery=()=>{queries++;throw Error('must not read');};
 const badFilters=[{},null,[],localFilter({extra:'unknown'}),localFilter({from:-1}),localFilter({from:true}),localFilter({from:1,to:0}),localFilter({from:0,to:367*86400000}),
  localFilter({from:2,to:2}),localFilter({to:Infinity}),localFilter({from:8640000000000000,to:8640000000000001}),localFilter({keyword:' ',speaker:'',from:1000,to:2000}),localFilter({keyword:'中'.repeat(201)}),localFilter({keyword:'\ud800'}),
  localFilter({keyword:'\u0080'}),localFilter({speaker:'\n甲'}),localFilter({speaker:'人'.repeat(81)}),localFilter({limit:0}),localFilter({limit:11}),localFilter({limit:true}),
  localFilter({cursor:'A'.repeat(64)+':1'}),localFilter({cursor:'a'.repeat(64)+':01'}),localFilter({cursor:'a'.repeat(64)+':9007199254740992'})];
 for(const filter of badFilters){f.put('search-local',{schema:5,local_query:filter});await f.c.poll();}
 for(const extra of [{schema:4},{expected_uid:'p10-other'},{expected_voice_binding:''},{expected_reply_binding:'a'.repeat(64)},{path:'../recordings'},
  ...['show-card','task-status','voice-start','recovery-restore','submit'].map(action=>({action}))]){
  f.put('search-local',{schema:5,local_query:localFilter(),...extra});await f.c.poll();
 }
 assert.equal(queries,0);assert.equal(f.disk.size,0);assert.equal(f.taskReads,0);assert.equal(f.recoveryReads,0);assert.deepEqual(f.voiceCalls,[]);assert.equal(f.shows,0);
});
test('schema5 query failure and same-ID filter changes remain frozen without snapshots of unrelated tasks',async()=>{
 const f=fixture(),r=f.put('search-local',{schema:5,local_query:localFilter()});let reads=0;
 f.ports.localQuery=()=>{reads++;throw Error('LOCAL_QUERY_STALE');};await f.c.poll();await f.reload().poll();const saved=f.disk.get(r.id);
 assert.equal(f.result(r.id).state,'error');assert.equal(f.result(r.id).error,'LOCAL_QUERY_STALE');assert.equal(f.result(r.id).control_call_completed,false);assert.equal(f.taskReads,0);assert.equal(f.recoveryReads,0);assert.equal(reads,1);
 f.put('search-local',{...r,local_query:localFilter({keyword:'新问题'})});await f.c.poll();assert.equal(f.c.note,'DEBUG_JOURNAL_INVALID');assert.equal(f.disk.get(r.id),saved);assert.equal(reads,1);
 const missing=fixture(),q=missing.put('search-local',{schema:5,local_query:localFilter({keyword:'',speaker:'发言人A'})});await missing.c.poll();assert.equal(missing.result(q.id).state,'error');assert.equal(missing.taskReads,0);
});

const summaryFilter=(extra={})=>({day:'2026-10-15',limit:10,cursor:'',...extra});
const summaryRead=(extra={})=>({day:'2026-10-15',summary_id:'saved-2026-10-15-cache',content_sha256:'a'.repeat(64),offset:0,max_chars:4000,...extra});
test('schema6 lists metadata through its shared read-only port once and never reads an unrelated task',async()=>{
 const f=fixture(),filter=summaryFilter(),r=f.put('list-summaries',{schema:6,saved_summary:filter});let calls=0;
 const page={schema:1,scope:'local_saved_journals',day:filter.day,items:[{reference:{day:filter.day,summary_id:'saved-'+filter.day+'-cache',content_sha256:'a'.repeat(64)},
  state:'current',can_open:true,producer:'unknown',generated_at:'',bytes:300,source_sha256:'b'.repeat(64),file_kind:'day_cache'}],next_cursor:'',has_more:false,snapshot_sha256:'c'.repeat(64),scanned:1,unreadable:0,incomplete:false,incomplete_reason:''};
 f.ports.summaryList=value=>{calls++;assert.equal(f.result(r.id).state,'running');assert.deepEqual(value,filter);return page;};
 await f.c.poll();await f.c.poll();await f.reload().poll();const result=f.result(r.id);
 assert.equal(result.state,'complete');assert.equal(result.control_call_completed,true);assert.deepEqual(result.saved_summaries,page);assert.equal(calls,1);
 assert.equal(Object.keys(JSON.parse(result.request_json)).length,7);for(const key of ['task_snapshot','recovery_snapshot','local_query','saved_summary'])assert.equal(Object.hasOwn(result,key),false);
 assert.equal(f.taskReads,0);assert.equal(f.recoveryReads,0);assert.equal(f.shows,0);assert.equal(f.removes,0);assert.deepEqual(f.voiceCalls,[]);assert.deepEqual(f.reviewCalls,[]);assert.deepEqual(f.restoreAttempts,[]);
});
test('schema6 reads one explicit UTF16 chunk with the full-file reference and never refetches or replays another offset',async()=>{
 const f=fixture(),selection=summaryRead({offset:2,max_chars:4}),r=f.put('read-summary',{schema:6,saved_summary:selection}),calls=[];
 const chunk={schema:1,reference:{day:selection.day,summary_id:selection.summary_id,content_sha256:selection.content_sha256},source_sha256:'b'.repeat(64),markdown:'😀中文',offset:2,next_offset:6,total_utf16:20,has_more:true};
 f.ports.summaryRead=(ref,offset,max)=>{calls.push([ref,offset,max]);assert.equal(f.result(r.id).state,'running');return chunk;};
 await f.c.poll();await f.reload().poll();const prior=f.disk.get(r.id),result=f.result(r.id);
 assert.equal(result.state,'complete');assert.deepEqual(result.saved_summary,chunk);assert.deepEqual(JSON.parse(JSON.stringify(calls)),[[chunk.reference,2,4]]);assert.equal(calls.length,1);
 f.put('read-summary',{...r,saved_summary:summaryRead({offset:6,max_chars:4})});await f.c.poll();assert.equal(f.c.note,'DEBUG_JOURNAL_INVALID');assert.equal(f.disk.get(r.id),prior);assert.equal(calls.length,1);
 assert.equal(f.taskReads,0);assert.equal(f.recoveryReads,0);assert.equal(f.shows,0);assert.deepEqual(f.voiceCalls,[]);assert.deepEqual(f.reviewCalls,[]);
});
test('schema6 rejects malformed dates, ref traversal, mixed bindings and bounds before a claim or any read',async()=>{
 const f=fixture();let reads=0;f.ports.summaryList=()=>{reads++;};f.ports.summaryRead=()=>{reads++;};
 const badLists=[{},null,[],summaryFilter({day:'2026-02-29'}),summaryFilter({day:'2026-04-31'}),summaryFilter({day:'1969-12-31'}),summaryFilter({day:'10000-01-01'}),
  summaryFilter({day:'2026-1-01'}),summaryFilter({limit:0}),summaryFilter({limit:11}),summaryFilter({limit:true}),summaryFilter({cursor:'a'.repeat(64)+':01'}),summaryFilter({cursor:'a'.repeat(64)+':9007199254740992'}),summaryFilter({path:'../private'})];
 const badReads=[summaryRead({summary_id:'../day-2026-10-15.md'}),summaryRead({summary_id:'saved-2026-10-16-cache'}),summaryRead({summary_id:'saved-2026-10-15-'+'A'.repeat(64)}),summaryRead({content_sha256:'A'.repeat(64)}),
  summaryRead({content_sha256:''}),summaryRead({offset:-1}),summaryRead({offset:2097153}),summaryRead({offset:true}),summaryRead({max_chars:1}),summaryRead({max_chars:4001}),summaryRead({extra:'body'}),summaryRead({day:'2026-02-29'})];
 for(const [action,values] of [['list-summaries',badLists],['read-summary',badReads]])for(const value of values){f.put(action,{schema:6,saved_summary:value});await f.c.poll();}
 for(const extra of [{schema:5},{expected_uid:'p10-other'},{expected_voice_binding:''},{expected_reply_binding:'a'.repeat(64)},{local_query:localFilter()},
  ...['show-card','voice-finish','task-status','recovery-restore','search-local'].map(action=>({action}))]){f.put('list-summaries',{schema:6,saved_summary:summaryFilter(),...extra});await f.c.poll();}
 assert.equal(reads,0);assert.equal(f.disk.size,0);assert.equal(f.taskReads,0);assert.equal(f.recoveryReads,0);assert.equal(f.shows,0);assert.deepEqual(f.voiceCalls,[]);
});
test('schema6 read errors are whitelisted without private error text, and the old command receipt is not re-evaluated',async()=>{
 for(const [message,expected] of [['SAVED_SUMMARY_STALE','SAVED_SUMMARY_STALE'],['SAVED_SUMMARY_INVALID','SAVED_SUMMARY_INVALID'],['D:/private/source.md secret model text','DEBUG_OPERATION_FAILED']]){
  const f=fixture(),r=f.put('read-summary',{schema:6,saved_summary:summaryRead()}),calls=[];f.ports.summaryRead=()=>{calls.push(1);throw Error(message);};
  await f.c.poll();await f.reload().poll();const result=f.result(r.id);assert.equal(result.state,'error');assert.equal(result.error,expected);assert.equal(calls.length,1);
  assert.equal(result.control_call_completed,false);assert.equal(Object.hasOwn(result,'saved_summary'),false);assert.equal(f.taskReads,0);assert.equal(f.recoveryReads,0);
  if(expected!==message)assert.equal(JSON.stringify(result).includes(message),false);
 }
 const f=fixture(),r=f.put('list-summaries',{schema:6,saved_summary:summaryFilter()});await f.c.poll();assert.equal(f.result(r.id).error,'DEBUG_OPERATION_FAILED');
});

const noteOperation='noteop-2026-10-15-'+'d'.repeat(32),noteRef={day:'2026-10-15',note_id:'note-2026-10-15-'+'d'.repeat(32),content_sha256:'c'.repeat(64)};
test('schema7 save/resume loads exact staged input after claim and cleans only after a durable terminal receipt',async()=>{
 for(const action of ['save-summary-note','resume-summary-note']){
  const f=fixture(),body={operation_id:noteOperation,parent:{day:'2026-10-15',summary_id:'saved-2026-10-15-cache',content_sha256:'b'.repeat(64)},source_sha256:'e'.repeat(64),text:'完整附注😀\n保留所有内容'},events=[];
  const r=f.put(action,{schema:7,annotation:{operation_id:noteOperation,body_sha256:'a'.repeat(64)}});
  f.ports.noteInput=(id,sha,op)=>{events.push('read');assert.equal(id,r.id);assert.equal(sha,'a'.repeat(64));assert.equal(op,noteOperation);assert.equal(f.result(id).state,'running');return body;};
  f.ports.noteSave=(input,resume)=>{events.push('save');assert.equal(input,body);assert.equal(resume,action==='resume-summary-note');return{schema:1,operation_id:noteOperation,state:'saved',reference:noteRef,can_open:true,replayed:false};};
  f.ports.noteCleanup=(id,sha)=>{events.push('cleanup');assert.equal(f.result(id).state,'complete');assert.equal(sha,'a'.repeat(64));};
  await f.c.poll();assert.deepEqual(events,['read','save','cleanup']);await f.reload().poll();assert.deepEqual(events,['read','save','cleanup','cleanup']);
  const result=f.result(r.id);assert.equal(result.summary_note_receipt.state,'saved');assert.equal(result.control_call_completed,true);
  for(const field of ['task_snapshot','recovery_snapshot','saved_summary','local_query','summary_note_chunk','summary_notes'])assert.equal(Object.hasOwn(result,field),false);
  assert.equal(JSON.stringify(result).includes(body.text),false);assert.equal(f.taskReads,0);assert.equal(f.recoveryReads,0);assert.equal(f.shows,0);assert.deepEqual(f.voiceCalls,[]);
 }
});
test('schema7 final receipt failure leaves running attachment evidence and never auto-repeats a committed note',async()=>{
 const f=fixture(),r=f.put('save-summary-note',{schema:7,annotation:{operation_id:noteOperation,body_sha256:'a'.repeat(64)}});let writes=0,saves=0,cleanups=0;
 const persist=f.ports.save;f.ports.save=(id,json)=>{if(++writes===2)throw Error('disk-final');persist(id,json);};f.ports.noteInput=()=>({operation_id:noteOperation});
 f.ports.noteSave=()=>{saves++;return{schema:1,operation_id:noteOperation,state:'saved'};};f.ports.noteCleanup=()=>{cleanups++;};
 await f.c.poll();assert.equal(f.result(r.id).state,'running');await f.reload().poll();assert.equal(saves,1);assert.equal(cleanups,0);
 const before=f.disk.get(r.id);f.put('save-summary-note',{...r,annotation:{operation_id:noteOperation,body_sha256:'f'.repeat(64)}});await f.c.poll();
 assert.equal(f.c.note,'DEBUG_JOURNAL_INVALID');assert.equal(f.disk.get(r.id),before);assert.equal(saves,1);assert.equal(cleanups,0);
});
test('schema7 status/list/read route to independent notes metadata and explicit md/json chunks',async()=>{
 for(const action of ['summary-note-status','list-summary-notes','read-summary-note']){
  const f=fixture(),selection=action==='summary-note-status'?{operation_id:noteOperation}:action==='list-summary-notes'?summaryFilter():{...noteRef,format:'json',offset:4,max_chars:4000};
  const r=f.put(action,{schema:7,annotation:selection}),calls=[];
  f.ports.noteStatus=op=>{calls.push(['status',op]);return{schema:1,operation_id:op,state:'pending'};};
  f.ports.noteList=filter=>{calls.push(['list',filter]);return{schema:1,scope:'local_summary_notes',items:[],incomplete:true,incomplete_reason:'unreadable'};};
  f.ports.noteRead=(ref,format,offset,max)=>{calls.push(['read',ref,format,offset,max]);return{schema:1,reference:ref,format,text:'😀',offset,next_offset:offset+2,total_utf16:20,has_more:true};};
  f.ports.noteInput=()=>{throw Error('must not read attachment');};f.ports.summaryRead=()=>{throw Error('not schema6');};
  await f.c.poll();assert.equal(f.result(r.id).state,'complete');assert.equal(calls.length,1);
  if(action==='read-summary-note'){assert.deepEqual(JSON.parse(JSON.stringify(calls[0])),['read',noteRef,'json',4,4000]);assert.equal(f.result(r.id).summary_note_chunk.has_more,true);}
  assert.equal(f.taskReads,0);assert.equal(f.recoveryReads,0);assert.equal(f.shows,0);assert.deepEqual(f.restoreAttempts,[]);
 }
});
test('schema7 rejects cross-schema flags, invalid operation dates, paths and oversized note chunk bounds before claim',async()=>{
 const f=fixture();let reads=0;f.ports.noteInput=()=>{reads++;};const valid={operation_id:noteOperation,body_sha256:'a'.repeat(64)};
 const bad=[{...valid,operation_id:'noteop-'+'a'.repeat(32)},{...valid,operation_id:'noteop-2026-02-29-'+'a'.repeat(32)},
  {...valid,body_sha256:'A'.repeat(64)},{...valid,path:'../secret'},{operation_id:noteOperation},null,[]];
 for(const annotation of bad){f.put('save-summary-note',{schema:7,annotation});await f.c.poll();}
 for(const annotation of [{...noteRef,format:'txt',offset:0,max_chars:4000},{...noteRef,format:'md',offset:8388609,max_chars:4000},
  {...noteRef,format:'md',offset:0,max_chars:1},{...noteRef,note_id:'note-2026-10-16-'+'d'.repeat(32),format:'md',offset:0,max_chars:4000}]){f.put('read-summary-note',{schema:7,annotation});await f.c.poll();}
 for(const extra of [{schema:6},{expected_uid:'p10-other'},{saved_summary:summaryFilter()},{local_query:localFilter()},
  ...['show-card','task-status','voice-finish','read-summary','recovery-restore'].map(action=>({action}))]){f.put('save-summary-note',{schema:7,annotation:valid,...extra});await f.c.poll();}
 assert.equal(f.disk.size,0);assert.equal(reads,0);assert.equal(f.taskReads,0);assert.equal(f.recoveryReads,0);assert.equal(f.shows,0);
});
test('schema7 errors are bounded codes and failed attachment cleanup cannot rewrite the saved operation receipt',async()=>{
 for(const [message,expected] of [['NOTE_INVALID','NOTE_INVALID'],['NOTE_STALE','NOTE_STALE'],['NOTE_CONFLICT','NOTE_CONFLICT'],['NOTE_BLOCKED','NOTE_BLOCKED'],['NOTE_IO','NOTE_IO'],['D:/private/full note secret','DEBUG_OPERATION_FAILED']]){
  const f=fixture(),r=f.put('save-summary-note',{schema:7,annotation:{operation_id:noteOperation,body_sha256:'a'.repeat(64)}});let cleanup=0;
  f.ports.noteInput=()=>{throw Error(message);};f.ports.noteSave=()=>{throw Error('must not save');};f.ports.noteCleanup=()=>{cleanup++;assert.equal(f.result(r.id).state,'error');throw Error('unlink');};
  await f.c.poll();const saved=f.disk.get(r.id);assert.equal(f.result(r.id).error,expected);assert.equal(f.result(r.id).control_call_completed,false);assert.equal(cleanup,1);
  await f.reload().poll();assert.equal(f.disk.get(r.id),saved);assert.equal(cleanup,2);if(message!==expected)assert.equal(saved.includes(message),false);
 }
});
test('schema7 explicit pending read returns complete 8K input without saving or resuming and stays below the receipt boundary',async()=>{
 const f=fixture(),sha='a'.repeat(64),r=f.put('read-summary-note-pending',{schema:7,annotation:{operation_id:noteOperation,input_sha256:sha}}),text='\u001f'.repeat(8192);let reads=0;
 f.ports.notePending=(op,expected)=>{reads++;assert.equal(op,noteOperation);assert.equal(expected,sha);return{operation_id:op,parent:{day:'2026-10-15',summary_id:'saved-2026-10-15-cache',content_sha256:'b'.repeat(64)},source_sha256:'c'.repeat(64),text};};
 f.ports.noteSave=()=>{throw Error('pending read cannot resume');};await f.c.poll();await f.reload().poll();const saved=f.disk.get(r.id),result=f.result(r.id);
 assert.equal(reads,1);assert.equal(result.summary_note_pending.text,text);assert.equal(result.summary_note_pending.text.length,8192);assert.ok(Buffer.byteLength(saved)<65536);
 assert.equal(result.control_call_completed,true);assert.equal(Object.hasOwn(result,'summary_note_receipt'),false);assert.equal(f.taskReads,0);assert.equal(f.recoveryReads,0);assert.equal(f.shows,0);
 const invalid=fixture();invalid.put('read-summary-note-pending',{schema:7,annotation:{operation_id:noteOperation,input_sha256:''}});await invalid.c.poll();assert.equal(invalid.disk.size,0);
});

const playbackSource=(extra={})=>({kind:'recording',name:'take-'+'a'.repeat(32),revision:0,utterance_id:'',...extra});
const playbackState=(extra={})=>({schema:1,session_id:'playback-'+'b'.repeat(32),phase:'paused',position_ms:2345,position_known:true,duration_ms:10000,duration_known:true,
 native_state:'paused',callback_seq:3,error:'',note:'',audio_output_verified:false,...extra});

test('schema8 routes only closed playback controls after durable claim and never turns callback state into heard evidence',async()=>{
 const actions=[['playback-status',{}],['playback-play',playbackSource({revision:2,utterance_id:'original-part'})],
  ...['playback-pause','playback-resume','playback-stop'].map(action=>[action,{session_id:'playback-'+'b'.repeat(32)}]),
  ['playback-seek',{session_id:'playback-'+'b'.repeat(32),position_ms:5000}]];
 for(const [action,selection] of actions){
  const f=fixture(),r=f.put(action,{schema:8,playback:selection}),calls=[],state=playbackState();
  const accept=(...args)=>{assert.equal(f.result(r.id).state,'running');calls.push(args);return state;};
  f.ports.playbackStatus=()=>accept('status');f.ports.playbackPlay=async source=>accept('play',source);
  f.ports.playbackPause=async id=>accept('pause',id);f.ports.playbackResume=async id=>accept('resume',id);
  f.ports.playbackSeek=async(id,pos)=>accept('seek',id,pos);f.ports.playbackStop=async id=>accept('stop',id);
  await f.c.poll();await f.c.poll();await f.reload().poll();const result=f.result(r.id);
  assert.equal(result.state,'complete');assert.equal(result.control_call_completed,true);assert.deepEqual(result.playback_snapshot,state);assert.equal(result.playback_snapshot.audio_output_verified,false);
  assert.equal(Object.keys(JSON.parse(result.request_json)).length,7);assert.equal(calls.length,1);
  const expected=action==='playback-play'?['play',selection]:action==='playback-status'?['status']:action==='playback-seek'?['seek',selection.session_id,5000]:[action.slice(9),selection.session_id];
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0])),expected);
  for(const key of ['task_snapshot','recovery_snapshot','local_query','saved_summaries','saved_summary','summary_note_receipt','summary_note_pending'])assert.equal(Object.hasOwn(result,key),false);
  assert.equal(f.taskReads,0);assert.equal(f.recoveryReads,0);assert.equal(f.shows,0);assert.equal(f.removes,0);assert.deepEqual(f.voiceCalls,[]);assert.deepEqual(f.restoreAttempts,[]);
 }
});

test('schema8 rejects paths, caller play offsets, malformed anchors, sessions, seek bounds and mixed schemas before claim',async()=>{
 const f=fixture();let calls=0;for(const name of ['playbackPlay','playbackStatus','playbackPause','playbackResume','playbackSeek','playbackStop'])f.ports[name]=()=>{calls++;};
 const invalidPlay=[null,[],{},playbackSource({name:'../audio.wav'}),playbackSource({kind:'journal'}),playbackSource({kind:'lifelog'}),playbackSource({name:'take-'+'A'.repeat(32)}),
  playbackSource({revision:1}),playbackSource({utterance_id:'part'}),playbackSource({revision:true}),playbackSource({revision:1000000000,utterance_id:'part'}),
  playbackSource({revision:1,utterance_id:'x'.repeat(257)}),playbackSource({revision:1,utterance_id:'bad\npart'}),playbackSource({path:'audio.wav'}),playbackSource({position_ms:0})];
 for(const playback of invalidPlay){f.put('playback-play',{schema:8,playback});await f.c.poll();}
 for(const playback of [null,[],false,'',0,{session_id:''},{path:'audio.wav'}]){f.put('playback-status',{schema:8,playback});await f.c.poll();}
 for(const action of ['playback-pause','playback-resume','playback-stop'])for(const playback of [{},{session_id:''},{session_id:'../other'},{session_id:'x'.repeat(129)},{session_id:'playback-safe',position_ms:0}]){
  f.put(action,{schema:8,playback});await f.c.poll();
 }
 for(const position_ms of [-1,86400001,1.5,true,null]){f.put('playback-seek',{schema:8,playback:{session_id:'playback-safe',position_ms}});await f.c.poll();}
 for(const extra of [{schema:7},{expected_uid:'p10-other'},{expected_voice_binding:''},{expected_reply_binding:''},{expected_recovery_binding:'',recovery_source:''},
  {local_query:localFilter()},{saved_summary:summaryFilter()},{annotation:{operation_id:noteOperation}},...['show-card','voice-start','task-status','search-local','save-summary-note'].map(action=>({action}))]){
  f.put('playback-play',{schema:8,playback:playbackSource(),...extra});await f.c.poll();
 }
 assert.equal(f.disk.size,0);assert.equal(calls,0);assert.equal(f.taskReads,0);assert.equal(f.recoveryReads,0);assert.equal(f.shows,0);assert.deepEqual(f.voiceCalls,[]);
});

test('schema8 ambiguous play is not replayed after dispose or final-save failure and a reused id cannot select another source',async()=>{
 const f=fixture(),r=f.put('playback-play',{schema:8,playback:playbackSource()});let release,plays=0;
 f.ports.playbackPlay=()=>{plays++;return new Promise(resolve=>release=resolve);};const work=f.c.poll();while(!release)await new Promise(setImmediate);
 assert.equal(f.result(r.id).state,'running');await f.reload().poll();assert.equal(plays,1);f.c.dispose();release(playbackState());await work;
 assert.equal(f.result(r.id).state,'running');await f.reload().poll();assert.equal(plays,1);
 const g=fixture(),q=g.put('playback-play',{schema:8,playback:playbackSource()}),persist=g.ports.save;let writes=0,effects=0;
 g.ports.save=(id,json)=>{if(++writes===2)throw Error('final receipt unavailable');persist(id,json);};g.ports.playbackPlay=async()=>{effects++;return playbackState();};
 await g.c.poll();assert.equal(g.result(q.id).state,'running');await g.reload().poll();assert.equal(effects,1);
 const before=g.disk.get(q.id);g.put('playback-play',{...q,playback:playbackSource({name:'take-'+'c'.repeat(32)})});await g.reload().poll();
 assert.equal(g.disk.get(q.id),before);assert.equal(effects,1);
});

test('schema8 only returns safe playback errors plus current metadata and old schemas acquire no playback result key',async()=>{
 for(const [message,expected] of [['PLAYBACK_STALE_SESSION','PLAYBACK_STALE_SESSION'],['PLAYBACK_SOURCE_CHANGED','PLAYBACK_SOURCE_CHANGED'],['PLAYBACK_CLEANUP_PENDING','PLAYBACK_CLEANUP_PENDING'],['D:/private/raw.wav native secret','DEBUG_OPERATION_FAILED']]){
  const f=fixture(),r=f.put('playback-stop',{schema:8,playback:{session_id:'playback-old'}});let calls=0;
  f.ports.playbackStop=async()=>{calls++;throw Error(message);};f.ports.playbackStatus=()=>playbackState({phase:'blocked',error:'PLAYBACK_CLEANUP_PENDING'});
  await f.c.poll();await f.reload().poll();const result=f.result(r.id);assert.equal(result.error,expected);assert.equal(result.control_call_completed,false);assert.equal(calls,1);
  assert.equal(result.playback_snapshot.phase,'blocked');assert.equal(result.playback_snapshot.audio_output_verified,false);if(message!==expected)assert.equal(JSON.stringify(result).includes(message),false);
 }
 const f=fixture(),r=f.put('status');await f.c.poll();assert.equal(Object.hasOwn(f.result(r.id),'playback_snapshot'),false);
});
