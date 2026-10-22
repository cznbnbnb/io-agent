import test from 'node:test';import assert from 'node:assert/strict';import {loadApp} from './load-app.mjs';

const turn=()=>new Promise(setImmediate);
function fixture(){
  const loads=[],configurations=[],instances=[];let saved,saveError=false,stopRelease;
  class Coordinator{
    constructor(){this.changed=()=>{};this.enabled=false;instances.push(this);}
    setForeground(v){this.foreground=v;}
    async configure(target){this.enabled=!!target;configurations.push(target?JSON.parse(JSON.stringify(target)):undefined);}
    async stop(){this.enabled=false;return new Promise(r=>stopRelease=r);}
    summary(){return{enabled:this.enabled};}view(){return{};}async tick(){}
  }
  class Vault{
    async load(){return new Promise((resolve,reject)=>loads.push({resolve,reject}));}
    async save(value){if(saveError)throw Error('synthetic storage unavailable');saved=JSON.parse(JSON.stringify(value));}
  }
  const {MaterialSyncService}=loadApp('MaterialSyncService',{
    './MaterialSyncCoordinator':{MaterialSyncCoordinator:Coordinator,MaterialSyncSummary:class{},MaterialSyncView:class{}},
    './MaterialSyncSettings':{SecureMaterialSyncSettings:Vault,validateMaterialSyncSettings(){}}
  });
  const service=new MaterialSyncService();service.initialize('/synthetic',{});
  const config={schema:1,enabled:true,target:{baseUrl:'https://synthetic.invalid/v1',token:'a'.repeat(43),principal:{ownerId:'owner',producerId:'phone',serverId:'server'}}};
  return {service,config,loads,configurations,instances,getSaved:()=>saved,setSaveError:()=>saveError=true,releaseStop:()=>stopRelease()};
}
test('late vault read cannot re-enable old credentials after explicit disable/save',async()=>{
  const f=fixture();const old=f.service.reload();await turn();assert.equal(f.loads.length,1);
  await f.service.save({...f.config,enabled:false});f.loads[0].resolve(f.config);await old;
  assert.equal(f.service.summary().enabled,false);assert.equal(f.getSaved().enabled,false);assert(f.configurations.every(x=>x===undefined));
});
test('unreadable vault pauses sync and never writes an empty replacement; next foreground can retry',async()=>{
  const f=fixture();await f.service.save(f.config);assert.equal(f.service.summary().enabled,true);
  const locked=f.service.reload();await turn();assert.equal(f.service.summary().enabled,false);
  f.loads[0].reject(Error('synthetic locked asset'));await locked;assert.match(f.service.settingsNote,/暂不可读/);
  assert.equal(f.getSaved().enabled,true);const retry=f.service.reload();await turn();f.loads[1].resolve(f.config);await retry;
  assert.equal(f.service.summary().enabled,true);assert.equal(f.service.settingsNote,'');
});
test('failed save stays paused and concurrent writes are refused without changing stored settings',async()=>{
  const f=fixture();await f.service.save(f.config);f.setSaveError();
  const saving=f.service.save({...f.config,target:{...f.config.target,token:'b'.repeat(43)}});
  await assert.rejects(f.service.save(f.config),/忙/);await assert.rejects(saving,/未启用/);
  assert.equal(f.service.summary().enabled,false);assert.equal(f.getSaved().target.token,'a'.repeat(43));
});
test('new runtime waits for old coordinator to close before it configures a second durable writer',async()=>{
  const f=fixture();const disposal=f.service.dispose();f.service.initialize('/synthetic',{});
  const reload=f.service.reload();await turn();assert.equal(f.instances.length,2);assert.equal(f.loads.length,0);
  f.releaseStop();await disposal;await turn();assert.equal(f.loads.length,1);f.loads[0].resolve(f.config);await reload;
  assert.equal(f.instances[0].enabled,false);assert.equal(f.instances[1].enabled,true);
});
