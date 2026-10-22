import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';
import {setupMaterialStore} from './material-fixture.mjs';import {loadApp} from './load-app.mjs';

function coverage(s,state,covered,source){Object.assign(s.input,{transcriptionState:state,coveredMs:covered,sourceMs:source});return s.input;}
test('sealed audio with a partial transcript remains partial after restart and manual correction',t=>{
 const s=setupMaterialStore(t),first=s.store.ensure(s.source);
 assert.equal(first.transcription_state,'pending');assert.equal(first.transcription_source_ms,60000);
 const partial=s.store.appendTranscript(first.material_id,1,coverage(s,'partial',10000,60000),'window-1');
 assert.equal(partial.source.complete,true);assert.equal(partial.transcription_state,'partial');
 const restarted=new s.MaterialStore();restarted.initialize(s.root);
 assert.equal(restarted.read(first.material_id).covered_ms,10000);
 const corrected=restarted.correctText(first.material_id,2,partial.utterances[0].utterance_id,'人工改正');
 assert.equal(corrected.transcription_state,'partial');assert.equal(corrected.covered_ms,10000);
 assert.throws(()=>restarted.appendTranscript(first.material_id,3,coverage(s,'complete',60000,60000),'later'),/USER_REVISION_PROTECTED/);
});
test('source growth and an open source cannot inherit complete from an earlier snapshot',t=>{
 const s=setupMaterialStore(t),first=s.store.ensure(s.source);
 const full=s.store.appendTranscript(first.material_id,1,coverage(s,'complete',60000,60000),'whole');assert.equal(full.transcription_state,'complete');
 const grown=s.store.ensure({...s.source,ended:71000,audioBytes:840000,audioFrames:3500});
 assert.equal(grown.transcription_state,'partial');assert.equal(grown.covered_ms,60000);assert.equal(grown.transcription_source_ms,70000);
 const another=s.store.ensure({...s.source,name:'take-'+'b'.repeat(32),complete:false});
 const open=s.store.appendTranscript(another.material_id,1,coverage(s,'complete',60000,60000),'open-snapshot');assert.equal(open.transcription_state,'partial');
 const reset=s.store.ensure({...s.source,audioBytes:24000,audioFrames:100,ended:3000});
 assert.equal(reset.transcription_state,'unknown');assert.equal(reset.covered_ms,-1);
});
test('missing legacy coverage stays unknown without rewriting immutable legacy sidecars',t=>{
 const s=setupMaterialStore(t),first=s.store.ensure(s.source,'旧版 Markdown，不带时间轴');
 const p=path.join(s.root,'materials',first.material_id,'revision-000000001.json');
 const old=JSON.parse(fs.readFileSync(p));delete old.transcription_state;delete old.covered_ms;delete old.transcription_source_ms;
 delete old.source.audioFrames;delete old.source.frameMs;delete old.source.interrupted;
 const bytes=JSON.stringify(old);fs.writeFileSync(p,bytes);
 assert.equal(s.store.read(first.material_id).transcription_state,undefined);
 const next=s.store.ensure(s.source);assert.equal(next.revision,2);assert.equal(next.transcription_state,undefined);
 assert.equal(next.text,first.text);assert.equal(fs.readFileSync(p,'utf8'),bytes);
 const legacy=s.store.ensure({...s.source,name:'take-'+'b'.repeat(32)},'只有旧文');assert.equal(legacy.transcription_state,'unknown');
});
test('coverage validation rejects false completion and malformed counters before committing',t=>{
 const s=setupMaterialStore(t),first=s.store.ensure(s.source);
 for(const args of [['complete',10000,60000],['partial',70000,60000],['partial',-1,60000],['unknown',0,0],['pending',1,60000]]){
  assert.throws(()=>s.store.appendTranscript(first.material_id,1,coverage(s,...args),'bad'),/COVERAGE_INVALID/);
  assert.equal(s.store.read(first.material_id).revision,1);
 }
});
test('processed silence counts as coverage; utterance length and source sealing do not infer it',()=>{
 const {materialTextInput,MaterialCoverageInput}=loadApp('MaterialTranscript');
 const result={utterances:[],seconds:60,frames:1000,speakerProcessing:'pending',boundaryProcessing:'no_speech'};
 const old=materialTextInput(result,'旧转写','unknown');assert.equal(old.transcriptionState,'unknown');assert.equal(old.coveredMs,-1);
 const c=new MaterialCoverageInput();Object.assign(c,{complete:true,coveredFrames:1000,sourceFrames:1000,frameMs:60});
 const silent=materialTextInput(result,'未检测到语音','unknown',c);assert.equal(silent.coveredMs,60000);assert.equal(silent.transcriptionState,'complete');
 c.coveredFrames=167;c.complete=false;assert.equal(materialTextInput(result,'窗口','unknown',c).coveredMs,10020);
 c.complete=true;assert.throws(()=>materialTextInput(result,'窗口','unknown',c),/COVERAGE_INVALID/);
 c.complete=false;c.sourceFrames=NaN;assert.throws(()=>materialTextInput(result,'窗口','unknown',c),/COVERAGE_INVALID/);
});
