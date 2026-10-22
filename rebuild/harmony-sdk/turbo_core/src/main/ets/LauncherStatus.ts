// Finite read-only launcher query, independently encoded from the already
// validated iOS request_general_status envelope. Android 1.0.4 LAUNCHER wire=15.
export function generalStatusQuery(): Uint8Array {
  const json = '{"cmd":"request_general_status","payload":{"data":"","mode":0,"value":0}}';
  const bytes = new Uint8Array(json.length + 8);
  bytes.set([8, 1, 16, 1, 26, json.length]);
  for (let i = 0; i < json.length; i++) bytes[i + 6] = json.charCodeAt(i);
  bytes.set([34, 0], json.length + 6);
  return bytes;
}
export function isGeneralStatusQuery(payload: Uint8Array): boolean {
  const expected = generalStatusQuery();
  return payload.length === expected.length && payload.every((value, index) => value === expected[index]);
}
export class LauncherEnvelope {
  type: number = -1;
  sequence: number = 0;
  json: Uint8Array = new Uint8Array();
  binary: Uint8Array = new Uint8Array();
}
// Bounded protobuf reader; skip unknown wire 0/1/2/5 fields, reject ambiguous
// duplicates and truncation. No JSON values are logged or retained here.
export function readLauncherEnvelope(bytes: Uint8Array): LauncherEnvelope {
  if (bytes.length > 16384) throw new Error('launcher-size');
  const out = new LauncherEnvelope(); let pos = 0; let hasJson = false; let hasBinary = false;
  const varint = (): number => {
    let n = 0;
    for (let i = 0; i < 5; i++) {
      if (pos >= bytes.length) throw new Error('launcher-truncated');
      const b = bytes[pos++]; n += (b & 127) * Math.pow(128, i);
      if (!(b & 128)) return n;
    }
    throw new Error('launcher-varint');
  };
  while (pos < bytes.length) {
    const key = varint(), field = Math.floor(key / 8), wire = key % 8;
    if (field === 0) throw new Error('launcher-field');
    if (wire === 0) {
      const n = varint();
      if (field === 2) { if (out.type !== -1) throw new Error('launcher-duplicate'); out.type = n; }
      if (field === 5) out.sequence = n;
    } else if (wire === 2) {
      const size = varint(); if (size > bytes.length - pos) throw new Error('launcher-truncated');
      if (field === 3) { if (hasJson) throw new Error('launcher-duplicate'); hasJson = true; out.json = bytes.slice(pos, pos + size); }
      if (field === 4) { if (hasBinary) throw new Error('launcher-duplicate'); hasBinary = true; out.binary = bytes.slice(pos, pos + size); }
      pos += size;
    } else if (wire === 1 || wire === 5) { pos += wire === 1 ? 8 : 4; if (pos > bytes.length) throw new Error('launcher-truncated'); }
    else throw new Error('launcher-wire');
  }
  return out;
}
