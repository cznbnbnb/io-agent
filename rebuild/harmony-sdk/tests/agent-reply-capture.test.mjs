import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {loadApp} from './load-app.mjs';
import {loadCore} from './load-core.mjs';
import {setupMaterialStore} from './material-fixture.mjs';
const {businessEnvelope}=loadCore('./BusinessCommands'),{readLauncherEnvelope}=loadCore('./LauncherStatus');
const flush=async()=>{for(let i=0;i<25;i++)await Promise.resolve();};
function setup(t,initialEpoch=0){
  const files=setupMaterialStore(t),sent=[],timers=new Map(),models=[],recognizers=[],buffers=[],events=[],promotionFailures=[];let timer=0,peer='synthetic-peer',available=true,handler,prepareWait,exitWait,failStart=false,decodedBytes=4,decodedSilent=false,now=Date.now();
  let capture,promotionIndex=0,connectionEpoch=initialEpoch;const promote=files.io.renameSync;
  files.io.renameSync=(a,b)=>{const index=++promotionIndex;try{return promote(a,b);}catch(error){const failure={index,target:b.split(/[\\/]/).pop(),phase:capture?.state.phase,step:capture?.state.step,code:error.code||error.message};promotionFailures.push(failure);t.diagnostic('capture-promotion-failure '+JSON.stringify(failure));throw error;}};
  class Clock extends Date{static now(){return now;}}
  class Models{initialize(){}async ensure(){return '/synthetic/prompter-ctc-zh-2025-04-01';}}
  class ASR{
    constructor(){recognizers.push(this);this.onText=()=>{};this.onError=()=>{};}
    async prepare(directory){models.push(directory);if(prepareWait)await prepareWait;}
    async begin(){}append(bytes){events.push('append');buffers.push(Uint8Array.from(bytes));}
    async finishInput(){events.push('finish');}close(){events.push('close');this.closed=true;}waitForExit(){return exitWait||Promise.resolve();}
  }
  const globals={Date:Clock,setTimeout:(f,ms)=>{timers.set(++timer,{f,ms,due:now+ms});return timer;},clearTimeout:id=>timers.delete(id)};
  const mod=loadApp('AgentReplyCapture',{'@kit.CoreFileKit':{fileIo:files.io},'./LocalFollowASR':{LocalFollowASR:ASR},'./PrompterModel':{PrompterModelStore:Models},
    '@kit.CryptoArchitectureKit':{cryptoFramework:{createMd:()=>{const hash=createHash('sha256');return{updateSync:value=>hash.update(value.data),digestSync:()=>({data:Uint8Array.from(hash.digest())})};}}},
    'libturbo_audio.so':{reset(){},close(){},decode(){const pcm=new Uint8Array(decodedBytes);if(!decodedSilent){pcm[0]=12;if(decodedBytes>1)pcm[1]=1;}return pcm.buffer;}}},
    globals);
  const sender=async(b,bytes)=>{
    const p=readLauncherEnvelope(bytes),j=JSON.parse(new TextDecoder().decode(p.json));sent.push({b,type:p.type,j,ownedBytes:bytes});
    if(j.rc===1&&p.type===2){assert.equal(JSON.parse(fs.readFileSync(files.root+'/agent-reply-capture.json','utf8')).cleanup_peer,peer);if(failStart)throw Error('synthetic ambiguous write');}
    if(handler)await handler(p.type,j);
  };
  capture=new mod.AgentReplyCapture(sender,()=>peer,()=>available,()=>connectionEpoch);capture.initialize({filesDir:files.root});
  // Actual audio occupies protobuf binary field 4, not the JSON field 3
  // emitted by businessEnvelope. Malformed JSON-only audio must not pass.
  const receive=(type,from=peer,binary=Uint8Array.of(1,2,3),epoch=connectionEpoch)=>capture.receive(from,13,type===3?Uint8Array.of(8,1,16,3,34,binary.length,...binary):businessEnvelope(type,new TextEncoder().encode(type===8?'{"rc":6}':'{}')),epoch);
  const elapse=async ms=>{const target=now+ms;for(let steps=0;steps<1000;steps++){
    const item=[...timers.entries()].filter(([,v])=>v.due<=target).sort((a,b)=>a[1].due-b[1].due||a[0]-b[0])[0];
    if(!item){now=target;await flush();return;}now=item[1].due;timers.delete(item[0]);item[1].f();await flush();
   }assert.fail('synthetic timer loop exceeded its finite bound');};
  const tick=async ms=>{assert([...timers.values()].some(v=>v.ms===ms),'timer '+ms);await elapse(ms);};
  return {...files,c:capture,mod,globals,sender,sent,models,recognizers,buffers,events,promotionFailures,timers,receive,
    autoExit:()=>handler=(type,j)=>{if(type===7&&j.rc===1)receive(8);},handler:v=>handler=v,
    holdPrepare:p=>prepareWait=p,holdExit:p=>exitWait=p,offline:()=>{peer='';},online:()=>{peer='synthetic-peer';},busy:()=>available=false,
    decodeBytes:value=>decodedBytes=value,silent:value=>decodedSilent=value,setEpoch:value=>connectionEpoch=value,
    failStart:()=>failStart=true,journal:()=>JSON.parse(fs.readFileSync(files.root+'/agent-reply-capture.json','utf8')),
    advance:ms=>now+=ms,get now(){return now;},elapse,
    tick,stopWithoutExit:async(cancelled=false)=>{const work=capture.stop(cancelled);await flush();await elapse(4000);await work;}};
}

test('type1 timing is passive and exact-peer/current-epoch only, including preparation before mic intent',async t=>{
 const s=setup(t,7);let release;s.holdPrepare(new Promise(resolve=>release=resolve));const starting=s.c.start('passive-startup',15);await flush();
 const first=s.now;assert.equal(s.c.state.phase,'preparing');assert.equal(s.receive(1),true);
 assert.equal(s.c.state.type1Packets,1);assert.equal(s.c.state.firstType1At,first);assert.equal(s.c.state.phase,'preparing');assert.equal(s.sent.length,0);assert.equal(s.timers.size,0);
 s.advance(12);s.receive(1);assert.equal(s.c.state.type1Packets,2);assert.equal(s.c.state.firstType1At,first);
 s.receive(1,'other-peer');s.receive(1,'synthetic-peer',undefined,6);s.receive(1,'synthetic-peer',undefined,0);
 assert.equal(s.c.state.type1Packets,2);assert.equal(s.sent.length,0);
 release();await starting;const before=[...s.timers.entries()];s.advance(5);s.receive(1);assert.equal(s.c.state.type1Packets,3);assert.equal(s.c.state.phase,'listening');assert.deepEqual([...s.timers.entries()],before);
 assert.deepEqual(s.sent.map(row=>({type:row.type,j:row.j})),[{type:2,j:{rc:1}}]);
 s.autoExit();await s.c.stop(true);const count=s.c.state.type1Packets;s.receive(1);assert.equal(s.c.state.type1Packets,count);
});

test('startup observations from an old preparation epoch are discarded at the actual mic intent',async t=>{
 const s=setup(t,7);let release;s.holdPrepare(new Promise(resolve=>release=resolve));const starting=s.c.start('epoch-startup');await flush();s.receive(1);assert.equal(s.c.state.type1Packets,1);
 s.setEpoch(8);release();await starting;assert.equal(s.c.state.type1Packets,0);assert.equal(s.c.state.firstType1At,0);
 s.receive(1,'synthetic-peer',undefined,7);assert.equal(s.c.state.type1Packets,0);s.receive(1);assert.equal(s.c.state.type1Packets,1);s.autoExit();await s.c.stop(true);
});

test('mic write timestamps surround the actual pending native sender without implying received audio',async t=>{
 const s=setup(t,9);let complete;s.handler(async(type,j)=>{if(type===2&&j.rc===1)await new Promise(resolve=>complete=resolve);});
 const starting=s.c.start('pending-native-write');await flush();const started=s.now;
 assert.equal(s.c.state.phase,'starting');assert.equal(s.c.state.micWriteStartedAt,started);assert.equal(s.c.state.micWriteCompletedAt,0);
 assert.equal(s.c.state.packets,0);assert.equal(s.c.state.firstDecodedSamples,0);s.advance(17);complete();await starting;
 assert.equal(s.c.state.micWriteStartedAt,started);assert.equal(s.c.state.micWriteCompletedAt,started+17);assert.equal(s.c.state.phase,'listening');assert.equal(s.c.state.packets,0);
 const raw=Uint8Array.of(4,5,6,7,8);s.decodeBytes(1920);s.receive(3,'synthetic-peer',raw);
 assert.equal(s.c.state.firstDecodedCompressedBytes,5);assert.equal(s.c.state.firstDecodedSamples,960);
 s.decodeBytes(640);s.receive(3,'synthetic-peer',Uint8Array.of(9));assert.equal(s.c.state.firstDecodedCompressedBytes,5);assert.equal(s.c.state.firstDecodedSamples,960);
 s.autoExit();await s.c.stop(true);assert.equal(s.journal().schema,3);assert.equal(Object.keys(s.journal()).length,7);
 const restored=new s.mod.AgentReplyCapture(async()=>assert.fail('restore must not send'),()=> 'synthetic-peer',()=>true,()=>9);restored.initialize({filesDir:s.root});assert.equal(restored.state.observationRestored,true);
 for(const key of ['type1Packets','firstType1At','micWriteStartedAt','micWriteCompletedAt','firstDecodedCompressedBytes','firstDecodedSamples'])assert.equal(restored.state[key],0);
});

test('old pending mic completion and post-disconnect type1 cannot manufacture current startup observations',async t=>{
 const s=setup(t,11);let complete;s.handler(async(type,j)=>{if(type===2&&j.rc===1)await new Promise(resolve=>complete=resolve);});const starting=s.c.start('old-native-write');await flush();
 assert(s.c.state.micWriteStartedAt>0);s.c.disconnected();s.setEpoch(12);s.advance(20);s.receive(1);assert.equal(s.c.state.type1Packets,0);complete();await starting;await flush();
 assert.equal(s.c.state.micWriteCompletedAt,0);assert.equal(s.c.state.phase,'cleanup_pending');
});

test('a failed mic write or invalid PCM has no successful-completion or first-decoded measurement',async t=>{
 const failed=setup(t,12);failed.autoExit();failed.failStart();await failed.c.start('failed-native-write');assert(failed.c.state.micWriteStartedAt>0);assert.equal(failed.c.state.micWriteCompletedAt,0);failed.c.disconnected();
 const invalid=setup(t,13);invalid.autoExit();await invalid.c.start('invalid-first-frame');invalid.decodeBytes(3);invalid.receive(3);await flush();
 assert.equal(invalid.c.state.firstDecodedCompressedBytes,0);assert.equal(invalid.c.state.firstDecodedSamples,0);invalid.c.disconnected();
});

test('sourceOrigin is available only for the exact complete live transcript on its original positive connection epoch',async t=>{
 const s=setup(t,7),token='source-live-original';s.autoExit();await s.c.start(token);assert.throws(()=>s.c.sourceOrigin(token,''),/SOURCE_UNAVAILABLE/);
 s.receive(3);s.recognizers[0].onText('用新价格，运费沿用上次',true,1);await s.c.stop();
 const text=s.c.state.text;assert.equal(s.c.sourceOrigin(token,text),7);
 assert.throws(()=>s.c.sourceOrigin('another-token',text),/SOURCE_UNAVAILABLE/);assert.throws(()=>s.c.sourceOrigin(token,text+'。'),/SOURCE_UNAVAILABLE/);
 s.setEpoch(8);assert.throws(()=>s.c.sourceOrigin(token,text),/SOURCE_UNAVAILABLE/);s.setEpoch(7);
 s.offline();assert.throws(()=>s.c.sourceOrigin(token,text),/SOURCE_UNAVAILABLE/);s.online();
 const restored=new s.mod.AgentReplyCapture(async()=>assert.fail('restoration must not send'),()=> 'synthetic-peer',()=>true,()=>7);
 restored.initialize({filesDir:s.root});assert.equal(restored.state.phase,'draft');assert.throws(()=>restored.sourceOrigin(token,text),/SOURCE_UNAVAILABLE/);
 s.c.clearDraft();assert.throws(()=>s.c.sourceOrigin(token,text),/SOURCE_UNAVAILABLE/);
});
test('epoch zero diagnostics and locally complete text without exit proof never become trusted capture sources',async t=>{
 const s=setup(t);s.autoExit();await s.c.start('legacy-fixture');s.receive(3);s.recognizers[0].onText('保留原来的诊断能力',true,1);await s.c.stop();
 assert.equal(s.c.state.phase,'draft');assert.throws(()=>s.c.sourceOrigin('legacy-fixture',s.c.state.text),/SOURCE_UNAVAILABLE/);
 const p=setup(t,4);await p.c.start('pending-exit');p.receive(3);p.recognizers[0].onText('本机文字完整',true,1);const stopping=p.c.stop();await flush();await p.elapse(300);await stopping;
 assert.equal(p.c.state.transcriptStatus,'complete');assert.equal(p.c.state.phase,'cleanup_pending');assert.throws(()=>p.c.sourceOrigin('pending-exit',p.c.state.text),/SOURCE_UNAVAILABLE/);p.c.disconnected();await flush();
});
test('origin is frozen at mic intent and other or missing epochs cannot append audio or supply device exit',async t=>{
 const s=setup(t,2);let prepare;s.holdPrepare(new Promise(resolve=>prepare=resolve));const starting=s.c.start('origin-at-intent');await flush();s.setEpoch(3);prepare();await starting;
 assert.equal(s.receive(3,'synthetic-peer',Uint8Array.of(1),2),false);assert.equal(s.receive(3,'synthetic-peer',Uint8Array.of(1),0),false);
 assert.equal(s.c.state.packets,0);assert.equal(s.receive(8,'synthetic-peer',Uint8Array.of(1),2),false);assert.equal(s.c.state.exitObserved,false);
 s.receive(3);s.recognizers[0].onText('实际开麦轮次',true,1);s.autoExit();await s.c.stop();assert.equal(s.c.sourceOrigin('origin-at-intent',s.c.state.text),3);
 s.c.disconnected();s.setEpoch(4);assert.throws(()=>s.c.sourceOrigin('origin-at-intent',s.c.state.text),/SOURCE_UNAVAILABLE/);
});
test('source observation precedes capture filters, remains after clear, and cannot consume or mutate normal forwarded audio',async t=>{
 const s=setup(t,5),observed=[];s.c.observeSource=(sourcePeer,epoch,business,bytes)=>observed.push({sourcePeer,epoch,business,bytes:Array.from(bytes)});
 const raw=Uint8Array.of(8,1,16,3,34,2,9,8),before=raw.slice();assert.equal(s.c.receive('foreign',13,raw,12),false);
 assert.deepEqual(raw,before);assert.deepEqual(observed,[{sourcePeer:'foreign',epoch:12,business:13,bytes:Array.from(raw)}]);
 s.autoExit();await s.c.start('observe-after-copy');s.receive(3);s.recognizers[0].onText('全文副本',true,1);await s.c.stop();s.c.clearDraft();
 const decoderCalls=s.buffers.length;assert.equal(s.c.receive('synthetic-peer',13,raw,5),false);assert.deepEqual(raw,before);assert.equal(s.buffers.length,decoderCalls);
 assert.deepEqual(observed.at(-1),{sourcePeer:'synthetic-peer',epoch:5,business:13,bytes:Array.from(raw)});
});
test('a source-observer failure protects provenance while preserving capture processing and normal inactive forwarding',async t=>{
 const s=setup(t,6);s.autoExit();await s.c.start('observe-fault');s.c.observeSource=()=>{throw Error('synthetic source persistence failure');};
 assert.equal(s.receive(3),true);assert.equal(s.c.state.packets,1);s.recognizers[0].onText('文字仍然完整保留',true,1);await s.c.stop();
 assert.equal(s.c.state.phase,'draft');assert.throws(()=>s.c.sourceOrigin('observe-fault',s.c.state.text),/SOURCE_UNAVAILABLE/);
 s.c.clearDraft();assert.equal(s.receive(3),false,'a failed source hook cannot swallow unrelated assistant traffic');
});

test('explicit start prepares local ASR before mic, persists cleanup first and emits only business13 recorder commands',async t=>{
  const s=setup(t);let release;s.holdPrepare(new Promise(r=>release=r));const start=s.c.start('original-request-v1',15);await flush();assert.equal(s.sent.length,0);assert.equal(s.c.state.phase,'preparing');
  release();await start;assert.equal(s.sent.length,1,s.c.state.step);assert.equal(s.sent[0].b,13);assert.equal(s.sent[0].type,2);assert.deepEqual(s.sent[0].j,{rc:1});assert(s.sent[0].ownedBytes.every(v=>v===0));
  assert.equal(s.journal().binding,'original-request-v1');assert.equal(s.journal().draft_valid,false);s.autoExit();s.receive(3);await s.c.stop(true);
  assert(s.sent.every(row=>row.b===13&&[2,7].includes(row.type)));assert.equal(s.c.active,false);
});

test('partial rewrites and multiple spoken segments preserve the whole condition and final tail in a bound draft',async t=>{
  const s=setup(t);s.autoExit();await s.c.start('request-quote-v3');s.receive(3);const asr=s.recognizers[0];
  asr.onText('用新价',false,1);asr.onText('用新价格',true,1);asr.onText('但运费沿用',false,2);asr.finishInput=async()=>asr.onText('但运费沿用上次',true,2);
  await s.c.stop();assert.equal(s.c.state.text,'用新价格，但运费沿用上次');assert.equal(s.c.state.phase,'draft');assert.equal(s.c.state.savedDraftValid,true);
  assert.equal(s.journal().cleanup_peer,'');assert.equal(s.journal().binding,'request-quote-v3');assert.equal(s.journal().text,s.c.state.text);
  const restored=new s.mod.AgentReplyCapture(async()=>assert.fail('restore never starts mic'),()=>'',()=>true);restored.initialize({filesDir:s.root});assert.equal(restored.state.phase,'draft');assert.equal(restored.state.binding,'request-quote-v3');
});

test('a missing first audio packet stops after six seconds and cannot manufacture a valid draft after restart',async t=>{
  const s=setup(t);s.autoExit();await s.c.start('request-no-audio');s.recognizers[0].finishInput=async()=>s.recognizers[0].onText('synthetic ungrounded text',true,1);
  await s.tick(6000);await flush();assert.equal(s.c.state.phase,'failed');assert.equal(s.c.state.savedDraftValid,false);assert.equal(s.journal().draft_valid,false);
  const next=new s.mod.AgentReplyCapture(async()=>assert.fail('restore must not send'),()=>'',()=>true);next.initialize({filesDir:s.root});assert.equal(next.state.phase,'failed');assert.equal(next.state.savedDraftValid,false);
});

test('no exit notification keeps a durable cleanup obligation and no automatic mic retry',async t=>{
  const s=setup(t);await s.c.start('request-unknown-stop');s.receive(3);s.recognizers[0].onText('保留条件',true,1);
  const work=s.c.stop();await flush();assert.equal(s.c.state.phase,'stopping');assert.equal(s.journal().draft_valid,false);assert.equal(s.events.includes('finish'),false);
  await s.tick(300);await work;assert.equal(s.c.state.phase,'cleanup_pending');assert.equal(s.c.state.tailTimedOut,false);assert.equal(s.c.state.transcriptStatus,'complete');assert.equal(s.c.state.savedDraftValid,false);assert.equal(s.c.state.text,'保留条件');await assert.rejects(s.c.start('next-request'));assert.equal(s.sent.filter(row=>row.type===2&&row.j.rc===1).length,1);
  const sent=[];const next=new s.mod.AgentReplyCapture(async(_b,bytes)=>{const p=readLauncherEnvelope(bytes);sent.push({type:p.type,json:JSON.parse(new TextDecoder().decode(p.json))});},()=> 'synthetic-peer',()=>true);next.initialize({filesDir:s.root});assert.equal(next.state.phase,'cleanup_pending');assert.equal(sent.length,0);
  const cleaning=next.cleanup();await flush();await s.elapse(4000);await cleaning;assert(sent.every(row=>row.type!==2||row.json.rc===2));assert.equal(next.state.transcriptStatus,'complete');next.disconnected();
});

test('wrong peer, type4 and stale generation do not close or append to the active capture',async t=>{
  const s=setup(t);s.autoExit();await s.c.start('request-isolation');assert.equal(s.receive(3,'other-peer'),false);s.receive(4);assert.equal(s.c.state.packets,0);assert.equal(s.c.state.exitObserved,false);
  const onText=s.recognizers[0].onText;s.c.disconnected();onText('late old answer',true,1);assert.equal(s.c.state.text,'');assert.equal(s.c.state.phase,'cleanup_pending');
});

test('JSON-only audio is malformed and stops without a usable draft',async t=>{
  const s=setup(t);s.autoExit();await s.c.start('request-malformed-audio');
  s.c.receive('synthetic-peer',13,businessEnvelope(3,Uint8Array.of(1,2,3)));await flush();
  assert.equal(s.c.state.packets,0);assert.equal(s.c.state.savedDraftValid,false);assert.equal(s.c.active,false);
});

test('cancel during model preparation cannot later open the microphone',async t=>{
  const s=setup(t);let release;s.holdPrepare(new Promise(r=>release=r));const starting=s.c.start('request-cancel-prepare');await flush();const stopped=s.c.stop(true);release();await Promise.all([starting,stopped]);assert.equal(s.sent.length,0);assert.equal(s.c.state.phase,'idle');
});

test('mic write ambiguity sends only stop commands and never retries start',async t=>{
  const s=setup(t);s.autoExit();s.failStart();await s.c.start('request-ambiguous');assert.equal(s.sent.filter(r=>r.type===2&&r.j.rc===1).length,1);assert(s.sent.some(r=>r.type===2&&r.j.rc===2));assert.equal(s.c.state.savedDraftValid,false);s.c.disconnected();
});

test('existing audio/display occupation prevents both model preparation and microphone side effects',async t=>{
  const s=setup(t);s.busy();await assert.rejects(s.c.start('request-busy'));assert.equal(s.models.length,0);assert.equal(s.sent.length,0);
});

test('real capture service blocks an active task card before preparation and rechecks a card claimed during model load',async t=>{
  const s=setup(t);let service,released=0,drains=0,sourceDisconnects=0;const sourcePackets=[],notices={occupied:true};
  // This occupancy-only service fixture observes the source port explicitly;
  // real durable receipts are exercised by the copy-clear-late integration.
  const taskService={voiceSources:{observe(...args){sourcePackets.push(args);},disconnected(){sourceDisconnects++;}}};
  const probe={foreground:true,features:{state:{connected:true},displayActive:false},peerDeviceId:'synthetic-peer',voice:{active:false,async waitForIdleWrites(){drains++;}},
    agentSuggestionOccupied:true,recordingOccupied:()=>false,lifelogOccupied:()=>false,prompterOccupied:()=>false,
    auth:{connectionGeneration:1,async sendBusiness(b,bytes){await s.sender(b,bytes);const p=readLauncherEnvelope(bytes);if(p.type===7)service.agentCapture.receive('synthetic-peer',13,businessEnvelope(8,new TextEncoder().encode('{"rc":6}')),1);}}};
  service=loadApp('AgentCaptureService',{'@kit.AbilityKit':{},'./AgentReplyCapture':{AgentReplyCapture:s.mod.AgentReplyCapture},'./ProbeSession':{probeSession:probe},
    './TaskService':{taskService},'./NotificationService':{notifications:notices,suggestionTests:{active:false}},
    './RecordingService':{interactiveTranscriptionBusy:()=>false,resumePendingTranscriptions(){released++;}}});
  service.initializeAgentCapture({filesDir:s.root});
  assert.deepEqual({...taskService.voiceSources.connection()},{peer:'synthetic-peer',epoch:1});
  await assert.rejects(service.agentCapture.start('original-card-busy',15));
  assert.equal(s.models.length,0);assert.equal(s.sent.length,0);assert.equal(fs.existsSync(s.root+'/agent-reply-capture.json'),false);
  probe.agentSuggestionOccupied=false;await assert.rejects(service.agentCapture.start('ordinary-notice-still-visible',15));
  assert.equal(s.models.length,0);assert.equal(s.sent.length,0);notices.occupied=false;
  probe.voice.pendingWrites=true;await assert.rejects(service.agentCapture.start('ordinary-exit-still-pending',15));
  assert.equal(s.models.length,0);assert.equal(s.sent.length,0);probe.voice.pendingWrites=false;
  probe.features.launcherBusy=true;await assert.rejects(service.agentCapture.start('settings-draft-pending',15));
  assert.equal(s.models.length,0);assert.equal(s.sent.length,0);probe.features.launcherBusy=false;
  probe.features.launcherBusy=true;await assert.rejects(service.agentCapture.beforeMic(),/完成设备设置/);probe.features.launcherBusy=false;
  probe.agentSuggestionOccupied=false;let resumePrepare;s.holdPrepare(new Promise(r=>resumePrepare=r));
  const starting=service.agentCapture.start('original-card-arrives-during-prepare',15);await flush();
  assert.equal(service.agentCapture.state.phase,'preparing');assert.equal(probe.agentCaptureOccupied,true);
  probe.agentSuggestionOccupied=true;resumePrepare();await starting;
  assert.equal(service.agentCapture.active,false);assert.equal(probe.agentCaptureOccupied,false);assert.equal(s.sent.length,0);
  assert.equal(fs.existsSync(s.root+'/agent-reply-capture.json'),false,'no microphone intent when the card won the display');
  probe.agentSuggestionOccupied=false;assert.equal(s.sent.length,0,'releasing a card does not automatically start capture');
  await service.agentCapture.start('new-explicit-start-after-card-release',15);assert.equal(s.sent.filter(x=>x.type===2&&x.j.rc===1).length,1);
  assert.equal(probe.agentCaptureOccupied,true);assert(drains>0);await service.agentCapture.stop(true);
  assert.equal(service.agentCapture.active,false);assert.equal(probe.agentCaptureOccupied,false);assert(released>0);
  service.disposeAgentCapture();
  assert.equal(sourceDisconnects,1);assert(sourcePackets.length>0);assert(sourcePackets.every(args=>args[0]==='synthetic-peer'&&args[1]===1&&args[2]===13));
});

test('confirmed mic exit cannot release the lease until native Worker exit is also observed',async t=>{
  const s=setup(t);s.autoExit();await s.c.start('request-worker-drain');s.receive(3);let release;s.holdExit(new Promise(r=>release=r));const stopping=s.c.stop();await flush();assert.equal(s.c.active,true);
  release();await stopping;assert.equal(s.c.active,false);
});

test('a synchronous recognizer failure during stop cannot reenter and submit two stop sequences',async t=>{
  const s=setup(t);s.autoExit();await s.c.start('request-stop-reentry');s.receive(3);const asr=s.recognizers[0];
  asr.finishInput=()=>{asr.onError('synthetic finish write failure');return Promise.reject(Error('synthetic finish write failure'));};
  const first=s.c.stop(),second=s.c.stop();assert.equal(first,second);await first;
  assert.equal(s.sent.filter(row=>row.type===2&&row.j.rc===2).length,1);assert.equal(s.sent.filter(row=>row.type===7).length,1);assert.equal(s.c.state.savedDraftValid,false);assert.equal(s.c.active,false);
});

test('disk failure before recorder intent prevents start; malformed journal is kept and blocks capture',async t=>{
  const s=setup(t);s.failPromotion(true);await s.c.start('request-disk-failure');assert.equal(s.sent.length,0);
  fs.writeFileSync(s.root+'/agent-reply-capture.json','{broken');const next=new s.mod.AgentReplyCapture(async()=>assert.fail('blocked must not send'),()=> 'synthetic-peer',()=>true);next.initialize({filesDir:s.root});assert.equal(next.state.phase,'blocked');await assert.rejects(next.start('next-request'));assert.equal(fs.readFileSync(s.root+'/agent-reply-capture.json','utf8'),'{broken');
});

test('exit is still attempted when recorder-stop transport fails; real exit event is separate from transport completion',async t=>{
 const s=setup(t);await s.c.start('request-stop-failure');s.receive(3);
 s.handler((type,j)=>{if(type===2&&j.rc===2)throw Error('synthetic stop write failure');if(type===7)s.receive(8);});
 await s.c.stop();assert.equal(s.c.state.recorderStop,'failed');assert.equal(s.c.state.exitWrite,'submitted');assert.equal(s.c.state.stopSubmitted,false);
 assert.equal(s.c.state.exitObserved,true);assert.equal(s.c.state.exitEvidence,'device_event');assert.equal(s.c.active,false);assert.equal(s.journal().exit_evidence,'device_event');
});

test('successful stop writes and quiet seal do not prove exit; explicit human confirmation preserves only an already complete transcript',async t=>{
 const s=setup(t);await s.c.start('request-human-exit');s.receive(3);s.recognizers[0].onText('未发送的条件',true,1);
 await s.stopWithoutExit();assert.equal(s.c.state.stopSubmitted,true);assert.equal(s.c.state.exitObserved,false);
 await assert.rejects(s.c.confirmExitByUser('stale-binding'));assert(s.journal().cleanup_peer);
 await s.c.confirmExitByUser('request-human-exit');assert.equal(s.c.active,false);assert.equal(s.c.state.exitObserved,false);assert.equal(s.c.state.exitEvidence,'user_confirmation');
 assert.equal(s.journal().exit_evidence,'user_confirmation');assert.equal(s.journal().draft_valid,true);assert.equal(s.journal().transcript_status,'complete');assert.equal(s.c.state.text,'未发送的条件');
 const next=new s.mod.AgentReplyCapture(async()=>assert.fail('no restart'),()=>'',()=>true);next.initialize({filesDir:s.root});assert.equal(next.state.exitEvidence,'user_confirmation');assert.equal(next.state.transcriptStatus,'complete');assert.equal(next.state.phase,'draft');
});

test('audio after the bounded input seal is counted, not decoded; it prevents premature human-confirmed release',async t=>{
 const s=setup(t);await s.c.start('request-late-audio');s.receive(3);await s.stopWithoutExit();
 const appended=s.buffers.length;s.receive(3);assert.equal(s.c.state.lateAudioPackets,1);assert.equal(s.buffers.length,appended);
 await assert.rejects(s.c.confirmExitByUser('request-late-audio'));s.advance(2001);await s.c.confirmExitByUser('request-late-audio');assert.equal(s.c.active,false);
});

test('cold pending v1 can consume a validated exit from the original glasses without sending or reopening audio',async t=>{
 const s=setup(t);fs.writeFileSync(s.root+'/agent-reply-capture.json',JSON.stringify({schema:1,cleanup_peer:'synthetic-peer',binding:'request-restored',text:'保留的旧条件',draft_valid:false}));
 const next=new s.mod.AgentReplyCapture(async()=>assert.fail('exit event recovery must not send'),()=> 'synthetic-peer',()=>true);next.initialize({filesDir:s.root});
 const exit=businessEnvelope(8,new TextEncoder().encode('{"rc":6}'));
 assert.equal(next.receive('other-peer',13,exit),false);assert.equal(next.receive('synthetic-peer',13,exit),true);await flush();
 assert.equal(next.active,false);assert.equal(next.state.exitEvidence,'device_event');assert.equal(next.state.savedDraftValid,false);
 const saved=s.journal();assert.equal(saved.schema,3);assert.equal(saved.transcript_status,'legacy');assert.equal(saved.cleanup_peer,'');assert.equal(saved.binding,'request-restored');assert.equal(saved.text,'保留的旧条件');
});

test('malformed or unknown exit reason never becomes device confirmation',async t=>{
 for(const json of ['{}','{"rc":0}','{"rc":999}','{"rc":"6"}']){
  const s=setup(t);await s.c.start('request-invalid-exit');await s.stopWithoutExit();
  s.c.receive('synthetic-peer',13,businessEnvelope(8,new TextEncoder().encode(json)));await flush();
  assert.equal(s.c.state.exitObserved,false);assert(s.journal().cleanup_peer);assert.notEqual(s.c.state.exitEvidence,'device_event');s.c.disconnected();
 }
});

test('device exit during model preparation cancels the late opening of the microphone',async t=>{
 const s=setup(t);let release;s.holdPrepare(new Promise(r=>release=r));const starting=s.c.start('request-preparation-exit');await flush();s.receive(8);await flush();release();await starting;await flush();assert.equal(s.sent.length,0);assert.equal(s.c.active,false);
});

test('human confirmation cannot release after a stop-write failure or failed confirmation persistence',async t=>{
 const s=setup(t);await s.c.start('request-manual-persist');await s.stopWithoutExit();s.failPromotion(true);
 await assert.rejects(s.c.confirmExitByUser('request-manual-persist'),/保存失败/);assert(s.c.active);assert(s.journal().cleanup_peer);assert.equal(s.journal().exit_evidence,'none');
 const other=setup(t);await other.c.start('request-write-failed');other.handler(()=>{throw Error('write failed');});await other.stopWithoutExit();
 await assert.rejects(other.c.confirmExitByUser('request-write-failed'));assert(other.c.active);other.c.disconnected();
});

test('forged v2 user-confirmed valid draft is blocked rather than auto-submitted',t=>{
 const s=setup(t);fs.writeFileSync(s.root+'/agent-reply-capture.json',JSON.stringify({schema:2,cleanup_peer:'',binding:'request-forged',text:'伪造答案',draft_valid:true,exit_evidence:'user_confirmation'}));
 const next=new s.mod.AgentReplyCapture(async()=>assert.fail('blocked'),()=> 'synthetic-peer',()=>true);next.initialize({filesDir:s.root});assert.equal(next.state.phase,'blocked');
});

test('same-process reconnect accepts original glasses exit only after old Worker and wire have drained',async t=>{
 const s=setup(t);await s.c.start('request-reconnect');s.receive(3);let release;s.holdExit(new Promise(r=>release=r));s.offline();s.c.disconnected();
 assert.equal(s.receive(8,'synthetic-peer'),false);s.online();assert.equal(s.receive(8),true);assert(s.c.active);release();await flush();assert.equal(s.c.active,false);assert.equal(s.journal().exit_evidence,'device_event');
 assert.equal(s.sent.filter(row=>row.type===2&&row.j.rc===1).length,1);
});

test('old failed finalization after reconnect cannot close or cancel a newly started recognizer',async t=>{
 const s=setup(t);s.autoExit();await s.c.start('request-old');const asr=s.recognizers[0];let rejectOld;asr.finishInput=()=>new Promise((_r,reject)=>rejectOld=reject);
 const oldStop=s.c.stop();await flush();s.c.disconnected();await flush();s.receive(8);await flush();assert.equal(s.c.active,false);
 asr.finishInput=async()=>{};await s.c.start('request-new');let closes=0;const originalClose=asr.close;asr.close=()=>{closes++;originalClose.call(asr);};
 rejectOld(Error('late old failure'));await oldStop;assert.equal(closes,0);assert.equal(s.c.state.phase,'listening');
 s.receive(3);asr.onText('新任务的完整条件',true,1);s.autoExit();await s.c.stop();assert.equal(s.c.state.savedDraftValid,true);assert.equal(s.c.state.binding,'request-new');
});

test('device interruption during capture preserves partial words without making a valid final answer',async t=>{
 const s=setup(t);await s.c.start('request-interrupted');s.receive(3);s.recognizers[0].onText('还未说完的条件',false,1);s.receive(8);await flush();
 assert.equal(s.c.state.text,'还未说完的条件');assert.equal(s.c.state.savedDraftValid,false);assert.equal(s.c.state.phase,'failed');
});
test('cancelling an already draining close retains words but cannot publish a valid draft',async t=>{
 const s=setup(t);s.autoExit();await s.c.start('request-cancel-during-drain');s.receive(3);const asr=s.recognizers[0];let finish;
 asr.onText('尚未确认的条件',false,1);asr.finishInput=()=>new Promise(resolve=>finish=resolve);
 const stopping=s.c.stop(false);await flush();assert.equal(typeof finish,'function');const cancelled=s.c.stop(true);
 finish();await Promise.all([stopping,cancelled]);assert.equal(s.c.state.text,'尚未确认的条件');assert.equal(s.c.state.savedDraftValid,false);assert.equal(s.journal().draft_valid,false);
});
test('a failed clear preserves the complete capture in memory and on disk for a safe retry',async t=>{
 const s=setup(t);s.autoExit();await s.c.start('request-clear-retry');s.receive(3);s.recognizers[0].onText('保留完整条件',true,1);await s.c.stop();
 assert.equal(s.c.state.phase,'draft','stop has finished: '+JSON.stringify({state:s.c.state.phase,note:s.c.state.note,promotionFailures:s.promotionFailures}));assert.equal(s.journal().draft_valid,true);
 const prior=fs.readFileSync(s.root+'/agent-reply-capture.json');s.failPromotion(true);assert.throws(()=>s.c.clearDraft());
 assert.equal(s.c.state.text,'保留完整条件');assert.equal(s.c.state.phase,'draft');assert.equal(s.c.state.savedDraftValid,true);
 assert.deepEqual(fs.readFileSync(s.root+'/agent-reply-capture.json'),prior);await assert.rejects(s.c.start('another-request'));
 s.failPromotion(false);s.c.clearDraft();assert.equal(s.c.state.text,'');assert.equal(s.journal().text,'');
});

test('a close-promotion failure resolves only as cleanup pending and cannot be mistaken for a finished clearable draft',async t=>{
 const s=setup(t);s.autoExit();await s.c.start('request-stop-persist-failure');s.receive(3);s.recognizers[0].onText('保留尚未落盘的完整尾句',true,1);
 s.failPromotion(true);await s.c.stop();assert.equal(s.c.state.phase,'cleanup_pending');assert.equal(s.c.state.text,'保留尚未落盘的完整尾句');
 assert.equal(s.c.state.savedDraftValid,false);assert.equal(s.journal().draft_valid,false);assert.equal(s.journal().cleanup_peer,'synthetic-peer');
 assert(s.promotionFailures.some(row=>row.phase==='stopping'));assert.throws(()=>s.c.clearDraft(),/停止未确认/);
 s.failPromotion(false);await s.c.cleanup();assert.equal(s.c.active,false);assert.equal(s.journal().text,'保留尚未落盘的完整尾句');assert.equal(s.journal().transcript_status,'complete');assert.equal(s.journal().draft_valid,true);assert.equal(s.journal().exit_evidence,'device_event');
});
test('a malformed or over-limit final ASR tail cannot turn an earlier partial into a complete answer',async t=>{
 for(const [text,id] of [['完整条件'.repeat(1001),1],['尾部条件',65],['尾部条件',0],[{},1]]){
  const s=setup(t);s.autoExit();await s.c.start('request-overflow');s.receive(3);const asr=s.recognizers[0];asr.onText('先前片段',false,1);
  asr.finishInput=async()=>asr.onText(text,true,id);await s.c.stop();assert.equal(s.c.state.text,'先前片段');assert.equal(s.c.state.savedDraftValid,false);assert.equal(s.journal().draft_valid,false);
 }
});
test('the request guard is checked again at the serialized microphone write',async t=>{
 const s=setup(t);s.autoExit();let calls=0;await s.c.start('request-last-moment-revoked',15,async()=>{if(++calls===2)throw Error('request changed');});
 assert.equal(calls,2);assert.equal(s.sent.filter(x=>x.type===2&&x.j.rc===1).length,0);
 assert.equal(s.c.state.savedDraftValid,false);assert.equal(s.journal().draft_valid,false);assert.equal(s.c.active,false);
});

test('normal stop consumes the final condition before sealing, including a synchronous exit inside an unresolved write',async t=>{
 const s=setup(t);await s.c.start('request-stop-tail');s.receive(3);const asr=s.recognizers[0];asr.onText('用新价格',true,1);
 let releaseRecorder,releaseExit,finished=false;
 asr.finishInput=async()=>{finished=true;assert.equal(s.buffers.length,3);assert.equal(s.c.state.stopSubmitted,true);assert.equal(s.c.state.exitObserved,true);asr.onText('但不要发送',true,2);};
 s.handler(async(type,j)=>{
  if(type===2&&j.rc===2){s.receive(3);asr.onText('但不要',false,2);await new Promise(resolve=>releaseRecorder=resolve);}
  if(type===7){s.receive(3);asr.onText('但不要发送',false,2);s.receive(8);await new Promise(resolve=>releaseExit=resolve);}
 });
 const stopping=s.c.stop();await flush();assert.equal(typeof releaseRecorder,'function');assert.equal(finished,false);assert.equal(s.c.state.tailPackets,1);
 releaseRecorder();await flush();assert.equal(typeof releaseExit,'function');assert.equal(s.c.state.exitObserved,true);assert.equal(s.c.state.exitWrite,'pending');
 assert.equal(finished,false,'a synchronous type8 alone cannot overtake its unresolved exit write');
 releaseExit();await stopping;assert.equal(finished,true);assert.equal(s.c.state.text,'用新价格，但不要发送');assert.equal(s.c.state.tailPackets,2);
  assert.equal(s.c.state.savedDraftValid,true,JSON.stringify({phase:s.c.state.phase,note:s.c.state.note,recorder:s.c.state.recorderStop,exit:s.c.state.exitWrite,exitObserved:s.c.state.exitObserved,worker:s.c.state.workerExited,nonzero:s.c.state.nonzeroPackets,tail:s.c.state.tailPackets,tailTimedOut:s.c.state.tailTimedOut,promotionFailures:s.promotionFailures}));assert.equal(s.c.state.phase,'draft');assert.equal(s.journal().text,s.c.state.text);
 assert.equal(s.journal().draft_valid,true);assert.equal(s.journal().cleanup_peer,'');
 assert.equal(s.sent.filter(x=>x.type===2&&x.j.rc===2).length,1);assert.equal(s.sent.filter(x=>x.type===7).length,1);
});

test('missing exit with a quiet bounded tail preserves complete text but still requires separate exit evidence',async t=>{
 const s=setup(t);await s.c.start('request-tail-no-exit');s.receive(3);const asr=s.recognizers[0];asr.onText('先只生成预览',false,1);
 const stopping=s.c.stop();await flush();assert.equal(s.c.state.inputSealed,false);s.receive(3);asr.onText('先只生成预览，不要发送',true,1);
 assert.equal(s.buffers.length,2);assert.equal(s.events.includes('finish'),false);
 await s.tick(300);await stopping;assert.equal(s.c.state.inputSealed,true);assert.equal(s.c.state.tailTimedOut,false);assert.equal(s.c.state.phase,'cleanup_pending');assert.equal(s.c.state.transcriptStatus,'complete');
 assert.equal(s.c.state.text,'先只生成预览，不要发送');assert.equal(s.journal().draft_valid,false);assert.equal(s.journal().transcript_status,'complete');assert.equal(s.journal().cleanup_peer,'synthetic-peer');
 s.receive(8);await flush();assert.equal(s.c.active,false);assert.equal(s.c.state.phase,'draft');assert.equal(s.journal().draft_valid,true);assert.equal(s.journal().transcript_status,'complete');
 assert.equal(s.journal().text,'先只生成预览，不要发送');assert.equal(s.journal().exit_evidence,'device_event');
});

test('audio after ASR sealing invalidates the earlier text while the Worker is still draining',async t=>{
 const s=setup(t);s.autoExit();await s.c.start('request-post-seal');s.receive(3);const asr=s.recognizers[0];asr.onText('仅生成预览',false,1);
 let releaseFinish;asr.finishInput=()=>new Promise(resolve=>releaseFinish=resolve);const stopping=s.c.stop();await flush();
 assert.equal(typeof releaseFinish,'function');assert.equal(s.c.state.inputSealed,true);const appended=s.buffers.length;s.receive(3);
 assert.equal(s.buffers.length,appended);assert.equal(s.c.state.lateAudioPackets,1);asr.onText('仅生成预览',true,1);releaseFinish();await stopping;
 assert.equal(s.c.state.text,'仅生成预览');assert.equal(s.c.state.phase,'failed');assert.equal(s.c.state.savedDraftValid,false);assert.equal(s.journal().draft_valid,false);
});

test('cancelling during the tail window stops accepting audio and retains only an invalid draft',async t=>{
 const s=setup(t);await s.c.start('request-tail-cancel');s.receive(3);const asr=s.recognizers[0],oldText=asr.onText;asr.onText('取消前片段',false,1);
 let release;s.handler(async(type,j)=>{if(type===2&&j.rc===2)await new Promise(resolve=>release=resolve);if(type===7)s.receive(8);});
 const stopping=s.c.stop();await flush();const appended=s.buffers.length;assert.equal(s.c.stop(true),stopping);s.receive(3);
 assert.equal(s.buffers.length,appended);assert.equal(s.c.state.lateAudioPackets,1);release();await stopping;assert.equal(s.c.state.text,'取消前片段');assert.equal(s.journal().draft_valid,false);
 s.c.clearDraft();s.autoExit();await s.c.start('request-after-tail-cancel');oldText('取消轮次的迟到回调',true,1);assert.equal(s.c.state.text,'');
 s.receive(3);asr.onText('新轮次完整条件',true,1);await s.c.stop();assert.equal(s.journal().binding,'request-after-tail-cancel');assert.equal(s.journal().text,'新轮次完整条件');assert.equal(s.journal().draft_valid,true);
});

test('the four-second tail PCM budget is enforced even when packets arrive faster than the clock',async t=>{
 const s=setup(t);s.decodeBytes(4096);await s.c.start('request-tail-byte-bound');s.receive(3);s.recognizers[0].onText('已有片段',false,1);
 const stopping=s.c.stop();await flush();for(let n=0;n<32;n++)s.receive(3);await stopping;
 assert(s.c.state.tailPcmBytes<=128000);assert.equal(s.c.state.tailPackets,31);assert.equal(s.buffers.length,32);
 assert.equal(s.c.state.phase,'cleanup_pending');assert.equal(s.c.state.inputSealed,true);assert.equal(s.c.state.text,'已有片段');assert.equal(s.journal().draft_valid,false);
 s.receive(8);await flush();assert.equal(s.c.active,false);assert.equal(s.journal().draft_valid,false);
});

test('a tail timeout seals text while an outstanding stop write still keeps the cleanup obligation',async t=>{
 const s=setup(t);await s.c.start('request-stop-write-pending');s.receive(3);s.recognizers[0].onText('先保存片段',false,1);
 let release;s.handler(async(type,j)=>{if(type===2&&j.rc===2)await new Promise(resolve=>release=resolve);if(type===7)s.receive(8);});
 const stopping=s.c.stop();await flush();await s.tick(4000);await stopping;
 assert.equal(s.c.state.phase,'cleanup_pending');assert.equal(s.c.state.recorderStop,'pending');assert.equal(s.c.state.workerExited,true);
 assert.equal(s.journal().draft_valid,false);assert.equal(s.journal().cleanup_peer,'synthetic-peer');await assert.rejects(s.c.cleanup());
 release();await flush();assert.equal(s.sent.filter(x=>x.type===7).length,1);assert.equal(s.c.active,false);assert.equal(s.c.state.phase,'failed');assert.equal(s.journal().draft_valid,false);
});

test('disconnecting during the tail wait releases old work without letting old timers or callbacks affect a new capture',async t=>{
 const s=setup(t);await s.c.start('request-old-tail');s.receive(3);const asr=s.recognizers[0],oldText=asr.onText;
 const stopping=s.c.stop();await flush();const oldDeadline=[...s.timers.values()].find(v=>v.ms===4000).f;assert.equal(s.events.includes('finish'),false);
 s.c.disconnected();await stopping;await flush();s.receive(8);await flush();assert.equal(s.c.active,false);s.c.clearDraft();
 s.autoExit();await s.c.start('request-new-tail');oldDeadline();oldText('旧尾窗回调',true,1);assert.equal(s.c.state.phase,'listening');assert.equal(s.c.state.text,'');
 s.receive(3);asr.onText('新尾窗条件',true,1);await s.c.stop();assert.equal(s.journal().binding,'request-new-tail');assert.equal(s.journal().text,'新尾窗条件');assert.equal(s.journal().draft_valid,true);
});

test('a stop observer reentering cancellation shares the same close and cannot submit duplicate commands',async t=>{
 const s=setup(t);s.autoExit();await s.c.start('request-stop-observer');s.receive(3);s.recognizers[0].onText('观察回调取消前片段',false,1);
 let reentrant,observed=false;s.c.changed=()=>{if(s.c.state.phase==='stopping'&&!observed){observed=true;reentrant=s.c.stop(true);}};
 const stopping=s.c.stop();assert.equal(reentrant,stopping);await stopping;assert.equal(s.c.active,false);assert.equal(s.journal().draft_valid,false);
 assert.equal(s.sent.filter(x=>x.type===2&&x.j.rc===2).length,1);assert.equal(s.sent.filter(x=>x.type===7).length,1);
});

test('a cold cleanup exit observed synchronously within a held stop write cannot release before both new stop writes settle',async t=>{
 const s=setup(t);fs.writeFileSync(s.root+'/agent-reply-capture.json',JSON.stringify({schema:2,cleanup_peer:'synthetic-peer',binding:'request-cold-stop',text:'保留的旧片段',draft_valid:false,exit_evidence:'none'}));
 let release,observed=false;const sent=[];const next=new s.mod.AgentReplyCapture(async(_b,bytes)=>{
  const p=readLauncherEnvelope(bytes),j=JSON.parse(new TextDecoder().decode(p.json));sent.push({type:p.type,j});if(p.type===2&&j.rc===2){observed=true;next.receive('synthetic-peer',13,businessEnvelope(8,new TextEncoder().encode('{"rc":6}')));await new Promise(resolve=>release=resolve);}
 },()=> 'synthetic-peer',()=>true);next.initialize({filesDir:s.root});
 const stopping=next.cleanup();assert.equal(next.active,true);await flush();assert.equal(typeof release,'function');assert.equal(observed,true);assert.equal(next.state.exitObserved,true);assert.equal(next.active,true);assert.equal(next.state.workerExited,true);assert.equal(s.events.includes('finish'),false);
 assert.equal(s.journal().cleanup_peer,'synthetic-peer');release();await stopping;assert.equal(next.active,false);assert.equal(s.journal().draft_valid,false);assert.equal(s.journal().text,'保留的旧片段');
 assert.deepEqual(sent.map(row=>row.type),[2,7]);
});

test('disconnecting synchronously from the stop observer cannot install a stale boundary or leave a closing promise behind',async t=>{
 const s=setup(t);await s.c.start('request-disconnect-stop-observer');s.receive(3);let observed=false;
 s.c.changed=()=>{if(s.c.state.phase==='stopping'&&!observed){observed=true;s.c.disconnected();}};
 await s.c.stop();await flush();assert.equal(s.events.includes('finish'),false);assert.equal(s.c.state.phase,'cleanup_pending');
 assert.equal([...s.timers.values()].some(v=>v.ms===4000),false);s.receive(8);await flush();assert.equal(s.c.active,false);s.c.clearDraft();
 s.c.changed=()=>{};s.autoExit();await s.c.start('request-after-stop-observer-disconnect');s.receive(3);await s.c.stop();assert.equal(s.c.active,false);
});

test('schema3 separates local transcript completeness from exit evidence and persists exactly seven fields',async t=>{
 const s=setup(t);await s.c.start('request-schema3');assert.equal(s.journal().schema,3);assert.equal(s.journal().transcript_status,'pending');
 s.receive(3);const asr=s.recognizers[0];asr.onText('用新价格',true,1);asr.finishInput=async()=>asr.onText('运费沿用上次',true,2);
 const stopping=s.c.stop();await flush();await s.elapse(300);await stopping;const saved=s.journal();
 assert.deepEqual(Object.keys(saved).sort(),['schema','cleanup_peer','binding','text','draft_valid','exit_evidence','transcript_status'].sort());
 assert.equal(saved.transcript_status,'complete');assert.equal(saved.draft_valid,false);assert.equal(saved.exit_evidence,'none');assert.equal(saved.cleanup_peer,'synthetic-peer');assert.equal(saved.text,'用新价格，运费沿用上次');
 assert.equal(s.c.state.boundaryEvidence,'quiet_after_stop');assert.equal(s.c.state.exitObserved,false);assert.equal(s.c.state.phase,'cleanup_pending');assert.equal(s.c.state.workerExited,true);assert.equal(s.c.state.inputSealed,true);
 await s.c.confirmExitByUser('request-schema3');assert.equal(s.journal().transcript_status,'complete');assert.equal(s.journal().draft_valid,true);assert.equal(s.journal().exit_evidence,'user_confirmation');assert.equal(s.c.state.exitObserved,false);
});

test('quiet boundary resets on every valid tail packet including zero PCM and never extends the four-second hard deadline',async t=>{
 const s=setup(t);await s.c.start('request-zero-tail');s.receive(3);s.recognizers[0].onText('完整条件',true,1);const started=s.now,stopping=s.c.stop();await flush();
 await s.elapse(299);assert.equal(s.c.state.inputSealed,false);s.silent(true);s.receive(3);assert.equal(s.c.state.nonzeroPackets,1);assert.equal(s.c.state.tailPackets,1);
 await s.elapse(299);assert.equal(s.c.state.inputSealed,false);s.receive(3);await s.elapse(299);assert.equal(s.c.state.inputSealed,false);
 await s.elapse(1);await stopping;assert.equal(s.c.state.inputSealedAt,started+898);assert.equal(s.c.state.transcriptStatus,'complete');assert.equal(s.c.state.boundaryEvidence,'quiet_after_stop');assert.equal(s.journal().draft_valid,false);
 const hard=setup(t);await hard.c.start('request-no-quiet');hard.receive(3);hard.recognizers[0].onText('持续尾音只保留片段',false,1);const deadline=hard.now+4000,work=hard.c.stop();await flush();
 for(let n=0;n<13;n++){await hard.elapse(299);hard.receive(3);}await hard.elapse(112);hard.receive(3);await hard.elapse(1);await work;
 assert.equal(hard.c.state.inputSealedAt,deadline);assert.equal(hard.c.state.tailTimedOut,true);assert.equal(hard.c.state.boundaryEvidence,'limit');assert.equal(hard.c.state.transcriptStatus,'partial');assert.equal(hard.journal().draft_valid,false);
 hard.receive(8);await flush();assert.equal(hard.c.state.transcriptStatus,'partial');assert.equal(hard.c.state.savedDraftValid,false);
});

test('quiet cannot seal while either stop write is unresolved and only starts after the final write settles',async t=>{
 for(const holdType of [2,7]){
  const s=setup(t);await s.c.start('request-pending-'+holdType);s.receive(3);s.recognizers[0].onText('完整条件',true,1);let release;
  s.handler(async(type,j)=>{if(type===holdType&&(type!==2||j.rc===2))await new Promise(resolve=>release=resolve);});const stopping=s.c.stop();await flush();assert.equal(typeof release,'function');
  await s.elapse(300);assert.equal(s.c.state.inputSealed,false);assert.equal(s.events.includes('finish'),false);release();await flush();
  await s.elapse(299);assert.equal(s.c.state.inputSealed,false);await s.elapse(1);await stopping;assert.equal(s.c.state.transcriptStatus,'complete');assert.equal(s.c.state.boundaryEvidence,'quiet_after_stop');assert.equal(s.journal().draft_valid,false);
 }
});

test('partial and cancelled text never become complete through later human exit confirmation or cleanup-only retries',async t=>{
 for(const cancelled of [false,true]){
  const s=setup(t);await s.c.start('request-sticky-'+cancelled);s.receive(3);s.recognizers[0].onText('须保留但不能冒充完整的条件',true,1);
  const work=s.c.stop(cancelled);await flush();if(!cancelled){for(let n=0;n<13;n++){await s.elapse(299);s.receive(3);}await s.elapse(113);}await work;
  const expected=cancelled?'cancelled':'partial';assert.equal(s.c.state.transcriptStatus,expected);assert.equal(s.c.state.phase,'cleanup_pending');
  await s.c.cleanup();assert.equal(s.c.state.transcriptStatus,expected);assert.equal(s.journal().transcript_status,expected);await s.c.confirmExitByUser('request-sticky-'+cancelled);
  assert.equal(s.c.state.transcriptStatus,expected);assert.equal(s.journal().draft_valid,false);assert.equal(s.c.state.phase,'failed');assert.equal(s.journal().exit_evidence,'user_confirmation');
 }
});

test('cleanup-only retry preserves a complete retained result without reopening or finishing its recognizer again',async t=>{
 const s=setup(t);await s.c.start('request-cleanup-only');s.receive(3);s.recognizers[0].onText('完整尾句已经排空',true,1);const work=s.c.stop();await flush();await s.elapse(300);await work;
 const finishCount=s.events.filter(event=>event==='finish').length,models=s.models.length,opens=s.sent.filter(row=>row.type===2&&row.j.rc===1).length;
 await s.c.cleanup();assert.equal(s.c.state.phase,'cleanup_pending');assert.equal(s.c.state.transcriptStatus,'complete');assert.equal(s.events.filter(event=>event==='finish').length,finishCount);assert.equal(s.models.length,models);assert.equal(s.sent.filter(row=>row.type===2&&row.j.rc===1).length,opens);
 assert.equal(s.journal().text,'完整尾句已经排空');s.autoExit();await s.c.cleanup();assert.equal(s.c.state.phase,'draft');assert.equal(s.journal().draft_valid,true);assert.equal(s.journal().transcript_status,'complete');assert.equal(s.events.filter(event=>event==='finish').length,finishCount);
});

test('late audio after a quiet seal downgrades complete text durably and a subsequent exit confirmation cannot restore it',async t=>{
 const s=setup(t);await s.c.start('request-late-after-quiet');s.receive(3);s.recognizers[0].onText('先前完整条件',true,1);const work=s.c.stop();await flush();await s.elapse(300);await work;
 assert.equal(s.journal().transcript_status,'complete');const decoded=s.buffers.length;s.receive(3);assert.equal(s.buffers.length,decoded);assert.equal(s.c.state.lateAudioPackets,1);assert.equal(s.journal().transcript_status,'partial');assert.equal(s.journal().draft_valid,false);
 await assert.rejects(s.c.confirmExitByUser('request-late-after-quiet'));await s.elapse(2000);await s.c.confirmExitByUser('request-late-after-quiet');assert.equal(s.journal().transcript_status,'partial');assert.equal(s.journal().draft_valid,false);assert.equal(s.journal().text,'先前完整条件');
});

test('legacy journals preserve original bytes at initialization and never invent current-process compressed or PCM observations',t=>{
 for(const record of [
  {schema:1,cleanup_peer:'',binding:'legacy-one',text:'旧完整文字',draft_valid:true},
  {schema:2,cleanup_peer:'',binding:'legacy-two',text:'旧完整文字',draft_valid:true,exit_evidence:'device_event'},
  {schema:2,cleanup_peer:'synthetic-peer',binding:'legacy-pending',text:'旧片段',draft_valid:false,exit_evidence:'none'}
 ]){
  const s=setup(t),file=s.root+'/agent-reply-capture.json',bytes=JSON.stringify(record);fs.writeFileSync(file,bytes);const next=new s.mod.AgentReplyCapture(async()=>assert.fail('initialization cannot send'),()=> 'synthetic-peer',()=>true);next.initialize({filesDir:s.root});
  assert.equal(fs.readFileSync(file,'utf8'),bytes);assert.equal(next.state.transcriptStatus,'legacy');assert.equal(next.state.observationRestored,true);assert.equal(next.state.compressedPackets,0);assert.equal(next.state.compressedBytes,0);assert.equal(next.state.repeatedCompressedPackets,0);assert.equal(next.state.lastCompressedSha256,'');assert.equal(next.state.firstAudioAt,0);assert.equal(next.state.lastAudioAt,0);assert.equal(next.state.pcmRms,0);assert.equal(next.state.pcmPeak,0);assert.equal(next.state.boundaryEvidence,'none');
 }
});

test('schema3 rejects inconsistent completeness, validity, exit evidence and unknown fields without replacing original bytes',t=>{
 const base={schema:3,cleanup_peer:'',binding:'request-corrupt',text:'保留原件',draft_valid:true,exit_evidence:'device_event',transcript_status:'complete'};
 for(const patch of [{transcript_status:'partial'},{transcript_status:'cancelled'},{transcript_status:'pending'},{transcript_status:'unknown'},{exit_evidence:'none'},{cleanup_peer:'synthetic-peer',exit_evidence:'none'},{text:''},{extra_metric:1}]){
  const s=setup(t),file=s.root+'/agent-reply-capture.json',bytes=JSON.stringify({...base,...patch});fs.writeFileSync(file,bytes);const next=new s.mod.AgentReplyCapture(async()=>assert.fail('corrupt journal cannot send'),()=> 'synthetic-peer',()=>true);next.initialize({filesDir:s.root});
  assert.equal(next.state.phase,'blocked');assert.equal(fs.readFileSync(file,'utf8'),bytes);
 }
});

test('current-process compressed hashes and PCM energy are bounded metadata rather than retained audio or historical observations',async t=>{
 const s=setup(t);await s.c.start('request-observation');const first=s.now;assert.equal(s.c.state.observationRestored,false);s.receive(3,'other-peer');assert.equal(s.c.state.compressedPackets,0);
 s.receive(3);s.advance(10);s.receive(3);s.advance(10);s.receive(3);const last=s.now,hash=createHash('sha256').update(Uint8Array.of(1,2,3)).digest('hex');
 assert.equal(s.c.state.compressedPackets,3);assert.equal(s.c.state.compressedBytes,9);assert.equal(s.c.state.repeatedCompressedPackets,2);assert.equal(s.c.state.lastCompressedSha256,hash);assert.equal(s.c.state.firstAudioAt,first);assert.equal(s.c.state.lastAudioAt,last);assert.equal(s.c.state.pcmPeak,268);assert(Math.abs(s.c.state.pcmRms-268/Math.sqrt(2))<1e-9);
 s.receive(3,'synthetic-peer',Uint8Array.of(3,2,1));assert.equal(s.c.state.repeatedCompressedPackets,2);s.receive(3);assert.equal(s.c.state.repeatedCompressedPackets,2,'a historical matching frame is not a consecutive repeat');
 s.recognizers[0].onText('观察指标不代表特定麦克风',true,1);const work=s.c.stop();await flush();assert.equal(s.c.state.stopRequestedAt,last);await s.elapse(300);await work;assert.equal(s.c.state.inputSealedAt,last+300);assert.equal(s.c.state.boundaryEvidence,'quiet_after_stop');
 const saved=s.journal();assert.equal(Object.keys(saved).length,7);assert.equal(Object.hasOwn(saved,'compressedPackets'),false);const next=new s.mod.AgentReplyCapture(async()=>assert.fail('restoring metrics cannot reopen mic'),()=> 'synthetic-peer',()=>true);next.initialize({filesDir:s.root});assert.equal(next.state.observationRestored,true);assert.equal(next.state.compressedPackets,0);assert.equal(next.state.pcmPeak,0);assert.equal(next.state.lastCompressedSha256,'');
 s.c.disconnected();
});

test('ASR finish failure or Worker exit failure cannot produce a complete transcript despite a quiet input boundary',async t=>{
 for(const failure of ['finish','worker']){
  const s=setup(t);await s.c.start('request-local-failure-'+failure);s.receive(3);s.recognizers[0].onText('必须保留的原文字',true,1);let rejectExit;
  if(failure==='finish')s.recognizers[0].finishInput=async()=>{throw Error('synthetic ASR finish failed');};
  else s.holdExit(new Promise((_resolve,reject)=>rejectExit=reject));
  const stopping=s.c.stop(),result=Promise.allSettled([stopping]);await flush();await s.elapse(300);if(rejectExit)rejectExit(Error('synthetic worker exit failed'));await result;await flush();
  assert.equal(s.c.state.transcriptStatus,'partial');assert.equal(s.c.state.savedDraftValid,false);assert.notEqual(s.c.state.phase,'draft');assert.equal(s.c.state.text,'必须保留的原文字');assert.equal(s.journal().draft_valid,false);
 }
});

test('an uncommitted partial journal blocks cold restore instead of reviving an older complete transcript',async t=>{
 const s=setup(t);await s.c.start('request-torn-partial');s.receive(3);s.recognizers[0].onText('既有完整条件不得在失败后被错用',true,1);const work=s.c.stop();await flush();await s.elapse(300);await work;
 const file=s.root+'/agent-reply-capture.json',before=fs.readFileSync(file);assert.equal(s.journal().transcript_status,'complete');s.failPromotion(true);s.receive(3);
 assert.equal(s.c.state.transcriptStatus,'partial');assert.deepEqual(fs.readFileSync(file),before);assert(fs.existsSync(file+'.partial'));const partial=fs.readFileSync(file+'.partial');
 const next=new s.mod.AgentReplyCapture(async()=>assert.fail('uncertain commit cannot send'),()=> 'synthetic-peer',()=>true);next.initialize({filesDir:s.root});assert.equal(next.state.phase,'blocked');assert.deepEqual(fs.readFileSync(file),before);assert.deepEqual(fs.readFileSync(file+'.partial'),partial);
 const lone=setup(t),lonePath=lone.root+'/agent-reply-capture.json';fs.writeFileSync(lonePath+'.partial',partial);const orphan=new lone.mod.AgentReplyCapture(async()=>assert.fail('orphan partial cannot send'),()=> 'synthetic-peer',()=>true);orphan.initialize({filesDir:lone.root});assert.equal(orphan.state.phase,'blocked');assert.equal(fs.existsSync(lonePath),false);assert.deepEqual(fs.readFileSync(lonePath+'.partial'),partial);
});

test('cancelling cleanup while its stop write is held persists cancelled immediately before a cold reader can revive complete',async t=>{
 const s=setup(t);await s.c.start('request-cancel-cleanup');s.receive(3);s.recognizers[0].onText('完整排空后仍允许撤回本轮',true,1);const work=s.c.stop();await flush();await s.elapse(300);await work;
 assert.equal(s.journal().transcript_status,'complete');let release;s.handler(async(type,j)=>{if(type===2&&j.rc===2)await new Promise(resolve=>release=resolve);});
 const cleaning=s.c.cleanup();await flush();assert.equal(typeof release,'function');const cancelling=s.c.stop(true);
 assert.equal(s.c.state.transcriptStatus,'cancelled');assert.equal(s.journal().transcript_status,'cancelled');assert.equal(s.journal().draft_valid,false);
 const next=new s.mod.AgentReplyCapture(async()=>assert.fail('cold cancelled state cannot start'),()=> 'synthetic-peer',()=>true);next.initialize({filesDir:s.root});assert.equal(next.state.transcriptStatus,'cancelled');assert.equal(next.state.savedDraftValid,false);
 release();await Promise.all([cleaning,cancelling]);await s.c.confirmExitByUser('request-cancel-cleanup');assert.equal(s.journal().transcript_status,'cancelled');assert.equal(s.journal().draft_valid,false);
});

test('a synchronous exit from the first sealed-worker notification cannot persist an unclassified or corrupt complete journal',async t=>{
 const s=setup(t);await s.c.start('request-exit-during-classification');s.receive(3);const asr=s.recognizers[0];asr.onText('首句',true,1);asr.finishInput=async()=>asr.onText('完整末句',true,2);let observed=false;
 s.c.changed=()=>{if(!observed&&s.c.state.workerExited&&s.c.state.inputSealed&&s.c.state.text&&!s.c.state.exitObserved){observed=true;s.receive(8);}};
 const stopping=s.c.stop();await flush();await s.elapse(300);await stopping;await flush();assert.equal(observed,true);assert.equal(s.c.state.transcriptStatus,'complete');assert.equal(s.journal().transcript_status,'complete');assert.equal(s.journal().text,'首句，完整末句');assert.equal(s.journal().draft_valid,true);assert.equal(s.journal().cleanup_peer,'');assert.equal(s.journal().exit_evidence,'device_event');
 const next=new s.mod.AgentReplyCapture(async()=>assert.fail('cold completed journal never sends'),()=> 'synthetic-peer',()=>true);next.initialize({filesDir:s.root});assert.equal(next.state.phase,'draft');assert.equal(next.state.transcriptStatus,'complete');assert.equal(next.state.savedDraftValid,true);
});

test('inactive stop during the final draft notification or afterward cannot cancel or rewrite a complete capture',async t=>{
 const s=setup(t);s.autoExit();await s.c.start('request-inactive-stop');s.receive(3);s.recognizers[0].onText('已经完整封口的末句',true,1);let reentrant,observed=false,bytes;
 s.c.changed=()=>{if(!observed&&s.c.state.phase==='draft'){observed=true;bytes=fs.readFileSync(s.root+'/agent-reply-capture.json');reentrant=s.c.stop(true);}};
 await s.c.stop();await reentrant;assert.equal(observed,true);assert.equal(s.c.state.transcriptStatus,'complete');assert.equal(s.c.state.savedDraftValid,true);assert.deepEqual(fs.readFileSync(s.root+'/agent-reply-capture.json'),bytes);
 const count=s.sent.length;await s.c.stop(true);assert.equal(s.c.state.transcriptStatus,'complete');assert.equal(s.c.state.phase,'draft');assert.equal(s.sent.length,count);assert.deepEqual(fs.readFileSync(s.root+'/agent-reply-capture.json'),bytes);
});

test('late same-peer audio invalidates an uncleared complete draft durably while returning false for normal voice routing',async t=>{
 const s=setup(t);s.autoExit();await s.c.start('request-late-complete');s.receive(3);s.recognizers[0].onText('尚未转交原问题的完整条件',true,1);await s.c.stop();assert.equal(s.c.state.phase,'draft');
 const decoded=s.buffers.length,compressed=s.c.state.compressedPackets;assert.equal(s.receive(3,'other-peer'),false);assert.equal(s.c.state.transcriptStatus,'complete');assert.equal(s.receive(3),false);
 assert.equal(s.buffers.length,decoded);assert.equal(s.c.state.compressedPackets,compressed);assert.equal(s.c.state.transcriptStatus,'partial');assert.equal(s.c.state.phase,'failed');assert.equal(s.c.state.savedDraftValid,false);assert.equal(s.journal().transcript_status,'partial');assert.equal(s.journal().draft_valid,false);assert.equal(s.journal().text,'尚未转交原问题的完整条件');
 const next=new s.mod.AgentReplyCapture(async()=>assert.fail('late audio cannot restart'),()=> 'synthetic-peer',()=>true);next.initialize({filesDir:s.root});assert.equal(next.state.phase,'failed');assert.equal(next.state.transcriptStatus,'partial');
});

test('real capture downgrade during coordinator request validation preserves source text and cannot publish a stale complete answer',async t=>{
 const s=setup(t),platform={'@kit.CoreFileKit':{fileIo:s.io}},model=loadApp('TaskReplyDraft',platform,s.globals),{TaskVoiceReplySession}=loadApp('TaskVoiceReplySession',platform,s.globals);
 const draft=new model.TaskDecisionDraft(),binding=new model.TaskReplyBinding(),plan=new model.TaskDecisionPlan();draft.initialize(s.root);
 Object.assign(binding,{context_key:'owner-phone-server-route',operation_id:'original-operation',request_id:'original-question',request_revision:3,task_id:'original-task',route:{computer_id:'pc',agent_id:'hermes',project_id:'project',session_id:'original-session'},expires_at:new Date(s.now+60000).toISOString(),question:'采用新价格吗？',mode:'free_text'});
 draft.begin(binding,plan,s.now);for(const [suffix,cmd] of [['proposal',2],['supplement',1]]){const uid=binding.operation_id+'-'+suffix;draft.armCard(binding.context_key,'synthetic-peer',uid,s.now);draft.suggestion(binding.context_key,'synthetic-peer',34,uid,cmd,s.now);draft.removalSubmitted('synthetic-peer',uid);}
 let release,waiting,clears=0,saved=0;const voice=new TaskVoiceReplySession(draft,{
  state:()=>({active:s.c.active,phase:s.c.state.phase,binding:s.c.state.binding,text:s.c.state.text,valid:s.c.state.savedDraftValid,exitEvidence:s.c.state.exitEvidence,transcriptStatus:s.c.state.transcriptStatus}),
  device:()=> 'synthetic-peer',context:()=>binding.context_key,foreground:()=>true,cardReleased:()=>true,validate(){},async revalidate(){if(waiting)await waiting;},nonce:()=> 'voice-'+'a'.repeat(32),
  start:(token,guard)=>s.c.start(token,15,guard),stop:cancelled=>s.c.stop(cancelled),clear(){clears++;s.c.clearDraft();},cleanup:()=>s.c.cleanup(),
  source(){assert.fail('a downgraded capture must never register a complete source');}
 });
 voice.onDraftSaved=()=>saved++;s.c.changed=()=>voice.observe();s.autoExit();await voice.begin(binding);s.receive(3);s.recognizers[0].onText('用新价格，但运费沿用上次',true,1);
 waiting=new Promise(resolve=>release=resolve);await s.c.stop();await flush();assert.equal(s.c.state.phase,'draft');assert.equal(s.c.state.transcriptStatus,'complete');assert.equal(draft.snapshot().stage,'voice_authorized');
 const bytes=fs.readFileSync(s.root+'/task-decision-draft.json');assert.equal(s.receive(3),false);assert.equal(s.c.state.transcriptStatus,'partial');release();await flush();
 assert.deepEqual(fs.readFileSync(s.root+'/task-decision-draft.json'),bytes);assert.equal(draft.snapshot().stage,'voice_authorized');assert.equal(draft.snapshot().text,'');assert.equal(s.c.state.text,'用新价格，但运费沿用上次');assert.equal(s.journal().transcript_status,'partial');assert.equal(clears,0);assert.equal(saved,0);assert(draft.paused);
});

test('copied then cleared real capture retains late-source evidence and cannot enqueue its older voice answer',async t=>{
 const s=setup(t,1),platform={'@kit.CoreFileKit':{fileIo:s.io}},model=loadApp('TaskReplyDraft',platform,s.globals),
  {TaskVoiceReplySession}=loadApp('TaskVoiceReplySession',platform,s.globals),{TaskSuggestionSession}=loadApp('TaskSuggestionSession',platform,s.globals);
 // The capture fixture's write-only adapter cannot read source receipts. Use
 // actual SDK-shaped bounded file IO, real SHA and a real fatal decoder here.
 // Both journals live only in this process's owned D: test directory.
 const ownedRoot=path.resolve(s.root),handles=new Map();assert.match(ownedRoot,/^[Dd]:[\\/]/);
 const sourcePath=value=>{const p=typeof value==='number'?handles.get(value):value?.fd!==undefined?handles.get(value.fd):value;
  assert.equal(typeof p,'string');assert(path.resolve(p).startsWith(ownedRoot+path.sep));return p;};
 const sourceIo={OpenMode:{READ_ONLY:fs.constants.O_RDONLY,WRITE_ONLY:fs.constants.O_WRONLY,CREATE:fs.constants.O_CREAT,TRUNC:fs.constants.O_TRUNC},
  lstatSync:p=>fs.lstatSync(sourcePath(p)),statSync:p=>fs.statSync(sourcePath(p)),
  openSync(p,mode){const fd=fs.openSync(sourcePath(p),mode);handles.set(fd,p);return{fd};},
  closeSync(value){const fd=typeof value==='number'?value:value.fd;sourcePath(fd);fs.closeSync(fd);handles.delete(fd);},
  readSync(fd,buffer,options={}){sourcePath(fd);assert.equal(options.offset,undefined);const bytes=new Uint8Array(buffer);return fs.readSync(fd,bytes,0,Math.min(83,options.length??bytes.length,bytes.length),null);},
  writeSync(fd,buffer){sourcePath(fd);const bytes=new Uint8Array(buffer);return fs.writeSync(fd,bytes,0,Math.min(37,bytes.length),null);},
  fsyncSync:fd=>{sourcePath(fd);fs.fsyncSync(fd);},renameSync:(from,to)=>fs.renameSync(sourcePath(from),sourcePath(to))};
 const sourcePlatform={'@kit.CoreFileKit':{fileIo:sourceIo},
  '@kit.ArkTS':{util:{TextEncoder:class{encodeInto(value){return new TextEncoder().encode(value);}},TextDecoder:class{constructor(label,options){this.decoder=new TextDecoder(label,options);}decodeToString(bytes){return this.decoder.decode(bytes);}}}},
  '@kit.CryptoArchitectureKit':{cryptoFramework:{createMd:()=>{const hash=createHash('sha256');return{updateSync:value=>hash.update(value.data),digestSync:()=>({data:Uint8Array.from(hash.digest())})};},
   createRandom:()=>({generateRandomSync:n=>({data:new Uint8Array(n).fill(17)})})}}};
 const {TaskVoiceSources,TaskVoiceConnection}=loadApp('TaskVoiceSources',sourcePlatform,s.globals),sources=new TaskVoiceSources();
 sources.connection=()=>Object.assign(new TaskVoiceConnection(),{peer:'synthetic-peer',epoch:1});sources.initialize(s.root);
 s.c.observeSource=(peer,epoch,business,bytes)=>sources.observe(peer,epoch,business,bytes);
 t.after(()=>{for(const fd of handles.keys())try{fs.closeSync(fd);}catch{}});
 const draft=new model.TaskDecisionDraft(),binding=new model.TaskReplyBinding(),plan=new model.TaskDecisionPlan();draft.initialize(s.root);
 Object.assign(binding,{context_key:'owner-phone-server-route',operation_id:'original-operation',request_id:'original-question',request_revision:3,
  task_id:'original-task',route:{computer_id:'pc',agent_id:'hermes',project_id:'project',session_id:'original-session'},
  expires_at:new Date(s.now+60000).toISOString(),question:'采用新价格吗？',mode:'free_text'});
 draft.begin(binding,plan,s.now);for(const [suffix,cmd]of[['proposal',2],['supplement',1]]){
  const uid=binding.operation_id+'-'+suffix;draft.armCard(binding.context_key,'synthetic-peer',uid,s.now);
  draft.suggestion(binding.context_key,'synthetic-peer',34,uid,cmd,s.now);draft.removalSubmitted('synthetic-peer',uid);
 }
 let clears=0,saved=0,sourceCalls=0;const voice=new TaskVoiceReplySession(draft,{
  state:()=>({active:s.c.active,phase:s.c.state.phase,binding:s.c.state.binding,text:s.c.state.text,valid:s.c.state.savedDraftValid,
   exitEvidence:s.c.state.exitEvidence,transcriptStatus:s.c.state.transcriptStatus}),
  device:()=> 'synthetic-peer',context:()=>binding.context_key,foreground:()=>true,cardReleased:()=>true,validate(){},async revalidate(){},nonce:()=> 'voice-'+'a'.repeat(32),
  start:(token,guard)=>s.c.start(token,15,guard),stop:cancelled=>s.c.stop(cancelled),clear(){clears++;s.c.clearDraft();},cleanup:()=>s.c.cleanup(),
  source(token,text,recover){sourceCalls++;assert.equal(recover,false);const value=JSON.parse(token),epoch=s.c.sourceOrigin(token,text);assert.equal(epoch,1);
   return sources.register(value.reply,value.attempt_id,value.peer,epoch,text);}
 });
 voice.onDraftSaved=()=>saved++;s.c.changed=()=>voice.observe();s.autoExit();await voice.begin(binding);s.receive(3);
 const text='用新价格，但运费沿用上次';s.recognizers[0].onText(text,true,1);await s.c.stop();await flush();
 assert.equal(clears,1);assert.equal(saved,1);assert.equal(s.c.state.phase,'idle');assert.equal(s.c.state.text,'');
 assert.equal(draft.snapshot().stage,'review');assert.equal(draft.snapshot().text,text);assert.equal(draft.snapshot().input_source,'voice');
 assert.equal(sourceCalls,2,'the actual fresh source must match again before capture cleanup');
 const original=model.taskRecordSubmission(draft.snapshot());sources.assertAnswer(original);assert.equal(sources.status(original).state,'watching');
 assert.equal(original.voice_source.attempt_id,'voice-'+'a'.repeat(32));assert.equal(original.voice_source.peer,'synthetic-peer');
 const decoderCalls=s.buffers.length,forwarded=s.receive(3);await flush();
 const lateSource=sources.status(original),lateObserved=s.c.state.lateAudioPackets,phaseAfterLate=s.c.state.phase,answers=[];
 const suggestions=new TaskSuggestionSession(draft,{
  send:(business,bytes)=>s.sender(business,bytes),device:()=> 'synthetic-peer',available:()=>true,foreground:()=>true,context:()=>binding.context_key,
  validate(){},async revalidate(){},async wait(){},assertAnswer:answer=>sources.assertAnswer(answer),
  enqueue(answer){sources.pin(answer);answers.push(JSON.parse(JSON.stringify(answer)));draft.queued(answer.binding.operation_id);return'awaiting_refresh';}
 });
 let submitError='';try{await suggestions.resume();await suggestions.submit();}catch(error){submitError=error.message;}
 t.diagnostic('copy-clear-late '+JSON.stringify({clears,saved,forwarded,phaseAfterLate,lateObserved,sourceState:lateSource.state,sourceLate:lateSource.late_packets,enqueues:answers.length,submitError}));
 assert.equal(forwarded,false,'inactive audio must still remain available for normal voice routing');
 assert.equal(s.buffers.length,decoderCalls,'late input must not reopen ASR or append to a sealed source');
 assert.equal(lateSource.state,'tainted','the independent receipt must survive capture cleanup and observe late type3');
 assert(lateSource.late_packets>=1,'late evidence is owned by the source store, not the cleared capture counter');
 const persisted=JSON.parse(fs.readFileSync(s.root+'/task-voice-sources.json','utf8'));
 assert.equal(persisted.records[0].state,'tainted');assert(persisted.records[0].late_packets>=1);
 assert.equal(answers.length,0,'the original voice answer must be protected before the actual enqueue port');
 assert.equal(draft.snapshot().text,text,'invalidating a source must not delete the already copied full text');
});
