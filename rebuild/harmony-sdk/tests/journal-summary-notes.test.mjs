import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {loadApp} from './load-app.mjs';
import {setupMaterialStore} from './material-fixture.mjs';

const DATE='2026-10-14',DAY=new Date(2026,9,14).getTime();
const clone=value=>JSON.parse(JSON.stringify(value)),sha=value=>createHash('sha256').update(value).digest('hex');
const op=(n,day=DATE)=>'noteop-'+day+'-'+n.toString(16).padStart(32,'0');
function fixture(t){
 const s=setupMaterialStore(t);assert.match(path.resolve(s.root),/^[Dd]:[\\/]/,'controlled D-drive TEMP is required');
 const descriptors=new Map(),calls=[],writeCalls=[];let fault='',freezeHook,pendingSyncHook,exportSyncHook,now=DAY+100000,missing=false,sourceFailure=false;
 const io=s.io;Object.assign(io,{OpenMode:{READ_ONLY:0,CREATE:1,WRITE_ONLY:2,TRUNC:4},lstatSync:fs.lstatSync,
  statSync:value=>typeof value==='number'?fs.fstatSync(value):fs.statSync(value),
  openSync(file,mode){calls.push(['open',file,mode]);const flags=mode===0?'r':mode&4?'w':fs.existsSync(file)?'r+':'w';const fd=fs.openSync(file,flags);descriptors.set(fd,{file,mode});return{fd};},
  closeSync(file){const fd=typeof file==='number'?file:file.fd;fs.closeSync(fd);descriptors.delete(fd);},
  readSync(fd,buffer,options){const file=descriptors.get(fd).file;if(fault==='post-commit-read'&&file.endsWith('/note.json')){fault='';throw Error('synthetic committed read failure');}
   return fs.readSync(fd,new Uint8Array(buffer),0,Math.min(options.length,29),null);},
  writeSync(fd,buffer){const file=descriptors.get(fd).file;writeCalls.push(file);
   if(file.endsWith('/pending.json')&&fault==='write-zero')return 0;
   if(file.endsWith('/pending.json')&&fault==='write-short-fail'&&writeCalls.filter(value=>value===file).length>1)throw Error('synthetic interrupted write');
   return fs.writeSync(fd,new Uint8Array(buffer),0,Math.min(buffer.byteLength,37),null);},
  fsyncSync(fd){const file=descriptors.get(fd).file;if(file.endsWith('/pending.json')&&fault==='fsync')throw Error('synthetic pending fsync failure');
   fs.fsyncSync(fd);if(file.endsWith('/pending.json')&&pendingSyncHook){const hook=pendingSyncHook;pendingSyncHook=undefined;hook();}
   if(file.includes('/summary-note-')&&file.endsWith('.partial')&&exportSyncHook){const hook=exportSyncHook;exportSyncHook=undefined;hook();}},
  renameSync(from,to){calls.push(['rename',from,to]);if(from.endsWith('/pending.json')&&fault==='rename-before')throw Error('synthetic rename before');
   fs.renameSync(from,to);if(from.endsWith('/pending.json')&&fault==='rename-after'){fault='';throw Error('synthetic rename after successful commit');}}});
 const platform={'@kit.CoreFileKit':{fileIo:io},'@kit.ArkTS':{util:{TextEncoder:class{encodeInto(value){return new TextEncoder().encode(value);}},
  TextDecoder:class{constructor(encoding,options){this.decoder=new TextDecoder(encoding,options);}decodeToString(value){return this.decoder.decode(value);}}}},
  './LifelogSession':{LifelogDayText:class{markdown='';total=0;transcribed=0;}},'./RecordingSession':{}};
 const journal=loadApp('JournalExport',platform),saved=loadApp('SavedJournalSummary',platform),core=loadApp('JournalSummaryNotes',platform),items=[];
 function addSource(n=1,day=DAY){
  const source=new s.MaterialSource();Object.assign(source,s.source,{name:'take-'+n.toString(16).padStart(32,'0'),started:day+1000,ended:day+61000});
  const input=new s.MaterialTextInput();Object.assign(input,s.input,{text:'合成原文：预算沿用上次。',transcriptionState:'complete',coveredMs:60000,sourceMs:60000});
  input.utterances=[Object.assign(new s.MaterialUtterance(),{text:input.text,start_ms:1000,end_ms:2000,speaker_id:'speaker-0',speaker_basis:'segment_cluster'})];
  const base=s.store.ensure(source),head=s.store.appendTranscript(base.material_id,1,input,'note-source-'+n);
  items.push({name:source.name,created:source.started,bytes:source.audioBytes,textFile:'legacy.md'});return head;
 }
 const head=addSource();
 function current(day){if(sourceFailure)throw Error('synthetic source unavailable');const sources=new journal.JournalSources();Object.assign(sources,{recordingItems:items,
  material:(kind,name)=>missing?undefined:s.store.read(s.store.idFor(kind,name)),recordingText:()=>''});return journal.buildJournalDay(day,sources,'');}
 const summaries=new saved.SavedJournalSummary({root:()=>s.root,current});
 function cache(text='合成原 AI 总结\n## 内部标题\n原样保留。',day=DATE){const dayStart=saved.savedSummaryDayStart(day),base=current(dayStart),full=journal.bindJournalSummary(base,current(dayStart),text);
  const file=journal.writeJournalFile(s.root,dayStart,full.markdown),parent=new saved.SavedSummaryRef();Object.assign(parent,{day,summary_id:'saved-'+day+'-cache',content_sha256:sha(full.markdown)});
  return{file,markdown:full.markdown,parent,source:summaries.open(parent).source_sha256};}
 let parent=cache();const ports={root:()=>s.root,summaries,freeze(day,markdown){if(freezeHook){const hook=freezeHook;freezeHook=undefined;hook();}return journal.writeJournalSnapshot(s.root,day,markdown);},now:()=>now};
 const notes=new core.JournalSummaryNotes(ports);
 function input(n=1,text='  人工附注🙂：运费仍沿用上次。\n完整保留空白。  ',from=parent){const value=new core.JournalNoteInput();Object.assign(value,{operation_id:op(n,from.parent.day),parent:clone(from.parent),source_sha256:from.source,text});return value;}
 function directory(operation){return s.root+'/summary-notes-v1/'+operation.slice(7,17)+'/'+operation;}
 function tree(){const files=[];function walk(dir){for(const name of fs.readdirSync(dir).sort()){const file=dir+'/'+name,stat=fs.lstatSync(file);if(stat.isSymbolicLink()){files.push([file,'link']);continue;}if(stat.isDirectory())walk(file);else files.push([file,sha(fs.readFileSync(file))]);}}walk(s.root);return files;}
 function cold(){return new (loadApp('JournalSummaryNotes',platform).JournalSummaryNotes)(ports);}
 return{...s,...core,journal,summaries,notes,ports,head,items,addSource,current,cache,input,directory,tree,cold,calls,writeCalls,descriptors,parent,
  fault:value=>fault=value,onFreeze:hook=>freezeHook=hook,onPendingSync:hook=>pendingSyncHook=hook,onExportSync:hook=>exportSyncHook=hook,now:value=>now=value,
  missing:value=>missing=value,sourceFailure:value=>sourceFailure=value,
  filter:changes=>Object.assign(new core.JournalNoteFilter(),{day:DATE,...changes}),
  edit(text='更正后的预算'){const row=s.store.read(head.material_id);return s.store.correctText(head.material_id,row.revision,row.utterances[0].utterance_id,text);}};
}

test('real writer/store note save freezes original AI unchanged, cold-opens full manual text and separates provenance',t=>{
 const f=fixture(t),input=f.input(),cacheBytes=fs.readFileSync(f.parent.file),receipt=f.notes.save(input);
 assert.equal(receipt.state,'saved');assert.equal(receipt.can_open,true);assert.equal(receipt.replayed,false);assert.equal(Object.hasOwn(receipt,'text'),false);assert.equal(receipt.created_at,new Date(DAY+100000).toISOString());
 const file=f.directory(input.operation_id)+'/note.json',record=JSON.parse(fs.readFileSync(file,'utf8'));assert.equal(Object.keys(record).length,10);
 assert.equal(record.text,input.text);assert.equal(record.producer,'user_note');assert.equal(record.created_at,new Date(DAY+100000).toISOString());
 assert.equal(record.parent.summary_id,'saved-'+DATE+'-cache');assert.equal(record.origin.summary_id,'saved-'+DATE+'-'+input.parent.content_sha256);
 assert.deepEqual(fs.readFileSync(f.parent.file),cacheBytes);const frozen=f.root+'/day-'+DATE+'-'+input.parent.content_sha256+'.md';assert.equal(fs.readFileSync(frozen,'utf8'),f.parent.markdown);
 const before=f.tree(),opened=f.cold().open(receipt.reference);assert.equal(opened.record.text,input.text);assert.equal(opened.summary.markdown,f.parent.markdown);assert.equal(opened.summary.producer,'unknown');assert.equal(opened.summary.generated_at,'');
 assert.equal(opened.markdown.startsWith(f.parent.markdown),true);assert.match(opened.markdown,/## 用户附注/);assert.equal(opened.markdown.includes(input.text),true);
 const structured=JSON.parse(opened.structured_json);assert.equal(structured.kind,'summary_user_note');assert.equal(structured.record.text,input.text);assert.equal(structured.summary.producer,'unknown');
 assert.deepEqual(f.tree(),before);assert.equal(f.descriptors.size,0);
});

test('same operation/input is replayed without writes, conflicting full text or parent is rejected, even after source deletion',t=>{
 const f=fixture(t),input=f.input(),first=f.notes.save(input),before=f.tree(),writes=f.writeCalls.length;
 f.now(DAY+999999);const again=f.cold().save(clone(input));assert.equal(again.replayed,true);assert.deepEqual(clone(again.reference),clone(first.reference));assert.equal(f.writeCalls.length,writes);assert.deepEqual(f.tree(),before);
 assert.throws(()=>f.notes.save({...clone(input),text:input.text+'x'}),/^Error: NOTE_CONFLICT$/);
 f.store.delete(f.head.material_id,2);const stale=f.notes.save(input);assert.equal(stale.state,'saved');assert.equal(stale.can_open,false);assert.equal(stale.replayed,true);
 assert.equal(JSON.stringify(stale).includes(input.text),false);assert.throws(()=>f.notes.open(first.reference),/^Error: NOTE_STALE$/);
});

test('later automatic cache replacement leaves a committed frozen origin usable without rebinding its old source',t=>{
 const f=fixture(t),input=f.input(),receipt=f.notes.save(input),original=f.parent.markdown;f.cache('后来自动生成的另一版总结');
 const document=f.cold().open(receipt.reference);assert.equal(document.summary.markdown,original);assert.equal(document.record.parent.content_sha256,input.parent.content_sha256);
 assert.notEqual(fs.readFileSync(f.parent.file,'utf8'),original);assert.equal(f.notes.inspect(input.operation_id).can_open,true);
});

test('cache/source changes during pending write reject commit and preserve exact pending text for explicit inspection only',async t=>{
 for(const mutation of ['cache','source','delete'])await t.test(mutation,t=>{
  const f=fixture(t),input=f.input();f.onPendingSync(()=>{if(mutation==='cache')f.cache('save期间cache替换');else if(mutation==='source')f.edit();else f.store.delete(f.head.material_id,2);});
  assert.throws(()=>f.notes.save(input),/^Error: NOTE_STALE$/);const dir=f.directory(input.operation_id);assert.equal(fs.existsSync(dir+'/note.json'),false);
  const pending=fs.readFileSync(dir+'/pending.json','utf8');assert.equal(JSON.parse(pending).text,input.text);assert.equal(f.notes.inspect(input.operation_id).state,'stale');assert.equal(f.notes.inspect(input.operation_id).created_at,JSON.parse(pending).created_at);
  assert.throws(()=>f.cold().pendingInput(input.operation_id,JSON.parse(pending).input_sha256),/^Error: NOTE_STALE$/);assert.equal(fs.readFileSync(dir+'/pending.json','utf8'),pending);
 });
});

test('full pending cold resume requires successful writable fsync and preserves original bytes/timestamp; save never auto-resumes',t=>{
 const f=fixture(t),input=f.input();f.fault('fsync');assert.throws(()=>f.notes.save(input),/^Error: NOTE_IO$/);
 const dir=f.directory(input.operation_id),pending=fs.readFileSync(dir+'/pending.json'),record=JSON.parse(pending);assert.equal(f.notes.inspect(input.operation_id).state,'pending');
 const cold=f.cold(),writes=f.writeCalls.length;assert.equal(cold.save(input).state,'pending');assert.equal(f.writeCalls.length,writes);assert.equal(fs.existsSync(dir+'/note.json'),false);
 const recovered=cold.pendingInput(input.operation_id,record.input_sha256);assert.deepEqual(clone(recovered),clone(input));assert.equal(fs.existsSync(dir+'/note.json'),false);
 assert.throws(()=>cold.resume(input),/^Error: NOTE_IO$/);assert.equal(fs.existsSync(dir+'/note.json'),false);assert.deepEqual(fs.readFileSync(dir+'/pending.json'),pending);
 assert.equal(f.calls.some(call=>call[0]==='open'&&call[1]===dir+'/pending.json'&&call[2]===f.io.OpenMode.WRITE_ONLY),true,'resume fsync opens existing file without CREATE/TRUNC');
 f.fault('');f.now(DAY+999999);const done=cold.resume(input);assert.equal(done.state,'saved');assert.deepEqual(fs.readFileSync(dir+'/note.json'),pending);assert.equal(fs.existsSync(dir+'/pending.json'),false);
 assert.equal(cold.open(done.reference).record.created_at,record.created_at);assert.equal(f.writeCalls.length,writes,'resume does not rewrite pending bytes');
});

test('write/rename failure stages are not mistaken for a committed note and rename-after-success reconciles the same operation',async t=>{
 for(const mode of ['write-zero','write-short-fail','rename-before','rename-after','post-commit-read'])await t.test(mode,t=>{
  const f=fixture(t),input=f.input();f.fault(mode);assert.throws(()=>f.notes.save(input),/^Error: NOTE_IO$/);f.fault('');const dir=f.directory(input.operation_id),status=f.cold().inspect(input.operation_id);
  if(['rename-after','post-commit-read'].includes(mode)){assert.equal(status.state,'saved');const replay=f.cold().save(input);assert.equal(replay.replayed,true);assert.equal(f.cold().open(replay.reference).record.text,input.text);}
  else if(mode==='rename-before'){assert.equal(status.state,'pending');const bytes=fs.readFileSync(dir+'/pending.json');const result=f.cold().resume(input);assert.equal(result.state,'saved');assert.deepEqual(fs.readFileSync(dir+'/note.json'),bytes);}
  else{assert.equal(['corrupt','blocked'].includes(status.state),true);const before=f.tree();assert.throws(()=>f.cold().resume(input),/^Error: NOTE_BLOCKED$/);assert.deepEqual(f.tree(),before);}
  assert.equal(f.descriptors.size,0);
 });
});

test('empty reservation, malformed pending, unknown evidence and source snapshot partials remain blocked without overwrites',async t=>{
 for(const kind of ['empty','malformed','invalid-utf8','unknown','snapshot-partial','snapshot-corrupt'])await t.test(kind,t=>{
  const f=fixture(t),input=f.input(),dir=f.directory(input.operation_id);
  if(kind.startsWith('snapshot-')){
   const snapshot=f.root+'/day-'+DATE+'-'+input.parent.content_sha256+'.md'+(kind==='snapshot-partial'?'.partial':'');fs.writeFileSync(snapshot,'KEEP ORIGINAL EVIDENCE');
   assert.throws(()=>f.notes.save(input),/^Error: NOTE_BLOCKED$/);assert.equal(fs.readFileSync(snapshot,'utf8'),'KEEP ORIGINAL EVIDENCE');assert.equal(fs.existsSync(dir+'/pending.json'),false);
  }else{fs.mkdirSync(dir,{recursive:true});if(kind==='malformed')fs.writeFileSync(dir+'/pending.json','{');if(kind==='invalid-utf8')fs.writeFileSync(dir+'/pending.json',Buffer.from([0xff]));if(kind==='unknown')fs.writeFileSync(dir+'/alien.txt','KEEP');
   const before=f.tree(),status=f.notes.save(input);assert.equal(['reserved','corrupt','blocked'].includes(status.state),true);assert.throws(()=>f.notes.resume(input),/^Error: NOTE_BLOCKED$/);assert.deepEqual(f.tree(),before);}
 });
});

test('same-process instances cannot inspect/resume/save a live writer, and constructor/read-only missing do not create storage',t=>{
 const f=fixture(t),second=new f.JournalSummaryNotes(f.ports),input=f.input(),before=f.tree();assert.equal(second.inspect(input.operation_id).state,'missing');
 assert.equal(second.list(f.filter()).items.length,0);assert.deepEqual(f.tree(),before);let observed=false;
 f.onFreeze(()=>{observed=true;assert.equal(second.inspect(input.operation_id).state,'blocked');assert.throws(()=>second.save(input),/^Error: NOTE_BLOCKED$/);assert.throws(()=>second.resume(input),/^Error: NOTE_BLOCKED$/);});
 const result=f.notes.save(input);assert.equal(observed,true);assert.equal(result.state,'saved');assert.equal(second.save(input).replayed,true);
});

test('previous note edits use new immutable records and one explicit prior generation, not a fabricated rewritten AI history',t=>{
 const f=fixture(t),first=f.notes.save(f.input(1,'第一条附注')),firstDoc=f.notes.open(first.reference),firstBytes=fs.readFileSync(f.directory(op(1))+'/note.json');
 const parent={parent:firstDoc.record.origin,source:firstDoc.record.source_sha256},secondInput=f.input(2,'更正后的完整附注',parent);secondInput.previous=clone(first.reference);
 const second=f.notes.save(secondInput),record=JSON.parse(fs.readFileSync(f.directory(op(2))+'/note.json','utf8'));assert.equal(Object.keys(record).length,11);assert.deepEqual(record.previous,clone(first.reference));
 assert.deepEqual(fs.readFileSync(f.directory(op(1))+'/note.json'),firstBytes);const secondDoc=f.notes.open(second.reference);assert.equal(secondDoc.record.text,secondInput.text);assert.equal(secondDoc.summary.producer,'unknown');
 fs.writeFileSync(f.directory(op(1))+'/note.json','damaged older ancestor');const thirdInput=f.input(3,'第三条附注',parent);thirdInput.previous=clone(second.reference);
 assert.equal(f.notes.save(thirdInput).state,'saved','only the directly selected previous generation is validated; no claim of scanning all ancestors');
 const foreign=f.cache('不同原AI总结，相同来源'),wrong=f.input(4,'不能挂到另一总结',foreign);wrong.previous=clone(second.reference);assert.throws(()=>f.notes.save(wrong),/^Error: NOTE_STALE$/);
});

test('source correction/delete/missing/unavailable and corrupt frozen parent deny note text, chunks and exports while retaining metadata',async t=>{
 for(const mode of ['correct','delete','missing','unavailable','parent-corrupt'])await t.test(mode,t=>{
  const f=fixture(t),input=f.input(),result=f.notes.save(input);if(mode==='correct')f.edit();else if(mode==='delete')f.store.delete(f.head.material_id,2);
  else if(mode==='missing')f.missing(true);else if(mode==='unavailable')f.sourceFailure(true);else fs.writeFileSync(f.root+'/day-'+DATE+'-'+input.parent.content_sha256+'.md','corrupt immutable origin');
  const before=f.tree(),status=f.notes.inspect(input.operation_id);assert.equal(status.state,'saved');assert.equal(status.can_open,false);assert.equal(JSON.stringify(status).includes(input.text),false);
  assert.throws(()=>f.notes.open(result.reference),/^Error: NOTE_STALE$/);assert.throws(()=>f.notes.chunk(result.reference,'md',0,4000),/^Error: NOTE_STALE$/);assert.throws(()=>f.notes.exportSnapshot(result.reference,'json'),/^Error: NOTE_STALE$/);
  assert.deepEqual(f.tree(),before);
 });
});

test('MD/JSON exports and chunks preserve full Unicode note plus exact original summary with immutable local export files',t=>{
 const f=fixture(t),input=f.input(1,'🙂附注😀\n'+'条件🙂'.repeat(120)),receipt=f.notes.save(input),document=f.notes.open(receipt.reference);
 for(const format of ['md','json']){let offset=0;const parts=[];for(let count=0;count<1000;count++){
   const chunk=f.notes.chunk(receipt.reference,format,offset,57);assert.equal(chunk.text.isWellFormed(),true);assert.equal(chunk.source_sha256,input.source_sha256);assert.equal(chunk.offset,offset);
   parts.push(chunk.text);offset=chunk.next_offset;if(!chunk.has_more)break;}
  const text=format==='md'?document.markdown:document.structured_json;assert.equal(parts.join(''),text);const eof=f.notes.chunk(receipt.reference,format,text.length,2);assert.equal(eof.text,'');assert.equal(eof.has_more,false);
  const exported=f.notes.exportSnapshot(receipt.reference,format);assert.equal(fs.readFileSync(exported.path,'utf8'),text);assert.equal(exported.content_sha256,sha(text));assert.equal(path.basename(exported.path).startsWith('summary-note-'),true);
  assert.equal(path.dirname(exported.path).replaceAll('\\','/'),f.directory(input.operation_id));assert.deepEqual(clone(f.notes.exportSnapshot(receipt.reference,format)),clone(exported));}
 const emoji=document.markdown.indexOf('🙂');assert.throws(()=>f.notes.chunk(receipt.reference,'md',emoji+1,2),/^Error: NOTE_INVALID$/);
 assert.throws(()=>f.notes.chunk(receipt.reference,'bad',0,2),/^Error: NOTE_INVALID$/);assert.throws(()=>f.notes.chunk(receipt.reference,'md',0,1),/^Error: NOTE_INVALID$/);
 assert.throws(()=>f.notes.chunk(receipt.reference,'md',document.markdown.length+1,2),/^Error: NOTE_INVALID$/);
 const before=f.tree();f.notes.list(f.filter());f.notes.inspect(input.operation_id);f.notes.open(receipt.reference);assert.deepEqual(f.tree(),before);
});

test('export refuses a preexisting unknown partial and corrupted immutable export',t=>{
 const f=fixture(t),input=f.input(),receipt=f.notes.save(input),doc=f.notes.open(receipt.reference),hash=sha(doc.markdown);
 const filename=f.directory(input.operation_id)+'/summary-note-'+DATE+'-'+input.operation_id+'-md-'+hash+'.md';fs.writeFileSync(filename+'.partial','KEEP');
 assert.throws(()=>f.notes.exportSnapshot(receipt.reference,'md'),/^Error: NOTE_BLOCKED$/);assert.equal(fs.readFileSync(filename+'.partial','utf8'),'KEEP');
 fs.unlinkSync(filename+'.partial');fs.writeFileSync(filename,'CORRUPT EXPORT');assert.throws(()=>f.notes.exportSnapshot(receipt.reference,'md'),/^Error: NOTE_BLOCKED$/);assert.equal(fs.readFileSync(filename,'utf8'),'CORRUPT EXPORT');
});

test('source mutation after export write/fsync leaves only partial evidence and never publishes a stale export',t=>{
 const f=fixture(t),input=f.input(),receipt=f.notes.save(input);f.onExportSync(()=>f.edit());
 assert.throws(()=>f.notes.exportSnapshot(receipt.reference,'md'),/^Error: NOTE_STALE$/);
 const names=fs.readdirSync(f.directory(input.operation_id)),exports=names.filter(name=>name.startsWith('summary-note-'));
 assert.equal(exports.length,1);assert.equal(exports[0].endsWith('.partial'),true);assert.equal(names.includes('note.json'),true);
 assert.equal(f.notes.inspect(input.operation_id).state,'saved');assert.equal(f.notes.inspect(input.operation_id).can_open,false);
});

test('strict input/ref shapes, real dates, fulltext bounds and day-scoped operations fail before any note writes',t=>{
 const f=fixture(t),input=f.input(),before=f.tree();
 for(const bad of [{...clone(input),extra:true},{...clone(input),operation_id:'noteop-'+'a'.repeat(32)},{...clone(input),operation_id:op(1,'2026-02-29')},
  {...clone(input),operation_id:op(1,'2026-10-15')},{...clone(input),text:''},{...clone(input),text:' \n '},{...clone(input),text:'x'.repeat(8193)},
  {...clone(input),text:'\ud800'},{...clone(input),previous:null},{...clone(input),previous:{}},{...clone(input),parent:{...input.parent,path:'/outside'}},
  {...clone(input),source_sha256:'A'.repeat(64)}])assert.throws(()=>f.notes.save(bad),/^Error: NOTE_INVALID$/);
 assert.deepEqual(f.tree(),before);const receipt=f.notes.save(input);
 for(const ref of [{...receipt.reference,day:'2026-02-29'},{...receipt.reference,note_id:'../note.json'},{...receipt.reference,path:'/outside'},{...receipt.reference,content_sha256:'A'.repeat(64)}])assert.throws(()=>f.notes.open(ref),/^Error: NOTE_INVALID$/);
 assert.throws(()=>f.notes.inspect('noteop-'+'a'.repeat(32)),/^Error: NOTE_INVALID$/);
 assert.throws(()=>f.notes.pendingInput(input.operation_id,'not-sha'),/^Error: NOTE_INVALID$/);
});

test('pagination binds raw note bytes, candidate membership and fresh sources; one list reuses only same-origin verification',t=>{
 const f=fixture(t);for(let n=1;n<=12;n++)f.notes.save(f.input(n,'附注 '+n));let opens=0;const original=f.summaries.open.bind(f.summaries);f.summaries.open=ref=>{opens++;return original(ref);};
 const before=f.tree(),first=f.notes.list(f.filter());assert.equal(first.items.length,10);assert.equal(first.has_more,true);assert.equal(opens,1,'only this list call caches the shared exact origin/source');
 const second=f.notes.list(f.filter({cursor:first.next_cursor,limit:1}));assert.equal(second.items.length,1);assert.equal(opens,2,'cache does not cross list calls');
 const last=f.notes.list(f.filter({cursor:second.next_cursor}));assert.equal(last.items.length,1);assert.equal(last.has_more,false);assert.deepEqual(f.tree(),before);
 assert.throws(()=>f.notes.list(f.filter({cursor:first.snapshot_sha256+':999'})),/^Error: NOTE_STALE$/);
 f.notes.save(f.input(13,'新附注'));assert.throws(()=>f.notes.list(f.filter({cursor:first.next_cursor})),/^Error: NOTE_STALE$/);
 const after=f.notes.list(f.filter());f.edit();assert.throws(()=>f.notes.list(f.filter({cursor:after.next_cursor})),/^Error: NOTE_STALE$/);
});

test('selected-day capacity and incomplete evidence do not hide another date, and read-only scans create nothing',t=>{
 const f=fixture(t),base=f.root+'/summary-notes-v1/'+DATE;fs.mkdirSync(base,{recursive:true});for(let n=0;n<129;n++)fs.mkdirSync(base+'/'+op(n));
 const other='2026-10-15',otherStart=DAY+86400000;f.addSource(2,otherStart);const parent=f.cache('另一天原AI',other),input=f.input(1,'另一天附注',parent),saved=f.notes.save(input);
 const before=f.tree(),page=f.notes.list(f.filter());assert.equal(page.scanned,128);assert.equal(page.incomplete,true);assert.equal(page.incomplete_reason,'scan_limit');
 assert.equal(page.items.every(item=>item.state==='reserved'&&item.created_at===''),true);const next=f.notes.list(f.filter({day:other}));assert.equal(next.items.length,1);assert.equal(next.items[0].reference.note_id,saved.reference.note_id);assert.equal(next.items[0].can_open,true);
 assert.deepEqual(f.tree(),before);
});

test('aggregate decoded record budget includes escaped control text and stops with partial metadata, not a complete empty claim',t=>{
 const f=fixture(t),input=f.input(1,'\u001f'.repeat(8192)),saved=f.notes.save(input),template=JSON.parse(fs.readFileSync(f.directory(input.operation_id)+'/note.json','utf8'));
 // Capacity-only fixtures clone a real production record and recompute its
 // exact canonical input digest; the original parent is a real writer output.
 for(let n=2;n<=90;n++){const record=clone(template);record.operation_id=op(n);
  record.input_sha256=sha(JSON.stringify({operation_id:record.operation_id,parent:record.parent,source_sha256:record.source_sha256,text:record.text}));
  const dir=f.directory(record.operation_id);fs.mkdirSync(dir);fs.writeFileSync(dir+'/note.json',JSON.stringify(record));}
 const before=f.tree(),page=f.notes.list(f.filter());assert.equal(saved.state,'saved');assert.equal(page.incomplete,true);assert.equal(page.incomplete_reason,'text_limit');
 assert.ok(page.scanned<90);assert.ok(page.scanned>1);assert.equal(page.items.length,10);assert.equal(page.items.some(item=>item.can_open),true);assert.deepEqual(f.tree(),before);
});

test('oversized or damaged raw records and unsafe directory links never become valid notes',async t=>{
 await t.test('size',t=>{const f=fixture(t),input=f.input(),dir=f.directory(input.operation_id);fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(dir+'/pending.json',Buffer.alloc(65537,0x61));
  const page=f.notes.list(f.filter());assert.equal(page.incomplete,true);assert.equal(page.incomplete_reason,'text_limit');assert.equal(page.items[0].can_open,false);assert.throws(()=>f.notes.resume(input),/^Error: NOTE_BLOCKED$/);});
 await t.test('junction',t=>{const f=fixture(t),input=f.input(),dir=f.directory(input.operation_id),target=f.root+'/owned-external';fs.mkdirSync(path.dirname(dir),{recursive:true});fs.mkdirSync(target);
  try{fs.symlinkSync(target,dir,'junction');}catch(error){if(['EPERM','EACCES','ENOTSUP'].includes(error.code)){t.skip('native fixture cannot create a junction');return;}throw error;}
  const before=f.tree();assert.equal(f.notes.inspect(input.operation_id).state,'blocked');assert.equal(f.notes.save(input).state,'blocked');assert.deepEqual(f.tree(),before);assert.equal(fs.readdirSync(target).length,0);});
});
