// One bounded synthetic-only official ASR probe. The watchdog runs in a separate OS process.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawn, spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const base=path.resolve('rebuild/android-app');
const adb=path.join(base,'.tools/sdk/platform-tools/adb.exe');
const target=JSON.parse(fs.readFileSync(path.join(base,'.private/phone-login-install-2026-10-20/verified-target.json'),'utf8'));
const dir=path.join(base,'.private/phone-r4-source-2026-10-21');
const pkg='com.rayneo.venus.pub', external='/sdcard/Android/data/'+pkg+'/files/';
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function check(ok,code){if(!ok)throw Error(code);}
function command(args,timeout=12000,allow=false){
 const r=spawnSync(adb,['-s',target.serial,...args],{encoding:'utf8',timeout,maxBuffer:8*1024*1024,windowsHide:true});
 if(!allow)check(r.status===0,'ADB_OPERATION_FAILED');
 return r;
}
function save(name,value){fs.writeFileSync(path.join(dir,name),JSON.stringify(value,null,2)+'\n');}
function readDevice(name){const r=command(['exec-out','cat',external+name],4000,true);if(r.status!==0)return null;try{return JSON.parse(r.stdout);}catch{return null;}}
function cleanupProcess(reason){
 const stopped=command(['shell','am','force-stop',pkg],8000,true);
 const pids=command(['shell','pidof',pkg],4000,true);
 const verified=stopped.status===0&&pids.status===1&&!pids.stdout.trim();
 const restarted=command(['shell','am','start','-n',pkg+'/com.rayneo.venus.MainActivity'],8000,true);
 return {reason,force_stop_exit:stopped.status,process_absent_verified:verified,normal_launch_exit:restarted.status};
}
if(process.argv[2]==='--guard'){
 const nonce=process.argv[3];check(/^[a-f0-9]{32}$/.test(nonce),'GUARD_NONCE_INVALID');
 const timer=setTimeout(()=>{
  const result=cleanupProcess('INDEPENDENT_PC_DEADLINE');save('asr-watchdog-'+nonce+'.json',result);process.exit(result.process_absent_verified?0:2);
 },55000);
 process.on('message',value=>{if(value?.disarm===nonce){clearTimeout(timer);save('asr-watchdog-'+nonce+'.json',{armed:true,disarmed:true,probe_id:nonce,at:new Date().toISOString()});process.send?.({disarmed:nonce});process.disconnect();}});
 process.send?.({armed:nonce,deadline_ms:55000});
}else{
 const inputEnd=process.argv.includes('--input-end');
 fs.mkdirSync(dir,{recursive:true});
 const source=JSON.parse(fs.readFileSync(path.join(base,'asr-synthetic-source-2026-10-21.json'),'utf8'));
 const pcm=fs.readFileSync(path.join(dir,'official-asr-synthetic.pcm'));
 check(pcm.length===source.pcm_bytes&&crypto.createHash('sha256').update(pcm).digest('hex')===source.pcm_sha256&&source.nonzero_samples>16000,'SOURCE_MISMATCH');
 const installed=command(['shell','dumpsys','package',pkg]).stdout;
 check(/versionCode=10416\b/.test(installed)&&/versionName=0\.5\.1-dev2\b/.test(installed),'INSTALLED_CANDIDATE_CHANGED');
 command(['push',path.join(dir,'official-asr-synthetic.pcm'),external+'official-asr-synthetic.pcm']);
 check(command(['shell','sha256sum',external+'official-asr-synthetic.pcm']).stdout.split(/\s/)[0]===source.pcm_sha256,'DEVICE_SOURCE_MISMATCH');
 const before=command(['shell','cmd','appops','get',pkg,'RECORD_AUDIO'],5000,true);fs.writeFileSync(path.join(dir,'asr-appops-before.txt'),before.stdout+before.stderr);
 check(!/running=true|\(running\)/i.test(before.stdout),'UNEXPECTED_MICROPHONE_ACTIVE');
 const nonce=crypto.randomBytes(16).toString('hex');
 const guard=spawn(process.execPath,[fileURLToPath(import.meta.url),'--guard',nonce],{stdio:['ignore','ignore','ignore','ipc'],windowsHide:true});
 const armed=await Promise.race([new Promise(resolve=>guard.once('message',resolve)),pause(4000).then(()=>null)]);
 check(armed?.armed===nonce,'PC_WATCHDOG_NOT_ARMED');
 let child,report=null,unsafe=false,cleanup=null,hostTapped=false,exitCode=null;const seen=[];
 try{
  const control={probe_id:nonce,expires_at:Date.now()+55000,pc_guard_armed:true,pcm_sha256:source.pcm_sha256};
  save('asr-probe-control.json',control);command(['push',path.join(dir,'asr-probe-control.json'),external+'io-agent-asr-probe-control.json']);
  child=spawn(adb,['-s',target.serial,'shell','am','instrument','-w','-e','probe_id',nonce,...(inputEnd?['-e','input_end','true']:[]),'com.turboio.androidtests/com.turboio.androidtests.OfficialAsrProbe'],{stdio:['ignore','pipe','pipe'],windowsHide:true});
  const log=fs.createWriteStream(path.join(dir,'official-asr-instrumentation.txt'));child.stdout.pipe(log);child.stderr.pipe(log,{end:false});child.once('exit',code=>{exitCode=code;});
  const end=Date.now()+50000;
  while(Date.now()<end){
   report=readDevice('io-agent-official-asr-probe.json');if(report?.probe_id===nonce)break;report=null;
   const state=readDevice('io-agent-asr-probe-state.json');
   if(state?.probe_id===nonce){
    if(seen.at(-1)!==state.phase){seen.push(state.phase);console.log(JSON.stringify({phase:state.phase}));}
    if(state.phase==='waiting_for_host'&&!hostTapped){
     command(['shell','uiautomator','dump','/data/local/tmp/io-agent-asr-ui.xml'],6000);
     const xml=command(['exec-out','cat','/data/local/tmp/io-agent-asr-ui.xml'],4000).stdout;
     fs.writeFileSync(path.join(dir,'asr-host-ui.xml'),xml);command(['shell','rm','/data/local/tmp/io-agent-asr-ui.xml'],4000);
     const nodes=[...xml.matchAll(/<node\b[^>]+/g)].map(m=>Object.fromEntries([...m[0].matchAll(/([\w-]+)="([^"]*)"/g)].map(a=>[a[1],a[2]])));
     const buttons=nodes.filter(n=>n.package===pkg&&n.enabled==='true'&&n.clickable==='true'&&(n.text==='眼镜'||n['content-desc']==='眼镜'));
     if(buttons.length===1){const p=buttons[0].bounds.match(/\d+/g).map(Number);command(['shell','input','tap',String(Math.floor((p[0]+p[2])/2)),String(Math.floor((p[1]+p[3])/2))],4000);hostTapped=true;}
    }
   }
   const appops=command(['shell','cmd','appops','get',pkg,'RECORD_AUDIO'],4000,true);
   if(/running=true|\(running\)/i.test(appops.stdout)){unsafe=true;throw Error('UNEXPECTED_MICROPHONE_ACTIVE');}
   if(exitCode!==null)break;await pause(450);
  }
  if(!report){report=readDevice('io-agent-official-asr-probe.json');if(report?.probe_id!==nonce)report=null;}
  if(report)save('official-asr-probe-'+nonce+'.json',report);
  if(!report||report.engine_start_requested&&!report.released){unsafe=true;cleanup=cleanupProcess('ASR_RELEASE_NOT_CONFIRMED');}
 }catch(e){unsafe=true;cleanup=cleanupProcess(e.message);save('asr-orchestrator-error.json',{error:e.message,probe_id:nonce});}
 finally{
  const safe=report?.probe_id===nonce&&(!report.engine_start_requested||report.released)||cleanup?.process_absent_verified;
  let disarmed=false;
  if(safe){const ack=new Promise(resolve=>guard.once('message',resolve));guard.send({disarm:nonce});disarmed=(await Promise.race([ack,pause(4000).then(()=>null)]))?.disarmed===nonce;if(!disarmed)guard.kill();}else unsafe=true;
  if(child&&exitCode===null){await Promise.race([new Promise(resolve=>child.once('exit',resolve)),pause(2000)]);if(exitCode===null)child.kill();}
  command(['shell','am','start','-n',pkg+'/com.rayneo.venus.MainActivity'],8000,true);
  const after=command(['shell','cmd','appops','get',pkg,'RECORD_AUDIO'],5000,true);fs.writeFileSync(path.join(dir,'asr-appops-after.txt'),after.stdout+after.stderr);
  const texts=(report?.callbacks||[]).map(c=>String(c.text||''));
  const summary={schema:1,date:'2026-10-21',candidate:'0.5.1-dev2 /10416',probe_id:nonce,source_sha256:source.pcm_sha256,source_duration_seconds:source.duration_seconds,phase_history:seen,host_tab_selected:hostTapped,report_received:!!report,adapter_source:report?.adapter_source||'',host_flags_before:report?.host_flags_before||null,task_created:!!report?.task_created,engine_start_requested:!!report?.engine_start_requested,started_callback_accepted:!!report?.started_callback_accepted,pcm_bytes_sent:report?.pcm_bytes_sent||0,source_bytes:pcm.length,callback_count:texts.length,nonempty_callback_count:texts.filter(Boolean).length,finished_callback_count:(report?.callbacks||[]).filter(c=>c.finished).length,stop_task_accepted:!!report?.stop_task_accepted,state_after_stop:report?.state_after_stop||'',engine_stopped_verified:!!report?.engine_stopped_verified,engine_end_callback:!!report?.engine_end_callback,released:!!report?.released,stock_environment_still_idle:report?.stock_environment_still_idle??null,error:report?.error||'',callback_error:report?.callback_error||'',independent_pc_guard_armed:true,independent_pc_guard_disarmed_ack:disarmed,external_cleanup:cleanup,unexpected_or_incomplete:unsafe,physical_microphone_requested:false,appops_running_after:/running=true|\(running\)/i.test(after.stdout),glasses_capture_started:false,agent_task_created:false,full_transcript_kept_private:true,limits:['Synthetic PCM only; this does not verify glasses capture, physical microphone stop, complete task answer or lens behavior.']};
  summary.input_end_notified=!!report?.input_end_notified;summary.trailing_silence_bytes=report?.trailing_silence_bytes||0;
  fs.writeFileSync(path.join(base,inputEnd?'phone-official-asr-input-end-2026-10-21.json':'phone-official-asr-synthetic-2026-10-21.json'),JSON.stringify(summary,null,2)+'\n');console.log(JSON.stringify(summary));
 }
}
