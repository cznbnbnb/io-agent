import { UIAbility } from '@kit.AbilityKit';
import { window } from '@kit.ArkUI';
import { probeSession } from '../ProbeSession';
import { lifelog, recordings } from '../RecordingService';
import { dailyCaptureLab } from '../DailyCaptureLab';

export default class DailyLabAbility extends UIAbility {
  private owns:boolean=false;
  onCreate():void{
    try{dailyCaptureLab.initialize(this.context);this.owns=true;}
    catch(error){dailyCaptureLab.phase='failed';dailyCaptureLab.note=(error as Error).message;return;}
    probeSession.background.targetAbility='DailyLabAbility';
    probeSession.onLifelog=(peer:string,payload:Uint8Array):void=>lifelog.receive(peer,payload);
    probeSession.onLifelogLauncher=(payload:Uint8Array):void=>lifelog.receiveLauncher(payload);
    probeSession.onLifelogDisconnected=():void=>dailyCaptureLab.disconnected();
    probeSession.onLifelogConnected=():void=>{}; // finite lab never auto-reopens microphone
    probeSession.lifelogOccupied=():boolean=>lifelog.active||lifelog.busy;
    probeSession.recordingOccupied=():boolean=>recordings.active||recordings.busy;
    probeSession.voice.canBegin=():boolean=>false;
  }
  onWindowStageCreate(stage:window.WindowStage):void{stage.loadContent('pages/DailyLab');}
  onForeground():void{if(this.owns)probeSession.resume(this.context).catch(():void=>{});}
  onBackground():void{if(this.owns)probeSession.suspend();}
  onDestroy():void{
    if(!this.owns)return;
    dailyCaptureLab.dispose();probeSession.foreground=false;probeSession.stop();
  }
}
