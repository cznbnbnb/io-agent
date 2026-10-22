import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {MaterialStore} from '../store.mjs';
import {listen} from '../http.mjs';
import {MaterialQueryClient} from '../query/client.mjs';
import {setupMaterialStore} from '../../harmony-sdk/tests/material-fixture.mjs';
import {loadApp} from '../../harmony-sdk/tests/load-app.mjs';

const fixtures=JSON.parse(fs.readFileSync(new URL('../../../docs/contracts/material-v1.2.json',import.meta.url))).events;
const run=promisify(execFile),clone=structuredClone;
const error=code=>e=>e.code===code;
function envelope(value,now){
  const event=clone(value);Object.assign(event,{event_id:randomUUID(),idempotency_key:randomUUID(),
    created_at:new Date(now).toISOString(),expires_at:new Date(now+3600000).toISOString()});return event;
}
async function setup(t){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'turboio-speaker-')),now=Date.now(),db=path.join(dir,'test.sqlite');
  const store=new MaterialStore(db,{clock:()=>now}),writer=store.mint({owner:'owner-speaker',producer:'phone-test',scopes:['materials:write','materials:read','changes:read']});
  const reader=store.mint({owner:'owner-speaker',producer:'computer-query',scopes:['materials:read','changes:read']});
  const credential=path.join(dir,'reader.json');fs.writeFileSync(credential,JSON.stringify(reader),{mode:0o600});
  const server=await listen(store),identity=store.identity(reader.token);
  const config={schema_version:'1.0',base_url:`http://127.0.0.1:${server.address().port}/v1/`,owner_id:identity.owner_id,
    producer_id:identity.producer_id,server_id:identity.server_id,credential_file:credential,allow_loopback_http:true};
  const configFile=path.join(dir,'query.json');fs.writeFileSync(configFile,JSON.stringify(config));
  const cli=fileURLToPath(new URL('../query/cli.mjs',import.meta.url));
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));store.close();fs.rmSync(dir,{recursive:true,force:true});});
  const post=async e=>{const res=await fetch(config.base_url+'material-events',{method:'POST',headers:{Authorization:`Bearer ${writer.token}`,'Content-Type':'application/json'},body:JSON.stringify(e)});return {status:res.status,body:await res.json()};};
  return {dir,db,now,store,writer,reader,server,config,post,client:new MaterialQueryClient(config),
    event:n=>envelope(fixtures[n-1],now),cli:async(...args)=>JSON.parse((await run(process.execPath,[cli,...args,'--config',configFile])).stdout)};
}

test('v1.2 real HTTP/SQLite and CLI retain rename, merge, unknown split times and parent citations across restart',async t=>{
  const f=await setup(t),first=f.event(1);assert.equal((await f.post(first)).status,201);
  const identity=await (await fetch(f.config.base_url+'identity',{headers:{Authorization:`Bearer ${f.reader.token}`}})).json();
  assert.deepEqual(identity.material_schema_versions,['1.0','1.1','1.2']);assert(identity.capabilities.includes('request_lifecycle_v1'));
  const original=await f.cli('get','--material-id',first.body.material_id,'--revision','1');
  assert.deepEqual(original.items[0].body,first.body);assert.equal(original.items[0].matches.find(m=>m.kind==='utterance').speaker.label,'说话人 A');
  const checkpoint=(await f.cli('changes')).next_cursor;
  const rename=f.event(2);assert.equal((await f.post(rename)).status,201);
  const renamed=(await f.cli('get','--material-id',first.body.material_id)).items[0];
  assert.equal(renamed.matches.find(m=>m.kind==='utterance').speaker.label_basis,'user_confirmed');
  assert.equal(renamed.matches.find(m=>m.kind==='utterance').speaker_basis,'segment_cluster'); // Label edits never confirm sentence attribution.
  for(const n of [3,4])assert.equal((await f.post(f.event(n))).status,201);
  const delta=await f.cli('changes','--cursor',checkpoint);assert.deepEqual(delta.items.map(i=>i.body.revision),[2,3,4]);
  const latest=(await f.cli('search','--speaker',first.body.speakers[0].speaker_id,'--keyword','今天')).items[0];
  assert.deepEqual(latest.body.speakers,fixtures[3].body.speakers);assert.equal(latest.body.audio.state,'local');
  assert.equal(latest.body.audio.sha256,null);assert.equal(latest.evidence.audio_playback_available,false);
  const split=latest.matches.find(m=>m.kind==='utterance');assert.equal(split.source_ref.start_ms,null);assert.equal(split.source_ref.end_ms,null);
  assert.deepEqual(split.source_ref.source_range,fixtures[3].body.utterances[0].source_range);
  assert.deepEqual([split.source_ref.parent_source_ref.material_id,split.source_ref.parent_source_ref.revision,
    split.source_ref.parent_source_ref.utterance_id,split.source_ref.parent_source_ref.start_ms,split.source_ref.parent_source_ref.end_ms],
    [first.body.material_id,3,'utterance-original-a',100,1000]);
  const parent=(await f.cli('get','--material-id',first.body.material_id,'--revision','3')).items[0].body;
  assert.equal(parent.utterances[0].text.slice(split.source_ref.source_range.text_start,split.source_ref.source_range.text_end),latest.body.utterances[0].text);
  const recovered=new MaterialStore(f.db,{clock:()=>f.now});try{assert.deepEqual(recovered.get(f.reader.token,first.body.material_id).body,fixtures[3].body);}finally{recovered.close();}
  assert(!JSON.stringify([original,delta,latest]).includes(f.reader.token));
});

test('v1.2 real HTTP replay has one durable effect; changed payload conflicts and dictionary edits require text revision',async t=>{
  const f=await setup(t),e=f.event(1),ack=await f.post(e);assert.equal(ack.status,201);
  assert.deepEqual(await f.post(e),{status:200,body:ack.body});assert.equal(f.store.ceiling('owner-speaker'),1);
  const conflict=clone(e);conflict.body.speakers[0].label='同键不同内容';assert.equal((await f.post(conflict)).body.error.code,'IDEMPOTENCY_CONFLICT');
  const wrong=f.event(2);wrong.body.text_revision=1;assert.equal((await f.post(wrong)).body.error.code,'TEXT_REVISION_CONFLICT');
  const downgrade=f.event(2);downgrade.schema_version='1.1';delete downgrade.body.speakers;
  assert.equal((await f.post(downgrade)).body.error.code,'SCHEMA_DOWNGRADE_REFUSED');
  const disguised=f.event(2);Object.assign(disguised.body.processing,{transcription_state:'partial',covered_ms:10000});
  assert.equal((await f.post(disguised)).body.error.code,'SPEAKER_EDIT_SOURCE_CHANGED');
  assert.equal(f.store.ceiling('owner-speaker'),1);
  assert.equal((await f.post(f.event(2))).status,201);
});

test('label edit retains model pending state and recognition channel; an explicit merge does not imply identity analysis',async t=>{
  const f=await setup(t),first=f.event(1);first.body.processing.speaker='pending';assert.equal((await f.post(first)).status,201);
  const bad=f.event(2);assert.equal((await f.post(bad)).body.error.code,'SPEAKER_EDIT_SOURCE_CHANGED');
  const rename=f.event(2);rename.body.processing.speaker='pending';assert.equal((await f.post(rename)).status,201);
  const merge=f.event(3);merge.body.processing.speaker='pending';assert.equal((await f.post(merge)).status,201);
  const item=(await f.client.get({material_id:merge.body.material_id})).items[0];
  assert.equal(item.evidence.speaker_processing,'pending');assert.equal(item.body.processing.recognition_channel,'mix');
  assert.equal(item.body.utterances[1].speaker_basis,'user_confirmed');assert.equal(item.body.speakers[0].is_self,false);
});

test('strict dictionaries reject missing fields, extra private voice data, global names, duplicate IDs and contradictory self claims',async t=>{
  const f=await setup(t);
  const changes=[
    e=>delete e.body.speakers,e=>delete e.body.speakers[0].label_basis,e=>e.body.speakers[0].embedding=[1],
    e=>e.body.speakers[0].bio='private',e=>e.body.speakers[0].label='bad\nlabel',e=>e.body.speakers[0].label='trailing\n',
    e=>e.body.speakers[0].speaker_id+='\n',e=>e.body.speakers[0].label='x'.repeat(81),e=>e.body.speakers[0].label='😀'.repeat(41),
    e=>e.body.speakers[0].label='  ',e=>e.body.speakers[0].speaker_id='global-name',
    e=>e.body.speakers.push(clone(e.body.speakers[0])),e=>e.body.utterances[0].speaker_id='unknown-id',
    e=>e.body.speakers[0].is_self=true,e=>{for(const s of e.body.speakers)Object.assign(s,{is_self:true,label_basis:'user_confirmed'});},
    e=>e.body.utterances[0].speaker_basis='unknown',e=>e.body.utterances.push(clone(e.body.utterances[0]))
  ];
  for(const change of changes){const e=f.event(1);change(e);const result=await f.post(e);assert.equal(result.status,400,result.body.error?.code);}
  const self=f.event(1);Object.assign(self.body.speakers[0],{is_self:true,label_basis:'user_confirmed'});assert.equal((await f.post(self)).status,201);
  assert.equal((await f.client.get({material_id:self.body.material_id})).items[0].matches.find(m=>m.kind==='utterance').speaker.is_self,true);
});

test('v1.2 expiration and actual offline HTTP recovery keep immutable parent references and the same stored event',async t=>{
  const f=await setup(t);for(const n of [1,2,3])assert.equal((await f.post(f.event(n))).status,201);
  const checkpoint=(await f.client.changes()).next_cursor,port=f.server.address().port;
  await new Promise(resolve=>f.server.close(resolve));
  await assert.rejects(f.client.changes({cursor:checkpoint}),error('NETWORK_UNAVAILABLE'));
  const e=f.event(4),ack=f.store.submit(f.writer.token,e);assert.equal(ack.status,201);
  // Original envelope expires without losing the stored immutable revision.
  const expired=clone(e);expired.expires_at=new Date(f.now).toISOString();expired.created_at=new Date(f.now-1000).toISOString();
  assert.throws(()=>f.store.submit(f.writer.token,expired),error('EXPIRED'));
  await new Promise(resolve=>f.server.listen(port,'127.0.0.1',resolve));
  const restarted=new MaterialQueryClient(f.config),tail=await restarted.changes({cursor:checkpoint});
  assert.deepEqual(tail.items.map(i=>i.body.revision),[4]);assert.equal(tail.items[0].body.utterances[0].start_ms,null);
  assert.deepEqual(await f.post(e),{status:200,body:ack.body});
  const alias=envelope(e,f.now);const result=await f.post(alias);assert.equal(result.status,200);assert.equal(result.body.duplicate_of,e.event_id);
  assert.equal(f.store.ceiling('owner-speaker'),4);assert.equal((await restarted.changes({cursor:tail.next_cursor})).items.length,0);
});

test('source ranges resolve actual immutable parent text and source, not estimated child times or a different material',async t=>{
  const f=await setup(t);for(const n of [1,2,3])assert.equal((await f.post(f.event(n))).status,201);
  const changes=[
    e=>delete e.body.utterances[0].source_range,e=>e.body.utterances[0].end_ms=200,
    e=>e.body.utterances[0].source_range.parent_revision=4,e=>e.body.utterances[0].source_range.parent_utterance_id='missing',
    e=>e.body.utterances[0].source_range.start_ms=101,e=>e.body.utterances[0].source_range.end_ms=999,
    e=>e.body.utterances[0].source_range.text_end=999,e=>e.body.utterances[0].text='伪造原话',
    e=>e.body.utterances[0].source_range.extra='ignored',e=>e.body.processing.covered_ms=59000,
    e=>e.body.audio.sha256='a'.repeat(64),e=>e.body.processing.user_edited=false,
    e=>{e.body.utterances[0].start_ms=50;e.body.utterances[0].end_ms=200;}
  ];
  for(const change of changes){const e=f.event(4);change(e);const result=await f.post(e);assert.equal(result.status,400,result.body.error?.code);}
  // The parent ID exists, but only for the first material. Never search other rows by sentence ID.
  const other=f.event(1);other.body.material_id='different-material';for(const s of other.body.speakers)s.speaker_id=s.speaker_id.replace(fixtures[0].body.material_id,other.body.material_id);
  for(let i=0;i<other.body.utterances.length;i++){other.body.utterances[i].speaker_id=other.body.speakers[i].speaker_id;other.body.utterances[i].utterance_id='other-'+i;}
  assert.equal((await f.post(other)).status,201);
  const cross=clone(other);Object.assign(cross,{event_id:randomUUID(),idempotency_key:randomUUID()});Object.assign(cross.body,{revision:2,base_revision:1,text_revision:2});
  cross.body.processing.user_edited=true;cross.body.utterances=clone(fixtures[3].body.utterances);for(const u of cross.body.utterances){u.speaker_id=other.body.speakers[0].speaker_id;if(u.source_range)u.source_range.parent_revision=1;}
  assert.equal((await f.post(cross)).body.error.code,'SOURCE_PARENT_NOT_FOUND'); // Cannot route a sentence ID to the first material.
  assert.equal(f.store.get(f.writer.token,fixtures[0].body.material_id).body.revision,3);
  assert.equal((await f.post(f.event(4))).status,201);
});

test('a validated split can be text-corrected and then renamed/self-marked without losing its original source anchor',async t=>{
  const f=await setup(t);for(const n of [1,2,3,4])assert.equal((await f.post(f.event(n))).status,201);
  const split=fixtures[3].body.utterances[0],edit=envelope(fixtures[3],f.now);
  Object.assign(edit.body,{revision:5,base_revision:4,text_revision:5});
  edit.body.utterances[0].text='合成人工更正：讨论下周提交。';edit.body.full_text.origin='user';edit.body.full_text.text=edit.body.utterances.map(u=>u.text).join('\n');
  const keepTokenTiming=clone(edit);keepTokenTiming.body.processing.boundary='token_starts';
  assert.equal((await f.post(keepTokenTiming)).status,400);
  const stale=clone(edit);stale.body.text_revision=4;assert.equal((await f.post(stale)).body.error.code,'TEXT_REVISION_CONFLICT');
  const noConfirmation=clone(edit);noConfirmation.body.processing.user_edited=false;assert.equal((await f.post(noConfirmation)).status,400);
  const swappedId=clone(edit);swappedId.body.utterances[0].utterance_id='fake-new-child';assert.equal((await f.post(swappedId)).body.error.code,'INVALID_SOURCE_RANGE');
  const swappedRange=clone(edit);swappedRange.body.utterances[0].source_range.text_end--;
  assert.equal((await f.post(swappedRange)).body.error.code,'INVALID_SOURCE_RANGE');
  assert.equal((await f.post(edit)).status,201);assert.equal((await f.post(edit)).status,200);
  const rename=envelope(edit,f.now);Object.assign(rename.body,{revision:6,base_revision:5,text_revision:6});rename.body.speakers[0].label='人工更正后标签';
  const restoredTokenTiming=clone(rename);restoredTokenTiming.body.processing.boundary='token_starts';
  assert.equal((await f.post(restoredTokenTiming)).status,400);
  assert.equal((await f.post(rename)).status,201);
  const self=envelope(rename,f.now);Object.assign(self.body,{revision:7,base_revision:6,text_revision:7});
  Object.assign(self.body.speakers[0],{label:'我',label_basis:'user_confirmed',is_self:true});
  const selfWithTokenTiming=clone(self);selfWithTokenTiming.body.processing.boundary='token_starts';
  assert.equal((await f.post(selfWithTokenTiming)).status,400);assert.equal((await f.post(self)).status,201);
  const latest=(await f.cli('get','--material-id',self.body.material_id)).items[0];
  assert.equal(latest.body.revision,7);assert.equal(latest.body.utterances[0].text,edit.body.utterances[0].text);
  assert.equal(latest.body.processing.boundary,'unknown');
  assert.deepEqual(latest.body.utterances[0].source_range,split.source_range);
  assert.deepEqual([latest.body.utterances[0].start_ms,latest.body.utterances[0].end_ms],[null,null]);
  const match=latest.matches.find(m=>m.kind==='utterance');assert.equal(match.speaker.is_self,true);
  assert.equal(match.speaker_basis,'segment_cluster');assert.equal(match.source_ref.parent_source_ref.revision,3);
  const original=(await f.cli('get','--material-id',self.body.material_id,'--revision','3')).items[0].body;
  assert.equal(original.utterances[0].text,fixtures[2].body.utterances[0].text);assert.notEqual(original.utterances[0].text.slice(split.source_range.text_start,split.source_range.text_end),edit.body.utterances[0].text);
});

test('text changes drop even previously retained parent token boundaries and metadata-only updates cannot restore them',async t=>{
  const f=await setup(t);for(const n of [1,2,3])assert.equal((await f.post(f.event(n))).status,201);
  // The earlier contract allowed preserving the parent's overall model flag on
  // a first split. A later wording correction must invalidate that flag too.
  const oldSplit=f.event(4);oldSplit.body.processing.boundary='token_starts';assert.equal((await f.post(oldSplit)).status,201);
  const edit=envelope(oldSplit,f.now);Object.assign(edit.body,{revision:5,base_revision:4,text_revision:5});
  edit.body.utterances[0].text='合成字面更正。';edit.body.full_text.text=edit.body.utterances.map(u=>u.text).join('\n');
  const refused=await f.post(edit);assert.equal(refused.status,400);assert.equal(refused.body.error.code,'SOURCE_RANGE_SOURCE_CHANGED');
  assert.equal(f.store.get(f.reader.token,oldSplit.body.material_id).body.revision,4);
  edit.body.processing.boundary='unknown';assert.equal((await f.post(edit)).status,201);
  const restore=envelope(edit,f.now);Object.assign(restore.body,{revision:6,base_revision:5});restore.body.processing.boundary='token_starts';
  const restoreResult=await f.post(restore);assert.equal(restoreResult.status,400);assert.equal(restoreResult.body.error.code,'SOURCE_RANGE_SOURCE_CHANGED');
  assert.equal((await f.cli('get','--material-id',oldSplit.body.material_id)).items[0].body.processing.boundary,'unknown');
});

test('same labels in different materials remain independent exact-ID searches; old schemas remain strict and usable',async t=>{
  const f=await setup(t),first=f.event(1);first.body.speakers[0].label='同名';assert.equal((await f.post(first)).status,201);
  const other=f.event(1);other.body.material_id='second-material';other.body.speakers=other.body.speakers.map((s,i)=>({...s,speaker_id:other.body.material_id+'-s'+(i?'B':'A'),label:'同名'}));
  other.body.utterances=other.body.utterances.map((u,i)=>({...u,speaker_id:other.body.speakers[i].speaker_id}));assert.equal((await f.post(other)).status,201);
  assert.deepEqual((await f.cli('search','--speaker',first.body.speakers[0].speaker_id)).items.map(i=>i.body.material_id),[first.body.material_id]);
  assert.equal((await f.cli('search','--speaker','同名')).items.length,0);
  for(const version of ['1.0','1.1']){
    const old=f.event(1);old.schema_version=version;old.body.material_id='old-'+version;
    if(version==='1.0'){delete old.body.processing;delete old.body.full_text;}
    assert.equal((await f.post(old)).body.error.code,'INVALID');delete old.body.speakers;
    assert.equal((await f.post(old)).status,201);assert.equal((await f.client.get({material_id:old.body.material_id})).items[0].schema_version,version);
    const extra=clone(old);extra.event_id=randomUUID();extra.idempotency_key=randomUUID();extra.body.utterances[0].source_range=fixtures[3].body.utterances[0].source_range;
    assert.equal((await f.post(extra)).body.error.code,'INVALID');
  }
});

test('an old v1.0 material can gain a dictionary without inventing previously unknown processing coverage',async t=>{
  const f=await setup(t),old=f.event(1);old.schema_version='1.0';delete old.body.speakers;delete old.body.processing;delete old.body.full_text;
  assert.equal((await f.post(old)).status,201);
  const upgraded=f.event(2);Object.assign(upgraded.body.processing,{transcription_state:'unknown',covered_ms:null,source_ms:null,speaker:'unknown',boundary:'unknown',recognition_channel:'unknown'});
  assert.equal((await f.post(upgraded)).status,201);
  const item=(await f.cli('get','--material-id',old.body.material_id)).items[0];assert.equal(item.schema_version,'1.2');
  assert.equal(item.evidence.transcription_state,'unknown');assert.equal(item.body.processing.covered_ms,null);
  assert.deepEqual(item.body.speakers,upgraded.body.speakers);assert.equal(item.body.utterances[0].speaker_basis,'segment_cluster');
});

test('actual ArkTS Store/Wire split, missing original audio and text correction retain immutable parent through HTTP/SQLite/CLI',async t=>{
  const f=await setup(t),s=setupMaterialStore(t),wire=loadApp('MaterialWire',{'@kit.CoreFileKit':{fileIo:s.io}});
  Object.assign(s.input,{text:'合成跨层语句，后半句保留。',transcriptionState:'complete',coveredMs:60000,sourceMs:60000,speakerProcessing:'pending',boundaryProcessing:'token_starts'});
  s.input.utterances[0].text=s.input.text;const initial=s.store.ensure(s.source),asr=s.store.appendTranscript(initial.material_id,1,s.input,'synthetic-full-asr');
  const operation=(kind,data,id)=>Object.assign(new s.MaterialSpeakerCorrection(),{operation_id:id,kind},data);
  const named=s.store.correctSpeakers(asr.material_id,asr.revision,operation('rename',{speaker_id:'speaker-0',label:'合成说话人'},'cross-layer-rename'));
  const split=s.store.correctSpeakers(named.material_id,named.revision,operation('split',{utterance_ids:[named.utterances[0].utterance_id],split_offset:named.utterances[0].text.indexOf('，')},'cross-layer-split'));
  const make=revision=>JSON.parse(JSON.stringify(wire.materialRevisionEvent(s.store,initial.material_id,revision,Object.assign(new wire.MaterialEventIdentity(),{
    eventId:randomUUID(),idempotencyKey:randomUUID(),producerId:'phone-test',createdAt:f.now,expiresAt:f.now+3600000}))));
  for(let revision=1;revision<=split.revision;revision++)assert.equal((await f.post(make(revision))).status,201);
  const range=clone(make(split.revision).body.utterances[0].source_range);
  const missing=s.store.ensure({...s.source,audioAvailable:false});assert.equal(missing.revision,split.revision+1);
  const unavailable=make(missing.revision);assert.equal(unavailable.schema_version,'1.2');assert.deepEqual(unavailable.body.audio,{state:'missing',sha256:null,object_id:null});
  const badExtent=clone(unavailable);badExtent.body.processing.source_ms=60020;badExtent.body.processing.covered_ms=60020;
  assert.equal((await f.post(badExtent)).body.error.code,'SOURCE_RANGE_SOURCE_CHANGED');
  const badSource=clone(unavailable);badSource.body.ended_at=new Date(Date.parse(badSource.body.ended_at)+20).toISOString();
  assert.equal((await f.post(badSource)).body.error.code,'SOURCE_RANGE_SOURCE_CHANGED');
  const badMissingDigest=clone(unavailable);badMissingDigest.body.audio.sha256='a'.repeat(64);assert.equal((await f.post(badMissingDigest)).body.error.code,'SOURCE_RANGE_SOURCE_CHANGED');
  assert.equal((await f.post(unavailable)).status,201);assert.equal((await f.post(unavailable)).status,200);
  const fabricatedRecovery=clone(unavailable);Object.assign(fabricatedRecovery,{event_id:randomUUID(),idempotency_key:randomUUID()});
  Object.assign(fabricatedRecovery.body,{revision:missing.revision+1,base_revision:missing.revision});fabricatedRecovery.body.audio.state='local';
  assert.equal((await f.post(fabricatedRecovery)).body.error.code,'SOURCE_RANGE_SOURCE_CHANGED');
  const edited=s.store.correctSpeakers(missing.material_id,missing.revision,operation('text',{utterance_ids:[missing.utterances[0].utterance_id],text:'合成人工更正，原音当前不可用。'},'cross-layer-text-edit'));
  const finalEvent=make(edited.revision);assert.equal((await f.post(finalEvent)).status,201);
  const latest=(await f.cli('get','--material-id',initial.material_id)).items[0];assert.equal(latest.body.audio.state,'missing');
  assert.equal(latest.evidence.audio_playback_available,false);assert.deepEqual(latest.body.utterances[0].source_range,range);
  assert.equal(latest.body.utterances[0].text,finalEvent.body.utterances[0].text);assert.equal(latest.body.processing.boundary,'unknown');
  const match=latest.matches.find(m=>m.kind==='utterance'),parent=(await f.cli('get','--material-id',initial.material_id,'--revision',String(range.parent_revision))).items[0];
  assert.equal(match.source_ref.parent_source_ref.revision,range.parent_revision);assert.equal(parent.body.audio.state,'local');
  assert.equal(parent.body.utterances.find(u=>u.utterance_id===range.parent_utterance_id).text,named.utterances[0].text);
});
