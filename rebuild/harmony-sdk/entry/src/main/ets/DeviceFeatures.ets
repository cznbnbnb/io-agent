import { util } from '@kit.ArkTS';
import { cryptoFramework } from '@kit.CryptoArchitectureKit';
import { SettingsWriteCheck } from './SettingsWriteCheck';
import { DisplayCleanupPorts } from './DisplayCleanupStore';
import { businessEnvelope, launcherCommand, probeLauncherCommand, currentWeather, dashboardQuery, installTextWidget,
  removeTextWidget, HARMONY_WIDGET_ID, displayStart, displayText, displayStop, readLauncherEnvelope,
  syncTimeCommand, privacyConfigCommand, wakeupConfigCommand, crownConfigCommand, displayConfigCommand,
  syncTimeProbeCommand, headGesturesCommand, autoLockTimeCommand, focusModeCommand } from 'turbo_core';

export class FeatureState {
  connected: boolean = false;
  battery: number = -1;
  note: string = '请先连接眼镜';
  weather: string = '天气未下发';
  dashboard: string = '仪表盘未读取';
  display: string = '显示会话未开启';
  displayReady: boolean = false;
  received: number = 0;
  // 最近一次眼镜应答的原始 JSON（type 4 通用设置 / type 1 通用状态），供设置页读回显示
  settingsJson: string = '';
  statusJson: string = '';
  // Content changes or a completed write readback advance these versions.
  // An unchanged readback after a rejected write must restore the actual device value.
  settingsRev: number = 0;
  statusRev: number = 0;
  // Fresh packets advance even when the JSON value is unchanged.
  settingsReadSerial: number = 0;
  statusReadSerial: number = 0;
  connectionRev: number = 0;
  displayAckCode: number = -1;
  displayAckConfig: string = '';
  displayTextProfile: string = 'source-partial';
  displayAudioPackets: number = 0;
  displayTextWrites: number = 0;
  displayStopSubmitted: boolean = false;
  displayExitEvidence: string = 'none';
  displayStartedAt: number = 0;
  displayLastOperation: string = '';
}
class DisplayCleanupRecord {
  schema: number = 2;
  peer: string = '';
  sid: string = '';
  evidence: string = 'none';
  operation: string = '';
}
export class DeviceFeatures {
  state: FeatureState = new FeatureState();
  changed: () => void = (): void => {};
  private send: (business: number, payload: Uint8Array) => Promise<void>;
  private encoder: util.TextEncoder = new util.TextEncoder();
  private sequence: number = 1000;
  private pending: string = '';
  private pendingSequence: number = 0;
  private timer: number = -1;
  private baselineAt: number = 0;
  private baselineHasOwned: boolean = false;
  private installedThisSession: boolean = false;
  private sid: string = '';
  private desiredText: string = '';
  private displayTimer: number = -1;
  private displayDeadline: number = -1;
  private continuousDisplay: boolean = false;
  private closing:boolean=false;
  private displayStore: DisplayCleanupPorts | undefined = undefined;
  private displayPeer: () => string = (): string => '';
  private displayOwner: string = '';
  private displayFault: boolean = false;
  private displayEpoch: number = 0;
  private displayStopping: boolean = false;
  private displayCutoff: number = -1;
  private displayOperation: string = '';
  private displayWaiters: ((exited: boolean) => void)[] = [];
  canDisplayBegin: () => boolean = (): boolean => true;
  canSettingsWrite: () => boolean = (): boolean => true;
  // Only unsent page drafts live here; submitted writes retain their own wire lease.
  localSettingsPending: boolean = false;
  private settingsOwnerSerial: number = 0;
  private writeOwner: number = 0;
  private queuedWriteOwner: number = 0;
  private queuedWrites: number = 0;
  private sending: boolean = false;
  constructor(send: (business: number, payload: Uint8Array) => Promise<void>) { this.send = send; }
  get displayActive(): boolean { return this.displayFault || this.sid.length > 0; }
  get displayClosing():boolean{return this.closing || this.displayFault;}
  get displaySessionId(): string { return this.sid; }
  get displayStartOperation(): string { return this.displayOperation; }
  get displayCleanupBlocked(): boolean { return this.displayFault; }
  get displayCanCleanup(): boolean { return !!this.sid && this.sameDisplayPeer(); }
  initializeDisplayCleanup(store: DisplayCleanupPorts, peer: () => string): void {
    if (this.displayStore) return;
    this.displayStore = store; this.displayPeer = peer;
    try {
      const raw = store.load();
      if (!raw) return;
      const saved = JSON.parse(raw) as DisplayCleanupRecord;
      if (!saved || ![1,2].includes(saved.schema) || Object.keys(saved).length !== (saved.schema === 1 ? 4 : 5) ||
        typeof saved.peer !== 'string' || saved.peer.length > 128 || typeof saved.sid !== 'string' ||
        !['none', 'device_event', 'user_confirmation'].includes(saved.evidence) ||
        (saved.schema === 2 && (typeof saved.operation !== 'string' || saved.operation !== '' && !/^chn-[0-9a-f]{32}$/.test(saved.operation))) ||
        (saved.sid ? !/^[0-9a-f]{32}$/.test(saved.sid) || !saved.peer || saved.evidence !== 'none'
          : saved.peer !== '' || saved.evidence === 'none')) throw new Error('DISPLAY_RECORD_INVALID');
      this.state.displayExitEvidence = saved.evidence;
      this.state.displayLastOperation = saved.schema === 2 ? saved.operation : '';
      if (saved.sid) {
        this.sid = saved.sid; this.displayOwner = saved.peer; this.closing = true;
        this.displayOperation = saved.schema === 2 ? saved.operation : '';
        this.state.display = '上次显示退出未确认，请连接原眼镜后清理；不会自动重发文字';
      }
    } catch (_) {
      this.displayFault = true;
      this.state.display = '显示清理记录不可读，原件保留；禁止开启新会话';
    }
  }
  private persistDisplay(evidence: string = 'none'): void {
    if (!this.displayStore) throw new Error('显示清理记录尚未初始化');
    const record = new DisplayCleanupRecord(); record.evidence = evidence;
    record.operation = this.displayOperation;
    if (evidence === 'none') { record.peer = this.displayOwner; record.sid = this.sid; record.operation = this.displayOperation; }
    try { this.displayStore.save(JSON.stringify(record)); }
    catch (_) {
      this.displayFault = true; this.closing = true; this.state.displayReady = false; this.clearDisplayTimers();
      this.finishDisplayWaiters(false);
      this.state.display = '显示清理记录保存失败，原件与占用保留'; this.changed();
      throw new Error('显示清理记录保存失败，保留占用');
    }
  }
  private sameDisplayPeer(): boolean {
    return this.state.connected && !!this.displayOwner && this.displayPeer() === this.displayOwner;
  }
  confirmDisplayExited():void {
    if(!this.closing)throw new Error('只能确认正在退出的会话');
    if (!this.sameDisplayPeer() || this.displayStopping) throw new Error('请连接原眼镜并等待当前发送结束后确认');
    this.clearDisplay('user_confirmation');this.state.display='用户确认眼镜已回首页（非设备回执）';this.changed();
  }
  get wireBusy(): boolean { return this.pending.length > 0 || this.sending || this.writeActive || this.queuedWrites > 0; }
  get launcherBusy(): boolean { return this.wireBusy || this.localSettingsPending; }
  nextSettingsWriteOwner():number{return ++this.settingsOwnerSerial;}
  settingsWriteOwnedBy(owner:number):boolean {
    if(owner<=0||this.pending)return false;
    if(this.queuedWrites>0)return this.queuedWriteOwner===owner&&(!(this.sending||this.writeActive)||this.writeOwner===owner);
    return this.writeOwner===owner&&(this.sending||this.writeActive);
  }
  get displayWritePending():boolean {
    return !this.pending && this.writeCheck?.command==='display_config' && (this.sending||this.writeActive);
  }
  connected(connected: boolean, battery: number): void {
    if(this.state.connected!==connected)this.state.connectionRev++;
    this.state.connected = connected; this.state.battery = battery;
    if (!connected) {
      this.writeGeneration++;
      this.clearReadback(); this.writeActive = false; this.writeCheck = undefined;
      this.state.settingsJson = ''; this.state.statusJson = '';
      this.state.settingsRev++; this.state.statusRev++;
      this.baselineAt = 0;
      this.installedThisSession=false;this.baselineHasOwned=false;
      if (this.timer !== -1) clearTimeout(this.timer); this.timer = -1; this.pending = '';
      this.displayEpoch++; this.clearDisplayTimers(); this.desiredText = ''; this.state.displayReady = false;
      this.finishDisplayWaiters(false);
      if (this.sid) { this.closing = true; this.state.display = '连接已断，保留原会话清理记录；不会自动重发文字'; }
    }
    this.changed();
  }
  private async submit(business: number, type: number, json: string, sequence: number = 0): Promise<void> {
    if (!this.state.connected) throw new Error('请先连接眼镜');
    if (this.sending) throw new Error('上一条仍在发送，请稍后');
    const packet = businessEnvelope(type, this.encoder.encodeInto(json), sequence);
    this.sending = true;
    try { await this.send(business, packet); this.onTx(type, json); }
    finally { packet.fill(0); this.sending = false; this.changed(); }
  }
  private async launcher(type: number, json: string, command: string): Promise<void> {
    if (this.pending) throw new Error('上一条指令仍在等待回执');
    this.pending = command; this.pendingSequence = ++this.sequence;
    this.state.note = `${command}：正在发送`;
    this.timer = setTimeout(() => {
      this.timer = -1; this.state.note = `${this.pending}：8 秒未收到匹配回报，不代表成功`;
      this.pending = ''; this.changed();
    }, 8000);
    try {
      await this.submit(15, type, json, this.pendingSequence);
      if (this.pending) this.state.note = `${command}：已提交，等待眼镜回执`;
    } catch (e) {
      if (this.timer !== -1) clearTimeout(this.timer); this.timer = -1; this.pending = '';
      this.state.note = '未提交：请检查连接和内容长度'; throw new Error('蓝牙指令未提交，请检查连接或缩短内容');
    } finally { this.changed(); }
  }
  async refreshStatus(): Promise<void> { await this.launcher(1, launcherCommand('request_general_status', 0), 'request_general_status'); }
  async refreshSettings(): Promise<void> { await this.launcher(4, launcherCommand('request_general_settings', 0), 'request_general_settings'); }
  // 连接进 ready 后自动同步本机时间（官方格式：type 5 + data{utc:秒, offset:时区偏移秒, timezone:IANA}）。
  // 即发即弃不占 pending；offsetSeconds 仅用于人工验证（+3600 拨快看眼镜时钟跳变）。
  async syncTime(offsetSeconds: number = 0): Promise<void> {
    if (!Number.isInteger(offsetSeconds) || Math.abs(offsetSeconds) > 86400) throw new Error('invalid-value');
    const now = new Date();
    const offset = -now.getTimezoneOffset() * 60;
    await this.submit(15, 5, syncTimeCommand(Math.floor(now.getTime() / 1000) + offsetSeconds, offset, this.resolvedZone(now, offset)));
  }
  // 真机实测：ArkTS 的 Intl 会给出 ICU 默认区（America/Chicago），与系统偏移（+8h）矛盾。
  // 用墙钟小时/分钟交叉校验时区名；不一致就按偏移回退到代表城市，绝不把矛盾组合写给眼镜。
  private resolvedZone(at: Date, offsetSeconds: number): string {
    let tz = '';
    try { const r = Intl.DateTimeFormat().resolvedOptions().timeZone; if (r) tz = r; } catch (_) {}
    return DeviceFeatures.zoneMatchesOffset(tz, at) ? tz : DeviceFeatures.zoneFromOffset(offsetSeconds);
  }
  private static zoneMatchesOffset(tz: string, at: Date): boolean {
    if (!tz) return false;
    try {
      const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: 'numeric', hour12: false }).formatToParts(at);
      let h = -1; let m = -1;
      for (const p of parts) { if (p.type === 'hour') h = Number(p.value); else if (p.type === 'minute') m = Number(p.value); }
      if (!Number.isInteger(h) || !Number.isInteger(m)) return false;
      const zoneMinutes = ((h % 24) * 60 + m) % 1440;
      const localMinutes = at.getHours() * 60 + at.getMinutes();
      const diff = Math.abs(zoneMinutes - localMinutes);
      return diff === 0 || diff === 1440;
    } catch (_) { return false; }
  }
  private static zoneFromOffset(offsetSeconds: number): string {
    const table: Map<number, string> = new Map<number, string>();
    table.set(28800, 'Asia/Shanghai'); table.set(32400, 'Asia/Tokyo'); table.set(25200, 'Asia/Bangkok');
    table.set(19800, 'Asia/Kolkata'); table.set(0, 'UTC'); table.set(3600, 'Europe/Paris');
    table.set(7200, 'Europe/Athens'); table.set(10800, 'Europe/Moscow'); table.set(-10800, 'America/Sao_Paulo');
    table.set(-18000, 'America/New_York'); table.set(-21600, 'America/Chicago'); table.set(-25200, 'America/Denver');
    table.set(-28800, 'America/Los_Angeles'); table.set(-36000, 'Pacific/Honolulu');
    const hit = table.get(offsetSeconds);
    return hit === undefined ? 'UTC' : hit;
  }
  // 时间同步格式探测：四种候选形状用不同跳变幅度做标记（A +1h / B +2h / C +3h / D +4h，末尾复位），
  // 从眼镜自身时钟轨迹反推哪一种被真正应用。每种间隔 5 秒，全程约 25 秒。
  async probeTimeFormats(): Promise<void> {
    if (!this.state.connected) throw new Error('请先连接眼镜');
    const now = new Date();
    const offset = -now.getTimezoneOffset() * 60;
    const base = Math.floor(now.getTime() / 1000);
    const tz = this.resolvedZone(now, offset);
    const pause = (ms: number): Promise<void> => new Promise<void>((resolve): void => { setTimeout(resolve, ms); });
    const labels: string[] = ['A +1h（t5/秒/合法时区）', 'B +2h（t5/毫秒）', 'C +3h（t2/秒）', 'D +4h（t2/value 字段）'];
    const types: number[] = [5, 5, 2, 2];
    const payloads: string[] = [
      syncTimeProbeCommand(base + 3600, offset, tz),
      syncTimeProbeCommand((base + 7200) * 1000, offset, tz),
      syncTimeProbeCommand(base + 10800, offset, tz),
      launcherCommand('sync_time', base + 14400)
    ];
    try {
      for (let i = 0; i < labels.length; i++) {
        this.state.note = `时间探测 ${labels[i]} 已发，等 5 秒…`; this.changed();
        await this.submit(15, types[i], payloads[i]);
        await pause(5000);
      }
      this.state.note = '时间探测复位（写回本机真实时间）…'; this.changed();
      await this.submit(15, 5, syncTimeProbeCommand(base, offset, tz));
      this.state.note = '时间探测完成：请拉取眼镜时钟轨迹判定生效形状'; this.changed();
    } catch (e) {
      this.state.note = '时间探测中断：' + (e as Error).message; this.changed(); throw new Error('时间探测中断');
    }
  }
  // 发送留痕回调（ProbeSession 注入），记录实际发出的信封供协议分析。
  onTx: (type: number, json: string) => void = (_type: number, _json: string): void => {};
  // Settings have no reliable ACK. Serialize sends and read only the addressed domain.
  // Confirmation requires every addressed value in a post-query readback to match.
  // Command echoes and unrelated changes (for example battery) cannot confirm a write.
  private writeChain: Promise<void> = Promise.resolve();
  private readbackTimer: number = -1;
  private readbackDeadline: number = -1;
  private readbackPending: boolean = false;
  private writeActive: boolean = false;
  private lastWriteLabel: string = '';
  private writeCheck: SettingsWriteCheck | undefined = undefined;
  private writeGeneration: number = 0;
  private clearReadback(): void {
    if (this.readbackTimer !== -1) clearTimeout(this.readbackTimer);
    if (this.readbackDeadline !== -1) clearTimeout(this.readbackDeadline);
    this.readbackTimer = -1; this.readbackDeadline = -1; this.readbackPending = false;
  }
  private enqueueWrite(type: number, json: string, label: string, owner: number = 0): Promise<void> {
    if (!this.state.connected) return Promise.reject(new Error('请先连接眼镜'));
    if (!this.canSettingsWrite()) return Promise.reject(new Error('已有采集或显示通道占用，请先结束'));
    if (owner > 0 && this.wireBusy && !this.settingsWriteOwnedBy(owner)) return Promise.reject(new Error('其他设置操作尚未完成'));
    const check = new SettingsWriteCheck(json);
    const baseline = check.domain === 'generalStatus' ? this.state.statusJson : this.state.settingsJson;
    if (check.needsBaseline && !check.hasBaseline(baseline)) return Promise.reject(new Error('当前设置不完整，请重新读取眼镜设置后再修改'));
    const generation = this.writeGeneration, peer = this.displayPeer();
    this.queuedWriteOwner = this.queuedWrites === 0 ? owner : this.queuedWriteOwner === owner ? owner : -1;
    this.queuedWrites++;
    const task = this.writeChain.catch((): void => {}).then(async (): Promise<void> => {
      if (!this.state.connected || generation !== this.writeGeneration || peer && peer !== this.displayPeer()) throw new Error('连接已变化，请重新操作');
      if (!this.canSettingsWrite()) throw new Error('已有采集或显示通道占用，请重新操作');
      this.clearReadback();
      this.lastWriteLabel = label; this.writeCheck = check; this.writeActive = false; this.writeOwner = owner;
      try {
        await this.submit(15, type, json);
        if (!this.state.connected || generation !== this.writeGeneration) throw new Error('连接已变化');
        this.writeActive = true;
        this.state.note = `${label}：已发送，约 2 秒后读回校验`; this.changed();
        this.scheduleReadback();
      } catch (_) {
        if (generation === this.writeGeneration) {
          this.writeActive = false; this.clearReadback();
          this.state.note = `${label}：发送未完成，请检查连接`; this.changed();
        }
        throw new Error('设置未发送，请检查眼镜连接');
      }
    });
    const finished = task.finally(():void=>{
      this.queuedWrites--;if(this.queuedWrites===0)this.queuedWriteOwner=0;this.changed();
    });
    this.writeChain = finished; this.changed(); return finished;
  }
  private scheduleReadback(): void {
    this.clearReadback();
    const generation = this.writeGeneration;
    const check = this.writeCheck;
    this.readbackTimer = setTimeout(() => {
      this.readbackTimer = -1;
      if (!this.state.connected || !this.writeActive || generation !== this.writeGeneration || check !== this.writeCheck) return;
      this.readbackPending = true;
      this.readbackDeadline = setTimeout(() => {
        this.readbackDeadline = -1;
        if (!this.writeActive || generation !== this.writeGeneration || check !== this.writeCheck) return;
        this.clearReadback(); this.writeActive = false;
        if(check?.domain==='generalStatus')this.state.statusRev++;else this.state.settingsRev++;
        this.state.note = `${this.lastWriteLabel}：读回超时，未能确认`; this.changed();
      }, check?.command==='focus_mode'?9500:4000);
      if(check)this.requestWriteReadback(generation,check);
    }, 1500);
  }
  private requestWriteReadback(generation:number,check:SettingsWriteCheck):void {
    if(!this.state.connected||!this.writeActive||generation!==this.writeGeneration||check!==this.writeCheck)return;
    const type=check.domain==='generalStatus'?1:4;
    const command=type===1?'request_general_status':'request_general_settings';
    this.submit(15,type,launcherCommand(command,0)).catch(()=>{
      if(generation!==this.writeGeneration||check!==this.writeCheck)return;
      this.clearReadback();this.writeActive=false;
      if(check.domain==='generalStatus')this.state.statusRev++;else this.state.settingsRev++;
      this.state.note=`${this.lastWriteLabel}：无法读取结果，请重新连接后核对`;this.changed();
    });
  }
  private currentSetting(group:string,key:string):Object|undefined {
    try{
      const root=JSON.parse(this.state.settingsJson) as Record<string,Object>;
      const settings=root['generalSettings'] as Record<string,Object>;
      return (settings?.[group] as Record<string,Object>)?.[key];
    }catch(_){return undefined;}
  }
  async writePrivacy(micOn: boolean, ledLevel: number, ledAuto: boolean, logOn: boolean): Promise<void> {
    if(ledLevel===0){
      const prior=this.currentSetting('privacyConfig','led_light');
      if(prior!==0)throw new Error('指示灯新档位为1–6；原有零值仅可保留');
    }
    await this.enqueueWrite(5, privacyConfigCommand(micOn, ledLevel, ledAuto, logOn), '隐私设置');
  }
  async writeWakeup(headupOn: boolean, degree: number, crownSwitch: number): Promise<void> {
    if(![0,3].includes(crownSwitch)){
      const prior=this.currentSetting('wakeupConfig','crownSwitch');
      if(prior!==crownSwitch)throw new Error('息屏互动仅可选择关闭或开启；旧值只原样保留');
    }
    await this.enqueueWrite(5, wakeupConfigCommand(headupOn, degree, crownSwitch), '唤醒设置');
  }
  async writeCrown(direction: number, doubleAction: number, longPressAction: number): Promise<void> {
    if(longPressAction===6){
      const prior=this.currentSetting('crownConfig','longPress');
      if(prior!==6)throw new Error('息屏长按不支持全天智记快捷键');
    }
    await this.enqueueWrite(5, crownConfigCommand(direction, doubleAction, longPressAction), '旋钮设置');
  }
  async restoreDoubleClickAI():Promise<void>{
    let crown:Record<string,Object>;
    try{const root=JSON.parse(this.state.settingsJson) as Record<string,Object>;const settings=root['generalSettings'] as Record<string,Object>;crown=settings['crownConfig'] as Record<string,Object>;}catch(_){throw new Error('请先读取眼镜当前旋钮设置');}
    const direction=crown?.['direction'],longPress=crown?.['longPress'];
    if(typeof direction!=='number'||![0,1].includes(direction as number)||typeof longPress!=='number'||!Number.isInteger(longPress)||longPress<0||longPress>9)throw new Error('旋钮读回不完整，请重新读取设置');
    await this.writeCrown(direction as number,0,longPress as number);
  }
  async writeDisplay(height: number, distance: number, owner: number = 0): Promise<void> {
    await this.enqueueWrite(5, displayConfigCommand(height, distance), '显示位置', owner);
  }
  async writeHeadGestures(enabled: boolean, mode: number): Promise<void> {
    await this.enqueueWrite(5, headGesturesCommand(enabled, mode), '头部控制');
  }
  // 专注/勿扰：只动两个开关，策略（auto/时间窗/星期）保留眼镜当前值
  async writeFocus(enabled: boolean, glassClose: boolean): Promise<void> {
    let auto = false; let begin = '09:00'; let end = '18:00'; let weekday: number[] = [0, 1, 2, 3, 4, 5, 6];
    let source=2;
    try {
      const s = JSON.parse(this.state.statusJson) as Record<string, Object>;
      const st = s['generalStatus'] as Record<string, Object>;
      const fm = st['focusMode'] as Record<string, Object>;
      const p = fm['policy'] as Record<string, Object>;
      if(![0,1].includes(fm['enable'] as number))throw new Error('focus-in-transition');
      source=(enabled?1:0)!==fm['enable']?1:2;
      if (![0, 1].includes(p['auto'] as number) || typeof p['begin'] !== 'string' || typeof p['end'] !== 'string' || !Array.isArray(p['weekday'])) {
        throw new Error('missing-focus-policy');
      }
      auto = p['auto'] === 1;
      begin = p['begin'] as string; end = p['end'] as string; weekday = p['weekday'] as number[];
    } catch (_) { throw new Error('请先读取眼镜当前状态，再修改专注模式'); }
    await this.enqueueWrite(2, focusModeCommand(enabled, glassClose, auto, begin, end, weekday,source), '专注模式');
  }
  // 单项探测：指定信封类型与命令发一次（fire-and-forget），回执以 launcher-rx.jsonl 为准。
  async probeSingle(type: number, command: string, value: number, data: string): Promise<void> {
    if (!this.state.connected) throw new Error('请先连接眼镜');
    if (this.probing) throw new Error('批量探测在途，请等待完成');
    await this.submit(15, type, probeLauncherCommand(command, value, data));
    this.state.note = `探测已发 t${type} ${command}=${value}${data ? ' ' + data.slice(0, 40) : ''}；请读回设置对比`; this.changed();
  }
  // 写入格式探测：候选命令（官方 APP 字符串证据）逐个发测试值，随后写回原值，
  // 最后读回通用设置与状态。判定依据 = launcher-rx.jsonl 回执 + last-general-settings.json 键值变化。
  // 全部走已验证的 type 2 通用信封；发送失败/断连只记录，不中断后续写回。
  private probing: boolean = false;
  async runProbeBatch(): Promise<void> {
    if (!this.state.connected) throw new Error('请先连接眼镜');
    if (this.probing || this.pending) throw new Error('探测或指令在途，请稍后再试');
    this.probing = true;
    // [cmd, value, data]：测试值与原值成对；原值取自本机已读回的 generalSettings/generalStatus
    const steps: Array<[string, number, string]> = [
      ['mic_switch', 0, ''], ['led_light', 0, ''], ['focus_mode', 1, ''],
      ['headup_switch', 0, ''], ['crown_config', 0, '{"direction":0}'], ['head_gestures', 0, ''],
      ['display_config', 0, '{"height":2,"distance":2}'], ['auto_sleep', 25, ''],
      ['dnd_mode', 1, ''], ['glasses_dnd_switch', 1, ''], ['whisper_mode', 1, ''],
    ];
    const reverts: Array<[string, number, string]> = [
      ['mic_switch', 1, ''], ['led_light', 1, ''], ['focus_mode', 0, ''],
      ['headup_switch', 1, ''], ['crown_config', 0, '{"direction":1}'], ['head_gestures', 1, ''],
      ['display_config', 0, '{"height":1,"distance":2}'], ['auto_sleep', 15, ''],
      ['dnd_mode', 0, ''], ['glasses_dnd_switch', 0, ''], ['whisper_mode', 0, ''],
    ];
    const pause = (ms: number): Promise<void> => new Promise<void>((resolve): void => { setTimeout(resolve, ms); });
    try {
      for (let i = 0; i < steps.length; i++) {
        this.state.note = `写入探测 ${i + 1}/${steps.length}：${steps[i][0]}`; this.changed();
        try { await this.submit(15, 2, probeLauncherCommand(steps[i][0], steps[i][1], steps[i][2])); } catch (_) {}
        await pause(1200);
      }
      this.state.note = '测试值发完，正在写回原值…'; this.changed();
      for (const step of reverts) {
        try { await this.submit(15, 2, probeLauncherCommand(step[0], step[1], step[2])); } catch (_) {}
        await pause(1000);
      }
      this.state.note = '正在读回通用设置与状态…'; this.changed();
      try { await this.launcher(4, launcherCommand('request_general_settings', 0), 'request_general_settings'); } catch (_) {}
      try { await this.launcher(1, launcherCommand('request_general_status', 0), 'request_general_status'); } catch (_) {}
      this.state.note = '探测完成：请拉回 launcher-rx.jsonl 与 last-general-settings.json 对比键值'; this.changed();
    } finally { this.probing = false; }
  }
  async voiceWakeup(): Promise<void> { await this.launcher(16, launcherCommand('set_ai_voice_wakeup', 0, 1), 'set_ai_voice_wakeup'); }
  async brightness(value: number, owner: number = 0): Promise<void> {
    if (!Number.isInteger(value) || value < 1 || value > 17) throw new Error('亮度档位 1–17');
    await this.enqueueWrite(2, launcherCommand('brightness_change', value), '亮度', owner);
  }
  async sleepTime(value: number): Promise<void> {
    if (![5, 10, 15, 25, 40, 60, 120].includes(value)) throw new Error('仅开放官方档位 5/10/15/25/40/60/120 秒');
    await this.enqueueWrite(5, autoLockTimeCommand(value), '自动锁屏');
  }
  async weather(city: string, temp: number, icon: number): Promise<void> {
    await this.launcher(18, currentWeather(city, temp, icon, Math.floor(Date.now()/1000)), 'current_weather_update');
    this.state.weather = `${city} ${temp}°：已提交首页天气，镜片效果待确认`; this.changed();
  }
  async dashboardRead(): Promise<void> { await this.launcher(18, dashboardQuery(), 'dashboard_config'); }
  async widget(text: string): Promise<void> {
    if (!this.baselineAt || Date.now()-this.baselineAt > 120000) throw new Error('请先读取新仪表盘基线');
    if (this.baselineHasOwned && !this.installedThisSession) throw new Error('已有同名卡片，拒绝覆盖未知来源内容');
    const json=installTextWidget(text),packet=businessEnvelope(18,this.encoder.encodeInto(json),this.sequence+1);
    const tooLarge=packet.length+10>509;packet.fill(0);
    if(tooLarge)throw new Error('卡片文字编码后超过单帧容量，请缩短到约 15 个汉字；符号也占容量');
    await this.launcher(18, json, 'widget_install');
  }
  async removeWidget(): Promise<void> {
    if (!this.installedThisSession) throw new Error('只能删除本次会话成功安装的测试卡');
    await this.launcher(18, removeTextWidget(), 'widget_uninstall');
  }
  receive(business: number, bytes: Uint8Array, sourcePeer: string | undefined = undefined): void {
    if (![15,19].includes(business)) return;
    if (business === 19 && (!this.sameDisplayPeer() || sourcePeer !== undefined && sourcePeer !== this.displayOwner)) return;
    try {
      const packet = readLauncherEnvelope(bytes);
      if (business === 19 && packet.type === 4 && this.sid) {
        this.state.displayAudioPackets++; this.stopDisplay().catch(()=>{}); return;
      }
      if (!packet.json.length) return;
      const text = new util.TextDecoder('utf-8',{fatal:true}).decodeToString(packet.json);
      const j = JSON.parse(text) as Record<string,Object>;
      this.state.received++;
      if (business === 19) { this.displayReceived(packet.type, j); return; }
      const command = typeof j['cmd'] === 'string' ? j['cmd'] as string : '';
      if(packet.type===4&&j['generalSettings']&&typeof j['generalSettings']==='object'&&!Array.isArray(j['generalSettings']))this.state.settingsReadSerial++;
      if(packet.type===1&&j['generalStatus']&&typeof j['generalStatus']==='object'&&!Array.isArray(j['generalStatus']))this.state.statusReadSerial++;
      // Cache updates and write confirmation are separate: battery changes prove nothing about a setting.
      if (packet.type === 4 && j['generalSettings'] !== undefined && text !== this.state.settingsJson) {
        this.state.settingsJson = text; this.state.settingsRev++;
      }
      if (packet.type === 1 && j['generalStatus'] !== undefined && text !== this.state.statusJson) {
        this.state.statusJson = text; this.state.statusRev++;
      }
      if (packet.type === 19 && ['widget_install','widget_uninstall'].includes(this.pending) && packet.sequence === this.pendingSequence && typeof j['code'] === 'number') {
        const ok = j['code'] === 0;
        if (ok) this.installedThisSession = this.pending === 'widget_install';
        this.complete(this.pending, ok); this.changed(); return;
      }
      if (packet.type === 1 && this.pending === 'request_general_status') this.complete('request_general_status', true);
      if (packet.type === 4 && this.pending === 'request_general_settings') this.complete('request_general_settings', true);
      if (packet.type === 19 && command === 'dashboard_config' && this.pending === command) {
        const payload = j['payload'] as Record<string,Object>;
        let data: Object = payload?.['data'];
        if (typeof data === 'string') data = JSON.parse(data) as Object;
        if (data && typeof data === 'object' && Array.isArray((data as Record<string,Object>)['widgets_v2'])) {
          this.baselineAt = Date.now(); this.baselineHasOwned = JSON.stringify(data).includes(`"${HARMONY_WIDGET_ID}"`);
          this.state.dashboard = this.baselineHasOwned ? '已回读，包含 Turbo IO 卡片' : '已回读原配置；安装只添加自己的单卡';
        }
      }
      if (command && command === this.pending && [3,6,17,19].includes(packet.type)) {
        const payload = j['payload'] as Record<string,Object>;
        if(command==='current_weather_update'){
          if(typeof payload?.['value']!=='number')return;
          const accepted=payload['value']===0;
          this.state.weather=accepted?this.state.weather.replace('已提交首页天气，镜片效果待确认','眼镜回执成功，镜片效果待确认'):'眼镜未接受天气 · value='+String(payload['value']);
          this.complete(command,accepted);this.changed();return;
        }
        // value meanings differ by command: preserve the literal ACK summary,
        // never interpret an arbitrary numeric value as success.
        if (command !== 'widget_install' && command !== 'widget_uninstall') this.complete(command, true);
      }
      // Only a readback after our query, containing the addressed fields, can confirm an applied value.
      if (this.writeActive && this.readbackPending && this.writeCheck) {
        const domainReply = (packet.type === 4 && this.writeCheck.domain === 'generalSettings')
          || (packet.type === 1 && this.writeCheck.domain === 'generalStatus');
        const result = domainReply ? this.writeCheck.compare(j) : 0;
        // Focus exits report 2/3 before stable 0. Poll the same read-only domain
        // until all requested fields match or the fixed deadline expires.
        if(domainReply&&this.writeCheck.command==='focus_mode'&&result!==1){
          if(this.readbackTimer===-1){
            const generation=this.writeGeneration,check=this.writeCheck;
            this.readbackTimer=setTimeout(()=>{this.readbackTimer=-1;this.requestWriteReadback(generation,check);},600);
          }
          this.state.note='专注模式：等待眼镜完成切换';this.changed();return;
        }
        if (result !== 0) {
          if (this.writeCheck.domain === 'generalSettings') this.state.settingsRev++;
          else this.state.statusRev++;
          this.writeActive = false; this.clearReadback();
          this.state.note = result === 1 ? `${this.lastWriteLabel}：读回确认已生效`
            : `${this.lastWriteLabel}：读回值与目标不一致，请核对眼镜设置`;
        }
      }
      this.changed();
    } catch (_) { /* Unrecognized business payload is not a transport failure. */ }
  }
  private complete(command: string, accepted: boolean): void {
    if (this.timer !== -1) clearTimeout(this.timer); this.timer = -1;
    this.pending = ''; this.state.note = `${command}：${accepted ? '收到眼镜回报；镜片效果待验收' : '回执值未确认成功，请勿重复覆盖'}`;
  }
  async show(text: string, continuous: boolean = false, limitMs: number = 0, operation: string = '', profile: string = 'source-partial'): Promise<void> {
    if (!Number.isInteger(limitMs) || limitMs !== 0 && (limitMs < 1000 || limitMs > 130000) ||
      operation !== '' && !/^chn-[0-9a-f]{32}$/.test(operation)) throw new Error('显示期限或操作编号无效');
    displayText('0'.repeat(32), text.slice(0,96), profile); // Validate before persisting intent or touching the glasses.
    if (!this.state.connected) throw new Error('请先连接眼镜');
    if (!this.displayStore || this.displayActive) throw new Error('请先完成当前显示会话或清理记录');
    if (!this.canDisplayBegin() || this.launcherBusy) throw new Error('已有采集或显示通道占用，请先结束');
    const peer = this.displayPeer();
    if (!peer || peer.length > 128) throw new Error('原眼镜身份尚未就绪');
    const random = cryptoFramework.createRandom().generateRandomSync(16).data;
    this.sid = Array.from(random).map((b:number)=>b.toString(16).padStart(2,'0')).join(''); random.fill(0);
    this.displayOwner = peer; this.displayOperation = operation; this.persistDisplay();
    const epoch = ++this.displayEpoch;
    this.continuousDisplay = continuous;
    this.desiredText = text.slice(0,96); this.state.displayReady = false;
    this.state.displayAckCode = -1; this.state.displayAudioPackets = 0; this.state.displayTextWrites = 0;
    this.state.displayAckConfig = ''; this.state.displayTextProfile = profile;
    this.state.displayStopSubmitted = false; this.state.displayExitEvidence = 'none'; this.state.displayStartedAt = Date.now();
    this.state.displayLastOperation = operation;
    this.state.display = '正在请求纯文字显示；若收到音频立即停止'; this.changed();
    this.displayTimer = setTimeout(() => { if (epoch === this.displayEpoch) this.stopDisplay().catch(()=>{}); }, 10000);
    if (limitMs > 0) this.displayCutoff = setTimeout(() => {
      if (epoch === this.displayEpoch) this.stopDisplay().catch(()=>{});
    }, limitMs);
    try { await this.submit(19, 7, displayStart(this.sid, profile !== 'subtitle-no-preview')); }
    catch (e) {
      if (epoch === this.displayEpoch && this.sid) {
        this.clearDisplayTimers(); this.closing = true; this.state.displayReady = false;
        this.state.display = '显示启动结果不明，保留清理记录；请退出原会话'; this.changed();
      }
      throw new Error('显示启动结果不明，请先清理原会话');
    }
  }
  async updateDisplay(text: string, profile: string = 'source-partial'): Promise<void> {
    if (!this.sid || !this.state.displayReady || this.closing || !this.sameDisplayPeer()) throw new Error('请先开启显示，等待原眼镜确认');
    const epoch = this.displayEpoch;
    await this.submit(19, 5, displayText(this.sid, text.slice(0,96), profile));
    if (epoch !== this.displayEpoch || !this.state.displayReady) return;
    this.state.displayTextWrites++;
    this.state.displayTextProfile = profile;
    this.state.display = '文字已提交 · 以镜片实际显示为准'; this.changed();
  }
  private displayReceived(type: number, body: Record<string,Object>): void {
    if (body['sid'] !== this.sid || !this.sid) return;
    if (type === 8 && !this.state.displayReady && !this.closing) {
      this.state.displayAckCode = typeof body['code'] === 'number' ? body['code'] as number : -1;
      const config = body['effective_config'];
      if (config && typeof config === 'object' && !Array.isArray(config)) {
        const observed = config as Record<string,Object>, selected: Record<string,Object> = {};
        for (const key of ['font_size','content_width','max_lines','position','is_display','straight_view']) {
          const value = observed[key];
          if (typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value) || typeof value === 'string' && value.length <= 32) selected[key] = value;
        }
        this.state.displayAckConfig = JSON.stringify(selected);
      }
      if (body['code'] !== 1) { this.stopDisplay().catch(()=>{}); return; }
      if (this.displayTimer !== -1) clearTimeout(this.displayTimer); this.displayTimer = -1;
      this.state.displayReady = true;
      const epoch = this.displayEpoch;
      if (!this.continuousDisplay && this.displayCutoff === -1) this.displayDeadline = setTimeout(() => { if (epoch === this.displayEpoch) this.stopDisplay().catch(()=>{}); }, 180000);
      // Next task avoids reentrant writes inside the native RX callback.
      this.displayTimer = setTimeout(() => {
        if (epoch !== this.displayEpoch || this.closing) return;
        this.displayTimer = -1;
        this.updateDisplay(this.desiredText, this.state.displayTextProfile).catch(()=>{
          if (epoch !== this.displayEpoch) return;
          this.state.display='文字发送失败，保留占用并尝试退出';this.changed();this.stopDisplay().catch(()=>{});
        });
      }, 0);
    }
    if (type === 3) { this.clearDisplay('device_event'); this.state.display = '收到同会话退出消息'; }
    if (type === 4) { this.stopDisplay().catch(()=>{}); this.state.display = '检测到音频，停止纯显示测试'; }
    this.changed();
  }
  async stopDisplay(): Promise<void> {
    const sid = this.sid;if(!sid || this.displayStopping || (this.closing && this.displayDeadline !== -1))return;
    if (!this.sameDisplayPeer()) throw new Error('请连接原眼镜清理显示，不向其他设备发送');
    this.closing=true;this.state.displayReady=false;
    const epoch = ++this.displayEpoch; this.clearDisplayTimers(); this.displayStopping = true;
    this.displayDeadline=setTimeout(()=>{
      if (epoch !== this.displayEpoch) return;
      this.displayDeadline=-1;if(this.sid===sid&&this.closing){this.state.display='退出未确认，请按眼镜按钮回首页后确认；未释放显示占用';this.finishDisplayWaiters(false);this.changed();}
    },8000);
    try { await this.submit(19, 3, displayStop(sid)); if (epoch === this.displayEpoch) {this.state.displayStopSubmitted=true;this.state.display = '退出已提交；若仍显示请按实体按钮';} }
    finally { this.displayStopping = false; this.changed(); }
  }
  private clearDisplayTimers(): void {
    if (this.displayTimer !== -1) clearTimeout(this.displayTimer);
    if (this.displayDeadline !== -1) clearTimeout(this.displayDeadline);
    if (this.displayCutoff !== -1) clearTimeout(this.displayCutoff);
    this.displayCutoff = -1;
    this.displayTimer = -1; this.displayDeadline = -1;
  }
  private clearDisplay(evidence: string): void {
    this.persistDisplay(evidence); this.displayFault = false; this.displayEpoch++;
    this.clearDisplayTimers(); this.sid = ''; this.displayOwner = ''; this.desiredText = ''; this.state.displayReady = false;
    this.continuousDisplay = false;this.closing=false;
    this.displayOperation = ''; this.state.displayExitEvidence = evidence; this.finishDisplayWaiters(true);
  }
  private finishDisplayWaiters(exited: boolean): void {
    const pending = this.displayWaiters; this.displayWaiters = [];
    for (const resolve of pending) resolve(exited);
  }
  stopDisplayAndWait(): Promise<boolean> {
    if (!this.displayActive) return Promise.resolve(true);
    if (!this.sameDisplayPeer() || !this.sid) return Promise.resolve(false);
    if (this.displayWaiters.length >= 8) return Promise.resolve(false);
    return new Promise<boolean>((resolve: (exited: boolean) => void): void => {
      let timer: number = -1;
      const finish = (exited: boolean): void => {
        if (timer !== -1) clearTimeout(timer); timer = -1;
        this.displayWaiters = this.displayWaiters.filter((pending: (value: boolean) => void): boolean => pending !== finish);
        resolve(exited);
      };
      timer = setTimeout((): void => finish(false), 8500);
      this.displayWaiters.push(finish);
      this.stopDisplay().catch((): void => this.finishDisplayWaiters(false));
    });
  }
}
