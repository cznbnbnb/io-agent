import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {loadApp} from './load-app.mjs';
import {setupMaterialStore} from './material-fixture.mjs';

const require=createRequire(import.meta.url),deveco=process.env.DEVECO_HOME||'D:/APP/DevEcoStudio';
const ts=require(`${deveco}/sdk/default/openharmony/ets/build-tools/ets-loader/node_modules/typescript`);
const source=fs.readFileSync(new URL('../entry/src/main/ets/pages/JournalPanel.ets',import.meta.url),'utf8');
const clone=value=>JSON.parse(JSON.stringify(value));
const DAY=new Date(2026,9,14).getTime(),settle=()=>new Promise(setImmediate);
function method(name){
 const match=new RegExp(`^  (?:private )?(?:async )?${name}\\(`,'m').exec(source);assert(match,'actual Journal method missing: '+name);
 const after=source.slice(match.index+match[0].length),next=/\n  (?:private |aboutTo|@Builder|[A-Za-z][A-Za-z0-9_]*\()/.exec(after);
 assert(next,'actual method boundary missing: '+name);return source.slice(match.index,match.index+match[0].length+next.index);
}

// Query and MaterialStore are the real production modules. Only page/platform
// boundaries are explicit substitutes; all fixture files stay in owned D: dirs.
// No device, network, ASR, model, user files or UI builder execution is involved.
function fixture(t){
 const f=setupMaterialStore(t);assert.match(path.resolve(f.root),/^[Dd]:[\\/]/);
 // Harmony Stat times are numeric; retain real D: metadata rather than
 // substituting a catalog digest or a fixed clock.
 f.io.lstatSync=p=>{const value=fs.lstatSync(p);return Object.assign(value,{mtime:value.mtimeMs,ctime:value.ctimeMs});};
 const playbackCalls=[],localPlayback={snapshot:()=>({}),subscribe:()=>()=>{playbackCalls.push('unsubscribe');},suspend:reason=>{playbackCalls.push(['suspend',reason]);return Promise.resolve({});},stopSource:(kind,name)=>{playbackCalls.push(['stop-source',kind,name]);return Promise.resolve({});}};
 const query=loadApp('MaterialLocalQuery',{'@kit.CoreFileKit':{fileIo:f.io}}),calls=[],dialogs=[],toasts=[];
 class ObservedQuery extends query.LocalMaterialQuery{scan(filter){try{return super.scan(filter);}catch(error){calls.push(['query-error',error.message]);throw error;}}}
 const recordings={items:[],changed(){},active:false,stopping:false,refresh(){},textPath(){calls.push('legacy-recording');return'/forbidden/old-asr.md';}},
  lifelog={items:[],changed(){},note:'capture unchanged',active:false,dayEnabled:false,bytes:0,emptySegments:0,capturePhase:'idle',
   readText(){calls.push('legacy-lifelog');return'forbidden stale ASR';},readTranscriptJson(){calls.push('legacy-speaker');return'';}},
  lifelogASR={busy:false,progress:0,changed(){}};
 let missingId='',readFailure='';
 const materials={ids(){calls.push('ids');return f.store.ids();},queryCatalog(){calls.push('catalog');return f.store.queryCatalog();},
  read(id){calls.push(['read-current',id]);if(id===readFailure)throw Error('synthetic current read failed');return id===missingId?undefined:f.store.read(id);},idFor:(...args)=>f.store.idFor(...args)};
 const remove=(kind,item)=>{calls.push(['delete',kind,item.name]);const id=f.store.idFor(kind,item.name),head=f.store.read(id);f.store.delete(id,head.revision);
  const service=kind==='lifelog'?lifelog:recordings;service.items=service.items.filter(row=>row.name!==item.name);};
 lifelog.remove=item=>remove('lifelog',item);recordings.remove=item=>remove('recording',item);
 const names=['localQuery','invalidateLocalSearch','changeQueryKeyword','changeQuerySpeaker','selectDay','clearLocalSearch','refreshEntries','searchLocal','queryCoverage',
  'queryHitLabel','openQueryReference','selectedMaterialChanged','viewText','refresh','recount','atDay','dayEntries','clock','aboutToDisappear','run','clearDeletedSelection','confirmRemove'];
 const entryStart=source.indexOf('class JournalEntry {'),entryEnd=source.indexOf('\n@Component',entryStart);assert(entryStart>=0&&entryEnd>entryStart);
 const compiled=ts.transpileModule(source.slice(entryStart,entryEnd)+`\nclass Page {\n${names.map(method).join('\n')}\n}\nmodule.exports=Page;`,
  {compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS}}).outputText;
 const sync={view:()=>({state:'local',storedRevision:0})},module={exports:{}};
 vm.runInNewContext(compiled,{...query,LocalMaterialQuery:ObservedQuery,module,exports:module.exports,localPlayback,materials,recordings,lifelog,lifelogASR,Map,Date,JSON,Error,
  localQueueSize:()=>0,localCurrentDirectory:()=>'',localQueuedDirectories:()=>[],materialSyncService:sync,
  util:{TextEncoder:class{encodeInto(value){return new TextEncoder().encode(value);}}},
  cryptoFramework:{createMd:()=>{const hash=createHash('sha256');return{updateSync:value=>hash.update(value.data),digestSync:()=>({data:Uint8Array.from(hash.digest())})};}},
  localMaterialRevision(kind,name){calls.push('ordinary-canonical');return f.store.read(f.store.idFor(kind,name));},
  fs:{readTextSync(){calls.push('legacy-fs');return'forbidden stale ASR';}},
  cancelRecordingCloudTranscription(){calls.push('cancel-cloud');},cancelLifelogManualPublication(){calls.push('cancel-manual');}});
 const page=new module.exports();Object.assign(page,{playbackUnsubscribe(){playbackCalls.push('unsubscribe');},visible:true,actionEpoch:1,busy:false,selected:DAY,entries:[],dayKeys:new Map(),
  queryKeyword:'',querySpeaker:'',queryPage:undefined,queryNote:'',querySignature:'',querySourcesSignature:'',queryOpenedKey:'',text:'existing detail',textKind:'',textName:'',textRevision:0,textNeedsFull:false,fullText:false,
  collectPendingVoices(){},getUIContext:()=>({showAlertDialog:d=>dialogs.push(d),getPromptAction:()=>({showToast:v=>toasts.push(v.message)})})});
 function add(n,{kind='recording',started=DAY+1000,ended=started+60000,text='明天发货，运费沿用上次',parts,
   speakers=[{speaker_id:'speaker-0',label:'同事甲',label_basis:'user_confirmed',is_self:false}],state='complete'}={}){
  const original=new f.MaterialSource();Object.assign(original,{kind,name:(kind==='lifelog'?'seg-':'take-')+n.toString(16).padStart(32,'0'),
   started,ended,complete:true,audioAvailable:false,audioBytes:0,audioFrames:3000,frameMs:20});
  const base=f.store.ensure(original),speakerIds=new Map(speakers.map((speaker,index)=>[speaker.speaker_id,base.material_id+'-s'+index.toString(16).padStart(12,'0')]));
  const input=new f.MaterialTextInput();Object.assign(input,{text,channel:'mix',speakers:speakers.map(speaker=>({...clone(speaker),speaker_id:speakerIds.get(speaker.speaker_id)})),
   transcriptionState:state,coveredMs:60000,sourceMs:60000,speakerProcessing:'processed',boundaryProcessing:'token_starts'});
  input.utterances=(parts??[{text,start_ms:1000,end_ms:2000,speaker_id:'speaker-0',speaker_basis:'segment_cluster'}]).map(value=>Object.assign(new f.MaterialUtterance(),value,{speaker_id:speakerIds.get(value.speaker_id)||value.speaker_id}));
  const head=f.store.appendTranscript(base.material_id,1,input,'synthetic-asr-'+n),item={name:original.name,created:started,ended,bytes:0,hasText:true,textFile:'old.md',complete:true};
  (kind==='lifelog'?lifelog:recordings).items.push(item);page.refresh();return{head,item,kind,id:head.material_id};
 }
 const start=(keyword='发货',speaker='')=>{page.changeQueryKeyword(keyword);page.changeQuerySpeaker(speaker);page.searchLocal();assert(page.queryPage,JSON.stringify(calls.filter(call=>call[0]==='query-error')));return page.queryPage;};
 const bytes=()=>{const result=[];for(const id of f.store.ids())for(const name of fs.readdirSync(f.root+'/materials/'+id)){
  const file=f.root+'/materials/'+id+'/'+name;if(fs.statSync(file).isFile())result.push([id+'/'+name,fs.readFileSync(file).toString('hex')]);}return result;};
 return{...f,...query,page,materials,recordings,lifelog,lifelogASR,sync,calls,dialogs,toasts,add,start,bytes,
  setMissing:id=>missingId=id,setReadFailure:id=>readFailure=id,extraIds:values=>{for(const id of values)fs.mkdirSync(f.root+'/materials/'+id);},
  current:id=>f.store.read(id),edit:(id,text)=>{const head=f.store.read(id);return f.store.correctText(id,head.revision,head.utterances[0].utterance_id,text);}};
}

test('ordinary selected-day query uses canonical same-utterance text and speaker while keeping the complete timeline and source bytes',t=>{
 const f=fixture(t),a=f.add(1),b=f.add(2,{text:'其他完整记录'});f.add(3,{started:DAY-86400000+1000});
 f.add(4,{speakers:[{speaker_id:'a',label:'同事乙',label_basis:'user_confirmed',is_self:false},{speaker_id:'b',label:'同事甲',label_basis:'user_confirmed',is_self:false}],
  parts:[{text:'发货',start_ms:1000,end_ms:2000,speaker_id:'a',speaker_basis:'segment_cluster'},{text:'以后再说',start_ms:2000,end_ms:3000,speaker_id:'b',speaker_basis:'segment_cluster'}]});
 const timeline=clone(f.page.dayEntries(DAY)),before=f.bytes(),page=f.start('发货','同事甲');
 assert.equal(page.scope,'local_canonical_window');assert.equal(page.hits.length,1);assert.equal(page.hits[0].reference.material_id,a.id);
 assert.equal(page.hits[0].reference.revision,2);assert.match(page.hits[0].excerpt,/发货/);assert.equal(page.hits[0].speaker_label,'同事甲');
 assert.deepEqual(clone(f.page.dayEntries(DAY)),timeline);assert.equal(timeline.length,3);assert(timeline.some(row=>row.key.endsWith(b.item.name)));
 assert.deepEqual(f.bytes(),before);assert.equal(f.calls.some(call=>typeof call==='string'&&call.startsWith('legacy-')),false);
});

test('changing query inputs or selected day invalidates visible hits and never automatically runs another query',t=>{
 const f=fixture(t);f.add(1);f.start();let reads=f.calls.length;
 f.page.changeQueryKeyword('运费');assert.equal(f.page.queryPage,undefined);assert.equal(f.calls.length,reads);assert.equal(f.page.queryKeyword,'运费');
 f.page.searchLocal();assert.equal(f.page.queryPage.hits.length,1);reads=f.calls.length;f.page.changeQuerySpeaker('另一人');
 assert.equal(f.page.queryPage,undefined);assert.equal(f.calls.length,reads);f.page.changeQuerySpeaker('同事甲');f.page.searchLocal();
 reads=f.calls.length;f.page.selectDay(DAY+86400000);assert.equal(f.page.queryPage,undefined);assert.equal(f.calls.length,reads);
 assert.equal(f.page.selected,DAY+86400000);assert.equal(f.page.queryKeyword,'运费');assert.equal(f.page.querySpeaker,'同事甲');
 f.page.clearLocalSearch();assert.equal(f.page.queryKeyword,'');assert.equal(f.page.querySpeaker,'');assert.equal(f.page.queryNote,'');assert.equal(f.page.entries.length,1);
});

test('next page uses the current source snapshot and rejects stale data instead of retaining old hits',t=>{
 const f=fixture(t),parts=Array.from({length:11},(_,n)=>({text:'发货条件 '+n,start_ms:n*1000,end_ms:n*1000+500,speaker_id:'speaker-0',speaker_basis:'segment_cluster'}));
 const a=f.add(1,{text:parts.map(row=>row.text).join('\n'),parts});let page=f.start();assert.equal(page.hits.length,10);assert.equal(page.has_more,true);
 const first=page.hits.map(hit=>hit.reference.utterance_id);f.page.searchLocal(true);page=f.page.queryPage;assert.equal(page.hits.length,1);assert.equal(page.has_more,false);
 assert(!first.includes(page.hits[0].reference.utterance_id));f.page.searchLocal();f.edit(a.id,'更新后的发货条件');f.page.searchLocal(true);
 assert.equal(f.page.queryPage,undefined);assert.match(f.page.queryNote,/已变化.*重新查询/);
});

test('view original resolves the current exact local ref and uses existing canonical detail without a legacy reread',t=>{
 const f=fixture(t),a=f.add(1),page=f.start(),reference=clone(page.hits[0].reference);f.calls.length=0;
 f.page.openQueryReference(reference);assert.equal(f.page.text,a.head.text);assert.equal(f.page.textName,a.item.name);assert.equal(f.page.textKind,'recording');assert.equal(f.page.textRevision,2);
 assert.match(f.page.queryNote,/当前本机资料修订 v2/);assert.equal(f.calls.includes('ordinary-canonical'),false);
 assert.equal(f.calls.some(call=>typeof call==='string'&&call.startsWith('legacy-')),false);assert.deepEqual(clone(page.hits[0].reference),reference);
});

test('a cross-midnight hit opens its source from all entries while the ordinary selected-day timeline is unchanged',t=>{
 const f=fixture(t),a=f.add(1,{started:DAY-10000,ended:DAY+50000,parts:[{text:'本日发货',start_ms:15000,end_ms:16000,speaker_id:'speaker-0',speaker_basis:'segment_cluster'}]});
 assert.equal(f.page.dayEntries(DAY).length,0);const page=f.start();assert.equal(page.hits.length,1);
 f.page.openQueryReference(page.hits[0].reference);assert.equal(f.page.textName,a.item.name);assert.equal(f.page.text,a.head.text);assert.equal(f.page.dayEntries(DAY).length,0);
});

test('deleted, missing, unreadable or changed current sources cannot reopen historical text from a prior query',async t=>{
 for(const failure of ['delete','missing','unreadable','revision','same_revision','removed_timeline'])await t.test(failure,t=>{
  const f=fixture(t),a=f.add(1),page=f.start(),reference=clone(page.hits[0].reference);
  if(failure==='delete')f.store.delete(a.id,2);else if(failure==='missing')f.setMissing(a.id);else if(failure==='unreadable')f.setReadFailure(a.id);
  else if(failure==='revision')f.edit(a.id,'新修订发货');else if(failure==='removed_timeline')f.page.entries=[];
  else{const file=f.root+'/materials/'+a.id+'/revision-000000002.json',head=f.current(a.id);head.text='同修订外来写入';fs.writeFileSync(file,JSON.stringify(head));}
  f.page.openQueryReference(reference);assert.equal(f.page.queryPage,undefined);assert.equal(f.page.text,'');assert.equal(f.page.textName,'');assert.equal(f.page.textRevision,0);
  assert.match(f.page.queryNote,/原文已修改、删除或暂不可读/);assert.equal(f.calls.some(call=>typeof call==='string'&&call.startsWith('legacy-')),false);
 });
});

test('old-page refs or a programmatically changed filter cannot bypass current page membership and signature',t=>{
 const f=fixture(t),a=f.add(1),page=f.start(),ref=clone(page.hits[0].reference);ref.utterance_id='foreign-utterance';f.page.openQueryReference(ref);
 assert.equal(f.page.queryPage,undefined);assert.equal(f.page.text,'');f.start();const current=clone(f.page.queryPage.hits[0].reference);
 f.page.querySpeaker='changed-without-event';f.page.openQueryReference(current);assert.equal(f.page.queryPage,undefined);assert.equal(f.page.text,'');
 assert.equal(f.current(a.id).revision,2);
});

test('explicit refresh, accepted delete, edit and page leave invalidate search without changing the underlying normal actions',async t=>{
 const f=fixture(t),a=f.add(1);f.start();f.page.refreshEntries();assert.equal(f.page.queryPage,undefined);assert.match(f.page.queryNote,/刷新/);
 f.start();const changed=f.edit(a.id,'新的完整发货条件');f.page.selectedMaterialChanged(changed);assert.equal(f.page.queryPage,undefined);
 assert.equal(f.page.text,changed.text);assert.equal(f.page.textRevision,3);f.start();f.page.confirmRemove(f.page.entries[0]);assert.equal(f.dialogs.length,1);
 f.dialogs[0].secondaryButton.action();await settle();assert.equal(f.page.queryPage,undefined);assert.equal(f.current(a.id).operation,'delete');
 assert(f.calls.some(call=>Array.isArray(call)&&call[0]==='delete'));assert.equal(f.page.busy,false);
 f.page.queryPage=new f.LocalMaterialScanPage();f.page.querySignature='old';f.page.aboutToDisappear();assert.equal(f.page.queryPage,undefined);assert.equal(f.page.querySignature,'');
 assert(f.calls.includes('cancel-cloud'));assert(f.calls.includes('cancel-manual'));
});

test('capture state-only refresh preserves query and opened canonical text without a second source scan',t=>{
 const f=fixture(t),a=f.add(1),page=f.start(),reference=clone(page.hits[0].reference);f.page.openQueryReference(reference);const before=f.bytes(),signature=f.page.querySignature;
 for(const stage of ['receiving','recording','stopping']){
  f.calls.length=0;f.lifelog.bytes+=240;f.lifelog.capturePhase=stage;f.lifelog.note='实时接收状态 '+stage;f.lifelog.active=true;
  f.recordings.items[0].bytes+=240;f.recordings.active=true;f.recordings.stopping=stage==='stopping';f.lifelogASR.progress+=10;
  f.page.refresh();assert.equal(f.page.queryPage,page,'status notifications must not dismiss unchanged matches');assert.equal(f.page.querySignature,signature);
  assert.equal(f.page.text,a.head.text);assert.equal(f.page.llPhase,stage);assert.equal(f.page.llBytes,f.lifelog.bytes);assert.equal(f.page.progress,f.lifelogASR.progress);
  assert.equal(f.calls.filter(call=>Array.isArray(call)&&call[0]==='read-current').length,1,'reuse the normal refresh canonical read');assert.equal(f.calls.includes('ids'),false);
 }
 f.sync.view=()=>({state:'server_stored',revision:2,storedRevision:2});f.page.refresh();assert.equal(f.page.queryPage,page);
 f.sync.view=()=>{throw Error('synthetic sync status unavailable');};f.page.refresh();assert.equal(f.page.queryPage,page,'sync observation is not a canonical source edit');
 assert.deepEqual(f.bytes(),before);
});

test('real canonical changes invalidate query and any text opened from it while preserving source bytes',async t=>{
 for(const change of ['revision','same_revision','delete','new_source','missing','removed_membership'])await t.test(change,t=>{
  const f=fixture(t),a=f.add(1),page=f.start();f.page.openQueryReference(page.hits[0].reference);
  const original=f.root+'/materials/'+a.id+'/revision-000000002.json',before=fs.readFileSync(original);
  if(change==='revision')f.edit(a.id,'修改后的发货');else if(change==='same_revision'){const row=f.current(a.id);row.text='同修订被更改';fs.writeFileSync(original,JSON.stringify(row));}
  else if(change==='delete')f.store.delete(a.id,2);else if(change==='new_source')f.add(2);else if(change==='missing')f.setMissing(a.id);else f.recordings.items=[];
  f.page.refresh();assert.equal(f.page.queryPage,undefined);assert.equal(f.page.querySignature,'');assert.equal(f.page.text,'','changed source cannot leave old query detail visible');
  assert.equal(f.page.textName,'');assert.equal(f.page.textRevision,0);assert.match(f.page.queryNote,/资料.*变化|资料.*更新/);
  if(change!=='same_revision')assert.deepEqual(fs.readFileSync(original),before);
 });
});

test('canonical read failure clears old query detail but does not load legacy or publish a replacement',t=>{
 const f=fixture(t),a=f.add(1),page=f.start();f.page.openQueryReference(page.hits[0].reference);const before=f.bytes();f.setReadFailure(a.id);f.calls.length=0;
 f.page.refresh();assert.equal(f.page.queryPage,undefined);assert.equal(f.page.text,'');assert.equal(f.page.textRevision,0);assert.match(f.page.queryNote,/不可读|读取|核对/);
 assert.equal(f.calls.filter(call=>Array.isArray(call)&&call[0]==='read-current').length,1);assert.equal(f.calls.includes('ids'),false);assert.deepEqual(f.bytes(),before);
 assert.equal(f.calls.some(call=>typeof call==='string'&&call.startsWith('legacy-')),false);
});

test('first unprimed source refresh is conservative and a later ordinary detail is not cleared by unrelated query invalidation',t=>{
 const f=fixture(t),a=f.add(1),page=f.start();f.page.openQueryReference(page.hits[0].reference);f.page.querySourcesSignature='';f.page.refresh();
 assert.equal(f.page.queryPage,undefined);assert.equal(f.page.text,'');
 f.start();f.page.openQueryReference(f.page.queryPage.hits[0].reference);f.page.viewText(f.page.entries[0]);const text=f.page.text;
 f.edit(a.id,'修改后的发货');f.page.refresh();assert.equal(f.page.queryPage,undefined);assert.equal(f.page.text,text,'ordinary nonquery detail retains its existing refresh policy');
});

test('the normal refresh button clears results even if a source directory refresh fails',t=>{
 const f=fixture(t);f.add(1);f.start();f.recordings.refresh=()=>{throw Error('synthetic directory unavailable');};
 f.page.refreshEntries();assert.equal(f.page.queryPage,undefined);assert.equal(f.page.querySignature,'');assert.equal(f.page.note,'目录暂不可读取');assert.equal(f.page.entries.length,1);
});

test('empty single-utterance correction updates actual selected detail to the new empty canonical body',t=>{
 const f=fixture(t),a=f.add(1),page=f.start();f.page.openQueryReference(page.hits[0].reference);assert.equal(f.page.text,a.head.text);
 const originalFile=f.root+'/materials/'+a.id+'/revision-000000002.json',original=fs.readFileSync(originalFile),changed=f.edit(a.id,'');
 assert.equal(changed.text,'');assert.equal(changed.utterances[0].text,'');assert.equal(changed.revision,3);assert.equal(changed.user_edited,true);
 f.calls.length=0;f.page.selectedMaterialChanged(changed);
 assert.equal(f.page.text,'','the existing detail must not label an old nonempty body as the new revision');assert.equal(f.page.textRevision,3);
 assert.equal(f.page.queryPage,undefined);assert.equal(f.page.querySignature,'');assert.match(f.page.queryNote,/资料已修改/);
 assert.deepEqual(fs.readFileSync(originalFile),original);assert.equal(f.current(a.id).text,'');
 assert.equal(f.calls.includes('ordinary-canonical'),false);assert.equal(f.calls.some(call=>typeof call==='string'&&call.startsWith('legacy-')),false);
});

test('partial scan and legacy scope remain explicit even for an empty result',t=>{
 const f=fixture(t);f.add(1);f.extraIds(['mat-recording-'+'f'.repeat(32)]);let page=f.start('不存在的关键词');
 assert.equal(page.hits.length,0);assert.equal(page.incomplete,true);assert.equal(page.unreadable,1);assert.match(f.page.queryNote,/没有匹配/);
 assert.match(f.page.queryCoverage(),/未含旧格式资料/);assert.match(f.page.queryCoverage(),/结果不完整/);assert.match(f.page.queryCoverage(),/1 条资料/);
 for(const [reason,label]of[['scan_limit','资料扫描上限'],['text_limit','文字扫描上限'],['unreadable','暂不可读取']]){
  page.stop_reason=reason==='unreadable'?'end':reason;page.incomplete_reason=reason==='unreadable'?'unreadable':'window_only';assert.match(f.page.queryCoverage(),new RegExp(label));
 }
 assert.doesNotMatch(f.page.queryCoverage(),/全部资料已查完|服务器已同步/);
});

test('split, unknown and candidate speaker labels preserve uncertainty instead of inventing time or personal identity',t=>{
 const f=fixture(t),hit=new f.LocalMaterialHit();hit.speaker_label='老板';hit.label_basis='role_match';hit.is_self=true;hit.start_ms=null;hit.end_ms=null;
 hit.reference.source_range={parent_revision:2,parent_utterance_id:'parent',start_ms:10,end_ms:20,text_start:0,text_end:1};hit.overlap=true;hit.transcription_state='partial';
 const label=f.page.queryHitLabel(hit);assert.match(label,/角色候选，身份未确认/);assert.match(label,/句内时间未确定，仅引用父句范围/);assert.match(label,/重叠发言/);assert.match(label,/文字覆盖未完整/);
 assert.doesNotMatch(label,/确认为本人|00:00/);assert.match(label,/原音当前不可用/);hit.speaker_label='';hit.speaker_id='';hit.label_basis='anonymous';hit.is_self=false;
 assert.match(f.page.queryHitLabel(hit),/说话人未确定/);hit.speaker_label='本人';hit.label_basis='user_confirmed';hit.is_self=true;
 assert.match(f.page.queryHitLabel(hit),/本段人工确认为本人/);
});

test('query-resolved empty canonical text never loads an old ASR mirror',t=>{
 const f=fixture(t),a=f.add(1),row=f.page.entries[0],resolved=f.current(a.id);resolved.text='';f.calls.length=0;
 f.page.viewText(row,resolved);assert.equal(f.page.text,'');assert.equal(f.page.textRevision,2);assert.equal(f.page.textName,a.item.name);
 assert.equal(f.calls.includes('ordinary-canonical'),false);assert.equal(f.calls.some(call=>typeof call==='string'&&call.startsWith('legacy-')),false);
});

test('invalid input or inactive page never makes network, model, capture or query side effects',t=>{
 const f=fixture(t);f.add(1);f.start();f.page.changeQueryKeyword('x\n');f.page.searchLocal();assert.equal(f.page.queryPage,undefined);assert.match(f.page.queryNote,/查询未完成/);
 f.page.changeQueryKeyword('');f.page.searchLocal();assert.equal(f.page.queryPage,undefined);assert.match(f.page.queryNote,/请输入关键词或本段说话人/);
 f.page.changeQueryKeyword('发货');let before=f.calls.length;f.page.visible=false;f.page.searchLocal();assert.equal(f.calls.length,before);
 f.page.visible=true;f.page.busy=true;f.page.searchLocal();assert.equal(f.calls.length,before);assert.equal(f.dialogs.length,0);assert.equal(f.toasts.length,0);
});

test('actual builder wires a separate query area and keeps the unfiltered timeline and existing editing controls',()=>{
 assert.match(source,/this\.localSearchArea\(\)/);assert.match(source,/ForEach\(this\.queryPage\.hits/);
 assert.match(source,/ForEach\(this\.dayEntries\(this\.selected\)/);assert.match(source,/onChange\(\(value:string\):void=>this\.changeQueryKeyword\(value\)\)/);
 assert.match(source,/onChange\(\(value:string\):void=>this\.changeQuerySpeaker\(value\)\)/);assert.match(source,/onClick\(\(\):void=>this\.selectDay\(day\)\)/);
 assert.match(source,/onChanged:\(row:MaterialRevision\):void=>this\.selectedMaterialChanged\(row\)/);
 for(const method of ['transcribeDay','exportDay','transcribeEntry','confirmRemove','exportText'])assert.match(source,new RegExp('this\\.'+method+'\\('));
});
