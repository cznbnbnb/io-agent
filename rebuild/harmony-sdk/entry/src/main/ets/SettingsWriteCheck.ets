// Compare only the fields addressed by a command, never whole status JSON.
// Firmware contract: RayNeo iO / Strix OS 1.0.4.12.
class ExpectedField {
  path: string[];
  value: Object;
  constructor(path: string[], value: Object) { this.path = path; this.value = value; }
}

export class SettingsWriteCheck {
  domain: string = '';
  command: string = '';
  private fields: ExpectedField[] = [];

  constructor(json: string) {
    const root = JSON.parse(json) as Record<string, Object>;
    this.command = root['cmd'] as string;
    const payload = root['payload'] as Record<string, Object>;
    const raw = payload['data'];
    const data = typeof raw === 'string' && raw ? JSON.parse(raw) as Record<string, Object> : new Object() as Record<string, Object>;
    this.domain = ['brightness_change', 'focus_mode'].includes(this.command) ? 'generalStatus' : 'generalSettings';
    switch (this.command) {
      case 'brightness_change': this.add(['brightness'], payload['value']); break;
      case 'auto_lock_time': this.add(['autoLockTime'], payload['value']); break;
      case 'privacy_config':
        for (const key of ['mic_switch', 'led_light', 'led_auto_light', 'log_switch']) this.add(['privacyConfig', key], data[key]);
        break;
      case 'wakeup_config':
        this.add(['wakeupConfig', 'headupSwitch'], data['headup_switch']);
        this.add(['wakeupConfig', 'headupDegree'], data['headup_degree']);
        this.add(['wakeupConfig', 'crownSwitch'], data['crown_switch']);
        break;
      case 'crown_config':
        this.add(['crownConfig', 'direction'], payload['value']);
        for (const key of ['double', 'longPress']) this.add(['crownConfig', key], data[key]);
        break;
      case 'display_config':
        for (const key of ['height', 'distance']) this.add(['displayConfig', key], data[key]);
        break;
      case 'head_gestures':
        this.add(['headGestures', 'enabled'], payload['value']);
        this.add(['headGestures', 'mode'], payload['mode']);
        break;
      case 'focus_mode':
        this.add(['focusMode', 'enable'], payload['value']);
        this.add(['focusMode', 'enableGlassClose'], payload['mode']);
        for (const key of ['auto', 'begin', 'end', 'weekday']) this.add(['focusMode', 'policy', key], data[key]);
        break;
      default: throw new Error('unsupported-setting-command');
    }
  }

  private add(path: string[], value: Object): void {
    if (value === undefined || value === null) throw new Error('missing-setting-value');
    this.fields.push(new ExpectedField(path, value));
  }

  get needsBaseline(): boolean { return this.fields.length > 1; }
  hasBaseline(json: string): boolean {
    try {
      const root = JSON.parse(json) as Record<string, Object>;
      const section = root[this.domain];
      for (const field of this.fields) {
        let value: Object | undefined = section;
        for (const key of field.path) {
          if (!value || typeof value !== 'object') return false;
          value = (value as Record<string, Object>)[key];
        }
        if (value === undefined || value === null || typeof value !== typeof field.value) return false;
        if (Array.isArray(field.value) && !Array.isArray(value)) return false;
      }
      return true;
    } catch (_) { return false; }
  }

  // 0: insufficient evidence, 1: all addressed values match, 2: mismatch.
  compare(root: Record<string, Object>): number {
    const section = root[this.domain];
    if (!section || typeof section !== 'object') return 0;
    let missing = false;
    for (const field of this.fields) {
      let value: Object | undefined = section;
      for (const key of field.path) {
        if (value === undefined || value === null || typeof value !== 'object') { value = undefined; break; }
        value = (value as Record<string, Object>)[key];
      }
      if (value === undefined || value === null) { missing = true; continue; }
      if (JSON.stringify(value) !== JSON.stringify(field.value)) return 2;
    }
    return missing ? 0 : 1;
  }
}
