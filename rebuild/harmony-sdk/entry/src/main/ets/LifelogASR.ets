// 全天智记本地离线转写（全程不联网）：OGG/Opus 分段 → 逐帧解码 PCM → Silero VAD 切出语音段
// → SenseVoice 识别 → 时间轴文本 + Markdown。VAD 先剔除静音/无意义片段，只对有效语音做识别。
// 模型随 App 以原始资源（rawfile/models/…）打包，通过 resourceManager 读取，不需要联网。
import { common } from '@kit.AbilityKit';
import { fileIo as fs } from '@kit.CoreFileKit';
import { util } from '@kit.ArkTS';
import { hilog } from '@kit.PerformanceAnalysisKit';
import * as audio from 'libturbo_audio.so';
import { readOggOpusFrames, readOggOpusFrameOffsets } from './OggOpus';
import { AsrWindowRequest, planAsrWindow, windowOwnsUtterance } from './AsrWindows';
import { validAsrTokens, renderAsrTokens, ownsAsrToken } from './AsrTokenOwnership';
import { VoiceRegistry } from './VoiceRegistry';
import { recordingMono } from './RecordingChannels';
import { HarmonySha256 } from 'turbo_core';
import { OggFileSource, OggFileIndex } from './OggFileSource';
import { LifelogPcmWindow, CodecCheckResult, CodecWindowResult } from './LifelogPcmWindow';
import { cryptoFramework } from '@kit.CryptoArchitectureKit';
import {
  OfflineRecognizer, OfflineRecognizerConfig, OfflineModelConfig, OfflineSenseVoiceModelConfig,
  FeatureConfig, Samples, Vad, VadConfig, SileroVadConfig, TenVadConfig, listRawfileDir,
  SpeakerEmbeddingExtractor, SpeakerEmbeddingExtractorConfig
} from 'sherpa_onnx';

// 一条语音的声纹样本（用于两级聚类）。
export class UtteranceVoice { index:number=0;embedding:Float32Array=new Float32Array(0);seconds:number=0; }

// 说话人聚类：先按"够长的样本"做平均连接层次聚类（比逐条贪心吸收更不容易把不同人并成一人），
// 再把太短的样本按最近簇归属；相似度不过阈值就留 -1（宁可显示未知也不张冠李戴）。
export function clusterVoices(voices:UtteranceVoice[],threshold:number):number[]{
  const n=voices.length;
  const out:number[]=new Array<number>(n).fill(-1);
  if(!n)return out;
  const members:number[][]=[];const sums:Float32Array[]=[];
  const minSeconds=0.9, minDim=8;
  for(let i=0;i<n;i++){
    const v=voices[i];if(!v||v.embedding.length<minDim)continue;
    if(v.seconds>=minSeconds){members.push([i]);const c=new Float32Array(v.embedding.length);c.set(v.embedding);sums.push(c);}
  }
  const average=(k:number):Float32Array=>{const c=new Float32Array(sums[k].length);const count=members[k].length;for(let i=0;i<c.length;i++)c[i]=sums[k][i]/count;return c;};
  let merged=true;
  while(merged&&members.length>1){
    merged=false;
    const averages:Float32Array[]=[];for(let k=0;k<members.length;k++)averages.push(average(k));
    let bestI=-1,bestJ=-1,bestScore=threshold;
    for(let i=0;i<members.length;i++){
      for(let j=i+1;j<members.length;j++){
        const score=SpeakerClusters.cosine(averages[i],averages[j]);
        if(score>=bestScore){bestScore=score;bestI=i;bestJ=j;}
      }
    }
    if(bestI>=0){
      for(const m of members[bestJ]){members[bestI].push(m);const src=voices[m].embedding;for(let k=0;k<sums[bestI].length;k++)sums[bestI][k]+=src[k];}
      members.splice(bestJ,1);sums.splice(bestJ,1);merged=true;
    }
  }
  const centroids:Float32Array[]=[];for(let k=0;k<members.length;k++)centroids.push(average(k));
  for(let k=0;k<members.length;k++)for(const m of members[k])out[m]=k;
  // 短样本：找最近的簇（阈值放宽一点，避免短句被丢掉）
  for(let i=0;i<n;i++){
    const v=voices[i];if(!v||out[i]>=0||v.embedding.length<minDim)continue;
    let best=-1,bestScore=threshold-0.08;
    for(let k=0;k<centroids.length;k++){const score=SpeakerClusters.cosine(centroids[k],v.embedding);if(score>=bestScore){bestScore=score;best=k;}}
    out[i]=best;
  }
  return out;
}

// 说话人聚类：对每条语音取声纹嵌入，与已有说话人中心比余弦相似度；
// 够像就归到该人并更新中心，否则新建一位说话人。在线算法，内存恒定。
export class SpeakerClusters {
  private centroids:Float32Array[]=[];
  private counts:number[]=[];
  private threshold:number;
  constructor(threshold:number=0.62){this.threshold=threshold;}
  assign(embedding:Float32Array):number{
    let best=-1;let bestScore=-2;
    for(let index=0;index<this.centroids.length;index++){
      const score=SpeakerClusters.cosine(this.centroids[index],embedding);
      if(score>bestScore){bestScore=score;best=index;}
    }
    if(best>=0&&bestScore>=this.threshold){
      const centroid=this.centroids[best];const seen=this.counts[best];
      for(let i=0;i<centroid.length&&i<embedding.length;i++)centroid[i]=(centroid[i]*seen+embedding[i])/(seen+1);
      this.counts[best]=seen+1;
      return best;
    }
    const copy=new Float32Array(embedding.length);copy.set(embedding);
    this.centroids.push(copy);this.counts.push(1);
    return this.centroids.length-1;
  }
  size():number{return this.centroids.length;}
  centroid(index:number):Float32Array|undefined{return index>=0&&index<this.centroids.length?this.centroids[index]:undefined;}
  samplesOf(index:number):number{return index>=0&&index<this.counts.length?this.counts[index]:0;}
  static cosine(a:Float32Array,b:Float32Array):number{
    let dot=0,na=0,nb=0;
    const n=Math.min(a.length,b.length);
    for(let i=0;i<n;i++){dot+=a[i]*b[i];na+=a[i]*a[i];nb+=b[i]*b[i];}
    if(na<=0||nb<=0)return -2;
    return dot/Math.sqrt(na*nb);
  }
}

export class LifelogUtterance {
  start:number=0;end:number=0;text:string='';lang:string='';speaker:number=-1;
  alignment:string='unverified';tokens:string[]=[];tokenStarts:number[]=[];
}
export class LifelogSpeaker {
  index:number=0;name:string='';bio:string='';roleId:string='';embedding:string='';samples:number=0;
}
export class LifelogTranscript {
  utterances:LifelogUtterance[]=[];speakers:LifelogSpeaker[]=[];
  seconds:number=0;speechSeconds:number=0;frames:number=0;
  windowed:boolean=false;windowStartFrame:number=0;windowEndFrame:number=0;
  sourcePrefixBytes:number=0;sourcePrefixSha256:string='';
  speakerProcessing:string='unknown';
  boundaryProcessing:string='unknown';
}

export function formatClock(seconds:number):string{
  const total=Math.max(0,Math.round(seconds));
  const h=Math.floor(total/3600),m=Math.floor(total%3600/60),s=total%60;
  const mm=(m<10?'0':'')+m,ss=(s<10?'0':'')+s;
  return h>0?`${h}:${mm}:${ss}`:`${mm}:${ss}`;
}

export function speakerLabel(transcript:LifelogTranscript,index:number):string{
  for(const speaker of transcript.speakers){if(speaker.index===index&&speaker.name)return speaker.name;}
  return index>=0?`说话人${index+1}`:'';
}

export function lifelogMarkdown(title:string,transcript:LifelogTranscript):string{
  const lines:string[]=[`# ${title}`,'',
    `- 时长：${formatClock(transcript.seconds)}（有效语音 ${formatClock(transcript.speechSeconds)}）`,
    `- 生成：${new Date().toLocaleString()} · 本机离线转写，未上传`,''];
  const names:string[]=[];
  if(transcript.speakerProcessing==='pending')lines.push('- 说话人分析待处理；当前文字未确认归属。','');
  if(transcript.windowed&&transcript.boundaryProcessing!=='token_starts'&&transcript.boundaryProcessing!=='no_speech')lines.push('- 窗口边界未核实，跨窗语句可能重复或缺失。','');
  for(const speaker of transcript.speakers){if(speaker.name)names.push(`${speaker.name}${speaker.bio?`（${speaker.bio}）`:''}`);}
  if(names.length)lines.push(`- 说话人：${names.join('、')}`,'');
  for(const item of transcript.utterances){
    const label=speakerLabel(transcript,item.speaker);
    const who=label?`${label}　`:'';
    lines.push(`- **[${formatClock(item.start)}]** ${who}${item.text}`);
  }
  if(!transcript.utterances.length)lines.push('-（未检测到有效语音）');
  return lines.join('\n')+'\n';
}

// 后台转写引擎（Worker 线程）的结构化接口：由 AsrEngine.ets 实现，App 装配时注入。
// 单测环境不注入，transcribe 仍走同进程直跑路径，测试语义不变。
export interface AsrEngineHandle {
  lastNote: string;
  isClosed():boolean;
  isReady():boolean;
  isExitConfirmed():boolean;
  waitForExit():Promise<void>;
  load(): Promise<void>;
  transcribe(path: string, kind: string, timeoutMs?: number): Promise<LifelogTranscript>;
  transcribeWindow(path:string,kind:string,request:AsrWindowRequest,timeoutMs:number):Promise<LifelogTranscript>;
}

interface RawManager { getRawFileContent(name: string): Promise<Uint8Array> }

export class LifelogASR {
  note:string='本地模型未就绪';progress:number=0;busy:boolean=false;
  changed:()=>void=():void=>{};
  private logFile:string='';
  private manager:object|undefined=undefined;
  registry:VoiceRegistry|undefined=undefined;   // 由服务层注入：把说话人对到角色卡上
  engine:AsrEngineHandle|undefined=undefined;    // 由 App 装配注入：转写卸载到 Worker 线程
  requireWorker: boolean = false;
  private modelDir:string='';
  private lastTick:number=0;
  // 模型加载一次就留着复用：每段都重建会反复读 239MB 并造成内存尖峰（曾导致闪退）。
  private recognizerCache:OfflineRecognizer|undefined=undefined;
  private vadCache:Vad|undefined=undefined;
  private extractorCache:SpeakerEmbeddingExtractor|undefined=undefined;
  private oggIndex:OggFileIndex|undefined=undefined;
  private pcmWindow:LifelogPcmWindow=new LifelogPcmWindow(():void=>audio.lifelogReset(),():void=>audio.lifelogClose());
  private extracting:Promise<void>|undefined=undefined;
  private workerRuntime:boolean=false;
  private yieldCount:number=0;private yieldWaitMs:number=0;private recognitionMs:number=0;private embeddingMs:number=0;

  initialize(context:common.Context):void{
    this.pcmWindow.invalidate();this.oggIndex=undefined;
    this.workerRuntime=false;
    this.manager=context.resourceManager as object|undefined;
    this.logFile=context.filesDir+'/debug-asr.log';
    this.modelDir=context.filesDir+'/asr-models';
    this.dbg('init',(this.ready()?'ready':'missing')+' list='+this.probeList());
    // 模型从 rawfile 解包到 filesDir（一次性）：Worker 线程拿不到主线程的 resourceManager，
    // 需要真实文件路径；同时避免转写/加载霸占 UI 主线程（超过 6 秒会被系统判 appfreeze 杀掉）。
    // Extract on the first worker request, so opening the app does not read hundreds of MB.
  }

  // Worker 线程内的初始化：没有 resourceManager，模型走 filesDir 里的真实文件。
  initializeWorker(filesDir:string):void{
    this.pcmWindow.invalidate();this.oggIndex=undefined;
    this.workerRuntime=true;
    this.logFile=filesDir+'/debug-asr.log';
    this.modelDir=filesDir+'/asr-models';
    this.dbg('init-worker','modelDir='+this.modelDir);
  }

  private async yieldProcessing(delayMs:number=0):Promise<void>{
    // This thread owns one serial job. UI painting is on the main thread;
    // timer-based UI yields here can be throttled when the phone is asleep.
    // Keep main-thread fallback yields, and keep the caller's real deadline.
    if(this.workerRuntime){await Promise.resolve();return;}
    const before=Date.now();this.yieldCount++;
    await new Promise<void>((resolve:()=>void)=>{setTimeout(resolve,delayMs);});
    this.yieldWaitMs+=Math.max(0,Date.now()-before);
  }

  // 模型在 rawfile 里的相对路径 ↔ Worker 模式下的磁盘绝对路径。
  private resolveModelPath(name:string):string{
    return this.manager?name:`${this.modelDir}/${name.slice(name.lastIndexOf('/')+1)}`;
  }

  ensureExtracted():Promise<void>{
    if(!this.extracting)this.extracting=this.extractAll();
    return this.extracting;
  }

  private async extractAll():Promise<void>{
    if(!this.manager||!this.modelDir)return;
    const mgr=this.manager as RawManager;
    if(!fs.accessSync(this.modelDir)){
      try{fs.mkdirSync(this.modelDir,true);}catch(error){this.dbg('extract-mkdir',(error as Error).message+' '+this.modelDir);return;}
    }
    const files=['models/sensevoice/model.int8.onnx','models/sensevoice/tokens.txt','models/vad/silero_vad.onnx','models/diar/embedding_zh.onnx'];
    for(const name of files){
      try{
        const target=`${this.modelDir}/${name.slice(name.lastIndexOf('/')+1)}`;   // 解包目标始终是磁盘路径（本函数在主线程跑，manager 存在，不能走 resolveModelPath）
        // rawfile 在 HAP 里压缩存储拿不到原始 fd；一次性读进内存（最大 229MB）再分块写盘，写完改名。
        this.dbg('extract-step',name+' read');
        const content=await mgr.getRawFileContent(name);
        this.dbg('extract-step',name+' read-ok '+content.length);
        if(!content||content.length<=0)throw new Error('模型资源读取为空');
        let existed=false;
        try{existed=fs.accessSync(target);}catch(e){this.dbg('extract-step',name+' access-fail '+(e as Error).message);}
        if(existed){try{if(fs.statSync(target).size===content.length)continue;}catch(e){this.dbg('extract-step',name+' stat-fail '+(e as Error).message);}}

        const tmp=target+'.tmp';
        this.dbg('extract-step',name+' mkdir-ok');
        try{fs.unlinkSync(tmp);}catch(_){}
        this.dbg('extract-step',name+' open '+tmp);
        const out=fs.openSync(tmp,fs.OpenMode.CREATE|fs.OpenMode.READ_WRITE);
        this.dbg('extract-step',name+' open-ok');
        try{
          let written=0;
          while(written<content.length){const n=fs.writeSync(out.fd,content.slice(written,written+8388608).buffer);if(n<=0)break;written+=n;}
          fs.fsyncSync(out.fd);
        }finally{fs.closeSync(out.fd);}
        fs.renameSync(tmp,target);
      }catch(error){this.dbg('extract-fail',name+' '+(error as Error).message);}
    }
    this.dbg('extract','done');
  }

  log(event:string,extra:string=''):void{this.dbg(event,extra);}

  private dbg(event:string,extra:string=''):void{
    const line=JSON.stringify({t:Date.now(),ev:event,x:extra});
    hilog.info(0x2a02,'LifeLogASR','%{public}s',line);
    if(!this.logFile)return;
    try{
      const exists=fs.accessSync(this.logFile);
      const f=fs.openSync(this.logFile,fs.OpenMode.CREATE|fs.OpenMode.READ_WRITE);
      try{
        if(exists)fs.lseek(f.fd,fs.statSync(this.logFile).size,fs.WhenceType.SEEK_SET);
        const buf=new util.TextEncoder().encodeInto(line+'\n');
        let off=0;while(off<buf.length){const n=fs.writeSync(f.fd,buf.slice(off).buffer);if(n<=0)break;off+=n;}
        fs.fsyncSync(f.fd);
      }finally{fs.closeSync(f);}
    }catch(_){}
  }

  // 模型路径即 rawfile 内的相对路径，交给 resourceManager 读取。
  // 核心模型（缺失则无法转写）；声纹模型可选，缺失时只是不做说话人区分。
  modelFiles():string[]{return ['models/sensevoice/model.int8.onnx','models/sensevoice/tokens.txt','models/vad/silero_vad.onnx'];}

  missing():string[]{
    const out:string[]=[];
    for(const name of this.modelFiles()){
      if(!this.present(name))out.push(name);
    }
    return out;
  }

  private present(name:string):boolean{
    // Worker 模式：模型已解包到磁盘，直接查文件。
    if(!this.manager){
      if(!this.modelDir)return false;
      try{return fs.accessSync(this.resolveModelPath(name));}catch(_){return false;}
    }
    const cut=name.lastIndexOf('/');
    const dir=name.slice(0,cut),file=name.slice(cut+1);
    try{
      const entries=listRawfileDir(this.manager,dir);
      if(entries.length===0)return true;   // 列表接口不可用时不做否定判断，真缺失交给原生工厂报错
      // 实测 listRawfileDir 返回完整相对路径（models/sensevoice/model.int8.onnx），三种写法都认。
      for(const entry of entries){
        if(entry===name||entry===file||entry.endsWith('/'+file))return true;
      }
      return false;
    }catch(_){return true;}                // 同上
  }

  // 诊断：把 rawfile 目录列表结果记进调试日志。
  private probeList():string{
    if(!this.manager)return 'no-manager';
    try{
      const entries=listRawfileDir(this.manager,'models/sensevoice');
      return entries.length?entries.join('|'):'empty';
    }catch(error){return 'error:'+(error as Error).message;}
  }

  ready():boolean{return this.manager!==undefined&&this.missing().length===0;}

  private recognizer():OfflineRecognizer{
    if(this.recognizerCache)return this.recognizerCache;
    this.note='首次使用要加载本机模型（约 10 秒，之后复用）…';this.changed();
    const feat=new FeatureConfig();feat.sampleRate=16000;feat.featureDim=80;
    const model=new OfflineModelConfig();
    model.senseVoice=new OfflineSenseVoiceModelConfig();
    model.senseVoice.model=this.resolveModelPath('models/sensevoice/model.int8.onnx');
    model.senseVoice.language='zh';
    model.senseVoice.useItn=true;
    model.tokens=this.resolveModelPath('models/sensevoice/tokens.txt');
    model.numThreads=2;model.provider='cpu';model.debug=false;model.modelType='sense_voice';
    const config=new OfflineRecognizerConfig();
    config.featConfig=feat;config.modelConfig=model;config.decodingMethod='greedy_search';
    this.recognizerCache=this.manager?new OfflineRecognizer(config,this.manager):new OfflineRecognizer(config);
    return this.recognizerCache;
  }

  private vad():Vad{
    if(this.vadCache)return this.vadCache;
    const silero=new SileroVadConfig(this.resolveModelPath('models/vad/silero_vad.onnx'),0.5,0.25,0.5,512,12);
    const ten=new TenVadConfig('',0,0,0,0,0);
    this.vadCache=this.manager?new Vad(new VadConfig(silero,ten,16000,false,2,'cpu'),60,this.manager)
      :new Vad(new VadConfig(silero,ten,16000,false,2,'cpu'),60);
    return this.vadCache;
  }

  private readAll(path:string):Uint8Array{
    const file=fs.openSync(path,fs.OpenMode.READ_ONLY);
    try{
      const size=fs.statSync(file.fd).size;const out=new Uint8Array(size);let offset=0;
      while(offset<size){const part=new ArrayBuffer(Math.min(262144,size-offset));const n=fs.readSync(file.fd,part,{length:part.byteLength});if(n<=0)throw new Error('分段读取不完整');out.set(new Uint8Array(part,0,n),offset);offset+=n;}
      return out;
    }finally{fs.closeSync(file);}
  }

  // 逐段识别：每个 VAD 语音段独立走一次 SenseVoice，文本与时间戳一起产出；
  // 若声纹模型可用，同时为每段算嵌入并归入说话人（失败不影响转写）。
  private drainedLastPass:boolean=false;
  private drain(vad:Vad,recognizer:OfflineRecognizer,out:LifelogTranscript,extractor:SpeakerEmbeddingExtractor|undefined,collected:UtteranceVoice[]):void{
    this.drainedLastPass=false;
    while(!vad.isEmpty()){
      this.drainedLastPass=true;
      const segment=vad.front();
      const samples=segment.samples;const start=segment.start;
      const recognitionStarted=Date.now();const stream=recognizer.createStream();
      const input:Samples={samples:samples,sampleRate:16000};
      stream.acceptWaveform(input);
      recognizer.decode(stream);
      const result=recognizer.getResult(stream);
      this.recognitionMs+=Math.max(0,Date.now()-recognitionStarted);
      const text=result.text.trim();
      if(text.length>0){
        const item=new LifelogUtterance();
        item.start=start/16000;item.end=(start+samples.length)/16000;item.text=text;item.lang=result.lang;
        if(validAsrTokens(text,result.tokens,result.timestamps,0,samples.length/16000)){
          item.alignment='token_starts';item.tokens=result.tokens.slice();
          item.tokenStarts=result.timestamps.map((time:number):number=>item.start+time);
        }
        const utteranceIndex=out.utterances.length;
        if(extractor){
          const embeddingStarted=Date.now();
          try{
            const voice=extractor.createStream();
            voice.acceptWaveform(input);
            if(extractor.isReady(voice)){
              const embedding=extractor.compute(voice);
              const sample=new UtteranceVoice();
              sample.index=utteranceIndex;sample.embedding=embedding;sample.seconds=Math.max(0,item.end-item.start);
              collected.push(sample);
            }
          }catch(_){/* 取不到声纹就留给后面按最近簇归属 */}
          finally{this.embeddingMs+=Math.max(0,Date.now()-embeddingStarted);}
        }
        out.utterances.push(item);
      }
      vad.pop();
    }
  }

  // 用每个说话人簇的平均声纹去匹配角色卡：命中用角色名，未命中保留"说话人N"并把样本带回给用户命名。
  private resolveSpeakers(collected:UtteranceVoice[],out:LifelogTranscript):void{
    if(!collected.length)return;
    const sums:Map<number,Float32Array>=new Map<number,Float32Array>();
    const counts:Map<number,number>=new Map<number,number>();
    for(const sample of collected){
      const label=out.utterances[sample.index]?.speaker??-1;
      if(label<0)continue;
      const current=sums.get(label);
      if(!current){const copy=new Float32Array(sample.embedding.length);copy.set(sample.embedding);sums.set(label,copy);counts.set(label,1);}
      else{for(let i=0;i<current.length;i++)current[i]+=sample.embedding[i];counts.set(label,(counts.get(label)??1)+1);}
    }
    const labels:number[]=[];
    sums.forEach((_value:Float32Array,key:number):void=>{labels.push(key);});
    labels.sort((a:number,b:number):number=>a-b);
    for(const label of labels){
      const sum=sums.get(label);if(!sum)continue;
      const count=counts.get(label)??1;
      const centroid=new Float32Array(sum.length);
      for(let i=0;i<centroid.length;i++)centroid[i]=sum[i]/count;
      const speaker=new LifelogSpeaker();
      speaker.index=label;speaker.samples=count;
      try{speaker.embedding=VoiceRegistry.encode(centroid);}catch(_){speaker.embedding='';}
      if(this.registry&&speaker.embedding){
        const found=this.registry.match(centroid);
        if(found.role){speaker.roleId=found.role.id;speaker.name=found.role.name;speaker.bio=found.role.bio;}
      }
      out.speakers.push(speaker);
    }
  }

  private embeddingExtractor():SpeakerEmbeddingExtractor|undefined{
    if(this.extractorCache)return this.extractorCache;
    if(!this.manager&&!this.modelDir)return undefined;
    if(!this.present('models/diar/embedding_zh.onnx'))return undefined;
    try{
      const config=new SpeakerEmbeddingExtractorConfig();
      config.model=this.resolveModelPath('models/diar/embedding_zh.onnx');
      config.numThreads=1;config.provider='cpu';config.debug=false;
      this.extractorCache=this.manager?new SpeakerEmbeddingExtractor(config,this.manager):new SpeakerEmbeddingExtractor(config);
      return this.extractorCache;
    }catch(_){return undefined;}
  }

  // Worker 内预热：把三个模型真正建出来（耗时原生调用全部留在 Worker 线程）。
  warmup():void{
    this.recognizer();this.vad();this.embeddingExtractor();
  }

  // Worker 转出的结果在主线程补角色卡：声纹质心比中角色就改名（不过阈值保持"说话人N"）。
  applyRoles(transcript:LifelogTranscript):void{
    if(!this.registry)return;
    for(const speaker of transcript.speakers){
      if(!speaker.embedding)continue;
      try{
        const centroid=VoiceRegistry.decode(speaker.embedding);
        const found=this.registry.match(centroid);
        if(found.role){speaker.roleId=found.role.id;speaker.name=found.role.name;speaker.bio=found.role.bio;}
      }catch(_){}
    }
  }

  // 预热：模型加载挪到 Worker 线程（主线程同步加载会超过 6 秒触发 appfreeze，实测被杀）。
  async preload():Promise<void>{
    if (this.requireWorker && !this.engine) throw new Error('转写线程不可用，请重新打开应用');
    if(this.engine){
      if(this.busy)return;
      try{await this.ensureExtracted();}catch(_){}
      try{await this.engine.load();this.dbg('preload','ok');}
      catch(error){this.dbg('preload-fail',(error as Error).message);}
      return;
    }
    if(this.busy||this.recognizerCache||!this.manager)return;
    if(this.missing().length)return;
    this.preloading=true;this.changed();
    await new Promise<void>((resolve:()=>void)=>{setTimeout(resolve,200);});
    try{this.warmup();this.dbg('preload','ok');}
    catch(error){this.dbg('preload-fail',(error as Error).message);}
    finally{this.preloading=false;this.changed();}
  }
  preloading:boolean=false;

  // 引擎路径：真正的解码/识别在 Worker 线程执行，这里只负责状态与角色卡。
  private async transcribeViaEngine(path:string,kind:string,timeoutMs:number=0,request:AsrWindowRequest|undefined=undefined):Promise<LifelogTranscript>{
    if(this.busy)throw new Error('转写进行中');
    this.busy=true;this.progress=0;
    this.note='正在准备本地模型…';this.changed();
    const engine=this.engine;
    if(!engine)throw new Error('转写引擎不可用');
    try{
      await this.ensureExtracted();
      if(engine!==this.engine)throw new Error('ASR_LIFETIME_ENDED');
      const out=request?await engine.transcribeWindow(path,kind,request,timeoutMs):await engine.transcribe(path,kind,timeoutMs);
      if(engine!==this.engine)throw new Error('ASR_LIFETIME_ENDED');
      this.applyRoles(out);
      this.progress=100;
      if(engine.lastNote)this.note=engine.lastNote;
      return out;
    }catch(error){
      const message=(error as Error).message;
      if(engine===this.engine){this.note='转写失败：'+message;this.dbg('fail',message);}throw new Error(message);
    }finally{if(engine===this.engine){this.busy=false;this.changed();}}
  }

  async transcribe(oggPath:string,timeoutMs:number=0):Promise<LifelogTranscript>{
    if (this.requireWorker && !this.engine) throw new Error('转写线程不可用，请重新打开应用');
    if(this.engine)return this.transcribeViaEngine(oggPath,'lifelog',timeoutMs);
    const raw=this.readAll(oggPath);
    const offsets=readOggOpusFrameOffsets(raw);
    return this.run(offsets.length,(index:number):Float32Array=>{
      const frame=raw.slice(offsets[index],offsets[index]+240);
      const pcm=new Int16Array(audio.lifelogDecode(frame.buffer) as ArrayBuffer);
      const out=new Float32Array(pcm.length);
      for(let i=0;i<pcm.length;i++)out[i]=pcm[i]/32768;
      return out;
    },offsets.length*0.06,'lifelog');
  }

  // 本机录音：raw 里 240 字节/帧的双声道 20ms 帧，左右相加取平均变单声道。
  async transcribeRecording(rawPath:string,channel:string='mix',timeoutMs:number=0):Promise<LifelogTranscript>{
    if(channel!=='mix'&&channel!=='left'&&channel!=='right')throw new Error('recording-channel-invalid');
    if (this.requireWorker && !this.engine) throw new Error('转写线程不可用，请重新打开应用');
    if(this.engine)return this.transcribeViaEngine(rawPath,channel==='mix'?'recording':'recording_'+channel,timeoutMs);
    const raw=this.readAll(rawPath);
    const count=Math.floor(raw.length/240);
    return this.run(count,(index:number):Float32Array=>{
      const frame=raw.slice(index*240,index*240+240);
      const pcm=new Int16Array(audio.recordingDecode(frame.buffer) as ArrayBuffer);
      return recordingMono(pcm,channel);
    },count*0.02,'recording');
  }

  async transcribeWindow(path:string,kind:string,request:AsrWindowRequest,timeoutMs:number=30000):Promise<LifelogTranscript>{
    if(!['recording','recording_left','recording_right','lifelog'].includes(kind)||typeof request.sealed!=='boolean')throw new Error('ASR_WINDOW_KIND_INVALID');
    if(request.includeSpeakers!==undefined&&typeof request.includeSpeakers!=='boolean')throw new Error('ASR_WINDOW_SPEAKER_MODE_INVALID');
    if(this.requireWorker&&!this.engine)throw new Error('转写线程不可用，请重新打开应用');
    if(this.engine)return this.transcribeViaEngine(path,kind,timeoutMs,request);
    if(this.busy)throw new Error('转写进行中');
    if(fs.statSync(path).size>16000000)throw new Error('ASR_WINDOW_SOURCE_TOO_LARGE');
    const life=kind==='lifelog';let source:OggFileSource|undefined=undefined;let waitingForPages:boolean=false;
    const previousSha=this.oggIndex?.sha256||'';
    try{
    const raw=life?new Uint8Array(0):this.readAll(path);let offsets:number[]=[];
    let committedBytes=Math.floor(raw.length/240)*240;
    if(life){
      const before=Date.now();source=new OggFileSource(path,request.sealed,this.oggIndex,request.expectedPrefixBytes||0,request.expectedPrefixSha256||'');
      offsets=source.index.prefix.offsets;committedBytes=source.index.prefix.committedBytes;
      this.dbg('ogg-index',JSON.stringify({frames:offsets.length,pages:source.index.prefix.pages,scannedPages:source.scannedPages,reusedFrames:source.reusedFrames,elapsedMs:Date.now()-before,blockBytes:65536}));
    }
    else if(request.sealed&&raw.length%240!==0)throw new Error('RECORDING_ARCHIVE_INCOMPLETE');
    const count=life?offsets.length:Math.floor(raw.length/240),step=life?0.06:0.02;
    const plan=planAsrWindow(count,request.cursor,request.coreFrames,request.contextFrames,request.sealed);
    if(!plan.ready){waitingForPages=!plan.done;throw new Error(plan.done?'ASR_WINDOW_DONE':'ASR_WINDOW_WAITING_AUDIO');}
    // A readiness poll has not touched the decoder. Keep both the previous
    // verified index and its PCM binding until a window can actually run.
    // Advancing only the index here would make the next call discard valid PCM.
    if(source)this.oggIndex=source.index;
    const expectedBytes=request.expectedPrefixBytes||0,expectedSha=request.expectedPrefixSha256||'';
    const sha=(bytes:Uint8Array):string=>Array.from(new HarmonySha256().digest(bytes)).map((n:number):string=>n.toString(16).padStart(2,'0')).join('');
    if(!Number.isSafeInteger(expectedBytes)||expectedBytes<0||expectedBytes>committedBytes||(expectedBytes>0&&!/^[a-f0-9]{64}$/.test(expectedSha)))throw new Error('ASR_SOURCE_CHECKPOINT_INVALID');
    if(!life&&expectedBytes>0&&sha(raw.slice(0,expectedBytes))!==expectedSha)throw new Error('ASR_SOURCE_PREFIX_CHANGED');
    const sourceSha=source?source.index.sha256:sha(raw.slice(0,committedBytes));
    if(life)this.pcmWindow.begin(path,previousSha,plan.decodeStart,plan.decodeEnd);
    const nativeDecode=(index:number):Float32Array=>{
      const frame=source?source.frame(index):raw.slice(index*240,index*240+240);
      if(!life){const pcm=new Int16Array(audio.recordingDecode(frame.buffer) as ArrayBuffer);return recordingMono(pcm,kind==='recording_left'?'left':kind==='recording_right'?'right':'mix');}
      const pcm=new Int16Array(audio.lifelogDecode(frame.buffer) as ArrayBuffer);const out=new Float32Array(pcm.length);
      for(let i=0;i<pcm.length;i++)out[i]=pcm[i]/32768;return out;
    };
    const decode=(index:number):Float32Array=>life?this.pcmWindow.read(index,nativeDecode):nativeDecode(index);
    const result=await this.run(plan.decodeEnd-plan.decodeStart,decode,(plan.decodeEnd-plan.decodeStart)*step,life?'lifelog':'recording',plan.decodeStart,request.includeSpeakers!==false,life);
    source?.verifyUnchanged();
    if(life){this.pcmWindow.commit(sourceSha);this.logPcmWindow();}
    const sourceEnd=count*step,offset=plan.decodeStart*step,owned:LifelogUtterance[]=[];
    let aligned=0,unverified=0,rawTokens=0,ownedTokens=0;
    for(const part of result.utterances){
      part.start=Math.max(0,part.start+offset);part.end=Math.min(sourceEnd,part.end+offset);
      if(part.alignment==='token_starts'){
        aligned++;rawTokens+=part.tokens.length;
        const tokens:string[]=[],starts:number[]=[];
        for(let i=0;i<part.tokens.length;i++){
          const time=part.tokenStarts[i]+offset;
          if(ownsAsrToken(time,plan.coreStart*step,plan.coreEnd*step,sourceEnd)){tokens.push(part.tokens[i]);starts.push(time);}
        }
        if(!tokens.length||!renderAsrTokens(tokens))continue;
        ownedTokens+=tokens.length;part.tokens=tokens;part.tokenStarts=starts;part.text=renderAsrTokens(tokens);
        part.start=starts[0];part.end=Math.max(part.start,Math.min(part.end,plan.coreEnd*step));owned.push(part);
      }else{
        unverified++;if(windowOwnsUtterance(part.start,part.end,plan,step))owned.push(part);
      }
    }
    result.utterances=owned;result.boundaryProcessing=unverified?'unverified':aligned?'token_starts':'no_speech';
    this.dbg('window-alignment',JSON.stringify({aligned,unverified,rawTokens,ownedTokens,state:result.boundaryProcessing}));
    result.speakers=result.speakers.filter((speaker:LifelogSpeaker):boolean=>result.utterances.some((part:LifelogUtterance):boolean=>part.speaker===speaker.index));
    result.seconds=count*step;result.frames=count;result.windowed=true;result.windowStartFrame=plan.coreStart;result.windowEndFrame=plan.coreEnd;
    result.sourcePrefixBytes=committedBytes;result.sourcePrefixSha256=sourceSha;
    result.speechSeconds=result.utterances.reduce((sum:number,part:LifelogUtterance):number=>sum+part.end-part.start,0);
    return result;
    }catch(error){if(life&&!waitingForPages)this.pcmWindow.invalidate();throw new Error((error as Error).message);}
    finally{source?.close();}
  }

  private logPcmWindow():void{
    this.dbg('pcm-window',JSON.stringify({decodedFrames:this.pcmWindow.decodedFrames,reusedFrames:this.pcmWindow.reusedFrames,
      replayedFrames:this.pcmWindow.replayedFrames,retainedFrames:this.pcmWindow.retainedFrames,
      reset:this.pcmWindow.resetForWindow,capacityFrames:LifelogPcmWindow.capacity}));
  }

  // Isolated, finite native-codec equivalence diagnostic. No models, transcript,
  // capture, task dispatch or uploads. A fresh Worker owns this decoder.
  async checkWindowCodec(path:string):Promise<CodecCheckResult>{
    if(this.busy||this.engine)throw new Error('CODEC_PROBE_BUSY');
    this.busy=true;let source:OggFileSource|undefined=undefined;
    const report=new CodecCheckResult();this.pcmWindow.invalidate();
    try{
      source=new OggFileSource(path,true,undefined,0,'');report.frames=source.index.prefix.offsets.length;
      if(report.frames<1||report.frames>2000)throw new Error('CODEC_PROBE_SIZE');
      const input=source;const sourceSha=input.index.sha256;
      const decode=(index:number):Float32Array=>{
        const pcm=new Int16Array(audio.lifelogDecode(input.frame(index).buffer) as ArrayBuffer);
        const samples=new Float32Array(pcm.length);for(let i=0;i<pcm.length;i++)samples[i]=pcm[i]/32768;return samples;
      };
      for(let cursor=0;cursor<report.frames;cursor+=167){
        const plan=planAsrWindow(report.frames,cursor,167,83,true);const item=new CodecWindowResult();
        item.start=plan.decodeStart;item.end=plan.decodeEnd;
        this.pcmWindow.begin(path,cursor?sourceSha:'',item.start,item.end);
        const md=cryptoFramework.createMd('SHA256');
        for(let i=Math.min(item.start,this.pcmWindow.nextDecodedFrame);i<item.end;i++){
          const samples=this.pcmWindow.read(i,decode);if(i>=item.start)md.updateSync({data:new Uint8Array(samples.buffer)});
          if(i%40===39)await this.yieldProcessing();
        }
        this.pcmWindow.commit(sourceSha);
        item.cachedSha256=Array.from(md.digestSync().data).map((n:number):string=>n.toString(16).padStart(2,'0')).join('');
        item.decodedFrames=this.pcmWindow.decodedFrames;item.reusedFrames=this.pcmWindow.reusedFrames;
        item.replayedFrames=this.pcmWindow.replayedFrames;item.retainedFrames=this.pcmWindow.retainedFrames;report.windows.push(item);
      }
      this.pcmWindow.invalidate();
      // Reference runs must happen after all rolling windows: resetting the
      // same native environment earlier would invalidate the rolling state.
      for(const item of report.windows){
        audio.lifelogReset();const md=cryptoFramework.createMd('SHA256');
        for(let i=0;i<item.end;i++){
          const samples=decode(i);if(i>=item.start)md.updateSync({data:new Uint8Array(samples.buffer)});
          if(i%40===39)await this.yieldProcessing();
        }
        item.referenceSha256=Array.from(md.digestSync().data).map((n:number):string=>n.toString(16).padStart(2,'0')).join('');
        item.equal=item.referenceSha256===item.cachedSha256;
      }
      input.verifyUnchanged();report.equivalent=report.windows.every((item:CodecWindowResult):boolean=>item.equal);return report;
    }finally{this.pcmWindow.invalidate();try{audio.lifelogClose();}finally{source?.close();this.busy=false;}}
  }

  private async run(frames:number,decode:(index:number)=>Float32Array,seconds:number,kind:string,prefixFrames:number=0,includeSpeakers:boolean=true,rolling:boolean=false):Promise<LifelogTranscript>{
    if(this.busy)throw new Error('转写进行中');
    const absent=this.missing();
    if(absent.length)throw new Error('本地模型缺失：'+absent.join('、'));
    if(!rolling)this.pcmWindow.invalidate();
    this.busy=true;this.progress=0;
    this.note=this.recognizerCache?'正在本地转写…':'首次使用：正在加载本机模型（约 10 秒）…';
    this.changed();
    this.yieldCount=0;this.yieldWaitMs=0;this.recognitionMs=0;this.embeddingMs=0;
    const startedAt=Date.now();
    this.dbg('run-start',JSON.stringify({worker:this.workerRuntime,kind,frames,prefixFrames,includeSpeakers}));
    // Only the main-thread fallback needs to yield for UI painting.
    await this.yieldProcessing(50);
    const tick=():void=>{const now=Date.now();if(now-this.lastTick>=400){this.lastTick=now;this.changed();}};
    try{
      const out=new LifelogTranscript();out.frames=frames;out.seconds=seconds;
      const vad=this.vad();const recognizer=this.recognizer();
      // VAD 实例跨次复用，必须清空内部缓存：否则时间轴会接着上一段的样本数继续累加（时间戳会跑到音频长度之外）。
      try{vad.reset();vad.clear();}catch(_){}
      const extractor=includeSpeakers?this.embeddingExtractor():undefined;
      out.speakerProcessing=includeSpeakers?(extractor?'processed':'unavailable'):'pending';
      const modelsMs=Math.max(0,Date.now()-startedAt);
      const collected:UtteranceVoice[]=[];
      if(kind==='lifelog'){if(!rolling)audio.lifelogReset();}else audio.recordingReset();
      // Replay preceding packets without recognition to restore exact codec
      // history; no ABI-dependent native state is persisted across app upgrades.
      for(let index=rolling?Math.min(prefixFrames,this.pcmWindow.nextDecodedFrame):0;index<prefixFrames;index++){
        decode(index);
        if(index%100===99)await this.yieldProcessing();
      }
      const window=new Float32Array(16000);let filled=0;
      for(let index=0;index<frames;index++){
        const samples=decode(index+prefixFrames);
        for(let i=0;i<samples.length;i++){
          window[filled++]=samples[i];
          if(filled===window.length){
            vad.acceptWaveform(window);filled=0;
            this.drain(vad,recognizer,out,extractor,collected);
            // 每喂满 2 秒且确实产出了语音段，就让出一次：识别是同步原生调用，靠这个避免长时间霸占线程。
            if(this.drainedLastPass){tick();await this.yieldProcessing();} else tick();
          }
        }
        if(index%40===39){this.progress=Math.round(index/Math.max(1,frames)*100);await this.yieldProcessing();tick();}
      }
      if(filled>0){vad.acceptWaveform(window.slice(0,filled));this.drain(vad,recognizer,out,extractor,collected);}
      vad.flush();this.drain(vad,recognizer,out,extractor,collected);
      out.speechSeconds=out.utterances.reduce((sum:number,item:LifelogUtterance):number=>sum+(item.end-item.start),0);
      // 两级聚类：先平均连接层次聚类，再按最近簇归属短句（阈值 0.72，宁可标未知也不乱并人）。
      if(collected.length){
        const labels=clusterVoices(collected,0.72);
        for(let i=0;i<collected.length;i++){
          const index=collected[i].index;
          if(index>=0&&index<out.utterances.length)out.utterances[index].speaker=labels[i];
        }
      }
      this.resolveSpeakers(collected,out);
      this.progress=100;
      const speakers=out.speakers.length;
      this.note=speakers>1?`本地转写完成：${out.utterances.length} 句 · ${speakers} 位说话人 · 有效语音 ${formatClock(out.speechSeconds)}`
        :`本地转写完成：${out.utterances.length} 句，有效语音 ${formatClock(out.speechSeconds)}`;
      this.dbg('done',`kind=${kind} frames=${out.frames} utterances=${out.utterances.length} speech=${out.speechSeconds.toFixed(1)} elapsed=${((Date.now()-startedAt)/1000).toFixed(1)}s`);
      this.dbg('run-timing',JSON.stringify({worker:this.workerRuntime,frames,prefixFrames,modelsMs,
        elapsedMs:Math.max(0,Date.now()-startedAt),recognitionMs:this.recognitionMs,embeddingMs:this.embeddingMs,
        timerYields:this.yieldCount,timerWaitMs:this.yieldWaitMs}));
      return out;
    }catch(error){
      if(rolling)this.pcmWindow.invalidate();
      const message=(error as Error).message;
      this.note='转写失败：'+message;this.dbg('fail',message);throw new Error(message);
    }finally{try{if(kind==='lifelog'){if(!rolling)audio.lifelogClose();}else audio.recordingClose();}catch(_){}this.busy=false;this.changed();}
  }
}
