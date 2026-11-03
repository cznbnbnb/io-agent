package com.turboio.androidtests;
import android.app.*;import android.content.*;import android.os.*;import java.io.*;import java.lang.reflect.*;import java.net.*;import java.nio.charset.StandardCharsets;import java.util.*;import javax.net.ssl.HttpsURLConnection;import org.json.*;
/** Selected-day GET diagnostics. Exports sizes/counts only, never credentials,
 * transcript text, raw responses or file contents. Does not change local records. */
public final class LifelogReadBudgetProbe extends Instrumentation {
 private String date;private ClassLoader loader;
 private Object call(Object o,String name,Class<?>[] sig,Object...args)throws Exception{Class<?> c=o instanceof Class?(Class<?>)o:o.getClass();Method m=c.getDeclaredMethod(name,sig);m.setAccessible(true);return m.invoke(o instanceof Class?null:o,args);}
 private Class<?> type(String name)throws Exception{return loader.loadClass("com.turboio.addon."+name);}
 public void onCreate(Bundle args){super.onCreate(args);date=args.getString("date","");start();}
 public void onStart(){Bundle result=new Bundle();JSONArray responses=new JSONArray();Object adapter=null,signer=null;try{
  java.time.LocalDate.parse(date);Context app=getTargetContext();loader=app.getClassLoader();app.startActivity(new Intent().setClassName(app,"com.rayneo.venus.MainActivity").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
  Object login=null;for(int i=0;i<60&&login==null;i++){login=call(type("Host107Login"),"account",new Class<?>[0]);if(login==null)Thread.sleep(200);}if(login==null)throw new IOException("OFFICIAL_LOGIN_REQUIRED");
  Object expected=login;Class<?> guard=type("MaterialSyncSession$Guard");Object gate=java.lang.reflect.Proxy.newProxyInstance(loader,new Class<?>[]{guard},(p,m,a)->{Object now=call(type("Host107Login"),"account",new Class<?>[0]);if(!Boolean.TRUE.equals(call(expected,"same",new Class<?>[]{type("OfficialAccountBinding")},now)))throw new IOException("OFFICIAL_ACCOUNT_CHANGED");return null;});
  Constructor<?> ctor=type("Host107LifelogHttp").getDeclaredConstructor(Context.class,type("OfficialAccountBinding"),guard);ctor.setAccessible(true);adapter=ctor.newInstance(app,login,gate);String[] signing=(String[])call(adapter,"inputs",new Class<?>[0]);Object session=call(type("Host107Login"),"session",new Class<?>[]{type("OfficialAccountBinding")},login);String access=(String)call(session,"accessToken",new Class<?>[0]);
  signer=loader.loadClass("com.rayneo.resource.cloud.CloudDictResApi").getConstructor().newInstance();Object day=call(type("OfficialLifelogInventory$Request"),"day",new Class<?>[]{String.class,String.class},date,"Asia/Shanghai");Field path=day.getClass().getDeclaredField("path");path.setAccessible(true);
  List<String> paths=new ArrayList<>();paths.add((String)path.get(day));long deadline=SystemClock.elapsedRealtime()+90000,total=0;
  for(int index=0;index<paths.size();index++){
   if(paths.size()>17||SystemClock.elapsedRealtime()>deadline)throw new IOException("DIAGNOSTIC_BUDGET");call(gate,"check",new Class<?>[0]);String route=paths.get(index);Map<?,?> headers=(Map<?,?>)call(signer,"genSign",new Class<?>[]{String.class,String.class,String.class,String.class},signing[0],signing[1],"GET",route);
   HttpsURLConnection http=(HttpsURLConnection)new URL("https://xr-api-p.rayneo.cn"+route).openConnection();byte[] raw;
   try{http.setInstanceFollowRedirects(false);http.setUseCaches(false);http.setConnectTimeout(5000);http.setReadTimeout(10000);http.setRequestProperty("Accept","application/json");http.setRequestProperty("Accept-Encoding","identity");http.setRequestProperty("app-version","1.0.10");http.setRequestProperty("platform","android");http.setRequestProperty("lang","zh-CN");http.setRequestProperty("time-zone","Asia/Shanghai");http.setRequestProperty("xtcl-access-token",access);for(Map.Entry<?,?> h:headers.entrySet())http.setRequestProperty((String)h.getKey(),(String)h.getValue());
    if(http.getResponseCode()!=200)throw new IOException("OFFICIAL_SOURCE_UNAVAILABLE");ByteArrayOutputStream out=new ByteArrayOutputStream();try(InputStream in=http.getInputStream()){byte[] block=new byte[8192];int n;while((n=in.read(block))!=-1){call(gate,"check",new Class<?>[0]);total+=n;if(out.size()+n>8388608||total>16777216||SystemClock.elapsedRealtime()>deadline)throw new IOException("DIAGNOSTIC_BUDGET");out.write(block,0,n);}}raw=out.toByteArray();
   }finally{http.disconnect();}
   call(gate,"check",new Class<?>[0]);JSONObject root=new JSONObject(new String(raw,StandardCharsets.UTF_8));if(root.getInt("code")!=0)throw new IOException("OFFICIAL_RESPONSE_REJECTED");JSONObject data=root.getJSONObject("data"),row=new JSONObject().put("kind",index==0?"day_list":"event_full").put("response_bytes",raw.length);
   if(index==0){JSONArray events=data.getJSONArray("events");row.put("events",events.length());for(int j=0;j<events.length();j++){String id=events.getJSONObject(j).getString("id");if(!id.matches("[A-Za-z0-9_-]{1,80}"))throw new IOException("LIFELOG_EVENT_ID_INVALID");paths.add("/lifelog/api/v1/events/"+id+"/full");}}
   else{JSONArray sources=data.getJSONArray("transcriptionContents");int maxSource=0,clips=0;for(int j=0;j<sources.length();j++){JSONObject source=sources.getJSONObject(j);maxSource=Math.max(maxSource,source.toString().getBytes(StandardCharsets.UTF_8).length);clips+=source.getJSONArray("clips").length();}row.put("sources",sources.length()).put("clips",clips).put("max_source_bytes",maxSource);}
   responses.put(row);
  }
  result.putBoolean("passed",true);
 }catch(Throwable failure){while(failure.getCause()!=null)failure=failure.getCause();String message=failure.getMessage();result.putString("error",message!=null&&message.matches("[A-Z_]{3,90}")?message:failure.getClass().getSimpleName());}
 finally{if(adapter!=null)try{call(adapter,"close",new Class<?>[0]);}catch(Exception failure){result.putBoolean("adapter_close_failed",true);}if(signer!=null)try{call(signer,"close",new Class<?>[0]);}catch(Exception failure){result.putBoolean("signer_close_failed",true);}}
 result.putString("date",date);result.putString("response_sizes",responses.toString());result.putBoolean("text_or_credentials_exported",false);finish(Activity.RESULT_OK,result);
 }
}
