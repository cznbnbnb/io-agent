import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {nativeOwner,sameProcess,processIdentity,privateDirectory,privateRecord,residentKey,residentStatus} from '../hosts/resident-manager.mjs';

test('actual process birth identity is identical across caller timezones and locale environments',()=>{
  const script=`import {processIdentity} from ${JSON.stringify(new URL('../hosts/resident-manager.mjs',import.meta.url).href)};
    import {readProcessTable} from ${JSON.stringify(new URL('../hosts/process-witness.mjs',import.meta.url).href)};
    console.log(JSON.stringify({owner:processIdentity(${process.pid}),witness:(await readProcessTable()).get(${process.pid})}));`;
  const samples=['America/Los_Angeles','Asia/Shanghai','UTC'].map(TZ=>JSON.parse(execFileSync(process.execPath,['--input-type=module','-e',script],{
    encoding:'utf8',env:{...process.env,TZ,LANG:'zh_CN.UTF-8',LC_ALL:'zh_CN.UTF-8'}})));
  for(const value of samples){
    assert.deepEqual(value.owner,samples[0].owner);
    assert.equal(value.witness.started,samples[0].witness.started);
    assert.equal(value.owner.started,value.witness.started);
    assert(sameProcess(samples[0].owner,()=>value.owner));
  }
});

test('resident owner follows actual parent birth identity without command arguments',()=>{
  const rows=new Map([[10,{pid:10,ppid:20,uid:process.getuid(),started:'one',executable:'zsh'}],
    [20,{pid:20,ppid:1,uid:process.getuid(),started:'two',executable:'claude.exe'}]]);
  const read=id=>rows.get(id)??null,owner=nativeOwner('claude-code',{pid:10,read});
  assert.equal(owner.pid,20);assert(sameProcess(owner,read));
  rows.set(20,{...owner,started:'reused'});assert.equal(sameProcess(owner,read),false);
  assert.equal(nativeOwner('codex',{pid:10,read}),null);assert.equal(nativeOwner('workbuddy',{pid:10,read}),null);
  assert.equal(Object.hasOwn(processIdentity(process.pid),'args'),false);
});
test('resident state rejects a public directory, symlink, and public credential record',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'io-resident-test-'));fs.chmodSync(root,0o700);t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  assert.equal(privateDirectory(root),root);const file=path.join(root,'state.json');fs.writeFileSync(file,'{}',{mode:0o600});assert.deepEqual(privateRecord(file),{});
  fs.chmodSync(file,0o644);assert.throws(()=>privateRecord(file),{code:'RESIDENT_RECORD_UNTRUSTED'});
  const link=path.join(root,'link');fs.symlinkSync(root,link);assert.throws(()=>privateDirectory(link),{code:'RESIDENT_DIRECTORY_UNTRUSTED'});
  fs.chmodSync(root,0o755);assert.throws(()=>privateDirectory(root),{code:'RESIDENT_DIRECTORY_UNTRUSTED'});
});
test('a saved stale or recycled helper PID cannot claim online',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'io-resident-status-'));fs.chmodSync(root,0o700);t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const b={host_kind:'claude',workspace:root,route:{computer_id:'c',agent_id:'a',project_id:'p',session_id:'10000000-0000-4000-8000-000000000001'}};
  const directory=path.join(root,'sessions',residentKey(b));fs.mkdirSync(directory,{recursive:true,mode:0o700});
  const worker={pid:1234,uid:process.getuid(),started:'first',executable:'node'},health={binding_key:residentKey(b),worker,at:new Date().toISOString(),cloud_online:true,can_execute:true};
  const file=path.join(directory,'health.json');fs.writeFileSync(file,JSON.stringify(health),{mode:0o600});
  assert.equal(residentStatus(b,{home:root,read:()=>worker}).can_execute,true);
  assert.equal(residentStatus(b,{home:root,read:()=>({...worker,started:'new'})}).resident_live,false);
  health.at='2000-01-01T00:00:00.000Z';fs.writeFileSync(file,JSON.stringify(health));assert.equal(residentStatus(b,{home:root,read:()=>worker}).resident_live,false);
});
