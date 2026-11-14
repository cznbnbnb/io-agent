import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import crypto from 'node:crypto';import {isDeepStrictEqual} from 'node:util';
import {BASE,exchange,atomic,validateClaim,pairingHtml} from '../session-pairing.mjs';
import {BridgeClient,readPrivateJson} from '../client.mjs';
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
const fail=code=>{throw Object.assign(new Error(code),{code});};
export function sessionHome(caller,workspace,env=process.env){return path.join(env.IO_AGENT_PAIRING_HOME||path.join(os.homedir(),'.turboio','session-pairings'),hash(JSON.stringify([caller.runtime,caller.session,workspace])).slice(0,32));}
export function sessionFile(caller,workspace,env=process.env){return path.join(sessionHome(caller,workspace,env),'device.json');}
export const computerDeviceFile=(env=process.env)=>env.IO_AGENT_DEVICE_FILE||path.join(env.IO_AGENT_PAIRING_HOME||path.join(os.homedir(),'.turboio'),'agent-device.json');
export async function computerPairingStatus(env=process.env){
 const file=computerDeviceFile(env);if(!fs.existsSync(file))return{paired:false,state:'not_paired',scope:'computer'};
 const device=readPrivateJson(file,8192);
 if(device.role!=='agent'||!device.device_id||!device.computer_id||device.session_pairing&&device.session_pairing.metadata.mode!=='computer')fail('COMPUTER_PAIRING_FILE_SCOPED');
 const client=new BridgeClient({schema_version:'1.0',base_url:device.base_url,owner_id:device.owner_id,producer_id:device.producer_id,server_id:device.server_id,credential_file:file,timeout_ms:10000,...(device.allow_loopback_http?{allow_loopback_http:true}:{})});
 const identity=await client.identity();
 if(identity.schema_version!=='1.0'||['owner_id','producer_id','server_id'].some(key=>identity[key]!==device[key]))fail('PAIRING_BINDING_MISMATCH');
 const current=readPrivateJson(file,8192);
 return{paired:true,state:'paired',scope:'computer',computer_id:device.computer_id,owner_id:device.owner_id,server_id:device.server_id,expires_at:current.expires_at,automatic_renewal:!!current.session_pairing,next:'join'};
}
export async function sessionPair(action,value,caller,workspace,env=process.env){
 if(caller.error)fail(caller.error);
 const device=computerDeviceFile(env),home=path.join(env.IO_AGENT_PAIRING_HOME||path.dirname(device),'computer-pairing'),pending=path.join(home,'pending.json');
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!['topic','workspace'].includes(k)))fail('PAIRING_INPUT_INVALID');
 if(fs.existsSync(device)){
  return{...await computerPairingStatus(env),runtime:caller.runtime,session_id:caller.session};
 }
 if(action==='pair-status'){
  if(Object.keys(value).length)fail('PAIRING_INPUT_INVALID');if(!fs.existsSync(pending))fail('PAIRING_NOT_STARTED');
  const state=JSON.parse(fs.readFileSync(pending));const result=await exchange(state.base_url,'claim',{id:state.id,claim_secret:state.claim_secret},{allowLoopback:state.allow_loopback_http===true});
  if(result.pending)return{paired:false,waiting_for_phone:true,expires_at:result.expires_at};validateClaim(result,state.metadata);if(result.id!==state.id)fail('PAIRING_BINDING_MISMATCH');
  atomic(device,{...result,base_url:state.base_url,computer_id:state.metadata.route.computer_id,...(state.allow_loopback_http?{allow_loopback_http:true}:{}),session_pairing:{id:state.id,claim_secret:state.claim_secret,metadata:state.metadata}});
  return{paired:true,scope:'computer',computer_id:state.metadata.route.computer_id,runtime:caller.runtime,session_id:caller.session,topic:state.metadata.topic,next:'join'};
 }
 if(typeof value.topic!=='string'||!value.topic.trim()||value.topic.length>40||/[\x00-\x1f\x7f-\x9f\u2028\u2029]/.test(value.topic))fail('PAIRING_TOPIC_REQUIRED');
 const folder=value.workspace??workspace;if(typeof folder!=='string'||!folder.trim()||folder.length>512||/[\x00-\x1f\x7f-\x9f]/.test(folder))fail('PAIRING_WORKSPACE_INVALID');
 const parent=path.dirname(home),computer=path.join(parent,'computer.json');fs.mkdirSync(parent,{recursive:true,mode:0o700});
 if(!fs.existsSync(computer))try{fs.writeFileSync(computer,JSON.stringify({id:'computer-'+crypto.randomUUID()}),{flag:'wx',mode:0o600});}catch(e){if(e.code!=='EEXIST')throw e;}
 const metadata={mode:'computer',runtime:caller.runtime,route:{computer_id:JSON.parse(fs.readFileSync(computer)).id,agent_id:caller.runtime==='codex'?'io-current-codex':'io-'+caller.runtime,project_id:'workspace-'+hash(folder).slice(0,24),session_id:caller.session},topic:value.topic.trim(),workspace:folder.trim()};
 let state=fs.existsSync(pending)?JSON.parse(fs.readFileSync(pending)):null;
 if(state&&Date.parse(state.expires_at)>Date.now()&&state.metadata.mode!=='computer'&&!isDeepStrictEqual(state.metadata,metadata))fail('PAIRING_PENDING_DIFFERENT_TOPIC');
 if(!state||Date.parse(state.expires_at)<=Date.now()){
  state={id:crypto.randomUUID(),claim_secret:crypto.randomBytes(32).toString('base64url'),metadata,base_url:BASE,expires_at:new Date(Date.now()+600000).toISOString()};atomic(pending,state);
 }
 const start=await exchange(state.base_url,'start',{id:state.id,claim_secret:state.claim_secret,metadata:state.metadata},{allowLoopback:state.allow_loopback_http===true});
 // Do not trust the response to substitute a foreign QR destination or pairing code.
 const code=hash('session-approval/1:'+state.claim_secret);
 if(start.id!==state.id||start.pairing_string!=='io-agent-pair/1:'+state.id+':'+code||start.qr_url!==BASE+'connect#id='+state.id+'&code='+code)fail('PAIRING_RESPONSE_INVALID');
 atomic(pending,{...state,expires_at:start.expires_at});const html=path.join(home,'pair.html');fs.writeFileSync(html,pairingHtml(start,state.metadata),{mode:0o600});
 return{paired:false,qr_html:html,pairing_string:start.pairing_string,expires_at:start.expires_at,scope:'computer',session_id:caller.session,pairing_session_id:state.metadata.route.session_id,next:'手机扫码或粘贴，确认授权这台电脑的新会话自动接入；保存后运行 pair-status，再 join。'};
}
