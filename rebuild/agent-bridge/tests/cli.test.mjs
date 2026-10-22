import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {BridgeState} from '../state.mjs';

const cli=fileURLToPath(new URL('../cli.mjs',import.meta.url));
function setup(t){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'io-bridge-cli-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const marker=path.join(dir,'adapter-started.txt'),configFile=path.join(dir,'config.json');
  const config={schema_version:'1.0',base_url:'http://127.0.0.1:1/v1/',allow_loopback_http:true,owner_id:'synthetic-owner',
    producer_id:'synthetic-agent',server_id:'synthetic-server',computer_id:'synthetic-pc',agent_id:'synthetic-runtime',
    credential_file:'missing-credential.json',state_file:'private/state.json',
    adapter_command:[process.execPath,'-e',"require('node:fs').writeFileSync(process.argv[1],'started')",marker]};
  fs.writeFileSync(configFile,JSON.stringify(config));
  const run=(...args)=>spawnSync(process.execPath,[cli,...args],{cwd:os.tmpdir(),encoding:'utf8',timeout:5000});
  return {dir,marker,configFile,config,run,stateFile:path.join(dir,'private/state.json')};
}
test('status is offline, never starts the configured runtime and never creates a ledger',t=>{
  const f=setup(t),result=f.run('status','--config',f.configFile);
  assert.equal(result.status,0,result.stderr);const value=JSON.parse(result.stdout);
  assert.equal(value.local_only,true);assert.equal(value.network_checked,false);assert.equal(value.adapter_started,false);
  assert.equal(value.started,false);assert.equal(value.pending,0);assert.equal(fs.existsSync(f.marker),false);
  assert.equal(fs.existsSync(f.stateFile),false);
});
test('status resolves ledger relative to config and preserves exact bytes including uncertainty and blocking',t=>{
  const f=setup(t),state=BridgeState.load(f.stateFile);
  state.bind(Object.fromEntries(['server_id','owner_id','producer_id','computer_id','agent_id'].map(key=>[key,f.config[key]])));
  state.serverId=f.config.server_id;state.value.dispatches['item:task:synthetic:1']={state:'prepared'};
  state.value.blocked={code:'FORBIDDEN',key:'task:synthetic:2'};state.save();
  const before=fs.readFileSync(f.stateFile),result=f.run('status','--config',f.configFile);
  assert.equal(result.status,0,result.stderr);const value=JSON.parse(result.stdout);
  assert.equal(value.uncertain_dispatches,1);assert.equal(value.blocked.code,'FORBIDDEN');
  assert.deepEqual(fs.readFileSync(f.stateFile),before);assert.equal(fs.existsSync(f.marker),false);
});
test('unknown or duplicate CLI flags fail before starting a runtime',t=>{
  const f=setup(t);
  for(const args of [['--extra','x'],['--config',f.configFile]]){
    const result=f.run('status','--config',f.configFile,...args);assert.equal(result.status,1);
    assert.equal(JSON.parse(result.stderr).error.code,'INVALID_ARGUMENTS');
  }
  assert.equal(fs.existsSync(f.marker),false);
});
