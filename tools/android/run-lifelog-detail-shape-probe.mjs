// Read-only official log structure audit: installs the test driver, runs
// LifelogDetailShapeProbe inside the installed host, pulls the schema-only
// report, then removes both the device copy and the driver.
import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import {spawn,spawnSync} from 'node:child_process';
import {exe} from './host-tools.mjs';
const root=path.resolve('rebuild/android-app'),adb=path.join(root,'.tools/sdk/platform-tools',exe('adb')),pkg='com.rayneo.venus.pub',driver='com.turboio.androidtests';
const serial=process.env.ANDROID_SERIAL||'bae62ca9',apk=path.join(root,'build/emulator-input/emulator-input.apk');
const output='/sdcard/Android/data/'+pkg+'/files/io-agent-lifelog-detail-shape.json',nonce=crypto.randomBytes(16).toString('hex');
const destination=path.join(root,'lifelog-contract-shape-'+new Date().toISOString().slice(0,10)+'.json');
function call(args,timeout=15000){const r=spawnSync(adb,['-s',serial,...args],{encoding:'utf8',timeout,maxBuffer:8<<20,windowsHide:true});if(r.error)throw Error('ADB_EXEC_'+(r.error.code||'FAILED'));return r;}
if(!/^package:/m.test(call(['shell','pm','path',pkg]).stdout))throw Error('HOST_NOT_INSTALLED');
if(/^package:/m.test(call(['shell','pm','path',driver]).stdout))throw Error('DIAGNOSTIC_DRIVER_ALREADY_PRESENT');
// MIUI asks before an adb install; tap only its "continue" button for our own driver.
async function install(){
 call(['shell','input','keyevent','KEYCODE_WAKEUP']);call(['shell','wm','dismiss-keyguard']);
 const child=spawn(adb,['-s',serial,'install','-r',apk],{windowsHide:true});let out='',ended=false;
 const result=new Promise(resolve=>{child.stdout.on('data',b=>out+=b);child.stderr.on('data',b=>out+=b);child.on('close',status=>{ended=true;resolve({status,out});});});
 const timer=setTimeout(()=>child.kill(),40000);
 try{for(let i=0;i<6&&!ended;i++){await new Promise(r=>setTimeout(r,1500));if(ended)break;const file='/data/local/tmp/io-agent-install-window.xml';
  try{call(['shell','uiautomator','dump',file],8000);const xml=call(['exec-out','cat',file],5000).stdout;
   if(xml.includes('iO Agent UI test driver')){const m=/text="继续安装"[^>]*enabled="true"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/.exec(xml);if(m)call(['shell','input','tap',String((+m[1]+ +m[3])>>1),String((+m[2]+ +m[4])>>1)],3000);}
  }finally{call(['shell','rm','-f',file],5000);}}
  return await result;}finally{clearTimeout(timer);}
}
let installed=false;
try{
 const r=await install();installed=r.status===0&&/\bSuccess\b/.test(r.out);if(!installed)throw Error(/INSTALL_FAILED_[A-Z_]+/.exec(r.out)?.[0]||'INSTALL_OUTCOME_UNCONFIRMED');
 const run=call(['shell','am','instrument','-w','-e','probe_id',nonce,driver+'/'+driver+'.LifelogDetailShapeProbe'],180000);
 const values={};for(const line of run.stdout.split(/\r?\n/)){const m=/^INSTRUMENTATION_RESULT: ([a-z_]+)=(.*)$/.exec(line);if(m)values[m[1]]=m[2];}
 if(values.error)throw Error('PROBE_'+values.error);
 const pulled=call(['exec-out','cat',output],30000);if(pulled.status!==0||!pulled.stdout.trim())throw Error('REPORT_UNAVAILABLE');
 const report=JSON.parse(pulled.stdout);if(report.probe_id!==nonce||report.read_only!==true||report.network_requests!==0)throw Error('REPORT_SCOPE_INVALID');
 fs.writeFileSync(destination,JSON.stringify(report,null,1)+'\n');console.log('routes='+Object.keys(report.routes).length+' report='+path.relative(process.cwd(),destination));
}finally{
 call(['shell','rm','-f',output]);
 if(installed||/^package:/m.test(call(['shell','pm','path',driver]).stdout)){const u=call(['uninstall',driver],30000);console.log('driver_removed='+/Success/.test(u.stdout));}
}
