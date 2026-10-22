import { fileIo as fs } from '@kit.CoreFileKit';
import { util } from '@kit.ArkTS';
import { TaskRoute,TaskOption,taskId,taskStamp,taskRouteValid,taskSameRoute } from './TaskWire';
import { TaskVoiceSourceRef,taskVoiceSourceValid,taskSameVoiceSource } from './TaskVoiceSourceRef';

// Shared by phone answers and the future two-stage glasses adapter. This is a
// local binding, not a new server request or an authorization to start audio.
export class TaskReplyBinding {
  schema:number=1;context_key:string='';operation_id:string='';request_id:string='';request_revision:number=0;
  task_id:string='';route:TaskRoute=new TaskRoute();expires_at:string='';question:string='';mode:string='';options:TaskOption[]=[];
}
export function taskReplyBindingValid(b:TaskReplyBinding):boolean{
  if(!b||Object.keys(b).length!==11||b.schema!==1||typeof b.context_key!=='string'||!b.context_key||b.context_key.length>8192||!taskId(b.operation_id)||
    !taskId(b.request_id)||!Number.isSafeInteger(b.request_revision)||b.request_revision<1||!taskId(b.task_id)||!taskRouteValid(b.route)||Object.keys(b.route).length!==4||
    !taskStamp(b.expires_at)||typeof b.question!=='string'||!b.question||b.question.length>4096||!['choice','free_text'].includes(b.mode)||
    !Array.isArray(b.options)||b.options.length>4)return false;
  const seen:string[]=[];for(const option of b.options){if(!option||Object.keys(option).length!==2||!taskId(option.option_id)||!taskId(option.label)||seen.includes(option.option_id))return false;seen.push(option.option_id);}
  return b.mode==='free_text'?b.options.length===0:b.options.length>=2;
}
export function taskSameReplyBinding(a:TaskReplyBinding,b:TaskReplyBinding):boolean{
  return taskReplyBindingValid(a)&&taskReplyBindingValid(b)&&a.context_key===b.context_key&&a.operation_id===b.operation_id&&
    a.request_id===b.request_id&&a.request_revision===b.request_revision&&a.task_id===b.task_id&&taskSameRoute(a.route,b.route)&&
    a.expires_at===b.expires_at&&a.question===b.question&&a.mode===b.mode&&a.options.length===b.options.length&&
    a.options.every((o:TaskOption,i:number):boolean=>o.option_id===b.options[i].option_id&&o.label===b.options[i].label);
}
export class TaskDecisionPlan {adopt_option_id:string|null=null;decline_option_id:string|null=null;adopt_text:string='采用当前方案';decline_text:string='未采用当前方案';}
export class TaskReplySubmission {
  binding:TaskReplyBinding=new TaskReplyBinding();option_id:string|null=null;text:string='';input_source:string='phone';
  record_schema:number=2;voice_source:TaskVoiceSourceRef|null=null;
}
export function taskSameSubmission(a:TaskReplySubmission,b:TaskReplySubmission):boolean{
  return taskSameReplyBinding(a.binding,b.binding)&&a.option_id===b.option_id&&a.text===b.text&&a.input_source===b.input_source&&
    a.record_schema===b.record_schema&&taskSameVoiceSource(a.voice_source,b.voice_source);
}
export class TaskDecisionRecord {
  schema:number=2;binding:TaskReplyBinding=new TaskReplyBinding();plan:TaskDecisionPlan=new TaskDecisionPlan();stage:string='proposal';
  cleanup_uid:string='';cleanup_peer:string='';card_stage:string='';used_uids:string[]=[];
  option_id:string|null=null;text:string='';input_source:string='phone';
  voice_source:TaskVoiceSourceRef|null=null;
}
export function taskRecordSubmission(record:TaskDecisionRecord):TaskReplySubmission{
  const answer=new TaskReplySubmission();answer.binding=JSON.parse(JSON.stringify(record.binding)) as TaskReplyBinding;
  answer.option_id=record.option_id;answer.text=record.text;answer.input_source=record.input_source;answer.record_schema=record.schema;
  answer.voice_source=record.voice_source?JSON.parse(JSON.stringify(record.voice_source)) as TaskVoiceSourceRef:null;return answer;
}
// Pure local state/persistence: no BLE, microphone, HTTP, task cancellation or
// answer enqueue is reachable here. The adapter must explicitly perform those.
export class TaskDecisionDraft {
  private file:string='';private record:TaskDecisionRecord|undefined=undefined;
  private recoveryActive:string='';
  private priorBytes:string|undefined=undefined;
  blocked:boolean=false;paused:boolean=false;
  initialize(filesDir:string):void{
    this.file=filesDir+'/task-decision-draft.json';this.recoveryActive=filesDir+'/task-decision-recovery.active';this.record=undefined;this.priorBytes=undefined;this.blocked=false;this.paused=false;
    try{
      // Recovery archives the original files before publishing a paused copy.
      // Its exclusive directory protects even a not-yet-written intent and the
      // temporary no-main window; it is never treated as an empty new draft.
      if(fs.accessSync(this.recoveryActive))throw new Error('TASK_DECISION_RECOVERY_PENDING');
      // A fully written newer answer can survive here after rename failed.
      // Preserve both records, including an orphan, rather than loading an
      // older answer or truncating the only remaining evidence on next begin.
      if(fs.accessSync(this.file+'.partial'))throw new Error('TASK_DECISION_PENDING_WRITE');
      if(!fs.accessSync(this.file))return;if(fs.statSync(this.file).size>262144)throw new Error('SIZE');
      const raw=fs.readTextSync(this.file),record=JSON.parse(raw) as TaskDecisionRecord;
      this.validate(record);this.record=record;this.priorBytes=raw;this.paused=true;
    }catch(_){this.blocked=true;this.paused=true;}
  }
  snapshot():TaskDecisionRecord|undefined{return this.record?JSON.parse(JSON.stringify(this.record)) as TaskDecisionRecord:undefined;}
  pause():void{this.paused=true;}
  parseRecoveryRecord(raw:string):TaskDecisionRecord{
    if(typeof raw!=='string'||raw.length>262144)throw new Error('TASK_DECISION_RECOVERY_INVALID');
    const record=JSON.parse(raw) as TaskDecisionRecord;this.validate(record);
    return JSON.parse(JSON.stringify(record)) as TaskDecisionRecord;
  }
  private validatePlan(b:TaskReplyBinding,p:TaskDecisionPlan):void{
    if(!p||Object.keys(p).length!==4||typeof p.adopt_text!=='string'||!p.adopt_text.trim()||p.adopt_text.length>512||typeof p.decline_text!=='string'||!p.decline_text.trim()||p.decline_text.length>512)throw new Error('TASK_DECISION_PLAN_INVALID');
    if(b.mode==='free_text'){if(p.adopt_option_id!==null||p.decline_option_id!==null)throw new Error('TASK_OPTION_INVALID');}
    else if(b.options.length!==2||p.adopt_option_id===p.decline_option_id||!b.options.some((o:TaskOption):boolean=>o.option_id===p.adopt_option_id&&o.label===p.adopt_text)||
      (p.decline_option_id===null?p.decline_text!=='未采用当前方案':!b.options.some((o:TaskOption):boolean=>o.option_id===p.decline_option_id&&o.label===p.decline_text)))throw new Error('TASK_DECISION_MAPPING_REQUIRED');
  }
  private validate(r:TaskDecisionRecord):void{
    if(!r||![1,2].includes(r.schema)||Object.keys(r).length!==(r.schema===1?11:12)||!taskReplyBindingValid(r.binding)||
      r.schema===2&&(r.voice_source!==null&&!taskVoiceSourceValid(r.voice_source)||r.input_source!=='voice'&&r.voice_source!==null)||
      !['proposal','supplement_offer','voice_authorized','review','sealed','queued','deferred','abandoned'].includes(r.stage)||typeof r.cleanup_uid!=='string'||r.cleanup_uid.length>128||
      typeof r.cleanup_peer!=='string'||r.cleanup_peer.length>256||!!r.cleanup_uid!==!!r.cleanup_peer||typeof r.card_stage!=='string'||
      !Array.isArray(r.used_uids)||r.used_uids.length>8||r.used_uids.some((v:string):boolean=>typeof v!=='string'||!v||v.length>128)||new Set(r.used_uids).size!==r.used_uids.length||
      r.used_uids.some((v:string):boolean=>!v.startsWith(r.binding.operation_id+'-'))||
      (r.cleanup_uid?(!r.used_uids.includes(r.cleanup_uid)||!['proposal','supplement_offer','review'].includes(r.card_stage)):r.card_stage!=='')||
      r.card_stage==='review'&&!['review','sealed','deferred'].includes(r.stage)||
      r.stage==='sealed'&&!!r.cleanup_uid&&r.card_stage!=='review'||r.stage==='queued'&&!!r.cleanup_uid||
      ['proposal','supplement_offer','voice_authorized'].includes(r.stage)&&(r.text!==''||r.option_id!==null)||
      !['phone','voice','glasses_semantic'].includes(r.input_source)||
      r.option_id!==null&&!r.binding.options.some((o:TaskOption):boolean=>o.option_id===r.option_id)||typeof r.text!=='string'||r.text.length>65536||
      ['review','sealed','queued'].includes(r.stage)&&!r.text.trim())throw new Error('TASK_DECISION_CORRUPT');
    this.validatePlan(r.binding,r.plan);
  }
  // Read-only durability check, also used immediately before an already sealed
  // answer reaches the outbox. Detect conflicts before enqueue, not afterwards
  // when publishing queued would be too late to prevent a side effect.
  assertCurrent():void{
    if(this.blocked||!this.file)throw new Error('TASK_DECISION_UNAVAILABLE');
    let checked:boolean=false;
    try{
      if(fs.accessSync(this.recoveryActive))throw new Error('TASK_DECISION_RECOVERY_PENDING');
      if(fs.accessSync(this.file+'.partial'))throw new Error('TASK_DECISION_PENDING_WRITE');
      const exists=fs.accessSync(this.file);
      if(this.priorBytes===undefined?exists:!exists||fs.statSync(this.file).size>262144||fs.readTextSync(this.file)!==this.priorBytes)throw new Error('TASK_DECISION_WRITER_STALE');
      checked=true;
    }finally{if(!checked){this.blocked=true;this.paused=true;}}
  }
  private publish(next:TaskDecisionRecord):void{
    if(this.blocked||!this.file)throw new Error('TASK_DECISION_UNAVAILABLE');this.validate(next);this.assertCurrent();
    const json=JSON.stringify(next),bytes=new util.TextEncoder().encodeInto(json);
    let committed:boolean=false;
    try{if(bytes.length>262144)throw new Error('TASK_DECISION_TOO_LARGE');
      const f=fs.openSync(this.file+'.partial',fs.OpenMode.CREATE|fs.OpenMode.WRITE_ONLY|fs.OpenMode.TRUNC);
      try{let at=0;while(at<bytes.length){const part=bytes.slice(at);try{const n=fs.writeSync(f.fd,part.buffer);if(!Number.isSafeInteger(n)||n<1||n>part.length)throw new Error('TASK_DECISION_WRITE');at+=n;}finally{part.fill(0);}}fs.fsyncSync(f.fd);}finally{fs.closeSync(f);}
      fs.renameSync(this.file+'.partial',this.file);this.record=JSON.parse(json) as TaskDecisionRecord;this.priorBytes=json;committed=true;
    }finally{bytes.fill(0);if(!committed){this.blocked=true;this.paused=true;}}
  }
  private current(key:string,now:number):TaskDecisionRecord{
    if(this.blocked)throw new Error('TASK_DECISION_UNAVAILABLE');
    const r=this.snapshot();if(this.paused||!r||r.binding.context_key!==key)throw new Error('TASK_PROFILE_CHANGED');
    if(!Number.isSafeInteger(now)||Date.parse(r.binding.expires_at)<=now)throw new Error('EXPIRED');return r;
  }
  begin(binding:TaskReplyBinding,plan:TaskDecisionPlan,now:number):void{
    if(this.blocked||this.record&&!( ['queued','abandoned'].includes(this.record.stage)&&!this.record.cleanup_uid))throw new Error('TASK_DECISION_ALREADY_EXISTS');
    if(!taskReplyBindingValid(binding)||!Number.isSafeInteger(now)||Date.parse(binding.expires_at)<=now)throw new Error('TASK_REPLY_BINDING_INVALID');
    const next=new TaskDecisionRecord();next.binding=JSON.parse(JSON.stringify(binding)) as TaskReplyBinding;next.plan=JSON.parse(JSON.stringify(plan)) as TaskDecisionPlan;this.publish(next);this.paused=false;
  }
  armCard(key:string,peer:string,uid:string,now:number):void{
    const next=this.current(key,now);if(next.cleanup_uid||!['proposal','supplement_offer'].includes(next.stage)||!peer||peer.length>256||!uid||uid.length>128||!uid.startsWith(next.binding.operation_id+'-')||next.used_uids.includes(uid))throw new Error('TASK_DECISION_CARD_BUSY');
    if(next.used_uids.length>=8)throw new Error('TASK_DECISION_UID_LIMIT');
    next.cleanup_uid=uid;next.cleanup_peer=peer;next.card_stage=next.stage;next.used_uids.push(uid);this.publish(next);
  }
  armReviewCard(frozen:TaskReplySubmission,peer:string,uid:string,now:number):void{
    const next=this.current(frozen.binding.context_key,now);
    if(next.stage!=='review'||next.cleanup_uid||!taskSameSubmission(taskRecordSubmission(next),frozen)||!peer||peer.length>256||!uid||uid.length>128||
      !uid.startsWith(next.binding.operation_id+'-')||next.used_uids.includes(uid))throw new Error('TASK_REVIEW_CHANGED');
    if(next.used_uids.length>=8)throw new Error('TASK_DECISION_UID_LIMIT');
    next.cleanup_uid=uid;next.cleanup_peer=peer;next.card_stage='review';next.used_uids.push(uid);this.publish(next);
  }
  confirmReview(frozen:TaskReplySubmission,peer:string,type:number,uid:string,cmd:number,now:number):boolean{
    const next=this.current(frozen.binding.context_key,now);
    if(next.stage!=='review'||next.card_stage!=='review'||type!==34||!uid||next.cleanup_uid!==uid||next.cleanup_peer!==peer||
      ![1,2].includes(cmd)||!taskSameSubmission(taskRecordSubmission(next),frozen))return false;
    // Consent and its exact full answer are durable before native feedback.
    // Keep the old UID until transport removal succeeds, including cold start.
    next.stage=cmd===1?'sealed':'deferred';this.publish(next);if(cmd===2)this.paused=true;return true;
  }
  suggestion(key:string,peer:string,type:number,uid:string,cmd:number,now:number):boolean{
    const next=this.current(key,now);
    if(type!==34||peer!==next.cleanup_peer||uid!==next.cleanup_uid||!uid||![1,2].includes(cmd)||next.card_stage!==next.stage)return false;
    if(next.stage==='proposal'){
      if(cmd===2){next.stage='supplement_offer';next.text='';next.option_id=null;}
      else{next.stage='review';next.option_id=next.plan.adopt_option_id;next.text=next.plan.adopt_text;next.input_source='glasses_semantic';}
    }else if(next.stage==='supplement_offer'){
      if(cmd===1){next.stage='voice_authorized';next.text='';next.option_id=null;}
      else{next.stage='review';next.option_id=next.plan.decline_option_id;next.text=next.plan.decline_text;next.input_source='glasses_semantic';}
    }else return false;
    this.publish(next);return true;
  }
  removalSubmitted(peer:string,uid:string):void{
    const next=this.snapshot();if(this.blocked||!next||next.cleanup_peer!==peer||next.cleanup_uid!==uid||!uid)throw new Error('TASK_DECISION_CARD_STALE');
    next.cleanup_uid='';next.cleanup_peer='';next.card_stage='';this.publish(next);
  }
  voiceBinding(key:string,now:number):string{
    const r=this.current(key,now);if(r.stage!=='voice_authorized'||r.cleanup_uid)throw new Error('TASK_VOICE_NOT_AUTHORIZED');return r.binding.operation_id;
  }
  transcript(key:string,captureBinding:string,text:string,now:number,source:TaskVoiceSourceRef|null=null):void{
    const next=this.current(key,now);if(this.voiceBinding(key,now)!==captureBinding||!text.trim()||text.length>65536)throw new Error('TASK_TRANSCRIPT_BINDING_INVALID');
    next.schema=2;next.stage='review';next.option_id=null;next.text=text;next.input_source='voice';next.voice_source=source?JSON.parse(JSON.stringify(source)) as TaskVoiceSourceRef:null;this.publish(next);
  }
  restoreTranscript(binding:TaskReplyBinding,captureBinding:string,text:string,now:number,source:TaskVoiceSourceRef|null=null):void{
    const next=this.snapshot();if(this.blocked||!next||next.stage!=='voice_authorized'||next.cleanup_uid||
      !taskSameReplyBinding(next.binding,binding)||captureBinding!==binding.operation_id||!Number.isSafeInteger(now)||Date.parse(binding.expires_at)<=now||
      !text.trim()||text.length>65536)throw new Error('TASK_TRANSCRIPT_BINDING_INVALID');
    next.schema=2;next.stage='review';next.option_id=null;next.text=text;next.input_source='voice';next.voice_source=source?JSON.parse(JSON.stringify(source)) as TaskVoiceSourceRef:null;this.publish(next);this.paused=false;
  }
  edit(key:string,text:string,now:number):void{const next=this.current(key,now);if(next.stage!=='review'||next.cleanup_uid||!text.trim()||text.length>65536)throw new Error('TASK_DECISION_NOT_REVIEWING');next.schema=2;next.text=text;next.option_id=null;next.input_source='phone';next.voice_source=null;this.publish(next);}
  adoptPhone(expected:TaskReplySubmission,now:number):void{
    const next=this.snapshot();if(this.blocked||!next||!['review','sealed','deferred'].includes(next.stage)||next.cleanup_uid||
      !Number.isSafeInteger(now)||Date.parse(next.binding.expires_at)<=now||!next.text.trim()||!taskSameSubmission(taskRecordSubmission(next),expected))throw new Error('TASK_PHONE_ADOPTION_CHANGED');
    next.schema=2;next.stage='review';next.option_id=null;next.input_source='phone';next.voice_source=null;this.publish(next);this.paused=true;
  }
  seal(key:string,now:number):TaskReplySubmission{
    const next=this.current(key,now);if(!['review','sealed'].includes(next.stage)||next.cleanup_uid)throw new Error('TASK_DECISION_NOT_REVIEWING');
    next.stage='sealed';this.publish(next);return taskRecordSubmission(next);
  }
  defer():void{const next=this.snapshot();if(this.blocked||!next||['sealed','queued'].includes(next.stage))throw new Error('TASK_DECISION_UNAVAILABLE');next.stage='deferred';this.publish(next);this.paused=true;}
  // Called only after the host explicitly refreshes the original request/task.
  // A restored voice authorization always needs a new second-card consent.
  resume(binding:TaskReplyBinding,now:number):void{
    const next=this.snapshot();if(this.blocked||!next||next.cleanup_uid||['sealed','queued','abandoned'].includes(next.stage)||
      !taskSameReplyBinding(next.binding,binding)||!Number.isSafeInteger(now)||Date.parse(binding.expires_at)<=now)throw new Error('TASK_DECISION_RESUME_INVALID');
    if(next.stage==='voice_authorized')next.stage='supplement_offer';
    if(next.stage==='deferred')next.stage=next.text.trim()?'review':'proposal';
    this.publish(next);this.paused=false;
  }
  abandon():void{const next=this.snapshot();if(this.blocked||!next||next.cleanup_uid||['sealed','queued'].includes(next.stage))throw new Error('TASK_DECISION_UNAVAILABLE');next.stage='abandoned';this.publish(next);this.paused=true;}
  queued(operation:string):void{const next=this.snapshot();if(this.blocked||!next||next.stage!=='sealed'||next.cleanup_uid||next.binding.operation_id!==operation)throw new Error('TASK_DECISION_UNAVAILABLE');next.stage='queued';this.publish(next);}
}
