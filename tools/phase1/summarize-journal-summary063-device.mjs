// Reconcile frozen builds and actual private native exports; publish metadata only.
// Does not operate the phone, call a model, or publish material bodies/credentials.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';

const root=process.cwd(),phase=path.join(root,'rebuild/phase1'),priv=path.join(phase,'device-private');
const read=file=>fs.readFileSync(file,'utf8').replace(/^\uFEFF/,'');
const json=file=>JSON.parse(read(file));
const sha=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const p=name=>path.join(priv,name);
const runId='20261014-082906559-0f8eeab2',run=path.join(phase,'candidate-runs',runId);
const status=json(path.join(run,'status.json')),manifest=json(path.join(run,'source-hashes.json'));
assert.equal(status.phase,'complete');assert.equal(status.versionName,'0.1.63');assert.equal(status.versionCode,10063);
assert.equal(status.compileSucceeded,true);assert.equal(status.fallbackUsed,false);
assert.equal(sha(path.join(run,'source-hashes.json')),status.sourceHashManifestSha256.toLowerCase());
const sourceNames=['AppScope/app.json5','entry/src/main/ets/JournalExport.ets',
 'entry/src/main/ets/RecordingService.ets','entry/src/main/ets/pages/JournalPanel.ets',
 'entry/src/main/ets/RemoteServices.ets','entry/src/main/ets/entryability/EntryAbility.ets',
 'tests/journal-summary-revision-binding.test.mjs'];
const sources=sourceNames.map(name=>{
 const relative='harmony-sdk/'+name,row=manifest.find(item=>item.path===relative);assert(row);
 const digest=sha(path.join(root,'rebuild',relative));assert.equal(digest,row.sha256.toLowerCase());
 return {path:relative,sha256:digest};
});
const build=json(path.join(phase,'journal-summary063-build-2026-10-14.json'));
const hap=path.join(phase,'artifacts/entry-default-signed-0.1.63.hap');
assert.equal(build.run_id,runId);assert.equal(sha(hap),build.signed_hap_sha256);
assert.match(read(path.join(phase,'journal-summary063-full-app-host-2026-10-14.log')),
 /# tests 842\s+# suites 0\s+# pass 842\s+# fail 0\s+# cancelled 0\s+# skipped 0/);
const installed=json(p('summary063-install-ledger.json'));
assert.equal(installed.version_code,10063);assert.equal(installed.hap_sha256,sha(hap));
assert(installed.capture_idle&&installed.asr_idle&&installed.replace_install);
assert.notEqual(installed.pid_before,installed.pid_after);
const bundleText=read(p('goal063-resume-bundle.json'));
const bundle=JSON.parse(bundleText.slice(bundleText.indexOf('{'),bundleText.lastIndexOf('}')+1));
assert.equal(bundle.applicationInfo.versionName,'0.1.63');assert.equal(bundle.applicationInfo.versionCode,10063);
function nodes(name){
 const all=[],walk=node=>{all.push(node);for(const child of node.children??[])walk(child);};walk(json(p(name)));
 const roots=all.filter(n=>n.attributes.type==='root'&&n.attributes.focused==='true'&&n.attributes.bundleName);
 assert.equal(roots.length,1);assert.equal(roots[0].attributes.bundleName,'org.turboio.harmony.research');
 assert.equal(roots[0].attributes.pagePath,'pages/Index');
 return all.filter(n=>n.attributes.visible==='true'&&n.attributes.hostWindowId===roots[0].attributes.hostWindowId);
}
const texts=(items,value)=>items.filter(n=>n.attributes.type==='Text'&&n.attributes.text===value);
function picker(name){
 const items=nodes(name);
 assert.equal(items.filter(n=>n.attributes.type==='TextInput'&&n.attributes.text==='TurboIO-记录汇总-20261013.md').length,1);
 assert.equal(texts(items,'20261014-063').length,1);
 assert.equal(items.filter(n=>n.attributes.type==='SymbolGlyph'&&n.attributes.id==='dialog_confirm').length,1);
}
const canonical=json(p('reload062-retained-revision.bin'));
assert.equal(canonical.material_id,'mat-lifelog-042bb7365e004cbb837949173a59f754');
assert.equal(canonical.revision,10);assert.equal(canonical.text_revision,9);
assert.deepEqual(json(p('summary063-r10-export.json')),canonical);
assert(read(p('summary063-r10-export.md')).includes(canonical.text));
for(const [before,after]of [['summary063-md-save-before.json','summary063-md-save-returned.json'],
 ['summary063-json-save-before.json','summary063-json-save-returned.json']]){
 const old=nodes(before);assert.equal(old.filter(n=>n.attributes.type==='TextInput'&&String(n.attributes.text).startsWith('TurboIO-seg-042bb7365e004cbb837949173a59f754.')).length,1);
 assert(texts(nodes(after),'已导出当前资料修订').length>0);
}
picker('goal063-day-save-before.json');picker('goal063-ai-save-before.json');
const plain=read(p('goal063-day-source.md')),ai=read(p('goal063-ai-source.md'));
assert.equal(plain,read(p('goal063-day-rendered.md')));assert.equal(ai,read(p('goal063-ai-rendered.md')));
assert(plain.startsWith('# 2026-10-13 记录\n'));assert(plain.includes('录音总时长 00:00:13'));
assert(plain.includes('资料修订：10；文字修订：9'));assert(plain.includes(canonical.material_id));
assert(!plain.includes('\n## AI 总结\n'));
const plainHash=sha(p('goal063-day-source.md')),fingerprint='- 总结来源指纹：sha256:'+plainHash;
assert(ai.includes(fingerprint));assert(ai.includes(canonical.material_id));assert(ai.includes('资料修订：10；文字修订：9'));
const restored=ai.replace(/\n## AI 总结\n\n- 总结来源指纹：sha256:[a-f0-9]{64}\n\n[\s\S]*?(?=\n## )/,'');
assert.equal(restored,plain,'AI output must retain the original timeline byte for byte');
const plainReturned=nodes('goal063-day-save-returned.json'),aiReturned=nodes('goal063-ai-save-returned.json');
assert(texts(plainReturned,'已导出（1/1 条有内容）').length>0);
assert(texts(aiReturned,'已导出（1/1 条有内容，含 AI 总结）').length>0);
assert(!aiReturned.some(n=>n.attributes.type==='TextInput'&&n.attributes.text==='TurboIO-记录汇总-20261013.md'));
const aiDialog=nodes('goal063-ai-confirm-before.json');
assert.equal(texts(aiDialog,'导出汇总（1/1 条有内容）？').length,1);assert.equal(texts(aiDialog,'带 AI 总结').length,1);
const hashes={canonical:'83248d4c6b50ed750875be3fb52b5907cc0e5d823aaed9d5b5e8d1687bfed6a5',
 audio:'cd2ba1e3a85dfb445fed45ec8bf5c0d29acd261a579349c9bcedc5462e0477e1',
 original_asr:'97c7ae1b6e397343cca293a833598a0011edce2751fb7f9f91f17e1169679cc1'};
assert.equal(sha(p('goal063-retained-revision.json')),hashes.canonical);
assert.equal(sha(p('goal063-retained-audio.ogg')),hashes.audio);
assert.equal(sha(p('goal063-retained-asr.json')),hashes.original_asr);
const report={kind:'normal_journal_summary_and_revision_exports',at:new Date().toISOString(),
 version:'0.1.63',version_code:10063,build_run:runId,source_manifest_sha256:status.sourceHashManifestSha256.toLowerCase(),sources,
 compiler_succeeded:true,dependency_fallback_used:false,signed_hap_sha256:sha(hap),signed_hap_bytes:fs.statSync(hap).size,
 full_app_component_tests:842,related_component_tests:25,related_are_full_regression_subset:true,
 normal_phone_installed:true,actual_bundle_version_rechecked:true,covered_install_preserved_existing_app:true,
 synthetic:true,material_id:canonical.material_id,material_revision:10,text_revision:9,
 revision_md_json:{normal_picker_save_returned:true,app_generated_sources_read_back:true,json_equals_canonical:true,md_contains_canonical_text:true},
 historical_day:{date:'2026-10-13',total:1,transcribed:1,duration_seconds:13,normal_picker_save_returned:true,
 app_snapshot_readback_equals_rendered:true,content_addressed_sha256:plainHash},
 real_model_summary:{normal_phone_action:true,normal_picker_save_returned:true,original_input_fingerprint_verified:true,
 original_timeline_bytes_preserved:true,app_snapshot_readback_equals_rendered:true,content_addressed_sha256:sha(p('goal063-ai-source.md'))},
 retained_original_hashes:hashes,external_saved_file_bytes_independently_read:false,
 original_failures_preserved:['sandbox full regression failed before host replay','post-sign strict guard rejected known generated dependency lock'],
 not_verified:['native correction/deletion while AI is pending','native background during AI response','native automatic-cache update while picker waits',
 'RecordingPanel independent native deletion','all-history compatibility','glasses microphone or real two-speaker accuracy in this synthetic fixture',
 'eight-hour reliability/power','full BASE or PRD acceptance'],private_raw_materials_credentials_or_device_identity_published:false};
fs.writeFileSync(path.join(phase,'journal-summary063-native-device-2026-10-14.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({version:report.version,normal_exports_verified:true,real_ai_input_bound:true,retained_hashes_verified:true,unverified:report.not_verified}));
