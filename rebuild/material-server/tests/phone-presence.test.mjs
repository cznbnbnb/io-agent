import test from 'node:test';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {MaterialStore} from '../store.mjs';
import {listen} from '../http.mjs';
function setup(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'phone-presence-'));let now=Date.now();let store=new MaterialStore(path.join(dir,'db.sqlite'),{clock:()=>now});t.after(()=>{store.close();fs.rmSync(dir,{recursive:true,force:true});});const computer=store.devices.enroll({owner:'test',role:'agent',label:'Mac'});return {get store(){return store;},restart(){store.close();store=new MaterialStore(path.join(dir,'db.sqlite'),{clock:()=>now});},computer,advance:n=>now+=n,phone:label=>store.devices.pair({code:store.devices.createPairing(computer.token,{role:'phone',label}).code,account_binding:'a'.repeat(64)})};}
const account_binding='a'.repeat(64),code=c=>e=>e.code===c;
const fixtures=JSON.parse(fs.readFileSync(new URL('../../../docs/contracts/normal.json',import.meta.url))).events;
function seed(f,a){for(const kind of ['task','request','message']){const source=structuredClone(fixtures.find(e=>e.kind===kind)),who=kind==='task'?a:f.computer;source.producer_id=who.producer_id;source.event_id=randomUUID();source.idempotency_key=randomUUID();source.created_at=new Date().toISOString();source.expires_at=new Date(Date.now()+3600000).toISOString();f.store.queueSubmit(who.token,source,kind);}}
test('recovery keeps owner, agent directory and default; code/account mismatch does not consume code',t=>{
 const f=setup(t),a=f.phone('old'),route={computer_id:'work-mac',agent_id:'codex',project_id:'glasses',session_id:randomUUID()};
 f.store.agentSessions.publish(f.computer.token,{action:'acquire',request_id:randomUUID(),instance_id:randomUUID(),route,expected_generation:0,host_kind:'codex',workspace:'/work/glasses',label:'Codex',observation:{ready:true,busy:false,can_execute:true,exact_turn_interrupt:true,descendants_proof:false,atomic_queue_append:true,native_queue_expiry:false,reason:null}});
 f.store.agentSessions.setDefault(a.token,{request_id:randomUUID(),expected_revision:0,route});
 const p=f.store.devices.createPairing(f.computer.token,{role:'phone',label:'new'});
 assert.throws(()=>f.store.devices.pair({code:p.code,account_binding:'b'.repeat(64)}),code('PHONE_ACCOUNT_MISMATCH'));
 const b=f.store.devices.pair({code:p.code,account_binding});assert.equal(a.owner_id,b.owner_id);assert.notEqual(a.device_id,b.device_id);
 assert.deepEqual(f.store.agentSessions.list(a.token).default,f.store.agentSessions.list(b.token).default);assert.deepEqual(f.store.agentSessions.list(b.token).default.route,route);assert.equal(f.store.agentSessions.list(b.token).sessions[0].online,true);
 assert.equal(f.store.devices.list(f.computer.token).devices.length,3,'failed recovery rolled back');
 assert.throws(()=>f.store.devices.pair({code:p.code,account_binding}),code('PAIRING_CODE_INVALID'));
});
test('leases do not overlap across switching/renewal; stale revisions and secondary delivery are rejected',t=>{
 const f=setup(t),a=f.phone('old'),b=f.phone('new'),s=f.store.phones;
 seed(f,a);const old=s.update(a.token,{account_binding});assert.equal(old.lease_ms,20000);assert.equal(s.update(b.token,{account_binding}).lease_ms,0);
 const selected=s.update(b.token,{account_binding,expected_revision:old.revision},true);
 assert.equal(selected.notice_after_seq,f.store.queueCeiling(a.owner_id));assert.deepEqual(f.store.inbox(f.computer.token).items.map(i=>i.kind),['task','request','message']);
 assert.deepEqual(f.store.inbox(a.token).items.map(i=>i.kind),['task']);assert.throws(()=>f.store.queueGet(a.token,'request','request-demo'),code('PRIMARY_PHONE_REQUIRED'));
 assert.equal(selected.wait_ms,20000);assert.equal(selected.lease_ms,0);assert.equal(s.update(a.token,{account_binding}).lease_ms,0);
 assert.throws(()=>s.update(a.token,{account_binding,expected_revision:old.revision},true),code('PRIMARY_PHONE_CHANGED'));
 f.advance(19999);assert.equal(s.update(b.token,{account_binding}).lease_ms,0);f.advance(1);
 assert.equal(s.update(b.token,{account_binding}).lease_ms,20000);assert.equal(s.permits(f.store.auth(a.token)),false);assert.equal(s.permits(f.store.auth(b.token)),true);
 const renewed=f.store.devices.refresh(b.token);assert.equal(s.update(renewed.token,{account_binding}).lease_ms,20000);
 const other=f.store.devices.enroll({owner:'other',role:'phone',label:'other'});assert.equal(s.update(other.token,{account_binding:'b'.repeat(64)}).primary_device_id,other.device_id);
 assert.throws(()=>s.update(b.token,{account_binding:'b'.repeat(64)}),code('PHONE_ACCOUNT_MISMATCH'));
 assert.throws(()=>s.update(f.computer.token,{account_binding}),code('FORBIDDEN'));
 f.restart();assert.equal(f.store.phones.update(renewed.token,{account_binding}).primary_device_id,b.device_id);assert.equal(f.store.phones.update(a.token,{account_binding}).lease_ms,0);
});
test('HTTP recovery/presence rejects unknown input and secondary mailbox excludes request/message bodies',async t=>{
 const f=setup(t),a=f.phone('old'),b=f.phone('new'),server=await listen(f.store);t.after(()=>new Promise(resolve=>server.close(resolve)));
 const url='http://127.0.0.1:'+server.address().port+'/v1/phone-presence';
 const call=(phone,method,body)=>fetch(url,{method,headers:{Authorization:'Bearer '+phone.token,'Content-Type':'application/json'},body:JSON.stringify(body)});
 const old=await (await call(a,'POST',{account_binding})).json();assert.equal(old.lease_ms,20000);
 assert.equal((await call(b,'PUT',{account_binding,expected_revision:old.revision})).status,200);
 assert.equal((await call(b,'POST',{account_binding,owner:'other'})).status,400);
 assert.equal(f.store.inbox(a.token).items.length,0);
 // Cursor filter changes on a primary switch; the client resets it and can replay history.
 const cursor=f.store.inbox(a.token).next_cursor;f.advance(20000);f.store.phones.update(a.token,{account_binding,expected_revision:2},true);f.advance(20000);
 assert.throws(()=>f.store.inbox(a.token,{cursor}),code('CURSOR_RESET_REQUIRED'));
});
