import { common } from '@kit.AbilityKit';
import { fileIo as fs } from '@kit.CoreFileKit';
import { util } from '@kit.ArkTS';
import { cryptoFramework } from '@kit.CryptoArchitectureKit';
import { hilog } from '@kit.PerformanceAnalysisKit';
import * as audio from 'libturbo_audio.so';
import { businessEnvelope,readLauncherEnvelope } from 'turbo_core';
import { RecordingCoverage,stereoWavHeader } from './RecordingCoverage';
import { DisplayCleanupStore } from './DisplayCleanupStore';

export class RecordingItem { name:string='';created:number=0;bytes:number=0;complete:boolean=false;rawAvailable:boolean=false;note:string='';textFile:string=''; }
export class RecordingCaptureHandle {
  ownerId:string='';cleanupId:string='';uuid:string='';directory:string='';peer:string='';connectionEpoch:number=0;
}
export interface RecordingOwnedStart {
  ownerId:string;maxDurationMs:number;
  guard:()=>Promise<void>;
  // Final synchronous authorization check, including local cancellation and
  // the original request deadline; never wait for a network call here.
  current:()=>boolean;
  // Persist the task/source association before the microphone start write.
  // This is per invocation; the normal recording/ASR callbacks stay intact.
  reserved:(handle:RecordingCaptureHandle)=>void;
}
class RecordingOwnedAttempt {
  handle:RecordingCaptureHandle=new RecordingCaptureHandle();generation:number=0;
  stopRequested:boolean=false;startSubmitted:boolean=false;stopSubmitted:boolean=false;
}
class RecordingManifest {
  version:number=1;uuid:string='';peer:string='';created:number=0;completed:boolean=false;
  valid:boolean=true;wavReady:boolean=false;coverage:number[][]=[];
  voice_owner:string='';voice_cleanup_id:string='';voice_exit_evidence:string='none';
}
interface RecordCommand { uuid?:string;action?:number;code?:number;mode?:number;type?:number;isAppForeground?:boolean; }
class RecordingCleanupRecord { schema:number=1;id:string='';peer:string='';uuid:string='';evidence:string='none'; }

// Explicit opt-in online profile. No cloud upload, deletion, offline catch-up or
// microphone permission. Partial files are retained; completion is never guessed.
export class RecordingSession {
  // 录音封口后的回调（自动本地转写用）。
  onRecordingClosed:((directory:string,rawPath:string,started:number)=>void)|undefined=undefined;
  beforeRemove:((item:RecordingItem)=>void)|undefined=undefined;
  beforeStart:()=>Promise<void>=async():Promise<void>=>{};
  onSessionEnded:()=>void=():void=>{};
  autoLocalTranscribe:boolean=true;
  enabled:boolean=false;active:boolean=false;busy:boolean=false;bytes:number=0;
  starting:boolean=false;stopping:boolean=false;
  note:string='录音接收未开启';items:RecordingItem[]=[];
  changed:()=>void=():void=>{};
  private root:string='';private directory:string='';private raw:fs.File|undefined=undefined;
  private manifest:RecordingManifest=new RecordingManifest();private coverage:RecordingCoverage=new RecordingCoverage();
  private sender:(business:number,payload:Uint8Array)=>Promise<void>;
  private device:()=>string;private idle:()=>boolean;
  private timer:number=-1;private grace:number=-1;private startDeadline:number=-1;private generation:number=0;
  private queue:Promise<void>=Promise.resolve();private queued:number=0;private finalizing:boolean=false;
  private logFile:string='';
  private checkpointBytes:number=0;private checkpointAt:number=0;private stopRequestedAt:number=0;
  private cleanupStore:DisplayCleanupStore|undefined=undefined;
  private cleanupFault:boolean=false;private cleanupId:string='';private cleanupPeer:string='';private cleanupUuid:string='';
  private deviceExited:boolean=false;private cleanupStopSubmitted:boolean=false;private writes:number=0;private connectionEpoch:number=0;private endNotified:boolean=true;
  private owned:RecordingOwnedAttempt|undefined=undefined;
  private restoredOwned:RecordingCaptureHandle|undefined=undefined;
  get pendingWrites():boolean{return this.writes>0;}
  get cleanupRequired():boolean{return this.cleanupFault||!!this.cleanupId;}
  get occupied():boolean{return this.active||this.busy||this.finalizing||this.cleanupRequired||this.pendingWrites;}
  get cleanupSessionId():string{return this.cleanupId;}
  get activeDirectory():string{return this.active?this.directory:'';}
  get rootDirectory():string{return this.root;}
  get canConfirmExited():boolean{return !!this.cleanupId&&!this.cleanupFault&&!this.busy&&!this.finalizing&&!this.pendingWrites&&!!this.cleanupPeer&&this.device()===this.cleanupPeer&&(!this.active||this.stopping);}
  private notifySessionEnded():void{if(!this.occupied&&!this.endNotified){this.endNotified=true;this.onSessionEnded();}}
  private initializeCleanup(filesDir:string):void{
    if(this.cleanupStore)return;
    const store=new DisplayCleanupStore();this.cleanupStore=store;
    try{
      store.initialize(filesDir,'recording-cleanup.json');const raw=store.load();if(!raw)return;
      const j=JSON.parse(raw) as Record<string,Object>;
      if(JSON.stringify(Object.keys(j).sort())!==JSON.stringify(['evidence','id','peer','schema','uuid'])||j['schema']!==1||
        typeof j['id']!=='string'||!/^[0-9a-f]{32}$/.test(j['id'] as string)||
        typeof j['peer']!=='string'||!(j['peer'] as string).length||(j['peer'] as string).length>128||/[\u0000-\u0020\u007f]/.test(j['peer'] as string)||
        typeof j['uuid']!=='string'||!/^[A-Za-z0-9-]{1,64}$/.test(j['uuid'] as string)||!['none','device_event','user_confirmation'].includes(j['evidence'] as string))throw new Error('RECORDING_CLEANUP_RECORD');
      if(j['evidence']==='none'){
        this.cleanupId=j['id'] as string;this.cleanupPeer=j['peer'] as string;this.cleanupUuid=j['uuid'] as string;this.endNotified=false;
        this.note='上次录音退出未确认，请连接原眼镜后停止或确认；不会自动重新采音';
      }
    }catch(_){this.cleanupFault=true;this.note='录音退出记录不可读，原件保留；暂不能开启新通道';}
  }
  private persistCleanup(evidence:string='none'):void{
    if(!this.cleanupStore||!this.cleanupId)throw new Error('录音清理记录尚未初始化');
    const record=new RecordingCleanupRecord();record.id=this.cleanupId;record.peer=this.cleanupPeer;record.uuid=this.cleanupUuid;record.evidence=evidence;
    try{this.cleanupStore.save(JSON.stringify(record));}
    catch(_){this.cleanupFault=true;this.note='录音退出记录保存失败，保留占用与原音';throw new Error('录音清理记录保存失败');}
  }
  private reserveCleanup(uuid:string,peer:string):void{
    if(this.cleanupRequired||this.pendingWrites)throw new Error('请先完成上次录音退出清理');
    if(!peer||peer.length>128||/[\u0000-\u0020\u007f]/.test(peer))throw new Error('录音设备标识无效');
    this.cleanupId=this.random();this.cleanupPeer=peer;this.cleanupUuid=uuid;this.deviceExited=false;this.cleanupStopSubmitted=false;this.endNotified=false;this.persistCleanup();
  }
  private releaseConfirmedDevice():void{
    if(!this.deviceExited||!this.cleanupId||this.cleanupFault||this.pendingWrites)return;
    this.persistOwnedExit('device_event');
    this.persistCleanup('device_event');this.cleanupId='';this.cleanupPeer='';this.cleanupUuid='';this.deviceExited=false;
    if(this.timer!==-1)clearTimeout(this.timer);this.timer=-1;this.clearStartDeadline();
    if(!this.active&&!this.finalizing)this.generation++;
    this.notifySessionEnded();
  }
  private observeDeviceExit(peer:string,uuid:string):void{
    if(this.cleanupFault||!this.cleanupId||peer!==this.cleanupPeer||uuid!==this.cleanupUuid||peer!==this.device())return;
    this.deviceExited=true;this.releaseConfirmedDevice();
  }
  confirmExited(id:string):void{
    if(!this.canConfirmExited||!id||id!==this.cleanupId)throw new Error('请连接原眼镜，等待发送结束并核对当前录音退出请求');
    this.persistOwnedExit('user_confirmation');
    this.persistCleanup('user_confirmation');this.cleanupId='';this.cleanupPeer='';this.cleanupUuid='';this.deviceExited=false;
    this.fail('用户确认录音已退出（非设备回执），原始文件保留');
  }
  private sameConnection(peer:string,epoch:number):boolean{return !!peer&&peer===this.device()&&epoch===this.connectionEpoch;}
  private sameCleanup(id:string,generation:number,peer:string,epoch:number):boolean{return id===this.cleanupId&&generation===this.generation&&this.sameConnection(peer,epoch);}
  private sameSession(uuid:string,generation:number,peer:string,epoch:number):boolean{return uuid===this.manifest.uuid&&peer===this.manifest.peer&&generation===this.generation&&this.sameConnection(peer,epoch);}
  private persistOwnedExit(evidence:string):void{
    const h=this.owned?.handle||this.restoredOwned;
    if(!h||h.cleanupId!==this.cleanupId||h.uuid!==this.cleanupUuid||h.peer!==this.cleanupPeer)return;
    try{
      if(h.directory===this.directory&&this.manifest.voice_cleanup_id===this.cleanupId&&this.manifest.uuid===this.cleanupUuid){this.manifest.voice_exit_evidence=evidence;this.persist();return;}
      const path=h.directory+'/manifest.json';if(!fs.accessSync(path)||fs.accessSync(h.directory+'/manifest.next'))return;
      const raw=fs.readTextSync(path);if(raw.length>100000)return;const saved=JSON.parse(raw) as RecordingManifest;
      if(saved.version!==1||saved.uuid!==h.uuid||saved.peer!==h.peer||saved.voice_cleanup_id!==h.cleanupId||saved.voice_owner!==h.ownerId)return;
      saved.voice_exit_evidence=evidence;this.writeManifest(h.directory,saved);
    }catch(_){this.dbg('owned-exit-source-unavailable');}
  }
  private copyHandle(h:RecordingCaptureHandle):RecordingCaptureHandle{
    const copy=new RecordingCaptureHandle();copy.ownerId=h.ownerId;copy.cleanupId=h.cleanupId;copy.uuid=h.uuid;copy.directory=h.directory;copy.peer=h.peer;copy.connectionEpoch=h.connectionEpoch;return copy;
  }
  private assertOwned(h:RecordingCaptureHandle):RecordingOwnedAttempt{
    const owned=this.owned,t=owned?.handle;
    if(!owned||!t||h.ownerId!==t.ownerId||h.cleanupId!==t.cleanupId||h.uuid!==t.uuid||h.directory!==t.directory||h.peer!==t.peer||h.connectionEpoch!==t.connectionEpoch||
      !h.cleanupId||h.cleanupId!==this.cleanupId||h.uuid!==this.cleanupUuid||h.peer!==this.cleanupPeer||!this.sameConnection(h.peer,h.connectionEpoch))throw new Error('RECORDING_OWNER_CHANGED');
    return owned;
  }
  private flushOwnedStop():void{
    const owned=this.owned;if(!owned?.stopRequested||!owned.startSubmitted||this.pendingWrites)return;
    if(owned.stopSubmitted){owned.stopRequested=false;return;}
    // An old timer or native continuation never acquires a new connection or
    // recording. Unresolved device cleanup remains available to the normal UI.
    try{this.assertOwned(owned.handle);}catch(_){owned.stopRequested=false;return;}
    this.stopOwned(this.copyHandle(owned.handle)).catch(()=>{});
  }
  private dbg(event:string,extra:string=''):void{
    const line=JSON.stringify({t:Date.now(),ev:event,x:extra});
    hilog.info(0x2a01,'RecDbg','%{public}s',line);
    if(!this.logFile)return;
    try{
      // 与 persist() 相同的已验证写入模式：CREATE|READ_WRITE + lseek(EOF) + writeSync
      const exists=fs.accessSync(this.logFile);
      const f=fs.openSync(this.logFile,fs.OpenMode.CREATE|fs.OpenMode.READ_WRITE);
      try{
        if(exists)fs.lseek(f.fd,fs.statSync(this.logFile).size,fs.WhenceType.SEEK_SET);
        const buf=new util.TextEncoder().encodeInto(line+'\n');
        let off=0;while(off<buf.length){const n=fs.writeSync(f.fd,buf.slice(off).buffer);if(n<=0)break;off+=n;}
        fs.fsyncSync(f.fd);
      }finally{fs.closeSync(f);}
    }catch(e){hilog.error(0x2a01,'RecDbg','logfile write failed: %{public}s',String(e));}
  }
  constructor(sender:(business:number,payload:Uint8Array)=>Promise<void>,device:()=>string,idle:()=>boolean){this.sender=sender;this.device=device;this.idle=idle;}
  initialize(context:common.Context,isolatedLab:boolean=false,filesDir:string=context.filesDir):void{
    this.root=filesDir+(isolatedLab?'/p12-recording-lab':'/recordings');if(!fs.accessSync(this.root))fs.mkdirSync(this.root);
    this.logFile=filesDir+(isolatedLab?'/debug-recording-lab.log':'/debug-recording.log');this.dbg('init');
    this.initializeCleanup(isolatedLab?this.root:filesDir);
    this.refresh();
  }
  refresh():void{
    if(!this.root)return;const rows:RecordingItem[]=[],owned:RecordingCaptureHandle[]=[];
    for(const name of fs.listFileSync(this.root)){
      if(!/^take-[0-9a-f]{32}$/.test(name))continue;
      try{
        const path=this.root+'/'+name,raw=fs.readTextSync(path+'/manifest.json');if(raw.length>100000)continue;
        const m=JSON.parse(raw) as RecordingManifest;if(m.version!==1||!Number.isSafeInteger(m.created))continue;
        if(this.cleanupId&&m.voice_cleanup_id===this.cleanupId&&m.uuid===this.cleanupUuid&&m.peer===this.cleanupPeer&&typeof m.voice_owner==='string'&&/^voice-[a-f0-9]{32}$/.test(m.voice_owner)){
          const h=new RecordingCaptureHandle();h.ownerId=m.voice_owner;h.cleanupId=this.cleanupId;h.uuid=m.uuid;h.peer=m.peer;h.directory=path;owned.push(h);
        }
        const row=new RecordingItem();row.name=name;row.created=m.created;
        row.textFile=fs.listFileSync(path).filter(p=>/^transcript-\d+\.md$/.test(p)).sort().pop()||'';
        row.rawAvailable=fs.accessSync(path+'/source.rawopus');
        if(row.rawAvailable)row.bytes=fs.statSync(path+'/source.rawopus').size;
        if(!row.rawAvailable&&!row.textFile)continue;
        row.complete=row.rawAvailable&&this.validWav(path,m,row.bytes);
        row.note=!row.rawAvailable?'音频已清理 · 转写文字保留':row.complete?'已完成覆盖校验与立体声解码':'原始录音已保留 · 未通过完整封装';rows.push(row);
      }catch(_){/* Preserve unreadable directories, never repair by deletion. */}
    }
    this.restoredOwned=owned.length===1?owned[0]:undefined;
    this.items=rows.sort((a,b)=>b.created-a.created);this.changed();
  }
  private itemDirectory(item:RecordingItem):string{
    if(!this.root||!/^take-[0-9a-f]{32}$/.test(item.name))throw new Error('录音标识无效');
    return this.root+'/'+item.name;
  }
  file(item:RecordingItem,wav:boolean):string{
    const path=this.itemDirectory(item);
    if(!fs.accessSync(path+'/source.rawopus'))throw new Error('音频已清理，已保存的转写文字仍可导出');
    if(wav){
      const raw=fs.readTextSync(path+'/manifest.json');if(raw.length>100000)throw new Error('录音清单无效');
      if(!this.validWav(path,JSON.parse(raw) as RecordingManifest,fs.statSync(path+'/source.rawopus').size))throw new Error('此录音没有完整 WAV');
    }
    return path+(wav?'/audio.wav':'/source.rawopus');
  }
  private validWav(path:string,m:RecordingManifest,size:number):boolean{
    if(m.version!==1||m.wavReady!==true||m.completed!==true||m.valid!==true||!Number.isSafeInteger(size)||size<=0||size>33554432||size%240!==0)return false;
    if(!Array.isArray(m.coverage)||m.coverage.length!==1||m.coverage[0].length!==2||m.coverage[0][0]!==0||m.coverage[0][1]!==size)return false;
    return fs.accessSync(path+'/audio.wav')&&fs.statSync(path+'/audio.wav').size===44+size/240*1280;
  }
  textPath(item:RecordingItem):string{
    const path=this.itemDirectory(item);if(!/^transcript-\d+\.md$/.test(item.textFile)||!fs.accessSync(path+'/'+item.textFile))throw new Error('没有已保存的转写');return path+'/'+item.textFile;
  }
  // 条目目录（自动转写排队用）。
  directoryOf(item:RecordingItem):string{return this.itemDirectory(item);}

  // 按目录找条目（自动转写完成后回填文字用）。
  findByDirectory(directory:string):RecordingItem|undefined{
    for(const item of this.items){if(this.itemDirectory(item)===directory)return item;}
    return undefined;
  }

  // 主动录音持续保留；兼容旧调用也不执行按天清理。仅用户删除会移除原件。
  pruneAudio(keepDays:number):number{
    return 0;
  }

  // 删除一条录音（含原始帧、WAV、转写与清单）；正在录音的条目不删。
  remove(item:RecordingItem):void{
    const path=this.itemDirectory(item);
    if(this.active&&path===this.directory)throw new Error('正在录音的条目不能删除');
    try{this.beforeRemove?.(item);}catch(_){throw new Error('资料删除标记未能保存，本机文件保留，请稍后重试');}
    let payloadsRemoved=true;
    try{
      for(const name of fs.listFileSync(path).filter((name:string):boolean=>!['manifest.json','manifest.json.partial'].includes(name))){
        try{fs.unlinkSync(path+'/'+name);}catch(_){payloadsRemoved=false;}
        if(fs.accessSync(path+'/'+name))payloadsRemoved=false;
      }
    }catch(_){payloadsRemoved=false;}
    // Retain the manifest until every payload is gone so a locked raw file
    // remains a visible recording that the user can retry cleaning up.
    if(payloadsRemoved){
      for(const name of ['manifest.json.partial','manifest.json']){try{if(fs.accessSync(path+'/'+name))fs.unlinkSync(path+'/'+name);}catch(_){} }
      try{fs.rmdirSync(path);}catch(_){}
    }
    if(fs.accessSync(path)){this.refresh();throw new Error(this.beforeRemove?'删除标记已保存，本机文件仍被占用，请稍后重试清理':'删除未完成：文件仍被占用，稍后再试');}
    this.note=this.beforeRemove?'本机录音已删除；资料删除标记等待同步确认':'已删除 1 条录音';this.refresh();
  }

  saveTranscript(item:RecordingItem,text:string,structured:string=''):void{
    // 只要求原始帧还在即可写转写：不少录音没有通过完整 WAV 封装，但原始帧是完好的。
    this.file(item,false);if(!text.trim()||text.length>100000)throw new Error('转写文字无效');
    if(structured){
      if(structured.length>4000000)throw new Error('结构化文字过大');JSON.parse(structured);
      const jsonPath=this.root+'/'+item.name+'/transcript.json';
      const json=fs.openSync(jsonPath+'.partial',fs.OpenMode.CREATE|fs.OpenMode.WRITE_ONLY|fs.OpenMode.TRUNC);
      try{this.write(json.fd,new util.TextEncoder().encodeInto(structured),0);fs.fsyncSync(json.fd);}finally{fs.closeSync(json);}
      fs.renameSync(jsonPath+'.partial',jsonPath);
    }
    const path=this.root+'/'+item.name+'/transcript-'+Date.now()+'.md';if(fs.accessSync(path))throw new Error('已有同名转写，未覆盖');
    const file=fs.openSync(path+'.partial',fs.OpenMode.CREATE|fs.OpenMode.WRITE_ONLY|fs.OpenMode.TRUNC);
    try{this.write(file.fd,new util.TextEncoder().encodeInto(`# 眼镜录音转写\n\n录音时间：${new Date(item.created).toISOString()}\n\n${text}\n`),0);fs.fsyncSync(file.fd);}finally{fs.closeSync(file);}
    fs.renameSync(path+'.partial',path);this.refresh();
  }
  saveTranscriptFixed(item:RecordingItem,fileName:string,text:string):void{
    this.file(item,false);if(this.active||!/^transcript-[0-9]+\.md$/.test(fileName)||!text.trim()||text.length>100000)throw new Error('RECORDING_CLOUD_MIRROR_INVALID');
    const path=this.itemDirectory(item)+'/'+fileName,markdown=`# 眼镜录音转写\n\n录音时间：${new Date(item.created).toISOString()}\n\n${text}\n`;
    if(fs.accessSync(path)){if(fs.readTextSync(path)!==markdown)throw new Error('RECORDING_CLOUD_MIRROR_CONFLICT');this.refresh();return;}
    const file=fs.openSync(path+'.partial',fs.OpenMode.CREATE|fs.OpenMode.WRITE_ONLY|fs.OpenMode.TRUNC);
    try{this.write(file.fd,new util.TextEncoder().encodeInto(markdown),0);fs.fsyncSync(file.fd);}finally{fs.closeSync(file);}
    fs.renameSync(path+'.partial',path);this.refresh();
  }
  private random():string{const b=cryptoFramework.createRandom().generateRandomSync(16).data;const id=Array.from(b).map((n:number)=>n.toString(16).padStart(2,'0')).join('');b.fill(0);return id;}
  private persist():void{
    this.manifest.coverage=this.coverage.ranges.map(r=>[r.start,r.end]);this.manifest.valid=!this.coverage.invalid;
    this.writeManifest(this.directory,this.manifest);
  }
  private writeManifest(directory:string,manifest:RecordingManifest):void{
    // Same directory temporary manifest + rename: a torn journal never labels raw audio complete.
    const path=directory+'/manifest.next';const file=fs.openSync(path,fs.OpenMode.CREATE|fs.OpenMode.WRITE_ONLY|fs.OpenMode.TRUNC);
    try{this.write(file.fd,new util.TextEncoder().encodeInto(JSON.stringify(manifest)),0);fs.fsyncSync(file.fd);}finally{fs.closeSync(file);}
    fs.renameSync(path,directory+'/manifest.json');
  }
  private write(fd:number,data:Uint8Array,position:number):void{
    fs.lseek(fd,position,fs.WhenceType.SEEK_SET);
    let written=0;while(written<data.length){const n=fs.writeSync(fd,data.slice(written).buffer);if(n<=0)throw new Error('录音写入不完整');written+=n;}
  }
  private read(fd:number,position:number,length:number):Uint8Array{
    fs.lseek(fd,position,fs.WhenceType.SEEK_SET);
    const out=new Uint8Array(length);let count=0;while(count<length){const part=new ArrayBuffer(length-count);const n=fs.readSync(fd,part,{length:length-count});if(n<=0)throw new Error('录音读取不完整');out.set(new Uint8Array(part,0,n),count);count+=n;}return out;
  }
  private async send(type:number,body:RecordCommand,peer:string=this.device(),epoch:number=this.connectionEpoch,beforeSend:(()=>void)|undefined=undefined):Promise<void>{
    if(!this.sameConnection(peer,epoch))throw new Error('录音连接已变化，保留原设备退出请求');
    const payload=businessEnvelope(type,new util.TextEncoder().encodeInto(JSON.stringify(body)));this.writes++;this.changed();
    try{if(beforeSend)beforeSend();await this.sender(14,payload);}
    finally{
      payload.fill(0);this.writes--;
      try{this.releaseConfirmedDevice();}catch(_){/* Failed durable release keeps the cleanup debt. */}
      this.changed();this.notifySessionEnded();this.flushOwnedStop();
    }
  }
  private async waitForStopWrite(write:Promise<void>):Promise<void>{
    let deadline:number=-1;
    try{
      const expired=new Promise<void>((_resolve:()=>void,reject:(error:Error)=>void):void=>{
        deadline=setTimeout(()=>{deadline=-1;reject(new Error('录音停止发送超过 10 秒，退出占用保留；请等待原生发送结束'));},10000);
      });
      await Promise.race([write,expired]);
    }finally{if(deadline!==-1)clearTimeout(deadline);}
  }
  autoReceiveAllowed:boolean=true;
  async enable(enabled:boolean,automatic:boolean=false):Promise<void>{
    if(automatic&&!this.autoReceiveAllowed)return;
    if(this.active||this.finalizing||this.cleanupRequired||this.pendingWrites)throw new Error('请先停止录音并完成退出清理');
    if(enabled){const peer=this.device(),epoch=this.connectionEpoch;if(!this.root||!peer||!this.idle())throw new Error('请先连接眼镜，并关闭语音和其他显示任务');await this.send(14,{isAppForeground:true},peer,epoch);if(!this.sameConnection(peer,epoch))throw new Error('录音连接已变化');}
    if(!automatic)this.autoReceiveAllowed=enabled;
    this.enabled=enabled;this.note=enabled?'已允许眼镜菜单发起录音 · 只存本机':'录音接收已关闭';this.changed();
  }
  private begin(uuid:string,peer:string,options:RecordingOwnedStart|undefined=undefined):void{
    if(!this.root||!this.enabled||this.active||this.finalizing||this.cleanupRequired||this.pendingWrites||!this.idle()||!peer||!/^[A-Za-z0-9-]{1,64}$/.test(uuid))throw new Error('不能开始录音，请先完成退出清理');
    this.reserveCleanup(uuid,peer);
    this.directory=this.root+'/take-'+this.random();fs.mkdirSync(this.directory);
    this.raw=fs.openSync(this.directory+'/source.rawopus',fs.OpenMode.CREATE|fs.OpenMode.READ_WRITE);
    this.coverage=new RecordingCoverage();this.manifest=new RecordingManifest();this.manifest.uuid=uuid;this.manifest.peer=peer;this.manifest.created=Date.now();
    if(options){this.manifest.voice_owner=options.ownerId;this.manifest.voice_cleanup_id=this.cleanupId;}
    this.stopping=false;this.stopRequestedAt=0;this.checkpointBytes=0;this.checkpointAt=Date.now();
    try{this.persist();}catch(error){fs.closeSync(this.raw);this.raw=undefined;throw new Error('录音目录初始化失败，未请求眼镜开始');}
    this.active=true;this.starting=true;this.bytes=0;this.note='接收目录已准备 · 等待眼镜开始确认';this.dbg('begin',uuid);
    this.owned=undefined;
    if(options){
      const owned=new RecordingOwnedAttempt(),h=owned.handle;h.ownerId=options.ownerId;h.cleanupId=this.cleanupId;h.uuid=uuid;h.directory=this.directory;h.peer=peer;h.connectionEpoch=this.connectionEpoch;owned.generation=this.generation;this.owned=owned;
      const expected=this.copyHandle(h);
      this.timer=setTimeout(()=>{if(this.owned!==owned)return;this.stopOwned(expected).catch(()=>{});},options.maxDurationMs);
    }else{
      const generation=this.generation;this.timer=setTimeout(()=>{if(generation===this.generation)this.stop().catch(()=>this.fail('自动停止未确认，请在眼镜结束录音'));},600000);
    }
    this.changed();
  }
  async start():Promise<void>{
    await this.startCapture();
  }
  async startOwned(options:RecordingOwnedStart):Promise<RecordingCaptureHandle>{
    if(!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/.test(options.ownerId)||!Number.isSafeInteger(options.maxDurationMs)||options.maxDurationMs<1000||options.maxDurationMs>30000||typeof options.guard!=='function'||typeof options.current!=='function'||typeof options.reserved!=='function')throw new Error('RECORDING_OWNER_OPTIONS');
    const stable:RecordingOwnedStart={ownerId:options.ownerId,maxDurationMs:options.maxDurationMs,guard:options.guard,current:options.current,reserved:options.reserved};
    const handle=await this.startCapture(stable);if(!handle)throw new Error('RECORDING_OWNER_CHANGED');return handle;
  }
  private async startCapture(options:RecordingOwnedStart|undefined=undefined):Promise<RecordingCaptureHandle|undefined>{
    if(this.occupied)throw new Error('请先停止录音并完成退出清理，等待发送与归档结束');
    const peer=this.device(),epoch=this.connectionEpoch,entryGeneration=this.generation;this.busy=true;this.endNotified=false;let id='';
    try{if(options){await options.guard();if(!this.sameConnection(peer,epoch)||entryGeneration!==this.generation)throw new Error('录音连接或任务已变化');}
      await this.beforeStart();if(!this.sameConnection(peer,epoch)||entryGeneration!==this.generation)throw new Error('录音连接或任务已变化');
      await this.enable(true);if(!this.sameConnection(peer,epoch)||entryGeneration!==this.generation)throw new Error('录音连接或任务已变化');
      if(options){await options.guard();if(!this.sameConnection(peer,epoch)||entryGeneration!==this.generation)throw new Error('录音连接或任务已变化');}
      id=this.random();this.begin(id,peer,options);const generation=this.generation,owned=this.owned;
      const handle=options&&owned?this.copyHandle(owned.handle):undefined;
      if(options&&handle)options.reserved(this.copyHandle(handle));
      const deadline=setTimeout(()=>{
        if(this.startDeadline!==deadline||generation!==this.generation||!this.active)return;this.startDeadline=-1;
        this.fail('10 秒未收到开始回报；请在眼镜确认是否仍在录音');
      },10000);this.startDeadline=deadline;
      await this.send(1,{uuid:id,action:1,mode:1,code:1,type:1},peer,epoch,handle?():void=>{
        if(!options||options.current()!==true)throw new Error('RECORDING_OWNER_CANCELLED');
        const current=this.assertOwned(handle);if(current!==owned||current.generation!==this.generation||current.stopRequested)throw new Error('RECORDING_OWNER_CHANGED');
        current.startSubmitted=true;
      }:undefined);
      if(this.sameSession(id,generation,peer,epoch)&&this.startDeadline!==-1)this.note='开始指令已提交，等待眼镜确认';return handle;}
    catch(error){if(this.active&&this.manifest.uuid===id&&this.sameConnection(peer,epoch))this.fail('开始未确认，原始目录与退出占用已保留');throw new Error((error as Error).message);}
    finally{this.busy=false;this.changed();this.notifySessionEnded();}
  }
  async stop():Promise<void>{
    await this.stopCapture();
  }
  async stopOwned(handle:RecordingCaptureHandle):Promise<void>{
    const owned=this.assertOwned(handle);owned.stopRequested=true;
    // A native start write may still be draining. Latch this exact owner's
    // stop instead of dropping the deadline or stopping a future recording.
    if(!owned.startSubmitted||this.pendingWrites)return;
    owned.stopRequested=false;await this.stopCapture(handle);
  }
  private async stopCapture(expected:RecordingCaptureHandle|undefined=undefined):Promise<void>{
    if(expected)this.assertOwned(expected);
    if(this.cleanupFault)throw new Error('录音清理记录不可读，保留占用');
    if(!this.cleanupId)return;
    if(this.stopping)return;
    if(this.pendingWrites)throw new Error('请等待录音发送结束后再停止');
    const id=this.cleanupId,uuid=this.cleanupUuid,peer=this.cleanupPeer,epoch=this.connectionEpoch,generation=this.generation;
    if(!this.sameConnection(peer,epoch))throw new Error('请先连接原眼镜后停止录音');
    this.stopping=true;this.cleanupStopSubmitted=false;this.stopRequestedAt=Date.now();this.clearStartDeadline();
    try{this.checkpoint(true);}catch(_){this.note='本机录音归档未完成，仍请求原眼镜停止；退出占用保留';}
    this.dbg('stop-req',uuid);this.changed();
    try{await this.waitForStopWrite(this.send(4,{uuid:uuid,action:1,code:2},peer,epoch,():void=>{
      if(expected)this.assertOwned(expected);if(!this.sameCleanup(id,generation,peer,epoch))throw new Error('RECORDING_OWNER_CHANGED');
      if(this.owned?.handle.cleanupId===id)this.owned.stopSubmitted=true;
    }));}
    catch(error){if(this.sameCleanup(id,generation,peer,epoch))this.fail('停止指令未确认，退出占用与原音保留，请重试');throw new Error((error as Error).message);}
    if(!this.sameCleanup(id,generation,peer,epoch))return;
    this.cleanupStopSubmitted=true;
    this.note='正在收尾，等待眼镜完成回报；超时仍保留退出占用';this.armStopWatchdog();this.changed();
  }
  private armStopWatchdog():void{
    if(this.timer!==-1)clearTimeout(this.timer);const generation=this.generation,id=this.cleanupId,peer=this.cleanupPeer,epoch=this.connectionEpoch;
    const remaining=Math.min(30000,600000-(Date.now()-this.stopRequestedAt));
    if(remaining<=0){this.fail('收尾超过 10 分钟，原始录音保留');return;}
    const watchdog=setTimeout(()=>{if(this.timer!==watchdog||!this.sameCleanup(id,generation,peer,epoch))return;this.timer=-1;if(this.cleanupRequired&&!this.deviceExited)this.fail('30 秒没有收到新的尾包或完成回报；原始录音与退出占用保留');},remaining);this.timer=watchdog;
  }
  private checkpoint(force:boolean=false):void{
    if(!this.raw)return;
    const size=this.coverage.length();
    if(!force&&size-this.checkpointBytes<65536&&Date.now()-this.checkpointAt<1000)return;
    fs.fsyncSync(this.raw.fd);this.persist();this.checkpointBytes=size;this.checkpointAt=Date.now();
  }
  disconnected():void{this.connectionEpoch++;this.deviceExited=false;this.cleanupStopSubmitted=false;if(this.active||this.finalizing||this.cleanupRequired||this.pendingWrites)this.fail('连接中断；原始录音与原眼镜退出占用保留');else this.generation++;this.enabled=false;this.changed();}
  private clearStartDeadline():void{if(this.startDeadline!==-1)clearTimeout(this.startDeadline);this.startDeadline=-1;}
  private fail(note:string):void{
    // Failure of a native start or local receiver is not proof the glasses
    // never opened the microphone. Keep one exact-owner stop obligation;
    // a failed stop itself is left for explicit recovery, not an auto loop.
    if(this.owned?.startSubmitted&&!this.owned.stopSubmitted)this.owned.stopRequested=true;
    this.generation++;this.coverage.invalid=true;this.active=false;this.starting=false;this.stopping=false;this.note=note;this.dbg('fail',note);
    this.clearStartDeadline();
    if(this.timer!==-1)clearTimeout(this.timer);if(this.grace!==-1)clearTimeout(this.grace);this.timer=-1;this.grace=-1;
    try{this.checkpoint(true);if(this.directory)this.persist();}catch(_){}
    if(this.raw){try{fs.closeSync(this.raw);}catch(_){}this.raw=undefined;}
    if(!this.finalizing){try{audio.recordingClose();}catch(_){}}try{this.refresh();}catch(_){}this.changed();this.notifySessionEnded();this.flushOwnedStop();
  }
  receive(peer:string,bytes:Uint8Array):void{
    if((!this.enabled&&!this.cleanupRequired)||!peer||peer!==this.device())return;
    if(this.queued>=32){this.fail('录音队列溢出，原始数据已保留');return;}
    const copy=bytes.slice(),generation=this.generation,epoch=this.connectionEpoch;this.queued++;
    const task=this.queue.then(async()=>{if(generation!==this.generation||!this.sameConnection(peer,epoch))return;await this.handle(peer,copy);});
    this.queue=task.catch(()=>{if(generation===this.generation&&this.sameConnection(peer,epoch))this.fail('录音包、存储或协议处理失败；原音与退出占用保留');}).finally(()=>{copy.fill(0);this.queued--;});
  }
  private async handle(peer:string,bytes:Uint8Array):Promise<void>{
    const generation=this.generation,epoch=this.connectionEpoch;
    const packet=readLauncherEnvelope(bytes);
    try{
      const j=JSON.parse(new util.TextDecoder().decodeToString(packet.json)) as Record<string,Object>;
      // type5 = 录音会话状态回报（实测固件 1.0.4.12：{uuid:"",action:2,mode:1,state:3,...} 表示完成）
      // 注意它的 uuid 是空串，不能走 uuid 校验
      if(packet.type===5){
        this.dbg('pkt5',new util.TextDecoder().decodeToString(packet.json).slice(0,300));
        // Some firmware reports completion with an empty UUID. Retain that
        // stop-handshake compatibility, but never ignore explicit conflicts.
        const uuid=j['uuid'];
        if(j['state']!==3||typeof uuid!=='string'||uuid!==''&&uuid!==this.cleanupUuid||
          j['action']!==undefined&&j['action']!==2||j['mode']!==undefined&&j['mode']!==1)return;
        if(this.active&&!this.manifest.completed&&this.stopping&&this.cleanupStopSubmitted&&!this.pendingWrites){
          this.clearStartDeadline();
          this.manifest.completed=true;this.persist();if(this.timer!==-1)clearTimeout(this.timer);this.timer=-1;const generation=this.generation;
          this.observeDeviceExit(peer,this.manifest.uuid);
          this.note='收到完成回报，等待覆盖校验与封装';
          this.scheduleFinish(generation,peer,this.manifest.uuid,epoch);
          this.changed();
        }else if(!this.active&&this.cleanupStopSubmitted&&this.stopping&&!this.pendingWrites){
          this.observeDeviceExit(peer,this.cleanupUuid);this.changed();
        }
        return;
      }
      const uuid=j['uuid'];if(typeof uuid!=='string'||!/^[A-Za-z0-9-]{1,64}$/.test(uuid)){this.dbg('pkt-nouuid',`t${packet.type} raw=${new util.TextDecoder().decodeToString(packet.json).slice(0,500)} bin=${packet.binary.length}`);return;}
      if(packet.type!==3||this.bytes%65520===0)this.dbg('pkt',packet.type===3
        ?`t3 bin=${packet.binary.length} off=${String(j['offset'])} active=${this.active}`
        :`t${packet.type} ${JSON.stringify(j).slice(0,400)} active=${this.active} match=${uuid===this.manifest.uuid}`);
      if(packet.type===1&&j['action']===1){
        if(!this.active){
          if(this.cleanupRequired||this.finalizing||this.pendingWrites)return;
          this.busy=true;
          this.endNotified=false;
          try{await this.beforeStart();if(generation!==this.generation||!this.sameConnection(peer,epoch))return;this.begin(uuid,peer);}
          finally{this.busy=false;this.notifySessionEnded();}
        }
        if(this.sameSession(uuid,generation,peer,epoch))await this.send(1,{uuid:uuid,action:2,mode:1,code:1,type:1},peer,epoch);
        return;
      }
      if(!this.active&&packet.type===6&&j['completed']===true){this.observeDeviceExit(peer,uuid);this.changed();return;}
      if(uuid!==this.manifest.uuid||peer!==this.manifest.peer)return;
      if(packet.type===3&&!this.active){this.fail('完成或中断后仍收到音频，请复核原始副本');return;}
      if(!this.active)return;
      if(packet.type===1&&j['action']===2){if(j['code']!==1)throw new Error('start-rejected');this.clearStartDeadline();this.starting=false;this.note='眼镜已确认开始录音';}
      if(packet.type===3){
        this.starting=false;
        this.clearStartDeadline();
        if(this.finalizing)throw new Error('late-audio');if(!this.raw)throw new Error('file-closed');
        const offset=j['offset'] as number,length=packet.binary.length;this.coverage.validate(offset,length);
        for(const range of this.coverage.overlap(offset,length)){const previous=this.read(this.raw.fd,range.start,range.end-range.start);const incoming=packet.binary.slice(range.start-offset,range.end-offset);if(!previous.every((b,i)=>b===incoming[i]))throw new Error('conflicting-overlap');}
        const before=this.coverage.length();
        this.write(this.raw.fd,packet.binary,offset);this.coverage.accept(offset,length);this.checkpoint();this.bytes=this.coverage.length();
        this.note=(this.stopping?'正在收尾 · ':'正在录音 · ')+this.bytes+' B';
        if(this.stopping&&this.bytes>before&&!this.manifest.completed)this.armStopWatchdog();
      }
      if(packet.type===4&&j['action']===1){await this.send(4,{uuid:uuid,action:2,code:typeof j['code']==='number'?j['code'] as number:1},peer,epoch);if(!this.sameSession(uuid,generation,peer,epoch))return;this.stopping=true;this.cleanupStopSubmitted=true;this.stopRequestedAt=Date.now();this.armStopWatchdog();this.note='正在收尾，等待完成回报';}
      if([8,9,11].includes(packet.type)&&j['action']===1){await this.send(packet.type,{uuid:uuid,action:2,code:1},peer,epoch);if(!this.sameSession(uuid,generation,peer,epoch))return;}
      if(packet.type===6&&j['completed']===true&&!this.manifest.completed){
        this.clearStartDeadline();
        this.manifest.completed=true;this.persist();if(this.timer!==-1)clearTimeout(this.timer);this.timer=-1;const generation=this.generation;
        this.observeDeviceExit(peer,uuid);
        this.scheduleFinish(generation,peer,uuid,epoch);
      }
      this.changed();
    }finally{packet.binary.fill(0);packet.json.fill(0);}
  }
  private scheduleFinish(generation:number,peer:string,uuid:string,epoch:number):void{
    this.grace=setTimeout(()=>{this.grace=-1;this.queue.then(async():Promise<void>=>{if(this.sameSession(uuid,generation,peer,epoch))await this.finish(generation);})
      .catch(()=>{if(this.sameSession(uuid,generation,peer,epoch))this.fail('封装失败，原始音频已保留');});},1000);
  }
  private async finish(generation:number):Promise<void>{
    this.dbg('finish-try',`completed=${this.manifest.completed} cov=${this.coverage.complete()}`);
    if(!this.coverage.complete()||!this.manifest.completed||!this.raw)throw new Error('incomplete-coverage');
    this.checkpoint(true);
    this.finalizing=true;this.note='接收覆盖已通过，正在逐包解码';this.changed();
    try{
    const pcmLength=this.coverage.length()/240*1280;
    if(fs.accessSync(this.directory+'/decoded.partial'))throw new Error('保留已有未完成封装，请勿覆盖');
    const output=fs.openSync(this.directory+'/decoded.partial',fs.OpenMode.CREATE|fs.OpenMode.WRITE_ONLY);
    let success=false;
    try{
      audio.recordingReset();this.write(output.fd,stereoWavHeader(pcmLength),0);
      for(let offset=0;offset<this.coverage.length();offset+=240){
        if(generation!==this.generation||!this.raw)throw new Error('cancelled');
        const raw=this.read(this.raw.fd,offset,240);let pcm=new Uint8Array();
        try{pcm=new Uint8Array(audio.recordingDecode(raw.buffer));if(pcm.length!==1280)throw new Error('wrong-pcm');this.write(output.fd,pcm,44+offset/240*1280);}
        finally{raw.fill(0);pcm.fill(0);}
        if(offset%12000===0)await new Promise<void>((resolve:()=>void)=>{setTimeout(resolve,0);});
      }
      fs.fsyncSync(output.fd);success=true;
    }finally{fs.closeSync(output);audio.recordingClose();}
    if(!success||generation!==this.generation)throw new Error('cancelled');
    fs.renameSync(this.directory+'/decoded.partial',this.directory+'/audio.wav');
    this.manifest.wavReady=true;this.persist();if(this.raw){fs.closeSync(this.raw);this.raw=undefined;}
    this.active=false;this.starting=false;this.stopping=false;
    this.note='录音已持续保存，本机转写自动排队；可在智记时间线查看。';
    this.dbg('finish-ok');this.refresh();
    const hook=this.onRecordingClosed;
    if(hook&&this.autoLocalTranscribe){
      const directory=this.directory,started=this.manifest.created;
      try{hook(directory,directory+'/source.rawopus',started);}catch(_){}
    }
    this.generation++;
    }finally{this.finalizing=false;this.changed();this.notifySessionEnded();}
  }
}
