import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {loadApp} from './load-app.mjs';
import {loadCore} from './load-core.mjs';
const {businessEnvelope}=loadCore('./BusinessCommands');
const {readLauncherEnvelope}=loadCore('./LauncherStatus');
const {FileMessage,fileMessage}=loadCore('./FileTransfer');
const flush=async()=>{for(let i=0;i<80;i++)await Promise.resolve();};

// Execute actual ProbeSession, AppRuntime routing and TeleprompterSession.
// Native scheduling/radio/crypto and unrelated audio services are explicit fakes.
async function setup({grant=true,continuous=false,window=30000,expireImmediately=false,captureOnly=false,voiceOnly=false}={}){
 const writes=[],timers=new Map();let tid=0,requests=0;const cancelled=[],sourceDisconnects=[];let expire;
 const globals={setTimeout:(fn,ms)=>{timers.set(++tid,{fn,ms});return tid;},clearTimeout:id=>timers.delete(id)};
 const manager={requestSuspendDelay(reason,cb){requests++;expire=cb;if(!grant)throw {code:9900002};if(expireImmediately)cb();return {requestId:73,actualDelayTime:window};},cancelSuspendDelay:id=>cancelled.push(id)};
 const saved={id:'synthetic-device',peer:'010203040506',name:'synthetic',autoConnect:true,backgroundEnabled:false};
 const preferences={async get(k,d){return k==='verified_glasses'?JSON.stringify(saved):d;},async put(){},async flush(){}};
 const store=loadApp('ConnectionStore',{'@kit.AbilityKit':{},'@kit.ArkData':{preferences:{getPreferences:async()=>preferences}}});
 class NullRadio{stop(){}close(){}cancel(){}}
 class Candidate{constructor(){this.id='';this.classic=false;}}
 class Identity{async get(){return new Uint8Array(6).fill(9);}}
 class Version extends NullRadio{constructor(update,accept){super();this.update=update;this.accept=accept;}start(){}reply(){this.accept({peerIdentifier:Uint8Array.of(1,2,3,4,5,6)});this.update({stage:'received'});}}
 class Auth extends NullRadio{constructor(update){super();this.update=update;this.closed=true;this.failExit=false;}start(){this.closed=false;}cancel(){this.closed=true;}async sendBusiness(b,p){if(this.closed)throw Error('radio-closed');if(this.failExit&&b===20&&readLauncherEnvelope(p).type===6)throw Error('synthetic-write-failure');writes.push({b,p:p.slice()});}ready(){this.update({stage:'connected',bonded:true,statusReplies:1,battery:90});}}
 class Features{initializeDisplayCleanup(){}stopDisplayAndWait(){return Promise.resolve(true);}connected(){}receive(){}syncTime(){return Promise.resolve();}}
 let voiceStops=0,voiceRelease;
 class Voice{active=false;initializeCleanup(){}connected(){}receive(){}stopAndWait(){voiceStops++;return voiceOnly?new Promise(resolve=>voiceRelease=resolve):Promise.resolve(true);}}
 class Background{active=false;async start(){this.active=true;}async stop(){this.active=false;}}
 const {probeSession:s}=loadApp('ProbeSession',{
  turbo_core:{Candidate,Discovery:NullRadio,TransportProbe:NullRadio,BleHandshakeTransport:NullRadio,BleVersionProbe:Version,BleGuestAuthProbe:Auth,LocalProtocolIdentity:Identity},
  '@kit.AbilityKit':{abilityAccessCtrl:{createAtManager:()=>({checkAccessTokenSync:()=>0})}},'@kit.BackgroundTasksKit':{backgroundTaskManager:manager},
  './ConnectionStore':store,'./DeviceFeatures':{DeviceFeatures:Features},'./VoiceSession':{VoiceSession:Voice},'./BluetoothBackground':{BluetoothBackground:Background}
 },globals);
 const cryptoFramework={createRandom:()=>({generateRandomSync:n=>({data:new Uint8Array(n).fill(9)})}),createMd:()=>{const h=createHash('md5');return {update:async({data})=>h.update(data),digest:async()=>({data:Uint8Array.from(h.digest())})};}};
 const {TeleprompterSession}=loadApp('TeleprompterSession',{'@kit.CryptoArchitectureKit':{cryptoFramework}},globals);
 const tele=new TeleprompterSession((b,p)=>s.auth.sendBusiness(b,p),()=>s.peerDeviceId,()=>true);
 let cleanup='';tele.initializeCleanup({load:()=>cleanup,save:raw=>cleanup=raw});
 const idle={initialize(){},dispose(){},receive(){},disconnected(){},active:false,busy:false};
 let captureStops=0,captureRelease;const capture={receive:()=>false,disconnected(){sourceDisconnects.push('capture');s.agentCaptureOccupied=false;},stopAndWait(){captureStops++;return captureOnly?new Promise(resolve=>captureRelease=resolve):Promise.resolve(true);}};
 const {AppRuntime}=loadApp('AppRuntime',{
  './DebugCardService':{initializeDebugCards(){},disposeDebugCards(){}},
  '@kit.AbilityKit':{},'./ProbeSession':{probeSession:s},'./TeleprompterService':{initializeTeleprompter(){},disposeTeleprompter(){tele.disconnected();},teleprompter:tele},
  './ConnectedServices':{connectedServices:{start(){},stop(){}}},'./LocalWorkspace':{localWorkspace:{setTodoTransport(){},todoConnectionChanged(){},load:async()=>{},changed(){}}},
  './RecordingService':{recordings:{...idle},lifelog:{...idle,connected:async()=>{}},lifelogASR:{initialize(){throw Error('unrelated audio skipped');}},voices:{},startRecordingServices(){},stopRecordingServices(){}},
  './MaterialSyncService':{materialSyncService:{initialize(){},dispose:async()=>{}}},'./TaskService':{taskService:{initialize(){},dispose:async()=>{},voiceSources:{disconnected(){sourceDisconnects.push('source');}}}},
  // Task-recording ownership is unrelated to this real prompter lifecycle.
  // Keep the 115 runtime port explicit rather than loading its recording/ASR dependencies.
  './TaskRecordingService':{taskRecordingCapture:{state:{active:false,binding:'',phase:'idle'},disconnected(){}},initializeTaskRecordingCapture(){},disposeTaskRecordingCapture(){},observeTaskRecordingAudio(){}},
  './NotificationService':{initializeNotifications(){},notifications:{receive(){},disconnected(){}},suggestionTests:{initialize(){},disconnected(){}}},'./TaskSuggestionService':{taskSuggestions:{receive(){},pause(){},stopAndWait:async()=>true},initializeTaskSuggestions(){},disposeTaskSuggestions(){}},'./AgentCaptureService':{agentCapture:capture,initializeAgentCapture(){},disposeAgentCapture(){}},
    './AsrEngine':{AsrEngineClient:class{}}
 });
 const ctx={filesDir:'/synthetic',applicationInfo:{accessTokenId:7}};
 new AppRuntime().initialize(ctx);await s.resume(ctx);s.version.reply();await flush();s.auth.ready();await flush();
 sourceDisconnects.length=0; // Ignore the deliberate pre-connect stop; observe this live session's lifecycle.
 s.background.active=continuous;
 if(voiceOnly){s.voice.active=true;return {s,ctx,timers,cancelled,sourceDisconnects,requests:()=>requests,voiceStops:()=>voiceStops,releaseVoice:confirmed=>voiceRelease(confirmed),expire:()=>expire()};}
 if(captureOnly){s.agentCaptureOccupied=true;return {s,ctx,timers,cancelled,sourceDisconnects,requests:()=>requests,captureStops:()=>captureStops,releaseCapture:confirmed=>captureRelease(confirmed),expire:()=>expire()};}
 await tele.prepare('合成稿7392',120);
 const did=JSON.parse(new TextDecoder().decode(readLauncherEnvelope(writes.find(w=>w.b===20).p).json)).did;
 const business=async(type,patch={})=>{tele.receive(saved.id,20,businessEnvelope(type,new TextEncoder().encode(JSON.stringify({did,action:2,code:1,...patch}))));await flush();};
 const file=async(type,patch={})=>{tele.receive(saved.id,17,fileMessage(Object.assign(new FileMessage(),{type,uuid:did},patch)));await flush();};
 await business(2);await file(2);await file(3,{size:20480});await file(5);await business(2,{code:7});assert.equal(tele.phase,'ready');
 const commands=type=>writes.filter(w=>w.b===20&&readLauncherEnvelope(w.p).type===type);
 return {s,tele,ctx,writes,timers,business,commands,cancelled,sourceDisconnects,requests:()=>requests,expire:()=>expire()};
}

test('without continuous grant, background sends exit and keeps radio until matching ACK',async()=>{
 const t=await setup();t.s.suspend();await flush();
 assert.deepEqual(t.sourceDisconnects,[],'waiting for exit must preserve the current radio/source connection');
 assert.equal(t.s.auth.closed,false,'radio must not invalidate the queued exit');assert.equal(t.requests(),1);assert.equal(t.commands(6).length,1);
 await t.business(6,{did:'unrelated'});assert.equal(t.s.auth.closed,false);
 await t.business(6,{code:'2'});assert.equal(t.s.auth.closed,false,'malformed code cannot complete exit');
 await t.business(6);assert.equal(t.tele.phase,'idle');assert.equal(t.s.auth.closed,true);assert.equal(t.cancelled.length,1);assert.equal(t.timers.size,0);
 assert.deepEqual(t.sourceDisconnects,['source','capture'],'confirmed background disconnect invalidates sources before capture cleanup');
 assert.match(t.tele.note,/提词正文已停止/);
});

test('negative exit reply ends the background wait without declaring the original owner cleared',async()=>{
 const t=await setup();t.s.suspend();await flush();await t.business(6,{code:2});
 assert.equal(t.s.auth.closed,true);assert.equal(t.tele.active,true);assert(t.tele.cleanupSessionId);
 assert.equal(t.commands(6).length,1);assert.equal(t.cancelled.length,1);
});
test('returning foreground cancels native window; late exit never closes the foreground connection',async()=>{
 const t=await setup();t.s.suspend();await flush();await t.s.resume(t.ctx);
 assert.equal(t.s.auth.closed,false);assert.equal(t.cancelled.length,1);await t.business(6);t.expire();await flush();
 assert.equal(t.s.auth.closed,false);assert.equal(t.s.foreground,true);assert.equal(t.tele.phase,'idle');
});
test('repeated background does not renew the window or submit duplicate exit',async()=>{
 const t=await setup();t.s.suspend();await flush();t.s.suspend();await flush();
 assert.equal(t.requests(),1);assert.equal(t.commands(6).length,1);await t.business(6);assert.equal(t.cancelled.length,1);
});
test('native expiry releases radio and retains an unconfirmed-exit message; late ACK cannot revive it',async()=>{
 const t=await setup();t.s.suspend();await flush();t.expire();await flush();
 assert.equal(t.s.auth.closed,true);assert.match(t.tele.note,/退出未确认/);assert.equal(t.cancelled.length,1);assert.equal(t.timers.size,0);
 await t.business(6);assert.match(t.tele.note,/退出未确认/);
});
test('short-window denial cleans resources without claiming device exit',async()=>{
 const t=await setup({grant:false});t.s.suspend();await flush();assert.equal(t.s.auth.closed,true);assert.equal(t.cancelled.length,0);
 assert.match(t.tele.note,/退出未确认/);assert.equal(t.timers.size,0);
});
test('continuous grant retains connection and does not consume a short cleanup window',async()=>{
 const t=await setup({continuous:true});t.s.suspend();await flush();assert.equal(t.requests(),0);assert.equal(t.commands(6).length,1);
 await t.business(6);assert.equal(t.s.auth.closed,false);assert.equal(t.s.background.active,true);assert.equal(t.tele.phase,'idle');
 assert.deepEqual(t.sourceDisconnects,[],'retaining the authenticated radio must not invent a source disconnect');
});
test('local ten-second cap releases resources even when native expiry callback never arrives',async()=>{
 const t=await setup();t.s.suspend();await flush();const [id,timer]=[...t.timers.entries()].at(-1);assert.equal(timer.ms,10000);
 t.timers.delete(id);timer.fn();await flush();assert.equal(t.s.auth.closed,true);assert.equal(t.cancelled.length,1);assert.equal(t.timers.size,0);assert.match(t.tele.note,/退出未确认/);
});
test('native window unusable or expiring synchronously never leaks its returned request ID',async()=>{
 for(const options of [{window:0},{expireImmediately:true}]){
  const t=await setup(options);t.s.suspend();await flush();assert.equal(t.s.auth.closed,true);assert.equal(t.cancelled.length,1);assert.equal(t.timers.size,0);assert.match(t.tele.note,/退出未确认/);
 }
});
test('exit write failure cannot be reported as an ACK and immediately releases the short window',async()=>{
 const t=await setup();t.s.auth.failExit=true;t.s.suspend();await flush();assert.equal(t.s.auth.closed,true);assert.equal(t.cancelled.length,1);assert.equal(t.timers.size,0);assert.match(t.tele.note,/退出未确认/);
});
test('manual stop cancels pending cleanup; old callback cannot close a new authenticated connection',async()=>{
 const t=await setup();t.s.suspend();await flush();t.s.stop();assert.equal(t.cancelled.length,1);assert.equal(t.timers.size,0);
 assert.deepEqual(t.sourceDisconnects,['source','capture']);
 t.s.foreground=true;await t.s.reconnect(t.ctx);t.s.version.reply();await flush();t.s.auth.ready();await flush();const before=t.sourceDisconnects.length;
 t.expire();await flush();assert.equal(t.s.auth.closed,false);assert.equal(t.s.connection.phase,'ready');assert.equal(t.sourceDisconnects.length,before,'old expiry cannot invalidate sources on a new foreground connection');
});

test('capture-only occupancy receives the bounded cleanup window and waits for confirmed stop',async()=>{
 const t=await setup({captureOnly:true});t.s.suspend();await flush();assert.equal(t.requests(),1);assert.equal(t.captureStops(),1);assert.equal(t.s.auth.closed,false);
 t.s.suspend();await flush();assert.equal(t.captureStops(),1);t.releaseCapture(true);await flush();assert.equal(t.s.auth.closed,true);assert.equal(t.s.agentCaptureOccupied,false);assert.equal(t.cancelled.length,1);assert.equal(t.timers.size,0);
 assert.deepEqual(t.sourceDisconnects,['source','capture']);
});

test('capture cleanup expiry closes the radio and a late success cannot close a resumed foreground connection',async()=>{
 const t=await setup({captureOnly:true});t.s.suspend();await flush();t.expire();await flush();assert.equal(t.s.auth.closed,true);assert.equal(t.cancelled.length,1);
 await t.s.resume(t.ctx);t.s.version.reply();await flush();t.s.auth.ready();await flush();assert.equal(t.s.auth.closed,false);t.releaseCapture(true);await flush();assert.equal(t.s.auth.closed,false);
});

test('ordinary assistant alone receives one bounded cleanup window before the radio closes',async()=>{
 const t=await setup({voiceOnly:true});t.s.suspend();await flush();assert.equal(t.requests(),1);assert.equal(t.voiceStops(),1);assert.equal(t.s.auth.closed,false);
 t.s.suspend();await flush();assert.equal(t.voiceStops(),1);t.releaseVoice(false);await flush();assert.equal(t.s.auth.closed,true);assert.equal(t.cancelled.length,1);assert.equal(t.s.voice.active,true,'unknown assistant cleanup must remain occupied');
});

test('ordinary assistant cleanup expiry cannot let its late completion close a resumed connection',async()=>{
 const t=await setup({voiceOnly:true});t.s.suspend();await flush();t.expire();await flush();assert.equal(t.s.auth.closed,true);assert.equal(t.cancelled.length,1);
 await t.s.resume(t.ctx);t.s.version.reply();await flush();t.s.auth.ready();await flush();assert.equal(t.s.auth.closed,false);t.releaseVoice(true);await flush();assert.equal(t.s.auth.closed,false);
});
