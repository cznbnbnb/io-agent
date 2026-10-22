import { AndroidAuthCalculations, decodeHex, proofMatches } from './AuthCalculations';
import { HarmonySha256 } from './HarmonySha256';
import { encodeFrame, decodeFrame, authRequest, authFields, crc16Xmodem } from './ProtocolCodec';
import { PairingGate } from './PairingGate';

export class ProtocolSelfTestReport {
  passed: number = 0;
  total: number = 0;
  lines: string[] = [];
  run(name: string, check: () => boolean): void {
    this.total++;
    try {
      if (!check()) throw new Error('self-test-mismatch');
      this.passed++; this.lines.push(`${name} · 通过`);
    } catch (_) { this.lines.push(`${name} · 失败`); }
  }
}

// Synthetic public vectors only. No Bluetooth, identifiers, permissions or disk.
export function runProtocolSelfTest(): ProtocolSelfTestReport {
  const report = new ProtocolSelfTestReport();
  report.run('CRC 标准向量', (): boolean => crc16Xmodem(new Uint8Array([49,50,51,52,53,54,55,56,57])) === 0x31c3);
  report.run('帧编解码', (): boolean => {
    const encoded = encodeFrame({messageNumber:0x1234, flags:0, address:null, slices:new Uint8Array(),
      businessID:0x2a, payload:new Uint8Array([1,2,254]), response:false});
    const expected = decodeHex('aa5500071234002a0102fe7ed3');
    if (encoded.length !== expected.length) return false;
    for (let i = 0; i < encoded.length; i++) if (encoded[i] !== expected[i]) return false;
    return decodeFrame(encoded).messageNumber === 0x1234;
  });
  report.run('认证 TLV', (): boolean => {
    const payload = authRequest(new Uint8Array([1,2,3,4]), new Uint8Array(32));
    return payload.length === 45 && authFields(payload, 0x18).length === 2;
  });
  report.run('原生 SHA-256 与认证计算', (): boolean => {
    const auth = new AndroidAuthCalculations(new HarmonySha256());
    const proof = auth.guestProof(new Uint8Array([1,2,3,4]), decodeHex('001122334455'), decodeHex('aabbccddeeff'));
    return proofMatches(proof, decodeHex('481bb79704a8523c1e86ae93cfb2bd7204b76984d2d2c3684799d70b58839c84'));
  });
  report.run('初始化前禁止业务', (): boolean => {
    const gate = new PairingGate(), proof = new Uint8Array(32);
    const id = gate.begin('spp', 'guest', 0, 100);
    if (!gate.versionAccepted(id, 'spp', 1) || !gate.peerProofChecked(id, 'spp', 2, proof, proof)) return false;
    return gate.stage() === 'system-link' && !gate.canSendBusiness();
  });
  return report;
}
