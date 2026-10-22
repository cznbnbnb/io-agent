// Reconcile actual normal-page/HDC/public CLI evidence; publish metadata only.
// No phone, network, credential or source mutation.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
const root=process.cwd(),phase=path.join(root,'rebuild/phase1'),priv=path.join(phase,'device-private');
const dir=path.join(priv,'recording-delete063-fixture');
const read=file=>fs.readFileSync(file,'utf8').replace(/^\uFEFF/,'');
const json=file=>JSON.parse(read(file));
const sha=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const fixture=json(path.join(dir,'fixture.json')),get=name=>json(path.join(dir,name));
assert.equal(fixture.synthetic,true);assert.match(fixture.take_name,/^take-[a-f0-9]{32}$/);
assert.equal(fixture.material_id,'mat-recording-'+fixture.take_name.slice(5));
assert.equal(fixture.marker,'RECORDING-DELETE-SYNTHETIC-'+fixture.take_name.slice(5));
const runId='20261014-082906559-0f8eeab2',run=path.join(phase,'candidate-runs',runId);
const status=json(path.join(run,'status.json')),manifest=json(path.join(run,'source-hashes.json'));
assert.equal(status.phase,'complete');assert.equal(status.versionCode,10063);assert.equal(status.fallbackUsed,false);
assert.equal(sha(path.join(run,'source-hashes.json')),status.sourceHashManifestSha256.toLowerCase());
const sourceNames=['AppScope/app.json5','entry/src/main/ets/pages/RecordingPanel.ets','entry/src/main/ets/RecordingSession.ets',
 'entry/src/main/ets/RecordingService.ets','entry/src/main/ets/MaterialStore.ets','entry/src/main/ets/MaterialOutbox.ets',
 'entry/src/main/ets/MaterialSyncService.ets','tests/recording-deletion-page.test.mjs'];
const sources=sourceNames.map(name=>{
 const relative='harmony-sdk/'+name,row=manifest.find(item=>item.path===relative);assert(row);
 const digest=sha(path.join(root,'rebuild',relative));assert.equal(digest,row.sha256.toLowerCase());return {path:relative,sha256:digest};
});
const hap=path.join(phase,'artifacts/entry-default-signed-0.1.63.hap');
assert.equal(sha(hap),'141192e16597faba9ad9e5e69d63f0a8f372f7c89bed353d57d47ed17f7d90ec');
const bundleText=read(path.join(priv,'recording-delete-baseline-bundle.json'));
const bundle=JSON.parse(bundleText.slice(bundleText.indexOf('{'),bundleText.lastIndexOf('}')+1));
assert.equal(bundle.applicationInfo.versionName,'0.1.63');assert.equal(bundle.applicationInfo.versionCode,10063);
function own(name,visible=true){
 const all=[],walk=n=>{all.push(n);for(const child of n.children??[])walk(child);};walk(json(path.join(priv,name)));
 const roots=all.filter(n=>n.attributes.type==='root'&&n.attributes.focused==='true'&&n.attributes.bundleName);
 assert.equal(roots.length,1);assert.equal(roots[0].attributes.bundleName,'org.turboio.harmony.research');assert.equal(roots[0].attributes.pagePath,'pages/Index');
 return all.filter(n=>n.attributes.hostWindowId===roots[0].attributes.hostWindowId&&(!visible||n.attributes.visible==='true'));
}
const has=(nodes,text)=>nodes.filter(n=>n.attributes.type==='Text'&&n.attributes.text===text);
const marker=(nodes)=>nodes.filter(n=>n.attributes.type==='Text'&&String(n.attributes.text).includes(fixture.marker));
assert.equal(has(own('recording-delete-publish-recording-idle.json'),'○ 待命').length,1);
assert.equal(has(own('recording-delete-publish-capture-idle.json'),'○ 未开启').length,1);
const publish=get('publish-ledger.json');assert.equal(publish.capture_idle,true);assert.equal(publish.asr_idle,true);
assert.equal(publish.source_files_byte_verified,4);assert.equal(publish.app_cold_during_transfer,true);assert.equal(publish.canonical_or_outbox_written_by_driver,false);
assert.notEqual(publish.pid_before,publish.pid_after);
for(const [name,expected]of Object.entries(fixture.files)){
 assert.equal(sha(path.join(dir,fixture.take_name,name)),expected.sha256);
 assert.equal(sha(path.join(dir,'phone-'+name)),expected.sha256);
 assert.equal(sha(path.join(dir,'after-cancel-'+name)),expected.sha256);
}
assert.equal(marker(own('recording-delete-view-selected.json')).length,1);
assert.equal(marker(own('recording-delete-cancel-result.json')).length,1);
assert.equal(marker(own('recording-delete-delete-result.json',false)).length,0);
for(const action of ['cancel','delete'])assert.equal(has(own('recording-delete-'+action+'-dialog.json'),'删除这条录音？').length,1);
const before=get('phone-r1-before-cancel.json');assert.equal(before.material_id,fixture.material_id);assert.equal(before.operation,'upsert');assert.equal(before.revision,1);
assert.equal(before.source.kind,'recording');assert.equal(before.source.started,fixture.created);assert.equal(before.source.complete,true);assert.equal(before.source.audioBytes,710880);
assert(before.text.includes(fixture.marker));
assert.equal(sha(path.join(dir,'phone-r1-before-cancel.json')),sha(path.join(dir,'phone-r1-after-cancel.json')));
assert.equal(sha(path.join(dir,'phone-r1-before-cancel.json')),sha(path.join(dir,'phone-r1-after-cold.json')));
for(const name of ['phone-r2-after-delete.json','phone-r2-after-cold.json']){
 const deleted=get(name);assert.equal(deleted.material_id,fixture.material_id);assert.equal(deleted.revision,2);assert.equal(deleted.operation,'delete');assert.equal(deleted.text,'');
}
assert.equal(sha(path.join(dir,'phone-r2-after-delete.json')),sha(path.join(dir,'phone-r2-after-cold.json')));
for(const name of ['phone-source-after-delete.log','phone-source-after-cold.log','phone-r3-absence-after-cold.log'])assert.match(read(path.join(dir,name)),/no such file or directory/i);
const outbox=get('phone-outbox-after-delete.json'),rows=outbox.rows.filter(row=>row.material_id===fixture.material_id);
assert.deepEqual(rows.map(row=>row.revision).sort(),[1,2]);
const payloads={};
for(const row of rows){
 assert.equal(row.state,'server_stored');assert(row.receipt_id);assert.equal(row.last_error,'');
 const file=row.revision===1?'phone-upsert-payload.json':'phone-delete-payload.json';
 assert.equal(sha(path.join(dir,file)),row.payload_hash);const payload=get(file);assert.equal(payload.event_id,row.event_id);assert.equal(payload.body.revision,row.revision);
 assert.equal(payload.body.material_id,fixture.material_id);payloads[row.revision]=payload;
}
const cloudBefore=get('cloud-before-get.json');assert.equal(cloudBefore.exit_code,0);assert.equal(cloudBefore.reply.items.length,1);
assert.deepEqual(cloudBefore.reply.items[0].body,payloads[1].body);assert.equal(cloudBefore.reply.items[0].commit_seq,rows.find(r=>r.revision===1).server_commit_seq);
const cancelled=get('cloud-after-cancel-get.json');assert.equal(cancelled.exit_code,0);assert.deepEqual(cancelled.reply.items,cloudBefore.reply.items);
let cloudDelete;
for(const state of ['after','after-cold']){
 const latest=get('cloud-'+state+'-get.json');assert.equal(latest.exit_code,1);assert.equal(latest.reply.error.code,'MATERIAL_DELETED');assert.equal(latest.reply.error.status,410);
 const changes=get('cloud-'+state+'-changes.json');assert.equal(changes.exit_code,0);assert.equal(changes.reply.has_more,false);
 const deleted=changes.reply.items.filter(item=>item.body.material_id===fixture.material_id&&item.body.operation==='delete');
 assert.equal(deleted.length,1);assert.equal(deleted[0].withdrawn,true);assert.deepEqual(deleted[0].body,payloads[2].body);
 assert.equal(deleted[0].source_ref.material_id,fixture.material_id);assert.equal(deleted[0].source_ref.revision,2);
 assert.equal(deleted[0].commit_seq,rows.find(r=>r.revision===2).server_commit_seq);
 if(cloudDelete)assert.deepEqual(deleted[0],cloudDelete);cloudDelete=deleted[0];
}
const cold=get('cold-ledger.json');assert(cold.capture_idle&&cold.asr_idle&&cold.old_process_absent_after_stop);assert.notEqual(cold.pid_before,cold.pid_after);
assert(cold.source_directory_absent&&cold.no_third_revision&&cold.outbox_bytes_unchanged&&cold.tombstone_bytes_unchanged);
assert.equal(sha(path.join(dir,'phone-outbox-before-cold.json')),sha(path.join(dir,'phone-outbox-after-cold.json')));
const stamp=new Date(fixture.created+8*3600000),pad=n=>String(n).padStart(2,'0');
const clock=pad(stamp.getUTCMonth()+1)+'-'+pad(stamp.getUTCDate())+' '+pad(stamp.getUTCHours())+':'+pad(stamp.getUTCMinutes());
const returned=own('recording-delete-cold-normal-panel.json');assert.equal(has(returned,'本机录音').length,1);assert.equal(has(returned,'○ 待命').length,1);
assert.equal(has(own('recording-delete-cold-normal-panel.json',false),clock).length,0);assert.equal(marker(own('recording-delete-cold-normal-panel.json',false)).length,0);
const preserved=json(path.join(phase,'journal-summary063-native-device-2026-10-14.json')).retained_original_hashes;
assert.deepEqual(cold.retained_original_hashes,preserved);
for(const [name,expected]of Object.entries(preserved))assert.equal(sha(path.join(dir,'retained-'+name+'.bin')),expected);
assert.equal(sha(path.join(priv,'asr24-source-before.rawopus')),fixture.files['source.rawopus'].sha256);
assert.equal(sha(path.join(priv,'recording23-full-voice.wav')),fixture.files['audio.wav'].sha256);
const report={kind:'normal_recording_delete_phone_to_cloud_and_cold_recovery',at:new Date().toISOString(),
 version:'0.1.63',version_code:10063,build_run:runId,source_manifest_sha256:status.sourceHashManifestSha256.toLowerCase(),sources,
 signed_hap_sha256:sha(hap),installed_bundle_rechecked:true,product_code_changed_in_this_batch:false,build_reused_with_source_hash_verification:true,
 synthetic:true,source_kind:fixture.source_kind,material_id:fixture.material_id,source_files_verified:4,
 normal_recording_view:true,cancel_preserved_visible_text_canonical_and_four_source_files:true,
 delete_cleared_selected_transcript:true,source_directory_removed:true,upsert_revision:1,delete_revision:2,
 upsert_commit_seq:rows.find(r=>r.revision===1).server_commit_seq,delete_commit_seq:cloudDelete.commit_seq,
 both_phone_payloads_equal_actual_cloud_bodies:true,delete_payload_sha256:sha(path.join(dir,'phone-delete-payload.json')),
 delete_receipt_id:rows.find(r=>r.revision===2).receipt_id,latest_query_status:410,single_withdrawn_delete_increment:true,
 cold_new_process:true,cold_recording_list_and_text_not_revived:true,cold_revision_and_entire_outbox_bytes_unchanged:true,cold_no_revision3:true,
 protected_phone_original_hashes:preserved,reused_local_original_audio_unchanged:true,
 not_verified:['new glasses recording/ASR in this copy fixture','native cleanup-file-lock or tombstone-write failure','live recording starting while deletion dialog is open',
 'delayed real ASR result after deletion','all BASE-03 workflows','eight-hour reliability/power','original-audio cloud archival','Agent receive or task completion'],
 private_raw_audio_text_credentials_and_device_identity_published:false};
fs.writeFileSync(path.join(phase,'recording-deletion063-native-cloud-2026-10-14.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({version:report.version,normal_recording_delete:true,cancel_preserved:true,cloud_status:410,cold_persistent:true,product_code_changed:false}));
