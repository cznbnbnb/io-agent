import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {loadApp} from './load-app.mjs';
import {setupMaterialStore} from './material-fixture.mjs';

const m=loadApp('MaterialStore'),q=loadApp('MaterialLocalQuery');
const plain=value=>JSON.parse(JSON.stringify(value));
function row(index,changes={}){
 const saved=new m.MaterialRevision();saved.material_id='mat-recording-'+index.toString(16).padStart(32,'0');
 Object.assign(saved.source,{name:'take-'+index.toString(16).padStart(32,'0'),started:1000,ended:61000,complete:true,audioAvailable:true});
 saved.text_revision=1;saved.text='预算需要确认';Object.assign(saved,changes);return saved;
}
function part(saved,index,text,speaker='',changes={}){
 const out=new m.MaterialUtterance();Object.assign(out,{utterance_id:saved.material_id+'-u-'+index,text,start_ms:1000+index*100,end_ms:1050+index*100,
  speaker_id:speaker,speaker_basis:speaker?'segment_cluster':'unknown'},changes);return out;
}
function speaker(saved,index,label,basis='user_confirmed',isSelf=false){
 const out=new m.MaterialSpeaker();Object.assign(out,{speaker_id:saved.material_id+'-s'+index.toString(16).padStart(12,'0'),label,label_basis:basis,is_self:isSelf});return out;
}
function fixture(rows){
 const entries=new Map(rows.map(saved=>[saved.material_id,saved]));const reads=[];
 const query=new q.LocalMaterialQuery({ids:()=>[...entries.keys()].reverse(),read:id=>{reads.push(id);return entries.get(id);}});
 return{entries,reads,query};
}
function filter(changes={}){return Object.assign(new q.LocalMaterialFilter(),{keyword:'预算'},changes);}
function tree(directory){
 const out={};for(const name of fs.readdirSync(directory).sort()){
  const current=path.join(directory,name);if(fs.statSync(current).isDirectory())for(const [child,value] of Object.entries(tree(current)))out[name+'/'+child]=value;
  else out[name]=fs.readFileSync(current).toString('hex');
 }return out;
}

test('real canonical store query and current resolve are read only; edits and tombstones invalidate references',t=>{
 const s=setupMaterialStore(t);const base=s.store.ensure(s.source);const saved=s.store.appendTranscript(base.material_id,base.revision,s.input,'query-real');
 const engine=new q.LocalMaterialQuery({ids:()=>s.store.ids(),read:id=>s.store.read(id)});const before=tree(s.root);
 const page=engine.query(filter({keyword:'测试'}));assert.equal(page.scope,'local_canonical_only');assert.equal(page.schema,1);assert.equal(page.legacy_not_indexed,true);
 assert.equal(page.incomplete,false);assert.equal(page.hits.length,1);const hit=page.hits[0];
 assert.equal(hit.reference.material_id,saved.material_id);assert.equal(hit.reference.revision,2);assert.equal(hit.reference.text_revision,1);
 assert.equal(hit.reference.utterance_id,saved.utterances[0].utterance_id);assert.match(hit.reference.content_sha256,/^[a-f0-9]{64}$/);
 assert.equal(Object.hasOwn(hit.reference,'server_id'),false);assert.equal(Object.hasOwn(hit.reference,'commit_seq'),false);
 const resolved=engine.resolve(hit.reference);assert.equal(resolved.text,'测试语句');resolved.text='caller change';resolved.source.name='caller change';
 assert.equal(s.store.read(saved.material_id).text,'测试语句');assert.deepEqual(tree(s.root),before,'query and resolve do not write canonical or legacy files');
 s.store.correctText(saved.material_id,2,saved.utterances[0].utterance_id,'已更正预算');assert.throws(()=>engine.resolve(hit.reference),/LOCAL_REFERENCE_STALE/);
 const edited=engine.query(filter()).hits[0];s.store.delete(saved.material_id,3);assert.throws(()=>engine.resolve(edited.reference),/LOCAL_REFERENCE_STALE/);
 assert.equal(engine.query(filter()).hits.length,0);assert.equal(s.store.read(saved.material_id,2).text,'测试语句','historical data exists but is never used to resurrect a deleted result');
});

test('keyword and speaker must match the same utterance; labels are case insensitive and scoped ids exact',()=>{
 const saved=row(1),alice=speaker(saved,1,'Alice'),bob=speaker(saved,2,'Bob');saved.speakers=[alice,bob];
 saved.utterances=[part(saved,0,'预算待确认',alice.speaker_id),part(saved,1,'运费沿用上次',bob.speaker_id)];saved.text='预算待确认\n运费沿用上次';
 const s=fixture([saved]);assert.equal(s.query.query(filter({keyword:'运费',speaker:'ALICE'})).hits.length,0);
 const hit=s.query.query(filter({keyword:'运费',speaker:'  bOb  '})).hits[0];assert.equal(hit.reference.utterance_id,saved.utterances[1].utterance_id);
 assert.equal(hit.speaker_label,'Bob');assert.equal(hit.label_basis,'user_confirmed');assert.equal(hit.is_self,false);
 assert.equal(s.query.query(filter({keyword:'',speaker:bob.speaker_id})).hits.length,1);
 assert.equal(s.query.query(filter({keyword:'',speaker:bob.speaker_id.toUpperCase()})).hits.length,0);
 saved.speakers[1].label_basis='role_match';saved.speakers[1].label='佩戴者';assert.equal(s.query.query(filter({keyword:'运费'})).hits[0].is_self,false);
});

test('old anonymous speakers remain local and full-text fallback invents neither speaker nor segment timing',()=>{
 const saved=row(1);saved.utterances=[part(saved,0,'预算待确认','legacy-channel-left')];saved.text='预算待确认';
 const textOnly=row(2,{text:'全文预算 fallback'});const s=fixture([saved,textOnly]);
 const page=s.query.query(filter());const legacy=page.hits.find(hit=>hit.reference.material_id===saved.material_id);
 assert.equal(legacy.speaker_id,'legacy-channel-left');assert.equal(legacy.speaker_label,'说话人 A');assert.equal(legacy.label_basis,'anonymous');assert.equal(legacy.is_self,false);
 const fallback=page.hits.find(hit=>hit.reference.material_id===textOnly.material_id);assert.equal(fallback.start_ms,null);assert.equal(fallback.end_ms,null);
 assert.equal(fallback.speaker_id,'');assert.equal(fallback.speaker_label,'');assert.equal(fallback.reference.utterance_id,'');
 assert.equal(s.query.query(filter({speaker:'说话人 A'})).hits.length,1);
 assert.equal(s.query.query(filter({speaker:'fallback'})).hits.length,0,'full text cannot satisfy an invented speaker');
});

test('deterministic source/id/utterance ordering, bounded pages, limit changes and strict stale cursors',()=>{
 const first=row(1),second=row(2);first.utterances=Array.from({length:12},(_,i)=>part(first,i,'预算'+i));
 second.source.started=2000;second.source.ended=62000;second.utterances=Array.from({length:3},(_,i)=>part(second,i,'预算 newer'+i));
 const s=fixture([second,first]);const one=s.query.query(filter());assert.equal(one.hits.length,10);assert.equal(one.has_more,true);
 assert.deepEqual(plain(one.hits.slice(0,3).map(hit=>hit.reference.material_id)),Array(3).fill(second.material_id));
 assert.equal(one.hits[3].reference.utterance_id,first.utterances[0].utterance_id);
 const two=s.query.query(filter({cursor:one.next_cursor,limit:2}));assert.equal(two.hits.length,2);assert.equal(two.snapshot_sha256,one.snapshot_sha256);
 const three=s.query.query(filter({cursor:two.next_cursor,limit:10}));assert.equal(three.hits.length,3);assert.equal(three.has_more,false);assert.equal(three.next_cursor,'');
 assert.throws(()=>s.query.query(filter({cursor:one.next_cursor,keyword:'newer'})),/LOCAL_QUERY_STALE/);
 assert.throws(()=>s.query.query(filter({cursor:one.snapshot_sha256+':999'})),/LOCAL_QUERY_STALE/);
 first.utterances[0].text='预算 changed same revision';assert.throws(()=>s.query.query(filter({cursor:one.next_cursor})),/LOCAL_QUERY_STALE/);
});

test('content hash protects same-revision text, source metadata and speaker dictionary edits at resolve',()=>{
 const saved=row(1),who=speaker(saved,1,'同事');saved.speakers=[who];saved.utterances=[part(saved,0,'预算',who.speaker_id)];const s=fixture([saved]);
 for(const mutate of [()=>{saved.text+='!';},()=>{saved.source.audioAvailable=false;},()=>{saved.speakers[0].label='新名字';},()=>{saved.utterances[0].overlap=true;}]){
  const reference=s.query.query(filter()).hits[0].reference;mutate();assert.throws(()=>s.query.resolve(reference),/LOCAL_REFERENCE_STALE/);
 }
});

test('source-range references preserve null times and deep-copy the exact split provenance',t=>{
 const s=setupMaterialStore(t);s.input.text='预算后半段';s.input.utterances[0].text=s.input.text;
 s.input.transcriptionState='complete';s.input.coveredMs=60000;s.input.sourceMs=60000;
 const base=s.store.ensure(s.source),saved=s.store.appendTranscript(base.material_id,1,s.input,'split-query');
 const op=new s.MaterialSpeakerCorrection();Object.assign(op,{operation_id:'split-query-operation',kind:'split',utterance_ids:[saved.utterances[0].utterance_id],split_offset:2});
 const split=s.store.correctSpeakers(saved.material_id,2,op);const engine=new q.LocalMaterialQuery({ids:()=>s.store.ids(),read:id=>s.store.read(id)});
 const hit=engine.query(filter({keyword:'后半段'})).hits[0];assert.equal(hit.start_ms,null);assert.equal(hit.end_ms,null);
 assert.deepEqual(plain(hit.reference.source_range),plain(split.utterances[1].source_range));assert.equal(engine.resolve(hit.reference).revision,3);
 const ref=plain(hit.reference);ref.source_range.text_start++;assert.throws(()=>engine.resolve(ref),/LOCAL_REFERENCE_STALE/);
 hit.reference.source_range.text_start=123;assert.notEqual(s.store.read(saved.material_id).utterances[1].source_range.text_start,123);
});

test('day filtering uses utterance absolute time across midnight, half-open endpoints and point segments',()=>{
 const day=86400000;const saved=row(1);saved.source.started=day-10000;saved.source.ended=day+10000;
 saved.utterances=[part(saved,0,'预算 昨天','',{start_ms:0,end_ms:9000}),part(saved,1,'预算 到边界','',{start_ms:9000,end_ms:10000}),
  part(saved,2,'预算 今天','',{start_ms:10000,end_ms:12000}),part(saved,3,'预算 零点','',{start_ms:10000,end_ms:10000}),
  part(saved,4,'预算 明天','',{start_ms:20000,end_ms:20000})];
 const s=fixture([saved]);const page=s.query.query(filter({from:day,to:day+10000}));
 assert.deepEqual(plain(page.hits.map(hit=>hit.excerpt)),['预算 今天','预算 零点']);
 const point=row(2);point.source.started=day;point.source.ended=day;point.text='预算 source point';s.entries.set(point.material_id,point);
 assert.equal(s.query.query(filter({from:day,to:day+1})).hits.some(hit=>hit.reference.material_id===point.material_id),true);
 assert.equal(s.query.query(filter({from:day-1,to:day})).hits.some(hit=>hit.reference.material_id===point.material_id),false);
});

test('split null timestamps filter conservatively by original parent range without claiming a child timestamp',()=>{
 const saved=row(1,{revision:2});saved.source.started=90000;saved.source.ended=110000;
 const range=new m.MaterialSourceRange();Object.assign(range,{parent_utterance_id:'parent',parent_revision:1,start_ms:0,end_ms:20000,text_start:0,text_end:2});
 saved.utterances=[part(saved,0,'预算','',{start_ms:null,end_ms:null,source_range:range})];const s=fixture([saved]);
 const page=s.query.query(filter({from:100000,to:105000}));assert.equal(page.hits.length,1);assert.equal(page.hits[0].start_ms,null);assert.equal(page.hits[0].end_ms,null);
 assert.equal(s.query.query(filter({from:110000,to:120000})).hits.length,0);
});

test('real store midnight end-point utterance survives source prefilter while nonzero and split ranges remain half-open',t=>{
 const s=setupMaterialStore(t),day=86400000;
 const source={...s.source,started:day-60000,ended:day};const base=s.store.ensure(source);
 const before=new s.MaterialUtterance();Object.assign(before,{text:'预算午夜之前',start_ms:59000,end_ms:60000,speaker_id:'speaker-0',speaker_basis:'segment_cluster'});
 const point=new s.MaterialUtterance();Object.assign(point,{text:'预算午夜点',start_ms:60000,end_ms:60000,speaker_id:'speaker-0',speaker_basis:'segment_cluster'});
 s.input.text=before.text+'\n'+point.text;s.input.utterances=[before,point];s.input.transcriptionState='complete';s.input.coveredMs=60000;s.input.sourceMs=60000;
 const saved=s.store.appendTranscript(base.material_id,1,s.input,'midnight-endpoint');
 const engine=new q.LocalMaterialQuery({ids:()=>s.store.ids(),read:id=>s.store.read(id)});
 const today=engine.query(filter({from:day,to:day+1}));
 assert.deepEqual(plain(today.hits.map(hit=>hit.reference.utterance_id)),[saved.utterances[1].utterance_id]);
 const yesterday=engine.query(filter({from:day-1,to:day}));
 assert.deepEqual(plain(yesterday.hits.map(hit=>hit.reference.utterance_id)),[saved.utterances[0].utterance_id]);
 const op=new s.MaterialSpeakerCorrection();Object.assign(op,{operation_id:'split-midnight-boundary',kind:'split',utterance_ids:[saved.utterances[0].utterance_id],split_offset:2});
 const split=s.store.correctSpeakers(saved.material_id,2,op);
 assert.equal(split.utterances[0].start_ms,null);assert.equal(split.utterances[1].end_ms,null);
 assert.deepEqual(plain(engine.query(filter({from:day,to:day+1})).hits.map(hit=>hit.reference.utterance_id)),[saved.utterances[1].utterance_id]);
 const splitYesterday=engine.query(filter({from:day-1,to:day}));assert.equal(splitYesterday.hits.length,1);
 assert.equal(splitYesterday.hits[0].start_ms,null);assert.equal(splitYesterday.hits[0].reference.source_range.end_ms,60000);
 const fallback={...s.source,name:'take-'+'b'.repeat(32),started:day-60000,ended:day};s.store.ensure(fallback,'预算全文回退');
 assert.equal(engine.query(filter({from:day,to:day+1})).hits.some(hit=>hit.name===fallback.name),false,'text-only fallback ending at from remains excluded');
});

test('Unicode excerpts map expanded lowercase offsets, preserve emoji and bound long matched previews',()=>{
 const saved=row(1);saved.text='İ'.repeat(400)+'😀'.repeat(30)+'TARGET金额'+'😀'.repeat(200);const s=fixture([saved]);
 const hit=s.query.query(filter({keyword:'target金额'})).hits[0];assert.equal(hit.excerpt.includes('TARGET金额'),true);assert.ok(hit.excerpt.length<=160);
 assert.equal(hit.excerpt.isWellFormed(),true);
 saved.text='前言'.repeat(300)+'😀'.repeat(90)+'预算'+'😀'.repeat(300);const emoji=s.query.query(filter()).hits[0].excerpt;
 assert.equal(emoji.includes('预算'),true);assert.equal(emoji.isWellFormed(),true);assert.ok(emoji.length<=160);
 const long='长'.repeat(200);saved.text='前'.repeat(300)+long+'后'.repeat(300);const preview=s.query.query(filter({keyword:long})).hits[0].excerpt;
 assert.equal(preview.length,160);assert.equal(preview.startsWith('长'),true,'a >160-unit match is a bounded preview, not a claim to display the complete keyword');
 assert.equal(s.query.resolve(s.query.query(filter({keyword:long})).hits[0].reference).text,saved.text);
});

test('exact request validation rejects invalid shape, controls, surrogates, ranges, counts and noncanonical cursors',()=>{
 const s=fixture([]);const invalid=[{},filter({extra:true}),filter({keyword:' ',speaker:' '}),filter({keyword:'\n预算'}),filter({keyword:'预算\u0085'}),
  filter({keyword:'a'.repeat(201)}),filter({speaker:'a'.repeat(81)}),filter({keyword:'\ud800'}),filter({speaker:'\udfff'}),filter({from:-1}),
  filter({to:1.5}),filter({from:3,to:2}),filter({from:0,to:367*86400000}),filter({from:8640000000000001,to:8640000000000002}),
  filter({limit:0}),filter({limit:11}),filter({limit:1.5}),filter({cursor:'a'.repeat(64)+':01'}),filter({cursor:'A'.repeat(64)+':0'}),
  filter({cursor:'a'.repeat(64)+':9007199254740992'}),filter({cursor:'x'}),filter({cursor:null}),filter({keyword:4})];
 for(const value of invalid)assert.throws(()=>s.query.query(value),/LOCAL_QUERY_INVALID/);
 assert.equal(s.reads.length,0,'invalid requests fail before any source read');assert.equal(s.query.query(filter({keyword:' 预算 '})).hits.length,0);
 assert.equal(s.query.query(filter({keyword:'',speaker:'甲'})).hits.length,0);
 assert.equal(s.query.query(filter({from:0,to:366*86400000})).hits.length,0);
});

test('unreadable and unknown canonical rows report incomplete coverage and changing error status invalidates cursors',()=>{
 const saved=row(1);saved.utterances=Array.from({length:12},(_,i)=>part(saved,i,'预算'+i));const broken=row(2);
 const entries=new Map([[saved.material_id,saved],[broken.material_id,undefined]]);let throwRead=false;
 const engine=new q.LocalMaterialQuery({ids:()=>[...entries.keys(),'unknown-id'],read:id=>{if(throwRead&&id===broken.material_id)throw Error('unreadable');return entries.get(id);}});
 const page=engine.query(filter());assert.equal(page.unreadable,2);assert.equal(page.incomplete,true);assert.equal(page.incomplete_reason,'unreadable');assert.equal(page.has_more,true);
 throwRead=true;assert.equal(engine.query(filter()).unreadable,2);
 entries.set(broken.material_id,{schema_version:99});assert.equal(engine.query(filter()).unreadable,2);
 throwRead=false;entries.set(broken.material_id,broken);assert.throws(()=>engine.query(filter({cursor:page.next_cursor})),/LOCAL_QUERY_STALE/);
 for(const bad of [undefined,{}, {schema_version:1}]){entries.set(broken.material_id,bad);assert.equal(engine.query(filter()).unreadable,2);}
 const idsFail=new q.LocalMaterialQuery({ids:()=>{throw Error('cannot list');},read:()=>{throw Error('must not read');}}).query(filter());
 assert.equal(idsFail.incomplete,true);assert.equal(idsFail.incomplete_reason,'unreadable');assert.equal(idsFail.unreadable,1);assert.equal(idsFail.scanned,0);
 const malformedList=new q.LocalMaterialQuery({ids:()=>undefined,read:()=>{throw Error('must not read');}}).query(filter());assert.equal(malformedList.incomplete,true);
});

test('scan bound sorts ids before at most512 reads and never claims complete coverage',()=>{
 const rows=Array.from({length:513},(_,i)=>row(i+1));const s=fixture(rows);const page=s.query.query(filter());
 assert.equal(page.scanned,512);assert.equal(s.reads.length,512);assert.deepEqual(s.reads,[...s.reads].sort());assert.equal(page.incomplete,true);assert.equal(page.incomplete_reason,'scan_limit');
 assert.equal(page.hits.length,10);assert.equal(s.reads.includes(rows[512].material_id),false);
});

test('complete-record UTF16 budget bounds metadata and text before further reads and preserves partial results',()=>{
 const rows=[row(1,{text:'预算'+'文'.repeat(800000)}),row(2,{text:'预算'+'文'.repeat(800000)}),row(3,{text:'预算'+'文'.repeat(800000)}),row(4)];
 const s=fixture(rows);const page=s.query.query(filter());assert.equal(page.incomplete,true);assert.equal(page.incomplete_reason,'text_limit');assert.equal(page.hits.length,2);assert.equal(s.reads.length,3);
 const metadata=row(5);metadata.metadata='x'.repeat(2*1024*1024);const heavy=fixture([metadata]).query.query(filter());
 assert.equal(heavy.hits.length,0);assert.equal(heavy.incomplete,true);assert.equal(heavy.incomplete_reason,'text_limit');
});

test('resolve rejects unknown reference fields and changed identity, segment, range, revision or missing current source',()=>{
 const saved=row(1);saved.utterances=[part(saved,0,'预算')];const s=fixture([saved]);const reference=plain(s.query.query(filter()).hits[0].reference);
 for(const bad of [{...reference,server_id:'fake'}, {...reference,content_sha256:undefined}, {...reference,revision:0}, {...reference,material_id:'../outside'}])
  assert.throws(()=>s.query.resolve(bad),/LOCAL_REFERENCE_INVALID/);
 for(const changed of [{...reference,utterance_id:'other'}, {...reference,revision:2}, {...reference,text_revision:0}, {...reference,utterance_id:''}])
  assert.throws(()=>s.query.resolve(changed),/LOCAL_REFERENCE_STALE/);
 const before=JSON.stringify(saved);const result=s.query.resolve(reference);result.utterances[0].text='caller mutation';assert.equal(JSON.stringify(saved),before);
 saved.operation='delete';assert.throws(()=>s.query.resolve(reference),/LOCAL_REFERENCE_STALE/);s.entries.delete(saved.material_id);assert.throws(()=>s.query.resolve(reference),/LOCAL_REFERENCE_STALE/);
});
