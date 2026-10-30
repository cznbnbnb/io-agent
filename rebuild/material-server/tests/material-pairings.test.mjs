import test from 'node:test';import assert from 'node:assert/strict';import {randomBytes} from 'node:crypto';
import {MaterialStore} from '../store.mjs';import {listen} from '../http.mjs';
const account='a'.repeat(64);
test('durable material pairing: offline recovery, lost response, isolation, revoke and restricted scope',async()=>{
 let now=Date.now();const store=new MaterialStore(':memory:',{clock:()=>now});
 const server=await listen(store,0);const base='http://127.0.0.1:'+server.address().port+'/v1';
 try{
  const p=store.materialPairings.enroll({owner:'synthetic-codex',producer:'phone-test',account});
  const body={pairing_id:p.pairing_id,account_binding:account};
  const call=async(path,secret,input=body)=>{const r=await fetch(base+path,{method:'POST',headers:{Authorization:'Bearer '+secret,'Content-Type':'application/json'},body:JSON.stringify(input)});return {status:r.status,body:await r.json()};};
  assert.deepEqual(store.identity(p.token).scopes,['materials:write']);
  assert.throws(()=>store.auth(p.refresh_secret),{code:'UNAUTHENTICATED'});
  assert.throws(()=>store.auth(p.token,'audio:read'),{code:'FORBIDDEN'});
  assert.throws(()=>store.auth(p.token,'tasks:write'),{code:'FORBIDDEN'});
  assert.equal((await call('/material-pairing/refresh',p.token)).status,401);
  assert.equal((await call('/material-pairing/refresh',p.refresh_secret,{...body,account_binding:'b'.repeat(64)})).status,401);
  assert.equal((await call('/material-pairing/refresh',p.refresh_secret,{...body,owner_id:'other'})).status,401);
  const first=await call('/material-pairing/refresh',p.refresh_secret);assert.equal(first.status,200);assert.equal(first.body.token,p.token);
  now+=40*86400000;assert.throws(()=>store.auth(p.token),{code:'UNAUTHENTICATED'});
  const fresh=await call('/material-pairing/refresh',p.refresh_secret);assert.equal(fresh.status,200);assert.notEqual(fresh.body.token,p.token);
  const retries=await Promise.all(Array.from({length:6},()=>call('/material-pairing/refresh',p.refresh_secret)));
  for(const r of retries)assert.deepEqual(r,fresh);
  assert.equal(store.auth(fresh.body.token).owner,'synthetic-codex');
  assert.equal(store.auth(fresh.body.token).producer,'phone-test');
  assert.equal(store.db.prepare('SELECT count(*) AS n FROM material_pairing_tokens').get().n,2);
  const serialized=JSON.stringify(store.db.prepare('SELECT * FROM material_pairings').all());assert(!serialized.includes(p.refresh_secret));assert(!serialized.includes(p.token));
  const other=store.materialPairings.enroll({owner:'other',producer:'other-phone',account});
  assert.equal((await call('/material-pairing/revoke',other.refresh_secret)).status,401);
  assert.equal((await call('/material-pairing/revoke',p.refresh_secret)).status,200);
  assert.equal((await call('/material-pairing/revoke',p.refresh_secret)).status,200);
  assert.equal((await call('/material-pairing/refresh',p.refresh_secret)).status,403);
  assert.throws(()=>store.auth(fresh.body.token),{code:'UNAUTHENTICATED'});
  assert.equal(store.auth(other.token).owner,'other');
 }finally{await new Promise(r=>server.close(r));store.close();}
});

test('new phone restores only its existing account space; retry, renewal and revocation stay independent',async()=>{
 let now=Date.now();const store=new MaterialStore(':memory:',{clock:()=>now}),server=await listen(store,0),base='http://127.0.0.1:'+server.address().port+'/v1';
 try{
  const old=store.materialPairings.enroll({owner:'caller601-recovery-codex',producer:'old-phone',account});
  const agent=store.devices.enroll({owner:'caller601-recovery-codex',role:'agent',label:'Computer'});
  const phone=store.devices.pair({code:store.devices.createPairing(agent.token,{role:'phone',label:'New phone'}).code,account_binding:account});
  const body={account_binding:account,refresh_secret:randomBytes(32).toString('base64url')};
  const call=async(token,input=body,path='/material-pairing/recover')=>{const r=await fetch(base+path,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(input)});return {status:r.status,body:await r.json()};};
  assert.equal((await call(agent.token)).status,403);assert.equal((await call(old.token)).status,403);
  assert.equal((await call(phone.token,{...body,account_binding:'b'.repeat(64)})).status,409);
  assert.equal((await call(phone.token,{...body,owner_id:'other'})).status,400);
  const first=await call(phone.token);assert.equal(first.status,200);assert.equal(first.body.owner_id,phone.owner_id);assert.equal(first.body.producer_id,phone.producer_id);assert.equal(first.body.account_binding,account);assert(!('refresh_secret' in first.body));
  const repeated=await Promise.all(Array.from({length:4},()=>call(phone.token)));for(const r of repeated)assert.deepEqual(r,first);
  assert.equal(store.db.prepare('SELECT count(*) AS n FROM material_pairings WHERE producer=?').get(phone.producer_id).n,1);
  assert.deepEqual(store.identity(first.body.token).scopes,['materials:write']);assert.equal(store.identity(old.token).producer_id,'old-phone');
  assert.equal((await call(phone.token,{...body,refresh_secret:randomBytes(32).toString('base64url')})).status,409);
  const renewedPhone=store.devices.refresh(phone.token);assert.deepEqual(await call(renewedPhone.token),first);
  const stranger=store.devices.enroll({owner:'caller602-recovery-codex',role:'phone',label:'Other account'});store.phones.account({owner:stranger.owner_id,device_id:stranger.device_id},account);
  assert.equal((await call(stranger.token)).status,404);
  assert.equal((await call(body.refresh_secret,{pairing_id:first.body.pairing_id,account_binding:account},'/material-pairing/refresh')).status,200);
  const serial=JSON.stringify(store.db.prepare('SELECT * FROM material_pairings').all());assert(!serial.includes(body.refresh_secret));assert(!serial.includes(first.body.token));
  store.devices.revoke(phone.device_id);assert.throws(()=>store.auth(first.body.token),{code:'UNAUTHENTICATED'});
  assert.equal((await call(body.refresh_secret,{pairing_id:first.body.pairing_id,account_binding:account},'/material-pairing/refresh')).status,403);assert.equal(store.identity(old.token).producer_id,'old-phone');
 }finally{await new Promise(r=>server.close(r));store.close();}
});
