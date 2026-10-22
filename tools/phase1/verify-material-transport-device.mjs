import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';

const opts={},args=process.argv.slice(2);
for(let i=0;i<args.length;i+=2){assert(['--report','--manifest','--output'].includes(args[i])&&args[i+1]);opts[args[i]]=args[i+1];}
for(const key of ['--report','--manifest','--output'])assert(opts[key],`Missing ${key}`);
function read(p){assert(fs.statSync(p).size<1000000);return JSON.parse(fs.readFileSync(p,'utf8').replace(/^\uFEFF/,''));}
const report=read(opts['--report']),manifest=read(opts['--manifest']);
assert.equal(report.schema,1);assert.equal(report.kind,'isolated_p31_outbox_filesystem');
assert.equal(report.phase,'outbox-transport-guard');assert.equal(report.status,'passed');assert.equal(report.error,'');
assert.match(report.run_id,/^\d{13}$/);assert(Number.isSafeInteger(report.at)&&report.at>0);
assert.deepEqual(report.checks,[
  'native_target_validated_without_dispatch','native_insecure_target_rejected',
  'native_credential_url_rejected','native_partition_mismatch_rejected_without_enqueue'
]);
assert.deepEqual(report.events,[]);assert.deepEqual(report.outbox,[]);assert.equal(report.claim,null);
assert.equal(manifest.candidate,'0.1.41');assert(manifest.files.every(f=>f.staged_match));
for(const symbol of ['MaterialOutbox','MaterialSyncTransport','outbox-transport-guard'])assert.equal(manifest.abc_symbols[symbol],true);
assert(manifest.hap_bytes>0);assert.match(manifest.hap_sha256,/^[a-f0-9]{64}$/);
const sha=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const result={schema:1,candidate:manifest.candidate,passed:true,native_target_checks:report.checks.length,
  compiled_transport_present:true,report_sha256:sha(opts['--report']),manifest_sha256:sha(opts['--manifest']),
  scope:'Actual phone configuration validation only. No HTTP request, server storage, audio, Bluetooth, Agent or end-to-end acceptance.'};
fs.writeFileSync(opts['--output'],JSON.stringify(result,null,2)+'\n');process.stdout.write(JSON.stringify(result)+'\n');
