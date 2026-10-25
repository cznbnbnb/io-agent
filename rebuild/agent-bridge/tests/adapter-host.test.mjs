import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {MaterialStore} from '../../material-server/store.mjs';
import {listen} from '../../material-server/http.mjs';
import {AgentBridge} from '../bridge.mjs';
import {AdapterHost} from '../adapter-host.mjs';

const fixture=JSON.parse(fs.readFileSync(new URL('../../../docs/contracts/normal.json',import.meta.url)));
const bodies=Object.fromEntries(fixture.events.map(event=>[event.kind,event.body]));
const epoch=Date.parse('2026-10-12T02:00:00Z');
const fixtureAdapter=fileURLToPath(new URL('./fixtures/runtime-adapter.mjs',import.meta.url));
const withBody=(body,patch)=>({...structuredClone(body),...patch});

async function setup(t){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'io-adapter-'));let now=epoch;
  const store=new MaterialStore(path.join(dir,'adapter.sqlite'),{clock:()=>now});
  const phone=store.mint({owner:'owner-a',producer:'phone-app',scopes:['tasks:write','tasks:read','materials:read','requests:read','answers:write','messages:receive','receipts:phone']});
  const agent=store.mint({owner:'owner-a',producer:'pc-agent',scopes:['tasks:read','tasks:update','requests:write','messages:receive','messages:write','receipts:agent']});
  const server=await listen(store),identity=store.identity(agent.token);
  const credential=path.join(dir,'agent.json');fs.writeFileSync(credential,JSON.stringify(agent),{mode:0o600});
  const config={schema_version:'1.0',base_url:`http://127.0.0.1:${server.address().port}/v1/`,owner_id:identity.owner_id,
    producer_id:identity.producer_id,server_id:identity.server_id,credential_file:credential,allow_loopback_http:true,
    state_file:path.join(dir,'state.json'),computer_id:bodies.task.route.computer_id,agent_id:bodies.task.route.agent_id};
  const bridges=[];
  t.after(async()=>{for(const bridge of bridges)await bridge.stop();if(server.listening)await new Promise(resolve=>server.close(resolve));store.close();fs.rmSync(dir,{recursive:true,force:true});});
  const submit=(kind,body,producer='phone-app')=>store.queueSubmit(producer==='pc-agent'?agent.token:phone.token,
    {schema_version:'1.0',event_id:randomUUID(),idempotency_key:randomUUID(),kind,producer_id:producer,
      created_at:new Date(epoch).toISOString(),expires_at:new Date(epoch+3600000).toISOString(),body:structuredClone(body)},kind);
  return {dir,store,phone,agent,server,identity,config,submit,setTime:value=>{now=value;},
    host:(mode,options={})=>new AdapterHost({command:process.execPath,args:[fixtureAdapter,mode],timeoutMs:1500,...options}),
    bridge:(adapter,options={})=>{const bridge=new AgentBridge({config,adapter,stateFile:config.state_file,clock:()=>now,...options});bridges.push(bridge);return bridge;}};
}

test('graceful stop waits for owned adapter cleanup acknowledgement before process termination',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'io-graceful-adapter-'));
  const marker=path.join(dir,'cleaned');
  const host=new AdapterHost({command:process.execPath,args:[fixtureAdapter,'graceful',marker],timeoutMs:1500});
  t.after(async()=>{await host.stop();fs.rmSync(dir,{recursive:true,force:true});});
  await host.start();await host.stop();assert.equal(fs.readFileSync(marker,'utf8'),'cleanup-confirmed');
  assert.equal(host.capabilities.can_execute,false);
});

test('admission probe is a matched read-only protocol exchange and capability must be boolean',async t=>{
  const host=new AdapterHost({command:process.execPath,args:[fixtureAdapter,'admission-probe'],timeoutMs:1500});
  t.after(()=>host.stop());await host.start();
  assert.equal(host.capabilities.admission_probe_v1,true);
  assert.deepEqual(await host.inspectAdmission({delivery_id:'item:task:synthetic:1',source:{}}),{status:'not_proven'});
  const malformed=new AdapterHost({command:process.execPath,args:[fixtureAdapter,'bad-admission-capability'],timeoutMs:1500});
  t.after(()=>malformed.stop());await assert.rejects(malformed.start(),e=>e.code==='ADAPTER_PROTOCOL');
});

test('answer intake probe uses matched read-only frames and a boolean capability',async t=>{
  const host=new AdapterHost({command:process.execPath,args:[fixtureAdapter,'answer-intake-probe'],timeoutMs:1500});
  t.after(()=>host.stop());await host.start();assert.equal(host.capabilities.answer_intake_probe_v1,true);
  assert.deepEqual(await host.inspectAnswerIntake({delivery_id:'answer:request:1:answer',request:{},answer:{}}),{status:'not_proven'});
  const malformed=new AdapterHost({command:process.execPath,args:[fixtureAdapter,'bad-answer-intake-capability'],timeoutMs:1500});
  t.after(()=>malformed.stop());await assert.rejects(malformed.start(),e=>e.code==='ADAPTER_PROTOCOL');
});

test('control intake probe uses matched read-only frames and a boolean capability',async t=>{
  const host=new AdapterHost({command:process.execPath,args:[fixtureAdapter,'control-intake-probe'],timeoutMs:1500});
  t.after(()=>host.stop());await host.start();assert.equal(host.capabilities.control_intake_probe_v1,true);
  assert.deepEqual(await host.inspectControlIntake({delivery_id:'item:task:original:4',source:{}}),{status:'not_proven'});
  const malformed=new AdapterHost({command:process.execPath,args:[fixtureAdapter,'bad-control-intake-capability'],timeoutMs:1500});
  t.after(()=>malformed.stop());await assert.rejects(malformed.start(),e=>e.code==='ADAPTER_PROTOCOL');
});

test('a runtime adapter process drives real queue writes through the durable outbox',async t=>{
  const f=await setup(t);
  f.submit('task',withBody(bodies.task,{task_id:'task-1'}));
  const host=f.host('accept');const capabilities=await host.start();t.after(()=>host.stop());
  assert.equal(capabilities.can_execute,true);assert.equal(host.capabilities.runtime,'reference-test');
  const bridge=f.bridge(host);await bridge.start();
  const result=await bridge.pollOnce();
  assert.equal(result.pending,0);
  const task=f.store.queueGet(f.agent.token,'task','task-1');
  assert.equal(task.revision,2);assert.equal(task.state,'agent_received');
  assert.deepEqual(task.receipts.map(value=>value.stage),['agent_received']);
  assert.equal(bridge.status().adapter,'adapter');assert.equal(bridge.status().can_execute,true);
});

test('an adapter that declares it cannot execute is never allowed to write',async t=>{
  const f=await setup(t);
  f.submit('task',withBody(bodies.task,{task_id:'task-1'}));
  const host=f.host('observe');await host.start();t.after(()=>host.stop());
  const bridge=f.bridge(host);await bridge.start();
  const result=await bridge.pollOnce();
  assert.equal(result.pending,0);assert.equal(bridge.status().can_execute,false);
  const task=f.store.queueGet(f.agent.token,'task','task-1');
  assert.equal(task.revision,1);assert.deepEqual(task.receipts,[]);
});

test('a silent adapter is a timeout, a crashed one exits, and neither writes anything',async t=>{
  const f=await setup(t);
  f.submit('task',withBody(bodies.task,{task_id:'task-1'}));
  const silent=f.host('silent');await silent.start();t.after(()=>silent.stop());
  const bridge=f.bridge(silent);await bridge.start();
  await assert.rejects(bridge.pollOnce(),error=>error.code==='ADAPTER_TIMEOUT'&&error.permanent);
  assert.equal(f.store.queueGet(f.agent.token,'task','task-1').revision,1);
  assert.equal(bridge.status().pending,0);
  await bridge.stop();
  const crashed=f.host('crash');await crashed.start();t.after(()=>crashed.stop());
  const uncertain=f.bridge(crashed);await uncertain.start();
  await assert.rejects(uncertain.pollOnce(),error=>error.code==='DISPATCH_UNCERTAIN');
  await uncertain.stop();
  const second=f.bridge(crashed,{stateFile:path.join(f.dir,'independent-crash-state.json'),clock:()=>epoch});await second.start();
  await assert.rejects(second.pollOnce(),error=>['ADAPTER_EXITED','ADAPTER_PROTOCOL'].includes(error.code));
  assert.equal(f.store.queueGet(f.agent.token,'task','task-1').revision,1);
});

test('a protocol-violating adapter stops the program instead of guessing intent',async t=>{
  const f=await setup(t);
  f.submit('task',withBody(bodies.task,{task_id:'task-1'}));
  const host=f.host('garbage');await host.start();t.after(()=>host.stop());
  const bridge=f.bridge(host);await bridge.start();
  await assert.rejects(bridge.pollOnce(),error=>error.code==='ADAPTER_PROTOCOL'&&error.permanent);
  assert.equal(f.store.queueGet(f.agent.token,'task','task-1').revision,1);
});

test('an adapter action the contract forbids is rejected before any write',async t=>{
  const f=await setup(t);
  f.submit('task',withBody(bodies.task,{task_id:'task-1'}));
  const host=f.host('accept');await host.start();t.after(()=>host.stop());
  // The adapter may only report Agent-side stages; server_stored stays server-owned.
  const original=host.onItem.bind(host);
  host.onItem=async item=>(await original(item)).map(action=>action.action==='receipt'?{...action,stage:'server_stored'}:action);
  const bridge=f.bridge(host);await bridge.start();
  await assert.rejects(bridge.pollOnce(),error=>error.code==='BRIDGE_ACTION_INVALID'&&error.permanent);
  assert.equal(f.store.queueGet(f.agent.token,'task','task-1').revision,1);
  assert.equal(bridge.status().pending,0);
});

test('stopping the adapter leaves no half-written effect on the queue',async t=>{
  const f=await setup(t);
  f.submit('task',withBody(bodies.task,{task_id:'task-1'}));
  const host=f.host('accept');await host.start();
  const childPid=host.capabilities.child_pid;assert.equal(Number.isSafeInteger(childPid),true);
  const bridge=f.bridge(host);await bridge.start();
  await bridge.pollOnce();
  await host.stop();
  assert.throws(()=>process.kill(childPid,0),error=>error.code==='ESRCH');
  const task=f.store.queueGet(f.agent.token,'task','task-1');
  assert.equal(task.revision,2);assert.equal(task.receipts.length,1);
  await assert.rejects(bridge.pollOnce(),error=>['ADAPTER_EXITED','NETWORK_UNAVAILABLE'].includes(error.code));
});

test('protocol failure remains fatal and refuses further work before a fresh process',async t=>{
  const host=new AdapterHost({command:process.execPath,args:[fixtureAdapter,'garbage-once'],timeoutMs:1500});
  t.after(()=>host.stop());await host.start();
  await assert.rejects(host.onItem({kind:'message'}),error=>error.code==='ADAPTER_PROTOCOL');
  assert.equal(host.capabilities.can_execute,false);assert.equal(host.capabilities.unavailable,true);
  await assert.rejects(host.onItem({kind:'message'}),error=>error.code==='ADAPTER_PROTOCOL');
  await assert.rejects(host.start(),error=>error.code==='ADAPTER_PROTOCOL');
  await host.stop();
  const renewed=await host.start();assert.equal(renewed.can_execute,true);
});

test('a valid action reply followed by malformed output is not returned as success',async t=>{
  const host=new AdapterHost({command:process.execPath,args:[fixtureAdapter,'valid-then-garbage'],timeoutMs:1500});
  t.after(()=>host.stop());await host.start();
  await assert.rejects(host.onItem({kind:'message'}),error=>error.code==='ADAPTER_PROTOCOL');
  assert.equal(host.capabilities.can_execute,false);
});

test('unknown response identities and missing action sets fail closed',async t=>{
  for(const mode of ['unknown-id','missing-actions']){
    const host=new AdapterHost({command:process.execPath,args:[fixtureAdapter,mode],timeoutMs:1500});
    t.after(()=>host.stop());await host.start();
    await assert.rejects(host.onItem({kind:'message'}),error=>error.code==='ADAPTER_PROTOCOL');
    assert.equal(host.capabilities.can_execute,false);
    await assert.rejects(host.onAnswer({request:{},answer:{}}),error=>error.code==='ADAPTER_PROTOCOL');
    await host.stop();
  }
});

test('a real adapter child polls delayed questions and confirms durable intake before receiving the answer',async t=>{
  const f=await setup(t),host=f.host('async');
  f.submit('task',withBody(bodies.task,{task_id:'task-async-child'}));
  const bridge=f.bridge(host);await bridge.start();await bridge.pollOnce();
  const request=f.store.queueGet(f.agent.token,'request','request-task-async-child');
  assert.equal(request.body.task_id,'task-async-child');assert.equal(request.body.runtime_request_id,'synthetic-wait-id');
  assert.deepEqual(request.body.route,bodies.task.route);
  assert.deepEqual(await host.pollEvents(),[]);
  f.submit('answer',withBody(bodies.answer,{answer_id:'answer-async-child',request_id:request.object_id,task_id:'task-async-child'}));
  await bridge.pollOnce();
  assert.equal(f.store.queueGet(f.agent.token,'task','task-async-child').state,'completed');
  assert.equal(Object.keys(bridge.state.value.runtime_events).length,2);
  assert.deepEqual(await host.pollEvents(),[]);
});
