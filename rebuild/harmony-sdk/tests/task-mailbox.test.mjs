import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {loadApp} from './load-app.mjs';
import {setupMaterialStore} from './material-fixture.mjs';
import {MaterialStore as ServerStore} from '../../material-server/store.mjs';
import {listen} from '../../material-server/http.mjs';

const route={computer_id:'synthetic-pc',agent_id:'hermes',project_id:'synthetic-project',session_id:'existing-synthetic-session'};
const scopes=['tasks:write','tasks:read','tasks:update','requests:read','answers:write','messages:receive','receipts:phone'];
function fixture(t){
  const f=setupMaterialStore(t);let now=Date.now();const calls=[];
  const principal={ownerId:'synthetic-owner',producerId:'synthetic-phone',serverId:'synthetic-server'};
  const target={baseUrl:'https://synthetic.invalid/v1',token:'a'.repeat(43),principal};
  const identity=()=>({schema_version:'1.0',server_id:principal.serverId,owner_id:principal.ownerId,producer_id:principal.producerId,
    scopes,expires_at:new Date(now+86400000).toISOString()});
  let handler=async()=>{throw Error('NETWORK_NOT_CONFIGURED');};
  const platform={'@kit.CoreFileKit':{fileIo:f.io},'@kit.NetworkKit':{http:{RequestMethod:{GET:'GET',POST:'POST'},HttpDataType:{STRING:1},
    createHttp(){return{destroy(){},async request(url,options){calls.push({url,options});return handler(url,options);}};}}}};
  class Clock extends Date{static now(){return now;}}
  const globals={Date:Clock};const {TaskMailbox}=loadApp('TaskMailbox',platform,globals),{TaskTransport}=loadApp('TaskTransport',platform,globals);
  const create=()=>{const m=new TaskMailbox();m.initialize(f.root,principal);return m;};
  const wire=loadApp('TaskWire',platform,globals),m=create(),transport=new TaskTransport();transport.setForeground(true);
  const response=(body,status=200)=>({responseCode:status,result:JSON.stringify(body),header:{'content-type':'application/json; charset=utf-8'}});
  const ack=e=>({schema_version:'1.0',event_id:e.event_id,kind:e.kind,object_id:wire.taskObjectId(e.kind,e.body),revision:wire.taskBodyRevision(e.kind,e.body),
    commit_seq:1,stored_at:new Date(now).toISOString(),receipt:{receipt_id:'synthetic-receipt',subject_kind:e.kind,subject_id:wire.taskObjectId(e.kind,e.body),
      subject_revision:wire.taskBodyRevision(e.kind,e.body),stage:'server_stored',actor_id:'server-storage',related_event_id:e.event_id,error:null}});
  const delegate=(id='tap-1')=>m.delegate(id,route,'合成测试：只生成预览，不执行外部操作',now,now+3600000);
  const object=(kind,body,seq=1)=>({schema_version:'1.0',kind,object_id:wire.taskObjectId(kind,body),revision:wire.taskBodyRevision(kind,body),
    commit_seq:seq,stored_at:new Date(now).toISOString(),event_id:'synthetic-event-'+seq,expires_at:new Date(now+3600000).toISOString(),
    command_expires_at:new Date(now+3600000).toISOString(),state:kind==='task'||kind==='request'?body.state:'recorded',body,receipts:[]});
  return {...f,m,transport,TaskMailbox,TaskTransport,wire,platform,create,calls,target,principal,identity,response,ack,delegate,object,
    get now(){return now;},advance(ms){now+=ms;},setHandler(h){handler=h;}};
}
const page=(f,items,cursor='synthetic-cursor')=>({items,has_more:false,next_cursor:cursor,server_time:new Date(f.now).toISOString(),fresh_until:new Date(f.now).toISOString()});
function question(f,id='q1'){
  const command=JSON.parse(f.delegate().payload).body,task=f.object('task',command);
  const request=f.object('request',{request_id:id,revision:1,task_id:command.task_id,route,mode:'choice',question:'合成问题：选哪个预览？',
    options:[{option_id:'a',label:'甲'},{option_id:'b',label:'乙'}],state:'pending',runtime_request_id:'native-wait-1'},2);
  return {task,request};
}

test('answer presentation requires live original task and route; closed or missing parent never shows an answer action',t=>{
  const f=fixture(t),{task,request}=question(f),can=f.wire.taskRequestCanAnswer;
  assert.equal(can(request,task,f.now),true);
  assert.equal(can(request,undefined,f.now),false);
  for(const state of ['cancel_requested','cancelled','completed','failed','expired','execution_unknown']){
    assert.equal(can(request,{...task,state},f.now),false);
  }
  assert.equal(can(request,{...task,body:{...task.body,route:{...route,session_id:'another'}}},f.now),false);
  assert.equal(can(request,{...task,object_id:'another-task'},f.now),false);
  assert.equal(can({...request,state:'expired'},task,f.now),false);
  assert.equal(can({...request,state:'withdrawn'},task,f.now),false);
  assert.equal(can(request,task,Date.parse(request.expires_at)),false);
});

test('immutable command bytes, exact route and deadline survive restart and duplicate operation',t=>{
  const f=fixture(t),row=f.delegate(),e=JSON.parse(row.payload);assert.equal(e.body.allow_create_session,false);assert.deepEqual(e.body.route,route);
  f.advance(5000);assert.equal(f.delegate().payload,row.payload);assert.equal(f.create().pending()[0].payload,row.payload);
  assert.throws(()=>f.m.delegate('tap-1',route,'different command',f.now,f.now+3600000),/TASK_OPERATION_CONFLICT/);
  assert.throws(()=>f.m.delegate('tap-2',{...route,session_id:''},'text',f.now,f.now+3600000),/TASK_COMMAND_INVALID/);
  assert.throws(()=>f.m.delegate('tap-2',route,' ',f.now,f.now+3600000),/TASK_COMMAND_INVALID/);
});

test('pre-POST source rejection is a durable local block with unchanged envelope and no invented HTTP receipt',t=>{
 const f=fixture(t),row=f.delegate(),claim=f.m.claim(f.now);
 f.m.blockUnsent(claim,'TASK_VOICE_SOURCE_UNVERIFIED',f.now);const blocked=f.m.pending()[0],cold=f.create().pending()[0];
 assert.equal(blocked.state,'blocked');assert.equal(blocked.error,'TASK_VOICE_SOURCE_UNVERIFIED');assert.equal(blocked.ack,null);
 assert.equal(blocked.payload,row.payload);assert.equal(blocked.attempts,1);assert.equal(blocked.needs_lookup,false);assert.equal(blocked.next_attempt_at,0);
 assert.deepEqual(cold,blocked);assert.equal(f.create().claim(f.now),undefined);
 assert.throws(()=>f.m.blockUnsent(claim,'TASK_VOICE_SOURCE_UNVERIFIED',f.now),/TASK_CLAIM_STALE/);
});
test('blockUnsent refuses foreign, changed, stale and lookup claims without touching persisted bytes',t=>{
 const f=fixture(t),row=f.delegate(),claim=f.m.claim(f.now),dir=path.join(f.root,'task-mailbox',fs.readdirSync(path.join(f.root,'task-mailbox'))[0]),state=path.join(dir,'state.json');
 const bytes=fs.readFileSync(state);
 for(const changed of [{partition:'foreign'},{action:'lookup'},{attempt:claim.attempt+1},{payload:claim.payload+' '},{operationId:'another-operation'}]){
  assert.throws(()=>f.m.blockUnsent({...claim,...changed},'TASK_VOICE_SOURCE_UNVERIFIED',f.now),/TASK_CLAIM_STALE/);
  assert.deepEqual(fs.readFileSync(state),bytes);assert.equal(f.m.pending()[0].state,'sending');
 }
 assert.throws(()=>f.m.blockUnsent(claim,'HTTP_403',f.now),/TASK_CLAIM_STALE/);assert.deepEqual(fs.readFileSync(state),bytes);
 const cold=f.create();assert.equal(cold.pending()[0].state,'reconcile');assert.throws(()=>cold.blockUnsent(claim,'TASK_VOICE_SOURCE_UNVERIFIED',f.now),/TASK_CLAIM_STALE/);
 const lookup=cold.claim(f.now);assert.equal(lookup.action,'lookup');assert.throws(()=>cold.blockUnsent(lookup,'TASK_VOICE_SOURCE_UNVERIFIED',f.now),/TASK_CLAIM_STALE/);
 assert.equal(cold.pending()[0].payload,row.payload);assert.equal(cold.pending()[0].needs_lookup,true);
});
test('failed persistence cannot report a local source block and a later exact retry retains the original payload',t=>{
 const f=fixture(t),row=f.delegate(),claim=f.m.claim(f.now),dir=path.join(f.root,'task-mailbox',fs.readdirSync(path.join(f.root,'task-mailbox'))[0]),state=path.join(dir,'state.json');
 const bytes=fs.readFileSync(state);f.failPromotion(true);assert.throws(()=>f.m.blockUnsent(claim,'TASK_VOICE_SOURCE_UNVERIFIED',f.now),/synthetic-disk-failure/);
 assert.equal(f.m.pending()[0].state,'sending');assert.deepEqual(fs.readFileSync(state),bytes);assert.equal(f.m.pending()[0].ack,null);
 f.failPromotion(false);f.m.blockUnsent(claim,'TASK_VOICE_SOURCE_UNVERIFIED',f.now);assert.equal(f.m.pending()[0].state,'blocked');assert.equal(f.create().pending()[0].payload,row.payload);
});

test('local withdrawal requires proof of no send attempt and atomic promotion before reporting withdrawn',t=>{
  const f=fixture(t),row=f.delegate();f.failPromotion(true);
  assert.throws(()=>f.m.withdrawUnsent(row.operation_id),/synthetic-disk-failure/);
  assert.equal(f.m.pending()[0].state,'queued');assert.equal(f.create().pending()[0].state,'queued');
  f.failPromotion(false);f.m.withdrawUnsent(row.operation_id);const next=f.create();
  assert.equal(next.pending()[0].state,'withdrawn_local');assert.equal(next.pending()[0].payload,row.payload);assert.equal(next.claim(f.now),undefined);
  const sent=f.m.delegate('second',route,'合成已发送任务',f.now,f.now+60000);f.m.claim(f.now);
  assert.throws(()=>f.m.withdrawUnsent(sent.operation_id),/TASK_WITHDRAW_UNCERTAIN/);
  assert.throws(()=>f.m.withdrawUnsent('missing'),/TASK_WITHDRAW_UNCERTAIN/);
});

test('manual recheck only looks up an attempted event and cannot renew its expired original deadline',t=>{
  const f=fixture(t),row=f.delegate();assert.throws(()=>f.m.recheck(row.operation_id),/TASK_RECHECK_UNAVAILABLE/);
  const claim=f.m.claim(f.now);f.m.finish(claim,403,JSON.stringify({schema_version:'1.0',error:{code:'FORBIDDEN',retryable:false}}),f.now);
  f.advance(3600001);f.m.recheck(row.operation_id);const lookup=f.m.claim(f.now);assert.equal(lookup.action,'lookup');assert.equal(lookup.payload,row.payload);
  f.m.finish(lookup,404,JSON.stringify({schema_version:'1.0',error:{code:'EVENT_NOT_FOUND',retryable:false}}),f.now);
  assert.equal(f.m.pending()[0].state,'expired');assert.equal(f.m.claim(f.now),undefined);assert.equal(f.create().pending()[0].payload,row.payload);
});

test('inbox snapshot promotion failure leaves both cursor and objects unchanged; stale writer fails closed',t=>{
  const f=fixture(t),q=question(f),old=f.create();f.failPromotion(true);
  assert.throws(()=>f.m.acceptPage(page(f,[q.task,q.request]),''),/synthetic-disk-failure/);
  assert.equal(f.m.cursor(),'');assert.equal(f.m.objects().length,0);assert.equal(f.create().cursor(),'');
  f.failPromotion(false);f.m.acceptPage(page(f,[q.task,q.request]),'');assert.equal(f.m.objects().length,2);
  assert.throws(()=>old.resetCursor(''),/TASK_WRITER_STALE/);assert.equal(f.create().cursor(),'synthetic-cursor');
});

test('bad/misrouted/duplicate-sequence pages cannot advance the inbox cursor',t=>{
  const f=fixture(t),q=question(f);f.m.acceptPage(page(f,[q.task,q.request]),'');
  const changed=structuredClone(q.request);changed.revision++;changed.body.revision++;changed.body.route.session_id='wrong-session';
  assert.throws(()=>f.m.acceptPage(page(f,[changed],'later'),'synthetic-cursor'),/TASK_ROUTE_MISMATCH/);
  assert.throws(()=>f.m.acceptPage(page(f,[q.task,q.task],'later'),'synthetic-cursor'),/TASK_RESPONSE_INVALID/);
  assert.throws(()=>f.m.acceptPage({...page(f,[]),has_more:true},'synthetic-cursor'),/TASK_RESPONSE_INVALID/);
  assert.equal(f.m.cursor(),'synthetic-cursor');assert.equal(f.create().object('request','q1').item.body.route.session_id,route.session_id);
});

test('answer requires fresh request and task, retains extra conditions, and never changes its question route',t=>{
  const f=fixture(t),{task,request}=question(f);f.m.acceptPage(page(f,[task,request]),'');
  assert.throws(()=>f.m.answer('answer-1','q1',1,'a','只生成预览',f.now),/TASK_REFRESH_REQUIRED/);
  f.m.acceptDetail(request,f.now);f.m.acceptDetail(task,f.now);
  assert.throws(()=>f.m.answer('answer-1','q1',1,'c','',f.now),/TASK_OPTION_INVALID/);
  const answer=JSON.parse(f.m.answer('answer-1','q1',1,'a','甲，但只生成预览',f.now).payload);
  assert.deepEqual(answer.body.route,route);assert.equal(answer.body.task_id,task.object_id);assert.equal(answer.body.request_revision,1);
  assert.equal(answer.body.input_source,'phone');assert.equal(answer.body.raw_action,null);assert.equal(answer.body.text,'甲，但只生成预览');
  assert.equal(answer.expires_at,request.expires_at);
  f.advance(1);assert.throws(()=>f.m.answer('answer-2','q1',1,'a','',f.now),/TASK_REFRESH_REQUIRED/);
});

test('interrupted send reconciles before replay; matching server ack proves storage only',t=>{
  const f=fixture(t),row=f.delegate(),claim=f.m.claim(f.now),next=f.create();
  assert.equal(next.pending()[0].state,'reconcile');const lookup=next.claim(f.now);assert.equal(lookup.action,'lookup');assert.equal(lookup.payload,row.payload);
  const ack=f.ack(JSON.parse(row.payload));next.finish(lookup,200,JSON.stringify(ack),f.now);
  assert.equal(next.pending()[0].state,'server_stored');assert.equal(next.pending()[0].ack.receipt.stage,'server_stored');
  assert.equal(next.objects().length,0,'no invented agent_received or task_completed');assert.throws(()=>f.m.finish(claim,200,JSON.stringify(ack),f.now),/TASK_WRITER_STALE/);
});

test('unknown/forged reply keeps lookup; definitive absence cannot renew an expired command',t=>{
  const f=fixture(t),row=f.delegate(),claim=f.m.claim(f.now),forged=f.ack(JSON.parse(row.payload));forged.receipt.actor_id='phone';
  f.m.finish(claim,201,JSON.stringify(forged),f.now);assert.equal(f.m.pending()[0].needs_lookup,true);
  f.advance(3600001);const lookup=f.m.claim(f.now);assert.equal(lookup.action,'lookup');
  f.m.finish(lookup,404,JSON.stringify({schema_version:'1.0',error:{code:'EVENT_NOT_FOUND',retryable:false}}),f.now);
  assert.equal(f.m.pending()[0].state,'expired');assert.equal(f.m.claim(f.now),undefined);assert.equal(f.m.pending()[0].payload,row.payload);
});

test('identity mismatch prevents task body disclosure; foreground cancellation fences a late POST',async t=>{
  const f=fixture(t),row=f.delegate();f.setHandler(async()=>f.response({...f.identity(),owner_id:'foreign-owner'}));
  assert.equal(await f.transport.pump(f.m,f.target),false);assert.equal(f.calls.length,1);assert.equal(f.m.pending()[0].attempts,0);
  f.advance(6000);let release;f.setHandler(async(url)=>url.endsWith('/identity')?f.response(f.identity()):new Promise(resolve=>release=resolve));
  const pending=f.transport.pump(f.m,f.target);while(!release)await new Promise(r=>setImmediate(r));
  f.transport.setForeground(false);release(f.response(f.ack(JSON.parse(row.payload)),201));await pending;
  assert.equal(f.m.pending()[0].state,'retry_wait');assert.equal(f.m.pending()[0].needs_lookup,true);
  assert.equal(f.m.pending()[0].ack,null);assert.equal(await f.transport.poll(f.m,f.target),false);
});

test('partition change and missing write scopes fail closed, without adopting material permissions',async t=>{
  const f=fixture(t);f.delegate();f.setHandler(async()=>f.response({...f.identity(),scopes:['materials:write']}));
  await f.transport.pump(f.m,f.target);assert.equal(f.calls.length,1);assert.equal(f.m.pending()[0].attempts,0);
  f.advance(6000);f.setHandler(async()=>f.response({...f.identity(),scopes:['tasks:read','requests:read','messages:receive']}));
  await f.transport.pump(f.m,f.target);assert.equal(f.calls.length,2);assert.equal(f.m.pending()[0].error,'FORBIDDEN');
  const other=new f.TaskMailbox();other.initialize(f.root,{...f.principal,ownerId:'other-owner'});assert.equal(other.pending().length,0);
  await assert.rejects(()=>f.transport.poll(other,f.target),/TASK_IDENTITY_CHANGED/);
});

test('real local HTTP: dropped task reply, exact replay lookup, first answer competition and original-task result',async t=>{
  const f=fixture(t),dbRoot=fs.mkdtempSync(path.join(os.tmpdir(),'turboio-task-server-')),store=new ServerStore(path.join(dbRoot,'queue.sqlite'),{clock:()=>f.now});
  const phone=store.mint({owner:f.principal.ownerId,producer:f.principal.producerId,scopes}),agent=store.mint({owner:f.principal.ownerId,producer:'synthetic-agent',
    scopes:['tasks:read','tasks:update','requests:write','messages:write','messages:receive','receipts:agent']});
  f.target.token=phone.token;f.principal.serverId=store.identity(phone.token).server_id;f.m.initialize(f.root,f.principal);
  const server=await listen(store);t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));store.close();
    assert(path.resolve(dbRoot).startsWith(path.join(os.tmpdir(),'turboio-task-server-')));fs.rmSync(dbRoot,{recursive:true});});
  const base=`http://127.0.0.1:${server.address().port}`;
  let loseReply=true;const posts=[],httpEvidence=[];
  f.setHandler(async(url,o)=>{const relative=url.slice('https://synthetic.invalid'.length);
    let r;try{r=await fetch(base+relative,{method:o.method,headers:o.header,...(o.extraData?{body:o.extraData}:{})});}
    catch(error){httpEvidence.push({path:relative,method:o.method,error:error.cause?.code||error.code||error.name});throw error;}
    httpEvidence.push({path:relative,method:o.method,status:r.status});
    const value=await r.text();if(o.extraData){posts.push(JSON.parse(o.extraData));if(loseReply){loseReply=false;throw Error('synthetic dropped response after real commit');}}
    return{responseCode:r.status,result:value,header:Object.fromEntries(r.headers)};});
  const row=f.delegate(),original=JSON.parse(row.payload);await f.transport.pump(f.m,f.target);
  if(!f.m.pending()[0].needs_lookup)t.diagnostic('first-loopback-pump '+JSON.stringify({note:f.transport.note,http:httpEvidence,state:f.m.pending()[0].state,error:f.m.pending()[0].error}));
  assert.equal(f.m.pending()[0].needs_lookup,true);
  let resumed=f.create();const transport=new f.TaskTransport();transport.setForeground(true);f.advance(6000);
  await transport.pump(resumed,f.target);assert.equal(posts.length,1);assert.equal(resumed.pending()[0].state,'server_stored');
  assert.equal(store.queueCeiling(f.principal.ownerId),1);await transport.poll(resumed,f.target);
  const env=(kind,body,id)=>({schema_version:'1.0',event_id:id,idempotency_key:'idem-'+id,kind,producer_id:'synthetic-agent',
    created_at:new Date(f.now).toISOString(),expires_at:new Date(f.now+3600000).toISOString(),body});
  const request={request_id:'real-q1',revision:1,task_id:original.body.task_id,route,mode:'choice',question:'合成问题',options:[{option_id:'a',label:'甲'},{option_id:'b',label:'乙'}],state:'pending',runtime_request_id:'original-native-wait'};
  store.queueSubmit(agent.token,env('request',request,'real-question'),'request');await transport.poll(resumed,f.target);
  const answer=await transport.prepareAnswer(resumed,f.target,'answer-real-1','real-q1',1,'a','甲，但只生成预览');assert(answer);
  // A second phone wins after the first phone's detail read but before its POST.
  const competing=JSON.parse(answer.payload);competing.event_id='competing';competing.idempotency_key='idem-competing';competing.body.answer_id='competing-answer';
  store.queueSubmit(phone.token,competing,'answer');await transport.pump(resumed,f.target);
  assert.equal(resumed.pending().find(r=>r.operation_id==='answer-real-1').error,'ANSWER_ALREADY_ACCEPTED');
  assert(await transport.refresh(resumed,f.target,'request','real-q1'));assert.equal(resumed.object('request','real-q1').item.answer.object_id,'competing-answer');
  assert.equal(await transport.prepareAnswer(resumed,f.target,'answer-real-2','real-q1',1,'b',''),undefined);assert.equal(transport.note,'TASK_REQUEST_CLOSED');
  // A second independent question exercises this client's successful answer,
  // including its exact task/session and retained condition in server storage.
  store.queueSubmit(agent.token,env('request',{...request,request_id:'real-q2',mode:'free_text',options:[],question:'是否采用新价格？'},'real-question-2'),'request');
  await transport.poll(resumed,f.target);
  const {TaskReplyBinding,TaskDecisionPlan,TaskDecisionDraft}=loadApp('TaskReplyDraft',f.platform),binding=new TaskReplyBinding(),q2=resumed.object('request','real-q2').item;
  Object.assign(binding,{context_key:JSON.stringify([f.principal.ownerId,f.principal.producerId,f.principal.serverId,route.computer_id,route.agent_id,route.project_id,route.session_id]),operation_id:'answer-real-3',request_id:'real-q2',request_revision:1,
    task_id:original.body.task_id,route,expires_at:q2.expires_at,question:q2.body.question,mode:'free_text',options:[]});
  const decision=new TaskDecisionDraft();decision.initialize(f.root);decision.begin(binding,new TaskDecisionPlan(),f.now);
  decision.armCard(binding.context_key,'synthetic-peer','answer-real-3-proposal',f.now);decision.suggestion(binding.context_key,'synthetic-peer',34,'answer-real-3-proposal',2,f.now);
  assert.equal(store.queueGet(agent.token,'request','real-q2').answer,null,'first simulated reject must not wake the Agent with a final answer');
  assert.equal(resumed.pending().filter(row=>JSON.parse(row.payload).body.request_id==='real-q2').length,0);
  decision.removalSubmitted('synthetic-peer','answer-real-3-proposal');decision.armCard(binding.context_key,'synthetic-peer','answer-real-3-offer',f.now);
  decision.suggestion(binding.context_key,'synthetic-peer',34,'answer-real-3-offer',1,f.now);decision.removalSubmitted('synthetic-peer','answer-real-3-offer');
  decision.transcript(binding.context_key,binding.operation_id,'用新价格，但运费沿用上次；只生成预览。',f.now);const submission=decision.seal(binding.context_key,f.now);
  const own=resumed.draftBoundAnswer(submission.binding,submission.option_id,submission.text,submission.input_source,f.now);assert.equal(own.state,'awaiting_refresh');
  assert.equal(resumed.draftBoundAnswer(submission.binding,submission.option_id,submission.text,submission.input_source,f.now).payload,own.payload);
  resumed=f.create();assert.equal(resumed.pending().find(r=>r.operation_id==='answer-real-3').payload,own.payload);
  // This local-server test exercises routing/storage with a synthetic voice
  // transcript, not the complete live-capture provenance guard.
  transport.beforeSend=()=>{};
  loseReply=true;await transport.pump(resumed,f.target);assert.equal(resumed.pending().find(r=>r.operation_id==='answer-real-3').needs_lookup,true);
  resumed=f.create();f.advance(6000);await transport.pump(resumed,f.target);assert.equal(resumed.pending().find(r=>r.operation_id==='answer-real-3').state,'server_stored');
  assert.equal(posts.filter(event=>event.kind==='answer'&&event.body.request_id==='real-q2').length,1,'lost reply is reconciled by stable event ID, not a second answer POST');
  assert.equal(resumed.pending().find(r=>r.operation_id==='answer-real-3').payload,own.payload,'network restoration never replaces the original answer envelope');
  const accepted=store.queueGet(agent.token,'request','real-q2').answer.body;
  assert.equal(accepted.text,'用新价格，但运费沿用上次；只生成预览。');assert.equal(accepted.input_source,'voice');assert.equal(accepted.option_id,null);assert.equal(accepted.raw_action,null);
  assert.equal(accepted.request_revision,1);assert.equal(accepted.task_id,original.body.task_id);assert.deepEqual(accepted.route,route);
  const message={message_id:'result1',revision:1,route,task_id:original.body.task_id,request_id:null,channel:'result',text:'合成预览结果'};
  store.queueSubmit(agent.token,env('message',message,'result-event'),'message');await transport.poll(resumed,f.target);
  assert.equal(resumed.object('message','result1').item.body.text,'合成预览结果');assert.deepEqual(resumed.object('message','result1').item.body.route,route);
  assert.equal(store.queueGet(phone.token,'task',original.body.task_id).state,'queued','result message is not a completed task');
});

test('live detail catches changed question revision and closed task before queuing an answer',async t=>{
  const f=fixture(t),{task,request}=question(f),changed=structuredClone(request);changed.revision=2;changed.body.revision=2;changed.commit_seq=3;changed.event_id='changed-question';
  f.m.acceptPage(page(f,[task,request]),'');
  f.setHandler(async(url)=>f.response(url.endsWith('/identity')?f.identity():url.includes('/requests/')?changed:task));
  assert.equal(await f.transport.prepareAnswer(f.m,f.target,'answer-old','q1',1,'a',''),undefined);
  assert.equal(f.transport.note,'TASK_REFRESH_REQUIRED');assert.equal(f.m.pending().length,1);assert.equal(f.m.object('request','q1').item.revision,2);
  const closed=structuredClone(task);closed.revision=2;closed.body.revision=2;closed.body.state=closed.state='execution_unknown';closed.event_id='unknown-task';closed.commit_seq=4;
  f.setHandler(async(url)=>f.response(url.endsWith('/identity')?f.identity():url.includes('/requests/')?changed:closed));
  assert.equal(await f.transport.prepareAnswer(f.m,f.target,'answer-unknown','q1',2,'a',''),undefined);assert.equal(f.transport.note,'TASK_CLOSED');
  assert.equal(f.m.pending().length,1);
});

test('cancel preparation refreshes current task; pending cancellation never means runtime stopped',async t=>{
  const f=fixture(t),{task}=question(f);
  f.setHandler(async(url,o)=>f.response(url.endsWith('/identity')?f.identity():o.extraData?f.ack(JSON.parse(o.extraData)):task));
  const queued=await f.transport.prepareCancel(f.m,f.target,'cancel-current',task.object_id,1);assert(queued);
  assert.equal(JSON.parse(queued.payload).body.state,'cancel_requested');assert.equal(f.m.object('task',task.object_id).item.state,'queued');
  await f.transport.pump(f.m,f.target);await f.transport.pump(f.m,f.target);
  assert.equal(f.m.pending().find(r=>r.operation_id==='cancel-current').state,'server_stored');
  assert.equal(f.m.object('task',task.object_id).item.state,'queued');
});

test('Retry-After is persistent; an untrusted lookup error does not authorize replay',t=>{
  const f=fixture(t);f.delegate();let claim=f.m.claim(f.now);f.m.finish(claim,503,JSON.stringify({schema_version:'1.0',error:{code:'UNAVAILABLE'}}),f.now,90000);
  f.advance(60000);const next=f.create();assert.equal(next.claim(f.now),undefined);f.advance(30001);claim=next.claim(f.now);assert.equal(claim.action,'lookup');
  next.finish(claim,404,JSON.stringify({schema_version:'1.0',error:{code:'NOT_FOUND',retryable:false}}),f.now);
  assert.equal(next.pending()[0].state,'blocked');assert.equal(next.pending()[0].needs_lookup,true);
});

test('corrupt durable state is retained and rejected instead of becoming an empty mailbox',t=>{
  const f=fixture(t);f.delegate();const dir=path.join(f.root,'task-mailbox',fs.readdirSync(path.join(f.root,'task-mailbox'))[0]),state=path.join(dir,'state.json');
  const saved=fs.readFileSync(state,'utf8');fs.writeFileSync(state,'{"schema":99}');
  assert.throws(()=>f.create(),/TASK_STORE_CORRUPT/);assert.equal(fs.readFileSync(state,'utf8'),'{"schema":99}');
  fs.writeFileSync(state,saved);assert.equal(f.create().pending().length,1);
});

test('offline answer is retained without HTTP and cannot be sent if the question changed during disconnection',async t=>{
  const f=fixture(t),{task,request}=question(f);f.m.acceptPage(page(f,[task,request]),'');f.transport.setForeground(false);
  const row=f.m.draftAnswer('offline-answer','q1',1,'a','离线附加条件',f.now);assert.equal(row.state,'awaiting_refresh');
  assert.equal(await f.transport.pump(f.m,f.target),false);assert.equal(f.calls.length,0);
  const resumed=f.create();assert.equal(resumed.firstDraft().payload,row.payload);
  const changed=structuredClone(request);changed.revision++;changed.body.revision++;changed.event_id='question-v2';changed.commit_seq=3;
  f.setHandler(async url=>f.response(url.endsWith('/identity')?f.identity():url.includes('/requests/')?changed:task));
  const transport=new f.TaskTransport();transport.setForeground(true);await transport.pump(resumed,f.target);
  const draft=resumed.pending().find(r=>r.operation_id==='offline-answer');assert.equal(draft.state,'blocked');assert.equal(draft.error,'STALE_REQUEST');
  assert.equal(draft.payload,row.payload);assert.equal(draft.attempts,0);assert(!f.calls.some(c=>c.url.endsWith('/answers')));
});

test('a definitively missing question blocks only its draft and does not freeze unrelated commands',async t=>{
  const f=fixture(t),{task,request}=question(f);f.m.acceptPage(page(f,[task,request]),'');
  f.m.draftAnswer('orphan-draft','q1',1,'a','保留草稿',f.now);
  f.setHandler(async(url,o)=>url.endsWith('/identity')?f.response(f.identity()):url.includes('/requests/')?
    f.response({schema_version:'1.0',error:{code:'REQUEST_NOT_FOUND',retryable:false}},404):f.response(f.ack(JSON.parse(o.extraData)),201));
  assert(await f.transport.pump(f.m,f.target));
  assert.equal(f.m.pending().find(r=>r.operation_id==='orphan-draft').error,'REQUEST_NOT_FOUND');
  assert.equal(f.m.pending().find(r=>r.operation_id==='tap-1').state,'server_stored');
  assert.equal(f.calls.filter(c=>c.options.extraData).length,1);assert(!f.calls.some(c=>c.url.endsWith('/answers')));
});

test('cancellation publishes a request state only; current revision and live task state gate it',t=>{
  const f=fixture(t),{task}=question(f);f.m.acceptDetail(task,f.now);
  const row=f.m.requestCancel('cancel-1',task.object_id,1,f.now),event=JSON.parse(row.payload);
  assert.equal(event.body.state,'cancel_requested');assert.equal(event.body.revision,2);assert.deepEqual(event.body.route,route);
  assert.equal(f.m.object('task',task.object_id).item.state,'queued','no local success claim before server/runtime');
  assert.throws(()=>f.m.requestCancel('cancel-2',task.object_id,2,f.now),/TASK_REFRESH_REQUIRED/);
  const completed=structuredClone(task);completed.revision=2;completed.body.revision=2;completed.state=completed.body.state='completed';completed.event_id='complete';completed.commit_seq=3;
  f.m.acceptDetail(completed,f.now);assert.throws(()=>f.m.requestCancel('cancel-3',task.object_id,2,f.now),/TASK_CANCEL_UNAVAILABLE/);
});
