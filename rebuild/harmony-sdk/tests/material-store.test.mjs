import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {setupMaterialStore} from './material-fixture.mjs';

const setup=setupMaterialStore;

test('additive legacy migration is stable across restarts and keeps original files byte for byte',t=>{
 const s=setup(t);const legacy=path.join(s.root,'legacy.raw');const bytes=Buffer.from([7,8,9]);fs.writeFileSync(legacy,bytes);
 const first=s.store.ensure(s.source,'旧版文字');const again=s.store.ensure(s.source,'迟到的旧文字');
 assert.equal(first.material_id,again.material_id);assert.equal(again.revision,1);assert.equal(again.text,'旧版文字');
 const restarted=new s.MaterialStore();restarted.initialize(s.root);assert.equal(restarted.read(first.material_id).text,'旧版文字');
 assert.deepEqual(fs.readFileSync(legacy),bytes);
 const absent={...s.source,kind:'lifelog',name:'seg-'+'a'.repeat(32),audioAvailable:false,audioBytes:0};
 const textOnly=s.store.ensure(absent,'只有文字');assert.notEqual(textOnly.material_id,first.material_id);assert.equal(textOnly.source.audioAvailable,false);
});

test('torn publication keeps the committed revision and retries without duplicating a logical job',t=>{
 const s=setup(t),first=s.store.ensure(s.source);s.failPromotion(true);
 assert.throws(()=>s.store.appendTranscript(first.material_id,1,s.input,'job-1'),/disk-failure/);
 assert.equal(s.store.read(first.material_id).revision,1);
 s.failPromotion(false);const next=s.store.appendTranscript(first.material_id,1,s.input,'job-1');
 assert.equal(next.revision,2);assert.equal(next.text_revision,1);
 assert.equal(s.store.appendTranscript(first.material_id,1,s.input,'job-1').revision,2);
 assert.equal(s.store.read(first.material_id,1).text,'');
});

test('manual corrections keep utterance identity and reject stale or later ASR overwrites',t=>{
 const s=setup(t),first=s.store.ensure(s.source),asr=s.store.appendTranscript(first.material_id,1,s.input,'job-1');
 const id=asr.utterances[0].utterance_id;const corrected=s.store.correctText(first.material_id,2,id,'更正后的语句');
 assert.equal(corrected.utterances[0].utterance_id,id);assert.equal(corrected.text_revision,2);
 assert.throws(()=>s.store.appendTranscript(first.material_id,2,s.input,'job-2'),/REVISION_CONFLICT/);
 assert.throws(()=>s.store.appendTranscript(first.material_id,3,s.input,'job-2'),/USER_REVISION_PROTECTED/);
 assert.equal(s.store.ensure(s.source,'旧目录文字').text,'更正后的语句');
 assert.equal(s.store.read(first.material_id,2).utterances[0].text,'测试语句');
});

test('tombstones resist legacy rescans; invalid paths and timelines fail before publication',t=>{
 const s=setup(t),first=s.store.ensure(s.source);s.store.delete(first.material_id,1);
 assert.equal(s.store.ensure(s.source,'旧目录文字').operation,'delete');
 assert.throws(()=>s.store.appendTranscript(first.material_id,2,s.input),/MATERIAL_DELETED/);
 assert.throws(()=>s.store.read('../outside'),/MATERIAL_ID_INVALID/);
 assert.throws(()=>s.store.ensure({...s.source,name:'../outside'}),/MATERIAL_SOURCE_INVALID/);
 const other=s.store.ensure({...s.source,name:'take-'+'b'.repeat(32)});
 s.input.utterances[0].end_ms=70000;
 assert.throws(()=>s.store.appendTranscript(other.material_id,1,s.input),/UTTERANCE_INVALID/);
 assert.equal(s.store.read(other.material_id).revision,1);
});

test('damaged newest revision blocks reads instead of hiding a lost user correction',t=>{
 const s=setup(t),first=s.store.ensure(s.source);s.store.appendTranscript(first.material_id,1,s.input);
 fs.writeFileSync(path.join(s.root,'materials',first.material_id,'revision-000000002.json'),'{');
 assert.throws(()=>s.store.read(first.material_id));
 assert.throws(()=>s.store.ensure(s.source,'旧目录文字'));
 assert.equal(s.store.read(first.material_id,1).revision,1,'explicit historical view remains available');
});

test('pending speaker analysis survives revision publication, restart and additive legacy migration',t=>{
 const s=setup(t);s.input.speakerProcessing='pending';s.input.utterances[0].speaker_id='';s.input.utterances[0].speaker_basis='unknown';
 const first=s.store.ensure(s.source),saved=s.store.appendTranscript(first.material_id,1,s.input,'text-only');
 assert.equal(saved.speaker_processing,'pending');const restarted=new s.MaterialStore();restarted.initialize(s.root);
 assert.equal(restarted.read(saved.material_id).speaker_processing,'pending');assert.equal(restarted.read(saved.material_id).utterances[0].speaker_basis,'unknown');
 const legacy=s.store.ensure({...s.source,name:'take-'+'b'.repeat(32)},s.input.text,s.input);assert.equal(legacy.speaker_processing,'pending');
});


test('window boundary provenance survives restart and legacy import without relabelling old data',t=>{
 const s=setup(t),first=s.store.ensure(s.source);assert.equal(first.boundary_processing,'unknown');
 s.input.boundaryProcessing='unverified';const next=s.store.appendTranscript(first.material_id,1,s.input,'boundaries');
 const restarted=new s.MaterialStore();restarted.initialize(s.root);assert.equal(restarted.read(next.material_id).boundary_processing,'unverified');
 s.input.boundaryProcessing='token_starts';const legacy=s.store.ensure({...s.source,name:'take-'+'b'.repeat(32)},s.input.text,s.input);assert.equal(legacy.boundary_processing,'token_starts');
 s.input.boundaryProcessing='invented';assert.throws(()=>s.store.appendTranscript(next.material_id,2,s.input,'bad-boundaries'),/CORRUPT/);
});
