import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {createHash,randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';

// Independent loader: this test does not alter the shared application loader.
const require=createRequire(import.meta.url);
const ts=require(`${process.env.DEVECO_HOME||'D:/APP/DevEcoStudio'}/sdk/default/openharmony/ets/build-tools/ets-loader/node_modules/typescript`);
const source=fs.readFileSync(new URL('../entry/src/main/ets/MaterialOutboxArchiveIndex.ets',import.meta.url),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS}}).outputText;
const hash=text=>createHash('sha256').update(text,'utf8').digest('hex');
const bytes=text=>Buffer.byteLength(text,'utf8');
const plain=value=>JSON.parse(JSON.stringify(value));
const change=(key,value,replace=false)=>({key,value:JSON.stringify(value),replace});
const corrupt=/OUTBOX_ARCHIVE_CORRUPT/;
const conflict=/OUTBOX_ARCHIVE_CONFLICT/;
const full=/OUTBOX_ARCHIVE_FULL/;

function load(io){
 const module={exports:{}};
 vm.runInNewContext(compiled,{module,exports:module.exports,require:name=>{
  if(name==='@kit.CoreFileKit')return{fileIo:io};
  if(name==='@kit.ArkTS')return{util:{TextEncoder:class{encodeInto(text){return new TextEncoder().encode(text);}},TextDecoder:class{decodeToString(value){return new TextDecoder().decode(value);}}}};
  throw Error(`Unexpected archive import ${name}`);
 },Uint8Array,ArrayBuffer,Map,Set,Object,JSON,Error});
 return module.exports;
}
function setup(t){
 const parent=fs.realpathSync(os.tmpdir());assert.match(parent,/^[Dd]:[\\/]/,'archive scratch must remain on D:');
 const root=fs.mkdtempSync(path.join(parent,'material-archive-index-')),token=randomUUID(),marker=path.join(root,'.owner.json');
 fs.writeFileSync(marker,JSON.stringify({kind:'material-archive-index-test',root,parent,token}));
 const partition=path.join(root,'partition').replaceAll('\\','/'),archive=partition+'/archive-index',partitionId=hash('synthetic-owner/phone/server');fs.mkdirSync(partition);
 const handles=new Set(),writers=new Set(),positions=new Map(),events=[],reads=[];
 const fault={zero:false,written:undefined,promotion:'',short:37,shortRead:13,readCount:undefined,fsync:false,listing:undefined,onClose:undefined,onRename:undefined};
 const io={OpenMode:{CREATE:1,WRITE_ONLY:2,TRUNC:4,READ_ONLY:8},accessSync:fs.existsSync,mkdirSync:p=>{events.push(['mkdir',p]);fs.mkdirSync(p);},
  listFileSync:p=>fault.listing&&p===archive?fault.listing:fs.readdirSync(p),lstatSync:fs.lstatSync,statSync:p=>typeof p==='number'?fs.fstatSync(p):fs.statSync(p),readTextSync:p=>fs.readFileSync(p,'utf8'),
  openSync:(p,mode)=>{const writing=(mode&2)!==0,fd=fs.openSync(p,writing?'w':'r');handles.add(fd);positions.set(fd,0);if(writing){writers.add(fd);events.push(['open',p]);}return{fd};},
  closeSync:file=>{const fd=typeof file==='number'?file:file.fd,writing=writers.has(fd);fs.closeSync(fd);handles.delete(fd);writers.delete(fd);positions.delete(fd);if(writing){events.push(['close',fd]);fault.onClose?.();}},
  readSync:(fd,buffer,options={})=>{
   // Harmony ReadOptions.offset is relative to the current filePointer,
   // never a buffer offset or an absolute pread position (SDK fs.d.ts).
   const length=Math.min(options.length??buffer.byteLength,fault.shortRead),position=(positions.get(fd)??0)+(options.offset??0);
   const count=fault.readCount??fs.readSync(fd,new Uint8Array(buffer),0,length,position);
   if(Number.isSafeInteger(count)&&count>=0&&count<=length)positions.set(fd,position+count);
   reads.push({fd,offset:options.offset,position,length,count});return count;
  },
  writeSync:(fd,value)=>{events.push(['write',fd]);if(fault.zero)return 0;if(fault.written!==undefined)return fault.written;return fs.writeSync(fd,new Uint8Array(value).slice(0,fault.short));},
  fsyncSync:fd=>{events.push(['fsync',fd]);if(fault.fsync)throw Error('synthetic-fsync-failure');fs.fsyncSync(fd);},
  renameSync:(from,to)=>{events.push(['rename',from,to]);if(fault.promotion==='before')throw Error('synthetic-promotion-before');fs.renameSync(from,to);fault.onRename?.();if(fault.promotion==='after')throw Error('synthetic-promotion-after');}};
 const mod=load(io),index=new mod.MaterialOutboxArchiveIndex();index.initialize(partition,partitionId,hash);
 t.after(()=>{
  assert.equal(handles.size,0,'all archive file handles must close');
  const resolved=fs.realpathSync(root),owner=JSON.parse(fs.readFileSync(marker,'utf8'));
  assert.equal(resolved,path.resolve(root));assert.equal(owner.token,token);assert.equal(owner.kind,'material-archive-index-test');
  assert.equal(owner.root,root);assert.equal(owner.parent,parent);assert(resolved.startsWith(parent+path.sep));
  assert(!fs.lstatSync(root).isSymbolicLink());fs.rmSync(root,{recursive:true});
 });
 return{root,partition,archive,partitionId,mod,index,io,fault,events,reads,handles,
  restart(id=partitionId){const next=new mod.MaterialOutboxArchiveIndex();next.initialize(partition,id,hash);return next;},
  put(data){fs.mkdirSync(archive,{recursive:true});const raw=JSON.stringify(data),sha256=hash(raw),head={bucket:hash(data.entries[0]?.key||'r:empty').slice(0,3),sha256,bytes:bytes(raw),entries:data.entries.length};fs.writeFileSync(archive+'/'+sha256+'.bucket.json',raw);return head;}};
}
function collisionKeys(count=2){
 const buckets=new Map();
 for(let n=0;n<1000000;n++){
  const key='r:synthetic-'+n,bucket=hash(key).slice(0,3),keys=buckets.get(bucket)||[];keys.push(key);buckets.set(bucket,keys);if(keys.length===count)return keys;
 }
 throw Error('No SHA256 bucket collision found');
}
function tree(root){
 if(!fs.existsSync(root))return[];
 return fs.readdirSync(root).sort().map(name=>{const stat=fs.lstatSync(path.join(root,name));return{name,size:stat.size,hash:stat.isFile()?hash(fs.readFileSync(path.join(root,name),'utf8')):'directory'};});
}

test('prepare/get/verify are read-only and an unpublished prepared node is not a stored value',t=>{
 const f=setup(t);assert.equal(fs.existsSync(f.archive),false);assert.equal(f.index.get([],'r:a:1'),undefined);f.index.verify([]);
 const prepared=f.index.prepare([],[change('r:a:1',{payload_hash:hash('synthetic'),receipt_id:'synthetic-receipt'})]);
 assert.equal(fs.existsSync(f.archive),false);assert.equal(f.events.length,0);assert.equal(prepared.heads.length,1);assert.equal(prepared.nodes.length,1);
 assert.equal(f.index.get([],'r:a:1'),undefined);assert.throws(()=>f.index.get(prepared.heads,'r:a:1'),corrupt);
 f.index.persist(prepared);assert.equal(f.index.get(prepared.heads,'r:a:1'),JSON.stringify({payload_hash:hash('synthetic'),receipt_id:'synthetic-receipt'}));
 assert.equal(f.restart().get(prepared.heads,'r:a:1'),f.index.get(prepared.heads,'r:a:1'));assert.equal(f.index.get(prepared.heads,'r:absent:1'),undefined);
 const before=tree(f.archive);f.index.prepare(prepared.heads,[]);f.index.verify(prepared.heads);assert.deepEqual(tree(f.archive),before);
});

test('real SHA256 prefix collisions remain exact keys and old heads remain queryable',t=>{
 const f=setup(t),[a,b]=collisionKeys();assert.notEqual(a,b);assert.equal(hash(a).slice(0,3),hash(b).slice(0,3));
 const first=f.index.prepare([],[change(a,{revision:1})]);f.index.persist(first);
 const second=f.index.prepare(first.heads,[change(b,{revision:2})]);f.index.persist(second);
 assert.equal(second.heads.length,1);assert.equal(second.heads[0].entries,2);assert.notEqual(first.heads[0].sha256,second.heads[0].sha256);
 assert.equal(f.restart().get(first.heads,a),'\u007b"revision":1\u007d');assert.equal(f.index.get(first.heads,b),undefined);
 assert.equal(f.index.get(second.heads,b),'\u007b"revision":2\u007d');assert(fs.existsSync(f.archive+'/'+first.heads[0].sha256+'.bucket.json'));
 const entries=JSON.parse(second.nodes[0].raw).entries;assert.deepEqual(entries.map(v=>v.key),[a,b].sort());
});

test('only m: values may be replaced; immutable values and same-hash adoption retain bytes',t=>{
 const f=setup(t),first=f.index.prepare([],[change('m:synthetic',1),change('r:synthetic:1',{id:'old'})]);f.index.persist(first);
 assert.throws(()=>f.index.prepare(first.heads,[change('r:synthetic:1',{id:'new'})]),conflict);
 for(const key of ['r:new:1','q:'+hash('q'),'o:marc-'+ 'a'.repeat(32)])assert.throws(()=>f.index.prepare(first.heads,[change(key,1,true)]),conflict);
 const second=f.index.prepare(first.heads,[change('m:synthetic',2,true)]);f.index.persist(second);
 assert.equal(f.index.get(first.heads,'m:synthetic'),'1');assert.equal(f.index.get(second.heads,'m:synthetic'),'2');
 const same=f.index.prepare(second.heads,[change('m:synthetic',2,true)]),before=tree(f.archive),writes=f.events.filter(v=>v[0]==='write').length;
 f.index.persist(same);assert.deepEqual(tree(f.archive),before);assert.equal(f.events.filter(v=>v[0]==='write').length,writes);
 assert.equal(f.index.get(second.heads,'r:synthetic:1'),JSON.stringify({id:'old'}));
});

test('head shape, uniqueness, size and referenced missing files fail closed',t=>{
 const f=setup(t),prepared=f.index.prepare([],[change('r:a:1',1)]),head=plain(prepared.heads[0]);
 for(const heads of [[head,head],[{...head,bucket:123}],[{...head,sha256:'A'.repeat(64)}],[{...head,bytes:2000001}],[{...head,entries:0}],[{...head,extra:1}],Array.from({length:4097},()=>head)]){
  assert.throws(()=>f.index.verify(heads),corrupt);assert.throws(()=>f.index.prepare(heads,[]),corrupt);
 }
 assert.throws(()=>f.index.verify([head]),corrupt);assert.throws(()=>f.index.persist({heads:[head],nodes:[]}),corrupt);
 assert.equal(fs.existsSync(f.archive),false);
});

test('every referenced head is checked even when prepare changes a different bucket',t=>{
 const f=setup(t),first=f.index.prepare([],[change('r:a:1',1),change('r:b:1',2)]);f.index.persist(first);assert.equal(first.heads.length,2);
 fs.unlinkSync(f.archive+'/'+first.heads[0].sha256+'.bucket.json');
 assert.throws(()=>f.index.prepare(first.heads,[change('m:other',1,true)]),corrupt);assert.throws(()=>f.index.verify(first.heads),corrupt);
 const otherKey=hash('r:a:1').slice(0,3)===first.heads[0].bucket?'r:b:1':'r:a:1';
 assert.throws(()=>f.index.get(first.heads,otherKey),corrupt,'a readable other bucket cannot conceal a missing reference');
 assert.throws(()=>f.index.get(first.heads,'r:absent:999'),corrupt,'a miss cannot conceal a missing reference');
});

test('corrupt bytes, foreign principal, schema, bucket and noncanonical entries are rejected',t=>{
 const f=setup(t),[a,b]=collisionKeys(),entry={key:a,value:'1'};
 const candidates=[
  {schema:1,partition_id:hash('foreign'),entries:[entry]},
  {schema:2,partition_id:f.partitionId,entries:[entry]},
  {schema:1,partition_id:f.partitionId,entries:[entry],extra:true},
  {schema:1,partition_id:f.partitionId,entries:[{...entry,extra:true}]},
  {schema:1,partition_id:f.partitionId,entries:[{...entry,value:'not JSON'}]},
  {schema:1,partition_id:f.partitionId,entries:[entry,entry]},
  {schema:1,partition_id:f.partitionId,entries:[{key:[a,b].sort()[1],value:'1'},{key:[a,b].sort()[0],value:'2'}]},
 ];
 for(const data of candidates){const head=f.put(data);assert.throws(()=>f.index.get([head],a),corrupt);}
 const valid=f.put({schema:1,partition_id:f.partitionId,entries:[entry]});
 assert.throws(()=>f.index.verify([{...valid,bucket:valid.bucket==='000'?'001':'000'}]),corrupt);
 assert.throws(()=>f.index.verify([{...valid,bytes:valid.bytes+1}]),corrupt);
 assert.throws(()=>f.restart(hash('other principal')).verify([valid]),corrupt);
 fs.writeFileSync(f.archive+'/'+valid.sha256+'.bucket.json',JSON.stringify({schema:1,partition_id:f.partitionId,entries:[{key:a,value:'2'}]}));
 assert.throws(()=>f.index.get([valid],a),corrupt);
});

test('value limits and bucket limits use UTF8 bytes; prepare validates without writing',t=>{
 const f=setup(t),value='"'+'a'.repeat(262142)+'"';assert.equal(bytes(value),262144);
 f.index.prepare([],[{key:'r:limit:1',value,replace:false}]);
 for(const invalid of [{key:'',value:'1',replace:false},{key:'汉',value:'1',replace:false},{key:'x'.repeat(257),value:'1',replace:false},
  {key:'r:a:1',value:'{bad}',replace:false},{key:'r:a:1',value:'"'+'汉'.repeat(87381)+'"',replace:false},{key:'r:a:1',value:'1',replace:0}])assert.throws(()=>f.index.prepare([],[invalid]),corrupt);
 assert.throws(()=>f.index.prepare([],Array.from({length:257},(_,n)=>change('r:'+n,1))),corrupt);
 assert.throws(()=>f.index.prepare([],[change('r:a:1',1),change('r:a:1',1)]),conflict);
 const keys=collisionKeys(8);assert.throws(()=>f.index.prepare([],keys.map(key=>({key,value,replace:false}))),full);
 assert.equal(fs.existsSync(f.archive),false);
});

test('short writes are completed and fsync/close precede atomic promotion',t=>{
 const f=setup(t),prepared=f.index.prepare([],[change('q:'+hash('synthetic'),{text:'合成归档文字'.repeat(100)})]);f.index.persist(prepared);
 const writes=f.events.filter(v=>v[0]==='write').length;assert(writes>1);
 const fsyncAt=f.events.findIndex(v=>v[0]==='fsync'),closeAt=f.events.findIndex(v=>v[0]==='close'),renameAt=f.events.findIndex(v=>v[0]==='rename');
 assert(fsyncAt>=0&&closeAt>fsyncAt&&renameAt>closeAt);assert.equal(f.handles.size,0);
 assert.equal(fs.readFileSync(f.archive+'/'+prepared.nodes[0].sha256+'.bucket.json','utf8'),prepared.nodes[0].raw);f.index.verify(prepared.heads);
});

test('bounded raw reads advance the SDK filePointer, complete short reads and reject invalid read counts',t=>{
 const f=setup(t),key='r:short-read:1',value={text:'合成原字节\ufffd'.repeat(20)},prepared=f.index.prepare([],[change(key,value)]);f.index.persist(prepared);
 const start=f.reads.length;assert.equal(f.index.get(prepared.heads,key),JSON.stringify(value));const reads=f.reads.slice(start);assert(reads.length>2);
 let offset=0;for(const read of reads.slice(0,-1)){assert.equal(read.offset,undefined);assert.equal(read.position,offset);assert(read.count>0&&read.count<=read.length);offset+=read.count;}
 assert.equal(offset,prepared.heads[0].bytes);assert.deepEqual({offset:reads.at(-1).offset,position:reads.at(-1).position,length:reads.at(-1).length,count:reads.at(-1).count},{offset:undefined,position:offset,length:1,count:0});
 for(const count of [0,-1,NaN,0.5,Number.MAX_SAFE_INTEGER]){f.fault.readCount=count;assert.throws(()=>f.index.get(prepared.heads,key),corrupt);assert.equal(f.handles.size,0);}
 f.fault.readCount=undefined;assert.equal(f.index.get(prepared.heads,key),JSON.stringify(value));
});

test('SDK relative-offset semantics also preserve ordinary reads across the 64KiB chunk boundary',t=>{
 const f=setup(t),key='r:multi-chunk:1',value={text:'合成'.repeat(12000)};f.fault.short=65536;f.fault.shortRead=65536;
 const prepared=f.index.prepare([],[change(key,value)]);assert(prepared.heads[0].bytes>65536);f.index.persist(prepared);
 assert.equal(f.restart().get(prepared.heads,key),JSON.stringify(value));assert(f.reads.some(read=>read.position===65536));assert(f.reads.every(read=>read.offset===undefined));
});

test('zero writes retain only unpublished partial, close the handle and permit exact retry',t=>{
 const f=setup(t),prepared=f.index.prepare([],[change('r:a:1',1)]);f.fault.zero=true;
 assert.throws(()=>f.index.persist(prepared),/OUTBOX_ARCHIVE_WRITE_FAILED/);assert.equal(f.handles.size,0);
 const partial=f.archive+'/'+prepared.nodes[0].sha256+'.bucket.json.partial';assert(fs.existsSync(partial));assert.equal(fs.statSync(partial).size,0);
 assert.throws(()=>f.index.get(prepared.heads,'r:a:1'),corrupt);assert.equal(f.index.get([],'r:a:1'),undefined);
 f.fault.zero=false;f.index.persist(prepared);assert.equal(f.index.get(prepared.heads,'r:a:1'),'1');
});

test('invalid write counts and fsync failure do not promote a node or leak handles',t=>{
 for(const written of [-1,NaN,0.5,Number.MAX_SAFE_INTEGER]){
  const f=setup(t),prepared=f.index.prepare([],[change('r:a:1',1)]);f.fault.written=written;
  assert.throws(()=>f.index.persist(prepared),/OUTBOX_ARCHIVE_WRITE_FAILED/);assert.equal(f.handles.size,0);assert(!fs.existsSync(f.archive+'/'+prepared.nodes[0].sha256+'.bucket.json'));
 }
 const f=setup(t),prepared=f.index.prepare([],[change('r:b:1',1)]);f.fault.fsync=true;assert.throws(()=>f.index.persist(prepared),/synthetic-fsync-failure/);
 assert.equal(f.handles.size,0);assert(!fs.existsSync(f.archive+'/'+prepared.nodes[0].sha256+'.bucket.json'));
});

test('promotion failure before and after rename keeps old heads and permits deterministic adoption',t=>{
 for(const failure of ['before','after']){
  const f=setup(t),first=f.index.prepare([],[change('m:synthetic',1)]);f.index.persist(first);
  const second=f.index.prepare(first.heads,[change('m:synthetic',2,true)]);f.fault.promotion=failure;
  assert.throws(()=>f.index.persist(second),new RegExp('synthetic-promotion-'+failure));assert.equal(f.index.get(first.heads,'m:synthetic'),'1');
  f.fault.promotion='';f.restart().persist(second);assert.equal(f.index.get(second.heads,'m:synthetic'),'2');assert.equal(f.index.get(first.heads,'m:synthetic'),'1');
 }
});

test('same hash filename with different original bytes is a conflict and never overwritten',t=>{
 const f=setup(t),prepared=f.index.prepare([],[change('r:a:1',1)]);fs.mkdirSync(f.archive);
 const target=f.archive+'/'+prepared.nodes[0].sha256+'.bucket.json';fs.writeFileSync(target,'different synthetic bytes');
 const before=fs.readFileSync(target,'utf8');assert.throws(()=>f.index.persist(prepared),conflict);assert.equal(fs.readFileSync(target,'utf8'),before);assert.equal(f.events.length,0);
});

test('only the calculated target partial may be overwritten; other legal partials remain untouched',t=>{
 const f=setup(t),prepared=f.index.prepare([],[change('r:a:1',1)]);fs.mkdirSync(f.archive);
 const own=f.archive+'/'+prepared.nodes[0].sha256+'.bucket.json.partial',other=f.archive+'/'+hash('unpublished-other')+'.bucket.json.partial';
 fs.writeFileSync(own,'incomplete');fs.writeFileSync(other,'unpublished bytes');assert.equal(f.index.get([],'r:a:1'),undefined);
 f.index.persist(prepared);assert.equal(fs.readFileSync(other,'utf8'),'unpublished bytes');assert(!fs.existsSync(own));assert.equal(f.index.get(prepared.heads,'r:a:1'),'1');
});

test('unknown names and directories are rejected before archive writes',t=>{
 for(const kind of ['unknown','directory']){
  const f=setup(t),prepared=f.index.prepare([],[change('r:a:1',1)]);fs.mkdirSync(f.archive);
  if(kind==='unknown')fs.writeFileSync(f.archive+'/unrecognized.txt','preserve me');else fs.mkdirSync(f.archive+'/'+hash('directory')+'.bucket.json');
  const before=tree(f.archive);assert.throws(()=>f.index.persist(prepared),corrupt);assert.throws(()=>f.index.prepare([],[]),corrupt);assert.deepEqual(tree(f.archive),before);assert.equal(f.events.length,0);
 }
});

test('real directory junctions are refused both as archive directory and file entries',t=>{
 for(const kind of ['root','entry']){
  const f=setup(t),prepared=f.index.prepare([],[change('r:a:1',1)]),target=path.join(f.root,'link-target');fs.mkdirSync(target);fs.writeFileSync(path.join(target,'untouched'),'synthetic target');
  const link=kind==='root'?f.archive:(fs.mkdirSync(f.archive),f.archive+'/'+hash('linked-entry')+'.bucket.json');
  fs.symlinkSync(target,link,process.platform==='win32'?'junction':'dir');assert(fs.lstatSync(link).isSymbolicLink());
  assert.throws(()=>f.index.persist(prepared),corrupt);assert.throws(()=>f.index.get([],'r:a:1'),corrupt);assert.equal(fs.readFileSync(path.join(target,'untouched'),'utf8'),'synthetic target');
 }
});

test('on-disk file-length quota includes old buckets and partials and reserves new nodes before writing',t=>{
 const f=setup(t),prepared=f.index.prepare([],[change('r:a:1',1)]);fs.mkdirSync(f.archive);
 let remaining=67108864,index=0;
 while(remaining){const size=Math.min(2000000,remaining),file=f.archive+'/'+hash('quota-'+index)+'.bucket.json'+(index%2?'.partial':'');const fd=fs.openSync(file,'w');fs.ftruncateSync(fd,size);fs.closeSync(fd);remaining-=size;index++;}
 // sum(stat.size), not allocated clusters, directory entries or filesystem logs.
 assert.equal(fs.readdirSync(f.archive).length,34);f.index.verify([]);const before=f.events.length;
 assert.throws(()=>f.index.persist(prepared),full);assert.equal(f.events.length,before);assert(!fs.existsSync(f.archive+'/'+prepared.nodes[0].sha256+'.bucket.json'));
 const target=f.archive+'/'+hash('quota-0')+'.bucket.json';fs.truncateSync(target,2000001);assert.throws(()=>f.index.get([],'r:a:1'),full);
});

test('file-count and duplicate-listing guards fail before inspecting listed children',t=>{
 const f=setup(t),prepared=f.index.prepare([],[change('r:a:1',1)]);fs.mkdirSync(f.archive);
 // Count metadata is injected at the real directory boundary; no 65k throwaway files.
 f.fault.listing=Array.from({length:65537},(_,n)=>hash('count-'+n)+'.bucket.json');assert.throws(()=>f.index.persist(prepared),full);
 f.fault.listing=[hash('duplicate')+'.bucket.json',hash('duplicate')+'.bucket.json'];assert.throws(()=>f.index.persist(prepared),corrupt);assert.equal(f.events.length,0);
});

test('persist revalidates prepared raw bytes, principal, head membership and duplicate nodes before mkdir',t=>{
 const f=setup(t),prepared=plain(f.index.prepare([],[change('r:a:1',1)]));
 const foreign={schema:1,partition_id:hash('foreign'),entries:[{key:'r:a:1',value:'1'}]},raw=JSON.stringify(foreign),sha256=hash(raw);
 for(const bad of [{...prepared,extra:true},{...prepared,nodes:[prepared.nodes[0],prepared.nodes[0]]},{heads:[],nodes:prepared.nodes},
  {...prepared,nodes:[{...prepared.nodes[0],raw:prepared.nodes[0].raw+' '}]},
  {heads:[{bucket:hash('r:a:1').slice(0,3),sha256,bytes:bytes(raw),entries:1}],nodes:[{sha256,raw}]}])assert.throws(()=>f.index.persist(bad),corrupt);
 assert.equal(fs.existsSync(f.archive),false);assert.equal(f.events.length,0);
});

test('duplicate SHA heads in different buckets are rejected before creating any archive file',t=>{
 const f=setup(t),key=['r:a:1','r:b:1'].find(key=>hash(key).slice(0,3)!=='fff'),prepared=plain(f.index.prepare([],[change(key,1)])),head=prepared.heads[0];
 prepared.heads.push({...head,bucket:'fff'});
 assert.throws(()=>f.index.persist(prepared),corrupt);assert.equal(fs.existsSync(f.archive),false);assert.equal(f.events.length,0);
});

test('same-length malformed UTF8 cannot masquerade as original bytes for get or target adoption',t=>{
 const f=setup(t),prepared=f.index.prepare([],[change('r:unicode:1',{text:'\ufffd'})]);f.index.persist(prepared);
 const target=f.archive+'/'+prepared.nodes[0].sha256+'.bucket.json',original=fs.readFileSync(target),damaged=Buffer.from(original),position=damaged.indexOf(Buffer.from([0xef,0xbf,0xbd]));assert(position>=0);
 Buffer.from([0xf0,0x9f,0x92]).copy(damaged,position);assert.equal(damaged.length,original.length);assert.equal(damaged.toString('utf8'),original.toString('utf8'));assert.notEqual(hash(damaged),hash(original));fs.writeFileSync(target,damaged);
 assert.throws(()=>f.index.get(prepared.heads,'r:unicode:1'),corrupt);assert.throws(()=>f.index.persist(prepared),/OUTBOX_ARCHIVE_(CORRUPT|CONFLICT)/);
 assert.deepEqual(fs.readFileSync(target),damaged,'different immutable target bytes must remain untouched');
});

test('same-length malformed UTF8 partial is rejected before promotion',t=>{
 const f=setup(t),prepared=f.index.prepare([],[change('r:unicode:1',{text:'\ufffd'})]),partial=f.archive+'/'+prepared.nodes[0].sha256+'.bucket.json.partial';
 f.fault.onClose=()=>{const data=fs.readFileSync(partial),position=data.indexOf(Buffer.from([0xef,0xbf,0xbd]));assert(position>=0);Buffer.from([0xf0,0x9f,0x92]).copy(data,position);fs.writeFileSync(partial,data);};
 assert.throws(()=>f.index.persist(prepared),/OUTBOX_ARCHIVE_(CORRUPT|WRITE_FAILED)/);assert(!fs.existsSync(f.archive+'/'+prepared.nodes[0].sha256+'.bucket.json'));assert.equal(f.handles.size,0);
});

test('a dangling archive junction is not treated as an absent directory',t=>{
 const f=setup(t),target=path.join(f.root,'absent-target');
 fs.symlinkSync(target,f.archive,process.platform==='win32'?'junction':'dir');assert(fs.lstatSync(f.archive).isSymbolicLink());assert.equal(fs.existsSync(f.archive),false);
 assert.throws(()=>f.index.get([],'r:missing:1'),corrupt);assert.throws(()=>f.index.verify([]),corrupt);
 assert.throws(()=>f.index.prepare([],[change('r:a:1',1)]),corrupt);assert.equal(f.events.length,0);
});

test('directory replacement after closing a write or after promotion never reports successful persistence',t=>{
 for(const boundary of ['close','rename']){
  const f=setup(t),prepared=f.index.prepare([],[change('r:synthetic:1',{receipt:'synthetic-receipt'})]),moved=path.join(f.root,'moved-archive');
  let replacements=0;
  const replace=()=>{
   if(replacements++)return;fs.renameSync(f.archive,moved);fs.mkdirSync(f.archive);
   // Even identical copied data must not hide a changed directory identity.
   for(const name of fs.readdirSync(moved))fs.copyFileSync(path.join(moved,name),path.join(f.archive,name));
  };
  if(boundary==='close')f.fault.onClose=replace;else f.fault.onRename=replace;
  assert.throws(()=>f.index.persist(prepared),corrupt);assert.equal(f.handles.size,0);assert.equal(replacements>=1,true);
  assert.equal(f.index.get([],'r:synthetic:1'),undefined,'no heads were committed by a failed persist');
 }
});

test('path/principal initialization rejects relative paths, traversal and foreign partition format without writing',t=>{
 const f=setup(t);
 for(const root of ['relative/path',f.partition+'/../other',f.partition+'/',f.partition+'//child','//server/share']){
  const index=new f.mod.MaterialOutboxArchiveIndex();assert.throws(()=>index.initialize(root,f.partitionId,hash),corrupt);
 }
 for(const principal of ['', 'owner/phone/server','A'.repeat(64)]){
  const index=new f.mod.MaterialOutboxArchiveIndex();assert.throws(()=>index.initialize(f.partition,principal,hash),corrupt);
 }
 assert.equal(f.events.length,0);assert.equal(fs.existsSync(f.archive),false);
});
