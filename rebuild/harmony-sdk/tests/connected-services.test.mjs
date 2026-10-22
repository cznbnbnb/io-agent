import test from 'node:test';import assert from 'node:assert/strict';import {loadApp} from './load-app.mjs';
function setup(){
 let now=100000,loads=0,wakes=0,weather=0,fetches=0,receivers=0,cancels=0,nextTimer=0;
 const timers=new Map();
 const config={asrKey:'synthetic',asrHost:'test.aliyuncs.com',asrModel:'asr',modelKey:'synthetic',weatherHost:'test.qweatherapi.com',weatherKey:'synthetic',weatherCity:'测试'};
 const voice={active:false,state:{enabled:false},enable(){this.state.enabled=true;},disable(){this.state.enabled=false;}};
 const features={displayActive:false,launcherBusy:false,state:{weather:''},changed(){},async voiceWakeup(){wakes++;},async weather(){weather++;}};
 const probe={connection:{phase:'ready'},foreground:true,voice,features,recordingOccupied:()=>false,notificationOccupied:()=>false,prompterOccupied:()=>false};
 const recording={enabled:false,async enable(){receivers++;this.enabled=true;}};
 class Vault{async load(){loads++;return {...config};}}
 class Remote{cancel(){cancels++;}async weather(){fetches++;return {temp:27,icon:101};}}
 const {ConnectedServices}=loadApp('ConnectedServices',{'./ProbeSession':{probeSession:probe},'./RecordingService':{recordings:recording},'./RemoteServices':{SecureServiceConfig:Vault,RemoteServices:Remote}},{Date:{now:()=>now},setTimeout:fn=>{timers.set(++nextTimer,fn);return nextTimer;},clearTimeout:id=>timers.delete(id)});
 return {c:new ConnectedServices(),probe,recording,config,timers,counts:()=>({loads,wakes,weather,fetches,receivers,cancels}),advance:ms=>now+=ms};
}

const settle=async()=>{for(let i=0;i<15;i++)await Promise.resolve();};
test('stopping services removes the timer; stale callbacks cannot restart the loop',async()=>{
 const t=setup();t.c.start();t.c.start();await settle();
 assert.equal(t.timers.size,1);assert.equal(t.counts().loads,1);
 const stale=[...t.timers.values()][0];t.c.stop();
 assert.equal(t.timers.size,0);assert.equal(t.counts().cancels,1);
 const before=t.counts();stale();await settle();
 assert.deepEqual(t.counts(),before);assert.equal(t.timers.size,0);
 t.c.start();await settle();assert.equal(t.timers.size,1);t.c.stop();
});
test('stopping during initialization prevents both hardware writes and rescheduling',async()=>{
 const t=setup();let finish;
 t.c.vault.load=()=>new Promise(resolve=>{finish=resolve;});
 t.c.start();t.c.stop();finish({...t.config});await settle();
 assert.equal(t.counts().wakes,0);assert.equal(t.counts().receivers,0);
 assert.equal(t.timers.size,0);
});
test('old saved config defaults to voice standby then recorder availability then homepage weather, without a feature page',async()=>{
 const t=setup();await t.c.tick();assert(t.probe.voice.state.enabled);assert.equal(t.counts().wakes,1);assert.equal(t.counts().weather,0);
 await t.c.tick();assert.equal(t.counts().receivers,1);await t.c.tick();assert.equal(t.counts().weather,1);
 for(let i=0;i<10;i++)await t.c.tick();assert.equal(t.counts().wakes,1);assert.equal(t.counts().weather,1);
 t.advance(900001);await t.c.tick();assert.equal(t.counts().weather,2);
});
test('explicit automatic voice/weather opt out survives reload and no credentials means no fake weather',async()=>{
 const t=setup();t.config.automaticVoice=false;t.config.automaticWeather=false;await t.c.tick();await t.c.tick();assert.equal(t.counts().wakes,0);assert.equal(t.counts().fetches,0);
 t.config.automaticWeather=true;t.config.weatherKey='';t.c.invalidate();await t.c.tick();assert.equal(t.counts().weather,0);assert.match(t.probe.features.state.weather,/未配置/);
});
test('foreground, real connection and idle occupancy gates prevent initialization during another task',async()=>{
 for(const block of [t=>t.probe.foreground=false,t=>t.probe.connection.phase='idle',t=>t.probe.voice.active=true,t=>t.probe.voice.pendingWrites=true,t=>t.probe.notificationOccupied=()=>true,t=>t.probe.recordingOccupied=()=>true,t=>t.probe.prompterOccupied=()=>true,t=>t.probe.features.displayActive=true]){
  const t=setup();block(t);await t.c.tick();assert.equal(t.counts().wakes,0);assert.equal(t.counts().receivers,0);assert.equal(t.counts().fetches,0);
 }
});
test('reconnect reinitializes only the new connection; settings writes invalidate cached config',async()=>{
 const t=setup();await t.c.tick();await t.c.tick();await t.c.tick();
 t.probe.connection.phase='idle';t.probe.voice.state.enabled=false;t.recording.enabled=false;t.c.connectionChanged();
 t.probe.connection.phase='ready';await t.c.tick();assert.equal(t.counts().wakes,2);assert.equal(t.counts().loads,2);
 t.config.automaticWeather=false;t.c.invalidate();await t.c.tick();await t.c.tick();assert.equal(t.counts().weather,1);
});
