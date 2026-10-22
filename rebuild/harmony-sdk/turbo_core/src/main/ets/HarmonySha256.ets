import { cryptoFramework } from '@kit.CryptoArchitectureKit';
import { Sha256Provider } from './AuthCalculations';

// Fresh digest per call; no shared incremental state across pairing attempts.
export class HarmonySha256 implements Sha256Provider {
  digest(bytes: Uint8Array): Uint8Array {
    try {
      const md = cryptoFramework.createMd('SHA256');
      md.updateSync({data: bytes});
      return md.digestSync().data;
    } catch (_) {
      // No platform exception text or input is logged; callers fail the attempt.
      throw new Error('sha256-failed');
    }
  }
}
