import test from 'node:test';
import assert from 'node:assert/strict';
import {loadApp} from './load-app.mjs';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function setup(send){
 const timers=new Map(),sent=[],errors=[];let serial=0;
 const {BrightnessDrag}=loadApp('BrightnessDrag',{}, {setTimeout:(f,n)=>{timers.set(++serial,{f,n});return serial;},clearTimeout:id=>timers.delete(id)});
 const drag=new BrightnessDrag({send:async v=>{sent.push(v);if(send)await send(v);},change:()=>{},fail:reason=>errors.push(reason)});
 const fire=async()=>{const [id,timer]=timers.entries().next().value;timers.delete(id);timer.f();await tick();};
 return {drag,timers,sent,errors,fire};
}
test('a drag coalesces values and keeps its local target until final device readback',async()=>{
 const f=setup();for(const value of [2,5,9,17])f.drag.update(value,false);
 assert.equal(f.drag.target,17);assert.equal(f.timers.size,1);assert.deepEqual(f.sent,[]);
 await f.fire();assert.deepEqual(f.sent,[17]);f.drag.reconcile(false);assert(f.drag.pending);
 f.drag.reconcile(true);assert(!f.drag.pending);
});
test('slow sends retain only the latest unsent value, without parallel writes',async()=>{
 let release;const f=setup(v=>v===4?new Promise(resolve=>{release=resolve;}):Promise.resolve());
 f.drag.update(4,true);await f.fire();
 f.drag.update(8,false);f.drag.update(12,true);f.drag.update(16,true);await f.fire();assert.deepEqual(f.sent,[4]);
 release();await tick();assert.equal(f.timers.size,1);await f.fire();assert.deepEqual(f.sent,[4,16]);
});
test('an earlier readback does not discard a queued newer drag',async()=>{
 const f=setup();f.drag.update(5,true);await f.fire();f.drag.update(11,false);
 f.drag.reconcile(true);assert.equal(f.drag.target,11);await f.fire();assert.deepEqual(f.sent,[5,11]);
});
test('disconnect or page exit discards queued changes and late send completions',async()=>{
 let release;const f=setup(()=>new Promise(resolve=>{release=resolve;}));
 f.drag.update(4,true);await f.fire();f.drag.update(17,true);f.drag.cancel();release();await tick();
 assert(!f.drag.pending);assert.equal(f.timers.size,0);assert.deepEqual(f.sent,[4]);
});
test('a failed send rolls back the draft and does not replay queued writes',async()=>{
 const f=setup(()=>Promise.reject(new Error('link lost')));f.drag.update(17,true);await f.fire();
 assert(!f.drag.pending);assert.equal(f.timers.size,0);assert.deepEqual(f.errors,['link lost']);assert.deepEqual(f.sent,[17]);
});
test('invalid brightness values never schedule a write',()=>{
 const f=setup();for(const value of [0,18,1.2,NaN])assert.throws(()=>f.drag.update(value,true));
 assert.equal(f.timers.size,0);assert.deepEqual(f.sent,[]);
});
