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
async function fixture(t,{witness}={}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'io-claude-mod-'));
  fs.chmodSync(directory,0o700);
  let now = Date.now();
  const binding = {server_id:'synthetic', owner_id:'synthetic', host_kind:'claude', workspace:directory,
    route:{computer_id:'test',agent_id:'claude',project_id:'test',session_id:randomUUID()}};
  const createWitness=witness?()=>witness:undefined;
  let broker = await createClaudeModBroker({directory, binding, clock:() => now,createWitness});
  t.after(async () => {await broker.close(); fs.rmSync(directory,{recursive:true,force:true});});
  const f = {directory, binding, get broker(){return broker;}, now:()=>now, advance:ms=>{now += ms;},
    descriptor:()=>JSON.parse(fs.readFileSync(broker.configFile,'utf8')),
    async restart(){await broker.close(); const reordered={host_kind:binding.host_kind,workspace:binding.workspace,
      server_id:binding.server_id,owner_id:binding.owner_id,route:binding.route};
      broker = await createClaudeModBroker({directory,binding:reordered,clock:()=>now,createWitness});},
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
async function simulator(t, f, initialStore, {registryRoot}={}) {
  const callbacks = new Map(), catches = new Map(), store = initialStore ?? new Map();
  const state = {sessionId:f.binding.route.session_id,cwd:f.binding.workspace,timer:null,submissions:[],aborts:[],storeFailure:false,
    lostResponse:null,dropNative:null,toolCalls:[],toolResult:null,timers:[],network:[]};
  if(registryRoot)fs.writeFileSync(path.join(f.broker.pluginDirectory,'.claude-plugin','registry.json'),JSON.stringify({schema_version:1,root:registryRoot}));
  const $ = {
    plugin:{root:f.broker.pluginDirectory},
    fs:{read:async file=>fs.readFileSync(file,'utf8'),
      stat:async file=>{const link=fs.lstatSync(file),stat=fs.statSync(file);return {kind:stat.isDirectory()?'dir':stat.isFile()?'file':'other',isLink:link.isSymbolicLink(),realPath:fs.realpathSync(file)};},
      list:async directory=>fs.readdirSync(directory,{withFileTypes:true}).map(e=>({name:e.name,kind:e.isDirectory()?'dir':e.isFile()?'file':'other',isLink:e.isSymbolicLink()}))},
    process:{run:async()=>({exitCode:0,stdout:'12345',stderr:''})},
    session:{id:async()=>state.sessionId,cwd:async()=>state.cwd},
    store:{get:async key=>structuredClone(store.get(key)),set:async(key,value)=>{
      if(state.storeFailure) throw new Error('synthetic durable write failure'); store.set(key,structuredClone(value));
    }},
    clock:{now:async()=>f.now(),every:(interval,callback)=>{const timer={interval,callback,cancelled:false,cancel(){this.cancelled=true;}};state.timer=timer;state.timers.push(timer);return timer;}},
    http:{fetch:async(url,options)=>{
      state.network.push(new URL(url).pathname);const response=await fetch(url,options), text=await response.text();
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
    async tick(count=1){for(let n=0;n<count;n++){for(const timer of state.timers.filter(x=>x.interval===250&&!x.cancelled))await timer.callback();await new Promise(resolve=>setImmediate(resolve));}},
    async discover(){for(const timer of state.timers.filter(x=>x.interval===2000&&!x.cancelled))await timer.callback();},
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
    conversationId:f.binding.route.session_id,turnId:'owned-turn',terminal:true,descendantsStopped:false,
    workStop:{coverage:1,toolsStopped:true,processes:{observed:false,quiescent:false}}});
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

test('changed native session unbinds, a moved cwd does not, and marker replay from another origin is rejected',async t=>{
  const f=await fixture(t), s=await simulator(t,f), id=await f.enqueue();await s.tick();
  const text=stamp(id)+s.state.submissions[0].text;
  assert.ok((await s.fire('prompt.submit',{text,origin:{kind:'user'}})).drop);
  assert.ok((await s.fire('prompt.submit',{text:stamp(id)+'changed',origin:{kind:'plugin',name:MOD_NAME}})).drop);
  s.state.cwd += '/other';await s.tick();assert.equal(f.broker.lifecycle().ended,false);
  s.state.sessionId=randomUUID();await s.tick();
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

test('phone input is submitted as the user\'s own words, and a typed copy never claims it',async t=>{
  const f=await fixture(t),s=await simulator(t,f),id=await f.enqueue('Synthetic phone words');await s.tick(2);
  assert.equal(s.state.submissions[0].text,'Synthetic phone words');
  assert.equal(s.state.submissions[0].asUser,true);
  const typed=await s.fire('prompt.submit',{text:'Synthetic phone words',origin:{kind:'user'}});assert(typed.event);
  await s.fire('turn.start',{turnId:'typed-copy',text:'Synthetic phone words'});await s.tick();
  assert.equal((await f.broker.host.inspectOperation(id)).turnId,null);
  await s.admit(0,'phone-turn');await s.tick();
  assert.equal((await f.broker.host.inspectOperation(id)).turnId,'phone-turn');
});

test('the end reason tells a Mod reload from a replaced conversation',async t=>{
  const f=await fixture(t),s=await simulator(t,f);await s.tick();
  await s.fire('session.end',{reason:'other'});assert.deepEqual([f.broker.lifecycle().ended,f.broker.lifecycle().endReason],[true,'other']);
  const g=await fixture(t),u=await simulator(t,g);await u.tick();
  u.state.cwd+='/other';await u.tick();assert.equal(g.broker.lifecycle().ended,false);
  u.state.sessionId=randomUUID();await u.tick();assert.equal(g.broker.lifecycle().endReason,'session_changed');
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

test('no Mod abort, subagent tools and text-only task IDs cannot trigger TaskStop',async t=>{
  const variants=[
    {abort:false},
    {event:{agentId:'child-agent'},abort:true},
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

function syntheticWitness(){
  return {proof:{observed:true,quiescent:true},async bind(){},async begin(){},async inspect(){return structuredClone(this.proof);},close(){}};
}
test('complete native tool ledger plus independent process quiet enables exact stop, never a bare receipt',async t=>{
  const witness=syntheticWitness(),f=await fixture(t,{witness}),s=await simulator(t,f),b=await ownedBash(t,f,s);
  await f.broker.host.interrupt('bash-turn');await s.tick(2);
  b.release();await b.call;await s.fire('turn.complete',{turnId:'bash-turn',isAborted:true,answer:''});await s.tick(3);
  assert.equal((await f.broker.host.inspectStop('bash-turn')).descendantsStopped,true);
  witness.proof.quiescent=false;
  assert.equal((await f.broker.host.inspectStop('bash-turn')).descendantsStopped,false);
  witness.proof.quiescent=true;
  await s.fire('turn.start',{turnId:'local-user-work',text:'Local user task'});await s.tick();
  assert.equal((await f.broker.host.inspectStop('bash-turn')).descendantsStopped,false);
  await s.fire('session.end');
  assert.equal((await f.broker.host.inspectStop('bash-turn')).descendantsStopped,false);
});
test('a tool still in flight or unsupported external work fences continuation despite an idle OS snapshot',async t=>{
  for(const tool of ['Read','Agent','mcp__remote__create_job']){
    const f=await fixture(t,{witness:syntheticWitness()}),s=await simulator(t,f),id=await f.enqueue();
    await s.tick(2);await s.admit(0,'guarded');await s.tick();
    let release,entered;const ready=new Promise(r=>entered=r);
    const call=s.fire('tool.call',{tool,tool_use_id:'work-1'},async()=>{entered();return new Promise(r=>release=r);});
    await ready;await f.broker.host.interrupt('guarded');await s.tick(2);
    await s.fire('turn.complete',{turnId:'guarded',isAborted:true,answer:''});await s.tick(2);
    assert.equal((await f.broker.host.inspectStop('guarded')).descendantsStopped,false);
    release({result:{}});await call;await s.tick(3);
    assert.equal((await f.broker.host.inspectStop('guarded')).descendantsStopped,tool==='Read');
    assert.equal((await f.broker.host.inspectOperation(id)).turnId,'guarded');
  }
});
test('bridge restart cannot bless an old interrupted turn with a new process observer',async t=>{
  const f=await fixture(t,{witness:syntheticWitness()}),s=await simulator(t,f),b=await ownedBash(t,f,s);
  await f.broker.host.interrupt('bash-turn');await s.tick(2);b.release();await b.call;
  await s.fire('turn.complete',{turnId:'bash-turn',isAborted:true,answer:''});await s.tick(3);
  assert.equal((await f.broker.host.inspectStop('bash-turn')).descendantsStopped,true);
  s.state.timer.cancel();const copied=new Map([...s.store].map(([k,v])=>[k,structuredClone(v)]));
  await f.restart();const restored=await simulator(t,f,copied);await restored.tick(2);
  assert.equal((await f.broker.host.inspectStop('bash-turn')).descendantsStopped,false);
});
test('normal background work created by this exact turn is also stopped when that task is interrupted',async t=>{
  const f=await fixture(t,{witness:syntheticWitness()}),s=await simulator(t,f);
  const b=await ownedBash(t,f,s,{response:{result:{backgroundTaskId:'native-task-1',backgroundedByTurnAbort:false}}});
  b.release();await b.call;await f.broker.host.interrupt('bash-turn');await s.tick(3);
  await s.fire('turn.complete',{turnId:'bash-turn',isAborted:true,answer:''});await s.tick(2);
  assert.equal(s.state.toolCalls.length,1);assert.equal((await f.broker.host.inspectStop('bash-turn')).descendantsStopped,true);
});

test('native turn.start cannot release tools before the broker acknowledges its process baseline',async t=>{
  let entered,release;const began=new Promise(r=>entered=r),witness=syntheticWitness();
  witness.begin=async()=>{entered();await new Promise(r=>release=r);};
  const f=await fixture(t,{witness}),s=await simulator(t,f);await f.enqueue();await s.tick(2);
  let admitted=false;const admission=s.admit(0,'pre-tool').then(()=>admitted=true);
  await began;assert.equal(admitted,false);release();await admission;assert.equal(admitted,true);
});

function registry(f){
  const requested=path.join(f.directory,'private-registry');fs.mkdirSync(requested,{mode:0o700});const root=fs.realpathSync(requested);
  return {root,write(descriptor=f.descriptor(),name='a'.repeat(64)){
    const folder=path.join(root,name);fs.mkdirSync(folder,{recursive:true,mode:0o700});fs.writeFileSync(path.join(folder,'binding.json'),JSON.stringify(descriptor),{mode:0o600});
  }};
}
test('a Desktop continuation of a joined conversation joins the new session once with the same topic',async t=>{
  const f=await fixture(t),r=registry(f),s=await simulator(t,f,undefined,{registryRoot:r.root}),runs=[];
  s.$.process.run=async argv=>{runs.push(argv);return {exitCode:0,stdout:'',stderr:''};};
  const previous=randomUUID(),other=randomUUID(),folder=path.join(r.root,'c'.repeat(64));fs.mkdirSync(folder,{mode:0o700});
  fs.writeFileSync(path.join(folder,'resident.json'),JSON.stringify({runtime:'claude-code',label:'Synthetic topic',
    binding:{workspace:s.state.cwd,route:{session_id:previous}},rejoin:{node:'/usr/local/bin/node',cli:'/synthetic/questions/cli.mjs'}}));
  const settle=()=>new Promise(resolve=>setTimeout(resolve,20));
  await s.fire('prompt.submit',{text:'Ordinary first prompt mentioning '+previous+'.jsonl'});await settle();assert.equal(runs.length,0);
  const summary=id=>'This session is being continued from a previous conversation that ran out of context.\nTranscript: /x/'+id+'.jsonl';
  await s.fire('prompt.submit',{text:summary(other)});await settle();assert.equal(runs.length,0);
  const g=await fixture(t),h=registry(g),u=await simulator(t,g,undefined,{registryRoot:h.root}),later=[];
  u.$.process.run=async argv=>{later.push(argv);return {exitCode:0,stdout:'',stderr:''};};
  const folder2=path.join(h.root,'d'.repeat(64));fs.mkdirSync(folder2,{mode:0o700});
  fs.writeFileSync(path.join(folder2,'resident.json'),JSON.stringify({runtime:'claude-code',label:'Synthetic topic',
    binding:{workspace:u.state.cwd,route:{session_id:previous}},rejoin:{node:'/usr/local/bin/node',cli:'/synthetic/questions/cli.mjs'}}));
  await u.fire('prompt.submit',{text:summary(previous)});await settle();
  assert.equal(later.length,1);assert.deepEqual(later[0].slice(4),[u.state.cwd,JSON.stringify({topic:'Synthetic topic'}),u.state.sessionId,'/usr/local/bin/node','/synthetic/questions/cli.mjs']);
  await u.fire('prompt.submit',{text:summary(previous)});await settle();assert.equal(later.length,1);
});

test('global Mod stays inert until a registry descriptor for this exact session exists',async t=>{
  const f=await fixture(t),r=registry(f),s=await simulator(t,f,undefined,{registryRoot:r.root});
  await s.discover();assert.deepEqual(s.state.network,[]);assert.equal(s.state.submissions.length,0);
  const plain=await s.fire('prompt.submit',{text:stamp(randomUUID())+'ordinary text'});assert(plain.event);
  r.write({...f.descriptor(),session_id:randomUUID()});await s.discover();assert.deepEqual(s.state.network,[]);
  // The shell may have moved the session's folder since it joined; the session id still finds it.
  s.state.cwd+='/moved';r.write();await s.discover();assert.equal(f.broker.lifecycle().connected,true);
  assert.equal(s.state.submissions.length,0);assert.equal((await f.broker.host.status()).busy,true);
});
test('joining an already-running local turn exposes identity and interrupt but never invents pre-tool coverage',async t=>{
  const witness={async bind(){},async begin(){assert.fail('late join cannot start a pre-tool scope');},async inspect(){return {observed:true,quiescent:true};},close(){}};
  const f=await fixture(t,{witness}),r=registry(f),s=await simulator(t,f,undefined,{registryRoot:r.root});
  await s.fire('turn.start',{turnId:'native-already-working',text:'Private native text is not sent to the broker'});
  r.write();await s.discover();await s.tick();
  const rows=await f.broker.host.activitySnapshot();assert.equal(rows.length,1);assert.equal(rows[0].turnId,'native-already-working');assert.equal(rows[0].coverage,0);assert.equal(rows[0].status,'inProgress');
  assert(!JSON.stringify(f.broker.snapshot()).includes('Private native text'));
  await f.broker.host.interrupt('native-already-working');await s.tick(2);assert.deepEqual(s.state.aborts,[{turnId:'native-already-working'}]);
  await s.fire('turn.complete',{turnId:'native-already-working',isAborted:true,answer:'Partial original result'});await s.tick(3);
  assert.equal((await f.broker.host.inspectStop('native-already-working')).descendantsStopped,false);
  assert.equal((await f.broker.host.inspectOperation(rows[0].operationId)).status,'interrupted');assert.equal(s.state.submissions.length,0);
});
test('local native turn coverage awaits broker baseline and tracks its complete exact tool ledger',async t=>{
  let began=0;
  const witness={async bind(){},async begin(id){assert.equal(id,'native-covered');began++;},async inspect(){return {observed:true,quiescent:true};},close(){}};
  const f=await fixture(t,{witness}),r=registry(f);r.write();const s=await simulator(t,f,undefined,{registryRoot:r.root});
  await s.fire('turn.start',{turnId:'native-covered',text:'Local work'});assert.equal(began,1);
  const [row]=await f.broker.host.activitySnapshot();assert.equal(row.coverage,1);assert.equal(row.status,'inProgress');
  await s.fire('tool.call',{turnId:'native-covered',tool:'Read',tool_use_id:'local_read_1'},async()=>({result:{content:'Synthetic'}}));
  await f.broker.host.interrupt('native-covered');await s.tick(2);
  await s.fire('turn.complete',{turnId:'native-covered',isAborted:true,answer:'Actual partial'});await s.tick(4);
  const proof=await f.broker.host.inspectStop('native-covered');assert.equal(proof.descendantsStopped,true);assert.equal(proof.workStop.coverage,1);assert.equal(began,1);
  const result=await f.broker.host.inspectOperation(row.operationId);assert.equal(result.turnId,'native-covered');assert.equal(result.status,'interrupted');
});
test('observe-start is authenticated and idempotent by native turn; a later call cannot upgrade partial coverage',async t=>{
  const f=await fixture(t);await f.request('/v1/bind');
  const body={turn_id:'native-original',coverage:0};const first=await f.request('/v1/observe-start',body),again=await f.request('/v1/observe-start',{...body,coverage:1});
  assert.equal(first.operation_id,again.operation_id);assert.equal(again.coverage,0);assert.equal(f.broker.snapshot().length,1);
  assert.equal((await f.request('/v1/observe-start',{...body,session_id:randomUUID()})).error,'CLAUDE_MOD_ROUTE_MISMATCH');
  assert.equal((await f.request('/v1/observe-start',{...body,instance_id:'different-instance'})).error,'CLAUDE_MOD_INSTANCE_STALE');
  assert.equal((await f.request('/v1/observe-start',{turn_id:'other',coverage:2})).error,'CLAUDE_MOD_OBSERVATION_INVALID');
  await f.restart();assert.equal((await f.broker.host.activitySnapshot()).length,0);assert.equal((await f.broker.host.inspectOperation(first.operation_id)).status,'unknown');
});
test('registry disappearance disables network and duplicate exact descriptors never select one arbitrarily',async t=>{
  const f=await fixture(t),r=registry(f);r.write();const s=await simulator(t,f,undefined,{registryRoot:r.root});
  await s.tick();const before=s.state.network.length;
  fs.unlinkSync(path.join(r.root,'a'.repeat(64),'binding.json'));await s.discover();await s.tick(3);assert.equal(s.state.network.length,before);
  r.write();r.write(f.descriptor(),'b'.repeat(64));await s.discover();await s.tick(2);assert.equal(s.state.network.length,before);
});
test('global discovery survives clear and binds only a newly joined replacement session',async t=>{
  const f=await fixture(t),r=registry(f);r.write();const s=await simulator(t,f,undefined,{registryRoot:r.root});
  await s.fire('session.end',{reason:'clear'});assert.equal(f.broker.lifecycle().ended,true);assert.equal(f.broker.lifecycle().endReason,'clear');
  const second=await fixture(t);s.state.sessionId=second.binding.route.session_id;s.state.cwd=second.binding.workspace;
  await s.discover();assert.equal(second.broker.lifecycle().bound,false);
  r.write(second.descriptor(),'b'.repeat(64));await s.discover();assert.equal(second.broker.lifecycle().connected,true);
  await s.fire('turn.start',{turnId:'new-session-turn',text:'Local new session'});await s.fire('turn.complete',{turnId:'new-session-turn',answer:'Real final'});await s.tick(3);
  assert.equal((await second.broker.host.activitySnapshot())[0].status,'completed');assert.equal((await f.broker.host.activitySnapshot()).length,0);
  await s.fire('session.end',{reason:'prompt_input_exit'});assert(s.state.timers.every(t=>t.cancelled));
});
test('descriptor rotation reconnects the same binding without replaying a completed native submission',async t=>{
  const f=await fixture(t),r=registry(f);r.write();const s=await simulator(t,f,undefined,{registryRoot:r.root}),id=await f.enqueue();
  await s.tick();await s.admit(0,'remote-once');await s.fire('turn.complete',{turnId:'remote-once',answer:'Completed once'});await s.tick(4);
  assert.equal(s.state.submissions.length,1);const old=f.descriptor();await f.restart();assert.notEqual(f.descriptor().token,old.token);r.write();await s.discover();await s.tick(4);
  assert.equal(f.broker.lifecycle().connected,true);assert.equal(s.state.submissions.length,1);assert.equal((await f.broker.host.inspectOperation(id)).status,'completed');
});

test('lost local observation reply degrades coverage rather than replaying input or blocking local tools',async t=>{
  let began=0;const witness={async bind(){},async begin(){began++;},async inspect(){return {observed:true,quiescent:true};},close(){}};
  const f=await fixture(t,{witness}),s=await simulator(t,f);s.state.lostResponse='/v1/observe-start';
  await s.fire('turn.start',{turnId:'local-lost-ack',text:'Private local work'});await s.tick(2);
  const [row]=await f.broker.host.activitySnapshot();assert.equal(row.coverage,0);assert.equal(began,1);assert.equal(s.state.submissions.length,0);
  await s.fire('turn.complete',{turnId:'local-lost-ack',isAborted:true,answer:'Partial'});await s.tick(3);
  assert.equal((await f.broker.host.inspectStop('local-lost-ack')).descendantsStopped,false);
});
test('a removed registry root disables a previously joined Mod without more network calls',async t=>{
  const f=await fixture(t),r=registry(f);r.write();const s=await simulator(t,f,undefined,{registryRoot:r.root});await s.tick();
  const before=s.state.network.length;fs.renameSync(r.root,r.root+'-removed');await s.discover();await s.tick(2);assert.equal(s.state.network.length,before);
});

test('registry traversal refuses symlink descriptors and more than 64 session directories',async t=>{
  const f=await fixture(t),r=registry(f),s=await simulator(t,f,undefined,{registryRoot:r.root});
  const slot=path.join(r.root,'a'.repeat(64));fs.mkdirSync(slot);fs.symlinkSync(f.broker.configFile,path.join(slot,'binding.json'));await s.discover();assert.deepEqual(s.state.network,[]);
  fs.unlinkSync(path.join(slot,'binding.json'));r.write();
  for(let i=0;i<64;i++)fs.mkdirSync(path.join(r.root,'other-'+i));
  await s.discover();assert.deepEqual(s.state.network,[]);assert.equal(f.broker.lifecycle().bound,false);
  for(let i=0;i<64;i++)fs.rmdirSync(path.join(r.root,'other-'+i));
  fs.writeFileSync(path.join(r.root,'.non-session-metadata'),'metadata');await s.discover();assert.equal(f.broker.lifecycle().connected,true);
});
