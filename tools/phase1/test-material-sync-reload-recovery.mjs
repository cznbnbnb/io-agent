import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadApp } from '../../rebuild/harmony-sdk/tests/load-app.mjs';

// Exercise the real frozen Service and Settings modules. Apply the proposed
// unified patch only in memory; no App source, credentials or device is touched.
const sourceUrl = new URL('../../rebuild/harmony-sdk/entry/src/main/ets/MaterialSyncService.ets', import.meta.url);
const originalRaw = fs.readFileSync(sourceUrl, 'utf8');
const current = originalRaw.replace(/\r\n/g, '\n');
const patch = fs.readFileSync(new URL('./material-sync-reload-recovery.patch', import.meta.url), 'utf8');
function applyInMemory(source, diff, reverse = false) {
  const lines = source.split('\n'); lines.pop();
  const result = []; let cursor = 0, i = 0;
  const delta = diff.trimEnd().split('\n');
  while (i < delta.length) {
    const header = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(delta[i++]);
    if (!header) continue;
    const start = Number(header[reverse ? 3 : 1]) - 1;
    assert(start >= cursor, 'overlapping isolated patch');
    result.push(...lines.slice(cursor, start)); cursor = start;
    while (i < delta.length && !delta[i].startsWith('@@ ')) {
      const line = delta[i++], rawKind = line[0], value = line.slice(1);
      const kind = reverse ? (rawKind === '+' ? '-' : rawKind === '-' ? '+' : rawKind) : rawKind;
      if (kind === ' ' || kind === '-') {
        assert.equal(lines[cursor++], value, 'frozen source changed; rebase the isolated patch');
      }
      if (kind === ' ' || kind === '+') result.push(value);
      if (![' ', '-', '+'].includes(kind)) throw Error('invalid isolated patch line');
    }
  }
  result.push(...lines.slice(cursor));
  return result.join('\n') + '\n';
}
// Remain runnable after the parent merges this exact patch: both versions are
// derived from the actual source with guarded patch context, never a copied
// implementation. Unknown source changes still fail and require rebasing.
let baselineSource, candidate;
try { candidate = applyInMemory(current, patch); baselineSource = current; }
catch {
  baselineSource = applyInMemory(current, patch, true);
  candidate = applyInMemory(baselineSource, patch);
  assert.equal(candidate, current, 'merged source does not match the isolated patch');
}
const useBaseline = process.env.MATERIAL_RELOAD_SOURCE === 'baseline';
const turn = async () => { await new Promise(setImmediate); await new Promise(setImmediate); };
const copy = value => JSON.parse(JSON.stringify(value));

function fixture({ baseline = useBaseline } = {}) {
  const timers = new Map(), timerDelays = [], instances = [], configurations = [], queries = [];
  let timerId = 0, mode = 'ok', saved, writes = 0, saveFailure = false;
  let deferNext = false, deferAdd = false, configureFailure = false, stopRelease, saveRelease;
  const value = { schema: 1, enabled: true, target: {
    baseUrl: 'https://synthetic.invalid/v1', token: 's'.repeat(43),
    principal: { ownerId: 'synthetic-owner', producerId: 'synthetic-phone', serverId: 'synthetic-server' }
  } };
  saved = new TextEncoder().encode(JSON.stringify(value));
  const assetResult = config => [new Map([[2, new TextEncoder().encode(JSON.stringify(config))]])];
  const asset = {
    Tag: { ALIAS: 1, SECRET: 2, RETURN_TYPE: 3, ACCESSIBILITY: 4, CONFLICT_RESOLUTION: 5 },
    ReturnType: { ALL: 1 }, Accessibility: { DEVICE_UNLOCKED: 2 }, ConflictResolution: { OVERWRITE: 3 },
    async query() {
      const record = {}; queries.push(record);
      if (deferNext) {
        deferNext = false;
        return new Promise((resolve, reject) => {
          record.resolve = config => resolve(assetResult(config)); record.reject = reject;
        });
      }
      if (mode === 'locked') throw { code: 24000003 };
      if (mode === 'absent') throw { code: 24000002 };
      if (mode === 'empty') return [];
      if (mode === 'damaged') return [new Map([[2, new TextEncoder().encode('{broken')]])];
      return [new Map([[2, Uint8Array.from(saved)]])];
    },
    async add(map) {
      if (saveFailure) throw { code: 24000003 };
      if (deferAdd) { deferAdd = false; await new Promise(resolve => { saveRelease = resolve; }); }
      writes++; saved = Uint8Array.from(map.get(2));
    }
  };
  class Coordinator {
    constructor() { this.changed = () => {}; this.enabled = false; this.foreground = false; instances.push(this); }
    setForeground(value) { this.foreground = value; }
    async configure(target) {
      if (configureFailure) throw Error('SYNC_CONFIGURATION_FAILED');
      this.target = target ? copy(target) : undefined; this.enabled = !!target;
      configurations.push(this.target); this.changed();
    }
    async stop() { this.enabled = false; return new Promise(resolve => { stopRelease = resolve; }); }
    summary() { return { enabled: this.enabled, foreground: this.foreground }; }
    view() { return {}; } problems() { return []; } async tick() {}
  }
  const globals = {
    setTimeout(callback, delay) { const id = ++timerId; timers.set(id, { callback, delay }); timerDelays.push(delay); return id; },
    clearTimeout(id) { timers.delete(id); }
  };
  const nativeRead = fs.readFileSync;
  // loadApp compiles synchronously. This replacement is scoped to one exact
  // source URL and restored before any asynchronous test work begins.
  fs.readFileSync = function (path, ...rest) {
    if (String(path) === sourceUrl.href) return baseline ? baselineSource : candidate;
    return nativeRead.call(this, path, ...rest);
  };
  let service;
  try {
    const { MaterialSyncService } = loadApp('MaterialSyncService', {
      './MaterialSyncCoordinator': { MaterialSyncCoordinator: Coordinator, MaterialSyncSummary: class {}, MaterialSyncView: class {} },
      '@kit.AssetStoreKit': { asset }
    }, globals);
    service = new MaterialSyncService(); service.initialize('/synthetic', {});
  } finally { fs.readFileSync = nativeRead; }
  return {
    service, value, timers, timerDelays, queries, instances, configurations,
    setMode: value => { mode = value; }, failSave: () => { saveFailure = true; },
    failConfigure: () => { configureFailure = true; }, deferQuery: () => { deferNext = true; },
    deferSave: () => { deferAdd = true; }, releaseSave: () => saveRelease(),
    saved: () => JSON.parse(new TextDecoder().decode(saved)), writes: () => writes,
    releaseStop: () => stopRelease(),
    firstTimer: () => { assert.equal(timers.size, 1, 'one bounded settings retry is pending'); return [...timers.values()][0]; },
    fire: async () => {
      assert.equal(timers.size, 1, 'one bounded settings retry is pending');
      const [id, entry] = [...timers.entries()][0]; timers.delete(id); entry.callback(); await turn();
    }
  };
}

test('frozen baseline reproduces enabled persisted config paused after one Asset lock failure', async () => {
  const f = fixture({ baseline: true }); f.setMode('locked'); f.service.setForeground(true); await turn();
  assert.equal(f.saved().enabled, true); assert.equal(f.service.summary().enabled, false);
  assert.match(f.service.settingsNote, /暂不可读/); assert.equal(f.timers.size, 0); assert.equal(f.writes(), 0);
  f.setMode('ok'); await turn(); assert.equal(f.queries.length, 1); assert.equal(f.service.summary().enabled, false);
});

test('same foreground automatically reloads real Settings after temporary lock without writing config', async () => {
  const f = fixture(); f.setMode('locked'); f.service.setForeground(true); await turn();
  assert.equal(f.firstTimer().delay, 1000); assert.equal(f.saved().enabled, true); assert.equal(f.writes(), 0);
  f.setMode('ok'); await f.fire();
  assert.equal(f.queries.length, 2); assert.equal(f.service.summary().enabled, true);
  assert.equal(f.service.settingsNote, ''); assert.equal(f.timers.size, 0); assert.equal(f.writes(), 0);
  assert.deepEqual(f.service.summary(), { enabled: true, foreground: true });
});

test('unavailable settings retry at most five times with increasing bounded delays', async () => {
  const f = fixture(); f.setMode('locked'); f.service.setForeground(true); await turn();
  for (let i = 0; i < 5; i++) await f.fire();
  assert.deepEqual(f.timerDelays, [1000, 3000, 10000, 30000, 30000]);
  assert.equal(f.queries.length, 6); assert.equal(f.timers.size, 0); assert.equal(f.service.summary().enabled, false);
  assert.equal(f.writes(), 0); assert.equal(f.saved().enabled, true);
  await turn(); assert.equal(f.queries.length, 6);
});

test('missing Asset and empty query remain genuinely disabled without retries or invented settings', async () => {
  for (const mode of ['absent', 'empty']) {
    const f = fixture(); f.setMode(mode); f.service.setForeground(true); await turn();
    assert.equal(f.service.summary().enabled, false); assert.equal(f.service.settingsNote, '');
    assert.equal(f.queries.length, 1); assert.equal(f.timers.size, 0); assert.equal(f.writes(), 0);
  }
});

test('corrupt settings and coordinator configuration failure are never lock-retried', async () => {
  const corrupt = fixture(); corrupt.setMode('damaged'); corrupt.service.setForeground(true); await turn();
  assert.match(corrupt.service.settingsNote, /暂不可读/); assert.equal(corrupt.timers.size, 0); assert.equal(corrupt.writes(), 0);
  const ledger = fixture(); ledger.failConfigure(); ledger.service.setForeground(true); await turn();
  assert.match(ledger.service.settingsNote, /暂不可读/); assert.equal(ledger.queries.length, 0); assert.equal(ledger.timers.size, 0);
});

test('background cancels old timer including an already queued callback; fresh foreground restores', async () => {
  const f = fixture(); f.setMode('locked'); f.service.setForeground(true); await turn(); const stale = f.firstTimer().callback;
  f.service.setForeground(false); assert.equal(f.timers.size, 0); stale(); await turn();
  assert.equal(f.queries.length, 1); assert.equal(f.service.summary().foreground, false);
  f.setMode('ok'); f.service.setForeground(true); await turn();
  assert.equal(f.service.summary().enabled, true); assert.equal(f.queries.length, 2); assert.equal(f.writes(), 0);
});

test('background fences a settings read already awaiting Asset during the retry', async () => {
  const f = fixture(); f.setMode('locked'); f.service.setForeground(true); await turn();
  f.deferQuery(); await f.fire(); assert.equal(f.queries.length, 2);
  f.service.setForeground(false); f.queries[1].resolve(f.value); await turn();
  assert.equal(f.service.summary().enabled, false); assert.equal(f.timers.size, 0);
  assert(f.configurations.every(value => value === undefined));
});

test('explicit disable cancels the old retry; a queued callback cannot re-enable saved credentials', async () => {
  const f = fixture(); f.setMode('locked'); f.service.setForeground(true); await turn(); const stale = f.firstTimer().callback;
  await f.service.save({ ...f.value, enabled: false }); stale(); await turn();
  assert.equal(f.saved().enabled, false); assert.equal(f.service.summary().enabled, false);
  assert.equal(f.timers.size, 0); assert.equal(f.queries.length, 1); assert.equal(f.writes(), 1);
});

test('late successful retry read cannot override a new explicit target or disable save', async () => {
  for (const enabled of [true, false]) {
    const f = fixture(); f.setMode('locked'); f.service.setForeground(true); await turn();
    f.deferQuery(); await f.fire();
    const replacement = { ...f.value, enabled, target: { ...f.value.target, token: 'n'.repeat(43) } };
    await f.service.save(replacement); f.queries[1].resolve(f.value); await turn();
    assert.deepEqual(f.saved(), replacement); assert.equal(f.service.summary().enabled, enabled);
    assert.equal(f.instances[0].target?.token, enabled ? replacement.target.token : undefined);
    assert.equal(f.timers.size, 0);
  }
});

test('failed save stays paused and old retry cannot resume old credentials', async () => {
  const f = fixture(); f.setMode('locked'); f.service.setForeground(true); await turn(); const stale = f.firstTimer().callback;
  f.failSave(); await assert.rejects(f.service.save({ ...f.value, enabled: false }), /未启用/);
  stale(); await turn(); assert.equal(f.service.summary().enabled, false); assert.equal(f.saved().enabled, true);
  assert.equal(f.timers.size, 0); assert.equal(f.queries.length, 1); assert.equal(f.writes(), 0);
});

test('explicit save completing across background and foreground is preserved, not silently discarded', async () => {
  const f = fixture(); f.setMode('locked'); f.service.setForeground(true); await turn();
  f.deferSave(); const replacement = { ...f.value, target: { ...f.value.target, token: 'n'.repeat(43) } };
  const saving = f.service.save(replacement); await turn();
  f.service.setForeground(false); f.service.setForeground(true); await turn();
  assert.equal(f.service.summary().enabled, false); assert.equal(f.queries.length, 1);
  f.releaseSave(); await saving;
  assert.deepEqual(f.saved(), replacement); assert.equal(f.instances[0].target.token, replacement.target.token);
  assert.equal(f.service.summary().enabled, true); assert.equal(f.service.summary().foreground, true);
  assert.equal(f.timers.size, 0); assert.equal(f.writes(), 1);
});

test('dispose cancels retry and next runtime waits old coordinator close', async () => {
  const f = fixture(); f.setMode('locked'); f.service.setForeground(true); await turn(); const stale = f.firstTimer().callback;
  const stopping = f.service.dispose(); f.service.initialize('/synthetic-next', {}); f.setMode('ok'); f.service.setForeground(true);
  stale(); await turn(); assert.equal(f.timers.size, 0); assert.equal(f.queries.length, 1); assert.equal(f.instances.length, 2);
  f.releaseStop(); await stopping; await turn();
  assert.equal(f.queries.length, 2); assert.equal(f.instances[0].enabled, false); assert.equal(f.instances[1].enabled, true);
});

test('dispose fences an in-flight settings retry even after reinitializing', async () => {
  const f = fixture(); f.setMode('locked'); f.service.setForeground(true); await turn(); f.deferQuery(); await f.fire();
  const stopping = f.service.dispose(); f.service.initialize('/synthetic-next', {});
  f.queries[1].resolve(f.value); await turn(); assert.equal(f.instances[1].enabled, false); assert.equal(f.timers.size, 0);
  f.releaseStop(); await stopping; assert.equal(f.instances[0].enabled, false);
});

test('manual reload supersedes old queued timer without allowing it to erase the next retry', async () => {
  const f = fixture(); f.setMode('locked'); f.service.setForeground(true); await turn(); const stale = f.firstTimer().callback;
  await f.service.reload(); const current = f.firstTimer(); assert.equal(current.delay, 1000);
  stale(); await turn(); assert.equal(f.firstTimer(), current); assert.equal(f.queries.length, 2);
  f.setMode('ok'); await f.fire(); assert.equal(f.service.summary().enabled, true); assert.equal(f.queries.length, 3);
});

test('automatic retries stay foreground-only even when explicit reload is called in background', async () => {
  const f = fixture(); f.setMode('locked'); await f.service.reload();
  assert.equal(f.queries.length, 1); assert.equal(f.timers.size, 0); assert.equal(f.service.summary().enabled, false);
});

test('new foreground episode resets exhausted bounded budget and does not touch healthy settings', async () => {
  const f = fixture(); f.setMode('locked'); f.service.setForeground(true); await turn();
  for (let i = 0; i < 5; i++) await f.fire();
  f.service.setForeground(false); f.service.setForeground(true); await turn(); assert.equal(f.firstTimer().delay, 1000);
  f.setMode('ok'); await f.fire(); assert.equal(f.service.summary().enabled, true); assert.equal(f.timers.size, 0);
  await turn(); assert.equal(f.queries.length, 8); assert.equal(f.writes(), 0);
});

test('the isolated verification leaves frozen main source byte-identical', () => {
  assert.equal(fs.readFileSync(sourceUrl, 'utf8'), originalRaw);
});
