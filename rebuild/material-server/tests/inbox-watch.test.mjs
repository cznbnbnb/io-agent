import test from 'node:test';import assert from 'node:assert/strict';
import {adminFixture} from './admin-fixture.mjs';import {listen} from '../http.mjs';
const until=async check=>{const end=Date.now()+3000;while(!check()){if(Date.now()>end)throw Error('condition timeout');await new Promise(r=>setTimeout(r,10));}};
async function setup(t){const f=await adminFixture(),server=await listen(f.store,0,{idleInboxWaitMs:0}),base=`http://127.0.0.1:${server.address().port}/v1/inbox/watch`,controllers=[];
 t.after(async()=>{for(const c of controllers)c.abort();server.closeAllConnections();await new Promise(r=>server.close(r));f.close();});
 return {...f,watch:(version,token=f.agent.token)=>{const c=new AbortController();controllers.push(c);return fetch(base+(version?'?version='+version:''),{headers:{Authorization:'Bearer '+token},signal:c.signal});}};}
test('idle watch holds without polling, wakes after committed same-owner work, and preserves inbox cursor replay',async t=>{
 const f=await setup(t),first=await (await f.watch()).json(),cursor=f.store.inbox(f.agent.token).next_cursor;
 const pending=f.watch(first.version);await until(()=>f.store.inboxWaiters.size===1);const at=Date.now();f.addTask('watch-new','notification-only synthetic task');
 const changed=await (await pending).json();assert.equal(changed.changed,true);assert.notEqual(changed.version,first.version);assert(Date.now()-at<500);
 assert(f.store.inbox(f.agent.token,{cursor}).items.some(t=>t.object_id==='watch-new'));assert.equal(f.store.inboxWaiters.size,0);
});
test('foreign changes and rollback do not wake; revoke wakes and rechecks authority',async t=>{
 const f=await setup(t),first=await (await f.watch()).json();const pending=f.watch(first.version);await until(()=>f.store.inboxWaiters.size===1);
 f.store.tx(()=>f.store.pendingInboxOwners.add('another-owner'));assert.equal(f.store.inboxWaiters.size,1);
 assert.throws(()=>f.store.tx(()=>{f.store.pendingInboxOwners.add(f.owner);throw Error('rollback');}));assert.equal(f.store.inboxWaiters.size,1);
 f.store.devices.revoke(f.agent.device_id);assert.equal((await pending).status,401);assert.equal(f.store.inboxWaiters.size,0);
});
test('pausing/resuming wakes the shared listener, daily-only grants cannot subscribe',async t=>{
 const f=await setup(t),first=await (await f.watch()).json(),session=f.store.admin.session(f.login.token),pending=f.watch(first.version);await until(()=>f.store.inboxWaiters.size===1);
 f.store.console.action(session,{action:'delivery',device_id:f.agent.device_id,paused:true});const paused=await (await pending).json();assert.notEqual(paused.version,first.version);
 const next=f.watch(paused.version);await until(()=>f.store.inboxWaiters.size===1);f.store.console.action(session,{action:'delivery',device_id:f.agent.device_id,paused:false});assert.equal((await next).status,200);
 const onlyDaily=f.store.mint({owner:f.owner,producer:'daily-reader',scopes:['daily-summaries:read']});assert.equal((await f.watch(null,onlyDaily.token)).status,403);
});
