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
 private static Object field(Object owner,String name)throws Exception{Class<?> type=owner instanceof Class?(Class<?>)owner:owner.getClass();java.lang.reflect.Field field=type.getDeclaredField(name);field.setAccessible(true);return field.get(owner instanceof Class?null:owner);}
 // Exact host 1.0.10 read-only ownership metadata. No coordinates, account data,
 // callbacks, start/stop methods or network operations are accessed.
 private JSONObject hostState(Context context){JSONObject result=new JSONObject();try{
  ClassLoader loader=context.getClassLoader();Class<?> transfer=loader.loadClass("com.turboio.addon.NativeTransfer");java.lang.reflect.Method connected=transfer.getDeclaredMethod("connected");connected.setAccessible(true);result.put("glasses_connected",!((String)connected.invoke(null)).isEmpty());
  Object engine=field(loader.loadClass("u9.e"),"b"),registry=field(engine,"d");Map<?,?> plugins=(Map<?,?>)field(registry,"a");Object plugin=plugins.get(loader.loadClass("L8.w2"));result.put("map_plugin_present",plugin!=null);
  if(plugin!=null){Object service=field(plugin,"d");result.put("location_service_present",service!=null);if(service!=null){Object owner=field(service,"n");result.put("location_service_disposed",field(service,"j")).put("continuous_committed",field(owner,"i")).put("continuous_preparing",field(owner,"j")).put("pending_operations",((Map<?,?>)field(owner,"t")).size());
   Object settings=field(owner,"q");if(settings!=null){JSONObject values=new JSONObject();for(String key:new String[]{"a","b","c","d","e"})values.put(key,field(settings,key));result.put("continuous_settings",values);}
   Object oneShot=field(service,"m"),handle=field(oneShot,"h");result.put("oneshot_generation",field(oneShot,"m")).put("oneshot_force_fresh",field(oneShot,"l")).put("oneshot_waiters",((List<?>)field(oneShot,"i")).size()).put("oneshot_disposed",field(oneShot,"n")).put("oneshot_handle",handle==null?"":handle.getClass().getName());
   Object provider=field(owner,"h");if(provider==null&&handle!=null&&(handle.getClass().getName().equals("L8.M1$a")||handle.getClass().getName().equals("L8.M1$i")))provider=field(handle,"a");result.put("provider",provider==null?"":provider.getClass().getName());if(provider!=null&&provider.getClass().getName().equals("L8.m")){result.put("amap_continuous",field(provider,"k")).put("amap_oneshot_waiters",((List<?>)field(provider,"p")).size()).put("amap_oneshot_client",field(provider,"q")!=null);
    Object location=field(provider,"o"),client=field(provider,"q");if(client!=null){Object manager=field(client,"b");Object latest=field(manager,"a");if(latest!=null)location=latest;}if(location!=null)result.put("amap_last_error",location.getClass().getMethod("getErrorCode").invoke(location));
   }
   Map<?,?> cache=(Map<?,?>)field(field(oneShot,"a"),"b");result.put("cache_present",cache!=null);if(cache!=null)result.put("cache_age_ms",System.currentTimeMillis()-((Number)cache.get("timestamp")).longValue());
  }}
  result.put("read_completed",true);
 }catch(Exception unavailable){try{result.put("read_completed",false).put("failure_class",unavailable.getClass().getSimpleName());}catch(JSONException impossible){throw new IllegalStateException(impossible);}}return result;}
 @Override public void onStart(){Bundle done=new Bundle();try{
  String nonce=arguments.getString("probe_id","");if(!nonce.matches("[a-f0-9]{32}"))throw new IllegalArgumentException("PROBE_ID_INVALID");
  int seconds=Integer.parseInt(arguments.getString("seconds","15"));if(seconds<5||seconds>45)throw new IllegalArgumentException("PROBE_DURATION_INVALID");
  Context context=getTargetContext();((Application)context.getApplicationContext()).registerActivityLifecycleCallbacks(lifecycle);
  Intent launch=context.getPackageManager().getLaunchIntentForPackage(context.getPackageName());if(launch==null)throw new IllegalStateException("NO_LAUNCH_ACTIVITY");launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);context.startActivity(launch);
  // The runner also explicitly foregrounds the activity via adb. No timeout or
  // system setting changes; this process and its window end with instrumentation.
  SystemClock.sleep(15000);
  if("true".equals(arguments.getString("background","false"))){Intent home=new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);context.startActivity(home);SystemClock.sleep(3000);}
  Handler main=new Handler(Looper.getMainLooper());Thread mainThread=Looper.getMainLooper().getThread();AtomicBoolean waiting=new AtomicBoolean();
  List<Long> delays=Collections.synchronizedList(new ArrayList<>());Map<String,Integer> stacks=new HashMap<>();JSONObject before=counters();
  JSONArray hostStates=new JSONArray();long nextHostState=0;boolean captureHost="true".equals(arguments.getString("host_state","false"));
  long started=SystemClock.elapsedRealtime(),cpuStarted=android.os.Process.getElapsedCpuTime();int samples=0,mainWaiting=0,mainRunnable=0,foregroundSamples=0;
  while(SystemClock.elapsedRealtime()-started<seconds*1000L){
   if(captureHost&&SystemClock.elapsedRealtime()>=nextHostState){runOnMainSync(()->hostStates.put(hostState(context)));nextHostState=SystemClock.elapsedRealtime()+5000;}
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
  if(captureHost){report.put("host_states",hostStates);}if(captureHost)runOnMainSync(()->{try{report.put("host_state",hostState(context));}catch(JSONException impossible){throw new IllegalStateException(impossible);}});
  File destination=new File(context.getExternalFilesDir(null),"io-agent-ui-performance-"+nonce+".json");try(FileOutputStream stream=new FileOutputStream(destination)){stream.write(report.toString(1).getBytes(StandardCharsets.UTF_8));}
  done.putString("report",destination.getAbsolutePath());done.putLong("elapsed_ms",elapsed);done.putLong("cpu_ms",cpu);done.putInt("samples",samples);finish(Activity.RESULT_OK,done);
 }catch(Throwable failure){done.putString("error",failure.getClass().getSimpleName());finish(Activity.RESULT_CANCELED,done);}}
}
