// Explicit synthetic-owner public check, not a user-audio grant or phone test.
import fs from 'node:fs';import path from 'node:path';import os from 'node:os';
import {fileURLToPath} from 'node:url';import {randomUUID,createHash} from 'node:crypto';
import {spawnSync,spawn} from 'node:child_process';import assert from 'node:assert/strict';
import {canonical} from '../../rebuild/material-server/json.mjs';

const [flag,runId]=process.argv.slice(2);assert(flag==='--apply'&&/^caller[6-7][0-9]{2}-audio-\d{8}-codex$/.test(runId??''));
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..'),app=path.join(root,'rebuild/android-app'),build=path.join(app,'build');
const privateDir=path.join(root,'rebuild/agent-bridge/private','cloud-'+runId),read=p=>JSON.parse(fs.readFileSync(p));
const credentials=Object.fromEntries(['phone','reader','text'].map(n=>[n,read(path.join(privateDir,n+'.json'))]));
const bundle=read(path.join(privateDir,'bundle.json')),owner='synthetic-cloud-'+runId,base='https://cznbnb.cn/io-api/v1/';
assert.equal(bundle.phone.owner_id,owner);assert.equal(bundle.phone.base_url,base);assert.equal(bundle.phone.producer_id,'cloud-phone');
const sha=x=>createHash('sha256').update(x).digest('hex'),work=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'io-public-audio-tls-')));fs.chmodSync(work,0o700);
const names=['AudioConnection','AudioHttp','AudioUploadWire','AudioUploadOutbox','MaterialConnection','MaterialWire','MaterialApi','MaterialOutbox','MaterialTransfer','AtomicDocument','WireJson','TaskWire','TaskConnection'];
const sources=names.map(n=>path.join(app,'src/com/turboio/addon',n+'.java')).concat(path.join(app,'upstream/android-addon/src/com/turboio/addon/BoundedJson.java'),path.join(root,'tools/android/AudioTlsIntegrationTest.java'));
const hashes=Object.fromEntries(sources.map(p=>[path.relative(root,p),sha(fs.readFileSync(p))]));
const call=async(route,credential,value)=>{
 const r=await fetch(base+route,{method:value===undefined?'GET':'POST',headers:{Authorization:'Bearer '+credential.token,'Content-Type':'application/json'},body:value===undefined?undefined:canonical(value),redirect:'error',signal:AbortSignal.timeout(20000)});
 const chunks=[];let total=0;for await(const chunk of r.body){total+=chunk.length;assert(total<=1048576);chunks.push(chunk);}return {status:r.status,body:JSON.parse(Buffer.concat(chunks))};
};
let initial=null,deleted=false,success=false,report,cleanupError='';
try{
 const identity=await call('identity',credentials.phone);assert.equal(identity.status,200);assert.equal(identity.body.owner_id,owner);assert(identity.body.capabilities.includes('audio_archive_v1'));
 const e=structuredClone(read(path.join(root,'docs/contracts/material-v1.2.json')).events.find(e=>e.body.revision===1&&e.body.operation==='upsert')),material='synthetic-audio-tls-'+runId;
 e.body=JSON.parse(JSON.stringify(e.body).replaceAll(e.body.material_id,material));Object.assign(e,{event_id:randomUUID(),idempotency_key:randomUUID(),producer_id:'cloud-phone',created_at:new Date().toISOString(),expires_at:new Date(Date.now()+900000).toISOString()});initial=e;
 assert.equal((await call('material-events',credentials.phone,e)).status,201);
 const data=Buffer.alloc(262267);for(let i=0;i<data.length;i++)data[i]=(i*37+19)%256;
 const now=Date.now(),manifest={material_id:material,material_revision:1,kind:'raw',media_type:'application/vnd.turboio.lifelog-archive',bytes:data.length,sha256:sha(data),capture:{first_received_at:new Date(now-2000).toISOString(),last_received_at:new Date(now).toISOString(),recording_complete:false}};
 const conn={format:'turboio-audio-sync/1',base_url:base.slice(0,-1),owner_id:owner,producer_id:'cloud-phone',server_id:identity.body.server_id,...credentials.phone};
 // Connection wire format deliberately excludes issuer-only metadata.
 const connection=Object.fromEntries(['format','base_url','owner_id','producer_id','server_id','token','token_id','expires_at'].map(n=>[n,conn[n]]));
 const input=path.join(work,'fixture.json');fs.writeFileSync(input,JSON.stringify({connection,manifest,data:data.toString('base64'),body_sha256:sha(canonical(e.body))}),{mode:0o600});
 const classes=path.join(work,'classes');fs.mkdirSync(classes);const compile=spawnSync('javac',['-encoding','UTF-8','-d',classes,...sources],{encoding:'utf8',timeout:60000});assert.equal(compile.status,0,compile.stderr);
 const state=path.join(work,'state');fs.mkdirSync(state);
 const java=async mode=>await new Promise((resolve,reject)=>{const child=spawn('java',['-cp',classes,'com.turboio.addon.AudioTlsIntegrationTest',state,input,mode],{stdio:['ignore','pipe','pipe']});let output='';const timer=setTimeout(()=>{child.kill();reject(Error('PUBLIC_AUDIO_JAVA_TIMEOUT'));},90000);child.stdout.on('data',x=>output+=x);child.stderr.on('data',x=>output+=x);child.on('error',reject);child.on('exit',code=>{clearTimeout(timer);resolve({code,output});});});
 assert.equal((await java('crash-part-response')).code,87);
 const resume=await java('resume');assert.equal(resume.code,0,resume.output);
 const result=read(path.join(state,'tls-result.json')),receipt=result.receipt;
 const chunks=[];for(let index=0;index<receipt.parts;index++){const p=await call('audio/'+receipt.object_id+'?index='+index,credentials.reader);assert.equal(p.status,200);const bytes=Buffer.from(p.body.data,'base64');assert.equal(sha(bytes),p.body.part_sha256);chunks.push(bytes);}assert.deepEqual(Buffer.concat(chunks),data);
 const repeat=await call('audio-uploads',credentials.phone,manifest);assert.equal(repeat.status,200);assert.equal(repeat.body.stored_at,receipt.stored_at);assert.equal(repeat.body.expires_at,receipt.expires_at);
 assert.equal((await call('audio-uploads',credentials.text,manifest)).status,403);assert.equal((await call('audio-uploads',credentials.reader,manifest)).status,403);
 assert.equal((await call('materials/'+encodeURIComponent(material),credentials.reader)).status,200);
 assert.deepEqual(Object.fromEntries(sources.map(p=>[path.relative(root,p),sha(fs.readFileSync(p))])),hashes);
 report={schema:1,at:new Date().toISOString(),passed:true,scope:'Production Java AudioHttp and durable queue over real public TLS; synthetic opaque bytes only, not phone, source-format or Keystore proof.',run_id:runId,synthetic_bytes:data.length,payload_sha256:sha(data),java_checks:result.checks,actual_process_halt_after_tls_part_response:87,parts_sent_after_resume:result.parts_sent_after_resume,independent_node_exact_byte_readback:true,fixed_receipt_unchanged_on_repeat:true,text_only_and_reader_write_denied:true,recording_completeness_verified:false,sources:hashes,receipt,real_user_audio_uploaded:false,phone_accessed:false};success=true;
}finally{
 if(initial){try{const tombstone=structuredClone(initial);Object.assign(tombstone,{event_id:randomUUID(),idempotency_key:randomUUID()});Object.assign(tombstone.body,{operation:'delete',revision:2,base_revision:1,text_revision:2});tombstone.body.full_text.text='';tombstone.body.utterances=[];tombstone.body.speakers=[];const r=await call('material-events',credentials.phone,tombstone);assert([200,201].includes(r.status));deleted=true;}catch(e){cleanupError='SYNTHETIC_TOMBSTONE_NOT_CONFIRMED';success=false;}}
 fs.rmSync(work,{recursive:true});
 if(report){report.synthetic_material_tombstoned=deleted;report.cleanup_error=cleanupError;report.temporary_files_removed=true;report.passed=success;fs.writeFileSync(path.join(build,'audio-public-tls-tests.json'),JSON.stringify(report,null,2)+'\n');}
}
assert(success&&deleted,'PUBLIC_AUDIO_TLS_OR_CLEANUP_FAILED');console.log(JSON.stringify({passed:true,run_id:runId,synthetic_bytes:report.synthetic_bytes,actual_tls:true,synthetic_material_tombstoned:deleted}));
