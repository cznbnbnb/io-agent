import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const workspace=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..'),addon=path.join(workspace,'rebuild/android-app');
const out=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'io-native-todo-runtime-'));
const sources=['NativeTodoRuntime','NativeTodoSession','Host107Ota','OfficialTodoCreate','OfficialLifelogJson','AtomicDocument','WireJson','TaskWire','TaskConnection'].map(name=>path.join(addon,'src/com/turboio/addon',name+'.java')).concat(['OtaFrame','BoundedJson'].map(name=>path.join(addon,'upstream/android-addon/src/com/turboio/addon',name+'.java')),path.join(workspace,'tools/android/NativeTodoRuntimeTest.java'));
const stubs={
 'android/content/Context.java':`package android.content;public final class Context {private final java.io.File files;public Context(java.io.File files){this.files=files;}public Context getApplicationContext(){return this;}public java.io.File getFilesDir(){return files;}}`,
 'android/os/Looper.java':`package android.os;public final class Looper {private static final Looper MAIN=new Looper();private static final Thread OWNER=Thread.currentThread();public static Looper getMainLooper(){return MAIN;}public static Looper myLooper(){return Thread.currentThread()==OWNER?MAIN:null;}}`,
 'android/os/SystemClock.java':`package android.os;public final class SystemClock {public static long elapsedRealtime(){return System.nanoTime()/1000000;}}`,
 'android/os/Handler.java':`package android.os;import java.util.*;import java.util.concurrent.*;public final class Handler {private static final BlockingQueue<Runnable> ready=new LinkedBlockingQueue<>();private static final Map<Runnable,Long> delayed=Collections.synchronizedMap(new LinkedHashMap<>());public Handler(Looper l){if(l!=Looper.getMainLooper())throw new AssertionError("Unexpected handler looper");}public boolean post(Runnable r){return ready.offer(r);}public boolean postDelayed(Runnable r,long ms){delayed.put(r,ms);return true;}public void removeCallbacks(Runnable r){ready.removeIf(v->v==r);delayed.remove(r);}public static Runnable next(long ms)throws InterruptedException{return ready.poll(ms,TimeUnit.MILLISECONDS);}public static boolean pending(Runnable r){return ready.contains(r)||delayed.containsKey(r);}public static boolean fireDelayed(long ms){if(Looper.myLooper()!=Looper.getMainLooper())throw new AssertionError("Delayed dispatch must be main");Runnable work=null;synchronized(delayed){for(Map.Entry<Runnable,Long> entry:delayed.entrySet())if(entry.getValue()==ms){work=entry.getKey();break;}if(work!=null)delayed.remove(work);}if(work==null)return false;work.run();return true;}public static void clear(){ready.clear();delayed.clear();}}`,
 'android/util/Log.java':`package android.util;public final class Log {public static final java.util.List<String> lines=new java.util.concurrent.CopyOnWriteArrayList<>();public static int w(String tag,String message){lines.add(message);return 0;}public static int i(String tag,String message){lines.add(message);return 0;}public static void clear(){lines.clear();}}`,
};
const report={schema:1,at:new Date().toISOString(),scope:'Real NativeTodoRuntime observer/decision/report callbacks, durable session/create boundary and original Host107Ota thread guard; synthetic Android scheduling and account/native/HTTP boundaries',device:false,network:false,official_write_executed:false,passed:false};
function run(command,args){const result=spawnSync(command,args,{cwd:workspace,encoding:'utf8',timeout:30000,maxBuffer:1048576});if(result.error)throw result.error;if(result.status!==0)throw Error(result.stderr||result.stdout||'TODO_RUNTIME_TEST_FAILED');return result.stdout;}
try{
 const generated=[];for(const [name,source] of Object.entries(stubs)){const file=path.join(out,'stubs',name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,source);generated.push(file);}
 const classes=path.join(out,'classes');fs.mkdirSync(classes);
 run('javac',['-encoding','UTF-8','-d',classes,...generated,...sources]);
 const text=run('java',['-cp',classes,'com.turboio.addon.NativeTodoRuntimeTest',path.join(out,'current-data')]);
 const result=/^Native todo runtime: (\d+) checks passed; real observer\/session\/create and Host107Ota main guard, synthetic Android\/transports\s*$/.exec(text);if(!result)throw Error('TODO_RUNTIME_RESULT_INVALID');report.checks=Number(result[1]);
 // Restore only the old link lookup location in an isolated compiled copy.
 // The same test must fail on the real Host107Ota OTA_THREAD assertion.
 const file=sources[0],current=fs.readFileSync(file,'utf8');
 const before='else r.main.post(()->{Fixed60Session.Link current=Host107Ota.link();r.io.execute(()->{try{';
 const after='r.main.post(()->r.failShown("TODO_ACTION_FAILED"));}});});';
 if(!current.includes(before)||!current.includes(after))throw Error('TODO_RUNTIME_OLD_THREAD_FIXTURE_STALE');
 const old=current.replace(before,'else r.io.execute(()->{try{Fixed60Session.Link current=Host107Ota.link();').replace(after,'r.main.post(()->r.failShown("TODO_ACTION_FAILED"));}});');
 const oldPath=path.join(out,'old/NativeTodoRuntime.java');fs.mkdirSync(path.dirname(oldPath));fs.writeFileSync(oldPath,old);
 run('javac',['-encoding','UTF-8','-cp',classes,'-d',classes,oldPath]);
 const previous=spawnSync('java',['-cp',classes,'com.turboio.addon.NativeTodoRuntimeTest',path.join(out,'old-data')],{cwd:workspace,encoding:'utf8',timeout:15000,maxBuffer:1048576});
 if(previous.error||previous.status!==1||!previous.stderr.includes('AssertionError: TODO_DECISION_MAIN_LINK:')||!previous.stderr.includes('OTA_THREAD'))throw Error('TODO_RUNTIME_OLD_THREAD_NOT_DETECTED');
 report.old_io_link_regression_detected=true;report.old_io_link_failure=previous.stderr.split('\n').find(line=>line.includes('AssertionError:'));
 // With the thread fix retained, restoring the former exception cleanup must
 // also fail: release cancelled the timeout but left durable state at SHOWN.
 const oldCleanup=current.replace('r.main.post(()->r.failShown("TODO_ACTION_FAILED"));','r.main.post(r::release);');
 if(oldCleanup===current)throw Error('TODO_RUNTIME_OLD_CLEANUP_FIXTURE_STALE');fs.writeFileSync(oldPath,oldCleanup);run('javac',['-encoding','UTF-8','-cp',classes,'-d',classes,oldPath]);
 const stranded=spawnSync('java',['-cp',classes,'com.turboio.addon.NativeTodoRuntimeTest',path.join(out,'old-cleanup-data')],{cwd:workspace,encoding:'utf8',timeout:15000,maxBuffer:1048576});
 if(stranded.error||stranded.status!==1||!stranded.stderr.includes('AssertionError: TODO_DECISION_TERMINAL: phase=SHOWN, timeout_pending=false'))throw Error('TODO_RUNTIME_OLD_CLEANUP_NOT_DETECTED');
 report.old_release_stranded_shown_detected=true;report.old_release_failure=stranded.stderr.split('\n').find(line=>line.includes('AssertionError:'));
 report.passed=true;report.sources=[...sources,fileURLToPath(import.meta.url)].map(file=>({path:path.relative(workspace,file),sha256:crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')}));
}finally{fs.rmSync(out,{recursive:true,force:true});}
report.temporary_fixture_removed=!fs.existsSync(out);console.log(JSON.stringify(report));
