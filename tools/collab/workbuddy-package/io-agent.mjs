import path from 'node:path';import {spawnSync} from 'node:child_process';
import {root,device,prepare} from './setup.mjs';
try{
 const [command,...args]=process.argv.slice(2);if(!['help','join','config','ask','wait','status','notify','checkpoint','device-status'].includes(command)||args.length)throw Error('COMMAND_INVALID');
 const py=command==='help'?null:prepare();
 // Preserve host-provided runtime/session. Never invent a conversation ID or strip conflicting IDs.
 const result=spawnSync(process.execPath,[path.join(root,command==='device-status'?'rebuild/agent-bridge/device.mjs':'rebuild/agent-bridge/questions/cli.mjs'),command==='device-status'?'status':command],{cwd:root,env:{...process.env,IO_AGENT_DEVICE_FILE:device,...(py?{IO_AGENT_PYTHON:py}:{})},stdio:'inherit'});
 if(result.error)throw Error('CLI_START_FAILED');process.exitCode=result.status??1;
}catch(e){console.error(JSON.stringify({error:/^[A-Z0-9_]+$/.test(e.message??'')?e.message:'CLI_SETUP_FAILED'}));process.exitCode=1;}
