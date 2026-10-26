import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {MaterialStore} from '../store.mjs';
import {listen} from '../http.mjs';
import {SESSION_LEASE_MS,MAX_AGENT_SESSIONS,SESSION_ACK_RETENTION_MS} from '../agent-sessions.mjs';

const epoch=Date.parse('2026-10-25T12:00:00Z');
const observation={ready:true,busy:false,can_execute:true,exact_turn_interrupt:true,descendants_proof:false,atomic_queue_append:true,native_queue_expiry:false,reason:null};
const unavailable={...observation,ready:false,busy:null,can_execute:false,exact_turn_interrupt:false,atomic_queue_append:false,reason:'native_disconnected'};
const route=()=>({computer_id:'work-mac',agent_id:'codex',project_id:'glasses',session_id:randomUUID()});
const acquire=(patch={})=>({action:'acquire',request_id:randomUUID(),instance_id:randomUUID(),route:route(),expected_generation:0,
  host_kind:'codex',workspace:'/work/glasses',label:'Codex · 工作 Mac',observation:{...observation},...patch});
const heartbeat=(s,sequence=1,patch={})=>({action:'heartbeat',request_id:randomUUID(),instance_id:s.instance_id,route:s.route,
  generation:s.generation,lease_id:s.lease_id,sequence,observation:{...observation},...patch});
const release=(s,sequence=1,patch={})=>{const value=heartbeat(s,sequence,{action:'release',...patch});delete value.observation;return value;};
const defaults=(selected,revision=0,patch={})=>({request_id:randomUUID(),expected_revision:revision,route:selected,...patch});
const error=(reply,status,code)=>{assert.equal(reply.status,status,JSON.stringify(reply.value));assert.equal(reply.value.error.code,code);};
async function setup(t){
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'io-agent-directory-')),file=path.join(directory,'state.sqlite');
  let now=epoch,store=new MaterialStore(file,{clock:()=>now}),server=await listen(store);
  const agent=store.devices.enroll({owner:'owner-a',role:'agent',label:'Mac'});
  const pairing=store.devices.createPairing(agent.token,{role:'phone',label:'Phone'}),phone=store.devices.pair({code:pairing.code});
  const otherAgent=store.devices.enroll({owner:'owner-b',role:'agent',label:'Other'});
  const f={agent,phone,otherAgent,get store(){return store;},setTime(value){now=value;},get now(){return now;},
    async restart(){await new Promise(resolve=>server.close(resolve));store.close();store=new MaterialStore(file,{clock:()=>now});server=await listen(store);},
    async http(method,endpoint,body,identity=agent,headers={}){
      const response=await fetch(`http://127.0.0.1:${server.address().port}${endpoint}`,{method,headers:{Authorization:`Bearer ${identity.token}`,
        ...(body===undefined?{}:{'Content-Type':'application/json'}),...headers},...(body===undefined?{}:{body:typeof body==='string'?body:JSON.stringify(body)})});
      return {status:response.status,value:await response.json()};
    },
    post(body,identity=agent){return f.http('POST','/v1/agent-sessions',body,identity);},
    get(identity=phone){return f.http('GET','/v1/agent-sessions',undefined,identity);},
    set(body,identity=phone){return f.http('PUT','/v1/agent-default',body,identity);},
    async start(body=acquire(),identity=agent){const result=await f.post(body,identity);assert.equal(result.status,200,JSON.stringify(result.value));return result.value.session;}
  };
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));store.close();fs.rmSync(directory,{recursive:true,force:true});});return f;
}

test('HTTP directory stays empty until native publication and exposes exact paired route and explicit default',async t=>{
  const f=await setup(t),empty=(await f.get()).value;
  assert.deepEqual(empty.sessions,[]);assert.deepEqual(empty.default,{revision:0,route:null,updated_at:null});
  assert.ok((await f.http('GET','/v1/identity',undefined,f.phone)).value.capabilities.includes('agent_session_directory_v1'));
  const input=acquire(),session=await f.start(input);
  assert.deepEqual(session.route,input.route);assert.equal(session.producer_id,f.agent.producer_id);assert.equal(session.device_id,f.agent.device_id);
  assert.equal(session.online,true);assert.equal(session.generation,1);assert.equal(Date.parse(session.lease_expires_at),epoch+SESSION_LEASE_MS);
  assert.equal(session.capabilities.descendants_proof,false);assert.equal(session.capabilities.native_queue_expiry,false);
  assert.equal((await f.get()).value.default.route,null);
  const selected=await f.set(defaults(session.route));assert.equal(selected.status,200);assert.deepEqual(selected.value.default,{revision:1,route:session.route,updated_at:new Date(epoch).toISOString()});
  f.setTime(epoch+15000);const busy=await f.post(heartbeat(session,2,{observation:{...observation,busy:true}}));assert.equal(busy.status,200);
  assert.equal(busy.value.session.busy,true);assert.equal(busy.value.session.capabilities.can_execute,true);
  const read=(await f.get()).value;assert.equal(read.server_time,new Date(f.now).toISOString());assert.deepEqual(read.sessions,[busy.value.session]);
});

test('seven-day ACK pruning never resets route generations or shared default CAS',async t=>{
  const f=await setup(t),input=acquire(),s=await f.start(input),selection=defaults(s.route);await f.set(selection);
  // Advance with ordinary paired credential renewal, retaining device/producer.
  let token=f.agent;for(let i=0;i<15;i++){f.setTime(epoch+(i+1)*12*3600000);token=f.store.devices.refresh(token.token);}
  await f.restart();assert(f.now-epoch>SESSION_ACK_RETENTION_MS);
  // A successful fresh operation commits the bounded housekeeping transaction.
  const next=await f.start(acquire({route:s.route,expected_generation:1}),token);assert.equal(next.generation,2);
  assert.equal(f.store.db.prepare('SELECT COUNT(*) n FROM agent_session_requests WHERE request_id IN (?,?)').get(input.request_id,selection.request_id).n,0);
  error(await f.post(input,token),409,'SESSION_GENERATION_CONFLICT');error(await f.set(selection,token),409,'DEFAULT_REVISION_CONFLICT');
  const current=(await f.get(token)).value;assert.equal(current.sessions[0].generation,2);assert.equal(current.default.revision,1);assert.deepEqual(current.default.route,s.route);
});

test('ready=false heartbeat and unsupported native capabilities never appear executable',async t=>{
  const f=await setup(t);error(await f.post(acquire({observation:unavailable})),400,'INVALID_AGENT_SESSION');
  const s=await f.start(),lost=await f.post(heartbeat(s,1,{observation:unavailable}));assert.equal(lost.status,200);
  assert.equal(lost.value.session.online,false);assert.equal(lost.value.session.busy,null);assert.equal(lost.value.session.reason,'native_disconnected');
  assert.ok(Object.values(lost.value.session.capabilities).every(v=>v===false));
  error(await f.set(defaults(s.route)),409,'DEFAULT_SESSION_UNAVAILABLE');
  const unsupported=await f.post(heartbeat(s,2,{observation:{...observation,can_execute:false,reason:'native_unsupported'}}));assert.equal(unsupported.status,200);
  assert.equal(unsupported.value.session.online,true);assert.equal(unsupported.value.session.capabilities.can_execute,false);
  error(await f.set(defaults(s.route)),409,'DEFAULT_SESSION_UNAVAILABLE');
  assert.equal((await f.post(heartbeat(s,3))).value.session.capabilities.can_execute,true);
});

test('a verified host with unknown busy may execute only through atomic native queue admission',async t=>{
  const f=await setup(t),s=await f.start(acquire({observation:{...observation,busy:null}}));
  assert.equal(s.online,true);assert.equal(s.busy,null);assert.equal(s.capabilities.can_execute,true);
  assert.equal((await f.set(defaults(s.route))).status,200);
  error(await f.post(heartbeat(s,1,{observation:{...observation,busy:null,atomic_queue_append:false}})),400,'INVALID_AGENT_SESSION');
  const unsupported=await f.post(heartbeat(s,1,{observation:{...observation,busy:null,atomic_queue_append:false,can_execute:false,reason:'busy_unknown'}}));
  assert.equal(unsupported.status,200);assert.equal(unsupported.value.session.online,true);assert.equal(unsupported.value.session.capabilities.can_execute,false);
  assert.equal(unsupported.value.session.busy,null);
});

test('expiry is computed on GET; expired heartbeats cannot revive a lease or clear the default',async t=>{
  const f=await setup(t),s=await f.start();await f.set(defaults(s.route));
  f.setTime(epoch+SESSION_LEASE_MS);const expired=(await f.get()).value;
  assert.equal(expired.sessions[0].online,false);assert.equal(expired.sessions[0].reason,'lease_expired');assert.equal(expired.sessions[0].busy,null);
  assert.deepEqual(expired.default.route,s.route);assert.ok(Object.values(expired.sessions[0].capabilities).every(v=>v===false));
  error(await f.post(heartbeat(s,1)),410,'SESSION_LEASE_EXPIRED');
  error(await f.post(release(s,1)),410,'SESSION_LEASE_EXPIRED');
  error(await f.set(defaults(s.route,1)),409,'DEFAULT_SESSION_UNAVAILABLE');
  const next=await f.start(acquire({route:s.route,expected_generation:1}));assert.equal(next.generation,2);assert.notEqual(next.lease_id,s.lease_id);
  assert.deepEqual((await f.get()).value.default.route,s.route);
});

test('live takeover, stale generations, wrong native bindings and old heartbeats are fenced',async t=>{
  const f=await setup(t),s=await f.start();
  error(await f.post(acquire({route:s.route})),409,'SESSION_GENERATION_CONFLICT');
  error(await f.post(acquire({route:s.route,expected_generation:1})),409,'SESSION_LEASE_ACTIVE');
  for(const patch of [{workspace:'/elsewhere'},{host_kind:'claude'}])error(await f.post(acquire({route:s.route,expected_generation:1,...patch})),409,'SESSION_BINDING_CONFLICT');
  for(const patch of [{instance_id:randomUUID()},{lease_id:randomUUID()},{generation:2}])error(await f.post(heartbeat(s,1,patch)),409,'SESSION_LEASE_STALE');
  error(await f.post(heartbeat(s,1,{route:{...s.route,session_id:randomUUID()}})),404,'AGENT_SESSION_NOT_FOUND');
  f.setTime(epoch+SESSION_LEASE_MS);
  const next=await f.start(acquire({route:s.route,expected_generation:1,label:'Renamed'}));assert.equal(next.label,'Renamed');
  error(await f.post(heartbeat(s,999)),409,'SESSION_LEASE_STALE');error(await f.post(release(s,1000)),409,'SESSION_LEASE_STALE');
  assert.equal((await f.get()).value.sessions[0].instance_id,next.instance_id);
});

test('same-body retries return the durable original ACK without renewing or replaying across a new owner instance',async t=>{
  const f=await setup(t),input=acquire(),first=await f.post(input),s=first.value.session;
  f.setTime(epoch+10000);assert.deepEqual(await f.post(input),first);
  const pulse=heartbeat(s,1),ack=await f.post(pulse);f.setTime(epoch+20000);assert.deepEqual(await f.post(pulse),ack);
  error(await f.post({...pulse,observation:{...observation,busy:true}}),409,'IDEMPOTENCY_CONFLICT');
  const chosen=defaults(s.route),chosenAck=await f.set(chosen);await f.restart();
  f.setTime(epoch+70000);const next=await f.start(acquire({route:s.route,expected_generation:1}));
  assert.deepEqual(await f.post(input),first);assert.deepEqual(await f.post(pulse),ack);assert.deepEqual(await f.set(chosen),chosenAck);
  const fresh=(await f.get()).value;assert.equal(fresh.sessions[0].generation,next.generation);assert.equal(fresh.default.revision,1);
  error(await f.set(defaults(null,1,{request_id:input.request_id}),f.agent),409,'IDEMPOTENCY_CONFLICT');
});

test('monotonic sequences tolerate gaps, reject duplicate IDs with changed content and do not move expiry on stale messages',async t=>{
  const f=await setup(t),s=await f.start();f.setTime(epoch+10000);
  const pulse=heartbeat(s,5),accepted=await f.post(pulse),expiry=accepted.value.session.lease_expires_at;
  f.setTime(epoch+20000);for(const sequence of [1,4,5])error(await f.post(heartbeat(s,sequence)),409,'SESSION_SEQUENCE_STALE');
  assert.equal((await f.get()).value.sessions[0].lease_expires_at,expiry);
  error(await f.post(release(s,5)),409,'SESSION_SEQUENCE_STALE');
  const released=await f.post(release(s,6));assert.equal(released.status,200);assert.equal(released.value.session.reason,'lease_released');
  error(await f.post(heartbeat(s,7)),409,'SESSION_LEASE_STALE');
});

test('explicit release persists offline/default and permits same binding to reacquire immediately',async t=>{
  const f=await setup(t),s=await f.start();await f.set(defaults(s.route));
  const request=release(s),ack=await f.post(request);assert.equal(ack.status,200);assert.equal(ack.value.session.online,false);
  const next=await f.start(acquire({route:s.route,expected_generation:1}));assert.equal(next.generation,2);
  assert.deepEqual(await f.post(request),ack);assert.equal((await f.get()).value.sessions[0].online,true);
  assert.deepEqual((await f.get()).value.default.route,s.route);
});

test('directory mutations require real pairing, agent role, and both publish scopes',async t=>{
  const f=await setup(t),legacy=f.store.mint({owner:'owner-a',producer:f.agent.producer_id,scopes:['tasks:update','tasks:read','receipts:agent']});
  error(await f.post(acquire(),legacy),403,'DEVICE_REQUIRED');error(await f.set(defaults(null),legacy),403,'DEVICE_REQUIRED');
  assert.equal((await f.get(legacy)).status,200);error(await f.post(acquire(),f.phone),403,'FORBIDDEN');
  const noRead=f.store.mint({owner:'owner-a',producer:'none',scopes:['tasks:update']});error(await f.get(noRead),403,'FORBIDDEN');
  f.store.db.prepare('UPDATE credentials SET scopes=? WHERE token_id=?').run(JSON.stringify(['receipts:agent']),f.agent.token_id);
  error(await f.post(acquire()),403,'FORBIDDEN');
  f.store.db.prepare('UPDATE credentials SET scopes=? WHERE token_id=?').run(JSON.stringify(['tasks:update','receipts:agent']),f.phone.token_id);
  error(await f.post(acquire(),f.phone),403,'FORBIDDEN');
});

test('credential renewal preserves publisher and replay identity; device revocation removes online capability immediately',async t=>{
  const f=await setup(t),input=acquire(),ack=await f.post(input),s=ack.value.session;
  await f.set(defaults(s.route));const refreshed=f.store.devices.refresh(f.agent.token);await f.restart();
  assert.deepEqual(await f.post(input,refreshed),ack);assert.equal((await f.post(heartbeat(s,1),refreshed)).status,200);
  f.store.devices.revoke(f.agent.device_id);const visible=(await f.get()).value;
  assert.equal(visible.sessions[0].online,false);assert.equal(visible.sessions[0].reason,'device_revoked');assert.deepEqual(visible.default.route,s.route);
  error(await f.post(input,refreshed),401,'UNAUTHENTICATED');
  const replacement=f.store.devices.enroll({owner:'owner-a',role:'agent',label:'Replacement'});
  error(await f.post(acquire({route:s.route,expected_generation:1}),replacement),409,'COMPUTER_BINDING_CONFLICT');
});

test('same-owner computers cannot hijack a computer/route; other owners remain fully isolated',async t=>{
  const f=await setup(t),s=await f.start(),sameOwner=f.store.devices.enroll({owner:'owner-a',role:'agent',label:'Laptop'});
  error(await f.post(acquire(),sameOwner),409,'COMPUTER_BINDING_CONFLICT');
  error(await f.post(heartbeat(s,1),sameOwner),409,'SESSION_BINDING_CONFLICT');
  assert.deepEqual((await f.get(f.otherAgent)).value.sessions,[]);
  error(await f.set(defaults(s.route),f.otherAgent),404,'AGENT_SESSION_NOT_FOUND');
  const other=await f.start(acquire({route:s.route}),f.otherAgent);assert.equal(other.producer_id,f.otherAgent.producer_id);
  assert.equal((await f.get()).value.sessions.length,1);assert.equal((await f.get(f.otherAgent)).value.sessions.length,1);
  const anotherRoute={...s.route,computer_id:'laptop'};assert.equal((await f.post(acquire({route:anotherRoute}),sameOwner)).status,200);
});

test('default owner-level CAS is shared by phones and agent; no automatic fallback, and clearing is explicit',async t=>{
  const f=await setup(t),a=await f.start(),b=await f.start(acquire({route:{...route(),agent_id:'claude'},host_kind:'claude'}));
  const pairing=f.store.devices.createPairing(f.agent.token,{role:'phone',label:'Second phone'}),phone2=f.store.devices.pair({code:pairing.code});
  const chosen=await f.set(defaults(a.route));assert.equal(chosen.status,200);
  error(await f.set(defaults(b.route),phone2),409,'DEFAULT_REVISION_CONFLICT');
  const second=await f.set(defaults(b.route,1),phone2);assert.equal(second.value.default.revision,2);
  await f.post(release(b));const offline=(await f.get()).value;
  assert.deepEqual(offline.default.route,b.route);assert.equal(offline.sessions.find(s=>s.route.session_id===a.route.session_id).online,true);
  const clear=defaults(null,2),cleared=await f.set(clear,f.agent);assert.deepEqual(cleared.value.default,{revision:3,route:null,updated_at:new Date(epoch).toISOString()});
  assert.deepEqual(await f.set(clear,f.agent),cleared);assert.deepEqual((await f.get(phone2)).value.default,cleared.value.default);
});

test('strict HTTP contracts reject queries, duplicate keys, unknown fields, unsafe values and oversized payloads',async t=>{
  const f=await setup(t),input=acquire();
  for(const patch of [{action:'constructor'},{action:'toString'},{extra:true},{owner_id:'forged'},{expected_generation:-1},{expected_generation:1.1},
    {instance_id:input.instance_id.toUpperCase()},{host_kind:'hermes'},{label:''},{label:' spaced '},{label:'x'.repeat(65)},
    {workspace:'relative'},{workspace:'/work/../glasses'},{workspace:'/work//glasses'},{workspace:'/work/'},{workspace:'\\relative'},
    {workspace:'/x'+String.fromCharCode(0)},{workspace:'/'+ 'x'.repeat(2048)},
    {route:{...input.route,project_id:'space here'}},{route:{...input.route,computer_id:'x'.repeat(129)}},{route:{...input.route,session_id:'current'}},
    {observation:{...observation,descendants_proof:true}},{observation:{...observation,native_queue_expiry:true}},
    {observation:{...observation,can_execute:false}},{observation:{...unavailable,busy:false}},
    {observation:{...observation,reason:'free form text'}},{observation:{...observation,reason:'x'.repeat(65)}}])
    error(await f.post({...input,...patch}),400,'INVALID_AGENT_SESSION');
  for(const body of [null,[],{},'null'])error(await f.post(body),400,'INVALID_AGENT_SESSION');
  error(await f.http('POST','/v1/agent-sessions?x=1',input),400,'INVALID_QUERY');
  error(await f.http('GET','/v1/agent-sessions?x=1'),400,'INVALID_QUERY');
  error(await f.http('PUT','/v1/agent-default?x=1',defaults(null)),400,'INVALID_QUERY');
  error(await f.post('{"action":"acquire","action":"release"}'),400,'DUPLICATE_JSON_KEY');
  error(await f.post({payload:'x'.repeat(8192)}),413,'PAYLOAD_TOO_LARGE');
  error(await f.http('POST','/v1/agent-sessions',input,f.agent,{'Content-Type':'text/plain'}),415,'UNSUPPORTED_MEDIA_TYPE');
  for(const body of [{},defaults(null,-1),defaults(null,0,{extra:true}),defaults({...input.route,session_id:'bad'})])error(await f.set(body),400,'INVALID_AGENT_DEFAULT');
  assert.deepEqual((await f.get()).value.sessions,[]);
});

test('canonical POSIX and Windows workspaces are accepted; capabilities cannot be smuggled into release',async t=>{
  const f=await setup(t);
  for(const workspace of ['/','/work/项目','C:\\Work\\Project','C:\\','\\\\server\\share\\Project']){
    const s=await f.start(acquire({workspace}));error(await f.post({...release(s),observation}),400,'INVALID_AGENT_SESSION');
    for(const sequence of [0,-1,1.5,Number.MAX_SAFE_INTEGER+1])error(await f.post(heartbeat(s,sequence)),400,'INVALID_AGENT_SESSION');
  }
});

test('128 entries bound owner responses; failures roll back first computer claims and do not reserve request IDs',async t=>{
  const f=await setup(t),first=acquire();
  for(let i=0;i<MAX_AGENT_SESSIONS;i++)await f.start(i===0?first:acquire());
  const rejected=acquire({route:{...route(),computer_id:'unclaimed'}});
  error(await f.post(rejected),409,'AGENT_SESSION_LIMIT');
  const result=(await f.get()).value;assert.equal(result.sessions.length,MAX_AGENT_SESSIONS);assert.ok(Buffer.byteLength(JSON.stringify(result))<1048576);
  assert.equal(f.store.db.prepare('SELECT COUNT(*) AS n FROM agent_computer_bindings WHERE computer_id=?').get('unclaimed').n,0);
  f.setTime(epoch+SESSION_LEASE_MS);const existing=result.sessions[0];
  const corrected=acquire({request_id:rejected.request_id,route:existing.route,expected_generation:1});assert.equal((await f.post(corrected)).status,200);
});

test('failed durable replay write rolls back publication and default mutation, allowing a safe retry',async t=>{
  const f=await setup(t),input=acquire();
  f.store.db.exec("CREATE TRIGGER reject_directory_ack BEFORE INSERT ON agent_session_requests BEGIN SELECT RAISE(ABORT,'synthetic failure'); END;");
  error(await f.post(input),500,'INTERNAL');assert.deepEqual((await f.get()).value.sessions,[]);
  assert.equal(f.store.db.prepare('SELECT COUNT(*) AS n FROM agent_computer_bindings').get().n,0);
  f.store.db.exec('DROP TRIGGER reject_directory_ack');const s=await f.start(input);
  f.store.db.exec("CREATE TRIGGER reject_directory_ack BEFORE INSERT ON agent_session_requests BEGIN SELECT RAISE(ABORT,'synthetic failure'); END;");
  const change=defaults(s.route);error(await f.set(change),500,'INTERNAL');assert.deepEqual((await f.get()).value.default,{revision:0,route:null,updated_at:null});
  f.store.db.exec('DROP TRIGGER reject_directory_ack');assert.equal((await f.set(change)).value.default.revision,1);
});

test('concurrent acquire and default CAS have exactly one winner through real HTTP',async t=>{
  const f=await setup(t),input=acquire(),other={...input,request_id:randomUUID(),instance_id:randomUUID()};
  const attempts=await Promise.all([f.post(input),f.post(other)]);assert.equal(attempts.filter(x=>x.status===200).length,1);
  const winner=attempts.find(x=>x.status===200).value.session;error(attempts.find(x=>x.status!==200),409,'SESSION_GENERATION_CONFLICT');
  const selected=await Promise.all([f.set(defaults(winner.route)),f.set(defaults(null),f.agent)]);
  assert.equal(selected.filter(x=>x.status===200).length,1);error(selected.find(x=>x.status!==200),409,'DEFAULT_REVISION_CONFLICT');
  assert.equal((await f.get()).value.default.revision,1);
});
