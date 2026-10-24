import test from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {randomUUID} from 'node:crypto';
import {MaterialStore} from '../store.mjs';import {listen} from '../http.mjs';import {sha,canonical} from '../json.mjs';
import {PART_BYTES} from '../material-transfer.mjs';import {MaterialQueryClient} from '../query/client.mjs';
const sample=JSON.parse(fs.readFileSync(new URL('../../../docs/contracts/material-v1.1.json',import.meta.url))).events[2];
function event(text='合成全文🙂。'.repeat(90000)){
 const e=structuredClone(sample);Object.assign(e,{event_id:randomUUID(),idempotency_key:randomUUID(),producer_id:'phone-test',created_at:new Date().toISOString(),expires_at:new Date(Date.now()+3600000).toISOString()});
 Object.assign(e.body,{material_id:'large-material',revision:1,base_revision:0,text_revision:1});e.body.full_text.text=text;return e;
}
function setup(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'io-transfer-')),file=path.join(dir,'test.sqlite');let now=Date.now(),store=new MaterialStore(file,{clock:()=>now});
 const scopes=['materials:write','materials:read','changes:read'],writer=store.mint({owner:'owner',producer:'phone-test',scopes,ttlMs:86400000});
 t.after(()=>{store.close();fs.rmSync(dir,{recursive:true,force:true});});
 return{dir,writer,get store(){return store;},setTime(n){now=n;},restart(){store.close();store=new MaterialStore(file,{clock:()=>now});}};
}
const code=s=>e=>e.code===s;
function plan(e){const bytes=Buffer.from(canonical(e));return {bytes,manifest:{event_id:e.event_id,bytes:bytes.length,sha256:sha(bytes)}};}
function part(p,index){const b=p.bytes.subarray(index*PART_BYTES,(index+1)*PART_BYTES);return{data:b.toString('base64'),sha256:sha(b)};}
function upload(f,e){const p=plan(e),id=p.manifest.sha256;f.store.transfer.begin(f.writer.token,p.manifest);for(let i=0;i<Math.ceil(p.bytes.length/PART_BYTES);i++)f.store.transfer.put(f.writer.token,id,i,part(p,i));return {p,id,result:f.store.transfer.finalize(f.writer.token,id)};}
function cancellation(e){return {event_id:e.event_id,idempotency_key:e.idempotency_key,material_id:e.body.material_id,revision:e.body.revision,payload_sha256:plan(e).manifest.sha256,expires_at:e.expires_at};}

test('atomic cancellation fences late original uploads without deleting material; replacement and replay survive restart',t=>{
 const f=setup(t),old=event('outdated'),request=cancellation(old),proof=f.store.cancelMaterial(f.writer.token,request);
 assert.equal(proof.state,'cancelled');assert.equal(f.store.ceiling('owner'),0);f.restart();assert.deepEqual(f.store.event(f.writer.token,old.event_id),proof);
 assert.deepEqual(f.store.cancelMaterial(f.writer.token,request),proof);assert.throws(()=>f.store.submit(f.writer.token,old),code('MATERIAL_EVENT_CANCELLED'));
 assert.throws(()=>f.store.submit(f.writer.token,{...old,event_id:randomUUID()}),code('MATERIAL_EVENT_CANCELLED'));
 assert.throws(()=>f.store.submit(f.writer.token,{...old,idempotency_key:randomUUID()}),code('EVENT_ID_CONFLICT'));
 assert.throws(()=>f.store.cancelMaterial(f.writer.token,{...request,payload_sha256:'1'.repeat(64)}),code('MATERIAL_CANCELLATION_CONFLICT'));
 const fresh=event('latest complete text');assert.equal(f.store.submit(f.writer.token,fresh).status,201);assert.equal(f.store.ceiling('owner'),1);
 assert.equal(f.store.get(f.writer.token,fresh.body.material_id).body.full_text.text,'latest complete text');assert.deepEqual(f.store.cancelMaterial(f.writer.token,request),proof);
});

test('cancellation of an already committed event returns its receipt; partial transfer cancellation blocks finalize',t=>{
 const f=setup(t),accepted=event('accepted'),ack=f.store.submit(f.writer.token,accepted).body;
 assert.deepEqual(f.store.cancelMaterial(f.writer.token,cancellation(accepted)),ack);assert.throws(()=>f.store.cancelMaterial(f.writer.token,{...cancellation(accepted),payload_sha256:'0'.repeat(64)}),code('MATERIAL_CANCELLATION_CONFLICT'));assert.equal(f.store.ceiling('owner'),1);
 const pending=event();Object.assign(pending.body,{revision:2,base_revision:1,text_revision:2});const p=plan(pending),id=p.manifest.sha256;
 f.store.transfer.begin(f.writer.token,p.manifest);for(let i=0;i<Math.ceil(p.bytes.length/PART_BYTES);i++)f.store.transfer.put(f.writer.token,id,i,part(p,i));
 f.store.cancelMaterial(f.writer.token,cancellation(pending));assert.equal(f.store.db.prepare('SELECT COUNT(*) n FROM material_uploads WHERE hash=?').get(id).n,0);assert.throws(()=>f.store.transfer.finalize(f.writer.token,id),code('UPLOAD_NOT_FOUND'));assert.throws(()=>f.store.transfer.begin(f.writer.token,plan(pending).manifest),code('MATERIAL_EVENT_CANCELLED'));assert.equal(f.store.ceiling('owner'),1);
 const read=f.store.mint({owner:'owner',producer:'reader',scopes:['materials:read']});assert.throws(()=>f.store.cancelMaterial(read.token,cancellation(pending)),code('FORBIDDEN'));
 const other=f.store.mint({owner:'owner',producer:'other-phone',scopes:['materials:write']});assert.throws(()=>f.store.cancelMaterial(other.token,cancellation(pending)),code('EVENT_ID_CONFLICT'));
 f.store.revoke(f.writer.token_id);assert.throws(()=>f.store.cancelMaterial(f.writer.token,cancellation(pending)),code('UNAUTHENTICATED'));
});

test('real concurrent HTTP commit and cancellation select one durable outcome',async t=>{
 const f=setup(t),server=await listen(f.store);t.after(()=>new Promise(r=>server.close(r)));const base=`http://127.0.0.1:${server.address().port}/v1/`;
 const e=event('race');const post=(url,body)=>fetch(base+url,{method:'POST',headers:{Authorization:'Bearer '+f.writer.token,'Content-Type':'application/json'},body:JSON.stringify(body)});
 const [cancel,commit]=await Promise.all([post('material-cancellations',cancellation(e)),post('material-events',e)]);assert.equal(cancel.status,200);const result=await cancel.json();
 if(result.state==='cancelled'){assert.equal(commit.status,409);assert.equal(f.store.ceiling('owner'),0);}else{assert.equal(commit.status,201);assert.deepEqual(await commit.json(),result);assert.equal(f.store.ceiling('owner'),1);}
 assert.deepEqual(await (await post('material-cancellations',cancellation(e))).json(),result);
});

test('partial fragments are invisible; restart resumes exact chunks and commit returns one immutable receipt',t=>{
 const f=setup(t),e=event(),p=plan(e),id=p.manifest.sha256;
 assert.throws(()=>f.store.submit(f.writer.token,e),code('PAYLOAD_TOO_LARGE'));
 f.store.transfer.begin(f.writer.token,p.manifest);f.store.transfer.put(f.writer.token,id,0,part(p,0));
 assert.equal(f.store.ceiling('owner'),0);assert.throws(()=>f.store.get(f.writer.token,e.body.material_id),code('MATERIAL_NOT_FOUND'));
 assert.throws(()=>f.store.transfer.finalize(f.writer.token,id),code('UPLOAD_INCOMPLETE'));
 f.restart();assert.deepEqual(f.store.transfer.begin(f.writer.token,p.manifest).received,[0]);
 f.store.transfer.put(f.writer.token,id,0,part(p,0));
 for(let i=1;i<Math.ceil(p.bytes.length/PART_BYTES);i++)f.store.transfer.put(f.writer.token,id,i,part(p,i));
 const accepted=f.store.transfer.finalize(f.writer.token,id);assert.equal(accepted.status,201);
 assert.deepEqual(f.store.get(f.writer.token,e.body.material_id).body,e.body);assert.equal(f.store.ceiling('owner'),1);
 f.restart();assert.deepEqual(f.store.transfer.finalize(f.writer.token,id).body,accepted.body);
 assert.deepEqual(f.store.transfer.status(f.writer.token,id).received,[]);assert.equal(f.store.ceiling('owner'),1);
});

test('fragment hashes, producer/owner boundaries, event binding, scopes and revocation remain enforced',t=>{
 const f=setup(t),e=event(),p=plan(e),id=p.manifest.sha256;f.store.transfer.begin(f.writer.token,p.manifest);
 for(const [owner,producer] of [['foreign','phone-test'],['owner','other-phone']]){
  const other=f.store.mint({owner,producer,scopes:['materials:write']});assert.throws(()=>f.store.transfer.status(other.token,id),code('UPLOAD_NOT_FOUND'));
 }
 const read=f.store.mint({owner:'owner',producer:'reader',scopes:['materials:read']});assert.throws(()=>f.store.transfer.begin(read.token,p.manifest),code('FORBIDDEN'));
 assert.throws(()=>f.store.transfer.put(f.writer.token,id,0,{...part(p,0),sha256:'0'.repeat(64)}),code('INVALID_UPLOAD_PART'));
 const bad=Buffer.alloc(PART_BYTES,65),badPart={data:bad.toString('base64'),sha256:sha(bad)};
 f.store.transfer.put(f.writer.token,id,0,part(p,0));assert.throws(()=>f.store.transfer.put(f.writer.token,id,0,badPart),code('UPLOAD_PART_CONFLICT'));
 for(let i=1;i<Math.ceil(p.bytes.length/PART_BYTES);i++)f.store.transfer.put(f.writer.token,id,i,part(p,i));
 f.store.revoke(f.writer.token_id);assert.throws(()=>f.store.transfer.finalize(f.writer.token,id),code('UNAUTHENTICATED'));assert.equal(f.store.ceiling('owner'),0);
});

test('lost finalize reply reconciles original event; changed revision still obeys CAS and text revision',t=>{
 const f=setup(t),e=event(),original=f.store.submitAssembled.bind(f.store);let lost=true;
 f.store.submitAssembled=(...a)=>{const result=original(...a);if(lost){lost=false;throw Error('synthetic crash after commit');}return result;};
 assert.throws(()=>upload(f,e),/synthetic crash/);assert.equal(f.store.ceiling('owner'),1);
 const ack=f.store.event(f.writer.token,e.event_id),id=plan(e).manifest.sha256;
 assert.deepEqual(f.store.transfer.finalize(f.writer.token,id).body,ack);assert.equal(f.store.ceiling('owner'),1);
 const changed=event('不同正文'.repeat(100000));assert.throws(()=>upload(f,changed),code('REVISION_CONFLICT'));assert.equal(f.store.ceiling('owner'),1);
});

test('bounded staging expires independently; expired event cannot be finalized',t=>{
 const f=setup(t),e=event(),p=plan(e);e.expires_at=new Date(Date.now()-1000).toISOString();e.created_at=new Date(Date.now()-2000).toISOString();
 assert.throws(()=>upload(f,e),code('EXPIRED'));assert.equal(f.store.ceiling('owner'),0);
 for(let i=0;i<15;i++)f.store.transfer.begin(f.writer.token,{event_id:'event-'+i,bytes:1,sha256:sha(String(i))});
 assert.throws(()=>f.store.transfer.begin(f.writer.token,p.manifest),code('UPLOAD_BUDGET'));
 f.setTime(Date.now()+86401000);const renewed=f.store.mint({owner:'owner',producer:'phone-test',scopes:['materials:write']});
 assert.throws(()=>f.store.transfer.status(renewed.token,plan(e).manifest.sha256),code('UPLOAD_EXPIRED'));
 f.store.transfer.begin(renewed.token,p.manifest);assert.equal(f.store.db.prepare('SELECT COUNT(*) n FROM material_uploads').get().n,1);
});

test('whole-event hash, manifest event id and malformed assembled JSON never commit',t=>{
 const f=setup(t),e=event('synthetic'),p=plan(e);
 for(const [bytes,id,hash,error] of [
  [p.bytes,e.event_id,'0'.repeat(64),'UPLOAD_HASH_MISMATCH'],
  [p.bytes,'wrong-event',sha(p.bytes),'UPLOAD_EVENT_MISMATCH'],
  [Buffer.from('null'),'null-event',sha('null'),'UPLOAD_EVENT_MISMATCH']
 ]){
  f.store.transfer.begin(f.writer.token,{event_id:id,bytes:bytes.length,sha256:hash});
  f.store.transfer.put(f.writer.token,hash,0,{data:bytes.toString('base64'),sha256:sha(bytes)});
  assert.throws(()=>f.store.transfer.finalize(f.writer.token,hash),code(error));assert.equal(f.store.ceiling('owner'),0);
 }
});

test('real HTTP stays below 256 KiB; query hydrates exact Unicode original for get/search/changes and deletion wins',async t=>{
 const f=setup(t),server=await listen(f.store);t.after(()=>new Promise(r=>server.close(r)));const base=`http://127.0.0.1:${server.address().port}/v1/`;
 const e=event(),p=plan(e),id=p.manifest.sha256;
 async function post(url,body){const text=JSON.stringify(body);assert.ok(Buffer.byteLength(text)<=262144);const res=await fetch(base+url,{method:'POST',headers:{Authorization:'Bearer '+f.writer.token,'Content-Type':'application/json'},body:text});assert.ok(res.ok,await res.clone().text());return res.json();}
 await post('material-uploads',p.manifest);for(let i=0;i<Math.ceil(p.bytes.length/PART_BYTES);i++)await post(`material-uploads/${id}/parts/${i}`,part(p,i));
 for(const input of [null,[],false,0,'', {extra:true}]){
  const response=await fetch(base+`material-uploads/${id}/finalize`,{method:'POST',headers:{Authorization:'Bearer '+f.writer.token,'Content-Type':'application/json'},body:JSON.stringify(input)});
  assert.equal(response.status,400);assert.equal((await response.json()).error.code,'INVALID_UPLOAD');assert.equal(f.store.ceiling('owner'),0);
 }
 await post(`material-uploads/${id}/finalize`,{});
 const credential=path.join(f.dir,'reader.json');fs.writeFileSync(credential,JSON.stringify(f.writer),{mode:0o600});const identity=f.store.identity(f.writer.token);
 const client=new MaterialQueryClient({schema_version:'1.0',base_url:base,owner_id:'owner',producer_id:'phone-test',server_id:identity.server_id,credential_file:credential,allow_loopback_http:true});
 for(const value of [await client.get({material_id:e.body.material_id}),await client.search({keyword:'合成全文'}),await client.changes()])assert.deepEqual(value.items[0].body,e.body);
 assert.throws(()=>f.store.page(f.writer.token,'materials'),code('MATERIAL_CONTENT_REQUIRED'));
 const read=f.store.transfer.content.bind(f.store.transfer);f.store.transfer.content=(...args)=>{const r=read(...args);r.data='AAAA';return r;};
 await assert.rejects(client.get({material_id:e.body.material_id}),code('INVALID_RESPONSE'));f.store.transfer.content=read;
 const deleted=event('');Object.assign(deleted.body,{revision:2,base_revision:1,operation:'delete',utterances:[]});
 f.store.transfer.content=(...args)=>{const r=read(...args);if(args[3]===0)f.store.submit(f.writer.token,deleted);return r;};
 await assert.rejects(client.get({material_id:e.body.material_id}),code('MATERIAL_DELETED'));
 assert.equal((await client.changes()).items[0].withdrawn,true);
});
