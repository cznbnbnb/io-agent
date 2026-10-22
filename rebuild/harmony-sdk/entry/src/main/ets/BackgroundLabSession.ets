import { common } from '@kit.AbilityKit';
import { fileIo as fs } from '@kit.CoreFileKit';
import { http } from '@kit.NetworkKit';
import { GuestAuthProbeReport, generalStatusQuery } from 'turbo_core';
import { probeSession } from './ProbeSession';
import { AsrEngineClient } from './AsrEngine';
import { readTranscriptionSignals } from './TranscriptionSignals';
import { admitTranscription } from './TranscriptionBudget';

class BackgroundSample {
  t: number = 0; event: string = ''; foreground: boolean = false; lease: boolean = false;
  phase: string = ''; statusReplies: number = 0; rxBytes: number = 0;
  querySubmitted: boolean = false; workerMs: number = -1; network: string = 'not_run';
  battery: number = -1; charging: boolean = false; thermal: number = -1;
  freeBytes: number = -1; screenKnown: boolean = false; screenActive: boolean = false;
  admission: string = ''; error: string = '';
}
class BackgroundTrial {
  schema: number = 1; kind: string = 'p12_readonly_diagnostics';
  startedAt: number = 0; deadline: number = 0; completedAt: number = 0;
  reason: string = ''; samples: BackgroundSample[] = [];
}
// Separate finite trial: no recording, production network, user data, or preference writes.
export class BackgroundLabSession {
  active: boolean = false;
  note: string = '尚未运行后台只读实验';
  changed: () => void = (): void => {};
  private trial: BackgroundTrial = new BackgroundTrial();
  private context: common.UIAbilityContext | undefined = undefined;
  private engine: AsrEngineClient | undefined = undefined;
  private auth: GuestAuthProbeReport = new GuestAuthProbeReport();
  private timer: number = -1;
  private watchdog: number = -1;
  private busy: boolean = false;
  private generation: number = 0;
  private ownsLease: boolean = false;
  observeAuth(report: GuestAuthProbeReport): void { this.auth = report; }
  async start(context: common.UIAbilityContext): Promise<void> {
    if (this.active || this.busy || !probeSession.foreground || probeSession.connection.phase !== 'ready') return;
    this.active = true; const token = ++this.generation; this.context = context;
    this.trial = new BackgroundTrial(); this.trial.startedAt = Date.now(); this.trial.deadline = Date.now() + 90000;
    this.ownsLease = !probeSession.background.active;
    try {
      await probeSession.background.start(context);
      if (token !== this.generation) return;
      if (!probeSession.background.active) { await this.stop('background_denied'); return; }
      this.engine = new AsrEngineClient(context.filesDir, (_p: number, _n: string): void => {});
      this.note = '只读实验进行中 · 90 秒后自动结束'; this.changed();
      this.watchdog = setTimeout((): void => { this.stop('deadline'); }, 90000);
      await this.sample(token, 'start');
      if (token === this.generation && this.active) this.timer = setInterval((): void => { this.sample(token, 'tick'); }, 8000);
    } catch (_) { await this.stop('start_failed'); }
  }
  resume(): void { if (this.active && Date.now() >= this.trial.deadline) this.stop('deadline_on_resume'); }
  private persist(): void {
    if (!this.context) return;
    const file = fs.openSync(this.context.filesDir + '/p12-background.json', fs.OpenMode.CREATE | fs.OpenMode.READ_WRITE | fs.OpenMode.TRUNC);
    try { fs.writeSync(file.fd, JSON.stringify(this.trial)); fs.fsyncSync(file.fd); }
    finally { fs.closeSync(file.fd); }
  }
  private async sample(token: number, event: string): Promise<void> {
    if (!this.active || this.busy || token !== this.generation || !this.context) return;
    if (Date.now() >= this.trial.deadline) { await this.stop('deadline'); return; }
    this.busy = true;
    const s = new BackgroundSample(); s.t = Date.now(); s.event = event;
    s.foreground = probeSession.foreground; s.lease = probeSession.background.active;
    s.phase = probeSession.connection.phase; s.statusReplies = this.auth.statusReplies; s.rxBytes = this.auth.rxBytes;
    const request = http.createHttp();
    try {
      const signals = await readTranscriptionSignals(this.context.filesDir);
      s.battery = signals.conditions.batteryPercent; s.charging = signals.conditions.charging;
      s.thermal = signals.thermalLevel; s.freeBytes = signals.conditions.freeBytes;
      s.screenKnown = signals.screenKnown; s.screenActive = signals.screenActive;
      if (s.phase === 'ready' && s.lease) {
        try { await probeSession.auth.sendBusiness(15, generalStatusQuery()); s.querySubmitted = true; }
        catch (_) { s.error = 'query_failed'; }
      }
      const before = Date.now();
      try {
        if (!this.engine) throw new Error('worker_absent');
        await this.engine.healthcheck(); s.workerMs = Date.now() - before;
      } catch (_) { s.error += '|worker_unavailable'; }
      signals.conditions.foreground = s.foreground; signals.conditions.bluetoothLease = s.lease;
      signals.conditions.workerReady = s.workerMs >= 0;
      s.admission = admitTranscription(signals.conditions).reason;
      try {
        // Device loopback only, optionally mapped to an ephemeral PC fixture with hdc rport.
        const response = await request.request('http://127.0.0.1:18765/p12', {
          method: http.RequestMethod.GET, connectTimeout: 2000, readTimeout: 2000, usingCache: false
        });
        s.network = response.responseCode === 200 && typeof response.result === 'string' &&
          response.result.startsWith('p12-local-fixture:') ? 'fixture_received' : 'unexpected_response';
      } catch (_) { s.network = 'offline_or_unreachable'; }
    } catch (_) { s.error += '|sample_failed'; }
    finally {
      request.destroy(); this.busy = false;
      if (token === this.generation && this.active) {
        this.trial.samples.push(s); try { this.persist(); } catch (_) { this.note = '实验记录写入失败'; }
        this.changed();
      }
    }
  }
  async stop(reason: string = 'manual'): Promise<void> {
    if (!this.active) return;
    this.active = false; ++this.generation;
    if (this.timer !== -1) clearInterval(this.timer); if (this.watchdog !== -1) clearTimeout(this.watchdog);
    this.timer = -1; this.watchdog = -1; this.engine?.close(); this.engine = undefined;
    if (this.ownsLease) await probeSession.background.stop('只读实验结束，已释放临时后台任务');
    this.ownsLease = false;
    this.trial.completedAt = Date.now(); this.trial.reason = reason;
    this.note = '只读实验结束 · ' + reason;
    try { this.persist(); } catch (_) { this.note += ' · 记录保存失败'; }
    if (!probeSession.foreground && !probeSession.background.active) probeSession.stop();
    this.changed();
  }
}
export const backgroundLab = new BackgroundLabSession();
