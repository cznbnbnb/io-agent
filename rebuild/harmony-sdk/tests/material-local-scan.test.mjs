import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {loadApp} from './load-app.mjs';
import {setupMaterialStore} from './material-fixture.mjs';

const q=loadApp('MaterialLocalQuery'),plain=value=>JSON.parse(JSON.stringify(value));
const scanFilter=changes=>Object.assign(new q.LocalMaterialScanFilter(),{keyword:'needle',...changes});
const legacyFilter=changes=>Object.assign(new q.LocalMaterialFilter(),{keyword:'needle',...changes});
function fixture(t){
 assert.match(path.resolve(os.tmpdir()),/^[Dd]:[\\/]/,'scan tests require managed D: TEMP');
 const f=setupMaterialStore(t),reads=[];let afterRead=()=>{};
 // Real filesystem adapters only; full writes keep large real-record fixtures
 // economical. Short-write recovery belongs to the separate Store tests.
 f.io.writeSync=(fd,bytes)=>fs.writeSync(fd,new Uint8Array(bytes));
 f.io.lstatSync=p=>{const st=fs.lstatSync(p,{bigint:true});return{ino:st.ino,size:Number(st.size),mtime:Number(st.mtimeNs)/1e9,
  ctime:Number(st.ctimeNs)/1e9,mtimeNs:st.mtimeNs,ctimeNs:st.ctimeNs,isSymbolicLink:()=>st.isSymbolicLink(),isFile:()=>st.isFile(),isDirectory:()=>st.isDirectory()};};
 function add(n,text,{parts,started=n*1000}={}){
  const source=Object.assign(new f.MaterialSource(),plain(f.source),{name:'take-'+n.toString(16).padStart(32,'0'),started,ended:started+60000});
  if(parts===undefined)return f.store.ensure(source,text);
  const input=Object.assign(new f.MaterialTextInput(),{text,channel:'mix'});
  input.utterances=parts.map((value,index)=>Object.assign(new f.MaterialUtterance(),{text:value,start_ms:index*20,end_ms:index*20+20}));
  return f.store.ensure(source,text,input);
 }
 const engine=(store=f.store,overrides={})=>new q.LocalMaterialQuery({ids:()=>store.ids(),read:id=>{reads.push(id);const row=store.read(id);afterRead(id,row);return row;},catalog:()=>store.queryCatalog(),...overrides});
 const cold=()=>{const store=new f.MaterialStore();store.initialize(f.root);return{store,query:engine(store)};};
 const head=(row,revision=row.revision)=>f.root+'/materials/'+row.material_id+'/revision-'+String(revision).padStart(9,'0')+'.json';
 const tree=()=>{const out=[];function visit(dir){for(const name of fs.readdirSync(dir).sort()){const p=dir+'/'+name,st=fs.lstatSync(p);
  if(st.isDirectory())visit(p);else out.push([p.slice(f.root.length),createHash('sha256').update(fs.readFileSync(p)).digest('hex')]);}}visit(f.root);return out;};
 return{...f,add,engine,cold,head,reads,tree,afterRead:callback=>afterRead=callback};
}
function exactError(fn,code){assert.throws(fn,error=>error.message===code);}

test('actual 513th unique word is reachable across cold scan windows; hit and scan cursors remain separate',t=>{
 const f=fixture(t);let first,last;
 for(let n=1;n<=513;n++){const saved=f.add(n,n===513?'needle unique513':'needle ordinary',{parts:n===1?['needle ordinary']:undefined});if(n===1)first=saved;if(n===513)last=saved;}
 const before=f.tree(),query=f.engine();f.reads.length=0;
 const firstPage=query.scan(scanFilter({limit:3}));assert.equal(firstPage.scope,'local_canonical_window');assert.equal(firstPage.catalog_total,513);
 assert.equal(firstPage.window_start,0);assert.equal(firstPage.window_end,512);assert.equal(firstPage.scanned,512);assert.equal(f.reads.length,512);
 assert.equal(firstPage.scan_has_more,true);assert.equal(firstPage.stop_reason,'scan_limit');assert.equal(firstPage.incomplete,true);
 assert.equal(firstPage.has_more,true);assert.match(firstPage.next_cursor,/^[a-f0-9]{64}:3$/);assert.match(firstPage.next_scan_cursor,/^lscan1:[a-f0-9]{64}:[a-f0-9]{64}:512$/);
 assert.deepEqual(plain(firstPage.hits.map(hit=>hit.source_started)),[512000,511000,510000],'ordering is within this window');
 const nextHits=f.cold().query.scan(scanFilter({scan_cursor:firstPage.scan_cursor,hit_cursor:firstPage.next_cursor,limit:4}));
 assert.equal(nextHits.window_start,0);assert.equal(nextHits.window_end,512);assert.equal(nextHits.snapshot_sha256,firstPage.snapshot_sha256);
 assert.deepEqual(plain(nextHits.hits.map(hit=>hit.source_started)),[509000,508000,507000,506000]);
 const second=f.cold().query.scan(scanFilter({scan_cursor:firstPage.next_scan_cursor}));
 assert.equal(second.window_start,512);assert.equal(second.window_end,513);assert.equal(second.scanned,1);assert.equal(second.scan_has_more,false);assert.equal(second.next_scan_cursor,'');
 assert.equal(second.hits.length,1);assert.equal(second.hits[0].reference.material_id,last.material_id);
 assert.equal(second.incomplete,true);assert.equal(second.incomplete_reason,'window_only','a final window alone never claims a complete global result');
 exactError(()=>query.scan(scanFilter({scan_cursor:firstPage.next_scan_cursor,hit_cursor:firstPage.next_cursor})),'LOCAL_QUERY_STALE');
 const unique=query.scan(scanFilter({keyword:'unique513'}));assert.equal(unique.hits.length,0);
 assert.equal(f.cold().query.scan(scanFilter({keyword:'unique513',scan_cursor:unique.next_scan_cursor})).hits[0].reference.material_id,last.material_id);
 const legacy=new q.LocalMaterialQuery({ids:()=>f.store.ids(),read:id=>f.store.read(id)});
 assert.equal(legacy.query(legacyFilter({keyword:'unique513'})).hits.length,0,'legacy bounded API remains unchanged');
 const reference=query.scan(scanFilter({limit:1})).hits[0].reference;assert.equal(query.resolve(reference).material_id,reference.material_id);
 exactError(()=>legacy.scan(scanFilter()),'LOCAL_SCAN_UNAVAILABLE');assert.deepEqual(f.tree(),before,'normal scan, cursor replay and resolve are read only');
 // Real legal commits in the already-scanned and not-yet-scanned ranges both
 // invalidate the old scan token, including after constructing a cold engine.
 f.store.correctText(first.material_id,first.revision,first.utterances[0].utterance_id,'needle changed earlier');
 exactError(()=>f.cold().query.scan(scanFilter({scan_cursor:firstPage.next_scan_cursor})),'LOCAL_QUERY_STALE');
 let fresh=query.scan(scanFilter());f.store.ensure(Object.assign(new f.MaterialSource(),plain(last.source),{audioBytes:last.source.audioBytes+1}));
 exactError(()=>f.cold().query.scan(scanFilter({scan_cursor:fresh.next_scan_cursor})),'LOCAL_QUERY_STALE');
 fresh=query.scan(scanFilter());const extra=f.add(514,'needle added');
 exactError(()=>query.scan(scanFilter({scan_cursor:fresh.next_scan_cursor})),'LOCAL_QUERY_STALE');
 fresh=query.scan(scanFilter());f.store.delete(extra.material_id,extra.revision);
 exactError(()=>f.cold().query.scan(scanFilter({scan_cursor:fresh.next_scan_cursor})),'LOCAL_QUERY_STALE');
});

test('cumulative full-record UTF16 budget probes the next row but cold continuation retries it without skipping',t=>{
 const f=fixture(t),one=f.add(1,'x'.repeat(800000),{started:1000}),two=f.add(2,'x'.repeat(800000),{started:2000}),
  three=f.add(3,'x'.repeat(800000),{started:3000}),today=f.add(4,'needle today',{started:100000});
 const filter=scanFilter({from:100000,to:160000}),query=f.engine(),before=f.tree();f.reads.length=0;
 const first=query.scan(filter);assert.equal(first.stop_reason,'text_limit');assert.equal(first.window_end,2);assert.equal(first.scanned,3);
 assert.deepEqual(f.reads,[one.material_id,two.material_id,three.material_id]);assert.equal(first.content_units,JSON.stringify(f.store.read(one.material_id)).length+JSON.stringify(f.store.read(two.material_id)).length);
 assert(first.content_units<=2097152);assert.equal(first.oversized,0);assert.equal(first.hits.length,0);assert.equal(first.scan_has_more,true);
 f.reads.length=0;const second=f.cold().query.scan(scanFilter({from:100000,to:160000,scan_cursor:first.next_scan_cursor}));
 assert.deepEqual(f.reads,[three.material_id,today.material_id]);assert.equal(second.window_start,2);assert.equal(second.window_end,4);assert.equal(second.stop_reason,'end');
 assert.equal(second.hits.length,1);assert.equal(second.hits[0].reference.material_id,today.material_id);assert.deepEqual(f.tree(),before);
});

test('single legal over-budget record is explicitly unsearched; a following cold window still reaches later material',t=>{
 const f=fixture(t),heavy=f.add(1,'a'.repeat(1000000),{parts:Array(1000).fill('a'.repeat(1000))}),later=f.add(2,'needle after oversized');
 const stored=f.store.read(heavy.material_id);assert(JSON.stringify(stored).length>2097152);assert(fs.statSync(f.head(heavy)).size<4000000);
 const before=f.tree(),first=f.engine().scan(scanFilter());assert.equal(first.oversized,1);assert.equal(first.unreadable,0);assert.equal(first.stop_reason,'oversized');
 assert.equal(first.window_end,1);assert.equal(first.content_units,0);assert.equal(first.hits.length,0);assert.equal(first.incomplete,true);assert.equal(first.incomplete_reason,'oversized');
 const next=f.cold().query.scan(scanFilter({scan_cursor:first.next_scan_cursor}));assert.equal(next.window_start,1);assert.equal(next.window_end,2);assert.equal(next.hits[0].reference.material_id,later.material_id);
 assert.equal(next.scan_has_more,false);assert.deepEqual(f.tree(),before);
});

test('unreadable current and partial-only IDs advance with incomplete disclosure rather than disappearing from coverage',t=>{
 const f=fixture(t),broken=f.add(1,'needle broken'),good=f.add(3,'needle good'),id='mat-recording-'+(2).toString(16).padStart(32,'0');
 fs.writeFileSync(f.head(broken),'broken JSON');fs.mkdirSync(f.root+'/materials/'+id);fs.writeFileSync(f.root+'/materials/'+id+'/revision-000000001.json.partial','unfinished');
 const result=f.engine().scan(scanFilter());assert.equal(result.catalog_total,3);assert.equal(result.window_end,3);assert.equal(result.scanned,3);assert.equal(result.unreadable,2);
 assert.equal(result.incomplete,true);assert.equal(result.incomplete_reason,'unreadable');assert.equal(result.hits.length,1);assert.equal(result.hits[0].reference.material_id,good.material_id);
});

test('metadata change during actual source reading rejects the window before returning old matches',t=>{
 const f=fixture(t),saved=f.add(1,'needle body'),query=f.engine();let touched=false;
 f.afterRead(()=>{if(!touched){touched=true;fs.appendFileSync(f.head(saved),' ');}});
 exactError(()=>query.scan(scanFilter()),'LOCAL_QUERY_STALE');assert.equal(touched,true);
});

test('same-revision source tampering cannot make an old scan reference open changed full text',t=>{
 const f=fixture(t),saved=f.add(1,'needle original'),query=f.engine(),hit=query.scan(scanFilter()).hits[0];
 const altered=f.store.read(saved.material_id);altered.text='needle replaced';fs.writeFileSync(f.head(saved),JSON.stringify(altered));
 exactError(()=>query.resolve(hit.reference),'LOCAL_REFERENCE_STALE');
});

test('scan rejects malformed requests before catalog or source IO and validates cursor binding/ranges',t=>{
 const f=fixture(t);f.add(1,'needle valid');let catalogs=0;
 const query=f.engine(f.store,{catalog:()=>{catalogs++;return f.store.queryCatalog();}});
 const bad=[{},scanFilter({extra:true}),scanFilter({cursor:''}),scanFilter({keyword:' '}),scanFilter({keyword:'\ud800'}),scanFilter({speaker:'\n'}),
  scanFilter({from:-1}),scanFilter({from:10,to:9}),scanFilter({limit:0}),scanFilter({limit:11}),scanFilter({scan_cursor:null}),scanFilter({hit_cursor:null}),
  scanFilter({scan_cursor:'lscan1:'+('a'.repeat(64))+':'+('b'.repeat(64))+':01'}),scanFilter({scan_cursor:'x'}),scanFilter({hit_cursor:'x'}),
  scanFilter({hit_cursor:'a'.repeat(64)+':01'}),scanFilter({scan_cursor:'lscan1:'+('a'.repeat(64))+':'+('b'.repeat(64))+':9007199254740992'}),
  scanFilter({hit_cursor:'a'.repeat(64)+':9007199254740992'}),
  scanFilter({scan_cursor:'lscan1:'+('a'.repeat(64))+':'+('b'.repeat(64))+':0',hit_cursor:'a'.repeat(64)+':9007199254740992'})];
 for(const input of bad)exactError(()=>query.scan(input),'LOCAL_QUERY_INVALID');
 assert.equal(catalogs,0,'malformed fields including unsafe cursor numbers fail before catalog IO');assert.equal(f.reads.length,0);
 const valid=query.scan(scanFilter());const tokens=valid.scan_cursor.split(':');
 exactError(()=>query.scan(scanFilter({keyword:'different',scan_cursor:valid.scan_cursor})),'LOCAL_QUERY_STALE');
 tokens[3]='2';exactError(()=>query.scan(scanFilter({scan_cursor:tokens.join(':')})),'LOCAL_QUERY_STALE');
 exactError(()=>query.scan(scanFilter({scan_cursor:valid.scan_cursor,hit_cursor:valid.snapshot_sha256+':99'})),'LOCAL_QUERY_STALE');
});

test('catalog absence, malformed DTOs and either observation failure fail closed without pretending empty results',t=>{
 const f=fixture(t);f.add(1,'needle source');const saved=plain(f.store.queryCatalog());
 const missing=new q.LocalMaterialQuery({ids:()=>f.store.ids(),read:id=>f.store.read(id)});exactError(()=>missing.scan(scanFilter()),'LOCAL_SCAN_UNAVAILABLE');
 for(const catalog of [undefined,{}, {...saved,extra:true},{...saved,snapshot_sha256:'x'},{...saved,ids:[...saved.ids,...saved.ids]},
  {...saved,ids:['../outside']},{...saved,ids:[3]}])exactError(()=>f.engine(f.store,{catalog:()=>catalog}).scan(scanFilter()),'LOCAL_SCAN_UNAVAILABLE');
 for(const at of [1,2]){let count=0;const query=f.engine(f.store,{catalog:()=>{if(++count===at)throw Error('private failure token=secret');return f.store.queryCatalog();}});
  exactError(()=>query.scan(scanFilter()),'LOCAL_SCAN_UNAVAILABLE');assert.equal(count,at);}
});
