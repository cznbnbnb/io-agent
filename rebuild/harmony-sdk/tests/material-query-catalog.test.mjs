import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {setupMaterialStore} from './material-fixture.mjs';

const plain=value=>JSON.parse(JSON.stringify(value));
function fixture(t){
 assert.match(path.resolve(os.tmpdir()),/^[Dd]:[\\/]/,'catalog tests require managed D: TEMP');
 const f=setupMaterialStore(t),calls={list:0,lstat:0,read:0,write:0};let fault=()=>{},metadata=(_p,stat)=>stat;
 const originalRead=f.io.readTextSync;
 f.io.listFileSync=p=>{calls.list++;fault('list',p);return fs.readdirSync(p);};
 f.io.lstatSync=p=>{calls.lstat++;fault('lstat',p);const st=fs.lstatSync(p,{bigint:true});
  return metadata(p,{ino:st.ino,size:Number(st.size),mtime:Number(st.mtimeNs)/1e9,ctime:Number(st.ctimeNs)/1e9,
   mtimeNs:st.mtimeNs,ctimeNs:st.ctimeNs,isDirectory:()=>st.isDirectory(),isFile:()=>st.isFile(),isSymbolicLink:()=>st.isSymbolicLink()});};
 f.io.readTextSync=p=>{calls.read++;return originalRead(p);};
 const directory=id=>f.root+'/materials/'+id;
 const id=n=>'mat-recording-'+n.toString(16).padStart(32,'0');
 const row=()=>{const base=f.store.ensure(f.source);return f.store.appendTranscript(base.material_id,base.revision,f.input,'catalog-fixture');};
 const cold=()=>{const store=new f.MaterialStore();store.initialize(f.root);return store;};
 const tree=()=>{const out=[];function visit(dir){for(const name of fs.readdirSync(dir).sort()){const p=dir+'/'+name,st=fs.lstatSync(p);
  if(st.isSymbolicLink())out.push([p.slice(f.root.length),'link',fs.readlinkSync(p)]);
  else if(st.isDirectory()){out.push([p.slice(f.root.length),'directory']);visit(p);}
  else out.push([p.slice(f.root.length),createHash('sha256').update(fs.readFileSync(p)).digest('hex')]);}}visit(f.root);return out;};
 const noWrites=()=>{for(const key of ['openSync','writeSync','fsyncSync','renameSync','mkdirSync'])f.io[key]=()=>{calls.write++;throw Error('catalog attempted write');};};
 return{...f,calls,id,directory,row,cold,tree,noWrites,fault:value=>fault=value,metadata:value=>metadata=value};
}
function unavailable(fn){assert.throws(fn,error=>error.message==='MATERIAL_CATALOG_UNAVAILABLE');}

test('uninitialized, missing, non-directory and unreadable roots fail closed with one safe error',t=>{
 const f=fixture(t);unavailable(()=>new f.MaterialStore().queryCatalog());
 fs.rmdirSync(f.root+'/materials');unavailable(()=>f.store.queryCatalog());
 fs.writeFileSync(f.root+'/materials','not a directory');unavailable(()=>f.store.queryCatalog());
 fs.unlinkSync(f.root+'/materials');fs.mkdirSync(f.root+'/materials');
 f.fault((op,p)=>{if(op==='list'&&p===f.root+'/materials')throw Error('private path token=secret');});
 unavailable(()=>f.store.queryCatalog());
});

test('empty catalogs are cold-stable, exact public DTO and entirely read only',t=>{
 const f=fixture(t),before=f.tree(),cold=f.cold();f.noWrites();
 const one=f.store.queryCatalog(),two=cold.queryCatalog();
 assert.deepEqual(plain(one),plain(two));assert.deepEqual(Object.keys(one).sort(),['ids','snapshot_sha256']);
 assert.deepEqual(plain(one.ids),[]);assert.match(one.snapshot_sha256,/^[a-f0-9]{64}$/);
 assert.equal(f.calls.read,0);assert.equal(f.calls.write,0);assert.deepEqual(f.tree(),before);
});

test('complete sorted ID catalog has no 512 or 128 truncation and does not read any JSON',t=>{
 const f=fixture(t);for(let n=600;n>0;n--)fs.mkdirSync(f.directory(f.id(n)));
 const before=f.tree();f.noWrites();const result=f.store.queryCatalog();
 assert.equal(result.ids.length,600);assert.deepEqual(plain(result.ids),Array.from({length:600},(_,n)=>f.id(n+1)));
 assert.equal(f.calls.read,0);assert.equal(f.calls.write,0);assert.deepEqual(f.tree(),before);
});

test('actual ensure, transcript correction and tombstone each change catalog; cold instances agree',t=>{
 const f=fixture(t),empty=f.store.queryCatalog().snapshot_sha256,saved=f.row();
 const written=f.store.queryCatalog();assert.notEqual(written.snapshot_sha256,empty);assert.deepEqual(plain(written.ids),[saved.material_id]);
 assert.equal(f.cold().queryCatalog().snapshot_sha256,written.snapshot_sha256);
 const corrected=f.store.correctText(saved.material_id,saved.revision,saved.utterances[0].utterance_id,'更正后的当前正文');
 const edited=f.store.queryCatalog().snapshot_sha256;assert.notEqual(edited,written.snapshot_sha256);
 f.store.delete(corrected.material_id,corrected.revision);const deleted=f.store.queryCatalog().snapshot_sha256;
 assert.notEqual(deleted,edited);assert.equal(f.cold().queryCatalog().snapshot_sha256,deleted);
});

test('partial and speaker noop files do not become heads or invalidate a committed catalog',t=>{
 const f=fixture(t),saved=f.row(),dir=f.directory(saved.material_id),before=f.store.queryCatalog().snapshot_sha256;
 fs.writeFileSync(dir+'/revision-999999999.json.partial','unfinished');fs.writeFileSync(dir+'/speaker-noop-receipt.json','receipt');
 fs.writeFileSync(dir+'/revision-malformed.json','not a revision');
 assert.equal(f.store.queryCatalog().snapshot_sha256,before);
 fs.writeFileSync(dir+'/revision-999999999.json.partial','longer unfinished body');assert.equal(f.cold().queryCatalog().snapshot_sha256,before);
});

test('partial-only material gets a stable empty-head marker, stays in IDs, and is unreadable as committed data',t=>{
 const f=fixture(t),id=f.id(9),dir=f.directory(id),before=f.store.queryCatalog().snapshot_sha256;fs.mkdirSync(dir);
 fs.writeFileSync(dir+'/revision-000000001.json.partial','incomplete');const observed=f.store.queryCatalog();
 assert.deepEqual(plain(observed.ids),[id]);assert.notEqual(observed.snapshot_sha256,before);assert.equal(f.store.read(id),undefined);
 fs.writeFileSync(dir+'/revision-000000001.json.partial','different unfinished bytes');assert.equal(f.cold().queryCatalog().snapshot_sha256,observed.snapshot_sha256);
});

test('complete versions filename list is fingerprinted even when head is unchanged',t=>{
 const f=fixture(t),saved=f.row(),dir=f.directory(saved.material_id),before=f.store.queryCatalog().snapshot_sha256;
 fs.unlinkSync(dir+'/revision-000000001.json');assert.notEqual(f.store.queryCatalog().snapshot_sha256,before);
});

test('head size, identity and optional nanosecond metadata are observed without numeric bigint loss',t=>{
 const f=fixture(t),saved=f.row(),head=f.directory(saved.material_id)+'/revision-000000002.json',before=f.store.queryCatalog().snapshot_sha256;
 fs.appendFileSync(head,' ');const resized=f.store.queryCatalog().snapshot_sha256;assert.notEqual(resized,before);
 f.metadata((p,st)=>p===head?{...st,ino:900719925474099312345n}:st);const large=f.store.queryCatalog().snapshot_sha256;
 f.metadata((p,st)=>p===head?{...st,ino:900719925474099312346n}:st);assert.notEqual(f.store.queryCatalog().snapshot_sha256,large);
 f.metadata((p,st)=>p===head?{...st,mtimeNs:st.mtimeNs+1n}:st);const nanos=f.store.queryCatalog().snapshot_sha256;
 f.metadata((p,st)=>p===head?{...st,mtimeNs:st.mtimeNs+2n}:st);assert.notEqual(f.store.queryCatalog().snapshot_sha256,nanos);
 f.metadata((_p,st)=>{const out={...st};delete out.mtimeNs;delete out.ctimeNs;return out;});
 assert.equal(f.store.queryCatalog().snapshot_sha256,f.cold().queryCatalog().snapshot_sha256,'optional native Ns fields may both be absent');
});

test('JSON payload is not parsed or claimed as catalog content hash',t=>{
 const f=fixture(t),id=f.id(8),dir=f.directory(id);fs.mkdirSync(dir);fs.writeFileSync(dir+'/revision-000000001.json','corrupt JSON');
 f.io.readTextSync=()=>{throw Error('must not read JSON');};assert.deepEqual(plain(f.store.queryCatalog().ids),[id]);
 assert.equal(f.calls.read,0);
});

for(const operation of ['list','lstat'])test(`any material ${operation} failure prevents a misleading partial catalog`,t=>{
 const f=fixture(t),saved=f.row(),dir=f.directory(saved.material_id);f.fault((op,p)=>{if(op===operation&&p.startsWith(dir))throw Error('controlled I/O failure');});
 unavailable(()=>f.store.queryCatalog());
});

test('root or material-list duplicate names cannot silently produce a partial/ambiguous catalog',t=>{
 const f=fixture(t),saved=f.row(),original=f.io.listFileSync;
 f.io.listFileSync=p=>{const names=original(p);return p===f.root+'/materials'?[...names,saved.material_id]:names;};unavailable(()=>f.store.queryCatalog());
});

test('a named material file and a named revision directory are rejected',t=>{
 const f=fixture(t),id=f.id(7),dir=f.directory(id);fs.writeFileSync(dir,'not a directory');unavailable(()=>f.store.queryCatalog());
 fs.unlinkSync(dir);fs.mkdirSync(dir);fs.mkdirSync(dir+'/revision-000000001.json');unavailable(()=>f.store.queryCatalog());
});

for(const mode of ['root','material','revision','ancestor'])test(`actual D junction at ${mode} is rejected without reading or writing its target`,t=>{
 const f=fixture(t),target=f.root+'/target',id=f.id(6);fs.mkdirSync(target);fs.writeFileSync(target+'/untouched','original');
 if(mode==='root'){fs.rmdirSync(f.root+'/materials');fs.symlinkSync(target,f.root+'/materials','junction');}
 else if(mode==='material')fs.symlinkSync(target,f.directory(id),'junction');
 else if(mode==='revision'){fs.mkdirSync(f.directory(id));fs.symlinkSync(target,f.directory(id)+'/revision-000000001.json','junction');}
 else{const real=f.root+'/real';fs.mkdirSync(real);fs.mkdirSync(real+'/child');fs.mkdirSync(real+'/child/materials');fs.symlinkSync(real,f.root+'/redirect','junction');
  f.store.initialize(f.root+'/redirect/child');}
 const before=f.tree();f.noWrites();unavailable(()=>f.store.queryCatalog());assert.equal(f.calls.read,0);assert.equal(f.calls.write,0);assert.deepEqual(f.tree(),before);
});

test('invalid relative, root-only, dot-segment and UNC storage paths cannot be catalogued',t=>{
 const f=fixture(t);for(const root of ['relative/materials','/','D:/','D:/part/../materials','D://materials','//server/share/materials']){
  const store=new f.MaterialStore();store.root=root;unavailable(()=>store.queryCatalog());}
});

test('invalid head metadata and head-stat exceptions are safe failures, never an empty catalog',t=>{
 const f=fixture(t),saved=f.row(),head=f.directory(saved.material_id)+'/revision-000000002.json';
 for(const patch of [{size:-1},{size:NaN},{mtime:Infinity},{ctime:NaN},{ino:'bad'},{mtimeNs:1},{ctimeNs:'1'}]){
  f.metadata((p,st)=>p===head?{...st,...patch}:st);unavailable(()=>f.store.queryCatalog());}
});
