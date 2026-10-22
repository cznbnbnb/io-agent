import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {loadApp} from './load-app.mjs';
import {setupMaterialStore} from './material-fixture.mjs';

const require=createRequire(import.meta.url),deveco=process.env.DEVECO_HOME||'D:/APP/DevEcoStudio';
const ts=require(`${deveco}/sdk/default/openharmony/ets/build-tools/ets-loader/node_modules/typescript`);
const source=fs.readFileSync(new URL('../entry/src/main/ets/pages/JournalPanel.ets',import.meta.url),'utf8');
const DAY=new Date(2026,9,16).getTime(),turn=()=>new Promise(setImmediate);
function method(name){const match=new RegExp(`^  (?:private )?(?:async )?${name}\\(`,'m').exec(source);assert(match,'actual page method missing: '+name);
 const after=source.slice(match.index+match[0].length),next=/\n  (?:private |aboutTo|@Builder|[A-Za-z][A-Za-z0-9_]*\()/.exec(after);assert(next);return source.slice(match.index,match.index+match[0].length+next.index);}
async function finish(page){for(let at=0;at<250&&page.busy;at++)await new Promise(resolve=>setTimeout(resolve,5));assert.equal(page.busy,false,'page export action must settle');}

// Real canonical revisions, real JournalExport writer, actual page copyOut and
// D: IO. The system picker, model response and UI shell are controlled ports.
// This verifies neither native picker layout nor real network/model output.
function fixture(t,{large=false}={}){
 const cleanups=[],f=setupMaterialStore({after:callback=>cleanups.push(callback)}),descriptors=new Map();assert.match(path.resolve(f.root),/^[Dd]:[\\/]/);
 t.after(()=>{for(const fd of descriptors.keys())try{fs.closeSync(fd);}catch{}descriptors.clear();for(const cleanup of cleanups)cleanup();});
 const journalRoot=f.root+'/journals';fs.mkdirSync(journalRoot);
 Object.assign(f.source,{started:DAY+1000,ended:DAY+61000,audioAvailable:false,audioBytes:0});
 f.input.text=large?'合成长原文，末尾不得丢弃。'.repeat(8000)+'SOURCE TAIL':f.input.text;
 if(large){const template=f.input.utterances[0];f.input.utterances=[];for(let at=0;at<f.input.text.length;at+=20000)f.input.utterances.push({...template,text:f.input.text.slice(at,at+20000),start_ms:Math.floor(at/20000)*1000,end_ms:Math.floor(at/20000)*1000+500});}
 else f.input.utterances[0].text=f.input.text;
 f.input.transcriptionState='complete';f.input.coveredMs=60000;f.input.sourceMs=60000;
 const initial=f.store.ensure(f.source),head=f.store.appendTranscript(initial.material_id,1,f.input,'synthetic-summary-export');
 const target=f.root+'/existing-target.md',missingTarget=f.root+'/new-target.md',kept=Buffer.from('KEEP EXISTING TARGET\n原有目标内容🙂');fs.writeFileSync(target,kept);
 const opened=[],pickerWait=[],toasts=[],calls=[];let afterInputOpen,afterInputRead,afterTargetWrite,chunkHook,readFailure=false,shortWrite=4093;
 const io={OpenMode:{CREATE:1,WRITE_ONLY:2,TRUNC:4,READ_ONLY:8},accessSync:fs.existsSync,mkdirSync:p=>fs.mkdirSync(p),listFileSync:fs.readdirSync,
  statSync:value=>typeof value==='number'?fs.fstatSync(value):fs.statSync(value),readTextSync:p=>fs.readFileSync(p,'utf8'),
  openSync(p,mode){opened.push([p,mode]);const file={fd:fs.openSync(p,mode&8?'r':mode&5?'w':'r+')};descriptors.set(file.fd,p);
   if((mode&8)&&afterInputOpen){const hook=afterInputOpen;afterInputOpen=undefined;hook();}return file;},
  closeSync:value=>{const fd=typeof value==='number'?value:value.fd;fs.closeSync(fd);descriptors.delete(fd);},
  readSync(fd,buffer,options){if(readFailure)throw Error('synthetic input read failure');const count=fs.readSync(fd,new Uint8Array(buffer),0,options?.length??buffer.byteLength,null);
   if(afterInputRead){const hook=afterInputRead;afterInputRead=undefined;hook();}return count;},
  writeSync(fd,buffer){const bytes=new Uint8Array(buffer),count=fs.writeSync(fd,bytes,0,Math.min(bytes.length,shortWrite),null);
   if(descriptors.get(fd)===target&&afterTargetWrite){const hook=afterTargetWrite;afterTargetWrite=undefined;hook();}return count;},
  fsyncSync:fs.fsyncSync,renameSync:fs.renameSync};
 const journal=loadApp('JournalExport',{'@kit.CoreFileKit':{fileIo:io},'./LifelogSession':{LifelogDayText:class{markdown='';total=0;transcribed=0;}},'./RecordingSession':{}});
 const item={name:f.source.name,created:f.source.started,bytes:12000,textFile:'forbidden-legacy.md'},recordings={items:[item],changed(){},textPath(){throw Error('canonical source must not reopen legacy ASR');}},
  lifelog={items:[],changed(){},rootPath:()=>journalRoot,readTranscriptJson(){throw Error('canonical source must not reopen old JSON');}},lifelogASR={changed(){}};
 const picker={DocumentViewPicker:class{save(){calls.push('picker');return new Promise(resolve=>pickerWait.push(resolve));}}},probe={foreground:true};
 const names=['run','sources','dayMarkdown','runExport','copyOut','stamp','aboutToDisappear','selectDay','invalidateLocalSearch'];
 const compiled=ts.transpileModule(`class Page {\n${names.map(method).join('\n')}\n}\nmodule.exports=Page;`,{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS}}).outputText,module={exports:{}};
 vm.runInNewContext(compiled,{...journal,module,exports:module.exports,fs:io,picker,recordings,lifelog,lifelogASR,materials:f.store,probeSession:probe,
  localPlayback:{suspend:()=>Promise.resolve({})},cancelRecordingCloudTranscription(){},cancelLifelogManualPublication(){},Map,Date,JSON,Error,ArrayBuffer,Uint8Array,Promise,
  setTimeout(callback,ms){return setTimeout(()=>{if(chunkHook){const hook=chunkHook;chunkHook=undefined;hook();}callback();},ms);}});
 const page=new module.exports();Object.assign(page,{visible:true,actionEpoch:1,busy:false,selected:DAY,note:'unchanged page note',
  text:'other detail',textKind:'recording',textName:'other-B',textRevision:8,textNeedsFull:false,fullText:true,
  queryOpenedKey:'',queryCheckedRaw:new Map(),playbackUnsubscribe(){},vault:{load:()=>Promise.resolve({modelKey:'synthetic'})},
  remote:{summarize:async()=>{calls.push('model');return'合成完整AI总结\n不自动执行待办。';}},
  getUIContext:()=>({getHostContext:()=>({}),getPromptAction:()=>({showToast:value=>toasts.push(value.message)})})});
 const correct=()=>{const row=f.store.read(head.material_id);return f.store.correctText(row.material_id,row.revision,row.utterances[0].utterance_id,'更正后的当前文字');};
 const snapshots=()=>fs.readdirSync(journalRoot).filter(name=>/^day-\d{4}-\d{2}-\d{2}-[a-f0-9]{64}\.md$/.test(name)).map(name=>journalRoot+'/'+name);
 return{...f,page,probe,recordings,item,head,target,missingTarget,kept,pickerWait,toasts,calls,opened,descriptors,journalRoot,snapshots,correct,
  async start(ai=true){page.runExport(DAY,ai);await turn();assert.equal(pickerWait.length,1,'actual copyOut must be waiting in the picker');assert.equal(snapshots().length,1);},
  async pick(destination=target){pickerWait.shift()([destination]);await finish(page);},
  targetOpens:()=>opened.filter(([p,mode])=>[target,missingTarget].includes(p)&&!(mode&8)),
  onInputOpen:hook=>afterInputOpen=hook,onInputRead:hook=>afterInputRead=hook,onTargetWrite:hook=>afterTargetWrite=hook,onChunk:hook=>chunkHook=hook,
  failRead:()=>readFailure=true,shortWrites:value=>shortWrite=value,
  mutate(kind){if(kind==='correct')correct();else if(kind==='delete')f.store.delete(head.material_id,f.store.read(head.material_id).revision);
   else if(kind==='same-revision'){const row=f.store.read(head.material_id);row.text='同修订被外来改写';row.utterances[0].text=row.text;fs.writeFileSync(f.root+'/materials/'+head.material_id+'/revision-000000002.json',JSON.stringify(row));}
   else if(kind==='membership')recordings.items=[];else if(kind==='day'){page.selectDay(DAY+86400000);page.note='new day note';page.text='new day detail';}
   else if(kind==='remount'){page.aboutToDisappear();page.visible=true;page.actionEpoch++;page.busy=false;page.note='new page note';page.text='new page detail';}
   else if(kind==='background'){probe.foreground=false;page.note='background note';}}
 };
}

for(const ai of [true,false]){
 test(`daily ${ai?'AI':'plain'} picker source/day/lifetime changes preserve destination bytes and independent snapshot`,async t=>{
  for(const change of ['correct','delete','same-revision','membership','day','remount','background'])await t.test(change,async t=>{
   const f=fixture(t);await f.start(ai);const snapshot=f.snapshots()[0],saved=fs.readFileSync(snapshot);f.mutate(change);const shown=f.page.text,note=f.page.note;
   await f.pick();await turn();assert.deepEqual(fs.readFileSync(f.target),f.kept);assert.equal(f.targetOpens().length,0,'stale export must not open target with TRUNC');
   assert.deepEqual(fs.readFileSync(snapshot),saved);assert.equal(f.page.text,shown);assert.equal(f.toasts.some(text=>/已导出|^完成$/.test(text)),false);
   if(['day','remount','background'].includes(change))assert.equal(f.page.note,note);
  });
 });
 test(`daily ${ai?'AI':'plain'} cancelled system picker neither creates nor truncates a target and retains App snapshot`,async t=>{
  const f=fixture(t);await f.start(ai);const before=fs.readFileSync(f.snapshots()[0]);f.pickerWait.shift()([]);await finish(f.page);
  assert.deepEqual(fs.readFileSync(f.target),f.kept);assert.equal(fs.existsSync(f.missingTarget),false);assert.equal(f.targetOpens().length,0);assert.deepEqual(fs.readFileSync(f.snapshots()[0]),before);
  assert.match(f.page.note,/已取消导出.*快照仍保留/);assert.doesNotMatch(f.page.note,/已导出/);
 });
 test(`daily ${ai?'AI':'plain'} unchanged source copies the complete immutable snapshot`,async t=>{
  const f=fixture(t);await f.start(ai);const expected=fs.readFileSync(f.snapshots()[0]);await f.pick();assert.deepEqual(fs.readFileSync(f.target),expected);
  assert.equal(f.descriptors.size,0);assert.match(f.page.note,/已导出/);assert.equal(f.calls.includes('model'),ai);assert.equal(f.snapshots().length,1);
 });
}

for(const boundary of ['open','read'])test(`source correction during actual input ${boundary} is caught before target TRUNC`,async t=>{
 const f=fixture(t);await f.start();(boundary==='open'?f.onInputOpen:f.onInputRead)(f.correct);await f.pick();
 assert.deepEqual(fs.readFileSync(f.target),f.kept);assert.equal(f.targetOpens().length,0);assert.equal(f.descriptors.size,0);assert.doesNotMatch(f.page.note,/已导出/);
});

test('actual input read failure does not truncate an existing destination',async t=>{
 const f=fixture(t);await f.start();f.failRead();await f.pick();assert.deepEqual(fs.readFileSync(f.target),f.kept);assert.equal(f.targetOpens().length,0);assert.equal(f.descriptors.size,0);assert.doesNotMatch(f.page.note,/已导出/);
});

test('source correction between partial writes stops further old bytes and never reports complete export',async t=>{
 const f=fixture(t);await f.start();f.shortWrites(37);f.onTargetWrite(f.correct);await f.pick();const partial=fs.readFileSync(f.target),saved=fs.readFileSync(f.snapshots()[0]);
 assert.equal(partial.length,37,'only bytes written before the source change may remain');assert.deepEqual(partial,saved.subarray(0,37));assert.doesNotMatch(f.page.note,/已导出/);
 assert.equal(f.toasts.some(text=>/已导出|^完成$/.test(text)),false);assert.equal(f.descriptors.size,0);assert(saved.length>partial.length);
});

test('source deletion at a yielded copy boundary stops a long plain export and retains the whole App snapshot',async t=>{
 const f=fixture(t,{large:true});await f.start(false);const saved=fs.readFileSync(f.snapshots()[0]);assert(saved.length>262144);f.onChunk(()=>f.mutate('delete'));await f.pick();
 const partial=fs.readFileSync(f.target);assert.equal(partial.length,262144);assert.deepEqual(partial,saved.subarray(0,262144));assert.doesNotMatch(f.page.note,/已导出/);assert.equal(f.descriptors.size,0);
 assert.deepEqual(fs.readFileSync(f.snapshots()[0]),saved);assert.equal(f.store.read(f.head.material_id).operation,'delete');
});
