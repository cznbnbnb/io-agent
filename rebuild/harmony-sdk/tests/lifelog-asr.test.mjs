import test from 'node:test';import assert from 'node:assert/strict';import {loadApp} from './load-app.mjs';
const {OggOpusWriter}=loadApp('OggOpus');

// 伪造一个 OGG 容器（帧内容无关紧要，解码走 mock）。
function fakeOgg(frames){
 const chunks=[];const writer=new OggOpusWriter(bytes=>chunks.push(bytes),7,50);
 writer.begin();
 const mk=()=>{const f=new Uint8Array(240).fill(3);f[0]=0x5b;f[1]=0x01;return f;};
 for(let i=0;i<frames;i++)writer.push(mk());
 writer.finish();
 const total=chunks.reduce((n,c)=>n+c.length,0),out=new Uint8Array(total);let at=0;
 for(const c of chunks){out.set(c,at);at+=c.length;}
 return out;
}

function setup({frames=34,speechAt=[16000],decodeFail=false,models=true,recognizerResult=undefined,stateful=false}={}){
 const files=new Map();
 const dirs=new Set(['/files','/files/seg']);
 if(models)for(const p of ['/files/models/sensevoice/model.int8.onnx','/files/models/sensevoice/tokens.txt','/files/models/vad/silero_vad.onnx'])dirs.add(p);
 if(frames>0)files.set('/files/seg/audio.ogg',fakeOgg(frames));
 const handles=new Map();let fd=0;
 const fs={OpenMode:{CREATE:1,READ_WRITE:2,WRITE_ONLY:4,TRUNC:8},WhenceType:{SEEK_SET:0},
  accessSync:p=>files.has(p)||dirs.has(p),
  statSync:p=>({size:(files.get(typeof p==='number'?handles.get(p).path:p)||new Uint8Array(0)).length,mtime:1}),
  openSync:(path)=>{if(!files.has(path))files.set(path,new Uint8Array(0));const h={fd:++fd,path,pos:0};handles.set(h.fd,h);return h;},
  closeSync:f=>handles.delete(typeof f==='number'?f:f.fd),
  lseek:(fd,pos)=>{handles.get(fd).pos=pos;return pos;},
  readSync:(fd,buffer,options={})=>{const h=handles.get(fd),b=files.get(h.path),n=Math.min(options.length??buffer.byteLength,b.length-h.pos);new Uint8Array(buffer).set(b.slice(h.pos,h.pos+n));h.pos+=n;return n;},
  writeSync:(fd,buffer)=>{const h=handles.get(fd),b=new Uint8Array(buffer),old=files.get(h.path),out=new Uint8Array(Math.max(old.length,h.pos+b.length));out.set(old);out.set(b,h.pos);h.pos+=b.length;files.set(h.path,out);return b.length;},
  fsyncSync:()=>{},readTextSync:p=>new TextDecoder().decode(files.get(p))};
 // VAD mock：每满 1 秒窗口触发一次；speechAt 里的采样点会产出一个 1 秒长的语音段。
 const pending=[],waveforms=[];
 let buffered=0,ticks=0;
 const vad={
  acceptWaveform(samples){waveforms.push(Float32Array.from(samples));buffered+=samples.length;if(buffered>=16000){buffered-=16000;ticks++;if(speechAt.includes(ticks))pending.push({samples:new Float32Array(16000).fill(0.1),start:ticks*16000-16000});}},
  isEmpty:()=>pending.length===0,
  front:()=>pending.shift(),
  pop:()=>{},flush:()=>{},reset:()=>{buffered=0;ticks=0;pending.length=0;},clear:()=>{} };
 let decoded=0,totalDecoded=0,resets=0,calls=0,embeddingCalls=0;
 const platform={
  '@kit.CoreFileKit':{fileIo:fs},
  'libturbo_audio.so':{lifelogReset:()=>{decoded=0;resets++;},lifelogClose:()=>{},lifelogDecode:()=>{if(decodeFail)throw Error('decode-fail');decoded++;totalDecoded++;return new Int16Array(960).fill(stateful?(decoded*97)%32749:1000).buffer;},recordingReset:()=>{},recordingClose:()=>{},recordingDecode:()=>{if(decodeFail)throw Error('decode-fail');decoded++;return new Int16Array(640).fill(600).buffer;}},
  './OggOpus':loadApp('OggOpus'),
  './VoiceRegistry':loadApp('VoiceRegistry'),
  './VoiceRegistry':loadApp('VoiceRegistry'),
  'sherpa_onnx':{
   // 真机实测返回完整相对路径，mock 照此模拟
   listRawfileDir:(mgr,dir)=>{const map={'models/sensevoice':models?['models/sensevoice/model.int8.onnx','models/sensevoice/tokens.txt']:['models/sensevoice/placeholder.bin'],
     'models/vad':models?['models/vad/silero_vad.onnx']:['models/vad/placeholder.bin'],
     'models/diar':models?['models/diar/embedding_zh.onnx']:['models/diar/placeholder.bin']};
     return map[dir]||['placeholder.bin'];},  // 目录里没有目标文件时不能乐观放行
   OfflineRecognizer:class{constructor(config,mgr){this.config=config;this.mgr=mgr;}createStream(){return {acceptWaveform(){}};}decode(){}getResult(){calls++;return recognizerResult||{text:`第${calls}句`,lang:'zh'};}},
   OfflineRecognizerConfig:class{constructor(){this.featConfig={};this.modelConfig={};}},
   OfflineModelConfig:class{constructor(){this.senseVoice={};}},
   OfflineSenseVoiceModelConfig:class{},
   FeatureConfig:class{},
   SpeakerEmbeddingExtractorConfig:class{},
   SpeakerEmbeddingExtractor:class{constructor(){this.dim=8;}createStream(){return {acceptWaveform(){}};}isReady(){return true;}compute(){embeddingCalls++;return new Float32Array(8).fill(0.5);}},
   Vad:class{constructor(config,buffer,setMgr){this.mgr=setMgr;return vad;}},
   VadConfig:class{},
   SileroVadConfig:class{},
   TenVadConfig:class{}
  }};
 const timerDelays=[];
 const {LifelogASR}=loadApp('LifelogASR',platform,{setTimeout:(f,ms)=>{timerDelays.push(ms);f();return 0;},clearTimeout:()=>{}});
 const asr=new LifelogASR();asr.initialize({filesDir:'/files',resourceManager:{}});
 return {asr,files,dirs,timerDelays,decoded:()=>decoded,sentences:()=>calls,embeddingCalls:()=>embeddingCalls,waveforms,totalDecoded:()=>totalDecoded,resets:()=>resets};
}

test('缺少本地模型时给出明确错误',async()=>{
 const {asr}=setup({models:false,frames:0});
 assert.equal([...asr.missing()].join(','),'models/sensevoice/model.int8.onnx,models/sensevoice/tokens.txt,models/vad/silero_vad.onnx');
 assert.equal(asr.ready(),false);
 await assert.rejects(()=>asr.transcribe('/files/seg/audio.ogg'),/本地模型缺失/);
});

test('本地转写：逐帧解码、VAD 只放行语音段、输出时间轴与 Markdown',async()=>{
 const s=setup({frames:34,speechAt:[2]});
 const out=await s.asr.transcribe('/files/seg/audio.ogg');
 assert.equal(out.frames,34);
 assert.equal(s.decoded(),34,'每一帧都交给解码器');
 assert(out.seconds>2&&out.seconds<2.1);
 assert.equal(s.sentences(),1,'只有 VAD 判定为语音的段才进识别');
 assert.equal(out.utterances.length,1);
 const u=out.utterances[0];
 assert.equal(u.start,1,'时间轴以秒计');
 assert.equal(u.end,2);
 assert.equal(u.text,'第1句');
 assert.equal(u.speaker,0,'声纹模型可用时会给出说话人编号');
 assert.equal(out.speechSeconds,1);
 const md=lifelogMarkdownText(out);
 assert(md.indexOf('# x')>=0);
 assert(md.indexOf('[00:01]')>=0);
 assert(md.indexOf('有效语音 00:01')>=0);
});

test('静音段不进入识别也不产生句子',async()=>{
 const s=setup({frames:34,speechAt:[]});
 const out=await s.asr.transcribe('/files/seg/audio.ogg');
 assert.equal(s.decoded(),34);
 assert.equal(s.sentences(),0);
 assert.equal(out.utterances.length,0);
 assert.equal(out.speechSeconds,0);
});

test('转写中解码失败会中止、上报错误并释放忙状态',async()=>{
 const s=setup({frames:4,decodeFail:true});
 await assert.rejects(()=>s.asr.transcribe('/files/seg/audio.ogg'),/decode-fail/);
 assert.equal(s.asr.busy,false);
 assert(s.asr.note.indexOf('转写失败')>=0);
});

test('formatClock 输出 分:秒 / 时:分:秒',()=>{
 const {formatClock}=loadApp('LifelogASR',{'@kit.CoreFileKit':{fileIo:{}},'sherpa_onnx':{},'libturbo_audio.so':{},'./OggOpus':loadApp('OggOpus'),'./VoiceRegistry':loadApp('VoiceRegistry')},{setTimeout:(f)=>{f();return 0;},clearTimeout:()=>{}});
 assert.equal(formatClock(0),'00:00');
 assert.equal(formatClock(59),'00:59');
 assert.equal(formatClock(61),'01:01');
 assert.equal(formatClock(3725),'1:02:05');
});

function lifelogMarkdownText(transcript){return loadApp('LifelogASR',{'@kit.CoreFileKit':{fileIo:{}},'sherpa_onnx':{},'libturbo_audio.so':{},'./OggOpus':loadApp('OggOpus'),'./VoiceRegistry':loadApp('VoiceRegistry')},{setTimeout:(f)=>{f();return 0;},clearTimeout:()=>{}}).lifelogMarkdown('x',transcript);}

test('UI runtime rejects a missing worker without loading models or decoding audio on the main thread',async()=>{
 const s=setup();s.asr.requireWorker=true;
 await assert.rejects(()=>s.asr.preload(),/转写线程不可用/);
 await assert.rejects(()=>s.asr.transcribe('/files/seg/audio.ogg'),/转写线程不可用/);
 await assert.rejects(()=>s.asr.transcribeRecording('/files/seg/source.rawopus'),/转写线程不可用/);
 assert.equal(s.decoded(),0);assert.equal(s.sentences(),0);
 assert.equal(s.asr.busy,false);
});

test('required worker receives transcription requests without invoking local recognition',async()=>{
 const s=setup();s.asr.requireWorker=true;
 const requests=[];
 s.asr.engine={lastNote:'',load:async()=>{},transcribe:async(path,kind)=>{
  requests.push({path,kind});return {utterances:[],speakers:[],seconds:0,speechSeconds:0,frames:0};
 }};
 await s.asr.transcribe('/files/seg/audio.ogg');
 await s.asr.transcribeRecording('/files/seg/source.rawopus');
 await s.asr.transcribeRecording('/files/seg/source.rawopus','left');
 await s.asr.transcribeRecording('/files/seg/source.rawopus','right');
 assert.deepEqual(requests,[{path:'/files/seg/audio.ogg',kind:'lifelog'},{path:'/files/seg/source.rawopus',kind:'recording'},
  {path:'/files/seg/source.rawopus',kind:'recording_left'},{path:'/files/seg/source.rawopus',kind:'recording_right'}]);
 await assert.rejects(()=>s.asr.transcribeRecording('/files/seg/source.rawopus','wearer'),/channel/);
 assert.equal(s.decoded(),0);assert.equal(s.sentences(),0);assert.equal(s.asr.busy,false);
});

test('说话人聚类：相似嵌入归为同一人，不同嵌入分开',()=>{
 const {SpeakerClusters}=loadApp('LifelogASR',{'@kit.CoreFileKit':{fileIo:{}},'sherpa_onnx':{},'libturbo_audio.so':{},'./OggOpus':loadApp('OggOpus'),'./VoiceRegistry':loadApp('VoiceRegistry')},{setTimeout:(f)=>{f();return 0;},clearTimeout:()=>{}});
 const clusters=new SpeakerClusters(0.7);
 const a=new Float32Array([1,0,0,0]);
 const a2=new Float32Array([0.98,0.05,0,0]);
 const b=new Float32Array([0,1,0,0]);
 assert.equal(clusters.assign(a),0);
 assert.equal(clusters.assign(b),1);
 assert.equal(clusters.assign(a2),0,'与第一位说话人相似，应归回 0');
 assert.equal(clusters.size(),2);
 assert.equal(clusters.assign(new Float32Array([0,0,1,0])),2,'第三种声纹新建说话人');
 assert.equal(clusters.size(),3);
});

test('说话人聚类：零向量不产生误匹配',()=>{
 const {SpeakerClusters}=loadApp('LifelogASR',{'@kit.CoreFileKit':{fileIo:{}},'sherpa_onnx':{},'libturbo_audio.so':{},'./OggOpus':loadApp('OggOpus'),'./VoiceRegistry':loadApp('VoiceRegistry')},{setTimeout:(f)=>{f();return 0;},clearTimeout:()=>{}});
 const clusters=new SpeakerClusters(0.7);
 clusters.assign(new Float32Array([1,0,0]));
 assert.equal(clusters.assign(new Float32Array([0,0,0])),1,'零向量不会匹配到已有说话人');
});

test('录音也能走本地转写：按 240 字节一帧、20ms 帧长',async()=>{
 const s=setup();
 s.files.set('/files/seg/source.rawopus',new Uint8Array(240*50).fill(9));
 const out=await s.asr.transcribeRecording('/files/seg/source.rawopus');
 assert.equal(out.frames,50,'按 240 字节一帧切分');
 assert(Math.abs(out.seconds-1)<0.001,'50 帧 × 20ms = 1 秒');
 assert.equal(s.decoded(),50,'每帧都解码');
});

test('声纹角色库：编码/解码往返、按时序排列、上限与去重',()=>{
 const {VoiceRegistry}=loadApp('VoiceRegistry',{
   '@kit.CoreFileKit':{fileIo:{accessSync:()=>false,openSync:()=>({fd:1}),closeSync:()=>{},writeSync:()=>0,fsyncSync:()=>{},readTextSync:()=>'',unlinkSync:()=>{}}},
   '@kit.ArkTS':{util:{TextEncoder:class{encodeInto(str){return new TextEncoder().encode(str);}},Base64Helper:class{encodeToStringSync(bytes){return Buffer.from(bytes).toString('base64');}decodeSync(text){return new Uint8Array(Buffer.from(text,'base64'));}}}}
 });
 const v=new Float32Array([0.5,-1,2.25,0,0.125,-0.25,3,1]);
 const round=VoiceRegistry.decode(VoiceRegistry.encode(v));
 assert.equal(round.length,v.length);
 for(let i=0;i<v.length;i++)assert(Math.abs(round[i]-v[i])<1e-6,'浮点往返无损');
 const reg=new VoiceRegistry();
 const now=Date.now();
 reg.bind('',"老板","产品负责人",new Float32Array([1,0,0,0,0,0,0,0]),now);
 assert.equal(reg.roles.length,1);
 assert.equal(reg.byId(reg.roles[0].id).name,'老板');
 assert.equal(reg.cards(),"- 老板：产品负责人");
 const match=reg.match(new Float32Array([0.98,0.05,0,0,0,0,0,0]));
 assert(match.role&&match.role.name==='老板','相似声纹命中角色');
 const miss=reg.match(new Float32Array([0,1,0,0,0,0,0,0]));
 assert.equal(miss.role,undefined,'不像的人不会乱认');
 assert.throws(()=>reg.bind('','','',new Float32Array([1,0,0,0,0,0,0,0]),now),/名字/);
});

test('声纹角色库：同一个 id 更新样本不新增角色',()=>{
 const {VoiceRegistry}=loadApp('VoiceRegistry',{
   '@kit.CoreFileKit':{fileIo:{accessSync:()=>false,openSync:()=>({fd:1}),closeSync:()=>{},writeSync:()=>0,fsyncSync:()=>{},readTextSync:()=>'',unlinkSync:()=>{}}},
   '@kit.ArkTS':{util:{TextEncoder:class{encodeInto(str){return new TextEncoder().encode(str);}},Base64Helper:class{encodeToStringSync(bytes){return Buffer.from(bytes).toString('base64');}decodeSync(text){return new Uint8Array(Buffer.from(text,'base64'));}}}}
 });
 const reg=new VoiceRegistry();
 const role=reg.bind('','甲','',new Float32Array([1,0,0,0,0,0,0,0]),1);
 reg.bind(role.id,'甲','再见到一次',new Float32Array([0.9,0.1,0,0,0,0,0,0]),2);
 assert.equal(reg.roles.length,1,'同 id 不新增');
 assert.equal(reg.roles[0].samples,2,'样本数累加');
 assert.equal(reg.roles[0].bio,'再见到一次');
});

test('old worker completion cannot release a replacement worker or overwrite its status',async()=>{
 const {asr}=setup({frames:0});asr.ensureExtracted=async()=>{};
 let resolve,entered;const ready=new Promise(r=>entered=r);const old={lastNote:'old',transcribe:()=>new Promise(r=>{resolve=r;entered();})};asr.engine=old;
 const work=asr.transcribe('synthetic.ogg');const rejected=assert.rejects(work,/ASR_LIFETIME_ENDED/);await ready;
 asr.engine={lastNote:'new'};asr.busy=true;asr.note='new work';
 resolve({utterances:[],speakers:[]});await rejected;
 assert.equal(asr.busy,true);assert.equal(asr.note,'new work');
});

test('bounded window replays codec history, reports original timestamps and filters context-only utterances',async()=>{
 const s=setup({frames:100,speechAt:[1,2,3,4]});
 const result=await s.asr.transcribeWindow('/files/seg/audio.ogg','lifelog',{cursor:50,coreFrames:25,contextFrames:25,sealed:true});
 assert.equal(s.decoded(),100,'prefix is decoded for exact Opus state, never recognized');
 assert.equal(result.windowed,true);assert.equal(result.windowStartFrame,50);assert.equal(result.windowEndFrame,75);assert.equal(result.seconds,6);
 assert.deepEqual(Array.from(result.utterances,p=>[p.start,p.end]),[[2.5,3.5],[3.5,4.5]]);
 assert.equal(result.speechSeconds,2);assert(result.utterances.every(p=>(p.start+p.end)/2>=3&&(p.start+p.end)/2<4.5));
});
test('window waits for future context and rejects invalid committed OGG before recognition',async()=>{
 const s=setup({frames:100});
 await assert.rejects(s.asr.transcribeWindow('/files/seg/audio.ogg','lifelog',{cursor:75,coreFrames:25,contextFrames:25,sealed:false}),/WAITING_AUDIO/);
 assert.equal(s.decoded(),0);
 const raw=s.files.get('/files/seg/audio.ogg');raw[raw.length-20]^=1;
 // A readiness-only poll has no committed index; malformed pages may be
 // rejected by CRC before a previously committed prefix digest is available.
 await assert.rejects(s.asr.transcribeWindow('/files/seg/audio.ogg','lifelog',{cursor:0,coreFrames:25,contextFrames:25,sealed:true}),/PREFIX_CHANGED|OGG_CRC_INVALID/);
 assert.equal(s.decoded(),0);
});

test('window source prefix hash prevents combining checkpoints with changed original audio',async()=>{
 const s=setup({frames:100});const request={cursor:0,coreFrames:25,contextFrames:25,sealed:true};
 const first=await s.asr.transcribeWindow('/files/seg/audio.ogg','lifelog',request);
 assert.match(first.sourcePrefixSha256,/^[a-f0-9]{64}$/);assert(first.sourcePrefixBytes>0);
 await assert.rejects(s.asr.transcribeWindow('/files/seg/audio.ogg','lifelog',{...request,cursor:25,expectedPrefixBytes:first.sourcePrefixBytes,expectedPrefixSha256:'f'.repeat(64)}),/PREFIX_CHANGED/);
});

test('serial Worker recognition and codec replay do not depend on background-throttled UI timers',async()=>{
 const s=setup({frames:300,speechAt:[1,2,3]});
 for(const name of ['model.int8.onnx','tokens.txt','silero_vad.onnx','embedding_zh.onnx'])s.dirs.add('/files/asr-models/'+name);
 s.asr.initializeWorker('/files');
 const out=await s.asr.transcribeWindow('/files/seg/audio.ogg','lifelog',{cursor:150,coreFrames:100,contextFrames:50,sealed:true});
 assert.equal(s.decoded(),300);assert.equal(out.windowEndFrame,250);assert.equal(s.timerDelays.length,0);
 assert.equal(s.asr.busy,false);
});

test('main-thread fallback still yields for UI rendering during decode and recognition',async()=>{
 const s=setup({frames:100,speechAt:[1,2,3]});await s.asr.transcribe('/files/seg/audio.ogg');
 assert.equal(s.timerDelays[0],50);assert(s.timerDelays.filter(ms=>ms===0).length>=2);assert.equal(s.decoded(),100);
});

test('immediate words explicitly defer expensive embeddings and retain unknown speaker attribution',async()=>{
 const s=setup({frames:100,speechAt:[1,2,3]});
 const out=await s.asr.transcribeWindow('/files/seg/audio.ogg','lifelog',{cursor:0,coreFrames:100,contextFrames:0,sealed:true,includeSpeakers:false});
 assert.equal(out.speakerProcessing,'pending');assert.equal(s.embeddingCalls(),0);assert.equal(s.decoded(),100);
 assert(out.utterances.length>0);assert(out.utterances.every(u=>u.speaker===-1));assert.equal(out.speakers.length,0);
 assert.match(lifelogMarkdownText(out),/说话人分析待处理/);
 const full=setup({frames:100,speechAt:[1,2,3]});const refined=await full.asr.transcribeWindow('/files/seg/audio.ogg','lifelog',{cursor:0,coreFrames:100,contextFrames:0,sealed:true});
 assert.equal(refined.speakerProcessing,'processed');assert(full.embeddingCalls()>0,'existing full mode keeps speaker analysis');
 await assert.rejects(s.asr.transcribeWindow('/files/seg/audio.ogg','lifelog',{sealed:true,includeSpeakers:'false'}),/SPEAKER_MODE_INVALID/);
});


test('token starts split a crossing utterance between adjacent windows without midpoint loss',async()=>{
 const recognized={text:'甲乙丙',lang:'zh',tokens:['甲','乙','丙'],timestamps:[.1,.5,.9]};
 const run=async(cursor)=>{const s=setup({speechAt:[2],recognizerResult:recognized});return s.asr.transcribeWindow('/files/seg/audio.ogg','lifelog',{cursor,coreFrames:25,contextFrames:25,sealed:true,includeSpeakers:false});};
 const a=await run(0),b=await run(25);
 assert.equal(a.boundaryProcessing,'token_starts');assert.equal(b.boundaryProcessing,'token_starts');
 assert.equal(a.utterances.map(u=>u.text).join(''),'甲');assert.equal(b.utterances.map(u=>u.text).join(''),'乙丙');
 assert.equal(b.utterances[0].start,1.5);assert.equal(b.utterances[0].tokenStarts[0],1.5);
 const full=setup({speechAt:[2],recognizerResult:recognized});
 assert.equal((await full.asr.transcribe('/files/seg/audio.ogg')).utterances[0].text,recognized.text);
});
test('missing or ITN-mismatched token starts retain legacy text and expose unverified boundary',async()=>{
 for(const recognizerResult of [{text:'12',lang:'zh',tokens:['一','二'],timestamps:[.1,.5]},{text:'原文',lang:'zh'}]){
  const s=setup({speechAt:[2],recognizerResult});
  const out=await s.asr.transcribeWindow('/files/seg/audio.ogg','lifelog',{cursor:0,coreFrames:34,contextFrames:0,sealed:true,includeSpeakers:false});
  assert.equal(out.boundaryProcessing,'unverified');assert.equal(out.utterances[0].text,recognizerResult.text);
  assert.match(lifelogMarkdownText(out),/窗口边界未核实/);
 }
});

test('serial window PCM fed to VAD equals fresh full-history decoding across cache eviction',async()=>{
 const s=setup({frames:1000,speechAt:[],stateful:true});
 for(const cursor of [0,167,334,501,668,835]){
  const request={cursor,coreFrames:167,contextFrames:83,sealed:true,includeSpeakers:false};
  s.waveforms.length=0;await s.asr.transcribeWindow('/files/seg/audio.ogg','lifelog',request);
  const fresh=setup({frames:1000,speechAt:[],stateful:true});await fresh.asr.transcribeWindow('/files/seg/audio.ogg','lifelog',request);
  assert.deepEqual(s.waveforms,fresh.waveforms);
 }
 assert.equal(s.totalDecoded(),1000);assert.equal(s.resets(),1);
 // A whole-source call invalidates the rolling native state before reset.
 await s.asr.transcribe('/files/seg/audio.ogg');assert.equal(s.totalDecoded(),2000);
 await s.asr.transcribeWindow('/files/seg/audio.ogg','lifelog',{cursor:0,coreFrames:167,contextFrames:83,sealed:true});
 assert.equal(s.totalDecoded(),2250);assert.equal(s.resets(),3);
});
test('codec diagnostic compares actual mock PCM digests without ASR and rejects oversized sources',async()=>{
 const s=setup({frames:551,stateful:true});const r=await s.asr.checkWindowCodec('/files/seg/audio.ogg');
 assert.equal(r.equivalent,true);assert.equal(r.windows.length,4);assert.equal(r.windows.reduce((n,w)=>n+w.decodedFrames,0),551);
 assert(r.windows.every(w=>w.equal&&w.cachedSha256===w.referenceSha256&&w.retainedFrames<=512));assert.equal(s.sentences(),0);assert.equal(s.asr.busy,false);
 const large=setup({frames:2001});await assert.rejects(large.asr.checkWindowCodec('/files/seg/audio.ogg'),/SIZE/);assert.equal(large.totalDecoded(),0);assert.equal(large.asr.busy,false);
});

test('growing complete OGG pages reuse native history while binding each verified prefix revision',async()=>{
 const s=setup({frames:0,speechAt:[],stateful:true}),chunks=[],writer=new OggOpusWriter(b=>chunks.push(b),7,50);
 const append=n=>{for(let i=0;i<n;i++)writer.push(new Uint8Array(240).fill(3));};
 const publish=()=>{const bytes=Uint8Array.from(Buffer.concat(chunks.map(b=>Buffer.from(b))));s.files.set('/files/seg/audio.ogg',bytes);return bytes;};
 append(251);let previous;
 for(const cursor of [0,167,334,501]){
  if(cursor===167||cursor===334)append(200);if(cursor===501)writer.finish();const bytes=publish();
  const request={cursor,coreFrames:167,contextFrames:83,sealed:cursor===501,includeSpeakers:false,
   expectedPrefixBytes:previous?.sourcePrefixBytes||0,expectedPrefixSha256:previous?.sourcePrefixSha256||''};
  s.waveforms.length=0;const out=await s.asr.transcribeWindow('/files/seg/audio.ogg','lifelog',request);
  const fresh=setup({frames:0,speechAt:[],stateful:true});fresh.files.set('/files/seg/audio.ogg',bytes);
  await fresh.asr.transcribeWindow('/files/seg/audio.ogg','lifelog',request);assert.deepEqual(s.waveforms,fresh.waveforms);
  if(previous)assert.notEqual(out.sourcePrefixSha256,previous.sourcePrefixSha256);previous=out;
 }
 assert.equal(s.resets(),1);assert.equal(s.totalDecoded(),651);
});

test('waiting for growing pages preserves verified PCM; ready windows still equal independent decoding',async()=>{
 const s=setup({frames:0,speechAt:[],stateful:true}),chunks=[],writer=new OggOpusWriter(b=>chunks.push(b),7,50);
 const append=n=>{for(let i=0;i<n;i++)writer.push(new Uint8Array(240).fill(3));};
 const publish=()=>{const b=Uint8Array.from(Buffer.concat(chunks.map(b=>Buffer.from(b))));s.files.set('/files/seg/audio.ogg',b);return b;};
 const request=(cursor,previous)=>({cursor,coreFrames:167,contextFrames:83,sealed:false,includeSpeakers:false,
  expectedPrefixBytes:previous?.sourcePrefixBytes||0,expectedPrefixSha256:previous?.sourcePrefixSha256||''});
 append(300);publish();const first=await s.asr.transcribeWindow('/files/seg/audio.ogg','lifelog',request(0));
 for(const additional of [0,50,50]){
  append(additional);publish();
  await assert.rejects(s.asr.transcribeWindow('/files/seg/audio.ogg','lifelog',request(167,first)),/WAITING_AUDIO/);
  assert.equal(s.totalDecoded(),250);assert.equal(s.resets(),1);
 }
 append(200);const bytes=publish();s.waveforms.length=0;
 await s.asr.transcribeWindow('/files/seg/audio.ogg','lifelog',request(167,first));
 const fresh=setup({frames:0,speechAt:[],stateful:true});fresh.files.set('/files/seg/audio.ogg',bytes);
 await fresh.asr.transcribeWindow('/files/seg/audio.ogg','lifelog',request(167,first));
 assert.deepEqual(s.waveforms,fresh.waveforms);assert.equal(s.resets(),1);assert.equal(s.totalDecoded(),417);
 // A source mutation discovered during a readiness poll must still reject.
 const changed=bytes.slice();changed[changed.length-1]^=1;s.files.set('/files/seg/audio.ogg',changed);
 await assert.rejects(s.asr.transcribeWindow('/files/seg/audio.ogg','lifelog',request(334,first)),/PREFIX_CHANGED/);
});
