#!/usr/bin/env node
import fs from 'node:fs';import path from 'node:path';import {spawnSync} from 'node:child_process';
import {root,device,prepare} from './setup.mjs';
try{
 const [command,...args]=process.argv.slice(2);
 if(command==='update'){const {update}=await import('./update.mjs');console.log(JSON.stringify(await update(args)));process.exit(0);}
 if(command==='connector'){
  const result=spawnSync(process.execPath,[path.join(root,'rebuild/agent-bridge/connector.mjs'),...args],{cwd:root,env:process.env,stdio:'inherit'});
  if(result.error)throw Error('CLI_START_FAILED');process.exit(result.status??1);
 }
 if(!['help','pair','pair-status','join','session-status','leave','config','ask','wait','status','notify','checkpoint','daily','daily-context','daily-correct','daily-note','daily-revert','daily-history','todo-add','todo-status','phone-recovery'].includes(command)||args.length)throw Error('COMMAND_INVALID');
 const py=['help','daily','daily-context','daily-correct','daily-note','daily-revert','daily-history','todo-add','todo-status','phone-recovery'].includes(command)?null:prepare();
 if(command==='help'){
  const result=spawnSync(process.execPath,[path.join(root,'rebuild/agent-bridge/questions/cli.mjs'),'help'],{cwd:root,env:process.env,encoding:'utf8'});if(result.error||result.status!==0)throw Error('CLI_START_FAILED');const help=JSON.parse(result.stdout);help.cli_version=JSON.parse(fs.readFileSync(path.join(root,'package.json'))).version;help.commands.update='cz-iot-cli update [--check] [--https]; fetch the checked package from the private GitHub channel; preserve pairing; restart existing connectors separately';console.log(JSON.stringify(help));process.exit(0);
 }
 // Preserve host-provided runtime/session. Never invent a conversation ID or strip conflicting IDs.
 const result=spawnSync(process.execPath,[path.join(root,'rebuild/agent-bridge/questions/cli.mjs'),command],{cwd:root,env:{...process.env,IO_AGENT_DEVICE_FILE:device,...(py?{IO_AGENT_PYTHON:py}:{})},stdio:'inherit'});
 if(result.error)throw Error('CLI_START_FAILED');process.exitCode=result.status??1;
}catch(e){console.error(JSON.stringify({error:/^[A-Z0-9_]+$/.test(e.message??'')?e.message:'CLI_SETUP_FAILED'}));process.exitCode=1;}
