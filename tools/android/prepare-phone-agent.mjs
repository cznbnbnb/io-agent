// Explicit isolated real-provider route for the physical Android task check.
// Credentials stay in private files. This never submits a task or answer.
import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';import {spawnSync} from 'node:child_process';
import os from 'node:os';
import {readPrivateJson} from '../../rebuild/agent-bridge/client.mjs';
import {WINDOWS} from './host-tools.mjs';
const workspace=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
// --workspace-tools enrolls io-workspace-cli-v1 (file/terminal inside the run workspace); default stays question-only.
const [flag,runId,...extra]=process.argv.slice(2),workspaceTools=extra.length===1&&extra[0]==='--workspace-tools';
if(extra.length&&!workspaceTools)throw Error('UNKNOWN_ARGUMENT');
if(flag!=='--run-id'||!/^phone[0-9]{3}-[a-z0-9-]{1,40}$/.test(runId??''))throw Error('EXPLICIT_ANDROID_RUN_REQUIRED');
const parent=path.join(workspace,'rebuild/agent-bridge/private'),run=path.join(parent,'phone-'+runId),bundle=readPrivateJson(path.join(parent,'cloud-'+runId,'bundle.json'));
if(bundle.run_id!==runId||bundle.phone.owner_id!=='synthetic-cloud-'+runId||bundle.agent.owner_id!==bundle.phone.owner_id||bundle.phone.producer_id!=='cloud-phone'||bundle.agent.base_url!=='https://cznbnb.cn/io-api/v1/')throw Error('ISOLATED_BINDING_REQUIRED');
if(fs.existsSync(run))throw Error('RUN_EXISTS_INSPECT_INSTEAD_OF_REENROLLING');
fs.mkdirSync(run);fs.mkdirSync(path.join(run,'workspace'));
// Pinned Hermes (rebuild/agent-bridge/hermes/pinned_runtime.py). Elsewhere a clean project-local
// checkout at that commit with its uv environment; the user's own Hermes only supplies the provider.
const hermes=WINDOWS?{python:'D:/APP/hermes/installs/712bb20a9e2cdd0b/environments/5e0869adbda74f8a9156d4b7944add81/venv/Scripts/python.exe',source:'D:/APP/hermes/hermes-agent',config:'D:/APP/hermes/config.yaml'}
 :{python:path.join(workspace,'.runtime/hermes-agent/.venv/bin/python3'),source:path.join(workspace,'.runtime/hermes-agent'),config:path.join(os.homedir(),'.hermes/config.yaml')};
const python=hermes.python,sitePackages=WINDOWS?path.join(path.dirname(path.dirname(python)),'Lib/site-packages'):path.join(path.dirname(path.dirname(python)),'lib/python3.14/site-packages');
const protect="import sys;sys.path.insert(0,sys.argv[1]);from pathlib import Path;from enroll_home import protect_directory;protect_directory(Path(sys.argv[2]))";
const acl=spawnSync(python,['-I','-S','-B','-c',protect,path.join(workspace,'rebuild/agent-bridge/hermes'),run],{encoding:'utf8',timeout:15000,windowsHide:true});if(acl.status!==0)throw Error('PRIVATE_DIRECTORY_FAILED');
const binding=Object.fromEntries(['server_id','owner_id','producer_id','computer_id','agent_id'].map(k=>[k,bundle.agent[k]]));
const spec={home:path.join(run,'home'),binding,project_id:'io-android-text-check',cwd:path.join(run,'workspace'),source:hermes.source,site_packages:sitePackages,provider_config:hermes.config,provider_name:'token-share',model:'kimi-k3',...(workspaceTools?{profile:'io-workspace-cli-v1'}:{})};
const save=(name,value)=>fs.writeFileSync(path.join(run,name),JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});save('enroll.json',spec);
const result=spawnSync(python,['-I','-S','-B',path.join(workspace,'rebuild/agent-bridge/hermes/enroll_home.py'),'--config',path.join(run,'enroll.json')],{encoding:'utf8',timeout:45000,windowsHide:true,maxBuffer:1024**2});fs.writeFileSync(path.join(run,'enrollment-output.log'),result.stdout+result.stderr,{mode:0o600});if(result.status!==0)throw Error('ENROLLMENT_FAILED');
const enrolled=JSON.parse(result.stdout.trim());if(enrolled.status!=='enrolled')throw Error('ENROLLMENT_NOT_READY');
const bridge={...bundle.agent,state_file:path.join(run,'home/bridge-state.json'),poll_interval_ms:1000,adapter_timeout_ms:30000,adapter_command:[python,'-I','-S','-B',path.join(workspace,'rebuild/agent-bridge/hermes/adapter_main.py'),'--config',path.join(run,'home/runtime.json')]};save('bridge-config.json',bridge);
const credential=readPrivateJson(bundle.phone.credential_file);
save('task-connection.json',{format:'turboio-task-connection/1',base_url:bundle.phone.base_url,owner_id:bundle.phone.owner_id,producer_id:bundle.phone.producer_id,server_id:bundle.phone.server_id,...credential,computer_id:binding.computer_id,agent_id:binding.agent_id,project_id:spec.project_id,session_id:enrolled.session_id});
console.log(JSON.stringify({prepared:true,run_id:runId,profile:enrolled.profile,isolated_real_provider:true,task_submitted:false,phone_answer_submitted:false}));
