import { UIAbility } from '@kit.AbilityKit';
import { window } from '@kit.ArkUI';
import { probeSession } from '../ProbeSession';
import { suggestionTests } from '../NotificationService';
import { backgroundLab } from '../BackgroundLabSession';
import { GuestAuthProbeReport } from 'turbo_core';
import { recordingLab } from '../RecordingLabSession';

// Launch only in a cold process. Deliberately does not import AppRuntime or
// RecordingService: no historical transcription, upload, or audio pruning.
export default class SuggestionLabAbility extends UIAbility {
  onCreate(): void {
    probeSession.background.targetAbility = 'SuggestionLabAbility';
    probeSession.onAuth = (report: GuestAuthProbeReport): void => backgroundLab.observeAuth(report);
    recordingLab.initialize(this.context);
    probeSession.onRecording = (peer:string,payload:Uint8Array):void=>recordingLab.recorder.receive(peer,payload);
    probeSession.onRecordingDisconnected = ():void=>recordingLab.disconnected();
    probeSession.recordingOccupied = ():boolean=>recordingLab.recorder.active||recordingLab.recorder.busy;
    suggestionTests.initialize(this.context.filesDir);
    probeSession.onNotification = (peer: string, payload: Uint8Array): void => suggestionTests.receive(peer, payload);
    probeSession.onNotificationDisconnected = (): void => suggestionTests.disconnected();
    probeSession.voice.canBegin = (): boolean => false;
  }
  onWindowStageCreate(stage: window.WindowStage): void { stage.loadContent('pages/SuggestionLab'); }
  onForeground(): void { backgroundLab.resume(); probeSession.resume(this.context).catch((): void => {}); }
  onBackground(): void { probeSession.suspend(); }
  onDestroy(): void {
    backgroundLab.stop('ability_destroyed');
    recordingLab.dispose();
    suggestionTests.disconnected(); probeSession.foreground = false; probeSession.stop();
  }
}
