import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {loadApp} from './load-app.mjs';
import {setupMaterialStore} from './material-fixture.mjs';

// Actual private service/page methods, JournalExport writers, MaterialStore and
// cold saved-summary reader. Only model/config/network/picker/UI are substitutes.
// Source is captured once when this test module starts, so a red run cannot
// silently switch to an implementation edited by another agent while it runs.
const require=createRequire(import.meta.url),deveco=process.env.DEVECO_HOME||'D:/APP/DevEcoStudio';
const ts=require(`${deveco}/sdk/default/openharmony/ets/build-tools/ets-loader/node_modules/typescript`);
const serviceSource=fs.readFileSync(new URL('../entry/src/main/ets/RecordingService.ets',import.meta.url),'utf8');
const pageSource=fs.readFileSync(new URL('../entry/src/main/ets/pages/JournalPanel.ets',import.meta.url),'utf8');
const DAY=new Date(2026,9,15).getTime(),DATE='2026-10-15';
const MODEL='合成自动总结😀\n\n## 模型后续小节\n'+('完整条件：新价格，运费沿用上次。\n'.repeat(80))+'尾部唯一确认：完整原文保留。';
const digest=value=>createHash('sha256').update(value).digest('hex');
const turn=()=>new Promise(setImmediate);
function method(name){
 const match=new RegExp(`^  (?:private )?(?:async )?${name}\\(`,'m').exec(pageSource);assert(match,'actual page method missing: '+name);
 const after=pageSource.slice(match.index+match[0].length),next=/\n  (?:private |aboutTo|@Builder|[A-Za-z][A-Za-z0-9_]*\()/.exec(after);
 assert(next,'actual page boundary missing: '+name);return pageSource.slice(match.index,match.index+match[0].length+next.index);
}
function evaluate(code,environment){
 const compiled=ts.transpileModule(code,{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS}}).outputText;
 const module={exports:{}};vm.runInNewContext(compiled,{...environment,module,exports:module.exports,Error,JSON,Uint8Array,ArrayBuffer,Promise,Date,setTimeout});return module.exports;
}
async function settled(page,key){for(let at=0;at<300&&page[key];at++)await new Promise(resolve=>setTimeout(resolve,2));assert.equal(page[key],false,key+' must settle');}
function fixture(t){
 const f=setupMaterialStore(t);assert.match(path.resolve(f.root),/^[Dd]:[\\/]/,'all real IO belongs to controlled D: scratch');
 const directory=f.root+'/journals';fs.mkdirSync(directory);const descriptors=new Map(),events=[],uploads=[],toasts=[],pickerCalls=[];
 let fault,modelWait,uploadFailure=false,pickerHook,modelCalls=0,legacyReads=0;
 const classify=file=>file.startsWith(directory+'/day-'+DATE+'-')?'snapshot':file===directory+'/day-'+DATE+'.md.partial'?'cache':'';
 const shouldFail=(point,file)=>fault?.point===point&&fault.where===classify(file);
 Object.assign(f.io,{OpenMode:{CREATE:1,WRITE_ONLY:2,TRUNC:4,READ_ONLY:0},lstatSync:fs.lstatSync,
  statSync:value=>typeof value==='number'?fs.fstatSync(value):fs.statSync(value),readTextSync:file=>fs.readFileSync(file,'utf8'),
  openSync(file,mode){if(shouldFail('open',file))throw Error('synthetic '+fault.where+' open failed');
   const fd=fs.openSync(file,mode===0?'r':mode&5?'w':'r+');descriptors.set(fd,file);if(mode!==0)events.push(['open',file]);return{fd};},
  closeSync(file){const fd=typeof file==='number'?file:file.fd;fs.closeSync(fd);descriptors.delete(fd);},
  readSync:(fd,buffer,options)=>fs.readSync(fd,new Uint8Array(buffer),0,Math.min(19,options?.length??buffer.byteLength),null),
  writeSync(fd,buffer){const file=descriptors.get(fd);if(shouldFail('write',file))return 0;
   const bytes=new Uint8Array(buffer);events.push(['write',file]);return fs.writeSync(fd,bytes,0,Math.min(37,bytes.length),null);},
  fsyncSync(fd){const file=descriptors.get(fd);if(shouldFail('fsync',file))throw Error('synthetic '+fault.where+' fsync failed');events.push(['fsync',file]);fs.fsyncSync(fd);},
  renameSync(from,to){if(shouldFail('rename',from))throw Error('synthetic '+fault.where+' rename failed');events.push(['rename',from,to]);fs.renameSync(from,to);}});
 const codecs={util:{TextEncoder:class{encodeInto(value){return new TextEncoder().encode(value);}},TextDecoder:class{
  constructor(encoding,options){this.decoder=new TextDecoder(encoding,options);}decodeToString(bytes){return this.decoder.decode(bytes);}}}};
 const platform={'@kit.CoreFileKit':{fileIo:f.io},'@kit.ArkTS':codecs,'./LifelogSession':{LifelogDayText:class{markdown='';total=0;transcribed=0;}},'./RecordingSession':{}};
 const journal=loadApp('JournalExport',platform);
 Object.assign(f.source,{started:DAY+1000,ended:DAY+61000,audioAvailable:false,audioBytes:0});
 Object.assign(f.input,{text:'合成canonical原文：采用新价格，运费沿用上次。',transcriptionState:'complete',coveredMs:60000,sourceMs:60000,speakerProcessing:'processed',boundaryProcessing:'token_starts'});
 f.input.utterances[0].text=f.input.text;
 const base=f.store.ensure(f.source),head=f.store.appendTranscript(base.material_id,1,f.input,'synthetic-auto-retention');
 const item={name:f.source.name,created:f.source.started,ended:f.source.ended,bytes:0,textFile:'legacy.md',complete:true};
 const recordings={items:[item],textPath(){legacyReads++;throw Error('canonical result must not read legacy text');}},
  lifelog={items:[],rootPath:()=>directory,note:'existing capture note',changed(){},readTranscriptJson:()=>''};
 const materials={idFor:(...args)=>f.store.idFor(...args),read:id=>f.store.read(id)};
 const sources=()=>{const value=new journal.JournalSources();Object.assign(value,{lifelogRoot:directory,recordingItems:recordings.items,
  recordingText:row=>f.io.readTextSync(recordings.textPath(row)),material:(kind,name)=>materials.read(materials.idFor(kind,name))});return value;};
 const current=day=>journal.buildJournalDay(day,sources(),'');
 const coldReader=()=>{const core=loadApp('SavedJournalSummary',platform);return new core.SavedJournalSummary({root:()=>directory,current});};
 const firstReader=coldReader(),probe={foreground:true};
 class SecureServiceConfig{async load(){return{modelKey:'synthetic-model-key'};}}
 class RemoteServices{summarize(){modelCalls++;return new Promise((resolve,reject)=>{modelWait={resolve,reject};});}cancel(){}}
 class UploadTarget{url='';token='';auto=false;time='';}
 const environment={...journal,fs:f.io,lifelog,recordings,materials,voices:{cards:()=>''},probeSession:probe,SecureServiceConfig,RemoteServices,UploadTarget,
  savedJournalSummaries:firstReader,...loadApp('SavedJournalSummary',platform),picker:{DocumentViewPicker:class{async save(){pickerCalls.push(1);if(pickerHook)pickerHook();return[directory+'/export.md'];}}}};
 const Page=evaluate(`class Page {\n${['sources','dayMarkdown','dayEntries','dayAudio','uploadToday','run','stamp','copyOut','exportSavedSummary','closeSavedSummaries'].map(method).join('\n')}\n}\nmodule.exports=Page;`,environment);
 const page=new Page();Object.assign(page,{visible:true,actionEpoch:1,busy:false,uploading:false,selected:DAY,upURL:'https://synthetic.invalid/upload',upToken:'synthetic',upAuto:false,upTime:'22:00',
  note:'existing page note',text:'ordinary body',textName:'ordinary-item',savedSummaryGeneration:1,savedSummaryDay:DATE,querySourcesSignature:'source-catalog',
  entries:[{kind:'recording',recordingItem:item,created:item.created}],getUIContext:()=>({getHostContext:()=>({}),getPromptAction:()=>({showToast:value=>toasts.push(value.message)})}),
  uploader:{note:'synthetic stored',async upload(target,day,file,audio){uploads.push({day,file,body:fs.readFileSync(file,'utf8'),audio});if(uploadFailure)throw Error('synthetic upload failed');return'';}}});
 const begin=serviceSource.indexOf('async function ensureDaySummary('),end=serviceSource.indexOf('\nfunction windowWaitLabel',begin);assert(begin>=0&&end>begin);
 const context=vm.createContext({...environment,serviceActive:true,automaticSummary:true,summaryBusy:false,serviceGeneration:1,summaryRemote:undefined,journalSources:sources,module:{exports:{}},Error,JSON,Uint8Array,ArrayBuffer});
 vm.runInContext(ts.transpileModule(serviceSource.slice(begin,end)+'\nmodule.exports=ensureDaySummary;',{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS}}).outputText,context);
 const cache=directory+'/day-'+DATE+'.md';
 const snapshots=()=>fs.readdirSync(directory).filter(name=>new RegExp('^day-'+DATE+'-[a-f0-9]{64}\\.md$').test(name)).map(name=>directory+'/'+name);
 const full=summary=>journal.bindJournalSummary(current(DAY),current(DAY),summary).markdown;
 function seed(summary='合成既有总结，不可被失败覆盖。'){const body=full(summary),snapshot=journal.writeJournalSnapshot(directory,DAY,body);journal.writeJournalFile(directory,DAY,body);
  return{body,snapshot,bytes:fs.readFileSync(snapshot),reference:{day:DATE,summary_id:'saved-'+DATE+'-'+digest(body),content_sha256:digest(body)}};}
 return{...f,journal,page,lifelog,recordings,current,head,item,directory,cache,events,uploads,toasts,pickerCalls,coldReader,snapshots,full,seed,descriptors,
  auto:()=>context.module.exports(DAY),async finish(summary=MODEL){assert(modelWait,'actual automatic function must reach the model boundary');modelWait.resolve(summary);await turn();},
  modelCalls:()=>modelCalls,legacyReads:()=>legacyReads,fault:(where,point)=>fault=where?{where,point}:undefined,
  uploadFails:()=>uploadFailure=true,onPicker:hook=>pickerHook=hook,stopAuto:()=>{context.serviceActive=false;context.serviceGeneration++;},
  correct(text='已更正当前canonical原文。'){const row=f.store.read(head.material_id);return f.store.correctText(row.material_id,row.revision,row.utterances[0].utterance_id,text);},
  remove(){const row=f.store.read(head.material_id);f.store.delete(row.material_id,row.revision);},
  async generate(summary=MODEL){const run=context.module.exports(DAY);await turn();assert(modelWait);modelWait.resolve(summary);await run;},
  async upload(){page.uploadToday(DAY);await settled(page,'uploading');},
  show(reference){page.savedSummaryDocument=coldReader().open(reference);page.savedSummaryDay=DATE;},
  async exportShown(){fs.writeFileSync(directory+'/export.md','destination sentinel');page.exportSavedSummary();await settled(page,'busy');return fs.readFileSync(directory+'/export.md','utf8');},
  async export(reference){page.savedSummaryDocument=coldReader().open(reference);page.savedSummaryDay=DATE;fs.writeFileSync(directory+'/export.md','destination sentinel');page.exportSavedSummary();await settled(page,'busy');return fs.readFileSync(directory+'/export.md','utf8');}};
}

for(const failed of [false,true])test(`automatic AI result survives ordinary upload ${failed?'failure':'success'} without losing its only complete version`,async t=>{
 const f=fixture(t),old=f.seed();await f.generate();const generated=fs.readFileSync(f.cache),expected=f.full(MODEL);assert.equal(generated.toString('utf8'),expected);
 if(failed)f.uploadFails();await f.upload();assert.equal(f.uploads.length,1);assert.equal(f.uploads[0].body,f.current(DAY).markdown,'normal upload keeps its raw-record payload');
 assert.equal(digest(fs.readFileSync(f.cache)),digest(generated),'ordinary upload must not overwrite the unique automatic AI cache');
 assert.deepEqual(fs.readFileSync(old.snapshot),old.bytes,'previous immutable summary is retained');
 const reader=f.coldReader(),entry=reader.list({day:DATE,limit:10,cursor:''}).items.find(value=>value.file_kind==='snapshot'&&value.reference.content_sha256===digest(generated));
 assert(entry,'completed AI output must have an independent immutable version');assert.equal(reader.open(entry.reference).markdown,expected);
 assert.equal(await f.export(entry.reference),expected,'actual saved-summary export copies the exact revalidated full artifact');
 assert.equal(f.modelCalls(),1);assert.equal(f.legacyReads(),0);assert.equal(f.descriptors.size,0);
});

test('automatic AI independently saves a cold-reopenable current version before publishing its mutable cache',async t=>{
 const f=fixture(t),old=f.seed();await f.generate();const expected=f.full(MODEL),reader=f.coldReader(),entry=reader.list({day:DATE,limit:10,cursor:''}).items.find(value=>value.file_kind==='snapshot'&&value.reference.content_sha256===digest(expected));
 assert(entry,'automatic completion must be persisted outside the mutable day cache');assert.equal(entry.state,'current');assert.equal(entry.can_open,true);
 assert.equal(reader.open(entry.reference).summary_text,MODEL);assert.equal(await f.export(entry.reference),expected);assert.deepEqual(fs.readFileSync(old.snapshot),old.bytes);
 const promotions=f.events.filter(value=>value[0]==='rename'),snapshotAt=promotions.findIndex(value=>value[2].endsWith('-'+digest(expected)+'.md')),
  cacheAt=promotions.findIndex((value,index)=>index>snapshotAt&&value[2]===f.cache);
 assert(snapshotAt>=0&&cacheAt>snapshotAt,'durable independent version precedes the cache replacement');assert.equal(f.descriptors.size,0);
});

for(const point of ['write','fsync','rename'])test(`automatic snapshot ${point} failure preserves the complete prior cache and previous immutable version`,async t=>{
 const f=fixture(t),old=f.seed(),cache=fs.readFileSync(f.cache),before=f.snapshots();f.events.length=0;f.fault('snapshot',point);await f.generate();
 assert.equal(digest(fs.readFileSync(f.cache)),digest(cache),'snapshot failure must not reach cache replacement');assert.deepEqual(f.snapshots(),before);
 assert.equal(digest(fs.readFileSync(old.snapshot)),digest(old.bytes));assert.equal(f.events.some(event=>event[0]==='open'&&event[1]===f.cache+'.partial'),false);
 assert.match(f.lifelog.note,/failed|写入不完整/);assert.doesNotMatch(f.lifelog.note,/已自动生成|已独立保存/);assert.equal(f.descriptors.size,0);
 f.fault();assert.equal(f.coldReader().open(old.reference).markdown,old.body);assert.equal(await f.export(old.reference),old.body);
});

for(const point of ['write','fsync','rename'])test(`automatic cache ${point} failure reports independent save and cold-reopens the complete result`,async t=>{
 const f=fixture(t),old=f.seed(),cache=fs.readFileSync(f.cache),expected=f.full(MODEL);f.fault('cache',point);await f.generate();
 assert.equal(digest(fs.readFileSync(f.cache)),digest(cache));assert.equal(digest(fs.readFileSync(old.snapshot)),digest(old.bytes));
 const reader=f.coldReader(),entry=reader.list({day:DATE,limit:10,cursor:''}).items.find(value=>value.file_kind==='snapshot'&&value.reference.content_sha256===digest(expected));
 assert(entry,'cache failure must leave the independently committed AI artifact readable');assert.equal(reader.open(entry.reference).summary_text,MODEL);
 assert.match(f.lifelog.note,/已独立保存/);assert.match(f.lifelog.note,/缓存.*(失败|待|未)/);assert.equal(f.descriptors.size,0);
 f.fault();assert.equal(await f.export(entry.reference),expected);assert.equal(f.modelCalls(),1);
});

for(const change of ['correct','remove'])test(`automatic source ${change} while the model waits preserves old files and cannot export the stale summary`,async t=>{
 const f=fixture(t),old=f.seed(),cache=fs.readFileSync(f.cache),before=f.snapshots();f.show(old.reference);
 const pending=f.auto();await turn();f[change]();await f.finish();await pending;
 assert.equal(digest(fs.readFileSync(f.cache)),digest(cache));assert.deepEqual(f.snapshots(),before);assert.equal(digest(fs.readFileSync(old.snapshot)),digest(old.bytes));
 assert.match(f.lifelog.note,/资料已变化/);const reader=f.coldReader();assert.throws(()=>reader.open(old.reference),/SAVED_SUMMARY_STALE/);
 const entry=reader.list({day:DATE,limit:10,cursor:''}).items.find(value=>value.reference.summary_id===old.reference.summary_id);assert(entry);assert.equal(entry.can_open,false);
 assert.equal(await f.exportShown(),'destination sentinel','actual saved-summary action must revalidate before opening/TRUNC of destination');
 assert.equal(f.pickerCalls.length,0);assert.equal(f.descriptors.size,0);
});

test('automatic service lifetime cancellation never publishes late AI output or changes the previous capture note',async t=>{
 const f=fixture(t),old=f.seed(),cache=fs.readFileSync(f.cache),before=f.snapshots(),note=f.lifelog.note;
 const pending=f.auto();await turn();f.stopAuto();await f.finish();await pending;
 assert.equal(digest(fs.readFileSync(f.cache)),digest(cache));assert.deepEqual(f.snapshots(),before);assert.equal(digest(fs.readFileSync(old.snapshot)),digest(old.bytes));
 assert.equal(f.lifelog.note,note);assert.equal(f.descriptors.size,0);
});

test('an existing conflicting content-addressed output is preserved and cannot replace the old automatic cache',async t=>{
 const f=fixture(t),old=f.seed(),cache=fs.readFileSync(f.cache),expected=f.full(MODEL),target=f.directory+'/day-'+DATE+'-'+digest(expected)+'.md';
 fs.writeFileSync(target,'synthetic conflicting bytes, never overwrite');await f.generate();
 assert.equal(fs.readFileSync(target,'utf8'),'synthetic conflicting bytes, never overwrite');assert.equal(digest(fs.readFileSync(f.cache)),digest(cache));
 assert.equal(digest(fs.readFileSync(old.snapshot)),digest(old.bytes));assert.match(f.lifelog.note,/内容冲突/);assert.doesNotMatch(f.lifelog.note,/已独立保存/);
 assert.equal(f.coldReader().list({day:DATE,limit:10,cursor:''}).items.find(value=>value.reference.summary_id==='saved-'+DATE+'-'+digest(expected)).can_open,false);
 assert.equal(f.descriptors.size,0);
});
