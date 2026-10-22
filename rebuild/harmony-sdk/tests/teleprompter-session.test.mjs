import test from 'node:test';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
import {loadApp} from './load-app.mjs';import {loadCore} from './load-core.mjs';
const {businessEnvelope}=loadCore('./BusinessCommands'),{readLauncherEnvelope}=loadCore('./LauncherStatus'),{FileMessage,fileMessage,readFileMessage}=loadCore('./FileTransfer');
const peer='aabbccddeeff',settle=()=>new Promise(r=>setImmediate(r));

test('readiness sequence excludes phone resume ACKs, foreign did and repeated running events',async()=>{
 const s=setup();await ready(s);await s.t.control(3);await s.business(3);await s.t.control(4);await s.business(4);
 assert.equal(s.t.deviceResumeSequence,0);await s.t.control(5);await s.business(5);assert.equal(s.t.deviceResumeSequence,0);
 await s.t.control(4);await s.business(4);await s.business(5,{action:1,did:'other'});assert.equal(s.t.deviceResumeSequence,0);
 await s.business(5,{action:1});assert.equal(s.t.deviceResumeSequence,1);await s.business(5,{action:1});assert.equal(s.t.deviceResumeSequence,1);
});
test('observed 119 wire stop advances only from paused; internal reason28 and phone ACK are not readiness',async()=>{
 for(const body of [{action:2,code:1},{action:1,code:28},{action:1,code:13},{action:1,code:25},{action:1,code:30},{action:1,code:1,did:'foreign'}]){
  const s=setup();await ready(s);await s.t.control(3);await s.business(3);await s.t.control(4);await s.business(4);await s.business(6,body);assert.equal(s.t.deviceLocalBackSequence,0);
 }
 const s=setup();await ready(s);await s.t.control(3);await s.business(3);await s.t.control(4);await s.business(4);
 await s.business(6,{action:1,code:1});assert.equal(s.t.deviceLocalBackSequence,1);assert.equal(s.t.deviceLocalBackDid,s.did());assert.equal(s.t.active,false);
 await s.business(6,{action:1,code:1});assert.equal(s.t.deviceLocalBackSequence,1,'duplicate exit cannot create another readiness');
 const failure=setup();await ready(failure);await failure.t.control(3);await failure.business(3);await failure.t.control(4);await failure.business(4);failure.failSave(true);await failure.business(6,{action:1,code:1});assert.equal(failure.t.deviceLocalBackSequence,0);assert(failure.t.active);
 for(const phase of ['running','closing']){const busy=setup();await ready(busy);await busy.t.control(3);await busy.business(3);if(phase==='closing')await busy.t.stop();await busy.business(6,{action:1,code:1});assert.equal(busy.t.deviceLocalBackSequence,0);}
});

test('a submitted teleprompter retains cleanup ownership when the device disconnects',async()=>{
 const s=setup();assert.equal(s.t.canRequestExit,false);await ready(s);assert.equal(s.t.canRequestExit,true);s.disconnect();
 assert.equal(s.t.active,true,'disconnect is not evidence that the glasses exited');
 assert.equal(s.t.canRequestExit,false);s.reconnect('foreign-peer');assert.equal(s.t.canRequestExit,false);s.reconnect();assert.equal(s.t.canRequestExit,true);
 await assert.rejects(s.t.prepare('不得重传',120));
});
test('iOS parity: start carries the same total/checksum/did plus full scroll parameters, not only did/action',async()=>{
 const s=setup(),text=await ready(s);await s.t.control(3);
 const rows=s.sent.filter(x=>x.b===20).map(x=>readLauncherEnvelope(x.p));
 const body=type=>JSON.parse(new TextDecoder().decode(rows.find(x=>x.type===type).json));
 const p=body(2),start=body(3);let hash=2166136261;for(const b of text)hash=Number(((BigInt(hash)^BigInt(b))*16777619n)&0xffffffffn);
 assert.equal(p.checksum,hash.toString(16).padStart(8,'0'));
 for(const key of ['total','checksum','did','scroll','speed','pageOffset','highLightOffset'])assert.equal(start[key],p[key]);
 assert.equal(start.total,text.length);assert.equal(start.scroll,2);
});
function setup(follow,initial=''){let id=0,blockHash,blockSend,connected=true,currentPeer=peer,saved=initial,failSave=false,failType10=false;const timers=new Map(),sent=[],journalAtSend=[];
 const cryptoFramework={createRandom:()=>({generateRandomSync:n=>({data:new Uint8Array(n).fill(9)})}),createMd:()=>{const hash=createHash('md5');return {update:async({data})=>hash.update(data),digest:async()=>{if(blockHash)await blockHash;return {data:Uint8Array.from(hash.digest())};}};}};
 const {TeleprompterSession}=loadApp('TeleprompterSession',{'@kit.CryptoArchitectureKit':{cryptoFramework}},{setTimeout:(f,ms)=>{timers.set(++id,{f,ms});return id;},clearTimeout:id=>timers.delete(id)});
 const t=new TeleprompterSession(async(b,p)=>{if(failType10&&b===20&&readLauncherEnvelope(p).type===10)throw Error('business-type-not-enabled');sent.push({b,p:p.slice()});journalAtSend.push(saved);if(blockSend)await blockSend;},()=>connected?currentPeer:'',()=>true,follow);
 t.initializeCleanup({load:()=>saved,save:raw=>{if(failSave)throw Error('synthetic-persist-failure');saved=raw;}});
 t.connected();
 const did=()=>JSON.parse(new TextDecoder().decode(readLauncherEnvelope(sent.find(s=>s.b===20).p).json)).did;
 const business=async(type,body={},confirmStart=true)=>{t.receive(peer,20,businessEnvelope(type,new TextEncoder().encode(JSON.stringify({did:did(),action:2,code:1,...body}))));await settle();if(type===3&&confirmStart&&t.phase==='starting'){t.receive(peer,20,businessEnvelope(10,new TextEncoder().encode(JSON.stringify({did:did(),action:2,state:1}))));await settle();}};
 const file=async(type,patch={})=>{t.receive(peer,17,fileMessage(Object.assign(new FileMessage(),{type,uuid:did()},patch)));await settle();};
 return {t,sent,timers,did,business,file,journalAtSend,saved:()=>saved,failSave:value=>failSave=value,failType10:value=>failType10=value,hashWait:p=>blockHash=p,sendWait:p=>blockSend=p,disconnect:()=>{connected=false;t.disconnected();},reconnect:(value=peer)=>{connected=true;currentPeer=value;t.connected();}};
}

test('cleanup metadata is durable before the first prepare and before file transfer; no manuscript is stored',async()=>{
 const s=setup();await ready(s,'合成正文不应进入清理账本');
 const first=JSON.parse(s.journalAtSend[0]);assert.equal(first.peer,peer);assert.equal(first.did,s.did());assert.equal(first.fileStarted,false);
 const index=s.sent.findIndex(row=>row.b===17);assert.equal(JSON.parse(s.journalAtSend[index]).fileStarted,true);
 assert(!s.saved().includes('合成正文'));assert.deepEqual(Object.keys(JSON.parse(s.saved())).sort(),['did','evidence','fileStarted','peer','schema']);
});
test('cold restart restores original owner without any automatic transfer, mic or exit, then cleans only that owner',async()=>{
 const s=setup();await ready(s);const did=s.did(),saved=s.saved();s.disconnect();
 const r=setup(undefined,saved);assert.equal(r.t.phase,'cleanup');assert.equal(r.t.active,true);assert.equal(r.sent.length,0);
 await assert.rejects(r.t.prepare('不应重新传稿',120));
 r.t.receive('unrelated',20,businessEnvelope(6,new TextEncoder().encode(JSON.stringify({did,action:2,code:1}))));
 r.t.receive(peer,20,businessEnvelope(6,new TextEncoder().encode(JSON.stringify({did:'b'.repeat(36),action:2,code:1}))));await settle();assert(r.t.active);
 r.t.receive(peer,20,businessEnvelope(2,new TextEncoder().encode(JSON.stringify({did,action:2,code:1}))));await settle();assert.equal(r.sent.length,0);assert.equal(r.t.phase,'cleanup');
 r.reconnect('other-device');assert.equal(await r.t.stopAndWait(),false);assert.equal(r.sent.length,0);assert.throws(()=>r.t.confirmExited(did));
 r.reconnect();await r.t.stop();assert.equal(r.sent.length,2);assert.equal(readFileMessage(r.sent[0].p).uuid,did);assert.equal(readLauncherEnvelope(r.sent[1].p).type,6);
 r.t.receive(peer,20,businessEnvelope(6,new TextEncoder().encode(JSON.stringify({did,action:2,code:1}))));await settle();assert(!r.t.active);assert.equal(JSON.parse(r.saved()).evidence,'device_event');
});
test('explicit physical confirmation is tied to the current original owner and recorded separately from a device ACK',async()=>{
 const s=setup();await ready(s);const did=s.did();s.disconnect();assert.throws(()=>s.t.confirmExited(did));
 s.reconnect();assert.throws(()=>s.t.confirmExited('wrong-id'));assert.equal(s.t.canConfirmExited,true);
 const count=s.sent.length;s.t.confirmExited(did);assert.equal(s.sent.length,count);assert(!s.t.active);assert.equal(JSON.parse(s.saved()).evidence,'user_confirmation');
 assert.throws(()=>s.t.confirmExited(did));
});
test('matching negative stop response settles false immediately and retains owner for explicit recovery',async()=>{
 for(const code of [2,3,5]){
  const s=setup();await ready(s);const saved=s.saved();let result;
  const stop=s.t.stopAndWait().then(value=>result=value);await settle();
  await s.business(6,{code});await settle();
  assert.equal(result,false);await stop;assert.equal(s.t.phase,'error');assert(s.t.active);
  assert.equal(s.saved(),saved);assert(s.t.note.includes(String(code)));assert.equal(s.t.deviceLocalBackSequence,0);
 }
});
test('unsolicited or malformed stop failures cannot replace a live document state',async()=>{
 const s=setup();await ready(s);await s.t.control(3);await s.business(3);
 await s.business(6,{code:2});assert.equal(s.t.phase,'running');
 await s.t.stop();for(const code of [undefined,null,'2',-1,1.5]){await s.business(6,{code});assert.equal(s.t.phase,'closing');}
 await s.business(6,{code:1});assert.equal(s.t.active,false);
});
test('unsettled native exit writes prevent an early physical confirmation and are not replayed after disconnect',async()=>{
 const s=setup();await ready(s);let release;s.sendWait(new Promise(r=>release=r));const pending=s.t.stop();await settle();
 assert.equal(s.t.canConfirmExited,false);assert.throws(()=>s.t.confirmExited(s.did()));const count=s.sent.length;
 s.disconnect();s.reconnect();release();await assert.rejects(pending,/连接已变化/);await settle();assert.equal(s.sent.length,count);assert(s.t.active);
});
test('persist failure blocks new prepare; corrupt or partial metadata cannot be reset to idle',async()=>{
 const s=setup();s.failSave(true);await assert.rejects(s.t.prepare('不能发送',120),/保存失败/);assert.equal(s.sent.length,0);assert(s.t.active);
 for(const raw of ['{broken','null',JSON.stringify({schema:1,peer:'',did:'',fileStarted:false,evidence:'none'}),JSON.stringify({schema:1,peer,did:'wrong',fileStarted:false,evidence:'none'})]){
  const r=setup(undefined,raw);assert(r.t.active);await assert.rejects(r.t.prepare('不能发送',120));assert.equal(await r.t.stopAndWait(),false);assert.equal(r.sent.length,0);assert.equal(r.saved(),raw);
 }
});
test('failed terminal promotion retains the original owner even after a real matching exit packet',async()=>{
 const s=setup();await ready(s);const saved=s.saved();await s.t.stop();s.failSave(true);await s.business(6);
 assert(s.t.active);assert.equal(s.saved(),saved);assert.equal(s.t.canConfirmExited,false);
});
async function prepare(s,text='测试稿件7392',mode=2){await s.t.prepare(text,120,mode);await s.business(2);await s.file(2);return new TextEncoder().encode(text);}
async function ready(s,text='测试稿件7392',mode=2){const bytes=await prepare(s,text,mode);await s.file(3,{size:20480});await s.file(5);await s.business(2,{code:7});assert.equal(s.t.phase,'ready');return bytes;}

test('early start ACK does not permit pause; pending query waits for same-DID running state',async()=>{
 const s=setup();await ready(s);await s.t.control(3);await s.business(3,{},false);
 assert.equal(s.t.phase,'starting');await assert.rejects(s.t.control(4));
 const packets=()=>s.sent.filter(x=>x.b===20).map(x=>readLauncherEnvelope(x.p).type);
 assert.equal(packets().filter(t=>t===10).length,1);assert(!packets().includes(4));
 for(const body of [{state:1,did:'foreign'},{state:1,action:1},{state:'1'},{state:null},{state:1.5}]){await s.business(10,body);assert.equal(s.t.phase,'starting');}
 await s.business(10,{state:4});assert.equal(s.t.phase,'starting');assert(!packets().includes(4));
 await s.business(10,{state:1});assert.equal(s.t.phase,'starting','unsolicited reply during poll interval cannot unlock');
 const timer=[...s.timers.values()].find(x=>x.ms===500);assert(timer);timer.f();await settle();
 await s.business(10,{state:1});assert.equal(s.t.phase,'running');await s.t.control(4);assert.equal(packets().filter(t=>t===4).length,1);
});

test('a rejected start-state query in the countdown cannot cause an immediate exit write',async()=>{
 const s=setup();await ready(s);await s.t.control(3);s.failType10(true);await s.business(3,{},false);await settle();
 assert.equal(s.t.phase,'starting');
 assert(!s.sent.some(x=>x.b===17&&readFileMessage(x.p).type===6));
 const stop=s.t.stop();await settle();
 assert.equal(s.sent.filter(x=>x.b===20&&readLauncherEnvelope(x.p).type===6).length,0);
 const guard=[...s.timers.values()].find(x=>x.ms>=3000&&x.ms<=4000);assert(guard,'start guard timer missing');guard.f();await stop;await settle();
 assert.equal(s.sent.filter(x=>x.b===20&&readLauncherEnvelope(x.p).type===6).length,1);
});
test('late start-query rejection preserves disconnect and timeout recovery state',async()=>{
 for(const ending of ['disconnect','timeout']){
  const s=setup();await ready(s);await s.t.control(3);
  let reject;const pending=new Promise((_,no)=>reject=no);s.sendWait(pending);
  await s.business(3,{},false);assert.equal(s.t.phase,'starting');
  if(ending==='disconnect')s.disconnect();
  else {const [key,timer]=[...s.timers].find(([,x])=>x.ms===10000);s.timers.delete(key);timer.f();}
  const phase=s.t.phase,note=s.t.note,owner=s.saved(),sent=s.sent.length;
  reject(Error('write-failed'));await settle();await settle();
  assert.equal(s.t.phase,phase);assert.equal(s.t.note,note,'stale failure must not replace cleanup instructions');
  assert.equal(s.saved(),owner);assert.equal(s.sent.length,sent);assert(s.t.active);
  assert.equal(s.timers.size,0);
 }
});
test('start query cannot replay on reconnect, after stop, or after its absolute timeout',async()=>{
 for(const ending of ['disconnect','stop','timeout']){
  const s=setup();await ready(s);await s.t.control(3);await s.business(3,{},false);await s.business(10,{state:4});
  const poll=[...s.timers.values()].find(x=>x.ms===500).f;
  if(ending==='disconnect'){s.disconnect();s.reconnect();}
  else if(ending==='stop'){
    const stop=s.t.stop();await settle();
    const guard=[...s.timers.values()].find(x=>x.ms>=3000&&x.ms<=4000);assert(guard,'start guard timer missing');guard.f();await stop;
  }
  else [...s.timers.values()].find(x=>x.ms===10000).f();
  const count=s.sent.length;poll();await settle();await s.business(10,{state:1});
  assert.equal(s.sent.length,count);assert.notEqual(s.t.phase,'running');assert(s.t.active);
 }
});

test('inactive, paused, completed and unknown queried states never pass the start gate',async()=>{
 for(const state of [0,2,3,5,255]){const s=setup();await ready(s);await s.t.control(3);await s.business(3,{},false);await s.business(10,{state});assert.equal(s.t.phase,'error');assert(s.t.active);}
});
test('title ownership callback waits for both complete file and business readiness, once per transfer',async()=>{
 const s=setup(),rows=[];s.t.onCompletedFile=(...args)=>rows.push(args);
 await s.t.prepare('中文正文',120,2,'local','可读标题');await s.business(2);await s.file(2);await s.file(3,{size:20480});await s.file(5);assert.equal(rows.length,0);
 await s.business(2,{code:7});assert.deepEqual(rows,[[peer,s.did(),'可读标题','中文正文',12,2]]);
 await s.business(2,{code:7});assert.equal(rows.length,1);
 const rejected=setup();rejected.t.onCompletedFile=()=>assert.fail('unready file cannot publish a title');await prepare(rejected);await rejected.business(2,{code:0});assert.equal(rejected.t.phase,'error');
});
test('idle catalog traffic is routed without creating or reviving a playback session',async()=>{
 const s=setup(),seen=[];s.t.onListPacket=(...args)=>seen.push(args.slice(0,2));s.t.receive(peer,20,businessEnvelope(1,new TextEncoder().encode('{"action":1,"type":1}')));
 assert.deepEqual(seen,[[peer,20]]);assert.equal(s.t.phase,'idle');assert.equal(s.sent.length,0);await assert.rejects(s.t.prepare('body',120,2,'local','bad\nline'));assert.equal(s.sent.length,0);
});
test('preparation preserves exact UTF-8 and MD5; both file completion and business reply required',async()=>{
 const s=setup(),text=await prepare(s,'  第一行\n第二行😀  '),info=readFileMessage(s.sent.find(x=>x.b===17).p);assert.equal(info.fileSize,text.length);assert.equal(info.md5,createHash('md5').update(text).digest('hex'));
 await s.file(3,{size:20480});const chunk=readFileMessage(s.sent.filter(x=>x.b===17).at(-1).p);assert.deepEqual(chunk.data,text);assert.equal(s.t.progress,100);await assert.rejects(s.t.control(3));
 await s.business(2,{code:7});assert.equal(s.t.phase,'transferring');await s.file(5);assert.equal(s.t.phase,'ready');assert(!s.sent.some(x=>x.b===20&&readLauncherEnvelope(x.p).type===3));
});
test('duplicate prepare code1 is not completion; premature code7 does not start file or playback',async()=>{
 const s=setup();await prepare(s);await s.file(3,{size:20480});await s.file(5);await s.business(2);assert.equal(s.t.phase,'transferring');await assert.rejects(s.t.control(3));
 await s.business(2,{code:7});assert.equal(s.t.phase,'ready');
 const early=setup();await early.t.prepare('提前',120);await early.business(2,{code:7});assert.equal(early.t.phase,'error');assert(!early.sent.some(x=>x.b===17));
});
test('controls wait for matching ACK and speed changes restore running state; eye stop exits with ACK',async()=>{
 const s=setup();await ready(s);await s.t.control(3);assert.equal(s.t.phase,'controlling');await s.business(4);assert.equal(s.t.phase,'controlling');await s.business(3);assert.equal(s.t.phase,'running');
 await s.t.control(7,240);await s.business(7);assert.equal(s.t.phase,'running');await s.t.control(4);await s.business(4);assert.equal(s.t.phase,'paused');await s.t.control(5);await s.business(5);assert.equal(s.t.phase,'running');
 await s.business(8,{action:1,pageOffset:3});assert.equal(s.t.offset,3);await s.business(6,{action:1});assert(!s.t.active);assert.equal(s.timers.size,0);assert.equal(readLauncherEnvelope(s.sent.at(-1).p).type,6);
});
test('premature success, refusal and timeout never unlock start',async()=>{
 for(const mode of ['premature','refused','timeout']){const s=setup();await prepare(s);if(mode==='premature')await s.file(5);if(mode==='refused')await s.business(2,{code:0});if(mode==='timeout')[...s.timers.values()][0].f();assert.equal(s.t.phase,'error');await assert.rejects(s.t.control(3));}
});
test('cancel while digest is pending cannot submit a new prepare or revive transfer',async()=>{
 const s=setup();let release;const wait=new Promise(r=>release=r);s.hashWait(wait);const pending=s.t.prepare('cancel',120);await settle();assert.equal(await s.t.stopAndWait(),true);release();await pending;assert.equal(s.sent.length,0);assert.equal(s.t.phase,'idle');assert.equal(s.timers.size,0);
});
test('disconnect during a chunk write prevents committing progress and stale ready',async()=>{
 const s=setup();await prepare(s);let release;s.sendWait(new Promise(r=>release=r));s.file(3,{size:20480});await settle();s.disconnect();release();await settle();assert.equal(s.t.phase,'cleanup');assert(s.t.active);assert.equal(s.t.progress,0);assert.equal(s.timers.size,0);
});
test('explicit exit cancels file and sends type6, but does not report exited before reply',async()=>{
 const s=setup();await ready(s);await s.t.stop();assert.equal(s.t.phase,'closing');const tail=s.sent.slice(-2);assert.equal(tail[0].b,17);assert.equal(readFileMessage(tail[0].p).type,6);assert.equal(readLauncherEnvelope(tail[1].p).type,6);await s.business(6);assert.equal(s.t.phase,'idle');
});
test('teleprompter uses SmallCore 17 consistently and launcher 18 completion cannot unlock start',async()=>{
 const s=setup();await prepare(s);const info=readFileMessage(s.sent.find(x=>x.b===17).p);assert.equal(info.busId,17);
 const alien=(type,patch={})=>s.t.receive(peer,18,fileMessage(Object.assign(new FileMessage(),{type,uuid:s.did(),...patch})));
 alien(2);alien(3,{size:20480});alien(5);await settle();await s.business(2,{code:7});assert.equal(s.t.phase,'transferring');assert.equal(s.t.progress,0);await assert.rejects(s.t.control(3));
 await s.file(3,{size:20480});await s.file(5);assert.equal(s.t.phase,'ready');await s.t.stop();
 assert(s.sent.filter(x=>x.b!==20).every(x=>x.b===17));await s.business(6);assert.equal(s.t.phase,'idle');
});

test('early eye resume/pause reports never bypass complete file and business readiness',async()=>{
 for(const type of [4,5]){const s=setup();await prepare(s);await s.business(type,{action:1});
  assert.equal(s.t.phase,'transferring');await assert.rejects(s.t.control(3));await assert.rejects(s.t.control(5));
  assert.equal(s.timers.size,1);
 }
});
test('eye pause supersedes pending phone start; late ACK cannot revive running or leave a timeout',async()=>{
 const s=setup();await ready(s);await s.t.control(3);await s.business(4,{action:1});
 assert.equal(s.t.phase,'paused');assert.equal(s.timers.size,0);
 await s.business(3);assert.equal(s.t.phase,'paused');
 await s.t.control(5);await s.business(5);assert.equal(s.t.phase,'running');assert.equal(s.timers.size,0);
});
test('eye pause during speed change survives matching ACK and speed is only changed after confirmation',async()=>{
 const s=setup();await ready(s);await s.t.control(3);await s.business(3);await s.t.control(7,240);
 assert.equal(s.t.speed,120);await s.business(4,{action:1});assert.equal(s.t.phase,'controlling');
 await s.business(7);assert.equal(s.t.phase,'paused');assert.equal(s.t.speed,240);assert.equal(s.timers.size,0);
});
test('rejected speed keeps confirmed value; newer eye speed is not overwritten by an old ACK',async()=>{
 const s=setup();await ready(s);await s.t.control(7,240);await s.business(7,{code:0});assert.equal(s.t.speed,120);assert.equal(s.t.phase,'error');
 const n=setup();await ready(n);await n.t.control(7,240);await n.business(7,{action:1,speed:90});await n.business(7);
 assert.equal(n.t.speed,90);assert.equal(n.t.phase,'ready');assert.equal(n.timers.size,0);
});

function fakeFollow(){return {prepare:async()=>{},begin:async()=>{},opusCalls:0,paused:0,stopped:0,anchors:[],opus(){this.opusCalls++;},pause(){this.paused++;},stop(){this.stopped++;},reanchor(v){this.anchors.push(v);},boundary:v=>Number.isSafeInteger(v)&&v>=0&&v<=30&&v%3===0};}
const audio9=new Uint8Array([8,1,16,9,34,2,4,5]);
test('follow mode is explicit, file gates remain, and binary type9 is not parsed as JSON or routed from another peer',async()=>{
 const follow=fakeFollow(),s=setup(follow);await ready(s,'测试跟随文字内容',1);const prep=JSON.parse(new TextDecoder().decode(readLauncherEnvelope(s.sent[0].p).json));assert.equal(prep.scroll,1);
 s.t.receive(peer,20,audio9);await settle();assert.equal(follow.opusCalls,0);await s.t.control(3);await s.business(3);
 s.t.receive('other-peer',20,audio9);s.t.receive(peer,20,audio9);await settle();assert.equal(follow.opusCalls,1);assert.equal(s.t.phase,'running');assert.equal(s.t.followPackets,1);await assert.rejects(s.t.control(7),/调速/);
 const ordinary=setup();await ready(ordinary);await ordinary.t.control(3);await ordinary.business(3);ordinary.t.receive(peer,20,audio9);await settle();assert.equal(ordinary.t.phase,'running');assert.equal(ordinary.t.followPackets,0);
});
test('position updates coalesce, validate byte boundaries, and a bare ACK never claims an exact displayed position',async()=>{
 const f=fakeFollow(),s=setup(f);await ready(s,'测试跟随文字内容',1);await s.t.control(3);await s.business(3);
 f.onPosition({pageOffset:0,highLightOffset:6});f.onPosition({pageOffset:0,highLightOffset:12});f.onPosition({pageOffset:1,highLightOffset:15});await settle();
 const positions=()=>s.sent.filter(x=>x.b===20&&readLauncherEnvelope(x.p).type===8);assert.equal(positions().length,1);await s.business(8);await settle();assert.equal(s.t.confirmedHighlight,0);assert.equal(s.t.positionReplies,1);assert.equal(positions().length,2);
 await s.business(8,{pageOffset:0,highLightOffset:12});assert.equal(s.t.confirmedHighlight,12);
});
test('exit during ASR preparation cannot submit start, and pause rejects late old position confirmation',async()=>{
 const f=fakeFollow(),s=setup(f);await ready(s,'测试跟随文字内容',1);let release;f.begin=()=>new Promise(r=>release=r);const start=s.t.control(3);await settle();await s.t.stop();release();await assert.rejects(start,/取代/);assert(!s.sent.some(x=>x.b===20&&readLauncherEnvelope(x.p).type===3));await s.business(6);assert.equal(s.t.phase,'idle');
 const other=setup(fakeFollow());await ready(other,'测试跟随文字内容',1);await other.t.control(3);await other.business(3);other.t.follow.onPosition({pageOffset:0,highLightOffset:6});await settle();await other.t.control(4);await other.business(4);await other.business(8,{pageOffset:0,highLightOffset:6});assert.equal(other.t.confirmedHighlight,0);assert.equal(other.t.phase,'paused');
});
test('ASR failure requests real pause and only its matching ACK confirms paused',async()=>{
 const f=fakeFollow(),s=setup(f);await ready(s,'测试跟随文字内容',1);await s.t.control(3);await s.business(3);f.onError('network failed');await settle();assert.equal(s.t.phase,'controlling');assert.equal(s.t.pendingControl,4);assert.equal(s.t.followNote,'network failed');
 await s.business(4);assert.equal(s.t.phase,'paused');assert(f.paused>0);assert(f.stopped===0);
});

test('submitted position echoes do not reanchor; manual backtracking resets accepted progress and rejects mid-byte coordinates',async()=>{
 const f=fakeFollow(),s=setup(f);await ready(s,'测试跟随文字内容测试',1);await s.t.control(3);await s.business(3);
 f.onPosition({pageOffset:12,highLightOffset:24});await settle();await s.business(8,{pageOffset:12,highLightOffset:24});
 await s.business(8,{action:1,pageOffset:12,highLightOffset:24});assert.deepEqual(f.anchors,[]);assert.equal(s.t.confirmedHighlight,24);
 await s.business(8,{action:1,pageOffset:1});assert.equal(s.t.offset,12);assert.deepEqual(f.anchors,[]);
 await s.business(8,{action:1,pageOffset:6});assert.deepEqual(f.anchors,[6]);assert.equal(s.t.confirmedHighlight,0);
 f.onPosition({pageOffset:0,highLightOffset:12});await settle();await s.business(8,{pageOffset:0,highLightOffset:12});assert.equal(s.t.confirmedHighlight,12);
 const before=s.sent.length;f.onPosition({pageOffset:0,highLightOffset:12});await settle();assert.equal(s.sent.length,before);
});

test('position timeout requests pause without claiming a paused device; an old ACK cannot confirm the canceled position',async()=>{
 const f=fakeFollow(),s=setup(f);await ready(s,'测试跟随文字内容',1);await s.t.control(3);await s.business(3);f.onPosition({pageOffset:0,highLightOffset:6});await settle();
 [...s.timers.values()].find(x=>x.ms===5000).f();await settle();assert.equal(s.t.phase,'controlling');assert.equal(s.t.pendingControl,4);assert.match(s.t.followNote,/超时/);
 await s.business(8,{pageOffset:0,highLightOffset:6});assert.equal(s.t.confirmedHighlight,0);await s.business(4);assert.equal(s.t.phase,'paused');
});

test('ASR failure before start acknowledgment and a firmware mode change request exit rather than keep a stale microphone owner',async()=>{
 const f=fakeFollow(),s=setup(f);await ready(s,'测试跟随文字内容',1);await s.t.control(3);f.onError('network failed');await settle();assert.equal(s.t.phase,'closing');
 assert(s.sent.some(x=>x.b===20&&readLauncherEnvelope(x.p).type===6));await s.business(3);assert.equal(s.t.phase,'closing');await s.business(6);assert.equal(s.t.phase,'idle');
 const n=setup(fakeFollow());await ready(n,'测试跟随文字内容',1);await n.t.control(3);await n.business(3);await n.business(7,{action:1,scroll:2});await settle();assert.equal(n.t.phase,'closing');
 const before=n.t.follow.opusCalls;n.t.receive(peer,20,audio9);await settle();assert.equal(n.t.follow.opusCalls,before);await n.business(6);assert.equal(n.t.phase,'idle');
});

test('binary audio during pending ASR readiness stays isolated and a physical pause prevents the delayed phone start',async()=>{
 const f=fakeFollow(),s=setup(f);await ready(s,'测试跟随文字内容',1);let release;f.begin=()=>new Promise(r=>release=r);const start=s.t.control(3);const rejected=assert.rejects(start,/取代/);await settle();
 s.t.receive(peer,20,audio9);await settle();assert.equal(f.opusCalls,1);await s.business(4,{action:1});assert.equal(s.t.phase,'paused');release();await rejected;
 assert(!s.sent.some(x=>x.b===20&&readLauncherEnvelope(x.p).type===3));assert(f.paused>0);
});

test('local follow preflight failure is retryable without sending an unknown document exit to the glasses',async()=>{
 const f=fakeFollow(),s=setup(f);f.prepare=async()=>{throw Error('ASR not configured');};await assert.rejects(s.t.prepare('测试跟随文字内容',120,1),/not configured/);
 assert.equal(s.t.phase,'idle');assert.equal(s.sent.length,0);assert.equal(s.timers.size,0);await ready(s);assert.equal(s.t.phase,'ready');
});

test('a failed prepare write is conservatively considered possibly delivered and still requires device exit confirmation',async()=>{
 const s=setup();let reject;const write=new Promise((_,r)=>reject=r);s.sendWait(write);const pending=s.t.prepare('测试稿件7392',120);const rejected=assert.rejects(pending,/native write failed/);await settle();reject(Error('native write failed'));await rejected;
 assert.equal(s.t.phase,'error');s.sendWait(null);await s.t.stop();assert.equal(s.t.phase,'closing');assert(s.sent.some(x=>x.b===20&&readLauncherEnvelope(x.p).type===6));await s.business(6);assert.equal(s.t.phase,'idle');
});

test('recognition received before start ACK is coalesced and only submitted after the matching running confirmation',async()=>{
 const f=fakeFollow(),s=setup(f);await ready(s,'测试跟随文字内容',1);await s.t.control(3);f.onPosition({pageOffset:0,highLightOffset:6});f.onPosition({pageOffset:0,highLightOffset:12});await settle();
 assert(!s.sent.some(x=>x.b===20&&readLauncherEnvelope(x.p).type===8));await s.business(3);await settle();const positions=s.sent.filter(x=>x.b===20&&readLauncherEnvelope(x.p).type===8);assert.equal(positions.length,1);assert.equal(JSON.parse(new TextDecoder().decode(readLauncherEnvelope(positions[0].p).json)).highLightOffset,12);
});
