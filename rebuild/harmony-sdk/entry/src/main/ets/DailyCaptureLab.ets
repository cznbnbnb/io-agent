import { common } from '@kit.AbilityKit';
import { fileIo as fs } from '@kit.CoreFileKit';
import { util } from '@kit.ArkTS';
import { probeSession } from './ProbeSession';
import { recordings, lifelog, lifelogASR, startRecordingServices, stopRecordingServices,
  localCurrentDirectory, localQueueSize, retryFailedLocalTranscribe } from './RecordingService';
import { AsrEngineClient, AsrWorkerLifecycle } from './AsrEngine';
import { readTranscriptionSignals } from './TranscriptionSignals';
import { admitTranscription } from './TranscriptionBudget';
import { cloneDailyLabSource } from './DailyLabSourceClone';
import { WorkerExitProbe } from './WorkerExitProbe';
import { CodecWindowProbe } from './CodecWindowProbe';

class DailyLabSource {
  name:string='';bytes:number=0;frames:number=0;complete:boolean=false;interrupted:boolean=false;textComplete:boolean=false;
}
class DailyLabQueueRow { status:string='';attempts:number=0;lastError:string=''; }
class DailyLabWindow { start:number=0;end:number=0;sourceFrames:number=0;utterances:number=0;boundaryProcessing:string='unknown'; }
class DailyLabMaterial { revision:number=0;textRevision:number=0;utterances:number=0;textChars:number=0;sourceComplete:boolean=false;speakerProcessing:string='unknown';boundaryProcessing:string='unknown'; }
class DailyLabSample {
  at:number=0;capture:boolean=false;bytes:number=0;currentJob:boolean=false;queued:number=0;
  foreground:boolean=false;lease:boolean=false;screenKnown:boolean=false;screenActive:boolean=false;
  battery:number=-1;charging:boolean=false;thermal:number=-1;freeBytes:number=-1;
  sources:DailyLabSource[]=[];queue:DailyLabQueueRow[]=[];windows:DailyLabWindow[]=[];materials:DailyLabMaterial[]=[];
}
class DailyLabReport {
  schema:number=1;kind:string='p22_actual_daily_coordinator';root:string='';
  created:number=0;captureDeadline:number=0;deadline:number=0;captureStopped:number=0;finished:number=0;
  phase:string='idle';error:string='';modelLoadMs:number=-1;samples:DailyLabSample[]=[];
  attemptStarted:number=0;
  replaySourceSha256:string='';
}
// Cold-process diagnostic with the real acquisition and RecordingService.
// No AppRuntime, ConnectedServices, summary, upload, or production audio roots.
export class DailyCaptureLab {
  phase:string='idle';note:string='未开始日常调度实验';modelReady:boolean=false;
  changed:()=>void=():void=>{};
  private context:common.UIAbilityContext|undefined=undefined;private base:string='';
  private engine:AsrEngineClient|undefined=undefined;private report:DailyLabReport=new DailyLabReport();
  private generation:number=0;private active:boolean=false;private disposed:boolean=false;
  private sampler:number=-1;private stopper:number=-1;private watchdog:number=-1;
  private sampling:boolean=false;private ownsLease:boolean=false;private ending:boolean=false;
  private probing:boolean=false;
  private exitProbe:WorkerExitProbe|undefined=undefined;
  private codecProbe:CodecWindowProbe|undefined=undefined;
  get running():boolean{return this.active||this.probing;}
  async probeWindowCodec():Promise<void>{
    if(!this.context||this.running||this.disposed||this.phase==='loading'||!probeSession.foreground||recordings.active||recordings.busy||lifelog.active||probeSession.voice.active||localCurrentDirectory())return;
    const last=this.report.samples[this.report.samples.length-1];if(!last||last.sources.length!==1)throw new Error('CODEC_PROBE_NO_SAVED_SOURCE');
    this.probing=true;this.modelReady=false;this.phase='codec-testing';this.note='核对滚动解码与从头解码PCM一致性；不采集、不保存文字';this.changed();
    this.engine?.close();this.engine=undefined;lifelogASR.engine=undefined;this.codecProbe=new CodecWindowProbe();
    try{const result=await this.codecProbe.run(this.context,this.base,this.report.root,last.sources[0].name);this.phase='codec-'+result;this.note='解码一致性实验：'+result+'；原音保留';}
    finally{this.codecProbe=undefined;this.probing=false;if(!this.disposed)this.changed();}
  }
  async probeWorkerExit():Promise<void>{
    if(!this.context||this.running||this.disposed||!probeSession.foreground||recordings.active||recordings.busy||lifelog.active||probeSession.voice.active||localCurrentDirectory())return;
    const last=this.report.samples[this.report.samples.length-1];if(!last||last.sources.length!==1)throw new Error('EXIT_PROBE_NO_SAVED_SOURCE');
    this.probing=true;this.modelReady=false;this.phase='exit-testing';this.note='测试旧线程真正退出后才创建替代线程；不采集、不保存文字';this.changed();
    this.engine?.close();this.engine=undefined;lifelogASR.engine=undefined;
    this.exitProbe=new WorkerExitProbe();
    try{const result=await this.exitProbe.run(this.context,this.base,this.report.root,last.sources[0].name);this.phase='exit-'+result;this.note='线程退出实验：'+result+'；报告与原音保留';}
    finally{this.exitProbe=undefined;this.probing=false;if(!this.disposed)this.changed();}
  }
  initialize(context:common.UIAbilityContext):void{
    this.base=context.filesDir+'/p22-daily-lab';
    if(lifelog.rootPath()&&!lifelog.rootPath().startsWith(this.base+'/run-'))throw new Error('需要冷启动隔离入口');
    this.context=context;this.disposed=false;
    if(!fs.accessSync(this.base))fs.mkdirSync(this.base);
    lifelogASR.requireWorker=true;lifelogASR.registry=undefined;lifelogASR.initialize(context);
    lifelog.changed=():void=>this.changed();
    try{
      const path=this.base+'/trial.json';
      if(fs.accessSync(path)&&fs.statSync(path).size<2000000){
        const row=JSON.parse(fs.readTextSync(path)) as DailyLabReport;
        if(row.schema===1&&row.kind==='p22_actual_daily_coordinator'&&this.validRoot(row.root)){
          this.report=row;this.phase='saved';this.note='上次实验资料保留；未自动采集或转写';
        }
      }
    }catch(_){this.note='上次实验记录不可读，测试原件保留';}
  }
  private validRoot(path:string):boolean{return path.startsWith(this.base+'/run-')&&/^run-[0-9]{13}$/.test(path.slice(this.base.length+1));}
  private ensureEngine():void{
    if(this.disposed||!this.context)return;
    if(!this.engine||this.engine.isClosed()){
      this.engine=new AsrEngineClient(this.context.filesDir,(_p:number,_n:string):void=>{if(!this.disposed)this.changed();},
        (event:AsrWorkerLifecycle):void=>lifelogASR.log('worker-client',JSON.stringify(event)));
      lifelogASR.engine=this.engine;lifelogASR.busy=false;
    }
  }
  async prepare():Promise<void>{
    if(!this.context||this.running||this.phase==='loading')return;
    this.phase='loading';this.note='正在准备本机模型';this.changed();const generation=this.generation;
    try{
      const signals=await readTranscriptionSignals(this.context.filesDir);
      signals.conditions.foreground=probeSession.foreground;signals.conditions.workerReady=true;
      const admission=admitTranscription(signals.conditions);if(!admission.allowed)throw new Error(admission.reason);
      this.ensureEngine();const before=Date.now();await lifelogASR.ensureExtracted();await this.engine?.load(30000);
      if(this.disposed||generation!==this.generation)return;
      this.report.modelLoadMs=Date.now()-before;this.modelReady=true;this.phase='ready';this.note='模型就绪；等待明确开始75秒采集';
    }catch(error){this.modelReady=false;this.phase='failed';this.note=(error as Error).message;}
    if(!this.disposed)this.changed();
  }
  private configure(root:string):void{
    if(!this.context||!this.validRoot(root))throw new Error('DAILY_LAB_ROOT_INVALID');
    recordings.initialize(this.context,false,root);lifelog.initialize(this.context,root,false);
    lifelog.autoTranscribe=true;lifelog.idleTimeoutSec=120;
    this.ensureEngine();
    startRecordingServices(root,():void=>this.ensureEngine(),():void=>{this.engine?.close();this.ensureEngine();},false);
  }
  async start(resume:boolean=false,reprocess:boolean=false):Promise<void>{
    if(reprocess&&!resume)throw new Error('DAILY_LAB_REPLAY_MODE');
    if(!this.context||this.running||!this.modelReady||this.disposed||!probeSession.foreground||probeSession.connection.phase!=='ready')return;
    if(recordings.active||recordings.busy||lifelog.active||probeSession.voice.active||probeSession.features.displayActive)throw new Error('当前眼镜任务未空闲');
    this.active=true;this.ending=resume;const generation=++this.generation;
    this.phase='starting';this.note=resume?'明确重试失败或继续上次测试转写；不重新采集，也不恢复已取消任务':'将进行75秒真实智记采集和自动短窗转写';this.changed();
    try{
      const previous=this.report,loadMs=previous.modelLoadMs;
      if(reprocess){
        if(!this.validRoot(previous.root)||!previous.samples.length)throw new Error('DAILY_LAB_NO_SAVED_RUN');
        const sources=previous.samples[previous.samples.length-1].sources;if(sources.length!==1)throw new Error('DAILY_LAB_REPLAY_SOURCE_COUNT');
        const created=Math.max(Date.now(),previous.created+1),root=this.base+'/run-'+created;
        // Save the former report alongside its original source before switching.
        this.persist();const hash=cloneDailyLabSource(this.base,previous.root,root,sources[0].name);
        this.report=new DailyLabReport();this.report.created=created;this.report.root=root;
        this.report.modelLoadMs=loadMs;this.report.replaySourceSha256=hash;
      }else if(!resume){
        this.report=new DailyLabReport();this.report.created=Date.now();this.report.root=this.base+'/run-'+this.report.created;
        this.report.modelLoadMs=loadMs;fs.mkdirSync(this.report.root);
      }else if(!this.validRoot(previous.root)||!fs.accessSync(previous.root))throw new Error('DAILY_LAB_NO_SAVED_RUN');
      const duration=resume?600000:180000;
      this.report.attemptStarted=Date.now();this.report.finished=0;this.report.error='';this.report.phase='running';this.report.deadline=Date.now()+duration;
      if(reprocess)this.note='复测保留的测试原音，使用全新检查点；不重新采集';
      const acquiredHere=!probeSession.background.active;this.ownsLease=acquiredHere;await probeSession.background.start(this.context);
      if(!probeSession.background.active)throw new Error('蓝牙后台资格未获得');
      if(generation!==this.generation||!this.active){if(acquiredHere)await probeSession.background.stop('实验已取消');return;}
      this.configure(this.report.root);
      if(resume)for(const item of lifelog.items)retryFailedLocalTranscribe(lifelog.rootPath()+'/'+item.name);
      this.watchdog=setTimeout(():void=>{void this.finish('deadline');},duration);
      this.sampler=setInterval(():void=>{void this.sample(generation);},5000);
      if(!resume){
        this.report.captureDeadline=Date.now()+75000;
        this.stopper=setTimeout(():void=>{void this.stopCapture();},75000);
        await lifelog.start('day');
      }
      this.phase=resume?'processing':'recording';await this.sample(generation);this.persist();this.changed();
    }catch(error){if(generation===this.generation){this.report.error=(error as Error).message;await this.finish('start_failed');}}
  }
  async stopCapture():Promise<void>{
    if(!this.active||this.ending)return;this.ending=true;
    if(this.stopper!==-1)clearTimeout(this.stopper);this.stopper=-1;
    this.report.captureStopped=Date.now();this.phase='processing';this.note='已请求结束采集，保存尾包并按正式预算补完文字';this.changed();
    try{await lifelog.stopDay();}catch(error){this.report.error=(error as Error).message;}
    this.persist();
  }
  disconnected():void{
    lifelog.disconnected();
    if(this.active){this.ending=true;this.report.error='capture_connection_lost';this.note='连接中断，测试原音保留，不自动重启采集';}
  }
  private readObject(path:string):Record<string,Object>{
    if(fs.statSync(path).size>4000000)throw new Error('DAILY_LAB_FILE_TOO_LARGE');return JSON.parse(fs.readTextSync(path)) as Record<string,Object>;
  }
  private diskMetadata(s:DailyLabSample):void{
    const root=this.report.root;if(!this.validRoot(root))return;
    const ledger=root+'/asr-queue/state.json';
    if(fs.accessSync(ledger)){
      const data=this.readObject(ledger),jobs=data['jobs'] as DailyLabQueueRow[];
      for(const job of jobs){const row=new DailyLabQueueRow();row.status=job.status;row.attempts=job.attempts;row.lastError=job.lastError;s.queue.push(row);}
    }
    const windows=root+'/asr-windows';
    if(fs.accessSync(windows))for(const job of fs.listFileSync(windows)){
      if(!/^asr-lifelog-[0-9a-f]{32}$/.test(job))continue;
      for(const name of fs.listFileSync(windows+'/'+job))if(/^window-[0-9]{6}\.json$/.test(name)){
        const wrapper=this.readObject(windows+'/'+job+'/'+name),r=wrapper['result'] as Record<string,Object>;
        const row=new DailyLabWindow();row.start=r['windowStartFrame'] as number;row.end=r['windowEndFrame'] as number;row.sourceFrames=r['frames'] as number;
        row.utterances=(r['utterances'] as Object[]).length;s.windows.push(row);
        const boundary=r['boundaryProcessing'] as string;if(['unknown','unverified','token_starts','no_speech'].includes(boundary))row.boundaryProcessing=boundary;
      }
    }
    const materials=root+'/materials';
    if(fs.accessSync(materials))for(const id of fs.listFileSync(materials)){
      if(!/^mat-lifelog-[0-9a-f]{32}$/.test(id))continue;
      const names=fs.listFileSync(materials+'/'+id).filter((name:string):boolean=>/^revision-[0-9]{9}\.json$/.test(name)).sort();
      if(!names.length)continue;const r=this.readObject(materials+'/'+id+'/'+names[names.length-1]);
      const row=new DailyLabMaterial();row.revision=r['revision'] as number;row.textRevision=r['text_revision'] as number;
      row.utterances=(r['utterances'] as Object[]).length;row.textChars=(r['text'] as string).length;row.sourceComplete=(r['source'] as Record<string,Object>)['complete']===true;s.materials.push(row);
      const speakerProcessing=r['speaker_processing'] as string;
      if(['unknown','pending','processed','unavailable'].includes(speakerProcessing))row.speakerProcessing=speakerProcessing;
      const boundary=r['boundary_processing'] as string;if(['unknown','unverified','token_starts','no_speech'].includes(boundary))row.boundaryProcessing=boundary;
    }
  }
  private async sample(generation:number):Promise<void>{
    if(!this.active||this.sampling||this.disposed||generation!==this.generation||!this.context)return;
    this.sampling=true;
    try{
      lifelog.refresh();const s=new DailyLabSample();s.at=Date.now();s.capture=lifelog.active;s.bytes=lifelog.bytes;
      s.currentJob=!!localCurrentDirectory();s.queued=localQueueSize();s.foreground=probeSession.foreground;s.lease=probeSession.background.active;
      for(const item of lifelog.items){const row=new DailyLabSource();row.name=item.name;row.bytes=item.bytes;row.frames=item.committedFrames;
        row.complete=item.complete;row.interrupted=item.interrupted;row.textComplete=item.hasText&&item.textComplete;s.sources.push(row);}
      this.diskMetadata(s);
      const signals=await readTranscriptionSignals(this.context.filesDir);
      if(!this.active||this.disposed||generation!==this.generation)return;
      s.screenKnown=signals.screenKnown;s.screenActive=signals.screenActive;s.battery=signals.conditions.batteryPercent;
      s.charging=signals.conditions.charging;s.thermal=signals.thermalLevel;s.freeBytes=signals.conditions.freeBytes;
      if(this.report.samples.length>=100)this.report.samples.shift();this.report.samples.push(s);this.persist();this.changed();
      if(this.ending&&!lifelog.active&&!s.currentJob&&!s.queued){
        const failed=s.queue.some((row:DailyLabQueueRow):boolean=>row.status==='failed'||row.status==='cancelled');
        const incomplete=s.sources.some((row:DailyLabSource):boolean=>!row.complete||!row.textComplete||row.interrupted);
        await this.finish(!s.sources.length?'no_audio':failed?'asr_failed':incomplete?'capture_or_text_incomplete':'completed');
      }
    }catch(error){this.report.error=(error as Error).message;this.persist();}
    finally{this.sampling=false;}
  }
  private persist():void{
    if(!this.base||!this.validRoot(this.report.root))return;
    const bytes=new util.TextEncoder().encodeInto(JSON.stringify(this.report));
    const file=fs.openSync(this.base+'/trial.json.partial',fs.OpenMode.CREATE|fs.OpenMode.WRITE_ONLY|fs.OpenMode.TRUNC);
    try{let offset=0;while(offset<bytes.length){const n=fs.writeSync(file.fd,bytes.slice(offset).buffer);if(n<=0)throw new Error('DAILY_LAB_REPORT_WRITE');offset+=n;}fs.fsyncSync(file.fd);}
    finally{fs.closeSync(file);bytes.fill(0);}fs.renameSync(this.base+'/trial.json.partial',this.base+'/trial.json');
    fs.copyFileSync(this.base+'/trial.json',this.report.root+'/trial.json');
  }
  async finish(reason:string='manual'):Promise<void>{
    if(this.probing){this.exitProbe?.cancel();this.codecProbe?.cancel();return;}
    if(!this.active)return;
    this.active=false;this.generation++;
    for(const id of [this.sampler,this.stopper,this.watchdog])if(id!==-1){clearInterval(id);clearTimeout(id);}
    this.sampler=-1;this.stopper=-1;this.watchdog=-1;
    if(lifelog.active){try{await lifelog.stopDay();}catch(_){} }
    stopRecordingServices();lifelog.dispose();this.engine?.close();this.engine=undefined;lifelogASR.engine=undefined;lifelogASR.busy=false;this.modelReady=false;
    this.report.finished=Date.now();this.report.phase=reason;this.phase=reason;this.note='实验已结束：'+reason+'；测试原音与检查点保留';
    try{this.persist();}catch(_){this.note+='；报告保存失败';}
    if(this.ownsLease){this.ownsLease=false;await probeSession.background.stop('日常调度实验结束');}
    if(!this.disposed)this.changed();
  }
  dispose():void{
    this.exitProbe?.cancel();
    this.codecProbe?.cancel();
    this.disposed=true;if(this.active)void this.finish('ability_destroyed');
    else{this.generation++;this.engine?.close();this.engine=undefined;lifelogASR.engine=undefined;lifelogASR.busy=false;}
  }
}
export const dailyCaptureLab:DailyCaptureLab=new DailyCaptureLab();
