import { AndroidVersionRequest, androidVersionRequest, androidVersionReply } from './AndroidVersionExchange';
import { AndroidAuthCalculations, Sha256Provider } from './AuthCalculations';
import { authRequest, authFields } from './ProtocolCodec';

export type GuestExchangeStage = 'idle' | 'version' | 'proof' | 'verified' | 'failed';
// Payload-level state machine, NOT a radio driver, system pairing, or business-ready gate.
// Only one explicit guest attempt. Caller owns fresh CSPRNG input, monotonic time,
// stable local identity/selected transport context, framing and channel correlation.
// expectedPeerIdentifier must be the protocol identity, NOT an assumed BLE random address.
export class GuestAuthExchange {
  private calc: AndroidAuthCalculations;
  private state: GuestExchangeStage = 'idle';
  private attempt: number = 0;
  private deadline: number = 0;
  private lastTime: number = 0;
  private phone: Uint8Array = new Uint8Array();
  private peer: Uint8Array = new Uint8Array();
  private random: Uint8Array = new Uint8Array();
  private session: Uint8Array = new Uint8Array();
  private reason: string = '';
  constructor(sha: Sha256Provider) { this.calc = new AndroidAuthCalculations(sha); }
  stage(): GuestExchangeStage { return this.state; }
  failure(): string { return this.reason; }
  generation(): number { return this.attempt; }
  private clear(): void {
    this.phone.fill(0); this.peer.fill(0); this.random.fill(0); this.session.fill(0);
    this.phone = new Uint8Array(); this.peer = new Uint8Array();
    this.random = new Uint8Array(); this.session = new Uint8Array();
  }
  private fail(reason: string): void { this.clear(); this.state = 'failed'; this.reason = reason; }
  begin(input: AndroidVersionRequest, expectedPeerIdentifier: Uint8Array, random4: Uint8Array,
    now: number, timeoutMs: number = 5000): Uint8Array {
    if (this.state === 'version' || this.state === 'proof' || this.state === 'verified') throw new Error('exchange-busy');
    if (input.accountUTF8 !== null || input.publicKey !== null) throw new Error('guest-explicit-only');
    if (expectedPeerIdentifier.length !== 6 || random4.length !== 4) throw new Error('exchange-input-length');
    if (!Number.isSafeInteger(now) || now < 0 || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000 ||
      !Number.isSafeInteger(now + timeoutMs) || this.attempt >= Number.MAX_SAFE_INTEGER - 1) throw new Error('exchange-time');
    const payload = androidVersionRequest(input);
    this.clear(); this.attempt++; this.state = 'version'; this.reason = '';
    this.phone = input.phoneIdentifier.slice(); this.peer = expectedPeerIdentifier.slice(); this.random = random4.slice();
    this.lastTime = now; this.deadline = now + timeoutMs;
    return payload;
  }
  private current(token: number, now: number): boolean {
    if (token !== this.attempt || (this.state !== 'version' && this.state !== 'proof' && this.state !== 'verified')) return false;
    if (!Number.isSafeInteger(now) || now < this.lastTime) { this.fail('clock-regression'); return false; }
    if (now >= this.deadline) { this.fail('timeout'); return false; }
    this.lastTime = now; return true;
  }
  receiveVersion(token: number, now: number, payload: Uint8Array): Uint8Array | null {
    if (!this.current(token, now) || this.state !== 'version') return null;
    try {
      const reply = androidVersionReply(payload);
      // Official Android S3.W forwards version 2 to the same auth path;
      // actual iO version-only response on Mate X5 confirms version 2.
      if (reply.protocolVersion !== 1 && reply.protocolVersion !== 2) { this.fail('unsupported-version'); return null; }
      for (let i = 0; i < 6; i++) {
        if (reply.peerIdentifier[i] !== this.peer[i]) { this.fail('peer-identifier-mismatch'); return null; }
      }
      // A peer requesting account/key processing must never silently fall back to guest.
      const account = reply.field(0x1a);
      if ((account !== null && account.length !== 0) || reply.field(0x19) !== null) {
        this.fail('account-bound-peer'); return null;
      }
      const proof = this.calc.guestProof(this.random, this.phone, this.peer);
      try {
        const auth = authRequest(this.random, proof); this.state = 'proof'; return auth;
      } finally { proof.fill(0); }
    } catch (_) { this.fail('version-invalid'); return null; }
  }
  receiveProof(token: number, now: number, payload: Uint8Array): boolean {
    if (!this.current(token, now) || this.state !== 'proof') return false;
    try {
      const fields = authFields(payload, 0x19);
      const peerRandom = fields.find(f => f.tag === 0x10)!.value;
      const proof = fields.find(f => f.tag === 0x11)!.value;
      const expected = this.calc.guestProof(peerRandom, this.phone, this.peer);
      let difference = 0;
      for (let i = 0; i < 32; i++) difference |= proof[i] ^ expected[i];
      expected.fill(0);
      if (difference !== 0) { this.fail('proof-mismatch'); return false; }
      const key = this.calc.deriveSessionKey(this.random, peerRandom, this.phone, this.peer, null);
      this.clear(); this.session = key; this.state = 'verified'; return true;
    } catch (_) { this.fail('proof-invalid'); return false; }
  }
  takeSessionKey(token: number, now: number): Uint8Array | null {
    if (!this.current(token, now) || this.state !== 'verified' || this.session.length !== 32) return null;
    const result = this.session.slice(); this.session.fill(0); this.session = new Uint8Array(); return result;
  }
  tick(token: number, now: number): void { this.current(token, now); }
  cancel(): void { this.fail('cancelled'); }
}
