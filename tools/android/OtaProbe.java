package com.turboio.androidtests;

import android.app.*;import android.content.*;import android.os.Bundle;
import java.io.*;import java.lang.reflect.*;import java.util.*;import java.util.concurrent.*;import java.util.concurrent.atomic.*;

/** Real product/SDK queue on the dedicated VM, deliberately without any connected peer. */
public final class OtaProbe extends Instrumentation {
 private ClassLoader loader;private Object connection,manager;private interface Work{void run()throws Exception;}
 private Class<?> type(String name)throws Exception{return loader.loadClass(name);}
 private Object field(Object value,String name)throws Exception{Class<?> c=value instanceof Class?(Class<?>)value:value.getClass();Field f=c.getDeclaredField(name);f.setAccessible(true);return f.get(value instanceof Class?null:value);}
 private Object invoke(Object value,String name,Class<?>[] parameters,Object...args)throws Exception{Class<?> c=value instanceof Class?(Class<?>)value:value.getClass();Method m=c.getDeclaredMethod(name,parameters);m.setAccessible(true);return m.invoke(value instanceof Class?null:value,args);}
 private Object make(String name,Object...args)throws Exception{return invoke(type("com.turboio.addon.NavReflect"),"make",new Class<?>[]{String.class,Object[].class},name,args);}
 private void main(Work work)throws Exception{AtomicReference<Throwable> error=new AtomicReference<>();runOnMainSync(()->{try{work.run();}catch(Throwable t){error.set(t);}});if(error.get()!=null)throw new Exception(error.get());}
 private static void check(boolean ok,String reason){if(!ok)throw new IllegalStateException(reason);}
 @Override public void onCreate(Bundle args){super.onCreate(args);start();}
 @Override public void onStart(){Bundle report=new Bundle();Object owner=new Object();try{
  loader=getTargetContext().getClassLoader();Class<?> queue=type("com.turboio.addon.FirmwareQueue"),abi=type("com.turboio.addon.Host107Abi");
  Activity activity=startActivitySync(new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER).setClassName("com.rayneo.venus.pub","com.turboio.addon.AgentActivity").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
  main(()->{
   Object runtime=invoke(type("com.turboio.addon.Fixed60Runtime"),"get",new Class<?>[]{android.content.Context.class},activity);check(Boolean.FALSE.equals(invoke(runtime,"pending",new Class<?>[0]))&&Boolean.FALSE.equals(invoke(runtime,"writesEnabled",new Class<?>[0])),"OTA_NOT_IDLE_OR_WRITES_ENABLED");
   connection=invoke(type("com.turboio.addon.Host107Connection"),"get",new Class<?>[]{Activity.class},activity);invoke(connection,"enable",new Class<?>[0]);manager=field(connection,"manager");check("".equals(invoke(type("com.turboio.addon.Host107Connection"),"otaPeer",new Class<?>[0])),"REAL_PEER_PRESENT_STOP");
   invoke(runtime,"inspect",new Class<?>[0]);check(((String)invoke(runtime,"note",new Class<?>[0])).contains("设备认证")&&Boolean.FALSE.equals(invoke(queue,"busy",new Class<?>[0])),"NO_PEER_INSPECTION_NOT_REJECTED");
  });
  report.putBoolean("runtime_inspection_requires_real_authenticated_peer",true);report.putBoolean("release_writes_disabled",true);
  CountDownLatch done=new CountDownLatch(1);AtomicInteger callbacks=new AtomicInteger();AtomicBoolean sdkError=new AtomicBoolean();
  main(()->{
   check(Boolean.TRUE.equals(invoke(queue,"acquire",new Class<?>[]{Object.class},owner)),"QUEUE_OWNER_FAILED");
   byte[] frame={8,1,16,1,26,2,123,125};Object biz=Enum.valueOf((Class)type("j4.h"),"MARS_FOTA"),priority=Enum.valueOf((Class)type("Y3.b"),"NORMAL");
   Object message=make("E3.Q",frame,UUID.randomUUID().toString(),"io-fixed60-probe-no-peer",biz,null,priority,false,false,null,null);
   Class<?> callbackType=type("kotlin.jvm.functions.Function2");Object callback=Proxy.newProxyInstance(loader,new Class<?>[]{callbackType},(o,m,args)->{if(m.getName().equals("invoke")){callbacks.incrementAndGet();sdkError.set(args.length==2&&args[0]==message&&args[1]!=null);done.countDown();}return null;});
   Class<?> submissionType=type("com.turboio.addon.FirmwareQueue$Submission");Object submission=Proxy.newProxyInstance(loader,new Class<?>[]{submissionType},(o,m,args)->{if(m.getName().equals("send"))invoke(manager,"t",new Class<?>[]{type("Y3.S"),callbackType},message,callback);return null;});
   invoke(queue,"submit",new Class<?>[]{Object.class,Object.class,String.class,byte[].class,boolean.class,submissionType},owner,message,"io-fixed60-probe-no-peer",frame,false,submission);
   check(Boolean.FALSE.equals(invoke(abi,"allowQueue",new Class<?>[]{Object.class},message)),"TICKET_LEAKED_AFTER_SDK_CALL");
   Object result=invoke(manager,"u",new Class<?>[]{File.class,String.class,type("k4.q"),String.class},new File(activity.getCacheDir(),"io-ota-probe-not-created"),"io-fixed60-probe-no-peer",field(type("k4.q"),"b"),null);
   check(result==null,"RAW_VENDOR_FILE_BYPASSED_OTA_GUARD");
  });
  check(done.await(5,TimeUnit.SECONDS)&&callbacks.get()==1&&sdkError.get(),"SDK_MISSING_PEER_RECEIPT_NOT_EXACT");
  report.putBoolean("actual_sdk_synchronous_queue_consumed_exact_ticket",true);report.putBoolean("actual_sdk_missing_peer_error_callback_once",true);report.putBoolean("ticket_removed_after_sdk_submission",true);report.putBoolean("actual_vendor_file_entry_blocked_by_firmware_owner",true);
  main(()->{invoke(queue,"release",new Class<?>[]{Object.class},owner);check(Boolean.TRUE.equals(invoke(abi,"allowFile",new Class<?>[0]))&&Boolean.FALSE.equals(invoke(queue,"busy",new Class<?>[0])),"QUEUE_RELEASE_FAILED");invoke(connection,"disable",new Class<?>[0]);});
  report.putBoolean("ownership_and_sdk_restored",true);report.putBoolean("device_connected",false);report.putBoolean("firmware_or_audio_started",false);finish(Activity.RESULT_OK,report);
 }catch(Throwable failure){try{main(()->{invoke(type("com.turboio.addon.FirmwareQueue"),"release",new Class<?>[]{Object.class},owner);if(connection!=null)invoke(connection,"disable",new Class<?>[0]);});}catch(Exception ignored){}try(FileOutputStream out=new FileOutputStream(new File(getTargetContext().getFilesDir(),"ota-probe-error.txt"))){out.write(android.util.Log.getStackTraceString(failure).getBytes(java.nio.charset.StandardCharsets.UTF_8));}catch(Exception ignored){}Throwable original=failure;while(original.getCause()!=null)original=original.getCause();report.putString("failure_class",original.getClass().getSimpleName());report.putString("failure_code",original.getMessage()!=null&&original.getMessage().matches("[A-Z0-9_]+")?original.getMessage():"OTA_PROBE_FAILED");finish(Activity.RESULT_CANCELED,report);}}
}
