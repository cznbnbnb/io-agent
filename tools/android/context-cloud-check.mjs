// Explicit synthetic-owner test. Credential issuance is a separate authorized operation.
import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import {fileURLToPath} from 'node:url';
import {BridgeClient,readPrivateJson} from '../../rebuild/agent-bridge/client.mjs';
const workspace=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..'),root=path.join(workspace,'rebuild/android-app');
const action=process.argv[2];let scopeFile=path.join(root,'context-cloud-check-scope.json'),only=null,transcriptSha=null;
const args=process.argv.slice(3);for(let i=0;i<args.length;i++){
 if(args[i]==='--apply')continue;
 if(args[i]==='--scope-file'){if(!args[i+1]||args[i+1].startsWith('--'))throw Error('SCOPE_FILE_REQUIRED');scopeFile=path.resolve(workspace,args[++i]);}
 else if(args[i]==='--context'){only=args[++i];if(!['codex','hermes','qa'].includes(only))throw Error('CONTEXT_INVALID');}
 else if(args[i]==='--transcript-sha256'){transcriptSha=args[++i];if(!/^[a-f0-9]{64}$/.test(transcriptSha||''))throw Error('TRANSCRIPT_HASH_INVALID');}
 else throw Error('EXPLICIT_ARGUMENT_REQUIRED');
}
if(!scopeFile.startsWith(root+path.sep)||fs.lstatSync(scopeFile).isSymbolicLink()||!fs.realpathSync(scopeFile).startsWith(fs.realpathSync(root)+path.sep))throw Error('SCOPE_PATH_INVALID');
const scope=readPrivateJson(scopeFile),voice=scope.kind==='normal-voice-synthetic-routing';
if(!['--scope','--prepare','--verify','--close'].includes(action))throw Error('EXPLICIT_ACTION_REQUIRED');
const scopeAllowed=scope.schema===1&&scope.destination==='https://cznbnb.cn/io-api/v1/'&&scope.owner_id==='synthetic-cloud-'+scope.run_id&&(scope.run_id==='contexts203-20261020-a'&&!voice||voice&&/^voice[0-9]{3}-[a-z0-9-]{1,40}$/.test(scope.run_id));
if(!scopeAllowed)throw Error('EXPLICIT_SYNTHETIC_TEST_REQUIRED');
if(action==='--scope'){console.log(JSON.stringify(Object.fromEntries(['schema','kind','destination','run_id','owner_id'].filter(k=>scope[k]!==undefined).map(k=>[k,scope[k]]))));process.exit(0);}
if(!process.argv.includes('--apply'))throw Error('EXPLICIT_SYNTHETIC_TEST_REQUIRED');
if((only||transcriptSha)&&action!=='--verify')throw Error('VERIFY_ARGUMENTS_REQUIRED');
if((only||transcriptSha)&&!voice||action==='--verify'&&voice&&(!only||!transcriptSha))throw Error('EXACT_VOICE_CONTEXT_AND_TRANSCRIPT_REQUIRED');
const run=path.join(workspace,'rebuild/agent-bridge/private','cloud-'+scope.run_id),bundle=readPrivateJson(path.join(run,'bundle.json'));
if(bundle.run_id!==scope.run_id||bundle.agent.owner_id!==scope.owner_id||bundle.phone.owner_id!==scope.owner_id||bundle.phone.producer_id!=='cloud-phone'||bundle.agent.base_url!==scope.destination)throw Error('SYNTHETIC_OWNER_MISMATCH');
const agent=new BridgeClient(bundle.agent),record=path.join(run,'context-check.json');
const put=(file,value)=>fs.writeFileSync(file,JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});
const routeKey=r=>JSON.stringify(Object.fromEntries(Object.entries(r).sort(([a],[b])=>a.localeCompare(b))));
let plan;if(fs.existsSync(record))plan=readPrivateJson(record);else{
 if(action!=='--prepare')throw Error('PREPARE_RECORD_REQUIRED');const now=Date.now();plan={schema:1,run_id:scope.run_id,created_at:new Date(now).toISOString(),expires_at:new Date(now+3300000).toISOString(),contexts:['codex','hermes','qa'].map(key=>({key,task_id:'task-context-'+crypto.randomUUID(),request_id:'request-context-'+crypto.randomUUID(),route:{computer_id:'io-context-test-computer',agent_id:'io-context-'+key,project_id:'io-android-context-check',session_id:'synthetic-'+key},question:(voice?'正常原问题口述检查：':'多路接收检查：')+key,answer:key+' 合成答案。\n附加条件：保留原问题，不能转投其他会话。'}))};put(record,plan);
}
if(plan.run_id!==scope.run_id||plan.contexts.length!==3)throw Error('TEST_RECORD_MISMATCH');
async function submit(name,kind,body){const file=path.join(run,'event-'+name+'.json');let event;if(fs.existsSync(file))event=readPrivateJson(file);else{event={schema_version:'1.0',event_id:crypto.randomUUID(),idempotency_key:crypto.randomUUID(),producer_id:bundle.agent.producer_id,kind,created_at:plan.created_at,expires_at:plan.expires_at,body};put(file,event);}if(JSON.stringify(event.body)!==JSON.stringify(body))throw Error('IMMUTABLE_TEST_EVENT_CHANGED');await agent.post(kind,event);}
if(action==='--prepare'){
 const credential=readPrivateJson(bundle.phone.credential_file);
 for(const context of plan.contexts){
  for(const [revision,state] of [[1,'queued'],[2,'agent_received'],[3,'waiting_answer']])await submit(context.key+'-'+state,'task',{task_id:context.task_id,revision,route:context.route,state,command:'合成收件箱检查；不调用模型、不执行电脑动作。',allow_create_session:false});
  await submit(context.key+'-request','request',{request_id:context.request_id,task_id:context.task_id,revision:1,route:context.route,state:'pending',mode:'free_text',question:context.question,options:[],runtime_request_id:null});
  const file=path.join(run,'connection-'+context.key+'.json');if(!fs.existsSync(file))put(file,{format:'turboio-task-connection/1',base_url:bundle.phone.base_url,owner_id:bundle.phone.owner_id,producer_id:bundle.phone.producer_id,server_id:bundle.phone.server_id,...credential,...context.route});
 }
 console.log(JSON.stringify({prepared:true,synthetic_tasks:3,synthetic_questions:3,model_or_agent_launched:false,phone_answer_submitted:false}));
}else if(action==='--verify'){
 const rows=[],objects=[];for(const c of plan.contexts.filter(c=>!only||c.key===only)){const request=await agent.object('request',c.request_id),answer=request.answer?.body;
  if(request.state!=='answered'||!answer||answer.request_id!==c.request_id||answer.request_revision!==1||answer.task_id!==c.task_id||routeKey(answer.route)!==routeKey(c.route))throw Error('ORIGINAL_ANSWER_NOT_VERIFIED');
  if(voice){const text=answer.text;if(answer.input_source!=='voice'||typeof text!=='string'||crypto.createHash('sha256').update(text,'utf8').digest('hex')!==transcriptSha||!['预览','不要修改文件','保留全部资料'].every(part=>text.includes(part))||!text.includes('星期五')&&!text.includes('周五'))throw Error('COMPLETE_ORIGINAL_VOICE_NOT_VERIFIED');}
  else if(answer.text!==c.answer)throw Error('ORIGINAL_ANSWER_NOT_VERIFIED');
  rows.push({key:c.key,original_task_request_revision_route_match:true,complete_multiline_answer:!voice,complete_voice_transcript_sha256:voice?transcriptSha:null,voice_input_source:voice});objects.push(request);
 }
 const suffix=voice?'-voice-'+only:'';fs.writeFileSync(path.join(run,'context-server-objects'+suffix+'.json'),JSON.stringify(objects,null,2)+'\n',{mode:0o600});
 const result={schema:1,at:new Date().toISOString(),rows,model_or_agent_launched:false,glasses_or_voice_verified:false,physical_glasses_verified:false,normal_voice_requires_independent_device_evidence:voice};fs.writeFileSync(path.join(run,'context-server-check'+suffix+'.json'),JSON.stringify(result,null,2)+'\n',{mode:0o600});console.log(JSON.stringify(voice?{server_original_answers:'matched',answers:rows.length,voice_input_verified:true,actual_agent_runtime_or_glasses:false}:{server_three_route_answers:'matched',answers:rows.length,actual_agent_runtime_or_glasses:false}));
}else{
 const closed=[];for(const c of plan.contexts){let task=await agent.object('task',c.task_id);const steps=task.state==='cancel_requested'?['cancelled']:['cancel_requested','cancelled'];for(const state of steps){if(task.state==='cancelled')break;const body={...task.body,revision:task.revision+1,state};await submit(c.key+'-'+state,'task',body);task=await agent.object('task',c.task_id);}if(task.state!=='cancelled')throw Error('SYNTHETIC_TASK_NOT_CLOSED');closed.push(task);}
 fs.writeFileSync(path.join(run,'context-closed.json'),JSON.stringify(closed,null,2)+'\n',{mode:0o600});
 console.log(JSON.stringify({synthetic_tasks_closed:true}));
}
