// Synthetic code upgrade/rollback only. Never accepts an existing database or
// credential: the parent creates a private temporary database for all phases.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {parseArgs} from 'node:util';
import assert from 'node:assert/strict';

const {values:a}=parseArgs({options:{baseline:{type:'string'},candidate:{type:'string'},out:{type:'string'},phase:{type:'string'},work:{type:'string'}}});
const hash=b=>createHash('sha256').update(b).digest('hex');
const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const save=(p,v)=>fs.writeFileSync(p,JSON.stringify(v),{mode:0o600});
const runtime=['store.mjs','http.mjs','json.mjs','validation.mjs','cli.mjs','traffic.mjs','devices.mjs'];
const packageFiles=[...runtime,'material-transfer.mjs','package.json','package-lock.json','.node-version','admin/index.html','admin/app.js','admin/style.css'].map(f=>'rebuild/material-server/'+f).concat(['event-v1.schema.json','event-v1.1.schema.json','event-v1.2.schema.json'].map(f=>'docs/contracts/'+f));
const sourceHashes=root=>Object.fromEntries(packageFiles.filter(f=>fs.existsSync(path.join(root,f))).map(f=>[f,hash(fs.readFileSync(path.join(root,f)))]));

if(!a.phase){
  assert(a.baseline&&a.candidate&&a.out&&!a.work,'Explicit source roots and report required');
  const baseline=fs.realpathSync(a.baseline),candidate=fs.realpathSync(a.candidate);
  assert.notEqual(baseline,candidate);
  const before={baseline:sourceHashes(baseline),candidate:sourceHashes(candidate)};
  for(const name of packageFiles){assert(before.candidate[name],`Missing candidate ${name}`);if(!name.endsWith('/material-transfer.mjs'))assert(before.baseline[name],`Missing baseline ${name}`);}
  const work=fs.mkdtempSync(path.join(os.tmpdir(),'io-material-rehearsal-'));fs.chmodSync(work,0o700);
  const results=[];
  try{
    for(const phase of ['seed','upgrade','rollback','resume']){
      const stdout=execFileSync(process.execPath,[fileURLToPath(import.meta.url),'--phase',phase,'--baseline',baseline,'--candidate',candidate,'--work',work],{encoding:'utf8',timeout:60000,maxBuffer:1048576,stdio:['ignore','pipe','pipe']});
      const result=JSON.parse(stdout);assert.equal(result.phase,phase);assert.equal(result.passed,true);results.push(result);
    }
    assert.deepEqual({baseline:sourceHashes(baseline),candidate:sourceHashes(candidate)},before,'Source changed during rehearsal');
    const report={schema:1,at:new Date().toISOString(),node:process.version,passed:true,scope:'Four independent Node processes, real HTTP/SQLite, synthetic data; code rollback with migrated database retained',production_changed:false,phone_accessed:false,rehearsal_sha256:hash(fs.readFileSync(fileURLToPath(import.meta.url))),sources:before,phases:results,temporary_data_removed:true};
    // Publish the report only after all fixture credentials and bytes are gone.
    fs.rmSync(work,{recursive:true});save(path.resolve(a.out),report);console.log(JSON.stringify(report));
  }finally{if(fs.existsSync(work))fs.rmSync(work,{recursive:true});}
}else{
  assert(['seed','upgrade','rollback','resume'].includes(a.phase)&&a.work&&!a.out);
  const work=fs.realpathSync(a.work);assert(path.dirname(work)===fs.realpathSync(os.tmpdir())&&path.basename(work).startsWith('io-material-rehearsal-'));
  const root=['seed','rollback'].includes(a.phase)?a.baseline:a.candidate;
  const {MaterialStore}=await import(pathToFileURL(path.join(root,'rebuild/material-server/store.mjs')));
  const {listen}=await import(pathToFileURL(path.join(root,'rebuild/material-server/http.mjs')));
  const {canonical}=await import(pathToFileURL(path.join(root,'rebuild/material-server/json.mjs')));
  const store=new MaterialStore(path.join(work,'synthetic.sqlite')),checks=[];
  let server;
  try{
    if(a.phase==='seed'){
      const writer=store.mint({owner:'synthetic-release-codex',producer:'synthetic-phone',scopes:['materials:write','materials:read','changes:read']});
      const samples=read(path.join(a.candidate,'docs/contracts/material-v1.2.json')).events;
      const initial=structuredClone(samples.find(e=>e.kind==='material.revision'&&e.body.operation==='upsert'&&e.body.revision===1));assert(initial);
      Object.assign(initial,{event_id:randomUUID(),idempotency_key:randomUUID(),producer_id:'synthetic-phone',created_at:new Date().toISOString(),expires_at:new Date(Date.now()+3600000).toISOString()});
      const make=(previous,text)=>{const e=structuredClone(previous);Object.assign(e,{event_id:randomUUID(),idempotency_key:randomUUID()});e.body.base_revision=e.body.revision;e.body.revision++;e.body.text_revision++;e.body.full_text.text=text;return e;};
      const large=make(initial,'完整合成智记🙂。'.repeat(55000)),pending=make(large,'旧的未确认正文'),replacement=make(large,'最新正文，不能被迟到旧请求覆盖。');
      assert(Buffer.byteLength(canonical(large))>1048576);
      assert.equal(store.submit(writer.token,initial).status,201);
      save(path.join(work,'fixture.json'),{writer,server_id:store.identity(writer.token).server_id,initial,large,pending,replacement});
      checks.push('baseline creates original material and isolated credential');
    }else{
      const f=read(path.join(work,'fixture.json')),token=f.writer.token;
      assert.equal(store.identity(token).server_id,f.server_id);assert.deepEqual(store.get(token,f.initial.body.material_id,1).body,f.initial.body);
      checks.push('original server identity, credential and immutable revision retained');
      server=await listen(store);const base=`http://127.0.0.1:${server.address().port}/v1/`;
      const post=async(url,body)=>{const r=await fetch(base+url,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:canonical(body)});return {status:r.status,body:await r.json()};};
      if(a.phase==='upgrade'){
        assert(store.identity(token).capabilities.includes('material_cancel_v1'));
        const bytes=Buffer.from(canonical(f.large)),id=hash(bytes),partBytes=131072;
        assert.equal((await post('material-uploads',{event_id:f.large.event_id,bytes:bytes.length,sha256:id})).status,200);
        for(let i=0;i<Math.ceil(bytes.length/partBytes);i++){
          const b=bytes.subarray(i*partBytes,(i+1)*partBytes);assert.equal((await post(`material-uploads/${id}/parts/${i}`,{data:b.toString('base64'),sha256:hash(b)})).status,200);
        }
        assert.equal((await post(`material-uploads/${id}/finalize`,{})).status,201);
        assert.deepEqual(store.get(token,f.large.body.material_id,2).body,f.large.body);
        const proof=await post('material-cancellations',{event_id:f.pending.event_id,idempotency_key:f.pending.idempotency_key,material_id:f.pending.body.material_id,revision:3,payload_sha256:hash(canonical(f.pending)),expires_at:f.pending.expires_at});
        assert.equal(proof.status,200);assert.equal(proof.body.state,'cancelled');save(path.join(work,'cancellation.json'),proof.body);
        checks.push('new tables created without losing baseline data','large event transferred over HTTP and read back exactly','uncommitted third revision cancelled durably');
      }else if(a.phase==='rollback'){
        assert.deepEqual(store.get(token,f.large.body.material_id,2).body,f.large.body);
        assert.deepEqual(store.event(token,f.pending.event_id),read(path.join(work,'cancellation.json')));
        const late=await post('material-events',f.pending);assert.equal(late.status,409);assert.equal(late.body.error.code,'IDEMPOTENCY_CONFLICT');
        assert.equal(store.get(token,f.large.body.material_id).body.revision,2);
        checks.push('old code opens migrated database and retains complete new material','old event lookup retains cancellation proof','old code rejects cancelled late event using existing digest conflict');
      }else{
        assert.deepEqual(store.event(token,f.pending.event_id),read(path.join(work,'cancellation.json')));
        const late=await post('material-events',f.pending);assert.equal(late.status,409);assert.equal(late.body.error.code,'MATERIAL_EVENT_CANCELLED');
        assert.equal((await post('material-events',f.replacement)).status,201);assert.equal((await post('material-events',f.replacement)).status,200);
        assert.deepEqual(store.get(token,f.replacement.body.material_id).body,f.replacement.body);assert.equal(store.ceiling('synthetic-release-codex'),3);
        store.revoke(f.writer.token_id);assert.throws(()=>store.identity(token),e=>e.code==='UNAUTHENTICATED');
        checks.push('upgrade again keeps cancellation barrier','fresh replacement commits exactly once at revision three','temporary writer revoked');
      }
    }
    console.log(JSON.stringify({phase:a.phase,passed:true,checks}));
  }finally{if(server)await new Promise(resolve=>server.close(resolve));store.close();}
}
