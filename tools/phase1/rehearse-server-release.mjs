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
const {values:args}=parseArgs({options:{'release-id':{type:'string',default:'io-server-20261012-r1'},
  'baseline-ref':{type:'string',default:'e2052f8'},scenario:{type:'string',default:'baseline'}}});
const releaseId=args['release-id'],baselineRef=args['baseline-ref'],lifecycle=args.scenario==='request-lifecycle';
assert(/^[a-z0-9][a-z0-9-]{0,63}$/.test(releaseId),'RELEASE_ID_INVALID');
assert(/^[a-f0-9]{7,40}$/.test(baselineRef),'BASELINE_COMMIT_INVALID');
assert(['baseline','request-lifecycle'].includes(args.scenario),'REHEARSAL_SCENARIO_INVALID');
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
  const extraction=`import importlib.util,pathlib,sys,zipfile
spec=importlib.util.spec_from_file_location('release',sys.argv[1]); mod=importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)
archive=pathlib.Path(sys.argv[2]); root=pathlib.Path(sys.argv[3]).resolve(); mod.inspect(archive)
with zipfile.ZipFile(archive) as z:
 for name in mod.FILES:
  target=(root/name).resolve(); assert target.is_relative_to(root)
  target.parent.mkdir(parents=True,exist_ok=True); target.write_bytes(z.read(name))
`;
  execFileSync(python,['-I','-S','-B','-c',extraction,path.join(root,'tools/phase1/package-server-release.py'),archive,unpacked],{windowsHide:true,stdio:['ignore','pipe','pipe']});
  for(const [name,expected] of Object.entries(preflight.before_sha256)){
    if(!expected)continue;
    // Unchanged files can retain deployment CRLF bytes absent from the Git
    // blob. The archive is allowed only when its exact hash equals production.
    const bytes=manifest.files[name].sha256===expected?fs.readFileSync(path.join(unpacked,name)):
      execFileSync('git',['show',baselineRef+':'+name],{cwd:root,windowsHide:true,maxBuffer:1048576});
    check(sha(bytes)===expected,'baseline_hash_'+name);
    const target=path.join(work,name);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,bytes);
  }
  const deps=path.join(root,'rebuild/material-server/node_modules');
  fs.symlinkSync(deps,path.join(current,'node_modules'),'junction');fs.symlinkSync(deps,path.join(next,'node_modules'),'junction');
  // New/old directories share the unchanged schemas, dependency versions and DB.
  const phone=mint('release-phone',['materials:write','materials:read','tasks:write','tasks:read','requests:read','answers:write','messages:receive']);
  const agent=mint('release-agent',['tasks:read','tasks:update','requests:write','receipts:agent']);
  let base=await start();const identity=(await api(base,'/v1/identity',phone.token)).body;const version=schemaVersion();
  check((await api(base,'/v1/admin')).status===(lifecycle?200:401),'baseline_admin_shell_matches_selected_scenario');
  if(lifecycle)check(!identity.capabilities?.includes('request_lifecycle_v1'),'baseline_does_not_advertise_request_lifecycle');
  const material=readJson(path.join(root,'docs/contracts/material-v1.1.json')).events[2];
  Object.assign(material,{event_id:randomUUID(),idempotency_key:randomUUID(),producer_id:'release-phone',created_at:new Date().toISOString(),expires_at:new Date(Date.now()+3600000).toISOString()});
  Object.assign(material.body,{material_id:'release-material',revision:1,base_revision:0,text_revision:1});material.body.full_text.text='合成发布演练，保留此修订和原回执';
  const saved=await api(base,'/v1/material-events',phone.token,material);check(saved.status===201,'old_runtime_accepts_synthetic_material');
  const task=readJson(path.join(root,'docs/contracts/normal.json')).events.find(e=>e.kind==='task');
  Object.assign(task,{event_id:randomUUID(),idempotency_key:randomUUID(),producer_id:'release-phone',created_at:new Date().toISOString(),expires_at:new Date(Date.now()+60000).toISOString()});
  Object.assign(task.body,{task_id:'release-task',command:'合成发布演练，不执行真实任务',allow_create_session:false});
  check((await api(base,'/v1/tasks',phone.token,task)).status===201,'old_runtime_accepts_synthetic_task');
  const questions={};let acceptedAnswer;
  function envelope(kind,producer,body,expiresAt=new Date(Date.now()+3600000).toISOString()){
    return {schema_version:'1.0',event_id:randomUUID(),idempotency_key:randomUUID(),kind,producer_id:producer,
      created_at:new Date().toISOString(),expires_at:expiresAt,body};
  }
  if(lifecycle){
    for(const label of ['expire','withdraw','answered']){
      const body=structuredClone(readJson(path.join(root,'docs/contracts/normal.json')).events.find(e=>e.kind==='request').body);
      Object.assign(body,{request_id:'release-question-'+label,task_id:task.body.task_id,route:task.body.route,runtime_request_id:'synthetic-'+label});
      const event=envelope('request','release-agent',body,label==='expire'?new Date(Date.now()+3000).toISOString():undefined);
      check((await api(base,'/v1/requests',agent.token,event)).status===201,'baseline_accepts_existing_question_'+label);
      questions[label]=event;
    }
    const body=structuredClone(readJson(path.join(root,'docs/contracts/normal.json')).events.find(e=>e.kind==='answer').body);
    Object.assign(body,{answer_id:'release-answer-before-upgrade',request_id:questions.answered.body.request_id,task_id:task.body.task_id,route:task.body.route});
    acceptedAnswer=envelope('answer','release-phone',body);
    check((await api(base,'/v1/answers',phone.token,acceptedAnswer)).status===201,'baseline_accepts_answer_before_upgrade');
  }
  await stop();fs.renameSync(current,backup);fs.renameSync(next,current);base=await start();
  check(schemaVersion()===version,'upgrade_keeps_main_database_schema');
  check((await api(base,'/v1/identity',phone.token)).body.server_id===identity.server_id,'upgrade_keeps_identity_and_credentials');
  const replay=await api(base,'/v1/material-events',phone.token,material);
  check(replay.status===200&&isDeepStrictEqual(replay.body,saved.body),'upgrade_keeps_original_receipt_and_deduplication');
  check((await api(base,'/v1/tasks/release-task',phone.token)).body.command_expires_at===task.expires_at,'upgrade_recovers_original_command_deadline_from_old_task');
  const update={...structuredClone(task),event_id:randomUUID(),idempotency_key:randomUUID(),producer_id:'release-agent',created_at:new Date().toISOString(),expires_at:new Date(Date.now()+3600000).toISOString(),body:{...task.body,revision:2,state:'agent_received'}};
  check((await api(base,'/v1/tasks',agent.token,update)).status===201,'upgraded_runtime_accepts_synthetic_status_revision');
  check((await api(base,'/v1/tasks/release-task',phone.token)).body.command_expires_at===task.expires_at,'status_update_does_not_extend_command_deadline');
  check((await api(base,'/v1/admin')).status===200,'upgraded_runtime_serves_read_only_shell');
  check((await api(base,'/v1/operations/summary',phone.token)).status===403,'phone_identity_cannot_read_admin_statistics');
  const ops=mint('release-ops',['operations:read']);const summary=await api(base,'/v1/operations/summary',ops.token);
  check(summary.status===200&&summary.body.traffic.available===true&&summary.body.traffic.totals.requests>0,'upgraded_runtime_records_authenticated_body_bytes_in_sidecar');
  let expiryReceiptId,withdrawalReceiptId;
  const closingReceipts=(item,state)=>item.receipts.filter(r=>r.subject_kind==='request'&&r.actor_id==='server-lifecycle'&&r.stage===(state==='expired'?'expired':'cancelled'));
  async function reconcile(event){return api(base,'/v1/requests/'+event.body.request_id+'/reconcile',agent.token,{schema_version:'1.0',request_revision:1});}
  if(lifecycle){
    check((await api(base,'/v1/identity',agent.token)).body.capabilities?.includes('request_lifecycle_v1'),'upgrade_advertises_request_lifecycle');
    await new Promise(resolve=>setTimeout(resolve,Math.max(0,Date.parse(questions.expire.expires_at)-Date.now()+30)));
    const expired=await reconcile(questions.expire);
    check(expired.status===200&&expired.body.changed===true&&expired.body.reason==='deadline'&&expired.body.item.state==='expired','upgrade_closes_preexisting_expired_question');
    check(expired.body.item.revision===1&&expired.body.item.event_id===questions.expire.event_id&&expired.body.item.expires_at===questions.expire.expires_at&&isDeepStrictEqual(expired.body.item.body,questions.expire.body),'expiry_preserves_original_question_envelope');
    const expiryFacts=closingReceipts(expired.body.item,'expired');
    check(expiryFacts.length===1&&expiryFacts[0].subject_revision===1&&expiryFacts[0].related_event_id===questions.expire.event_id,'expiry_has_one_separate_request_receipt');
    expiryReceiptId=expiryFacts[0].receipt_id;
    const duplicate=await reconcile(questions.expire);
    check(duplicate.status===200&&duplicate.body.changed===false&&closingReceipts(duplicate.body.item,'expired')[0]?.receipt_id===expiryReceiptId,'repeated_expiry_retains_same_receipt');
    const cancel=envelope('task','release-agent',{...task.body,revision:3,state:'cancel_requested'});
    check((await api(base,'/v1/tasks',agent.token,cancel)).status===201,'upgrade_accepts_parent_cancel_request');
    const withdrawn=await reconcile(questions.withdraw);
    check(withdrawn.status===200&&withdrawn.body.changed===true&&withdrawn.body.reason==='task_closed'&&withdrawn.body.item.state==='withdrawn','upgrade_withdraws_question_after_parent_cancel');
    const withdrawalFacts=closingReceipts(withdrawn.body.item,'withdrawn');
    check(withdrawalFacts.length===1&&withdrawalFacts[0].subject_id===questions.withdraw.body.request_id,'withdrawal_records_request_not_task_cancelled');
    withdrawalReceiptId=withdrawalFacts[0].receipt_id;
    const parent=(await api(base,'/v1/tasks/release-task',phone.token)).body;
    check(parent.state==='cancel_requested'&&!parent.receipts.some(r=>r.stage==='cancelled'),'question_closure_does_not_fabricate_task_cancelled');
    const answered=await reconcile(questions.answered);
    check(answered.status===200&&answered.body.changed===false&&answered.body.item.state==='answered'&&answered.body.item.answer.object_id===acceptedAnswer.body.answer_id,'accepted_answer_survives_parent_cancel');
  }
  await stop();const failed=path.join(work,'rebuild/.material-server-new');fs.renameSync(current,failed);fs.renameSync(backup,current);base=await start();
  check(schemaVersion()===version,'code_only_rollback_keeps_database_schema');
  check((await api(base,'/v1/identity',phone.token)).body.server_id===identity.server_id,'rollback_keeps_server_identity_and_credentials');
  check((await api(base,'/v1/materials/release-material',phone.token)).body.body.full_text.text===material.body.full_text.text,'rollback_keeps_preexisting_material');
  check((await api(base,'/v1/events/'+material.event_id,phone.token)).body.receipt.receipt_id===saved.body.receipt.receipt_id,'rollback_keeps_original_receipt_id');
  check((await api(base,'/v1/tasks/release-task',phone.token)).body.revision===(lifecycle?3:2),'rollback_keeps_revision_written_after_upgrade');
  check((await api(base,'/v1/admin')).status===(lifecycle?200:401)&&fs.existsSync(db+'.traffic.sqlite'),'rollback_restores_baseline_shell_and_retains_sidecar');
  if(lifecycle){
    check(!(await api(base,'/v1/identity',agent.token)).body.capabilities?.includes('request_lifecycle_v1'),'rollback_stops_advertising_new_capability');
    for(const [label,state,receipt]of [['expire','expired',expiryReceiptId],['withdraw','withdrawn',withdrawalReceiptId]]){
      const item=(await api(base,'/v1/requests/'+questions[label].body.request_id,phone.token)).body;
      check(item.state===state&&item.revision===1&&isDeepStrictEqual(item.body,questions[label].body)&&closingReceipts(item,state)[0]?.receipt_id===receipt,'rollback_keeps_question_and_closure_'+label);
    }
    const answer=(await api(base,'/v1/requests/'+questions.answered.body.request_id,phone.token)).body;
    check(answer.state==='answered'&&answer.answer.object_id===acceptedAnswer.body.answer_id,'rollback_keeps_preexisting_accepted_answer');
    const replayAnswer=await api(base,'/v1/answers',phone.token,acceptedAnswer);
    check(replayAnswer.status===200,'rollback_preserves_accepted_answer_deduplication');
    const late=envelope('answer','release-phone',{...acceptedAnswer.body,answer_id:'release-late-answer',request_id:questions.withdraw.body.request_id});
    const rejected=await api(base,'/v1/answers',phone.token,late);
    check(rejected.status===410&&rejected.body.error?.code==='REQUEST_CLOSED','rollback_rejects_answer_to_closed_question');
  }
  report.status='passed';
}catch(error){report.error='LOCAL_RELEASE_REHEARSAL_FAILED';report.failure_code=error?.code??null;
  if(/^[a-zA-Z][a-zA-Z0-9_./-]{2,150}$/.test(error?.message??''))report.failed_check=error.message;}
finally{
  try{await stop();}catch{report.status='failed';report.error='LOCAL_PROCESS_STOP_NOT_CONFIRMED';}
  try{
    const actual=fs.realpathSync(work),base=fs.realpathSync(artifactRoot);
    assert(path.dirname(actual)===base&&path.basename(actual).startsWith('release-rehearsal-')&&!fs.lstatSync(work).isSymbolicLink(),'CLEANUP_SCOPE_INVALID');
    fs.rmSync(work,{recursive:true,force:true});
  }catch{report.status='failed';report.cleanup='not_confirmed';}
}
fs.writeFileSync(path.join(root,'rebuild/phase1/'+releaseId+'-rehearsal.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({status:report.status,checks:report.checks.length,error:report.error??null}));
process.exitCode=report.status==='passed'?0:1;
