import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {MaterialStore} from '../../material-server/store.mjs';
import {listen} from '../../material-server/http.mjs';
import {BridgeClient,BridgeError} from '../client.mjs';
import {SessionDirectoryPublisher,validateDirectory} from '../session-directory.mjs';
import {setDirectoryDefault} from '../directory-default.mjs';
import {AgentBridge} from '../bridge.mjs';

async function setup(t){
  const dir=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'io-directory-client-')));let now=Date.now();
  const store=new MaterialStore(path.join(dir,'store.sqlite'),{clock:()=>now}),server=await listen(store);
  const agent=store.devices.enroll({owner:'synthetic-directory-owner',role:'agent',label:'Synthetic Mac'});
  const credentials=path.join(dir,'credential.json');fs.writeFileSync(credentials,JSON.stringify(agent),{mode:0o600});
  const config={schema_version:'1.0',base_url:`http://127.0.0.1:${server.address().port}/v1/`,allow_loopback_http:true,
    server_id:agent.server_id,owner_id:agent.owner_id,producer_id:agent.producer_id,credential_file:credentials,
    computer_id:'synthetic-mac',agent_id:'codex',state_file:path.join(dir,'bridge.json')};
  const client=new BridgeClient(config,{clock:()=>now}),route={computer_id:config.computer_id,agent_id:config.agent_id,project_id:'directory-proof',session_id:randomUUID()};
  const session={route,host_kind:'codex',workspace:dir,availability:'online',busy:false,can_execute:true,exact_turn_interrupt:true,
    descendants_proof:false,atomic_queue_append:true,native_queue_expiry:false,reason:null};
  const adapter={async readinessSnapshot(){return{schema_version:1,observed_at:new Date(now).toISOString(),sessions:[structuredClone(session)]};}};
  const publishers=[];
  const publisher=(override={})=>{const p=new SessionDirectoryPublisher({client,adapter,clock:()=>now,...override});publishers.push(p);return p;};
  t.after(async()=>{for(const p of publishers)await p.stop();await new Promise(r=>server.close(r));store.close();fs.rmSync(dir,{recursive:true,force:true});});
  return{dir,store,agent,config,client,route,session,adapter,publisher,clock:()=>now,advance:ms=>{now+=ms;},read:async()=>validateDirectory(await client.agentSessions(),config)};
}

test('native readiness publishes renewable lease; offline observation and stop release do not change default',async t=>{
  const f=await setup(t),p=f.publisher();await p.tick();assert.equal(p.status().error,null);
  let page=await f.read();assert.equal(page.sessions.length,1);assert.equal(page.sessions[0].online,true);assert.equal(page.default.route,null);
  await setDirectoryDefault({client:f.client,stateFile:path.join(f.dir,'default.json'),route:f.route});
  const first=page.sessions[0];f.advance(15000);f.session.busy=true;await p.tick();page=await f.read();
  assert.equal(page.sessions[0].busy,true);assert(Date.parse(page.sessions[0].lease_expires_at)>Date.parse(first.lease_expires_at));
  f.session.availability='offline';f.advance(15000);await p.tick();page=await f.read();
  assert.equal(page.sessions[0].online,false);assert.equal(page.sessions[0].capabilities.can_execute,false);assert.deepEqual(page.default.route,f.route);
  await p.stop();assert.equal((await f.read()).sessions[0].reason,'lease_released');
});

test('fresh instance cannot steal a live unavailable lease; expired generation can be acquired',async t=>{
  const f=await setup(t),a=f.publisher(),b=f.publisher();await a.tick();
  f.session.availability='offline';await a.tick();f.session.availability='online';await b.tick();assert.equal(b.status().error,'SESSION_DIRECTORY_LEASE_HELD');
  const first=(await f.read()).sessions[0];f.advance(60001);await b.tick();const next=(await f.read()).sessions[0];assert.equal(next.generation,first.generation+1);assert.notEqual(next.instance_id,first.instance_id);
  await a.stop();assert.equal((await f.read()).sessions[0].online,true);
});

test('lost acquire reply retries identical bytes without extending its old lease',async t=>{
  const f=await setup(t),send=f.client.publishAgentSession.bind(f.client);let lose=true;const inputs=[];
  f.client.publishAgentSession=async input=>{inputs.push(structuredClone(input));const result=await send(input);if(lose){lose=false;throw new BridgeError('NETWORK_UNAVAILABLE',{retryable:true});}return result;};
  const p=f.publisher();await p.tick();const first=(await f.read()).sessions[0];f.advance(1000);await p.tick();const after=(await f.read()).sessions[0];
  assert.deepEqual(inputs[0],inputs[1]);assert.equal(first.lease_expires_at,after.lease_expires_at);assert.equal(p.status().error,null);
});

test('ambiguous online write is released when new observation is offline, never replayed into a new lease',async t=>{
  const f=await setup(t),send=f.client.publishAgentSession.bind(f.client),actions=[];let lose=true;
  f.client.publishAgentSession=async input=>{actions.push(input.action);const result=await send(input);if(lose){lose=false;throw new BridgeError('NETWORK_UNAVAILABLE',{retryable:true});}return result;};
  const p=f.publisher();await p.tick();f.session.availability='offline';f.advance(1000);await p.tick();
  assert.deepEqual(actions,['acquire','release']);assert.equal((await f.read()).sessions[0].online,false);
});

test('shutdown reconciles uncertain metadata through GET and only sends release',async t=>{
  const f=await setup(t),send=f.client.publishAgentSession.bind(f.client),actions=[];let lose=true;
  f.client.publishAgentSession=async input=>{actions.push(input.action);const result=await send(input);if(lose){lose=false;throw new BridgeError('NETWORK_UNAVAILABLE',{retryable:true});}return result;};
  const p=f.publisher();await p.tick();await p.stop();assert.deepEqual(actions,['acquire','release']);assert.equal((await f.read()).sessions[0].reason,'lease_released');
});

for(const phase of ['readiness','directory'])test(`shutdown while awaiting ${phase} cannot later acquire a lease`,async t=>{
  const f=await setup(t);let resolve,entered;const gate=new Promise(r=>{resolve=r;}),started=new Promise(r=>{entered=r;});
  if(phase==='readiness'){const read=f.adapter.readinessSnapshot.bind(f.adapter);f.adapter.readinessSnapshot=async()=>{entered();await gate;return read();};}
  else{const read=f.client.agentSessions.bind(f.client);f.client.agentSessions=async()=>{entered();await gate;return read();};}
  let writes=0;const send=f.client.publishAgentSession.bind(f.client);f.client.publishAgentSession=input=>{writes++;return send(input);};
  const p=f.publisher(),tick=p.tick();await started;const stopped=p.stop();resolve();await Promise.all([tick,stopped]);await p.tick();
  assert.equal(writes,0);assert.equal((await f.read()).sessions.length,0);
});

test('one invalid binding cannot prevent another session lease; unknown busy uses native queue capability',async t=>{
  const f=await setup(t);f.adapter.readinessSnapshot=async()=>({schema_version:1,observed_at:new Date(f.clock()).toISOString(),sessions:[
    {...f.session,workspace:'relative-not-canonical',route:{...f.route,session_id:randomUUID()}},{...f.session,busy:null,reason:'CLAUDE_MOD_BUSY_UNKNOWN'}]});
  const p=f.publisher();await p.tick();const page=await f.read();assert.equal(page.sessions.length,1);assert.deepEqual(page.sessions[0].route,f.route);assert.equal(page.sessions[0].busy,null);assert.equal(page.sessions[0].reason,'claude_mod_busy_unknown');
});

test('malformed route or label entries cannot stop healthy lease acquisition and renewal',async t=>{
  const f=await setup(t),invalid=[null,{...f.session,route:{...f.route,project_id:'资料项目'}},
    {...f.session,route:{...f.route,session_id:'ABCDEF01-2345-6789-ABCD-EF0123456789'}},
    {...f.session,route:{...f.route,session_id:randomUUID()},label:'🙂'.repeat(33)}];
  f.adapter.readinessSnapshot=async()=>({schema_version:1,observed_at:new Date(f.clock()).toISOString(),sessions:[...invalid,f.session]});
  const p=f.publisher();await p.tick();let page=await f.read();
  assert.equal(p.status().error,'SESSION_DIRECTORY_INVALID');assert.equal(page.sessions.length,1);assert.deepEqual(page.sessions[0].route,f.route);
  const first=page.sessions[0].lease_expires_at;f.advance(15000);await p.tick();page=await f.read();
  assert.equal(p.status().error,'SESSION_DIRECTORY_INVALID');assert(Date.parse(page.sessions[0].lease_expires_at)>Date.parse(first));
});

test('duplicate route observations are all quarantined while an unrelated route keeps renewing',async t=>{
  const f=await setup(t),other={...f.session,route:{...f.route,session_id:randomUUID()}};let duplicate=false;
  f.adapter.readinessSnapshot=async()=>({schema_version:1,observed_at:new Date(f.clock()).toISOString(),sessions:[f.session,other,...(duplicate?[{...f.session,busy:true},f.session]:[])]});
  const p=f.publisher();await p.tick();const before=(await f.read()).sessions,byId=rows=>new Map(rows.map(s=>[s.route.session_id,s]));
  duplicate=true;f.advance(15000);await p.tick();const after=byId((await f.read()).sessions),first=byId(before);
  assert.equal(p.status().error,'SESSION_DIRECTORY_INVALID');
  assert.equal(after.get(f.route.session_id).lease_expires_at,first.get(f.route.session_id).lease_expires_at);
  assert(Date.parse(after.get(other.route.session_id).lease_expires_at)>Date.parse(first.get(other.route.session_id).lease_expires_at));
});

test('labels retain explicit UTF-16-bounded text and otherwise use the project display fallback',async t=>{
  const f=await setup(t);f.route.project_id='p'.repeat(128);f.session.route=f.route;
  const named={...f.session,route:{...f.route,session_id:randomUUID()},label:'🙂'.repeat(32)};
  f.adapter.readinessSnapshot=async()=>({schema_version:1,observed_at:new Date(f.clock()).toISOString(),sessions:[f.session,named]});
  const p=f.publisher();await p.tick();const rows=new Map((await f.read()).sessions.map(s=>[s.route.session_id,s]));
  assert.equal(p.status().error,null);assert.equal(rows.get(f.route.session_id).label,'p'.repeat(64));assert.equal(rows.get(named.route.session_id).label,named.label);
});

test('directory realm mismatch refuses publication and never falls back to a local question registration',async t=>{
  const f=await setup(t),read=f.client.agentSessions.bind(f.client);let writes=0;
  f.client.agentSessions=async()=>({...await read(),owner_id:'other-owner'});f.client.publishAgentSession=async()=>{writes++;};
  const p=f.publisher();await p.tick();assert.equal(p.status().error,'SESSION_DIRECTORY_INVALID');assert.equal(writes,0);
});

test('slow directory reads cannot publish an old online observation as a fresh lease',async t=>{
  const f=await setup(t),read=f.client.agentSessions.bind(f.client);let writes=0;
  f.client.agentSessions=async()=>{const page=await read();f.advance(16000);return page;};f.client.publishAgentSession=async()=>{writes++;};
  const p=f.publisher();await p.tick();assert.equal(writes,0);assert.equal(p.status().error,'SESSION_DIRECTORY_OBSERVATION_STALE');
});

test('lost default ACK survives restart and never overwrites a later explicit default change',async t=>{
  const f=await setup(t),p=f.publisher();await p.tick();const file=path.join(f.dir,'default.json'),send=f.client.setAgentDefault.bind(f.client);let lose=true;const inputs=[];
  f.client.setAgentDefault=async input=>{inputs.push(structuredClone(input));const reply=await send(input);if(lose){lose=false;throw new BridgeError('NETWORK_UNAVAILABLE',{retryable:true});}return reply;};
  await assert.rejects(setDirectoryDefault({client:f.client,stateFile:file,route:f.route}),e=>e.code==='NETWORK_UNAVAILABLE');assert.equal(fs.existsSync(file),true);
  await send({request_id:randomUUID(),expected_revision:1,route:null});
  await assert.rejects(setDirectoryDefault({client:f.client,stateFile:file,route:null}),e=>e.code==='DEFAULT_UPDATE_PENDING');
  const result=await setDirectoryDefault({client:f.client,stateFile:file,route:f.route});assert.deepEqual(inputs[0],inputs[1]);assert.equal(result.changed_since_apply,true);assert.deepEqual(result.applied.route,f.route);assert.equal(result.current.route,null);assert.equal(fs.existsSync(file),false);
});

test('default CAS rejection clears only the failed local intent and does not override another device',async t=>{
  const f=await setup(t),p=f.publisher();await p.tick();const file=path.join(f.dir,'default.json'),send=f.client.setAgentDefault.bind(f.client);
  f.client.setAgentDefault=async input=>{await send({request_id:randomUUID(),expected_revision:0,route:null});return send(input);};
  await assert.rejects(setDirectoryDefault({client:f.client,stateFile:file,route:f.route}),e=>e.code==='DEFAULT_REVISION_CONFLICT');assert.equal(fs.existsSync(file),false);assert.equal((await f.read()).default.route,null);
});

test('authentication failure after a lost default ACK retains the original durable CAS intent',async t=>{
  const f=await setup(t),p=f.publisher();await p.tick();const file=path.join(f.dir,'default.json'),send=f.client.setAgentDefault.bind(f.client);
  f.client.setAgentDefault=async input=>{await send(input);throw new BridgeError('NETWORK_UNAVAILABLE',{retryable:true});};
  await assert.rejects(setDirectoryDefault({client:f.client,stateFile:file,route:f.route}));const before=fs.readFileSync(file);
  f.client.setAgentDefault=async()=>{throw new BridgeError('AUTH_REQUIRED',{status:401,permanent:true});};
  await assert.rejects(setDirectoryDefault({client:f.client,stateFile:file,route:f.route}),e=>e.code==='AUTH_REQUIRED');assert.deepEqual(fs.readFileSync(file),before);
  f.client.setAgentDefault=send;assert.deepEqual((await setDirectoryDefault({client:f.client,stateFile:file,route:f.route})).applied.route,f.route);
});

test('session-list and default CLI never start the configured model adapter',async t=>{
  const f=await setup(t),p=f.publisher();await p.tick();const marker=path.join(f.dir,'started'),filename=path.join(f.dir,'config.json');
  fs.writeFileSync(filename,JSON.stringify({...f.config,adapter_command:[process.execPath,'-e',`require('node:fs').writeFileSync(${JSON.stringify(marker)},'started')`]}),{mode:0o600});
  async function run(action,args=[]){return new Promise((resolve,reject)=>{const child=spawn(process.execPath,[fileURLToPath(new URL('../cli.mjs',import.meta.url)),action,'--config',filename,...args]);let stdout='',stderr='';child.stdout.on('data',v=>stdout+=v);child.stderr.on('data',v=>stderr+=v);child.on('error',reject);child.on('close',status=>{assert.equal(status,0,stderr);resolve(JSON.parse(stdout));});});}
  assert.equal((await run('sessions')).sessions.length,1);assert.deepEqual((await run('set-default',['--session',f.route.session_id])).applied.route,f.route);
  assert.equal((await run('clear-default')).applied.route,null);assert.equal(fs.existsSync(marker),false);
});

test('bridge stop during adapter start cannot leak a late directory publisher',async t=>{
  const f=await setup(t);let release,entered,probes=0;const gate=new Promise(r=>{release=r;}),started=new Promise(r=>{entered=r;});
  const adapter={name:'synthetic-native',capabilities:{can_execute:true},async start(){entered();await gate;},stop(){},onItem(){return[];},onAnswer(){return[];},readinessSnapshot(){probes++;return f.adapter.readinessSnapshot();}};
  const bridge=new AgentBridge({config:f.config,adapter,clock:f.clock});const starting=bridge.start();await started;const stopping=bridge.stop();release();await Promise.all([starting,stopping]);
  await new Promise(r=>setTimeout(r,25));assert.equal(probes,0);assert.equal((await f.read()).sessions.length,0);
});

test('blocked bridge and observe-only adapter never advertise executable native input',async t=>{
  const f=await setup(t),adapter={name:'synthetic-native',capabilities:{can_execute:false},onItem(){return[];},onAnswer(){return[];},readinessSnapshot:()=>f.adapter.readinessSnapshot()};
  let bridge=new AgentBridge({config:f.config,adapter,clock:f.clock});
  async function published(){for(let i=0;i<30;i++){const s=(await f.read()).sessions[0];if(s?.online)return s;await new Promise(r=>setTimeout(r,10));}assert.fail('directory did not publish bounded synthetic readiness');}
  try{
    await bridge.start();const first=await published();assert.equal(first.capabilities.can_execute,false);assert.equal(first.reason,'adapter_observe_only');
    bridge.state.value.blocked={code:'FORBIDDEN',key:'synthetic'};bridge.state.save();await bridge.stop();
    adapter.capabilities.can_execute=true;bridge=new AgentBridge({config:f.config,adapter,clock:f.clock});await bridge.start();const second=await published();assert.equal(second.capabilities.can_execute,false);assert.equal(second.reason,'bridge_blocked');
  }finally{await bridge.stop();}
});
