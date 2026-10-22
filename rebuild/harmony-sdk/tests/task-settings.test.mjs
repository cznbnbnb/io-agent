import test from 'node:test';import assert from 'node:assert/strict';import {loadApp} from './load-app.mjs';
function fixture(){
  let saved,mode='ok',written;const aliases=[];
  const asset={Tag:{ALIAS:1,SECRET:2,RETURN_TYPE:3,ACCESSIBILITY:4,CONFLICT_RESOLUTION:5},ReturnType:{ALL:1},Accessibility:{DEVICE_UNLOCKED:2},ConflictResolution:{OVERWRITE:3},
    async add(map){aliases.push(new TextDecoder().decode(map.get(1)));assert.equal(map.get(4),2);written=map.get(2);saved=Uint8Array.from(written);},
    async query(){if(mode==='locked')throw {code:24000003};if(mode==='absent')throw {code:24000002};return saved?[new Map([[2,Uint8Array.from(saved)]])]:[];}};
  const mod=loadApp('TaskSettings',{'@kit.AssetStoreKit':{asset}}),vault=new mod.SecureTaskSettings(),value=new mod.TaskSettings();value.enabled=true;
  Object.assign(value.target,{baseUrl:'https://synthetic.invalid/v1',token:'a'.repeat(43),principal:{ownerId:'owner',producerId:'phone',serverId:'server'}});
  Object.assign(value.route,{computer_id:'pc',agent_id:'hermes',project_id:'project',session_id:'existing-session'});
  return {vault,value,aliases,getWritten:()=>written,setMode:v=>mode=v,damage:()=>saved=new TextEncoder().encode('{broken')};
}
test('task vault is independent from daily sync, bound to unlocked device and clears serialization bytes',async()=>{
  const f=fixture();await f.vault.save(f.value);assert.deepEqual(f.aliases,['turboio.tasks.v1']);assert(f.getWritten().every(v=>v===0));
  assert.deepEqual(JSON.parse(JSON.stringify(await f.vault.load())),JSON.parse(JSON.stringify(f.value)));
});
test('only absent task settings default disabled; locked or damaged store does not overwrite saved settings',async()=>{
  const f=fixture();f.setMode('absent');assert.equal((await f.vault.load()).enabled,false);f.setMode('locked');await assert.rejects(f.vault.load(),/TASK_SETTINGS_UNAVAILABLE/);
  f.setMode('ok');await f.vault.save(f.value);f.damage();await assert.rejects(f.vault.load(),/TASK_SETTINGS_INVALID/);assert.equal(f.aliases.length,1);
});
test('task settings reject incomplete routes, nonboolean consent and path traversal before persisting',async()=>{
  for(const change of [v=>v.route.session_id='',v=>v.enabled='yes',v=>v.target.baseUrl='https://synthetic.invalid/a/../v1',v=>v.target.baseUrl='http://synthetic.invalid/v1']){
    const f=fixture();change(f.value);await assert.rejects(f.vault.save(f.value));assert.equal(f.aliases.length,0);
  }
});
