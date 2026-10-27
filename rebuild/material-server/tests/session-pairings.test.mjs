import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID,randomBytes} from 'node:crypto';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {BridgeClient} from '../../agent-bridge/client.mjs';
import {MaterialStore} from '../store.mjs';import {listen} from '../http.mjs';
const secret=()=>randomBytes(32).toString('base64url');
const metadata=session=>({runtime:'workbuddy',route:{computer_id:'test-computer',agent_id:'io-workbuddy',project_id:'project',session_id:session},topic:'测试会话',workspace:'/synthetic'});
const start=s=>({id:randomUUID(),claim_secret:secret(),metadata:metadata(s)});
const approval=r=>{const q=new URLSearchParams(new URL(r.qr_url).hash.slice(1));return {id:q.get('id'),code:q.get('code')};};
test('QR and string share one owner-approved, scoped, durable session binding',async t=>{
 let now=Date.now();const store=new MaterialStore(':memory:',{clock:()=>now}),server=await listen(store,0);t.after(async()=>{await new Promise(r=>server.close(r));store.close();});
 const base='http://127.0.0.1:'+server.address().port+'/v1/';
 const call=async(action,body,token)=>{const r=await fetch(base+action,{method:body===undefined?'GET':'POST',headers:{...(token?{Authorization:'Bearer '+token}:{}),'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});return {status:r.status,body:await r.json()};};
 const phone=store.devices.enroll({owner:'caller600-codex',role:'phone',label:'Synthetic phone'}),other=store.devices.enroll({owner:'caller601-codex',role:'phone',label:'Other phone'});
 const p=start('one'),q=store.sessionPairings.start(p),a=approval(q),claim={id:p.id,claim_secret:p.claim_secret};
 assert.equal(q.pairing_string,'io-agent-pair/1:'+a.id+':'+a.code);assert(!JSON.stringify(q).includes(p.claim_secret));
 assert.equal(store.sessionPairings.claim(claim).pending,true);assert.equal((await call('session-pairings/approve',a)).status,401);
 assert.equal(store.sessionPairings.preview(phone.token,a).metadata.route.session_id,'one');
 store.sessionPairings.approve(phone.token,a);store.sessionPairings.approve(phone.token,a);
 assert.throws(()=>store.sessionPairings.approve(other.token,a),{code:'PAIRING_ALREADY_BOUND'});
 const c=store.sessionPairings.claim(claim);assert.deepEqual(c,store.sessionPairings.claim(claim));assert(!c.scopes.includes('devices:pair'));
 assert.throws(()=>store.sessionPairings.claim({...claim,claim_secret:a.code}),{code:'PAIRING_SECRET_REQUIRED'});
 assert.equal((await call('credentials/refresh',{},c.token)).status,403);assert.equal((await call('materials',undefined,c.token)).status,403);
 const event=(id,route)=>({schema_version:'1.0',event_id:randomUUID(),idempotency_key:randomUUID(),kind:'task',producer_id:c.producer_id,created_at:new Date(now).toISOString(),expires_at:new Date(now+3600000).toISOString(),body:{task_id:id,revision:1,route,command:'Synthetic task',state:'queued',allow_create_session:false}});
 store.queueSubmit(c.token,event('own',p.metadata.route),'task');
 assert.throws(()=>store.queueSubmit(c.token,event('foreign',metadata('other').route),'task'),{code:'FORBIDDEN'});
 const foreign=event('foreign',metadata('other').route);foreign.producer_id=phone.producer_id;store.queueSubmit(phone.token,foreign,'task');
 assert.equal(store.queueGet(c.token,'task','own').body.route.session_id,'one');assert.throws(()=>store.queueGet(c.token,'task','foreign'),{code:'TASK_NOT_FOUND'});
 assert.throws(()=>store.watchSet(c.token,'foreign',{enabled:false,next_checkin_at:null,note:''}),{code:'TASK_NOT_FOUND'});
 const page=store.inbox(c.token,{limit:'20'});assert(page.items.length);assert(page.items.every(x=>x.body.route.session_id==='one'));
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'session-renew-codex-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const file=path.join(dir,'device.json');fs.writeFileSync(file,JSON.stringify({...c,base_url:base,allow_loopback_http:true,session_pairing:{id:p.id,claim_secret:p.claim_secret,metadata:p.metadata}}),{mode:0o600});
 const client=new BridgeClient({schema_version:'1.0',base_url:base,allow_loopback_http:true,credential_file:file,owner_id:c.owner_id,producer_id:c.producer_id,server_id:c.server_id},{clock:()=>now});
 now+=40*86400000;assert.equal((await client.identity()).producer_id,c.producer_id);assert.notEqual(JSON.parse(fs.readFileSync(file)).token,c.token);
 const renewed=store.sessionPairings.claim(claim);assert.notEqual(c.token,renewed.token);assert.equal(c.device_id,renewed.device_id);
 store.devices.revoke(c.device_id);assert.throws(()=>store.sessionPairings.claim(claim),{code:'PAIRING_REVOKED'});assert.throws(()=>store.auth(renewed.token),{code:'UNAUTHENTICATED'});
});
test('malformed, changed and expired requests cannot bind',()=>{
 let now=Date.now();const s=new MaterialStore(':memory:',{clock:()=>now});try{
 const p=start('expired'),r=s.sessionPairings.start(p);assert.deepEqual(r,s.sessionPairings.start(p));
 assert.throws(()=>s.sessionPairings.start({...p,owner:'spoof'}),{code:'PAIRING_INVALID'});
 assert.throws(()=>s.sessionPairings.start({...p,metadata:metadata('changed')}),{code:'PAIRING_CONFLICT'});
 now+=600000;assert.throws(()=>s.sessionPairings.claim({id:p.id,claim_secret:p.claim_secret}),{code:'PAIRING_EXPIRED'});
 }finally{s.close();}
});

test('explicit computer approval covers new Agent sessions, renews and is revocable without widening old session grants',()=>{
 let now=Date.now();const s=new MaterialStore(':memory:',{clock:()=>now});try{
  const phone=s.devices.enroll({owner:'caller602-codex',role:'phone',label:'Synthetic phone'}),p=start('first');p.metadata.mode='computer';
  const r=s.sessionPairings.start(p),a=approval(r);assert.equal(s.sessionPairings.preview(phone.token,a).metadata.mode,'computer');s.sessionPairings.approve(phone.token,a);
  const proof={id:p.id,claim_secret:p.claim_secret},c=s.sessionPairings.claim(proof);assert(c.scopes.includes('devices:pair'));assert.equal(s.db.prepare('SELECT count(*) n FROM session_bindings WHERE producer=?').get(c.producer_id).n,0);
  const route={...metadata('second').route,agent_id:'io-current-codex'};
  const event={schema_version:'1.0',event_id:randomUUID(),idempotency_key:randomUUID(),kind:'task',producer_id:c.producer_id,created_at:new Date(now).toISOString(),expires_at:new Date(now+60000).toISOString(),body:{task_id:'new-session-task',revision:1,route,command:'Synthetic',state:'queued',allow_create_session:false}};
  s.queueSubmit(c.token,event,'task');assert.equal(s.queueGet(c.token,'task','new-session-task').body.route.session_id,'second');
  now+=40*86400000;const next=s.sessionPairings.claim(proof);assert.equal(next.device_id,c.device_id);assert(next.scopes.includes('devices:pair'));assert.notEqual(next.token,c.token);
  assert.throws(()=>s.sessionPairings.start({...start('bad'),metadata:{...metadata('bad'),mode:'other'}}),{code:'PAIRING_INVALID'});
  s.devices.revoke(c.device_id);assert.throws(()=>s.sessionPairings.claim(proof),{code:'PAIRING_REVOKED'});
 }finally{s.close();}
});
