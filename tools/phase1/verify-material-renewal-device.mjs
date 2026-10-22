import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),args=process.argv.slice(2),opts={};
const keys=['--seed','--resume','--payloads','--process','--migration-before','--migration-after','--migration-report','--manifest','--output'];
for(let i=0;i<args.length;i+=2){assert(keys.includes(args[i])&&args[i+1]);opts[args[i]]=args[i+1];}
for(const key of keys)assert(opts[key],`Missing ${key}`);
const read=p=>{assert(fs.statSync(p).size<1000000);return JSON.parse(fs.readFileSync(p,'utf8').replace(/^\uFEFF/,''));};
function dependency(n){try{return require(n);}catch{return require('../deveco-cli/node_modules/'+n);}}
const Ajv=dependency('ajv/dist/2020.js'),formats=dependency('ajv-formats'),ajv=new Ajv({strict:false,allErrors:true});formats(ajv);
ajv.addSchema(read(new URL('../../docs/contracts/event-v1.schema.json',import.meta.url)));
const valid=ajv.compile(read(new URL('../../docs/contracts/event-v1.1.schema.json',import.meta.url)));
const [seed,resume,payloads,proof,before,after,migration,manifest]=keys.slice(0,-1).map(k=>read(opts[k]));
const sha=text=>createHash('sha256').update(text).digest('hex');
assert.equal(manifest.candidate,'0.1.43');assert(manifest.files.every(f=>f.staged_match));assert(manifest.abc_symbols.MaterialOutbox&&manifest.abc_symbols['renewal-seed']);
for(const [report,phase] of [[seed,'renewal-seed'],[resume,'renewal-resume']]){
  assert.equal(report.schema,1);assert.equal(report.kind,'isolated_p31_outbox_filesystem');assert.equal(report.phase,phase);assert.equal(report.status,'passed');
  assert.equal(report.error,'');assert.match(report.run_id,/^\d{13}$/);assert.equal(report.run_id,seed.run_id);assert.equal(report.outbox.length,1);
  assert.equal(report.events.length,2);assert.deepEqual(report.events,seed.events);
}
assert.equal(payloads.length,2);assert.deepEqual(payloads,seed.events);
for(const event of payloads){assert(valid(event),JSON.stringify(valid.errors));assert.equal(event.body.audio.state,'missing');assert.equal(event.producer_id,'phone-synthetic-lab');}
const [old,current]=payloads,row=resume.outbox[0],history=row.history[0];assert.equal(row.history.length,1);
assert.deepEqual(current.body,old.body);assert.notEqual(current.event_id,old.event_id);assert.notEqual(current.idempotency_key,old.idempotency_key);
assert(Date.parse(old.expires_at)<seed.at);assert(Date.parse(current.created_at)>=seed.at&&Date.parse(current.expires_at)>seed.at);
assert.equal(current.event_id,'evt-renew-'+sha(JSON.stringify(['material-reissue-v1','synthetic-lab-owner','phone-synthetic-lab','synthetic-filesystem-only',old.event_id])));
assert.equal(history.event_id,old.event_id);assert.equal(history.queue_id,sha(old.event_id));assert.equal(history.payload_hash,sha(JSON.stringify(old)));
assert.equal(history.payload_bytes,Buffer.byteLength(JSON.stringify(old)));assert.equal(history.expires_at,Date.parse(old.expires_at));assert(history.absence_confirmed_at>=history.expires_at);
assert.equal(row.event_id,current.event_id);assert.equal(row.queue_id,sha(current.event_id));assert.equal(row.payload_hash,sha(JSON.stringify(current)));
assert.equal(row.payload_bytes,Buffer.byteLength(JSON.stringify(current)));assert.equal(row.expires_at,Date.parse(current.expires_at));
assert.equal(row.receipt_id,'');assert.equal(row.server_commit_seq,0);assert.equal(row.absence_confirmed_at,0);
assert.equal(seed.claim.payload,JSON.stringify(current));assert.equal(seed.claim.action,'send');assert.equal(seed.outbox[0].attempts,1);
assert.equal(resume.claim.action,'lookup');assert.equal(resume.claim.eventId,current.event_id);assert.equal(row.attempts,2);
for(const report of [seed,resume])assert.equal(report.claim.partitionId,sha(JSON.stringify(['synthetic-lab-owner','phone-synthetic-lab','synthetic-filesystem-only'])));
for(const field of ['event_id','payload_hash','payload_bytes','expires_at','history'])assert.deepEqual(row[field],seed.outbox[0][field]);
assert(proof.old_process_stopped&&proof.old_pid_absent&&proof.new_pid_present&&proof.distinct_pids);
assert.equal(before.schema,1);assert.equal(after.schema,2);assert.deepEqual(after.principal,before.principal);assert.equal(before.rows.length,3);assert.equal(after.rows.length,3);
for(let i=0;i<3;i++){
  for(const field of ['event_id','queue_id','material_id','revision','payload_hash','payload_bytes','expires_at','receipt_id'])assert.deepEqual(after.rows[i][field],before.rows[i][field]);
  assert.deepEqual(after.rows[i].history,[]);assert.equal(after.rows[i].absence_confirmed_at,0);
}
assert.equal(migration.phase,'discovery-resume');assert.equal(migration.status,'passed');assert.equal(migration.outbox.length,3);assert.deepEqual(migration.outbox,after.rows);
const result={schema:1,candidate:'0.1.43',passed:true,actual_process_restarts:1,successor_and_lineage_persisted:true,
  both_actual_payload_hashes_verified:true,real_previous_native_schema_migrated:'1->2',migration_rows_preserved:3,
  report_sha256:Object.fromEntries(keys.slice(0,-1).map(k=>[k.slice(2),sha(fs.readFileSync(opts[k]))])),
  scope:'Actual phone synthetic files, restart and old native ledger migration. EVENT_NOT_FOUND was simulated; no HTTP, real server absence, user audio, Bluetooth, Agent or end-to-end acceptance.'};
fs.writeFileSync(opts['--output'],JSON.stringify(result,null,2)+'\n');process.stdout.write(JSON.stringify(result)+'\n');
