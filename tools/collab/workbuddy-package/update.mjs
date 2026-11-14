import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {spawnSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
import {root,python} from './setup.mjs';

export async function update(args,{directory=root,repository,branch='codex/agent-workspace-ui'}={}){
 const need=(ok,code)=>{if(!ok)throw Error(code);};
 need(args.every(v=>['--check','--https'].includes(v))&&new Set(args).size===args.length,'UPDATE_ARGUMENT_INVALID');
 need(fs.existsSync(path.join(directory,'MANIFEST.json')),'UPDATE_PORTABLE_INSTALL_REQUIRED');
 const py=python(),git=spawnSync('git',['--version'],{encoding:'utf8',timeout:5000});need(!git.error&&git.status===0,'UPDATE_GIT_REQUIRED');
 const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'cz-iot-cli-update-')),checkout=path.join(temporary,'repository');
 try{
  const source=repository??(args.includes('--https')?'https://github.com/cznbnbnb/io-agent.git':'git@github.com:cznbnbnb/io-agent.git');
  const env={...process.env,GIT_TERMINAL_PROMPT:'0'};
  // Desktop shells can omit the user's existing macOS SSH agent socket.
  if(process.platform==='darwin'&&!env.SSH_AUTH_SOCK){const socket=spawnSync('/bin/launchctl',['getenv','SSH_AUTH_SOCK'],{encoding:'utf8',timeout:5000});if(socket.status===0&&socket.stdout.trim())env.SSH_AUTH_SOCK=socket.stdout.trim();}
  for(const command of [['clone','--quiet','--filter=blob:none','--sparse','--depth','1','--single-branch','--branch',branch,source,checkout],['-C',checkout,'sparse-checkout','set','docs/distribution']]){
   const result=spawnSync('git',command,{env,encoding:'utf8',timeout:60000,maxBuffer:1048576});need(!result.error&&result.status===0,'UPDATE_REPOSITORY_UNAVAILABLE');
  }
  const archive=path.join(checkout,'docs/distribution/cz-iot-cli.zip'),sums=path.join(checkout,'docs/distribution/SHA256SUMS');need(fs.existsSync(archive)&&fs.existsSync(sums),'UPDATE_PACKAGE_NOT_PUBLISHED');
  const helper=fileURLToPath(new URL('./update_package.py',import.meta.url));
  const result=spawnSync(py,['-I','-S','-B',helper,'--root',directory,'--archive',archive,'--checksums',sums,...(args.includes('--check')?['--check']:[])],{encoding:'utf8',timeout:30000,maxBuffer:1048576});
  need(!result.error,'UPDATE_APPLY_FAILED');let value;
  try{value=JSON.parse(result.stdout);}catch{throw Error('UPDATE_RESULT_INVALID');}
  const report={...value,channel:branch,repository:source};
  if(result.status!==0)throw Object.assign(Error(value.error??'UPDATE_APPLY_FAILED'),{report});
  return report;
 }finally{fs.rmSync(temporary,{recursive:true,force:true});}
}
