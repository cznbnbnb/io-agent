// Debug-only bounded protocol experiments. A complete command receipt means
// handled, never lens-visible or microphone-stopped. Those have separate fields.
export class ChannelProbeSnapshot {
  connected: boolean = false;
  foreground: boolean = false;
  connection: number = 0;
  peer: string = '';
  active: boolean = false;
  closing: boolean = false;
  ready: boolean = false;
  blocked: boolean = false;
  can_cleanup: boolean = false;
  binding: string = '';
  operation_id: string = '';
  exit_operation_id: string = '';
  ack_code: number = -1;
  ack_config: string = '';
  text_profile: string = 'source-partial';
  audio_packets: number = 0;
  text_writes: number = 0;
  stop_submitted: boolean = false;
  exit_evidence: string = 'none';
  started_at: number = 0;
  note: string = '';
  notice_can_configure: boolean = false;
  notice_binding: string = '';
  notice_target_seconds: number = -1;
  notice_submission: string = 'none';
  notice_device_value_known: boolean = false;
}
class ChannelProbeRequest {
  schema: number = 1; id: string = ''; action: string = ''; expires_at: number = 0;
  text: string = ''; hold_ms: number = 0; source_id: string = ''; binding: string = ''; profile: string = 'source-partial';
  notice_seconds: number = 0;
}
class ChannelProbeReceipt {
  schema: number = 1; id: string = ''; request_json: string = ''; state: string = 'running'; error: string = '';
  snapshot: ChannelProbeSnapshot = new ChannelProbeSnapshot();
  before: ChannelProbeSnapshot = new ChannelProbeSnapshot();
  lens_verified: boolean = false;
}
export interface ChannelProbePorts {
  command: () => string | undefined;
  result: (id: string) => string | undefined;
  save: (id: string, json: string) => void;
  status: () => ChannelProbeSnapshot;
  start: (text: string, holdMs: number, operation: string, profile: string) => Promise<void>;
  update: (text: string, profile: string) => Promise<void>;
  stop: () => Promise<void>;
  noticeTiming?: (seconds: number) => Promise<void>;
}
export class ChannelProbeControl {
  private busy: boolean = false;
  private ports: ChannelProbePorts;
  constructor(ports: ChannelProbePorts) { this.ports = ports; }
  private valid(r: ChannelProbeRequest): boolean {
    if (!r || r.schema !== 1 || !/^chn-[a-f0-9]{32}$/.test(r.id) ||
      !Number.isSafeInteger(r.expires_at) || r.expires_at > Date.now() + 120000) return false;
    const base = ['schema','id','action','expires_at'], keys = Object.keys(r);
    let extra: string[] = [];
    if (r.action === 'display-start' || r.action === 'display-update') {
      extra = r.action === 'display-start' ? ['text','hold_ms'] : ['text','profile','source_id'];
      if (r.action === 'display-start' && keys.includes('profile')) extra.push('profile');
      if (typeof r.text !== 'string' || !r.text.trim() || r.text.length > 96 || /[\x00-\x1f\x7f]/.test(r.text)) return false;
      if (keys.includes('profile') && !['source-partial','source-final','classic-final','dual-final','subtitle-preview','subtitle-no-preview'].includes(r.profile)) return false;
      if (r.action === 'display-update' && r.profile.startsWith('subtitle-')) return false; // Startup-only preview distinction must never be faked by a text update.
      if (r.action === 'display-start' && (!Number.isInteger(r.hold_ms) || r.hold_ms < 5000 || r.hold_ms > 125000)) return false;
      if (r.action === 'display-update' && (!/^chn-[a-f0-9]{32}$/.test(r.source_id) || r.source_id === r.id)) return false;
    } else if (r.action === 'display-stop') {
      if (keys.includes('source_id')) {
        extra = ['source_id']; if (!/^chn-[a-f0-9]{32}$/.test(r.source_id) || r.source_id === r.id) return false;
      } else { extra = ['binding']; if (!/^[a-f0-9]{64}$/.test(r.binding)) return false; }
    } else if (r.action === 'notification-timing') {
      extra = ['notice_seconds','binding'];
      if (![5,10,15,20,30,120].includes(r.notice_seconds) || typeof r.binding !== 'string' || !/^[a-f0-9]{64}$/.test(r.binding)) return false;
    } else if (r.action !== 'status') return false;
    return keys.length === base.length + extra.length && keys.every((key: string): boolean => base.includes(key) || extra.includes(key));
  }
  async poll(): Promise<void> {
    if (this.busy) return; this.busy = true;
    let request: ChannelProbeRequest | undefined = undefined;
    let receipt: ChannelProbeReceipt | undefined = undefined;
    let attempted: boolean = false;
    try {
      const raw = this.ports.command(); if (!raw || raw.length > 4096) return;
      request = JSON.parse(raw) as ChannelProbeRequest; if (!this.valid(request)) return;
      const canonical = JSON.stringify(request), prior = this.ports.result(request.id);
      if (prior) {
        const saved = JSON.parse(prior) as ChannelProbeReceipt;
        if (saved.request_json !== canonical) return;
        if (saved.state === 'running') {
          saved.state = 'uncertain'; saved.error = 'CHANNEL_INTERRUPTED_NO_REPLAY';
          saved.snapshot = this.ports.status(); this.ports.save(request.id, JSON.stringify(saved));
        }
        return;
      }
      receipt = new ChannelProbeReceipt(); receipt.id = request.id; receipt.request_json = canonical;
      if (request.expires_at <= Date.now()) throw new Error('CHANNEL_EXPIRED');
      const before = this.ports.status(); receipt.before = before; receipt.snapshot = before;
      if (request.action === 'notification-timing' && (!before.foreground || !before.connected ||
        !before.notice_can_configure || request.binding !== before.notice_binding || !this.ports.noticeTiming)) throw new Error('CHANNEL_NOTICE_NOT_READY');
      if (request.action === 'display-start') {
        if (!before.foreground || !before.connected || before.active || before.blocked) throw new Error('CHANNEL_NOT_IDLE');
      }
      if (request.action === 'display-stop' && before.active) {
        if (!before.can_cleanup || request.source_id && request.source_id !== before.operation_id ||
          request.binding && request.binding !== before.binding) throw new Error('CHANNEL_SESSION_CHANGED');
      }
      if (request.action === 'display-update' && (!before.foreground || !before.connected || !before.active ||
        before.closing || !before.ready || !before.can_cleanup || request.source_id !== before.operation_id)) throw new Error('CHANNEL_SESSION_CHANGED');
      this.ports.save(request.id, JSON.stringify(receipt));
      const noticeTiming = this.ports.noticeTiming;
      if (request.action === 'notification-timing' && noticeTiming) { attempted = true; await noticeTiming(request.notice_seconds); }
      if (request.action === 'display-start') { attempted = true; await this.ports.start(request.text, request.hold_ms, request.id, request.profile || 'source-partial'); }
      if (request.action === 'display-update') { attempted = true; await this.ports.update(request.text, request.profile); }
      if (request.action === 'display-stop' && before.active) { attempted = true; await this.ports.stop(); }
      receipt.snapshot = this.ports.status(); receipt.state = 'complete'; this.ports.save(request.id, JSON.stringify(receipt));
    } catch (error) {
      if (request && receipt) {
        receipt.state = attempted ? 'uncertain' : 'error';
        const code = (error as Error).message;
        receipt.error = /^CHANNEL_[A-Z_]+$/.test(code) ? code : 'CHANNEL_FAILED';
        receipt.snapshot = this.ports.status();
        try { this.ports.save(request.id, JSON.stringify(receipt)); } catch (_) {}
      }
    } finally { this.busy = false; }
  }
}
