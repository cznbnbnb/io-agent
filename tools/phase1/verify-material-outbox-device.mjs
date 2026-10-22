import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
function dependency(n){try{return require(n);}catch{return require('../deveco-cli/node_modules/'+n);}}
const args=process.argv.slice(2),opts={};
for(let i=0;i<args.length;i+=2){assert(['--seed','--resume','--check','--process','--output'].includes(args[i])&&args[i+1]);opts[args[i]]=args[i+1];}
for(const key of ['--seed','--resume','--check','--process','--output'])assert(opts[key],`Missing ${key}`);
const read=p=>{assert(fs.statSync(p).size<=1000000);return JSON.parse(fs.readFileSync(p,'utf8').replace(/^\uFEFF/,''));};
const reports=['--seed','--resume','--check'].map(k=>read(opts[k])),[seed,resume,check]=reports,processProof=read(opts['--process']);
const Ajv=dependency('ajv/dist/2020.js'),formats=dependency('ajv-formats'),ajv=new Ajv({strict:false,allErrors:true});formats(ajv);
const contracts=new URL('../../docs/contracts/',import.meta.url);ajv.addSchema(read(new URL('event-v1.schema.json',contracts)));const valid=ajv.compile(read(new URL('event-v1.1.schema.json',contracts)));
const sha=value=>createHash('sha256').update(value).digest('hex');
for(const [index,report] of reports.entries()){
  assert.equal(report.kind,'isolated_p31_outbox_filesystem');assert.equal(report.phase,['outbox-seed','outbox-resume','outbox-check'][index]);
  assert.equal(report.status,'passed');assert.match(report.run_id,/^\d{13}$/);assert.equal(report.run_id,seed.run_id);assert.equal(report.events.length,2);assert.equal(report.outbox.length,2);
  for(const e of report.events){assert(valid(e),JSON.stringify(valid.errors));assert.equal(e.body.audio.state,'missing');assert.equal(e.body.audio.object_id,null);}
  assert.deepEqual(report.events,seed.events);
  for(const [i,row] of report.outbox.entries()){
    const e=seed.events[i];assert.equal(row.queue_id,sha(e.event_id));assert.equal(row.event_id,e.event_id);assert.equal(row.material_id,e.body.material_id);assert.equal(row.revision,i+1);
    assert.equal(row.payload_hash,sha(JSON.stringify(e)));assert.equal(row.payload_bytes,Buffer.byteLength(JSON.stringify(e)));
  }
}
assert.equal(seed.claim.action,'send');assert.equal(seed.claim.attempt,1);assert.equal(seed.claim.payload,JSON.stringify(seed.events[0]));
assert.equal(seed.outbox[0].state,'sending');assert.equal(seed.outbox[1].state,'queued');assert.equal(seed.outbox[1].attempts,0);
assert.equal(resume.outbox[0].state,'server_stored');assert.equal(resume.outbox[0].attempts,3);
assert.equal(resume.outbox[0].receipt_id,'synthetic-receipt-'+seed.run_id+'-r1');assert.equal(resume.outbox[1].state,'retry_wait');
assert.equal(resume.outbox[1].attempts,1);assert.equal(resume.outbox[1].needs_lookup,true);assert(resume.outbox[1].next_attempt_at>=resume.at+1000);
assert.deepEqual(check.outbox,resume.outbox);
assert(processProof.first_stop_empty&&processProof.second_stop_empty&&processProof.all_processes_present&&processProof.three_distinct_pids,'Missing evidence for two real process restarts');
const result={schema:1,candidate:'0.1.40',passed:true,process_restarts:2,original_payload_hash_verified:true,revision_order_preserved:true,
  synthetic_receipt_persisted:true,retry_state_persisted:true,report_sha256:Object.fromEntries(['--seed','--resume','--check'].map(k=>[k.slice(2),sha(fs.readFileSync(opts[k]))])),
  scope:'Actual phone filesystem/SHA256 with synthetic payload and synthetic receipt. No server connection, real audio, Agent or product end-to-end acceptance.'};
fs.writeFileSync(opts['--output'],JSON.stringify(result,null,2)+'\n');process.stdout.write(JSON.stringify(result)+'\n');
