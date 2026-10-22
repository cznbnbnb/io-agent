import { common } from '@kit.AbilityKit';
import { preferences } from '@kit.ArkData';
import { cryptoFramework } from '@kit.CryptoArchitectureKit';
import { decodeHex } from './AuthCalculations';

// App-generated protocol identifier, not a hardware MAC or authentication key.
// Persist before sending; invalid saved data is an error, never silently replaced.
export class LocalProtocolIdentity {
  private pending: Promise<Uint8Array> | undefined = undefined;
  async get(context: common.Context): Promise<Uint8Array> {
    if (this.pending === undefined) this.pending = this.load(context);
    const pending = this.pending;
    try { return (await pending).slice(); }
    catch (_) { if (this.pending === pending) this.pending = undefined; throw new Error('local-identity-unavailable'); }
  }
  private async load(context: common.Context): Promise<Uint8Array> {
    const prefs = await preferences.getPreferences(context, {name:'turboio_protocol_identity_v1'});
    const saved = await prefs.get('phone_identifier', '');
    if (typeof saved !== 'string') throw new Error('identity-invalid');
    if (saved !== '') {
      if (!/^[0-9a-f]{12}$/.test(saved)) throw new Error('identity-invalid');
      await prefs.flush();
      return decodeHex(saved);
    }
    const bytes = cryptoFramework.createRandom().generateRandomSync(6).data;
    if (bytes.length !== 6) throw new Error('identity-random-length');
    try {
      let hex = ''; for (const byte of bytes) hex += byte.toString(16).padStart(2, '0');
      await prefs.put('phone_identifier', hex); await prefs.flush();
      return bytes.slice();
    } finally { bytes.fill(0); }
  }
}
