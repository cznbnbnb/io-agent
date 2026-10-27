import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {CodexAppServerChannel} from './codex-app-server.mjs';

// Keep the native app-server and every startup override. Only its transport
// changes: Desktop keeps its stdio connection; followers use the same Unix
// server. This never opens a TCP port or starts/resumes a conversation.
export async function runDesktopLauncher(config,args,{input=process.stdin,output=process.stdout,error=process.stderr}={}){
  if(config?.schema_version!==1||!path.isAbsolute(config.binary??'')||!path.isAbsolute(config.root??''))throw Error('DESKTOP_LAUNCHER_CONFIG_INVALID');
  let commandAt=0;
  while(commandAt<args.length){
    if(['-c','--config','--enable','--disable'].includes(args[commandAt]))commandAt+=2;
    else if(/^--(?:config|enable|disable)=/.test(args[commandAt]))commandAt++;
    else break;
  }
  const passthrough=args[commandAt]!=='app-server'||args.slice(commandAt+1).some(a=>['proxy','daemon','generate-ts','generate-json-schema','help','--help','-h'].includes(a));
  if(passthrough){
    const child=spawn(config.binary,args,{stdio:['inherit','inherit','inherit']});
    return await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',(code,signal)=>resolve(code??(signal?1:0)));});
  }
  fs.mkdirSync(config.root,{recursive:true,mode:0o700});const stat=fs.lstatSync(config.root);
  if(!stat.isDirectory()||stat.isSymbolicLink()||stat.uid!==process.getuid()||(stat.mode&0o077))throw Error('DESKTOP_LAUNCHER_ROOT_UNTRUSTED');
  const directory=fs.mkdtempSync(path.join(config.root,'app-')),socket=path.join(directory,'rpc.sock'),endpoint='unix://'+socket;
  if(Buffer.byteLength(socket)>100)throw Error('DESKTOP_LAUNCHER_SOCKET_PATH_TOO_LONG');
  // Desktop currently supplies no listen option. Preserve an explicit request
  // rather than quietly overriding an unexpected future startup contract.
  if(args.some(a=>a==='--stdio'||a==='--listen'||a.startsWith('--listen=')))throw Error('DESKTOP_LAUNCHER_LISTEN_CONFLICT');
  const child=spawn(config.binary,[...args,'--listen',endpoint,
    '-c','shell_environment_policy.set.IO_AGENT_CODEX_ENDPOINT='+JSON.stringify(endpoint),
    '-c','shell_environment_policy.set.IO_AGENT_CODEX_RPC_PATH="/"'],
    {env:{...process.env,IO_AGENT_CODEX_ENDPOINT:endpoint,IO_AGENT_CODEX_RPC_PATH:'/'},stdio:['ignore','ignore','pipe']});
  child.stderr.pipe(error,{end:false});let channel,ended=false,spawnError;
  const done=new Promise(resolve=>{child.once('error',e=>{spawnError=e;ended=true;resolve(1);});child.once('exit',code=>{ended=true;resolve(code??1);});});
  const stop=()=>{channel?.close();if(!ended)child.kill('SIGTERM');};
  process.once('SIGTERM',stop);process.once('SIGINT',stop);
  try{
    for(let n=0;n<100&&!ended&&!fs.existsSync(socket);n++)await new Promise(r=>setTimeout(r,50));
    if(ended)throw spawnError??Error('DESKTOP_LAUNCHER_NATIVE_EXITED');
    if(!fs.existsSync(socket))throw Error('DESKTOP_LAUNCHER_NOT_READY');
    channel=await new CodexAppServerChannel('unix://'+fs.realpathSync(socket),{transparent:true,maxFrameBytes:256*1024*1024}).connect();
    channel.listen(message=>{if(message.method==='channel/closed'&&typeof message.params?.code==='string'&&Object.getOwnPropertySymbols(message).length){stop();return;}output.write(JSON.stringify(message)+'\n');});
    let buffered='';input.setEncoding('utf8');
    const receive=chunk=>{
      buffered+=chunk;
      if(Buffer.byteLength(buffered)>256*1024*1024){error.write('DESKTOP_LAUNCHER_FRAME_LIMIT\n');stop();return;}
      try{let at;while((at=buffered.indexOf('\n'))>=0){const line=buffered.slice(0,at);buffered=buffered.slice(at+1);if(line.trim())channel.sendWire(JSON.parse(line));}}
      catch{error.write('DESKTOP_LAUNCHER_PROTOCOL_FAILED\n');stop();}
    };
    input.on('data',receive);input.once('end',stop);input.resume();
    try{return await done;}finally{input.removeListener('data',receive);input.removeListener('end',stop);input.pause();}
  }finally{
    stop();await done;process.removeListener('SIGTERM',stop);process.removeListener('SIGINT',stop);fs.rmSync(directory,{recursive:true,force:true});
  }
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const file=new URL('./launcher.json',import.meta.url);
  try{process.exitCode=await runDesktopLauncher(JSON.parse(fs.readFileSync(file)),process.argv.slice(2));}
  catch{process.stderr.write('DESKTOP_LAUNCHER_FAILED: Desktop relay integration is disabled; remove its CODEX_CLI_PATH override and use the bundled native CLI.\n');process.exitCode=1;}
}
