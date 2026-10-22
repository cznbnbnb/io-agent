import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {loadApp} from './load-app.mjs';
import {setupMaterialStore} from './material-fixture.mjs';

const DAY=new Date(2026,9,14).getTime(),DATE='2026-10-14';
const plain=value=>JSON.parse(JSON.stringify(value));
const sha=value=>createHash('sha256').update(value).digest('hex');
function tree(directory){
 const out={};for(const name of fs.readdirSync(directory).sort()){
  const file=path.join(directory,name);if(fs.statSync(file).isDirectory())for(const [child,bytes]of Object.entries(tree(file)))out[name+'/'+child]=bytes;
  else out[name]=fs.readFileSync(file).toString('hex');
 }return out;
}
function fixture(t){
 const s=setupMaterialStore(t);assert.match(path.resolve(s.root),/^[Dd]:[\\/]/,'fixtures use the controlled D-drive TEMP, never user files');
 const directory=s.root+'/saved-journals';fs.mkdirSync(directory);const descriptors=new Map(),readCalls=[],writes=[],ioErrors=[];let zeroRead=false,readSize=17,grow=false;
 Object.assign(s.io,{OpenMode:{CREATE:1,WRITE_ONLY:2,TRUNC:4,READ_ONLY:0},lstatSync:fs.lstatSync,
  statSync:value=>typeof value==='number'?fs.fstatSync(value):fs.statSync(value),openSync(file,mode){const fd=fs.openSync(file,mode===0?'r':'w');descriptors.set(fd,file);if(mode!==0)writes.push(['open',file]);return{fd};},
  closeSync(file){const fd=typeof file==='number'?file:file.fd;fs.closeSync(fd);descriptors.delete(fd);},
  readSync(fd,buffer,options){const file=descriptors.get(fd);readCalls.push(file);if(zeroRead)return 0;
   const count=fs.readSync(fd,new Uint8Array(buffer),0,Math.min(options.length,readSize),null);
   if(grow&&count>0){grow=false;fs.appendFileSync(file,'changed-during-read');}return count;},
  writeSync(fd,buffer){writes.push(['write',descriptors.get(fd)]);return fs.writeSync(fd,new Uint8Array(buffer).slice(0,37));}});
 for(const name of ['lstatSync','statSync','openSync','closeSync','readSync']){const operation=s.io[name];s.io[name]=(...args)=>{try{return operation(...args);}catch(error){ioErrors.push([name,error.code||error.name,error.message]);throw error;}};}
 const platforms={'@kit.CoreFileKit':{fileIo:s.io},'@kit.ArkTS':{util:{TextEncoder:class{encodeInto(text){return new TextEncoder().encode(text);}},
  TextDecoder:class{constructor(encoding,options){this.decoder=new TextDecoder(encoding,options);}decodeToString(bytes){return this.decoder.decode(bytes);}}}},
  './LifelogSession':{LifelogDayText:class{markdown='';total=0;transcribed=0;}},'./RecordingSession':{}};
 const journal=loadApp('JournalExport',platforms),core=loadApp('SavedJournalSummary',platforms),recordings=[];let missing=false,sourceFailure=false,currentOverride;
 Object.assign(s.source,{started:DAY+1000,ended:DAY+61000});s.input.transcriptionState='complete';s.input.coveredMs=60000;s.input.sourceMs=60000;
 s.input.text='预算沿用上次，确认发货。';s.input.utterances[0].text=s.input.text;
 const base=s.store.ensure(s.source),head=s.store.appendTranscript(base.material_id,1,s.input,'saved-summary-real');
 recordings.push({name:s.source.name,created:s.source.started,bytes:s.source.audioBytes,textFile:'legacy.md'});
 const legacy=s.root+'/legacy.md';fs.writeFileSync(legacy,'旧ASR预算原文');
 const sources=()=>{const out=new journal.JournalSources();Object.assign(out,{lifelogRoot:directory,recordingItems:recordings,
  recordingText:()=>fs.readFileSync(legacy,'utf8'),material:(kind,name)=>{if(sourceFailure)throw Error('synthetic source unavailable');return missing?undefined:s.store.read(s.store.idFor(kind,name));}});return out;};
 const current=day=>currentOverride?currentOverride(day):journal.buildJournalDay(day,sources(),'');
 const reader=new core.SavedJournalSummary({root:()=>directory,current});
 function generated(summary='合成总结：采用预算。\n\n## 待确认\n\n发货时间仍待确认。'){
  const before=current(DAY);return journal.bindJournalSummary(before,current(DAY),summary).markdown;
 }
 function cache(summary){const markdown=generated(summary),file=journal.writeJournalFile(directory,DAY,markdown);return{file,markdown,ref:reference(file,markdown)};}
 function snapshot(summary){const markdown=generated(summary),file=journal.writeJournalSnapshot(directory,DAY,markdown);return{file,markdown,ref:reference(file,markdown)};}
 function reference(file,markdown=fs.readFileSync(file)){
  const suffix=path.basename(file)==='day-'+DATE+'.md'?'cache':path.basename(file).slice(('day-'+DATE+'-').length,-3);
  return Object.assign(new core.SavedSummaryRef(),{day:DATE,summary_id:'saved-'+DATE+'-'+suffix,content_sha256:sha(markdown)});
 }
 const filter=changes=>Object.assign(new core.SavedSummaryFilter(),{day:DATE,...changes});
 return{...s,...core,journal,directory,reader,current,sources,head,recordings,readCalls,writes,ioErrors,descriptors,generated,cache,snapshot,reference,filter,
  setMissing:value=>missing=value,setSourceFailure:value=>sourceFailure=value,setCurrent:value=>currentOverride=value,
  zeroRead:value=>zeroRead=value,readSize:value=>readSize=value,growDuringRead:()=>grow=true};
}

test('real JournalExport cache and immutable snapshots cold-reopen exact full summaries without writes or invented metadata',t=>{
 const f=fixture(t),cache=f.cache(),snapshot=f.snapshot('另一个合成总结');const before=tree(f.root),writeCount=f.writes.length;
 const page=f.reader.list(f.filter());assert.equal(page.schema,1);assert.equal(page.scope,'local_saved_journals');assert.equal(page.day,DATE);assert.equal(page.incomplete,false,JSON.stringify({page,errors:f.ioErrors}));
 assert.equal(page.items.length,2);assert.equal(page.items[0].file_kind,'day_cache');assert.equal(page.items[1].file_kind,'snapshot');
 for(const entry of page.items){assert.equal(entry.state,'current');assert.equal(entry.can_open,true);assert.equal(entry.producer,'unknown');assert.equal(entry.generated_at,'');
  assert.equal(Object.hasOwn(entry,'markdown'),false);assert.equal(Object.hasOwn(entry,'excerpt'),false);assert.equal(Object.hasOwn(entry,'revision'),false);assert.match(entry.source_sha256,/^[a-f0-9]{64}$/);}
 const fresh=new f.SavedJournalSummary({root:()=>f.directory,current:f.current}),document=fresh.open(cache.ref);
 assert.equal(document.markdown,cache.markdown);assert.match(document.summary_text,/## 待确认/);assert.match(document.summary_text,/合成总结/);
 assert.equal(document.producer,'unknown');assert.equal(document.generated_at,'');assert.equal(document.total,1);assert.equal(document.transcribed,1);
 assert.equal(fresh.open(snapshot.ref).markdown,snapshot.markdown);document.reference.summary_id='caller mutation';
 assert.equal(page.items[0].reference.summary_id,cache.ref.summary_id);assert.equal(f.writes.length,writeCount);assert.deepEqual(tree(f.root),before);assert.equal(f.descriptors.size,0);
});

test('canonical correction, deletion, missing source, empty correction and removed membership never reopen old summary text',async t=>{
 for(const change of ['correction','delete','missing','empty','membership'])await t.test(change,t=>{
  const f=fixture(t),saved=f.cache(),old=f.reader.list(f.filter()).items[0];assert.equal(old.can_open,true);
  if(change==='correction')f.store.correctText(f.head.material_id,2,f.head.utterances[0].utterance_id,'新的预算原文');
  else if(change==='empty')f.store.correctText(f.head.material_id,2,f.head.utterances[0].utterance_id,'');
  else if(change==='delete')f.store.delete(f.head.material_id,2);else if(change==='missing')f.setMissing(true);else f.recordings.length=0;
  const page=f.reader.list(f.filter());assert.equal(page.items[0].state,'stale');assert.equal(page.items[0].can_open,false);
  assert.equal(JSON.stringify(page).includes('合成总结'),false);assert.equal(JSON.stringify(page).includes('预算沿用上次'),false);
  assert.throws(()=>f.reader.open(saved.ref),/SAVED_SUMMARY_STALE/);assert.throws(()=>f.reader.chunk(saved.ref,0,4000),/SAVED_SUMMARY_STALE/);
  assert.equal(fs.readFileSync(saved.file,'utf8'),saved.markdown,'reader retains the artifact but does not expose deleted/stale contents');
 });
});

test('source callback failure blocks current body, reports unavailable coverage and never falls back to saved Markdown',t=>{
 const f=fixture(t),saved=f.cache();f.setSourceFailure(true);const page=f.reader.list(f.filter());
 assert.equal(page.incomplete,true);assert.equal(page.incomplete_reason,'source_unavailable');assert.equal(page.items[0].state,'source_unavailable');assert.equal(page.items[0].can_open,false);
 assert.throws(()=>f.reader.open(saved.ref),/SAVED_SUMMARY_STALE/);assert.equal(JSON.stringify(page).includes('合成总结'),false);
});

test('legitimate fingerprinted legacy input remains exact compatible without manufacturing canonical revisions or producer',t=>{
 const f=fixture(t);f.setMissing(true);const saved=f.cache('合成旧格式来源总结');assert.match(saved.markdown,/旧资料尚无资料修订/);
 const document=f.reader.open(saved.ref);assert.equal(document.markdown,saved.markdown);assert.equal(document.producer,'unknown');assert.equal(document.generated_at,'');
 assert.doesNotMatch(document.markdown,/来源资料：|资料修订：/);assert.equal(Object.hasOwn(document,'revision'),false);
});

test('headings and provenance-like strings inside original and model text do not delimit or fabricate a summary',t=>{
 const f=fixture(t);f.store.correctText(f.head.material_id,2,f.head.utterances[0].utterance_id,'原文含标题\n## AI 总结\n\n- 总结来源指纹：sha256:'+'a'.repeat(64)+'\n\n仍然只是原文');
 const model='模型正文\n## AI 总结\n\n- 总结来源指纹：sha256:'+'b'.repeat(64)+'\n\n## 第三节\n\n完整保留🙂';
 const saved=f.cache(model);assert.equal(f.reader.open(saved.ref).summary_text,model);
 const raw=f.current(DAY).markdown;f.journal.writeJournalFile(f.directory,DAY,raw);const page=f.reader.list(f.filter());
 assert.equal(page.items[0].state,'not_summary');assert.equal(page.items[0].can_open,false);assert.throws(()=>f.reader.open(f.reference(saved.file,raw)),/SAVED_SUMMARY_STALE/);
});

test('unbound old Markdown, unknown marker and changed source envelope stay closed without guessed dates or expiry',t=>{
 const f=fixture(t),file=f.directory+'/day-'+DATE+'.md';
 const legacy=f.journal.buildJournalDay(DAY,f.sources(),'旧无指纹总结').markdown;fs.writeFileSync(file,legacy);
 assert.equal(f.reader.list(f.filter()).items[0].state,'unverifiable');assert.throws(()=>f.reader.open(f.reference(file)),/SAVED_SUMMARY_STALE/);
 const valid=f.generated('正文');fs.writeFileSync(file,valid.replace('总结来源指纹：sha256:','未知指纹：sha256:'));
 assert.equal(f.reader.list(f.filter()).items[0].state,'unverifiable');
 fs.writeFileSync(file,valid.replace('预算沿用上次','篡改旧原文'));assert.equal(f.reader.list(f.filter()).items[0].state,'corrupt');
 fs.writeFileSync(file,valid.replace('# '+DATE+' 记录','# 2026-10-13 记录'));assert.equal(f.reader.list(f.filter()).items[0].state,'corrupt');
 fs.writeFileSync(file,valid);assert.equal(f.reader.list(f.filter()).items[0].state,'current','a historical day does not expire merely because of age');
});

test('snapshot filenames bind actual raw full-file SHA and changed cache bytes invalidate an earlier ref',t=>{
 const f=fixture(t),saved=f.snapshot();fs.writeFileSync(saved.file,saved.markdown.replace('合成总结','变更总结'));
 const page=f.reader.list(f.filter());assert.equal(page.items[0].state,'corrupt');assert.equal(page.items[0].reference.content_sha256,sha(fs.readFileSync(saved.file)));
 assert.throws(()=>f.reader.open(saved.ref),/SAVED_SUMMARY_STALE/);
 const first=f.cache('第一份总结');f.cache('第二份总结');assert.throws(()=>f.reader.open(first.ref),/SAVED_SUMMARY_STALE/);
});

test('invalid UTF8, directories, short zero reads and a file growing during raw read expose no body',async t=>{
 for(const bytes of [Buffer.from([0xc0,0xaf]),Buffer.from([0xed,0xa0,0x80]),Buffer.from([0xf4,0x90,0x80,0x80]),Buffer.from([0xe4,0xbd]),Buffer.from([0xff])])await t.test(bytes.toString('hex'),t=>{
  const f=fixture(t),file=f.directory+'/day-'+DATE+'.md';fs.writeFileSync(file,bytes);const page=f.reader.list(f.filter());assert.equal(page.items[0].state,'corrupt');
  assert.throws(()=>f.reader.open(f.reference(file,bytes)),/SAVED_SUMMARY_STALE/);assert.equal(f.descriptors.size,0);
 });
 await t.test('directory',t=>{const f=fixture(t);fs.mkdirSync(f.directory+'/day-'+DATE+'.md');const page=f.reader.list(f.filter());assert.equal(page.items[0].state,'unreadable');assert.equal(page.unreadable,1);assert.equal(page.incomplete,true);});
 await t.test('zero-read',t=>{const f=fixture(t),saved=f.cache();f.zeroRead(true);const page=f.reader.list(f.filter());assert.equal(page.items[0].state,'unreadable');assert.equal(page.incomplete_reason,'unreadable');assert.throws(()=>f.reader.open(saved.ref),/SAVED_SUMMARY_STALE/);assert.equal(f.descriptors.size,0);});
 await t.test('growth',t=>{const f=fixture(t),saved=f.cache();f.growDuringRead();assert.throws(()=>f.reader.open(saved.ref),/SAVED_SUMMARY_STALE/);assert.equal(f.descriptors.size,0);});
});

test('list ordering, pagination and snapshot invalidation bind source, membership and exact artifact bytes',t=>{
 const f=fixture(t);f.cache();for(let n=0;n<11;n++)f.snapshot('合成总结 #'+n);
 const before=tree(f.root),first=f.reader.list(f.filter());assert.equal(first.items.length,10);assert.equal(first.items[0].file_kind,'day_cache');assert.equal(first.has_more,true);
 const second=f.reader.list(f.filter({cursor:first.next_cursor,limit:1}));assert.equal(second.items.length,1);assert.equal(second.has_more,true);assert.equal(second.snapshot_sha256,first.snapshot_sha256);
 const last=f.reader.list(f.filter({cursor:second.next_cursor}));assert.equal(last.items.length,1);assert.equal(last.has_more,false);assert.equal(last.next_cursor,'');
 const ids=[...first.items,...second.items,...last.items].map(entry=>entry.reference.summary_id);assert.equal(new Set(ids).size,12);assert.deepEqual(ids.slice(1),ids.slice(1).sort());assert.deepEqual(tree(f.root),before);
 assert.throws(()=>f.reader.list(f.filter({cursor:first.snapshot_sha256+':999'})),/SAVED_SUMMARY_STALE/);
 f.snapshot('后来新增总结');assert.throws(()=>f.reader.list(f.filter({cursor:first.next_cursor})),/SAVED_SUMMARY_STALE/);
 const afterMembership=f.reader.list(f.filter());f.cache('替换cache同来源');assert.throws(()=>f.reader.list(f.filter({cursor:afterMembership.next_cursor})),/SAVED_SUMMARY_STALE/);
 const afterFile=f.reader.list(f.filter());f.store.correctText(f.head.material_id,2,f.head.utterances[0].utterance_id,'新的预算');assert.throws(()=>f.reader.list(f.filter({cursor:afterFile.next_cursor})),/SAVED_SUMMARY_STALE/);
});

test('chunks return the full exact Markdown across emoji boundaries, EOF, fresh source and full-file ref checks',t=>{
 const f=fixture(t),saved=f.cache('🙂正文😀\n## 内部标题\n\n'+'语音🙂条件'.repeat(40)),parts=[];let offset=0;
 do{const chunk=f.reader.chunk(saved.ref,offset,53);assert.equal(chunk.offset,offset);assert.equal(chunk.total_utf16,saved.markdown.length);assert.equal(chunk.markdown.isWellFormed(),true);
  assert.equal(chunk.reference.content_sha256,saved.ref.content_sha256);assert.ok(chunk.next_offset>=offset);parts.push(chunk.markdown);offset=chunk.next_offset;if(!chunk.has_more)break;}while(offset<saved.markdown.length);
 assert.equal(parts.join(''),saved.markdown);assert.equal(sha(parts.join('')),saved.ref.content_sha256);
 const eof=f.reader.chunk(saved.ref,saved.markdown.length,2);assert.equal(eof.markdown,'');assert.equal(eof.has_more,false);assert.equal(eof.next_offset,saved.markdown.length);
 const emoji=saved.markdown.indexOf('🙂');assert.throws(()=>f.reader.chunk(saved.ref,emoji+1,2),/SAVED_SUMMARY_INVALID/);
 assert.throws(()=>f.reader.chunk(saved.ref,saved.markdown.length+1,2),/SAVED_SUMMARY_INVALID/);
 for(const [at,size]of[[-1,2],[0,1],[0,4001],[1.1,2],[0,2.1]])assert.throws(()=>f.reader.chunk(saved.ref,at,size),/SAVED_SUMMARY_INVALID/);
 const first=f.reader.chunk(saved.ref,0,2);assert.equal(first.has_more,true);f.cache('不同的总结');assert.throws(()=>f.reader.chunk(saved.ref,first.next_offset,2),/SAVED_SUMMARY_STALE/);
 const newer=f.cache();f.store.delete(f.head.material_id,2);assert.throws(()=>f.reader.chunk(newer.ref,0,4000),/SAVED_SUMMARY_STALE/);
});

test('strict date, filter, ref and path inputs fail before reads; blank root and list failure stay explicit',t=>{
 const f=fixture(t),saved=f.cache();f.readCalls.length=0;
 for(const day of ['2026-02-29','2024-02-30','2026-13-01','1969-12-31','10000-01-01','2026-1-01','../2026-10-14','2026-10-14\n'])assert.throws(()=>f.savedSummaryDayStart(day),/SAVED_SUMMARY_INVALID/);
 assert.equal(new Date(f.savedSummaryDayStart('2024-02-29')).getDate(),29);
 for(const value of [{},f.filter({extra:true}),f.filter({limit:0}),f.filter({limit:11}),f.filter({limit:1.5}),f.filter({cursor:'a'.repeat(64)+':01'}),f.filter({cursor:'A'.repeat(64)+':0'}),f.filter({cursor:'a'.repeat(64)+':9007199254740992'})])assert.throws(()=>f.reader.list(value),/SAVED_SUMMARY_INVALID/);
 for(const ref of [{...saved.ref,path:saved.file},{...saved.ref,summary_id:'../day-'+DATE+'.md'},{...saved.ref,summary_id:'saved-2026-10-13-cache'},{...saved.ref,content_sha256:'A'.repeat(64)},{}])assert.throws(()=>f.reader.open(ref),/SAVED_SUMMARY_INVALID/);
 assert.equal(f.readCalls.length,0);
 for(const root of ['', '/', '///', '\\\\', '.', 'relative-root','D:/','D:////','D:/x/../y']){let currentCalls=0;const reader=new f.SavedJournalSummary({root:()=>root,current:()=>{currentCalls++;throw Error('must not call');}});
  const page=reader.list(f.filter());assert.equal(page.incomplete,true);assert.equal(page.incomplete_reason,'unreadable');assert.equal(page.items.length,0);assert.equal(currentCalls,0);assert.throws(()=>reader.open(saved.ref),/SAVED_SUMMARY_STALE/);}
 const original=f.io.listFileSync;f.io.listFileSync=()=>{throw Error('synthetic list failure');};const page=f.reader.list(f.filter());f.io.listFileSync=original;
 assert.equal(page.incomplete,true);assert.equal(page.incomplete_reason,'unreadable');assert.equal(page.items.length,0);
});

test('partial/unrelated files are ignored and at most128 candidate artifacts are scanned with explicit partial coverage',t=>{
 const f=fixture(t);f.readSize(16384);f.cache();for(let n=0;n<128;n++)f.snapshot('scan '+n);
 fs.writeFileSync(f.directory+'/day-'+DATE+'.md.partial','unfinished');fs.writeFileSync(f.directory+'/unrelated.md','not indexed');fs.writeFileSync(f.directory+'/day-2026-10-13.md','different date');
 f.readCalls.length=0;const page=f.reader.list(f.filter());assert.equal(page.scanned,128);assert.equal(page.incomplete,true);assert.equal(page.incomplete_reason,'scan_limit');
 assert.equal(new Set(f.readCalls).size,128);assert.equal(f.readCalls.some(file=>file.endsWith('.partial')||file.endsWith('unrelated.md')||file.endsWith('2026-10-13.md')),false);
});

test('saved-byte, per-file/aggregate UTF16 and current-base budgets remain bounded and never expose oversized bodies',async t=>{
 await t.test('bytes',t=>{const f=fixture(t),file=f.directory+'/day-'+DATE+'.md';fs.writeFileSync(file,Buffer.alloc(8*1024*1024+1,0x61));f.readCalls.length=0;
  const page=f.reader.list(f.filter());assert.equal(page.incomplete_reason,'text_limit');assert.equal(page.items[0].can_open,false);assert.equal(f.readCalls.length,0);});
 await t.test('saved-UTF16',t=>{const f=fixture(t),file=f.directory+'/day-'+DATE+'.md';fs.writeFileSync(file,f.generated('字'.repeat(2*1024*1024)));f.readSize(16384);
  const page=f.reader.list(f.filter());assert.equal(page.incomplete_reason,'text_limit');assert.equal(page.items[0].can_open,false);assert.throws(()=>f.reader.open(f.reference(file)),/SAVED_SUMMARY_STALE/);});
 await t.test('aggregate',t=>{const f=fixture(t);f.readSize(16384);for(let n=0;n<3;n++){
   const markdown=f.generated('x'.repeat(1600000)+n);fs.writeFileSync(f.directory+'/day-'+DATE+'-'+sha(markdown)+'.md',markdown);}
  const page=f.reader.list(f.filter());assert.equal(page.scanned,3);assert.equal(page.incomplete_reason,'text_limit');assert.equal(page.items.filter(entry=>entry.can_open).length,2);assert.equal(page.items[2].can_open,false);});
 await t.test('current',t=>{const f=fixture(t),saved=f.cache();f.setCurrent(()=>({markdown:'x'.repeat(2*1024*1024+1),total:1,transcribed:1}));
  const page=f.reader.list(f.filter());assert.equal(page.incomplete_reason,'text_limit');assert.equal(page.items[0].state,'source_unavailable');assert.throws(()=>f.reader.open(saved.ref),/SAVED_SUMMARY_STALE/);});
});
