import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {loadApp} from './load-app.mjs';
import {setupMaterialStore} from './material-fixture.mjs';

const require=createRequire(import.meta.url),ts=require(`${process.env.DEVECO_HOME||'D:/APP/DevEcoStudio'}/sdk/default/openharmony/ets/build-tools/ets-loader/node_modules/typescript`);
const source=fs.readFileSync(new URL('../entry/src/main/ets/pages/JournalPanel.ets',import.meta.url),'utf8');
const DAY=new Date(2026,9,16).getTime(),clone=value=>JSON.parse(JSON.stringify(value));
function method(name){const match=new RegExp(`^  (?:private )?(?:async )?${name}\\(`,'m').exec(source);assert(match,'actual page method missing '+name);
 const after=source.slice(match.index+match[0].length),next=/\n  (?:private |aboutTo|@Builder|[A-Za-z][A-Za-z0-9_]*\()/.exec(after);assert(next,'method boundary missing '+name);return source.slice(match.index,match.index+match[0].length+next.index);}
const names=['localQuery','invalidateLocalSearch','changeQueryKeyword','changeQuerySpeaker','selectDay','clearLocalSearch','refreshEntries','searchLocal','queryCoverage','openQueryReference','viewText','refresh','recount','atDay','dayEntries','clock','aboutToDisappear'];
const begin=source.indexOf('class JournalEntry {'),end=source.indexOf('\n@Component',begin);assert(begin>=0&&end>begin);
const compiled=ts.transpileModule(source.slice(begin,end)+`\nclass Page {\n${names.map(method).join('\n')}\n}\nmodule.exports=Page;`,{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS}}).outputText;

// Actual Journal events, MaterialStore, catalog fencing, scan budgets and exact
// reference resolution. D: IO is real; only native UI/service shells are ports.
function fixture(t){
 const f=setupMaterialStore(t);assert.match(path.resolve(f.root),/^[Dd]:[\\/]/);
 f.io.lstatSync=p=>{const value=fs.lstatSync(p);return Object.assign(value,{mtime:value.mtimeMs,ctime:value.ctimeMs});};
 // Keep actual short writes for the large budget cases without one syscall
 // for every 37 bytes of synthetic text.
 f.io.writeSync=(fd,buffer)=>fs.writeSync(fd,new Uint8Array(buffer).slice(0,4093));
 const query=loadApp('MaterialLocalQuery',{'@kit.CoreFileKit':{fileIo:f.io}}),calls=[],filters=[];
 class ObservedQuery extends query.LocalMaterialQuery{scan(filter){filters.push(clone(filter));return super.scan(filter);}}
 const materials={ids:()=>f.store.ids(),idFor:(...args)=>f.store.idFor(...args),read(id){calls.push(['read',id]);return f.store.read(id);},queryCatalog(){calls.push(['catalog']);return f.store.queryCatalog();}};
 const recordings={items:[],active:false,stopping:false,changed(){},refresh(){},textPath(){assert.fail('legacy ASR must not be used');}},
  lifelog={items:[],busy:false,active:false,dayEnabled:false,bytes:0,emptySegments:0,capturePhase:'idle',note:'capture unchanged',changed(){},refresh(){},readText(){assert.fail('legacy ASR must not be used');}},lifelogASR={busy:false,progress:0,changed(){}};
 const playbackCalls=[],module={exports:{}};
 vm.runInNewContext(compiled,{...query,module,exports:module.exports,LocalMaterialQuery:ObservedQuery,materials,recordings,lifelog,lifelogASR,Map,Date,JSON,Error,
  localPlayback:{suspend:reason=>{playbackCalls.push(reason);return Promise.resolve({});}},materialSyncService:{view:()=>({state:'local',storedRevision:0})},localQueueSize:()=>0,localCurrentDirectory:()=>'',localQueuedDirectories:()=>[],
  util:{TextEncoder:class{encodeInto(text){return new TextEncoder().encode(text);}}},cryptoFramework:{createMd:()=>{const hash=createHash('sha256');return{updateSync:input=>hash.update(input.data),digestSync:()=>({data:Uint8Array.from(hash.digest())})};}},
  localMaterialRevision(){assert.fail('query-resolved source must not be reread through an older facade');},fs:{readTextSync(){assert.fail('legacy ASR must not be used');}},cancelRecordingCloudTranscription(){},cancelLifelogManualPublication(){}});
 const page=new module.exports();Object.assign(page,{playbackUnsubscribe(){},visible:true,actionEpoch:1,busy:false,selected:DAY,entries:[],dayKeys:new Map(),queryKeyword:'',querySpeaker:'',queryPage:undefined,queryNote:'',querySignature:'',querySourcesSignature:'',queryCheckedRaw:new Map(),queryOpenedKey:'',text:'',textKind:'',textName:'',textRevision:0,textNeedsFull:false,fullText:false,collectPendingVoices(){}});
 function add(n,{text='普通合成文字',started=DAY+1000,parts}={}){
  const original=new f.MaterialSource();Object.assign(original,{kind:'recording',name:'take-'+n.toString(16).padStart(32,'0'),started,ended:started+60000,complete:true,audioAvailable:false,audioBytes:0,audioFrames:3000,frameMs:20});
  const base=f.store.ensure(original),input=new f.MaterialTextInput();Object.assign(input,{text,channel:'mix',transcriptionState:'complete',coveredMs:60000,sourceMs:60000,speakerProcessing:'unavailable',boundaryProcessing:'token_starts'});
  input.utterances=(parts===undefined?(text.length<=65536?[{text,start_ms:1000,end_ms:2000}]:[]):parts).map(part=>Object.assign(new f.MaterialUtterance(),part));
  const head=f.store.appendTranscript(base.material_id,1,input,'synthetic-scan-'+n);recordings.items.push({name:original.name,created:started,ended:started+60000,bytes:0,textFile:'unused-legacy.md',complete:true});return{id:head.material_id,head,source:original};
 }
 const start=keyword=>{page.changeQueryKeyword(keyword);page.searchLocal();assert(page.queryPage,page.queryNote);return page.queryPage;};
 const bytes=()=>f.store.ids().map(id=>[id,...fs.readdirSync(f.root+'/materials/'+id).sort().map(name=>[name,createHash('sha256').update(fs.readFileSync(f.root+'/materials/'+id+'/'+name)).digest('hex')])]);
 return{...f,...query,page,materials,recordings,lifelog,filters,calls,playbackCalls,add,start,bytes};
}

test('ordinary page separates hit paging from scan continuation and reaches the 513th source on a later selected day',t=>{
 const f=fixture(t),parts=Array.from({length:11},(_,n)=>({text:'发货命中 '+n,start_ms:n*1000,end_ms:n*1000+500}));
 f.add(1,{text:parts.map(part=>part.text).join('\n'),parts});for(let n=2;n<=512;n++)f.add(n);
 const final=f.add(513,{started:DAY+86400000+1000,text:'发货；第513条唯一词'});f.page.refresh();const before=f.bytes(),timeline=clone(f.page.dayEntries(DAY));
 const first=f.start('发货');assert.equal(first.hits.length,10);assert.equal(first.has_more,true);assert.equal(first.scan_has_more,true);assert.equal(first.window_start,0);assert.equal(first.window_end,512);assert.equal(first.scanned,512);assert(first.content_units<=2097152);
 const oldReference=clone(first.hits[0].reference),token=first.scan_cursor;f.page.openQueryReference(oldReference);assert(f.page.text);
 f.page.searchLocal(true);const second=f.page.queryPage;assert.equal(second.window_start,0);assert.equal(second.scan_cursor,token);assert.equal(second.hits.length,1);assert.equal(second.has_more,false);assert.equal(second.scan_has_more,true);assert.equal(f.page.text,'');
 assert.equal(f.filters.at(-1).scan_cursor,token);assert.equal(f.filters.at(-1).hit_cursor,first.next_cursor);
 f.page.searchLocal(false,true);assert.equal(f.page.queryPage.window_start,512);assert.equal(f.page.queryPage.window_end,513);assert.equal(f.page.queryPage.hits.length,0);assert.equal(f.page.queryPage.scan_has_more,false);assert.equal(f.page.queryPage.incomplete,true);assert.equal(f.filters.at(-1).hit_cursor,'');
 assert.match(f.page.queryCoverage(),/此前窗口的命中未在这里汇总/);assert.match(f.page.queryCoverage(),/不代表全库最新排序/);assert.deepEqual(clone(f.page.dayEntries(DAY)),timeline);
 f.page.selectDay(DAY+86400000);const empty=f.start('第513条唯一词');assert.equal(empty.hits.length,0);assert.equal(empty.has_more,false);assert.equal(empty.scan_has_more,true);assert.match(f.page.queryNote,/本窗口内没有匹配/);assert.match(f.page.queryCoverage(),/仍有后续资料未扫描/);
 f.page.searchLocal(false,true);const reached=f.page.queryPage;assert.equal(reached.hits.length,1);assert.equal(reached.hits[0].reference.material_id,final.id);assert.equal(reached.window_start,512);assert.equal(reached.scan_has_more,false);assert.equal(reached.incomplete,true);
 f.page.openQueryReference(reached.hits[0].reference);assert.equal(f.page.text,final.head.text);assert.equal(f.page.textRevision,2);assert.equal(f.page.dayEntries(DAY+86400000).length,1);
 f.page.openQueryReference(oldReference);assert.equal(f.page.queryPage,undefined);assert.equal(f.page.text,'');assert.match(f.page.queryNote,/原文已修改、删除或暂不可读/);assert.deepEqual(f.bytes(),before);
});

test('ordinary page continues after a shared UTF16 text budget without treating UTF8 bytes as text units',t=>{
 const f=fixture(t),body='中🙂'.repeat(200000);for(let n=1;n<=3;n++)f.add(n,{text:body});const target=f.add(4,{text:body+' 预算之后的唯一词'});f.page.refresh();const before=f.bytes();
 const page=f.start('预算之后的唯一词');assert.equal(page.hits.length,0);assert.equal(page.stop_reason,'text_limit');assert.equal(page.window_end,3);assert.equal(page.scanned,4);assert(page.content_units>1800000&&page.content_units<=2097152);assert.equal(page.scan_has_more,true);assert.match(f.page.queryCoverage(),/文字扫描上限/);
 f.page.searchLocal(false,true);assert.equal(f.page.queryPage.window_start,3);assert.equal(f.page.queryPage.window_end,4);assert.equal(f.page.queryPage.hits.length,1);assert.equal(f.page.queryPage.hits[0].reference.material_id,target.id);assert.equal(f.page.queryPage.scan_has_more,false);assert.equal(f.page.queryPage.incomplete,true);assert.match(f.page.queryCoverage(),/此前窗口/);assert.deepEqual(f.bytes(),before);
});

test('ordinary page explicitly skips an individually oversized source and still offers continuation to later readable text',t=>{
 const f=fixture(t),parts=Array.from({length:18},(_,n)=>({text:'x'.repeat(65536),start_ms:n*1000,end_ms:n*1000+500}));
 const oversized=f.add(1,{text:'a'.repeat(1000000),parts}),target=f.add(2,{text:'超大资料之后的唯一词'});assert(JSON.stringify(oversized.head).length>2097152);f.page.refresh();const before=f.bytes();
 let page=f.start('超大资料之后的唯一词');assert.equal(page.oversized,1);assert.equal(page.incomplete,true);assert.equal(page.incomplete_reason,'oversized');assert.match(f.page.queryCoverage(),/超过单条扫描预算，已跳过/);assert.match(f.page.queryCoverage(),/不能视为已查询全文/);assert(page.content_units<=2097152);assert(page.scanned<=512);
 if(page.scan_has_more){f.page.searchLocal(false,true);page=f.page.queryPage;}
 assert.equal(page.hits.length,1);assert.equal(page.hits[0].reference.material_id,target.id);assert.deepEqual(f.bytes(),before);
});

test('actual source deletion before continuation clears the old window instead of joining stale results',t=>{
 const f=fixture(t),body='z'.repeat(750000),first=f.add(1,{text:body});f.add(2,{text:body});f.add(3,{text:body+' 后续命中'});f.page.refresh();const page=f.start('后续命中');assert(page.scan_has_more);
 f.store.delete(first.id,first.head.revision);f.page.searchLocal(false,true);assert.equal(f.page.queryPage,undefined);assert.equal(f.page.querySignature,'');assert.equal(f.page.text,'');assert.match(f.page.queryNote,/资料或查询条件已变化/);assert.equal(f.store.read(first.id).operation,'delete');
});

test('filter changes, explicit refresh and page leave discard continuation without automatically rescanning',t=>{
 const f=fixture(t);f.add(1,{text:'当前词'});f.page.refresh();f.start('当前词');const count=f.filters.length;f.page.changeQuerySpeaker('另一说话人');assert.equal(f.page.queryPage,undefined);assert.equal(f.filters.length,count);
 f.page.searchLocal(false,true);assert.equal(f.page.queryPage,undefined);assert.equal(f.filters.length,count);assert.match(f.page.queryNote,/条件已变化/);
 f.page.changeQuerySpeaker('');f.start('当前词');f.page.refreshEntries();assert.equal(f.page.queryPage,undefined);const after=f.filters.length;f.page.searchLocal(false,true);assert.equal(f.filters.length,after);
 f.start('当前词');f.page.aboutToDisappear();assert.equal(f.page.queryPage,undefined);const left=f.filters.length;f.page.searchLocal(false,true);assert.equal(f.filters.length,left);
});

test('catalog failure clears old source text and keeps raw filesystem errors out of normal page feedback',t=>{
 const f=fixture(t);f.add(1,{text:'当前词'});f.page.refresh();const page=f.start('当前词');f.page.openQueryReference(page.hits[0].reference);assert(f.page.text);
 f.materials.queryCatalog=()=>{throw Error('D:/private/catalog secret=synthetic');};f.page.searchLocal();assert.equal(f.page.queryPage,undefined);assert.equal(f.page.text,'');assert.match(f.page.queryNote,/目录暂不可读取/);assert.doesNotMatch(f.page.queryNote,/private|secret=|D:\//);
});

test('normal builder provides separate current-window paging and later-source scanning controls',()=>{
 assert.match(source,/Button\('本窗口下一页'\)/);assert.match(source,/Button\('继续扫描后续资料'\)/);assert.match(source,/this\.searchLocal\(false,true\)/);
 assert.match(source,/this\.queryPage\?\.has_more/);assert.match(source,/this\.queryPage\?\.scan_has_more/);assert.match(source,/ForEach\(this\.dayEntries\(this\.selected\)/);assert.match(source,/this\.localQuery\(\)\.resolve\(reference\)/);
});
