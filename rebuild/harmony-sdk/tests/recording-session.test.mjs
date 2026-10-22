import test from 'node:test';import assert from 'node:assert/strict';import {loadApp} from './load-app.mjs';import {loadCore} from './load-core.mjs';
const {businessEnvelope}=loadCore('./BusinessCommands'),{readLauncherEnvelope}=loadCore('./LauncherStatus'),peer='aabbccddeeff';
const settle=()=>new Promise(r=>setImmediate(r));
const packet=(type,j,bytes=[])=>{const prefix=businessEnvelope(type,new TextEncoder().encode(JSON.stringify(j)));const n=bytes.length;return Uint8Array.from([...prefix,...(n?[34,...(n>127?[n%128|128,Math.floor(n/128)]:[n]),...bytes]:[])]);};
function setup(isolatedLab=false){
 const files=new Map(),dirs=new Set(),handles=new Map(),sent=[],timers=new Map();let fd=0,random=0,timer=0,connected=true,decodeFails=false;
 const fs={OpenMode:{CREATE:1,READ_WRITE:2,WRITE_ONLY:4,TRUNC:8},WhenceType:{SEEK_SET:0},accessSync:p=>files.has(p)||dirs.has(p),mkdirSync:p=>{if(dirs.has(p))throw Error('exists');dirs.add(p);},unlinkSync:p=>{if(!files.delete(p))throw Error('missing');},rmdirSync:p=>{if([...files.keys()].some(f=>f.startsWith(p+'/')))throw Error('not-empty');dirs.delete(p);},listFileSync:p=>[...dirs,...files.keys()].filter(d=>d.startsWith(p+'/')&&!d.slice(p.length+1).includes('/')).map(d=>d.slice(p.length+1)),openSync:(path,flags)=>{if(!files.has(path)){if(!(flags&1))throw Error('missing');files.set(path,new Uint8Array());}if(flags&8)files.set(path,new Uint8Array());const file={fd:++fd,path,pos:0};handles.set(file.fd,file);return file;},closeSync:f=>handles.delete(typeof f==='number'?f:f.fd),lseek:(fd,pos)=>{handles.get(fd).pos=pos;return pos;},writeSync:(fd,buffer)=>{const h=handles.get(fd),b=new Uint8Array(buffer),old=files.get(h.path),out=new Uint8Array(Math.max(old.length,h.pos+b.length));out.set(old);out.set(b,h.pos);h.pos+=b.length;files.set(h.path,out);return b.length;},readSync:(fd,buffer,options={})=>{const h=handles.get(fd),b=files.get(h.path),n=Math.min(options.length??buffer.byteLength,b.length-h.pos);new Uint8Array(buffer).set(b.slice(h.pos,h.pos+n));h.pos+=n;return n;},fsyncSync:()=>{},renameSync:(a,b)=>{files.set(b,files.get(a));files.delete(a);},readTextSync:p=>new TextDecoder().decode(files.get(p)),statSync:p=>({size:files.get(typeof p==='number'?handles.get(p).path:p).length})};
 const {RecordingSession}=loadApp('RecordingSession',{'@kit.AbilityKit':{},'@kit.CoreFileKit':{fileIo:fs},'@kit.CryptoArchitectureKit':{cryptoFramework:{createRandom:()=>({generateRandomSync:n=>({data:new Uint8Array(n).fill(++random)})})}},'libturbo_audio.so':{recordingReset:()=>{},recordingClose:()=>{},recordingDecode:()=>{if(decodeFails)throw Error('bad');return new Uint8Array(1280).fill(1).buffer;}},'./RecordingCoverage':loadApp('RecordingCoverage')},{setTimeout:(f,ms)=>{timers.set(++timer,{f,ms});return timer;},clearTimeout:id=>timers.delete(id)});
 const session=new RecordingSession(async(b,p)=>{assert.equal(b,14);const e=readLauncherEnvelope(p);sent.push({type:e.type,body:JSON.parse(new TextDecoder().decode(e.json))});},()=>connected?peer:'',()=>true);session.initialize({filesDir:'/private-test'},isolatedLab);
 return {session,sent,timers,files,handles,id:()=>sent.find(s=>s.type===1).body.uuid,failDecoder:()=>decodeFails=true,feed:async(type,j,b)=>{session.receive(peer,packet(type,j,b));await settle();},drain:async()=>{for(let n=0;n<6;n++){for(const [id,t]of [...timers])if(t.ms===0||t.ms===1000){timers.delete(id);t.f();}await settle();}}};
}
test('explicit start sends foreground first, prepares storage, and receives matching UUID only',async()=>{const s=setup();await s.session.start();assert.deepEqual(s.sent.map(x=>x.type),[14,1]);assert(s.files.size>=2);await s.feed(3,{uuid:'wrong',offset:0},new Uint8Array(240).fill(2));assert.equal(s.session.bytes,0);await s.feed(3,{uuid:s.id(),offset:0},new Uint8Array(240).fill(2));assert.equal(s.session.bytes,240);s.session.disconnected();assert.equal(s.handles.size,0);});
test('physical start with opt-in receives immediately queued audio without losing first packet',async()=>{const s=setup();await s.session.enable(true);s.session.receive(peer,packet(1,{uuid:'eye-test',action:1}));s.session.receive(peer,packet(3,{uuid:'eye-test',offset:0},new Uint8Array(240).fill(2)));await settle();assert.equal(s.session.bytes,240);assert.equal(s.sent.at(-1).body.action,2);s.session.disconnected();});
test('out of order identical chunks reconstruct exactly; successful completion produces stereo WAV',async()=>{const s=setup();await s.session.start();const id=s.id();await s.feed(3,{uuid:id,offset:240},new Uint8Array(240).fill(3));await s.feed(3,{uuid:id,offset:0},new Uint8Array(240).fill(2));await s.feed(3,{uuid:id,offset:240},new Uint8Array(240).fill(3));assert.equal(s.session.bytes,480);await s.feed(6,{uuid:id,completed:true});await s.drain();assert.equal(s.session.items.length,1);assert(s.session.items[0].complete);const raw=s.files.get(s.session.file(s.session.items[0],false)),wav=s.files.get(s.session.file(s.session.items[0],true));assert.equal(raw[0],2);assert.equal(raw[240],3);assert.equal(wav.length,44+2560);assert.equal(new DataView(wav.buffer).getUint16(22,true),2);assert.equal(s.handles.size,0);});
test('different overlapping bytes invalidate recording and preserve original bytes',async()=>{const s=setup();await s.session.start();const id=s.id();await s.feed(3,{uuid:id,offset:0},new Uint8Array(240).fill(2));await s.feed(3,{uuid:id,offset:0},new Uint8Array(240).fill(3));assert(!s.session.active);s.session.refresh();assert(!s.session.items[0].complete);assert.equal(s.files.get(s.session.file(s.session.items[0],false))[0],2);assert.equal(s.handles.size,0);});
test('completion with missing range or decoder error never publishes audio.wav',async()=>{for(const kind of ['gap','decode']){const s=setup();await s.session.start();const id=s.id();if(kind==='decode')s.failDecoder();await s.feed(3,{uuid:id,offset:kind==='gap'?240:0},new Uint8Array(240).fill(2));await s.feed(6,{uuid:id,completed:true});await s.drain();assert(![...s.files.keys()].some(p=>p.endsWith('/audio.wav')));assert.equal(s.handles.size,0);}});
test('late audio invalidates metadata and disables export even with a stale previously complete row',async()=>{const s=setup();await s.session.start();const id=s.id();await s.feed(3,{uuid:id,offset:0},new Uint8Array(240).fill(2));await s.feed(6,{uuid:id,completed:true});await s.drain();const old=s.session.items[0];assert(old.complete);await s.feed(3,{uuid:id,offset:240},new Uint8Array(240).fill(2));assert(!s.session.items[0].complete);assert.throws(()=>s.session.file(old,true));});
test('stop requires explicit completion; timeout preserves raw and unresolved device occupancy without upload',async()=>{const s=setup();await s.session.start();await s.session.stop();assert(s.session.active);const timer=[...s.timers.values()].find(t=>t.ms===30000);timer.f();assert(!s.session.active);assert(s.session.occupied);assert(s.session.cleanupRequired);assert(s.files.size>=2);assert(s.sent.every(s=>[1,4,14].includes(s.type)));});
test('start timeout releases local storage but retains device cleanup; matching reply or audio clears its deadline',async()=>{for(const mode of ['timeout','ack','audio']){const s=setup();await s.session.start();if(mode==='ack')await s.feed(1,{uuid:s.id(),action:2,code:1});if(mode==='audio')await s.feed(3,{uuid:s.id(),offset:0},new Uint8Array(240).fill(2));const t=[...s.timers.values()].find(t=>t.ms===10000);if(mode==='timeout'){assert(t);t.f();assert.equal(s.handles.size,0);assert(!s.session.active);assert(s.session.occupied);assert(s.session.cleanupRequired);}else{assert(!t);s.session.disconnected();}}});
test('reload refuses truncated WAV even when old metadata says complete',async()=>{const s=setup();await s.session.start();await s.feed(3,{uuid:s.id(),offset:0},new Uint8Array(240).fill(2));await s.feed(6,{uuid:s.id(),completed:true});await s.drain();const old=s.session.items[0],path=s.session.file(old,true);s.files.set(path,new Uint8Array(44));s.session.refresh();assert(!s.session.items[0].complete);assert.throws(()=>s.session.file(old,true));});
test('phone start includes official online mode and type; UI waits for actual ACK',async()=>{const s=setup();await s.session.start();const body=s.sent.find(row=>row.type===1).body;assert.equal(body.mode,1);assert.equal(body.type,1);assert.equal(body.action,1);assert(s.session.starting);await s.feed(1,{uuid:s.id(),action:2,code:1});assert(!s.session.starting);s.session.disconnected();});
test('same-session start request ACKs exact online profile without another directory; foreign UUID not adopted',async()=>{const s=setup();await s.session.start();const count=s.files.size;await s.feed(1,{uuid:s.id(),action:1,mode:1,type:1});assert.equal(s.files.size,count);assert.deepEqual(s.sent.at(-1).body,{uuid:s.id(),action:2,mode:1,code:1,type:1});const n=s.sent.length;await s.feed(1,{uuid:'foreign',action:1});assert.equal(s.sent.length,n);s.session.disconnected();});

async function oldTranscribedRecording(s,text='已保存的录音文字'){
 await s.session.start();await s.feed(3,{uuid:s.id(),offset:0},new Uint8Array(240).fill(2));
 await s.feed(6,{uuid:s.id(),completed:true});await s.drain();
 const item=s.session.items[0],dir=s.session.directoryOf(item),manifest=JSON.parse(new TextDecoder().decode(s.files.get(dir+'/manifest.json')));
 manifest.created=Date.now()-10*86400000;s.files.set(dir+'/manifest.json',new TextEncoder().encode(JSON.stringify(manifest)));
 s.files.set(dir+'/transcript-100.md',new TextEncoder().encode(text));s.session.refresh();return dir;
}
test('historic audio already pruned by an older version still keeps text visible and exportable',async()=>{
 const s=setup(),dir=await oldTranscribedRecording(s);const stale=s.session.items[0];
 s.files.delete(dir+'/source.rawopus');s.files.delete(dir+'/audio.wav');s.session.refresh();assert.equal(s.session.items.length,1);
 const item=s.session.items[0];assert.equal(item.rawAvailable,false);assert.equal(item.complete,false);assert.equal(item.bytes,0);
 assert.match(item.note,/文字保留/);assert.equal(s.session.textPath(item),dir+'/transcript-100.md');
 assert.equal(new TextDecoder().decode(s.files.get(s.session.textPath(item))),'已保存的录音文字');
 assert.throws(()=>s.session.file(stale,false),/音频已清理/);assert.throws(()=>s.session.file(stale,true),/音频已清理/);
 s.session.refresh();assert.equal(s.session.items.length,1);assert.equal(s.session.pruneAudio(3),0);
 assert(s.session.findByDirectory(dir));assert.equal(s.session.findByDirectory('/other/'+item.name),undefined);
 s.session.remove(item);assert.equal(s.session.items.length,0);
});
test('active recordings retain original audio and WAV indefinitely, including after transcription',async()=>{
 const s=setup(),dir=await oldTranscribedRecording(s);
 for(const days of [1,3,30,NaN])assert.equal(s.session.pruneAudio(days),0);
 s.session.refresh();assert(s.session.items[0].complete);assert(s.files.has(dir+'/source.rawopus'));assert(s.files.has(dir+'/audio.wav'));
});
test('recording awaits microphone handoff and resumes its owner only on completion or failure',async()=>{
 const s=setup();let release,ended=0;
 s.session.beforeStart=()=>new Promise(r=>{release=r;});s.session.onSessionEnded=()=>{ended++;};
 const pending=s.session.start();await settle();assert.equal(s.sent.length,0);assert.equal(s.session.active,false);
 release();await pending;assert(s.session.active);assert.equal(ended,0);
 await s.feed(3,{uuid:s.id(),offset:0},new Uint8Array(240).fill(2));await s.feed(6,{uuid:s.id(),completed:true});await s.drain();assert.equal(ended,1);
});
test('a rejected handoff sends no recording start and releases the owner',async()=>{
 const s=setup();let ended=0;s.session.beforeStart=async()=>{throw Error('handoff-failed');};s.session.onSessionEnded=()=>ended++;
 await assert.rejects(s.session.start(),/handoff-failed/);assert.equal(s.sent.length,0);assert.equal(ended,1);assert(!s.session.busy);
});
test('duplicate stop is idempotent; only new tail coverage extends its timeout',async()=>{
 const s=setup();await s.session.start();await s.session.stop();await s.session.stop();assert.equal(s.sent.filter(x=>x.type===4).length,1);assert(s.session.stopping);
 const timer=()=>[...s.timers.values()].find(t=>t.ms===30000);
 const before=timer();await s.feed(3,{uuid:s.id(),offset:0},new Uint8Array(240).fill(2));const next=timer();assert.notEqual(before,next);
 await s.feed(3,{uuid:s.id(),offset:0},new Uint8Array(240).fill(2));assert.equal(timer(),next);
 next.f();assert(!s.session.active);assert(!s.session.stopping);
});
test('retention refuses missing or empty transcript and invalid retention periods',async()=>{
 for(const mode of ['empty','missing','invalid-days']){
  const s=setup(),dir=await oldTranscribedRecording(s,mode==='empty'?'  ':'文字');
  if(mode==='missing')s.files.delete(dir+'/transcript-100.md');
  assert.equal(s.session.pruneAudio(mode==='invalid-days'?NaN:3),0);assert(s.files.has(dir+'/source.rawopus'));assert(s.files.has(dir+'/audio.wav'));
 }
});
test('recording operations reject directory traversal before touching files',()=>{
 const s=setup(),item={name:'../outside',textFile:'transcript-100.md'};const before=[...s.files.keys()];
 for(const act of [()=>s.session.remove(item),()=>s.session.directoryOf(item),()=>s.session.file(item,false),()=>s.session.textPath(item)])assert.throws(act,/标识/);
 assert.deepEqual([...s.files.keys()],before);
});
test('fixed manual mirror is durable and idempotent without creating another timestamped file',async()=>{
 const s=setup(),dir=await oldTranscribedRecording(s),item=s.session.items[0];s.session.saveTranscriptFixed(item,'transcript-1234567890123.md','新的完整文字');
 const first=s.files.get(dir+'/transcript-1234567890123.md');assert(first);assert.equal(s.handles.size,0);
 s.session.saveTranscriptFixed(item,'transcript-1234567890123.md','新的完整文字');assert.equal(s.files.get(dir+'/transcript-1234567890123.md'),first);
 assert.throws(()=>s.session.saveTranscriptFixed(item,'transcript-1234567890123.md','不覆盖的其他文字'),/MIRROR_CONFLICT/);assert.equal(s.files.get(dir+'/transcript-1234567890123.md'),first);
 assert.throws(()=>s.session.saveTranscriptFixed(item,'../outside.md','文字'),/MIRROR_INVALID/);
});
test('fixed manual mirror refuses a source removed after recognition',async()=>{
 const s=setup(),dir=await oldTranscribedRecording(s),item=s.session.items[0];s.files.delete(dir+'/source.rawopus');
 assert.throws(()=>s.session.saveTranscriptFixed(item,'transcript-1234567890123.md','迟到文字'),/音频已清理/);assert(!s.files.has(dir+'/transcript-1234567890123.md'));
});

test('recording deletion commits its hook before touching files and hook failure preserves every source byte',async()=>{
 const s=setup(),dir=await oldTranscribedRecording(s),item=s.session.items[0];
 const before=[...s.files].map(([name,bytes])=>[name,Array.from(bytes)]);
 s.session.beforeRemove=()=>{throw Error('synthetic tombstone failure');};
 assert.throws(()=>s.session.remove(item),/删除标记未能保存/);
 assert.deepEqual([...s.files].map(([name,bytes])=>[name,Array.from(bytes)]),before);
 let calls=0;s.session.beforeRemove=selected=>{calls++;assert.equal(selected.name,item.name);assert(s.files.has(dir+'/source.rawopus'));};
 s.session.remove(item);assert.equal(calls,1);assert.equal(s.session.items.length,0);assert.match(s.session.note,/等待同步确认/);
});

test('recording deletion checks active capture before committing any deletion and reports unfinished cleanup',async()=>{
 const s=setup();await s.session.start();let calls=0;s.session.beforeRemove=()=>calls++;
 s.session.refresh();assert.throws(()=>s.session.remove(s.session.items[0]),/正在录音/);assert.equal(calls,0);
 await s.feed(3,{uuid:s.id(),offset:0},new Uint8Array(240).fill(2));await s.feed(6,{uuid:s.id(),completed:true});await s.drain();
 const item=s.session.items[0],dir=s.session.directoryOf(item),remove=s.files.delete;
 s.files.delete=()=>false;
 assert.throws(()=>s.session.remove(item),/删除标记已保存.*仍被占用/);assert.equal(calls,1);assert(s.files.has(dir+'/source.rawopus'));
 s.files.delete=remove;s.session.remove(item);assert.equal(calls,2);assert.equal(s.session.items.length,0);
});

test('one locked raw payload retains its manifest and visible recording for cleanup retry',async()=>{
 const s=setup(),dir=await oldTranscribedRecording(s),item=s.session.items[0],remove=s.files.delete;
 s.session.beforeRemove=()=>{};
 s.files.delete=file=>file===dir+'/source.rawopus'?false:remove.call(s.files,file);
 assert.throws(()=>s.session.remove(item),/删除标记已保存.*仍被占用/);
 assert(s.files.has(dir+'/source.rawopus'));assert(s.files.has(dir+'/manifest.json'));
 s.session.refresh();assert.equal(s.session.items.length,1);assert.equal(s.session.items[0].name,item.name);
 assert.equal(s.session.items[0].rawAvailable,true);
 s.files.delete=remove;s.session.remove(s.session.items[0]);assert.equal(s.session.items.length,0);
 assert(!s.files.has(dir+'/source.rawopus'));assert(!s.files.has(dir+'/manifest.json'));
});

test('diagnostic recording namespace never reads or writes the normal recording directory',async()=>{
 const s=setup(true);await s.session.start();await s.feed(3,{uuid:s.id(),offset:0},new Uint8Array(240).fill(2));
 await s.feed(6,{uuid:s.id(),completed:true});await s.drain();assert.equal(s.session.items.length,1);
 assert(s.session.file(s.session.items[0],false).startsWith('/private-test/p12-recording-lab/'));
 assert(![...s.files.keys()].some(p=>p.startsWith('/private-test/recordings/')));
});
