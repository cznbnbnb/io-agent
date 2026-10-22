import test from 'node:test';
import assert from 'node:assert/strict';
import {loadCore} from './load-core.mjs';
const {PairingGate}=loadCore('./PairingGate');
const proof=new Uint8Array(32).fill(9);
test('proof alone cannot open business gate; system pairing and initialization required',()=>{
 const g=new PairingGate(),id=g.begin('spp','bound',0,100);
 assert.equal(g.canSendBusiness(),false);assert.equal(g.initializationAccepted(id,'spp',1),false);
 assert(g.versionAccepted(id,'spp',2));assert(g.peerProofChecked(id,'spp',3,proof,proof));
 assert.equal(g.stage(),'system-link');assert.equal(g.canSendBusiness(),false);
 assert(g.systemPairingAccepted(id,'spp',4));assert.equal(g.stage(),'initializing');
 assert(g.initializationAccepted(id,'spp',5));assert(g.canSendBusiness());
 assert.equal(g.peerProofChecked(id,'spp',6,proof,proof),false);
 g.disconnect(id,'spp');assert.equal(g.canSendBusiness(),false);
});
test('platform secure-link confirmation may precede custom authentication',()=>{
 const g=new PairingGate(),id=g.begin('ble','guest',100,50);
 assert(g.systemPairingAccepted(id,'ble',101));assert.equal(g.stage(),'version');
 assert(g.versionAccepted(id,'ble',102));assert(g.peerProofChecked(id,'ble',103,proof,proof));
 assert.equal(g.stage(),'initializing');assert.equal(g.canSendBusiness(),false);
});
test('stale attempts, wrong channels and late disconnection cannot mutate current state',()=>{
 const g=new PairingGate(),old=g.begin('ble','bound',0,20);g.cancel();const id=g.begin('spp','bound',2,20);
 assert.equal(g.versionAccepted(old,'ble',3),false);assert.equal(g.versionAccepted(id,'ble',3),false);
 g.disconnect(old,'ble');assert.equal(g.stage(),'version');assert(g.versionAccepted(id,'spp',4));
});
test('failed proof is terminal and never downgrades a bound attempt',()=>{
 const g=new PairingGate(),id=g.begin('spp','bound',0,100);g.versionAccepted(id,'spp',1);
 assert.equal(g.peerProofChecked(id,'spp',2,proof,new Uint8Array(32)),false);
 assert.equal(g.failure(),'proof-mismatch');assert.equal(g.authMode(),'bound');
 assert.equal(g.peerProofChecked(id,'spp',3,proof,proof),false);
 assert.equal(g.systemPairingAccepted(id,'spp',4),false);assert.equal(g.canSendBusiness(),false);
});
test('absolute deadline, clock regression and explicit cancellation fail closed',()=>{
 for(const event of ['tick','versionAccepted','systemPairingAccepted']){
  const g=new PairingGate(),id=g.begin('ble','guest',100,10);g[event](id,'ble',110);assert.equal(g.failure(),'timeout');
 }
 const g=new PairingGate(),id=g.begin('ble','guest',100,10);g.tick(id,'ble',99);assert.equal(g.failure(),'clock-regression');
 const h=new PairingGate(),next=h.begin('ble','guest',0,100);h.cancel();assert.equal(h.versionAccepted(next,'ble',1),false);
});
test('busy attempts, invalid profiles and invalid time ranges reject',()=>{
 const g=new PairingGate();
 for(const params of [['wifi','guest',0,10],['ble','fallback',0,10],['ble','guest',NaN,10],['ble','guest',0,0],['ble','guest',0,120001],['ble','guest',Number.MAX_SAFE_INTEGER,1]]) assert.throws(()=>g.begin(...params));
 g.begin('ble','guest',0,10);assert.throws(()=>g.begin('spp','bound',1,10),/pairing-busy/);
});
