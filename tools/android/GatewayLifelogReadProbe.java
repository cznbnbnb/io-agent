package com.turboio.androidtests;

import android.app.*;import android.content.*;import android.os.*;
import java.io.*;import java.lang.reflect.*;import java.net.*;import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;import java.util.*;import java.util.zip.*;import javax.net.ssl.HttpsURLConnection;import org.json.*;

/** One current-account GET to the original official host. No retries, redirects,
 * mutations, credential export or response-text export. The app signing inputs
 * are read in memory from the hash-pinned installed library, not copied into code.
 * An HTTP/application rejection is a recorded experiment result, not a retry cue. */
public final class GatewayLifelogReadProbe extends Instrumentation {
 private static final class Selected extends Exception {}
 private String nonce,scope;private ClassLoader loader;private File queueFile;private byte[] queueBefore;private Map<String,?> preferencesBefore;private final Map<String,Map<?,?>> committed=new HashMap<>();
 private static void check(boolean ok,String code){if(!ok)throw new IllegalStateException(code);}
 private Object call(Class<?> type,Object owner,String name,Class<?>[] types,Object...values)throws Exception{Method m=type.getDeclaredMethod(name,types);m.setAccessible(true);return m.invoke(owner,values);}
 private Object account()throws Exception{return call(loader.loadClass("com.turboio.addon.Host107Login"),null,"account",new Class<?>[0]);}
 private String binding(Object account)throws Exception{check(account!=null,"OFFICIAL_LOGIN_REQUIRED");return (String)account.getClass().getField("binding").get(account);}
 private static byte[] bounded(InputStream input,int limit)throws Exception{try(InputStream in=input;ByteArrayOutputStream out=new ByteArrayOutputStream()){if(in==null)return new byte[0];byte[] buf=new byte[8192];int n;while((n=in.read(buf))!=-1){check(out.size()+n<=limit,"RESPONSE_LIMIT");out.write(buf,0,n);}return out.toByteArray();}}
 private static String sha(byte[] bytes)throws Exception{StringBuilder s=new StringBuilder();for(byte b:MessageDigest.getInstance("SHA-256").digest(bytes))s.append(String.format(Locale.ROOT,"%02x",b&255));return s.toString();}
 private Class<?> type(String name)throws Exception{return loader.loadClass("com.turboio.addon."+name);}
 private Object field(Object object,String name)throws Exception{Field f=object.getClass().getDeclaredField(name);f.setAccessible(true);return f.get(object);}
 private Map<?,?> parse(byte[] bytes)throws Exception{return (Map<?,?>)call(type("WireJson"),null,"read",new Class<?>[]{byte[].class,int.class,int.class},bytes,8388608,500000);}
 private byte[] canonical(Object value)throws Exception{return (byte[])call(type("WireJson"),null,"bytes",new Class<?>[]{Object.class},value);}
 private void loadCommitted(Context target,String account)throws Exception{
  preferencesBefore=new HashMap<>(target.getSharedPreferences("io_agent_materials_v1",0).getAll());
  Constructor<?> ctor=type("MaterialSettings").getDeclaredConstructor(Context.class);ctor.setAccessible(true);Object config=call(type("MaterialSettings"),ctor.newInstance(target),"load",new Class<?>[0]);check(config!=null&&account.equals(field(config,"account")),"FORMAL_ACCOUNT_MISMATCH");Object connection=field(config,"connection");check("turboio-user".equals(field(connection,"owner"))&&"phone-android".equals(field(connection,"producer")),"FORMAL_CONNECTION_MISMATCH");
  File files=(File)call(type("MaterialSyncSession"),null,"accountFiles",new Class<?>[]{File.class,type("MaterialConfig")},target.getFilesDir(),config);String bind=(String)call(connection.getClass(),connection,"binding",new Class<?>[0]);queueFile=new File(files,"material-outbox/"+bind+"/state.json");check(queueFile.isFile()&&!java.nio.file.Files.isSymbolicLink(queueFile.toPath()),"FORMAL_QUEUE_MISSING");queueBefore=bounded(new FileInputStream(queueFile),8388608);Map<?,?> document=parse(queueBefore);check(bind.equals(document.get("binding")),"FORMAL_QUEUE_BINDING");
  for(Object raw:(List<?>)document.get("rows")){Map<?,?> row=(Map<?,?>)raw;if(!"server_stored".equals(row.get("state")))continue;Map<?,?> event=parse(((String)row.get("payload")).getBytes(StandardCharsets.UTF_8));call(type("MaterialWire"),null,"ack",new Class<?>[]{Map.class,Map.class},row.get("ack"),event);Map<?,?> body=(Map<?,?>)event.get("body");committed.put((String)body.get("material_id"),body);}
 }
 private JSONObject compare(byte[] material)throws Exception{
  Map<?,?> fresh=parse(material),old=committed.get(fresh.get("material_id"));JSONObject out=new JSONObject().put("same_material_id_found",old!=null);if(old==null)return out;
  JSONArray changed=new JSONArray();for(String key:new String[]{"material_id","revision","base_revision","operation","source","started_at","ended_at","completeness","text_revision","utterances","audio","full_text","processing","speakers"})if(!Objects.equals(fresh.get(key),old.get(key)))changed.put(key);
  out.put("changed_fields",changed).put("stored_body_sha256",sha(canonical(old))).put("same_full_text",Objects.equals(fresh.get("full_text"),old.get("full_text")));
  List<?> now=(List<?>)fresh.get("utterances"),before=(List<?>)old.get("utterances");out.put("same_utterance_count",now.size()==before.size());
  if(now.size()==before.size()){JSONObject counts=new JSONObject();for(String key:new String[]{"utterance_id","text","speaker_id","speaker_basis","start_ms","end_ms","overlap"}){int count=0;for(int i=0;i<now.size();i++)if(!Objects.equals(((Map<?,?>)now.get(i)).get(key),((Map<?,?>)before.get(i)).get(key)))count++;counts.put(key,count);}out.put("changed_utterance_fields",counts);}
  // Exercise the exact new source under the test namespace, not an installed
  // product capability claim. The committed queue stays byte-for-byte unchanged.
  Map<String,Object> candidate=new TreeMap<>();for(Map.Entry<?,?> entry:fresh.entrySet())candidate.put((String)entry.getKey(),entry.getValue());long revision=((Number)old.get("revision")).longValue();candidate.put("revision",revision+1);candidate.put("base_revision",revision);
  Class<?> mapper=GatewayLifelogReadProbe.class.getClassLoader().loadClass("com.turboio.androidtests.voice.LifelogRevisionMapper");
  byte[] mapped=(byte[])call(mapper,null,"reconcile",new Class<?>[]{byte[].class,byte[].class},canonical(candidate),canonical(old));Map<?,?> revised=parse(mapped);
  JSONArray remaining=new JSONArray();for(String key:new String[]{"material_id","operation","source","started_at","ended_at","completeness","text_revision","utterances","audio","full_text","processing","speakers"})if(!Objects.equals(revised.get(key),old.get(key)))remaining.put(key);
  boolean idsKept=true;List<?> mappedUtterances=(List<?>)revised.get("utterances");for(int i=0;i<mappedUtterances.size();i++)if(i>=before.size()||!Objects.equals(((Map<?,?>)mappedUtterances.get(i)).get("speaker_id"),((Map<?,?>)before.get(i)).get("speaker_id")))idsKept=false;
  out.put("new_revision_source_checked",true).put("speaker_ids_preserved",idsKept).put("remaining_product_changes",remaining).put("revision_written",false);
  return out;
 }
 @Override public void onCreate(Bundle args){super.onCreate(args);nonce=args.getString("probe_id","");scope=args.getString("scope","latest");start();}
 @Override public void onStart(){Bundle result=new Bundle();result.putString("probe_id",nonce);JSONObject audit=new JSONObject();Object signer=null;Method close=null;HttpsURLConnection http=null;byte[] library=null;int attempts=0;
  try{
   check(nonce.matches("[a-f0-9]{32}"),"PROBE_ID_INVALID");Context target=getTargetContext();loader=target.getClassLoader();
   target.startActivity(new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER).setClassName(target,"com.rayneo.venus.MainActivity").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
   Object current=null;long until=SystemClock.elapsedRealtime()+12000;do{current=account();if(current!=null)break;Thread.sleep(200);}while(SystemClock.elapsedRealtime()<until);String initial=binding(current);
   Class<?> login=loader.loadClass("com.turboio.addon.Host107Login");Map<?,?> records=(Map<?,?>)call(login,null,"records",new Class<?>[0]);check(Boolean.TRUE.equals(call(login,null,"validRecords",new Class<?>[]{Map.class},records)),"OFFICIAL_TOKEN_EXPIRED");
   Object recordAccount=call(loader.loadClass("com.turboio.addon.OfficialAccountBinding"),null,"read",new Class<?>[]{byte[].class},((String)records.get("user_info")).getBytes(StandardCharsets.UTF_8));check(initial.equals(binding(recordAccount)),"OFFICIAL_ACCOUNT_CHANGED");
   String token=new JSONObject((String)records.get("token")).getString("accessToken");check(!token.isEmpty()&&token.length()<16384&&!token.contains("\r")&&!token.contains("\n"),"OFFICIAL_TOKEN_INVALID");
   try(ZipFile zip=new ZipFile(target.getApplicationInfo().sourceDir)){ZipEntry entry=zip.getEntry("lib/arm64-v8a/libapp.so");check(entry!=null&&entry.getSize()==46465968L,"PINNED_LIBRARY_MISSING");library=bounded(zip.getInputStream(entry),48*1024*1024);}
   check(sha(library).equals("48ffd34352bf23eca928ad9c2f576347c4965a5af5ca05a35c1f1ed2ffc9fd50"),"PINNED_LIBRARY_MISMATCH");
   // TCL1 domestic selectors, distinct from AccountGatewaySign (64-byte key).
   // Selector call sites proven in the historical Dart AOT; both exact
   // constants independently matched once in the current pinned original AOT.
   String app=new String(library,9097773,32,StandardCharsets.US_ASCII),key=new String(library,13070688,32,StandardCharsets.US_ASCII);Arrays.fill(library,(byte)0);library=null;
   check(app.matches("[!-~]{32}")&&key.matches("[!-~]{32}"),"SIGNING_INPUT_SHAPE");
   Class<?> type=loader.loadClass("com.rayneo.resource.cloud.CloudDictResApi");signer=type.getConstructor().newInstance();close=type.getMethod("close");
   String path="/lifelog/api/v1/journal/latest",eventId=null;if("detail".equals(scope))loadCommitted(target,initial);
   if("detail".equals(scope)){
    File cache=(File)call(current.getClass(),current,"cacheFile",new Class<?>[]{File.class},new File(target.getApplicationInfo().dataDir,"app_flutter"));
    Map<?,?> entries=(Map<?,?>)call(loader.loadClass("com.turboio.addon.OfficialHiveCache"),null,"read",new Class<?>[]{File.class},cache);
    Set<?> references=(Set<?>)call(loader.loadClass("com.turboio.addon.OfficialHiveCache"),null,"sourceReferences",new Class<?>[]{Map.class},entries);
    String[] selected={null};com.turboio.androidtests.voice.OfficialLifelogLogReader.Session scan=com.turboio.androidtests.voice.OfficialLifelogLogReader.open(new File(target.getApplicationInfo().dataDir,"app_flutter/appLog"));
    try{for(int page=0;page<8&&!scan.complete();page++)scan.next(detail->{
     List<com.turboio.androidtests.voice.OfficialLifelogSnapshot.Source> sources;
     try{sources=com.turboio.androidtests.voice.OfficialLifelogSnapshot.read(detail.eventId,detail.json);}catch(IllegalArgumentException invalid){return;}
     if(sources.isEmpty())return;for(com.turboio.androidtests.voice.OfficialLifelogSnapshot.Source source:sources)if(!references.contains(source.sourceType+"/"+source.sourceId))return;
     selected[0]=detail.eventId;throw new Selected();
    });}catch(Selected done){}
    eventId=selected[0];audit.put("source_selection","current-account-owned successful full response");if(eventId!=null)audit.put("selected_event_id_length",eventId.length());
    check(eventId!=null,"CURRENT_ACCOUNT_EVENT_UNAVAILABLE");path="/lifelog/api/v1/events/"+eventId+"/full";
   }else check("latest".equals(scope),"PROBE_SCOPE_INVALID");
   audit.put("endpoint",eventId==null?"journal/latest":"events/{id}/full");
   Map<?,?> headers=(Map<?,?>)call(type,signer,"genSign",new Class<?>[]{String.class,String.class,String.class,String.class},app,key,"GET",path);
   check(headers.keySet().equals(new HashSet<>(Arrays.asList("xtcl-timestamp","xtcl-nonce","xtcl-app","xtcl-authorization"))),"SIGNING_HEADERS_INVALID");
   check(initial.equals(binding(account())),"OFFICIAL_ACCOUNT_CHANGED");
   http=(HttpsURLConnection)new URL("https://xr-api-p.rayneo.cn"+path).openConnection();http.setInstanceFollowRedirects(false);http.setConnectTimeout(10000);http.setReadTimeout(10000);http.setUseCaches(false);http.setRequestMethod("GET");
   http.setRequestProperty("Accept","application/json");http.setRequestProperty("Accept-Encoding","identity");http.setRequestProperty("xtcl-access-token",token);
   http.setRequestProperty("app-version","1.0.7");http.setRequestProperty("platform","android");http.setRequestProperty("lang","zh-CN");http.setRequestProperty("time-zone","Asia/Shanghai");
   for(Map.Entry<?,?> entry:headers.entrySet())http.setRequestProperty((String)entry.getKey(),(String)entry.getValue());
   attempts++;int status=http.getResponseCode();byte[] body=bounded(status>=400?http.getErrorStream():http.getInputStream(),1048576);
   audit.put("http_status",status).put("response_bytes",body.length).put("response_sha256",sha(body)).put("json_response",false);
   String content=http.getContentType();audit.put("content_type",content!=null&&content.length()<100?content:"unknown");
   if(content!=null&&content.toLowerCase(Locale.ROOT).contains("json")){JSONObject parsed=new JSONObject(new String(body,StandardCharsets.UTF_8));audit.put("json_response",true);Object code=parsed.opt("code");String errorText=parsed.optString("message",parsed.optString("msg",""));String category=errorText.contains("不存在")?"not_found":errorText.contains("登录")?"login":errorText.toLowerCase(Locale.ROOT).contains("token")?"token":"unclassified";audit.put("error_category",category);if(code instanceof Number)audit.put("application_code",code);Object data=parsed.opt("data");audit.put("data_is_object",data instanceof JSONObject).put("data_type",data instanceof JSONObject?"object":data instanceof JSONArray?"array":data instanceof String?"string":data==JSONObject.NULL?"null":"other").put("application_accepted",status==200&&code instanceof Number&&((Number)code).intValue()==0);
    if(data instanceof JSONArray)audit.put("data_array_length",((JSONArray)data).length());
    if(data instanceof String){audit.put("data_string_length",((String)data).length());try{data=new JSONTokener((String)data).nextValue();audit.put("data_string_json_type",data instanceof JSONObject?"object":data instanceof JSONArray?"array":"other");}catch(JSONException ignored){audit.put("data_string_json_type","invalid");}}
    if(data instanceof JSONObject){JSONObject d=(JSONObject)data;audit.put("has_id",d.has("id")).put("has_period_start",d.has("periodStart"));}
    if(eventId!=null&&status==200&&code instanceof Number&&((Number)code).intValue()==0){
     JSONObject normal=new JSONObject(parsed.toString());normal.put("data",data);byte[] normalized=normal.toString().getBytes(StandardCharsets.UTF_8);
     try{List<?> sources=(List<?>)call(loader.loadClass("com.turboio.addon.OfficialLifelogSnapshot"),null,"read",new Class<?>[]{String.class,byte[].class},eventId,normalized);JSONArray shapes=new JSONArray();
      for(Object source:sources){byte[] original=(byte[])call(source.getClass(),source,"original",new Class<?>[0]);List<?> clips=(List<?>)source.getClass().getField("clips").get(source);byte[] material=(byte[])call(source.getClass(),source,"materialBody",new Class<?>[]{String.class,long.class},initial,1L);shapes.put(new JSONObject().put("original_sha256",sha(original)).put("clips",clips.size()).put("material_body_sha256",sha(material)).put("committed_comparison",compare(material)));}
      audit.put("production_snapshot_accepts",true).put("sources",shapes);
     }catch(Exception rejected){while(rejected.getCause() instanceof Exception)rejected=(Exception)rejected.getCause();String message=rejected.getMessage();audit.put("production_snapshot_accepts",false).put("mapping_error",message!=null&&message.matches("[A-Z_]{3,80}")?message:"SOURCE_MAPPING_REJECTED");}
    }}
   check(initial.equals(binding(account())),"OFFICIAL_ACCOUNT_CHANGED");audit.put("account_stable",true);
   if(queueFile!=null){check(Arrays.equals(queueBefore,java.nio.file.Files.readAllBytes(queueFile.toPath()))&&preferencesBefore.equals(target.getSharedPreferences("io_agent_materials_v1",0).getAll()),"FORMAL_STATE_CHANGED");audit.put("formal_queue_and_configuration_unchanged",true).put("formal_account_matches",true);}
   result.putBoolean("completed",true);
  }catch(Throwable e){while(e.getCause()!=null)e=e.getCause();String code=e.getMessage();result.putString("error",code!=null&&code.matches("[A-Z_]{3,80}")?code:"GATEWAY_READ_FAILED");result.putString("failure_class",e.getClass().getSimpleName());}
  finally{if(library!=null)Arrays.fill(library,(byte)0);if(http!=null)http.disconnect();if(signer!=null&&close!=null)try{close.invoke(signer);result.putBoolean("client_closed",true);}catch(Exception ignored){result.putBoolean("client_closed",false);}}
  result.putString("audit",audit.toString());result.putInt("request_attempts",attempts);result.putBoolean("credentials_or_text_exported",false);result.putBoolean("mutations_attempted",false);
  finish(result.getBoolean("completed",false)?Activity.RESULT_OK:Activity.RESULT_CANCELED,result);
 }
}
