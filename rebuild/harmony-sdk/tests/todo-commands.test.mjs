import test from 'node:test';
import assert from 'node:assert/strict';
import {loadCore} from './load-core.mjs';
const {todoDeleteCommand,isSingleTodoDeleteJson}=loadCore('./TodoCommands');
const {businessEnvelope}=loadCore('./BusinessCommands');
const {encodeFrame,authRequest}=loadCore('./ProtocolCodec');
const encode=text=>new TextEncoder().encode(text);
const body=id=>({eventType:1,scheduleTotal:0,todoTotal:1,eventIDList:[id]});
test('single TODO command carries the exact original four fields and preserves safe numeric IDs',()=>{
 for(const id of [1,2**48-1,Number.MAX_SAFE_INTEGER]){
  const text=todoDeleteCommand(id);assert.deepEqual(JSON.parse(text),body(id));assert.equal(isSingleTodoDeleteJson(encode(text)),true);
 }
 for(const id of [0,-1,1.5,NaN,Infinity,Number.MAX_SAFE_INTEGER+1,'1',null,undefined])assert.throws(()=>todoDeleteCommand(id),/todo-delete-id/);
});
test('single deletion JSON rejects any widened scope, duplicate/escaped keys and ambiguous values',()=>{
 const original=body(17);
 for(const mutate of [b=>b.eventType=0,b=>b.eventType=2,b=>b.scheduleTotal=1,b=>b.todoTotal=0,b=>b.todoTotal=2,
  b=>b.eventIDList=[],b=>b.eventIDList=[17,18],b=>b.eventIDList=[17,17],b=>b.eventIDList=['17'],b=>b.eventIDList=[0],
  b=>b.eventIDList=[-17],b=>b.eventIDList=[1.5],b=>b.eventIDList=[Number.MAX_SAFE_INTEGER+1],b=>b.eventIDList={},
  b=>b.eventIDList=null,b=>b.all=true,b=>delete b.scheduleTotal,b=>b.todoTotal=true,b=>b.eventType='1']){
   const bad=structuredClone(original);mutate(bad);assert.equal(isSingleTodoDeleteJson(encode(JSON.stringify(bad))),false,JSON.stringify(bad));
 }
 for(const text of ['null','[]','true','{}','{"eventType":2,"eventType":1,"scheduleTotal":0,"todoTotal":1,"eventIDList":[17]}',
  '{"event\\u0054ype":1,"scheduleTotal":0,"todoTotal":1,"eventIDList":[17]}',todoDeleteCommand(17)+'x',' '.repeat(193)+todoDeleteCommand(17)])
  assert.equal(isSingleTodoDeleteJson(encode(text)),false,text);
 assert.equal(isSingleTodoDeleteJson(Uint8Array.of(0xff)),false);
 assert.equal(isSingleTodoDeleteJson(encode(' { "eventIDList" : [17], "todoTotal":1, "scheduleTotal":0, "eventType":1 } ')),true);
});

const service='0000b81d-0000-1000-8000-00805f9b34fb',tx='ea8b70d5-2bd3-49ab-9c31-9c38b2c3c4f9',rx='7db3e235-3608-41f3-a03c-955fcbd2ea4b';
const settle=()=>new Promise(resolve=>setImmediate(resolve));
const packet=(businessID,type,json,binary=[])=>encodeFrame({messageNumber:1,flags:0,address:null,slices:new Uint8Array(),businessID,
 payload:Uint8Array.from([...businessEnvelope(type,encode(json)),...(binary.length?[34,binary.length,...binary]:[])]),response:false});
async function transport(mtu=512){
 const timers=new Map();let next=0;const listeners=new Map(),writes=[];
 const characteristic=(id,properties)=>({serviceUuid:service,characteristicUuid:id,properties,descriptors:[],characteristicValue:new ArrayBuffer(0)});
 const client={on:(k,v)=>listeners.set(k,v),off:k=>listeners.delete(k),connect(){},disconnect(){},close(){},setBLEMtuSize(){},
  getServices:async()=>[{serviceUuid:service,characteristics:[characteristic(tx,{writeNoResponse:true}),characteristic(rx,{notify:true})]}],
  setCharacteristicChangeNotification:async()=>{},writeCharacteristicValue:async value=>{writes.push(new Uint8Array(value.characteristicValue).slice());}};
 const kit={constant:{ProfileConnectionState:{STATE_CONNECTED:2,STATE_DISCONNECTED:0}},ble:{GattWriteType:{WRITE_NO_RESPONSE:2},createGattClientDevice:()=>client}};
 const {BleHandshakeTransport}=loadCore('./BleHandshakeTransport',{'@kit.ConnectivityKit':kit},{setTimeout:(fn,ms)=>{const id=++next;timers.set(id,{fn,ms});return id;},clearTimeout:id=>timers.delete(id)});
 const t=new BleHandshakeTransport(()=>{},()=>{}),token=t.open('synthetic-todo');listeners.get('BLEConnectionStateChange')({state:2});await settle();listeners.get('BLEMtuChange')(mtu);await settle();
 return {t,token,writes,timers};
}
test('actual authenticated transport allows only exact single-ID type7 and retains legacy types2/15',async()=>{
 const c=await transport(),good=packet(22,7,todoDeleteCommand(17));
 await assert.rejects(c.t.send(c.token,good));assert.equal(c.writes.length,0);c.t.retainAuthenticatedSession(c.token);
 await c.t.send(c.token,good);assert.deepEqual(c.writes[0],good);
 for(const json of [JSON.stringify({...body(17),eventIDList:[]}),JSON.stringify({...body(17),eventIDList:[17,18]}),JSON.stringify({...body(17),all:true})])
  await assert.rejects(c.t.send(c.token,packet(22,7,json)),/business-type-not-enabled/);
 await assert.rejects(c.t.send(c.token,packet(22,7,todoDeleteCommand(17),[1])),/business-type-not-enabled/);
 for(const type of [6,8,14,16])await assert.rejects(c.t.send(c.token,packet(22,type,todoDeleteCommand(17))),/business-type-not-enabled/);
 for(const type of [2,15])await c.t.send(c.token,packet(22,type,'{}'));
 assert.equal(c.writes.length,3);c.t.close();assert.equal(c.timers.size,0);
});
test('single-ID authorization adds no fragmentation or pre-authentication exception',async()=>{
 const c=await transport(23);c.t.retainAuthenticatedSession(c.token);
 await assert.rejects(c.t.send(c.token,packet(22,7,todoDeleteCommand(17))),/mtu-too-small-no-fragmentation/);assert.equal(c.writes.length,0);c.t.close();
 const other=await transport();other.t.retainAuthenticatedSession(other.token);
 await assert.rejects(other.t.send(other.token,packet(21,7,todoDeleteCommand(17))),/business-type-not-enabled/);
 other.t.close();
});
