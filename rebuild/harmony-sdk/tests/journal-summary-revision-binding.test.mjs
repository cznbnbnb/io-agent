import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { loadApp } from './load-app.mjs';

// Exercise the actual App modules and extracted page/service methods.
// AI/configuration/picker and filesystem are explicit runtime substitutes.
// No model, network, device or persisted user data is accessed.
const repo = new URL('../../../', import.meta.url);
const paths = ['rebuild/harmony-sdk/entry/src/main/ets/JournalExport.ets',
  'rebuild/harmony-sdk/entry/src/main/ets/pages/JournalPanel.ets',
  'rebuild/harmony-sdk/entry/src/main/ets/RecordingService.ets'];
const originals = new Map(paths.map(path => [path, fs.readFileSync(new URL(path, repo), 'utf8')]));
const source = path => originals.get(path);
const require = createRequire(import.meta.url), deveco = process.env.DEVECO_HOME || 'D:/APP/DevEcoStudio';
const ts = require(`${deveco}/sdk/default/openharmony/ets/build-tools/ets-loader/node_modules/typescript`);
const turn = async () => { await new Promise(setImmediate); await new Promise(setImmediate); };
const DAY = new Date(2026, 0, 1).getTime();
const journalPath = paths[0], pagePath = paths[1], servicePath = paths[2];

function memoryFiles() {
  const files = new Map(), descriptors = new Map(); let fd = 1, failPromotion = false, failSync = false, failWrite = false, writes = 0;
  const io = { OpenMode: { CREATE: 1, WRITE_ONLY: 2, TRUNC: 4, READ_ONLY: 8 },
    accessSync: path => files.has(path), readTextSync(path) { if (!files.has(path)) throw Error('synthetic file unavailable'); return files.get(path).toString('utf8'); },
    openSync(path, mode) { if (mode & 4 || !files.has(path)) files.set(path, Buffer.alloc(0)); const file = { fd: fd++ }; descriptors.set(file.fd, { path, offset: 0 }); return file; },
    writeSync(id, input) { if (failWrite && ++writes === 2) return 0; const state = descriptors.get(id), bytes = Buffer.from(input), count = Math.min(13, bytes.length);
      const previous = files.get(state.path), output = Buffer.alloc(Math.max(previous.length, state.offset + count)); previous.copy(output);
      bytes.copy(output, state.offset, 0, count); state.offset += count; files.set(state.path, output); return count; },
    closeSync(id) { descriptors.delete(typeof id === 'number' ? id : id.fd); },
    fsyncSync() { if (failSync) throw Error('synthetic snapshot fsync failed'); },
    renameSync(from, to) { if (failPromotion) throw Error('synthetic snapshot promotion failed'); files.set(to, files.get(from)); files.delete(from); }
  };
  return { io, files, failPromotion: () => { failPromotion = true; }, failSync: () => { failSync = true; }, failWrite: () => { failWrite = true; } };
}
function journalModule(mem) {
  const nativeRead = fs.readFileSync;
  fs.readFileSync = function (path, ...args) { if (String(path) === new URL(journalPath, repo).href) return source(journalPath); return nativeRead.call(this, path, ...args); };
  try { return loadApp('JournalExport', { '@kit.CoreFileKit': { fileIo: mem.io },
    './LifelogSession': { LifelogDayText: class { markdown = ''; total = 0; transcribed = 0; } }, './RecordingSession': {} }); }
  finally { fs.readFileSync = nativeRead; }
}
function method(body, name) {
  const match = new RegExp(`^  (?:private )?(?:async )?${name}\\(`, 'm').exec(body); assert(match, 'actual page method missing');
  const after = body.slice(match.index + match[0].length), next = /\n  (?:private |aboutTo|@Builder|[A-Za-z][A-Za-z0-9_]*\()/.exec(after); assert(next, `actual method boundary missing: ${name}`);
  return body.slice(match.index, match.index + match[0].length + next.index);
}
function evaluate(code, environment) {
  const compiled = ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText;
  const module = { exports: {} }; vm.runInNewContext(compiled, { ...environment, module, exports: module.exports, Error, JSON, Uint8Array }); return module.exports;
}
function fixture({ legacy = false, partial = false, literalHeading = false, day = DAY } = {}) {
  const mem = memoryFiles(), journal = journalModule(mem), calls = [], remoteWait = [], configWait = [], pickerWait = [], picked = [], toasts = [];
  let configDeferred = false, pickerDeferred = false, readFailure = false;
  const item = { name: 'take-' + 'a'.repeat(32), created: day + 1000, bytes: 12000, textFile: 'legacy.md' };
  let head = { material_id: 'mat-recording-' + 'a'.repeat(32), revision: 10, text_revision: 8, operation: 'upsert',
    text: literalHeading ? '合成原文含 ## AI 总结 字样' : '合成旧原文', utterances: [], speakers: [],
    transcription_state: partial ? 'partial' : 'complete', speaker_processing: 'processed', boundary_processing: 'token_starts',
    source: { audioAvailable: false, started: item.created, ended: item.created + 1000, complete: true } };
  const recordings = { items: [item], textPath: () => '/synthetic/legacy.md', changed() {} },
    lifelog = { items: [], rootPath: () => '/synthetic', changed() {}, note: 'existing capture note', readTranscriptJson: () => '' };
  mem.files.set('/synthetic/legacy.md', Buffer.from('合成旧ASR镜像'));
  const materials = { idFor: () => head.material_id, read: () => { if (readFailure) throw Error('synthetic canonical read failed'); return legacy ? undefined : head; } };
  const sources = () => { const s = new journal.JournalSources(); Object.assign(s, { lifelogRoot: '/synthetic', recordingItems: recordings.items,
    recordingText: row => mem.io.readTextSync(recordings.textPath(row)), material: () => materials.read(), transcriptJson: () => '' }); return s; };
  const configuration = () => configDeferred ? new Promise(resolve => configWait.push(resolve)) : Promise.resolve({ modelKey: 'synthetic-model-key' });
  const summarize = (...args) => { calls.push(args); return new Promise((resolve, reject) => remoteWait.push({ resolve, reject })); };
  class SecureServiceConfig { load() { return configuration(); } }
  class RemoteServices { summarize(...args) { return summarize(...args); } cancel() {} }
  const probe = { foreground: true, suspend() { this.foreground = false; } };
  const playbackCalls=[],localPlayback={setForeground:value=>playbackCalls.push(['foreground',value]),suspend:reason=>{playbackCalls.push(['suspend',reason]);return Promise.resolve({});}};
  const globals = { localPlayback, ...journal, lifelog, recordings, materials, probeSession: probe, lifelogASR: { changed() {} }, voices: { cards: () => 'synthetic voice cards' },
    fs: mem.io, SecureServiceConfig, RemoteServices, cancelRecordingCloudTranscription() {}, cancelLifelogManualPublication() {} };
  const Page = evaluate(`class Page {\n${['run', 'sources', 'dayMarkdown', 'runExport', 'stamp', 'aboutToDisappear'].map(name => method(source(pagePath), name)).join('\n')}\n}\nmodule.exports=Page;`, globals);
  // Keep the legacy writer available to catch accidental reuse of its
  // history-only-recording date fallback.
  const legacySource = fs.readFileSync(new URL('rebuild/harmony-sdk/entry/src/main/ets/LifelogSession.ets', repo), 'utf8');
  const Legacy = evaluate(`class Legacy {\n${method(legacySource, 'saveDayFileIn')}\n}\nmodule.exports=Legacy;`, {
    fs: mem.io, util: { TextEncoder: class { encodeInto(s) { return new TextEncoder().encode(s); } } },
    LifelogSession: { dayKey: ms => journal.dayStamp(ms) }, Date
  });
  const legacyWriter = new Legacy(); legacyWriter.root = '/synthetic'; legacyWriter.dayItemsIn = () => [];
  lifelog.saveDayFileIn = (day, markdown) => legacyWriter.saveDayFileIn(day, markdown);
  const page = new Page(); Object.assign(page, { playbackUnsubscribe(){playbackCalls.push('unsubscribe');}, visible: true, actionEpoch: 1, busy: false, selected: day, note: 'existing page note',
    text: 'existing body', textKind: '', textName: '', textRevision: 0, textNeedsFull: false, fullText: false,
    vault: { load: configuration }, remote: { summarize },
    getUIContext: () => ({ getPromptAction: () => ({ showToast: value => toasts.push(value.message) }) }),
    copyOut(path) { picked.push(path); if (pickerDeferred) return new Promise(resolve => pickerWait.push(resolve)); return Promise.resolve(true); }
  });
  const body = source(servicePath), begin = body.indexOf('async function ensureDaySummary('), end = body.indexOf('\nfunction windowWaitLabel', begin); assert(begin >= 0 && end > begin);
  const automatic = { ...globals, serviceActive: true, automaticSummary: true, summaryBusy: false, serviceGeneration: 1, summaryRemote: undefined, journalSources: sources };
  // vm copies the initial bindings into its own context; use an explicit
  // context for lifetime changes and invoke the actual private method there.
  const autoContext = vm.createContext({ ...automatic, module: { exports: {} }, Error, JSON, Uint8Array });
  const compiled = ts.transpileModule(body.slice(begin, end) + '\nmodule.exports=ensureDaySummary;', { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText;
  vm.runInContext(compiled, autoContext);
  const abilitySource = fs.readFileSync(new URL('rebuild/harmony-sdk/entry/src/main/ets/entryability/EntryAbility.ets', repo), 'utf8');
  const Ability = evaluate(`class Ability {\n${method(abilitySource, 'onBackground')}\n}\nmodule.exports=Ability;`, {
    localPlayback,probeSession: probe, materialSyncService: { setForeground() {} }, taskService: { setForeground() {} }
  });
  return { ...mem, journal, page, probe, playbackCalls,ability: new Ability(), calls, remoteWait, configWait, picked, pickerWait, toasts, lifelog, recordings, sources, day,
    head: () => head, revise: (changes = { revision: 11, text: '合成新原文' }) => { Object.assign(head, changes); },
    replaceIdentity() { item.name = 'take-' + 'b'.repeat(32); head.material_id = 'mat-recording-' + 'b'.repeat(32); },
    failCanonicalRead: () => { readFailure = true; }, deferConfig: () => { configDeferred = true; }, deferPicker: () => { pickerDeferred = true; },
    auto: () => autoContext.module.exports(day), stopAuto: () => { autoContext.serviceActive = false; autoContext.serviceGeneration++; autoContext.summaryBusy = false; autoContext.summaryRemote = undefined; },
    outputs: () => [...mem.files.keys()].filter(path => /\/day-.*\.md$/.test(path)),
    async manual(withSummary = true) { page.runExport(day, withSummary); await turn(); },
    async finish(summary = '合成旧总结') { assert.equal(remoteWait.length, 1); remoteWait[0].resolve(summary); await turn(); }
  };
}

test('manual AI correction refuses old summary with new source and never opens picker', async () => {
  const f = fixture(); await f.manual(); f.revise(); await f.finish();
  assert.equal(f.outputs().length, 0); assert.equal(f.picked.length, 0); assert.match(f.page.note, /资料已变化/); assert.equal(f.page.text, 'existing body');
});
test('manual same-body revision or stable identity change still invalidates the AI result', async () => {
  for (const change of [f => f.revise({ revision: 11 }), f => f.replaceIdentity()]) {
    const f = fixture(); await f.manual(); change(f); await f.finish(); assert.equal(f.outputs().length, 0); assert.equal(f.picked.length, 0);
  }
});
test('manual tombstone or removed membership never revives old summary or raw ASR', async () => {
  for (const change of [f => f.revise({ revision: 11, operation: 'delete', text: '' }), f => f.recordings.items = []]) {
    const f = fixture(); await f.manual(); change(f); await f.finish(); assert.equal(f.outputs().length, 0); assert.equal(f.picked.length, 0);
  }
});
test('manual unchanged sources save a bound original-input summary without requiring original audio', async () => {
  const f = fixture(); await f.manual(); await f.finish(); assert.equal(f.picked.length, 1);
  const content = f.io.readTextSync(f.picked[0]); assert.match(content, /资料修订：10；文字修订：8/); assert.match(content, /总结来源指纹：sha256:[a-f0-9]{64}/);
  assert.match(content, /原音当前不可用/); assert.match(content, /合成旧总结/); assert.match(f.calls[0][2], /合成旧原文/);
});
test('manual page leave and reappearance suppress late result save, detail and toast', async () => {
  const f = fixture(); await f.manual(); f.page.aboutToDisappear(); f.page.visible = true; f.page.actionEpoch++; await f.finish();
  assert.equal(f.outputs().length, 0); assert.equal(f.picked.length, 0); assert.equal(f.page.text, 'existing body'); assert.equal(f.toasts.length, 0);
});
test('manual selected-day change suppresses a result and its stale completion toast', async () => {
  const f = fixture(); await f.manual(); f.page.selected += 86400000; await f.finish();
  assert.equal(f.outputs().length, 0); assert.equal(f.picked.length, 0); assert.equal(f.toasts.length, 0);
});
test('manual checks revision again after deferred configuration before sending to AI', async () => {
  const f = fixture(); f.deferConfig(); await f.manual(); f.revise(); f.configWait[0]({ modelKey: 'synthetic-model-key' }); await turn();
  assert.equal(f.calls.length, 0); assert.equal(f.outputs().length, 0); assert.equal(f.picked.length, 0); assert.match(f.page.note, /资料已变化/);
});
test('manual completion preserves detail B opened while the original summary was pending', async () => {
  const f = fixture(); await f.manual(); Object.assign(f.page, { text: 'selected B body', textName: 'take-b', textKind: 'recording', textRevision: 7 }); await f.finish();
  assert.equal(f.picked.length, 1); assert.equal(f.page.text, 'selected B body'); assert.equal(f.page.textName, 'take-b'); assert.equal(f.page.textRevision, 7);
});
test('picker wait cannot replace content-addressed export with later mutable automatic day cache', async () => {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const f = fixture({ day: today.getTime() }); f.deferPicker(); await f.manual(); await f.finish(); assert.equal(f.picked.length, 1);
  const path = f.picked[0], frozen = f.io.readTextSync(path);
  f.journal.writeJournalFile('/synthetic', f.day, 'synthetic later automatic cache');
  assert.equal(f.io.readTextSync(path), frozen); assert.match(path, new RegExp('day-' + f.journal.dayStamp(f.day) + '-[a-f0-9]{64}\\.md$'));
  f.pickerWait[0](true); await turn(); assert.equal(f.page.text, frozen);
});
test('history-only recording export path uses requested date, without writing today day cache', async () => {
  const f = fixture(); await f.manual(false); assert.equal(f.picked.length, 1);
  assert.match(f.picked[0], new RegExp('/day-' + f.journal.dayStamp(DAY) + '-[a-f0-9]{64}\\.md$'));
  assert.equal(f.outputs().length, 1); assert.doesNotMatch(f.io.readTextSync(f.picked[0]), /## AI 总结/);
});
test('snapshot promotion failure preserves existing day cache and cannot reach picker', async () => {
  const f = fixture(), cache = '/synthetic/day-' + f.journal.dayStamp(DAY) + '.md'; f.files.set(cache, Buffer.from('synthetic existing cache')); f.failPromotion();
  await f.manual(false); assert.equal(f.picked.length, 0); assert.equal(f.outputs().length, 1); assert.equal(f.io.readTextSync(cache), 'synthetic existing cache');
  assert.match(f.page.note, /promotion failed/);
});
test('snapshot short writes finish all bytes, conflict never overwrites an existing snapshot', () => {
  const f = fixture(), content = 'synthetic content 🙂'.repeat(20), path = f.journal.writeJournalSnapshot('/synthetic', DAY, content);
  assert.equal(f.io.readTextSync(path), content); assert.equal(f.journal.writeJournalSnapshot('/synthetic', DAY, content), path);
  f.files.set(path, Buffer.from('synthetic damaged snapshot')); assert.throws(() => f.journal.writeJournalSnapshot('/synthetic', DAY, content), /内容冲突/);
  assert.equal(f.io.readTextSync(path), 'synthetic damaged snapshot');
});
test('canonical empty revision remains authoritative while legitimate legacy-only text remains usable', () => {
  const empty = fixture(); empty.revise({ text: '', text_revision: 9, revision: 11 });
  const day = empty.journal.buildJournalDay(DAY, empty.sources(), ''); assert.equal(day.transcribed, 0); assert.doesNotMatch(day.markdown, /旧ASR镜像/);
  const legacy = fixture({ legacy: true }), old = legacy.journal.buildJournalDay(DAY, legacy.sources(), '');
  assert.equal(old.transcribed, 1); assert.match(old.markdown, /旧ASR镜像/); assert.match(old.markdown, /旧资料尚无资料修订/);
});
test('canonical read failure is not silently downgraded to legacy AI evidence', async () => {
  const f = fixture(); f.failCanonicalRead(); await f.manual(); assert.equal(f.calls.length, 0); assert.equal(f.picked.length, 0); assert.equal(f.outputs().length, 0);
  assert.match(f.page.note, /canonical read failed/);
});
test('automatic AI correction refuses old summary with new source rather than writing mixed cache', async () => {
  const f = fixture(), run = f.auto(); await turn(); f.revise(); await f.finish(); await run;
  assert.equal(f.outputs().length, 0); assert.match(f.lifelog.note, /资料已变化/);
});
test('automatic same-body revision, identity and tombstone changes invalidate AI results', async () => {
  for (const change of [f => f.revise({ revision: 11 }), f => f.replaceIdentity(), f => f.revise({ revision: 11, operation: 'delete', text: '' })]) {
    const f = fixture(), run = f.auto(); await turn(); change(f); await f.finish(); await run; assert.equal(f.outputs().length, 0);
  }
});
test('automatic unchanged source produces a source-bound requested-date cache without original audio', async () => {
  const f = fixture(), run = f.auto(); await turn(); await f.finish(); await run;
  assert.equal(f.outputs().length, 2); const path = '/synthetic/day-' + f.journal.dayStamp(DAY) + '.md';
  assert(f.outputs().includes(path));const independent=f.outputs().find(value=>value!==path);
  assert.match(independent,new RegExp('/day-'+f.journal.dayStamp(DAY)+'-[a-f0-9]{64}\\.md$'));
  assert.equal(f.io.readTextSync(independent),f.io.readTextSync(path));
  assert.match(f.io.readTextSync(path), /总结来源指纹：sha256:[a-f0-9]{64}/); assert.match(f.io.readTextSync(path), /资料修订：10/);
});
test('automatic original text containing AI heading is not a false summary-cache hit', async () => {
  const f = fixture({ literalHeading: true }), run = f.auto(); await turn(); assert.equal(f.calls.length, 1); await f.finish(); await run; assert.equal(f.outputs().length, 2);
  const cache='/synthetic/day-'+f.journal.dayStamp(DAY)+'.md',independent=f.outputs().find(value=>value!==cache);
  assert(f.outputs().includes(cache));assert.match(independent,new RegExp('/day-'+f.journal.dayStamp(DAY)+'-[a-f0-9]{64}\\.md$'));
  assert.equal(f.io.readTextSync(independent),f.io.readTextSync(cache));assert.match(f.io.readTextSync(independent),/资料修订：10；文字修订：8/);
});
test('automatic checks sources after deferred configuration, lifetime stop suppresses late save', async () => {
  const changed = fixture(); changed.deferConfig(); const first = changed.auto(); await turn(); changed.revise(); changed.configWait[0]({ modelKey: 'synthetic-model-key' }); await first;
  assert.equal(changed.calls.length, 0); assert.equal(changed.outputs().length, 0);
  const stopped = fixture(), second = stopped.auto(); await turn(); stopped.stopAuto(); await stopped.finish(); await second;
  assert.equal(stopped.outputs().length, 0); assert.equal(stopped.lifelog.note, 'existing capture note');
});
test('partial source text is exportable but not eligible for automatic whole-day summary', async () => {
  const f = fixture({ partial: true }); await f.auto(); assert.equal(f.calls.length, 0); await f.manual(false);
  assert.equal(f.picked.length, 1); assert.match(f.io.readTextSync(f.picked[0]), /剩余音频仍在处理/);
});

test('automatic write, fsync and promotion failures preserve the complete prior day cache', async () => {
  for (const fail of ['failWrite', 'failSync', 'failPromotion']) {
    const f = fixture(), path = '/synthetic/day-' + f.journal.dayStamp(DAY) + '.md';
    f.files.set(path, Buffer.from('synthetic complete prior summary')); f[fail]();
    const run = f.auto(); await turn(); await f.finish(); await run;
    assert.equal(f.io.readTextSync(path), 'synthetic complete prior summary');
    assert.match(f.lifelog.note, /failed|写入不完整/); assert.equal(f.picked.length, 0);
  }
});
test('actual Ability background leaves page mounted but blocks late AI snapshot and picker', async () => {
  const f = fixture(); await f.manual(); f.ability.onBackground();
  assert.deepEqual(f.playbackCalls,[['foreground',false]]);
  assert.equal(f.probe.foreground, false); assert.equal(f.page.visible, true); await f.finish();
  assert.equal(f.outputs().length, 0); assert.equal(f.picked.length, 0); assert.equal(f.toasts.length, 0); assert.equal(f.page.text, 'existing body');
});
test('picker background after accepted snapshot cannot turn a completed export into a stale UI failure', async () => {
  const f = fixture(); f.deferPicker(); await f.manual(); await f.finish(); const path = f.picked[0], content = f.io.readTextSync(path);
  f.ability.onBackground(); f.pickerWait[0](true); await turn();
  assert.equal(f.io.readTextSync(path), content); assert.equal(f.toasts.length, 0); assert.equal(f.page.text, 'existing body');
  assert.doesNotMatch(f.page.note, /失败|取消/);
});
test('math duration formatting handles zero, seconds and greater than 24 hours without timezone shift', () => {
  const f = fixture(); assert.equal(f.journal.journalDuration(0), '00:00:00'); assert.equal(f.journal.journalDuration(13), '00:00:13');
  assert.equal(f.journal.journalDuration(25 * 3600 + 61), '25:01:01'); assert.equal(f.journal.journalDuration(NaN), '未知');
});
test('daily statistics use canonical recording time bounds and mark missing legacy range unknown', () => {
  const f = fixture(); f.head().source.ended = f.head().source.started + 13000;
  const known = f.journal.buildJournalDay(DAY, f.sources(), ''); assert.match(known.markdown, /录音总时长 00:00:13/); assert.match(known.markdown, /（13秒）/);
  assert.doesNotMatch(known.markdown, /录音总时长 08:/);
  const legacy = fixture({ legacy: true }), unknown = legacy.journal.buildJournalDay(DAY, legacy.sources(), '');
  assert.match(unknown.markdown, /录音总时长 未知/); assert.match(unknown.markdown, /时长未知/); assert.doesNotMatch(unknown.markdown, /录音总时长 00:00:00/);
});
