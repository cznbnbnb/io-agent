import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import crypto from 'node:crypto';import {fileURLToPath} from 'node:url';import {spawnSync} from 'node:child_process';
import {BridgeClient} from './rebuild/agent-bridge/client.mjs';
export const root=path.dirname(fileURLToPath(import.meta.url));
export const device=path.join(root,'.io-agent','device.json');
export function python(){
 for(const [command,...args] of [...(process.env.IO_AGENT_PYTHON?[[process.env.IO_AGENT_PYTHON]]:[]),['python3'],['python'],['py','-3']]){
  const r=spawnSync(command,[...args,'-I','-S','-B','-c','import sys,sqlite3,json;print(json.dumps({"path":sys.executable,"ok":sys.version_info>=(3,10)}))'],{encoding:'utf8',timeout:5000});
  try{const d=JSON.parse(r.stdout);if(r.status===0&&d.ok&&path.isAbsolute(d.path))return d.path;}catch{}
 }throw Error('PYTHON_3_10_REQUIRED');
}
function protect(dir,py){
 fs.mkdirSync(dir,{recursive:true,mode:0o700});
 const r=spawnSync(py,['-I','-S','-B','-c','import sys;sys.path.insert(0,sys.argv[1]);from pathlib import Path;from enroll_home import protect_directory;protect_directory(Path(sys.argv[2]))',path.join(root,'rebuild/agent-bridge/hermes'),dir],{encoding:'utf8',timeout:15000});
 if(r.status!==0)throw Error('PRIVATE_DIRECTORY_PROTECTION_FAILED');
}
export function prepare(){const py=python();protect(path.dirname(device),py);protect(path.join(root,'rebuild/agent-bridge/private'),py);return py;}
async function main(){
 const [action,...args]=process.argv.slice(2);
 if(action==='doctor'&&!args.length){const py=python();console.log(JSON.stringify({node:process.version,recommended_node:'22.18+ (22.x)',python:py,device_imported:fs.existsSync(device),next:fs.existsSync(device)?'node io-agent.mjs device-status':'node setup.mjs request'},null,2));return;}
 if(action==='request'&&!args.length){prepare();const file=path.join(root,'enrollment-request.json');if(!fs.existsSync(file))fs.writeFileSync(file,JSON.stringify({format:'io-agent-computer-enrollment-request/1',computer_id:'workbuddy-'+crypto.randomUUID(),label:'WorkBuddy',runtime:'workbuddy',base_url:'https://cznbnb.cn/io-api/v1/',created_at:new Date().toISOString()},null,2)+'\n',{flag:'wx',mode:0o600});console.log(JSON.stringify({request_file:file,contains_credentials:false,next:'把 enrollment-request.json 发回原来的 Codex 对话，为此电脑单独签发连接。'}));return;}
 if(action==='import-device'&&args.length===1){
  prepare();if(fs.existsSync(device))throw Error('DEVICE_ALREADY_IMPORTED');
  const file=path.resolve(args[0]);if(fs.statSync(file).size>4096)throw Error('INVALID_DEVICE_FILE');const d=JSON.parse(fs.readFileSync(file,'utf8'));const request=JSON.parse(fs.readFileSync(path.join(root,'enrollment-request.json'),'utf8'));
  if(d.role!=='agent'||d.computer_id!==request.computer_id||d.base_url!=='https://cznbnb.cn/io-api/v1/'||d.allow_loopback_http)throw Error('DEVICE_BINDING_MISMATCH');
  // Verify identity using the received file before copying it; no secret appears on stdout.
  const client=new BridgeClient({schema_version:'1.0',...d,credential_file:file});const identity=await client.identity();
  if(['owner_id','producer_id','server_id'].some(k=>identity[k]!==d[k]))throw Error('DEVICE_IDENTITY_MISMATCH');
  const current=JSON.parse(fs.readFileSync(file,'utf8'));fs.writeFileSync(device,JSON.stringify(current)+'\n',{flag:'wx',mode:0o600});console.log(JSON.stringify({imported:true,computer_id:d.computer_id,next:'按 AGENTS.md 为当前真实会话设置身份，再 join。'}));return;
 }
 throw Error('USAGE: node setup.mjs doctor | request | import-device <file>');
}
if(process.argv[1]&&fs.realpathSync(process.argv[1])===fileURLToPath(import.meta.url))main().catch(e=>{console.error(JSON.stringify({error:/^[A-Z0-9_ :<>|.a-z-]+$/.test(e.message??'')?e.message:'SETUP_FAILED'}));process.exitCode=1;});
