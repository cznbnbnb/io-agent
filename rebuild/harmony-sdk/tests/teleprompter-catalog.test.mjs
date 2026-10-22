import test from 'node:test';import assert from 'node:assert/strict';
import {loadApp} from './load-app.mjs';import {loadCore} from './load-core.mjs';
const {businessEnvelope}=loadCore('./BusinessCommands'),{readLauncherEnvelope}=loadCore('./LauncherStatus');
const peer='aabbccddeeff',first='11111111-1111-4111-8111-111111111111',second='22222222-2222-4222-8222-222222222222';
function setup(){
 const files=new Map(),fds=new Map(),writes=[];let count=0,renameFails=false,sendWait;
 const io={accessSync:p=>files.has(p),statSync:p=>({size:files.get(p)?.length??0}),readTextSync:p=>new TextDecoder().decode(files.get(p)),
  openSync:p=>{files.set(p,new Uint8Array());fds.set(++count,p);return {fd:count};},writeSync:(fd,b)=>{const p=fds.get(fd),bytes=new Uint8Array(b),n=Math.min(bytes.length,7),old=files.get(p),next=new Uint8Array(old.length+n);next.set(old);next.set(bytes.slice(0,n),old.length);files.set(p,next);return n;},fsyncSync(){},closeSync(){},renameSync:(a,b)=>{if(renameFails)throw Error('FS_FAILURE');files.set(b,files.get(a));files.delete(a);},OpenMode:{CREATE:1,WRITE_ONLY:2,TRUNC:4}};
 const {TeleprompterCatalog}=loadApp('TeleprompterCatalog',{'@kit.CoreFileKit':{fileIo:io}});
 const make=()=>new TeleprompterCatalog(async(b,p)=>{writes.push({b,p:p.slice()});if(sendWait)await sendWait;},()=>peer);
 const catalog=make();catalog.initialize({filesDir:'/own'});
 return {catalog,make,files,writes,io,failRename:()=>renameFails=true,wait:p=>sendWait=p,body:i=>JSON.parse(new TextDecoder().decode(readLauncherEnvelope(writes[i].p).json))};
}
test('incremental type3 separates inventory and chunk counts and emits no full-sync command',async()=>{
 const s=setup(),text='中文😀',bytes=new TextEncoder().encode(text).length;
 await s.catalog.addCompleted(peer,first,'中文标题',text,bytes,2);await s.catalog.addCompleted(peer,second,'下一篇',text,bytes,1);
 assert.equal(s.writes[0].b,20);assert.equal(readLauncherEnvelope(s.writes[0].p).type,1);
 const body=s.body(1);assert.equal(body.action,2);assert.equal(body.type,3);assert.equal(body.total,2);assert.deepEqual(body.chunkinfo,{chunkid:1,total:1,islast:true});assert.equal(body.items.length,1);
 assert.equal(body.items[0].did,second);assert.equal(body.items[0].total,bytes);assert.equal(body.items[0].scroll,1);assert.equal(body.items[0].preview,text);assert.equal(body.items[0].title,'下一篇');
 assert(Math.abs(body.items[0].timestamp-Math.floor(Date.now()/1000))<=1);assert.equal(body.items[0].timezone,-new Date().getTimezoneOffset()*60);
 assert.match(s.catalog.note,/已提交/);assert.match(s.catalog.note,/待确认/);
 const restored=s.make();restored.initialize({filesDir:'/own'});await assert.rejects(restored.addCompleted(peer,first,'rename',text,bytes,2));assert.equal(s.writes.length,2);
});
test('persistence failure, wrong peer, byte mismatch and malformed ownership prevent sending',async()=>{
 for(const kind of ['disk','peer','bytes','did','title']){
  const s=setup();if(kind==='disk')s.failRename();
  await assert.rejects(s.catalog.addCompleted(kind==='peer'?'other':peer,kind==='did'?'unowned-file':first,kind==='title'?'bad\nline':'标题','正文',kind==='bytes'?1:6,2));assert.equal(s.writes.length,0);
 }
 const s=setup();s.files.set('/own/prompter-owned-catalog.json',new TextEncoder().encode('{broken'));
 const restored=s.make();assert.throws(()=>restored.initialize({filesDir:'/own'}));await assert.rejects(restored.addCompleted(peer,first,'标题','正文',6,2));assert.equal(s.writes.length,0);
});
test('uncorrelated FullSync/retry/complete observations never trigger replay or declare display',async()=>{
 const s=setup();await s.catalog.addCompleted(peer,first,'标题','正文',6,2);
 for(const type of [1,2,3,4]){const p=businessEnvelope(1,new TextEncoder().encode(JSON.stringify({action:1,type,chunkid:1}))),copy=p.slice();s.catalog.receive(peer,20,p);assert.deepEqual(p,copy);assert.equal(s.writes.length,1);}
 assert.match(s.catalog.note,/异常/);const note=s.catalog.note;
 s.catalog.receive('other',20,businessEnvelope(1,new TextEncoder().encode('{"action":1,"type":3}')));assert.equal(s.catalog.note,note);
 assert.doesNotThrow(()=>s.catalog.receive(peer,20,new Uint8Array([255])));
});
test('disconnect during a native write preserves owned proof but ignores late write completion',async()=>{
 const s=setup();let release;s.wait(new Promise(r=>release=r));const pending=s.catalog.addCompleted(peer,first,'标题','正文',6,2);
 assert(s.files.has('/own/prompter-owned-catalog.json'));s.catalog.disconnect();release();await pending;assert.equal(s.catalog.note,'');assert.equal(s.writes.length,1);
});
test('catalog refuses an eighth owned row even when addCompleted is called directly',async()=>{
 const s=setup(),text='正文',bytes=6;
 for(let i=0;i<7;i++){const id=String(i).padStart(8,'0')+'-0000-4000-8000-'+String(i).padStart(12,'0');await s.catalog.addCompleted(peer,id,'标题'+i,text,bytes,2);}
 const eighth='99999999-9999-4999-8999-999999999999';
 await assert.rejects(s.catalog.addCompleted(peer,eighth,'第八','正文',bytes,2),/CATALOG_UNCONFIRMED/);
 assert.equal(s.writes.length,7);
});
test('a rejected overlapping add cannot release the active native write owner',async()=>{
 const s=setup();let release;s.wait(new Promise(r=>release=r));const pending=s.catalog.addCompleted(peer,first,'标题','正文',6,2);
 await assert.rejects(s.catalog.addCompleted(peer,second,'next','正文',6,2));await assert.rejects(s.catalog.addCompleted(peer,second,'again','正文',6,2));assert.equal(s.writes.length,1);
 release();await pending;await s.catalog.addCompleted(peer,second,'after','正文',6,2);assert.equal(s.writes.length,2);
});
test('an inaccessible existing catalog is not treated as an empty file or overwritten',async()=>{
 const s=setup();await s.catalog.addCompleted(peer,first,'保留标题','正文',6,2);const before=s.files.get('/own/prompter-owned-catalog.json').slice();
 s.io.accessSync=()=>{throw {code:13900001};};const blocked=s.make();assert.throws(()=>blocked.initialize({filesDir:'/own'}));await assert.rejects(blocked.addCompleted(peer,second,'new','正文',6,2));
 assert.deepEqual(s.files.get('/own/prompter-owned-catalog.json'),before);assert.equal(s.writes.length,1);
 const missing=setup();missing.io.accessSync=()=>{throw {code:13900002};};const fresh=missing.make();fresh.initialize({filesDir:'/own'});await fresh.addCompleted(peer,first,'首篇','正文',6,2);assert.equal(missing.writes.length,1);
});
