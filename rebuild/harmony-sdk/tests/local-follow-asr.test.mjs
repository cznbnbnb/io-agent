import test from 'node:test';import assert from 'node:assert/strict';import {loadApp} from './load-app.mjs';
const settle=async()=>{for(let i=0;i<10;i++)await Promise.resolve();};
function setup(){let id=0;const timers=new Map(),ports=[];
 class Port{constructor(path){this.path=path;this.sent=[];ports.push(this);}postMessage(row){this.sent.push(structuredClone(row));}terminate(){this.termination=true;}}
 const {LocalFollowASR}=loadApp('LocalFollowASR',{'@kit.ArkTS':{worker:{ThreadWorker:Port}}},{setTimeout:(f,ms)=>{timers.set(++id,{f,ms});return id;},clearTimeout:id=>timers.delete(id)});
 const c=new LocalFollowASR(),texts=[],errors=[];c.onText=(...v)=>texts.push(v);c.onError=n=>errors.push(n);
 const emit=(port,type,extra={})=>port.onmessage({data:{type,generation:c.generation,...extra}});
 const loaded=async()=>{const ready=c.prepare('/synthetic/prompter-ctc-zh-2025-04-01');await settle();const p=ports.at(-1);emit(p,'loaded');await ready;return p;};
 const start=async p=>{const ready=c.begin();emit(p,'started');await ready;};return {c,ports,texts,errors,timers,emit,loaded,start};
}
test('local stream loads one real Worker path, wipes its posted copy and bounds unacknowledged PCM to two seconds',async()=>{
 const s=setup(),p=await s.loaded();await s.start(p);assert.match(p.path,/PrompterWorker/);const original=new Uint8Array([1,2,3,4]);s.c.append(original);const sent=p.sent.at(-1);assert.deepEqual([...sent.pcm],[1,2,3,4]);assert.deepEqual([...original],[1,2,3,4]);
 s.emit(p,'audio',{sequence:sent.sequence,text:'今天测试中文',final:false,id:1});assert.equal(s.c.queued,0);assert.equal(s.texts.length,1);
 for(let i=0;i<20;i++)s.c.append(new Uint8Array(3200));assert.equal(s.errors.length,0);s.c.append(new Uint8Array(2));assert.match(s.errors.at(-1),/积压/);assert(p.termination);p.onexit();
});
test('pause discards old text/ACK and start cancellation cannot revive the old stream',async()=>{
 const s=setup(),p=await s.loaded();await s.start(p);s.c.append(new Uint8Array([4,0]));const old=p.sent.at(-1);s.c.pause();await s.start(p);
 s.emit(p,'audio',{generation:old.generation,sequence:old.sequence,text:'旧文字',id:1});assert.equal(s.texts.length,0);assert.equal(s.c.queued,0);
 const begin=s.c.begin();const rejected=assert.rejects(begin,/暂停/);s.c.pause();s.emit(p,'started',{generation:old.generation});await rejected;assert.equal(s.c.listening,false);s.c.close();p.onexit();
});
test('unconfirmed Worker termination gates the next model load, and readiness errors retain a safe useful cause',async()=>{
 const s=setup(),p=await s.loaded();s.c.close();const preparing=s.c.prepare('/synthetic/prompter-ctc-zh-2025-04-01');await settle();assert.equal(s.ports.length,1);p.onexit();await settle();assert.equal(s.ports.length,2);
 const next=s.ports.at(-1);s.emit(next,'error',{text:'本机模型校验失败'});await assert.rejects(preparing,/校验失败/);assert.equal(s.timers.size,0);next.onexit();
});
test('audio arriving during physical-resume startup follows the ordered start command, and duplicate old exit cannot free a current lease',async()=>{
 const s=setup(),p=await s.loaded();const started=s.c.begin();s.c.append(new Uint8Array([1,0]));assert.equal(p.sent.at(-2).cmd,'start');assert.equal(p.sent.at(-1).cmd,'audio');s.emit(p,'started');await started;s.c.close();const exit=p.onexit;p.onexit();
 const next=await s.loaded();s.c.close();exit();let released=false;s.c.waitForExit().then(()=>released=true);await settle();assert.equal(released,false);next.onexit();await settle();assert.equal(released,true);
});

test('finish queues after all audio, preserves tail text before resolving and rejects further PCM',async()=>{
 const s=setup(),p=await s.loaded();await s.start(p);s.c.append(Uint8Array.of(1,0));const audio=p.sent.at(-1);
 const finishing=s.c.finishInput();assert.equal(p.sent.at(-1).cmd,'finish');const count=p.sent.length;s.c.append(Uint8Array.of(2,0));assert.equal(p.sent.length,count);
 s.emit(p,'audio',{sequence:audio.sequence,text:'但运费沿用',id:2});let textAtResolution='';finishing.then(()=>textAtResolution=s.texts.at(-1)[0]);
 s.emit(p,'finished',{text:'但运费沿用上次',id:2});await finishing;assert.equal(textAtResolution,'但运费沿用上次');assert.equal(s.c.listening,false);assert.equal(s.c.queued,0);s.c.close();p.onexit();
});

test('out-of-order finish cannot accept missing audio ACKs as a complete answer',async()=>{
 const s=setup(),p=await s.loaded();await s.start(p);s.c.append(Uint8Array.of(1,0));const finishing=s.c.finishInput(),rejected=assert.rejects(finishing,/未排空/);
 s.emit(p,'finished',{text:'不能作为答案',id:1});await rejected;assert.equal(s.texts.length,0);assert(p.termination);p.onexit();
});

test('pause cancels finish; a late reply cannot revive the stream or its answer',async()=>{
 const s=setup(),p=await s.loaded();await s.start(p);const old=s.c.generation,finishing=s.c.finishInput(),rejected=assert.rejects(finishing,/暂停/);
 s.c.pause();s.emit(p,'finished',{generation:old,text:'过期答案',id:1});await rejected;assert.equal(s.texts.length,0);assert.equal(s.c.listening,false);s.c.close();p.onexit();
});
