// Separate Node process: stopping never depends on the model, TTS, playback or reports.
import net from 'node:net';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const validId=id=>typeof id==='string'&&/^[a-f0-9]{32}$/.test(id);
export function safeRecordingStatus(s,id,mode){
 if(!s||s.schema!==1||s.probe_id!==id||s.mode!==mode||typeof s.armed!=='boolean'||s.safe_to_disarm!==true)return false;
 if(!s.armed)return s.recording_released===true;
 return mode==='capture'&&s.stop_accepted===true&&s.device_idle_verified===true&&s.coordinator_released===true&&s.native_released===true&&s.recording_released===true&&typeof s.native_start_attempted==='boolean'&&(!s.native_start_attempted||s.native_stopped_verified===true);
}
export function recordingRequest(port,id,op,{timeoutMs=900,onContact=()=>{}}={}){
 return new Promise((resolve,reject)=>{
  let ended=false,bytes=Buffer.alloc(0);
  const socket=net.createConnection({host:'127.0.0.1',port});
  const finish=(error,value)=>{if(ended)return;ended=true;socket.destroy();error?reject(Error(error)):resolve(value);};
  socket.setTimeout(timeoutMs,()=>finish('RECORDING_CONTROL_TIMEOUT'));
  socket.on('error',()=>finish('RECORDING_CONTROL_UNAVAILABLE'));
  socket.on('connect',()=>{onContact();socket.write(JSON.stringify({probe_id:id,op})+'\n');});
  socket.on('data',chunk=>{
   if(bytes.length+chunk.length>8192){finish('RECORDING_CONTROL_BUDGET');return;}
   bytes=Buffer.concat([bytes,chunk]);const end=bytes.indexOf(10);if(end<0)return;
   try{const value=JSON.parse(bytes.subarray(0,end).toString('utf8'));if(value.probe_id!==id||value.schema!==1)throw Error();finish(null,value);}catch{finish('RECORDING_CONTROL_OWNER_INVALID');}
  });
  socket.on('end',()=>{if(!ended)finish('RECORDING_CONTROL_INCOMPLETE');});
 });
}
export async function runRecordingWatchdog({port,probeId,mode,deadlineMs=20000,setupMs=10000,pollMs=200,signal,onEvent=()=>{}}){
 if(!Number.isInteger(port)||port<1||port>65535||!validId(probeId)||!['preflight','capture'].includes(mode)||deadlineMs<10||deadlineMs>30000)throw Error('RECORDING_GUARD_CONFIG_INVALID');
 let contacted=false,armed=false,disarmed=false,deadlineFired=false,stopBusy=false,stopRequests=0,last=null,attention=false;
 const began=Date.now(),emit=(event,extra={})=>{try{onEvent({event,probe_id:probeId,mode,elapsed_ms:Date.now()-began,...extra});}catch{/* Reporting cannot revoke the stop obligation. */}};
 const request=op=>recordingRequest(port,probeId,op,{onContact:()=>{contacted=true;},timeoutMs:Math.min(900,Math.max(30,deadlineMs))});
 const stop=async()=>{if(stopBusy||disarmed)return;stopBusy=true;stopRequests++;try{const s=await request('stop');last=s;}catch{}finally{stopBusy=false;emit('stop_requested',{stop_requests:stopRequests});}};
 // Armed before the first ping can reach the phone. Even a lost handshake reply
 // cannot make the guard assume that the phone failed to receive its ping.
 const deadline=setTimeout(()=>{deadlineFired=true;void stop();emit('deadline_reached');},deadlineMs);
 emit('starting');
 try{
  while(!signal?.aborted){
   try{
    const s=await request(armed?'status':'ping');
    if(s.mode!==mode||typeof s.armed!=='boolean')throw Error('RECORDING_GUARD_MODE_INVALID');
    last=s;if(!armed){armed=true;emit('armed',{deadline_ms:deadlineMs});}
    if(safeRecordingStatus(s,probeId,mode)){disarmed=true;clearTimeout(deadline);emit('safe_disarmed',{capture_armed:s.armed,phase:s.phase});return {state:'safe_disarmed',disarmed:true,deadline_fired:deadlineFired,stop_requests:stopRequests,last:s};}
    emit('observed',{phase:typeof s.phase==='string'&&/^[A-Z_]{1,48}$/.test(s.phase)?s.phase:'UNKNOWN',audio_frames:Number.isSafeInteger(s.audio_frames)?s.audio_frames:0});
    if(mode==='preflight'&&s.phase==='PREFLIGHT_READY')await stop();
   }catch{
    if(!contacted&&Date.now()-began>=setupMs){clearTimeout(deadline);emit('not_armed');return {state:'not_armed',disarmed:false,stop_requests:stopRequests};}
   }
   if(deadlineFired){
    if(!attention&&Date.now()-began>deadlineMs+8000){attention=true;emit('needs_physical_stop',{disarmed:false});}
    // Remain live after an unresolved deadline; never replace fresh idle with
    // killing the app, an expired socket or a missing instrumentation process.
    if(Date.now()-began>deadlineMs+stopRequests*2000)void stop();
   }
   await sleep(pollMs);
  }
  emit('cancelled_unsafe',{disarmed:false});return {state:'cancelled_unsafe',disarmed:false,stop_requests:stopRequests,last};
 }finally{clearTimeout(deadline);}
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const cfg=JSON.parse(process.argv[2]||'{}');
 if(Object.keys(cfg).some(k=>!['port','probeId','mode','report','deadlineMs'].includes(k))||(cfg.deadlineMs!==undefined&&(!Number.isInteger(cfg.deadlineMs)||cfg.deadlineMs<10||cfg.deadlineMs>20000)))throw Error('RECORDING_GUARD_CONFIG_INVALID');
 const privateRoot=path.resolve('rebuild/android-app/.private'),report=path.resolve(cfg.report||'');
 if(!report.startsWith(privateRoot+path.sep)||!validId(cfg.probeId))throw Error('RECORDING_GUARD_REPORT_INVALID');
 let writes=Promise.resolve();const history=[];
 const save=value=>{writes=writes.then(async()=>{await fs.mkdir(path.dirname(report),{recursive:true});const temp=report+'.partial';await fs.writeFile(temp,JSON.stringify(value,null,2)+'\n');await fs.rename(temp,report);}).catch(()=>{});};
 // IPC is optional reporting. A disconnected/dead parent must never cause an
 // asynchronous unhandled error to terminate this independent stop owner.
 const event=e=>{if(history.length<256)history.push(e);try{if(process.connected)process.send(e,()=>{});}catch{}if(['armed','needs_physical_stop'].includes(e.event))save({schema:1,probe_id:cfg.probeId,state:e.event,disarmed:false,history});};
 const result=await runRecordingWatchdog({...cfg,onEvent:event});
 save({schema:1,probe_id:cfg.probeId,...result,history});await writes;process.exitCode=result.disarmed?0:2;
}
