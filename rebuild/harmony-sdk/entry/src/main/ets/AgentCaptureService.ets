import { common } from '@kit.AbilityKit';
import { AgentReplyCapture } from './AgentReplyCapture';
import { probeSession } from './ProbeSession';
import { notifications,suggestionTests } from './NotificationService';
import { interactiveTranscriptionBusy,resumePendingTranscriptions } from './RecordingService';
import { taskService } from './TaskService';
import { TaskVoiceConnection } from './TaskVoiceSources';

// The Ability owns routing/occupancy. A mounted diagnostic page only observes.
export class AgentCaptureView {changed:()=>void=():void=>{};replyChanged:()=>void=():void=>{};replyOccupied:()=>boolean=():boolean=>false;}
export const agentCaptureView:AgentCaptureView=new AgentCaptureView();
export const agentCapture:AgentReplyCapture=new AgentReplyCapture(
  (business:number,bytes:Uint8Array):Promise<void>=>probeSession.auth.sendBusiness(business,bytes),
  ():string=>probeSession.features.state.connected?probeSession.peerDeviceId:'',
  ():boolean=>probeSession.foreground&&!agentCaptureView.replyOccupied()&&!probeSession.features.launcherBusy&&!probeSession.agentSuggestionOccupied&&!probeSession.voice.active&&!probeSession.voice.pendingWrites&&!probeSession.features.displayActive&&!probeSession.recordingOccupied()&&
    !probeSession.lifelogOccupied()&&!probeSession.prompterOccupied()&&!interactiveTranscriptionBusy()&&!notifications.occupied&&!suggestionTests.active,
  ():number=>probeSession.auth.connectionGeneration
);
export function initializeAgentCapture(context:common.UIAbilityContext):void{
  taskService.voiceSources.connection=():TaskVoiceConnection=>{
    const value=new TaskVoiceConnection();value.peer=probeSession.features.state.connected?probeSession.peerDeviceId:'';value.epoch=probeSession.auth.connectionGeneration;return value;
  };
  agentCapture.observeSource=(peer:string,epoch:number,business:number,payload:Uint8Array):void=>taskService.voiceSources.observe(peer,epoch,business,payload);
  agentCapture.initialize(context);
  agentCapture.beforeMic=async():Promise<void>=>{await probeSession.voice.waitForIdleWrites();if(probeSession.features.launcherBusy)throw new Error('请先完成设备设置');};
  agentCapture.changed=():void=>{probeSession.agentCaptureOccupied=agentCapture.active;try{agentCaptureView.changed();}catch{}try{agentCaptureView.replyChanged();}catch{}};
  agentCapture.onReleased=():void=>resumePendingTranscriptions();
  probeSession.agentCaptureOccupied=agentCapture.active;
}
export function disposeAgentCapture():void{
  taskService.voiceSources.disconnected();agentCapture.observeSource=(_peer:string,_epoch:number,_business:number,_payload:Uint8Array):void=>{};
  agentCapture.disconnected();agentCapture.changed=():void=>{};agentCapture.onReleased=():void=>{};
  agentCaptureView.replyChanged=():void=>{};
  agentCapture.beforeMic=async():Promise<void>=>{};probeSession.agentCaptureOccupied=false;
}
