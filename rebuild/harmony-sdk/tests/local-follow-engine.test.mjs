import test from 'node:test';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';import {loadApp} from './load-app.mjs';
function setup(){const model=new TextEncoder().encode('synthetic model'),tokens=new TextEncoder().encode('<blk> 0\n测试 1\n'),hash=b=>createHash('sha256').update(b).digest('hex');const files=new Map([['model.int8.onnx',model],['tokens.txt',tokens]]);let nextFd=0,constructors=0,text='测试中文句子',endpoint=false,received,config,resets=0,finished=0,backlog=0,decodes=0;
 const handles=new Map(),fs={accessSync:()=>true,OpenMode:{READ_ONLY:1},openSync:path=>{const fd=++nextFd;handles.set(fd,{bytes:files.get(path.split('/').at(-1)),offset:0});return {fd};},readSync:(fd,buffer)=>{const h=handles.get(fd),b=h.bytes.subarray(h.offset,h.offset+buffer.byteLength);new Uint8Array(buffer).set(b);h.offset+=b.length;return b.length;},closeSync:fd=>handles.delete(fd)};
 class OnlineRecognizerConfig{modelConfig={zipformer2Ctc:{},tokens:'',numThreads:1};featConfig={};}
 class OnlineRecognizer{constructor(c){constructors++;config=c;}createStream(){return {acceptWaveform(row){received=row;},inputFinished(){finished++;}};}isReady(){return backlog>0;}decode(){backlog--;decodes++;}getResult(){return {text};}isEndpoint(){return endpoint;}reset(){resets++;}}
 const {LocalFollowEngine}=loadApp('LocalFollowEngine',{'@kit.CoreFileKit':{fileIo:fs},'./PrompterModel':{prompterModelSHA:hash(model),prompterTokensSHA:hash(tokens)},sherpa_onnx:{OnlineRecognizerConfig,OnlineRecognizer}});const e=new LocalFollowEngine();
 return {e,files,stats:()=>({constructors,config,resets,received,finished,decodes}),text:v=>text=v,endpoint:v=>endpoint=v,backlog:v=>backlog=v};
}
test('pinned file hash failure never reaches native creation; load uses a separate streaming CTC model and endpoint policy',()=>{
 const s=setup();s.files.set('tokens.txt',new Uint8Array([9]));assert.throws(()=>s.e.load('/synthetic/prompter-ctc-zh-2025-04-01'),/MODEL_HASH/);assert.equal(s.stats().constructors,0);
 const ok=setup();ok.e.load('/synthetic/prompter-ctc-zh-2025-04-01');assert.match(ok.stats().config.modelConfig.zipformer2Ctc.model,/model.int8.onnx$/);assert.equal(ok.stats().config.rule2MinTrailingSilence,0.7);
});

test('finish drains the last segment after inputFinished and cannot accept more audio on the sealed stream',()=>{
 const s=setup();s.e.load('/synthetic/prompter-ctc-zh-2025-04-01');s.e.begin();s.endpoint(true);s.e.append(Uint8Array.of(1,0));
 s.text('但运费沿用上次');s.backlog(3);const end=s.e.finish();assert.equal(end.text,'但运费沿用上次');assert.equal(end.id,2);assert.equal(end.final,true);
 assert.equal(s.stats().finished,1);assert.equal(s.stats().decodes,3);assert.equal(s.stats().received.samples.length,8000);assert(s.stats().received.samples.every(v=>v===0));
 assert.throws(()=>s.e.append(Uint8Array.of(1,0)),/PCM_INVALID/);assert.throws(()=>s.e.finish(),/STREAM_NOT_READY/);
});

test('finish bounds excessive native decode backlog and still seals the stream',()=>{
 const s=setup();s.e.load('/synthetic/prompter-ctc-zh-2025-04-01');s.e.begin();s.backlog(65);assert.throws(()=>s.e.finish(),/DECODE_BACKLOG/);
 assert.equal(s.stats().decodes,64);assert(s.stats().received.samples.every(v=>v===0));assert.throws(()=>s.e.finish(),/STREAM_NOT_READY/);
});
test('streaming signed PCM, partial rewrites and endpoints stay transient and pause discards the stream',()=>{
 const s=setup();s.e.load('/synthetic/prompter-ctc-zh-2025-04-01');s.e.begin();const pcm=new Uint8Array([0,128,255,127,0,0]);const r=s.e.append(pcm);assert.equal(r.text,'测试中文句子');assert(s.stats().received.samples.every(v=>v===0));assert.deepEqual([...pcm],[0,128,255,127,0,0]);
 assert.equal(s.e.append(pcm).text,'');s.text('测试中文句子更新');assert.equal(s.e.append(pcm).text,'测试中文句子更新');s.endpoint(true);const end=s.e.append(pcm);assert.equal(end.final,true);assert.equal(end.id,1);assert.equal(s.stats().resets,1);s.e.pause();assert.throws(()=>s.e.append(pcm),/PCM_INVALID/);
});
