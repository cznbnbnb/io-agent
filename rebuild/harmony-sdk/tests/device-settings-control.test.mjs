import test from 'node:test';
import assert from 'node:assert/strict';
import {loadApp} from './load-app.mjs';
const binding='a'.repeat(64),peer='b'.repeat(64),id=n=>'dev-'+String(n).padStart(32,'0');
test('observed ranges and unchanged legacy values are distinct from new selectable settings',()=>{
 const {validDeviceSetting:valid,permittedDeviceSettingChange:change}=loadApp('DeviceSettingsControl');
 assert(valid('brightness',{value:17}));assert(!valid('brightness',{value:0}));
 assert(valid('display',{height:6,distance:3}));assert(!valid('display',{height:7,distance:4}));
 const current={headup_on:1,degree:30,crown_switch:5};
 assert(change('wakeup',{...current,degree:31},current));assert(!change('wakeup',{...current,crown_switch:2},current));assert(change('wakeup',{...current,crown_switch:3},current));
 const crown={direction:1,double_action:0,long_press:7};assert(!change('crown',{...crown,long_press:6},crown));
 assert(change('crown',{...crown,long_press:6,direction:0},{...crown,long_press:6}));
});
function setup(){
 const {DeviceSettingsControl,validDeviceSetting}=loadApp('DeviceSettingsControl');
 const receipts=new Map(),state={calls:[],safe:true,failSave:false,peer,connection:1,values:{value:4}};
 let command;
 const snapshot=()=>({peer:state.peer,connection:state.connection,observed_at:Date.now(),groups:{brightness:{...state.values}},bindings:{brightness:binding}});
 const control=new DeviceSettingsControl({command:()=>JSON.stringify(command),result:k=>receipts.get(k),save:(k,v)=>{if(state.failSave)throw Error('disk full');receipts.set(k,v);},safe:()=>state.safe,
  read:async()=>{state.calls.push('read');if(state.afterRead)state.afterRead();return snapshot();},
  apply:async(g,v)=>{state.calls.push(['apply',g,v]);assert.equal(JSON.parse(receipts.get(command.id)).state,'running');if(state.apply)state.apply();else state.values={...v};return snapshot();}});
 return {state,receipts,validDeviceSetting,run:async(action='set',extra={})=>{command={schema:1,id:id(receipts.size+1),action,expires_at:Date.now()+30000,...(action==='set'?{group:'brightness',expected_binding:binding,values:{value:5}}:{}),...extra};await control.poll();return receipts.has(command.id)?JSON.parse(receipts.get(command.id)):undefined;},poll:()=>control.poll()};
}
test('writes persist original values first, verify readback, and explicitly restore',async()=>{
 const f=setup(),set=await f.run();assert.equal(set.state,'complete');assert.equal(set.before.groups.brightness.value,4);assert.equal(set.effect_verified,false);
 const restored=await f.run('restore',{source_id:set.id,expected_binding:binding});assert.equal(restored.state,'complete');assert.equal(f.state.values.value,4);
});
test('stale binding and occupied device never apply',async()=>{
 const f=setup();assert.equal((await f.run('set',{expected_binding:'c'.repeat(64)})).error,'DEVICE_BASELINE_CHANGED');
 f.state.safe=false;assert.equal((await f.run()).error,'DEVICE_BUSY_OR_NOT_READY');assert(!f.state.calls.some(Array.isArray));
});
test('interrupted durable intent is uncertain and never replayed after restart',async()=>{
 const f=setup(),r=await f.run();f.receipts.set(r.id,JSON.stringify({...r,state:'running'}));const before=f.state.calls.length;
 await f.poll();assert.equal(f.state.calls.length,before);assert.equal(JSON.parse(f.receipts.get(r.id)).error,'DEVICE_INTERRUPTED_NO_REPLAY');
});
test('failed readback preserves original values and cannot claim hardware effect',async()=>{
 const f=setup();f.state.apply=()=>{};const r=await f.run();assert.equal(r.state,'uncertain');assert.equal(r.error,'DEVICE_READBACK_MISMATCH');assert.equal(r.before.groups.brightness.value,4);assert.equal(r.effect_verified,false);
});
test('restore refuses another peer or a user change after the original write',async()=>{
 const f=setup(),r=await f.run();f.state.values={value:7};assert.equal((await f.run('restore',{source_id:r.id,expected_binding:binding})).error,'DEVICE_RESTORE_CONFLICT');
 f.state.peer='c'.repeat(64);assert.equal((await f.run('restore',{source_id:r.id,expected_binding:binding})).error,'DEVICE_SOURCE_INVALID');
});
test('failure to persist intent prevents any device write; changed connection stays uncertain',async()=>{
 const f=setup();f.state.failSave=true;await f.run();assert(!f.state.calls.some(Array.isArray));
 const g=setup();g.state.apply=()=>{g.state.connection++;g.state.values={value:5};};assert.equal((await g.run()).error,'DEVICE_CONNECTION_CHANGED');
});
test('expired and invalid commands never apply, and current privacy LED level one is preserved',async()=>{
 const f=setup();assert.equal((await f.run('set',{expires_at:Date.now()-1})).error,'DEVICE_EXPIRED');
 assert.equal(await f.run('set',{values:{value:99}}),undefined);assert(!f.state.calls.some(Array.isArray));
 assert(f.validDeviceSetting('privacy',{mic_on:1,led_level:1,led_auto:1,log_on:0}));assert(!f.validDeviceSetting('privacy',{mic_on:true,led_level:1,led_auto:1,log_on:0}));
});
