// Read completed evidence only. Does not run a model, deploy, install or edit Excel.
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';

const root=fileURLToPath(new URL('../../',import.meta.url));
const read=name=>{
  const bytes=fs.readFileSync(path.join(root,name));
  return bytes.toString(bytes[0]===0xff&&bytes[1]===0xfe?'utf16le':'utf8').replace(/^\uFEFF/,'');
};
const sha=name=>createHash('sha256').update(fs.readFileSync(path.join(root,name))).digest('hex');
const nodeLog=read('rebuild/phase1/intake-reconciliation-node-tests-2026-10-12.log');
const journalLog=read('rebuild/phase1/intake-reconciliation-journal-tests-2026-10-12.log');
const count=label=>Number(new RegExp('^# '+label+' (\\d+)\\s*$','m').exec(nodeLog)?.[1]);
assert.equal(count('tests'),129);assert.equal(count('pass'),129);assert.equal(count('fail'),0);
assert.match(journalLog,/Ran 20 tests/);assert.match(journalLog,/(?:^|\n)OK\s*$/);
const acp=JSON.parse(read('rebuild/phase1/hermes-managed-admission-runtime-2026-10-12.json'));
assert.equal(acp.passed,true);assert.equal(acp.checks.length,9);assert(acp.checks.every(c=>c.passed));
assert.equal(acp.admission.intake_reconciled,true);assert.equal(acp.admission.task_prompt_count,1);
assert.equal(acp.admission.next_task_completed,true);assert.equal(acp.admission.model_is_synthetic,true);
for(const [name,expected]of Object.entries(acp.source_sha256))assert.equal(sha(name),expected,`Evidence source changed: ${name}`);
const files=['rebuild/agent-bridge/tests/bridge.test.mjs','rebuild/agent-bridge/tests/adapter-host.test.mjs',
  'rebuild/agent-bridge/tests/fixtures/runtime-adapter.mjs','rebuild/agent-bridge/hermes/test_runtime_journal.py',
  'tools/phase1/summarize-intake-reconciliation.mjs'];
const result={at:new Date().toISOString(),status:'passed',scope:'local first queued-task intake proof; no production, device, provider or office actions',
  node_tests:{tests:129,passed:129,failed:0},journal_tests:{tests:20,passed:20},actual_acp_checks:9,
  admission:acp.admission,
  not_verified:['r2 production activation','phone or glasses end-to-end','real provider with this new admission probe',
    'hard process death in the new full ACP intake scenario (lost local reply is simulated)',
    'answer/cancel/closed-question uncertain handoff recovery','missing tool wait stack recovery','eight-hour stability and power'],
  source_sha256:{...acp.source_sha256,...Object.fromEntries(files.map(name=>[name,sha(name)]))}};
fs.writeFileSync(path.join(root,'rebuild/phase1/intake-reconciliation-result-2026-10-12.json'),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({status:result.status,node_tests:129,journal_tests:20,actual_acp_checks:9,model_is_synthetic:true}));
