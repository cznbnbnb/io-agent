// Reproduce a public, restricted report from actual private native observations.
// Raw layouts, device identifiers, credentials and user text stay private.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';

const root = process.cwd();
const phase = path.join(root, 'rebuild/phase1');
const privateDir = path.join(phase, 'device-private');
const json = file => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
const digest = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const runId = '20261014-023619244-e29eeb78';
const run = path.join(phase, 'candidate-runs', runId);
const status = json(path.join(run, 'status.json'));
assert.equal(status.phase, 'complete');
assert.equal(status.versionCode, 10058);
assert.equal(status.compileSucceeded, true);
assert.equal(digest(path.join(run, 'source-hashes.json')), status.sourceHashManifestSha256.toLowerCase());
const sourceManifest = json(path.join(run, 'source-hashes.json'));
const sourceNames = ['AppScope/app.json5', 'entry/src/main/ets/pages/FeaturePanel.ets',
  'entry/src/main/ets/pages/JournalPanel.ets', 'entry/src/main/ets/pages/RecordingPanel.ets'];
const sources = sourceNames.map(name => {
  const relative = `harmony-sdk/${name}`;
  const item = sourceManifest.find(row => row.path === relative);
  assert.ok(item, 'frozen source entry missing');
  const sha = digest(path.join(root, 'rebuild', relative));
  assert.equal(sha, item.sha256.toLowerCase(), 'source changed since native build');
  return { path: relative, sha256: sha };
});
const hap = path.join(phase, 'artifacts/entry-default-signed-0.1.58.hap');
assert.equal(digest(hap), '28869d950a2d09216f395c72c5fb9d2525c377ab30e9a9d42b960e99c30a4cf8');
assert.match(fs.readFileSync(path.join(privateDir, 'connection058-version-readback.json'), 'utf8'), /"versionCode": 10058/);
assert.match(fs.readFileSync(path.join(phase, 'connection058-device-install-2026-10-14.log'), 'utf8'), /install bundle successfully/);

function ownNodes(file) {
  const nodes = [];
  const walk = node => { nodes.push(node); for (const child of node.children ?? []) walk(child); };
  walk(json(path.join(privateDir, file)));
  const focused = nodes.filter(node => node.attributes.type === 'root' && node.attributes.focused === 'true' && node.attributes.bundleName);
  assert.equal(focused.length, 1);
  assert.equal(focused[0].attributes.bundleName, 'org.turboio.harmony.research');
  assert.equal(focused[0].attributes.pagePath, 'pages/Index');
  const own = nodes.filter(node => node.attributes.hostWindowId === focused[0].attributes.hostWindowId && node.attributes.visible === 'true');
  assert.equal(own.filter(node => node.attributes.text === 'TURBO IO').length, 1);
  return own;
}
function controls(file, captions, idleText) {
  const own = ownNodes(file);
  assert.equal(own.filter(node => node.attributes.text === idleText).length, 1);
  const local = own.filter(node => node.attributes.type === 'Text' && /^眼镜(?:已|未)连接 · 电量 /.test(node.attributes.text));
  assert.equal(local.length, 1);
  const connected = /^眼镜已连接 /.test(local[0].attributes.text);
  if (connected) assert.equal(own.filter(node => node.attributes.text === '已连接').length, 1);
  return { connected, buttons: captions.map(caption => {
    const matches = own.filter(node => node.attributes.type === 'Button' && node.attributes.text === caption);
    assert.equal(matches.length, 1);
    const a = matches[0].attributes;
    assert.ok(['true', 'false'].includes(a.enabled));
    return { caption, enabled: a.enabled === 'true', node: a.accessibilityId, window: a.hostWindowId };
  }) };
}

function transition(name, captions, idleText) {
  const ledger = json(path.join(privateDir, `connection058-${name}-transition-ledger.json`));
  assert.match(ledger.pidBefore, /^\d+$/);
  assert.equal(ledger.pidAfter, ledger.pidBefore, 'process changed during same-page observation');
  const before = controls(`connection058-${name}-ready-before.json`, captions, idleText);
  assert.equal(before.connected, true);
  assert.ok(before.buttons.every(button => button.enabled));
  const observations = ledger.observations.map(entry => ({ at: entry.at, ...controls(entry.layout, captions, idleText) }));
  assert.ok(observations.length >= 3);
  assert.equal(observations[0].connected, false, 'initial unready state not captured');
  let readySeen = false;
  for (let i = 0; i < observations.length; i++) {
    const item = observations[i];
    if (i) assert.ok(Date.parse(item.at) > Date.parse(observations[i - 1].at));
    assert.deepEqual(item.buttons.map(button => [button.node, button.window]), before.buttons.map(button => [button.node, button.window]));
    assert.ok(item.buttons.every(button => button.enabled === item.connected));
    readySeen ||= item.connected;
  }
  assert.ok(readySeen, 'ready transition not captured');
  return { same_process: true, same_native_controls: true, connected_before_suspend: true,
    disabled_after_disconnect: true, auto_enabled_after_ready: true, observations };
}

const restore = json(path.join(privateDir, 'connection058-test-preference-ledger.json'));
assert.equal(restore.originalBackgroundEnabled, true);
assert.equal(restore.restoreRequired, false);
assert.equal(restore.restoredRuntimeGranted, true);
assert.equal(restore.restoredPersistedBackgroundEnabled, true);
assert.equal(restore.restoredAutoConnect, true);
function background(file, checked, message) {
  const own = ownNodes(file);
  const labels = own.filter(node => node.attributes.type === 'Text' && node.attributes.text === '后台连接');
  assert.equal(labels.length, 1);
  const rows = own.filter(node => node.attributes.type === 'Row' && labels[0].attributes.hierarchy.startsWith(node.attributes.hierarchy + ','))
    .sort((a, b) => b.attributes.hierarchy.length - a.attributes.hierarchy.length);
  assert.ok(rows.length);
  const toggles = own.filter(node => node.attributes.type === 'Toggle' && node.attributes.hierarchy.startsWith(rows[0].attributes.hierarchy + ','));
  assert.equal(toggles.length, 1);
  assert.equal(toggles[0].attributes.checked, String(checked));
  assert.equal(toggles[0].attributes.enabled, 'true'); // ready and !background.pending
  assert.equal(own.filter(node => node.attributes.text === message).length, 1);
  assert.equal(own.filter(node => /偏好保存失败|释放未确认|后台任务未获准/.test(node.attributes.text)).length, 0);
}
const granted = '系统已授予蓝牙后台任务 · 锁屏表现待实测';
background('connection058-original-background.json', true, granted);
background('connection058-background-off-settled.json', false, '后台保持已关闭');
background('connection058-restored-background-0.json', true, granted);
// This is a fixed native preferences snapshot, not an arbitrary XML importer.
// Reject declarations and unknown entities; never expose its device fields.
const prefsFile = path.join(privateDir, 'connection058-restored-connection-prefs');
assert.ok(fs.statSync(prefsFile).size <= 8192);
const xml = fs.readFileSync(prefsFile, 'utf8');
assert.doesNotMatch(xml, /<!DOCTYPE|<!ENTITY/i);
const values = [...xml.matchAll(/<string\s+key="verified_glasses">([^<]*)<\/string>/g)];
assert.equal(values.length, 1);
const entities = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const prefs = JSON.parse(values[0][1].replace(/&([^;]+);/g, (_, key) => {
  assert.ok(Object.hasOwn(entities, key), 'unexpected native XML entity');
  return entities[key];
}));
assert.equal(prefs.backgroundEnabled, true);
assert.equal(prefs.autoConnect, true);
const queue = json(path.join(privateDir, 'connection058-install-asr-state.json'));
assert.ok(queue.jobs.length > 0);
assert.ok(queue.jobs.every(job => job.status === 'succeeded'));
const report = {
  kind: 'native_capture_connection_state', version: '0.1.58', version_code: 10058,
  at: new Date().toISOString(), build_run: runId, compiler_succeeded: true,
  dependency_fallback_used: status.fallbackUsed,
  signed_hap_bytes: fs.statSync(hap).size, signed_hap_sha256: digest(hap), sources,
  source_manifest_sha256: digest(path.join(run, 'source-hashes.json')),
  experiment: 'Normal Journal and Recording UI; temporary background-task opt-out then Home/resume; no force-stop, refresh or capture button input during transition.',
  journal: transition('journal', ['开启全天智记', '开始录音'], '○ 未开启'),
  recording: transition('recording', ['在眼镜开始录音'], '○ 待命'),
  background_runtime_grant_restored: true, persisted_background_preference_restored: true,
  auto_connect_preference_preserved: true,
  baseline_057_attempt: 'Navigation completed after ready; initial-state evidence only, not a reproduced transition.',
  validation_boundary: 'Connection-driven button gating only; does not prove recording audio, every mutual-exclusion state, eight-hour background operation, or all firmware features.',
  private_raw_layouts_or_credentials_published: false
};
fs.writeFileSync(path.join(phase, 'connection058-native-device-2026-10-14.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ version: report.version, journal_transition: true, recording_transition: true, preferences_restored: true }));
