package com.turboio.androidtests;

import android.app.*;import android.content.*;import android.os.*;
import java.lang.reflect.*;import java.nio.charset.StandardCharsets;import java.util.*;import java.util.concurrent.atomic.*;
import org.json.*;

/** Bounded read-only integration against the installed host. No recording, task creation or firmware writes. */
public final class Host110RuntimeProbe extends Instrumentation {
 private ClassLoader loader;private int checks;private String phase="launch";
 private Class<?> type(String name)throws Exception{return loader.loadClass("com.turboio.addon."+name);}
 private Object call(Object owner,String name,Class<?>[] signature,Object...args)throws Exception{Class<?> c=owner instanceof Class?(Class<?>)owner:owner.getClass();Method m=c.getDeclaredMethod(name,signature);m.setAccessible(true);return m.invoke(owner instanceof Class?null:owner,args);}
 private void yes(boolean ok,String name){checks++;if(!ok)throw new IllegalStateException(name);}
 @Override public void onCreate(Bundle args){super.onCreate(args);start();}
 @Override public void onStart(){Bundle report=new Bundle();Object transport=null;try{
  Context app=getTargetContext();loader=app.getClassLoader();
  app.startActivity(new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER).setClassName("com.rayneo.venus.pub","com.rayneo.venus.MainActivity").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
  Thread.sleep(9000);long readyUntil=SystemClock.elapsedRealtime()+15000;while(SystemClock.elapsedRealtime()<readyUntil){if(Boolean.TRUE.equals(call(type("Host107Login"),"loggedIn",new Class<?>[0]))&&!((String)call(type("NativeTransfer"),"connected",new Class<?>[0])).isEmpty())break;Thread.sleep(250);}
  phase="login_and_link";android.util.Log.i("Host110Probe",phase);
  AtomicReference<Throwable> mainError=new AtomicReference<>();AtomicReference<Object> account=new AtomicReference<>();AtomicReference<String> peer=new AtomicReference<>();
  runOnMainSync(()->{try{
   yes(Boolean.TRUE.equals(call(type("Host107Login"),"loggedIn",new Class<?>[0])),"HOST110_LOGIN_UNAVAILABLE");account.set(call(type("Host107Login"),"account",new Class<?>[0]));yes(account.get()!=null,"HOST110_ACCOUNT_UNAVAILABLE");
   peer.set((String)call(type("NativeTransfer"),"connected",new Class<?>[0]));yes(peer.get()!=null&&!peer.get().isEmpty(),"HOST110_CONNECTION_UNAVAILABLE");
   Field instance=type("Host107Connection").getDeclaredField("instance");instance.setAccessible(true);Object connection=instance.get(null);yes(connection!=null,"HOST110_CONNECTION_RUNTIME_UNAVAILABLE");call(connection,"shareStock",new Class<?>[0]);report.putString("connection_status",(String)call(type("Host107Connection"),"statusDetails",new Class<?>[]{String.class},""));Object link=call(type("Host107Ota"),"link",new Class<?>[0]);Field p=link.getClass().getDeclaredField("peer");p.setAccessible(true);yes(peer.get().equals(p.get(link)),"HOST110_SHARED_LINK_MISMATCH");
  }catch(Throwable e){mainError.set(e);}});if(mainError.get()!=null)throw new Exception(mainError.get());
  phase="wire_mapping";android.util.Log.i("Host110Probe",phase);Object abi=type("NavReflect");Class<?> manager=(Class<?>)call(abi,"type",new Class<?>[]{String.class},"E3.u");yes(manager.getName().equals("O4.v"),"HOST110_MANAGER_MAPPING");
  Class<?> business=(Class<?>)call(abi,"type",new Class<?>[]{String.class},"P3.h");Object notification=business.getMethod("valueOf",String.class).invoke(null,"NOTIFICATION");Object id=call(abi,"field",new Class<?>[]{Object.class,String.class},notification,"b");yes(id instanceof Number&&((Number)id).intValue()==21,"HOST110_BUSINESS_WIRE");
  Class<?> small=(Class<?>)call(abi,"type",new Class<?>[]{String.class},"Q3.q");Object core=call(abi,"field",new Class<?>[]{Object.class,String.class},small,"b");yes(((Enum<?>)core).name().equals("SmallCore"),"HOST110_CORE_MAPPING");
  phase="decoder";android.util.Log.i("Host110Probe",phase);Object decoder=type("Host107OpusFileDecoder").getDeclaredConstructor();Constructor<?> dc=(Constructor<?>)decoder;dc.setAccessible(true);decoder=dc.newInstance();call(decoder,"close",new Class<?>[0]);yes(true,"HOST110_OPUS_INIT_RELEASE");
  phase="voice_environment";android.util.Log.i("Host110Probe",phase);Object voice=call(type("Host107VoiceEnvironment"),"current",new Class<?>[]{String.class},"zh-CN");yes(Boolean.TRUE.equals(call(voice,"idle",new Class<?>[0])),"HOST110_VOICE_ENVIRONMENT_UNAVAILABLE");
  phase="deletion_store";android.util.Log.i("Host110Probe",phase);Object deletionCtor=type("Host107RecordingDeletion").getDeclaredConstructor();Constructor<?> d=(Constructor<?>)deletionCtor;d.setAccessible(true);Object deletion=d.newInstance();Object binding=account.get();String key=(String)call(binding,"recordingDeletionKey",new Class<?>[0]);Object deleted=call(deletion,"read",new Class<?>[]{String.class},key);yes(deleted==null||deleted instanceof String,"HOST110_DELETION_READ_INVALID");
  phase="daily_read";android.util.Log.i("Host110Probe",phase);Class<?> guardType=type("MaterialSyncSession$Guard");Object guard=Proxy.newProxyInstance(loader,new Class<?>[]{guardType},(o,m,args)->null);
  Constructor<?> ctor=type("Host107LifelogHttp").getDeclaredConstructor(Context.class,type("OfficialAccountBinding"),guardType);ctor.setAccessible(true);transport=ctor.newInstance(app,binding,guard);
  byte[] result=(byte[])call(transport,"latestJournals",new Class<?>[0]);yes(result.length>0&&result.length<=1048576,"HOST110_JOURNAL_READ_BUDGET");
  JSONObject json=new JSONObject(new String(result,StandardCharsets.UTF_8));Arrays.fill(result,(byte)0);yes(json.optInt("code",-1)==0||json.optInt("code",-1)==200||json.optInt("error_code",-1)==1000,"HOST110_JOURNAL_API_REJECTED");
  report.putBoolean("same_login_read",true);report.putBoolean("shared_glasses_link",true);report.putBoolean("native_opus_initialized_and_released",true);report.putBoolean("voice_environment_idle",true);report.putBoolean("original_deletion_store_read",true);report.putBoolean("official_daily_read",true);
  report.putBoolean("original_todo_refresh",Boolean.TRUE.equals(call(type("Host107Todo"),"refresh",new Class<?>[]{String.class},"host110-readonly-check")));
  report.putInt("checks_passed",checks);report.putBoolean("recording_started",false);report.putBoolean("native_todo_created",false);report.putBoolean("firmware_written",false);report.putBoolean("credentials_exported",false);finish(Activity.RESULT_OK,report);
 }catch(Throwable e){while(e.getCause()!=null)e=e.getCause();String m=e.getMessage();if(e instanceof ReflectiveOperationException)report.putString("reflection",String.valueOf(e.getMessage()).substring(0,Math.min(160,String.valueOf(e.getMessage()).length())));report.putString("phase",phase);report.putInt("checks_passed",checks);report.putString("failure",m!=null&&m.matches("[A-Z0-9_]{3,90}")?m:e.getClass().getSimpleName());finish(Activity.RESULT_CANCELED,report);
 }finally{if(transport!=null)try{call(transport,"close",new Class<?>[0]);}catch(Exception cleanup){android.util.Log.w("Host110Probe","transport cleanup unavailable");}}}
}
