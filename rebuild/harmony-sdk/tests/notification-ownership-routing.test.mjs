import test from 'node:test';
import assert from 'node:assert/strict';
import {loadApp} from './load-app.mjs';

function setup(){
 const sent=[],timers=new Map(),disk=new Map();let timer=0;
 class NullPort{}
 class Features{state={connected:true};displayActive=false;launcherBusy=false;}
 class Voice{active=false;}
 const {probeSession:probe}=loadApp('ProbeSession',{
  turbo_core:{Candidate:NullPort,Discovery:NullPort,TransportProbe:NullPort,BleHandshakeTransport:NullPort,BleVersionProbe:NullPort,BleGuestAuthProbe:NullPort,LocalProtocolIdentity:NullPort},
  '@kit.AbilityKit':{},'@kit.BackgroundTasksKit':{backgroundTaskManager:{}},
  './ConnectionStore':{ConnectionStore:NullPort,SavedGlasses:NullPort},'./DeviceFeatures':{DeviceFeatures:Features},'./VoiceSession':{VoiceSession:Voice},'./BluetoothBackground':{BluetoothBackground:NullPort}
 });
 probe.peerDeviceId='synthetic-peer';probe.auth.sendBusiness=async(b,p)=>sent.push({b,p:p.slice()});
 class MemoryStore{initialize(_dir,name){this.name=name;}load(){return disk.get(this.name)||'';}save(json){disk.set(this.name,json);}}
 const service=loadApp('NotificationService',{
  './ProbeSession':{probeSession:probe},'./DisplayCleanupStore':{DisplayCleanupStore:MemoryStore},
  '@kit.CryptoArchitectureKit':{cryptoFramework:{createRandom:()=>({generateRandomSync:n=>({data:new Uint8Array(n).fill(7)})})}}
 },{setTimeout:(fn,ms)=>{timers.set(++timer,{fn,ms});return timer;},clearTimeout:id=>timers.delete(id)});
 service.initializeNotifications('/synthetic');return {probe,sent,timers,disk,...service};
}

test('the actual notification service keeps ordinary voice/display and suggestion starts blocked after receipt timeout and reload',async()=>{
 const s=setup();assert(s.probe.features.canDisplayBegin());assert(s.probe.voice.canBegin());
 await s.notifications.setEnabled(true);await s.notifications.notify('合成标题','合成正文');
 assert.equal(s.sent.length,2);assert(!s.probe.features.canDisplayBegin());assert(!s.probe.voice.canBegin());
 [...s.timers.values()][0].fn();assert(!s.notifications.waiting);assert(s.probe.notificationOccupied());
 await assert.rejects(s.suggestionTests.start('测试','不创建待办'));assert.equal(s.sent.length,2);
 s.notifications.disconnected();s.initializeNotifications('/synthetic');assert(s.probe.notificationOccupied());assert.equal(s.sent.length,2);
 const uid=s.notifications.pendingUid;s.probe.peerDeviceId='another-peer';assert.throws(()=>s.notifications.confirmDismissed(uid));
 s.probe.peerDeviceId='synthetic-peer';s.notifications.confirmDismissed(uid);
 assert(!s.probe.notificationOccupied());assert(s.probe.features.canDisplayBegin());assert(s.probe.voice.canBegin());assert.equal(s.sent.length,2);
 assert.deepEqual([...s.disk.keys()],['notification-cleanup.json']);
});

test('active lifelog blocks ordinary notification configuration before any device write',async()=>{
 const s=setup();s.probe.lifelogOccupied=()=>true;
 await assert.rejects(s.notifications.setEnabled(true));await assert.rejects(s.notifications.setDisplaySeconds(120));
 assert.equal(s.sent.length,0);assert.equal(s.disk.size,0);
});

test('a pending ordinary-voice exit blocks other display and notification setup even when its page is idle',async()=>{
 const s=setup();s.probe.voice.pendingWrites=true;assert.equal(s.probe.voice.active,false);
 assert(!s.probe.features.canDisplayBegin());await assert.rejects(s.notifications.setEnabled(true));
 await assert.rejects(s.suggestionTests.start('测试','不创建待办'));assert.equal(s.sent.length,0);
 s.probe.voice.pendingWrites=false;assert(s.probe.features.canDisplayBegin());await s.notifications.setEnabled(true);assert.equal(s.sent.length,1);
});
test('shared settings draft or wire occupancy blocks notification configuration and suggestion starts',async()=>{
 const s=setup();s.probe.features.launcherBusy=true;assert(!s.probe.voice.canBegin());
 await assert.rejects(s.notifications.setEnabled(true));await assert.rejects(s.suggestionTests.start('测试','不创建待办'));
 assert.equal(s.sent.length,0);assert.equal(s.disk.size,0);
 s.probe.features.launcherBusy=false;await s.notifications.setEnabled(true);assert.equal(s.sent.length,1);
});
