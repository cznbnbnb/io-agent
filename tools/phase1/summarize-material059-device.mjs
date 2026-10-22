// Read actual private native/CLI evidence and publish only a restricted result.
// No HTTP, credentials, user transcripts, mutations or simulated phone replies.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';

const root = process.cwd(), phase = path.join(root, 'rebuild/phase1');
const privateDir = path.join(phase, 'device-private');
const read = file => fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
const json = file => JSON.parse(read(file));
const privateJson = name => json(path.join(privateDir, name));
const sha = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const mid = 'mat-lifelog-042bb7365e004cbb837949173a59f754';
const runId = '20261014-031846465-6da8f85e';
const run = path.join(phase, 'candidate-runs', runId);
const status = json(path.join(run, 'status.json'));
assert.equal(status.phase, 'complete');
assert.equal(status.versionCode, 10059);
assert.equal(status.compileSucceeded, true);
assert.equal(sha(path.join(run, 'source-hashes.json')), status.sourceHashManifestSha256.toLowerCase());
const manifest = json(path.join(run, 'source-hashes.json'));
const sourceNames = ['AppScope/app.json5', 'entry/src/main/ets/MaterialSyncImport.ets',
  'entry/src/main/ets/MaterialSyncTransport.ets', 'entry/src/main/ets/pages/MaterialSyncPanel.ets',
  'tests/load-app.mjs', 'tests/material-sync-import.test.mjs',
  'tests/material-sync-identity-preflight.test.mjs', 'tests/material-sync-panel.test.mjs'];
const sources = sourceNames.map(name => {
  const relative = `harmony-sdk/${name}`, row = manifest.find(item => item.path === relative);
  assert.ok(row, 'source absent from compiler manifest');
  const digest = sha(path.join(root, 'rebuild', relative));
  assert.equal(digest, row.sha256.toLowerCase(), 'source drift after frozen build');
  return { path: relative, sha256: digest };
});
const hap = path.join(phase, 'artifacts/entry-default-signed-0.1.59.hap');
assert.equal(sha(hap), '786be69354d2d7f344333900cd004696a22f975b0a1e3e50c750b63f9b6799d8');
assert.match(read(path.join(phase, 'material059-device-install-2026-10-14.log')), /install bundle successfully/);
assert.match(read(path.join(privateDir, 'material059-version-readback.json')), /"versionCode": 10059/);
assert.match(read(path.join(phase, 'material-import-app-regression-frozen-2026-10-14.log')), /# pass 760\s+# fail 0/);

function own(name) {
  const all = [];
  const walk = node => { all.push(node); for (const child of node.children ?? []) walk(child); };
  walk(privateJson(name));
  const roots = all.filter(node => node.attributes.type === 'root' && node.attributes.focused === 'true' && node.attributes.bundleName);
  assert.equal(roots.length, 1);
  assert.equal(roots[0].attributes.bundleName, 'org.turboio.harmony.research');
  assert.equal(roots[0].attributes.pagePath, 'pages/Index');
  const visible = all.filter(node => node.attributes.hostWindowId === roots[0].attributes.hostWindowId && node.attributes.visible === 'true');
  assert.equal(visible.filter(node => node.attributes.text === 'TURBO IO').length, 1);
  return visible;
}
function row(nodes, type, text) {
  const found = nodes.filter(node => node.attributes.type === type && node.attributes.text === text);
  assert.equal(found.length, 1, 'expected own native control not unique');
  return found[0];
}
function input(nodes, hint, expected) {
  const found = nodes.filter(node => node.attributes.type === 'TextInput' && node.attributes.hint === hint);
  assert.equal(found.length, 1);
  assert.equal(found[0].attributes.text, expected);
}
function syncSwitch(nodes) {
  const label = row(nodes, 'Text', '同步文字（保存后生效）');
  const ancestors = nodes.filter(node => node.attributes.type === 'Row' && label.attributes.hierarchy.startsWith(node.attributes.hierarchy + ','))
    .sort((a, b) => b.attributes.hierarchy.length - a.attributes.hierarchy.length);
  assert.ok(ancestors.length);
  const toggles = nodes.filter(node => node.attributes.type === 'Toggle' && node.attributes.hierarchy.startsWith(ancestors[0].attributes.hierarchy + ','));
  assert.equal(toggles.length, 1);
  return toggles[0].attributes.checked === 'true';
}

const invalid = own('material059-invalid-import-final.json');
row(invalid, 'Text', '连接文件格式不正确，未保存配置');
assert.equal(syncSwitch(invalid), false);
assert.equal(sha(path.join(privateDir, 'material059-invalid-still-pending.json')), sha(path.join(privateDir, 'material059-invalid-connection.json')));
const proposed = own('material059-valid-import-confirmed-unsaved.json');
input(proposed, 'HTTPS API 地址（以 /v1 结尾）', 'https://cznbnb.cn/io-api/v1');
input(proposed, '资料所有者 owner_id', 'turboio-user');
input(proposed, '本手机 producer_id', 'phone-harmony');
input(proposed, '服务器 server_id', '80384449-a5c6-4630-bf1b-524a30454c92');
input(proposed, '更换手机凭据（留空保留现有凭据）', '');
assert.equal(syncSwitch(proposed), false);
for (const name of ['material059-cloud-r10-before.json', 'material059-cloud-r10-after-import-before-save.json']) {
  const value = privateJson(name);
  assert.equal(value.ok, false); assert.equal(value.error.code, 'MATERIAL_NOT_FOUND');
}
const beforeSave = own('material059-enable-before-save.json');
assert.equal(syncSwitch(beforeSave), true);
const accepted = own('material059-save-result-4.json');
row(accepted, 'Text', '文字同步已开启，返回前台时继续积压');
const header = own('material059-post-sync-header.json');
row(header, 'Text', '前台同步');
row(header, 'Text', '待同步 0 · 已存文字版本 28 · 需处理 0');

const state = privateJson('material059-outbox-first.json');
assert.deepEqual(state.principal, { ownerId: 'turboio-user', producerId: 'phone-harmony', serverId: '80384449-a5c6-4630-bf1b-524a30454c92' });
const rows = state.rows.filter(item => item.material_id === mid).sort((a, b) => a.revision - b.revision);
assert.deepEqual(rows.map(item => item.revision), Array.from({ length: 10 }, (_, i) => i + 1));
assert.ok(rows.every(item => item.state === 'server_stored' && item.receipt_id && item.server_commit_seq > 0 && item.last_error === ''));
const envelopeFile = path.join(privateDir, 'material059-phone-r10-envelope.json');
assert.equal(sha(envelopeFile), rows[9].payload_hash);
assert.equal(fs.statSync(envelopeFile).size, rows[9].payload_bytes);
const envelope = json(envelopeFile);
assert.equal(envelope.schema_version, '1.2'); assert.equal(envelope.producer_id, 'phone-harmony');
const cloud = privateJson('material059-cloud-r10-first.json');
assert.equal(cloud.ok, true); assert.equal(cloud.items.length, 1);
const item = cloud.items[0];
assert.equal(item.schema_version, '1.2'); assert.deepEqual(item.body, envelope.body);
assert.equal(item.commit_seq, rows[9].server_commit_seq);
assert.equal(item.source_ref.material_id, mid); assert.equal(item.source_ref.revision, 10); assert.equal(item.source_ref.text_revision, 9);
assert.equal(item.evidence.audio_playback_available, false);
assert.equal(item.body.speakers.length, 1);
assert.equal(item.body.speakers[0].label, '我'); assert.equal(item.body.speakers[0].is_self, true);
assert.equal(item.body.speakers[0].label_basis, 'user_confirmed');
assert.equal(item.body.utterances.length, 2);
const parent = privateJson('material059-cloud-parent-r5.json');
assert.equal(parent.ok, true); assert.equal(parent.items[0].body.revision, 5);
for (const child of item.body.utterances) {
  assert.equal(child.start_ms, null); assert.equal(child.end_ms, null);
  assert.equal(child.source_range.parent_revision, 5);
  const origin = parent.items[0].body.utterances.find(utterance => utterance.utterance_id === child.source_range.parent_utterance_id);
  assert.ok(origin); assert.equal(origin.text.slice(child.source_range.text_start, child.source_range.text_end), child.text);
  assert.equal(child.source_range.start_ms, origin.start_ms); assert.equal(child.source_range.end_ms, origin.end_ms);
  const match = item.matches.find(match => match.source_ref.utterance_id === child.utterance_id);
  assert.ok(match); assert.equal(match.source_ref.start_ms, null); assert.equal(match.source_ref.end_ms, null);
  assert.deepEqual(match.source_ref.source_range, child.source_range);
  assert.equal(match.source_ref.parent_source_ref.material_id, mid);
  assert.equal(match.source_ref.parent_source_ref.revision, 5);
  assert.equal(match.source_ref.parent_source_ref.utterance_id, origin.utterance_id);
  assert.equal(match.source_ref.parent_source_ref.start_ms, origin.start_ms);
  assert.equal(match.source_ref.parent_source_ref.end_ms, origin.end_ms);
}
const hashes = {
  revision: sha(path.join(privateDir, 'material059-retained-r10.json')),
  audio: sha(path.join(privateDir, 'material059-retained-original-audio.ogg')),
  asr: sha(path.join(privateDir, 'material059-retained-original-asr.json'))
};
assert.equal(hashes.revision, '83248d4c6b50ed750875be3fb52b5907cc0e5d823aaed9d5b5e8d1687bfed6a5');
assert.equal(hashes.audio, 'cd2ba1e3a85dfb445fed45ec8bf5c0d29acd261a579349c9bcedc5462e0477e1');
assert.equal(hashes.asr, '97c7ae1b6e397343cca293a833598a0011edce2751fb7f9f91f17e1169679cc1');
const cold = privateJson('material059-cold-start-ledger.json');
assert.match(cold.pidBefore, /^\d+$/); assert.match(cold.pidAfter, /^\d+$/); assert.notEqual(cold.pidBefore, cold.pidAfter);
assert.equal(cold.oldProcessAbsentAfterStop, true); assert.equal(cold.captureIdle, true); assert.equal(cold.asrIdle, true);
const coldSettings = own('material059-cold-settings-readback.json');
input(coldSettings, '资料所有者 owner_id', 'turboio-user'); input(coldSettings, '本手机 producer_id', 'phone-harmony');
input(coldSettings, '服务器 server_id', '80384449-a5c6-4630-bf1b-524a30454c92');
input(coldSettings, '更换手机凭据（留空保留现有凭据）', '');
assert.equal(sha(path.join(privateDir, 'material059-outbox-after-cold.json')), sha(path.join(privateDir, 'material059-outbox-first.json')));
const afterCold = privateJson('material059-cloud-r10-after-cold.json');
assert.equal(afterCold.ok, true); assert.deepEqual(afterCold.items[0].body, item.body); assert.equal(afterCold.items[0].commit_seq, item.commit_seq);
const issuer = json(path.join(phase, 'formal-material-connection-formal-phone-20261014-0330.json'));
assert.equal(issuer.status, 'ready'); assert.deepEqual(issuer.public_identity.phone.scopes, ['materials:write']);
assert.equal(issuer.tool_sha256, sha(path.join(root, 'tools/phase1/prepare-formal-material-connection.py')));

const report = {
  kind: 'normal_phone_material_connection_and_1_2_sync', at: new Date().toISOString(), version: '0.1.59', version_code: 10059,
  build_run: runId, source_manifest_sha256: sha(path.join(run, 'source-hashes.json')), sources,
  signed_hap_bytes: fs.statSync(hap).size, signed_hap_sha256: sha(hap),
  compiler_succeeded: true, dependency_fallback_used: status.fallbackUsed, full_app_component_regression_passed: 760,
  formal_owner: state.principal.ownerId, formal_producer: state.principal.producerId, server_id: state.principal.serverId,
  credential_expiry_utc: issuer.public_identity.phone.expires_at, phone_scopes: issuer.public_identity.phone.scopes,
  invalid_native_import_rejected: true, failed_import_fixture_retained: true,
  native_phone_identity_preflight: true, import_default_off: true, password_field_empty_after_import_and_cold_load: true,
  cloud_r10_missing_before_explicit_save: true, normal_native_save_enabled: true,
  fixture_synthetic: true, material_id: mid, server_stored_revisions: rows.map(row => ({ revision: row.revision, receipt_id: row.receipt_id, commit_seq: row.server_commit_seq })),
  latest_schema: item.schema_version, latest_revision: item.body.revision, text_revision: item.source_ref.text_revision,
  actual_phone_payload_sha256: sha(envelopeFile), actual_phone_payload_equals_real_query_body: true,
  speaker_dictionary_preserved: true, split_unknown_timing_and_parent_ranges_preserved: true,
  real_query_child_citations_and_parent_references_preserved: true,
  original_hashes_preserved: hashes, audio_playback_available: false,
  normal_sync_stored_version_count: state.rows.filter(row => row.state === 'server_stored').length,
  cold_restart_different_process: true, cold_receipt_bytes_unchanged: true, cold_cloud_body_and_sequence_unchanged: true,
  validation_boundary: 'Real normal phone HTTPS/import/upload/storage/query chain for retained synthetic speaker corrections; explicit per-material self label is synthetic mechanism evidence.',
  not_verified: ['native system picker valid credential selection', 'normal-page network-loss recovery for this new setup', 'automatic credential rotation', 'original audio archive', 'real two-speaker accuracy or automatic self identity', 'eight-hour background/power', 'real Hermes skill calling these formal query credentials'],
  private_credentials_raw_layouts_or_user_materials_published: false
};
fs.writeFileSync(path.join(phase, 'material059-native-cloud-2026-10-14.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ version: report.version, actual_phone_r10_to_query_cli: true, receipt_count: rows.length, cold_restore: true, originals_preserved: true }));
