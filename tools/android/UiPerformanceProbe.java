package com.turboio.androidtests;

import android.app.*;
import android.content.*;
import android.os.*;
import android.view.WindowManager;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.atomic.AtomicBoolean;
import org.json.*;

public final class UiPerformanceProbe extends Instrumentation {
 private Bundle arguments;
 private volatile boolean foreground;
 private final Application.ActivityLifecycleCallbacks lifecycle=new Application.ActivityLifecycleCallbacks(){
  public void onActivityResumed(Activity a){foreground=true;a.getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);}
  public void onActivityPaused(Activity a){foreground=false;a.getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);}
  public void onActivityCreated(Activity a,Bundle b){}public void onActivityStarted(Activity a){}public void onActivityStopped(Activity a){}public void onActivityDestroyed(Activity a){}public void onActivitySaveInstanceState(Activity a,Bundle b){}
 };
 @Override public void onCreate(Bundle arguments){super.onCreate(arguments);this.arguments=arguments;start();}
 private static JSONObject counters()throws Exception{
  JSONObject result=new JSONObject();File directory=new File("/proc/self/task");File[] entries=directory.listFiles();
  if(entries!=null)for(File entry:entries)try{
   String stat=read(new File(entry,"stat"));int end=stat.lastIndexOf(')');String[] parts=stat.substring(end+2).split(" ");
   result.put(entry.getName(),new JSONObject().put("name",stat.substring(stat.indexOf('(')+1,end)).put("ticks",Long.parseLong(parts[11])+Long.parseLong(parts[12])));
  }catch(Exception ended){}
  return result;
 }
 private static String read(File file)throws Exception{try(BufferedReader reader=new BufferedReader(new InputStreamReader(new FileInputStream(file),StandardCharsets.UTF_8))){return reader.readLine();}}
 private static JSONArray hottest(JSONObject before,JSONObject after)throws Exception{
  List<JSONObject> rows=new ArrayList<>();Iterator<String> keys=after.keys();
  while(keys.hasNext()){String id=keys.next();JSONObject row=after.getJSONObject(id),old=before.optJSONObject(id);if(old==null)continue;long delta=row.getLong("ticks")-old.getLong("ticks");if(delta>0)rows.add(new JSONObject().put("tid",id).put("name",row.getString("name")).put("cpu_ticks",delta));}
  rows.sort((left,right)->Long.compare(right.optLong("cpu_ticks"),left.optLong("cpu_ticks")));JSONArray result=new JSONArray();for(int index=0;index<Math.min(30,rows.size());index++)result.put(rows.get(index));return result;
 }
 @Override public void onStart(){Bundle done=new Bundle();try{
  String nonce=arguments.getString("probe_id","");if(!nonce.matches("[a-f0-9]{32}"))throw new IllegalArgumentException("PROBE_ID_INVALID");
  int seconds=Integer.parseInt(arguments.getString("seconds","15"));if(seconds<5||seconds>45)throw new IllegalArgumentException("PROBE_DURATION_INVALID");
  Context context=getTargetContext();((Application)context.getApplicationContext()).registerActivityLifecycleCallbacks(lifecycle);
  Intent launch=context.getPackageManager().getLaunchIntentForPackage(context.getPackageName());if(launch==null)throw new IllegalStateException("NO_LAUNCH_ACTIVITY");launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);context.startActivity(launch);
  // The runner also explicitly foregrounds the activity via adb. No timeout or
  // system setting changes; this process and its window end with instrumentation.
  SystemClock.sleep(15000);
  Handler main=new Handler(Looper.getMainLooper());Thread mainThread=Looper.getMainLooper().getThread();AtomicBoolean waiting=new AtomicBoolean();
  List<Long> delays=Collections.synchronizedList(new ArrayList<>());Map<String,Integer> stacks=new HashMap<>();JSONObject before=counters();
  long started=SystemClock.elapsedRealtime(),cpuStarted=android.os.Process.getElapsedCpuTime();int samples=0,mainWaiting=0,mainRunnable=0,foregroundSamples=0;
  while(SystemClock.elapsedRealtime()-started<seconds*1000L){
   if(waiting.compareAndSet(false,true)){long sent=SystemClock.elapsedRealtime();main.post(()->{delays.add(SystemClock.elapsedRealtime()-sent);waiting.set(false);});}
   Map<Thread,StackTraceElement[]> all=Thread.getAllStackTraces();samples++;if(foreground)foregroundSamples++;
   for(Map.Entry<Thread,StackTraceElement[]> entry:all.entrySet()){
    Thread thread=entry.getKey();if(thread==Thread.currentThread())continue;Thread.State state=thread.getState();
    boolean isMain=thread==mainThread;if(isMain){if(state==Thread.State.RUNNABLE)mainRunnable++;else mainWaiting++;}
    if(!isMain&&state!=Thread.State.RUNNABLE)continue;
    StackTraceElement[] frames=entry.getValue();if(frames.length==0)continue;
    if(!isMain&&(frames[0].getMethodName().equals("nativePollOnce")||frames[0].getMethodName().equals("poll")||frames[0].getMethodName().equals("epollWait")))continue;
    StringBuilder key=new StringBuilder(thread.getName()).append(" | ").append(state);
    for(int index=0;index<Math.min(18,frames.length);index++)key.append('\n').append(frames[index].getClassName()).append('.').append(frames[index].getMethodName());
    String signature=key.toString();if(stacks.size()<2000||stacks.containsKey(signature))stacks.put(signature,stacks.getOrDefault(signature,0)+1);
   }
   SystemClock.sleep(100);
  }
  long elapsed=SystemClock.elapsedRealtime()-started,cpu=android.os.Process.getElapsedCpuTime()-cpuStarted;JSONObject after=counters();
  List<Map.Entry<String,Integer>> ordered=new ArrayList<>(stacks.entrySet());ordered.sort((left,right)->Integer.compare(right.getValue(),left.getValue()));JSONArray stackRows=new JSONArray();for(int index=0;index<Math.min(80,ordered.size());index++)stackRows.put(new JSONObject().put("samples",ordered.get(index).getValue()).put("stack",ordered.get(index).getKey()));
  List<Long> latency; synchronized(delays){latency=new ArrayList<>(delays);}Collections.sort(latency);JSONArray delayRows=new JSONArray();for(Long delay:latency)delayRows.put(delay);
  JSONObject report=new JSONObject().put("schema",2).put("probe_id",nonce).put("version",context.getPackageManager().getPackageInfo(context.getPackageName(),0).versionName).put("pid",android.os.Process.myPid()).put("elapsed_ms",elapsed).put("cpu_ms",cpu).put("samples",samples).put("foreground_samples",foregroundSamples).put("main_runnable_samples",mainRunnable).put("main_waiting_samples",mainWaiting).put("main_ping_delays_ms",delayRows).put("cpu_threads",hottest(before,after)).put("stacks",stackRows).put("probe_network_requests",0).put("probe_product_data_modified",false);
  File destination=new File(context.getExternalFilesDir(null),"io-agent-ui-performance-"+nonce+".json");try(FileOutputStream stream=new FileOutputStream(destination)){stream.write(report.toString(1).getBytes(StandardCharsets.UTF_8));}
  done.putString("report",destination.getAbsolutePath());done.putLong("elapsed_ms",elapsed);done.putLong("cpu_ms",cpu);done.putInt("samples",samples);finish(Activity.RESULT_OK,done);
 }catch(Throwable failure){done.putString("error",failure.getClass().getSimpleName());finish(Activity.RESULT_CANCELED,done);}}
}
