// Real local CLI/HTTP/SQLite upgrade and code-only rollback. Synthetic data;
// never connects to the cloud or reads any production credential/database.
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {spawn,execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {isDeepStrictEqual,parseArgs} from 'node:util';
import {DatabaseSync} from 'node:sqlite';

const root=fileURLToPath(new URL('../../',import.meta.url));
const artifactRoot=path.join(root,'rebuild/phase1/artifacts');
const {values:args}=parseArgs({options:{'release-id':{type:'string',default:'io-server-20261013-r3'},
  'baseline-ref':{type:'string',default:'d2e9585'},scenario:{type:'string',default:'material-speakers-v1.2'}}});
const releaseId=args['release-id'],baselineRef=args['baseline-ref'],lifecycle=args.scenario==='request-lifecycle';
assert(/^[a-z0-9][a-z0-9-]{0,63}$/.test(releaseId),'RELEASE_ID_INVALID');
assert(/^[a-f0-9]{7,40}$/.test(baselineRef),'BASELINE_COMMIT_INVALID');
assert(args.scenario==='material-speakers-v1.2','REHEARSAL_SCENARIO_INVALID');
const archive=path.join(artifactRoot,releaseId+'.zip');
const manifest=JSON.parse(fs.readFileSync(path.join(root,'rebuild/phase1/'+releaseId+'-manifest.json')));
const preflight=JSON.parse(fs.readFileSync(path.join(root,'rebuild/phase1/'+releaseId+'-preflight.json')));
const sha=data=>createHash('sha256').update(data).digest('hex');
const python='C:/Users/LENOVO/AppData/Local/Programs/Python/Python310/python.exe';
const work=fs.mkdtempSync(path.join(artifactRoot,'release-rehearsal-'));
const current=path.join(work,'rebuild/material-server'),backup=path.join(work,'rebuild/.material-server-old');
const unpacked=path.join(work,'unpacked'),next=path.join(unpacked,'rebuild/material-server');
const db=path.join(work,'synthetic.sqlite');
const report={schema:1,at:new Date().toISOString(),release_id:releaseId,status:'failed',checks:[],
  scope:'local Windows subprocess CLI, real HTTP and SQLite, synthetic data only; no Linux systemd or cloud deployment proof',
  archive_sha256:sha(fs.readFileSync(archive)),baseline_git_ref:baselineRef,
  baseline_commit:execFileSync('git',['rev-parse','--verify',baselineRef+'^{commit}'],{cwd:root,encoding:'utf8',windowsHide:true}).trim(),
  scenario:args.scenario,rehearsal_source_sha256:sha(fs.readFileSync(fileURLToPath(import.meta.url))),production_changed:false};
let child;
const check=(condition,name)=>{assert(condition,name);report.checks.push(name);};
const readJson=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const env={...process.env};delete env.TURBOIO_CONTRACT_DEV_DEPS;

async function stop(){
  if(!child)return;
  const old=child;child=undefined;
  if(old.exitCode!==null||old.signalCode!==null)return;
  await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(Error('PROCESS_STOP_NOT_CONFIRMED')),10000);
    old.once('exit',()=>{clearTimeout(timer);resolve();});
    if(!old.kill('SIGTERM')){clearTimeout(timer);reject(Error('PROCESS_STOP_NOT_CONFIRMED'));}
  });
}
async function start(){
  assert(!child,'NO_OVERLAPPING_SERVICE');
  const port=await new Promise((resolve,reject)=>{
    const probe=net.createServer();probe.on('error',reject);
    probe.listen(0,'127.0.0.1',()=>{const n=probe.address().port;probe.close(()=>resolve(n));});
  });
  child=spawn(process.execPath,[path.join(current,'cli.mjs'),'serve','--db',db,'--port',String(port)],
    {cwd:current,env,stdio:['ignore','pipe','pipe'],windowsHide:true});
  const processHandle=child;
  await new Promise((resolve,reject)=>{
    let text='',settled=false;
    const finish=error=>{if(settled)return;settled=true;clearTimeout(timer);error?reject(error):resolve();};
    const timer=setTimeout(()=>finish(Error('SERVICE_START_TIMEOUT')),15000);
    processHandle.on('error',()=>finish(Error('SERVICE_START_FAILED')));
    processHandle.on('exit',()=>finish(Error('SERVICE_START_EXITED')));
    processHandle.stderr.on('data',()=>{}); // CLI diagnostics do not enter reports.
    processHandle.stdout.on('data',bytes=>{
      if(settled)return;text+=bytes.toString('utf8');if(text.length>4096)return finish(Error('SERVICE_START_OUTPUT_INVALID'));
      if(text.includes('\n')){
        try{const value=JSON.parse(text.split('\n')[0]);assert.equal(value.service,'turboio-materials');assert.equal(value.listen,'127.0.0.1');assert.equal(value.port,port);finish();}
        catch{finish(Error('SERVICE_START_OUTPUT_INVALID'));}
      }
    });
  });
  return 'http://127.0.0.1:'+port;
}
function mint(producer,scopes){
  const out=path.join(work,producer+'.json');
  execFileSync(process.execPath,[path.join(current,'cli.mjs'),'mint','--db',db,'--owner','release-synthetic-owner',
    '--producer',producer,'--scopes',scopes.join(','),'--out',out],{cwd:current,env,windowsHide:true,stdio:['ignore','pipe','pipe'],timeout:10000});
  return readJson(out);
}
async function api(base,route,token,payload){
  assert(base.startsWith('http://127.0.0.1:'),'LOCAL_HTTP_ONLY');
  const response=await fetch(base+route,{method:payload?'POST':'GET',headers:{...(token?{Authorization:'Bearer '+token}:{}),...(payload?{'Content-Type':'application/json'}:{})},
    ...(payload?{body:JSON.stringify(payload)}:{}),redirect:'error',signal:AbortSignal.timeout(5000)});
  const text=await response.text();return{status:response.status,body:response.headers.get('content-type')?.startsWith('application/json')?JSON.parse(text):text};
}
function schemaVersion(){const store=new DatabaseSync(db,{readOnly:true});try{return store.prepare('PRAGMA user_version').get().user_version;}finally{store.close();}}

try{
  check(preflight.status==='preflight_passed'&&preflight.applied===false&&report.archive_sha256===manifest.archive_sha256&&report.archive_sha256===preflight.archive_sha256,'reviewed_archive_and_remote_snapshot_match');
  const baselineArchive=path.join(artifactRoot,'io-server-20261012-r2.zip');
  check(sha(fs.readFileSync(baselineArchive))==='d9da06dd99f08aee9c73b9d0098b912771209a88e20a8b33c6eb496bb0c3c97b','exact_r2_baseline_archive');
  const extract=`import importlib.util,pathlib,sys,zipfile
spec=importlib.util.spec_from_file_location('release',sys.argv[1]);mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
archive=pathlib.Path(sys.argv[2]);root=pathlib.Path(sys.argv[3]).resolve();mod.inspect(archive)
with zipfile.ZipFile(archive) as z:
 for name in mod.FILES:
  target=(root/name).resolve();assert target.is_relative_to(root);target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(z.read(name))
`;
  const unpack=(script,source,target)=>execFileSync(python,['-I','-S','-B','-c',extract,path.join(root,'tools/phase1/'+script),source,target],{windowsHide:true,stdio:['ignore','pipe','pipe']});
  unpack('package-speaker-server-release.py',archive,unpacked);
  unpack('package-server-release.py',baselineArchive,work);
  for(const [name,expected] of Object.entries(preflight.before_sha256)){
    if(name==='docs/contracts/event-v1.2.schema.json'){check(expected===null||expected===manifest.files[name].sha256,'new_schema_baseline_absent_or_identical');continue;}
    check(sha(fs.readFileSync(path.join(work,name)))===expected,'baseline_hash_'+name);
  }
  const deps=path.join(root,'rebuild/material-server/node_modules');fs.symlinkSync(deps,path.join(current,'node_modules'),'junction');fs.symlinkSync(deps,path.join(next,'node_modules'),'junction');
  const phone=mint('release-phone',['materials:write','materials:read','changes:read','tasks:write','tasks:read','requests:read','answers:write','messages:receive']);
  const agent=mint('release-agent',['tasks:read','tasks:update','requests:write','receipts:agent']);
  let base=await start();const identity=(await api(base,'/v1/identity',phone.token)).body,version=schemaVersion();
  check(identity.capabilities?.includes('request_lifecycle_v1'),'baseline_has_request_lifecycle');
  function envelope(value){return {...structuredClone(value),event_id:randomUUID(),idempotency_key:randomUUID(),producer_id:'release-phone',created_at:new Date().toISOString(),expires_at:new Date(Date.now()+3600000).toISOString()};}
  const oldMaterial=envelope(readJson(path.join(root,'docs/contracts/material-v1.1.json')).events[2]);
  oldMaterial.body.material_id='release-legacy-material';oldMaterial.body.full_text.text='合成发布旧资料保留';
  const oldReceipt=await api(base,'/v1/material-events',phone.token,oldMaterial);check(oldReceipt.status===201,'baseline_accepts_legacy_material');
  const examples=readJson(path.join(root,'docs/contracts/material-v1.2.json')).events,first=envelope(examples[0]);
  check((await api(base,'/v1/material-events',phone.token,first)).body.error?.code==='UNSUPPORTED_SCHEMA_VERSION','old_runtime_refuses_material_1_2');
  const originalSchemas=['event-v1.schema.json','event-v1.1.schema.json'].map(name=>sha(fs.readFileSync(path.join(work,'docs/contracts/'+name))));
  fs.copyFileSync(path.join(unpacked,'docs/contracts/event-v1.2.schema.json'),path.join(work,'docs/contracts/event-v1.2.schema.json'));
  check((await api(base,'/v1/identity',phone.token)).body.material_schema_versions===undefined,'schema_addition_does_not_activate_old_validator');
  await stop();fs.renameSync(current,backup);fs.renameSync(next,current);base=await start();
  const upgradedIdentity=(await api(base,'/v1/identity',phone.token)).body;
  check(upgradedIdentity.server_id===identity.server_id&&schemaVersion()===version,'upgrade_keeps_identity_credentials_and_schema');
  check(upgradedIdentity.material_schema_versions?.includes('1.2'),'upgrade_advertises_material_1_2');
  check(upgradedIdentity.capabilities?.includes('request_lifecycle_v1'),'upgrade_keeps_existing_request_lifecycle');
  const replay=await api(base,'/v1/material-events',phone.token,oldMaterial);check(replay.status===200&&isDeepStrictEqual(replay.body,oldReceipt.body),'upgrade_keeps_original_receipt');
  const receipts=[];for(const value of examples){const e=envelope(value);const accepted=await api(base,'/v1/material-events',phone.token,e);check(accepted.status===201,'speaker_revision_'+e.body.revision);receipts.push({event:e,receipt:accepted.body});}
  check(receipts.length===4,'upgrade_accepts_speaker_revisions');
  const textEdit=envelope(receipts[3].event);Object.assign(textEdit.body,{revision:5,base_revision:4,text_revision:5});textEdit.body.utterances[0].text='合成发布人工更正。';textEdit.body.full_text.text=textEdit.body.utterances.map(u=>u.text).join('\n');textEdit.body.full_text.origin='user';
  const editReceipt=await api(base,'/v1/material-events',phone.token,textEdit);check(editReceipt.status===201,'upgrade_accepts_split_text_correction');
  const currentMaterial=(await api(base,'/v1/materials/'+first.body.material_id,phone.token)).body;
  check(currentMaterial.body.processing.boundary==='unknown'&&currentMaterial.body.utterances[0].start_ms===null&&isDeepStrictEqual(currentMaterial.body.utterances[0].source_range,examples[3].body.utterances[0].source_range),'upgrade_preserves_split_and_corrected_source');
  check(currentMaterial.body.audio.state==='local'&&currentMaterial.body.audio.object_id===null&&currentMaterial.body.audio.sha256===null,'upgrade_does_not_claim_audio_archive');
  // Source-only rollback keeps the same live database and additive unused schema.
  await stop();const rejected=path.join(work,'rebuild/.material-server-new');fs.renameSync(current,rejected);fs.renameSync(backup,current);base=await start();
  check(schemaVersion()===version,'rollback_keeps_main_database_schema');
  const rollbackIdentity=(await api(base,'/v1/identity',phone.token)).body;
  check(rollbackIdentity.server_id===identity.server_id,'rollback_keeps_identity_and_credentials');
  check(rollbackIdentity.capabilities?.includes('request_lifecycle_v1'),'rollback_keeps_existing_request_lifecycle');
  check(rollbackIdentity.material_schema_versions===undefined,'rollback_does_not_advertise_material_1_2');
  const retained=(await api(base,'/v1/materials/'+first.body.material_id,phone.token)).body;
  check(retained.schema_version==='1.2'&&isDeepStrictEqual(retained.body,currentMaterial.body),'rollback_keeps_material_1_2_json');
  check((await api(base,'/v1/events/'+textEdit.event_id,phone.token)).body.receipt.receipt_id===editReceipt.body.receipt.receipt_id,'rollback_keeps_original_receipt');
  const future=envelope(textEdit);Object.assign(future.body,{revision:6,base_revision:5,text_revision:6});
  check((await api(base,'/v1/material-events',phone.token,future)).body.error?.code==='UNSUPPORTED_SCHEMA_VERSION','rollback_refuses_new_1_2_events');
  check(fs.existsSync(path.join(work,'docs/contracts/event-v1.2.schema.json')),'additive_schema_retained_on_rollback');
  check(['event-v1.schema.json','event-v1.1.schema.json'].every((name,i)=>sha(fs.readFileSync(path.join(work,'docs/contracts/'+name)))===originalSchemas[i]),'original_schemas_unchanged');
  check((await api(base,'/v1/materials/release-legacy-material',phone.token)).body.body.full_text.text===oldMaterial.body.full_text.text,'rollback_keeps_legacy_material');
  report.status='passed';
}catch(error){report.error='LOCAL_RELEASE_REHEARSAL_FAILED';report.failure_code=error?.code??null;if(/^[a-zA-Z][a-zA-Z0-9_./-]{2,150}$/.test(error?.message??''))report.failed_check=error.message;}
finally{
  try{await stop();}catch{report.status='failed';report.error='LOCAL_PROCESS_STOP_NOT_CONFIRMED';}
  try{const actual=fs.realpathSync(work),base=fs.realpathSync(artifactRoot);assert(path.dirname(actual)===base&&path.basename(actual).startsWith('release-rehearsal-')&&!fs.lstatSync(work).isSymbolicLink(),'CLEANUP_SCOPE_INVALID');fs.rmSync(work,{recursive:true,force:true});}catch{report.status='failed';report.cleanup='not_confirmed';}
}
fs.writeFileSync(path.join(root,'rebuild/phase1/'+releaseId+'-rehearsal.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({status:report.status,checks:report.checks.length,error:report.error??null}));process.exitCode=report.status==='passed'?0:1;
