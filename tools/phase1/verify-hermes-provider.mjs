// Real configured provider, isolated new ACP session and question-only tools.
// Queue subjects/answers are synthetic. Cloud requires its own explicit,
// private synthetic-owner bundle. No physical phone or office tools used.
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {randomUUID,createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {DatabaseSync} from 'node:sqlite';
import {MaterialStore} from '../../rebuild/material-server/store.mjs';
import {listen} from '../../rebuild/material-server/http.mjs';
import {AgentBridge} from '../../rebuild/agent-bridge/bridge.mjs';
import {AdapterHost} from '../../rebuild/agent-bridge/adapter-host.mjs';
import {BridgeError} from '../../rebuild/agent-bridge/client.mjs';
import {cloudQueue} from './cloud-verification-client.mjs';

const root=fileURLToPath(new URL('../../',import.meta.url));
const args=process.argv.slice(2),opt=(name,fallback)=>args.includes(name)?args[args.indexOf(name)+1]:fallback;
if(!args.includes('--run-provider'))throw new Error('EXPLICIT_REAL_PROVIDER_TEST_REQUIRED');
const withCancellation=args.includes('--with-cancellation');
const cloudFile=opt('--cloud-config',null);
const withAnswerIntake=args.includes('--with-answer-intake');
const python=opt('--python','D:/APP/hermes/installs/712bb20a9e2cdd0b/environments/5e0869adbda74f8a9156d4b7944add81/venv/Scripts/python.exe');
const packages=path.join(path.dirname(path.dirname(python)),'Lib','site-packages');
const source=opt('--source','D:/APP/hermes/hermes-agent');
const privateRoot=path.join(root,'rebuild/agent-bridge/private');fs.mkdirSync(privateRoot,{recursive:true});
const run=path.join(privateRoot,'provider-'+randomUUID());fs.mkdirSync(run);
const home=path.join(run,'home'),workspace=path.join(run,'workspace');fs.mkdirSync(workspace);
const report={at:new Date().toISOString(),status:'running',scope:'real configured provider and installed pinned ACP with fixed CLI tools (no MCP), question-only tool profile, '+(cloudFile?'public HTTPS synthetic owner; phone-role answers from PC driver':'local authenticated synthetic queue and answer'),checks:[],
  not_verified:[...(cloudFile?['physical phone/glasses task end-to-end']:['cloud/phone/glasses real task end-to-end']),'office tools and user existing CLI/TUI sessions','crash recovering an original live wait stack','production binding/credential enrollment','eight-hour stability',...(withCancellation?[]:['real-provider cancellation']),...(withAnswerIntake?['hard bridge-process crash after answer intake']:[])]};
const requireValue=(condition,code)=>{if(!condition)throw new Error(code);};
const check=name=>report.checks.push({case:name,passed:true});
let store,server,bridge,queue;
try{
  let binding,transport,phoneProducer;
  if(cloudFile){
    const q=await cloudQueue(cloudFile);report.cloud_run_id=q.bundle.run_id;
    queue=q;transport=q.bundle.agent;phoneProducer=q.bundle.phone.producer_id;
    binding=Object.fromEntries(['server_id','owner_id','producer_id','computer_id','agent_id'].map(key=>[key,transport[key]]));
  }else{
    store=new MaterialStore(path.join(run,'queue.sqlite'));server=await listen(store);
    const phone=store.mint({owner:'synthetic-provider-test',producer:'synthetic-phone',scopes:['tasks:write','tasks:read','tasks:update','requests:read','answers:write','messages:receive']});
    const pc=store.mint({owner:'synthetic-provider-test',producer:'synthetic-pc',scopes:['tasks:read','tasks:update','requests:write','messages:receive','messages:write','receipts:agent']});
    const identity=store.identity(pc.token);binding={server_id:identity.server_id,owner_id:identity.owner_id,producer_id:identity.producer_id,computer_id:'io-provider-test-computer',agent_id:'io-provider-test-agent'};
    const credential=path.join(run,'local-queue-credential.json');fs.writeFileSync(credential,JSON.stringify(pc),{mode:0o600});
    transport={schema_version:'1.0',base_url:`http://127.0.0.1:${server.address().port}/v1/`,...binding,allow_loopback_http:true,credential_file:credential};
    phoneProducer='synthetic-phone';
    queue={submit:async(kind,event)=>store.queueSubmit(phone.token,event,kind),get:async(kind,id)=>store.queueGet(pc.token,kind,id),inbox:async()=>store.inbox(phone.token,{limit:50})};
  }
  const spec={home,binding,project_id:'io-provider-test',cwd:workspace,source,site_packages:packages,
    provider_config:opt('--provider-config','D:/APP/hermes/config.yaml'),provider_name:opt('--provider-name','token-share'),model:opt('--model','kimi-k3')};
  const specFile=path.join(run,'enroll.json');fs.writeFileSync(specFile,JSON.stringify(spec),{mode:0o600});
  const enrollStarted=performance.now();
  const enrolled=spawnSync(python,['-I','-S','-B',path.join(root,'rebuild/agent-bridge/hermes/enroll_home.py'),'--config',specFile],{encoding:'utf8',timeout:30000,windowsHide:true});
  report.timings_ms={enrollment:Math.round(performance.now()-enrollStarted)};
  fs.writeFileSync(path.join(run,'enrollment-output.log'),enrolled.stdout+enrolled.stderr,{mode:0o600});
  requireValue(enrolled.status===0,'ENROLLMENT_FAILED');
  const enrollment=JSON.parse(enrolled.stdout.trim());requireValue(enrollment.status==='enrolled','ENROLLMENT_NOT_READY');
  report.session_id=enrollment.session_id;report.model=spec.model;report.profile=enrollment.profile;
  const runtimeFile=path.join(home,'runtime.json'),runtime=JSON.parse(fs.readFileSync(runtimeFile,'utf8'));
  requireValue(Object.keys(runtime.sessions).length===1&&runtime.sessions[enrollment.session_id]?.project_id===spec.project_id,'ENROLLMENT_ROUTE_MISMATCH');
  check('new isolated home and existing ACP session enrolled before delivery, old home not adopted');
  const config={...transport,state_file:path.join(home,'bridge-state.json')};
  let transportOffline=false;
  const fetchImpl=async(url,options)=>{if(transportOffline)throw new Error('SYNTHETIC_PC_OFFLINE');return fetch(url,options);};
  let nativeHost,dropAnswerReply=withAnswerIntake,answerDeliveries=0;
  const makeBridge=()=>{
    const host=new AdapterHost({command:python,args:['-I','-S','-B',path.join(root,'rebuild/agent-bridge/hermes/adapter_main.py'),'--config',runtimeFile],timeoutMs:30000,name:'hermes-real-provider-question-only'});
    nativeHost=host;
    if(!dropAnswerReply)return new AgentBridge({config,fetchImpl,adapter:host});
    const adapter={name:'real-provider-with-injected-lost-local-answer-reply',get capabilities(){return host.capabilities;},start:()=>host.start(),stop:()=>host.stop(),
      onItem:(item,context)=>host.onItem(item,context),onRequestClosed:(value,context)=>host.onRequestClosed(value,context),
      onAnswer:async(value,context)=>{const result=await host.onAnswer(value,context);
        if(value.request.body.task_id==='provider-test-first'&&dropAnswerReply){answerDeliveries++;dropAnswerReply=false;throw new BridgeError('ADAPTER_EXITED',{permanent:true});}return result;},
      inspectAdmission:value=>host.inspectAdmission(value),inspectAnswerIntake:value=>host.inspectAnswerIntake(value),
      pollEvents:()=>host.pollEvents(),acknowledgeEvents:ids=>host.acknowledgeEvents(ids)};
    return new AgentBridge({config,fetchImpl,adapter});
  };
  const adapterStarted=performance.now();
  bridge=makeBridge();await bridge.start();report.timings_ms.adapter_ready= Math.round(performance.now()-adapterStarted);
  check('actual adapter starts with exclusive enrolled home and pinned installed source');
  const route={computer_id:binding.computer_id,agent_id:binding.agent_id,project_id:spec.project_id,session_id:enrollment.session_id};
  const expiry=new Date(Date.now()+10*60000).toISOString(),questionExpiry=new Date(Date.now()+5*60000).toISOString();
  const submit=(kind,body)=>queue.submit(kind,{schema_version:'1.0',event_id:randomUUID(),idempotency_key:randomUUID(),kind,producer_id:phoneProducer,created_at:new Date().toISOString(),expires_at:expiry,body});
  const getMessages=async()=>Promise.all((await queue.inbox()).items.filter(v=>v.kind==='message').map(v=>queue.get('message',v.object_id)));
  const command=`这是无业务副作用的 iO 接入测试。仅使用本任务三个固定 CLI 工具，不读文件、不执行办公任务。必须先调用 io_ask_user，参数 question_key="real-provider-one", question="这是接入测试，请回复测试文本。", mode="free_text", options=[], expires_at="${questionExpiry}"。然后调用 io_wait_answer 等待该 request_id 的真实答案。pending 时继续等待，不可猜测答案。得到 state=answered 后读取 answer.body.text，最终回复必须是 IO_REAL_WAIT_OK: 加上该答案文本。`;
  const task=(id,text)=>({task_id:id,revision:1,route,command:text,state:'queued',allow_create_session:false});
  const executionStarted=performance.now();
  await submit('task',task('provider-test-first',command));await submit('task',task('provider-test-second','这是第二个无副作用的排队测试。不要提问或调用工具，只回复 IO_REAL_SECOND_OK。'));
  if(cloudFile){
    const cursor=bridge.status().cursor;transportOffline=true;let unavailable=false;
    try{await bridge.pollOnce();}catch(error){unavailable=error.code==='NETWORK_UNAVAILABLE';}finally{transportOffline=false;}
    requireValue(unavailable&&bridge.status().cursor===cursor,'OFFLINE_ADVANCED_CURSOR');
    requireValue((await queue.get('task','provider-test-first')).state==='queued','OFFLINE_TASK_EXECUTED');
    check('injected PC network outage preserves cursor and server queued task before real HTTPS reconnect');
  }
  async function until(predicate,code,timeout=120000){
    const deadline=Date.now()+timeout;
    while(Date.now()<deadline){await bridge.pollOnce();const value=await predicate();if(value)return value;await new Promise(resolve=>setTimeout(resolve,200));}
    throw new Error(code);
  }
  const request=await until(async()=>{const ids=Object.keys(bridge.state.requests());if(ids.length)return queue.get('request',ids[0]);
    const first=await queue.get('task','provider-test-first');if(['failed','execution_unknown','completed'].includes(first.state))throw new Error('MODEL_DID_NOT_ENTER_VERIFIED_WAIT');return null;},'REAL_MODEL_QUESTION_TIMEOUT');
  requireValue(request.body.task_id==='provider-test-first'&&isDeepStrictEqual(request.body.route,route),'QUESTION_WRONG_TASK');
  requireValue((await queue.get('task','provider-test-first')).state==='waiting_answer','WAIT_NOT_PERSISTED');
  requireValue((await queue.get('task','provider-test-second')).state==='agent_received','SECOND_TASK_NOT_QUEUED');
  report.timings_ms.until_question=Math.round(performance.now()-executionStarted);
  check('real model calls actual scoped question tool; first task waits and second is durably queued');
  const answer='synthetic-reply-'+randomUUID();
  await submit('answer',{answer_id:'provider-test-answer',request_id:request.object_id,request_revision:request.revision,task_id:request.body.task_id,route,option_id:null,text:answer,input_source:'phone',raw_action:null});
  if(withAnswerIntake){
    let lost=false;try{await bridge.pollOnce();}catch(error){lost=error.code==='ADAPTER_EXITED';}
    const key=`answer:${request.object_id}:${request.revision}:provider-test-answer`;
    requireValue(lost&&answerDeliveries===1&&bridge.state.value.dispatches[key]?.state==='prepared','ANSWER_REPLY_NOT_LOST');
    const deadline=Date.now()+120000;let originalCompleted=false,secondCompleted=false;
    while(Date.now()<deadline){
      const events=await nativeHost.pollEvents();
      originalCompleted=events.some(e=>e.delivery_id==='item:task:provider-test-first:1'&&e.actions.some(a=>a.action==='task_state'&&a.state==='completed'));
      secondCompleted=events.some(e=>e.delivery_id==='item:task:provider-test-second:1'&&e.actions.some(a=>a.action==='task_state'&&a.state==='completed'));
      // Normal restart is only meaningful after every admitted runner has
      // returned. Stopping the second runner during prepare/execute would
      // deliberately create unknown work, not test answer-intake recovery.
      if(originalCompleted&&secondCompleted)break;await new Promise(resolve=>setTimeout(resolve,200));
    }
    requireValue(originalCompleted,'REAL_ORIGINAL_WAIT_DID_NOT_COMPLETE');
    requireValue(secondCompleted,'REAL_SECOND_RUNNER_DID_NOT_COMPLETE_BEFORE_RESTART');
    requireValue((await queue.get('task','provider-test-first')).state==='waiting_answer','UNACKNOWLEDGED_RUNTIME_COMPLETION_PUBLISHED');
    check('real original wait consumes the nonce answer and finishes while injected local reply loss leaves bridge prepared and cloud task waiting');
    await bridge.stop();bridge=makeBridge();await bridge.start();
    await bridge.pollOnce();
    requireValue(bridge.inspectLocalStatus().reconciled_answers===1&&bridge.state.value.dispatches[key]===undefined,'REAL_ANSWER_INTAKE_NOT_RECONCILED');
    report.answer_intake={injected_local_reply_loss:true,actual_adapter_restarted:true,all_admitted_runners_completed_before_restart:true,executable_answer_deliveries:answerDeliveries,
      durable_answer_intake_reconciled:true,hard_process_crash:false,crash_wait_stack_recovered:false};
    check('actual restarted adapter proves exact durable answer intake read-only; original resume/result events upload without re-delivering answer');
  }
  await until(async()=>{const second=await queue.get('task','provider-test-second');for(const id of ['provider-test-first','provider-test-second']){
    if(['failed','execution_unknown'].includes((await queue.get('task',id)).state))throw new Error('REAL_MODEL_TERMINAL_UNPROVEN');}return second.state==='completed';},'REAL_MODEL_COMPLETION_TIMEOUT');
  const first=await queue.get('task','provider-test-first');requireValue(first.state==='completed','FIRST_TASK_NOT_COMPLETED');
  requireValue(first.receipts.some(v=>v.stage==='task_resumed')&&first.receipts.some(v=>v.stage==='task_completed'),'DISTINCT_RESUME_COMPLETION_MISSING');
  const messages=await getMessages();
  // The nonce is known only after actual answer delivery. Whitespace or model
  // Markdown around the marker does not change whether the original task used
  // that exact answer; never weaken task/route/receipt checks for formatting.
  requireValue(messages.some(v=>v.body.task_id==='provider-test-first'&&v.body.text.includes('IO_REAL_WAIT_OK:')&&v.body.text.includes(answer)),'ANSWER_NOT_USED_BY_ORIGINAL_TASK');
  requireValue(messages.some(v=>v.body.task_id==='provider-test-second'&&v.body.text.includes('IO_REAL_SECOND_OK')),'SECOND_TASK_RESULT_MISSING');
  check('real model receives synthetic answer through original live wait and returns routed result; second FIFO task completes');
  report.timings_ms.two_tasks_total=Math.round(performance.now()-executionStarted);
  if(withCancellation){
    const cancelStarted=performance.now();
    await submit('task',task('provider-test-cancel',command.replace('real-provider-one','real-provider-cancel')));
    const cancelRequest=await until(async()=>{
      for(const id of Object.keys(bridge.state.requests())){
        const value=await queue.get('request',id);
        if(value.body.task_id==='provider-test-cancel')return value;
      }
      const current=await queue.get('task','provider-test-cancel');
      if(['failed','execution_unknown','completed'].includes(current.state))throw new Error('CANCEL_MODEL_DID_NOT_WAIT');
      return null;
    },'CANCEL_QUESTION_TIMEOUT');
    requireValue(isDeepStrictEqual(cancelRequest.body.route,route),'CANCEL_QUESTION_WRONG_ROUTE');
    requireValue((await queue.get('task','provider-test-cancel')).state==='waiting_answer','CANCEL_TASK_NOT_WAITING');
    // Exercise both an admitted task that never enters the model and an
    // already-running real model. No answer is ever delivered to the latter.
    await submit('task',task('provider-test-queued-cancel','Do not execute this cancelled queued test.'));
    await until(async()=>(await queue.get('task','provider-test-queued-cancel')).state==='agent_received','CANCEL_QUEUED_NOT_ADMITTED');
    const queued=await queue.get('task','provider-test-queued-cancel');
    await submit('task',{...queued.body,revision:queued.revision+1,state:'cancel_requested'});
    await until(async()=>(await queue.get('task','provider-test-queued-cancel')).state==='cancelled','QUEUED_CANCEL_NOT_CONFIRMED');
    const active=await queue.get('task','provider-test-cancel');
    await submit('task',{...active.body,revision:active.revision+1,state:'cancel_requested'});
    requireValue((await queue.get('task','provider-test-cancel')).state==='cancel_requested','CANCEL_REQUEST_NOT_DISTINCT');
    await until(async()=>{
      const current=await queue.get('task','provider-test-cancel');
      if(['failed','execution_unknown','completed'].includes(current.state))throw new Error('REAL_CANCEL_NOT_PROVEN');
      return current.state==='cancelled';
    },'REAL_CANCEL_TIMEOUT');
    const db=new DatabaseSync(runtime.journal,{readOnly:true});
    try{
      const nativeFor=id=>db.prepare('SELECT n.state,n.payload,n.process_closed FROM operations o JOIN native_turns n ON o.operation_id=n.operation_id WHERE json_extract(o.source,\'$.body.task_id\')=?').get(id);
      const native=nativeFor('provider-test-cancel');
      const observed=native?JSON.parse(native.payload):null;
      requireValue(native?.state==='returned'&&native.process_closed===1&&observed?.valid===true&&observed.interrupted===true&&observed.completed===false,'CANCEL_NATIVE_EVIDENCE_MISSING');
      requireValue(nativeFor('provider-test-queued-cancel')===undefined,'CANCELLED_QUEUED_TASK_ENTERED_MODEL');
      report.cancellation={native_result_returned:true,interrupted:true,completed:false,owned_process_tree_closed:true,queued_task_never_entered_model:true};
    }finally{db.close();}
    const cancelled=await queue.get('task','provider-test-cancel');
    requireValue(cancelled.receipts.some(v=>v.stage==='cancelled')&&!cancelled.receipts.some(v=>['task_completed','task_resumed'].includes(v.stage)),'CANCEL_RECEIPT_FALSE_SUCCESS');
    check('real model waiting task is interrupted and owned process tree confirmed closed before cancelled; queued cancellation never enters model');
    report.timings_ms.cancellation_scenario=Math.round(performance.now()-cancelStarted);
    const withdrawn=await until(async()=>{
      const current=await queue.get('request',cancelRequest.object_id);
      return current.state==='withdrawn'?current:null;
    },'CANCELLED_QUESTION_NOT_WITHDRAWN');
    requireValue(withdrawn.revision===cancelRequest.revision&&withdrawn.event_id===cancelRequest.event_id&&withdrawn.answer===null&&
      withdrawn.receipts.some(r=>r.subject_kind==='request'&&r.subject_id===cancelRequest.object_id&&
        r.subject_revision===cancelRequest.revision&&r.actor_id==='server-lifecycle'&&r.stage==='cancelled'),
      'QUESTION_CLOSURE_FACT_MISSING');
    report.cancellation.request_withdrawn=true;report.cancellation.question_revision_unchanged=true;
    check('cancelled task question is withdrawn on its original revision with a separate request closure receipt');
    let lateRejected=false;
    try{await submit('answer',{answer_id:'provider-test-late-answer',request_id:cancelRequest.object_id,request_revision:cancelRequest.revision,task_id:cancelRequest.body.task_id,route,option_id:null,text:'must not resume cancelled task',input_source:'phone',raw_action:null});}
    catch(error){lateRejected=error.code==='REQUEST_CLOSED';}
    requireValue(lateRejected,'CANCELLED_TASK_ACCEPTED_LATE_ANSWER');
    await submit('task',task('provider-test-after-cancel','无业务副作用的取消后测试。不要调用工具，只回复 IO_REAL_AFTER_CANCEL_OK。'));
    await until(async()=>(await queue.get('task','provider-test-after-cancel')).state==='completed','AFTER_CANCEL_FIFO_STUCK');
    const allMessages=await getMessages();
    requireValue(!allMessages.some(v=>['provider-test-cancel','provider-test-queued-cancel'].includes(v.body.task_id)),'CANCELLED_TASK_PUBLISHED_RESULT');
    requireValue(allMessages.some(v=>v.body.task_id==='provider-test-after-cancel'&&v.body.text.includes('IO_REAL_AFTER_CANCEL_OK')),'AFTER_CANCEL_RESULT_MISSING');
    check('late answer rejected for cancelled task, cancelled tasks publish no success result, next real-model FIFO task completes');
  }
  const beforeRestart=(await getMessages()).length;
  await bridge.stop();bridge=makeBridge();await bridge.start();for(let n=0;n<3;n++)await bridge.pollOnce();
  const after=await getMessages();requireValue(after.length===beforeRestart,'RESTART_DUPLICATED_RESULTS');
  check('bridge and adapter normal restart preserve settled operations without duplicate results');
  report.status='passed';
}catch(error){
  report.status='failed';
  // Preserve bounded machine diagnostics without recording provider text,
  // paths, prompt contents or arbitrary exception messages.
  const safe=value=>typeof value==='string'&&/^[A-Z][A-Z0-9_]{0,63}$/.test(value);
  report.error_code=safe(error.code)?error.code:safe(error.message)?error.message:'REAL_PROVIDER_TEST_FAILED';
  if(['open','read','write','fsync','rename','unlink','mkdir'].includes(error.syscall))report.failed_syscall=error.syscall;
  process.exitCode=1;
}
finally{
  await bridge?.stop();if(server?.listening)await new Promise(resolve=>server.close(resolve));store?.close();
  const files=['enroll_home.py','restricted_profile.py','runtime_environment.py','native_entry.py','adapter_main.py','acp_transport.py','runtime_journal.py','runtime_scheduler.py','native_observer.py','cli_tools.py','question_cli.py'].map(name=>'rebuild/agent-bridge/hermes/'+name);
  files.push('rebuild/material-server/store.mjs','rebuild/material-server/http.mjs','rebuild/agent-bridge/bridge.mjs',
    'rebuild/agent-bridge/client.mjs','rebuild/agent-bridge/state.mjs','rebuild/agent-bridge/runtime-events.mjs','rebuild/agent-bridge/adapter-host.mjs',
    'tools/phase1/verify-hermes-provider.mjs','tools/phase1/cloud-verification-client.mjs');
  report.source_sha256=Object.fromEntries(files.map(name=>[name,createHash('sha256').update(fs.readFileSync(path.join(root,name))).digest('hex')]));
  fs.writeFileSync(path.join(root,`rebuild/phase1/hermes-real-provider${cloudFile?'-cloud':''}${withAnswerIntake?'-answer-intake':''}${withCancellation?'-cancel':''}-${cloudFile||withAnswerIntake?'2026-10-13':'2026-10-12'}.json`),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({status:report.status,checks:report.checks.length,error_code:report.error_code}));
}
