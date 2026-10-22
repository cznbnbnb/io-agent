import test from 'node:test';
import assert from 'node:assert/strict';
import { loadApp } from './load-app.mjs';
import { loadCore } from './load-core.mjs';

const { businessEnvelope } = loadCore('./BusinessCommands');
const { readLauncherEnvelope } = loadCore('./LauncherStatus');
const flush = async () => { for (let i = 0; i < 100; i++) await Promise.resolve(); };

function setup(initial = '', initialConnection = 1, loadError = false) {
  let connection = initialConnection, peer = 'synthetic-peer', sendHook, cleanupRaw = initial, failSave = false;
  const sent = [], timers = new Map();
  let timerId = 0;
  class Config {}
  class Model { cancel() {} }
  class ASR { close() {} start() {} append() {} }
  const { VoiceSession } = loadApp('VoiceSession', {
    'libturbo_audio.so': { reset() {}, close() {}, decode() { return new ArrayBuffer(640); } },
    '@kit.CryptoArchitectureKit': {
      cryptoFramework: { createRandom: () => ({ generateRandomSync: n => ({ data: new Uint8Array(n).fill(4) }) }) }
    },
    './CloudASR': { CloudASR: ASR },
    './RemoteServices': { ServiceConfig: Config, RemoteServices: Model }
  }, {
    setTimeout: (fn, ms) => { timers.set(++timerId, { fn, ms }); return timerId; },
    clearTimeout: id => timers.delete(id)
  });
  const voice = new VoiceSession(async (business, payload) => {
    const packet = readLauncherEnvelope(payload);
    const row = { business, type: packet.type, json: JSON.parse(new TextDecoder().decode(packet.json)), connection };
    sent.push(row);
    if (sendHook) await sendHook(row);
  }, () => peer, () => connection);
  voice.initializeCleanup({
    load: () => { if (loadError) throw Error('synthetic-load-failure'); return cleanupRaw; },
    save: raw => { if (failSave) throw Error('synthetic-save-failure'); cleanupRaw = raw; }
  });
  voice.connected(true);
  const config = { asrKey: 'synthetic', asrHost: 'test.aliyuncs.com', asrModel: 'model', modelKey: 'synthetic' };
  const receive = (type, peer = 'synthetic-peer') => voice.receive(13, businessEnvelope(type, new TextEncoder().encode('{}')), peer);
  return {
    voice, config, sent, receive, timers,
    saved: () => cleanupRaw,
    failSave: value => { failSave = value; },
    onSend: hook => { sendHook = hook; },
    reconnect(nextPeer = peer) { voice.connected(false); peer = nextPeer; connection++; voice.connected(true); }
  };
}

test('a disabled voice exit cannot submit its second command after the first native write completes on an old connection', async () => {
  const s = setup();
  s.voice.enable(s.config); s.receive(1); await flush();
  let release;
  s.onSend(row => row.type === 2 ? new Promise(resolve => { release = resolve; }) : undefined);
  s.voice.disable(); await flush();
  assert.equal(typeof release, 'function', 'the first exit command must be in flight');
  assert.equal(s.voice.pendingWrites, true);
  s.reconnect(); release(); await flush();
  assert.equal(s.sent.filter(row => row.type === 7).length, 0, 'old exit continuation must not write type7 on the new connection');
});

test('native exit success without a device exit event retains ownership and cannot resume day capture', async () => {
  const s = setup();
  let resumedAfterVoice = 0;
  s.voice.onRoundEnded = () => { resumedAfterVoice++; };
  s.voice.enable(s.config); s.receive(1); await flush();
  s.voice.disable(); await flush();
  assert.equal(s.sent.at(-1).type, 7, 'both native exit writes have completed');
  assert.equal(s.voice.pendingWrites, false, 'transport completion is separate from device exit evidence');
  assert.equal(resumedAfterVoice, 0, 'AppRuntime must not resume lifelog before an actual exit confirmation');
  assert.equal(s.voice.active, true, 'unconfirmed device capture/display must still occupy shared entry points');
  assert.equal(s.voice.state.phase, 'cleanup');
  s.receive(8); await flush();
  assert.equal(s.voice.active, false, 'the matching device exit remains accepted after disable');
  assert.equal(resumedAfterVoice, 1);
});

test('cold restart restores cleanup without replay and only an explicitly armed cleanup accepts the current device exit', { timeout: 5000 }, async () => {
  const s = setup();
  s.voice.enable(s.config); s.receive(1); await flush();
  const restored = setup(s.saved(), 2);
  assert.equal(restored.voice.active, true);
  assert.equal(restored.voice.state.phase, 'cleanup');
  assert.equal(restored.sent.length, 0, 'loading an unfinished owner cannot reopen its microphone or replay exit commands');
  restored.receive(8); await flush();
  assert.equal(restored.voice.active, true, 'an unbound type8 after restart is not proof that the stored owner exited');
  const waiting = restored.voice.stopAndWait(); await flush();
  assert.equal(restored.sent.at(-1).type, 7);
  restored.receive(8, 'other-peer'); await flush();
  assert.equal(restored.voice.active, true);
  restored.receive(8); await flush();
  assert.equal(await waiting, true);
  assert.equal(restored.voice.active, false);
});

test('reconnection does not accept a bare old exit and physical confirmation must name the original cleanup owner', async () => {
  const s = setup();
  s.voice.enable(s.config); s.receive(1); await flush();
  const sid = s.voice.cleanupSessionId;
  s.reconnect();
  const writes = s.sent.length;
  s.receive(8); await flush();
  assert.equal(s.voice.active, true);
  assert.equal(s.sent.length, writes, 'reconnection cannot replay capture or exit');
  assert.throws(() => s.voice.confirmExited('wrong-session'));
  assert.equal(s.voice.canConfirmExited, true);
  s.voice.confirmExited(sid);
  assert.equal(s.voice.active, false);
  assert.equal(s.sent.length, writes, 'physical confirmation is recorded without a synthetic device command');
});

test('owner persistence failure before capture and corrupt or unreadable records fail closed without sending commands', async () => {
  const s = setup();
  s.voice.enable(s.config); s.failSave(true); s.receive(1); await flush();
  assert.equal(s.sent.length, 0, 'a failed owner write cannot be followed by a microphone command');
  assert.equal(s.voice.active, true); assert.equal(s.voice.cleanupRequired, true);
  assert.equal(s.voice.canConfirmExited, false); assert.equal(await s.voice.stopAndWait(), false);
  assert.equal(s.saved(), '');
  const malformed = ['{broken', 'null', '{}', JSON.stringify({ schema: 1, peer: 'synthetic-peer', sid: 'wrong', evidence: 'none' }), JSON.stringify({ schema: 1, peer: '', sid: '', evidence: 'none' })];
  for (const raw of malformed) {
    const restored = setup(raw);
    assert.equal(restored.voice.active, true);
    assert.throws(() => restored.voice.enable(restored.config));
    assert.equal(await restored.voice.stopAndWait(), false);
    assert.equal(restored.voice.canConfirmExited, false);
    assert.equal(restored.sent.length, 0); assert.equal(restored.saved(), raw);
  }
  const unreadable = setup('', 1, true);
  assert.equal(unreadable.voice.active, true);
  assert.throws(() => unreadable.voice.enable(unreadable.config));
  assert.equal(await unreadable.voice.stopAndWait(), false); assert.equal(unreadable.sent.length, 0);
});

test('failed terminal persistence retains the original cleanup owner even after a matching device exit', async () => {
  const s = setup(); let resumed = 0; s.voice.onRoundEnded = () => { resumed++; };
  s.voice.enable(s.config); s.receive(1); await flush();
  const saved = s.saved(), sid = s.voice.cleanupSessionId;
  s.voice.disable(); await flush(); s.failSave(true); s.receive(8); await flush();
  assert.equal(s.voice.active, true); assert.equal(s.voice.cleanupRequired, true);
  assert.equal(s.voice.cleanupSessionId, sid); assert.equal(s.saved(), saved);
  assert.equal(s.voice.canConfirmExited, false); assert.equal(resumed, 0);
});

test('physical confirmation rejects another peer and does not send cleanup to that connection', async () => {
  const s = setup(); s.voice.enable(s.config); s.receive(1); await flush();
  const sid = s.voice.cleanupSessionId, count = s.sent.length;
  s.reconnect('other-peer');
  assert.equal(s.voice.canConfirmExited, false); assert.throws(() => s.voice.confirmExited(sid));
  s.receive(8, 'other-peer'); await flush();
  assert.equal(s.voice.active, true); assert.equal(await s.voice.stopAndWait(), false);
  assert.equal(s.sent.length, count);
  s.reconnect('synthetic-peer'); assert.equal(s.voice.canConfirmExited, true);
  s.voice.confirmExited(sid); assert.equal(s.voice.active, false);
});

test('in-flight native exit rejects physical confirmation and defers recovery even when the device exit arrives first', async () => {
  const s = setup(); let release, resumed = 0;
  s.voice.onRoundEnded = () => { resumed++; };
  s.voice.enable(s.config); s.receive(1); await flush();
  const sid = s.voice.cleanupSessionId;
  s.onSend(row => row.type === 7 ? new Promise(resolve => { release = resolve; }) : undefined);
  s.voice.disable(); await flush();
  assert.equal(typeof release, 'function'); assert.equal(s.voice.pendingWrites, true);
  assert.equal(s.voice.canConfirmExited, false); assert.throws(() => s.voice.confirmExited(sid));
  s.receive(8); await flush();
  assert.equal(s.voice.active, true); assert.equal(resumed, 0, 'a valid device event cannot release a still-pending native write');
  release(); await flush();
  assert.equal(s.voice.pendingWrites, false); assert.equal(s.voice.active, false); assert.equal(resumed, 1);
});

test('a device exit before native completion keeps an independent bounded stop wait without releasing ownership', async () => {
  const s = setup(); let release, resumed = 0, result;
  s.voice.onRoundEnded = () => { resumed++; };
  s.voice.enable(s.config); s.receive(1); await flush();
  const ownerRecord = s.saved();
  s.onSend(row => row.type === 7 ? new Promise(resolve => { release = resolve; }) : undefined);
  const waiting = s.voice.stopAndWait().then(value => { result = value; });
  await flush(); assert.equal(typeof release, 'function');
  try {
    s.receive(8); await flush();
    assert.equal(s.voice.pendingWrites, true); assert.equal(s.voice.active, true);
    assert.equal(s.saved(), ownerRecord, 'device exit evidence cannot clear the durable owner while a native write remains unsettled');
    assert.equal(result, undefined); assert.equal(resumed, 0);
    const deadlines = [...s.timers.entries()].filter(([, timer]) => timer.ms === 10000);
    assert.equal(deadlines.length, 1, 'the stop waiter needs its own ten-second deadline after a device exit clears audio/EOF timers');
    const [id, deadline] = deadlines[0]; s.timers.delete(id); deadline.fn(); await flush();
    assert.equal(result, false, 'an unsettled native write must not leave stopAndWait pending forever');
    assert.equal(s.voice.pendingWrites, true); assert.equal(s.voice.active, true); assert.equal(resumed, 0);
    assert.equal(s.saved(), ownerRecord);
  } finally { release(); await flush(); await waiting; }
  assert.equal(s.voice.pendingWrites, false); assert.equal(s.voice.active, false); assert.equal(resumed, 1);
  assert.equal(JSON.parse(s.saved()).evidence, 'device_event');
});

test('a restart after early device exit restores the unsettled owner and connection loss invalidates its volatile exit evidence', async () => {
  const s = setup(); let release, resumed = 0;
  s.voice.onRoundEnded = () => { resumed++; };
  s.voice.enable(s.config); s.receive(1); await flush();
  const sid = s.voice.cleanupSessionId, ownerRecord = s.saved();
  s.onSend(row => row.type === 7 ? new Promise(resolve => { release = resolve; }) : undefined);
  const waiting = s.voice.stopAndWait(); await flush(); assert.equal(typeof release, 'function');
  try {
    s.receive(8); await flush();
    const restored = setup(s.saved(), 2);
    assert.equal(restored.voice.cleanupSessionId, sid, 'restart must restore the owner whose native exit write has not drained');
    assert.equal(restored.voice.active, true); assert.equal(restored.sent.length, 0);
    restored.receive(8); await flush(); assert.equal(restored.voice.active, true);
    assert.equal(s.saved(), ownerRecord);
    s.reconnect(); assert.equal(await waiting, false);
  } finally { release(); await flush(); await waiting; }
  assert.equal(s.voice.pendingWrites, false); assert.equal(s.voice.active, true);
  assert.equal(s.voice.cleanupSessionId, sid); assert.equal(s.saved(), ownerRecord); assert.equal(resumed, 0);
});
