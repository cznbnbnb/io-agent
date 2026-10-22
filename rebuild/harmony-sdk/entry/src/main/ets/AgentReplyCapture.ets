import { common } from '@kit.AbilityKit';
import { fileIo as fs } from '@kit.CoreFileKit';
import { util } from '@kit.ArkTS';
import { cryptoFramework } from '@kit.CryptoArchitectureKit';
import * as audio from 'libturbo_audio.so';
import { businessEnvelope,readLauncherEnvelope,recorder } from 'turbo_core';
import { LocalFollowASR } from './LocalFollowASR';
import { PrompterModelStore } from './PrompterModel';

class CaptureJournal {schema:number=3;cleanup_peer:string='';binding:string='';text:string='';draft_valid:boolean=false;exit_evidence:string='none';transcript_status:string='none';}
export class AgentCaptureState {
  phase:string='idle';note:string='独立收音尚未开始';binding:string='';text:string='';
  packets:number=0;pcmBytes:number=0;nonzeroPackets:number=0;exitObserved:boolean=false;stopSubmitted:boolean=false;
  savedDraftValid:boolean=false;
  recorderStop:string='not_attempted';exitWrite:string='not_attempted';workerExited:boolean=true;
  lateAudioPackets:number=0;lastLateAudioAt:number=0;exitReason:number=-1;exitEvidence:string='none';
  tailPackets:number=0;tailPcmBytes:number=0;inputSealed:boolean=true;tailTimedOut:boolean=false;
  compressedPackets:number=0;compressedBytes:number=0;repeatedCompressedPackets:number=0;lastCompressedSha256:string='';
  firstAudioAt:number=0;lastAudioAt:number=0;stopRequestedAt:number=0;inputSealedAt:number=0;pcmRms:number=0;pcmPeak:number=0;
  type1Packets:number=0;firstType1At:number=0;micWriteStartedAt:number=0;micWriteCompletedAt:number=0;
  firstDecodedCompressedBytes:number=0;firstDecodedSamples:number=0;
  transcriptStatus:string='none';boundaryEvidence:string='none';observationRestored:boolean=false;
  step:string='idle';
}
// Capture-only prerequisite for Agent answers. No model chat, task submission,
// materials discovery or microphone restart is reachable from this component.
export class AgentReplyCapture {
  state:AgentCaptureState=new AgentCaptureState();changed:()=>void=():void=>{};
  beforeMic:()=>Promise<void>=async():Promise<void>=>{};
  onReleased:()=>void=():void=>{};
  observeSource:(peer:string,epoch:number,business:number,payload:Uint8Array)=>void=():void=>{};
  private sender:(business:number,bytes:Uint8Array)=>Promise<void>;private device:()=>string;private available:()=>boolean;
  private epoch:()=>number;private sourceEpoch:number=0;private sourceFault:boolean=false;
  private type1Epoch:number=0;
  private models:PrompterModelStore=new PrompterModelStore();private asr:LocalFollowASR=new LocalFollowASR();
  private journal:string='';private cleanupPeer:string='';private peer:string='';private generation:number=0;
  private segments:Map<number,string>=new Map();private firstTimer:number=-1;private totalTimer:number=-1;private exitTimer:number=-1;private quietTimer:number=-1;
  private wireTail:Promise<void>=Promise.resolve();private closing:Promise<void>|undefined=undefined;
  private textFinished:boolean=false;private workerExited:boolean=true;private cancelled:boolean=false;private closeFailed:boolean=false;
  private commandsFinished:boolean=true;
  private tailOpen:boolean=false;private tailDeadline:number=0;
  private stopWritesAt:number=0;private incomplete:boolean=false;private pcmSquares:number=0;private pcmSamples:number=0;
  private boundaryResolve:(()=>void)|undefined=undefined;
  private waiters:((confirmed:boolean)=>void)[]=[];
  constructor(sender:(business:number,bytes:Uint8Array)=>Promise<void>,device:()=>string,available:()=>boolean,epoch:()=>number=():number=>0){
    this.sender=sender;this.device=device;this.available=available;this.epoch=epoch;
  }
  get active():boolean{return ['preparing','starting','listening','stopping','cleanup_pending'].includes(this.state.phase);}
  get observationPeer():string{return this.peer||this.cleanupPeer;}
  get observationGeneration():number{return this.generation;}
  initialize(context:common.UIAbilityContext):void{
    this.models.initialize(context);this.journal=context.filesDir+'/agent-reply-capture.json';
    try{
      // An interrupted atomic replacement may contain a later invalidation.
      // Preserve both records rather than trusting an older complete result.
      if(fs.accessSync(this.journal+'.partial'))throw new Error('JOURNAL_PARTIAL');
      if(!fs.accessSync(this.journal))return;
      if(fs.statSync(this.journal).size>32768)throw new Error('JOURNAL_SIZE');
      const saved=JSON.parse(fs.readTextSync(this.journal)) as CaptureJournal;
      if(![1,2,3].includes(saved.schema)||Object.keys(saved).length!==(saved.schema===1?5:saved.schema===2?6:7)||typeof saved.draft_valid!=='boolean'||typeof saved.cleanup_peer!=='string'||saved.cleanup_peer.length>256||
        typeof saved.binding!=='string'||saved.binding.length>2048||typeof saved.text!=='string'||saved.text.length>4000)throw new Error('JOURNAL_INVALID');
      const evidence=saved.schema===1?(saved.cleanup_peer?'none':'legacy_record'):saved.exit_evidence;
      const transcript=saved.schema===3?saved.transcript_status:'legacy';
      if(!['none','pending','complete','partial','cancelled','legacy'].includes(transcript)||
        !['none','device_event','user_confirmation','legacy_record'].includes(evidence)||saved.cleanup_peer&&evidence!=='none'||
        saved.draft_valid&&!(transcript==='complete'?['device_event','user_confirmation'].includes(evidence):transcript==='legacy'&&['device_event','legacy_record'].includes(evidence))||
        transcript==='complete'&&(!saved.binding||!saved.text.trim()||!saved.cleanup_peer&&!saved.draft_valid))throw new Error('JOURNAL_EVIDENCE');
      this.cleanupPeer=saved.cleanup_peer;this.state.binding=saved.binding;this.state.text=saved.text;
      this.state.savedDraftValid=saved.draft_valid;this.state.exitEvidence=evidence;this.state.transcriptStatus=transcript;this.state.observationRestored=true;
      if(this.cleanupPeer){
        this.peer=this.cleanupPeer;this.cancelled=transcript==='cancelled';this.incomplete=transcript!=='complete';this.textFinished=true;
        this.state.phase='cleanup_pending';this.state.note='上次收音停止未确认，请连接原眼镜清理；不会自动开麦';
      }
      else if(saved.text){this.state.phase=saved.draft_valid?'draft':'failed';this.state.note=saved.draft_valid?'保留了上次转写草稿，未发送给Agent':'上次不完整文字保留，不作为可提交回答';}
    }catch(_){this.state.phase='blocked';this.state.note='收音记录不可读，保留原件并禁止新收音';}
  }
  private notify():void{try{this.changed();}catch(_) {}}
  private persist():void{
    if(!this.journal)throw new Error('CAPTURE_NOT_INITIALIZED');
    const value=new CaptureJournal();value.cleanup_peer=this.cleanupPeer;value.binding=this.state.binding;value.text=this.state.text;value.draft_valid=this.state.savedDraftValid;value.exit_evidence=this.cleanupPeer?'none':this.state.exitEvidence;value.transcript_status=this.state.transcriptStatus;
    const bytes=new util.TextEncoder().encodeInto(JSON.stringify(value));
    try{
      if(bytes.length>32768)throw new Error('CAPTURE_JOURNAL_SIZE');
      const file=fs.openSync(this.journal+'.partial',fs.OpenMode.CREATE|fs.OpenMode.WRITE_ONLY|fs.OpenMode.TRUNC);
      try{let offset=0;while(offset<bytes.length){const part=bytes.slice(offset);try{const n=fs.writeSync(file.fd,part.buffer);if(!Number.isSafeInteger(n)||n<1||n>part.length)throw new Error('CAPTURE_WRITE');offset+=n;}finally{part.fill(0);}}fs.fsyncSync(file.fd);}
      finally{fs.closeSync(file);}
      fs.renameSync(this.journal+'.partial',this.journal);
    }finally{bytes.fill(0);}
  }
  private clearTimers():void{
    if(this.firstTimer!==-1)clearTimeout(this.firstTimer);if(this.totalTimer!==-1)clearTimeout(this.totalTimer);if(this.exitTimer!==-1)clearTimeout(this.exitTimer);
    if(this.quietTimer!==-1)clearTimeout(this.quietTimer);
    this.firstTimer=-1;this.totalTimer=-1;this.exitTimer=-1;this.quietTimer=-1;
  }
  private releaseBoundary():void{
    if(this.exitTimer!==-1)clearTimeout(this.exitTimer);this.exitTimer=-1;
    if(this.quietTimer!==-1)clearTimeout(this.quietTimer);this.quietTimer=-1;
    const resolve=this.boundaryResolve;this.boundaryResolve=undefined;resolve?.();
  }
  private boundaryReady():void{
    if(!this.boundaryResolve||!this.commandsFinished)return;
    if(this.cancelled||this.state.exitEvidence==='device_event'){
      this.state.boundaryEvidence=this.cancelled?'cancelled':'device_event';this.tailOpen=false;this.releaseBoundary();return;
    }
    if(!this.state.stopSubmitted||this.state.inputSealed||Date.now()>=this.tailDeadline)return;
    const remaining=300-(Date.now()-Math.max(this.stopWritesAt,this.state.lastAudioAt,this.state.stopRequestedAt));
    if(this.quietTimer!==-1)clearTimeout(this.quietTimer);this.quietTimer=-1;
    if(remaining<=0){this.state.boundaryEvidence='quiet_after_stop';this.tailOpen=false;this.releaseBoundary();}
    else{const generation=this.generation;this.quietTimer=setTimeout(():void=>{if(generation===this.generation)this.boundaryReady();},Math.min(remaining,this.tailDeadline-Date.now()));}
  }
  private partial():void{this.incomplete=true;this.state.savedDraftValid=false;if(!this.cancelled&&this.state.transcriptStatus!=='legacy')this.state.transcriptStatus='partial';}
  private compressed(bytes:Uint8Array):void{
    const md=cryptoFramework.createMd('SHA256');md.updateSync({data:bytes});const hash=md.digestSync().data;
    try{const value=Array.from(hash).map((n:number):string=>n.toString(16).padStart(2,'0')).join('');
      if(value===this.state.lastCompressedSha256)this.state.repeatedCompressedPackets++;
      this.state.lastCompressedSha256=value;
    }finally{hash.fill(0);}
    this.state.compressedPackets++;this.state.compressedBytes+=bytes.length;
    const now=Date.now();if(this.state.compressedPackets===1)this.state.firstAudioAt=now;this.state.lastAudioAt=now;
  }
  private metricEpochMatches(epoch:number):boolean{
    try{return Number.isSafeInteger(epoch)&&epoch>0&&epoch===this.epoch();}catch(_){return false;}
  }
  private write(type:number,json:string,generation:number,guard:(()=>Promise<void>)|undefined=undefined,observeMicStart:boolean=false):Promise<void>{
    const job=this.wireTail.then(async():Promise<void>=>{
      if(generation!==this.generation||!this.peer||this.peer!==this.device())throw new Error('CAPTURE_PEER_CHANGED');
      if(guard){
        await guard();
        if(generation!==this.generation||this.peer!==this.device()||!this.available()||this.cancelled||this.state.phase!=='starting')throw new Error('CAPTURE_CANCELLED');
      }
      const bytes=businessEnvelope(type,new util.TextEncoder().encodeInto(json));
      // These timestamps attest only this sender invocation and its Promise,
      // never microphone activation or a firmware acknowledgement.
      const observed=this.state,sourceEpoch=this.sourceEpoch;
      const measure=observeMicStart&&!observed.observationRestored&&this.metricEpochMatches(sourceEpoch);
      if(measure)observed.micWriteStartedAt=Date.now();
      try{await this.sender(13,bytes);
        try{if(measure&&generation===this.generation&&observed===this.state&&this.peer===this.device()&&sourceEpoch===this.sourceEpoch&&this.metricEpochMatches(sourceEpoch))observed.micWriteCompletedAt=Date.now();}catch(_){/* Observation failure cannot fail an otherwise completed write. */}
      }finally{bytes.fill(0);}
    });this.wireTail=job.catch(()=>{});return job;
  }
  async start(binding:string,seconds:number=15,guard:()=>Promise<void>=async():Promise<void>=>{}):Promise<void>{
    if(this.active||this.state.phase==='blocked'||this.state.text)throw new Error('请先处理上次收音或草稿');
    if(!this.journal||!this.device()||!this.available())throw new Error('请保持前台连接，并结束其他采集、显示或识别');
    if(typeof binding!=='string'||!binding||binding.length>2048||!Number.isInteger(seconds)||seconds<3||seconds>30)throw new Error('收音参数不正确');
    const generation=++this.generation;this.peer=this.device();this.sourceEpoch=0;this.type1Epoch=0;this.sourceFault=false;this.cancelled=false;this.incomplete=false;this.closeFailed=false;this.textFinished=false;this.workerExited=false;this.commandsFinished=false;
    this.state=new AgentCaptureState();this.state.inputSealed=false;this.tailOpen=false;this.tailDeadline=0;
    this.stopWritesAt=0;this.pcmSquares=0;this.pcmSamples=0;this.state.transcriptStatus='pending';
    this.state.workerExited=false;this.state.binding=binding;this.state.phase='preparing';this.state.note='正在准备本机转写；尚未开麦';this.segments.clear();this.notify();
    try{
      this.state.step='model_files';const directory=await this.models.ensure();if(generation!==this.generation)throw new Error('CAPTURE_CANCELLED');
      this.state.step='model_load';await this.asr.prepare(directory);if(generation!==this.generation)throw new Error('CAPTURE_CANCELLED');
      this.asr.onText=(text:string,_final:boolean,id:number):void=>{
        if(generation!==this.generation||!['starting','listening','stopping'].includes(this.state.phase))return;
        if(!Number.isSafeInteger(id)||id<1||id>64||typeof text!=='string'||text.length>4000){
          this.partial();this.state.note='识别结果超出完整保存范围，停止并保留已有片段；不作为完整答案';void this.stop(false);return;
        }
        if(!text.trim())return;
        this.segments.set(id,text.trim());const joined=Array.from(this.segments.keys()).sort((a:number,b:number):number=>a-b).map((key:number):string=>this.segments.get(key)||'').join('，');
        if(joined.length>4000){this.partial();void this.stop(false);return;}this.state.text=joined;this.notify();
      };
      this.asr.onError=():void=>{if(generation===this.generation){this.partial();this.state.note='本机识别失败，正在停止收音；未发送答案';void this.stop(false);}};
      this.state.step='stream_start';await this.asr.begin();this.state.step='voice_drain';await this.beforeMic();if(generation!==this.generation||!this.available())throw new Error('CAPTURE_CANCELLED');
      this.state.step='request_guard';await guard();if(generation!==this.generation||!this.available())throw new Error('CAPTURE_CANCELLED');
      this.state.step='decoder_reset';audio.reset();this.state.step='intent_store';const sourceEpoch=this.epoch();this.sourceEpoch=Number.isSafeInteger(sourceEpoch)&&sourceEpoch>0?sourceEpoch:0;
      if(this.type1Epoch!==this.sourceEpoch){this.type1Epoch=0;this.state.type1Packets=0;this.state.firstType1At=0;}
      this.cleanupPeer=this.peer;try{this.persist();}catch(_){this.cleanupPeer='';throw new Error('CAPTURE_INTENT_STORE');} // before ambiguous recorder(true)
      this.state.phase='starting';this.state.note='收音开关正在提交；等待实际音频';this.notify();
      // Recheck at the actual serialized write, after any older wire work.
      this.state.step='mic_write';await this.write(2,recorder(true),generation,guard,true);
      if(generation!==this.generation||this.state.phase!=='starting')return;
      this.state.phase='listening';this.state.note='短时收音中；只生成本机草稿，不调用问答模型';
      this.firstTimer=setTimeout(():void=>{if(generation===this.generation&&!this.state.packets){this.state.note='6秒未收到眼镜音频，正在停止；未伪造转写';void this.stop(true);}},6000);
      this.totalTimer=setTimeout(():void=>{if(generation===this.generation)void this.stop(false);},seconds*1000);this.notify();
    }catch(_){
      if(generation!==this.generation)return;
      if(this.cleanupPeer){this.state.note='收音启动未确认，正在提交停止；不会重试开麦';await this.stop(true);}
      else{this.asr.close();await this.asr.waitForExit();if(generation!==this.generation)return;this.workerExited=true;this.state.workerExited=true;this.state.phase='failed';this.state.note='本机准备失败，未开启收音';this.notify();this.release(false);}
    }
  }
  sourceOrigin(token:string,text:string):number{
    if(this.sourceFault||this.state.observationRestored||this.state.phase!=='draft'||!this.state.savedDraftValid||this.state.transcriptStatus!=='complete'||
      !['device_event','user_confirmation'].includes(this.state.exitEvidence)||!this.workerExited||!this.state.workerExited||!this.commandsFinished||!this.textFinished||
      !this.state.inputSealed||this.cleanupPeer||this.closeFailed||token!==this.state.binding||text!==this.state.text||!text.trim()||
      !this.peer||this.peer!==this.device()||this.sourceEpoch<1||this.sourceEpoch!==this.epoch())throw new Error('CAPTURE_SOURCE_UNAVAILABLE');
    return this.sourceEpoch;
  }
  receive(peer:string,business:number,payload:Uint8Array,epoch:number=0):boolean{
    // Source invalidation must still observe traffic after the local copy was
    // cleared. Its failure protects this source without consuming normal audio.
    try{this.observeSource(peer,epoch,business,payload);}catch(_){this.sourceFault=true;}
    const retainedLive=this.state.phase==='draft'&&this.state.transcriptStatus==='complete'&&!this.state.observationRestored;
    if(!this.active&&!retainedLive||business!==13||peer!==this.peer||peer!==this.device()||this.sourceEpoch>0&&epoch!==this.sourceEpoch)return false;
    try{
      const packet=readLauncherEnvelope(payload);
      try{
        // A type1 event has no physical gesture/source attribution. Observe it
        // without changing routing, deadlines, consent or capture state.
        if(packet.type===1&&this.active&&!this.cancelled&&this.state.phase!=='cleanup_pending'&&!this.state.observationRestored&&this.metricEpochMatches(epoch)){
          if(this.type1Epoch!==epoch){this.type1Epoch=epoch;this.state.type1Packets=0;this.state.firstType1At=0;}
          if(this.state.type1Packets===0)this.state.firstType1At=Date.now();
          this.state.type1Packets++;
        }
        // A late packet can arrive while the original task revalidation awaits.
        // Invalidate the retained result before that complete-text CAS can pass.
        // Forward inactive traffic to the normal assistant after observation.
        if(!this.active){
          if(packet.type===3){this.partial();this.state.phase='failed';this.state.lateAudioPackets++;this.state.lastLateAudioAt=Date.now();
            try{this.persist();}catch(_){this.closeFailed=true;}this.notify();}
          return false;
        }
        if(packet.type===8){
          if(packet.json.length>256||!packet.json.length)throw new Error('EXIT_SIZE');
          const body=JSON.parse(new util.TextDecoder('utf-8',{fatal:true}).decodeToString(packet.json)) as Record<string,Object>;
          const reason=body['rc'];if(typeof reason!=='number'||!Number.isInteger(reason)||reason<1||reason>15)throw new Error('EXIT_REASON');
          this.state.exitReason=reason;
          if(this.state.phase==='preparing'){void this.stop(true);return true;}
          if(this.state.phase==='stopping'||this.state.phase==='cleanup_pending'){this.state.exitObserved=true;this.state.exitEvidence='device_event';this.boundaryReady();void this.tryComplete();}
          else if(['starting','listening'].includes(this.state.phase)){this.partial();this.state.exitObserved=true;this.state.exitEvidence='device_event';void this.stop(false);}return true;
        }
        const tail=packet.type===3&&this.state.phase==='stopping'&&this.tailOpen&&!this.state.inputSealed&&
          !this.cancelled&&Date.now()<this.tailDeadline;
        if(packet.type===3&&['stopping','cleanup_pending'].includes(this.state.phase)&&!tail){
          this.partial();this.state.lateAudioPackets++;this.state.lastLateAudioAt=Date.now();
          try{this.persist();}catch(_){this.closeFailed=true;}this.notify();return true;
        }
        if(packet.type!==3||!tail&&!['starting','listening'].includes(this.state.phase))return true;
        if(!packet.binary.length||packet.binary.length>4096)throw new Error('AUDIO_SIZE');
        this.compressed(packet.binary);
        const pcm=new Uint8Array(audio.decode(packet.binary.buffer));
        try{if(!pcm.length||pcm.length>4096||pcm.length%2)throw new Error('PCM_INVALID');
          if(this.state.firstDecodedSamples===0){this.state.firstDecodedCompressedBytes=packet.binary.length;this.state.firstDecodedSamples=pcm.length/2;}
          if(tail&&this.state.tailPcmBytes+pcm.length>128000){
            this.partial();this.tailOpen=false;this.state.boundaryEvidence='limit';this.state.note='停止尾音超过4秒上限；保留片段，不作为完整答案';this.releaseBoundary();return true;
          }
          this.state.packets++;this.state.pcmBytes+=pcm.length;if(pcm.some((value:number):boolean=>value!==0))this.state.nonzeroPackets++;
          if(tail){this.state.tailPackets++;this.state.tailPcmBytes+=pcm.length;}
          const samples=new DataView(pcm.buffer,pcm.byteOffset,pcm.byteLength);
          for(let offset=0;offset<pcm.length;offset+=2){const sample=samples.getInt16(offset,true);this.pcmSquares+=sample*sample;this.pcmSamples++;this.state.pcmPeak=Math.max(this.state.pcmPeak,Math.abs(sample));}
          this.state.pcmRms=Math.sqrt(this.pcmSquares/this.pcmSamples);
          if(tail)this.boundaryReady();
          this.asr.append(pcm);if(this.state.packets===1||this.state.packets%50===0)this.notify();
        }finally{pcm.fill(0);}
      }finally{packet.binary.fill(0);packet.json.fill(0);}
    }catch(_){
      this.partial();this.state.note='音频解码或消息异常，保留已有文字；未发送答案';
      if(this.active)void this.stop(false);
      else{this.state.phase='failed';try{this.persist();}catch(_){this.closeFailed=true;}this.notify();}
    }
    return true;
  }
  stop(cancelled:boolean=false):Promise<void>{
    if(!this.active)return this.closing||Promise.resolve();
    // Cancellation must remain sticky even while the shared close is draining.
    this.cancelled=this.cancelled||cancelled;if(this.cancelled){
      this.tailOpen=false;this.state.transcriptStatus='cancelled';this.state.savedDraftValid=false;
      if(this.cleanupPeer){try{this.persist();}catch(_){this.closeFailed=true;}}
    }
    if(this.closing){this.boundaryReady();return this.closing;}
    if(!this.active)return Promise.resolve();this.clearTimers();
    if(this.state.phase==='cleanup_pending')return this.cleanup();
    if(!this.cleanupPeer){
      const generation=++this.generation;this.state.inputSealed=true;this.asr.close();this.state.phase='stopping';
      const job=this.asr.waitForExit().then(():void=>{if(generation!==this.generation)return;this.workerExited=true;this.state.workerExited=true;this.state.phase='idle';this.state.note='准备已取消，未开麦';this.notify();this.release(true);});
      const closing:Promise<void>=job.finally(():void=>{if(this.closing===closing)this.closing=undefined;});this.closing=closing;return closing;
    }
    const generation=this.generation;this.tailOpen=!this.cancelled&&!this.state.inputSealed;this.tailDeadline=Date.now()+4000;
    this.state.stopRequestedAt=Date.now();
    this.commandsFinished=false;this.textFinished=false;this.workerExited=false;this.state.workerExited=false;
    this.state.phase='stopping';this.state.note='正在停止眼镜收音并接收有界尾音；尚未提交答案';
    // Install the shared closing promise before finishInput can synchronously
    // report an error through onError and re-enter stop().
    const job=Promise.resolve().then(():Promise<void>=>this.finish(generation));
    const closing:Promise<void>=job.finally(():void=>{if(this.closing===closing)this.closing=undefined;});this.closing=closing;this.notify();return closing;
  }
  private async finishCommands(generation:number):Promise<void>{
    // Exit is attempted independently even if stop-recorder failed. A resolved
    // transport write is shown as submitted, never as device confirmation.
    this.commandsFinished=false;
    this.state.recorderStop='pending';this.notify();
    try{await this.write(2,recorder(false),generation);if(generation===this.generation)this.state.recorderStop='submitted';}
    catch(_){if(generation===this.generation)this.state.recorderStop='failed';}
    if(generation!==this.generation)return;
    this.state.exitWrite='pending';this.notify();
    try{await this.write(7,'{"rc":1}',generation);if(generation===this.generation)this.state.exitWrite='submitted';}
    catch(_){if(generation===this.generation)this.state.exitWrite='failed';}
    if(generation===this.generation){
      this.commandsFinished=true;this.state.stopSubmitted=this.state.recorderStop==='submitted'&&this.state.exitWrite==='submitted';
      this.stopWritesAt=Date.now();
      this.boundaryReady();this.notify();void this.tryComplete();
    }
  }
  private async finish(generation:number):Promise<void>{
    if(generation!==this.generation)return;
    const boundary=new Promise<void>((resolve:()=>void):void=>{
      this.boundaryResolve=resolve;
      this.exitTimer=setTimeout(():void=>{
        if(generation!==this.generation)return;
        this.state.tailTimedOut=true;this.partial();this.state.boundaryEvidence=this.cancelled?'cancelled':'limit';this.tailOpen=false;this.releaseBoundary();
      },Math.max(1,this.tailDeadline-Date.now()));
    });
    // A type8 may arrive synchronously inside either write. Install the waiter
    // first. A bounded quiet interval can seal local input, never prove exit.
    void this.finishCommands(generation);
    await boundary;if(generation!==this.generation)return;
    this.tailOpen=false;this.state.inputSealed=true;this.state.inputSealedAt=Date.now();
    try{await this.asr.finishInput();}catch(_){if(generation===this.generation)this.partial();}
    if(generation!==this.generation)return;
    try{this.asr.close();await this.asr.waitForExit();}catch(_){
      if(generation!==this.generation)return;
      this.partial();this.state.phase='cleanup_pending';this.state.note='识别线程退出未确认，片段保留；禁止新收音或发送答案';
      try{this.persist();}catch(_){this.closeFailed=true;}this.notify();this.release(false);return;
    }
    if(generation!==this.generation)return;
    this.workerExited=true;this.state.workerExited=true;
    this.state.transcriptStatus=this.cancelled?'cancelled':this.incomplete?'partial':
      this.state.stopSubmitted&&['device_event','quiet_after_stop'].includes(this.state.boundaryEvidence)&&!!this.state.text.trim()&&this.state.nonzeroPackets>0?'complete':'partial';
    try{this.persist();}catch(_){this.closeFailed=true;}
    this.textFinished=true;
    await this.tryComplete();
    if(generation!==this.generation)return;
    if(this.cleanupPeer){this.state.phase='cleanup_pending';this.state.note=this.state.transcriptStatus==='complete'?'本机已收到的音频已完整转写保留；眼镜退出仍未确认，禁止新收音或发送答案':'停止或退出未确认，不完整片段保留；禁止新收音，未提交答案';this.notify();this.release(false);}
  }
  private async tryComplete():Promise<void>{
    if(!this.textFinished||!this.workerExited||!this.commandsFinished||!['device_event','user_confirmation'].includes(this.state.exitEvidence)||this.closeFailed||!this.cleanupPeer)return;
    const old=this.cleanupPeer;this.cleanupPeer='';this.state.savedDraftValid=this.state.transcriptStatus==='complete'&&!!this.state.text.trim()&&!this.cancelled&&!this.incomplete;
    try{this.persist();}catch(_){this.cleanupPeer=old;this.state.savedDraftValid=false;this.closeFailed=true;return;}
    this.clearTimers();try{audio.close();}catch(_){}
    this.state.phase=this.state.savedDraftValid?'draft':'failed';
    this.state.note=this.state.exitEvidence==='user_confirmation'?'用户已确认镜片退出（非设备回执）；占用已解除，未提交答案':this.state.phase==='draft'?'完整转写草稿已保存；未交给Agent，仍需确认':'本轮未形成可用回答；收音退出已观察，未发送答案';
    this.notify();this.release(true);
  }
  stopAndWait():Promise<boolean>{
    if(!this.active)return Promise.resolve(true);
    return new Promise<boolean>((resolve:(confirmed:boolean)=>void):void=>{this.waiters.push(resolve);void this.stop(true);});
  }
  private release(confirmed:boolean):void{const pending=this.waiters.splice(0);for(const resolve of pending)resolve(confirmed);if(!this.active)this.onReleased();}
  async cleanup():Promise<void>{
    if(this.state.phase!=='cleanup_pending'||!this.cleanupPeer||this.cleanupPeer!==this.device()||this.closing||!this.commandsFinished||!this.workerExited)throw new Error('请连接原眼镜，并等待原停止写入和识别线程结束后再清理');
    const generation=++this.generation;
    this.peer=this.cleanupPeer;this.closeFailed=false;this.state.exitObserved=false;this.state.stopSubmitted=false;this.state.exitEvidence='none';
    try{this.persist();}catch(_){this.closeFailed=true;throw new Error('清理意图未保存，保留原收音记录');}
    // Local input is already sealed and its Worker exited. Retry only the two
    // stop writes; do not reopen ASR or invalidate a complete retained result.
    const job=Promise.resolve().then(async():Promise<void>=>{
      await this.finishCommands(generation);if(generation!==this.generation)return;
      await this.tryComplete();if(this.cleanupPeer){this.state.phase='cleanup_pending';this.notify();this.release(false);}
    });
    const closing:Promise<void>=job.finally(():void=>{if(this.closing===closing)this.closing=undefined;});this.closing=closing;await closing;
  }
  async confirmExitByUser(binding:string):Promise<void>{
    if(this.state.phase!=='cleanup_pending'||this.closing||!this.cleanupPeer||this.cleanupPeer!==this.device()||binding!==this.state.binding||
      !this.state.stopSubmitted||!this.commandsFinished||!this.workerExited||!this.textFinished||this.closeFailed||
      this.state.lastLateAudioAt>0&&Date.now()-this.state.lastLateAudioAt<2000)throw new Error('请先清理收音，并确认原眼镜已退出且无收音提示');
    this.state.exitEvidence='user_confirmation';await this.tryComplete();
    if(this.active)throw new Error('退出确认保存失败，清理记录保留');
  }
  clearDraft():void{
    if(this.active||this.state.phase==='blocked')throw new Error('停止未确认，不能清空收音记录');
    const prior=this.state;this.state=new AgentCaptureState();
    try{this.persist();}catch(error){this.state=prior;throw new Error('收音副本清理未保存，请保留并重试');}
    this.segments.clear();this.notify();
  }
  disconnected():void{
    this.sourceEpoch=0;
    const generation=++this.generation;this.tailOpen=false;this.state.inputSealed=true;this.releaseBoundary();this.clearTimers();this.asr.close();this.closing=undefined;try{audio.close();}catch(_){}
    if(this.cleanupPeer&&!this.textFinished)this.partial();this.peer=this.cleanupPeer;this.state.phase=this.cleanupPeer?'cleanup_pending':this.state.text?(this.state.savedDraftValid?'draft':'failed'):'idle';
    this.state.note='连接变化，旧收音回调失效；未自动开麦或发送草稿';try{this.persist();}catch(_){this.state.phase='blocked';}
    this.notify();this.release(false);
    if(this.cleanupPeer){
      this.workerExited=false;this.state.workerExited=false;this.textFinished=false;this.commandsFinished=false;
      void Promise.all([this.asr.waitForExit(),this.wireTail]).then(():void=>{
        if(generation!==this.generation)return;this.workerExited=true;this.state.workerExited=true;this.textFinished=true;this.commandsFinished=true;this.notify();void this.tryComplete();
      });
    }
  }
}
