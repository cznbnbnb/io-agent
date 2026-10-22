import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),args=process.argv.slice(2),opts={};
for(let i=0;i<args.length;i+=2){assert(['--seed','--resume','--payloads','--process','--manifest','--output'].includes(args[i])&&args[i+1]);opts[args[i]]=args[i+1];}
for(const key of ['--seed','--resume','--payloads','--process','--manifest','--output'])assert(opts[key],`Missing ${key}`);
const read=p=>{assert(fs.statSync(p).size<1000000);return JSON.parse(fs.readFileSync(p,'utf8').replace(/^\uFEFF/,''));};
const seed=read(opts['--seed']),resume=read(opts['--resume']),payloads=read(opts['--payloads']),proof=read(opts['--process']),manifest=read(opts['--manifest']);
function dependency(n){try{return require(n);}catch{return require('../deveco-cli/node_modules/'+n);}}
const Ajv=dependency('ajv/dist/2020.js'),formats=dependency('ajv-formats'),ajv=new Ajv({strict:false,allErrors:true});formats(ajv);
ajv.addSchema(read(new URL('../../docs/contracts/event-v1.schema.json',import.meta.url)));
const valid=ajv.compile(read(new URL('../../docs/contracts/event-v1.1.schema.json',import.meta.url)));
const sha=text=>createHash('sha256').update(text).digest('hex');
for(const [report,phase] of [[seed,'discovery-seed'],[resume,'discovery-resume']]){
  assert.equal(report.schema,1);assert.equal(report.kind,'isolated_p31_outbox_filesystem');assert.equal(report.phase,phase);
  assert.equal(report.status,'passed');assert.equal(report.error,'');assert.match(report.run_id,/^\d{13}$/);assert.equal(report.run_id,seed.run_id);
  assert.equal(report.events.length,1);assert.deepEqual(report.events,seed.events);
}
assert.equal(seed.outbox.length,1);assert.equal(resume.outbox.length,3);assert.equal(payloads.length,3);
for(const [index,event] of payloads.entries()){
  assert(valid(event),JSON.stringify(valid.errors));const row=resume.outbox[index],revision=index+1;
  assert.equal(event.body.revision,revision);assert.equal(event.producer_id,'phone-synthetic-lab');assert.equal(event.body.audio.state,'missing');
  assert.equal(event.event_id,'evt-mat-'+sha(JSON.stringify(['material-revision-v1','synthetic-lab-owner','phone-synthetic-lab','synthetic-filesystem-only',event.body.material_id,revision])));
  assert.equal(row.event_id,event.event_id);assert.equal(row.queue_id,sha(event.event_id));assert.equal(row.revision,revision);
  assert.equal(row.payload_hash,sha(JSON.stringify(event)));assert.equal(row.payload_bytes,Buffer.byteLength(JSON.stringify(event)));
  assert.equal(row.receipt_id,'');assert.equal(row.server_commit_seq,0);assert.notEqual(row.state,'server_stored');
}
assert.equal(payloads[0].body.full_text.text,'合成发现旧文字');assert.equal(payloads[1].body.full_text.text,'合成发现新版');
assert.equal(payloads[2].body.operation,'delete');assert.equal(payloads[2].body.full_text.text,'');
assert.equal(seed.claim.payload,JSON.stringify(payloads[0]));assert.equal(seed.outbox[0].state,'sending');assert.equal(seed.outbox[0].attempts,1);
for(const field of ['event_id','payload_hash','payload_bytes','expires_at'])assert.equal(resume.outbox[0][field],seed.outbox[0][field]);
assert.equal(resume.claim.action,'lookup');assert.equal(resume.claim.eventId,seed.claim.eventId);assert.equal(resume.outbox[0].attempts,2);
for(const row of resume.outbox.slice(1)){assert.equal(row.state,'queued');assert.equal(row.attempts,0);}
assert(proof.old_process_stopped&&proof.old_pid_absent&&proof.new_pid_present&&proof.distinct_pids);
assert.equal(manifest.candidate,'0.1.42');assert(manifest.files.every(f=>f.staged_match));assert(manifest.abc_symbols.MaterialSyncDiscovery);
const result={schema:1,candidate:'0.1.42',passed:true,revisions_discovered:3,actual_process_restarts:1,
  original_event_identity_and_deadline_retained:true,all_payload_hashes_verified:true,no_storage_acknowledgements:true,
  report_sha256:Object.fromEntries(['--seed','--resume','--payloads','--process','--manifest'].map(k=>[k.slice(2),sha(fs.readFileSync(opts[k]))])),
  scope:'Actual phone synthetic filesystem history discovery and force-stop recovery only. No network, user audio, Bluetooth, Agent or end-to-end acceptance.'};
fs.writeFileSync(opts['--output'],JSON.stringify(result,null,2)+'\n');process.stdout.write(JSON.stringify(result)+'\n');
