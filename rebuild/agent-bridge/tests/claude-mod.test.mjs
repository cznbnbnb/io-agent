import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {createClaudeModBroker} from '../hosts/claude-mod/broker.mjs';
import {MOD_NAME, stamp} from '../hosts/claude-mod/plugin/hooks/protocol.js';

// Synthetic Mod runtime only. These tests never launch Claude or load a plugin
// into a real conversation. Network calls use an isolated loopback broker.
async function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'io-claude-mod-'));
  fs.chmodSync(directory,0o700);
  let now = Date.now();
  const binding = {server_id:'synthetic', owner_id:'synthetic', host_kind:'claude', workspace:directory,
    route:{computer_id:'test',agent_id:'claude',project_id:'test',session_id:randomUUID()}};
  let broker = await createClaudeModBroker({directory, binding, clock:() => now});
  t.after(async () => {await broker.close(); fs.rmSync(directory,{recursive:true,force:true});});
  const f = {directory, binding, get broker(){return broker;}, now:()=>now, advance:ms=>{now += ms;},
    descriptor:()=>JSON.parse(fs.readFileSync(broker.configFile,'utf8')),
    async restart(){await broker.close(); broker = await createClaudeModBroker({directory,binding,clock:()=>now});},
    async request(endpoint, body={}, overrides={}) {
      const c=f.descriptor();
      const response = await fetch(c.url+endpoint,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${c.token}`,...overrides.headers},
        body:JSON.stringify({session_id:c.session_id,cwd:c.cwd,instance_id:'synthetic-instance',...body})});
      return {status:response.status,...await response.json()};
    },
    async enqueue(text='Synthetic request', expires=60000) {
      const id=randomUUID(); await broker.host.start({text,clientUserMessageId:id,expiresAt:new Date(now+expires).toISOString()}); return id;
    }};
  return f;
}
async function simulator(t, f, initialStore) {
  const callbacks = new Map(), catches = new Map(), store = initialStore ?? new Map();
  const state = {sessionId:f.binding.route.session_id,cwd:f.binding.workspace,timer:null,submissions:[],aborts:[],storeFailure:false,
    lostResponse:null,dropNative:null,toolCalls:[],toolResult:null};
  const $ = {
    plugin:{root:f.broker.pluginDirectory},
    fs:{read:async file=>fs.readFileSync(file,'utf8')},
    session:{id:async()=>state.sessionId,cwd:async()=>state.cwd},
    store:{get:async key=>structuredClone(store.get(key)),set:async(key,value)=>{
      if(state.storeFailure) throw new Error('synthetic durable write failure'); store.set(key,structuredClone(value));
    }},
    clock:{now:async()=>f.now(),every:(_interval,callback)=>{const timer={callback,cancelled:false,cancel(){this.cancelled=true;}};state.timer=timer;return timer;}},
    http:{fetch:async(url,options)=>{
      const response=await fetch(url,options), text=await response.text();
      if(state.lostResponse && url.endsWith(state.lostResponse)){state.lostResponse=null;throw new Error('synthetic reply lost');}
      return {ok:response.ok,status:response.status,text};
    }},
    prompt:{submit:options=>{
      const item={...options};state.submissions.push(item);
      return new Promise((resolve,reject)=>{item.resolve=resolve;item.reject=reject;if(state.dropNative)resolve({drop:state.dropNative});});
    }},
    turn:{abort:async options=>{state.aborts.push(options);return {};}},
    tool:{call:async options=>{
      state.toolCalls.push(options);
      const saved=store.values().next().value;
      assert.ok(Object.values(saved.tools).some(entry=>entry.task_id===options.task_id&&entry.phase==='stop_prepared'),
        'TaskStop must have durable intent before native dispatch');
      return state.toolResult ? state.toolResult(options) : {result:{task_id:options.task_id,task_type:'local_bash',message:'Stopped'}};
    }},
  };
  const {register}=await import(`../hosts/claude-mod/plugin/hooks/register.js?test=${randomUUID()}`);
  register((name,matcher,handler)=>{callbacks.set(name,handler ?? matcher);return {catch(callback){catches.set(name,callback);}};});
  const s={state,store,$,
    async fire(name,event={},implementation=async value=>({event:value})) {
      let result;
      const next=value=>{if(!next.called){next.called=true;result=Promise.resolve().then(()=>implementation(value));}return result;};next.called=false;
      try {return await callbacks.get(name)($,event,next);}catch(error){if(!catches.has(name))throw error;return catches.get(name)($,event,next);}
    },
    async tick(count=1){for(let n=0;n<count;n++){if(state.timer&&!state.timer.cancelled)await state.timer.callback();await new Promise(resolve=>setImmediate(resolve));}},
    async admit(index=0,turnId=`turn-${index}`, turnText) {
      const item=state.submissions[index];
      // Observed real Mod semantics: a Mod's own $.prompt.submit skips its own
      // prompt.submit hook. Only turn.start/complete are delivered back to it.
      await s.fire('turn.start',{turnId,text:turnText ?? item.text});item.resolve({});return {};
    }};
  await s.fire('session.start');
  t.after(async()=>{await s.fire('session.end');});
  return s;
}

test('private authenticated broker binds one exact live session, never fabricates idle',async t=>{
  const f=await fixture(t), c=f.descriptor();
  await assert.rejects(f.broker.host.status(),{code:'CLAUDE_MOD_NOT_CONNECTED'});
  assert.equal((await f.request('/v1/bind',{}, {headers:{Authorization:'Bearer invalid'}})).status,401);
  assert.equal((await f.request('/v1/bind',{}, {headers:{Origin:'https://example.invalid'}})).ok,false);
  assert.equal((await f.request('/v1/bind',{session_id:randomUUID()})).error,'CLAUDE_MOD_ROUTE_MISMATCH');
  assert.equal((await f.request('/v1/bind',{cwd:c.cwd+'/other'})).error,'CLAUDE_MOD_ROUTE_MISMATCH');
  assert.equal((await f.request('/v1/bind')).ok,true);
  assert.equal((await f.request('/v1/bind',{instance_id:'other-instance'})).error,'CLAUDE_MOD_ALREADY_BOUND');
  assert.equal((await f.broker.host.status()).busy,true);
  assert.equal(fs.statSync(f.broker.configFile).mode&0o077,0);
  assert.deepEqual(f.broker.host.capabilities,{atomic_idle_start:false,atomic_queue_append:true,exact_turn_interrupt:true,final_result_evidence:true,native_queue_expiry:false});
  f.advance(5001);await assert.rejects(f.broker.host.status(),{code:'CLAUDE_MOD_NOT_CONNECTED'});
});

test('same operation is durable once, conflict rejected, lost handoff response redelivers only its ID',async t=>{
  const f=await fixture(t);await f.request('/v1/bind');
  const id=await f.enqueue(), input={text:'Synthetic request',clientUserMessageId:id,expiresAt:new Date(f.now()+60000).toISOString()};
  await f.broker.host.start(input);assert.equal(f.broker.snapshot().length,1);
  await assert.rejects(f.broker.host.start({...input,text:'changed'}),{code:'CLAUDE_MOD_OPERATION_CONFLICT'});
  const first=await f.request('/v1/poll',{busy:true,turn_id:null}), second=await f.request('/v1/poll',{busy:true,turn_id:null});
  assert.equal(first.action.operation_id,id);assert.deepEqual(second.action,first.action);
  assert.equal((await f.broker.host.inspectOperation(id)).status,'queued');
});

test('native queued input does not block exact abort, and stop receipt never proves children exited',async t=>{
  const f=await fixture(t), s=await simulator(t,f);
  await s.fire('turn.start',{turnId:'existing-turn',text:'Existing local work'});await s.tick();
  const id=await f.enqueue();await s.tick(2);
  assert.equal(s.state.submissions.length,1);
  assert.equal((await f.broker.host.inspectOperation(id)).turnId,null);
  await f.broker.host.interrupt('existing-turn');await f.broker.host.interrupt('existing-turn');await s.tick(2);
  assert.deepEqual(s.state.aborts,[{turnId:'existing-turn'}]);
  assert.equal(f.broker.snapshot().filter(o=>o.kind==='abort').length,1);
  await assert.rejects(f.broker.host.interrupt('wrong-turn'),{code:'CLAUDE_MOD_STOP_STALE'});
  assert.equal((await f.broker.host.inspectStop('existing-turn')).descendantsStopped,false);
  await s.admit(0,'owned-turn');await s.tick();
  await f.broker.host.interrupt('owned-turn');await s.tick(2);
  await s.fire('turn.complete',{turnId:'owned-turn',isAborted:true,answer:'partial'});await s.tick();
  assert.deepEqual(await f.broker.host.inspectStop('owned-turn'),{
    conversationId:f.binding.route.session_id,turnId:'owned-turn',terminal:true,descendantsStopped:false});
});

test('lost poll and receipt replies never duplicate native submission; final result belongs to its exact turn',async t=>{
  const f=await fixture(t), s=await simulator(t,f), id=await f.enqueue();
  s.state.lostResponse='/v1/poll';await s.tick();assert.equal(s.state.submissions.length,0);
  await s.tick();assert.equal(s.state.submissions.length,1);
  s.state.lostResponse='/v1/report';await s.tick(3);assert.equal(s.state.submissions.length,1);
  await s.admit(0,'owned');await s.tick();
  await s.fire('turn.complete',{turnId:'unrelated',answer:'wrong'});await s.tick();
  assert.equal((await f.broker.host.inspectOperation(id)).status,'inProgress');
  await s.fire('turn.complete',{turnId:'owned',answer:'Expected answer'});s.state.lostResponse='/v1/report';await s.tick(3);
  const result=await f.broker.host.inspectOperation(id);
  assert.equal(result.status,'completed');assert.deepEqual(result.result,{type:'text',text:'Expected answer'});
  assert.equal(s.state.submissions.length,1);
});

test('FIFO queue does not dispatch second task before first completes',async t=>{
  const f=await fixture(t), s=await simulator(t,f), first=await f.enqueue('First'), second=await f.enqueue('Second');
  await s.tick(3);assert.equal(s.state.submissions.length,1);
  await s.admit(0,'first');await s.tick(2);assert.equal(s.state.submissions.length,1);
  await s.fire('turn.complete',{turnId:'first',answer:'One'});await s.tick();assert.equal(s.state.submissions.length,2);
  assert.equal((await f.broker.host.inspectOperation(first)).status,'completed');
  assert.equal((await f.broker.host.inspectOperation(second)).status,'queued');
});

test('expiration is enforced before submit; native queued input explicitly has no admission-time expiry guarantee',async t=>{
  const f=await fixture(t), s=await simulator(t,f), first=await f.enqueue('Expired locally',20);
  f.advance(30);await s.tick();assert.equal(s.state.submissions.length,0);
  assert.equal((await f.broker.host.inspectOperation(first)).status,'rejected');
  const second=await f.enqueue('Native queue expiration',20);await s.tick(2);f.advance(30);
  await s.admit();await s.tick(2);
  assert.equal((await f.broker.host.inspectOperation(second)).phase,'running');
  assert.equal(f.broker.host.capabilities.native_queue_expiry,false);
});

test('expiry during durable preparation is rechecked immediately before native submit',async t=>{
  const f=await fixture(t),s=await simulator(t,f),id=await f.enqueue('Short deadline',20);
  const original=s.$.store.set;s.$.store.set=async(key,value)=>{await original(key,value);f.advance(21);};
  await s.tick(3);assert.equal(s.state.submissions.length,0);
  assert.equal((await f.broker.host.inspectOperation(id)).phase,'expired');
});

test('native user Stop gate rejection is preserved and never retried',async t=>{
  const f=await fixture(t), s=await simulator(t,f);s.state.dropNative='stopped';
  const id=await f.enqueue();await s.tick(4);
  assert.equal((await f.broker.host.inspectOperation(id)).status,'rejected');
  assert.equal((await f.broker.host.inspectOperation(id)).reason,'stopped');assert.equal(s.state.submissions.length,1);
});

test('session end revokes binding, drops unsent work, and old native callbacks cannot report success',async t=>{
  const f=await fixture(t), s=await simulator(t,f), first=await f.enqueue(), second=await f.enqueue('Later');await s.tick(2);
  await s.fire('session.end');
  s.state.submissions[0].resolve({drop:'stopped'});await new Promise(resolve=>setImmediate(resolve));
  await s.fire('turn.start',{turnId:'late',text:s.state.submissions[0].text});
  await s.fire('turn.complete',{turnId:'late',answer:'Late answer'});
  assert.deepEqual(await f.broker.host.inspectOperation(first),{found:false,outcomeUnknown:true,resultComplete:false});
  assert.equal((await f.broker.host.inspectOperation(second)).status,'rejected');
  await assert.rejects(f.broker.host.status(),{code:'CLAUDE_MOD_NOT_CONNECTED'});
  assert.equal((await f.request('/v1/bind')).ok,false);
});

test('changed native session/cwd unbinds, and marker replay from another origin is rejected',async t=>{
  const f=await fixture(t), s=await simulator(t,f), id=await f.enqueue();await s.tick();
  const text=s.state.submissions[0].text;
  assert.ok((await s.fire('prompt.submit',{text,origin:{kind:'user'}})).drop);
  assert.ok((await s.fire('prompt.submit',{text:stamp(id)+'changed',origin:{kind:'plugin',name:MOD_NAME}})).drop);
  s.state.cwd += '/other';await s.tick();
  assert.ok((await s.fire('prompt.submit',{text,origin:{kind:'plugin',name:MOD_NAME}})).drop);
  await assert.rejects(f.broker.host.status(),{code:'CLAUDE_MOD_NOT_CONNECTED'});
});

test('Mod durable write failure precedes side effect and disables pump',async t=>{
  const f=await fixture(t), s=await simulator(t,f);await f.enqueue();s.state.storeFailure=true;await s.tick(3);
  assert.equal(s.state.submissions.length,0);assert.equal(s.state.timer.cancelled,true);
});

test('broker write failure never dispatches native action and poisons further writes',async t=>{
  const f=await fixture(t);await f.request('/v1/bind');
  const ledger=path.join(f.directory,'broker.json');fs.rmSync(ledger);fs.mkdirSync(ledger);
  await assert.rejects(f.enqueue());
  assert.equal((await f.request('/v1/poll',{busy:false,turn_id:null})).error,'CLAUDE_MOD_STORAGE_UNAVAILABLE');
});

test('broker restart preserves uncertainty and does not resend potentially delivered native work',async t=>{
  const f=await fixture(t);await f.request('/v1/bind');const id=await f.enqueue();
  await f.request('/v1/poll',{busy:false,turn_id:null});await f.restart();await f.request('/v1/bind');
  assert.deepEqual(await f.broker.host.inspectOperation(id),{found:false,outcomeUnknown:true,resultComplete:false});
  assert.equal((await f.request('/v1/poll',{busy:false,turn_id:null})).action,null);
});

test('exact turn receipts reject rebinding and terminal outcome replacement',async t=>{
  const f=await fixture(t);await f.request('/v1/bind');const id=await f.enqueue();await f.request('/v1/poll',{busy:false,turn_id:null});
  const report=receipt=>f.request('/v1/report',{receipt:{operation_id:id,...receipt}});
  assert.equal((await report({phase:'running',turn_id:'one'})).ok,true);
  assert.equal((await report({phase:'completed',turn_id:'other',answer:'wrong'})).error,'CLAUDE_MOD_TURN_CONFLICT');
  assert.equal((await report({phase:'completed',turn_id:'one',answer:'ok'})).ok,true);
  assert.equal((await report({phase:'queued_native'})).ok,true);
  assert.equal((await f.broker.host.inspectOperation(id)).status,'completed');
  assert.equal((await report({phase:'interrupted',turn_id:'one'})).error,'CLAUDE_MOD_TERMINAL_CONFLICT');
});

test('final result evidence requires the exact terminal answer and preserves an explicitly empty answer',async t=>{
  const f=await fixture(t),s=await simulator(t,f),id=await f.enqueue();await s.tick(2);
  assert.equal((await f.broker.host.inspectOperation(id)).resultComplete,false);
  assert.equal((await f.broker.host.inspectOperation(randomUUID())).resultComplete,false);
  await s.admit(0,'empty-answer-turn');await s.tick();
  assert.equal((await f.broker.host.inspectOperation(id)).resultComplete,false);
  await s.fire('turn.complete',{turnId:'empty-answer-turn',answer:''});await s.tick();
  const result=await f.broker.host.inspectOperation(id);
  assert.equal(result.resultComplete,true);assert.deepEqual(result.result,{type:'text',text:''});
});

test('a completion receipt without final answer cannot claim final result evidence',async t=>{
  const f=await fixture(t);await f.request('/v1/bind');const id=await f.enqueue();await f.request('/v1/poll',{busy:false,turn_id:null});
  const reply=await f.request('/v1/report',{receipt:{operation_id:id,phase:'completed',turn_id:'missing-answer'}});
  assert.equal(reply.ok,true);
  assert.equal((await f.broker.host.inspectOperation(id)).status,'completed');
  assert.equal((await f.broker.host.inspectOperation(id)).resultComplete,false);
});

test('missing or oversized native answer is never silently converted into a complete empty or truncated result',async t=>{
  for(const answer of [undefined,'x'.repeat(32769)]){
    const f=await fixture(t),s=await simulator(t,f),id=await f.enqueue();await s.tick(2);await s.admit(0,'no-complete-answer');await s.tick();
    await s.fire('turn.complete',{turnId:'no-complete-answer',...(answer===undefined?{}:{answer})});await s.tick();
    const result=await f.broker.host.inspectOperation(id);
    assert.equal(result.status,'completed');assert.equal(result.resultComplete,false);assert.equal(result.result,undefined);
    assert.equal(result.reason,answer===undefined?'final_result_missing':'final_result_too_large');
  }
});

// This literal is the host-generated message captured by the root task's
// isolated real 2.1.308 SDK run. Do not synthesize it using the implementation
// helper: the regression must detect changes to the host text shape.
function actualSdkWrapper(text) {
  return `The io-agent-session-bridge plugin sent a message:\n${text}\n\nThis is how Claude Code surfaces a prompt a plugin submits between turns — it starts this turn in the user's place. Address the message above.`;
}

test('real SDK attribution wrapper binds to the already authenticated input and reports its result',async t=>{
  const f=await fixture(t),s=await simulator(t,f),id=await f.enqueue('Synthetic SDK nonce');await s.tick(2);
  await s.admit(0,'sdk-wrapper-turn',actualSdkWrapper(s.state.submissions[0].text));await s.tick();
  assert.equal((await f.broker.host.inspectOperation(id)).turnId,'sdk-wrapper-turn');
  await s.fire('turn.complete',{turnId:'sdk-wrapper-turn',answer:'Synthetic SDK nonce'});await s.tick();
  assert.deepEqual((await f.broker.host.inspectOperation(id)).result,{type:'text',text:'Synthetic SDK nonce'});
});

test('false wrapper prefix, mixed user text, or changed attribution cannot claim the pending operation',async t=>{
  const variants=[
    text=>'User pasted this:\n'+actualSdkWrapper(text),
    text=>actualSdkWrapper(text)+'\nAlso do an unrelated user task.',
    text=>actualSdkWrapper(text).replace('io-agent-session-bridge plugin','another-plugin plugin'),
    text=>actualSdkWrapper(text+'\nAdditional user input'),
  ];
  for(const alter of variants){
    const f=await fixture(t),s=await simulator(t,f),id=await f.enqueue();await s.tick(2);
    const input=s.state.submissions[0].text;
    await s.admit(0,'unbound-turn',alter(input));await s.tick();
    assert.equal((await f.broker.host.inspectOperation(id)).turnId,null);
    // A later user paste is rejected before it can create a native turn. An
    // unrelated user turn must not consume the genuine queued operation.
    assert.ok((await s.fire('prompt.submit',{text:actualSdkWrapper(input),origin:{kind:'user'}})).drop);
    assert.equal((await f.broker.host.inspectOperation(id)).turnId,null);
    await s.admit(0,'actual-owned-turn',actualSdkWrapper(input));await s.tick();
    assert.equal((await f.broker.host.inspectOperation(id)).turnId,'actual-owned-turn');
  }
});

test('a correct host wrapper without trusted native dispatch does not bind any native turn',async t=>{
  const f=await fixture(t),s=await simulator(t,f),id=await f.enqueue();
  await s.fire('turn.start',{turnId:'user-paste',text:actualSdkWrapper(stamp(id)+'Synthetic request')});
  assert.equal((await f.broker.host.inspectOperation(id)).turnId,null);
});

test('overlapping turn callbacks serialize durable writes and retain the later terminal receipt',async t=>{
  const f=await fixture(t), s=await simulator(t,f), id=await f.enqueue();await s.tick(2);
  const original=s.$.store.set;let release, entered, count=0, concurrent=0, max=0;
  const waiting=new Promise(resolve=>{entered=resolve;});
  s.$.store.set=async(key,value)=>{
    concurrent++;max=Math.max(max,concurrent);
    if(count++===0){entered();await new Promise(resolve=>{release=resolve;});}
    await original(key,value);concurrent--;
  };
  const start=s.admit(0,'overlap');await waiting;
  const finish=s.fire('turn.complete',{turnId:'overlap',answer:'Last write wins in event order'});
  release();await Promise.all([start,finish]);await s.tick(3);
  assert.equal(max,1);assert.equal(s.store.values().next().value.operations[id].phase,'completed');
  assert.equal((await f.broker.host.inspectOperation(id)).status,'completed');
});

test('corrupt durable payload cannot silently recreate or change a pending operation on reopen',async t=>{
  const f=await fixture(t);await f.request('/v1/bind');const id=await f.enqueue();await f.broker.close();
  const file=path.join(f.directory,'broker.json'),value=JSON.parse(fs.readFileSync(file,'utf8'));
  value.claude_mod.operations[id].text='Changed without matching original identity digest';fs.writeFileSync(file,JSON.stringify(value));
  await assert.rejects(createClaudeModBroker({directory:f.directory,binding:f.binding}),{code:'CLAUDE_MOD_STATE_CORRUPT'});
  delete value.claude_mod;fs.writeFileSync(file,JSON.stringify(value));
  await assert.rejects(createClaudeModBroker({directory:f.directory,binding:f.binding}),{code:'CLAUDE_MOD_STATE_CORRUPT'});
});

async function ownedBash(t, f, s, {event={},response={result:{backgroundTaskId:'native-task-1',backgroundedByTurnAbort:true}}}={}) {
  const operationId=await f.enqueue();await s.tick(2);await s.admit(0,'bash-turn');await s.tick();
  let entered, release;
  const ready=new Promise(resolve=>{entered=resolve;});
  const call=s.fire('tool.call',{tool:'Bash',tool_use_id:'call_exact_1',...event},async()=>{
    entered();return new Promise(resolve=>{release=()=>resolve(response);});
  });
  await ready;
  return {operationId,call,release};
}

test('aborted owned Bash uses exact structured native task once; lost receipt never retries TaskStop',async t=>{
  const f=await fixture(t),s=await simulator(t,f),b=await ownedBash(t,f,s);
  await f.broker.host.interrupt('bash-turn');await s.tick(2);
  b.release();await b.call;
  await s.fire('turn.complete',{turnId:'bash-turn',isAborted:true,answer:''});
  s.state.lostResponse='/v1/child-report';await s.tick(9);
  assert.deepEqual(s.state.toolCalls,[{tool:'TaskStop',task_id:'native-task-1'}]);
  const stop=await f.broker.host.inspectStop('bash-turn');
  assert.equal(stop.terminal,true);assert.equal(stop.descendantsStopped,false);
  assert.deepEqual(stop.childStops,[{tool_use_id:'call_exact_1',task_id:'native-task-1',turn_id:'bash-turn',
    phase:'stop_requested',native_result:'success'}]);
});

test('no Mod abort, subagent tools, normal backgrounding and text-only task IDs cannot trigger TaskStop',async t=>{
  const variants=[
    {abort:false},
    {event:{agentId:'child-agent'},abort:true},
    {response:{result:{backgroundTaskId:'native-task-1',backgroundedByTurnAbort:false}},abort:true},
    {response:{text:'Command running in background with ID: fake-task',result:{}},abort:true},
    {response:{isError:true,result:{backgroundTaskId:'native-task-1',backgroundedByTurnAbort:true}},abort:true},
  ];
  for(const variant of variants){
    const f=await fixture(t),s=await simulator(t,f),b=await ownedBash(t,f,s,variant);
    if(variant.abort){await f.broker.host.interrupt('bash-turn');await s.tick(2);}
    b.release();await b.call;await s.tick(6);
    assert.equal(s.state.toolCalls.length,0);
  }
});

test('native TaskStop permission denial or ambiguous result is retained once without approval or retry',async t=>{
  const variants=[
    {reply:()=>({deny:'Await user permission'}),phase:'stop_denied',result:'denied'},
    {reply:()=>({isError:true,result:{task_id:'native-task-1',task_type:'local_bash'}}),phase:'stop_unknown',result:'error'},
    {reply:()=>({result:{task_id:'wrong-native-id',task_type:'local_bash'}}),phase:'stop_unknown',result:'unrecognized'},
    {reply:()=>{throw new Error('native reply lost');},phase:'stop_unknown',result:'unknown'},
  ];
  for(const variant of variants){
    const f=await fixture(t),s=await simulator(t,f),b=await ownedBash(t,f,s);s.state.toolResult=variant.reply;
    await f.broker.host.interrupt('bash-turn');await s.tick(2);b.release();await b.call;await s.tick(9);
    assert.deepEqual(s.state.toolCalls,[{tool:'TaskStop',task_id:'native-task-1'}]);
    const stop=await f.broker.host.inspectStop('bash-turn');
    assert.equal(stop.childStops[0].phase,variant.phase);assert.equal(stop.childStops[0].native_result,variant.result);
    assert.equal(stop.descendantsStopped,false);
  }
});

test('TaskStop durable intent failure disables native dispatch',async t=>{
  const f=await fixture(t),s=await simulator(t,f),b=await ownedBash(t,f,s);
  await f.broker.host.interrupt('bash-turn');await s.tick(2);b.release();await b.call;
  const original=s.$.store.set;
  s.$.store.set=async(key,value)=>{
    if(Object.values(value.tools).some(entry=>entry.phase==='stop_prepared'))throw new Error('intent persistence failed');
    return original(key,value);
  };
  await s.tick(5);assert.equal(s.state.toolCalls.length,0);assert.equal(s.state.timer.cancelled,true);
});

test('prepared child stop recovered after restart is unknown and never reissued',async t=>{
  const f=await fixture(t),s=await simulator(t,f),b=await ownedBash(t,f,s);
  await f.broker.host.interrupt('bash-turn');await s.tick(2);b.release();await b.call;
  s.state.toolResult=()=>new Promise(()=>{});
  const running=s.tick();
  for(let n=0;n<30&&!s.state.toolCalls.length;n++)await new Promise(resolve=>setTimeout(resolve,5));
  assert.equal(s.state.toolCalls.length,1);
  s.state.timer.cancel();
  const copied=new Map([...s.store].map(([key,value])=>[key,structuredClone(value)]));
  assert.equal(copied.values().next().value.tools.call_exact_1.phase,'stop_prepared');
  await f.restart();
  const restored=await simulator(t,f,copied);await restored.tick(8);
  assert.equal(restored.state.toolCalls.length,0);
  assert.equal(restored.store.values().next().value.tools.call_exact_1.phase,'stop_unknown');
  assert.equal((await f.broker.host.inspectStop('bash-turn')).childStops[0].phase,'stop_unknown');
  // This unresolved synthetic native Promise represents process loss; no real
  // process or live handle exists and the recovered instance must not repeat it.
  void running;
});

test('broker child receipts require exact turn/task and terminal evidence cannot be rewritten',async t=>{
  const f=await fixture(t);await f.request('/v1/bind');const operationId=await f.enqueue();
  await f.request('/v1/poll',{busy:false,turn_id:null});
  await f.request('/v1/report',{receipt:{operation_id:operationId,phase:'running',turn_id:'owned'}});
  await f.request('/v1/poll',{busy:true,turn_id:'owned'});await f.broker.host.interrupt('owned');
  await f.request('/v1/poll',{busy:true,turn_id:'owned'});
  const receipt={operation_id:operationId,turn_id:'owned',tool_use_id:'call_1',task_id:'native-task-1'};
  const report=extra=>f.request('/v1/child-report',{receipt:{...receipt,...extra}});
  assert.equal((await report({phase:'identified',turn_id:'other'})).ok,false);
  assert.equal((await report({phase:'identified'})).ok,true);
  assert.equal((await report({phase:'stop_prepared'})).ok,true);
  assert.equal((await report({phase:'identified'})).ok,true);
  assert.equal((await report({phase:'stop_requested',native_result:'success'})).ok,true);
  assert.equal((await report({phase:'stop_unknown'})).error,'CLAUDE_MOD_CHILD_TERMINAL_CONFLICT');
  assert.equal((await report({phase:'identified',task_id:'other-native-task'})).error,'CLAUDE_MOD_CHILD_TASK_CONFLICT');
  assert.equal((await f.broker.host.inspectStop('owned')).childStops[0].phase,'stop_requested');
});
