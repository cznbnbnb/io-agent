import { TaskSuggestionSession } from './TaskSuggestionSession';
import { TaskReplyBinding,TaskReplySubmission,taskSameReplyBinding,taskReplyBindingValid } from './TaskReplyDraft';
import { TaskVoiceSourceRef } from './TaskVoiceSourceRef';
import { probeSession } from './ProbeSession';
import { taskService } from './TaskService';
import { notifications,suggestionTests } from './NotificationService';
import { cryptoFramework } from '@kit.CryptoArchitectureKit';
import { agentCapture,agentCaptureView } from './AgentCaptureService';
import { TaskVoiceReplySession,TaskVoiceCaptureState } from './TaskVoiceReplySession';
import { TaskDraftRecovery } from './TaskDraftRecovery';
import { taskRecordingCapture } from './TaskRecordingService';

export class TaskSuggestionView {changed:()=>void=():void=>{};}
class TaskSourceToken {format:string='';attempt_id:string='';peer:string='';reply:TaskReplyBinding=new TaskReplyBinding();}
export const taskSuggestionView:TaskSuggestionView=new TaskSuggestionView();
// Retained pre-reuse captures keep their original controls. New consent always
// starts the existing ordinary recording path, never another assistant capture.
function legacyTaskCapture():boolean{
  try{const state=agentCapture.state;if(!agentCapture.active&&!state.text&&!['draft','cleanup_pending'].includes(state.phase))return false;
    const value=JSON.parse(state.binding) as TaskSourceToken;
    return !!value&&value.format==='turboio-task-voice/1'&&/^voice-[a-f0-9]{32}$/.test(value.attempt_id)&&taskReplyBindingValid(value.reply);
  }catch{return false;}
}
export const taskSuggestions:TaskSuggestionSession=new TaskSuggestionSession(taskService.decisionDraft,{
  send:(business:number,bytes:Uint8Array):Promise<void>=>probeSession.auth.sendBusiness(business,bytes),
  device:():string=>probeSession.features.state.connected?probeSession.peerDeviceId:'',
  // Retained words still belong to their original draft, even after local
  // withdrawal. Keep its explicit copy/discard controls reachable before a
  // replacement question can overwrite that binding.
  available:():boolean=>!probeSession.features.launcherBusy&&!taskRecordingCapture.state.binding&&!taskRecordingCapture.state.active&&!agentCapture.state.text&&!legacyTaskCapture()&&!probeSession.agentCaptureOccupied&&!probeSession.voice.active&&!probeSession.voice.pendingWrites&&!probeSession.features.displayActive&&
    !probeSession.recordingOccupied()&&!probeSession.lifelogOccupied()&&!probeSession.prompterOccupied()&&!notifications.occupied&&!suggestionTests.active,
  foreground:():boolean=>probeSession.foreground,context:():string=>taskService.summary().contextKey,
  validate:(binding:TaskReplyBinding):void=>taskService.validateReply(binding),
  revalidate:(binding:TaskReplyBinding):Promise<void>=>taskService.revalidateReply(binding),
  enqueue:(answer:TaskReplySubmission):string=>taskService.answerBound(answer.binding,answer.option_id,answer.text,answer.input_source,answer.record_schema,answer.voice_source),
  assertAnswer:(answer:TaskReplySubmission):void=>taskService.assertAnswer(answer),
  operationExists:(operation:string):boolean=>taskService.operationExists(operation),
  wait:(milliseconds:number):Promise<void>=>new Promise<void>((resolve:()=>void):void=>{setTimeout(resolve,milliseconds);})
});
export const taskVoiceReplies:TaskVoiceReplySession=new TaskVoiceReplySession(taskService.decisionDraft,{
  state:():TaskVoiceCaptureState=>{if(!legacyTaskCapture())return taskRecordingCapture.state;const s=agentCapture.state,v=new TaskVoiceCaptureState();
    v.active=agentCapture.active;v.phase=s.phase;v.binding=s.binding;v.text=s.text;v.valid=s.savedDraftValid;v.exitEvidence=s.exitEvidence;v.transcriptStatus=s.transcriptStatus;return v;},
  start:(binding:string,guard:()=>Promise<void>):Promise<void>=>{if(legacyTaskCapture())throw new Error('TASK_VOICE_LEGACY_RETAINED');return taskRecordingCapture.start(binding,guard);},
  stop:(cancelled:boolean):Promise<void>=>legacyTaskCapture()?agentCapture.stop(cancelled):taskRecordingCapture.stop(cancelled),
  clear:():void=>{if(legacyTaskCapture())agentCapture.clearDraft();else taskRecordingCapture.clear();},
  cleanup:():Promise<void>=>legacyTaskCapture()?agentCapture.cleanup():taskRecordingCapture.cleanup(),
  device:():string=>probeSession.features.state.connected?probeSession.peerDeviceId:'',context:():string=>taskService.summary().contextKey,
  foreground:():boolean=>probeSession.foreground,cardReleased:():boolean=>!taskSuggestions.active&&!probeSession.agentSuggestionOccupied,
  validate:(binding:TaskReplyBinding):void=>taskService.validateReply(binding),revalidate:(binding:TaskReplyBinding):Promise<void>=>taskService.revalidateReply(binding),
  source:(token:string,text:string,recover:boolean):TaskVoiceSourceRef=>{
    const value=JSON.parse(token) as TaskSourceToken;
    if(!value||Object.keys(value).length!==4||value.format!=='turboio-task-voice/1'||!taskReplyBindingValid(value.reply)||
      typeof value.attempt_id!=='string'||!/^voice-[a-f0-9]{32}$/.test(value.attempt_id)||typeof value.peer!=='string'||!value.peer)throw new Error('TASK_VOICE_SOURCE_UNVERIFIED');
    if(legacyTaskCapture())return recover?taskService.voiceSources.restore(value.reply,value.attempt_id,value.peer,text):
      taskService.voiceSources.register(value.reply,value.attempt_id,value.peer,agentCapture.sourceOrigin(token,text),text);
    const origin=taskRecordingCapture.sourceOrigin(token,text);
    return recover?taskService.voiceSources.restoreRecording(value.reply,value.attempt_id,value.peer,text,origin):
      taskService.voiceSources.registerRecording(value.reply,value.attempt_id,value.peer,taskRecordingCapture.sourceEpoch(token,text),text,origin);
  },
  nonce:():string=>{const bytes=cryptoFramework.createRandom().generateRandomSync(16).data;let id='voice-';
    try{for(const value of bytes)id+=value.toString(16).padStart(2,'0');return id;}finally{bytes.fill(0);}}
});
export const taskDraftRecovery:TaskDraftRecovery=new TaskDraftRecovery(taskService.decisionDraft,{
  context:():string=>taskService.summary().contextKey,
  idle:():boolean=>probeSession.foreground&&!taskSuggestions.busy&&!taskVoiceReplies.active&&!agentCapture.active&&!taskRecordingCapture.state.active,
  operationExists:(operation:string):boolean=>taskService.operationExists(operation),
  validate:(binding:TaskReplyBinding):void=>taskService.validateReply(binding),
  suspend:():void=>taskSuggestions.suspendForRecovery(),
  nonce:():string=>{const bytes=cryptoFramework.createRandom().generateRandomSync(16).data;
    try{return 'recover-'+Array.from(bytes).map((value:number):string=>value.toString(16).padStart(2,'0')).join('');}finally{bytes.fill(0);}},
  changed:():void=>{taskSuggestions.note='恢复记录已更新；请查看当前状态，尚未提交答案';taskSuggestions.changed();}
});
export function initializeTaskSuggestions(filesDir:string=''):void{
  if(filesDir)taskDraftRecovery.initialize(filesDir);
  const occupancy=():void=>{probeSession.agentSuggestionOccupied=taskSuggestions.active||suggestionTests.active;};
  taskSuggestions.changed=():void=>{occupancy();taskSuggestionView.changed();};
  suggestionTests.onOccupancyChanged=occupancy;
  taskService.onReplyPause=():void=>taskSuggestions.pause();
  taskService.onReplyState=():void=>{taskSuggestions.stateChanged();taskVoiceReplies.stateChanged();};
  taskSuggestions.onVoiceAuthorized=(binding:TaskReplyBinding):void=>{taskVoiceReplies.begin(binding).catch(()=>taskSuggestions.pause('本轮口述未启动或已中断；原问题和完整收音记录保留'));};
  taskSuggestions.onPause=():void=>taskVoiceReplies.cancel();
  taskVoiceReplies.changed=():void=>taskSuggestionView.changed();
  taskVoiceReplies.onDraftSaved=(binding:TaskReplyBinding):void=>{
    const record=taskSuggestions.draft.snapshot();
    if(!record||!taskSameReplyBinding(record.binding,binding)||record.stage!=='review'||record.input_source!=='voice')return;
    const review=taskSuggestions.reviewStatus();
    if(review.ready){try{taskSuggestions.showReview(review.binding_sha256).catch(()=>{});}catch{}}
    else{taskSuggestions.note='完整口述已保存；当前无法在眼镜完整核对，请在手机确认后提交';taskSuggestionView.changed();}
  };
  agentCaptureView.replyChanged=():void=>taskVoiceReplies.observe();
  occupancy();
}
export function disposeTaskSuggestions():void{
  taskService.onReplyPause=():void=>{};taskService.onReplyState=():void=>{};
  // Retain cleanup occupancy until a pending write really settles; the next
  // runtime reads the same durable UID. Do not pretend disconnect removed it.
  taskSuggestions.onVoiceAuthorized=(_binding:TaskReplyBinding):void=>{};
  taskSuggestions.pause();taskSuggestions.onPause=():void=>{};taskVoiceReplies.changed=():void=>{};taskVoiceReplies.onDraftSaved=(_binding:TaskReplyBinding):void=>{};
  agentCaptureView.replyChanged=():void=>{};taskSuggestionView.changed=():void=>{};
}
