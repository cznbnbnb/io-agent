// Publish metadata only from actual compiler, HDC layouts and native hilog.
// Does not connect, issue credentials, write phone files or fabricate responses.
import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import assert from 'node:assert/strict';
const root=process.cwd(),phase=path.join(root,'rebuild/phase1'),priv=path.join(phase,'device-private');
const read=p=>fs.readFileSync(p,'utf8').replace(/^\uFEFF/,'');const json=p=>JSON.parse(read(p));
const pj=n=>json(path.join(priv,n));const sha=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const runId='20261014-073217984-50049d69',run=path.join(phase,'candidate-runs',runId),status=json(path.join(run,'status.json'));
assert.equal(status.phase,'complete');assert.equal(status.versionCode,10061);assert.equal(status.compileSucceeded,true);assert.equal(status.fallbackUsed,false);
assert.equal(sha(path.join(run,'source-hashes.json')),status.sourceHashManifestSha256.toLowerCase());
const manifest=json(path.join(run,'source-hashes.json'));
const sources=['AppScope/app.json5','entry/src/main/ets/MaterialSyncService.ets','entry/src/main/ets/MaterialSyncSettings.ets','entry/src/main/ets/pages/MaterialSyncPanel.ets','tests/material-sync-reload-recovery.test.mjs'].map(name=>{
 const relative='harmony-sdk/'+name,row=manifest.find(r=>r.path===relative);assert.ok(row);
 const digest=sha(path.join(root,'rebuild',relative));assert.equal(digest,row.sha256.toLowerCase(),'source drift');return {path:relative,sha256:digest};
});
const hap=path.join(phase,'artifacts/entry-default-signed-0.1.61.hap'),digest='2e86465bc444bcb26cc19ebb6a0e278a6e549cefdb2c2f8c406ce74fb16302e5';assert.equal(sha(hap),digest);
assert.match(read(path.join(phase,'material-reload-061-app-regression-final-2026-10-14.log')),/# tests 805\s+# suites 0\s+# pass 805\s+# fail 0\s+# cancelled 0\s+# skipped 0/);
assert.match(read(path.join(priv,'reload061-install.log')),/install bundle successfully/);
assert.match(read(path.join(priv,'reload061-bundle-after.json')),/"versionCode"\s*:\s*10061/);
assert.match(read(path.join(priv,'reload061-bundle-after.json')),/"versionName"\s*:\s*"0\.1\.61"/);
const install=pj('reload061-install-ledger.json');assert.equal(install.hap_sha256,digest);assert.equal(install.version_code,10061);
for(const key of ['capture_idle','asr_idle','replace_install'])assert.equal(install[key],true);assert.notEqual(install.pid_before,install.pid_after);
function own(name){
 const all=[],walk=n=>{all.push(n);for(const child of n.children??[])walk(child);};walk(pj(name));
 const roots=all.filter(n=>n.attributes.type==='root'&&n.attributes.focused==='true'&&n.attributes.bundleName);assert.equal(roots.length,1);
 const w=roots[0];assert.equal(w.attributes.bundleName,'org.turboio.harmony.research');assert.equal(w.attributes.pagePath,'pages/Index');
 const nodes=all.filter(n=>n.attributes.hostWindowId===w.attributes.hostWindowId&&n.attributes.visible==='true');assert.equal(nodes.filter(n=>n.attributes.text==='TURBO IO').length,1);return nodes;
}
const probe=pj('reload061-native-probe-ledger.json');assert.equal(probe.version,'0.1.61');assert.equal(probe.pid,install.pid_after);assert.equal(probe.capture_idle,true);
assert.equal(probe.normal_settings_resaved,false);assert.equal(probe.credential_or_material_written_by_driver,false);assert.equal(probe.cycles.length,3);
for(const [index,cycle] of probe.cycles.entries()){
 assert.equal(cycle.cycle,index+1);for(const key of ['system_lock_confirmed','same_process','foreground_sync_visible'])assert.equal(cycle[key],true);
 assert.match(read(path.join(priv,`reload061-cycle-${index+1}-lock.log`)),/screenLocked\s+true/);
 assert.equal(own(`reload061-cycle-${index+1}-settled.json`).filter(n=>n.attributes.text==='前台同步').length,1);
}
const rawLog=read(path.join(priv,'reload061-material-hilog.log')), lines=rawLog.trim().split(/\r?\n/);assert.equal(lines.length,6);
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
const final=own('reload061-final-page.json'),stale='同步配置暂不可读，请解锁后重试；未覆盖已保存配置';
assert.equal(final.filter(n=>n.attributes.text==='前台同步').length,1);assert.equal(final.filter(n=>n.attributes.text==='待同步 0 · 已存文字版本 32 · 需处理 0').length,1);
assert.equal(final.filter(n=>n.attributes.text===stale).length,1);
const old=json(path.join(phase,'material059-native-cloud-2026-10-14.json')),hashes={};
for(const key of ['revision','audio','asr']){hashes[key]=sha(path.join(priv,'reload061-retained-'+key+'.bin'));assert.equal(hashes[key],old.original_hashes_preserved[key]);}
assert.equal(sha(path.join(priv,'reload061-retained-outbox.bin')),sha(path.join(priv,'delete060-cold-outbox-after.json')));
const report={kind:'normal_phone_material_vault_foreground_recovery',at:new Date().toISOString(),version:'0.1.61',version_code:10061,build_run:runId,source_manifest_sha256:status.sourceHashManifestSha256.toLowerCase(),sources,full_app_component_regression_passed:805,new_recovery_component_tests:22,compiler_succeeded:true,dependency_fallback_used:false,signed_hap_bytes:fs.statSync(hap).size,signed_hap_sha256:digest,normal_phone_installed:true,normal_lock_unlock_cycles:3,same_process:true,real_temporary_vault_failure_observed:true,same_foreground_automatic_retry_recovery_verified:true,native_metadata_events:events,normal_settings_resaved:false,credential_or_material_written_by_driver:false,retained_original_hashes_preserved:hashes,existing_outbox_bytes_unchanged:true,stored_version_count:32,queued_count:0,residual_recovered_error_banner_visible:true,validation_boundary:'Three actual OS lock/unlock cycles, native unavailable-vault retry/recovery metadata and normal foreground sync state; no new material message or task executed.',not_verified:['MaterialSyncPanel stale error banner fix','native save/dispose/reinitialize race','new material upload after an induced unavailable-vault event','network-loss/offline recovery for formal setup','automatic credential rotation','eight-hour background/power','whole PRD or BASE acceptance'],private_credentials_raw_layouts_or_user_materials_published:false};
fs.writeFileSync(path.join(phase,'material-reload061-native-device-2026-10-14.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({version:report.version,actual_lock_unlock_cycles:3,native_same_foreground_recovery:true,old_error_banner_still_visible:true,originals_and_existing_receipts_preserved:true}));
