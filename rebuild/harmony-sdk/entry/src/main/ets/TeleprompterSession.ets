import { util } from '@kit.ArkTS';
import { cryptoFramework } from '@kit.CryptoArchitectureKit';
import { hilog } from '@kit.PerformanceAnalysisKit';
import { OutboundFile,FileMessage,fileMessage,readFileMessage,businessEnvelope,readLauncherEnvelope } from 'turbo_core';
import { FollowPosition } from './TeleprompterAlignment';
import { DisplayCleanupPorts } from './DisplayCleanupStore';

// Firmware acknowledges type3 before the visible start countdown finishes.
// Temporary stop deferral retained from 123; neither the duration nor a causal
// link to the observed restarts is a verified firmware contract. Pause still
// requires the same-DID running-state reply, not this timer.
const START_GUARD_MS=3500;

class PrompterCleanupRecord {
  schema:number=1;peer:string='';did:string='';fileStarted:boolean=false;evidence:string='none';
}

export interface TeleprompterFollowHandle {
  onPosition:(position:FollowPosition)=>void;onStatus:(note:string)=>void;onError:(note:string)=>void;
  prepare(text:string,source?:string):Promise<void>;begin():Promise<void>;opus(bytes:Uint8Array):void;pause():void;stop():void;
  reanchor(value:number):void;boundary(value:number):boolean;
}

interface PrompterBody { did:string;action:number;total?:number;scroll?:number;speed?:number;pageOffset?:number;highLightOffset?:number;offset?:number;code?:number;isCompleted?:boolean;checksum?:string; }
// Same UTF-8 FNV-1a contract as iOS TIONewsTeleChecksum, distinct from file MD5.
export function teleprompterChecksum(bytes:Uint8Array):string {
  let hash=2166136261;for(const b of bytes)hash=Math.imul(hash^b,16777619)>>>0;
  return hash.toString(16).padStart(8,'0');
}
export class TeleprompterSession {
  private checksum:string='';
  phase:string='idle';note:string='选择稿件，完整传输后再开始提词';progress:number=0;offset:number=0;speed:number=120;
  mode:number=2;asrSource:string='local';followNote:string='';followPackets:number=0;matchedOffset:number=0;confirmedHighlight:number=0;positionReplies:number=0;
  changed:()=>void=():void=>{};
  onIdle:()=>void=():void=>{};
  // Readiness observation for the isolated long-reading probe. Only an accepted
  // device resume from paused increments this; phone command ACKs do not.
  deviceResumeSequence:number=0;
  // Joint 119 observation: long press from paused sends stop/action1/code1.
  // Firmware's internal reason28 is NOT the wire code. A device stop from
  // paused is a readiness candidate, NOT proof that Launcher is visible.
  deviceLocalBackSequence:number=0;deviceLocalBackDid:string='';
  onCompletedFile:(peer:string,did:string,title:string,text:string,total:number,mode:number)=>void=(_p:string,_d:string,_t:string,_x:string,_n:number,_m:number):void=>{};
  onListPacket:(peer:string,business:number,bytes:Uint8Array)=>void=(_p:string,_b:number,_x:Uint8Array):void=>{};
  onListDisconnect:()=>void=():void=>{};
  private title:string='';private manuscript:string='';
  private did:string='';private peer:string='';private total:number=0;private file:OutboundFile|undefined=undefined;
  private fileStarted:boolean=false;private businessReady:boolean=false;private epoch:number=0;private timer:number=-1;
  private prepareWriteStarted:boolean=false;
  private startAckAt:number=0;
  private cleanupStore:DisplayCleanupPorts|undefined=undefined;
  private cleanupFault:boolean=false;
  private exitEvidence:string='none';
  lastQueryState:number=-1;lastQueryFailure:string='';
  private writes:number=0;
  private connectionReady:boolean=false;
  private pendingControl:number=0;private pendingSpeed:number=0;private beforeControl:string='ready';
  private startPoll:number=-1;private startQueryPending:boolean=false;
  private queue:Promise<void>=Promise.resolve();private queued:number=0;
  private exitWaiters:Array<(confirmed:boolean)=>void>=[];
  private follow:TeleprompterFollowHandle|undefined=undefined;private positionPending:FollowPosition|undefined=undefined;
  private positionNext:FollowPosition|undefined=undefined;private positionTimer:number=-1;private positionGeneration:number=0;
  private positionWriteStarted:boolean=false;private abandonedPositionAck:boolean=false;
  private acceptedHighlight:number=0;private recentPositions:FollowPosition[]=[];
  private send:(business:number,payload:Uint8Array)=>Promise<void>;private device:()=>string;private idle:()=>boolean;
  constructor(send:(business:number,payload:Uint8Array)=>Promise<void>,device:()=>string,idle:()=>boolean,follow?:TeleprompterFollowHandle){
    this.send=send;this.device=device;this.idle=idle;this.follow=follow;
    if(follow){follow.onPosition=(position:FollowPosition):void=>this.followPosition(position);follow.onStatus=(note:string):void=>{if(this.active&&this.mode===1){this.followNote=note;this.emit();}};follow.onError=(note:string):void=>this.followFailure(note);}
  }
  get active():boolean{return this.phase!=='idle'||this.cleanupFault||this.writes>0;}
  get cleanupRequired():boolean{return this.prepareWriteStarted||this.cleanupFault;}
  get cleanupSessionId():string{return this.did;}
  get pendingWrites():number{return this.writes;}
  get fileComplete():boolean{return !!this.file?.complete;}
  get preparationReady():boolean{return this.businessReady;}
  get cleanupEvidence():string{return this.exitEvidence;}
  get canRequestExit():boolean{return this.connectionReady&&this.prepareWriteStarted&&!this.cleanupFault&&this.writes===0&&!!this.peer&&this.device()===this.peer&&this.phase!=='closing';}
  get canConfirmExited():boolean{return this.connectionReady&&this.prepareWriteStarted&&!this.cleanupFault&&this.writes===0&&!!this.peer&&this.device()===this.peer&&['cleanup','error','closing'].includes(this.phase);}
  connected():void{this.connectionReady=!!this.device();this.emit();}
  initializeCleanup(store:DisplayCleanupPorts):void {
    if(this.cleanupStore)return;
    this.cleanupStore=store;
    try {
      const raw=store.load();if(!raw)return;
      const value=JSON.parse(raw) as Record<string,Object>;
      if(JSON.stringify(Object.keys(value).sort())!==JSON.stringify(['did','evidence','fileStarted','peer','schema'])||value['schema']!==1||
        typeof value['peer']!=='string'||(value['peer'] as string).length>128||/[\u0000-\u0020\u007f]/.test(value['peer'] as string)||
        typeof value['did']!=='string'||typeof value['fileStarted']!=='boolean'||!['none','device_event','user_confirmation'].includes(value['evidence'] as string))throw new Error('PROMPTER_RECORD');
      const did=value['did'] as string,peer=value['peer'] as string;
      if(did){
        if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(did)||!peer||value['evidence']!=='none')throw new Error('PROMPTER_OWNER');
        this.did=did;this.peer=peer;this.fileStarted=value['fileStarted'] as boolean;this.prepareWriteStarted=true;
        this.phase='cleanup';this.note='上次提词退出未确认，请连接原眼镜后退出；不会自动传稿或开麦';
      }else if(peer||value['fileStarted']!==false||value['evidence']==='none')throw new Error('PROMPTER_TERMINAL');
      this.exitEvidence=value['evidence'] as string;
    }catch(_){this.cleanupFault=true;this.phase='error';this.note='提词退出记录不可读，原件保留；暂不能开启新通道';}
    this.emit();
  }
  private persistCleanup(fileStarted:boolean,evidence:string='none'):void {
    if(!this.cleanupStore)throw new Error('提词退出记录尚未初始化');
    const record=new PrompterCleanupRecord();record.evidence=evidence;
    if(evidence==='none'){record.peer=this.peer;record.did=this.did;record.fileStarted=fileStarted;}
    try{this.cleanupStore.save(JSON.stringify(record));this.exitEvidence=evidence;}
    catch(_){this.cleanupFault=true;this.error('提词退出记录保存失败，保留占用；不会继续传稿');throw new Error('提词退出记录保存失败');}
  }
  confirmExited(did:string):void {
    if(!this.canConfirmExited||!did||did!==this.did)throw new Error('请连接原眼镜，等待发送结束并核对当前退出请求');
    this.clear('用户确认提词已退出（非设备回执）',true,'user_confirmation');
  }
  private emit():void{hilog.info(0x2a03,'TurboIO','prompter state did=%{public}s phase=%{public}s progress=%{public}d speed=%{public}d offset=%{public}d mode=%{public}d audio=%{public}d matched=%{public}d confirmed=%{public}d',this.did,this.phase,this.progress,this.speed,this.offset,this.mode,this.followPackets,this.matchedOffset,this.confirmedHighlight);this.changed();}
  private deadline(ms:number,message:string):void{if(this.timer!==-1)clearTimeout(this.timer);const epoch=this.epoch;this.timer=setTimeout(()=>{this.timer=-1;if(epoch===this.epoch&&this.active)this.error(message);},ms);}
  private serialize(action:()=>Promise<void>):Promise<void>{const task=this.queue.catch(()=>{}).then(action);this.queue=task.catch(()=>{});return task;}
  private async command(type:number,body:PrompterBody):Promise<void>{const bytes=businessEnvelope(type,new util.TextEncoder().encodeInto(JSON.stringify(body)));this.writes++;try{await this.send(20,bytes);hilog.info(0x2a03,'TurboIO','prompter tx did=%{public}s type=%{public}d action=%{public}d',body.did,type,body.action);}finally{bytes.fill(0);this.writes--;this.emit();}}
  private cancelStartQuery():void{if(this.startPoll!==-1)clearTimeout(this.startPoll);this.startPoll=-1;this.startQueryPending=false;}
  // Called inside the serial queue. Type3/code1 can acknowledge the countdown,
  // before the service starts. Only an outstanding same-DID type10 reply with
  // state1 permits controls. State4 is pending; neither value proves lens UI.
  private async queryStartState():Promise<void>{
    if(this.phase!=='starting'||this.startQueryPending||!this.connectionReady||this.device()!==this.peer)return;
    const epoch=this.epoch;
    this.startQueryPending=true;
    try{await this.command(10,{did:this.did,action:1});}
    catch(error){
      if(epoch!==this.epoch||this.phase!=='starting')return;
      // A transport-side rejection is not evidence that the glasses failed to
      // start. Keep the bounded 10 s deadline and the start guard; do not turn
      // the rejection into an immediate stop inside the countdown window.
      const message=(error as Error).message;
      const reason=/^[a-z][a-z0-9-]{0,63}$/.test(message)?message:'unclassified';
      this.lastQueryFailure=reason;
      hilog.info(0x2a03,'TurboIO','prompter query-failure did=%{public}s reason=%{public}s',this.did,reason);
      this.startQueryPending=false;this.note='启动状态查询未提交，尚未确认运行；本轮占用保留';this.emit();
    }
  }
  private pollStartState(epoch:number):void{
    this.startPoll=setTimeout(()=>{
      if(epoch!==this.epoch||this.phase!=='starting')return;
      this.startPoll=-1;
      void this.serialize(async()=>{if(epoch===this.epoch&&this.phase==='starting')await this.queryStartState();})
        .catch(()=>{if(epoch===this.epoch&&this.phase==='starting')this.error('启动状态查询未提交，请退出本轮');});
    },500);
  }
  async prepare(text:string,speed:number,mode:number=2,source:string='local',title:string=''):Promise<void>{
    if(!this.cleanupStore)throw new Error('提词退出记录尚未初始化');
    if(this.active||!this.connectionReady||!this.device()||!this.idle())throw new Error('请先连接眼镜，关闭语音、录音及其他显示');
    if(!Number.isInteger(speed)||speed<60||speed>240||!text.trim()||text.length>12000)throw new Error('稿件限 12000 字，速度 60–240');
    if(![1,2].includes(mode)||mode===1&&!this.follow)throw new Error('当前跟随服务未装配');
    if(!['local','cloud'].includes(source))throw new Error('识别来源无效');this.asrSource=source;
    if(title.length>100||/[\u0000-\u001f\u007f]/.test(title))throw new Error('稿件标题限100字且不能包含控制字符');
    const bytes=new util.TextEncoder().encodeInto(text);if(bytes.length>48000){bytes.fill(0);throw new Error('稿件 UTF-8 超过 48000 字节');}
    this.title=title;this.manuscript=text;const epoch=++this.epoch;this.phase='preparing';this.peer=this.device();this.total=bytes.length;this.checksum=teleprompterChecksum(bytes);this.speed=speed;this.progress=0;this.offset=0;this.businessReady=false;this.fileStarted=false;this.prepareWriteStarted=false;this.startAckAt=0;this.mode=mode;this.followNote='';this.followPackets=0;this.matchedOffset=0;this.confirmedHighlight=0;this.positionReplies=0;this.abandonedPositionAck=false;this.acceptedHighlight=0;this.recentPositions=[];
    this.lastQueryState=-1;this.lastQueryFailure='';
    const random=cryptoFramework.createRandom().generateRandomSync(16).data;random[6]=(random[6]&15)|64;random[8]=(random[8]&63)|128;
    const id=Array.from(random).map((n:number)=>n.toString(16).padStart(2,'0')).join('');random.fill(0);
    this.did=id.slice(0,8)+'-'+id.slice(8,12)+'-'+id.slice(12,16)+'-'+id.slice(16,20)+'-'+id.slice(20);this.note='正在计算稿件摘要，正文不会上传云端';this.emit();
    try{
      if(mode===1){await this.follow!.prepare(text,source);if(epoch!==this.epoch)return;}
      const digest=cryptoFramework.createMd('MD5');await digest.update({data:bytes});const hash=await digest.digest();
      if(epoch!==this.epoch)return;
      const md5=Array.from(hash.data).map((n:number)=>n.toString(16).padStart(2,'0')).join('');hash.data.fill(0);
      this.file=new OutboundFile(this.did,bytes,md5,17);this.deadline(30000,'准备未收到完整回报，请退出本轮再试');
      await this.serialize(async()=>{if(epoch!==this.epoch)return;this.persistCleanup(false);this.prepareWriteStarted=true;await this.command(2,{did:this.did,action:1,total:this.total,checksum:this.checksum,scroll:this.mode,speed:speed,pageOffset:0,highLightOffset:0});});
      if(epoch===this.epoch){this.note='准备请求已提交，等待眼镜允许传稿';this.emit();}
    }catch(error){if(epoch===this.epoch){if(this.prepareWriteStarted||this.cleanupFault)this.error('稿件准备失败，退出记录与占用保留');else this.clear('本机准备失败，尚未向眼镜提交；补齐配置后可重试');}throw new Error((error as Error).message);}
    finally{bytes.fill(0);}
  }
  receive(peer:string,business:number,payload:Uint8Array):void{
    this.onListPacket(peer,business,payload);
    if(!this.active||!this.connectionReady||peer!==this.peer||peer!==this.device()||![17,20].includes(business))return;
    if(this.queued>=16){this.error('提词器接收队列超限，请退出本轮');return;}
    const copy=payload.slice(),epoch=this.epoch;this.queued++;
    this.serialize(async()=>{if(epoch===this.epoch)await this.handle(business,copy,epoch);}).catch((error:Error)=>{if(epoch===this.epoch){const reason=/^[a-z][a-z0-9-]{0,63}$/.test(error.message)?error.message:'unclassified';hilog.info(0x2a03,'TurboIO','prompter failure did=%{public}s business=%{public}d reason=%{public}s',this.did,business,reason);this.error('传稿或眼镜回报失败，未宣告完整收稿');}}).finally(()=>{copy.fill(0);this.queued--;});
  }
  private async handle(business:number,bytes:Uint8Array,epoch:number):Promise<void>{
    if(business===17){
      const observed=readFileMessage(bytes);
      try{hilog.info(0x2a03,'TurboIO','prompter file-rx did=%{public}s type=%{public}d match=%{public}s bytes=%{public}d start=%{public}d size=%{public}d state=%{public}d',this.did,observed.type,String(observed.uuid===this.did),bytes.length,observed.start,observed.size,observed.state);}finally{observed.data.fill(0);}
      if(!this.fileStarted||!this.file||['error','closing'].includes(this.phase))return;
      const file=this.file,m=file.receive(bytes);
      if(m){const payload=fileMessage(m);try{await this.sendFile(payload,m.type);if(epoch!==this.epoch)return;file.committed(m);}finally{payload.fill(0);m.data.fill(0);}}
      if(epoch!==this.epoch)return;this.progress=Math.floor(file.sentBytes*100/this.total);
      this.note=file.complete?'眼镜文件层确认完整收稿；等待提词业务就绪':'文件传输 '+this.progress+'% · 未宣告镜片显示';
      this.ready();this.emit();return;
    }
    const packet=readLauncherEnvelope(bytes);
    try{
      if(packet.type===9){
        if(this.mode===1&&this.follow&&packet.binary.length&&packet.binary.length<=4096&&(this.phase==='running'||this.phase==='starting'||this.phase==='controlling'&&[3,5].includes(this.pendingControl))){this.followPackets++;this.follow.opus(packet.binary);}
        return;
      }
      const body=JSON.parse(new util.TextDecoder().decodeToString(packet.json)) as Record<string,Object>;
      if(body['did']!==this.did)return;
      const action=body['action'],code=body['code'];
      hilog.info(0x2a03,'TurboIO','prompter rx did=%{public}s type=%{public}d action=%{public}d code=%{public}s',this.did,packet.type,typeof action==='number'?action:-1,typeof code==='number'?String(code):'absent');
      if(packet.type===6&&(action===1||(action===2&&code===1))){
        const localBack=action===1&&code===1&&this.mode===2&&this.businessReady&&this.file?.complete&&this.phase==='paused';
        const exitedDid=this.did,exitedPeer=this.peer;
        if(action===1)await this.command(6,{did:this.did,action:2,code:1});
        if(epoch===this.epoch){
          this.clear('提词正文已停止，稿件保留；回到时间页需单独确认',true);
          if(localBack&&this.phase==='idle'&&this.connectionReady&&this.device()===exitedPeer){this.deviceLocalBackDid=exitedDid;this.deviceLocalBackSequence++;}
        }
        return;
      }
      if(packet.type===6&&action===2&&this.phase==='closing'&&typeof code==='number'&&Number.isInteger(code)&&code>=2&&code<=255){
        // A negative reply is not a timeout or proof that the display exited.
        // Retain the original owner; explicit recovery remains available.
        this.error(`眼镜未确认退出（code ${code}）；请确认镜片已回时间页后清理`);return;
      }
      if(['error','closing','cleanup'].includes(this.phase))return;
      if(packet.type===10){
        if(action!==2||this.phase!=='starting'||!this.startQueryPending)return;
        const state=body['state'];
        if(typeof state!=='number'||!Number.isInteger(state)||state<0||state>255)return;
        this.lastQueryState=state;this.lastQueryFailure='';
        this.startQueryPending=false;
        hilog.info(0x2a03,'TurboIO','prompter start-state did=%{public}s state=%{public}d',this.did,state);
        if(state===4){this.note='眼镜仍在等待启动，暂不发送暂停';this.pollStartState(epoch);this.emit();return;}
        if(state!==1){this.error(`眼镜尚未进入运行状态（state ${state}），未继续发送控制`);return;}
        this.cancelStartQuery();if(this.timer!==-1)clearTimeout(this.timer);this.timer=-1;
        this.phase='running';this.note='眼镜业务状态已进入运行；镜片显示需另行确认';
        if(this.positionNext){const next=this.positionNext;this.positionNext=undefined;this.followPosition(next);}
        this.emit();return;
      }
      if(packet.type===8&&action===2&&this.abandonedPositionAck){this.abandonedPositionAck=false;return;}
      if(packet.type===8&&action===2&&this.positionPending){
        const pending=this.positionPending;this.positionPending=undefined;this.positionWriteStarted=false;if(this.positionTimer!==-1)clearTimeout(this.positionTimer);this.positionTimer=-1;
        if(code!==1){this.followFailure('眼镜拒绝跟随位置更新');return;}
        this.positionReplies++;this.acceptedHighlight=pending.highLightOffset;
        if(body['pageOffset']===pending.pageOffset&&body['highLightOffset']===pending.highLightOffset){this.offset=pending.pageOffset;this.confirmedHighlight=pending.highLightOffset;this.followNote='眼镜回报对应跟随位置（镜片效果待验）';}
        else this.followNote='已收到位置指令应答；实际位置与镜片效果仍待验';
        const next=this.positionNext;this.positionNext=undefined;if(next)this.followPosition(next);this.emit();return;
      }
      if(packet.type===2&&action===2){
        if(code!==1&&code!==7)throw new Error('prepare-rejected');
        if(!this.fileStarted&&code!==1)throw new Error('completion-before-file');
        if(!this.fileStarted){if(!this.file)throw new Error('file-not-ready');this.persistCleanup(true);this.fileStarted=true;this.phase='transferring';this.deadline(120000,'两分钟内未确认整稿收取，请退出后重试');const payload=this.file.info();try{await this.sendFile(payload,1);}finally{payload.fill(0);}if(epoch===this.epoch)this.note='文件信息已发送，按眼镜请求分块传稿';}
        else if(code===7){this.businessReady=true;this.ready();}
      }
      if([3,4,5,7].includes(packet.type)&&action===2&&this.phase==='controlling'&&packet.type===this.pendingControl){
        if(code!==1)throw new Error('control-rejected');
        if(packet.type===3){
          this.pendingControl=0;this.pendingSpeed=0;this.cancelStartQuery();this.phase='starting';this.startAckAt=Date.now();
          this.note='启动请求已受理，等待眼镜实际运行';this.deadline(10000,'启动状态未确认，未发送暂停；请退出本轮');
          await this.queryStartState();this.emit();return;
        }
        if(this.timer!==-1)clearTimeout(this.timer);this.timer=-1;
        if(packet.type===3||packet.type===5)this.phase='running';if(packet.type===4)this.phase='paused';
        if(packet.type===7){this.phase=this.beforeControl;if(this.pendingSpeed)this.speed=this.pendingSpeed;}
        this.pendingControl=0;this.pendingSpeed=0;
        if(this.phase==='paused'){this.follow?.pause();this.cancelPosition();}
        if(this.phase==='running'&&this.positionNext){const next=this.positionNext;this.positionNext=undefined;this.followPosition(next);}
        this.note='眼镜已确认'+(this.phase==='running'?(this.mode===1?'朗读跟随（候选）':'匀速提词'):this.phase==='paused'?'暂停':'速度修改');
      }
      if([4,5,7,8].includes(packet.type)&&action===1){
        const wasPaused=this.phase==='paused';
        const ready=this.businessReady&&this.file?.complete&&['ready','running','paused','controlling'].includes(this.phase);
        if(ready){
          if(packet.type===8){
            const value=body['pageOffset'];
            if(typeof value==='number'&&Number.isSafeInteger(value)&&value>=0&&value<=this.total&&(this.mode!==1||this.follow?.boundary(value))){
              const previous=this.offset;this.offset=value;
              // Firmware action1 does not name the physical input source. A
              // recent submitted page can be an echo, not a manual crown move.
              const echo=this.recentPositions.some((position:FollowPosition):boolean=>position.pageOffset===value&&(body['highLightOffset']===undefined||body['highLightOffset']===position.highLightOffset));
              if(this.mode===1&&this.follow?.boundary(value)&&value!==previous&&!echo){this.cancelPosition();this.acceptedHighlight=value;this.confirmedHighlight=0;this.matchedOffset=value;this.recentPositions=[];this.follow.reanchor(value);}
            }
          }
          if(packet.type===4||packet.type===5){
            const phase=packet.type===4?'paused':'running';
            if(this.phase==='controlling'&&this.pendingControl===7)this.beforeControl=phase;
            else{
              if(this.phase==='controlling'){if(this.timer!==-1)clearTimeout(this.timer);this.timer=-1;this.pendingControl=0;this.pendingSpeed=0;}
              this.phase=phase;
            }
            if(this.mode===1){if(packet.type===4){this.follow?.pause();this.cancelPosition();}else if(this.follow){const generation=this.epoch;void this.follow.begin().catch((error:Error):void=>{if(generation===this.epoch)this.followFailure(error.message);});}}
          }
          if(packet.type===7){
            const speed=body['speed'];if(typeof speed==='number'&&Number.isInteger(speed)&&speed>=60&&speed<=240){this.speed=speed;this.pendingSpeed=0;}
            const mode=body['scroll'];
            if(typeof mode==='number'&&mode!==this.mode){
              this.follow?.pause();this.cancelPosition();this.followNote='眼镜更改滚动模式，请退出后重新准备对应模式';
              await this.command(7,{did:this.did,action:2,code:1});
              if(epoch===this.epoch){void this.stop().catch(():void=>{if(this.epoch===epoch+1&&this.phase==='closing')this.error('模式已改变且退出未确认，请用实体按钮退出');});}
              return;
            }
          }
        }
        await this.command(packet.type,{did:this.did,action:2,code:1});
        if(epoch===this.epoch&&ready&&wasPaused&&packet.type===5&&this.mode===2)this.deviceResumeSequence++;
        if(epoch===this.epoch)this.note=ready?'已收到眼镜操作 / 阅读位置回传':'已收到眼镜回报，继续等待整稿就绪';
      }
      this.emit();
    }finally{packet.json.fill(0);packet.binary.fill(0);}
  }
  private ready():void{if(this.phase==='transferring'&&this.businessReady&&this.file?.complete){this.phase='ready';if(this.timer!==-1)clearTimeout(this.timer);this.timer=-1;this.note='文件与提词业务均已确认，点开始'+(this.mode===1?'朗读跟随（候选）':'匀速提词');try{this.onCompletedFile(this.peer,this.did,this.title,this.manuscript,this.total,this.mode);}catch(_){}finally{this.manuscript='';this.title='';}}}
  private async sendFile(payload:Uint8Array,type:number):Promise<void>{this.writes++;try{await this.send(17,payload);hilog.info(0x2a03,'TurboIO','prompter file-tx did=%{public}s business=17 type=%{public}d bytes=%{public}d',this.did,type,payload.length);}finally{this.writes--;this.emit();}}
  async control(type:number,speed:number=this.speed):Promise<void>{
    if(![3,4,5,7].includes(type)||!['ready','running','paused'].includes(this.phase))throw new Error('请先等整稿就绪，或结束上一项控制');
    if(type===3&&this.phase!=='ready'||type===4&&this.phase!=='running'||type===5&&this.phase!=='paused')throw new Error('当前阶段不能执行此动作');
    if(!Number.isInteger(speed)||speed<60||speed>240)throw new Error('速度 60–240');
    if(this.mode===1&&type===7)throw new Error('朗读跟随由识别位置推进；调速用于匀速模式');
    const body:PrompterBody={did:this.did,action:1};if(type===4){body.offset=this.offset;body.code=1;body.isCompleted=false;this.follow?.pause();this.cancelPosition();}if(type===7){body.scroll=this.mode;body.speed=speed;}
    if(type===3){body.total=this.total;body.checksum=this.checksum;body.scroll=this.mode;body.speed=this.speed;body.pageOffset=0;body.highLightOffset=0;this.startAckAt=0;}
    this.beforeControl=this.phase;this.pendingControl=type;this.pendingSpeed=type===7?speed:0;this.phase='controlling';const epoch=this.epoch;
    try{
      if(this.mode===1&&[3,5].includes(type))await this.follow!.begin();
      if(epoch!==this.epoch||this.phase!=='controlling'||this.pendingControl!==type)throw new Error('本次控制已被退出或眼镜操作取代');
      this.deadline(10000,'控制回报超时，请先退出本轮');await this.serialize(async()=>{if(epoch===this.epoch&&this.phase==='controlling'&&this.pendingControl===type)await this.command(type,body);});
    }catch(error){if(epoch===this.epoch&&this.phase==='controlling'&&this.pendingControl===type)this.error('控制或跟随准备未完成，请退出本轮后重试');throw new Error((error as Error).message);}
    this.emit();
  }
  async stop():Promise<void>{
    if(!this.active||this.phase==='closing')return;
    if(this.cleanupFault||this.prepareWriteStarted&&(!this.connectionReady||this.device()!==this.peer))throw new Error('请先连接原眼镜，保留提词退出记录');
    if(this.phase==='idle'&&this.writes>0)throw new Error('提词退出发送尚未结束');
    if(!this.prepareWriteStarted){this.clear('本机准备已取消，尚未向眼镜提交本轮',true);return;}
    const guard=(this.phase==='starting'||this.phase==='error')&&this.startAckAt>0?Math.max(0,this.startAckAt+START_GUARD_MS-Date.now()):0;
    const did=this.did,started=this.fileStarted,epoch=++this.epoch;this.follow?.stop();this.cancelPosition();this.cancelStartQuery();this.file?.close();this.phase='closing';this.note=guard>0?'启动保护窗口内，稍后提交退出':'正在退出，请等待眼镜确认';this.deadline(10000+guard,'退出未确认；请按眼镜实体按钮退出后再操作');this.emit();
    await this.serialize(async()=>{
      if(guard>0){await new Promise<void>((resolve:()=>void):void=>{setTimeout(():void=>resolve(),guard);});}
      if(epoch!==this.epoch)return;
      if(!this.connectionReady||this.device()!==this.peer)throw new Error('原眼镜连接已变化，未提交退出');
      if(started){const m=new FileMessage();m.type=6;m.uuid=did;m.reason='user-stop';const bytes=fileMessage(m);try{await this.sendFile(bytes,6);}finally{bytes.fill(0);}}
      if(epoch!==this.epoch||!this.connectionReady||this.device()!==this.peer)throw new Error('原眼镜连接已变化，未继续提交退出');
      await this.command(6,{did:did,action:1});
    });
  }
  // Confirms playback stopped, NOT navigation to the time/home screen.
  // Lifecycle owners wait for device confirmation, not merely a native write.
  // Observers do not replace the page's changed callback. Repeated callers share
  // the current closing attempt; timeout/disconnect/write failure resolve false.
  stopAndWait():Promise<boolean>{
    if(!this.active)return Promise.resolve(true);
    return new Promise<boolean>((resolve:(confirmed:boolean)=>void):void=>{
      this.exitWaiters.push(resolve);const pending=this.stop(),epoch=this.epoch;
      pending.catch(():void=>{if(epoch!==this.epoch)return;if(this.phase==='closing')this.error('退出未确认：请求未提交，请用眼镜实体按钮退出');else this.settleExit(false);});
    });
  }
  private settleExit(confirmed:boolean):void{const pending=this.exitWaiters;this.exitWaiters=[];for(const resolve of pending)resolve(confirmed);}
  disconnected():void{
    this.connectionReady=false;this.onListDisconnect();if(!this.active)return;
    if(!this.prepareWriteStarted&&!this.cleanupFault){this.clear('本机准备已中止，尚未提交；未自动续传');return;}
    this.epoch++;this.startAckAt=0;this.title='';this.manuscript='';this.follow?.stop();this.cancelPosition();this.cancelStartQuery();
    if(this.timer!==-1)clearTimeout(this.timer);this.timer=-1;
    this.file?.close();this.file=undefined;this.pendingControl=0;this.pendingSpeed=0;this.businessReady=false;
    this.phase=this.cleanupFault?'error':'cleanup';this.note='退出未确认且连接中断；保留原眼镜和本轮记录，不自动续传或开麦';this.settleExit(false);this.emit();
  }
  private cancelPosition():void{if(this.positionPending&&this.positionWriteStarted)this.abandonedPositionAck=true;this.positionWriteStarted=false;this.positionGeneration++;if(this.positionTimer!==-1)clearTimeout(this.positionTimer);this.positionTimer=-1;this.positionPending=undefined;this.positionNext=undefined;}
  private followPosition(position:FollowPosition):void{
    if(this.mode!==1||!this.follow?.boundary(position.pageOffset)||!this.follow.boundary(position.highLightOffset)||position.pageOffset>position.highLightOffset||position.highLightOffset<=this.acceptedHighlight)return;
    if(this.phase==='starting'||this.phase==='controlling'&&[3,5].includes(this.pendingControl)){this.positionNext=position;return;}
    if(this.phase!=='running')return;
    if(this.abandonedPositionAck){this.followFailure('上次位置回报尚未结清，请退出重开跟随');return;}
    this.matchedOffset=position.highLightOffset;if(this.positionPending){this.positionNext=position;return;}
    this.positionPending=position;const epoch=this.epoch,generation=this.positionGeneration;
    this.positionTimer=setTimeout(()=>{if(epoch===this.epoch&&generation===this.positionGeneration)this.followFailure('跟随位置回报超时');},5000);
    void this.serialize(async():Promise<void>=>{if(epoch===this.epoch&&generation===this.positionGeneration&&this.phase==='running'){this.positionWriteStarted=true;this.recentPositions.push(position);if(this.recentPositions.length>8)this.recentPositions.shift();await this.command(8,{did:this.did,action:1,pageOffset:position.pageOffset,highLightOffset:position.highLightOffset});}}).catch(():void=>{if(epoch===this.epoch&&generation===this.positionGeneration)this.followFailure('跟随位置未提交');});
  }
  private followFailure(note:string):void{
    if(this.mode!==1||!this.active||['error','closing'].includes(this.phase))return;this.follow?.pause();this.cancelPosition();this.followNote=note;
    if(this.phase==='running'){const epoch=this.epoch;void this.control(4).catch(():void=>{if(epoch===this.epoch)this.error('跟随中断且眼镜暂停未确认，请用实体按钮退出');});}
    else if(this.phase==='controlling'&&[3,5].includes(this.pendingControl)){
      const epoch=this.epoch;void this.stop().catch(():void=>{if(this.epoch===epoch+1&&this.phase==='closing')this.error('跟随中断且退出未确认，请用实体按钮退出');});
    }
    this.emit();
  }
  private error(note:string):void{this.title='';this.manuscript='';this.epoch++;this.follow?.stop();this.cancelPosition();this.cancelStartQuery();if(this.timer!==-1)clearTimeout(this.timer);this.timer=-1;this.pendingControl=0;this.pendingSpeed=0;this.file?.close();this.phase='error';this.note=note;this.settleExit(false);this.emit();}
  private clear(note:string,confirmed:boolean=false,evidence:string='device_event'):void{
    if(this.prepareWriteStarted){if(!confirmed)throw new Error('提词退出尚未确认');this.persistCleanup(false,evidence);}
    this.title='';this.manuscript='';this.epoch++;this.startAckAt=0;this.follow?.stop();this.cancelPosition();this.cancelStartQuery();if(this.timer!==-1)clearTimeout(this.timer);this.timer=-1;this.pendingControl=0;this.pendingSpeed=0;this.file?.close();this.file=undefined;this.did='';this.peer='';this.fileStarted=false;this.prepareWriteStarted=false;this.businessReady=false;this.phase='idle';this.note=note;this.settleExit(confirmed);this.emit();this.onIdle();
  }
}
