// Pure logic: no platform calls, no credentials, no vendor runtime dependency.
export class AttemptGate {
  private generation: number = 0;
  private active: boolean = false;

  begin(): number {
    this.generation += 1;
    this.active = true;
    return this.generation;
  }

  accepts(token: number): boolean {
    return this.active && token === this.generation;
  }

  cancel(): void {
    this.active = false;
    this.generation += 1;
  }
}

export class AdvertisementInfo {
  hasRayNeoService: boolean = false;
  malformed: boolean = false;
  localName: string = '';
}

// Android 1.0.4 S3.E uses the 16-bit service B81D for RayNeo scanning.
// A matching advertisement is a candidate, not an authenticated identity.
export function inspectAdvertisement(bytes: Uint8Array): AdvertisementInfo {
  const result = new AdvertisementInfo();
  let offset = 0;
  while (offset < bytes.length) {
    const length = bytes[offset];
    if (length === 0) { break; }
    if (offset + 1 + length > bytes.length) {
      result.malformed = true;
      break;
    }
    const type = bytes[offset + 1];
    if (type === 0x09 || (type === 0x08 && result.localName.length === 0)) {
      const name = decodeDeviceName(bytes.slice(offset + 2, offset + 1 + length));
      if (name.length > 0) { result.localName = name; }
    }
    if (type === 0x02 || type === 0x03) {
      if ((length - 1) % 2 !== 0) { result.malformed = true; }
      for (let i = offset + 2; i + 1 < offset + 1 + length; i += 2) {
        if (bytes[i] === 0x1d && bytes[i + 1] === 0xb8) { result.hasRayNeoService = true; }
      }
    }
    if (type === 0x16 && length >= 3 && bytes[offset + 2] === 0x1d && bytes[offset + 3] === 0xb8) {
      result.hasRayNeoService = true;
    }
    offset += 1 + length;
  }
  return result;
}

export function candidateName(name: string): boolean {
  return /rayneo|雷鸟/i.test(name);
}

export function validBattery(bytes: Uint8Array): number {
  return bytes.length === 1 && bytes[0] <= 100 ? bytes[0] : -1;
}

// Names are display data, never identity/authentication. Strip controls and bidi overrides.
export function displayDeviceName(name: string): string {
  return name.replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f]/g, '').trim().slice(0, 128);
}

// Strict, bounded UTF-8 for Bluetooth Device Name (at most 248 octets).
export function decodeDeviceName(bytes: Uint8Array): string {
  if (bytes.length === 0 || bytes.length > 248) { return ''; }
  let text = '';
  for (let i = 0; i < bytes.length;) {
    const head = bytes[i++];
    let cp = head;
    let count = 0;
    let minimum = 0;
    if (head < 0x80) { count = 0; }
    else if (head >= 0xc2 && head <= 0xdf) { cp = head & 0x1f; count = 1; minimum = 0x80; }
    else if (head >= 0xe0 && head <= 0xef) { cp = head & 0x0f; count = 2; minimum = 0x800; }
    else if (head >= 0xf0 && head <= 0xf4) { cp = head & 7; count = 3; minimum = 0x10000; }
    else { return ''; }
    if (i + count > bytes.length) { return ''; }
    for (let j = 0; j < count; j++) {
      const next = bytes[i++];
      if ((next & 0xc0) !== 0x80) { return ''; }
      cp = (cp << 6) | (next & 0x3f);
    }
    if (cp < minimum || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) { return ''; }
    text += String.fromCodePoint(cp);
  }
  return displayDeviceName(text);
}
