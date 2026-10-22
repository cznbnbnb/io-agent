import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {loadApp} from './load-app.mjs';
import {setupMaterialStore} from './material-fixture.mjs';
const clone=v=>JSON.parse(JSON.stringify(v));
function fixture(t){
 const f=setupMaterialStore(t),mod=loadApp('TaskReplyDraft',{'@kit.CoreFileKit':{fileIo:f.io}}),binding=new mod.TaskReplyBinding(),now=Date.now();
 Object.assign(binding,{context_key:'synthetic-owner-phone-server-route',operation_id:'reply-original-1',request_id:'question-original',request_revision:3,
  task_id:'task-original',route:{computer_id:'pc',agent_id:'hermes',project_id:'project',session_id:'original-session'},expires_at:new Date(now+60000).toISOString(),question:'是否采用新价格？',mode:'free_text'});
 const create=()=>{const d=new mod.TaskDecisionDraft();d.initialize(f.root);return d;},d=create(),plan=new mod.TaskDecisionPlan();
 const arm=(stage='proposal',n=1)=>{const uid=binding.operation_id+'-'+stage+'-'+n;d.armCard(binding.context_key,'synthetic-peer',uid,now);return uid;};
 const choose=(uid,cmd)=>d.suggestion(binding.context_key,'synthetic-peer',34,uid,cmd,now),remove=uid=>d.removalSubmitted('synthetic-peer',uid);
 return {...f,...mod,binding,now,d,plan,create,arm,choose,remove,key:binding.context_key};
}
function review(f,text='旧版完整答案：采用新价格'){
 f.d.begin(f.binding,f.plan,f.now);const uid=f.arm();f.choose(uid,1);f.remove(uid);f.d.edit(f.key,text,f.now);
}
function assertFrozen(f,d,main,partial,snapshot){
 assert.equal(d.blocked,true);assert.equal(d.paused,true);assert.deepEqual(clone(d.snapshot()),snapshot);
 assert.throws(()=>d.seal(f.key,f.now));assert.throws(()=>d.resume(f.binding,f.now));
 assert.throws(()=>d.begin({...f.binding,operation_id:'reply-replacement'},f.plan,f.now));
 assert.deepEqual(fs.readFileSync(f.root+'/task-decision-draft.json'),main);
 assert.deepEqual(fs.readFileSync(f.root+'/task-decision-draft.json.partial'),partial);
}
function voiceRef(){return {schema:1,attempt_id:'voice-'+'1'.repeat(32),peer:'synthetic-peer',connection_epoch:'synthetic-boot:17',binding_sha256:'a'.repeat(64),text_sha256:'b'.repeat(64)};}
function voiceReview(f,text='完整条件：用新价格，运费沿用上次。',ref=voiceRef()){
 f.d.begin(f.binding,f.plan,f.now);for(const [suffix,cmd]of [['proposal',2],['supplement',1]]){const uid=f.arm(suffix);f.choose(uid,cmd);f.remove(uid);}
 f.d.transcript(f.key,f.binding.operation_id,text,f.now,ref);return f.d.snapshot();
}
test('first reject only persists a pending supplement; type4, duplicate and conflicting old operations cannot submit it',t=>{
 const f=fixture(t);f.d.begin(f.binding,f.plan,f.now);const uid=f.arm();
 assert.equal(f.d.suggestion(f.key,'synthetic-peer',4,uid,2,f.now),false);assert(f.choose(uid,2));
 assert.equal(f.d.snapshot().stage,'supplement_offer');assert.equal(f.d.snapshot().text,'');assert.throws(()=>f.d.seal(f.key,f.now),/NOT_REVIEWING/);
 assert.equal(f.choose(uid,1),false);assert.equal(f.choose(uid,2),false);assert.equal(JSON.parse(fs.readFileSync(f.root+'/task-decision-draft.json')).stage,'supplement_offer');
});
test('second reject is a final local decline, keeps the original task and never becomes task cancellation',t=>{
 const f=fixture(t);f.d.begin(f.binding,f.plan,f.now);const first=f.arm();f.choose(first,2);f.remove(first);const second=f.arm('offer');
 assert.equal(f.choose(first,1),false);f.choose(second,2);assert.throws(()=>f.d.seal(f.key,f.now),/NOT_REVIEWING/);f.remove(second);
 const answer=f.d.seal(f.key,f.now);assert.equal(answer.text,'未采用当前方案');assert.equal(answer.binding.task_id,'task-original');assert.equal(answer.input_source,'glasses_semantic');
 assert.equal(answer.binding.route.session_id,'original-session');assert.equal(answer.binding.request_revision,3);assert.equal(answer.option_id,null);
});
test('voice requires second-card consent and cleanup, preserves the full condition, and never carries a forced choice',t=>{
 const f=fixture(t);f.d.begin(f.binding,f.plan,f.now);const a=f.arm();f.choose(a,2);f.remove(a);const b=f.arm('offer');f.choose(b,1);
 assert.throws(()=>f.d.voiceBinding(f.key,f.now),/NOT_AUTHORIZED/);f.remove(b);assert.equal(f.d.voiceBinding(f.key,f.now),f.binding.operation_id);
 assert.throws(()=>f.d.transcript(f.key,'another-capture','旧条件',f.now),/BINDING_INVALID/);
 const full='用新价格，但运费沿用上次。\n请先只生成预览。';f.d.transcript(f.key,f.binding.operation_id,full,f.now);
 const first=f.d.seal(f.key,f.now),second=f.d.seal(f.key,f.now);assert.deepEqual(clone(first),clone(second));assert.equal(first.text,full);assert.equal(first.input_source,'voice');assert.equal(first.option_id,null);
 assert.throws(()=>f.d.edit(f.key,'不能替换已封存字节',f.now));assert.throws(()=>f.d.defer());
});
test('phone correction is explicit and changes the recorded input source',t=>{
 const f=fixture(t);f.d.begin(f.binding,f.plan,f.now);const uid=f.arm();f.choose(uid,1);f.remove(uid);f.d.edit(f.key,'修改后保留完整条件',f.now);
 const answer=f.d.seal(f.key,f.now);assert.equal(answer.input_source,'phone');assert.equal(answer.text,'修改后保留完整条件');
});
test('binary option mapping is explicit and labels are not guessed from option order; four-choice support stays open',t=>{
 const f=fixture(t);f.binding.mode='choice';f.binding.options=[{option_id:'a',label:'甲'},{option_id:'b',label:'乙'}];
 assert.throws(()=>f.d.begin(f.binding,f.plan,f.now),/MAPPING_REQUIRED/);
 Object.assign(f.plan,{adopt_option_id:'b',adopt_text:'乙',decline_option_id:'a',decline_text:'甲'});f.d.begin(f.binding,f.plan,f.now);
 const uid=f.arm();f.choose(uid,1);f.remove(uid);assert.equal(f.d.seal(f.key,f.now).option_id,'b');
 const other=fixture(t);other.binding.mode='choice';other.binding.options=['a','b','c','d'].map(option_id=>({option_id,label:option_id}));assert.throws(()=>other.d.begin(other.binding,other.plan,other.now),/MAPPING_REQUIRED/);
});
test('restored consent is paused and cannot reopen audio or submit; cleanup and original bytes are retained',t=>{
 const f=fixture(t);f.d.begin(f.binding,f.plan,f.now);const a=f.arm();f.choose(a,2);f.remove(a);const b=f.arm('offer');f.choose(b,1);f.remove(b);
 const bytes=fs.readFileSync(f.root+'/task-decision-draft.json'),next=f.create();assert(next.paused);assert.equal(next.snapshot().stage,'voice_authorized');
 assert.throws(()=>next.voiceBinding(f.key,f.now),/PROFILE_CHANGED/);assert.throws(()=>next.seal(f.key,f.now),/PROFILE_CHANGED/);assert.deepEqual(fs.readFileSync(f.root+'/task-decision-draft.json'),bytes);
});
test('inconsistent persisted stages and foreign card namespaces remain blocked without overwriting the file',t=>{
 const f=fixture(t);f.d.begin(f.binding,f.plan,f.now);const base=f.d.snapshot();
 const invalid=[{...base,text:'不应存在的提前答案'},{...base,used_uids:['foreign-operation-card']},
  {...base,cleanup_uid:f.binding.operation_id+'-card',cleanup_peer:'peer',used_uids:[f.binding.operation_id+'-card'],card_stage:''},
  {...base,stage:'sealed',text:'尚未清理的答案',cleanup_uid:f.binding.operation_id+'-card',cleanup_peer:'peer',used_uids:[f.binding.operation_id+'-card'],card_stage:'proposal'}];
 for(const value of invalid){const bytes=JSON.stringify(value);fs.writeFileSync(f.root+'/task-decision-draft.json',bytes);const next=f.create();assert(next.blocked);assert.equal(fs.readFileSync(f.root+'/task-decision-draft.json','utf8'),bytes);}
});
test('explicit resume preserves the original binding and review text; former voice consent always needs another card',t=>{
 const f=fixture(t);f.d.begin(f.binding,f.plan,f.now);const uid=f.arm();f.choose(uid,1);f.remove(uid);f.d.pause();
 assert.throws(()=>f.d.resume({...f.binding,request_revision:2},f.now),/RESUME_INVALID/);f.d.resume(f.binding,f.now);assert.equal(f.d.snapshot().stage,'review');assert.equal(f.d.snapshot().text,'采用当前方案');
 f.d.abandon();assert.equal(f.d.snapshot().stage,'abandoned');f.d.begin({...f.binding,operation_id:'next-operation'},f.plan,f.now);assert.equal(f.d.snapshot().stage,'proposal');
});
test('rejecting the proposed option never implicitly adopts the other choice',t=>{
 const f=fixture(t);f.binding.mode='choice';f.binding.options=[{option_id:'new-price',label:'新价格'},{option_id:'old-price',label:'旧价格'}];
 f.plan.adopt_option_id='new-price';f.plan.adopt_text='新价格';f.d.begin(f.binding,f.plan,f.now);const first=f.arm();f.choose(first,2);f.remove(first);const second=f.arm('offer');f.choose(second,2);f.remove(second);
 const answer=f.d.seal(f.key,f.now);assert.equal(answer.option_id,null);assert.equal(answer.text,'未采用当前方案');assert.equal(answer.binding.request_id,f.binding.request_id);
});
test('context, deadline, peer and UID checks prevent stale decisions and do not convert timeout to rejection',t=>{
 const f=fixture(t);f.d.begin(f.binding,f.plan,f.now);const uid=f.arm();
 assert.equal(f.d.suggestion(f.key,'wrong-peer',34,uid,1,f.now),false);assert.equal(f.d.suggestion(f.key,'synthetic-peer',34,'wrong-uid',1,f.now),false);
 assert.throws(()=>f.d.suggestion('other-owner', 'synthetic-peer',34,uid,1,f.now),/PROFILE_CHANGED/);
 assert.throws(()=>f.d.suggestion(f.key,'synthetic-peer',34,uid,2,f.now+60000),/EXPIRED/);assert.equal(f.d.snapshot().stage,'proposal');f.d.pause();assert.throws(()=>f.choose(uid,1),/PROFILE_CHANGED/);
});
test('atomic promotion failure freezes the live gesture instead of allowing a direct retry',t=>{
 const f=fixture(t);f.d.begin(f.binding,f.plan,f.now);const uid=f.arm(),file=f.root+'/task-decision-draft.json';
 const main=fs.readFileSync(file),snapshot=clone(f.d.snapshot());f.failPromotion(true);
 assert.throws(()=>f.choose(uid,2),/disk-failure/);const partial=fs.readFileSync(file+'.partial');
 assert.equal(JSON.parse(partial).stage,'supplement_offer');f.failPromotion(false);
 assertFrozen(f,f.d,main,partial,snapshot);assert.throws(()=>f.choose(uid,2));
 assert.deepEqual(fs.readFileSync(file+'.partial'),partial);
});

test('stale writers cannot erase another instance phase after an ordinary successful promotion',t=>{
 const f=fixture(t);f.d.begin(f.binding,f.plan,f.now);const uid=f.arm(),old=f.create();f.choose(uid,2);
 assert.throws(()=>old.removalSubmitted('synthetic-peer',uid),/WRITER_STALE/);assert.equal(f.create().snapshot().stage,'supplement_offer');
});

test('assertCurrent freezes a stale live voice authorization after another instance durably saves the original answer',t=>{
 const f=fixture(t);f.d.begin(f.binding,f.plan,f.now);
 for(const [suffix,cmd] of [['proposal',2],['supplement',1]]){const uid=f.arm(suffix);f.choose(uid,cmd);f.remove(uid);}
 assert.equal(f.d.voiceBinding(f.key,f.now),f.binding.operation_id);f.d.assertCurrent();assert.equal(f.d.blocked,false);assert.equal(f.d.paused,false);
 const snapshot=clone(f.d.snapshot()),file=f.root+'/task-decision-draft.json',other=f.create();
 other.restoreTranscript(f.binding,f.binding.operation_id,'另一实例已完整保存：只生成预览，不要发送。',f.now);
 const main=fs.readFileSync(file);assert.equal(JSON.parse(main).stage,'review');assert.equal(fs.existsSync(file+'.partial'),false);
 assert.throws(()=>f.d.assertCurrent());assert.equal(f.d.blocked,true);assert.equal(f.d.paused,true);assert.deepEqual(clone(f.d.snapshot()),snapshot);
 assert.throws(()=>f.d.voiceBinding(f.key,f.now));assert.throws(()=>f.d.transcript(f.key,f.binding.operation_id,'不得复用旧收音授权',f.now));
 assert.deepEqual(fs.readFileSync(file),main);assert.equal(fs.existsSync(file+'.partial'),false);
});
test('sealed operation can be reused for exact enqueue; a new interaction cannot inherit the old card namespace',t=>{
 const f=fixture(t);f.d.begin(f.binding,f.plan,f.now);const uid=f.arm();f.choose(uid,1);f.remove(uid);f.d.seal(f.key,f.now);
 assert.throws(()=>f.d.queued('other-operation'));f.d.queued(f.binding.operation_id);const other=clone(f.binding);other.operation_id='reply-next-2';other.request_id='question-next';f.d.begin(other,f.plan,f.now);
 assert.throws(()=>f.d.armCard(f.key,'synthetic-peer',uid,f.now),/CARD_BUSY/);assert.equal(f.d.snapshot().binding.request_id,'question-next');
});
test('malformed durable interaction fails closed and its original bytes are preserved',t=>{
 const f=fixture(t),file=f.root+'/task-decision-draft.json';fs.writeFileSync(file,'{broken');const next=f.create();assert(next.blocked);assert.throws(()=>next.begin(f.binding,f.plan,f.now));assert.equal(fs.readFileSync(file,'utf8'),'{broken');
});

test('voice source reference is strict, immutable by value and part of the complete submission CAS',t=>{
 const f=fixture(t),refs=loadApp('TaskVoiceSourceRef'),source=voiceRef();assert(refs.taskVoiceSourceValid(source));assert(refs.taskSameVoiceSource(undefined,null));assert.equal(refs.taskSameVoiceSource(source,null),false);
 for(const invalid of [{...source,extra:1},{...source,attempt_id:'voice-'+'A'.repeat(32)},{...source,peer:''},{...source,connection_epoch:'x'.repeat(129)},{...source,binding_sha256:'A'.repeat(64)},{...source,text_sha256:''}])assert.equal(refs.taskVoiceSourceValid(invalid),false);
 const saved=voiceReview(f,undefined,source);assert.equal(saved.schema,2);assert.equal(Object.keys(saved).length,12);assert.deepEqual(clone(saved.voice_source),source);
 source.text_sha256='c'.repeat(64);assert.notEqual(f.d.snapshot().voice_source.text_sha256,source.text_sha256,'caller mutation cannot rewrite the durable voice source');
 const answer=f.taskRecordSubmission(f.d.snapshot());assert.equal(answer.record_schema,2);assert.deepEqual(clone(answer.voice_source),clone(saved.voice_source));
 assert(f.taskSameSubmission(answer,clone(answer)));
 for(const field of ['attempt_id','peer','connection_epoch','binding_sha256','text_sha256']){const other=clone(answer);other.voice_source[field]=field==='attempt_id'?'voice-'+'2'.repeat(32):field.includes('sha256')?'c'.repeat(64):'different';assert.equal(f.taskSameSubmission(answer,other),false,field);}
 assert.equal(f.taskSameSubmission(answer,{...answer,record_schema:1}),false);assert.equal(f.taskSameSubmission(answer,{...answer,voice_source:null}),false);
 const frozen=f.taskRecordSubmission(saved);const uid=f.binding.operation_id+'-review';f.d.armReviewCard(frozen,'synthetic-peer',uid,f.now);
 const changed=clone(frozen);changed.voice_source.connection_epoch='another-connection';assert.equal(f.d.confirmReview(changed,'synthetic-peer',34,uid,1,f.now),false);assert.equal(f.d.snapshot().stage,'review');
});

test('legacy schema1 keeps its representation and never gains a source claim through load, cleanup, pause or resume',t=>{
 for(const input of ['phone','voice']){
  const f=fixture(t);review(f);const value=f.d.snapshot();delete value.voice_source;value.schema=1;value.input_source=input;
  const uid=f.binding.operation_id+'-legacy';Object.assign(value,{cleanup_uid:uid,cleanup_peer:'synthetic-peer',card_stage:'review',used_uids:[uid]});
  const legacy=Object.fromEntries(Object.entries(value).reverse()),file=f.root+'/task-decision-draft.json',raw=JSON.stringify(legacy,null,2)+'\r\n';fs.writeFileSync(file,raw);
  const restored=f.create();assert.equal(restored.blocked,false);assert.equal(fs.readFileSync(file,'utf8'),raw);assert.equal(restored.snapshot().schema,1);assert.equal(Object.hasOwn(restored.snapshot(),'voice_source'),false);
  restored.pause();assert.equal(fs.readFileSync(file,'utf8'),raw);restored.removalSubmitted('synthetic-peer',uid);restored.resume(f.binding,f.now);
  const after=JSON.parse(fs.readFileSync(file,'utf8'));assert.equal(after.schema,1);assert.equal(after.input_source,input);assert.deepEqual(Object.keys(after),Object.keys(legacy));assert.equal(Object.hasOwn(after,'voice_source'),false);
  const answer=f.taskRecordSubmission(after);assert.equal(answer.record_schema,1);assert.equal(answer.voice_source,null);
  for(const bad of [{...after,voice_source:null},{...after,schema:2},{...after,schema:2,voice_source:undefined}])assert.throws(()=>restored.parseRecoveryRecord(JSON.stringify(bad)));
 }
});

test('only explicit phone edit or full frozen adoption detaches voice provenance and adoption remains paused',t=>{
 for(const stage of ['review','sealed','deferred']){
  const f=fixture(t);voiceReview(f);if(stage==='sealed')f.d.seal(f.key,f.now);if(stage==='deferred')f.d.defer();
  const before=f.d.snapshot(),expected=f.taskRecordSubmission(before);f.d.adoptPhone(expected,f.now);const after=f.d.snapshot();
  assert.equal(after.schema,2);assert.equal(after.stage,'review');assert.equal(after.input_source,'phone');assert.equal(after.voice_source,null);assert.equal(after.option_id,null);assert.equal(after.text,before.text);assert.deepEqual(clone(after.binding),clone(before.binding));assert.deepEqual(clone(after.used_uids),clone(before.used_uids));assert.equal(f.d.paused,true);assert.throws(()=>f.d.seal(f.key,f.now));
  f.d.resume(f.binding,f.now);assert.equal(f.d.seal(f.key,f.now).input_source,'phone');
 }
 const f=fixture(t);voiceReview(f);f.d.edit(f.key,'手机明确改写后的完整条件。',f.now);assert.equal(f.d.snapshot().schema,2);assert.equal(f.d.snapshot().voice_source,null);assert.equal(f.d.snapshot().input_source,'phone');
});

test('phone adoption rejects stale schema, source, text, binding, expiry and cleanup without changing any bytes',t=>{
 for(const change of ['schema','source','text','binding','expiry','cleanup']){
  const f=fixture(t);voiceReview(f);const expected=f.taskRecordSubmission(f.d.snapshot());
  if(change==='schema')expected.record_schema=1;if(change==='source')expected.voice_source.text_sha256='c'.repeat(64);if(change==='text')expected.text+='不相同';if(change==='binding')expected.binding.request_revision++;
  if(change==='cleanup')f.d.armReviewCard(expected,'synthetic-peer',f.binding.operation_id+'-pending',f.now);
  const file=f.root+'/task-decision-draft.json',before=fs.readFileSync(file);assert.throws(()=>f.d.adoptPhone(expected,change==='expiry'?f.now+60000:f.now));assert.deepEqual(fs.readFileSync(file),before);
 }
});

test('rename failure after writing the full partial preserves newer conditions and prevents cold revival of the older review',t=>{
 const f=fixture(t);review(f);const file=f.root+'/task-decision-draft.json',main=fs.readFileSync(file),snapshot=clone(f.d.snapshot());
 const full='用新价格，但运费沿用上次。\n不要发送，仅保存为预览。';f.failPromotion(true);
 assert.throws(()=>f.d.edit(f.key,full,f.now),/disk-failure/);const partial=fs.readFileSync(file+'.partial');
 const pending=JSON.parse(partial);assert.equal(pending.stage,'review');assert.equal(pending.text,full);
 assert.equal(JSON.parse(main).text,'旧版完整答案：采用新价格');f.failPromotion(false);assertFrozen(f,f.d,main,partial,snapshot);
 const cold=f.create();assert.equal(cold.blocked,true);assert.throws(()=>cold.resume(f.binding,f.now));assert.throws(()=>cold.seal(f.key,f.now));
 assert.deepEqual(fs.readFileSync(file),main);assert.deepEqual(fs.readFileSync(file+'.partial'),partial);
});

test('cold main plus valid or malformed partial blocks both old review and sealed records without changing either file',t=>{
 for(const stage of ['review','sealed'])for(const malformed of [false,true]){
  const f=fixture(t);review(f);if(stage==='sealed')f.d.seal(f.key,f.now);
  const file=f.root+'/task-decision-draft.json',main=fs.readFileSync(file),newer=clone(f.d.snapshot());
  newer.stage=stage==='sealed'?'queued':'deferred';const partial=Buffer.from(malformed?'{interrupted':JSON.stringify(newer));fs.writeFileSync(file+'.partial',partial);
  const cold=f.create();assert.equal(cold.blocked,true,`${stage}/${malformed}`);
  assert.throws(()=>cold.seal(f.key,f.now));assert.throws(()=>cold.resume(f.binding,f.now));
  assert.throws(()=>cold.begin({...f.binding,operation_id:'reply-cold-next'},f.plan,f.now));
  assert.deepEqual(fs.readFileSync(file),main);assert.deepEqual(fs.readFileSync(file+'.partial'),partial);
 }
});

test('an orphan valid or malformed partial blocks initialization before a new draft can truncate it',t=>{
 for(const malformed of [false,true]){
  const f=fixture(t),file=f.root+'/task-decision-draft.json',record=new f.TaskDecisionRecord();
  record.binding=clone(f.binding);record.plan=clone(f.plan);const partial=Buffer.from(malformed?'{orphan-interrupted':JSON.stringify(record));
  assert.equal(fs.existsSync(file),false);fs.writeFileSync(file+'.partial',partial);
  const cold=f.create();assert.equal(cold.blocked,true);assert.throws(()=>cold.begin(f.binding,f.plan,f.now));
  assert.equal(fs.existsSync(file),false);assert.deepEqual(fs.readFileSync(file+'.partial'),partial);
 }
});

test('a live external partial is never truncated by a later edit seal or resume',t=>{
 const f=fixture(t);review(f);const file=f.root+'/task-decision-draft.json',main=fs.readFileSync(file),snapshot=clone(f.d.snapshot());
 const partial=Buffer.from('external interrupted writer: newer evidence must survive');fs.writeFileSync(file+'.partial',partial);
 assert.throws(()=>f.d.edit(f.key,'本次修改不得覆盖外部记录',f.now));assert.throws(()=>f.d.seal(f.key,f.now));
 f.d.pause();assert.throws(()=>f.d.resume(f.binding,f.now));
 assert.deepEqual(clone(f.d.snapshot()),snapshot);assert.deepEqual(fs.readFileSync(file),main);assert.deepEqual(fs.readFileSync(file+'.partial'),partial);
});

test('partial write and fsync failures freeze old review bytes even after the filesystem starts succeeding again',t=>{
 for(const failure of ['write','fsync']){
  const f=fixture(t);review(f);const file=f.root+'/task-decision-draft.json',main=fs.readFileSync(file),snapshot=clone(f.d.snapshot());
  const write=f.io.writeSync,fsync=f.io.fsyncSync;let writes=0;
  if(failure==='write')f.io.writeSync=(fd,bytes)=>{if(writes++>0)throw Error('synthetic-write-failure');return write(fd,bytes);};
  else f.io.fsyncSync=()=>{throw Error('synthetic-fsync-failure');};
  try{assert.throws(()=>f.d.edit(f.key,'完整新增条件：不要发送。'.repeat(15),f.now),new RegExp(`synthetic-${failure}-failure`));}
  finally{f.io.writeSync=write;f.io.fsyncSync=fsync;}
  const partial=fs.readFileSync(file+'.partial');assert(partial.length>0);if(failure==='write')assert.throws(()=>JSON.parse(partial));
  else assert.equal(JSON.parse(partial).text,'完整新增条件：不要发送。'.repeat(15));
  assertFrozen(f,f.d,main,partial,snapshot);assert.equal(f.create().blocked,true);
 }
});

test('a failed first publication blocks another begin and preserves its orphan partial',t=>{
 const f=fixture(t),file=f.root+'/task-decision-draft.json';f.failPromotion(true);
 assert.throws(()=>f.d.begin(f.binding,f.plan,f.now),/disk-failure/);const partial=fs.readFileSync(file+'.partial');
 f.failPromotion(false);assert.equal(f.d.blocked,true);assert.equal(f.d.paused,true);assert.equal(f.d.snapshot(),undefined);
 assert.throws(()=>f.d.begin({...f.binding,operation_id:'reply-new-after-failure'},f.plan,f.now));
 assert.equal(fs.existsSync(file),false);assert.deepEqual(fs.readFileSync(file+'.partial'),partial);assert.equal(f.create().blocked,true);
});
