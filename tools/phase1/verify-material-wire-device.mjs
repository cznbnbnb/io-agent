// Independent inspection of synthetic native reports, not a server or E2E test.
import fs from 'node:fs';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
function dependency(n){try{return require(n);}catch{return require('../deveco-cli/node_modules/'+n);}}
const args=process.argv.slice(2),opts={};
for(let i=0;i<args.length;i+=2){assert(['--seed','--resume','--process','--output'].includes(args[i])&&args[i+1],'Expected --seed --resume --process --output paths');opts[args[i]]=args[i+1];}
for(const k of ['--seed','--resume','--process','--output'])assert(opts[k],`Missing ${k}`);
function read(p){assert(fs.statSync(p).size<=1000000,'Oversized report');return JSON.parse(fs.readFileSync(p,'utf8').replace(/^\uFEFF/,''));}
const Ajv=dependency('ajv/dist/2020.js'),formats=dependency('ajv-formats');const ajv=new Ajv({strict:false,allErrors:true});formats(ajv);
const root=new URL('../../docs/contracts/',import.meta.url);ajv.addSchema(read(new URL('event-v1.schema.json',root)));
const valid=ajv.compile(read(new URL('event-v1.1.schema.json',root)));
const seed=read(opts['--seed']),resume=read(opts['--resume']),processReport=read(opts['--process']);
assert.equal(seed.kind,'isolated_p21_material_wire');assert.equal(resume.kind,seed.kind);assert.equal(seed.phase,'wire-seed');assert.equal(resume.phase,'wire-resume');
assert.equal(seed.status,'passed');assert.equal(resume.status,'passed');assert.equal(seed.run_id,resume.run_id);assert.match(seed.run_id,/^\d{13}$/);
assert.equal(seed.events.length,3);assert.equal(resume.events.length,3);
for(const e of [...seed.events,...resume.events])assert(valid(e),JSON.stringify(valid.errors));
assert(processReport.stopped_pid_empty&&processReport.seed_process_present&&processReport.resume_process_present&&processReport.different_pid,'No evidence of a real process restart');
assert.equal(JSON.stringify(seed.events[1]),JSON.stringify(resume.events[0]));
assert.equal(seed.events[0].body.processing.transcription_state,'unknown');assert.equal(seed.events[0].body.processing.covered_ms,null);assert.equal(seed.events[0].body.utterances.length,0);
assert.equal(seed.events[1].body.completeness,'complete');assert.equal(seed.events[1].body.processing.transcription_state,'partial');assert.equal(seed.events[1].body.processing.covered_ms,10000);
assert.equal(resume.events[1].body.processing.covered_ms,10000);assert.equal(resume.events[1].body.processing.source_ms,70000);assert.equal(resume.events[1].body.processing.user_edited,true);
assert.equal(resume.events[2].body.operation,'delete');assert.equal(resume.events[2].body.full_text.text,'');assert.equal(resume.events[2].body.utterances.length,0);
assert([...seed.events,...resume.events].every(e=>e.body.audio.state==='missing'&&e.body.audio.object_id===null),'Synthetic fixture must not claim audio upload');
const digest=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const result={schema:1,candidate:'0.1.39',passed:true,wire_version:'1.1',native_events_validated:6,process_restart_verified:true,historical_retry_identical:true,
 sealed_source_can_have_partial_text:true,legacy_coverage_unknown:true,correction_retained_during_growth:true,tombstone_has_no_text:true,
 seed_report_sha256:digest(opts['--seed']),resume_report_sha256:digest(opts['--resume']),
 scope:'Actual phone filesystem and wire conversion with synthetic metadata. No real audio, ASR, network delivery, server storage, Agent, or product acceptance.'};
fs.writeFileSync(opts['--output'],JSON.stringify(result,null,2)+'\n');process.stdout.write(JSON.stringify(result)+'\n');
