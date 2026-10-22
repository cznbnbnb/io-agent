// P41 evidence entry: runs the bridge suite against a real loopback service
// (real SQLite, real HTTP, real child processes where the test needs them) and
// records test names plus hashes of the code under test.
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const root=fileURLToPath(new URL('./',import.meta.url)),output=new URL('./verification/',import.meta.url);
fs.mkdirSync(output,{recursive:true});
const suites=['tests/bridge.test.mjs','tests/adapter-host.test.mjs','tests/cli.test.mjs','tests/run-lock.test.mjs','tests/state-save.test.mjs'];
const run=file=>{
  const result=spawnSync(process.execPath,['--test',file],{cwd:root,encoding:'utf8',maxBuffer:4194304});
  const text=result.stdout??'',count=name=>Number(new RegExp('^# '+name+' (\\d+)$','m').exec(text)?.[1]??0);
  return {file,status:result.status===0&&count('tests')>0&&count('fail')===0&&count('pass')+count('skipped')===count('tests')?'passed':'failed',
    tests:count('tests'),passed:count('pass'),failed:count('fail'),skipped:count('skipped'),
    checks:[...text.matchAll(/^ok \d+ - (.+)$/gm)].filter(match=>!/\s# SKIP\b/.test(match[1])).map(match=>match[1]),tap:text,runtime:result.stderr??''};
};
const reports=suites.map(run);
fs.writeFileSync(new URL('tests.tap',output),reports.map(report=>report.tap).join(''));
fs.writeFileSync(new URL('runtime.log',output),reports.map(report=>report.runtime).join(''));
const sha=file=>createHash('sha256').update(fs.readFileSync(root+file)).digest('hex');
const files=['bridge.mjs','state.mjs','client.mjs','cli.mjs','adapter-host.mjs','run-lock.mjs','runtime-events.mjs','verify.mjs',
  'tests/bridge.test.mjs','tests/adapter-host.test.mjs','tests/cli.test.mjs','tests/run-lock.test.mjs','tests/state-save.test.mjs',
  'tests/fixtures/runtime-adapter.mjs','tests/fixtures/crash-dispatch.mjs','tests/fixtures/lock-worker.mjs',
  '../material-server/store.mjs','../material-server/http.mjs','../material-server/json.mjs',
  '../../docs/contracts/event-v1.schema.json','../../docs/contracts/normal.json'];
const sum=key=>reports.reduce((total,report)=>total+report[key],0);
const report={at:new Date().toISOString(),node:process.version,
  scope:'real loopback SQLite/HTTP with synthetic P14 objects; actual separate processes and OS-backed ownership locks on Windows local filesystems; offline CLI status; test runtime only, no real Agent, cloud or user data',
  status:reports.every(value=>value.status==='passed')?'passed':'failed',tests:sum('tests'),passed:sum('passed'),failed:sum('failed'),skipped:sum('skipped'),
  suites:reports.map(({file,status,tests,passed,failed,skipped})=>({file,status,tests,passed,failed,skipped})),
  checks:reports.flatMap(value=>value.checks),
  guarantees:['identity and scope preflight before any queue work; live credential replacement rechecks identity',
    'observe-only adapter never invokes runtime work, writes queue facts or advances inbox cursor',
    'computer and agent route binding; durable ledger bound to owner, producer, server and runtime route',
    'retry reuses identical persisted bytes; predecessor revisions cannot be overtaken during retry',
    'POST and event reconciliation require matching server-stored acknowledgement, not just HTTP success',
    'prepared dispatch persisted before runtime handoff; actual child-process death leaves uncertainty and prevents automatic redispatch',
    'offline cursor preserved in tested restart scenarios, not a general exactly-once runtime guarantee',
    'corrupt or nonempty unbound legacy state stops without resetting the ledger',
    'question answer delivered once in tested scenarios; delayed question upload preserves waiting record across restart',
    'permanent rejection remains blocked after restart and keeps its envelope',
    'adapter runs as a separate process with declared capabilities','a silent or crashed adapter is never treated as success',
    'protocol failure revokes execution capability and remains fatal until confirmed stop and a fresh handshake; unknown response ids are rejected',
    'optional delayed runtime events bind to durable bridge-issued deliveries; event dedupe facts and outgoing effects saved atomically before runtime acknowledgement',
    'lost runtime acknowledgement replays after bridge restart without duplicate effects in tested synthetic scenarios',
    'exclusive OS-backed SQLite ownership for canonical ledger and same-user server/owner/computer/agent runtime, verified with two real processes',
    'hard process death releases ownership but does not clear uncertain dispatch records',
    'concurrent start/poll/flush rejected; stop drains active work and confirms adapter process exit before releasing ownership',
    'tested invalid adapter actions leave no partial outgoing events; runtime dispatch evidence is retained',
    'CLI status reads only local state; no authentication, adapter launch or ledger write',
    'exact durable original-task and answer intake proofs only; no repeated executable handoff or fabricated task resume',
    'on Windows, bounded same-byte atomic replacement retries preserve old ledger on failure and recheck ownership'],
  not_verified:['a real Hermes session adapter or original suspended task continuation','automatic reconciliation of uncertain runtime execution',
    'interprocess locking on Linux/macOS or network filesystems','ownership across different OS accounts or remote computers',
    'complete adapter action and response schema enforcement','real runtime event persistence, original waitpoint recovery or terminal-event automatic resolution',
    'real phone or cloud endpoint','audio upload','same-principal credential renewal','long-run stability',
    ...(process.platform==='win32'?[]:['Windows atomic replacement cases skipped on this host']),
    ...(sum('skipped')>0?['skipped test cases are not verified; see tests.tap for dependency/platform reasons']:[])],
  source_sha256:Object.fromEntries(files.map(file=>[file,sha(file)]))};
fs.writeFileSync(new URL('result.json',output),JSON.stringify(report,null,2)+'\n');
process.stdout.write(JSON.stringify({status:report.status,tests:report.tests,passed:report.passed,failed:report.failed})+'\n');
process.exitCode=report.status==='passed'?0:1;
