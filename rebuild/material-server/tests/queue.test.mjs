import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {MaterialStore} from '../store.mjs';
import {listen} from '../http.mjs';

// P40 queue objects come straight from the P14 fixtures; no bespoke shapes.
const fixture=JSON.parse(fs.readFileSync(new URL('../../../docs/contracts/normal.json',import.meta.url)));
const bodies=Object.fromEntries(fixture.events.map(e=>[e.kind,e.body]));
const receiptBodies=fixture.events.filter(e=>e.kind==='receipt').map(e=>e.body);
const epoch=Date.parse('2026-10-11T02:00:00Z');
const phoneScopes=['materials:read','materials:write','tasks:write','tasks:read','requests:read','answers:write','messages:receive','receipts:phone'];
const agentScopes=['tasks:read','tasks:update','requests:write','messages:receive','messages:write','receipts:agent'];
const withBody=(body,patch)=>({...structuredClone(body),...patch});
function envelope(kind,body,{producer='phone-app',now=epoch,ttl=3600000,event_id=randomUUID(),idempotency_key=randomUUID()}={}){
  return {schema_version:'1.0',event_id,idempotency_key,kind,producer_id:producer,
    created_at:new Date(now).toISOString(),expires_at:new Date(now+ttl).toISOString(),body:structuredClone(body)};
}
function setup(t){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'io-queue-')),db=path.join(dir,'queue.sqlite');
  let now=epoch,store=new MaterialStore(db,{clock:()=>now});
  const phone=store.mint({owner:'owner-a',producer:'phone-app',scopes:phoneScopes});
  const agent=store.mint({owner:'owner-a',producer:'pc-agent',scopes:agentScopes});
  const foreign=store.mint({owner:'owner-b',producer:'phone-app',scopes:phoneScopes});
  const readonly=store.mint({owner:'owner-a',producer:'computer-query',scopes:['materials:read']});
  t.after(()=>{store.close();fs.rmSync(dir,{recursive:true,force:true});});
  return {dir,db,phone,agent,foreign,readonly,get store(){return store;},setTime:n=>{now=n;},
    restart(){store.close();store=new MaterialStore(db,{clock:()=>now});return store;}};
}
const error=code=>e=>e.code===code;

test('command deadline survives later status deadlines, inbox and restart',t=>{
  const f=setup(t);
  const task=envelope('task',bodies.task,{ttl:60000});
  f.store.queueSubmit(f.phone.token,task,'task');
  f.setTime(epoch+30000);
  const received=envelope('task',withBody(bodies.task,{revision:2,state:'agent_received'}),{producer:'pc-agent',now:epoch+30000});
  f.store.queueSubmit(f.agent.token,received,'task');
  f.setTime(epoch+90000);f.restart();
  const current=f.store.queueGet(f.agent.token,'task','task-demo');
  assert.equal(current.command_expires_at,task.expires_at);
  assert.equal(current.expires_at,received.expires_at);
  assert.ok(Date.parse(current.command_expires_at)<epoch+90000);
  const inbox=f.store.inbox(f.agent.token).items.filter(item=>item.kind==='task');
  assert.equal(inbox.length,2);
  assert.ok(inbox.every(item=>item.command_expires_at===task.expires_at));
});
// The fixture command path: a phone task, an agent request and question message,
// without an answer yet.
function command(f,{task='task-demo',request='request-demo',message='message-demo'}={}){
  f.store.queueSubmit(f.phone.token,envelope('task',withBody(bodies.task,{task_id:task})),'task');
  if(request)f.store.queueSubmit(f.agent.token,envelope('request',withBody(bodies.request,{request_id:request,task_id:task}),{producer:'pc-agent'}),'request');
  if(message)f.store.queueSubmit(f.agent.token,envelope('message',withBody(bodies.message,{message_id:message,task_id:task,request_id:request}),{producer:'pc-agent'}),'message');
  return {task,request};
}
// The full decision loop including the answer with its retained extra condition.
function loop(f,{task='task-demo',request='request-demo',message='message-demo',answer='answer-demo'}={}){
  command(f,{task,request,message});
  return f.store.queueSubmit(f.phone.token,envelope('answer',withBody(bodies.answer,{answer_id:answer,request_id:request,task_id:task})),'answer');
}

test('real HTTP: task, request, inbox, first answer and receipts complete the P14 decision loop',async t=>{
  const f=setup(t),server=await listen(f.store);t.after(async()=>{if(server.listening)await new Promise(r=>server.close(r));});
  const base=`http://127.0.0.1:${server.address().port}`;
  const post=(token,route,body)=>fetch(base+route,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(body)});
  const get=(token,route)=>fetch(base+route,{headers:{Authorization:`Bearer ${token}`}});
  assert.equal((await post(f.phone.token,'/v1/tasks',envelope('task',bodies.task))).status,201);
  const request=envelope('request',bodies.request,{producer:'pc-agent'});
  assert.equal((await post(f.agent.token,'/v1/requests',request)).status,201);
  assert.equal((await post(f.agent.token,'/v1/messages',envelope('message',bodies.message,{producer:'pc-agent'}))).status,201);
  // Only the phone's read scopes decide what its inbox may show.
  const inbox=await (await get(f.phone.token,'/v1/inbox')).json();
  assert.deepEqual(inbox.items.map(v=>[v.kind,v.state]),[['task','queued'],['request','pending'],['message','recorded']]);
  assert.equal(inbox.has_more,false);assert.equal(inbox.freshness===undefined,true);
  const answer=envelope('answer',bodies.answer);
  assert.equal((await post(f.phone.token,'/v1/answers',answer)).status,201);
  const detail=await (await get(f.agent.token,'/v1/requests/request-demo')).json();
  assert.equal(detail.state,'answered');assert.equal(detail.answer.body.option_id,'A');
  // A structured option never erases the extra condition the user attached.
  assert.equal(detail.answer.body.text,'方案 A，但只生成预览');assert.equal(detail.answer.body.input_source,'voice');
  assert.equal(detail.answer.body.request_revision,1);
  const task=await (await get(f.agent.token,'/v1/tasks/task-demo')).json();
  assert.equal(task.state,'queued');assert.deepEqual(task.body.route,bodies.task.route);
  // The program reports stages; each stage stays a separate fact on its own subject.
  const stages=[['user_answered','answer','answer-demo','phone-app',f.phone.token],
    ['agent_received','answer','answer-demo','pc-agent',f.agent.token],
    ['task_resumed','task','task-demo','pc-agent',f.agent.token],
    ['task_completed','task','task-demo','pc-agent',f.agent.token]];
  for(const [index,[stage,subject_kind,subject_id,producer,token]] of stages.entries()){
    const body=withBody(receiptBodies[index+2],{receipt_id:`rc-${stage}`,stage,subject_kind,subject_id,subject_revision:1});
    assert.equal((await post(token,'/v1/receipts',envelope('receipt',body,{producer}))).status,201);
  }
  const withReceipts=await (await get(f.agent.token,'/v1/requests/request-demo')).json();
  assert.deepEqual(withReceipts.receipts,[]);
  assert.deepEqual(withReceipts.answer.receipts.map(v=>v.stage),['user_answered','agent_received']);
  assert.deepEqual((await (await get(f.agent.token,'/v1/tasks/task-demo')).json()).receipts.map(v=>v.stage),['task_resumed','task_completed']);
  const message=await (await get(f.agent.token,'/v1/messages/message-demo')).json();
  assert.equal(message.kind,'message');assert.equal(message.body.channel,'question');assert.equal(message.revision,1);
  assert.equal((await get(f.readonly.token,'/v1/inbox')).status,403);
  assert.equal((await get(f.foreign.token,'/v1/tasks/task-demo')).status,404);
});

test('two independent processes answering one request accept exactly one answer',async t=>{
  const f=setup(t);command(f);
  const worker=fileURLToPath(new URL('./worker.mjs',import.meta.url));
  const files=['answer-a','answer-b'].map(id=>{
    const file=path.join(f.dir,id+'.json');
    fs.writeFileSync(file,JSON.stringify({token:f.phone.token,kind:'answer',e:envelope('answer',withBody(bodies.answer,{answer_id:id}))}));
    return file;
  });
  const run=file=>new Promise((resolve,reject)=>{const child=spawn(process.execPath,[worker,f.db,file],{env:process.env});
    let out='',err='';child.stdout.on('data',v=>out+=v);child.stderr.on('data',v=>err+=v);child.on('error',reject);
    child.on('exit',()=>resolve({...JSON.parse(out||'{}'),err}));});
  const results=await Promise.all(files.map(run));
  assert.deepEqual(results.map(v=>v.status??v.error).sort(),[201,'ANSWER_ALREADY_ACCEPTED']);
  const winner=results.find(v=>v.status===201),stored=f.restart().queueGet(f.agent.token,'request','request-demo').answer;
  assert.equal(stored.body.answer_id,winner.body.object_id);
  // The rejected answer left nothing behind: task, request, message and one answer.
  assert.equal(f.store.queueCeiling('owner-a'),4);
});

test('stale, withdrawn, expired and answered requests reject answers with documented codes',t=>{
  const f=setup(t);loop(f);
  assert.throws(()=>f.store.queueSubmit(f.phone.token,envelope('answer',withBody(bodies.answer,{answer_id:'late',request_revision:2})),'answer'),
    error('STALE_REQUEST'));
  assert.throws(()=>f.store.queueSubmit(f.phone.token,envelope('answer',withBody(bodies.answer,{answer_id:'second'})),'answer'),
    error('ANSWER_ALREADY_ACCEPTED'));
  const g=setup(t);
  g.store.queueSubmit(g.phone.token,envelope('task',bodies.task),'task');
  g.store.queueSubmit(g.agent.token,envelope('request',bodies.request,{producer:'pc-agent'}),'request');
  g.store.queueSubmit(g.agent.token,envelope('request',withBody(bodies.request,{revision:2,state:'withdrawn'}),{producer:'pc-agent'}),'request');
  assert.throws(()=>g.store.queueSubmit(g.phone.token,envelope('answer',bodies.answer),'answer'),error('STALE_REQUEST'));
  assert.throws(()=>g.store.queueSubmit(g.phone.token,envelope('answer',withBody(bodies.answer,{answer_id:'after-withdraw',request_revision:2})),'answer'),
    error('REQUEST_CLOSED'));
  const h=setup(t);command(h,{request:null});
  h.store.queueSubmit(h.agent.token,envelope('request',bodies.request,{producer:'pc-agent',ttl:600000}),'request');
  h.setTime(epoch+700000);
  assert.throws(()=>h.store.queueSubmit(h.phone.token,envelope('answer',withBody(bodies.answer,{answer_id:'expired'}),{now:epoch+700000}),'answer'),
    error('EXPIRED'));
  // A client may not publish the answered state; only the answer transaction sets it.
  const i=setup(t);
  i.store.queueSubmit(i.phone.token,envelope('task',bodies.task),'task');
  i.store.queueSubmit(i.agent.token,envelope('request',bodies.request,{producer:'pc-agent'}),'request');
  assert.throws(()=>i.store.queueSubmit(i.agent.token,envelope('request',withBody(bodies.request,{revision:2,state:'answered'}),{producer:'pc-agent'}),'request'),
    error('STATE_CONFLICT'));
});

test('request and answer bindings reject session, task, option and empty-answer abuse',t=>{
  const f=setup(t);command(f);
  const moved=withBody(bodies.answer,{answer_id:'moved'});
  moved.route={...moved.route,session_id:'session-elsewhere'};
  assert.throws(()=>f.store.queueSubmit(f.phone.token,envelope('answer',moved),'answer'),error('ROUTE_MISMATCH'));
  assert.throws(()=>f.store.queueSubmit(f.phone.token,envelope('answer',withBody(bodies.answer,{answer_id:'other-task',task_id:'task-other'})),'answer'),
    error('ROUTE_MISMATCH'));
  assert.throws(()=>f.store.queueSubmit(f.phone.token,envelope('answer',withBody(bodies.answer,{answer_id:'unknown-option',option_id:'C'})),'answer'),
    error('INVALID_OPTIONS'));
  assert.throws(()=>f.store.queueSubmit(f.phone.token,envelope('answer',withBody(bodies.answer,{answer_id:'empty',option_id:null,text:'   '})),'answer'),
    error('INVALID'));
  // An unknown task cannot host a request, and a request cannot move to another route.
  assert.throws(()=>f.store.queueSubmit(f.agent.token,envelope('request',withBody(bodies.request,{request_id:'r2',task_id:'missing'}),{producer:'pc-agent'}),'request'),
    error('TASK_NOT_FOUND'));
  const rerouted=withBody(bodies.request,{request_id:'r3'});
  rerouted.route={...rerouted.route,project_id:'project-other'};
  assert.throws(()=>f.store.queueSubmit(f.agent.token,envelope('request',rerouted,{producer:'pc-agent'}),'request'),error('ROUTE_MISMATCH'));
  assert.throws(()=>f.store.queueSubmit(f.agent.token,envelope('request',withBody(bodies.request,{request_id:'r4',mode:'free_text',options:[{option_id:'A',label:'A'}]}),{producer:'pc-agent'}),'request'),
    error('INVALID_OPTIONS'));
});

test('task revisions follow the documented state machine and cannot skip, regress or rebind route',t=>{
  const f=setup(t);
  f.store.queueSubmit(f.phone.token,envelope('task',withBody(bodies.task,{task_id:'t1'})),'task');
  assert.throws(()=>f.store.queueSubmit(f.phone.token,envelope('task',withBody(bodies.task,{task_id:'t1',revision:2,state:'running'})),'task'),
    error('FORBIDDEN'));
  assert.throws(()=>f.store.queueSubmit(f.agent.token,envelope('task',withBody(bodies.task,{task_id:'t1',revision:2,state:'completed'}),{producer:'pc-agent'}),'task'),
    error('STATE_CONFLICT'));
  assert.throws(()=>f.store.queueSubmit(f.agent.token,envelope('task',withBody(bodies.task,{task_id:'t1',revision:3,state:'agent_received'}),{producer:'pc-agent'}),'task'),
    error('REVISION_CONFLICT'));
  for(const [revision,state] of [[2,'agent_received'],[3,'running'],[4,'waiting_answer']])
    f.store.queueSubmit(f.agent.token,envelope('task',withBody(bodies.task,{task_id:'t1',revision,state}),{producer:'pc-agent'}),'task');
  assert.equal(f.store.queueGet(f.agent.token,'task','t1').state,'waiting_answer');
  const moved=withBody(bodies.task,{task_id:'t1',revision:5,state:'completed'});
  moved.route={...moved.route,session_id:'session-other'};
  assert.throws(()=>f.store.queueSubmit(f.agent.token,envelope('task',moved,{producer:'pc-agent'}),'task'),error('ROUTE_MISMATCH'));
  // Only the phone creates commands; the program may only advance them.
  assert.throws(()=>f.store.queueSubmit(f.agent.token,envelope('task',withBody(bodies.task,{task_id:'t9'}),{producer:'pc-agent'}),'task'),
    error('FORBIDDEN'));
});

test('queue scopes separate phone and connection program; no client may claim server_stored',t=>{
  const f=setup(t);
  assert.throws(()=>f.store.queueSubmit(f.phone.token,envelope('request',bodies.request),'request'),error('FORBIDDEN'));
  assert.throws(()=>f.store.queueSubmit(f.agent.token,envelope('answer',bodies.answer,{producer:'pc-agent'}),'answer'),error('FORBIDDEN'));
  assert.throws(()=>f.store.queueSubmit(f.agent.token,envelope('task',bodies.task,{producer:'pc-agent'}),'task'),error('FORBIDDEN'));
  assert.throws(()=>f.store.inbox(f.readonly.token),error('FORBIDDEN'));
  assert.throws(()=>f.store.queueGet(f.readonly.token,'request','request-demo'),error('FORBIDDEN'));
  assert.throws(()=>f.store.queueSubmit(f.phone.token,envelope('receipt',receiptBodies[0]),'receipt'),error('FORBIDDEN'));
  assert.throws(()=>f.store.queueSubmit(f.phone.token,envelope('message',bodies.message),'message'),error('FORBIDDEN'));
  // A wrong envelope kind or a material body never passes the queue validator.
  assert.throws(()=>f.store.queueSubmit(f.phone.token,envelope('task',bodies.request),'task'),error('INVALID'));
  const wrong=envelope('task',bodies.task);wrong.kind='request';
  assert.throws(()=>f.store.queueSubmit(f.phone.token,wrong,'task'),error('INVALID'));
});

test('receipts are append-only facts deduped by receipt_id and never roll back state',t=>{
  const f=setup(t);loop(f);
  const userAnswered=withBody(receiptBodies[2],{receipt_id:'rc-user'});
  const accepted=f.store.queueSubmit(f.phone.token,envelope('receipt',userAnswered),'receipt');
  assert.equal(accepted.status,201);
  const replay=f.store.queueSubmit(f.phone.token,envelope('receipt',userAnswered),'receipt');
  assert.equal(replay.status,200);assert.deepEqual(replay.body,accepted.body);
  const conflicting=envelope('receipt',withBody(userAnswered,{stage:'glasses_displayed',actor_id:'someone-else'}));
  assert.throws(()=>f.store.queueSubmit(f.phone.token,conflicting,'receipt'),error('IDEMPOTENCY_CONFLICT'));
  const agentStage=withBody(receiptBodies[3],{receipt_id:'rc-agent'});
  f.store.queueSubmit(f.agent.token,envelope('receipt',agentStage,{producer:'pc-agent'}),'receipt');
  const detail=f.store.queueGet(f.agent.token,'request','request-demo');
  // The ladder belongs to the answer; the request itself has no receipt yet.
  assert.deepEqual(detail.receipts,[]);
  assert.deepEqual(detail.answer.receipts.map(v=>[v.receipt_id,v.stage]),[['rc-user','user_answered'],['rc-agent','agent_received']]);
  assert.equal(detail.state,'answered');
  // A receipt for a revision that does not exist is not evidence of anything.
  assert.throws(()=>f.store.queueSubmit(f.agent.token,envelope('receipt',withBody(receiptBodies[3],{receipt_id:'rc-ghost',subject_revision:9}),{producer:'pc-agent'}),'receipt'),
    error('SUBJECT_NOT_FOUND'));
  assert.throws(()=>f.store.queueSubmit(f.phone.token,envelope('receipt',withBody(receiptBodies[2],{receipt_id:'rc-x',subject_kind:'task',subject_id:'task-missing'})),'receipt'),
    error('SUBJECT_NOT_FOUND'));
  // server_stored stays a server-owned fact: only receipts:storage may post it.
  const storage=f.store.mint({owner:'owner-a',producer:'server-internal',scopes:['receipts:storage']});
  const serverStored=withBody(receiptBodies[0],{receipt_id:'rc-storage',subject_kind:'message',subject_id:'message-demo',subject_revision:1});
  assert.equal(f.store.queueSubmit(storage.token,envelope('receipt',serverStored,{producer:'server-internal'}),'receipt').status,201);
});

test('idempotent retry returns the original queue receipt and does not advance the queue cursor',t=>{
  const f=setup(t),task=envelope('task',withBody(bodies.task,{task_id:'t1'}));
  const first=f.store.queueSubmit(f.phone.token,task,'task');
  assert.equal(first.status,201);assert.equal(first.body.receipt.stage,'server_stored');assert.equal(first.body.commit_seq,1);
  const replay=f.store.queueSubmit(f.phone.token,task,'task');
  assert.equal(replay.status,200);assert.deepEqual(replay.body,first.body);
  assert.equal(f.store.queueCeiling('owner-a'),1);
  const changed=structuredClone(task);changed.body.command='不同内容';
  assert.throws(()=>f.store.queueSubmit(f.phone.token,changed,'task'),error('IDEMPOTENCY_CONFLICT'));
  assert.equal(f.store.queueCeiling('owner-a'),1);
  const replicated=structuredClone(task);replicated.event_id=randomUUID();replicated.idempotency_key=randomUUID();
  assert.throws(()=>f.store.queueSubmit(f.phone.token,replicated,'task'),error('REVISION_CONFLICT'));
  f.restart();assert.deepEqual(f.store.event(f.phone.token,task.event_id),first.body);
});

test('inbox cursor pages revisions, resumes after new work and resets when visibility changes',t=>{
  const f=setup(t);loop(f);
  const first=f.store.inbox(f.phone.token,{limit:2});
  assert.equal(first.has_more,true);assert.deepEqual(first.items.map(v=>v.kind),['task','request']);
  const rest=f.store.inbox(f.phone.token,{limit:2,cursor:first.next_cursor});
  assert.deepEqual(rest.items.map(v=>v.kind),['message']);assert.equal(rest.has_more,false);
  f.store.queueSubmit(f.phone.token,envelope('task',withBody(bodies.task,{task_id:'task-late'})),'task');
  const tail=f.store.inbox(f.phone.token,{cursor:rest.next_cursor});
  assert.deepEqual(tail.items.map(v=>v.body.task_id),['task-late']);
  const wide=f.store.mint({owner:'owner-a',producer:'phone-narrow',scopes:['tasks:read']});
  assert.throws(()=>f.store.inbox(wide.token,{cursor:tail.next_cursor}),error('CURSOR_RESET_REQUIRED'));
  assert.deepEqual(f.store.inbox(wide.token).items.map(v=>v.kind),['task','task']);
  assert.equal(f.store.inbox(f.foreign.token).items.length,0);
  assert.throws(()=>f.store.inbox(f.phone.token,{kinds:'task'}),error('INVALID_QUERY'));
  // Queue objects never leak into the material streams or their cursors.
  assert.equal(f.store.page(f.readonly.token,'materials').items.length,0);
});

test('review: initial task cannot claim it has already run or completed',t=>{
  const f=setup(t);
  for(const state of ['running','completed','cancelled']){
    assert.throws(()=>f.store.queueSubmit(f.phone.token,envelope('task',withBody(bodies.task,{task_id:`initial-${state}`,state})),'task'),error('STATE_CONFLICT'));
  }
  assert.equal(f.store.queueCeiling('owner-a'),0);
});

test('review: answers cannot resume a task after cancellation was requested or completed',t=>{
  const f=setup(t);command(f);
  f.store.queueSubmit(f.agent.token,envelope('task',withBody(bodies.task,{revision:2,state:'cancel_requested'}),{producer:'pc-agent'}),'task');
  assert.throws(()=>f.store.queueSubmit(f.phone.token,envelope('answer',bodies.answer),'answer'),error('TASK_CLOSED'));
  f.store.queueSubmit(f.agent.token,envelope('task',withBody(bodies.task,{revision:3,state:'cancelled'}),{producer:'pc-agent'}),'task');
  assert.throws(()=>f.store.queueSubmit(f.phone.token,envelope('answer',bodies.answer),'answer'),error('TASK_CLOSED'));
  assert.equal(f.store.queueGet(f.agent.token,'request','request-demo').answer,null);
});

test('review: receipt ladders isolate subject kinds with colliding IDs and retain explicit historical revisions',t=>{
  const f=setup(t);command(f,{task:'shared-id',request:'shared-id',message:null});
  for(const kind of ['task','request']){
    const body=withBody(receiptBodies[1],{receipt_id:`rc-${kind}`,stage:'phone_received',subject_kind:kind,subject_id:'shared-id',subject_revision:1});
    f.store.queueSubmit(f.phone.token,envelope('receipt',body),'receipt');
  }
  for(const kind of ['task','request']){
    const receipts=f.store.queueGet(f.agent.token,kind,'shared-id').receipts;
    assert.deepEqual(receipts.map(value=>value.subject_kind),[kind]);
  }
  f.store.queueSubmit(f.agent.token,envelope('task',withBody(bodies.task,{task_id:'shared-id',revision:2,state:'agent_received'}),{producer:'pc-agent'}),'task');
  const updated=f.store.queueGet(f.agent.token,'task','shared-id');assert.equal(updated.revision,2);
  assert.deepEqual(updated.receipts.map(value=>[value.subject_kind,value.subject_revision]),[['task',1]]);
});

test('owner isolation and v1 to v2 migration keep materials and create the queue tables',t=>{
  const f=setup(t),material=JSON.parse(fs.readFileSync(new URL('../../../docs/contracts/material-v1.1.json',import.meta.url))).events[2];
  material.event_id=randomUUID();material.idempotency_key=randomUUID();material.producer_id='phone-app';
  material.created_at=new Date(epoch).toISOString();material.expires_at=new Date(epoch+3600000).toISOString();
  f.store.submit(f.phone.token,material);
  f.store.queueSubmit(f.phone.token,envelope('task',withBody(bodies.task,{task_id:'t1'})),'task');
  assert.throws(()=>f.store.queueGet(f.foreign.token,'task','t1'),error('TASK_NOT_FOUND'));
  assert.equal(f.store.queueCeiling('owner-b'),0);
  // Simulate a file written before the queue existed.
  f.store.db.exec('DROP TABLE queue_revisions; DROP TABLE queue_heads; DROP TABLE queue_counters; PRAGMA user_version=1;');
  f.restart();
  assert.equal(f.restart().get(f.phone.token,material.body.material_id).body.full_text.text,material.body.full_text.text);
  assert.equal(f.store.queueCeiling('owner-a'),0);
  assert.equal(f.store.queueSubmit(f.phone.token,envelope('task',withBody(bodies.task,{task_id:'t1'})),'task').status,201);
  assert.equal(f.store.get(f.phone.token,material.body.material_id).body.revision,material.body.revision);
});
