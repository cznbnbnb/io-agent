import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {loadCore} from './load-core.mjs';
const {GuestAuthExchange}=loadCore('./GuestAuthExchange');
const {AndroidAuthCalculations}=loadCore('./AuthCalculations');
const {encodeTlvs:encode,authFields}=loadCore('./ProtocolCodec');
const sha={digest:b=>Uint8Array.from(createHash('sha256').update(b).digest())};
const calc=new AndroidAuthCalculations(sha);
const phone=Uint8Array.of(0,17,34,51,68,85),peer=Uint8Array.of(170,187,204,221,238,255);
const random=Uint8Array.of(1,2,3,4),peerRandom=Uint8Array.of(5,6,7,8);
const input=()=>({phoneIdentifier:phone.slice(),phoneNameUTF8:new Uint8Array(),manufacturerUTF8:new Uint8Array(),modelUTF8:new Uint8Array(),accountUTF8:null,publicKey:null,pairValue:null});
const version=(extra=[],identity=peer,protocol=1)=>encode([{tag:0x11,value:encode([{tag:0x10,value:Uint8Array.of(protocol)},{tag:0x11,value:identity},...extra])}]);
const proof=(value=calc.guestProof(peerRandom,phone,peer))=>encode([{tag:0x19,value:encode([{tag:0x10,value:peerRandom},{tag:0x11,value}])}]);
function start(){const exchange=new GuestAuthExchange(sha);exchange.begin(input(),peer,random,100);return exchange;}
function atProof(){const e=start();assert(e.receiveVersion(e.generation(),101,version()));return e;}
test('synthetic payload handshake derives expected key once, not business-ready',()=>{
 const e=start(),token=e.generation();const sent=e.receiveVersion(token,101,version());
 const fields=authFields(sent,0x18);assert.deepEqual(fields[0].value,random);assert.deepEqual(fields[1].value,calc.guestProof(random,phone,peer));
 assert.equal(e.stage(),'proof');assert(e.receiveProof(token,102,proof()));assert.equal(e.stage(),'verified');
 assert.deepEqual(e.takeSessionKey(token,103),calc.deriveSessionKey(random,peerRandom,phone,peer,null));
 assert.equal(e.takeSessionKey(token,104),null);assert.throws(()=>e.begin(input(),peer,random,105));
});
test('wrong identity/version and account indicators fail without downgrade',()=>{
 for(const [payload,reason] of [[version([],phone),'peer-identifier-mismatch'],[version([],peer,3),'unsupported-version'],[version([{tag:0x1a,value:Uint8Array.of(65)}]),'account-bound-peer'],[version([{tag:0x19,value:Uint8Array.from({length:65},(_,i)=>i===0?4:0)}]),'account-bound-peer']]){
  const e=start();assert.equal(e.receiveVersion(e.generation(),101,payload),null);assert.equal(e.failure(),reason);assert.equal(e.takeSessionKey(e.generation(),102),null);
 }
});
test('observed peer protocol version 2 enters the same explicit guest proof path',()=>{
 const e=start();assert(e.receiveVersion(e.generation(),101,version([],peer,2)));assert(e.receiveProof(e.generation(),102,proof()));assert.equal(e.stage(),'verified');
});
test('every mismatching proof byte is rejected',()=>{
 for(let i=0;i<32;i++){const e=atProof();const value=calc.guestProof(peerRandom,phone,peer);value[i]^=1;assert.equal(e.receiveProof(e.generation(),102,proof(value)),false);assert.equal(e.failure(),'proof-mismatch');}
});
test('malformed messages are terminal and cannot be retried on same attempt',()=>{
 const e=start();e.receiveVersion(e.generation(),101,new Uint8Array());assert.equal(e.failure(),'version-invalid');assert.equal(e.receiveVersion(e.generation(),102,version()),null);
 const p=atProof();assert.equal(p.receiveProof(p.generation(),102,proof(new Uint8Array(31))),false);assert.equal(p.failure(),'proof-invalid');
});
test('absolute deadline covers version/proof/key handoff and clock regression',()=>{
 for(const now of [5100,6000]){const e=start();assert.equal(e.receiveVersion(e.generation(),now,version()),null);assert.equal(e.failure(),'timeout');}
 const e=atProof();e.tick(e.generation(),100);assert.equal(e.failure(),'clock-regression');
 const p=atProof();assert(p.receiveProof(p.generation(),5099,proof()));assert.equal(p.takeSessionKey(p.generation(),5100),null);assert.equal(p.failure(),'timeout');
 const q=atProof();q.tick(q.generation(),NaN);assert.equal(q.failure(),'clock-regression');
});
test('stale generations and out-of-order messages cannot advance a new attempt',()=>{
 const e=start(),old=e.generation();assert.equal(e.receiveProof(old,101,proof()),false);assert.equal(e.stage(),'version');
 e.cancel();e.begin(input(),peer,random,200);const current=e.generation();assert(current>old);
 assert.equal(e.receiveVersion(old,10000,version()),null);assert.equal(e.stage(),'version');
 assert(e.receiveVersion(current,201,version()));assert.equal(e.receiveVersion(current,202,version()),null);assert.equal(e.stage(),'proof');
 assert(e.receiveProof(current,203,proof()));assert.equal(e.takeSessionKey(old,204),null);assert(e.takeSessionKey(current,205));
});
test('begin snapshots input and cancel removes the pending key',()=>{
 const e=new GuestAuthExchange(sha),i=input(),p=peer.slice(),r=random.slice();e.begin(i,p,r,100);i.phoneIdentifier.fill(0);p.fill(0);r.fill(0);
 assert(e.receiveVersion(e.generation(),101,version()));assert(e.receiveProof(e.generation(),102,proof()));e.cancel();assert.equal(e.takeSessionKey(e.generation(),103),null);
});
test('invalid begin inputs have no state effects or guest fallback',()=>{
 const e=new GuestAuthExchange(sha);
 for(const args of [[{...input(),accountUTF8:Uint8Array.of(1)},peer,random,100],[input(),new Uint8Array(5),random,100],[input(),peer,new Uint8Array(3),100],[input(),peer,random,-1],[input(),peer,random,100,0],[input(),peer,random,100,30001]])assert.throws(()=>e.begin(...args));
 assert.equal(e.stage(),'idle');assert.equal(e.generation(),0);
});
test('hash provider failure fails closed without key',()=>{
 const e=new GuestAuthExchange({digest:()=>{throw Error('synthetic');}});e.begin(input(),peer,random,100);
 assert.equal(e.receiveVersion(e.generation(),101,version()),null);assert.equal(e.stage(),'failed');assert.equal(e.takeSessionKey(e.generation(),102),null);
});
