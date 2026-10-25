import path from 'node:path';
import {AgentBridge} from './bridge.mjs';
import {AdapterHost} from './adapter-host.mjs';
import {BridgeClient,BridgeError,readPrivateJson} from './client.mjs';
import {createNativeBridgeAdapter} from './hosts/native-config.mjs';
import {validateDirectory} from './session-directory.mjs';
import {setDirectoryDefault} from './directory-default.mjs';

// Local run entry. With no adapter_command the program only observes: it never
// claims a task it cannot execute. A runtime adapter (P42) is a separate process
// declared in the private config, so no command or bearer is passed on argv.
const silentAdapter={name:'observe-only',capabilities:{can_execute:false},onItem:()=>[],onAnswer:()=>[]};
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const fail=(code,detail=null)=>{throw new BridgeError(code,{permanent:true,detail});};

try{
  const [action,...args]=process.argv.slice(2),options={};
  if(!['once','run','status','sessions','set-default','clear-default'].includes(action)||args.length%2)fail('INVALID_ARGUMENTS');
  for(let index=0;index<args.length;index+=2){
    if(!['--config',...(action==='set-default'?['--session']:[])].includes(args[index])||Object.hasOwn(options,args[index].slice(2))||args[index+1]===undefined)fail('INVALID_ARGUMENTS');
    options[args[index].slice(2)]=args[index+1];
  }
  if(options.config===undefined)fail('EXPLICIT_CONFIG_REQUIRED');
  const filename=path.resolve(options.config),config=readPrivateJson(filename);
  if(typeof config?.credential_file==='string'&&!path.isAbsolute(config.credential_file))
    config.credential_file=path.resolve(path.dirname(filename),config.credential_file);
  const stateFile=path.resolve(path.dirname(filename),config.state_file??'./bridge-state.json');
  if(['sessions','set-default','clear-default'].includes(action)){
    const client=new BridgeClient(config),identity=await client.identity();
    if(['server_id','owner_id','producer_id'].some(k=>identity[k]!==config[k]))fail('IDENTITY_MISMATCH');
    if(!identity.capabilities?.includes('agent_session_directory_v1'))fail('SERVER_SESSION_DIRECTORY_UNSUPPORTED');
    if(action==='sessions')process.stdout.write(JSON.stringify({ok:true,...validateDirectory(await client.agentSessions(),config)})+'\n');
    else{
      let route=null;
      if(action==='set-default'){
        if(typeof options.session!=='string'||!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(options.session))fail('EXPLICIT_SESSION_REQUIRED');
        const directory=validateDirectory(await client.agentSessions(),config);
        const entries=directory.sessions.filter(s=>s.route.computer_id===config.computer_id&&s.route.agent_id===config.agent_id&&s.route.session_id===options.session);
        if(entries.length!==1)fail('DEFAULT_SESSION_NOT_UNIQUE');route=entries[0].route;
      }
      const result=await setDirectoryDefault({client,stateFile:stateFile+'.default-operation.json',route});
      process.stdout.write(JSON.stringify({ok:true,...result})+'\n');
    }
  }else if(action==='status'){
    // A status query never authenticates, starts an adapter or saves a ledger.
    const bridge=new AgentBridge({config,stateFile});
    process.stdout.write(JSON.stringify({ok:true,...bridge.inspectLocalStatus()})+'\n');
  }else{
    if(config.adapter_command!==undefined&&(!Array.isArray(config.adapter_command)||!config.adapter_command.length||
      config.adapter_command.some(value=>typeof value!=='string'||!value)))fail('INVALID_ADAPTER_COMMAND');
    const adapter=config.native_runtime!==undefined?createNativeBridgeAdapter(config,{configDirectory:path.dirname(filename)}):config.adapter_command?new AdapterHost({command:config.adapter_command[0],args:config.adapter_command.slice(1),
      timeoutMs:config.adapter_timeout_ms??15000}):silentAdapter;
    const bridge=new AgentBridge({config,adapter,stateFile});
    try{
      const started=await bridge.start();
      if(action==='once'){const result=await bridge.pollOnce();process.stdout.write(JSON.stringify({ok:true,result,status:bridge.status()})+'\n');}
      else{
        process.stdout.write(JSON.stringify({ok:true,started,state_file:stateFile,adapter:adapter.name})+'\n');
        const interval=Number.isSafeInteger(config.poll_interval_ms)?config.poll_interval_ms:5000;
        let stopping=false;
        process.on('SIGINT',()=>{stopping=true;});process.on('SIGTERM',()=>{stopping=true;});
        while(!stopping){
          try{await bridge.pollOnce();}catch(error){
            const code=error instanceof BridgeError?error.code:'BRIDGE_FAILED';
            process.stdout.write(JSON.stringify({ok:false,error:{code,blocked:bridge.blocked}})+'\n');
            if(error instanceof BridgeError&&error.permanent){process.exitCode=1;break;}
          }
          await sleep(interval);
        }
        process.stdout.write(JSON.stringify({ok:true,stopped:true,status:bridge.status()})+'\n');
      }
    }finally{await bridge.stop();}
  }
}catch(error){
  // Codes only: configuration paths, tokens and source text never enter errors.
  const safe=error instanceof BridgeError?error:new BridgeError('BRIDGE_FAILED',{permanent:true});
  process.stderr.write(JSON.stringify({ok:false,error:safe.toJSON()})+'\n');process.exitCode=1;
}
