package com.turboio.androidtests;

import android.app.*;import android.content.*;import android.os.*;
import java.io.*;import java.lang.reflect.*;import java.util.*;import java.util.concurrent.atomic.*;

/** Actual host guards/SDK initialization; synthetic session metadata only, no connected peer. */
public final class RecoveryProbe extends Instrumentation {
 private ClassLoader loader;private String focus="sdk";private interface Work{void run()throws Exception;}
 private Class<?> type(String name)throws Exception{return loader.loadClass(name);}
 private Object field(Object o,String name)throws Exception{Class<?> c=o instanceof Class?(Class<?>)o:o.getClass();Field f=c.getDeclaredField(name);f.setAccessible(true);return f.get(o instanceof Class?null:o);}
 private Object call(Object o,String name,Class<?>[] signature,Object...args)throws Exception{Class<?> c=o instanceof Class?(Class<?>)o:o.getClass();Method m=c.getDeclaredMethod(name,signature);m.setAccessible(true);return m.invoke(o instanceof Class?null:o,args);}
 private void main(Work work)throws Exception{AtomicReference<Throwable> error=new AtomicReference<>();runOnMainSync(()->{try{work.run();}catch(Throwable t){error.set(t);}});if(error.get()!=null)throw new Exception(error.get());}
 private static Throwable cause(Throwable t){while(t.getCause()!=null)t=t.getCause();return t;}
 private static void check(boolean ok,String code){if(!ok)throw new IllegalStateException(code);}
 @Override public void onCreate(Bundle args){super.onCreate(args);if(args!=null)focus=args.getString("focus","sdk");start();}
 @Override public void onStart(){Bundle report=new Bundle();Object owner=new Object();AtomicReference<Object> connection=new AtomicReference<>(),runtime=new AtomicReference<>();try{
  loader=getTargetContext().getClassLoader();Activity activity=startActivitySync(new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER).setClassName("com.rayneo.venus.pub","com.turboio.addon.AgentActivity").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
  main(()->{runtime.set(call(type("com.turboio.addon.Fixed60Runtime"),"get",new Class<?>[]{Context.class},activity));connection.set(call(type("com.turboio.addon.Host107Connection"),"get",new Class<?>[]{Activity.class},activity));check(Boolean.FALSE.equals(call(runtime.get(),"writesEnabled",new Class<?>[0])),"WRITES_MUST_STAY_DISABLED");});
  if(focus.equals("pending")){
   main(()->{check(Boolean.TRUE.equals(call(runtime.get(),"pending",new Class<?>[0])),"SYNTHETIC_PENDING_REQUIRED");check(!((Boolean)field(connection.get(),"owned")),"PENDING_AUTO_ENABLED_SDK");boolean rejected=false;try{call(connection.get(),"enable",new Class<?>[0]);}catch(Exception e){rejected="DEVICE_BUSY".equals(cause(e).getMessage());}check(rejected&&!((Boolean)field(connection.get(),"owned")),"ORDINARY_ENABLE_BYPASSED_PENDING");});
   try(android.os.ParcelFileDescriptor.AutoCloseInputStream out=new android.os.ParcelFileDescriptor.AutoCloseInputStream(getUiAutomation().executeShellCommand("input keyevent KEYCODE_HOME"))){while(out.read()!=-1){}}
   Thread.sleep(1000);main(()->{Handler handler=(Handler)field(runtime.get(),"main");Runnable tick=(Runnable)field(runtime.get(),"tick");check(((Set<?>)field(runtime.get(),"foreground")).isEmpty()&&!handler.hasCallbacks(tick),"PENDING_BACKGROUND_POLL_NOT_STOPPED");check(Boolean.TRUE.equals(call(runtime.get(),"pending",new Class<?>[0])),"BACKGROUND_CLEARED_PENDING");});
   try(android.os.ParcelFileDescriptor.AutoCloseInputStream out=new android.os.ParcelFileDescriptor.AutoCloseInputStream(getUiAutomation().executeShellCommand("am start -n com.rayneo.venus.pub/com.turboio.addon.AgentActivity"))){while(out.read()!=-1){}}
   Thread.sleep(1000);main(()->{check(!((Set<?>)field(runtime.get(),"foreground")).isEmpty(),"APP_NOT_RESUMED");check(Boolean.TRUE.equals(call(runtime.get(),"pending",new Class<?>[0]))&&!((Boolean)field(connection.get(),"owned")),"RESUME_CLEARED_PENDING_OR_ENABLED_SDK");});
   report.putBoolean("pending_ordinary_sdk_enable_denied",true);report.putBoolean("pending_background_poll_stops",true);report.putBoolean("resume_keeps_pending_without_sdk_auto_enable",true);
  }else{
   main(()->{
    check(Boolean.FALSE.equals(call(runtime.get(),"pending",new Class<?>[0]))&&!((Boolean)field(connection.get(),"owned")),"IDLE_DISABLED_SDK_REQUIRED");
    String peer="synthetic-recovery-no-peer";String hash=(String)call(type("com.turboio.addon.Fixed60Session"),"peerHash",new Class<?>[]{String.class},peer);
    Map<String,Object> record=new LinkedHashMap<>();record.put("schema",1);record.put("candidate",field(type("com.turboio.addon.Fixed60Profile"),"ZIP_SHA"));record.put("operation",UUID.randomUUID().toString());record.put("peer_sha256",hash);record.put("pending",true);record.put("phase","UNKNOWN");record.put("reason","DEVICE_ERROR_8");record.put("first_failure","DEVICE_ERROR_8");record.put("started_at_epoch_ms",System.currentTimeMillis()-180000);record.put("requests",3);record.put("confirmed_messages",10);record.put("confirmed_bytes",153600);record.put("covered_bytes",153600);record.put("ap_covered_bytes",0);record.put("install_notice",false);record.put("boot_readback",false);
    Class<?> store=type("com.turboio.addon.Fixed60Session$Store");Object memory=Proxy.newProxyInstance(loader,new Class<?>[]{store},(o,m,args)->m.getName().equals("read")?record:null);
    Class<?> sessionType=type("com.turboio.addon.Fixed60Session"),linkType=type("com.turboio.addon.Fixed60Session$Link"),permitType=type("com.turboio.addon.Fixed60Session$ReconnectPermit");
    Constructor<?> constructor=sessionType.getDeclaredConstructor(type("com.turboio.addon.Fixed60Firmware"),store,long.class);constructor.setAccessible(true);long now=SystemClock.elapsedRealtime();check(now>121000,"VM_UPTIME_TOO_SHORT_FOR_SYNTHETIC_CLOCK");Object session=constructor.newInstance(null,memory,now-121000);
    Constructor<?> linkConstructor=linkType.getDeclaredConstructor(String.class,long.class);linkConstructor.setAccessible(true);Object link=linkConstructor.newInstance("",1L);
    Object stale=call(session,"reconnectPermit",new Class<?>[]{String.class,linkType,long.class},"已自然重启回首页",link,now),permit=call(session,"reconnectPermit",new Class<?>[]{String.class,linkType,long.class},"已自然重启回首页",link,now);
    Class<?> queue=type("com.turboio.addon.FirmwareQueue");check(Boolean.TRUE.equals(call(queue,"acquire",new Class<?>[]{Object.class,String.class},owner,hash)),"QUEUE_OWNER_FAILED");
    boolean denied=false;try{call(connection.get(),"enable",new Class<?>[0]);}catch(Exception e){denied="DEVICE_BUSY".equals(cause(e).getMessage());}check(denied&&!((Boolean)field(connection.get(),"owned")),"ORDINARY_ENABLE_NOT_BLOCKED");
    denied=false;try{call(type("com.turboio.addon.Host107Connection"),"reconnectFirmware",new Class<?>[]{permitType},stale);}catch(Exception e){denied="RECOVERY_PERMIT_INVALID".equals(cause(e).getMessage());}check(denied&&!((Boolean)field(connection.get(),"owned")),"STALE_PERMIT_INITIALIZED_SDK");
    denied=false;try{call(type("com.turboio.addon.Host107Connection"),"reconnectFirmware",new Class<?>[]{permitType},permit);}catch(Exception e){denied="RECOVERY_ORIGINAL_NOT_FOUND".equals(cause(e).getMessage());}
    check(denied&&((Boolean)field(connection.get(),"owned")),"CONTROLLED_SDK_ENABLE_OR_MISSING_ORIGINAL_GUARD_FAILED");check("".equals(call(type("com.turboio.addon.Host107Connection"),"otaPeer",new Class<?>[0])),"REAL_PEER_PRESENT_STOP");
    check(Boolean.TRUE.equals(call(permit,"valid",new Class<?>[]{long.class},SystemClock.elapsedRealtime())),"MISSING_ORIGINAL_CONSUMED_CONNECT_PERMIT");
    call(queue,"release",new Class<?>[]{Object.class},owner);call(connection.get(),"disable",new Class<?>[0]);
   });
   report.putBoolean("synthetic_session_only",true);report.putBoolean("ordinary_sdk_enable_blocked_by_owner",true);report.putBoolean("stale_reconnect_permit_rejected_before_sdk_init",true);report.putBoolean("valid_permit_uses_actual_sdk_init",true);report.putBoolean("missing_original_refuses_connect_without_pairing",true);report.putBoolean("sdk_and_queue_restored",true);
  }
  main(()->getTargetContext().startForegroundService(new Intent().setClassName(getTargetContext(),"com.turboio.addon.OtaService").putExtra("io_fixed60_lease","synthetic-stale-service-request")));Thread.sleep(8000);
  main(()->{Class<?> service=type("com.turboio.addon.OtaService");check(Boolean.FALSE.equals(call(service,"alive",new Class<?>[0]))&&field(service,"instance")==null,"STALE_SERVICE_REQUEST_LEFT_FOREGROUND_SERVICE");for(android.service.notification.StatusBarNotification notification:getTargetContext().getSystemService(NotificationManager.class).getActiveNotifications())check(notification.getId()!=7622,"STALE_SERVICE_NOTIFICATION_REMAINS");});
  report.putBoolean("stale_service_request_refused",true);report.putBoolean("real_device_connected",false);report.putBoolean("firmware_or_audio_started",false);finish(Activity.RESULT_OK,report);
 }catch(Throwable failure){try{main(()->{call(type("com.turboio.addon.FirmwareQueue"),"release",new Class<?>[]{Object.class},owner);if(focus.equals("sdk")&&connection.get()!=null)call(connection.get(),"disable",new Class<?>[0]);});}catch(Exception ignored){}try(FileOutputStream out=new FileOutputStream(new File(getTargetContext().getFilesDir(),"recovery-probe-error.txt"))){out.write(android.util.Log.getStackTraceString(failure).getBytes(java.nio.charset.StandardCharsets.UTF_8));}catch(Exception ignored){}Throwable original=cause(failure);report.putString("failure_class",original.getClass().getSimpleName());report.putString("failure_code",original.getMessage()!=null&&original.getMessage().matches("[A-Z0-9_]+")?original.getMessage():"RECOVERY_PROBE_FAILED");finish(Activity.RESULT_CANCELED,report);}}
}
