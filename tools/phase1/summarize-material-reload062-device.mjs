// Publish metadata only from actual compiler, HDC layouts and native hilog.
// Does not connect, issue credentials, write phone files or fabricate responses.
import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import assert from 'node:assert/strict';
const root=process.cwd(),phase=path.join(root,'rebuild/phase1'),priv=path.join(phase,'device-private');
const read=p=>fs.readFileSync(p,'utf8').replace(/^\uFEFF/,'');const json=p=>JSON.parse(read(p));
const pj=n=>json(path.join(priv,n));const sha=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const runId='20261014-074852364-13d6d22d',run=path.join(phase,'candidate-runs',runId),status=json(path.join(run,'status.json'));
assert.equal(status.phase,'complete');assert.equal(status.versionCode,10062);assert.equal(status.compileSucceeded,true);assert.equal(status.fallbackUsed,false);
assert.equal(sha(path.join(run,'source-hashes.json')),status.sourceHashManifestSha256.toLowerCase());
const manifest=json(path.join(run,'source-hashes.json'));
const sources=['AppScope/app.json5','entry/src/main/ets/MaterialSyncService.ets','entry/src/main/ets/MaterialSyncSettings.ets','entry/src/main/ets/pages/MaterialSyncPanel.ets','tests/material-sync-reload-recovery.test.mjs'].map(name=>{
 const relative='harmony-sdk/'+name,row=manifest.find(r=>r.path===relative);assert.ok(row);
 const digest=sha(path.join(root,'rebuild',relative));assert.equal(digest,row.sha256.toLowerCase(),'source drift');return {path:relative,sha256:digest};
});
const hap=path.join(phase,'artifacts/entry-default-signed-0.1.62.hap'),digest='ad6fde62bdaf3637197b304c7a54156fc2cbfe92cbf9ae7ae7745c744006b1b7';assert.equal(sha(hap),digest);
assert.match(read(path.join(phase,'material-sync-panel-service-note-related-2026-10-14.log')),/# tests 25\s+# suites 0\s+# pass 25\s+# fail 0\s+# cancelled 0\s+# skipped 0/);
const noticeTest='harmony-sdk/tests/material-sync-panel-service-note.test.mjs',noticeRow=manifest.find(row=>row.path===noticeTest);
assert.ok(noticeRow);assert.equal(sha(path.join(root,'rebuild',noticeTest)),noticeRow.sha256.toLowerCase());
sources.push({path:noticeTest,sha256:noticeRow.sha256.toLowerCase()});
assert.match(read(path.join(priv,'reload062-install.log')),/install bundle successfully/);
const nativeBundle=read(path.join(priv,'reload062-bundle-after.json'));
assert.ok(/"versionCode"\s*:\s*10062/.test(nativeBundle),'native version code mismatch');
assert.ok(/"versionName"\s*:\s*"0\.1\.62"/.test(nativeBundle),'native version name mismatch');
const install=pj('reload062-install-ledger.json');assert.equal(install.hap_sha256,digest);assert.equal(install.version_code,10062);
for(const key of ['capture_idle','asr_idle','replace_install'])assert.equal(install[key],true);assert.notEqual(install.pid_before,install.pid_after);
function own(name){
 const all=[],walk=n=>{all.push(n);for(const child of n.children??[])walk(child);};walk(pj(name));
 const roots=all.filter(n=>n.attributes.type==='root'&&n.attributes.focused==='true'&&n.attributes.bundleName);assert.equal(roots.length,1);
 const w=roots[0];assert.equal(w.attributes.bundleName,'org.turboio.harmony.research');assert.equal(w.attributes.pagePath,'pages/Index');
 const nodes=all.filter(n=>n.attributes.hostWindowId===w.attributes.hostWindowId&&n.attributes.visible==='true');assert.equal(nodes.filter(n=>n.attributes.text==='TURBO IO').length,1);return nodes;
}
const probe=pj('reload062-native-probe-ledger.json');assert.equal(probe.version,'0.1.62');assert.equal(probe.pid,install.pid_after);assert.equal(probe.capture_idle,true);
assert.equal(probe.normal_settings_resaved,false);assert.equal(probe.credential_or_material_written_by_driver,false);assert.equal(probe.cycles.length,3);
for(const [index,cycle] of probe.cycles.entries()){
 assert.equal(cycle.cycle,index+1);for(const key of ['system_lock_confirmed','same_process','foreground_sync_visible'])assert.equal(cycle[key],true);
 assert.equal(cycle.stale_service_notice_visible,false);
 assert.match(read(path.join(priv,`reload062-cycle-${index+1}-lock.log`)),/screenLocked\s+true/);
 const settled=own(`reload062-cycle-${index+1}-settled.json`);
 assert.equal(settled.filter(n=>n.attributes.text==='前台同步').length,1);
 assert.equal(settled.filter(n=>n.attributes.text==='同步配置暂不可读，请解锁后重试；未覆盖已保存配置').length,0);
}
const rawLog=read(path.join(priv,'reload062-material-hilog.log')), lines=rawLog.trim().split(/\r?\n/);assert.equal(lines.length,6);
const events=lines.map(line=>{
 const match=/^(\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3})\s+(\d+)\s+(\d+)\s+I A00000\/org\.turboio\.harmony\.research\/TurboIO: \[MaterialSync\] settings (retry attempt=(\d+) delay_ms=(\d+)|recovered_after_attempt=(\d+))$/.exec(line);
 assert.ok(match,'unexpected native metadata');assert.equal(match[2],probe.pid);assert.equal(match[3],probe.pid);
 return match[5]?{local_time:match[1],kind:'retry',attempt:Number(match[5]),delay_ms:Number(match[6])}:{local_time:match[1],kind:'recovered',attempt:Number(match[7])};
});
for(let i=0;i<3;i++){
 assert.equal(events[i*2].kind,'retry');assert.equal(events[i*2].attempt,1);assert.equal(events[i*2].delay_ms,1000);
 assert.equal(events[i*2+1].kind,'recovered');assert.equal(events[i*2+1].attempt,1);assert.ok(events[i*2+1].local_time>events[i*2].local_time);
}
assert.deepEqual(probe.retry_events,events.filter(e=>e.kind==='retry').map(e=>({attempt:e.attempt,delay_ms:e.delay_ms})));
assert.deepEqual(probe.recovered_events,[1,1,1]);assert.equal(probe.temporary_vault_failure_branch_observed,true);
const final=own('reload062-final-page.json'),stale='同步配置暂不可读，请解锁后重试；未覆盖已保存配置';
assert.equal(final.filter(n=>n.attributes.text==='前台同步').length,1);assert.equal(final.filter(n=>n.attributes.text==='待同步 0 · 已存文字版本 32 · 需处理 0').length,1);
assert.equal(final.filter(n=>n.attributes.text===stale).length,0);
const old=json(path.join(phase,'material059-native-cloud-2026-10-14.json')),hashes={};
for(const key of ['revision','audio','asr']){hashes[key]=sha(path.join(priv,'reload062-retained-'+key+'.bin'));assert.equal(hashes[key],old.original_hashes_preserved[key]);}
assert.equal(sha(path.join(priv,'reload062-retained-outbox.bin')),sha(path.join(priv,'delete060-cold-outbox-after.json')));
const previous=json(path.join(phase,'material-reload061-native-device-2026-10-14.json'));
assert.equal(previous.version,'0.1.61');assert.equal(previous.residual_recovered_error_banner_visible,true);
const report={kind:'normal_phone_material_recovered_notice_clear',at:new Date().toISOString(),version:'0.1.62',version_code:10062,build_run:runId,source_manifest_sha256:status.sourceHashManifestSha256.toLowerCase(),sources,related_page_event_tests_passed:25,new_page_notice_component_tests:12,full_app_regression_for_this_version_run:false,compiler_succeeded:true,dependency_fallback_used:false,signed_hap_bytes:fs.statSync(hap).size,signed_hap_sha256:digest,normal_phone_installed:true,normal_lock_unlock_cycles:3,same_process:true,real_temporary_vault_failure_observed:true,same_foreground_automatic_retry_recovery_verified:true,native_metadata_events:events,normal_settings_resaved:false,credential_or_material_written_by_driver:false,retained_original_hashes_preserved:hashes,existing_outbox_bytes_unchanged:true,stored_version_count:32,queued_count:0,baseline_version:'0.1.61',baseline_recovered_error_banner_visible:true,residual_recovered_error_banner_visible:false,validation_boundary:'Three actual OS lock/unlock cycles, native unavailable-vault retry/recovery and recovered normal page without the stale service banner; no new material message or task executed.',not_verified:['native draft/import/save feedback interaction during a recovery','native save/dispose/reinitialize race','new material upload after an induced unavailable-vault event','network-loss/offline recovery for formal setup','automatic credential rotation','eight-hour background/power','whole PRD or BASE acceptance'],private_credentials_raw_layouts_or_user_materials_published:false};
fs.writeFileSync(path.join(phase,'material-reload062-native-device-2026-10-14.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({version:report.version,actual_lock_unlock_cycles:3,native_same_foreground_recovery:true,old_error_banner_still_visible:false,originals_and_existing_receipts_preserved:true}));
