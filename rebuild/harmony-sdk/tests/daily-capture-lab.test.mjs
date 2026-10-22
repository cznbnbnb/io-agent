import test from 'node:test';import assert from 'node:assert/strict';import {loadApp} from './load-app.mjs';
const settle=async()=>{for(let i=0;i<30;i++)await Promise.resolve();};
function setup(){
 const calls=[],files=new Map(),dirs=new Set(),handles=new Map(),timers=new Map();let fd=0,timer=0,root='',queue=0;
 const io={OpenMode:{CREATE:1,WRITE_ONLY:2,TRUNC:4},accessSync:p=>files.has(p)||dirs.has(p),mkdirSync:p=>dirs.add(p),statSync:p=>({size:files.get(p)?.length||0}),readTextSync:p=>new TextDecoder().decode(files.get(p)),listFileSync:()=>[],openSync:p=>{handles.set(++fd,p);files.set(p,new Uint8Array());return{fd};},closeSync(){},writeSync:(fd,b)=>{const p=handles.get(fd),old=files.get(p),bytes=new Uint8Array(b),out=new Uint8Array(old.length+bytes.length);out.set(old);out.set(bytes,old.length);files.set(p,out);return bytes.length;},fsyncSync(){},copyFileSync:(a,b)=>files.set(b,files.get(a).slice()),renameSync:(a,b)=>{files.set(b,files.get(a));files.delete(a);}};
 const lifelog={active:false,busy:false,items:[],bytes:0,rootPath:()=>root,initialize(_c,path,restore){root=path+'/lifelog';calls.push(['lifelog-init',path,restore]);},refresh(){},async start(mode){calls.push(['capture',mode]);this.active=true;},async stopDay(){calls.push(['stop-capture']);this.active=false;},dispose(){calls.push(['lifelog-dispose']);},disconnected(){this.active=false;}};
 const asr={log(){},ensureExtracted:async()=>{},initialize(){},busy:false};
 const probe={foreground:true,connection:{phase:'ready'},voice:{active:false},features:{displayActive:false},background:{active:false,async start(){this.active=true;calls.push(['lease-start']);},async stop(){this.active=false;calls.push(['lease-stop']);}}};
 class Engine{closed=false;async load(){calls.push(['load']);}isClosed(){return this.closed;}close(){this.closed=true;calls.push(['engine-close']);}}
 const {DailyCaptureLab}=loadApp('DailyCaptureLab',{'@kit.AbilityKit':{},'@kit.CoreFileKit':{fileIo:io},'./CodecWindowProbe':{CodecWindowProbe:class{run(){calls.push(['codec-probe']);return new Promise(r=>this.complete=r);}cancel(){calls.push(['codec-probe-cancel']);this.complete('cancelled');}}},'./WorkerExitProbe':{WorkerExitProbe:class{run(){calls.push(['exit-probe']);return new Promise(r=>this.complete=r);}cancel(){calls.push(['exit-probe-cancel']);this.complete('cancelled');}}},'./DailyLabSourceClone':{cloneDailyLabSource:(base,from,to,name)=>{calls.push(['clone-source',from,to,name]);dirs.add(to);return 'e'.repeat(64);}},'./ProbeSession':{probeSession:probe},'./AsrEngine':{AsrEngineClient:Engine},'./TranscriptionSignals':{readTranscriptionSignals:async()=>({conditions:{workerReady:true,thermalKnown:true,batteryPercent:60,freeBytes:1e9},thermalLevel:0})},'./TranscriptionBudget':loadApp('TranscriptionBudget'),'./RecordingService':{lifelog,lifelogASR:asr,recordings:{active:false,busy:false,initialize(_c,_lab,path){calls.push(['recordings-init',path]);}},startRecordingServices(...args){calls.push(['services',...args]);},stopRecordingServices(){calls.push(['services-stop']);},localCurrentDirectory:()=>'',localQueueSize:()=>queue,retryFailedLocalTranscribe:directory=>{calls.push(['retry-failed',directory]);return true;}}},{setInterval:(f,ms)=>{timers.set(++timer,{f,ms});return timer;},clearInterval:id=>timers.delete(id),setTimeout:(f,ms)=>{timers.set(++timer,{f,ms});return timer;},clearTimeout:id=>timers.delete(id)});
 const lab=new DailyCaptureLab(),context={filesDir:'/app'};lab.initialize(context);
 const fire=async(ms)=>{for(const t of [...timers.values()])if(t.ms===ms)t.f();await settle();};
 return{lab,context,DailyCaptureLab,calls,probe,files,dirs,lifelog,timers,fire,setQueue:n=>queue=n};
}
test('opening and preparing lab never starts capture or production services; start is explicit and isolated',async()=>{
 const s=setup();assert.equal(s.calls.length,0);await s.lab.start();assert.equal(s.calls.length,0);
 await s.lab.prepare();assert(s.lab.modelReady);assert(!s.calls.some(r=>r[0]==='capture'||r[0]==='services'));
 await s.lab.start();assert.equal(s.lifelog.active,true);const service=s.calls.find(r=>r[0]==='services');
 assert.match(service[1],/^\/app\/p22-daily-lab\/run-\d{13}$/);assert.equal(service[4],false,'remote daily summary explicitly disabled');
 assert(s.calls.some(r=>r[0]==='lifelog-init'&&r[2]===false),'persisted capture intent is not restored');
 await s.fire(75000);assert.equal(s.lifelog.active,false);assert.equal(s.lab.phase,'processing');
});
test('reopening saved lab requires explicit resume and never reopens microphone',async()=>{
 const s=setup();await s.lab.prepare();await s.lab.start();await s.lab.stopCapture();await s.lab.finish('manual');
 const before=s.calls.filter(r=>r[0]==='capture').length;const reopened=new s.DailyCaptureLab();reopened.initialize(s.context);
 assert.equal(reopened.phase,'saved');assert.equal(s.calls.filter(r=>r[0]==='capture').length,before);
 await reopened.prepare();await reopened.start(true);assert.equal(s.calls.filter(r=>r[0]==='capture').length,before);
});
test('finite watchdog stops capture, worker and coordinator while retaining test files',async()=>{
 const s=setup();await s.lab.prepare();await s.lab.start();const before=s.files.size;await s.fire(180000);
 assert.equal(s.lab.running,false);assert.equal(s.lab.phase,'deadline');assert.equal(s.probe.background.active,false);
 assert(s.calls.some(r=>r[0]==='services-stop'));assert(s.calls.some(r=>r[0]==='engine-close'));assert(s.files.size>=before);
});
test('isolated diagnostic cannot attach to an already initialized production runtime',()=>{
 const s=setup();s.lifelog.initialize({},'/app',true);const next=new s.DailyCaptureLab();assert.throws(()=>next.initialize(s.context),/冷启动/);
});

test('sealed audio with missing text is reported incomplete rather than passing the experiment',async()=>{
 const s=setup();await s.lab.prepare();await s.lab.start();
 s.lifelog.items=[{name:'seg-synthetic',bytes:24000,committedFrames:100,complete:true,interrupted:false,hasText:false,textComplete:true}];
 await s.lab.stopCapture();await s.fire(5000);assert.equal(s.lab.phase,'capture_or_text_incomplete');
});


test('explicit replay creates fresh processing root, preserves former report and never starts capture',async()=>{
 const s=setup();await s.lab.prepare();await s.lab.start();
 s.lifelog.items=[{name:'seg-'+'a'.repeat(32),bytes:24000,committedFrames:100,complete:true,interrupted:false,hasText:true,textComplete:true}];
 await s.lab.stopCapture();await s.fire(5000);const previous=JSON.parse(new TextDecoder().decode(s.files.get('/app/p22-daily-lab/trial.json')));
 const before=s.calls.filter(r=>r[0]==='capture').length;await s.lab.prepare();await s.lab.start(true,true);
 const clone=s.calls.find(r=>r[0]==='clone-source');assert(clone);assert.equal(clone[1],previous.root);assert.notEqual(clone[1],clone[2]);
 assert(s.files.has(previous.root+'/trial.json'));assert.equal(s.calls.filter(r=>r[0]==='capture').length,before);
 assert.equal(s.calls.filter(r=>r[0]==='services').at(-1)[1],clone[2]);
 const current=JSON.parse(new TextDecoder().decode(s.files.get('/app/p22-daily-lab/trial.json')));assert.equal(current.replaySourceSha256,'e'.repeat(64));
});


test('exit probe never captures and explicit finish cancels only its isolated probe',async()=>{
 const s=setup();await s.lab.prepare();await s.lab.start();s.lifelog.items=[{name:'seg-'+'a'.repeat(32),bytes:24000,committedFrames:100,complete:true,interrupted:false,hasText:true,textComplete:true}];
 await s.lab.stopCapture();await s.fire(5000);const captures=s.calls.filter(r=>r[0]==='capture').length;
 const work=s.lab.probeWorkerExit();assert.equal(s.lab.running,true);assert(s.calls.some(r=>r[0]==='exit-probe'));await s.lab.start();
 await s.lab.finish();await work;assert.equal(s.lab.running,false);assert(s.calls.some(r=>r[0]==='exit-probe-cancel'));assert.equal(s.calls.filter(r=>r[0]==='capture').length,captures);
});

test('codec diagnostic is exclusive, never captures and finish cancels its own Worker',async()=>{
 const s=setup();await s.lab.prepare();await s.lab.start();s.lifelog.items=[{name:'seg-'+'a'.repeat(32),bytes:24000,committedFrames:100,complete:true,interrupted:false,hasText:true,textComplete:true}];
 await s.lab.stopCapture();await s.fire(5000);const captures=s.calls.filter(r=>r[0]==='capture').length;
 const work=s.lab.probeWindowCodec();assert.equal(s.lab.running,true);assert(s.calls.some(r=>r[0]==='codec-probe'));await s.lab.start();
 await s.lab.finish();await work;assert.equal(s.lab.running,false);assert(s.calls.some(r=>r[0]==='codec-probe-cancel'));assert.equal(s.calls.filter(r=>r[0]==='capture').length,captures);
});
