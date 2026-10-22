import test from 'node:test';
import assert from 'node:assert/strict';
import {loadApp} from './load-app.mjs';

function setup(){
 const busy={recording:false,lifelog:false,prompter:false};const calls=[];
 const p={foreground:true,peerDeviceId:'synthetic-peer',voice:{active:false},agentCaptureOccupied:false,agentSuggestionOccupied:false,
  recordingOccupied:()=>busy.recording,lifelogOccupied:()=>busy.lifelog,prompterOccupied:()=>busy.prompter,
  features:{launcherBusy:false,displayActive:false,displayClosing:false,displayCleanupBlocked:false,displayCanCleanup:false,
   displayStartOperation:'',displaySessionId:'',state:{connected:true,connectionRev:1,displayExitEvidence:'none',displayLastOperation:'',display:''}}};
 const notices={busy:false,waiting:false,held:false,get occupied(){return this.busy||this.waiting||this.held;},timingSeconds:-1,timingSubmission:'none',setDisplaySeconds:async seconds=>{calls.push(seconds);notices.timingSeconds=seconds;notices.timingSubmission='submitted';}};
 const suggestions={active:false};const source=loadApp('ChannelProbeService',{'./ProbeSession':{probeSession:p},'./NotificationService':{notifications:notices,suggestionTests:suggestions}});
 return {p,busy,notices,suggestions,calls,...source};
}

test('notification binding changes across original peer, connection and local intent; it never represents device readback',()=>{
 const s=setup(),first=s.channelProbeSnapshot();assert(first.notice_can_configure);assert.match(first.notice_binding,/^[a-f0-9]{64}$/);
 assert.equal(first.notice_target_seconds,-1);assert.equal(first.notice_device_value_known,false);
 s.p.features.state.connectionRev++;assert.notEqual(s.channelProbeSnapshot().notice_binding,first.notice_binding);
 s.p.features.state.connectionRev--;s.p.peerDeviceId='different-synthetic-peer';assert.notEqual(s.channelProbeSnapshot().notice_binding,first.notice_binding);
 s.p.peerDeviceId='synthetic-peer';s.notices.timingSeconds=120;s.notices.timingSubmission='submitted';
 const after=s.channelProbeSnapshot();assert.notEqual(after.notice_binding,first.notice_binding);assert.equal(after.notice_device_value_known,false);
});

test('all existing capture/display/settings owners block notification timing, including lifelog and pending ordinary notifications',()=>{
 for(const block of [s=>s.p.foreground=false,s=>s.p.features.state.connected=false,s=>s.p.features.launcherBusy=true,s=>s.p.features.displayActive=true,
  s=>s.p.voice.active=true,s=>s.busy.recording=true,s=>s.busy.lifelog=true,s=>s.busy.prompter=true,s=>s.p.agentCaptureOccupied=true,
  s=>s.p.agentSuggestionOccupied=true,s=>s.suggestions.active=true,s=>s.notices.busy=true,s=>s.notices.waiting=true,s=>s.notices.held=true,s=>s.p.voice.pendingWrites=true]){
  const s=setup();block(s);const v=s.channelProbeSnapshot();assert.equal(v.notice_can_configure,false);assert.equal(v.notice_binding,'');assert.equal(s.calls.length,0);
 }
});

test('runtime control uses the guarded notification session only once and keeps the prior unknown state',async()=>{
 const s=setup(),records=new Map();let request;const initial=s.channelProbeSnapshot();
 const control=s.makeChannelProbeControl(()=>JSON.stringify(request),id=>records.get(id),(id,json)=>records.set(id,json));
 request={schema:1,id:'chn-'+'a'.repeat(32),action:'notification-timing',expires_at:Date.now()+30000,notice_seconds:120,binding:initial.notice_binding};
 await control.poll();const receipt=JSON.parse(records.get(request.id));assert.equal(receipt.state,'complete');assert.equal(receipt.before.notice_target_seconds,-1);
 assert.equal(receipt.snapshot.notice_target_seconds,120);assert.equal(receipt.snapshot.notice_device_value_known,false);assert.equal(receipt.lens_verified,false);
 await control.poll();assert.deepEqual(s.calls,[120]);
});
