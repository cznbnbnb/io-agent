import { common } from '@kit.AbilityKit';
import { fileIo as fs } from '@kit.CoreFileKit';
import { probeSession } from './ProbeSession';
import { backgroundLab } from './BackgroundLabSession';
import { RecordingSession, RecordingItem } from './RecordingSession';
import { AsrEngineClient } from './AsrEngine';
import { LifelogTranscript, LifelogUtterance, lifelogMarkdown } from './LifelogASR';
import { readTranscriptionSignals } from './TranscriptionSignals';
import { admitTranscription } from './TranscriptionBudget';
import { AsrWindowRequest } from './AsrWindows';
import { AsrWindowStore } from './AsrWindowStore';

class RecordingSample {
  t:number=0;bytes:number=0;foreground:boolean=false;lease:boolean=false;
  screenKnown:boolean=false;screenActive:boolean=false;active:boolean=false;
}
class RecordingTrial {
  schema:number=1;kind:string='p12_explicit_recording';
  started:number=0;closed:number=0;take:string='';complete:boolean=false;bytes:number=0;
  modelLoadMs:number=-1;inferenceMs:number=-1;audioSeconds:number=0;
  utterances:number=0;speakers:number=0;unknownUtterances:number=0;
  channels:ChannelTrial[]=[];
  error:string='';samples:RecordingSample[]=[];
  replays:ReplayTrial[]=[];
  windows:WindowTrial[]=[];
}
class WindowTrial {
  created:number=0;finished:number=0;status:string='running';error:string='';
  cursorBefore:number=0;cursorAfter:number=0;sourceFrames:number=0;elapsedMs:number=-1;
  utterances:number=0;speakers:number=0;samples:ReplaySample[]=[];
}
class ChannelTrial{channel:string='';elapsedMs:number=0;utterances:number=0;speakers:number=0;}
class ReplaySample {
  t:number=0;stage:string='';foreground:boolean=false;lease:boolean=false;
  screenKnown:boolean=false;screenActive:boolean=false;
  charging:boolean=false;batteryPercent:number=-1;thermalLevel:number=-1;freeBytes:number=-1;
}
class ReplayTrial {
  created:number=0;started:number=0;finished:number=0;mode:string='';status:string='queued';error:string='';
  modelLoadMs:number=-1;channels:ChannelTrial[]=[];samples:ReplaySample[]=[];
}
// Reuses the existing acquisition/decoder and ASR Worker. Never imports daily services.
export class RecordingLabSession {
  phase:string='idle';note:string='尚未开始录音回归';progress:number=0;modelReady:boolean=false;
  changed:()=>void=():void=>{};
  recorder:RecordingSession=new RecordingSession(
    (b:number,p:Uint8Array):Promise<void>=>probeSession.auth.sendBusiness(b,p),
    ():string=>probeSession.connection.phase==='ready'?probeSession.peerDeviceId:'',
    ():boolean=>!backgroundLab.active&&!probeSession.voice.active&&!probeSession.features.displayActive);
  private context:common.UIAbilityContext|undefined=undefined;
  private engine:AsrEngineClient|undefined=undefined;
  private trial:RecordingTrial=new RecordingTrial();
  private timer:number=-1;private autoStop:number=-1;private ownsLease:boolean=false;
  private replayTimer:number=-1;private replaySampler:number=-1;
  private replayGeneration:number=0;private replayStage:string='';
  private cancelDelay:(()=>void)|undefined=undefined;
  get hasTake():boolean{return this.trial.complete&&!!this.trial.take;}
  initialize(context:common.UIAbilityContext):void{
    this.context=context;this.recorder.initialize(context,true);
    // Only this explicit lab's journal and verified lab items; no daily history.
    try{
      const path=context.filesDir+'/p12-recording-state.json';
      if(fs.accessSync(path)&&fs.statSync(path).size<=262144){
        const saved=JSON.parse(fs.readTextSync(path)) as RecordingTrial;
        if(saved.schema===1&&saved.kind==='p12_explicit_recording'&&saved.complete===true&&/^take-[0-9a-f]{32}$/.test(saved.take)){
          const item=this.recorder.items.find((row:RecordingItem):boolean=>row.name===saved.take&&row.complete&&row.bytes===saved.bytes);
          if(item){
            saved.replays=Array.isArray(saved.replays)?saved.replays:[];
            saved.windows=Array.isArray(saved.windows)?saved.windows:[];
            if(saved.windows.length>20)throw new Error('lab-window-journal-too-large');
            for(const run of saved.windows)if(run.status==='running'){run.status='interrupted';run.error='process_interrupted';}
            if(saved.replays.length>10)throw new Error('lab-journal-too-large');
            for(const run of saved.replays){
              if(run.status==='queued'||run.status==='running'){run.status='interrupted';run.error='process_interrupted';run.finished=Date.now();}
            }
            this.trial=saved;this.phase='recorded';this.note='已恢复上次隔离测试原音 · 等待明确转写';this.persist();
          }
        }
      }
    }catch(_){this.note='测试记录不可恢复，原音保留；未自动转写';}
    this.recorder.changed=():void=>{
      if(this.recorder.active)this.phase=this.recorder.stopping?'stopping':this.recorder.starting?'starting':'recording';
      this.note=this.recorder.note;this.changed();
    };
    this.recorder.onRecordingClosed=(directory:string,_path:string,_started:number):void=>{
      const item=this.recorder.findByDirectory(directory);
      this.trial.closed=Date.now();this.trial.complete=!!item?.complete;
      this.trial.bytes=item?.bytes||0;this.trial.take=item?.name||'';
      this.phase=this.trial.complete?'recorded':'failed';this.note='测试录音已保存 · 可开始本机转写';
      this.clearTimers();this.persist();this.release();this.changed();
    };
    this.recorder.onSessionEnded=():void=>{
      if(this.phase==='recorded')return;
      this.clearTimers();this.trial.error='recording_not_complete';this.phase='failed';this.persist();this.release();this.changed();
    };
  }
  private persist():void{
    if(!this.context)return;
    try{
      const next=this.context.filesDir+'/p12-recording-state.next';
      const f=fs.openSync(next,fs.OpenMode.CREATE|fs.OpenMode.READ_WRITE|fs.OpenMode.TRUNC);
      try{fs.writeSync(f.fd,JSON.stringify(this.trial));fs.fsyncSync(f.fd);}finally{fs.closeSync(f);}
      fs.renameSync(next,this.context.filesDir+'/p12-recording-state.json');
    }catch(_){this.note='测试记录保存失败，原音仍保留';}
  }
  private newEngine():AsrEngineClient{
    if(!this.context)throw new Error('实验入口未初始化');
    if(!this.engine)this.engine=new AsrEngineClient(this.context.filesDir,(p:number,n:string):void=>{
      this.progress=p;this.note=n;this.changed();
    });
    return this.engine;
  }
  async prepare():Promise<void>{
    if(!this.context||this.recorder.active||this.phase==='models_loading'||this.phase==='transcribing'||backgroundLab.active)return;
    this.phase='models_loading';this.note='正在校验本机模型并在转写线程加载';this.changed();
    try{
      const signals=await readTranscriptionSignals(this.context.filesDir);
      signals.conditions.foreground=probeSession.foreground;signals.conditions.workerReady=true;
      const admission=admitTranscription(signals.conditions);
      if(!admission.allowed)throw new Error(admission.reason);
      for(const name of ['model.int8.onnx','tokens.txt','silero_vad.onnx']){
        const path=this.context.filesDir+'/asr-models/'+name;
        if(!fs.accessSync(path)||fs.statSync(path).size<=0)throw new Error('本机模型尚未解包');
      }
      const before=Date.now();await this.newEngine().load(30000);this.trial.modelLoadMs=Date.now()-before;
      this.modelReady=true;this.phase='ready';this.note='本机模型已加载 · 等待明确开始录音';this.persist();
    }catch(error){this.modelReady=false;this.engine?.close();this.engine=undefined;this.phase='failed';this.note=(error as Error).message;}
    this.changed();
  }
  private async acquire():Promise<void>{
    if(!this.context||!probeSession.foreground||backgroundLab.active)throw new Error('请保持实验页前台');
    this.ownsLease=!probeSession.background.active;
    await probeSession.background.start(this.context);
    if(!probeSession.background.active)throw new Error('未获得蓝牙后台任务');
  }
  private async release():Promise<void>{
    if(this.ownsLease){
      this.ownsLease=false;await probeSession.background.stop('录音实验结束，临时后台任务已释放');
      if(!probeSession.foreground&&!probeSession.background.active)probeSession.stop();
    }
  }
  private clearTimers():void{
    if(this.timer!==-1)clearInterval(this.timer);if(this.autoStop!==-1)clearTimeout(this.autoStop);
    this.timer=-1;this.autoStop=-1;
  }
  private async sample():Promise<void>{
    if(!this.context||this.trial.samples.length>=120)return;
    const s=new RecordingSample();s.t=Date.now();s.bytes=this.recorder.bytes;
    s.foreground=probeSession.foreground;s.lease=probeSession.background.active;s.active=this.recorder.active;
    try{const signals=await readTranscriptionSignals(this.context.filesDir);s.screenKnown=signals.screenKnown;s.screenActive=signals.screenActive;}catch(_){}
    this.trial.samples.push(s);this.persist();
  }
  async start():Promise<void>{
    if(!this.context||!this.modelReady||this.recorder.active||this.phase==='transcribing'||this.phase==='models_loading')return;
    const loadMs=this.trial.modelLoadMs;this.trial=new RecordingTrial();this.trial.modelLoadMs=loadMs;
    this.trial.started=Date.now();this.phase='starting';this.changed();
    try{
      await this.acquire();await this.recorder.start();
      this.timer=setInterval(():void=>{this.sample();},2000);
      this.autoStop=setTimeout(():void=>{this.stop();},60000);await this.sample();
    }catch(error){this.trial.error='start_failed';this.note=(error as Error).message;this.phase='failed';this.clearTimers();await this.release();this.persist();this.changed();}
  }
  async stop():Promise<void>{
    try{await this.recorder.stop();}catch(error){this.note=(error as Error).message;this.changed();}
  }
  private async sampleReplay(run:ReplayTrial,stage:string):Promise<void>{
    // 周期采样有上限；后台推理较慢时仍保留每路起止证据。
    const milestone=stage.endsWith('_begin')||stage.endsWith('_end')||stage==='finished';
    if(!this.context||(!milestone&&run.samples.length>=100))return;
    const row=new ReplaySample();row.t=Date.now();row.stage=stage;
    row.foreground=probeSession.foreground;row.lease=probeSession.background.active;
    try{
      const s=await readTranscriptionSignals(this.context.filesDir);
      row.screenKnown=s.screenKnown;row.screenActive=s.screenActive;
      row.charging=s.conditions.charging;row.batteryPercent=s.conditions.batteryPercent;
      row.thermalLevel=s.thermalLevel;row.freeBytes=s.conditions.freeBytes;
    }catch(_){}
    run.samples.push(row);this.persist();
  }
  private async delayReplay():Promise<void>{
    await new Promise<void>((resolve:()=>void)=>{
      this.cancelDelay=resolve;this.replayTimer=setTimeout(():void=>{this.replayTimer=-1;this.cancelDelay=undefined;resolve();},20000);
    });
  }
  cancelTranscription():void{
    if(this.phase!=='transcribing')return;
    this.replayGeneration++;
    if(this.replayTimer!==-1)clearTimeout(this.replayTimer);this.replayTimer=-1;
    this.cancelDelay?.();this.cancelDelay=undefined;
    this.engine?.close();this.engine=undefined;this.modelReady=false;
    this.note='已请求停止本轮转写 · 原音保留';this.changed();
  }
  async transcribe(background:boolean=false):Promise<void>{
    if(!this.context||this.recorder.active||!this.trial.complete||this.phase==='transcribing')return;
    const item=this.recorder.items.find((row:RecordingItem):boolean=>row.name===this.trial.take);
    if(!item||!this.modelReady)return;
    if(this.trial.replays.length>=10){this.note='隔离实验已记录10轮，未继续运行';this.changed();return;}
    const generation=++this.replayGeneration;
    const run=new ReplayTrial();run.created=Date.now();run.mode=background?'deferred_background':'foreground';run.modelLoadMs=this.trial.modelLoadMs;
    this.trial.replays.push(run);this.trial.error='';this.trial.channels=[];
    this.phase='transcribing';this.progress=0;this.changed();
    try{
      await this.acquire();
      this.replayStage='queued';await this.sampleReplay(run,this.replayStage);
      this.replaySampler=setInterval(():void=>{this.sampleReplay(run,this.replayStage);},500);
      if(background){this.note='20秒后转写已保存样本 · 可熄屏，不启动录音';this.persist();this.changed();await this.delayReplay();}
      if(generation!==this.replayGeneration)throw new Error('lab_cancelled');
      run.status='running';run.started=Date.now();this.replayStage='mix';await this.sampleReplay(run,'mix_begin');
      const signals=await readTranscriptionSignals(this.context.filesDir);
      signals.conditions.foreground=probeSession.foreground;signals.conditions.bluetoothLease=probeSession.background.active;
      signals.conditions.interactiveAudio=probeSession.voice.active||this.recorder.active;
      signals.conditions.workerReady=this.modelReady;
      const admission=admitTranscription(signals.conditions);if(!admission.allowed)throw new Error(admission.reason);
      const output=this.recorder.directoryOf(item)+'/replay-'+run.created;fs.mkdirSync(output);
      const before=Date.now();
      const result:LifelogTranscript=await this.newEngine().transcribe(this.recorder.file(item,false),'recording',30000);
      if(generation!==this.replayGeneration)throw new Error('lab_cancelled');
      this.trial.inferenceMs=Date.now()-before;this.trial.audioSeconds=result.seconds;
      this.trial.utterances=result.utterances.length;this.trial.speakers=result.speakers.length;
      this.trial.unknownUtterances=result.utterances.filter((row:LifelogUtterance):boolean=>row.speaker<0).length;
      this.recorder.saveTranscript(item,lifelogMarkdown('P12 单独测试录音',result));
      const mixed=new ChannelTrial();mixed.channel='mix';mixed.elapsedMs=this.trial.inferenceMs;mixed.utterances=result.utterances.length;mixed.speakers=result.speakers.length;run.channels.push(mixed);
      const f=fs.openSync(output+'/transcript-mix.json',fs.OpenMode.CREATE|fs.OpenMode.READ_WRITE|fs.OpenMode.TRUNC);
      try{fs.writeSync(f.fd,JSON.stringify(result));fs.fsyncSync(f.fd);}finally{fs.closeSync(f);}
      await this.sampleReplay(run,'mix_end');
      let usedMs=this.trial.inferenceMs;
      for(const channel of ['left','right']){
        if(generation!==this.replayGeneration)throw new Error('lab_cancelled');
        this.replayStage=channel;await this.sampleReplay(run,channel+'_begin');
        const budget=await readTranscriptionSignals(this.context.filesDir);
        budget.conditions.foreground=probeSession.foreground;budget.conditions.bluetoothLease=probeSession.background.active;
        budget.conditions.workerReady=this.modelReady;budget.conditions.usedWorkerMs=usedMs;
        budget.conditions.interactiveAudio=probeSession.voice.active||this.recorder.active;
        const permit=admitTranscription(budget.conditions);if(!permit.allowed)throw new Error(permit.reason);
        const start=Date.now();const separate=await this.newEngine().transcribe(this.recorder.file(item,false),'recording_'+channel,30000);
        if(generation!==this.replayGeneration)throw new Error('lab_cancelled');
        const comparison=new ChannelTrial();comparison.channel=channel;comparison.elapsedMs=Date.now()-start;
        comparison.utterances=separate.utterances.length;comparison.speakers=separate.speakers.length;
        usedMs+=comparison.elapsedMs;this.trial.channels.push(comparison);run.channels.push(comparison);
        const file=fs.openSync(output+'/transcript-'+channel+'.json',fs.OpenMode.CREATE|fs.OpenMode.READ_WRITE|fs.OpenMode.TRUNC);
        try{fs.writeSync(file.fd,JSON.stringify(separate));fs.fsyncSync(file.fd);}finally{fs.closeSync(file);}
        await this.sampleReplay(run,channel+'_end');
      }
      run.status='complete';
      this.phase='complete';this.note='混合与左右声道对比已保存 · 标签不等于人物身份';
    }catch(error){
      const cancelled=generation!==this.replayGeneration;
      run.status=cancelled?'cancelled':'failed';run.error=cancelled?'lab_cancelled':(error as Error).message;
      this.phase=cancelled?'recorded':'failed';this.trial.error=run.error;this.note=cancelled?'本轮已停止 · 可重新加载模型后再试':run.error;
      if(!cancelled){this.engine?.close();this.engine=undefined;this.modelReady=false;}
    }
    finally{
      run.finished=Date.now();this.replayStage='finished';
      if(this.replaySampler!==-1)clearInterval(this.replaySampler);this.replaySampler=-1;
      await this.sampleReplay(run,'finished');await this.release();this.persist();this.changed();
    }
  }
  async transcribeOneWindow():Promise<void>{
    if(!this.context||this.recorder.active||!this.trial.complete||this.phase==='transcribing'||!this.modelReady||backgroundLab.active)return;
    const item=this.recorder.items.find((row:RecordingItem):boolean=>row.name===this.trial.take);
    if(!item||this.trial.windows.length>=20)return;
    const generation=++this.replayGeneration,run=new WindowTrial();run.created=Date.now();
    this.trial.windows.push(run);this.phase='transcribing';this.note='正在识别一个20秒核心窗口 · 原音和日常资料不改动';this.persist();this.changed();
    try{
      const signals=await readTranscriptionSignals(this.context.filesDir);
      signals.conditions.foreground=probeSession.foreground;signals.conditions.bluetoothLease=probeSession.background.active;
      signals.conditions.interactiveAudio=probeSession.voice.active||this.recorder.active;signals.conditions.workerReady=this.modelReady;
      const permit=admitTranscription(signals.conditions);if(!permit.allowed)throw new Error(permit.reason);
      const root=this.context.filesDir+'/p22-window-lab';if(!fs.accessSync(root))fs.mkdirSync(root);
      const store=new AsrWindowStore();store.initialize(root);const id='asr-recording-'+item.name.slice(5);
      const checkpoint=store.resume(id);run.cursorBefore=checkpoint.cursor;
      const total=Math.floor(item.bytes/240);run.sourceFrames=total;
      if(checkpoint.cursor===total){run.cursorAfter=total;run.status='already_complete';this.phase='complete';this.note='窗口检查点已覆盖全部样本，未重复识别';return;}
      const request=new AsrWindowRequest();request.cursor=checkpoint.cursor;request.coreFrames=1000;request.contextFrames=600;request.sealed=true;
      const previous=checkpoint.windows[checkpoint.windows.length-1];
      if(previous){request.expectedPrefixBytes=previous.sourcePrefixBytes;request.expectedPrefixSha256=previous.sourcePrefixSha256;}
      const sample=new ReplaySample();sample.t=Date.now();sample.stage='window_begin';sample.foreground=probeSession.foreground;
      sample.lease=probeSession.background.active;sample.screenActive=signals.screenActive;sample.screenKnown=signals.screenKnown;
      sample.charging=signals.conditions.charging;sample.batteryPercent=signals.conditions.batteryPercent;sample.thermalLevel=signals.thermalLevel;sample.freeBytes=signals.conditions.freeBytes;run.samples.push(sample);
      const before=Date.now();const result=await this.newEngine().transcribeWindow(this.recorder.file(item,false),'recording',request,30000);
      if(generation!==this.replayGeneration)throw new Error('lab_cancelled');
      run.elapsedMs=Date.now()-before;
      const next=store.append(id,checkpoint.cursor,result);run.cursorAfter=next.cursor;
      run.utterances=result.utterances.length;run.speakers=result.speakers.length;run.status='checkpoint_saved';
      this.phase=next.cursor===total?'complete':'recorded';this.note=`窗口文字已保存 ${next.cursor}/${total} 帧 · 可重启后继续，未启动下一窗`;
    }catch(error){
      run.status=generation!==this.replayGeneration?'cancelled':'failed';run.error=(error as Error).message;
      this.phase='recorded';this.note=run.error;this.engine?.close();this.engine=undefined;this.modelReady=false;
    }finally{run.finished=Date.now();this.persist();this.changed();}
  }
  disconnected():void{this.recorder.disconnected();}
  dispose():void{this.cancelTranscription();this.clearTimers();this.recorder.disconnected();this.engine?.close();this.engine=undefined;this.modelReady=false;this.release();}
}
export const recordingLab:RecordingLabSession=new RecordingLabSession();
