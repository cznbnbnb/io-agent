// Staged, stop-only test observer for the normal original-question voice UI.
// Capture uses preloaded existing audio and a detached OS watchdog; neither
// playback nor this parent process owns the only deadline or stop mechanism.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {BridgeClient} from '../../rebuild/agent-bridge/client.mjs';
import {recordingRequest,safeRecordingStatus} from './recording-watchdog.mjs';

const workspace=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..'),root=path.join(workspace,'rebuild/android-app'),privateRoot=path.join(root,'.private');
const adb=path.join(root,'.tools/sdk/platform-tools/adb.exe'),buildTools=path.join(root,'.tools/sdk/build-tools/36.0.0');
const pkg='com.rayneo.venus.pub',driver='com.turboio.androidtests',component=driver+'/'+driver+'.NormalVoiceGuardProbe',label='iO Agent UI test driver';
const expected={version:'0.5.3-dev1',code:10423,signer:'174695b5352ddb1af105a5ef604caf7a8332a52986af8d8eb642e2d3c91ff7ad'};
const external='/sdcard/Android/data/'+pkg+'/files/connection-import/task-connection.json';
const targetFile=path.join(privateRoot,'phone-login-install-2026-10-20/verified-target.json'),leaseFile=path.join(privateRoot,'normal-voice-runner.lock');
const sourceFiles=['tools/android/run-normal-voice-guard.mjs','tools/android/NormalVoiceGuardProbe.java','tools/android/recording-watchdog.mjs','rebuild/agent-bridge/client.mjs','rebuild/android-app/src/com/turboio/addon/TaskConnection.java','rebuild/android-app/src/com/turboio/addon/TaskWire.java','rebuild/android-app/src/com/turboio/addon/WireJson.java'];
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const check=(ok,code)=>{if(!ok)throw Error(code);};
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const safeError=e=>/^(?:NORMAL_GUARD|ADB|DRIVER|CANDIDATE)_[A-Z0-9_]{1,64}$/.test(e?.message||'')?e.message:'NORMAL_GUARD_FAILED';
function noLinks(file){let cursor=path.parse(path.resolve(file)).root;for(const part of path.resolve(file).slice(cursor.length).split(path.sep)){cursor=path.join(cursor,part);check(!fs.lstatSync(cursor).isSymbolicLink(),'NORMAL_GUARD_PATH_LINK');}check(path.resolve(fs.realpathSync(file)).toLowerCase()===path.resolve(file).toLowerCase(),'NORMAL_GUARD_PATH_CHANGED');return path.resolve(file);}
function inside(file,base){const absolute=path.resolve(file),relative=path.relative(path.resolve(base),absolute);check(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative),'NORMAL_GUARD_PATH_INVALID');noLinks(base);noLinks(absolute);return absolute;}
function bytes(file,max=65536){noLinks(file);const before=fs.statSync(file);check(before.isFile()&&before.size<=max,'NORMAL_GUARD_FILE_BUDGET');const data=fs.readFileSync(file);check(data.length===before.size&&data.length<=max,'NORMAL_GUARD_FILE_CHANGED');const after=fs.statSync(file);check(before.size===after.size&&before.mtimeMs===after.mtimeMs,'NORMAL_GUARD_FILE_CHANGED');return data;}
const json=(file,max)=>JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes(file,max)).replace(/^\uFEFF/,''));
function atomic(file,value){noLinks(path.dirname(file));if(fs.existsSync(file))noLinks(file);const partial=file+'.partial';check(!fs.existsSync(partial),'NORMAL_GUARD_PARTIAL_EXISTS');fs.writeFileSync(partial,JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});fs.renameSync(partial,file);}
async function fileHash(file){noLinks(file);const digest=crypto.createHash('sha256');for await(const chunk of fs.createReadStream(file))digest.update(chunk);return digest.digest('hex');}
const sourceHashes=()=>Object.fromEntries(sourceFiles.map(name=>[name,hash(bytes(path.join(workspace,name),1048576))]));
// WireJson sorts UTF-16 keys (ASCII schema here) and escapes backspace/formfeed
// as unicode, unlike JSON.stringify. Reject noninteger JSON numbers/surrogates.
export function wireCanonical(value,depth=0){
 check(depth<=32,'NORMAL_GUARD_WIRE_COMPLEXITY');
 if(value===null)return 'null';if(typeof value==='boolean')return String(value);
 if(typeof value==='number'){check(Number.isSafeInteger(value),'NORMAL_GUARD_WIRE_NUMBER');return String(value);}
 if(typeof value==='string'){for(let i=0;i<value.length;i++){const c=value.charCodeAt(i);if(c>=0xd800&&c<=0xdbff){const n=value.charCodeAt(++i);check(n>=0xdc00&&n<=0xdfff,'NORMAL_GUARD_WIRE_UNICODE');}else check(c<0xdc00||c>0xdfff,'NORMAL_GUARD_WIRE_UNICODE');}let out='"';for(const c of value){if(c==='"')out+='\\"';else if(c==='\\')out+='\\\\';else if(c==='\n')out+='\\n';else if(c==='\r')out+='\\r';else if(c==='\t')out+='\\t';else if(c.charCodeAt(0)<32)out+='\\u'+c.charCodeAt(0).toString(16).padStart(4,'0');else out+=c;}return out+'"';}
 if(Array.isArray(value))return '['+value.map(v=>wireCanonical(v,depth+1)).join(',')+']';
 check(value&&typeof value==='object'&&Object.getPrototypeOf(value)===Object.prototype,'NORMAL_GUARD_WIRE_TYPE');return '{'+Object.keys(value).sort().map(k=>wireCanonical(k,depth+1)+':'+wireCanonical(value[k],depth+1)).join(',')+'}';
}
export function bindingOf(connection){const route=Object.fromEntries(['computer_id','agent_id','project_id','session_id'].map(k=>[k,connection[k]]));return hash(wireCanonical({base:connection.base_url.replace(/\/$/,''),owner:connection.owner_id,producer:connection.producer_id,server:connection.server_id,route}));}
export function fingerprintOf(request){const body={...request.body};delete body.state;return hash(wireCanonical({request_id:request.object_id,revision:request.revision,expires_at:request.expires_at,body}));}
function command(executable,args,{timeout=15000,max=1048576}={}){return new Promise(resolve=>{let out='',err='',ended=false,timer;const child=spawn(executable,args,{cwd:workspace,windowsHide:true,stdio:['ignore','pipe','pipe']});const finish=(code,failed=false)=>{if(ended)return;ended=true;clearTimeout(timer);resolve({code,failed,out,err});};for(const [stream,key]of [[child.stdout,'out'],[child.stderr,'err']])stream.on('data',b=>{if(out.length+err.length+b.length>max){child.kill();finish(null,true);return;}if(key==='out')out+=b.toString('utf8');else err+=b.toString('utf8');});child.on('error',()=>finish(null,true));child.on('close',code=>finish(code));timer=setTimeout(()=>{child.kill();finish(null,true);},timeout);});}
let serial='',control=null,controlFile=null,operationOwned=false,activeAction=null;
const phoneRaw=(args,options)=>command(adb,['-s',serial,...args],options);
async function phone(args,options){const r=await phoneRaw(args,options);check(!r.failed&&r.code===0,'ADB_OPERATION_UNCONFIRMED');return r.out;}
function readTarget(){const target=json(inside(targetFile,privateRoot));check(typeof target.serial==='string'&&/^[A-Za-z0-9._:-]{1,128}$/.test(target.serial),'ADB_TARGET_INVALID');serial=target.serial;return hash(bytes(targetFile));}
async function installedHash(name){const location=(await phone(['shell','pm','path',name])).trim();check(/^package:(\/data\/app\/[A-Za-z0-9._~=/+-]+\/base\.apk)$/.test(location),'CANDIDATE_DEVICE_PATH_INVALID');const value=(await phone(['shell','sha256sum',location.slice(8)],{timeout:30000})).trim().split(/\s+/)[0];check(/^[a-f0-9]{64}$/.test(value),'CANDIDATE_DEVICE_HASH_INVALID');return value;}
async function verifyBuild(){
 const candidate=json(path.join(root,'candidate.json'));check(candidate.schema===1&&candidate.version===expected.version&&candidate.version_code===expected.code&&candidate.signer_sha256===expected.signer&&candidate.signature_v2===true&&candidate.signature_v3===true,'CANDIDATE_IDENTITY_MISMATCH');
 const apk=inside(path.resolve(root,candidate.apk||''),path.join(root,'artifacts')),driverApk=inside(path.join(root,'build/emulator-input/emulator-input.apk'),path.join(root,'build'));
 check(fs.statSync(apk).size===candidate.bytes&&await fileHash(apk)===candidate.sha256,'CANDIDATE_HASH_MISMATCH');check(fs.statSync(driverApk).size>0&&fs.statSync(driverApk).size<16777216,'DRIVER_FILE_INVALID');
 const aapt=path.join(buildTools,'aapt2.exe');for(const [file,pattern]of [[apk,/^package: name='com\.rayneo\.venus\.pub' versionCode='10423' versionName='0\.5\.3-dev1'/m],[driverApk,/^package: name='com\.turboio\.androidtests' versionCode='1' versionName='1'/m]]){const r=await command(aapt,['dump','badging',file]);check(!r.failed&&r.code===0&&pattern.test(r.out),'CANDIDATE_PACKAGE_MISMATCH');const sign=await command('java',['-Duser.language=en','-Duser.country=US','-jar',path.join(buildTools,'lib/apksigner.jar'),'verify','--min-sdk-version','24','--verbose','--print-certs',file],{timeout:30000});const digests=[...sign.out.matchAll(/Signer #\d+ certificate SHA-256 digest: ([a-f0-9]{64})/gi)].map(m=>m[1].toLowerCase());check(!sign.failed&&sign.code===0&&/Verified using v2 scheme.*true/.test(sign.out)&&digests.length===1&&digests[0]===expected.signer,'DRIVER_SIGNATURE_UNCONFIRMED');}
 const manifest=await command(aapt,['dump','xmltree',driverApk,'--file','AndroidManifest.xml']);check(!manifest.failed&&manifest.code===0&&manifest.out.split(/\r?\n/).filter(l=>/android:label\(0x01010001\)="iO Agent UI test driver"/.test(l)).length===1,'DRIVER_LABEL_MISMATCH');const entries=manifest.out.split(/\bE: instrumentation \(line=\d+\)/).slice(1).filter(e=>e.includes('="'+driver+'.NormalVoiceGuardProbe"'));check(entries.length===1&&entries[0].includes('android:targetPackage(0x01010021)="'+pkg+'"'),'DRIVER_INSTRUMENTATION_MISMATCH');
 const version=await phone(['shell','dumpsys','package',pkg]);check(/versionCode=10423\b/.test(version)&&/versionName=0\.5\.3-dev1(?:\r?\n|\s|$)/.test(version),'CANDIDATE_NOT_INSTALLED');check(await installedHash(pkg)===candidate.sha256,'CANDIDATE_DEVICE_HASH_MISMATCH');return {apk:driverApk,production_sha256:candidate.sha256,driver_sha256:await fileHash(driverApk)};
}
const nodes=xml=>[...xml.matchAll(/<node\b[^>]+/g)].map(m=>Object.fromEntries([...m[0].matchAll(/([\w-]+)="([^"]*)"/g)].map(a=>[a[1],a[2]])));
async function installDriver(apk){
 const prior=await phoneRaw(['shell','pm','path',driver]);check(!prior.failed&&[0,1].includes(prior.code)&&!/^package:/m.test(prior.out),'DRIVER_ALREADY_PRESENT');await phone(['shell','input','keyevent','KEYCODE_WAKEUP']);await phone(['shell','wm','dismiss-keyguard']);await phone(['shell','cmd','statusbar','collapse']);
 let ended=false,output='',failed=false;const child=spawn(adb,['-s',serial,'install','-r',apk],{cwd:workspace,windowsHide:true,stdio:['ignore','pipe','pipe']});const done=new Promise(resolve=>{for(const stream of [child.stdout,child.stderr])stream.on('data',b=>{if(output.length<32768)output+=b.toString('utf8');});child.on('error',()=>{failed=true;ended=true;resolve(null);});child.on('close',code=>{ended=true;resolve(code);});});const timer=setTimeout(()=>{failed=true;child.kill();},30000),ui='/data/local/tmp/io-agent-normal-install-'+control.probe_id+'.xml';
 try{while(!ended){await pause(600);if(ended)break;try{await phone(['shell','uiautomator','dump',ui],{timeout:6000});const window=nodes(await phone(['exec-out','cat',ui],{timeout:3000})).filter(n=>n.package==='com.miui.securitycenter');if(window.some(n=>n.text===label)){const buttons=window.filter(n=>n.text==='继续安装'&&n.enabled==='true'&&n.clickable==='true'&&/^\[\d+,\d+\]\[\d+,\d+\]$/.test(n.bounds||''));if(buttons.length===1){const b=buttons[0].bounds.match(/\d+/g).map(Number);check(b[2]>b[0]&&b[3]>b[1],'DRIVER_INSTALL_CONTROL_INVALID');await phone(['shell','input','tap',String(Math.floor((b[0]+b[2])/2)),String(Math.floor((b[1]+b[3])/2))],{timeout:3000});}}}catch{/* The installer still must return Success and match the exact APK. */}finally{await phoneRaw(['shell','rm','-f',ui],{timeout:3000});}}const code=await done;check(!failed&&code===0&&/\bSuccess\b/.test(output),'DRIVER_INSTALL_UNCONFIRMED');}finally{clearTimeout(timer);}
 check(await installedHash(driver)===control.driver_sha256,'DRIVER_INSTALLED_HASH_MISMATCH');control.driver_installed=true;persist();
}
function persist(){control.updated_at=new Date().toISOString();atomic(controlFile,control);}
function instrumentResult(text,nonce,abi=false){
 const fields=Object.fromEntries([...text.matchAll(/^INSTRUMENTATION_RESULT: ([A-Za-z_]+)=(.*)$/gm)].map(m=>[m[1],m[2].trim()]));
 check(/^INSTRUMENTATION_CODE: -1\s*$/m.test(text)&&fields.probe_id===nonce,'NORMAL_GUARD_INSTRUMENTATION_TERMINAL_UNCONFIRMED');
 if(abi)check(fields.abi_verified==='true'&&fields.sdk_methods_called==='false'&&fields.microphone_started==='false'&&fields.task_or_answer_submitted==='false'&&fields.control_endpoint_opened==='false','NORMAL_GUARD_ABI_UNCONFIRMED');
 else check(fields.safe_to_disarm==='true'&&fields.guard_started_microphone==='false'&&fields.guard_submitted_answer==='false'&&fields.readiness_created==='false'&&fields.original_attempt_only==='true'&&fields.error==='','NORMAL_GUARD_SAFE_TERMINAL_UNCONFIRMED');
}
export function statusMetadata(raw,nonce){
 check(raw?.schema===1&&raw.probe_id===nonce&&raw.mode==='capture','NORMAL_GUARD_STATUS_OWNER_INVALID');const out={schema:1,probe_id:nonce,mode:'capture'};
 for(const k of ['bound','watchdog_ack','armed','stop_requested','safe_to_disarm','guard_deadline_set','stop_accepted','device_idle_verified','native_start_attempted','native_stopped_verified','native_released','recording_released','coordinator_released','answer_ready','original_request_matches','original_task_matches','original_revision_matches','original_fingerprint_matches','original_route_matches','transcript_all_segments_final','expected_preview_retained','expected_no_file_change_retained','expected_keep_materials_retained','expected_friday_retained','readiness_created','guard_task_or_answer_submitted','submission_verified_by_guard','controlled_ui_only','synthetic_only_claimed','capture_audio_may_include_environment'])if(typeof raw[k]==='boolean')out[k]=raw[k];
 for(const k of ['sequence','stop_command_count','audio_frames','asr_pcm_bytes','transcript_segment_count','transcript_codepoints'])if(Number.isSafeInteger(raw[k])&&raw[k]>=0)out[k]=raw[k];
 if(/^[A-Z_]{1,48}$/.test(raw.phase||''))out.phase=raw.phase;
 if(raw.error===''||/^NORMAL_VOICE_[A-Z_]{1,64}$/.test(raw.error||''))out.error=raw.error;
 if(/^[a-f0-9]{32}$/.test(raw.evidence_id||''))out.evidence_id=raw.evidence_id;if(/^[a-f0-9]{64}$/.test(raw.transcript_sha256||''))out.transcript_sha256=raw.transcript_sha256;return out;
}
export function startAdmission(s,afterPing=false){return s?.bound===true&&s.phase==='PREPARED'&&s.armed===false&&s.stop_requested===false&&s.safe_to_disarm===false&&s.error===''&&s.guard_task_or_answer_submitted===false&&s.readiness_created===false&&s.watchdog_ack===afterPing&&s.guard_deadline_set===afterPing;}
export function placementAdmission(proof,source,now){return proof?.schema===1&&proof.source_placement_confirmed===true&&proof.source_pcm_sha256===source.pcm_sha256&&proof.source_wav_sha256===source.wav_sha256&&Number.isSafeInteger(proof.expires_at)&&proof.expires_at>now+90000&&proof.expires_at<=now+3600000;}
export function completedCapture(s){return s?.armed===true&&s.answer_ready===true&&s.native_start_attempted===true&&s.audio_frames>0&&s.asr_pcm_bytes>0&&s.transcript_all_segments_final===true&&/^[a-f0-9]{64}$/.test(s.transcript_sha256||'')&&['original_request_matches','original_task_matches','original_revision_matches','original_fingerprint_matches','original_route_matches','expected_preview_retained','expected_no_file_change_retained','expected_keep_materials_retained','expected_friday_retained'].every(k=>s[k]===true);}
// Actual orchestration is exported for offline fake-port tests. Production ports
// below do the file/phone work. No model turn or TTS runs inside this sequence.
export async function driveNormalVoiceCapture(p){
 let latest=null,played=false,done=false,error='',deadline=0,lastStop=-Infinity;
 const stop=async()=>{lastStop=p.now();try{await p.stop();}catch{}};
 try{
  await p.preload();deadline=p.now()+47000;await p.arm();
  latest=await p.status();check(startAdmission(latest,true),'NORMAL_GUARD_START_NOT_READY');await p.click();
  while(p.now()<deadline){
   if(played&&!done&&await p.done()){done=true;await stop();}
   latest=await p.status();if(p.safe(latest))break;
   check(latest.error==='','NORMAL_GUARD_PHONE_FAILED');check(p.guardAlive(),'NORMAL_GUARD_WATCHDOG_EXITED');
   check(!p.playerFailed(),'NORMAL_GUARD_PLAYBACK_FAILED');
   if(!played&&latest.audio_frames>0){await p.play();played=true;}
   await p.pause(150);
  }
  if(!p.safe(latest))throw Error('NORMAL_GUARD_NEEDS_PHYSICAL_STOP');
  check(played&&done&&completedCapture(latest),'NORMAL_GUARD_CAPTURE_INCOMPLETE');
 }catch(e){error=safeError(e);await stop();
  // Never allocate a fresh capture window on failure. Continue bounded stop
  // observation, while the independent watchdog remains live after we return.
  if(!deadline)deadline=p.now()+5000;
  while(!p.safe(latest)&&p.now()<deadline){try{latest=await p.status();}catch{}if(p.safe(latest))break;if(p.now()-lastStop>=1500)await stop();await p.pause(200);}
 }
 return {safe:p.safe(latest),status:latest,playback_started:played,playback_completed:done,error,passed:!error&&p.safe(latest)&&played&&done&&completedCapture(latest)};
}
const status=async op=>statusMetadata(await recordingRequest(control.port,control.probe_id,op),control.probe_id);
const safe=s=>safeRecordingStatus(s,control.probe_id,'capture')&&s.bound===true&&s.error===''&&s.readiness_created===false&&s.guard_task_or_answer_submitted===false;
function verifyControl(file){
 controlFile=inside(path.resolve(file),privateRoot);check(path.basename(controlFile)==='control.json','NORMAL_GUARD_SESSION_INVALID');control=json(controlFile);check(control.schema===1&&/^[a-f0-9]{32}$/.test(control.probe_id||'')&&path.dirname(controlFile)===path.join(privateRoot,'normal-voice-'+control.probe_id)&&control.component===component&&control.capture_implemented===true,'NORMAL_GUARD_SESSION_INVALID');
 check(control.target_sha256===readTarget(),'ADB_TARGET_CHANGED');inside(control.scope_file,root);check(hash(bytes(control.scope_file))===control.scope_sha256,'NORMAL_GUARD_SCOPE_CHANGED');check(wireCanonical(sourceHashes())===wireCanonical(control.source_sha256),'NORMAL_GUARD_SOURCE_CHANGED');check(Number.isInteger(control.port)&&control.port>0&&control.port<=65535,'NORMAL_GUARD_PORT_INVALID');
 const lease=json(inside(leaseFile,privateRoot));check(lease.probe_id===control.probe_id&&lease.session===controlFile,'NORMAL_GUARD_LEASE_CHANGED');
}
async function verifyForward(){const listing=await phone(['forward','--list']);const matches=listing.split(/\r?\n/).map(line=>line.trim().split(/\s+/)).filter(p=>p[0]===serial&&p[1]==='tcp:'+control.port);check(matches.length===1&&matches[0][2]==='localabstract:io-agent-normal-voice-'+control.probe_id,'NORMAL_GUARD_FORWARD_CHANGED');}
function acquireOperation(){const file=path.join(path.dirname(controlFile),'operation.lock');noLinks(path.dirname(file));fs.writeFileSync(file,JSON.stringify({probe_id:control.probe_id,pid:process.pid}),{flag:'wx',mode:0o600});operationOwned=true;}
function releaseOperation(){if(!operationOwned)return;const file=path.join(path.dirname(controlFile),'operation.lock');check(json(file).probe_id===control.probe_id,'NORMAL_GUARD_OPERATION_CHANGED');fs.unlinkSync(file);operationOwned=false;}
async function prepare(options){
 check(/^voice[0-9]{3}-[a-z0-9-]{1,40}$/.test(options.runId||'')&&['codex','hermes','qa'].includes(options.context),'NORMAL_GUARD_ARGUMENT_INVALID');
 const scopeFile=inside(options.scopeFile||path.join(root,'normal-voice-scope-2026-10-22.json'),root),scope=json(scopeFile),owner='synthetic-cloud-'+options.runId;
 check(scope.schema===1&&scope.kind==='normal-voice-synthetic-routing'&&scope.run_id===options.runId&&scope.owner_id===owner&&scope.destination==='https://cznbnb.cn/io-api/v1/','NORMAL_GUARD_SYNTHETIC_SCOPE_REQUIRED');
 const run=inside(path.join(workspace,'rebuild/agent-bridge/private/cloud-'+options.runId),path.join(workspace,'rebuild/agent-bridge/private')),bundle=json(path.join(run,'bundle.json')),plan=json(path.join(run,'context-check.json')),connectionFile=inside(path.join(run,'connection-'+options.context+'.json'),run),connection=json(connectionFile,8192);
 check(bundle.run_id===scope.run_id&&bundle.agent?.owner_id===owner&&bundle.phone?.owner_id===owner&&bundle.agent.base_url===scope.destination&&bundle.phone.base_url===scope.destination&&bundle.phone.producer_id==='cloud-phone','NORMAL_GUARD_OWNER_MISMATCH');
 check(plan.run_id===scope.run_id&&Array.isArray(plan.contexts)&&plan.contexts.length===3,'NORMAL_GUARD_PLAN_MISMATCH');const contexts=plan.contexts.filter(c=>c.key===options.context);check(contexts.length===1,'NORMAL_GUARD_CONTEXT_MISMATCH');const context=contexts[0],route=Object.fromEntries(['computer_id','agent_id','project_id','session_id'].map(k=>[k,connection[k]]));
 check(connection.format==='turboio-task-connection/1'&&connection.owner_id===owner&&connection.producer_id===bundle.phone.producer_id&&connection.server_id===bundle.phone.server_id&&connection.base_url===scope.destination&&Date.parse(connection.expires_at)>Date.now()+120000&&wireCanonical(route)===wireCanonical(context.route),'NORMAL_GUARD_CONNECTION_MISMATCH');
 inside(bundle.agent.credential_file,run);check(!fs.existsSync(leaseFile)&&!fs.existsSync(path.join(privateRoot,'recording-probe-runner.lock')),'NORMAL_GUARD_OTHER_SESSION_PRESENT');
 const targetHash=readTarget();const build=await verifyBuild();const existing=await phoneRaw(['shell','pm','path',driver]);check(!existing.failed&&[0,1].includes(existing.code)&&!/^package:/m.test(existing.out),'DRIVER_ALREADY_PRESENT');
 // Real read-only BridgeClient binds identity before fetching exactly this request.
 const request=await new BridgeClient(bundle.agent).object('request',context.request_id);check(request.object_id===context.request_id&&request.body.task_id===context.task_id&&['pending','presented'].includes(request.state)&&!request.answer&&Number.isSafeInteger(request.revision)&&request.revision>0&&Date.parse(request.expires_at)>Date.now()+120000&&wireCanonical(request.body.route)===wireCanonical(context.route),'NORMAL_GUARD_ORIGINAL_REQUEST_INVALID');
 const nonce=crypto.randomBytes(16).toString('hex'),session=path.join(privateRoot,'normal-voice-'+nonce);noLinks(privateRoot);fs.mkdirSync(session,{mode:0o700});controlFile=path.join(session,'control.json');
 control={schema:1,probe_id:nonce,created_at:new Date().toISOString(),component,run_id:options.runId,context:options.context,scope_file:scopeFile,scope_sha256:hash(bytes(scopeFile)),target_sha256:targetHash,source_sha256:sourceHashes(),production_sha256:build.production_sha256,driver_sha256:build.driver_sha256,driver_apk:build.apk,connection_file:connectionFile,connection_sha256:hash(bytes(connectionFile)),binding:bindingOf(connection),request_id:context.request_id,request_revision:request.revision,request_fingerprint:fingerprintOf(request),original_request_sha256:hash(wireCanonical(request)),state:'PREPARING',port:null,instrumentation_pid:null,driver_installed:false,instrumentation_started:false,capture_implemented:true,capture_attempted:false,capture_started:false,guard_armed:false,journal_and_audio_retained:true};persist();
 fs.writeFileSync(leaseFile,JSON.stringify({schema:1,probe_id:nonce,session:controlFile}),{flag:'wx',mode:0o600});acquireOperation();
 await installDriver(build.apk);
 const abi=await phoneRaw(['shell','am','instrument','-w','-e','probe_id',nonce,'-e','abi_only','true',component],{timeout:20000,max:32768});check(!abi.failed&&abi.code===0,'NORMAL_GUARD_ABI_UNCONFIRMED');instrumentResult(abi.out,nonce,true);control.abi_verified=true;persist();
 // Never overwrite a different import left by another owner.
 const importExists=await phoneRaw(['shell','test','-e',external]);check(!importExists.failed&&[0,1].includes(importExists.code),'NORMAL_GUARD_IMPORT_UNCONFIRMED');
 if(importExists.code===0)check((await phone(['shell','sha256sum',external])).trim().split(/\s+/)[0]===control.connection_sha256,'NORMAL_GUARD_IMPORT_CONFLICT');
 else{await phone(['shell','mkdir','-p',path.posix.dirname(external)]);const temp=external+'.'+nonce+'.partial';await phone(['push',connectionFile,temp]);check((await phone(['shell','sha256sum',temp])).trim().split(/\s+/)[0]===control.connection_sha256,'NORMAL_GUARD_IMPORT_HASH_MISMATCH');await phone(['shell','mv','-n',temp,external]);check((await phone(['shell','sha256sum',external])).trim().split(/\s+/)[0]===control.connection_sha256,'NORMAL_GUARD_IMPORT_HASH_MISMATCH');}
 const allocated=(await phone(['forward','tcp:0','localabstract:io-agent-normal-voice-'+nonce])).trim();check(/^\d{1,5}$/.test(allocated)&&+allocated>0&&+allocated<=65535,'NORMAL_GUARD_FORWARD_INVALID');control.port=+allocated;persist();
 const log=path.join(session,'instrumentation.log'),fd=fs.openSync(log,'wx',0o600);let child;
 try{child=spawn(adb,['-s',serial,'shell','am','instrument','-w','-e','probe_id',nonce,'-e','binding',control.binding,'-e','request_id',control.request_id,'-e','request_revision',String(control.request_revision),'-e','request_fingerprint',control.request_fingerprint,component],{cwd:workspace,windowsHide:true,detached:true,stdio:['ignore',fd,fd]});await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',()=>reject(Error('NORMAL_GUARD_INSTRUMENTATION_SPAWN_FAILED')));});}finally{fs.closeSync(fd);}
 control.instrumentation_pid=child.pid;control.instrumentation_started=true;control.state='WAITING_FOR_ORIGINAL_QUESTION';persist();child.on('error',()=>{/* Socket/terminal proof remains mandatory; never infer stop from a process error. */});child.unref();
 await pause(300);await phone(['shell','am','start','-n',pkg+'/com.rayneo.venus.MainActivity'],{timeout:5000});
 let latest=null;const until=Date.now()+20000;while(Date.now()<until){try{latest=await status('status');if(latest.phase!=='WAITING_FOR_HOST')break;}catch{}await pause(250);}
 control.last_status=latest;control.state=latest?'PREPARED_OBSERVER':'ENDPOINT_UNCONFIRMED';persist();check(latest&&latest.error==='','NORMAL_GUARD_ENDPOINT_UNCONFIRMED');
 return {prepared:true,session:controlFile,bound:latest.bound===true,status:latest,capture_implemented:true,instrumentation_retained:true};
}
function sourceEvidence(){
 const record=json(path.join(root,'asr-synthetic-source-2026-10-21.json')),directory=path.join(privateRoot,'phone-r4-source-2026-10-21');
 const wavPath=inside(path.join(directory,'official-asr-synthetic-direct.wav'),privateRoot),pcmPath=inside(path.join(directory,'official-asr-synthetic.pcm'),privateRoot),wav=bytes(wavPath,2097152),pcm=bytes(pcmPath,480000);
 check(record.schema===1&&record.rate===16000&&record.channels===1&&record.bits===16&&record.pcm_bytes===pcm.length&&pcm.length%2===0&&hash(pcm)===record.pcm_sha256&&hash(wav)===record.wav_sha256,'NORMAL_GUARD_SOURCE_HASH_MISMATCH');
 check(wav.length>=44&&wav.toString('ascii',0,4)==='RIFF'&&wav.toString('ascii',8,12)==='WAVE'&&wav.readUInt32LE(4)+8===wav.length,'NORMAL_GUARD_WAV_INVALID');
 let format=null,data=null,offset=12;while(offset+8<=wav.length){const kind=wav.toString('ascii',offset,offset+4),length=wav.readUInt32LE(offset+4);check(offset+8+length<=wav.length,'NORMAL_GUARD_WAV_INVALID');if(kind==='fmt '){check(!format&&length>=16,'NORMAL_GUARD_WAV_INVALID');format=wav.subarray(offset+8,offset+8+length);}if(kind==='data'){check(!data,'NORMAL_GUARD_WAV_INVALID');data=wav.subarray(offset+8,offset+8+length);}offset+=8+length+(length%2);}
 check(offset===wav.length&&format&&data&&format.readUInt16LE(0)===1&&format.readUInt16LE(2)===1&&format.readUInt32LE(4)===16000&&format.readUInt16LE(14)===16&&data.equals(pcm),'NORMAL_GUARD_WAV_PCM_MISMATCH');
 let nonzero=0,peak=0;for(let i=0;i<pcm.length;i+=2){const n=pcm.readInt16LE(i);if(n!==0)nonzero++;peak=Math.max(peak,Math.abs(n));}check(nonzero===record.nonzero_samples&&nonzero>16000&&peak===record.peak&&peak>0&&pcm.length/32000===record.duration_seconds&&record.duration_seconds>=8&&record.duration_seconds<9,'NORMAL_GUARD_SOURCE_SIGNAL_INVALID');
 return {wavPath,pcmPath,wav_sha256:record.wav_sha256,pcm_sha256:record.pcm_sha256,duration_seconds:record.duration_seconds,pcm_bytes:pcm.length};
}
function placementEvidence(file,source){const full=inside(path.resolve(file),privateRoot),data=bytes(full,4096),proof=JSON.parse(data.toString('utf8').replace(/^\uFEFF/,''));check(placementAdmission(proof,source,Date.now())&&fs.statSync(full).mtimeMs>=Date.parse(control.created_at),'NORMAL_GUARD_PLACEMENT_INVALID');return {file:full,sha256:hash(data),expires_at:proof.expires_at};}
function background(executable,args,{ipc=false,detached=true}={}){
 const child=spawn(executable,args,{cwd:workspace,windowsHide:true,detached,stdio:ipc?['ignore','ignore','ignore','ipc']:'ignore'}),state={pid:null,spawned:false,exited:false,failed:false,exit_code:null};
 const ready=new Promise((resolve,reject)=>{child.once('spawn',()=>{state.pid=child.pid;state.spawned=true;resolve();});child.once('error',()=>{state.failed=true;state.exited=true;reject(Error('NORMAL_GUARD_CHILD_SPAWN_FAILED'));});});
 child.on('error',()=>{state.failed=true;state.exited=true;});child.on('exit',code=>{state.exited=true;state.exit_code=Number.isInteger(code)?code:null;});return {child,state,ready};
}
async function capture(placementPath){
 check(control.instrumentation_started===true&&control.abi_verified===true&&control.capture_attempted===false&&control.capture_started===false&&!control.instrumentation_finished&&!control.forward_removed&&!control.driver_removed,'NORMAL_GUARD_CAPTURE_ONCE_REQUIRED');
 const build=await verifyBuild();check(build.production_sha256===control.production_sha256&&build.driver_sha256===control.driver_sha256&&await installedHash(driver)===control.driver_sha256,'DRIVER_FILE_CHANGED');await verifyForward();
 check(hash(bytes(inside(control.connection_file,path.join(workspace,'rebuild/agent-bridge/private'))))===control.connection_sha256,'NORMAL_GUARD_CONNECTION_CHANGED');check(startAdmission(await status('status')),'NORMAL_GUARD_ORIGINAL_PREPARED_REQUIRED');
 const source=sourceEvidence(),placement=placementEvidence(placementPath,source),session=path.dirname(controlFile),readyFile=path.join(session,'playback-ready'),playFile=path.join(session,'playback-start'),doneFile=path.join(session,'playback-done'),guardReport=path.join(session,'watchdog.json');
 for(const file of [readyFile,playFile,doneFile,guardReport,guardReport+'.partial'])check(!fs.existsSync(file),'NORMAL_GUARD_CAPTURE_ONCE_REQUIRED');
 control.capture_attempted=true;control.capture_source={pcm_sha256:source.pcm_sha256,wav_sha256:source.wav_sha256,pcm_bytes:source.pcm_bytes,duration_seconds:source.duration_seconds};control.placement_proof=placement;control.state='CAPTURE_RESERVED';persist();
 let player=null,watchdog=null,guardArmed=false,guardAck=false,guardBegan=0,result=null;const events=[];
 const remember=event=>{if(events.length<128)events.push(event);};
 const placementStillValid=()=>{const again=placementEvidence(placement.file,source);check(again.sha256===placement.sha256,'NORMAL_GUARD_PLACEMENT_CHANGED');};
 try{
  result=await driveNormalVoiceCapture({now:Date.now,pause,status:()=>status('status'),stop:()=>status('stop'),safe,
   async preload(){
    placementStillValid();check(hash(bytes(source.wavPath,2097152))===source.wav_sha256&&hash(bytes(source.pcmPath,480000))===source.pcm_sha256,'NORMAL_GUARD_SOURCE_CHANGED');
    const quote=v=>"'"+v.replaceAll("'","''")+"'";
    const script=`$ErrorActionPreference='Stop'; try { $ioNormalVoicePlayer=New-Object System.Media.SoundPlayer(${quote(source.wavPath)}); $ioNormalVoicePlayer.Load(); [IO.File]::WriteAllText(${quote(readyFile)},'READY'); $ioNormalVoiceUntil=[DateTime]::UtcNow.AddSeconds(60); while(-not [IO.File]::Exists(${quote(playFile)})){if([DateTime]::UtcNow -gt $ioNormalVoiceUntil){exit 3}; Start-Sleep -Milliseconds 50}; $ioNormalVoicePlayer.PlaySync(); [IO.File]::WriteAllText(${quote(doneFile)},'DONE'); $ioNormalVoicePlayer.Dispose(); exit 0 } catch { exit 2 }`;
    // PowerShell must not use detached:true: that mode can silently skip Load.
    player=background('powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{detached:false});await player.ready;
    const until=Date.now()+8000;while(Date.now()<until){if(fs.existsSync(readyFile)&&bytes(readyFile,16).toString()==='READY'){control.playback_preloaded=true;control.playback_pid=player.state.pid;persist();return;}check(!player.state.exited,'NORMAL_GUARD_PLAYBACK_PRELOAD_FAILED');await pause(100);}throw Error('NORMAL_GUARD_PLAYBACK_PRELOAD_UNCONFIRMED');
   },
   async arm(){
    check(player&&!player.state.exited&&control.playback_preloaded,'NORMAL_GUARD_PLAYBACK_NOT_READY');placementStillValid();check(startAdmission(await status('status')),'NORMAL_GUARD_ORIGINAL_PREPARED_REQUIRED');guardBegan=Date.now();
    watchdog=background(process.execPath,[path.join(workspace,'tools/android/recording-watchdog.mjs'),JSON.stringify({port:control.port,probeId:control.probe_id,mode:'capture',report:guardReport,deadlineMs:20000})],{ipc:true,detached:true});
    watchdog.child.on('message',event=>{if(event?.probe_id!==control.probe_id||event.mode!=='capture')return;if(event.event==='armed')guardArmed=true;if(event.event==='safe_disarmed')guardAck=true;if(['starting','armed','deadline_reached','needs_physical_stop','safe_disarmed','not_armed'].includes(event.event))remember({event:event.event,elapsed_ms:Number.isSafeInteger(event.elapsed_ms)?event.elapsed_ms:null});});
    await watchdog.ready;control.watchdog_pid=watchdog.state.pid;control.watchdog_started_at=new Date(guardBegan).toISOString();persist();
    const until=guardBegan+7000;while(Date.now()<until){check(!watchdog.state.exited,'NORMAL_GUARD_WATCHDOG_EXITED');if(guardArmed){const s=await status('status');check(startAdmission(s,true),'NORMAL_GUARD_REAL_PING_UNCONFIRMED');control.guard_armed=true;persist();return;}await pause(50);}throw Error('NORMAL_GUARD_REAL_PING_UNCONFIRMED');
   },
   async click(){
    check(guardArmed&&watchdog&&!watchdog.state.exited&&player&&!player.state.exited,'NORMAL_GUARD_GUARD_NOT_LIVE');placementStillValid();check(control.target_sha256===readTarget()&&hash(bytes(control.scope_file))===control.scope_sha256&&wireCanonical(sourceHashes())===wireCanonical(control.source_sha256),'NORMAL_GUARD_CAPTURE_SCOPE_CHANGED');
    const ui='/data/local/tmp/io-agent-normal-start-'+control.probe_id+'.xml';
    try{await phone(['shell','uiautomator','dump',ui],{timeout:4000});const xml=await phone(['exec-out','cat',ui],{timeout:1500,max:1048576}),window=nodes(xml);const buttons=window.filter(n=>n.package===pkg&&n.text==='开始用眼镜口述'&&n.enabled==='true'&&n.clickable==='true'&&/^\[\d+,\d+\]\[\d+,\d+\]$/.test(n.bounds||''));check(buttons.length===1&&window.some(n=>n.package===pkg&&n.text==='原问题语音回答'),'NORMAL_GUARD_START_CONTROL_UNCONFIRMED');const b=buttons[0].bounds.match(/\d+/g).map(Number);check(b[2]>b[0]&&b[3]>b[1],'NORMAL_GUARD_START_CONTROL_UNCONFIRMED');
     check(startAdmission(await status('status'),true),'NORMAL_GUARD_START_NOT_READY');control.capture_started=true;control.state='START_DISPATCH_RESERVED';persist();
     // Check AFTER all potentially slow reads/writes. A late click is forbidden;
     // this also reserves time for the complete preloaded eight-second source.
     check(Date.now()-guardBegan<9000&&!watchdog.state.exited&&!player.state.exited,'NORMAL_GUARD_START_DEADLINE_EXPIRED');placementStillValid();await phone(['shell','input','tap',String(Math.floor((b[0]+b[2])/2)),String(Math.floor((b[1]+b[3])/2))],{timeout:1500});remember({event:'normal_ui_start_dispatched'});
    }finally{await phoneRaw(['shell','rm','-f',ui],{timeout:1000});}
   },
   async play(){check(guardArmed&&player&&!player.state.exited&&watchdog&&!watchdog.state.exited,'NORMAL_GUARD_PLAYBACK_NOT_READY');fs.writeFileSync(playFile,'PLAY',{flag:'wx',mode:0o600});remember({event:'playback_released_after_audio_frames'});},
   async done(){return fs.existsSync(doneFile)&&bytes(doneFile,16).toString()==='DONE';},
   playerFailed(){return !player||player.state.failed||player.state.exited&&player.state.exit_code!==0;},
   guardAlive(){return watchdog&&!watchdog.state.exited&&!watchdog.state.failed;}
  });
  // No report or hash write is allowed to delay the first physical stop dispatch.
  if(!result.safe)try{await status('stop');}catch{}
  if(result.safe&&!guardAck&&watchdog){const until=Date.now()+1800;while(!guardAck&&!watchdog.state.exited&&Date.now()<until)await pause(100);}
  if(!guardAck&&fs.existsSync(guardReport))try{const r=json(guardReport);guardAck=r.probe_id===control.probe_id&&r.disarmed===true&&safeRecordingStatus(r.last,control.probe_id,'capture');}catch{}
  control.last_status=result.status;control.capture_result={...result,guard_real_ping_ack:guardArmed,guard_safe_ack:guardAck,server_answer_submitted:false,synthetic_only_claimed:false,capture_audio_may_include_environment:true};control.state=result.safe?'SAFE_CAPTURE_RETAINED':'NEEDS_PHYSICAL_STOP';control.error=result.error;persist();
  atomic(path.join(session,'capture-report.json'),{schema:1,probe_id:control.probe_id,...control.capture_result,events,player:player?.state||null,watchdog:watchdog?.state||null,instrumentation_retained:true,forward_retained:true,driver_retained:true,journal_and_audio_retained:true});
  return {capture_passed:result.passed,session:controlFile,status:result.status,error:result.error,guard_real_ping_ack:guardArmed,guard_safe_ack:guardAck,server_answer_submitted:false,instrumentation_retained:true,journal_and_audio_retained:true};
 }finally{
  // Stopping the speaker is permitted; never kill the independent stop owner.
  if(player&&!player.state.exited)player.child.kill();
  if(player)player.child.unref();
  if(watchdog){if(watchdog.child.connected)try{watchdog.child.disconnect();}catch{}watchdog.child.unref();}
 }
}
async function finish(){
 const build=await verifyBuild();check(build.production_sha256===control.production_sha256&&build.driver_sha256===control.driver_sha256,'DRIVER_FILE_CHANGED');
 const log=path.join(path.dirname(controlFile),'instrumentation.log');let last=control.last_status;
 if(!control.instrumentation_finished){
  check(await installedHash(driver)===control.driver_sha256,'DRIVER_INSTALLED_HASH_MISMATCH');await verifyForward();
  // A prior finish reply may have been lost. Only this nonce's actual successful
  // Instrumentation terminal plus the earlier verified safe state permits retry.
  let priorTerminal=false;if(safe(last))try{instrumentResult(bytes(log,65536).toString('utf8'),control.probe_id);priorTerminal=true;}catch{}
  if(!priorTerminal){last=await status('status');if(!safe(last)){await status('stop');const until=Date.now()+45000;while(Date.now()<until){last=await status('status');if(safe(last))break;await pause(250);}}
   check(safe(last),'NORMAL_GUARD_NEEDS_PHYSICAL_STOP');
   // Let the real independent child read this terminal before closing its
   // endpoint. Missing process/report is never substituted for a child ACK.
   if(control.watchdog_pid){let ack=false;const until=Date.now()+4000;while(Date.now()<until){try{const r=json(path.join(path.dirname(controlFile),'watchdog.json'));ack=r.probe_id===control.probe_id&&r.disarmed===true&&safe(statusMetadata(r.last,control.probe_id));}catch{}if(ack)break;await pause(100);}check(ack,'NORMAL_GUARD_WATCHDOG_TERMINAL_UNCONFIRMED');}
   control.last_status=last;control.state='STOPPED_AWAITING_FINISH';persist();const reply=await status('finish');check(safe(reply),'NORMAL_GUARD_FINISH_UNCONFIRMED');
   const until=Date.now()+10000;let confirmed=false;while(Date.now()<until){try{instrumentResult(bytes(log,65536).toString('utf8'),control.probe_id);confirmed=true;break;}catch{}await pause(200);}check(confirmed,'NORMAL_GUARD_INSTRUMENTATION_TERMINAL_UNCONFIRMED');
  }
  control.instrumentation_finished=true;persist();
 }
 check(safe(last),'NORMAL_GUARD_SAFE_TERMINAL_UNCONFIRMED');instrumentResult(bytes(log,65536).toString('utf8'),control.probe_id);
 if(!control.forward_removed){await verifyForward();await phone(['forward','--remove','tcp:'+control.port]);control.forward_removed=true;persist();}
 if(!control.driver_removed){const present=await phoneRaw(['shell','pm','path',driver]);check(!present.failed&&[0,1].includes(present.code),'DRIVER_CLEANUP_UNCONFIRMED');if(/^package:/m.test(present.out)){check(await installedHash(driver)===control.driver_sha256,'DRIVER_INSTALLED_HASH_MISMATCH');check(/\bSuccess\b/.test(await phone(['uninstall',driver],{timeout:30000})),'DRIVER_CLEANUP_UNCONFIRMED');}const remaining=await phoneRaw(['shell','pm','path',driver]);check(!remaining.failed&&[0,1].includes(remaining.code)&&!/^package:/m.test(remaining.out),'DRIVER_CLEANUP_UNCONFIRMED');control.driver_removed=true;persist();}
 await phone(['shell','am','start','-n',pkg+'/com.rayneo.venus.MainActivity']);control.state='FINISHED';persist();const lease=json(leaseFile);check(lease.probe_id===control.probe_id&&lease.session===controlFile,'NORMAL_GUARD_LEASE_CHANGED');fs.unlinkSync(leaseFile);return {finished:true,session:controlFile,status:last,journal_and_audio_retained:true};
}
async function main(){
 const options={},args=process.argv.slice(2);let action=null;for(let i=0;i<args.length;i++){const arg=args[i];if(['--prepare','--status','--capture','--finish'].includes(arg)){check(action===null,'NORMAL_GUARD_ARGUMENT_INVALID');action=arg;}else{const key={'--run-id':'runId','--context':'context','--scope-file':'scopeFile','--session':'session','--placement-proof':'placementProof'}[arg];check(key&&!options[key]&&args[i+1]&&!args[i+1].startsWith('--'),'NORMAL_GUARD_ARGUMENT_INVALID');options[key]=args[++i];}}
 check(action,'NORMAL_GUARD_ARGUMENT_INVALID');activeAction=action;
 if(action==='--prepare'){check(!options.session&&!options.placementProof,'NORMAL_GUARD_ARGUMENT_INVALID');return prepare(options);}
 check(options.session&&!options.runId&&!options.context&&!options.scopeFile&&(action==='--capture'?!!options.placementProof:!options.placementProof),'NORMAL_GUARD_ARGUMENT_INVALID');verifyControl(options.session);
 if(action==='--status')return {session:controlFile,status:await status('status'),capture_implemented:true};
 acquireOperation();return action==='--capture'?capture(options.placementProof):finish();
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 let output;try{output=await main();}catch(e){const error=safeError(e);
  // On a preparation failure dispatch stop before writing a report. Status is
  // strictly read-only; it never changes the guard or the persisted session.
  if(operationOwned&&['--prepare','--capture'].includes(activeAction)&&control?.instrumentation_started)try{control.last_status=await status('stop');}catch{}
  if(operationOwned&&activeAction!=='--status'&&control&&controlFile){try{control.error=error;control.state=control.instrumentation_started?'NEEDS_PHYSICAL_STOP_OR_TERMINAL_PROOF':'PREPARE_BLOCKED';persist();}catch{} }output={error,session:controlFile,instrumentation_retained:control?.instrumentation_started===true,unknown_stop_is_not_safe:true,capture_implemented:true};process.exitCode=2;}
 finally{try{releaseOperation();}catch{process.exitCode=2;}}
 // Unknown/preparation failures keep the lease/driver/forward for explicit
 // inspection. Never force-stop, kill the detached owner, or erase audio.
 if(output?.capture_passed===false)process.exitCode=2;console.log(JSON.stringify(output));
}
