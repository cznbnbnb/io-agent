import { common } from '@kit.AbilityKit';
import { fileIo as fs } from '@kit.CoreFileKit';
import { util } from '@kit.ArkTS';
import { cryptoFramework } from '@kit.CryptoArchitectureKit';
import { FirmwareOtaSession,OtaAction,OtaMember,otaMessage,readOtaMessage } from 'turbo_core';
import { probeSession } from './ProbeSession';
import { suggestionTests,notifications } from './NotificationService';
import { FIRMWARE_CANDIDATE_SHA,FIRMWARE_FILES,FirmwareFileProof } from './FirmwareOtaCandidate';

class FirmwareCommand {schema:number=1;id:string='';action:string='';expires_at:number=0;candidate_sha256:string='';expected_binding:string='';inspection:string='';}
class FirmwareJournal {schema:number=1;operation:string='';owner:string='';started:boolean=false;startedAt:number=0;installAt:number=0;disconnectAt:number=0;phase:string='idle';reason:string='';requests:number=0;sentBytes:number=0;apCovered:number=0;}
interface FirmwareSnapshot {
  schema:number;phase:string;reason:string;operation:string;started:boolean;candidate_sha256:string;owner_sha256:string;binding_sha256:string;
  connection:number;connected:boolean;foreground:boolean;battery:number;requests:number;sent_bytes:number;ap_covered:number;
  installing_at:number;started_at:number;disconnect_at:number;blocked:boolean;readback_verified:boolean;lens_verified:boolean;last_reply_type:number;last_reply_json:string;mtu:number;rx_metadata:string;historical_ap_covered:number;
  ota_progress:number;last_ota_debug:string;rx_history:string[];
}
function digest(bytes:Uint8Array):string{const md=cryptoFramework.createMd('SHA256');md.updateSync({data:bytes});const b=md.digestSync().data;try{return Array.from(b).map((v:number):string=>v.toString(16).padStart(2,'0')).join('');}finally{b.fill(0);}}
function hash(text:string):string{const b=new util.TextEncoder().encodeInto(text);try{return digest(b);}finally{b.fill(0);}}

// Only debug-local commands. A durable Mode2 intent survives all App restarts;
// no command automatically resumes transmission or clears an unknown result.
export class FirmwareOtaService {
  private session:FirmwareOtaSession=new FirmwareOtaSession();private journal:FirmwareJournal=new FirmwareJournal();
  private files:Map<string,Uint8Array>=new Map();private queue:Uint8Array[]=[];private draining:boolean=false;private polling:boolean=false;
  private generation:number=0;private blocked:boolean=false;private restoreBackground:boolean=false;private savedNote:string='';
  private lastPhase:string='';private savedRequests:number=0;
  private context:common.UIAbilityContext;private read:(name:string)=>string|undefined;private write:(name:string,text:string)=>void;
  private lastReplyType:number=0;private lastReplyJson:string='';
  private lastOtaDebug:string='';private rxHistory:string[]=[];
  constructor(context:common.UIAbilityContext,read:(name:string)=>string|undefined,write:(name:string,text:string)=>void){
    this.context=context;this.read=read;this.write=write;
    try{
      const raw=this.read('firmware-journal.json');if(raw){const j=JSON.parse(raw) as FirmwareJournal;
        if(j.schema!==1||typeof j.started!=='boolean'||!['owner','operation','phase','reason'].every((k:string):boolean=>typeof (j as Object as Record<string,Object>)[k]==='string')||
          (j.started&&(!/^[a-f0-9]{64}$/.test(j.owner)||!/^fw-[a-f0-9]{32}$/.test(j.operation)||!Number.isSafeInteger(j.startedAt))))throw new Error('OTA_JOURNAL');
        if(!Number.isSafeInteger(j.requests)||j.requests<0||j.requests>2000||!Number.isSafeInteger(j.sentBytes)||j.sentBytes<0||j.sentBytes>64000000||!Number.isSafeInteger(j.apCovered)||j.apCovered<0||j.apCovered>7208648||!Number.isSafeInteger(j.installAt)||j.installAt<0||!Number.isSafeInteger(j.disconnectAt)||j.disconnectAt<0)throw new Error('OTA_JOURNAL_COUNTS');
        this.journal=j;if(j.started){this.session.started=true;this.session.peer=j.owner;this.session.requests=j.requests;this.session.sentBytes=j.sentBytes;this.session.phase='unknown';this.session.reason='OTA_RESTORED_UNKNOWN';this.lock();}
      }
    }catch(_){this.blocked=true;probeSession.firmwareOccupied=true;probeSession.auth.firmwareExclusive=true;}
    probeSession.onFirmware=(peer:string,bytes:Uint8Array,connection:number):void=>{
      if(!probeSession.firmwareOccupied||peer!==probeSession.peerDeviceId||connection!==probeSession.auth.connectionGeneration||bytes.length>8192)return;
      if(this.queue.length>=8){this.fail('OTA_RX_QUEUE');return;}this.queue.push(bytes.slice());void this.drain();
    };
    probeSession.onFirmwareDisconnected=():void=>{
      if(!probeSession.firmwareOccupied)return;
      if(this.journal.started)this.journal.disconnectAt=Date.now();
      if(this.session.phase!=='installing')this.fail('OTA_DISCONNECTED');else this.save();
    };
  }
  private owner():string{const b=probeSession.peerInfo?.peerIdentifier;if(!probeSession.features.state.connected||!b||b.length!==6)return '';return digest(b);}
  private connection():number{return probeSession.auth.connectionGeneration;}
  private lock():void{probeSession.firmwareOccupied=true;probeSession.auth.firmwareExclusive=true;}
  private idle():boolean{return probeSession.foreground&&probeSession.features.state.connected&&!probeSession.features.launcherBusy&&!probeSession.features.displayActive&&
    !probeSession.voice.active&&!probeSession.voice.pendingWrites&&!probeSession.recordingOccupied()&&!probeSession.lifelogOccupied()&&!probeSession.prompterOccupied()&&
    !probeSession.agentCaptureOccupied&&!probeSession.agentSuggestionOccupied&&!notifications.occupied&&!suggestionTests.active&&!suggestionTests.busy;}
  private binding():string{return ['ready','readback_ready'].includes(this.session.phase)?hash(this.journal.owner+'\n'+String(this.session.connection)+'\n'+this.journal.operation+'\n'+this.session.phase+'\n'+String(this.session.freshAt)+'\n'+FIRMWARE_CANDIDATE_SHA):'';}
  private snapshot():FirmwareSnapshot{return {schema:1,phase:this.session.phase,reason:this.session.reason,operation:this.journal.operation,started:this.journal.started,
    candidate_sha256:FIRMWARE_CANDIDATE_SHA,owner_sha256:this.journal.owner,binding_sha256:this.binding(),connection:this.connection(),connected:probeSession.features.state.connected,
    foreground:probeSession.foreground,battery:this.session.battery,requests:this.session.requests,sent_bytes:this.session.sentBytes,ap_covered:this.session.coverage.get('nuttx_ap.bin')?.bytes||0,
    installing_at:this.journal.installAt,started_at:this.journal.startedAt,disconnect_at:this.journal.disconnectAt,blocked:this.blocked,readback_verified:this.session.phase==='readback_ready',lens_verified:false,last_reply_type:this.lastReplyType,last_reply_json:this.lastReplyJson,mtu:probeSession.auth.snapshot().mtu,rx_metadata:probeSession.auth.snapshot().lastMessage,historical_ap_covered:this.journal.apCovered,
    ota_progress:this.session.progress,last_ota_debug:this.lastOtaDebug,rx_history:this.rxHistory.slice()};}
  private save():void{
    this.journal.phase=this.session.phase;this.journal.reason=this.session.reason;this.journal.requests=this.session.requests;this.journal.sentBytes=this.session.sentBytes;
    // Historical counts never become fresh ranges or installation proof, but
    // losing them on process restart must not enable an AP-zero recovery route.
    this.journal.apCovered=Math.max(this.journal.apCovered,this.session.coverage.get('nuttx_ap.bin')?.bytes||0);if(this.session.installSeenAt)this.journal.installAt=this.session.installSeenAt;
    this.write('firmware-journal.json',JSON.stringify(this.journal));this.lastPhase=this.session.phase;this.savedRequests=this.session.requests;
  }
  private fail(reason:string):void{
    if(this.journal.started)this.session.started=true;
    this.session.fail(reason);++this.generation;for(const b of this.queue)b.fill(0);this.queue=[];
    try{this.save();this.write('firmware-status.json',JSON.stringify(this.snapshot()));}catch(_){this.blocked=true;this.lock();}
    if(!this.journal.started&&!this.blocked){this.unlock();}
  }
  private unlock():void{
    probeSession.auth.firmwareExclusive=false;probeSession.firmwareOccupied=false;probeSession.firmwareReconnectAllowed=false;
    if(this.restoreBackground){this.restoreBackground=false;void probeSession.background.stop('升级前临时后台任务已释放');}
    probeSession.connection.note=this.savedNote||'已连接眼镜';probeSession.onConnection();
  }
  private load():string{
    const root=this.context.filesDir+'/firmware-suggest60',dir=fs.lstatSync(root);if(!dir.isDirectory()||dir.isSymbolicLink())throw new Error('OTA_DIRECTORY');
    const names=fs.listFileSync(root);if(names.length!==FIRMWARE_FILES.length||names.some((n:string):boolean=>!FIRMWARE_FILES.some((f:FirmwareFileProof):boolean=>f.name===n)))throw new Error('OTA_FILE_SET');
    this.files.clear();
    for(const f of FIRMWARE_FILES){const p=root+'/'+f.name,stat=fs.lstatSync(p);if(!stat.isFile()||stat.isSymbolicLink()||stat.size!==f.size)throw new Error('OTA_FILE_SIZE');
      const file=fs.openSync(p,fs.OpenMode.READ_ONLY),bytes=new Uint8Array(f.size);try{let at=0;while(at<bytes.length){const part=new Uint8Array(bytes.length-at);const n=fs.readSync(file.fd,part.buffer);if(n<1)throw new Error('OTA_FILE_READ');bytes.set(part.subarray(0,n),at);part.fill(0);at+=n;}}finally{fs.closeSync(file);}
      if(digest(bytes)!==f.sha256){bytes.fill(0);throw new Error('OTA_FILE_HASH');}this.files.set(f.name,bytes);
    }
    return new util.TextDecoder('utf-8',{fatal:true}).decodeToString(this.files.get('OtaFileInfo.json') as Uint8Array);
  }
  private async transmit(action:OtaAction):Promise<void>{
    const token=this.generation;if(this.owner()!==this.session.peer||this.connection()!==this.session.connection)throw new Error('OTA_CONNECTION_CHANGED');
    const body=new util.TextEncoder().encodeInto(action.body);let binary=new Uint8Array();
    if(action.type===7){const source=this.files.get(action.name);if(!source||action.start+action.size>source.length)throw new Error('OTA_FILE_NOT_FROZEN');binary=source.slice(action.start,action.start+action.size);}
    const bytes=otaMessage(action.type,body,binary);try{await probeSession.auth.sendBusiness(9,bytes);if(token!==this.generation)throw new Error('OTA_GENERATION_CHANGED');this.session.sent(action);}
    finally{body.fill(0);binary.fill(0);bytes.fill(0);}
  }
  private async drain():Promise<void>{
    if(this.draining)return;this.draining=true;
    try{while(this.queue.length){const b=this.queue.shift() as Uint8Array;let action:OtaAction|undefined;
      try{const m=readOtaMessage(b);this.lastReplyType=m.type;this.lastReplyJson=new util.TextDecoder('utf-8',{fatal:true}).decodeToString(m.json);
        this.lastOtaDebug=`phase=${this.session.phase};requests=${this.session.requests};sent=${this.session.sentBytes};progress=${this.session.progress};type=${m.type};json=${this.lastReplyJson}`;
        this.rxHistory.push(this.lastOtaDebug);if(this.rxHistory.length>8)this.rxHistory.shift();
        action=this.session.receive(this.owner(),this.connection(),b,Date.now());}finally{b.fill(0);}
      if(action)await this.transmit(action);if(this.lastPhase!==this.session.phase||this.session.requests-this.savedRequests>=25)this.save();
      if(this.session.phase==='failed'||this.session.phase==='unknown'){this.fail(this.session.reason);break;}
    }}catch(error){this.fail(/^[A-Z0-9_]{1,64}$/.test((error as Error).message)?(error as Error).message:'OTA_SEND_UNCERTAIN');}finally{this.draining=false;}
  }
  private async prepare(id:string):Promise<void>{
    // A manual journal release restores ordinary App use, but is not fresh
    // device boot validation and must not erase the failed operation on retry.
    if(this.journal.reason==='OTA_LINK_RECOVERED_NO_AP')throw new Error('OTA_MANUAL_RELEASE_NEEDS_INSPECTION');
    if(this.blocked||probeSession.firmwareOccupied||this.journal.started||!this.idle()||!this.owner())throw new Error('OTA_PREPARE_NOT_IDLE');
    if(probeSession.auth.snapshot().mtu<185)throw new Error('OTA_MTU_TOO_SMALL');
    this.savedNote=probeSession.connection.note;this.lock();this.journal=new FirmwareJournal();this.journal.operation=id;this.journal.owner=this.owner();this.session=new FirmwareOtaSession();this.generation++;
    this.lastOtaDebug='';this.rxHistory=[];
    try{
      this.restoreBackground=!probeSession.background.active;await probeSession.background.start(this.context);if(!probeSession.background.active||!this.idle())throw new Error('OTA_BACKGROUND_OR_IDLE');
      await probeSession.auth.waitForBusinessIdle();const manifest=this.load();const members:OtaMember[]=FIRMWARE_FILES.filter((f:FirmwareFileProof):boolean=>f.name!=='OtaFileInfo.json').map((f:FirmwareFileProof):OtaMember=>{const v=new OtaMember();v.name=f.name;v.size=f.size;v.sha256=f.sha256;return v;});
      const action=this.session.prepare(this.owner(),this.connection(),members,manifest,Date.now());this.save();await this.transmit(action);
    }catch(error){this.fail(/^[A-Z0-9_]{1,64}$/.test((error as Error).message)?(error as Error).message:'OTA_PREPARE_FAILED');throw new Error((error as Error).message);}
  }
  private async reconnectLink():Promise<void>{
    // Keep this explicit connection-only lease through asynchronous pairing,
    // including its single transient send retry. It cannot enable a Mode2 send.
    probeSession.firmwareReconnectAllowed=true;
    try{
      await probeSession.reconnect(this.context);const deadline=Date.now()+90000;
      while(['connecting','authenticating','initializing','retrying','scanning'].includes(probeSession.connection.phase)&&Date.now()<deadline&&probeSession.foreground){await new Promise<void>((resolve:()=>void):void=>{setTimeout(resolve,250);});}
      if(!probeSession.features.state.connected||this.owner()!==this.journal.owner)throw new Error('OTA_LINK_RECOVERY_FAILED');
    }finally{probeSession.firmwareReconnectAllowed=false;}
  }
  async poll():Promise<void>{
    if(this.polling)return;this.polling=true;
    try{
      if(probeSession.firmwareOccupied&&!this.blocked){
        this.session.check(this.owner(),this.connection(),Date.now());
        if(this.session.phase==='failed')this.fail(this.session.reason);
        if(!probeSession.foreground&&!probeSession.background.active&&this.session.started)this.session.fail('OTA_BACKGROUND_LOST');
        if(this.lastPhase!==this.session.phase)this.save();
        probeSession.connection.note='固件升级：'+this.session.phase+' · '+this.session.requests+'片 · 不要断电或重复升级';probeSession.onConnection();
      }
      this.write('firmware-status.json',JSON.stringify(this.snapshot()));
      const raw=this.read('firmware-command.json');if(!raw)return;let c:FirmwareCommand;
      // HDC inbox publication may still be in progress. Only a complete valid
      // command can run; malformed inbox data never changes the durable intent.
      try{c=JSON.parse(raw) as FirmwareCommand;}catch(_){return;}
      const allowed=['schema','id','action','expires_at','candidate_sha256','expected_binding','inspection'];
      if(c.schema!==1||!/^fw-[a-f0-9]{32}$/.test(c.id)||!['status','prepare','start','reconnect','recover-link','readback','release'].includes(c.action)||Object.keys(c).some((k:string):boolean=>!allowed.includes(k)))return;
      if(this.read(c.id+'.json'))return;
      this.write(c.id+'.json',JSON.stringify({schema:1,id:c.id,state:'running',action:c.action,candidate_sha256:FIRMWARE_CANDIDATE_SHA}));
      let error='';try{
        if(!Number.isSafeInteger(c.expires_at)||Date.now()>=c.expires_at||c.expires_at>Date.now()+120000)throw new Error('OTA_COMMAND_EXPIRED');
        if(c.action!=='status'&&c.candidate_sha256!==FIRMWARE_CANDIDATE_SHA)throw new Error('OTA_CANDIDATE_MISMATCH');
        if(c.action==='prepare')await this.prepare(c.id);
        if(c.action==='start'){
          if(this.blocked||!this.idle()||!this.binding()||c.expected_binding!==this.binding()||this.journal.started)throw new Error('OTA_START_BINDING');
          if(probeSession.auth.snapshot().mtu<185)throw new Error('OTA_MTU_TOO_SMALL');
          this.session.check(this.owner(),this.connection(),Date.now());if(this.session.phase!=='ready'||Date.now()-this.session.freshAt>120000)throw new Error('OTA_PREFLIGHT_STALE');
          this.journal.started=true;this.journal.startedAt=Date.now();this.save(); // durable before any ambiguous Mode2 submission
          const action=this.session.start(this.owner(),this.connection(),Date.now());await this.transmit(action);this.save();
        }
        if(c.action==='readback'){
          if(this.blocked||!this.journal.started||Date.now()-Math.max(this.journal.startedAt,this.journal.installAt)<120000||this.owner()!==this.journal.owner||!probeSession.foreground)throw new Error('OTA_READBACK_NOT_READY');
          const action=this.session.readback(this.owner(),this.connection(),Date.now());this.save();await this.transmit(action);
        }
        if(c.action==='reconnect'){
          if(this.blocked||!this.journal.started||!this.journal.disconnectAt||probeSession.features.state.connected||!probeSession.foreground||Date.now()-Math.max(this.journal.startedAt,this.journal.installAt,this.journal.disconnectAt)<120000)throw new Error('OTA_RECONNECT_NOT_READY');
          await this.reconnectLink();
        }
        if(c.action==='recover-link'){
          // The explicit connection-only lease can scan and authenticate the
          // saved peer after a two-minute quiet period; it has no upper time
          // limit and never resends OTA data. Connection success retains the
          // unknown intent until fresh boot/idle readback and explicit release.
          if(this.blocked||!this.journal.started||this.session.phase!=='unknown'||this.journal.installAt!==0||this.journal.apCovered!==0||Date.now()-this.journal.startedAt<120000||!probeSession.foreground||
            c.expected_binding!==this.journal.operation||c.inspection!=='user_observed_setup_after_reported_transfer_failure'||probeSession.voice.active||probeSession.voice.pendingWrites||probeSession.recordingOccupied()||probeSession.lifelogOccupied()||probeSession.prompterOccupied()||
            (this.owner()!==''&&this.owner()!==this.journal.owner))throw new Error('OTA_RECOVER_LINK_NOT_READY');
          await this.reconnectLink();
        }
        if(c.action==='release'){
          if(this.blocked||this.session.phase!=='readback_ready'||Date.now()-this.session.freshAt>120000||c.expected_binding!==this.binding()||c.inspection!=='readback_verified_release_for_lens_check'||this.owner()!==this.journal.owner)throw new Error('OTA_RELEASE_REQUIRES_READBACK');
          // Releases transport after fresh boot/idle readback so the lens test can
          // run. This never asserts the patched timer or lens result succeeded.
          this.journal.started=false;this.session.phase='complete';this.save();this.unlock();for(const bytes of this.files.values())bytes.fill(0);this.files.clear();
        }
      }catch(e){error=/^[A-Z0-9_]{1,64}$/.test((e as Error).message)?(e as Error).message:'OTA_OPERATION_FAILED';if(this.journal.started&&this.session.phase!=='installing'&&this.session.phase!=='readback_ready')this.fail(error);}
      this.write(c.id+'.json',JSON.stringify({schema:1,id:c.id,state:error?'error':'complete',action:c.action,error,snapshot:this.snapshot()}));
    }catch(_){this.blocked=true;this.lock();}finally{this.polling=false;}
  }
  dispose():void{++this.generation;for(const b of this.queue)b.fill(0);this.queue=[];if(this.journal.started){this.session.fail('OTA_PROCESS_EXIT');try{this.save();}catch(_){}}else if(this.journal.operation)this.unlock();}
}
