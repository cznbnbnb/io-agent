import {writeTestProductInfo} from './profile.mjs';
import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';import {spawnSync} from 'node:child_process';import crypto from 'node:crypto';
import {verifyHost} from '../../rebuild/android-app/host-110.mjs';
const workspace=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..'),root=path.join(workspace,'rebuild/android-app'),out=path.join(root,'build/login-tests');fs.mkdirSync(out,{recursive:true});
function run(command,args){const r=spawnSync(command,args,{cwd:workspace,stdio:'inherit'});if(r.error||r.status!==0)throw new Error('Login verification failed: '+command);}
verifyHost(path.join(root,'build/host-110'));
run('python3',['-S','-X','utf8','tools/android/test-manifest.py']);
const files=['src/com/turboio/addon/Host107Login.java','src/com/turboio/addon/LoginRecordsCache.java','src/com/turboio/addon/Host107Abi.java','src/com/turboio/addon/HeadGestureGate.java','src/com/turboio/addon/CardInputClosure.java','src/com/turboio/addon/SuggestionGate.java','src/com/turboio/addon/HeadGestureSession.java','src/com/turboio/addon/FixedPeerHash.java','src/com/turboio/addon/NavReflect.java','src/com/turboio/addon/FirmwareQueue.java','src/com/turboio/addon/Fixed60Firmware.java','src/com/turboio/addon/Fixed60Profile.java','src/com/turboio/addon/WireJson.java','upstream/android-addon/src/com/turboio/addon/BoundedJson.java','upstream/android-addon/src/com/turboio/addon/OtaFrame.java'].map(f=>path.join(root,f));
files.push(writeTestProductInfo(out));
files.push(...['OfficialAccountBinding','MaterialWire','MaterialConnection','TaskWire','TaskConnection'].map(n=>path.join(root,'src/com/turboio/addon/'+n+'.java')));
for(const [name,source] of [['android/content/Context.java','package android.content; public class Context {}'],
 ['android/util/Log.java','package android.util; public class Log { public static int i(String tag,String text){return 0;} }']]){
 const file=path.join(out,'stubs',name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,source);files.push(file);
}
// This JVM suite never opens the SDK queue. Its new recording dependency needs
// a compile-only, fail-closed boundary; Android compilation uses the real class.
const recordingStub=path.join(out,'stubs/com/turboio/addon/Host107Recording.java');fs.mkdirSync(path.dirname(recordingStub),{recursive:true});fs.writeFileSync(recordingStub,'package com.turboio.addon; final class Host107Recording { static boolean allowQueue(Object message,String kind,String destination,byte[] frozen){return false;} }');files.push(recordingStub);
for(const [name,source] of [['RecordingTrace','static void frame(String direction,int kind,byte[] value){}'],['LifelogTrace','static void frame(String direction,byte[] value){}'],['TaskAttention','static boolean blocksNotification(byte[] value){return true;}']]){
 const file=path.join(out,'stubs/com/turboio/addon',name+'.java');fs.writeFileSync(file,'package com.turboio.addon; final class '+name+' { '+source+' }');files.push(file);
}
run('javac',['-encoding','UTF-8','-d',out,...files,'tools/android/LoginSessionTest.java']);
run('java',['-cp',out,'com.turboio.addon.LoginSessionTest']);
fs.writeFileSync(path.join(root,'login-test-results-2026-10-20.json'),JSON.stringify({schema:1,at:new Date().toISOString(),overall:'passed_for_static_and_synthetic_scope',stock_launcher_and_private_old_entry:'passed',exact_stock_storage_abi:'passed',synthetic_session_policy:'passed',actual_account_login:false,phone_operations:false,sources:files.map(file=>({path:path.relative(root,file),sha256:crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')}))},null,2)+'\n');
