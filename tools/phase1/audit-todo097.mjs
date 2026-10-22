import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../',import.meta.url));
const phase=path.join(root,'rebuild/phase1'),run='20261016-095814931-6928475b';
const read=name=>JSON.parse(fs.readFileSync(path.join(phase,name),'utf8').replace(/^\uFEFF/,''));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const test=read('todo097-targeted-source-validation-2026-10-16.json');
const status=read(`candidate-runs/${run}/status.json`),signed=read(`candidate-runs/${run}/sign-finalization-status.json`);
const sources=read(`candidate-runs/${run}/source-hashes.json`);
const compiled=sha(sources.map(row=>row.path+' '+row.sha256).join('\n'));
assert.equal(test.exit_code,0);assert.equal(test.tests,128);assert.equal(test.passed,128);assert.equal(test.failed,0);assert.equal(test.skipped,0);
assert.equal(test.source_unchanged_during_tests,true);assert.equal(test.scratch_cleaned,true);
assert.equal(compiled,test.source_snapshot_sha256);assert.equal(sources.length,850);
assert.equal(status.compileSucceeded,true);assert.equal(status.fallbackUsed,false);
assert.equal(signed.verified,true);assert.equal(signed.sourceFiles,850);assert.equal(signed.nativeSignature.verified,true);assert.equal(signed.nativeSignature.exitCode,0);
assert.equal(signed.hap.versionName,'0.1.97');assert.equal(signed.hap.versionCode,10097);assert.equal(signed.payload.productEntries,6005);
const hap=path.join(phase,`artifacts/candidate-runs/${run}/entry-default-signed.hap`),hasher=createHash('sha256');
for await(const chunk of fs.createReadStream(hap))hasher.update(chunk);
const digest=hasher.digest('hex');assert.equal(digest,signed.hap.sha256.toLowerCase());
const cli=sha(fs.readFileSync(path.join(root,'tools/phase1/io-card-cli.py')));
assert.equal(cli,'c91205ea707dd1a2b929bba56839b6d333b471b4f677000a2baea1c2982efb8e');
const report={schema:1,kind:'todo_query_filter_offline_source_audit',at_utc:new Date().toISOString(),version:'0.1.97',version_code:10097,
 source_commit:'506905c',run_id:run,source_files:sources.length,source_snapshot_sha256:compiled,test_and_compile_sources_identical:true,
 related_host_checks:128,related_host_exit_code:0,full_app_suite_rerun:false,native_build_succeeded:true,cached_dependency_fallback:false,
 native_signature_verified:true,signed_product_entries:6005,hap_sha256:digest,hap_bytes:fs.statSync(hap).size,
 cli_sha256:cli,cli_mock_suite_rerun:false,cli_prior_validation:'rebuild/phase1/scan096-cli-source-validation-2026-10-16.json',
 prior_cli_mock_checks:70,prior_cli_source_exact_bytes_match:true,upstream_reference_commit:'2449baaf8575f8579a80c0cdcc0fe6137ca82a8f',
 production_change_scope:'two todo query entry points eventType 2 to 1; no full-list write or changes to delete/receipt/voice behavior',
 includes_previously_committed_unwired_archive_component:true,unfinished_admission_schema12_included:false,
 candidate_installed_at_audit:false,device_query_verified_at_audit:false,voice_or_two_minute_card_verified:false,excel_changed:false,
 proofs:['todo097-targeted-source-validation-2026-10-16.json',`candidate-runs/${run}/status.json`,`candidate-runs/${run}/source-hashes.json`,`candidate-runs/${run}/sign-finalization-status.json`]
   .map(name=>({path:'rebuild/phase1/'+name,sha256:sha(fs.readFileSync(path.join(phase,name)))}))};
fs.writeFileSync(path.join(phase,'todo097-source-audit-2026-10-16.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({version:report.version,related_checks:128,native_signature:true,source_files:850,hap_sha256:digest}));
