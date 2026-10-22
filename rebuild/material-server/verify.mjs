import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {sha} from './json.mjs';
const root=fileURLToPath(new URL('./',import.meta.url)),output=new URL('./verification/',import.meta.url);
fs.mkdirSync(output,{recursive:true});
const env={...process.env};delete env.TURBOIO_CONTRACT_DEV_DEPS;
const suites=[{file:'tests/service.test.mjs',tap:'tests.tap',log:'runtime.log'},{file:'tests/queue.test.mjs',tap:'queue-tests.tap',log:'queue-runtime.log'},
  {file:'tests/operations.test.mjs',tap:'operations-tests.tap',log:'operations-runtime.log'},
  {file:'tests/request-lifecycle.test.mjs',tap:'request-lifecycle-tests.tap',log:'request-lifecycle-runtime.log'},
  {file:'tests/query.test.mjs',tap:'query-tests.tap',log:'query-runtime.log'},
  {file:'tests/speakers.test.mjs',tap:'speaker-tests.tap',log:'speaker-runtime.log'}];
const count=(text,name)=>Number(new RegExp('^# '+name+' (\\d+)$','m').exec(text)?.[1]??0);
const run=({file,tap,log})=>{
  const result=spawnSync(process.execPath,['--test',file],{cwd:root,env,encoding:'utf8',maxBuffer:4194304});
  fs.writeFileSync(new URL(tap,output),result.stdout??'');fs.writeFileSync(new URL(log,output),result.stderr??'');
  const text=result.stdout??'';
  return {file,status:result.status===0&&count(text,'tests')>0&&count(text,'tests')===count(text,'pass')?'passed':'failed',tests:count(text,'tests'),passed:count(text,'pass'),failed:count(text,'fail'),
    checks:[...text.matchAll(/^ok \d+ - (.+)$/gm)].map(m=>m[1])};
};
const reports=suites.map(run);
const files=['store.mjs','http.mjs','json.mjs','validation.mjs','cli.mjs','traffic.mjs','admin/index.html','admin/app.js','admin/style.css','verify.mjs','package.json','package-lock.json','.node-version',
  'tests/service.test.mjs','tests/queue.test.mjs','tests/operations.test.mjs','tests/worker.mjs',
  'tests/request-lifecycle.test.mjs','tests/request-lifecycle-worker.mjs','../../docs/contracts/request-lifecycle.json',
  'tests/query.test.mjs','tests/speakers.test.mjs','query/client.mjs','query/cli.mjs',
  '../../docs/contracts/material-v1.2.json','../../docs/contracts/event-v1.2.schema.json',
  '../harmony-sdk/tests/material-fixture.mjs','../harmony-sdk/tests/load-app.mjs','../harmony-sdk/tests/load-core.mjs',
  '../harmony-sdk/entry/src/main/ets/MaterialStore.ets','../harmony-sdk/entry/src/main/ets/MaterialWire.ets','../harmony-sdk/entry/src/main/ets/MaterialTranscript.ets',
  '../../docs/contracts/event-v1.schema.json','../../docs/contracts/event-v1.1.schema.json',
  '../phase1/device-p21-wire39-seed.json','../phase1/device-p21-wire39-resume.json'];
const sum=key=>reports.reduce((total,value)=>total+value[key],0);
const report={at:new Date().toISOString(),node:process.version,scope:'real local SQLite/process/HTTP; synthetic data only; no cloud or phone network',
  status:reports.every(value=>value.status==='passed')?'passed':'failed',tests:sum('tests'),passed:sum('passed'),failed:sum('failed'),
  suites:reports.map(({file,status,tests,passed,failed})=>({file,status,tests,passed,failed})),
  checks:reports.flatMap(value=>value.checks),
  source_sha256:Object.fromEntries(files.map(f=>[f,sha(fs.readFileSync(root+f))]))};
fs.writeFileSync(new URL('result.json',output),JSON.stringify(report,null,2)+'\n');
process.stdout.write(JSON.stringify({status:report.status,tests:report.tests,passed:report.passed,failed:report.failed,
  suites:report.suites.map(v=>`${v.file}:${v.passed}/${v.tests}`).join(' ')})+'\n');
process.exitCode=report.status==='passed'?0:1;
