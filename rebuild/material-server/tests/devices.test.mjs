import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {MaterialStore} from '../store.mjs';
import {listen} from '../http.mjs';

// One-time pairing and background renewal (2026-10-24): computers enroll once, phones pair with a
// one-time code, both renew without a new connection file, and revoking a device ends all its tokens.
const epoch=Date.parse('2026-10-24T02:00:00Z'),minute=60000,hour=3600000;
function setup(t){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'io-devices-'));let now=epoch;
  const store=new MaterialStore(path.join(dir,'devices.sqlite'),{clock:()=>now});
  t.after(()=>{try{store.close();}catch{}fs.rmSync(dir,{recursive:true,force:true});});
  const computer=store.devices.enroll({owner:'turboio-user',role:'agent',label:'io-mac-computer'});
  return {store,computer,setTime:n=>{now=n;},now:()=>now};
}
const code=c=>e=>e.code===c;

test('a computer creates a one-time code and the phone pairs with it',t=>{
  const f=setup(t),d=f.store.devices;
  assert.equal(f.computer.role,'agent');assert.match(f.computer.producer_id,/^agent-[0-9a-f]{8}$/);
  assert.ok(f.computer.scopes.includes('devices:pair')&&f.computer.scopes.includes('tasks:write'));
  const pairing=d.createPairing(f.computer.token,{role:'phone',label:'我的手机'});
  assert.match(pairing.code,/^[2-9A-Z]{5}-[2-9A-Z]{5}$/);assert.equal(Date.parse(pairing.expires_at),epoch+10*minute);
  const phone=d.pair({code:pairing.code.toLowerCase().replace('-',' ')});
  assert.equal(phone.owner_id,'turboio-user');assert.equal(phone.role,'phone');assert.equal(phone.label,'我的手机');
  assert.match(phone.producer_id,/^phone-[0-9a-f]{8}$/);assert.ok(!phone.scopes.includes('devices:pair'));
  assert.equal(f.store.identity(phone.token).producer_id,phone.producer_id);
  assert.equal(Date.parse(phone.expires_at),epoch+24*hour);assert.equal(Date.parse(phone.refresh_after),epoch+12*hour);
  assert.throws(()=>d.pair({code:pairing.code}),code('PAIRING_CODE_INVALID'),'one-time');
  const late=d.createPairing(f.computer.token,{role:'phone',label:'second'});f.setTime(epoch+11*minute);
  assert.throws(()=>d.pair({code:late.code}),code('PAIRING_CODE_INVALID'),'expired');
  assert.deepEqual(d.list(f.computer.token).devices.map(x=>x.role),['agent','phone']);
});

test('pairing input is strict and only computers create codes',t=>{
  const f=setup(t),d=f.store.devices,legacy=f.store.mint({owner:'turboio-user',producer:'pc-old',scopes:['devices:pair']});
  assert.throws(()=>d.createPairing(legacy.token,{role:'phone',label:'x'}),code('DEVICE_REQUIRED'));
  assert.throws(()=>d.createPairing(f.computer.token,{role:'agent',label:'x'}),code('INVALID_PAIRING'));
  assert.throws(()=>d.createPairing(f.computer.token,{role:'phone',label:' x'}),code('INVALID_PAIRING'));
  assert.throws(()=>d.createPairing(f.computer.token,{role:'phone',label:'x',extra:1}),code('INVALID_PAIRING'));
  const phone=d.pair({code:d.createPairing(f.computer.token,{role:'phone',label:'p'}).code});
  assert.throws(()=>d.createPairing(phone.token,{role:'phone',label:'x'}),code('FORBIDDEN'));
  assert.throws(()=>d.pair({code:'ABCDE-FGHJK',extra:1}),code('PAIRING_CODE_INVALID'));
  assert.throws(()=>d.enroll({owner:'bad owner',role:'agent',label:'x'}),code('INVALID_DEVICE'));
});

test('wrong codes are rate limited per window',t=>{
  const f=setup(t),d=f.store.devices;f.setTime(epoch+9*minute);const good=d.createPairing(f.computer.token,{role:'phone',label:'p'});
  for(let i=0;i<30;i++)assert.throws(()=>d.pair({code:'22222-22222'}),code('PAIRING_CODE_INVALID'));
  assert.throws(()=>d.pair({code:good.code}),code('PAIRING_RATE_LIMITED'),'even a good code waits out the window');
  f.setTime(epoch+10*minute);assert.equal(d.pair({code:good.code}).role,'phone');
});

test('renewal rotates the token once, keeps the device, and ends the old token after a grace',t=>{
  const f=setup(t),d=f.store.devices;f.setTime(epoch+13*hour);
  const next=d.refresh(f.computer.token);
  assert.equal(next.device_id,f.computer.device_id);assert.equal(next.producer_id,f.computer.producer_id);assert.notEqual(next.token,f.computer.token);
  assert.equal(Date.parse(next.expires_at),epoch+37*hour);
  assert.throws(()=>d.refresh(f.computer.token),code('CREDENTIAL_ALREADY_REFRESHED'));
  assert.equal(f.store.identity(f.computer.token).producer_id,f.computer.producer_id,'grace');
  f.setTime(epoch+13*hour+5*minute);assert.throws(()=>f.store.auth(f.computer.token),code('UNAUTHENTICATED'));
  assert.equal(d.refresh(next.token).device_id,f.computer.device_id);
  const legacy=f.store.mint({owner:'turboio-user',producer:'pc-old',scopes:['tasks:read']});
  assert.throws(()=>d.refresh(legacy.token),code('DEVICE_REQUIRED'),'admin test tokens never renew');
});

test('revoking a device ends every token; phones may only unpair themselves',t=>{
  const f=setup(t),d=f.store.devices,pair=()=>d.pair({code:d.createPairing(f.computer.token,{role:'phone',label:'p'}).code});
  const a=pair(),b=pair();
  assert.throws(()=>d.revokeBy(a.token,b.device_id),code('FORBIDDEN'));
  assert.equal(d.revokeBy(a.token,a.device_id).revoked,true);assert.throws(()=>f.store.auth(a.token),code('UNAUTHENTICATED'));
  const renewed=d.refresh(b.token);assert.equal(d.revokeBy(f.computer.token,b.device_id).revoked,true);
  assert.throws(()=>f.store.auth(renewed.token),code('UNAUTHENTICATED'));assert.throws(()=>f.store.auth(b.token),code('UNAUTHENTICATED'));
  assert.throws(()=>d.revokeBy(f.computer.token,'missing'),code('DEVICE_NOT_FOUND'));
  const other=d.enroll({owner:'someone-else',role:'agent',label:'x'});
  assert.throws(()=>d.revokeBy(f.computer.token,other.device_id),code('DEVICE_NOT_FOUND'),'other owners stay invisible');
});

test('HTTP: pair without a bearer, renew and list with one',async t=>{
  const f=setup(t);f.setTime(Date.now());const server=await listen(f.store);t.after(()=>new Promise(r=>server.close(r)));
  const base='http://127.0.0.1:'+server.address().port;f.setTime(Date.now());
  const computer=f.store.devices.enroll({owner:'turboio-user',role:'agent',label:'live'});
  const post=(route,body,token)=>fetch(base+route,{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify(body)});
  const created=await post('/v1/pairings',{role:'phone',label:'手机'},computer.token);assert.equal(created.status,200);
  const {code:pairCode}=await created.json();
  assert.equal((await post('/v1/pair',{code:pairCode},computer.token)).status,400,'pairing never carries a bearer');
  const paired=await post('/v1/pair',{code:pairCode});assert.equal(paired.status,200);const phone=await paired.json();
  assert.equal((await post('/v1/pair',{code:pairCode})).status,400);
  const renewed=await fetch(base+'/v1/credentials/refresh',{method:'POST',headers:{Authorization:'Bearer '+phone.token}});assert.equal(renewed.status,200);
  const next=await renewed.json();assert.equal(next.device_id,phone.device_id);
  const listed=await fetch(base+'/v1/devices',{headers:{Authorization:'Bearer '+computer.token}});assert.equal(listed.status,200);
  assert.equal((await listed.json()).devices.length,3);
  assert.equal((await fetch(base+'/v1/devices',{headers:{Authorization:'Bearer '+next.token}})).status,403);
  const removed=await fetch(base+'/v1/devices/'+phone.device_id,{method:'DELETE',headers:{Authorization:'Bearer '+next.token}});assert.equal(removed.status,200);
  assert.equal((await fetch(base+'/v1/identity',{headers:{Authorization:'Bearer '+next.token}})).status,401);
});
