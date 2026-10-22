// Independent pure codec. iOS framing is statically reconstructed; 1.0.4 live
// samples corroborate header/TLV lengths, NOT CRC or HarmonyOS interoperability.
export const MAX_FRAME_BYTES: number = 65541;
export const MAX_PAYLOAD_BYTES: number = 65524;
export interface FramePacket {
  messageNumber: number;
  flags: number;
  address: number | null;
  slices: Uint8Array;
  businessID: number;
  payload: Uint8Array;
  // Official wire: request head 0xAA55, auto-response (ACK) head 0x55AA.
  response: boolean;
}
export interface TlvField { tag: number; value: Uint8Array; }

function uint(value: number, maximum: number): void {
  if (!Number.isInteger(value) || value < 0 || value > maximum) throw new Error('invalid-integer');
}
export function crc16Xmodem(bytes: Uint8Array): number {
  let crc = 0;
  for (let i = 0; i < bytes.length; i++) {
    crc ^= bytes[i] << 8;
    for (let bit = 0; bit < 8; bit++) crc = ((crc << 1) ^ ((crc & 0x8000) ? 0x1021 : 0)) & 65535;
  }
  return crc;
}
function headCode(bytes: Uint8Array): number {
  if (bytes.length < 4) throw new Error('truncated-header');
  if (bytes[0] === 0xaa && bytes[1] === 0x55) return 0;
  if (bytes[0] === 0x55 && bytes[1] === 0xaa) return 1;
  throw new Error('invalid-head');
}
function declaredSize(bytes: Uint8Array): number {
  headCode(bytes);
  const size = bytes[2] * 256 + bytes[3] + 6;
  if (size < 10 || size > MAX_FRAME_BYTES) throw new Error('invalid-length');
  return size;
}
export function encodeFrame(packet: FramePacket): Uint8Array {
  uint(packet.messageNumber, 65535); uint(packet.flags, 31); uint(packet.businessID, 255);
  if (packet.address !== null) uint(packet.address, 255);
  if (((packet.flags & 2) !== 0) !== (packet.address !== null)) throw new Error('address-flag-mismatch');
  if (packet.slices.length > 7) throw new Error('slice-metadata-too-long');
  if (packet.payload.length > MAX_PAYLOAD_BYTES) throw new Error('payload-too-long');
  const size = 10 + (packet.address === null ? 0 : 1) + packet.slices.length + packet.payload.length;
  if (size > MAX_FRAME_BYTES) throw new Error('frame-too-long');
  const bytes = new Uint8Array(size), length = size - 6;
  bytes.set([packet.response ? 0x55 : 0xaa, packet.response ? 0xaa : 0x55, length >>> 8, length & 255,
    packet.messageNumber >>> 8, packet.messageNumber & 255, packet.flags | (packet.slices.length << 5)]);
  let offset = 7;
  if (packet.address !== null) bytes[offset++] = packet.address;
  bytes.set(packet.slices, offset); offset += packet.slices.length;
  bytes[offset++] = packet.businessID;
  bytes.set(packet.payload, offset);
  const crc = crc16Xmodem(bytes.subarray(4, size - 2));
  bytes[size - 2] = crc >>> 8; bytes[size - 1] = crc & 255;
  return bytes;
}
export function decodeFrame(bytes: Uint8Array): FramePacket {
  const size = declaredSize(bytes);
  if (bytes.length !== size) throw new Error('frame-size-mismatch');
  const response = headCode(bytes) === 1;
  const flags = bytes[6] & 31, sliceCount = bytes[6] >>> 5;
  const addressCount = (flags & 2) ? 1 : 0, businessOffset = 7 + addressCount + sliceCount;
  if (businessOffset >= size - 2) throw new Error('truncated-frame');
  if (size - businessOffset - 3 > MAX_PAYLOAD_BYTES) throw new Error('payload-too-long');
  if (crc16Xmodem(bytes.subarray(4, size - 2)) !== bytes[size - 2] * 256 + bytes[size - 1]) {
    throw new Error('crc-mismatch');
  }
  return {messageNumber:bytes[4] * 256 + bytes[5], flags:flags,
    address:addressCount === 1 ? bytes[7] : null,
    slices:bytes.slice(7 + addressCount, businessOffset), businessID:bytes[businessOffset],
    payload:bytes.slice(businessOffset + 1, size - 2), response:response};
}

// Strict, bounded stream. Never skips corrupt bytes searching for a new header.
// A failed feed invalidates the stream until reset; no partial batch is returned.
export class FrameStream {
  private buffer: Uint8Array = new Uint8Array(MAX_FRAME_BYTES);
  private used: number = 0;
  private expected: number = 4;
  private failed: boolean = false;
  reset(): void { this.buffer.fill(0); this.used = 0; this.expected = 4; this.failed = false; }
  pendingBytes(): number { return this.used; }
  finish(): void {
    if (this.failed) throw new Error('stream-failed');
    if (this.used !== 0) {
      this.buffer.fill(0); this.used = 0; this.expected = 4; this.failed = true;
      throw new Error('truncated-stream');
    }
  }
  feed(chunk: Uint8Array): FramePacket[] {
    if (this.failed) throw new Error('stream-failed');
    try {
      if (chunk.length > 262144) throw new Error('feed-too-large');
      const packets: FramePacket[] = [];
      let offset = 0;
      while (offset < chunk.length) {
        const count = Math.min(this.expected - this.used, chunk.length - offset);
        this.buffer.set(chunk.subarray(offset, offset + count), this.used);
        offset += count; this.used += count;
        if (this.used === 4 && this.expected === 4) this.expected = declaredSize(this.buffer.subarray(0, 4));
        if (this.used === this.expected) {
          if (packets.length >= 256) throw new Error('too-many-frames');
          packets.push(decodeFrame(this.buffer.subarray(0, this.used)));
          this.buffer.fill(0, 0, this.used); this.used = 0; this.expected = 4;
        }
      }
      return packets;
    } catch (error) {
      this.buffer.fill(0); this.used = 0; this.expected = 4; this.failed = true;
      throw error;
    }
  }
}
export function encodeTlvs(fields: TlvField[]): Uint8Array {
  if (fields.length > 64) throw new Error('too-many-fields');
  let length = 0;
  for (const field of fields) {
    uint(field.tag, 255);
    if (field.value.length > 65535) throw new Error('tlv-too-large');
    length += 3 + field.value.length;
  }
  if (length > MAX_PAYLOAD_BYTES) throw new Error('tlvs-too-large');
  const bytes = new Uint8Array(length); let offset = 0;
  for (const field of fields) {
    bytes[offset++] = field.tag; bytes[offset++] = field.value.length >>> 8; bytes[offset++] = field.value.length & 255;
    bytes.set(field.value, offset); offset += field.value.length;
  }
  return bytes;
}
export function decodeTlvs(bytes: Uint8Array): TlvField[] {
  if (bytes.length > MAX_PAYLOAD_BYTES) throw new Error('tlvs-too-large');
  const fields: TlvField[] = []; let offset = 0;
  while (offset < bytes.length) {
    if (fields.length >= 64 || bytes.length - offset < 3) throw new Error('tlv-header');
    const tag = bytes[offset], length = bytes[offset + 1] * 256 + bytes[offset + 2];
    offset += 3;
    if (length > bytes.length - offset) throw new Error('tlv-length');
    fields.push({tag:tag, value:bytes.slice(offset, offset + length)}); offset += length;
  }
  return fields;
}
export function authRequest(random: Uint8Array, proof: Uint8Array): Uint8Array {
  if (random.length !== 4 || proof.length !== 32) throw new Error('auth-length');
  return encodeTlvs([{tag:0x18, value:encodeTlvs([{tag:0x10, value:random},{tag:0x11, value:proof}])}]);
}
// Parse only an explicitly selected outer tag; no "request type + 1" guessing.
export function authFields(bytes: Uint8Array, expectedTag: number): TlvField[] {
  if (expectedTag !== 0x18 && expectedTag !== 0x19) throw new Error('auth-tag');
  const outer = decodeTlvs(bytes);
  if (outer.length !== 1 || outer[0].tag !== expectedTag) throw new Error('auth-outer');
  const inner = decodeTlvs(outer[0].value);
  if (inner.length !== 2 || inner.filter(f => f.tag === 0x10 && f.value.length === 4).length !== 1 ||
      inner.filter(f => f.tag === 0x11 && f.value.length === 32).length !== 1) throw new Error('auth-fields');
  return inner;
}
