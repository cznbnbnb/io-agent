package com.turboio.androidtests;

import android.app.*;import android.content.*;import android.os.*;
import java.lang.reflect.*;import java.util.*;import java.util.concurrent.*;import java.util.concurrent.atomic.*;import org.json.*;
import java.io.File;import java.nio.charset.StandardCharsets;import com.turboio.androidtests.voice.*;

/** Read-only login adapter metadata. Never returns token values or writes the store. */
public final class LoginProbe extends Instrumentation {
 private ClassLoader loader;private boolean verifyUi;private String probeId="";
 private Class<?> type(String n)throws Exception{return loader.loadClass(n);}
 private Object field(Object o,String n)throws Exception{Class<?> c=o instanceof Class?(Class<?>)o:o.getClass();return c.getField(n).get(o instanceof Class?null:o);}
 private Object call(Object o,String n)throws Exception{return o.getClass().getMethod(n).invoke(o);}
 private JSONObject cacheAudit(Map<?,?> records,Object plugin,Object opened,Method gate)throws Exception{
  JSONObject result=new JSONObject().put("persisted_or_uploaded",false);try{
   if(!(Boolean)gate.invoke(null))throw new IllegalArgumentException("OFFICIAL_LOGIN_REQUIRED");
   OfficialAccountBinding account=OfficialAccountBinding.read(((String)records.get("user_info")).getBytes(StandardCharsets.UTF_8));
   File flutter=new File(getTargetContext().getApplicationInfo().dataDir,"app_flutter");
   Map<String,Object> cache=OfficialHiveCache.read(account.cacheFile(flutter));result.put("selected_cache_entries",cache.size());
   Set<String> refs=OfficialHiveCache.sourceReferences(cache);result.put("source_references",refs.size()).put("crc_checked",true);
   JSONObject batch=new JSONObject(LifelogBatchProbeBridge.audit(flutter,()->{
    FutureTask<Object> read=new FutureTask<>(()->call(opened,"x"));((Handler)field(plugin,"f")).post(read);Map<?,?> values=(Map<?,?>)read.get(3000,TimeUnit.MILLISECONDS);
    if(!(Boolean)gate.invoke(null))throw new IllegalArgumentException("OFFICIAL_LOGIN_REQUIRED");
    return ((String)values.get("user_info")).getBytes(StandardCharsets.UTF_8);
   }));
   result.put("production_batch",batch).put("account_stable",true).put("ownership_verified_for_all_observed_sources",batch.getInt("accepted_sources")>0&&batch.getInt("unowned_sources")==0&&batch.getInt("conflicting_sources")==0&&batch.getInt("invalid_responses")==0&&batch.getBoolean("scan_consistent")&&batch.getBoolean("selected_inventory_complete")).put("valid",true);
  }catch(Exception failed){String code=failed.getMessage();result.put("valid",false).put("error",code!=null&&code.matches("[A-Z_]{1,80}")?code:failed.getClass().getSimpleName());}return result;
 }
 @Override public void onCreate(Bundle args){super.onCreate(args);verifyUi=args!=null&&"true".equals(args.getString("verify_ui"));probeId=args==null?"":args.getString("probe_id","");start();}
 private void labels(android.view.View view,Set<String> found){if(view instanceof android.widget.TextView){String value=((android.widget.TextView)view).getText().toString();if(Arrays.asList("电脑任务","原有工具与资料","请先登录","iO Agent").contains(value))found.add(value);}if(view instanceof android.view.ViewGroup){android.view.ViewGroup group=(android.view.ViewGroup)view;for(int i=0;i<group.getChildCount();i++)labels(group.getChildAt(i),found);}}
 @Override public void onStart(){Bundle report=new Bundle();report.putString("probe_id",probeId);String stage="launch";try{
  loader=getTargetContext().getClassLoader();getTargetContext().startActivity(new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER).setClassName(getTargetContext(),"com.rayneo.venus.MainActivity").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
  Object engine=null,plugin=null,store=null;long end=SystemClock.elapsedRealtime()+15000;
  stage="engine_plugin_store";
  do{try{engine=field(type("y8.d"),"b");if(engine!=null){Object registry=field(engine,"d");plugin=((Map<?,?>)field(registry,"a")).get(type("g7.q"));if(plugin!=null){Map<?,?> stores=(Map<?,?>)field(plugin,"d");synchronized(stores){store=stores.get("FlutterSecureStorage");}report.putInt("opened_store_count",stores.size());}}}catch(Exception ignored){}if(store!=null)break;Thread.sleep(250);}while(SystemClock.elapsedRealtime()<end);
  report.putBoolean("engine_present",engine!=null);report.putBoolean("plugin_present",plugin!=null);report.putBoolean("default_store_present",store!=null);
  if(plugin!=null){JSONArray names=new JSONArray();Map<?,?> stores=(Map<?,?>)field(plugin,"d");synchronized(stores){for(Object name:stores.keySet())if(name instanceof String&&((String)name).matches("[A-Za-z_.:-]{1,80}"))names.put(name);}report.putString("opened_store_names",names.toString());}
  if(store==null)throw new IllegalStateException("DEFAULT_STORE_NOT_READY");
  stage="read_on_original_worker";final Object opened=store;FutureTask<Object> read=new FutureTask<>(()->call(opened,"x"));((Handler)field(plugin,"f")).post(read);Object values=read.get(3000,TimeUnit.MILLISECONDS);
  if(!(values instanceof Map))throw new IllegalStateException("STORE_RESULT_NOT_MAP");Map<?,?> records=(Map<?,?>)values;report.putInt("record_count",records.size());JSONArray shapes=new JSONArray();
  for(Map.Entry<?,?> row:records.entrySet()){
   if(!(row.getKey() instanceof String))continue;String key=(String)row.getKey();if(!key.matches("[A-Za-z_]{1,64}"))continue;
   JSONObject shape=new JSONObject();shape.put("key",key);Object value=row.getValue();shape.put("type",value==null?"null":value.getClass().getSimpleName());
   if((key.equals("user_info")||key.toLowerCase(Locale.ROOT).matches(".*(auth|token|login|session).*" ))&&value instanceof String&&((String)value).length()<=65536){
    try{Object parsed=new JSONTokener((String)value).nextValue();shape.put("json_type",parsed.getClass().getSimpleName());if(parsed instanceof JSONObject){JSONObject object=(JSONObject)parsed;JSONObject types=new JSONObject();Iterator<String> keys=object.keys();while(keys.hasNext()){String member=keys.next();if(!member.matches("[A-Za-z_]{1,64}"))continue;Object v=object.opt(member);String kind=v==null||v==JSONObject.NULL?"null":v.getClass().getSimpleName();if(member.toLowerCase(Locale.ROOT).contains("expir")&&v instanceof String){String s=(String)v;kind+=s.matches("[0-9]+")?":digits":s.matches("[0-9]{4}-.*[zZ]")?":utc_date":s.matches("[0-9]{4}-.*[+-][0-9:]+")?":offset_date":s.matches("[0-9]{4}-.*")?":local_date":":other";}types.put(member,kind);}shape.put("fields",types);
     if(key.equals("user_info")){JSONObject matches=new JSONObject();for(String candidate:Arrays.asList("id","uid","userId","user_id","accountId","account_id")){Object id=object.opt(candidate);if(id instanceof String||id instanceof Number){String name=String.valueOf(id);if(name.matches("[A-Za-z0-9_-]{1,128}"))matches.put(candidate,new java.io.File(getTargetContext().getApplicationInfo().dataDir,"app_flutter/api_cache_user_"+name+".hive").isFile());}}shape.put("account_cache_matches",matches);}
     if(key.equals("token")){String expiry=object.optString("accessTokenExpireAt","");shape.put("expiry_format",expiry.replaceAll("[0-9]","0"));try{long until;try{until=java.time.OffsetDateTime.parse(expiry).toInstant().toEpochMilli();}catch(java.time.format.DateTimeParseException local){until=java.time.LocalDateTime.parse(expiry).atZone(java.time.ZoneId.systemDefault()).toInstant().toEpochMilli();}report.putBoolean("aligned_parser_accepts_current_session",!object.optString("accessToken","").trim().isEmpty()&&until>System.currentTimeMillis());}catch(RuntimeException bad){report.putBoolean("aligned_parser_accepts_current_session",false);}}
    }}
    catch(JSONException invalid){shape.put("json_type","not_json");}
   }
   shapes.put(shape);
  }
  report.putString("storage_shapes",shapes.toString());stage="current_gate";Class<?> gate=type("com.turboio.addon.Host107Login");Method check=gate.getDeclaredMethod("loggedIn");check.setAccessible(true);boolean allowed=(Boolean)check.invoke(null);report.putBoolean("current_gate_allows",allowed);
  report.putString("cache_audit",cacheAudit(records,plugin,opened,check).toString());
  if(verifyUi){if(!allowed)throw new IllegalStateException("REAL_LOGIN_NOT_ADMITTED");stage="normal_guarded_entry";AtomicReference<Throwable> failure=new AtomicReference<>();Set<String> found=new HashSet<>();runOnMainSync(()->{try{type("com.turboio.addon.TurboAddon").getMethod("showHome").invoke(null);for(android.view.View root:android.view.inspector.WindowInspector.getGlobalWindowViews())labels(root,found);}catch(Throwable error){failure.set(error);}});if(failure.get()!=null)throw new Exception(failure.get());boolean home=found.contains("电脑任务")&&found.contains("原有工具与资料")&&!found.contains("请先登录");report.putBoolean("normal_guarded_workspace_inflated",home);report.putBoolean("lockscreen_changed",false);report.putBoolean("physical_display_visibility_verified",false);if(!home)throw new IllegalStateException("NORMAL_HOME_NOT_INFLATED");}
  report.putBoolean("credentials_exported",false);report.putBoolean("store_modified",false);finish(Activity.RESULT_OK,report);
 }catch(Throwable t){while(t.getCause()!=null)t=t.getCause();report.putString("failure_stage",stage);report.putString("failure_class",t.getClass().getSimpleName());report.putBoolean("credentials_exported",false);report.putBoolean("store_modified",false);finish(Activity.RESULT_CANCELED,report);}}
}
