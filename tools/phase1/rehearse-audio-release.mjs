// Isolated five-process release rehearsal. Never accepts an existing database,
// grant or deployment path. Independent cleaner is copied outside switched code.
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';import {DatabaseSync} from 'node:sqlite';
import {parseArgs} from 'node:util';import assert from 'node:assert/strict';

const {values:a}=parseArgs({options:{baseline:{type:'string'},candidate:{type:'string'},out:{type:'string'},phase:{type:'string'},work:{type:'string'}}});
const sha=x=>createHash('sha256').update(x).digest('hex'),self=fileURLToPath(import.meta.url);
const phases=['seed','upgrade','rollback','expiry','resume'];
const runtime=['store.mjs','http.mjs','json.mjs','validation.mjs','cli.mjs','traffic.mjs','devices.mjs','material-transfer.mjs','audio.mjs','audio-expiry.mjs','package.json','package-lock.json','.node-version','admin/index.html','admin/app.js','admin/style.css'];
const files=runtime.map(n=>'rebuild/material-server/'+n).concat(['event-v1.schema.json','event-v1.1.schema.json','event-v1.2.schema.json'].map(n=>'docs/contracts/'+n));
const sourceHashes=root=>Object.fromEntries(files.map(n=>[n,fs.existsSync(path.join(root,n))?sha(fs.readFileSync(path.join(root,n))):null]));
const read=p=>JSON.parse(fs.readFileSync(p)),save=(p,v)=>fs.writeFileSync(p,JSON.stringify(v),{mode:0o600});

if(!a.phase){
  assert(a.baseline&&a.candidate&&a.out&&!a.work);assert(/^v22\./.test(process.version));
  const baseline=fs.realpathSync(a.baseline),candidate=fs.realpathSync(a.candidate);assert.notEqual(baseline,candidate);
  const before={baseline:sourceHashes(baseline),candidate:sourceHashes(candidate)};
  for(const name of files){assert(before.candidate[name]);assert(name.endsWith('/audio.mjs')||name.endsWith('/audio-expiry.mjs')?before.baseline[name]===null:before.baseline[name]);}
  const work=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'io-audio-release-')));fs.chmodSync(work,0o700);
  try{
    fs.mkdirSync(path.join(work,'stable-expiry'));fs.copyFileSync(path.join(candidate,'rebuild/material-server/audio-expiry.mjs'),path.join(work,'stable-expiry/audio-expiry.mjs'));
    const results=[];
    for(const phase of phases){const r=JSON.parse(execFileSync(process.execPath,[self,'--phase',phase,'--baseline',baseline,'--candidate',candidate,'--work',work],{encoding:'utf8',timeout:45000,maxBuffer:1048576,stdio:['ignore','pipe','pipe']}));assert.equal(r.passed,true);assert.equal(r.phase,phase);results.push(r);}
    assert.deepEqual({baseline:sourceHashes(baseline),candidate:sourceHashes(candidate)},before);
    fs.rmSync(work,{recursive:true});
    const report={schema:1,at:new Date().toISOString(),node:process.version,passed:true,scope:'Five independent processes; synthetic HTTP/SQLite upgrade, code rollback, standalone expiry while old service runs, then resume. No production or phone access.',production_changed:false,phone_accessed:false,rehearsal_sha256:sha(fs.readFileSync(self)),sources:before,phases:results,temporary_data_removed:true};save(path.resolve(a.out),report);console.log(JSON.stringify(report));
  }finally{if(fs.existsSync(work))fs.rmSync(work,{recursive:true});}
}else{
  assert(phases.includes(a.phase)&&a.work&&!a.out);
  const work=fs.realpathSync(a.work);assert(path.dirname(work)===fs.realpathSync(os.tmpdir())&&path.basename(work).startsWith('io-audio-release-'));
  const root=['seed','rollback','expiry'].includes(a.phase)?a.baseline:a.candidate;
  const {MaterialStore}=await import(pathToFileURL(path.join(root,'rebuild/material-server/store.mjs'))),{listen}=await import(pathToFileURL(path.join(root,'rebuild/material-server/http.mjs')));
  const file=path.join(work,'synthetic.sqlite'),fixture=path.join(work,'fixture.json'),checks=[];
  let f=a.phase==='seed'?null:read(fixture),now=f?.epoch??Date.now()-72*3600000-10000;
  if(a.phase==='resume')now=Date.now();
  const store=new MaterialStore(file,{clock:()=>now});let server;
  try{
    if(a.phase==='seed'){
      const writer=store.mint({owner:'synthetic-audio-release',producer:'phone',scopes:['materials:write','materials:read','changes:read'],ttlMs:86400000});
      const e=structuredClone(read(path.join(a.candidate,'docs/contracts/material-v1.2.json')).events.find(e=>e.body.revision===1&&e.body.operation==='upsert'));
      Object.assign(e,{event_id:randomUUID(),idempotency_key:randomUUID(),producer_id:'phone',created_at:new Date(now).toISOString(),expires_at:new Date(now+3600000).toISOString()});assert.equal(store.submit(writer.token,e).status,201);
      await store.backupTo(path.join(work,'ordinary-text-backup.sqlite'));
      f={epoch:now,writer,initial:e,server_id:store.identity(writer.token).server_id,db_inode:fs.statSync(file).ino,backup_sha256:sha(fs.readFileSync(path.join(work,'ordinary-text-backup.sqlite')))};save(fixture,f);checks.push('old runtime material, credential, server identity and text-only backup seeded');
    }else{
      assert.equal(fs.statSync(file).ino,f.db_inode);assert.equal(sha(fs.readFileSync(path.join(work,'ordinary-text-backup.sqlite'))),f.backup_sha256);
      if(a.phase!=='resume'){assert.equal(store.identity(f.writer.token).server_id,f.server_id);assert.deepEqual(store.get(f.writer.token,f.initial.body.material_id,1).body,f.initial.body);}
      server=await listen(store);const base=`http://127.0.0.1:${server.address().port}/v1/`;
      const call=async(route,token,value)=>{const r=await fetch(base+route,{method:value===undefined?'GET':'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:value===undefined?undefined:JSON.stringify(value)});return {status:r.status,body:await r.json()};};
      if(a.phase==='upgrade'){
        assert(store.audio);assert(!store.identity(f.writer.token).scopes.includes('audio:write'));
        now=Date.now();const fresh=store.mint({owner:'synthetic-audio-release',producer:'phone',scopes:['audio:write','audio:read'],ttlMs:86400000});
        const payload=name=>Buffer.from(('opaque-synthetic-'+name+'-audio-marker;').repeat(9000));
        const put=async(name,token,done)=>{const bytes=payload(name),value={material_id:f.initial.body.material_id,material_revision:1,kind:'raw',media_type:'application/vnd.turboio.lifelog-archive',bytes:bytes.length,sha256:sha(bytes),capture:{first_received_at:new Date(now-2000).toISOString(),last_received_at:new Date(now).toISOString(),recording_complete:false}};
          const begin=await call('audio-uploads',token,value);assert.equal(begin.status,200);const id=begin.body.object_id;
          for(let i=0;i<(done?begin.body.parts:1);i++){const p=bytes.subarray(i*131072,(i+1)*131072);assert.equal((await call(`audio-uploads/${id}/parts/${i}`,token,{data:p.toString('base64'),sha256:sha(p)})).status,200);}
          if(!done)return {receipt:begin.body,value};const receipt=await call(`audio-uploads/${id}/finalize`,token,{});assert.equal(receipt.status,200);assert.equal(receipt.body.storage_verified,true);assert.equal(receipt.body.recording_completeness_verified,false);
          const chunks=[];for(let i=0;i<receipt.body.parts;i++){const p=await call(`audio/${id}?index=${i}`,token);assert.equal(p.status,200);chunks.push(Buffer.from(p.body.data,'base64'));}assert.deepEqual(Buffer.concat(chunks),bytes);return {receipt:receipt.body,value};};
        f.fresh=fresh;f.future=await put('future',fresh.token,true);now=f.epoch;f.old=store.mint({owner:'synthetic-audio-release',producer:'phone',scopes:['audio:write','audio:read'],ttlMs:86400000});f.due=await put('due',f.old.token,true);f.pending=await put('pending',f.old.token,false);
        assert.equal((await call('audio-uploads',f.writer.token,f.due.value)).status,403);save(fixture,f);checks.push('new audio service uploads and reads exact bytes over HTTP','fixed 72-hour receipts and separate permission; ordinary text identity retained','due, pending and future payloads staged for old-code rollback');
      }else if(a.phase==='rollback'||a.phase==='expiry'){
        assert.equal(store.audio,undefined);const audioFile=file+'.audio.sqlite',audioBefore=sha(fs.readFileSync(audioFile));
        const material=await call('materials/'+encodeURIComponent(f.initial.body.material_id),f.writer.token);assert.equal(material.status,200);
        if(a.phase==='rollback'){
          const e=structuredClone(f.initial);Object.assign(e,{event_id:randomUUID(),idempotency_key:randomUUID()});Object.assign(e.body,{base_revision:1,revision:2,text_revision:2});e.body.full_text.text+=' new synthetic text while rolled back';assert.equal(store.submit(f.writer.token,e).status,201);f.replacement=e;save(fixture,f);
          assert.equal(sha(fs.readFileSync(audioFile)),audioBefore);checks.push('old runtime serves original text and accepts fresh revision two','old runtime never opens or changes the retained audio side database');
        }else{
          const before=sha(fs.readFileSync(file)),cleaner=path.join(work,'stable-expiry/audio-expiry.mjs');assert.equal(sha(fs.readFileSync(cleaner)),sha(fs.readFileSync(path.join(a.candidate,'rebuild/material-server/audio-expiry.mjs'))));
          const result=JSON.parse(execFileSync(process.execPath,[cleaner,'--db',audioFile,'--server-id',f.server_id],{encoding:'utf8',timeout:15000,stdio:['ignore','pipe','pipe']}));assert.equal(result.objects,2);assert(result.parts>1);assert.equal(sha(fs.readFileSync(file)),before);
          const db=new DatabaseSync(audioFile,{readOnly:true});try{assert.equal(db.prepare('SELECT state FROM audio_objects WHERE object_id=?').get(f.due.receipt.object_id).state,'expired');assert.equal(db.prepare('SELECT state FROM audio_objects WHERE object_id=?').get(f.pending.receipt.object_id).state,'abandoned');assert.equal(db.prepare('SELECT state FROM audio_objects WHERE object_id=?').get(f.future.receipt.object_id).state,'stored');assert.equal(db.prepare('SELECT expires FROM audio_objects WHERE object_id=?').get(f.due.receipt.object_id).expires,Date.parse(f.due.receipt.expires_at));}finally{db.close();}
          assert(!fs.readFileSync(audioFile).includes(Buffer.from('opaque-synthetic-due-audio-marker;'.repeat(3))));assert(fs.readFileSync(audioFile).includes(Buffer.from('opaque-synthetic-future-audio-marker;'.repeat(3))));assert.equal((await call('materials/'+encodeURIComponent(f.initial.body.material_id),f.writer.token)).status,200);
          checks.push('independent copied cleaner prunes expired bytes while old HTTP service remains live','text database bytes unchanged; future audio and fixed expiry metadata retained');
        }
      }else{
        const text=store.mint({owner:'synthetic-audio-release',producer:'phone',scopes:['materials:read'],ttlMs:3600000}),audio=store.mint({owner:'synthetic-audio-release',producer:'phone',scopes:['audio:write','audio:read'],ttlMs:3600000});assert.equal(store.identity(text.token).server_id,f.server_id);assert.deepEqual(store.get(text.token,f.initial.body.material_id).body,f.replacement.body);
        assert.equal((await call('audio/'+f.due.receipt.object_id,audio.token)).status,410);assert.equal((await call('audio-uploads',audio.token,f.due.value)).status,410);assert.deepEqual((await call('audio/'+f.future.receipt.object_id,audio.token)).body,f.future.receipt);
        for(const id of [f.writer.token_id,f.fresh.token_id,f.old.token_id,text.token_id,audio.token_id])store.revoke(id);assert.throws(()=>store.identity(audio.token),e=>e.code==='UNAUTHENTICATED');checks.push('upgrade again preserves old-code text revision and fixed future audio receipt','expired original cannot be revived or renewed; isolated credentials revoked');
      }
    }
    console.log(JSON.stringify({phase:a.phase,passed:true,checks}));
  }finally{if(server)await new Promise(r=>server.close(r));store.close();}
}
