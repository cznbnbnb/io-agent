// P33 evidence entry: runs the query suite against real SQLite, real loopback
// HTTP and the real CLI, then records test names and source hashes. Synthetic
// material only; no cloud, no phone and no user conversation is involved.
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {sha} from '../json.mjs';
const serviceRoot=fileURLToPath(new URL('../',import.meta.url)),output=new URL('../verification/',import.meta.url);
fs.mkdirSync(output,{recursive:true});
const env={...process.env};delete env.TURBOIO_CONTRACT_DEV_DEPS;
const result=spawnSync(process.execPath,['--test','tests/query.test.mjs'],{cwd:serviceRoot,env,encoding:'utf8',maxBuffer:4194304});
fs.writeFileSync(new URL('query-tests.tap',output),result.stdout??'');fs.writeFileSync(new URL('query-runtime.log',output),result.stderr??'');
const files=['query/client.mjs','query/cli.mjs','query/verify.mjs','tests/query.test.mjs','store.mjs','http.mjs','json.mjs','validation.mjs','package.json','package-lock.json',
  '.node-version','../../docs/contracts/event-v1.schema.json','../../docs/contracts/event-v1.1.schema.json','../../docs/contracts/material-v1.1.json'];
const count=name=>Number(new RegExp('^# '+name+' (\\d+)$','m').exec(result.stdout??'')?.[1]??0);
const report={at:new Date().toISOString(),node:process.version,
  scope:'real local SQLite, real loopback HTTP and the real CLI subprocess; synthetic material only; no cloud, no phone, no user conversation',
  status:result.status===0?'passed':'failed',exit_code:result.status,tests:count('tests'),passed:count('pass'),failed:count('fail'),
  checks:[...(result.stdout??'').matchAll(/^ok \d+ - (.+)$/gm)].map(m=>m[1]),
  source_sha256:Object.fromEntries(files.map(f=>[f,sha(fs.readFileSync(serviceRoot+f))]))};
fs.writeFileSync(new URL('query-result.json',output),JSON.stringify(report,null,2)+'\n');
process.stdout.write(JSON.stringify({status:report.status,tests:report.tests,passed:report.passed,failed:report.failed})+'\n');process.exitCode=result.status??1;
