import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {loadApp} from './load-app.mjs';
import {setupMaterialStore} from './material-fixture.mjs';

const route={computer_id:'synthetic-pc',agent_id:'hermes',project_id:'synthetic-project',session_id:'original-session'};
function fixture(t){
 const f=setupMaterialStore(t),calls=[],order=[];let now=Date.now();
 const principal={ownerId:'owner',producerId:'phone',serverId:'server'},target={baseUrl:'https://synthetic.invalid/v1',token:'a'.repeat(43),principal};
 class Clock extends Date{static now(){return now;}}
 const response=(body,status=200)=>({responseCode:status,result:JSON.stringify(body),header:{'content-type':'application/json'}});
 const identity=()=>({schema_version:'1.0',owner_id:'owner',producer_id:'phone',server_id:'server',
  scopes:['tasks:read','tasks:write','tasks:update','requests:read','answers:write','messages:receive'],expires_at:new Date(now+86400000).toISOString()});
 let handler;
 const platform={'@kit.CoreFileKit':{fileIo:f.io},'@kit.NetworkKit':{http:{RequestMethod:{GET:'GET',POST:'POST'},HttpDataType:{STRING:1},
  createHttp(){return{destroy(){},async request(url,options){calls.push({url,options});order.push(options.method+' '+url);return handler(url,options);}};}}}};
 const globals={Date:Clock},wire=loadApp('TaskWire',platform,globals),{TaskMailbox}=loadApp('TaskMailbox',platform,globals),{TaskTransport}=loadApp('TaskTransport',platform,globals);
 const create=()=>{const value=new TaskMailbox();value.initialize(f.root,principal);return value;};
 const m=create(),transport=new TaskTransport();transport.setForeground(true);
 const task={schema_version:'1.0',kind:'task',object_id:'original-task',revision:1,commit_seq:1,stored_at:new Date(now).toISOString(),
  event_id:'original-task-event',expires_at:new Date(now+3600000).toISOString(),state:'waiting_answer',receipts:[],
  body:{task_id:'original-task',revision:1,route,state:'waiting_answer',command:'合成预览任务',allow_create_session:false}};
 const request={...task,kind:'request',object_id:'original-request',commit_seq:2,event_id:'original-request-event',state:'pending',
  body:{request_id:'original-request',revision:1,task_id:'original-task',route,mode:'free_text',question:'采用新价格吗？',options:[],state:'pending',runtime_request_id:'original-native-wait'}};
 const ack=event=>({schema_version:'1.0',event_id:event.event_id,kind:event.kind,object_id:wire.taskObjectId(event.kind,event.body),revision:wire.taskBodyRevision(event.kind,event.body),
  commit_seq:3,stored_at:new Date(now).toISOString(),receipt:{receipt_id:'stored-receipt',subject_kind:event.kind,subject_id:wire.taskObjectId(event.kind,event.body),
   subject_revision:wire.taskBodyRevision(event.kind,event.body),stage:'server_stored',actor_id:'server-storage',related_event_id:event.event_id,error:null}});
 handler=async(url,options)=>response(url.endsWith('/identity')?identity():url.includes('/requests/')?request:url.includes('/tasks/')?task:ack(JSON.parse(options.extraData)),options.method==='POST'?201:200);
 const seed=(operation='original-answer',source='voice')=>{
  m.acceptDetail(task,now);m.acceptDetail(request,now);
  const {TaskReplyBinding}=loadApp('TaskReplyDraft',platform,globals),binding=new TaskReplyBinding();
  Object.assign(binding,{context_key:JSON.stringify([principal.ownerId,principal.producerId,principal.serverId,...Object.values(route)]),operation_id:operation,
   request_id:request.object_id,request_revision:1,task_id:task.object_id,route,expires_at:request.expires_at,question:request.body.question,mode:'free_text',options:[]});
  return m.draftBoundAnswer(binding,null,'用新价格，但运费沿用上次',source,now);
 };
 return{...f,m,transport,TaskTransport,target,create,identity,response,ack,task,request,seed,calls,order,
  get now(){return now;},advance(ms){now+=ms;},setHandler(value){handler=value;}};
}
const turn=()=>new Promise(setImmediate);

test('default transport rejects voice before actual POST and preserves exact locally blocked payload across cold restore',async t=>{
 const f=fixture(t),row=f.seed();assert.equal(await f.transport.pump(f.m,f.target),false);
 assert.deepEqual(f.calls.map(call=>call.options.method),['GET','GET','GET']);
 assert(f.calls.every(call=>!call.options.extraData));assert.equal(f.transport.note,'TASK_VOICE_SOURCE_UNVERIFIED');
 const blocked=f.m.pending()[0];assert.equal(blocked.state,'blocked');assert.equal(blocked.error,'TASK_VOICE_SOURCE_UNVERIFIED');
 assert.equal(blocked.payload,row.payload);assert.equal(blocked.attempts,1);assert.equal(blocked.needs_lookup,false);assert.equal(blocked.ack,null);
 const restored=f.create();assert.deepEqual(restored.pending()[0],blocked);assert.equal(restored.claim(f.now),undefined);
 await f.transport.pump(restored,f.target);assert.equal(f.calls.filter(call=>call.options.method==='POST').length,0);
});

test('a pre-POST local block write failure never fabricates a transport result or starts lookup in the live mailbox',async t=>{
 const f=fixture(t),row=f.seed(),block=f.m.blockUnsent.bind(f.m),finish=f.m.finish.bind(f.m);let rejected=0,finishes=0;
 f.m.blockUnsent=(...args)=>{rejected++;f.failPromotion(true);try{return block(...args);}finally{f.failPromotion(false);}};
 f.m.finish=(...args)=>{finishes++;return finish(...args);};
 assert.equal(await f.transport.pump(f.m,f.target),false);assert.equal(rejected,1);
 assert.equal(finishes,0,'a known pre-POST persistence failure is not finish(status=0) network uncertainty');
 assert.equal(f.transport.note,'TASK_PERSIST_FAILED');const pending=f.m.pending()[0];
 assert.equal(pending.state,'sending','the failed promotion must preserve the prior durable state');assert.equal(pending.payload,row.payload);
 assert.equal(pending.error,'');assert.equal(pending.ack,null);assert.equal(pending.needs_lookup,false);
 const partitions=fs.readdirSync(f.root+'/task-mailbox');assert.equal(partitions.length,1);
 assert.equal(fs.existsSync(f.root+'/task-mailbox/'+partitions[0]+'/state.json.partial'),true,'preserve the rejected local replacement for explicit repair');
 await f.transport.pump(f.m,f.target);assert.equal(finishes,0);assert(f.calls.every(call=>call.options.method==='GET'));
 assert(!f.calls.some(call=>call.url.includes('/events/')),'do not invent reconciliation for a request that was never issued');
});

for(const waitingAt of ['identity','request','task']){
 test('source invalidated while awaiting '+waitingAt+' is checked again at the actual send boundary',async t=>{
  const f=fixture(t),row=f.seed();let valid=true,release,checks=0;
  f.transport.beforeSend=(operation,event)=>{checks++;f.order.push('guard');assert.equal(operation,row.operation_id);assert.equal(JSON.stringify(event),row.payload);if(!valid)throw Error('source became tainted');};
  f.setHandler(async(url,options)=>{
   const value=url.endsWith('/identity')?f.identity():url.includes('/requests/')?f.request:url.includes('/tasks/')?f.task:f.ack(JSON.parse(options.extraData));
   const match=waitingAt==='identity'?url.endsWith('/identity'):waitingAt==='request'?url.includes('/requests/'):url.includes('/tasks/');
   if(match)return new Promise(resolve=>release=()=>resolve(f.response(value)));
   return f.response(value,options.method==='POST'?201:200);
  });
  const work=f.transport.pump(f.m,f.target);while(!release)await turn();assert.equal(checks,0);assert(!f.calls.some(call=>call.options.method==='POST'));
  valid=false;release();assert.equal(await work,false);assert.equal(checks,1);assert.equal(f.order.at(-1),'guard');
  assert.equal(f.m.pending()[0].state,'blocked');assert.equal(f.m.pending()[0].payload,row.payload);assert(!f.calls.some(call=>call.options.method==='POST'));
 });
}

test('explicit synthetic allow guard runs before POST and the immutable original payload is the one actually sent',async t=>{
 const f=fixture(t),row=f.seed();let checked=0;
 // Transport-only fixture: this permits synthetic voice bytes and does not
 // claim that a complete live capture/source proof has been verified.
 f.transport.beforeSend=(operation,event)=>{checked++;f.order.push('guard');assert.equal(operation,row.operation_id);assert.equal(JSON.stringify(event),row.payload);};
 assert.equal(await f.transport.pump(f.m,f.target),true);assert.equal(checked,1);
 const posted=f.calls.filter(call=>call.options.method==='POST');assert.equal(posted.length,1);assert.equal(posted[0].options.extraData,row.payload);
 const guardIndex=f.order.indexOf('guard'),postIndex=f.order.findIndex(value=>value.startsWith('POST '));assert(guardIndex<postIndex);
 assert.equal(f.m.pending()[0].state,'server_stored');assert.equal(f.m.pending()[0].ack.receipt.stage,'server_stored');
});

test('cold uncertain voice delivery reconciles the original operation without calling the source guard or repeating POST',async t=>{
 const f=fixture(t),row=f.seed();f.m.confirmDraft(row.operation_id,f.request,f.task,f.now);const claim=f.m.claim(f.now);
 const restored=f.create();assert.equal(restored.pending()[0].state,'reconcile');let checks=0;
 f.transport.beforeSend=()=>{checks++;throw Error('source no longer live');};
 const original=JSON.parse(row.payload);f.setHandler(async url=>f.response(url.endsWith('/identity')?f.identity():f.ack(original)));
 assert.equal(await f.transport.pump(restored,f.target),true);assert.equal(checks,0);assert.equal(f.calls.length,2);
 assert(f.calls[1].url.endsWith('/events/'+encodeURIComponent(claim.eventId)));assert(f.calls.every(call=>call.options.method==='GET'));
 assert.equal(restored.pending()[0].state,'server_stored');assert.equal(restored.pending()[0].payload,row.payload);
});

test('definitive event absence permits only a later guarded send, never an automatic unverified voice POST',async t=>{
 const f=fixture(t),row=f.seed();f.m.confirmDraft(row.operation_id,f.request,f.task,f.now);f.m.claim(f.now);const restored=f.create();let checks=0;
 f.transport.beforeSend=()=>{checks++;throw Error('tainted retained voice');};
 f.setHandler(async url=>url.endsWith('/identity')?f.response(f.identity()):f.response({schema_version:'1.0',error:{code:'EVENT_NOT_FOUND',retryable:false}},404));
 assert.equal(await f.transport.pump(restored,f.target),true);assert.equal(checks,0);assert.equal(restored.pending()[0].state,'queued');
 assert.equal(await f.transport.pump(restored,f.target),false);assert.equal(checks,1);assert.equal(restored.pending()[0].state,'blocked');
 assert.equal(restored.pending()[0].payload,row.payload);assert(f.calls.every(call=>call.options.method==='GET'));
});

test('phone answers remain independent of the default voice-source gate',async t=>{
 const f=fixture(t),row=f.seed('typed-answer','phone');assert.equal(await f.transport.pump(f.m,f.target),true);
 assert.equal(f.calls.filter(call=>call.options.method==='POST').length,1);assert.equal(f.m.pending()[0].payload,row.payload);assert.equal(f.m.pending()[0].state,'server_stored');
});
