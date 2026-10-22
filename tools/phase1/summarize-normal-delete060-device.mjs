// Read frozen build, actual native/HDC/CLI evidence; publish whitelist metadata.
// No network, credentials, user material bodies or simulated device replies.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
const root=process.cwd(), phase=path.join(root,'rebuild/phase1'), privateDir=path.join(phase,'device-private');
const read=file=>fs.readFileSync(file,'utf8').replace(/^\uFEFF/,'');
const json=file=>JSON.parse(read(file));
const priv=name=>json(path.join(privateDir,name));
const sha=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const runId='20261014-061727310-3940c2a4', run=path.join(phase,'candidate-runs',runId);
const status=json(path.join(run,'status.json')), sourceManifest=json(path.join(run,'source-hashes.json'));
assert.equal(status.phase,'complete');assert.equal(status.versionCode,10060);assert.equal(status.compileSucceeded,true);assert.equal(status.fallbackUsed,false);
assert.equal(sha(path.join(run,'source-hashes.json')),status.sourceHashManifestSha256.toLowerCase());
const sourceNames=['AppScope/app.json5','entry/src/main/ets/pages/JournalPanel.ets','entry/src/main/ets/pages/RecordingPanel.ets','tests/journal-deletion-page.test.mjs','tests/recording-deletion-page.test.mjs'];
const sources=sourceNames.map(name=>{
 const relative='harmony-sdk/'+name, row=sourceManifest.find(item=>item.path===relative);assert.ok(row);
 const digest=sha(path.join(root,'rebuild',relative));assert.equal(digest,row.sha256.toLowerCase(),'source changed after build');return {path:relative,sha256:digest};
});
const hap=path.join(phase,'artifacts/entry-default-signed-0.1.60.hap');
assert.equal(sha(hap),'0652d8a38f8503bf197b373b7ba98ef2bde30c635243ed48f0a009328fc24cca');
assert.match(read(path.join(phase,'normal-delete-app-regression-frozen-2026-10-14.log')),/# tests 783\s+# suites 0\s+# pass 783\s+# fail 0\s+# cancelled 0\s+# skipped 0/);
assert.match(read(path.join(privateDir,'delete060-install.log')),/install bundle successfully/);
const installed=read(path.join(privateDir,'delete060-bundle-after.json'));
assert.match(installed,/"versionName"\s*:\s*"0\.1\.60"/);assert.match(installed,/"versionCode"\s*:\s*10060/);
const installation=priv('delete060-install-ledger.json');
assert.equal(installation.version,'0.1.60');assert.equal(installation.capture_idle,true);assert.equal(installation.asr_idle,true);assert.equal(installation.replace_install,true);
assert.notEqual(installation.pid_before,installation.pid_after);assert.equal(installation.hap_sha256,sha(hap));
function own(name){
 const all=[], walk=node=>{all.push(node);for(const child of node.children??[])walk(child);};walk(priv(name));
 const roots=all.filter(n=>n.attributes.type==='root'&&n.attributes.focused==='true'&&n.attributes.bundleName);
 assert.equal(roots.length,1);assert.equal(roots[0].attributes.bundleName,'org.turboio.harmony.research');assert.equal(roots[0].attributes.pagePath,'pages/Index');
 const nodes=all.filter(n=>n.attributes.hostWindowId===roots[0].attributes.hostWindowId&&n.attributes.visible==='true');
 assert.equal(nodes.filter(n=>n.attributes.text==='TURBO IO').length,1);return nodes;
}
const text=(nodes,value)=>nodes.filter(n=>n.attributes.type==='Text'&&n.attributes.text===value);
function caseEvidence(version, oldTextVisible){
 const base=path.join(privateDir,'normal-delete-'+version+'-fixture'), get=name=>json(path.join(base,name));
 const m=get('manifest.json');assert.equal(m.synthetic,true);assert.match(m.segment_name,/^seg-[0-9a-f]{32}$/);
 assert.equal(m.material_id,'mat-lifelog-'+m.segment_name.slice(4));assert.equal(m.marker,'NORMAL-DELETE-SYNTHETIC-'+m.segment_name.slice(4));
 const publish=get('publish-ledger.json');assert.equal(publish.synthetic,true);assert.equal(publish.material_id,m.material_id);
 if(version==='059'){
  const idle=own(publish.capture_idle_layout);assert.equal(text(idle,'○ 未开启').length,1);
  assert.equal(idle.filter(n=>n.attributes.type==='Button'&&n.attributes.text==='开始录音'&&n.attributes.enabled==='true').length,1);
  const asr=get(publish.asr_idle_readback);assert.equal(asr.schema_version,1);assert.ok(asr.jobs.every(job=>['succeeded','failed','cancelled'].includes(job.status)));
  assert.equal(publish.source_files_byte_verified,3);assert.equal(publish.app_absent_before_directory_transfer,true);assert.equal(publish.app_absent_before_and_after_readback,true);
 }else{
  assert.equal(publish.capture_idle,true);assert.equal(publish.asr_idle,true);assert.equal(publish.complete_source_bytes_verified,3);assert.equal(publish.app_cold_during_transfer,true);
 }
 assert.equal(publish.canonical_or_outbox_written_by_driver,false);
 for(const [name,expected] of Object.entries(m.files)){assert.equal(sha(path.join(base,'phone-'+name)),expected.sha256);assert.equal(fs.statSync(path.join(base,'phone-'+name)).size,expected.bytes);}
 const prefix='normal-delete-'+version+'-fixture-';
 assert.equal(own(prefix+'view-selected.json').filter(n=>n.attributes.type==='Text'&&String(n.attributes.text).includes(m.marker)).length,1);
 const result=own(prefix+'delete-result.json');
 assert.equal(result.some(n=>n.attributes.type==='Text'&&String(n.attributes.text).includes(m.marker)),oldTextVisible);
 for(const suffix of ['', '-after-cold']){
  const deleted=get('phone-delete-r2'+suffix+'.json');assert.equal(deleted.material_id,m.material_id);assert.equal(deleted.revision,2);assert.equal(deleted.operation,'delete');assert.equal(deleted.text,'');
  assert.match(read(path.join(base,suffix?'phone-source-after-cold.log':'phone-source-after-delete.log')),/No such file or directory/);
 }
 assert.equal(sha(path.join(base,'phone-delete-r2.json')),sha(path.join(base,'phone-delete-r2-after-cold.json')));
 const before=get('cloud-before-get.json');assert.equal(before.exit_code,0);assert.equal(before.reply.ok,true);
 assert.equal(before.reply.items.length,1);const previous=before.reply.items[0];assert.equal(previous.body.material_id,m.material_id);assert.equal(previous.body.revision,1);assert.equal(previous.body.operation,'upsert');assert.ok(previous.body.full_text.text.includes(m.marker));
 const outbox=get('phone-outbox-after-stored.json'), rows=outbox.rows.filter(row=>row.material_id===m.material_id);
 assert.deepEqual(rows.map(row=>row.revision).sort(),[1,2]);
 for(const row of rows){assert.equal(row.state,'server_stored');assert.ok(row.receipt_id);assert.equal(row.last_error,'');}
 const deletion=rows.find(row=>row.revision===2), payload=get('phone-delete-payload.json');
 assert.equal(sha(path.join(base,'phone-delete-payload.json')),deletion.payload_hash);assert.equal(payload.event_id,deletion.event_id);
 let item;
 for(const queryPhase of ['after','after-cold']){
  const latest=get('cloud-'+queryPhase+'-get.json');assert.equal(latest.exit_code,1);assert.equal(latest.reply.ok,false);assert.equal(latest.reply.error.code,'MATERIAL_DELETED');assert.equal(latest.reply.error.status,410);
  const changes=get('cloud-'+queryPhase+'-changes.json');assert.equal(changes.exit_code,0);assert.equal(changes.reply.ok,true);assert.equal(changes.reply.has_more,false);
  const deleted=changes.reply.items.filter(row=>row.body.material_id===m.material_id&&row.body.operation==='delete');assert.equal(deleted.length,1);
  const next=deleted[0];assert.equal(next.withdrawn,true);assert.deepEqual(next.matches,[]);assert.equal(next.body.full_text.text,'');assert.deepEqual(next.body.utterances,[]);assert.deepEqual(next.body.speakers??[],[]);
  assert.equal(next.body.revision,2);assert.equal(next.commit_seq,deletion.server_commit_seq);assert.deepEqual(next.body,payload.body);
  if(item)assert.deepEqual(next,item);item=next;
 }
 return {installed_page_version:'0.1.'+version.slice(1),synthetic:true,material_id:m.material_id,source_kind:'offline TTS plus synthetic text; no glasses microphone or real ASR',source_files_verified:3,normal_selected_text_visible_before:true,old_selected_text_visible_after:oldTextVisible,local_delete_revision:2,source_directory_removed:true,upsert_commit_seq:previous.commit_seq,delete_commit_seq:item.commit_seq,receipt_id:deletion.receipt_id,phone_payload_sha256:deletion.payload_hash,actual_phone_payload_equals_cloud_delete:true,latest_get_status:410,withdrawn_increment:true,cold_tombstone_and_cloud_unchanged:true};
}
const baseline=caseEvidence('059',true), fixed=caseEvidence('060',false);
const recoveryError=own('delete059-config-entry.json');
assert.equal(text(recoveryError,'同步配置暂不可读，请解锁后重试；未覆盖已保存配置').length,1);
const settings=own('delete059-sync-settings-bottom.json');
const toggle=settings.filter(n=>n.attributes.type==='Toggle');assert.equal(toggle.length,1);assert.equal(toggle[0].attributes.checked,'true');
const password=settings.filter(n=>n.attributes.type==='TextInput'&&n.attributes.hint==='更换手机凭据（留空保留现有凭据）');assert.equal(password.length,1);assert.equal(password[0].attributes.text,'');
const beforeRecovery=json(path.join(privateDir,'normal-delete-059-fixture/cloud-after-initial-read-before-discovery.json'));
assert.equal(beforeRecovery.reply.ok,true);assert.equal(beforeRecovery.reply.items[0].body.revision,1);
const resumed=own('delete059-recover-foreground-after.json');assert.equal(resumed.filter(n=>n.attributes.type==='Button'&&n.attributes.text==='立即同步'&&n.attributes.enabled==='true').length,1);
const cold=priv('delete060-cold-ledger.json');assert.equal(cold.version,'0.1.60');assert.notEqual(cold.pid_before,cold.pid_after);
for(const flag of ['capture_idle','asr_idle','old_process_absent_after_stop','outbox_bytes_unchanged'])assert.equal(cold[flag],true);
assert.equal(sha(path.join(privateDir,'delete060-cold-outbox-before.json')),sha(path.join(privateDir,'delete060-cold-outbox-after.json')));
const prior=json(path.join(phase,'material059-native-cloud-2026-10-14.json'));
for(const key of ['revision','audio','asr']){assert.equal(sha(path.join(privateDir,'delete060-retained-'+key+'.bin')),prior.original_hashes_preserved[key]);assert.equal(cold.retained_original_hashes[key],prior.original_hashes_preserved[key]);}
const report={kind:'normal_journal_delete_native_phone_cloud',at:new Date().toISOString(),version:'0.1.60',version_code:10060,build_run:runId,source_manifest_sha256:status.sourceHashManifestSha256.toLowerCase(),sources,signed_hap_bytes:fs.statSync(hap).size,signed_hap_sha256:sha(hap),compiler_succeeded:true,dependency_fallback_used:false,full_app_component_regression_passed:783,new_deletion_page_component_tests:23,normal_phone_installed:true,baseline,fixed,cold_receipt_bytes_unchanged:true,retained_original_hashes_preserved:cold.retained_original_hashes,observed_vault_recovery:{persistent_enabled:true,persistent_credential_readable_after_unlock:true,settings_not_resaved:true,automatic_retry_within_same_foreground:false,recovered_after_manual_foreground:true},validation_boundary:'Normal phone Journal deletion to local tombstone, app-generated HTTPS payload, server stored receipt, real query CLI 410/withdrawn and cold persistence; synthetic source only.',not_verified:['RecordingPanel independent native deletion','automatic vault retry fix','real ASR or glasses microphone capture in these fixtures','Agent receive or task complete','full PRD acceptance','background eight-hour reliability and power'],private_credentials_raw_layouts_or_user_materials_published:false};
report.observed_vault_recovery.evidence_basis='UI/CLI state assertions plus operator-observed Home/Entry sequence and baseline Service source inspection; no complete input event ledger';
report.observed_vault_recovery.automatic_retry_fix_verified=false;
fs.writeFileSync(path.join(phase,'normal-delete060-native-cloud-2026-10-14.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({version:report.version,normal_journal_deleted_text_cleared:true,phone_to_cloud_delete:true,cold_delete_persisted:true,originals_preserved:true,automatic_vault_retry_not_yet_fixed:true}));
