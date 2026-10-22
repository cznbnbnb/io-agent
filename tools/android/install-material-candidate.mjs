// Same-signature update only. Never uninstall the product or clear application data.
import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import {spawn,spawnSync} from 'node:child_process';
const root=path.resolve('rebuild/android-app'),read=n=>JSON.parse(fs.readFileSync(path.join(root,n),'utf8').replace(/^\uFEFF/,''));
const candidate=read('candidate.json'),rollback=read('rollback-candidate.json'),serial=read('.private/phone-login-install-2026-10-20/verified-target.json').serial;
const voice=process.argv.includes('--voice-dev1'),month=process.argv.includes('--month-dev2'),expected=month?{version:'0.5.3-dev2',code:10424,report:'phone-month-dev2-install-2026-10-22.json'}:voice?{version:'0.5.3-dev1',code:10423,report:'phone-voice-dev1-install-2026-10-21.json'}:{version:'0.5.2-dev6',code:10422,report:'phone-material-date-install-2026-10-21.json'};
if(voice&&month||process.argv.slice(2).some(a=>!['--voice-dev1','--month-dev2'].includes(a)))throw Error('INSTALL_SCOPE_INVALID');
const adb=path.join(root,'.tools/sdk/platform-tools/adb.exe'),pkg='com.rayneo.venus.pub',apk=path.resolve(root,candidate.apk),report={schema:1,at:new Date().toISOString(),candidate:candidate.version,version_code:candidate.version_code,sha256:candidate.sha256,installed:false,product_data_cleared:false};
const hash=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
function call(args,timeout=15000){const r=spawnSync(adb,['-s',serial,...args],{encoding:'utf8',timeout,maxBuffer:1048576,windowsHide:true});if(r.status!==0)throw Error('PHONE_COMMAND_UNCONFIRMED');return r.stdout;}
function installedHash(){const p=call(['shell','pm','path',pkg]).trim();if(!/^package:(\/data\/app\/[A-Za-z0-9._~=/+-]+\/base\.apk)$/.test(p))throw Error('PHONE_PACKAGE_PATH_UNEXPECTED');return call(['shell','sha256sum',p.slice(8)],30000).split(/\s/)[0];}
if(candidate.version!==expected.version||candidate.version_code!==expected.code||candidate.signer_sha256!=='174695b5352ddb1af105a5ef604caf7a8332a52986af8d8eb642e2d3c91ff7ad'||path.dirname(apk)!==path.join(root,'artifacts')||hash(apk)!==candidate.sha256)throw Error('SIGNED_CANDIDATE_MISMATCH');
if(!rollback.installed||hash(path.resolve(root,rollback.apk))!==rollback.sha256)throw Error('ROLLBACK_NOT_VERIFIED');
const before=installedHash();if(before!==rollback.sha256&&before!==candidate.sha256)throw Error('PHONE_BASELINE_CHANGED');
try{
 if(before!==candidate.sha256){
  call(['shell','input','keyevent','KEYCODE_WAKEUP']);call(['shell','wm','dismiss-keyguard']);call(['shell','cmd','statusbar','collapse']);
  const child=spawn(adb,['-s',serial,'install','-r',apk],{windowsHide:true});let out='',ended=false;const done=new Promise(resolve=>{child.stdout.on('data',x=>out+=x);child.stderr.on('data',x=>out+=x);child.on('error',()=>{ended=true;resolve(null);});child.on('close',code=>{ended=true;resolve(code);});});const timer=setTimeout(()=>child.kill(),120000);
  try{while(!ended){await new Promise(resolve=>setTimeout(resolve,1500));if(ended)break;const temp='/data/local/tmp/io-agent-install-window.xml';try{
   call(['shell','uiautomator','dump',temp],8000);const xml=call(['exec-out','cat',temp],5000),nodes=[];
   for(const match of xml.matchAll(/<node\s+([^>]+)>/g)){const a={};for(const v of match[1].matchAll(/([\w-]+)="([^"]*)"/g))a[v[1]]=v[2];if(a.package==='com.miui.securitycenter')nodes.push(a);}
   if(!report.install_continue_clicked&&nodes.some(n=>n.text==='iO Agent')){const allow=nodes.filter(n=>n.text==='继续安装'&&n.enabled==='true'&&n.clickable==='true'&&/^\[\d+,\d+\]\[\d+,\d+\]$/.test(n.bounds||''));if(allow.length===1){const b=allow[0].bounds.match(/\d+/g).map(Number);call(['shell','input','tap',String(Math.floor((b[0]+b[2])/2)),String(Math.floor((b[1]+b[3])/2))]);report.install_continue_clicked=true;}}
  }catch(observation){report.window_observation_transient=true;}finally{try{call(['shell','rm','-f',temp]);}catch(ignored){}}}
  const code=await done;if(code!==0||!out.includes('Success')){report.install_failure=/INSTALL_FAILED_[A-Z_]+/.exec(out)?.[0]||'INSTALL_OUTCOME_UNCONFIRMED';throw Error(report.install_failure);}
  }finally{clearTimeout(timer);}
 }
 if(installedHash()!==candidate.sha256)throw Error('INSTALLED_SHA_MISMATCH');const version=call(['shell','dumpsys','package',pkg]);if(!new RegExp('versionCode='+expected.code+'\\b').test(version)||!new RegExp('versionName='+expected.version.replaceAll('.','\\.')+'\\b').test(version))throw Error('INSTALLED_VERSION_MISMATCH');
 call(['shell','am','start','-n',pkg+'/com.rayneo.venus.MainActivity']);report.installed=true;report.installed_hash_verified=true;report.normal_launch_requested=true;
 candidate.installed=true;candidate.phone_disconnected_by_user=false;candidate.audit.device_installed=true;candidate.phone_install_evidence=expected.report;fs.writeFileSync(path.join(root,'candidate.json'),JSON.stringify(candidate,null,2)+'\n');
}finally{fs.writeFileSync(path.join(root,expected.report),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));}
