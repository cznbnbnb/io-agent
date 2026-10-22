// Extract only bounded, non-content evidence from the actual 0.1.97 session.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../',import.meta.url));
const dir=path.join(root,'rebuild/phase1/device-private/device097-evidence');
const read=name=>JSON.parse(fs.readFileSync(path.join(dir,name),'utf8').replace(/^\uFEFF/,''));
const last=name=>JSON.parse(fs.readFileSync(path.join(dir,name),'utf8').trim().split(/\r?\n/).at(-1));
const upgrade=read('upgrade.json'),query=last('cli-first-todo-query-status.ndjson').todo_query;
const page=last('cli-first-todo-list.ndjson').todo_page;
assert.equal(upgrade.stage,'upgrade_protection_passed');
assert.equal(upgrade.version_before,'0.1.96');assert.equal(upgrade.version_after,'0.1.97');
assert.equal(Object.keys(upgrade.protected_bytes_unchanged).length,11);
assert(Object.values(upgrade.protected_bytes_unchanged).every(value=>value===true));
assert.equal(query.phase,'incomplete');assert.equal(query.batches,0);
assert.equal(page.todos.length,1);assert.equal(page.todos[0].delivery,'confirmed');
const files=['upgrade.json','cli-first-status.ndjson','cli-first-todo-query.ndjson','cli-first-todo-query-status.ndjson','cli-first-todo-list.ndjson'];
const report={schema:1,kind:'real_device_todo_query_filter_partial',at_utc:new Date().toISOString(),
 installed_version:'0.1.97',version_code:10097,hap_sha256:upgrade.hap_sha256,
 new_process_after_upgrade:upgrade.pid_before!==upgrade.pid_after,
 protected_record_count:11,protected_records:upgrade.protected_bytes_unchanged,
 query_event_filter:1,device_type16_received:true,query_phase:query.phase,
 reply_after_start_ms:Date.parse(query.completed_at)-Date.parse(query.started_at),
 retained_complete_batches:query.batches,full_query_verified:false,
 one_previously_created_synthetic_B_retained:true,synthetic_B_metadata_delivery:'confirmed',
 wire_batch_shape_captured:false,absence_is_delete_confirmation:false,
 all_BASE_06_accepted:false,voice_or_two_minute_card_verified:false,
 developer_did_not_edit_excel:true,user_data_deleted:false,
 raw_private_proofs:files.map(name=>({path:'rebuild/phase1/device-private/device097-evidence/'+name,
 sha256:createHash('sha256').update(fs.readFileSync(path.join(dir,name))).digest('hex')}))};
fs.writeFileSync(path.join(root,'rebuild/phase1/device097-upgrade-query-2026-10-16.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({installed:report.installed_version,protected:11,query:query.phase,reply_ms:report.reply_after_start_ms}));
