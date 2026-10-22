import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {loadApp} from './load-app.mjs';
import {setupMaterialStore} from './material-fixture.mjs';
import {MaterialStore as ServerStore} from '../../material-server/store.mjs';
import {listen} from '../../material-server/http.mjs';

function setup(t){
  const f=setupMaterialStore(t),platform={'@kit.CoreFileKit':{fileIo:f.io}},o=loadApp('MaterialOutbox',platform),d=loadApp('MaterialSyncDiscovery',platform);
  const principal={ownerId:'synthetic-owner',producerId:'synthetic-phone',serverId:'synthetic-server'};
  const queue=new o.MaterialOutbox();queue.initialize(f.root,principal);
  const discovery=new d.MaterialSyncDiscovery(queue);
  const root=path.join(f.root,'material-outbox',fs.readdirSync(path.join(f.root,'material-outbox'))[0]);
  return {...f,queue,discovery,principal,root,restart(){const q=new o.MaterialOutbox();q.initialize(f.root,principal);return {queue:q,discovery:new d.MaterialSyncDiscovery(q)};}};
}
function drain(discovery,store,now,budget=2){
  const reports=[];for(let n=0;n<100;n++){const r=discovery.scan(store,now,budget,1);reports.push(r);assert(r.inspected<=budget);assert(r.enqueued<=1);if(r.sweepComplete)return reports;}
  throw Error('Discovery did not finish bounded sweep');
}
function payload(f,row){return JSON.parse(fs.readFileSync(path.join(f.root,row.queue_id+'.payload.json'),'utf8'));}

test('bounded discovery queues immutable history and tombstone in order, restart never regenerates IDs/dates',t=>{
  const f=setup(t),r1=f.store.ensure(f.source,'合成原文'),r2=f.store.appendTranscript(r1.material_id,1,f.input,'asr');f.store.delete(r1.material_id,r2.revision);
  const reports=drain(f.discovery,f.store,10000);assert.equal(reports.reduce((n,r)=>n+r.enqueued,0),3);
  const rows=JSON.parse(JSON.stringify(f.queue.all()));assert.deepEqual(rows.map(r=>r.revision),[1,2,3]);
  assert.equal(payload(f,rows[0]).body.full_text.text,'合成原文');assert.equal(payload(f,rows[1]).body.full_text.text,'测试语句');assert.equal(payload(f,rows[2]).body.operation,'delete');
  assert.equal(f.queue.claim(11000).eventId,rows[0].event_id);assert.equal(f.queue.claim(11000),undefined);
  const next=f.restart();drain(next.discovery,f.store,999000);assert.equal(next.queue.all().length,3);
  assert.deepEqual(next.queue.all().map(r=>[r.event_id,r.payload_hash,r.expires_at]),rows.map(r=>[r.event_id,r.payload_hash,r.expires_at]));
  assert.equal(f.store.read(r1.material_id).sync_state,'local');
});

test('orphan payload after failed ledger publication is adopted with original deadline after restart',t=>{
  const f=setup(t),r1=f.store.ensure(f.source,'仅合成原文'),rename=f.io.renameSync;let fail=true;
  f.io.renameSync=(from,to)=>{if(fail&&to.endsWith('/state.json')){fail=false;throw Error('synthetic disk failure /private/path');}return rename(from,to);};
  const first=f.discovery.scan(f.store,10000,1,1);assert.equal(first.issues[0].code,'MATERIAL_DISCOVERY_FAILED');assert.equal(first.inspected,1);assert.equal(f.queue.all().length,0);
  const file=fs.readdirSync(f.root).find(n=>n.endsWith('.payload.json')),original=fs.readFileSync(path.join(f.root,file),'utf8');
  const next=f.restart(),recovered=next.discovery.scan(f.store,500000,1,1);assert.equal(recovered.enqueued,1);
  assert.equal(next.queue.claim(500001).payload,original);assert.equal(JSON.parse(original).created_at,new Date(10000).toISOString());
  assert.equal(f.store.read(r1.material_id).revision,1);assert(!JSON.stringify(first).includes('/private/path'));
});

test('damaged history blocks that object while unrelated material can still be discovered',t=>{
  const f=setup(t),a=f.store.ensure(f.source,'a');f.store.appendTranscript(a.material_id,1,f.input,'asr');
  const b=f.store.ensure({...f.source,name:'take-'+'b'.repeat(32)},'b');
  const directory=path.join(f.root,'..','..','materials',a.material_id);
  // Locate the actual fixture sidecar directory, not a copied fake store.
  const materialRoot=path.join(f.root,'..','..','materials');assert(fs.existsSync(materialRoot));
  fs.unlinkSync(path.join(directory,'revision-000000001.json'));
  const reports=drain(f.discovery,f.store,10000,1);assert(reports.some(r=>r.issues.some(i=>i.materialId===a.material_id&&i.revision===1&&i.code==='MATERIAL_NOT_FOUND')));
  assert.equal(f.queue.all().length,1);assert.equal(f.queue.all()[0].material_id,b.material_id);assert.equal(f.queue.all()[0].revision,1);
});

test('registered expired/blocked rows are retained; discovery does not silently reissue or resolve conflicts',t=>{
  const f=setup(t);f.store.ensure(f.source,'合成');drain(f.discovery,f.store,10000);
  assert.equal(f.queue.claim(10000+604800000),undefined);assert.equal(f.queue.all()[0].state,'expired');
  const row=JSON.parse(JSON.stringify(f.queue.all()[0])),next=f.restart();drain(next.discovery,f.store,10000+2*604800000);
  assert.deepEqual(next.queue.all()[0],row);
});

test('a late new revision and material inserted before cursor are picked up on the next sweep',t=>{
  const f=setup(t),a=f.store.ensure(f.source,'a');f.discovery.scan(f.store,10000,1,1);
  f.store.appendTranscript(a.material_id,1,f.input,'asr');const b=f.store.ensure({...f.source,name:'take-'+'0'.repeat(32)},'b');assert(b.material_id<a.material_id);
  drain(f.discovery,f.store,11000);drain(f.discovery,f.store,12000);
  assert.equal(f.queue.all().filter(r=>r.material_id===a.material_id).length,2);assert.equal(f.queue.all().filter(r=>r.material_id===b.material_id).length,1);
  assert.throws(()=>f.discovery.scan(f.store,0,129,1),/DISCOVERY_BUDGET_INVALID/);
});

test('corrupt orphan is preserved as evidence and never overwritten with a freshly generated envelope',t=>{
  const f=setup(t);f.store.ensure(f.source,'合成');const rename=f.io.renameSync;
  f.io.renameSync=(from,to)=>{if(to.endsWith('/state.json'))throw Error('synthetic ledger failure');return rename(from,to);};
  f.discovery.scan(f.store,10000,1,1);f.io.renameSync=rename;
  const file=path.join(f.root,fs.readdirSync(f.root).find(n=>n.endsWith('.payload.json'))),event=JSON.parse(fs.readFileSync(file,'utf8'));
  event.body.full_text.text='已损坏的正文';const corrupt=JSON.stringify(event);fs.writeFileSync(file,corrupt);
  const next=f.restart(),report=next.discovery.scan(f.store,20000,1,1);
  assert.equal(report.issues[0].code,'OUTBOX_PAYLOAD_CORRUPT');assert.equal(next.queue.all().length,0);assert.equal(fs.readFileSync(file,'utf8'),corrupt);
});

test('discovered original, update and deletion are accepted by the real local service as three distinct commits',async t=>{
  const f=setup(t),a=f.store.ensure(f.source,'合成原文');f.store.appendTranscript(a.material_id,1,f.input,'asr');f.store.delete(a.material_id,2);
  const store=new ServerStore(path.join(f.root,'service.sqlite'),{clock:()=>11000}),auth=store.mint({owner:f.principal.ownerId,producer:f.principal.producerId,scopes:['materials:write','materials:read']});
  const server=await listen(store),base='http://127.0.0.1:'+server.address().port,headers={Authorization:'Bearer '+auth.token,'Content-Type':'application/json'};
  try{
    drain(f.discovery,f.store,10000);
    for(const revision of [1,2,3]){
      const claim=f.queue.claim(11000);assert.equal(claim.action,'send');assert.equal(JSON.parse(claim.payload).body.revision,revision);
      const response=await fetch(base+'/v1/material-events',{method:'POST',headers,body:claim.payload});assert.equal(response.status,201);
      f.queue.finish(claim,response.status,await response.text(),11000);
    }
    const next=f.restart();drain(next.discovery,f.store,12000);assert(next.queue.all().every(row=>row.state==='server_stored'));
    assert.equal(store.ceiling(f.principal.ownerId),3);assert.equal(next.queue.claim(12000),undefined);
    assert.equal((await fetch(base+'/v1/materials/'+a.material_id,{headers})).status,410);
    assert.equal(f.store.read(a.material_id).sync_state,'local','server storage does not mark original audio uploaded');
  }finally{await new Promise(resolve=>server.close(resolve));store.close();}
});
