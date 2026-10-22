import test from 'node:test';import assert from 'node:assert/strict';import {loadApp} from './load-app.mjs';
const settle=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
function setup(){const sockets=[],timers=new Map();let id=0;const ws={createWebSocket(){const events={},sent=[];const s={events,sent,on:(name,f)=>events[name]=f,off:name=>delete events[name],close:async()=>true,connect:async(url,opts)=>{s.opts=opts;s.url=url;return true;},send:async data=>{sent.push(typeof data==='string'?data:new Uint8Array(data).slice());return true;}};sockets.push(s);return s;}};
 const {ContinuousASR}=loadApp('ContinuousASR',{'@kit.NetworkKit':{webSocket:ws},'./RemoteServices':{}},{setTimeout:(f,ms)=>{timers.set(++id,{f,ms});return id;},clearTimeout:id=>timers.delete(id)});
 const c=new ContinuousASR(),texts=[],errors=[];c.onText=(text,final,id)=>texts.push({text,final,id});c.onError=note=>errors.push(note);const task='b'.repeat(32),config={asrHost:'test.aliyuncs.com',asrModel:'qwen-audio-3.0-asr-flash-streaming',asrKey:'synthetic-only'};
 const emit=(event,sentence,taskId=task)=>sockets.at(-1).events.message?.(undefined,JSON.stringify({header:{event,task_id:taskId},payload:{output:{sentence}}}));return {c,sockets,timers,texts,errors,task,config,emit};}
test('continuous task processes multiple final sentences and more than 40 seconds without concatenating partial rewrites',async()=>{
 const s=setup(),started=s.c.start(s.config,s.task);s.c.append(new Uint8Array([1,0]));s.sockets[0].events.open();await settle();assert.equal(s.sockets[0].sent.length,1);s.emit('task-started');await started;await settle();
 assert.equal(s.sockets[0].opts.skipServerCertVerification,false);assert(!s.sockets[0].url.includes(s.config.asrKey));const run=JSON.parse(s.sockets[0].sent[0]);assert.equal(run.payload.parameters.heartbeat,true);
 s.emit('result-generated',{sentence_id:1,text:'第一句修改前',sentence_end:false});s.emit('result-generated',{sentence_id:1,text:'第一句修改后',sentence_end:false});s.emit('result-generated',{sentence_id:1,text:'第一句完成',sentence_end:true});
 s.emit('result-generated',{sentence_id:1,text:'重复旧终句',sentence_end:true});s.emit('result-generated',{sentence_id:2,text:'第二句继续',sentence_end:true});assert.equal(s.texts.length,4);
 for(let i=0;i<500;i++){s.c.append(new Uint8Array(3200));await settle();}assert.equal(s.errors.length,0);assert(s.sockets[0].sent.length>500);s.c.close();assert.equal(s.timers.size,0);
});
test('foreign task, old callbacks and heartbeat cannot move text; cancellation rejects pending readiness',async()=>{
 const s=setup(),started=s.c.start(s.config,s.task);const old=s.sockets[0].events.message;const rejected=assert.rejects(started,/取消/);s.c.close();await rejected;
 const next=s.c.start(s.config,s.task);old(undefined,JSON.stringify({header:{task_id:s.task,event:'task-failed'}}));s.emit('task-started',null,'c'.repeat(32));assert.equal(s.errors.length,0);s.emit('task-started');await next;
 s.emit('result-generated',{sentence_id:0,text:'心跳',heartbeat:true});assert.equal(s.texts.length,0);s.c.close();
});
test('startup failure and bounded backlog stop the stream without exposing provider error or key',async()=>{
 const s=setup(),started=s.c.start(s.config,s.task);s.emit('task-failed');await assert.rejects(started,/中断/);assert(!s.errors.join('').includes(s.config.asrKey));
 const again=s.c.start(s.config,s.task);s.emit('task-started');await again;s.c.append(new Uint8Array(64002));assert.match(s.errors.at(-1),/积压/);assert.equal(s.c.socket,undefined);
 await assert.rejects(s.c.start({...s.config,asrModel:'qwen3-asr-flash-realtime'},s.task),/受支持/);
});
