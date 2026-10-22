import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {setupMaterialStore} from './material-fixture.mjs';
import {loadApp} from './load-app.mjs';

const require=createRequire(import.meta.url),deveco=process.env.DEVECO_HOME||'D:/APP/DevEcoStudio';
const ts=require(`${deveco}/sdk/default/openharmony/ets/build-tools/ets-loader/node_modules/typescript`);
const pageSource=name=>fs.readFileSync(new URL(`../entry/src/main/ets/pages/${name}.ets`,import.meta.url),'utf8');
function method(source,name){
 const match=new RegExp(`^  (?:private )?(?:async )?${name}\\(`,'m').exec(source);assert(match,'actual method missing: '+name);
 const after=source.slice(match.index+match[0].length),next=/\n  (?:private |aboutTo|@Builder|build\(|[A-Za-z][A-Za-z0-9_]*\()/.exec(after);
 assert(next,'actual method boundary missing: '+name);return source.slice(match.index,match.index+match[0].length+next.index);
}
function evaluate(body,environment={}){
 const compiled=ts.transpileModule(body,{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS}}).outputText,module={exports:{}};
 vm.runInNewContext(compiled,{...environment,module,exports:module.exports,Error,JSON,Map,Date});return module.exports;
}
const plain=value=>JSON.parse(JSON.stringify(value)),turn=()=>new Promise(setImmediate);
function pageFixture(t,pageName){
 const f=setupMaterialStore(t);assert.match(path.resolve(f.root),/^[Dd]:[\\/]/);
 f.input.transcriptionState='complete';f.input.coveredMs=60000;f.input.sourceMs=60000;
 const initial=f.store.ensure(f.source),head=f.store.appendTranscript(initial.material_id,1,f.input,'synthetic-playback-page');
 const calls=[],dialogs=[],listeners=new Set();let snapshot={schema:1,session_id:'',phase:'idle',position_ms:0,position_known:false,duration_ms:0,duration_known:false,
  native_state:'',callback_seq:0,error:'',note:'',audio_output_verified:false},stopWait,playWait,playError='';
 const localPlayback={snapshot:()=>plain(snapshot),subscribe(listener){calls.push(['subscribe']);listeners.add(listener);return()=>{calls.push(['unsubscribe']);listeners.delete(listener);};},
  play(selection){calls.push(['play',plain(selection)]);if(playError)return Promise.reject(Error(playError));return playWait?new Promise(resolve=>playWait.push(resolve)):Promise.resolve(plain(snapshot));},
  pause:id=>{calls.push(['pause',id]);return Promise.resolve(plain(snapshot));},resume:id=>{calls.push(['resume',id]);return Promise.resolve(plain(snapshot));},
  seek:(id,pos)=>{calls.push(['seek',id,pos]);return Promise.resolve(plain(snapshot));},stop:id=>{calls.push(['stop',id]);return Promise.resolve(plain(snapshot));},
  stopSource(kind,name){calls.push(['stop-source',kind,name]);return stopWait?new Promise((resolve,reject)=>stopWait.push({resolve,reject})):Promise.resolve(plain(snapshot));},
  suspend(reason){calls.push(['suspend',reason]);return Promise.resolve(plain(snapshot));}};
 const item={name:f.source.name,created:f.source.started,bytes:f.source.audioBytes,complete:true,textFile:'old.md'};
 const recordings={items:[item],changed(){},active:false,note:'recording unchanged',refresh(){calls.push(['refresh-recordings']);},
  textPath(){throw Error('forbidden legacy ASR');},remove(target){calls.push(['remove','recording',target.name]);const row=f.store.read(head.material_id);f.store.delete(head.material_id,row.revision);recordings.items=[];}};
 const lifelog={items:[],changed(){},refresh(){calls.push(['refresh-lifelog']);}},lifelogASR={changed(){},initialize(){}};
 const names=['playAudio','playSentence','controlPlayback','playbackError','playbackTime','playbackLabel','closeText','selectedMaterialChanged','aboutToAppear','aboutToDisappear','confirmRemove','clearDeletedSelection','run'];
 const Page=evaluate(`class Page {\n${names.map(name=>method(pageSource(pageName),name)).join('\n')}\n}\nmodule.exports=Page;`,{
  localPlayback,PlaybackSelection:class{kind='';name='';revision=0;utterance_id='';},recordings,lifelog,lifelogASR,
  materials:f.store,LifelogSession:{dayStart:()=>86400000},voices:{initialize(){},ordered:()=>[]},
  cancelRecordingCloudTranscription(){calls.push(['cancel-cloud']);},cancelLifelogManualPublication(){calls.push(['cancel-manual']);}
 });
 const page=new Page();Object.assign(page,{visible:true,actionEpoch:1,busy:false,note:'old page note',playback:plain(snapshot),playbackUnsubscribe(){calls.push(['unsubscribe-initial']);},
  selected:86400000,calBase:86400000,text:head.text,transcript:head.text,textName:item.name,textKind:'recording',textRevision:2,fullText:false,
  refresh(){calls.push(['refresh-page']);},restoreNoteEditor(){},syncSchedule(){},invalidateLocalSearch(){calls.push(['invalidate-query']);},vault:{load:()=>Promise.resolve({})},
  getUIContext:()=>({getHostContext:()=>({filesDir:f.root}),showAlertDialog:value=>dialogs.push(value),getPromptAction:()=>({showToast:value=>calls.push(['toast',value.message])})})});
 return{...f,page,head,item,recordings,lifelog,calls,dialogs,localPlayback,listeners,
  row:()=>({kind:'recording',recordingItem:item}),source:pageSource(pageName),
  setSnapshot(value){snapshot={...snapshot,...plain(value)};for(const listener of listeners)listener(plain(snapshot));},
  failPlay:code=>playError=code,deferStop:()=>stopWait=[],stopWait:()=>stopWait,
  deferPlay:()=>playWait=[],playWait:()=>playWait};
}

// Actual page/editor methods and actual MaterialStore writes. ArkUI builders,
// device media, audible output and remote synchronization are not exercised.
test('recording actual editor reload of empty Store correction cannot retain old transcript under new revision',t=>{
 const f=setupMaterialStore(t);assert.match(path.resolve(f.root),/^[Dd]:[\\/]/);
 f.input.transcriptionState='complete';f.input.coveredMs=60000;f.input.sourceMs=60000;
 const first=f.store.ensure(f.source),head=f.store.appendTranscript(first.material_id,1,f.input,'synthetic-playback-empty');
 const originalFile=f.root+'/materials/'+head.material_id+'/revision-000000002.json',original=fs.readFileSync(originalFile);
 const source=pageSource('RecordingPanel'),hasHelper=/^  private selectedMaterialChanged\(/m.test(source);
 const callback=hasHelper?'(row:MaterialRevision):void=>this.selectedMaterialChanged(row)':
  source.match(/onChanged:(\(row:MaterialRevision\):void=>\{[^}]+\})/)?.[1];assert(callback,'actual recording editor callback missing');
 const Page=evaluate(`class Page {\n${method(source,'viewText')}\n${hasHelper?method(source,'selectedMaterialChanged'):''}\ncallback(){return ${callback};}\n}\nmodule.exports=Page;`,{
  localMaterialRevision:(kind,name)=>f.store.read(f.store.idFor(kind,name)),
  localPlayback:{snapshot:()=>({})},
  recordings:{textPath(){throw Error('empty canonical result must not read an old ASR mirror');}},
  fs:{readTextSync(){throw Error('empty canonical result must not read an old ASR mirror');}}
 });
 const page=new Page();Object.assign(page,{visible:true,textName:'',transcript:'',textRevision:0,fullText:false,note:''});
 page.viewText({name:f.source.name});assert.equal(page.transcript,head.text);
 const editorSource=pageSource('MaterialSpeakerEditor'),Editor=evaluate(`class Editor {\n${method(editorSource,'reload')}\n}\nmodule.exports=Editor;`,{
  localMaterialRevision:(kind,name)=>f.store.read(f.store.idFor(kind,name)),deriveMaterialSpeakers:f.deriveMaterialSpeakers,
 });
 const editor=new Editor();Object.assign(editor,{visible:true,busy:false,row:head,kind:'recording',name:f.source.name,onChanged:page.callback()});
 // The existing correctText API can publish an empty canonical body. The
 // normal editor's correctSpeakers text operation preserves display headings;
 // do not substitute the two APIs or claim they have identical rendering.
 f.store.correctText(head.material_id,head.revision,head.utterances[0].utterance_id,'');editor.reload();const current=f.store.read(head.material_id);
 assert.equal(current.revision,3);assert.equal(current.text,'');assert.equal(current.utterances[0].text,'');
 assert.equal(page.textRevision,3);assert.equal(page.transcript,'','old nonempty body must not be presented as the new empty revision');
 assert.deepEqual(fs.readFileSync(originalFile),original);
});

for(const name of ['RecordingPanel','JournalPanel']){
 test(`${name} explicit full play is text-independent and passes only closed local selection`,async t=>{
  const f=pageFixture(t,name);f.page.text='';f.page.transcript='';f.page.textName='';
  f.page.playAudio('recording',f.item.name);await turn();
  assert.deepEqual(f.calls.find(call=>call[0]==='play'),['play',{kind:'recording',name:f.item.name,revision:0,utterance_id:''}]);
  assert.equal(f.store.read(f.head.material_id).revision,2);assert.equal(f.page.text,'');assert.equal(f.page.transcript,'');
 });
 test(`${name} actual page sentence callback delegates revision and ID without trusting offset`,async t=>{
  const f=pageFixture(t,name),part=plain(f.head.utterances[0]);f.page.playSentence(part,f.head);await turn();
  assert.deepEqual(f.calls.find(call=>call[0]==='play'),['play',{kind:'recording',name:f.item.name,revision:2,utterance_id:part.utterance_id}]);
  const count=f.calls.length;part.start_ms=null;part.end_ms=null;part.source_range={start_ms:2000,end_ms:3000};f.page.playSentence(part,f.head);assert.equal(f.calls.length,count);
 });
 test(`${name} subscribe does not start audio, leave unsubscribes and suspends, old callback is ignored`,async t=>{
  const f=pageFixture(t,name);f.page.aboutToAppear();await turn();assert.equal(f.calls.some(call=>call[0]==='play'),false);
  const callback=[...f.listeners][0];f.setSnapshot({session_id:'session-current',phase:'playing'});assert.equal(f.page.playback.phase,'playing');
  f.page.aboutToDisappear();assert.equal(f.listeners.size,0);assert(f.calls.some(call=>call[0]==='suspend'&&call[1]==='page_leave'));
  callback({session_id:'stale',phase:'playing'});assert.equal(f.page.playback.session_id,'session-current');
 });
 test(`${name} controls use actual observed position and do not optimistically report a requested seek`,async t=>{
  const f=pageFixture(t,name);f.setSnapshot({session_id:'session-observed',phase:'paused',position_known:true,position_ms:22000,duration_known:true,duration_ms:60000});f.page.playback=f.localPlayback.snapshot();
  f.page.controlPlayback('seek',15000);await turn();assert(f.calls.some(call=>call[0]==='seek'&&call[1]==='session-observed'&&call[2]===37000));assert.equal(f.page.playback.position_ms,22000);
  f.page.controlPlayback('pause');f.page.controlPlayback('resume');f.page.controlPlayback('stop');await turn();
  for(const action of ['pause','resume','stop'])assert(f.calls.some(call=>call[0]===action&&call[1]==='session-observed'));
  f.page.playback.position_known=false;const count=f.calls.length;f.page.controlPlayback('seek',15000);assert.equal(f.calls.length,count);
 });
 test(`${name} source revision callbacks preserve full playback but stop matching stale anchored playback`,t=>{
  const f=pageFixture(t,name),changed=f.store.correctText(f.head.material_id,2,f.head.utterances[0].utterance_id,'更正');
  f.setSnapshot({source:{kind:'recording',name:f.item.name,revision:0}});f.page.selectedMaterialChanged(changed);assert.equal(f.calls.some(call=>call[0]==='stop-source'),false);
  f.setSnapshot({source:{kind:'recording',name:f.item.name,revision:2}});f.page.selectedMaterialChanged(f.head);assert.equal(f.calls.some(call=>call[0]==='stop-source'),false);
  f.page.selectedMaterialChanged(changed);assert(f.calls.some(call=>call[0]==='stop-source'&&call[1]==='recording'&&call[2]===f.item.name));
 });
 test(`${name} close current original text stops only that source and leaves unrelated document regions intact`,t=>{
  const f=pageFixture(t,name);f.page.savedSummaryDocument={summary_text:'AI正文'};f.page.savedNoteDocument={text:'人工附注'};f.page.closeText();
  assert(f.calls.some(call=>call[0]==='stop-source'&&call[1]==='recording'&&call[2]===f.item.name));
  assert.equal(f.page.textName,'');assert.equal(f.page.savedSummaryDocument.summary_text,'AI正文');assert.equal(f.page.savedNoteDocument.text,'人工附注');
 });
 test(`${name} deferred native release must finish before deletion, then uses the original identity`,async t=>{
  const f=pageFixture(t,name);f.deferStop();f.page.confirmRemove(name==='RecordingPanel'?f.item:f.row());f.dialogs[0].secondaryButton.action();await turn();
  assert.equal(f.store.read(f.head.material_id).operation,'upsert');assert.equal(f.calls.some(call=>call[0]==='remove'),false);
  f.stopWait()[0].resolve(f.localPlayback.snapshot());await turn();assert.equal(f.store.read(f.head.material_id).operation,'delete');
  assert(f.calls.findIndex(call=>call[0]==='stop-source')<f.calls.findIndex(call=>call[0]==='remove'));
 });
 test(`${name} failed release does not tombstone or clear the original selected text`,async t=>{
  const f=pageFixture(t,name);f.deferStop();f.page.confirmRemove(name==='RecordingPanel'?f.item:f.row());f.dialogs[0].secondaryButton.action();await turn();
  f.stopWait()[0].reject(Error('PLAYBACK_CLEANUP_PENDING'));await turn();assert.equal(f.store.read(f.head.material_id).operation,'upsert');assert.equal(f.calls.some(call=>call[0]==='remove'),false);
  assert.equal(f.page.textName,f.item.name);assert.equal(f.page.textRevision,2);
 });
 test(`${name} leaving while release awaits prevents a stale deletion and toast`,async t=>{
  const f=pageFixture(t,name);f.deferStop();f.page.confirmRemove(name==='RecordingPanel'?f.item:f.row());f.dialogs[0].secondaryButton.action();await turn();
  f.page.aboutToDisappear();f.stopWait()[0].resolve(f.localPlayback.snapshot());await turn();assert.equal(f.store.read(f.head.material_id).operation,'upsert');
  assert.equal(f.calls.some(call=>call[0]==='remove'),false);assert.equal(f.calls.some(call=>call[0]==='toast'),false);
 });
 test(`${name} changing identity while release awaits cannot remove a different item`,async t=>{
  const f=pageFixture(t,name);f.deferStop();f.page.confirmRemove(name==='RecordingPanel'?f.item:f.row());f.dialogs[0].secondaryButton.action();await turn();
  f.item.name='take-'+'b'.repeat(32);f.stopWait()[0].resolve(f.localPlayback.snapshot());await turn();assert.equal(f.store.read(f.head.material_id).operation,'upsert');assert.equal(f.calls.some(call=>call[0]==='remove'),false);
 });
 test(`${name} friendly source errors never expose native path or token`,async t=>{
  const f=pageFixture(t,name);for(const code of ['PLAYBACK_INCOMPLETE','PLAYBACK_DELETED','PLAYBACK_ANCHOR_STALE','PLAYBACK_TIME_UNKNOWN','PLAYBACK_SOURCE_CHANGED','PLAYBACK_SOURCE_UNAVAILABLE','secret D:/private/audio.wav token=secret']){
   f.failPlay(code);f.page.playAudio('recording',f.item.name);await turn();assert.doesNotMatch(f.page.note,/private|secret|token|D:\//);assert.notEqual(f.page.note,code);
  }
 });
}

test('Editor play callback rejects unknown split timing, changed displayed part and unavailable audio',t=>{
 const f=setupMaterialStore(t),source=pageSource('MaterialSpeakerEditor');f.input.transcriptionState='complete';f.input.coveredMs=60000;f.input.sourceMs=60000;
 const first=f.store.ensure(f.source),head=f.store.appendTranscript(first.material_id,1,f.input,'synthetic-editor-play'),calls=[];
 const Editor=evaluate(`class Editor {\n${['partPlayable','playPart','partTime'].map(name=>method(source,name)).join('\n')}\n}\nmodule.exports=Editor;`),editor=new Editor();
 Object.assign(editor,{visible:true,busy:false,retryPending:false,row:head,onPlay:(...args)=>calls.push(plain(args))});
 const part=plain(head.utterances[0]);editor.playPart(part);assert.equal(calls.length,1);assert.equal(calls[0][1].revision,head.revision);
 editor.playPart({...part,start_ms:null,end_ms:null,source_range:{start_ms:part.start_ms,end_ms:part.end_ms}});assert.equal(calls.length,1);
 assert.match(editor.partTime({...part,start_ms:null,end_ms:null}),/未确定/);editor.playPart({...part,text:'未显示的新句'});assert.equal(calls.length,1);
 head.source.audioAvailable=false;editor.playPart(part);assert.equal(calls.length,1);assert.match(source,/播放原句起点/);assert.match(source,/不能定位子句起点/);
});

test('Journal selecting a new date suspends playback while preserving unsaved note input',t=>{
 const f=pageFixture(t,'JournalPanel'),Page=evaluate(`class Page {\n${method(f.source,'selectDay')}\n}\nmodule.exports=Page;`,{localPlayback:f.localPlayback});
 const page=new Page();Object.assign(page,{selected:86400000,noteEditorText:'未提交附注输入',invalidateLocalSearch(){}});page.selectDay(172800000);
 assert(f.calls.some(call=>call[0]==='suspend'&&call[1]==='day_change'));assert.equal(page.noteEditorText,'未提交附注输入');
});
