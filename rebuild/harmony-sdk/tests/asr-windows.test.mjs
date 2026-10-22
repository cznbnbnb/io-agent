import test from 'node:test';import assert from 'node:assert/strict';import {loadApp} from './load-app.mjs';
const {OggOpusWriter,inspectLifelogPrefix}=loadApp('OggOpus');
const {planAsrWindow,windowOwnsUtterance}=loadApp('AsrWindows');
function archive(n=110){const pages=[];const w=new OggOpusWriter(p=>pages.push(p),13,50);w.begin();for(let i=0;i<n;i++)w.push(new Uint8Array(240).fill(3));w.finish();return{pages,bytes:Uint8Array.from(pages.flatMap(p=>Array.from(p)))};}
test('growing OGG exposes only complete validated pages; sealed input needs EOS and no trailing bytes',()=>{
 const {pages,bytes}=archive();const full=inspectLifelogPrefix(bytes,true);assert.equal(full.offsets.length,110);assert.equal(full.eos,true);
 const torn=bytes.slice(0,bytes.length-10);const partial=inspectLifelogPrefix(torn,false);assert.equal(partial.offsets.length,100);assert.equal(partial.eos,false);
 assert.equal(partial.committedBytes,pages.slice(0,-1).reduce((n,p)=>n+p.length,0));assert.throws(()=>inspectLifelogPrefix(torn,true),/INCOMPLETE/);
 const bad=bytes.slice();bad[full.offsets[30]]^=1;assert.throws(()=>inspectLifelogPrefix(bad,false),/CRC_INVALID/);
 const trailing=new Uint8Array(bytes.length+1);trailing.set(bytes);assert.throws(()=>inspectLifelogPrefix(trailing,true),/INCOMPLETE/);
});
test('window planner waits for lookahead and assigns adjacent core ranges without overlap',()=>{
 assert.equal(planAsrWindow(500,0,334,200,false).ready,false);
 const a=planAsrWindow(1000,0,334,200,false),b=planAsrWindow(1000,a.coreEnd,334,200,false);
 assert.equal(a.ready,true);assert.equal(a.coreEnd,b.coreStart);assert.equal(b.decodeStart,134);assert.equal(b.decodeEnd,868);
 const crossingStart=19,crossingEnd=21;assert.equal(windowOwnsUtterance(crossingStart,crossingEnd,a,.06),true);assert.equal(windowOwnsUtterance(crossingStart,crossingEnd,b,.06),false);
 const middle=a.coreEnd*.06;assert.equal(windowOwnsUtterance(middle-.5,middle+.5,a,.06),false);assert.equal(windowOwnsUtterance(middle-.5,middle+.5,b,.06),true);
 const last=planAsrWindow(800,668,334,200,true);assert.equal(last.coreEnd,800);assert(last.ready);assert(planAsrWindow(800,800,334,200,true).done);
 assert.throws(()=>planAsrWindow(60001,0,334,200,true),/INVALID/);assert.throws(()=>planAsrWindow(100,101,334,200,true),/INVALID/);
});
