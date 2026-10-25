import fs from 'node:fs';
import path from 'node:path';
import {BridgeError,readPrivateJson} from '../client.mjs';
import {runtimeDigest} from '../runtime-events.mjs';
import {directoryRoute,directoryLabel} from '../session-directory.mjs';
import {NativeRuntimeAdapter} from './native-runtime.mjs';
import {CodexAppServerSession} from './codex-app-server.mjs';
import {createClaudeModBroker} from './claude-mod/broker.mjs';

const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const need=(v,code='INVALID_NATIVE_CONFIG')=>{if(!v)throw new BridgeError(code,{permanent:true});};
const hostCapabilities=Object.freeze({atomic_idle_start:false,atomic_queue_append:true,exact_turn_interrupt:true,final_result_evidence:true,native_queue_expiry:false});

/** Explicit, local host binding. No session discovery, creation, resume, model
 * launch, or global plugin installation. A disconnected native endpoint is
 * not retried behind the user's back: restart the bridge to reconnect. */
export function createNativeBridgeAdapter(config,{configDirectory,clock=Date.now,
  connectCodex=(id,options)=>CodexAppServerSession.connect(id,options),
  createClaudeBroker=createClaudeModBroker}={}){
  const native=config.native_runtime;
  need(path.isAbsolute(configDirectory??'')&&object(native)&&config.adapter_command===undefined);
  need(Object.keys(native).every(k=>['state_file','sessions'].includes(k))&&typeof native.state_file==='string'&&native.state_file&&
    Array.isArray(native.sessions)&&native.sessions.length>0&&native.sessions.length<=32);
  const resolve=v=>path.resolve(configDirectory,v);
  const stateFile=resolve(native.state_file),keys=new Set(),directories=new Set();
  const entries=native.sessions.map(s=>{
    need(object(s)&&Object.keys(s).every(k=>['host_kind','workspace','route','label','endpoint','auth_file','broker_directory'].includes(k))&&
      ['codex','claude'].includes(s.host_kind)&&typeof s.workspace==='string'&&s.workspace&&directoryRoute(s.route)&&
      s.route.computer_id===config.computer_id&&s.route.agent_id===config.agent_id);
    const label=typeof s.label==='string'?s.label.trim():s.label;
    need(label===undefined||typeof s.label==='string'&&!/[\u0000-\u001f\u007f]/.test(s.label)&&directoryLabel(label));
    const key=runtimeDigest(s.route);need(!keys.has(key));keys.add(key);
    let workspace;try{workspace=fs.realpathSync(resolve(s.workspace));need(fs.statSync(workspace).isDirectory());}catch{need(false);}
    const binding={server_id:config.server_id,owner_id:config.owner_id,host_kind:s.host_kind,workspace,route:structuredClone(s.route)};
    if(s.host_kind==='codex'){
      need(typeof s.endpoint==='string'&&s.endpoint&&s.broker_directory===undefined&&
        (s.auth_file===undefined||typeof s.auth_file==='string'&&s.auth_file));
      // Check transport syntax without touching a socket or reading a secret.
      let url;try{url=new URL(s.endpoint);}catch{need(false);}
      need(!url.username&&!url.password&&!url.hash&&!url.search&&
        (url.protocol==='unix:'&&!url.hostname&&path.isAbsolute(url.pathname)&&url.pathname!=='/'&&s.auth_file===undefined||
         url.protocol==='ws:'&&['127.0.0.1','[::1]'].includes(url.hostname)&&url.port));
      return{binding,label,endpoint:s.endpoint,authFile:s.auth_file?resolve(s.auth_file):null};
    }
    need(typeof s.broker_directory==='string'&&s.broker_directory&&s.endpoint===undefined&&s.auth_file===undefined);
    const directory=resolve(s.broker_directory);need(!directories.has(directory));directories.add(directory);
    return{binding,label,directory};
  });
  let runtime=null,closers=[],bindings=[];
  const adapter={
    name:'native-session-runtime',
    routeBindingDigest:runtimeDigest(entries.map(e=>e.binding).sort((a,b)=>runtimeDigest(a.route).localeCompare(runtimeDigest(b.route)))),
    capabilities:{can_execute:true,async_events:true,admission_probe_v1:true,control_intake_probe_v1:true,task_session_control_v1:true},
    acceptsRoute:route=>entries.some(e=>runtimeDigest(e.binding.route)===runtimeDigest(route)),
    async start(){
      need(!runtime&&!closers.length,'NATIVE_CONFIG_ALREADY_STARTED');bindings=[];
      try{
        for(const e of entries){
          let host;
          if(e.binding.host_kind==='codex'){
            let attempt=null;
            const get=()=>attempt??=(async()=>{
              let bearerToken;
              if(e.authFile){const auth=readPrivateJson(e.authFile);need(object(auth)&&Object.keys(auth).length===1&&typeof auth.token==='string'&&auth.token,'INVALID_NATIVE_AUTH');bearerToken=auth.token;}
              return connectCodex(e.binding.route.session_id,{endpoint:e.endpoint,workspace:e.binding.workspace,metadataOnly:true,...(bearerToken?{bearerToken}:{})});
            })();
            host={conversationId:e.binding.route.session_id,capabilities:hostCapabilities};
            for(const method of ['status','start','inspectOperation','interrupt','inspectStop','readiness'])host[method]=async(...args)=>{
              const connected=await get();need(typeof connected[method]==='function','NATIVE_RUNTIME_READINESS_UNSUPPORTED');return connected[method](...args);
            };
            closers.push(async()=>{if(attempt)try{await (await attempt).close();}catch{}});
          }else{
            const broker=await createClaudeBroker({directory:e.directory,binding:e.binding,clock});
            host=broker.host;
            // The Mod broker's status reads only the exact bound plugin's
            // local heartbeat. On load its conservative busy=true has no
            // turn identity yet; do not present that as observed active work.
            host.readiness=async()=>{
              const status=await broker.host.status();
              return{conversationId:status.conversationId,workspace:status.workspace,
                busy:status.busy===true&&!status.activeTurnId?null:status.busy,
                canExecute:true,reason:status.busy===true&&!status.activeTurnId?'CLAUDE_MOD_BUSY_UNKNOWN':null};
            };
            closers.push(()=>broker.close());
          }
          // Display metadata is not part of the durable task/route identity.
          bindings.push({binding:e.binding,label:e.label,host});
        }
        runtime=new NativeRuntimeAdapter({stateFile,bindings,clock});await runtime.start();return adapter.capabilities;
      }catch(error){await adapter.stop();throw error;}
    },
    async stop(){
      let failure;try{await runtime?.stop();}catch(error){failure=error;}
      for(const close of closers.reverse())try{await close();}catch(error){failure??=error;}
      runtime=null;closers=[];bindings=[];if(failure)throw failure;
    }
  };
  for(const method of ['onItem','onAnswer','onRequestClosed','inspectAdmission','inspectControlIntake','pollEvents','acknowledgeEvents','readinessSnapshot'])
    adapter[method]=(...args)=>{need(runtime,'NATIVE_CONFIG_NOT_STARTED');return runtime[method](...args);};
  return adapter;
}
