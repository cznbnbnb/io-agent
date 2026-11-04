import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {AgentBridge} from '../bridge.mjs';
import {BridgeRunLock} from '../run-lock.mjs';
import {atomic} from '../session-pairing.mjs';
import {createNativeBridgeAdapter} from './native-config.mjs';
import {createClaudeModBroker} from './claude-mod/broker.mjs';
import {discoverCodexEndpoint} from './codex-endpoint.mjs';
export {probeCodexOwner} from './codex-endpoint.mjs';
import {privateRecord,privateDirectory,validateResidentConfig,processIdentity,sameProcess,residentKey} from './resident-manager.mjs';

const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const code=e=>/^[A-Z][A-Z0-9_]{0,100}$/.test(e?.code??'')?e.code:'SESSION_RESIDENT_UNAVAILABLE';
// The UI can distinguish a live paired helper from a controllable host. A
// pending one-time plugin reload must never advertise executable capability.
function pendingSnapshot(c,reason){return{schema_version:1,observed_at:new Date().toISOString(),sessions:[{
  route:c.binding.route,host_kind:c.binding.host_kind,workspace:c.binding.workspace,label:c.label,
  availability:'online',busy:null,can_execute:false,exact_turn_interrupt:false,descendants_proof:false,
  atomic_queue_append:false,native_queue_expiry:false,reason}]};}
export async function runSessionResident(configFile,{signal,maximumMs=0}={}){
  const c=validateResidentConfig(privateRecord(configFile)),directory=privateDirectory(path.dirname(configFile));
  const key=residentKey(c.binding),worker=processIdentity(process.pid);
  const lease=BridgeRunLock.acquire({stateFile:path.join(directory,'resident-lock.json'),identity:{server_id:'session-resident-v1',owner_id:String(process.getuid()),computer_id:'local',agent_id:key}});
  let bridge,adapter,broker,stopping=false,reason=null,syncError=null,lastReconnect=0,exitReason='stopped';
  const halt=()=>{stopping=true;};process.once('SIGTERM',halt);process.once('SIGINT',halt);signal?.addEventListener('abort',halt,{once:true});
  const start=Date.now();
  async function connect(){
    let endpoint;
    if(c.runtime==='codex'&&c.control!=='desktop')try{endpoint=await discoverCodexEndpoint({conversationId:c.binding.route.session_id,workspace:c.binding.workspace,
      ...(c.endpoint?{endpoint:c.endpoint,rpcPath:c.rpcPath}:{})});}catch(e){reason=code(e);}
    const native={...c.agent,state_file:'bridge.json',native_runtime:{state_file:'native.json',sessions:[{
      host_kind:c.binding.host_kind,workspace:c.binding.workspace,route:c.binding.route,label:c.label,
      ...(c.runtime==='claude-code'?{broker_directory:path.join(directory,'broker')}:c.control==='desktop'?{desktop:{session_id:c.binding.route.session_id,state_file:'desktop.json'}}:
        {endpoint:endpoint?.endpoint??'unix:///nonexistent/io-agent-native.sock',rpc_path:endpoint?.rpcPath??'/'})}]}};
    adapter=createNativeBridgeAdapter(native,{configDirectory:directory,createClaudeBroker:async options=>{
      broker=await createClaudeModBroker(options);atomic(path.join(directory,'binding.json'),privateRecord(broker.configFile));return broker;
    }});
    const readiness=adapter.readinessSnapshot.bind(adapter),item=adapter.onItem.bind(adapter),answer=adapter.onAnswer.bind(adapter);
    const legacy=id=>typeof id==='string'&&(id.startsWith(c.runtime+'-task-')||c.legacyTaskIds.includes(id));
    adapter.onItem=(source,context)=>legacy(source.body?.task_id)?[]:item(source,context);
    adapter.onAnswer=(input,context)=>legacy(input.request?.body?.task_id)?[]:answer(input,context);
    adapter.readinessSnapshot=async options=>{
      const snapshot=await readiness(options),s=snapshot.sessions[0];
      if(s.availability==='online'){reason=null;return snapshot;}
      reason=c.runtime==='claude-code'?(Date.now()-start<15000?'CLAUDE_PLUGIN_CONNECTING':'CLAUDE_PLUGIN_RELOAD_REQUIRED'):reason||s.reason||'CODEX_SESSION_ENDPOINT_UNAVAILABLE';
      return pendingSnapshot(c,reason);
    };
    bridge=new AgentBridge({config:native,adapter,sharedInbox:true,stateFile:path.join(directory,'bridge.json')});await bridge.start();lastReconnect=Date.now();
  }
  try{
    while(!stopping&&(!maximumMs||Date.now()-start<maximumMs)){
      lease.assertHeld();if(!sameProcess(c.owner)){exitReason='owner_process_changed';break;}
      if(!bridge)try{await connect();}catch(e){
        reason=code(e);try{await bridge?.stop();}catch(cleanup){process.stderr.write(JSON.stringify({cleanup_error:code(cleanup)})+'\n');}bridge=null;
        atomic(path.join(directory,'health.json'),{schema_version:1,binding_key:key,worker,at:new Date().toISOString(),cloud_online:false,can_execute:false,reason});
        await sleep(5000);continue;
      }
      // A Mod reload ends the old instance while the same conversation lives on: rebuild the broker
      // for the next instance. Only a replaced conversation ends this helper; a closed one ends with
      // its native owner process above.
      if(broker?.lifecycle?.().ended){
        if(['clear','resume','session_changed'].includes(broker.lifecycle().endReason)){exitReason=broker.lifecycle().endReason;break;}
        await bridge.stop();bridge=null;broker=null;continue;
      }
      if(adapter.lifecycle().closed){exitReason='native_transport_closed';break;}
      try{
        for(const event of await adapter.pendingObservedTasks?.()??[])
          await bridge.client.post('task',{schema_version:'1.0',producer_id:c.agent.producer_id,...event});
        await bridge.pollOnce();
        syncError=null;
      }catch(e){syncError=code(e);}
      const directoryState=bridge.status().session_directory;
      let canExecute=false;
      try{canExecute=(await adapter.readinessSnapshot({timeoutMs:1000})).sessions[0]?.can_execute===true;}catch(e){reason=code(e);}
      atomic(path.join(directory,'health.json'),{schema_version:1,binding_key:key,worker,at:new Date().toISOString(),
        cloud_online:directoryState.leased_sessions>0&&directoryState.error===null,can_execute:canExecute,
        reason:directoryState.error??syncError??reason??null});
      // A failed preflight is retried as a new read-only connection, while all
      // native input/stop journals survive. No lost native mutation is resent.
      const staleMod=c.runtime==='claude-code'&&broker?.lifecycle?.().bound&&!broker.lifecycle().connected;
      const retryCodex=c.runtime==='codex'&&!canExecute&&reason!=='CODEX_SESSION_NOT_LOADED';
      if((retryCodex||staleMod)&&Date.now()-lastReconnect>15000){await bridge.stop();bridge=null;broker=null;}
      await sleep(1000);
    }
  }finally{
    stopping=true;try{await bridge?.stop();}finally{
      if(fs.existsSync(path.join(directory,'binding.json')))fs.unlinkSync(path.join(directory,'binding.json'));
      atomic(path.join(directory,'health.json'),{schema_version:1,binding_key:key,worker,at:new Date().toISOString(),cloud_online:false,can_execute:false,reason:'SESSION_ENDED',exit_reason:exitReason});
      lease.release();process.removeListener('SIGTERM',halt);process.removeListener('SIGINT',halt);signal?.removeEventListener('abort',halt);
    }
  }
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{if(process.argv.length!==4||process.argv[2]!=='--config')throw Error('explicit config required');await runSessionResident(path.resolve(process.argv[3]));}
  catch(e){process.stderr.write(JSON.stringify({error:code(e)})+'\n');process.exitCode=1;}
}
