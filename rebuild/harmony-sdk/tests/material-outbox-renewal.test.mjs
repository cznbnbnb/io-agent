import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {loadApp} from './load-app.mjs';
import {setupMaterialStore} from './material-fixture.mjs';
import {MaterialStore as ServerStore} from '../../material-server/store.mjs';
import {listen} from '../../material-server/http.mjs';
const NOW=10000,TTL=604800000,AFTER=NOW+TTL+1000;
const absent=()=>JSON.stringify({schema_version:'1.0',error:{code:'EVENT_NOT_FOUND',message:'EVENT_NOT_FOUND',retryable:false,correlation_id:randomUUID()}});
function setup(t){
  const f=setupMaterialStore(t),platform={'@kit.CoreFileKit':{fileIo:f.io}},mod=loadApp('MaterialOutbox',platform);
  const principal={ownerId:'synthetic-owner',producerId:'synthetic-phone',serverId:'synthetic-service'},queue=new mod.MaterialOutbox();queue.initialize(f.root,principal);
  const source=f.store.ensure(f.source,'# 仅合成旧正文');queue.enqueueRevision(f.store,source.material_id,1,NOW);
  const directory=path.join(f.root,'material-outbox',fs.readdirSync(path.join(f.root,'material-outbox'))[0]);
  return {...f,queue,source,principal,directory,restart(){const q=new mod.MaterialOutbox();q.initialize(f.root,principal);return q;}};
}
function markAbsent(queue,time=AFTER){
  queue.claim(time);const row=queue.all()[0];assert.equal(row.state,'expired');assert(queue.recheckExpired(row.queue_id));
  const lookup=queue.claim(time);assert.equal(lookup.action,'lookup');queue.finish(lookup,404,absent(),time);return row.queue_id;
}
const file=(f,row)=>path.join(f.directory,row.queue_id+'.payload.json');

test('expiry, unknown outcomes and generic errors cannot authorize changing an upload identity',t=>{
  const f=setup(t),id=f.queue.all()[0].queue_id;
  assert.throws(()=>f.queue.renewExpired(id,AFTER),/REQUIRES_ABSENCE/);f.queue.claim(AFTER);
  assert.throws(()=>f.queue.renewExpired(id,AFTER),/REQUIRES_ABSENCE/);
  for(const [status,body] of [[404,''],[404,JSON.stringify({schema_version:'1.0',error:{code:'NOT_FOUND',retryable:false}})],[401,absent()],[503,absent()]]){
    const q=f.restart();if(q.all()[0].state==='blocked')q.resumeBlocked();else if(q.all()[0].state==='expired')q.recheckExpired(id);
    const claim=q.claim(AFTER+100000);assert.equal(claim.action,'lookup');q.finish(claim,status,body,AFTER+100000);
    assert.throws(()=>q.renewExpired(id,AFTER+100001),/REQUIRES_ABSENCE/);
  }
});

test('renewal keeps the exact revision body and retired payload; old callbacks and repeated local renewal are harmless',t=>{
  const f=setup(t),original=f.queue.all()[0],oldPayload=fs.readFileSync(file(f,original),'utf8');
  const id=markAbsent(f.queue);f.store.appendTranscript(f.source.material_id,1,f.input,'new-local-text');
  const renewed=f.queue.renewExpired(id,AFTER+1);assert.notEqual(renewed.event_id,original.event_id);assert.equal(renewed.revision,1);
  const next=JSON.parse(fs.readFileSync(file(f,renewed),'utf8'));assert.deepEqual(next.body,JSON.parse(oldPayload).body);
  assert.equal(fs.readFileSync(file(f,original),'utf8'),oldPayload);assert.equal(renewed.history[0].absence_confirmed_at,AFTER);
  const claim=f.queue.claim(AFTER+2);assert.equal(claim.eventId,renewed.event_id);
  assert.equal(f.queue.finish({queueId:original.queue_id,attempt:1,action:'lookup'},201,'',AFTER+3),false);
  assert.deepEqual(f.queue.renewExpired(id,AFTER+4),f.queue.all()[0]);
  const restarted=f.restart();assert.equal(restarted.all()[0].history[0].event_id,original.event_id);assert.equal(restarted.claim(AFTER+5).action,'lookup');
});

test('renewal publication failure recovers the same successor envelope and deadline instead of generating another',t=>{
  const f=setup(t),id=markAbsent(f.queue),rename=f.io.renameSync;let fail=true;
  f.io.renameSync=(a,b)=>{if(fail&&b.endsWith('/state.json')){fail=false;throw Error('synthetic ledger failure');}return rename(a,b);};
  assert.throws(()=>f.queue.renewExpired(id,AFTER+1),/synthetic ledger failure/);assert.equal(f.queue.all()[0].queue_id,id);
  const paths=fs.readdirSync(f.directory).filter(n=>n.endsWith('.payload.json'));assert.equal(paths.length,2);
  const successorFile=paths.find(n=>n!==id+'.payload.json'),before=fs.readFileSync(path.join(f.directory,successorFile),'utf8');
  const q=f.restart(),row=q.renewExpired(id,AFTER+5000);assert.equal(fs.readFileSync(file(f,row),'utf8'),before);
  assert.equal(JSON.parse(before).created_at,new Date(AFTER+1).toISOString());assert.equal(row.history.length,1);
  assert.equal(q.claim(AFTER+5001).payload,before);
});

test('schema-1 queues migrate conservatively and unknown schemas leave the original ledger intact',t=>{
  const f=setup(t),ledger=path.join(f.directory,'state.json'),snapshot=JSON.parse(fs.readFileSync(ledger,'utf8'));
  snapshot.schema=1;for(const row of snapshot.rows){delete row.history;delete row.absence_confirmed_at;}fs.writeFileSync(ledger,JSON.stringify(snapshot));
  const q=f.restart();assert.equal(q.all()[0].history.length,0);assert.equal(q.all()[0].absence_confirmed_at,0);
  q.claim(NOW+1);assert.equal(JSON.parse(fs.readFileSync(ledger,'utf8')).schema,2);
  const bad=JSON.parse(fs.readFileSync(ledger,'utf8'));bad.schema=3;const before=JSON.stringify(bad);fs.writeFileSync(ledger,before);
  assert.throws(()=>f.restart(),/OUTBOX_CORRUPT/);assert.equal(fs.readFileSync(ledger,'utf8'),before);
});

test('failed account reinitialization invalidates the coordinator instead of exposing old rows in the new partition',t=>{
  const f=setup(t),other={...f.principal,ownerId:'different-owner'},hash=createHash('sha256').update(JSON.stringify([other.ownerId,other.producerId,other.serverId])).digest('hex');
  const directory=path.join(f.root,'material-outbox',hash);fs.mkdirSync(directory);fs.writeFileSync(path.join(directory,'state.json'),JSON.stringify({schema:99}));
  assert.throws(()=>f.queue.initialize(f.root,other),/OUTBOX_CORRUPT/);assert.equal(f.queue.all().length,0);assert.equal(f.queue.matches(other),false);assert.equal(f.queue.matches(f.principal),false);
  assert.throws(()=>f.queue.claim(NOW),/OUTBOX_NOT_INITIALIZED/);assert.throws(()=>f.queue.enqueueRevision(f.store,f.source.material_id,1,NOW),/OUTBOX_NOT_INITIALIZED/);
  assert.equal(f.restart().all().length,1,'the old partition remains intact on disk');
});

test('a late callback from another account cannot confirm an identical event ID and attempt in the current partition',t=>{
  const f=setup(t),old=f.queue.claim(NOW),event=JSON.parse(old.payload),other={...f.principal,ownerId:'different-owner'};
  f.queue.initialize(f.root,other);f.queue.enqueue(event);const current=f.queue.claim(NOW);assert.equal(old.queueId,current.queueId);assert.equal(old.attempt,current.attempt);assert.notEqual(old.partitionId,current.partitionId);
  const receipt=JSON.stringify({schema_version:'1.1',event_id:event.event_id,material_id:event.body.material_id,revision:1,commit_seq:1,stored_at:new Date(NOW).toISOString(),receipt:{receipt_id:'synthetic-only',subject_kind:'material',subject_id:event.body.material_id,subject_revision:1,stage:'server_stored',actor_id:'server-storage',related_event_id:event.event_id,error:null}});
  assert.equal(f.queue.finish(old,201,receipt,NOW),false);assert.equal(f.queue.all()[0].receipt_id,'');assert(f.queue.finish(current,201,receipt,NOW));
});

test('lineage is bounded and renewal never overwrites a damaged original payload',t=>{
  const f=setup(t);let time=AFTER;
  for(let n=0;n<16;n++){const id=markAbsent(f.queue,time);const row=f.queue.renewExpired(id,time+1);assert.equal(row.history.length,n+1);time=row.expires_at+1;}
  const id=markAbsent(f.queue,time);assert.throws(()=>f.queue.renewExpired(id,time+1),/OUTBOX_RENEWAL_LIMIT/);
  const g=setup(t),badId=markAbsent(g.queue);fs.writeFileSync(file(g,g.queue.all()[0]),'damaged');
  assert.throws(()=>g.queue.renewExpired(badId,AFTER+1),/OUTBOX_PAYLOAD_CORRUPT/);assert.equal(g.queue.all()[0].queue_id,badId);
});

test('real service receipt remains recoverable past the deadline, with no renewed envelope or second commit',async t=>{
  const f=setup(t);let clock=NOW+1;const store=new ServerStore(path.join(f.root,'service.sqlite'),{clock:()=>clock});
  const mint=()=>store.mint({owner:f.principal.ownerId,producer:f.principal.producerId,scopes:['materials:write']});
  const server=await listen(store),base='http://127.0.0.1:'+server.address().port;
  try{
    const auth=mint(),claim=f.queue.claim(clock),response=await fetch(base+'/v1/material-events',{method:'POST',headers:{Authorization:'Bearer '+auth.token,'Content-Type':'application/json'},body:claim.payload});
    assert.equal(response.status,201);const accepted=await response.json();clock=AFTER;
    const fresh=mint(),q=f.restart(),lookup=q.claim(clock);assert.equal(lookup.action,'lookup');
    const found=await fetch(base+'/v1/events/'+lookup.eventId,{headers:{Authorization:'Bearer '+fresh.token}});assert.equal(found.status,200);q.finish(lookup,200,await found.text(),clock);
    assert.equal(q.all()[0].receipt_id,accepted.receipt.receipt_id);assert.equal(q.all()[0].history.length,0);
    assert.throws(()=>q.renewExpired(claim.queueId,clock+1),/REQUIRES_ABSENCE/);assert.equal(store.ceiling(f.principal.ownerId),1);
  }finally{await new Promise(resolve=>server.close(resolve));store.close();}
});

test('real EVENT_NOT_FOUND permits a fresh envelope for identical body; old expired POST cannot create another revision',async t=>{
  const f=setup(t),old=f.queue.all()[0],oldPayload=fs.readFileSync(file(f,old),'utf8'),clock=AFTER;
  const store=new ServerStore(path.join(f.root,'service.sqlite'),{clock:()=>clock}),auth=store.mint({owner:f.principal.ownerId,producer:f.principal.producerId,scopes:['materials:write']});
  const server=await listen(store),base='http://127.0.0.1:'+server.address().port,headers={Authorization:'Bearer '+auth.token,'Content-Type':'application/json'};
  try{
    f.queue.claim(clock);f.queue.recheckExpired(old.queue_id);const lookup=f.queue.claim(clock);
    const missing=await fetch(base+'/v1/events/'+lookup.eventId,{headers});assert.equal(missing.status,404);f.queue.finish(lookup,404,await missing.text(),clock);
    const row=f.queue.renewExpired(old.queue_id,clock),claim=f.queue.claim(clock),posted=await fetch(base+'/v1/material-events',{method:'POST',headers,body:claim.payload});assert.equal(posted.status,201);
    f.queue.finish(claim,posted.status,await posted.text(),clock);assert.equal(f.queue.all()[0].state,'server_stored');assert.equal(f.queue.all()[0].history.length,1);
    const expired=await fetch(base+'/v1/material-events',{method:'POST',headers,body:oldPayload});assert.equal(expired.status,410);assert.equal(store.ceiling(f.principal.ownerId),1);
    assert.equal(f.restart().all()[0].event_id,row.event_id);assert.equal(f.store.read(f.source.material_id).sync_state,'local');
  }finally{await new Promise(resolve=>server.close(resolve));store.close();}
});
