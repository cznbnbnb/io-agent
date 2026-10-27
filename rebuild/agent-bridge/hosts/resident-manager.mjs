import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync,spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {runtimeDigest} from '../runtime-events.mjs';
import {directoryRoute} from '../session-directory.mjs';
import {atomic} from '../session-pairing.mjs';

const fail=code=>{throw Object.assign(new Error(code),{code});};
const need=(v,c)=>{if(!v)fail(c);};
export const residentHome=(env=process.env)=>path.resolve(env.IO_AGENT_RESIDENT_HOME||path.join(os.homedir(),'.turboio','session-control'));
export const residentKey=binding=>runtimeDigest({host_kind:binding.host_kind,workspace:binding.workspace,route:binding.route});
export function privateDirectory(directory){
  fs.mkdirSync(directory,{recursive:true,mode:0o700});const s=fs.lstatSync(directory);
  need(s.isDirectory()&&!s.isSymbolicLink()&&s.uid===process.getuid?.()&&!(s.mode&0o077),'RESIDENT_DIRECTORY_UNTRUSTED');return directory;
}
export function privateRecord(file,maxBytes=65536){
  const s=fs.lstatSync(file);need(s.isFile()&&!s.isSymbolicLink()&&s.uid===process.getuid?.()&&!(s.mode&0o077)&&s.size<=maxBytes,'RESIDENT_RECORD_UNTRUSTED');
  return JSON.parse(fs.readFileSync(file,'utf8'));
}
// Birth identity fences PID reuse. No command arguments, tokens or user prompt
// are captured. The owner is found from the real CLI tool process ancestry.
export function processIdentity(pid){
  need(Number.isSafeInteger(pid)&&pid>1,'RESIDENT_PROCESS_INVALID');
  try{
    const value=execFileSync('/bin/ps',['-p',String(pid),'-o','pid=,ppid=,uid=,lstart=,comm='],{encoding:'utf8',timeout:2000,stdio:['ignore','pipe','pipe']}).trim();
    const m=/^(\d+)\s+(\d+)\s+(\d+)\s+(.{24})\s+(.+)$/.exec(value);
    need(m&&Number(m[3])===process.getuid?.(),'RESIDENT_PROCESS_UNTRUSTED');
    return{pid:Number(m[1]),ppid:Number(m[2]),uid:Number(m[3]),started:m[4],executable:path.basename(m[5])};
  }catch(e){if(e.status===1)return null;throw e;}
}
export function sameProcess(expected,read=processIdentity){
  if(!expected)return false;const actual=read(expected.pid);
  return actual!==null&&['pid','uid','started','executable'].every(k=>actual[k]===expected[k]);
}
export function nativeOwner(runtime,{pid=process.ppid,read=processIdentity}={}){
  const executable=runtime==='claude-code'?'claude':runtime==='codex'?'codex':null;
  if(!executable)return null;
  const seen=new Set();
  for(let n=0;n<24&&pid>1&&!seen.has(pid);n++){
    seen.add(pid);const row=read(pid);if(!row)return null;
    if(row.executable===executable||runtime==='claude-code'&&row.executable==='claude.exe')return row;pid=row.ppid;
  }
  return null;
}
export function validateResidentConfig(c){
  need(c?.schema_version===1&&['codex','claude-code'].includes(c.runtime)&&directoryRoute(c.binding?.route)&&
    c.binding.host_kind===(c.runtime==='codex'?'codex':'claude')&&typeof c.binding.owner_id==='string'&&c.binding.owner_id&&
    typeof c.binding.server_id==='string'&&c.binding.server_id&&path.isAbsolute(c.binding.workspace)&&
    c.agent?.owner_id===c.binding.owner_id&&c.agent?.server_id===c.binding.server_id&&
    c.agent.computer_id===c.binding.route.computer_id&&c.agent.agent_id===c.binding.route.agent_id&&
    path.isAbsolute(c.agent.credential_file??'')&&c.owner&&Number.isSafeInteger(c.owner.pid)&&
    (c.runtime==='codex'?c.owner.executable==='codex':['claude','claude.exe'].includes(c.owner.executable))&&typeof c.owner.started==='string'&&
    typeof c.label==='string'&&c.label.length>0&&c.label.length<=64&&Array.isArray(c.legacyTaskIds)&&c.legacyTaskIds.length<=1000&&
    c.legacyTaskIds.every(id=>typeof id==='string'&&id.length<=128),'RESIDENT_CONFIG_INVALID');return c;
}
export function residentStatus(binding,{home=residentHome(),read=processIdentity}={}){
  const directory=path.join(home,'sessions',residentKey(binding));
  try{
    const h=privateRecord(path.join(directory,'health.json'));
    if(h.binding_key!==residentKey(binding)||Date.now()-Date.parse(h.at)>15000||!sameProcess(h.worker,read))return{resident_live:false,reason:'RESIDENT_NOT_RUNNING'};
    return{resident_live:true,cloud_online:h.cloud_online===true,can_execute:h.can_execute===true,reason:h.reason??null,pid:h.worker.pid,session_id:binding.route.session_id};
  }catch{return{resident_live:false,reason:'RESIDENT_NOT_RUNNING'};}
}
export async function ensureResident({agent,binding,runtime,label,legacyTaskId,endpoint,rpcPath},{home=residentHome(),read=processIdentity,
  launch=spawn,waitMs=8000,owner=nativeOwner(runtime,{read})}={}){
  if(!['codex','claude-code'].includes(runtime))return{resident_live:false,can_execute:false,reason:'NATIVE_HOST_UNSUPPORTED'};
  if(process.platform==='win32')return{resident_live:false,can_execute:false,reason:'RESIDENT_PLATFORM_UNSUPPORTED'};
  if(!owner)return{resident_live:false,can_execute:false,reason:'NATIVE_OWNER_NOT_FOUND'};
  const workerFile=fileURLToPath(new URL('./session-resident.mjs',import.meta.url));
  if(!fs.existsSync(workerFile))return{resident_live:false,can_execute:false,reason:'RESIDENT_COMPONENT_NOT_INSTALLED'};
  const c=validateResidentConfig({schema_version:1,agent,binding,runtime,label:label||'当前会话',owner,legacyTaskIds:[legacyTaskId],...(endpoint?{endpoint,rpcPath}:{})});
  privateDirectory(home);const root=privateDirectory(path.join(home,'sessions')),directory=privateDirectory(path.join(root,residentKey(binding)));
  let previous;try{previous=privateRecord(path.join(directory,'resident.json'));}catch{}
  const prior=residentStatus(binding,{home,read});
  if(previous){
    need(runtimeDigest(previous.binding)===runtimeDigest(binding),'RESIDENT_OWNER_CHANGED');
    if(previous.owner.pid!==owner.pid||previous.owner.started!==owner.started)
      need(!prior.resident_live&&!sameProcess(previous.owner,read),'RESIDENT_OWNER_CHANGED');
  }
  if(prior.resident_live)return prior;
  atomic(path.join(directory,'resident.json'),c);
  const log=fs.openSync(path.join(directory,'worker.log'),'w',0o600);
  try{
    // No model credentials or arbitrary NODE_OPTIONS are copied into a helper
    // which only talks to the existing native owner and paired server.
    const env=Object.fromEntries(['PATH','HOME','USER','LOGNAME','SHELL','TMPDIR','LANG','LC_ALL'].filter(k=>process.env[k]!==undefined).map(k=>[k,process.env[k]]));
    const child=launch(process.execPath,[workerFile,'--config',path.join(directory,'resident.json')],
      {cwd:binding.workspace,env,detached:true,stdio:['ignore',log,log]});child.unref();
  }finally{fs.closeSync(log);}
  const deadline=Date.now()+waitMs;let last;
  do{
    const s=residentStatus(binding,{home,read});if(s.resident_live)last=s;
    if(s.resident_live&&s.cloud_online&&(s.can_execute||runtime==='codex'&&s.reason!=='RESIDENT_START_PENDING'))return s;
    await new Promise(r=>setTimeout(r,150));
  }while(Date.now()<deadline);
  return last??{resident_live:false,can_execute:false,reason:'RESIDENT_START_PENDING'};
}
export function leaveResident(binding,{home=residentHome()}={}){
  const status=residentStatus(binding,{home});if(!status.resident_live)return status;
  const directory=path.join(home,'sessions',residentKey(binding)),health=privateRecord(path.join(directory,'health.json'));
  need(health.binding_key===residentKey(binding)&&sameProcess(health.worker),'RESIDENT_OWNER_CHANGED');
  process.kill(health.worker.pid,'SIGTERM');return{leaving:true,session_id:binding.route.session_id};
}
