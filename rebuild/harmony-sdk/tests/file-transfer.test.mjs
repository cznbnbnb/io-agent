import test from 'node:test';import assert from 'node:assert/strict';import {loadCore} from './load-core.mjs';
const {FileMessage,fileMessage,readFileMessage,OutboundFile}=loadCore('./FileTransfer');
const uuid='7392-test',md5='0123456789abcdef0123456789abcdef';
const wire=(type,extra={})=>fileMessage(Object.assign(new FileMessage(),{type,uuid},extra));

test('SmallCore FileInfo matches official protobuf field numbers and business 17 golden bytes; launcher default stays 18',()=>{
 const info=new OutboundFile('a',Uint8Array.of(1,2,3),md5,17).info();
 assert.equal(Buffer.from(info).toString('hex'),'0a2c0a01611201611803222030313233343536373839616263646566303132333435363738396162636465662811');
 assert.equal(readFileMessage(info).busId,17);
 assert.equal(readFileMessage(new OutboundFile(uuid,Uint8Array.of(1),md5).info()).busId,18);
 for(const bus of [0,16,19,20,255])assert.throws(()=>new OutboundFile(uuid,Uint8Array.of(1),md5,bus),/file-info/);
});
test('official iOS parity: outgoing manuscript basename equals did without an added extension',()=>{
 const f=new OutboundFile(uuid,Uint8Array.of(1,2,3),md5),info=readFileMessage(f.info());assert.equal(info.fileName,uuid);assert.equal(info.uuid,uuid);
 assert.throws(()=>wire(1,{fileName:'another.txt',fileSize:3,md5}));
});
test('file info and chunk are protobuf oneofs, not business JSON; all fields round trip',()=>{
 const bytes=wire(1,{fileName:uuid+'.txt',fileSize:48000,md5});assert.equal(bytes[0],10);const info=readFileMessage(bytes);assert.equal(info.md5,md5);assert.equal(info.busId,18);assert.equal(info.fileSize,48000);
 const chunk=readFileMessage(wire(4,{chunkID:123,start:250,size:3,data:Uint8Array.of(1,2,3)}));assert.equal(chunk.type,4);assert.equal(chunk.start,250);assert.deepEqual(chunk.data,Uint8Array.of(1,2,3));
 assert.equal(readFileMessage(Uint8Array.from([42,3,10,1,97])).state,0); // proto3 absent SUCCESS enum
});
test('bounded parser rejects duplicate oneofs, unsafe varints and malformed chunks',()=>{
 const ack=wire(2);assert.throws(()=>readFileMessage(Uint8Array.from([...ack,...ack])));assert.throws(()=>readFileMessage(Uint8Array.of(18,4,10,9,65)));assert.throws(()=>wire(1,{fileName:'../x',fileSize:5,md5}));assert.throws(()=>wire(3,{size:20481}));assert.throws(()=>wire(4,{size:2,data:Uint8Array.of(1)}));assert.throws(()=>readFileMessage(Uint8Array.from([18,12,10,1,97,16,255,255,255,255,255,255,255,127])));
});
test('file sender waits for info ACK, receiver asks offsets, retries same ID exactly, and completion needs coverage',()=>{
 const data=Uint8Array.from({length:48000},(_,i)=>i%251),file=new OutboundFile(uuid,data,md5);data.fill(0);
 assert.throws(()=>file.receive(wire(3,{size:20480})),/before-ack/);file.receive(wire(2));
 assert.throws(()=>file.receive(wire(5)),/premature/);
 for(const [id,start] of [[2,20480],[1,0],[2,20480],[3,40960]]){const m=file.receive(wire(3,{chunkID:id,start,size:20480}));assert(m);assert.equal(m.data[0],start%251);if(start===40960)assert.equal(m.size,7040);file.committed(m);}
 assert.equal(file.sentBytes,48000);assert(!file.complete);assert.throws(()=>file.receive(wire(3,{chunkID:2,start:4,size:100})),/conflict/);
 file.receive(wire(5));assert(file.complete);file.close();assert.equal(file.receive(wire(3,{size:100})),undefined);
});
test('uncommitted bytes, out of range requests, foreign UUID and peer failures never count as complete',()=>{
 const f=new OutboundFile(uuid,new Uint8Array(10),md5);f.receive(wire(2));assert.equal(f.receive(wire(3,{uuid:'other',size:10})),undefined);assert.throws(()=>f.receive(wire(3,{start:10,size:1})));const chunk=f.receive(wire(3,{size:10}));assert.equal(f.sentBytes,0);assert.throws(()=>f.receive(wire(5)),/premature/);f.committed(chunk);assert.throws(()=>f.receive(wire(5,{state:1})),/peer-failed/);assert(!f.complete);
});
