// OGG/Opus 流式封装：把眼镜发来的原始 opus 帧原样装进 OGG 容器，不做任何转码。
// 结构：第 0 页 OpusHead(BOS)，第 1 页 OpusTags，之后每页 <= perPage 帧；
// 每帧 60ms = 2880 个 48kHz granule 单位（RFC 7845），最后一页带 EOS。
// 与官方 addon 的 AlwaysOnOgg.m 扫描器（granule / CRC / 分包规则）保持兼容。

function crc32(bytes: Uint8Array): number {
  let crc = 0;
  for (let i = 0; i < bytes.length; i++) {
    crc ^= bytes[i] << 24;
    for (let bit = 0; bit < 8; bit++) crc = (crc << 1) ^ ((crc & 0x80000000) ? 0x04c11db7 : 0);
  }
  return crc >>> 0;
}

function put32(out: Uint8Array, at: number, value: number): void {
  out[at] = value & 255; out[at + 1] = (value >>> 8) & 255; out[at + 2] = (value >>> 16) & 255; out[at + 3] = (value >>> 24) & 255;
}

// OpusHead：版本 1、单声道、preSkip 312、原始采样率 16 kHz、增益 0、映射族 0。
export function opusHeadPage(serial: number, preSkip: number = 312, sampleRate: number = 16000): Uint8Array {
  const body = new Uint8Array(19);
  const magic = 'OpusHead';
  for (let i = 0; i < 8; i++) body[i] = magic.charCodeAt(i);
  body[8] = 1; body[9] = 1;
  body[10] = preSkip & 255; body[11] = (preSkip >>> 8) & 255;
  put32(body, 12, sampleRate);
  body[16] = 0; body[17] = 0; body[18] = 0;
  return assemble(2, 0, 0, serial, [19], body);
}

export function opusTagsPage(serial: number): Uint8Array {
  const vendor = 'TurboIO-Lifelog';
  const body = new Uint8Array(8 + 4 + vendor.length + 4);
  const magic = 'OpusTags';
  for (let i = 0; i < 8; i++) body[i] = magic.charCodeAt(i);
  put32(body, 8, vendor.length);
  for (let i = 0; i < vendor.length; i++) body[12 + i] = vendor.charCodeAt(i);
  put32(body, 12 + vendor.length, 0);
  return assemble(0, 0, 1, serial, [body.length], body);
}

// 组装一页：header(27) + lacing table + body，CRC 覆盖全页（CRC 字段先置零）。
function assemble(flags: number, granule: number, sequence: number, serial: number, laces: number[], body: Uint8Array): Uint8Array {
  const page = new Uint8Array(27 + laces.length + body.length);
  page[0] = 79; page[1] = 103; page[2] = 103; page[3] = 83;
  page[4] = 0; page[5] = flags;
  let g = granule;
  for (let i = 0; i < 8; i++) { page[6 + i] = g % 256; g = Math.floor(g / 256); }
  put32(page, 14, serial); put32(page, 18, sequence); put32(page, 22, 0);
  page[26] = laces.length;
  for (let i = 0; i < laces.length; i++) page[27 + i] = laces[i];
  page.set(body, 27 + laces.length);
  put32(page, 22, crc32(page));
  return page;
}

export class OggOpusWriter {
  private write: (bytes: Uint8Array) => void;
  private serial: number;
  private sequence: number = 0;
  private samples: number = 0;          // 已写入帧的累计样本（48 kHz 单位）
  private perPage: number;
  private frameBytes: number;
  private laces: number[] = [];
  private body: Uint8Array;
  private bodyLength: number = 0;
  started: boolean = false;

  constructor(write: (bytes: Uint8Array) => void, serial: number, perPage: number = 100, frameBytes: number = 240) {
    this.write = write; this.serial = serial >>> 0; this.perPage = perPage; this.frameBytes = frameBytes;
    this.body = new Uint8Array(perPage * frameBytes);
  }

  // 头部两页（OpusHead 必须 BOS，granule 0；OpusTags 次页）。
  begin(): void {
    if (this.started) return;
    this.started = true;
    this.write(opusHeadPage(this.serial));
    this.write(opusTagsPage(this.serial));
    this.sequence = 2;
  }

  // 每帧 60 ms（960 样本 @16 kHz）= 2880 个 48 kHz granule 单位。
  frameSamples(): number { return 2880; }

  push(frame: Uint8Array): void {
    if (!this.started) this.begin();
    if (frame.length !== this.frameBytes) throw new Error('OGG 帧长度异常');
    if (this.laces.length === this.perPage) this.flushPage(false, this.perPage);
    this.body.set(frame, this.laces.length * this.frameBytes);
    this.laces.push(this.frameBytes);
    this.bodyLength += frame.length;
  }

  private flushPage(eos: boolean, count: number): void {
    if (count <= 0 && !eos) return;
    const laces = this.laces.slice(0, count);
    const body = this.body.slice(0, count * this.frameBytes);
    this.samples += this.frameSamples() * count;
    this.write(assemble(eos ? 4 : 0, this.samples, this.sequence++, this.serial, laces, body));
    const rest = this.laces.slice(count);
    if (rest.length) this.body.set(this.body.slice(count * this.frameBytes, this.bodyLength), 0);
    this.laces = rest; this.bodyLength = rest.length * this.frameBytes;
  }

  // 收尾：最后一页带 EOS（尽量保证该页至少含一帧）。
  finish(): void {
    if (!this.started) this.begin();
    this.flushPage(true, this.laces.length);
  }

  frames(): number { return this.samples / this.frameSamples(); }
}

// 从 OGG/Opus 中取回原始帧（跳过 OpusHead/OpusTags），供解码 / ASR 使用。
export function readOggOpusFrames(bytes: Uint8Array): Uint8Array[] {
  const frames: Uint8Array[] = [];
  let pos = 0;
  let packets = 0;
  let pending = new Uint8Array(0);
  while (pos + 27 <= bytes.length) {
    const header = bytes.slice(pos, pos + 27);
    if (!(header[0] === 79 && header[1] === 103 && header[2] === 103 && header[3] === 83)) break;
    const count = header[26];
    let size = 0;
    for (let i = 0; i < count; i++) size += bytes[pos + 27 + i];
    const bodyAt = pos + 27 + count;
    if (bodyAt + size > bytes.length) break;
    let at = 0;
    for (let i = 0; i < count; i++) {
      const lace = bytes[pos + 27 + i];
      const merged = new Uint8Array(pending.length + lace);
      merged.set(pending); merged.set(bytes.slice(bodyAt + at, bodyAt + at + lace), pending.length);
      pending = merged; at += lace;
      if (lace === 255) continue;
      if (packets >= 2 && pending.length > 0) frames.push(pending);
      packets++; pending = new Uint8Array(0);
    }
    if ((header[5] & 4) !== 0) break;
    pos = bodyAt + size;
  }
  return frames;
}

// 只要帧偏移（不复制数据）：长音频用这个省内存、少对象。
export function readOggOpusFrameOffsets(bytes: Uint8Array): number[] {
  const offsets: number[] = [];
  let pos = 0;
  let packets = 0;
  let pendingStart = 0;
  let pendingLength = 0;
  while (pos + 27 <= bytes.length) {
    const header = bytes.slice(pos, pos + 27);
    if (!(header[0] === 79 && header[1] === 103 && header[2] === 103 && header[3] === 83)) break;
    const count = header[26];
    let size = 0;
    for (let i = 0; i < count; i++) size += bytes[pos + 27 + i];
    const bodyAt = pos + 27 + count;
    if (bodyAt + size > bytes.length) break;
    let at = 0;
    for (let i = 0; i < count; i++) {
      const lace = bytes[pos + 27 + i];
      if (pendingLength === 0) pendingStart = bodyAt + at;
      pendingLength += lace;
      at += lace;
      if (lace === 255) continue;
      if (packets >= 2 && pendingLength > 0) offsets.push(pendingStart);
      packets++;
      pendingLength = 0;
    }
    if ((header[5] & 4) !== 0) break;
    pos = bodyAt + size;
  }
  return offsets;
}

export class OggPrefix {
  offsets:number[]=[];committedBytes:number=0;eos:boolean=false;serial:number=0;pages:number=0;packets:number=0;
}
function hasAscii(bytes:Uint8Array,at:number,text:string):boolean{
  for(let i=0;i<text.length;i++)if(bytes[at+i]!==text.charCodeAt(i))return false;return true;
}
// Strict reader for growing, fsynced LifeLog archives. A partial final page is
// left for the next observation; an invalid committed page is never skipped.
export function appendLifelogPage(page:Uint8Array,out:OggPrefix,at:number):void{
  if(out.eos||at!==out.committedBytes||page.length<27||!hasAscii(page,0,'OggS')||page[4]!==0)throw new Error('OGG_HEADER_INVALID');
  const count=page[26];if(page.length<27+count)throw new Error('OGG_PAGE_INCOMPLETE');
  let size=0;for(let i=0;i<count;i++)size+=page[27+i];
  if(page.length!==27+count+size)throw new Error('OGG_PAGE_INCOMPLETE');
  const u32=(offset:number):number=>(page[offset]|page[offset+1]<<8|page[offset+2]<<16|page[offset+3]<<24)>>>0;
  const expected=u32(22),blank=page.slice();blank.fill(0,22,26);if(crc32(blank)!==expected)throw new Error('OGG_CRC_INVALID');
  if((page[5]&~7)!==0||((page[5]&2)!==0)!==(out.pages===0))throw new Error('OGG_FLAGS_INVALID');
  const serial=u32(14);if(out.pages===0)out.serial=serial;
  if(serial!==out.serial||u32(18)!==out.pages)throw new Error('OGG_SEQUENCE_INVALID');
  if((page[5]&1)!==0)throw new Error('OGG_CONTINUED_PROFILE_UNSUPPORTED');
  let bodyAt=27+count;const offsets:number[]=[];let packets=out.packets;
  for(let i=0;i<count;i++){
    const length=page[27+i];
    if(packets===0){
      if(length!==19||!hasAscii(page,bodyAt,'OpusHead')||page[bodyAt+8]!==1||page[bodyAt+9]!==1||page[bodyAt+18]!==0)throw new Error('OGG_HEAD_PROFILE_UNSUPPORTED');
    }else if(packets===1){if(length<8||!hasAscii(page,bodyAt,'OpusTags'))throw new Error('OGG_TAGS_INVALID');}
    else{if(length!==240)throw new Error('OGG_FRAME_PROFILE_UNSUPPORTED');offsets.push(at+bodyAt);}
    packets++;bodyAt+=length;
  }
  if((page[5]&4)!==0&&packets<2)throw new Error('OGG_ARCHIVE_INCOMPLETE');
  out.offsets.push(...offsets);out.packets=packets;out.pages++;out.committedBytes=at+page.length;out.eos=(page[5]&4)!==0;
}
export function inspectLifelogPrefix(bytes:Uint8Array,sealed:boolean=false):OggPrefix{
  const out=new OggPrefix();let at=0;
  while(at+27<=bytes.length){
    if(bytes[at]!==79||bytes[at+1]!==103||bytes[at+2]!==103||bytes[at+3]!==83||bytes[at+4]!==0)throw new Error('OGG_HEADER_INVALID');
    const count=bytes[at+26];if(at+27+count>bytes.length)break;
    let bodySize=0;for(let i=0;i<count;i++)bodySize+=bytes[at+27+i];
    const end=at+27+count+bodySize;if(end>bytes.length)break;
    appendLifelogPage(bytes.slice(at,end),out,at);at=end;if(out.eos)break;
  }
  if((out.eos&&out.committedBytes!==bytes.length)||(sealed&&(!out.eos||out.committedBytes!==bytes.length)))throw new Error('OGG_ARCHIVE_INCOMPLETE');
  return out;
}
