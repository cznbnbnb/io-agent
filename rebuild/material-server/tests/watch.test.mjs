import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {MaterialStore} from '../store.mjs';

// Agent check-in watches (2026-10-23): an overdue, enabled watch on an active task makes the
// server post exactly one progress notice; the agent's next check-in or switch-off resets it.
const fixture=JSON.parse(fs.readFileSync(new URL('../../../docs/contracts/normal.json',import.meta.url)));
const taskBody=fixture.events.find(e=>e.kind==='task').body;
const epoch=Date.parse('2026-10-11T02:00:00Z'),minute=60000;
const phoneScopes=['tasks:write','tasks:read','requests:read','answers:write','messages:receive','receipts:phone'];
const agentScopes=['tasks:read','tasks:update','requests:write','messages:receive','messages:write','receipts:agent'];
function setup(t){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'io-watch-'));let now=epoch;
  const store=new MaterialStore(path.join(dir,'watch.sqlite'),{clock:()=>now});
  const phone=store.mint({owner:'owner-a',producer:'phone-app',scopes:phoneScopes,ttlMs:4*3600000});
  const agent=store.mint({owner:'owner-a',producer:'pc-agent',scopes:agentScopes,ttlMs:4*3600000});
  const other=store.mint({owner:'owner-a',producer:'other-agent',scopes:agentScopes,ttlMs:4*3600000});
  const foreign=store.mint({owner:'owner-b',producer:'pc-agent',scopes:agentScopes,ttlMs:4*3600000});
  t.after(()=>{store.close();fs.rmSync(dir,{recursive:true,force:true});});
  store.queueSubmit(phone.token,{schema_version:'1.0',event_id:randomUUID(),idempotency_key:randomUUID(),kind:'task',producer_id:'phone-app',
    created_at:new Date(now).toISOString(),expires_at:new Date(now+3600000).toISOString(),body:structuredClone(taskBody)},'task');
  return {store,phone,agent,other,foreign,setTime:n=>{now=n;},at:n=>new Date(n).toISOString()};
}
const notices=(f)=>f.store.inbox(f.phone.token,{}).items.filter(i=>i.kind==='message');
const error=code=>e=>e.code===code;

test('an overdue check-in posts one server notice, a new check-in re-arms it',t=>{
  const f=setup(t),id=taskBody.task_id;
  const set=f.store.watchSet(f.agent.token,id,{enabled:true,next_checkin_at:f.at(epoch+10*minute),note:'测试蓝牙断连'});
  assert.equal(set.enabled,true);assert.equal(set.fired_at,null);
  f.setTime(epoch+11*minute);assert.equal(f.store.watchdogTick(),0,'grace period');
  f.setTime(epoch+13*minute);assert.equal(f.store.watchdogTick(),1);assert.equal(f.store.watchdogTick(),0,'once per check-in');
  const [first]=notices(f);assert.match(first.object_id,/^notice-[a-f0-9]{64}$/);assert.equal(first.body.channel,'progress');
  assert.equal(first.body.request_id,null);assert.match(first.body.text,/测试蓝牙断连/);assert.deepEqual(first.body.route,taskBody.route);
  assert.notEqual(f.store.watchGet(f.agent.token,id).fired_at,null);
  f.store.watchSet(f.agent.token,id,{enabled:true,next_checkin_at:f.at(epoch+40*minute),note:'下一步'});
  f.setTime(epoch+43*minute);assert.equal(f.store.watchdogTick(),1);assert.equal(notices(f).length,2);
});

test('switched-off, expired-task and early watches stay silent',t=>{
  const f=setup(t),id=taskBody.task_id;
  f.store.watchSet(f.agent.token,id,{enabled:false,next_checkin_at:null,note:''});
  f.setTime(epoch+30*minute);assert.equal(f.store.watchdogTick(),0);
  f.store.watchSet(f.agent.token,id,{enabled:true,next_checkin_at:f.at(epoch+59*minute),note:''});
  f.setTime(epoch+62*minute);assert.equal(f.store.watchdogTick(),0,'task expired');assert.equal(notices(f).length,0);
});

test('watch input, ownership and producer are enforced',t=>{
  const f=setup(t),id=taskBody.task_id;
  assert.throws(()=>f.store.watchSet(f.agent.token,id,{enabled:true,next_checkin_at:f.at(epoch-minute),note:''}),error('INVALID_TIME_RANGE'));
  assert.throws(()=>f.store.watchSet(f.agent.token,id,{enabled:true,next_checkin_at:f.at(epoch+3*3600000),note:''}),error('INVALID_TIME_RANGE'));
  assert.throws(()=>f.store.watchSet(f.agent.token,id,{enabled:false,next_checkin_at:f.at(epoch+minute),note:''}),error('INVALID'));
  assert.throws(()=>f.store.watchSet(f.agent.token,id,{enabled:true,next_checkin_at:f.at(epoch+minute)}),error('INVALID'));
  assert.throws(()=>f.store.watchSet(f.agent.token,'missing-task',{enabled:false,next_checkin_at:null,note:''}),error('TASK_NOT_FOUND'));
  assert.throws(()=>f.store.watchSet(f.foreign.token,id,{enabled:false,next_checkin_at:null,note:''}),error('TASK_NOT_FOUND'));
  assert.throws(()=>f.store.watchSet(f.phone.token,id,{enabled:false,next_checkin_at:null,note:''}),error('FORBIDDEN'));
  f.store.watchSet(f.agent.token,id,{enabled:false,next_checkin_at:null,note:''});
  assert.throws(()=>f.store.watchSet(f.other.token,id,{enabled:false,next_checkin_at:null,note:''}),error('FORBIDDEN'));
  assert.throws(()=>f.store.watchGet(f.other.token,id),error('WATCH_NOT_FOUND'));
});
