import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import {createHash} from 'node:crypto';import {loadApp} from './load-app.mjs';
function setup(t){
 const prefix=path.join(os.tmpdir(),'turboio-source-clone-'),base=fs.mkdtempSync(prefix).replaceAll('\\','/');
 t.after(()=>{if(!path.resolve(base).startsWith(path.resolve(prefix)))throw Error('unsafe cleanup');fs.rmSync(base,{recursive:true});});
 const from=base+'/run-1791697276640',to=base+'/run-1791699999999',name='seg-'+'a'.repeat(32),source=from+'/lifelog/'+name;
 fs.mkdirSync(source,{recursive:true});const audio=Buffer.from('synthetic source bytes');fs.writeFileSync(source+'/audio.ogg',audio);
 const meta={version:2,started:1000,ended:2000,seconds:.6,frames:10,sealed:true};fs.writeFileSync(source+'/meta.json',JSON.stringify(meta));
 fs.writeFileSync(source+'/transcript.json','old immutable processing history');
 const io={OpenMode:{READ_ONLY:1,READ_WRITE:2},accessSync:fs.existsSync,statSync:fs.statSync,mkdirSync:fs.mkdirSync,readTextSync:p=>fs.readFileSync(p,'utf8'),
  openSync:(p,mode)=>({fd:fs.openSync(p,mode===1?'r':'r+')}),readSync:(fd,b)=>fs.readSync(fd,new Uint8Array(b),0,Math.min(7,b.byteLength),null),
  closeSync:f=>fs.closeSync(f.fd),copyFileSync:fs.copyFileSync,fsyncSync:fs.fsyncSync};
 const {cloneDailyLabSource}=loadApp('DailyLabSourceClone',{'@kit.CoreFileKit':{fileIo:io}});
 return{base,from,to,name,source,audio,meta,clone:()=>cloneDailyLabSource(base,from,to,name),cloneDailyLabSource};
}
test('replay copies only sealed original audio and metadata, with matching SHA and untouched old history',t=>{
 const s=setup(t),hash=s.clone(),target=s.to+'/lifelog/'+s.name;
 assert.equal(hash,createHash('sha256').update(s.audio).digest('hex'));assert.deepEqual(fs.readFileSync(target+'/audio.ogg'),s.audio);
 assert.deepEqual(fs.readdirSync(target).sort(),['audio.ogg','meta.json']);assert.equal(fs.readFileSync(s.source+'/transcript.json','utf8'),'old immutable processing history');
 assert.throws(s.clone,/CLONE_PATH/);assert.deepEqual(fs.readFileSync(s.source+'/audio.ogg'),s.audio);
});
test('invalid identity, outside-root destination and unsealed source never create a processing root',t=>{
 const s=setup(t);for(const [from,to,name] of [[s.from,s.base+'/../outside',s.name],[s.from,s.from,s.name],[s.from,s.to,'../escape']])
  assert.throws(()=>s.cloneDailyLabSource(s.base,from,to,name),/CLONE_PATH/);
 for(const patch of [{sealed:false},{frames:NaN},{seconds:100},{ended:0}]){
  fs.writeFileSync(s.source+'/meta.json',JSON.stringify({...s.meta,...patch}));assert.throws(s.clone,/META_INVALID/);assert.equal(fs.existsSync(s.to),false);
 }
});
