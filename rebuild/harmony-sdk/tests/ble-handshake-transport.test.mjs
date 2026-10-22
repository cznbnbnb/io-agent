import test from 'node:test';
import assert from 'node:assert/strict';
import {loadCore} from './load-core.mjs';
const {encodeFrame,authRequest}=loadCore('./ProtocolCodec');
const service='0000b81d-0000-1000-8000-00805f9b34fb',tx='ea8b70d5-2bd3-49ab-9c31-9c38b2c3c4f9',rx='7db3e235-3608-41f3-a03c-955fcbd2ea4b';
const ch=(uuid,properties)=>({serviceUuid:service,characteristicUuid:uuid,properties,descriptors:[],characteristicValue:new ArrayBuffer(0)});
const services=()=>[{serviceUuid:service,characteristics:[ch(tx,{writeNoResponse:true}),ch(rx,{notify:true})]}];
const frame=(patch={})=>encodeFrame({messageNumber:1,flags:0,address:null,slices:new Uint8Array(),businessID:0x10,payload:authRequest(new Uint8Array(4),new Uint8Array(32)),response:false,...patch});
const settle=()=>new Promise(resolve=>setImmediate(resolve));
const {FileMessage,fileMessage}=loadCore('./FileTransfer');
const {businessEnvelope}=loadCore('./BusinessCommands');
const catalogBody=()=>({action:2,type:3,total:1,chunkinfo:{chunkid:1,total:1,islast:true},items:[{did:'11111111-1111-4111-8111-111111111111',pin:false,title:'中'.repeat(100),offset:0,scroll:2,total:225,timestamp:1792008750,timezone:28800,preview:'文'.repeat(80)}]});
test('only a strictly validated single catalog addition may use the authenticated atomic ATT stream',async()=>{
 const ctx=setup(),{token,c}=await ready(ctx);const body=catalogBody(),packet=frame({businessID:20,payload:businessEnvelope(1,new TextEncoder().encode(JSON.stringify(body)))});
 assert(packet.length>509);await assert.rejects(ctx.t.send(token,packet));assert.equal(c.writes.length,0);ctx.t.retainAuthenticatedSession(token);
 await ctx.t.send(token,packet);assert(c.writes.length>=2);assert(c.writes.every(w=>w.bytes.length<=509));assert.deepEqual(Uint8Array.from(c.writes.flatMap(w=>[...w.bytes])),packet);
 const before=c.writes.length;
 for(const patch of [b=>b.type=1,b=>b.type=4,b=>b.items.push({...b.items[0]}),b=>b.chunkinfo.islast=false,b=>b.items[0].did='unknown',b=>b.command='delete-all']){
  const bad=catalogBody();patch(bad);await assert.rejects(ctx.t.send(token,frame({businessID:20,payload:businessEnvelope(1,new TextEncoder().encode(JSON.stringify(bad)))})));assert.equal(c.writes.length,before);
 }ctx.t.close();
});
test('catalog write failure aborts its remaining ATT segments without replay',async()=>{
 const ctx=setup(),{token,c}=await ready(ctx,100);ctx.t.retainAuthenticatedSession(token);let count=0;c.writeCharacteristicValue=async()=>{if(++count===2)throw Error('uncertain');};
 await assert.rejects(ctx.t.send(token,frame({businessID:20,payload:businessEnvelope(1,new TextEncoder().encode(JSON.stringify(catalogBody())))})));assert.equal(count,2);assert(c.closed);assert.equal(ctx.timers.size,0);
});
test('prompter readiness query reaches native TX only in its authenticated read-only form',async()=>{
 const ctx=setup(),{token,c}=await ready(ctx),body={did:'11111111-1111-4111-8111-111111111111',action:1};
 const packet=(value,businessID=20,binary=new Uint8Array())=>{const payload=businessEnvelope(10,new TextEncoder().encode(JSON.stringify(value)));return frame({businessID,payload:binary.length?new Uint8Array([...payload,34,binary.length,...binary]):payload});};
 const bytes=packet(body);await assert.rejects(ctx.t.send(token,bytes));assert.equal(c.writes.length,0);
 ctx.t.retainAuthenticatedSession(token);await ctx.t.send(token,bytes);assert.deepEqual(c.writes[0].bytes,bytes);
 for(const bad of [null,[],{}, {...body,action:2},{...body,action:'1'},{...body,did:'wrong'}, {...body,state:1}]){
  await assert.rejects(ctx.t.send(token,packet(bad)),/business-type-not-enabled/);
 }
 await assert.rejects(ctx.t.send(token,packet(body,21)),/business-type-not-enabled/);
 await assert.rejects(ctx.t.send(token,packet(body,20,new Uint8Array([1]))),/business-type-not-enabled/);
 assert.equal(c.writes.length,1);ctx.t.close();
});
test('authenticated suggestion add/remove and receipt reach native TX; incoming operation is not an outbound type',async()=>{
 const ctx=setup(),{token,c}=await ready(ctx);
 const packet=(type,body)=>frame({businessID:21,payload:businessEnvelope(type,new TextEncoder().encode(JSON.stringify(body)))});
 const add=packet(33,{suggestUID:'p10-synthetic',suggestType:2,type:1,title:'实验',source:'本地实验',content:'仅记录选择'});
 await assert.rejects(ctx.t.send(token,add));assert.equal(c.writes.length,0);
 ctx.t.retainAuthenticatedSession(token);
 for(const bytes of [add,packet(33,{suggestUID:'p10-synthetic',type:2}),packet(35,{suggestUID:'p10-synthetic',code:0})]){
  await ctx.t.send(token,bytes);assert.deepEqual(c.writes.at(-1).bytes,bytes);
 }
 for(const type of [4,34,36])await assert.rejects(ctx.t.send(token,packet(type,{})),/business-type-not-enabled/);
 assert.equal(c.writes.length,3);ctx.t.close();
 const small=setup(),other=await ready(small,23);small.t.retainAuthenticatedSession(other.token);
 await assert.rejects(small.t.send(other.token,add),/mtu-too-small/);assert.equal(other.c.writes.length,0);small.t.close();
});
function deferred(){let resolve,reject;const promise=new Promise((r,j)=>{resolve=r;reject=j;});return {promise,resolve,reject};}
function setup(){
 const clients=[],reports=[],received=[],timers=new Map();let id=0,onReport;
 const radio={constant:{ProfileConnectionState:{STATE_CONNECTED:2,STATE_DISCONNECTED:0}},ble:{GattWriteType:{WRITE_NO_RESPONSE:2},createGattClientDevice:()=>{
  const listeners=new Map();const c={listeners,services:services(),closed:false,writes:[],notify:[],mtus:[],
   on:(k,f)=>listeners.set(k,f),off:k=>listeners.delete(k),connect:()=>{},disconnect:()=>{},close:()=>{c.closed=true;},
   getServices:async()=>c.services,setBLEMtuSize:n=>c.mtus.push(n),
   setCharacteristicChangeNotification:async(value,on)=>{c.notify.push({value,on});},
   writeCharacteristicValue:async(value,type)=>{c.writes.push({bytes:Uint8Array.from(new Uint8Array(value.characteristicValue)),value,type});}};
  clients.push(c);return c;}}};
 const globals={setTimeout:(fn,delay)=>{if(delay===5){queueMicrotask(fn);return -1;}const key=++id;timers.set(key,{fn,delay});return key;},clearTimeout:key=>timers.delete(key)};
 const {BleHandshakeTransport}=loadCore('./BleHandshakeTransport',{'@kit.ConnectivityKit':radio},globals);
 const t=new BleHandshakeTransport(r=>{reports.push(r);if(onReport)onReport(r);},(token,b)=>received.push({token,bytes:b.slice(),original:b}));
 return {t,clients,reports,received,timers,onReport:f=>{onReport=f;},last:()=>reports.at(-1),fire:delay=>[...timers.values()].find(t=>t.delay===delay).fn()};
}
async function ready(ctx,mtu=512){const token=ctx.t.open('synthetic');const c=ctx.clients.at(-1);c.listeners.get('BLEConnectionStateChange')({state:2});await settle();c.listeners.get('BLEMtuChange')(mtu);await settle();assert.equal(ctx.last().stage,'ready');return {token,c};}

test('OTA start requires explicit lease; leased fragments reconstruct exact payload and exclude other business',async()=>{
 const ctx=setup(),{token,c}=await ready(ctx,100);ctx.t.retainAuthenticatedSession(token);
 const {otaMessage}=loadCore('./FirmwareOta'),packet=(type,body,binary)=>frame({businessID:9,payload:otaMessage(type,new TextEncoder().encode(JSON.stringify(body)),binary)});
 await assert.rejects(ctx.t.send(token,packet(4,{Mode:2})));assert.equal(c.writes.length,0);
 await ctx.t.send(token,packet(1,{}));ctx.t.setFirmwareLease(token,true);await ctx.t.send(token,packet(4,{Mode:2}));
 const bytes=packet(7,{Name:'nuttx_ap.bin',Start:0,Size:51200},new Uint8Array(51200).fill(71)),before=c.writes.length;
 await ctx.t.send(token,bytes);assert.deepEqual(Uint8Array.from(c.writes.slice(before).flatMap(w=>[...w.bytes])),bytes);
 await assert.rejects(ctx.t.send(token,frame()),/firmware-exclusive/);ctx.t.close();
});
test('native order is connection, discovery, negotiated MTU, notification, ready; no automatic writes',async()=>{
 const ctx=setup(),token=ctx.t.open('synthetic'),c=ctx.clients[0];assert.equal(ctx.last().stage,'connecting');
 await assert.rejects(ctx.t.send(token,frame()),/not-ready/);c.listeners.get('BLEConnectionStateChange')({state:2});await settle();
 assert.deepEqual(c.mtus,[512]);assert.equal(c.notify.length,0);assert.equal(ctx.last().stage,'mtu');
 const waiting=deferred();c.setCharacteristicChangeNotification=()=>waiting.promise;c.listeners.get('BLEMtuChange')(512);
 assert.equal(ctx.last().stage,'subscribing');await assert.rejects(ctx.t.send(token,frame()),/not-ready/);
 waiting.resolve();await settle();assert.equal(ctx.last().stage,'ready');assert.equal(c.writes.length,0);
});
test('only entire validated handshake frames go to TX using no-response write',async()=>{
 const ctx=setup(),{token,c}=await ready(ctx);const bytes=frame();await ctx.t.send(token,bytes);
 assert.equal(c.writes.length,1);assert.equal(c.writes[0].type,2);assert.equal(c.writes[0].value.characteristicUuid,tx);
 assert.deepEqual(c.writes[0].bytes,bytes);assert.equal(ctx.last().txBytes,55);assert(new Uint8Array(c.writes[0].value.characteristicValue).every(n=>n===0));
 assert(bytes.some(n=>n!==0));ctx.t.close();assert.equal(ctx.timers.size,0);
});
test('authenticated file frame is sliced as one atomic ATT stream with no added headers',async()=>{
 const ctx=setup(),{token,c}=await ready(ctx,100);ctx.t.retainAuthenticatedSession(token);
 const m=Object.assign(new FileMessage(),{type:4,uuid:'test-7392',chunkID:1,start:0,size:1200,data:new Uint8Array(1200).fill(7)}),bytes=frame({businessID:18,payload:fileMessage(m)});
 await ctx.t.send(token,bytes);assert(c.writes.length>10);assert(c.writes.every(w=>w.bytes.length<=97));assert.deepEqual(Uint8Array.from(c.writes.flatMap(w=>[...w.bytes])),bytes);assert.equal(ctx.last().txBytes,bytes.length);assert(c.writes.every(w=>new Uint8Array(w.value.characteristicValue).every(b=>b===0)));ctx.t.close();
});
test('SmallCore 17 file info and chunks reach native writes; mismatched FileInfo channel and JSON are refused',async()=>{
 const ctx=setup(),{token,c}=await ready(ctx,100);ctx.t.retainAuthenticatedSession(token);
 const md5='0123456789abcdef0123456789abcdef',info=Object.assign(new FileMessage(),{type:1,uuid:'small-7392',fileName:'small-7392',fileSize:1200,md5,busId:17});
 await ctx.t.send(token,frame({businessID:17,payload:fileMessage(info)}));
 const chunk=Object.assign(new FileMessage(),{type:4,uuid:info.uuid,chunkID:1,start:0,size:1200,data:new Uint8Array(1200).fill(7)}),bytes=frame({businessID:17,payload:fileMessage(chunk)});
 const before=c.writes.length;await ctx.t.send(token,bytes);
 assert.deepEqual(Uint8Array.from(c.writes.slice(before).flatMap(w=>[...w.bytes])),bytes);assert(c.writes.slice(before).every(w=>w.bytes.length<=97));
 const refused=c.writes.length;
 await assert.rejects(ctx.t.send(token,frame({businessID:18,payload:fileMessage(info)})),/file-send-profile/);
 info.busId=18;await assert.rejects(ctx.t.send(token,frame({businessID:17,payload:fileMessage(info)})),/file-send-profile/);
 await assert.rejects(ctx.t.send(token,frame({businessID:17,payload:businessEnvelope(2,new TextEncoder().encode('{}'))})));
 assert.equal(c.writes.length,refused);ctx.t.close();
});
test('a failed middle ATT segment aborts whole file and never retries its tail',async()=>{
 const ctx=setup(),{token,c}=await ready(ctx,100);ctx.t.retainAuthenticatedSession(token);let count=0;c.writeCharacteristicValue=async()=>{if(++count===3)throw Error('uncertain');};
 const m=Object.assign(new FileMessage(),{type:4,uuid:'test-7392',size:1200,data:new Uint8Array(1200)});await assert.rejects(ctx.t.send(token,frame({businessID:18,payload:fileMessage(m)})));assert.equal(count,3);assert(c.closed);assert.equal(ctx.last().txBytes,194);assert.equal(ctx.timers.size,0);
});
test('MTU fallback is conservative and never splits an oversized handshake',async()=>{
 const ctx=setup(),token=ctx.t.open('synthetic'),c=ctx.clients[0];c.listeners.get('BLEConnectionStateChange')({state:2});await settle();ctx.fire(2000);await settle();
 assert.equal(ctx.last().mtu,23);assert.equal(ctx.last().stage,'ready');await assert.rejects(ctx.t.send(token,frame()),/mtu-too-small/);assert.equal(c.writes.length,0);
 c.listeners.get('BLEMtuChange')(512);assert.equal(ctx.t.snapshot().mtu,23);
});
test('missing, duplicate, or wrong characteristic properties cannot reach readiness',async()=>{
 for(const mutate of [s=>[],s=>[s[0],s[0]],s=>{s[0].characteristics[0].properties={write:true};return s;},s=>{s[0].characteristics[1].properties={indicate:true};return s;},s=>{s[0].characteristics.push(s[0].characteristics[0]);return s;}]){
  const ctx=setup();ctx.t.open('synthetic');const c=ctx.clients[0];c.services=mutate(c.services);c.listeners.get('BLEConnectionStateChange')({state:2});await settle();assert.equal(ctx.last().reason,'discovery-failed');assert(c.closed);assert.equal(c.notify.length,0);
 }
});
test('duplicate connection callbacks discover only once; failed subscribe closes',async()=>{
 const ctx=setup();ctx.t.open('synthetic');const c=ctx.clients[0],cb=c.listeners.get('BLEConnectionStateChange');let calls=0;c.getServices=async()=>{calls++;return c.services;};
 cb({state:2});cb({state:2});await settle();assert.equal(calls,1);
 c.setCharacteristicChangeNotification=async()=>{throw Error('private system error');};c.listeners.get('BLEMtuChange')(512);await settle();assert.equal(ctx.last().reason,'subscription-failed');assert(c.closed);
});
test('cancel while discovery or subscription pending prevents a late ready',async()=>{
 for(const stage of ['discovery','subscription']){
  const ctx=setup();ctx.t.open('synthetic');const c=ctx.clients[0],d=deferred();
  if(stage==='discovery')c.getServices=()=>d.promise;else c.setCharacteristicChangeNotification=()=>d.promise;
  c.listeners.get('BLEConnectionStateChange')({state:2});await settle();if(stage==='subscription')c.listeners.get('BLEMtuChange')(512);
  ctx.t.close();d.resolve(stage==='discovery'?c.services:undefined);await settle();assert.equal(ctx.last().stage,'closed');assert(c.closed);assert.equal(ctx.timers.size,0);
 }
});
test('stale connection/MTU/notify callbacks do not mutate a reopened transport',async()=>{
 const ctx=setup(),old=await ready(ctx),callbacks=new Map(old.c.listeners);ctx.t.close();const current=ctx.t.open('synthetic-new');
 callbacks.get('BLEConnectionStateChange')({state:0});callbacks.get('BLEMtuChange')(5);callbacks.get('BLECharacteristicChange')({...ch(rx,{}),characteristicValue:Uint8Array.of(1).buffer});
 assert.equal(ctx.last().stage,'connecting');assert.equal(ctx.last().generation,current);assert.equal(ctx.received.length,0);await assert.rejects(ctx.t.send(old.token,frame()),/not-ready/);
});
test('single write in flight, rejection and timeout close uncertain transport',async()=>{
 for(const failure of ['reject','timeout','sync']){
  const ctx=setup(),{token,c}=await ready(ctx),d=deferred();
  c.writeCharacteristicValue=()=>{if(failure==='sync')throw Error('private');return d.promise;};const pending=ctx.t.send(token,frame());const check=assert.rejects(pending,/handshake-write-failed/);
  if(failure!=='sync'){await assert.rejects(ctx.t.send(token,frame()),/write-busy/);if(failure==='reject')d.reject(Error('private'));else ctx.fire(1500);}
  await check;assert.equal(ctx.last().stage,'failed');assert(c.closed);assert.equal(ctx.timers.size,0);d.resolve();await settle();assert.equal(ctx.last().txBytes,0);
 }
});
test('cancellation settles pending write and late resolution cannot count as sent',async()=>{
 const ctx=setup(),{token,c}=await ready(ctx),d=deferred();c.writeCharacteristicValue=()=>d.promise;
 const pending=ctx.t.send(token,frame());const check=assert.rejects(pending);ctx.t.close();await check;d.resolve();await settle();assert.equal(ctx.last().txBytes,0);
});
test('RX filters exact characteristic, copies values transiently, and bounds volume',async()=>{
 const ctx=setup(),{c}=await ready(ctx),notify=c.listeners.get('BLECharacteristicChange');const b=Uint8Array.of(1,2,3);
 notify({...ch(tx,{}),characteristicValue:b.buffer});assert.equal(ctx.received.length,0);
 notify({...ch(rx,{}),characteristicValue:b.buffer});assert.deepEqual(ctx.received[0].bytes,b);assert(ctx.received[0].original.every(n=>n===0));assert.equal(ctx.last().rxBytes,3);
 notify({...ch(rx,{}),characteristicValue:new ArrayBuffer(510)});assert.equal(ctx.last().reason,'receive-limit');assert(c.closed);
});
test('business traffic, unsupported flags, bad CRC and wrong auth size never written',async()=>{
 const ctx=setup(),{token,c}=await ready(ctx);const corrupt=frame();corrupt[10]^=1;
 for(const bytes of [frame({businessID:0x20}),frame({flags:1}),frame({slices:Uint8Array.of(1)}),frame({payload:Uint8Array.of(0x22,0,0)}),frame({payload:Uint8Array.of(0x18,0,0)}),corrupt])await assert.rejects(ctx.t.send(token,bytes));
 assert.equal(c.writes.length,0);assert.equal(ctx.last().stage,'ready');
});
test('twenty-second cap disconnects, invalid MTU fails, snapshots are detached',async()=>{
 const ctx=setup();await ready(ctx);const snapshot=ctx.t.snapshot();snapshot.stage='failed';assert.equal(ctx.t.snapshot().stage,'ready');ctx.fire(20000);assert.equal(ctx.last().reason,'transport-timeout');assert.equal(ctx.timers.size,0);
 const other=setup();other.t.open('synthetic');other.clients[0].listeners.get('BLEMtuChange')(999);assert.equal(other.last().reason,'invalid-mtu');
});
