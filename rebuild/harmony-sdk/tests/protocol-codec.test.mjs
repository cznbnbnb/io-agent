import test from 'node:test';
import assert from 'node:assert/strict';
import {encodeFrame,decodeFrame,FrameStream,crc16Xmodem,encodeTlvs,decodeTlvs,authRequest,authFields} from '../turbo_core/src/main/ets/ProtocolCodec.ts';
const u=values=>Uint8Array.from(values);
const packet=(extra={})=>({messageNumber:0x1234,flags:0,address:null,slices:u([]),businessID:0x2a,payload:u([1,2,254]),response:false,...extra});
const golden=u([170,85,0,7,18,52,0,42,1,2,254,126,211]);

test('independent CRC and pre-existing Swift golden vector',()=>{
 assert.equal(crc16Xmodem(new TextEncoder().encode('123456789')),0x31c3);
 assert.equal(crc16Xmodem(u([])),0);
 assert.deepEqual(encodeFrame(packet()),golden);assert.deepEqual(decodeFrame(golden),packet());
});
test('all opaque flags/slices roundtrip; optional address golden',()=>{
 for(let flags=0;flags<32;flags++)for(let n=0;n<8;n++){
  const p=packet({flags,address:(flags&2)?255:null,slices:new Uint8Array(n).fill(99)});
  assert.deepEqual(decodeFrame(encodeFrame(p)),p);
 }
 assert.deepEqual(encodeFrame(packet({messageNumber:0xbeef,flags:2,address:33,slices:u([160,176,192]),businessID:225,payload:u([0,255,85])})),u([170,85,0,11,190,239,98,33,160,176,192,225,0,255,85,40,22]));
});
test('every truncation, trailing data and covered single-bit corruption rejects',()=>{
 for(let n=0;n<golden.length;n++)assert.throws(()=>decodeFrame(golden.subarray(0,n)));
 assert.throws(()=>decodeFrame(u([...golden,0])));
 for(let pos=0;pos<golden.length;pos++)for(let bit=0;bit<8;bit++){
  const altered=golden.slice();altered[pos]^=1<<bit;assert.throws(()=>decodeFrame(altered));
 }
});
test('numeric and buffer limits reject rather than silently truncate',()=>{
 for(const change of [{flags:32},{flags:-1},{messageNumber:65536},{messageNumber:1.2},{businessID:NaN},
   {address:1},{flags:2},{flags:2,address:256},{slices:new Uint8Array(8)},{payload:new Uint8Array(65525)}])
  assert.throws(()=>encodeFrame(packet(change)));
 assert.equal(decodeFrame(encodeFrame(packet({payload:new Uint8Array(65524)}))).payload.length,65524);
 assert.throws(()=>encodeFrame(packet({flags:2,address:0,slices:new Uint8Array(7),payload:new Uint8Array(65524)})));
});
test('input and decoded buffers do not alias returned packet state',()=>{
 const source=u([0,0,...golden]);const parsed=decodeFrame(source.subarray(2));source.fill(0);assert.deepEqual(parsed.payload,u([1,2,254]));
 const p=packet();const encoded=encodeFrame(p);p.payload.fill(0);assert.deepEqual(encoded,golden);
});
test('55AA response head roundtrips and is stream-accepted',()=>{
 const p=packet({response:true,payload:u([])});const bytes=encodeFrame(p);
 assert.equal(bytes[0],0x55);assert.equal(bytes[1],0xaa);
 assert.deepEqual(decodeFrame(bytes),p);assert.deepEqual(new FrameStream().feed(bytes),[p]);
 // CRC covers messageNumber..payload only: a head-swapped golden still verifies.
 const swapped=golden.slice();swapped[0]=0x55;swapped[1]=0xaa;
 assert.deepEqual(decodeFrame(swapped),packet({response:true}));
});
test('stream every split and byte-at-a-time reads; no empty completion',()=>{
 for(let split=0;split<=golden.length;split++){
  const stream=new FrameStream();assert.deepEqual([...stream.feed(golden.subarray(0,split)),...stream.feed(golden.subarray(split))],[packet()]);
  assert.equal(stream.pendingBytes(),0);assert.deepEqual(stream.feed(u([])),[]);
 }
 const stream=new FrameStream();let got=[];for(const byte of golden)got.push(...stream.feed(u([byte])));assert.deepEqual(got,[packet()]);
});
test('stream concatenation, pending partial and strict sticky failure/reset',()=>{
 const stream=new FrameStream();assert.equal(stream.feed(u([...golden,...golden,...golden.slice(0,5)])).length,2);
 assert.equal(stream.pendingBytes(),5);assert.deepEqual(stream.feed(golden.slice(5)),[packet()]);
 const corrupt=golden.slice();corrupt[8]^=1;
 assert.throws(()=>stream.feed(u([...golden,...corrupt])));assert.equal(stream.pendingBytes(),0);
 assert.throws(()=>stream.feed(golden),/stream-failed/);stream.reset();assert.deepEqual(stream.feed(golden),[packet()]);
});
test('end of stream rejects partial header/body and requires explicit reset',()=>{
 for(let n=1;n<golden.length;n++){
  const stream=new FrameStream();stream.feed(golden.slice(0,n));assert.throws(()=>stream.finish(),/truncated-stream/);
  assert.throws(()=>stream.feed(golden),/stream-failed/);stream.reset();stream.feed(golden);assert.doesNotThrow(()=>stream.finish());
 }
 assert.doesNotThrow(()=>new FrameStream().finish());
});
test('stream allocation/work bounds and maximum frame split into small feeds',()=>{
 const stream=new FrameStream();assert.throws(()=>stream.feed(new Uint8Array(262145)));stream.reset();
 assert.throws(()=>stream.feed(u(Array(257).fill([...golden]).flat())),/too-many-frames/);stream.reset();
 const bytes=encodeFrame(packet({payload:new Uint8Array(65524)}));let got=[];
 for(let start=0;start<bytes.length;start+=113)got.push(...stream.feed(bytes.subarray(start,start+113)));
 assert.equal(got.length,1);assert.equal(got[0].payload.length,65524);
});
test('TLV bound checks, copies, duplicates preserved generically but rejected for auth',()=>{
 assert.deepEqual(decodeTlvs(encodeTlvs([{tag:1,value:u([2,3])},{tag:1,value:u([])}])),[{tag:1,value:u([2,3])},{tag:1,value:u([])}]);
 for(const bytes of [[1],[1,0],[1,0,2,9]])assert.throws(()=>decodeTlvs(u(bytes)));
 assert.throws(()=>encodeTlvs([{tag:256,value:u([])}]));assert.throws(()=>encodeTlvs([{tag:1,value:new Uint8Array(65522)}]));
 assert.throws(()=>encodeTlvs(Array(65).fill({tag:1,value:u([])})));
 const invalid=encodeTlvs([{tag:24,value:encodeTlvs([{tag:16,value:new Uint8Array(4)},{tag:16,value:new Uint8Array(4)}])}]);
 assert.throws(()=>authFields(invalid,24));
});
test('observed 55-byte auth request shape has synthetic payload and valid local CRC',()=>{
 const payload=authRequest(u([1,2,3,4]),new Uint8Array(32).fill(5));
 assert.equal(payload.length,45);assert.equal(encodeFrame(packet({businessID:16,payload})).length,55);
 assert.deepEqual(authFields(payload,24).map(f=>[f.tag,f.value.length]),[[16,4],[17,32]]);
 assert.throws(()=>authFields(payload,25));assert.throws(()=>authFields(payload,17));
 const reply=payload.slice();reply[0]=25;assert.equal(authFields(reply,25).length,2);
 assert.throws(()=>authRequest(new Uint8Array(3),new Uint8Array(32)));
});
test('1.0.4 observed version field lengths reproduced with synthetic zero values',()=>{
 for(const [shape,size] of [[[[16,1],[17,6],[18,6],[19,1],[22,6],[23,13],[27,1]],68],[[[16,1],[17,6],[18,14],[19,1],[20,15],[21,1],[24,15]],87]]){
  const payload=encodeTlvs([{tag:17,value:encodeTlvs(shape.map(([tag,length])=>({tag,value:new Uint8Array(length)})))}]);
  const frame=encodeFrame(packet({businessID:16,payload}));assert.equal(frame.length,size);assert.deepEqual(decodeFrame(frame).payload,payload);
 }
});
