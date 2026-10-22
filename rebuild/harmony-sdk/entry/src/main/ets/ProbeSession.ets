import { Candidate, Discovery, DiscoveryReport, TransportProbe, ProbeReport, BleHandshakeTransport, BleHandshakeReport, readLauncherEnvelope } from 'turbo_core';
import { BleVersionProbe, VersionProbeReport, AndroidVersionReply, LocalProtocolIdentity, AndroidVersionRequest } from 'turbo_core';
import { BleGuestAuthProbe, GuestAuthProbeReport } from 'turbo_core';
import { common, abilityAccessCtrl } from '@kit.AbilityKit';
import { backgroundTaskManager } from '@kit.BackgroundTasksKit';
import { hilog } from '@kit.PerformanceAnalysisKit';
import { fileIo as fs } from '@kit.CoreFileKit';
import { util } from '@kit.ArkTS';
import { DeviceFeatures } from './DeviceFeatures';
import { DisplayCleanupStore } from './DisplayCleanupStore';
import { VoiceSession } from './VoiceSession';
import { ConnectionStore, SavedGlasses } from './ConnectionStore';
import { BluetoothBackground } from './BluetoothBackground';

export class ConnectionView {
  phase: string = 'idle';
  note: string = '添加你的眼镜，开始连接';
  name: string = 'RayNeo iO';
  saved: boolean = false;
  autoConnect: boolean = true;
  battery: number = -1;
  seconds: number = 0;
  backgroundReport: string = '后台保持尚未测试';
  transportStage: string = 'idle';
}

class ProbeSession {
  background: BluetoothBackground = new BluetoothBackground();
  private backgroundAt: number = 0;
  private backgroundIntent: number = 0;
  private suspendCloseGeneration:number=0;
  private suspendCloseTimer:number=-1;
  private suspendCloseRequest:number=-1;
  connection: ConnectionView = new ConnectionView();
  onConnection: () => void = (): void => {};
  private store: ConnectionStore = new ConnectionStore();
  private saved: SavedGlasses = new SavedGlasses();
  private context: common.Context | undefined = undefined;
  private loaded: Promise<void> | undefined = undefined;
  private displayCleanup: DisplayCleanupStore = new DisplayCleanupStore();
  private displayCleanupReady: boolean = false;
  private voiceCleanup: DisplayCleanupStore = new DisplayCleanupStore();
  private voiceCleanupReady: boolean = false;
  private managed: boolean = false;
  private paused: boolean = false;
  private selected: Candidate | undefined = undefined;
  private retry: number = -1;
  private initializeTimer: number = -1;
  private retries: number = 0;
  private recoveryIntent: number = -1;
  private recoveryTried: boolean = false;
  private pairingRetryUsed: boolean = false;
  private authDiagnostic: string = '';
  private saving: boolean = false;
  private storeFailed: boolean = false;
  private servicesReady: boolean = false;
  foreground: boolean = true;
  firmwareOccupied:boolean=false;
  firmwareReconnectAllowed:boolean=false;
  onFirmware:(peer:string,payload:Uint8Array,generation:number)=>void=():void=>{};
  onFirmwareDisconnected:()=>void=():void=>{};
  onDiscovery: (report: DiscoveryReport) => void = (_: DiscoveryReport): void => {};
  onProbe: (report: ProbeReport) => void = (_: ProbeReport): void => {};
  onHandshake: (report: BleHandshakeReport) => void = (_: BleHandshakeReport): void => {};
  onVersion: (report: VersionProbeReport) => void = (_: VersionProbeReport): void => {};
  identity: LocalProtocolIdentity = new LocalProtocolIdentity();
  peerInfo: AndroidVersionReply | null = null;
  peerDeviceId: string = '';
  onAuth: (report: GuestAuthProbeReport) => void = (_: GuestAuthProbeReport): void => {};
  onTodo: (peer:string,payload:Uint8Array)=>void = (_peer:string,_payload:Uint8Array):void=>{};
  todoEpoch:number=0;
  onTodoLifecycle:()=>void=():void=>{};
  onNavigationSuspend: ()=>void = ():void=>{};
  onFileTranscriptionSuspend: ()=>void = ():void=>{};
  onRecording: (peer:string,payload:Uint8Array)=>void = (_peer:string,_payload:Uint8Array):void=>{};
  onRecordingDisconnected: ()=>void = ():void=>{};
  recordingOccupied: ()=>boolean = ():boolean=>false;
  onPrompter: (peer:string,business:number,payload:Uint8Array)=>void = (_peer:string,_business:number,_payload:Uint8Array):void=>{};
  onPrompterDisconnected: ()=>void = ():void=>{};
  onPrompterConnected: ()=>void = ():void=>{};
  onPrompterSuspend: ()=>Promise<boolean> = ():Promise<boolean>=>Promise.resolve(true);
  prompterOccupied: ()=>boolean = ():boolean=>false;
  onNotification: (peer:string,payload:Uint8Array)=>void = (_peer:string,_payload:Uint8Array):void=>{};
  onNotificationDisconnected: ()=>void = ():void=>{};
  onLifelog: (peer:string,payload:Uint8Array)=>void = (_peer:string,_payload:Uint8Array):void=>{};
  onLifelogLauncher: (payload:Uint8Array)=>void = (_payload:Uint8Array):void=>{};
  onLifelogDisconnected: ()=>void = ():void=>{};
  onLifelogConnected: ()=>void = ():void=>{};
  lifelogOccupied: ()=>boolean = ():boolean=>false;
  notificationOccupied: ()=>boolean = ():boolean=>false;
  agentCaptureOccupied:boolean=false;
  agentSuggestionOccupied:boolean=false;
  onAgentCapture:(peer:string,business:number,payload:Uint8Array,generation:number)=>boolean=():boolean=>false;
  onAgentCaptureDisconnected:()=>void=():void=>{};
  features: DeviceFeatures = new DeviceFeatures((business: number, payload: Uint8Array): Promise<void> => this.auth.sendBusiness(business,payload));
  voice: VoiceSession = new VoiceSession((business: number, payload: Uint8Array): Promise<void> => this.auth.sendBusiness(business,payload),():string=>this.peerDeviceId,():number=>this.features.state.connectionRev);
  auth: BleGuestAuthProbe = new BleGuestAuthProbe((report: GuestAuthProbeReport): void => {
    const ready = report.stage === 'connected' && report.bonded && report.statusReplies > 0;
    const changed = ready !== this.servicesReady;
    this.servicesReady = ready;
    this.features.connected(ready, ready ? report.battery : -1);
    this.voice.connected(ready);
    if (changed && !ready) this.disconnectServices();
    if (changed && ready) { this.onLifelogConnected(); this.onPrompterConnected(); }
    this.onAuth(report);
    this.authChanged(report);
    if(changed&&ready)this.todoStateChanged();
  });
  constructor() {
    this.features.canDisplayBegin = (): boolean => !this.firmwareOccupied && !this.notificationOccupied() && !this.agentCaptureOccupied && !this.agentSuggestionOccupied &&
      !this.voice.active && !this.voice.pendingWrites && !this.recordingOccupied() && !this.prompterOccupied() && !this.lifelogOccupied();
    this.features.canSettingsWrite=():boolean=>this.foreground&&!this.features.displayActive&&this.features.canDisplayBegin();
    this.voice.canBegin=():boolean=>!this.firmwareOccupied&&this.foreground&&!this.features.launcherBusy&&!this.notificationOccupied()&&!this.agentCaptureOccupied&&!this.agentSuggestionOccupied&&!this.recordingOccupied()&&!this.prompterOccupied()&&!this.features.displayActive;
    this.features.onTx = (type: number, json: string): void => {
      if (!this.context) return;
      try { this.appendLog(this.context.filesDir + '/launcher-rx.jsonl', JSON.stringify({ t: Date.now(), dir: 'tx', type: type, json: json }) + '\n', 524288); } catch (_) {}
    };
    this.auth.onBusiness = (business: number, payload: Uint8Array, peer: string, generation: number): void => {
      if(business===9){this.onFirmware(peer,payload,generation);return;}
      if (business === 15) this.launcherLog(payload);
      this.features.receive(business,payload,peer);
      // 全天智记：business 13 信封 type 161-168 与 business 15 的 life_log_* 回报，分流到 lifelog，不进语音
      if(business===13){let ll=false;try{const t=readLauncherEnvelope(payload).type;ll=t>=161&&t<=168;}catch(_){}if(ll){this.onLifelog(peer,payload);return;}}
      if(business===15){try{if(new util.TextDecoder().decodeToString(readLauncherEnvelope(payload).json).includes('life_log'))this.onLifelogLauncher(payload);}catch(_){}}
      if(this.onAgentCapture(peer,business,payload,generation))return;
      this.voice.receive(business,payload,peer);
      if(business===22)this.onTodo(peer,payload);if(business===14)this.onRecording(peer,payload);if(business===17||business===18||business===20)this.onPrompter(peer,business,payload);if(business===21)this.onNotification(peer,payload);
    };
    this.background.changed = (): void => this.onConnection();
    this.background.revoked = (): void => {
      this.connection.backgroundReport = '后台任务被系统收回；未继续后台连接';
      if (!this.foreground) this.stop();
      this.onConnection();
    };
  }
  version: BleVersionProbe = new BleVersionProbe((report: VersionProbeReport): void => {
    if (report.transportStage && report.transportStage !== this.connection.transportStage) {
      this.connection.transportStage = report.transportStage;
      this.trace('version-transport', report.transportStage); this.onConnection();
    }
    this.onVersion(report); this.versionChanged(report);
  },
    (reply: AndroidVersionReply): void => { this.peerInfo = reply; });
  private intent: number = 0;
  discovery: Discovery = new Discovery((report: DiscoveryReport): void => { this.onDiscovery(report); });
  private recoveryDiscovery: Discovery = new Discovery((report: DiscoveryReport): void => this.recoveryChanged(report));
  probe: TransportProbe = new TransportProbe((report: ProbeReport): void => { this.onProbe(report); });
  handshake: BleHandshakeTransport = new BleHandshakeTransport(
    (report: BleHandshakeReport): void => { this.onHandshake(report); },
    (_token: number, _bytes: Uint8Array): void => {});

  private lastPublishKey: string = '';
  private publish(phase: string, note: string): void {
    // 真机实测：状态回读回调每秒重复一次，重复发布只刷 debug-conn.log（已到 5MB）与 UI，无信息量。
    const key = `${phase}|${note}`;
    if (key === this.lastPublishKey) return;
    this.lastPublishKey = key;
    this.connection.phase = phase; this.connection.note = note; this.onConnection();
    this.trace(phase, note);
  }
  // 连接流程留痕：把每次状态迁移写进沙盒 debug-conn.log，便于事后定位卡点。
  private trace(phase: string, note: string): void {
    if (!this.context) return;
    try {
      const path = this.context.filesDir + '/debug-conn.log';
      const exists = fs.accessSync(path);
      const file = fs.openSync(path, fs.OpenMode.CREATE | fs.OpenMode.READ_WRITE);
      try {
        if (exists) fs.lseek(file.fd, fs.statSync(path).size, fs.WhenceType.SEEK_SET);
        const line = JSON.stringify({ t: Date.now(), phase: phase, note: note, retries: this.retries }) + '\n';
        const buf = new util.TextEncoder().encodeInto(line);
        let off = 0; while (off < buf.length) { const n = fs.writeSync(file.fd, buf.slice(off).buffer); if (n <= 0) break; off += n; }
        fs.fsyncSync(file.fd);
      } finally { fs.closeSync(file); }
    } catch (_) { /* 留痕失败不影响连接 */ }
  }
  async prepare(context: common.Context): Promise<void> {
    this.context = context;
    if (!this.voiceCleanupReady) {
      this.voiceCleanup.initialize(context.filesDir,'voice-cleanup.json');
      this.voice.initializeCleanup(this.voiceCleanup);this.voiceCleanupReady=true;
    }
    if (!this.displayCleanupReady) {
      this.displayCleanup.initialize(context.filesDir);
      this.features.initializeDisplayCleanup(this.displayCleanup, (): string => this.peerDeviceId);
      this.displayCleanupReady = true;
    }
    if (this.loaded === undefined) this.loaded = this.restore(context);
    await this.loaded;
  }
  // 协议留痕：business 15 的全部 JSON 信封追加进 launcher-rx.jsonl（超 512KB 重开），
  // type 4（通用设置）另存 last-general-settings.json，供 hdc 拉回分析。
  private launcherLog(payload: Uint8Array): void {
    if (!this.context) return;
    try {
      const env = readLauncherEnvelope(payload);
      if (env.json.length === 0 || env.json.length > 6000) return;
      const text = new util.TextDecoder().decodeToString(env.json);
      const line = JSON.stringify({ t: Date.now(), dir: 'rx', type: env.type, seq: env.sequence, json: text }) + '\n';
      this.appendLog(this.context.filesDir + '/launcher-rx.jsonl', line, 524288);
      if (env.type === 4) this.writeText(this.context.filesDir + '/last-general-settings.json', text);
    } catch (_) { /* 留痕失败不影响业务 */ }
  }
  private appendLog(path: string, line: string, maxBytes: number): void {
    let size = 0;
    try { size = fs.statSync(path).size; } catch (_) { size = 0; }
    if (size > maxBytes) { try { fs.unlink(path); } catch (_) {} size = 0; }
    const file = fs.openSync(path, fs.OpenMode.CREATE | fs.OpenMode.READ_WRITE);
    try {
      if (size > 0) fs.lseek(file.fd, size, fs.WhenceType.SEEK_SET);
      const buf = new util.TextEncoder().encodeInto(line);
      let off = 0; while (off < buf.length) { const n = fs.writeSync(file.fd, buf.slice(off).buffer); if (n <= 0) break; off += n; }
    } finally { fs.closeSync(file); }
  }
  private writeText(path: string, content: string): void {
    const file = fs.openSync(path, fs.OpenMode.CREATE | fs.OpenMode.READ_WRITE | fs.OpenMode.TRUNC);
    try {
      const buf = new util.TextEncoder().encodeInto(content);
      let off = 0; while (off < buf.length) { const n = fs.writeSync(file.fd, buf.slice(off).buffer); if (n <= 0) break; off += n; }
    } finally { fs.closeSync(file); }
  }
  private async restore(context: common.Context): Promise<void> {
    try {
      this.saved = await this.store.load(context);
      this.connection.saved = !!this.saved.id; this.connection.autoConnect = this.saved.autoConnect;
      this.connection.name = this.saved.name;
      this.publish('idle', this.saved.id ? '已记住眼镜，准备连接' : '首次连接请先完成权限与配对');
    } catch (_) { this.storeFailed = true; this.paused = true; this.publish('failed', '已保存的连接信息无法读取；不会覆盖原身份，请检查诊断'); }
  }
  private permitted(): boolean {
    if (!this.context) return false;
    try { return abilityAccessCtrl.createAtManager().checkAccessTokenSync(this.context.applicationInfo.accessTokenId,
      'ohos.permission.ACCESS_BLUETOOTH') === 0; } catch (_) { return false; }
  }
  async resume(context: common.Context): Promise<void> {
    this.cancelSuspendClose();
    if (this.backgroundAt > 0) {
      const seconds = Math.max(0, Math.floor((Date.now() - this.backgroundAt) / 1000));
      const retained = this.backgroundIntent === this.intent && this.connection.phase === 'ready' && this.background.active;
      this.connection.backgroundReport = '上次后台 ' + seconds + ' 秒 · ' + (retained ? '同一连接保持，未重新认证' : '未确认连续保持');
      this.backgroundAt = 0;
    }
    this.foreground = true; await this.prepare(context);this.todoStateChanged();
    this.onConnection();
    if (!this.foreground || this.managed || this.retry !== -1 || this.recoveryIntent >= 0 || this.paused || !this.saved.id || !this.saved.autoConnect) return;
    if (!this.permitted()) { this.publish('permission', '请先允许蓝牙权限'); return; }
    this.retries = 0; await this.connect(this.savedCandidate(), context);
  }
  private savedCandidate(): Candidate {
    const c = new Candidate(); c.id = this.saved.id; c.deviceName = this.saved.name; c.serviceMatched = true; return c;
  }
  async reconnect(context: common.Context): Promise<void> {
    await this.prepare(context);
    if (!this.saved.id) { this.publish('idle', '请先扫描并选择你的眼镜'); return; }
    await this.connect(this.savedCandidate(), context);
  }
  matchesSavedAddress(candidate: Candidate): boolean { return !!this.saved.id && candidate.id === this.saved.id; }
  async setAutoConnect(value: boolean): Promise<void> {
    const old = this.saved.autoConnect; this.saved.autoConnect = value;
    try { if (this.saved.id && this.context) await this.store.save(this.context, this.saved); }
    catch (_) { this.saved.autoConnect = old; this.publish(this.connection.phase, '自动连接设置未保存，请重试'); return; }
    this.connection.autoConnect = value;
    if (!value && ['retrying', 'scanning'].includes(this.connection.phase)) this.stop();
    this.onConnection();
  }
  async connect(candidate: Candidate, context: common.Context): Promise<void> {
    await this.connectCandidate(candidate, context, false);
  }
  // Explicit recovery from a user-selected BLE scan result. Address is a route,
  // never proof of identity: both version exchanges and guest proof still run.
  async recoverSavedAddress(candidate: Candidate, context: common.Context): Promise<void> {
    await this.prepare(context);
    if (!this.saved.id || !/^[0-9a-f]{12}$/.test(this.saved.peer)) {
      this.publish('failed', '没有可核对的原眼镜身份，请先完成首次连接'); return;
    }
    await this.connectCandidate(candidate, context, true);
  }
  private async connectCandidate(candidate: Candidate, context: common.Context, recoverAddress: boolean): Promise<void> {
    if(this.firmwareOccupied&&!this.firmwareReconnectAllowed)return;
    await this.prepare(context);
    if (this.storeFailed) { this.publish('failed', '原连接信息不可读，已停止；不会覆盖原身份'); return; }
    if (!this.foreground || candidate.classic || !candidate.id || candidate.id.length > 128 || this.connection.phase === 'ready' || this.saving) return;
    if (!this.permitted()) { this.publish('permission', '请先允许蓝牙权限'); return; }
    if (this.saved.id && this.saved.id !== candidate.id && !recoverAddress) { this.publish('failed', '已有绑定眼镜；不会自动替换，请先核对设备'); return; }
    this.stop(); this.paused = false; this.managed = true; this.selected = candidate; this.retries = 0;
    this.recoveryTried = false; this.pairingRetryUsed = false;
    if (recoverAddress && candidate.id !== this.saved.id) this.trace('address-recovery', 'checking-saved-peer');
    await this.beginManaged();
  }
  private async beginManaged(): Promise<void> {
    if (!this.context || !this.selected || !this.canRun() || !this.managed) return;
    const generation = this.intent;
    this.authDiagnostic = '';
    this.publish('connecting', '正在连接眼镜并核对设备身份…');
    try {
      const phone = await this.identity.get(this.context);
      try {
        if (generation !== this.intent || !this.managed || !this.canRun() || !this.selected) return;
        this.peerInfo = null; this.peerDeviceId = this.selected.id;
        this.version.start(this.selected.id, this.versionInput(phone));
      } finally { phone.fill(0); }
    } catch (_) { if (generation === this.intent) this.failed('local-identity-unavailable', false); }
  }
  private versionInput(phone: Uint8Array): AndroidVersionRequest {
    const encoder = new util.TextEncoder();
    return { phoneIdentifier: phone, phoneNameUTF8: encoder.encodeInto('Turbo IO'),
      manufacturerUTF8: encoder.encodeInto('HUAWEI'), modelUTF8: encoder.encodeInto('HarmonyOS'),
      accountUTF8: null, publicKey: null, pairValue: null };
  }
  private versionChanged(report: VersionProbeReport): void {
    if (!this.managed) return;
    if (report.stage === 'failed') { this.failed(report.reason, this.transient(report.reason)); return; }
    if (report.stage !== 'received' || !this.peerInfo) return;
    const peer = this.peerInfo.peerIdentifier.slice();
    const hex = Array.from(peer).map((b: number): string => b.toString(16).padStart(2, '0')).join('');
    if (this.saved.peer && this.saved.peer !== hex) { peer.fill(0); this.failed('peer-mismatch', false); return; }
    const generation = this.intent;
    this.publish('authenticating', '身份匹配，正在认证和完成系统配对…');
    // Version probe closes its transport before delivering received. Yield before reopening.
    Promise.resolve().then(async (): Promise<void> => {
      try {
        if (!this.context || !this.selected || generation !== this.intent || !this.managed) return;
        const phone = await this.identity.get(this.context);
        try {
          if (generation !== this.intent || !this.managed || !this.canRun() || !this.selected) return;
          this.auth.start(this.selected.id, this.versionInput(phone), peer, true, true);
        } finally { phone.fill(0); }
      } catch (_) { if (generation === this.intent) this.failed('auth-start-failed', false); }
      finally { peer.fill(0); }
    });
  }
  private authChanged(report: GuestAuthProbeReport): void {
    if (!this.managed) return;
    this.connection.battery = report.battery; this.connection.seconds = report.connectedSeconds;
    if (report.stage === 'failed' || report.stage === 'closed') { this.failed(report.reason, this.transient(report.reason)); return; }
    const diagnostic = report.stage + '|' + report.reason;
    if (diagnostic !== this.authDiagnostic) {
      this.authDiagnostic = diagnostic;
      this.trace('auth-stage', 'stage=' + report.stage + ';reason=' + (/^[a-z0-9-]{0,80}$/.test(report.reason) ? report.reason : 'unclassified') + ';bonded=' + report.bonded + ';status=' + report.statusReplies);
    }
    if (report.stage === 'connected' && report.bonded) {
      if (report.statusReplies > 0) {
        const becameReady=this.connection.phase!=='ready';
        this.retries = 0;
        if (this.initializeTimer !== -1) clearTimeout(this.initializeTimer); this.initializeTimer = -1;
        this.publish('ready', '已连接 · 认证与状态回读完成');
        if (becameReady) this.features.syncTime().catch((): void => {});
        if(becameReady&&this.saved.backgroundEnabled&&this.foreground)this.setBackground(true);
        if (!this.saving && this.selected && this.saved.id !== this.selected.id) this.saveVerified();
      } else {
        this.publish('initializing', '配对完成，正在读取电量与设备状态…');
        if (this.initializeTimer === -1) {
          const generation = this.intent;
          const timer = setTimeout((): void => {
            if (generation !== this.intent || this.initializeTimer !== timer) return;
            this.initializeTimer = -1;
            if (this.managed) this.failed('status-timeout', true);
          }, 12000);
          this.initializeTimer = timer;
        }
      }
    }
  }
  private async saveVerified(): Promise<void> {
    if (!this.context || !this.selected || !this.peerInfo) return;
    this.saving = true; const generation = this.intent;
    const value = new SavedGlasses(); value.id = this.selected.id;
    value.peer = Array.from(this.peerInfo.peerIdentifier).map((b: number): string => b.toString(16).padStart(2, '0')).join('');
    const recovering = !!this.saved.id;
    if (recovering && value.peer !== this.saved.peer) { this.saving = false; this.failed('peer-mismatch', false); return; }
    value.name = (recovering ? this.saved.name : this.selected.deviceName || 'RayNeo iO').slice(0,64);
    value.autoConnect = this.connection.autoConnect; value.backgroundEnabled = this.saved.backgroundEnabled;
    try {
      await this.store.save(this.context, value); this.saved = value;
      this.connection.saved = true; this.connection.name = value.name;
      if (recovering) this.trace('address-recovery', 'saved-after-auth-and-status');
      if (generation === this.intent) this.onConnection();
    } catch (_) { if (generation === this.intent) this.publish('ready', '已连接，但自动连接信息未保存'); }
    finally { this.saving = false; }
  }
  private transient(reason: string): boolean {
    return ['transport-timeout', 'version-timeout', 'auth-timeout', 'status-timeout', 'connection-state-0',
      'disconnected', 'connection-failed', 'connect-failed', 'version-send-failed', 'send-failed'].includes(reason);
  }
  private failed(reason: string, retryable: boolean): void {
    if (!this.managed) return;
    // Preserve the original cause before closing radios and publishing retrying.
    // Only protocol error labels belong here, never addresses or exception text.
    const diagnosticReason = /^[a-z][a-z0-9-]{0,63}$/.test(reason) ? reason : 'unclassified';
    this.trace('failure', `reason=${diagnosticReason};phase=${this.connection.phase};foreground=${this.foreground};background=${this.background.active};retryable=${retryable}`);
    const pairingRetry = reason === 'send-failed' && !this.pairingRetryUsed && this.foreground &&
      ['authenticating', 'initializing', 'ready'].includes(this.connection.phase) && !!this.selected;
    this.managed = false; this.intent++; this.closeRadios();
    if (this.initializeTimer !== -1) clearTimeout(this.initializeTimer); this.initializeTimer = -1;
    const scanRecovery = reason === 'transport-timeout' && !this.recoveryTried && (this.saved.autoConnect || this.firmwareReconnectAllowed) &&
      this.foreground && !this.paused && this.selected?.id === this.saved.id && /^[0-9a-f]{12}$/.test(this.saved.peer) && this.permitted() && (!this.firmwareOccupied || this.firmwareReconnectAllowed);
    if(this.firmwareOccupied && !(this.firmwareReconnectAllowed && (pairingRetry || scanRecovery))){this.publish('failed','升级连接已断开，保留结果保护；不自动重连或重传');return;}
    if (scanRecovery) {
      this.recoveryTried = true; this.recoveryIntent = this.intent;
      this.publish('scanning', '原连接地址未响应，正在扫描核对原眼镜（15秒）…');
      this.recoveryDiscovery.start(); return;
    }
    const delays: number[] = [2000, 5000, 10000];
    const automaticRetry = retryable && reason !== 'send-failed' && this.saved.id && this.saved.autoConnect && this.retries < delays.length;
    if ((pairingRetry || automaticRetry) && this.canRun() && !this.paused) {
      const delay = pairingRetry ? 1000 : delays[this.retries++]; const generation = this.intent;
      if (pairingRetry) this.pairingRetryUsed = true;
      this.publish('retrying', pairingRetry ? '配对后的发送未完成，1秒后重试原眼镜一次…' : `连接中断，${delay / 1000} 秒后重试（${this.retries}/3）`);
      const timer = setTimeout((): void => {
        if (generation !== this.intent || this.retry !== timer) return;
        this.retry = -1;
        if (!this.canRun() || this.paused) return;
        if (pairingRetry && !this.foreground) { this.stop(); return; }
        if (!this.saved.autoConnect && !pairingRetry) {
          this.background.stop('自动连接已关闭，后台任务已释放');
          this.publish('idle', '自动连接已关闭，可手动重连已保存眼镜'); return;
        }
        if (!this.permitted()) {
          this.background.stop('蓝牙权限不可用，后台任务已释放');
          this.publish('permission', '请先允许蓝牙权限'); return;
        }
        this.managed = true; this.beginManaged();
      }, delay);
      this.retry = timer;
    } else {
      this.background.stop('连接已结束，后台任务已释放');
      this.publish('failed', reason === 'peer-mismatch' ? '眼镜身份与原绑定不符，已停止连接' : `连接未完成（${reason}）；蓝牙阶段：${this.connection.transportStage}。可扫描核对已保存眼镜；失败原因仍需日志确认。`);
    }
  }
  private recoveryChanged(report: DiscoveryReport): void {
    if (this.recoveryIntent < 0 || this.recoveryIntent !== this.intent || report.scanning) return;
    this.recoveryIntent = -1;
    if (!this.foreground || this.paused || (this.firmwareOccupied && !this.firmwareReconnectAllowed) || (!this.saved.autoConnect && !this.firmwareReconnectAllowed) || !this.permitted()) {
      this.publish('failed', '扫描恢复已停止，请检查前台状态与蓝牙权限'); return;
    }
    const matches = report.candidates.filter((c: Candidate): boolean => !c.classic && c.deviceName === this.saved.name && !!c.id && c.id.length <= 128);
    if (matches.length !== 1) {
      this.publish('failed', matches.length ? '发现多个同名眼镜，请点扫描恢复后手动选择核对' : '未发现原眼镜，请唤醒眼镜后点扫描恢复'); return;
    }
    // A matching name selects a route only. The version peer, guest proof and
    // bonded status must still match before saveVerified can persist it.
    this.selected = matches[0]; this.managed = true; void this.beginManaged();
  }
  private canRun(): boolean { return this.foreground || this.background.active; }
  async setBackground(enabled: boolean): Promise<void> {
    if (!enabled) { await this.background.stop();await this.saveBackgroundPreference(false);if (!this.foreground) this.stop(); return; }
    if (!this.foreground || this.connection.phase !== 'ready' || !this.context) {
      this.background.note='请保持 App 前台并等待眼镜连接完成';this.onConnection();return;
    }
    const generation = this.intent; await this.background.start(this.context);
    if (generation !== this.intent || this.connection.phase !== 'ready') await this.background.stop('连接已变化，请重新开启后台保持');
    else if(this.background.active)await this.saveBackgroundPreference(true);
  }
  private async saveBackgroundPreference(enabled:boolean):Promise<void>{
    if(!this.context||!this.saved.id||this.saved.backgroundEnabled===enabled)return;
    const old=this.saved.backgroundEnabled;this.saved.backgroundEnabled=enabled;
    try{await this.store.save(this.context,this.saved);}
    catch(_){this.saved.backgroundEnabled=old;this.background.note+=' · 偏好保存失败，下次启动需手动开启';this.onConnection();}
  }
  private cancelSuspendClose():void{
    this.suspendCloseGeneration++;
    if(this.suspendCloseTimer!==-1)clearTimeout(this.suspendCloseTimer);this.suspendCloseTimer=-1;
    const request=this.suspendCloseRequest;this.suspendCloseRequest=-1;
    if(request!==-1){try{backgroundTaskManager.cancelSuspendDelay(request);}catch(_){hilog.warn(0x2a03,'TurboIO','prompter-bg-close release-unconfirmed');}}
  }
  private finishSuspendClose(generation:number,intent:number,paused:boolean,reason:string):void{
    if(generation!==this.suspendCloseGeneration)return;
    this.cancelSuspendClose();
    hilog.info(0x2a03,'TurboIO','prompter-bg-close reason=%{public}s',reason);
    if(this.foreground||this.background.active||intent!==this.intent)return;
    this.stop();this.paused=paused;
  }
  suspend(): void {
    if(this.firmwareOccupied){this.foreground=false;this.connection.backgroundReport='固件升级结果保护中，保持原连接；不自动退出或重传';this.onConnection();return;}
    // Do not renew a bounded cleanup window on duplicate lifecycle callbacks.
    if(!this.foreground&&this.suspendCloseTimer!==-1)return;
    this.onNavigationSuspend();
    this.onFileTranscriptionSuspend();
    this.cancelSuspendClose();
    const occupied=(this.voice.active||this.voice.pendingWrites||this.prompterOccupied()||this.agentCaptureOccupied||this.agentSuggestionOccupied||this.features.displayActive)&&this.managed&&this.connection.phase==='ready';
    this.foreground = false; this.backgroundAt = Date.now(); this.backgroundIntent = this.intent;
    this.todoStateChanged();
    if (this.background.active && this.managed) { this.stopInteractiveDisplays().catch(():void=>{});this.connection.backgroundReport = '后台保持中'; this.onConnection(); return; }
    const paused=this.paused,intent=this.intent,generation=this.suspendCloseGeneration;
    if(!occupied){this.stopInteractiveDisplays().catch(():void=>{});this.stop();this.paused=paused;return;}
    // Temporary cleanup only: use the system's grant, cap it at ten seconds,
    // cancel it on ACK/return/disconnect, and never turn on continuous recording.
    let pending:Promise<boolean>;
    try{pending=this.stopInteractiveDisplays();}catch(_){this.finishSuspendClose(generation,intent,paused,'handler-failed');return;}
    pending.then((confirmed:boolean):void=>this.finishSuspendClose(generation,intent,paused,confirmed?'ack':'unconfirmed'))
      .catch(():void=>this.finishSuspendClose(generation,intent,paused,'handler-failed'));
    let budget=0;
    try{
      const window=backgroundTaskManager.requestSuspendDelay('提词退出与连接清理',():void=>this.finishSuspendClose(generation,intent,paused,'native-expired'));
      if(generation!==this.suspendCloseGeneration){if(Number.isSafeInteger(window.requestId)&&window.requestId>=0){try{backgroundTaskManager.cancelSuspendDelay(window.requestId);}catch(_){}}return;}
      if(Number.isSafeInteger(window.requestId)&&window.requestId>=0){this.suspendCloseRequest=window.requestId;budget=Math.min(10000,Math.max(0,Math.floor(window.actualDelayTime)-500));}
    }catch(_){hilog.warn(0x2a03,'TurboIO','prompter-bg-close window-denied');}
    if(!Number.isFinite(budget)||budget<=0){this.finishSuspendClose(generation,intent,paused,'no-window');return;}
    this.suspendCloseTimer=setTimeout(():void=>this.finishSuspendClose(generation,intent,paused,'budget-expired'),budget);
    hilog.info(0x2a03,'TurboIO','prompter-bg-close waiting budget=%{public}d',budget);
  }
  private stopInteractiveDisplays(): Promise<boolean> {
    return Promise.all([this.voice.stopAndWait(),this.onPrompterSuspend(), this.features.stopDisplayAndWait()])
      .then((results: boolean[]): boolean => results.every((value: boolean): boolean => value));
  }

  inspect(candidate: Candidate): void {
    if (!this.foreground) { return; }
    this.stop();
    this.probe.inspect(candidate);
  }

  inspectNotifications(candidate: Candidate): void {
    if (!this.foreground || candidate.classic) return;
    this.stop();
    this.handshake.open(candidate.id);
  }

  async inspectVersion(candidate: Candidate, context: common.Context): Promise<void> {
    if (!this.foreground || candidate.classic) return;
    this.stop(); const intent = this.intent;
    const phone = await this.identity.get(context);
    try {
      if (!this.foreground || intent !== this.intent) return;
      this.peerInfo = null;
      this.peerDeviceId = candidate.id;
      const encoder = new util.TextEncoder();
      const input: AndroidVersionRequest = {phoneIdentifier:phone, phoneNameUTF8:encoder.encodeInto('Turbo IO'),
        manufacturerUTF8:encoder.encodeInto('HUAWEI'), modelUTF8:encoder.encodeInto('HarmonyOS'), accountUTF8:null, publicKey:null, pairValue:null};
      this.version.start(candidate.id, input);
    } finally { phone.fill(0); }
  }

  async inspectAuth(candidate: Candidate, context: common.Context): Promise<void> {
    if (!this.foreground || candidate.classic || this.peerInfo === null || this.peerDeviceId !== candidate.id) throw new Error('version-baseline-required');
    const peer = this.peerInfo.peerIdentifier.slice(); this.stop(); const intent = this.intent;
    const phone = await this.identity.get(context);
    try {
      if (!this.foreground || intent !== this.intent) return;
      const encoder = new util.TextEncoder();
      const input: AndroidVersionRequest = {phoneIdentifier:phone, phoneNameUTF8:encoder.encodeInto('Turbo IO'),
        manufacturerUTF8:encoder.encodeInto('HUAWEI'), modelUTF8:encoder.encodeInto('HarmonyOS'), accountUTF8:null, publicKey:null, pairValue:null};
      this.auth.start(candidate.id, input, peer, true, true);
    } finally { phone.fill(0); peer.fill(0); }
  }

  stop(): void {
    if(this.firmwareOccupied&&!this.firmwareReconnectAllowed){this.onConnection();return;}
    this.intent++; this.managed = false; this.paused = true;
    this.background.stop();
    if (this.retry !== -1) clearTimeout(this.retry); this.retry = -1;
    if (this.initializeTimer !== -1) clearTimeout(this.initializeTimer); this.initializeTimer = -1;
    this.closeRadios(); this.publish('idle', '连接已停止；可点重新连接');
  }
  private closeRadios(): void {
    this.recoveryIntent = -1; this.recoveryDiscovery.stop();
    this.cancelSuspendClose();
    // A cancelled transport need not emit a final report. Clear business state explicitly.
    const wasReady = this.servicesReady;
    this.servicesReady = false;
    this.features.connected(false, -1); this.voice.connected(false);
    if (wasReady) this.disconnectServices();
    this.connection.battery = -1; this.connection.seconds = 0;
    this.discovery.stop();
    this.probe.close();
    this.handshake.close();
    this.version.cancel();
    this.auth.cancel();
  }
  private disconnectServices(): void {
    this.onFirmwareDisconnected();
    this.todoStateChanged();
    this.onRecordingDisconnected(); this.onPrompterDisconnected();this.onAgentCaptureDisconnected();
    this.onNotificationDisconnected(); this.onLifelogDisconnected();
  }
  todoConnected():boolean{return this.servicesReady&&this.connection.phase==='ready';}
  private todoStateChanged():void{this.todoEpoch++;this.onTodoLifecycle();}
}
export const probeSession: ProbeSession = new ProbeSession();
