import { TlvField, encodeTlvs, decodeTlvs } from './ProtocolCodec';

// Android 1.0.4 b4.C1299b.e profile. Byte inputs are caller-encoded UTF-8;
// this does not claim Harmony is an officially supported device type.
export interface AndroidVersionRequest {
  phoneIdentifier: Uint8Array;
  phoneNameUTF8: Uint8Array;
  manufacturerUTF8: Uint8Array;
  modelUTF8: Uint8Array;
  accountUTF8: Uint8Array | null;
  publicKey: Uint8Array | null;
  pairValue: number | null;
}
export class AndroidVersionReply {
  protocolVersion: number = -1;
  peerIdentifier: Uint8Array = new Uint8Array();
  // May contain private names/serials/account IDs. Never log or persist wholesale.
  fields: TlvField[] = [];
  field(tag: number): Uint8Array | null {
    const found = this.fields.find(f => f.tag === tag);
    return found === undefined ? null : found.value.slice();
  }
}
function bounded(bytes: Uint8Array, max: number): void {
  if (bytes.length > max) throw new Error('version-field-limit');
}
export function androidVersionRequest(input: AndroidVersionRequest): Uint8Array {
  if (input.phoneIdentifier.length !== 6) throw new Error('version-phone-identifier');
  bounded(input.phoneNameUTF8, 248); bounded(input.manufacturerUTF8, 128); bounded(input.modelUTF8, 128);
  if (input.pairValue !== null && input.pairValue !== 1 && input.pairValue !== 2) throw new Error('version-pair-policy');
  if (input.accountUTF8 !== null && (input.accountUTF8.length === 0 || input.accountUTF8.length > 1024)) {
    throw new Error('version-account');
  }
  if (input.publicKey !== null && (input.publicKey.length !== 65 || input.publicKey[0] !== 4)) {
    throw new Error('version-public-key-shape');
  }
  // Stronger than the generic vendor encoder: do not accidentally mix guest/key branches.
  if ((input.accountUTF8 === null) !== (input.publicKey === null)) throw new Error('version-account-key-mismatch');
  const fields: TlvField[] = [
    {tag:0x10,value:new Uint8Array([1])}, {tag:0x11,value:input.phoneIdentifier},
    {tag:0x12,value:input.phoneNameUTF8}, {tag:0x13,value:new Uint8Array([2])},
    {tag:0x16,value:input.manufacturerUTF8}, {tag:0x17,value:input.modelUTF8}
  ];
  if (input.accountUTF8 !== null) fields.push({tag:0x1a,value:input.accountUTF8});
  if (input.publicKey !== null) fields.push({tag:0x19,value:input.publicKey});
  if (input.pairValue !== null) fields.push({tag:0x1b,value:new Uint8Array([input.pairValue])});
  return encodeTlvs([{tag:0x11,value:encodeTlvs(fields)}]);
}
export function androidVersionReply(payload: Uint8Array): AndroidVersionReply {
  if (payload.length > 4096) throw new Error('version-payload-limit');
  const outer = decodeTlvs(payload);
  if (outer.length !== 1 || outer[0].tag !== 0x11) throw new Error('version-outer');
  const fields = decodeTlvs(outer[0].value);
  if (fields.length > 32) throw new Error('version-field-count');
  const seen: number[] = [];
  for (const field of fields) {
    bounded(field.value, 1024);
    if (seen.includes(field.tag)) throw new Error('version-duplicate-field');
    seen.push(field.tag);
  }
  const result = new AndroidVersionReply(); result.fields = fields;
  const version = result.field(0x10), identifier = result.field(0x11);
  // Our handshake policy requires these, unlike vendor parser's zero-filled defaults.
  if (version === null || version.length !== 1 || identifier === null || identifier.length !== 6) {
    throw new Error('version-required-fields');
  }
  const kind = result.field(0x13);
  if (kind !== null && kind.length !== 1) throw new Error('version-device-type');
  const key = result.field(0x19);
  if (key !== null && (key.length !== 65 || key[0] !== 4)) throw new Error('version-peer-key-shape');
  result.protocolVersion = version[0]; result.peerIdentifier = identifier;
  return result;
}
