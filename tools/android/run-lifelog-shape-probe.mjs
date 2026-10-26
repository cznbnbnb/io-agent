// Bounded in-process reader probe; exports only allowlisted field types/counts.
import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import {spawn,spawnSync} from 'node:child_process';
import {exe} from './host-tools.mjs';
const root=path.resolve('rebuild/android-app'),adb=path.join(root,'.tools/sdk/platform-tools',exe('adb')),pkg='com.rayneo.venus.pub',driver='com.turboio.androidtests';
const serial=JSON.parse(fs.readFileSync(path.join(root,'.private/phone-login-install-2026-10-20/verified-target.json'),'utf8')).serial;
const apk=path.join(root,'build/emulator-input/emulator-input.apk'),output='/sdcard/Android/data/'+pkg+'/files/io-agent-lifelog-log-shape.json',nonce=crypto.randomBytes(16).toString('hex');
const gatewayDetail=process.argv.includes('--gateway-detail');
const gatewayRead=process.argv.includes('--gateway-read')||gatewayDetail;
const gatewayCanonical=process.argv.includes('--gateway-canonical');
const dev3=process.argv.includes('--material-dev3');
const dev4=process.argv.includes('--material-dev4');
const dev5=process.argv.includes('--material-dev5');
const dev6=process.argv.includes('--material-dev6');
const voiceDev1=process.argv.includes('--voice-dev1');
const monthDev2=process.argv.includes('--month-dev2');
const beforeMonthDev2=process.argv.includes('--before-month-dev2');
const gatewayHeaderShape=process.argv.includes('--gateway-header-shape');
if(gatewayHeaderShape&&!voiceDev1)throw Error('HEADER_SHAPE_REQUIRES_VOICE_DEV1');
const calendarReadIndex=process.argv.indexOf('--calendar-read'),calendarRead=calendarReadIndex>=0,calendarMonth=calendarRead?process.argv[calendarReadIndex+1]:'';
if(calendarRead&&(!voiceDev1||!process.argv.includes('--apply')||!/^[0-9]{4}-(?:0[1-9]|1[0-2])$/.test(calendarMonth||'')))throw Error('EXPLICIT_SINGLE_MONTH_READ_REQUIRED');
const archiveIndex=process.argv.indexOf('--recording-archive'),recordingArchive=archiveIndex>=0,archiveAttempt=recordingArchive?process.argv[archiveIndex+1]:'';
if(recordingArchive&&(!voiceDev1||!/^[a-f0-9]{32}$/.test(archiveAttempt||'')))throw Error('ARCHIVE_PROBE_SCOPE_INVALID');
const officialMetadata=process.argv.includes('--official-metadata');
const inventoryDiscovery=process.argv.includes('--inventory-discovery');
const inventoryCache=process.argv.includes('--inventory-cache');
const inventoryRemaining=process.argv.includes('--inventory-remaining');
const inventory=process.argv.includes('--inventory-read')||inventoryRemaining||inventoryCache||inventoryDiscovery;
if(inventory&&!dev5)throw Error('INVENTORY_REQUIRES_DEV5');
const refreshRead=process.argv.includes('--refresh-read');
const accountOnly=process.argv.includes('--account-only'),materialSettings=process.argv.includes('--material-settings'),materialCloud=process.argv.includes('--material-cloud'),formalAudit=process.argv.includes('--formal-material-audit'),queueMigration=process.argv.includes('--queue-migration'),dev2=process.argv.includes('--material-dev2');
if((gatewayRead||gatewayCanonical)&&!dev2)throw Error('GATEWAY_REQUIRES_CURRENT_HOST');
if(dev2&&!formalAudit&&!gatewayCanonical&&!gatewayRead)throw Error('DEV2_PROBE_SCOPE_INVALID');
if(refreshRead&&!dev3)throw Error('REFRESH_READ_REQUIRES_DEV3');
if(dev3&&(!(formalAudit||refreshRead)||dev2||gatewayRead||gatewayCanonical))throw Error('DEV3_PROBE_SCOPE_INVALID');
if(dev4&&(!(formalAudit||queueMigration)||dev2||dev3||gatewayRead||gatewayCanonical||refreshRead))throw Error('DEV4_PROBE_SCOPE_INVALID');
if(dev5&&(!(formalAudit||inventory)||dev2||dev3||dev4||gatewayRead||gatewayCanonical||refreshRead||queueMigration))throw Error('DEV5_PROBE_SCOPE_INVALID');
if(dev6&&(!(formalAudit||officialMetadata)||dev2||dev3||dev4||dev5||inventory||gatewayRead||gatewayCanonical||refreshRead||queueMigration))throw Error('DEV6_PROBE_SCOPE_INVALID');
if(voiceDev1&&([formalAudit,recordingArchive,gatewayHeaderShape,calendarRead].filter(Boolean).length!==1||officialMetadata||dev2||dev3||dev4||dev5||dev6||inventory||gatewayRead||gatewayCanonical||refreshRead||queueMigration||materialSettings||materialCloud||accountOnly))throw Error('VOICE_DEV1_PROBE_SCOPE_INVALID');
if(monthDev2&&(!formalAudit||voiceDev1||recordingArchive||gatewayHeaderShape||calendarRead||officialMetadata||dev2||dev3||dev4||dev5||dev6||inventory||gatewayRead||gatewayCanonical||refreshRead||queueMigration||materialSettings||materialCloud||accountOnly))throw Error('MONTH_DEV2_PROBE_SCOPE_INVALID');
if(beforeMonthDev2&&(!voiceDev1||!formalAudit||monthDev2))throw Error('MONTH_BEFORE_PROBE_SCOPE_INVALID');
const expected=monthDev2?{code:10424,version:'0.5.3-dev2'}:voiceDev1?{code:10423,version:'0.5.3-dev1'}:dev6?{code:10422,version:'0.5.2-dev6'}:dev5?{code:10421,version:'0.5.2-dev5'}:dev4?{code:10420,version:'0.5.2-dev4'}:dev3?{code:10419,version:'0.5.2-dev3'}:dev2?{code:10418,version:'0.5.2-dev2'}:(materialSettings||materialCloud||formalAudit||queueMigration)?{code:10417,version:'0.5.2-dev1'}:{code:10416,version:'0.5.1-dev2'};
function call(args,timeout=15000){const r=spawnSync(adb,['-s',serial,...args],{encoding:'utf8',timeout,maxBuffer:1048576,windowsHide:true});if(r.error)throw Error('ADB_EXEC_'+(r.error.code||'FAILED'));return r;}
const version=call(['shell','dumpsys','package',pkg]);if(version.status!==0||!new RegExp('versionCode='+expected.code+'\\b').test(version.stdout)||!version.stdout.includes('versionName='+expected.version))throw Error('PHONE_BASELINE_UNAVAILABLE');
if(/^package:/m.test(call(['shell','pm','path',driver]).stdout))throw Error('DIAGNOSTIC_DRIVER_ALREADY_PRESENT');
let installed=false,report=null;const cleanup={};
// User explicitly authorized self-confirmation for this project's installations.
// Observation-only remains available for troubleshooting without a click.
const confirmInstall=process.argv.includes('--confirm-install-ui')||!process.argv.includes('--observe-install-ui');
async function installWithObservation(){
 if(confirmInstall){call(['shell','input','keyevent','KEYCODE_WAKEUP']);call(['shell','wm','dismiss-keyguard']);call(['shell','cmd','statusbar','collapse']);}
 const child=spawn(adb,['-s',serial,'install','-r',apk],{windowsHide:true});let stdout='',stderr='',ended=false;
 const result=new Promise(resolve=>{child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>stderr+=b);child.on('error',error=>resolve({status:null,stdout,stderr,error}));child.on('close',status=>{ended=true;resolve({status,stdout,stderr});});});
 const timer=setTimeout(()=>child.kill(),30000);
 try{
  await new Promise(resolve=>setTimeout(resolve,1200));
  for(let observation=0;observation<2&&!ended;observation++){
   const file='/data/local/tmp/io-agent-install-window.xml';
   try{call(['shell','uiautomator','dump',file],8000);const xml=call(['exec-out','cat',file],5000).stdout;const nodes=[];
    for(const match of xml.matchAll(/<node\s+([^>]+)>/g)){const a={};for(const v of match[1].matchAll(/([\w-]+)="([^"]*)"/g))a[v[1]]=v[2];
     // This is the system installation window for our own diagnostic APK.
     // Capture its full controls, including content descriptions and bounds;
     // never export the underlying product's private screen contents.
     if(a.package==='com.miui.securitycenter'&&(a.text||a['content-desc']||a.clickable==='true'))nodes.push({text:(a.text||'').slice(0,300),description:(a['content-desc']||'').slice(0,300),resource:a['resource-id'],bounds:a.bounds,enabled:a.enabled,clickable:a.clickable,package:a.package});
    }cleanup.install_window_controls=nodes;
    if(confirmInstall&&nodes.some(n=>n.text==='iO Agent UI test driver')){
     const allow=nodes.filter(n=>n.text==='继续安装'&&n.enabled==='true'&&/^\[\d+,\d+\]\[\d+,\d+\]$/.test(n.bounds||''));
     if(allow.length===1){const b=allow[0].bounds.match(/\d+/g).map(Number);const tap=call(['shell','input','tap',String(Math.floor((b[0]+b[2])/2)),String(Math.floor((b[1]+b[3])/2))],3000);cleanup.install_continue_clicked=tap.status===0&&!/Exception|Permission denied/i.test(tap.stdout+tap.stderr);(cleanup.install_continue_attempts??=[]).push({observation,exit_code:tap.status,injection_rejected:/Exception|Permission denied/i.test(tap.stdout+tap.stderr)});}
    }
   }finally{call(['shell','rm','-f',file],5000);}
   await new Promise(resolve=>setTimeout(resolve,600));
  }
  return await result;
 }finally{clearTimeout(timer);}
}
try{
 const install=await installWithObservation();installed=install.status===0&&/\bSuccess\b/.test(install.stdout);
 if(!installed){cleanup.install_failure=/INSTALL_FAILED_[A-Z_]+/.exec(install.stdout+install.stderr)?.[0]||'INSTALL_OUTCOME_UNCONFIRMED';cleanup.install_timed_out=install.error?.code==='ETIMEDOUT';cleanup.install_exit_code=install.status;cleanup.install_diagnostic=(install.stdout+install.stderr).replaceAll(serial,'[device]').replaceAll(apk,'[diagnostic.apk]').slice(-1000);console.log(JSON.stringify(cleanup));throw Error(cleanup.install_failure);}
 if(recordingArchive){
  const run=call(['shell','am','instrument','-w','-e','probe_id',nonce,'-e','attempt_id',archiveAttempt,driver+'/'+driver+'.RecordingArchiveProbe'],45000),values={};for(const line of run.stdout.split(/\r?\n/)){const m=/^INSTRUMENTATION_RESULT: ([a-z_]+)=(.*)$/.exec(line);if(m)values[m[1]]=m[2];}
  cleanup.recording_archive_result={passed:values.passed==='true',error:values.error||null,state_unchanged:values.state_unchanged==='true'};
  if(run.status!==0||values.probe_id!==nonce||values.completed!=='true'||values.passed!=='true'||values.state_unchanged!=='true'||values.microphone_started!=='false'||values.network_requests!=='0'||values.readiness_created!=='false'||values.task_or_answer_submitted!=='false'||values.credentials_or_text_exported!=='false'||values.store_write_attempted!=='false'||values.files_written!=='false')throw Error('ARCHIVE_PROBE_INCOMPLETE_'+(values.error||'UNKNOWN'));
  report={schema:1,probe_id:nonce,attempt_id:archiveAttempt,kind:'Read-only installed product archive verification of one completed capture; no recapture or readiness grant',passed:true,audit:JSON.parse(values.audit),network_requests:0,microphone_started:false,readiness_created:false,task_or_answer_submitted:false,credentials_or_text_exported:false,state_unchanged:true};
 }else if(gatewayHeaderShape||calendarRead){
  if(gatewayHeaderShape){
  const abi=call(['shell','am','instrument','-w','-e','probe_id',nonce,'-e','abi_only','true',driver+'/'+driver+'.NormalVoiceGuardProbe'],15000),abiValues={};for(const line of abi.stdout.split(/\r?\n/)){const m=/^INSTRUMENTATION_RESULT: ([a-z_]+)=(.*)$/.exec(line);if(m)abiValues[m[1]]=m[2];}
  const abiPassed=abi.status===0&&abiValues.probe_id===nonce&&abiValues.abi_verified==='true'&&['sdk_methods_called','microphone_started','task_or_answer_submitted','control_endpoint_opened'].every(key=>abiValues[key]==='false');
  cleanup.normal_guard_abi_verified=abiPassed;fs.writeFileSync(path.join(root,'phone-normal-voice-guard-abi-2026-10-22.json'),JSON.stringify({schema:1,at:new Date().toISOString(),probe_id:nonce,product:expected.version+' /'+expected.code,passed:abiPassed,error:abiValues.error||null,abi_location:abiValues.abi_location||null,sdk_methods_called:abiValues.sdk_methods_called==='true',microphone_started:abiValues.microphone_started==='true',control_endpoint_opened:abiValues.control_endpoint_opened==='true',scope:'Installed product member signatures only; no normal voice or physical-stop acceptance'},null,2)+'\n');
  }
  const child=spawn(adb,['-s',serial,'shell','am','instrument','-w','-e','probe_id',nonce,...(calendarRead?['-e','month',calendarMonth]:[]),driver+'/'+driver+(calendarRead?'.GatewayCalendarReadProbe':'.GatewayHeaderShapeProbe')],{windowsHide:true,stdio:['ignore','pipe','pipe']});let stdout='',failed=false;
  const timer=setTimeout(()=>{failed=true;child.kill();},60000);const done=new Promise(resolve=>{child.stdout.on('data',b=>{if(stdout.length+b.length>1048576){failed=true;child.kill();}else stdout+=b.toString('utf8');});child.stderr.on('data',()=>{});child.on('error',()=>{failed=true;resolve(null);});child.on('close',resolve);});
  await new Promise(resolve=>setTimeout(resolve,400));cleanup.normal_main_requested_for_header_probe=call(['shell','am','start','-n',pkg+'/com.rayneo.venus.MainActivity'],5000).status===0;
  const status=await done;clearTimeout(timer);const values={};for(const line of stdout.split(/\r?\n/)){const m=/^INSTRUMENTATION_RESULT: ([a-z_]+)=(.*)$/.exec(line);if(m)values[m[1]]=m[2];}
  if(calendarRead){
   report={schema:1,probe_id:nonce,at:new Date().toISOString(),product:expected.version+' /'+expected.code,kind:'Diagnostic single explicit-month official calendar read POST; no production discovery',month:calendarMonth,passed:values.passed==='true',error:values.error||null,experiment_response_completed:values.experiment_response_completed==='true',state_unchanged:values.state_unchanged==='true',request_attempts:Number(values.request_attempts||0),logical_http_calls:Number(values.logical_http_calls||0),signed_and_sent_same_bytes:values.signed_and_sent_same_bytes==='true',account_access_token_used:values.account_access_token_used==='true',application_level_retries:values.application_level_retries==='true',current_dart_nonempty_body_vector_verified:values.current_dart_nonempty_body_vector_verified==='true',production_calendar_discovery_enabled:values.production_calendar_discovery_enabled==='true',credentials_or_private_text_exported:values.credentials_or_private_text_exported==='true',audit:JSON.parse(values.audit||'{}')};
   if(failed||status!==0||values.probe_id!==nonce||!report.passed||!report.state_unchanged||report.logical_http_calls!==1||!report.signed_and_sent_same_bytes||report.credentials_or_private_text_exported||report.application_level_retries||report.production_calendar_discovery_enabled)throw Error('GATEWAY_CALENDAR_READ_INCOMPLETE_'+(values.error||'NOT_ACCEPTED'));
  }else{
  cleanup.gateway_header_shape_result={passed:values.passed==='true',error:values.error||null,state_unchanged:values.state_unchanged==='true'};
  if(failed||status!==0||values.probe_id!==nonce||values.passed!=='true'||values.state_unchanged!=='true'||values.network_requests!=='0'||values.credentials_or_private_text_exported!=='false'||values.signing_key_read!=='false'||values.mutations_attempted!=='false')throw Error('GATEWAY_HEADER_SHAPE_INCOMPLETE_'+(values.error||'UNKNOWN'));
  report={schema:1,probe_id:nonce,kind:'Read-only fixed-host calendar request/header shapes; no signing or pairing claims',passed:true,audit:JSON.parse(values.audit),state_unchanged:true,network_requests:0,credentials_or_private_text_exported:false,signing_key_read:false,mutations_attempted:false};
  }
 }else if(officialMetadata){
  if(!dev6)throw Error('METADATA_REQUIRES_DEV6');
  const run=call(['shell','am','instrument','-w','-e','probe_id',nonce,driver+'/'+driver+'.OfficialMetadataProbe'],60000),values={};for(const line of run.stdout.split(/\r?\n/)){const m=/^INSTRUMENTATION_RESULT: ([a-z_]+)=(.*)$/.exec(line);if(m)values[m[1]]=m[2];}
  if(values.probe_id===nonce){cleanup.official_metadata_result={passed:values.passed==='true',error:values.error||null,state_unchanged:values.state_unchanged==='true',network_requests:Number(values.network_requests),audit:JSON.parse(values.audit||'{}')};}
  if(run.status!==0||values.probe_id!==nonce||values.passed!=='true'||values.state_unchanged!=='true'||values.network_requests!=='0'||values.credentials_or_text_exported!=='false'||values.mutations_attempted!=='false')throw Error('OFFICIAL_METADATA_INCOMPLETE_'+(values.error||'UNKNOWN'));
  report={schema:1,probe_id:nonce,kind:'Current account cached calendar/recording and fixed deletion-ledger metadata; no HTTP or audio reads',passed:true,audit:JSON.parse(values.audit),network_requests:0,state_unchanged:true,credentials_or_text_exported:false,mutations_attempted:false};
 }else if(inventory){
  const run=call(['shell','am','instrument','-w','-e','probe_id',nonce,'-e','scope',inventoryDiscovery?'discover':inventoryCache?'cache':inventoryRemaining?'remaining':'first',driver+'/'+driver+'.LifelogInventoryProbe'],100000),values={};for(const line of run.stdout.split(/\r?\n/)){const m=/^INSTRUMENTATION_RESULT: ([a-z_]+)=(.*)$/.exec(line);if(m)values[m[1]]=m[2];}
  if(run.status!==0||values.probe_id!==nonce||values.completed!=='true'||values.state_unchanged!=='true'||values.credentials_or_text_exported!=='false'||values.mutations_attempted!=='false')throw Error('INVENTORY_READ_INCOMPLETE');
  report={schema:1,probe_id:nonce,kind:'Read-only exact cached current-account official list GETs; shapes and ID correspondence only',passed:values.passed==='true',error:values.error||null,audit:JSON.parse(values.audit),request_attempts:Number(values.request_attempts),state_unchanged:true,credentials_or_text_exported:false,mutations_attempted:false};
 }else if(refreshRead){
  const run=call(['shell','am','instrument','-w','-e','probe_id',nonce,driver+'/'+driver+'.MaterialRefreshReadProbe'],100000),values={};for(const line of run.stdout.split(/\r?\n/)){const m=/^INSTRUMENTATION_RESULT: ([a-z_]+)=(.*)$/.exec(line);if(m)values[m[1]]=m[2];}
  if(run.status!==0||values.probe_id!==nonce||values.completed!=='true'||values.state_unchanged!=='true'||values.credentials_or_text_exported!=='false')throw Error('REFRESH_READ_INCOMPLETE');
  report={schema:1,probe_id:nonce,kind:'Installed production official refresh, read only',passed:values.passed==='true',error:values.error||null,failure_location:values.failure_location||null,audit:JSON.parse(values.audit),state_unchanged:true,credentials_or_text_exported:false};
 }else if(gatewayRead){
  const run=call(['shell','am','instrument','-w','-e','probe_id',nonce,'-e','scope',gatewayDetail?'detail':'latest',driver+'/'+driver+'.GatewayLifelogReadProbe'],55000),values={};for(const line of run.stdout.split(/\r?\n/)){const m=/^INSTRUMENTATION_RESULT: ([a-z_]+)=(.*)$/.exec(line);if(m)values[m[1]]=m[2];}
  const allowed=['probe_id','audit','completed','error','failure_class','request_attempts','credentials_or_text_exported','mutations_attempted','client_closed'];cleanup.gateway_read_result=Object.fromEntries(Object.entries(values).filter(([k])=>allowed.includes(k)));
  if(run.status!==0||values.probe_id!==nonce||values.completed!=='true'||values.client_closed!=='true'||values.credentials_or_text_exported!=='false'||values.mutations_attempted!=='false'||values.request_attempts!=='1')throw Error('GATEWAY_READ_INCOMPLETE_'+(values.error||'UNKNOWN'));
  report={schema:1,probe_id:nonce,kind:'One current-account official '+(gatewayDetail?'events/{id}/full':'journal/latest')+' GET using the verified host canonical signer and pinned domestic TCL1 inputs (distinct from account gateway)',audit:JSON.parse(values.audit),request_attempts:1,credentials_or_text_exported:false,mutations_attempted:false};
 }else if(gatewayCanonical){
  if(!dev2)throw Error('CANONICAL_REQUIRES_CURRENT_HOST');
  const run=call(['shell','am','instrument','-w','-e','probe_id',nonce,driver+'/'+driver+'.GatewayCanonicalProbe'],45000),values={};for(const line of run.stdout.split(/\r?\n/)){const m=/^INSTRUMENTATION_RESULT: ([a-z_]+)=(.*)$/.exec(line);if(m)values[m[1]]=m[2];}
  if(run.status!==0||values.probe_id!==nonce||values.passed!=='true'||values.client_closed!=='true'||values.credentials_or_user_files_accessed!=='false'||values.network_requests!=='0')throw Error('CANONICAL_CHECK_INCOMPLETE_'+(values.error||'UNKNOWN'));
  report={schema:1,probe_id:nonce,kind:'Installed host resource signer compared against independently reconstructed canonical format using synthetic keys only',audit:JSON.parse(values.audit),credentials_or_user_files_accessed:false,network_requests:0,client_closed:true};
 }else if(queueMigration){
  const run=call(['shell','am','instrument','-w','-e','probe_id',nonce,driver+'/'+driver+'.MaterialQueueMigrationProbe'],45000),values={};for(const line of run.stdout.split(/\r?\n/)){const m=/^INSTRUMENTATION_RESULT: ([a-z_]+)=(.*)$/.exec(line);if(m)values[m[1]]=m[2];}
  if(run.status!==0||values.probe_id!==nonce||values.passed!=='true'||values.real_materials_or_settings_accessed!=='false'||values.network_requests!=='0')throw Error('QUEUE_MIGRATION_INCOMPLETE_'+(values.error||'UNKNOWN'));
  report={schema:1,probe_id:nonce,kind:'Synthetic Android ledger migration; installed legacy reader refusal and forward recovery',audit:JSON.parse(values.audit),real_materials_or_settings_accessed:false,network_requests:0};
 }else if(formalAudit){
  const run=call(['shell','am','instrument','-w','-e','probe_id',nonce,driver+'/'+driver+'.FormalMaterialAuditProbe'],45000),values={};for(const line of run.stdout.split(/\r?\n/)){const m=/^INSTRUMENTATION_RESULT: ([a-z_]+)=(.*)$/.exec(line);if(m)values[m[1]]=m[2];}
  if(run.status!==0||values.probe_id!==nonce||values.passed!=='true'||values.state_unchanged!=='true'||values.credentials_or_text_exported!=='false'||values.network_requests!=='0')throw Error('FORMAL_AUDIT_INCOMPLETE_'+(values.error||'UNKNOWN'));
  report={schema:1,probe_id:nonce,kind:'Read-only current formal material queue hashes for authorized server comparison',passed:true,audit:JSON.parse(values.audit),credentials_or_text_exported:false,network_requests:0,state_unchanged:true};
 }else if(materialCloud){
  const passes=[];for(const phase of ['first','repeat']){const run=call(['shell','am','instrument','-w','-e','probe_id',nonce,'-e','phase',phase,driver+'/'+driver+'.MaterialCloudProbe'],75000);const values={};for(const line of run.stdout.split(/\r?\n/)){const m=/^INSTRUMENTATION_RESULT: ([a-z_]+)=(.*)$/.exec(line);if(m)values[m[1]]=m[2];}
   cleanup.material_cloud_passes=passes;const allowed=['probe_id','phase','material_id','stored','added','saved_config_unchanged_and_paused','real_lifelog_read_or_uploaded','installed_production_classes','microphone_started','test_fixture_removed','passed','error'];const safe=Object.fromEntries(Object.entries(values).filter(([key])=>allowed.includes(key)));passes.push(safe);
   if(run.status!==0||values.probe_id!==nonce||values.passed!=='true'||values.saved_config_unchanged_and_paused!=='true'||values.real_lifelog_read_or_uploaded!=='false'||values.microphone_started!=='false')throw Error('MATERIAL_CLOUD_PROBE_INCOMPLETE_'+(values.error||'UNKNOWN'));
  }if(passes[0].material_id!==passes[1].material_id||passes[1].test_fixture_removed!=='true')throw Error('MATERIAL_CLOUD_REPEAT_MISMATCH');report={schema:1,probe_id:nonce,kind:'Installed Android production import over public HTTPS; synthetic sources only',passes};
 }else{
 const run=call(['shell','am','instrument','-w','-e','probe_id',nonce,driver+'/'+driver+(materialSettings?'.MaterialSettingsProbe':accountOnly?'.LoginProbe':'.LifelogLogShapeProbe')],35000);
 if(run.status!==0)throw Error('LIFELOG_PROBE_INCOMPLETE');
 if(accountOnly||materialSettings){const values={};for(const line of run.stdout.split(/\r?\n/)){const match=/^INSTRUMENTATION_RESULT: ([a-z_]+)=(.*)$/.exec(line);if(match)values[match[1]]=match[2];}
  if(materialSettings){cleanup.material_probe_result={checks_passed:Number(values.checks_passed||0),error:values.error||null};if(values.probe_id!==nonce||values.real_settings_unchanged!=='true'||values.credentials_exported!=='false'||values.sync_or_microphone_started!=='false'||values.test_namespace_removed!=='true')throw Error('MATERIAL_SETTINGS_PROBE_INCOMPLETE_'+(values.error||'UNKNOWN'));report={schema:1,probe_id:nonce,kind:'isolated synthetic material Keystore settings; UI checked separately',checks_passed:Number(values.checks_passed),real_keystore:true,test_namespace_removed:true,real_settings_unchanged:true,sync_or_microphone_started:false,credentials_exported:false};}else{
  if(values.probe_id!==nonce||values.credentials_exported!=='false'||values.store_modified!=='false'||values.current_gate_allows!=='true')throw Error('ACCOUNT_PROBE_INCOMPLETE');
  const cacheAudit=JSON.parse(values.cache_audit);
  report={schema:1,probe_id:nonce,kind:'official account schema and cache namespace; values stay in-process',storage_shapes:JSON.parse(values.storage_shapes),cache_audit:cacheAudit,current_gate_allows:true,credentials_exported:false,store_modified:false,account_ownership_of_historical_logs_verified:cacheAudit.ownership_verified_for_all_observed_sources===true};}
 }else{const read=call(['exec-out','cat',output]);if(read.status!==0)throw Error('LIFELOG_REPORT_MISSING');report=JSON.parse(read.stdout);if(report.probe_id!==nonce||report.text_or_identifiers_exported!==false||report.network_requests!==0||report.microphone_started!==false)throw Error('LIFELOG_REPORT_MISMATCH');}
 }
 report.driver_sha256=crypto.createHash('sha256').update(fs.readFileSync(apk)).digest('hex');
 report.production_reader_sha256=crypto.createHash('sha256').update(fs.readFileSync(path.join(root,'src/com/turboio/addon/OfficialLifelogLogReader.java'))).digest('hex');
}finally{
 if(installed){cleanup.report_removed=call(['shell','rm','-f',output]).status===0;cleanup.driver_uninstalled=/\bSuccess\b/.test(call(['uninstall',driver],30000).stdout);cleanup.driver_absent=!/^package:/m.test(call(['shell','pm','path',driver]).stdout);cleanup.normal_launch_requested=call(['shell','am','start','-n',pkg+'/com.rayneo.venus.MainActivity']).status===0;}
 const recordDate=gatewayHeaderShape||calendarRead||monthDev2||beforeMonthDev2?'2026-10-22':'2026-10-21';
 fs.writeFileSync(path.join(root,'phone-lifelog-log-shape-cleanup-'+recordDate+'.json'),JSON.stringify({schema:1,at:new Date().toISOString(),probe_id:nonce,driver_installed:installed,...cleanup},null,2)+'\n');
 fs.appendFileSync(path.join(root,'phone-lifelog-log-shape-history-'+recordDate+'.ndjson'),JSON.stringify({at:new Date().toISOString(),probe_id:nonce,report,cleanup})+'\n');
 if(calendarRead&&report)fs.writeFileSync(path.join(root,'phone-calendar-read-2026-10-22.json'),JSON.stringify({...report,cleanup},null,2)+'\n');
}
report.at=new Date().toISOString();report.product=expected.version+' /'+expected.code;report.cleanup=cleanup;
if(gatewayHeaderShape){fs.writeFileSync(path.join(root,'phone-gateway-header-shape-2026-10-22.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));process.exit(0);}
if(calendarRead){console.log(JSON.stringify(report));process.exit(0);}
if(monthDev2){fs.writeFileSync(path.join(root,'phone-formal-material-audit-month-dev2-2026-10-22.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({passed:report.passed,product:report.product,stored_versions:report.audit.items.length,queue_schema:report.audit.queue_schema,queue_sha256:report.audit.queue_sha256,configuration_enabled:report.audit.configuration_enabled,driver_absent:cleanup.driver_absent}));process.exit(0);}
if(voiceDev1){fs.writeFileSync(path.join(root,beforeMonthDev2?'phone-formal-material-audit-before-month-dev2-2026-10-22.json':recordingArchive?'phone-recording-archive-2026-10-21.json':'phone-formal-material-audit-voice-dev1-2026-10-21.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(recordingArchive?{passed:report.passed,product:report.product,audit:report.audit,state_unchanged:report.state_unchanged,driver_absent:cleanup.driver_absent}:{passed:report.passed,product:report.product,stored_versions:report.audit.items.length,queue_schema:report.audit.queue_schema,queue_sha256:report.audit.queue_sha256,configuration_enabled:report.audit.configuration_enabled,driver_absent:cleanup.driver_absent}));process.exit(0);}
const reportFile=officialMetadata?'phone-official-metadata-2026-10-21.json':dev6?'phone-formal-material-audit-dev6-2026-10-21.json':inventoryDiscovery?'phone-lifelog-discovery-source-2026-10-21.json':inventoryCache?'phone-lifelog-inventory-cache-2026-10-21.json':inventory?'phone-lifelog-inventory-2026-10-21.json':dev5?'phone-formal-material-audit-dev5-2026-10-21.json':(dev4&&queueMigration)?'phone-material-ledger-migration-dev4-2026-10-21.json':dev4?'phone-formal-material-audit-dev4-2026-10-21.json':refreshRead?'phone-material-refresh-read-2026-10-21.json':dev3?'phone-formal-material-audit-dev3-2026-10-21.json':gatewayDetail?'phone-gateway-lifelog-revision-mapping-2026-10-21.json':gatewayRead?'phone-gateway-lifelog-tcl1-2026-10-21.json':gatewayCanonical?'phone-gateway-canonical-2026-10-21.json':dev2?'phone-formal-material-audit-dev2-2026-10-21.json':queueMigration?'phone-material-ledger-migration-2026-10-21.json':formalAudit?'phone-formal-material-audit-2026-10-21.json':materialCloud?'phone-material-cloud-2026-10-21.json':materialSettings?'phone-material-settings-2026-10-21.json':accountOnly?'phone-lifelog-account-2026-10-21.json':'phone-lifelog-log-shape-2026-10-21.json';fs.writeFileSync(path.join(root,reportFile),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(officialMetadata||inventory||refreshRead||gatewayRead||gatewayCanonical||accountOnly||materialSettings||materialCloud||formalAudit||queueMigration?report:{report_file:reportFile,pages:report.pages,matches:report.matching_response_lines,complete:report.selected_inventory_complete,mapping:report.records.map(r=>r.material_mapping),cleanup:report.cleanup},null,2));
