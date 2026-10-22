import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {loadApp} from './load-app.mjs';
import {loadCore} from './load-core.mjs';
import {setupMaterialStore} from './material-fixture.mjs';
import {syntheticTaskSources} from './task-source-fixture.mjs';

const clone=value=>JSON.parse(JSON.stringify(value));
const turn=()=>new Promise(setImmediate);
const {businessEnvelope}=loadCore('./BusinessCommands'),{readLauncherEnvelope}=loadCore('./LauncherStatus');
function gate(){let release;const promise=new Promise(resolve=>release=resolve);return{promise,release};}
async function settle(session){for(let n=0;n<80&&session.busy;n++)await turn();assert.equal(session.busy,false,'finite synthetic transport settled');}
async function until(predicate){for(let n=0;n<80&&!predicate();n++)await turn();assert(predicate(),'expected synthetic boundary was reached');}

// The native device and HTTP mailbox boundaries are explicit test ports. The
// real review model, business envelopes, serialized session and atomic files run.
function fixture(t){
 const f=setupMaterialStore(t),sent=[],answers=[],timers=new Map();let now=Date.now(),peer='peer',foreground=true,available=true,key='original-context',valid=true;
 let nonce=0,timer=0,sendHook,liveHook,liveReads=0;
 class Clock extends Date{static now(){return now;}}
 const globals={Date:Clock,setTimeout(fn,ms){timers.set(++timer,{fn,ms});return timer;},clearTimeout(id){timers.delete(id);}};
 const platform={'@kit.CoreFileKit':{fileIo:f.io},'@kit.CryptoArchitectureKit':{cryptoFramework:{
  createRandom:()=>({generateRandomSync:n=>({data:new Uint8Array(n).fill(++nonce)})}),
  createMd:()=>{const hash=createHash('sha256');return{updateSync:value=>hash.update(value.data),digestSync:()=>({data:Uint8Array.from(hash.digest())})};}
 }}};
 const model=loadApp('TaskReplyDraft',platform,globals),{TaskSuggestionSession}=loadApp('TaskSuggestionSession',platform,globals),binding=new model.TaskReplyBinding(),plan=new model.TaskDecisionPlan();
 Object.assign(binding,{context_key:key,operation_id:'original-operation',request_id:'original-question',request_revision:3,task_id:'original-task',
  route:{computer_id:'pc',agent_id:'hermes',project_id:'project',session_id:'original-session'},expires_at:new Date(now+3600000).toISOString(),question:'采用新价格吗？',mode:'free_text'});
 const createDraft=()=>{const value=new model.TaskDecisionDraft();value.initialize(f.root);return value;},draft=createDraft();
 const sources=syntheticTaskSources({connection:()=>({peer,epoch:7})}),operations=new Set();
 const ports={device:()=>peer,foreground:()=>foreground,available:()=>available,context:()=>key,validate(){if(!valid)throw Error('TASK_REQUEST_CLOSED');},
  assertAnswer:answer=>sources.assertAnswer(answer),operationExists:operation=>operations.has(operation),
  async revalidate(value){liveReads++;if(liveHook)await liveHook(value);if(!valid)throw Error('TASK_REQUEST_CLOSED');},async wait(){},
  async send(business,bytes){const packet=readLauncherEnvelope(bytes),value=JSON.parse(new TextDecoder().decode(packet.json));sent.push({business,type:packet.type,value});if(sendHook)await sendHook(packet.type,value);},
  enqueue(answer){answers.push(clone(answer));draft.queued(answer.binding.operation_id);return'awaiting_refresh';}};
 const session=new TaskSuggestionSession(draft,ports),file=f.root+'/task-decision-draft.json';
 const frozen=(value=draft)=>model.taskRecordSubmission(value.snapshot());
 const seed=(text='用新价格，运费沿用上次',voice=false)=>{
  draft.begin(binding,plan,now);const a=binding.operation_id+'-proposal';draft.armCard(key,peer,a,now);draft.suggestion(key,peer,34,a,voice?2:1,now);draft.removalSubmitted(peer,a);
  if(voice){const b=binding.operation_id+'-supplement';draft.armCard(key,peer,b,now);draft.suggestion(key,peer,34,b,1,now);draft.removalSubmitted(peer,b);draft.transcript(key,binding.operation_id,text,now,sources.register(binding,'voice-'+'a'.repeat(32),peer,7,text));}
  else draft.edit(key,text,now);
 };
 const ready=async(text,voice)=>{seed(text,voice);await session.resume();return session.reviewStatus().binding_sha256;};
 const receive=(cmd,uid=draft.snapshot()?.cleanup_uid,type=34,from=peer)=>session.receive(from,businessEnvelope(type,new TextEncoder().encode(JSON.stringify({suggestUID:uid,suggestType:2,cmd}))));
 return{...f,...model,platform,globals,binding,plan,draft,session,ports,sent,answers,timers,file,seed,ready,receive,frozen,createDraft,sources,operations,
  disk:()=>JSON.parse(fs.readFileSync(file,'utf8')),bytes:()=>fs.readFileSync(file),settle:()=>settle(session),get now(){return now;},get reads(){return liveReads;},
  advance:n=>now+=n,setPeer:v=>peer=v,setForeground:v=>foreground=v,setAvailable:v=>available=v,setKey:v=>key=v,close:()=>valid=false,
  onSend:fn=>sendHook=fn,onLive:fn=>liveHook=fn,cold:()=>{const value=createDraft(),nextPorts={...ports,enqueue(answer){answers.push(clone(answer));value.queued(answer.binding.operation_id);return'awaiting_refresh';}};return{draft:value,session:new TaskSuggestionSession(value,nextPorts),ports:nextPorts};}};
}

test('legacy eleven-field drafts remain readable without migration, while review cleanup survives cold restore',t=>{
 const f=fixture(t);f.seed();const legacy=f.disk();legacy.schema=1;delete legacy.voice_source;fs.writeFileSync(f.file,JSON.stringify(legacy));const bytes=f.bytes();assert.equal(Object.keys(legacy).length,11);
 const restored=f.createDraft();assert.equal(restored.blocked,false);assert(restored.paused);assert.equal(restored.snapshot().stage,'review');assert.deepEqual(f.bytes(),bytes);
 f.draft.initialize(f.root);f.draft.resume(f.binding,f.now);assert.equal(f.draft.snapshot().schema,1);assert.equal(f.frozen().record_schema,1);
 f.draft.armReviewCard(f.frozen(),'peer','original-operation-review-1',f.now);const armed=f.bytes(),next=f.createDraft();
 assert.equal(next.blocked,false);assert.equal(next.snapshot().card_stage,'review');assert.equal(next.snapshot().cleanup_uid,'original-operation-review-1');assert.deepEqual(f.bytes(),armed);
});

test('submission identity includes the complete binding, option, source and every answer character',t=>{
 const f=fixture(t);f.seed('条件首句。\n完整末句。',true);const value=f.frozen();assert(f.taskSameSubmission(value,clone(value)));
 const changes=[v=>v.text+='末',v=>v.text=v.text.replace('\n',' '),v=>v.input_source='phone',v=>v.option_id='option-other',
  v=>v.binding.operation_id+='-other',v=>v.binding.request_id+='-other',v=>v.binding.request_revision++,v=>v.binding.task_id+='-other',
  v=>v.binding.context_key+='-other',v=>v.binding.route.session_id+='-other',v=>v.binding.route.project_id+='-other',v=>v.binding.route.agent_id+='-other',v=>v.binding.route.computer_id+='-other',
  v=>v.binding.question+='？',v=>v.binding.expires_at=new Date(Date.parse(v.binding.expires_at)+1).toISOString()];
 for(const change of changes){const altered=clone(value);change(altered);assert.equal(f.taskSameSubmission(value,altered),false);}
});

test('review arm performs full frozen-answer CAS and prevents editing until the exact old card is removed',t=>{
 const f=fixture(t);f.seed();const old=f.frozen();f.draft.edit(f.binding.context_key,'已更新的完整条件',f.now);const bytes=f.bytes();
 assert.throws(()=>f.draft.armReviewCard(old,'peer','original-operation-review-stale',f.now));assert.deepEqual(f.bytes(),bytes);
 const value=f.frozen();f.draft.armReviewCard(value,'peer','original-operation-review-1',f.now);const armed=f.bytes();
 assert.throws(()=>f.draft.edit(f.binding.context_key,'不能替换镜片正在确认的文字',f.now));assert.deepEqual(f.bytes(),armed);
 assert.throws(()=>f.draft.armReviewCard(value,'peer','original-operation-review-2',f.now));assert.deepEqual(f.bytes(),armed);
 f.draft.removalSubmitted('peer','original-operation-review-1');f.draft.edit(f.binding.context_key,'移除后才可明确编辑',f.now);assert.equal(f.disk().text,'移除后才可明确编辑');
});

test('review confirmation accepts only its current full answer, peer, type34 UID and seals before cleanup',t=>{
 const f=fixture(t);f.seed();const value=f.frozen(),uid='original-operation-review-1';f.draft.armReviewCard(value,'peer',uid,f.now);const bytes=f.bytes();
 for(const [frozen,peer,type,id,cmd] of [[value,'other',34,uid,1],[value,'peer',4,uid,1],[value,'peer',34,'old-uid',1],[value,'peer',34,uid,3],[{...clone(value),text:'被替换'},'peer',34,uid,1]]){
  assert.equal(f.draft.confirmReview(frozen,peer,type,id,cmd,f.now),false);assert.deepEqual(f.bytes(),bytes);
 }
 assert(f.draft.confirmReview(value,'peer',34,uid,1,f.now));assert.equal(f.disk().stage,'sealed');assert.equal(f.disk().cleanup_uid,uid);assert.equal(f.disk().card_stage,'review');
 assert.equal(f.disk().text,value.text);assert.equal(f.createDraft().blocked,false);const sealed=f.bytes();
 assert.equal(f.draft.confirmReview(value,'peer',34,uid,2,f.now),false);assert.deepEqual(f.bytes(),sealed);
 assert.throws(()=>f.draft.queued(value.binding.operation_id));f.draft.removalSubmitted('peer',uid);f.draft.queued(value.binding.operation_id);assert.equal(f.disk().stage,'queued');
});

test('review rejection preserves the full answer as deferred and later acceptance cannot reverse it',t=>{
 const f=fixture(t);f.seed('保留我的完整条件，不能当作拒绝原任务。',true);const value=f.frozen(),uid='original-operation-review-1';f.draft.armReviewCard(value,'peer',uid,f.now);
 assert(f.draft.confirmReview(value,'peer',34,uid,2,f.now));assert.equal(f.disk().stage,'deferred');assert(f.draft.paused);assert.equal(f.disk().text,value.text);assert.equal(f.disk().cleanup_uid,uid);
 const bytes=f.bytes();assert.throws(()=>f.draft.confirmReview(value,'peer',34,uid,1,f.now),/PROFILE_CHANGED/);assert.deepEqual(f.bytes(),bytes);assert.equal(f.createDraft().blocked,false);
 f.draft.removalSubmitted('peer',uid);f.draft.resume(f.binding,f.now);assert.equal(f.disk().stage,'review');assert.equal(f.disk().text,value.text);assert.equal(f.disk().input_source,'voice');
});

test('atomic seal failure protects both durable files and cannot authorize enqueue; normal review UID budget is finite',async t=>{
 const f=fixture(t);f.seed();const value=f.frozen(),uid='original-operation-review-1';f.draft.armReviewCard(value,'peer',uid,f.now);const bytes=f.bytes();f.failPromotion(true);
 assert.throws(()=>f.draft.confirmReview(value,'peer',34,uid,1,f.now),/disk-failure/);assert.deepEqual(f.bytes(),bytes);assert.equal(f.draft.snapshot().stage,'review');
 const partial=fs.readFileSync(f.file+'.partial');assert.equal(JSON.parse(partial).stage,'sealed');assert(f.draft.blocked);assert(f.draft.paused);f.failPromotion(false);
 assert.throws(()=>f.draft.removalSubmitted('peer',uid));assert.throws(()=>f.draft.resume(f.binding,f.now));await assert.rejects(Promise.resolve().then(()=>f.session.submit()));
 const cold=f.createDraft();assert(cold.blocked);assert(cold.paused);assert.deepEqual(f.bytes(),bytes);assert.deepEqual(fs.readFileSync(f.file+'.partial'),partial);assert.equal(f.answers.length,0);
 // Exhaustion is independent of a failed writer: no partial is deleted to
 // pretend that the protected failed interaction has recovered.
 const g=fixture(t);g.seed();
 for(let n=1;n<=7;n++){const id='original-operation-review-'+n;g.draft.armReviewCard(g.frozen(),'peer',id,g.now);g.draft.confirmReview(g.frozen(),'peer',34,id,2,g.now);g.draft.removalSubmitted('peer',id);g.draft.resume(g.binding,g.now);}
 assert.equal(g.disk().used_uids.length,8);const exhausted=g.bytes();assert.throws(()=>g.draft.armReviewCard(g.frozen(),'peer','original-operation-review-8',g.now));assert.deepEqual(g.bytes(),exhausted);assert.equal(g.draft.blocked,false);
});

test('review status hash binds the exact answer and route; show sends the full original question and text without truncation',async t=>{
 const f=fixture(t),text='用新价格，运费沿用上次';const hash=await f.ready(text,true),status=f.session.reviewStatus();assert.equal(status.ready,true);assert.match(hash,/^[0-9a-f]{64}$/i);
 assert.equal(f.session.reviewStatus().binding_sha256,hash);f.draft.edit(f.binding.context_key,text+'。',f.now);const updated=f.session.reviewStatus();assert.notEqual(updated.binding_sha256,hash);
 await assert.rejects(Promise.resolve().then(()=>f.session.showReview(hash)));assert.equal(f.sent.length,0);
 await f.session.showReview(updated.binding_sha256);const card=f.sent.at(-1);assert.equal(card.business,21);assert.equal(card.type,33);assert.equal(card.value.type,1);
 assert.equal(card.value.title,'pc·hermes');assert.equal(card.value.content,f.binding.question+' 答：'+text+'。 点头发送；摇头保留。');assert.equal(f.answers.length,0);
 assert.equal([...f.timers.values()][0].ms,120000);assert.equal(f.session.reviewStatus().ready,false);await f.session.cleanup();
});

test('review copy bounds include all instructions; overflow, control characters and original-route title are rejected intact',async t=>{
 const prefix='采用新价格吗？ 答：',suffix=' 点头发送；摇头保留。',fit='条'.repeat(48-prefix.length-suffix.length);
 const f=fixture(t);const hash=await f.ready(fit);assert.equal(f.session.reviewStatus().ready,true);await f.session.showReview(hash);assert.equal(f.sent.at(-1).value.content.length,48);await f.session.cleanup();
 for(const change of [g=>g.seed(fit+'尾'),g=>{g.binding.route.computer_id='原电脑名称'.repeat(5);g.seed('完整条件');},g=>g.seed('第一行\n第二行')]){
  const g=fixture(t);change(g);await g.session.resume();const bytes=g.bytes(),status=g.session.reviewStatus();assert.equal(status.ready,false);assert(status.reason);
  await assert.rejects(Promise.resolve().then(()=>g.session.showReview(status.binding_sha256)));assert.equal(g.sent.length,0);assert.deepEqual(g.bytes(),bytes);assert(g.disk().text.length>0);
 }
});

test('technical project and session stay bound to the hash without crowding out the readable question and answer',async t=>{
 for(const field of ['project_id','session_id']){
  const f=fixture(t),hash=await f.ready(),value=f.disk();value.binding.route[field]+='-changed-only';fs.writeFileSync(f.file,JSON.stringify(value));
  const next=f.cold();assert.notEqual(next.session.reviewStatus().binding_sha256,hash,field+' participates in the exact confirmation hash');
 }
 const f=fixture(t);f.binding.route.project_id='项目'.repeat(150);f.binding.route.session_id='会话'.repeat(150);const hash=await f.ready('完整运费条件');
 assert.equal(f.session.reviewStatus().ready,true);await f.session.showReview(hash);const card=f.sent.at(-1).value;
 assert.equal(card.title,'pc·hermes');assert.equal(card.content,f.binding.question+' 答：完整运费条件 点头发送；摇头保留。');assert.equal(f.disk().binding.route.project_id.length,300);assert.equal(f.disk().binding.route.session_id.length,300);await f.session.cleanup();
});

test('editing while show waits for request revalidation invalidates the original hash and never arms or emits stale copy',async t=>{
 const f=fixture(t),hash=await f.ready(),pending=gate();f.onLive(()=>pending.promise);const work=f.session.showReview(hash);await until(()=>f.reads>=2);
 f.draft.edit(f.binding.context_key,'等待期间用户修改了完整答案',f.now);const bytes=f.bytes();pending.release();await assert.rejects(work);await f.settle();
 assert.deepEqual(f.bytes(),bytes);assert.equal(f.disk().cleanup_uid,'');assert.equal(f.sent.length,0);assert.equal(f.answers.length,0);
});

test('review display cannot be armed after peer, context, foreground, request or deadline changes during refresh',async t=>{
 for(const change of [f=>f.setPeer('other'),f=>f.setKey('other-context'),f=>f.setForeground(false),f=>f.close(),f=>f.advance(3600000)]){
  const f=fixture(t),hash=await f.ready(),pending=gate();f.onLive(()=>pending.promise);const bytes=f.bytes(),work=f.session.showReview(hash);await until(()=>f.reads>=2);change(f);pending.release();
  await assert.rejects(work);await f.settle();assert.deepEqual(f.bytes(),bytes);assert.equal(f.sent.length,0);assert.equal(f.answers.length,0);
 }
});

test('accepted native review persists sealed answer before type35 and waits for feedback plus removal before enqueue',async t=>{
 const f=fixture(t),hash=await f.ready('完整运费条件',true);await f.session.showReview(hash);const uid=f.disk().cleanup_uid,frozen=f.frozen(),waits=[];let release;
 f.ports.wait=ms=>{waits.push(ms);return new Promise(resolve=>release=resolve);};f.onSend((type,value)=>{if(type===35){assert.equal(f.disk().stage,'sealed');assert.equal(f.disk().cleanup_uid,uid);assert.equal(f.disk().text,frozen.text);assert.equal(f.answers.length,0);}});
 f.receive(1,uid,4);f.receive(1,'foreign-uid');f.receive(1,uid,34,'foreign-peer');await turn();assert.equal(f.sent.length,1);assert.equal(f.disk().stage,'review');
 f.receive(1,uid);f.receive(1,uid);f.receive(2,uid);await until(()=>!!release);assert.deepEqual(waits,[2500]);assert.equal(f.answers.length,0);assert.equal(f.disk().stage,'sealed');
 const first=release;release=undefined;first();await until(()=>!!release);assert.deepEqual(waits,[2500,300]);assert.deepEqual(f.sent.map(x=>[x.type,x.value.type]),[[33,1],[35,undefined],[33,2]]);assert.equal(f.disk().cleanup_uid,'');assert.equal(f.answers.length,0);
 release();await f.settle();assert.equal(f.answers.length,1);assert.deepEqual(f.answers[0],clone(frozen));assert.equal(f.disk().stage,'queued');assert.equal(f.sent.filter(x=>x.type===35).length,1);
});

test('review shake means retain draft, sends one native receipt and never submits or accepts a delayed nod',async t=>{
 const f=fixture(t),hash=await f.ready('完整条件应继续保留',true);await f.session.showReview(hash);const uid=f.disk().cleanup_uid,answer=f.frozen();f.receive(2);f.receive(1,uid);await f.settle();
 assert.equal(f.disk().stage,'deferred');assert(f.draft.paused);assert.equal(f.disk().text,answer.text);assert.equal(f.disk().input_source,'voice');assert.equal(f.disk().cleanup_uid,'');assert.equal(f.answers.length,0);assert.equal(f.sent.filter(x=>x.type===35).length,1);
 f.receive(1,uid);await f.settle();assert.equal(f.answers.length,0);assert.equal(f.disk().stage,'deferred');
});

test('failed durable review acceptance sends no native receipt and protects the original review plus pending seal',async t=>{
 const f=fixture(t),hash=await f.ready();await f.session.showReview(hash);const bytes=f.bytes();f.failPromotion(true);f.receive(1);await f.settle();
 assert.deepEqual(f.bytes(),bytes);assert.equal(f.disk().stage,'review');assert.equal(f.sent.filter(x=>x.type===35).length,0);assert.equal(f.answers.length,0);
 const partial=fs.readFileSync(f.file+'.partial'),uid=f.disk().cleanup_uid;assert.equal(JSON.parse(partial).stage,'sealed');assert(f.draft.blocked);assert(f.draft.paused);f.failPromotion(false);
 await assert.rejects(Promise.resolve().then(()=>f.session.submit()));await assert.rejects(f.session.cleanup());await f.settle();
 assert(f.draft.blocked);assert(f.draft.paused);assert.equal(f.disk().cleanup_uid,uid);assert.deepEqual(f.bytes(),bytes);assert.deepEqual(fs.readFileSync(f.file+'.partial'),partial);assert.equal(f.answers.length,0);assert.equal(f.sent.filter(x=>x.type===35).length,0);
});

test('uncertain native receipt or remove retains sealed exact answer and cleanup intent without automatic retry or enqueue',async t=>{
 for(const failure of ['receipt','remove']){
  const f=fixture(t),hash=await f.ready();await f.session.showReview(hash);const uid=f.disk().cleanup_uid,answer=f.frozen();f.onSend((type,value)=>{if(failure==='receipt'?type===35:type===33&&value.type===2)throw Error('synthetic uncertain '+failure);});
  f.receive(1);await f.settle();assert.equal(f.disk().stage,'sealed');assert.equal(f.disk().cleanup_uid,uid);assert.equal(f.disk().text,answer.text);assert.equal(f.answers.length,0);
  const sends=f.sent.length;f.receive(1,uid);await f.settle();assert.equal(f.sent.length,sends,'duplicate operation cannot blindly retry ambiguous side effects');
  f.onSend(undefined);await f.session.cleanup();assert.equal(f.disk().cleanup_uid,'');assert.equal(f.answers.length,0);await f.session.submit();assert.deepEqual(f.answers,[clone(answer)]);assert.equal(f.disk().stage,'queued');
 }
});

test('background during native review feedback preserves sealed answer and removes its old UID without automatic enqueue',async t=>{
 const f=fixture(t),hash=await f.ready();await f.session.showReview(hash);let release;f.ports.wait=()=>new Promise(resolve=>release=resolve);f.receive(1);await until(()=>!!release);
 f.setForeground(false);f.session.pause();release();await f.settle();assert.equal(f.disk().stage,'sealed');assert.equal(f.disk().cleanup_uid,'');assert.equal(f.answers.length,0);assert(f.draft.paused);
 f.setForeground(true);await f.session.submit();assert.equal(f.answers.length,1);assert.equal(f.disk().stage,'queued');
});

test('review timeout retains the unsubmitted full text and late native input cannot count as an answer',async t=>{
 const f=fixture(t),hash=await f.ready('完整条件保留');await f.session.showReview(hash);const uid=f.disk().cleanup_uid,timer=[...f.timers.values()][0];f.advance(120000);timer.fn();await f.settle();
 assert.equal(f.disk().stage,'review');assert.equal(f.disk().text,'完整条件保留');assert.equal(f.disk().cleanup_uid,'');assert.equal(f.answers.length,0);assert(f.draft.paused);
 f.receive(1,uid);await f.settle();assert.equal(f.answers.length,0);
});

test('cold restore preserves an accepted review and cleanup bytes without replay; explicit cleanup then submit uses the same original operation',async t=>{
 const f=fixture(t),hash=await f.ready();await f.session.showReview(hash);f.onSend(type=>{if(type===35)throw Error('lost native receipt');});f.receive(1);await f.settle();const bytes=f.bytes(),answer=f.frozen();
 const next=f.cold();assert(next.draft.paused);assert.equal(next.draft.snapshot().stage,'sealed');assert.deepEqual(f.bytes(),bytes);assert.equal(f.answers.length,0);assert.equal(next.session.reviewStatus().ready,false);
 const sends=f.sent.length;await turn();assert.equal(f.sent.length,sends,'constructing a cold session cannot replay display, receipt or answer');
 f.onSend(undefined);await next.session.cleanup();assert.equal(f.answers.length,0);await next.session.submit();assert.deepEqual(f.answers,[clone(answer)]);assert.equal(f.disk().stage,'queued');
});

test('lost enqueue response retries the same operation and identical complete bytes without another review gesture',async t=>{
 const f=fixture(t),hash=await f.ready('用新价格，但运费不改',true),stored=new Map(),attempts=[];await f.session.showReview(hash);const answer=f.frozen();
 f.ports.enqueue=value=>{const bytes=JSON.stringify(value);attempts.push(bytes);const prior=stored.get(value.binding.operation_id);if(prior)assert.equal(bytes,prior);else stored.set(value.binding.operation_id,bytes);
  if(attempts.length===1)throw Error('synthetic persisted enqueue lost its reply');f.draft.queued(value.binding.operation_id);return'awaiting_refresh';};
 f.receive(1);await f.settle();assert.equal(stored.size,1);assert.equal(f.disk().stage,'sealed');assert.equal(f.disk().cleanup_uid,'');const sealed=f.bytes();assert.throws(()=>f.draft.edit(f.binding.context_key,'不能改重试字节',f.now));assert.deepEqual(f.bytes(),sealed);
 const sends=f.sent.length;await f.session.submit();assert.equal(attempts.length,2);assert.equal(attempts[0],attempts[1]);assert.deepEqual(JSON.parse(attempts[1]),clone(answer));assert.equal(stored.size,1);assert.equal(f.disk().stage,'queued');assert.equal(f.sent.length,sends);
});

test('phone submit rejects a full-text or source change while original request revalidation waits',async t=>{
 for(const change of ['text','source'])await t.test(change,async t=>{
  const f=fixture(t);await f.ready('用新价格，运费沿用上次',true);const clicked=f.frozen(),pending=gate(),reads=f.reads;
  f.onLive(()=>pending.promise);const work=f.session.submit();await until(()=>f.reads===reads+1);
  f.draft.edit(f.binding.context_key,change==='text'?'等待期间改为旧价格，运费不改':clicked.text,f.now);
  const latest=f.bytes(),record=f.disk();assert.equal(record.stage,'review');assert.equal(record.input_source,'phone');
  if(change==='text')assert.notEqual(record.text,clicked.text);else assert.equal(record.text,clicked.text);
  pending.release();await assert.rejects(work);await f.settle();
  assert.equal(f.answers.length,0);assert.deepEqual(f.bytes(),latest,'submit cannot seal or overwrite the newly edited complete answer');assert.equal(f.sent.length,0);
 });
});

test('phone submit rejects an option correction while the original request refresh waits',async t=>{
 const f=fixture(t);f.binding.mode='choice';f.binding.options=[{option_id:'new',label:'新价格'},{option_id:'old',label:'旧价格'}];
 Object.assign(f.plan,{adopt_option_id:'new',adopt_text:'新价格'});f.draft.begin(f.binding,f.plan,f.now);
 const uid=f.binding.operation_id+'-proposal';f.draft.armCard(f.binding.context_key,'peer',uid,f.now);f.draft.suggestion(f.binding.context_key,'peer',34,uid,1,f.now);f.draft.removalSubmitted('peer',uid);await f.session.resume();
 const clicked=f.frozen();assert.equal(clicked.option_id,'new');const pending=gate(),reads=f.reads;f.onLive(()=>pending.promise);
 const work=f.session.submit();await until(()=>f.reads===reads+1);f.draft.edit(f.binding.context_key,clicked.text,f.now);
 const latest=f.bytes();assert.equal(f.disk().option_id,null);assert.equal(f.disk().text,clicked.text);pending.release();await assert.rejects(work);await f.settle();
 assert.equal(f.answers.length,0);assert.deepEqual(f.bytes(),latest);assert.equal(f.sent.length,0);
});

test('phone submit rejects a reloaded binding change even when stage and complete answer stay identical',async t=>{
 for(const field of ['question','request_revision','session_id'])await t.test(field,async t=>{
  const f=fixture(t);await f.ready('完整条件不能转交另一问题',true);const clicked=f.frozen(),pending=gate(),reads=f.reads;
  f.onLive(()=>pending.promise);const work=f.session.submit();await until(()=>f.reads===reads+1);
  // Model a legitimate replacement runtime loading another durable binding;
  // no private in-memory record or fake device operation is injected.
  const changed=f.disk();if(field==='request_revision')changed.binding.request_revision++;
  else if(field==='session_id')changed.binding.route.session_id+='-replacement';else changed.binding.question+='已更新';
  fs.writeFileSync(f.file,JSON.stringify(changed));f.draft.initialize(f.root);assert.equal(f.draft.blocked,false);
  f.draft.resume(changed.binding,f.now);const latest=f.bytes();assert.equal(f.disk().stage,'review');assert.equal(f.disk().text,clicked.text);
  pending.release();await assert.rejects(work);await f.settle();assert.equal(f.answers.length,0);assert.deepEqual(f.bytes(),latest);assert.equal(f.sent.length,0);
 });
});

test('phone submit rejects an independently sealed same-answer stage and preserves cleanup armed during refresh',async t=>{
 for(const change of ['sealed_same_answer','deferred','cleanup'])await t.test(change,async t=>{
  const f=fixture(t);await f.ready('全文相同也不能忽略阶段变化',true);const clicked=f.frozen(),pending=gate(),reads=f.reads;
  f.onLive(()=>pending.promise);const work=f.session.submit();await until(()=>f.reads===reads+1);
  if(change==='sealed_same_answer'){f.draft.seal(f.binding.context_key,f.now);assert(f.taskSameSubmission(f.frozen(),clicked),'full submission equality alone does not authorize a changed stage');}
  else if(change==='deferred')f.draft.defer();
  else f.draft.armReviewCard(clicked,'peer',f.binding.operation_id+'-parallel-review',f.now);
  const latest=f.bytes();pending.release();await assert.rejects(work);await f.settle();
  assert.equal(f.answers.length,0);assert.deepEqual(f.bytes(),latest);assert.equal(f.sent.length,0);
 });
});

test('unchanged phone submit seals before enqueue and an explicit sealed retry keeps the same operation and full bytes',async t=>{
 const f=fixture(t);await f.ready('完整首句。\n完整末句与运费条件。',true);const clicked=clone(f.frozen()),pending=gate(),reads=f.reads,attempts=[];
 f.onLive(()=>pending.promise);f.ports.enqueue=answer=>{
  assert.equal(f.disk().stage,'sealed');assert.deepEqual(clone(answer),clicked);attempts.push(JSON.stringify(answer));
  if(attempts.length===1)throw Error('synthetic lost enqueue reply');f.draft.queued(answer.binding.operation_id);return'awaiting_refresh';
 };
 const work=f.session.submit();await until(()=>f.reads===reads+1);const reviewing=f.bytes();pending.release();await assert.rejects(work,/lost enqueue reply/);await f.settle();
 assert.equal(JSON.parse(reviewing).stage,'review');assert.equal(f.disk().stage,'sealed');assert.equal(f.disk().text,clicked.text);assert.equal(attempts.length,1);
 const refreshes=f.reads;f.onLive(()=>{assert.fail('a sealed retry must reconcile the original operation without refreshing or replacing the answer');});
 await f.session.submit();assert.equal(f.reads,refreshes);assert.equal(attempts.length,2);assert.equal(attempts[0],attempts[1]);assert.equal(f.disk().stage,'queued');assert.equal(f.sent.length,0);
});

test('cold session protects an interrupted newer full answer and never overwrites it with the older canonical review',async t=>{
 const f=fixture(t);await f.ready('旧的完整条件',true);const old=f.bytes();f.failPromotion(true);
 assert.throws(()=>f.draft.edit(f.binding.context_key,'尚未提升的新全文与补充条件',f.now),/disk-failure/);f.failPromotion(false);
 const partial=fs.readFileSync(f.file+'.partial');assert.equal(JSON.parse(partial).text,'尚未提升的新全文与补充条件');assert.deepEqual(f.bytes(),old);
 const next=f.cold();assert.equal(next.draft.blocked,true);await turn();assert.equal(f.answers.length,0);
 await assert.rejects(Promise.resolve().then(()=>next.session.resume()));await assert.rejects(Promise.resolve().then(()=>next.session.submit()));
 assert.deepEqual(f.bytes(),old);assert.deepEqual(fs.readFileSync(f.file+'.partial'),partial);assert.equal(f.answers.length,0);assert.equal(f.sent.length,0);
});

test('explicit sealed retry detects a late partial or another durable writer before enqueue',async t=>{
 for(const change of ['partial','canonical_writer'])await t.test(change,async t=>{
  const f=fixture(t);await f.ready('已封存的原始条件',true);const clicked=f.draft.seal(f.binding.context_key,f.now),changed=f.disk();changed.text='另一写入留下的完整条件';
  const target=change==='partial'?f.file+'.partial':f.file;fs.writeFileSync(target,JSON.stringify(changed));
  const canonical=f.bytes(),interrupted=change==='partial'?fs.readFileSync(target):undefined;
  await assert.rejects(Promise.resolve().then(()=>f.session.submit()));await f.settle();
  assert.equal(f.answers.length,0,'durability conflict must be detected before any enqueue port call');assert.deepEqual(f.bytes(),canonical);assert.equal(f.sent.length,0);
  if(interrupted)assert.deepEqual(fs.readFileSync(target),interrupted);assert.equal(clicked.binding.operation_id,f.binding.operation_id);
 });
});

test('real singleton shows only a fresh complete voice answer; missing or partial status, generic changes and cold recovery never auto-display',async t=>{
 for(const [cold,transcriptStatus] of [[false,'complete'],[true,'complete'],[false,undefined],[false,'partial']]){
  const f=fixture(t),text='用新价格，运费沿用上次';f.draft.begin(f.binding,f.plan,f.now);
  for(const [suffix,cmd] of [['proposal',2],['supplement',1]]){const uid=f.binding.operation_id+'-'+suffix;f.draft.armCard(f.binding.context_key,'peer',uid,f.now);f.draft.suggestion(f.binding.context_key,'peer',34,uid,cmd,f.now);f.draft.removalSubmitted('peer',uid);}
  const captureView={},probe={features:{state:{connected:true},displayActive:false},foreground:true,peerDeviceId:'peer',agentCaptureOccupied:false,agentSuggestionOccupied:false,
   voice:{active:false},recordingOccupied:()=>false,lifelogOccupied:()=>false,prompterOccupied:()=>false,auth:{sendBusiness:(business,bytes)=>f.ports.send(business,bytes)}};
  let active=false,starts=0,clears=0;let state={phase:'idle',binding:'',text:'',savedDraftValid:false,exitEvidence:'none',transcriptStatus:'none'};
  const capture={get active(){return active;},get state(){return state;},sourceOrigin:(token,value)=>f.sources.origin(token,value,{...state,active}),async start(token,seconds,guard){
   starts++;assert.equal(seconds,15);state={...state,phase:'preparing',binding:token,transcriptStatus:'pending'};active=true;probe.agentCaptureOccupied=true;await guard();state.phase='listening';
  },clearDraft(){
   assert.equal(f.disk().stage,'review');assert.equal(f.disk().text,text);clears++;active=false;state={phase:'idle',binding:'',text:'',savedDraftValid:false,exitEvidence:'none',transcriptStatus:'none'};
   probe.agentCaptureOccupied=false;captureView.replyChanged?.();
  },async stop(){active=false;probe.agentCaptureOccupied=false;state.phase='failed';},async cleanup(){throw Error('unexpected capture cleanup');}};
  const taskService={decisionDraft:f.draft,summary:()=>({contextKey:f.binding.context_key}),validateReply:binding=>f.ports.validate(binding),revalidateReply:binding=>f.ports.revalidate(binding),
   voiceSources:f.sources,assertAnswer:answer=>f.sources.assertAnswer(answer),operationExists:()=>false,answerBound(){assert.fail('the automatic confirmation card never submits an answer');}};
  const mod=loadApp('TaskSuggestionService',{...f.platform,'./ProbeSession':{probeSession:probe},'./TaskService':{taskService},
   './AgentCaptureService':{agentCapture:capture,agentCaptureView:captureView},'./NotificationService':{notifications:{busy:false,waiting:false},suggestionTests:{active:false}}},f.globals);
  mod.initializeTaskSuggestions();
  try{
   if(cold){
    f.draft.pause();state={phase:'draft',binding:JSON.stringify({format:'turboio-task-voice/1',attempt_id:'voice-'+'b'.repeat(32),peer:'peer',reply:clone(f.binding)}),text,savedDraftValid:true,exitEvidence:'device_event',transcriptStatus:'complete'};
    assert(mod.taskVoiceReplies.canRecover);await mod.taskVoiceReplies.recover();await turn();assert.equal(f.sent.length,0);assert.equal(starts,0);assert.equal(f.draft.paused,true);assert.equal(f.sources.state(f.draft.snapshot().voice_source),'unknown');
   }else{
    await mod.taskVoiceReplies.begin(f.binding);assert.equal(starts,1);assert.equal(f.sent.length,0);
    active=false;probe.agentCaptureOccupied=false;state={...state,phase:'draft',text,savedDraftValid:true,exitEvidence:'device_event',transcriptStatus};
    if(transcriptStatus===undefined)delete state.transcriptStatus;
    const original=f.bytes();captureView.replyChanged();
    if(transcriptStatus==='complete'){
     await until(()=>f.sent.length===1);await settle(mod.taskSuggestions);assert.equal(clears,1);const card=f.sent[0];assert.equal(card.type,33);assert.equal(card.value.type,1);assert.equal(card.value.title,'pc·hermes');
     assert.equal(card.value.content,f.binding.question+' 答：'+text+' 点头发送；摇头保留。');assert.equal(f.disk().stage,'review');assert.equal(f.disk().text,text);assert.equal(f.disk().input_source,'voice');
     assert.equal(state.text,'');assert.equal(state.binding,'');assert.equal(probe.agentSuggestionOccupied,true);
    }else{
     for(let n=0;n<8;n++)await turn();await settle(mod.taskSuggestions);assert.equal(f.sent.length,0);assert.equal(clears,0);assert.equal(state.text,text);
     assert.deepEqual(f.bytes(),original,'incomplete source cannot become the original answer');assert.equal(f.disk().stage,'voice_authorized');assert.equal(mod.taskVoiceReplies.canRecover,false);assert.equal(probe.agentSuggestionOccupied,false);
    }
   }
   const count=f.sent.length;captureView.replyChanged();mod.taskVoiceReplies.changed();captureView.replyChanged();await turn();await settle(mod.taskSuggestions);assert.equal(f.sent.length,count);assert.equal(f.answers.length,0);
  }finally{mod.disposeTaskSuggestions();await settle(mod.taskSuggestions);}
 }
});

test('explicit phone adoption of tainted full text only creates a ready phone draft and never displays or submits automatically',async t=>{
 const f=fixture(t);f.seed('用新价格，但运费沿用上次。\n请先只生成预览。',true);const before=f.disk();f.sources.invalidate();
 assert.equal(f.session.reviewStatus().reason,'source_unverified');const hash=f.session.adoptionHash();assert.match(hash,/^[a-f0-9]{64}$/);
 await f.session.adoptPhone(hash);const after=f.disk();assert.equal(after.schema,2);assert.equal(after.voice_source,null);assert.equal(after.input_source,'phone');assert.equal(after.stage,'review');assert.equal(after.option_id,null);
 assert.equal(after.text,before.text);assert.deepEqual(after.binding,before.binding);assert.deepEqual(after.used_uids,before.used_uids);assert.equal(f.draft.paused,false,'the session resumes only after its explicit local adoption and refresh');
 assert.equal(f.sent.length,0);assert.equal(f.answers.length,0);assert.equal(f.timers.size,0);f.sources.assertAnswer(f.frozen());
 await f.session.submit();assert.equal(f.answers.length,1,'submission remains a separate explicit action');assert.equal(f.answers[0].input_source,'phone');assert.equal(f.answers[0].voice_source,null);
});

test('phone adoption rechecks full text, source, schema, stage, original binding and runtime after its asynchronous refresh',async t=>{
 const changes=['text','source_ref','schema','stage','binding','peer','context','background','pause','deadline','cleanup','outbox'];
 for(const change of changes)await t.test(change,async t=>{
  const f=fixture(t);f.seed('完整正文和尾句不得变化。',true);const hash=f.session.adoptionHash(),clicked=f.frozen(),pending=gate(),reads=f.reads;
  f.onLive(()=>pending.promise);const work=f.session.adoptPhone(hash);await until(()=>f.reads===reads+1);
  if(change==='text')f.draft.edit(f.binding.context_key,clicked.text+'后改尾句',f.now);
  if(['source_ref','schema','binding'].includes(change)){
   const altered=f.disk();if(change==='source_ref')altered.voice_source.connection_epoch='different-synthetic-epoch';
   else if(change==='schema'){altered.schema=1;delete altered.voice_source;}else altered.binding.route.session_id+='-replacement';
   fs.writeFileSync(f.file,JSON.stringify(altered));f.draft.initialize(f.root);assert.equal(f.draft.blocked,false);
  }
  if(change==='stage')f.draft.seal(f.binding.context_key,f.now);
  if(change==='peer')f.setPeer('other-peer');if(change==='context')f.setKey('other-context');if(change==='background')f.setForeground(false);
  if(change==='pause')f.session.pause();if(change==='deadline')f.advance(3600000);
  if(change==='cleanup')f.draft.armReviewCard(clicked,'peer',f.binding.operation_id+'-parallel-review',f.now);
  if(change==='outbox')f.operations.add(f.binding.operation_id);
  const latest=f.bytes();pending.release();await assert.rejects(work);await f.settle();assert.deepEqual(f.bytes(),latest,'failed adoption cannot overwrite the latest complete record');
  assert.equal(f.answers.length,0);assert.equal(f.sent.length,0);
 });
});

test('phone adoption refuses an existing operation or missing outbox guard before refresh and never replaces queued work',async t=>{
 for(const missing of [false,true])await t.test(missing?'missing_guard':'existing_operation',async t=>{
  const f=fixture(t);f.seed('已存完整正文。',true);const hash=f.session.adoptionHash(),bytes=f.bytes(),reads=f.reads;
  if(missing)delete f.ports.operationExists;else f.operations.add(f.binding.operation_id);
  assert.equal(f.session.adoptionHash(),'');await assert.rejects(Promise.resolve().then(()=>f.session.adoptPhone(hash)));
  assert.equal(f.reads,reads);assert.deepEqual(f.bytes(),bytes);assert.equal(f.answers.length,0);assert.equal(f.sent.length,0);
 });
});

test('real legacy phone or voice bytes require explicit full adoption before becoming a schema2 independent phone answer',async t=>{
 for(const input of ['phone','voice'])await t.test(input,async t=>{
  const f=fixture(t);f.seed('旧格式完整正文，尾句须由用户核对。',true);const legacy=f.disk();legacy.schema=1;legacy.input_source=input;delete legacy.voice_source;
  const raw=JSON.stringify(legacy,null,2)+'\r\n';fs.writeFileSync(f.file,raw);f.draft.initialize(f.root);assert.equal(f.draft.snapshot().schema,1);assert.equal(f.bytes().toString(),raw);
  assert.throws(()=>f.sources.assertAnswer(f.frozen()),/LEGACY/);await f.session.adoptPhone(f.session.adoptionHash());
  assert.equal(f.disk().schema,2);assert.equal(f.disk().input_source,'phone');assert.equal(f.disk().voice_source,null);assert.equal(f.disk().text,legacy.text);assert.deepEqual(f.disk().binding,legacy.binding);
  assert.equal(f.answers.length,0);assert.equal(f.sent.length,0);f.sources.assertAnswer(f.frozen());
 });
});

test('source taint during review refresh or after a native seal blocks stale display and every enqueue retry',async t=>{
 const f=fixture(t),hash=await f.ready('完整条件',true),pending=gate(),reads=f.reads;f.onLive(()=>pending.promise);const display=f.session.showReview(hash);await until(()=>f.reads===reads+1);
 f.sources.invalidate();pending.release();await assert.rejects(display);await f.settle();assert.equal(f.sent.length,0);assert.equal(f.answers.length,0);assert.equal(f.disk().stage,'review');
 const g=fixture(t),nextHash=await g.ready('已确认的完整条件',true),feedback=gate();await g.session.showReview(nextHash);g.ports.wait=ms=>ms===2500?feedback.promise:Promise.resolve();
 g.receive(1);await until(()=>g.disk().stage==='sealed');g.sources.invalidate();feedback.release();await g.settle();assert.equal(g.disk().stage,'sealed');assert.equal(g.disk().cleanup_uid,'');assert.equal(g.answers.length,0);
 await assert.rejects(g.session.submit());assert.equal(g.answers.length,0);assert.equal(g.disk().text,'已确认的完整条件');
});
