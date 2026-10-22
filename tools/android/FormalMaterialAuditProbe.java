package com.turboio.androidtests;
import android.app.*;import android.content.*;import android.os.*;
import java.io.*;import java.lang.reflect.*;import java.nio.charset.StandardCharsets;import java.nio.file.*;import java.security.MessageDigest;import java.util.*;import org.json.*;

/** Authorized formal material audit: local committed queue only, hashes/counts
 * exported. No HTTP, original-log export, credentials or queue mutations. */
public final class FormalMaterialAuditProbe extends Instrumentation {
 private ClassLoader loader;private String nonce;
 private Class<?> type(String n)throws Exception{return loader.loadClass("com.turboio.addon."+n);}
 private Object call(Object o,String n,Class<?>[] t,Object...a)throws Exception{Class<?> c=o instanceof Class?(Class<?>)o:o.getClass();Method m=c.getDeclaredMethod(n,t);m.setAccessible(true);return m.invoke(o instanceof Class?null:o,a);}
 private Object field(Object o,String n)throws Exception{Field f=o.getClass().getDeclaredField(n);f.setAccessible(true);return f.get(o);}
 private void check(boolean b,String code){if(!b)throw new IllegalStateException(code);}
 private String sha(byte[] b)throws Exception{StringBuilder s=new StringBuilder();for(byte x:MessageDigest.getInstance("SHA-256").digest(b))s.append(String.format(Locale.ROOT,"%02x",x));return s.toString();}
 private Object parsed(Object value)throws Exception{return value instanceof String?call(type("WireJson"),"read",new Class<?>[]{byte[].class},((String)value).getBytes(StandardCharsets.UTF_8)):value;}
 private Object currentAccount(String expected)throws Exception{Object current=call(type("Host107Login"),"account",new Class<?>[0]);check(current!=null&&expected.equals(field(current,"binding")),"FORMAL_ACCOUNT_CHANGED");return current;}
 /** These fixed candidates include the production inventory parser. Dates are cached test
  * scope metadata, not proof of current server membership or complete history. */
 private JSONArray discoveryDays(Context target,String expected)throws Exception{
  JSONArray result=new JSONArray();Field version=type("ProductInfo").getDeclaredField("VERSION");version.setAccessible(true);
  if(!Arrays.asList("0.5.2-dev6","0.5.3-dev1").contains(version.get(null)))return result;
  Object login=currentAccount(expected);File flutter=new File(target.getApplicationInfo().dataDir,"app_flutter");
  File cacheFile=(File)call(login,"cacheFile",new Class<?>[]{File.class},flutter);
  Map<?,?> cache=(Map<?,?>)call(type("OfficialHiveCache"),"read",new Class<?>[]{File.class},cacheFile);
  check(cache.size()<=128,"FORMAL_DISCOVERY_CACHE_BUDGET");Class<?> ownerType=type("OfficialLifelogBatch$AccountSource");
  Object owner=Proxy.newProxyInstance(loader,new Class<?>[]{ownerType},(p,m,a)->currentAccount(expected));
  Object batch=call(type("OfficialLifelogBatch"),"read",new Class<?>[]{File.class,ownerType},flutter,owner);
  check(expected.equals(field(batch,"account"))&&Boolean.TRUE.equals(field(batch,"scanConsistent"))&&Boolean.TRUE.equals(field(batch,"selectedInventoryComplete")),"FORMAL_DISCOVERY_SCAN_INCOMPLETE");
  Map<?,?> observed=(Map<?,?>)field(batch,"eventReferences");Class<?> requestType=type("OfficialLifelogInventory$Request");
  List<String> urls=new ArrayList<>();for(Object key:cache.keySet())urls.add((String)key);Collections.sort(urls);Set<String> paths=new HashSet<>();
  for(String url:urls){
   currentAccount(expected);Object request=call(requestType,"cached",new Class<?>[]{String.class},url);if(field(request,"timezone")==null)continue;
   Object response=parsed(((Map<?,?>)parsed(cache.get(url))).get("response"));
   byte[] encoded=(byte[])call(type("WireJson"),"bytes",new Class<?>[]{Object.class},response);
   Object page=call(type("OfficialLifelogInventory"),"read",new Class<?>[]{requestType,byte[].class},request,encoded);Map<?,?> events=(Map<?,?>)field(page,"events");
   if(events.isEmpty()||!observed.keySet().containsAll(events.keySet()))continue;
   Set<Object> sources=new HashSet<>();boolean knownSources=true;
   for(Map.Entry<?,?> entry:events.entrySet()){
    Set<?> refs=(Set<?>)entry.getValue();Object old=observed.get(entry.getKey());
    if(!(old instanceof Set)||!((Set<?>)old).containsAll(refs)){knownSources=false;break;}
    sources.addAll(refs);
   }
   if(!knownSources||sources.size()<1||sources.size()>2||!paths.add((String)field(request,"path")))continue;
   result.put(new JSONObject().put("date",field(request,"date")).put("timezone",field(request,"timezone")).put("sources",sources.size()));
   if(result.length()==2)break;
  }
  currentAccount(expected);return result;
 }
 @Override public void onCreate(Bundle args){super.onCreate(args);nonce=args.getString("probe_id","");start();}
 @Override public void onStart(){Bundle report=new Bundle();report.putString("probe_id",nonce);try{
  check(nonce.matches("[a-f0-9]{32}"),"FORMAL_PROBE_ID");Context target=getTargetContext();loader=target.getClassLoader();Map<String,?> preferences=new HashMap<>(target.getSharedPreferences("io_agent_materials_v1",0).getAll());
  target.startActivity(new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER).setClassName(target,"com.rayneo.venus.MainActivity").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));Object account=null;long end=SystemClock.elapsedRealtime()+12000;do{account=call(type("Host107Login"),"account",new Class<?>[0]);if(account!=null)break;Thread.sleep(200);}while(SystemClock.elapsedRealtime()<end);check(account!=null,"OFFICIAL_LOGIN_REQUIRED");
  Constructor<?> ctor=type("MaterialSettings").getDeclaredConstructor(Context.class);ctor.setAccessible(true);Object config=call(ctor.newInstance(target),"load",new Class<?>[0]);check(config!=null,"FORMAL_CONFIG_MISSING");Object connection=field(config,"connection");check("turboio-user".equals(field(connection,"owner"))&&"phone-android".equals(field(connection,"producer"))&&"https://cznbnb.cn/io-api/v1".equals(field(connection,"base")),"FORMAL_IDENTITY_MISMATCH");check(field(account,"binding").equals(field(config,"account")),"FORMAL_ACCOUNT_CHANGED");
  File files=(File)call(type("MaterialSyncSession"),"accountFiles",new Class<?>[]{File.class,type("MaterialConfig")},target.getFilesDir(),config);String binding=(String)call(connection,"binding",new Class<?>[0]);File state=new File(files,"material-outbox/"+binding+"/state.json");check(state.isFile()&&state.length()<=8388608&&!Files.isSymbolicLink(state.toPath()),"FORMAL_QUEUE_UNAVAILABLE");byte[] before=Files.readAllBytes(state.toPath());Map<?,?> document=(Map<?,?>)call(type("WireJson"),"read",new Class<?>[]{byte[].class,int.class,int.class},before,8388608,500000);check(binding.equals(document.get("binding")),"FORMAL_QUEUE_BINDING");List<?> rows=(List<?>)document.get("rows");check(rows.size()>0&&rows.size()<=256,"FORMAL_QUEUE_EMPTY");JSONArray items=new JSONArray();int repairs=0;
  for(Object raw:rows){Map<?,?> row=(Map<?,?>)raw;check("server_stored".equals(row.get("state")),"FORMAL_QUEUE_NOT_STORED");byte[] payload=((String)row.get("payload")).getBytes(StandardCharsets.UTF_8);check(sha(payload).equals(row.get("payload_sha256")),"FORMAL_QUEUE_HASH");Map<?,?> event=(Map<?,?>)call(type("MaterialWire"),"event",new Class<?>[]{byte[].class,String.class},payload,"phone-android");call(type("MaterialWire"),"ack",new Class<?>[]{Map.class,Map.class},row.get("ack"),event);Map<?,?> body=(Map<?,?>)event.get("body"),ack=(Map<?,?>)row.get("ack"),full=(Map<?,?>)body.get("full_text");String text=(String)full.get("text");byte[] encoded=(byte[])call(type("WireJson"),"bytes",new Class<?>[]{Object.class},body);
   if(row.get("text_revision_repair")!=null){Map<?,?> repair=(Map<?,?>)row.get("text_revision_repair");byte[] original=((String)repair.get("payload")).getBytes(StandardCharsets.UTF_8);check(sha(original).equals(repair.get("payload_sha256")),"FORMAL_REPAIR_HASH");Map<?,?> oldEvent=(Map<?,?>)call(type("MaterialWire"),"event",new Class<?>[]{byte[].class,String.class},original,"phone-android");Map<?,?> oldBody=(Map<?,?>)oldEvent.get("body");Map<Object,Object> corrected=new HashMap<>(oldBody);corrected.put("text_revision",((Number)oldBody.get("text_revision")).longValue()+1);check(corrected.equals(body)&&oldEvent.get("event_id").equals(repair.get("event_id")),"FORMAL_REPAIR_BODY_CHANGED");repairs++;}
   items.put(new JSONObject().put("material_id",body.get("material_id")).put("revision",body.get("revision")).put("body_sha256",sha(encoded)).put("full_text_sha256",sha(text.getBytes(StandardCharsets.UTF_8))).put("full_text_codepoints",text.codePointCount(0,text.length())).put("utterances",((List<?>)body.get("utterances")).size()).put("speakers",((List<?>)body.get("speakers")).size()).put("event_id",event.get("event_id")).put("commit_seq",ack.get("commit_seq")));
  }
  JSONArray days=discoveryDays(target,(String)field(config,"account"));
  check(Arrays.equals(before,Files.readAllBytes(state.toPath()))&&preferences.equals(target.getSharedPreferences("io_agent_materials_v1",0).getAll()),"FORMAL_AUDIT_CHANGED_STATE");Object current=call(type("Host107Login"),"account",new Class<?>[0]);check(current!=null&&field(current,"binding").equals(field(config,"account")),"FORMAL_ACCOUNT_CHANGED");
  report.putString("audit",new JSONObject().put("items",items).put("queue_schema",document.get("schema")).put("queue_sha256",sha(before)).put("configuration_enabled",field(config,"enabled")).put("preserved_repair_payloads",repairs).put("discovery_test_days",days).toString());report.putBoolean("passed",true);report.putBoolean("state_unchanged",true);report.putBoolean("credentials_or_text_exported",false);report.putInt("network_requests",0);finish(Activity.RESULT_OK,report);
 }catch(Throwable error){while(error.getCause()!=null)error=error.getCause();String code=error.getMessage();report.putString("error",code!=null&&code.matches("[A-Z_]{3,90}")?code:error.getClass().getSimpleName());report.putBoolean("passed",false);finish(Activity.RESULT_CANCELED,report);}}
}
