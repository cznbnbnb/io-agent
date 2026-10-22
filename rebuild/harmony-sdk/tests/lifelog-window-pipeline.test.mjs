import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import {loadApp} from './load-app.mjs';
function setup(t){
 const prefix=path.join(os.tmpdir(),'turboio-pipeline-'),root=fs.mkdtempSync(prefix).replaceAll('\\','/');
 t.after(()=>{if(!path.resolve(root).startsWith(path.resolve(prefix)))throw Error('Unsafe cleanup');fs.rmSync(root,{recursive:true});});
 const io={OpenMode:{CREATE:1,WRITE_ONLY:2,TRUNC:4},accessSync:fs.existsSync,mkdirSync:fs.mkdirSync,listFileSync:fs.readdirSync,statSync:fs.statSync,readTextSync:p=>fs.readFileSync(p,'utf8'),openSync:p=>({fd:fs.openSync(p,'w')}),closeSync:f=>fs.closeSync(f.fd),writeSync:(fd,b)=>fs.writeSync(fd,new Uint8Array(b)),fsyncSync:fs.fsyncSync,renameSync:fs.renameSync};
 const kits={'@kit.CoreFileKit':{fileIo:io}};let now=1000,uptime=2000;class Clock extends Date{static now(){return now;}}
 class Transcript{utterances=[];speakers=[];}class Row{}
 const {LifelogWindowPipeline}=loadApp('LifelogWindowPipeline',{
  ...kits,'@kit.BasicServicesKit':{systemDateTime:{TimeType:{STARTUP:0},getUptime:()=>uptime}},
  './AsrWindowStore':loadApp('AsrWindowStore',kits),'./TranscriptionMeter':loadApp('TranscriptionMeter',kits),
  './TranscriptionBudget':loadApp('TranscriptionBudget'),'./LifelogASR':{LifelogTranscript:Transcript,LifelogSpeaker:Row,LifelogUtterance:Row}
 },{Date:Clock});
 const restart=()=>{const pipeline=new LifelogWindowPipeline();pipeline.initialize(root);return pipeline;},pipeline=restart(),id='asr-lifelog-'+'a'.repeat(32),calls=[];
 const good=()=>({workerReady:true,foreground:true,freeBytes:1e9,thermalKnown:true,thermalLimited:false,batteryPercent:60,charging:false});
 const asr={async transcribeWindow(_path,_kind,request,deadline){calls.push({request,deadline});now+=3000;uptime+=3000;const start=request.cursor,end=Math.min(300,start+request.coreFrames);return {windowed:true,windowStartFrame:start,windowEndFrame:end,frames:300,seconds:18,speechSeconds:1,sourcePrefixBytes:144000,sourcePrefixSha256:'c'.repeat(64),utterances:[{start:start*.06+.1,end:start*.06+1.1,text:'合成语音',speaker:0}],speakers:[{index:0,name:'不应沿用的实名',roleId:'person',samples:1,embedding:'private'}]};}};
 const next=(owner=pipeline,applied='',conditions=good(),sealed=true,current=()=>true)=>owner.next(id,'/synthetic/audio.ogg',sealed,asr,applied,conditions,current);
 return{root,pipeline,restart,id,calls,asr,good,next,advance:ms=>{now+=ms;uptime+=ms;}};
}
test('daytime windows publish without charging and disjoint speaker IDs do not assert cross-window identity',async t=>{
 const s=setup(t),first=await s.next();assert.equal(first.state,'published');assert.equal(first.cursor,167);assert.equal(s.calls[0].deadline,15000);
 assert.equal(s.calls[0].request.includeSpeakers,false,'daytime text declares deferred speaker analysis');
 assert.equal(s.calls[0].request.coreFrames,167);assert.equal(s.calls[0].request.contextFrames,83);
 const second=await s.next(s.pipeline,first.commitKey);assert.equal(second.state,'complete');assert.equal(second.cursor,300);
 assert.deepEqual(second.result.utterances.map(r=>r.speaker),[0,1000]);assert.equal(second.result.speakers[1].name,'第2窗·说话人1');
 assert(!second.result.speakers.some(r=>r.roleId||r.embedding));assert.equal(s.calls[1].request.expectedPrefixSha256,'c'.repeat(64));
});

test('leftover budget never dispatches a full window with a shorter deadline after successful inference',async t=>{
 const s=setup(t),original=s.asr.transcribeWindow;
 s.asr.transcribeWindow=async(...args)=>{const out=await original(...args);s.advance(3000);out.speakerProcessing='pending';return out;};
 const first=await s.next();assert.equal(first.result.speakerProcessing,'pending');
 const held=await s.next(s.restart(),first.commitKey);assert.equal(held.reason,'window_budget_exhausted');assert.equal(s.calls.length,1);
 assert.equal(held.retryAt,67000,'settled call expires exactly sixty seconds after finish');
 s.advance(60001);const second=await s.next(s.restart(),first.commitKey);assert.equal(second.state,'complete');assert.equal(s.calls[1].deadline,15000);
 assert.equal(second.result.speakerProcessing,'pending');
});
test('crash after inference before material publication replays sealed text without inference or power admission',async t=>{
 const s=setup(t),first=await s.next(),restarted=s.restart();
 const recovered=await s.next(restarted,'',{workerReady:false});assert.equal(recovered.commitKey,first.commitKey);assert.equal(s.calls.length,1);
 const final=await s.next(restarted,recovered.commitKey);assert.equal(final.state,'complete');assert.equal(s.calls.length,2);
 const again=await s.next(s.restart(),final.commitKey,{workerReady:false});assert.equal(again.state,'complete');assert.equal(s.calls.length,2);
});
test('thermal and interaction guards cannot be bypassed by explicit caller; waiting audio consumes only actual call time',async t=>{
 const s=setup(t);assert.equal((await s.next(s.pipeline,'',{...s.good(),thermalLimited:true})).reason,'thermal_limited_or_unknown');
 assert.equal((await s.next(s.pipeline,'',{...s.good(),interactiveAudio:true})).reason,'interactive_audio');assert.equal(s.calls.length,0);
 s.asr.transcribeWindow=async()=>{throw Error('ASR_WINDOW_WAITING_AUDIO');};assert.equal((await s.next(s.pipeline,'',s.good(),false)).reason,'waiting_audio');
});
test('destroyed owner cannot commit a late Worker result and its persisted reservation survives restart',async t=>{
 const s=setup(t);let resolve,current=true;s.asr.transcribeWindow=()=>new Promise(r=>resolve=r);
 const pending=s.next(s.pipeline,'',s.good(),false,()=>current);current=false;resolve({windowed:true});await assert.rejects(pending,/LIFETIME_ENDED/);
 const recovered=await s.next(s.restart(),'');assert.equal(recovered.reason,'window_budget_exhausted');
 // The unresolved reservation owns 15s of the 20s budget and prevents another
 // live reservation until it expires, even though no window was committed.
 assert.equal(fs.readdirSync(path.join(s.root,'asr-windows')).length,0);
});


test('aggregate never promotes a legacy or fallback window to token-aligned provenance',async t=>{
 const s=setup(t),original=s.asr.transcribeWindow;
 s.asr.transcribeWindow=async(...args)=>{const out=await original(...args),u=out.utterances[0];out.boundaryProcessing='token_starts';u.alignment='token_starts';u.tokens=['合成语音'];u.tokenStarts=[u.start];return out;};
 const first=await s.next();assert.equal(first.result.boundaryProcessing,'token_starts');
 s.asr.transcribeWindow=original;const mixed=await s.next(s.pipeline,first.commitKey);assert.equal(mixed.result.boundaryProcessing,'unverified');
 const saved=await s.next(s.restart(),mixed.commitKey,{workerReady:false});assert.equal(saved.result.boundaryProcessing,'unverified');
});


test('timed-out inference waits for native exit and bills the whole monotonic tail before releasing its job',async t=>{
 const s=setup(t);let confirm,exited=false,done=false;const exit=new Promise(r=>confirm=()=>{exited=true;r();});
 s.asr.engine={isClosed:()=>true,isExitConfirmed:()=>exited,waitForExit:()=>exit};s.asr.changed=()=>{};
 s.asr.transcribeWindow=async()=>{s.advance(15000);throw Error('synthetic-timeout');};
 const work=assert.rejects(s.next(),/synthetic-timeout/).then(()=>done=true);for(let i=0;i<10;i++)await Promise.resolve();
 assert.equal(done,false);let ledger=JSON.parse(fs.readFileSync(path.join(s.root,'asr-worker-budget.json'),'utf8'));assert.equal(ledger.rows[0].exitPending,true);assert.equal(ledger.rows[0].finished,0);
 s.advance(30000);confirm();await work;ledger=JSON.parse(fs.readFileSync(path.join(s.root,'asr-worker-budget.json'),'utf8'));
 assert.equal(ledger.rows[0].usedMs,45000);assert.equal(ledger.rows[0].accounting,'measured');assert.equal(ledger.rows[0].exitPending,false);
});
