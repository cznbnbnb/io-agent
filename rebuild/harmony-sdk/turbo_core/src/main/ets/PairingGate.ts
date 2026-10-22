import { proofMatches } from './AuthCalculations';

export type PairStage = 'idle' | 'version' | 'proof' | 'system-link' | 'initializing' | 'ready' | 'failed';
export type PairChannel = 'ble' | 'spp';
export type AuthMode = 'guest' | 'bound';

// Pure admission gate, NOT a complete handshake driver. Callers must parse and
// correlate genuine events, compute expected proof from trusted local inputs,
// handle platform pairing and feed a monotonic clock. It never sends anything.
export class PairingGate {
  private generation: number = 0;
  private state: PairStage = 'idle';
  private channel: PairChannel = 'ble';
  private mode: AuthMode = 'guest';
  private deadline: number = 0;
  private lastTime: number = 0;
  private linkAccepted: boolean = false;
  private reason: string = '';

  stage(): PairStage { return this.state; }
  failure(): string { return this.reason; }
  authMode(): AuthMode { return this.mode; }
  canSendBusiness(): boolean { return this.state === 'ready'; }
  begin(channel: PairChannel, mode: AuthMode, now: number, timeoutMs: number): number {
    if (['version','proof','system-link','initializing'].includes(this.state)) throw new Error('pairing-busy');
    if (!['ble','spp'].includes(channel) || !['guest','bound'].includes(mode)) throw new Error('pairing-profile');
    if (!Number.isSafeInteger(now) || now < 0 || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120000 ||
        !Number.isSafeInteger(now + timeoutMs) || this.generation >= Number.MAX_SAFE_INTEGER - 1) throw new Error('pairing-time');
    this.generation++; this.channel = channel; this.mode = mode; this.lastTime = now;
    this.deadline = now + timeoutMs; this.linkAccepted = false; this.reason = ''; this.state = 'version';
    return this.generation;
  }
  private fail(reason: string): void { this.state = 'failed'; this.reason = reason; this.linkAccepted = false; }
  private accepts(token: number, channel: PairChannel, now: number): boolean {
    if (token !== this.generation || channel !== this.channel || ['idle','failed','ready'].includes(this.state)) return false;
    if (!Number.isSafeInteger(now) || now < this.lastTime) { this.fail('clock-regression'); return false; }
    this.lastTime = now;
    if (now >= this.deadline) { this.fail('timeout'); return false; }
    return true;
  }
  versionAccepted(token: number, channel: PairChannel, now: number): boolean {
    if (!this.accepts(token, channel, now) || this.state !== 'version') return false;
    this.state = 'proof'; return true;
  }
  peerProofChecked(token: number, channel: PairChannel, now: number,
    received: Uint8Array, expected: Uint8Array): boolean {
    if (!this.accepts(token, channel, now) || this.state !== 'proof') return false;
    if (!proofMatches(received, expected)) { this.fail('proof-mismatch'); return false; }
    this.state = this.linkAccepted ? 'initializing' : 'system-link'; return true;
  }
  systemPairingAccepted(token: number, channel: PairChannel, now: number): boolean {
    if (!this.accepts(token, channel, now)) return false;
    this.linkAccepted = true;
    if (this.state === 'system-link') this.state = 'initializing';
    return true;
  }
  initializationAccepted(token: number, channel: PairChannel, now: number): boolean {
    if (!this.accepts(token, channel, now) || this.state !== 'initializing') return false;
    this.state = 'ready'; return true;
  }
  tick(token: number, channel: PairChannel, now: number): void { this.accepts(token, channel, now); }
  disconnect(token: number, channel: PairChannel): void {
    if (token === this.generation && channel === this.channel && this.state !== 'idle') this.fail('disconnected');
  }
  cancel(): void { if (this.state !== 'idle') this.fail('cancelled'); }
}
