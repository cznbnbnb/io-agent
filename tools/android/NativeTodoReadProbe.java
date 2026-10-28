package com.turboio.todoprobe;

import android.app.*;import android.content.*;import android.os.*;
import java.io.*;import java.lang.reflect.*;import java.nio.charset.StandardCharsets;import java.util.*;import org.json.*;

/** One fixed stock list GET for the confirmed test task. Credentials and unrelated
 * task contents stay on the phone; no task create/update/delete is exposed. */
public final class NativeTodoReadProbe extends Instrumentation {
 private Bundle args;private String id;private int nodes;
 public void onCreate(Bundle value){super.onCreate(value);args=value;start();}
 private void scan(Object value,JSONObject report,int depth)throws Exception{
  if(++nodes>20000||depth>16)throw new IOException("TODO_READ_BUDGET");
  if(value instanceof JSONObject){JSONObject row=(JSONObject)value;
   if(id.equals(row.optString("id"))){report.put("matching_id_count",report.optInt("matching_id_count")+1).put("matching_field_names",new JSONArray(row.names().toString()));
    report.put("content_matches",row.optString("content").equals("测试待办：CLI 接入验证")).put("source",row.optString("source")).put("completed",row.optBoolean("completed")).put("due_date_set",row.has("dueDate")&&!row.isNull("dueDate"));}
   if("测试待办：CLI 接入验证".equals(row.optString("content")))report.put("matching_test_content_count",report.optInt("matching_test_content_count")+1);
   Iterator<String> keys=row.keys();while(keys.hasNext())scan(row.get(keys.next()),report,depth+1);
  }else if(value instanceof JSONArray){JSONArray rows=(JSONArray)value;for(int i=0;i<rows.length();i++)scan(rows.get(i),report,depth+1);}
 }
 public void onStart(){Bundle result=new Bundle();Object transport=null;
  try{
   id=args.getString("native_id","");String nonce=args.getString("probe_id","");if(!id.matches("[0-9]{1,20}")||!nonce.matches("[a-f0-9]{32}"))throw new IOException("TODO_READ_ARGUMENT_INVALID");
   Context app=getTargetContext();if(!app.getPackageName().equals("com.rayneo.venus.pub"))throw new IOException("TODO_READ_HOST_INVALID");
   ClassLoader loader=app.getClassLoader();Class<?> login=loader.loadClass("com.turboio.addon.Host107Login"),accountType=loader.loadClass("com.turboio.addon.OfficialAccountBinding"),guard=loader.loadClass("com.turboio.addon.MaterialSyncSession$Guard"),type=loader.loadClass("com.turboio.addon.Host107LifelogHttp");
   Method current=login.getDeclaredMethod("account");current.setAccessible(true);app.startActivity(new Intent().setClassName(app,"com.rayneo.venus.MainActivity").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
   Object account=null;for(int i=0;i<40&&account==null;i++){account=current.invoke(null);if(account==null)Thread.sleep(250);}if(account==null)throw new IOException("OFFICIAL_LOGIN_REQUIRED");
   Constructor<?> ctor=type.getDeclaredConstructor(Context.class,accountType,guard);ctor.setAccessible(true);transport=ctor.newInstance(app,account,Proxy.newProxyInstance(loader,new Class<?>[]{guard},(p,m,v)->null));
   Method get=type.getDeclaredMethod("get",String.class);get.setAccessible(true);JSONArray reads=new JSONArray();int requests=0;
   Field owner=accountType.getDeclaredField("accountId");owner.setAccessible(true);long accountId=owner.getLong(account);
   for(String path:new String[]{"/action/api/v2/tasks?accountId="+accountId+"&sources=rayneoTasks"}){JSONObject read=new JSONObject().put("path",path.split("\\?",2)[0]).put("matching_id_count",0).put("matching_test_content_count",0);requests++;
    try{byte[] bytes=(byte[])get.invoke(transport,path);JSONObject root=new JSONObject(new String(bytes,StandardCharsets.UTF_8));read.put("code",root.optInt("code",-1));Object data=root.opt("data");read.put("data_kind",data instanceof JSONObject?"object":data instanceof JSONArray?"array":"other");if(data instanceof JSONObject)read.put("data_field_names",((JSONObject)data).names());nodes=0;scan(data,read,0);read.put("read_complete",true);}
    catch(Exception failure){Throwable cause=failure;while(cause.getCause()!=null)cause=cause.getCause();String code=cause.getMessage();read.put("error",code!=null&&code.matches("[A-Z_]{3,80}")?code:cause.getClass().getSimpleName());}
    reads.put(read);
   }
   JSONObject report=new JSONObject().put("schema",1).put("probe_id",nonce).put("read_only",true).put("network_requests",requests).put("native_id",id).put("unrelated_content_exported",false).put("reads",reads);
   try(FileOutputStream out=new FileOutputStream(new File(app.getExternalFilesDir(null),"io-native-todo-read.json"))){out.write(report.toString().getBytes(StandardCharsets.UTF_8));out.getFD().sync();}
   result.putBoolean("passed",true);finish(Activity.RESULT_OK,result);
  }catch(Exception failure){Throwable cause=failure;while(cause.getCause()!=null)cause=cause.getCause();String code=cause.getMessage();result.putString("error",code!=null&&code.matches("[A-Z_]{3,80}")?code:cause.getClass().getSimpleName());finish(Activity.RESULT_CANCELED,result);}
  finally{if(transport!=null)try{Method close=transport.getClass().getDeclaredMethod("close");close.setAccessible(true);close.invoke(transport);}catch(ReflectiveOperationException failure){android.util.Log.w("TodoReadProbe","transport close failed");}}
 }
}
