import os from 'node:os';
import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';import {spawnSync} from 'node:child_process';
export const root=path.dirname(fileURLToPath(import.meta.url));
export const device=process.env.IO_AGENT_DEVICE_FILE||path.join(process.env.IO_AGENT_PAIRING_HOME||path.join(os.homedir(),'.turboio'),'agent-device.json');
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
export function prepare(){const py=python();protect(path.dirname(device),py);protect(path.join(root,'.io-agent','sessions'),py);protect(path.join(root,'rebuild/agent-bridge/private'),py);return py;}
async function main(){
 const [action,...args]=process.argv.slice(2);if(action!=='doctor'||args.length)throw Error('USAGE: node setup.mjs doctor');
 const py=prepare();console.log(JSON.stringify({node:process.version,recommended_node:'22.18+ (22.x)',python:py,next:'在真实 Agent 会话中执行 node io-agent.mjs pair，输入 topic 和 workspace。'},null,2));
}
if(process.argv[1]&&fs.realpathSync(process.argv[1])===fileURLToPath(import.meta.url))main().catch(e=>{console.error(JSON.stringify({error:/^[A-Z0-9_ :<>|.a-z-]+$/.test(e.message??'')?e.message:'SETUP_FAILED'}));process.exitCode=1;});
