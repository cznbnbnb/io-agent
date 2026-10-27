import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {MaterialStore} from '../store.mjs';
import {listen} from '../http.mjs';

const epoch=Date.parse('2026-10-25T10:00:00.000Z');
const fixtures=JSON.parse(fs.readFileSync(new URL('../../../docs/contracts/normal.json',import.meta.url)));
const sample=kind=>structuredClone(fixtures.events.find(e=>e.kind===kind).body);
const error=code=>e=>e.code===code;
function setup(t){
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'io-task-control-')),db=path.join(directory,'store.sqlite');
  let now=epoch,store=new MaterialStore(db,{clock:()=>now});
  const phone=store.mint({owner:'synthetic-owner',producer:'synthetic-phone',scopes:['tasks:write','tasks:read','tasks:update','answers:write','requests:read']});
  const agent=store.mint({owner:'synthetic-owner',producer:'synthetic-agent',scopes:['tasks:read','tasks:update','receipts:agent','requests:write']});
  const legacy=store.mint({owner:'synthetic-owner',producer:'legacy-agent',scopes:['tasks:read','tasks:update']});
  const foreign=store.mint({owner:'foreign-owner',producer:'synthetic-phone',scopes:['tasks:read','tasks:update']});
  const route={computer_id:'synthetic-pc',agent_id:'codex',project_id:'synthetic-project',session_id:randomUUID()};
  const taskId=randomUUID();
  const f={directory,db,phone,agent,legacy,foreign,route,taskId,get store(){return store;},now:()=>now,advance:ms=>{now+=ms;},
    restart(){store.close();store=new MaterialStore(db,{clock:()=>now});},
    envelope(body,identity=phone,kind='task',ttl=3600000){return {schema_version:'1.0',event_id:randomUUID(),idempotency_key:randomUUID(),kind,
      producer_id:identity===phone?'synthetic-phone':identity===foreign?'synthetic-phone':identity===legacy?'legacy-agent':'synthetic-agent',
      created_at:new Date(now).toISOString(),expires_at:new Date(now+ttl).toISOString(),body:structuredClone(body)};},
    get(){return store.queueGet(phone.token,'task',taskId);},
    publish(patch,identity=agent){const old=f.get().body;return store.queueSubmit(identity.token,f.envelope({...old,revision:old.revision+1,...patch},identity),'task');},
    request(kind='stop',patch={}){const ex=f.get().body.execution;return {control_id:randomUUID(),kind,expected_command_id:ex.command_id,
      expected_turn_id:ex.turn_id,expires_at:new Date(now+60000).toISOString(),...(kind==='resume'?{text:'Continue with the clarified scope.'}:{}),...patch};},
    start(){store.queueSubmit(phone.token,f.envelope({task_id:taskId,revision:1,route,state:'queued',command:'Original immutable task',allow_create_session:false}),'task');},
    running(){f.start();const commandId=randomUUID();f.publish({state:'agent_received',execution:{command_id:commandId,turn_id:null,phase:'accepted'}});
      f.publish({state:'running',execution:{command_id:commandId,turn_id:'native-turn-1',phase:'running'}});return commandId;},
    stopped(){const commandId=f.running(),control=f.request();f.publish({state:'stop_requested',control},phone);
      f.publish({state:'stop_unconfirmed',execution:{command_id:commandId,turn_id:'native-turn-1',phase:'stop_unconfirmed'}});
      f.publish({state:'stopped',execution:{command_id:commandId,turn_id:'native-turn-1',phase:'stopped'}});return commandId;}
  };
  t.after(()=>{store.close();fs.rmSync(directory,{recursive:true,force:true});});return f;
}

test('HTTP stop, proven stop, and resume keep one task/session with a new exact command identity',async t=>{
  const f=setup(t);f.running();const server=await listen(f.store);t.after(()=>new Promise(resolve=>server.close(resolve)));
  const url=`http://127.0.0.1:${server.address().port}`;
  const post=async(body,identity=f.phone)=>{const r=await fetch(url+'/v1/tasks',{method:'POST',headers:{Authorization:`Bearer ${identity.token}`,'Content-Type':'application/json'},
    body:JSON.stringify(f.envelope(body,identity))});return {status:r.status,value:await r.json()};};
  const original=f.get().body,control=f.request();
  assert.equal((await post({...original,revision:4,state:'stop_requested',control})).status,201);
  f.publish({state:'stop_unconfirmed',execution:{...original.execution,phase:'stop_unconfirmed'}});
  f.publish({state:'stopped',execution:{...original.execution,phase:'stopped'}});
  const resume=f.request('resume'),stopped=f.get().body;
  assert.equal((await post({...stopped,revision:stopped.revision+1,state:'resume_requested',control:resume})).status,201);
  f.publish({state:'agent_received',execution:{command_id:resume.control_id,turn_id:null,phase:'queued'}});
  f.publish({state:'agent_received',execution:{command_id:resume.control_id,turn_id:null,phase:'accepted'}});
  f.publish({state:'running',execution:{command_id:resume.control_id,turn_id:'native-turn-2',phase:'running'}});
  f.publish({state:'completed',execution:{command_id:resume.control_id,turn_id:'native-turn-2',phase:'completed'}});
  f.restart();const final=f.get();
  assert.equal(final.state,'completed');assert.equal(final.body.command,original.command);assert.deepEqual(final.body.route,original.route);
  assert.equal(final.body.execution.command_id,resume.control_id);assert.deepEqual(final.body.control,resume);
  assert.equal(final.body.control.expected_command_id,original.execution.command_id);
  assert.equal(final.command_expires_at,new Date(epoch+3600000).toISOString());
  assert.ok(f.store.identity(f.phone.token).capabilities.includes('task_session_control_v1'));
});

test('phone may request but cannot forge execution evidence, stopped status, or strip control fields',t=>{
  const f=setup(t);f.running();const original=f.get().body;
  assert.throws(()=>f.publish({execution:{...original.execution,phase:'result_pending'}},f.phone),error('FORBIDDEN'));
  assert.throws(()=>f.publish({state:'completed',execution:{...original.execution,phase:'completed'}},f.phone),error('FORBIDDEN'));
  const stripped={...original,revision:original.revision+1};delete stripped.execution;
  assert.throws(()=>f.store.queueSubmit(f.phone.token,f.envelope(stripped),'task'),error('TASK_EXECUTION_INVALID'));
  f.publish({state:'stop_requested',control:f.request()},f.phone);
  assert.throws(()=>f.publish({state:'stopped',execution:{...original.execution,phase:'stopped'}},f.phone),error('FORBIDDEN'));
  const body=f.get().body;delete body.control;
  assert.throws(()=>f.store.queueSubmit(f.agent.token,f.envelope({...body,revision:body.revision+1,state:'stop_unconfirmed',
    execution:{...body.execution,phase:'stop_unconfirmed'}},f.agent),'task'),error('TASK_CONTROL_INVALID'));
  assert.equal(f.get().state,'stop_requested');
});

test('unknown command UUID, stale turn, mismatched phase and premature resume never map to latest execution',t=>{
  const f=setup(t);f.running();
  for(const patch of [{expected_command_id:randomUUID()},{expected_turn_id:'another-turn'}])
    assert.throws(()=>f.publish({state:'stop_requested',control:f.request('stop',patch)},f.phone),error('TASK_CONTROL_STALE'));
  assert.throws(()=>f.publish({state:'resume_requested',control:f.request('resume')},f.phone),error('STATE_CONFLICT'));
  const ex=f.get().body.execution;f.publish({state:'running',execution:{...ex,phase:'result_pending'}});
  assert.throws(()=>f.publish({state:'stop_requested',control:f.request()},f.phone),error('TASK_EXECUTION_INVALID'));
  assert.throws(()=>f.publish({state:'waiting_answer',execution:{...ex,phase:'accepted'}}),error('TASK_EXECUTION_INVALID'));
});

test('original command and route are immutable for both legacy and controlled tasks',t=>{
  for(const controlled of [false,true]){
    const f=setup(t);if(controlled)f.running();else f.start();
    const state=controlled?'waiting_answer':'agent_received';
    assert.throws(()=>f.publish({state,command:'Changed instruction'}),error('TASK_COMMAND_IMMUTABLE'));
    assert.throws(()=>f.publish({state,route:{...f.route,session_id:randomUUID()}}),error('ROUTE_MISMATCH'));
    assert.throws(()=>f.publish({state,allow_create_session:true}),error('INVALID'));
  }
});

test('resume UUID is the only new command identity and native turn cannot be rebound or cleared',t=>{
  const f=setup(t);f.stopped();const stopped=f.get().body.execution,resume=f.request('resume');
  f.publish({state:'resume_requested',control:resume},f.phone);
  for(const commandId of [stopped.command_id,randomUUID()])assert.throws(()=>f.publish({state:'agent_received',execution:{command_id:commandId,turn_id:null,phase:'queued'}}),error('TASK_EXECUTION_REBIND'));
  assert.throws(()=>f.publish({state:'agent_received',execution:{command_id:resume.control_id,turn_id:'early-turn',phase:'queued'}}),error('TASK_EXECUTION_INVALID'));
  f.publish({state:'agent_received',execution:{command_id:resume.control_id,turn_id:null,phase:'accepted'}});
  f.publish({state:'running',execution:{command_id:resume.control_id,turn_id:'resume-turn',phase:'running'}});
  assert.throws(()=>f.publish({execution:{command_id:resume.control_id,turn_id:'unrelated-turn',phase:'running'}}),error('TASK_EXECUTION_REBIND'));
  assert.throws(()=>f.publish({execution:{command_id:randomUUID(),turn_id:'resume-turn',phase:'running'}}),error('TASK_EXECUTION_REBIND'));
  assert.throws(()=>f.publish({state:'execution_unknown',execution:{command_id:resume.control_id,turn_id:null,phase:'outcome_unknown'}}),error('TASK_EXECUTION_REBIND'));
});

test('control deadlines and UTF-8 text bounds reject new commands but permit late exact stop facts',t=>{
  const f=setup(t);f.running();
  assert.throws(()=>f.publish({state:'stop_requested',control:f.request('stop',{expires_at:new Date(f.now()).toISOString()})},f.phone),error('CONTROL_EXPIRED'));
  assert.throws(()=>f.publish({state:'stop_requested',control:f.request('stop',{expires_at:new Date(f.now()+3600001).toISOString()})},f.phone),error('TASK_CONTROL_DEADLINE_INVALID'));
  assert.throws(()=>f.publish({state:'stop_requested',control:f.request('stop',{text:'not allowed'})},f.phone),error('INVALID'));
  f.publish({state:'stop_requested',control:f.request()},f.phone);f.advance(61000);
  f.publish({state:'stopped',execution:{...f.get().body.execution,phase:'stopped'}});
  for(const text of [' ','界'.repeat(10923)])assert.throws(()=>f.publish({state:'resume_requested',control:f.request('resume',{text})},f.phone),error('TASK_CONTROL_TEXT_INVALID'));
  assert.equal(f.get().state,'stopped');
});

test('HTTP competing controls CAS one revision; duplicate exact event survives restart without a second request',async t=>{
  const f=setup(t);f.running();const original=f.get().body;
  const server=await listen(f.store);t.after(()=>new Promise(resolve=>server.close(resolve)));
  const url=`http://127.0.0.1:${server.address().port}/v1/tasks`;
  const events=[0,1].map(()=>f.envelope({...original,revision:4,state:'stop_requested',control:f.request()}));
  const send=async event=>{const r=await fetch(url,{method:'POST',headers:{Authorization:`Bearer ${f.phone.token}`,'Content-Type':'application/json'},body:JSON.stringify(event)});return {status:r.status,value:await r.json()};};
  const results=await Promise.all(events.map(send));assert.deepEqual(results.map(r=>r.status).sort(),[201,409]);
  const winner=results.findIndex(r=>r.status===201),before=f.store.queueCeiling('synthetic-owner');
  assert.equal((await send(events[winner])).status,200);assert.equal(f.store.queueCeiling('synthetic-owner'),before);
  f.restart();assert.equal(f.store.queueSubmit(f.phone.token,events[winner],'task').status,200);
  assert.deepEqual(f.get().body.control,events[winner].body.control);
});

test('old agents retain legacy state protocol but cannot add execution without receipts:agent',t=>{
  const f=setup(t);f.start();f.publish({state:'agent_received'},f.legacy);f.publish({state:'running'},f.legacy);
  assert.throws(()=>f.publish({state:'waiting_answer',execution:{command_id:randomUUID(),turn_id:'legacy-turn',phase:'running'}},f.legacy),error('FORBIDDEN'));
  assert.throws(()=>f.publish({state:'stop_requested',control:{control_id:randomUUID(),kind:'stop',expected_command_id:randomUUID(),expected_turn_id:'legacy-turn',expires_at:new Date(f.now()+10000).toISOString()}},f.phone),error('TASK_EXECUTION_INVALID'));
  f.publish({state:'completed'},f.legacy);assert.equal(f.get().state,'completed');
});

test('new tasks cannot predeclare execution or control; owner and replay identities stay isolated',t=>{
  const f=setup(t),base={task_id:f.taskId,revision:1,route:f.route,state:'queued',command:'Task',allow_create_session:false};
  assert.throws(()=>f.store.queueSubmit(f.phone.token,f.envelope({...base,execution:{command_id:randomUUID(),turn_id:null,phase:'queued'}}),'task'),error('TASK_CONTROL_INVALID'));
  f.running();const ex=f.get().body.execution;
  assert.throws(()=>f.store.queueGet(f.foreign.token,'task',f.taskId),error('TASK_NOT_FOUND'));
  const task2=randomUUID(),body2={...base,task_id:task2};f.store.queueSubmit(f.phone.token,f.envelope(body2),'task');
  assert.throws(()=>f.store.queueSubmit(f.agent.token,f.envelope({...body2,revision:2,state:'agent_received',execution:{...ex,turn_id:null,phase:'queued'}},f.agent),'task'),error('TASK_EXECUTION_ID_CONFLICT'));
});

test('stop closes old unanswered question and cannot be bypassed by an answer; accepted history remains intact',t=>{
  const f=setup(t);f.running();const request={...sample('request'),task_id:f.taskId,route:f.route};
  f.store.queueSubmit(f.agent.token,f.envelope(request,f.agent,'request'),'request');
  const answer={...sample('answer'),task_id:f.taskId,route:f.route,request_id:request.request_id};
  f.publish({state:'stop_requested',control:f.request()},f.phone);
  assert.throws(()=>f.store.queueSubmit(f.phone.token,f.envelope(answer,f.phone,'answer'),'answer'),error('TASK_CLOSED'));
  const closed=f.store.reconcileRequest(f.agent.token,request.request_id,{schema_version:'1.0',request_revision:request.revision});
  assert.equal(closed.item.state,'withdrawn');assert.equal(closed.reason,'task_closed');
  assert.equal(f.get().state,'stop_requested');
  const g=setup(t);g.running();const r={...request,task_id:g.taskId,route:g.route};
  g.store.queueSubmit(g.agent.token,g.envelope(r,g.agent,'request'),'request');
  g.store.queueSubmit(g.phone.token,g.envelope({...answer,task_id:g.taskId,route:g.route},g.phone,'answer'),'answer');
  g.publish({state:'stop_requested',control:g.request()},g.phone);
  const history=g.store.reconcileRequest(g.agent.token,r.request_id,{schema_version:'1.0',request_revision:1});
  assert.equal(history.changed,false);assert.equal(history.item.state,'answered');assert.equal(history.item.answer.body.text,answer.text);
});

test('phone may end only a proven-stopped turn; end is terminal and cannot carry text or move execution',t=>{
  const f=setup(t);f.running();
  const early=f.request('end');assert.throws(()=>f.publish({state:'cancelled',control:early,execution:{...f.get().body.execution,phase:'cancelled'}},f.phone),e=>/STATE_CONFLICT|TASK_CONTROL_STALE/.test(e.code));
  const g=setup(t);g.stopped();const ex=g.get().body.execution;
  assert.throws(()=>g.publish({state:'cancelled',control:g.request('end'),execution:ex},g.phone),e=>/TASK_EXECUTION_INVALID|TASK_CONTROL_INVALID/.test(e.code));
  assert.throws(()=>g.publish({state:'cancelled',control:g.request('end'),execution:{...ex,turn_id:'other-turn',phase:'cancelled'}},g.phone),error('TASK_CONTROL_INVALID'));
  assert.throws(()=>g.publish({state:'cancelled',control:{...g.request('end'),text:'no'},execution:{...ex,phase:'cancelled'}},g.phone),e=>e.status===400||/VALIDATION|SCHEMA|INVALID/.test(e.code));
  assert.throws(()=>g.publish({state:'cancelled',control:g.request('stop'),execution:{...ex,phase:'cancelled'}},g.phone),error('TASK_CONTROL_INVALID'));
  const end=g.request('end');g.publish({state:'cancelled',control:end,execution:{...ex,phase:'cancelled'}},g.phone);
  g.restart();const final=g.get();assert.equal(final.state,'cancelled');assert.equal(final.body.execution.phase,'cancelled');assert.deepEqual(final.body.control,end);
  assert.throws(()=>g.publish({state:'resume_requested',control:g.request('resume'),execution:ex},g.phone),e=>/STATE_CONFLICT|TASK_CONTROL/.test(e.code));
});
