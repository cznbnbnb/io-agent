import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';
import {loadApp} from './load-app.mjs';
import {setupLifelogManual} from './recording-cloud-fixture.mjs';

const plain=row=>JSON.parse(JSON.stringify(row));
const id='mat-lifelog-'+ 'b'.repeat(32);
const source={kind:'lifelog',name:'seg-'+ 'b'.repeat(32),started:1000,ended:2200,complete:true,audioAvailable:true,audioBytes:7000,audioFrames:20,frameMs:60,interrupted:false};
const transcript=()=>({frames:20,seconds:1.2,speechSeconds:0.8,speakerProcessing:'processed',boundaryProcessing:'token_starts',
 utterances:[{start:0.1,end:0.9,text:'合成单人原句。',speaker:1}],speakers:[{index:1,name:'',bio:'',embedding:'private-embedding',roleId:'local-only-role'}]});
const state=f=>path.join(f.root,'recording-cloud-publication',id+'.json');
const revision=(f,n)=>path.join(f.root,'materials',id,`revision-${String(n).padStart(9,'0')}.json`);
function zoneDate(minutes){return class extends Date {
 getTimezoneOffset(){return -minutes;}
 getHours(){return new Date(super.getTime()+minutes*60000).getUTCHours();}
 getMinutes(){return new Date(super.getTime()+minutes*60000).getUTCMinutes();}
 getSeconds(){return new Date(super.getTime()+minutes*60000).getUTCSeconds();}
};}

test('legacy converter remains byte-equivalent and new single cluster index 1 is first-observed speaker A',()=>{
 const mod=loadApp('MaterialTranscript'),result=transcript(),old=mod.materialTextInput(result,'已封存旧全文','unknown');
 assert.equal(old.utterances[0].speaker_id,'segment-1');assert.equal(old.speakers,undefined);
 assert.equal(JSON.stringify(old),JSON.stringify({text:'已封存旧全文',utterances:[{utterance_id:'',start_ms:100,end_ms:900,text:'合成单人原句。',speaker_id:'segment-1',speaker_basis:'segment_cluster',overlap:false}],
  channel:'unknown',speakerProcessing:'processed',boundaryProcessing:'token_starts',transcriptionState:'unknown',coveredMs:-1,sourceMs:-1}));
 const current=mod.materialTextInput(result,'新全文','unknown',undefined,id);assert.equal(current.speakers.length,1);assert.equal(current.speakers[0].label,'说话人 A');
 assert.equal(current.speakers[0].label_basis,'anonymous');assert.equal(current.speakers[0].is_self,false);assert.equal(current.utterances[0].speaker_id,mod.materialSpeakerId(id,1));
});

test('first occurrence assigns A/B independently of numeric cluster values or unused metadata; IDs stay stable and scoped',()=>{
 const mod=loadApp('MaterialTranscript'),result=transcript();result.speakers=[{index:200,name:'unused',bio:''},{index:2,name:'',bio:''},{index:9,name:'',bio:''}];
 result.utterances=[{start:0,end:0.2,text:'先说',speaker:9},{start:0.2,end:0.4,text:'未确定',speaker:-1},{start:0.4,end:0.8,text:'后说',speaker:2},{start:0.8,end:1,text:'再次',speaker:9}];
 const saved=mod.materialTextInput(result,'body','unknown',undefined,id);assert.deepEqual(plain(saved.speakers).map(s=>s.label),['说话人 A','说话人 B']);
 assert.equal(saved.utterances[1].speaker_id,'');assert.equal(saved.utterances[1].speaker_basis,'unknown');assert.equal(saved.utterances[0].speaker_id,saved.utterances[3].speaker_id);
 assert.equal(saved.speakers.some(s=>s.label==='unused'),false);const other=mod.materialTextInput(result,'body','unknown',undefined,'mat-lifelog-'+ 'c'.repeat(32));
 assert.notEqual(other.speakers[0].speaker_id,saved.speakers[0].speaker_id);
 result.utterances.reverse();const replay=mod.materialTextInput(result,'body','unknown',undefined,id);assert.equal(replay.utterances[0].speaker_id,saved.utterances[3].speaker_id);
 assert.throws(()=>mod.materialTextInput(result,'body','unknown',undefined,'segment-1'),/SPEAKER_INPUT_INVALID/);
});

test('role names are candidates with is_self false; private voice data never appears in canonical input or new markdown',()=>{
 const converter=loadApp('MaterialTranscript'),manual=loadApp('RecordingCloudPublication'),result=transcript();
 Object.assign(result.speakers[0],{name:'我',bio:'private-biography',embedding:'private-voice-vector',roleId:'private-role-id'});
 const input=converter.materialTextInput(result,'body','unknown',undefined,id);assert.equal(input.speakers[0].label,'我');assert.equal(input.speakers[0].label_basis,'role_match');assert.equal(input.speakers[0].is_self,false);
 const canonical=JSON.stringify(input);for(const secret of ['private-biography','private-voice-vector','private-role-id','embedding','bio','roleId'])assert.equal(canonical.includes(secret),false);
 const saved=manual.prepareLifelogManualResult(result,source,'合成角色测试');assert.equal(saved.speaker_schema,1);assert.ok(saved.markdown.includes('角色匹配姓名为候选'));
 for(const secret of ['private-biography','private-voice-vector','private-role-id'])assert.equal(saved.markdown.includes(secret),false);
 const reconstructed=manual.lifelogManualTextInput(JSON.stringify(saved),source);assert.equal(reconstructed.text,saved.markdown);assert.equal(reconstructed.speakers[0].is_self,false);
 result.speakers[0].name='后续改动';assert.equal(saved.transcript.speakers[0].name,'我','sealed result owns a snapshot rather than the caller object');
});

test('new marker requires exact safe markdown, coverage and valid unique speaker clusters before ready is saved',()=>{
 const manual=loadApp('RecordingCloudPublication'),converter=loadApp('MaterialTranscript'),result=transcript(),saved=manual.prepareLifelogManualResult(result,source,'合成完整测试');
 assert.throws(()=>manual.lifelogManualTextInput(JSON.stringify({...saved,markdown:saved.markdown+'invented'}),source),/RESULT_INVALID/);
 assert.throws(()=>manual.lifelogManualTextInput(JSON.stringify({...saved,speaker_schema:2}),source),/RESULT_INVALID/);
 for(const offset of [undefined,841,-841,0.5])assert.throws(()=>manual.lifelogManualTextInput(JSON.stringify({...saved,clock_offset_minutes:offset}),source),/RESULT_INVALID/);
 assert.throws(()=>manual.prepareLifelogManualResult(result,{...source,audioFrames:-1},'未测量'),/COVERAGE_INVALID/);
 assert.throws(()=>manual.lifelogManualTextInput(JSON.stringify(saved),{...source,audioFrames:-1}),/COVERAGE_INVALID/);
 assert.throws(()=>manual.prepareLifelogManualResult(result,{...source,complete:false},'增长原音'),/COVERAGE_INVALID/);
 assert.throws(()=>manual.prepareLifelogManualResult(result,source,'bad\nheading'),/RESULT_INVALID/);
 const duplicate=transcript();duplicate.speakers.push({...duplicate.speakers[0]});assert.throws(()=>converter.materialTextInput(duplicate,'body','unknown',undefined,id),/SPEAKER_INPUT_INVALID/);
 const invalid=transcript();invalid.utterances[0].speaker=1.5;assert.throws(()=>converter.materialTextInput(invalid,'body','unknown',undefined,id),/SPEAKER_INPUT_INVALID/);
 const unsafe=transcript();unsafe.speakers[0].name='unsafe\nname';assert.equal(converter.materialTextInput(unsafe,'body','unknown',undefined,id).speakers[0].label,'说话人 A');
});

test('sealed 0.1.54 ready result upgrades without a new dictionary, ASR rerun or loss of exact full-publication protection',async t=>{
 const f=setupLifelogManual(t),result=transcript();result.speakers[0].name='旧角色';result.speakers[0].bio='旧本机角色简介';
 const oldResult=f.makeResult(result);assert.equal(JSON.parse(oldResult).speaker_schema,undefined);let calls=0;
 await f.publisher.publish(f.readSource,async()=>{calls++;return oldResult;},f.mirror,f.current,f.makeInput);
 const ledgerBefore=fs.readFileSync(state(f)),headBefore=fs.readFileSync(revision(f,2)),stored=JSON.parse(ledgerBefore),oldInput=JSON.stringify(stored.input);
 assert.equal(stored.input.speakers,undefined);assert.equal(stored.input.utterances[0].speaker_id,'segment-1');assert.equal(f.publisher.hasCommittedLifelog(f.source),true);
 const restarted=f.restart();assert.equal(restarted.publisher.hasCommittedLifelog(f.source),true,'upgraded hasCommitted still fences the old fast-window job');
 await restarted.publisher.publish(f.readSource,async()=>{calls++;throw Error('old-ready must not rerun ASR');},f.mirror,f.current,f.makeInput);
 assert.equal(calls,1);assert.equal(restarted.store.read(id).revision,2);assert.equal(restarted.publisher.hasCommittedLifelog(f.source),true);
 assert.equal(JSON.stringify(f.makeInput(stored.result,stored.source)),oldInput);assert.deepEqual(fs.readFileSync(state(f)),ledgerBefore);assert.deepEqual(fs.readFileSync(revision(f,2)),headBefore);
 assert.equal(fs.readFileSync(path.join(f.directory,'text.md'),'utf8'),stored.input.text);
});

test('old ready persisted before a canonical failure recovers its same legacy input under the new converter',async t=>{
 const f=setupLifelogManual(t),result=transcript(),rename=f.io.renameSync;let calls=0;
 f.io.renameSync=(a,b)=>{if(b.includes('revision-000000002.json'))throw Error('synthetic canonical promotion stop');return rename(a,b);};
 await assert.rejects(f.publisher.publish(f.readSource,async()=>{calls++;return f.makeResult(result);},f.mirror,f.current,f.makeInput),/promotion stop/);
 const durable=fs.readFileSync(state(f)),saved=JSON.parse(durable);assert.equal(saved.state,'ready');assert.equal(saved.input.speakers,undefined);
 f.io.renameSync=rename;const restarted=f.restart();await restarted.publisher.publish(f.readSource,async()=>{calls++;throw Error('no recognition after upgrade');},f.mirror,f.current,f.makeInput);
 assert.equal(calls,1);assert.equal(restarted.store.read(id).utterances[0].speaker_id,'segment-1');assert.equal(restarted.publisher.hasCommittedLifelog(f.source),true);assert.deepEqual(fs.readFileSync(state(f)),durable);
});

test('new ready dictionary and safe markdown remain exact across canonical failure, cold restart and mirror recovery',async t=>{
 const f=setupLifelogManual(t),rename=f.io.renameSync;let calls=0;
 f.io.renameSync=(a,b)=>{if(b.includes('revision-000000002.json'))throw Error('synthetic new promotion stop');return rename(a,b);};
 await assert.rejects(f.publisher.publish(f.readSource,async()=>{calls++;return JSON.stringify(f.prepareLifelogManualResult(transcript(),f.source,'新完整稿'));},f.mirror,f.current,f.makeInput),/promotion stop/);
 const durable=fs.readFileSync(state(f)),saved=JSON.parse(durable);assert.equal(saved.state,'ready');assert.equal(saved.input.speakers[0].label,'说话人 A');
 assert.equal(JSON.parse(saved.result).speaker_schema,1);assert.equal(saved.input.text,JSON.parse(saved.result).markdown);
 f.io.renameSync=rename;const restarted=f.restart();await restarted.publisher.publish(f.readSource,async()=>{calls++;throw Error('must reuse new ready');},f.mirror,f.current,f.makeInput);
 const head=restarted.store.read(id);assert.equal(calls,1);assert.equal(head.revision,2);assert.equal(head.speakers[0].label,'说话人 A');assert.equal(head.transcription_state,'complete');assert.equal(head.covered_ms,1200);
 assert.deepEqual(plain(head.speakers),saved.input.speakers);assert.equal(restarted.publisher.hasCommittedLifelog(f.source),true);assert.deepEqual(fs.readFileSync(state(f)),durable);
 head.speakers[0].label='未经ready支持的候选';fs.writeFileSync(revision(f,2),JSON.stringify(head));
 assert.equal(restarted.publisher.hasCommittedLifelog(f.source),false,'the exact manual proof includes the dictionary');
 await assert.rejects(restarted.publisher.publish(f.readSource,async()=>{throw Error('no ASR');},f.mirror,f.current,f.makeInput),/REVISION_CONFLICT/);
});

test('changing system timezone preserves new sealed offset and old ready exact input instead of losing manual-publication protection',async t=>{
 const f=setupLifelogManual(t),east=loadApp('RecordingCloudPublication',f.platform,{setTimeout,clearTimeout,Date:zoneDate(480)});
 const first=new east.RecordingCloudPublication();first.initialize(f.root,f.store);let calls=0;
 await first.publish(f.readSource,async()=>{calls++;return JSON.stringify(east.prepareLifelogManualResult(transcript(),f.source,'固定封存标题'));},f.mirror,f.current,east.lifelogManualTextInput);
 const bytes=fs.readFileSync(state(f)),saved=JSON.parse(bytes),result=JSON.parse(saved.result);assert.equal(result.clock_offset_minutes,480);assert.ok(result.markdown.includes('[08:00:01]'));
 const west=loadApp('RecordingCloudPublication',f.platform,{setTimeout,clearTimeout,Date:zoneDate(-300)}),restartedStore=new f.MaterialStore();restartedStore.initialize(f.root);
 const restarted=new west.RecordingCloudPublication();restarted.initialize(f.root,restartedStore);
 assert.equal(JSON.stringify(west.lifelogManualTextInput(saved.result,saved.source)),JSON.stringify(saved.input));assert.equal(restarted.hasCommittedLifelog(f.source),true);
 await restarted.publish(f.readSource,async()=>{calls++;throw Error('timezone changes must not repeat ASR');},f.mirror,f.current,west.lifelogManualTextInput);
 assert.equal(calls,1);assert.deepEqual(fs.readFileSync(state(f)),bytes);assert.equal(restartedStore.read(id).revision,2);assert.equal(restarted.hasCommittedLifelog(f.source),true);
 const old=setupLifelogManual(t);await old.publisher.publish(old.readSource,async()=>old.makeResult(transcript()),old.mirror,old.current,old.makeInput);
 const oldBytes=fs.readFileSync(state(old)),oldState=JSON.parse(oldBytes),oldWest=loadApp('RecordingCloudPublication',old.platform,{setTimeout,clearTimeout,Date:zoneDate(-300)});
 assert.equal(JSON.parse(oldState.result).clock_offset_minutes,undefined);const oldRestart=new oldWest.RecordingCloudPublication();oldRestart.initialize(old.root,old.store);
 assert.equal(oldRestart.hasCommittedLifelog(old.source),true);assert.equal(JSON.stringify(oldWest.lifelogManualTextInput(oldState.result,oldState.source)),JSON.stringify(oldState.input));
 assert.deepEqual(fs.readFileSync(state(old)),oldBytes);
});

test('shared rendering supports only explicit integer UTC offsets within fourteen hours',()=>{
 const mod=loadApp('MaterialStore'),row=new mod.MaterialRevision();row.source.started=1000;
 row.utterances=[{utterance_id:'u',start_ms:0,end_ms:100,text:'范围测试',speaker_id:'',speaker_basis:'unknown',overlap:false}];
 assert.ok(mod.renderMaterialTranscript(row,840).includes('[14:00:01]'));assert.ok(mod.renderMaterialTranscript(row,-840).includes('[10:00:01]'));
 for(const offset of [841,-841,0.5,NaN,Infinity])assert.throws(()=>mod.renderMaterialTranscript(row,offset),/CLOCK_OFFSET_INVALID/);
});

test('new no-speech full result has an empty dictionary and preserves measured silence coverage',()=>{
 const manual=loadApp('RecordingCloudPublication'),silent=transcript();silent.utterances=[];silent.speakers=[];silent.speechSeconds=0;silent.speakerProcessing='unavailable';silent.boundaryProcessing='no_speech';
 const saved=manual.prepareLifelogManualResult(silent,source,'合成无声'),input=manual.lifelogManualTextInput(JSON.stringify(saved),source);
 assert.deepEqual(plain(input.speakers),[]);assert.deepEqual(plain(input.utterances),[]);assert.equal(input.transcriptionState,'complete');assert.equal(input.coveredMs,1200);assert.equal(input.boundaryProcessing,'no_speech');
 assert.ok(saved.markdown.includes('未检测到有效语音'));
});
