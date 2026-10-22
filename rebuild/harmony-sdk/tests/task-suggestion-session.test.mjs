import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {loadApp} from './load-app.mjs';import {loadCore} from './load-core.mjs';import {setupMaterialStore} from './material-fixture.mjs';
const {businessEnvelope}=loadCore('./BusinessCommands'),{readLauncherEnvelope}=loadCore('./LauncherStatus');
const turn=()=>new Promise(setImmediate);
async function settled(s){for(let n=0;n<60&&s.busy;n++)await turn();assert.equal(s.busy,false,'bounded synthetic actions settled');}
function fixture(t){
 const f=setupMaterialStore(t),sent=[],answers=[],timers=new Map();let now=Date.now(),peer='peer',available=true,foreground=true,key='original-context',id=0,random=0,valid=true,handler,liveHandler,liveReads=0;
 class Clock extends Date{static now(){return now;}}
 const globals={Date:Clock,setTimeout(fn,ms){timers.set(++id,{fn,ms});return id;},clearTimeout(id){timers.delete(id);}};
 const platform={'@kit.CoreFileKit':{fileIo:f.io},'@kit.CryptoArchitectureKit':{cryptoFramework:{createRandom:()=>({generateRandomSync:n=>({data:new Uint8Array(n).fill(++random)})})}}};
 const model=loadApp('TaskReplyDraft',platform,globals),{TaskSuggestionSession}=loadApp('TaskSuggestionSession',platform,globals),draft=new model.TaskDecisionDraft(),binding=new model.TaskReplyBinding();draft.initialize(f.root);
 Object.assign(binding,{context_key:key,operation_id:'original-operation',request_id:'question-original',request_revision:1,task_id:'task-original',
  route:{computer_id:'pc',agent_id:'hermes',project_id:'project',session_id:'existing-session'},expires_at:new Date(now+3600000).toISOString(),question:'采用新价格吗？',mode:'free_text'});
 const ports={device:()=>peer,available:()=>available,foreground:()=>foreground,context:()=>key,async wait(){},
  validate(){if(!valid)throw Error('TASK_REQUEST_CLOSED');},async revalidate(b){liveReads++;if(liveHandler)await liveHandler(b);if(!valid)throw Error('TASK_REQUEST_CLOSED');},
  async send(b,bytes){const p=readLauncherEnvelope(bytes);const j=JSON.parse(new TextDecoder().decode(p.json));sent.push({b,type:p.type,j});if(handler)await handler(p.type,j);},
  enqueue(answer){answers.push(JSON.parse(JSON.stringify(answer)));draft.queued(answer.binding.operation_id);return'awaiting_refresh';}};
 const s=new TaskSuggestionSession(draft,ports),plan=new model.TaskDecisionPlan();
 const receive=(cmd,uid=draft.snapshot()?.cleanup_uid,type=34,from=peer)=>s.receive(from,businessEnvelope(type,new TextEncoder().encode(JSON.stringify({suggestUID:uid,suggestType:2,cmd}))));
 return{...f,...model,s,draft,binding,plan,ports,sent,answers,timers,platform,globals,receive,settle:()=>settled(s),
  create:()=>{const d=new model.TaskDecisionDraft();d.initialize(f.root);return new TaskSuggestionSession(d,ports);},get reads(){return liveReads;},advance:n=>now+=n,
  setPeer:v=>peer=v,setAvailable:v=>available=v,setForeground:v=>foreground=v,setKey:v=>key=v,close:()=>valid=false,onSend:fn=>handler=fn,onLive:fn=>liveHandler=fn};
}
test('actual type33/34 adapter stages first rejection locally; type4, old UID and conflicting repeats never answer',async t=>{
 const f=fixture(t);await f.s.start(f.binding,f.plan);const first=f.draft.snapshot().cleanup_uid;
 f.receive(2,first,4);f.receive(1,first,34,'other');await turn();assert.equal(f.sent.length,1);assert.equal(f.draft.snapshot().stage,'proposal');
 f.receive(2);f.receive(1,first);await f.settle();assert.equal(f.draft.snapshot().stage,'supplement_offer');assert.equal(f.answers.length,0);
 assert.deepEqual(f.sent.map(x=>[x.b,x.type,x.j.type]),[[21,33,1],[21,35,undefined],[21,33,2],[21,33,1]]);assert.notEqual(f.draft.snapshot().cleanup_uid,first);
 const ack=f.sent.find(x=>x.type===35);assert.deepEqual(ack.j,{suggestUID:first,suggestType:2,code:0});
 f.receive(1,first);await turn();assert.equal(f.draft.snapshot().stage,'supplement_offer');assert.equal(f.sent.filter(x=>x.type===35).length,1,'old UID never acknowledges a different step');
 f.s.pause();await f.settle();
});
test('second rejection retains original task and requires explicit complete-answer submission',async t=>{
 const f=fixture(t);await f.s.start(f.binding,f.plan);f.receive(2);await f.settle();f.receive(2);await f.settle();
 assert.equal(f.draft.snapshot().stage,'review');assert.equal(f.answers.length,0);assert.equal(f.draft.snapshot().text,'未采用当前方案');
 await f.s.submit();assert.equal(f.answers.length,1);assert.equal(f.answers[0].binding.task_id,'task-original');assert.equal(f.answers[0].input_source,'glasses_semantic');
 assert.equal(f.draft.snapshot().stage,'queued');assert(f.sent.every(x=>x.b===21),'no microphone or task cancellation reachable');
});

test('local recovery suspension invalidates old card callbacks while retaining the cleanup lease and sending nothing',async t=>{
 const f=fixture(t);await f.s.start(f.binding,f.plan);const uid=f.draft.snapshot().cleanup_uid,oldTimer=[...f.timers.values()][0].fn;
 let pauses=0,voices=0;f.s.onPause=()=>pauses++;f.s.onVoiceAuthorized=()=>voices++;
 const original=fs.readFileSync(f.root+'/task-decision-draft.json');f.s.suspendForRecovery();
 assert(f.draft.paused);assert.equal(f.timers.size,0);assert.equal(f.draft.snapshot().cleanup_uid,uid);
 f.receive(1,uid);oldTimer();await f.settle();await turn();
 assert.equal(f.sent.length,1,'suspending does not acknowledge, remove, or create another card');
 assert.equal(f.answers.length,0);assert.equal(pauses,0,'recovery must not invoke the normal pause audio/cleanup path');assert.equal(voices,0);
 assert.deepEqual(fs.readFileSync(f.root+'/task-decision-draft.json'),original,'old callbacks cannot rewrite preserved evidence');
});
test('native receipt follows durable draft; next card waits for feedback and old-view removal before taking its own deadline',async t=>{
 const f=fixture(t);await f.s.start(f.binding,f.plan);const first=f.draft.snapshot().cleanup_uid;let release;const waits=[];
 f.ports.wait=ms=>{waits.push(ms);return new Promise(r=>release=r);};
 f.onSend((type,j)=>{if(type===35){const disk=JSON.parse(fs.readFileSync(f.root+'/task-decision-draft.json','utf8'));
  assert.equal(disk.stage,'supplement_offer');assert.equal(disk.cleanup_uid,first);assert.equal(j.suggestUID,first);assert.equal(f.answers.length,0);}});
 f.receive(2);while(!release)await turn();assert.deepEqual(waits,[2500]);assert.deepEqual(f.sent.map(x=>x.type),[33,35]);
 assert.equal(f.s.active,true);assert.equal(f.timers.size,0,'old card timer cannot erase the next view');
 f.advance(2500);const feedbackDone=release;release=undefined;feedbackDone();while(!release)await turn();
 assert.deepEqual(waits,[2500,300]);assert.deepEqual(f.sent.map(x=>[x.type,x.j.type]),[[33,1],[35,undefined],[33,2]]);
 f.advance(300);release();await f.settle();assert.notEqual(f.draft.snapshot().cleanup_uid,first);assert.equal([...f.timers.values()][0].ms,120000);
 assert.equal(f.answers.length,0);f.s.pause();await f.settle();
});
test('pause during native feedback prevents next card and preserves only the original unanswered draft',async t=>{
 const f=fixture(t);await f.s.start(f.binding,f.plan);let release;f.ports.wait=()=>new Promise(r=>release=r);
 f.receive(2);while(!release)await turn();f.s.pause();release();await f.settle();
 assert.equal(f.sent.filter(x=>x.type===33&&x.j.type===1).length,1);assert.equal(f.sent.filter(x=>x.type===35).length,1);
 assert.equal(f.draft.snapshot().cleanup_uid,'');assert.equal(f.draft.snapshot().stage,'supplement_offer');assert(f.draft.paused);assert.equal(f.answers.length,0);
});
test('uncertain receipt retains saved step and old UID cleanup; a repeated device event cannot send it twice',async t=>{
 const f=fixture(t);await f.s.start(f.binding,f.plan);const uid=f.draft.snapshot().cleanup_uid;
 f.onSend(type=>{if(type===35)throw Error('synthetic uncertain receipt');});f.receive(2);await f.settle();
 assert.equal(f.draft.snapshot().stage,'supplement_offer');assert.equal(f.draft.snapshot().cleanup_uid,uid);assert.equal(f.s.active,true);
 f.receive(2,uid);await f.settle();assert.equal(f.sent.filter(x=>x.type===35).length,1);assert.equal(f.sent.filter(x=>x.j.type===1).length,1);assert.equal(f.answers.length,0);
 f.onSend(undefined);await f.s.cleanup();assert.equal(f.draft.snapshot().cleanup_uid,'');assert(f.draft.paused);
});
test('second acceptance only authorizes a draft; restart/resume asks again instead of reopening a microphone',async t=>{
 const f=fixture(t);await f.s.start(f.binding,f.plan);f.receive(2);await f.settle();f.receive(1);await f.settle();assert.equal(f.draft.snapshot().stage,'voice_authorized');assert.equal(f.s.active,false);
 const bytes=fs.readFileSync(f.root+'/task-decision-draft.json');const restored=f.create();assert(restored.draft.paused);assert.deepEqual(fs.readFileSync(f.root+'/task-decision-draft.json'),bytes);
 await restored.resume();assert.equal(restored.draft.snapshot().stage,'supplement_offer');assert.equal(f.answers.length,0);assert(f.sent.every(x=>x.b===21));restored.pause();await settled(restored);
});
test('duplicate second-card events hand off exactly once after the entire card lease is released',async t=>{
 const f=fixture(t);let handoffs=0,occupied=false;
 f.s.changed=()=>{occupied=f.s.active;};
 f.s.onVoiceAuthorized=b=>{handoffs++;assert.equal(occupied,false);assert.equal(f.s.busy,false);assert.equal(f.s.active,false);
  assert.equal(b.operation_id,f.binding.operation_id);assert.equal(f.draft.snapshot().stage,'voice_authorized');assert.equal(f.draft.snapshot().cleanup_uid,'');};
 await f.s.start(f.binding,f.plan);f.receive(2);await f.settle();assert.equal(handoffs,0);
 const uid=f.draft.snapshot().cleanup_uid;f.receive(1,uid);f.receive(1,uid);f.receive(2,uid);await f.settle();
 assert.equal(handoffs,1);assert.equal(f.sent.filter(x=>x.type===35).length,2);assert.equal(f.answers.length,0);
 f.receive(1,uid);await turn();assert.equal(handoffs,1);
});
test('pausing during the second-card native feedback revokes a pending voice handoff',async t=>{
 const f=fixture(t);await f.s.start(f.binding,f.plan);f.receive(2);await f.settle();let release,handoffs=0;
 f.s.onVoiceAuthorized=()=>handoffs++;f.ports.wait=()=>new Promise(r=>release=r);
 f.receive(1);while(!release)await turn();f.s.pause();release();await f.settle();
 assert.equal(handoffs,0);assert.equal(f.draft.snapshot().stage,'voice_authorized');assert(f.draft.paused);assert.equal(f.answers.length,0);
});
test('a short original request caps the card window without changing the original deadline',async t=>{
 const f=fixture(t);f.binding.expires_at=new Date(Date.parse(f.binding.expires_at)-3600000+45000).toISOString();
 const expires=f.binding.expires_at;await f.s.start(f.binding,f.plan);assert.equal([...f.timers.values()][0].ms,45000);
 f.advance(45000);[...f.timers.values()][0].fn();await f.settle();
 assert(f.draft.paused);assert.equal(f.draft.snapshot().binding.expires_at,expires);assert.equal(f.answers.length,0);
});
test('early device operation is serialized behind its send; pause fences queued operation and removes only original UID',async t=>{
 const f=fixture(t);let release;f.onSend(async(type,j)=>{if(type===33&&j.type===1){f.receive(2);await new Promise(r=>release=r);}});
 const send=f.s.start(f.binding,f.plan);while(!release)await turn();f.s.pause();release();await assert.rejects(send,/PROFILE_CHANGED/);await f.settle();
 assert.equal(f.sent.filter(x=>x.j.type===1).length,1);assert.equal(f.sent.filter(x=>x.j.type===2).length,1);assert.equal(f.draft.snapshot().stage,'proposal');assert(f.draft.paused);assert.equal(f.answers.length,0);
});
test('uncertain remove preserves durable cleanup and blocks replacement; only original peer can clean',async t=>{
 const f=fixture(t);await f.s.start(f.binding,f.plan);const uid=f.draft.snapshot().cleanup_uid;f.onSend((type,j)=>{if(j.type===2)throw Error('synthetic uncertain write');});
 await assert.rejects(f.s.cleanup());assert.equal(f.draft.snapshot().cleanup_uid,uid);assert.equal(f.s.active,true);
 f.setPeer('another');await assert.rejects(f.s.cleanup(),/PEER_CHANGED/);assert.equal(f.draft.snapshot().cleanup_uid,uid);f.setPeer('peer');f.onSend(undefined);await f.s.cleanup();assert.equal(f.draft.snapshot().cleanup_uid,'');
});
test('card timeout removes display intent and never means reject or task cancellation',async t=>{
 const f=fixture(t);await f.s.start(f.binding,f.plan);const timer=[...f.timers.values()][0];assert.equal(timer.ms,120000);f.advance(120000);timer.fn();await f.settle();
 assert(f.draft.paused);assert.equal(f.draft.snapshot().stage,'proposal');assert.equal(f.answers.length,0);assert.equal(f.draft.snapshot().cleanup_uid,'');
});
test('phone first answer or task withdrawal invalidates the card before delayed device input can progress it',async t=>{
 const f=fixture(t);await f.s.start(f.binding,f.plan);f.close();f.s.stateChanged();f.receive(1);await f.settle();assert(f.draft.paused);assert.equal(f.draft.snapshot().stage,'proposal');assert.equal(f.answers.length,0);
});
test('identity switch during refresh cannot arm or publish a card; occupied capture prevents even a refresh or journal',async t=>{
 const f=fixture(t);let release;f.onLive(()=>new Promise(r=>release=r));const work=f.s.start(f.binding,f.plan);while(!release)await turn();f.setKey('other-account');release();await assert.rejects(work,/PROFILE_CHANGED/);assert.equal(f.sent.length,0);assert.equal(f.draft.snapshot(),undefined);
 const g=fixture(t);g.setAvailable(false);assert.throws(()=>g.s.start(g.binding,g.plan),/GLASS_BUSY/);assert.equal(g.reads,0);assert.equal(fs.existsSync(g.root+'/task-decision-draft.json'),false);
});
test('question/title/option overflow never truncates decision text or emits a packet',async t=>{
 const f=fixture(t);f.binding.question='完整后果'.repeat(30);assert.throws(()=>f.s.start(f.binding,f.plan),/COPY_TOO_LONG/);assert.equal(f.sent.length,0);assert.equal(f.draft.snapshot(),undefined);
});
test('real singleton wiring rejects existing capture cleanup before networking and shares card occupancy with the probe',async t=>{
 const f=fixture(t),probe={features:{state:{connected:true},displayActive:false},foreground:true,peerDeviceId:'peer',voice:{active:false},agentCaptureOccupied:true,
  recordingOccupied:()=>false,lifelogOccupied:()=>false,prompterOccupied:()=>false};let reads=0;
 const taskService={decisionDraft:f.draft,summary:()=>({contextKey:f.binding.context_key}),validateReply(){},async revalidateReply(){reads++;},answerBound(){throw Error('must not enqueue');}};
 const diagnostic={active:false};const mod=loadApp('TaskSuggestionService',{
  ...f.platform,'./ProbeSession':{probeSession:probe},'./TaskService':{taskService},
  './AgentCaptureService':{agentCapture:{active:false,state:{phase:'idle',binding:'',text:'',savedDraftValid:false,exitEvidence:'none'}},agentCaptureView:{}},
  './NotificationService':{notifications:{busy:false,waiting:false},suggestionTests:diagnostic}
 },f.globals);mod.initializeTaskSuggestions();assert.throws(()=>mod.taskSuggestions.start(f.binding,f.plan),/GLASS_BUSY/);assert.equal(reads,0);assert.equal(f.draft.snapshot(),undefined);
  probe.agentCaptureOccupied=false;probe.features.launcherBusy=true;assert.throws(()=>mod.taskSuggestions.start(f.binding,f.plan),/GLASS_BUSY/);
  assert.equal(reads,0);assert.equal(f.draft.snapshot(),undefined);probe.features.launcherBusy=false;
  probe.auth={async sendBusiness(){}};await mod.taskSuggestions.start(f.binding,f.plan);assert.equal(probe.agentSuggestionOccupied,true);
 await mod.taskSuggestions.cleanup();assert.equal(probe.agentSuggestionOccupied,false);
 diagnostic.active=true;diagnostic.onOccupancyChanged();assert.equal(probe.agentSuggestionOccupied,true);mod.taskSuggestions.pause();await settled(mod.taskSuggestions);
 assert.equal(probe.agentSuggestionOccupied,true,'task pause cannot erase a diagnostic card lease');diagnostic.active=false;diagnostic.onOccupancyChanged();assert.equal(probe.agentSuggestionOccupied,false);
 mod.disposeTaskSuggestions();await settled(mod.taskSuggestions);
});
test('real service releases the task card lease before starting its one bound capture attempt',async t=>{
 const f=fixture(t);let starts=0;const probe={features:{state:{connected:true},displayActive:false},foreground:true,peerDeviceId:'peer',voice:{active:false},agentCaptureOccupied:false,
  recordingOccupied:()=>false,lifelogOccupied:()=>false,prompterOccupied:()=>false,auth:{async sendBusiness(){}}};
 const capture={active:false,state:{phase:'idle',binding:'',text:'',savedDraftValid:false,exitEvidence:'none'},async start(token,seconds,guard){
  starts++;assert.equal(seconds,15);assert.equal(probe.agentSuggestionOccupied,false,'real singleton card lease is released before capture');
  assert.equal(JSON.parse(token).reply.operation_id,f.binding.operation_id);this.active=true;this.state.binding=token;this.state.phase='preparing';
  probe.agentCaptureOccupied=true;await guard();this.state.phase='listening';},async stop(){this.active=false;this.state.phase='failed';probe.agentCaptureOccupied=false;}};
 const taskService={decisionDraft:f.draft,summary:()=>({contextKey:f.binding.context_key}),validateReply(){},async revalidateReply(){},answerBound(){assert.fail('capture never submits an answer');}};
 const mod=loadApp('TaskSuggestionService',{...f.platform,'./ProbeSession':{probeSession:probe},'./TaskService':{taskService},
  './AgentCaptureService':{agentCapture:capture,agentCaptureView:{}},'./NotificationService':{notifications:{busy:false,waiting:false},suggestionTests:{active:false}}},
  {...f.globals,setTimeout(fn,ms){if(ms===2500||ms===300){Promise.resolve().then(fn);return -1;}return f.globals.setTimeout(fn,ms);}});
 mod.initializeTaskSuggestions();const receive=cmd=>mod.taskSuggestions.receive('peer',businessEnvelope(34,new TextEncoder().encode(JSON.stringify({suggestUID:f.draft.snapshot().cleanup_uid,suggestType:2,cmd}))));
 await mod.taskSuggestions.start(f.binding,f.plan);receive(2);await settled(mod.taskSuggestions);receive(1);receive(1);receive(2);await settled(mod.taskSuggestions);await turn();
 assert.equal(starts,1);assert.equal(capture.state.phase,'listening');assert.equal(mod.taskVoiceReplies.active,true);assert.equal(f.draft.paused,false);assert.equal(f.draft.snapshot().stage,'voice_authorized');
 mod.disposeTaskSuggestions();await settled(mod.taskSuggestions);assert.equal(capture.active,false);
});
test('local withdrawal keeps original task; sealed failure retries same full answer and cannot become an edited operation',async t=>{
 const f=fixture(t);await f.s.start(f.binding,f.plan);f.receive(1);await f.settle();let first=true;
 const original=f.ports.enqueue;f.ports.enqueue=a=>{if(first){first=false;throw Error('synthetic persist failure');}return original(a);};
 await assert.rejects(f.s.submit());assert.equal(f.draft.snapshot().stage,'sealed');const frozen=fs.readFileSync(f.root+'/task-decision-draft.json');
 await assert.rejects(f.s.abandon());assert.deepEqual(fs.readFileSync(f.root+'/task-decision-draft.json'),frozen);await f.s.submit();assert.equal(f.answers.length,1);assert.equal(f.answers[0].text,'采用当前方案');
 const g=fixture(t);await g.s.start(g.binding,g.plan);await g.s.abandon();assert.equal(g.draft.snapshot().stage,'abandoned');assert.equal(g.answers.length,0);assert.equal(g.draft.snapshot().binding.task_id,'task-original');
});
