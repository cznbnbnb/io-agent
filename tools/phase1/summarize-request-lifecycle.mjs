// Read completed evidence; never builds, installs or updates Excel.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../',import.meta.url));
const bytes=name=>fs.readFileSync(path.join(root,name));
const text=name=>{const b=bytes(name);return b.toString(b[0]===0xff&&b[1]===0xfe?'utf16le':'utf8');};
const json=name=>JSON.parse(text(name));
const hash=name=>createHash('sha256').update(bytes(name)).digest('hex');
const requireValue=(condition,code)=>{if(!condition)throw new Error(code);};
const testResult=name=>{
  const log=text(name),count=label=>Number(log.match(new RegExp(`(?:ℹ|#) ${label} (\\d+)`))?.[1]??NaN);
  const result={tests:count('tests'),passed:count('pass'),failed:count('fail'),log:name};
  requireValue(result.tests>0&&result.tests===result.passed&&result.failed===0,'TEST_EVIDENCE_NOT_PASSED');return result;
};
const native=testResult('rebuild/phase1/request-lifecycle-native-normal-tests-2026-10-12.log');
const serverBridge=testResult('rebuild/phase1/request-lifecycle-server-bridge-tests-2026-10-12.log');
const contract=testResult('rebuild/phase1/request-lifecycle-contract-tests-2026-10-12.log');
const provider=json('rebuild/phase1/hermes-real-provider-cancel-2026-10-12.json');
const expiry=json('rebuild/phase1/hermes-managed-lifecycle-runtime-2026-10-12.json');
const reconciliation=json('rebuild/agent-bridge/hermes/verification/reconciliation-result.json');
requireValue(provider.status==='passed'&&provider.checks.length===8&&provider.cancellation.request_withdrawn===true,'REAL_PROVIDER_EVIDENCE_REQUIRED');
requireValue(expiry.passed===true&&expiry.lifecycle.question_expired===true&&expiry.lifecycle.answer_consumed===false,'ACTUAL_WAIT_EXPIRY_EVIDENCE_REQUIRED');
requireValue(reconciliation.status==='passed','RECONCILIATION_EVIDENCE_REQUIRED');
for(const report of [provider,expiry,reconciliation])for(const [file,expected]of Object.entries(report.source_sha256))
  requireValue(hash(file)===expected,'VERIFICATION_SOURCE_CHANGED');
requireValue(text('rebuild/phase1/candidate-build.log').includes('BUILD SUCCESSFUL'),'BUILD_EVIDENCE_REQUIRED');
const nativeFiles=['AppScope/app.json5','entry/src/main/ets/TaskWire.ets','entry/src/main/ets/pages/TaskPanel.ets'];
for(const relative of nativeFiles){
  const staged=fs.readFileSync(path.join(os.tmpdir(),'TurboIO-phase1-01a125f7/harmony-sdk',relative));
  requireValue(bytes('rebuild/harmony-sdk/'+relative).equals(staged),'BUILT_SOURCE_CHANGED');
}
const metadataScript=`Add-Type -AssemblyName System.IO.Compression.FileSystem
$taskZip=[IO.Compression.ZipFile]::OpenRead((Resolve-Path -LiteralPath rebuild/phase1/artifacts/entry-default-unsigned.hap))
try { $taskReader=[IO.StreamReader]::new($taskZip.GetEntry('module.json').Open())
try { $taskMeta=($taskReader.ReadToEnd() | ConvertFrom-Json)
[ordered]@{versionName=$taskMeta.app.versionName;versionCode=$taskMeta.app.versionCode;bundleName=$taskMeta.app.bundleName} | ConvertTo-Json -Compress
} finally {$taskReader.Dispose()} } finally {$taskZip.Dispose()}`;
const observed=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',metadataScript],{cwd:root,encoding:'utf8',windowsHide:true,timeout:15000});
requireValue(observed.status===0,'CANDIDATE_METADATA_READ_FAILED');const metadata=JSON.parse(observed.stdout.trim());
requireValue(metadata.versionName==='0.1.51'&&metadata.versionCode===10051,'CANDIDATE_VERSION_MISMATCH');
const candidate='rebuild/phase1/artifacts/entry-default-unsigned.hap',digest=createHash('sha256');
for await(const chunk of fs.createReadStream(path.join(root,candidate)))digest.update(chunk);
const files=['rebuild/material-server/store.mjs','rebuild/material-server/http.mjs','rebuild/agent-bridge/bridge.mjs',
  'rebuild/agent-bridge/client.mjs','rebuild/agent-bridge/tests/bridge.test.mjs','rebuild/material-server/tests/request-lifecycle.test.mjs',
  'rebuild/material-server/tests/request-lifecycle-worker.mjs','rebuild/harmony-sdk/tests/task-mailbox.test.mjs',
  ...nativeFiles.map(file=>'rebuild/harmony-sdk/'+file),'docs/contracts/request-lifecycle.json','tools/phase1/summarize-request-lifecycle.mjs'];
const report={at:new Date().toISOString(),status:'passed',scope:'local server/bridge and actual Hermes waits, unsigned Harmony candidate; no device or production rollout',
  tests:{native,server_bridge:serverBridge,contract},real_provider:{checks:provider.checks.length,profile:provider.profile,session_id:provider.session_id,model:provider.model},
  actual_acp_expiry:{checks:expiry.checks.length,model_is_synthetic:true,...expiry.lifecycle},
  reconciliation:{unit_tests:reconciliation.unit_tests,local_integration_checks:reconciliation.local_integration_checks,synthetic_attestation:true},
  candidate:{...metadata,path:candidate,bytes:fs.statSync(path.join(root,candidate)).size,sha256:digest.digest('hex'),signed:false,installed:false,staged_sources_match:true},
  failure_evidence:{first_real_provider_attempt:'rebuild/phase1/request-lifecycle-hermes-provider-attempt1-2026-10-12.json',cause:'not determined; earlier verifier discarded non-code exception detail',original_failed_task_replayed:false,
    sandbox_native_tests:'rebuild/phase1/request-lifecycle-native-tests-2026-10-12.log',sandbox_failure:'temporary-directory rename denied; normal-host rerun passed'},
  not_verified:['production deployment of request_lifecycle_v1','phone task credentials, enabled task sync and cloud end-to-end','glasses questions and voice answers','real-model question expiry (actual installed ACP expiry used a synthetic model)',
    'original CLI/TUI attachment or crash restoring a live tool stack','eight-hour stability and the first unclassified provider-run failure','complete official baseline, power and multi-device acceptance'],
  source_sha256:Object.fromEntries(files.map(file=>[file,hash(file)]))};
fs.writeFileSync(path.join(root,'rebuild/phase1/request-lifecycle-result-2026-10-12.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({status:report.status,native_tests:native.tests,server_bridge_tests:serverBridge.tests,contract_tests:contract.tests,
  real_provider_checks:provider.checks.length,actual_acp_expiry_checks:expiry.checks.length,candidate:metadata.versionName,installed:false}));
