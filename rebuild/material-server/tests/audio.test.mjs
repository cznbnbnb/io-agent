import test from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {randomUUID} from 'node:crypto';import {spawnSync,spawn} from 'node:child_process';import net from 'node:net';import {once} from 'node:events';import {DatabaseSync} from 'node:sqlite';
import {fileURLToPath} from 'node:url';
import {MaterialStore} from '../store.mjs';import {listen} from '../http.mjs';import {sha} from '../json.mjs';
import {AUDIO_PART_BYTES as PART,AUDIO_RETENTION_MS as TTL,AUDIO_MAX_BYTES} from '../audio.mjs';
const epoch=Date.parse('2026-10-24T03:00:00Z');
const sample=JSON.parse(fs.readFileSync(new URL('../../../docs/contracts/material-v1.1.json',import.meta.url))).events[2];
const error=code=>e=>e.code===code;
function event(id='audio-material',revision=1){const e=structuredClone(sample);Object.assign(e,{event_id:randomUUID(),idempotency_key:randomUUID(),producer_id:'phone',created_at:new Date(epoch).toISOString(),expires_at:new Date(epoch+3600000).toISOString()});Object.assign(e.body,{material_id:id,revision,base_revision:revision-1,text_revision:1});return e;}
function fixture(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'io-audio-')),file=path.join(dir,'test.sqlite');let now=epoch,store=new MaterialStore(file,{clock:()=>now});
 const mint=(scopes=['audio:write','audio:read'],owner='owner',producer='phone')=>store.mint({owner,producer,scopes,ttlMs:86400000});
 const text=mint(['materials:write','materials:read','changes:read']);store.submit(text.token,event());const audio=mint();
 t.after(()=>{store.close();fs.rmSync(dir,{recursive:true,force:true});});
 return {dir,file,text,audio,mint,get store(){return store;},get now(){return now;},time(n){now=n;},restart(){store.close();store=new MaterialStore(file,{clock:()=>now});}};
}
function plan(bytes=Buffer.from('synthetic-private-audio-bytes'.repeat(12000)),overrides={}){return {bytes,value:{material_id:'audio-material',material_revision:1,kind:'raw',media_type:'application/vnd.turboio.lifelog-archive',bytes:bytes.length,sha256:sha(bytes),capture:{first_received_at:new Date(epoch-2000).toISOString(),last_received_at:new Date(epoch).toISOString(),recording_complete:false},...overrides}};}
function part(p,i){const bytes=p.bytes.subarray(i*PART,(i+1)*PART);return {data:bytes.toString('base64'),sha256:sha(bytes)};}
function stage(f,p=plan()){const a=f.store.audio.begin(f.audio.token,p.value);for(let i=0;i<a.parts;i++)f.store.audio.put(f.audio.token,a.object_id,i,part(p,i));return a.object_id;}
function complete(f,p=plan()){return f.store.audio.finalize(f.audio.token,stage(f,p));}

test('resumes exact parts across restart, hashes complete bytes and keeps a fixed receipt despite lost replies',t=>{
 const f=fixture(t),p=plan(),a=f.store.audio.begin(f.audio.token,p.value),id=a.object_id;
 assert.equal(a.storage_verified,false);assert.equal(a.stored_at,null);assert.equal(a.expires_at,null);
 assert.throws(()=>f.store.audio.get(f.audio.token,id),error('AUDIO_NOT_STORED'));
 f.store.audio.put(f.audio.token,id,0,part(p,0));f.restart();assert.deepEqual(f.store.audio.status(f.audio.token,id).received,[0]);assert.throws(()=>f.store.audio.finalize(f.audio.token,id),error('AUDIO_INCOMPLETE'));
 for(let i=0;i<a.parts;i++)f.store.audio.put(f.audio.token,id,i,part(p,i));f.time(epoch+5000);const receipt=f.store.audio.finalize(f.audio.token,id);
 assert.equal(receipt.storage_verified,true);assert.equal(receipt.recording_completeness_verified,false);assert.equal(Date.parse(receipt.expires_at),epoch+5000+TTL);assert.equal(f.store.ceiling('owner'),1);
 f.restart();f.time(epoch+10000);assert.deepEqual(f.store.audio.finalize(f.audio.token,id),receipt);assert.deepEqual(f.store.audio.begin(f.audio.token,p.value).expires_at,receipt.expires_at);
 const bytes=Buffer.concat(Array.from({length:a.parts},(_,i)=>Buffer.from(f.store.audio.content(f.audio.token,id,i).data,'base64')));assert.deepEqual(bytes,p.bytes);
});

test('text credentials and paired devices never gain audio scopes; owner, producer, expiry and revocation enforced',t=>{
 const f=fixture(t),p=plan();assert.throws(()=>f.store.audio.begin(f.text.token,p.value),error('FORBIDDEN'));
 const paired=f.store.devices.enroll({owner:'owner',role:'phone',label:'synthetic phone'});assert(!paired.scopes.includes('audio:write'));assert.throws(()=>f.store.audio.begin(paired.token,p.value),error('FORBIDDEN'));
 const id=stage(f,p);const other=f.mint(undefined,'owner','other'),foreign=f.mint(undefined,'foreign');
 assert.throws(()=>f.store.audio.status(other.token,id),error('AUDIO_NOT_FOUND'));assert.throws(()=>f.store.audio.get(foreign.token,id),error('AUDIO_NOT_FOUND'));assert.throws(()=>f.store.audio.begin(other.token,p.value),error('AUDIO_PRODUCER_CONFLICT'));
 f.store.audio.finalize(f.audio.token,id);const reader=f.mint(['audio:read']);assert.equal(f.store.audio.get(reader.token,id).object_id,id);assert.throws(()=>f.store.audio.put(reader.token,id,0,part(p,0)),error('FORBIDDEN'));
 f.store.revoke(reader.token_id);assert.throws(()=>f.store.audio.content(reader.token,id,0),error('UNAUTHENTICATED'));f.time(epoch+86400000);assert.throws(()=>f.store.audio.get(f.audio.token,id),error('UNAUTHENTICATED'));
});

test('duration starts only at verified commit; staged expiry permits a clean retry but cannot renew stored audio',t=>{
 const f=fixture(t),p=plan(),a=f.store.audio.begin(f.audio.token,p.value);f.store.audio.put(f.audio.token,a.object_id,0,part(p,0));f.time(epoch+86400000);
 const fresh=f.mint();assert.throws(()=>f.store.audio.status(fresh.token,a.object_id),error('AUDIO_UPLOAD_EXPIRED'));assert.equal(f.store.audio.prune().parts,1);
 const retry=f.store.audio.begin(fresh.token,p.value);assert.deepEqual(retry.received,[]);assert.equal(retry.expires_at,null);
 for(let i=0;i<retry.parts;i++)f.store.audio.put(fresh.token,retry.object_id,i,part(p,i));const done=f.store.audio.finalize(fresh.token,retry.object_id);assert.equal(Date.parse(done.expires_at),f.now+TTL);
 f.time(f.now+TTL-1);const access=f.mint();assert.equal(f.store.audio.get(access.token,retry.object_id).state,'stored');f.time(f.now+1);
 assert.throws(()=>f.store.audio.content(access.token,retry.object_id,0),error('AUDIO_EXPIRED'));assert.throws(()=>f.store.audio.begin(access.token,p.value),error('AUDIO_EXPIRED'));assert.equal(f.store.audio.prune().parts,retry.parts);
 assert.equal(f.store.audio.list(access.token,'audio-material').objects[0].storage_verified,false);assert.equal(f.store.audio.list(access.token,'audio-material').objects[0].state,'expired');
});

test('expired payload cells are cleared from the separate database; text, revisions and ordinary backups remain intact',async t=>{
 const f=fixture(t),p=plan(),receipt=complete(f,p);const before=f.store.get(f.text.token,'audio-material');const backup=path.join(f.dir,'text-backup.sqlite');await f.store.backupTo(backup);
 const b=new DatabaseSync(backup,{readOnly:true});assert(!b.prepare("SELECT name FROM sqlite_master WHERE name='audio_parts'").get());b.close();assert(!fs.readFileSync(backup).includes(p.bytes.subarray(0,100)));
 assert(fs.readFileSync(f.file+'.audio.sqlite').includes(p.bytes.subarray(0,100)));f.time(epoch+TTL);assert(f.store.audio.prune().parts>0);f.restart();const fresh=f.mint(['materials:read']);assert.deepEqual(f.store.get(fresh.token,'audio-material'),before);
 assert(!fs.readFileSync(f.file+'.audio.sqlite').includes(p.bytes.subarray(0,100)));assert(!fs.existsSync(f.file+'.audio.sqlite-wal'));assert(!fs.existsSync(f.file+'.audio.sqlite-journal'));
 const read=f.mint(['audio:read']);assert.throws(()=>f.store.audio.get(read.token,receipt.object_id),error('AUDIO_EXPIRED'));assert.equal(f.store.ceiling('owner'),1);
});

test('material tombstone immediately blocks all audio reads and delayed finalization, then cleanup removes payloads',t=>{
 const f=fixture(t),done=complete(f),pending=stage(f,plan(Buffer.from('pending'))),del=event('audio-material',2);del.body.operation='delete';del.body.full_text.text='';del.body.utterances=[];f.store.submit(f.text.token,del);
 for(const read of [()=>f.store.audio.get(f.audio.token,done.object_id),()=>f.store.audio.content(f.audio.token,done.object_id,0),()=>f.store.audio.list(f.audio.token,'audio-material'),()=>f.store.audio.finalize(f.audio.token,pending)])assert.throws(read,error('MATERIAL_DELETED'));
 assert(f.store.audio.prune().parts>0);assert.equal(f.store.audio.db.prepare('SELECT COUNT(*) n FROM audio_parts').get().n,0);f.restart();assert.throws(()=>f.store.audio.begin(f.audio.token,plan().value),error('MATERIAL_DELETED'));
});

test('missing source head is unavailable, not an authoritative deletion or permission to destroy retained audio',t=>{
 const f=fixture(t),done=complete(f);f.store.db.prepare('DELETE FROM materials WHERE owner=? AND id=?').run('owner','audio-material');
 assert.throws(()=>f.store.audio.get(f.audio.token,done.object_id),error('MATERIAL_NOT_FOUND'));assert.equal(f.store.audio.prune().parts,0);assert(f.store.audio.db.prepare('SELECT COUNT(*) n FROM audio_parts').get().n>0);
 f.store.db.prepare('INSERT INTO materials VALUES (?,?,?,?)').run('owner','audio-material',1,0);assert.equal(f.store.audio.get(f.audio.token,done.object_id).storage_verified,true);
});

test('invalid or conflicting blocks, manifest changes and whole-object digest mismatch never issue a storage receipt',t=>{
 const f=fixture(t),p=plan(Buffer.from('small fixture')),a=f.store.audio.begin(f.audio.token,p.value),id=a.object_id;
 for(const value of [{...part(p,0),sha256:'0'.repeat(64)},{...part(p,0),data:part(p,0).data+'\n'},{data:'',sha256:sha('')}])assert.throws(()=>f.store.audio.put(f.audio.token,id,0,value),error('INVALID_AUDIO_PART'));
 f.store.audio.put(f.audio.token,id,0,part(p,0));const wrong=plan(Buffer.alloc(p.bytes.length,65));assert.throws(()=>f.store.audio.put(f.audio.token,id,0,part(wrong,0)),error('AUDIO_PART_CONFLICT'));assert.throws(()=>f.store.audio.begin(f.audio.token,{...p.value,material_revision:2}),error('MATERIAL_NOT_FOUND'));
 assert.throws(()=>f.store.audio.begin(f.audio.token,{...p.value,capture:{...p.value.capture,recording_complete:true}}),error('AUDIO_MANIFEST_CONFLICT'));
 const bad=plan(Buffer.from('mismatch'),{sha256:'1'.repeat(64)}),badid=stage(f,bad);assert.throws(()=>f.store.audio.finalize(f.audio.token,badid),error('AUDIO_HASH_MISMATCH'));assert.equal(f.store.audio.status(f.audio.token,badid).storage_verified,false);
 f.store.audio.db.prepare('UPDATE audio_parts SET data=? WHERE object_id=?').run(Buffer.alloc(p.bytes.length),id);assert.throws(()=>f.store.audio.finalize(f.audio.token,id),error('AUDIO_PART_CORRUPT'));
});

test('reservation quota counts declared bytes without allocating entire files',t=>{
 const f=fixture(t);for(let i=0;i<4;i++)f.store.audio.begin(f.audio.token,plan(Buffer.from('x'),{bytes:AUDIO_MAX_BYTES,sha256:String(i).repeat(64)}).value);
 assert.throws(()=>f.store.audio.begin(f.audio.token,plan(Buffer.from('x'),{bytes:1,sha256:'5'.repeat(64)}).value),error('AUDIO_BUDGET'));assert.equal(f.store.audio.db.prepare('SELECT COUNT(*) n FROM audio_parts').get().n,0);
});

test('independent processes lose a commit or its reply; recovery yields exactly one fixed storage instant',t=>{
 const f=fixture(t),p=plan(),id=stage(f,p),input=path.join(f.dir,'input.json');fs.writeFileSync(input,JSON.stringify({token:f.audio.token,id,now:f.now}),{mode:0o600});
 for(const [mode,status] of [['before',73],['after',74]]){const child=spawnSync(process.execPath,[fileURLToPath(new URL('./audio-worker.mjs',import.meta.url)),f.file,input,mode],{encoding:'utf8'});assert.equal(child.status,status,child.stderr);f.restart();const s=f.store.audio.status(f.audio.token,id);assert.equal(s.storage_verified,mode==='after');}
 const fixed=f.store.audio.get(f.audio.token,id);f.time(f.now+100);assert.deepEqual(f.store.audio.finalize(f.audio.token,id),fixed);
});

test('real HTTP uploads, chunked download and cursor listing preserve hashes and reject ambiguous or unauthorized requests',async t=>{
 const f=fixture(t),server=await listen(f.store);t.after(()=>new Promise(r=>server.close(r)));const base=`http://127.0.0.1:${server.address().port}/v1/`;
 const call=(route,body,token=f.audio.token)=>fetch(base+route,{method:body===undefined?'GET':'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
 const p=plan(),start=await call('audio-uploads',p.value);assert.equal(start.status,200);const a=await start.json();assert.equal((await call('audio-uploads',p.value,f.text.token)).status,403);
 for(let i=0;i<a.parts;i++)assert.equal((await call(`audio-uploads/${a.object_id}/parts/${i}`,part(p,i))).status,200);
 assert.equal((await call(`audio-uploads/${a.object_id}/finalize`,{unknown:true})).status,400);const ack=await (await call(`audio-uploads/${a.object_id}/finalize`,{})).json();assert.equal(ack.storage_verified,true);
 const pieces=[];for(let i=0;i<a.parts;i++){const chunk=await (await call(`audio/${a.object_id}?index=${i}`)).json();assert.equal(sha(Buffer.from(chunk.data,'base64')),chunk.part_sha256);pieces.push(Buffer.from(chunk.data,'base64'));}assert.deepEqual(Buffer.concat(pieces),p.bytes);
 complete(f,plan(Buffer.from('second')));complete(f,plan(Buffer.from('third')));const ids=[];let after='';do{const page=await (await call('material-audio/audio-material?limit=1'+(after?'&after='+after:''))).json();ids.push(...page.objects.map(x=>x.object_id));after=page.next_after;}while(after);assert.equal(new Set(ids).size,3);
 for(const route of [`audio/${a.object_id}?index=0&index=1`,`audio/${a.object_id}?token=bad`,'material-audio/audio-material?limit=0','material-audio/audio-material?limit=0x10','material-audio/audio-material?limit=1e1'])assert.equal((await call(route)).status,400);
 assert((await (await call('identity',undefined,f.text.token)).json()).capabilities.includes('audio_archive_v1'));
});


test('running CLI prunes expired audio on its real default timer without a client access or process restart',{timeout:75000},async t=>{
 const f=fixture(t),done=complete(f),expiry=Date.now()+1500;
 f.store.audio.db.prepare('UPDATE audio_objects SET expires=? WHERE object_id=?').run(expiry,done.object_id);
 const portServer=net.createServer();portServer.listen(0,'127.0.0.1');await once(portServer,'listening');const port=portServer.address().port;await new Promise(r=>portServer.close(r));
 const child=spawn(process.execPath,[fileURLToPath(new URL('../cli.mjs',import.meta.url)),'serve','--db',f.file,'--port',String(port)],{stdio:['ignore','pipe','pipe']});let stderr='';child.stderr.on('data',x=>{stderr=(stderr+x).slice(-8192);});const ended=once(child,'exit');
 try{
  await Promise.race([once(child.stdout,'data'),ended.then(()=>{throw Error('CLI_EXITED '+stderr);})]);assert.equal(child.exitCode,null);
  assert.equal(f.store.audio.db.prepare('SELECT state FROM audio_objects WHERE object_id=?').get(done.object_id).state,'stored');
  const until=Date.now()+67000;let state;
  do{await new Promise(r=>setTimeout(r,1000));assert.equal(child.exitCode,null,stderr);state=f.store.audio.db.prepare('SELECT state FROM audio_objects WHERE object_id=?').get(done.object_id).state;}while(state==='stored'&&Date.now()<until);
  assert.equal(state,'expired');assert.equal(f.store.audio.db.prepare('SELECT COUNT(*) n FROM audio_parts').get().n,0);assert.equal(f.store.ceiling('owner'),1);
 }finally{if(child.exitCode===null)child.kill('SIGTERM');await ended;}
});


test('unavailable or foreign audio side database does not take text or agent service down',async t=>{
 const f=fixture(t);complete(f);f.store.audio.db.prepare("UPDATE binding SET server_id='foreign-server'").run();f.restart();assert.equal(f.store.audio,null);assert.equal(f.store.audioUnavailable,true);
 assert.equal(f.store.get(f.text.token,'audio-material').body.material_id,'audio-material');assert(!f.store.identity(f.text.token).capabilities.includes('audio_archive_v1'));
 const server=await listen(f.store);try{const response=await fetch(`http://127.0.0.1:${server.address().port}/v1/audio-uploads`,{method:'POST',headers:{Authorization:'Bearer '+f.audio.token,'Content-Type':'application/json'},body:JSON.stringify(plan().value)});assert.equal(response.status,503);assert.equal((await response.json()).error.code,'AUDIO_UNAVAILABLE');}finally{await new Promise(r=>server.close(r));}
 const retained=new DatabaseSync(f.file+'.audio.sqlite');assert.equal(retained.prepare('SELECT server_id FROM binding').get().server_id,'foreign-server');assert(retained.prepare('SELECT COUNT(*) n FROM audio_parts').get().n>0);retained.close();
});
