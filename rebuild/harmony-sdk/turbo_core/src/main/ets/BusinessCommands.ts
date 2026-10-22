// Original V1 wire contracts ported to native Harmony. No vendor binaries.
// Each returned JSON document is an explicit command, never model-generated wire.
function finite(n: number, min: number, max: number): void {
  if (!Number.isInteger(n) || n < min || n > max) throw new Error('invalid-value');
}
function quoted(text: string, max: number): string {
  if (!text.trim() || text.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text)) throw new Error('invalid-text');
  return JSON.stringify(text);
}
export function businessEnvelope(type: number, json: Uint8Array, sequence: number = 0): Uint8Array {
  finite(type, 1, 65535); finite(sequence, 0, 2147483647);
  if (json.length < 2 || json.length > 7500) throw new Error('business-size');
  const out: number[] = [8, 1, 16];
  const variable = (value: number): void => { do { const b = value % 128; value = Math.floor(value / 128); out.push(b | (value ? 128 : 0)); } while (value); };
  variable(type); out.push(26); variable(json.length);
  for (const byte of json) out.push(byte);
  if (sequence) { out.push(40); variable(sequence); }
  return new Uint8Array(out);
}
export function launcherCommand(command: string, value: number, mode: number = 0, data: string = ''): string {
  if (!['request_general_status', 'request_general_settings', 'brightness_change', 'auto_lock_time', 'set_ai_voice_wakeup', 'sync_time'].includes(command)) throw new Error('command-not-supported');
  finite(value, 0, 2147483647); finite(mode, 0, 1);
  return `{"cmd":${JSON.stringify(command)},"payload":{"value":${value},"mode":${mode},"data":${JSON.stringify(data)}}}`;
}
// 写入格式探测专用：候选命令名全部来自官方 APP Dart 字符串证据（device interaction /
// display adjust / privacy / focus 各族），逐真机读回验证后才可转入正式白名单。
export function probeLauncherCommand(command: string, value: number, data: string = ''): string {
  if (!['mic_switch', 'led_light', 'led_auto_light', 'focus_mode', 'headup_switch', 'headup_degree',
    'crown_config', 'crown_switch', 'head_gestures', 'display_config', 'auto_sleep', 'dnd_mode',
    'glasses_dnd_switch', 'whisper_mode', 'set_display_option', 'wakeup_config', 'privacy_config',
    'display_height', 'display_distance', 'mic_status', 'set_mic_switch'].includes(command)) throw new Error('command-not-supported');
  finite(value, 0, 2147483647);
  if (data.length > 200 || /[\u0000-\u001f]/.test(data)) throw new Error('invalid-text');
  return `{"cmd":${JSON.stringify(command)},"payload":{"value":${value},"mode":0,"data":${JSON.stringify(data)}}}`;
}
// 全天智记开关（iOS 1.0.2 实测线协议；business 15 / envelope type 20）
export function lifeLogCommand(command: string, enabled: boolean): string {
  if (!['life_log_guide', 'life_log_switch'].includes(command)) throw new Error('command-not-supported');
  const data = command === 'life_log_switch' && enabled ? '{"delay":2}' : '';
  return `{"cmd":${JSON.stringify(command)},"payload":{"value":${enabled ? 1 : 0},"mode":0,"data":${JSON.stringify(data)}}}`;
}
export function currentWeather(city: string, temp: number, icon: number, timestamp: number): string {
  quoted(city, 40); finite(temp, -80, 60); finite(icon, 0, 999); finite(timestamp, 1, 2147483647);
  const data = `{"location":${JSON.stringify(city)},"temp":${temp},"icon":${icon}}`;
  return `{"cmd":"current_weather_update","payload":{"value":0,"mode":0,"data":${JSON.stringify(data)},"ts":"${timestamp}"}}`;
}
export function dashboardQuery(): string { return '{"cmd":"dashboard_config","payload":{"version":1,"value":0}}'; }
export const HARMONY_WIDGET_ID: string = 'turbo_ui_hm';
// Short, single Text widget intentionally fits the current MTU512 frame.
// Full A2UI layout needs independently validated large-message transport.
export function installTextWidget(text: string): string {
  const id = HARMONY_WIDGET_ID;
  const component = `{"id":"root","component":"Text","text":${quoted(text, 20)},"variant":"body"}`;
  const extra = `{"widgetId":"${id}","name":"IO","uiContent":{"createSurface":{"surfaceId":"${id}","catalogId":"https://rayneo.com/a2ui/catalogs/glasses-base/v1/catalog.json"},"updateComponents":{"surfaceId":"${id}","components":[${component}]}}}`;
  return `{"cmd":"widget_install","payload":{"data":{"type":"a2ui","id":"${id}","name":"IO","extras":${JSON.stringify(extra)}}}}`;
}
export function removeTextWidget(): string { return `{"cmd":"widget_uninstall","payload":{"data":{"id":"${HARMONY_WIDGET_ID}"}}}`; }
function session(sid: string): string { if (!/^[a-f0-9]{32}$/.test(sid)) throw new Error('invalid-session'); return JSON.stringify(sid); }
export function displayStart(sid: string, preview: boolean = true): string {
  if (typeof preview !== 'boolean') throw new Error('invalid-display-preview');
  // Type 7 syncs display settings. In the pinned reference firmware,
  // is_display=true also launches the settings preview UI; it is not a wake lock.
  return `{"sid":${session(sid)},"force":false,"scope":"temporary","config":{"font_size":2,"content_width":100,"max_lines":5,"position":"center","is_display":${preview},"straight_view":"original"}}`;
}
export function displayText(sid: string, text: string, profile: string = 'source-partial'): string {
  const source = quoted(text, 96);
  if (profile === 'source-partial') return `{"sid":${session(sid)},"mode":3,"status":0,"content":{"source_transcript":${source}}}`;
  if (!['source-final','classic-final','dual-final','subtitle-preview','subtitle-no-preview'].includes(profile)) throw new Error('invalid-display-profile');
  // Official TranslateManager includes these four content fields; mode 3 is
  // title and mode 1 classic. These bounded profiles are protocol probes,
  // not a claim that any particular firmware renders them correctly.
  const mode = profile === 'classic-final' ? 1 : 3;
  const target = profile === 'dual-final' ? source : '""';
  // label=1 is the wearer's speaker animation in classic mode; it does not
  // mean "source text only". Subtitle probes use label=0 and no fake translation.
  const label = profile === 'dual-final' || profile.startsWith('subtitle-') ? 0 : 1;
  return `{"sid":${session(sid)},"mode":${mode},"status":1,"content":{"source_transcript":${source},"target_translation":${target},"label":${label},"keyword_info":""}}`;
}
export function displayStop(sid: string): string { return `{"sid":${session(sid)},"reason_code":10,"text":""}`; }

// ===== 官方精确写入格式（blutter Dart AOT 反编译证据，2026-09-30，见 reverse/blutter-out）=====
// 设置写入走 business 15 / 信封 type 5（singleSettingChangeToGlass），focus_mode 例外（type 2 缺省）。
// 复合子对象先 jsonEncode 成字符串再放入 payload.data；布尔一律 int 0/1。
function clampInt(v: number, min: number, max: number): number {
  if (!Number.isInteger(v)) throw new Error('invalid-value');
  return Math.min(max, Math.max(min, v));
}
function b01(v: boolean): number { return v ? 1 : 0; }
// 眼镜自身序列化形状（t6 回显实测）：未用字段是 mode:0 / data:""，不是 null。
function writeJson(command: string, value: number, mode: number, data: string): string {
  return `{"cmd":${JSON.stringify(command)},"payload":{"value":${value},"mode":${mode},"data":${JSON.stringify(data)}}}`;
}
export function syncTimeCommand(utcSeconds: number, offsetSeconds: number, timezone: string): string {
  finite(utcSeconds, 0, 2147483647); finite(offsetSeconds, -43200, 50400); quoted(timezone, 40);
  // Official AOT syncTime (0x24e5878): UTC seconds use toString in the
  // data Map; offset stays an integer in seconds. Do not shift the UTC epoch.
  return writeJson('sync_time', 0, 0, `{"utc":${JSON.stringify(utcSeconds.toString())},"offset":${offsetSeconds},"timezone":${JSON.stringify(timezone)}}`);
}
// 时间格式探测专用：允许毫秒级大整数（正式路径 syncTimeCommand 仍走秒级校验）。
export function syncTimeProbeCommand(utcValue: number, offsetSeconds: number, timezone: string): string {
  if (!Number.isInteger(utcValue) || utcValue < 0 || utcValue > 9007199254740991) throw new Error('invalid-value');
  if (!Number.isInteger(offsetSeconds) || offsetSeconds < -43200 || offsetSeconds > 50400) throw new Error('invalid-value');
  quoted(timezone, 40);
  return writeJson('sync_time', 0, 0, `{"utc":${utcValue},"offset":${offsetSeconds},"timezone":${JSON.stringify(timezone)}}`);
}
export function privacyConfigCommand(micOn: boolean, ledLevel: number, ledAuto: boolean, logOn: boolean): string {
  finite(ledLevel, 0, 6); // Zero may be an existing value; do not silently replace it.
  return writeJson('privacy_config', 0, 0, `{"mic_switch":${b01(micOn)},"led_light":${ledLevel},"led_auto_light":${b01(ledAuto)},"log_switch":${b01(logOn)}}`);
}
export function wakeupConfigCommand(headupOn: boolean, headupDegree: number, crownSwitch: number): string {
  finite(headupDegree, 0, 70); finite(crownSwitch, 0, 255);
  // The caller permits new 0/3 choices, or preserves the exact current legacy value.
  return writeJson('wakeup_config', 0, 0, `{"headup_switch":${b01(headupOn)},"headup_degree":${headupDegree},"crown_switch":${crownSwitch}}`);
}
export function crownConfigCommand(direction: number, doubleAction: number, longPressAction: number): string {
  finite(direction, 0, 1); finite(doubleAction, 0, 9); finite(longPressAction, 0, 9);
  return writeJson('crown_config', direction, 0, `{"double":${doubleAction},"longPress":${longPressAction}}`);
}
export function displayConfigCommand(height: number, distance: number): string {
  finite(height, 1, 6); finite(distance, 1, 3);
  return writeJson('display_config', 0, 0, `{"height":${height},"distance":${distance}}`);
}
export function headGesturesCommand(enabled: boolean, mode: number): string {
  finite(mode, 0, 1);
  return writeJson('head_gestures', b01(enabled), mode, '');
}
export function autoLockTimeCommand(seconds: number): string {
  if (![5, 10, 15, 25, 40, 60, 120].includes(seconds)) throw new Error('invalid-value');
  // 真机已验证被接受的形状：mode:0 + data:""（旧版此形状拿到 t6 回显）。
  return writeJson('auto_lock_time', seconds, 0, '');
}
export function focusModeCommand(enabled: boolean, enableGlassClose: boolean, auto: boolean, begin: string, end: string, weekday: number[], source: number = 2): string {
  if (!/^\d{2}:\d{2}$/.test(begin) || !/^\d{2}:\d{2}$/.test(end)) throw new Error('invalid-text');
  if (!Array.isArray(weekday) || weekday.length > 7 || weekday.some((d: number): boolean => !Number.isInteger(d) || d < 0 || d > 6)) throw new Error('invalid-value');
  if (![1, 2].includes(source)) throw new Error('invalid-value');
  // Immediate enable/disable uses 1; changing the retained policy uses 2.
  const data = `{"type":${source},"auto":${b01(auto)},"begin":${JSON.stringify(begin)},"end":${JSON.stringify(end)},"weekday":${JSON.stringify(weekday)}}`;
  return writeJson('focus_mode', b01(enabled), b01(enableGlassClose), data);
}
