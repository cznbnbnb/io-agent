package com.turboio.androidtests;

import android.app.*;import android.content.*;import android.os.*;
import java.io.*;import java.lang.reflect.*;import java.nio.*;import java.nio.charset.StandardCharsets;import java.nio.file.*;import java.util.*;import java.util.zip.CRC32;import org.json.*;

/** Test-only: installed production pipeline, synthetic source tree, real HTTPS.
 * Saved normal configuration must remain paused. Never reads real lifelog files. */
public final class MaterialCloudProbe extends Instrumentation {
 private ClassLoader loader;private String nonce,phase;private long deadline;
 private static final String OWNER="synthetic-cloud-material-android-20261021-a",ID="0123456789abcdef0123456789abcdef",EVENT="123456789012345678";
 private static final long START=1792500000000L;
 private Class<?> type(String n)throws Exception{return loader.loadClass("com.turboio.addon."+n);}
 private Object invoke(Object o,String n,Class<?>[] t,Object...a)throws Exception{Class<?> c=o instanceof Class?(Class<?>)o:o.getClass();Method m=c.getDeclaredMethod(n,t);m.setAccessible(true);return m.invoke(o instanceof Class?null:o,a);}
 private Object field(Object o,String n)throws Exception{Field f=o.getClass().getDeclaredField(n);f.setAccessible(true);return f.get(o);}
 private Object make(String n,Class<?>[] t,Object...a)throws Exception{Constructor<?> c=type(n).getDeclaredConstructor(t);c.setAccessible(true);return c.newInstance(a);}
 private void require(boolean ok,String code){if(!ok)throw new IllegalStateException(code);}
 private Object account()throws Exception{require(SystemClock.elapsedRealtime()<deadline,"MATERIAL_PROBE_DEADLINE");Object a=invoke(type("Host107Login"),"account",new Class<?>[0]);require(a!=null,"OFFICIAL_LOGIN_REQUIRED");return a;}
 private JSONObject clip(String id,int start,int end,String text)throws Exception{return new JSONObject().put("clipId",id).put("clipType","SPEECH").put("speakerType","OTHERS").put("speakerName","合成发言人").put("startTime",Long.toString(START+start)).put("endTime",Long.toString(START+end)).put("content",text).put("translateContent",JSONObject.NULL).put("languageCode","zh-CN");}
 private JSONObject fixture()throws Exception{
  JSONObject ref=new JSONObject().put("sourceType","CONVERSATION").put("sourceId",ID);
  JSONObject original=new JSONObject().put("id",ID).put("startTime",Long.toString(START)).put("endTime",Long.toString(START+10000)).put("transcriptionInfos",new JSONArray().put(ref));
  JSONObject source=new JSONObject().put("sourceId",ID).put("sourceType","CONVERSATION").put("title","合成测试，不执行任务").put("startTime",Long.toString(START)).put("endTime",Long.toString(START+10000)).put("clips",new JSONArray().put(clip("clip-1",0,1000,"只做预览。\n保留全部资料。")).put(clip("clip-2",500,1500,"星期五再执行 😀")).put(clip("clip-3",1500,2000,"")));
  return new JSONObject().put("code",0).put("data",new JSONObject().put("id",EVENT).put("deletable",true).put("originalList",new JSONArray().put(original)).put("transcriptionContents",new JSONArray().put(source)));
 }
 private byte[] cache()throws Exception{
  JSONObject ref=new JSONObject().put("sourceId",ID).put("sourceType","CONVERSATION");
  String value=new JSONObject().put("response",new JSONObject().put("code",0).put("data",new JSONObject().put("events",new JSONArray().put(new JSONObject().put("id",EVENT).put("transcriptionInfos",new JSONArray().put(ref)))))).toString();
  byte[] key="https://xr-api-p.rayneo.cn/lifelog/api/v1/events?date=2026-10-21".getBytes(StandardCharsets.UTF_8),v=value.getBytes(StandardCharsets.UTF_8);
  ByteBuffer b=ByteBuffer.allocate(4+2+key.length+1+4+v.length+4).order(ByteOrder.LITTLE_ENDIAN);b.putInt(b.capacity()).put((byte)1).put((byte)key.length).put(key).put((byte)4).putInt(v.length).put(v);CRC32 crc=new CRC32();crc.update(b.array(),0,b.position());b.putInt((int)crc.getValue());return b.array();
 }
 private void removeOwned(File file,File root)throws Exception{require(file.getCanonicalPath().equals(root.getCanonicalPath())||file.getCanonicalPath().startsWith(root.getCanonicalPath()+File.separator),"MATERIAL_FIXTURE_CLEANUP_SCOPE");require(!Files.isSymbolicLink(file.toPath()),"MATERIAL_FIXTURE_LINK");if(file.isDirectory()){File[] list=file.listFiles();require(list!=null,"MATERIAL_FIXTURE_LIST");for(File child:list)removeOwned(child,root);}require(file.delete(),"MATERIAL_FIXTURE_DELETE");}
 @Override public void onCreate(Bundle args){super.onCreate(args);nonce=args.getString("probe_id","");phase=args.getString("phase","");start();}
 @Override public void onStart(){Bundle report=new Bundle();report.putString("probe_id",nonce);report.putString("phase",phase);Context target=getTargetContext();Map<String,?> before=new HashMap<>(target.getSharedPreferences("io_agent_materials_v1",0).getAll());File root=null;Object http=null;try{
  require(nonce.matches("[a-f0-9]{32}")&&(phase.equals("first")||phase.equals("repeat")),"MATERIAL_PROBE_ARGUMENTS");deadline=SystemClock.elapsedRealtime()+55000;loader=target.getClassLoader();
  target.startActivity(new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER).setClassName(target,"com.rayneo.venus.MainActivity").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
  Object account=null;long ready=SystemClock.elapsedRealtime()+12000;do{try{account=account();}catch(Exception ignored){}if(account!=null)break;Thread.sleep(200);}while(SystemClock.elapsedRealtime()<ready);require(account!=null,"OFFICIAL_LOGIN_REQUIRED");
  Object settings=make("MaterialSettings",new Class<?>[]{Context.class},target),saved=invoke(settings,"load",new Class<?>[0]);require(saved!=null&&Boolean.FALSE.equals(field(saved,"enabled")),"MATERIAL_CONFIG_NOT_PAUSED");Object connection=field(saved,"connection");require(OWNER.equals(field(connection,"owner"))&&"https://cznbnb.cn/io-api/v1".equals(field(connection,"base")),"MATERIAL_SYNTHETIC_OWNER_REQUIRED");require(field(account,"binding").equals(field(saved,"account")),"MATERIAL_ACCOUNT_MISMATCH");
  root=new File(target.getFilesDir(),"material-cloud-test-"+nonce);if(phase.equals("first"))require(root.mkdir(),"MATERIAL_FIXTURE_ALREADY_EXISTS");else require(root.isDirectory(),"MATERIAL_FIXTURE_MISSING");
  final File flutter=new File(root,"app_flutter"),logs=new File(flutter,"appLog");byte[] json=fixture().toString().getBytes(StandardCharsets.UTF_8);
  if(phase.equals("first")){require(logs.mkdirs(),"MATERIAL_FIXTURE_CREATE");Files.write(((File)invoke(account,"cacheFile",new Class<?>[]{File.class},flutter)).toPath(),cache());Files.write(new File(logs,"synthetic.log").toPath(),("[Interceptor.Http] ← [GET https://xr-api-p.rayneo.cn/lifelog/api/v1/events/"+EVENT+"/full?#] response body: "+new String(json,StandardCharsets.UTF_8)+"\n").getBytes(StandardCharsets.UTF_8));}
  Class<?> accountSource=type("OfficialLifelogBatch$AccountSource"),sourceType=type("MaterialSyncSession$Source"),guardType=type("MaterialSyncSession$Guard"),transportType=type("MaterialApi$Transport");
  Object supplier=Proxy.newProxyInstance(loader,new Class<?>[]{accountSource},(o,m,a)->account());
  Object source=Proxy.newProxyInstance(loader,new Class<?>[]{sourceType},(o,m,a)->m.getName().equals("current")?account():invoke(type("OfficialLifelogBatch"),"read",new Class<?>[]{File.class,accountSource},flutter,supplier));
  Object guard=Proxy.newProxyInstance(loader,new Class<?>[]{guardType},(o,m,a)->{require(SystemClock.elapsedRealtime()<deadline,"MATERIAL_PROBE_DEADLINE");return null;});
  Object enabled=invoke(saved,"enabled",new Class<?>[]{boolean.class},true);http=make("MaterialHttp",new Class<?>[]{type("MaterialConnection")},connection);
  Object session=make("MaterialSyncSession",new Class<?>[]{File.class,type("MaterialConfig"),sourceType,guardType,transportType},root,enabled,source,guard,http),status=invoke(session,"sync",new Class<?>[0]);
  require(Integer.valueOf(1).equals(field(status,"stored"))&&Integer.valueOf(0).equals(field(status,"queued"))&&Integer.valueOf(0).equals(field(status,"blocked")),"MATERIAL_PUBLIC_NOT_STORED");require(Integer.valueOf(phase.equals("first")?1:0).equals(field(status,"added")),"MATERIAL_IMPORT_DUPLICATED");
  List<?> sources=(List<?>)invoke(type("OfficialLifelogSnapshot"),"read",new Class<?>[]{String.class,byte[].class},EVENT,json);String id=(String)invoke(sources.get(0),"materialId",new Class<?>[]{String.class},field(saved,"account"));report.putString("material_id",id);report.putInt("stored",1);report.putInt("added",(Integer)field(status,"added"));
  require(before.equals(target.getSharedPreferences("io_agent_materials_v1",0).getAll()),"MATERIAL_SAVED_CONFIG_CHANGED");report.putBoolean("saved_config_unchanged_and_paused",true);report.putBoolean("real_lifelog_read_or_uploaded",false);report.putBoolean("installed_production_classes",true);report.putBoolean("microphone_started",false);
  if(phase.equals("repeat")){removeOwned(root,root);report.putBoolean("test_fixture_removed",true);}report.putBoolean("passed",true);finish(Activity.RESULT_OK,report);
 }catch(Throwable failure){while(failure.getCause()!=null)failure=failure.getCause();String code=failure.getMessage();report.putString("error",code!=null&&code.matches("[A-Z_]{3,90}")?code:failure.getClass().getSimpleName());report.putBoolean("passed",false);finish(Activity.RESULT_CANCELED,report);
 }finally{if(http!=null)try{invoke(http,"cancel",new Class<?>[0]);}catch(Exception ignored){}}}
}
