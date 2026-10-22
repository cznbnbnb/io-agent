import test from 'node:test';
import assert from 'node:assert/strict';
import {loadApp} from './load-app.mjs';
import {loadCore} from './load-core.mjs';
const turn=()=>new Promise(setImmediate);
function fixture(send){
  const timers=new Map(),sent=[],errors=[];let serial=0;
  const clock={setTimeout:(f,n)=>{timers.set(++serial,{f,n});return serial;},clearTimeout:id=>timers.delete(id)};
  const {DisplayPositionDrag}=loadApp('DisplayPositionDrag',{},clock);
  const drag=new DisplayPositionDrag({send:async(h,d)=>{sent.push([h,d]);if(send)await send(h,d);},change(){},fail:r=>errors.push(r)});
  const fire=async(delay)=>{const entry=[...timers.entries()].find(([,v])=>delay===undefined||v.n===delay);assert(entry,'expected scheduled work');timers.delete(entry[0]);entry[1].f();await turn();};
  return {drag,timers,sent,errors,fire,clock};
}
test('rapid height and distance changes coalesce into the last complete pair',async()=>{
  const f=fixture();f.drag.update(2,2,false);f.drag.update(4,2,false);f.drag.update(4,3,true);f.drag.update(6,3,true);
  assert.equal(f.timers.size,1);assert.deepEqual(f.sent,[]);await f.fire();assert.deepEqual(f.sent,[[6,3]]);
  f.drag.reconcile(false);assert.equal(f.drag.height,6);assert.equal(f.drag.distance,3);
  f.drag.reconcile(true);assert.equal(f.drag.pending,false);
});
test('a slow transport never overlaps sends or loses a newer companion field',async()=>{
  let release;const f=fixture(h=>h===2?new Promise(r=>release=r):Promise.resolve());
  f.drag.update(2,1,true);await f.fire();f.drag.update(5,1,false);f.drag.update(5,3,true);await f.fire();
  assert.deepEqual(f.sent,[[2,1]]);f.drag.reconcile(true);assert.equal(f.drag.distance,3);
  release();await turn();await f.fire();assert.deepEqual(f.sent,[[2,1],[5,3]]);
});
test('an old readback while a newer pair is queued cannot reset its draft',async()=>{
  const f=fixture();f.drag.update(2,1,true);await f.fire();f.drag.update(6,3,false);f.drag.reconcile(true);
  assert.equal(f.drag.height,6);assert.equal(f.drag.distance,3);await f.fire();assert.deepEqual(f.sent,[[2,1],[6,3]]);
});
test('disconnect or leaving the page discards the unsent pair and late completion',async()=>{
  let release;const f=fixture(()=>new Promise(r=>release=r));f.drag.update(3,1,true);await f.fire();f.drag.update(6,3,true);f.drag.cancel();
  release();await turn();assert.equal(f.drag.pending,false);assert.equal(f.timers.size,0);assert.deepEqual(f.sent,[[3,1]]);
});
test('ambiguous send failure is visible and does not replay an unsent pair',async()=>{
  const f=fixture(()=>Promise.reject(Error('synthetic connection lost')));f.drag.update(6,3,true);await f.fire();
  assert.deepEqual(f.errors,['synthetic connection lost']);assert.equal(f.drag.pending,false);assert.equal(f.timers.size,0);
});
test('invalid pair does not alter a previous valid draft or send a command',()=>{
  const f=fixture();f.drag.update(4,1,false);
  for(const [h,d] of [[0,1],[7,2],[2,0],[2,4],[1.5,2],[NaN,3]])assert.throws(()=>f.drag.update(h,d,true));
  assert.equal(f.drag.height,4);assert.equal(f.drag.distance,1);assert.deepEqual(f.sent,[]);
});

function integrated(){
  let device;const f=fixture((h,d)=>device.writeDisplay(h,d));
  const {businessEnvelope}=loadCore('./BusinessCommands'),{readLauncherEnvelope}=loadCore('./LauncherStatus');
  const wire=(type,value)=>businessEnvelope(type,new TextEncoder().encode(JSON.stringify(value)));
  const sent=[];const {DeviceFeatures}=loadApp('DeviceFeatures',{},f.clock);
  device=new DeviceFeatures(async(b,bytes)=>sent.push({business:b,packet:readLauncherEnvelope(bytes)}));device.connected(true,50);
  device.receive(15,wire(4,{generalSettings:{displayConfig:{height:2,distance:2}}}));
  device.changed=()=>f.drag.reconcile(!device.launcherBusy);
  return {...f,device,sent,wire};
}
test('real settings readback waits for the final pair; an echo or earlier snapshot cannot release it',async()=>{
  const f=integrated();f.drag.update(4,1,true);await f.fire(0);assert(f.device.displayWritePending);
  f.drag.update(6,3,true);f.device.receive(15,f.wire(4,{generalSettings:{displayConfig:{height:4,distance:1}}}));
  assert.equal(f.drag.distance,3);await f.fire(0);assert.equal(f.device.displayWritePending,true);
  await f.fire(1500);f.device.receive(15,f.wire(6,{cmd:'display_config',payload:{data:'{"height":6,"distance":3}'}}));
  assert(f.drag.pending);f.device.receive(15,f.wire(4,{generalSettings:{displayConfig:{height:6,distance:3}}}));
  assert.equal(f.drag.pending,false);assert.equal(f.device.launcherBusy,false);assert.match(f.device.state.note,/读回确认已生效/);
  const writes=f.sent.filter(x=>x.packet.type===5).map(x=>JSON.parse(JSON.parse(new TextDecoder().decode(x.packet.json)).payload.data));
  assert.deepEqual(writes,[{height:4,distance:1},{height:6,distance:3}]);
});
test('a mismatching final device value stays explicitly unconfirmed, and an unrelated query is not owned by the slider',async()=>{
  const f=integrated();await f.device.refreshSettings();assert(f.device.launcherBusy);assert.equal(f.device.displayWritePending,false);
  f.device.receive(15,f.wire(4,{generalSettings:{displayConfig:{height:2,distance:2}}}));
  f.drag.update(6,3,true);await f.fire(0);await f.fire(1500);
  f.device.receive(15,f.wire(4,{generalSettings:{displayConfig:{height:6,distance:1}}}));
  assert.equal(f.drag.pending,false);assert.match(f.device.state.note,/不一致/);assert.equal(JSON.parse(f.device.state.settingsJson).generalSettings.displayConfig.distance,1);
});
