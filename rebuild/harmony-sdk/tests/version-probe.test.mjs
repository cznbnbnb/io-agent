import test from 'node:test';
import assert from 'node:assert/strict';
import {loadCore} from './load-core.mjs';
const {encodeFrame,encodeTlvs,decodeFrame,decodeTlvs}=loadCore('./ProtocolCodec');
const input=()=>({phoneIdentifier:Uint8Array.of(1,2,3,4,5,6),phoneNameUTF8:new Uint8Array(),manufacturerUTF8:new Uint8Array(),modelUTF8:new Uint8Array(),accountUTF8:null,publicKey:null,pairValue:null});
const reply=()=>encodeFrame({messageNumber:10,flags:0,address:null,slices:new Uint8Array(),businessID:16,response:false,payload:encodeTlvs([{tag:17,value:encodeTlvs([{tag:16,value:Uint8Array.of(1)},{tag:17,value:new Uint8Array(6)}])}])});
const settle=()=>new Promise(r=>setImmediate(r));
function setup(){
 const reports=[],accepted=[],clients=[],timers=new Map();let id=0,now=10;
 class Transport {
  constructor(update,receive){this.update=update;this.receive=receive;this.sent=[];this.closed=false;clients.push(this);}
  open(){this.update({generation:1,stage:'ready',mtu:512,rxBytes:0,txBytes:0});return 1;}
  async send(token,b){this.sent.push(b.slice());this.update({generation:1,stage:'ready',mtu:512,rxBytes:0,txBytes:b.length});}
  close(){this.closed=true;}
 }
 const {BleVersionProbe}=loadCore('./BleVersionProbe',{'./BleHandshakeTransport':{BleHandshakeTransport:Transport},'./HarmonyHandshakeRuntime':{HarmonyHandshakeRuntime:class{now(){return now;}random(n){return new Uint8Array(n).fill(7);}}}},
 {setTimeout:(f,delay)=>{const key=++id;timers.set(key,{f,delay});return key;},clearTimeout:key=>timers.delete(key)});
 return {p:new BleVersionProbe(r=>reports.push(r),r=>accepted.push(r)),clients,reports,accepted,timers,last:()=>reports.at(-1),clock:n=>{now=n;}};
}
test('native stage survives timeout and reports neither an address nor peer content',()=>{
 const c=setup();c.p.start('synthetic',input());const t=c.clients[0];
 t.update({generation:1,stage:'discovering',mtu:23,rxBytes:0,txBytes:0});
 assert.equal(c.last().transportStage,'discovering');
 t.update({generation:1,stage:'failed',reason:'transport-timeout',mtu:23,rxBytes:0,txBytes:0});
 assert.equal(c.last().stage,'failed');assert.equal(c.last().transportStage,'discovering');
 assert(!JSON.stringify(c.last()).includes('synthetic'));
});
test('version-only sends exactly one 0x11 frame and accepts split response without auth',async()=>{
 const c=setup();c.p.start('synthetic',input());const t=c.clients[0];const r=reply();t.receive(1,r.slice(0,5));t.receive(1,r.slice(5));await settle();
 assert.equal(c.last().stage,'received');assert.equal(c.last().protocolVersion,1);assert.equal(c.last().peerIdentifierBytes,6);assert.equal(c.accepted.length,1);assert.equal(t.sent.length,1);assert.equal(decodeTlvs(decodeFrame(t.sent[0]).payload)[0].tag,17);assert(t.closed);assert.equal(c.timers.size,0);
});
test('version-only refuses account and pairing flags before opening',()=>{
 const c=setup();assert.throws(()=>c.p.start('synthetic',{...input(),pairValue:1}));assert.throws(()=>c.p.start('synthetic',{...input(),accountUTF8:Uint8Array.of(1)}));assert.equal(c.clients.length,0);
});
test('malformed and trailing bytes are not accepted as a successful version',async()=>{
 for(const bytes of [new Uint8Array([0,0,0,0]),Uint8Array.from([...reply(),0xaa])]){const c=setup();c.p.start('synthetic',input());c.clients[0].receive(1,bytes);await settle();assert.equal(c.last().stage,'failed');assert.equal(c.accepted.length,0);}
});
test('cancellation and elapsed deadline prevent late version acceptance',async()=>{
 for(const expired of [true,false]){const c=setup();c.p.start('synthetic',input());await settle();if(expired)c.clock(5010);else c.p.cancel();c.clients[0].receive(1,reply());await settle();assert.equal(c.accepted.length,0);assert(c.clients[0].closed);}
});

function identitySetup(saved=''){
 let value=saved,flushed=false,failFlush=false,randomCalls=0,flushCalls=0;
 const prefs={get:async()=>value,put:async(k,v)=>{value=v;},flush:async()=>{flushCalls++;if(failFlush)throw Error('private');flushed=true;}};
 const {LocalProtocolIdentity}=loadCore('./LocalProtocolIdentity',{'@kit.ArkData':{preferences:{getPreferences:async()=>prefs}},'@kit.CryptoArchitectureKit':{cryptoFramework:{createRandom:()=>({generateRandomSync:n=>{randomCalls++;return {data:new Uint8Array(n).fill(7)};}})}}});
 return {store:new LocalProtocolIdentity(),flushed:()=>flushed,value:()=>value,randomCalls:()=>randomCalls,flushCalls:()=>flushCalls,fail:yes=>{failFlush=yes;}};
}
test('identity generated once, flushed before use, concurrent callers get copies',async()=>{
 const c=identitySetup();const [a,b]=await Promise.all([c.store.get({}),c.store.get({})]);assert(c.flushed());assert.equal(c.randomCalls(),1);assert.equal(c.value(),'070707070707');a.fill(0);assert(b.every(n=>n===7));
});
test('existing identity preserved, invalid identity never silently replaced',async()=>{
 const a=identitySetup('001122334455');assert.equal(Buffer.from(await a.store.get({})).toString('hex'),'001122334455');assert.equal(a.randomCalls(),0);
 for(const value of ['bad','00112233445Z',123]){const c=identitySetup(value);await assert.rejects(c.store.get({}));assert.equal(c.randomCalls(),0);}
});
test('failed flush cannot leak an unpersisted identity on retry',async()=>{
 const c=identitySetup();c.fail(true);await assert.rejects(c.store.get({}));await assert.rejects(c.store.get({}));assert.equal(c.randomCalls(),1);assert.equal(c.flushCalls(),2);c.fail(false);await c.store.get({});assert(c.flushed());assert.equal(c.randomCalls(),1);
});
