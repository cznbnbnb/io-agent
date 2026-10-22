import test from 'node:test';import assert from 'node:assert/strict';import {loadApp} from './load-app.mjs';
const budget=loadApp('TranscriptionBudget');
function setup(battery,thermal,statfs,power={isActive:()=>false}){return loadApp('TranscriptionSignals',{'@kit.BasicServicesKit':{batteryInfo:battery,thermal,power},'@kit.CoreFileKit':{statfs},'./TranscriptionBudget':budget}).readTranscriptionSignals;}
test('real signal adapter preserves uncharged admission and screen-off separately from application foreground',async()=>{
 const read=setup({batterySOC:80,chargingStatus:2,BatteryChargeState:{ENABLE:1,FULL:3}},{getLevel:()=>1,ThermalLevel:{WARM:2}},{getFreeSize:async()=>1e9});
 const s=await read('/sandbox');assert.equal(s.conditions.charging,false);assert.equal(s.screenKnown,true);assert.equal(s.screenActive,false);
 s.conditions.bluetoothLease=true;s.conditions.workerReady=true;assert.equal(budget.admitTranscription(s.conditions).allowed,true);
});
test('signal failures and invalid values stay unknown; warm temperature postpones work',async()=>{
 const read=setup({batterySOC:NaN,chargingStatus:0,BatteryChargeState:{ENABLE:1,FULL:3}},{getLevel:()=>-1,ThermalLevel:{WARM:2}},{getFreeSize:async()=>{throw Error();}},{isActive:()=>{throw Error();}});
 const s=await read('/sandbox');assert.equal(s.conditions.batteryPercent,-1);assert.equal(s.conditions.thermalKnown,false);assert.equal(s.conditions.freeBytes,-1);assert.equal(s.screenKnown,false);
 const warm=await setup({batterySOC:100,chargingStatus:3,BatteryChargeState:{ENABLE:1,FULL:3}},{getLevel:()=>2,ThermalLevel:{WARM:2}},{getFreeSize:async()=>1e9})('/sandbox');
 assert.equal(warm.conditions.thermalLimited,true);warm.conditions.workerReady=true;warm.conditions.foreground=true;assert.equal(budget.admitTranscription(warm.conditions).reason,'thermal_limited_or_unknown');
});
