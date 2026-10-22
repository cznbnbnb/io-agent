import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {loadApp} from './load-app.mjs';
import {setupMaterialStore} from './material-fixture.mjs';
import {MaterialStore as ServerStore} from '../../material-server/store.mjs';
import {listen} from '../../material-server/http.mjs';

function setup(t){
  const f=setupMaterialStore(t),platform={'@kit.CoreFileKit':{fileIo:f.io}},m=loadApp('MaterialOutbox',platform),w=loadApp('MaterialWire',platform);
  const principal={ownerId:'owner-test',producerId:'phone-test',serverId:'server-test'},queue=new m.MaterialOutbox();queue.initialize(f.root,principal);
  const source=f.store.ensure(f.source,'# 合成历史正文');
  const make=(revision=1,id=source.material_id)=>w.materialRevisionEvent(f.store,id,revision,{eventId:randomUUID(),idempotencyKey:randomUUID(),producerId:principal.producerId,createdAt:1000,expiresAt:100000});
  return {...f,m,w,queue,principal,source,make,restart(p=principal){const q=new m.MaterialOutbox();q.initialize(f.root,p);return q;}};
}
function ack(event){return JSON.stringify({schema_version:'1.1',event_id:event.event_id,material_id:event.body.material_id,revision:event.body.revision,commit_seq:event.body.revision,
  stored_at:'2026-10-11T00:00:00Z',receipt:{receipt_id:randomUUID(),subject_kind:'material',subject_id:event.body.material_id,subject_revision:event.body.revision,stage:'server_stored',actor_id:'server-storage',related_event_id:event.event_id,error:null}});}

test('outbox persists exact event bytes before dispatch and reconciles a sending row after restart',t=>{
  const f=setup(t),e=f.make(),row=f.queue.enqueue(e);assert.equal(f.queue.enqueue(e).queue_id,row.queue_id);
  const first=f.queue.claim(2000);assert.equal(first.action,'send');assert.equal(first.payload,JSON.stringify(e));assert.equal(f.queue.claim(2000),undefined);
  const restarted=f.restart(),lookup=restarted.claim(2000);assert.equal(lookup.action,'lookup');assert.equal(lookup.eventId,e.event_id);assert.equal(lookup.payload,'');
  assert(restarted.finish(lookup,404,'',2000));const retry=restarted.claim(2000);assert.equal(retry.payload,first.payload);
  const response=ack(e);assert(restarted.finish(retry,200,response,2000));assert.equal(f.restart().all()[0].receipt_id,JSON.parse(response).receipt.receipt_id);
  assert.equal(f.restart().all()[0].state,'server_stored');assert.equal(f.store.read(f.source.material_id).sync_state,'local');
});

test('revisions wait for their predecessor while unrelated materials can continue',t=>{
  const f=setup(t);f.store.appendTranscript(f.source.material_id,1,f.input,'asr');const r2=f.make(2);f.queue.enqueue(r2);
  assert.equal(f.queue.claim(2000),undefined);
  const other=f.store.ensure({...f.source.source,name:'take-'+'b'.repeat(32)},'另一份合成资料'),eOther=f.make(1,other.material_id);f.queue.enqueue(eOther);
  const cOther=f.queue.claim(2000);assert.equal(cOther.eventId,eOther.event_id);f.queue.finish(cOther,201,ack(eOther),2000);
  const r1=f.make();f.queue.enqueue(r1);const c1=f.queue.claim(2000);assert.equal(c1.eventId,r1.event_id);f.queue.finish(c1,201,ack(r1),2000);
  assert.equal(f.queue.claim(2000).eventId,r2.event_id);
});

test('backoff survives restart, observes Retry-After and rejects late duplicate callbacks',t=>{
  const f=setup(t),e=f.make();f.queue.enqueue(e);const c=f.queue.claim(2000);f.queue.finish(c,0,'private platform error',2000,1,12000);
  assert.equal(f.queue.finish(c,201,ack(e),2001),false);const restarted=f.restart();assert.equal(restarted.claim(13999),undefined);
  const lookup=restarted.claim(14000);assert.equal(lookup.action,'lookup');assert.equal(restarted.all()[0].last_error,'TRANSPORT_UNKNOWN');
  restarted.finish(lookup,503,'private server details',14000,0);assert.equal(restarted.all()[0].next_attempt_at,16000);
  assert(!JSON.stringify(restarted.all()).includes('private'));
});

test('uncertain outcomes still reconcile after expiry; absent expired uploads stop without sending',t=>{
  const f=setup(t),e=f.make();f.queue.enqueue(e);const c=f.queue.claim(2000);f.queue.finish(c,0,'',2000);
  const lookup=f.restart().claim(100001);assert.equal(lookup.action,'lookup');
  const q=f.restart(),active=q.claim(100001);assert.equal(active.action,'lookup');
  q.finish(active,404,'',100001);assert.equal(q.all()[0].state,'expired');assert.equal(q.claim(100002),undefined);
  const other=f.store.ensure({...f.source.source,name:'take-'+'c'.repeat(32)},'合成');q.enqueue(f.make(1,other.material_id));
  assert.equal(q.claim(100001),undefined);assert.equal(q.all().find(v=>v.material_id===other.material_id).state,'expired');
});

test('only matching storage receipts advance; wrong stage, subject and event block the object',t=>{
  for(const change of [a=>a.receipt.stage='glasses_displayed',a=>a.event_id='wrong',a=>a.receipt.subject_revision=99,a=>a.receipt.error='failed']){
    const f=setup(t),e=f.make();f.queue.enqueue(e);const c=f.queue.claim(2000),a=JSON.parse(ack(e));change(a);
    f.queue.finish(c,201,JSON.stringify(a),2000);assert.equal(f.queue.all()[0].state,'blocked');assert.equal(f.queue.all()[0].receipt_id,'');
    f.queue.resumeBlocked();assert.equal(f.queue.claim(2000).action,'lookup');
  }
});

test('credential correction reconciles first; owner, producer and service partitions never share acknowledgements',t=>{
  const f=setup(t),e=f.make();f.queue.enqueue(e);f.queue.finish(f.queue.claim(2000),401,'',2000);assert.equal(f.queue.all()[0].last_error,'AUTH_REQUIRED');
  for(const p of [{...f.principal,ownerId:'other'},{...f.principal,producerId:'other'},{...f.principal,serverId:'other'}])assert.equal(f.restart(p).all().length,0);
  const q=f.restart();q.resumeBlocked();const claim=q.claim(2000);assert.equal(claim.action,'lookup');q.finish(claim,200,ack(e),2000);assert.equal(q.all()[0].state,'server_stored');
});

test('disk promotion failure never exposes an uncommitted attempt or confirmation',t=>{
  const f=setup(t),e=f.make();f.queue.enqueue(e);f.failPromotion(true);assert.throws(()=>f.queue.claim(2000),/disk-failure/);
  assert.equal(f.queue.all()[0].attempts,0);f.failPromotion(false);const q=f.restart(),c=q.claim(2000);
  f.failPromotion(true);assert.throws(()=>q.finish(c,201,ack(e),2000),/disk-failure/);assert.equal(q.all()[0].state,'sending');
  f.failPromotion(false);assert.equal(f.restart().claim(2000).action,'lookup');
});

test('a stale coordinator cannot overwrite the ledger after another instance recovered it',t=>{
  const f=setup(t),e=f.make();f.queue.enqueue(e);const old=f.queue.claim(2000),newQueue=f.restart();
  assert.throws(()=>f.queue.finish(old,201,ack(e),2000),/OUTBOX_WRITER_STALE/);
  const lookup=newQueue.claim(2000);newQueue.finish(lookup,200,ack(e),2000);assert.equal(f.restart().all()[0].state,'server_stored');
});

test('payload corruption blocks its material without dropping ledger or blocking an unrelated upload',t=>{
  const f=setup(t),e=f.make(),row=f.queue.enqueue(e),parent=path.join(f.root,'material-outbox'),partition=fs.readdirSync(parent)[0];
  fs.writeFileSync(path.join(parent,partition,row.queue_id+'.payload.json'),'corrupt');
  const other=f.store.ensure({...f.source.source,name:'take-'+'d'.repeat(32)},'合成');const e2=f.make(1,other.material_id);f.queue.enqueue(e2);
  const claim=f.queue.claim(2000);assert.equal(claim.eventId,e2.event_id);assert.equal(f.queue.all().find(r=>r.event_id===e.event_id).last_error,'PAYLOAD_CORRUPT');
  assert.throws(()=>f.queue.enqueue({...e,event_id:'new-envelope'}),/REVISION_CONFLICT/);
});

test('ArkTS queue plus real HTTP server recovers a lost response without duplicate effects',async t=>{
  const f=setup(t),serverStore=new ServerStore(path.join(f.root,'server.sqlite'),{clock:()=>2000}),auth=serverStore.mint({owner:f.principal.ownerId,producer:f.principal.producerId,scopes:['materials:write','materials:read']});
  const server=await listen(serverStore),base='http://127.0.0.1:'+server.address().port;
  try{
    const e=f.make();f.queue.enqueue(e);const c=f.queue.claim(2000);
    const posted=await fetch(base+'/v1/material-events',{method:'POST',headers:{Authorization:'Bearer '+auth.token,'Content-Type':'application/json'},body:c.payload});
    assert.equal(posted.status,201);const stored=await posted.json(); // Simulate loss before phone persists receipt.
    const restarted=f.restart(),lookup=restarted.claim(2000),read=await fetch(base+'/v1/events/'+lookup.eventId,{headers:{Authorization:'Bearer '+auth.token}});
    assert.equal(read.status,200);restarted.finish(lookup,read.status,await read.text(),2000);
    assert.equal(f.restart().all()[0].receipt_id,stored.receipt.receipt_id);assert.equal(serverStore.ceiling(f.principal.ownerId),1);
    assert.equal(f.restart().claim(2000),undefined);
  }finally{await new Promise(resolve=>server.close(resolve));serverStore.close();}
});
