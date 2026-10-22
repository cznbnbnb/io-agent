import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {setupMaterialStore} from './material-fixture.mjs';
import {loadApp} from './load-app.mjs';

const require=createRequire(import.meta.url),deveco=process.env.DEVECO_HOME||'D:/APP/DevEcoStudio';
const ts=require(`${deveco}/sdk/default/openharmony/ets/build-tools/ets-loader/node_modules/typescript`);
const source=fs.readFileSync(new URL('../entry/src/main/ets/pages/RecordingSummaryPanel.ets',import.meta.url),'utf8');
const parentSource=fs.readFileSync(new URL('../entry/src/main/ets/pages/RecordingPanel.ets',import.meta.url),'utf8');
const clone=value=>JSON.parse(JSON.stringify(value)),turn=()=>new Promise(setImmediate);
function method(text,name){
 const match=new RegExp(`^  (?:private )?(?:async )?${name}\\(`,'m').exec(text);assert(match,'actual method missing '+name);
 const after=text.slice(match.index+match[0].length),next=/\n  (?:private |aboutTo|@Builder|build\(|[A-Za-z][A-Za-z0-9_]*\()/.exec(after);assert(next,'boundary missing '+name);
 return text.slice(match.index,match.index+match[0].length+next.index);
}
function evaluate(body,ports){
 const compiled=ts.transpileModule(body,{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS}}).outputText,module={exports:{}};
 vm.runInNewContext(compiled,{...ports,module,exports:module.exports,Map,Date,JSON,Error,Promise,ArrayBuffer,Uint8Array,setTimeout:ports.setTimeout??setTimeout});return module.exports;
}
async function settled(page){for(let i=0;i<300&&page.busy;i++)await new Promise(resolve=>setTimeout(resolve,3));assert.equal(page.busy,false);}
const names=['aboutToAppear','aboutToDisappear','referenceChanged','current','loadVersions','nextVersions','refresh','errorText','run','confirmGenerate','openVersion','pauseGeneration','confirmResume','phaseText','stamp','categoryText','categoryEntries','toggleCategory','showCitation','citationPlayable','playCitation','exportSummary'];

// Real Store, real summary plan/reference/citation reconstruction, actual page
// methods and D: file IO. The persistent job service, picker, UI shell and media
// controller are explicit controlled ports here, not network/native evidence.
function fixture(t,{large=false}={}){
 const cleanups=[],f=setupMaterialStore({after:fn=>cleanups.push(fn)}),descriptors=new Map();assert.match(path.resolve(f.root),/^[Dd]:[\\/]/);
 t.after(()=>{for(const fd of descriptors.keys())try{fs.closeSync(fd);}catch{}descriptors.clear();for(const fn of cleanups)fn();});
 Object.assign(f.input,{transcriptionState:'complete',coveredMs:60000,sourceMs:60000});
 const base=f.store.ensure(f.source),head=f.store.appendTranscript(base.material_id,1,f.input,'synthetic-summary-ui');
 const planMod=loadApp('RecordingSummaryPlan'),reference=planMod.recordingSummaryReference(head),plan=planMod.buildRecordingSummaryPlan(head);
 const listeners=new Set(),calls=[],dialogs=[],pickerWait=[],opened=[];let valid=true,afterRead,afterInputOpen,afterWrite,beforeYield,yields=0,readFailure=false,maxWrite=71,seq=0,listFailure=false;
 const output=f.root+'/existing-summary.md',missing=f.root+'/new-summary.md',kept=Buffer.from('保留现有文件\nKEEP TARGET 🙂');fs.writeFileSync(output,kept);
 const exportFile=f.root+'/summary.md',jsonFile=f.root+'/summary.json';
 const body=large?'合成导出边界测试🙂\n'.repeat(40000):'合成总结\n完整末尾 🙂\n';fs.writeFileSync(exportFile,body);fs.writeFileSync(jsonFile,JSON.stringify({entries:[{text:'合成完整内容🙂'}]}));
 const same=(a,b)=>!!a&&!!b&&JSON.stringify(a)===JSON.stringify(b);
 const job={job_id:'rsum-'+'b'.repeat(32),state_sha256:'1'.repeat(64),phase:'ready',note:'安全状态说明',source:clone(reference),model:'synthetic-model',generated_at:'2026-10-15T18:23:45.000Z',text_units:plan.text_units,piece_count:plan.pieces.length,leaf_count:plan.leaves.length,step_count:1,completed_steps:1,calls_used:1,max_calls:30,can_resume:false,transcription_state:'complete',entries:[{category:'fact',text:'模型生成的概括，不是引用原话',evidence_ids:[plan.pieces[0].id]}]};
 const jobs=new Map([[job.job_id,job]]),row=()=>f.store.read(head.material_id),fresh=()=>{try{return same(planMod.recordingSummaryReference(row()),reference);}catch{return false;}};
 const status=id=>{const current=jobs.get(id);if(!current)throw Error('RECORDING_SUMMARY_MISSING');const result=clone(current);if(!fresh()){result.phase='stale';result.entries=[];result.can_resume=false;}if(result.phase!=='ready')result.entries=[];return result;};
 const service={
  subscribe(fn){calls.push(['subscribe']);listeners.add(fn);return()=>{calls.push(['unsubscribe']);listeners.delete(fn);};},
  list(id,limit,cursor){calls.push(['list',id,limit,cursor]);if(listFailure)throw Error('SYNTHETIC_LIST_FAILED');assert.equal(id,reference.material_id);assert.equal(limit,10);return{items:cursor?[]:[{...status(job.job_id),entries:[]}],next_cursor:cursor?'':'page-next',has_more:!cursor,snapshot_sha256:'a'.repeat(64),scanned:1,incomplete:false,incomplete_reason:''};},
  status:id=>{calls.push(['status',id]);return status(id);},
  preview(ref){calls.push(['preview',clone(ref)]);if(!same(ref,reference)||!fresh())throw Error('RECORDING_SUMMARY_STALE');return{text_units:plan.text_units,pieces:plan.pieces.length,leaf_count:plan.leaves.length,max_calls:30,transcription_state:'complete'};},
  async start(id,ref){calls.push(['start',id,clone(ref)]);if(!fresh())throw Error('RECORDING_SUMMARY_STALE');jobs.set(id,{...clone(job),job_id:id,source:clone(ref),phase:'queued',completed_steps:0,calls_used:0,can_resume:true,entries:[]});return status(id);},
  async resume(id,sha){calls.push(['resume',id,sha]);const value=jobs.get(id);if(value.state_sha256!==sha||!fresh())throw Error('RECORDING_SUMMARY_CONFLICT');value.phase='queued';return status(id);},
  cancel(id,sha){calls.push(['cancel',id,sha]);const value=jobs.get(id);if(value.state_sha256!==sha)throw Error('RECORDING_SUMMARY_CONFLICT');value.phase='paused';value.can_resume=true;value.entries=[];return status(id);},
  suspend(){calls.push(['suspend']);},
  isCurrent(id,sha){calls.push(['is-current',id,sha]);return valid&&fresh()&&jobs.get(id)?.phase==='ready'&&jobs.get(id)?.state_sha256===sha;},
  citation(id,piece){calls.push(['citation',id,piece]);if(!fresh()||!jobs.has(id))throw Error('RECORDING_SUMMARY_STALE');const actual=planMod.buildRecordingSummaryPlan(row()).pieces.find(p=>p.id===piece);if(!actual)throw Error('RECORDING_SUMMARY_INVALID');return clone(actual);},
  exportPath(id,sha,format){calls.push(['export-path',id,sha,format]);if(!service.isCurrent(id,sha))throw Error('RECORDING_SUMMARY_STALE');return format==='md'?exportFile:jsonFile;}
 };
 const io={OpenMode:{READ_ONLY:8,WRITE_ONLY:2,TRUNC:4},
  openSync(p,mode){opened.push([p,mode]);const file={fd:fs.openSync(p,mode&8?'r':'w')};descriptors.set(file.fd,p);if((mode&8)&&afterInputOpen){const fn=afterInputOpen;afterInputOpen=undefined;fn();}return file;},
  statSync:value=>typeof value==='number'?fs.fstatSync(value):fs.statSync(value),
  readSync(fd,buffer,options){if(readFailure)throw Error('read failed D:/private/secret key=private');const n=fs.readSync(fd,new Uint8Array(buffer),0,options.length,null);if(afterRead){const fn=afterRead;afterRead=undefined;fn();}return n;},
  writeSync(fd,buffer){const raw=new Uint8Array(buffer),n=fs.writeSync(fd,raw,0,Math.min(maxWrite,raw.length),null);if(afterWrite){const fn=afterWrite;afterWrite=undefined;fn();}return n;},
  fsyncSync:fs.fsyncSync,closeSync(value){const fd=typeof value==='number'?value:value.fd;fs.closeSync(fd);descriptors.delete(fd);}};
 const probe={foreground:true},picker={DocumentViewPicker:class{save(){calls.push(['picker']);return new Promise(resolve=>pickerWait.push(resolve));}}};
 const Page=evaluate(`class Page {\n${names.map(name=>method(source,name)).join('\n')}\n}\nmodule.exports=Page;`,{
  fs:io,picker,probeSession:probe,recordingSummaries:service,sameRecordingSummaryReference:same,newRecordingSummaryId:()=>`rsum-${(++seq).toString(16).padStart(32,'0')}`,
  setTimeout:(resume,delay)=>setTimeout(()=>{yields++;if(beforeYield){const fn=beforeYield;beforeYield=undefined;fn();}resume();},delay),
  PlaybackSelection:class{kind='';name='';revision=0;utterance_id='';},localPlayback:{play:selection=>{calls.push(['play',clone(selection)]);return Promise.resolve({});}}
 });
 const page=new Page();Object.assign(page,{reference:clone(reference),visible:false,epoch:0,busy:false,view:undefined,versions:[],note:'',incomplete:false,expanded:[],citation:undefined,selectedJob:'',shownReference:undefined,unsubscribe(){},hasMore:false,versionsCursor:'',nextCursor:'',
  getUIContext:()=>({getHostContext:()=>({}),showAlertDialog:dialog=>dialogs.push(dialog)})});
 const emit=()=>{for(const fn of [...listeners])fn();};
 const correct=()=>f.store.correctText(head.material_id,row().revision,row().utterances[0].utterance_id,'来源已更正');
 return{...f,page,head,reference,plan,planMod,job,jobs,service,probe,dialogs,pickerWait,calls,opened,descriptors,output,missing,kept,exportFile,jsonFile,body,listeners,correct,emit,
  mount(){page.aboutToAppear();},open(){page.openVersion(job);},invalidate(){valid=false;},failList(){listFailure=true;},failRead(){readFailure=true;},setWrite:n=>maxWrite=n,
  onRead:fn=>afterRead=fn,onInputOpen:fn=>afterInputOpen=fn,onWrite:fn=>afterWrite=fn,onYield:fn=>beforeYield=fn,yields:()=>yields,
  targetOpens:()=>opened.filter(([p,mode])=>[output,missing].includes(p)&&!(mode&8)),
  async beginExport(format='md'){page.run(()=>page.exportSummary(format));await turn();assert.equal(pickerWait.length,1);},
  async pick(destination=output){pickerWait.shift()([destination]);await settled(page);},
  mutate(kind){if(kind==='correct')correct();else if(kind==='delete')f.store.delete(head.material_id,row().revision);
   else if(kind==='same-revision'){const value=row();value.text='不合法的同修订改写';fs.writeFileSync(f.root+'/materials/'+head.material_id+'/revision-000000002.json',JSON.stringify(value));}
   else if(kind==='background')probe.foreground=false;else if(kind==='version')job.state_sha256='2'.repeat(64);
   else if(kind==='remount'){page.aboutToDisappear();page.aboutToAppear();page.note='新页面状态';}
   else if(kind==='reference'){page.reference={...clone(reference),revision:9};page.referenceChanged();page.note='新来源状态';}}
 };
}

test('summary mount only lists metadata, never generates, resumes, opens body, plays or exports',t=>{
 const f=fixture(t);f.mount();assert.equal(f.page.view,undefined);assert.equal(f.page.versions.length,1);assert.deepEqual(clone(f.page.versions[0].entries),[]);
 assert.equal(f.calls.some(([name])=>['start','resume','preview','citation','play','picker'].includes(name)),false);
 assert.match(source,/待办是候选，不会自动执行/);assert.match(parentSource,/RecordingSummaryPanel\(\{reference:this.summaryReference\}\)/);
});

test('generation needs explicit confirmation and passes immutable actual canonical reference',async t=>{
 const f=fixture(t);f.mount();f.page.confirmGenerate();assert.equal(f.dialogs.length,1);assert.match(f.dialogs[0].message,/不上传原音/);assert.match(f.dialogs[0].message,/最多30次请求/);assert.match(f.dialogs[0].message,/不能证明录音或转写完整/);
 f.dialogs[0].primaryButton.action();assert.equal(f.calls.some(([name])=>name==='start'),false);
 f.page.confirmGenerate();f.dialogs[1].secondaryButton.action();await settled(f.page);
 const start=f.calls.find(([name])=>name==='start');assert.match(start[1],/^rsum-[a-f0-9]{32}$/);assert.deepEqual(start[2],clone(f.reference));assert.equal(f.page.view.phase,'queued');assert.equal(f.page.view.entries.length,0);
});

for(const change of ['correct','background','remount','reference'])test(`old generation dialog cannot submit after ${change}`,async t=>{
 const f=fixture(t);f.mount();f.page.confirmGenerate();f.mutate(change);f.dialogs[0].secondaryButton.action();await turn();assert.equal(f.calls.some(([name])=>name==='start'),false);
});

test('explicit stop retains job progress, and restoration requires another current confirmation',async t=>{
 const f=fixture(t);f.mount();f.open();Object.assign(f.job,{phase:'running',completed_steps:2,step_count:3,calls_used:2,can_resume:true});f.emit();f.page.pauseGeneration();
 assert.equal(f.page.view.phase,'paused');assert.equal(f.page.view.completed_steps,2);assert.equal(f.page.view.calls_used,2);assert.equal(f.calls.filter(([n])=>n==='cancel').length,1);
 f.page.refresh();assert.equal(f.calls.some(([n])=>n==='resume'),false);f.page.confirmResume();f.dialogs.at(-1).primaryButton.action();assert.equal(f.calls.some(([n])=>n==='resume'),false);
 f.page.confirmResume();f.dialogs.at(-1).secondaryButton.action();await settled(f.page);assert.equal(f.calls.filter(([n])=>n==='resume').length,1);
});

test('stale resume confirmation cannot send a later job state',async t=>{
 const f=fixture(t);f.mount();Object.assign(f.job,{phase:'paused',can_resume:true});f.open();f.page.confirmResume();f.job.state_sha256='2'.repeat(64);f.emit();f.dialogs[0].secondaryButton.action();await turn();assert.equal(f.calls.some(([n])=>n==='resume'),false);
});

test('pagination reads fresh cursor and offers an explicit way back to first batch',t=>{
 const f=fixture(t);f.mount();assert.equal(f.page.hasMore,true);f.page.nextVersions();assert(f.calls.some(call=>call[0]==='list'&&call[3]==='page-next'));assert.equal(f.page.hasMore,false);
 f.page.versionsCursor='';f.page.refresh();assert.equal(f.page.versions.length,1);assert.match(source,/返回首批/);assert.match(source,/更多版本/);
});

test('same reference state refresh does not suspend a generation; correction clears only summary view',t=>{
 const f=fixture(t);f.mount();f.open();f.page.transcript='原文独立';f.page.playback={session_id:'unchanged'};const count=f.calls.filter(([n])=>n==='suspend').length;
 f.page.reference=clone(f.reference);f.page.referenceChanged();assert.equal(f.calls.filter(([n])=>n==='suspend').length,count);
 f.correct();f.page.reference=f.planMod.recordingSummaryReference(f.store.read(f.head.material_id));f.page.referenceChanged();assert.equal(f.page.view,undefined);assert.equal(f.page.citation,undefined);assert.equal(f.page.transcript,'原文独立');assert.equal(f.page.playback.session_id,'unchanged');assert.equal(f.calls.filter(([n])=>n==='suspend').length,count+1);
});

test('leave unsubscribes and suspends only summary work; stale subscription cannot repopulate text',t=>{
 const f=fixture(t);f.mount();f.open();const old=[...f.listeners][0];f.page.aboutToDisappear();assert.equal(f.listeners.size,0);assert.equal(f.page.view,undefined);assert(f.calls.some(([n])=>n==='suspend'));old();assert.equal(f.page.view,undefined);
});

test('failed refresh or stale current source cannot keep old summary entries or citation',t=>{
 const f=fixture(t);f.mount();f.open();f.page.showCitation(f.plan.pieces[0].id);f.correct();f.emit();assert.equal(f.page.view.phase,'stale');assert.equal(f.page.view.entries.length,0);assert.equal(f.page.citation,undefined);
 f.failList();f.page.refresh();assert.equal(f.page.view,undefined);assert.equal(f.page.versions.length,0);assert.equal(f.page.incomplete,true);
});

test('four categories fold independently and raw model text is never used as citation quote',t=>{
 const f=fixture(t);f.mount();f.open();for(const kind of ['fact','todo','question','suggestion']){assert(f.page.categoryText(kind));f.page.toggleCategory(kind);assert(f.page.expanded.includes(kind));}
 f.page.showCitation(f.plan.pieces[0].id);assert.equal(f.page.citation.text,f.plan.pieces[0].text);assert.notEqual(f.page.citation.text,f.job.entries[0].text);assert.equal(f.page.categoryEntries('fact').length,1);
 f.job.phase='paused';f.emit();assert.equal(f.page.categoryEntries('fact').length,0);
});

test('fresh citation playback uses original utterance identity, never interpolated quote offset',async t=>{
 const f=fixture(t);f.mount();f.open();f.page.showCitation(f.plan.pieces[0].id);f.page.citation.char_start=999;f.page.playCitation();await turn();
 assert.deepEqual(f.calls.find(([n])=>n==='play'),['play',{kind:'recording',name:f.source.name,revision:f.head.revision,utterance_id:f.head.utterances[0].utterance_id}]);
 f.correct();f.page.playCitation();await turn();assert.equal(f.calls.filter(([n])=>n==='play').length,1);assert.equal(f.page.citation,undefined);
});

test('body text and unknown split timing have no sentence playback action',t=>{
 const f=fixture(t);f.mount();f.open();for(const piece of [{...clone(f.plan.pieces[0]),text_field:'body'},{...clone(f.plan.pieces[0]),start_ms:null,end_ms:null}]){f.page.citation=piece;assert.equal(f.page.citationPlayable(),false);f.page.playCitation();}assert.equal(f.calls.some(([n])=>n==='play'),false);
 assert.match(source,/不是引用字词的精确时间/);assert.match(source,/没有可靠时间/);
});

test('version captions use local calendar time, unknown timestamps are not guessed',t=>{
 const f=fixture(t),stamp='2026-10-15T18:23:45.000Z',d=new Date(stamp),two=n=>String(n).padStart(2,'0');
 assert.equal(f.page.stamp(stamp),`${d.getFullYear()}-${two(d.getMonth()+1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`);
 assert.equal(f.page.stamp(''),'生成时间未确定');assert.equal(f.page.stamp('bad'),'生成时间未确定');
});

for(const format of ['md','json']){
 test(`${format} summary export writes complete immutable file with bounded partial writes`,async t=>{
  const f=fixture(t);f.mount();f.open();await f.beginExport(format);await f.pick();assert.deepEqual(fs.readFileSync(f.output),fs.readFileSync(format==='md'?f.exportFile:f.jsonFile));assert.equal(f.descriptors.size,0);assert.match(f.page.note,/已导出这次总结/);
 });
 test(`${format} picker cancellation preserves destination and local summary without misleading success`,async t=>{
  const f=fixture(t);f.mount();f.open();await f.beginExport(format);f.pickerWait.shift()([]);await settled(f.page);assert.deepEqual(fs.readFileSync(f.output),f.kept);assert.equal(f.targetOpens().length,0);assert.equal(fs.existsSync(f.missing),false);assert.equal(fs.existsSync(f.exportFile),true);assert.match(f.page.note,/已取消导出/);
 });
}

for(const change of ['correct','delete','same-revision','background','version','remount','reference'])test(`picker pending ${change} never truncates the existing target or overwrites a new page note`,async t=>{
 const f=fixture(t);f.mount();f.open();await f.beginExport();f.mutate(change);const note=f.page.note;await f.pick();assert.deepEqual(fs.readFileSync(f.output),f.kept);assert.equal(f.targetOpens().length,0);assert.equal(f.descriptors.size,0);assert.doesNotMatch(f.page.note,/已导出/);
 if(['remount','reference','background'].includes(change))assert.equal(f.page.note,note);
});

for(const boundary of ['open','read'])test(`actual source ${boundary} callback source correction is caught before target TRUNC`,async t=>{
 const f=fixture(t);f.mount();f.open();await f.beginExport();(boundary==='open'?f.onInputOpen:f.onRead)(f.correct);await f.pick();assert.deepEqual(fs.readFileSync(f.output),f.kept);assert.equal(f.targetOpens().length,0);assert.equal(f.descriptors.size,0);assert.doesNotMatch(f.page.note,/已导出/);
});

test('source read failure preserves destination, closes descriptors and hides raw paths or keys',async t=>{
 const f=fixture(t);f.mount();f.open();await f.beginExport();f.failRead();await f.pick();assert.deepEqual(fs.readFileSync(f.output),f.kept);assert.equal(f.targetOpens().length,0);assert.equal(f.descriptors.size,0);assert.doesNotMatch(f.page.note,/private|secret|key=|D:\//);
});

test('source change between partial target writes stops old bytes and does not claim rollback',async t=>{
 const f=fixture(t);f.mount();f.open();f.setWrite(7);await f.beginExport();f.onWrite(f.correct);await f.pick();const actual=fs.readFileSync(f.output),saved=fs.readFileSync(f.exportFile);assert.equal(actual.length,7);assert.deepEqual(actual,saved.subarray(0,7));assert.doesNotMatch(f.page.note,/已导出/);assert.equal(f.descriptors.size,0);assert(fs.existsSync(f.exportFile));
});

test('long controlled export stops at a yielded boundary after backgrounding and keeps saved file',async t=>{
 const f=fixture(t,{large:true}),saved=fs.readFileSync(f.exportFile);f.mount();f.open();f.setWrite(262144);await f.beginExport();
 // Drive the actual export's first asynchronous yield. setImmediate versus
 // setTimeout(0) ordering is not a contract, so background before its resume.
 f.onYield(()=>{assert.equal(fs.statSync(f.output).size,262144);f.probe.foreground=false;});await f.pick();
 const actual=fs.readFileSync(f.output);assert.equal(f.yields(),1);assert.equal(actual.length,262144);assert.deepEqual(actual,saved.subarray(0,262144));assert.deepEqual(fs.readFileSync(f.exportFile),saved);assert.doesNotMatch(f.page.note,/已导出/);assert.equal(f.descriptors.size,0);
});

test('RecordingPanel actual canonical selection and editor revision callbacks provide current summary refs',t=>{
 const f=fixture(t),Parent=evaluate(`class Parent {\n${['viewText','selectedMaterialChanged','closeText','clearDeletedSelection'].map(name=>method(parentSource,name)).join('\n')}\n}\nmodule.exports=Parent;`,{
  recordingSummaryReference:f.planMod.recordingSummaryReference,materials:f.store,localMaterialRevision:()=>f.store.read(f.head.material_id),
  localPlayback:{snapshot:()=>({}),stopSource:()=>Promise.resolve({})},recordings:{textPath(){throw Error('no legacy fallback');}},fs:{readTextSync(){throw Error('no legacy fallback');}}
 }),parent=new Parent();Object.assign(parent,{textName:'',transcript:'',summaryReference:undefined});parent.viewText({name:f.source.name});assert.deepEqual(clone(parent.summaryReference),clone(f.reference));
 f.correct();const changed=f.store.read(f.head.material_id);parent.selectedMaterialChanged(changed);assert.equal(parent.summaryReference.revision,changed.revision);assert.equal(parent.transcript,changed.text);parent.closeText();assert.equal(parent.summaryReference,undefined);
 parent.viewText({name:f.source.name});f.store.delete(changed.material_id,changed.revision);parent.clearDeletedSelection(f.source.name);assert.equal(parent.summaryReference,undefined);assert.equal(parent.textName,'');
});

function realService(f,{defer=false}={}){
 const pending=[],requestCalls=[],cancelCalls=[],coreDescriptors=new Set();
 const io={OpenMode:{CREATE:1,WRITE_ONLY:2,READ_ONLY:8},accessSync:fs.existsSync,lstatSync:fs.lstatSync,
  mkdirSync:p=>fs.mkdirSync(p),listFileSync:fs.readdirSync,statSync:value=>typeof value==='number'?fs.fstatSync(value):fs.statSync(value),
  openSync(p,mode){const file={fd:fs.openSync(p,mode&8?'r':'w')};coreDescriptors.add(file.fd);return file;},
  closeSync:value=>{const fd=typeof value==='number'?value:value.fd;fs.closeSync(fd);coreDescriptors.delete(fd);},
  readSync:(fd,buffer,options)=>fs.readSync(fd,new Uint8Array(buffer),0,options?.length??buffer.byteLength,null),
  writeSync:(fd,buffer)=>{const raw=new Uint8Array(buffer);return fs.writeSync(fd,raw,0,Math.min(137,raw.length),null);},
  fsyncSync:fs.fsyncSync,renameSync:fs.renameSync};
 const platform={'@kit.CoreFileKit':{fileIo:io},'@kit.ArkTS':{util:{
  TextEncoder:class{encodeInto(value){return new TextEncoder().encode(value);}},
  TextDecoder:class{constructor(label,options){this.decoder=new TextDecoder(label,options);}decodeToString(value){return this.decoder.decode(value);}}
 }}};
 const mod=loadApp('RecordingSummary',platform),config={model:'synthetic-summary-model',modelURL:'https://synthetic.invalid/v1',modelKey:'synthetic-not-a-real-token'};
 const answer=raw=>{const payload=JSON.parse(raw);return JSON.stringify({entries:[{category:'fact',text:'合成处理结果：应核对原文。',evidence_ids:[payload.required_ids[0]]}],covered_ids:payload.required_ids});};
 const ports={root:()=>f.root,read:id=>f.store.read(id),foreground:()=>f.probe.foreground,config:async()=>config,
  request:async(_config,system,input)=>{requestCalls.push({system,input});if(defer)return new Promise(resolve=>pending.push(()=>resolve(answer(input))));return answer(input);},
  cancel:()=>cancelCalls.push('cancel'),now:()=>Date.parse('2026-10-16T02:34:56.000Z')};
 let actual=new mod.RecordingSummaryService(ports);
 const bind=()=>{for(const key of Object.keys(f.service))f.service[key]=actual[key].bind(actual);};bind();
 const cold=()=>{actual.suspend();actual=new mod.RecordingSummaryService(ports);bind();return actual;};
 const wait=async(id,phase)=>{for(let at=0;at<100;at++){const value=actual.status(id);if(value.phase===phase)return value;await turn();}assert.fail('actual job did not reach '+phase+': '+JSON.stringify(actual.status(id)));};
 return{mod,ports,pending,requestCalls,cancelCalls,coreDescriptors,wait,cold,current:()=>actual};
}

test('actual persistent summary service generates, cold reopens, quotes current original and page exports MD/JSON',async t=>{
 const f=fixture(t),actual=realService(f);f.mount();assert.equal(actual.requestCalls.length,0);f.page.confirmGenerate();f.dialogs.at(-1).secondaryButton.action();await settled(f.page);
 const id=f.page.selectedJob,ready=await actual.wait(id,'ready');f.page.refresh();assert.equal(f.page.view.phase,'ready');assert.equal(actual.requestCalls.length,ready.step_count);
 assert.equal(ready.calls_used,ready.step_count);assert.equal(ready.max_calls,30);assert.match(actual.requestCalls[0].input,/测试语句/);
 const piece=ready.entries[0].evidence_ids[0];f.page.showCitation(piece);assert.equal(f.page.citation.text,f.plan.pieces[0].text);assert.notEqual(f.page.citation.text,ready.entries[0].text);
 for(const format of ['md','json']){const local=actual.current().exportPath(id,ready.state_sha256,format),before=fs.readFileSync(local);await f.beginExport(format);await f.pick();assert.deepEqual(fs.readFileSync(f.output),before);assert.deepEqual(fs.readFileSync(local),before);}
 const calls=actual.requestCalls.length;f.page.aboutToDisappear();const reader=actual.cold();f.page.aboutToAppear();assert.equal(f.page.view,undefined);assert.equal(actual.requestCalls.length,calls);
 const metadata=reader.list(f.reference.material_id,10,'');assert(metadata.items.some(item=>item.job_id===id));assert(metadata.items.every(item=>item.entries.length===0));
 f.page.openVersion(metadata.items.find(item=>item.job_id===id));assert.equal(f.page.view.phase,'ready');assert.equal(f.page.view.entries.length,ready.entries.length);assert.equal(actual.requestCalls.length,calls);
 for(const format of ['md','json']){let text='',offset=0;while(true){const part=reader.chunk(id,ready.state_sha256,format,offset,32);text+=part.text;if(!part.has_more)break;assert(part.next_offset>offset);offset=part.next_offset;}
  assert.equal(text,fs.readFileSync(reader.exportPath(id,ready.state_sha256,format),'utf8'));}
 assert.equal(actual.coreDescriptors.size,0);assert.equal(f.descriptors.size,0);
});

test('actual current-source rejection after a picker wait preserves target, checkpoint and local summary',async t=>{
 const f=fixture(t),actual=realService(f);f.mount();f.page.confirmGenerate();f.dialogs.at(-1).secondaryButton.action();await settled(f.page);const id=f.page.selectedJob,ready=await actual.wait(id,'ready');f.page.refresh();
 const local=actual.current().exportPath(id,ready.state_sha256,'md'),before=fs.readFileSync(local),jobRoot=f.root+'/recording-summaries-v1/'+id;
 const states=()=>Object.fromEntries(fs.readdirSync(jobRoot).filter(name=>name.startsWith('state-')).map(name=>[name,createHash('sha256').update(fs.readFileSync(jobRoot+'/'+name)).digest('hex')]));const beforeStates=states();
 await f.beginExport();f.correct();await f.pick();assert.deepEqual(fs.readFileSync(f.output),f.kept);assert.equal(f.targetOpens().length,0);assert.deepEqual(fs.readFileSync(local),before);assert.deepEqual(states(),beforeStates);
 const cold=actual.cold();assert.equal(cold.status(id).phase,'stale');assert.deepEqual(clone(cold.status(id).entries),[]);assert.throws(()=>cold.citation(id,ready.entries[0].evidence_ids[0]),/STALE/);assert.equal(actual.requestCalls.length,1);assert.equal(actual.coreDescriptors.size,0);
});

test('actual pending model call pauses durably, cold page never resumes until explicit action',async t=>{
 const f=fixture(t),actual=realService(f,{defer:true});f.mount();f.page.confirmGenerate();f.dialogs.at(-1).secondaryButton.action();await settled(f.page);const id=f.page.selectedJob;await actual.wait(id,'running');f.page.refresh();
 assert.equal(actual.pending.length,1);f.page.pauseGeneration();assert.equal(f.page.view.phase,'paused');assert.equal(f.page.view.calls_used,1);
 f.page.aboutToDisappear();actual.cold();f.page.aboutToAppear();const before=actual.requestCalls.length;f.page.openVersion(actual.current().status(id));assert.equal(f.page.view.can_resume,true);assert.equal(actual.requestCalls.length,before);
 f.page.confirmResume();f.dialogs.at(-1).secondaryButton.action();await settled(f.page);await actual.wait(id,'running');assert.equal(actual.pending.length,2);assert.equal(actual.requestCalls.length,2);
 actual.pending[0]();await turn();assert.notEqual(actual.current().status(id).phase,'ready','old paused request result cannot finish the new task');actual.pending[1]();const ready=await actual.wait(id,'ready');assert.equal(ready.calls_used,2);assert.equal(actual.coreDescriptors.size,0);
});
