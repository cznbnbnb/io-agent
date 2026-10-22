import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';
import {loadApp} from './load-app.mjs';import {setupMaterialStore} from './material-fixture.mjs';
const route={computer_id:'pc',agent_id:'hermes',project_id:'project',session_id:'existing-session'};
const scopes=['tasks:read','tasks:write','tasks:update','requests:read','answers:write','messages:receive'];
function fixture(t){
  const f=setupMaterialStore(t),calls=[],timers=new Map();let now=Date.now(),timerId=0,seq=0;
  const principal={ownerId:'owner',producerId:'phone',serverId:'server'};
  const config={schema:1,enabled:true,target:{baseUrl:'https://synthetic.invalid/v1',token:'a'.repeat(43),principal},route};
  const response=(body,status=200)=>({responseCode:status,result:JSON.stringify(body),header:{'content-type':'application/json'}});
  const identity=()=>({schema_version:'1.0',owner_id:'owner',producer_id:'phone',server_id:'server',scopes,expires_at:new Date(now+86400000).toISOString()});
  const wire=loadApp('TaskWire'),page=items=>({items,has_more:false,next_cursor:'cursor-'+now,server_time:new Date(now).toISOString(),fresh_until:new Date(now).toISOString()});
  const ack=e=>({schema_version:'1.0',event_id:e.event_id,kind:e.kind,object_id:wire.taskObjectId(e.kind,e.body),revision:wire.taskBodyRevision(e.kind,e.body),commit_seq:++seq,stored_at:new Date(now).toISOString(),
    receipt:{receipt_id:'receipt-'+seq,subject_kind:e.kind,subject_id:wire.taskObjectId(e.kind,e.body),subject_revision:wire.taskBodyRevision(e.kind,e.body),stage:'server_stored',actor_id:'server-storage',related_event_id:e.event_id,error:null}});
  let handler=async(url,o)=>response(url.endsWith('/identity')?identity():url.includes('/inbox?')?page([]):ack(JSON.parse(o.extraData)),o.extraData?201:200);
  class Clock extends Date{static now(){return now;}}
  const globals={Date:Clock,setTimeout(fn,delay){const id=++timerId;timers.set(id,{fn,delay});return id;},clearTimeout(id){timers.delete(id);}};
  const platform={'@kit.CoreFileKit':{fileIo:f.io},'@kit.AssetStoreKit':{asset:{}},'@kit.NetworkKit':{http:{RequestMethod:{GET:'GET',POST:'POST'},HttpDataType:{STRING:1},
    createHttp(){return{destroy(){},async request(url,o){calls.push({url,o});return handler(url,o);}};}}}};
  const {TaskCoordinator}=loadApp('TaskCoordinator',platform,globals),{TaskMailbox}=loadApp('TaskMailbox',platform,globals),coordinators=[];
  const create=()=>{const c=new TaskCoordinator(f.root);coordinators.push(c);return c;};t.after(async()=>{for(const c of coordinators)await c.stop();});
  const oldMailbox=()=>{const m=new TaskMailbox();m.initialize(f.root,principal);return m;};
  return {...f,config,principal,create,oldMailbox,response,identity,ack,page,calls,timers,globals,platform,get now(){return now;},advance(ms){now+=ms;},setHandler(h){handler=h;}};
}
const turn=()=>new Promise(setImmediate);

test('recovery finds an old persisted operation outside the recent UI window without network or a new answer',async t=>{
 const f=fixture(t),c=f.create();assert.throws(()=>c.operationExists('unknown'),/UNAVAILABLE/);
 await c.configure(f.config);const key=c.summary().contextKey;
 c.delegate(key,'old-recovery-operation','需要对账的旧记录',60000);c.withdraw(key,'old-recovery-operation');
 for(let i=0;i<24;i++)c.delegate(key,'recent-operation-'+i,'近期合成委托 '+i,60000);
 assert.equal(c.sends().length,20);assert(!c.sends().some(row=>row.operationId==='old-recovery-operation'));
 assert.equal(c.operationExists('old-recovery-operation'),true);assert.equal(c.operationExists('unknown'),false);
 const next=f.create();await next.configure(f.config);assert.equal(next.operationExists('old-recovery-operation'),true);
 assert.equal(f.calls.length,0);assert.equal(f.oldMailbox().pending().length,25,'lookup never allocates or replays an answer');
});

test('default disabled and background lifecycle never creates a mailbox or sends HTTP',async t=>{
  const f=fixture(t),c=f.create();c.setForeground(true);await c.tick();assert.equal(f.calls.length,0);assert(!fs.existsSync(path.join(f.root,'task-mailbox')));
  c.setForeground(false);await c.configure(f.config);c.delegate(c.summary().contextKey,'offline-tap','合成委托',60000);await c.tick();assert.equal(f.calls.length,0);
  assert.equal(c.summary().queued,1);c.setForeground(true);await c.tick();assert.equal(c.summary().stored,1);assert(f.calls.some(v=>v.o.extraData));
  assert(f.timers.size<=1);assert([...f.timers.values()].every(v=>v.delay>=1000));
});

test('network flight cannot block local save; undispatched withdrawal survives restart without replay',async t=>{
  const f=fixture(t),c=f.create();await c.configure(f.config);c.setForeground(true);const key=c.summary().contextKey;
  c.delegate(key,'first','第一条合成委托',60000);let release;
  f.setHandler(async(url,o)=>url.endsWith('/identity')?f.response(f.identity()):o.extraData?new Promise(r=>release=()=>r(f.response(f.ack(JSON.parse(o.extraData)),201))):f.response(f.page([])));
  const work=c.tick();while(!release)await turn();assert.equal(c.summary().busy,true);
  c.delegate(key,'second','网络中仍可保存',60000);c.withdraw(key,'second');assert.throws(()=>c.withdraw(key,'first'),/TASK_WITHDRAW_UNCERTAIN/);
  release();await work;assert.equal(f.calls.filter(v=>v.o.extraData).length,1);assert.equal(c.summary().withdrawn,1);
  await c.stop();const next=f.create();await next.configure(f.config);next.setForeground(true);await next.tick();
  assert.equal(next.summary().withdrawn,1);assert.equal(f.calls.filter(v=>v.o.extraData).length,1);
});

test('account replacement cancels late POST, drains old writer and refuses the stale screen key',async t=>{
  const f=fixture(t),c=f.create();await c.configure(f.config);c.setForeground(true);const key=c.summary().contextKey;c.delegate(key,'old','旧账号合成委托',60000);
  let release;f.setHandler(async(url,o)=>url.endsWith('/identity')?f.response(f.identity()):new Promise(r=>release=()=>r(f.response(f.ack(JSON.parse(o.extraData)),201))));
  const work=c.tick();while(!release)await turn();const replacement=c.configure({...f.config,target:{...f.config.target,principal:{...f.principal,ownerId:'other-owner'}}});
  await turn();assert.equal(c.summary().configuring,true);release();await work;await replacement;
  assert.equal(c.summary().queued,0);assert.throws(()=>c.delegate(key,'stale','禁止错投',60000),/TASK_PROFILE_CHANGED/);
  const old=f.oldMailbox().pending();assert.equal(old.length,1);assert.equal(old[0].needs_lookup,true);assert.equal(old[0].ack,null);
});

test('configuration cancels and drains a user operation without leaving the coordinator stuck',async t=>{
  const f=fixture(t),c=f.create();await c.configure(f.config);c.setForeground(true);let release;
  f.setHandler(async(url)=>url.endsWith('/identity')?f.response(f.identity()):new Promise(r=>release=r));
  const work=c.cancelTask(c.summary().contextKey,'cancel-op','task1',1);
  while(!release)await turn();const replacement=c.configure(undefined);
  release(f.response({schema_version:'1.0',error:{code:'TASK_NOT_FOUND'}},404));await work;await replacement;
  assert.equal(c.summary().configuring,false);assert.equal(c.summary().enabled,false);assert.equal(c.summary().contextKey,'');
});

test('periodic detail discovers accepted answer with no new request revision in inbox',async t=>{
  const f=fixture(t),c=f.create();await c.configure(f.config);c.setForeground(true);
  const task={schema_version:'1.0',kind:'task',object_id:'task1',revision:1,commit_seq:1,stored_at:new Date(f.now).toISOString(),event_id:'task-event',expires_at:new Date(f.now+3600000).toISOString(),state:'queued',
    body:{task_id:'task1',revision:1,route,state:'queued',command:'合成任务',allow_create_session:false},receipts:[]};
  const request={...task,kind:'request',object_id:'q1',commit_seq:2,event_id:'question-event',state:'pending',body:{request_id:'q1',revision:1,task_id:'task1',route,mode:'free_text',question:'合成问题',options:[],state:'pending',runtime_request_id:'native-question'}};
  let first=true,answered=false;
  const answer={...task,kind:'answer',object_id:'answer1',commit_seq:3,event_id:'answer-event',state:'recorded',body:{answer_id:'answer1',request_id:'q1',request_revision:1,task_id:'task1',route,option_id:null,text:'只生成预览',input_source:'phone',raw_action:null}};
  f.setHandler(async(url)=>f.response(url.endsWith('/identity')?f.identity():url.includes('/inbox?')?(first?(first=false,f.page([task,request])):f.page([])):
    url.includes('/tasks/')?task:answered?{...request,state:'answered',answer}:request));
  await c.tick();assert.equal(c.objects().find(e=>e.item.kind==='request').item.state,'pending');answered=true;f.advance(15001);await c.tick();
  const q=c.objects().find(e=>e.item.kind==='request').item;assert.equal(q.revision,1);assert.equal(q.state,'answered');assert.equal(q.answer.body.text,'只生成预览');
  assert.equal(c.objects().find(e=>e.item.kind==='task').item.state,'queued','accepted answer is not task completion');
});

test('explicit disable preserves bound records while refusing sending and new actions',async t=>{
  const f=fixture(t),c=f.create();await c.configure(f.config);const key=c.summary().contextKey;c.delegate(key,'local','合成保留',60000);
  await c.configure({...f.config,enabled:false});c.setForeground(true);await c.tick();assert.equal(c.summary().queued,1);assert.equal(f.calls.length,0);
  assert.throws(()=>c.delegate(c.summary().contextKey,'more','拒绝提交',60000),/TASK_PROFILE_CHANGED/);
});

test('a recreated runtime cannot accept another account screen key even when generation counters coincide',async t=>{
  const f=fixture(t),c=f.create();await c.configure(f.config);const key=c.summary().contextKey;await c.stop();
  const next=f.create();await next.configure({...f.config,target:{...f.config.target,principal:{...f.principal,ownerId:'other-owner'}}});
  assert.notEqual(next.summary().contextKey,key);assert.throws(()=>next.delegate(key,'wrong','拒绝错投',60000),/TASK_PROFILE_CHANGED/);
});

async function boundQuestion(f,c){
 const task={schema_version:'1.0',kind:'task',object_id:'original-task',revision:1,commit_seq:1,stored_at:new Date(f.now).toISOString(),event_id:'task-original-event',expires_at:new Date(f.now+3600000).toISOString(),state:'waiting_answer',
  body:{task_id:'original-task',revision:1,route,state:'waiting_answer',command:'只生成报价预览',allow_create_session:false},receipts:[]};
 const request={...task,kind:'request',object_id:'original-question',commit_seq:2,event_id:'request-original-event',state:'pending',body:{request_id:'original-question',revision:1,task_id:'original-task',route,mode:'free_text',question:'采用新价格吗？',options:[],state:'pending',runtime_request_id:'original-native-wait'}};
 f.setHandler(async(url,o)=>f.response(url.endsWith('/identity')?f.identity():url.includes('/inbox?')?f.page([task,request]):url.includes('/requests/')?request:url.includes('/tasks/')&&!o.extraData?task:f.ack(JSON.parse(o.extraData)),o.extraData?201:200));
 await c.tick();return{task,request};
}
test('bound answers reuse one operation, preserve voice conditions and stay on the original route through the real transport',async t=>{
 const f=fixture(t),c=f.create();await c.configure(f.config);c.setForeground(true);await boundQuestion(f,c);
 // This transport/routing fixture explicitly allows synthetic voice; the
 // capture/source proof is exercised separately and is not asserted here.
 c.beforeAnswerSend=()=>{};
 const binding=c.bindReply(c.summary().contextKey,'stable-reply-1','original-question',1),text='用新价格，但运费沿用上次';
 assert.equal(c.answerBound(binding,null,text,'voice'),'awaiting_refresh');const frozen=f.oldMailbox().pending()[0].payload;
 assert.equal(c.answerBound(binding,null,text,'voice'),'awaiting_refresh');assert.equal(c.sends().length,1);
 assert.throws(()=>c.answerBound(binding,null,'改变已经固定的字节','voice'),/OPERATION_CONFLICT/);
 await c.tick();const posted=f.calls.filter(row=>row.url.endsWith('/answers'));assert.equal(posted.length,1);assert.equal(posted[0].o.extraData,frozen);
 const event=JSON.parse(frozen);assert.equal(event.body.input_source,'voice');assert.equal(event.body.raw_action,null);assert.equal(event.body.text,text);assert.deepEqual(event.body.route,route);
 assert.equal(c.answerBound(binding,null,text,'voice'),'server_stored');await c.tick();assert.equal(f.calls.filter(row=>row.url.endsWith('/answers')).length,1);
});
test('coordinator default source gate blocks voice before POST and cold restoration does not silently retry it',async t=>{
 const f=fixture(t),c=f.create();await c.configure(f.config);c.setForeground(true);await boundQuestion(f,c);
 const binding=c.bindReply(c.summary().contextKey,'unverified-voice','original-question',1);c.answerBound(binding,null,'完整文字保留但来源未证实','voice');
 const payload=f.oldMailbox().pending()[0].payload;await c.tick();assert.equal(c.summary().blocked,1);assert.equal(c.summary().stored,0);
 assert.equal(f.calls.filter(call=>call.o.method==='POST').length,0);assert.equal(c.sends()[0].error,'TASK_VOICE_SOURCE_UNVERIFIED');
 await c.stop();const restored=f.create();await restored.configure(f.config);restored.setForeground(true);await restored.tick();
 assert.equal(restored.summary().blocked,1);assert.equal(f.oldMailbox().pending()[0].payload,payload);assert.equal(f.calls.filter(call=>call.o.method==='POST').length,0);
});
test('coordinator invokes the current guard after awaited parent detail and preserves a source rejected at that boundary',async t=>{
 const f=fixture(t),c=f.create();await c.configure(f.config);c.setForeground(true);const {task,request}=await boundQuestion(f,c);
 const binding=c.bindReply(c.summary().contextKey,'late-invalidated-voice','original-question',1);c.answerBound(binding,null,'运费仍沿用上次','voice');
 const payload=f.oldMailbox().pending()[0].payload;let valid=true,release,checks=0;
 c.beforeAnswerSend=(operation,event)=>{checks++;assert.equal(operation,binding.operation_id);assert.equal(JSON.stringify(event),payload);if(!valid)throw Error('late packet invalidated the original source');};
 f.setHandler(async url=>url.endsWith('/identity')?f.response(f.identity()):url.includes('/requests/')?f.response(request):new Promise(resolve=>release=()=>resolve(f.response(task))));
 const work=c.tick();while(!release)await turn();assert.equal(checks,0);valid=false;release();await work;
 assert.equal(checks,1);assert.equal(c.summary().blocked,1);assert.equal(f.calls.filter(call=>call.o.method==='POST').length,0);
 const blocked=f.oldMailbox().pending()[0];assert.equal(blocked.payload,payload);assert.equal(blocked.ack,null);assert.equal(blocked.error,'TASK_VOICE_SOURCE_UNVERIFIED');
 c.beforeAnswerSend=()=>assert.fail('a blocked item requires explicit recovery; changing a hook cannot replay it');await c.tick();assert.equal(f.calls.filter(call=>call.o.method==='POST').length,0);
});
test('bound answer cannot follow changed account or route and cannot renew its original expiry',async t=>{
 const f=fixture(t),c=f.create();await c.configure(f.config);c.setForeground(true);await boundQuestion(f,c);
 const binding=c.bindReply(c.summary().contextKey,'stable-reply-2','original-question',1);
 const altered=structuredClone(binding);altered.route.session_id='wrong-session';assert.throws(()=>c.answerBound(altered,null,'禁止错投','phone'),/BINDING_STALE/);
 f.advance(3600001);assert.throws(()=>c.answerBound(binding,null,'不能续期','phone'),/EXPIRED/);
 await c.configure({...f.config,target:{...f.config.target,principal:{...f.principal,ownerId:'other-owner'}}});assert.throws(()=>c.answerBound(binding,null,'禁止跨账号','phone'),/PROFILE_CHANGED/);assert.equal(c.sends().length,0);
});
test('live reply revalidation requires successful fresh request AND parent detail, never a good stale cache',async t=>{
 const f=fixture(t),c=f.create();await c.configure(f.config);c.setForeground(true);const {task,request}=await boundQuestion(f,c);
 const binding=c.bindReply(c.summary().contextKey,'card-operation','original-question',1);await c.revalidateReply(binding);
 const before=f.oldMailbox().pending();assert.equal(before.length,0,'validation must not allocate an answer');
 f.setHandler(async url=>{if(url.endsWith('/identity'))return f.response(f.identity());if(url.includes('/requests/'))return f.response(request);throw Error('synthetic parent detail offline');});
 await assert.rejects(c.revalidateReply(binding));assert.equal(c.sends().length,0);
 const closedTask={...task,revision:2,commit_seq:3,event_id:'closed-task-event',state:'cancel_requested',body:{...task.body,revision:2,state:'cancel_requested'}};
 f.setHandler(async url=>f.response(url.endsWith('/identity')?f.identity():url.includes('/requests/')?request:closedTask));
 await assert.rejects(c.revalidateReply(binding),/REQUEST_CLOSED/);assert.throws(()=>c.validateReply(binding),/REQUEST_CLOSED/);
});
