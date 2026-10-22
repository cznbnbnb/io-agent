import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {loadCore} from './load-core.mjs';
const {encodeFrame,decodeFrame,encodeTlvs,decodeTlvs,authFields}=loadCore('./ProtocolCodec');
const {AndroidAuthCalculations}=loadCore('./AuthCalculations');
const sha=b=>Uint8Array.from(createHash('sha256').update(b).digest());const calc=new AndroidAuthCalculations({digest:sha});
const phone=Uint8Array.of(0,17,34,51,68,85),peer=Uint8Array.of(170,187,204,221,238,255);
const input=()=>({phoneIdentifier:phone.slice(),phoneNameUTF8:new Uint8Array(),manufacturerUTF8:new Uint8Array(),modelUTF8:new Uint8Array(),accountUTF8:null,publicKey:null,pairValue:null});
const service='0000b81d-0000-1000-8000-00805f9b34fb',tx='ea8b70d5-2bd3-49ab-9c31-9c38b2c3c4f9',rx='7db3e235-3608-41f3-a03c-955fcbd2ea4b';
const wire=payload=>encodeFrame({messageNumber:500,flags:0,address:null,slices:new Uint8Array(),businessID:0x10,payload,response:false});
const version=(identity=peer)=>wire(encodeTlvs([{tag:0x11,value:encodeTlvs([{tag:0x10,value:Uint8Array.of(1)},{tag:0x11,value:identity}])}]));
const proof=(bad=false)=>{const random=Uint8Array.of(5,6,7,8),p=calc.guestProof(random,phone,peer);if(bad)p[0]^=1;return wire(encodeTlvs([{tag:0x19,value:encodeTlvs([{tag:0x10,value:random},{tag:0x11,value:p}])}]));};
const settle=()=>new Promise(r=>setImmediate(r));
function setup(){
 const reports=[],clients=[],timers=new Map(),randomBuffers=[];let nextTimer=0,now=100,randomFailure=false,autoReply=false,deferWrite=false;
 const ch=(id,properties)=>({serviceUuid:service,characteristicUuid:id,properties,descriptors:[],characteristicValue:new ArrayBuffer(0)});
 let bondState=0,bondListener;const pairCalls=[];
 const radio={connection:{BondState:{BOND_STATE_BONDED:2},on:(k,f)=>{bondListener=f;},off:()=>{bondListener=undefined;},getPairState:()=>bondState,pairDevice:async id=>{pairCalls.push(id);}},constant:{ProfileConnectionState:{STATE_CONNECTED:2,STATE_DISCONNECTED:0}},ble:{GattWriteType:{WRITE_NO_RESPONSE:2},createGattClientDevice:()=>{
  const listeners=new Map();const c={listeners,writes:[],closed:false,resolveWrite:undefined,on:(k,f)=>listeners.set(k,f),off:k=>listeners.delete(k),connect:()=>{},disconnect:()=>{},close:()=>{c.closed=true;},
   getServices:async()=>[{serviceUuid:service,characteristics:[ch(tx,{writeNoResponse:true}),ch(rx,{notify:true})]}],setBLEMtuSize:()=>{},setCharacteristicChangeNotification:async()=>{},
   notify:bytes=>listeners.get('BLECharacteristicChange')?.({...ch(rx,{}),characteristicValue:bytes.slice().buffer}),
   writeCharacteristicValue:value=>{
    const bytes=new Uint8Array(value.characteristicValue).slice();c.writes.push(bytes);
    if(autoReply){const tag=decodeTlvs(decodeFrame(bytes).payload)[0].tag;const reply=tag===0x11?version():proof();c.notify(reply.slice(0,7));c.notify(reply.slice(7));}
    return deferWrite?new Promise(resolve=>{c.resolveWrite=resolve;}):Promise.resolve();
   }};clients.push(c);return c;}}};
 const cryptoFramework={createRandom:()=>({generateRandomSync:n=>{if(randomFailure)throw Error('private');const b=new Uint8Array(n).fill(9);randomBuffers.push(b);return {data:b};}}),createMd:()=>{let input;return {updateSync:b=>{input=b.data.slice();},digestSync:()=>({data:sha(input)})};}};
 const globals={setTimeout:(fn,delay)=>{const id=++nextTimer;timers.set(id,{fn,delay});return id;},clearTimeout:id=>timers.delete(id)};
 const {BleGuestAuthProbe}=loadCore('./BleGuestAuthProbe',{'@kit.ArkTS':{util:{TextDecoder:class {decodeToString(b){return new TextDecoder().decode(b);}}}},'@kit.ConnectivityKit':radio,'@kit.CryptoArchitectureKit':{cryptoFramework},'@kit.BasicServicesKit':{systemDateTime:{TimeType:{STARTUP:0},getUptime:(type,nano)=>{assert.equal(type,0);assert.equal(nano,false);return now;}}}},globals);
 const probe=new BleGuestAuthProbe(r=>reports.push(r));
 return {probe,reports,clients,timers,randomBuffers,pairCalls,bond:(id='synthetic')=>{bondState=2;bondListener?.({deviceId:id,state:2});},last:()=>reports.at(-1),clock:n=>{now=n;},failRandom:()=>{randomFailure=true;},auto:()=>{autoReply=true;},manual:()=>{autoReply=false;},defer:()=>{deferWrite=true;},undefer:()=>{deferWrite=false;},fire:delay=>[...timers.values()].find(t=>t.delay===delay).fn()};
}
test('business origin is the authenticated attempt, including pairing; only connected bonded attempts expose a live generation',async()=>{
 const ctx=setup();assert.equal(ctx.probe.connectionGeneration,0);ctx.auto();const c=await connected(ctx,true);await settle();ctx.manual();
 assert.equal(ctx.last().stage,'pairing');assert.equal(ctx.probe.connectionGeneration,0);
 const seen=[];ctx.probe.onBusiness=(business,payload,sourcePeer,generation)=>seen.push({business,sourcePeer,generation,payload:payload.slice()});
 const payload=Uint8Array.of(1,2,3);c.notify(encodeFrame({messageNumber:888,flags:0,address:null,slices:new Uint8Array(),businessID:13,payload,response:false}));
 assert.deepEqual(seen,[{business:13,sourcePeer:'synthetic',generation:1,payload}]);
 ctx.bond();assert.equal(ctx.probe.connectionGeneration,1);ctx.probe.cancel();assert.equal(ctx.probe.connectionGeneration,0);
});
test('same-peer reconnect changes business epoch and discards both queued bytes and old native callbacks',async()=>{
 const ctx=setup();ctx.auto();const c=await connected(ctx,true);await settle();ctx.manual();ctx.bond();await settle();
 const seen=[];ctx.probe.onBusiness=(b,p,sourcePeer,generation)=>seen.push([b,sourcePeer,generation,...p]);
 const payload=Uint8Array.of(7),incoming=encodeFrame({messageNumber:889,flags:0,address:null,slices:new Uint8Array(),businessID:13,payload,response:false});
 const {businessEnvelope}=loadCore('./BusinessCommands');ctx.defer();const write=ctx.probe.sendBusiness(22,businessEnvelope(2,new TextEncoder().encode('{}')));
 const settled=Promise.allSettled([write]);await settle();c.notify(incoming);assert.equal(seen.length,0);
 const oldNotify=c.listeners.get('BLECharacteristicChange');ctx.probe.cancel();await settled;ctx.undefer();ctx.auto();const d=await connected(ctx,true);await settle();ctx.manual();
 assert.equal(ctx.probe.connectionGeneration,2,'auth epoch survives replacement of the transport object');
 oldNotify({...chForTest(),characteristicValue:incoming.buffer});d.notify(incoming);await settle();
 assert.deepEqual(seen,[[13,'synthetic',2,7]]);ctx.probe.cancel();
});
function chForTest(){return {serviceUuid:service,characteristicUuid:rx};}
test('concurrent authenticated feature commands serialize without interleaving or command-busy failures',async()=>{
 const ctx=setup();ctx.auto();const c=await connected(ctx,true);await settle();ctx.manual();ctx.bond();
 const {businessEnvelope}=loadCore('./BusinessCommands');const packet=businessEnvelope(2,new TextEncoder().encode('{"eventType":1}'));
 ctx.defer();const before=c.writes.length;const first=ctx.probe.sendBusiness(22,packet),second=ctx.probe.sendBusiness(22,packet);
 await settle();assert.equal(c.writes.length,before+1);c.resolveWrite();await first;await settle();assert.equal(c.writes.length,before+2);c.resolveWrite();await second;
 assert.equal(ctx.last().stage,'connected');assert(!c.closed);
});
test('queued business command is not replayed after disconnect',async()=>{
 const ctx=setup();ctx.auto();const c=await connected(ctx,true);await settle();ctx.manual();ctx.bond();
 const {businessEnvelope}=loadCore('./BusinessCommands');const packet=businessEnvelope(2,new TextEncoder().encode('{}'));
 ctx.defer();const before=c.writes.length;const first=ctx.probe.sendBusiness(22,packet),second=ctx.probe.sendBusiness(22,packet);
 const outcomes=Promise.allSettled([first,second]);await settle();ctx.probe.cancel();await outcomes;assert.equal(c.writes.length,before+1);assert(c.closed);
});
async function connected(ctx,maintain=false){ctx.probe.start('synthetic',input(),peer,true,maintain);const c=ctx.clients.at(-1);c.listeners.get('BLEConnectionStateChange')({state:2});await settle();c.listeners.get('BLEMtuChange')(512);await settle();return c;}

test('ACK precedes an immediate application reply on the same serialized transport',async()=>{
 const ctx=setup();ctx.auto();const c=await connected(ctx,true);await settle();ctx.manual();ctx.bond();await settle();
 const {businessEnvelope}=loadCore('./BusinessCommands');let reply;
 ctx.probe.onBusiness=()=>{reply=ctx.probe.sendBusiness(22,businessEnvelope(2,new TextEncoder().encode('{}')));};
 const before=c.writes.length;c.notify(encodeFrame({messageNumber:1177,flags:1,address:null,slices:new Uint8Array(),businessID:22,payload:Uint8Array.of(1),response:false}));
 await settle();await reply;await settle();
 const frames=c.writes.slice(before).map(decodeFrame);assert.equal(frames.length,2);assert.equal(frames[0].response,true);assert.equal(frames[0].messageNumber,1177);assert.equal(frames[1].response,false);ctx.probe.cancel();
});
test('actual auth, catalog validation and native transport allow an oversize delta but reject full sync and delete',async()=>{
 const ctx=setup();ctx.auto();const c=await connected(ctx,true);await settle();ctx.manual();ctx.bond();await settle();
 const {businessEnvelope}=loadCore('./BusinessCommands');const body={action:2,type:3,total:1,chunkinfo:{chunkid:1,total:1,islast:true},items:[{did:'11111111-1111-4111-8111-111111111111',pin:false,title:'中'.repeat(100),offset:0,scroll:2,total:225,timestamp:1792008750,timezone:28800,preview:'文'.repeat(80)}]};
 const payload=businessEnvelope(1,new TextEncoder().encode(JSON.stringify(body)));assert(payload.length>509);let before=c.writes.length;await ctx.probe.sendBusiness(20,payload);
 const decoded=decodeFrame(Uint8Array.from(c.writes.slice(before).flatMap(b=>[...b])));assert.equal(decoded.businessID,20);assert.deepEqual(decoded.payload,payload);assert(c.writes.slice(before).every(b=>b.length<=509));
 before=c.writes.length;for(const type of [1,4])await assert.rejects(ctx.probe.sendBusiness(20,businessEnvelope(1,new TextEncoder().encode(JSON.stringify({...body,type})))));assert.equal(c.writes.length,before);ctx.probe.cancel();
});

test('authenticated SmallCore file larger than MTU reaches atomic transport and its info ACK dispatches business 17',async()=>{
 const ctx=setup();ctx.auto();const c=await connected(ctx,true);await settle();ctx.manual();ctx.bond();await settle();
 const {FileMessage,fileMessage}=loadCore('./FileTransfer');
 const payload=fileMessage(Object.assign(new FileMessage(),{type:4,uuid:'small-7392',chunkID:1,start:0,size:1200,data:new Uint8Array(1200).fill(9)}));
 const before=c.writes.length;await ctx.probe.sendBusiness(17,payload);
 const encoded=Uint8Array.from(c.writes.slice(before).flatMap(b=>[...b]));const decoded=decodeFrame(encoded);assert.equal(decoded.businessID,17);assert.deepEqual(decoded.payload,payload);
 assert(c.writes.slice(before).every(b=>b.length<=509));
 const seen=[];ctx.probe.onBusiness=(business,p)=>seen.push({business,p:p.slice()});
 const ack=fileMessage(Object.assign(new FileMessage(),{type:2,uuid:'small-7392'}));
 c.notify(encodeFrame({messageNumber:1111,flags:1,address:null,slices:new Uint8Array(),businessID:17,payload:ack,response:false}));await settle();
 assert.equal(seen.length,1);assert.equal(seen[0].business,17);assert.deepEqual(seen[0].p,ack);
 const response=decodeFrame(c.writes.at(-1));assert(response.response);assert.equal(response.businessID,17);assert.equal(response.messageNumber,1111);ctx.probe.cancel();
});
test('maintained session authenticates before requesting system bond and keeps native connection open',async()=>{
 const ctx=setup();ctx.auto();const c=await connected(ctx,true);await settle();assert.equal(ctx.last().stage,'pairing');assert(!c.closed);assert.deepEqual(ctx.pairCalls,['synthetic']);
 assert(![...ctx.timers.values()].some(t=>t.delay===20000));ctx.bond('unrelated');assert.equal(ctx.last().stage,'pairing');ctx.bond();assert.equal(ctx.last().stage,'connected');assert.equal(ctx.last().bonded,true);
 c.notify(wire(encodeTlvs([{tag:0x17,value:Uint8Array.of(2)}])));assert.equal(ctx.last().peerPairStatus,2);assert(!c.closed);ctx.probe.cancel();assert(c.closed);assert.equal(ctx.timers.size,0);
});
test('maintained mode does not pair on failed proof and closes if system bond times out',async()=>{
 const a=setup(),c=await connected(a,true);c.notify(version());await settle();c.notify(proof(true));await settle();assert.equal(a.pairCalls.length,0);assert(c.closed);
 const b=setup();b.auto();const d=await connected(b,true);await settle();b.fire(60000);assert(d.closed);assert.equal(b.last().reason,'system-pair-timeout');assert.equal(b.timers.size,0);
});
test('full actual source stack: native mocks, early split replies, proof success closes without business or keys',async()=>{
 const ctx=setup();ctx.auto();const c=await connected(ctx);await settle();assert.equal(ctx.last().stage,'verified');assert.match(ctx.last().reason,/not-paired-or-initialized/);assert(c.closed);assert.equal(c.writes.length,2);assert.equal(ctx.timers.size,0);
 const versionPacket=decodeFrame(c.writes[0]),authPacket=decodeFrame(c.writes[1]);assert.equal(authPacket.messageNumber,(versionPacket.messageNumber+1)&65535);
 const auth=authFields(authPacket.payload,0x18);assert.deepEqual(auth[0].value,new Uint8Array(4).fill(9));assert.deepEqual(auth[1].value,calc.guestProof(new Uint8Array(4).fill(9),phone,peer));
 assert(ctx.randomBuffers.every(b=>b.every(n=>n===0)));assert(!JSON.stringify(ctx.reports).includes('session'));assert.equal(ctx.last().txBytes,c.writes.reduce((n,b)=>n+b.length,0));
});
test('consent, input and bound account validation happen before radio creation',()=>{
 const ctx=setup();assert.throws(()=>ctx.probe.start('synthetic',input(),peer,false),/confirmation/);
 assert.throws(()=>ctx.probe.start('synthetic',{...input(),accountUTF8:Uint8Array.of(1)},peer,true),/guest/);
 assert.throws(()=>ctx.probe.start('synthetic',input(),new Uint8Array(5),true));assert.equal(ctx.clients.length,0);
});
test('wrong identity and proof fail closed and never send extra frames',async()=>{
 const a=setup(),c=await connected(a);c.notify(version(phone));await settle();assert.equal(a.last().reason,'peer-identifier-mismatch');assert(c.closed);assert.equal(c.writes.length,1);
 const b=setup(),d=await connected(b);d.notify(version());await settle();d.notify(proof(true));await settle();assert.equal(b.last().reason,'proof-mismatch');assert(d.closed);assert.equal(d.writes.length,2);
});
test('final asynchronous proof RX remains counted when verification closes transport immediately',async()=>{
 const ctx=setup(),c=await connected(ctx);const v=version(),p=proof();c.notify(v);await settle();c.notify(p);await settle();assert.equal(ctx.last().stage,'verified');assert.equal(ctx.last().rxBytes,v.length+p.length);
});
test('native random failure does not send; clock deadline rejects valid late reply',async()=>{
 const a=setup();a.failRandom();const c=await connected(a);assert.equal(a.last().reason,'auth-start-failed');assert.equal(c.writes.length,0);assert(c.closed);
 const b=setup(),d=await connected(b);b.clock(5100);d.notify(version());await settle();assert.equal(b.last().reason,'timeout');assert(d.closed);
});
test('independent auth timer cancels a partial frame and pending native write',async()=>{
 const a=setup(),c=await connected(a);c.notify(version().slice(0,8));a.fire(5000);assert.equal(a.last().reason,'auth-timeout');assert(c.closed);
 const b=setup();b.defer();const d=await connected(b);b.fire(5000);await settle();d.resolveWrite();await settle();assert.equal(b.last().reason,'auth-timeout');assert(d.closed);
});
test('cancel and restart discard stale callbacks and queued frames',async()=>{
 const ctx=setup(),c=await connected(ctx);const oldNotify=c.listeners.get('BLECharacteristicChange');ctx.probe.cancel();const d=await connected(ctx);
 oldNotify({serviceUuid:service,characteristicUuid:rx,characteristicValue:version().buffer});await settle();assert.equal(ctx.last().stage,'version');assert.equal(d.writes.length,1);
 d.notify(version());await settle();d.notify(proof());await settle();assert.equal(ctx.last().stage,'verified');
});
test('authenticated needAck frames dispatch to business and auto-ack with echoed message number',async()=>{
 const ctx=setup();ctx.auto();const c=await connected(ctx,true);await settle();ctx.manual();ctx.bond();await settle();
 const seen=[];ctx.probe.onBusiness=(b,p)=>seen.push([b,p.length]);
 const {businessEnvelope}=loadCore('./BusinessCommands');
 const envelope=businessEnvelope(1,new TextEncoder().encode('{"cmd":"general_status","payload":{}}'));
 const msg=encodeFrame({messageNumber:777,flags:1,address:null,slices:new Uint8Array(),businessID:15,response:false,payload:envelope});
 const before=c.writes.length;c.notify(msg);await settle();
 assert.deepEqual(seen,[[15,envelope.length]]);
 assert.equal(c.writes.length,before+1);
 const ack=decodeFrame(c.writes.at(-1));
 assert.equal(ack.response,true);assert.equal(ack.messageNumber,777);assert.equal(ack.businessID,15);assert.equal(ack.payload.length,0);
 assert(!c.closed);assert.equal(ctx.last().stage,'connected');
});
test('incoming 55AA response frames are observed without dispatch or disconnect',async()=>{
 const ctx=setup();ctx.auto();const c=await connected(ctx,true);await settle();ctx.manual();ctx.bond();await settle();
 let dispatched=0;ctx.probe.onBusiness=()=>{dispatched++;};
 c.notify(encodeFrame({messageNumber:900,flags:0,address:null,slices:new Uint8Array(),businessID:15,payload:new Uint8Array(),response:true}));
 await settle();
 assert.equal(dispatched,0);assert(!c.closed);assert.equal(ctx.last().stage,'connected');
 assert.match(ctx.last().lastMessage,/ack business=15/);
});
test('unsupported flags or corrupt CRC rejected without guessing',async()=>{
 for(const alter of [b=>{b[8]^=1;return b;},b=>{const p=decodeFrame(b);return encodeFrame({...p,flags:1});}]){
  const ctx=setup(),c=await connected(ctx);c.notify(alter(version()));await settle();assert.equal(ctx.last().reason,'response-frame-invalid');assert(c.closed);
 }
});
