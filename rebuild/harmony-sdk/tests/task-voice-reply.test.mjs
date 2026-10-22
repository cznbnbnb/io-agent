import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {loadApp} from './load-app.mjs';
import {setupMaterialStore} from './material-fixture.mjs';
import {syntheticTaskSources} from './task-source-fixture.mjs';

const clone=value=>JSON.parse(JSON.stringify(value));
const turn=()=>new Promise(setImmediate);
async function drain(){for(let n=0;n<8;n++)await turn();}
function deferred(){let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve};}

// Only the capture/device boundary is replaced. Authorization, reply identity,
// atomic persistence, restart validation and the voice coordinator are real.
function fixture(t,{stage='voice_authorized',cleanup=false,choice=false}={}){
 const f=setupMaterialStore(t),initialEntries=fs.readdirSync(f.root),timers=new Map();let now=Date.now(),timer=0,peer='synthetic-peer',key='original-owner-phone-route',foreground=true,released=true;
 let validateHook,revalidateHook,startHook,clearHook,stopHook,nonce='voice-'+'a'.repeat(32);
 const calls={starts:[],guards:0,microphoneWrites:0,revalidations:[],stops:[],clears:0,cleanups:0,enqueues:0};
 class Clock extends Date{static now(){return now;}}
 const globals={Date:Clock,setTimeout(fn,ms){timers.set(++timer,{fn,ms});return timer;},clearTimeout(id){timers.delete(id);}};
 const platform={'@kit.CoreFileKit':{fileIo:f.io}};
 const model=loadApp('TaskReplyDraft',platform,globals),voiceModel=loadApp('TaskVoiceReplySession',platform,globals);
 const draft=new model.TaskDecisionDraft(),binding=new model.TaskReplyBinding(),plan=new model.TaskDecisionPlan();draft.initialize(f.root);
 Object.assign(binding,{context_key:key,operation_id:'original-operation',request_id:'original-question',request_revision:3,task_id:'original-task',
  route:{computer_id:'pc',agent_id:'hermes',project_id:'project',session_id:'original-session'},expires_at:new Date(now+60000).toISOString(),question:'采用新价格吗？',mode:'free_text'});
 if(choice){binding.mode='choice';binding.options=[{option_id:'new-price',label:'新价格'},{option_id:'old-price',label:'旧价格'}];plan.adopt_option_id='new-price';plan.adopt_text='新价格';}
 draft.begin(binding,plan,now);
 const first=binding.operation_id+'-proposal',second=binding.operation_id+'-supplement';
 if(stage!=='proposal'){
  draft.armCard(key,peer,first,now);draft.suggestion(key,peer,34,first,2,now);draft.removalSubmitted(peer,first);
  if(stage!=='supplement_offer'){
   draft.armCard(key,peer,second,now);draft.suggestion(key,peer,34,second,stage==='review'?2:1,now);
   if(!cleanup)draft.removalSubmitted(peer,second);
  }
 }
 let capture={active:false,phase:'idle',binding:'',text:'',valid:false,exitEvidence:'none',transcriptStatus:'none'};
 const sources=syntheticTaskSources({connection:()=>({peer,epoch:7})});
 const empty=()=>({active:false,phase:'idle',binding:'',text:'',valid:false,exitEvidence:'none',transcriptStatus:'none'});
 const ports={state:()=>clone(capture),device:()=>peer,context:()=>key,foreground:()=>foreground,cardReleased:()=>released,nonce:()=>nonce,
  validate(b){if(validateHook)validateHook(b);},
  async revalidate(b){calls.revalidations.push(clone(b));if(revalidateHook)await revalidateHook(b);},
  async start(token,guard){
   calls.starts.push(token);capture={...empty(),phase:'preparing',binding:token,transcriptStatus:'pending'};
   if(startHook)await startHook(token,guard);calls.guards++;await guard();calls.microphoneWrites++;
   capture={...capture,active:true,phase:'listening'};
  },
  async stop(cancelled){calls.stops.push(cancelled);if(stopHook)return stopHook(cancelled);capture={...capture,active:false,phase:'failed',valid:false,transcriptStatus:cancelled?'cancelled':'partial'};},
  clear(){calls.clears++;if(clearHook)clearHook();capture=empty();},
  async cleanup(){calls.cleanups++;capture={...capture,active:false,phase:'failed',valid:false};},
  source(token,text,recover){if(!recover)sources.origin(token,text,capture);return sources.source(token,text,recover);},
  enqueue(){calls.enqueues++;throw Error('answer enqueue is forbidden in the voice coordinator');}};
 const createDraft=()=>{const value=new model.TaskDecisionDraft();value.initialize(f.root);return value;};
 const createVoice=(value=draft)=>new voiceModel.TaskVoiceReplySession(value,ports),session=createVoice();
 const file=f.root+'/task-decision-draft.json',disk=()=>JSON.parse(fs.readFileSync(file,'utf8'));
 const complete=(text='用新价格，但运费沿用上次。\n请先只生成预览，别发送。')=>{capture={...capture,active:false,phase:'draft',text,valid:true,exitEvidence:'device_event',transcriptStatus:'complete'};};
 return {...f,...model,...voiceModel,initialEntries,binding,plan,draft,session,ports,calls,timers,file,disk,createDraft,createVoice,complete,sources,
  get now(){return now;},get capture(){return clone(capture);},setCapture:patch=>{capture={...capture,...patch};},
  advance:n=>now+=n,setPeer:v=>peer=v,setKey:v=>key=v,setForeground:v=>foreground=v,setReleased:v=>released=v,setNonce:v=>nonce=v,
  onValidate:fn=>validateHook=fn,onRevalidate:fn=>revalidateHook=fn,onStart:fn=>startHook=fn,onClear:fn=>clearHook=fn,onStop:fn=>stopHook=fn};
}

test('only fresh second-card consent with its old UID cleaned can start capture',async t=>{
 for(const options of [{stage:'proposal'},{stage:'supplement_offer'},{stage:'review'},{cleanup:true}]){
  const f=fixture(t,options),bytes=fs.readFileSync(f.file);await assert.rejects(f.session.begin(f.binding),/NOT_READY/);
  assert.equal(f.calls.starts.length,0);assert.equal(f.calls.microphoneWrites,0);assert.deepEqual(fs.readFileSync(f.file),bytes);
 }
 const f=fixture(t);await f.session.begin(f.binding);assert.equal(f.calls.microphoneWrites,1);assert.equal(f.draft.snapshot().stage,'voice_authorized');
 assert.equal(f.calls.enqueues,0);f.session.cancel();
});

test('capture token contains the complete original request, route, revision, options and one attempt identity',async t=>{
 const f=fixture(t,{choice:true});await f.session.begin(f.binding);const token=f.calls.starts[0],value=JSON.parse(token);
 assert.equal(value.format,'turboio-task-voice/1');assert.equal(value.attempt_id,'voice-'+'a'.repeat(32));assert.equal(value.peer,'synthetic-peer');
 assert.deepEqual(value.reply,clone(f.binding));assert.equal(token,f.capture.binding);assert.equal(f.calls.revalidations.length,1);
 assert.deepEqual(f.calls.revalidations[0],clone(f.binding));assert.equal(f.calls.microphoneWrites,1);f.session.cancel();
});

test('changed original binding and oversized tokens fail before microphone writes without truncating identity',async t=>{
 const mutations=[b=>b.context_key+='-other',b=>b.operation_id+='-other',b=>b.request_id+='-other',b=>b.request_revision++,b=>b.task_id+='-other',
  b=>b.route.session_id+='-other',b=>b.route.computer_id+='-other',b=>b.route.agent_id+='-other',b=>b.route.project_id+='-other',
  b=>b.expires_at=new Date(Date.parse(b.expires_at)+1000).toISOString(),b=>b.question+='完整变更'];
 for(const mutate of mutations){const f=fixture(t),binding=clone(f.binding);mutate(binding);await assert.rejects(f.session.begin(binding),/NOT_READY/);assert.equal(f.calls.starts.length,0);}
 const f=fixture(t);f.draft.abandon();f.binding.context_key='x'.repeat(1800);f.setKey(f.binding.context_key);f.binding.operation_id='oversize-original';f.draft.begin(f.binding,f.plan,f.now);
 for(const [suffix,cmd] of [['proposal',2],['supplement',1]]){const uid=f.binding.operation_id+'-'+suffix;f.draft.armCard(f.binding.context_key,'synthetic-peer',uid,f.now);f.draft.suggestion(f.binding.context_key,'synthetic-peer',34,uid,cmd,f.now);f.draft.removalSubmitted('synthetic-peer',uid);}
 await assert.rejects(f.session.begin(f.binding),/BINDING_TOO_LARGE/);assert.equal(f.calls.microphoneWrites,0);assert.equal(f.calls.starts.length,0);
 assert.equal(f.draft.snapshot().binding.context_key.length,1800);
});

test('guard rechecks peer, context, foreground, released card and expiry after asynchronous preparation',async t=>{
 const changes=[f=>f.setPeer('another-peer'),f=>f.setKey('another-owner'),f=>f.setForeground(false),f=>f.setReleased(false),f=>f.advance(60000)];
 for(const change of changes){const f=fixture(t);f.onStart(()=>change(f));await assert.rejects(f.session.begin(f.binding),/START_UNCONFIRMED/);
  assert.equal(f.calls.microphoneWrites,0);assert.equal(f.calls.revalidations.length,0);assert.equal(f.draft.snapshot().stage,'voice_authorized');assert(f.draft.paused);}
});

test('request closing or context switching during fresh validation fences the microphone write',async t=>{
 for(const change of [f=>f.setKey('other-owner'),f=>f.setPeer('other-peer'),f=>f.setForeground(false),f=>f.setReleased(false),f=>f.advance(60000)]){
  const f=fixture(t),gate=deferred();f.onRevalidate(()=>gate.promise);const work=f.session.begin(f.binding);await turn();change(f);gate.resolve();
  await assert.rejects(work,/START_UNCONFIRMED/);assert.equal(f.calls.microphoneWrites,0);assert.equal(f.draft.snapshot().text,'');assert.equal(f.calls.enqueues,0);
 }
 const f=fixture(t);f.onRevalidate(()=>{throw Error('TASK_REQUEST_CLOSED');});await assert.rejects(f.session.begin(f.binding),/START_UNCONFIRMED/);assert.equal(f.calls.microphoneWrites,0);
});

test('complete final ASR tail is durable in the original review before capture copy can be cleared, without enqueue',async t=>{
 const f=fixture(t),text='用新价格，但运费沿用上次。\n'+('这句不是最终尾句。'.repeat(300))+'最终条件：只出预览，不发送。';
 await f.session.begin(f.binding);f.onClear(()=>{
  const disk=f.disk();assert.equal(disk.stage,'review');assert.equal(disk.text,text);assert.equal(disk.input_source,'voice');assert.deepEqual(disk.binding,clone(f.binding));
  const restored=f.createDraft();assert.equal(restored.snapshot().text,text,'a new real reader sees the full durable tail before source deletion');
 });
 f.complete(text);f.session.observe();await drain();assert.equal(f.calls.clears,1);assert.equal(f.draft.snapshot().text,text);assert.equal(f.draft.snapshot().stage,'review');
 assert.equal(f.draft.snapshot().option_id,null);assert.equal(f.calls.enqueues,0);assert.equal(f.capture.text,'');assert.equal(f.session.active,false);assert.equal(f.timers.size,0);
 assert.deepEqual(fs.readdirSync(f.root).sort(),[...f.initialEntries,'task-decision-draft.json'].sort(),'no transport mailbox or server outbox is created by the voice bridge');
 f.session.observe();await drain();assert.equal(f.calls.clears,1,'a repeated completion callback cannot copy or enqueue twice');
});

test('unconfirmed exits, incomplete transcript status, invalid captures and whitespace never replace an original unanswered question',async t=>{
 for(const patch of [{exitEvidence:'none'},{transcriptStatus:'partial'},{transcriptStatus:'cancelled'},{transcriptStatus:'legacy'},{transcriptStatus:undefined},{valid:false},{phase:'failed'},{text:' \n '}]){
  const f=fixture(t);await f.session.begin(f.binding);const bytes=fs.readFileSync(f.file);f.complete();f.setCapture(patch);f.session.observe();await drain();
  assert.deepEqual(fs.readFileSync(f.file),bytes);assert.equal(f.draft.snapshot().stage,'voice_authorized');assert.equal(f.calls.clears,0);assert.equal(f.calls.enqueues,0);assert(f.draft.paused);
 }
});

test('failed original-draft promotion protects both complete copies and cannot overwrite its interrupted write on retry',async t=>{
 const f=fixture(t),text='用新价格，但运费沿用上次。最终句必须保留。';await f.session.begin(f.binding);const bytes=fs.readFileSync(f.file);
 f.complete(text);f.failPromotion(true);f.session.observe();await drain();assert.deepEqual(fs.readFileSync(f.file),bytes);assert.equal(f.draft.snapshot().stage,'voice_authorized');
 assert.equal(f.capture.text,text);assert.equal(f.capture.valid,true);assert.equal(f.calls.clears,0);assert.equal(f.calls.enqueues,0);assert(f.draft.paused);
 const partial=fs.readFileSync(f.file+'.partial');assert.equal(JSON.parse(partial).text,text);assert.equal(f.draft.blocked,true);
 f.failPromotion(false);assert.equal(f.session.canRecover,false);assert.equal(f.session.canClearCopied,false);assert.equal(f.session.canDiscardRetained,false);
 assert.throws(()=>f.session.recover(),/RECOVERY_INVALID/);assert.deepEqual(fs.readFileSync(f.file),bytes);assert.deepEqual(fs.readFileSync(f.file+'.partial'),partial);
 assert.equal(f.capture.text,text);assert.equal(f.calls.clears,0);assert.equal(f.calls.enqueues,0);assert.equal(f.calls.microphoneWrites,1,'storage failure never reopens microphone');
});

test('failed capture-copy cleanup cannot lose saved answer and explicit clear only removes identical copied text',async t=>{
 const f=fixture(t);await f.session.begin(f.binding);f.complete();const text=f.capture.text;f.onClear(()=>{throw Error('synthetic source cleanup failure');});
 f.session.observe();await drain();assert.equal(f.disk().text,text);assert.equal(f.disk().stage,'review');assert.equal(f.capture.text,text);assert(f.session.canClearCopied);
 const bytes=fs.readFileSync(f.file);f.setCapture({text:text+'foreign tail'});assert.equal(f.session.canClearCopied,false);assert.throws(()=>f.session.clearCopied(),/DRAFT_PROTECTED/);assert.deepEqual(fs.readFileSync(f.file),bytes);
 f.setCapture({text});f.onClear(undefined);f.session.clearCopied();assert.equal(f.capture.text,'');assert.deepEqual(fs.readFileSync(f.file),bytes);assert.equal(f.calls.enqueues,0);
});

test('copied source cleanup remains recoverable after explicit sealing or queueing and never rewrites the answer',async t=>{
 for(const stage of ['sealed','queued']){
  const f=fixture(t);await f.session.begin(f.binding);f.complete();const text=f.capture.text;f.onClear(()=>{throw Error('source cleanup failure');});
  f.session.observe();await drain();f.draft.seal(f.binding.context_key,f.now);if(stage==='queued')f.draft.queued(f.binding.operation_id);
  const bytes=fs.readFileSync(f.file);assert.equal(f.disk().stage,stage);assert(f.session.canClearCopied);assert.equal(f.session.canDiscardRetained,false);
  assert.throws(()=>f.session.clearCopied(),/source cleanup failure/);assert.equal(f.capture.text,text);assert.deepEqual(fs.readFileSync(f.file),bytes);
  for(const patch of [{active:true},{phase:'failed'},{exitEvidence:'none'},{transcriptStatus:'partial'},{valid:false}]){
   f.setCapture(patch);assert.equal(f.session.canClearCopied,false);assert.throws(()=>f.session.clearCopied(),/DRAFT_PROTECTED/);
   f.setCapture({active:false,phase:'draft',exitEvidence:'device_event',transcriptStatus:'complete',valid:true});
  }
  f.onClear(undefined);f.session.clearCopied();assert.equal(f.capture.text,'');assert.deepEqual(fs.readFileSync(f.file),bytes);assert.equal(f.calls.enqueues,0);
 }
});

test('expired complete text stays available for explicit discard and neither expiry nor discard sends a decline',async t=>{
 const f=fixture(t);await f.session.begin(f.binding);const bytes=fs.readFileSync(f.file);f.advance(60000);f.session.stateChanged();await drain();
 const text='期限已经过去，但完整尾句仍须保存供用户检查。';f.complete(text);f.session.observe();await drain();
 assert.equal(f.session.canRecover,false);assert.equal(f.session.canClearCopied,false);assert.equal(f.session.canDiscardRetained,true);assert.equal(f.session.retainedText,text);
 assert.equal(f.calls.clears,0);assert.deepEqual(fs.readFileSync(f.file),bytes);assert.equal(f.calls.enqueues,0);
 f.onClear(()=>{throw Error('explicit discard cleanup failed');});assert.throws(()=>f.session.discardRetained(),/cleanup failed/);assert.equal(f.session.retainedText,text);assert(f.session.canDiscardRetained);
 f.onClear(undefined);f.session.discardRetained();assert.equal(f.capture.text,'');assert.equal(f.session.retainedText,'');assert.equal(f.session.canDiscardRetained,false);
 assert.deepEqual(fs.readFileSync(f.file),bytes);assert.equal(f.disk().stage,'voice_authorized');assert.equal(f.calls.enqueues,0);
});

test('explicit retained-text discard protects active processing, in-flight validation and foreign binding',async t=>{
 const f=fixture(t);await f.session.begin(f.binding);f.setCapture({text:'尚在采集的片段'});assert.equal(f.session.canDiscardRetained,false);assert.throws(()=>f.session.discardRetained(),/DRAFT_PROTECTED/);
 const gate=deferred();f.onRevalidate(()=>gate.promise);f.complete();f.session.observe();await turn();assert.equal(f.session.canDiscardRetained,false);assert.throws(()=>f.session.discardRetained(),/DRAFT_PROTECTED/);
 f.session.cancel();gate.resolve();await drain();assert(f.session.canDiscardRetained);
 const token=JSON.parse(f.capture.binding);token.reply.route.session_id='foreign-session';f.setCapture({binding:JSON.stringify(token)});
 assert.equal(f.session.retainedText,'');assert.equal(f.session.canDiscardRetained,false);assert.throws(()=>f.session.discardRetained(),/DRAFT_PROTECTED/);assert.equal(f.calls.clears,0);
});

test('fresh result revalidation cannot publish after cancellation, request closure or identity change',async t=>{
 const changes=[f=>f.session.cancel(),f=>f.setPeer('other-peer'),f=>f.setKey('other-owner'),f=>f.setForeground(false),f=>f.setReleased(false),f=>f.advance(60000)];
 for(const change of changes){const f=fixture(t);await f.session.begin(f.binding);const bytes=fs.readFileSync(f.file),gate=deferred();f.onRevalidate(()=>gate.promise);
  f.complete();const text=f.capture.text;f.session.observe();await turn();change(f);gate.resolve();await drain();assert.deepEqual(fs.readFileSync(f.file),bytes);
  assert.equal(f.capture.text,text);assert.equal(f.calls.clears,0);assert.equal(f.calls.enqueues,0);assert.equal(f.draft.snapshot().stage,'voice_authorized');}
 const f=fixture(t);await f.session.begin(f.binding);f.complete();f.onRevalidate(()=>{throw Error('TASK_ALREADY_ANSWERED');});f.session.observe();await drain();assert.equal(f.disk().stage,'voice_authorized');assert.equal(f.calls.clears,0);
});

test('capture changing its bound token or final text during validation never transfers mixed attempts',async t=>{
 for(const change of [f=>f.setCapture({binding:f.capture.binding+' '}),f=>f.setCapture({text:f.capture.text+' unexpected later tail'}),f=>f.setCapture({active:true}),f=>f.setCapture({transcriptStatus:'partial'})]){
  const f=fixture(t);await f.session.begin(f.binding);const bytes=fs.readFileSync(f.file),gate=deferred();f.onRevalidate(()=>gate.promise);f.complete();
  f.session.observe();await turn();change(f);gate.resolve();await drain();assert.deepEqual(fs.readFileSync(f.file),bytes);assert.equal(f.calls.clears,0);assert.equal(f.calls.enqueues,0);
 }
});

test('cancel during preparation and late completion cannot restart or answer the original task',async t=>{
 const f=fixture(t),gate=deferred();f.onStart(()=>gate.promise);const work=f.session.begin(f.binding);await turn();const bytes=fs.readFileSync(f.file);
 f.session.cancel();gate.resolve();await assert.rejects(work,/START_UNCONFIRMED/);assert.equal(f.calls.microphoneWrites,0);
 f.complete('取消后的迟到完整结果');f.session.observe();await drain();assert.deepEqual(fs.readFileSync(f.file),bytes);assert.equal(f.capture.text,'取消后的迟到完整结果');assert.equal(f.calls.enqueues,0);assert.equal(f.calls.clears,0);
});

test('deadline timer stops only its owned capture and never means reject or cancel the desktop task',async t=>{
 const f=fixture(t);await f.session.begin(f.binding);const bytes=fs.readFileSync(f.file),timer=[...f.timers.values()][0];assert.equal(timer.ms,60000);
 f.advance(60000);timer.fn();await drain();assert.deepEqual(f.calls.stops,[true]);assert.deepEqual(fs.readFileSync(f.file),bytes);assert(f.draft.paused);assert.equal(f.calls.enqueues,0);
 f.complete('过期后送达的尾句');f.session.observe();await drain();assert.equal(f.disk().stage,'voice_authorized');assert.equal(f.calls.clears,0);assert.equal(f.capture.text,'过期后送达的尾句');
});

test('runtime identity and foreground changes stop an owned live capture without inventing an answer',async t=>{
 for(const change of [f=>f.setPeer('other-peer'),f=>f.setKey('other-owner'),f=>f.setForeground(false),f=>f.setReleased(false),f=>f.advance(60000)]){
  const f=fixture(t);await f.session.begin(f.binding);const bytes=fs.readFileSync(f.file);change(f);f.session.stateChanged();await drain();
  assert.deepEqual(f.calls.stops,[true]);assert.deepEqual(fs.readFileSync(f.file),bytes);assert(f.draft.paused);assert.equal(f.calls.enqueues,0);
 }
});

test('changing the original draft stops the previous bound microphone but does not pause or alter the replacement task',async t=>{
 const f=fixture(t);await f.session.begin(f.binding);const priorToken=f.capture.binding;
 f.draft.abandon();const replacement=clone(f.binding);replacement.operation_id='replacement-operation';replacement.request_id='replacement-question';replacement.task_id='replacement-task';
 f.draft.begin(replacement,f.plan,f.now);const bytes=fs.readFileSync(f.file);f.session.stateChanged();await drain();
 assert.deepEqual(f.calls.stops,[true],'capture ownership follows the exact active attempt even after the original draft is replaced');
 assert.equal(f.capture.binding,priorToken);assert.deepEqual(fs.readFileSync(f.file),bytes);assert.equal(f.draft.paused,false,'the old capture cannot pause a replacement task');assert.equal(f.calls.enqueues,0);
});

test('explicit stop keeps final capture processing separate from submission and protects a foreign attempt',async t=>{
 const f=fixture(t);await f.session.begin(f.binding);const text='停止时刚返回的完整尾句，不要丢失。';
 f.onStop(cancelled=>{assert.equal(cancelled,false);f.complete(text);f.session.observe();});await f.session.stop();await drain();
 assert.deepEqual(f.calls.stops,[false]);assert.equal(f.disk().text,text);assert.equal(f.disk().stage,'review');assert.equal(f.calls.enqueues,0);
 const g=fixture(t);await g.session.begin(g.binding);g.setCapture({binding:'a-different-live-attempt'});await assert.rejects(Promise.resolve().then(()=>g.session.stop()),/NOT_ACTIVE/);assert.equal(g.calls.stops.length,0);
});

test('text exceeding durable reply limits is preserved intact in capture rather than truncated into an answer',async t=>{
 const f=fixture(t);await f.session.begin(f.binding);const bytes=fs.readFileSync(f.file),text='长'.repeat(65537);f.complete(text);f.session.observe();await drain();
 assert.deepEqual(fs.readFileSync(f.file),bytes);assert.equal(f.capture.text,text);assert.equal(f.calls.clears,0);assert.equal(f.calls.enqueues,0);assert(f.draft.paused);
});

test('cold restart never opens a microphone and explicit recovery revalidates full original binding before saving',async t=>{
 const f=fixture(t);await f.session.begin(f.binding);f.complete('重启前的完整口述；末句不要丢。');const text=f.capture.text,bytes=fs.readFileSync(f.file);
 const restored=f.createDraft(),next=f.createVoice(restored);assert(restored.paused);assert.equal(next.active,false);assert(next.canRecover);assert.deepEqual(fs.readFileSync(f.file),bytes);
 assert.equal(f.calls.starts.length,1);const before=f.calls.revalidations.length;await next.recover();assert.equal(f.calls.revalidations.length,before+1);
 assert.deepEqual(f.calls.revalidations.at(-1),clone(f.binding));assert.equal(f.disk().text,text);assert.equal(f.disk().stage,'review');assert.equal(f.disk().input_source,'voice');
 assert.equal(restored.paused,true,'cold text copy retains unknown provenance and cannot resume business automatically');assert.equal(f.calls.starts.length,1);assert.equal(f.calls.enqueues,0);assert.equal(f.calls.clears,1);
});

test('cold recovery rejects another peer, account, deadline, original request closure and foreign full binding without deleting text',async t=>{
 const changes=[f=>f.setPeer('other-peer'),f=>f.setKey('other-account'),f=>f.setForeground(false),f=>f.setReleased(false),f=>f.advance(60000),
  f=>f.onRevalidate(()=>{throw Error('TASK_REQUEST_CLOSED');}),f=>{const token=JSON.parse(f.capture.binding);token.reply.request_revision++;f.setCapture({binding:JSON.stringify(token)});},
  f=>{const token=JSON.parse(f.capture.binding);token.reply.route.session_id='other-original-session';f.setCapture({binding:JSON.stringify(token)});}];
 for(const change of changes){const f=fixture(t);await f.session.begin(f.binding);f.complete();const bytes=fs.readFileSync(f.file);change(f);
  const restored=f.createDraft(),next=f.createVoice(restored);await assert.rejects(Promise.resolve().then(()=>next.recover()));assert.deepEqual(fs.readFileSync(f.file),bytes);
  assert.equal(f.calls.clears,0);assert.equal(f.calls.starts.length,1);assert.equal(f.calls.enqueues,0);assert(f.capture.text.trim());}
});

test('cold recovery cancellation while validating preserves both original consent and the full captured text',async t=>{
 const f=fixture(t);await f.session.begin(f.binding);f.complete();const bytes=fs.readFileSync(f.file),restored=f.createDraft(),next=f.createVoice(restored),gate=deferred();
 f.onRevalidate(()=>gate.promise);const work=next.recover();await turn();next.cancel();gate.resolve();await assert.rejects(work,/NOT_TRANSFERRED/);
 assert.deepEqual(fs.readFileSync(f.file),bytes);assert.equal(f.calls.clears,0);assert(f.capture.text);assert.equal(f.calls.enqueues,0);
});

test('owned incomplete capture may be discarded, while a valid or foreign capture remains protected',async t=>{
 const f=fixture(t);await f.session.begin(f.binding);f.setCapture({active:false,phase:'failed',valid:false,text:'不能提交的部分词'});f.session.observe();await drain();
 assert(f.session.canDiscardIncomplete);const bytes=fs.readFileSync(f.file);f.session.discardIncomplete();assert.equal(f.capture.text,'');assert.deepEqual(fs.readFileSync(f.file),bytes);assert.equal(f.calls.enqueues,0);
 const g=fixture(t);await g.session.begin(g.binding);g.complete();g.session.cancel();assert.throws(()=>g.session.discardIncomplete(),/DRAFT_PROTECTED/);assert(g.capture.text);
 const h=fixture(t);await h.session.begin(h.binding);h.setCapture({active:false,phase:'failed',valid:false,binding:'foreign-capture',text:'foreign'});h.session.observe();assert.equal(h.session.canDiscardIncomplete,false);assert.throws(()=>h.session.discardIncomplete(),/DRAFT_PROTECTED/);assert.equal(h.capture.text,'foreign');
});

test('cleanup remains explicit for owned uncertain exit and does not touch the original decision bytes',async t=>{
 const f=fixture(t);await f.session.begin(f.binding);const bytes=fs.readFileSync(f.file);f.setCapture({phase:'cleanup_pending',active:true});f.session.observe();
 assert(f.session.cleanupPending);await f.session.cleanup();assert.equal(f.calls.cleanups,1);assert.deepEqual(fs.readFileSync(f.file),bytes);assert(f.draft.paused);assert.equal(f.calls.enqueues,0);
 const g=fixture(t);g.setCapture({phase:'cleanup_pending',active:true,binding:'some-other-feature'});assert.equal(g.session.cleanupPending,false);await assert.rejects(Promise.resolve().then(()=>g.session.cleanup()),/NOT_ACTIVE/);assert.equal(g.calls.cleanups,0);
});
test('an old voice session cannot stop or pause a different valid attempt for the same original request',async t=>{
 const f=fixture(t);await f.session.begin(f.binding);const next=JSON.parse(f.capture.binding);next.attempt_id='voice-'+'b'.repeat(32);
 f.setCapture({binding:JSON.stringify(next),active:true,phase:'listening'});const bytes=fs.readFileSync(f.file);f.session.observe();await drain();
 assert.deepEqual(f.calls.stops,[]);assert.equal(f.draft.paused,false);assert.equal(f.capture.active,true);assert.deepEqual(fs.readFileSync(f.file),bytes);
});

test('real singleton service preserves withdrawn A voice text until explicit cleanup before B can replace its original binding',async t=>{
 async function wire(f){
  let random=0;const sent=[],timers=new Map();const probe={features:{state:{connected:true},displayActive:false},foreground:true,peerDeviceId:'synthetic-peer',
   agentCaptureOccupied:false,agentSuggestionOccupied:false,voice:{active:false},recordingOccupied:()=>false,lifelogOccupied:()=>false,prompterOccupied:()=>false,
   auth:{async sendBusiness(business,bytes){sent.push({business,bytes:Uint8Array.from(bytes)});}}};
  const capture={get active(){return f.capture.active;},get state(){const value=f.capture;return{...value,savedDraftValid:value.valid};},
   sourceOrigin:(token,text)=>f.sources.origin(token,text,f.capture),
   clearDraft:()=>f.ports.clear(),stop:cancelled=>f.ports.stop(cancelled),cleanup:()=>f.ports.cleanup(),start(){throw Error('unexpected microphone start');}};
  const taskService={decisionDraft:f.draft,summary:()=>({contextKey:f.binding.context_key}),validateReply:binding=>f.ports.validate(binding),
   revalidateReply:binding=>f.ports.revalidate(binding),voiceSources:f.sources,assertAnswer:answer=>f.sources.assertAnswer(answer),operationExists:()=>false,answerBound(){throw Error('unexpected answer enqueue');}};
  const mod=loadApp('TaskSuggestionService',{
   '@kit.CoreFileKit':{fileIo:f.io},'@kit.CryptoArchitectureKit':{cryptoFramework:{createRandom:()=>({generateRandomSync:n=>({data:new Uint8Array(n).fill(++random)})})}},
   './ProbeSession':{probeSession:probe},'./TaskService':{taskService},'./AgentCaptureService':{agentCapture:capture,agentCaptureView:{}},
   './TaskRecordingService':{taskRecordingCapture:{state:{binding:'',active:false}}},
   './NotificationService':{notifications:{busy:false,waiting:false},suggestionTests:{active:false}}
  },{setTimeout(fn,ms){const id=timers.size+1;timers.set(id,{fn,ms});return id;},clearTimeout(id){timers.delete(id);}});
  mod.initializeTaskSuggestions();return{mod,sent,probe};
 }
 const replacement=f=>({...clone(f.binding),operation_id:'replacement-operation',request_id:'replacement-question',task_id:'replacement-task'});
 for(const incomplete of [false,true]){
  const f=fixture(t);await f.session.begin(f.binding);const text=incomplete?'A 失败后仍需保留的部分词':'A 已取消但完整条件仍须由用户决定';f.complete(text);
  if(incomplete)f.setCapture({phase:'failed',valid:false});f.session.cancel();assert.equal(f.capture.active,false);
  const {mod,sent}=await wire(f);
  try{
   await mod.taskSuggestions.abandon();const bytes=fs.readFileSync(f.file),reads=f.calls.revalidations.length;
   assert.equal(f.disk().stage,'abandoned');assert.equal(mod.taskVoiceReplies.retainedText,text);assert.equal(f.disk().binding.request_id,f.binding.request_id);
   await assert.rejects(Promise.resolve().then(()=>mod.taskSuggestions.start(replacement(f),f.plan)),/GLASS_BUSY/);
   assert.equal(f.calls.revalidations.length,reads,'retained text blocks before networking');assert.equal(sent.length,0,'no replacement card is emitted before cleanup');
   assert.deepEqual(fs.readFileSync(f.file),bytes,'B cannot overwrite the binding needed to inspect and clear A');assert.equal(mod.taskVoiceReplies.retainedText,text);
   if(incomplete){assert(mod.taskVoiceReplies.canDiscardIncomplete);mod.taskVoiceReplies.discardIncomplete();}
   else{assert(mod.taskVoiceReplies.canDiscardRetained);mod.taskVoiceReplies.discardRetained();}
   assert.equal(f.capture.text,'');assert.deepEqual(fs.readFileSync(f.file),bytes,'explicit cleanup does not erase or replace the original decision');
   await mod.taskSuggestions.start(replacement(f),f.plan);assert.equal(f.disk().binding.request_id,'replacement-question');assert.equal(f.disk().stage,'proposal');
   assert.equal(sent.length,1);assert.equal(f.calls.enqueues,0);await mod.taskSuggestions.cleanup();
  }finally{mod.disposeTaskSuggestions();await drain();}
 }
 const f=fixture(t);await f.session.begin(f.binding);f.setCapture({active:false,phase:'failed',valid:false,text:''});f.session.cancel();const {mod,sent}=await wire(f);
 try{await mod.taskSuggestions.abandon();await mod.taskSuggestions.start(replacement(f),f.plan);assert.equal(f.disk().binding.request_id,'replacement-question');
  assert.equal(sent.length,1,'an inactive failed capture with no text does not falsely block the next card');await mod.taskSuggestions.cleanup();
 }finally{mod.disposeTaskSuggestions();await drain();}
});

test('fresh durable voice review raises one bound saved event only after the full capture copy is idle and empty',async t=>{
 const f=fixture(t),events=[],text='完整新价格条件，运费沿用上次；这是最后一句。';
 f.session.onDraftSaved=binding=>events.push({binding:clone(binding),record:f.disk(),capture:f.capture});
 await f.session.begin(f.binding);f.complete(text);f.session.observe();await drain();assert.equal(events.length,1);
 assert.deepEqual(events[0].binding,clone(f.binding));assert.equal(events[0].record.text,text);assert.equal(events[0].record.stage,'review');assert.equal(events[0].record.input_source,'voice');
 assert.deepEqual(events[0].capture,{active:false,phase:'idle',binding:'',text:'',valid:false,exitEvidence:'none',transcriptStatus:'none'});assert.equal(f.calls.enqueues,0);
 f.session.observe();f.session.changed();f.session.observe();await drain();assert.equal(events.length,1,'generic UI changes and repeated capture callbacks cannot redisplay or submit');
});
test('new singleton voice consent uses the mature-recording adapter and preserves the complete original-task draft',async t=>{
 const f=fixture(t),{TaskRecordingCapture}=loadApp('TaskRecordingCapture');let disk='',handle,result={state:'capturing',exitEvidence:'none',text:'',origin:null},recordingStarts=0,legacyStarts=0,registrations=0,random=0;
 const capture=new TaskRecordingCapture({load:()=>disk,save:value=>{disk=value;},peer:()=> 'synthetic-peer',epoch:()=>7,available:()=>true,
  async start(options){recordingStarts++;await options.guard();handle={ownerId:options.ownerId,cleanupId:'b'.repeat(32),uuid:'recording-task-original',directory:'/synthetic/recordings/take-'+ 'c'.repeat(32),peer:'synthetic-peer',connectionEpoch:0};options.reserved(handle);assert(options.current());return handle;},
  async stop(value){assert.deepEqual(value,handle);},read:value=>{assert.deepEqual(value,handle);return result;}});capture.initialize();
 const view={},probe={features:{state:{connected:true},displayActive:false},foreground:true,peerDeviceId:'synthetic-peer',agentCaptureOccupied:false,agentSuggestionOccupied:false,
  voice:{active:false},recordingOccupied:()=>false,lifelogOccupied:()=>false,prompterOccupied:()=>false,auth:{sendBusiness:async()=>{}}};
 const sources={assertAnswer:value=>f.sources.assertAnswer(value),registerRecording(binding,attempt,peer,epoch,text,origin){registrations++;assert.equal(origin.uuid,handle.uuid);assert.equal(origin.owner_id,attempt);return f.sources.register(binding,attempt,peer,epoch,text);}};
 const service={decisionDraft:f.draft,summary:()=>({contextKey:f.binding.context_key}),validateReply:value=>f.ports.validate(value),revalidateReply:value=>f.ports.revalidate(value),voiceSources:sources,
  assertAnswer:value=>f.sources.assertAnswer(value),operationExists:()=>false,answerBound(){assert.fail('recording completion must not submit an answer');}};
 const mod=loadApp('TaskSuggestionService',{'@kit.CoreFileKit':{fileIo:f.io},'@kit.CryptoArchitectureKit':{cryptoFramework:{createRandom:()=>({generateRandomSync:n=>({data:new Uint8Array(n).fill(++random)})})}},
  './ProbeSession':{probeSession:probe},'./TaskService':{taskService:service},'./TaskRecordingService':{taskRecordingCapture:capture},
  './AgentCaptureService':{agentCapture:{active:false,state:{binding:'',phase:'idle',text:''},start(){legacyStarts++;throw Error('old assistant capture must not start');}},agentCaptureView:view},
  './NotificationService':{notifications:{busy:false,waiting:false},suggestionTests:{active:false}}},{setTimeout:()=>1,clearTimeout(){}});
 mod.initializeTaskSuggestions();capture.changed=()=>view.replyChanged();
 try{
  await mod.taskVoiceReplies.begin(f.binding);assert.equal(recordingStarts,1);assert.equal(legacyStarts,0);
  const text='用新价格，但运费沿用上次。\n最后一句：只生成预览，不发送。';
  result={state:'complete',exitEvidence:'device_event',text,origin:{schema:1,name:'take-'+ 'c'.repeat(32),uuid:handle.uuid,owner_id:handle.ownerId,cleanup_id:handle.cleanupId,peer:handle.peer,
   raw_bytes:2400,raw_sha256:'d'.repeat(64),result_sha256:'e'.repeat(64),material_id:'mat-recording-'+ 'c'.repeat(32),material_revision:2,exit_evidence:'device_event'}};
  capture.tick();await drain();assert.equal(f.disk().stage,'review');assert.equal(f.disk().text,text);assert.deepEqual(f.disk().binding,clone(f.binding));assert.equal(f.disk().input_source,'voice');
  assert.equal(capture.state.phase,'idle');assert(registrations>=1);assert.equal(f.calls.enqueues,0);assert.equal(legacyStarts,0);
 }finally{mod.disposeTaskSuggestions();await drain();}
});

test('failed or incomplete capture-copy clearing never raises the fresh saved event or retries it implicitly',async t=>{
 for(const noOpClear of [false,true]){
  const f=fixture(t),events=[],originalClear=f.ports.clear;f.session.onDraftSaved=binding=>events.push(clone(binding));await f.session.begin(f.binding);f.complete();const text=f.capture.text;
  if(noOpClear)f.ports.clear=()=>{f.calls.clears++;};else f.onClear(()=>{throw Error('synthetic clear failure');});
  f.session.observe();await drain();assert.equal(f.disk().text,text);assert.equal(f.disk().stage,'review');assert.equal(f.capture.text,text);assert.equal(events.length,0);assert(f.session.canClearCopied);
  f.session.observe();await drain();assert.equal(events.length,0);f.onClear(undefined);f.ports.clear=originalClear;f.session.clearCopied();await drain();assert.equal(f.capture.text,'');assert.equal(events.length,0,'manual cleanup is not fresh recording consent');
 }
});

test('cold complete voice recovery preserves the full answer but does not raise a fresh saved event or open capture',async t=>{
 const f=fixture(t);await f.session.begin(f.binding);f.complete('重启前的完整条件；最后一句必须保留。');const text=f.capture.text,restored=f.createDraft(),next=f.createVoice(restored),events=[];
 next.onDraftSaved=binding=>events.push(clone(binding));assert(next.canRecover);await next.recover();assert.equal(f.disk().text,text);assert.equal(f.disk().stage,'review');
 assert.equal(events.length,0);assert.equal(f.calls.starts.length,1);assert.equal(f.calls.enqueues,0);next.observe();next.changed();await drain();assert.equal(events.length,0);
});

test('fresh complete transcript can await explicit user exit confirmation and then transfers its full answer once',async t=>{
 const f=fixture(t),events=[],text='用新价格，但运费沿用上次，先只生成预览。';f.session.onDraftSaved=binding=>events.push(clone(binding));
 await f.session.begin(f.binding);f.setCapture({active:true,phase:'cleanup_pending',text,valid:false,exitEvidence:'none',transcriptStatus:'complete'});
 const bytes=fs.readFileSync(f.file);f.session.observe();await drain();assert.equal(f.session.cleanupPending,true);assert.equal(f.draft.paused,false);assert.deepEqual(fs.readFileSync(f.file),bytes);assert.equal(events.length,0);assert.equal(f.calls.clears,0);
 f.setCapture({active:false,phase:'draft',valid:true,exitEvidence:'user_confirmation'});f.session.observe();await drain();
 assert.equal(f.disk().stage,'review');assert.equal(f.disk().text,text);assert.equal(f.disk().input_source,'voice');assert.equal(f.capture.text,'');assert.deepEqual(events,[clone(f.binding)]);assert.equal(f.calls.enqueues,0);
 f.session.observe();await drain();assert.equal(events.length,1);
});

test('a user-confirmed exit never upgrades partial, cancelled, legacy, missing or pending transcript status into a reply',async t=>{
 for(const status of ['partial','cancelled','legacy','pending','none',undefined]){
  const f=fixture(t);await f.session.begin(f.binding);f.complete('退出已确认，但这份文字不能冒认为完整。');f.setCapture({exitEvidence:'user_confirmation',transcriptStatus:status});
  const bytes=fs.readFileSync(f.file);f.session.observe();await drain();assert.deepEqual(fs.readFileSync(f.file),bytes);assert.equal(f.calls.clears,0);assert.equal(f.calls.enqueues,0);assert(f.capture.text);
  const next=f.createVoice(f.createDraft());assert.equal(next.canRecover,false);await assert.rejects(Promise.resolve().then(()=>next.recover()));assert.equal(next.canClearCopied,false);
 }
});

test('cold complete user-confirmed transcript requires explicit original-request validation and never auto-displays or opens a microphone',async t=>{
 const f=fixture(t);await f.session.begin(f.binding);f.complete('重启前已完整封口的全部条件，末句不能丢。');f.setCapture({exitEvidence:'user_confirmation'});
 const restored=f.createDraft(),next=f.createVoice(restored),events=[],text=f.capture.text,reads=f.calls.revalidations.length;next.onDraftSaved=binding=>events.push(clone(binding));
 assert.equal(next.canRecover,true);await drain();assert.equal(f.disk().stage,'voice_authorized');assert.equal(f.calls.revalidations.length,reads);assert.equal(f.calls.starts.length,1);
 await next.recover();assert.equal(f.disk().text,text);assert.equal(f.disk().stage,'review');assert.equal(f.calls.revalidations.length,reads+1);assert.equal(f.calls.starts.length,1);assert.equal(events.length,0);assert.equal(f.calls.enqueues,0);
});

test('fresh source-port failure retains capture text and source-reference disagreement cannot raise a saved event',async t=>{
 for(const change of ['issue_failure','second_reference_changed'])await t.test(change,async t=>{
  const f=fixture(t),events=[],source=f.ports.source;let calls=0;await f.session.begin(f.binding);f.complete('完整来源测试正文，最后一句不能丢。');const text=f.capture.text,before=fs.readFileSync(f.file);
  f.session.onDraftSaved=value=>events.push(clone(value));f.ports.source=(token,full,recover)=>{
   calls++;if(change==='issue_failure')throw Error('synthetic source port failed before draft copy');const result=source(token,full,recover);return calls===2?{...result,connection_epoch:'synthetic-changed-epoch'}:result;
  };
  f.session.observe();await drain();assert.equal(f.calls.clears,0);assert.equal(f.capture.text,text);assert.equal(events.length,0);assert.equal(f.calls.enqueues,0);assert.equal(f.draft.paused,true);
  if(change==='issue_failure'){assert.deepEqual(fs.readFileSync(f.file),before);assert.equal(f.disk().stage,'voice_authorized');}
  else{assert.equal(f.disk().stage,'review');assert.equal(f.disk().text,text);assert.equal(f.disk().schema,2);assert(f.disk().voice_source);}
 });
});

test('the controlled synthetic source port is retained after body clear while cold copies remain unknown and paused',async t=>{
 const f=fixture(t);await f.session.begin(f.binding);f.complete('转存后仍可比对的完整文本。');f.session.observe();await drain();const answer=f.taskRecordSubmission(f.draft.snapshot());
 assert.equal(answer.record_schema,2);assert.equal(answer.input_source,'voice');assert.equal(f.sources.state(answer.voice_source),'watching');assert.equal(f.capture.text,'');f.sources.assertAnswer(answer);assert.equal(f.sources.origins,2);
 f.sources.invalidate();assert.throws(()=>f.sources.assertAnswer(answer),/UNVERIFIED/);
 const g=fixture(t);await g.session.begin(g.binding);g.complete('只供冷恢复人工采用的完整文本。');const restored=g.createDraft(),next=g.createVoice(restored);await next.recover();const cold=g.taskRecordSubmission(restored.snapshot());
 assert.equal(restored.paused,true);assert.equal(g.sources.state(cold.voice_source),'unknown');assert.throws(()=>g.sources.assertAnswer(cold),/UNVERIFIED/);assert.equal(g.calls.microphoneWrites,1);assert.equal(g.calls.enqueues,0);
});
