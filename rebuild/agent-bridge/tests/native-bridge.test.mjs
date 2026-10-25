import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {MaterialStore} from '../../material-server/store.mjs';
import {listen} from '../../material-server/http.mjs';
import {AgentBridge} from '../bridge.mjs';
import {NativeRuntimeAdapter} from '../hosts/native-runtime.mjs';
import {createNativeBridgeAdapter} from '../hosts/native-config.mjs';

async function setup(t){
  const dir=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'io-native-bridge-')));let now=Date.now();
  const store=new MaterialStore(path.join(dir,'store.sqlite'),{clock:()=>now});
  const phone=store.mint({owner:'synthetic',producer:'phone',scopes:['tasks:write','tasks:update','tasks:read','requests:read','messages:receive','answers:write']});
  const agent=store.mint({owner:'synthetic',producer:'pc',scopes:['tasks:read','tasks:update','requests:write','messages:receive','messages:write','receipts:agent']});
  const server=await listen(store),identity=store.identity(agent.token),credential=path.join(dir,'credential.json');
  fs.writeFileSync(credential,JSON.stringify(agent),{mode:0o600});
  const route={computer_id:'computer',agent_id:'codex',project_id:'workspace',session_id:randomUUID()};
  const binding={server_id:identity.server_id,owner_id:identity.owner_id,host_kind:'codex',workspace:dir,route};
  const config={schema_version:'1.0',base_url:`http://127.0.0.1:${server.address().port}/v1/`,allow_loopback_http:true,
    owner_id:identity.owner_id,producer_id:'pc',server_id:identity.server_id,computer_id:route.computer_id,agent_id:route.agent_id,
    credential_file:credential,state_file:path.join(dir,'bridge.json')};
  const host={conversationId:route.session_id,capabilities:{atomic_queue_append:true,exact_turn_interrupt:true,final_result_evidence:true},
    operations:new Map(),starts:[],stops:[],stoppedProof:false,
    async status(){const current=[...this.operations.values()].find(x=>x.status==='inProgress');return{conversationId:this.conversationId,workspace:dir,busy:Boolean(current),activeTurnId:current?.turnId??null};},
    async start(input){this.starts.push(input);this.operations.set(input.clientUserMessageId,{found:true,turnId:randomUUID(),status:'inProgress',resultComplete:false});return{accepted:true,clientUserMessageId:input.clientUserMessageId};},
    async inspectOperation(id){return structuredClone(this.operations.get(id));},
    async interrupt(turnId){this.stops.push(turnId);[...this.operations.values()].find(x=>x.turnId===turnId).status='interrupted';return{requested:true,expectedTurnId:turnId};},
    async inspectStop(turnId){return{conversationId:this.conversationId,turnId,terminal:true,descendantsStopped:this.stoppedProof};},close(){}};
  const bridges=[],adapters=[];
  t.after(async()=>{for(const b of bridges)await b.stop();for(const a of adapters)await a.stop();await new Promise(r=>server.close(r));store.close();fs.rmSync(dir,{recursive:true,force:true});});
  const makeAdapter=()=>{const a=new NativeRuntimeAdapter({stateFile:path.join(dir,'runtime.json'),bindings:[{binding,host}],clock:()=>now});adapters.push(a);return a;};
  const bridge=(a=makeAdapter(),options={})=>{const b=new AgentBridge({config,adapter:a,clock:()=>now,...options});bridges.push(b);return b;};
  const post=(body,principal=phone)=>store.queueSubmit(principal.token,{schema_version:'1.0',event_id:randomUUID(),idempotency_key:randomUUID(),kind:'task',producer_id:principal===phone?'phone':'pc',created_at:new Date(now).toISOString(),expires_at:new Date(now+3600000).toISOString(),body},'task');
  const task=()=>store.queueGet(phone.token,'task','task-synthetic');
  const control=(kind,text)=>{const current=task().body;const c={control_id:randomUUID(),kind,expected_command_id:current.execution.command_id,expected_turn_id:current.execution.turn_id,expires_at:new Date(now+60000).toISOString(),...(text?{text}:{})};post({...current,revision:current.revision+1,state:kind==='stop'?'stop_requested':'resume_requested',control:c});return c;};
  return{dir,store,phone,agent,config,binding,host,route,bridge,makeAdapter,post,task,control,clock:()=>now,advance:ms=>{now+=ms;},
    submit:()=>post({task_id:'task-synthetic',revision:1,route,state:'queued',command:'Only this session',allow_create_session:false})};
}

test('native task traverses real HTTP/SQLite; exact stop evidence gates resume and complete result returns to phone',async t=>{
  const f=await setup(t);f.submit();const b=f.bridge();await b.start();await b.pollOnce();await b.pollOnce();
  assert.equal(f.task().state,'running');assert.equal(f.host.starts.length,1);const original=f.task().body.execution;
  f.control('stop');await b.pollOnce();assert.equal(f.task().state,'stop_unconfirmed');assert.deepEqual(f.host.stops,[original.turn_id]);
  assert.throws(()=>f.control('resume','Must not run'),e=>e.code==='INVALID_STATE_TRANSITION'||e.code==='STATE_CONFLICT'||e.code==='TASK_CONTROL_STALE');
  f.host.stoppedProof=true;await b.pollOnce();assert.equal(f.task().state,'stopped');
  const continuation=f.control('resume','Continue in the same context');await b.pollOnce();await b.pollOnce();
  assert.equal(f.host.starts.length,2);assert.equal(f.task().body.execution.command_id,continuation.control_id);
  assert.equal(f.host.starts[1].text,'Continue in the same context');assert.deepEqual(f.task().body.route,f.route);
  const result='本次完整结果🙂'.repeat(12000);const native=[...f.host.operations.values()].at(-1);Object.assign(native,{status:'completed',resultComplete:true,result:{type:'text',text:result}});
  await b.pollOnce();assert.equal(f.task().state,'completed');
  const messages=f.store.db.prepare("SELECT body FROM queue_revisions WHERE kind='message' ORDER BY seq").all().map(r=>JSON.parse(r.body));
  assert.equal(messages.map(m=>m.text).join(''),result);assert(messages.every(m=>m.channel==='result'&&m.route.session_id===f.route.session_id));
  await b.pollOnce();assert.equal(f.host.starts.length,2);assert.equal(f.host.stops.length,1);
});

test('control intake lost reply reconciles on restart without repeating host interrupt',async t=>{
  const f=await setup(t);f.submit();let a=f.makeAdapter(),b=f.bridge(a);await b.start();await b.pollOnce();await b.pollOnce();
  const c=f.control('stop'),original=a.onItem.bind(a);let dropped=false;
  a.onItem=async(item,ctx)=>{const result=await original(item,ctx);if(item.body.control?.control_id===c.control_id&&!dropped){dropped=true;throw Object.assign(new Error('LOST_REPLY'),{code:'LOST_REPLY'});}return result;};
  await assert.rejects(b.pollOnce(),e=>e.code==='LOST_REPLY');assert.equal(f.host.stops.length,0);await b.stop();
  b=f.bridge();await b.start();await b.pollOnce();assert.equal(f.host.stops.length,1);assert.equal(f.task().state,'stop_unconfirmed');
  assert.equal(Object.keys(b.state.value.control_intake_reconciliations).length,1);await b.pollOnce();assert.equal(f.host.stops.length,1);
});

test('explicit CLI native config connects lazily and excludes other sessions',async t=>{
  const f=await setup(t);let connects=0;
  const config={...f.config,native_runtime:{state_file:'configured-runtime.json',sessions:[{host_kind:'codex',workspace:f.dir,route:f.route,endpoint:'ws://127.0.0.1:12345'}]}};
  const a=createNativeBridgeAdapter(config,{configDirectory:f.dir,clock:f.clock,connectCodex:async(id,options)=>{connects++;assert.equal(id,f.route.session_id);assert.equal(options.workspace,f.dir);return f.host;}});
  const b=f.bridge(a);assert.equal(connects,0);await b.start();assert.equal(connects,0);
  f.post({task_id:'task-other',revision:1,route:{...f.route,session_id:randomUUID()},state:'queued',command:'Do not run',allow_create_session:false});
  f.submit();await b.pollOnce();await b.pollOnce();assert.equal(connects,1);assert.equal(f.host.starts.length,1);
  assert.equal(f.store.queueGet(f.phone.token,'task','task-other').state,'queued');
  assert.throws(()=>createNativeBridgeAdapter({...config,adapter_command:['unused']},{configDirectory:f.dir}),e=>e.code==='INVALID_NATIVE_CONFIG');
});

test('unsupported server is refused before task handoff',async t=>{
  const f=await setup(t),identity=f.store.identity.bind(f.store);f.store.identity=token=>({...identity(token),capabilities:[]});
  f.submit();const b=f.bridge();await assert.rejects(b.start(),e=>e.code==='SERVER_SESSION_CONTROL_UNSUPPORTED');assert.equal(f.host.starts.length,0);
});

test('a wire-valid overlong task reports unsent failure without blocking a later valid task',async t=>{
  const f=await setup(t);f.post({task_id:'task-too-long',revision:1,route:f.route,state:'queued',command:'中'.repeat(20000),allow_create_session:false});f.submit();
  const b=f.bridge();await b.start();await b.pollOnce();await b.pollOnce();
  const refused=f.store.queueGet(f.phone.token,'task','task-too-long');assert.equal(refused.state,'failed');assert.equal(refused.body.execution,undefined);
  assert.equal(f.task().state,'running');assert.equal(f.host.starts.length,1);assert.equal(b.blocked,null);
});

test('first result chunk failure delays later chunks and completion until the original bytes are stored',async t=>{
  const f=await setup(t);f.submit();let fail=true;
  const fetchImpl=async(url,options)=>{
    if(options.method==='POST'&&url.pathname.endsWith('/messages')&&fail){fail=false;return new Response(JSON.stringify({error:{code:'SERVICE_UNAVAILABLE'}}),{status:503,headers:{'Content-Type':'application/json'}});}
    return fetch(url,options);
  };
  const b=f.bridge(f.makeAdapter(),{fetchImpl});await b.start();await b.pollOnce();await b.pollOnce();
  const text='完整正文'.repeat(40000);Object.assign([...f.host.operations.values()][0],{status:'completed',resultComplete:true,result:{type:'text',text}});
  await b.pollOnce();assert.equal(f.task().state,'running');assert.equal(f.store.db.prepare("SELECT COUNT(*) n FROM queue_revisions WHERE kind='message'").get().n,0);
  assert(!f.task().receipts.some(r=>r.stage==='task_completed'));f.advance(5000);await b.pollOnce();assert.equal(f.task().state,'completed');
  const messages=f.store.db.prepare("SELECT body FROM queue_revisions WHERE kind='message' ORDER BY seq").all().map(r=>JSON.parse(r.body));assert.equal(messages.map(m=>m.text).join(''),text);
});

for(const outcome of ['pending','completed'])test(`phone stop racing a ${outcome} update preserves control and never blocks the connector`,async t=>{
  const f=await setup(t);f.submit();let race=false;
  const fetchImpl=async(url,options)=>{
    if(race&&options.method==='POST'&&url.pathname.endsWith('/tasks')){
      const body=JSON.parse(options.body).body;
      if(body.execution?.phase===(outcome==='pending'?'result_pending':'completed')){race=false;f.control('stop');}
    }
    return fetch(url,options);
  };
  const b=f.bridge(f.makeAdapter(),{fetchImpl});await b.start();await b.pollOnce();await b.pollOnce();race=true;
  Object.assign([...f.host.operations.values()][0],{status:'completed',resultComplete:outcome==='completed',result:{type:'text',text:'complete'}});
  await b.pollOnce();assert.equal(b.blocked,null);assert.equal(f.task().state,'stop_requested');
  await b.pollOnce();assert.equal(b.blocked,null);
  if(outcome==='completed'){assert.equal(f.task().state,'completed');assert.equal(f.task().body.control.kind,'stop');}
  else {assert.equal(f.task().state,'stop_requested');Object.assign([...f.host.operations.values()][0],{resultComplete:true});await b.pollOnce();assert.equal(f.task().state,'completed');}
  assert.equal(f.host.starts.length,1);
});

test('accepted historical answer is retained but not delivered into a stopped task',async t=>{
  const f=await setup(t);f.submit();const a=f.makeAdapter();let answers=0;a.onAnswer=()=>{answers++;return[];};
  const b=f.bridge(a);await b.start();await b.pollOnce();await b.pollOnce();
  const send=(kind,body,principal,producer)=>f.store.queueSubmit(principal.token,{schema_version:'1.0',event_id:randomUUID(),idempotency_key:randomUUID(),kind,producer_id:producer,created_at:new Date(f.clock()).toISOString(),expires_at:new Date(f.clock()+3600000).toISOString(),body},kind);
  send('request',{request_id:'old-question',revision:1,task_id:'task-synthetic',route:f.route,mode:'free_text',question:'Old question',options:[],state:'pending',runtime_request_id:null},f.agent,'pc');
  send('answer',{answer_id:'old-answer',task_id:'task-synthetic',request_id:'old-question',request_revision:1,route:f.route,option_id:null,text:'Previously accepted',input_source:'phone',raw_action:null},f.phone,'phone');
  f.control('stop');await b.pollOnce();assert.equal(answers,0);
  const request=f.store.queueGet(f.phone.token,'request','old-question');assert.equal(request.state,'answered');assert.equal(request.answer.body.text,'Previously accepted');
});
