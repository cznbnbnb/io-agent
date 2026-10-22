package com.turboio.androidtests;

import android.app.*;import android.content.*;import android.os.*;
import java.io.*;import java.lang.reflect.*;import java.nio.charset.StandardCharsets;import java.util.*;import java.util.concurrent.*;import java.util.concurrent.atomic.*;import org.json.*;

/** Two bounded existing-SDK launcher reads. No SDK initialization/reset, writes, card or capture. */
public final class LauncherReadProbe extends Instrumentation {
 private ClassLoader loader;private Object receiver;private String peer;private long generation;
 private final String lease="launcher-read-probe-"+UUID.randomUUID();private final Handler main=new Handler(Looper.getMainLooper());
 private final AtomicBoolean expired=new AtomicBoolean();private final AtomicInteger expected=new AtomicInteger();private final AtomicReference<CountDownLatch> latch=new AtomicReference<>();
 private final AtomicReference<Object> reply=new AtomicReference<>();private final AtomicReference<String> failure=new AtomicReference<>("");
 private interface Work {void run()throws Exception;}
 private Class<?> type(String suffix)throws Exception{return loader.loadClass("com.turboio.addon."+suffix);}
 private Object field(Object owner,String name)throws Exception{Class<?> c=owner instanceof Class?(Class<?>)owner:owner.getClass();Field f=c.getDeclaredField(name);f.setAccessible(true);return f.get(owner instanceof Class?null:owner);}
 private Object call(Object owner,String name,Class<?>[] signature,Object...args)throws Exception{Class<?> c=owner instanceof Class?(Class<?>)owner:owner.getClass();Method m=c.getDeclaredMethod(name,signature);m.setAccessible(true);return m.invoke(owner instanceof Class?null:owner,args);}
 private Object call(String suffix,String name,Class<?>[] signature,Object...args)throws Exception{return call(type(suffix),name,signature,args);}
 private void onMain(Work work)throws Exception{AtomicReference<Throwable> bad=new AtomicReference<>();runOnMainSync(()->{try{work.run();}catch(Throwable t){bad.set(t);}});if(bad.get()!=null)throw new Exception(bad.get());}
 private static void check(boolean valid,String code){if(!valid)throw new IllegalStateException(code);}
 private void signal(String code){failure.compareAndSet("",code);CountDownLatch l=latch.get();if(l!=null)l.countDown();}
 private boolean same()throws Exception{Object link=call("Host107Ota","link",new Class<?>[0]);return peer.equals(field(link,"peer"))&&generation==((Number)field(link,"generation")).longValue();}
 @SuppressWarnings("unchecked") private void cleanup(){try{if(receiver!=null){Object list=field(type("NativeTransfer"),"receivers");((List<Object>)list).removeIf(item->item==receiver);}call("NativeTransfer","releaseMessages",new Class<?>[]{String.class},lease);}catch(Exception ignored){}}
 private final Runnable cutoff=()->{expired.set(true);expected.set(0);cleanup();signal("PROBE_CUTOFF");};
 @Override public void onCreate(Bundle args){super.onCreate(args);start();}
 @Override public void onStart(){Bundle report=new Bundle();try{
  loader=getTargetContext().getClassLoader();getTargetContext().startActivity(new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER).setClassName(getTargetContext(),"com.rayneo.venus.MainActivity").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));Thread.sleep(2200);
  // The stock plugin initializes lazily on its normal glasses tab after instrumentation restart.
  // The controlling test opens that observed normal tab through ADB/UI. Do not claim a second
  // UiAutomation connection from inside instrumentation; wait only, never enable/reset/pair SDK.
  boolean connected=false;for(int attempt=0;attempt<50&&!connected;attempt++){AtomicBoolean found=new AtomicBoolean();onMain(()->{Object link=call("Host107Ota","link",new Class<?>[0]);Object id=field(link,"peer");found.set(id instanceof String&&!((String)id).isEmpty());});connected=found.get();if(!connected)Thread.sleep(300);}check(connected,"AUTHENTICATED_PEER_REQUIRED");
  onMain(()->{
   check(Boolean.TRUE.equals(call("Host107Login","loggedIn",new Class<?>[0])),"LOGIN_REQUIRED");check(Boolean.FALSE.equals(call("Fixed60OfficialRuntime","pending",new Class<?>[0])),"OTA_PROTECTION_ACTIVE");check(Boolean.FALSE.equals(call("NativeTransfer","busy",new Class<?>[0])),"DEVICE_BUSY");
   Object link=call("Host107Ota","link",new Class<?>[0]);Object id=field(link,"peer");check(id instanceof String&&!((String)id).isEmpty(),"AUTHENTICATED_PEER_REQUIRED");peer=(String)id;generation=((Number)field(link,"generation")).longValue();
   check(Boolean.TRUE.equals(call("NativeTransfer","acquireMessages",new Class<?>[]{String.class},lease)),"DEVICE_LANE_UNAVAILABLE");Class<?> sink=type("NativeTransfer$Receiver");
   receiver=Proxy.newProxyInstance(sink.getClassLoader(),new Class<?>[]{sink},(proxy,method,args)->{
    if(method.getDeclaringClass()==Object.class){if(method.getName().equals("hashCode"))return System.identityHashCode(proxy);if(method.getName().equals("equals"))return proxy==args[0];return "bounded-read-probe";}
    if(expired.get()||expected.get()==0||args.length!=2||!peer.equals(args[0])||!(args[1] instanceof byte[])||((byte[])args[1]).length>8192)return null;
    try{if(!same()){signal("CONNECTION_CHANGED");return null;}Object frame=call("OtaFrame","decode",new Class<?>[]{byte[].class},((byte[])args[1]).clone());if(((Number)field(frame,"type")).intValue()==expected.get()&&((byte[])field(frame,"binary")).length==0){if(reply.compareAndSet(null,field(frame,"json"))){CountDownLatch wait=latch.get();if(wait!=null)wait.countDown();}}}catch(Exception invalid){signal("READ_FRAME_INVALID");}return null;
   });call("NativeTransfer","receive",new Class<?>[]{sink},receiver);main.postDelayed(cutoff,25000);
  });
  JSONObject evidence=new JSONObject().put("schema",1).put("read_only",true).put("device_writes",false).put("card_or_capture",false);
  for(int messageType:new int[]{1,4}){
   CountDownLatch wait=new CountDownLatch(1);latch.set(wait);reply.set(null);failure.set("");
   onMain(()->{check(!expired.get()&&same(),"CONNECTION_CHANGED");expected.set(messageType);Map<String,Object> payload=new LinkedHashMap<>();payload.put("value",0);payload.put("mode",0);payload.put("data","");Map<String,Object> body=new LinkedHashMap<>();body.put("cmd",messageType==1?"request_general_status":"request_general_settings");body.put("payload",payload);byte[] bytes=(byte[])call("OtaFrame","encode",new Class<?>[]{int.class,Object.class,byte[].class},messageType,body,null);call("NativeTransfer","sendMessage",new Class<?>[]{String.class,String.class,byte[].class,Runnable.class},lease,peer,bytes,(Runnable)()->signal("SDK_READ_FAILED"));});
   check(wait.await(11000,TimeUnit.MILLISECONDS),"READ_TIMEOUT");check(failure.get().isEmpty(),failure.get());onMain(()->check(!expired.get()&&same(),"CONNECTION_CHANGED"));expected.set(0);Object raw=reply.get();check(raw instanceof Map,"READ_OBJECT_REQUIRED");evidence.put(messageType==1?"status":"settings",new JSONObject((Map<?,?>)raw));
  }
  onMain(()->{expected.set(0);main.removeCallbacks(cutoff);cleanup();});
  File dir=getTargetContext().getExternalFilesDir(null);check(dir!=null,"EXPORT_UNAVAILABLE");File output=new File(dir,"io-agent-launcher-read-probe.json");try(FileOutputStream stream=new FileOutputStream(output)){stream.write(evidence.toString(2).getBytes(StandardCharsets.UTF_8));stream.getFD().sync();}
  report.putBoolean("read_only_status_and_settings_received",true);report.putBoolean("original_peer_and_generation_preserved",true);report.putBoolean("receiver_and_lane_removed",true);report.putBoolean("sdk_enable_reset_or_device_write",false);report.putString("export_basename",output.getName());finish(Activity.RESULT_OK,report);
 }catch(Throwable error){while(error.getCause()!=null)error=error.getCause();String code=error.getMessage();report.putString("failure_class",error.getClass().getSimpleName());report.putString("failure_code",code!=null&&code.matches("[A-Z][A-Z0-9_]{0,80}")?code:"READ_PROBE_FAILED");finish(Activity.RESULT_CANCELED,report);
 }finally{try{onMain(()->{expected.set(0);main.removeCallbacks(cutoff);cleanup();});}catch(Exception ignored){}}}
}
