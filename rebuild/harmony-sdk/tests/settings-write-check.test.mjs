import test from 'node:test';
import assert from 'node:assert/strict';
import { loadApp } from './load-app.mjs';
import { loadCore } from './load-core.mjs';

const commands = loadCore('./BusinessCommands');
const { SettingsWriteCheck } = loadApp('SettingsWriteCheck');
const cases = [
  [commands.launcherCommand('brightness_change', 8), { generalStatus: { battery: 90, brightness: 8 } }],
  [commands.autoLockTimeCommand(25), { generalSettings: { autoLockTime: 25 } }],
  [commands.wakeupConfigCommand(true, 30, 1), { generalSettings: { wakeupConfig: { headupSwitch: 1, headupDegree: 30, crownSwitch: 1 } } }],
  [commands.privacyConfigCommand(true, 1, false, true), { generalSettings: { privacyConfig: { mic_switch: 1, led_light: 1, led_auto_light: 0, log_switch: 1 } } }],
  [commands.crownConfigCommand(1, 2, 3), { generalSettings: { crownConfig: { direction: 1, double: 2, longPress: 3 } } }],
  [commands.displayConfigCommand(1, 2), { generalSettings: { displayConfig: { height: 1, distance: 2 } } }],
  [commands.headGesturesCommand(true, 1), { generalSettings: { headGestures: { enabled: 1, mode: 1 } } }],
  [commands.focusModeCommand(true, false, false, '09:00', '18:00', [0, 1]), { generalStatus: { focusMode: { enable: 1, enableGlassClose: 0, policy: { auto: 0, begin: '09:00', end: '18:00', weekday: [0, 1] } } } }]
];
for (const [command, actual] of cases) {
  test(`${JSON.parse(command).cmd}: compares addressed fields and rejects missing evidence`, () => {
    const check = new SettingsWriteCheck(command);
    assert.equal(check.compare(actual), 1);
    assert.equal(check.hasBaseline(JSON.stringify(actual)), true);
    assert.equal(check.hasBaseline('{}'), false);
    assert.equal(check.compare({}), 0);
    assert.equal(check.compare({ generalStatus: { battery: 91 }, generalSettings: { language: 'en-US' } }), 0);
  });
}
test('a changed battery or another setting cannot confirm brightness', () => {
  const check = new SettingsWriteCheck(commands.launcherCommand('brightness_change', 8));
  assert.equal(check.compare({ generalStatus: { brightness: 7, battery: 99 } }), 2);
});
test('compound settings require every addressed value to match', () => {
  const check = new SettingsWriteCheck(commands.wakeupConfigCommand(true, 30, 1));
  assert.equal(check.compare({ generalSettings: { wakeupConfig: { headupSwitch: 1, headupDegree: 20, crownSwitch: 1 } } }), 2);
  assert.equal(check.compare({ generalSettings: { wakeupConfig: { headupDegree: 30 } } }), 0);
});
