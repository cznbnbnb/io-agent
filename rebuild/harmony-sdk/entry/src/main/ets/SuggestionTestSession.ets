import { util } from '@kit.ArkTS';
import { cryptoFramework } from '@kit.CryptoArchitectureKit';
import { fileIo as fs } from '@kit.CoreFileKit';
import { businessEnvelope, readLauncherEnvelope } from 'turbo_core';

// P10 isolated experiment. No todo, model, server or task executor is reachable here.
// cmd is semantic accept/reject; it does not identify a crown or head gesture.
export class SuggestionTestSession {
  phase: string = 'idle';
  note: string = '建议卡实验尚未开始';
  uid: string = '';
  command: number = 0;
  busy: boolean = false;
  events: string[] = [];
  changed: () => void = (): void => {};
  onOccupancyChanged:()=>void=():void=>{};
  private peer: string = '';
  private epoch: number = 0;
  private serial: number = 0;
  private deadline: number = 0;
  private timer: number = -1;
  private journal: string = '';
  private cleanupUid: string = '';
  private cleanupPeer: string = '';
  private ackCode: number = -1;
  private send: (business: number, payload: Uint8Array) => Promise<void>;
  private device: () => string;
  private idle: () => boolean;

  constructor(send: (business: number, payload: Uint8Array) => Promise<void>, device: () => string, idle: () => boolean) {
    this.send = send; this.device = device; this.idle = idle;
  }
  initialize(filesDir: string): void {
    this.journal = filesDir + '/suggestion-test.json';
    try {
      if (!fs.accessSync(this.journal)) return;
      const saved = JSON.parse(fs.readTextSync(this.journal) as string) as Record<string, Object>;
      if (typeof saved['cleanupUid'] === 'string' && typeof saved['cleanupPeer'] === 'string') {
        this.cleanupUid = saved['cleanupUid'] as string; this.cleanupPeer = saved['cleanupPeer'] as string;
        if (this.cleanupUid) { this.phase = 'cleanup_pending'; this.note = '上次实验卡需连接原眼镜后移除'; }
      }
    } catch (_) { this.phase = 'failed'; this.note = '实验记录不可读，禁止发卡；请保留记录排查'; }
  }
  get active(): boolean { return this.phase === 'sending' || this.phase === 'waiting' || this.phase === 'observed' || !!this.cleanupUid; }
  get remainingMs():number{return this.active?Math.max(0,this.deadline-Date.now()):0;}
  get pendingUid():string{return this.cleanupUid;}
  private notify():void{try{this.onOccupancyChanged();}catch{}try{this.changed();}catch{}}
  private record(event: string, type: number = 0, cmd: number = 0): void {
    this.events.push(JSON.stringify({ at: Date.now(), event: event, type: type, uid: this.uid, cmd: cmd, phase: this.phase }));
    if (this.events.length > 100) this.events.shift();
    // Only synthetic experiment metadata. Never retain arbitrary notification text.
    if (this.journal) {
      const bytes = new util.TextEncoder().encodeInto(JSON.stringify({ cleanupUid: this.cleanupUid, cleanupPeer: this.cleanupPeer, events: this.events }));
      const f = fs.openSync(this.journal + '.partial', fs.OpenMode.CREATE | fs.OpenMode.WRITE_ONLY | fs.OpenMode.TRUNC);
      try {
        let offset = 0;
        while (offset < bytes.length) {
          const n = fs.writeSync(f.fd, bytes.slice(offset).buffer);
          if (n <= 0) throw new Error('实验记录写入不完整');
          offset += n;
        }
        fs.fsyncSync(f.fd);
      } finally { fs.closeSync(f); bytes.fill(0); }
      fs.renameSync(this.journal + '.partial', this.journal);
    }
    this.notify();
  }
  private clearTimer(): void { if (this.timer !== -1) clearTimeout(this.timer); this.timer = -1; }
  private async submit(type: number, body: string): Promise<void> {
    const bytes = businessEnvelope(type, new util.TextEncoder().encodeInto(body));
    try { await this.send(21, bytes); } finally { bytes.fill(0); }
  }
  async start(title: string, content: string, seconds:number=60): Promise<void> {
    if(![60,120].includes(seconds))throw new Error('实验时长仅允许60或120秒');
    if (this.busy || this.active || this.phase === 'failed') throw new Error('请先清理上一张实验卡或排查记录错误');
    if (!this.device() || !this.idle()) throw new Error('请连接眼镜并结束录音、智记及其他显示任务');
    if (!title.trim() || title.length > 16 || !content.trim() || content.length > 48 || /[\u0000-\u001f\u007f]/.test(title + content)) throw new Error('实验标题 1–16 字，正文 1–48 字');
    const random = cryptoFramework.createRandom().generateRandomSync(8).data;
    let suffix = ''; for (const b of random) suffix += b.toString(16).padStart(2, '0'); random.fill(0);
    this.uid = 'p10-' + Date.now().toString(36) + '-' + (++this.serial).toString(36) + '-' + suffix;
    this.peer = this.device(); this.cleanupPeer = this.peer; this.cleanupUid = this.uid;
    this.command = 0; this.ackCode = -1; this.deadline = Date.now() + seconds*1000;
    const epoch = this.epoch; this.phase = 'sending'; this.busy = true;
    try {
      // Persist cleanup intent BEFORE a possibly ambiguous transport result.
      this.record('send-intent', 33);
      this.timer = setTimeout((): void => {
        this.timer = -1; if (epoch !== this.epoch) return;
        this.phase = 'expired'; this.note = '实验已过期，迟到操作不接受';
        try { this.record('expired'); } catch (_) { this.note = '过期记录未落盘，请保留实验记录排查'; }
        this.remove().catch((): void => {});
      }, seconds*1000);
      await this.submit(33, JSON.stringify({ suggestUID: this.uid, suggestType: 2, type: 1, title: title, source: '本地实验', content: content }));
      if (epoch !== this.epoch) return;
      if (this.phase === 'sending') { this.phase = 'waiting'; this.note = '已提交；镜片当前约5秒收起。App将在'+seconds+'秒后清理，未选择不代表拒绝'; }
      this.record('transport-submitted', 33);
    } catch (error) {
      if (epoch === this.epoch) { this.phase = 'cleanup_pending'; this.note = '提交未确认，请移除实验卡'; }
      throw new Error((error as Error).message);
    } finally { if (epoch === this.epoch) { this.busy = false; this.notify(); } }
  }
  receive(peer: string, payload: Uint8Array): void {
    if (!this.active || peer !== this.peer || peer !== this.device()) return;
    try {
      const packet = readLauncherEnvelope(payload);
      try {
        // Observe type metadata while armed. Type 4 is never a suggestion result.
        if (packet.type !== 34) { this.record('other-type', packet.type); return; }
        if (packet.binary.length || packet.json.length > 2048) return;
        const j = JSON.parse(new util.TextDecoder().decodeToString(packet.json)) as Record<string, Object>;
        if (j['suggestUID'] !== this.uid || j['suggestType'] !== 2) { this.record('unmatched', 34); return; }
        const cmd = j['cmd'];
        if (cmd !== 1 && cmd !== 2) { this.record('unknown-command', 34); return; }
        if (Date.now() >= this.deadline || !['sending', 'waiting', 'observed'].includes(this.phase)) { this.record('late', 34, cmd as number); return; }
        if (this.command) { this.record(this.command === cmd ? 'duplicate' : 'conflict', 34, cmd as number); return; }
        this.command = cmd as number; this.phase = 'observed';
        this.note = cmd === 1 ? '收到语义接受；输入动作来源未知' : '收到语义拒绝；输入动作来源未知';
        this.record('operation', 34, this.command);
      } finally { packet.json.fill(0); packet.binary.fill(0); }
    } catch (_) { this.note = '消息或本地记录失败；未回执成功'; this.notify(); }
  }
  async acknowledge(code: number): Promise<void> {
    if (this.busy || this.phase !== 'observed' || !this.command || Date.now() >= this.deadline || this.peer !== this.device()) throw new Error('没有当前有效操作');
    if (![0, 1, 2, 3].includes(code)) throw new Error('未知回执码');
    if (this.ackCode >= 0 && this.ackCode !== code) throw new Error('同一操作不能改为另一结果');
    const epoch = this.epoch; this.busy = true;
    try {
      // A rejected transport may still have delivered. Pin the first intent.
      this.ackCode = code;
      this.record('ack-intent-' + code, 35, this.command);
      await this.submit(35, JSON.stringify({ suggestUID: this.uid, suggestType: 2, code: code }));
      if (epoch !== this.epoch) return;
      this.ackCode = code; this.phase = 'acknowledged';
      this.note = '实验回执已提交；请观察动画后手动移除。原实验期限仍会清理；没有创建待办或执行任务';
      this.record('ack-submitted-' + code, 35, this.command);
    } finally { if (epoch === this.epoch) { this.busy = false; this.notify(); } }
    // Do not erase a native result animation in the same tick as its receipt.
    // Durable cleanup intent and the original bounded timer remain active.
  }
  async remove(): Promise<void> {
    this.clearTimer();
    if (!this.cleanupUid) return;
    if (this.busy) { this.phase = 'cleanup_pending'; this.note = '等待发送结束后，请重试移除'; this.notify(); return; }
    if (!this.device() || this.cleanupPeer !== this.device()) { this.phase = 'cleanup_pending'; this.note = '连接原眼镜后手动移除实验卡'; this.notify(); return; }
    const epoch = this.epoch; this.busy = true; this.phase = 'cleanup_pending';
    const pendingUid = this.cleanupUid; const pendingPeer = this.cleanupPeer;
    try {
      await this.submit(33, JSON.stringify({ suggestUID: this.cleanupUid, suggestType: 2, type: 2, title: '', source: '', content: '' }));
      if (epoch !== this.epoch) return;
      this.cleanupUid = ''; this.cleanupPeer = ''; this.phase = 'idle';
      this.note = '移除命令已提交；是否消失需人眼确认'; this.record('remove-submitted', 33);
    } catch (error) {
      if (epoch === this.epoch) { this.cleanupUid = pendingUid; this.cleanupPeer = pendingPeer; this.phase = 'cleanup_pending'; }
      this.note = '移除或记录失败，可重试；禁止新发卡'; throw new Error((error as Error).message);
    }
    finally { if (epoch === this.epoch) { this.busy = false; this.notify(); } }
  }
  disconnected(): void {
    this.epoch++; this.clearTimer(); this.busy = false; this.peer = '';
    this.phase = this.cleanupUid ? 'cleanup_pending' : 'idle'; this.note = '连接变化；旧操作失效，实验卡可能需清理';
    try { this.record('disconnected'); } catch (_) { this.notify(); }
  }
}
