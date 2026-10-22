import { cryptoFramework } from '@kit.CryptoArchitectureKit';
import { systemDateTime } from '@kit.BasicServicesKit';

export class HarmonyHandshakeRuntime {
  now(): number {
    const now = systemDateTime.getUptime(systemDateTime.TimeType.STARTUP, false);
    if (!Number.isSafeInteger(now) || now < 0) throw new Error('invalid-monotonic-clock');
    return now;
  }
  random(length: number): Uint8Array {
    if (length !== 4 && length !== 2) throw new Error('handshake-random-length');
    try {
      const bytes = cryptoFramework.createRandom().generateRandomSync(length).data;
      if (bytes.length !== length) throw new Error('random-provider-length');
      return bytes;
    } catch (_) { throw new Error('random-provider-failed'); }
  }
}
