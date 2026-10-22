import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {MaterialStore} from '../../material-server/store.mjs';
import {listen} from '../../material-server/http.mjs';
import {AgentBridge} from '../bridge.mjs';
import {BridgeError} from '../client.mjs';
import {runtimeDigest,runtimeSource,runtimeAnswer} from '../runtime-events.mjs';

const fixture=JSON.parse(fs.readFileSync(new URL('../../../docs/contracts/normal.json',import.meta.url)));
const bodies=Object.fromEntries(fixture.events.map(event=>[event.kind,event.body]));
const epoch=Date.parse('2026-10-12T01:00:00Z');
const phoneScopes=['materials:read','materials:write','tasks:write','tasks:read','requests:read','answers:write','messages:receive','receipts:phone'];
const agentScopes=['tasks:read','tasks:update','requests:write','messages:receive','messages:write','receipts:agent'];
const withBody=(body,patch)=>({...structuredClone(body),...patch});
const envelope=(kind,body,{producer='phone-app',now=epoch}={})=>({schema_version:'1.0',event_id:randomUUID(),
  idempotency_key:randomUUID(),kind,producer_id:producer,created_at:new Date(now).toISOString(),
  expires_at:new Date(now+3600000).toISOString(),body:structuredClone(body)});

async function setup(t,{agentScopePatch=null}={}){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'io-bridge-'));let now=epoch;
  const store=new MaterialStore(path.join(dir,'bridge.sqlite'),{clock:()=>now});
  const phone=store.mint({owner:'owner-a',producer:'phone-app',scopes:phoneScopes});
  const agent=store.mint({owner:'owner-a',producer:'pc-agent',scopes:agentScopePatch??agentScopes});
  const server=await listen(store),identity=store.identity(agent.token);
  const credential=path.join(dir,'agent.json');fs.writeFileSync(credential,JSON.stringify(agent),{mode:0o600});
  const stateFile=path.join(dir,'state.json');
  const config={schema_version:'1.0',base_url:`http://127.0.0.1:${server.address().port}/v1/`,owner_id:identity.owner_id,
    producer_id:identity.producer_id,server_id:identity.server_id,credential_file:credential,allow_loopback_http:true,state_file:stateFile,
    computer_id:bodies.task.route.computer_id,agent_id:bodies.task.route.agent_id};
  const bridges=[];
  t.after(async()=>{for(const bridge of bridges)await bridge.stop();if(server.listening)await new Promise(resolve=>server.close(resolve));store.close();fs.rmSync(dir,{recursive:true,force:true});});
  return {dir,store,phone,agent,server,identity,config,stateFile,credential,port:server.address().port,
    bridge:(adapter,options={})=>{const bridge=new AgentBridge({config,adapter,stateFile,clock:()=>now,...options});bridges.push(bridge);return bridge;},
    setTime:value=>{now=value;},
    async restart(){await new Promise(resolve=>server.close(resolve));await new Promise(resolve=>server.listen(this.port,'127.0.0.1',resolve));}};
}
const observeOnly={name:'observe',capabilities:{can_execute:false},onItem:()=>[],onAnswer:()=>[]};
const submit=(f,kind,body,producer='phone-app',token=null)=>f.store.queueSubmit(token??(producer==='pc-agent'?f.agent.token:f.phone.token),
  envelope(kind,body,{producer}),kind);

test('server-confirmed deadline closes original runtime wait across bridge restart without an answer',async t=>{
  const f=await setup(t),closed=[];
  const adapter={name:'lifecycle',capabilities:{can_execute:true},onItem:item=>item.kind==='task'?[{
    action:'request',request_id:'request-expiring',mode:'free_text',question:'Synthetic deadline',
    expires_at:new Date(epoch+60000).toISOString()}]:[],onAnswer:()=>{throw new Error('NO_ANSWER_EXPECTED');},
    onRequestClosed:({request})=>{closed.push(request);return [];}};
  submit(f,'task',withBody(bodies.task,{task_id:'task-expiring'}));let bridge=f.bridge(adapter);
  await bridge.start();await bridge.pollOnce();assert.equal(Object.keys(bridge.state.requests()).length,1);
  await bridge.stop();f.setTime(epoch+60001);bridge=f.bridge(adapter);await bridge.start();await bridge.pollOnce();
  assert.equal(closed.length,1);assert.equal(closed[0].state,'expired');assert.equal(closed[0].revision,1);
  assert.equal(Object.keys(bridge.state.requests()).length,0);await bridge.pollOnce();assert.equal(closed.length,1);
  assert.equal(f.store.queueGet(f.agent.token,'task','task-expiring').state,'queued');
});

test('cancel request withdraws pending runtime question but never reports task cancelled',async t=>{
  const f=await setup(t),closed=[];
  const adapter={name:'withdraw',capabilities:{can_execute:true},onItem:item=>item.kind==='task'&&item.state==='queued'?[{
    action:'request',request_id:'request-withdraw',mode:'free_text',question:'Synthetic pending'}]:[],onAnswer:()=>[],
    onRequestClosed:({request})=>{closed.push(request);return [];}};
  submit(f,'task',withBody(bodies.task,{task_id:'task-withdraw'}));const bridge=f.bridge(adapter);
  await bridge.start();await bridge.pollOnce();
  submit(f,'task',withBody(bodies.task,{task_id:'task-withdraw',revision:2,state:'cancel_requested'}),'pc-agent');
  await bridge.pollOnce();assert.equal(closed.length,1);assert.equal(closed[0].state,'withdrawn');
  assert.equal(f.store.queueGet(f.agent.token,'task','task-withdraw').state,'cancel_requested');
  assert.equal(Object.keys(bridge.state.requests()).length,0);
});

test('lost lifecycle reply preserves the waiter and retries the same question after restart without duplicate closure',async t=>{
  const f=await setup(t),closed=[],attempts=[];let drop=false;
  const fetchImpl=async(url,options)=>{
    const lifecycle=options.method==='POST'&&url.pathname.endsWith('/reconcile');
    if(lifecycle)attempts.push(options.body);
    const response=await fetch(url,options);
    if(lifecycle&&drop){drop=false;await response.arrayBuffer();throw new Error('SYNTHETIC_COMMITTED_REPLY_LOST');}
    return response;
  };
  const adapter={name:'lost-lifecycle',capabilities:{can_execute:true},onItem:item=>item.kind==='task'?[{
    action:'request',request_id:'request-lost-close',mode:'free_text',question:'Synthetic deadline',
    expires_at:new Date(epoch+60000).toISOString()}]:[],onAnswer:()=>{throw new Error('NO_ANSWER_EXPECTED');},
    onRequestClosed:({request})=>{closed.push(request);return [];}};
  submit(f,'task',withBody(bodies.task,{task_id:'task-lost-close'}));let bridge=f.bridge(adapter,{fetchImpl});
  await bridge.start();await bridge.pollOnce();const cursor=bridge.status().cursor;drop=true;f.setTime(epoch+60000);
  await assert.rejects(bridge.pollOnce(),e=>e.code==='NETWORK_UNAVAILABLE'&&e.retryable);
  const committed=f.store.queueGet(f.agent.token,'request','request-lost-close');
  assert.equal(committed.state,'expired');assert.equal(committed.receipts.length,1);assert.equal(closed.length,0);
  assert.equal(bridge.status().cursor,cursor);assert.equal(Object.keys(bridge.state.requests()).length,1);
  await bridge.stop();bridge=f.bridge(adapter,{fetchImpl});await bridge.start();await bridge.pollOnce();await bridge.pollOnce();
  assert.equal(closed.length,1);assert.equal(closed[0].event_id,committed.event_id);assert.equal(closed[0].revision,1);
  assert.equal(Object.keys(bridge.state.requests()).length,0);
  assert(attempts.length>=3);assert(attempts.every(value=>value===attempts[0]));
  assert.equal(f.store.queueGet(f.agent.token,'request','request-lost-close').receipts.length,1);
});

test('lifecycle uses server deadline despite an advanced computer clock',async t=>{
  const f=await setup(t),closed=[];let clientNow=epoch;
  const adapter={name:'clock-skew',capabilities:{can_execute:true},onItem:item=>item.kind==='task'?[{
    action:'request',request_id:'request-server-clock',mode:'free_text',question:'Synthetic server clock',
    expires_at:new Date(epoch+60000).toISOString()}]:[],onAnswer:()=>[],
    onRequestClosed:({request})=>{closed.push(request);return [];}};
  submit(f,'task',withBody(bodies.task,{task_id:'task-server-clock'}));const bridge=f.bridge(adapter,{clock:()=>clientNow});
  await bridge.start();await bridge.pollOnce();clientNow=epoch+120000;await bridge.pollOnce();
  assert.equal(closed.length,0);assert.equal(f.store.queueGet(f.agent.token,'request','request-server-clock').state,'pending');
  f.setTime(epoch+60000);await bridge.pollOnce();assert.equal(closed.length,1);assert.equal(closed[0].state,'expired');
});

test('legacy server without lifecycle capability is read only during request polling',async t=>{
  const f=await setup(t),identity=f.store.identity.bind(f.store);let lifecycleCalls=0;const answers=[];
  f.store.identity=token=>{const value=identity(token);delete value.capabilities;return value;};
  const fetchImpl=async(url,options)=>{if(url.pathname.endsWith('/reconcile')){lifecycleCalls++;throw new Error('UNSUPPORTED_LEGACY_ENDPOINT');}return fetch(url,options);};
  const adapter={name:'legacy-question',capabilities:{can_execute:true},onItem:item=>item.kind==='task'?[{
    action:'request',request_id:'request-legacy',mode:'free_text',question:'Synthetic legacy'}]:[],onAnswer:value=>{answers.push(value);return [];}};
  submit(f,'task',withBody(bodies.task,{task_id:'task-legacy'}));const bridge=f.bridge(adapter,{fetchImpl});
  await bridge.start();await bridge.pollOnce();
  submit(f,'answer',withBody(bodies.answer,{answer_id:'answer-legacy',request_id:'request-legacy',task_id:'task-legacy',option_id:null}));
  await bridge.pollOnce();await bridge.pollOnce();assert.equal(answers.length,1);assert.equal(lifecycleCalls,0);
});

test('contradictory lifecycle response stops without erasing the waiting question',async t=>{
  const f=await setup(t);let corrupt=false;
  const fetchImpl=async(url,options)=>{
    const response=await fetch(url,options);
    if(corrupt&&url.pathname.endsWith('/reconcile')){
      const value=await response.json();value.changed=true;value.reason='deadline';value.item.state='withdrawn';
      return new Response(JSON.stringify(value),{status:200,headers:{'Content-Type':'application/json'}});
    }
    return response;
  };
  const adapter={name:'contradictory-lifecycle',capabilities:{can_execute:true},onItem:item=>item.kind==='task'?[{
    action:'request',request_id:'request-contradictory',mode:'free_text',question:'Synthetic response guard'}]:[],onAnswer:()=>[],
    onRequestClosed:()=>{throw new Error('UNTRUSTED_CLOSURE_DELIVERED');}};
  submit(f,'task',withBody(bodies.task,{task_id:'task-contradictory'}));const bridge=f.bridge(adapter,{fetchImpl});
  await bridge.start();await bridge.pollOnce();corrupt=true;
  await assert.rejects(bridge.pollOnce(),e=>e.code==='INVALID_RESPONSE'&&e.permanent);
  assert.equal(Object.keys(bridge.state.requests()).length,1);
  assert.equal(f.store.queueGet(f.agent.token,'request','request-contradictory').state,'pending');
});

function asynchronousRuntime(){
  const runtime={name:'synthetic-async',capabilities:{can_execute:true,async_events:true},
    events:[],deliveries:[],answers:[],acks:[],
    onItem(item,context){this.deliveries.push({item:structuredClone(item),...context});return [];},
    onAnswer(value,context){this.answers.push({...structuredClone(value),...context});return [];},
    pollEvents(){return structuredClone(this.events);},
    acknowledgeEvents(ids){this.acks.push(ids);this.events=this.events.filter(event=>!ids.includes(event.event_id));}};
  return runtime;
}

test('delayed runtime question is polled without blocking intake and its answer returns to that task',async t=>{
  const f=await setup(t),runtime=asynchronousRuntime();
  submit(f,'task',withBody(bodies.task,{task_id:'task-async'}));
  const bridge=f.bridge(runtime);await bridge.start();await bridge.pollOnce();
  assert.equal(runtime.deliveries.length,1);assert.equal(runtime.answers.length,0);
  const delivery=runtime.deliveries[0];
  assert.equal(delivery.item.expires_at,new Date(epoch+3600000).toISOString());
  assert.equal(delivery.item.command_expires_at,new Date(epoch+3600000).toISOString());
  const admitted=Object.values(bridge.state.value.runtime_sources).find(value=>value.object_id==='task-async');
  assert.equal(admitted?.command_expires_at,delivery.item.command_expires_at);
  runtime.events=[{event_id:'async-question-1',delivery_id:delivery.delivery_id,actions:[{
    action:'request',request_id:'request-async',runtime_request_id:'synthetic-runtime-wait-1',
    mode:'choice',question:'合成异步问题',options:[{option_id:'A',label:'A'},{option_id:'B',label:'B'}]}]}];
  await bridge.pollOnce();
  const request=f.store.queueGet(f.agent.token,'request','request-async');
  assert.equal(request.body.task_id,'task-async');assert.deepEqual(request.body.route,delivery.item.body.route);
  assert.deepEqual(runtime.acks,[['async-question-1']]);
  submit(f,'answer',withBody(bodies.answer,{answer_id:'answer-async',request_id:'request-async',task_id:'task-async'}));
  await bridge.pollOnce();
  assert.equal(runtime.answers.length,1);assert.equal(runtime.answers[0].request.body.runtime_request_id,'synthetic-runtime-wait-1');
  assert.equal(runtime.answers[0].request.body.task_id,'task-async');
  assert.deepEqual(runtime.answers[0].answer.body.route,delivery.item.body.route);
});

test('lost runtime event acknowledgement replays after bridge restart without duplicate effects',async t=>{
  const f=await setup(t),runtime=asynchronousRuntime();
  submit(f,'task',withBody(bodies.task,{task_id:'task-async'}));
  const bridge=f.bridge(runtime);await bridge.start();await bridge.pollOnce();
  const event={event_id:'async-state-1',delivery_id:runtime.deliveries[0].delivery_id,actions:[{action:'task_state',state:'agent_received'}]};
  runtime.events=[event];
  runtime.acknowledgeEvents=()=>{throw new BridgeError('SYNTHETIC_ACK_LOST',{retryable:true});};
  await assert.rejects(bridge.pollOnce(),error=>error.code==='SYNTHETIC_ACK_LOST');
  assert.equal(Object.keys(bridge.state.value.runtime_events).length,1);
  assert.equal(Object.keys(bridge.state.outbox()).length,1);
  await bridge.stop();
  let acks=0;runtime.acknowledgeEvents=()=>{acks++;runtime.events=[];};
  const restarted=f.bridge(runtime);await restarted.start();await restarted.pollOnce();
  assert.equal(acks,1);assert.equal(f.store.queueGet(f.agent.token,'task','task-async').revision,2);
  assert.equal(Object.keys(restarted.state.value.runtime_events).length,1);
  assert.equal(restarted.status().pending,0);
});

test('reused runtime event id with different actions is rejected and never acknowledged',async t=>{
  const f=await setup(t),runtime=asynchronousRuntime();submit(f,'task',withBody(bodies.task,{task_id:'task-async'}));
  const bridge=f.bridge(runtime);await bridge.start();await bridge.pollOnce();
  const event={event_id:'stable-runtime-event',delivery_id:runtime.deliveries[0].delivery_id,actions:[]};
  runtime.events=[event];await bridge.pollOnce();
  runtime.events=[{...event,actions:[{action:'task_state',state:'agent_received'}]}];
  await assert.rejects(bridge.pollOnce(),error=>error.code==='RUNTIME_EVENT_CONFLICT');
  assert.equal(runtime.acks.length,1);assert.equal(f.store.queueGet(f.agent.token,'task','task-async').revision,1);
});

test('unknown runtime delivery source prevents the entire batch from producing effects',async t=>{
  const f=await setup(t),runtime=asynchronousRuntime();submit(f,'task',withBody(bodies.task,{task_id:'task-async'}));
  const bridge=f.bridge(runtime);await bridge.start();await bridge.pollOnce();
  runtime.events=[
    {event_id:'valid-origin',delivery_id:runtime.deliveries[0].delivery_id,actions:[{action:'task_state',state:'agent_received'}]},
    {event_id:'unknown-origin',delivery_id:'item:task:some-other-task:1',actions:[]}];
  await assert.rejects(bridge.pollOnce(),error=>error.code==='RUNTIME_SOURCE_UNKNOWN');
  assert.equal(runtime.acks.length,0);assert.equal(bridge.status().pending,0);
  assert.equal(f.store.queueGet(f.agent.token,'task','task-async').revision,1);
});

test('runtime events cannot report receipts for another task',async t=>{
  const f=await setup(t),runtime=asynchronousRuntime();submit(f,'task',withBody(bodies.task,{task_id:'task-async'}));
  const bridge=f.bridge(runtime);await bridge.start();await bridge.pollOnce();
  runtime.events=[{event_id:'foreign-receipt',delivery_id:runtime.deliveries[0].delivery_id,actions:[{
    action:'receipt',stage:'task_completed',subject_kind:'task',subject_id:'another-task',subject_revision:1}]}];
  await assert.rejects(bridge.pollOnce(),error=>error.code==='ROUTE_MISMATCH');
  assert.equal(bridge.status().pending,0);assert.equal(runtime.acks.length,0);
});

test('late runtime events for a cancelled task are retained without publishing new questions',async t=>{
  const f=await setup(t),runtime=asynchronousRuntime();submit(f,'task',withBody(bodies.task,{task_id:'task-async'}));
  const bridge=f.bridge(runtime);await bridge.start();await bridge.pollOnce();
  submit(f,'task',withBody(bodies.task,{task_id:'task-async',revision:2,state:'cancel_requested'}),'pc-agent');
  submit(f,'task',withBody(bodies.task,{task_id:'task-async',revision:3,state:'cancelled'}),'pc-agent');
  runtime.events=[{event_id:'late-question',delivery_id:runtime.deliveries[0].delivery_id,actions:[{
    action:'request',mode:'free_text',question:'合成迟到问题'}]}];
  await assert.rejects(bridge.pollOnce(),error=>error.code==='RUNTIME_SOURCE_CLOSED');
  assert.equal(runtime.events.length,1);assert.equal(runtime.acks.length,0);
  assert.equal(Object.keys(bridge.state.requests()).length,0);
});

test('result messages inherit the durable source route and lost acknowledgement never duplicates them',async t=>{
  const f=await setup(t),runtime=asynchronousRuntime();submit(f,'task',withBody(bodies.task,{task_id:'task-result'}));
  const bridge=f.bridge(runtime);await bridge.start();await bridge.pollOnce();
  runtime.events=[{event_id:'native-result',delivery_id:runtime.deliveries[0].delivery_id,actions:[{
    action:'message',message_id:'result-one',channel:'result',text:'Synthetic native result'}]}];
  runtime.acknowledgeEvents=()=>{throw new BridgeError('SYNTHETIC_ACK_LOST',{retryable:true});};
  await assert.rejects(bridge.pollOnce(),error=>error.code==='SYNTHETIC_ACK_LOST');
  runtime.acknowledgeEvents=()=>{runtime.events=[];};await bridge.pollOnce();await bridge.pollOnce();
  const message=f.store.queueGet(f.phone.token,'message','result-one');
  assert.equal(message.body.task_id,'task-result');assert.deepEqual(message.body.route,bodies.task.route);
  assert.equal(message.revision,1);assert.equal(message.body.text,'Synthetic native result');
});

test('an adapter cannot supply another route or task for a result message',async t=>{
  const f=await setup(t),runtime=asynchronousRuntime();submit(f,'task',withBody(bodies.task,{task_id:'task-result'}));
  const bridge=f.bridge(runtime);await bridge.start();await bridge.pollOnce();
  for(const injected of [{route:{session_id:'other'}},{task_id:'other'}]){
    runtime.events=[{event_id:'foreign-result',delivery_id:runtime.deliveries[0].delivery_id,actions:[{
      action:'message',message_id:'result-foreign',channel:'result',text:'Synthetic',...injected}]}];
    await assert.rejects(bridge.pollOnce(),error=>error.code==='BRIDGE_ACTION_INVALID');
    assert.equal(bridge.status().pending,0);assert.equal(runtime.acks.length,0);
  }
});

test('cancel request discards unpublished stale progress and questions but accepts confirmed cancellation',async t=>{
  const f=await setup(t),runtime=asynchronousRuntime();submit(f,'task',withBody(bodies.task,{task_id:'task-cancel'}));
  const bridge=f.bridge(runtime);await bridge.start();await bridge.pollOnce();
  submit(f,'task',withBody(bodies.task,{task_id:'task-cancel',revision:2,state:'cancel_requested'}),'pc-agent');
  runtime.events=[{event_id:'stale-progress',delivery_id:runtime.deliveries[0].delivery_id,actions:[
    {action:'task_state',state:'running'},{action:'request',mode:'free_text',question:'Synthetic stale question'}]}];
  await bridge.pollOnce();assert.equal(f.store.queueGet(f.agent.token,'task','task-cancel').state,'cancel_requested');
  assert.equal(Object.keys(bridge.state.requests()).length,0);assert.equal(runtime.acks.length,1);
  runtime.events=[{event_id:'cancel-confirmed',delivery_id:runtime.deliveries[0].delivery_id,actions:[{action:'task_state',state:'cancelled'}]}];
  await bridge.pollOnce();assert.equal(f.store.queueGet(f.agent.token,'task','task-cancel').state,'cancelled');
});

test('observe-only runtimes cannot consume asynchronous events',async t=>{
  const f=await setup(t),runtime=asynchronousRuntime();runtime.capabilities.can_execute=false;
  runtime.pollEvents=()=>{throw new Error('must not poll');};
  const bridge=f.bridge(runtime);await bridge.start();await bridge.pollOnce();
  assert.equal(runtime.acks.length,0);assert.equal(bridge.status().cursor,null);
});

test('invalid or duplicate asynchronous batch identities are refused before any effects',async t=>{
  const f=await setup(t),runtime=asynchronousRuntime();submit(f,'task',withBody(bodies.task,{task_id:'task-async'}));
  const bridge=f.bridge(runtime);await bridge.start();await bridge.pollOnce();
  const event={event_id:'duplicate',delivery_id:runtime.deliveries[0].delivery_id,actions:[{action:'task_state',state:'agent_received'}]};
  for(const batch of [[event,event],[{...event,event_id:'bad id'}],Array.from({length:21},(_,index)=>({...event,event_id:`large-${index}`}))]){
    runtime.events=batch;await assert.rejects(bridge.pollOnce(),error=>error.code==='RUNTIME_EVENT_INVALID');
    assert.equal(bridge.status().pending,0);assert.equal(runtime.acks.length,0);
  }
  assert.equal(f.store.queueGet(f.agent.token,'task','task-async').revision,1);
});

test('preflight binds the registered identity and required scopes before any queue work',async t=>{
  const f=await setup(t);
  const wrongServer=f.bridge(observeOnly,{config:{...f.config,server_id:'other-server'}});
  await assert.rejects(wrongServer.start(),error=>error.code==='IDENTITY_MISMATCH'&&error.permanent);
  assert.equal(wrongServer.status().started,false);
  const narrow=await setup(t,{agentScopePatch:['tasks:read','messages:receive']});
  await assert.rejects(narrow.bridge(observeOnly).start(),error=>error.code==='SCOPE_MISSING'&&
    error.detail.includes('tasks:update')&&error.detail.includes('receipts:agent'));
  const good=await setup(t);
  const status=await good.bridge(observeOnly).start();
  assert.equal(status.started,true);assert.equal(status.server_id,good.identity.server_id);
  assert.equal(status.pending,0);assert.equal(status.blocked,null);
});

test('observe-only adapter never writes or consumes executable work: tasks stay queued and cursor unchanged',async t=>{
  const f=await setup(t);
  submit(f,'task',withBody(bodies.task,{task_id:'task-1'}));
  const bridge=f.bridge(observeOnly);await bridge.start();
  const first=await bridge.pollOnce();
  assert.equal(first.items,1);assert.equal(first.handled,0);assert.equal(first.pending,0);
  assert.equal(f.store.queueGet(f.agent.token,'task','task-1').state,'queued');
  assert.deepEqual(f.store.queueGet(f.agent.token,'task','task-1').receipts,[]);
  assert.equal(bridge.status().can_execute,false);assert.equal(bridge.status().observed_tasks,1);
  const second=await bridge.pollOnce();
  assert.equal(second.items,1);assert.equal(second.handled,0);assert.equal(bridge.status().cursor,null);
});

test('accepted task state and receipt are durable and are not replayed after a restart',async t=>{
  const f=await setup(t);
  submit(f,'task',withBody(bodies.task,{task_id:'task-1'}));
  const adapter={name:'accept',capabilities:{can_execute:true},
    onItem:item=>item.kind==='task'&&item.state==='queued'?[
      {action:'task_state',state:'agent_received'},
      {action:'receipt',stage:'agent_received',subject_kind:'task',subject_id:item.object_id,subject_revision:item.revision}]:[],
    onAnswer:()=>[]};
  const bridge=f.bridge(adapter);await bridge.start();
  const result=await bridge.pollOnce();
  assert.equal(result.pending,0);
  const task=f.store.queueGet(f.agent.token,'task','task-1');
  assert.equal(task.revision,2);assert.equal(task.state,'agent_received');
  assert.deepEqual(task.receipts.map(value=>value.stage),['agent_received']);
  assert.equal(task.receipts[0].subject_revision,1);
  await bridge.stop();const restarted=f.bridge(adapter);await restarted.start();
  // The program sees its own new revision once; the adapter does nothing with it,
  // so the task must not advance again.
  const again=await restarted.pollOnce();
  assert.equal(again.items,1);assert.equal(again.handled,1);assert.equal(again.pending,0);
  assert.equal(f.store.queueGet(f.agent.token,'task','task-1').revision,2);
  assert.equal((await restarted.pollOnce()).items,0);
  assert.equal(f.store.queueCeiling('owner-a'),3);
});

test('a retryable failure keeps the persisted envelope and resends identical bytes',async t=>{
  const f=await setup(t);
  submit(f,'task',withBody(bodies.task,{task_id:'task-1'}));
  let failing=true,seen=[];
  const proxy=await stub(t,async(req,res,inspect)=>{
    if(req.method!=='POST')return forward(f,req,res,inspect.body);
    seen.push(inspect.body);
    if(failing){failing=false;res.writeHead(503,{'content-type':'application/json'});
      return res.end(JSON.stringify({schema_version:'1.0',error:{code:'UNAVAILABLE',retryable:true,retry_after_ms:1}}));}
    return forward(f,req,res,inspect.body);
  });
  const adapter={name:'accept',capabilities:{can_execute:true},onItem:()=>[{action:'task_state',state:'agent_received'}],onAnswer:()=>[]};
  const bridge=f.bridge(adapter,{config:{...f.config,base_url:`http://127.0.0.1:${proxy.address().port}/v1/`}});
  await bridge.start();
  await bridge.pollOnce();
  assert.equal(seen.length,1);assert.equal(bridge.status().pending,1);
  const first=JSON.stringify(bridge.state.pending(Object.keys(bridge.state.outbox())[0]).event);
  f.setTime(epoch+60000);
  await bridge.pollOnce();
  assert.equal(seen.length,2);assert.equal(seen[0],seen[1]);assert.equal(first,seen[1]);
  assert.equal(bridge.status().pending,0);
  assert.equal(f.store.queueGet(f.agent.token,'task','task-1').state,'agent_received');
});

test('a lost reply is reconciled by event id and never re-executed',async t=>{
  const f=await setup(t);
  submit(f,'task',withBody(bodies.task,{task_id:'task-1'}));
  const proxy=await stub(t,async(req,res,inspect)=>{
    if(req.method!=='POST')return forward(f,req,res,inspect.body);
    await forward(f,req,res,inspect.body);
    res.socket.destroy();
  });
  const adapter={name:'accept',capabilities:{can_execute:true},onItem:()=>[{action:'task_state',state:'agent_received'}],onAnswer:()=>[]};
  const bridge=f.bridge(adapter,{config:{...f.config,base_url:`http://127.0.0.1:${proxy.address().port}/v1/`}});
  await bridge.start();
  await bridge.pollOnce();
  assert.equal(bridge.status().pending,0);
  const task=f.store.queueGet(f.agent.token,'task','task-1');
  assert.equal(task.revision,2);assert.equal(task.state,'agent_received');
  assert.equal(f.store.queueCeiling('owner-a'),2);
});

test('offline service leaves the cursor untouched and catches up exactly once',async t=>{
  const f=await setup(t);
  submit(f,'task',withBody(bodies.task,{task_id:'task-1'}));
  // Progress notices are written by the connection program, not by the phone.
  submit(f,'message',withBody(bodies.message,{task_id:'task-1',request_id:null}),'pc-agent');
  const adapter={name:'accept',capabilities:{can_execute:true},onItem:item=>item.kind==='task'?[{action:'task_state',state:'agent_received'}]:[],onAnswer:()=>[]};
  const bridge=f.bridge(adapter);await bridge.start();
  await new Promise(resolve=>f.server.close(resolve));
  await assert.rejects(bridge.pollOnce(),error=>error.code==='NETWORK_UNAVAILABLE'&&error.retryable);
  assert.equal(bridge.status().cursor,null);assert.equal(bridge.status().pending,0);
  await new Promise(resolve=>f.server.listen(f.port,'127.0.0.1',resolve));
  const caught=await bridge.pollOnce();
  assert.equal(caught.items,2);assert.equal(caught.handled,2);
  assert.equal(f.store.queueGet(f.agent.token,'task','task-1').state,'agent_received');
  // The program then sees its own state change once and must not advance it again.
  const own=await bridge.pollOnce();
  assert.equal(own.items,1);assert.equal(own.pending,0);
  assert.equal(f.store.queueGet(f.agent.token,'task','task-1').revision,2);
  assert.equal((await bridge.pollOnce()).items,0);
  assert.equal(f.store.queueCeiling('owner-a'),3);
});

test('a corrupt state file stops the program instead of replaying the queue',async t=>{
  const f=await setup(t);
  fs.writeFileSync(f.stateFile,'{"schema_version":1,"outbox":');
  const bridge=f.bridge(observeOnly);
  await assert.rejects(bridge.start(),error=>error.code==='STATE_CORRUPT'&&error.permanent);
  fs.writeFileSync(f.stateFile,JSON.stringify({schema_version:9,outbox:{},handled:{},answers:{}}));
  await assert.rejects(f.bridge(observeOnly).start(),error=>error.code==='STATE_CORRUPT');
  fs.writeFileSync(f.stateFile,JSON.stringify({schema_version:1,server_id:'other',cursor:null,outbox:{},handled:{},answers:{},requests:{}}));
  await assert.rejects(f.bridge(observeOnly).start(),error=>error.code==='STATE_SERVER_MISMATCH');
});

test('a question is asked, the answer is delivered once and closed questions are reported',async t=>{
  const f=await setup(t);
  submit(f,'task',withBody(bodies.task,{task_id:'task-1'}));
  const answers=[],closed=[];
  const adapter={name:'ask',capabilities:{can_execute:true},
    onItem:item=>item.kind==='task'?[{action:'request',mode:'choice',question:'合成问题：选 A 还是 B？',
      options:[{option_id:'A',label:'方案 A'},{option_id:'B',label:'方案 B'}]}]:[],
    onAnswer:value=>{answers.push(value);return [{action:'receipt',stage:'agent_received',subject_kind:'answer',
      subject_id:value.answer.object_id,subject_revision:1}];},
    onRequestClosed:value=>{closed.push(value.request.object_id);return [{action:'receipt',stage:'agent_received',subject_kind:'request',
      subject_id:value.request.object_id,subject_revision:value.request.revision}];}};
  const bridge=f.bridge(adapter);await bridge.start();
  const first=await bridge.pollOnce();
  assert.equal(first.pending,0);
  assert.equal(Object.keys(bridge.state.requests()).length,1);
  const requestId=Object.keys(bridge.state.requests())[0];
  const asked=f.store.queueGet(f.agent.token,'request',requestId);
  assert.equal(asked.body.question,'合成问题：选 A 还是 B？');assert.equal(asked.state,'pending');
  // The phone answers without creating a new request revision.
  f.store.queueSubmit(f.phone.token,envelope('answer',withBody(bodies.answer,{request_id:requestId,task_id:'task-1'})),'answer');
  const second=await bridge.pollOnce();
  assert.equal(answers.length,1);assert.equal(answers[0].answer.body.option_id,'A');
  assert.equal(second.pending,0);assert.equal(Object.keys(bridge.state.requests()).length,0);
  const detail=f.store.queueGet(f.agent.token,'request',requestId);
  assert.equal(detail.state,'answered');assert.deepEqual(detail.answer.receipts.map(value=>value.stage),['agent_received']);
  const third=await bridge.pollOnce();
  assert.equal(answers.length,1);
  // A second question that the phone withdraws is reported as closed, not as an answer.
  submit(f,'task',withBody(bodies.task,{task_id:'task-2',route:bodies.task.route}));
  await bridge.pollOnce();
  const openId=Object.keys(bridge.state.requests()).find(id=>id!==requestId);
  f.store.queueSubmit(f.agent.token,envelope('request',withBody(bodies.request,{request_id:openId,task_id:'task-2',revision:2,state:'withdrawn'}),{producer:'pc-agent'}),'request');
  await bridge.pollOnce();
  assert.deepEqual(closed,[openId]);assert.equal(Object.keys(bridge.state.requests()).length,0);
  assert.deepEqual(f.store.queueGet(f.agent.token,'request',openId).receipts.map(value=>[value.stage,value.subject_revision]),[['agent_received',2]]);
});

test('permanent rejections block the program and keep the envelope for the operator',async t=>{
  const f=await setup(t);
  submit(f,'task',withBody(bodies.task,{task_id:'task-1'}));
  const proxy=await stub(t,async(req,res)=>{
    if(req.method!=='POST')return forward(f,req,res);
    res.writeHead(403,{'content-type':'application/json'});
    res.end(JSON.stringify({schema_version:'1.0',error:{code:'FORBIDDEN',message:'FORBIDDEN',retryable:false,correlation_id:'x'}}));
  });
  const adapter={name:'accept',capabilities:{can_execute:true},onItem:()=>[{action:'task_state',state:'agent_received'}],onAnswer:()=>[]};
  const bridge=f.bridge(adapter,{config:{...f.config,base_url:`http://127.0.0.1:${proxy.address().port}/v1/`}});
  await bridge.start();
  await assert.rejects(bridge.pollOnce(),error=>error.code==='FORBIDDEN'&&error.permanent);
  assert.equal(bridge.status().blocked.code,'FORBIDDEN');assert.equal(bridge.status().pending,1);
  await assert.rejects(bridge.pollOnce(),error=>error.code==='FORBIDDEN');
  const stored=JSON.parse(fs.readFileSync(f.stateFile,'utf8'));
  assert.equal(Object.keys(stored.outbox).length,1);
  assert.equal(stored.outbox[Object.keys(stored.outbox)[0]].last_error,'');
});

async function forward(f,req,res,body){
  const target=`http://127.0.0.1:${f.port}${req.url}`;
  const response=await fetch(target,{method:req.method,redirect:'manual',headers:{Authorization:req.headers.authorization,
    'Content-Type':req.headers['content-type']??'application/json'},...(body?{body}:{})});
  const text=await response.text();
  if(!res.writableEnded){res.writeHead(response.status,{'content-type':'application/json'});res.end(text);}
  return {status:response.status,text};
}

test('review: a task for another computer/agent is never delivered to this adapter',async t=>{
  const f=await setup(t),seen=[];
  submit(f,'task',withBody(bodies.task,{task_id:'foreign-route',route:{...bodies.task.route,computer_id:'another-computer'}}));
  const adapter={name:'route-check',capabilities:{can_execute:true},onItem:item=>{seen.push(item.object_id);return [];},onAnswer:()=>[]};
  const bridge=f.bridge(adapter,{config:{...f.config,computer_id:bodies.task.route.computer_id,agent_id:bodies.task.route.agent_id}});
  await bridge.start();await bridge.pollOnce();assert.deepEqual(seen,[]);
});

test('review: observe-only capability cannot be bypassed by returned actions or consume executable work',async t=>{
  const f=await setup(t);submit(f,'task',withBody(bodies.task,{task_id:'task-1'}));
  const adapter={name:'lying-observer',capabilities:{can_execute:false},onItem:()=>[{action:'task_state',state:'agent_received'}],onAnswer:()=>[]};
  const bridge=f.bridge(adapter);await bridge.start();await bridge.pollOnce();
  assert.equal(f.store.queueGet(f.agent.token,'task','task-1').revision,1);assert.equal(bridge.status().cursor,null);
});

test('review: a state ledger from another authenticated owner is rejected without changing it',async t=>{
  const f=await setup(t);const first=f.bridge(observeOnly);await first.start();
  const old=fs.readFileSync(f.stateFile),other=f.store.mint({owner:'owner-b',producer:'pc-agent',scopes:agentScopes});await first.stop();
  const credential=path.join(f.dir,'other.json');fs.writeFileSync(credential,JSON.stringify(other));
  const bridge=f.bridge(observeOnly,{config:{...f.config,owner_id:'owner-b',credential_file:credential}});
  await assert.rejects(bridge.start(),e=>e.code==='STATE_IDENTITY_MISMATCH');assert.deepEqual(fs.readFileSync(f.stateFile),old);
});

test('review: fake successful POST or event lookup never removes a durable outgoing event',async t=>{
  const f=await setup(t);submit(f,'task',withBody(bodies.task,{task_id:'task-1'}));
  const proxy=await stub(t,(req,res,inspect)=>{
    if(req.method==='POST'||req.url.startsWith('/v1/events/')){res.writeHead(200,{'content-type':'application/json'});res.end('{"ok":true}');return;}
    return forward(f,req,res,inspect.body);
  });
  const adapter={name:'accept',capabilities:{can_execute:true},onItem:()=>[{action:'task_state',state:'agent_received'}],onAnswer:()=>[]};
  const bridge=f.bridge(adapter,{config:{...f.config,base_url:`http://127.0.0.1:${proxy.address().port}/v1/`}});
  await bridge.start();await bridge.pollOnce();assert.equal(bridge.status().pending,1);
  assert.equal(f.store.queueGet(f.agent.token,'task','task-1').revision,1);
});

test('review: a runtime handoff with unknown outcome is not automatically executed again after restart',async t=>{
  const f=await setup(t);submit(f,'task',withBody(bodies.task,{task_id:'task-1'}));let calls=0;
  const adapter={name:'crash-after-side-effect',capabilities:{can_execute:true},onItem:()=>{calls++;throw new BridgeError('ADAPTER_EXITED',{permanent:true});},onAnswer:()=>[]};
  const first=f.bridge(adapter);await first.start();await assert.rejects(first.pollOnce(),e=>e.code==='ADAPTER_EXITED');
  await first.stop();const restarted=f.bridge(adapter);await restarted.start();await assert.rejects(restarted.pollOnce(),e=>e.code==='DISPATCH_UNCERTAIN');
  assert.equal(calls,1);assert.equal(restarted.status().cursor,null);
});

for(const scenario of ['matching','not-proven','changed-source'])test(`intake reconciliation: ${scenario} proof never repeats executable delivery`,async t=>{
  const f=await setup(t);submit(f,'task',withBody(bodies.task,{task_id:'task-intake',allow_create_session:false}));
  let calls=0,probes=0,captured;
  const runtime={name:'synthetic-durable-intake',capabilities:{can_execute:true,async_events:true,admission_probe_v1:true},
    onItem:item=>{calls++;captured=runtimeSource(item);throw new BridgeError('ADAPTER_EXITED',{permanent:true});},
    onAnswer:()=>[],pollEvents:()=>[],acknowledgeEvents:()=>{},inspectAdmission:({delivery_id,source})=>{
      probes++;assert.deepEqual(source,captured);
      if(scenario==='not-proven')return {status:'not_proven'};
      const normalized=Object.fromEntries(['kind','object_id','revision','body','expires_at','command_expires_at'].filter(k=>source[k]!==undefined).map(k=>[k,source[k]]));
      const operation_id='op-'+runtimeDigest(source.body.task_id);
      if(scenario==='changed-source')normalized.body={...normalized.body,command:'Different synthetic command'};
      return {status:'admitted',delivery_id,operation_id,admitted_event_id:'rt-'+runtimeDigest([operation_id,'admitted']),source:normalized};
    }};
  const first=f.bridge(runtime);await first.start();await assert.rejects(first.pollOnce(),e=>e.code==='ADAPTER_EXITED');await first.stop();
  const restarted=f.bridge(runtime);await restarted.start();
  if(scenario==='matching'){
    await restarted.pollOnce();assert.equal(restarted.state.handled('task:task-intake:1'),true);
    assert.equal(Object.keys(restarted.state.value.intake_reconciliations).length,1);
    assert.equal(restarted.inspectLocalStatus().reconciled_intakes,1);
    assert.equal(f.store.queueGet(f.agent.token,'task','task-intake').state,'queued');
    await restarted.pollOnce();assert.equal(probes,1);
  }else{
    await assert.rejects(restarted.pollOnce(),e=>e.code===(scenario==='not-proven'?'DISPATCH_UNCERTAIN':'RUNTIME_ADMISSION_PROOF_INVALID'));
    assert.equal(restarted.state.value.dispatches['item:task:task-intake:1'].state,'prepared');
    assert.equal(restarted.state.cursor,null);assert.equal(Object.keys(restarted.state.value.intake_reconciliations).length,0);
  }
  assert.equal(calls,1);assert.equal(probes,1);
});

for(const scenario of ['matching','not-proven','changed-proof','changed-saved-answer','legacy','missing-snapshot'])test(`answer intake reconciliation: ${scenario} never redelivers or fabricates resume`,async t=>{
  const f=await setup(t);const taskId='task-answer-intake',requestId='request-answer-intake';
  submit(f,'task',withBody(bodies.task,{task_id:taskId,allow_create_session:false}));
  let calls=0,probes=0,captured;
  const adapter={name:'synthetic-answer-intake',capabilities:{can_execute:true,async_events:true,answer_intake_probe_v1:scenario!=='legacy'},
    onItem:item=>item.kind==='task'&&item.state==='queued'?[{action:'request',request_id:requestId,mode:'free_text',question:'Synthetic question'}]:[],
    onAnswer:({request,answer})=>{calls++;captured={request:runtimeSource(request),answer:runtimeAnswer(answer)};throw new BridgeError('ADAPTER_EXITED',{permanent:true});},
    pollEvents:()=>[],acknowledgeEvents:()=>{},inspectAnswerIntake:({delivery_id,request,answer})=>{
      probes++;assert.deepEqual(request,captured.request);assert.deepEqual(answer,captured.answer);
      if(scenario==='not-proven')return {status:'not_proven'};
      const normalized=Object.fromEntries(['kind','object_id','revision','body','expires_at','command_expires_at'].filter(k=>request[k]!==undefined).map(k=>[k,request[k]]));
      const proof={status:'received',delivery_id,operation_id:'op-'+runtimeDigest(taskId),request:normalized,
        answer_digest:runtimeDigest({answer_id:answer.object_id,stored_at:answer.stored_at,body:answer.body})};
      if(scenario==='changed-proof')proof.answer_digest='0'.repeat(64);
      return proof;
    }};
  let bridge=f.bridge(adapter);await bridge.start();await bridge.pollOnce();
  submit(f,'answer',withBody(bodies.answer,{answer_id:'answer-intake',request_id:requestId,task_id:taskId,option_id:null,text:'Synthetic original reply'}));
  await assert.rejects(bridge.pollOnce(),e=>e.code==='ADAPTER_EXITED');
  const key=`answer:${requestId}:1:answer-intake`,cursor=bridge.status().cursor;
  assert.equal(bridge.state.value.dispatches[key].state,'prepared');
  if(scenario==='changed-saved-answer'){bridge.state.value.dispatches[key].answer.body.text='Changed saved answer';bridge.state.save();}
  if(scenario==='missing-snapshot'){delete bridge.state.value.dispatches[key].answer;bridge.state.save();}
  await bridge.stop();bridge=f.bridge(adapter);await bridge.start();
  if(scenario==='matching'){
    await bridge.pollOnce();await bridge.pollOnce();
    assert.equal(bridge.state.answerDelivered(`${requestId}:1:answer-intake`),true);
    assert.equal(bridge.state.value.dispatches[key],undefined);
    assert.equal(bridge.inspectLocalStatus().reconciled_answers,1);
    assert.equal(Object.keys(bridge.state.requests()).length,0);
    const request=f.store.queueGet(f.agent.token,'request',requestId);
    assert.equal(request.answer.receipts.filter(r=>r.stage==='agent_received').length,1);
  }else{
    const invalid=['changed-proof','changed-saved-answer'].includes(scenario);
    await assert.rejects(bridge.pollOnce(),e=>e.code===(invalid?'RUNTIME_ANSWER_INTAKE_PROOF_INVALID':'DISPATCH_UNCERTAIN'));
    assert.equal(bridge.state.value.dispatches[key].state,'prepared');assert.equal(bridge.status().cursor,cursor);
    assert.equal(bridge.inspectLocalStatus().reconciled_answers,0);
  }
  assert.equal(calls,1);
  assert.equal(probes,['legacy','missing-snapshot','changed-saved-answer'].includes(scenario)?0:1);
  const parent=f.store.queueGet(f.agent.token,'task',taskId);
  assert.equal(parent.state,'queued');assert(!parent.receipts.some(r=>['task_resumed','task_completed'].includes(r.stage)));
});

test('answer intake capability requires async events and the actual read-only method',async t=>{
  const f=await setup(t);
  for(const adapter of [
    {capabilities:{can_execute:true,answer_intake_probe_v1:true},inspectAnswerIntake:()=>({status:'not_proven'})},
    {capabilities:{can_execute:true,async_events:true,answer_intake_probe_v1:true},pollEvents:()=>[],acknowledgeEvents:()=>{}}]){
    const bridge=f.bridge(adapter);await assert.rejects(bridge.start(),e=>e.code==='RUNTIME_ANSWER_INTAKE_UNSUPPORTED');
  }
});

test('review: actual process death after runtime side effect leaves durable ambiguity and prevents another delivery',async t=>{
  const f=await setup(t);submit(f,'task',withBody(bodies.task,{task_id:'task-1'}));
  const initial=f.bridge(observeOnly);await initial.start();await initial.stop();const marker=path.join(f.dir,'synthetic-effect.txt');
  const worker=fileURLToPath(new URL('./fixtures/crash-dispatch.mjs',import.meta.url));
  const child=spawnSync(process.execPath,[worker,f.stateFile,marker],{encoding:'utf8'});
  assert.equal(child.status,73,child.stderr);assert.equal(fs.readFileSync(marker,'utf8'),'1');
  let repeated=0;const adapter={name:'real-restart-proof',capabilities:{can_execute:true},onItem:()=>{repeated++;return [];},onAnswer:()=>[]};
  const bridge=f.bridge(adapter);await bridge.start();await assert.rejects(bridge.pollOnce(),e=>e.code==='DISPATCH_UNCERTAIN');
  assert.equal(repeated,0);assert.equal(fs.readFileSync(marker,'utf8'),'1');assert.equal(bridge.status().cursor,null);
});

test('review: live credential replacement cannot read or write under another account',async t=>{
  const f=await setup(t);const bridge=f.bridge(observeOnly);await bridge.start();await bridge.pollOnce();
  const other=f.store.mint({owner:'owner-b',producer:'pc-agent',scopes:agentScopes});
  fs.writeFileSync(f.credential,JSON.stringify(other));
  await assert.rejects(bridge.pollOnce(),e=>e.code==='IDENTITY_MISMATCH');assert.equal(f.store.queueCeiling('owner-b'),0);
});

test('review: permanent blocked event remains blocked across program restart',async t=>{
  const f=await setup(t);submit(f,'task',withBody(bodies.task,{task_id:'task-1'}));let posts=0;
  const proxy=await stub(t,(req,res,inspect)=>{
    if(req.method==='POST'){posts++;res.writeHead(403,{'content-type':'application/json'});res.end('{"error":{"code":"FORBIDDEN"}}');return;}
    return forward(f,req,res,inspect.body);
  });
  const adapter={name:'accept',capabilities:{can_execute:true},onItem:()=>[{action:'task_state',state:'agent_received'}],onAnswer:()=>[]};
  const options={config:{...f.config,base_url:`http://127.0.0.1:${proxy.address().port}/v1/`}};
  const bridge=f.bridge(adapter,options);await bridge.start();await assert.rejects(bridge.pollOnce(),e=>e.code==='FORBIDDEN');
  await bridge.stop();const restarted=f.bridge(adapter,options);await restarted.start();await assert.rejects(restarted.pollOnce(),e=>e.code==='FORBIDDEN');
  assert.equal(posts,1);assert.equal(restarted.status().pending,1);assert.equal(restarted.status().blocked.code,'FORBIDDEN');
});

test('review: nonempty unbound old ledger and malformed map arrays are preserved and refused',async t=>{
  const f=await setup(t);let value={schema_version:1,server_id:f.identity.server_id,cursor:'old-checkpoint',outbox:{},handled:{},answers:{},requests:{}};
  fs.writeFileSync(f.stateFile,JSON.stringify(value));let before=fs.readFileSync(f.stateFile);
  await assert.rejects(f.bridge(observeOnly).start(),e=>e.code==='STATE_IDENTITY_MISMATCH');assert.deepEqual(fs.readFileSync(f.stateFile),before);
  value={...value,cursor:null,outbox:[]};fs.writeFileSync(f.stateFile,JSON.stringify(value));before=fs.readFileSync(f.stateFile);
  await assert.rejects(f.bridge(observeOnly).start(),e=>e.code==='STATE_CORRUPT');assert.deepEqual(fs.readFileSync(f.stateFile),before);
});

test('review: multiple task transitions retain revision order when the predecessor is delayed',async t=>{
  const f=await setup(t);submit(f,'task',withBody(bodies.task,{task_id:'task-1'}));let delay=true;const sent=[];
  const proxy=await stub(t,(req,res,inspect)=>{
    if(req.method==='POST'){
      const event=JSON.parse(inspect.body);sent.push(event.body.revision);
      if(delay){delay=false;res.writeHead(503,{'content-type':'application/json'});res.end('{"error":{"code":"UNAVAILABLE"}}');return;}
    }
    return forward(f,req,res,inspect.body);
  });
  const adapter={name:'sequential',capabilities:{can_execute:true},onItem:item=>item.state==='queued'?[
    {action:'task_state',state:'agent_received'},{action:'task_state',state:'running'}]:[],onAnswer:()=>[]};
  const bridge=f.bridge(adapter,{config:{...f.config,base_url:`http://127.0.0.1:${proxy.address().port}/v1/`}});
  await bridge.start();await bridge.pollOnce();assert.deepEqual(sent,[2]);assert.equal(bridge.status().pending,2);
  f.setTime(epoch+60000);await bridge.pollOnce();assert.deepEqual(sent,[2,2,3]);assert.equal(bridge.status().pending,0);
  assert.equal(f.store.queueGet(f.agent.token,'task','task-1').state,'running');
});

test('review: an invalid later option action cannot leave an earlier valid action in the durable outbox',async t=>{
  const f=await setup(t);submit(f,'task',withBody(bodies.task,{task_id:'task-1'}));
  const adapter={name:'bad-options',capabilities:{can_execute:true},onItem:()=>[
    {action:'task_state',state:'agent_received'},
    {action:'request',mode:'choice',question:'合成非法选项',options:[{option_id:'A'},{option_id:'B',label:'B'}]}],onAnswer:()=>[]};
  const bridge=f.bridge(adapter);await bridge.start();await assert.rejects(bridge.pollOnce(),e=>e.code==='BRIDGE_ACTION_INVALID');
  assert.equal(bridge.status().pending,0);assert.equal(f.store.queueGet(f.agent.token,'task','task-1').revision,1);
});
test('review: a question delayed before storage stays tracked across restart and its later answer returns once',async t=>{
  const f=await setup(t);submit(f,'task',withBody(bodies.task,{task_id:'task-1'}));let delay=true;const answers=[];
  const proxy=await stub(t,(req,res,inspect)=>{
    if(req.method==='POST'&&req.url==='/v1/requests'&&delay){delay=false;res.writeHead(503,{'content-type':'application/json'});res.end('{"error":{"code":"UNAVAILABLE"}}');return;}
    return forward(f,req,res,inspect.body);
  });
  const adapter={name:'delayed-question',capabilities:{can_execute:true},onItem:item=>item.kind==='task'?[{
    action:'request',mode:'choice',question:'合成延迟上传问题',options:[{option_id:'A',label:'A'},{option_id:'B',label:'B'}]}]:[],
    onAnswer:value=>{answers.push(value.answer.object_id);return [];}};
  const options={config:{...f.config,base_url:`http://127.0.0.1:${proxy.address().port}/v1/`}};
  const first=f.bridge(adapter,options);await first.start();await first.pollOnce();assert.equal(first.status().pending,1);
  const requestId=Object.values(first.state.outbox())[0].event.body.request_id;
  assert.deepEqual(Object.keys(first.state.requests()),[requestId]);
  await first.stop();f.setTime(epoch+60000);const restarted=f.bridge(adapter,options);await restarted.start();await restarted.pollOnce();
  assert.equal(restarted.status().pending,0);assert.deepEqual(Object.keys(restarted.state.requests()),[requestId]);
  f.store.queueSubmit(f.phone.token,envelope('answer',withBody(bodies.answer,{request_id:requestId,task_id:'task-1'}),{now:epoch+60000}),'answer');
  await restarted.pollOnce();await restarted.pollOnce();assert.equal(answers.length,1);assert.deepEqual(Object.keys(restarted.state.requests()),[]);
});

test('review: disappearance of an acknowledged question stops without erasing its waiting record',async t=>{
  const f=await setup(t);submit(f,'task',withBody(bodies.task,{task_id:'task-1'}));let hide=false;
  const proxy=await stub(t,(req,res,inspect)=>{
    if(hide&&['GET','POST'].includes(req.method)&&req.url.startsWith('/v1/requests/')){
      res.writeHead(404,{'content-type':'application/json'});res.end('{"error":{"code":"REQUEST_NOT_FOUND"}}');return;
    }
    return forward(f,req,res,inspect.body);
  });
  const adapter={name:'missing-question',capabilities:{can_execute:true},onItem:item=>item.kind==='task'?[
    {action:'request',mode:'free_text',question:'合成已落库问题'}]:[],onAnswer:()=>[]};
  const bridge=f.bridge(adapter,{config:{...f.config,base_url:`http://127.0.0.1:${proxy.address().port}/v1/`}});
  await bridge.start();await bridge.pollOnce();const waiting=Object.keys(bridge.state.requests());assert.equal(waiting.length,1);
  hide=true;await assert.rejects(bridge.pollOnce(),e=>e.code==='REQUEST_NOT_FOUND'&&e.permanent);
  assert.deepEqual(Object.keys(bridge.state.requests()),waiting);
});

test('review: message callback actions are applied instead of silently discarded',async t=>{
  const f=await setup(t);submit(f,'task',withBody(bodies.task,{task_id:'task-1'}));
  submit(f,'message',withBody(bodies.message,{task_id:'task-1',request_id:null}),'pc-agent');
  const adapter={name:'message-accept',capabilities:{can_execute:true},onItem:item=>item.kind==='message'?[
    {action:'receipt',stage:'agent_received',subject_kind:'message',subject_id:item.object_id,subject_revision:item.revision}]:[],onAnswer:()=>[]};
  const bridge=f.bridge(adapter);await bridge.start();await bridge.pollOnce();
  assert.deepEqual(f.store.queueGet(f.agent.token,'message',bodies.message.message_id).receipts.map(value=>value.stage),['agent_received']);
});

test('ownership: a second connector is rejected before its adapter starts or the ledger changes',async t=>{
  const f=await setup(t),first=f.bridge(observeOnly);await first.start();const before=fs.readFileSync(f.stateFile);let starts=0;
  const second=f.bridge({name:'contender',capabilities:{can_execute:false},start:()=>{starts++;},stop:()=>{},onItem:()=>[],onAnswer:()=>[]});
  await assert.rejects(second.start(),e=>e.code==='BRIDGE_IN_USE');assert.equal(starts,0);assert.deepEqual(fs.readFileSync(f.stateFile),before);
  const staleState=first.state;
  assert.equal(first.status().owns_run,true);await first.stop();assert.equal(first.status().owns_run,false);
  assert.throws(()=>staleState.save(),e=>e.code==='LOCK_LOST');
  await second.start();assert.equal(starts,1);assert.equal(second.status().owns_run,true);
  assert.throws(()=>staleState.save(),e=>e.code==='LOCK_LOST');
});

test('ownership: concurrent poll, flush and start are rejected; shutdown drains the active delivery before releasing ownership',async t=>{
  const f=await setup(t);submit(f,'task',withBody(bodies.task,{task_id:'task-1'}));let deliver,entered;
  const gate=new Promise(resolve=>{deliver=resolve;}),inside=new Promise(resolve=>{entered=resolve;});let calls=0;
  const adapter={name:'blocked-delivery',capabilities:{can_execute:true},onItem:async()=>{calls++;entered();await gate;return [];},onAnswer:()=>[]};
  const first=f.bridge(adapter);await first.start();const poll=first.pollOnce();await inside;
  for(const invoke of [()=>first.pollOnce(),()=>first.flush(),()=>first.start()])await assert.rejects(invoke(),e=>e.code==='BRIDGE_BUSY');
  const stopping=first.stop();assert.equal(first.status().stopping,true);
  await assert.rejects(first.pollOnce(),e=>e.code==='BRIDGE_STOPPING');
  const successor=f.bridge(observeOnly);await assert.rejects(successor.start(),e=>e.code==='BRIDGE_IN_USE');
  deliver();await poll;await stopping;assert.equal(calls,1);await successor.start();
  assert.equal(Object.keys(successor.state.value.dispatches).length,0);
});

test('ownership: identity failure never starts an adapter and releases ownership for a valid successor',async t=>{
  const f=await setup(t);let starts=0;
  const adapter={name:'untrusted-identity',capabilities:{can_execute:false},start:()=>{starts++;},stop:()=>{},onItem:()=>[],onAnswer:()=>[]};
  const bad=f.bridge(adapter,{config:{...f.config,owner_id:'wrong-owner'}});
  await assert.rejects(bad.start(),e=>e.code==='IDENTITY_MISMATCH');assert.equal(starts,0);assert.equal(fs.existsSync(f.stateFile),false);
  const good=f.bridge(observeOnly);await good.start();assert.equal(good.status().owns_run,true);
});

test('ownership: adapter startup failure is stopped and releases both locks without saving a ledger',async t=>{
  const f=await setup(t);let stops=0;
  const adapter={name:'failed-startup',capabilities:{can_execute:true},start:()=>{throw new BridgeError('ADAPTER_SPAWN_FAILED',{permanent:true});},
    stop:()=>{stops++;},onItem:()=>[],onAnswer:()=>[]};
  const bad=f.bridge(adapter);await assert.rejects(bad.start(),e=>e.code==='ADAPTER_SPAWN_FAILED');assert.equal(stops,1);
  assert.equal(fs.existsSync(f.stateFile),false);const good=f.bridge(observeOnly);await good.start();
});

test('ownership: runtime shutdown must complete before another connector may start',async t=>{
  const f=await setup(t);let release,entered;
  const gate=new Promise(resolve=>{release=resolve;}),stoppingRuntime=new Promise(resolve=>{entered=resolve;});
  const adapter={name:'slow-stop',capabilities:{can_execute:true},start:()=>{},stop:async()=>{entered();await gate;},onItem:()=>[],onAnswer:()=>[]};
  const first=f.bridge(adapter);await first.start();const closing=first.stop();await stoppingRuntime;
  const second=f.bridge(observeOnly);await assert.rejects(second.start(),e=>e.code==='BRIDGE_IN_USE');
  release();await closing;await second.start();assert.equal(second.status().owns_run,true);
});

async function stub(t,handler){
  const server=http.createServer(async(req,res)=>{
    const chunks=[];for await(const chunk of req)chunks.push(chunk);
    const inspect={body:chunks.length?Buffer.concat(chunks).toString('utf8'):''};
    await handler(req,res,inspect);
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}));
  return server;
}

test('runtime question deadline: the server receives the original explicit deadline',async t=>{
  const f=await setup(t);submit(f,'task',withBody(bodies.task,{task_id:'task-1'}));
  const expires_at=new Date(epoch+60000).toISOString();
  const adapter={name:'deadline',capabilities:{can_execute:true},onItem:item=>item.kind==='task'?[
    {action:'request',request_id:'request-deadline',mode:'free_text',question:'Synthetic deadline',expires_at}]:[],onAnswer:()=>[]};
  const bridge=f.bridge(adapter);await bridge.start();await bridge.pollOnce();
  assert.equal(f.store.queueRevision('owner-a','request','request-deadline',1).expires,epoch+60000);
});

test('runtime question deadline: expired or malformed deadline rolls back all actions',async t=>{
  const f=await setup(t);submit(f,'task',withBody(bodies.task,{task_id:'task-1'}));
  const adapter={name:'expired-deadline',capabilities:{can_execute:true},onItem:()=>[
    {action:'task_state',state:'agent_received'},
    {action:'request',mode:'free_text',question:'Synthetic expired question',expires_at:new Date(epoch-1).toISOString()}],onAnswer:()=>[]};
  const bridge=f.bridge(adapter);await bridge.start();
  await assert.rejects(bridge.pollOnce(),e=>e.code==='RUNTIME_DEADLINE_INVALID');
  assert.equal(bridge.status().pending,0);assert.equal(f.store.queueGet(f.agent.token,'task','task-1').revision,1);
});

test('runtime question deadline: delayed retry keeps the deadline and event bytes unchanged',async t=>{
  const f=await setup(t);submit(f,'task',withBody(bodies.task,{task_id:'task-1'}));let first=true;const attempts=[];
  const proxy=await stub(t,(req,res,inspect)=>{
    if(req.method==='POST'&&req.url==='/v1/requests'){
      attempts.push(inspect.body);
      if(first){first=false;res.writeHead(503,{'content-type':'application/json'});res.end('{"error":{"code":"UNAVAILABLE"}}');return;}
    }
    return forward(f,req,res,inspect.body);
  });
  const expires_at=new Date(epoch+120000).toISOString();
  const adapter={name:'retry-deadline',capabilities:{can_execute:true},onItem:item=>item.kind==='task'?[
    {action:'request',request_id:'request-deadline',mode:'free_text',question:'Synthetic deadline retry',expires_at}]:[],onAnswer:()=>[]};
  const bridge=f.bridge(adapter,{config:{...f.config,base_url:`http://127.0.0.1:${proxy.address().port}/v1/`}});
  await bridge.start();await bridge.pollOnce();f.setTime(epoch+60000);await bridge.pollOnce();
  assert.equal(attempts.length,2);assert.equal(attempts[0],attempts[1]);assert.equal(JSON.parse(attempts[1]).expires_at,expires_at);
});
