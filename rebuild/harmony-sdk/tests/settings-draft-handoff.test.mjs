import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {loadApp} from './load-app.mjs';
import {loadCore} from './load-core.mjs';
const require=createRequire(import.meta.url),deveco=process.env.DEVECO_HOME||'/Applications/DevEco-Studio.app/Contents';
const ts=require(`${deveco}/sdk/default/openharmony/ets/build-tools/ets-loader/node_modules/typescript`);
const {businessEnvelope}=loadCore('./BusinessCommands'),{readLauncherEnvelope}=loadCore('./LauncherStatus');
const wire=(type,value)=>businessEnvelope(type,new TextEncoder().encode(JSON.stringify(value)));
const settle=async()=>{for(let i=0;i<60;i++)await Promise.resolve();};
const source=fs.readFileSync(new URL('../entry/src/main/ets/pages/FeaturePanel.ets',import.meta.url),'utf8');
// Execute the real page fields and handlers; omit only ArkUI's declarative builders.
const origin=source.match(/class SettingsDraftOrigin[^\n]+/)[0];
const helpersAt=source.indexOf('  private subObj(');
const pageSource=(source.slice(source.indexOf('export struct FeaturePanel'),source.indexOf('  @Builder'))+
 source.slice(helpersAt,source.indexOf('  @Builder',helpersAt)))
 .replace('export struct FeaturePanel','export class FeaturePanel').replace(/@(?:State|Prop|Link)\s*/g,'').replace(/@Watch\([^)]*\)\s*/g,'')+'\n}';
const compiled=ts.transpileModule(origin+'\n'+pageSource,{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS}}).outputText;
function fixture(){
 const timers=new Map(),sent=[],asrs=[];let serial=0,sendHook;
 const clock={setTimeout:(f,ms)=>{timers.set(++serial,{f,ms});return serial;},clearTimeout:id=>timers.delete(id)};
 const {DeviceFeatures}=loadApp('DeviceFeatures',{},clock);
 class NullPort{constructor(report){this.report=report;}close(){}cancel(){}}
 class ASR{constructor(){asrs.push(this);}close(){}start(){}append(){}}
 class Model{cancel(){}}
 const {VoiceSession}=loadApp('VoiceSession',{'libturbo_audio.so':{reset(){},close(){}},'./CloudASR':{CloudASR:ASR},'./RemoteServices':{ServiceConfig:NullPort,RemoteServices:Model},
  '@kit.CryptoArchitectureKit':{cryptoFramework:{createRandom:()=>({generateRandomSync:n=>({data:new Uint8Array(n).fill(7)})})}}},clock);
 const {probeSession:probe}=loadApp('ProbeSession',{
  turbo_core:{Candidate:NullPort,Discovery:NullPort,TransportProbe:NullPort,BleHandshakeTransport:NullPort,BleVersionProbe:NullPort,BleGuestAuthProbe:NullPort,LocalProtocolIdentity:NullPort},
  '@kit.AbilityKit':{},'@kit.BackgroundTasksKit':{backgroundTaskManager:{}},'./ConnectionStore':{ConnectionStore:NullPort,SavedGlasses:NullPort},
  './DeviceFeatures':{DeviceFeatures},'./VoiceSession':{VoiceSession},'./BluetoothBackground':{BluetoothBackground:NullPort}
 });
 probe.peerDeviceId='original-synthetic-peer';probe.auth.sendBusiness=async(b,p)=>{const e=readLauncherEnvelope(p);sent.push({b,e});if(sendHook)await sendHook(b,e);};
 probe.features.initializeDisplayCleanup({load:()=>'',save(){}},()=>probe.peerDeviceId);probe.features.connected(true,50);
 probe.features.receive(15,wire(1,{generalStatus:{brightness:5,battery:50}}));
 probe.features.receive(15,wire(4,{generalSettings:{displayConfig:{height:2,distance:2}}}));
 let voiceRecord='';probe.voice.initializeCleanup({load:()=>voiceRecord,save:raw=>voiceRecord=raw});
 probe.voice.connected(true);probe.voice.enable({asrKey:'synthetic',asrHost:'synthetic.invalid',asrModel:'synthetic',modelKey:'synthetic'});
 const module={exports:{}};
 vm.runInNewContext(compiled,{module,exports:module.exports,probeSession:probe,...loadApp('BrightnessDrag',{},clock),...loadApp('DisplayPositionDrag',{},clock),
  deviceSettingsPorts:()=>({safe:()=>false}),ServiceConfig:NullPort,SecureServiceConfig:NullPort,RemoteServices:NullPort,CloudASR:NullPort});
 const page=new module.exports.FeaturePanel();page.active=true;page.tab='设备';page.getUIContext=()=>({getPromptAction:()=>({showToast(){}})});
 probe.features.changed=()=>page.refresh();probe.voice.changed=()=>page.refreshVoice();page.refresh();
 const fire=async ms=>{const next=[...timers].find(([,v])=>v.ms===ms);assert(next,`timer ${ms}`);timers.delete(next[0]);next[1].f();await settle();};
 return {probe,page,timers,sent,asrs,fire,setSendHook:f=>sendHook=f};
}
test('a 120ms local draft blocks physical assistant wake, then hands ownership to the wire until actual readback',async()=>{
 const f=fixture();f.page.queueBrightnessDraft(9,false);
 assert.equal(f.probe.features.localSettingsPending,true);assert.equal(f.probe.features.wireBusy,false);assert.equal(f.probe.features.launcherBusy,true);
 f.probe.voice.receive(13,wire(1,{}));await settle();assert.equal(f.probe.voice.active,false);assert.equal(f.sent.length,0);
 await f.fire(120);assert.equal(f.probe.features.localSettingsPending,false);assert.equal(f.probe.features.wireBusy,true);assert(!f.probe.voice.canBegin());
 await f.fire(1500);f.probe.features.receive(15,wire(1,{generalStatus:{brightness:9,battery:50}}));await settle();
 assert.equal(f.page.brightnessDrag.pending,false);assert.equal(f.probe.features.launcherBusy,false);assert(f.probe.voice.canBegin());
});
for(const kind of ['brightness','display'])test(`${kind} draft is discarded when leaving the device tab, including a stale timer`,async()=>{
 const f=fixture();if(kind==='brightness')f.page.queueBrightnessDraft(9,false);else f.page.queueDisplayDraft(5,3,false);
 const stale=[...f.timers.values()][0].f;f.page.tab='录音';f.page.deviceTabChanged();stale();await settle();
 assert.equal(f.sent.length,0);assert.equal(f.timers.size,0);assert.equal(f.probe.features.localSettingsPending,false);assert.equal(f.probe.features.wireBusy,false);
});
for(const change of ['disconnect','peer','generation'])test(`queued display cannot rebind itself after ${change}`,async()=>{
 const f=fixture();f.page.queueDisplayDraft(5,3,false);
 if(change==='disconnect'){f.probe.features.connected(false,-1);f.probe.features.connected(true,50);}
 else if(change==='peer')f.probe.peerDeviceId='replacement-synthetic-peer';else f.probe.features.state.connectionRev++;
 if(f.timers.size)await f.fire(120);await settle();assert.equal(f.sent.length,0);assert.equal(f.probe.features.localSettingsPending,false);assert.equal(f.page.displayDrag.pending,false);
});
test('cancelling a local controller after submission preserves the underlying readback transaction',async()=>{
 const f=fixture();f.page.queueDisplayDraft(5,3,true);await f.fire(0);f.page.queueDisplayDraft(6,3,false);
 f.page.tab='录音';f.page.deviceTabChanged();assert.equal(f.page.displayDrag.pending,false);assert.equal(f.probe.features.localSettingsPending,false);
 assert.equal(f.probe.features.wireBusy,true);assert.equal(f.probe.voice.canBegin(),false);assert.equal([...f.timers.values()].some(t=>t.ms===120),false);
 await f.fire(1500);f.probe.features.receive(15,wire(4,{generalSettings:{displayConfig:{height:5,distance:3}}}));await settle();
 assert.equal(f.probe.features.wireBusy,false);assert.match(f.probe.features.state.note,/读回确认已生效/);
 assert.equal(f.sent.filter(x=>x.e.type===5).length,1);
});
test('own continuous display writes keep the newest pair and release after final readback without a self lock',async()=>{
 const f=fixture();f.page.queueDisplayDraft(5,2,true);await f.fire(0);assert.equal(f.page.displayControlsEnabled(),true);
 f.page.queueDisplayDraft(2,3,false);assert.equal(f.probe.features.localSettingsPending,true);assert.equal(f.page.displayControlsEnabled(),true);
 await f.fire(120);assert.equal(f.probe.features.localSettingsPending,false);assert.equal(f.page.displayControlsEnabled(),true);
 await f.fire(1500);f.probe.features.receive(15,wire(4,{generalSettings:{displayConfig:{height:2,distance:3}}}));await settle();
 assert.equal(f.page.settingsPending,false);assert.equal(f.page.displayDrag.pending,false);assert.equal(f.probe.features.launcherBusy,false);
 const writes=f.sent.filter(x=>x.e.type===5).map(x=>JSON.parse(JSON.parse(new TextDecoder().decode(x.e.json)).payload.data));
 assert.deepEqual(writes,[{height:5,distance:2},{height:2,distance:3}]);
});
for(const operation of ['display','query'])test(`a draft cannot borrow another owner ${operation} to remain enabled or send`,async()=>{
 const f=fixture();f.page.queueDisplayDraft(5,3,false);
 if(operation==='display')await f.probe.features.writeDisplay(4,1);else await f.probe.features.refreshSettings();
 assert.equal(f.page.displayControlsEnabled(),false);await f.fire(120);assert.equal(f.sent.filter(x=>x.e.type===5).length,operation==='display'?1:0);
 assert.equal(f.page.displayDrag.pending,false);assert.equal(f.probe.features.wireBusy,true);
});
test('own continuous brightness sends are not blocked by their preceding readback lease',async()=>{
 const f=fixture();f.page.queueBrightnessDraft(9,true);await f.fire(0);f.page.queueBrightnessDraft(12,false);await f.fire(120);
 assert.equal(f.probe.features.localSettingsPending,false);assert.equal(f.page.brightnessDrag.target,12);
 await f.fire(1500);f.probe.features.receive(15,wire(1,{generalStatus:{brightness:12,battery:50}}));await settle();
 assert.equal(f.page.brightnessDrag.pending,false);assert.equal(f.probe.features.launcherBusy,false);
 assert.equal(f.sent.filter(x=>x.e.type===2).length,2);
});
test('a shared owner appearing before delayed send cancels the draft without crossing its boundary',async()=>{
 const f=fixture();f.page.queueBrightnessDraft(9,false);f.probe.agentCaptureOccupied=true;await f.fire(120);
 assert.equal(f.sent.length,0);assert.equal(f.probe.features.localSettingsPending,false);assert.equal(f.page.brightnessDrag.pending,false);
});
test('wire admission is occupied synchronously and rechecks shared ownership before its microtask sends',async()=>{
 const f=fixture(),write=f.probe.features.brightness(9);assert.equal(f.probe.features.wireBusy,true);
 f.probe.agentCaptureOccupied=true;await assert.rejects(write,/占用/);assert.equal(f.sent.length,0);assert.equal(f.probe.features.wireBusy,false);
});
test('a write queued at the wire layer also rejects a changed original peer',async()=>{
 const f=fixture(),write=f.probe.features.brightness(9);f.probe.peerDeviceId='replacement-synthetic-peer';
 await assert.rejects(write,/连接已变化/);assert.equal(f.sent.length,0);assert.equal(f.probe.features.wireBusy,false);
});
test('prompter connection-ready is emitted only on a fresh authenticated ready transition',()=>{
 const f=fixture();let lifelog=0,prompter=0;f.probe.authChanged=()=>{};
 f.probe.onLifelogConnected=()=>lifelog++;f.probe.onPrompterConnected=()=>prompter++;
 const ready={stage:'connected',bonded:true,statusReplies:1,battery:50};
 f.probe.auth.report(ready);f.probe.auth.report(ready);assert.equal(lifelog,1);assert.equal(prompter,1);
 f.probe.auth.report({stage:'disconnected',bonded:false,statusReplies:0,battery:-1});f.probe.auth.report(ready);
 assert.equal(lifelog,2);assert.equal(prompter,2);
});
