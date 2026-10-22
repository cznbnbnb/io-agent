import test from 'node:test';
import assert from 'node:assert/strict';
import { loadApp } from './load-app.mjs';
import { loadCore } from './load-core.mjs';
const { businessEnvelope } = loadCore('./BusinessCommands');
const { readLauncherEnvelope } = loadCore('./LauncherStatus');
function setup(platform = {}) {
  const sent = [], timers = new Map(); let peer = 'synthetic-peer', idle = true, reject = false, cb, id = 0, now = 1000;
  class Clock extends Date { static now() { return now; } }
  const { SuggestionTestSession } = loadApp('SuggestionTestSession', {
    '@kit.CryptoArchitectureKit': { cryptoFramework: { createRandom: () => ({ generateRandomSync: n => ({ data: new Uint8Array(n).fill(8) }) }) } }, ...platform
  }, { Date: Clock, setTimeout: (f, ms) => { timers.set(++id, { f, ms }); return id; }, clearTimeout: n => timers.delete(n) });
  const s = new SuggestionTestSession(async (business, bytes) => {
    if (reject) throw Error('synthetic transport failure');
    const p = readLauncherEnvelope(bytes); const j = JSON.parse(new TextDecoder().decode(p.json));
    sent.push({ business, type: p.type, j, length: bytes.length }); if (cb) cb(p.type, j);
  }, () => peer, () => idle);
  const receive = (type, j, from = peer) => s.receive(from, businessEnvelope(type, new TextEncoder().encode(JSON.stringify(j))));
  const op = cmd => ({ suggestUID: s.uid, suggestType: 2, cmd });
  return { s, sent, timers, receive, op, setNow: t => now = t, offline: () => peer = '', occupy: () => idle = false, fail: () => reject = true, onSend: f => cb = f };
}
test('explicit two-minute diagnostic window keeps the same type33 card and never submits a task answer',async()=>{
 const t=setup();await t.s.start('时长观察','请先不操作',120);assert.equal(t.s.remainingMs,120000);assert.equal([...t.timers.values()][0].ms,120000);
 assert.equal(t.sent.length,1);assert.equal(t.sent[0].business,21);assert.equal(t.sent[0].type,33);t.setNow(121000);[...t.timers.values()][0].f();
 await new Promise(setImmediate);assert.equal(t.s.remainingMs,0);assert.equal(t.s.command,0);assert.equal(t.sent.length,2);assert.equal(t.sent[1].j.type,2);
 const g=setup();await assert.rejects(g.s.start('实验','无效时长',300));assert.equal(g.sent.length,0);
});
test('display occupancy is published before transport and survives a page replacing its UI callback',async()=>{
 const t=setup(),observed=[];t.s.onOccupancyChanged=()=>observed.push(t.s.active);t.s.changed=()=>{throw Error('synthetic unmounted UI');};
 t.onSend(()=>assert.equal(observed.at(-1),true));await t.s.start('实验','无副作用');assert.equal(t.s.active,true);
 t.onSend(()=>{});await t.s.remove();assert.equal(observed.at(-1),false);
});
test('isolated type33 card, bounded text, unique UID, and no settings or todo commands', async () => {
  const t = setup(); await t.s.start('题'.repeat(16), '文'.repeat(48));
  assert.equal(t.sent[0].business, 21); assert.equal(t.sent[0].type, 33); assert.equal(t.sent[0].j.type, 1);
  assert(t.sent[0].length + 10 < 509); const uid = t.s.uid;
  await assert.rejects(t.s.start('a', 'b')); await t.s.remove(); await t.s.start('a', 'b'); assert.notEqual(t.s.uid, uid);
  t.s.disconnected();
});
test('type4, wrong UID, peer, category, binary and unknown cmd cannot settle suggestion', async () => {
  const t = setup(); await t.s.start('实验', '合成内容');
  t.receive(4, t.op(1)); t.receive(34, { ...t.op(1), suggestUID: 'old' }); t.receive(34, t.op(1), 'other');
  t.receive(34, { ...t.op(1), suggestType: 1 }); t.receive(34, t.op(9));
  t.s.receive('synthetic-peer', Uint8Array.of(255)); assert.equal(t.s.phase, 'waiting'); assert.equal(t.s.command, 0);
  assert.equal(t.sent.length, 1); t.s.disconnected();
});
test('early operation survives transport completion; duplicates/conflicts do not execute or ack', async () => {
  const t = setup(); t.onSend((type, j) => { if (type === 33 && j.type === 1) t.receive(34, t.op(2)); });
  await t.s.start('实验', '合成内容'); assert.equal(t.s.phase, 'observed'); assert.equal(t.s.command, 2);
  t.receive(34, t.op(2)); t.receive(34, t.op(1)); assert.equal(t.s.command, 2); assert.equal(t.sent.length, 1);
  assert(t.s.events.some(e => e.includes('duplicate'))); assert(t.s.events.some(e => e.includes('conflict')));
  await t.s.acknowledge(0); assert.equal(t.sent[1].type, 35); assert.equal(t.sent[1].j.code, 0);
  assert.equal(t.sent.length, 2); assert.equal(t.s.phase, 'acknowledged'); assert.equal(t.timers.size, 1);
  await assert.rejects(t.s.acknowledge(0)); await assert.rejects(t.s.start('a', 'b'));
  t.receive(34, t.op(1)); assert.equal(t.s.command, 2);
  await t.s.remove(); assert.equal(t.sent[2].j.type, 2); assert.equal(t.s.phase, 'idle'); assert.equal(t.timers.size, 0);
});
test('receipt leaves animation observable while original deadline and restart cleanup remain mandatory', async () => {
  const t = setup(); await t.s.start('实验', '观察动画'); t.receive(34, t.op(1)); await t.s.acknowledge(3);
  assert.equal(t.sent.length, 2); assert.equal(t.s.active, true); assert.equal(t.s.phase, 'acknowledged');
  t.setNow(61001); [...t.timers.values()][0].f(); await Promise.resolve(); await Promise.resolve();
  assert.equal(t.sent.at(-1).j.type, 2); assert.equal(t.sent.at(-1).j.suggestUID, t.s.uid);
  const u = setup(); await u.s.start('a', 'b'); u.receive(34, u.op(1)); await u.s.acknowledge(0); u.s.disconnected();
  assert.equal(u.s.phase, 'cleanup_pending'); assert.equal(u.timers.size, 0); await assert.rejects(u.s.start('a', 'b'));
});
test('expired operations rejected and timeout removes only same synthetic card', async () => {
  const t = setup(); await t.s.start('实验', '合成内容'); t.setNow(61001); t.receive(34, t.op(1));
  assert.equal(t.s.command, 0); [...t.timers.values()][0].f(); await Promise.resolve(); await Promise.resolve();
  assert.equal(t.sent.at(-1).j.type, 2); assert.equal(t.sent.at(-1).j.suggestUID, t.s.uid);
});
test('disconnect invalidates old callbacks and retains explicit cleanup obligation', async () => {
  const t = setup(); await t.s.start('实验', '合成内容'); t.s.disconnected(); t.receive(34, t.op(1));
  assert.equal(t.s.command, 0); assert.equal(t.s.phase, 'cleanup_pending'); assert.equal(t.timers.size, 0);
  await assert.rejects(t.s.start('a', 'b')); await t.s.remove(); assert.equal(t.s.phase, 'idle');
});
test('send and remove failures stay ambiguous; never claim display or result success', async () => {
  const t = setup(); t.fail(); await assert.rejects(t.s.start('实验', '合成内容'));
  assert.equal(t.s.phase, 'cleanup_pending'); await assert.rejects(t.s.remove()); await assert.rejects(t.s.start('a', 'b'));
  const u = setup(); u.occupy(); await assert.rejects(u.s.start('a', 'b')); assert.equal(u.sent.length, 0);
});
test('cleanup obligation survives process initialization; persistence failure prevents send', async () => {
  const base = setup();
  const { SuggestionTestSession } = loadApp('SuggestionTestSession', {
    '@kit.CryptoArchitectureKit': {}, '@kit.CoreFileKit': { fileIo: { accessSync: () => true, readTextSync: () => JSON.stringify({ cleanupUid: 'p10-old', cleanupPeer: 'synthetic-peer' }) } }
  });
  const s = new SuggestionTestSession(async () => {}, () => 'synthetic-peer', () => true);
  s.initialize('/synthetic'); assert.equal(s.phase, 'cleanup_pending'); await assert.rejects(s.start('a', 'b'));
  // No journal is used by the transport-only fixtures; actual app requires a durable journal.
  base.s.disconnected();
});
test('durable cleanup writes survive short writes; disk failure prevents success ACK', async () => {
  const files = new Map(), handles = new Map(); let fd = 0, broken = false;
  const fs = { OpenMode: { CREATE: 1, WRITE_ONLY: 2, TRUNC: 4 },
    accessSync: path => files.has(path), readTextSync: path => files.get(path),
    openSync(path) { if (broken) throw Error('synthetic disk full'); files.set(path, ''); handles.set(++fd, path); return { fd }; },
    writeSync(handle, bytes) { const b = new Uint8Array(bytes).slice(0, 5); const path = handles.get(handle); files.set(path, files.get(path) + new TextDecoder().decode(b)); return b.length; },
    fsyncSync() {}, closeSync() {}, renameSync(from, to) { files.set(to, files.get(from)); files.delete(from); }
  };
  const platform = { '@kit.CoreFileKit': { fileIo: fs } };
  const t = setup(platform); t.s.initialize('/synthetic'); await t.s.start('experiment', 'synthetic');
  const saved = JSON.parse(files.get('/synthetic/suggestion-test.json')); assert.equal(saved.cleanupUid, t.s.uid);
  const recovered = setup(platform); recovered.s.initialize('/synthetic'); assert.equal(recovered.s.phase, 'cleanup_pending');assert.equal(recovered.s.pendingUid,t.s.uid);
  await recovered.s.remove(); assert.equal(JSON.parse(files.get('/synthetic/suggestion-test.json')).cleanupUid, '');assert.equal(recovered.s.pendingUid,'');
  t.receive(34, t.op(1)); broken = true; await assert.rejects(t.s.acknowledge(0)); assert.equal(t.sent.length, 1);
  t.s.disconnected();
  const fresh = setup(platform); fresh.s.initialize('/another'); await assert.rejects(fresh.s.start('experiment', 'synthetic')); assert.equal(fresh.sent.length, 0);
});
test('ambiguous ACK cannot change result; cleanup journal failure still blocks a new card', async () => {
  const t = setup(); await t.s.start('a', 'b'); t.receive(34, t.op(1)); t.fail();
  await assert.rejects(t.s.acknowledge(0));
  await assert.rejects(t.s.acknowledge(3), /不能改为/); t.s.disconnected();
  let broken = false;
  const fs = { OpenMode: { CREATE: 1, WRITE_ONLY: 2, TRUNC: 4 }, accessSync: () => false,
    openSync: () => { if (broken) throw Error('disk full'); return { fd: 1 }; },
    writeSync: (_, b) => b.byteLength, fsyncSync() {}, closeSync() {}, renameSync() {} };
  const u = setup({ '@kit.CoreFileKit': { fileIo: fs } }); u.s.initialize('/synthetic');
  await u.s.start('a', 'b'); broken = true;
  await assert.rejects(u.s.remove()); assert.equal(u.s.phase, 'cleanup_pending');
  assert.equal(u.s.active, true); await assert.rejects(u.s.start('a', 'b')); u.s.disconnected();
});
