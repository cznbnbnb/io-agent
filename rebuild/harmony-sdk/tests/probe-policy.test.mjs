import assert from 'node:assert/strict';
import test from 'node:test';
import { AttemptGate, inspectAdvertisement, candidateName, validBattery, decodeDeviceName, displayDeviceName } from '../turbo_core/src/main/ets/ProbePolicy.ts';

test('names decode bounded UTF8, strip controls, and reject malformed input', () => {
  const enc = new TextEncoder();
  assert.equal(decodeDeviceName(enc.encode('雷鸟 iO 🕶')), '雷鸟 iO 🕶');
  assert.equal(displayDeviceName(' RayNeo\u0000\u202etest '), 'RayNeotest');
  for (const value of [[0xc0,0x80], [0xed,0xa0,0x80], [0xf4,0x90,0x80,0x80], [0xc2], [0xff], [0xe2,0x41,0x80]]) {
    assert.equal(decodeDeviceName(Uint8Array.from(value)), '');
  }
  assert.equal(decodeDeviceName(new Uint8Array(249)), '');
});
test('advertising complete name supersedes shortened name without guessing identities', () => {
  const enc = new TextEncoder();
  const short = enc.encode('Ray'), complete = enc.encode('RayNeo iO');
  const bytes = Uint8Array.from([short.length+1,8,...short,complete.length+1,9,...complete]);
  assert.equal(inspectAdvertisement(bytes).localName, 'RayNeo iO');
  assert.equal(inspectAdvertisement(Uint8Array.of(3,9,0xff,0xfe)).localName, '');
});

test('gate: initial and cancelled callbacks are rejected', () => {
  const gate = new AttemptGate();
  assert.equal(gate.accepts(0), false);
  const first = gate.begin();
  assert.equal(gate.accepts(first), true);
  gate.cancel();
  assert.equal(gate.accepts(first), false);
});
test('gate: older connection cannot update a newer attempt', () => {
  const gate = new AttemptGate();
  const old = gate.begin();
  const next = gate.begin();
  assert.equal(gate.accepts(old), false);
  assert.equal(gate.accepts(next), true);
});
for (const type of [2, 3, 0x16]) {
  test(`advertisement: matches B81D in type ${type}`, () => {
    const info = inspectAdvertisement(Uint8Array.from([3, type, 0x1d, 0xb8]));
    assert.equal(info.hasRayNeoService, true);
    assert.equal(info.malformed, false);
  });
}
test('advertisement: unrelated manufacturer bytes are not a service match', () => {
  assert.equal(inspectAdvertisement(Uint8Array.from([3, 0xff, 0x1d, 0xb8])).hasRayNeoService, false);
});
test('advertisement: truncated element is rejected without overread', () => {
  const info = inspectAdvertisement(Uint8Array.from([4, 3, 0x1d, 0xb8]));
  assert.equal(info.malformed, true);
  assert.equal(info.hasRayNeoService, false);
});
test('advertisement: odd service list is marked malformed', () => {
  assert.equal(inspectAdvertisement(Uint8Array.from([2, 3, 0x1d])).malformed, true);
});
test('advertisement: stops at zero and does not scan padding', () => {
  assert.equal(inspectAdvertisement(Uint8Array.from([0, 3, 3, 0x1d, 0xb8])).hasRayNeoService, false);
});
test('advertisement: skips valid unrelated elements', () => {
  assert.equal(inspectAdvertisement(Uint8Array.from([2, 1, 6, 3, 3, 0x1d, 0xb8])).hasRayNeoService, true);
});
test('advertisement: empty packet is safe', () => {
  const info = inspectAdvertisement(new Uint8Array());
  assert.equal(info.hasRayNeoService, false);
  assert.equal(info.malformed, false);
});
test('candidate names are case insensitive and never match unrelated names', () => {
  assert.equal(candidateName('RAYNEO iO'), true);
  assert.equal(candidateName('雷鸟'), true);
  assert.equal(candidateName(''), false);
  assert.equal(candidateName('headphones'), false);
});
test('standard battery validates complete value, range and length', () => {
  for (const value of [0, 1, 54, 100]) { assert.equal(validBattery(Uint8Array.of(value)), value); }
  for (const value of [101, 255]) { assert.equal(validBattery(Uint8Array.of(value)), -1); }
  assert.equal(validBattery(new Uint8Array()), -1);
  assert.equal(validBattery(Uint8Array.of(55, 0)), -1);
});
test('all one-byte and truncated AD inputs stay bounded', () => {
  for (let i = 0; i <= 255; i++) {
    assert.doesNotThrow(() => inspectAdvertisement(Uint8Array.of(i)));
    assert.doesNotThrow(() => inspectAdvertisement(Uint8Array.of(i, 3, 0x1d)));
  }
});
