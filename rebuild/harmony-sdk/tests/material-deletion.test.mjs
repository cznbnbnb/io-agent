import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {loadApp} from './load-app.mjs';
import {setupMaterialStore} from './material-fixture.mjs';
import {MaterialStore as ServerStore} from '../../material-server/store.mjs';
import {listen} from '../../material-server/http.mjs';

function setup(t){
  const f=setupMaterialStore(t),platform={'@kit.CoreFileKit':{fileIo:f.io}};
  return {...f,...loadApp('MaterialDeletion',platform),platform};
}

test('deleting a migrated recording keeps immutable history and cannot be revived after restart',t=>{
  const f=setup(t),original=f.store.ensure(f.source,'原有录音文字');
  const asr=f.store.appendTranscript(original.material_id,1,f.input,'saved-job');
  const deleted=f.markMaterialDeleted(f.store,f.source);
  assert.equal(deleted.operation,'delete');assert.equal(deleted.revision,3);
  assert.equal(deleted.text,'');assert.equal(deleted.utterances.length,0);
  assert.equal(f.store.read(original.material_id,asr.revision).text,'测试语句');
  const restarted=new f.MaterialStore();restarted.initialize(f.root);
  assert.equal(restarted.ensure(f.source,'迟到旧目录文字').operation,'delete');
  assert.equal(f.markMaterialDeleted(restarted,f.source).revision,3);
  assert.throws(()=>restarted.appendTranscript(original.material_id,3,f.input,'late-job'),/MATERIAL_DELETED/);
  assert.throws(()=>restarted.appendTranscript(original.material_id,2,f.input,'saved-job'),/MATERIAL_DELETED/);
  assert.equal(restarted.read(original.material_id).revision,3);
});

test('unmigrated untranscribed sources get metadata and one tombstone without importing legacy text',t=>{
  const f=setup(t),source={...f.source,kind:'lifelog',name:'seg-'+'b'.repeat(32),frameMs:60,audioFrames:1000,decodedChannels:0};
  const deleted=f.markMaterialDeleted(f.store,source);
  assert.equal(deleted.revision,2);assert.equal(deleted.operation,'delete');
  const initial=f.store.read(deleted.material_id,1);
  assert.equal(initial.text,'');assert.equal(initial.text_revision,0);assert.equal(initial.source.name,source.name);
  const restarted=new f.MaterialStore();restarted.initialize(f.root);
  assert.equal(f.markMaterialDeleted(restarted,source).revision,2);
});

test('failed tombstone publication preserves the source and retries the same next revision',t=>{
  const f=setup(t),initial=f.store.ensure(f.source,'已保存文字');
  const sourceFile=path.join(f.root,'synthetic-source.rawopus');fs.writeFileSync(sourceFile,Buffer.from([1,2,3]));
  f.failPromotion(true);
  assert.throws(()=>{f.markMaterialDeleted(f.store,f.source);fs.unlinkSync(sourceFile);},/disk-failure/);
  assert.deepEqual(fs.readFileSync(sourceFile),Buffer.from([1,2,3]));
  assert.equal(f.store.read(initial.material_id).revision,1);
  f.failPromotion(false);const restarted=new f.MaterialStore();restarted.initialize(f.root);
  assert.equal(f.markMaterialDeleted(restarted,f.source).revision,2);
});

test('restart between metadata creation and tombstone retries deletion without importing source text',t=>{
  const f=setup(t),rename=f.io.renameSync;
  f.io.renameSync=(from,to)=>{if(to.endsWith('revision-000000002.json'))throw Error('synthetic-tombstone-failure');return rename(from,to);};
  assert.throws(()=>f.markMaterialDeleted(f.store,f.source),/tombstone-failure/);
  const id=f.store.idFor(f.source.kind,f.source.name);assert.equal(f.store.read(id).revision,1);
  f.io.renameSync=rename;const restarted=new f.MaterialStore();restarted.initialize(f.root);
  assert.equal(f.markMaterialDeleted(restarted,f.source).revision,2);
  assert.equal(restarted.read(id,1).text,'');
});

test('deleted daily material is discovered after restart, synced to real local SQLite and returns 410',async t=>{
  const f=setup(t),first=f.store.ensure(f.source,'合成日常原文');
  f.markMaterialDeleted(f.store,f.source);
  const restarted=new f.MaterialStore();restarted.initialize(f.root);
  assert.equal(restarted.ensure(f.source,'保留下来的旧源文字').operation,'delete');
  const {MaterialOutbox}=loadApp('MaterialOutbox',f.platform),{MaterialSyncDiscovery}=loadApp('MaterialSyncDiscovery',f.platform);
  const principal={ownerId:'synthetic-owner',producerId:'synthetic-phone',serverId:'synthetic-server'};
  const queue=new MaterialOutbox();queue.initialize(f.root,principal);
  const discovery=new MaterialSyncDiscovery(queue);const report=discovery.scan(restarted,10000);
  assert.equal(report.enqueued,2);assert.equal(report.issues.length,0);
  const serverStore=new ServerStore(path.join(f.root,'deletion.sqlite'),{clock:()=>11000});
  const auth=serverStore.mint({owner:principal.ownerId,producer:principal.producerId,scopes:['materials:write','materials:read','changes:read']});
  const server=await listen(serverStore),base='http://127.0.0.1:'+server.address().port;
  const headers={Authorization:'Bearer '+auth.token,'Content-Type':'application/json'};
  try{
    for(const revision of [1,2]){
      const claim=queue.claim(11000);assert.equal(JSON.parse(claim.payload).body.revision,revision);
      const response=await fetch(base+'/v1/material-events',{method:'POST',headers,body:claim.payload});
      assert.equal(response.status,201);queue.finish(claim,response.status,await response.text(),11000);
    }
    assert(queue.all().every(row=>row.state==='server_stored'));
    assert.equal((await fetch(base+'/v1/materials/'+first.material_id,{headers})).status,410);
    const changes=await (await fetch(base+'/v1/changes?limit=20',{headers})).json();
    assert.equal(changes.items.at(-1).body.operation,'delete');
    const next=new MaterialOutbox();next.initialize(f.root,principal);
    new MaterialSyncDiscovery(next).scan(restarted,12000);
    assert.equal(next.all().length,2);assert.equal(next.claim(12000),undefined);
  }finally{await new Promise(resolve=>server.close(resolve));serverStore.close();}
});
