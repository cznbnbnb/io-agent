// ask/wait/status for the caller that is already executing this command.
// The host registers routing once. JSON input cannot select routes or executables.
import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import {spawnSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
import {AgentBridge} from '../bridge.mjs';import {BridgeClient,BridgeError,readPrivateJson} from '../client.mjs';import {AdapterHost} from '../adapter-host.mjs';
import {isDeepStrictEqual} from 'node:util';
const here=path.dirname(fileURLToPath(import.meta.url)),workspace=path.resolve(here,'../../..');
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
const fail=code=>{throw new BridgeError(code,{permanent:true});};
// Hosts that put their own conversation id into every command they run (mirrors context.py).
// Any other agent's host sets IO_AGENT_CALLER_RUNTIME/IO_AGENT_CALLER_SESSION; more than one source is refused.
const NATIVE={codex:['CODEX_THREAD_ID','Codex'],'claude-code':['CLAUDE_CODE_SESSION_ID','Claude Code']};
export function caller(env=process.env){const found=Object.entries(NATIVE).filter(([,[name]])=>env[name]).map(([runtime,[name]])=>({runtime,session:env[name]}));
 if(env.IO_AGENT_CALLER_RUNTIME||env.IO_AGENT_CALLER_SESSION){const runtime=env.IO_AGENT_CALLER_RUNTIME??'';if(Object.hasOwn(NATIVE,runtime))return{error:'CALLER_RUNTIME_INVALID'};found.push({runtime,session:env.IO_AGENT_CALLER_SESSION??''});}
 if(found.length!==1)return{error:found.length?'CALLER_RUNTIME_AMBIGUOUS':'CALLER_SESSION_REQUIRED'};const [{runtime,session}]=found;
 return /^[a-z][a-z0-9-]{1,31}$/.test(runtime)&&/^[A-Za-z0-9_.-]{1,128}$/.test(session)?{runtime,session}:{error:'CALLER_SESSION_REQUIRED'};}
export const taskCommand=runtime=>'Continue the already-running registered '+(NATIVE[runtime]?.[1]??runtime)+' task.';
// Codex keeps its original directory so earlier registrations stay readable.
export const callerBase=({runtime,session})=>path.join(workspace,'rebuild/agent-bridge/private',runtime==='codex'?'codex-'+hash(JSON.stringify([workspace.toLowerCase(),session])).slice(0,24):runtime+'-'+hash(JSON.stringify([workspace.toLowerCase(),runtime,session])).slice(0,24));
const current=caller(),{runtime,session}=current;
function location(){if(current.error)fail(current.error);if(fs.realpathSync(process.cwd()).toLowerCase()!==fs.realpathSync(workspace).toLowerCase())fail('CALLER_PROJECT_MISMATCH');return callerBase(current);}
function writeNew(file,value){const fd=fs.openSync(file,'wx',0o600);try{fs.writeFileSync(fd,JSON.stringify(value,null,2)+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
function activeDirectory(){const base=location(),active=readPrivateJson(path.join(base,'active.json'));if(active.schema!==1||!/^[a-f0-9]{64}$/.test(active.profile))fail('CALLER_ACTIVE_CONTEXT_INVALID');const dir=path.join(base,'registrations',active.profile);if(fs.lstatSync(dir).isSymbolicLink()||fs.realpathSync(dir)!==dir)fail('CALLER_ACTIVE_CONTEXT_INVALID');return dir;}
function python(command,args,options={}){const r=spawnSync(command,['-I','-S','-B',...args],{cwd:workspace,encoding:'utf8',timeout:45000,maxBuffer:1048576,windowsHide:true,...options});if(r.error||r.status!==0){let code;try{code=JSON.parse(r.stdout).error;}catch{}fail(/^[A-Z_]{3,80}$/.test(code??'')?code:'CALLER_TOOL_FAILED');}try{return JSON.parse(r.stdout);}catch{fail('CALLER_TOOL_INVALID_REPLY');}}
function binding(directory){const config=readPrivateJson(path.join(directory,'host.json'));const context=readPrivateJson(path.join(directory,'context.json'));if(context.caller.session_id!==session||context.caller.cwd!==workspace)fail('CALLER_SESSION_MISMATCH');return{config,context};}
function local(directory,action,input){const {config}=binding(directory);return python(config.python,[path.join(here,'tool.py'),action],{env:{...process.env,IO_AGENT_CONTEXT:path.join(directory,'context.json')},input:JSON.stringify(input)});}
function delivery(directory,value,save=false){if(!value.answer)return false;const file=path.join(directory,'delivered-'+hash(value.request_id)+'.json'),record={schema:1,request_id:value.request_id,answer_id:value.answer.answer_id,answer_sha256:hash(JSON.stringify(value.answer))};if(fs.existsSync(file)){if(!isDeepStrictEqual(readPrivateJson(file),record))fail('CALLER_DELIVERY_CONFLICT');return true;}if(save){writeNew(file,record);return true;}return false;}
async function activeTask(bridge,directory){const {context}=binding(directory),task=await bridge.client.object('task',context.task_id);if(!isDeepStrictEqual(task.body.route,context.route))fail('CALLER_TASK_ROUTE_MISMATCH');return ['queued','agent_received','running','waiting_answer'].includes(task.state)?null:task.state;}
async function withBridge(directory,callback,deadline=Date.now()+30000){const {config}=binding(directory),adapter=new AdapterHost({command:config.python,args:['-I','-S','-B',path.join(here,'adapter.py'),'--config',path.join(directory,'context.json')],timeoutMs:15000,name:'existing-'+runtime+'-caller'});const fetchImpl=(url,options)=>fetch(url,{...options,signal:AbortSignal.any([options.signal,AbortSignal.timeout(Math.max(1,deadline-Date.now()))])});const bridge=new AgentBridge({config:config.bridge,adapter,stateFile:path.join(directory,'bridge-state.json'),fetchImpl});try{await bridge.start();return await callback(bridge);}finally{await bridge.stop();}}
// Optional conversation topic (2026-10-23, user): the wearer cannot see the asking chat, so the task
// command carries a short one-line topic, shown in the phone task list and the prompter header.
const topicValid=t=>typeof t==='string'&&t.length>=1&&t.length<=40&&t.trim()===t&&!/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/.test(t);
async function register(file){const spec=readPrivateJson(file),base=location(),keys=['bridge','operation_key','project_id','python',...('topic' in spec?['topic']:[])];if(Object.keys(spec).sort().join()!==keys.sort().join()||('topic' in spec&&!topicValid(spec.topic))||!path.isAbsolute(spec.python)||!fs.existsSync(spec.python)||!/^[A-Za-z0-9_.-]{1,128}$/.test(spec.project_id)||!/^[A-Za-z0-9_.-]{1,128}$/.test(spec.operation_key))fail('CALLER_ENROLLMENT_INVALID');
 const route={computer_id:spec.bridge.computer_id,agent_id:spec.bridge.agent_id,project_id:spec.project_id,session_id:session};for(const v of Object.values(route))if(typeof v!=='string'||!/^[A-Za-z0-9_.-]{1,128}$/.test(v))fail('CALLER_ENROLLMENT_INVALID');
 const taskId=runtime+'-task-'+hash(JSON.stringify([spec.bridge.owner_id,spec.bridge.server_id,route,spec.operation_key]));
 const profile=hash(JSON.stringify([spec.bridge.owner_id,spec.bridge.server_id,spec.bridge.producer_id,route,spec.operation_key])),directory=path.join(base,'registrations',profile);
 if(!fs.existsSync(base)){fs.mkdirSync(base);const acl=spawnSync(spec.python,['-I','-S','-B','-c',"import sys;sys.path.insert(0,sys.argv[1]);from pathlib import Path;from enroll_home import protect_directory;protect_directory(Path(sys.argv[2]))",path.join(here,'../hermes'),base],{encoding:'utf8',timeout:15000,windowsHide:true});if(acl.status!==0)fail('CALLER_PRIVATE_DIRECTORY_FAILED');fs.mkdirSync(path.join(base,'registrations'));}
 if(fs.existsSync(path.join(base,'active.json'))&&activeDirectory()!==directory){const previous=activeDirectory(),{config}=binding(previous);const probe=python(config.python,['-c',"import os,sys,json;sys.path.insert(0,sys.argv[1]);from context import load_context;c,j=load_context(os.environ['IO_AGENT_CONTEXT'],readonly=True);print(json.dumps({'pending':j.has_unsettled_questions(c['operation_id'])}));j.close()",here],{env:{...process.env,IO_AGENT_CONTEXT:path.join(previous,'context.json')}});if(probe.pending)fail('CALLER_PENDING_REBIND_DENIED');}
 if(!fs.existsSync(directory)){fs.mkdirSync(directory);
  const context={schema:1,runtime,caller:{session_id:session,cwd:workspace},journal:path.join(directory,'journal.sqlite'),binding:Object.fromEntries(['server_id','owner_id','producer_id','computer_id','agent_id'].map(k=>[k,spec.bridge[k]])),route,task_id:taskId,operation_id:'op-'+hash(JSON.stringify(taskId)),...('topic' in spec?{command:spec.topic}:{})};
  const created=new Date(),event={schema_version:'1.0',event_id:crypto.randomUUID(),idempotency_key:crypto.randomUUID(),kind:'task',producer_id:spec.bridge.producer_id,created_at:created.toISOString(),expires_at:new Date(created.getTime()+3600000).toISOString(),body:{task_id:taskId,revision:1,route,command:spec.topic??taskCommand(runtime),state:'queued',allow_create_session:false}};
  writeNew(path.join(directory,'host.json'),spec);writeNew(path.join(directory,'context.json'),context);writeNew(path.join(directory,'registration.json'),{event});
 }
 const {config,context}=binding(directory);if(JSON.stringify(config)!==JSON.stringify(spec)||context.task_id!==taskId)fail('CALLER_REGISTRATION_CONFLICT');
 const client=new BridgeClient(spec.bridge),identity=await client.identity();if(!identity.scopes?.includes('tasks:write'))fail('CALLER_TASK_PUBLISH_SCOPE_REQUIRED');
 const event=readPrivateJson(path.join(directory,'registration.json')).event;
 try{await client.event(event.event_id,event);}catch(e){if(e.status!==404)throw e;await client.post('task',event);}
 await withBridge(directory,async bridge=>{await bridge.pollOnce();await bridge.pollOnce();});
 const active=path.join(base,'active.json');if(!fs.existsSync(active)||readPrivateJson(active).profile!==profile){const partial=path.join(base,'active.partial');writeNew(partial,{schema:1,profile});fs.renameSync(partial,active);}
 return {registered:true,caller_verified:true,context_sha256:hash(JSON.stringify(context.caller)),task_id:taskId,runtime,creates_agent_session:false,...(runtime==='codex'?{creates_codex_session:false}:{})};
}
// Glasses progress contract (2026-10-23, user: any agent handed this CLI must report every next step on the
// glasses, and the agent itself can switch that off). `checkpoint` = what was just done + what comes next; it
// is shown on the glasses and arms a server watch, so a forgotten report still reaches the wearer as a
// server-made notice once the declared check-in time passes. Every reply carries `progress` with the duty.
const POLICY={schema:1,glasses_progress:true,checkin_minutes:20};
const CONTRACT=['每完成一步（或改变计划）就调用 checkpoint：done=刚完成什么，next=推荐的下一步；默认推送到眼镜。',
 '需要用户决定时用 ask，阻塞时用 notify；它们不代替 checkpoint。',
 '回复里 progress.checkpoint_due=true 时，在结束本轮前先 checkpoint。',
 'next_checkin_minutes 是你承诺的下次报到时间；超时未报到，服务器会自己在眼镜上提醒用户。',
 '用户要求不推送时调用 config {"glasses_progress":false}；恢复用 true。'];
const shortText=t=>typeof t==='string'&&t.trim().length>0&&t.length<=600&&!/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/.test(t);
function replace(file,value){const partial=file+'.partial';fs.rmSync(partial,{force:true});writeNew(partial,value);fs.renameSync(partial,file);}
function policy(directory){const file=path.join(directory,'progress-policy.json');if(!fs.existsSync(file))return{...POLICY};const p=readPrivateJson(file);if(p.schema!==1||typeof p.glasses_progress!=='boolean'||!Number.isInteger(p.checkin_minutes)||p.checkin_minutes<5||p.checkin_minutes>120)fail('CALLER_PROGRESS_POLICY_INVALID');return p;}
function progressState(directory){const file=path.join(directory,'progress.json');return fs.existsSync(file)?readPrivateJson(file):null;}
function progress(directory,answered=false){try{const p=policy(directory);if(!p.glasses_progress)return{glasses_progress:false,checkpoint_due:false};const s=progressState(directory);
 return{glasses_progress:true,checkpoint_due:answered||!s||Date.now()>=Date.parse(s.next_checkin_at),next_checkin_at:s?.next_checkin_at??null,rule:CONTRACT[0]};}catch{return{glasses_progress:null,checkpoint_due:true,rule:CONTRACT[0]};}}
async function checkpoint(directory,value){
 const keys=Object.keys(value??{}).sort().join();
 if(!['checkpoint_key,done,next','checkpoint_key,done,next,next_checkin_minutes'].includes(keys)||typeof value.checkpoint_key!=='string'||!/^[A-Za-z0-9_.-]{1,96}$/.test(value.checkpoint_key)||!shortText(value.done)||!shortText(value.next)||('next_checkin_minutes' in value&&(!Number.isInteger(value.next_checkin_minutes)||value.next_checkin_minutes<5||value.next_checkin_minutes>120)))fail('RUNTIME_TOOL_ARGUMENT_INVALID');
 const {config,context}=binding(directory),p=policy(directory),id='notice-'+hash(JSON.stringify([context.task_id,'checkpoint',value.checkpoint_key])),file=path.join(directory,'checkpoint-'+hash(value.checkpoint_key)+'.json');
 let saved;if(fs.existsSync(file)){saved=readPrivateJson(file);if(!isDeepStrictEqual(saved.input,value))fail('CALLER_CHECKPOINT_CONFLICT');}
 else{const now=Date.now(),minutes=value.next_checkin_minutes??p.checkin_minutes;saved={input:value,glasses_progress:p.glasses_progress,next_checkin_at:new Date(now+minutes*60000).toISOString(),
  event:p.glasses_progress?{schema_version:'1.0',event_id:'ev-'+id,idempotency_key:'idem-'+id,producer_id:config.bridge.producer_id,kind:'message',created_at:new Date(now).toISOString(),expires_at:new Date(now+3000000).toISOString(),body:{message_id:id,revision:1,task_id:context.task_id,route:context.route,request_id:null,channel:'progress',text:'已完成：'+value.done+'\n下一步：'+value.next}}:null};writeNew(file,saved);}
 replace(path.join(directory,'progress.json'),{schema:1,last_checkpoint_key:value.checkpoint_key,last_checkpoint_at:saved.event?.created_at??new Date().toISOString(),next_checkin_at:saved.next_checkin_at});
 const client=new BridgeClient(config.bridge),result={checkpoint:true,checkpoint_key:value.checkpoint_key,glasses_display:saved.event?'notice':'off',glasses_display_confirmed:false,next_checkin_at:saved.next_checkin_at,requires_answer:false};
 try{const closed=await activeTask({client},directory);if(closed)fail('CALLER_TASK_CLOSED');if(saved.event)await client.post('message',saved.event);
  const watch=await client.watch(context.task_id,{enabled:saved.glasses_progress,next_checkin_at:saved.glasses_progress?saved.next_checkin_at:null,note:value.next});
  return{...result,message_id:saved.event?id:null,server_stored:true,server_watch:watch.enabled?'armed':'off',caller_verified:true};}
 catch(error){return{...result,error:error instanceof BridgeError?error.code:'CALLER_SYNC_FAILED',message_id:saved.event?id:null,locally_stored:true,server_stored_unconfirmed:true};}
}
async function configure(directory,value){
 const keys=Object.keys(value??{});
 if(!keys.length||keys.some(k=>!['glasses_progress','checkin_minutes'].includes(k))||('glasses_progress' in value&&typeof value.glasses_progress!=='boolean')||('checkin_minutes' in value&&(!Number.isInteger(value.checkin_minutes)||value.checkin_minutes<5||value.checkin_minutes>120)))fail('RUNTIME_TOOL_ARGUMENT_INVALID');
 const next={...policy(directory),...value,schema:1};replace(path.join(directory,'progress-policy.json'),next);
 const result={policy:next,contract:CONTRACT};if(next.glasses_progress)return{...result,server_watch:'armed_at_next_checkpoint'};
 const {config,context}=binding(directory);
 try{await new BridgeClient(config.bridge).watch(context.task_id,{enabled:false,next_checkin_at:null,note:''});return{...result,server_watch:'off'};}
 catch(error){return{...result,error:error instanceof BridgeError?error.code:'CALLER_SYNC_FAILED',server_watch:'off_unconfirmed'};}
}
async function input(){let bytes=0,parts=[];for await(const part of process.stdin){bytes+=part.length;if(bytes>32768)fail('RUNTIME_CLI_FRAME_TOO_LARGE');parts.push(part);}try{return JSON.parse(Buffer.concat(parts).toString('utf8'));}catch{fail('RUNTIME_TOOL_ARGUMENT_INVALID');}}
export async function run(action,args){const result=await dispatch(action,args);if(['ask','wait','status','notify'].includes(action)&&result&&typeof result==='object')try{result.progress=progress(activeDirectory(),action==='wait'&&result.state==='answered');}catch{}return result;}
async function dispatch(action,args){if(action==='register'){if(args.length!==2||args[0]!=='--config')fail('CALLER_ENROLLMENT_REQUIRED');const r=await register(path.resolve(args[1]));return{...r,contract:CONTRACT};}
 if(action==='help'&&!args.length)return{commands:{ask:'question_key, question, mode, options, expires_at',wait:'request_id, wait_seconds?',status:'request_id',notify:'notification_key, text, expires_at',checkpoint:'checkpoint_key, done, next, next_checkin_minutes?',config:'glasses_progress?, checkin_minutes?'},contract:CONTRACT};
 if(args.length||!['ask','wait','status','notify','checkpoint','config'].includes(action))fail('RUNTIME_CLI_ACTION_INVALID');const directory=activeDirectory(),value=await input();
 if(action==='checkpoint')return checkpoint(directory,value);
 if(action==='config')return configure(directory,value);
 if(action==='notify'){
  if(!value||Object.keys(value).sort().join()!=='expires_at,notification_key,text'||typeof value.notification_key!=='string'||!/^[A-Za-z0-9_.-]{1,96}$/.test(value.notification_key)||typeof value.text!=='string'||!value.text.trim()||value.text.length>1800||/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/.test(value.text)||typeof value.expires_at!=='string'||!value.expires_at.endsWith('Z')||!Number.isFinite(Date.parse(value.expires_at)))fail('RUNTIME_TOOL_ARGUMENT_INVALID');
  const {config,context}=binding(directory),id='notice-'+hash(JSON.stringify([context.task_id,value.notification_key])),file=path.join(directory,id+'.json');
  let event;
  if(fs.existsSync(file)){const saved=readPrivateJson(file);if(!isDeepStrictEqual(saved.input,value))fail('CALLER_NOTIFICATION_CONFLICT');event=saved.event;}
  else{if(Date.parse(value.expires_at)<=Date.now()||Date.parse(value.expires_at)>Date.now()+3600000)fail('RUNTIME_DEADLINE_INVALID');event={schema_version:'1.0',event_id:'ev-'+id,idempotency_key:'idem-'+id,producer_id:config.bridge.producer_id,kind:'message',created_at:new Date().toISOString(),expires_at:value.expires_at,body:{message_id:id,revision:1,task_id:context.task_id,route:context.route,request_id:null,channel:'progress',text:value.text}};writeNew(file,{input:value,event});}
  const client=new BridgeClient(config.bridge);
  try{const closed=await activeTask({client},directory);if(closed)fail('CALLER_TASK_CLOSED');await client.post('message',event);}catch(error){return{error:error instanceof BridgeError?error.code:'CALLER_SYNC_FAILED',message_id:id,locally_stored:true,server_stored_unconfirmed:true,requires_answer:false};}
  return{message_id:id,server_stored:true,caller_verified:true,requires_answer:false,glasses_display:'notice',glasses_display_confirmed:false};
 }
 if(action==='status')return local(directory,'status',value);
 if(action==='ask'){const result=local(directory,'ask',value);try{return await withBridge(directory,async bridge=>{await bridge.pollOnce();const {context}=binding(directory),task=await bridge.client.object('task',context.task_id);if(!['queued','agent_received','running','waiting_answer'].includes(task.state))fail('CALLER_TASK_CLOSED');await bridge.flush();const saved=await bridge.client.object('request',result.request_id);if(saved.body.task_id!==context.task_id||!isDeepStrictEqual(saved.body.route,context.route))fail('CALLER_REQUEST_ROUTE_MISMATCH');return{...result,server_stored:true,caller_verified:true};});}catch(error){return{error:error instanceof BridgeError?error.code:'CALLER_SYNC_FAILED',request_id:result.request_id,locally_stored:true,server_stored_unconfirmed:true};}}
 if(!value||Object.keys(value).some(k=>!['request_id','wait_seconds'].includes(k))||typeof value.request_id!=='string'||!Number.isFinite(value.wait_seconds??30)||(value.wait_seconds??30)<0||(value.wait_seconds??30)>600)fail('RUNTIME_TOOL_ARGUMENT_INVALID');
 const cached=local(directory,'status',{request_id:value.request_id});
 if(cached.state==='answered'&&delivery(directory,cached))return{...cached,network_checked:false,caller_verified:true,already_delivered:true};
 // The last poll at the wait limit still needs network time, so the bridge deadline adds 10 s of grace.
 const until=Date.now()+(value.wait_seconds??30)*1000;
 try{return await withBridge(directory,async bridge=>{let status;do{await bridge.pollOnce();status=local(directory,'status',{request_id:value.request_id});if(status.state!=='pending'||status.deadline_elapsed||Date.now()>=until)break;await new Promise(r=>setTimeout(r,Math.min((value.wait_seconds??30)>30?3000:1000,Math.max(0,until-Date.now()))));}while(true);if(status.state==='answered'){const closed=await activeTask(bridge,directory);if(closed)return{...status,state:'operation_closed',server_task_state:closed,network_checked:true,caller_verified:true};status=local(directory,'wait',{request_id:value.request_id,wait_seconds:0});await bridge.pollOnce();await bridge.flush();delivery(directory,status,true);}return{...status,network_checked:true,caller_verified:true};},until+10000);}
 catch(error){const retained=local(directory,'status',{request_id:value.request_id});return{...retained,state:retained.state==='answered'?'awaiting_parent_check':retained.state,error:error instanceof BridgeError?error.code:'CALLER_SYNC_FAILED',network_checked:true,caller_verified:true,sync_pending:true};}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))try{const [action,...args]=process.argv.slice(2),result=await run(action,args);process.stdout.write(JSON.stringify(result)+'\n');if(result.error)process.exitCode=2;}catch(error){process.stdout.write(JSON.stringify({error:error instanceof BridgeError?error.code:'CALLER_FAILED'})+'\n');process.exitCode=2;}
