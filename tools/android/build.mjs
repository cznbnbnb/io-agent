import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';import {spawnSync} from 'node:child_process';
import {HOST,verifyHost} from '../../rebuild/android-app/host-107.mjs';
import {verifySnapshot} from './verify-source.mjs';
import {verifyVoice} from './verify-voice.mjs';
import {PRODUCT,productInfoSource,OFFICIAL_SOURCE_ROUTING} from './profile.mjs';
import {PYTHON} from './host-tools.mjs';
const workspace=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const root=path.join(workspace,'rebuild/android-app'),build=path.join(root,'build'),sdk=path.join(root,'.tools/sdk');
const source=path.join(root,'.private/hosts/RayNeo-1.0.7-230-original.apk'),host=path.join(build,'host-107');
const jarTool=path.join(root,'.tools/apktool.jar'),androidJar=path.join(sdk,'platforms/android-36/android.jar');
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
 const abi=verifyHost(host);write(path.join(root,'host-107-verification.json'),{schema:1,source_sha256:HOST.sha256,proofs:abi.proofs});
 write(path.join(root,'voice-107-verification.json'),verifyVoice(host));
 const replaceMethod=(file,name,signature,body)=>{
  let t=fs.readFileSync(file,'utf8').replace(/\r\n/g,'\n');const header='.method public final '+name+signature;const old='turboioOriginal_'+name;
  if(t.includes(old+'(')){const start=t.indexOf(header+'\n'),end=t.indexOf('.end method',start);if(start<0||end<0)throw new Error('Invalid existing wrapper');t=t.slice(0,start)+t.slice(end+11);}
  else{if(t.split(header).length!==2)throw new Error('Wrapper target ambiguous '+header);t=t.replace(header,'.method public final '+old+signature);}
  t+='\n'+header+'\n    .locals 1\n'+body+'\n.end method\n';fs.writeFileSync(file,t);
 };
 if(mode!=='assemble'){
  for(const [name,signature,registers,callback] of [['onAsrResult','(Ljava/lang/String;ZLjava/lang/String;)V','p0 .. p3','dispatchAsr(Ljava/lang/Object;Ljava/lang/String;ZLjava/lang/String;)V'],['onNlpResult','(Lcom/rayneo/airuntime/controller/NlpResult;)V','p0 .. p1','dispatchNlp(Ljava/lang/Object;Ljava/lang/Object;)V'],['onResponseComplete','()V','p0 .. p0','dispatchComplete(Ljava/lang/Object;)V']])replaceMethod(abi.listener,name,signature,`    :io_try\n    invoke-static/range {${registers}}, Lcom/turboio/addon/TurboAddon;->${callback}\n    :io_end\n    return-void\n    :io_error\n    move-exception v0\n    invoke-virtual/range {${registers}}, ${HOST.listener}->turboioOriginal_${name}${signature}\n    return-void\n    .catch Ljava/lang/Throwable; {:io_try .. :io_end} :io_error`);
  replaceMethod(abi.activity,'onPostResume','()V','    invoke-virtual {p0}, Lcom/rayneo/venus/MainActivity;->turboioOriginal_onPostResume()V\n    :io_try\n    invoke-static {p0}, Lcom/turboio/addon/TurboAddon;->install(Landroid/app/Activity;)V\n    :io_end\n    return-void\n    :io_error\n    move-exception v0\n    return-void\n    .catch Ljava/lang/Throwable; {:io_try .. :io_end} :io_error');
  replaceMethod(abi.event,'z','(Ljava/lang/String;Ljava/util/Map;)V',`    :io_route_try\n    invoke-static {p0, p1, p2}, Lcom/turboio/addon/Host107Connection;->event(Ljava/lang/Object;Ljava/lang/String;Ljava/util/Map;)Z\n    move-result v0\n    :io_route_end\n    if-eqz v0, :io_original\n    return-void\n    :io_route_error\n    move-exception v0\n    :io_original\n    invoke-virtual {p0, p1, p2}, ${HOST.event}->turboioOriginal_z(Ljava/lang/String;Ljava/util/Map;)V\n    :io_try\n    invoke-static {p1, p2}, Lcom/turboio/addon/NativeTransfer;->event(Ljava/lang/String;Ljava/util/Map;)V\n    :io_end\n    return-void\n    :io_error\n    move-exception v0\n    return-void\n    .catch Ljava/lang/Throwable; {:io_route_try .. :io_route_end} :io_route_error\n    .catch Ljava/lang/Throwable; {:io_try .. :io_end} :io_error`);
  replaceMethod(abi.manager,'u','(Ljava/io/File;Ljava/lang/String;Lk4/q;Ljava/lang/String;)Ljava/lang/String;','    invoke-static {}, Lcom/turboio/addon/Host107Abi;->allowFile()Z\n    move-result v0\n    if-eqz v0, :io_file_blocked\n    invoke-virtual/range {p0 .. p4}, LY3/u;->turboioOriginal_u(Ljava/io/File;Ljava/lang/String;Lk4/q;Ljava/lang/String;)Ljava/lang/String;\n    move-result-object v0\n    return-object v0\n    :io_file_blocked\n    const/4 v0, 0x0\n    return-object v0');
  // Allowed messages still use vendor framing/ACK; raw file sending cannot bypass OTA ownership.
  let queue=fs.readFileSync(abi.queue,'utf8').replace(/\r\n/g,'\n');const header='.method public static o(LY3/S;)V';
  if(queue.includes('ioAgentOriginal_o(')){const start=queue.indexOf(header+'\n'),end=queue.indexOf('.end method',start);if(start<0||end<0)throw new Error('Invalid queue wrapper');queue=queue.slice(0,start)+queue.slice(end+11);}
  else{if(queue.split(header).length!==2)throw new Error('Queue ABI mismatch');queue=queue.replace(header,'.method public static ioAgentOriginal_o(LY3/S;)V');}
  queue+='\n'+header+'\n    .locals 1\n    invoke-static {p0}, Lcom/turboio/addon/Host107Abi;->allowQueue(Ljava/lang/Object;)Z\n    move-result v0\n    if-eqz v0, :io_blocked\n    invoke-static {p0}, LY3/V;->ioAgentOriginal_o(LY3/S;)V\n    return-void\n    :io_blocked\n    invoke-static {p0}, Lcom/turboio/addon/OtaController;->blocked(Ljava/lang/Object;)V\n    return-void\n.end method\n';fs.writeFileSync(abi.queue,queue);
  const src=path.join(root,'upstream/android-addon/src/com/turboio/addon'),overlay=path.join(root,'src/com/turboio/addon');
  const files=new Map(fs.readdirSync(src).filter(n=>n.endsWith('.java')).map(n=>[n,path.join(src,n)]));
  for(const name of fs.readdirSync(overlay).filter(n=>n.endsWith('.java')))files.set(name,path.join(overlay,name));
  const generated=path.join(build,'generated/com/turboio/addon/ProductInfo.java');fs.mkdirSync(path.dirname(generated),{recursive:true});
  fs.writeFileSync(generated,productInfoSource());
  const sources=[...files.values(),generated];
  if(mode!=='smali'){
  const classes=path.join(build,'classes');fs.mkdirSync(classes,{recursive:true});
  const args=path.join(build,'javac.args');fs.writeFileSync(args,['-encoding','UTF-8','-source','8','-target','8','-cp','"'+androidJar.replaceAll('\\','/')+'"','-d','"'+classes.replaceAll('\\','/')+'"',...sources.map(p=>'"'+p.replaceAll('\\','/')+'"')].join('\n'));
  run('javac',['-J-Dfile.encoding=UTF-8','@'+args]);
  run('jar',['cf',path.join(build,'addon.jar'),'-C',classes,'.']);
  fs.mkdirSync(path.join(build,'dex'),{recursive:true});
  run('java',['-Xmx2048m','-cp',path.join(sdk,'build-tools/36.0.0/lib/d8.jar'),'com.android.tools.r8.D8','--lib',androidJar,'--min-api','29','--output',path.join(build,'dex'),path.join(build,'addon.jar')]);
  }
  if(mode!=='addon'){
   run('javac',['-encoding','UTF-8','-cp',jarTool,'-d',build,path.join(workspace,'tools/android/AssembleDex.java')]);
   run('java',['-Xmx2048m','-cp',build+path.delimiter+jarTool,'AssembleDex',path.join(host,'smali_classes2'),path.join(build,'classes2-hooked.dex')]);
  }
  result.sources=sources.map(p=>({path:path.relative(root,p),sha256:hash(p)}));result.compile_passed=true;
  if(mode!=='smali')write(path.join(build,'compile-status.json'),{sources:result.sources,product_sha256:hash(path.join(root,'product.json')),addon_sha256:hash(path.join(build,'dex/classes.dex')),host_dex_sha256:hash(path.join(build,'classes2-hooked.dex')),upstream:result.upstream,host_source_sha256:HOST.sha256,native_route_policy_sha256:OFFICIAL_SOURCE_ROUTING?hash(path.join(root,"native_route107.py")):null});
 }
 if(mode!=='compile'&&mode!=='smali'&&mode!=='addon'){
  const unsigned=path.join(build,PRODUCT.apk_stem+'-unsigned.apk');
  if(fs.existsSync(unsigned))throw new Error('Unsigned output exists; inspect before replacing');
  run(PYTHON,['-S','-X','utf8',path.join(root,'assemble.py'),source,path.join(build,'classes2-hooked.dex'),path.join(build,'dex/classes.dex'),unsigned]);
  result.unsigned={path:path.relative(root,unsigned),bytes:fs.statSync(unsigned).size,sha256:hash(unsigned)};
 }
 result.phase='complete';result.finished=new Date().toISOString();write(path.join(root,'build-status.json'),result);
}catch(e){result.phase='failed';result.error=String(e);write(path.join(root,'build-status.json'),result);throw e;}
finally{if(JSON.parse(fs.readFileSync(lock,'utf8')).token===token)fs.unlinkSync(lock);}
