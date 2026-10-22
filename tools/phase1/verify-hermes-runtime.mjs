// Real local authenticated queue -> bridge -> Python adapter -> installed ACP ->
// actual MCP tools -> synthetic model continuation -> durable result. No cloud,
// real user home, provider, office tools or hardware is used by this verifier.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {randomUUID,createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {MaterialStore} from '../../rebuild/material-server/store.mjs';
import {listen} from '../../rebuild/material-server/http.mjs';
import {AgentBridge} from '../../rebuild/agent-bridge/bridge.mjs';
import {AdapterHost} from '../../rebuild/agent-bridge/adapter-host.mjs';
import {BridgeError} from '../../rebuild/agent-bridge/client.mjs';

const args=process.argv.slice(2),option=(name,fallback)=>args.includes(name)?args[args.indexOf(name)+1]:fallback;
const root=fileURLToPath(new URL('../../',import.meta.url));
const python=option('--python','D:/APP/hermes/installs/712bb20a9e2cdd0b/environments/5e0869adbda74f8a9156d4b7944add81/venv/Scripts/python.exe');
const packages=option('--site-packages',path.join(path.dirname(path.dirname(python)),'Lib','site-packages'));
const source=option('--source','D:/APP/hermes/hermes-agent');
const withReconciliation=args.includes('--with-reconciliation');
const withLifecycle=args.includes('--with-lifecycle');
const withAdmission=args.includes('--with-admission');
const withAnswerIntake=args.includes('--with-answer-intake');
if([withReconciliation,withLifecycle,withAdmission,withAnswerIntake].filter(Boolean).length>1)throw new Error('SELECT_ONE_EXTENDED_SCENARIO');
const output=option('--output',path.join(root,`rebuild/phase1/hermes-managed${withReconciliation?'-reconciliation':withLifecycle?'-lifecycle':withAdmission?'-admission':withAnswerIntake?'-answer-intake':''}-runtime-${withAnswerIntake?'2026-10-13':'2026-10-12'}.json`));
const fixture=path.join(root,'tools/phase1/hermes-runtime-fixture.py');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'io-managed-runtime-'));
const report={at:new Date().toISOString(),passed:false,checks:[],scope:'real local authenticated HTTP queue, bridge outbox, adapter stdio, installed Hermes ACP/MCP and scoped tools; model conversation is synthetic',
  not_verified:['real model/provider or executable office tools','cloud/phone/glasses task end-to-end','original CLI/TUI attachment','owner restart restoring live tool stack','production enrollment, ACLs and retention']};
let store,server,bridge,testAgentToken,testHome;
const checked=caseName=>report.checks.push({case:caseName,passed:true});
const prompts=home=>{const file=path.join(home,'synthetic-prompts.ndjson');return fs.existsSync(file)?fs.readFileSync(file,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse):[];};
try{
  store=new MaterialStore(path.join(dir,'server.sqlite'));
  const phone=store.mint({owner:'synthetic-owner',producer:'synthetic-phone',scopes:['tasks:write','tasks:read','requests:read','answers:write','messages:receive','receipts:phone']});
  const agent=store.mint({owner:'synthetic-owner',producer:'synthetic-pc',scopes:['tasks:read','tasks:update','requests:write','messages:receive','messages:write','receipts:agent']});
  testAgentToken=agent.token;
  server=await listen(store);
  const identity=store.identity(agent.token),binding={server_id:identity.server_id,owner_id:identity.owner_id,producer_id:identity.producer_id,computer_id:'synthetic-computer',agent_id:'synthetic-agent'};
  const home=path.join(dir,'home'),cwd=path.join(dir,'workspace');fs.mkdirSync(home);fs.mkdirSync(cwd);
  testHome=home;
  const sessions={'synthetic-managed-session':{project_id:'synthetic-project',cwd}};
  fs.writeFileSync(path.join(home,'.turboio-runtime-synthetic'),'synthetic-only');
  fs.writeFileSync(path.join(home,'.turboio-managed.json'),JSON.stringify({schema:1,binding,sessions}));
  fs.writeFileSync(path.join(home,'config.yaml'),'{}\n');
  const config={home,journal:path.join(home,'journal.sqlite'),binding,sessions,source,site_packages:packages};
  const configFile=path.join(dir,'runtime.json');fs.writeFileSync(configFile,JSON.stringify(config),{mode:0o600});
  const prepared=spawnSync(python,['-I','-S','-B',fixture,'prepare',configFile],{encoding:'utf8',timeout:15000,windowsHide:true});
  assert.equal(prepared.status,0,'SYNTHETIC_SESSION_PREPARE_FAILED');
  const credential=path.join(dir,'credential.json');fs.writeFileSync(credential,JSON.stringify(agent),{mode:0o600});
  const bridgeConfig={schema_version:'1.0',base_url:`http://127.0.0.1:${server.address().port}/v1/`,...binding,
    credential_file:credential,allow_loopback_http:true,state_file:path.join(dir,'bridge-state.json')};
  let admissionHost,answerIntakeHost,executableIntakeCalls=0,executableAnswerCalls=0;
  function makeBridge(dropAdmissionReply=false,dropAnswerReply=false){
    const host=new AdapterHost({command:python,args:['-I','-S','-B','-X','utf8=0',fixture,'adapter',configFile],env:{PYTHONIOENCODING:'cp936'},timeoutMs:30000,name:'hermes-managed-synthetic'});
    if(!dropAdmissionReply&&!dropAnswerReply)return new AgentBridge({config:bridgeConfig,adapter:host});
    admissionHost=host;
    if(dropAnswerReply)answerIntakeHost=host;
    const wrapped={name:'synthetic-lost-local-intake-reply',get capabilities(){return host.capabilities;},start:()=>host.start(),stop:()=>host.stop(),
      onItem:async(item,context)=>{const result=await host.onItem(item,context);
        if(dropAdmissionReply&&item.object_id==='synthetic-task-lost-intake'){executableIntakeCalls++;throw new BridgeError('ADAPTER_EXITED',{permanent:true});}return result;},
      onAnswer:async(value,context)=>{const result=await host.onAnswer(value,context);
        if(dropAnswerReply&&value.request.body.task_id==='synthetic-task-lost-answer'){executableAnswerCalls++;throw new BridgeError('ADAPTER_EXITED',{permanent:true});}return result;},
      onRequestClosed:(value,context)=>host.onRequestClosed(value,context),inspectAnswerIntake:value=>host.inspectAnswerIntake(value),
      inspectAdmission:value=>host.inspectAdmission(value),pollEvents:()=>host.pollEvents(),acknowledgeEvents:ids=>host.acknowledgeEvents(ids)};
    return new AgentBridge({config:bridgeConfig,adapter:wrapped});
  }
  bridge=makeBridge();await bridge.start();checked('real adapter declares capabilities only after pinned runtime and exclusive enrolled home checks');
  const route={computer_id:binding.computer_id,agent_id:binding.agent_id,project_id:'synthetic-project',session_id:'synthetic-managed-session'};
  const submit=(kind,body,asAgent=false)=>store.queueSubmit(asAgent?agent.token:phone.token,{schema_version:'1.0',event_id:randomUUID(),idempotency_key:randomUUID(),kind,
    producer_id:asAgent?'synthetic-pc':'synthetic-phone',created_at:new Date().toISOString(),expires_at:new Date(Date.now()+3600000).toISOString(),body},kind);
  const task=(id,command)=>({task_id:id,revision:1,route,command,state:'queued',allow_create_session:false});
  submit('task',task('synthetic-task-first','SYNTHETIC_ASK_THEN_WAIT'));
  submit('task',task('synthetic-task-second','SYNTHETIC_FINISH_AFTER_BUSY'));
  async function until(predicate,label){
    const deadline=Date.now()+45000;
    while(Date.now()<deadline){await bridge.pollOnce();const value=predicate();if(value)return value;await new Promise(resolve=>setTimeout(resolve,80));}
    throw new Error(label);
  }
  const request=await until(()=>{const ids=Object.keys(bridge.state.requests());return ids.length?store.queueGet(agent.token,'request',ids[0]):null;},'QUESTION_NOT_PUBLISHED');
  assert.equal(request.body.task_id,'synthetic-task-first');assert.deepEqual(request.body.route,route);
  assert.equal(request.body.question,'合成问题🙂：是否保留中文附加条件？');
  assert.equal(store.queueGet(agent.token,'task','synthetic-task-first').state,'waiting_answer');
  assert.equal(prompts(home).length,1);checked('first actual ACP/MCP question keeps original prompt active while second task is durably queued');
  submit('answer',{answer_id:'synthetic-answer',request_id:request.object_id,request_revision:request.revision,task_id:request.body.task_id,route,
    option_id:null,text:'Synthetic bridge response only',input_source:'phone',raw_action:null});
  await until(()=>store.queueGet(agent.token,'task','synthetic-task-second').state==='completed','TASKS_NOT_COMPLETED');
  const first=store.queueGet(agent.token,'task','synthetic-task-first');assert.equal(first.state,'completed');
  assert.deepEqual(prompts(home).map(v=>v.text),['SYNTHETIC_ASK_THEN_WAIT','SYNTHETIC_FINISH_AFTER_BUSY']);
  const continuation=JSON.parse(fs.readFileSync(path.join(home,'synthetic-continuation.json'),'utf8'));
  assert.equal(continuation.session_id,route.session_id);assert.equal(continuation.request_id,request.object_id);assert.equal(continuation.answer_id,'synthetic-answer');
  assert(first.receipts.some(v=>v.stage==='task_resumed'));assert(first.receipts.some(v=>v.stage==='task_completed'));
  checked('authenticated answer reaches original live wait once; consumption, completion and second FIFO task are distinct');
  const messages=store.inbox(phone.token,{limit:50}).items.filter(v=>v.kind==='message').map(v=>store.queueGet(phone.token,'message',v.object_id));
  assert.equal(messages.length,2);assert(messages.some(v=>v.body.task_id==='synthetic-task-first'&&v.body.text==='Synthetic original task continued after its answer，中文🙂'));
  assert(messages.every(v=>v.body.channel==='result'));for(const message of messages)assert.deepEqual(message.body.route,route);
  checked('actual native result evidence produces routed durable result messages, not ACP end_turn alone');
  submit('task',task('synthetic-task-cancel','SYNTHETIC_WAIT_FOR_CANCEL'));
  await until(()=>prompts(home).length===3,'CANCEL_TASK_NOT_RUNNING');
  const active=store.queueGet(agent.token,'task','synthetic-task-cancel');
  submit('task',{...active.body,revision:active.revision+1,state:'cancel_requested'},true);
  await until(()=>store.queueGet(agent.token,'task','synthetic-task-cancel').state==='cancelled','CANCEL_NOT_CONFIRMED');
  checked('cancel request reaches real ACP interrupt; cancelled requires raw interruption and confirmed owned process-tree shutdown');
  await bridge.stop();bridge=makeBridge();await bridge.start();
  for(let n=0;n<3;n++)await bridge.pollOnce();assert.equal(prompts(home).length,3);
  checked('bridge and adapter restart replay no native prompt for already settled operations');
  if(withAdmission){
    await bridge.stop();bridge=makeBridge(true);await bridge.start();
    submit('task',task('synthetic-task-lost-intake','SYNTHETIC_FINISH_AFTER_BUSY'));
    await assert.rejects(bridge.pollOnce(),e=>e.code==='ADAPTER_EXITED');
    assert.equal(bridge.state.value.dispatches['item:task:synthetic-task-lost-intake:1'].state,'prepared');
    const deadline=Date.now()+45000;let completed=false;
    while(Date.now()<deadline){
      const events=await admissionHost.pollEvents();
      completed=events.some(e=>e.delivery_id==='item:task:synthetic-task-lost-intake:1'&&e.actions.some(a=>a.action==='task_state'&&a.state==='completed'));
      if(completed)break;await new Promise(resolve=>setTimeout(resolve,80));
    }
    assert(completed,'NATIVE_INTAKE_NOT_COMPLETED');
    assert.equal(store.queueGet(agent.token,'task','synthetic-task-lost-intake').state,'queued');
    assert.equal(prompts(home).length,4);
    checked('actual managed adapter persists intake and native result while simulated lost local reply leaves bridge prepared and cloud task queued');
    await bridge.stop();bridge=makeBridge();await bridge.start();
    await until(()=>store.queueGet(agent.token,'task','synthetic-task-lost-intake').state==='completed','ADMITTED_TASK_NOT_RECONCILED');
    const audit=bridge.state.value.intake_reconciliations['item:task:synthetic-task-lost-intake:1'];
    assert(audit&&/^op-[a-f0-9]{64}$/.test(audit.operation_id));
    assert.equal(executableIntakeCalls,1);assert.equal(prompts(home).length,4);
    assert.equal(bridge.state.value.dispatches['item:task:synthetic-task-lost-intake:1'],undefined);
    checked('restarted adapter proves the original atomic admission over actual stdio; bridge restores empty intake response and uploads original runtime events without another native prompt');
    submit('task',task('synthetic-task-after-intake','SYNTHETIC_FINISH_AFTER_BUSY'));
    await until(()=>store.queueGet(agent.token,'task','synthetic-task-after-intake').state==='completed','AFTER_INTAKE_QUEUE_STUCK');
    assert.equal(prompts(home).length,5);assert.equal(Object.keys(bridge.state.value.intake_reconciliations).length,1);
    report.admission={lost_local_reply_is_synthetic:true,actual_adapter_restarted:true,model_is_synthetic:true,
      task_prompt_count:1,intake_reconciled:true,next_task_completed:true,answer_or_cancel_recovery:false,crash_wait_stack_recovered:false};
    checked('subsequent queued task completes while the durable intake audit remains separate from task completion');
  }
  if(withAnswerIntake){
    await bridge.stop();bridge=makeBridge(false,true);await bridge.start();
    submit('task',task('synthetic-task-lost-answer','SYNTHETIC_ASK_THEN_WAIT'));
    const pending=await until(()=>{
      for(const id of Object.keys(bridge.state.requests())){const value=store.queueGet(agent.token,'request',id);
        if(value.body.task_id==='synthetic-task-lost-answer')return value;}return null;
    },'LOST_ANSWER_QUESTION_NOT_PUBLISHED');
    submit('answer',{answer_id:'synthetic-lost-reply-answer',request_id:pending.object_id,request_revision:1,
      task_id:pending.body.task_id,route,option_id:null,text:'Synthetic bridge response only',input_source:'phone',raw_action:null});
    await assert.rejects(bridge.pollOnce(),e=>e.code==='ADAPTER_EXITED');
    const key=`answer:${pending.object_id}:1:synthetic-lost-reply-answer`;
    assert.equal(bridge.state.value.dispatches[key].state,'prepared');
    assert.equal(bridge.state.value.dispatches[key].answer.object_id,'synthetic-lost-reply-answer');
    const deadline=Date.now()+45000;let completed=false;
    while(Date.now()<deadline){
      completed=(await answerIntakeHost.pollEvents()).some(e=>e.delivery_id==='item:task:synthetic-task-lost-answer:1'&&
        e.actions.some(a=>a.action==='task_state'&&a.state==='completed'));
      if(completed)break;await new Promise(resolve=>setTimeout(resolve,80));
    }
    assert(completed,'ORIGINAL_WAIT_DID_NOT_CONSUME_ANSWER');
    assert.equal(store.queueGet(agent.token,'task','synthetic-task-lost-answer').state,'waiting_answer');
    assert.equal(prompts(home).filter(v=>v.text==='SYNTHETIC_ASK_THEN_WAIT').length,2);
    checked('actual runtime stores and consumes answer while injected lost local reply leaves bridge prepared and task completion unpublished');
    await bridge.stop();bridge=makeBridge();await bridge.start();
    await until(()=>store.queueGet(agent.token,'task','synthetic-task-lost-answer').state==='completed','ANSWER_INTAKE_NOT_RECONCILED');
    assert.equal(executableAnswerCalls,1);assert.equal(bridge.inspectLocalStatus().reconciled_answers,1);
    assert.equal(bridge.state.value.dispatches[key],undefined);assert.equal(Object.keys(bridge.state.requests()).length,0);
    const resumed=store.queueGet(agent.token,'task','synthetic-task-lost-answer');
    assert.equal(resumed.receipts.filter(r=>r.stage==='task_resumed').length,1);
    assert.equal(resumed.receipts.filter(r=>r.stage==='task_completed').length,1);
    const answer=store.queueGet(agent.token,'request',pending.object_id).answer;
    assert.equal(answer.receipts.filter(r=>r.stage==='agent_received').length,1);
    checked('restarted adapter proves exact durable answer intake through stdio without another onAnswer; original runtime events alone prove resume and completion');
    submit('task',task('synthetic-task-after-answer-intake','SYNTHETIC_FINISH_AFTER_BUSY'));
    await until(()=>store.queueGet(agent.token,'task','synthetic-task-after-answer-intake').state==='completed','AFTER_ANSWER_INTAKE_QUEUE_STUCK');
    assert.equal(prompts(home).length,5);assert.equal(Object.keys(bridge.state.value.answer_intake_reconciliations).length,1);
    report.answer_intake={lost_local_reply_is_synthetic:true,actual_adapter_restarted:true,model_is_synthetic:true,
      executable_answer_deliveries:1,answer_intake_reconciled:true,task_prompt_count:1,next_task_completed:true,
      hard_process_crash:false,crash_wait_stack_recovered:false,cancel_or_closed_handoff_recovery:false};
    checked('next FIFO task completes and durable answer intake audit remains distinct from user reply and task completion');
  }
  if(withLifecycle){
    submit('task',task('synthetic-task-expiring','SYNTHETIC_WAIT_FOR_EXPIRY'));
    const expiryRequest=await until(()=>{
      for(const id of Object.keys(bridge.state.requests())){
        const value=store.queueGet(agent.token,'request',id);if(value.body.task_id==='synthetic-task-expiring')return value;
      }
      return null;
    },'EXPIRING_QUESTION_NOT_PUBLISHED');
    await until(()=>store.queueGet(agent.token,'task','synthetic-task-expiring').state==='completed','EXPIRED_QUESTION_WAIT_NOT_RELEASED');
    const closed=store.queueGet(agent.token,'request',expiryRequest.object_id);
    assert.equal(closed.state,'expired');assert.equal(closed.revision,expiryRequest.revision);assert.equal(closed.event_id,expiryRequest.event_id);assert.equal(closed.answer,null);
    assert(closed.receipts.some(r=>r.subject_kind==='request'&&r.stage==='expired'&&r.subject_revision===closed.revision));
    const returned=JSON.parse(fs.readFileSync(path.join(home,'synthetic-expiry.json'),'utf8'));
    assert.equal(returned.request_id,closed.object_id);assert.equal(returned.state,'expired');assert.equal(returned.answer_present,false);
    const expiredTask=store.queueGet(agent.token,'task','synthetic-task-expiring');
    assert(!expiredTask.receipts.some(r=>r.stage==='task_resumed'));
    const db=new DatabaseSync(config.journal,{readOnly:true});
    try{const row=db.prepare('SELECT state,answer,consumed FROM questions WHERE request_id=?').get(closed.object_id);
      assert.equal(row.state,'expired');assert.equal(row.answer,null);assert.equal(row.consumed,0);
    }finally{db.close();}
    checked('server deadline reaches original actual ACP/MCP wait as expired without answer intake or task-resumed receipt');
    submit('task',task('synthetic-task-after-expiry','SYNTHETIC_FINISH_AFTER_BUSY'));
    await until(()=>store.queueGet(agent.token,'task','synthetic-task-after-expiry').state==='completed','AFTER_EXPIRY_QUEUE_STUCK');
    assert.equal(prompts(home).filter(p=>p.text==='SYNTHETIC_WAIT_FOR_EXPIRY').length,1);
    report.lifecycle={question_expired:true,original_revision_unchanged:true,answer_present:false,answer_consumed:false,
      task_resumed:false,next_task_completed:true,model_is_synthetic:true};
    checked('expired question is never re-asked or replayed and the next queued synthetic task finishes');
  }
  if(withReconciliation){
    submit('task',task('synthetic-task-unknown','SYNTHETIC_CRASH_WITHOUT_RESULT'));
    submit('task',task('synthetic-task-after-review','SYNTHETIC_FINISH_AFTER_BUSY'));
    await until(()=>store.queueGet(agent.token,'task','synthetic-task-unknown').state==='execution_unknown','CRASH_NOT_UNKNOWN');
    for(let n=0;n<3;n++)await bridge.pollOnce();
    assert.equal(prompts(home).length,4);
    assert.equal(store.queueGet(agent.token,'task','synthetic-task-after-review').state,'agent_received');
    checked('actual installed ACP child crash records execution_unknown and blocks following admitted work without replay');
    const cli=path.join(root,'rebuild/agent-bridge/hermes/reconcile_cli.py');
    const operation='op-'+createHash('sha256').update(JSON.stringify('synthetic-task-unknown')).digest('hex');
    const inspect=()=>{
      const result=spawnSync(python,['-I','-S','-B',cli,'inspect','--config',configFile,'--operation',operation],{encoding:'utf8',timeout:10000,windowsHide:true});
      assert.equal(result.status,0,'READONLY_REVIEW_FAILED');return JSON.parse(result.stdout);
    };
    const review=inspect();assert.equal(review.state,'unknown');assert.equal(review.native.state,'started');
    assert.equal(review.native.process_closed,true);assert.equal(review.native.result_present,false);
    const evidence=path.join(home,'synthetic-human-review.txt');fs.writeFileSync(evidence,'SYNTHETIC TEST ONLY: child crash has no business side effects.');
    const decisionFile=path.join(home,'synthetic-decision.json');
    fs.writeFileSync(decisionFile,JSON.stringify({schema:1,operation_id:operation,review_digest:review.review_digest,
      resolution_id:'synthetic-crash-review',method:'operator_attestation',actor:'SYNTHETIC TEST ACTOR',decision:'failed',
      reason:'SYNTHETIC controlled child crash; not a real human decision',evidence_file:evidence,
      evidence_sha256:createHash('sha256').update(fs.readFileSync(evidence)).digest('hex'),result_text:null,
      confirmation:'I_VERIFIED_ORIGINAL_TASK_OUTCOME_AND_WILL_NOT_REPLAY',owned_processes_stopped:true,external_effects_reviewed:true}));
    const apply=()=>{
      const result=spawnSync(python,['-I','-S','-B',cli,'apply','--config',configFile,'--decision',decisionFile],{encoding:'utf8',timeout:15000,windowsHide:true});
      return {code:result.status,body:JSON.parse(result.stdout)};
    };
    let applied=apply();assert.equal(applied.code,2);assert.equal(applied.body.error,'RUNTIME_HOME_IN_USE');
    assert.equal(store.queueGet(agent.token,'task','synthetic-task-unknown').state,'execution_unknown');
    await bridge.stop();bridge=null;
    applied=apply();assert.equal(applied.code,0);assert.equal(applied.body.status,'reconciled');
    assert.equal(applied.body.cloud_delivery_verified,false);
    applied=apply();assert.equal(applied.code,0);assert.equal(applied.body.status,'already_reconciled');
    assert.equal(inspect().outcome_method,'operator_attestation');
    assert.equal(store.queueGet(agent.token,'task','synthetic-task-unknown').state,'execution_unknown');
    checked('read-only CLI exposes bounded evidence; live owner refuses synthetic adjudication; stopped owner accepts durable idempotent audit without claiming cloud success');
    bridge=makeBridge();await bridge.start();
    await until(()=>store.queueGet(agent.token,'task','synthetic-task-after-review').state==='completed','AFTER_REVIEW_QUEUE_STUCK');
    const resolved=store.queueGet(agent.token,'task','synthetic-task-unknown');assert.equal(resolved.state,'failed');
    assert(resolved.receipts.some(v=>v.stage==='failed'));assert(!resolved.receipts.some(v=>v.stage==='task_completed'));
    assert.deepEqual(prompts(home).slice(3).map(v=>v.text),['SYNTHETIC_CRASH_WITHOUT_RESULT','SYNTHETIC_FINISH_AFTER_BUSY']);
    const results=store.inbox(phone.token,{limit:50}).items.filter(v=>v.kind==='message').map(v=>store.queueGet(phone.token,'message',v.object_id));
    assert(!results.some(v=>v.body.task_id==='synthetic-task-unknown'));
    assert(results.some(v=>v.body.task_id==='synthetic-task-after-review'));
    checked('restart sends reviewed failure and next-task result through authenticated HTTP queue, never replays crashed task or fabricates its success');
    report.reconciliation={synthetic_attestation:true,real_human_adjudication:false,actual_child_exit:true,
      live_owner_fenced:true,unknown_task_prompt_count:1,next_task_completed:true,unknown_task_result_count:0};
  }
  await bridge.stop();bridge=null;
  const files=['adapter_main.py','acp_transport.py','managed_home.py','native_entry.py','native_observer.py','pinned_runtime.py','question_stdio.py','runtime_scheduler.py','runtime_journal.py','question_tools.py','restricted_profile.py','runtime_environment.py','cli_tools.py','question_cli.py','reconciliation.py','reconcile_cli.py'].map(name=>'rebuild/agent-bridge/hermes/'+name);
  files.push('rebuild/material-server/store.mjs','rebuild/material-server/http.mjs','rebuild/agent-bridge/client.mjs',
    'rebuild/agent-bridge/bridge.mjs','rebuild/agent-bridge/state.mjs','rebuild/agent-bridge/adapter-host.mjs','tools/phase1/hermes-runtime-fixture.py','tools/phase1/verify-hermes-runtime.mjs');
  report.source_sha256=Object.fromEntries(files.map(name=>[name,createHash('sha256').update(fs.readFileSync(path.join(root,name))).digest('hex')]));
  report.passed=true;
}catch(error){
  report.error_code=error.code??error.message;
  // Capture bounded failure evidence before deleting synthetic temporary data.
  if(withReconciliation&&testHome&&fs.existsSync(path.join(testHome,'journal.sqlite'))){
    const db=new DatabaseSync(path.join(testHome,'journal.sqlite'),{readOnly:true});
    try{
      report.failure_runtime=db.prepare('SELECT json_extract(o.source,\'$.body.task_id\') AS task_id,o.state,o.outcome,n.state AS native_state,n.process_closed,json_extract(n.payload,\'$.valid\') AS valid FROM operations o LEFT JOIN native_turns n ON n.operation_id=o.operation_id ORDER BY o.rowid LIMIT 20').all();
      report.failure_server_states=Object.fromEntries(['synthetic-task-unknown','synthetic-task-after-review'].map(id=>{
        try{return [id,store.queueGet(testAgentToken,'task',id).state];}catch{return [id,'not_found'];}
      }));
    }finally{db.close();}
  }
  throw error;
}
finally{
  await bridge?.stop();if(server?.listening)await new Promise(resolve=>server.close(resolve));store?.close();
  fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');
  fs.rmSync(dir,{recursive:true,force:true});
  console.log(JSON.stringify({passed:report.passed,checks:report.checks.length,error_code:report.error_code}));
}
