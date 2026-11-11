import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';import {spawnSync} from 'node:child_process';
import {HOST,verifyHost} from '../../rebuild/android-app/host-110.mjs';
import {verifySnapshot} from './verify-source.mjs';
import {verifyVoice} from './verify-voice.mjs';
import {PRODUCT,productInfoSource,OFFICIAL_SOURCE_ROUTING} from './profile.mjs';
import {PYTHON} from './host-tools.mjs';
const workspace=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const root=path.join(workspace,'rebuild/android-app'),build=path.join(root,'build'),sdk=path.join(root,'.tools/sdk');
const source=path.join(root,'.private/hosts',HOST.apk),host=path.join(build,HOST.stage);
const jarTool=path.join(root,'.tools/apktool.jar'),androidJar=path.join(sdk,'platforms/android-36/android.jar');
const zxing=path.join(root,'vendor/zxing/core-3.5.3.jar');
if(crypto.createHash('sha256').update(fs.readFileSync(zxing)).digest('hex')!=='8d8064c1636fdaef7189dd9055c7d59950a8940a12f2293956446ec3c109fd82')throw new Error('ZXing dependency hash mismatch');
const mode=process.argv.includes('--assemble-only')?'assemble':process.argv.includes('--smali-only')?'smali':process.argv.includes('--addon-only')?'addon':process.argv.includes('--compile-only')?'compile':'all';
function run(command,args){console.log('Running '+command+' '+(command==='java'&&args.includes('-jar')?path.basename(args[args.indexOf('-jar')+1]):''));const r=spawnSync(command,args,{stdio:'inherit',cwd:root});if(r.error)throw r.error;if(r.status!==0)throw new Error(command+' exit '+r.status);}
function hash(file){return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');}
function write(file,value){fs.writeFileSync(file,JSON.stringify(value,null,2)+'\n');}
fs.mkdirSync(build,{recursive:true});
if(hash(source)!==HOST.sha256)throw new Error('Official APK hash mismatch');
const free=fs.statfsSync(root);if(free.bavail*free.bsize<8*1024**3)throw new Error('At least 8 GiB free required');
const lock=path.join(build,'build.lock'),token=crypto.randomUUID();fs.writeFileSync(lock,JSON.stringify({token,pid:process.pid,started:new Date().toISOString()}),{flag:'wx'});
const result={schema:1,product:PRODUCT.name,version:PRODUCT.version,revision:PRODUCT.revision,upstream:'f57cc82d0c810435653b684fbdd8c07c533a012f',host_version:HOST.version,host_code:HOST.code,source_sha256:HOST.sha256,started:new Date().toISOString(),installed:false,ota_writes_enabled:false};
try{
 result.upstream_files_verified=verifySnapshot(root);
 if(!fs.existsSync(host))run('java',['-Xmx2048m','-jar',jarTool,'d','--no-res','-p',path.join(root,'.tools/apktool-framework'),'-o',host,source]);
 const abi=verifyHost(host);write(path.join(root,'host-110-verification.json'),{schema:1,source_sha256:HOST.sha256,proofs:abi.proofs});
 write(path.join(root,'voice-110-verification.json'),verifyVoice(host));
 const replaceMethod=(file,name,signature,body)=>{
  let t=fs.readFileSync(file,'utf8').replace(/\r\n/g,'\n');const header='.method public final '+name+signature;const old='turboioOriginal_'+name;
  if(t.includes(old+'(')){const start=t.indexOf(header+'\n'),end=t.indexOf('.end method',start);if(start<0||end<0)throw new Error('Invalid existing wrapper');t=t.slice(0,start)+t.slice(end+11);}
  else{if(t.split(header).length!==2)throw new Error('Wrapper target ambiguous '+header);t=t.replace(header,'.method public final '+old+signature);}
  t+='\n'+header+'\n    .locals 1\n'+body+'\n.end method\n';fs.writeFileSync(file,t);
 };
 if(mode!=='assemble'){
  // The pinned host scans at LOW_LATENCY even when no screen is visible.
  // Keep its scan filters/callbacks/reconnect schedule, changing only radio duty.
  let scanner=fs.readFileSync(abi.scanner,'utf8').replace(/\r\n/g,'\n');
  const scanMode='    invoke-virtual {p1, v2}, Landroid/bluetooth/le/ScanSettings$Builder;->setScanMode(I)Landroid/bluetooth/le/ScanSettings$Builder;';
  const scanPolicy='    invoke-static {}, Lcom/turboio/addon/Host107Connection;->scanMode()I\n\n    move-result v2\n\n';
  if(scanner.split(scanMode).length!==2||scanner.split(scanPolicy).length>2)throw new Error('Scanner mode hook ambiguous');
  scanner=scanner.replace(scanPolicy,'').replace(scanMode,scanPolicy+scanMode);fs.writeFileSync(abi.scanner,scanner);
  // Only cache misses with no in-flight request consume the retry budget.
  // Returning null is the coordinator's existing "no location available" result.
  const locationHeader='.method public final a(Lkotlin/jvm/functions/Function1;)V';
  let location=fs.readFileSync(abi.location,'utf8').replace(/\r\n/g,'\n');
  const locationStart=location.indexOf(locationHeader+'\n'),locationEnd=location.indexOf('.end method',locationStart);
  if(locationStart<0||locationEnd<0)throw new Error('Location coordinator method missing');
  let locationBody=location.slice(locationStart,locationEnd);
  const locationPolicy='    # io_background_location_retry\n    invoke-virtual {v0}, Ljava/util/ArrayList;->isEmpty()Z\n    move-result v2\n    if-eqz v2, :io_location_allowed\n    invoke-static {}, Lcom/turboio/addon/Host107Connection;->allowLocationRetry()Z\n    move-result v2\n    if-nez v2, :io_location_allowed\n    const/4 v2, 0x0\n    invoke-interface {p1, v2}, Lkotlin/jvm/functions/Function1;->invoke(Ljava/lang/Object;)Ljava/lang/Object;\n    return-void\n    :io_location_allowed\n\n';
  const locationMiss='    invoke-virtual {v0, p1}, Ljava/util/ArrayList;->add(Ljava/lang/Object;)Z';
  if(locationBody.split(locationMiss).length!==2||locationBody.split(locationPolicy).length>2)throw new Error('Location retry hook ambiguous');
  locationBody=locationBody.replace(locationPolicy,'').replace(locationMiss,locationPolicy+locationMiss);
  fs.writeFileSync(abi.location,location.slice(0,locationStart)+locationBody+location.slice(locationEnd));
  let completion=fs.readFileSync(abi.locationResult,'utf8').replace(/\r\n/g,'\n');
  const completionHeader='.method public final a(Ljava/util/Map;Z)V\n    .locals 10\n';
  const completionPolicy='\n    invoke-static {p1, p2}, Lcom/turboio/addon/Host107Connection;->locationResult(Ljava/lang/Object;Z)V\n';
  if(completion.split(completionHeader).length!==2||completion.split(completionPolicy).length>2)throw new Error('Location result hook ambiguous');
  completion=completion.replace(completionPolicy,'').replace(completionHeader,completionHeader+completionPolicy);fs.writeFileSync(abi.locationResult,completion);
  let provider=fs.readFileSync(abi.locationProvider,'utf8').replace(/\r\n/g,'\n');
  const providerAnchor='    check-cast v4, LL8/u0;';
  const providerPolicy='\n\n    # io_independent_system_one_shot\n    sget-object v0, LL8/u0;->AMAP:LL8/u0;\n    if-ne v4, v0, :io_location_provider_ready\n    invoke-static {}, Lcom/turboio/addon/Host107Connection;->systemOneShotLocation()Z\n    move-result v0\n    if-eqz v0, :io_location_provider_ready\n    sget-object v4, LL8/u0;->ANDROID_SYSTEM:LL8/u0;\n    :io_location_provider_ready';
  if(provider.split(providerAnchor).length!==2||provider.split(providerPolicy).length>2)throw new Error('One-shot provider hook ambiguous');
  provider=provider.replace(providerPolicy,'').replace(providerAnchor,providerAnchor+providerPolicy);fs.writeFileSync(abi.locationProvider,provider);
  // Under our application ID every AMap start fails authentication, yet high-accuracy mode still powers GPS
  // for each ten-second start window (2026-11-11: about a third of the time, no location delivered). Same stock flow, network-only mode.
  let options=fs.readFileSync(abi.locationOptions,'utf8').replace(/\r\n/g,'\n');
  const modeAnchor='    sget-object v1, Lcom/amap/api/location/AMapLocationClientOption$AMapLocationMode;->Hight_Accuracy:Lcom/amap/api/location/AMapLocationClientOption$AMapLocationMode;';
  const modePolicy='\n\n    # io_independent_amap_without_gps\n    invoke-static {}, Lcom/turboio/addon/Host107Connection;->amapWithoutGps()Z\n    move-result v2\n    if-eqz v2, :io_amap_mode_ready\n    sget-object v1, Lcom/amap/api/location/AMapLocationClientOption$AMapLocationMode;->Battery_Saving:Lcom/amap/api/location/AMapLocationClientOption$AMapLocationMode;\n    :io_amap_mode_ready';
  if(options.split(modeAnchor).length!==2||options.split(modePolicy).length>2)throw new Error('AMap mode hook ambiguous');
  options=options.replace(modePolicy,'').replace(modeAnchor,modeAnchor+modePolicy);fs.writeFileSync(abi.locationOptions,options);
  for(const [name,signature,registers,callback] of [['onAsrResult','(Ljava/lang/String;ZLjava/lang/String;)V','p0 .. p3','dispatchAsr(Ljava/lang/Object;Ljava/lang/String;ZLjava/lang/String;)V'],['onNlpResult','(Lcom/rayneo/airuntime/controller/NlpResult;)V','p0 .. p1','dispatchNlp(Ljava/lang/Object;Ljava/lang/Object;)V'],['onResponseComplete','()V','p0 .. p0','dispatchComplete(Ljava/lang/Object;)V']])replaceMethod(abi.listener,name,signature,`    :io_try\n    invoke-static/range {${registers}}, Lcom/turboio/addon/TurboAddon;->${callback}\n    :io_end\n    return-void\n    :io_error\n    move-exception v0\n    invoke-virtual/range {${registers}}, ${HOST.listener}->turboioOriginal_${name}${signature}\n    return-void\n    .catch Ljava/lang/Throwable; {:io_try .. :io_end} :io_error`);
  // Observe a bounded copy, then call the original exactly once, including observer failures.
  replaceMethod(abi.audio,'c','(Ljava/lang/String;[B)V','    :io_try\n    invoke-static {p1, p2}, Lcom/turboio/addon/LifelogAudioObservationRuntime;->incoming(Ljava/lang/String;[B)V\n    :io_end\n    goto :io_original\n    :io_error\n    move-exception v0\n    :io_original\n    invoke-virtual {p0, p1, p2}, Lcom/rayneo/rayneo_venus_sdk_plugin/e;->turboioOriginal_c(Ljava/lang/String;[B)V\n    return-void\n    .catch Ljava/lang/Throwable; {:io_try .. :io_end} :io_error');
  replaceMethod(abi.activity,'onPostResume','()V','    invoke-virtual {p0}, Lcom/rayneo/venus/MainActivity;->turboioOriginal_onPostResume()V\n    :io_try\n    invoke-static {p0}, Lcom/turboio/addon/TurboAddon;->install(Landroid/app/Activity;)V\n    :io_end\n    return-void\n    :io_error\n    move-exception v0\n    return-void\n    .catch Ljava/lang/Throwable; {:io_try .. :io_end} :io_error');
  // 2026-10-24 (user): boot the task channel when the stock process starts without a screen (phone reboot).
  replaceMethod(abi.application,'onCreate','()V','    invoke-virtual {p0}, Lcom/rayneo/venus/VenusApplication;->turboioOriginal_onCreate()V\n    :io_try\n    invoke-static {p0}, Lcom/turboio/addon/TurboAddon;->boot(Landroid/app/Application;)V\n    :io_end\n    return-void\n    :io_error\n    move-exception v0\n    return-void\n    .catch Ljava/lang/Throwable; {:io_try .. :io_end} :io_error');
  replaceMethod(abi.event,'z','(Ljava/lang/String;Ljava/util/Map;)V',`    :io_route_try\n    invoke-static {p0, p1, p2}, Lcom/turboio/addon/Host107Connection;->event(Ljava/lang/Object;Ljava/lang/String;Ljava/util/Map;)Z\n    move-result v0\n    :io_route_end\n    if-eqz v0, :io_original\n    return-void\n    :io_route_error\n    move-exception v0\n    :io_original\n    invoke-virtual {p0, p1, p2}, ${HOST.event}->turboioOriginal_z(Ljava/lang/String;Ljava/util/Map;)V\n    :io_try\n    invoke-static {p1, p2}, Lcom/turboio/addon/NativeTransfer;->event(Ljava/lang/String;Ljava/util/Map;)V\n    :io_end\n    return-void\n    :io_error\n    move-exception v0\n    return-void\n    .catch Ljava/lang/Throwable; {:io_route_try .. :io_route_end} :io_route_error\n    .catch Ljava/lang/Throwable; {:io_try .. :io_end} :io_error`);
  replaceMethod(abi.manager,'u','(Ljava/io/File;Ljava/lang/String;Lb5/q;Ljava/lang/String;)Ljava/lang/String;','    invoke-static {}, Lcom/turboio/addon/Host107Abi;->allowFile()Z\n    move-result v0\n    if-eqz v0, :io_file_blocked\n    invoke-virtual/range {p0 .. p4}, LO4/v;->turboioOriginal_u(Ljava/io/File;Ljava/lang/String;Lb5/q;Ljava/lang/String;)Ljava/lang/String;\n    move-result-object v0\n    return-object v0\n    :io_file_blocked\n    const/4 v0, 0x0\n    return-object v0');
  // Allowed messages still use vendor framing/ACK; raw file sending cannot bypass OTA ownership.
  let queue=fs.readFileSync(abi.queue,'utf8').replace(/\r\n/g,'\n');const header='.method public static s(LO4/V;)V';
  if(queue.includes('ioAgentOriginal_s(')){const start=queue.indexOf(header+'\n'),end=queue.indexOf('.end method',start);if(start<0||end<0)throw new Error('Invalid queue wrapper');queue=queue.slice(0,start)+queue.slice(end+11);}
  else{if(queue.split(header).length!==2)throw new Error('Queue ABI mismatch');queue=queue.replace(header,'.method public static ioAgentOriginal_s(LO4/V;)V');}
  queue+='\n'+header+'\n    .locals 1\n    invoke-static {p0}, Lcom/turboio/addon/Host107Abi;->allowQueue(Ljava/lang/Object;)Z\n    move-result v0\n    if-eqz v0, :io_blocked\n    invoke-static {p0}, LO4/Y;->ioAgentOriginal_s(LO4/V;)V\n    return-void\n    :io_blocked\n    invoke-static {p0}, Lcom/turboio/addon/OtaController;->blocked(Ljava/lang/Object;)V\n    return-void\n.end method\n';fs.writeFileSync(abi.queue,queue);
  const src=path.join(root,'upstream/android-addon/src/com/turboio/addon'),overlay=path.join(root,'src/com/turboio/addon');
  const files=new Map(fs.readdirSync(src).filter(n=>n.endsWith('.java')).map(n=>[n,path.join(src,n)]));
  for(const name of fs.readdirSync(overlay).filter(n=>n.endsWith('.java')))files.set(name,path.join(overlay,name));
  const generated=path.join(build,'generated/com/turboio/addon/ProductInfo.java');fs.mkdirSync(path.dirname(generated),{recursive:true});
  fs.writeFileSync(generated,productInfoSource());
  const sources=[...files.values(),generated];
  if(mode!=='smali'){
  const classes=path.join(build,'classes');
  // D8 must not package class files left behind by a renamed/deleted source.
  // This directory is generated-only and protected by the build owner lock.
  if(fs.existsSync(classes)){
   let entries=0;const inspect=directory=>{for(const item of fs.readdirSync(directory,{withFileTypes:true})){const file=path.join(directory,item.name);if(++entries>20000||item.isSymbolicLink())throw new Error('Unexpected compiled stage entry');if(item.isDirectory())inspect(file);else if(!item.isFile()||!item.name.endsWith('.class'))throw new Error('Unknown file in compiled stage');}};
   if(fs.lstatSync(classes).isSymbolicLink()||!fs.statSync(classes).isDirectory())throw new Error('Compiled stage path changed');inspect(classes);fs.rmSync(classes,{recursive:true});
  }
  fs.mkdirSync(classes,{recursive:true});
  const args=path.join(build,'javac.args');fs.writeFileSync(args,['-encoding','UTF-8','-source','8','-target','8','-cp','"'+(androidJar+path.delimiter+zxing).replaceAll('\\','/')+'"','-d','"'+classes.replaceAll('\\','/')+'"',...sources.map(p=>'"'+p.replaceAll('\\','/')+'"')].join('\n'));
  run('javac',['-J-Dfile.encoding=UTF-8','@'+args]);
  run('jar',['cf',path.join(build,'addon.jar'),'-C',classes,'.']);
  fs.mkdirSync(path.join(build,'dex'),{recursive:true});
  run('java',['-Xmx2048m','-cp',path.join(sdk,'build-tools/36.0.0/lib/d8.jar'),'com.android.tools.r8.D8','--lib',androidJar,'--min-api','29','--output',path.join(build,'dex'),path.join(build,'addon.jar'),zxing]);
  }
  if(mode!=='addon'){
   run('javac',['-encoding','UTF-8','-cp',jarTool,'-d',build,path.join(workspace,'tools/android/AssembleDex.java')]);
   for(const dex of HOST.hookDexes)run('java',['-Xmx2048m','-cp',build+path.delimiter+jarTool,'AssembleDex',path.join(host,'smali_'+dex),path.join(build,dex+'-hooked.dex')]);
  }
  result.sources=sources.map(p=>({path:path.relative(root,p),sha256:hash(p)}));result.compile_passed=true;
  if(mode!=='smali')write(path.join(build,'compile-status.json'),{sources:result.sources,product_sha256:hash(path.join(root,'product.json')),addon_sha256:hash(path.join(build,'dex/classes.dex')),host_dex_sha256:Object.fromEntries(HOST.hookDexes.map(dex=>[dex,hash(path.join(build,dex+'-hooked.dex'))])),upstream:result.upstream,host_source_sha256:HOST.sha256,native_route_policy_sha256:OFFICIAL_SOURCE_ROUTING?hash(path.join(root,"native_route110.py")):null});
 }
 if(mode!=='compile'&&mode!=='smali'&&mode!=='addon'){
  const unsigned=path.join(build,PRODUCT.apk_stem+'-unsigned.apk');
  if(fs.existsSync(unsigned))throw new Error('Unsigned output exists; inspect before replacing');
  run(PYTHON,['-S','-X','utf8',path.join(root,'assemble.py'),source,build,path.join(build,'dex/classes.dex'),unsigned]);
  result.unsigned={path:path.relative(root,unsigned),bytes:fs.statSync(unsigned).size,sha256:hash(unsigned)};
 }
 result.phase='complete';result.finished=new Date().toISOString();write(path.join(root,'build-status.json'),result);
}catch(e){result.phase='failed';result.error=String(e);write(path.join(root,'build-status.json'),result);throw e;}
finally{if(JSON.parse(fs.readFileSync(lock,'utf8')).token===token)fs.unlinkSync(lock);}
