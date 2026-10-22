package com.turboio.androidtests;

import android.app.*;import android.content.*;import android.os.*;import java.io.*;import java.lang.reflect.*;import java.nio.charset.StandardCharsets;import java.nio.file.*;import java.security.*;import java.util.*;import java.util.concurrent.*;import java.util.concurrent.atomic.*;import org.json.*;

/** Feed verified synthetic PCM to one official external-data ASR task. Never opens a microphone. */
public final class OfficialAsrProbe extends Instrumentation {
 private ClassLoader loader;private String token;private File external;private Object voice;private long began;
 private final JSONArray callbacks=new JSONArray();private final AtomicBoolean stopRequested=new AtomicBoolean(),accepted=new AtomicBoolean(),engineEnd=new AtomicBoolean();
 private final AtomicReference<String> error=new AtomicReference<>("");private final CountDownLatch startResult=new CountDownLatch(1);
 private final AtomicBoolean stopAccepted=new AtomicBoolean();private final AtomicReference<String> stopState=new AtomicReference<>("");
 private final JSONObject report=new JSONObject();private final ScheduledExecutorService cutoff=Executors.newSingleThreadScheduledExecutor();
 private Bundle args;
 interface Work{void run()throws Exception;}
 private Class<?> type(String suffix)throws Exception{return loader.loadClass("com.turboio.addon."+suffix);}
 private Class<?> voiceType(String suffix)throws Exception{return getContext().getClassLoader().loadClass("com.turboio.androidtests.voice."+suffix);}
 private Object call(Object owner,String name,Class<?>[] signature,Object...values)throws Exception{Class<?> c=owner instanceof Class?(Class<?>)owner:owner.getClass();Method m=c.getDeclaredMethod(name,signature);m.setAccessible(true);return m.invoke(owner instanceof Class?null:owner,values);}
 private void main(Work work)throws Exception{AtomicReference<Throwable> bad=new AtomicReference<>();runOnMainSync(()->{try{work.run();}catch(Throwable t){bad.set(t);}});if(bad.get()!=null)throw new Exception(bad.get());}
 private static void check(boolean ok,String code){if(!ok)throw new IllegalStateException(code);}
 private synchronized void phase(String value)throws Exception{JSONObject j=new JSONObject().put("probe_id",token).put("phase",value);try(FileOutputStream out=new FileOutputStream(new File(external,"io-agent-asr-probe-state.json"))){out.write(j.toString().getBytes(StandardCharsets.UTF_8));out.getFD().sync();}}
 private void stop(){if(voice!=null&&stopRequested.compareAndSet(false,true))try{stopAccepted.set(Boolean.TRUE.equals(call(voice,"stop",new Class<?>[]{String.class},token)));stopState.set(String.valueOf(call(voice,"state",new Class<?>[0])));}catch(Exception failure){error.compareAndSet("","ASR_STOP_FAILED");}}
 private static String sha(byte[] bytes)throws Exception{StringBuilder out=new StringBuilder();for(byte b:MessageDigest.getInstance("SHA-256").digest(bytes))out.append(String.format(Locale.ROOT,"%02x",b&255));return out.toString();}
 @Override public void onCreate(Bundle args){super.onCreate(args);this.args=args;start();}
 @Override public void onStart(){Bundle result=new Bundle();boolean started=false,released=false;long sent=0,silence=0;try{
  loader=getTargetContext().getClassLoader();token=args.getString("probe_id","");check(token.matches("[a-f0-9]{32}"),"PROBE_ID_INVALID");external=getTargetContext().getExternalFilesDir(null);check(external!=null,"EXPORT_UNAVAILABLE");
  JSONObject guard=new JSONObject(new String(Files.readAllBytes(new File(external,"io-agent-asr-probe-control.json").toPath()),StandardCharsets.UTF_8));long remaining=guard.getLong("expires_at")-System.currentTimeMillis();check(token.equals(guard.getString("probe_id"))&&guard.getBoolean("pc_guard_armed")&&remaining>=30000&&remaining<=65000,"EXTERNAL_CUTOFF_NOT_ARMED");
  byte[] pcm=Files.readAllBytes(new File(external,"official-asr-synthetic.pcm").toPath());check(pcm.length>=96000&&pcm.length<=480000&&pcm.length%2==0&&sha(pcm).equals(guard.getString("pcm_sha256")),"SYNTHETIC_SOURCE_NOT_VERIFIED");long nonzero=0;for(int i=0;i<pcm.length;i+=2)if(pcm[i]!=0||pcm[i+1]!=0)nonzero++;check(nonzero>16000,"SYNTHETIC_SOURCE_SILENT");report.put("schema",1).put("probe_id",token).put("source_sha256",sha(pcm)).put("source_bytes",pcm.length).put("source_nonzero_samples",nonzero).put("physical_microphone_requested",false).put("glasses_messages_sent",false).put("agent_started",false);phase("waiting_for_host");
  getTargetContext().startActivity(new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER).setClassName(getTargetContext(),"com.rayneo.venus.MainActivity").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
  Object plugin=null;long until=SystemClock.elapsedRealtime()+15000;do{try{Object engine=loader.loadClass("y8.d").getField("b").get(null);if(engine!=null){Object registry=engine.getClass().getField("d").get(engine);Object map=registry.getClass().getField("a").get(registry);Object wrapper=((Map<?,?>)map).get(loader.loadClass("com.rayneo.rayneo_venus_sdk_plugin.f"));if(wrapper!=null){plugin=wrapper.getClass().getField("y").get(wrapper);if(plugin!=null&&plugin.getClass()==loader.loadClass("m8.k"))break;}}}catch(Exception ignored){}plugin=null;Thread.sleep(250);}while(SystemClock.elapsedRealtime()<until);check(plugin!=null,"OFFICIAL_PLUGIN_NOT_READY");report.put("official_wrapper_resolved",true);
  main(()->{check(Boolean.TRUE.equals(call(type("Host107Login"),"loggedIn",new Class<?>[0])),"LOGIN_REQUIRED");check(Boolean.FALSE.equals(call(type("FirmwareQueue"),"busy",new Class<?>[0]))&&Boolean.FALSE.equals(call(type("NativeTransfer"),"busy",new Class<?>[0])),"DEVICE_LANE_BUSY");});
  Object helper=plugin.getClass().getField("u").get(plugin);JSONObject flags=new JSONObject();for(String flag:new String[]{"j","k","l","m"})flags.put(flag,helper.getClass().getField(flag).get(helper));report.put("host_flags_before",flags).put("adapter_source","production_source_relocated_in_test_driver");
  Class<?> listener=voiceType("Host107VoiceTask$Listener");Object sink=Proxy.newProxyInstance(listener.getClassLoader(),new Class<?>[]{listener},(proxy,method,values)->{
   if(method.getDeclaringClass()==Object.class){if(method.getName().equals("hashCode"))return System.identityHashCode(proxy);if(method.getName().equals("equals"))return proxy==values[0];return "bounded-synthetic-asr";}
   switch(method.getName()){
    case "started":accepted.set(Boolean.TRUE.equals(values[0]));startResult.countDown();break;
    case "engineAudio":if(Boolean.FALSE.equals(values[0]))engineEnd.set(true);break;
    case "error":error.compareAndSet("","VOICE_ENGINE_ERROR");break;
    case "result":synchronized(callbacks){if(callbacks.length()>=128){error.compareAndSet("","CALLBACK_BUDGET");break;}callbacks.put(new JSONObject().put("elapsed_ms",SystemClock.elapsedRealtime()-began).put("finished",values[1]).put("text",values[0]));}break;
   }return null;
  });
  final Object[] environment={null};main(()->{environment[0]=call(voiceType("Host107VoiceEnvironment"),"current",new Class<?>[]{String.class},"zh-CN");voice=call(environment[0],"prepare",new Class<?>[]{String.class,listener},token,sink);});report.put("task_created",true);phase("starting_engine");began=SystemClock.elapsedRealtime();
  cutoff.schedule(this::stop,20,TimeUnit.SECONDS);report.put("independent_engine_cutoff_ms",20000);started=true;report.put("engine_start_requested",true);main(()->check(Boolean.TRUE.equals(call(voice,"start",new Class<?>[]{String.class},token)),"ASR_START_NOT_ADMITTED"));check(startResult.await(4000,TimeUnit.MILLISECONDS)&&accepted.get(),"ASR_START_REJECTED");
  phase("feeding_synthetic_pcm");for(int offset=0;offset<pcm.length&&!stopRequested.get();offset+=640){check(error.get().isEmpty(),error.get());int size=Math.min(640,pcm.length-offset);call(voice,"pcm",new Class<?>[]{String.class,byte[].class},token,Arrays.copyOfRange(pcm,offset,offset+size));sent+=size;Thread.sleep(20);}
  check(sent==pcm.length,"PCM_FEED_INTERRUPTED");
  if("true".equals(args.getString("input_end"))){phase("sealing_external_input");call(voice,"sealInput",new Class<?>[]{String.class},token);report.put("input_end_notified",true);Thread.sleep(2500);}
  else{for(int i=0;i<50&&!stopRequested.get();i++){call(voice,"pcm",new Class<?>[]{String.class,byte[].class},token,new byte[640]);silence+=640;Thread.sleep(20);}Thread.sleep(700);}
  phase("stopping_engine");stop();
  long end=SystemClock.elapsedRealtime()+8000;boolean stopped=false;do{try{stopped=Boolean.TRUE.equals(call(voice,"engineStopped",new Class<?>[0]));}catch(Exception ignored){}if(!stopped)Thread.sleep(100);}while(!stopped&&SystemClock.elapsedRealtime()<end);report.put("engine_end_callback",engineEnd.get()).put("engine_stopped_verified",stopped);check(stopped,"ASR_STOP_UNCONFIRMED");call(voice,"release",new Class<?>[]{String.class},token);released=true;report.put("stock_environment_still_idle",call(environment[0],"idle",new Class<?>[0]));phase("released");
 }catch(Throwable failure){while(failure.getCause()!=null)failure=failure.getCause();String code=failure.getMessage();try{report.put("error",code!=null&&code.matches("[A-Z_]{3,80}")?code:"ASR_PROBE_FAILED").put("failure_class",failure.getClass().getSimpleName());}catch(JSONException ignored){}}
 finally{if(started&&!released)stop();if(voice!=null&&!started)try{call(voice,"release",new Class<?>[]{String.class},token);released=true;}catch(Exception ignored){}cutoff.shutdownNow();try{
  report.put("engine_start_requested",started).put("released",released).put("pcm_bytes_sent",sent).put("trailing_silence_bytes",silence).put("started_callback_accepted",accepted.get()).put("engine_end_callback",engineEnd.get()).put("stop_task_accepted",stopAccepted.get()).put("state_after_stop",stopState.get()).put("callbacks",callbacks);if(!error.get().isEmpty())report.put("callback_error",error.get());
  byte[] bytes=report.toString(2).getBytes(StandardCharsets.UTF_8);check(bytes.length<=262144,"EXPORT_BUDGET");if(external!=null)try(FileOutputStream out=new FileOutputStream(new File(external,"io-agent-official-asr-probe.json"))){out.write(bytes);out.getFD().sync();}result.putBoolean("report_exported",true);result.putBoolean("own_asr_released",released);result.putBoolean("physical_capture_requested",false);finish(Activity.RESULT_OK,result);
 }catch(Exception exportFailure){result.putString("failure_class",exportFailure.getClass().getSimpleName());finish(Activity.RESULT_CANCELED,result);}}}
}
