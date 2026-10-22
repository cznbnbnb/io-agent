// Android 1.0.4 algorithm profile, not an authenticated transport. No randomness,
// persistence, logging, platform identity access, ECDH or automatic guest fallback.
export interface Sha256Provider { digest(bytes: Uint8Array): Uint8Array; }
const SALT: Uint8Array = new Uint8Array([7,18,200,173,39,116,65,149,222,95,161,234,109,2,95,184]);
function concat(parts: Uint8Array[]): Uint8Array {
  let size = 0; for (const part of parts) size += part.length;
  const result = new Uint8Array(size); let offset = 0;
  for (const part of parts) { result.set(part, offset); offset += part.length; }
  return result;
}
function exact(bytes: Uint8Array, length: number): void {
  if (bytes.length !== length) throw new Error('auth-length');
}
function account(bytes: Uint8Array): void {
  if (bytes.length < 1 || bytes.length > 4096) throw new Error('account-utf8-required');
}
export function decodeHex(text: string): Uint8Array {
  if (text.length % 2 !== 0 || text.length > 8192 || !/^[0-9a-fA-F]*$/.test(text)) throw new Error('invalid-hex');
  const bytes = new Uint8Array(text.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(text.substring(i * 2, i * 2 + 2), 16);
  return bytes;
}
export function proofMatches(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== 32 || right.length !== 32) return false;
  let difference = 0;
  for (let i = 0; i < 32; i++) difference |= left[i] ^ right[i];
  return difference === 0; // No early byte exit; not a VM constant-time guarantee.
}
export class AndroidAuthCalculations {
  private sha: Sha256Provider;
  constructor(sha: Sha256Provider) { this.sha = sha; }
  private hash(parts: Uint8Array[]): Uint8Array {
    const bytes = concat(parts);
    try { const result = this.sha.digest(bytes); exact(result, 32); return result.slice(); }
    finally { bytes.fill(0); } // Best effort for our temporary buffer, not all VM copies.
  }
  private inputs(random: Uint8Array, phone: Uint8Array, glasses: Uint8Array): void {
    exact(random, 4); exact(phone, 6); exact(glasses, 6);
  }
  guestProof(random: Uint8Array, phone: Uint8Array, glasses: Uint8Array): Uint8Array {
    this.inputs(random, phone, glasses); return this.hash([random, phone, glasses, SALT]);
  }
  boundProof(random: Uint8Array, phone: Uint8Array, glasses: Uint8Array,
    accountUTF8: Uint8Array, bondKey: Uint8Array): Uint8Array {
    this.inputs(random, phone, glasses); account(accountUTF8); exact(bondKey, 32);
    return this.hash([random, phone, glasses, accountUTF8, bondKey]);
  }
  deriveBondKey(sharedSecret: Uint8Array, accountUTF8: Uint8Array): Uint8Array {
    exact(sharedSecret, 32); account(accountUTF8); return this.hash([sharedSecret, SALT, accountUTF8]);
  }
  deriveSessionKey(localRandom: Uint8Array, peerRandom: Uint8Array, phone: Uint8Array,
    glasses: Uint8Array, bondKeyHex: string | null): Uint8Array {
    this.inputs(localRandom, phone, glasses); exact(peerRandom, 4);
    if (bondKeyHex === null) return this.hash([localRandom, peerRandom, phone, glasses, SALT]);
    if (bondKeyHex.length !== 64) throw new Error('bond-key-text-length');
    const decoded = decodeHex(bondKeyHex); decoded.fill(0);
    const text = new Uint8Array(64);
    for (let i = 0; i < text.length; i++) text[i] = bondKeyHex.charCodeAt(i);
    try { return this.hash([localRandom, peerRandom, phone, glasses, SALT, text]); }
    finally { text.fill(0); }
  }
}
