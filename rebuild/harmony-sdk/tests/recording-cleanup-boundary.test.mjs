import test from 'node:test';
import assert from 'node:assert/strict';
import {loadApp} from './load-app.mjs';
import {loadCore} from './load-core.mjs';
const {businessEnvelope}=loadCore('./BusinessCommands'),{readLauncherEnvelope}=loadCore('./LauncherStatus');
const peer='recording-peer-a',other='recording-peer-b',root='/capture-test',cleanupPath=root+'/recording-cleanup.json';
const settle=async()=>{for(let i=0;i<30;i++)await Promise.resolve();};
function fixture(initial=new Map()){
 const files=initial,dirs=new Set([root]),handles=new Map(),timers=new Map(),sent=[],blocked=[];let fd=0,random=0,timer=0,current=peer,deferType=-1,failSave=false,ended=0;
 for(const path of files.keys()){let directory=path.slice(0,path.lastIndexOf('/'));while(directory.startsWith(root)){dirs.add(directory);directory=directory.slice(0,directory.lastIndexOf('/'));}}
 const io={OpenMode:{CREATE:1,READ_WRITE:2,WRITE_ONLY:4,TRUNC:8},WhenceType:{SEEK_SET:0},
  accessSync:p=>files.has(p)||dirs.has(p),mkdirSync:p=>dirs.add(p),
  listFileSync:p=>[...dirs,...files.keys()].filter(d=>d.startsWith(p+'/')&&!d.slice(p.length+1).includes('/')).map(d=>d.slice(p.length+1)),
  openSync:(path,flags)=>{if(!files.has(path))files.set(path,new Uint8Array());if(flags&8)files.set(path,new Uint8Array());const h={fd:++fd,path,pos:0};handles.set(fd,h);return h;},
  closeSync:f=>handles.delete(typeof f==='number'?f:f.fd),lseek:(f,p)=>{handles.get(f).pos=p;return p;},
  writeSync:(f,b)=>{const h=handles.get(f),data=new Uint8Array(b),old=files.get(h.path),out=new Uint8Array(Math.max(old.length,h.pos+data.length));out.set(old);out.set(data,h.pos);h.pos+=data.length;files.set(h.path,out);return data.length;},
  readSync:(f,b,o={})=>{const h=handles.get(f),data=files.get(h.path),n=Math.min(o.length??b.byteLength,data.length-h.pos);new Uint8Array(b).set(data.slice(h.pos,h.pos+n));h.pos+=n;return n;},
  fsyncSync:()=>{},statSync:p=>({size:files.get(typeof p==='number'?handles.get(p).path:p).length}),readTextSync:p=>new TextDecoder().decode(files.get(p)),
  renameSync:(a,b)=>{if(failSave&&b===cleanupPath)throw Error('synthetic-cleanup-save');files.set(b,files.get(a));files.delete(a);},
  unlinkSync:p=>files.delete(p),rmdirSync:p=>dirs.delete(p)};
 const globals={setTimeout:(f,ms)=>{timers.set(++timer,{f,ms});return timer;},clearTimeout:i=>timers.delete(i)};
 const platform={'@kit.AbilityKit':{},'@kit.CoreFileKit':{fileIo:io},'@kit.CryptoArchitectureKit':{cryptoFramework:{createRandom:()=>({generateRandomSync:n=>({data:new Uint8Array(n).fill(++random)})})}},'libturbo_audio.so':{recordingReset(){},recordingClose(){},recordingDecode:()=>new Uint8Array(1280).buffer}};
 const {RecordingSession}=loadApp('RecordingSession',platform,globals);
 const sender=async(b,p)=>{const e=readLauncherEnvelope(p),entry={business:b,type:e.type,body:JSON.parse(new TextDecoder().decode(e.json))};sent.push(entry);if(e.type===deferType)await new Promise((resolve,reject)=>blocked.push({resolve,reject}));};
 const session=new RecordingSession(sender,()=>current,()=>true);session.initialize({filesDir:root});session.onSessionEnded=()=>ended++;
 const feed=async(type,j,b=[])=>{const prefix=businessEnvelope(type,new TextEncoder().encode(JSON.stringify(j))),n=b.length;const packet=Uint8Array.from([...prefix,...(n?[34,...(n>127?[n%128|128,Math.floor(n/128)]:[n]),...b]:[])]);session.receive(current,packet);await settle();};
 return {session,files,sent,blocked,timers,feed,ended:()=>ended,connect:p=>current=p,defer:t=>deferType=t,failSave:v=>failSave=v,
  id:()=>sent.filter(s=>s.type===1&&s.body.action===1).at(-1)?.body.uuid,
  fire:ms=>{for(const [id,t]of [...timers])if(t.ms===ms){timers.delete(id);t.f();}},
  drain:async()=>{for(let i=0;i<12;i++){for(const [id,t]of [...timers])if(t.ms===0||t.ms===1000){timers.delete(id);t.f();}await settle();}}};
}
test('capture debt is durable before recording start and stores only identity and exit evidence',async()=>{
 const s=fixture();s.defer(1);const start=s.session.start();await settle();
 assert(s.session.occupied);assert(s.session.cleanupRequired);assert(s.session.pendingWrites);assert(s.session.cleanupSessionId);
 const record=JSON.parse(new TextDecoder().decode(s.files.get(cleanupPath)));
 assert.equal(record.uuid,s.id());assert.equal(record.peer,peer);assert.equal(record.evidence,'none');
 assert.deepEqual(Object.keys(record).sort(),['evidence','id','peer','schema','uuid']);
 s.blocked.shift().resolve();await start;
});
test('start and tail timeout close local files while preserving unknown device occupancy',async()=>{
 for(const kind of ['start','tail']){const s=fixture();await s.session.start();if(kind==='tail')await s.session.stop();s.fire(kind==='start'?10000:30000);await settle();
  assert(!s.session.active);assert(s.session.cleanupRequired);assert(s.session.occupied);assert.equal(s.ended(),0);await assert.rejects(s.session.start(),/退出|清理/);}
});
test('restart restores unresolved peer and id without sending or opening capture',async()=>{
 const s=fixture();await s.session.start();const id=s.session.cleanupSessionId;s.connect('');s.session.disconnected();
 const restored=fixture(s.files);assert(restored.session.occupied);assert(restored.session.cleanupRequired);assert.equal(restored.session.cleanupSessionId,id);assert(!restored.session.active);assert.equal(restored.sent.length,0);
 await assert.rejects(restored.session.start(),/退出|清理/);
});
test('missing cleanup is first use; empty, partial, malformed and unknown schema fail closed',async()=>{
 assert.equal(fixture().session.occupied,false);
 for(const [path,text]of [[cleanupPath,''],[cleanupPath+'.partial','{}'],[cleanupPath,'{'],[cleanupPath,'{"schema":2}']]){
  const s=fixture(new Map([[path,new TextEncoder().encode(text)]]));assert(s.session.cleanupRequired);assert(s.session.occupied);assert(!s.session.canConfirmExited);await assert.rejects(s.session.start());assert.equal(s.sent.length,0);
 }
});
test('failed debt save submits no start and retains blocked cleanup state',async()=>{
 const s=fixture();s.failSave(true);await assert.rejects(s.session.start(),/记录|清理/);assert(s.session.occupied);assert(s.session.cleanupRequired);assert(!s.sent.some(p=>p.type===1));assert(!s.session.canConfirmExited);
});
test('manual exit requires original connected peer, current id and all native writes settled',async()=>{
 const s=fixture();await s.session.start();const id=s.session.cleanupSessionId;s.defer(4);const stop=s.session.stop();await settle();
 assert(s.session.pendingWrites);assert(!s.session.canConfirmExited);assert.throws(()=>s.session.confirmExited(id));
 s.blocked.shift().resolve();await stop;s.fire(30000);await settle();s.connect(other);assert(!s.session.canConfirmExited);assert.throws(()=>s.session.confirmExited(id));
 s.connect(peer);assert(s.session.canConfirmExited);assert.throws(()=>s.session.confirmExited('stale-id'));s.session.confirmExited(id);assert(!s.session.occupied);assert.equal(s.ended(),1);
 assert.equal(JSON.parse(new TextDecoder().decode(s.files.get(cleanupPath))).evidence,'user_confirmation');assert(!fixture(s.files).session.occupied);
});
test('explicit cleanup after restart sends only a stop for the retained uuid to its original peer',async()=>{
 const s=fixture();await s.session.start();const uuid=s.id();s.session.disconnected();const r=fixture(s.files);r.connect(other);await assert.rejects(r.session.stop());assert.equal(r.sent.length,0);
 r.connect(peer);await r.session.stop();assert.deepEqual(r.sent.map(x=>x.type),[4]);assert.equal(r.sent[0].body.uuid,uuid);assert(r.session.cleanupRequired);
 await r.feed(6,{uuid,completed:true});assert(!r.session.occupied);
});
test('uuid-less firmware completion after restart requires a submitted stop on this connection',async()=>{
 const s=fixture();await s.session.start();s.session.disconnected();const r=fixture(s.files);await r.feed(5,{uuid:'',state:3});assert(r.session.cleanupRequired);
 await r.session.stop();await r.feed(5,{uuid:'',state:3});assert(!r.session.occupied);assert.equal(r.ended(),1);
});
test('completed restored cleanup cancels its old watchdog and stale callback cannot fail the next capture',async()=>{
 const s=fixture();await s.session.start();s.session.disconnected();const r=fixture(s.files);await r.session.stop();const watchdog=[...r.timers.values()].find(t=>t.ms===30000);
 await r.feed(6,{uuid:s.id(),completed:true});assert(!r.session.occupied);await r.session.start();const next=r.session.cleanupSessionId;watchdog.f();
 assert(r.session.active);assert.equal(r.session.cleanupSessionId,next);assert(r.session.occupied);
});
test('uuid-less prior completion cannot end a new capture before its current stop handshake',async()=>{
 const s=fixture();await s.session.start();await s.feed(3,{uuid:s.id(),offset:0},new Uint8Array(240).fill(7));
 await s.feed(5,{uuid:'',state:3});assert(s.session.active);assert(s.session.cleanupRequired);
 await s.session.stop();await s.feed(5,{uuid:'',state:3});await s.drain();assert(!s.session.occupied);assert(s.session.items[0].complete);
});
const unrelatedCompletionStatuses=[
 {uuid:'other-recording',state:3,action:2,mode:1},
 {uuid:'',state:3,action:1,mode:1},
 {uuid:'',state:3,action:2,mode:2},
 {uuid:'',state:3,action:'2',mode:1},
 {uuid:'',state:3,action:2,mode:'1'},
 {state:3,action:2,mode:1},
 {uuid:null,state:3,action:2,mode:1}
];
test('completion status ignores an explicit foreign identity or incompatible command before sealing the current recording',async()=>{
 const s=fixture();await s.session.start();const uuid=s.id();
 await s.feed(3,{uuid,offset:0},new Uint8Array(240).fill(7));await s.session.stop();
 const original=s.files.get(cleanupPath).slice();
 for(const status of unrelatedCompletionStatuses){
  await s.feed(5,status);await s.drain();assert(s.session.active,JSON.stringify(status));assert(s.session.cleanupRequired);
  assert.equal(s.ended(),0);assert.deepEqual(s.files.get(cleanupPath),original);
 }
 await s.feed(5,{uuid,state:3,action:2,mode:1});await s.drain();
 assert(!s.session.occupied);assert(s.session.items[0].complete);assert.equal(s.ended(),1);
});
test('completion status ignores foreign or incompatible fields during restored cleanup and still accepts the legacy empty UUID',async()=>{
 const s=fixture();await s.session.start();s.session.disconnected();const r=fixture(s.files);await r.session.stop();
 const original=r.files.get(cleanupPath).slice();
 for(const status of unrelatedCompletionStatuses){
  await r.feed(5,status);assert(r.session.cleanupRequired,JSON.stringify(status));assert(r.session.occupied);
  assert.equal(r.ended(),0);assert.deepEqual(r.files.get(cleanupPath),original);
 }
 await r.feed(5,{uuid:'',state:3});assert(!r.session.occupied);assert.equal(r.ended(),1);
});

test('queued native stop survives fail as occupied and old continuation cannot mutate a new session',async()=>{
 const s=fixture();await s.session.start();s.defer(4);const old=s.session.stop();await settle();s.connect('');s.session.disconnected();s.connect(peer);
 assert(s.session.pendingWrites);assert(s.session.occupied);await assert.rejects(s.session.start(),/退出|清理|发送/);
 s.blocked.shift().resolve();await old;assert(s.session.cleanupRequired);assert(s.session.canConfirmExited);const oldId=s.session.cleanupSessionId;s.session.confirmExited(oldId);
 s.defer(-1);await s.session.start();const next=s.session.cleanupSessionId;assert.notEqual(next,oldId);assert(s.session.active);assert(s.session.occupied);assert.equal(s.session.stopping,false);
});
test('old stop rejection after disconnect preserves original debt without changing a newer attempt',async()=>{
 const s=fixture();await s.session.start();s.defer(4);const old=s.session.stop();await settle();s.session.disconnected();s.blocked.shift().reject(Error('synthetic-late-stop'));await assert.rejects(old);
 assert(s.session.cleanupRequired);assert(!s.session.pendingWrites);assert(s.session.occupied);assert.equal(s.ended(),0);
});
test('matching device completion is distinct from local sealing and unrelated completion cannot clear debt',async()=>{
 const s=fixture();await s.session.start();const uuid=s.id();await s.feed(3,{uuid,offset:0},new Uint8Array(240).fill(7));await s.feed(6,{uuid:'foreign',completed:true});assert(s.session.cleanupRequired);
 await s.feed(6,{uuid,completed:true});await s.drain();assert(!s.session.occupied);assert(!s.session.cleanupRequired);assert(s.session.items[0].complete);assert.equal(s.ended(),1);
 assert.equal(JSON.parse(new TextDecoder().decode(s.files.get(cleanupPath))).evidence,'device_event');
});
test('pending stop plus device completion cannot release shared entry until native drain',async()=>{
 const s=fixture();await s.session.start();s.defer(4);const stop=s.session.stop();await settle();await s.feed(3,{uuid:s.id(),offset:0},new Uint8Array(240).fill(7));await s.feed(6,{uuid:s.id(),completed:true});await s.drain();
 assert(!s.session.active);assert(s.session.occupied);assert(s.session.cleanupRequired);assert.equal(s.ended(),0);assert(!s.session.canConfirmExited);
 assert.equal(JSON.parse(new TextDecoder().decode(s.files.get(cleanupPath))).evidence,'none');assert(fixture(s.files).session.cleanupRequired,'cold restart must retain debt until native drain');
 s.blocked.shift().resolve();await stop;assert(!s.session.occupied);assert.equal(s.ended(),1);
});
test('disconnect invalidates volatile exit evidence while pending native cleanup remains unresolved',async()=>{
 const s=fixture();await s.session.start();s.defer(4);const stop=s.session.stop();await settle();await s.feed(3,{uuid:s.id(),offset:0},new Uint8Array(240).fill(7));await s.feed(6,{uuid:s.id(),completed:true});await s.drain();
 s.connect('');s.session.disconnected();s.connect(peer);s.blocked.shift().resolve();await stop;assert(s.session.cleanupRequired);assert(s.session.occupied);assert.equal(s.ended(),0);
 assert.equal(JSON.parse(new TextDecoder().decode(s.files.get(cleanupPath))).evidence,'none');
});
test('stop UI wait expires independently while native write and durable cleanup stay occupied',async()=>{
 const s=fixture();await s.session.start();s.defer(4);const stop=s.session.stop();const rejected=assert.rejects(stop,/10 秒|未确认/);await settle();s.fire(10000);await rejected;
 assert(s.session.pendingWrites);assert(s.session.cleanupRequired);assert(s.session.occupied);assert(!s.session.active);assert(!s.session.canConfirmExited);assert.equal(s.ended(),0);
 s.blocked.shift().resolve();await settle();assert(!s.session.pendingWrites);assert(s.session.cleanupRequired);assert(s.session.canConfirmExited);
});
test('cleanup terminal save failure keeps occupancy despite real completion',async()=>{
 const s=fixture();await s.session.start();s.failSave(true);await s.feed(3,{uuid:s.id(),offset:0},new Uint8Array(240).fill(7));await s.feed(6,{uuid:s.id(),completed:true});await s.drain();
 assert(s.session.occupied);assert(s.session.cleanupRequired);assert(!s.session.canConfirmExited);assert.equal(s.ended(),0);
});

const ownedOptions=(overrides={})=>({ownerId:'voice-'+ 'a'.repeat(32),maxDurationMs:15000,guard:async()=>{},current:()=>true,reserved:()=>{},...overrides});
test('owned capture binds its source before microphone submission and keeps existing close/end callbacks',async()=>{
 const s=fixture();let reserved,closed;
 s.session.onRecordingClosed=(directory,raw,created)=>{closed={directory,raw,created};};
 const h=await s.session.startOwned(ownedOptions({reserved:value=>{
  reserved=value;assert(!s.sent.some(x=>x.type===1));assert.equal(JSON.parse(new TextDecoder().decode(s.files.get(cleanupPath))).uuid,value.uuid);
 }}));
 assert.deepEqual(h,reserved);assert.notEqual(h,reserved);assert.equal(h.cleanupId,s.session.cleanupSessionId);assert.equal(h.peer,peer);
 assert.equal(h.uuid,s.id());assert(s.files.has(h.directory+'/source.rawopus'));assert([...s.timers.values()].some(t=>t.ms===15000));assert(![...s.timers.values()].some(t=>t.ms===600000));
 await s.feed(3,{uuid:h.uuid,offset:0},new Uint8Array(240).fill(7));await s.session.stopOwned(h);await s.feed(6,{uuid:h.uuid,completed:true});await s.drain();
 assert.equal(closed.directory,h.directory);assert.equal(closed.raw,h.directory+'/source.rawopus');assert(Number.isSafeInteger(closed.created));assert.equal(s.ended(),1);
 assert(s.session.items[0].complete);assert.equal(JSON.parse(new TextDecoder().decode(s.files.get(cleanupPath))).evidence,'device_event');
});
test('invalid owned input does not enable recording or reserve files',async()=>{
 for(const options of [ownedOptions({ownerId:'bad owner'}),ownedOptions({maxDurationMs:0}),ownedOptions({maxDurationMs:30001}),ownedOptions({maxDurationMs:NaN}),ownedOptions({guard:null}),ownedOptions({current:null}),ownedOptions({reserved:null})]){
  const s=fixture();await assert.rejects(s.session.startOwned(options),/OWNER_OPTIONS/);assert.equal(s.sent.length,0);assert(!s.session.occupied);
 }
});
test('owned configuration is captured once and caller mutation cannot change the owner or duration',async()=>{
 const s=fixture();let release;const options=ownedOptions({guard:()=>new Promise(resolve=>{release=resolve;})});
 const pending=s.session.startOwned(options);await settle();options.ownerId='other';options.maxDurationMs=30000;
 release();await settle();release();const h=await pending;assert.equal(h.ownerId,'voice-'+ 'a'.repeat(32));assert([...s.timers.values()].some(t=>t.ms===15000));
 s.session.disconnected();
});
test('expired or cancelled task guards before handoff and after foreground write never start the microphone',async()=>{
 for(const stage of ['before','handoff','foreground']){
  const s=fixture();let cancelled=stage==='before',release;
  const options=ownedOptions({guard:async()=>{if(cancelled)throw Error('TASK_EXPIRED');}});
  if(stage==='handoff')s.session.beforeStart=()=>new Promise(resolve=>{release=resolve;});
  if(stage==='foreground')s.defer(14);
  const pending=s.session.startOwned(options),rejected=assert.rejects(pending,/TASK_EXPIRED/);await settle();
  if(stage!=='before'){cancelled=true;if(stage==='handoff')release();else s.blocked.shift().resolve();}
  await rejected;assert(!s.sent.some(x=>x.type===1));assert(!s.session.cleanupRequired);assert(!s.session.occupied);
 }
});
test('owned deadline during native start drain latches exactly one stop for that source',async()=>{
 const s=fixture();s.defer(1);let h;
 const pending=s.session.startOwned(ownedOptions({reserved:value=>{h=value;}}));await settle();
 await s.feed(1,{uuid:h.uuid,action:2,code:1});s.fire(15000);await settle();
 assert.equal(s.sent.filter(x=>x.type===4).length,0);assert(s.session.pendingWrites);assert(s.session.cleanupRequired);
 await s.session.stopOwned(h);assert.equal(s.sent.filter(x=>x.type===4).length,0);
 s.blocked.shift().resolve();await pending;await settle();assert.equal(s.sent.filter(x=>x.type===4).length,1);assert.equal(s.sent.at(-1).body.uuid,h.uuid);
 await s.session.stopOwned(h);assert.equal(s.sent.filter(x=>x.type===4).length,1);assert(s.session.cleanupRequired);
});
test('start ACK timeout preserves the owned stop obligation even if its longer capture timer is cancelled',async()=>{
 const s=fixture();s.defer(1);let h;
 const pending=s.session.startOwned(ownedOptions({reserved:value=>{h=value;}}));await settle();s.fire(10000);await settle();
 assert(!s.session.active);assert(s.session.pendingWrites);assert(s.session.cleanupRequired);assert.equal(s.sent.filter(x=>x.type===4).length,0);
 s.blocked.shift().resolve();await pending;await settle();assert.equal(s.sent.filter(x=>x.type===4).length,1);assert.equal(s.sent.at(-1).body.uuid,h.uuid);assert(s.session.cleanupRequired);
});
test('every owned identity field is checked; modified handles never send a stop',async()=>{
 const s=fixture(),h=await s.session.startOwned(ownedOptions());
 for(const [key,value]of [['ownerId','other'],['cleanupId','b'.repeat(32)],['uuid','other'],['directory','/other'],['peer',other],['connectionEpoch',h.connectionEpoch+1]]){
  await assert.rejects(s.session.stopOwned({...h,[key]:value}),/OWNER_CHANGED/);
 }
 assert.equal(s.sent.filter(x=>x.type===4).length,0);await s.session.stopOwned(h);assert.equal(s.sent.filter(x=>x.type===4).length,1);
});
test('old owner and deadline cannot stop the next ordinary recording or change its ten minute limit',async()=>{
 const s=fixture(),h=await s.session.startOwned(ownedOptions()),oldTimer=[...s.timers.values()].find(t=>t.ms===15000);
 await s.feed(3,{uuid:h.uuid,offset:0},new Uint8Array(240).fill(7));await s.feed(6,{uuid:h.uuid,completed:true});await s.drain();
 await s.session.start();const next=s.id(),before=s.sent.length;assert.notEqual(next,h.uuid);oldTimer.f();await settle();
 await assert.rejects(s.session.stopOwned(h),/OWNER_CHANGED/);assert.equal(s.sent.length,before);assert(s.session.active);assert([...s.timers.values()].some(t=>t.ms===600000));
});
test('old owned handle is not reauthorized by reconnect or a cold restored cleanup record',async()=>{
 const s=fixture(),h=await s.session.startOwned(ownedOptions()),timer=[...s.timers.values()].find(t=>t.ms===15000);
 s.session.disconnected();const before=s.sent.length;timer.f();await settle();await assert.rejects(s.session.stopOwned(h),/OWNER_CHANGED/);assert.equal(s.sent.length,before);assert(s.session.cleanupRequired);
 const restored=fixture(s.files);await assert.rejects(restored.session.stopOwned(h),/OWNER_CHANGED/);assert.equal(restored.sent.length,0);assert(restored.session.cleanupRequired);
 // The existing, explicit recovery path can still stop the original UUID.
 await restored.session.stop();assert.equal(restored.sent.at(-1).body.uuid,h.uuid);
});
test('synchronous disconnect in changed callback blocks the owned native start after write bookkeeping',async()=>{
 const s=fixture();let interrupted=false;
 s.session.changed=()=>{if(!interrupted&&s.session.active&&s.session.pendingWrites){interrupted=true;s.session.disconnected();}};
 await assert.rejects(s.session.startOwned(ownedOptions()),/OWNER_CHANGED/);assert(interrupted);assert(!s.sent.some(x=>x.type===1));assert(s.session.cleanupRequired);
});
test('a physical recording accepted while the task guard waits is never adopted or stopped by that task',async()=>{
 const s=fixture();let guards=0,release,reserved=false;
 const pending=s.session.startOwned(ownedOptions({guard:async()=>{if(++guards===2)await new Promise(resolve=>{release=resolve;});},reserved:()=>{reserved=true;}}));
 const rejected=assert.rejects(pending,/清理|录音/);await settle();assert(release);
 await s.feed(1,{uuid:'physical-recording',action:1});assert(s.session.active);release();await rejected;
 assert(!reserved);assert.equal(s.sent.filter(x=>x.type===1&&x.body.action===1).length,0);assert.equal(s.sent.filter(x=>x.type===4).length,0);
 assert.equal(JSON.parse(new TextDecoder().decode(s.files.get(cleanupPath))).uuid,'physical-recording');assert(s.session.active);
});
test('source association failure submits no microphone start and preserves cleanup rather than inventing exit',async()=>{
 const s=fixture();await assert.rejects(s.session.startOwned(ownedOptions({reserved:()=>{throw Error('SOURCE_BINDING_SAVE_FAILED');}})),/SOURCE_BINDING_SAVE_FAILED/);
 assert(!s.sent.some(x=>x.type===1));assert(s.session.cleanupRequired);assert(!s.session.active);assert.equal(JSON.parse(new TextDecoder().decode(s.files.get(cleanupPath))).evidence,'none');
});
test('failed owned stop is surfaced once, keeps the original source and does not automatically retry',async()=>{
 const s=fixture(),h=await s.session.startOwned(ownedOptions());s.defer(4);const pending=s.session.stopOwned(h),rejected=assert.rejects(pending,/synthetic-stop-failed/);await settle();
 s.blocked.shift().reject(Error('synthetic-stop-failed'));await rejected;await settle();assert.equal(s.sent.filter(x=>x.type===4).length,1);assert(s.session.cleanupRequired);assert(s.files.has(h.directory+'/source.rawopus'));
});
test('start write rejection with or without a prior device ACK stops only its possibly opened microphone',async()=>{
 for(const ack of [false,true]){
  const s=fixture();s.defer(1);let h;
  const pending=s.session.startOwned(ownedOptions({reserved:value=>{h=value;}})),rejected=assert.rejects(pending,/synthetic-start-failed/);await settle();
  if(ack)await s.feed(1,{uuid:h.uuid,action:2,code:1});
  s.blocked.shift().reject(Error('synthetic-start-failed'));await rejected;await settle();
  assert.equal(s.sent.filter(x=>x.type===4).length,1);assert.equal(s.sent.at(-1).body.uuid,h.uuid);assert(s.session.cleanupRequired);assert(s.files.has(h.directory+'/source.rawopus'));
 }
});
test('receiver failure after an owned start retains a stop obligation instead of just cancelling its deadline',async()=>{
 const s=fixture(),h=await s.session.startOwned(ownedOptions());await s.feed(1,{uuid:h.uuid,action:2,code:1});
 await s.feed(3,{uuid:h.uuid,offset:-1},new Uint8Array(240).fill(7));await settle();
 assert.equal(s.sent.filter(x=>x.type===4).length,1);assert.equal(s.sent.at(-1).body.uuid,h.uuid);assert(s.session.cleanupRequired);
});
test('final synchronous authorization detects cancellation during source reservation before any microphone write',async()=>{
 const s=fixture();let cancelled=false;
 await assert.rejects(s.session.startOwned(ownedOptions({guard:async()=>{if(cancelled)throw Error('TASK_CANCELLED');},current:()=>!cancelled,reserved:()=>{cancelled=true;}})),/OWNER_CANCELLED/);
 assert(!s.sent.some(x=>x.type===1||x.type===4));assert(s.session.cleanupRequired);
});
test('final authorization callback cannot silently disconnect and still submit the owned start',async()=>{
 const s=fixture();await assert.rejects(s.session.startOwned(ownedOptions({current:()=>{s.session.disconnected();return true;}})),/OWNER_CHANGED/);
 assert(!s.sent.some(x=>x.type===1||x.type===4));assert(s.session.cleanupRequired);
});
test('an old ACK deadline cannot erase the next recording timer or defeat its matching ACK',async()=>{
 const s=fixture(),h=await s.session.startOwned(ownedOptions()),oldDeadline=[...s.timers.values()].find(t=>t.ms===10000);
 await s.feed(3,{uuid:h.uuid,offset:0},new Uint8Array(240).fill(7));await s.feed(6,{uuid:h.uuid,completed:true});await s.drain();
 await s.session.start();const next=s.id(),newDeadline=[...s.timers.entries()].find(([,t])=>t.ms===10000);assert(newDeadline);
 oldDeadline.f();await s.feed(1,{uuid:next,action:2,code:1});assert(!s.timers.has(newDeadline[0]));
 newDeadline[1].f();assert(s.session.active);assert(!s.session.starting);assert.equal(JSON.parse(new TextDecoder().decode(s.files.get(cleanupPath))).uuid,next);
});
test('cold owned cleanup preserves exact source exit evidence without reviving capture authority or fabricating WAV',async()=>{
 for(const evidence of ['device_event','user_confirmation']){
  const s=fixture(),h=await s.session.startOwned(ownedOptions());await s.feed(3,{uuid:h.uuid,offset:0},new Uint8Array(240).fill(7));s.session.disconnected();
  const path=h.directory+'/manifest.json',before=JSON.parse(new TextDecoder().decode(s.files.get(path))),raw=s.files.get(h.directory+'/source.rawopus').slice();
  const cold=fixture(s.files);await assert.rejects(cold.session.stopOwned(h),/OWNER_CHANGED/);await cold.session.stop();
  if(evidence==='device_event')await cold.feed(6,{uuid:h.uuid,completed:true});else cold.session.confirmExited(h.cleanupId);
  assert(!cold.session.cleanupRequired);const after=JSON.parse(new TextDecoder().decode(cold.files.get(path)));
  assert.equal(after.voice_exit_evidence,evidence);assert.deepEqual(after.coverage,before.coverage);assert.equal(after.valid,false);assert.equal(after.wavReady,false);
  assert.deepEqual(cold.files.get(h.directory+'/source.rawopus'),raw);assert(!cold.files.has(h.directory+'/audio.wav'));
 }
});
