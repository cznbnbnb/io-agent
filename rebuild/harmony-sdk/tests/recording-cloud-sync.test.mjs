import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {loadApp} from './load-app.mjs';
import {setupRecordingCloud,setupLifelogManual} from './recording-cloud-fixture.mjs';
import {MaterialStore as ServerStore} from '../../material-server/store.mjs';
import {listen} from '../../material-server/http.mjs';
import {MaterialQueryClient} from '../../material-server/query/client.mjs';

test('published cloud full text reaches durable outbox, real local HTTP/SQLite and query with honest references',async t=>{
  const f=setupRecordingCloud(t),first=f.store.ensure(f.source);
  assert.equal(first.text,'');assert.equal(first.text_revision,0);
  const text='合成录音测试：约定周四交付，保留全部云转写文字。';let recognitions=0;
  await f.publisher.publish(f.readSource,async()=>{recognitions++;return text;},f.mirror,()=>true);
  const {MaterialStore}=loadApp('MaterialStore',f.platform);
  const restarted=new MaterialStore();restarted.initialize(f.root);
  const current=restarted.read(first.material_id);
  assert.equal(current.revision,2);assert.equal(current.text_revision,1);
  assert.equal(current.text,text);assert.equal(restarted.read(first.material_id,1).text,'');
  assert.equal(current.utterances.length,0);assert.equal(current.speaker_processing,'unknown');
  assert.equal(current.boundary_processing,'unknown');assert.equal(current.transcription_state,'unknown');

  const now=Date.now(),serverStore=new ServerStore(path.join(f.root,'cloud-sync.sqlite'),{clock:()=>now});
  const writer=serverStore.mint({owner:'cloud-synthetic-owner',producer:'cloud-synthetic-phone',scopes:['materials:write']});
  const reader=serverStore.mint({owner:'cloud-synthetic-owner',producer:'cloud-synthetic-query',scopes:['materials:read','changes:read']});
  const principal=serverStore.identity(writer.token);
  const server=await listen(serverStore),base=`http://127.0.0.1:${server.address().port}/v1/`;
  try{
    const credential=path.join(f.root,'cloud-query-private.json');
    fs.writeFileSync(credential,JSON.stringify(reader),{mode:0o600});
    const query=new MaterialQueryClient({schema_version:'1.0',base_url:base,
      owner_id:principal.owner_id,producer_id:'cloud-synthetic-query',server_id:principal.server_id,
      credential_file:credential,allow_loopback_http:true},{clock:()=>now});
    const {MaterialOutbox}=loadApp('MaterialOutbox',f.platform);
    const {MaterialSyncDiscovery}=loadApp('MaterialSyncDiscovery',f.platform);
    const identity={ownerId:principal.owner_id,producerId:principal.producer_id,serverId:principal.server_id};
    const outbox=new MaterialOutbox();outbox.initialize(f.root,identity);
    const report=new MaterialSyncDiscovery(outbox).scan(restarted,now);
    assert.equal(report.enqueued,2);assert.equal(report.issues.length,0);
    let checkpoint;
    for(const revision of [1,2]){
      const claim=outbox.claim(now),event=JSON.parse(claim.payload);
      assert.equal(event.body.revision,revision);
      const response=await fetch(base+'material-events',{method:'POST',
        headers:{Authorization:'Bearer '+writer.token,'Content-Type':'application/json'},body:claim.payload});
      assert.equal(response.status,201);
      outbox.finish(claim,response.status,await response.text(),now);
      if(revision===1)checkpoint=(await query.changes()).next_cursor;
    }
    assert(outbox.all().every(row=>row.state==='server_stored'));
    const found=await query.search({keyword:'周四'});assert.equal(found.items.length,1);
    const result=found.items[0];assert.equal(result.body.full_text.text,text);
    assert.equal(result.source_ref.material_id,first.material_id);assert.equal(result.source_ref.revision,2);
    assert.equal(result.body.processing.recognition_channel,'mix');
    assert.equal(result.evidence.transcription_state,'unknown');assert.equal(result.evidence.speaker_processing,'unknown');
    assert.equal(result.body.utterances.length,0);
    for(const match of result.matches){
      assert.equal(match.source_ref.utterance_id,null);assert.equal(match.source_ref.start_ms,null);
      assert.equal(match.source_ref.end_ms,null);
    }
    assert.equal((await query.get({material_id:first.material_id,revision:1})).items[0].body.full_text.text,'');
    assert.deepEqual((await query.changes({cursor:checkpoint})).items.map(row=>row.body.revision),[2]);
    const resumed=new MaterialOutbox();resumed.initialize(f.root,identity);
    new MaterialSyncDiscovery(resumed).scan(restarted,now+1);
    assert.equal(resumed.all().length,2);assert.equal(resumed.claim(now+1),undefined);
    assert.equal(recognitions,1,'publishing/sync/query never invokes the recognizer again');
  }finally{
    await new Promise(resolve=>{server.closeAllConnections();server.close(resolve);});serverStore.close();
  }
});

test('complete manual lifelog keeps synthetic speaker/time evidence through publication, compatibility files and real query',async t=>{
  const f=setupLifelogManual(t),first=f.store.ensure(f.source);
  const transcript={frames:20,seconds:1.2,speechSeconds:0.6,speakerProcessing:'processed',boundaryProcessing:'token_starts',
    utterances:[{start:0.12,end:0.42,text:'合成讨论周四交付',speaker:0},{start:0.6,end:0.9,text:'合成答复请保留原音',speaker:1}],
    speakers:[{index:0,name:'匿名A',bio:'合成标签',samples:1},{index:1,name:'匿名B',bio:'合成标签',samples:1}]};
  const result=f.makeResult(transcript);let recognitions=0;
  await f.publisher.publish(f.readSource,async()=>{recognitions++;return result;},f.mirror,f.current,f.makeInput);
  const row=f.store.read(first.material_id);
  assert.equal(row.revision,2);assert.equal(row.speaker_processing,'processed');
  assert.equal(row.transcription_state,'complete');assert.equal(row.covered_ms,1200);
  assert.equal(row.utterances.length,2);assert.equal(row.utterances[0].speaker_basis,'segment_cluster');
  assert.equal(row.utterances[0].speaker_id,'segment-0');
  const markdown=fs.readFileSync(path.join(f.directory,'text.md'),'utf8');
  assert.equal(markdown,row.text);assert.match(markdown,/合成讨论周四交付/);
  const compatible=JSON.parse(fs.readFileSync(path.join(f.directory,'transcript.json'),'utf8'));
  assert.deepEqual(compatible.transcript.utterances,transcript.utterances);

  const now=Date.now(),serverStore=new ServerStore(path.join(f.root,'lifelog-sync.sqlite'),{clock:()=>now});
  const writer=serverStore.mint({owner:'lifelog-synthetic-owner',producer:'lifelog-synthetic-phone',scopes:['materials:write']});
  const reader=serverStore.mint({owner:'lifelog-synthetic-owner',producer:'lifelog-synthetic-query',scopes:['materials:read','changes:read']});
  const principal=serverStore.identity(writer.token),server=await listen(serverStore);
  try{
    const base=`http://127.0.0.1:${server.address().port}/v1/`,credential=path.join(f.root,'lifelog-query-private.json');
    fs.writeFileSync(credential,JSON.stringify(reader),{mode:0o600});
    const query=new MaterialQueryClient({schema_version:'1.0',base_url:base,owner_id:principal.owner_id,
      producer_id:'lifelog-synthetic-query',server_id:principal.server_id,credential_file:credential,allow_loopback_http:true},{clock:()=>now});
    const {MaterialOutbox}=loadApp('MaterialOutbox',f.platform),{MaterialSyncDiscovery}=loadApp('MaterialSyncDiscovery',f.platform);
    const outbox=new MaterialOutbox();outbox.initialize(f.root,{ownerId:principal.owner_id,producerId:principal.producer_id,serverId:principal.server_id});
    const scan=new MaterialSyncDiscovery(outbox).scan(f.store,now);assert.equal(scan.enqueued,2);assert.equal(scan.issues.length,0);
    for(const revision of [1,2]){
      const claim=outbox.claim(now);assert.equal(JSON.parse(claim.payload).body.revision,revision);
      const response=await fetch(base+'material-events',{method:'POST',headers:{Authorization:'Bearer '+writer.token,'Content-Type':'application/json'},body:claim.payload});
      assert.equal(response.status,201);outbox.finish(claim,response.status,await response.text(),now);
    }
    const found=await query.search({keyword:'周四',speaker:'segment-0'});assert.equal(found.items.length,1);
    const item=found.items[0],spoken=item.matches.find(match=>match.kind==='utterance');
    assert.equal(item.body.full_text.text,row.text);assert.equal(item.evidence.transcription_state,'complete');
    assert.equal(item.evidence.speaker_processing,'processed');assert.equal(item.body.processing.recognition_channel,'unknown');
    assert.equal(spoken.source_ref.utterance_id,row.utterances[0].utterance_id);
    assert.equal(spoken.source_ref.start_ms,120);assert.equal(spoken.source_ref.end_ms,420);
    assert.equal(spoken.speaker_basis,'segment_cluster');assert.equal(recognitions,1);
    assert.equal(item.evidence.audio_playback_available,false,'local audio evidence is not server audio storage');
  }finally{
    await new Promise(resolve=>{server.closeAllConnections();server.close(resolve);});serverStore.close();
  }
});
