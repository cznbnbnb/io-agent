#!/usr/bin/env node
// Bounded live Mod test in a disposable engine process, not a Desktop UI claim.
import fs from 'node:fs';
import path from 'node:path';
import {spawn,execFileSync} from 'node:child_process';
import {once} from 'node:events';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import {createClaudeModBroker} from '../../rebuild/agent-bridge/hosts/claude-mod/broker.mjs';

const arg=name=>{const i=process.argv.indexOf(name);return i<0?null:process.argv[i+1];};
if(!process.argv.includes('--live'))throw new Error('EXPLICIT_LIVE_FLAG_REQUIRED');
const executable=arg('--claude'),reportFile=arg('--report');
if(!executable||!path.isAbsolute(executable)||!reportFile||!path.isAbsolute(reportFile))throw new Error('ABSOLUTE_EXECUTABLE_AND_REPORT_REQUIRED');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const dir=fs.realpathSync(fs.mkdtempSync('/tmp/io-claude-'));fs.chmodSync(dir,0o700);
const work=path.join(dir,'work');fs.mkdirSync(work,{mode:0o700});
const sessionId=randomUUID(),nonce=`IO_CONTEXT_${randomUUID()}`,runNonce=randomUUID();
const binding={host_kind:'claude',workspace:work,server_id:'isolated-native-proof',owner_id:'codex-local-proof',
  route:{computer_id:'isolated-local-mac',agent_id:'claude',project_id:'disposable-native-proof',session_id:sessionId}};
const report={schema_version:1,kind:'live_claude_mod_engine',desktop_ui_verified:false,started_at:new Date().toISOString(),session_id:sessionId,checks:[]};
const save=()=>fs.writeFileSync(reportFile,JSON.stringify(report,null,2)+'\n',{mode:0o600});
const check=(name,extra={})=>{report.checks.push({name,at:new Date().toISOString(),...extra});save();process.stdout.write(JSON.stringify({check:name,...extra})+'\n');};
const overallDeadline=performance.now()+360000,interruption=new AbortController();
const abortSignal=signal=>interruption.abort(new Error(`INTERRUPTED_${signal}`));
const onSigint=()=>abortSignal('SIGINT'),onSigterm=()=>abortSignal('SIGTERM');
process.on('SIGINT',onSigint);process.on('SIGTERM',onSigterm);
// Signals and deadlines reject the active await, so every exit goes through
// finally. Do not call process.exit() or perform cleanup in an event callback.
async function bounded(fn,label,ms=90000){
  interruption.signal.throwIfAborted();
  const remaining=Math.min(ms,overallDeadline-performance.now());if(remaining<=0)throw new Error('OVERALL_DEADLINE');
  let timer,onAbort;const stopped=new Promise((resolve,reject)=>{
    timer=setTimeout(()=>reject(new Error(`TIMEOUT_${label}`)),remaining);
    onAbort=()=>reject(interruption.signal.reason);interruption.signal.addEventListener('abort',onAbort,{once:true});
  });
  try{return await Promise.race([Promise.resolve().then(fn),stopped]);}
  finally{clearTimeout(timer);interruption.signal.removeEventListener('abort',onAbort);}
}
async function until(fn,label,ms=90000){const end=performance.now()+ms;while(performance.now()<end){const r=await bounded(fn,label,end-performance.now());if(r)return r;await bounded(()=>sleep(250),label,end-performance.now());}throw new Error(`TIMEOUT_${label}`);}
let broker,child,childExit,buffer='',stderr='',seedDone=false,streamError,toolPid,toolIdentity,toolRecord,workRequested=false;
const processIdentity=pid=>{try{return execFileSync('ps',['-p',String(pid),'-o','lstart=','-o','command='],{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:3000}).trim();}
  catch(error){if(error.status===1&&!String(error.stdout??'').trim()&&!String(error.stderr??'').trim())return null;throw new Error('PROCESS_OBSERVATION_FAILED');}};
const scriptPath=path.join(work,'bounded-work.py'),manifestPath=path.join(work,'child.json');
const captureToolRecord=()=>{
  if(!fs.existsSync(manifestPath))return false;
  const record=JSON.parse(fs.readFileSync(manifestPath,'utf8'));
  assert(Number.isInteger(record.pid)&&record.pid>1&&record.run_nonce===runNonce&&Number.isFinite(record.started_at)&&
    record.started_at*1000>=Date.parse(report.started_at)&&record.started_at*1000<=Date.now()+1000,'INVALID_CONTROLLED_CHILD_RECORD');
  if(toolRecord)assert.deepEqual(record,toolRecord,'CONTROLLED_CHILD_RECORD_CHANGED');
  else{toolRecord=record;toolPid=record.pid;}
  if(toolIdentity===undefined){const current=processIdentity(toolPid);toolIdentity=current?.includes(scriptPath)?current:null;}
  return true;
};
const originalToolAlive=()=>{
  assert(toolRecord&&toolIdentity!==undefined,'CONTROLLED_CHILD_IDENTITY_UNKNOWN');
  const current=processIdentity(toolPid);
  // An absent/reused PID proves only this recorded Python process has exited.
  // A process with another identity is never signalled by this script.
  return toolIdentity!==null&&current===toolIdentity;
};
const stopEvidence=()=>{
  captureToolRecord();assert(toolIdentity,'CONTROLLED_CHILD_IDENTITY_UNKNOWN');
  const elapsed=Date.now()/1000-toolRecord.started_at,heartbeat=fs.readFileSync(path.join(work,'heartbeat'),'utf8').trim();
  assert(/^\d+$/.test(heartbeat)&&Number(heartbeat)<120,'INVALID_CONTROLLED_CHILD_HEARTBEAT');
  assert(!fs.existsSync(path.join(work,'child-finished')),'CONTROLLED_CHILD_FINISHED_NATURALLY');
  assert(elapsed>=0&&elapsed<=100,'CONTROLLED_CHILD_TOO_CLOSE_TO_NATURAL_DEADLINE');
  return{elapsed_seconds:Number(elapsed.toFixed(3)),remaining_seconds:Number((120-elapsed).toFixed(3)),heartbeat:Number(heartbeat),natural_completion:false};
};
const script=`import os,time,signal,json\nfrom pathlib import Path\np=Path(__file__).parent\nstarted_at=time.time()\ndef write_atomic(name,value):\n temp=p.joinpath(name+'.tmp');temp.write_text(value);os.replace(temp,p.joinpath(name))\ndef stop(s,f):\n write_atomic('child-stopped',json.dumps({'signal':s,'stopped_at':time.time()}));raise SystemExit(0)\nsignal.signal(signal.SIGTERM,stop)\nsignal.signal(signal.SIGINT,stop)\nwrite_atomic('heartbeat','0')\nwrite_atomic('child.json',json.dumps({'pid':os.getpid(),'started_at':started_at,'run_nonce':${JSON.stringify(runNonce)}}))\nfor i in range(120):\n write_atomic('heartbeat',str(i));time.sleep(1)\nwrite_atomic('child-finished',json.dumps({'finished_at':time.time()}))\n`;
fs.writeFileSync(path.join(work,'bounded-work.py'),script,{mode:0o600});
try{
  broker=await createClaudeModBroker({directory:path.join(dir,'broker'),binding});
  if(arg('--diagnostics')==='yes'){
    const source=path.join(broker.pluginDirectory,'hooks/register.js');let text=fs.readFileSync(source,'utf8');
    for(const name of ['prompt.submit','turn.start','turn.complete']){
      const hook=`on('${name}', async ($, e, next) => `;
      const trace=`await $.fs.write($.plugin.root + '/diagnostic-${name}.json', JSON.stringify({keys:Object.keys(e),agentId:e.agentId,turnId:e.turnId,text:e.text,answer:e.answer,isAborted:e.isAborted,origin:e.origin}));`;
      const before=text;
      if(name==='prompt.submit')text=text.replace(hook+'admit($, e, next)',hook+`{ ${trace} return admit($, e, next); }`);
      else text=text.replace(hook+'{',hook+`{ ${trace}`);
      assert.notEqual(text,before,`DIAGNOSTIC_HOOK_NOT_FOUND_${name}`);
    }
    fs.writeFileSync(source,text);
  }
  child=spawn(executable,['-p','--input-format','stream-json','--output-format','stream-json','--verbose','--session-id',sessionId,
    '--plugin-dir',broker.pluginDirectory,'--tools','Bash,TaskStop','--allowedTools',`Bash(python3 ${path.join(work,'bounded-work.py')})`,'TaskStop',
    '--strict-mcp-config','--mcp-config','{"mcpServers":{}}','--max-budget-usd','3',
    '--append-system-prompt',`This is an authorized isolated session-control integration test. Use only the provided synthetic prompts. Do not read other workspaces, call external tools, create subagents or change any settings. If asked, run exactly python3 ${path.join(work,'bounded-work.py')} once without backgrounding; no other shell commands.`],
    {cwd:work,stdio:['pipe','pipe','pipe'],detached:true});
  childExit=once(child,'exit').catch(error=>{streamError=String(error.code??'ENGINE_SPAWN_FAILED');});
  child.stdin.on('error',error=>{streamError=String(error.code??'ENGINE_INPUT_FAILED');interruption.abort(new Error(streamError));});
  child.stderr.on('data',data=>{stderr=(stderr+data.toString()).slice(-16000);});
  child.stdout.on('data',data=>{
    buffer+=data;
    if(buffer.length>2*1024*1024){streamError='OUTPUT_LIMIT';interruption.abort(new Error(streamError));return;}
    let nl;while((nl=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,nl);buffer=buffer.slice(nl+1);let message;try{message=JSON.parse(line);}catch{continue;}
      if(message.type==='system'&&message.subtype==='init'){report.native_session_matches=message.session_id===sessionId;save();}
      if(message.type==='result'){seedDone=true;if(message.is_error)streamError=(message.errors??[message.result??'NATIVE_ERROR']).join(';').slice(0,1200);}
    }
  });
  child.stdin.write(JSON.stringify({type:'user',session_id:sessionId,parent_tool_use_id:null,message:{role:'user',content:`Remember this exact token for this conversation: ${nonce}. Reply only READY. Do not call tools.`}})+'\n');
  await until(async()=>{if(streamError)throw new Error(streamError);try{return seedDone&&(await broker.host.status());}catch{return false;}},'MOD_BIND_AND_SEED');
  assert.equal(report.native_session_matches,true);check('real_engine_session_and_mod_bound');
  const first=randomUUID();await bounded(()=>broker.host.start({text:'Without tools, reply with the exact IO_CONTEXT token I gave earlier and nothing else.',clientUserMessageId:first,expiresAt:new Date(Date.now()+90000).toISOString()}),'WAKE_ADMISSION');
  const woke=await until(async()=>{if(streamError)throw new Error(streamError);const r=await broker.host.inspectOperation(first);return r.status==='completed'&&r.resultComplete===true?r:false;},'REMOTE_IDLE_WAKE');
  assert(woke.result?.text.includes(nonce),'Mod wake must preserve native conversation context');check('remote_idle_wake_keeps_context',{turn_id:woke.turnId});
  const workId=randomUUID();workRequested=true;await bounded(()=>broker.host.start({text:`Run exactly python3 ${path.join(work,'bounded-work.py')} once, without backgrounding. Wait for it to exit. Call no other tools. Reply WORK_FINISHED only when the command exits.`,clientUserMessageId:workId,expiresAt:new Date(Date.now()+120000).toISOString()}),'WORK_ADMISSION');
  await until(()=>captureToolRecord(),'BOUNDED_CHILD_START');assert(originalToolAlive(),'CONTROLLED_CHILD_NOT_RUNNING');
  const running=await until(async()=>{const r=await broker.host.inspectOperation(workId);return r.status==='inProgress'?r:false;},'RUNNING_TURN');
  check('bounded_child_running',{turn_id:running.turnId,child_pid:toolPid});
  const requestedEvidence=stopEvidence();assert(originalToolAlive(),'CONTROLLED_CHILD_EXITED_BEFORE_INTERRUPT');
  report.stop_attempt={turn_id:running.turnId,...requestedEvidence};save();
  await bounded(()=>broker.host.interrupt(running.turnId),'INTERRUPT_RECEIPT',30000);
  const stopped=await until(async()=>{const r=await broker.host.inspectOperation(workId);return r.status==='interrupted'?r:false;},'NATIVE_INTERRUPTED',30000);
  report.native_stop=await broker.host.inspectStop(running.turnId);
  assert.equal(stopped.turnId,running.turnId,'INTERRUPTED_TURN_MISMATCH');
  await until(()=>!originalToolAlive(),'CONTROLLED_CHILD_EXIT',15000);
  const exitedEvidence=stopEvidence();await bounded(()=>sleep(1000),'HEARTBEAT_QUIET',2000);const quietEvidence=stopEvidence();
  assert.equal(quietEvidence.heartbeat,exitedEvidence.heartbeat,'CONTROLLED_CHILD_HEARTBEAT_CONTINUES');assert(!originalToolAlive());
  report.native_stop=await broker.host.inspectStop(running.turnId);
  check('precise_turn_and_controlled_child_stopped',{turn_id:stopped.turnId,requested:requestedEvidence,exited:exitedEvidence,heartbeat_quiet_ms:1000,
    signal_marker_present:fs.existsSync(path.join(work,'child-stopped')),proof_scope:'this controlled Python child only; not arbitrary descendants'});
  const next=randomUUID();await bounded(()=>broker.host.start({text:'Without tools, reply with the original IO_CONTEXT token and nothing else.',clientUserMessageId:next,expiresAt:new Date(Date.now()+90000).toISOString()}),'CONTINUE_ADMISSION');
  const continued=await until(async()=>{const r=await broker.host.inspectOperation(next);return r.status==='completed'&&r.resultComplete===true?r:false;},'REMOTE_CONTINUE');
  assert(continued.result?.text.includes(nonce));check('remote_continue_same_session',{context_matches:true});report.ok=true;
}catch(error){report.ok=false;report.error=String(error.code??error.message??'VERIFY_FAILED').slice(0,1200);process.exitCode=1;
  if(broker&&report.stop_attempt?.turn_id)try{report.native_stop=await broker.host.inspectStop(report.stop_attempt.turn_id);}catch{}
  try{report.operations=broker?.snapshot().map(({operation_id,kind,phase,turn_id,reason})=>({operation_id,kind,phase,turn_id,reason}));}catch{report.snapshot_error='SNAPSHOT_FAILED';}}
finally{
  const cleanupErrors=[],engineAlive=()=>child&&Number.isInteger(child.pid)&&child.exitCode===null&&child.signalCode===null;
  const signal=(pid,name)=>{try{process.kill(pid,name);}catch(error){if(error.code!=='ESRCH')throw error;}};
  // Cleanup has its own short deadlines and ignores the test abort signal.
  // It is never counted as the successful native interrupt above.
  try{
    if(engineAlive()){child.stdin.end();signal(-child.pid,'SIGTERM');await Promise.race([childExit,sleep(5000)]);
      if(engineAlive()){signal(-child.pid,'SIGKILL');await Promise.race([childExit,sleep(2000)]);}}
  }catch(error){cleanupErrors.push(`engine:${error.code??error.message}`);}
  let controlledExited=!workRequested;
  try{
    if(captureToolRecord()){
      if(originalToolAlive()){signal(toolPid,'SIGTERM');await sleep(300);if(originalToolAlive()){signal(toolPid,'SIGKILL');await sleep(300);}}
      controlledExited=!originalToolAlive();
    }
  }catch(error){cleanupErrors.push(`controlled_child:${error.code??error.message}`);controlledExited=false;}
  let brokerClosed=!broker,closeTimer;
  try{if(broker){await Promise.race([broker.close(),new Promise((resolve,reject)=>{closeTimer=setTimeout(()=>reject(new Error('BROKER_CLOSE_TIMEOUT')),3000);})]);brokerClosed=true;}}
  catch(error){cleanupErrors.push(`broker:${error.code??error.message}`);}finally{clearTimeout(closeTimer);}
  try{if(broker&&arg('--diagnostics')==='yes'){
    report.hookDiagnostics={};for(const name of ['prompt.submit','turn.start','turn.complete']){
      const file=path.join(broker.pluginDirectory,`diagnostic-${name}.json`);if(fs.existsSync(file))report.hookDiagnostics[name]=JSON.parse(fs.readFileSync(file,'utf8'));
    }
  }}catch(error){cleanupErrors.push(`diagnostics:${error.code??error.message}`);}
  report.cleanup={engine_exited:!engineAlive(),controlled_child_exited:controlledExited,broker_closed:brokerClosed,errors:cleanupErrors};
  const clean=report.cleanup.engine_exited&&controlledExited&&brokerClosed&&cleanupErrors.length===0;
  if(!clean){report.ok=false;report.error??='CLEANUP_UNCONFIRMED';report.retained_directory=dir;process.exitCode=1;}
  if(interruption.signal.aborted){report.ok=false;report.error??=interruption.signal.reason.message;process.exitCode=1;}
  // Diagnostic log stays private and contains only this synthetic engine run.
  if(!report.ok&&arg('--diagnostics')==='yes')fs.writeFileSync(reportFile+'.stderr',stderr,{mode:0o600});
  report.finished_at=new Date().toISOString();save();
  if(clean)fs.rmSync(dir,{recursive:true,force:true});
  process.stdout.write(JSON.stringify({ok:report.ok,error:report.error,report:reportFile,cleanup:report.cleanup})+'\n');
  process.removeListener('SIGINT',onSigint);process.removeListener('SIGTERM',onSigterm);
}
