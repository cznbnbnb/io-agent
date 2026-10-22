import test from 'node:test';
import assert from 'node:assert/strict';
import { loadApp } from './load-app.mjs';
import { loadCore } from './load-core.mjs';

const { businessEnvelope } = loadCore('./BusinessCommands');
const { readLauncherEnvelope } = loadCore('./LauncherStatus');
const peer = 'synthetic-peer';
const did = '09090909-0909-4909-8909-090909090909';
const ownerRecord = JSON.stringify({ schema: 1, peer, did, fileStarted: true, evidence: 'none' });
const flush = async () => { for (let i = 0; i < 100; i++) await Promise.resolve(); };

function setup(initial = ownerRecord) {
  let saved = initial, connected = true, hook, timerId = 0, idleCount = 0;
  const timers = new Map(), sent = [];
  const { TeleprompterSession } = loadApp('TeleprompterSession', {}, {
    setTimeout: (f, ms) => { timers.set(++timerId, { f, ms }); return timerId; },
    clearTimeout: id => timers.delete(id)
  });
  const session = new TeleprompterSession(async (business, payload) => {
    const row = { business, type: business === 20 ? readLauncherEnvelope(payload).type : -1 };
    sent.push(row); if (hook) await hook(row);
  }, () => connected ? peer : '', () => true);
  session.initializeCleanup({ load: () => saved, save: raw => { saved = raw; } });
  session.connected(); session.onIdle = () => { idleCount++; };
  return {
    session, timers, sent, saved: () => saved, idleCount: () => idleCount,
    onSend: value => { hook = value; },
    exit() { session.receive(peer, 20, businessEnvelope(6, new TextEncoder().encode(JSON.stringify({ did, action: 2, code: 1 })))); },
    disconnect() { connected = false; session.disconnected(); },
    reconnect() { connected = true; session.connected(); }
  };
}

for (const pendingBusiness of [17, 20]) {
test(`early teleprompter exit is serialized behind ${pendingBusiness === 17 ? 'native file cancellation' : 'native business command'} and keeps the durable owner until native completion`, async () => {
  const s = setup(); let release, result;
  s.onSend(row => row.business === pendingBusiness ? new Promise(resolve => { release = resolve; }) : undefined);
  const waiting = s.session.stopAndWait().then(value => { result = value; }); await flush();
  assert.equal(typeof release, 'function');
  try {
    s.exit(); await flush();
    assert.equal(s.saved(), ownerRecord); assert.equal(s.session.cleanupSessionId, did);
    assert.equal(s.session.active, true); assert.equal(result, undefined); assert.equal(s.idleCount(), 0);
    const restored = setup(s.saved());
    assert.equal(restored.session.cleanupSessionId, did); assert.equal(restored.session.active, true);
    assert.equal(restored.sent.length, 0, 'restart cannot replay a cleanup or manuscript');
  } finally { release(); await flush(); await waiting; }
  assert.equal(result, true); assert.equal(s.session.active, false); assert.equal(s.idleCount(), 1);
  assert.equal(JSON.parse(s.saved()).evidence, 'device_event');
});
}

test('early teleprompter exit cannot cancel the bounded stop wait while its native command remains unsettled', async () => {
  const s = setup(); let release, result;
  s.onSend(row => row.business === 20 && row.type === 6 ? new Promise(resolve => { release = resolve; }) : undefined);
  const waiting = s.session.stopAndWait().then(value => { result = value; }); await flush();
  try {
    s.exit(); await flush();
    const deadlines = [...s.timers.entries()].filter(([, timer]) => timer.ms === 10000);
    assert.equal(deadlines.length, 1, 'the queued exit must not remove the ten-second stop deadline');
    const [id, deadline] = deadlines[0]; s.timers.delete(id); deadline.f(); await flush();
    assert.equal(result, false); assert.equal(s.session.active, true); assert.equal(s.saved(), ownerRecord);
    assert.equal(s.idleCount(), 0);
  } finally { release(); await flush(); await waiting; }
  assert.equal(s.session.active, true); assert.equal(s.session.cleanupSessionId, did);
  assert.equal(s.saved(), ownerRecord); assert.equal(s.idleCount(), 0, 'a queued reply invalidated by timeout cannot release cleanup later');
});

test('disconnect discards an early queued teleprompter exit and late native completion cannot clear the original owner', async () => {
  const s = setup(); let release;
  s.onSend(row => row.business === 20 && row.type === 6 ? new Promise(resolve => { release = resolve; }) : undefined);
  const waiting = s.session.stopAndWait(); await flush();
  try {
    s.exit(); await flush(); s.disconnect(); s.reconnect();
    assert.equal(await waiting, false); assert.equal(s.session.active, true); assert.equal(s.saved(), ownerRecord);
  } finally { release(); await flush(); await waiting; }
  assert.equal(s.session.cleanupSessionId, did); assert.equal(s.session.active, true);
  assert.equal(s.saved(), ownerRecord); assert.equal(s.idleCount(), 0);
  const writes = s.sent.length; s.session.confirmExited(did);
  assert.equal(s.sent.length, writes); assert.equal(s.session.active, false);
  assert.equal(JSON.parse(s.saved()).evidence, 'user_confirmation');
});
