import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {AndroidAuthCalculations,decodeHex,proofMatches} from '../turbo_core/src/main/ets/AuthCalculations.ts';
const digest=bytes=>Uint8Array.from(createHash('sha256').update(bytes).digest());
const auth=new AndroidAuthCalculations({digest});
const random=Uint8Array.of(1,2,3,4),phone=decodeHex('001122334455'),glasses=decodeHex('aabbccddeeff');
const key=Uint8Array.from({length:32},(_,i)=>i),account=new TextEncoder().encode('test-account'),peer=decodeHex('a1a2a3a4');
const hex=bytes=>Buffer.from(bytes).toString('hex');
test('four independent Python/Swift synthetic golden vectors',()=>{
 assert.equal(hex(auth.guestProof(random,phone,glasses)),'481bb79704a8523c1e86ae93cfb2bd7204b76984d2d2c3684799d70b58839c84');
 assert.equal(hex(auth.boundProof(random,phone,glasses,account,key)),'ba2483fb0d0c3aad8b21df5133cb2c9f32d087d4e4a5b8bf89c739965fafa000');
 assert.equal(hex(auth.deriveBondKey(key,account)),'ebcd452cc71d3a1a1af1299acc093e1fb6cb09142f7c729f6fd38a4bf3cdd810');
 assert.equal(hex(auth.deriveSessionKey(random,peer,phone,glasses,hex(key))),'7368fe1d61a9c94539272f65df3f1ace2e060b0a410a4fcc80b44fb35395d67c');
});
test('hex text case preserved; guest derivation is explicit null only',()=>{
 assert.notDeepEqual(auth.deriveSessionKey(random,peer,phone,glasses,hex(key)),auth.deriveSessionKey(random,peer,phone,glasses,hex(key).toUpperCase()));
 assert.equal(auth.deriveSessionKey(random,peer,phone,glasses,null).length,32);
 for(const invalid of ['', 'g'.repeat(64),hex(key).slice(2)])assert.throws(()=>auth.deriveSessionKey(random,peer,phone,glasses,invalid));
});
test('missing bound inputs fail without hashing or falling back to guest',()=>{
 let count=0;const a=new AndroidAuthCalculations({digest:b=>{count++;return digest(b);}});
 assert.throws(()=>a.boundProof(random,phone,glasses,new Uint8Array(),key));
 assert.throws(()=>a.boundProof(random,phone,glasses,account,new Uint8Array()));assert.equal(count,0);
 for(let n of [0,1,3,5,16])assert.throws(()=>a.guestProof(new Uint8Array(n),phone,glasses));
 assert.throws(()=>a.deriveBondKey(key,new Uint8Array(4097)));
});
test('Unicode account uses explicit caller-supplied UTF8 bytes, not identifier substitution',()=>{
 const unicode=new TextEncoder().encode('test-测试');const a=auth.boundProof(random,phone,glasses,unicode,key);
 assert.deepEqual(a,digest(Buffer.concat([random,phone,glasses,unicode,key])));assert.notDeepEqual(a,auth.boundProof(random,phone,glasses,account,key));
});
test('temporary material cleared, caller buffers preserved on success and failure',()=>{
 let captured;const a=new AndroidAuthCalculations({digest:b=>{captured=b;return digest(b);}});
 a.guestProof(random,phone,glasses);assert(captured.every(x=>x===0));assert.deepEqual(random,Uint8Array.of(1,2,3,4));
 const bad=new AndroidAuthCalculations({digest:b=>{captured=b;throw Error('simulated');}});
 assert.throws(()=>bad.guestProof(random,phone,glasses));assert(captured.every(x=>x===0));
 assert.throws(()=>new AndroidAuthCalculations({digest:()=>new Uint8Array(31)}).guestProof(random,phone,glasses));
});
test('strict hex parsing and full-length proof comparisons',()=>{
 for(const text of ['a','zz',' 00','0x00','0\n','a'.repeat(8194)])assert.throws(()=>decodeHex(text));
 assert.deepEqual(decodeHex('aAbB'),Uint8Array.of(170,187));assert(proofMatches(key,key.slice()));
 for(let i=0;i<32;i++){const other=key.slice();other[i]^=1;assert.equal(proofMatches(key,other),false);}
 assert.equal(proofMatches(new Uint8Array(31),new Uint8Array(31)),false);
});
