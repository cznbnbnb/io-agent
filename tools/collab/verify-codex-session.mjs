#!/usr/bin/env node
// Explicit, bounded live verification. Creates only its own disposable native
// thread and workspace. Never attaches to or resumes an existing user thread.
import fs from 'node:fs';
import path from 'node:path';
import {spawn,execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {once} from 'node:events';
import assert from 'node:assert/strict';
import {CodexAppServerChannel,CodexAppServerSession} from '../../rebuild/agent-bridge/hosts/codex-app-server.mjs';

if(!process.argv.includes('--live'))throw new Error('EXPLICIT_LIVE_FLAG_REQUIRED');
const arg=name=>{const i=process.argv.indexOf(name);return i<0?null:process.argv[i+1];};
const reportFile=arg('--report');
if(!reportFile||!path.isAbsolute(reportFile))throw new Error('ABSOLUTE_REPORT_REQUIRED');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const dir=fs.realpathSync(fs.mkdtempSync('/tmp/io-native-'));
fs.chmodSync(dir,0o700);
const work=path.join(dir,'work');fs.mkdirSync(work,{mode:0o700});
const socket=path.join(dir,'s.sock'),endpoint=`unix://${socket}`;
const report={schema_version:1,kind:'live_codex_shared_session',early_interrupt:arg('--interrupt-early')==='yes',started_at:new Date().toISOString(),checks:[],workspace:work};
const save=()=>fs.writeFileSync(reportFile,JSON.stringify(report,null,2)+'\n',{mode:0o600});
const check=(name,extra={})=>{report.checks.push({name,at:new Date().toISOString(),...extra});save();process.stdout.write(JSON.stringify({check:name,...extra})+'\n');};
let channel,host,threadId,server,serverExit,childPid,childIdentity,childStarted;
let abortReason=null;
const deadline=Date.now()+8*60*1000;
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{abortReason=`SIGNAL_${signal}`;});
const nativeItems=[];
const identity=pid=>{try{return execFileSync('ps',['-p',String(pid),'-o','lstart=','-o','command='],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();}
  catch(error){if(error.status===1&&!String(error.stdout??'').trim()&&!String(error.stderr??'').trim())return null;throw new Error('PROCESS_OBSERVATION_FAILED');}};
const originalAlive=()=>childPid&&identity(childPid)===childIdentity;
async function until(fn,label,ms=150000){const end=Math.min(Date.now()+ms,deadline);while(Date.now()<end){if(abortReason)throw new Error(abortReason);const v=await fn();if(v)return v;await sleep(350);}throw new Error(`TIMEOUT_${label}`);}
const script=`import os,time,signal,json\nfrom pathlib import Path\np=Path(__file__).parent\ndef stopped(s,f):\n p.joinpath('child-stopped').write_text(str(s));raise SystemExit(0)\nsignal.signal(signal.SIGTERM,stopped)\nsignal.signal(signal.SIGINT,stopped)\np.joinpath('child.json.tmp').write_text(json.dumps({'pid':os.getpid(),'started_at':time.time()}))\nos.replace(p/'child.json.tmp',p/'child.json')\nfor i in range(180):\n p.joinpath('heartbeat').write_text(str(i));time.sleep(1)\np.joinpath('child-finished').write_text('finished')\n`;
fs.writeFileSync(path.join(work,'bounded-work.py'),script,{mode:0o600});
try{
  server=spawn('codex',['app-server','--listen',endpoint],{cwd:work,stdio:['ignore','ignore','pipe'],detached:true});
  serverExit=once(server,'exit').catch(()=>{abortReason='SERVER_START_FAILED';});server.stderr.on('data',()=>{});
  await until(()=>fs.existsSync(socket),'SERVER_SOCKET',15000);fs.chmodSync(socket,0o600);
  // The official server publishes a symlink to its private daemon socket.
  // Connect to the checked canonical socket, not an untrusted link pathname.
  channel=new CodexAppServerChannel(`unix://${fs.realpathSync(socket)}`,{timeoutMs:15000,
    onDiagnostic:arg('--diagnostics')==='yes'?event=>process.stderr.write(JSON.stringify({diagnostic:event})+'\n'):undefined});await channel.connect();
  const nativeRequest=channel.request.bind(channel);
  channel.request=async(method,...args)=>{try{return await nativeRequest(method,...args);}catch(error){report.failed_rpc={method,code:error.code,native_code:error.nativeCode};throw error;}};
  const created=await channel.request('thread/start',{cwd:work,sandbox:'workspace-write',approvalPolicy:'on-request',
    developerInstructions:'This is an explicitly authorized isolated native-session integration test. Follow only the synthetic test prompts. Do not use network tools, inspect other workspaces, spawn agents, or change configuration. Only run the supplied bounded-work.py when asked. Never background it or create any other subprocess except the shell needed to run python3. Preserve the provided context nonce.'},{mutation:true});
  threadId=created.thread.id;report.thread_id=threadId;report.model=created.model;save();
  channel.listen(message=>{
    if(!['item/started','item/completed'].includes(message.method)||message.params?.threadId!==threadId)return;
    const {turnId,item}=message.params;
    if(nativeItems.length>=300||!item)return;
    nativeItems.push({method:message.method,turnId,type:item.type,id:item.id,processId:item.processId??null,at:new Date().toISOString()});
  });
  host=new CodexAppServerSession(channel,threadId,{workspace:work,timeoutMs:15000});await host.attach();
  check('isolated_thread_attached',{same_thread:host.conversationId===threadId});
  const nonce=`IO_CONTEXT_${randomUUID()}`;
  const first=randomUUID();await host.start({text:`Remember this exact token for later in this conversation: ${nonce}. Reply with exactly READY and do not call tools.`,clientUserMessageId:first,expiresAt:new Date(Date.now()+180000).toISOString()});
  const initial=await until(async()=>{const r=await host.inspectOperation(first);return r.status==='completed'?r:false;},'INITIAL_COMPLETION');
  check('idle_wake_completed',{turn_id:initial.turnId,final_present:!!initial.result});
  const workId=randomUUID();await host.start({text:`Run python3 ${path.join(work,'bounded-work.py')} once and wait for it. Do not background it. It is bounded to 180 seconds. Do not call other tools. Reply WORK_FINISHED only after it exits.`,clientUserMessageId:workId,expiresAt:new Date(Date.now()+180000).toISOString()});
  await until(()=>fs.existsSync(path.join(work,'child.json')),'CHILD_START');
  const childInfo=JSON.parse(fs.readFileSync(path.join(work,'child.json'),'utf8'));childPid=childInfo.pid;childStarted=childInfo.started_at*1000;
  assert(Number.isInteger(childPid)&&childPid>1);childIdentity=identity(childPid);assert(childIdentity?.includes(path.join(work,'bounded-work.py')));
  const active=await until(async()=>{const r=await host.inspectOperation(workId);return r.status==='inProgress'?r:false;},'RUNNING_TURN');
  check('bounded_child_running',{turn_id:active.turnId,child_pid:childPid});
  // Observe a yielded tool before testing stop; early-interrupt failures are
  // retained as separate evidence and are not erased by this variant.
  if(!report.early_interrupt)await until(()=>Number(fs.readFileSync(path.join(work,'heartbeat'),'utf8'))>=3,'FIRST_TOOL_YIELD',10000);
  report.pre_interrupt_terminals=await channel.request('thread/backgroundTerminals/list',{threadId});
  report.native_items=nativeItems;save();
  const next=randomUUID();await host.start({text:'Without tools, return the exact IO_CONTEXT token from the beginning of this conversation and nothing else.',clientUserMessageId:next,expiresAt:new Date(Date.now()+180000).toISOString()});
  const queued=await host.inspectOperation(next);assert.equal(queued.status,'queued');
  assert.equal((await host.inspectOperation(workId)).turnId,active.turnId);
  check('busy_input_queued_without_steer');
  const receipt=await host.interrupt(active.turnId);assert.equal(receipt.expectedTurnId,active.turnId);
  const stopped=await until(async()=>{const r=await host.inspectOperation(workId);return r.status==='interrupted'?r:false;},'INTERRUPTED',30000);
  check('exact_native_turn_interrupted',{turn_id:stopped.turnId,controlled_child_still_running:originalAlive()});
  const terminals=await host.terminateTurnTerminals(stopped.turnId);report.terminal_stop=terminals;save();
  await until(()=>!originalAlive(),'CHILD_EXIT',15000);
  const stopElapsed=Date.now()-childStarted;
  assert(stopElapsed<160000&&!fs.existsSync(path.join(work,'child-finished')),'stop must precede natural deadline');
  check('exact_turn_and_controlled_child_stopped',{turn_id:stopped.turnId,child_alive:false,child_elapsed_ms:stopElapsed,heartbeat:fs.readFileSync(path.join(work,'heartbeat'),'utf8')});
  const waiting=await host.inspectOperation(next);
  if(waiting.status==='queued'){await host.startQueued(next);check('explicit_original_queue_item_started');}
  const continued=await until(async()=>{const r=await host.inspectOperation(next);return r.status==='completed'?r:false;},'CONTINUATION');
  assert(continued.result?.text.includes(nonce),'original context token must survive interrupt and queue continuation');
  check('same_session_context_continued',{thread_id:threadId,turn_id:continued.turnId,context_matches:true});
  const historical=await channel.request('thread/read',{threadId,includeTurns:true});
  report.native_turn_count=historical.thread.turns.length;
  assert.equal(report.native_turn_count,3,'three inputs must produce exactly three turns');
  check('no_duplicate_turns',{turn_count:report.native_turn_count});
  report.ok=true;
}catch(error){report.ok=false;report.error=String(error.code??error.message??'VERIFY_FAILED');process.exitCode=1;}
finally{
  // Recover this test's atomic PID record even if an earlier RPC failed
  // between process creation and the normal observation step.
  if(!childIdentity&&fs.existsSync(path.join(work,'child.json'))){
    const recorded=JSON.parse(fs.readFileSync(path.join(work,'child.json'),'utf8'));
    if(Number.isInteger(recorded.pid)&&recorded.pid>1){
      const candidate=identity(recorded.pid);
      if(candidate?.includes(path.join(work,'bounded-work.py'))){childPid=recorded.pid;childIdentity=candidate;}
    }
  }
  // Archive only the ID created above; stop only the process group started here.
  if(channel&&threadId)try{await channel.request('thread/archive',{threadId},{mutation:true});report.archived=true;}catch{report.archived=false;}
  try{await host?.close();}catch{}try{channel?.close();}catch{}
  if(server&&server.exitCode===null&&server.signalCode===null){try{process.kill(-server.pid,'SIGTERM');}catch{}await Promise.race([serverExit,sleep(5000)]);
    if(server.exitCode===null&&server.signalCode===null){try{process.kill(-server.pid,'SIGKILL');}catch{}await Promise.race([serverExit,sleep(2000)]);}}
  // A timed-out test cannot leave its uniquely recorded child running.
  if(childIdentity&&originalAlive()){try{process.kill(childPid,'SIGTERM');}catch{}await sleep(300);if(originalAlive())try{process.kill(childPid,'SIGKILL');}catch{}}
  report.cleanup={server_exited:!server||server.exitCode!==null||server.signalCode!==null,controlled_child_exited:!childIdentity||!originalAlive()};
  report.native_items=nativeItems;
  if(!report.cleanup.server_exited||!report.cleanup.controlled_child_exited){report.ok=false;report.error??='CLEANUP_INCOMPLETE';process.exitCode=1;}
  report.finished_at=new Date().toISOString();save();
  if(report.cleanup.server_exited&&report.cleanup.controlled_child_exited)fs.rmSync(dir,{recursive:true,force:true});
  process.stdout.write(JSON.stringify({ok:report.ok,error:report.error,report:reportFile,cleanup:report.cleanup})+'\n');
}
