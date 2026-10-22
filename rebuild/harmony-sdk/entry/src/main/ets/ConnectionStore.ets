import { common } from '@kit.AbilityKit';
import { preferences } from '@kit.ArkData';

// Private app preferences. Never export device addresses/peer IDs to diagnostics.
export class SavedGlasses {
  id: string = '';
  peer: string = '';
  name: string = 'RayNeo iO';
  autoConnect: boolean = true;
  backgroundEnabled:boolean=false;
}
export class ConnectionStore {
  private writes: Promise<void> = Promise.resolve();
  async load(context: common.Context): Promise<SavedGlasses> {
    const prefs = await preferences.getPreferences(context, { name: 'turboio_connection_v1' });
    const raw = await prefs.get('verified_glasses', '');
    if (raw === '') return new SavedGlasses();
    if (typeof raw !== 'string') throw new Error('saved-device-invalid');
    const value = JSON.parse(raw) as SavedGlasses;
    if (typeof value.id !== 'string' || !value.id || value.id.length > 128 ||
      typeof value.peer !== 'string' || !/^[0-9a-f]{12}$/.test(value.peer) ||
      typeof value.name !== 'string' || value.name.length > 64 || typeof value.autoConnect !== 'boolean') {
      throw new Error('saved-device-invalid');
    }
    if(value.backgroundEnabled!==undefined&&typeof value.backgroundEnabled!=='boolean')throw new Error('saved-background-invalid');
    value.backgroundEnabled=value.backgroundEnabled===true;return value;
  }
  save(context: common.Context, value: SavedGlasses): Promise<void> {
    if (!value.id || value.id.length > 128 || !/^[0-9a-f]{12}$/.test(value.peer)) return Promise.reject(new Error('unverified-device'));
    const snapshot = JSON.stringify(value);
    const task = this.writes.catch((): void => {}).then(async (): Promise<void> => {
      const prefs = await preferences.getPreferences(context, { name: 'turboio_connection_v1' });
      await prefs.put('verified_glasses', snapshot); await prefs.flush();
    });
    this.writes = task; return task;
  }
}
