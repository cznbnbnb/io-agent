import { util } from '@kit.ArkTS';
import { cryptoFramework } from '@kit.CryptoArchitectureKit';
import { businessEnvelope,readLauncherEnvelope } from 'turbo_core';
import { DisplayCleanupPorts } from './DisplayCleanupStore';
interface NoticeBody { notificationUID:string;appId:string;appName:string;title:string;subtitle:string;content:string;timestamp:string;category:number;reply:boolean;type:number; }
export class NotificationSession {
  enabled:boolean=false;busy:boolean=false;waiting:boolean=false;note:string='独立通知通道，未读取其他 App 通知';uid:string='';
  changed:()=>void=():void=>{};
  // Phone-side intent only. The known type18 response reports the master bool,
  // not displayTime; neither a successful send nor a reboot proves readback.
  timingSeconds:number=-1;timingSubmission:string='none';
  private ownerUid:string='';private ownerPeer:string='';private ownerFault:boolean=false;
  private store:DisplayCleanupPorts|undefined=undefined;
  // A transport timeout is not a lens exit. This metadata contains no text and
  // survives disconnect/restart; neither its load nor a timer sends anything.
  get occupied():boolean{return this.busy||this.ownerFault||!!this.ownerUid;}
  get pendingUid():string{return this.ownerUid;}
  private peer:string='';private epoch:number=0;private timer:number=-1;
  private send:(business:number,payload:Uint8Array)=>Promise<void>;private device:()=>string;private idle:()=>boolean;
  constructor(send:(business:number,payload:Uint8Array)=>Promise<void>,device:()=>string,idle:()=>boolean){this.send=send;this.device=device;this.idle=idle;}
  initialize(store:DisplayCleanupPorts):void{
    if(this.busy)throw new Error('通知操作尚未结束');
    this.store=store;this.ownerFault=true;this.ownerUid='';this.ownerPeer='';
    try{
      const raw=store.load();
      if(raw){
        const saved=JSON.parse(raw) as Record<string,Object>;
        if(!saved||Object.keys(saved).length!==3||saved['schema']!==1||typeof saved['uid']!=='string'||typeof saved['peer']!=='string')throw new Error('NOTICE_RECORD');
        const uid=saved['uid'] as string,peer=saved['peer'] as string;
        if((uid&&!/^[1-9][0-9]{0,9}$/.test(uid))||peer.length>256||/[\u0000-\u001f\u007f]/.test(peer)||!!uid!==!!peer)throw new Error('NOTICE_RECORD');
        this.ownerUid=uid;this.ownerPeer=peer;
      }
      this.ownerFault=false;
      if(this.ownerUid)this.note='上次通知是否收起尚未确认；连接原眼镜后观察，再确认释放占用';
    }catch(_){this.note='通知占用记录不可读；禁止新通知，请保留记录排查';}
    this.changed();
  }
  private saveOwner(uid:string,peer:string):void{
    if(!this.store)throw new Error('通知占用记录未初始化');
    try{this.store.save(JSON.stringify({schema:1,uid:uid,peer:peer}));}
    catch(_){this.ownerFault=true;throw new Error('通知占用记录未能完整保存，未解除占用');}
  }
  confirmDismissed(uid:string):void{
    if(this.busy||this.ownerFault||!uid||uid!==this.ownerUid||this.device()!==this.ownerPeer)throw new Error('请连接原眼镜，确认当前通知已收起后再操作');
    this.saveOwner('','');this.clearWait();this.ownerUid='';this.ownerPeer='';
    this.note='已记录用户确认通知已收起；未发送移除、关麦或其他功能指令';this.changed();
  }
  private async submit(type:number,json:string):Promise<void>{const bytes=businessEnvelope(type,new util.TextEncoder().encodeInto(json));try{await this.send(21,bytes);}finally{bytes.fill(0);}}
  private check():void{if(this.occupied||this.waiting)throw new Error('上一条操作或通知显示尚未确认结束');if(!this.device()||!this.idle())throw new Error('请连接眼镜，并结束其他显示、录音或语音任务');}
  async setEnabled(enabled:boolean):Promise<void>{
    this.check();this.busy=true;this.changed();const epoch=this.epoch,peer=this.device();
    try{await this.submit(18,JSON.stringify({notification:enabled}));if(epoch!==this.epoch)return;this.peer=peer;this.enabled=enabled;this.note='通知总开关已提交，未修改来源、停留时长或来电设置';}
    finally{if(epoch===this.epoch){this.busy=false;this.changed();}}
  }
  async notify(title:string,content:string):Promise<void>{
    this.check();if(!this.enabled||this.peer!==this.device())throw new Error('请先向当前眼镜应用通知开关');
    if(!title.trim()||title.length>16||!content.trim()||content.length>48||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(title+content))throw new Error('测试通知标题 1–16 字，正文 1–48 字');
    const bytes=cryptoFramework.createRandom().generateRandomSync(4).data;let value=0;for(const b of bytes)value=value*256+b;bytes.fill(0);this.uid=String(value%2147483646+1);
    const d=new Date(),pad=(v:number,width:number=2):string=>String(v).padStart(width,'0');
    const timestamp=`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(),3)}`;
    const body:NoticeBody={notificationUID:this.uid,appId:'org.turboio.harmony.research',appName:'Turbo IO',title:title,subtitle:'',content:content,timestamp:timestamp,category:0,reply:false,type:1};
    this.saveOwner(this.uid,this.device());this.ownerUid=this.uid;this.ownerPeer=this.device();
    const epoch=this.epoch;this.waiting=true;this.busy=true;this.note='发送中，等待同 UID 的眼镜状态';this.changed();
    this.timer=setTimeout(()=>{this.timer=-1;if(epoch===this.epoch&&this.waiting){this.waiting=false;this.note='8 秒未收到匹配状态；显示占用保留，未自动重发，请确认通知已收起后释放';this.changed();}},8000);
    try{await this.submit(2,JSON.stringify(body));}
    catch(error){if(epoch===this.epoch){this.clearWait();this.note='通知提交结果不明；不算显示成功，保留显示占用待确认';}throw new Error((error as Error).message);}
    finally{if(epoch===this.epoch){this.busy=false;this.changed();}}
  }
  async setDisplaySeconds(seconds:number):Promise<void>{
    if(![5,10,15,20,30,120].includes(seconds))throw new Error('通知时长仅允许原厂档位或120秒隔离实验');
    this.check();this.busy=true;this.timingSeconds=seconds;this.timingSubmission='pending';
    const epoch=this.epoch;this.changed();
    try{
      // Partial type18 update, never full/default-resetting type17. This is a
      // global ordinary-notification target, not a per-card TTL or suggestion setting.
      await this.submit(18,JSON.stringify({displayTime:seconds}));
      if(epoch!==this.epoch)throw new Error('通知连接已变化，原时长提交结果待核对');
      this.timingSubmission='submitted';this.note='普通通知停留目标 '+seconds+' 秒已提交；设备原值未读回，镜片时长待确认';
    }catch(error){
      if(epoch===this.epoch){this.timingSubmission='uncertain';this.note='普通通知时长提交结果不明；不自动重发或猜测恢复原值';}
      throw new Error((error as Error).message);
    }finally{if(epoch===this.epoch){this.busy=false;this.changed();}}
  }
  receive(peer:string,payload:Uint8Array):void{
    if(!this.peer||peer!==this.peer||peer!==this.device())return;
    try{this.read(payload);}catch(_){/* Malformed notifications cannot close the authenticated link. */}
  }
  private read(payload:Uint8Array):void{
    const packet=readLauncherEnvelope(payload);
    try{
      // Never parse/retain ANCS type1 text. Operations are observations, not tools.
      if(![3,4,18].includes(packet.type)||packet.binary.length)return;
      const j=JSON.parse(new util.TextDecoder().decodeToString(packet.json)) as Record<string,Object>;
      if(packet.type===18){if(j['notification']===false)this.enabled=false;this.changed();return;}
      if(j['notificationUID']!==this.uid)return;
      if(packet.type===3&&typeof j['state']==='number'){
        const state=j['state'] as number,labels:string[]=['空闲（不代表已读）','显示中或间隔期，镜片效果待确认','未佩戴','勿扰模式','其他功能占用'];this.clearWait();this.note='同 UID 回报：'+(labels[state]||'未知状态，不算成功');
      }
      if(packet.type===4&&typeof j['cmd']==='number')this.note='收到同 UID 的眼镜操作；未执行任何模型或工具';
      this.changed();
    }catch(_){/* Invalid or private third-party payloads are not logged. */}
    finally{packet.json.fill(0);packet.binary.fill(0);}
  }
  private clearWait():void{if(this.timer!==-1)clearTimeout(this.timer);this.timer=-1;this.waiting=false;}
  disconnected():void{this.epoch++;this.clearWait();this.enabled=false;this.busy=false;this.peer='';this.uid='';this.timingSeconds=-1;this.timingSubmission='none';this.note=this.ownerUid||this.ownerFault?'连接已变化；保留通知显示占用，连接原眼镜并确认已收起后再继续':'连接已变化；请重新应用通知开关，不自动覆盖';this.changed();}
}
