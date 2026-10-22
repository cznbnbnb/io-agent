import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';

const root=process.cwd();
const phase=path.join(root,'rebuild/phase1');
const priv=path.join(phase,'device-private/manuscript068-evidence');
const read=(p)=>JSON.parse(fs.readFileSync(p,'utf8').replace(/^\uFEFF/,''));
const ledger=(name)=>read(path.join(priv,name));
const sha=(p)=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const freeze=read(path.join(phase,'manuscript068-build-2026-10-14.json'));
const manifest=read(path.join(phase,'candidate-runs',freeze.run_id,'source-hashes.json'));
assert.equal(freeze.version_code,10068);
assert(freeze.compile_succeeded&&freeze.dependency_succeeded&&!freeze.fallback_used);
assert.equal(sha(path.join(phase,'candidate-runs',freeze.run_id,'source-hashes.json')),freeze.source_manifest_sha256);
const seen=new Set();
for(const item of manifest){
 assert(/^(core-probe|harmony-sdk)\//.test(item.path)&&!item.path.split('/').some(v=>v==='.'||v==='..')&&!item.path.includes('\\'));
 assert(!seen.has(item.path));seen.add(item.path);
 assert.equal(sha(path.join(root,'rebuild',item.path)),item.sha256.toLowerCase(),item.path);
}
assert.equal(manifest.length,754);
assert.equal(sha(path.join(root,freeze.signed_hap)),freeze.signed_hap_sha256);
const testLog=fs.readFileSync(path.join(phase,'manuscript068-full-app.log'),'utf8');
assert(/^# pass 882\r?$/m.test(testLog)&&/^# fail 0\r?$/m.test(testLog));
const choice=ledger('choice-feedback-ledger.json');
for(const key of ['fresh_empty_editor','fresh_note_kept','choice_fields_exact','choice_note_kept','archive_bytes_unchanged'])assert.equal(choice[key],true,key);
const nativeNoops=fs.readFileSync(path.join(priv,'choice-hilog-private.log'),'utf8').split(/\r?\n/).filter(v=>v.includes(` ${choice.pid} `)&&/manuscript-noop field=(title|text) note-kept=true/.test(v));
assert(nativeNoops.length>=choice.identical_native_callback_metadata_count&&nativeNoops.length>0);
const cancel=ledger('import-cancel-ledger.json'),dirty=ledger('dirty-cancel-import-ledger.json');
assert(cancel.system_selector_cancelled&&cancel.original_title_and_body_exact&&cancel.cancel_note_kept&&cancel.archive_bytes_unchanged);
assert(dirty.exact_confirmation&&dirty.draft_preserved&&dirty.note_kept&&dirty.archive_bytes_unchanged);
const txt=ledger('valid-import-txt-ledger.json'),md=ledger('valid-importmd_repeat-ledger.json');
assert(txt.filename.endsWith('.txt')&&md.filename.endsWith('.md'));
for(const item of [txt,md]){
 for(const key of ['system_done_confirmed','utf8_import_fields_exact','chinese_and_newlines_exact','import_note_kept','new_draft_save_button_verified','archive_bytes_unchanged','explicit_save_not_performed'])assert.equal(item[key],true,key);
 assert.equal(item.selected_files,1);assert.equal(item.expected_utf8_bytes,72);
 assert.equal(item.expected_text_sha256,'7dd6081d68b2c3e38447f1ebcbe9ad584641b4f0dee02349ab8e7b79568eef9b');
}
assert.equal(sha(path.join(priv,'expected-importmd_repeat.md')),md.expected_text_sha256);
assert.equal(sha(path.join(priv,'expected-txt-import.txt')),txt.expected_text_sha256);
assert.equal(sha(path.join(priv,'workspace-before-txt-import.xml')),sha(path.join(priv,'workspace-after-valid-txt-import.xml')));
assert.equal(sha(path.join(priv,'workspace-md-repeat-before.xml')),sha(path.join(priv,'workspace-after-valid-importmd_repeat.xml')));
const cleanup=ledger('cleanup-ledger.json'),cold=ledger('cold-ledger.json');
assert(cleanup.only_owned_fixture_deleted&&cleanup.original_workspace_json_exactly_restored&&cleanup.imported_draft_preserved);
assert(cold.original_workspace_json_exact&&cold.owned_fixture_absent&&cold.pid_before!==cold.pid_after&&cold.version_code===10068);
assert.equal(fs.readFileSync(path.join(priv,'workspace-before-fixture.json'),'utf8'),fs.readFileSync(path.join(priv,'workspace-final-cold.json'),'utf8'));
const retention=ledger('retention-ledger.json'),installed=ledger('install-ledger.json');
for(const key of ['canonical','audio','original_asr']){
 assert.equal(sha(path.join(priv,`final-${key}.bin`)),installed.retained_hashes[key]);
 assert.equal(retention.bytes_unchanged[key],true);
}
const oldBox=read(path.join(priv,'before-outbox.bin')),newBox=read(path.join(priv,'final-outbox.bin'));
const newById=new Map(newBox.rows.map(v=>[v.queue_id,v]));
assert.equal(newById.size,newBox.rows.length);
for(const row of oldBox.rows)assert.deepEqual(newById.get(row.queue_id),row);
assert.deepEqual(newBox.principal,oldBox.principal);
const oldIds=new Set(oldBox.rows.map(v=>v.queue_id)),added=newBox.rows.filter(v=>!oldIds.has(v.queue_id));
assert.equal(added.length,2);
for(const row of added){assert.equal(row.material_id,'mat-recording-8e18c42def9fd7c2561ff811d1aadef4');assert.equal(row.state,'server_stored');}
assert.deepEqual(added.map(v=>v.revision).sort(),[1,2]);
const report={
 schema_version:1,version:freeze.version,version_code:10068,build_run:freeze.run_id,
 compile_succeeded:true,sign_hap_sha256:freeze.signed_hap_sha256,host_tests:{pass:882,fail:0},
 checkout_frozen_sources_verified:manifest.length,
 current_stage_full_match:false,current_stage_discrepancy:['core-probe/Vendor/opus-1.5.2/ChangeLog','core-probe/Vendor/opus-1.5.2/NEWS'],
 stage_note:'Original compile/sign freeze passed. Current temporary stage path-set check failed on these missing files; no old stage repaired. Next build requires fresh stage.',
 native:{same_value_binding_feedback_retained:true,metadata_noop_events:choice.identical_native_callback_metadata_count,
  file_selection_cancel_preserves_draft:true,dirty_replace_cancel_preserves_draft:true,
  txt_valid_import:true,md_valid_import:true,chinese_and_newlines_exact:true,imported_utf8_bytes:72,
  file_import_explicit_save_not_performed:true,only_owned_fixture_deleted:true,
  original_workspace_json_restored_and_cold_read:true,original_entries:5,original_todos:0,
  original_audio_asr_and_revision10_hashes_unchanged:true,
  old_outbox_rows_exactly_preserved:oldBox.rows.length,new_recording_receipts:added.map(v=>({revision:v.revision,state:v.state,server_commit_seq:v.server_commit_seq}))},
 open:['invalid/large-file native failures','EPUB','complete BASE-08 including speech follow and readable glass manuscript list','official background parity','IME original mode restoration unconfirmed'],
 failure_history:['filename IME composition and automatic lock interrupted test scaffolding; no unverified save',
  'initial suffix syntax reused TXT snapshot names; TXT copies retained, MD repeated under independent suffix',
  'owned cleanup succeeded before expected-file-name verification failed; resumed read-only, no second delete',
  'cold stop succeeded before command PSScriptRoot error; resumed launch only, no second stop',
  'sandbox TEMP was not host build TEMP; host stage missing two files; checkout/HAP independently revalidated'],
 full_base_accepted:false,excel_changed:false
};
fs.writeFileSync(path.join(phase,'manuscript068-native-device-2026-10-14.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({version:report.version,md_import:true,txt_import:true,original_entries:5,cold_read:true,source_files:manifest.length,full_base_accepted:false}));
