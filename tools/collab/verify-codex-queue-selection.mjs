#!/usr/bin/env node
// Bounded synthetic experiment. Never attaches to an existing user session.
// Only text prompts; no model/permission/global-config overrides.
import fs from 'node:fs';
import path from 'node:path';
import {spawn,execFileSync} from 'node:child_process';
import {randomUUID,createHash} from 'node:crypto';
import {once} from 'node:events';
import {CodexAppServerChannel,CodexAppServerSession} from '../../rebuild/agent-bridge/hosts/codex-app-server.mjs';

if(!process.argv.includes('--live'))throw new Error('EXPLICIT_LIVE_FLAG_REQUIRED');
const at=process.argv.indexOf('--report'),reportFile=at>=0?process.argv[at+1]:null;
if(!reportFile||!path.isAbsolute(reportFile))throw new Error('ABSOLUTE_REPORT_REQUIRED');
const started=Date.now(),deadline=started+120000,liveDeadline=deadline-20000;
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const hash=text=>createHash('sha256').update(text).digest('hex');
const need=(value,code)=>{if(!value)throw new Error(code);};
const report={schema_version:1,kind:'live_codex_non_head_queue_selection',started_at:new Date(started).toISOString(),
  deadline_ms:120000,prompts:'synthetic_text_only',configuration_overrides:false,rpc:[],events:[],checks:[]};
if(fs.existsSync(reportFile)){
  const previous=JSON.parse(fs.readFileSync(reportFile,'utf8'));
  need(previous.kind===report.kind&&previous.cleanup&&Object.values(previous.cleanup).every(Boolean),'PREVIOUS_PROOF_NOT_CLEAN');
  const {previous_attempts=[],...attempt}=previous;need(previous_attempts.length<2,'PROOF_ATTEMPT_LIMIT');
  report.previous_attempts=[...previous_attempts,attempt];
}
const directory=fs.realpathSync(fs.mkdtempSync('/tmp/io-codex-queue-'));fs.chmodSync(directory,0o700);
const workspace=path.join(directory,'work');fs.mkdirSync(workspace,{mode:0o700});
const socket=path.join(directory,'s.sock');
const save=()=>fs.writeFileSync(reportFile,JSON.stringify(report,null,2)+'\n',{mode:0o600});
const check=(name,value={})=>{report.checks.push({name,at_ms:Date.now()-started,...value});save();process.stdout.write(JSON.stringify({check:name,...value})+'\n');};
let server,serverExit,watchdog,watchdogExit,channel,host,threadId,abortReason=null,activeTurn=null;
const identity=pid=>{try{return execFileSync('ps',['-p',String(pid),'-o','lstart=','-o','command='],{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:1000}).trim();}catch{return null;}};
let serverIdentity=null;
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{abortReason=signal;});
async function until(fn,label,limitMs=45000){
  const end=Math.min(liveDeadline,Date.now()+limitMs);
  while(Date.now()<end){if(abortReason)throw new Error(abortReason);const result=await fn();if(result)return result;await pause(100);}
  throw new Error(`TIMEOUT_${label}`);
}
async function queueSnapshot(name){
  const result=await channel.request('thread/queue/list',{threadId,limit:100});
  need(Array.isArray(result.data)&&result.nextCursor==null,'QUEUE_SNAPSHOT_INCOMPLETE');
  const entries=result.data.map(q=>({queue_id:q.id,client_id:q.clientUserMessageId}));check(name,{entries});return result.data;
}
const childGuard=`import os,sys,time,signal,select,subprocess
pid=int(sys.argv[1]);deadline=float(sys.argv[2]);original=sys.argv[3]
def current():
 try:return subprocess.check_output(['ps','-p',str(pid),'-o','lstart=','-o','command='],stderr=subprocess.DEVNULL,timeout=1).decode().strip()
 except:return None
ready,_,_=select.select([sys.stdin],[],[],max(0,deadline-time.time()))
if ready and sys.stdin.readline().strip()=='clean':sys.exit(0)
if current()==original:
 try:os.killpg(pid,signal.SIGTERM)
 except ProcessLookupError:pass
 time.sleep(2)
 if current()==original:
  try:os.killpg(pid,signal.SIGKILL)
  except ProcessLookupError:pass
`;

try{
  server=spawn('codex',['app-server','--listen',`unix://${socket}`],{cwd:workspace,stdio:['ignore','ignore','pipe'],detached:true});
  server.stderr.on('data',()=>{});serverExit=once(server,'exit').catch(()=>{abortReason='SERVER_START_FAILED';});
  serverIdentity=identity(server.pid);need(serverIdentity,'SERVER_IDENTITY_UNAVAILABLE');
  watchdog=spawn('python3',['-c',childGuard,String(server.pid),String((deadline-2500)/1000),serverIdentity],{stdio:['pipe','ignore','ignore']});
  watchdog.stdin.on('error',()=>{});watchdogExit=once(watchdog,'exit').catch(()=>{abortReason='WATCHDOG_START_FAILED';});
  await until(()=>fs.existsSync(socket),'SERVER_SOCKET',10000);fs.chmodSync(socket,0o600);
  channel=new CodexAppServerChannel(`unix://${fs.realpathSync(socket)}`,{timeoutMs:5000});await channel.connect();
  report.host=channel.serverInfo;
  const nativeRequest=channel.request.bind(channel);
  channel.request=async(method,params={},options={})=>{
    const entry={method,at_ms:Date.now()-started};
    if(options.mutation){
      entry.request=Object.fromEntries(['threadId','queuedSubmissionId','clientUserMessageId','turnId'].filter(k=>params[k]!==undefined).map(k=>[k,params[k]]));
      if(Array.isArray(params.input))entry.request.input_sha256=hash(JSON.stringify(params.input));
      report.rpc.push(entry);
    }
    try{
      const result=await nativeRequest(method,params,options);
      if(options.mutation)entry.response={...(result.thread?{thread_id:result.thread.id}:{}),...(result.turn?{turn_id:result.turn.id,status:result.turn.status}:{}),
        ...(result.queuedSubmission?{queue_id:result.queuedSubmission.id,client_id:result.queuedSubmission.clientUserMessageId}:{})};
      return result;
    }catch(error){entry.error={code:error.code??'RPC_FAILED',native_code:error.nativeCode??null,outcome_unknown:error.outcomeUnknown===true};if(!options.mutation)report.rpc.push(entry);throw error;}
    finally{if(options.mutation||entry.error)save();}
  };
  const created=await channel.request('thread/start',{cwd:workspace,developerInstructions:'This is an authorized, disposable queue protocol test. Follow the synthetic text prompts only. Never call tools, access files or network, create agents, or change configuration.'},{mutation:true});
  threadId=created.thread.id;report.thread_id=threadId;save();
  channel.listen(message=>{
    const p=message.params;if(p?.threadId!==threadId)return;
    if(['turn/started','turn/completed','thread/queue/changed'].includes(message.method)&&report.events.length<100)
      report.events.push({method:message.method,at_ms:Date.now()-started,...(p.turn?{turn_id:p.turn.id,status:p.turn.status}:{})});
    if(message.method==='item/started'&&['commandExecution','mcpToolCall','dynamicToolCall','collabAgentToolCall'].includes(p.item?.type))abortReason='UNEXPECTED_TOOL_CALL';
  });
  host=new CodexAppServerSession(channel,threadId,{workspace});await host.attach();
  const seed=randomUUID(),a=randomUUID(),b=randomUUID(),nonceA=`QUEUE_A_${randomUUID()}`,nonceB=`QUEUE_B_${randomUUID()}`;
  report.client_ids={seed,a,b};
  await host.start({text:'Without using tools, output the integers from 1 to 20000, each on its own line. Continue counting until interrupted. Do not summarize or skip numbers.',clientUserMessageId:seed,expiresAt:new Date(liveDeadline).toISOString()});
  // The first turn may emit started before its history store is materialized.
  // Observe the native event instead of treating that transient read as a
  // submission failure; no second queue/add is ever sent for this client ID.
  const running=await until(()=>report.events.find(e=>e.method==='turn/started'),'SEED_RUNNING');activeTurn=running.turn_id;
  await host.start({text:`Without tools, reply with exactly ${nonceA} and nothing else.`,clientUserMessageId:a,expiresAt:new Date(liveDeadline).toISOString()});
  await host.start({text:`Without tools, reply with exactly ${nonceB} and nothing else.`,clientUserMessageId:b,expiresAt:new Date(liveDeadline).toISOString()});
  const before=await queueSnapshot('two_inputs_queued_while_busy');need(before.length===2&&before[0].clientUserMessageId===a&&before[1].clientUserMessageId===b,'QUEUE_ORDER_NOT_ESTABLISHED');
  await host.interrupt(activeTurn);
  await until(async()=>{const op=await host.inspectOperation(seed);return op.status==='interrupted';},'SEED_INTERRUPTED',10000);activeTurn=null;
  const stoppedAt=Date.now();await pause(750);
  const paused=await queueSnapshot('two_inputs_remain_after_interrupt');
  need(paused.length===2&&paused[0].id===before[0].id&&paused[1].id===before[1].id,'PAUSED_QUEUE_NOT_ESTABLISHED');
  need((await host.status()).busy===false,'THREAD_NOT_IDLE');
  check('paused_state_observed',{observation_ms:Date.now()-stoppedAt});
  const reply=await channel.request('thread/queue/start',{threadId,queuedSubmissionId:before[1].id},{mutation:true});
  need(typeof reply.turn?.id==='string','QUEUE_START_REPLY_MISSING_TURN');activeTurn=reply.turn.id;
  check('non_head_start_reply',{selected_queue_id:before[1].id,returned_turn_id:reply.turn.id});
  await queueSnapshot('queue_immediately_after_non_head_start');
  const completed=await until(async()=>{const op=await host.inspectOperation(b);return op.status==='completed'&&op.resultComplete?op:false;},'SELECTED_B_COMPLETE');activeTurn=null;
  need(completed.result?.text.trim()===nonceB,'SELECTED_B_RESULT_MISMATCH');need(completed.turnId===reply.turn.id,'RETURNED_TURN_NOT_SELECTED_B');
  check('selected_non_head_input_completed',{turn_id:completed.turnId,nonce_matches:true});
  const observeStart=Date.now(),untilAt=Math.min(liveDeadline,observeStart+10000);let first=null;
  while(Date.now()<untilAt){if(abortReason)throw new Error(abortReason);first=await host.inspectOperation(a);if(first.turnId&&first.status==='completed')break;await pause(200);}
  first=await host.inspectOperation(a);
  const finalQueue=await queueSnapshot('final_queue');
  report.conclusion={selected_non_head_started:true,other_input_started:Boolean(first.turnId),other_input_status:first.status??'unknown',
    other_input_turn_id:first.turnId??null,other_input_still_queued:finalQueue.some(q=>q.id===before[0].id),
    observation_after_selected_completion_ms:Date.now()-observeStart,other_nonce_matches:first.result?.text.trim()===nonceA,
    scope:first.turnId?'The selected non-head input started first; another queued input then ran without another queue/start. This does not establish all concurrent-user behavior.':
      'One isolated native session; the observation window does not prove absence of later auto-drain or concurrent-user races.'};
  check('queue_selection_observation',report.conclusion);report.ok=true;
}catch(error){report.ok=false;report.error=String(error.code??error.message??'VERIFY_FAILED');process.exitCode=1;save();}
finally{
  if(channel&&threadId){
    if(activeTurn)try{await channel.request('turn/interrupt',{threadId,turnId:activeTurn},{mutation:true});}catch{}
    try{await channel.request('thread/archive',{threadId},{mutation:true});report.archived=true;}catch{report.archived=false;}
  }
  try{host?.close();}catch{}try{channel?.close();}catch{}
  if(server&&server.exitCode===null&&server.signalCode===null&&identity(server.pid)===serverIdentity){
    try{process.kill(-server.pid,'SIGTERM');}catch{}
    await Promise.race([serverExit,pause(1500)]);
    if(server.exitCode===null&&server.signalCode===null&&identity(server.pid)===serverIdentity){try{process.kill(-server.pid,'SIGKILL');}catch{}await Promise.race([serverExit,pause(500)]);}
  }
  const serverExited=!server||server.exitCode!==null||server.signalCode!==null;
  if(watchdog&&watchdog.exitCode===null&&watchdog.signalCode===null){
    try{watchdog.stdin.end(serverExited?'clean\n':'kill\n');}catch{}
    await Promise.race([watchdogExit,pause(2500)]);
  }
  const watchdogExited=!watchdog||watchdog.exitCode!==null||watchdog.signalCode!==null;
  if(serverExited&&watchdogExited)fs.rmSync(directory,{recursive:true,force:true});
  report.cleanup={server_exited:serverExited,watchdog_exited:watchdogExited,temporary_directory_removed:!fs.existsSync(directory),test_thread_archived:report.archived===true};
  if(!Object.values(report.cleanup).every(Boolean)){report.ok=false;report.error??='CLEANUP_INCOMPLETE';process.exitCode=1;}
  report.finished_at=new Date().toISOString();report.elapsed_ms=Date.now()-started;save();
  process.stdout.write(JSON.stringify({ok:report.ok,error:report.error??null,elapsed_ms:report.elapsed_ms,cleanup:report.cleanup})+'\n');
}
