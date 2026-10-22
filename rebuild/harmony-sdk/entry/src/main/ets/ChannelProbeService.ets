import { util } from '@kit.ArkTS';
import { cryptoFramework } from '@kit.CryptoArchitectureKit';
import { probeSession } from './ProbeSession';
import { ChannelProbeControl,ChannelProbeSnapshot } from './ChannelProbeControl';
import { notifications,suggestionTests } from './NotificationService';

function digest(text: string): string {
  const input = new util.TextEncoder().encodeInto(text), md = cryptoFramework.createMd('SHA256');
  try {
    md.updateSync({data: input}); const bytes = md.digestSync().data;
    try { return Array.from(bytes).map((value: number): string => value.toString(16).padStart(2,'0')).join(''); }
    finally { bytes.fill(0); }
  } finally { input.fill(0); }
}
export function channelProbeSnapshot(): ChannelProbeSnapshot {
  const f = probeSession.features, state = f.state, value = new ChannelProbeSnapshot();
  value.connected = state.connected; value.foreground = probeSession.foreground; value.connection = state.connectionRev;
  value.peer = state.connected && probeSession.peerDeviceId ? digest(probeSession.peerDeviceId) : '';
  value.active = f.displayActive; value.closing = f.displayClosing; value.ready = state.displayReady;
  value.blocked = f.displayCleanupBlocked; value.can_cleanup = f.displayCanCleanup;
  value.operation_id = f.displayStartOperation;
  value.exit_operation_id = state.displayExitEvidence !== 'none' ? state.displayLastOperation : '';
  value.binding = f.displaySessionId ? digest(value.peer + '\n' + String(value.connection) + '\n' + f.displaySessionId + '\n' + value.operation_id) : '';
  value.ack_code = state.displayAckCode; value.audio_packets = state.displayAudioPackets; value.text_writes = state.displayTextWrites;
  value.ack_config = state.displayAckConfig; value.text_profile = state.displayTextProfile;
  value.stop_submitted = state.displayStopSubmitted; value.exit_evidence = state.displayExitEvidence;
  value.started_at = state.displayStartedAt; value.note = state.display.slice(0,256);
  value.notice_target_seconds = notifications.timingSeconds; value.notice_submission = notifications.timingSubmission;
  value.notice_can_configure = value.foreground && value.connected && !f.launcherBusy && !value.active &&
    !probeSession.voice.active && !probeSession.voice.pendingWrites && !probeSession.recordingOccupied() && !probeSession.lifelogOccupied() &&
    !probeSession.prompterOccupied() && !probeSession.agentCaptureOccupied && !probeSession.agentSuggestionOccupied &&
    !suggestionTests.active && !notifications.occupied;
  value.notice_binding = value.notice_can_configure ? digest(value.peer + '\n' + String(value.connection) + '\nnotice\n' +
    String(value.notice_target_seconds) + '\n' + value.notice_submission) : '';
  return value;
}
export function makeChannelProbeControl(command: () => string | undefined,
  result: (id: string) => string | undefined, save: (id: string, json: string) => void): ChannelProbeControl {
  return new ChannelProbeControl({command, result, save, status: channelProbeSnapshot,
    start: (text: string, holdMs: number, operation: string, profile: string): Promise<void> => probeSession.features.show(text, false, holdMs, operation, profile),
    update: (text: string, profile: string): Promise<void> => probeSession.features.updateDisplay(text, profile),
    stop: (): Promise<void> => probeSession.features.stopDisplay(),
    noticeTiming: (seconds: number): Promise<void> => {
      if(!channelProbeSnapshot().notice_can_configure)throw new Error('CHANNEL_NOTICE_NOT_READY');
      return notifications.setDisplaySeconds(seconds);
    }});
}
