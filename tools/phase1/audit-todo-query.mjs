// Immutable offline audit for a completed todo query candidate, before install.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../',import.meta.url)),phase=path.join(root,'rebuild/phase1');
const [batch,run]=process.argv.slice(2);
assert.match(batch??'',/^todo\d{3}$/);assert.match(run??'',/^\d{8}-\d{9}-[a-f0-9]{8}$/);
const read=name=>JSON.parse(fs.readFileSync(path.join(phase,name),'utf8').replace(/^\uFEFF/,''));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const testName=`${batch}-targeted-source-validation-2026-10-16.json`,test=read(testName);
const status=read(`candidate-runs/${run}/status.json`),signed=read(`candidate-runs/${run}/sign-finalization-status.json`);
const sources=read(`candidate-runs/${run}/source-hashes.json`);
assert.equal(status.runId,run);assert.equal(signed.runId,run);
assert.equal(test.exit_code,0);assert(test.tests>0);assert.equal(test.tests,test.passed);assert.equal(test.failed,0);assert.equal(test.skipped,0);
assert.equal(test.source_unchanged_during_tests,true);assert.equal(test.scratch_cleaned,true);
assert.equal(sha(fs.readFileSync(path.join(root,test.log))),test.log_sha256);
const compiled=sha(sources.map(row=>row.path+' '+row.sha256).join('\n'));
assert.equal(compiled,test.source_snapshot_sha256);assert.equal(sources.length,test.source_files);
for(const row of sources){
 assert.match(row.path,/^(?:harmony-sdk|core-probe)\//);assert(!row.path.split('/').includes('..'));
 assert.equal(sha(fs.readFileSync(path.join(root,'rebuild',row.path))),row.sha256.toLowerCase());
}
assert.equal(status.compileSucceeded,true);assert.equal(status.fallbackUsed,false);
assert.equal(signed.verified,true);assert.equal(signed.sourceFiles,sources.length);assert.equal(signed.nativeSignature.verified,true);assert.equal(signed.nativeSignature.exitCode,0);
assert.equal(signed.hap.versionName,status.versionName);assert.equal(signed.hap.versionCode,status.versionCode);assert.equal(signed.payload.productEntries,6005);
const hap=path.join(phase,`artifacts/candidate-runs/${run}/entry-default-signed.hap`),hasher=createHash('sha256');
for await(const chunk of fs.createReadStream(hap))hasher.update(chunk);
const digest=hasher.digest('hex');assert.equal(digest,signed.hap.sha256.toLowerCase());
const cli=sha(fs.readFileSync(path.join(root,'tools/phase1/io-card-cli.py')));
assert.equal(cli,'c91205ea707dd1a2b929bba56839b6d333b471b4f677000a2baea1c2982efb8e');
const report={schema:1,kind:'todo_filtered_batch_offline_source_audit',at_utc:new Date().toISOString(),version:status.versionName,version_code:status.versionCode,
 source_commit:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),run_id:run,source_files:sources.length,source_snapshot_sha256:compiled,
 current_test_and_compile_sources_identical:true,related_host_checks:test.tests,related_host_exit_code:0,full_app_suite_rerun:false,native_build_succeeded:true,
 cached_dependency_fallback:false,native_signature_verified:true,signed_product_entries:6005,hap_sha256:digest,hap_bytes:fs.statSync(hap).size,
 cli_sha256:cli,cli_mock_suite_rerun:false,prior_cli_mock_checks:70,prior_cli_source_exact_bytes_match:true,
 upstream_reference_commit:'2449baaf8575f8579a80c0cdcc0fe6137ca82a8f',
 production_change_scope:batch==='todo100'?'normalize the observed literal empty chunkInfo object to absent; nonempty partial chunks, root/count/order checks, tombstones and no-replay behavior unchanged':batch==='todo099'?'bounded rejection diagnostics: schema keys/types only, no field values; strict parser and mutation behavior unchanged':'optional consistent chunk profile; bounded root batches; todo-filter count scope; no full-list writes or delete/receipt/voice changes',
 unfinished_admission_schema12_included:false,candidate_installed_at_audit:false,device_query_verified_at_audit:false,
 voice_or_two_minute_card_verified:false,developer_did_not_edit_excel:true,
 proofs:[testName,`candidate-runs/${run}/status.json`,`candidate-runs/${run}/source-hashes.json`,`candidate-runs/${run}/sign-finalization-status.json`]
 .map(name=>({path:'rebuild/phase1/'+name,sha256:sha(fs.readFileSync(path.join(phase,name)))}))};
fs.writeFileSync(path.join(phase,`${batch}-source-audit-2026-10-16.json`),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({version:report.version,related_checks:test.tests,native_signature:true,source_files:sources.length,hap_sha256:digest}));
