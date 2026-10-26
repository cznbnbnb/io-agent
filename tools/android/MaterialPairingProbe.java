package com.turboio.androidtests;
import android.app.*;import android.content.*;import android.os.*;import java.io.*;import java.lang.reflect.*;import java.nio.file.*;import java.util.concurrent.*;
/** Authorized pairing migration and metadata-only verification. No secrets or material text output. */
public final class MaterialPairingProbe extends Instrumentation {
 Bundle args;ClassLoader loader;Object runtime;public void onCreate(Bundle b){super.onCreate(b);args=b;start();}
 Class<?> type(String s)throws Exception{return loader.loadClass("com.turboio.addon."+s);}
 Object call(Object o,String n,Class<?>[] types,Object...v)throws Exception{Method m=(o instanceof Class?(Class<?>)o:o.getClass()).getDeclaredMethod(n,types);m.setAccessible(true);return m.invoke(o instanceof Class?null:o,v);}
 Object field(Object o,String n)throws Exception{Field f=o.getClass().getDeclaredField(n);f.setAccessible(true);return f.get(o);}
 Object action(String name,byte[] input)throws Exception{
  Class<?> cb=type("MaterialRuntime$Result");CountDownLatch wait=new CountDownLatch(1);Object[] result=new Object[2];
  Object proxy=Proxy.newProxyInstance(loader,new Class<?>[]{cb},(p,m,v)->{result[0]=v[0];result[1]=v[1];wait.countDown();return null;});
  if(input==null)call(runtime,name,new Class<?>[]{cb},proxy);else call(runtime,name,new Class<?>[]{byte[].class,boolean.class,cb},input,true,proxy);
  if(!wait.await(110,TimeUnit.SECONDS))throw new IOException("PROBE_TIMEOUT");if(!"".equals(result[1]))throw new IOException((String)result[1]);return result[0];
 }
 public void onStart(){Bundle report=new Bundle();try{
  String mode=args.getString("mode","inspect");if(!mode.equals("inspect")&&!mode.equals("apply")&&!mode.equals("sync")&&!mode.equals("renew"))throw new IOException("PROBE_MODE_INVALID");
  Context app=getTargetContext();loader=app.getClassLoader();runtime=call(type("MaterialRuntime"),"boot",new Class<?>[]{Context.class},app);
  Activity activity=startActivitySync(new Intent().setClassName(app,"com.rayneo.venus.MainActivity").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK|Intent.FLAG_ACTIVITY_CLEAR_TASK));
  runOnMainSync(()->{try{runtime=call(type("MaterialRuntime"),"get",new Class<?>[]{Activity.class},activity);}catch(Exception e){throw new RuntimeException(e);}});Object account=null;
  for(int i=0;i<50&&account==null;i++){account=call(type("Host107Login"),"account",new Class<?>[0]);if(account==null)Thread.sleep(200);}
  if(account==null)throw new IOException("OFFICIAL_LOGIN_REQUIRED");
  if(!mode.equals("inspect")){for(int i=0;i<50&&!Boolean.TRUE.equals(field(runtime,"visible"));i++)Thread.sleep(200);if(!Boolean.TRUE.equals(field(runtime,"visible")))throw new IOException("PROBE_ACTIVITY_NOT_VISIBLE");Thread.sleep(500);}
  Constructor<?> c=type("MaterialSettings").getDeclaredConstructor(Context.class);c.setAccessible(true);Object settings=c.newInstance(app);Object config=call(settings,"load",new Class<?>[0]);
  if(config==null||!field(account,"binding").equals(field(config,"account")))throw new IOException("OFFICIAL_ACCOUNT_CHANGED");
  Object connection=field(config,"connection");if(!"turboio-user".equals(field(connection,"owner"))||!"phone-android".equals(field(connection,"producer"))||!"https://cznbnb.cn/io-api/v1".equals(field(connection,"base")))throw new IOException("FORMAL_IDENTITY_MISMATCH");
  report.putString("account_binding",(String)field(account,"binding"));report.putString("server_id",(String)field(connection,"server"));
  if(mode.equals("apply")){
   File f=new File(app.getExternalFilesDir(null),"connection-import/material-pairing.json");if(f.length()>8192||!f.isFile())throw new IOException("PROBE_IMPORT_INVALID");byte[] data=Files.readAllBytes(f.toPath());try{action("configure",data);}finally{java.util.Arrays.fill(data,(byte)0);}if(!f.delete())throw new IOException("PROBE_IMPORT_CLEANUP_FAILED");
  }
  if(mode.equals("renew")){
   // Expire only the phone's cached access deadline; never change clocks, server credentials or data.
   byte[] raw=(byte[])call(config,"encode",new Class<?>[0]);java.util.Map wire=(java.util.Map)call(type("WireJson"),"read",new Class<?>[]{byte[].class},raw);java.util.Map conn=(java.util.Map)wire.get("connection");
   if(!"turboio-material-sync/2".equals(conn.get("format")))throw new IOException("PROBE_PAIRING_REQUIRED");
   conn.put("expires_at",java.time.Instant.ofEpochMilli(System.currentTimeMillis()-40L*86400000L).toString());
   Object expired=call(type("MaterialConfig"),"decode",new Class<?>[]{byte[].class},(byte[])call(type("WireJson"),"bytes",new Class<?>[]{Object.class},wire));call(settings,"save",new Class<?>[]{type("MaterialConfig")},expired);report.putBoolean("expired_cache_injected",true);
  }
  if(!mode.equals("inspect")){
   Object state=action("sync",null),status=field(state,"status");report.putInt("stored",((Number)field(status,"stored")).intValue());report.putInt("queued",((Number)field(status,"queued")).intValue());report.putString("note",(String)field(state,"note"));
   config=call(settings,"load",new Class<?>[0]);connection=field(config,"connection");report.putBoolean("paired",(Boolean)call(connection,"paired",new Class<?>[0]));report.putBoolean("enabled",(Boolean)field(config,"enabled"));report.putString("expires_at",(String)field(connection,"expires"));
  }
  report.putBoolean("passed",true);finish(Activity.RESULT_OK,report);
 }catch(Throwable e){while(e.getCause()!=null)e=e.getCause();String s=e.getMessage();report.putString("error",s!=null&&s.matches("[A-Z_]{3,90}")?s:e.getClass().getSimpleName());finish(Activity.RESULT_CANCELED,report);}}
}
