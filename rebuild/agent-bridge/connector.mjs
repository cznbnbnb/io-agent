import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {randomUUID,createHash} from 'node:crypto';
import {createNativeBridgeAdapter} from './hosts/native-config.mjs';
import {AgentBridge} from './bridge.mjs';
import {runtimeDigest} from './runtime-events.mjs';
import {atomic} from './session-pairing.mjs';
import {sessionPair,sessionFile,computerDeviceFile} from './questions/session-pair-cli.mjs';
import {privateDirectory,privateRecord} from './hosts/resident-manager.mjs';
import {BridgeError,readPrivateJson} from './client.mjs';

const need=(v,code)=>{if(!v)throw Object.assign(new Error(code),{code});};
const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(v);
const hash=v=>createHash('sha256').update(v).digest('hex');
const safeCode=e=>/^[A-Z][A-Z0-9_]{0,100}$/.test(e?.code??'')?e.code:'CONNECTOR_FAILED';
export function readConnector(directory){
  const profile=privateRecord(path.join(directory,'connector.json'));
  need(profile.schema_version===1&&profile.managed===true&&uuid(profile.route_session_id)&&/^[a-z][a-z0-9-]{1,31}$/.test(profile.runtime??'')&&typeof profile.label==='string'&&profile.label.trim()===profile.label&&profile.label.length>0&&profile.label.length<=40&&
    path.isAbsolute(profile.workspace??'')&&Array.isArray(profile.command)&&profile.command.length>0&&profile.command.every(v=>typeof v==='string'&&!/[\0\r\n]/.test(v))&&path.isAbsolute(profile.command[0]),'CONNECTOR_PROFILE_INVALID');
  need(profile.control_mode===undefined||profile.control_mode==='desktop'&&profile.runtime==='codex','CONNECTOR_CONTROL_MODE_INVALID');
  return profile;
}
/** Creates a NEW managed session only. It cannot import a Desktop session ID.
 * No prompt, model turn, global launcher or system startup setting is changed. */
export async function initializeConnector(directory,input){
  need(input&&Object.keys(input).sort().join()==='command,label,runtime,workspace'&&
    /^[a-z][a-z0-9-]{1,31}$/.test(input.runtime??'')&&typeof input.label==='string'&&input.label.trim()===input.label&&input.label.length>0&&input.label.length<=40&&!/[\x00-\x1f\x7f-\x9f]/.test(input.label)&&
    path.isAbsolute(input.workspace??'')&&Array.isArray(input.command)&&input.command.length>0&&input.command.every(v=>typeof v==='string'&&!/[\0\r\n]/.test(v))&&path.isAbsolute(input.command[0]),'CONNECTOR_INPUT_INVALID');
  privateDirectory(directory);need(!fs.existsSync(path.join(directory,'connector.json')),'CONNECTOR_ALREADY_INITIALIZED');
  const workspace=fs.realpathSync(input.workspace),profile={schema_version:1,managed:true,runtime:input.runtime,label:input.label,workspace,command:input.command,route_session_id:randomUUID()};
  atomic(path.join(directory,'connector.json'),profile);
  return{initialized:true,managed:true,session_id:profile.route_session_id,workspace,next:fs.existsSync(computerDeviceFile())?'run':'pair',native_process_started:false};
}
export function connectorConfig(directory,{deviceFile}={}){
  const p=readConnector(directory),caller={runtime:p.runtime,session:p.route_session_id},paired=sessionFile(caller,p.workspace);
  const file=deviceFile??(fs.existsSync(paired)?paired:computerDeviceFile());
  need(fs.existsSync(file),'CONNECTOR_PAIRING_REQUIRED');const device=readPrivateJson(file,8192);
  need(device.role==='agent'&&typeof device.computer_id==='string','CONNECTOR_PAIRING_REQUIRED');
  const route={computer_id:device.computer_id,agent_id:p.runtime==='codex'?'io-current-codex':'io-'+p.runtime,
    project_id:'workspace-'+hash(p.workspace).slice(0,24),session_id:p.route_session_id};
  if(device.session_pairing&&device.session_pairing.metadata.mode!=='computer')need(runtimeDigest(device.session_pairing.metadata.route)===runtimeDigest(route)&&device.session_pairing.metadata.runtime===p.runtime,'CONNECTOR_PAIRING_MISMATCH');
  return{schema_version:'1.0',base_url:device.base_url,owner_id:device.owner_id,producer_id:device.producer_id,server_id:device.server_id,credential_file:file,
    computer_id:route.computer_id,agent_id:route.agent_id,timeout_ms:10000,...(device.allow_loopback_http===true?{allow_loopback_http:true}:{}),
    native_runtime:{state_file:'runtime.json',sessions:[{host_kind:p.runtime==='codex'?'codex':p.runtime==='claude-code'?'claude':'acp',workspace:p.workspace,route,label:p.label,
      ...(p.control_mode==='desktop'?{desktop:{session_id:privateRecord(path.join(directory,'acp.json'),64*1024*1024).session_id,state_file:'desktop.json'}}:
        {acp:{command:p.command,session_id:fs.existsSync(path.join(directory,'acp.json'))?privateRecord(path.join(directory,'acp.json'),64*1024*1024).session_id:null,state_file:'acp.json'}})}]}};
}
export async function runConnector(directory,{deviceFile,signal,maximumMs=0,onReady=()=>{},onStatus=()=>{}}={}){
  const config=connectorConfig(directory,{deviceFile}),adapter=createNativeBridgeAdapter(config,{configDirectory:directory});
  const runtime=config.agent_id==='io-current-codex'?'codex':config.agent_id.slice(3),legacy=id=>typeof id==='string'&&id.startsWith(runtime+'-task-');
  const onItem=adapter.onItem.bind(adapter),onAnswer=adapter.onAnswer.bind(adapter);
  adapter.onItem=(item,context)=>legacy(item.body?.task_id)?[]:onItem(item,context);
  adapter.onAnswer=(input,context)=>legacy(input.request?.body?.task_id)?[]:onAnswer(input,context);
  const bridge=new AgentBridge({config,adapter,stateFile:path.join(directory,'bridge.json')});let stopped=false;
  const halt=()=>{stopped=true;};process.once('SIGTERM',halt);process.once('SIGINT',halt);signal?.addEventListener('abort',halt,{once:true});
  const start=Date.now();let failures=0;
  try{
    await bridge.start();onReady({running:true,managed:true,at:new Date().toISOString(),session_id:config.native_runtime.sessions[0].route.session_id});
    while(!stopped&&!signal?.aborted&&(!maximumMs||Date.now()-start<maximumMs)){
      if(adapter.lifecycle().closed)break;
      let delay=250;
      try{
        await bridge.pollOnce();
        if(failures)onStatus({event:'connection_recovered',at:new Date().toISOString(),session_id:config.native_runtime.sessions[0].route.session_id});
        failures=0;
      }catch(error){
        // Keep the native process, queued inputs and durable outbox through a
        // transport outage. Identity/auth/journal/protocol failures still stop.
        if(!(error instanceof BridgeError)||!error.retryable||bridge.blocked)throw error;
        delay=Math.max(Math.min(15000,1000*2**Math.min(failures++,4)),Math.min(30000,error.detail??0));
        onStatus({event:'connection_retry',at:new Date().toISOString(),session_id:config.native_runtime.sessions[0].route.session_id,error:safeCode(error),retry_ms:delay});
      }
      // SIGTERM and the bounded test deadline must not wait for a retry timer.
      const until=Date.now()+delay;
      while(!stopped&&!signal?.aborted&&Date.now()<until&&(!maximumMs||Date.now()-start<maximumMs))await new Promise(resolve=>setTimeout(resolve,Math.min(250,until-Date.now())));
    }
  }finally{
    try{await bridge.stop();}finally{process.removeListener('SIGTERM',halt);process.removeListener('SIGINT',halt);signal?.removeEventListener('abort',halt);}
  }
  return{stopped:true,status:bridge.status()};
}
export async function connectorMain(args){
  const [action,...rest]=args,options={};
  if(action==='help')return{commands:['init --directory /private/profile (JSON stdin: runtime,label,workspace,command[])','pair --directory /private/profile','pair-status --directory /private/profile',
    'run --directory /private/profile [--device /private/paired-computer.json]','status --directory /private/profile'],
    note:'ACP manages its own sessions. It does not take over an existing Desktop chat. Pairing and questions reuse the existing iO server.'};
  need(['init','pair','pair-status','run','status'].includes(action)&&rest.length%2===0,'CONNECTOR_ARGUMENT_INVALID');
  for(let i=0;i<rest.length;i+=2){need(['--directory',...(action==='run'||action==='status'?['--device']:[])].includes(rest[i])&&!Object.hasOwn(options,rest[i].slice(2))&&path.isAbsolute(rest[i+1]??''),'CONNECTOR_ARGUMENT_INVALID');options[rest[i].slice(2)]=rest[i+1];}
  need(options.directory,'CONNECTOR_DIRECTORY_REQUIRED');const directory=options.directory;
  if(action==='init'){
    let bytes='';for await(const chunk of process.stdin){bytes+=chunk;need(Buffer.byteLength(bytes)<=65536,'CONNECTOR_INPUT_LIMIT');}
    return initializeConnector(directory,JSON.parse(bytes));
  }
  const p=readConnector(directory);
  if(action==='pair'||action==='pair-status')return sessionPair(action,action==='pair'?{topic:p.label,workspace:p.workspace}:{},{runtime:p.runtime,session:p.route_session_id},p.workspace);
  if(action==='status')return{managed:true,session_id:p.route_session_id,workspace:p.workspace,
    ...new AgentBridge({config:connectorConfig(directory,{deviceFile:options.device}),stateFile:path.join(directory,'bridge.json')}).inspectLocalStatus()};
  return runConnector(directory,{deviceFile:options.device,onReady:out=>process.stdout.write(JSON.stringify(out)+'\n'),onStatus:out=>process.stdout.write(JSON.stringify(out)+'\n')});
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  connectorMain(process.argv.slice(2)).then(result=>process.stdout.write(JSON.stringify(result)+'\n'),error=>{process.stderr.write(JSON.stringify({ok:false,error:safeCode(error)})+'\n');process.exitCode=1;});
}
