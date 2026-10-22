import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
import {loadApp} from './load-app.mjs';import {setupMaterialStore} from './material-fixture.mjs';
const require=createRequire(import.meta.url);
function dependency(n){try{return require(n);}catch{return require('../../../tools/deveco-cli/node_modules/'+n);}}
const Ajv=dependency('ajv/dist/2020.js'),formats=dependency('ajv-formats');
const ajv=new Ajv({strict:false,allErrors:true});formats(ajv);
const contracts=new URL('../../../docs/contracts/',import.meta.url);
const v1=JSON.parse(fs.readFileSync(new URL('event-v1.schema.json',contracts)));
ajv.addSchema(v1);const validate=ajv.compile(JSON.parse(fs.readFileSync(new URL('event-v1.1.schema.json',contracts))));
function wire(s){return loadApp('MaterialWire',{'@kit.CoreFileKit':{fileIo:s.io}});}
function identity(m){const v=new m.MaterialEventIdentity();Object.assign(v,{eventId:'evt-material-example',idempotencyKey:'material-example-r1',producerId:'phone-example',createdAt:1791676800000,expiresAt:1792281600000});return v;}
function valid(e){assert(validate(e),JSON.stringify(validate.errors));}
test('wire preserves untimed legacy Markdown without inventing utterances or complete transcription',t=>{
 const s=setupMaterialStore(t),m=wire(s),row=s.store.ensure(s.source,'# 原有文字\n\n包含历史备注。');
 const e=m.materialRevisionEvent(s.store,row.material_id,1,identity(m));valid(e);
 assert.equal(e.body.full_text.text,row.text);assert.equal(e.body.full_text.origin,'legacy');assert.equal(e.body.utterances.length,0);
 assert.equal(e.body.completeness,'complete');assert.equal(e.body.processing.transcription_state,'unknown');assert.equal(e.body.processing.covered_ms,null);
 assert.equal(e.body.audio.state,'local');assert.equal(e.body.audio.object_id,null);assert.equal(row.sync_state,'local');
 assert(!ajv.getSchema(v1.$id)(e),'old strict contract is not silently changed');
});
test('an immutable revision plus persisted identity produces identical retries after correction and process restart',t=>{
 const s=setupMaterialStore(t),m=wire(s),first=s.store.ensure(s.source);
 Object.assign(s.input,{transcriptionState:'partial',coveredMs:10000,sourceMs:60000,speakerProcessing:'pending',boundaryProcessing:'token_starts'});
 const partial=s.store.appendTranscript(first.material_id,1,s.input,'window-1'),ident=identity(m);
 const before=JSON.stringify(m.materialRevisionEvent(s.store,first.material_id,2,ident));
 s.store.correctText(first.material_id,2,partial.utterances[0].utterance_id,'更正正文');
 const restarted=new s.MaterialStore();restarted.initialize(s.root);
 assert.equal(JSON.stringify(m.materialRevisionEvent(restarted,first.material_id,2,ident)),before);
 const e=JSON.parse(before);valid(e);assert.equal(e.body.base_revision,1);assert.equal(e.body.processing.covered_ms,10000);
 assert.equal(e.body.processing.transcription_state,'partial');assert.equal(e.body.processing.speaker,'pending');
 const changed=m.materialRevisionEvent(restarted,first.material_id,3,{...ident,eventId:'next',idempotencyKey:'next-example-r3'});valid(changed);
 assert.equal(changed.body.full_text.origin,'user');assert.equal(changed.body.processing.user_edited,true);assert.equal(changed.body.processing.transcription_state,'partial');
 assert.equal(changed.body.utterances[0].utterance_id,e.body.utterances[0].utterance_id);
});
test('local user labels map to explicit confirmation while unknown remains anonymous; gaps and missing audio stay separate',t=>{
 const s=setupMaterialStore(t),m=wire(s),first=s.store.ensure({...s.source,interrupted:true,complete:false,audioAvailable:false});
 Object.assign(s.input.utterances[0],{speaker_id:'person-example',speaker_basis:'user'});
 const row=s.store.appendTranscript(first.material_id,1,s.input,'text');const e=m.materialRevisionEvent(s.store,row.material_id,2,identity(m));valid(e);
 assert.equal(e.body.utterances[0].speaker_basis,'user_confirmed');assert.equal(e.body.completeness,'gap');assert.equal(e.body.audio.state,'missing');
 s.input.utterances[0].speaker_basis='unknown';s.input.utterances[0].speaker_id='';
 s.store.appendTranscript(first.material_id,2,s.input,'unknown');const unknown=m.materialRevisionEvent(s.store,row.material_id,3,identity(m));valid(unknown);
 assert.equal(unknown.body.utterances[0].speaker_id,null);assert.equal(unknown.body.utterances[0].speaker_basis,'unknown');
});
test('old sidecars map to unknown and local verified audio never becomes server verified',t=>{
 const s=setupMaterialStore(t),m=wire(s),first=s.store.ensure(s.source,'旧文字');
 const p=path.join(s.root,'materials',first.material_id,'revision-000000001.json'),row=JSON.parse(fs.readFileSync(p));
 delete row.transcription_state;delete row.covered_ms;delete row.transcription_source_ms;
 row.audio_checksum_state='verified';row.audio_sha256='a'.repeat(64);fs.writeFileSync(p,JSON.stringify(row));
 const e=m.materialRevisionEvent(s.store,first.material_id,1,identity(m));valid(e);
 assert.equal(e.body.processing.transcription_state,'unknown');assert.equal(e.body.audio.sha256,'a'.repeat(64));assert.equal(e.body.audio.state,'local');assert.equal(e.body.audio.object_id,null);
});
test('tombstones do not leak deleted text and payload overflow fails instead of truncating original content',t=>{
 const s=setupMaterialStore(t),m=wire(s),first=s.store.ensure(s.source,'私有旧文字');
 const deleted=s.store.delete(first.material_id,1),e=m.materialRevisionEvent(s.store,deleted.material_id,2,identity(m));valid(e);
 assert.equal(e.body.full_text.text,'');assert.deepEqual(Array.from(e.body.utterances),[]);assert(!JSON.stringify(e).includes('私有旧文字'));
 const large=s.store.ensure({...s.source,name:'take-'+'b'.repeat(32)},'汉'.repeat(90000));
 assert.throws(()=>m.materialRevisionEvent(s.store,large.material_id,1,identity(m)),/EVENT_TOO_LARGE/);
 assert.equal(s.store.read(large.material_id).text.length,90000);assert.equal(s.store.read(large.material_id).sync_state,'local');
});
test('wire identity, explicit historical revision and deadlines fail closed; fixtures conform to negotiated 1.1',t=>{
 const s=setupMaterialStore(t),m=wire(s),row=s.store.ensure(s.source);
 for(const patch of [{eventId:''},{idempotencyKey:'short'},{producerId:''},{expiresAt:0},{createdAt:NaN},{expiresAt:1e20}]){
  assert.throws(()=>m.materialRevisionEvent(s.store,row.material_id,1,{...identity(m),...patch}),/EVENT_(IDENTITY|DATE)_INVALID/);
 }
 assert.throws(()=>m.materialRevisionEvent(s.store,row.material_id,0,identity(m)),/REVISION_INVALID/);
 assert.throws(()=>m.materialRevisionEvent(s.store,row.material_id,2,identity(m)),/MATERIAL_NOT_FOUND/);
 const fixtures=JSON.parse(fs.readFileSync(new URL('material-v1.1.json',contracts)));for(const e of fixtures.events)valid(e);
 const unknown=structuredClone(fixtures.events[0]);unknown.body.processing.transcription_state='unknown';assert(!validate(unknown));
 const tombstone=structuredClone(fixtures.events.at(-1));tombstone.body.full_text.text='不能残留';assert(!validate(tombstone));
});
