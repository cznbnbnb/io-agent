import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {loadCore} from './load-core.mjs';
test('actual ETS adapter uses fresh SHA256 objects; platform crypto replaced only in host test',()=>{
 let created=0;
 const cryptoFramework={createMd:name=>{
  assert.equal(name,'SHA256');created++;let data;
  return {updateSync:input=>{assert(input.data instanceof Uint8Array);data=input.data;},
   digestSync:()=>({data:Uint8Array.from(createHash('sha256').update(data).digest())})};
 }};
 const {HarmonySha256}=loadCore('./HarmonySha256',{'@kit.CryptoArchitectureKit':{cryptoFramework}});
 const sha=new HarmonySha256();
 assert.equal(Buffer.from(sha.digest(new Uint8Array())).toString('hex'),'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
 sha.digest(Uint8Array.of(1));assert.equal(created,2);
});
test('platform errors propagate as fixed safe failure, never sensitive provider text',()=>{
 for(const stage of ['create','update','digest']){
  const fail=()=>{throw Error('DO-NOT-LOG-SECRET');};
  const cryptoFramework={createMd:()=>{
   if(stage==='create')fail();return {updateSync:()=>{if(stage==='update')fail();},digestSync:fail};
  }};
  const {HarmonySha256}=loadCore('./HarmonySha256',{'@kit.CryptoArchitectureKit':{cryptoFramework}});
  assert.throws(()=>new HarmonySha256().digest(Uint8Array.of(1)),/^Error: sha256-failed$/);
 }
});
