import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {loadApp} from './load-app.mjs';
import {setupMaterialStore} from './material-fixture.mjs';

function full(t){
 const f=setupMaterialStore(t);f.input.transcriptionState='complete';f.input.coveredMs=60000;f.input.sourceMs=60000;
 f.input.text='模型原稿';f.input.boundaryProcessing='token_starts';f.input.speakerProcessing='processed';
 f.input.utterances[0].text='前半句🙂，后半句保持原音。';
 const base=f.store.ensure(f.source),row=f.store.appendTranscript(base.material_id,1,f.input,'original-asr');
 const {MaterialTranscriptExport}=loadApp('MaterialTranscriptExport',{'@kit.CoreFileKit':{fileIo:f.io}}),files=new MaterialTranscriptExport();files.initialize(f.root);
 const edit=(row,kind,data,id)=>{const op=new f.MaterialSpeakerCorrection();Object.assign(op,{kind,operation_id:id},data);return f.store.correctSpeakers(row.material_id,row.revision,op);};
 return {...f,row,files,edit};
}
test('immutable MD and structured exports use the corrected revision and leave legacy model/audio files intact',t=>{
 const f=full(t),raw=path.join(f.root,'original-audio.raw'),legacy=path.join(f.root,'transcript.json');
 fs.writeFileSync(raw,Buffer.alloc(128,7));fs.writeFileSync(legacy,'{"embedding":"local-only-original-model-output"}');
 const sourceBefore=fs.readFileSync(raw),legacyBefore=fs.readFileSync(legacy);
 const renamed=f.edit(f.row,'rename',{speaker_id:'speaker-0',label:'会议主持'},'export-rename-operation');
 const before=f.files.save(f.row),md=f.files.save(renamed),json=f.files.save(renamed,'json');
 assert.notEqual(before,md);assert.match(fs.readFileSync(md,'utf8'),/会议主持/);assert.match(fs.readFileSync(md,'utf8'),/资料修订：3；文字修订：2/);
 assert.deepEqual(JSON.parse(fs.readFileSync(json,'utf8')),JSON.parse(JSON.stringify(renamed)));
 assert.doesNotMatch(fs.readFileSync(json,'utf8'),/embedding/);assert.equal(f.files.save(renamed),md);
 assert.deepEqual(fs.readFileSync(raw),sourceBefore);assert.deepEqual(fs.readFileSync(legacy),legacyBefore);
 const original=fs.readFileSync(before);f.files.save(renamed);assert.deepEqual(fs.readFileSync(before),original);
 fs.writeFileSync(md,'damaged export');assert.throws(()=>f.files.save(renamed),/EXPORT_CONFLICT/);
});
test('export failed promotion is retryable without changing a material revision or reporting a final file',t=>{
 const f=full(t),expected=path.join(f.root,'material-transcripts',f.row.material_id+'-r2.md');
 f.failPromotion(true);assert.throws(()=>f.files.save(f.row),/synthetic-disk-failure/);assert.equal(fs.existsSync(expected),false);assert.equal(f.store.read(f.row.material_id).revision,2);
 f.failPromotion(false);const result=f.files.save(f.row);assert.equal(result.replaceAll('\\','/'),expected.replaceAll('\\','/'));assert.match(fs.readFileSync(result,'utf8'),/模型原稿/);
 const deleted=f.store.delete(f.row.material_id,2);assert.throws(()=>f.files.save(deleted),/EXPORT_INVALID/);
});
test('daily summary reads canonical label/text/split provenance and never falls back to stale ASR after deletion',t=>{
 const f=full(t),{JournalSources,buildJournalDay}=loadApp('JournalExport',{'./LifelogSession':{LifelogDayText:class{}},'./RecordingSession':{}});
 const src=new JournalSources();src.recordingItems=[{name:f.source.name,created:1000,bytes:720000,textFile:'stale.md'}];src.recordingText=()=>{throw Error('stale legacy path must not be read');};
 const renamed=f.edit(f.row,'rename',{speaker_id:'speaker-0',label:'仅本段的主持'},'day-label-operation');
 const split=f.edit(renamed,'split',{utterance_ids:[renamed.utterances[0].utterance_id],split_offset:renamed.utterances[0].text.indexOf('，')},'day-split-operation');
 const corrected=f.edit(split,'text',{utterance_ids:[split.utterances[1].utterance_id],text:'人工校正后半句。'},'day-text-operation');src.material=()=>f.store.read(f.row.material_id);
 const day=buildJournalDay(0,src,'');assert.equal(day.transcribed,1);assert.match(day.markdown,/仅本段的主持/);assert.match(day.markdown,/人工校正后半句/);
 assert.match(day.markdown,/父句原音范围，句内时间未确定/);assert.doesNotMatch(day.markdown,/说话人1|模型原稿/);
 f.store.delete(f.row.material_id,corrected.revision);const deleted=buildJournalDay(0,src,'');assert.equal(deleted.transcribed,0);assert.match(deleted.markdown,/资料已删除/);assert.doesNotMatch(deleted.markdown,/人工校正后半句/);
});
