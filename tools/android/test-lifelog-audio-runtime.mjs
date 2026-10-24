import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const workspace=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const root=path.join(workspace,'rebuild/android-app'),out=fs.mkdtempSync(path.join(os.tmpdir(),'io-audio-runtime-'));
// Only Android/native-account boundaries are substituted. The installed runtime,
// collector and filesystem journals below are the actual production sources.
const stubs={
 'android/content/Context.java':`package android.content; public class Context { private final java.io.File files; public Context(){this(new java.io.File("."));} public Context(java.io.File f){files=f;} public Context getApplicationContext(){return this;} public java.io.File getFilesDir(){return files;} public android.content.pm.ApplicationInfo getApplicationInfo(){android.content.pm.ApplicationInfo info=new android.content.pm.ApplicationInfo();info.dataDir=files.getAbsolutePath();return info;} }`,
 'android/content/pm/ApplicationInfo.java':`package android.content.pm; public class ApplicationInfo { public String dataDir="."; }`,
 'android/os/Looper.java':`package android.os; public class Looper { public static Looper getMainLooper(){return new Looper();} }`,
 'android/os/Handler.java':`package android.os; public class Handler { public static volatile boolean enabled,hold; private static final java.util.ArrayDeque<Runnable> waiting=new java.util.ArrayDeque<>(); public Handler(Looper l){} private static void dispatch(Runnable r){Thread t=new Thread(r,"fake-main");t.setDaemon(true);t.start();} public boolean post(Runnable r){synchronized(waiting){if(enabled){if(hold)waiting.add(r);else dispatch(r);}}return true;} public static void release(){synchronized(waiting){hold=false;while(!waiting.isEmpty())dispatch(waiting.remove());}} }`,
 'android/os/SystemClock.java':`package android.os; public class SystemClock { public static volatile long now=1000; public static long elapsedRealtime(){return now;} public static long elapsedRealtimeNanos(){return now*1000000;} }`,
 'android/util/Log.java':`package android.util; public class Log { public static int w(String t,String m){return 0;} public static int i(String t,String m){return 0;} }`,
 'com/turboio/addon/RuntimeNativeStubs.java':`package com.turboio.addon;
 class OfficialAccountBinding { final String binding; final String accountId="test"; OfficialAccountBinding(String b){binding=b;} boolean same(OfficialAccountBinding a){return a!=null&&binding.equals(a.binding);} java.io.File cacheFile(java.io.File f){return f;} }
 class Host107Login { static volatile int reads; static volatile long readCostMs,delayMs; static volatile OfficialAccountBinding active; static OfficialAccountBinding account(){reads++;android.os.SystemClock.now+=readCostMs;try{Thread.sleep(delayMs);}catch(InterruptedException e){Thread.currentThread().interrupt();return null;}return active;} }
 class Fixed60Session { static class Link { String peer; long generation; } }
 class Host107Ota { static Fixed60Session.Link link(){Fixed60Session.Link l=new Fixed60Session.Link();l.peer="peer-test";l.generation=1;return l;} }
 class NavReflect { static Object call(Object o,String n,Object...a)throws Exception{return o.getClass().getMethod(n).invoke(o);} }
 class OfficialHiveCache { static Object read(java.io.File f){return null;} static java.util.List<String> sourceReferences(Object o){return java.util.Collections.emptyList();} }
 class OfficialLifelogSnapshot { static class Source { String sourceType,sourceId; } }
`,
 'com/rayneo/rayneo_venus_sdk_plugin/e.java':`package com.rayneo.rayneo_venus_sdk_plugin; public class e { public static java.util.concurrent.CopyOnWriteArrayList<Object> c=new java.util.concurrent.CopyOnWriteArrayList<>();static {c.add(new t8.b$b());} }`,
 't8/b$b.java':`package t8; public class b$b {public Object a=new Owner();public static class Owner {public Object b=new o8.m();}}`,
 'o8/m.java':`package o8; public class m {public Object C=new Config();public static class Config {public String getTaskId(){return "task-one";}public String getDialogId(){return "task-one";}public String getUserName(){return "test";}public String getInputAudioFormat(){return "opus";}public Integer getInputAudioRate(){return 16000;}}}`,
};
const sources=['LifelogAudioRuntime','LifelogAudioCollector','LifelogAudioHealth','LifelogAudioLibrary','LifelogAudioManager','LifelogAudioArchive','AlwaysOnAudioBatch','AlwaysOnWire','FixedPeerHash','AtomicDocument','WireJson'].map(n=>path.join(root,'src/com/turboio/addon',n+'.java')).concat(path.join(root,'upstream/android-addon/src/com/turboio/addon/BoundedJson.java'),...['LifelogAudioRuntimeTest','LifelogAudioRuntimeInputTest'].map(n=>path.join(workspace,'tools/android',n+'.java')));
function run(command,args){const r=spawnSync(command,args,{cwd:workspace,encoding:'utf8',timeout:60000,maxBuffer:1048576});if(r.error||r.status!==0)throw Error(r.stderr||'AUDIO_RUNTIME_TEST_FAILED');return r.stdout;}
let report;
try{
 const fixtures=Object.entries(stubs).map(([name,source])=>{const p=path.join(out,'stubs',name);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,source);return p;});
 const classes=path.join(out,'classes'),data=path.join(out,'data');fs.mkdirSync(classes);fs.mkdirSync(data);
 run('javac',['-encoding','UTF-8','-d',classes,...sources,...fixtures]);
 const text=run('java',['-cp',classes,'com.turboio.addon.LifelogAudioRuntimeTest',data]);console.log(text.trim());
 const inputData=path.join(out,'input-data');fs.mkdirSync(inputData);const inputText=run('java',['-cp',classes,'com.turboio.addon.LifelogAudioRuntimeInputTest',inputData]);console.log(inputText.trim());
 // Prove that this is a regression detector: restore only the previous blocking
 // writer guard in a temporary compiled copy, never in the working sources.
 const source=sources[0],old=fs.readFileSync(source,'utf8').replace(/private void writerGuard\(Token bound\)throws IOException\{[^\n]*\}/,'private void writerGuard(Token bound)throws IOException{account(bound.account);LifelogAudioLibrary.require(current(bound),"AUDIO_CAPTURE_CONTEXT_CHANGED");}');
 if(old===fs.readFileSync(source,'utf8'))throw Error('AUDIO_RUNTIME_OLD_GUARD_FIXTURE');
 const oldPath=path.join(out,'regression/LifelogAudioRuntime.java');fs.mkdirSync(path.dirname(oldPath));fs.writeFileSync(oldPath,old);
 run('javac',['-encoding','UTF-8','-cp',classes,'-d',classes,oldPath]);
 const oldData=path.join(out,'old-data');fs.mkdirSync(oldData);
 const regression=spawnSync('java',['-cp',classes,'com.turboio.addon.LifelogAudioRuntimeTest',oldData],{encoding:'utf8',timeout:15000});
 if(regression.error||regression.status!==1||!regression.stderr.includes('AssertionError'))throw Error('AUDIO_RUNTIME_REGRESSION_NOT_DETECTED');
 console.log('Previous blocking guard failed the same growing-journal test as expected.');
 const dropped=fs.readFileSync(source,'utf8').replace('boolean deferred=!self.current(bound);','boolean deferred=!self.current(bound);if(deferred){self.unverifiedInput++;self.refreshContext();return;}');
 if(dropped===fs.readFileSync(source,'utf8'))throw Error('AUDIO_RUNTIME_DROP_FIXTURE');fs.writeFileSync(oldPath,dropped);run('javac',['-encoding','UTF-8','-cp',classes,'-d',classes,oldPath]);
 const droppedData=path.join(out,'dropped-data');fs.mkdirSync(droppedData);const missing=spawnSync('java',['-cp',classes,'com.turboio.addon.LifelogAudioRuntimeInputTest',droppedData],{encoding:'utf8',timeout:15000});
 if(missing.error||missing.status!==1||!missing.stderr.includes('AssertionError'))throw Error('AUDIO_RUNTIME_INPUT_REGRESSION_NOT_DETECTED');console.log('Previous drop-on-expiry input failed the same deferred-input test as expected.');
 report={schema:1,at:new Date().toISOString(),passed:true,checks:Number(/runtime: (\d+)/.exec(text)[1]),input_checks:Number(/runtime input: (\d+)/.exec(inputText)[1]),old_blocking_guard_regression_detected:true,old_drop_on_expiry_regression_detected:true,scope:'Production runtime guards/input/collector with real growing filesystem journals; substituted Android clock/account/native boundaries. Deferred bytes, FIFO, timestamps, identity denial, expiry and memory backpressure verified. No physical continuity claim.',sources:[...sources,fileURLToPath(import.meta.url)].map(p=>({path:path.relative(root,p),sha256:crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')}))};
}finally{fs.rmSync(out,{recursive:true,force:true});}
report.temporary_fixture_removed=!fs.existsSync(out);
fs.writeFileSync(path.join(root,'build/lifelog-audio-runtime-tests.json'),JSON.stringify(report,null,2)+'\n');
