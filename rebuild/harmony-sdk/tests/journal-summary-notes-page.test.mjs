import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {createHash,randomUUID} from 'node:crypto';
import {loadApp} from './load-app.mjs';
import {setupMaterialStore} from './material-fixture.mjs';

// Actual page methods and real note/summary cores, JournalExport, MaterialStore
// and D: files. Kit boundaries, UI/picker/clock are explicit substitutes. No
// HDC/device/model/network is used, and no pre-save cold durability is claimed.
const require=createRequire(import.meta.url),deveco=process.env.DEVECO_HOME||'D:/APP/DevEcoStudio';
const ts=require(`${deveco}/sdk/default/openharmony/ets/build-tools/ets-loader/node_modules/typescript`);
const source=fs.readFileSync(new URL('../entry/src/main/ets/pages/JournalPanel.ets',import.meta.url),'utf8');
const DAY=new Date(2026,9,15).getTime(),clone=value=>JSON.parse(JSON.stringify(value)),turn=()=>new Promise(setImmediate);
const hash=value=>createHash('sha256').update(value).digest('hex');
function method(name){
 const match=new RegExp(`^  (?:private )?(?:async )?${name}\\(`,'m').exec(source);assert(match,'actual page method missing: '+name);
 const after=source.slice(match.index+match[0].length),next=/\n  (?:private |aboutTo|@Builder|[A-Za-z][A-Za-z0-9_]*\()/.exec(after);
 assert(next,'actual page method boundary missing: '+name);return source.slice(match.index,match.index+match[0].length+next.index);
}
async function finish(page){for(let at=0;at<300&&page.busy;at++)await new Promise(resolve=>setTimeout(resolve,5));assert.equal(page.busy,false);}
function fixture(t){
 const f=setupMaterialStore(t);assert.match(path.resolve(f.root),/^[Dd]:[\\/]/);
 f.io.lstatSync=p=>{const value=fs.lstatSync(p);return Object.assign(value,{mtime:value.mtimeMs,ctime:value.ctimeMs});};
 const playbackCalls=[],localPlayback={snapshot:()=>({}),subscribe:()=>()=>{playbackCalls.push('unsubscribe');},suspend:reason=>{playbackCalls.push(['suspend',reason]);return Promise.resolve({});},stopSource:(kind,name)=>{playbackCalls.push(['stop-source',kind,name]);return Promise.resolve({});}};
 const calls=[],opened=[],descriptors=new Map(),dialogs=[],pickerWait=[],toasts=[],captured=[];
 let deferred=false,fault='',readFailure='',afterCommit,chunkHook,page,core,notesCore,Page;
 const nativeIO={OpenMode:{CREATE:1,WRITE_ONLY:2,TRUNC:4,READ_ONLY:8},accessSync:fs.existsSync,lstatSync:fs.lstatSync,
  statSync:value=>typeof value==='number'?fs.fstatSync(value):fs.statSync(value),mkdirSync:p=>fs.mkdirSync(p),
  listFileSync(p){calls.push(['list',p]);return fs.readdirSync(p);},readTextSync:p=>fs.readFileSync(p,'utf8'),
  openSync(p,mode){if(fault==='open'&&p.endsWith('/pending.json')&&!(mode&8))throw Error('synthetic private path must not leak');
   opened.push([p,mode]);const fd=fs.openSync(p,mode&8?'r':mode&5?'w':'r+');descriptors.set(fd,p);return{fd};},
  closeSync:file=>{const fd=typeof file==='number'?file:file.fd;descriptors.delete(fd);fs.closeSync(fd);},
  readSync:(fd,buffer,options)=>fs.readSync(fd,new Uint8Array(buffer),0,Math.min(options?.length??buffer.byteLength,117),null),
  writeSync:(fd,buffer)=>{if(fault==='write'&&descriptors.get(fd)?.endsWith('/pending.json'))return 0;
   const bytes=new Uint8Array(buffer);return fs.writeSync(fd,bytes,0,Math.min(bytes.length,4093),null);},
  fsyncSync(fd){if(fault==='fsync'&&descriptors.get(fd)?.endsWith('/pending.json'))throw Error('synthetic secret fsync failure');fs.fsyncSync(fd);},
  renameSync(from,to){if(from.endsWith('/pending.json')&&fault==='rename')throw Error('synthetic rename refusal');fs.renameSync(from,to);
   if(from.endsWith('/pending.json')&&fault==='rename-after')throw Error('synthetic throw after committed rename');}};
 const util={generateRandomUUID:randomUUID,TextEncoder:class{encodeInto(text){return new TextEncoder().encode(text);}},TextDecoder:class{
  constructor(encoding,options){this.decoder=new TextDecoder(encoding,options);}decodeToString(bytes){return this.decoder.decode(bytes);}}};
 const platform={'@kit.CoreFileKit':{fileIo:nativeIO},'@kit.ArkTS':{util},
  './LifelogSession':{LifelogDayText:class{markdown='';total=0;transcribed=0;}},'./RecordingSession':{}};
 const journal=loadApp('JournalExport',platform),saved=loadApp('SavedJournalSummary',platform),query=loadApp('MaterialLocalQuery',platform);
 let notes=loadApp('JournalSummaryNotes',platform);
 const recordings={items:[],changed(){},active:false,stopping:false,refresh(){},textPath(){calls.push('legacy');return f.root+'/forbidden.md';}},
  lifelog={items:[],changed(){},rootPath:()=>f.root,note:'capture state',active:false,dayEnabled:false,bytes:0,emptySegments:0,capturePhase:'idle',
   refresh(){},readTranscriptJson(){calls.push('legacy');return'';}},lifelogASR={busy:false,progress:0,changed(){},initialize(){}};
 const materials={idFor:(...args)=>f.store.idFor(...args),ids:()=>f.store.ids(),queryCatalog:()=>f.store.queryCatalog(),read(id){calls.push(['canonical',id]);if(id===readFailure)throw Error('synthetic private source unreadable');return f.store.read(id);}};
 function remove(item){const id=f.store.idFor('recording',item.name),head=f.store.read(id);f.store.delete(id,head.revision);recordings.items=recordings.items.filter(value=>value.name!==item.name);}
 recordings.remove=remove;
 const summaryCalls={list:0,open:0},noteCalls={save:0,resume:0,inspect:0,pending:0,list:0,open:0,export:0};
 const summaries={list(filter){summaryCalls.list++;return core.list(filter);},open(ref){summaryCalls.open++;return core.open(ref);}};
 const singleton={save(input){noteCalls.save++;captured.push(clone(input));const receipt=notesCore.save(input);if(afterCommit){const hook=afterCommit;afterCommit=undefined;hook();}return receipt;},
  resume(input){noteCalls.resume++;captured.push(clone(input));return notesCore.resume(input);},inspect(op){noteCalls.inspect++;return notesCore.inspect(op);},
  pendingInput(op,digest){noteCalls.pending++;return notesCore.pendingInput(op,digest);},list(filter){noteCalls.list++;return notesCore.list(filter);},
  open(ref){noteCalls.open++;return notesCore.open(ref);},exportSnapshot(ref,format){noteCalls.export++;return notesCore.exportSnapshot(ref,format);}};
 const picker={DocumentViewPicker:class{save(){calls.push('picker');return deferred?new Promise(resolve=>pickerWait.push(resolve)):Promise.resolve([f.root+'/export-target']);}}},probe={foreground:true};
 const methods=['restoreNoteEditor','startSummaryNote','validNoteText','changeNoteEditor','discardNoteEditor','saveSummaryNote','inspectSummaryNote',
  'restorePendingNote','noteReceiptLabel','noteSavedTime','closeSavedNotes','listSummaryNotes','noteCoverage','openSavedNote','exportSummaryNote',
  'closeSavedSummaries','listSavedSummaries','openSavedSummary','exportSavedSummary','copyOut','run','stamp','sources','dayMarkdown','refresh','recount','atDay',
  'selectDay','invalidateLocalSearch','changeQueryKeyword','changeQuerySpeaker','clearLocalSearch','searchLocal','localQuery','refreshEntries','selectedMaterialChanged',
  'confirmRemove','clearDeletedSelection','aboutToAppear','aboutToDisappear'];
 const begin=source.indexOf('class JournalEntry {'),end=source.indexOf('\n@Component',begin);
 const code=ts.transpileModule(source.slice(begin,end)+`\nclass Page {\n${methods.map(method).join('\n')}\n}\nmodule.exports=Page;`,
  {compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS}}).outputText;
 function evaluate(){const module={exports:{}};
  vm.runInNewContext(code,{...journal,...saved,...notes,...query,module,exports:module.exports,localPlayback,fs:nativeIO,picker,util,
   savedJournalSummaries:summaries,journalSummaryNotes:singleton,recordings,lifelog,lifelogASR,materials,probeSession:probe,
   LifelogSession:{dayStart:()=>DAY},voices:{initialize(){},ordered:()=>[]},Map,Date,JSON,Error,ArrayBuffer,Uint8Array,Promise,
   cryptoFramework:{createMd:()=>{const digest=createHash('sha256');return{updateSync:value=>digest.update(value.data),digestSync:()=>({data:Uint8Array.from(digest.digest())})};}},
   materialSyncService:{view:()=>({state:'local',storedRevision:0})},localQueueSize:()=>0,localCurrentDirectory:()=>'',localQueuedDirectories:()=>[],
   cancelRecordingCloudTranscription(){},cancelLifelogManualPublication(){},
   setTimeout(callback,ms){return setTimeout(()=>{if(chunkHook){const hook=chunkHook;chunkHook=undefined;hook();}callback();},ms);}});Page=module.exports;}
 function mount(cold=false){if(cold||!Page)evaluate();page=new Page();Object.assign(page,{playbackUnsubscribe(){playbackCalls.push('unsubscribe');},visible:false,actionEpoch:1,busy:false,selected:DAY,calBase:DAY,note:'ordinary note',entries:[],dayKeys:new Map(),
  queryKeyword:'',querySpeaker:'',queryPage:undefined,querySignature:'',querySourcesSignature:'',queryCheckedRaw:new Map(),queryOpenedKey:'',queryNote:'',
  savedSummaryPage:undefined,savedSummaryDocument:undefined,savedSummaryDay:'',savedSummaryGeneration:0,savedSummaryNote:'',
  savedNotePage:undefined,savedNoteDocument:undefined,savedNoteReceipt:undefined,savedNoteDay:'',savedNoteGeneration:0,savedNoteNote:'',
  noteEditorText:'',noteEditorDay:'',noteEditorOperation:'',noteEditorReady:false,noteEditorLocked:false,noteEditorNote:'',
  text:'ordinary B',textKind:'recording',textName:'unrelated-B',textRevision:17,textNeedsFull:false,fullText:true,
  syncSchedule(){},collectPendingVoices(){},vault:{load:()=>Promise.resolve({})},
  getUIContext:()=>({getHostContext:()=>({filesDir:f.root}),showAlertDialog:value=>dialogs.push(value),getPromptAction:()=>({showToast:value=>toasts.push(value.message)})})});
  if(cold){notes=loadApp('JournalSummaryNotes',platform);notesCore=new notes.JournalSummaryNotes({root:()=>f.root,summaries:core,
   freeze:(day,md)=>journal.writeJournalSnapshot(f.root,day,md),now:()=>new Date('2026-10-16T03:04:05.000Z').getTime()});}
  page.aboutToAppear();return page;}
 mount();core=new saved.SavedJournalSummary({root:()=>f.root,current:day=>page.dayMarkdown(day,'')});
 notesCore=new notes.JournalSummaryNotes({root:()=>f.root,summaries:core,freeze:(day,md)=>journal.writeJournalSnapshot(f.root,day,md),now:()=>new Date('2026-10-16T03:04:05.000Z').getTime()});
 function add(n=1){const original=new f.MaterialSource();Object.assign(original,{kind:'recording',name:'take-'+n.toString(16).padStart(32,'0'),started:DAY+n*1000,ended:DAY+n*1000+60000,
  complete:true,audioAvailable:false,audioBytes:0,audioFrames:3000,frameMs:20});const base=f.store.ensure(original),input=new f.MaterialTextInput();
  Object.assign(input,{text:'合成原文：采用新价格',channel:'mix',transcriptionState:'complete',coveredMs:60000,sourceMs:60000,speakerProcessing:'processed',boundaryProcessing:'token_starts'});
  input.utterances=[Object.assign(new f.MaterialUtterance(),{text:input.text,start_ms:0,end_ms:1000,speaker_id:base.material_id+'-s000000000000',speaker_basis:'segment_cluster'})];
  const head=f.store.appendTranscript(base.material_id,1,input,'synthetic-'+n),item={name:original.name,created:original.started,ended:original.ended,bytes:0,textFile:'legacy.md',complete:true};
  recordings.items.push(item);page.refresh();return{id:head.material_id,item,head};}
 function summary(text='合成AI正文\n## AI内部标题\n完整保留',cache=true){const base=page.dayMarkdown(DAY,''),document=journal.bindJournalSummary(base,page.dayMarkdown(DAY,''),text);
  const file=cache?journal.writeJournalFile(f.root,DAY,document.markdown):journal.writeJournalSnapshot(f.root,DAY,document.markdown);page.listSavedSummaries();
  const entry=page.savedSummaryPage.items.find(value=>value.can_open);assert(entry);page.openSavedSummary(entry.reference);assert(page.savedSummaryDocument);return{file,document,reference:clone(entry.reference)};}
 function draft(text='  人工补充：运费沿用上次。\n第二行保持。  '){page.startSummaryNote();page.changeNoteEditor(text);assert.equal(page.noteEditorText,text);return page.noteEditorOperation;}
 function note(text){draft(text);page.saveSummaryNote();assert(page.savedNoteDocument,page.savedNoteNote+' '+page.noteEditorNote);return clone(page.savedNoteDocument.reference);}
 const tree=()=>{const out=[];function walk(dir){for(const name of fs.readdirSync(dir)){const file=path.join(dir,name);if(fs.statSync(file).isDirectory())walk(file);else out.push([path.relative(f.root,file),hash(fs.readFileSync(file))]);}}walk(f.root);return out.sort();};
 return{...f,...saved,...notes,journal,get page(){return page;},recordings,lifelog,lifelogASR,probe,calls,opened,dialogs,pickerWait,captured,summaryCalls,noteCalls,
  add,summary,draft,note,tree,mount,core:()=>notesCore,setFault:value=>fault=value,deferPicker:()=>deferred=true,onChunk:hook=>chunkHook=hook,afterCommit:hook=>afterCommit=hook,
  failRead:id=>readFailure=id,edit(id,text='更正后的原文'){const row=f.store.read(id);return f.store.correctText(id,row.revision,row.utterances[0].utterance_id,text);}};
}

test('explicit normal-page save creates a separate user version, cold-reopens and leaves AI source bytes, ordinary detail and query intact',t=>{
 const f=fixture(t);f.add();const summary=f.summary(),original=fs.readFileSync(summary.file),text='  人工补充\n## 自己写的标题\n全部保留。  ';
 f.page.changeQueryKeyword('新价格');f.page.searchLocal();const query=f.page.queryPage;f.draft(text);assert.match(f.page.noteEditorOperation,/^noteop-2026-10-15-[a-f0-9]{32}$/);
 const op=f.page.noteEditorOperation;f.page.saveSummaryNote();const document=f.page.savedNoteDocument;assert(document,f.page.savedNoteNote+' '+f.page.noteEditorNote);
 assert.equal(document.record.text,text);assert.equal(document.record.producer,'user_note');assert.equal(document.record.parent.summary_id,summary.reference.summary_id);
 assert.notEqual(document.record.origin.summary_id,summary.reference.summary_id);assert.equal(document.summary.summary_text,'合成AI正文\n## AI内部标题\n完整保留');
 assert.equal(f.page.noteEditorText,'');assert.equal(f.page.queryPage,query);assert.equal(f.page.text,'ordinary B');assert.deepEqual(fs.readFileSync(summary.file),original);
 const ref=clone(document.reference),snapshot=f.tree();f.page.aboutToDisappear();f.mount(true);assert.equal(f.page.noteEditorText,'');f.page.listSummaryNotes();
 assert.equal(f.page.savedNotePage.items[0].operation_id,op);f.page.openSavedNote(ref);assert.equal(f.page.savedNoteDocument.record.text,text);assert.deepEqual(f.tree(),snapshot);
});

test('unsubmitted typing survives actual component replacement and date/close/list operations, but is not claimed durable across a cold process',t=>{
 const f=fixture(t);f.add();f.summary();const op=f.draft('未点击保存的完整输入'),before=f.tree();f.page.closeSavedSummaries();f.page.closeSavedNotes();f.page.selectDay(DAY+86400000);
 assert.equal(f.page.noteEditorText,'未点击保存的完整输入');assert.equal(f.page.noteEditorDay,'2026-10-15');f.page.listSummaryNotes();assert.equal(f.page.noteEditorOperation,op);
 f.page.aboutToDisappear();f.mount();assert.equal(f.page.noteEditorText,'未点击保存的完整输入');assert.equal(f.page.noteEditorOperation,op);assert.equal(f.noteCalls.save,0);assert.deepEqual(f.tree(),before);
 f.mount(true);assert.equal(f.page.noteEditorReady,false);assert.equal(f.page.noteEditorText,'');assert.deepEqual(f.tree(),before);
});

test('another summary, source changes and failed save cannot silently replace or trim the bound editor input',t=>{
 const f=fixture(t),a=f.add();f.summary();const text='  保留全文\n不准丢弃  ',op=f.draft(text);f.page.startSummaryNote();assert.equal(f.page.noteEditorOperation,op);
 f.edit(a.id);f.page.refresh();assert.equal(f.page.savedSummaryDocument,undefined);assert.equal(f.page.noteEditorText,text);f.page.saveSummaryNote();
 assert.equal(f.page.noteEditorText,text);assert.equal(f.page.noteEditorOperation,op);assert.equal(f.page.noteEditorLocked,true);assert.equal(f.page.savedNoteDocument,undefined);
 assert.doesNotMatch(f.page.noteEditorNote,/新版本已保存/);f.page.changeNoteEditor('不能复用同op更改正文');assert.equal(f.page.noteEditorText,text);
 f.page.inspectSummaryNote();assert.equal(f.noteCalls.resume,0);assert.equal(f.page.noteEditorText,text);assert.doesNotMatch(f.page.savedNoteNote,/synthetic|private/);
});

test('explicit discard needs a current dialog and keeps any reserved or pending disk evidence',t=>{
 const f=fixture(t);f.add();f.summary();f.draft('待处理输入');f.setFault('rename');f.page.saveSummaryNote();f.setFault('');const before=f.tree(),op=f.page.noteEditorOperation;
 f.page.discardNoteEditor();f.dialogs[0].primaryButton.action();assert.equal(f.page.noteEditorOperation,op);f.page.discardNoteEditor();f.dialogs[1].secondaryButton.action();
 assert.equal(f.page.noteEditorText,'');assert.equal(f.page.noteEditorReady,false);assert.deepEqual(f.tree(),before);assert.equal(f.core().inspect(op).state,'pending');
 f.page.startSummaryNote();f.page.changeNoteEditor('新草稿');assert.notEqual(f.page.noteEditorOperation,op);assert.deepEqual(f.tree(),before);
});

test('save-stage IO failures retain exact full input and operation while never claiming success',async t=>{
 for(const stage of ['open','write','fsync','rename','rename-after'])await t.test(stage,t=>{
  const f=fixture(t);f.add();f.summary();const text='  故障时全文\n仍要保留🙂  ',op=f.draft(text);f.setFault(stage);f.page.saveSummaryNote();f.setFault('');
  assert.equal(f.page.noteEditorText,text);assert.equal(f.page.noteEditorOperation,op);assert.equal(f.page.noteEditorLocked,true);assert.equal(f.page.savedNoteDocument,undefined);
  assert.doesNotMatch(f.page.savedNoteNote+f.page.noteEditorNote,/synthetic|secret|private path|已同步/);f.page.inspectSummaryNote();
  assert.equal(f.page.noteEditorText,text);assert.equal(f.noteCalls.resume,0);assert.equal(f.page.savedNoteReceipt.state,stage==='rename-after'?'saved':stage==='rename'||stage==='fsync'?'pending':stage==='write'?'corrupt':'reserved');
 });
});

test('cold complete pending is only read back after inspection, then explicitly resumed with the same full input and timestamp',t=>{
 const f=fixture(t);f.add();f.summary();const text='  等待明确续完的文字🙂\n保持两行  ',op=f.draft(text);f.setFault('rename');f.page.saveSummaryNote();f.setFault('');
 const receipt=f.core().inspect(op);assert.equal(receipt.state,'pending');const before=f.tree();f.mount(true);assert.equal(f.page.noteEditorReady,false);
 f.page.listSummaryNotes();f.page.restorePendingNote(op,receipt.input_sha256);assert.equal(f.page.noteEditorText,text);assert.equal(f.page.noteEditorLocked,true);assert.equal(f.noteCalls.resume,0);
 assert.equal(f.page.savedNoteDocument,undefined);assert.deepEqual(f.tree(),before);f.page.saveSummaryNote(true);assert.equal(f.noteCalls.resume,1);
 assert.equal(f.page.savedNoteDocument.record.text,text);assert.equal(f.page.savedNoteDocument.record.created_at,'2026-10-16T03:04:05.000Z');
 assert.equal(f.page.savedNoteDocument.record.operation_id,op);assert.deepEqual(f.captured.at(-1),f.captured[0]);assert.equal(f.page.noteEditorText,'');
});

test('pending read refuses stale source, foreign hashes and replacement of another current input without submitting anything',async t=>{
 for(const failure of ['source','hash','occupied'])await t.test(failure,t=>{
  const f=fixture(t),a=f.add();f.summary();const op=f.draft('旧待续文字');f.setFault('rename');f.page.saveSummaryNote();f.setFault('');const receipt=f.core().inspect(op);
  f.mount(true);if(failure==='source')f.edit(a.id);f.page.listSummaryNotes();if(failure==='occupied'){f.summary();f.draft('另一份未提交输入');}
  f.page.restorePendingNote(op,failure==='hash'?'0'.repeat(64):receipt.input_sha256);assert.equal(f.page.noteEditorText,failure==='occupied'?'另一份未提交输入':'');
  assert.equal(f.noteCalls.resume,0);assert.equal(f.page.savedNoteDocument,undefined);
 });
});

test('editing a saved note uses immutable origin and previous ref after the original cache has been replaced',t=>{
 const f=fixture(t);f.add();const saved=f.summary(),first=f.note('第一版人工说明'),firstBytes=fs.readFileSync(saved.file),old=f.page.savedNoteDocument;
 fs.writeFileSync(saved.file,f.page.dayMarkdown(DAY,'').markdown);f.page.startSummaryNote(true);assert.equal(f.page.noteEditorText,'第一版人工说明');f.page.changeNoteEditor('第二版人工说明');f.page.saveSummaryNote();
 const current=f.page.savedNoteDocument;assert(current,f.page.noteEditorNote);assert.deepEqual(clone(current.record.previous),first);
 assert.deepEqual(clone(current.record.parent),clone(old.record.origin));assert.deepEqual(clone(current.record.origin),clone(old.record.origin));assert.notDeepEqual(clone(current.reference),first);
 assert.equal(f.core().open(first).record.text,'第一版人工说明');assert.equal(current.record.text,'第二版人工说明');assert.notDeepEqual(fs.readFileSync(saved.file),firstBytes);
});

test('capture state callbacks keep saved notes with only the existing canonical read, while real source changes clear saved bodies and retain process input',t=>{
 const f=fixture(t),a=f.add();f.summary();const reference=f.note('已保存说明');f.page.listSummaryNotes();f.page.openSavedNote(reference);const page=f.page.savedNotePage,document=f.page.savedNoteDocument;
 f.page.startSummaryNote(true);f.page.changeNoteEditor('还没保存的更改');const before=f.noteCalls.list,opens=f.noteCalls.open;f.calls.length=0;
 f.lifelog.bytes+=240;f.lifelog.capturePhase='receiving';f.lifelogASR.progress=25;f.page.refresh();assert.equal(f.page.savedNotePage,page);assert.equal(f.page.savedNoteDocument,document);
 assert.equal(f.noteCalls.list,before);assert.equal(f.noteCalls.open,opens);assert.equal(f.calls.filter(value=>Array.isArray(value)&&value[0]==='canonical').length,1);
 assert.equal(f.calls.some(value=>Array.isArray(value)&&value[0]==='list'),false);f.edit(a.id);f.page.refresh();assert.equal(f.page.savedNoteDocument,undefined);
 assert.equal(f.page.savedNotePage,undefined);assert.equal(f.page.noteEditorText,'还没保存的更改');
});

test('saved-note pagination has no body, refuses stale cursors and never consumes the separate editor or ordinary summary/query',t=>{
 const f=fixture(t);f.add();f.summary();for(let n=0;n<11;n++)f.note('人工版本 '+n);f.draft('分页期间保留的输入');const text=f.page.noteEditorText;
 f.page.listSummaryNotes();assert.equal(f.page.savedNotePage.items.length,10);assert(f.page.savedNotePage.has_more);assert(f.page.savedNotePage.items.every(value=>!('text'in value)&&!('record'in value)));
 f.page.listSummaryNotes(true);assert.equal(f.page.savedNotePage.items.length,1);assert.equal(f.page.noteEditorText,text);assert.equal(f.page.text,'ordinary B');assert(f.page.savedSummaryDocument);
 f.page.listSummaryNotes();const pending=f.page.noteEditorOperation;f.setFault('rename');f.page.saveSummaryNote();f.setFault('');assert.equal(f.core().inspect(pending).state,'pending');
 f.page.listSummaryNotes(true);assert.equal(f.page.savedNotePage,undefined);assert.equal(f.page.noteEditorText,text);
});

test('MD and JSON normal exports contain clearly separate saved user text and original summary, preserve input and use immutable note-owned snapshots',async t=>{
 for(const format of ['md','json'])await t.test(format,async t=>{
  const f=fixture(t);f.add();const summary=f.summary(),original=fs.readFileSync(summary.file),ref=f.note('  完整人工说明🙂\n第二行  '),document=f.page.savedNoteDocument;
  f.page.startSummaryNote(true);f.page.changeNoteEditor('未提交的新输入不得混入导出');const draft=f.page.noteEditorText;
  const before=f.noteCalls.open;f.page.exportSummaryNote(format);await finish(f.page);const actual=fs.readFileSync(f.root+'/export-target','utf8');
  assert.equal(actual,format==='md'?document.markdown:document.structured_json);assert(!actual.includes(draft));assert.equal(f.page.noteEditorText,draft);assert.deepEqual(fs.readFileSync(summary.file),original);
  assert.equal(f.noteCalls.open,before+2,'UI opens before picker and once after picker, not for every copy chunk');assert.equal(f.noteCalls.export,1);
  const snapshot=f.opened.find(([file,mode])=>(mode&1)&&file.includes('/summary-note-')&&file.endsWith('.partial'));assert(snapshot);assert(snapshot[0].includes('/summary-notes-v1/2026-10-15/'));
  if(format==='json'){const parsed=JSON.parse(actual);assert.equal(parsed.kind,'summary_user_note');assert.equal(parsed.record.text,document.record.text);assert.equal(parsed.summary.summary_text,document.summary.summary_text);assert.deepEqual(parsed.reference,ref);}
  else{assert(actual.includes(document.summary.markdown));assert(actual.includes(document.record.text));assert.match(actual,/人工附注/);}
 });
});

test('source changes, note tampering, day/close/leave/background while picker waits reject before target TRUNC and preserve the process editor',async t=>{
 for(const change of ['source','note-bytes','day','close','leave','background'])await t.test(change,async t=>{
  const f=fixture(t),a=f.add();f.summary();const ref=f.note('保存的原说明');f.page.startSummaryNote(true);f.page.changeNoteEditor('等待期间保留输入');const text=f.page.noteEditorText;
  fs.writeFileSync(f.root+'/export-target','KEEP');f.deferPicker();f.page.exportSummaryNote('json');await turn();assert.equal(f.pickerWait.length,1);
  if(change==='source')f.edit(a.id);else if(change==='note-bytes'){const op=f.page.savedNoteDocument.record.operation_id,file=f.root+'/summary-notes-v1/2026-10-15/'+op+'/note.json';fs.appendFileSync(file,' ');}
  else if(change==='day')f.page.selectDay(DAY+86400000);else if(change==='close')f.page.closeSavedNotes();else if(change==='leave')f.page.aboutToDisappear();else f.probe.foreground=false;
  f.pickerWait.shift()([f.root+'/export-target']);await finish(f.page);assert.equal(fs.readFileSync(f.root+'/export-target','utf8'),'KEEP');
  assert.equal(f.opened.some(([file,mode])=>file===f.root+'/export-target'&&(mode&4)),false);assert.equal(f.page.noteEditorText,text);assert.doesNotMatch(f.page.savedNoteNote,/已导出/);
 });
});

test('empty, malformed and oversized text are rejected without truncation or persistence and original process input survives',t=>{
 const f=fixture(t);f.add();f.summary();f.page.startSummaryNote();f.page.changeNoteEditor('   ');f.page.saveSummaryNote();assert.equal(f.noteCalls.save,0);
 f.page.changeNoteEditor('已有完整文字');const op=f.page.noteEditorOperation;for(const bad of ['x'.repeat(8193),'坏\ud800','\udc00']){f.page.changeNoteEditor(bad);assert.equal(f.page.noteEditorText,'已有完整文字');assert.equal(f.page.noteEditorOperation,op);}
 assert.equal(f.noteCalls.save,0);assert.equal(fs.existsSync(f.root+'/summary-notes-v1'),false);
});

test('a stale discard dialog cannot remove subsequently edited input, and a save receipt cannot clear a newer explicit draft',t=>{
 const f=fixture(t);f.add();f.summary();f.draft('最初输入');f.page.discardNoteEditor();f.page.changeNoteEditor('弹窗期间更改后的输入');f.dialogs[0].secondaryButton.action();
 assert.equal(f.page.noteEditorText,'弹窗期间更改后的输入');const op=f.page.noteEditorOperation;
 f.afterCommit(()=>{f.page.discardNoteEditor();f.dialogs.at(-1).secondaryButton.action();f.page.startSummaryNote();f.page.changeNoteEditor('已明确开始的更新草稿');});
 f.page.saveSummaryNote();assert.equal(f.page.noteEditorText,'已明确开始的更新草稿');assert.notEqual(f.page.noteEditorOperation,op);
 assert.equal(f.core().inspect(op).state,'saved');assert.equal(f.page.savedNoteDocument.record.text,'弹窗期间更改后的输入');
});

test('long note export stops at a real source-change notification using bounded light chunk checks',async t=>{
 const f=fixture(t),a=f.add();f.summary('长AI正文'.repeat(70000));f.note('保存的人工说明');f.page.startSummaryNote(true);f.page.changeNoteEditor('未提交输入保持');
 const before=f.noteCalls.open;f.onChunk(()=>{f.edit(a.id);f.page.refresh();});f.page.exportSummaryNote('md');await finish(f.page);
 assert.equal(f.noteCalls.open,before+2);assert.equal(f.page.savedNoteDocument,undefined);assert.equal(f.page.noteEditorText,'未提交输入保持');
 assert.doesNotMatch(f.page.savedNoteNote,/已导出/);const size=fs.statSync(f.root+'/export-target').size;assert(size>0&&size<Buffer.byteLength('长AI正文'.repeat(70000)));
});

test('saved-note versions use actual record time in the local timezone, with no guessed time for incomplete records',t=>{
 const f=fixture(t);f.add();f.summary();const reference=f.note('版本时间测试');f.page.listSummaryNotes();const receipt=f.page.savedNotePage.items.find(value=>value.reference?.note_id===reference.note_id);
 assert.equal(receipt.created_at,'2026-10-16T03:04:05.000Z');
 f.page.openSavedNote(reference);assert(f.page.savedNoteDocument);f.page.startSummaryNote(true);f.page.changeNoteEditor('占位但没有完整记录');f.setFault('open');f.page.saveSummaryNote();f.setFault('');f.page.inspectSummaryNote();
 assert.equal(f.page.savedNoteReceipt.state,'reserved');assert.equal(f.page.savedNoteReceipt.created_at,'');assert.equal(f.page.noteSavedTime(f.page.savedNoteReceipt.created_at),'记录时间未知');
 const previous=process.env.TZ,originalZone=Intl.DateTimeFormat().resolvedOptions().timeZone;
 try{
  process.env.TZ='Asia/Shanghai';assert.equal(f.page.noteSavedTime(receipt.created_at),'记录时间：2026-10-16 11:04:05');
  process.env.TZ='Etc/GMT+5';assert.equal(f.page.noteSavedTime(receipt.created_at),'记录时间：2026-10-15 22:04:05');
 }finally{if(previous===undefined){process.env.TZ=originalZone;delete process.env.TZ;}else process.env.TZ=previous;}
 for(const missing of ['',undefined,'not-a-time','2026-02-30T03:04:05.000Z','noteop-2026-10-15-'+'a'.repeat(32)])assert.equal(f.page.noteSavedTime(missing),'记录时间未知');
});

test('UI exposes explicit local-only save/status/recovery/export controls and restores process state from actual appearance without automatic save',()=>{
 assert.match(method('aboutToAppear'),/this\.restoreNoteEditor\(\)/);assert.doesNotMatch(method('aboutToAppear'),/journalSummaryNotes\.|saveSummaryNote\(/);
 assert.match(source,/附注仅保存在本机/);assert.match(source,/未提交的人工附注/);assert.match(source,/Button\('续完这次保存'\)/);assert.match(source,/Button\('恢复未完成附注'\)/);
 assert.match(source,/this\.summaryNotesArea\(\)/);assert.match(source,/document\.record\.origin/);assert.match(source,/this\.savedNoteDocument\.summary\.summary_text/);
 assert.match(source,/if\(this\.noteEditorLocked\)\{\s*Text\(this\.noteEditorText\).*copyOption/);
 assert.match(source,/最多约8千字，超限保留原输入/);assert.doesNotMatch(source,/Text\(receipt\.operation_id\)|Text\(this\.noteEditorOperation\)|UTF16/);
 assert.match(source,/Text\(this\.noteSavedTime\(receipt\.created_at\)\)/);assert.match(source,/this\.noteSavedTime\(this\.savedNoteDocument\.record\.created_at\)/);
});
