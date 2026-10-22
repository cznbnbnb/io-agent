package com.turboio.androidtests;

import android.app.*;import android.content.*;import android.os.*;
import java.lang.reflect.*;import java.util.*;import java.util.concurrent.atomic.*;

/** Physical-safe: callback objects only, then a stale service request. Never queues an SDK message. */
public final class OfficialServiceProbe extends Instrumentation {
 private ClassLoader loader;private interface Work {void run()throws Exception;}
 private Class<?> type(String name)throws Exception{return loader.loadClass(name);}
 private Object field(Object object,String name)throws Exception{Class<?> c=object instanceof Class?(Class<?>)object:object.getClass();Field f=c.getDeclaredField(name);f.setAccessible(true);return f.get(object instanceof Class?null:object);}
 private Object call(Object object,String name,Class<?>[] signature,Object...args)throws Exception{Class<?> c=object instanceof Class?(Class<?>)object:object.getClass();Method m=c.getDeclaredMethod(name,signature);m.setAccessible(true);return m.invoke(object instanceof Class?null:object,args);}
 private void main(Work work)throws Exception{AtomicReference<Throwable> failed=new AtomicReference<>();runOnMainSync(()->{try{work.run();}catch(Throwable bad){failed.set(bad);}});if(failed.get()!=null)throw new Exception(failed.get());}
 private static void check(boolean value,String why){if(!value)throw new IllegalStateException(why);}
 @Override public void onCreate(Bundle args){super.onCreate(args);start();}
 @Override public void onStart(){Bundle report=new Bundle();final String[] phase={"launch"};try{
  loader=getTargetContext().getClassLoader();getTargetContext().startActivity(new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER).setClassName(getTargetContext(),"com.rayneo.venus.MainActivity").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
  Thread.sleep(1500);
  main(()->{report.putBoolean("runtime_instance_observed_in_probe",field(type("com.turboio.addon.Fixed60OfficialRuntime"),"instance")!=null);check(Boolean.FALSE.equals(call(type("com.turboio.addon.Fixed60OfficialRuntime"),"pending",new Class<?>[0])),"EXISTING_UPGRADE_HISTORY");
   phase[0]="callback_setup";Class<?> function=type("kotlin.jvm.functions.Function2"),observer=type("com.turboio.addon.OfficialSdkReceipt$Observer");Object marker=new Object();AtomicReference<Object> received=new AtomicReference<>();AtomicInteger delegated=new AtomicInteger(),observed=new AtomicInteger();
   Object original=Proxy.newProxyInstance(function.getClassLoader(),new Class[]{function},(p,m,a)->{if(m.getDeclaringClass()==Object.class){if(m.getName().equals("hashCode"))return System.identityHashCode(p);if(m.getName().equals("equals"))return p==a[0];return "probe-callback";}received.set(a[0]);delegated.incrementAndGet();return marker;});
   Object business=type("j4.h").getMethod("valueOf",String.class).invoke(null,"MARS_FOTA"),priority=type("Y3.b").getMethod("valueOf",String.class).invoke(null,"NORMAL");Object message=null;
   phase[0]="message_constructor";Constructor<?> constructor=type("Y3.S").getConstructor(byte[].class,String.class,String.class,type("j4.h"),type("j4.Q"),type("Y3.b"),boolean.class,boolean.class,type("k4.p"),function);message=constructor.newInstance(new byte[]{8,1,16,1},UUID.randomUUID().toString(),"invalid-probe-peer",business,null,priority,false,false,null,original);check(field(message,"k")==original,"INITIAL_CALLBACK_NOT_PRESERVED");
   phase[0]="observer_proxy";
   Object watch=Proxy.newProxyInstance(observer.getClassLoader(),new Class[]{observer},(p,m,a)->{if(m.getName().equals("done")){check(Boolean.TRUE.equals(a[0])&&Boolean.TRUE.equals(a[1]),"RECEIPT_OUTCOME_CHANGED");observed.incrementAndGet();}return null;});
   phase[0]="receipt_adapter";call(type("com.turboio.addon.Host107Ota"),"observeVendorReceipt",new Class<?>[]{Object.class,observer},message,watch);Object wrapped=field(message,"k");phase[0]="callback_invoke";Object result=function.getMethod("invoke",Object.class,Object.class).invoke(wrapped,message,null);check(result==marker&&received.get()==message&&delegated.get()==1&&observed.get()==1,"SDK_CALLBACK_NOT_PRESERVED");report.putBoolean("actual_sdk_callback_arguments_result_preserved",true);report.putBoolean("sdk_message_queued",false);
   phase[0]="stale_service";
   getTargetContext().startForegroundService(new Intent().setClassName(getTargetContext(),"com.turboio.addon.OtaService").putExtra("io_official_fixed60_lease","synthetic-stale-official-service-request"));
  });Thread.sleep(8000);
  main(()->{check(Boolean.FALSE.equals(call(type("com.turboio.addon.OtaService"),"alive",new Class<?>[0]))&&field(type("com.turboio.addon.OtaService"),"instance")==null,"STALE_SERVICE_LEFT_RUNNING");for(android.service.notification.StatusBarNotification n:getTargetContext().getSystemService(NotificationManager.class).getActiveNotifications())check(n.getId()!=7622,"STALE_SERVICE_NOTIFICATION_REMAINS");check(Boolean.FALSE.equals(call(type("com.turboio.addon.Fixed60OfficialRuntime"),"pending",new Class<?>[0])),"UNEXPECTED_START_INTENT");});
  report.putBoolean("stale_official_service_refused",true);report.putBoolean("start_intent_created",false);report.putBoolean("sdk_reset_stop_or_device_command",false);finish(Activity.RESULT_OK,report);
 }catch(Throwable bad){while(bad.getCause()!=null)bad=bad.getCause();String message=bad.getMessage();report.putString("failure_class",bad.getClass().getSimpleName());report.putString("failure_stage",phase[0]);if(bad.getStackTrace().length>0)report.putString("failure_location",bad.getStackTrace()[0].toString());if(message!=null&&message.matches("[A-Z_]{1,80}"))report.putString("failure_reason",message);else if(bad instanceof IllegalArgumentException&&message!=null&&message.length()<300)report.putString("synthetic_probe_argument_detail",message);finish(Activity.RESULT_CANCELED,report);}}
}
