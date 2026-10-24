import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {randomUUID,createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {MaterialStore} from '../store.mjs';
import {AUDIO_RETENTION_MS as TTL} from '../audio.mjs';
import {expireAudioFile} from '../audio-expiry.mjs';

const sha=x=>createHash('sha256').update(x).digest('hex');
const sample=JSON.parse(fs.readFileSync(new URL('../../../docs/contracts/material-v1.1.json',import.meta.url))).events[2];
function fixture(t){
  const dir=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'io-audio-expiry-'))),file=path.join(dir,'synthetic.sqlite');
  let now=Date.now();const store=new MaterialStore(file,{clock:()=>now});
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const text=store.mint({owner:'synthetic-expiry',producer:'phone',scopes:['materials:write'],ttlMs:86400000});
  const e=structuredClone(sample);Object.assign(e,{event_id:randomUUID(),idempotency_key:randomUUID(),producer_id:'phone',created_at:new Date(now).toISOString(),expires_at:new Date(now+3600000).toISOString()});store.submit(text.token,e);
  const audio=store.mint({owner:'synthetic-expiry',producer:'phone',scopes:['audio:write'],ttlMs:86400000});
  const serverId=store.identity(text.token).server_id;
  const add=(name,done=true)=>{
    const bytes=Buffer.from(('synthetic-'+name+'-private-expiry-marker-').repeat(200)),manifest={material_id:e.body.material_id,material_revision:e.body.revision,kind:'raw',media_type:'application/vnd.turboio.lifelog-archive',bytes:bytes.length,sha256:sha(bytes),capture:{first_received_at:new Date(now-1000).toISOString(),last_received_at:new Date(now).toISOString(),recording_complete:false}};
    const token=now<Date.now()-86400000?audio.token:store.mint({owner:'synthetic-expiry',producer:'phone',scopes:['audio:write'],ttlMs:86400000}).token;
    const pending=store.audio.begin(token,manifest);store.audio.put(token,pending.object_id,0,{data:bytes.toString('base64'),sha256:sha(bytes)});
    const receipt=done?store.audio.finalize(token,pending.object_id):pending;return {bytes,receipt};
  };
  const future=add('future');now=Date.now()-TTL-10000;const expired=add('expired'),abandoned=add('abandoned',false);
  store.close();
  return {dir,file,audioFile:file+'.audio.sqlite',serverId,expired,abandoned,future};
}
function inspect(f){const db=new DatabaseSync(f.audioFile,{readOnly:true});try{return {rows:db.prepare('SELECT object_id,state,stored_at,expires FROM audio_objects ORDER BY object_id').all(),parts:db.prepare('SELECT object_id,COUNT(*) n FROM audio_parts GROUP BY object_id').all()};}finally{db.close();}}

test('independent process expires only due audio with text database absent; secure deletion and fixed receipts survive repeat',t=>{
  const f=fixture(t),saved=f.file+'.retained-text',before=sha(fs.readFileSync(f.file));fs.renameSync(f.file,saved);
  const run=()=>spawnSync(process.execPath,[fileURLToPath(new URL('../audio-expiry.mjs',import.meta.url)),'--db',f.audioFile,'--server-id',f.serverId],{encoding:'utf8'});
  const r=run();assert.equal(r.status,0,r.stderr);assert.equal(JSON.parse(r.stdout).objects,2);assert.equal(JSON.parse(r.stdout).parts,2);
  const state=inspect(f),row=id=>state.rows.find(x=>x.object_id===id);
  assert.equal(row(f.expired.receipt.object_id).state,'expired');assert.equal(row(f.abandoned.receipt.object_id).state,'abandoned');assert.equal(row(f.future.receipt.object_id).state,'stored');
  assert.equal(row(f.expired.receipt.object_id).expires,Date.parse(f.expired.receipt.expires_at));assert.equal(row(f.future.receipt.object_id).expires,Date.parse(f.future.receipt.expires_at));
  assert.deepEqual(state.parts.map(p=>p.object_id),[f.future.receipt.object_id]);
  assert(!fs.readFileSync(f.audioFile).includes(f.expired.bytes.subarray(0,100)));assert(fs.readFileSync(f.audioFile).includes(f.future.bytes.subarray(0,100)));
  assert.equal(sha(fs.readFileSync(saved)),before);assert(!fs.existsSync(f.file));assert.equal(run().status,0);assert.equal(JSON.parse(run().stdout).objects,0);assert.deepEqual(inspect(f),state);
});

test('missing, foreign, unsupported and linked databases never create or change payload storage',t=>{
  const f=fixture(t),before=sha(fs.readFileSync(f.audioFile));
  const missing=path.join(f.dir,'missing.audio.sqlite');assert.equal(expireAudioFile(missing,f.serverId).absent,true);assert(!fs.existsSync(missing));
  assert.throws(()=>expireAudioFile(f.audioFile,'foreign-server'),/AUDIO_SERVER_MISMATCH/);assert.equal(sha(fs.readFileSync(f.audioFile)),before);
  const link=path.join(f.dir,'linked.audio.sqlite');fs.symlinkSync(f.audioFile,link);assert.throws(()=>expireAudioFile(link,f.serverId),/AUDIO_EXPIRY_PATH/);
  fs.linkSync(f.audioFile,path.join(f.dir,'hardlink'));assert.throws(()=>expireAudioFile(f.audioFile,f.serverId),/AUDIO_EXPIRY_PATH/);fs.unlinkSync(path.join(f.dir,'hardlink'));
  fs.symlinkSync(f.audioFile,f.audioFile+'-journal');assert.throws(()=>expireAudioFile(f.audioFile,f.serverId),/AUDIO_EXPIRY_PATH/);fs.unlinkSync(f.audioFile+'-journal');assert.equal(sha(fs.readFileSync(f.audioFile)),before);
  const unknown=path.join(f.dir,'unknown.audio.sqlite'),db=new DatabaseSync(unknown);db.exec('CREATE TABLE keep(value TEXT); INSERT INTO keep VALUES (\'retained\');');db.close();const old=sha(fs.readFileSync(unknown));assert.throws(()=>expireAudioFile(unknown,f.serverId),/AUDIO_DATABASE_UNRECOGNIZED/);assert.equal(sha(fs.readFileSync(unknown)),old);
  const future=new DatabaseSync(f.audioFile);future.exec('PRAGMA user_version=2;');future.close();const changed=sha(fs.readFileSync(f.audioFile));assert.throws(()=>expireAudioFile(f.audioFile,f.serverId),/AUDIO_DATABASE_UNRECOGNIZED/);assert.equal(sha(fs.readFileSync(f.audioFile)),changed);
});

test('process exits on either side of expiry commit recover atomically without deadline renewal',t=>{
  for(const [mode,code] of [['before',85],['after',86]]){
    const f=fixture(t),prior=inspect(f),r=spawnSync(process.execPath,[fileURLToPath(new URL('./audio-expiry-worker.mjs',import.meta.url)),f.audioFile,f.serverId,mode],{encoding:'utf8'});assert.equal(r.status,code,r.stderr);
    if(mode==='before')assert.deepEqual(inspect(f),prior);
    else assert.equal(inspect(f).rows.find(x=>x.object_id===f.expired.receipt.object_id).state,'expired');
    const result=expireAudioFile(f.audioFile,f.serverId);assert.equal(result.objects,mode==='before'?2:0);assert.equal(inspect(f).rows.find(x=>x.object_id===f.expired.receipt.object_id).expires,Date.parse(f.expired.receipt.expires_at));
  }
});
