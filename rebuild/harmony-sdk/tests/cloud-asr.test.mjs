import test from 'node:test';import assert from 'node:assert/strict';import {loadApp} from './load-app.mjs';import {loadCore} from './load-core.mjs';
const flush=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
function setup(){const sockets=[],timers=new Map();let tid=0;
 const ws={createWebSocket(){const events={},sent=[];const s={events,sent,on:(n,f)=>events[n]=f,off:n=>delete events[n],close:async()=>true,connect:async(url,opts)=>{s.url=url;s.opts=opts;return true;},send:async d=>{sent.push(typeof d==='string'?d:new Uint8Array(d).slice());return true;}};sockets.push(s);return s;}};
 const {CloudASR}=loadApp('CloudASR',{'@kit.NetworkKit':{webSocket:ws},'@kit.BasicServicesKit':{},'./RemoteServices':{}},{setTimeout:(f,ms)=>{timers.set(++tid,{f,ms});return tid;},clearTimeout:id=>timers.delete(id)});
 const config={asrHost:'test.aliyuncs.com',asrModel:'qwen-audio-3.0-asr-flash-streaming',asrKey:'synthetic-only'};
 const c=new CloudASR(),texts=[],errors=[];c.onText=(t,f)=>texts.push({t,f});c.onError=s=>errors.push(s);
 const task='a'.repeat(32),emit=(event,sentence,taskId=task)=>sockets.at(-1).events.message?.(undefined,JSON.stringify({header:{event,task_id:taskId},payload:{output:{sentence}}}));
 return {c,config,sockets,timers,texts,errors,task,emit};
}
test('cloud ASR sends PCM16k only after task-started, matches task and final once',async()=>{
 const s=setup();s.c.start(s.config,s.task);s.c.append(new Uint8Array([1,0,2,0]));await flush();const ws=s.sockets[0];
 assert.equal(ws.sent.length,0,'connect acceptance is NOT an open socket');ws.events.open();await flush();
 assert.equal(ws.sent.length,1);assert.equal(ws.opts.skipServerCertVerification,false);assert(!ws.url.includes(s.config.asrKey));
 assert.equal(JSON.parse(ws.sent[0]).payload.parameters.format,'pcm');
 s.emit('task-started',null,'b'.repeat(32));await flush();assert.equal(ws.sent.length,1);
 s.emit('task-started');await flush();assert.deepEqual([...ws.sent[1]],[1,0,2,0]);
 s.emit('result-generated',{text:'测试',sentence_end:false});s.emit('result-generated',{text:'测试完成',sentence_end:true});s.emit('result-generated',{text:'重复',sentence_end:true});
 assert.deepEqual(s.texts,[{t:'测试',f:false},{t:'测试完成',f:true}]);s.c.close();assert.equal(s.timers.size,0);
});
test('cloud ASR error text never exposes server error or key; queue is bounded',async()=>{
 const s=setup();s.c.start(s.config,s.task);await flush();s.emit('task-failed');assert.equal(s.errors.length,1);assert(!s.errors[0].includes(s.config.asrKey));
 s.c.start(s.config,s.task);s.c.append(new Uint8Array(64002));assert.match(s.errors.at(-1),/积压/);assert.equal(s.c.socket,undefined);
});
test('cloud ASR closes stale socket, ignores late old events and enforces start deadline',async()=>{
 const s=setup();s.c.start(s.config,s.task);const old=s.sockets[0].events.message;s.c.start(s.config,'b'.repeat(32));old(undefined,JSON.stringify({header:{event:'task-failed',task_id:s.task}}));assert.equal(s.errors.length,0);
 [...s.timers.values()][0].f();assert.match(s.errors[0],/超时/);
});
test('voice chunking preserves emoji and protocol completion stays separate',()=>{
 const {voiceChunks,answerChunk,asrRunTask}=loadCore('./VoiceCommands');const text='😀测试'.repeat(20);const chunks=voiceChunks(text,24);assert.equal(chunks.join(''),text);
 for(const c of chunks){assert(c.length<=24);assert(!/[\uD800-\uDBFF]$/.test(c));assert.equal(JSON.parse(answerChunk(c,'c'.repeat(32),'测试',1)).answer.isFinal,false);}
 assert.throws(()=>asrRunTask('bad','model'));assert.equal(JSON.parse(asrRunTask('a'.repeat(32),'model')).payload.parameters.sample_rate,16000);
});
