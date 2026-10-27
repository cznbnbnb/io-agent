#!/usr/bin/env node
import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import {fileURLToPath} from 'node:url';import {spawnSync} from 'node:child_process';
import {readConnector,connectorConfig} from '../../rebuild/agent-bridge/connector.mjs';
import {privateRecord} from '../../rebuild/agent-bridge/hosts/resident-manager.mjs';
import {atomic} from '../../rebuild/agent-bridge/session-pairing.mjs';
const OWNER='io-agent-connector-service/1';
export const CLAUDE_ENV_KEYS=['ANTHROPIC_AUTH_TOKEN','ANTHROPIC_API_KEY','ANTHROPIC_BASE_URL','ANTHROPIC_MODEL','ANTHROPIC_DEFAULT_HAIKU_MODEL','ANTHROPIC_DEFAULT_OPUS_MODEL','ANTHROPIC_DEFAULT_SONNET_MODEL','CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS','CLAUDE_CODE_SUBAGENT_MODEL'];
const need=(v,code)=>{if(!v)throw Object.assign(new Error(code),{code});};
/** Explicitly manages only this profile's user launchd job. It never alters
 * Desktop launchers, global environment, model settings, or pairing credentials. */
export function connectorService(action,directory,{home=os.homedir(),platform=process.platform,node=process.execPath,uid=process.getuid?.(),run=spawnSync,environment=process.env}={}){
 need(platform==='darwin','CONNECTOR_SERVICE_PLATFORM_UNSUPPORTED');
 need(['start','stop','status'].includes(action)&&path.isAbsolute(directory??'')&&path.isAbsolute(home)&&path.isAbsolute(node)&&Number.isSafeInteger(uid),'CONNECTOR_SERVICE_ARGUMENT_INVALID');
 directory=fs.realpathSync(directory);const profile=readConnector(directory),label='cn.turboio.connector.'+profile.route_session_id,target='gui/'+uid+'/'+label,
  plist=path.join(home,'Library/LaunchAgents',label+'.plist'),marker=path.join(directory,'service.json'),source=fileURLToPath(new URL(profile.runtime==='claude-code'?'./connector-service-worker.mjs':'../../rebuild/agent-bridge/connector.mjs',import.meta.url));
 const invoke=(command,args,input)=>{const r=run(command,args,{encoding:'utf8',timeout:15000,maxBuffer:1024*1024,...(input===undefined?{}:{input})});if(r.error)throw r.error;return r;};
 const record=fs.existsSync(marker)?privateRecord(marker):null;
 if(record)need(record.owner===OWNER&&record.directory===directory&&record.label===label&&record.plist===plist,'CONNECTOR_SERVICE_OWNER_MISMATCH');
 need(!fs.existsSync(plist)||record,'CONNECTOR_SERVICE_OWNER_MISMATCH');
 let printed=invoke('/bin/launchctl',['print',target]);
 const loaded=printed.status===0;
 if(!loaded)need(/Could not find service/i.test(printed.stderr??''),'CONNECTOR_SERVICE_QUERY_FAILED');
 if(loaded)need(record,'CONNECTOR_SERVICE_OWNER_MISMATCH');
 if(action==='start'){
  const config=connectorConfig(directory),log=path.join(directory,'service.log'),definition={Label:label,ProgramArguments:[node,source,'run','--directory',directory,'--device',config.credential_file],WorkingDirectory:profile.workspace,
   RunAtLoad:true,KeepAlive:true,ThrottleInterval:30,ProcessType:'Background',StandardOutPath:log,StandardErrorPath:log,
   EnvironmentVariables:{HOME:home,PATH:[path.dirname(node),'/opt/homebrew/bin','/usr/local/bin','/usr/bin','/bin','/usr/sbin','/sbin'].join(':'),LANG:process.env.LANG||'en_US.UTF-8'}};
  const encoded=invoke('/usr/bin/plutil',['-convert','xml1','-o','-','--','-'],JSON.stringify(definition));need(encoded.status===0,'CONNECTOR_SERVICE_PLIST_FAILED');
  if(loaded){
   need(record.node===node&&record.source===source&&record.credential_file===config.credential_file,'CONNECTOR_SERVICE_CONFIG_CHANGED');
   if(!/\bstate = running\b/.test(printed.stdout??''))need(invoke('/bin/launchctl',['kickstart',target]).status===0,'CONNECTOR_SERVICE_START_FAILED');
  }else{
   if(profile.runtime==='claude-code'){const captured=Object.fromEntries(CLAUDE_ENV_KEYS.filter(k=>environment[k]!==undefined).map(k=>[k,environment[k]]));const file=path.join(directory,'service-env.json');if(Object.keys(captured).length||!fs.existsSync(file))atomic(file,captured);}
   fs.mkdirSync(path.dirname(plist),{recursive:true});fs.closeSync(fs.openSync(log,'a',0o600));
   atomic(marker,{owner:OWNER,label,directory,plist,node,source,credential_file:config.credential_file});
   fs.writeFileSync(plist,encoded.stdout,{mode:0o600});
   need(invoke('/bin/launchctl',['bootstrap','gui/'+uid,plist]).status===0,'CONNECTOR_SERVICE_START_FAILED');
  }
  printed=invoke('/bin/launchctl',['print',target]);need(printed.status===0,'CONNECTOR_SERVICE_QUERY_FAILED');
 }else if(action==='stop'){
  if(loaded){
   need(invoke('/bin/launchctl',['bootout',target]).status===0,'CONNECTOR_SERVICE_STOP_FAILED');
   for(let n=0;n<100;n++){printed=invoke('/bin/launchctl',['print',target]);if(printed.status!==0){need(/Could not find service/i.test(printed.stderr??''),'CONNECTOR_SERVICE_QUERY_FAILED');break;}Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,100);}
   need(printed.status!==0,'CONNECTOR_SERVICE_STOP_PENDING');
  }
  if(record){if(fs.existsSync(plist))fs.unlinkSync(plist);fs.unlinkSync(marker);}
  return{stopped:true,automatic_start:false,profile_preserved:true,session_id:profile.route_session_id};
 }
 const output=printed.stdout??'',pid=/\bpid = (\d+)/.exec(output);
 return{installed:fs.existsSync(plist),loaded:printed.status===0,running:printed.status===0&&/\bstate = running\b/.test(output),pid:pid?Number(pid[1]):null,
  session_id:profile.route_session_id,label:profile.label,automatic_start:fs.existsSync(plist),note:'Service process state only; phone execution readiness comes from the server session directory.'};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const [action,flag,directory,...extra]=process.argv.slice(2);
 try{need(flag==='--directory'&&!extra.length,'CONNECTOR_SERVICE_ARGUMENT_INVALID');console.log(JSON.stringify(connectorService(action,directory)));}
 catch(e){console.error(JSON.stringify({ok:false,error:/^[A-Z][A-Z0-9_]{0,100}$/.test(e.code??'')?e.code:'CONNECTOR_SERVICE_FAILED'}));process.exitCode=1;}
}
