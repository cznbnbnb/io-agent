package com.turboio.androidtests;

import android.app.*;import android.content.*;import android.content.pm.PackageInfo;import android.os.*;import android.provider.Settings;
import java.io.*;import java.lang.reflect.*;import java.net.*;import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;import java.time.Instant;import java.util.*;import java.util.concurrent.*;
import org.json.*;

/**
 * Read-only probe of the official lifelog cloud read path.
 *
 * Runs inside the signed host process, opens the already-initialized Flutter
 * secure store only to obtain the live access token in memory, performs at most
 * four GET requests against read-only lifelog endpoints, and exports structure
 * only: status, content type, byte count, body digest, JSON key names, array
 * lengths, string lengths and hashed identifiers. No transcript text, token or
 * raw identifier is exported, and no mutating request is made.
 */
public final class LifelogCloudProbe extends Instrumentation {
 private static final String BASE="https://xr-api-p.rayneo.cn";
 private static final int MAX_BODY=768*1024;
 private ClassLoader loader;private String probeId="";private File external;private Bundle args;
 private final JSONObject report=new JSONObject();
 private String accessTokenCache;

 private static void check(boolean ok,String code){if(!ok)throw new IllegalStateException(code);}
 private static String hex(byte[] bytes){StringBuilder out=new StringBuilder();for(byte b:bytes)out.append(String.format(Locale.ROOT,"%02x",b&255));return out.toString();}
 private static String sha(byte[] bytes){try{return hex(MessageDigest.getInstance("SHA-256").digest(bytes));}catch(Exception unavailable){return "";}}
 private static Object field(Object owner,String name)throws Exception{
  Class<?> c=owner instanceof Class?(Class<?>)owner:owner.getClass();
  while(c!=null){try{Field f=c.getDeclaredField(name);f.setAccessible(true);return f.get(owner instanceof Class?null:owner);}catch(NoSuchFieldException next){c=c.getSuperclass();}}
  throw new NoSuchFieldException(name);
 }
 private static Object call(Object owner,String name,Class<?>[] signature,Object...values)throws Exception{
  Class<?> c=owner instanceof Class?(Class<?>)owner:owner.getClass();
  while(c!=null){try{Method m=c.getDeclaredMethod(name,signature);m.setAccessible(true);return m.invoke(owner instanceof Class?null:owner,values);}catch(NoSuchMethodException next){c=c.getSuperclass();}}
  throw new NoSuchMethodException(name);
 }
 private static Object call(Object owner,String name)throws Exception{return call(owner,name,new Class<?>[0]);}
 private void phase(String value){
  try{JSONObject j=new JSONObject().put("probe_id",probeId).put("phase",value).put("at_ms",System.currentTimeMillis());
   try(FileOutputStream stream=new FileOutputStream(new File(external,"io-agent-lifelog-cloud-probe-state.json"))){
    stream.write(j.toString().getBytes(StandardCharsets.UTF_8));stream.getFD().sync();
   }
  }catch(Exception ignored){}
 }

 /** Resolve the live host plugin store and read its token record in memory. */
 private JSONObject readTokenRecord()throws Exception{
  long until=SystemClock.elapsedRealtime()+15000;Object plugin=null;
  while(SystemClock.elapsedRealtime()<until){
   try{
    Object engine=field(loader.loadClass("y8.d"),"b");
    if(engine!=null){
     Object registry=field(engine,"d");Map<?,?> plugins=(Map<?,?>)field(registry,"a");
     Object candidate=plugins.get(loader.loadClass("g7.q"));
     if(candidate!=null){Map<?,?> stores=(Map<?,?>)field(candidate,"d");if(stores.get("FlutterSecureStorage")!=null){plugin=candidate;break;}}
    }
   }catch(Exception ignored){}
   Thread.sleep(250);
  }
  check(plugin!=null,"SECURE_STORE_NOT_READY");
  Map<?,?> stores=(Map<?,?>)field(plugin,"d");final Object store=stores.get("FlutterSecureStorage");
  FutureTask<Object> read=new FutureTask<>(()->call(store,"x"));
  final Runnable task=read::run;Object handler=field(plugin,"f");
  boolean posted=false;
  try{posted=Boolean.TRUE.equals(call(handler,"post",new Class<?>[]{Runnable.class},task));}
  catch(NoSuchMethodException retry){posted=Boolean.TRUE.equals(call(handler,"post",new Class<?>[]{Object.class},task));}
  check(posted,"STORE_READ_NOT_POSTED");
  Object values=read.get(2,TimeUnit.SECONDS);check(values instanceof Map,"STORE_VALUES_INVALID");
  Object token=((Map<?,?>)values).get("token");check(token instanceof String&&((String)token).length()<=16384,"TOKEN_ABSENT");
  JSONObject parsed=new JSONObject((String)token);
  JSONObject shape=new JSONObject();List<String> names=new ArrayList<>();for(Iterator<String> it=parsed.keys();it.hasNext();)names.add(it.next());Collections.sort(names);
  for(String key:names)shape.put(key,describe(parsed.get(key),0));
  Object access=parsed.opt("accessToken");check(access instanceof String&&!((String)access).trim().isEmpty(),"ACCESS_TOKEN_EMPTY");
  accessTokenCache=(String)access;
  return new JSONObject().put("shape",shape).put("access_token_length",((String)access).length());
 }

 private static JSONObject describe(Object value,int depth){
  JSONObject d=new JSONObject();
  try{
   if(depth>3)return d.put("type","depth_cut");
   if(value==null)return d.put("type","null");
   if(value instanceof JSONObject){
    JSONObject o=(JSONObject)value;JSONArray keys=new JSONArray();JSONObject fields=new JSONObject();
    List<String> names=new ArrayList<>();for(Iterator<String> it=o.keys();it.hasNext();)names.add(it.next());Collections.sort(names);
    for(String key:names){keys.put(key);if(fields.length()<60)fields.put(key,describe(o.get(key),depth+1));}
    return d.put("type","object").put("keys",keys).put("fields",fields);
   }
   if(value instanceof JSONArray){
    JSONArray a=(JSONArray)value;d.put("type","array").put("len",a.length());
    if(a.length()>0)d.put("sample",describe(a.get(0),depth+1));
    return d;
   }
   if(value instanceof String){String s=(String)value;return d.put("type","string").put("len",s.length());}
   if(value instanceof Boolean)return d.put("type","bool").put("value",value);
   if(value instanceof Number){double n=((Number)value).doubleValue();return d.put("type","number").put("value",Math.abs(n)>1e15?"large":n);}
  }catch(JSONException ignored){}
  try{return d.put("type","other");}catch(JSONException ignored){return d;}
 }

 private static JSONArray idHashes(JSONObject json,int limit){
  JSONArray out=new JSONArray();
  try{
   Deque<Object> queue=new ArrayDeque<>();queue.add(json);int seen=0;
   while(!queue.isEmpty()&&out.length()<limit){
    Object node=queue.removeFirst();if(++seen>4000)break;
    if(node instanceof JSONObject){
     JSONObject o=(JSONObject)node;
     for(Iterator<String> it=o.keys();it.hasNext();){
      String key=it.next();Object v=o.get(key);
      if(v instanceof String&&key.toLowerCase(Locale.ROOT).matches(".*(id|code)$")&&((String)v).length()<=160){
       String s=(String)v;out.put(new JSONObject().put("key",key).put("len",s.length()).put("sha256_12",sha(s.getBytes(StandardCharsets.UTF_8)).substring(0,12)));
      }else if(v instanceof JSONObject||v instanceof JSONArray)queue.add(v);
     }
    }else if(node instanceof JSONArray){
     JSONArray a=(JSONArray)node;for(int i=0;i<a.length()&&i<20;i++){Object v=a.get(i);if(v instanceof JSONObject||v instanceof JSONArray)queue.add(v);}
    }
   }
  }catch(Exception ignored){}
  return out;
 }

 private static String firstDate(Object node){
  if(node instanceof JSONObject){
   JSONObject o=(JSONObject)node;List<String> names=new ArrayList<>();for(Iterator<String> it=o.keys();it.hasNext();)names.add(it.next());
   for(String key:names){String found=firstDate(o.opt(key));if(found!=null)return found;}
  }else if(node instanceof JSONArray){
   JSONArray a=(JSONArray)node;for(int i=0;i<a.length()&&i<30;i++){String found=firstDate(a.opt(i));if(found!=null)return found;}
  }else if(node instanceof String){String s=(String)node;if(s.matches("\\d{4}-\\d{2}-\\d{2}"))return s;}
  return null;
 }

 private JSONObject get(String base,String path,String authStyle,String authValue,String common)throws Exception{
  JSONObject attempt=new JSONObject().put("base",base).put("path",path).put("auth_style",authStyle==null?"none":authStyle).put("method","GET");
  HttpURLConnection c=null;
  try{
   c=(HttpURLConnection)new URL(base+path).openConnection();
   c.setConnectTimeout(4000);c.setReadTimeout(6000);c.setInstanceFollowRedirects(false);
   c.setRequestMethod("GET");c.setRequestProperty("Accept","application/json");
   c.setRequestProperty("User-Agent","RayNeo/1.0.7 (Linux; Android 16)");
   if(authValue!=null)c.setRequestProperty(authStyle,authValue);
   for(String pair:common.split(";")){int at=pair.indexOf('=');if(at>0)c.setRequestProperty(pair.substring(0,at),pair.substring(at+1));}
   JSONArray headerNames=new JSONArray();for(String name:new TreeSet<>(c.getRequestProperties().keySet()))headerNames.put(name);
   attempt.put("request_header_names",headerNames);
   int status=c.getResponseCode();attempt.put("status",status).put("content_type",String.valueOf(c.getContentType()));
   InputStream in=status>=400?c.getErrorStream():c.getInputStream();byte[] body=new byte[0];
   if(in!=null){
    ByteArrayOutputStream buffer=new ByteArrayOutputStream();byte[] chunk=new byte[8192];int total=0,read;
    while((read=in.read(chunk))>0){if(total+read>MAX_BODY){attempt.put("truncated",true);break;}buffer.write(chunk,0,read);total+=read;}
    body=buffer.toByteArray();in.close();
   }
   attempt.put("bytes",body.length).put("body_sha256",sha(body));
   String trimmed=new String(body,StandardCharsets.UTF_8).trim();
   if(trimmed.startsWith("{")){
    JSONObject json=new JSONObject(trimmed);attempt.put("json",describe(json,0)).put("id_hashes",idHashes(json,12));
    String date=firstDate(json);if(date!=null)attempt.put("first_date",date);
    for(String key:new String[]{"code","message","msg","success","data"})if(json.has(key)&&!key.equals("data"))attempt.put("envelope_"+key,describe(json.get(key),1));
   }else if(trimmed.startsWith("[")){attempt.put("json",describe(new JSONArray(trimmed),0));}
   else{
    attempt.put("body_class",trimmed.isEmpty()?"empty":trimmed.startsWith("<")?"markup":"text").put("body_len",trimmed.length());
    if(status>=400&&body.length<=512){
     String shown=trimmed.replaceAll("[A-Za-z0-9._~+/-]{24,}","<redacted>");
     if(shown.length()>240)shown=shown.substring(0,240);
     attempt.put("error_body",shown);
    }
   }
  }catch(Exception failure){
   attempt.put("error",failure.getClass().getSimpleName());
  }finally{if(c!=null)c.disconnect();}
  return attempt;
 }

 private static JSONArray list(File root,int depth,int budget){
  JSONArray out=new JSONArray();if(root==null||!root.isDirectory())return out;
  Deque<Object[]> queue=new ArrayDeque<>();queue.add(new Object[]{root,"",0});
  int seen=0;
  while(!queue.isEmpty()&&out.length()<budget&&seen++<4000){
   Object[] item=queue.removeFirst();File node=(File)item[0];String relative=(String)item[1];int level=(Integer)item[2];
   File[] children=node.listFiles();if(children==null)continue;Arrays.sort(children,Comparator.comparing(File::getName));
   for(File child:children){
    String path=relative.isEmpty()?child.getName():relative+"/"+child.getName();
    try{out.put(new JSONObject().put("path",path).put("dir",child.isDirectory()).put("bytes",child.isDirectory()?0:child.length()).put("modified_ms",child.lastModified()));}catch(JSONException ignored){}
    if(child.isDirectory()&&level+1<depth)queue.add(new Object[]{child,path,level+1});
    if(out.length()>=budget)break;
   }
  }
  return out;
 }

 private static JSONObject scanKeywords(File file,String[] vocab)throws Exception{
  JSONObject out=new JSONObject();if(file==null||!file.isFile()||file.length()>4*1024*1024)return out;
  byte[] data=new byte[(int)file.length()];
  try(FileInputStream in=new FileInputStream(file)){int offset=0,read;while(offset<data.length&&(read=in.read(data,offset,data.length-offset))>0)offset+=read;}
  String text=new String(data,StandardCharsets.ISO_8859_1).toLowerCase(Locale.ROOT);
  JSONObject counts=new JSONObject();
  for(String word:vocab){int count=0,at=0;while((at=text.indexOf(word,at))>=0){count++;at+=word.length();if(count>5000)break;}if(count>0)counts.put(word,count);}
  return out.put("file",file.getName()).put("bytes",data.length).put("keyword_counts",counts).put("content_exported",false);
 }

 private static JSONArray scanJson(File file,int limit){
  JSONArray out=new JSONArray();if(file==null||!file.isFile()||file.length()>4*1024*1024)return out;
  try{
   byte[] data=new byte[(int)file.length()];
   try(FileInputStream in=new FileInputStream(file)){int offset=0,read;while(offset<data.length&&(read=in.read(data,offset,data.length-offset))>0)offset+=read;}
   String text=new String(data,StandardCharsets.ISO_8859_1);
   for(int i=0;i<text.length()-2&&out.length()<limit;i++){
    if(text.charAt(i)!='{'||text.charAt(i+1)!='"')continue;
    int depth=0;boolean inString=false,escape=false,end=false;int j=i;
    for(;j<text.length()&&j-i<262144;j++){
     char c=text.charAt(j);
     if(inString){if(escape)escape=false;else if(c=='\\')escape=true;else if(c=='"')inString=false;continue;}
     if(c=='"'){inString=true;continue;}
     if(c=='{')depth++;else if(c=='}'){depth--;if(depth==0){end=true;j++;break;}}
    }
    if(!end)continue;
    try{
     JSONObject json=new JSONObject(new String(data,i,j-i,StandardCharsets.UTF_8));
     String flat=json.toString().toLowerCase(Locale.ROOT);
     if(!flat.contains("lifelog")&&!flat.contains("journal")&&!flat.contains("transcription"))continue;
     out.put(new JSONObject().put("bytes",j-i).put("first_date",String.valueOf(firstDate(json))).put("json",describe(json,0)).put("id_hashes",idHashes(json,10)));
     i=j-1;
    }catch(Exception ignored){}
   }
  }catch(Exception ignored){}
  return out;
 }

 private static byte[] readAll(File file)throws Exception{
  byte[] data=new byte[(int)file.length()];
  try(FileInputStream in=new FileInputStream(file)){int offset=0,read;while(offset<data.length&&(read=in.read(data,offset,data.length-offset))>0)offset+=read;}
  return data;
 }

 private static JSONArray scanLogs(File root,int limit){
  JSONArray out=new JSONArray();if(root==null||!root.isDirectory())return out;
  Deque<File> queue=new ArrayDeque<>();queue.add(root);int files=0;
  while(!queue.isEmpty()&&out.length()<limit&&files<400){
   File node=queue.removeFirst();File[] children=node.listFiles();if(children==null)continue;
   Arrays.sort(children,Comparator.comparing(File::getName));
   for(File child:children){
    if(child.isDirectory()){queue.add(child);continue;}
    if(child.length()==0||child.length()>2*1024*1024)continue;
    files++;
    try{
     List<String> lines=java.nio.file.Files.readAllLines(child.toPath(),StandardCharsets.UTF_8);
     for(String line:lines){
      if(out.length()>=limit)break;
      if(line.contains("xtcl-authorization")||line.contains("Signature=")||line.contains("xtcl-app")||line.contains("签名")){
       out.put(new JSONObject().put("file",child.getName()).put("line",line.length()>600?line.substring(0,600):line));
      }
     }
    }catch(Exception ignored){}
   }
  }
  return out;
 }

 @Override public void onCreate(Bundle arguments){super.onCreate(arguments);this.args=arguments;start();}
 @Override public void onStart(){
  Bundle result=new Bundle();JSONArray attempts=new JSONArray();
  try{
   probeId=this.args.getString("probe_id","");check(probeId.matches("[a-f0-9]{32}"),"PROBE_ID_INVALID");
   loader=getTargetContext().getClassLoader();external=getTargetContext().getExternalFilesDir(null);check(external!=null,"EXPORT_UNAVAILABLE");
   report.put("schema",1).put("probe_id",probeId).put("at",Instant.now().toString()).put("read_only",true).put("mutations_attempted",false).put("content_exported",false).put("base_url",BASE);
   Context context=getTargetContext();
   try{PackageInfo info=context.getPackageManager().getPackageInfo(context.getPackageName(),0);report.put("host_version",info.versionName).put("host_code",info.versionCode);}catch(Exception ignored){}
   phase("starting_host");
   context.startActivity(new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER).setClassName(context,"com.rayneo.venus.MainActivity").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
   phase("reading_secure_store");
   report.put("token_record",readTokenRecord());
   try{
    File data=new File(context.getApplicationInfo().dataDir);
    report.put("app_flutter_entries",list(new File(data,"app_flutter"),4,300));
    report.put("files_entries",list(new File(data,"files"),2,80));
    report.put("databases_entries",list(new File(data,"databases"),2,80));
    String[] vocab={"journal","lifelog","event","transcription","speaker","summary","content","text","createdat","updatedat","deleted","revision","audio","duration","conversation","segment","utterance","starttime","endtime","segmentid","sessionid"};
    File appFlutter=new File(data,"app_flutter");File[] boxes=appFlutter.listFiles((dir,name)->name.startsWith("api_cache_")&&name.endsWith(".hive"));
    JSONArray scans=new JSONArray();if(boxes!=null)for(File box:boxes)scans.put(scanKeywords(box,vocab));
    report.put("api_cache_scan",scans);
    JSONArray payloads=new JSONArray();if(boxes!=null)for(File box:boxes)payloads.put(new JSONObject().put("file",box.getName()).put("json_objects",scanJson(box,8)));
    report.put("api_cache_payloads",payloads);
    report.put("app_log_matches",scanLogs(new File(appFlutter,"appLog"),80));
    if("1".equals(this.args.getString("copy_cache",""))&&boxes!=null){
     File dir=new File(external,"lifelog-cache-copy");dir.mkdirs();JSONArray copied=new JSONArray();
     for(File box:boxes){
      File target=new File(dir,box.getName());
      try(FileInputStream in=new FileInputStream(box);FileOutputStream out=new FileOutputStream(target)){byte[] buffer=new byte[8192];int read;while((read=in.read(buffer))>0)out.write(buffer,0,read);out.getFD().sync();}
      copied.put(new JSONObject().put("file",box.getName()).put("bytes",target.length()).put("sha256",sha(readAll(target))));
     }
     report.put("cache_copies",copied);
    }
   }catch(Exception ignored){}
   try{Object gate=loader.loadClass("com.turboio.addon.Host107Login");report.put("host_login_valid",Boolean.TRUE.equals(call(gate,"loggedIn",new Class<?>[0])));}catch(Exception ignored){}
   String access=accessTokenCache;check(access!=null,"ACCESS_TOKEN_UNAVAILABLE");
   String androidId="unknown";try{androidId=String.valueOf(Settings.Secure.getString(context.getContentResolver(),Settings.Secure.ANDROID_ID));}catch(Exception ignored){}
   String common="app-version=1.0.7;platform=android;lang=zh-CN;time-zone=Asia/Shanghai;device-id="+androidId;
   String[][] bases={{"xr-api-p","https://xr-api-p.rayneo.cn"},{"dc-o","https://dc-o.api.leiniao.com"},{"dc-t","https://dc-t.api.leiniao.com"}};
   JSONObject chosen=null;String chosenBase="",winHeader="x-authorization",winValue="Bearer "+access,date="";
   for(String[] base:bases){
    phase("journal_latest_"+base[0]);
    JSONObject latest=get(base[1],"/lifelog/api/v1/journal/latest","x-authorization","Bearer "+access,common);attempts.put(latest);
    winHeader="x-authorization";winValue="Bearer "+access;
    if(latest.optInt("status",0)>=400){
     latest=get(base[1],"/lifelog/api/v1/journal/latest","xtcl-access-token",access,common+";xtcl-timestamp="+System.currentTimeMillis()+";xtcl-nonce="+UUID.randomUUID().toString());attempts.put(latest);
     winHeader="xtcl-access-token";winValue=access;
    }
    if(latest.optInt("status",0)>=400){
     latest=get(base[1],"/lifelog/api/v1/journal/latest","x-authorization",access,common);attempts.put(latest);winHeader="x-authorization";winValue=access;
    }
    if(latest.optInt("status",0)>=400&&base[1].contains("xr-api-p")){
     for(String appId:new String[]{"30361770025373815","51241780538438326"}){
      latest=get(base[1],"/lifelog/api/v1/journal/latest","xtcl-app",appId,common+";xtcl-access-token="+access+";xtcl-nonce="+UUID.randomUUID().toString()+";xtcl-timestamp="+System.currentTimeMillis());
      attempts.put(latest);
      if(latest.optInt("status",0)<400)break;
     }
    }
    if(latest.optInt("status",0)<400&&latest.has("json")){chosen=latest;chosenBase=base[1];date=latest.optString("first_date","");break;}
   }
   report.put("chosen_base",chosenBase).put("journal_date_used",date);
   if(chosen!=null&&!date.isEmpty()){
    phase("journal_detail");
    attempts.put(get(chosenBase,"/lifelog/api/v1/journal/detail?journalDate="+date,winHeader,winValue,common));
   }
   report.put("attempts",attempts);
   File output=new File(external,"io-agent-lifelog-cloud-probe.json");
   byte[] bytes=report.toString(2).getBytes(StandardCharsets.UTF_8);check(bytes.length<=262144,"EXPORT_BUDGET");
   try(FileOutputStream out=new FileOutputStream(output)){out.write(bytes);out.getFD().sync();}
   phase("done");
   result.putBoolean("read_only",true);result.putInt("attempt_count",attempts.length());result.putBoolean("content_exported",false);
   finish(Activity.RESULT_OK,result);
  }catch(Throwable failure){
   while(failure.getCause()!=null)failure=failure.getCause();
   try{
    report.put("error",failure.getMessage()!=null&&failure.getMessage().matches("[A-Z_]{3,80}")?failure.getMessage():"LIFELOG_PROBE_FAILED")
          .put("failure_class",failure.getClass().getSimpleName()).put("attempts",attempts);
    try(FileOutputStream out=new FileOutputStream(new File(external,"io-agent-lifelog-cloud-probe.json"))){out.write(report.toString(2).getBytes(StandardCharsets.UTF_8));out.getFD().sync();}
   }catch(Exception ignored){}
   result.putString("error",String.valueOf(failure.getMessage()));finish(Activity.RESULT_CANCELED,result);
  }
 }
}
