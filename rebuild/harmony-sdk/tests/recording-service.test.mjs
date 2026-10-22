import test from 'node:test';import fs from 'node:fs';import assert from 'node:assert/strict';import {loadApp} from './load-app.mjs';import {setupMaterialStore} from './material-fixture.mjs';import {setupRecordingCloud,setupLifelogManual} from './recording-cloud-fixture.mjs';
import {createHash} from 'node:crypto';
const settle=async()=>{for(let i=0;i<40;i++)await Promise.resolve();};

function ownedService(t){
 const f=setupRecordingCloud(t),directory=f.directory.replaceAll('\\','/'),name=f.source.name,owner='voice-'+ 'a'.repeat(32),cleanup='b'.repeat(32),peer='synthetic-original-peer',uuid='owned-voice-recording';
 fs.writeFileSync(f.rawPath,Buffer.alloc(7200,7));fs.writeFileSync(f.wavPath,Buffer.alloc(44+30*1280));
 fs.writeFileSync(directory+'/manifest.json',JSON.stringify({version:1,uuid,peer,created:1000,completed:true,valid:true,wavReady:true,coverage:[[0,7200]],voice_owner:owner,voice_cleanup_id:cleanup,voice_exit_evidence:'device_event'}));
 const q=loadApp('LocalAsrQueue',f.platform),s=setup(false,{'@kit.CoreFileKit':{fileIo:f.io},'./LocalAsrQueue':q,'./MaterialStore':{MaterialStore:f.MaterialStore,MaterialSource:f.MaterialSource,MaterialTextInput:f.MaterialTextInput,MaterialUtterance:f.MaterialUtterance}});
 s.recordings.items=[{name,created:1000,bytes:7200,complete:true,rawAvailable:true}];s.recordings.directoryOf=()=>directory;s.recordings.file=(_item,wav)=>wav?f.wavPath:f.rawPath;
 s.recordings.activeDirectory='';s.recordings.cleanupSessionId='';s.startRecordingServices(f.root,()=>{},()=>{},false);
 const handle={ownerId:owner,cleanupId:cleanup,uuid,directory,peer,connectionEpoch:0};
 const result={frames:30,seconds:0.6,speechSeconds:0.6,utterances:[{start:0,end:0.2,text:'用新价格。',speaker:-1},{start:0.2,end:0.6,text:'但运费沿用上次，完整尾句。',speaker:-1}],speakers:[]};
 t.after(()=>s.stopRecordingServices());return {...s,f,directory,handle,result};
}
test('owned recording uses the existing sealed queue and claims only its full canonical text and verified source',async t=>{
 const s=ownedService(t);s.recordings.onRecordingClosed(s.directory,s.directory+'/source.rawopus',1000);await settle();assert.equal(s.pending.length,1);
 s.recordings.activeDirectory=s.directory;assert.equal(s.readTaskRecording(s.handle).state,'capturing');s.recordings.activeDirectory='';
 s.pending.shift().resolve(s.result);await settle();
 const ready=s.readTaskRecording(s.handle);assert.equal(ready.state,'complete');assert.equal(ready.text,'用新价格。\n但运费沿用上次，完整尾句。');assert.equal(ready.exitEvidence,'device_event');
 assert.equal(ready.origin.uuid,s.handle.uuid);assert.equal(ready.origin.raw_bytes,7200);assert(fs.existsSync(s.directory+'/task-asr-source.json'));
 const textHash=createHash('sha256').update(ready.text).digest('hex');s.assertTaskRecordingOrigin(ready.origin,textHash);
 assert.equal(s.readTaskRecording({...s.handle,uuid:'foreign'}).state,'failed');assert.throws(()=>s.assertTaskRecordingOrigin(ready.origin,'0'.repeat(64)));
 const head=s.materials.read(ready.origin.material_id);s.materials.delete(head.material_id,head.revision);
 assert.equal(s.readTaskRecording(s.handle).state,'failed');assert.throws(()=>s.assertTaskRecordingOrigin(ready.origin,textHash));assert(fs.existsSync(s.directory+'/source.rawopus'));
});
test('owned recording raw changed during queued recognition cannot become a valid original-task transcript',async t=>{
 const s=ownedService(t);s.recordings.onRecordingClosed(s.directory,s.directory+'/source.rawopus',1000);await settle();assert.equal(s.pending.length,1);
 const raw=fs.readFileSync(s.directory+'/source.rawopus');raw[0]^=1;fs.writeFileSync(s.directory+'/source.rawopus',raw);
 s.pending.shift().resolve(s.result);await settle();assert.equal(s.readTaskRecording(s.handle).state,'failed');assert(!fs.existsSync(s.directory+'/task-asr-source.json'));
 assert(fs.existsSync(s.directory+'/source.rawopus'));assert.equal(JSON.parse(fs.readFileSync(s.f.root+'/asr-queue/state.json','utf8')).jobs[0].status,'failed');
});
test('notification ownership rejects recording before ASR interruption or lifelog suspension',()=>{
 const s=setup(false,{'./ProbeSession':{probeSession:{notificationOccupied:()=>true}}});
 assert.throws(()=>s.recordings.beforeStart(),/通知已收起/);assert.deepEqual(s.events,[]);assert.equal(s.calls.length,0);
});
test('pending ordinary voice exit rejects recording before ASR interruption or lifelog suspension',()=>{
 const s=setup(false,{'./ProbeSession':{probeSession:{notificationOccupied:()=>false,voice:{active:false,pendingWrites:true}}}});
 assert.throws(()=>s.recordings.beforeStart(),/退出指令/);assert.deepEqual(s.events,[]);assert.equal(s.calls.length,0);
});
test('pending settings reject recording before ASR interruption or lifelog suspension',()=>{
  class Recording{constructor(_send,_device,idle){this.idle=idle;}active=false;busy=false;occupied=false;}
 class Lifelog{constructor(_send,_device,idle){this.idle=idle;}}
 const probe={notificationOccupied:()=>false,voice:{active:false,pendingWrites:false},features:{launcherBusy:true,displayActive:false},prompterOccupied:()=>false};
 const s=setup(false,{'./ProbeSession':{probeSession:probe},'./RecordingSession':{RecordingSession:Recording},'./LifelogSession':{LifelogSession:Lifelog}});
 assert.throws(()=>s.recordings.beforeStart(),/完成设备设置/);assert.deepEqual(s.events,[]);assert.equal(s.calls.length,0);
 assert.equal(s.recordings.idle(),false);assert.equal(s.lifelog.idle(),false);probe.features.launcherBusy=false;
 assert.equal(s.recordings.idle(),true);assert.equal(s.lifelog.idle(),true);
});
test('lifelog cleanup occupancy blocks recording idle after its local receiver has closed',()=>{
 class Recording{constructor(_send,_device,idle){this.idle=idle;}occupied=false;}
 class Lifelog{constructor(_send,_device,idle){this.idle=idle;}occupied=true;}
 const probe={notificationOccupied:()=>false,voice:{active:false,pendingWrites:false},features:{launcherBusy:false,displayActive:false},prompterOccupied:()=>false};
 const s=setup(false,{'./ProbeSession':{probeSession:probe},'./RecordingSession':{RecordingSession:Recording},'./LifelogSession':{LifelogSession:Lifelog}});
 assert.equal(s.recordings.idle(),false);s.lifelog.occupied=false;assert.equal(s.recordings.idle(),true);
});
function setup(start=true,overrides={}){
 let now=Date.now(),timerSequence=1000;const wakeTimers=new Map(),cancelledWake=[];class Clock extends Date{static now(){return now;}}
 const calls=[],pending=[],ticks=[],pruned=[],events=[],cleared=[],windowCalls=[],windowSteps=[];let queueState;const materialWrites=[];
 class Handle{ownerId='';cleanupId='';uuid='';directory='';peer='';connectionEpoch=0;}
  class Recording{items=[];active=false;busy=false;cleanupRequired=false;pendingWrites=false;get occupied(){return this.active||this.busy||this.cleanupRequired||this.pendingWrites;}note='';changed(){};directoryOf(i){return '/app/recordings/'+i.name;}file(i){return this.directoryOf(i)+'/source.rawopus';}findByDirectory(d){return this.items.find(i=>this.directoryOf(i)===d);}saveTranscript(i,text){if(this.failSave)throw Error('disk-full');i.textFile='transcript-1.md';events.push(text);}refresh(){}pruneAudio(){throw Error('recordings must never be pruned');}}
 class Lifelog{items=[];autoTranscribe=true;note='';changed(){};rootPath(){return '/app/lifelog';}file(i){return this.rootPath()+'/'+i.name+'/audio.ogg';}refresh(){}pruneAudio(days){pruned.push(days);}readTranscriptJson(){return '';}saveSegmentResult(){events.push('life-saved');}async suspendForRecording(){events.push('pause');}async resumeAfterRecording(){events.push('resume');}}
 class ASR{engine={isReady:()=>true};busy=false;progress=0;log(){};transcribe(p){calls.push(p);return new Promise((resolve,reject)=>pending.push({resolve,reject}));}transcribeRecording(p){return this.transcribe(p);}}
 class Queue{rows=[];results=new Map();constructor(){queueState=this;}initialize(){for(const r of this.rows)if(r.status==='running')r.status='queued';}all(){return structuredClone(this.rows);}get(id){return structuredClone(this.rows.find(r=>r.jobId===id));}enqueue(directory,sourcePath,started,kind,forced,retry){if(this.failRetry)throw Error('synthetic-write-failure');let r=this.rows.find(r=>r.directory===directory);if(!r){r={jobId:directory,directory,sourcePath,started,kind,forced,status:'queued',nextRun:0,attempts:0};this.rows.push(r);}else if(retry&&r.status==='failed'){r.status=this.results.has(r.jobId)?'result_ready':'queued';r.nextRun=0;}return r;}transition(id,status,error='',nextRun=0){const r=this.rows.find(r=>r.jobId===id);r.status=status;r.nextRun=nextRun;r.lastError=error;if(status==='running')r.attempts++;return r;}wakeAudio(){}deferWindow(id,reason,nextRun){const r=this.rows.find(r=>r.jobId===id);r.status='queued';r.lastError=reason;r.nextRun=nextRun;r.attempts=0;}interrupted(id){const r=this.rows.find(r=>r.jobId===id);if(r.status==='running')r.status='queued';}sealResult(id,result){this.results.set(id,result);this.transition(id,'result_ready');}readResult(id){return this.results.get(id);}}
 const mod=loadApp('RecordingService',{'./LifelogWindowPipeline':{LifelogWindowPipeline:class{initialize(){}async next(...args){windowCalls.push(args);return windowSteps.shift()||{state:'waiting',reason:'waiting_audio'};}}},'./TranscriptionSignals':{readTranscriptionSignals:async()=>({conditions:{charging:false,batteryPercent:60,freeBytes:1e9,thermalKnown:true,thermalLimited:false}})},'./LocalAsrQueue':{LocalAsrQueue:Queue,LocalAsrJob:class{}},'./RecordingSession':{RecordingSession:Recording,RecordingCaptureHandle:Handle},'./LifelogSession':{LifelogSession:Lifelog},'./LifelogASR':{LifelogASR:ASR,lifelogMarkdown:(_t,r)=>r.utterances.length?'文字':'未检测到有效语音'},'./ProbeSession':{probeSession:{foreground:true,background:{active:false},voice:{active:false},features:{state:{connected:true},displayActive:false},notificationOccupied:()=>false,prompterOccupied:()=>false,auth:{sendBusiness:async()=>{}}}},'@kit.BasicServicesKit':{batteryInfo:{BatteryChargeState:{ENABLE:1},BatteryPluggedType:{NONE:0},chargingStatus:0,pluggedType:0}},'./JournalExport':{JournalSources:class{},buildJournalDay:()=>({total:0}),writeJournalFile(){},dayStamp:()=>''},'./RemoteServices':{SecureServiceConfig:class{},RemoteServices:class{},ServiceConfig:class{}},'./MaterialStore':{MaterialStore:class{initialize(){}read(){return undefined;}idFor(_kind,name){return name;}ensure(source){return {material_id:source.name,revision:1};}appendTranscript(id,revision,input,job){events.push('material-saved');materialWrites.push({id,revision,input,job});return {transcription_state:input.transcriptionState};}},MaterialSource:class{},MaterialTextInput:class{},MaterialUtterance:class{}},'./VoiceRegistry':{VoiceRegistry:class{}},...overrides},{Date:Clock,setInterval:f=>{ticks.push(f);return ticks.length;},clearInterval:id=>cleared.push(id),setTimeout:(f,ms)=>{const id=++timerSequence;wakeTimers.set(id,{f,at:now+ms});return id;},clearTimeout:id=>{cancelledWake.push(id);wakeTimers.delete(id);}});
 if(start)mod.startRecordingServices('/app');
 return {...mod,calls,pending,ticks,pruned,events,cleared,windowCalls,windowSteps,materialWrites,queueState:()=>queueState,wakeTimers,cancelledWake,now:()=>now,advance:ms=>now+=ms,fireWake:()=>{for(const [id,t] of [...wakeTimers])if(t.at<=now){wakeTimers.delete(id);t.f();}}};
}
function setupManualService(t,{local=false,legacy=false,noMeta=false,realQueue=false}={}){
 const f=local?setupLifelogManual(t,{legacy}):setupRecordingCloud(t),probe={foreground:true,voice:{active:false},background:{active:false},features:{state:{connected:true},displayActive:false},auth:{sendBusiness:async()=>{}},notificationOccupied:()=>false,prompterOccupied:()=>false};
 const cloudPending=[],cloudCalls=[];let cancelled=0;
 class CloudASR{transcribe(p,c){cloudCalls.push({p,c});return new Promise((resolve,reject)=>cloudPending.push({resolve,reject}));}cancel(){cancelled++;}}
 const pub={RecordingCloudPublication:f.RecordingCloudPublication,readRecordingCloudSnapshot:f.readRecordingCloudSnapshot,readLifelogManualSnapshot:f.readLifelogManualSnapshot,LifelogManualResult:f.LifelogManualResult,lifelogManualTextInput:f.lifelogManualTextInput,prepareLifelogManualResult:f.prepareLifelogManualResult};
 const queueModule=realQueue?loadApp('LocalAsrQueue',f.platform):undefined;
 const s=setup(false,{'./ProbeSession':{probeSession:probe},'./MaterialStore':{MaterialStore:f.MaterialStore,MaterialSource:f.MaterialSource,MaterialTextInput:f.MaterialTextInput,MaterialUtterance:f.MaterialUtterance},'./RecordingCloudPublication':pub,'./RecordingASR':{RecordingASR:CloudASR},'@kit.CoreFileKit':{fileIo:f.io},...(queueModule?{'./LocalAsrQueue':queueModule}:{})});
 s.materials.initialize=()=>{};for(const name of ['idFor','read','ensure','appendTranscript','delete','correctSpeakers'])s.materials[name]=f.store[name].bind(f.store);
 s.recordings.directoryOf=i=>f.root+'/recordings/'+i.name;s.recordings.file=(i,wav)=>s.recordings.directoryOf(i)+(wav?'/audio.wav':'/source.rawopus');s.recordings.saveTranscriptFixed=(i,n,text)=>{if(s.recordings.failSave)throw Error('synthetic mirror failure');f.mirror(f.source,n,text);i.textFile=n;};
 s.lifelog.rootPath=()=>f.root+'/lifelog';s.lifelog.file=i=>s.lifelog.rootPath()+'/'+i.name+'/audio.ogg';s.lifelog.autoTranscribe=false;
 let item;if(local){item={name:f.source.name,created:f.source.started,ended:noMeta?0:f.source.ended,seconds:noMeta?0:1.2,bytes:f.source.audioBytes,ogg:true,raw:false,wav:false,complete:true,sealed:!legacy,committedFrames:legacy?0:20,interrupted:false,hasText:false};s.lifelog.items=[item];s.lifelog.saveSegmentResult=(d,md,json)=>{if(s.lifelog.failSave)throw Error('synthetic mirror failure');fs.writeFileSync(d+'/text.md',md);fs.writeFileSync(d+'/transcript.json',json);item.hasText=true;};}
 else{item={name:f.source.name,created:f.source.started,bytes:f.source.audioBytes,complete:true,rawAvailable:true,textFile:'existing.md'};s.recordings.items=[item];}
 if(queueModule){const queue=new queueModule.LocalAsrQueue();queue.initialize(f.root);const d=s.lifelog.rootPath()+'/'+item.name,row=queue.enqueue(d,d+'/audio.ogg',item.created,'lifelog',false);queue.transition(row.jobId,'queued','window_budget_exhausted',Date.now()+60000);}
 let workerEnsures=0;s.startRecordingServices(f.root,()=>workerEnsures++,()=>{},false);
 t.after(()=>s.stopRecordingServices());return {...f,...s,item,probe,cloudPending,cloudCalls,cancelled:()=>cancelled,workerEnsures:()=>workerEnsures,
  queueDisk:()=>{const q=new queueModule.LocalAsrQueue();q.initialize(f.root);return q;}};
}
const until=async predicate=>{for(let i=0;i<1000;i++){if(predicate())return;await new Promise(r=>setTimeout(r,2));}throw Error('synthetic test did not reach deferred recognition');};
const manualFull={frames:20,seconds:1.2,speechSeconds:0.8,speakerProcessing:'processed',boundaryProcessing:'token_starts',utterances:[{start:0.1,end:0.9,text:'合成完整文字',speaker:0}],speakers:[{index:0,name:'合成角色',bio:'合成资料'}]};

test('prompter ownership preserves a queued source and explicit post-exit wake starts it without a minute polling delay',async()=>{
 let occupied=true;const probe={foreground:true,background:{active:false},voice:{active:false},features:{state:{connected:true},displayActive:false},prompterOccupied:()=>occupied,auth:{sendBusiness:async()=>{}}};
 const s=setup(false,{'./ProbeSession':{probeSession:probe}});s.recordings.items=[{name:'a',complete:true,bytes:240,rawAvailable:true}];s.startRecordingServices('/app');s.enqueueLocalTranscribe('/app/recordings/a','record',1,'recording',true);await settle();assert.equal(s.calls.length,0);assert.equal(s.localQueueSize(),1);assert.match(s.localTranscriptionState('/app/recordings/a'),/提词/);
 occupied=false;s.resumePendingTranscriptions();await settle();assert.deepEqual(s.calls,['/app/recordings/a/source.rawopus']);assert.equal(s.interactiveTranscriptionBusy(),true);s.stopRecordingServices();
});

test('normal local material correction reads and exports the canonical head across restart without rewriting model/audio or resuming old windows',async t=>{
 const s=setupManualService(t,{local:true,realQueue:true}),run=s.transcribeLifelogManual(s.item,true);await until(()=>s.pending.length===1);s.pending.shift().resolve(manualFull);await run;
 const base=s.localMaterialRevision('lifelog',s.item.name),audio=fs.readFileSync(s.oggPath),legacy=fs.readFileSync(s.directory+'/transcript.json');
 const op=new s.MaterialSpeakerCorrection();Object.assign(op,{operation_id:'normal-page-label-operation',kind:'rename',speaker_id:base.speakers[0].speaker_id,label:'本段主持'});
 const saved=s.correctLocalMaterial('lifelog',s.item.name,base.revision,op);assert.equal(saved.revision,3);assert.match(s.localMaterialText('lifelog',s.item.name),/本段主持/);
 assert.match(fs.readFileSync(s.localMaterialExportPath('lifelog',s.item.name),'utf8'),/本段主持/);
 assert.equal(JSON.parse(fs.readFileSync(s.localMaterialExportPath('lifelog',s.item.name,'json'),'utf8')).revision,3);
 assert.deepEqual(fs.readFileSync(s.oggPath),audio);assert.deepEqual(fs.readFileSync(s.directory+'/transcript.json'),legacy);
 const same=s.correctLocalMaterial('lifelog',s.item.name,base.revision,op);assert.equal(same.revision,saved.revision);assert.equal(s.store.read(base.material_id).revision,3);
 s.stopRecordingServices();s.startRecordingServices(s.root,()=>{},()=>{},false);s.lifelog.autoTranscribe=true;s.advance(60001);s.ticks.at(-1)();await settle();
 assert.equal(s.windowCalls.length,0);assert.equal(s.calls.length,1);assert.equal(s.localMaterialRevision('lifelog',s.item.name).revision,3);
 assert.throws(()=>s.store.appendTranscript(base.material_id,3,s.input,'late-asr'),/USER_REVISION_PROTECTED/);
});
test('normal correction rejects changed source, stale revision and background lifetime while keeping the confirmed head',async t=>{
 const s=setupManualService(t,{local:true}),run=s.transcribeLifelogManual(s.item,true);await until(()=>s.pending.length===1);s.pending.shift().resolve(manualFull);await run;
 const base=s.localMaterialRevision('lifelog',s.item.name),op=new s.MaterialSpeakerCorrection();Object.assign(op,{operation_id:'normal-source-guard-operation',kind:'rename',speaker_id:base.speakers[0].speaker_id,label:'正确来源'});
 s.item.bytes++;assert.throws(()=>s.correctLocalMaterial('lifelog',s.item.name,2,op),/SOURCE_CHANGED/);s.item.bytes--;
 s.probe.foreground=false;assert.throws(()=>s.correctLocalMaterial('lifelog',s.item.name,2,op),/LIFETIME/);s.probe.foreground=true;
 s.correctLocalMaterial('lifelog',s.item.name,2,op);const stale=new s.MaterialSpeakerCorrection();Object.assign(stale,{...op,operation_id:'normal-stale-guard-operation',label:'迟到更正'});
 assert.throws(()=>s.correctLocalMaterial('lifelog',s.item.name,2,stale),/REVISION_CONFLICT/);assert.match(s.store.read(base.material_id).text,/正确来源/);assert.equal(s.store.read(base.material_id).revision,3);
});
test('real lifelog directory refresh after original audio removal preserves verified capture extent and permits text-only correction',async t=>{
 const s=setupManualService(t,{local:true}),run=s.transcribeLifelogManual(s.item,true);await until(()=>s.pending.length===1);s.pending.shift().resolve(manualFull);await run;
 const base=s.store.read(s.store.idFor('lifelog',s.item.name));
 fs.writeFileSync(s.directory+'/meta.json',JSON.stringify({version:2,started:1000,ended:2200,frames:20,sealed:true}));fs.unlinkSync(s.oggPath);
 const {LifelogSession}=loadApp('LifelogSession',{'@kit.AbilityKit':{},'@kit.CoreFileKit':{fileIo:s.io},'libturbo_audio.so':{}}),real=new LifelogSession(async()=>{},()=>'',()=>true);real.initialize({filesDir:s.root});
 assert.equal(real.items.length,1);assert.equal(real.items[0].complete,false);assert.equal(real.items[0].bytes,0);assert.equal(real.items[0].hasText,true);
 s.lifelog.refresh=()=>{real.refresh();s.lifelog.items=real.items;};
 const missing=s.localMaterialRevision('lifelog',s.item.name);assert.equal(missing.source.audioAvailable,false);assert.equal(missing.source.complete,true);
 assert.equal(missing.transcription_state,'complete');assert.equal(missing.covered_ms,1200);assert.equal(missing.source.audioBytes,base.source.audioBytes);assert.equal(missing.source.audioFrames,20);assert.equal(missing.audio_checksum_state,'unavailable');
 const op=new s.MaterialSpeakerCorrection();Object.assign(op,{kind:'rename',operation_id:'missing-lifelog-text-operation',speaker_id:missing.speakers[0].speaker_id,label:'仅文字校正'});
 const next=s.correctLocalMaterial('lifelog',s.item.name,missing.revision,op);assert.match(next.text,/仅文字校正/);assert.equal(next.source.audioAvailable,false);assert.equal(next.transcription_state,'complete');
  // Session also hides zero/corrupt audio. Its false flags alone must not be
  // mistaken for a removed original file and restore historical completeness.
  fs.writeFileSync(s.oggPath,Buffer.alloc(0));const invalid=new s.MaterialSpeakerCorrection();Object.assign(invalid,{...op,operation_id:'corrupt-existing-audio-operation',label:'禁止坏文件误写'});
  assert.throws(()=>s.correctLocalMaterial('lifelog',s.item.name,next.revision,invalid),/SOURCE_CHANGED/);fs.unlinkSync(s.oggPath);
 const before=next.revision;fs.writeFileSync(s.directory+'/meta.json',JSON.stringify({version:2,started:1000,ended:2200,frames:20,sealed:false}));
 const rejected=new s.MaterialSpeakerCorrection();Object.assign(rejected,{...op,operation_id:'interrupted-missing-source-operation',label:'禁止误写'});
 assert.throws(()=>s.correctLocalMaterial('lifelog',s.item.name,before,rejected),/SOURCE_CHANGED/);assert.equal(s.store.read(base.material_id).revision,before);
});
test('real recording directory refresh with retained text does not erase completed source frame and coverage metadata',t=>{
 const s=setupManualService(t),base=s.store.read(s.store.idFor('recording',s.item.name));s.input.transcriptionState='complete';s.input.coveredMs=60000;s.input.sourceMs=60000;
 const full=s.store.appendTranscript(base.material_id,base.revision,s.input,'completed-recording-asr');
 fs.writeFileSync(s.directory+'/manifest.json',JSON.stringify({version:1,created:1000,valid:true}));fs.writeFileSync(s.directory+'/transcript-1.md','已保存模型文字');fs.unlinkSync(s.rawPath);fs.unlinkSync(s.wavPath);
 const {RecordingSession}=loadApp('RecordingSession',{'@kit.AbilityKit':{},'@kit.CoreFileKit':{fileIo:s.io},'libturbo_audio.so':{}}),real=new RecordingSession(async()=>{},()=>'',()=>true);real.initialize({filesDir:s.root});
 assert.equal(real.items.length,1);assert.equal(real.items[0].complete,false);assert.equal(real.items[0].bytes,0);assert.equal(real.items[0].rawAvailable,false);
 s.recordings.refresh=()=>{real.refresh();s.recordings.items=real.items;};const missing=s.localMaterialRevision('recording',s.item.name);
 assert.equal(missing.source.audioAvailable,false);assert.equal(missing.source.complete,true);assert.equal(missing.source.audioFrames,3000);assert.equal(missing.source.audioBytes,720000);assert.equal(missing.transcription_state,'complete');
 const op=new s.MaterialSpeakerCorrection();Object.assign(op,{kind:'rename',operation_id:'missing-recording-text-operation',speaker_id:full.utterances[0].speaker_id,label:'保留文字校正'});
 assert.match(s.correctLocalMaterial('recording',s.item.name,missing.revision,op).text,/保留文字校正/);
});

test('cloud service owns ASR config, real suspend invalidation, explicit cancel and stop fencing',async t=>{
 for(const mode of ['suspend','cancel','stop']){const s=setupManualService(t),config={token:'synthetic-private-token'};
 const p=s.transcribeRecordingCloud(s.item,config,true);await until(()=>s.cloudPending.length===1);assert.equal(s.cloudCalls[0].c,config);
 if(mode==='suspend'){s.probe.foreground=false;s.probe.onFileTranscriptionSuspend();s.probe.foreground=true;}else if(mode==='cancel')s.cancelRecordingCloudTranscription();else s.stopRecordingServices();
 s.cloudPending[0].resolve('迟到结果');await assert.rejects(p,/已停止|前台/);const head=s.store.read(s.store.idFor(s.source.kind,s.source.name));assert.equal(head.text,'');
 assert(s.cancelled()>=1);assert(!fs.readFileSync(s.root+'/recording-cloud-publication/'+head.material_id+'.json','utf8').includes(config.token));}
});
test('cloud ready survives cancellation and restart, resumes without ASR, and rejects active or missing source',async t=>{
 const s=setupManualService(t);s.recordings.failSave=true;const p=s.transcribeRecordingCloud(s.item,{},true);await until(()=>s.cloudPending.length===1);s.cloudPending[0].resolve('耐久云结果');assert.match(await p,/待补写/);
 s.cancelRecordingCloudTranscription();s.stopRecordingServices();s.startRecordingServices(s.root,()=>{},()=>{},false);s.recordings.failSave=false;
 assert.match(await s.transcribeRecordingCloud(s.item,{},true),/已就绪/);assert.equal(s.cloudCalls.length,1);
 s.recordings.active=true;await assert.rejects(s.transcribeRecordingCloud(s.item,{},true),/采集|完成状态/);s.recordings.active=false;s.recordings.items=[];await assert.rejects(s.transcribeRecordingCloud(s.item,{},true),/原音暂不可读/);
});
test('manual full uses the recovery worker only for recognition and supersedes queued same-source windows across restart',async t=>{
 const s=setupManualService(t,{local:true}),q=s.queueState(),directory=s.lifelog.rootPath()+'/'+s.item.name;
 q.rows.push({jobId:directory,directory,sourcePath:s.oggPath,started:1000,kind:'lifelog',forced:true,status:'queued',nextRun:Date.now()+60000,attempts:0,lastError:'window_budget_exhausted'});
 const p=s.transcribeLifelogManual(s.item,true);await until(()=>s.pending.length===1);assert.equal(s.workerEnsures(),1);assert.equal(s.windowCalls.length,0);
 s.lifelog.failSave=true;s.pending[0].resolve(manualFull);assert.match(await p,/待补写/);assert.equal(q.rows[0].status,'succeeded');assert.equal(q.rows[0].lastError,'manual_full_published');
 const id=s.store.idFor('lifelog',s.item.name),first=s.store.read(id);assert.equal(first.speaker_processing,'processed');assert.equal(first.transcription_state,'complete');
 s.lifelog.failSave=false;await s.transcribeLifelogManual(s.item,true);assert.equal(s.calls.length,1);assert.equal(s.workerEnsures(),1,'ready replay does not recover or load worker');
 s.stopRecordingServices();s.startRecordingServices(s.root,()=>{},()=>{},false);s.ticks.at(-1)();await settle();assert.equal(s.windowCalls.length,0);assert.equal(s.store.read(id).revision,first.revision);assert.equal(s.store.read(id).speaker_processing,'processed');
});
test('manual full legacy coverage is derived from OGG and page cancellation only invalidates publication without closing worker',async t=>{
 const s=setupManualService(t,{local:true,legacy:true});let closes=0;s.lifelogASR.close=()=>closes++;
 const p=s.transcribeLifelogManual(s.item,true);await until(()=>s.pending.length===1);s.cancelLifelogManualPublication();s.pending.shift().resolve(manualFull);await assert.rejects(p,/已停止/);assert.equal(closes,0);
 const retry=s.transcribeLifelogManual(s.item,true);await until(()=>s.pending.length===1);s.pending.shift().resolve(manualFull);await retry;
 const row=s.store.read(s.store.idFor('lifelog',s.item.name));assert.equal(row.transcription_state,'complete');assert.equal(row.speaker_processing,'processed');assert.equal(JSON.parse(fs.readFileSync(s.lifelog.rootPath()+'/'+s.item.name+'/transcript.json')).transcription_state,'complete');
});
test('two full-protected windows with persistent supersession write failures stay excluded with no drain loop',async t=>{
 const s=setupManualService(t,{local:true});const p=s.transcribeLifelogManual(s.item,true);await until(()=>s.pending.length===1);s.pending.shift().resolve(manualFull);await p;
 const q=s.queueState(),a=s.lifelog.rootPath()+'/'+s.item.name,b=s.lifelog.rootPath()+'/seg-'+'c'.repeat(32);let checks=0;
 s.lifelog.items.push({...s.item,name:'seg-'+'c'.repeat(32)});
 // This test injects the read-only exact publication proof; the real publisher
 // proof is covered above, while the regression targets multi-row drain logic.
 s.store.read=()=>({operation:'upsert',revision:2});
 const read=s.RecordingCloudPublication.prototype.hasCommittedLifelog;s.RecordingCloudPublication.prototype.hasCommittedLifelog=()=>true;t.after(()=>s.RecordingCloudPublication.prototype.hasCommittedLifelog=read);
 q.rows.push({jobId:a,directory:a,sourcePath:a+'/audio.ogg',started:1000,kind:'lifelog',status:'queued',nextRun:0},{jobId:b,directory:b,sourcePath:b+'/audio.ogg',started:1000,kind:'lifelog',status:'result_ready',nextRun:0});q.transition=()=>{checks++;throw Error('synthetic persistent supersession failure');};
 s.recoverLocalTranscriptions();s.lifelog.autoTranscribe=true;s.recoverLocalTranscriptions();await settle();const count=checks;
 for(let i=0;i<3;i++){s.ticks.at(-1)();await settle();assert.equal(checks,count);}assert(count<=2);assert.equal(s.localQueueSize(),0);assert.equal(s.windowCalls.length,0);
});
test('real durable queued job and old window checkpoint cannot downgrade manual full text after cold restart',async t=>{
 const s=setupManualService(t,{local:true,realQueue:true}),snapshot=await s.readSource(),job=s.queueDisk().all()[0];
 const {AsrWindowStore}=loadApp('AsrWindowStore',s.platform),windows=new AsrWindowStore();windows.initialize(s.root);
 windows.append(job.jobId,0,{windowed:true,windowStartFrame:0,windowEndFrame:10,frames:20,seconds:1.2,speechSeconds:0,sourcePrefixBytes:snapshot.wavBytes,sourcePrefixSha256:snapshot.wavSha256,utterances:[],speakers:[],speakerProcessing:'pending',boundaryProcessing:'no_speech'});
 const p=s.transcribeLifelogManual(s.item,true);await until(()=>s.pending.length===1);s.lifelog.failSave=true;s.pending.shift().resolve(manualFull);assert.match(await p,/待补写/);
 assert.equal(s.queueDisk().get(job.jobId).status,'succeeded');assert.equal(s.queueDisk().get(job.jobId).lastError,'manual_full_published');
 assert.throws(()=>s.queueDisk().transition(job.jobId,'queued'),/ASR_JOB_TERMINAL/);
 const id=s.store.idFor('lifelog',s.item.name),first=s.store.read(id);s.stopRecordingServices();s.startRecordingServices(s.root,()=>{},()=>{},false);s.advance(60001);s.ticks.at(-1)();await settle();
 assert.equal(s.windowCalls.length,0);assert.equal(s.store.read(id).revision,first.revision);assert.equal(s.store.read(id).speaker_processing,'processed');assert.equal(windows.resume(job.jobId).cursor,10,'old checkpoint remains evidence without being applied over full result');
});
test('no-meta legacy full keeps OGG-derived source extent through migration, queued fast windows and cold restart',async t=>{
 const s=setupManualService(t,{local:true,legacy:true,noMeta:true,realQueue:true}),job=s.queueDisk().all()[0];
 const p=s.transcribeLifelogManual(s.item,true);await until(()=>s.pending.length===1);s.lifelog.failSave=true;s.pending.shift().resolve(manualFull);await p;
 const id=s.store.idFor('lifelog',s.item.name),full=s.store.read(id);assert.equal(full.source.audioFrames,20);assert.equal(full.source.ended-full.source.started,1200);assert.equal(full.transcription_state,'complete');
 s.lifelog.autoTranscribe=true;s.advance(60001);s.ticks.at(-1)();await settle();
 assert.equal(s.store.read(id).revision,full.revision);assert.equal(s.store.read(id).speaker_processing,'processed');assert.equal(s.windowCalls.length,0);assert.equal(s.queueDisk().get(job.jobId).status,'succeeded');
 s.stopRecordingServices();s.startRecordingServices(s.root,()=>{},()=>{},false);s.ticks.at(-1)();await settle();
 assert.equal(s.store.read(id).revision,full.revision);assert.equal(s.store.read(id).source.audioFrames,20);assert.equal(s.windowCalls.length,0);
});
test('production recording and lifelog deletion hooks use the shared durable material store',()=>{
 const s=setup(false),sources=[],deletions=[];
 s.materials.ensure=source=>{sources.push(source);return {material_id:source.name,revision:1,operation:'upsert'};};
 s.materials.delete=(id,revision)=>{deletions.push([id,revision]);return {material_id:id,revision:2,operation:'delete'};};
 s.recordings.beforeRemove({name:'take-'+'a'.repeat(32),created:1000,bytes:240,complete:true,rawAvailable:true,textFile:''});
 s.lifelog.beforeRemove({name:'seg-'+'b'.repeat(32),created:1000,ended:1060,seconds:0.06,bytes:240,committedFrames:1,complete:true,ogg:true});
 assert.deepEqual(deletions,[[sources[0].name,1],[sources[1].name,1]]);
 assert.equal(sources[0].kind,'recording');assert.equal(sources[0].frameMs,20);
 assert.equal(sources[1].kind,'lifelog');assert.equal(sources[1].frameMs,60);
 assert.equal(sources[1].decodedChannels,0,'deletion does not invent a verified capture channel');
});

test('late recording ASR after deletion stops its job without claiming that deleted originals remain retryable',async()=>{
 const s=setup();s.recordings.items=[{name:'a',created:1,complete:true,textFile:'',bytes:240,rawAvailable:true}];
 s.recoverLocalTranscriptions();await settle();assert.equal(s.calls.length,1);
 s.materials.read=()=>({operation:'delete'});s.materials.appendTranscript=()=>{throw Error('MATERIAL_DELETED');};
 s.recordings.items=[];s.pending.shift().resolve({frames:1,seconds:0.02,utterances:[{}],speakers:[]});await settle();
 const row=s.queueState().rows[0];assert.equal(row.status,'cancelled');assert.equal(row.lastError,'material_deleted');
 assert.equal(s.events.length,0);assert.match(s.recordings.note,/资料已删除.*停止/);assert(!/保留|重试/.test(s.recordings.note));
 assert.match(s.localTranscriptionState('/app/recordings/a'),/资料已删除.*停止/);
 assert.equal(s.retryFailedLocalTranscribe('/app/recordings/a'),false);
 s.ticks[0]();await settle();assert.equal(s.calls.length,1);
});

test('late lifelog window after its source is deleted stops instead of queueing a publication retry',async()=>{
 const s=setup();s.lifelog.items=[{name:'a',created:1,ended:60001,seconds:60,bytes:240000,complete:true,ogg:true}];
 let resolve;s.windowSteps.push(new Promise(r=>resolve=r));s.recoverLocalTranscriptions();await settle();assert.equal(s.windowCalls.length,1);
 s.materials.read=()=>({operation:'delete'});s.lifelog.items=[];
 resolve({state:'complete',commitKey:'deleted-window',cursor:1000,result:{utterances:[],speakers:[],frames:1000,seconds:60,speechSeconds:0}});await settle();
 const row=s.queueState().rows[0];assert.equal(row.status,'cancelled');assert.equal(row.lastError,'material_deleted');
 assert.equal(s.events.length,0);assert.match(s.lifelog.note,/资料已删除.*停止/);assert(!/保留|重试/.test(s.lifelog.note));
 assert.equal(s.localQueueSize(),0);s.ticks[0]();await settle();assert.equal(s.windowCalls.length,1);
});

test('explicit retry and source rediscovery cannot revive a failed job belonging to a tombstone',()=>{
 const s=setup(),queue=s.queueState(),directory='/app/recordings/a';
 queue.rows.push({jobId:directory,directory,sourcePath:directory+'/source.rawopus',started:1,kind:'recording',forced:true,status:'failed',attempts:3,nextRun:0});
 s.materials.read=()=>({operation:'delete'});
 assert.equal(s.retryFailedLocalTranscribe(directory),false);assert.equal(queue.rows[0].status,'cancelled');
 s.enqueueLocalTranscribe(directory,directory+'/source.rawopus',1,'recording',true,true);
 assert.equal(queue.rows[0].status,'cancelled');assert.equal(s.calls.length,0);assert.equal(s.localQueueSize(),0);
 s.stopRecordingServices();s.startRecordingServices('/app');
 assert.match(s.localTranscriptionState(directory),/资料已删除.*停止/);assert(!/保留|重试/.test(s.localTranscriptionState(directory)));
});

test('a deferred lifelog window observes deletion immediately instead of claiming saved originals and scheduling retry',async()=>{
 const s=setup();s.lifelog.items=[{name:'a',created:1,ended:60001,seconds:60,bytes:240000,complete:true,ogg:true}];
 let resolve;s.windowSteps.push(new Promise(r=>resolve=r));s.recoverLocalTranscriptions();await settle();
 s.materials.read=()=>({operation:'delete'});s.lifelog.items=[];resolve({state:'waiting',reason:'waiting_audio'});await settle();
 assert.equal(s.queueState().rows[0].status,'cancelled');assert.equal(s.queueState().rows[0].lastError,'material_deleted');
 assert.equal(s.localQueueSize(),0);assert.equal(s.wakeTimers.size,0);assert.match(s.lifelog.note,/资料已删除.*停止/);
 assert(!/保存原音|保留|重试/.test(s.lifelog.note));
});

test('a deleted queued job does not spin or start inference if saving its stop state fails',async()=>{
 const s=setup(false),queue=s.queueState(),directory='/app/recordings/a';let attempts=0;
 queue.rows.push({jobId:directory,directory,sourcePath:directory+'/source.rawopus',started:1,kind:'recording',forced:true,status:'queued',attempts:0,nextRun:0});
 s.materials.read=()=>({operation:'delete'});
 queue.transition=()=>{attempts++;throw Error('synthetic stop publication failure');};
 s.startRecordingServices('/app');await settle();assert.equal(attempts,1);assert.equal(s.calls.length,0);assert.equal(s.localQueueSize(),0);
 assert.match(s.recordings.note,/资料已删除.*待保存/);assert(!/原件保留|可重试/.test(s.recordings.note));
});

test('an existing failed job maps to deleted at restart without requiring a user retry first',()=>{
 const s=setup(false),queue=s.queueState(),directory='/app/recordings/a';
 queue.rows.push({jobId:directory,directory,sourcePath:directory+'/source.rawopus',started:1,kind:'recording',forced:true,status:'failed',lastError:'publication_failed',attempts:3,nextRun:0});
 s.materials.read=()=>({operation:'delete'});s.startRecordingServices('/app');
 const state=s.localTranscriptionState(directory);assert.match(state,/资料已删除.*停止/);assert(!/保留|重试/.test(state));
 assert.equal(s.calls.length,0);
});

test('multiple deleted jobs with continuously failing stop persistence stay excluded through every refresh',async()=>{
 const s=setup(false),queue=s.queueState(),a='/app/recordings/a',b='/app/lifelog/b';let attempts=0;
 queue.rows.push({jobId:a,directory:a,sourcePath:a+'/source.rawopus',started:1,kind:'recording',forced:true,status:'queued',attempts:0,nextRun:0},
  {jobId:b,directory:b,sourcePath:b+'/audio.ogg',started:1,kind:'lifelog',forced:false,status:'result_ready',attempts:1,nextRun:0});
 s.materials.read=()=>({operation:'delete'});
 queue.transition=()=>{attempts++;throw Error('synthetic persistent stop write failure');};
 s.startRecordingServices('/app');await settle();assert.equal(attempts,2);
 for(let i=0;i<3;i++){await settle();s.ticks.at(-1)();await settle();assert.equal(attempts,2);}
 assert.equal(s.localQueueSize(),0);assert.equal(s.localQueuedDirectories().length,0);assert.equal(s.wakeTimers.size,0);
 assert.equal(s.calls.length,0);assert.equal(s.windowCalls.length,0);
 assert.match(s.localTranscriptionState(a),/停止状态待保存/);assert.match(s.localTranscriptionState(b),/停止状态待保存/);
 s.stopRecordingServices();await settle();assert.equal(attempts,2,'stop refresh also preserves the whole exclusion set');
 s.startRecordingServices('/app');await settle();assert.equal(attempts,4,'an explicit new lifecycle performs one bounded check per deleted job');
 await settle();s.ticks.at(-1)();await settle();assert.equal(attempts,4);assert.equal(s.localQueueSize(),0);
 assert.deepEqual(queue.rows.map(row=>row.status),['queued','result_ready'],'failed writes retain original durable evidence');
});

test('late recording completion against a real tombstone remains bounded if saving cancelled fails',async t=>{
 const f=setupMaterialStore(t),s=setup(false),queue=s.queueState(),name=f.source.name,directory='/app/recordings/'+name;
 s.materials.idFor=f.store.idFor.bind(f.store);s.materials.read=f.store.read.bind(f.store);
 s.materials.ensure=source=>f.store.ensure(Object.assign(new f.MaterialSource(),source));
 s.materials.appendTranscript=f.store.appendTranscript.bind(f.store);
 const diagnostics=[];s.lifelogASR.log=(event)=>diagnostics.push(event);
 s.recordings.items=[{name,created:1000,complete:true,textFile:'',bytes:240,rawAvailable:true}];
 s.startRecordingServices('/app');await settle();assert.equal(s.calls.length,1);
 const id=f.store.idFor('recording',name),current=f.store.read(id);f.store.delete(id,current.revision);s.recordings.items=[];
 const transition=queue.transition.bind(queue);let attempts=0;
 queue.transition=(id,status,...args)=>{if(status==='cancelled'){attempts++;throw Error('synthetic stop publication failure');}return transition(id,status,...args);};
 s.pending.shift().resolve({frames:1,seconds:0.02,utterances:[],speakers:[]});await settle();
 assert(attempts>=1&&attempts<=2);const settledAttempts=attempts;await settle();assert.equal(attempts,settledAttempts);
 assert.equal(s.calls.length,1);assert.equal(s.events.length,0);assert.equal(s.localQueueSize(),0);
 assert.equal(queue.rows[0].status,'result_ready','failed cancellation preserves the sealed result for reconciliation');
 assert.equal(f.store.read(id).operation,'delete');assert.match(s.recordings.note,/资料已删除.*待保存/);
 assert(!/原件保留|可重试/.test(s.recordings.note));assert(diagnostics.includes('deleted-stop-persist-failed'));
});

test('queue deduplicates work and prioritizes recordings without a blanket charging gate',async()=>{
 const s=setup();s.recordings.items=[{name:'a',complete:true,bytes:240,rawAvailable:true}];s.lifelog.items=[{name:'a',complete:true,bytes:240,created:1,ended:60,seconds:0.06}];s.lifelogASR.busy=true;
 s.enqueueLocalTranscribe('/app/lifelog/a','life',1,'lifelog',false);s.enqueueLocalTranscribe('/app/recordings/a','record',1,'recording',true);s.enqueueLocalTranscribe('/app/recordings/a','record',1,'recording',true);
 assert.equal(s.localQueueSize(),2);s.lifelogASR.busy=false;s.ticks[0]();await settle();assert.deepEqual(s.calls,['record']);assert.equal(s.localQueueSize(),1);assert.equal(s.localQueueNeedsCharge(),false);assert.deepEqual(s.pruned,[]);
});
test('recovery finds durable recordings without text; completed or previously failed items are not repeated',async()=>{
 const s=setup();s.recordings.items=[{name:'a',complete:true,textFile:''},{name:'b',complete:true,textFile:'saved.md'}];s.recoverLocalTranscriptions();s.recoverLocalTranscriptions();await settle();assert.equal(s.calls.length,1);
 s.pending.shift().resolve({frames:1,seconds:0.02,utterances:[]});await settle();assert.equal(s.recordings.items[0].textFile,'transcript-1.md');assert.match(s.recordings.note,/未检测到有效语音/);s.recoverLocalTranscriptions();assert.equal(s.calls.length,1);
});
test('write failures stay visible and recoverable without a hot retry loop',async()=>{
 const s=setup();s.recordings.items=[{name:'a',complete:true,textFile:''}];s.recordings.failSave=true;s.recoverLocalTranscriptions();await settle();s.pending.shift().resolve({frames:1,seconds:0.02,utterances:[{}]});await settle();assert.match(s.recordings.note,/disk-full/);assert.match(s.localTranscriptionState('/app/recordings/a'),/重试/);
 s.ticks[0]();assert.equal(s.calls.length,1);s.recordings.failSave=false;s.enqueueLocalTranscribe('/app/recordings/a','/app/recordings/a/source.rawopus',1,'recording',true);await settle();assert.equal(s.calls.length,1,'publication retry uses sealed result');assert.equal(s.recordings.items[0].textFile,'transcript-1.md');
});
test('recording hooks pause and automatically resume day capture',async()=>{
 const s=setup();await s.recordings.beforeStart();s.recordings.onSessionEnded();await settle();assert.deepEqual(s.events,['pause','resume']);
});
test('local recording failure cannot resume lifelog while cleanup or native writes remain occupied',async()=>{
 for(const key of ['cleanupRequired','pendingWrites']){const s=setup();s.recordings[key]=true;s.recordings.onSessionEnded();await settle();assert.deepEqual(s.events,[]);
  s.recordings[key]=false;s.recordings.onSessionEnded();await settle();assert.deepEqual(s.events,['resume']);s.stopRecordingServices();}
});
test('unresolved recording cleanup and native writes defer automatic ASR without starting a worker job',async()=>{
 for(const key of ['cleanupRequired','pendingWrites']){const s=setup();s.recordings[key]=true;s.recordings.items=[{name:'a',created:1,complete:true,textFile:'',bytes:240,rawAvailable:true}];
  s.recoverLocalTranscriptions();await settle();assert.equal(s.calls.length,0);assert.equal(s.localQueueSize(),1);
  s.recordings[key]=false;s.recordings.onSessionEnded();await settle();assert.equal(s.calls.length,1);s.stopRecordingServices();}
});
test('lifelog cleanup and native writes defer work while normal active lifelog prefixes remain eligible',async()=>{
 for(const state of ['active','cleanup','write']){const s=setup();s.lifelog.active=state==='active';s.lifelog.occupied=true;s.lifelog.pendingWrites=state==='write';
  s.lifelog.items=[{name:'a',complete:true,ogg:true,created:1,ended:60001,seconds:60,bytes:240000}];s.windowSteps.push({state:'waiting',reason:'waiting_audio'});
  s.recoverLocalTranscriptions();await settle();assert.equal(s.windowCalls.length,state==='active'?1:0);if(state==='active')assert.equal(s.windowCalls[0][5].interactiveAudio,false);s.stopRecordingServices();}
});

test('automatic lifelog uses window pipeline without charger; current conditions and publication are separate',async()=>{
 const s=setup();s.lifelog.items=[{name:'a',complete:true,ogg:true,created:1,ended:60001,seconds:60,bytes:240000}];
 s.windowSteps.push({state:'complete',commitKey:'life-window-1000',cursor:1000,result:{utterances:[],speakers:[],frames:1000,seconds:60,speechSeconds:0}});
 s.recoverLocalTranscriptions();await settle();assert.equal(s.windowCalls.length,1);assert.equal(s.calls.length,0,'never invokes whole-segment lifelog ASR');
 const conditions=s.windowCalls[0][5];assert.equal(conditions.charging,false);assert.equal(conditions.foreground,true);assert.equal(conditions.workerReady,true);
 assert.deepEqual(s.events,['material-saved','life-saved']);assert.equal(s.localQueueSize(),0);
});

test('window admission defers work visibly without counting it as completed or spinning',async()=>{
 const s=setup();s.lifelog.items=[{name:'a',complete:true,ogg:true,created:1,ended:60001,seconds:60,bytes:240000}];
 s.windowSteps.push({state:'waiting',reason:'battery_low_or_unknown'});s.recoverLocalTranscriptions();await settle();
 assert.equal(s.windowCalls.length,1);assert.equal(s.events.length,0);assert.equal(s.localQueueSize(),1);
 assert.match(s.localTranscriptionState('/app/lifelog/a'),/电量/);s.ticks[0]();await settle();assert.equal(s.windowCalls.length,1);
});

test('window publication carries explicit processed-prefix coverage independently of sealed audio',async()=>{
 const s=setup();s.lifelog.items=[{name:'a',complete:true,ogg:true,created:1,ended:60001,seconds:60,bytes:240000,committedFrames:1000}];
 s.windowSteps.push({state:'published',commitKey:'life-window-167',cursor:167,result:{utterances:[],speakers:[],frames:1000,seconds:60,speechSeconds:0,speakerProcessing:'pending'}});
 s.recoverLocalTranscriptions();await settle();const input=s.materialWrites[0].input;
 assert.equal(input.transcriptionState,'partial');assert.equal(input.coveredMs,10020);assert.equal(input.sourceMs,60000);assert.equal(input.speakerProcessing,'pending');
 s.stopRecordingServices();
});

test('full recording publication measures all processed frames including silence',async()=>{
 const s=setup();s.recordings.items=[{name:'a',created:1,complete:true,textFile:'',bytes:240000,rawAvailable:true}];
 s.recoverLocalTranscriptions();await settle();s.pending.shift().resolve({frames:1000,seconds:20,utterances:[],speakers:[]});await settle();
 assert.equal(s.materialWrites[0].input.transcriptionState,'complete');assert.equal(s.materialWrites[0].input.coveredMs,20000);
 assert.equal(s.materialWrites[0].input.sourceMs,20000);s.stopRecordingServices();
});

test('interactive audio interrupts only the current lifelog worker and preserves the queued source',async()=>{
 const s=setup(false);let reject,interrupted=0;
 s.startRecordingServices('/app',()=>{},()=>{interrupted++;reject(Error('worker_closed_for_voice'));});
 s.lifelog.items=[{name:'a',complete:true,ogg:true,created:1,ended:60001,seconds:60,bytes:240000}];
 s.windowSteps.push(new Promise((_resolve,r)=>reject=r));s.recoverLocalTranscriptions();await settle();
 assert.equal(s.windowCalls.length,1);s.prepareInteractiveAudio();s.prepareInteractiveAudio();await settle();
 assert.equal(interrupted,1);assert.equal(s.localQueueSize(),1);assert.equal(s.events.length,0);
 assert.match(s.localTranscriptionState('/app/lifelog/a'),/优先处理/);assert(!s.lifelog.note.includes('未完成'));
});

test('import is inert; repeated Ability start owns one timer and stop fences late inference',async()=>{
 const s=setup(false);assert.equal(s.ticks.length,0);
 s.recordings.items=[{name:'a',complete:true,textFile:''}];s.startRecordingServices('/app');s.startRecordingServices('/app');
 await settle();assert.equal(s.ticks.length,1);assert.equal(s.calls.length,1);
 s.stopRecordingServices();s.stopRecordingServices();assert.deepEqual(s.cleared,[1]);
 s.ticks[0]();assert.equal(s.calls.length,1);assert.equal(s.localQueueSize(),1);
 s.startRecordingServices('/app');await settle();assert.equal(s.calls.length,2);
 s.pending[0].resolve({frames:1,seconds:0.02,utterances:[{}]});await settle();assert.equal(s.events.length,0);
 assert.equal(s.localCurrentDirectory(),'/app/recordings/a','old completion must not clear new work');
 s.pending[1].resolve({frames:1,seconds:0.02,utterances:[{}]});await settle();assert.equal(s.events.length,2);
 s.stopRecordingServices();s.recordings.onSessionEnded();await settle();assert.equal(s.events.length,2,'destroy does not resume capture');
});

test('explicit retry revives only failed persisted jobs and reports a failed queue write',()=>{
 const s=setup(),queue=s.queueState();s.lifelogASR.busy=true;
 queue.rows.push({jobId:'failed',directory:'/app/lifelog/failed',sourcePath:'/app/lifelog/failed/audio.ogg',started:1,kind:'lifelog',forced:false,status:'failed',attempts:3,nextRun:0},
  {jobId:'cancelled',directory:'/app/lifelog/cancelled',sourcePath:'/app/lifelog/cancelled/audio.ogg',started:1,kind:'lifelog',status:'cancelled'});
 queue.failRetry=true;assert.equal(s.retryFailedLocalTranscribe('/app/lifelog/failed'),false);assert.equal(queue.rows[0].status,'failed');
 queue.failRetry=false;assert.equal(s.retryFailedLocalTranscribe('/app/lifelog/failed'),true);assert.equal(queue.rows[0].status,'queued');
 assert.equal(s.retryFailedLocalTranscribe('/app/lifelog/cancelled'),false);assert.equal(queue.rows[1].status,'cancelled');
 assert.equal(s.retryFailedLocalTranscribe('/app/lifelog/missing'),false);s.stopRecordingServices();assert.equal(s.retryFailedLocalTranscribe('/app/lifelog/failed'),false);
});

test('budget expiry wakes the durable queue without waiting for maintenance or running early',async()=>{
 const s=setup(),at=s.now()+18750;s.lifelog.items=[{name:'a',complete:true,ogg:true,created:1,seconds:60,bytes:240000}];
 s.windowSteps.push({state:'waiting',reason:'window_budget_exhausted',retryAt:at},
  {state:'complete',commitKey:'window-1000',cursor:1000,result:{utterances:[],speakers:[],frames:1000,seconds:60,speechSeconds:0}});
 s.recoverLocalTranscriptions();await settle();assert.equal(s.windowCalls.length,1);assert.equal(s.wakeTimers.size,1);
 assert.equal([...s.wakeTimers.values()][0].at,at);assert.equal(s.queueState().rows[0].nextRun,at);
 s.advance(18749);s.fireWake();await settle();assert.equal(s.windowCalls.length,1);
 s.advance(1);s.fireWake();await settle();assert.equal(s.windowCalls.length,2);assert.equal(s.localQueueSize(),0);assert.equal(s.wakeTimers.size,0);
 s.stopRecordingServices();
});

test('recording retry uses its durable due time; stop cancels wake and stale callback cannot enter new lifetime',async()=>{
 const s=setup();s.recordings.items=[{name:'a',complete:true,textFile:''}];s.recoverLocalTranscriptions();await settle();
 s.pending.shift().reject(Error('synthetic-inference-error'));await settle();assert.equal(s.wakeTimers.size,1);
 const old=[...s.wakeTimers.values()][0];assert.equal(old.at,s.now()+30000);
 s.stopRecordingServices();assert.equal(s.wakeTimers.size,0);s.startRecordingServices('/app');await settle();assert.equal(s.wakeTimers.size,1);
 s.advance(30000);old.f();await settle();assert.equal(s.calls.length,1,'old callback must not consume the new lifetime timer');
 s.fireWake();await settle();assert.equal(s.calls.length,2);assert.equal(s.wakeTimers.size,0);
 s.pending.shift().resolve({frames:1,seconds:.02,utterances:[]});await settle();s.stopRecordingServices();
});

test('unknown admission conditions retain bounded fallback and repeated recovery owns one wake',async()=>{
 const s=setup();s.lifelog.items=[{name:'a',complete:true,ogg:true,created:1,seconds:60,bytes:240000}];
 s.windowSteps.push({state:'waiting',reason:'thermal_limited_or_unknown'});s.recoverLocalTranscriptions();await settle();
 assert.equal(s.queueState().rows[0].nextRun,s.now()+60000);const ids=[...s.wakeTimers.keys()];
 s.recoverLocalTranscriptions();s.ticks[0]();await settle();assert.deepEqual([...s.wakeTimers.keys()],ids);assert.equal(s.windowCalls.length,1);
 s.stopRecordingServices();assert.equal(s.wakeTimers.size,0);
});
