// Read-only evidence extraction for the explicit 0.1.96 device session.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../',import.meta.url));
const base=path.join(root,'rebuild/phase1/device-private/device096-evidence');
const json=name=>JSON.parse(fs.readFileSync(path.join(base,name),'utf8').replace(/^\uFEFF/,''));
const last=name=>JSON.parse(fs.readFileSync(path.join(base,name),'utf8').trim().split(/\r?\n/).at(-1));
const sha=value=>createHash('sha256').update(value).digest('hex');
const upgrade=json('upgrade.json'),manifest=json('todo-test-manifest.json'),cold=json('todo-cold-summary.json');
const live=last('cli-todo-delete-status-A-1.ndjson'),active=last('cli-todo-cold-active.ndjson'),deleted=last('cli-todo-cold-deletion.ndjson');
assert.equal(upgrade.stage,'upgrade_protection_passed');assert.equal(upgrade.version_before,'0.1.84');assert.equal(upgrade.version_after,'0.1.96');
assert.equal(upgrade.hap_sha256,'3eece069c23df0f2395ab5502d2c140fa93339515021134680613bc1417613fd');
assert.equal(Object.keys(upgrade.protected_bytes_unchanged).length,11);assert(Object.values(upgrade.protected_bytes_unchanged).every(v=>v===true));
assert.equal(manifest.synthetic,true);assert.equal(manifest.human_confirmed_both_visible,true);
assert.equal(live.state,'complete');assert.equal(live.todo_deletion.phase,'submitted');assert.equal(live.todo_deletion.attempts,1);
assert.equal(live.todo_deletion.receipt_success_count,1);assert.equal(live.todo_deletion.receipt_correlation,'unattributed');
assert.equal(active.state,'complete');assert.equal(active.todo_page.todos.length,1);
assert.equal(active.todo_page.todos[0].reference.id,manifest.B.reference.id);
assert.equal(deleted.todo_deletion.operation_id,manifest.operation_id);assert.equal(deleted.todo_deletion.attempts,1);
assert.equal(cold.new_process,true);assert.equal(cold.workspace_bytes_unchanged,true);
const human={before:'A、B 都看到了',after:'A 已消失，B 仍保留'};
const files=['upgrade.json','todo-test-manifest.json','cli-todo-delete-A.ndjson','cli-todo-delete-status-A-1.ndjson','cli-todo-cold-active.ndjson','cli-todo-cold-deletion.ndjson','todo-cold-summary.json','workspace-after-A.xml','workspace-before-cold.xml','workspace-after-cold.xml'];
const report={schema:1,kind:'real_device_upgrade_and_single_todo_delete',at_utc:new Date().toISOString(),
 installed_version:'0.1.96',version_code:10096,hap_sha256:upgrade.hap_sha256,
 offline_source_audit:'rebuild/phase1/scan096-source-audit-offline-2026-10-16.json',
 signed_hap_matches_audit:true,new_process_after_upgrade:upgrade.pid_before!==upgrade.pid_after,
 recording_idle_before_upgrade:true,lifelog_idle_before_upgrade:true,asr_idle_before_upgrade:true,prompter_idle_before_upgrade:true,
 protected_records:upgrade.protected_bytes_unchanged,protected_record_count:11,
 tests_are_explicit_synthetic_todos:true,created_via_normal_phone_page:true,delete_via_cli:true,
 only_A_deleted:true,delete_attempts:1,device_receipt_observed:true,device_receipt_success_count:1,receipt_has_success_id:false,
 human_lens_confirmation:human,online_single_delete_lens_verified:true,
 workspace_schema_after_first_delete:2,legacy_backup_present:true,original_manuscripts_and_conversations_preserved:true,
 cold_restart_new_process:true,cold_workspace_bytes_unchanged:true,cold_A_absent_B_retained:true,cold_delete_attempts_unchanged:true,
 full_todo_query_verified:false,offline_delete_recovery_verified:false,all_BASE_06_accepted:false,
 background_or_power_verified:false,agent_voice_end_to_end_verified:false,two_minute_card_fixed:false,
 excel_changed:false,user_data_deleted:false,
 initial_upgrade_verification_interrupted:true,initial_verification_failure:'PHONE_READ_UNCONFIRMED; no reinstall performed; fresh version and per-file transfer recheck passed',
 raw_private_proofs:files.map(name=>({path:'rebuild/phase1/device-private/device096-evidence/'+name,sha256:sha(fs.readFileSync(path.join(base,name)))}))};
const target=path.join(root,'rebuild/phase1/device096-upgrade-todo-2026-10-16.json');
fs.writeFileSync(target,JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({report:target,installed:report.installed_version,protected:11,online_lens:true,cold_restart:true,BASE_06_accepted:false}));
