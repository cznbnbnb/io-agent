// Default: read-only recording preflight. Never manufactures placement/readiness
// evidence, force-stops the product, or tears down an unresolved mic owner.
import fs from 'node:fs/promises';
import fss from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {safeRecordingStatus,recordingRequest} from './recording-watchdog.mjs';
import {exe} from './host-tools.mjs';

const workspace=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const root=path.join(workspace,'rebuild/android-app'),privateRoot=path.join(root,'.private');
const adb=path.join(root,'.tools/sdk/platform-tools',exe('adb')),buildTools=path.join(root,'.tools/sdk/build-tools/36.0.0');
const pkg='com.rayneo.venus.pub',driver='com.turboio.androidtests',component=driver+'/'+driver+'.RecordingProbe';
const ownLabel='iO Agent UI test driver',external='/sdcard/Android/data/'+pkg+'/files/';
const expected={version:'0.5.3-dev1',code:10423,signer:'174695b5352ddb1af105a5ef604caf7a8332a52986af8d8eb642e2d3c91ff7ad'};
const probeId=crypto.randomBytes(16).toString('hex'),session=path.join(privateRoot,'recording-probe-'+probeId);
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const check=(value,code)=>{if(!value)throw Error(code);};
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const errorCode=e=>/^(?:RECORDING|SOURCE|PLACEMENT|CANDIDATE|DRIVER|ADB|PLAYBACK)_[A-Z0-9_]{1,65}$/.test(e?.message||'')?e.message:'RECORDING_RUNNER_FAILED';
let serial='',mode='preflight',placementPath='',enrollAttempt='',port=null,guard=null,instrument=null,player=null,installed=false,instrumentStarted=false,guardArmed=false,guardAck=false,safe=false,lockOwned=false;
let candidateHash='',driverHash='',source=null,lastReport=null,control=null,playerPreloaded=false,playerReleased=false,reportRelay=false,playerStarted=false;
const events=[],cleanup={},lockFile=path.join(privateRoot,'recording-probe-runner.lock');
const children=new Map();
const summary={schema:1,probe_id:probeId,mode,at:new Date().toISOString(),candidate:expected.version,version_code:expected.code,readiness_created:false,task_or_answer_submitted:false,source_placement_evidence_created:false,synthetic_only_claimed:false};

async function boundedFile(file,max){
 const stat=await fs.lstat(file);check(stat.isFile()&&!stat.isSymbolicLink()&&stat.size<=max,'RECORDING_FILE_INVALID');
 const value=await fs.readFile(file);check(value.length<=max,'RECORDING_FILE_BUDGET');return value;
}
async function contained(file,base){
 const absolute=path.resolve(file),relative=path.relative(base,absolute);check(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative),'RECORDING_PATH_INVALID');
 check(!(await fs.lstat(base)).isSymbolicLink(),'RECORDING_PATH_INVALID');
 let cursor=base;for(const part of relative.split(path.sep)){cursor=path.join(cursor,part);try{check(!(await fs.lstat(cursor)).isSymbolicLink(),'RECORDING_PATH_INVALID');}catch(e){if(e.code!=='ENOENT')throw e;}}
 return absolute;
}
async function json(file,max=32768){return JSON.parse((await boundedFile(file,max)).toString('utf8').replace(/^\uFEFF/,''));}
async function save(file,value){const partial=file+'.partial';await fs.writeFile(partial,JSON.stringify(value,null,2)+'\n',{mode:0o600});await fs.rename(partial,file);}
async function fileHash(file){const digest=crypto.createHash('sha256');for await(const chunk of fss.createReadStream(file))digest.update(chunk);return digest.digest('hex');}
// Output stays in memory and is never copied into errors/logs. No shell interpolation.
function command(executable,args,{timeout=15000,max=1048576}={}){
 return new Promise(resolve=>{
  let out='',err='',ended=false,tooLarge=false;const child=spawn(executable,args,{cwd:workspace,windowsHide:true,stdio:['ignore','pipe','pipe']});
  const finish=(status,failed=false)=>{if(ended)return;ended=true;clearTimeout(timer);resolve({status,failed:failed||tooLarge,out,err});};
  const collect=key=>bytes=>{if(out.length+err.length+bytes.length>max){tooLarge=true;child.kill();return;}if(key==='out')out+=bytes.toString('utf8');else err+=bytes.toString('utf8');};
  child.stdout.on('data',collect('out'));child.stderr.on('data',collect('err'));child.on('error',()=>finish(null,true));child.on('close',status=>finish(status));
  const timer=setTimeout(()=>{child.kill();finish(null,true);},timeout);
 });
}
async function phone(args,options){const r=await command(adb,['-s',serial,...args],options);check(!r.failed&&r.status===0,'ADB_OPERATION_UNCONFIRMED');return r.out;}
async function optionalPhone(args,options){return command(adb,['-s',serial,...args],options);}
async function installedHash(packageName){const location=(await phone(['shell','pm','path',packageName])).trim();check(/^package:(\/data\/app\/[A-Za-z0-9._~=/+-]+\/base\.apk)$/.test(location),'CANDIDATE_DEVICE_PATH_INVALID');return (await phone(['shell','sha256sum',location.slice(8)],{timeout:30000})).trim().split(/\s+/)[0];}
function background(executable,args,kind,{ipc=false,detached=true}={}){
 const child=spawn(executable,args,{cwd:workspace,windowsHide:true,detached,stdio:ipc?['ignore','ignore','ignore','ipc']:'ignore'});
 const record={pid:child.pid??null,exited:false,exit_code:null,spawn_failed:false};children.set(kind,record);
 child.on('error',()=>{record.spawn_failed=true;record.exited=true;});child.on('exit',code=>{record.exited=true;record.exit_code=Number.isInteger(code)?code:null;});return child;
}
function remember(event){if(events.length<128)events.push(event);}
async function verifyCandidate(){
 const candidate=await json(path.join(root,'candidate.json'));check(candidate.schema===1&&candidate.version===expected.version&&candidate.version_code===expected.code&&candidate.signer_sha256===expected.signer&&candidate.signature_v2===true&&candidate.signature_v3===true,'CANDIDATE_IDENTITY_MISMATCH');
 const apk=await contained(path.resolve(root,candidate.apk||''),path.join(root,'artifacts'));
 check(/^[a-f0-9]{64}$/.test(candidate.sha256)&&await fileHash(apk)===candidate.sha256&&(await fs.stat(apk)).size===candidate.bytes,'CANDIDATE_HASH_MISMATCH');candidateHash=candidate.sha256;
 const aapt=path.join(buildTools,exe('aapt2'));
 const badging=await command(aapt,['dump','badging',apk],{timeout:30000});check(!badging.failed&&badging.status===0&&new RegExp("^package: name='"+pkg.replaceAll('.','\\.')+"' versionCode='10423' versionName='0\\.5\\.3-dev1'",'m').test(badging.out),'CANDIDATE_PACKAGE_MISMATCH');
 const version=await phone(['shell','dumpsys','package',pkg]);check(/versionCode=10423\b/.test(version)&&/versionName=0\.5\.3-dev1(?:\r?\n|\s|$)/.test(version),'CANDIDATE_NOT_INSTALLED');
 check(await installedHash(pkg)===candidateHash,'CANDIDATE_DEVICE_HASH_MISMATCH');
 const driverApk=await contained(path.join(root,'build/emulator-input/emulator-input.apk'),path.join(root,'build'));
 const stat=await fs.lstat(driverApk);check(stat.isFile()&&stat.size>0&&stat.size<16777216,'DRIVER_FILE_INVALID');
 const driverBadging=await command(aapt,['dump','badging',driverApk]);check(!driverBadging.failed&&driverBadging.status===0&&/^package: name='com\.turboio\.androidtests' versionCode='1' versionName='1'/m.test(driverBadging.out),'DRIVER_IDENTITY_MISMATCH');
 // aapt2 badging omits application-label for this instrumentation-only APK.
 // Verify the compiled manifest label and the exact instrumentation target.
 const manifest=await command(aapt,['dump','xmltree',driverApk,'--file','AndroidManifest.xml']);
 check(!manifest.failed&&manifest.status===0&&manifest.out.split(/\r?\n/).filter(line=>/android:label\(0x01010001\)="iO Agent UI test driver"/.test(line)).length===1,'DRIVER_IDENTITY_MISMATCH');
 const entries=manifest.out.split(/\bE: instrumentation \(line=\d+\)/).slice(1).filter(entry=>entry.includes('="com.turboio.androidtests.RecordingProbe"'));
 check(entries.length===1&&entries[0].includes('android:targetPackage(0x01010021)="'+pkg+'"'),'DRIVER_INSTRUMENTATION_MISMATCH');
 for(const file of [apk,driverApk]){const sign=await command('java',['-Duser.language=en','-Duser.country=US','-jar',path.join(buildTools,'lib/apksigner.jar'),'verify','--min-sdk-version','24','--verbose','--print-certs',file],{timeout:30000});
  check(!sign.failed&&sign.status===0&&/Verified using v2 scheme.*true/.test(sign.out),'DRIVER_SIGNATURE_UNCONFIRMED');const digests=[...sign.out.matchAll(/Signer #\d+ certificate SHA-256 digest: ([a-f0-9]{64})/gi)].map(m=>m[1].toLowerCase());check(digests.length===1&&digests[0]===expected.signer,'DRIVER_SIGNER_MISMATCH');}
 driverHash=await fileHash(driverApk);return driverApk;
}
async function verifySource(){
 const record=await json(path.join(root,'asr-synthetic-source-2026-10-21.json'));
 const sourceDir=path.join(privateRoot,'phone-r4-source-2026-10-21'),wavPath=await contained(path.join(sourceDir,'official-asr-synthetic-direct.wav'),privateRoot),pcmPath=await contained(path.join(sourceDir,'official-asr-synthetic.pcm'),privateRoot);
 const wav=await boundedFile(wavPath,2097152),pcm=await boundedFile(pcmPath,480000);
 check(record.schema===1&&record.rate===16000&&record.channels===1&&record.bits===16&&record.pcm_bytes===pcm.length&&record.nonzero_samples>16000&&hash(pcm)===record.pcm_sha256&&hash(wav)===record.wav_sha256,'SOURCE_HASH_MISMATCH');
 check(wav.toString('ascii',0,4)==='RIFF'&&wav.toString('ascii',8,12)==='WAVE'&&wav.readUInt32LE(4)+8===wav.length,'SOURCE_WAV_INVALID');
 let format=null,data=null;for(let offset=12;offset+8<=wav.length;){const kind=wav.toString('ascii',offset,offset+4),length=wav.readUInt32LE(offset+4);check(offset+8+length<=wav.length,'SOURCE_WAV_INVALID');
  if(kind==='fmt '){check(!format&&length>=16,'SOURCE_WAV_INVALID');format=wav.subarray(offset+8,offset+8+length);}if(kind==='data'){check(!data,'SOURCE_WAV_INVALID');data=wav.subarray(offset+8,offset+8+length);}offset+=8+length+(length%2);}
 check(format&&data&&format.readUInt16LE(0)===1&&format.readUInt16LE(2)===1&&format.readUInt32LE(4)===16000&&format.readUInt16LE(14)===16&&data.equals(pcm),'SOURCE_WAV_PCM_MISMATCH');
 let nonzero=0;for(let i=0;i<pcm.length;i+=2)if(pcm.readInt16LE(i)!==0)nonzero++;
 check(pcm.length%2===0&&nonzero===record.nonzero_samples&&pcm.length/32000===record.duration_seconds&&record.duration_seconds>0&&record.duration_seconds<=12,'SOURCE_DURATION_OR_SIGNAL_INVALID');
 return {pcmPath,wavPath,pcm_sha256:record.pcm_sha256,wav_sha256:record.wav_sha256,pcm_bytes:pcm.length,duration_seconds:record.duration_seconds};
}
async function verifyPlacement(){
 check(placementPath,'PLACEMENT_PROOF_REQUIRED');const file=await contained(path.resolve(workspace,placementPath),privateRoot),proof=await json(file,4096);
 check(proof.schema===1&&proof.source_placement_confirmed===true&&proof.source_pcm_sha256===source.pcm_sha256&&proof.source_wav_sha256===source.wav_sha256&&Number.isSafeInteger(proof.expires_at)&&proof.expires_at>Date.now()+90000&&proof.expires_at<=Date.now()+3600000,'PLACEMENT_PROOF_INVALID');
 return file;
}
async function installDriver(apk){
 const before=await optionalPhone(['shell','pm','path',driver]);check(!before.failed&&!/^package:/m.test(before.out),'DRIVER_ALREADY_PRESENT');
 await phone(['shell','input','keyevent','KEYCODE_WAKEUP']);await phone(['shell','wm','dismiss-keyguard']);await phone(['shell','cmd','statusbar','collapse']);
 let ended=false,stdout='',stderr='',failed=false;const child=spawn(adb,['-s',serial,'install','-r',apk],{cwd:workspace,windowsHide:true,stdio:['ignore','pipe','pipe']});
 const done=new Promise(resolve=>{child.stdout.on('data',b=>{if(stdout.length<32768)stdout+=b.toString('utf8');});child.stderr.on('data',b=>{if(stderr.length<32768)stderr+=b.toString('utf8');});child.on('error',()=>{failed=true;ended=true;resolve(null);});child.on('close',code=>{ended=true;resolve(code);});});
 const timer=setTimeout(()=>{failed=true;child.kill();},30000),ui='/data/local/tmp/io-agent-recording-install-'+probeId+'.xml';
 try{
  while(!ended){await pause(600);if(ended)break;try{
   await phone(['shell','uiautomator','dump',ui],{timeout:7000});const xml=await phone(['exec-out','cat',ui],{timeout:4000});
   const nodes=[...xml.matchAll(/<node\b[^>]+/g)].map(m=>Object.fromEntries([...m[0].matchAll(/([\w-]+)="([^"]*)"/g)].map(a=>[a[1],a[2]]))).filter(n=>n.package==='com.miui.securitycenter');
   if(nodes.length)await save(path.join(session,'install-window.json'),{nodes:nodes.map(n=>Object.fromEntries(['text','content-desc','resource-id','enabled','clickable','bounds'].map(k=>[k,n[k]||''])))});
   if(nodes.some(n=>n.text===ownLabel)){const buttons=nodes.filter(n=>n.text==='继续安装'&&n.enabled==='true'&&n.clickable==='true'&&/^\[\d+,\d+\]\[\d+,\d+\]$/.test(n.bounds||''));
    if(buttons.length===1){const b=buttons[0].bounds.match(/\d+/g).map(Number);check(b[2]>b[0]&&b[3]>b[1],'DRIVER_INSTALL_CONTROL_INVALID');await phone(['shell','input','tap',String(Math.floor((b[0]+b[2])/2)),String(Math.floor((b[1]+b[3])/2))],{timeout:3000});cleanup.install_continue_clicked=true;}}
  }catch{cleanup.install_window_unconfirmed=true;}finally{await optionalPhone(['shell','rm','-f',ui],{timeout:3000});}}
  const code=await done;cleanup.install_exit_code=code;const installFailure=(stdout+'\n'+stderr).match(/\bINSTALL_FAILED_[A-Z_]+\b/);if(installFailure)cleanup.install_failure_code=installFailure[0];
  check(!failed&&code===0&&/\bSuccess\b/.test(stdout),'DRIVER_INSTALL_UNCONFIRMED');installed=true;
 }finally{clearTimeout(timer);}
 check((await phone(['shell','pm','list','instrumentation'])).split(/\r?\n/).some(line=>{
  const match=/^instrumentation:([^/\s]+)\/([^\s]+) \(target=([^\s)]+)\)$/.exec(line.trim());if(!match)return false;
  // PackageManager prints either a full or package-relative component name.
  const name=match[2].startsWith('.')?match[1]+match[2]:match[2];return match[1]===driver&&name===driver+'.RecordingProbe'&&match[3]===pkg;
 }),'DRIVER_INSTRUMENTATION_MISMATCH');
 check(await fileHash(apk)===driverHash&&await installedHash(driver)===driverHash,'DRIVER_FILE_CHANGED');
}
async function preloadPlayer(){
 check(await fileHash(source.wavPath)===source.wav_sha256,'SOURCE_HASH_MISMATCH');
 const ready=path.join(session,'playback-ready'),start=path.join(session,'playback-start'),done=path.join(session,'playback-done');const quote=v=>"'"+v.replaceAll("'","''")+"'";
 const script=`$ErrorActionPreference='Stop'; try { $ioProbePlayer=New-Object System.Media.SoundPlayer(${quote(source.wavPath)}); $ioProbePlayer.Load(); [IO.File]::WriteAllText(${quote(ready)},'READY'); $ioProbeUntil=[DateTime]::UtcNow.AddSeconds(60); while(-not [IO.File]::Exists(${quote(start)})){if([DateTime]::UtcNow -gt $ioProbeUntil){exit 3}; Start-Sleep -Milliseconds 50}; $ioProbePlayer.PlaySync(); [IO.File]::WriteAllText(${quote(done)},'DONE'); $ioProbePlayer.Dispose(); exit 0 } catch { exit 2 }`;
 // Windows PowerShell can exit without running EncodedCommand in the detached
 // hidden-console mode. Playback needs no independent lifetime; the separate
 // Node stop guard remains detached and independent of this player/parent.
 player=background('powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],'playback',{detached:false});
 const until=Date.now()+8000;while(Date.now()<until){try{if((await boundedFile(ready,16)).toString()==='READY'){playerPreloaded=true;return;}}catch{}check(!children.get('playback').exited,'PLAYBACK_PRELOAD_FAILED');await pause(100);}throw Error('PLAYBACK_PRELOAD_UNCONFIRMED');
}
async function writeControl(armed){
 check(mode==='capture'&&placementPath&&(!armed||guardArmed),'RECORDING_GUARD_HANDSHAKE_REQUIRED');await verifyPlacement();
 control={probe_id:probeId,expires_at:Date.now()+90000,source_pcm_sha256:source.pcm_sha256,guard_armed:armed,source_placement_confirmed:true};
 const local=path.join(session,'capture-control.json');await save(local,control);const partial=external+'io-agent-recording-probe-control.json.partial';await phone(['push',local,partial],{timeout:4000});await phone(['shell','mv',partial,external+'io-agent-recording-probe-control.json'],{timeout:3000});
}
const booleanFields=['watchdog_ack','preflight_passed','preflight_fresh_idle_verified','preflight_stop_dispatch_verified','cold_recovery_supported','armed','stop_accepted','device_idle_verified','native_start_attempted','native_stopped_verified','native_released','recording_released','coordinator_released','answer_ready','safe_to_disarm','physical_capture_requested','capture_audio_may_include_environment','synthetic_only_claimed','task_or_answer_submitted','readiness_created','source_readiness_enrolled','enrollment_requested','enrollment_evidence_unchanged','expected_preview_retained','expected_no_file_change_retained','expected_keep_materials_retained','expected_friday_retained'];
const numberFields=['sequence','stop_command_count','frame_count','audio_frames','ack_count','decoded_bytes','asr_pcm_bytes','pcm_peak'];
function metadata(raw){
 check(raw?.schema===1&&raw.probe_id===probeId&&raw.mode===mode,'RECORDING_REPORT_OWNER_INVALID');
 const value={schema:1,probe_id:probeId,mode};for(const key of booleanFields)if(typeof raw[key]==='boolean')value[key]=raw[key];for(const key of numberFields)if(Number.isSafeInteger(raw[key])&&raw[key]>=0)value[key]=raw[key];
 if(typeof raw.phase==='string'&&/^[A-Z_]{1,48}$/.test(raw.phase))value.phase=raw.phase;
 if(typeof raw.error==='string'&&(/^(?:VOICE|PROBE|READINESS)_[A-Z0-9_]{1,64}$/.test(raw.error)||raw.error===''))value.error=raw.error;
 if(typeof raw.coordinator_note==='string'&&/^[A-Za-z_]{0,80}$/.test(raw.coordinator_note))value.coordinator_note=raw.coordinator_note;
 if(Array.isArray(raw.coordinator_observed_notes)&&raw.coordinator_observed_notes.length<=16&&raw.coordinator_observed_notes.every(n=>typeof n==='string'&&/^VOICE_[A-Z_]{1,64}$/.test(n)))value.coordinator_observed_notes=raw.coordinator_observed_notes;
 return value;
}
async function readReport(){const result=await optionalPhone(['exec-out','cat',external+'io-agent-recording-probe-'+probeId+'.json'],{timeout:2500,max:16384});if(result.failed||result.status!==0)return null;try{return metadata(JSON.parse(result.out));}catch{return null;}}
function evidenceSafe(report){return safeRecordingStatus(report,probeId,mode)&&report.task_or_answer_submitted===false&&(enrollAttempt?typeof report.readiness_created==='boolean':report.readiness_created===false)&&report.synthetic_only_claimed===false;}
async function stopSocket(){if(port)try{await recordingRequest(port,probeId,'stop');}catch{/* The independent guard remains responsible too. */}}
async function openNormalGlassesTab(){
 const ui='/data/local/tmp/io-agent-recording-host-'+probeId+'.xml';
 try{
  await phone(['shell','uiautomator','dump',ui],{timeout:6000});const xml=await phone(['exec-out','cat',ui],{timeout:3000});
  const nodes=[...xml.matchAll(/<node\b[^>]+/g)].map(m=>Object.fromEntries([...m[0].matchAll(/([\w-]+)="([^"]*)"/g)].map(a=>[a[1],a[2]])));
  const tabs=nodes.filter(n=>n.package===pkg&&n.enabled==='true'&&n.clickable==='true'&&(n.text==='眼镜'||n['content-desc']==='眼镜')&&/^\[\d+,\d+\]\[\d+,\d+\]$/.test(n.bounds||''));
  if(tabs.length===1){const b=tabs[0].bounds.match(/\d+/g).map(Number);await phone(['shell','input','tap',String(Math.floor((b[0]+b[2])/2)),String(Math.floor((b[1]+b[3])/2))],{timeout:3000});cleanup.normal_glasses_tab_opened=true;}
 }catch{cleanup.normal_glasses_tab_unconfirmed=true;}finally{await optionalPhone(['shell','rm','-f',ui],{timeout:3000});}
}
async function runProbe(){
 const allocated=(await phone(['forward','tcp:0','localabstract:io-agent-recording-'+probeId])).trim();check(/^\d{1,5}$/.test(allocated)&&Number(allocated)>0&&Number(allocated)<=65535,'RECORDING_FORWARD_INVALID');port=Number(allocated);
 if(mode==='capture'){check(await fileHash(source.pcmPath)===source.pcm_sha256,'SOURCE_HASH_MISMATCH');await phone(['push',source.pcmPath,external+'official-asr-synthetic.pcm']);check((await phone(['shell','sha256sum',external+'official-asr-synthetic.pcm'])).trim().split(/\s+/)[0]===source.pcm_sha256,'SOURCE_DEVICE_HASH_MISMATCH');await writeControl(false);await preloadPlayer();}
 const guardReport=path.join(session,'watchdog.json');
 guard=background(process.execPath,[path.join(workspace,'tools/android/recording-watchdog.mjs'),JSON.stringify({port,probeId,mode,report:guardReport,deadlineMs:20000})],'watchdog',{ipc:true});
 guard.on('message',event=>{if(event?.probe_id!==probeId||event.mode!==mode)return;if(event.event==='armed')guardArmed=true;if(event.event==='safe_disarmed')guardAck=true;
  if(['starting','armed','deadline_reached','needs_physical_stop','safe_disarmed','not_armed'].includes(event.event))remember({event:event.event,elapsed_ms:Number.isSafeInteger(event.elapsed_ms)?event.elapsed_ms:null});});
 instrumentStarted=true;instrument=background(adb,['-s',serial,'shell','am','instrument','-w','-e','probe_id',probeId,'-e','mode',mode,...(enrollAttempt?['-e','enroll_attempt',enrollAttempt]:[]),component],'instrumentation');
 // Reserve the remainder of the 60-second observation budget for the final
 // bounded stop/report read and endpoint-grace handshake.
 const until=Date.now()+47000;let controlAcknowledged=false,lastPhase='',hostTabAttempted=false;
 while(Date.now()<until){
  if(mode==='capture'&&guardArmed&&!controlAcknowledged){await writeControl(true);controlAcknowledged=true;}
  let status=null;try{status=metadata(await recordingRequest(port,probeId,'status'));}catch{}
  if(status?.phase&&status.phase!==lastPhase){lastPhase=status.phase;remember({event:'phone_phase',phase:lastPhase});}
  // The official Flutter plugin initializes lazily on its observed glasses tab
  // after instrumentation restart. This only opens that normal UI entry.
  if(status?.phase==='WAITING_FOR_HOST'&&!hostTabAttempted){hostTabAttempted=true;
   // Shell explicitly opens the normal foreground activity: MIUI can reject an
   // instrumentation context's background start before any Activity exists.
   await phone(['shell','am','start','-n',pkg+'/com.rayneo.venus.MainActivity'],{timeout:5000});cleanup.normal_main_started_for_probe=true;
   await openNormalGlassesTab();
  }
  if(mode==='capture'&&controlAcknowledged&&!playerStarted&&status?.audio_frames>0){check(playerPreloaded&&!children.get('playback').exited,'PLAYBACK_NOT_AVAILABLE');await fs.writeFile(path.join(session,'playback-start'),'PLAY',{flag:'wx',mode:0o600});playerStarted=true;}
  if(mode==='capture'&&playerStarted&&!playerReleased){try{if((await boundedFile(path.join(session,'playback-done'),16)).toString()==='DONE'){playerReleased=true;await stopSocket();}}catch{}}
  lastReport=await readReport()||lastReport;
  if(evidenceSafe(lastReport)){safe=true;await save(path.join(session,'phone-report.json'),lastReport);break;}
  if(children.get('playback')?.exited&&playerStarted&&!playerReleased&&children.get('playback').exit_code!==0)await stopSocket();
  await pause(200);
 }
 if(!safe){await stopSocket();lastReport=await readReport()||lastReport;if(evidenceSafe(lastReport)){safe=true;await save(path.join(session,'phone-report.json'),lastReport);}}
 if(!safe)throw Error('RECORDING_NEEDS_PHYSICAL_STOP');
 // Give the child the endpoint's final-state grace interval. If it missed that
 // interval, relay phone evidence explicitly instead of claiming a guard ACK.
 const ackUntil=Date.now()+2000;while(!guardAck&&Date.now()<ackUntil&&!children.get('watchdog').exited)await pause(100);
 if(!guardAck){try{const report=await json(guardReport);guardAck=report.probe_id===probeId&&report.disarmed===true&&safeRecordingStatus(report.last,probeId,mode);}catch{}}
 if(!guardAck){reportRelay=true;await save(path.join(session,'relay-phone-evidence.json'),{schema:1,event:'relay-phone-evidence',probe_id:probeId,mode,safe_to_disarm:true,phone_report_sha256:await fileHash(path.join(session,'phone-report.json')),watchdog_ack_claimed:false});}
}
async function cleanupSafe(){
 if(!safe&&instrumentStarted)return;
 if(guard&&!children.get('watchdog').exited){if(safe)guard.kill();else check(!instrumentStarted,'RECORDING_NEEDS_PHYSICAL_STOP');}
 if(instrument&&!children.get('instrumentation').exited){await pause(1600);if(!children.get('instrumentation').exited&&safe){instrument.kill();cleanup.instrumentation_client_terminated_after_safe=true;}}
 if(player&&!children.get('playback').exited){player.kill();cleanup.playback_process_stopped=true;}
 if(port){await phone(['forward','--remove','tcp:'+port]);cleanup.forward_removed=true;}
 if(installed){check(/\bSuccess\b/.test(await phone(['uninstall',driver],{timeout:30000})),'DRIVER_CLEANUP_UNCONFIRMED');const remaining=await optionalPhone(['shell','pm','path',driver]);check(!remaining.failed&&!remaining.err.trim()&&[0,1].includes(remaining.status)&&!/^package:/m.test(remaining.out),'DRIVER_CLEANUP_UNCONFIRMED');cleanup.driver_removed=true;}
 if(safe){await phone(['shell','am','start','-n',pkg+'/com.rayneo.venus.MainActivity']);cleanup.normal_main_requested=true;}
 if(lockOwned){const lock=await json(lockFile);if(lock.probe_id===probeId){await fs.unlink(lockFile);lockOwned=false;}}
 for(const child of [guard,instrument,player])if(child){if(child.connected)child.disconnect();child.unref();}
}
async function main(){
 const args=process.argv.slice(2);for(let i=0;i<args.length;i++){if(args[i]==='--capture'){check(mode==='preflight','RECORDING_ARGUMENT_INVALID');mode='capture';}else if(args[i]==='--placement-proof'){check(!placementPath&&args[i+1]&&!args[i+1].startsWith('--'),'PLACEMENT_PROOF_REQUIRED');placementPath=args[++i];}else if(args[i]==='--enroll-source'){check(!enrollAttempt&&/^[a-f0-9]{32}$/.test(args[i+1]||''),'RECORDING_ARGUMENT_INVALID');enrollAttempt=args[++i];}else throw Error('RECORDING_ARGUMENT_INVALID');}
 check((mode==='capture'||!placementPath)&&(!enrollAttempt||mode==='preflight'),'RECORDING_ARGUMENT_INVALID');summary.mode=mode;summary.enrollment_requested=Boolean(enrollAttempt);summary.capture_audio_may_include_environment=mode==='capture';
 await fs.mkdir(privateRoot,{recursive:true});await contained(lockFile,privateRoot);const lock=await fs.open(lockFile,'wx',0o600);lockOwned=true;await lock.writeFile(JSON.stringify({schema:1,probe_id:probeId,runner_pid:process.pid,mode}));await lock.close();
 await fs.mkdir(session,{recursive:false,mode:0o700});source=await verifySource();if(mode==='capture')placementPath=await verifyPlacement();
 const targetFile=await contained(path.join(privateRoot,'phone-login-install-2026-10-20/verified-target.json'),privateRoot),target=await json(targetFile);check(typeof target.serial==='string'&&/^[A-Za-z0-9._:-]{1,128}$/.test(target.serial),'ADB_TARGET_INVALID');serial=target.serial;
 const apk=await verifyCandidate();await installDriver(apk);await runProbe();
}
let failure='';
try{await main();}catch(error){failure=errorCode(error);if(instrumentStarted&&!safe)await stopSocket();}
try{if(safe||!instrumentStarted)await cleanupSafe();}catch(error){cleanup.error=errorCode(error);failure=failure||cleanup.error;}
if(instrumentStarted&&!safe){
 // Leave both independent guard and instrumentation alive. Never substitute
 // process absence/USB loss for a fresh device-idle proof.
 if(player&&!children.get('playback').exited)player.kill();
 summary.state='NEEDS_PHYSICAL_STOP';summary.operator_action_required=true;
 for(const child of [guard,instrument])if(child){if(child.connected)child.disconnect();child.unref();}
}else summary.state=safe?'SAFE_FINISHED':'NOT_STARTED';
Object.assign(summary,{error:failure,production_sha256:candidateHash||null,driver_sha256:driverHash||null,source_pcm_sha256:source?.pcm_sha256||null,source_wav_sha256:source?.wav_sha256||null,independent_guard_armed:guardArmed,independent_guard_safe_ack:guardAck,relay_phone_evidence:reportRelay,playback_preloaded:playerPreloaded,playback_started_after_audio_frames:playerStarted,playback_completed:playerReleased,phone_report:lastReport,events,cleanup,forward_port:port,child_processes:Object.fromEntries(children),private_session:path.relative(root,session),journal_and_audio_retained:true});
summary.readiness_created=lastReport?.readiness_created===true;
summary.passed=safe&&!failure&&guardArmed&&lastReport?.error===''&&lastReport.preflight_passed===true&&(!enrollAttempt||lastReport.enrollment_requested===true&&lastReport.source_readiness_enrolled===true&&lastReport.enrollment_evidence_unchanged===true)&&(mode==='preflight'?lastReport.armed===false&&lastReport.preflight_stop_dispatch_verified===true:lastReport.armed===true&&lastReport.answer_ready===true&&playerReleased&&['expected_preview_retained','expected_no_file_change_retained','expected_keep_materials_retained','expected_friday_retained'].every(key=>lastReport[key]===true));
try{await fs.mkdir(session,{recursive:true,mode:0o700});await save(path.join(session,'runner-summary.json'),summary);}catch{summary.summary_write_failed=true;}
console.log(JSON.stringify(summary));process.exitCode=summary.passed&&!summary.summary_write_failed?0:2;
