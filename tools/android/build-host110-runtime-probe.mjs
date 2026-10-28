import fs from 'node:fs';import path from 'node:path';import {spawnSync} from 'node:child_process';
const root=path.resolve('rebuild/android-app'),out=path.join(root,'build/host110-runtime-probe'),sdk=path.join(root,'.tools/sdk'),tools=path.join(sdk,'build-tools/36.0.0'),jar=path.join(sdk,'platforms/android-36/android.jar');
fs.mkdirSync(path.join(out,'classes'),{recursive:true});fs.mkdirSync(path.join(out,'dex'),{recursive:true});
const manifest=path.join(out,'AndroidManifest.xml');fs.writeFileSync(manifest,'<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="com.turboio.hostprobe.codex" android:versionCode="1" android:versionName="1"><uses-sdk android:minSdkVersion="29" android:targetSdkVersion="36"/><application android:label="iO host compatibility probe" android:allowBackup="false"/><instrumentation android:name="com.turboio.androidtests.Host110RuntimeProbe" android:targetPackage="com.rayneo.venus.pub"/></manifest>');
const env={...process.env,IO_AGENT_SIGN_PASS:fs.readFileSync(path.join(root,'.private/signing/keystore-pass.txt'),'utf8').trim()};
function run(command,args){const r=spawnSync(command,args,{env,encoding:'utf8',timeout:60000,maxBuffer:1048576});if(r.error)throw r.error;if(r.status!==0)throw Error(r.stderr||'HOST110_RUNTIME_PROBE_BUILD_FAILED');}
run('javac',['-encoding','UTF-8','-source','8','-target','8','-cp',jar,'-d',path.join(out,'classes'),'tools/android/Host110RuntimeProbe.java']);
run('jar',['cf',path.join(out,'probe.jar'),'-C',path.join(out,'classes'),'.']);
run('java',['-cp',path.join(tools,'lib/d8.jar'),'com.android.tools.r8.D8','--lib',jar,'--min-api','29','--output',path.join(out,'dex'),path.join(out,'probe.jar')]);
run(path.join(tools,'aapt2'),['link','--manifest',manifest,'-I',jar,'-o',path.join(out,'unsigned.apk')]);
run('python3',['-c','import zipfile,sys\nwith zipfile.ZipFile(sys.argv[1],"a") as z:z.write(sys.argv[2],"classes.dex",compress_type=zipfile.ZIP_DEFLATED)',path.join(out,'unsigned.apk'),path.join(out,'dex/classes.dex')]);
run(path.join(tools,'zipalign'),['-f','4',path.join(out,'unsigned.apk'),path.join(out,'aligned.apk')]);
run('java',['-jar',path.join(tools,'lib/apksigner.jar'),'sign','--ks',path.join(root,'.private/signing/io-agent.jks'),'--ks-key-alias','io-agent','--ks-pass','env:IO_AGENT_SIGN_PASS','--key-pass','env:IO_AGENT_SIGN_PASS','--v1-signing-enabled','false','--v2-signing-enabled','true','--v4-signing-enabled','false','--out',path.join(out,'probe.apk'),path.join(out,'aligned.apk')]);
run('java',['-jar',path.join(tools,'lib/apksigner.jar'),'verify',path.join(out,'probe.apk')]);
for(const n of ['unsigned.apk','aligned.apk'])fs.unlinkSync(path.join(out,n));
console.log(JSON.stringify({diagnostic_only:true,apk:path.relative(process.cwd(),path.join(out,'probe.apk')),bytes:fs.statSync(path.join(out,'probe.apk')).size}));
