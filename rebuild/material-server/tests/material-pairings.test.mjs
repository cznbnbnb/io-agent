import test from 'node:test';import assert from 'node:assert/strict';
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
