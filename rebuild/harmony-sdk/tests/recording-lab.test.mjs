import test from 'node:test';
import assert from 'node:assert/strict';
import {loadApp} from './load-app.mjs';

const labTake='take-'+ 'a'.repeat(32);
function setup(journal=null,verified=true,deferredWindow=false) {
 const windowPending=[];let checkpoint={cursor:0,windows:[]};const calls=[]; const timers=new Map(); let timerId=0;
 const writes=[];
 const probe={foreground:true,connection:{phase:'ready'},peerDeviceId:'test-peer',
  auth:{sendBusiness:async()=>{}},voice:{active:false},features:{displayActive:false},
  background:{active:false,start:async()=>{probe.background.active=true;},
   stop:async()=>{probe.background.active=false;calls.push('lease-stop');}},
  stop:()=>calls.push('connection-stop')};
 class Recorder {
  active=false;busy=false;items=journal&&verified?[{name:labTake,complete:true,bytes:240}]:[];note='';bytes=0;
  initialize(context,isolated){calls.push(['initialize',context.filesDir,isolated]);}
  async start(){this.active=true;calls.push('start');this.changed();}
  async stop(){calls.push('stop-request');}
  findByDirectory(){return {complete:true,bytes:240,name:'take-test'};}
  disconnected(){this.active=false;}
  file(){return '/files/p12-recording-lab/'+labTake+'/source.rawopus';}
  directoryOf(){return '/files/p12-recording-lab/'+labTake;}
 }
 const {RecordingLabSession}=loadApp('RecordingLabSession',{
  './ProbeSession':{probeSession:probe},'./BackgroundLabSession':{backgroundLab:{active:false}},
  './RecordingSession':{RecordingSession:Recorder},
  './AsrWindowStore':{AsrWindowStore:class{initialize(){calls.push('window-store-init');}resume(){return checkpoint;}append(_id,_cursor,result){calls.push('window-saved');checkpoint={cursor:result.windowEndFrame,windows:[result]};return checkpoint;}}},
  './AsrEngine':{AsrEngineClient:class{async transcribeWindow(_path,_kind,request){calls.push(['window-infer',request.cursor]);if(deferredWindow)return new Promise(r=>windowPending.push(r));return {windowEndFrame:1,utterances:[],speakers:[]};}async transcribe(){calls.push('transcribe');throw Error('synthetic_engine_failure');}close(){calls.push('engine-close');}}},
  '@kit.CoreFileKit':{fileIo:{OpenMode:{CREATE:1,READ_WRITE:2,TRUNC:4},accessSync:p=>p.endsWith('p12-recording-state.json')&&!!journal,
   statSync:()=>({size:journal?JSON.stringify(journal).length:0}),readTextSync:()=>JSON.stringify(journal),
   openSync:()=>({fd:1}),writeSync:(_fd,text)=>writes.push(JSON.parse(text)),fsyncSync:()=>{},closeSync:()=>{},
   renameSync:()=>calls.push('atomic-promote'),mkdirSync:()=>{}}},
  './LifelogASR':{lifelogMarkdown:()=>''},
  './TranscriptionSignals':{readTranscriptionSignals:async()=>({conditions:{},screenKnown:true,screenActive:false})},
  './TranscriptionBudget':{admitTranscription:()=>({allowed:true})},
 },{setTimeout:(fn,ms)=>{const id=++timerId;timers.set(id,{fn,ms});return id;},
  clearTimeout:id=>timers.delete(id),setInterval:()=>++timerId,clearInterval:()=>{}});
 const lab=new RecordingLabSession();lab.initialize({filesDir:'/files'});
 return {lab,probe,calls,timers,writes,windowPending};
}

test('lab isolates storage and rejects incomplete audio before inference',async()=>{
 const s=setup();assert.deepEqual(s.calls[0],['initialize','/files',true]);
 await s.lab.transcribe();assert.equal(s.calls.includes('transcribe'),false);
 await s.lab.start();assert.equal(s.calls.includes('start'),false,'model readiness required');
});

test('explicit lab start has a bounded capture and closure never auto-transcribes',async()=>{
 const s=setup();s.lab.modelReady=true;await s.lab.start();
 assert.equal(s.probe.background.active,true);
 const limit=[...s.timers.values()].find(t=>t.ms===60000);assert.ok(limit);
 limit.fn();await Promise.resolve();assert.ok(s.calls.includes('stop-request'));
 s.lab.recorder.active=false;s.lab.recorder.onRecordingClosed('/files/p12-recording-lab/take-test','',0);
 await new Promise(setImmediate);
 assert.equal(s.lab.phase,'recorded');assert.equal(s.probe.background.active,false);
 assert.equal(s.calls.includes('transcribe'),false);
 assert.equal(s.calls.includes('connection-stop'),false,'foreground retains the lab connection');
});

test('screen-off closure releases its lease and closes the unqualified connection',async()=>{
 const s=setup();s.lab.modelReady=true;await s.lab.start();s.probe.foreground=false;
 s.lab.recorder.active=false;s.lab.recorder.onRecordingClosed('/files/p12-recording-lab/take-test','',0);
 await new Promise(setImmediate);
 assert.equal(s.probe.background.active,false);assert.ok(s.calls.includes('connection-stop'));
 assert.equal(s.lab.phase,'recorded');
});

function saved(replays=[]){return {schema:1,kind:'p12_explicit_recording',take:labTake,complete:true,bytes:240,replays,samples:[],channels:[]};}
test('process restart restores only verified lab audio and marks queued work interrupted without executing it',()=>{
 const s=setup(saved([{status:'queued',created:1,samples:[],channels:[]}]))
 assert.equal(s.lab.hasTake,true);assert.equal(s.lab.phase,'recorded');assert.equal(s.lab.modelReady,false);
 assert.equal(s.writes.at(-1).replays[0].status,'interrupted');assert.equal(s.writes.at(-1).replays[0].error,'process_interrupted');
 assert.equal(s.calls.includes('transcribe'),false);assert.equal(s.probe.background.active,false);assert.equal(s.timers.size,0);
 assert.ok(s.calls.includes('atomic-promote'));
 const invalid=setup({...saved(),take:'../recordings/take-private'});
 assert.equal(invalid.lab.hasTake,false);assert.equal(invalid.calls.includes('transcribe'),false);
 assert.equal(setup(saved(),false).lab.hasTake,false,'journal alone cannot prove complete audio');
});

test('cancelling deferred recognition releases only its own lease and never begins inference',async()=>{
 const s=setup(saved());s.lab.modelReady=true;
 const pending=s.lab.transcribe(true);await new Promise(setImmediate);
 assert.ok([...s.timers.values()].some(t=>t.ms===20000));assert.equal(s.calls.includes('transcribe'),false);
 s.lab.cancelTranscription();await pending;
 assert.equal(s.lab.phase,'recorded');assert.equal(s.lab.hasTake,true);assert.equal(s.lab.modelReady,false);
 assert.equal(s.probe.background.active,false);assert.equal(s.calls.includes('transcribe'),false);
 assert.equal(s.writes.at(-1).replays[0].status,'cancelled');
});

test('inference failure retains a recoverable audio item and requires a fresh worker',async()=>{
 const s=setup(saved());s.lab.modelReady=true;await s.lab.transcribe();
 assert.equal(s.lab.phase,'failed');assert.equal(s.lab.hasTake,true);assert.equal(s.lab.modelReady,false);
 assert.ok(s.calls.includes('engine-close'));assert.equal(s.writes.at(-1).replays[0].status,'failed');
 assert.equal(s.writes.at(-1).replays[0].error,'synthetic_engine_failure');
});

test('long background inference retains stage boundaries after periodic sampling is full',async()=>{
 const s=setup(saved());const run={samples:Array.from({length:100},()=>({stage:'mix'}))};
 await s.lab.sampleReplay(run,'left');assert.equal(run.samples.length,100);
 for(const stage of ['left_end','right_begin','right_end','finished'])await s.lab.sampleReplay(run,stage);
 assert.deepEqual(run.samples.slice(100).map(row=>row.stage),['left_end','right_begin','right_end','finished']);
});

test('window lab publishes one checkpoint and never automatically starts the next or repeats completion',async()=>{
 const s=setup(saved());s.lab.modelReady=true;await s.lab.transcribeOneWindow();
 assert(s.calls.includes('window-saved'));assert.equal(s.writes.at(-1).windows[0].cursorAfter,1);
 await s.lab.transcribeOneWindow();assert.equal(s.calls.filter(c=>Array.isArray(c)&&c[0]==='window-infer').length,1);
 assert.equal(s.writes.at(-1).windows[1].status,'already_complete');assert.equal(s.probe.background.active,false);
});
test('cancelled window inference never advances its checkpoint even if the old worker replies',async()=>{
 const s=setup(saved(),true,true);s.lab.modelReady=true;const work=s.lab.transcribeOneWindow();await new Promise(setImmediate);
 assert.equal(s.windowPending.length,1);s.lab.cancelTranscription();s.windowPending[0]({windowEndFrame:1,utterances:[],speakers:[]});await work;
 assert.equal(s.calls.includes('window-saved'),false);assert.equal(s.writes.at(-1).windows[0].status,'cancelled');assert.equal(s.lab.modelReady,false);
});
