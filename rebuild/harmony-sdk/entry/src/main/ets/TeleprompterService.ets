import { TeleprompterSession } from './TeleprompterSession';
import { probeSession } from './ProbeSession';
import { TeleprompterFollow } from './TeleprompterFollow';
import { common } from '@kit.AbilityKit';
import { TeleprompterCatalog } from './TeleprompterCatalog';
import { interactiveTranscriptionBusy,resumePendingTranscriptions } from './RecordingService';
import { DisplayCleanupStore } from './DisplayCleanupStore';

// Unsaved editor state belongs to this App process, not a mounted page.
// Saved manuscripts continue to use LocalWorkspace; no automatic cloud upload.
export class TeleprompterDraft {
  title:string='';text:string='';speed:number=120;confirmedSpeed:number=120;mode:number=2;asrSource:string='local';
  busy:boolean=false;note:string='';
  changed:()=>void=():void=>{};
}
export const teleprompterDraft:TeleprompterDraft=new TeleprompterDraft();
const follow:TeleprompterFollow=new TeleprompterFollow();
const cleanup:DisplayCleanupStore=new DisplayCleanupStore();
export const teleprompterCatalog:TeleprompterCatalog=new TeleprompterCatalog((business:number,payload:Uint8Array)=>probeSession.auth.sendBusiness(business,payload),()=>probeSession.features.state.connected?probeSession.peerDeviceId:'');
export function initializeTeleprompter(context:common.UIAbilityContext):void{cleanup.initialize(context.filesDir,'teleprompter-cleanup.json');teleprompter.initializeCleanup(cleanup);if(probeSession.features.state.connected)teleprompter.connected();follow.initialize(context);try{teleprompterCatalog.initialize(context);}catch(_){teleprompterCatalog.note='稿件标题记录待核对；正文提词仍可使用';}}
export function disposeTeleprompter():void{teleprompter.disconnected();follow.stop();}
export const teleprompter:TeleprompterSession=new TeleprompterSession(
  (business:number,payload:Uint8Array)=>probeSession.auth.sendBusiness(business,payload),
  ()=>probeSession.features.state.connected?probeSession.peerDeviceId:'',
  ()=>!probeSession.firmwareOccupied&&probeSession.foreground&&!probeSession.features.launcherBusy&&!probeSession.notificationOccupied()&&!probeSession.agentSuggestionOccupied&&!probeSession.agentCaptureOccupied&&!probeSession.voice.active&&!probeSession.voice.pendingWrites&&!probeSession.features.displayActive&&!probeSession.recordingOccupied()&&!probeSession.lifelogOccupied()&&!interactiveTranscriptionBusy(),
  follow
);
teleprompter.onIdle=():void=>{void follow.waitForExit().then(():void=>resumePendingTranscriptions());};
// Playback does not own the glasses file list. The 118-122 hardware trials
// accumulated one catalog row per completed transfer (owned 6,7,8,9,10); the
// first failure appeared when the eighth row was written, and later uploads
// rebooted the glasses shortly after the same batchAdd. Keep the title on the
// phone and leave the glasses list untouched from this critical path.
teleprompter.onCompletedFile=(_peer:string,_did:string,_title:string,_text:string,_total:number,_mode:number):void=>{
  teleprompterCatalog.note='标题仅保存在手机，眼镜目录同步暂不可用';
};
teleprompter.onListPacket=(peer:string,business:number,payload:Uint8Array):void=>teleprompterCatalog.receive(peer,business,payload);
teleprompter.onListDisconnect=():void=>teleprompterCatalog.disconnect();
