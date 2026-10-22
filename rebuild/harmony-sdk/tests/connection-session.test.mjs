import test from 'node:test';
import assert from 'node:assert/strict';
import {loadApp} from './load-app.mjs';
const flush=async()=>{for(let i=0;i<60;i++)await Promise.resolve();};
const peer=new Uint8Array([1,2,3,4,5,6]);
const saved={id:'synthetic-device',peer:'010203040506',name:'RayNeo iO',autoConnect:true};
test('capture routing keeps authenticated origin when an earlier feature callback changes the current peer',()=>{
 const t=setup(),payload=Uint8Array.of(1,2,3),seen=[];t.s.peerDeviceId='mutable-before';
 t.s.features.receive=()=>{t.s.peerDeviceId='mutable-after';};
 t.s.onAgentCapture=(sourcePeer,business,bytes,generation)=>{seen.push([sourcePeer,business,bytes,generation]);return true;};
 t.auth.onBusiness(13,payload,'frozen-auth-peer',42);
 assert.equal(t.s.peerDeviceId,'mutable-after');assert.deepEqual(seen,[['frozen-auth-peer',13,payload,42]]);
});

test('recording prompter notification and voice routing retain authenticated origin after a feature callback changes current peer',()=>{
 const t=setup(),payload=Uint8Array.of(1,2,3),seen=[];
 t.s.features.receive=()=>{t.s.peerDeviceId='mutated-current-peer';};t.s.onAgentCapture=()=>false;
 t.s.onRecording=(peer)=>seen.push(['recording',peer]);t.s.onPrompter=(peer,b)=>seen.push(['prompter',peer,b]);
 t.s.onNotification=(peer)=>seen.push(['notification',peer]);t.s.voice.receive=(b,p,peer)=>seen.push(['voice',peer,b]);
 for(const b of [14,17,20,21])t.auth.onBusiness(b,payload,'frozen-auth-peer',42);
 assert.deepEqual(seen,[['voice','frozen-auth-peer',14],['recording','frozen-auth-peer'],['voice','frozen-auth-peer',17],['prompter','frozen-auth-peer',17],['voice','frozen-auth-peer',20],['prompter','frozen-auth-peer',20],['voice','frozen-auth-peer',21],['notification','frozen-auth-peer']]);
});
test('previous explicit background choice restores after ready but does not request it during authentication',async()=>{
 const t=setup({...saved,backgroundEnabled:true});await t.s.resume(t.ctx);assert.equal(t.s.background.active,false);
 t.version.reply();await flush();t.auth.emit();await flush();assert(t.s.background.active);
 await t.s.setBackground(false);assert.equal(JSON.parse(t.values.get('verified_glasses')).backgroundEnabled,false);
});
function setup(initial='',permission=0){
 const values=new Map(initial?[['verified_glasses',typeof initial==='string'?initial:JSON.stringify(initial)]]:[]);
 let writes=0,tid=0,pendingPut;const timers=new Map(),versions=[],auths=[];
 const prefs={async get(k,d){return values.get(k)??d;},async put(k,v){if(pendingPut)await pendingPut;writes++;values.set(k,v);},async flush(){}};
 const store=loadApp('ConnectionStore',{'@kit.AbilityKit':{},'@kit.ArkData':{preferences:{async getPreferences(){return prefs;}}}});
 class Candidate{constructor(){this.id='';this.classic=false;this.deviceName='';}}
 class Identity{async get(){return new Uint8Array(6).fill(9);}}
 class NullRadio{stop(){}close(){}cancel(){}}
 class Discovery extends NullRadio{constructor(update){super();this.update=update;this.starts=0;}start(){this.starts++;this.update({scanning:true,candidates:[]});}finish(candidates=[]){this.update({scanning:false,candidates});}}
 class Version extends NullRadio{constructor(update,accept){super();this.update=update;this.accept=accept;versions.push(this);}start(id){this.id=id;this.starts=(this.starts||0)+1;}reply(bytes=peer){this.accept({peerIdentifier:bytes.slice()});this.update({stage:'received'});}fail(reason){this.update({stage:'failed',reason});}}
 class Auth extends NullRadio{constructor(update){super();this.update=update;auths.push(this);}start(id,input,expectedPeer){this.id=id;this.expectedPeer=expectedPeer.slice();this.phone=input.phoneIdentifier.slice();this.starts=(this.starts||0)+1;}async sendBusiness(){}emit(stage='connected',statusReplies=1,reason=''){this.update({stage,bonded:stage==='connected',battery:99,connectedSeconds:5,statusReplies,reason});}}
 class Features{initializeDisplayCleanup(){}stopDisplayAndWait(){return Promise.resolve(true);}connected(){}receive(){}syncTime(){return Promise.resolve();}}
 class Voice{initializeCleanup(){}connected(){}receive(){}stopAndWait(){return Promise.resolve(true);}}
 class Background{active=false;async start(){this.active=true;}async stop(){this.active=false;}}
 const ctx={filesDir:"/synthetic-app",applicationInfo:{accessTokenId:7}};
 const {probeSession:s}=loadApp('ProbeSession',{
  turbo_core:{Candidate,Discovery,TransportProbe:NullRadio,BleHandshakeTransport:NullRadio,
   BleVersionProbe:Version,BleGuestAuthProbe:Auth,LocalProtocolIdentity:Identity},
  '@kit.AbilityKit':{abilityAccessCtrl:{createAtManager:()=>({checkAccessTokenSync:()=>permission})}},
  '@kit.BackgroundTasksKit':{backgroundTaskManager:{requestSuspendDelay(){throw Error('short-window-not-injected');},cancelSuspendDelay(){}}},
  './ConnectionStore':store,'./DeviceFeatures':{DeviceFeatures:Features},'./VoiceSession':{VoiceSession:Voice},
  './BluetoothBackground':{BluetoothBackground:Background}
 },{setTimeout:(fn,ms)=>{timers.set(++tid,{fn,ms});return tid;},clearTimeout:id=>timers.delete(id)});
 const candidate=new Candidate();candidate.id=saved.id;candidate.deviceName=saved.name;
 const fire=async ms=>{const entry=[...timers.entries()].find(([,v])=>v.ms===ms);assert(entry,'timer '+ms);timers.delete(entry[0]);entry[1].fn();await flush();};
 const captureTimer=ms=>{const entry=[...timers.entries()].find(([,v])=>v.ms===ms);assert(entry,'timer '+ms);return {id:entry[0],...entry[1]};};
 const deferPreferenceWrite=()=>{assert.equal(pendingPut,undefined);let resolve;pendingPut=new Promise(r=>resolve=r);return ()=>{pendingPut=undefined;resolve();};};
 return {s,ctx,candidate,version:versions[0],auth:auths[0],values,timers,fire,captureTimer,deferPreferenceWrite,setPermission:value=>permission=value,writes:()=>writes};
}
test('first connection chains version/auth but saves only after bonded status readback',async()=>{
 const t=setup();await t.s.connect(t.candidate,t.ctx);assert.equal(t.version.starts,1);
 t.version.reply();await flush();assert.equal(t.auth.starts,1);assert.equal(t.writes(),0);
 t.auth.emit('connected',0);await flush();assert.equal(t.s.connection.phase,'initializing');assert.equal(t.writes(),0);
 t.auth.emit();await flush();assert.equal(t.s.connection.phase,'ready');assert.equal(t.s.connection.saved,true);
 assert.equal(JSON.parse(t.values.get('verified_glasses')).peer,saved.peer);assert.equal(t.timers.size,0);
});
test('business readiness fires once only after bonded status, and cancels on manual stop', async()=>{
 const t=setup(saved);let ready=0,lost=0;
 t.s.onLifelogConnected=()=>ready++;t.s.onLifelogDisconnected=()=>lost++;
 await t.s.resume(t.ctx);t.version.reply();await flush();
 t.auth.emit('connected',0);assert.equal(ready,0);
 t.auth.emit();t.auth.emit();t.auth.emit();assert.equal(ready,1);
 t.s.stop();assert.equal(lost,1);assert.equal(t.s.connection.battery,-1);
 await t.s.reconnect(t.ctx);t.version.reply();await flush();t.auth.emit();assert.equal(ready,2);
});
test('saved verified device reconnects on launch without scan and validates peer again',async()=>{
 const t=setup(saved);await t.s.resume(t.ctx);assert.equal(t.version.id,saved.id);
 t.version.reply();await flush();t.auth.emit();await flush();assert.equal(t.s.connection.phase,'ready');assert.equal(t.writes(),0);
});
test('scan address comparison never replaces persisted identity and transport stage is diagnostic only',async()=>{
 const t=setup(saved);await t.s.resume(t.ctx);
 assert(t.s.matchesSavedAddress(t.candidate));assert(!t.s.matchesSavedAddress({...t.candidate,id:'different'}));
 t.version.update({stage:'connecting',transportStage:'discovering'});
 assert.equal(t.s.connection.transportStage,'discovering');assert.equal(t.s.connection.phase,'connecting');
 await t.s.connect({...t.candidate,id:'different'},t.ctx);assert.equal(t.version.starts,1);assert.equal(t.writes(),0);
});
test('explicit address recovery preserves identity and preferences, persists only after authenticated status, then reconnects new route',async()=>{
 const initial={...saved,autoConnect:false,backgroundEnabled:true,name:'用户的眼镜'},t=setup(initial);
 const fresh={...t.candidate,id:'rediscovered-device',deviceName:'Untrusted advertised name'};
 await t.s.recoverSavedAddress(fresh,t.ctx);assert.equal(t.version.id,fresh.id);assert.equal(t.writes(),0);
 t.version.reply();await flush();assert.equal(t.auth.id,fresh.id);assert.deepEqual(t.auth.expectedPeer,peer);
 assert(t.auth.phone.every(n=>n===9));assert.equal(t.writes(),0);
 t.auth.emit('connected',0);await flush();assert.equal(t.s.connection.phase,'initializing');assert.equal(t.writes(),0);
 t.auth.emit();await flush();assert.equal(t.s.connection.phase,'ready');assert.equal(t.writes(),1);
 const stored=JSON.parse(t.values.get('verified_glasses'));
 assert.deepEqual(stored,{...initial,id:fresh.id});
 t.s.stop();await t.s.reconnect(t.ctx);assert.equal(t.version.id,fresh.id);
});
test('different protocol identity at recovered address never starts auth or changes saved route',async()=>{
 const t=setup(saved);await t.s.recoverSavedAddress({...t.candidate,id:'other-device'},t.ctx);
 t.version.reply(new Uint8Array(6).fill(8));await flush();
 assert.equal(t.auth.starts,undefined);assert.equal(t.s.connection.phase,'failed');assert.equal(t.writes(),0);assert.equal(t.timers.size,0);
 await t.s.reconnect(t.ctx);assert.equal(t.version.id,saved.id);
});
test('failed proof, missing status and manual cancellation cannot commit recovered address',async()=>{
 for(const failure of ['proof','status','cancel']){
  const t=setup(saved);await t.s.recoverSavedAddress({...t.candidate,id:'rediscovered-device'},t.ctx);
  t.version.reply();await flush();
  if(failure==='proof')t.auth.emit('failed',0,'proof-mismatch');
  else if(failure==='status'){t.auth.emit('connected',0);await t.fire(12000);}
  else {t.s.stop();t.auth.emit();}
  await flush();assert.equal(t.writes(),0);assert.equal(JSON.parse(t.values.get('verified_glasses')).id,saved.id);
 }
});
test('recovery requires existing valid saved identity, foreground BLE candidate and permission',async()=>{
 for(const initial of ['', '{"id":"bad"}']){
  const t=setup(initial);await t.s.recoverSavedAddress({...t.candidate,id:'fresh'},t.ctx);
  assert.equal(t.version.starts,undefined);assert.equal(t.writes(),0);
 }
 for(const kind of ['permission','background','classic','oversize']){
  const t=setup(saved,kind==='permission'?-1:0);if(kind==='background')t.s.foreground=false;
  const candidate={...t.candidate,id:kind==='oversize'?'x'.repeat(129):'fresh',classic:kind==='classic'};
  await t.s.recoverSavedAddress(candidate,t.ctx);assert.equal(t.version.starts,undefined);assert.equal(t.writes(),0);
 }
});
test('recovery retries selected new route without committing it on transport failure',async()=>{
 const t=setup(saved);await t.s.recoverSavedAddress({...t.candidate,id:'fresh'},t.ctx);
 t.version.fail('transport-timeout');await t.fire(2000);
 assert.equal(t.version.id,'fresh');assert.equal(t.writes(),0);
 t.s.stop();await t.s.reconnect(t.ctx);assert.equal(t.version.id,saved.id);
});

test('saved-route transport timeout scans once, verifies a unique matching route and persists only after status',async()=>{
 const t=setup(saved);await t.s.resume(t.ctx);t.version.fail('transport-timeout');
 assert.equal(t.s.connection.phase,'scanning');assert.equal(t.s.recoveryDiscovery.starts,1);assert.equal(t.timers.size,0);
 t.s.recoveryDiscovery.finish([{...t.candidate,id:'new-route'}]);await flush();assert.equal(t.version.id,'new-route');assert.equal(t.writes(),0);
 t.version.reply();await flush();t.auth.emit('connected',0);assert.equal(t.writes(),0);t.auth.emit();await flush();
 assert.equal(JSON.parse(t.values.get('verified_glasses')).id,'new-route');assert.equal(JSON.parse(t.values.get('verified_glasses')).peer,saved.peer);
});

test('automatic scan never chooses ambiguous names or accepts a different stable identity',async()=>{
 for(const kind of ['none','ambiguous','identity']){
  const t=setup(saved);await t.s.resume(t.ctx);t.version.fail('transport-timeout');
  const candidates=kind==='none'?[]:kind==='ambiguous'?[{...t.candidate,id:'a'},{...t.candidate,id:'b'}]:[{...t.candidate,id:'other'}];
  t.s.recoveryDiscovery.finish(candidates);await flush();if(kind==='identity'){t.version.reply(new Uint8Array(6).fill(8));await flush();}
  assert.equal(t.s.connection.phase,'failed');assert.equal(t.auth.starts,undefined);assert.equal(t.writes(),0);
 }
});

test('cancel or disabled autoconnect fences an old scan completion, firmware hold never scans',async()=>{
 for(const kind of ['stop','off','firmware']){
  const t=setup(saved);await t.s.resume(t.ctx);if(kind==='firmware')t.s.firmwareOccupied=true;t.version.fail('transport-timeout');
  if(kind==='stop')t.s.stop();if(kind==='off')await t.s.setAutoConnect(false);
  t.s.recoveryDiscovery.finish([{...t.candidate,id:'new-route'}]);await flush();assert.equal(t.version.starts,1);assert.equal(t.writes(),kind==='off'?1:0);
 }
});

test('manual pairing send failure retries the selected route exactly once even with autoconnect off',async()=>{
 const t=setup({...saved,autoConnect:false});await t.s.recoverSavedAddress({...t.candidate,id:'new-route'},t.ctx);t.version.reply();await flush();
 t.auth.emit('failed',0,'send-failed');assert.equal(t.s.connection.phase,'retrying');await t.fire(1000);assert.equal(t.version.id,'new-route');
 t.version.reply();await flush();t.auth.emit('failed',0,'send-failed');assert.equal(t.s.connection.phase,'failed');assert.equal(t.version.starts,2);assert.equal(t.timers.size,0);assert.equal(t.writes(),0);
});

test('an explicit firmware connection-only lease permits one scan but never bypasses saved identity validation',async()=>{
 for(const kind of ['same','different','revoked']){
  const t=setup({...saved,autoConnect:false});await t.s.prepare(t.ctx);t.s.firmwareOccupied=true;t.s.firmwareReconnectAllowed=true;await t.s.reconnect(t.ctx);
  t.version.fail('transport-timeout');assert.equal(t.s.connection.phase,'scanning');assert.equal(t.s.recoveryDiscovery.starts,1);
  if(kind==='revoked')t.s.firmwareReconnectAllowed=false;
  t.s.recoveryDiscovery.finish([{...t.candidate,id:'new-route'}]);await flush();
  if(kind==='revoked'){assert.equal(t.version.starts,1);assert.equal(t.writes(),0);continue;}
  t.version.reply(kind==='same'?peer:new Uint8Array(6).fill(8));await flush();
  if(kind==='same'){t.auth.emit();await flush();assert.equal(t.s.connection.phase,'ready');assert.equal(JSON.parse(t.values.get('verified_glasses')).id,'new-route');}
  else {assert.equal(t.s.connection.phase,'failed');assert.equal(t.auth.starts,undefined);assert.equal(t.writes(),0);}
  assert.equal(t.s.firmwareOccupied,true);
 }
});
test('peer identity mismatch stops before authentication, never replaces saved identity',async()=>{
 const t=setup(saved);await t.s.resume(t.ctx);t.version.reply(new Uint8Array(6).fill(8));await flush();
 assert.equal(t.auth.starts,undefined);assert.equal(t.s.connection.phase,'failed');assert.equal(t.writes(),0);assert.equal(t.timers.size,0);
});
test('missing permission and disabled autoconnect do not touch radios',async()=>{
 const t=setup(saved,-1);await t.s.resume(t.ctx);assert.equal(t.version.starts,undefined);assert.equal(t.s.connection.phase,'permission');
 const off=setup({...saved,autoConnect:false});await off.s.resume(off.ctx);assert.equal(off.version.starts,undefined);
});
test('manual disconnect cancels retry and prevents foreground restart until explicit reconnect',async()=>{
 const t=setup(saved);await t.s.resume(t.ctx);t.version.fail('version-timeout');assert.equal(t.s.connection.phase,'retrying');
 t.s.stop();assert.equal(t.timers.size,0);await t.s.resume(t.ctx);assert.equal(t.version.starts,1);
 await t.s.reconnect(t.ctx);assert.equal(t.version.starts,2);
});
test('retriable failure retains its original cause and foreground before radio teardown',async()=>{
 const t=setup(saved),trace=[];await t.s.resume(t.ctx);t.version.reply();await flush();t.auth.emit();
 t.s.trace=(phase,note)=>trace.push({phase,note});
 t.auth.cancel=()=>trace.push({phase:'teardown'});
 t.auth.emit('failed',1,'disconnected');
 assert.equal(t.s.connection.phase,'retrying');
 assert.deepEqual(trace[0],{phase:'failure',note:'reason=disconnected;phase=ready;foreground=true;background=false;retryable=true'});
 assert(trace.findIndex(e=>e.phase==='teardown')>0);
 assert.equal(trace.filter(e=>e.phase==='failure').length,1);
 await t.fire(2000);assert.equal(t.version.starts,2);
});
test('failure diagnostics exclude arbitrary exception text and device identities',async()=>{
 const t=setup(saved),trace=[];await t.s.resume(t.ctx);
 t.s.trace=(phase,note)=>trace.push({phase,note});
 t.version.fail('sensitive address: AA:BB:CC:DD:EE:FF');
 const failure=trace.find(e=>e.phase==='failure');
 assert(failure.note.startsWith('reason=unclassified;'));assert(!failure.note.includes('AA:BB'));assert(!failure.note.includes('sensitive'));
});
test('transient failures have three bounded retries; repeated resume cannot bypass delay',async()=>{
 const t=setup(saved);await t.s.resume(t.ctx);
 for(const ms of [2000,5000,10000]){t.version.fail('version-timeout');const starts=t.version.starts;await t.s.resume(t.ctx);assert.equal(t.version.starts,starts);await t.fire(ms);}
 t.version.fail('version-timeout');assert.equal(t.s.connection.phase,'failed');assert.equal(t.timers.size,0);assert.equal(t.version.starts,4);
});

test('an already-queued old retry cannot erase a new reconnect backoff or run the same retry twice',async()=>{
 const t=setup(saved);await t.s.resume(t.ctx);t.version.fail('version-timeout');const old=t.captureTimer(2000);
 t.s.stop();await t.s.reconnect(t.ctx);assert.equal(t.version.starts,2);t.version.fail('version-timeout');const current=t.captureTimer(2000);
 assert.notEqual(current.id,old.id);old.fn();await flush();assert(t.timers.has(current.id));
 await t.s.resume(t.ctx);assert.equal(t.version.starts,2,'old callback must not let resume bypass the new backoff');
 await t.fire(2000);assert.equal(t.version.starts,3);current.fn();await flush();assert.equal(t.version.starts,3,'an already-consumed retry must not start a second version exchange');
 assert.equal(t.auth.starts,undefined);assert.equal(t.writes(),0);
});

test('an old status callback cannot erase a new status deadline or allocate a duplicate timeout',async()=>{
 const t=setup(saved);await t.s.resume(t.ctx);t.version.reply();await flush();t.auth.emit('connected',0);const old=t.captureTimer(12000);
 t.s.stop();await t.s.reconnect(t.ctx);t.version.reply();await flush();t.auth.emit('connected',0);const current=t.captureTimer(12000);
 assert.notEqual(current.id,old.id);old.fn();await flush();assert.equal(t.s.connection.phase,'initializing');
 t.auth.emit('connected',0);assert.deepEqual([...t.timers.entries()].filter(([,v])=>v.ms===12000).map(([id])=>id),[current.id]);
 await t.fire(12000);assert.equal(t.s.connection.phase,'retrying');assert.equal([...t.timers.values()].filter(v=>v.ms===2000).length,1);
 current.fn();old.fn();await flush();assert.equal([...t.timers.values()].filter(v=>v.ms===2000).length,1);
 assert.equal(t.version.starts,2);assert.equal(t.auth.starts,2);assert.equal(t.writes(),0);
});

test('a status deadline already queued before ready cannot fail the settled connection',async()=>{
 const t=setup(saved);await t.s.resume(t.ctx);t.version.reply();await flush();t.auth.emit('connected',0);const pending=t.captureTimer(12000);
 t.auth.emit();await flush();assert.equal(t.s.connection.phase,'ready');assert.equal(t.timers.size,0);
 pending.fn();await flush();assert.equal(t.s.connection.phase,'ready');assert.equal(t.timers.size,0);
 assert.equal(t.version.starts,1);assert.equal(t.auth.starts,1);assert.equal(t.writes(),0);
});

test('retry deadline rechecks revoked permission, releases background retention and resumes only the original device after permission returns',async()=>{
 const t=setup({...saved,backgroundEnabled:true});await t.s.resume(t.ctx);t.version.reply();await flush();t.auth.emit();await flush();
 assert(t.s.background.active);const original=t.values.get('verified_glasses'),writes=t.writes();
 t.auth.emit('closed',0,'connection-state-0');assert.equal(t.s.connection.phase,'retrying');const pending=t.captureTimer(2000);
 t.setPermission(-1);await t.fire(2000);assert.equal(t.s.connection.phase,'permission');assert.equal(t.s.background.active,false);
 assert.equal(t.version.starts,1);assert.equal(t.auth.starts,1);assert.equal(t.timers.size,0);assert.equal(t.values.get('verified_glasses'),original);
 pending.fn();await t.s.resume(t.ctx);assert.equal(t.s.connection.phase,'permission');assert.equal(t.version.starts,1);
 t.setPermission(0);await t.s.resume(t.ctx);assert.equal(t.version.starts,2);assert.equal(t.version.id,saved.id);
 t.version.reply();await flush();assert.equal(t.auth.id,saved.id);assert.deepEqual(t.auth.expectedPeer,peer);t.auth.emit();await flush();
 assert.equal(t.s.connection.phase,'ready');assert.equal(t.values.get('verified_glasses'),original);assert.equal(t.writes(),writes);
});

test('retry does not connect while disabling autoconnect is awaiting preference persistence; manual reconnect still works',async()=>{
 const t=setup(saved);await t.s.resume(t.ctx);t.version.fail('version-timeout');const pending=t.captureTimer(2000);
 const release=t.deferPreferenceWrite(),saving=t.s.setAutoConnect(false);await flush();
 assert.equal(JSON.parse(t.values.get('verified_glasses')).autoConnect,true,'the persisted value has not changed while put is pending');
 await t.fire(2000);assert.equal(t.version.starts,1,'in-memory autoConnect=false must fence the deadline before save finishes');assert.equal(t.auth.starts,undefined);
 pending.fn();await flush();assert.equal(t.version.starts,1);release();await saving;
 assert.equal(JSON.parse(t.values.get('verified_glasses')).autoConnect,false);assert.equal(t.timers.size,0);
 await t.s.resume(t.ctx);assert.equal(t.version.starts,1);await t.s.reconnect(t.ctx);assert.equal(t.version.starts,2);assert.equal(t.version.id,saved.id);
});
test('authentication proof failure is not retried',async()=>{
 const t=setup(saved);await t.s.resume(t.ctx);t.version.reply();await flush();t.auth.emit('failed',0,'proof-invalid');
 assert.equal(t.s.connection.phase,'failed');assert.equal(t.timers.size,0);
});
test('background cancels attempt; foreground restores only opted-in saved connection',async()=>{
 const t=setup(saved);await t.s.resume(t.ctx);t.s.suspend();t.version.reply();await flush();assert.equal(t.auth.starts,undefined);
 await t.s.resume(t.ctx);assert.equal(t.version.starts,2);assert.equal(t.s.foreground,true);
});
test('status readback timeout cannot be mistaken for ready or persisted first connection',async()=>{
 const t=setup();await t.s.connect(t.candidate,t.ctx);t.version.reply();await flush();t.auth.emit('connected',0);
 await t.fire(12000);assert.equal(t.s.connection.phase,'failed');assert.equal(t.writes(),0);
});
test('corrupt saved identity is not silently replaced',async()=>{
 const t=setup('{"id":"synthetic-device"}');await t.s.resume(t.ctx);
 assert.equal(t.s.connection.phase,'failed');assert.equal(t.version.starts,undefined);assert.equal(t.writes(),0);
 await t.s.connect(t.candidate,t.ctx);assert.equal(t.version.starts,undefined);assert.equal(t.writes(),0);
});
test('autoconnect preference persists and turning it off cancels pending retry',async()=>{
 const t=setup(saved);await t.s.resume(t.ctx);t.version.fail('version-timeout');
 await t.s.setAutoConnect(false);assert.equal(t.timers.size,0);assert.equal(JSON.parse(t.values.get('verified_glasses')).autoConnect,false);
});
test('native background grant retains same connected session across background and foreground',async()=>{
 const t=setup(saved);await t.s.resume(t.ctx);t.version.reply();await flush();t.auth.emit();await flush();
 await t.s.setBackground(true);t.s.suspend();assert.equal(t.s.connection.phase,'ready');assert.equal(t.s.background.active,true);
 await t.s.resume(t.ctx);assert.equal(t.version.starts,1);assert.match(t.s.connection.backgroundReport,/未重新认证/);
});
test('revocation in background stops connection and no retry survives',async()=>{
 const t=setup(saved);await t.s.resume(t.ctx);t.version.reply();await flush();t.auth.emit();await t.s.setBackground(true);
 t.s.suspend();t.s.background.active=false;t.s.background.revoked();assert.equal(t.s.connection.phase,'idle');assert.equal(t.timers.size,0);
});
test('background task requires ready foreground connection and is released on manual disconnect',async()=>{
 const t=setup(saved);await t.s.resume(t.ctx);await t.s.setBackground(true);assert.equal(t.s.background.active,false);
 t.version.reply();await flush();t.auth.emit();await t.s.setBackground(true);assert.equal(t.s.background.active,true);
 t.s.stop();assert.equal(t.s.background.active,false);
});
