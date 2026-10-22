import test from 'node:test';import assert from 'node:assert/strict';import {loadApp} from './load-app.mjs';
test('settings service returns fresh numeric groups and excludes incomplete fields without leaking peer address',async()=>{
 let calls=0;
 const features={launcherBusy:false,displayActive:false,state:{connected:true,connectionRev:7,statusReadSerial:0,settingsReadSerial:0,
  statusJson:JSON.stringify({generalStatus:{brightness:4,focusMode:{enable:0,enableGlassClose:1}}}),
  settingsJson:JSON.stringify({generalSettings:{autoLockTime:15,privacyConfig:{mic_switch:1,led_light:1,led_auto_light:1,log_switch:0}}})},
  async refreshStatus(){calls++;this.state.statusReadSerial++;},async refreshSettings(){calls++;this.state.settingsReadSerial++;}};
 const probeSession={features,peerDeviceId:'sensitive-peer-address',foreground:true,voice:{active:false},recordingOccupied:()=>false,lifelogOccupied:()=>false,notificationOccupied:()=>false,prompterOccupied:()=>false,agentCaptureOccupied:false,agentSuggestionOccupied:false};
 const {deviceSettingsPorts}=loadApp('DeviceSettingsService',{'./ProbeSession':{probeSession}});
 const ports=deviceSettingsPorts(()=>undefined,()=>undefined,()=>{}),first=await ports.read(),second=await ports.read();
 assert.equal(calls,4);assert.equal(first.groups.privacy.led_level,1);assert.equal(first.groups.sleep.seconds,15);assert.equal(first.groups.display,undefined);
 assert.equal(first.bindings.privacy,second.bindings.privacy);assert(!JSON.stringify(first).includes(probeSession.peerDeviceId));assert.equal(first.connection,7);
 probeSession.recordingOccupied=()=>true;assert.equal(ports.safe(),false);await assert.rejects(ports.read(),/DEVICE_BUSY_OR_NOT_READY/);assert.equal(calls,4);
 probeSession.recordingOccupied=()=>false;probeSession.notificationOccupied=()=>true;assert.equal(ports.safe(),false);await assert.rejects(ports.read(),/DEVICE_BUSY_OR_NOT_READY/);assert.equal(calls,4);
 probeSession.notificationOccupied=()=>false;probeSession.voice.pendingWrites=true;assert.equal(ports.safe(),false);await assert.rejects(ports.read(),/DEVICE_BUSY_OR_NOT_READY/);assert.equal(calls,4);
});

test('a new owner arriving after status read prevents the automatic settings query from crossing its boundary',async()=>{
 let status=0,settings=0,owner=false;
 const features={launcherBusy:false,displayActive:false,state:{connected:true,connectionRev:1,statusReadSerial:0,settingsReadSerial:0,statusJson:'',settingsJson:''},
  async refreshStatus(){status++;this.state.statusReadSerial++;owner=true;},async refreshSettings(){settings++;this.state.settingsReadSerial++;}};
 const probeSession={features,foreground:true,notificationOccupied:()=>owner,voice:{active:false,pendingWrites:false},recordingOccupied:()=>false,lifelogOccupied:()=>false,prompterOccupied:()=>false};
 const {deviceSettingsPorts}=loadApp('DeviceSettingsService',{'./ProbeSession':{probeSession}});
 const ports=deviceSettingsPorts(()=>undefined,()=>undefined,()=>{});
 await assert.rejects(ports.read(),/DEVICE_BUSY_OR_NOT_READY/);assert.equal(status,1);assert.equal(settings,0);
});
