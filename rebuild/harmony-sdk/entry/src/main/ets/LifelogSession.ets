// 全天智记（AlwaysOn / LifeLog）鸿蒙端会话——移植自 Turbo-IO iOS AlwaysOnLocalProbe 的 A1-A8 协议。
// business 13 envelope type: 161=眼镜唤醒(A1) 162=手机应答收音(A2) 163/164=音频(A3/A4)
// 165=眼镜退出(A5) 166=手机退出(A6) 168=页面状态(A8)；开关走 business 15 type 20 life_log_*。
// 仅本机存储，不上传、不云端转写。
import { common } from '@kit.AbilityKit';
import { fileIo as fs } from '@kit.CoreFileKit';
import { util } from '@kit.ArkTS';
import { cryptoFramework } from '@kit.CryptoArchitectureKit';
import { hilog } from '@kit.PerformanceAnalysisKit';
import * as audio from 'libturbo_audio.so';
import { businessEnvelope, lifeLogCommand, readLauncherEnvelope } from 'turbo_core';
import { RecordingCoverage, monoWavHeader } from './RecordingCoverage';
import { OggOpusWriter, readOggOpusFrames } from './OggOpus';
import { DisplayCleanupStore, DisplayCleanupPorts } from './DisplayCleanupStore';

// 落盘格式：全天模式直接封 OGG/Opus（原始帧、零转码、约 345 MB/天）；25 秒测试另存原始帧并解码 WAV 供校验。
export class LifelogItem {
  name:string='';created:number=0;bytes:number=0;complete:boolean=false;note:string='';ogg:boolean=false;raw:boolean=false;wav:boolean=false;
  seconds:number=0;ended:number=0;hasText:boolean=false;
  committedFrames:number=0;sealed:boolean=false;interrupted:boolean=false;textComplete:boolean=true;
}

// transcript.json 里的一条语音：start/end 为相对本段起点的秒数。
export class LifelogUtteranceRow { start:number=0;end:number=0;text:string='';lang:string='';speaker:number=-1; }

// 每日汇总渲染结果。
export class LifelogDayText { markdown:string='';transcribed:number=0;total:number=0; }

interface LifelogExitCommand { rc:number; }
interface LifelogStartCommand { taskId:string; idleTimeoutSec:number; }
interface LifelogPageCommand { inRealtimePage:boolean; }
class LifelogCleanupRecord {schema:number=1;peer:string='';session:string='';evidence:string='none';}

export class LifelogSession {
  active:boolean=false;busy:boolean=false;bytes:number=0;
  note:string='全天智记未开启';items:LifelogItem[]=[];emptySegments:number=0;
  // 一个分段目录里可能出现的全部文件，删除/回收时统一清理。
  private static readonly segmentFiles:string[]=['source.opus','audio.ogg','audio.wav','decoded.partial','meta.json','meta.json.partial','text.md','transcript.json','text.md.partial','transcript.json.partial'];
  changed:()=>void=():void=>{};
  beforeRemove:((item:LifelogItem)=>void)|undefined=undefined;
  private root:string='';private logFile:string='';
  private sender:(business:number,payload:Uint8Array)=>Promise<void>;
  private device:()=>string;private idle:()=>boolean;
  private taskId:string='';private directory:string='';
  private raw:fs.File|undefined=undefined;
  private ogg:OggOpusWriter|undefined=undefined;private oggFile:fs.File|undefined=undefined;
  private segmentStarted:number=0;private notifiedFrames:number=0;
  metadataWarning:string='';
  // A2 里声明的闲置容忍秒数（实测 30 会导致眼镜频繁自行收轮）。
  idleTimeoutSec:number=3600;
  private coverage:RecordingCoverage=new RecordingCoverage();
  private a2Sent:boolean=false;private stopAt:number=0;private deadline:number=0;private saveDeadline:number=0;
  private timer:number=-1;private generation:number=0;
  private packets:number=0;private dropped:number=0;private queue:Promise<void>=Promise.resolve();private queued:number=0;
  // 全天模式按段轮转；dayEnabled跨重启仅保留用户意图，未知退出不得自动续录。
  private mode:string='test';private closingMode:string='test';private rotateTimer:number=-1;private rotateAt:number=0;
  private segmentMs:number=10*60*1000;
  private clockAlign:boolean=true;private clockStepMinutes:number=60;
  private dayFile:string='';dayEnabled:boolean=false;
  // 定时全天智记：到点自动开、过点自动停（跨零点也支持）。
  scheduleEnabled:boolean=false;scheduleStart:string='09:00';scheduleEnd:string='18:00';
  // 自动转写：每段封口后自动排队做本机离线转写（由 RecordingService 挂载执行）。
  autoTranscribe:boolean=true;onSegmentClosed:((directory:string,oggPath:string,started:number)=>void)|undefined=undefined;
  onSegmentProgress:((directory:string,oggPath:string,started:number,committedFrames:number)=>void)|undefined=undefined;
  private scheduleFile:string='';private scheduleTimer:number=-1;
  private segments:number=0;
  private captureOwner:string='';
  get suspendedForRecording():boolean{return this.captureOwner==='recording';}
  private pauseResolve:(()=>void)|undefined=undefined;
  private pauseReject:((error:Error)=>void)|undefined=undefined;
  private pauseDone:Promise<void>|undefined=undefined;
  private pauseTimer:number=-1;private cleanupWaitTimer:number=-1;
  private cleanupWaitEpoch:number=0;
  private cleanupWaitReject:((error:Error)=>void)|undefined=undefined;
  private cleanupStore:DisplayCleanupPorts|undefined=undefined;
  private cleanupPeer:string='';private cleanupId:string='';private cleanupFault:boolean=false;
  private connectionReady:boolean=false;private connectionSerial:number=0;
  private writes:number=0;private sendEpoch:number=0;private wireQueue:Promise<void>=Promise.resolve();
  private exitSending:boolean=false;private exitObserved:boolean=false;private exitFailed:boolean=false;
  private exitAttempt:boolean=false;private localSealed:boolean=true;private autoResumeAllowed:boolean=false;
  private stopWork:Promise<void>|undefined=undefined;
  private decoding:boolean=false;
  constructor(sender:(business:number,payload:Uint8Array)=>Promise<void>,device:()=>string,idle:()=>boolean){this.sender=sender;this.device=device;this.idle=idle;}

  get pendingWrites():boolean{return this.writes>0||this.exitSending;}
  get cleanupRequired():boolean{return this.cleanupFault||!!this.cleanupId;}
  get occupied():boolean{return this.active||this.busy||this.cleanupRequired||this.pendingWrites||this.decoding;}
  get cleanupSessionId():string{return this.cleanupId;}
  get canConfirmExited():boolean{return !this.cleanupFault&&!!this.cleanupId&&this.sameCleanupPeer()&&!this.active&&this.localSealed&&!this.pendingWrites;}
  initializeCleanup(store:DisplayCleanupPorts):void{
    if(this.cleanupStore)return;this.cleanupStore=store;
    try{
      const raw=store.load();if(!raw)return;
      const saved=JSON.parse(raw) as LifelogCleanupRecord;
      if(!saved||Object.keys(saved).length!==4||saved.schema!==1||typeof saved.peer!=='string'||saved.peer.length>128||typeof saved.session!=='string'||
        !['none','device_event','user_confirmation'].includes(saved.evidence)||
        (saved.evidence==='none'? !saved.peer||!/^life-[a-f0-9]{32}$/.test(saved.session):!!saved.peer||!!saved.session))throw new Error('LIFELOG_CLEANUP_INVALID');
      if(saved.evidence==='none'){this.cleanupPeer=saved.peer;this.cleanupId=saved.session;this.stopAt=1;this.note='上次智记退出未确认，请连接原眼镜后清理；不会自动开始采集';}
    }catch(_){this.cleanupFault=true;this.note='智记退出记录不可读，原件保留；禁止开启新采集';}
  }
  private sameCleanupPeer():boolean{return this.connectionReady&&!!this.cleanupPeer&&this.device()===this.cleanupPeer;}
  private persistCleanup(evidence:string='none'):void{
    const record=new LifelogCleanupRecord();record.evidence=evidence;
    if(evidence==='none'){record.peer=this.cleanupPeer;record.session=this.cleanupId;}
    try{if(!this.cleanupStore)throw new Error('LIFELOG_CLEANUP_NOT_INITIALIZED');this.cleanupStore.save(JSON.stringify(record));}
    catch(_){this.cleanupFault=true;this.note='智记退出记录保存失败，保留占用';this.settlePause(new Error(this.note));throw new Error(this.note);}
  }
  private completeExit(evidence:string):void{
    this.persistCleanup(evidence);this.cleanupId='';this.cleanupPeer='';this.exitAttempt=false;this.exitObserved=false;
    this.note=evidence==='device_event'?'智记本地已封口，设备退出已确认':'用户确认智记已退出（非设备回执）';
    this.settlePause();this.changed();
  }
  private finishExitBoundary():void{
    if(!this.cleanupRequired||this.active||!this.localSealed)return;
    if(!this.cleanupFault&&!this.pendingWrites&&!this.exitFailed&&this.exitAttempt&&this.exitObserved&&this.sameCleanupPeer()){
      try{this.completeExit('device_event');}catch(_){}return;
    }
    this.note=this.pendingWrites?'本段已封口，退出发送尚未排空；保留智记占用':'本段已封口，设备退出未确认；保留智记占用';
    this.settlePause(new Error(this.note));this.changed();
  }
  confirmExited(id:string):void{
    if(!id||id!==this.cleanupId||!this.canConfirmExited)throw new Error('请连接原眼镜，等待本段封口与发送结束后核对当前智记退出请求');
    this.completeExit('user_confirmation');
  }
  async cleanup():Promise<void>{
    if(!this.cleanupRequired)return;
    if(this.cleanupFault||!this.sameCleanupPeer()||this.pendingWrites)throw new Error('请连接原眼镜并等待当前发送结束后清理智记');
    if(this.active){await this.boundedCleanup(this.stop('显式清理智记',true));return;}
    this.stopAt=Date.now();await this.boundedCleanup(this.requestExit());
  }
  private boundedCleanup(work:Promise<void>):Promise<void>{
    const epoch=++this.cleanupWaitEpoch;
    return new Promise<void>((resolve:()=>void,reject:(error:Error)=>void):void=>{
      this.cleanupWaitReject=reject;
      this.cleanupWaitTimer=setTimeout(():void=>{
        if(epoch!==this.cleanupWaitEpoch)return;
        this.cleanupWaitTimer=-1;this.cleanupWaitReject=undefined;
        this.cleanupWaitEpoch++;
        this.note='智记清理等待8.5秒超时，原生发送与退出占用仍保留';this.changed();reject(new Error(this.note));
      },8500);
      work.then(():void=>{if(epoch===this.cleanupWaitEpoch)this.clearCleanupWait();resolve();},(error:Error):void=>{if(epoch===this.cleanupWaitEpoch)this.clearCleanupWait();reject(error);});
    });
  }
  private clearCleanupWait():void{
    this.cleanupWaitEpoch++;
    if(this.cleanupWaitTimer!==-1)clearTimeout(this.cleanupWaitTimer);this.cleanupWaitTimer=-1;this.cleanupWaitReject=undefined;
  }

  get capturePhase():string{
    if(this.cleanupRequired&&!this.active)return 'cleanup-required';
    if(this.captureOwner)return this.active?'stopping':this.captureOwner;
    if(!this.active)return this.dayEnabled?'waiting-connection':'idle';
    if(this.stopAt>0)return 'stopping';
    return this.bytes>0?'receiving':this.a2Sent?'waiting-audio':'waiting-wake';
  }
  private itemDirectory(item:LifelogItem):string{
    if(!this.root||!/^seg-[0-9a-f]{32}$/.test(item.name))throw new Error('智记分段标识无效');
    return this.root+'/'+item.name;
  }
  private hasText(path:string):boolean{
    try{return (fs.readTextSync(path+'/text.md') as string).trim().length>0;}catch(_){return false;}
  }
  private hasAudio(path:string,source:string,bytes:number,frames:number=-1):boolean{
    if(bytes<=0||frames===0)return false;
    if(source==='audio.wav')return bytes>44;
    if(source==='source.opus')return bytes>=240;
    // A failed/no-audio session can still contain valid OGG headers and EOS.
    if(source==='audio.ogg'&&bytes<=512){
      const f=fs.openSync(path+'/'+source,fs.OpenMode.READ_ONLY);
      try{
        const data=new ArrayBuffer(bytes);const n=fs.readSync(f.fd,data,{length:bytes});
        if(n===bytes)return readOggOpusFrames(new Uint8Array(data)).length>0;
      }finally{fs.closeSync(f);}
      return false;
    }
    return true;
  }

  private dbg(event:string,extra:string=''):void{
    const line=JSON.stringify({t:Date.now(),ev:event,x:extra});
    hilog.info(0x2a02,'LifeLog','%{public}s',line);
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
    }catch(e){hilog.error(0x2a02,'LifeLog','logfile write failed: %{public}s',String(e));}
  }
  private write(fd:number,data:Uint8Array,position:number):void{
    fs.lseek(fd,position,fs.WhenceType.SEEK_SET);
    let written=0;while(written<data.length){const n=fs.writeSync(fd,data.slice(written).buffer);if(n<=0)throw new Error('智记写入不完整');written+=n;}
  }
  private read(fd:number,position:number,length:number):Uint8Array{
    fs.lseek(fd,position,fs.WhenceType.SEEK_SET);
    const out=new Uint8Array(length);let count=0;while(count<length){const part=new ArrayBuffer(length-count);const n=fs.readSync(fd,part,{length:length-count});if(n<=0)throw new Error('智记读取不完整');out.set(new Uint8Array(part,0,n),count);count+=n;}return out;
  }
  private random():string{const b=cryptoFramework.createRandom().generateRandomSync(16).data;const id=Array.from(b).map((n:number)=>n.toString(16).padStart(2,'0')).join('');b.fill(0);return id;}
  private async send(business:number,type:number,body:object,epoch:number=this.sendEpoch):Promise<void>{
    const payload=businessEnvelope(type,new util.TextEncoder().encodeInto(JSON.stringify(body)));
    const peer=this.cleanupPeer,id=this.cleanupId,connection=this.connectionSerial;this.writes++;
    const task=this.wireQueue.catch(()=>{}).then(async():Promise<void>=>{
      if(this.cleanupFault||!id||id!==this.cleanupId||peer!==this.cleanupPeer||connection!==this.connectionSerial||epoch!==this.sendEpoch||!this.sameCleanupPeer())throw new Error('智记原连接或操作已变化，未重发');
      await this.sender(business,payload);
    });
    this.wireQueue=task.catch(()=>{});
    try{await task;}finally{payload.fill(0);this.writes--;if(this.writes===0){this.finishExitBoundary();this.changed();}}
  }
  private async launcherOn(on:boolean):Promise<void>{
    // business 15 / envelope type 20，与 iOS AlwaysOnWire.launcher 一致
    const epoch=this.sendEpoch;
    await this.send(15,20,JSON.parse(lifeLogCommand('life_log_guide',on)) as object,epoch);
    await this.send(15,20,JSON.parse(lifeLogCommand('life_log_switch',on)) as object,epoch);
  }

  // 开新段：测试模式同时留原始帧（供解码 WAV 校验），全天模式只写 OGG。
  private openSegment():void{
    this.directory=this.root+'/seg-'+this.random();fs.mkdirSync(this.directory);
    this.segmentStarted=Date.now();this.notifiedFrames=0;this.metadataWarning='';
    if(this.mode==='test')this.raw=fs.openSync(this.directory+'/source.opus',fs.OpenMode.CREATE|fs.OpenMode.READ_WRITE);
    const file=fs.openSync(this.directory+'/audio.ogg',fs.OpenMode.CREATE|fs.OpenMode.READ_WRITE);
    this.oggFile=file;let written=0;
    this.ogg=new OggOpusWriter((bytes:Uint8Array):void=>{
      fs.lseek(file.fd,written,fs.WhenceType.SEEK_SET);
      let off=0;while(off<bytes.length){const n=fs.writeSync(file.fd,bytes.slice(off).buffer);if(n<=0)throw new Error('OGG 写入失败');off+=n;}
      written+=bytes.length;fs.fsyncSync(file.fd);
    },(Date.now()>>>0)^(parseInt(this.random().slice(0,8),16)>>>0));
    if(!this.writeMeta(this.segmentStarted,0,0,false))throw new Error('智记开始时间未能保存，未启动采音');
  }

  private closeOgg():void{
    if(this.ogg){
      try{this.ogg.finish();this.writeMeta(this.segmentStarted,Date.now(),this.ogg.frames(),true);}
      catch(_){this.metadataWarning='OGG 尾页未能确认，原音保留，需核对恢复';}
      this.ogg=undefined;
    }
    if(this.oggFile){try{fs.closeSync(this.oggFile);}catch(_){}this.oggFile=undefined;}
  }

  // 段已封口：交给挂载方（通常是自动转写）。
  private notifySegmentClosed(directory:string,frames:number,started:number=this.segmentStarted):void{
    if(frames<=0)return;
    const hook=this.onSegmentClosed;
    if(!hook||!this.autoTranscribe)return;
    this.refresh();
    try{hook(directory,directory+'/audio.ogg',started);}catch(_){}
  }

  // Only flushed/fsynced OGG pages may be observed by the window worker.
  // This does not rotate capture, send commands, or expose buffered Opus frames.
  private publishPrefix():void{
    const frames=this.ogg?.frames()||0;
    if(frames-this.notifiedFrames<300)return;
    if(!this.writeMeta(this.segmentStarted,0,frames,false))return;
    this.notifiedFrames=frames;
    this.refresh();
    if(this.mode==='day'&&this.autoTranscribe){
      try{this.onSegmentProgress?.(this.directory,this.directory+'/audio.ogg',this.segmentStarted,frames);}catch(_){}
    }
  }

  // UI 切换自动转写。
  setAutoTranscribe(enabled:boolean):void{this.autoTranscribe=enabled;this.saveSchedule();this.changed();}

  initialize(context:common.Context,filesDir:string=context.filesDir,restoreCaptureIntent:boolean=true):void{
    this.root=filesDir+'/lifelog';if(!fs.accessSync(this.root))fs.mkdirSync(this.root);
    this.logFile=filesDir+'/debug-lifelog.log';this.dayFile=this.root+'/day.json';
    this.scheduleFile=this.root+'/schedule.json';
    if(!this.cleanupStore){
      const store=new DisplayCleanupStore();
      try{store.initialize(filesDir,'lifelog-cleanup.json');this.initializeCleanup(store);}
      catch(_){this.cleanupFault=true;this.note='智记退出记录初始化失败，禁止新采集';}
    }
    this.autoResumeAllowed=false;
    this.loadDay();this.loadSchedule();
    if(!restoreCaptureIntent){this.dayEnabled=false;this.scheduleEnabled=false;}
    this.armSchedule();
    this.dbg('init',`day=${this.dayEnabled} schedule=${this.scheduleEnabled?'on':'off'}`);this.refresh();
  }
  dispose():void{
    if(this.scheduleTimer!==-1)clearInterval(this.scheduleTimer);this.scheduleTimer=-1;
    this.disconnected();
    if(this.timer!==-1)clearTimeout(this.timer);this.timer=-1;
    if(this.rotateTimer!==-1)clearTimeout(this.rotateTimer);this.rotateTimer=-1;
  }
  private loadSchedule():void{
    try{
      if(!fs.accessSync(this.scheduleFile))return;
      const text=fs.readTextSync(this.scheduleFile) as string;
      const j=JSON.parse(text.length?text:'{}') as Record<string,Object>;
      this.scheduleEnabled=j['enabled']===true;
      this.autoTranscribe=j['autoTranscribe']!==false;
      const start=typeof j['start']==='string'?j['start'] as string:'09:00';
      const end=typeof j['end']==='string'?j['end'] as string:'18:00';
      if(LifelogSession.validClock(start))this.scheduleStart=start;
      if(LifelogSession.validClock(end))this.scheduleEnd=end;
    }catch(_){this.scheduleEnabled=false;}
  }
  private saveSchedule():void{
    try{
      if(fs.accessSync(this.scheduleFile))fs.unlinkSync(this.scheduleFile);
      const f=fs.openSync(this.scheduleFile,fs.OpenMode.CREATE|fs.OpenMode.WRITE_ONLY);
      try{
        const buf=new util.TextEncoder().encodeInto(JSON.stringify({enabled:this.scheduleEnabled,start:this.scheduleStart,end:this.scheduleEnd,autoTranscribe:this.autoTranscribe}));
        fs.writeSync(f.fd,buf.buffer);fs.fsyncSync(f.fd);
      }finally{fs.closeSync(f);}
    }catch(_){}
  }
  private static validClock(value:string):boolean{return /^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(value);}
  private static minutes(clock:string):number{return Number(clock.slice(0,2))*60+Number(clock.slice(3,5));}
  // 当前是否落在时间窗内（end < start 视为跨零点）。
  inWindow(now:Date=new Date()):boolean{
    if(!this.scheduleEnabled)return false;
    const current=now.getHours()*60+now.getMinutes();
    const from=LifelogSession.minutes(this.scheduleStart),to=LifelogSession.minutes(this.scheduleEnd);
    if(from===to)return false;
    return from<to?(current>=from&&current<to):(current>=from||current<to);
  }
  async applySchedule(enabled:boolean,start:string,end:string):Promise<void>{
    if(!LifelogSession.validClock(start)||!LifelogSession.validClock(end))throw new Error('时间需为 HH:mm');
    if(enabled&&start===end)throw new Error('开始与结束时间不能相同');
    this.scheduleEnabled=enabled;this.scheduleStart=start;this.scheduleEnd=end;
    this.autoResumeAllowed=enabled;
    this.saveSchedule();this.dbg('schedule',`${enabled?'on':'off'} ${start}-${end}`);
    this.armSchedule();
    await this.scheduleTick();
    this.changed();
  }
  private armSchedule():void{
    if(this.scheduleTimer!==-1){clearInterval(this.scheduleTimer);this.scheduleTimer=-1;}
    if(!this.scheduleEnabled)return;
    this.scheduleTimer=setInterval(():void=>{void this.scheduleTick();},60000);
  }
  // 每分钟（及手动变更后）核对一次：进窗自动开录、出窗自动停录。
  async scheduleTick():Promise<void>{
    if(!this.scheduleEnabled||!this.autoResumeAllowed||this.cleanupRequired&&!this.active)return;
    if(this.captureOwner)return;
    const inside=this.inWindow();
    try{
      if(inside){
        if(!this.active&&!this.busy&&this.root&&this.device()&&this.idle())await this.start('day');
      }else if(this.mode==='day'&&(this.active||this.busy)){
        await this.stop('定时窗口结束');
      }
    }catch(_){/* 窗口内起停失败：等下一分钟再试 */}
  }
  private loadDay():void{
    try{
      if(!fs.accessSync(this.dayFile))return;
      const text=fs.readTextSync(this.dayFile) as string;
      const j=JSON.parse(text.length?text:'{}') as Record<string,Object>;
      this.dayEnabled=j['enabled']===true;
    }catch(_){this.dayEnabled=false;}
  }
  private saveDay(enabled:boolean):void{
    this.dayEnabled=enabled;
    try{
      if(fs.accessSync(this.dayFile))fs.unlinkSync(this.dayFile);
      const f=fs.openSync(this.dayFile,fs.OpenMode.CREATE|fs.OpenMode.WRITE_ONLY);
      try{const buf=new util.TextEncoder().encodeInto(JSON.stringify({enabled:enabled,since:Date.now()}));fs.writeSync(f.fd,buf.buffer);fs.fsyncSync(f.fd);}
      finally{fs.closeSync(f);}
    }catch(_){}
  }
  refresh():void{
    if(!this.root)return;const rows:LifelogItem[]=[];
    let empty=0;
    for(const name of fs.listFileSync(this.root)){
      if(!/^seg-[0-9a-f]{32}$/.test(name))continue;
      try{
        const path=this.root+'/'+name;
        const row=new LifelogItem();row.name=name;row.hasText=this.hasText(path);
        if(row.hasText&&fs.accessSync(path+'/transcript.json')){
          try{if(fs.statSync(path+'/transcript.json').size<=4000000){const transcript=JSON.parse(fs.readTextSync(path+'/transcript.json')) as Record<string,Object>;row.textComplete=transcript['transcription_complete']!==false;}}
          catch(_){row.textComplete=false;}
        }
        row.ogg=fs.accessSync(path+'/audio.ogg');row.raw=fs.accessSync(path+'/source.opus');row.wav=fs.accessSync(path+'/audio.wav');
        const source=row.ogg?'audio.ogg':row.raw?'source.opus':row.wav?'audio.wav':'';
        if(!source&&!row.hasText){empty++;continue;}
        const stat=fs.statSync(path+'/'+(source||'text.md'));
        row.bytes=source?stat.size:0;row.created=LifelogSession.stamp(stat.mtime);row.ended=0;
        let frames=-1;
        try{
          if(fs.accessSync(path+'/meta.json')){
            const meta=JSON.parse(fs.readTextSync(path+'/meta.json') as string) as Record<string,Object>;
            const started=meta['started'],ended=meta['ended'];
            if(typeof meta['frames']==='number')frames=meta['frames'] as number;
            if(meta['version']===2){
              row.committedFrames=Math.max(0,frames);row.sealed=meta['sealed']===true;
              row.interrupted=!row.sealed&&!(this.active&&path===this.directory);
              row.seconds=row.committedFrames*0.06;
              // A crash can leave more durable pages than the last metadata
              // checkpoint. frames=0 is not evidence that an open file is empty.
              if(!row.sealed)frames=-1;
            }
            if(typeof started==='number')row.created=started as number;
            if(typeof ended==='number'&&(ended as number)>row.created){row.ended=ended as number;if(meta['version']!==2)row.seconds=(row.ended-row.created)/1000;}
          }
        }catch(_){}
        if(this.active&&path===this.directory){row.complete=false;row.note=this.bytes>0?'● 接收中':'等待眼镜音频';rows.push(row);continue;}
        // 只有真的录到音频的分段才进列表；空段（握手失败等）单独计数，可一键清理。
        const hasAudio=!!source&&this.hasAudio(path,source,row.bytes,frames);
        if(!hasAudio&&!row.hasText){empty++;continue;}
        if(!hasAudio){row.bytes=0;row.ogg=false;row.raw=false;row.wav=false;}
        row.complete=hasAudio&&(row.ogg||row.wav)&&!row.interrupted;
        row.note=row.interrupted?'采集中断 · 原音保留，待核对完整页':!hasAudio?'音频已清理 · 转写文字保留':row.ogg?(row.hasText?'OGG · 已转写':'OGG 已就绪'):row.wav?'已解码 WAV':'原始包保留';
        rows.push(row);
      }catch(_){}
    }
    this.emptySegments=empty;
    this.items=rows.sort((a,b)=>b.created-a.created);this.changed();
  }

  // 调用方须同时具备用户留存授权和已核验原音备份；默认保留所有原件。
  pruneAudio(keepDays:number,verified:(item:LifelogItem)=>boolean=(_item:LifelogItem):boolean=>false):number{
    if(!Number.isSafeInteger(keepDays)||keepDays<1)return 0;
    const today=new Date();today.setHours(0,0,0,0);
    const limit=today.getTime()-(keepDays-1)*86400000;
    let pruned=0;
    for(const item of this.items){
      if(item.created>=limit)continue;
      if(!item.hasText)continue;                        // 没转写就不动，避免丢数据
      if(!verified(item))continue;
      const path=this.itemDirectory(item);
      if(this.active&&path===this.directory)continue;
      if(!this.hasText(path))continue;
      let removed=false;
      for(const name of ['audio.ogg','source.opus','audio.wav','decoded.partial']){
        try{if(fs.accessSync(path+'/'+name)){fs.unlinkSync(path+'/'+name);removed=true;}}catch(_){}
      }
      if(removed)pruned++;
    }
    if(pruned){this.note=`已清理 ${pruned} 段过期音频，文字保留`;this.refresh();}
    return pruned;
  }

  // 删除单个分段（含全部派生文件）；正在收音的分段不允许删除。
  // 删除后校验目录确实消失，否则如实报错——避免"看起来没删掉"的错觉。
  remove(item:LifelogItem):void{
    const path=this.itemDirectory(item);
    if(this.active&&path===this.directory)throw new Error('正在收音的分段不能删除');
    try{this.beforeRemove?.(item);}catch(_){throw new Error('资料删除标记未能保存，本机文件保留，请稍后重试');}
    this.deleteDirectory(path);
    if(fs.accessSync(path)){
      this.refresh();
      throw new Error(this.beforeRemove?'删除标记已保存，本机文件仍被占用，请稍后重试清理':'删除未完成：文件仍被占用（可能刚在转写），稍后再试');
    }
    this.note=this.beforeRemove?'本机智记已删除；资料删除标记等待同步确认':'已删除 1 段';this.dbg('remove',item.name.slice(-8));this.refresh();
  }

  private deleteDirectory(path:string):void{
    for(const name of LifelogSession.segmentFiles){
      const file=path+'/'+name;
      if(!fs.accessSync(file))continue;
      try{fs.unlinkSync(file);}catch(_){}
    }
    try{fs.rmdirSync(path);}catch(_){}
  }

  // 清理没有录到任何音频的空分段（握手失败、眼镜未开等留下的）。
  purgeEmpty():number{
    let removed=0;
    for(const name of fs.listFileSync(this.root)){
      if(!/^seg-[0-9a-f]{32}$/.test(name))continue;
      const path=this.root+'/'+name;
      if(this.active&&path===this.directory)continue;
      // Retained transcripts must never be classified as empty audio directories.
      if(this.hasText(path)||fs.accessSync(path+'/transcript.json')||fs.accessSync(path+'/text.md.partial')||fs.accessSync(path+'/transcript.json.partial'))continue;
      let hasAudio=false;
      for(const file of ['audio.ogg','source.opus','audio.wav']){
        if(!fs.accessSync(path+'/'+file))continue;
        try{if(this.hasAudio(path,file,fs.statSync(path+'/'+file).size))hasAudio=true;}catch(_){hasAudio=true;}
      }
      if(hasAudio)continue;
      this.deleteDirectory(path);
      if(fs.accessSync(path))continue;   // 没删干净就不计数
      removed++;
    }
    this.note=removed>0?`已清理 ${removed} 个空段`:'没有可清理的空段';
    this.dbg('purge',`removed=${removed}`);this.refresh();
    return removed;
  }

  // HarmonyOS 的 Stat.mtime 以秒为单位，这里统一成毫秒（已按毫秒给的平台保持原样）。
  private static stamp(mtime:number):number{return mtime<1e11?Math.round(mtime*1000):Math.round(mtime);}

  private writeMeta(started:number,ended:number,frames:number,sealed:boolean=false):boolean{
    try{
      const path=this.directory+'/meta.json';
      const body=new util.TextEncoder().encodeInto(JSON.stringify({version:2,started:started,ended:ended,frames:frames,seconds:frames*0.06,sealed:sealed}));
      const f=fs.openSync(path+'.partial',fs.OpenMode.CREATE|fs.OpenMode.WRITE_ONLY|fs.OpenMode.TRUNC);
      try{this.write(f.fd,body,0);fs.fsyncSync(f.fd);}finally{fs.closeSync(f);body.fill(0);}
      fs.renameSync(path+'.partial',path);this.metadataWarning='';return true;
    }catch(_){this.metadataWarning='智记时间与进度未能保存，原音保留，待重试';return false;}
  }

  async start(mode:string='test'):Promise<void>{
    if(this.decoding)throw new Error('智记原音仍在解码收尾，请稍后');
    if(this.captureOwner)throw new Error('当前任务结束后会自动恢复智记');
    if(this.busy)throw new Error('智记操作繁忙');
    if(this.active)throw new Error('智记已在进行');
    if(this.cleanupRequired||this.pendingWrites)throw new Error('请先清理上次智记退出记录');
    const peer=this.device();
    if(!this.root||!peer||!this.idle())throw new Error('请先连接眼镜，并关闭语音、录音和其他显示任务');
    this.busy=true;
    try{
      this.mode=mode==='day'?'day':'test';
      this.openSegment();
      this.coverage=new RecordingCoverage();this.taskId=this.random();this.a2Sent=false;this.stopAt=0;
      this.connectionReady=true;this.cleanupPeer=peer;this.cleanupId='life-'+this.random();
      this.localSealed=false;this.exitAttempt=false;this.exitObserved=false;this.exitFailed=false;this.stopWork=undefined;
      this.persistCleanup();this.autoResumeAllowed=true;
      this.packets=0;this.dropped=0;this.bytes=0;this.segments=0;
      this.active=true;this.generation++;
      const generation=this.generation;
      if(this.mode==='day'){
        this.deadline=Number.MAX_SAFE_INTEGER;this.saveDeadline=Number.MAX_SAFE_INTEGER;
        this.saveDay(true);
        this.rotateAt=this.nextRotateAt();this.scheduleRotate(generation);
        this.note='全天模式已开启：已下发开关 ON，等待眼镜唤醒（A1）…';
      }else{
        this.deadline=Date.now()+25000;this.saveDeadline=Date.now()+30000;
        this.timer=setTimeout(()=>{if(generation===this.generation&&this.active)this.stop('25秒上限').catch(()=>{});},25000);
        this.note='已下发全天开关 ON，等待眼镜唤醒（A1）…';
      }
      await this.launcherOn(true);
      this.dbg('start',`${this.mode} ${this.taskId}`);
    }catch(error){const msg=(error as Error).message;this.fail(msg);throw new Error(msg);}
    finally{this.busy=false;this.changed();}
  }

  async stop(reason:string='手动停止',preserveDay:boolean=false):Promise<void>{
    if(!this.active)return;
    if(this.stopAt>0){await this.stopWork;return;}
    this.dbg('stop-req',reason);
    if(this.stopAt===0)this.stopAt=Date.now();
    this.note='已请求停止，等待尾包与关闭回报';
    if(this.rotateTimer!==-1){clearTimeout(this.rotateTimer);this.rotateTimer=-1;}
    this.closingMode=this.mode;
    if(this.mode==='day'&&!preserveDay){this.saveDay(false);this.mode='test';}
    if(this.timer!==-1){clearTimeout(this.timer);this.timer=-1;}
    const generation=this.generation;
    this.saveDeadline=Math.min(this.saveDeadline,Date.now()+3000);
    this.timer=setTimeout(()=>{
      this.timer=-1;
      // Drain already queued tail packets before closing the segment.
      this.queue=this.queue.then(async():Promise<void>=>{if(generation===this.generation)await this.finish(generation);})
        .catch(()=>{if(generation===this.generation)this.fail('封装失败，原始数据已保留');});
    },3000);
    this.changed();
    this.stopWork=this.requestExit();await this.stopWork;
  }
  private requestExit():Promise<void>{
    if(!this.cleanupId||this.cleanupFault||!this.sameCleanupPeer())return Promise.reject(new Error('请连接原眼镜后显式清理智记'));
    this.exitSending=true;this.exitAttempt=true;this.exitObserved=false;this.exitFailed=false;
    const epoch=++this.sendEpoch;
    const work=(async():Promise<void>=>{
      try{
        const exit:LifelogExitCommand={rc:2};
        try{await this.send(13,166,exit,epoch);}catch(_){this.exitFailed=true;}
        try{await this.send(15,20,JSON.parse(lifeLogCommand('life_log_guide',false)) as object,epoch);}catch(_){this.exitFailed=true;}
        try{await this.send(15,20,JSON.parse(lifeLogCommand('life_log_switch',false)) as object,epoch);}catch(_){this.exitFailed=true;}
        if(this.exitFailed)throw new Error('智记退出指令未提交完整，保留退出占用');
      }finally{this.exitSending=false;this.finishExitBoundary();this.changed();}
    })();
    return work;
  }

  // Pause capture, not the persisted day intent. Recording owns the microphone
  // only after tail sealing, drained native writes and confirmed device exit.
  async suspendForRecording():Promise<void>{
    return this.suspendCapture('recording');
  }
  async suspendForVoice():Promise<void>{return this.suspendCapture('voice');}
  private async suspendCapture(owner:string):Promise<void>{
    if(this.captureOwner===owner&&this.pauseDone)return this.pauseDone;
    if(this.captureOwner)throw new Error('正在切换麦克风任务，请稍候');
    if(this.busy)throw new Error('智记正在启动，请稍后录音');
    if(this.decoding)throw new Error('智记原音仍在解码收尾，请稍后交接麦克风');
    if(this.cleanupRequired&&!this.active||this.pendingWrites&&!this.active)throw new Error('智记退出尚未确认，不能交接麦克风');
    this.pauseDone=undefined;this.captureOwner=owner;this.changed();
    if(!this.active)return;
    const sealed=new Promise<void>((resolve:()=>void,reject:(error:Error)=>void):void=>{
      this.pauseResolve=resolve;this.pauseReject=reject;
    });
    this.pauseTimer=setTimeout(():void=>{if(this.pauseDone!==sealed)return;this.pauseTimer=-1;this.settlePause(new Error('智记麦克风交接8.5秒超时，原采集占用仍保留'));},8500);
    this.pauseDone=sealed;
    void this.stop(owner==='recording'?'转入录音':'转入 AI 对话',true).catch((error:Error):void=>{if(this.pauseDone===sealed)this.settlePause(error);});
    return sealed;
  }
  async resumeAfterRecording():Promise<void>{
    return this.resumeAfterCapture('recording');
  }
  async resumeAfterVoice():Promise<void>{return this.resumeAfterCapture('voice');}
  private async resumeAfterCapture(owner:string):Promise<void>{
    if(this.captureOwner!==owner)return;
    // A cancellation during handoff must still wait for the closing segment;
    // resuming while active would miss the later transition to inactive.
    try{await this.pauseDone;}catch(_){}
    if(this.captureOwner!==owner)return;
    this.pauseDone=undefined;
    this.captureOwner='';
    await this.connected();this.changed();
  }
  private settlePause(error:Error|undefined=undefined):void{
    if(this.pauseTimer!==-1)clearTimeout(this.pauseTimer);this.pauseTimer=-1;
    const resolve=this.pauseResolve,reject=this.pauseReject;
    this.pauseResolve=undefined;this.pauseReject=undefined;
    if(error){this.captureOwner='';if(reject)reject(error);}else if(resolve)resolve();
  }

  // 分段时长（分钟），供 UI / 测试调整轮转节奏；设为区间模式。
  setSegmentMinutes(minutes:number):void{if(minutes>0&&minutes<=24*60){this.segmentMs=Math.round(minutes*60000);this.clockAlign=false;}}

  // 整点对齐切段（会议友好）：按 wall clock 的 N 分钟刻度切，默认每整点。
  setClockAlign(stepMinutes:number):void{if(stepMinutes>0&&stepMinutes<=24*60)this.clockStepMinutes=Math.round(stepMinutes);this.clockAlign=true;}

  private nextRotateAt():number{
    if(!this.clockAlign)return Date.now()+this.segmentMs;
    const step=this.clockStepMinutes*60000;
    return (Math.floor(Date.now()/step)+1)*step;
  }

  // 未在收音时关闭全天模式：清标记并尽力下发眼镜开关 OFF。
  async stopDay():Promise<void>{
    this.autoResumeAllowed=false;
    this.saveDay(false);
    if(this.active){await this.stop('手动结束全天模式');return;}
    this.saveDay(false);this.mode='test';
    if(this.cleanupRequired){await this.cleanup();return;}
    this.note='全天模式已关闭';
    this.dbg('day-off','');this.changed();
  }

  // Only a verified same-process handoff may resume. Recovery never replays ON.
  async connected():Promise<void>{
    if(!this.connectionReady&&this.device()){this.connectionReady=true;this.connectionSerial++;}
    if(this.cleanupRequired){this.note='智记退出未确认，连接恢复仅允许清理；不会自动开始采集';this.changed();return;}
    if(this.captureOwner)return;
    if(!this.autoResumeAllowed)return;
    if(!this.dayEnabled||this.active||this.busy)return;
    if(this.scheduleEnabled&&!this.inWindow())return;   // 定时模式下窗口外不自动开录
    if(!this.root||!this.device()||!this.idle())return;
    try{await this.start('day');this.note='重连后已自动恢复全天智记';this.dbg('day-resume','');}
    catch(error){this.note='自动恢复全天智记失败：'+(error as Error).message;}
    this.changed();
  }

  disconnected():void{
    this.connectionReady=false;this.connectionSerial++;this.sendEpoch++;this.exitAttempt=false;this.exitObserved=false;this.autoResumeAllowed=false;
    const reject=this.cleanupWaitReject;this.clearCleanupWait();if(reject)reject(new Error('连接中断，智记退出占用仍保留'));
    this.settlePause(new Error('连接中断，请重新连接后清理智记'));
    if(!this.active)return;
    if(this.mode==='day'){
      this.generation++;this.active=false;
      if(this.rotateTimer!==-1){clearTimeout(this.rotateTimer);this.rotateTimer=-1;}
      this.writeMeta(this.segmentStarted,Date.now(),this.coverage.length()/240);
      this.closeOgg();
      if(this.raw){try{fs.closeSync(this.raw);}catch(_){}this.raw=undefined;}
      try{audio.lifelogClose();}catch(_){}this.recycleEmpty(this.directory,this.coverage.length()/240);
      this.localSealed=true;this.note='连接中断；本段 OGG 已封口，原设备退出待清理；不会自动续录';
      this.dbg('day-disconnected',`bytes=${this.bytes}`);
      this.notifySegmentClosed(this.directory,this.coverage.length()/240);
      this.settlePause(new Error('连接中断，请重新连接后录音'));
      this.refresh();this.changed();return;
    }
    this.fail('连接中断；原始数据保留');
  }

  private fail(note:string):void{
    if(this.active&&this.directory)this.writeMeta(this.segmentStarted,Date.now(),this.coverage.length()/240);
    this.generation++;this.active=false;this.note=note;this.dbg('fail',note);
    if(this.timer!==-1){clearTimeout(this.timer);this.timer=-1;}
    if(this.rotateTimer!==-1){clearTimeout(this.rotateTimer);this.rotateTimer=-1;}
    this.closeOgg();
    if(this.raw){try{fs.closeSync(this.raw);}catch(_){}this.raw=undefined;}
    try{audio.lifelogClose();}catch(_){}
    this.localSealed=true;this.autoResumeAllowed=false;
    this.settlePause(new Error(note));
    this.refresh();this.changed();
  }

  receiveLauncher(payload:Uint8Array):void{
    // business 15 的 life_log_* 回报
    try{
      const envelope=readLauncherEnvelope(payload);
      if(envelope.type!==21)return;
      const text=new util.TextDecoder().decodeToString(envelope.json);
      if(!text.includes('life_log'))return;
      this.dbg('launcher-rx',text.slice(0,300));
      const j=JSON.parse(text) as Record<string,Object>;
      const cmd=String(j['cmd']??'');
      const p=j['payload'] as Record<string,Object>;
      const value=typeof p?.['value']==='number'?p['value'] as number:-1;
      if(cmd==='life_log_switch_result'&&value>0&&this.active&&this.stopAt===0){
        const reason=({1:'眼镜报告无麦克风权限',2:'请展开镜腿',3:'眼镜电量低'} as Record<number,string>)[value]??`眼镜拒绝，结果码 ${value}`;
        this.fail(reason);
      }
      if(cmd==='life_log_switch'&&value===0&&this.stopAt>0){this.note='收到眼镜关闭状态；未重新采音';this.dbg('off-observed');}
    }catch(_){/* 非 life_log 负载忽略 */}
  }

  receive(peer:string,payload:Uint8Array):void{
    if(!this.connectionReady||!this.cleanupId||peer!==this.cleanupPeer||peer!==this.device())return;
    if(this.queued>=32){this.fail('智记队列溢出，原始数据已保留');return;}
    const copy=payload.slice(),generation=this.generation,exitEpoch=this.stopAt>0&&this.exitAttempt?this.sendEpoch:-1;this.queued++;
    const task=this.queue.then(async()=>{if(generation!==this.generation)return;await this.handle(peer,copy,exitEpoch);});
    this.queue=task.catch(()=>{this.fail('智记包处理失败');}).finally(()=>{copy.fill(0);this.queued--;});
  }

  private async handle(peer:string,bytes:Uint8Array,exitEpoch:number):Promise<void>{
    const packet=readLauncherEnvelope(bytes);
    try{
      const text=new util.TextDecoder().decodeToString(packet.json);
      if(packet.type!==163&&packet.type!==164)this.dbg('pkt',`t${packet.type} ${text.slice(0,300)} active=${this.active}`);
      const j=JSON.parse(text.length?text:'{}') as Record<string,Object>;
      if(packet.type===161){  // A1 眼镜唤醒
        if(!this.active||this.stopAt>0||this.a2Sent||Date.now()>this.deadline)return;
        this.a2Sent=true;
        const generation=this.generation,epoch=this.sendEpoch;this.persistCleanup();
        // 眼镜实测会在数十秒~数分钟后自行退出本轮（A5 rc=0）；把闲置容忍度放大，减少空档。
        const startCmd:LifelogStartCommand={taskId:this.taskId,idleTimeoutSec:this.idleTimeoutSec};
        await this.send(13,162,startCmd,epoch);  // A2 收音
        if(generation!==this.generation||this.stopAt>0)return;
        const pageCmd:LifelogPageCommand={inRealtimePage:false};
        await this.send(13,168,pageCmd,epoch);   // A8 非实时页面
        this.note='已应答眼镜唤醒（A2/A8），等待音频…';this.dbg('a2-sent',this.taskId);this.changed();
        return;
      }
      if(packet.type===163||packet.type===164){  // A3/A4 音频
        const incoming=typeof j['taskId']==='string'?j['taskId'] as string:'';
        if(incoming!==this.taskId){this.dropped++;this.dbg('drop-taskid',incoming.slice(0,40));return;}
        if(!this.active||!this.a2Sent||Date.now()>this.saveDeadline){this.dropped++;return;}
        if(this.stopAt>0)this.note='停止已请求，保存本轮尾包';
        if(!this.ogg)throw new Error('file-closed');
        // 音频帧：json.frameCount 个 240B opus 帧在 binary 头部，剩余为未用字节
        const available=Math.floor(packet.binary.length/240);
        const declared=typeof j['frameCount']==='number'?j['frameCount'] as number:available;
        const frames=Math.min(31,Math.max(0,Math.min(available,declared)));
        const data=packet.binary.slice(0,frames*240);
        const offset=this.coverage.length();
        this.coverage.validate(offset,data.length);
        if(this.raw){this.write(this.raw.fd,data,offset);fs.fsyncSync(this.raw.fd);}
        for(let index=0;index<frames;index++)this.ogg.push(data.slice(index*240,(index+1)*240));
        this.coverage.accept(offset,data.length);this.bytes=this.coverage.length();this.packets++;
        this.publishPrefix();
        this.note='正在接收全天音频 · '+this.bytes+' B';
        if(this.packets%50===1)this.dbg('audio',`pkts=${this.packets} bytes=${this.bytes}`);
        this.changed();
        return;
      }
      if(packet.type===165){  // A5 眼镜退出
        this.dbg('a5-exit',text.slice(0,200));
        if(j['rc']!==0)return;
        if(typeof j['taskId']==='string'&&j['taskId']!==this.taskId)return;
        if(exitEpoch===this.sendEpoch&&this.exitAttempt&&this.sameCleanupPeer()){
          this.exitObserved=true;this.finishExitBoundary();return;
        }
        if(!this.active)return;
        if(this.stopAt===0){
          if(this.mode==='day')await this.rearm('眼镜退出本轮收音');
          else{await this.stop('眼镜退出');this.exitObserved=true;this.finishExitBoundary();}
        }
        return;
      }
    }finally{packet.binary.fill(0);packet.json.fill(0);}
  }

  private async finish(generation:number):Promise<void>{
    this.dbg('finish-try',`bytes=${this.bytes}`);
    if(!this.ogg)return;
    if(this.bytes===0){
      this.writeMeta(this.segmentStarted,Date.now(),0);this.closeOgg();
      if(this.raw){fs.closeSync(this.raw);this.raw=undefined;}
      this.active=false;this.recycleEmpty(this.directory,0);
      this.note=this.captureOwner?'智记已待命，正在切换麦克风任务':'本段没有收到音频';
      this.localSealed=true;this.refresh();this.finishExitBoundary();return;
    }
    const directory=this.directory;
    const frames=this.coverage.length()/240;
    this.writeMeta(this.segmentStarted,Date.now(),frames);
    this.closeOgg();
    if(this.raw){try{fs.closeSync(this.raw);}catch(_){}this.raw=undefined;}
    if(this.closingMode==='test'){
      const bad=await this.decodeSegment(directory);
      if(generation!==this.generation)throw new Error('cancelled');
      this.active=false;
      this.note=bad===0?'本轮已保存 OGG 并解码 WAV；未上传、未转写。':`已保存 OGG 与 WAV（${bad} 个坏帧以静音占位）`;
      this.dbg('finish-ok',`bad=${bad}`);
    }else{
      this.active=false;
      this.note='全天智记已结束；本段 OGG 已封口。';
      this.dbg('finish-ok','ogg');
      this.notifySegmentClosed(directory,frames);
    }
    this.localSealed=true;this.refresh();this.changed();
    this.finishExitBoundary();
  }

  // ---- 全天模式：分段轮转（OGG 封口即完成，无转码、无解码） ----
  private scheduleRotate(generation:number):void{
    if(this.rotateTimer!==-1){clearTimeout(this.rotateTimer);this.rotateTimer=-1;}
    const wait=Math.max(1000,this.rotateAt-Date.now());
    this.rotateTimer=setTimeout(():void=>{
      this.rotateTimer=-1;
      if(generation!==this.generation||!this.active||this.stopAt>0)return;
      const task=this.queue.then(async():Promise<void>=>{if(generation!==this.generation||!this.active||this.stopAt>0)return;await this.rotateSegment();});
      this.queue=task.catch(():void=>{this.fail('智记分段失败');});
    },wait);
  }

  private async rotateSegment():Promise<void>{
    const done=this.directory,frames=this.coverage.length()/240,covered=this.bytes,started=this.segmentStarted;
    this.writeMeta(this.segmentStarted,Date.now(),frames);
    this.closeOgg();
    if(this.raw){try{fs.closeSync(this.raw);}catch(_){}this.raw=undefined;}
    this.segments++;
    this.openSegment();
    this.coverage=new RecordingCoverage();this.bytes=0;this.packets=0;
    this.rotateAt=this.nextRotateAt();this.scheduleRotate(this.generation);
    this.dbg('rotate',`frames=${frames} bytes=${covered}`);
    this.recycleEmpty(done,frames);
    this.notifySegmentClosed(done,frames,started);
    this.note=`全天智记分段中 · 本次已存 ${this.segments+1} 段`;
    this.refresh();this.changed();
  }

  // 眼镜主动退出不结束全天会话：切段存盘并等待下一次唤醒。
  private async rearm(reason:string):Promise<void>{
    const done=this.directory,frames=this.coverage.length()/240,covered=this.bytes,started=this.segmentStarted;
    this.writeMeta(this.segmentStarted,Date.now(),frames);
    this.closeOgg();
    if(this.raw){try{fs.closeSync(this.raw);}catch(_){}this.raw=undefined;}
    this.segments++;
    this.openSegment();
    this.coverage=new RecordingCoverage();this.bytes=0;this.packets=0;this.a2Sent=false;this.taskId=this.random();
    this.rotateAt=this.nextRotateAt();this.scheduleRotate(this.generation);
    this.dbg('rearm',`${reason} frames=${frames}`);
    this.recycleEmpty(done,frames);
    this.notifySegmentClosed(done,frames,started);
    this.note=`${reason}；已切新段待命（本次累计 ${this.segments+1} 段）`;
    this.refresh();this.changed();
  }

  private recycleEmpty(directory:string,frames:number):void{
    if(frames>0)return;
    for(const name of LifelogSession.segmentFiles){
      try{fs.unlinkSync(directory+'/'+name);}catch(_){}
    }
    try{fs.rmdirSync(directory);}catch(_){}
  }

  private async decodeSegment(directory:string):Promise<number>{
    if(this.decoding)throw new Error('智记原音仍在解码收尾，请稍后');
    const generation=this.generation;
    const source=directory+'/source.opus';
    const frames=Math.floor(fs.statSync(source).size/240);
    if(frames<=0)return 0;
    const input=fs.openSync(source,fs.OpenMode.READ_ONLY);
    const output=fs.openSync(directory+'/decoded.partial',fs.OpenMode.CREATE|fs.OpenMode.WRITE_ONLY);
    let bad=0;this.decoding=true;
    try{
      audio.lifelogReset();this.write(output.fd,monoWavHeader(frames*1920),0);
      for(let index=0;index<frames;index++){
        if(generation!==this.generation)throw new Error('cancelled');
        const raw=this.read(input.fd,index*240,240);let pcm=new Uint8Array();
        try{
          try{pcm=new Uint8Array(audio.lifelogDecode(raw.buffer));}catch(_){pcm=new Uint8Array(0);}
          if(pcm.length!==1920){bad++;pcm=new Uint8Array(1920);}  // 坏帧以静音占位，保住整段可用时长
          this.write(output.fd,pcm,44+index*1920);
        }
        finally{raw.fill(0);pcm.fill(0);}
        if(index%2000===0){
          await new Promise<void>((resolve:()=>void)=>{setTimeout(resolve,0);});
          if(generation!==this.generation)throw new Error('cancelled');
        }
      }
      fs.fsyncSync(output.fd);
    }finally{
      try{try{fs.closeSync(input);}finally{fs.closeSync(output);}}
      finally{try{audio.lifelogClose();}catch(_){}this.decoding=false;this.changed();}
    }
    fs.renameSync(directory+'/decoded.partial',directory+'/audio.wav');
    this.dbg('segment-decoded',`frames=${frames} bad=${bad}`);
    return bad;
  }

  // 导出用路径：kind = 'ogg' | 'wav' | 'raw'
  file(item:LifelogItem,kind:string):string{
    const path=this.itemDirectory(item)+(kind==='ogg'?'/audio.ogg':kind==='wav'?'/audio.wav':'/source.opus');
    if(!fs.accessSync(path))throw new Error('音频已清理，保留的文字仍可查看和导出');
    return path;
  }

  textPath(item:LifelogItem):string{return this.itemDirectory(item)+'/text.md';}

  readText(item:LifelogItem):string{return fs.readTextSync(this.textPath(item)) as string;}

  // 智记根目录（供汇总/上传等外部模块读写）。
  rootPath():string{return this.root;}

  // 开发调试：把一段现成 OGG 封成智记分段（诊断页导入测试音频用），返回分段名。
  importSegment(ogg:Uint8Array,started:number,ended:number):string{
    if(!this.root)throw new Error('智记目录未就绪');
    const name='seg-'+this.random();
    const dir=this.root+'/'+name;fs.mkdirSync(dir);
    const audio=fs.openSync(dir+'/audio.ogg',fs.OpenMode.CREATE|fs.OpenMode.READ_WRITE);
    try{let off=0;while(off<ogg.length){const n=fs.writeSync(audio.fd,ogg.slice(off).buffer);if(n<=0)break;off+=n;}fs.fsyncSync(audio.fd);}
    finally{fs.closeSync(audio);}
    const meta=fs.openSync(dir+'/meta.json',fs.OpenMode.CREATE|fs.OpenMode.READ_WRITE);
    try{
      const buf=new util.TextEncoder().encodeInto(JSON.stringify({started:started,ended:ended,imported:true}));
      fs.writeSync(meta.fd,buf.buffer);fs.fsyncSync(meta.fd);
    }finally{fs.closeSync(meta);}
    this.refresh();
    return name;
  }

  // 读取某段的转写 JSON（没有则返回空串）。
  readTranscriptJson(item:LifelogItem):string{
    const path=this.itemDirectory(item);
    try{return fs.readTextSync(path+'/transcript.json') as string;}catch(_){return '';}
  }

  // 按目录保存转写结果（自动转写用，不需要 UI 里的 item）。
  saveSegmentResult(directory:string,markdown:string,json:string):void{
    const name=directory.slice(this.root.length+1);
    if(!this.root||directory!==this.root+'/'+name||!/^seg-[0-9a-f]{32}$/.test(name)||!fs.accessSync(directory))throw new Error('智记分段标识无效或已删除');
    if(!markdown.trim()||!json.trim())throw new Error('转写结果为空');
    // Write JSON first; text.md is the commit marker for retention/recovery.
    this.saveTextFile(directory+'/transcript.json',json);
    this.saveTextFile(directory+'/text.md',markdown);
    this.refresh();
  }
  private saveTextFile(path:string,text:string):void{
    const pending=path+'.partial',body=new util.TextEncoder().encodeInto(text);
    const f=fs.openSync(pending,fs.OpenMode.CREATE|fs.OpenMode.WRITE_ONLY|fs.OpenMode.TRUNC);
    try{this.write(f.fd,body,0);fs.fsyncSync(f.fd);}finally{fs.closeSync(f);body.fill(0);}
    fs.renameSync(pending,path);
  }

  // 转写结果同时落 JSON（绝对时间轴），供每日汇总与后续总结/上传使用。
  saveTranscriptJson(item:LifelogItem,json:string):void{
    this.saveTextFile(this.itemDirectory(item)+'/transcript.json',json);
  }

  private static dayKey(ms:number):string{
    const d=new Date(ms);const p=(n:number):string=>n<10?'0'+n:''+n;
    return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}`;
  }

  private static clock(ms:number):string{
    const d=new Date(ms);const p=(n:number):string=>n<10?'0'+n:''+n;
    return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  }

  private static duration(seconds:number):string{
    const total=Math.max(0,Math.round(seconds));const h=Math.floor(total/3600),m=Math.floor(total%3600/60),s=total%60;
    return h>0?`${h}小时${m}分`:(m>0?`${m}分${s}秒`:`${s}秒`);
  }

  // 某天零点的毫秒时间戳（本地日期）。
  static dayStart(dayOffset:number=0):number{
    const base=new Date();base.setHours(0,0,0,0);
    return base.getTime()+dayOffset*86400000;
  }

  // 指定一天（以当天零点毫秒为界）内的分段，按开始时间升序。
  dayItemsIn(start:number):LifelogItem[]{
    const end=start+86400000;
    return this.items.filter((item:LifelogItem):boolean=>item.created>=start&&item.created<end)
      .sort((a:LifelogItem,b:LifelogItem):number=>a.created-b.created);
  }

  dayItems(dayOffset:number=0):LifelogItem[]{return this.dayItemsIn(LifelogSession.dayStart(dayOffset));}

  // 渲染某天的汇总 Markdown：绝对时间轴 + 有效语音统计；summary 非空时插入 AI 总结。
  dayText(dayOffset:number=0,summary:string=''):LifelogDayText{return this.dayTextIn(LifelogSession.dayStart(dayOffset),summary);}

  dayTextIn(start:number,summary:string=''):LifelogDayText{
    const items=this.dayItemsIn(start);
    if(!items.length)throw new Error('这一天没有智记分段');
    let seconds=0,speech=0,transcribed=0;
    const lines:string[]=[];
    for(const item of items){
      const duration=item.seconds>0?item.seconds:(item.ended>item.created?(item.ended-item.created)/1000:0);
      seconds+=duration;
      lines.push('');
      lines.push(`## ${LifelogSession.clock(item.created)}${item.ended>item.created?'–'+LifelogSession.clock(item.ended):''}　（${LifelogSession.duration(duration)}）`);
      lines.push('');
      let parsed:Record<string,Object>|undefined=undefined;
      try{
        const raw=fs.readTextSync(this.root+'/'+item.name+'/transcript.json') as string;
        parsed=JSON.parse(raw) as Record<string,Object>;
      }catch(_){parsed=undefined;}
      if(parsed){
        if(parsed['transcription_state']==='unknown')lines.push('-（文字已保存，覆盖范围尚未核实）');
        else if(parsed['transcription_complete']!==false)transcribed++;
        else lines.push('-（文字仍在分窗处理中，原音已保存）');
        const rows=parsed['utterances'] as LifelogUtteranceRow[];
        let segmentSpeech=0;
        if(rows&&rows.length){
          for(const row of rows){
            const started=item.created+Math.round(row.start*1000);
            segmentSpeech+=Math.max(0,row.end-row.start);
            lines.push(`- **[${LifelogSession.clock(started)}]** ${row.text}`);
          }
        }else{
          lines.push('-（本段未检测到有效语音）');
        }
        speech+=segmentSpeech;
      }else{
        lines.push('-（本段尚未转写：可在分段列表点「离线」）');
      }
    }
    const head:string[]=[`# ${LifelogSession.dayKey(items[0].created)} 全天智记`,
      '',
      `- 分段 ${items.length} 段 · 录音总时长 ${LifelogSession.duration(seconds)} · 有效语音 ${LifelogSession.duration(speech)} · 已转写 ${transcribed}/${items.length} 段`,
      `- 由眼镜收音 → 本机 OGG 存储 → 本机离线转写（VAD 剔除静音）；文本可能含识别错误`];
    if(summary)head.push('','## AI 总结','',summary);
    const out=new LifelogDayText();
    out.markdown=head.concat(lines).join('\n')+'\n';out.transcribed=transcribed;out.total=items.length;
    return out;
  }

  // 写入沙盒并把路径交给 UI 导出。
  saveDayFile(dayOffset:number,markdown:string):string{return this.saveDayFileIn(LifelogSession.dayStart(dayOffset),markdown);}

  saveDayFileIn(start:number,markdown:string):string{
    const items=this.dayItemsIn(start);
    const name=`day-${LifelogSession.dayKey(items.length?items[0].created:Date.now())}.md`;
    const path=this.root+'/'+name;
    const body=new util.TextEncoder().encodeInto(markdown);
    const f=fs.openSync(path,fs.OpenMode.CREATE|fs.OpenMode.WRITE_ONLY|fs.OpenMode.TRUNC);
    try{let off=0;while(off<body.length){const n=fs.writeSync(f.fd,body.slice(off).buffer);if(n<=0)throw new Error('汇总写入不完整');off+=n;}fs.fsyncSync(f.fd);}finally{fs.closeSync(f);}
    return path;
  }

  dayFilePath(dayOffset:number=0):string{
    const items=this.dayItems(dayOffset);
    return this.root+'/day-'+LifelogSession.dayKey(items.length?items[0].created:Date.now())+'.md';
  }

  saveTranscript(item:LifelogItem,markdown:string):void{
    const path=this.textPath(item);
    const body=new util.TextEncoder().encodeInto(markdown);
    const f=fs.openSync(path,fs.OpenMode.CREATE|fs.OpenMode.WRITE_ONLY|fs.OpenMode.TRUNC);
    try{let off=0;while(off<body.length){const n=fs.writeSync(f.fd,body.slice(off).buffer);if(n<=0)throw new Error('转写写入不完整');off+=n;}fs.fsyncSync(f.fd);}finally{fs.closeSync(f);}
    this.refresh();
  }
}
