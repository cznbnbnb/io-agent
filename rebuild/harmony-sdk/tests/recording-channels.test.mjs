import test from 'node:test';import assert from 'node:assert/strict';import {loadApp} from './load-app.mjs';
const {recordingMono}=loadApp('RecordingChannels');
test('separate channels survive phase cancellation that would silence the old average',()=>{
 const stereo=Int16Array.of(12000,-12000,6000,-6000);const original=stereo.slice();
 assert.deepEqual(Array.from(recordingMono(stereo)),[0,0]);
 assert.deepEqual(Array.from(recordingMono(stereo,'left')),[12000/32768,6000/32768]);
 assert.deepEqual(Array.from(recordingMono(stereo,'right')),[-12000/32768,-6000/32768]);
 assert.deepEqual(stereo,original);
});
test('diagnostic selection rejects unsupported channels and incomplete stereo samples',()=>{
 assert.throws(()=>recordingMono(Int16Array.of(1,2),'wearer'),/channel-invalid/);
 assert.throws(()=>recordingMono(Int16Array.of(1),'left'),/stereo-invalid/);
});
