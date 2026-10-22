import test from 'node:test';import assert from 'node:assert/strict';import {loadApp} from './load-app.mjs';
function setup(){let port;const timers=new Map();let seq=0;const progress=[],ports=[],lifecycle=[];
 class ThreadWorker{sent=[];terminated=0;constructor(){port=this;ports.push(this);}postMessage(m){this.sent.push(m);}terminate(){this.terminated++;}}
 const {AsrEngineClient}=loadApp('AsrEngine',{'@kit.ArkTS':{worker:{ThreadWorker}},'./LifelogASR':{}},{setTimeout:fn=>{timers.set(++seq,fn);return seq;},clearTimeout:id=>timers.delete(id)});
 const make=()=>new AsrEngineClient('/isolated',(...p)=>progress.push(p),e=>lifecycle.push(e));const client=make();return{client,port,timers,progress,ports,lifecycle,make};}
test('health probe uses the real queue without load/transcribe; ignores unrelated replies and clears deadline',async()=>{
 const t=setup();let done=false;const p=t.client.healthcheck().then(()=>done=true);assert.deepEqual(t.port.sent.map(x=>x.cmd),['init','health']);
 t.port.onmessage({data:{type:'result',jobId:999}});await Promise.resolve();assert.equal(done,false);
 t.port.onmessage({data:{type:'result',jobId:1,note:'worker_queue_ready'}});await p;assert.equal(t.timers.size,0);t.client.close();
});
test('health timeout terminates worker, rejects pending work and prevents calls into a dead worker',async()=>{
 const t=setup();const health=assert.rejects(t.client.healthcheck(),/超时/);const load=assert.rejects(t.client.load(),/超时/);
 [...t.timers.values()][0]();await Promise.all([health,load]);assert.equal(t.port.terminated,1);assert.equal(t.timers.size,0);
 await assert.rejects(t.client.transcribe('/unused','recording'),/重建线程/);assert.equal(t.port.sent.length,3);t.client.close();assert.equal(t.port.terminated,1);
});
test('worker crash rejects existing jobs and a new client can recover independently',async()=>{
 const t=setup();const fail=assert.rejects(t.client.healthcheck(),/线程异常/);t.port.onerror({message:'synthetic'});await fail;
 const next=setup();const ok=next.client.healthcheck();next.port.onmessage({data:{type:'result',jobId:1}});await ok;next.client.close();
});

test('explicit inference deadline rejects pending work and ignores late progress from a closed worker',async()=>{
 const t=setup();const job=assert.rejects(t.client.transcribe('/lab/source.rawopus','recording',30000),/超时/);
 assert.equal(t.timers.size,1);[...t.timers.values()][0]();await job;
 t.port.onmessage({data:{type:'progress',jobId:1,progress:100,note:'late'}});
 assert.equal(t.progress.length,0);assert.equal(t.port.terminated,1);
});

test('bounded window uses the Worker queue and preserves the typed request and deadline',async()=>{
 const t=setup(),request={cursor:334,coreFrames:334,contextFrames:200,sealed:false};
 const work=t.client.transcribeWindow('/isolated/audio.ogg','lifelog',request,20000);
 assert.equal(t.port.sent.at(-1).cmd,'window');assert.deepEqual(t.port.sent.at(-1).windowRequest,request);assert.equal(t.timers.size,1);
 t.port.onmessage({data:{type:'result',jobId:1,transcript:{windowed:true,windowStartFrame:334,windowEndFrame:668}}});
 const out=await work;assert.equal(out.windowEndFrame,668);assert.equal(t.timers.size,0);t.client.close();
});


const settle=async()=>{for(let i=0;i<15;i++)await Promise.resolve();};
test('replacement native Worker is not created until the terminated predecessor confirms onexit',async()=>{
 const t=setup();t.client.close();let exited=false;t.client.waitForExit().then(()=>exited=true);
 const next=t.make();const work=next.healthcheck();await settle();assert.equal(t.ports.length,1);assert.equal(exited,false);assert.equal(next.isReady(),false);
 t.port.onmessage({data:{type:'result',jobId:1}});await settle();assert.equal(t.ports.length,1);
 t.port.onexit(0);await settle();assert.equal(exited,true);assert.equal(t.ports.length,2);assert.equal(next.isReady(),true);
 const port=t.ports[1];assert.deepEqual(port.sent.map(m=>m.cmd),['init','health']);port.onmessage({data:{type:'result',jobId:1}});await work;
 assert.deepEqual(t.lifecycle.map(e=>e.state),['created','terminate_requested','waiting_exit','exit_confirmed','created']);next.close();port.onexit(0);
});
test('cancelling a waiting client cannot release another predecessor or dispatch queued work later',async()=>{
 const t=setup();t.client.close();const waiting=t.make();const cancelled=assert.rejects(waiting.load(30000),/关闭/);waiting.close();await cancelled;
 const next=t.make();await settle();assert.equal(t.ports.length,1);assert.equal(waiting.isExitConfirmed(),true);
 t.port.onexit(0);await settle();assert.equal(t.ports.length,2);assert.deepEqual(t.ports[1].sent.map(m=>m.cmd),['init']);next.close();t.ports[1].onexit(0);
});
test('all unconfirmed closing workers are fenced, and a spontaneous exit rejects pending work without re-terminating',async()=>{
 const t=setup(),second=t.make(),port2=t.ports[1];t.client.close();second.close();const third=t.make();
 t.port.onexit(1);await settle();assert.equal(t.ports.length,2);port2.onexit(0);await settle();assert.equal(t.ports.length,3);
 const port3=t.ports[2],pending=assert.rejects(third.healthcheck(),/已退出/);port3.onexit(1);await pending;
 assert.equal(third.isClosed(),true);assert.equal(third.isExitConfirmed(),true);assert.equal(port3.terminated,0);assert.equal(t.timers.size,0);
});
test('a failed terminate request remains unconfirmed and cannot start a replacement',async()=>{
 const t=setup();t.port.terminate=()=>{throw Error('synthetic');};t.client.close();const next=t.make();await settle();
 assert.equal(t.client.isExitConfirmed(),false);assert.equal(t.ports.length,1);assert(t.lifecycle.some(e=>e.state==='terminate_request_failed'));
 t.port.onexit(1);await settle();assert.equal(t.ports.length,2);next.close();t.ports[1].onexit(0);
});

test('codec diagnostic has its own typed reply and bounded queue deadline',async()=>{
 const t=setup();const p=t.client.codecProbe('/lab/audio.ogg');assert.equal(t.port.sent.at(-1).cmd,'codec_probe');assert.equal(t.timers.size,1);
 const report={equivalent:true,windows:[]};t.port.onmessage({data:{type:'result',jobId:1,codecReport:report}});assert.deepEqual(await p,report);
 const bad=assert.rejects(t.client.transcribe('/lab/audio.ogg','lifelog'),/REPLY_INVALID/);t.port.onmessage({data:{type:'result',jobId:2,codecReport:report}});await bad;t.client.close();t.port.onexit(0);
});
