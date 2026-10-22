package com.turboio.androidtests;

import android.app.*;
import android.content.*;
import android.content.pm.PackageInfo;
import android.os.*;
import java.io.*;
import java.lang.reflect.*;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.LocalDate;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicBoolean;
import javax.net.ssl.HttpsURLConnection;
import org.json.*;

/** Diagnostic-only single explicit-month read POST. No production integration,
 * retries, key alternatives, redirects, persistence or material discovery.
 * Uses the current account's temporary access token for this fixed official
 * origin; no credentials or private response values enter the result Bundle. */
public final class GatewayCalendarReadProbe extends Instrumentation {
 private static final String PATH="/lifelog/api/v1/calendar",URL="https://xr-api-p.rayneo.cn"+PATH;
 private String probeId,month,binding;private ClassLoader host;
 private int shapeNodes,countNodes;
 private static void check(boolean ok,String code){if(!ok)throw new IllegalStateException(code);}
 private Class<?> product(String name)throws Exception{return host.loadClass("com.turboio.addon."+name);}
 private Class<?> local(String name)throws Exception{return getClass().getClassLoader().loadClass("com.turboio.androidtests.voice."+name);}
 private Object call(Object owner,String name,Class<?>[] types,Object...args)throws Exception{Class<?> type=owner instanceof Class?(Class<?>)owner:owner.getClass();Method method=type.getDeclaredMethod(name,types);method.setAccessible(true);return method.invoke(owner instanceof Class?null:owner,args);}
 private Object field(Object owner,String name)throws Exception{Field field=owner.getClass().getDeclaredField(name);field.setAccessible(true);return field.get(owner);}
 private Object account()throws Exception{Object value=call(product("Host107Login"),"account",new Class<?>[0]);check(value!=null,"CALENDAR_ACCOUNT_UNAVAILABLE");return value;}
 private Object awaitAccount()throws Exception{long deadline=SystemClock.elapsedRealtime()+15000;while(true)try{return account();}catch(IllegalStateException unavailable){if(!"CALENDAR_ACCOUNT_UNAVAILABLE".equals(unavailable.getMessage()))throw unavailable;long left=deadline-SystemClock.elapsedRealtime();if(left<=0)throw unavailable;SystemClock.sleep(Math.min(200,left));}}
 private void admit()throws Exception{check(binding!=null&&binding.equals(field(account(),"binding")),"CALENDAR_ACCOUNT_CHANGED");}
 private static String sha(byte[] bytes)throws Exception{StringBuilder hex=new StringBuilder();for(byte b:MessageDigest.getInstance("SHA-256").digest(bytes))hex.append(String.format(Locale.ROOT,"%02x",b&255));return hex.toString();}
 private Object json(byte[] bytes)throws Exception{return call(product("WireJson"),"read",new Class<?>[]{byte[].class,int.class,int.class},bytes,1048576,100000);}
 private static String kind(Object value){return value==null?"null":value instanceof Map?"object":value instanceof List?"array":value instanceof String?"string":value instanceof Boolean?"boolean":value instanceof Number?"number":"unsupported";}
 private static final Set<String> SHAPE_KEYS=new HashSet<>(Arrays.asList("code","data","date","hasLog","hasSummary","dailyLifelogList","dailySummaryList","year","month","day","dates","dateList","list","items","rows","records","total","totalCount","page","pageSize","size","current","pages","hasMore","hasNext","nextPage","cursor","nextCursor","accountId"));
 private Object shape(Object value,int depth)throws Exception{
  check(++shapeNodes<=10000,"CALENDAR_SHAPE_BUDGET");if(depth>=6)return "depth_limit";
  if(value instanceof Map){Map<?,?> values=(Map<?,?>)value;JSONObject result=new JSONObject();int unknown=0;for(Map.Entry<?,?> entry:values.entrySet()){if(SHAPE_KEYS.contains(entry.getKey()))result.put((String)entry.getKey(),shape(entry.getValue(),depth+1));else unknown++;}if(unknown>0)result.put("_other_field_count",unknown);return result;}
  if(value instanceof List){List<?> rows=(List<?>)value;JSONArray sample=new JSONArray();for(int i=0;i<Math.min(rows.size(),2);i++)sample.put(shape(rows.get(i),depth+1));return new JSONObject().put("count",rows.size()).put("sample_shapes",sample);}
  return kind(value);
 }
 private static final class Counts{
  final Map<String,Integer> dateTypes=new TreeMap<>(),hasLogTypes=new TreeMap<>();int dates,isoDates,hasLogs,trueLogs,falseLogs,accounts,comparable,accountMismatch,accountUncomparable;
 }
 private static void hit(Map<String,Integer> values,String key){values.put(key,values.getOrDefault(key,0)+1);}
 private void count(Object value,int depth,Object currentId,Counts counts)throws Exception{
  check(depth<=32&&++countNodes<=100000,"CALENDAR_RESPONSE_SHAPE_BUDGET");
  if(value instanceof Map)for(Map.Entry<?,?> entry:((Map<?,?>)value).entrySet()){
   Object key=entry.getKey(),item=entry.getValue();if("date".equals(key)){counts.dates++;hit(counts.dateTypes,kind(item));if(item instanceof String&&((String)item).matches("[0-9]{4}-[0-9]{2}-[0-9]{2}"))try{LocalDate.parse((String)item);counts.isoDates++;}catch(java.time.DateTimeException ignored){}}
   if("hasLog".equals(key)){counts.hasLogs++;hit(counts.hasLogTypes,kind(item));if(Boolean.TRUE.equals(item))counts.trueLogs++;else if(Boolean.FALSE.equals(item))counts.falseLogs++;}
   if("accountId".equals(key)){counts.accounts++;if(item instanceof Long&&currentId instanceof Long){counts.comparable++;if(!item.equals(currentId))counts.accountMismatch++;}else counts.accountUncomparable++;}
   count(item,depth+1,currentId,counts);
  }else if(value instanceof List)for(Object item:(List<?>)value)count(item,depth+1,currentId,counts);
 }
 private void response(byte[] bytes,int status,Object account,JSONObject audit)throws Exception{
  Object value=json(bytes);audit.put("response_root_type",kind(value));boolean accepted=false;
  if(value instanceof Map){Map<?,?> root=(Map<?,?>)value;Object code=root.get("code");audit.put("application_code_type",kind(code));if(code instanceof Long)audit.put("application_code",code);accepted=status==200&&Long.valueOf(0).equals(code);
   Object data=root.get("data");audit.put("data_type",kind(data));
   // Report a JSON-in-string wrapper separately. Never silently replace it or
   // promote its fields into a production calendar contract.
   if(data instanceof String){byte[] nested=((String)data).getBytes(StandardCharsets.UTF_8);try{if(nested.length<=1048576){Object parsed=json(nested);audit.put("data_string_json_type",kind(parsed));data=parsed;}}catch(Exception invalid){audit.put("data_string_json_type","unparsed");}finally{Arrays.fill(nested,(byte)0);}}
   audit.put("data_shape",shape(data,0));Counts counts=new Counts();count(data,0,field(account,"accountId"),counts);
   audit.put("date_field_count",counts.dates).put("date_types",new JSONObject(counts.dateTypes)).put("valid_iso_date_string_count",counts.isoDates).put("hasLog_field_count",counts.hasLogs).put("hasLog_types",new JSONObject(counts.hasLogTypes)).put("hasLog_true_count",counts.trueLogs).put("hasLog_false_count",counts.falseLogs);
   audit.put("account_field_count",counts.accounts).put("account_fields_present",counts.accounts>0).put("account_field_comparable_count",counts.comparable).put("account_field_uncomparable_count",counts.accountUncomparable).put("account_fields_match_current",counts.accounts>0&&counts.comparable==counts.accounts&&counts.accountMismatch==0).put("account_field_mismatch_count",counts.accountMismatch);
  }
  audit.put("server_accepted_body_signing",accepted);
 }
 private static void deadline(long deadline,AtomicBoolean expired)throws IOException{if(expired.get()||SystemClock.elapsedRealtime()>=deadline||Thread.currentThread().isInterrupted())throw new IOException("CALENDAR_HTTP_DEADLINE");}
 @Override public void onCreate(Bundle args){super.onCreate(args);probeId=args==null?"":args.getString("probe_id","");month=args==null?null:args.getString("month");start();}
 @Override public void onStart(){
  Context context=getTargetContext();Bundle result=new Bundle();JSONObject audit=new JSONObject();Object adapter=null,account=null,stateReader=null,stateBefore=null;File root=null;HttpsURLConnection http=null;ScheduledExecutorService watchdog=null;ScheduledFuture<?> cutoff=null;byte[] body=null,key=null,response=null;String[] inputs=null;int attempts=0;boolean responseCompleted=false,tokenUsed=false,signedAndSent=false;AtomicBoolean expired=new AtomicBoolean(false);
  try{
   check(probeId.matches("[a-f0-9]{32}"),"CALENDAR_PROBE_ID_INVALID");check(month!=null&&month.matches("[0-9]{4}-[0-9]{2}"),"CALENDAR_EXPLICIT_MONTH_REQUIRED");
   check("com.rayneo.venus.pub".equals(context.getPackageName()),"CALENDAR_HOST_MISMATCH");PackageInfo pkg=context.getPackageManager().getPackageInfo(context.getPackageName(),0);check(pkg.getLongVersionCode()==10423&&"0.5.3-dev1".equals(pkg.versionName),"CALENDAR_HOST_MISMATCH");host=context.getClassLoader();
   Object request=call(local("OfficialLifelogCalendarRequest"),"month",new Class<?>[]{String.class},month);check("POST".equals(field(request,"method"))&&PATH.equals(field(request,"path"))&&"".equals(field(request,"query")),"CALENDAR_REQUEST_CONTRACT_INVALID");body=(byte[])call(request,"body",new Class<?>[0]);check(body!=null&&body.length>0&&body.length<=4096,"CALENDAR_REQUEST_BUDGET");String originalHash=sha(body);audit.put("request_bytes",body.length).put("request_sha256",originalHash).put("explicit_month_supplied",true);
   account=awaitAccount();binding=(String)field(account,"binding");root=new File(context.getApplicationInfo().dataDir).getCanonicalFile();
   // Reuse the already-reviewed read-only hash fence; no queue JSON is parsed.
   stateReader=getClass().getClassLoader().loadClass("com.turboio.androidtests.GatewayHeaderShapeProbe").getConstructor().newInstance();stateBefore=call(stateReader,"state",new Class<?>[]{File.class},root);admit();
   Class<?> guard=product("MaterialSyncSession$Guard");Object noWrites=java.lang.reflect.Proxy.newProxyInstance(host,new Class<?>[]{guard},(p,m,a)->{if(Thread.currentThread().isInterrupted())throw new IOException("CALENDAR_INTERRUPTED");return null;});
   Constructor<?> constructor=product("Host107LifelogHttp").getDeclaredConstructor(Context.class,product("OfficialAccountBinding"),guard);constructor.setAccessible(true);adapter=constructor.newInstance(context,account,noWrites);inputs=(String[])call(adapter,"inputs",new Class<?>[0]);check(inputs!=null&&inputs.length==2,"CALENDAR_SIGNING_INPUT_UNAVAILABLE");
   Object session=call(product("Host107Login"),"session",new Class<?>[]{product("OfficialAccountBinding")},account);String access=(String)call(session,"accessToken",new Class<?>[0]);check(access!=null&&!access.isEmpty()&&access.length()<=16384&&access.indexOf('\r')<0&&access.indexOf('\n')<0,"CALENDAR_ACCESS_HEADER_INVALID");
   String nonce=UUID.randomUUID().toString().replace("-",""),timestamp=Long.toString(System.currentTimeMillis()/1000);Class<?> signing=local("OfficialGatewaySigning");key=inputs[1].getBytes(StandardCharsets.UTF_8);
   String canonical=(String)call(signing,"canonical",new Class<?>[]{String.class,String.class,String.class,String.class,String.class,byte[].class},"POST",PATH,"",nonce,timestamp,body);
   String authorization=(String)call(signing,"authorization",new Class<?>[]{String.class,byte[].class,String.class,String.class},inputs[0],key,timestamp,canonical);Arrays.fill(key,(byte)0);key=null;admit();
   http=(HttpsURLConnection)new java.net.URL(URL).openConnection();http.setInstanceFollowRedirects(false);http.setUseCaches(false);http.setConnectTimeout(5000);http.setReadTimeout(10000);http.setRequestMethod("POST");http.setDoOutput(true);http.setFixedLengthStreamingMode(body.length);
   http.setRequestProperty("Accept","application/json");http.setRequestProperty("Accept-Encoding","identity");http.setRequestProperty("Content-Type","application/json; charset=utf-8");http.setRequestProperty("app-version","1.0.7");http.setRequestProperty("platform","android");http.setRequestProperty("lang","zh-CN");http.setRequestProperty("time-zone","Asia/Shanghai");http.setRequestProperty("xtcl-access-token",access);tokenUsed=true;
   http.setRequestProperty("xtcl-app",inputs[0]);http.setRequestProperty("xtcl-nonce",nonce);http.setRequestProperty("xtcl-timestamp",timestamp);http.setRequestProperty("xtcl-authorization",authorization);access=null;session=null;authorization=null;canonical=null;
   final HttpsURLConnection active=http;long stopAt=SystemClock.elapsedRealtime()+30000;watchdog=Executors.newSingleThreadScheduledExecutor(work->{Thread thread=new Thread(work,"calendar-read-cutoff");thread.setDaemon(true);return thread;});cutoff=watchdog.schedule(()->{expired.set(true);active.disconnect();},30000,TimeUnit.MILLISECONDS);
   check(originalHash.equals(sha(body)),"CALENDAR_BODY_CHANGED");deadline(stopAt,expired);attempts=1;
   try(OutputStream output=http.getOutputStream()){deadline(stopAt,expired);output.write(body);output.flush();}check(originalHash.equals(sha(body)),"CALENDAR_BODY_CHANGED");signedAndSent=true;deadline(stopAt,expired);
   int status=http.getResponseCode();audit.put("http_status",status);deadline(stopAt,expired);String content=http.getContentType(),encoding=http.getContentEncoding();boolean jsonContent=content!=null&&content.matches("(?i)application/json(?:\\s*;\\s*charset=utf-8)?"),identity=encoding==null||encoding.equalsIgnoreCase("identity");audit.put("json_content_type",jsonContent).put("identity_content_encoding",identity);check(status<300||status>=400,"CALENDAR_REDIRECT_REFUSED");check(jsonContent&&identity,"CALENDAR_RESPONSE_FORMAT_UNSUPPORTED");check(http.getContentLengthLong()<=1048576,"CALENDAR_RESPONSE_BUDGET");
   InputStream selected=status>=400?http.getErrorStream():http.getInputStream();check(selected!=null,"CALENDAR_RESPONSE_EMPTY");
   try(InputStream input=selected;ByteArrayOutputStream bytes=new ByteArrayOutputStream()){byte[] block=new byte[8192];try{while(true){deadline(stopAt,expired);http.setReadTimeout((int)Math.min(10000,Math.max(1,stopAt-SystemClock.elapsedRealtime())));int n=input.read(block);if(n<0)break;check(n>0,"CALENDAR_RESPONSE_READ_STALLED");check(bytes.size()+n<=1048576,"CALENDAR_RESPONSE_BUDGET");bytes.write(block,0,n);}deadline(stopAt,expired);response=bytes.toByteArray();}finally{Arrays.fill(block,(byte)0);}}
   cutoff.cancel(false);watchdog.shutdownNow();audit.put("response_bytes",response.length);admit();response(response,status,account,audit);responseCompleted=true;
  }catch(Throwable failure){while(failure.getCause()!=null)failure=failure.getCause();String code=failure.getMessage();result.putString("error",expired.get()?"CALENDAR_HTTP_DEADLINE":code!=null&&code.matches("(?:CALENDAR|OFFICIAL|LIFELOG_CALENDAR|GATEWAY_SIGNING|HEADER_SHAPE)_[A-Z_]+")?code:"CALENDAR_READ_FAILED");}
  finally{
   if(cutoff!=null)cutoff.cancel(false);if(watchdog!=null)watchdog.shutdownNow();if(http!=null)http.disconnect();if(adapter!=null)try{call(adapter,"close",new Class<?>[0]);}catch(Exception ignored){}
   if(key!=null)Arrays.fill(key,(byte)0);if(body!=null)Arrays.fill(body,(byte)0);if(response!=null)Arrays.fill(response,(byte)0);if(inputs!=null)Arrays.fill(inputs,null);
   boolean stable=false;try{admit();Object after=call(stateReader,"state",new Class<?>[]{File.class},root);boolean settings=stateBefore!=null&&Objects.equals(field(stateBefore,"settings"),field(after,"settings")),queues=stateBefore!=null&&Objects.equals(field(stateBefore,"queues"),field(after,"queues"));stable=settings&&queues;result.putBoolean("account_binding_unchanged",true);result.putBoolean("material_settings_bytes_unchanged",settings);result.putBoolean("queue_bytes_unchanged",queues);result.putInt("queue_files_checked",stateBefore==null?0:((Map<?,?>)field(stateBefore,"queues")).size());}catch(Throwable unavailable){result.putBoolean("state_proof_unavailable",true);}
   boolean accepted=audit.optBoolean("server_accepted_body_signing",false);result.putString("probe_id",probeId);result.putBoolean("completed",true);result.putBoolean("experiment_response_completed",responseCompleted);result.putBoolean("passed",stable&&responseCompleted&&accepted);result.putBoolean("state_unchanged",stable);result.putInt("request_attempts",attempts);result.putInt("logical_http_calls",attempts);result.putBoolean("application_level_retries",false);result.putBoolean("transport_internal_retries_observable",false);result.putBoolean("activity_started_by_probe",false);result.putBoolean("account_access_token_used",tokenUsed);result.putBoolean("signed_and_sent_same_bytes",signedAndSent);result.putBoolean("current_dart_nonempty_body_vector_verified",false);result.putBoolean("production_calendar_discovery_enabled",false);result.putBoolean("credentials_or_private_text_exported",false);result.putString("audit",audit.toString());finish(result.getBoolean("passed",false)?Activity.RESULT_OK:Activity.RESULT_CANCELED,result);
  }
 }
}
