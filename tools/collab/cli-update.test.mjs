import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import crypto from 'node:crypto';import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
const py=path.resolve('.runtime/hermes-agent/.venv/bin/python3'),helper=path.resolve('tools/collab/workbuddy-package/update_package.py'),hash=b=>crypto.createHash('sha256').update(b).digest('hex');

function snapshot(directory){
 const entries={};
 const visit=relative=>{const file=path.join(directory,relative),stat=fs.lstatSync(file);entries[relative]={mode:stat.mode,...(stat.isFile()?{hash:hash(fs.readFileSync(file)),mtime:stat.mtimeMs}: {})};if(stat.isDirectory())for(const name of fs.readdirSync(file).sort())visit(path.join(relative,name));};
 visit('');return entries;
}

function fixture(version,{source='a'.repeat(40),readme='Synthetic source-only package'}={}){
 const files={'package.json':JSON.stringify({name:'cz-iot-cli',version,type:'module'}),'README.md':readme};
 for(const name of ['cz-iot-cli.mjs','io-agent.mjs','setup.mjs','update.mjs','update_package.py'])files[name]='// synthetic package file';
 files['MANIFEST.json']=JSON.stringify({format:'cz-iot-cli-package/1',name:'cz-iot-cli',entrypoint:'cz-iot-cli.mjs',contains_credentials:false,source_commit:source,files:Object.fromEntries(Object.entries(files).map(([name,body])=>[name,hash(body)]))});
 return files;
}

function versionFixture(t,installed,candidate,installedOptions={},candidateOptions={}){
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'cz-cli-semver-'));t.after(()=>fs.rmSync(temp,{recursive:true,force:true}));
 const root=path.join(temp,'installed');fs.mkdirSync(root);
 for(const [name,body] of Object.entries(fixture(installed,installedOptions)))fs.writeFileSync(path.join(root,name),body);
 for(const name of ['.io-agent/pairings/synthetic.json','.io-agent/sessions/running.sqlite','rebuild/agent-bridge/private/run-context.json','unrelated-user-file.txt']){const file=path.join(root,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,'SYNTHETIC-LOCAL-STATE-KEEP',{mode:0o600});}
 const archive=path.join(temp,'cz-iot-cli.zip'),checksums=path.join(temp,'SHA256SUMS');
 const zipped=spawnSync(py,['-I','-S','-B','-c','import json,sys,zipfile\nwith zipfile.ZipFile(sys.argv[1],"w",zipfile.ZIP_DEFLATED) as z:\n for name,body in json.load(sys.stdin).items():z.writestr("cz-iot-cli/"+name,body)',archive],{input:JSON.stringify(fixture(candidate,candidateOptions)),encoding:'utf8'});assert.equal(zipped.status,0,zipped.stderr);
 fs.writeFileSync(checksums,hash(fs.readFileSync(archive))+'  cz-iot-cli.zip\n');
 const run=check=>{const result=spawnSync(py,['-I','-S','-B',helper,'--root',root,'--archive',archive,'--checksums',checksums,...(check?['--check']:[])],{encoding:'utf8',timeout:30000});return {status:result.status,body:JSON.parse(result.stdout)};};
 return {root,run};
}

test('private Git distribution update checks first, applies code, preserves state and is repeatable',async t=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'cz-cli-update-test-')),repo=path.join(temp,'repo'),install=path.join(temp,'install');fs.mkdirSync(repo);fs.mkdirSync(install);const priorPython=process.env.IO_AGENT_PYTHON;process.env.IO_AGENT_PYTHON=py;t.after(()=>{if(priorPython===undefined)delete process.env.IO_AGENT_PYTHON;else process.env.IO_AGENT_PYTHON=priorPython;fs.rmSync(temp,{recursive:true,force:true});});
 const run=(cmd,args,where=repo)=>{const r=spawnSync(cmd,args,{cwd:where,encoding:'utf8',timeout:30000,maxBuffer:1048576});assert.equal(r.status,0,r.stderr);return r.stdout;};
 const packageFile=path.join(temp,'cz-iot-cli.zip');run(py,['-I','-S','-B',path.resolve('tools/collab/package-workbuddy.py'),'--output',packageFile]);
 run(py,['-I','-S','-B','-c','import zipfile,sys;zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])',packageFile,install]);const root=path.join(install,'cz-iot-cli');
 const version=JSON.parse(fs.readFileSync(path.join(root,'package.json'))).version,{update}=await import(pathToFileURL(path.join(root,'update.mjs')));
 fs.writeFileSync(path.join(root,'README.md'),'old documentation');const before=hash(fs.readFileSync(path.join(root,'README.md')));
 const secrets=['.io-agent/pairings/synthetic.json','rebuild/agent-bridge/private/synthetic-context.json','unrelated-user-file.txt'];for(const file of secrets){fs.mkdirSync(path.dirname(path.join(root,file)),{recursive:true});fs.writeFileSync(path.join(root,file),'SYNTHETIC-LOCAL-STATE-KEEP');}
 run('git',['init','--quiet','--initial-branch=main']);const distribution=path.join(repo,'docs/distribution');fs.mkdirSync(distribution,{recursive:true});
 const publish=()=>{const zip=fs.readFileSync(path.join(distribution,'cz-iot-cli.zip'));fs.writeFileSync(path.join(distribution,'SHA256SUMS'),hash(zip)+'  cz-iot-cli.zip\n');run('git',['add','.']);run('git',['-c','user.name=synthetic','-c','user.email=synthetic@example.invalid','-c','commit.gpgsign=false','commit','--quiet','-m','synthetic distribution']);};
 fs.copyFileSync(packageFile,path.join(distribution,'cz-iot-cli.zip'));publish();const options={directory:root,repository:repo,branch:'main'};
 const check=await update(['--check'],options);assert.equal(check.available,true);assert.equal(check.updated,false);assert.equal(hash(fs.readFileSync(path.join(root,'README.md'))),before);
 const applied=await update([],options);assert.equal(applied.updated,true);assert.equal(applied.version,version);assert.equal(applied.pairing_state_touched,false);assert.equal(applied.running_connectors_need_restart,true);assert.notEqual(hash(fs.readFileSync(path.join(root,'README.md'))),before);
 for(const file of secrets)assert.equal(fs.readFileSync(path.join(root,file),'utf8'),'SYNTHETIC-LOCAL-STATE-KEEP');assert.equal((await update([],options)).updated,false);
 const help=JSON.parse(run(process.execPath,[path.join(root,'cz-iot-cli.mjs'),'help'],temp));assert.equal(help.cli_version,version);assert.match(help.commands.update,/--check/);
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
 // The JavaScript entry preserves the explicit downgrade status and error from the helper.
 run(py,['-I','-S','-B','-c',`import hashlib,json,sys,zipfile
file=sys.argv[1]
with zipfile.ZipFile(file) as z:payload={name:z.read(name) for name in z.namelist()}
name='cz-iot-cli/package.json';package=json.loads(payload[name]);package['version']='0.0.0';payload[name]=json.dumps(package).encode()
name='cz-iot-cli/MANIFEST.json';manifest=json.loads(payload[name]);manifest['files']['package.json']=hashlib.sha256(payload['cz-iot-cli/package.json']).hexdigest();payload[name]=json.dumps(manifest).encode()
with zipfile.ZipFile(file,'w',zipfile.ZIP_DEFLATED) as z:
 for name,body in payload.items():z.writestr(name,body)`,path.join(distribution,'cz-iot-cli.zip')]);publish();
 const protectedState=snapshot(root),older=await update(['--check'],options);
 assert.equal(older.available,false);assert.equal(older.status,'downgrade_blocked');assert.equal(older.installed_version,version);
 await assert.rejects(update([],options),error=>error.message==='UPDATE_DOWNGRADE_REFUSED'&&error.report.status==='downgrade_blocked'&&error.report.updated===false);
 assert.deepEqual(snapshot(root),protectedState);fs.copyFileSync(packageFile,path.join(distribution,'cz-iot-cli.zip'));publish();
 // A malformed/corrupt published package cannot alter installed code or state.
 const codeHash=hash(fs.readFileSync(path.join(root,'cz-iot-cli.mjs')));fs.appendFileSync(path.join(distribution,'cz-iot-cli.zip'),'corrupt');run('git',['add','.']);run('git',['-c','user.name=synthetic','-c','user.email=synthetic@example.invalid','-c','commit.gpgsign=false','commit','--quiet','-m','synthetic corruption']);
 await assert.rejects(update([],options),{message:'UPDATE_ARCHIVE_HASH_MISMATCH'});assert.equal(hash(fs.readFileSync(path.join(root,'cz-iot-cli.mjs'))),codeHash);
 fs.copyFileSync(packageFile,path.join(distribution,'cz-iot-cli.zip'));run(py,['-I','-S','-B','-c','import zipfile,sys\nwith zipfile.ZipFile(sys.argv[1],"a") as z:z.writestr("cz-iot-cli/../agent-device.json","not-allowed")',path.join(distribution,'cz-iot-cli.zip')]);publish();
 await assert.rejects(update([],options),{message:'UPDATE_PACKAGE_PATH_INVALID'});for(const file of secrets)assert.equal(fs.readFileSync(path.join(root,file),'utf8'),'SYNTHETIC-LOCAL-STATE-KEEP');assert.equal(hash(fs.readFileSync(path.join(root,'cz-iot-cli.mjs'))),codeHash);
 assert.equal(fs.readdirSync(root).some(n=>n.startsWith('.cz-iot-cli-update-')),false);
});

for(const [installed,candidate,relation] of [
 ['0.2.9','0.2.10','newer'],['0.2.10','0.2.9','older'],
 ['0.3.0','0.2.999','older'],['1.0.0','2.0.0','newer'],
 ['0.2.5-beta.2','0.2.5-beta.11','newer'],['0.2.5-beta.11','0.2.5-beta.2','older'],
 ['0.2.5-rc.9','0.2.5','newer'],['0.2.5','0.2.5-rc.10','older'],
 ['1.0.0-alpha','1.0.0-alpha.1','newer'],['1.0.0-alpha.1','1.0.0-alpha.beta','newer'],
 ['1.0.0-beta.11','1.0.0-rc.1','newer'],['1.0.0-11','1.0.0-beta','newer'],['1.0.0-beta','1.0.0-11','older'],
 ['0.2.5+build.10','0.2.5+build.2','same']
])test(`update compares SemVer ${installed} -> ${candidate} as ${relation}`,t=>{
 const f=versionFixture(t,installed,candidate),before=snapshot(f.root),check=f.run(true);
 assert.equal(check.status,0);assert.equal(check.body.version_relation,relation);assert.equal(check.body.installed_version,installed);assert.equal(check.body.version,candidate);assert.deepEqual(snapshot(f.root),before,'check writes no code, pairing or run state');
 const applied=f.run(false);
 if(relation==='older'){
  assert.equal(check.body.available,false);assert.equal(check.body.status,'downgrade_blocked');assert.equal(check.body.changed_files,0);
  assert.equal(applied.status,1);assert.equal(applied.body.error,'UPDATE_DOWNGRADE_REFUSED');assert.equal(applied.body.updated,false);assert.equal(applied.body.pairing_state_touched,false);assert.equal(applied.body.running_connectors_need_restart,false);
  assert.deepEqual(snapshot(f.root),before,'refused downgrade creates, replaces and removes no file or directory');
 }else{
  assert.equal(check.body.available,true);assert.equal(applied.status,0);assert.equal(applied.body.updated,true);
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.root,'package.json'))).version,candidate);
  assert.equal(f.run(true).body.available,false);
 }
});

test('same version/source is idempotent but does not hide a legitimate content-only repair',t=>{
 const unchanged=versionFixture(t,'0.2.5','0.2.5'),before=snapshot(unchanged.root);
 assert.equal(unchanged.run(true).body.status,'up_to_date');assert.equal(unchanged.run(false).body.updated,false);assert.deepEqual(snapshot(unchanged.root),before);
 const repair=versionFixture(t,'0.2.5','0.2.5',{}, {readme:'Repaired instructions, same version and source commit'}),check=repair.run(true);
 assert.equal(check.body.version_relation,'same');assert.equal(check.body.available,true);assert.equal(check.body.status,'update_available');assert.equal(repair.run(false).body.updated,true);
 assert.match(fs.readFileSync(path.join(repair.root,'README.md'),'utf8'),/Repaired instructions/);assert.equal(repair.run(false).body.status,'up_to_date');
 const sourceChange=versionFixture(t,'0.2.5','0.2.5',{}, {source:'b'.repeat(40)});
 assert.equal(sourceChange.run(true).body.available,true);assert.equal(sourceChange.run(false).body.updated,true);
});

for(const invalid of ['01.2.5','0.02.5','0.2.05','0.2.5-beta.01','0.2.5-beta..1','0.2.5+','0.2.5-'])test(`invalid SemVer ${invalid} cannot modify installation`,t=>{
 const candidate=versionFixture(t,'0.2.5',invalid),before=snapshot(candidate.root);
 for(const check of [true,false]){const result=candidate.run(check);assert.equal(result.status,1);assert.equal(result.body.error,'UPDATE_VERSION_INVALID');assert.deepEqual(snapshot(candidate.root),before);}
 const installed=versionFixture(t,invalid,'0.2.5'),invalidBefore=snapshot(installed.root);
 assert.equal(installed.run(false).body.error,'UPDATE_VERSION_INVALID');assert.deepEqual(snapshot(installed.root),invalidBefore);
});
