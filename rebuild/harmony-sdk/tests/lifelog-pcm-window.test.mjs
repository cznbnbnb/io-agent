import test from 'node:test';import assert from 'node:assert/strict';import {loadApp} from './load-app.mjs';
const {LifelogPcmWindow}=loadApp('LifelogPcmWindow');const sha='a'.repeat(64),grown='b'.repeat(64);
// Stateful fixture: every output depends on all preceding packets.
function decoder(){let state=17,calls=0,resets=0,closes=0;return{
 reset(){state=17;resets++;},close(){closes++;},decode(index){calls++;state=(state*33+index+1)%32749;return new Float32Array(960).fill(state/32768);},
 counts:()=>({calls,resets,closes})};}
function reference(start,end){const d=decoder(),out=[];d.reset();for(let i=0;i<end;i++){const samples=d.decode(i);if(i>=start)out.push(samples[0]);}return out;}
function window(c,d,start,end,hash=sha,previous=hash,path='/source'){
 c.begin(path,previous,start,end);const out=[];
 for(let i=Math.min(start,c.nextDecodedFrame);i<end;i++){const samples=c.read(i,x=>d.decode(x));if(i>=start)out.push(samples[0]);}
 c.commit(hash);assert.deepEqual(out,reference(start,end));assert(c.retainedFrames<=512);return out;
}
test('overlap and cache eviction match full replay with each packet decoded once',()=>{
 const d=decoder(),c=new LifelogPcmWindow(()=>d.reset(),()=>d.close());
 for(const [start,end] of [[0,250],[84,417],[251,551],[418,551],[500,1000]])window(c,d,start,end);
 assert.equal(d.counts().calls,1000);assert.equal(d.counts().resets,1);assert.equal(c.retainedFrames,512);
});
test('append binds new digest and forward gap replays only missing history',()=>{
 const d=decoder(),c=new LifelogPcmWindow(()=>d.reset(),()=>d.close());window(c,d,0,40);
 window(c,d,70,100,grown,sha);assert.equal(c.replayedFrames,30);assert.equal(d.counts().resets,1);
 window(c,d,90,120,grown);assert.equal(d.counts().calls,120);
});
test('backward seek outside cache, changed prefix and different source reset codec',()=>{
 const d=decoder(),c=new LifelogPcmWindow(()=>d.reset(),()=>d.close());window(c,d,0,600);
 window(c,d,20,50);assert.equal(d.counts().resets,2);
 window(c,d,25,60,grown,grown);assert.equal(d.counts().resets,3);
 window(c,d,30,70,grown,grown,'/other');assert.equal(d.counts().resets,4);
});
test('decode failure or invalid frame clears native state and retained samples',()=>{
 const d=decoder(),c=new LifelogPcmWindow(()=>d.reset(),()=>d.close());window(c,d,0,20);
 c.begin('/source',sha,15,30);const held=c.read(15,()=>assert.fail('cached'));
 assert.throws(()=>c.read(20,()=>{throw Error('codec_failed');}),/codec_failed/);assert(held.every(x=>x===0));
 assert.equal(c.retainedFrames,0);window(c,d,15,30);assert.equal(c.resetForWindow,true);
 c.begin('/source',sha,30,40);assert.throws(()=>c.read(30,()=>new Float32Array(959)),/FRAME_SIZE/);assert.equal(c.retainedFrames,0);
});
test('unfinished window cannot commit and explicit invalidation requires cold replay',()=>{
 const d=decoder(),c=new LifelogPcmWindow(()=>d.reset(),()=>d.close());c.begin('/source','',0,3);c.read(0,x=>d.decode(x));
 assert.throws(()=>c.commit(sha),/COMMIT/);assert.throws(()=>c.read(2,x=>d.decode(x)),/ORDER/);
 c.invalidate();window(c,d,0,3);assert.equal(d.counts().resets,2);
});
