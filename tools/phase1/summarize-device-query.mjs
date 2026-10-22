// Preserve a device query result, including a failed product validation.
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../',import.meta.url)),[batch]=process.argv.slice(2);
assert.match(batch??'',/^todo\d{3}$/);const suffix=batch.slice(4),phase=path.join(root,'rebuild/phase1');
const dir=path.join(phase,`device-private/device${suffix}-evidence`);
const read=name=>JSON.parse(fs.readFileSync(path.join(dir,name),'utf8').replace(/^\uFEFF/,''));
const last=name=>JSON.parse(fs.readFileSync(path.join(dir,name),'utf8').trim().split(/\r?\n/).at(-1));
const upgrade=read('upgrade.json'),result=read('first-query-summary.json'),query=last('cli-first-query-status.ndjson').todo_query;
assert.equal(upgrade.stage,'upgrade_protection_passed');assert.equal(Object.keys(upgrade.protected_bytes_unchanged).length,11);
assert(Object.values(upgrade.protected_bytes_unchanged).every(value=>value===true));
assert.equal(result.query_phase,query.phase);assert(['complete','incomplete','error','disconnected'].includes(query.phase));
assert.equal(query.absence_is_confirmation,false);assert.equal(result.delete_attempts,1);
assert.equal(result.synthetic_A_absent,true);assert.equal(result.synthetic_B_retained,true);
if(process.argv[3]==='--page'){
 const page=read('normal-page-query-summary.json'),before=last('cli-page-before.ndjson').todo_query,after=last('cli-page-after.ndjson').todo_query;
 assert.equal(page.query_button_clicked_once,true);assert.equal(page.new_query_id,true);assert.notEqual(before.query_id,after.query_id);
 assert.equal(page.query_phase,'complete');assert.equal(after.phase,'complete');assert.equal(page.complete_summary_visible,true);assert.equal(page.synthetic_B_visible,true);
 assert.equal(page.human_lens_confirmation,false);assert.equal(page.microphone_started,false);assert.equal(page.todos_written,false);
 const names=['normal-page-query-summary.json','cli-page-before.ndjson','cli-page-after.ndjson'];
 const proof={schema:1,kind:'real_device_normal_todo_query_page',at_utc:new Date().toISOString(),installed_version:upgrade.version_after,
  normal_page_button_issued_new_query:true,query_phase:'complete',complete_summary_visible:true,synthetic_B_visible:true,human_lens_confirmation:false,
  initial_navigation_script_used_wrong_tile_label:true,initial_navigation_sent_no_query:true,corrected_tile_label:'待办清单',
  raw_private_proofs:names.map(name=>({path:`rebuild/phase1/device-private/device${suffix}-evidence/${name}`,sha256:createHash('sha256').update(fs.readFileSync(path.join(dir,name))).digest('hex')}))};
 for(const name of ['device100-page-grid-scroll-4.json','device100-page-r2-query-button.json','device100-page-r2-query-after.json']){
  const full=path.join(phase,'device-private',name);assert(fs.existsSync(full));proof.raw_private_proofs.push({path:'rebuild/phase1/device-private/'+name,sha256:createHash('sha256').update(fs.readFileSync(full)).digest('hex')});
 }
 fs.writeFileSync(path.join(phase,`device${suffix}-normal-page-2026-10-16.json`),JSON.stringify(proof,null,2)+'\n',{flag:'wx'});
 console.log(JSON.stringify({version:proof.installed_version,normal_page:true,new_query:true,phase:'complete'}));process.exit(0);
}
if(process.argv[3]==='--shape'){
 const note=result.diagnostic_note;assert.equal(typeof note,'string');assert(note.length<=480);
 const start=note.indexOf('reject=');assert(start>=0);const schema=note.slice(start);
 assert.match(schema,/^[A-Za-z0-9_=;:,\[\]!? -]+$/);assert(schema.includes(';root='));assert(schema.includes(';chunk=[];'));
 const proof={schema:1,kind:'device_query_schema_only_observation',installed_version:upgrade.version_after,at_utc:new Date().toISOString(),
  query_phase:query.phase,schema_keys_and_types:schema,literal_empty_chunk_object_observed:true,
  parser_accepted_known_field_types:true,accumulator_rejected_empty_chunk:true,field_values_saved:false,full_wire_envelope_saved:false,
  first_stdout_encoding_note:'Windows code page affected the Chinese prefix in redirected CLI stdout; this proof uses only the ASCII schema suffix. Subsequent probes use Python UTF8 mode.',
  private_proof:`rebuild/phase1/device-private/device${suffix}-evidence/first-query-summary.json`,
  private_proof_sha256:createHash('sha256').update(fs.readFileSync(path.join(dir,'first-query-summary.json'))).digest('hex')};
 fs.writeFileSync(path.join(phase,`device${suffix}-query-shape-2026-10-16.json`),JSON.stringify(proof,null,2)+'\n',{flag:'wx'});
 console.log(JSON.stringify({version:proof.installed_version,empty_chunk:true,field_values_saved:false}));process.exit(0);
}
const files=['upgrade.json','first-query-summary.json','cli-first-status.ndjson','cli-first-query.ndjson','cli-first-query-status.ndjson','cli-first-active.ndjson','cli-first-deletion.ndjson'];
let cold=null,coldQuery=null;
if(fs.existsSync(path.join(dir,'cold-restart-summary.json'))){
 cold=read('cold-restart-summary.json');coldQuery=read('cold-query-summary.json');
 assert.equal(cold.new_process,true);assert.equal(cold.workspace_bytes_unchanged,true);
 assert.equal(cold.app_data_cleared,false);assert.equal(cold.backup_restored,false);
 assert.equal(coldQuery.query_phase,'complete');assert.equal(coldQuery.synthetic_A_absent,true);assert.equal(coldQuery.synthetic_B_retained,true);
 assert.equal(coldQuery.delete_attempts,1);assert.equal(coldQuery.absence_is_confirmation,false);
 files.push('cold-restart-summary.json','cold-query-summary.json','cli-cold-preflight.ndjson','cli-cold-status.ndjson','cli-cold-query.ndjson','cli-cold-query-status.ndjson','cli-cold-active.ndjson','cli-cold-deletion.ndjson','workspace-before-cold.xml','workspace-after-cold.xml');
}
const readinessFile='cli-cold-status-not-ready.ndjson',initiallyNotReady=fs.existsSync(path.join(dir,readinessFile));
if(initiallyNotReady){assert.equal(last(readinessFile).snapshot.connected,false);files.push(readinessFile);}
for(let i=1;i<=5;i++){const name=`cli-cold-status-wait${i}.ndjson`;if(fs.existsSync(path.join(dir,name)))files.push(name);}
const report={schema:1,kind:'real_device_filtered_todo_query',at_utc:new Date().toISOString(),installed_version:upgrade.version_after,
 version_code:upgrade.code_after,hap_sha256:upgrade.hap_sha256,new_process_after_upgrade:upgrade.pid_before!==upgrade.pid_after,
 protected_records:upgrade.protected_bytes_unchanged,protected_record_count:11,query_phase:query.phase,
 query_batched_observation_verified:query.phase==='complete',batches:query.batches,received:query.received,todo_total:query.todo_total,schedule_total:query.schedule_total,
 reply_after_start_ms:Date.parse(query.completed_at)-Date.parse(query.started_at),
 synthetic_A_absent:true,synthetic_B_retained:true,delete_attempts:1,delete_phase:result.delete_phase,
 absence_is_delete_confirmation:false,wire_batch_shape_captured:false,new_human_lens_confirmation:false,cold_restart_query_tested:cold!==null,
 cold_new_process:cold?.new_process??false,cold_workspace_bytes_unchanged:cold?.workspace_bytes_unchanged??false,
 cold_query_phase:coldQuery?.query_phase??'not_tested',cold_A_absent_B_retained:coldQuery!==null,cold_delete_attempts:coldQuery?.delete_attempts??-1,
 initial_cold_readiness_false_preserved:initiallyNotReady,
 all_BASE_06_accepted:false,voice_or_two_minute_card_verified:false,developer_did_not_edit_excel:true,user_data_deleted:false,
 raw_private_proofs:files.map(name=>({path:`rebuild/phase1/device-private/device${suffix}-evidence/${name}`,
 sha256:createHash('sha256').update(fs.readFileSync(path.join(dir,name))).digest('hex')}))};
fs.writeFileSync(path.join(phase,`device${suffix}-upgrade-query-2026-10-16.json`),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({installed:report.installed_version,protected:11,query:query.phase,reply_ms:report.reply_after_start_ms}));
