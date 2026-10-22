import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {createHash,randomUUID} from 'node:crypto';
import {loadApp} from './load-app.mjs';
import {setupMaterialStore} from './material-fixture.mjs';

const plain=value=>JSON.parse(JSON.stringify(value)),turn=()=>new Promise(setImmediate);
// Synthetic container bytes exercise source validation, never actual codec
// decoding or audible native playback. All files live under test-owned D: root.
function fixture(t){
 const cleanups=[],f=setupMaterialStore({after:callback=>cleanups.push(callback)});assert.match(path.resolve(f.root),/^[Dd]:[\\/]/);
 const roots={recording:f.root+'/recordings',lifelog:f.root+'/lifelog'},handles=new Map(),openCounts=new Map(),opened=[],closed=[],leases=[],controllers=[];
 fs.mkdirSync(roots.recording);fs.mkdirSync(roots.lifelog);
 let failure='',closeFailure='',closeWhen=()=>true,short=4093,materialRoot=f.root+'/materials';
 const io={OpenMode:{CREATE:1,WRITE_ONLY:2,TRUNC:4,READ_ONLY:8},WhenceType:{SEEK_SET:0},
  accessSync:fs.existsSync,mkdirSync:p=>fs.mkdirSync(p),listFileSync:fs.readdirSync,lstatSync:fs.lstatSync,
  statSync(value){if(failure==='stat'&&typeof value==='number')throw Error('synthetic stat private path');return typeof value==='number'?fs.fstatSync(value):fs.statSync(value);},
  readTextSync:p=>fs.readFileSync(p,'utf8'),
  openSync(p,mode){opened.push([p,mode]);if(failure==='open')throw Error('synthetic open token=secret');assert.equal(mode,8,'playback validation is read only');const fd=fs.openSync(p,'r'),ordinal=(openCounts.get(p)||0)+1;openCounts.set(p,ordinal);handles.set(fd,{path:p,at:0,ordinal});return{fd};},
  readSync(fd,buffer,options){if(failure==='read')throw Error('synthetic read private path');if(failure==='short')return 0;
   const handle=handles.get(fd),bytes=new Uint8Array(buffer),count=fs.readSync(fd,bytes,0,Math.min(short,options?.length??bytes.length),handle.at);handle.at+=count;return count;},
  lseek(fd,at){handles.get(fd).at=at;},
  closeSync(value){const fd=typeof value==='number'?value:value.fd,mode=closeWhen(handles.get(fd))?closeFailure:'';closed.push(fd);if(mode==='before')throw Error('synthetic close unknown effect');fs.closeSync(fd);handles.delete(fd);if(mode==='after')throw Error('synthetic throw after actual close');},
  writeSync(){throw Error('playback must not write');},fsyncSync(){throw Error('playback must not fsync');},renameSync(){throw Error('playback must not rename');}};
 const util={generateRandomUUID:()=>randomUUID(),TextEncoder:class{encodeInto(value){return new TextEncoder().encode(value);}},TextDecoder:class{decodeToString(value){return new TextDecoder().decode(value);}}};
 const platform={'@kit.CoreFileKit':{fileIo:io},'@kit.ArkTS':{util},'@kit.AbilityKit':{},'libturbo_audio.so':{}};
 const source=loadApp('LocalAudioSource',platform),coverage=loadApp('RecordingCoverage'),ogg=loadApp('OggOpus'),recording=loadApp('RecordingSession',platform);
 const recordings=new recording.RecordingSession(async()=>{},()=>'',()=>true);recordings.root=roots.recording;
 const resolver=new source.LocalAudioSource({root:kind=>roots[kind],recordingWav:name=>recordings.file({name},true),materialRoot:()=>materialRoot,materials:f.store});
 const resolve=selection=>{const lease=resolver.resolve(selection);leases.push(lease);return lease;};
 const selection=(item,revision=0,utterance='')=>Object.assign(new source.PlaybackSelection(),{kind:item.kind,name:item.name,revision,utterance_id:utterance});
 function wav(channels,frames,frameMs){const pcm=frames*frameMs*16*channels*2,header=channels===2?coverage.stereoWavHeader(pcm):coverage.monoWavHeader(pcm);return Buffer.concat([Buffer.from(header),Buffer.alloc(pcm,7)]);}
 function recordingItem(n=1,frames=200){
  const name='take-'+n.toString(16).padStart(32,'0'),directory=roots.recording+'/'+name;fs.mkdirSync(directory);
  const manifest={version:1,uuid:n.toString(16).padStart(32,'0'),peer:'synthetic',created:1000,completed:true,valid:true,wavReady:true,coverage:[[0,frames*240]]};
  fs.writeFileSync(directory+'/source.rawopus',Buffer.alloc(frames*240,5));fs.writeFileSync(directory+'/audio.wav',wav(2,frames,20));fs.writeFileSync(directory+'/manifest.json',JSON.stringify(manifest));
  return{kind:'recording',name,directory,frames,started:1000,ended:1000+frames*20,manifest};
 }
 function lifelogItem(n=1,{format='ogg',frames=70,sealed=true}={}){
  const name='seg-'+n.toString(16).padStart(32,'0'),directory=roots.lifelog+'/'+name;fs.mkdirSync(directory);
  const meta={version:2,started:1000,ended:1000+frames*60,frames,sealed};
  if(format==='ogg'){const chunks=[],writer=new ogg.OggOpusWriter(bytes=>chunks.push(Buffer.from(bytes)),45,10);writer.begin();for(let at=0;at<frames;at++)writer.push(new Uint8Array(240).fill(at%251));if(sealed)writer.finish();fs.writeFileSync(directory+'/audio.ogg',Buffer.concat(chunks));}
  else{delete meta.version;delete meta.sealed;fs.writeFileSync(directory+'/audio.wav',wav(1,frames,60));fs.writeFileSync(directory+'/source.opus',Buffer.alloc(frames*240,5));}
  fs.writeFileSync(directory+'/meta.json',JSON.stringify(meta));return{kind:'lifelog',name,directory,frames,started:meta.started,ended:meta.ended,meta};
 }
 function material(item,{text='合成当前文字',start=500,end=1000}={}){
  const original=new f.MaterialSource();Object.assign(original,{kind:item.kind,name:item.name,started:item.started,ended:item.ended,complete:true,audioAvailable:true,audioBytes:123,
   audioFrames:item.frames,frameMs:item.kind==='recording'?20:60});
  const first=f.store.ensure(original),input=new f.MaterialTextInput();Object.assign(input,{text,channel:'mix',transcriptionState:'complete',coveredMs:item.ended-item.started,sourceMs:item.ended-item.started});
  input.utterances=[Object.assign(new f.MaterialUtterance(),{text,start_ms:start,end_ms:end,speaker_id:'',speaker_basis:'unknown'})];return f.store.appendTranscript(first.material_id,1,input,'source-fixture-'+item.name);
 }
 function tree(){const result=[];function walk(dir){for(const name of fs.readdirSync(dir)){const file=dir+'/'+name,st=fs.lstatSync(file);if(st.isDirectory()&&!st.isSymbolicLink())walk(file);else if(st.isFile())result.push([file.slice(f.root.length),createHash('sha256').update(fs.readFileSync(file)).digest('hex')]);}}walk(f.root);return result.sort();}
 t.after(async()=>{for(const controller of controllers)await controller.suspend('test_cleanup').catch(()=>{});closeFailure='';for(const lease of leases)try{lease.close();}catch{}
  for(const fd of handles.keys())try{fs.closeSync(fd);}catch{}handles.clear();for(const cleanup of cleanups)cleanup();});
 return{...f,...source,...coverage,...ogg,io,platform,roots,handles,opened,closed,resolver,resolve,selection,recordingItem,lifelogItem,material,recordings,tree,controllers,
  fail:value=>failure=value,closeFail:value=>closeFailure=value,closeOnly:predicate=>closeWhen=predicate,shortReads:value=>short=value,setMaterialRoot:value=>materialRoot=value};
}

test('actual RecordingSession full-coverage WAV resolves without any canonical text and stays read only',t=>{
 const f=fixture(t),item=f.recordingItem(),before=f.tree();assert.equal(f.store.read(f.store.idFor(item.kind,item.name)),undefined);
 assert.equal(f.recordings.file({name:item.name},true),item.directory+'/audio.wav');const lease=f.resolve(f.selection(item));
 assert.equal(lease.reference.format,'wav');assert.equal(lease.reference.revision,0);assert.equal(lease.length,44+item.frames*1280);assert.equal(lease.start_ms,0);assert.match(lease.reference.audio_sha256,/^[a-f0-9]{64}$/);
 assert.deepEqual(Object.keys(plain(lease.reference)).sort(),['kind','name','audio_sha256','format','revision','utterance_id'].sort());lease.check(true);lease.close();lease.close();
 assert.equal(f.handles.size,0);assert.deepEqual(f.tree(),before);assert(f.opened.every(([,mode])=>mode===8));
});

test('actual sealed OGG writer and scanner plus legacy mono WAV are both playable local source formats',t=>{
 const f=fixture(t);for(const format of ['ogg','wav']){const item=f.lifelogItem(format==='ogg'?1:2,{format}),before=f.tree(),lease=f.resolve(f.selection(item));
  assert.equal(lease.reference.format,format);assert.equal(lease.start_ms,0);lease.check(false);lease.check(true);lease.close();assert.equal(f.handles.size,0);assert.deepEqual(f.tree(),before);}
});

test('actual RecordingSession coverage hole, incomplete flags and WAV mismatch are rejected without guessing completion',t=>{
 const f=fixture(t);for(const [n,change] of [[1,m=>m.coverage=[[0,240],[480,48000]]],[2,m=>m.completed=false],[3,m=>m.wavReady=false],[4,m=>m.valid=false]]){
  const item=f.recordingItem(n);change(item.manifest);fs.writeFileSync(item.directory+'/manifest.json',JSON.stringify(item.manifest));
  assert.throws(()=>f.resolve(f.selection(item)),/^Error: PLAYBACK_(SOURCE_UNAVAILABLE|INCOMPLETE)$/);assert.equal(f.handles.size,0);}
 const item=f.recordingItem(5);fs.truncateSync(item.directory+'/audio.wav',100);assert.throws(()=>f.resolve(f.selection(item)),/PLAYBACK_(INCOMPLETE|SOURCE_UNAVAILABLE)/);assert.equal(f.handles.size,0);
});

test('unsealed OGG, missing EOS, CRC corruption and mismatched frame metadata cannot become sources',t=>{
 const f=fixture(t),open=f.lifelogItem(1,{sealed:false});assert.throws(()=>f.resolve(f.selection(open)),/PLAYBACK_INCOMPLETE/);
 const missingEOS=f.lifelogItem(2),bytes=fs.readFileSync(missingEOS.directory+'/audio.ogg');fs.writeFileSync(missingEOS.directory+'/audio.ogg',bytes.subarray(0,bytes.length-1));assert.throws(()=>f.resolve(f.selection(missingEOS)),/PLAYBACK_(SOURCE_UNAVAILABLE|INCOMPLETE)/);
 const corrupt=f.lifelogItem(3),bad=fs.readFileSync(corrupt.directory+'/audio.ogg');bad[bad.length-1]^=1;fs.writeFileSync(corrupt.directory+'/audio.ogg',bad);assert.throws(()=>f.resolve(f.selection(corrupt)),/PLAYBACK_(SOURCE_UNAVAILABLE|INCOMPLETE)/);
 const wrong=f.lifelogItem(4);wrong.meta.frames++;fs.writeFileSync(wrong.directory+'/meta.json',JSON.stringify(wrong.meta));assert.throws(()=>f.resolve(f.selection(wrong)),/PLAYBACK_INCOMPLETE/);assert.equal(f.handles.size,0);
});

test('missing audio preserves actual canonical text and historical revisions without source writes',t=>{
 const f=fixture(t),item=f.recordingItem(),row=f.material(item);fs.unlinkSync(item.directory+'/audio.wav');const before=f.tree();
 assert.throws(()=>f.resolve(f.selection(item)),/PLAYBACK_SOURCE_UNAVAILABLE/);assert.equal(f.store.read(row.material_id).text,row.text);assert.equal(f.handles.size,0);assert.deepEqual(f.tree(),before);
});

test('current anchored selection uses original relative sentence start; old revision, ID and split timing are refused',t=>{
 const f=fixture(t),item=f.lifelogItem(),row=f.material(item),part=row.utterances[0],lease=f.resolve(f.selection(item,row.revision,part.utterance_id));
 assert.equal(lease.start_ms,500);assert.notEqual(lease.start_ms,item.started+500);lease.close();
 assert.throws(()=>f.resolve(f.selection(item,row.revision-1,part.utterance_id)),/PLAYBACK_ANCHOR_STALE/);
 assert.throws(()=>f.resolve(f.selection(item,row.revision,'missing-utterance')),/PLAYBACK_ANCHOR_STALE/);
 const op=new f.MaterialSpeakerCorrection();Object.assign(op,{operation_id:'synthetic-source-split',kind:'split',utterance_ids:[part.utterance_id],split_offset:2});
 const split=f.store.correctSpeakers(row.material_id,row.revision,op);assert.equal(split.utterances[0].start_ms,null);
 assert.throws(()=>f.resolve(f.selection(item,split.revision,split.utterances[0].utterance_id)),/PLAYBACK_TIME_UNKNOWN/);assert.equal(f.handles.size,0);
});

test('current tombstone blocks both full and anchored playback while retaining the old immutable text revision',t=>{
 const f=fixture(t),item=f.recordingItem(),row=f.material(item);f.store.delete(row.material_id,row.revision);
 assert.throws(()=>f.resolve(f.selection(item)),/PLAYBACK_DELETED/);assert.throws(()=>f.resolve(f.selection(item,row.revision,row.utterances[0].utterance_id)),/PLAYBACK_DELETED/);
 assert.equal(f.store.read(row.material_id,row.revision).text,row.text);assert.equal(f.handles.size,0);
});

test('strong and light checks never move the independent media descriptor read position',t=>{
 const f=fixture(t),item=f.lifelogItem(),lease=f.resolve(f.selection(item)),expected=fs.readFileSync(item.directory+'/audio.ogg'),first=Buffer.alloc(11),next=Buffer.alloc(17);
 assert.equal(fs.readSync(lease.fd,first,0,first.length,null),11);assert.deepEqual(first,expected.subarray(0,11));
 lease.check(true);lease.check(false);assert.equal(fs.readSync(lease.fd,next,0,next.length,null),17);assert.deepEqual(next,expected.subarray(11,28));lease.close();assert.equal(f.handles.size,0);
});

test('audio content, metadata replacement and audio pathname replacement invalidate held source without leaking descriptors',t=>{
 const f=fixture(t);for(const [n,mutation] of [[1,item=>{const file=item.directory+'/audio.wav',bytes=fs.readFileSync(file);bytes[45]^=1;fs.writeFileSync(file,bytes);}],
  [2,item=>{const p=item.directory+'/manifest.json';fs.renameSync(p,p+'.old');fs.writeFileSync(p,JSON.stringify(item.manifest));}],
  [3,item=>{const p=item.directory+'/audio.wav',bytes=fs.readFileSync(p);fs.renameSync(p,p+'.old');fs.writeFileSync(p,bytes);}]]){
  const item=f.recordingItem(n),lease=f.resolve(f.selection(item));mutation(item);assert.throws(()=>lease.check(false),/PLAYBACK_SOURCE_CHANGED/);lease.close();assert.equal(f.handles.size,0);}
});

test('new canonical revision invalidates held anchor even when original audio remains byte-identical',t=>{
 const f=fixture(t),item=f.recordingItem(),row=f.material(item),lease=f.resolve(f.selection(item,row.revision,row.utterances[0].utterance_id));
 f.store.correctText(row.material_id,row.revision,row.utterances[0].utterance_id,'更正后的当前正文');assert.throws(()=>lease.check(false),/PLAYBACK_ANCHOR_STALE/);lease.close();assert.equal(f.handles.size,0);
});

test('source read/open/stat/short-read failures close acquired handles and return only enumerated safe errors',t=>{
 const f=fixture(t),item=f.recordingItem();for(const failure of ['open','read','stat','short']){
  f.fail(failure);assert.throws(()=>f.resolve(f.selection(item)),error=>{assert.match(error.message,/^PLAYBACK_[A-Z_]+$/);assert.doesNotMatch(error.message,/secret|private|token/);return true;});
  assert.equal(f.handles.size,0,failure+' leaked a descriptor');f.fail('');}
 f.shortReads(19);const lease=f.resolve(f.selection(item));lease.check(true);lease.close();assert.equal(f.handles.size,0);
});

test('caller paths, injected fields and invalid kind/anchor pairs are rejected before opening source',t=>{
 const f=fixture(t),item=f.recordingItem();for(const input of [{...f.selection(item),path:item.directory+'/audio.wav'},
  {...f.selection(item),name:'../audio.wav'},{...f.selection(item),kind:'unknown'},{...f.selection(item),revision:2},
  {...f.selection(item),utterance_id:'injected'},{...f.selection(item),revision:2,utterance_id:'\u0000'}]){
  const opened=f.opened.length;assert.throws(()=>f.resolve(input),/PLAYBACK_INVALID/);assert.equal(f.opened.length,opened);}
});

test('uncertain validation-handle close blocks every later resolve before another open',t=>{
 const f=fixture(t),item=f.recordingItem();f.closeFail('before');assert.throws(()=>f.resolve(f.selection(item)),/PLAYBACK_SOURCE_UNAVAILABLE/);
 assert.equal(f.handles.size,1,'retain only the one handle whose close is uncertain');const opened=f.opened.length,closed=f.closed.length;f.closeFail('');
 assert.throws(()=>f.resolve(f.selection(item)),/PLAYBACK_SOURCE_UNAVAILABLE/);assert.equal(f.opened.length,opened);assert.equal(f.closed.length,closed);
});

test('throw after actual media close never closes a reused descriptor or permits resource growth',t=>{
 const f=fixture(t),item=f.recordingItem(),lease=f.resolve(f.selection(item));f.closeFail('after');assert.throws(()=>lease.close(),/PLAYBACK_SOURCE_UNAVAILABLE/);assert.equal(f.handles.size,0);f.closeFail('');
 const other=f.io.openSync(item.directory+'/audio.wav',8),closed=f.closed.length,opened=f.opened.length;
 assert.throws(()=>lease.close(),/PLAYBACK_SOURCE_UNAVAILABLE/);assert.equal(f.closed.length,closed);assert.equal(fs.fstatSync(other.fd).size,44+item.frames*1280);
 assert.throws(()=>f.resolve(f.selection(item)),/PLAYBACK_SOURCE_UNAVAILABLE/);assert.equal(f.opened.length,opened);f.io.closeSync(other);assert.equal(f.handles.size,0);
});

test('normal OGG parser close uncertainty blocks every later resolve without allocating another handle',t=>{
 const f=fixture(t),item=f.lifelogItem(),other=f.recordingItem();f.closeOnly(handle=>handle.path.endsWith('/audio.ogg')&&handle.ordinal===2);f.closeFail('after');
 assert.throws(()=>f.resolve(f.selection(item)),/PLAYBACK_SOURCE_UNAVAILABLE/);assert.equal(f.handles.size,0);const opened=f.opened.length;f.closeFail('');
 assert.throws(()=>f.resolve(f.selection(other)),/PLAYBACK_SOURCE_UNAVAILABLE/);assert.equal(f.opened.length,opened);
});

test('CRC-constructor cleanup close uncertainty is distinct from an ordinary recoverable CRC rejection',t=>{
 const f=fixture(t),item=f.lifelogItem(),other=f.recordingItem(),file=item.directory+'/audio.ogg',bytes=fs.readFileSync(file);bytes[bytes.length-1]^=1;fs.writeFileSync(file,bytes);
 f.closeOnly(handle=>handle.path.endsWith('/audio.ogg')&&handle.ordinal===2);f.closeFail('after');assert.throws(()=>f.resolve(f.selection(item)),/PLAYBACK_(SOURCE_UNAVAILABLE|INCOMPLETE)/);
 assert.equal(f.handles.size,0);const opened=f.opened.length;f.closeFail('');assert.throws(()=>f.resolve(f.selection(other)),/PLAYBACK_SOURCE_UNAVAILABLE/);assert.equal(f.opened.length,opened);
});

test('ordinary CRC rejection closes its handle and permits a different complete source',t=>{
 const f=fixture(t),item=f.lifelogItem(),other=f.recordingItem(),file=item.directory+'/audio.ogg',bytes=fs.readFileSync(file);bytes[bytes.length-1]^=1;fs.writeFileSync(file,bytes);
 assert.throws(()=>f.resolve(f.selection(item)),/PLAYBACK_INCOMPLETE/);assert.equal(f.handles.size,0);const lease=f.resolve(f.selection(other));assert.equal(lease.reference.format,'wav');lease.close();assert.equal(f.handles.size,0);
});

test('source-root ancestor junction is refused although every final directory and file is ordinary',t=>{
 const f=fixture(t),item=f.recordingItem(),parent=f.root+'/source-parent-real',alias=f.root+'/source-parent-link';fs.mkdirSync(parent);
 fs.renameSync(f.roots.recording,parent+'/recordings');fs.symlinkSync(parent,alias,'junction');f.roots.recording=alias+'/recordings';f.recordings.root=f.roots.recording;
 assert.equal(fs.lstatSync(alias).isSymbolicLink(),true);assert.equal(fs.lstatSync(f.roots.recording).isSymbolicLink(),false);
 assert.equal(fs.lstatSync(f.roots.recording+'/'+item.name+'/audio.wav').isSymbolicLink(),false);
 assert.throws(()=>f.resolve(f.selection(item)),/PLAYBACK_SOURCE_UNAVAILABLE/);assert.equal(f.handles.size,0);
});

test('material-root ancestor junction is refused although the final material directory is ordinary',t=>{
 const f=fixture(t),item=f.recordingItem(),row=f.material(item),alias=f.root+'/material-parent-link';fs.symlinkSync(f.root,alias,'junction');f.setMaterialRoot(alias+'/materials');
 assert.equal(fs.lstatSync(alias).isSymbolicLink(),true);assert.equal(fs.lstatSync(alias+'/materials').isSymbolicLink(),false);
 assert.equal(fs.lstatSync(alias+'/materials/'+row.material_id+'/revision-000000002.json').isSymbolicLink(),false);
 assert.throws(()=>f.resolve(f.selection(item,row.revision,row.utterances[0].utterance_id)),/PLAYBACK_SOURCE_UNAVAILABLE/);assert.equal(f.handles.size,0);
});

test('pure-separator drive-root relative and dot-bearing source or material port roots are rejected',t=>{
 const f=fixture(t),item=f.recordingItem(),actual=f.roots.recording;
 for(const root of ['', '/', '////', '\\', 'D:/', 'D:\\', 'relative', 'D:relative', f.root+'/../recordings', f.root+'/./recordings']){
  f.roots.recording=root;const opens=f.opened.length;assert.throws(()=>f.resolve(f.selection(item)),/PLAYBACK_SOURCE_UNAVAILABLE/,'source root '+JSON.stringify(root));assert.equal(f.opened.length,opens);assert.equal(f.handles.size,0);
 }
 f.roots.recording=actual;
 for(const root of ['', '/', '////', '\\', 'D:/', 'D:\\', 'relative', 'D:relative', f.root+'/../materials', f.root+'/./materials']){
  f.setMaterialRoot(root);assert.throws(()=>f.resolve(f.selection(item)),/PLAYBACK_SOURCE_UNAVAILABLE/,'material root '+JSON.stringify(root));assert.equal(f.handles.size,0);
 }
});

test('actual normal page play and sentence methods route through real Controller and Resolver with explicit driver events',async t=>{
 const f=fixture(t),item=f.lifelogItem(),row=f.material(item),drivers=[],mod=loadApp('PlaybackController',f.platform,{setTimeout,clearTimeout,setInterval,clearInterval});
 const controller=new mod.PlaybackController({resolve:f.resolve,foreground:()=>true,create(){let event;const driver={
  prepare:async(lease,listener)=>{event=listener;driver.fd=lease.fd;driver.state='prepared';listener({kind:'state',native_state:driver.state,duration_ms:4200,position_ms:0});},
  play:async()=>{driver.plays++;driver.state='playing';event({kind:'state',native_state:driver.state});},pause:async()=>{driver.state='paused';event({kind:'state',native_state:driver.state});},
  seek:async position=>{driver.seeks.push(position);event({kind:'position',native_state:driver.state,position_ms:position,duration_ms:4200});},
  release:async()=>{driver.releases++;},state:'idle',plays:0,seeks:[],releases:0};drivers.push(driver);return driver;}});f.controllers.push(controller);
 const require=createRequire(import.meta.url),deveco=process.env.DEVECO_HOME||'D:/APP/DevEcoStudio',ts=require(`${deveco}/sdk/default/openharmony/ets/build-tools/ets-loader/node_modules/typescript`),
  source=fs.readFileSync(new URL('../entry/src/main/ets/pages/JournalPanel.ets',import.meta.url),'utf8');
 function method(name){const match=new RegExp(`^  private (?:async )?${name}\\(`,'m').exec(source);assert(match);const after=source.slice(match.index+match[0].length),next=/\n  (?:private |aboutTo|@Builder|[A-Za-z][A-Za-z0-9_]*\()/.exec(after);assert(next);return source.slice(match.index,match.index+match[0].length+next.index);}
 const code=ts.transpileModule(`class Page {\n${['playAudio','playSentence','playbackError'].map(method).join('\n')}\n}\nmodule.exports=Page;`,{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS}}).outputText,module={exports:{}};
 vm.runInNewContext(code,{module,exports:module.exports,localPlayback:controller,PlaybackSelection:f.PlaybackSelection,Number});const page=new module.exports();Object.assign(page,{visible:true,actionEpoch:1,playback:controller.snapshot(),note:''});
 page.playAudio(item.kind,item.name);await turn();assert.equal(controller.snapshot().phase,'playing');assert.equal(drivers[0].plays,1);assert.equal(controller.snapshot().source.format,'ogg');
 page.playSentence(row.utterances[0],row);await turn();assert.equal(drivers[0].releases,1);assert.deepEqual(drivers[1].seeks,[500]);assert.equal(drivers[1].plays,1);assert.equal(page.playback.source.revision,row.revision);
 await controller.suspend('test');assert.equal(f.handles.size,0);assert.equal(controller.snapshot().audio_output_verified,false);
});
