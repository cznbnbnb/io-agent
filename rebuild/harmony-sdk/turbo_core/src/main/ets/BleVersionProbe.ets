import { BleHandshakeTransport, BleHandshakeReport } from './BleHandshakeTransport';
import { AndroidVersionRequest, AndroidVersionReply, androidVersionRequest, androidVersionReply } from './AndroidVersionExchange';
import { encodeFrame, FrameStream } from './ProtocolCodec';
import { HarmonyHandshakeRuntime } from './HarmonyHandshakeRuntime';

export class VersionProbeReport {
  stage: string = 'idle';
  transportStage: string = 'idle';
  reason: string = '';
  mtu: number = 23;
  txBytes: number = 0;
  rxBytes: number = 0;
  protocolVersion: number = -1;
  peerIdentifierBytes: number = 0;
  fields: string[] = [];
}
// One version request, never an authentication request. Retains reply privately
// in owner memory for later explicit authentication; reports only tag/lengths.
export class BleVersionProbe {
  private transport: BleHandshakeTransport | undefined = undefined;
  private stream: FrameStream = new FrameStream();
  private runtime: HarmonyHandshakeRuntime = new HarmonyHandshakeRuntime();
  private report: VersionProbeReport = new VersionProbeReport();
  private active: boolean = false;
  private attempt: number = 0;
  private timer: number = -1;
  private deadline: number = 0;
  private started: boolean = false;
  private writeDone: boolean = false;
  private response: AndroidVersionReply | null = null;
  private request: Uint8Array = new Uint8Array();
  private update: (report: VersionProbeReport) => void;
  private accepted: (reply: AndroidVersionReply) => void;
  constructor(update: (report: VersionProbeReport) => void, accepted: (reply: AndroidVersionReply) => void) {
    this.update = update; this.accepted = accepted;
  }
  private emit(): void {
    const r = new VersionProbeReport(); r.stage = this.report.stage; r.reason = this.report.reason;
    r.transportStage = this.report.transportStage;
    r.mtu = this.report.mtu; r.txBytes = this.report.txBytes; r.rxBytes = this.report.rxBytes;
    r.protocolVersion = this.report.protocolVersion; r.peerIdentifierBytes = this.report.peerIdentifierBytes; r.fields = this.report.fields.slice();
    this.update(r);
  }
  start(deviceId: string, input: AndroidVersionRequest): void {
    if (this.active) throw new Error('version-probe-busy');
    if (!deviceId || deviceId.length > 128 || input.accountUTF8 !== null || input.publicKey !== null || input.pairValue !== null) throw new Error('version-probe-input');
    this.request = androidVersionRequest(input); this.active = true; this.started = false; this.writeDone = false;
    this.response = null; this.stream.reset(); this.report = new VersionProbeReport(); this.report.stage = 'connecting';
    const token = ++this.attempt;
    this.transport = new BleHandshakeTransport((r: BleHandshakeReport): void => {
      if (!this.active || token !== this.attempt) return;
      this.report.mtu = r.mtu; this.report.txBytes = r.txBytes; this.report.rxBytes = r.rxBytes;
      // Preserve the last live native stage when reporting timeout/disconnect.
      if (r.stage !== 'failed' && r.stage !== 'closed') this.report.transportStage = r.stage;
      if (r.stage === 'closed' || r.stage === 'failed') { this.finish('failed', r.reason); return; }
      if (r.stage === 'ready' && !this.started) this.send(token, r.generation);
      if (this.active) this.emit();
    }, (_t: number, bytes: Uint8Array): void => {
      if (!this.active || token !== this.attempt || !this.started) return;
      this.report.rxBytes += bytes.length;
      try {
        if (this.runtime.now() >= this.deadline) { this.finish('failed', 'version-timeout'); return; }
        const packets = this.stream.feed(bytes);
        try {
          for (const p of packets) {
            if (this.response !== null || packets.length !== 1 || p.businessID !== 0x10 || p.flags !== 0 || p.address !== null || p.slices.length !== 0) throw new Error('response-profile');
            this.response = androidVersionReply(p.payload);
          }
        } finally { for (const p of packets) p.payload.fill(0); }
        this.complete();
      } catch (_) { if (this.active) this.finish('failed', 'version-response-invalid'); }
    });
    this.transport.open(deviceId);
  }
  private send(token: number, transportToken: number): void {
    this.started = true; this.report.stage = 'waiting-version';
    let bytes = new Uint8Array(); let random = new Uint8Array();
    try {
      this.deadline = this.runtime.now() + 5000; random = this.runtime.random(2);
      bytes = encodeFrame({messageNumber:random[0] * 256 + random[1], flags:0, address:null, slices:new Uint8Array(), businessID:0x10, payload:this.request, response:false});
      this.request.fill(0);
      if (bytes.length > this.report.mtu - 3) throw new Error('mtu-too-small');
      this.timer = setTimeout(() => { if (this.active && token === this.attempt) this.finish('failed', 'version-timeout'); }, 5000);
      this.transport!.send(transportToken, bytes).then(() => {
        bytes.fill(0); if (!this.active || token !== this.attempt) return;
        this.writeDone = true; this.complete();
      }).catch(() => { bytes.fill(0); if (this.active && token === this.attempt) this.finish('failed', 'version-send-failed'); });
    } catch (_) { bytes.fill(0); this.finish('failed', 'version-send-preflight'); }
    finally { random.fill(0); }
  }
  private complete(): void {
    if (!this.active || !this.writeDone || this.response === null) return;
    if (this.stream.pendingBytes() !== 0) { this.finish('failed', 'version-trailing-data'); return; }
    if (this.runtime.now() >= this.deadline) { this.finish('failed', 'version-timeout'); return; }
    const reply = this.response; this.response = null;
    this.report.protocolVersion = reply.protocolVersion; this.report.peerIdentifierBytes = reply.peerIdentifier.length;
    this.report.fields = reply.fields.map(f => `0x${f.tag.toString(16)}:${f.value.length}`);
    // Only explicit owner receives values. UI callback is metadata only.
    this.accepted(reply); this.finish('received', 'version-only-no-authentication');
  }
  cancel(): void { if (this.active) this.finish('closed', 'cancelled'); }
  private finish(stage: string, reason: string): void {
    this.active = false; if (this.timer !== -1) clearTimeout(this.timer); this.timer = -1;
    this.stream.reset(); this.request.fill(0); this.request = new Uint8Array();
    if (this.response !== null) { this.response.peerIdentifier.fill(0); for (const f of this.response.fields) f.value.fill(0); this.response = null; }
    this.transport?.close(); this.transport = undefined;
    this.report.stage = stage; this.report.reason = reason; this.emit();
  }
}
