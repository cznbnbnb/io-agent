import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';
import {setupRecordingCloud,setupLifelogManual} from './recording-cloud-fixture.mjs';
const state=f=>path.join(f.root,'recording-cloud-publication',f.store.idFor(f.source.kind,f.source.name)+'.json').replaceAll('\\','/');
const head=f=>f.store.read(f.store.idFor(f.source.kind,f.source.name));
const publish=(f,recognize=async()=> '合成完整云文字',mirror=f.mirror)=>f.publisher.publish(f.readSource,recognize,mirror,f.current);
const deferred=()=>{let resolve,reject;const promise=new Promise((r,j)=>{resolve=r;reject=j;});return {promise,resolve,reject};};

test('cloud publication writes canonical full text before one durable fixed-name mirror and reuses ready on restart',async t=>{
 const f=setupRecordingCloud(t);let calls=0;await publish(f,async()=>{calls++;return '完整全文';});
 const row=head(f);assert.equal(row.revision,2);assert.equal(row.text,'完整全文');assert.equal(row.recognition_channel,'mix');
 assert.equal(row.utterances.length,0);assert.equal(row.transcription_state,'unknown');assert.equal(row.covered_ms,-1);assert.equal(row.speaker_processing,'unknown');
 const saved=JSON.parse(fs.readFileSync(state(f)));assert.equal(saved.state,'ready');assert(saved.operationId.endsWith('-r1'));
 const {publisher}=f.restart();await publisher.publish(f.readSource,async()=>{calls++;return '不该识别';},f.mirror,f.current);
 assert.equal(calls,1);assert.equal(head(f).revision,2);assert.deepEqual(fs.readdirSync(f.directory).filter(n=>n.endsWith('.md')),[saved.fileName]);
});

test('ready write failure keeps the in-process result, blocks canonical and does not rerun recognition on explicit retry',async t=>{
 const f=setupRecordingCloud(t),rename=f.io.renameSync;let writes=0,calls=0;
 f.io.renameSync=(a,b)=>{if(b===state(f)&&++writes===2)throw Error('synthetic ready failure');return rename(a,b);};
 await assert.rejects(publish(f,async()=>{calls++;return '结果已算出';}),/synthetic ready/);
 assert.equal(head(f).revision,1);assert.equal(f.mirrorCalls(),0);assert.equal(JSON.parse(fs.readFileSync(state(f))).state,'prepared');
 await f.publisher.publish(f.readSource,async()=>{calls++;return '不得重复';},f.mirror,f.current,undefined,true);
 assert.equal(calls,1);assert.equal(head(f).text,'结果已算出');assert.equal(head(f).revision,2);
});

test('cold prepared state refuses silent re-recognition and requires explicit new authorization',async t=>{
 const f=setupRecordingCloud(t);await assert.rejects(publish(f,async()=>{throw Error('synthetic recognition stop');}),/recognition stop/);
 const restarted=f.restart();let calls=0;
 await assert.rejects(restarted.publisher.publish(f.readSource,async()=>{calls++;return '新授权结果';},f.mirror,f.current),/RESULT_NOT_SAVED/);assert.equal(calls,0);
 await restarted.publisher.publish(f.readSource,async()=>{calls++;return '新授权结果';},f.mirror,f.current,undefined,true);assert.equal(calls,1);
});

test('canonical promotion failure leaves ready reusable without ASR after a real restart',async t=>{
 const f=setupRecordingCloud(t),rename=f.io.renameSync;let calls=0;
 f.io.renameSync=(a,b)=>{if(b.includes('revision-000000002.json'))throw Error('synthetic canonical failure');return rename(a,b);};
 await assert.rejects(publish(f,async()=>{calls++;return '耐久结果';}),/canonical failure/);assert.equal(head(f).revision,1);
 assert.equal(JSON.parse(fs.readFileSync(state(f))).state,'ready');assert.equal(f.mirrorCalls(),0);f.io.renameSync=rename;
 const restarted=f.restart();await restarted.publisher.publish(f.readSource,async()=>{calls++;return '错误';},f.mirror,f.current);
 assert.equal(calls,1);assert.equal(restarted.store.read(head(f).material_id).text,'耐久结果');
});

test('mirror failure reports saved canonical text and restart only repairs its exact fixed mirror',async t=>{
 const f=setupRecordingCloud(t);let calls=0;
 assert.match(await publish(f,async()=>{calls++;return '正文';},()=>{throw Error('synthetic mirror failure');}),/文字已保存.*待补写/);
 const saved=JSON.parse(fs.readFileSync(state(f))),restarted=f.restart();await restarted.publisher.publish(f.readSource,async()=>{calls++;return '错误';},f.mirror,f.current);
 assert.equal(calls,1);assert.equal(head(f).revision,2);assert.equal(fs.readFileSync(path.join(f.directory,saved.fileName),'utf8').includes('正文'),true);
});

test('a tombstone blocks a delayed recognition and cannot be revived by same-operation recovery',async t=>{
 const f=setupRecordingCloud(t),ready=deferred(),entered=deferred();const p=publish(f,async()=>{entered.resolve();return ready.promise;});
 await entered.promise;const base=head(f);f.store.delete(base.material_id,base.revision);ready.resolve('迟到全文');
 await assert.rejects(p,/MATERIAL_DELETED/);assert.equal(head(f).operation,'delete');assert.equal(f.mirrorCalls(),0);
 await assert.rejects(publish(f),/MATERIAL_DELETED/);assert.equal(head(f).operation,'delete');
});

test('canonical CAS detects an intervening newer ASR revision before publication',async t=>{
 const f=setupRecordingCloud(t),ready=deferred(),entered=deferred();const p=publish(f,async()=>{entered.resolve();return ready.promise;});
 await entered.promise;const base=head(f);f.store.appendTranscript(base.material_id,base.revision,f.input,'another-operation');ready.resolve('迟到全文');
 await assert.rejects(p,/REVISION_CONFLICT/);assert.equal(head(f).text,f.input.text);assert.equal(f.mirrorCalls(),0);
});

test('equal-length WAV replacement is detected even when its original mtime is restored',async t=>{
 const f=setupRecordingCloud(t),ready=deferred(),entered=deferred();const p=publish(f,async()=>{entered.resolve();return ready.promise;});
 await entered.promise;const original=fs.statSync(f.wavPath),fd=fs.openSync(f.wavPath,'r+');fs.writeSync(fd,Buffer.from([99]),0,1,200);fs.closeSync(fd);fs.utimesSync(f.wavPath,original.atime,original.mtime);ready.resolve('过时全文');
 await assert.rejects(p,/SOURCE_CHANGED/);assert.equal(head(f).revision,1);assert.equal(f.mirrorCalls(),0);
});

test('missing audio and incomplete source reject before recognition',async t=>{
 for(const mode of ['missing','incomplete']){const f=setupRecordingCloud(t);let calls=0;if(mode==='missing')fs.unlinkSync(f.rawPath);else f.source.complete=false;
 await assert.rejects(publish(f,async()=>{calls++;return '错误';}));assert.equal(calls,0);assert.equal(head(f),undefined);}
});

test('lifecycle invalidation fences delayed ASR and mirror failure cannot swallow cancellation',async t=>{
 const f=setupRecordingCloud(t),ready=deferred(),entered=deferred();const p=publish(f,async()=>{entered.resolve();return ready.promise;});
 await entered.promise;f.setCurrent(false);ready.resolve('迟到全文');await assert.rejects(p,/LIFETIME_CHANGED/);assert.equal(head(f).revision,1);
 const g=setupRecordingCloud(t);await assert.rejects(publish(g,undefined,()=>{g.setCurrent(false);throw Error('synthetic mirror failure');}),/LIFETIME_CHANGED/);
 assert.equal(head(g).revision,2,'already committed canonical remains durable');
});

test('concurrent calls are rejected and corrupt durable state never invokes recognition',async t=>{
 const f=setupRecordingCloud(t),ready=deferred(),entered=deferred();const p=publish(f,async()=>{entered.resolve();return ready.promise;});await entered.promise;
 await assert.rejects(publish(f),/BUSY/);ready.resolve('正文');await p;
 fs.writeFileSync(state(f),'{}');let calls=0;await assert.rejects(publish(f,async()=>{calls++;return '错误';}),/STATE_INVALID/);assert.equal(calls,0);
});
const fullResult={frames:20,seconds:1.2,speechSeconds:0.8,speakerProcessing:'processed',boundaryProcessing:'token_starts',utterances:[{start:0.1,end:0.9,text:'完整说话人文字',speaker:0}],speakers:[{index:0,name:'合成角色',bio:'合成资料'}]};
test('local full result preserves speakers, boundaries and measured coverage through exact durable recovery',async t=>{
 const f=setupLifelogManual(t);let calls=0;
 await f.publisher.publish(f.readSource,async()=>{calls++;return f.makeResult(fullResult);},f.mirror,f.current,f.makeInput);
 const id=f.store.idFor(f.source.kind,f.source.name),saved=f.store.read(id);assert.equal(saved.speaker_processing,'processed');assert.equal(saved.transcription_state,'complete');assert.equal(saved.covered_ms,1200);assert.equal(saved.utterances[0].speaker_basis,'segment_cluster');
 assert.equal(f.publisher.hasCommittedLifelog(f.source),true);f.store.correctText(id,saved.revision,saved.utterances[0].utterance_id,'人工更正');
 assert.equal(f.publisher.hasCommittedLifelog(f.source),false);await assert.rejects(f.publisher.publish(f.readSource,async()=>{calls++;return f.makeResult(fullResult);},f.mirror,f.current,f.makeInput),/USER_REVISION_PROTECTED/);assert.equal(calls,1);
});
test('legacy full source derives sealed OGG frame coverage and retains speaker processing',async t=>{
 const f=setupLifelogManual(t,{legacy:true});await f.publisher.publish(f.readSource,async()=>f.makeResult(fullResult),f.mirror,f.current,f.makeInput);
 const row=f.store.read(f.store.idFor(f.source.kind,f.source.name));assert.equal(row.speaker_processing,'processed');assert.equal(row.transcription_state,'complete');assert.equal(row.covered_ms,1200);assert.equal(f.publisher.hasCommittedLifelog(f.source),true);
});
test('cold result/input inconsistency and later metadata revision block mirror recovery',async t=>{
 const f=setupLifelogManual(t);await f.publisher.publish(f.readSource,async()=>f.makeResult(fullResult),()=>{throw Error('synthetic mirror');},f.current,f.makeInput);
 const id=f.store.idFor(f.source.kind,f.source.name),p=path.join(f.root,'recording-cloud-publication',id+'.json'),stored=JSON.parse(fs.readFileSync(p));stored.input.text='与结果不一致';fs.writeFileSync(p,JSON.stringify(stored));
 await assert.rejects(f.restart().publisher.publish(f.readSource,async()=>{throw Error('no ASR');},f.mirror,f.current,f.makeInput),/STATE_INVALID|REVISION_CONFLICT/);
 stored.input=f.makeInput(stored.result,stored.source);fs.writeFileSync(p,JSON.stringify(stored));const newer=Object.assign(new f.MaterialSource(),f.source);newer.audioAvailable=false;f.store.ensure(newer);
 await assert.rejects(f.restart().publisher.publish(f.readSource,async()=>{throw Error('no ASR');},f.mirror,f.current,f.makeInput),/REVISION_CONFLICT/);
});
test('legacy OGG with no measured duration derives its source extent before recognition and CAS',async t=>{
 const f=setupLifelogManual(t,{legacy:true});f.source.ended=f.source.started;
 let seen;await f.publisher.publish(f.readSource,async()=>{seen=f.store.read(f.store.idFor('lifelog',f.source.name));return f.makeResult(fullResult);},f.mirror,f.current,f.makeInput);
 assert.equal(seen.source.audioFrames,20);assert.equal(seen.source.ended-seen.source.started,1200);assert.equal(seen.source_identity,'unknown');
 assert.equal(f.store.read(seen.material_id).transcription_state,'complete');assert.equal(f.publisher.hasCommittedLifelog(f.source),true);
});
test('legacy OGG without EOS is rejected before any expensive recognition',async t=>{
 const f=setupLifelogManual(t,{legacy:true}),bytes=fs.readFileSync(f.oggPath);fs.writeFileSync(f.oggPath,bytes.subarray(0,bytes.length-20));f.source.audioBytes=bytes.length-20;
 let calls=0;await assert.rejects(f.publisher.publish(f.readSource,async()=>{calls++;return f.makeResult(fullResult);},f.mirror,f.current,f.makeInput),/OGG_ARCHIVE_INCOMPLETE/);assert.equal(calls,0);
});
test('a prepared persisted source inconsistent with its fingerprint is rejected before authorized recognition retry',async t=>{
 const f=setupRecordingCloud(t);await assert.rejects(publish(f,async()=>{throw Error('synthetic stop');}));
 const row=JSON.parse(fs.readFileSync(state(f)));row.source.ended++;fs.writeFileSync(state(f),JSON.stringify(row));let calls=0;
 await assert.rejects(f.restart().publisher.publish(f.readSource,async()=>{calls++;return '错误';},f.mirror,f.current,undefined,true),/STATE_INVALID/);assert.equal(calls,0);
});
test('oversized local OGG is refused before hashing or recognition',async t=>{
 const f=setupLifelogManual(t);fs.truncateSync(f.oggPath,16000001);f.source.audioBytes=16000001;let reads=0,calls=0;const read=f.io.readSync;f.io.readSync=(...args)=>{reads++;return read(...args);};
 await assert.rejects(f.publisher.publish(f.readSource,async()=>{calls++;return f.makeResult(fullResult);},f.mirror,f.current,f.makeInput),/SOURCE_UNAVAILABLE/);assert.equal(reads,0);assert.equal(calls,0);
});
