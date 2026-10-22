import test from 'node:test';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';import {loadApp} from './load-app.mjs';
const {OggOpusWriter,inspectLifelogPrefix}=loadApp('OggOpus');
const join=chunks=>Uint8Array.from(Buffer.concat(chunks.map(c=>Buffer.from(c))));
function archive(frames=7,perPage=3){const chunks=[],writer=new OggOpusWriter(b=>chunks.push(b),77,perPage);
 const packets=[];writer.begin();for(let i=0;i<frames;i++){const packet=new Uint8Array(240).fill(i%251);packets.push(packet);writer.push(packet);}writer.finish();return{chunks,bytes:join(chunks),packets};}
function setup(bytes,short=65536){let content=bytes,seq=0,maxRead=0,beforeRead=()=>{};const handles=new Map(),reads=[];
 const fs={OpenMode:{READ_ONLY:0},WhenceType:{SEEK_SET:0},openSync:path=>{const h={fd:++seq,path,pos:0};handles.set(h.fd,h);return h;},
  closeSync:h=>handles.delete(h.fd),statSync:()=>({size:content.length}),lseek:(fd,at)=>{handles.get(fd).pos=at;},
  readSync:(fd,buffer)=>{beforeRead();const h=handles.get(fd),n=Math.min(buffer.byteLength,short,content.length-h.pos);new Uint8Array(buffer).set(content.slice(h.pos,h.pos+n));reads.push([h.pos,n]);h.pos+=n;maxRead=Math.max(maxRead,buffer.byteLength);return n;}};
 const {OggFileSource}=loadApp('OggFileSource',{'@kit.CoreFileKit':{fileIo:fs}});
 return{open:(sealed=true,cached=undefined,expectedBytes=0,sha='')=>new OggFileSource('/source.ogg',sealed,cached,expectedBytes,sha),
  replace:b=>content=b,beforeRead:f=>beforeRead=f,handles,maxRead:()=>maxRead,reads};}
test('streamed index matches the strict archive scanner and frame payloads across 64KiB blocks',()=>{
 const a=archive(1000,100),s=setup(a.bytes,317),source=s.open();
 assert.deepEqual(Array.from(source.index.prefix.offsets),Array.from(inspectLifelogPrefix(a.bytes,true).offsets));
 assert.equal(source.index.sha256,createHash('sha256').update(a.bytes).digest('hex'));
 for(const i of [0,99,100,270,271,999])assert.deepEqual(source.frame(i),a.packets[i]);
 assert(s.maxRead()<=65536);source.verifyUnchanged();source.close();source.close();assert.equal(s.handles.size,0);
});
test('warm index reuses verified offsets; a cold instance rebuilds without a persisted trust shortcut',()=>{
 const a=archive(),s=setup(a.bytes),first=s.open(),index=first.index;first.close();
 const next=s.open(true,index,index.prefix.committedBytes,index.sha256);assert.equal(next.scannedPages,0);assert.equal(next.reusedFrames,7);next.close();
 const cold=s.open();assert.equal(cold.reusedFrames,0);assert.equal(cold.scannedPages,a.chunks.length);cold.close();
});
test('partial tail is withheld; later durable pages extend the same validated prefix',()=>{
 const a=archive(),prefix=join(a.chunks.slice(0,3)),partial=join([prefix,a.chunks[3].slice(0,40)]),s=setup(partial);
 const first=s.open(false);assert.equal(first.index.prefix.offsets.length,3);assert.equal(first.index.prefix.committedBytes,prefix.length);const cache=first.index;first.close();
 s.replace(a.bytes);const next=s.open(true,cache,cache.prefix.committedBytes,cache.sha256);
 assert.equal(next.reusedFrames,3);assert.equal(next.scannedPages,2);assert.equal(next.index.prefix.offsets.length,7);assert.equal(next.index.prefix.eos,true);next.close();
});
test('cached prefix mutation, truncation, and checkpoint mismatch reject before decoding and close handles',()=>{
 const a=archive(),s=setup(a.bytes),first=s.open(),cache=first.index;first.close();
 const changed=a.bytes.slice();changed[changed.length-1]^=1;s.replace(changed);assert.throws(()=>s.open(true,cache),/PREFIX_CHANGED/);assert.equal(s.handles.size,0);
 s.replace(a.bytes.slice(0,-1));assert.throws(()=>s.open(false,cache),/PREFIX_CHANGED/);assert.equal(s.handles.size,0);
 s.replace(a.bytes);assert.throws(()=>s.open(true,undefined,a.bytes.length,'f'.repeat(64)),/PREFIX_CHANGED/);assert.equal(s.handles.size,0);
});
test('mutation during inference is rejected at commit; incomplete sealed and corrupt committed pages cannot become usable',()=>{
 const a=archive(),s=setup(a.bytes),source=s.open();const changed=a.bytes.slice();changed[changed.length-1]^=1;s.replace(changed);
 assert.throws(()=>source.verifyUnchanged(),/PREFIX_CHANGED/);source.close();assert.equal(s.handles.size,0);
 assert.throws(()=>s.open(),/CRC_INVALID/);assert.equal(s.handles.size,0);
 s.replace(a.bytes.slice(0,-1));assert.throws(()=>s.open(true),/ARCHIVE_INCOMPLETE/);assert.equal(s.handles.size,0);
 s.replace(join([a.bytes,new Uint8Array([1])]));assert.throws(()=>s.open(false),/ARCHIVE_INCOMPLETE/);assert.equal(s.handles.size,0);
});

test('digest is tied to CRC-validated bytes when the file changes after initial validation',()=>{
 const a=archive(),s=setup(a.bytes);let reads=0;const changed=a.bytes.slice();changed[changed.length-1]^=1;
 s.beforeRead(()=>{if(++reads===2)s.replace(changed);});
 const source=s.open();assert.equal(source.index.sha256,createHash('sha256').update(a.bytes).digest('hex'));
 assert.throws(()=>source.verifyUnchanged(),/PREFIX_CHANGED/);source.close();assert.equal(s.handles.size,0);
});
