import { util } from '@kit.ArkTS';
import { cryptoFramework } from '@kit.CryptoArchitectureKit';
import { TaskDecisionRecord,TaskReplyBinding,taskReplyBindingValid,taskSameReplyBinding } from './TaskReplyDraft';
import { TaskVoiceSourceView } from './TaskVoiceSources';
import { taskVoiceSourceValid } from './TaskVoiceSourceRef';

export class DebugVoiceState {
  active:boolean=false;phase:string='idle';binding:string='';text:string='';exitEvidence:string='none';
  metricsAvailable:boolean=true;
  packets:number=0;pcmBytes:number=0;nonzeroPackets:number=0;tailPackets:number=0;tailPcmBytes:number=0;lateAudioPackets:number=0;
  inputSealed:boolean=false;tailTimedOut:boolean=false;stopSubmitted:boolean=false;workerExited:boolean=false;
  recorderStop:string='not_attempted';exitWrite:string='not_attempted';exitReason:number=-1;
  compressedPackets:number=0;compressedBytes:number=0;repeatedCompressedPackets:number=0;lastCompressedSha256:string='';
  firstAudioAt:number=0;lastAudioAt:number=0;stopRequestedAt:number=0;inputSealedAt:number=0;pcmRms:number=0;pcmPeak:number=0;
  type1Packets:number=0;firstType1At:number=0;micWriteStartedAt:number=0;micWriteCompletedAt:number=0;
  firstDecodedCompressedBytes:number=0;firstDecodedSamples:number=0;
  transcriptStatus:string='none';boundaryEvidence:string='none';observationRestored:boolean=false;
}
export class DebugTaskState {
  request_id:string='';request_revision:number=0;task_id:string='';operation_id:string='';stage:string='';paused:boolean=true;cleanup_uid:string='';
  capture_phase:string='idle';capture_active:boolean=false;exit_evidence:string='none';can_recover:boolean=false;
  attempt_id:string='';binding_sha256:string='';binding_applicable:boolean=false;
  capture_text_length:number=0;capture_text_sha256:string='';draft_text_length:number=0;draft_text_sha256:string='';draft_saved:boolean=false;
  capture_packets:number=0;pcm_bytes:number=0;nonzero_packets:number=0;tail_packets:number=0;tail_pcm_bytes:number=0;late_audio_packets:number=0;
  input_sealed:boolean=false;tail_timed_out:boolean=false;stop_submitted:boolean=false;worker_exited:boolean=false;
  recorder_stop:string='not_attempted';exit_write:string='not_attempted';exit_reason:number=-1;
  capture_metrics_available:boolean=false;
  compressed_packets:number=0;compressed_bytes:number=0;repeated_compressed_packets:number=0;last_compressed_sha256:string='';
  first_audio_at:number=0;last_audio_at:number=0;stop_requested_at:number=0;input_sealed_at:number=0;pcm_rms:number=0;pcm_peak:number=0;
  type1_packets:number=0;first_type1_at:number=0;mic_write_started_at:number=0;mic_write_completed_at:number=0;
  first_decoded_compressed_bytes:number=0;first_decoded_samples:number=0;
  transcript_status:string='none';boundary_evidence:string='none';observation_restored:boolean=false;
  review_ready:boolean=false;review_block_reason:string='unavailable';reply_binding_sha256:string='';
  source_state:string='unavailable';source_reason:string='';source_attempt_id:string='';source_binding_sha256:string='';source_text_sha256:string='';
  source_late_packets:number=0;source_dispatch_started:boolean=false;source_delivery_uncertain:boolean=false;
}
class DebugVoiceBinding {
  format:string='';attempt_id:string='';peer:string='';reply:TaskReplyBinding=new TaskReplyBinding();
}
export interface DebugTaskPorts {
  capture:()=>DebugVoiceState;draft:()=>TaskDecisionRecord|undefined;paused:()=>boolean;
  foreground:()=>boolean;device:()=>string;context:()=>string;canRecover:()=>boolean;
  finish:()=>Promise<void>;cancel:()=>void;recover:()=>Promise<void>;
  reviewStatus:()=>DebugTaskReviewState;reviewCard:(expected:string)=>Promise<void>;
  sourceStatus?:()=>TaskVoiceSourceView;
}
export interface DebugTaskReviewState {ready:boolean;reason:string;binding_sha256:string;}
function digest(text:string):string{
  const bytes=new util.TextEncoder().encodeInto(text),md=cryptoFramework.createMd('SHA256');
  try{md.updateSync({data:bytes});const hash=md.digestSync().data;
    try{return Array.from(hash).map((n:number):string=>n.toString(16).padStart(2,'0')).join('');}finally{hash.fill(0);}
  }finally{bytes.fill(0);}
}
function safeCount(value:number):number{return Number.isSafeInteger(value)&&value>=0?value:0;}
function safeAmplitude(value:number):number{return Number.isFinite(value)&&value>=0&&value<=32768?value:0;}
function safeWriteState(value:string):string{return ['not_attempted','pending','submitted','failed'].includes(value)?value:'not_attempted';}
// The opaque CAS is over the complete original token, including peer, original
// request/revision/route/operation and this capture attempt. It grants no voice
// consent and cannot create, submit or cancel a computer task.
export class DebugTaskSnapshot {
  private ports:DebugTaskPorts;
  constructor(ports:DebugTaskPorts){this.ports=ports;}
  private binding(state:DebugVoiceState,record:TaskDecisionRecord|undefined):DebugVoiceBinding|undefined{
    try{
      if(!record||!state.binding||state.binding.length>2048)return undefined;
      const value=JSON.parse(state.binding) as DebugVoiceBinding;
      if(!value||Object.keys(value).length!==4||!['format','attempt_id','peer','reply'].every((key:string):boolean=>Object.keys(value).includes(key))||
        value.format!=='turboio-task-voice/1'||typeof value.attempt_id!=='string'||!/^voice-[a-f0-9]{32}$/.test(value.attempt_id)||
        typeof value.peer!=='string'||!value.peer||value.peer.length>256||value.peer!==this.ports.device()||
        !taskReplyBindingValid(value.reply)||!taskSameReplyBinding(value.reply,record.binding)||this.ports.context()!==record.binding.context_key)return undefined;
      return value;
    }catch{return undefined;}
  }
  status():DebugTaskState{
    const state=this.ports.capture(),record=this.ports.draft(),value=this.binding(state,record),view=new DebugTaskState();
    try{
      const review=this.ports.reviewStatus(),reasons=['ready','no_draft','protected','not_reviewing','paused','cleanup_pending','busy','not_foreground',
        'identity_changed','expired','peer_unavailable','unavailable','invalid_request','title_too_long','content_too_long','invalid_copy','uid_limit','source_unverified'];
      if(review&&typeof review.reason==='string'&&reasons.includes(review.reason))view.review_block_reason=review.reason;
      if(review&&typeof review.binding_sha256==='string'&&/^[a-f0-9]{64}$/.test(review.binding_sha256))view.reply_binding_sha256=review.binding_sha256;
      view.review_ready=review?.ready===true&&view.review_block_reason==='ready'&&!!view.reply_binding_sha256;
      if(view.review_block_reason==='ready'&&!view.review_ready)view.review_block_reason='unavailable';
    }catch{ /* A missing review observation never grants display or submission. */ }
    if(record){view.request_id=record.binding.request_id;view.request_revision=record.binding.request_revision;view.task_id=record.binding.task_id;
      view.operation_id=record.binding.operation_id;view.stage=record.stage;view.paused=this.ports.paused();view.cleanup_uid=record.cleanup_uid;
      view.draft_text_length=record.text.length;view.draft_text_sha256=record.text?digest(record.text):'';
      const copiedAndCleared=!state.binding&&!state.active&&state.phase==='idle';
      view.draft_saved=record.binding.context_key===this.ports.context()&&(!!value||copiedAndCleared)&&
        ['review','sealed','queued'].includes(record.stage)&&record.input_source==='voice'&&!!record.text.trim();}
    if(record&&record.binding.context_key===this.ports.context()){
      try{const source=this.ports.sourceStatus?.();
        if(source&&['missing','legacy','unknown','tainted','blocked','watching','independent_phone','independent_choice'].includes(source.state)){
          view.source_state=source.state;view.source_reason=typeof source.reason==='string'&&/^[a-z0-9_]{0,64}$/.test(source.reason)?source.reason:'';
          const ref=record.voice_source;
          const matching=record.schema===2&&record.input_source==='voice'&&ref&&taskVoiceSourceValid(ref)&&
            source.attempt_id===ref.attempt_id&&source.binding_sha256===ref.binding_sha256&&source.text_sha256===ref.text_sha256;
          if(matching){
            view.source_attempt_id=source.attempt_id;view.source_binding_sha256=source.binding_sha256;view.source_text_sha256=source.text_sha256;
            view.source_late_packets=safeCount(source.late_packets);view.source_dispatch_started=source.dispatch_started===true;view.source_delivery_uncertain=source.delivery_uncertain===true;
          }else if(source.state==='watching'){view.source_state='unknown';view.source_reason='source_unmatched';}
        }
      }catch{view.source_state='unavailable';}
    }
    view.capture_phase=['idle','preparing','starting','listening','stopping','transcribing','cleanup_pending','draft','failed','blocked'].includes(state.phase)?state.phase:'unknown';
    view.capture_active=state.active===true;view.exit_evidence=['none','device_event','user_confirmation','legacy_record'].includes(state.exitEvidence)?state.exitEvidence:'none';
    // An unrelated capture must not disclose its token, attempt or transcript.
    if(value){view.attempt_id=value.attempt_id;view.binding_sha256=digest(state.binding);view.binding_applicable=true;
      view.capture_text_length=state.text.length;view.capture_text_sha256=state.text?digest(state.text):'';view.can_recover=this.ports.canRecover();
      view.transcript_status=['none','pending','complete','partial','cancelled','legacy'].includes(state.transcriptStatus)?state.transcriptStatus:'none';
      view.boundary_evidence=['none','device_event','quiet_after_stop','limit','cancelled'].includes(state.boundaryEvidence)?state.boundaryEvidence:'none';
      view.observation_restored=state.observationRestored===true;
      // Only a current exact-bound observation can supply measurements. A
      // restored result retains its explicit status/evidence, not fresh zeros.
      if(state.observationRestored===false&&state.metricsAvailable!==false){view.capture_metrics_available=true;
        view.capture_packets=safeCount(state.packets);view.pcm_bytes=safeCount(state.pcmBytes);view.nonzero_packets=safeCount(state.nonzeroPackets);
        view.tail_packets=safeCount(state.tailPackets);view.tail_pcm_bytes=safeCount(state.tailPcmBytes);view.late_audio_packets=safeCount(state.lateAudioPackets);
        view.compressed_packets=safeCount(state.compressedPackets);view.compressed_bytes=safeCount(state.compressedBytes);view.repeated_compressed_packets=safeCount(state.repeatedCompressedPackets);
        view.last_compressed_sha256=typeof state.lastCompressedSha256==='string'&&/^[a-f0-9]{64}$/.test(state.lastCompressedSha256)?state.lastCompressedSha256:'';
        view.first_audio_at=safeCount(state.firstAudioAt);view.last_audio_at=safeCount(state.lastAudioAt);view.stop_requested_at=safeCount(state.stopRequestedAt);view.input_sealed_at=safeCount(state.inputSealedAt);
        view.type1_packets=safeCount(state.type1Packets);view.first_type1_at=safeCount(state.firstType1At);
        view.mic_write_started_at=safeCount(state.micWriteStartedAt);view.mic_write_completed_at=safeCount(state.micWriteCompletedAt);
        view.first_decoded_compressed_bytes=safeCount(state.firstDecodedCompressedBytes);view.first_decoded_samples=safeCount(state.firstDecodedSamples);
        view.pcm_rms=safeAmplitude(state.pcmRms);view.pcm_peak=safeAmplitude(state.pcmPeak);
        view.input_sealed=state.inputSealed===true;view.tail_timed_out=state.tailTimedOut===true;view.stop_submitted=state.stopSubmitted===true;view.worker_exited=state.workerExited===true;
        view.recorder_stop=safeWriteState(state.recorderStop);view.exit_write=safeWriteState(state.exitWrite);
        view.exit_reason=Number.isSafeInteger(state.exitReason)&&state.exitReason>=1&&state.exitReason<=15?state.exitReason:-1;}}
    return view;
  }
  async perform(action:string,expected:string):Promise<void>{
    const state=this.ports.capture(),record=this.ports.draft();
    if(!this.ports.foreground()||!/^[a-f0-9]{64}$/.test(expected)||!this.binding(state,record)||digest(state.binding)!==expected)throw new Error('DEBUG_VOICE_BINDING_CHANGED');
    // No await between the exact snapshot comparison and the underlying port.
    // recover itself revalidates the original task/request before saving text.
    if(action==='voice-finish')await this.ports.finish();
    else if(action==='voice-cancel')this.ports.cancel();
    else if(action==='voice-recover')await this.ports.recover();
    else throw new Error('DEBUG_COMMAND_INVALID');
  }
  async performReview(expected:string):Promise<void>{
    if(!this.ports.foreground()||!/^[a-f0-9]{64}$/.test(expected))throw new Error('DEBUG_REPLY_BINDING_CHANGED');
    // The normal business owns the complete original reply/text CAS and checks
    // it again after each await. This command only asks it to display a card.
    await this.ports.reviewCard(expected);
  }
}
