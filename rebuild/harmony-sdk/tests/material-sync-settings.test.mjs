import test from 'node:test';import assert from 'node:assert/strict';
import {loadApp} from './load-app.mjs';

function fixture(){
  let saved,mode='ok',written;const aliases=[];
  const asset={Tag:{ALIAS:1,SECRET:2,RETURN_TYPE:3,ACCESSIBILITY:4,CONFLICT_RESOLUTION:5},ReturnType:{ALL:1},Accessibility:{DEVICE_UNLOCKED:2},ConflictResolution:{OVERWRITE:3},
    async add(map){aliases.push(new TextDecoder().decode(map.get(1)));written=map.get(2);saved=Uint8Array.from(written);},
    async query(){if(mode==='locked')throw {code:24000003};if(mode==='absent')throw {code:24000002};return saved?[new Map([[2,Uint8Array.from(saved)]])]:[];}};
  const mod=loadApp('MaterialSyncSettings',{'@kit.AssetStoreKit':{asset}}),vault=new mod.SecureMaterialSyncSettings();
  const value=new mod.MaterialSyncSettings();value.enabled=true;Object.assign(value.target,{baseUrl:'https://synthetic.invalid/v1',token:'a'.repeat(43),principal:{ownerId:'owner',producerId:'phone',serverId:'server'}});
  return {...mod,vault,value,aliases,getWritten:()=>written,setMode:v=>mode=v,damage:()=>saved=new TextEncoder().encode('{broken')};
}
test('sync credentials use separate unlocked-device asset alias; serialization buffers are cleared',async()=>{
  const f=fixture();await f.vault.save(f.value);assert.deepEqual(f.aliases,['turboio.material-sync.v1']);assert(f.getWritten().every(x=>x===0));
  assert.deepEqual(JSON.parse(JSON.stringify(await f.vault.load())),JSON.parse(JSON.stringify(f.value)));
});
test('only genuinely absent settings default disabled; lock or corruption never becomes an empty replacement',async()=>{
  const f=fixture();f.setMode('absent');assert.equal((await f.vault.load()).enabled,false);
  f.setMode('locked');await assert.rejects(f.vault.load(),/SYNC_SETTINGS_UNAVAILABLE/);
  f.setMode('ok');await f.vault.save(f.value);f.damage();await assert.rejects(f.vault.load(),/SYNC_SETTINGS_INVALID/);assert.equal(f.aliases.length,1);
});
test('insecure targets, malformed principals and nonboolean consent cannot be persisted even disabled',async()=>{
  for(const edit of [v=>v.target.baseUrl='http://synthetic.invalid/v1',v=>v.target.principal.ownerId=123,v=>v.enabled='yes',v=>v.target.token='bad']){
    const f=fixture();edit(f.value);await assert.rejects(f.vault.save(f.value));assert.equal(f.aliases.length,0);
  }
});
