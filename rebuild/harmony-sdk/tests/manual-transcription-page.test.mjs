import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {loadApp} from './load-app.mjs';

const require=createRequire(import.meta.url);
const deveco=process.env.DEVECO_HOME||'/Applications/DevEco-Studio.app/Contents';
const ts=require(`${deveco}/sdk/default/openharmony/ets/build-tools/ets-loader/node_modules/typescript`);
const {PlaybackSnapshot}=loadApp('PlaybackController');
const settle=()=>new Promise(resolve=>setImmediate(resolve));
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};}

// Execute the actual ordinary event methods; ArkUI builders are not evaluated
// by the desktop component runner. Platform and service boundaries are explicit
// substitutes, so these checks do not claim native UI or ASR acceptance.
function method(source,name){
  const match=new RegExp(`^  (?:private )?(?:async )?${name}\\(`,'m').exec(source);
  assert(match,`missing page method ${name}`);
  const after=source.slice(match.index+match[0].length);
  const next=/\n  (?:private |aboutTo|@Builder|build\()/.exec(after);
  assert(next,`missing boundary after ${name}`);
  return source.slice(match.index,match.index+match[0].length+next.index);
}
function pageFixture(name,{queueAccepted=true,status='转写队列未能保存，原件保留，可重试',lifelogManual,cloud,load}={}){
  const source=fs.readFileSync(new URL(`../entry/src/main/ets/pages/${name}.ets`,import.meta.url),'utf8');
  const names=name==='JournalPanel'?['run','transcribeEntry','transcribeDay','aboutToDisappear']:['run','confirmTranscription','retryLocal','aboutToDisappear'];
  const script=ts.transpileModule(`class Page {\n${names.map(n=>method(source,n)).join('\n')}\n}\nmodule.exports=Page;`,
    {compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS}}).outputText;
  const calls=[],toasts=[],dialogs=[],queued=[];let cancelled=0,manualInvalidated=0,loads=0,refreshes=0;
  const playbackCalls=[],playbackState=new PlaybackSnapshot();
  const localPlayback={snapshot:()=>Object.assign(new PlaybackSnapshot(),playbackState),
    subscribe(){playbackCalls.push(['subscribe']);return()=>playbackCalls.push(['unsubscribe']);},
    suspend:reason=>{playbackCalls.push(['suspend',reason]);return Promise.resolve(Object.assign(new PlaybackSnapshot(),playbackState));}};
  const config={asrKey:'synthetic-only'},recordings={changed(){},note:'旧录音状态',directoryOf:item=>'/app/recordings/'+item.name,
    file:(item,wav)=>'/app/recordings/'+item.name+(wav?'/source.wav':'/source.rawopus'),saveTranscript(){assert.fail('page must not bypass canonical publication');}};
  const lifelog={changed(){},rootPath:()=>'/app/lifelog',file:item=>'/app/lifelog/'+item.name+'/audio.ogg',
    saveTranscript(){assert.fail('page must not write old text directly');},saveTranscriptJson(){assert.fail('page must not write old JSON directly');}};
  const lifelogASR={busy:false,progress:0,changed(){},transcribe(){assert.fail('page must use the full-transcription publication service');},cancel(){assert.fail('page must not close the shared local worker');}};
  const service={enqueueLocalTranscribe:(...args)=>{calls.push(['enqueue',...args]);if(queueAccepted&&!queued.includes(args[0]))queued.push(args[0]);},
    localQueueSize:()=>queued.length,localCurrentDirectory:()=>'',localQueuedDirectories:()=>[...queued],
    localTranscriptionState:()=>queueAccepted?'等待本机转写':status,
    transcribeLifelogManual:(item,allowRecognitionRetry)=>{calls.push(['lifelog-manual',item,allowRecognitionRetry]);return lifelogManual?lifelogManual(item,allowRecognitionRetry):Promise.resolve('本机完整转写和资料修订已保存，说话人保留本段分析结果');},
    cancelLifelogManualPublication:()=>{manualInvalidated++;},
    transcribeRecordingCloud:(item,c,allowRecognitionRetry)=>{calls.push(['cloud',item,c,allowRecognitionRetry]);return cloud?cloud(item,c,allowRecognitionRetry):Promise.resolve('资料修订已保存，兼容文字待恢复');},
    cancelRecordingCloudTranscription:()=>{cancelled++;}};
  class SecureServiceConfig{load(){loads++;return load?load():Promise.resolve(config);}}
  const module={exports:{}};
  vm.runInNewContext(script,{module,exports:module.exports,recordings,lifelog,lifelogASR,SecureServiceConfig,PlaybackSnapshot,localPlayback,...service});
  const page=new module.exports();
  Object.assign(page,{playback:new PlaybackSnapshot(),playbackUnsubscribe:()=>playbackCalls.push(['unsubscribe']),visible:true,actionEpoch:1,busy:false,note:'',queue:0,runningDir:'',queuedDirs:[],
    vault:new SecureServiceConfig(),getUIContext:()=>({showAlertDialog:d=>dialogs.push(d),getPromptAction:()=>({showToast:t=>toasts.push(t.message)})}),
    refresh:()=>{refreshes++;page.queue=queued.length;page.queuedDirs=[...queued];page.runningDir='';page.transcribing=lifelogASR.busy;},
    dayEntries:()=>[]});
  const item={name:(name==='JournalPanel'?'seg-':'take-')+'a'.repeat(32),created:1000,ogg:true};
  return{page,item,config,source,calls,toasts,dialogs,queued,lifelogASR,playbackCalls,cancelled:()=>cancelled,manualInvalidated:()=>manualInvalidated,loads:()=>loads,refreshes:()=>refreshes};
}
function openCloud(s,name){
  if(name==='JournalPanel')s.page.transcribeEntry({kind:'recording',recordingItem:s.item});
  else s.page.confirmTranscription(s.item);
  const dialog=s.dialogs.at(-1);assert.match(dialog.message,/阿里.*ASR/);assert.match(dialog.message,/离开本页或退到后台即取消/);
  assert.match(dialog.message,/已保存结果优先恢复/);assert.match(dialog.message,/结果未保存.*重新上传所选录音/);
  assert.equal(s.calls.length,0,'retry permission follows the existing confirmation');
  dialog.secondaryButton.action();
}
function remount(s){s.page.aboutToDisappear();assert.deepEqual(s.playbackCalls,[['unsubscribe'],['suspend','page_leave']]);s.page.visible=true;s.page.actionEpoch++;s.page.busy=true;s.page.note='新页面状态';}

test('single lifelog action retains full offline speaker analysis through the publication service',async()=>{
  const s=pageFixture('JournalPanel');s.page.transcribeEntry({kind:'lifelog',lifelogItem:s.item});
  assert.equal(s.calls.length,0,'confirmation precedes full recognition');assert.match(s.dialogs[0].message,/完整转写.*分析说话人/);
  assert.match(s.dialogs[0].message,/全程不联网/);assert.match(s.dialogs[0].message,/保留未知/);
  assert.match(s.dialogs[0].message,/已保存结果优先恢复.*结果未保存.*重新识别/);assert.doesNotMatch(s.dialogs[0].message,/重新上传/);
  assert.doesNotMatch(s.dialogs[0].message,/分窗处理|说话人归属仍待分析/);
  s.dialogs[0].secondaryButton.action();await settle();
  assert.equal(s.calls.length,1);assert.equal(s.calls[0][0],'lifelog-manual');assert.equal(s.calls[0][1],s.item);assert.equal(s.calls[0][2],true);
  assert.equal(s.dialogs.length,1,'the existing confirmation authorizes any necessary recognition retry');
  assert.equal(s.page.queue,0);assert.equal(s.page.busy,false);
  assert.equal(s.toasts.at(-1),'本机完整转写和资料修订已保存，说话人保留本段分析结果');
});

test('single full-transcription publication failure remains visible without direct legacy writes',async()=>{
  const s=pageFixture('JournalPanel',{lifelogManual:()=>Promise.reject(new Error('REVISION_CONFLICT'))});s.page.transcribeEntry({kind:'lifelog',lifelogItem:s.item});
  s.dialogs[0].secondaryButton.action();await settle();
  assert.equal(s.page.queue,0);assert.equal(s.toasts.at(-1),'REVISION_CONFLICT');assert.equal(s.page.busy,false);
});

test('old lifelog confirmation cannot start full recognition after leaving and remounting',async()=>{
  const s=pageFixture('JournalPanel');s.page.transcribeEntry({kind:'lifelog',lifelogItem:s.item});
  const start=s.dialogs[0].secondaryButton.action;remount(s);start();await settle();
  assert.equal(s.calls.length,0);assert.equal(s.page.note,'新页面状态');assert.equal(s.page.busy,true);assert.equal(s.cancelled(),1);
  assert.equal(s.manualInvalidated(),1);
});

test('single full transcription waits while the shared local worker is actually running',async()=>{
  const s=pageFixture('JournalPanel');s.lifelogASR.busy=true;
  s.page.transcribeEntry({kind:'lifelog',lifelogItem:s.item});s.dialogs[0].secondaryButton.action();await settle();
  assert.equal(s.calls.length,0);assert.match(s.toasts.at(-1),/已有本机转写正在执行/);assert.equal(s.page.busy,false);
});

test('single full transcription remains available while another window task is durably queued',async()=>{
  const s=pageFixture('JournalPanel');s.queued.push('/app/lifelog/another');
  s.page.transcribeEntry({kind:'lifelog',lifelogItem:s.item});
  assert.match(s.dialogs[0].message,/保持应用前台/);assert.match(s.dialogs[0].message,/排队任务在本次处理后继续/);
  s.dialogs[0].secondaryButton.action();await settle();
  assert.equal(s.calls.length,1);assert.equal(s.calls[0][0],'lifelog-manual');assert.equal(s.page.queue,1);
  assert.deepEqual(s.queued,['/app/lifelog/another'],'page does not remove or cancel the waiting task');assert.equal(s.page.busy,false);
});

test('single full-transcription late result invalidates publication without closing the shared worker or overwriting remounted UI',async()=>{
  const pending=deferred(),s=pageFixture('JournalPanel',{lifelogManual:()=>pending.promise});
  s.page.transcribeEntry({kind:'lifelog',lifelogItem:s.item});s.dialogs[0].secondaryButton.action();await settle();
  assert.equal(s.calls.length,1);assert.equal(s.page.busy,true);remount(s);pending.resolve('旧本机结果');await settle();
  assert.equal(s.manualInvalidated(),1);assert.equal(s.page.note,'新页面状态');assert.equal(s.page.busy,true);assert.equal(s.toasts.length,0);
});

test('single full-transcription preserves the durable-result compatibility recovery status',async()=>{
  const s=pageFixture('JournalPanel',{lifelogManual:()=>Promise.resolve('资料修订已保存，兼容文字待恢复')});
  s.page.transcribeEntry({kind:'lifelog',lifelogItem:s.item});s.dialogs[0].secondaryButton.action();await settle();
  assert.equal(s.page.note,'资料修订已保存，兼容文字待恢复');assert.equal(s.toasts.at(-1),s.page.note);
});

test('bulk confirmation describes the same budget-controlled offline queue without charging or speaker guarantees',()=>{
  const s=pageFixture('JournalPanel');s.page.dayEntries=()=>[{kind:'lifelog',lifelogItem:s.item,hasText:false}];s.page.transcribeDay(0);
  const d=s.dialogs[0];assert.match(d.message,/电量、温度、存储与处理预算/);assert.match(d.message,/说话人归属仍待分析/);
  assert.doesNotMatch(d.message,/只会在充电|不受充电限制|含说话人区分/);
  remount(s);d.secondaryButton.action();assert.equal(s.calls.length,0);
});

test('bulk enqueue refusal does not report that every selected record was accepted',async()=>{
  const s=pageFixture('JournalPanel',{queueAccepted:false});
  s.page.dayEntries=()=>[{kind:'lifelog',lifelogItem:s.item,hasText:false}];s.page.transcribeDay(0);
  s.dialogs[0].secondaryButton.action();await settle();
  assert.equal(s.calls.length,1);assert.equal(s.page.queue,0);assert.equal(s.page.busy,false);
  assert.match(s.toasts.at(-1),/排队请求.*实际受理状态/);assert.doesNotMatch(s.toasts.at(-1),/已排队.*条|已进入/);
});

test('bulk lifelog continues to use forced window queue instead of the single full-recognition service',async()=>{
  const s=pageFixture('JournalPanel');s.page.dayEntries=()=>[{kind:'lifelog',lifelogItem:s.item,hasText:false}];
  s.page.transcribeDay(0);s.dialogs[0].secondaryButton.action();await settle();
  assert.deepEqual(s.calls,[['enqueue','/app/lifelog/'+s.item.name,'/app/lifelog/'+s.item.name+'/audio.ogg',1000,'lifelog',true]]);
  assert.equal(s.page.queue,1);assert.equal(s.page.transcribing,false,'queued is not running');assert.equal(s.page.busy,false);
});

for(const name of ['JournalPanel','RecordingPanel']){
  test(`${name} actual leave explicitly unsubscribes and suspends playback without initiating transcription`,async()=>{
    const s=pageFixture(name);assert.equal(s.page.playback instanceof PlaybackSnapshot,true);assert.equal(s.page.playback.audio_output_verified,false);
    s.page.aboutToDisappear();await settle();assert.deepEqual(s.playbackCalls,[['unsubscribe'],['suspend','page_leave']]);
    assert.equal(s.page.visible,false);assert.equal(s.cancelled(),1);assert.equal(s.manualInvalidated(),name==='JournalPanel'?1:0);
    assert.equal(s.calls.length,0);assert.equal(s.loads(),0);assert.equal(s.toasts.length,0);
  });
  test(`${name} cloud callback preserves service publication status and does not save legacy text`,async()=>{
    const s=pageFixture(name);openCloud(s,name);await settle();
    assert.equal(s.calls.length,1);assert.equal(s.calls[0][0],'cloud');assert.equal(s.calls[0][1],s.item);assert.equal(s.calls[0][2],s.config);assert.equal(s.calls[0][3],true);
    assert.equal(s.dialogs.length,1,'no second confirmation or new cloud entry');
    assert.equal(s.page.note,'资料修订已保存，兼容文字待恢复');assert.equal(s.toasts.at(-1),s.page.note);assert.equal(s.page.busy,false);
  });
  test(`${name} config read finishing after remount cannot start an external transcription`,async()=>{
    const pending=deferred(),s=pageFixture(name,{load:()=>pending.promise});openCloud(s,name);assert.equal(s.loads(),1);
    remount(s);pending.resolve(s.config);await settle();
    assert.equal(s.calls.length,0);assert.equal(s.page.note,'新页面状态');assert.equal(s.page.busy,true);assert.equal(s.toasts.length,0);
  });
  test(`${name} late cloud result and finally cannot overwrite the newly mounted page`,async()=>{
    const pending=deferred(),s=pageFixture(name,{cloud:()=>pending.promise});openCloud(s,name);await settle();assert.equal(s.calls.length,1);
    remount(s);pending.resolve('旧回复');await settle();
    assert.equal(s.page.note,'新页面状态');assert.equal(s.page.busy,true);assert.equal(s.toasts.length,0);assert.equal(s.cancelled(),1);
  });
  test(`${name} publication failure is visible without a false completion message`,async()=>{
    const s=pageFixture(name,{cloud:()=>Promise.reject(new Error('REVISION_CONFLICT'))});openCloud(s,name);await settle();
    assert.equal(s.page.note,'REVISION_CONFLICT');assert.equal(s.toasts.at(-1),'REVISION_CONFLICT');assert.equal(s.page.busy,false);
  });
}

test('recording local retry keeps using the existing durable publication pipeline',()=>{
  const s=pageFixture('RecordingPanel');s.page.retryLocal(s.item);
  assert.deepEqual(s.calls,[['enqueue','/app/recordings/'+s.item.name,'/app/recordings/'+s.item.name+'/source.rawopus',1000,'recording',true]]);
});
