import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import crypto from 'node:crypto';import {spawnSync} from 'node:child_process';
import {update} from './workbuddy-package/update.mjs';
const py=path.resolve('.runtime/hermes-agent/.venv/bin/python3'),packageFile=path.resolve('outputs/cz-iot-cli.zip'),hash=b=>crypto.createHash('sha256').update(b).digest('hex');

test('private Git distribution update checks first, applies code, preserves state and is repeatable',async t=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'cz-cli-update-test-')),repo=path.join(temp,'repo'),install=path.join(temp,'install');fs.mkdirSync(repo);fs.mkdirSync(install);const priorPython=process.env.IO_AGENT_PYTHON;process.env.IO_AGENT_PYTHON=py;t.after(()=>{if(priorPython===undefined)delete process.env.IO_AGENT_PYTHON;else process.env.IO_AGENT_PYTHON=priorPython;fs.rmSync(temp,{recursive:true,force:true});});
 const run=(cmd,args,where=repo)=>{const r=spawnSync(cmd,args,{cwd:where,encoding:'utf8',timeout:30000,maxBuffer:1048576});assert.equal(r.status,0,r.stderr);return r.stdout;};
 run(py,['-I','-S','-B','-c','import zipfile,sys;zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])',packageFile,install]);const root=path.join(install,'cz-iot-cli');
 fs.writeFileSync(path.join(root,'README.md'),'old documentation');const before=hash(fs.readFileSync(path.join(root,'README.md')));
 const secrets=['.io-agent/pairings/synthetic.json','rebuild/agent-bridge/private/synthetic-context.json','unrelated-user-file.txt'];for(const file of secrets){fs.mkdirSync(path.dirname(path.join(root,file)),{recursive:true});fs.writeFileSync(path.join(root,file),'SYNTHETIC-LOCAL-STATE-KEEP');}
 run('git',['init','--quiet','--initial-branch=main']);const distribution=path.join(repo,'docs/distribution');fs.mkdirSync(distribution,{recursive:true});
 const publish=()=>{const zip=fs.readFileSync(path.join(distribution,'cz-iot-cli.zip'));fs.writeFileSync(path.join(distribution,'SHA256SUMS'),hash(zip)+'  cz-iot-cli.zip\n');run('git',['add','.']);run('git',['-c','user.name=synthetic','-c','user.email=synthetic@example.invalid','-c','commit.gpgsign=false','commit','--quiet','-m','synthetic distribution']);};
 fs.copyFileSync(packageFile,path.join(distribution,'cz-iot-cli.zip'));publish();const options={directory:root,repository:repo,branch:'main'};
 const check=await update(['--check'],options);assert.equal(check.available,true);assert.equal(check.updated,false);assert.equal(hash(fs.readFileSync(path.join(root,'README.md'))),before);
 const applied=await update([],options);assert.equal(applied.updated,true);assert.equal(applied.version,'0.2.0');assert.equal(applied.pairing_state_touched,false);assert.equal(applied.running_connectors_need_restart,true);assert.notEqual(hash(fs.readFileSync(path.join(root,'README.md'))),before);
 for(const file of secrets)assert.equal(fs.readFileSync(path.join(root,file),'utf8'),'SYNTHETIC-LOCAL-STATE-KEEP');assert.equal((await update([],options)).updated,false);
 const help=JSON.parse(run(process.execPath,[path.join(root,'cz-iot-cli.mjs'),'help'],temp));assert.equal(help.cli_version,'0.2.0');assert.match(help.commands.update,/--check/);
 fs.writeFileSync(path.join(root,'AGENTS.md'),'old Agent instructions');fs.writeFileSync(path.join(root,'README.md'),'old readme');
 const rollbackHashes=['AGENTS.md','README.md'].map(n=>hash(fs.readFileSync(path.join(root,n))));
 const rollback=spawnSync(py,['-I','-S','-B','-c',`import runpy,sys,os
ns=runpy.run_path(sys.argv[1]);sys.argv=[sys.argv[1],'--root',sys.argv[2],'--archive',sys.argv[3],'--checksums',sys.argv[4]]
original=os.replace;calls=[0]
def locked_once(a,b):
 calls[0]+=1
 if calls[0]==2:raise PermissionError('synthetic locked file')
 return original(a,b)
os.replace=locked_once
ns['main']()`,path.resolve('tools/collab/workbuddy-package/update_package.py'),root,path.join(distribution,'cz-iot-cli.zip'),path.join(distribution,'SHA256SUMS')],{encoding:'utf8',timeout:30000});assert.equal(rollback.status,1);assert.match(rollback.stderr,/UPDATE_APPLY_FAILED/);assert.deepEqual(['AGENTS.md','README.md'].map(n=>hash(fs.readFileSync(path.join(root,n)))),rollbackHashes);assert.equal((await update([],options)).updated,true);
 // A malformed/corrupt published package cannot alter installed code or state.
 const codeHash=hash(fs.readFileSync(path.join(root,'cz-iot-cli.mjs')));fs.appendFileSync(path.join(distribution,'cz-iot-cli.zip'),'corrupt');run('git',['add','.']);run('git',['-c','user.name=synthetic','-c','user.email=synthetic@example.invalid','-c','commit.gpgsign=false','commit','--quiet','-m','synthetic corruption']);
 await assert.rejects(update([],options),{message:'UPDATE_ARCHIVE_HASH_MISMATCH'});assert.equal(hash(fs.readFileSync(path.join(root,'cz-iot-cli.mjs'))),codeHash);
 fs.copyFileSync(packageFile,path.join(distribution,'cz-iot-cli.zip'));run(py,['-I','-S','-B','-c','import zipfile,sys\nwith zipfile.ZipFile(sys.argv[1],"a") as z:z.writestr("cz-iot-cli/../agent-device.json","not-allowed")',path.join(distribution,'cz-iot-cli.zip')]);publish();
 await assert.rejects(update([],options),{message:'UPDATE_PACKAGE_PATH_INVALID'});for(const file of secrets)assert.equal(fs.readFileSync(path.join(root,file),'utf8'),'SYNTHETIC-LOCAL-STATE-KEEP');assert.equal(hash(fs.readFileSync(path.join(root,'cz-iot-cli.mjs'))),codeHash);
 assert.equal(fs.readdirSync(root).some(n=>n.startsWith('.cz-iot-cli-update-')),false);
});
