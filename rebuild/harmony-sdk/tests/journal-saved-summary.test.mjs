import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {loadApp} from './load-app.mjs';
import {setupMaterialStore} from './material-fixture.mjs';

// Real MaterialStore, JournalExport, saved-summary core and actual page methods;
// only platform services, picker and UI shell are controlled substitutes. All
// files stay in the test-owned D: directory. No model/network/device is used.
const require=createRequire(import.meta.url),deveco=process.env.DEVECO_HOME||'D:/APP/DevEcoStudio';
const ts=require(`${deveco}/sdk/default/openharmony/ets/build-tools/ets-loader/node_modules/typescript`);
const source=fs.readFileSync(new URL('../entry/src/main/ets/pages/JournalPanel.ets',import.meta.url),'utf8');
const DAY=new Date(2026,9,15).getTime(),clone=value=>JSON.parse(JSON.stringify(value));
const turn=()=>new Promise(setImmediate),digest=value=>createHash('sha256').update(value).digest('hex');
function method(name){
 const match=new RegExp(`^  (?:private )?(?:async )?${name}\\(`,'m').exec(source);assert(match,'actual page method missing: '+name);
 const after=source.slice(match.index+match[0].length),next=/\n  (?:private |aboutTo|@Builder|[A-Za-z][A-Za-z0-9_]*\()/.exec(after);
 assert(next,'actual method boundary missing: '+name);return source.slice(match.index,match.index+match[0].length+next.index);
}
async function finish(page){for(let at=0;at<200&&page.busy;at++)await new Promise(resolve=>setTimeout(resolve,5));assert.equal(page.busy,false,'page action must settle');}
function fixture(t){
 const f=setupMaterialStore(t);assert.match(path.resolve(f.root),/^[Dd]:[\\/]/);
 f.io.lstatSync=p=>{const value=fs.lstatSync(p);return Object.assign(value,{mtime:value.mtimeMs,ctime:value.ctimeMs});};
 const playbackCalls=[],localPlayback={snapshot:()=>({}),subscribe:()=>()=>{playbackCalls.push('unsubscribe');},suspend:reason=>{playbackCalls.push(['suspend',reason]);return Promise.resolve({});},stopSource:(kind,name)=>{playbackCalls.push(['stop-source',kind,name]);return Promise.resolve({});}};
 const calls=[],opened=[],dialogs=[],toasts=[],pickerWait=[];let deferred=false,readFailure='',listFailure=false,sourceCalls=0,chunkHook;
 const nativeIO={OpenMode:{CREATE:1,WRITE_ONLY:2,TRUNC:4,READ_ONLY:8},accessSync:fs.existsSync,
  listFileSync(p){calls.push('list-files');if(listFailure)throw Error('synthetic listing unavailable');return fs.readdirSync(p);},
  lstatSync:fs.lstatSync,statSync:p=>typeof p==='number'?fs.fstatSync(p):fs.statSync(p),mkdirSync:p=>fs.mkdirSync(p),
  readTextSync:p=>fs.readFileSync(p,'utf8'),
  openSync(p,mode){opened.push([p,mode]);return{fd:fs.openSync(p,mode&8?'r':mode&5?'w':'r+')}},
  closeSync:file=>fs.closeSync(typeof file==='number'?file:file.fd),
  readSync:(fd,b,options)=>fs.readSync(fd,new Uint8Array(b),0,options?.length??b.byteLength,null),
  writeSync:(fd,b)=>{const bytes=new Uint8Array(b);return fs.writeSync(fd,bytes,0,Math.min(bytes.length,4093),null);},
  fsyncSync:fs.fsyncSync,renameSync:fs.renameSync};
 const codecs={util:{TextEncoder:class{encodeInto(value){return new TextEncoder().encode(value);}},TextDecoder:class{
  constructor(encoding,options){this.decoder=new TextDecoder(encoding,options);}decodeToString(bytes){return this.decoder.decode(bytes);}}}};
 const platform={'@kit.CoreFileKit':{fileIo:nativeIO},'@kit.ArkTS':codecs,
  './LifelogSession':{LifelogDayText:class{markdown='';total=0;transcribed=0;}},'./RecordingSession':{}};
 const journal=loadApp('JournalExport',platform),saved=loadApp('SavedJournalSummary',platform),query=loadApp('MaterialLocalQuery',platform);
 const recordings={items:[],changed(){},active:false,stopping:false,refresh(){},textPath(){calls.push('legacy-recording');return f.root+'/forbidden-legacy.md';}},
  lifelog={items:[],rootPath:()=>f.root,changed(){},note:'capture state',active:false,dayEnabled:false,bytes:0,emptySegments:0,capturePhase:'idle',
   refresh(){},readTranscriptJson(){calls.push('legacy-lifelog');return'';}},lifelogASR={busy:false,progress:0,changed(){}};
 const materials={ids:()=>f.store.ids(),idFor:(...args)=>f.store.idFor(...args),queryCatalog:()=>f.store.queryCatalog(),read(id){calls.push(['canonical',id]);if(id===readFailure)throw Error('synthetic canonical read failed');return f.store.read(id);}};
 function remove(kind,item){const id=f.store.idFor(kind,item.name),head=f.store.read(id);f.store.delete(id,head.revision);
  const service=kind==='recording'?recordings:lifelog;service.items=service.items.filter(value=>value.name!==item.name);}
 recordings.remove=item=>remove('recording',item);lifelog.remove=item=>remove('lifelog',item);
 const picker={DocumentViewPicker:class{save(){calls.push('picker');return deferred?new Promise(resolve=>pickerWait.push(resolve)):Promise.resolve([f.root+'/export.md']);}}};
 const probe={foreground:true},summaryCalls={list:0,open:0};let core;
 const shared={list(filter){summaryCalls.list++;return core.list(filter);},open(reference){summaryCalls.open++;return core.open(reference);}};
 const methods=['closeSavedSummaries','listSavedSummaries','savedSummaryState','savedSummaryCoverage','openSavedSummary','exportSavedSummary','copyOut',
  'run','stamp','sources','dayMarkdown','refresh','recount','atDay','selectDay','invalidateLocalSearch','changeQueryKeyword','changeQuerySpeaker',
  'clearLocalSearch','searchLocal','localQuery','refreshEntries','selectedMaterialChanged','confirmRemove','clearDeletedSelection','aboutToDisappear'];
 const begin=source.indexOf('class JournalEntry {'),end=source.indexOf('\n@Component',begin);
 const code=ts.transpileModule(source.slice(begin,end)+`\nclass Page {\n${methods.map(method).join('\n')}\n}\nmodule.exports=Page;`,
  {compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS}}).outputText;
 const module={exports:{}},cryptoFramework={createMd:()=>{const hash=createHash('sha256');return{updateSync:value=>hash.update(value.data),digestSync:()=>({data:Uint8Array.from(hash.digest())})};}};
 vm.runInNewContext(code,{...journal,...saved,...query,module,exports:module.exports,localPlayback,fs:nativeIO,picker,savedJournalSummaries:shared,
  recordings,lifelog,lifelogASR,materials,probeSession:probe,Map,Date,JSON,Error,ArrayBuffer,Uint8Array,Promise,
  util:codecs.util,cryptoFramework,materialSyncService:{view:()=>({state:'local',storedRevision:0})},
  localQueueSize:()=>0,localCurrentDirectory:()=>'',localQueuedDirectories:()=>[],cancelRecordingCloudTranscription(){},cancelLifelogManualPublication(){},
  setTimeout(callback,ms){return setTimeout(()=>{if(chunkHook){const hook=chunkHook;chunkHook=undefined;hook();}callback();},ms);}});
 const page=new module.exports();Object.assign(page,{playbackUnsubscribe(){playbackCalls.push('unsubscribe');},visible:true,actionEpoch:1,busy:false,selected:DAY,note:'ordinary note',entries:[],dayKeys:new Map(),
  queryKeyword:'',querySpeaker:'',queryPage:undefined,querySignature:'',querySourcesSignature:'',queryCheckedRaw:new Map(),queryOpenedKey:'',queryNote:'',
  savedSummaryPage:undefined,savedSummaryDocument:undefined,savedSummaryDay:'',savedSummaryGeneration:0,savedSummaryNote:'',
  text:'ordinary detail B',textKind:'recording',textName:'unrelated-B',textRevision:17,textNeedsFull:false,fullText:true,
  collectPendingVoices(){},getUIContext:()=>({getHostContext:()=>({}),showAlertDialog:value=>dialogs.push(value),getPromptAction:()=>({showToast:value=>toasts.push(value.message)})})});
 core=new saved.SavedJournalSummary({root:()=>f.root,current(day){sourceCalls++;return page.dayMarkdown(day,'');}});
 function add(n=1,text='合成原文：采用新价格，运费沿用上次'){
  const original=new f.MaterialSource();Object.assign(original,{kind:'recording',name:'take-'+n.toString(16).padStart(32,'0'),started:DAY+n*1000,
   ended:DAY+n*1000+60000,complete:true,audioAvailable:false,audioBytes:0,audioFrames:3000,frameMs:20});
  const base=f.store.ensure(original),input=new f.MaterialTextInput();Object.assign(input,{text,channel:'mix',transcriptionState:'complete',coveredMs:60000,sourceMs:60000,speakerProcessing:'processed',boundaryProcessing:'token_starts'});
  input.utterances=[Object.assign(new f.MaterialUtterance(),{text,start_ms:0,end_ms:1000,speaker_id:base.material_id+'-s000000000000',speaker_basis:'segment_cluster'})];
  const head=f.store.appendTranscript(base.material_id,1,input,'synthetic-'+n),item={name:original.name,created:original.started,ended:original.ended,bytes:0,textFile:'legacy.md',complete:true};
  recordings.items.push(item);page.refresh();return{id:head.material_id,item,head};
 }
 function save(summary='合成已保存总结\n## 总结中的二级标题\n完整内容保留。',cache=false){
  const base=page.dayMarkdown(DAY,''),document=journal.bindJournalSummary(base,page.dayMarkdown(DAY,''),summary);
  const file=cache?journal.writeJournalFile(f.root,DAY,document.markdown):journal.writeJournalSnapshot(f.root,DAY,document.markdown);
  return{file,markdown:document.markdown,summary};
 }
 function open(){page.listSavedSummaries();const entry=page.savedSummaryPage?.items.find(value=>value.can_open);assert(entry,'real saved summary should be current');
  page.openSavedSummary(entry.reference);assert(page.savedSummaryDocument,page.savedSummaryNote);return clone(entry.reference);}
 const tree=()=>{const out=[];function walk(dir){for(const name of fs.readdirSync(dir)){const file=path.join(dir,name);if(fs.statSync(file).isDirectory())walk(file);else out.push([path.relative(f.root,file),digest(fs.readFileSync(file))]);}}walk(f.root);return out.sort();};
 return{...f,...saved,journal,page,recordings,lifelog,lifelogASR,materials,probe,calls,opened,summaryCalls,pickerWait,dialogs,toasts,add,save,open,tree,
  edit(id,text='更正后的完整原文'){const row=f.store.read(id);return f.store.correctText(id,row.revision,row.utterances[0].utterance_id,text);},
  failRead:id=>readFailure=id,failList:()=>listFailure=true,deferPicker:()=>deferred=true,onChunk:hook=>chunkHook=hook,
  sourceCalls:()=>sourceCalls};
}

test('normal saved-summary entry cold-reopens real immutable output with complete headings and without model or source writes',t=>{
 const f=fixture(t);f.add();const saved=f.save(),before=f.tree(),ordinary=[f.page.text,f.page.textKind,f.page.textName,f.page.textRevision];
 assert.equal(f.page.savedSummaryPage,undefined);f.open();assert.equal(f.page.savedSummaryDocument.summary_text,saved.summary);
 assert.equal(f.page.savedSummaryDocument.markdown,saved.markdown);assert.deepEqual([f.page.text,f.page.textKind,f.page.textName,f.page.textRevision],ordinary);
 assert.equal(f.page.savedSummaryDocument.producer,'unknown');assert.equal(f.page.savedSummaryDocument.generated_at,'');assert.match(f.page.savedSummaryNote,/生成时间和模型未知/);
 assert.deepEqual(f.tree(),before);assert.equal(f.calls.some(value=>typeof value==='string'&&value.startsWith('legacy-')),false);
 f.page.aboutToDisappear();assert.equal(f.page.savedSummaryDocument,undefined);f.page.visible=true;f.page.actionEpoch++;f.open();
 assert.equal(f.page.savedSummaryDocument.summary_text,saved.summary);assert.deepEqual(f.tree(),before);
});

test('saved summary, canonical keyword query and unrelated ordinary detail have independent state',t=>{
 const f=fixture(t);f.add();f.save();f.open();const document=f.page.savedSummaryDocument,summaryPage=f.page.savedSummaryPage;
 f.page.changeQueryKeyword('运费');f.page.searchLocal();assert(f.page.queryPage);const queryPage=f.page.queryPage;
 f.page.changeQuerySpeaker('unknown');assert.equal(f.page.savedSummaryDocument,document);assert.equal(f.page.savedSummaryPage,summaryPage);
 f.page.changeQuerySpeaker('');f.page.searchLocal();f.page.closeSavedSummaries();assert.equal(f.page.savedSummaryDocument,undefined);assert(f.page.queryPage);
 assert.equal(f.page.text,'ordinary detail B');assert.equal(queryPage.hits.length,1);f.open();f.page.clearLocalSearch();assert(f.page.savedSummaryDocument);
});

test('saved list pages explicitly, closes the prior summary body and refuses a stale directory cursor',t=>{
 const f=fixture(t);f.add();for(let n=0;n<12;n++)f.save('合成总结 '+n);
 f.page.listSavedSummaries();assert.equal(f.page.savedSummaryPage.items.length,10);assert.equal(f.page.savedSummaryPage.has_more,true);
 f.page.openSavedSummary(f.page.savedSummaryPage.items[0].reference);assert(f.page.savedSummaryDocument);const first=f.page.savedSummaryPage;
 f.page.listSavedSummaries(true);assert.equal(f.page.savedSummaryDocument,undefined);assert.equal(f.page.savedSummaryPage.items.length,2);
 assert(f.page.savedSummaryPage.items.every(entry=>!first.items.some(value=>value.reference.summary_id===entry.reference.summary_id)));
 f.page.listSavedSummaries();f.save('新增导致旧游标失效');f.page.listSavedSummaries(true);assert.equal(f.page.savedSummaryPage,undefined);assert.match(f.page.savedSummaryNote,/目录或来源已变化/);
});

test('mere capture and sync state notifications preserve an open summary without directory scans or full-day revalidation',t=>{
 const f=fixture(t);f.add();f.save();f.open();const document=f.page.savedSummaryDocument,list=f.page.savedSummaryPage,before=f.sourceCalls(),reads=f.summaryCalls.list;
 for(const phase of ['receiving','recording','stopping']){f.calls.length=0;f.lifelog.capturePhase=phase;f.lifelog.bytes+=240;f.recordings.items[0].bytes+=240;f.lifelogASR.progress+=10;f.page.refresh();
  assert.equal(f.page.savedSummaryDocument,document);assert.equal(f.page.savedSummaryPage,list);assert.equal(f.calls.includes('list-files'),false);
  assert.equal(f.calls.filter(value=>Array.isArray(value)&&value[0]==='canonical').length,1,'reuse existing refresh source read');}
 assert.equal(f.sourceCalls(),before);assert.equal(f.summaryCalls.list,reads);
});

test('canonical corrections, deletion, membership and read failures clear visible saved text instead of reviving a saved old body',async t=>{
 for(const change of ['edit','empty','delete','remove','add','read-failure'])await t.test(change,t=>{
  const f=fixture(t),a=f.add();f.save();f.open();
  if(change==='edit')f.edit(a.id);else if(change==='empty')f.edit(a.id,'');else if(change==='delete')f.store.delete(a.id,2);
  else if(change==='remove')f.recordings.items=[];else if(change==='add')f.add(2);else f.failRead(a.id);
  f.page.refresh();assert.equal(f.page.savedSummaryPage,undefined);assert.equal(f.page.savedSummaryDocument,undefined);assert.match(f.page.savedSummaryNote,/资料|读取/);
  f.page.listSavedSummaries();assert(f.page.savedSummaryPage.items.every(entry=>!entry.can_open));assert.equal(f.page.savedSummaryDocument,undefined);
  assert.equal(f.page.text,'ordinary detail B');assert.equal(f.calls.some(value=>typeof value==='string'&&value.startsWith('legacy-')),false);
 });
});

test('explicit refresh, edit callback, accepted delete, day change and leaving independently clear saved summary',async t=>{
 for(const action of ['refresh','edit','delete','day','leave'])await t.test(action,async t=>{
  const f=fixture(t),a=f.add();f.save();f.open();
  if(action==='refresh')f.page.refreshEntries();else if(action==='edit')f.page.selectedMaterialChanged(f.edit(a.id));
  else if(action==='delete'){f.page.confirmRemove(f.page.entries[0]);f.dialogs[0].secondaryButton.action();await finish(f.page);}
  else if(action==='day')f.page.selectDay(DAY+86400000);else f.page.aboutToDisappear();
  assert.equal(f.page.savedSummaryPage,undefined);assert.equal(f.page.savedSummaryDocument,undefined);assert.equal(f.page.savedSummaryDay,'');
 });
});

test('unverified, raw, stale, corrupt and unavailable entries are metadata only and never expose old summary text',t=>{
 const f=fixture(t),a=f.add();f.save('不应展示的旧总结',true);f.edit(a.id);f.page.listSavedSummaries();const stale=f.page.savedSummaryPage.items[0];
 assert.equal(stale.state,'stale');assert.equal('markdown'in stale,false);assert.equal('summary_text'in stale,false);assert.match(f.page.savedSummaryState(stale),/需重新生成/);
 f.page.openSavedSummary(stale.reference);assert.equal(f.page.savedSummaryDocument,undefined);assert.match(f.page.savedSummaryNote,/不会打开旧正文/);
 const cache=f.root+'/day-2026-10-15.md';fs.writeFileSync(cache,'# 2026-10-15 记录\n\n## AI 总结\n\n无来源旧总结\n');
 f.page.listSavedSummaries();assert.equal(f.page.savedSummaryPage.items[0].state,'unverifiable');assert.match(f.page.savedSummaryState(f.page.savedSummaryPage.items[0]),/无可验证/);
 fs.writeFileSync(cache,f.page.dayMarkdown(DAY,'').markdown);f.page.listSavedSummaries();assert.equal(f.page.savedSummaryPage.items[0].state,'not_summary');
 fs.writeFileSync(cache,Buffer.from([0xff]));f.page.listSavedSummaries();assert.equal(f.page.savedSummaryPage.items[0].state,'corrupt');
 f.failRead(a.id);f.page.listSavedSummaries();assert.equal(f.page.savedSummaryPage.incomplete,true);assert.match(f.page.savedSummaryCoverage(),/来源不可用|不可读取/);
 assert.equal(f.page.savedSummaryDocument,undefined);
});

test('open revalidates same-revision byte changes, missing artifacts and foreign references',async t=>{
 for(const change of ['same-revision','missing-file','foreign-ref'])await t.test(change,t=>{
  const f=fixture(t),a=f.add(),saved=f.save();f.page.listSavedSummaries();const ref=clone(f.page.savedSummaryPage.items[0].reference);
  if(change==='same-revision'){const file=f.root+'/materials/'+a.id+'/revision-000000002.json',row=f.store.read(a.id);row.text='同修订内容被改';row.utterances[0].text=row.text;fs.writeFileSync(file,JSON.stringify(row));}
  else if(change==='missing-file')fs.unlinkSync(saved.file);else ref.content_sha256='0'.repeat(64);
  f.page.openSavedSummary(ref);assert.equal(f.page.savedSummaryDocument,undefined);assert.equal(f.page.savedSummaryPage,undefined);assert.match(f.page.savedSummaryNote,/修改、删除或暂不可读/);
 });
});

test('saved export uses freshly verified immutable content and preserves ordinary detail and query',async t=>{
 const f=fixture(t);f.add();const saved=f.save('合成导出总结',true);f.open();f.page.changeQueryKeyword('运费');f.page.searchLocal();const query=f.page.queryPage;
 const ordinary=[f.page.text,f.page.textKind,f.page.textName,f.page.textRevision],before=f.summaryCalls.open;
 f.deferPicker();f.page.exportSavedSummary();await turn();assert.equal(f.pickerWait.length,1);
 const immutable=f.opened.filter(([file,mode])=>mode&1).map(([file])=>file).filter(file=>/day-.*[a-f0-9]{64}\.md\.partial$/.test(file));assert.equal(immutable.length,1);
 // copyOut receives the content-addressed snapshot, never the mutable cache.
 f.pickerWait.shift()([f.root+'/export.md']);await finish(f.page);
 assert.equal(fs.readFileSync(f.root+'/export.md','utf8'),saved.markdown);assert.equal(f.summaryCalls.open,before+2);
 assert.deepEqual([f.page.text,f.page.textKind,f.page.textName,f.page.textRevision],ordinary);assert.equal(f.page.queryPage,query);assert.match(f.page.savedSummaryNote,/已导出重新验证/);
});

test('source deletion, same-revision corruption, cache replacement, day/ref close, leave and background during picker refuse destination TRUNC',async t=>{
 for(const change of ['delete','same-revision','cache','day','close','leave','background'])await t.test(change,async t=>{
  const f=fixture(t),a=f.add();f.save('合成旧总结',true);f.open();fs.writeFileSync(f.root+'/export.md','KEEP DESTINATION');
  f.deferPicker();f.page.exportSavedSummary();await turn();assert.equal(f.pickerWait.length,1);
  if(change==='delete')f.store.delete(a.id,2);else if(change==='same-revision'){const file=f.root+'/materials/'+a.id+'/revision-000000002.json',row=f.store.read(a.id);row.text='外来同修订变更';row.utterances[0].text=row.text;fs.writeFileSync(file,JSON.stringify(row));}
  else if(change==='cache')fs.writeFileSync(f.root+'/day-2026-10-15.md',f.page.dayMarkdown(DAY,'').markdown);
  else if(change==='day')f.page.selectDay(DAY+86400000);else if(change==='close')f.page.closeSavedSummaries();else if(change==='leave')f.page.aboutToDisappear();else f.probe.foreground=false;
  f.pickerWait.shift()([f.root+'/export.md']);await finish(f.page);assert.equal(fs.readFileSync(f.root+'/export.md','utf8'),'KEEP DESTINATION');
  assert.equal(f.opened.some(([file,mode])=>file===f.root+'/export.md'&&(mode&4)),false,'must validate before destination open/TRUNC');
  assert.doesNotMatch(f.page.savedSummaryNote,/已导出/);assert.equal(f.page.text,'ordinary detail B');
 });
});

test('multi-chunk export stops after a source-change notification without repeating full-day validation per chunk',async t=>{
 const f=fixture(t),a=f.add();f.save('长总结'.repeat(100000));f.open();const before=f.summaryCalls.open;
 f.onChunk(()=>{f.edit(a.id);f.page.refresh();});f.page.exportSavedSummary();await finish(f.page);
 assert.equal(f.page.savedSummaryDocument,undefined);assert.equal(f.summaryCalls.open,before+2);assert.doesNotMatch(f.page.savedSummaryNote,/已导出/);
 const target=f.root+'/export.md';assert(fs.existsSync(target));assert(fs.statSync(target).size>0);assert(fs.statSync(target).size<Buffer.byteLength('长总结'.repeat(100000)));
});

test('unchanged long summary validates at initial open and picker return only, then copies the whole immutable snapshot',async t=>{
 const f=fixture(t);f.add();const saved=f.save('完整长总结'.repeat(70000));f.open();const before=f.summaryCalls.open;
 f.page.exportSavedSummary();await finish(f.page);assert.equal(f.summaryCalls.open,before+2);assert.equal(fs.readFileSync(f.root+'/export.md','utf8'),saved.markdown);
 assert.match(f.page.savedSummaryNote,/已导出/);
});

test('picker cancel and metadata-list failure do not generate summaries or write source data',async t=>{
 const f=fixture(t);f.add();f.save();f.open();const before=f.tree();f.deferPicker();f.page.exportSavedSummary();await turn();f.pickerWait.shift()([]);await finish(f.page);
 assert.match(f.page.savedSummaryNote,/已取消/);assert.deepEqual(f.tree(),before);f.failList();f.page.listSavedSummaries();assert.equal(f.page.savedSummaryPage.incomplete,true);
 assert.equal(f.page.savedSummaryDocument,undefined);assert.match(f.page.savedSummaryCoverage(),/不完整/);assert.deepEqual(f.tree(),before);
});

test('legacy copyOut default remains usable while an explicit failed guard never opens either file',async t=>{
 const f=fixture(t);const input=f.root+'/ordinary.md';fs.writeFileSync(input,'旧导出入口');assert.equal(await f.page.copyOut(input,'ordinary.md'),true);
 assert.equal(fs.readFileSync(f.root+'/export.md','utf8'),'旧导出入口');const count=f.opened.length;
 await assert.rejects(f.page.copyOut(input,'ordinary.md',()=>false),/导出条件已变化/);assert.equal(f.opened.length,count);
});

test('normal UI has separate explicit saved-summary controls and preserves snapshot-bound query row identity',()=>{
 assert.match(source,/this\.savedSummaryArea\(\)/);assert.match(source,/Button\('查看已保存'\)/);assert.match(source,/Button\('导出已保存总结'\)/);
 assert.match(source,/Text\(this\.savedSummaryDocument\.summary_text\)/);assert.match(source,/entry\.state==='current'&&entry\.can_open/);
 assert.match(source,/this\.queryPage\?\.snapshot_sha256\|\|''\)\+':'.*hit\.reference\.content_sha256/);
});
