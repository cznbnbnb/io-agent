import { TaskDecisionDraft,TaskReplyBinding,taskReplyBindingValid,taskSameReplyBinding } from './TaskReplyDraft';
import { TaskVoiceSourceRef,taskSameVoiceSource } from './TaskVoiceSourceRef';

export class TaskVoiceCaptureState {
  active:boolean=false;phase:string='idle';binding:string='';text:string='';valid:boolean=false;exitEvidence:string='none';transcriptStatus:string='none';
}
class VoiceBinding {
  format:string='turboio-task-voice/1';attempt_id:string='';peer:string='';reply:TaskReplyBinding=new TaskReplyBinding();
}
export interface TaskVoiceReplyPorts {
  state:()=>TaskVoiceCaptureState;start:(binding:string,guard:()=>Promise<void>)=>Promise<void>;
  stop:(cancelled:boolean)=>Promise<void>;clear:()=>void;cleanup:()=>Promise<void>;
  device:()=>string;context:()=>string;foreground:()=>boolean;cardReleased:()=>boolean;
  validate:(binding:TaskReplyBinding)=>void;revalidate:(binding:TaskReplyBinding)=>Promise<void>;nonce:()=>string;
  source:(token:string,text:string,recover:boolean)=>TaskVoiceSourceRef;
}
// Bridges a fresh second-card consent to capture-only ASR. No answer enqueue,
// model chat or task cancellation is reachable. The capture journal carries
// the full original binding and attempt ID before its microphone write.
export class TaskVoiceReplySession {
  note:string='口述尚未开始';changed:()=>void=():void=>{};
  onDraftSaved:(binding:TaskReplyBinding)=>void=(_binding:TaskReplyBinding):void=>{};
  private draft:TaskDecisionDraft;private ports:TaskVoiceReplyPorts;
  private token:string='';private binding:TaskReplyBinding|undefined=undefined;
  private generation:number=0;private publishing:boolean=false;private timer:number=-1;
  constructor(draft:TaskDecisionDraft,ports:TaskVoiceReplyPorts){this.draft=draft;this.ports=ports;}
  private notify():void{try{this.changed();}catch{}}
  private clearTimer():void{if(this.timer!==-1)clearTimeout(this.timer);this.timer=-1;}
  private unpack(token:string):VoiceBinding|undefined{
    try{
      if(typeof token!=='string'||!token||token.length>2048)return undefined;
      const value=JSON.parse(token) as VoiceBinding;
      if(!value||Object.keys(value).length!==4||value.format!=='turboio-task-voice/1'||
        typeof value.attempt_id!=='string'||!/^voice-[0-9a-f]{32}$/.test(value.attempt_id)||
        typeof value.peer!=='string'||!value.peer||value.peer.length>256||!taskReplyBindingValid(value.reply))return undefined;
      return value;
    }catch{return undefined;}
  }
  private owned(state:TaskVoiceCaptureState):boolean{
    const value=this.unpack(state.binding),record=this.draft.snapshot();
    return !!value&&!!record&&taskSameReplyBinding(value.reply,record.binding);
  }
  private completeCapture(state:TaskVoiceCaptureState):boolean{
    return !state.active&&state.phase==='draft'&&state.valid&&state.transcriptStatus==='complete'&&
      ['device_event','user_confirmation'].includes(state.exitEvidence)&&!!state.text.trim();
  }
  get active():boolean{return !!this.token||this.owned(this.ports.state())&&this.ports.state().active;}
  get canRecover():boolean{
    const state=this.ports.state(),record=this.draft.snapshot();
    return !this.draft.blocked&&!this.token&&!this.publishing&&this.completeCapture(state)&&
      this.owned(state)&&!!record&&record.stage==='voice_authorized'&&!record.cleanup_uid&&Date.parse(record.binding.expires_at)>Date.now();
  }
  get canDiscardIncomplete():boolean{
    const state=this.ports.state();return !this.token&&!state.active&&!state.valid&&state.phase==='failed'&&this.owned(state);
  }
  get cleanupPending():boolean{const state=this.ports.state();return state.phase==='cleanup_pending'&&this.owned(state);}
  get canClearCopied():boolean{
    const state=this.ports.state(),record=this.draft.snapshot();
    return !this.draft.blocked&&!this.token&&this.completeCapture(state)&&this.owned(state)&&!!record&&
      ['review','sealed','queued'].includes(record.stage)&&record.input_source==='voice'&&record.text===state.text;
  }
  get canDiscardRetained():boolean{
    const state=this.ports.state();return !this.draft.blocked&&!this.token&&!this.publishing&&!state.active&&state.phase==='draft'&&(state.valid||state.transcriptStatus==='legacy')&&
      !!state.text.trim()&&this.owned(state)&&!this.canClearCopied;
  }
  get retainedText():string{const state=this.ports.state();return this.owned(state)?state.text:'';}
  private check(generation:number,token:string,binding:TaskReplyBinding):void{
    const record=this.draft.snapshot(),value=this.unpack(token);
    if(this.draft.blocked||generation!==this.generation||this.token!==token||!value||value.peer!==this.ports.device()||!this.ports.foreground()||
      !this.ports.cardReleased()||this.ports.context()!==binding.context_key||this.draft.paused||!record||
      !taskSameReplyBinding(record.binding,binding)||record.stage!=='voice_authorized'||record.cleanup_uid||Date.parse(binding.expires_at)<=Date.now())throw new Error('TASK_VOICE_CONTEXT_CHANGED');
    this.ports.validate(binding);
  }
  async begin(binding:TaskReplyBinding):Promise<void>{
    const state=this.ports.state(),record=this.draft.snapshot();
    if(this.draft.blocked||this.token||state.active||state.text||!record||!taskSameReplyBinding(record.binding,binding)||this.draft.paused||
      record.stage!=='voice_authorized'||record.cleanup_uid||!this.ports.device()||!this.ports.foreground()||!this.ports.cardReleased())throw new Error('TASK_VOICE_NOT_READY');
    const value=new VoiceBinding();value.reply=JSON.parse(JSON.stringify(binding)) as TaskReplyBinding;
    value.peer=this.ports.device();value.attempt_id=this.ports.nonce();const token=JSON.stringify(value);
    if(!this.unpack(token))throw new Error('TASK_VOICE_BINDING_TOO_LARGE');
    const generation=++this.generation;this.token=token;this.binding=value.reply;
    try{
      this.check(generation,token,value.reply);this.note='正在为原问题准备短时口述；尚未提交答案';this.notify();
      this.timer=setTimeout(()=>this.cancel('原问题已过期；停止本轮口述，未提交答案'),Math.max(1,Date.parse(binding.expires_at)-Date.now()));
      await this.ports.start(token,async():Promise<void>=>{
        this.check(generation,token,value.reply);await this.ports.revalidate(value.reply);this.check(generation,token,value.reply);
      });
      if(generation===this.generation&&this.token===token){this.check(generation,token,value.reply);this.observe();}
    }catch(error){
      if(generation===this.generation)this.cancel('本轮口述未启动或已中断；原问题和收音记录保留');
      throw new Error('TASK_VOICE_START_UNCONFIRMED');
    }
  }
  observe():void{
    if(!this.token||!this.binding)return;const state=this.ports.state();
    if(state.binding!==this.token){this.cancel('收音尝试已变化；没有把文字交给原问题');return;}
    if(state.active){this.note=state.phase==='cleanup_pending'?'本轮退出未确认；请先清理收音，未提交答案':
      state.phase==='listening'?'短时口述中；结束后保留完整条件，仍需确认':'正在准备或结束原问题口述；尚未提交答案';this.notify();return;}
    if(this.completeCapture(state)){
      if(!this.publishing)void this.publish(this.generation,this.token,this.binding,false).catch(()=>{});
    }else this.cancel('本轮没有完整有效的口述；原问题保留，可清理后重新询问');
  }
  private async publish(generation:number,token:string,binding:TaskReplyBinding,recover:boolean):Promise<void>{
    if(this.publishing||recover&&!this.canRecover)throw new Error('TASK_VOICE_RECOVERY_INVALID');
    this.publishing=true;let cleared:boolean=false;
    try{
      if(!recover)this.check(generation,token,binding);
      const before=this.ports.state();
      if(before.binding!==token||!this.completeCapture(before))throw new Error('TASK_VOICE_CONTEXT_CHANGED');
      await this.ports.revalidate(binding);
      const after=this.ports.state(),record=this.draft.snapshot(),value=this.unpack(token);
      if(generation!==this.generation||!value||value.peer!==this.ports.device()||!this.ports.foreground()||!this.ports.cardReleased()||
        this.ports.context()!==binding.context_key||!record||!taskSameReplyBinding(record.binding,binding)||record.cleanup_uid||
        before.binding!==token||after.binding!==token||!this.completeCapture(after)||
        after.text!==before.text||Date.parse(binding.expires_at)<=Date.now())throw new Error('TASK_VOICE_CONTEXT_CHANGED');
      this.ports.validate(binding);
      // Persist a source receipt before copying the full text. Clearing the
      // capture journal must not discard this attempt's late-packet watch.
      const source=this.ports.source(token,after.text,recover);
      if(recover){this.draft.restoreTranscript(binding,binding.operation_id,after.text,Date.now(),source);this.draft.pause();}
      else{this.check(generation,token,binding);this.draft.transcript(binding.context_key,binding.operation_id,after.text,Date.now(),source);}
      const current=this.draft.snapshot();
      if(!current||!taskSameReplyBinding(current.binding,binding)||current.text!==after.text||!taskSameVoiceSource(current.voice_source,source)||
        !taskSameVoiceSource(this.ports.source(token,after.text,recover),source))throw new Error('TASK_VOICE_SOURCE_UNVERIFIED');
      this.token='';this.binding=undefined;this.clearTimer();
      this.note='完整口述已保存到原问题草稿；请核对后提交，尚未交给Agent';
      // Clear only after the full text is durable in the original decision.
      try{this.ports.clear();const remaining=this.ports.state();cleared=!remaining.active&&!remaining.binding&&!remaining.text&&remaining.phase==='idle';}
      catch{this.note='完整草稿已保存；收音副本清理待重试，尚未提交答案';}
    }catch(error){
      if(generation===this.generation)this.cancel('原问题变化或草稿保存失败；完整收音记录保留，未提交答案');
      throw new Error('TASK_VOICE_DRAFT_NOT_TRANSFERRED');
    }finally{this.publishing=false;this.notify();}
    // A fresh, complete transfer can offer the full answer for confirmation.
    // Cold recovery and generic change notifications never replay this event.
    if(!recover&&cleared&&generation===this.generation){try{this.onDraftSaved(JSON.parse(JSON.stringify(binding)) as TaskReplyBinding);}catch{}}
  }
  recover():Promise<void>{
    if(!this.canRecover)throw new Error('TASK_VOICE_RECOVERY_INVALID');
    const state=this.ports.state(),value=this.unpack(state.binding);if(!value)throw new Error('TASK_VOICE_RECOVERY_INVALID');
    return this.publish(++this.generation,state.binding,value.reply,true);
  }
  stop():Promise<void>{
    const state=this.ports.state();if(!this.token||state.binding!==this.token||!state.active)throw new Error('TASK_VOICE_NOT_ACTIVE');
    return this.ports.stop(false);
  }
  cancel(note:string='本轮口述已取消；原问题和草稿保留，未取消电脑任务'):void{
    const state=this.ports.state(),owned=this.owned(state),record=this.draft.snapshot(),binding=this.binding;
    // A replaced original draft must still stop the exact live attempt, while
    // leaving the replacement draft and any foreign capture untouched.
    const held=!!this.token,liveAttempt=held&&state.binding===this.token&&!!this.unpack(this.token);
    const originalCurrent=!!binding&&!!record&&taskSameReplyBinding(binding,record.binding);
    ++this.generation;this.token='';this.binding=undefined;this.clearTimer();
    if((liveAttempt&&originalCurrent)||(!held&&owned)||(!state.binding&&originalCurrent))this.draft.pause();this.note=note;this.notify();
    if(liveAttempt&&state.active)this.ports.stop(true).catch(()=>{});
  }
  stateChanged():void{
    if(!this.token||!this.binding)return;
    try{this.check(this.generation,this.token,this.binding);}catch{this.cancel('原问题、身份或期限已变化；停止本轮口述，未提交答案');}
  }
  discardIncomplete():void{if(!this.canDiscardIncomplete)throw new Error('TASK_VOICE_DRAFT_PROTECTED');this.ports.clear();this.note='本轮不完整口述已清理；恢复草稿会重新询问是否收音';this.notify();}
  clearCopied():void{if(!this.canClearCopied)throw new Error('TASK_VOICE_DRAFT_PROTECTED');this.ports.clear();this.note='收音副本已清理，原问题完整草稿保留';this.notify();}
  discardRetained():void{if(!this.canDiscardRetained)throw new Error('TASK_VOICE_DRAFT_PROTECTED');this.ports.clear();this.note='本轮保留口述已明确丢弃；原问题保留，未提交答案';this.notify();}
  cleanup():Promise<void>{
    if(!this.cleanupPending)throw new Error('TASK_VOICE_NOT_ACTIVE');
    ++this.generation;this.token='';this.binding=undefined;this.clearTimer();this.draft.pause();this.notify();return this.ports.cleanup();
  }
}
