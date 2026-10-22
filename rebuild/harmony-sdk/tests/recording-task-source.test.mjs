import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {loadApp} from './load-app.mjs';

const clone=value=>JSON.parse(JSON.stringify(value));
const sha=value=>createHash('sha256').update(value).digest('hex');
const owner='voice-'+'a'.repeat(32),cleanup='b'.repeat(32),name='take-'+'c'.repeat(32),uuid='protocol-uuid-distinct-from-directory',peer='synthetic-original-peer';
const result=JSON.stringify({frames:3,seconds:0.06,utterances:[{text:'合成条件：先保留原音，但不要提交。😀',start:0,end:0.06}],speakers:[]});

// All files belong to this test's unique TEMP child. No native codec, model,
// task submission, server or device API is imported by the source store.
function fixture(t){
  const scratch=path.resolve(process.env.TEMP||process.env.TMP||os.tmpdir());
  const nativeRoot=fs.mkdtempSync(path.join(scratch,'recording-task-source-')),root=nativeRoot.replaceAll('\\','/');
  const directory=root+'/recordings/'+name,rawPath=directory+'/source.rawopus',wavPath=directory+'/audio.wav',manifestPath=directory+'/manifest.json',receiptPath=directory+'/task-asr-source.json';
  fs.mkdirSync(directory,{recursive:true});const raw=Buffer.alloc(720);for(let i=0;i<raw.length;i++)raw[i]=(i*17+3)%256;
  fs.writeFileSync(rawPath,raw);fs.writeFileSync(wavPath,Buffer.alloc(44+raw.length/240*1280,7));
  const manifest={version:1,uuid,peer,created:1000,completed:true,valid:true,wavReady:true,coverage:[[0,raw.length]],voice_owner:owner,voice_cleanup_id:cleanup,voice_exit_evidence:'device_event'};
  fs.writeFileSync(manifestPath,JSON.stringify(manifest));
  const handles=new Map(),stats={reads:0,writes:0,syncs:0,renames:0,maxRead:0};
  let readWidth=701,writeWidth=37,afterRead,afterWrite,fault='';
  const safe=value=>{const p=typeof value==='number'?handles.get(value):value?.fd!==undefined?handles.get(value.fd):value;
    assert.equal(typeof p,'string');const absolute=path.resolve(p);assert(absolute.startsWith(nativeRoot+path.sep),'IO must stay inside its unique source fixture');return p;};
  const io={OpenMode:{READ_ONLY:fs.constants.O_RDONLY,WRITE_ONLY:fs.constants.O_WRONLY,CREATE:fs.constants.O_CREAT},
    accessSync:p=>fs.existsSync(safe(p)),statSync:p=>{safe(p);const s=typeof p==='number'?fs.fstatSync(p):fs.statSync(p);return{size:s.size,mtime:s.mtimeMs};},
    readTextSync:p=>fs.readFileSync(safe(p),'utf8'),
    openSync(p,flags){const fd=fs.openSync(safe(p),flags);handles.set(fd,p);return{fd};},
    closeSync(value){const fd=typeof value==='number'?value:value.fd;safe(fd);fs.closeSync(fd);handles.delete(fd);},
    readSync(fd,buffer,options={}){safe(fd);assert.equal(options.offset,undefined);const bytes=new Uint8Array(buffer);stats.maxRead=Math.max(stats.maxRead,bytes.length);stats.reads++;
      if(fault==='read')throw Error('synthetic read failure');const n=fs.readSync(fd,bytes,0,Math.min(bytes.length,options.length??bytes.length,readWidth),null);
      if(afterRead){const hook=afterRead;afterRead=undefined;hook();}return n;},
    writeSync(fd,buffer){safe(fd);stats.writes++;if(fault==='write')throw Error('synthetic write failure');const bytes=new Uint8Array(buffer),n=fs.writeSync(fd,bytes,0,Math.min(bytes.length,writeWidth),null);
      if(afterWrite){const hook=afterWrite;afterWrite=undefined;hook();}return n;},
    fsyncSync(fd){safe(fd);stats.syncs++;if(fault==='fsync')throw Error('synthetic fsync failure');fs.fsyncSync(fd);},
    renameSync(from,to){safe(from);safe(to);stats.renames++;if(fault==='rename')throw Error('synthetic rename failure');fs.renameSync(from,to);},
    unlinkSync(){assert.fail('source store must never delete original or receipt evidence');}};
  const platform={'@kit.CoreFileKit':{fileIo:io},'./RecordingSession':{RecordingCaptureHandle:class{}}};
  const types=loadApp('TaskRecordingTypes',platform);platform['./TaskRecordingTypes']=types;
  const module=loadApp('RecordingTaskSource',platform),store=new module.RecordingTaskSourceStore();store.initialize(root);
  const handle={ownerId:owner,cleanupId:cleanup,uuid,directory,peer,connectionEpoch:7},materialId='mat-recording-'+'c'.repeat(32);
  const rewrite=patch=>{const next={...JSON.parse(fs.readFileSync(manifestPath,'utf8')),...patch};fs.writeFileSync(manifestPath,JSON.stringify(next));return next;};
  t.after(()=>{for(const fd of handles.keys())try{fs.closeSync(fd);}catch{}handles.clear();
    assert.equal(path.dirname(nativeRoot),scratch);assert.match(path.basename(nativeRoot),/^recording-task-source-[A-Za-z0-9]+$/);assert.equal(fs.realpathSync(scratch).toLowerCase(),scratch.toLowerCase());
    assert(!fs.lstatSync(nativeRoot).isSymbolicLink());fs.rmSync(nativeRoot,{recursive:true,force:true});});
  return{root,directory,rawPath,wavPath,manifestPath,receiptPath,manifest,raw,store,module,types,handle,materialId,stats,handles,rewrite,
    restart(){const next=new module.RecordingTaskSourceStore();next.initialize(root);return next;},
    setReadWidth:n=>{readWidth=n;},afterRead:fn=>{afterRead=fn;},afterWrite:fn=>{afterWrite=fn;},fault:value=>{fault=value;},
    seal(){const input=store.input(directory);store.seal(directory,input,result);return input;},
    origin:(body=result,h=handle,id=materialId,revision=2)=>store.origin(h,id,revision,body)};
}

test('owned input is an exact ten-field snapshot of raw bytes, not WAV bytes or the protocol UUID as a directory',t=>{
  const f=fixture(t),input=clone(f.store.input(f.directory));
  assert.deepEqual(Object.keys(input).sort(),['schema','name','uuid','owner_id','cleanup_id','peer','created','raw_bytes','raw_sha256','exit_evidence'].sort());
  assert.equal(input.name,name);assert.equal(input.uuid,uuid);assert.notEqual(input.name,'take-'+input.uuid);assert.equal(input.raw_sha256,sha(f.raw));assert.equal(input.raw_bytes,720);
  assert.equal(input.owner_id,owner);assert.equal(input.cleanup_id,cleanup);assert.equal(input.peer,peer);assert.equal(input.exit_evidence,'device_event');
  assert.equal(f.stats.writes,0);assert.equal(f.handles.size,0);assert(f.stats.reads>1);
});
test('seal stores only input metadata and a complete UTF-8 result hash; origin has exactly the shared twelve fields',t=>{
  const f=fixture(t),input=f.seal(),raw=fs.readFileSync(f.receiptPath,'utf8'),saved=JSON.parse(raw),origin=clone(f.origin());
  assert.deepEqual(Object.keys(saved).sort(),['schema','input','result_sha256'].sort());assert.deepEqual(saved.input,clone(input));assert.equal(saved.result_sha256,sha(result));
  assert(!raw.includes('合成条件'));assert(!raw.includes('utterances'));assert(!raw.includes('audio.wav'));assert.equal(origin.result_sha256,sha(result));
  assert.equal(origin.raw_sha256,sha(f.raw));assert.equal(origin.material_id,f.materialId);assert.equal(origin.material_revision,2);assert.equal(Object.keys(origin).length,12);assert(f.types.taskRecordingOriginValid(origin));
  assert(f.stats.writes>1);assert.equal(f.stats.syncs,1);assert.equal(f.stats.renames,1);assert(!fs.existsSync(f.receiptPath+'.partial'));assert.deepEqual(fs.readFileSync(f.rawPath),f.raw);
});
test('identical seal and real restart origin are read-only and each origin rechecks the raw source',t=>{
  const f=fixture(t),input=f.seal(),before=fs.readFileSync(f.receiptPath),writes=f.stats.writes,reads=f.stats.reads;
  f.store.seal(f.directory,clone(input),result);assert.equal(f.stats.writes,writes);const restored=f.restart(),origin=restored.origin(f.handle,f.materialId,2,result);
  assert(f.types.taskRecordingOriginValid(origin));assert.equal(f.stats.writes,writes);assert(f.stats.reads>reads);assert.deepEqual(fs.readFileSync(f.receiptPath),before);
});
test('old ordinary directories without a manifest or without opt-in are untouched and do not read audio',t=>{
  const f=fixture(t);fs.unlinkSync(f.manifestPath);assert.equal(f.store.input(f.directory),null);
  for(const marked of [false,true]){const manifest={version:1,uuid,created:1000,completed:false};if(marked)Object.assign(manifest,{voice_owner:'',voice_cleanup_id:'',voice_exit_evidence:'none'});
    fs.writeFileSync(f.manifestPath,JSON.stringify(manifest));assert.equal(f.store.input(f.directory),null);}
  assert.equal(f.stats.reads,0);assert.equal(f.stats.writes,0);assert.deepEqual(fs.readFileSync(f.rawPath),f.raw);
});
test('source paths reject traversal, another root and wrong directory leaves before filesystem access',t=>{
  const f=fixture(t);for(const directory of [f.directory+'/..',f.root+'/recordings/take-'+uuid,f.root+'/other/'+name,f.directory+'/',f.directory.replaceAll('/','\\')])assert.throws(()=>f.store.input(directory),/PATH/);
  assert.equal(f.stats.reads,0);assert.equal(f.stats.writes,0);
});
test('every handle identity field and material/revision type is checked before origin is returned',t=>{
  const f=fixture(t);f.seal();for(const [key,value] of [['ownerId','voice-'+'d'.repeat(32)],['cleanupId','e'.repeat(32)],['uuid','other-uuid'],['peer','other-peer'],['directory',f.root+'/recordings/take-'+'f'.repeat(32)]])assert.throws(()=>f.origin(result,{...f.handle,[key]:value}));
  for(const [id,revision] of [[false,2],['',2],['x'.repeat(129),2],[f.materialId,0],[f.materialId,1.5],[f.materialId,'2']])assert.throws(()=>f.origin(result,f.handle,id,revision));
});
test('forged input shapes and coerced fields never create a result sidecar',t=>{
  const f=fixture(t),input=clone(f.store.input(f.directory));for(const patch of [{schema:'1'},{created:'1000'},{raw_bytes:'720'},{raw_sha256:'0'.repeat(64)},{name:'take-'+uuid},{extra:true},{exit_evidence:'submitted'}])assert.throws(()=>f.store.seal(f.directory,{...input,...patch},result));
  assert(!fs.existsSync(f.receiptPath));assert.equal(f.stats.writes,0);
});
test('owned manifest must have strict completed, valid, WAV and exit evidence rather than truthy values',t=>{
  const f=fixture(t);for(const patch of [{version:'1'},{completed:1},{valid:'true'},{wavReady:1},{uuid:5},{peer:7},{peer:'bad peer'},{created:'1000'},{voice_cleanup_id:7},{voice_exit_evidence:'quiet_after_stop'},{voice_owner:'voice-bad'}]){
    fs.writeFileSync(f.manifestPath,JSON.stringify({...f.manifest,...patch}));assert.throws(()=>f.store.input(f.directory));}
  assert.equal(f.stats.writes,0);
});
test('owned coverage is exactly one complete [0, rawBytes] range with a bounded frame-aligned raw file and exact WAV size',t=>{
  const f=fixture(t);for(const coverage of [[],[[0,720],[720,720]],[[0,720,1]],[[1,720]],[[0,'720']],[[0,719]]]){f.rewrite({coverage});assert.throws(()=>f.store.input(f.directory));}
  f.rewrite({coverage:[[0,720]]});for(const bytes of [0,719,1048800]){fs.truncateSync(f.rawPath,bytes);assert.throws(()=>f.store.input(f.directory));}
  fs.writeFileSync(f.rawPath,f.raw);fs.truncateSync(f.wavPath,44);assert.throws(()=>f.store.input(f.directory));assert.equal(f.stats.reads,0);
});
test('missing original audio cannot use old complete metadata or a saved result as a replacement',t=>{
  const f=fixture(t);f.seal();fs.unlinkSync(f.rawPath);assert.throws(()=>f.origin());assert.throws(()=>f.store.input(f.directory));assert(fs.existsSync(f.receiptPath));
});
test('equal-length raw change during recognition is detected even when mtime is restored',t=>{
  const f=fixture(t),input=f.store.input(f.directory),before=fs.statSync(f.rawPath);const changed=Buffer.from(f.raw);changed[400]^=127;fs.writeFileSync(f.rawPath,changed);fs.utimesSync(f.rawPath,before.atime,before.mtime);
  assert.throws(()=>f.store.seal(f.directory,input,result),/CHANGED/);assert(!fs.existsSync(f.receiptPath));assert.equal(f.stats.writes,0);
});
test('changed UUID, owner, cleanup, peer or creation time during recognition cannot be resealed under the old input',t=>{
  const f=fixture(t),input=f.store.input(f.directory);for(const patch of [{uuid:'changed-uuid'},{voice_owner:'voice-'+'d'.repeat(32)},{voice_cleanup_id:'e'.repeat(32)},{peer:'other-peer'},{created:1001}]){
    fs.writeFileSync(f.manifestPath,JSON.stringify({...f.manifest,...patch}));assert.throws(()=>f.store.seal(f.directory,input,result),/CHANGED/);}
  assert.equal(f.stats.writes,0);
});
test('origin rehash detects same-size replacement and refuses a different complete result string',t=>{
  const f=fixture(t);f.seal();assert.throws(()=>f.origin(result+' '),/ORIGIN/);const before=fs.statSync(f.rawPath),changed=Buffer.from(f.raw);changed[0]^=255;fs.writeFileSync(f.rawPath,changed);fs.utimesSync(f.rawPath,before.atime,before.mtime);assert.throws(()=>f.origin(),/CHANGED/);
});
test('manifest or raw changes while hashing fail before any proof or sidecar can be returned',t=>{
  const f=fixture(t);f.afterRead(()=>f.rewrite({created:1001}));assert.throws(()=>f.store.input(f.directory),/CHANGED/);assert.equal(f.handles.size,0);
  f.rewrite({created:1000});f.afterRead(()=>fs.appendFileSync(f.rawPath,Buffer.from([1])));assert.throws(()=>f.store.input(f.directory),/CHANGED/);assert.equal(f.handles.size,0);assert.equal(f.stats.writes,0);
});
test('raw hashing streams blocks at most 64KiB and supports genuine short reads',t=>{
  const f=fixture(t),raw=Buffer.alloc(240000,19);fs.writeFileSync(f.rawPath,raw);fs.writeFileSync(f.wavPath,Buffer.alloc(44+raw.length/240*1280));f.rewrite({coverage:[[0,raw.length]]});
  const input=f.store.input(f.directory);assert.equal(input.raw_sha256,sha(raw));assert(f.stats.maxRead<=65536);assert(f.stats.reads>100);assert.equal(f.handles.size,0);
});
test('early EOF and native read failures close the file and never fabricate an input',t=>{
  const f=fixture(t);f.setReadWidth(0);assert.throws(()=>f.store.input(f.directory),/CHANGED/);assert.equal(f.handles.size,0);f.setReadWidth(701);f.fault('read');assert.throws(()=>f.store.input(f.directory),/synthetic read/);assert.equal(f.handles.size,0);
});
test('partial receipts and owned manifest journal remnants fail closed without deleting or overwriting evidence',t=>{
  const f=fixture(t);for(const leaf of ['task-asr-source.json.partial','manifest.next','manifest.json.partial']){const p=f.directory+'/'+leaf;fs.writeFileSync(p,'preserve-partial');assert.throws(()=>f.store.input(f.directory),/PARTIAL/);assert.equal(fs.readFileSync(p,'utf8'),'preserve-partial');fs.unlinkSync(p);}
  assert.equal(f.stats.writes,0);
});
test('partial metadata appearing during a raw read is rejected at the final snapshot boundary',t=>{
  const f=fixture(t);for(const leaf of ['task-asr-source.json.partial','manifest.next','manifest.json.partial']){const p=f.directory+'/'+leaf;f.afterRead(()=>fs.writeFileSync(p,'late-partial'));assert.throws(()=>f.store.input(f.directory),/PARTIAL/);assert.equal(fs.readFileSync(p,'utf8'),'late-partial');fs.unlinkSync(p);}
  assert.equal(f.stats.writes,0);assert.equal(f.handles.size,0);
});
test('corrupt, conflicting, unknown-field or mismatched receipts block origin and resealing',t=>{
  const f=fixture(t);f.seal();const saved=JSON.parse(fs.readFileSync(f.receiptPath));for(const body of ['{',JSON.stringify({...saved,extra:true}),JSON.stringify({...saved,schema:2}),JSON.stringify({...saved,result_sha256:7}),JSON.stringify({...saved,input:{...saved.input,extra:true}}),JSON.stringify({...saved,input:{...saved.input,uuid:'changed'}})]){
    fs.writeFileSync(f.receiptPath,body);assert.throws(()=>f.origin());assert.equal(fs.readFileSync(f.receiptPath,'utf8'),body);}
  fs.writeFileSync(f.receiptPath,JSON.stringify(saved));assert.throws(()=>f.store.seal(f.directory,saved.input,result+' '),/CONFLICT/);
});
test('removing ownership or the manifest cannot turn a previously sealed task source into an ordinary recording',t=>{
  const f=fixture(t);f.seal();f.rewrite({voice_owner:'',voice_cleanup_id:'',voice_exit_evidence:'none'});assert.throws(()=>f.store.input(f.directory),/MANIFEST/);fs.unlinkSync(f.manifestPath);assert.throws(()=>f.store.input(f.directory),/CHANGED/);
});
test('atomic write faults retain a blocked partial and never claim result publication',async t=>{
  for(const failure of ['write','fsync','rename'])await t.test(failure,t=>{const f=fixture(t),input=f.store.input(f.directory);f.fault(failure);assert.throws(()=>f.store.seal(f.directory,input,result),/synthetic/);assert(!fs.existsSync(f.receiptPath));assert(fs.existsSync(f.receiptPath+'.partial'));f.fault('');assert.throws(()=>f.store.input(f.directory),/PARTIAL/);assert.deepEqual(fs.readFileSync(f.rawPath),f.raw);});
});
test('a source mutation during sidecar publication leaves only partial evidence',t=>{
  const f=fixture(t),input=f.store.input(f.directory);f.afterWrite(()=>{const changed=Buffer.from(f.raw);changed[100]^=7;fs.writeFileSync(f.rawPath,changed);});assert.throws(()=>f.store.seal(f.directory,input,result),/CHANGED/);assert(!fs.existsSync(f.receiptPath));assert(fs.existsSync(f.receiptPath+'.partial'));
});
test('result hashing preserves scalar boundaries and rejects invalid UTF-16 rather than hashing replacement text',t=>{
  const f=fixture(t),input=f.store.input(f.directory),body='x'.repeat(16383)+'😀'+'尾句';f.store.seal(f.directory,input,body);assert.equal(f.origin(body).result_sha256,sha(body));
  for(const bad of ['',true,'\ud800','\udc00'])assert.throws(()=>f.store.seal(f.directory,input,bad),/RESULT/);
});
