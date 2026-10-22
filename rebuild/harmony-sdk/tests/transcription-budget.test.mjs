import test from 'node:test'; import assert from 'node:assert/strict'; import { loadApp } from './load-app.mjs';
const { TranscriptionConditions, admitTranscription } = loadApp('TranscriptionBudget');
function good() { return Object.assign(new TranscriptionConditions(), { workerReady: true, foreground: true, freeBytes: 1e9, thermalKnown: true, batteryPercent: 60 }); }
test('candidate admits daytime text without charger, reserves charging for refinement', () => {
  assert.equal(admitTranscription(good()).allowed, true); assert.equal(admitTranscription(good(), true).reason, 'refinement_waiting_charge');
  assert.equal(admitTranscription(Object.assign(good(), { charging: true }), true).allowed, true);
});
test('lock-screen admission requires lease; admission never proves OS execution', () => {
  assert.equal(admitTranscription(Object.assign(good(), { foreground: false })).allowed, false);
  assert.equal(admitTranscription(Object.assign(good(), { foreground: false, bluetoothLease: true })).allowed, true);
});
test('audio, low power, thermal, storage and worker limits protect capture before heavy work', () => {
  for (const change of [{ interactiveAudio: true }, { batteryPercent: 10 }, { batteryPercent: -1 }, { thermalKnown: false }, { thermalLimited: true }, { freeBytes: -1 }, { workerReady: false }, { usedWorkerMs: 20000 }]) assert.equal(admitTranscription(Object.assign(good(), change)).allowed, false);
});
