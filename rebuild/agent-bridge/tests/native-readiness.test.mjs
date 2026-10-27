import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {NativeRuntimeAdapter} from '../hosts/native-runtime.mjs';
import {createNativeBridgeAdapter} from '../hosts/native-config.mjs';
import {runtimeDigest} from '../runtime-events.mjs';

// Injected metadata peers only: no user sessions, model, or device is opened.
function fixture(t,count=1){
  const directory=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'native-readiness-'))),instances=[];
  const now=Date.parse('2026-10-25T12:00:00.000Z'),calls=[];
  const bindings=Array.from({length:count},(_,i)=>{
    const binding={server_id:'synthetic-server',owner_id:'synthetic-owner',host_kind:'codex',workspace:directory,
      route:{computer_id:'synthetic-computer',agent_id:'synthetic-agent',project_id:`project-${i}`,session_id:randomUUID()}};
    const status={conversationId:binding.route.session_id,workspace:directory,busy:false,canExecute:true};
    const forbidden=async()=>{throw new Error('directory probe must not execute or read history');};
    const host={conversationId:binding.route.session_id,capabilities:{atomic_queue_append:true,exact_turn_interrupt:true},
      status:forbidden,start:forbidden,inspectOperation:forbidden,interrupt:forbidden,inspectStop:forbidden,
      async readiness(){calls.push(i);return{...status};},async close(){}};
    return{binding,host,status};
  });
  const stateFile=path.join(directory,'runtime.json');
  t.after(async()=>{for(const a of instances)await a.stop();fs.rmSync(directory,{recursive:true,force:true});});
  return{directory,bindings,calls,stateFile,clock:()=>now,
    async open(){const a=new NativeRuntimeAdapter({stateFile,bindings,clock:()=>now});instances.push(a);await a.start();return a;},
    async config({host_kind='codex',label,connectCodex,createClaudeBroker}={}){
      const b=bindings[0].binding;
      const config={server_id:b.server_id,owner_id:b.owner_id,computer_id:b.route.computer_id,agent_id:b.route.agent_id,
        native_runtime:{state_file:'configured.json',sessions:[{host_kind,workspace:directory,route:b.route,...(label===undefined?{}:{label}),
          ...(host_kind==='codex'?{endpoint:'ws://127.0.0.1:12345'}:{broker_directory:'broker'})}]}};
      const a=createNativeBridgeAdapter(config,{configDirectory:directory,clock:()=>now,connectCodex,createClaudeBroker});instances.push(a);await a.start();return a;
    }};
}

test('native configuration and direct runtime reject non-directory routes before opening a host',t=>{
  const f=fixture(t),b=f.bindings[0].binding;let connects=0;
  const routes=[{...b.route,project_id:'资料项目'},{...b.route,computer_id:'mac:home'},{...b.route,agent_id:'a'.repeat(129)},
    {...b.route,session_id:'ABCDEF01-2345-6789-ABCD-EF0123456789'},{...b.route,extra:'field'}];
  for(const route of routes){
    const config={server_id:b.server_id,owner_id:b.owner_id,computer_id:route.computer_id,agent_id:route.agent_id,
      native_runtime:{state_file:'configured.json',sessions:[{host_kind:'codex',workspace:f.directory,route,endpoint:'ws://127.0.0.1:12345'}]}};
    assert.throws(()=>createNativeBridgeAdapter(config,{configDirectory:f.directory,connectCodex:async()=>{connects++;}}),{code:'INVALID_NATIVE_CONFIG'});
    assert.throws(()=>new NativeRuntimeAdapter({stateFile:f.stateFile,bindings:[{...f.bindings[0],binding:{...b,route}}]}),{code:'NATIVE_RUNTIME_BINDING_INVALID'});
  }
  assert.equal(connects,0);assert.deepEqual(f.calls,[]);assert.equal(fs.existsSync(f.stateFile),false);
});

test('configured display labels are trimmed and can change without changing route identity or journals',async t=>{
  const f=fixture(t),options={connectCodex:async()=>f.bindings[0].host};
  const a=await f.config({...options,label:'  整理本周资料 🙂  '}),digest=a.routeBindingDigest;
  assert.equal((await a.readinessSnapshot()).sessions[0].label,'整理本周资料 🙂');await a.stop();
  const b=await f.config({...options,label:'新的显示主题'});
  assert.equal(b.routeBindingDigest,digest);assert.equal((await b.readinessSnapshot()).sessions[0].label,'新的显示主题');
  assert.deepEqual((await b.readinessSnapshot()).sessions[0].route,f.bindings[0].binding.route);
});

test('configured native lifecycle follows the connected owner without starting it during discovery',async t=>{
  const f=fixture(t);let opened=0,life={closed:false};
  f.bindings[0].host.lifecycle=()=>life;
  const a=await f.config({connectCodex:async()=>{opened++;return f.bindings[0].host;}});
  assert.deepEqual(a.lifecycle(),{closed:false});assert.equal(opened,0);
  await a.readinessSnapshot();assert.equal(opened,1);
  life={closed:false,reason:'transport_closed'};assert.deepEqual(a.lifecycle(),life);
  life={closed:true,reason:'session_closed'};assert.deepEqual(a.lifecycle(),life);
});

test('display labels use the server UTF-16 limit and forbid blank or control-character names',async t=>{
  const f=fixture(t),options={connectCodex:async()=>f.bindings[0].host};
  for(const label of ['   ','x'.repeat(65),'🙂'.repeat(33),'name\nmore','\nname',null,7])
    await assert.rejects(f.config({...options,label}),{code:'INVALID_NATIVE_CONFIG'});
  assert.deepEqual(f.calls,[]);
  const a=await f.config({...options,label:'🙂'.repeat(32)});
  assert.equal((await a.readinessSnapshot()).sessions[0].label,'🙂'.repeat(32));
});

test('readiness is metadata only, preserves the journal, and publishes only fixed bound fields',async t=>{
  const f=fixture(t),a=await f.open(),before=fs.readFileSync(f.stateFile);
  Object.assign(f.bindings[0].status,{preview:'private preview',activeTurnId:'private-turn',descendantsStopped:true});
  const result=await a.readinessSnapshot();
  assert.deepEqual(result,{schema_version:1,observed_at:'2026-10-25T12:00:00.000Z',sessions:[{
    route:f.bindings[0].binding.route,host_kind:'codex',workspace:f.directory,availability:'online',busy:false,
    can_execute:true,exact_turn_interrupt:true,descendants_proof:false,atomic_queue_append:true,native_queue_expiry:false,reason:null}]});
  assert.deepEqual(fs.readFileSync(f.stateFile),before);assert.deepEqual(f.calls,[0]);
  result.sessions[0].route.session_id='mutated';assert.equal((await a.readinessSnapshot()).sessions[0].route.session_id,f.bindings[0].binding.route.session_id);
});

test('identity, workspace, unsupported metadata, system errors and malformed state fail independently',async t=>{
  const f=fixture(t,6),a=await f.open();
  f.bindings[0].status.conversationId=randomUUID();
  f.bindings[1].status.workspace=path.join(f.directory,'other');
  delete f.bindings[2].host.readiness;
  Object.assign(f.bindings[3].status,{busy:null,canExecute:false,reason:'CODEX_APP_SERVER_SYSTEM_ERROR'});
  f.bindings[4].host.readiness=async()=>{throw new Error('secret error /private/path');};
  f.bindings[5].status.busy='idle';
  const result=await a.readinessSnapshot(),byId=new Map(result.sessions.map(s=>[s.route.session_id,s]));
  const row=i=>byId.get(f.bindings[i].binding.route.session_id);
  for(const i of [0,1])assert.equal(row(i).reason,'NATIVE_RUNTIME_READINESS_IDENTITY_MISMATCH');
  assert.equal(row(2).availability,'unknown');assert.equal(row(2).reason,'NATIVE_RUNTIME_READINESS_UNSUPPORTED');
  assert.equal(row(3).availability,'online');assert.equal(row(3).can_execute,false);assert.equal(row(3).reason,'CODEX_APP_SERVER_SYSTEM_ERROR');
  assert.equal(row(4).reason,'NATIVE_RUNTIME_HOST_UNAVAILABLE');assert.equal(row(5).reason,'NATIVE_RUNTIME_READINESS_INVALID');
  assert(result.sessions.every(s=>s.can_execute===false&&s.descendants_proof===false));assert(!JSON.stringify(result).includes('/private/path'));
});

test('busy and unknown can only accept new work when the host has native atomic queue admission',async t=>{
  const f=fixture(t,3),a=await f.open();
  Object.assign(f.bindings[0].status,{busy:true});Object.assign(f.bindings[1].status,{busy:null});
  Object.assign(f.bindings[2].status,{busy:true});f.bindings[2].host.capabilities={atomic_idle_start:true,exact_turn_interrupt:true};
  const result=await a.readinessSnapshot(),byId=new Map(result.sessions.map(s=>[s.route.session_id,s]));
  assert.equal(byId.get(f.bindings[0].binding.route.session_id).can_execute,true);
  assert.equal(byId.get(f.bindings[1].binding.route.session_id).can_execute,true);
  assert.equal(byId.get(f.bindings[2].binding.route.session_id).can_execute,false);
});

test('a lost controller lock disables only its binding even when both native hosts are online',async t=>{
  const f=fixture(t,2),a=await f.open();
  const lock=path.join(f.stateFile+'.sessions',runtimeDigest(f.bindings[0].binding.route)+'.json.run-lock.sqlite');
  // Only a synthetic fixture-owned sidecar is moved; no native process or
  // global lock is touched. The controller's live SQLite handle stays open.
  fs.renameSync(lock,lock+'.moved');
  const result=await a.readinessSnapshot(),byId=new Map(result.sessions.map(s=>[s.route.session_id,s]));
  const lost=byId.get(f.bindings[0].binding.route.session_id),healthy=byId.get(f.bindings[1].binding.route.session_id);
  assert.equal(lost.availability,'online');assert.equal(lost.reason,'LOCK_LOST');
  for(const key of ['can_execute','exact_turn_interrupt','atomic_queue_append'])assert.equal(lost[key],false);
  assert.equal(healthy.can_execute,true);assert.equal(healthy.reason,null);
});

test('controller health is rechecked after another binding finishes a slow metadata read',async t=>{
  const f=fixture(t,2),a=await f.open();let release;
  f.bindings[1].host.readiness=async()=>{await new Promise(resolve=>{release=resolve;});return{...f.bindings[1].status};};
  const pending=a.readinessSnapshot();while(!release)await new Promise(resolve=>setImmediate(resolve));
  const lock=path.join(f.stateFile+'.sessions',runtimeDigest(f.bindings[0].binding.route)+'.json.run-lock.sqlite');
  fs.renameSync(lock,lock+'.moved');release();
  const lost=(await pending).sessions.find(s=>s.route.session_id===f.bindings[0].binding.route.session_id);
  assert.equal(lost.can_execute,false);assert.equal(lost.reason,'LOCK_LOST');
});

test('concurrency is capped at four while a stuck binding cannot block other metadata probes',async t=>{
  const f=fixture(t,8),a=await f.open();let active=0,maximum=0,stuckCalls=0,release;
  const stuck=new Promise(resolve=>{release=resolve;});
  for(const [i,e]of f.bindings.entries())e.host.readiness=async()=>{
    active++;maximum=Math.max(maximum,active);
    try{if(i===0){stuckCalls++;await stuck;}else await new Promise(resolve=>setTimeout(resolve,3));return{...e.status};}
    finally{active--;}
  };
  const before=Date.now(),result=await a.readinessSnapshot({timeoutMs:80});
  assert(Date.now()-before<500);assert(maximum<=4);assert.equal(result.sessions.filter(s=>s.availability==='online').length,7);
  assert.equal(result.sessions.find(s=>s.route.session_id===f.bindings[0].binding.route.session_id).reason,'NATIVE_RUNTIME_READINESS_TIMEOUT');
  await a.readinessSnapshot({timeoutMs:30});assert.equal(stuckCalls,1,'a timed-out pending probe must not be sent again');
  release();await new Promise(resolve=>setImmediate(resolve));assert.equal(active,0);
});

test('overlapping snapshots share bounded probes and stopped runtime cannot publish their late replies',async t=>{
  const f=fixture(t),a=await f.open();let calls=0,release;
  f.bindings[0].host.readiness=()=>{calls++;return new Promise(resolve=>{release=()=>resolve({...f.bindings[0].status});});};
  const first=a.readinessSnapshot({timeoutMs:200}),second=a.readinessSnapshot({timeoutMs:200});
  const checks=[assert.rejects(first,{code:'NATIVE_RUNTIME_NOT_STARTED'}),assert.rejects(second,{code:'NATIVE_RUNTIME_NOT_STARTED'})];
  while(!release)await new Promise(resolve=>setImmediate(resolve));await a.stop();release();await Promise.all(checks);assert.equal(calls,1);
});

test('late metadata from an expired probe cannot restore online until a fresh probe succeeds',async t=>{
  const f=fixture(t),a=await f.open();let calls=0,release;
  f.bindings[0].host.readiness=async()=>{calls++;if(calls===1)await new Promise(resolve=>{release=resolve;});return{...f.bindings[0].status};};
  assert.equal((await a.readinessSnapshot({timeoutMs:10})).sessions[0].availability,'offline');
  assert.equal((await a.readinessSnapshot({timeoutMs:10})).sessions[0].availability,'offline');assert.equal(calls,1);
  release();await new Promise(resolve=>setImmediate(resolve));
  assert.equal((await a.readinessSnapshot()).sessions[0].availability,'online');assert.equal(calls,2);
});

test('configured Codex first heartbeat connects once using metadata-only attachment',async t=>{
  const f=fixture(t);let connections=0,closed=0;
  f.bindings[0].host.close=async()=>{closed++;};
  const a=await f.config({connectCodex:async(id,options)=>{
    connections++;assert.equal(id,f.bindings[0].binding.route.session_id);assert.equal(options.workspace,f.directory);assert.equal(options.metadataOnly,true);return f.bindings[0].host;
  }});
  assert.equal(connections,0);assert.equal((await a.readinessSnapshot()).sessions[0].availability,'online');
  await a.readinessSnapshot();assert.equal(connections,1);assert.deepEqual(f.calls,[0,0]);await a.stop();assert.equal(closed,1);
});

test('configured Claude reports initial busy as unknown and loses availability when its metadata lease expires',async t=>{
  const f=fixture(t);let busy=true,activeTurnId=null,offline=false,statusReads=0;
  const host=f.bindings[0].host;
  host.status=async()=>{statusReads++;if(offline)throw{code:'CLAUDE_MOD_NOT_CONNECTED'};return{conversationId:host.conversationId,workspace:f.directory,busy,activeTurnId};};
  const a=await f.config({host_kind:'claude',createClaudeBroker:async()=>({host,async close(){}})});
  let row=(await a.readinessSnapshot()).sessions[0];assert.equal(row.availability,'online');assert.equal(row.busy,null);assert.equal(row.can_execute,true);assert.equal(row.reason,'CLAUDE_MOD_BUSY_UNKNOWN');
  activeTurnId='exact-native-turn';row=(await a.readinessSnapshot()).sessions[0];assert.equal(row.busy,true);
  activeTurnId=null;busy=false;row=(await a.readinessSnapshot()).sessions[0];assert.equal(row.busy,false);
  offline=true;row=(await a.readinessSnapshot()).sessions[0];assert.equal(row.availability,'offline');assert.equal(row.can_execute,false);assert.equal(row.exact_turn_interrupt,false);
  assert.equal(statusReads,4);assert.deepEqual(f.calls,[]);
});
