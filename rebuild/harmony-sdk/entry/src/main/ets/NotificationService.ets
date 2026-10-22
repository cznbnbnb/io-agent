import { NotificationSession } from './NotificationSession';
import { probeSession } from './ProbeSession';
import { SuggestionTestSession } from './SuggestionTestSession';
import { DisplayCleanupStore } from './DisplayCleanupStore';
export const suggestionTests:SuggestionTestSession=new SuggestionTestSession(
  (business:number,payload:Uint8Array)=>probeSession.auth.sendBusiness(business,payload),
  ()=>probeSession.features.state.connected?probeSession.peerDeviceId:'',
  ()=>!probeSession.firmwareOccupied&&!probeSession.features.launcherBusy&&!probeSession.agentSuggestionOccupied&&!probeSession.agentCaptureOccupied&&!notifications.occupied&&!probeSession.voice.active&&!probeSession.voice.pendingWrites&&!probeSession.features.displayActive&&!probeSession.recordingOccupied()&&!probeSession.prompterOccupied()&&!probeSession.lifelogOccupied()
);
export const notifications:NotificationSession=new NotificationSession(
  (business:number,payload:Uint8Array)=>probeSession.auth.sendBusiness(business,payload),
  ()=>probeSession.features.state.connected?probeSession.peerDeviceId:'',
  ()=>!probeSession.firmwareOccupied&&!probeSession.features.launcherBusy&&!probeSession.agentSuggestionOccupied&&!probeSession.agentCaptureOccupied&&!suggestionTests.active&&!probeSession.voice.active&&!probeSession.voice.pendingWrites&&!probeSession.features.displayActive&&!probeSession.recordingOccupied()&&!probeSession.prompterOccupied()&&!probeSession.lifelogOccupied()
);
export function initializeNotifications(filesDir:string):void{
  probeSession.notificationOccupied=():boolean=>notifications.occupied;
  const store=new DisplayCleanupStore();store.initialize(filesDir,'notification-cleanup.json');
  notifications.initialize(store);
}
