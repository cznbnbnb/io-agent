package com.turboio.addon;
import android.content.Context;import android.os.SystemClock;
import java.io.*;import java.net.*;import java.lang.reflect.*;import java.nio.charset.StandardCharsets;import java.security.MessageDigest;import java.util.*;import java.util.zip.*;import javax.net.ssl.HttpsURLConnection;
import java.util.concurrent.*;import java.util.concurrent.atomic.AtomicBoolean;

/** Fixed 1.0.10 host adapter for account-owned lifelog reads and typed task creation.
 * All vendor class names, signing-input offsets and account credentials stay here
 * or in Host107Login. Business code receives JSON bytes, never credentials. */
final class Host107LifelogHttp implements OfficialLifelogRefresh.Transport,OfficialLifelogDiscovery.Transport,AutoCloseable {
 private static final String BASE="https://xr-api-p.rayneo.cn";
 private final Context app;private final OfficialAccountBinding account;private final MaterialSyncSession.Guard guard;private final String readTimezone;
 private volatile boolean disabled;private volatile HttpsURLConnection active;private String[] inputs;
 Host107LifelogHttp(Context context,OfficialAccountBinding account,MaterialSyncSession.Guard guard){this(context,account,guard,"Asia/Shanghai");}
 Host107LifelogHttp(Context context,OfficialAccountBinding account,MaterialSyncSession.Guard guard,String timezone){java.time.ZoneId.of(timezone);this.app=context.getApplicationContext();this.account=account;this.guard=guard;this.readTimezone=timezone;}
 private void check()throws IOException{if(disabled||Thread.currentThread().isInterrupted())throw new IOException("MATERIAL_PAUSED");guard.check();}
 private String[] inputs()throws Exception{
  if(inputs!=null)return inputs;MessageDigest hash=MessageDigest.getInstance("SHA-256");byte[] appId=new byte[32],key=new byte[32],buffer=new byte[16384];long position=0;
  try(ZipFile apk=new ZipFile(app.getApplicationInfo().sourceDir)){
   ZipEntry entry=apk.getEntry("lib/arm64-v8a/libapp.so");MaterialWire.require(entry!=null&&entry.getSize()==45089712L,"OFFICIAL_HOST_UNSUPPORTED");
   try(InputStream in=apk.getInputStream(entry)){int n;while((n=in.read(buffer))!=-1){check();hash.update(buffer,0,n);copy(buffer,n,position,9032994,appId);copy(buffer,n,position,12952786,key);position+=n;MaterialWire.require(position<=45089712L,"OFFICIAL_HOST_UNSUPPORTED");}}
   StringBuilder hex=new StringBuilder();for(byte b:hash.digest())hex.append(String.format(Locale.ROOT,"%02x",b&255));MaterialWire.require(position==45089712L&&Arrays.asList("363aa67372f41b65c3ef980d856ceb14013f3300257b9be6b91edd865911e15c","a60b405791a3f1ab3110a7f27a3ab06f95bf5277d63de0ad58ac8bfcae742511").contains(hex.toString()),"OFFICIAL_HOST_UNSUPPORTED");
   inputs=new String[]{new String(appId,StandardCharsets.US_ASCII),new String(key,StandardCharsets.US_ASCII)};MaterialWire.require(inputs[0].matches("[!-~]{32}")&&inputs[1].matches("[!-~]{32}"),"OFFICIAL_SIGNING_UNAVAILABLE");return inputs;
  }finally{Arrays.fill(appId,(byte)0);Arrays.fill(key,(byte)0);Arrays.fill(buffer,(byte)0);}
 }
 private static void copy(byte[] from,int count,long position,int offset,byte[] to){long start=Math.max(position,offset),end=Math.min(position+count,offset+to.length);if(end>start)System.arraycopy(from,(int)(start-position),to,(int)(start-offset),(int)(end-start));}
 public byte[] fetch(String eventId)throws Exception{
  MaterialWire.require(eventId!=null&&eventId.matches("[A-Za-z0-9_-]{1,80}"),"LIFELOG_EVENT_ID_INVALID");return get("/lifelog/api/v1/events/"+eventId+"/full");
 }
 byte[] latestJournals()throws Exception{return get("/lifelog/api/v1/journal/latest");}
 public byte[] full(String eventId)throws Exception{return fetch(eventId);}
 public byte[] list(OfficialLifelogInventory.Request request)throws Exception{
  MaterialWire.require(request!=null&&request.timezone!=null,"LIFELOG_LIST_REQUEST_REQUIRED");return get(OfficialLifelogInventory.Request.day(request.date,request.timezone).path);
 }
 /** A single explicitly selected month. Calendar POST is read-only upstream;
  * this method neither discovers other months nor retries a failed request. */
 public byte[] calendar(OfficialLifelogCalendarRequest selected)throws Exception{
  MaterialWire.require(selected!=null&&"POST".equals(selected.method)&&"/lifelog/api/v1/calendar".equals(selected.path)&&"".equals(selected.query),"LIFELOG_CALENDAR_REQUEST_REQUIRED");
  return post(selected.path,selected.body());
 }
 byte[] createTodo(OfficialTodoCreate.Request selected)throws Exception{return post(selected.path,selected.body());}
 private byte[] post(String path,byte[] body)throws Exception{
  check();byte[] key=null;HttpsURLConnection request=null;ScheduledExecutorService watchdog=null;ScheduledFuture<?> cutoff=null;AtomicBoolean expired=new AtomicBoolean(false);
  try{
   MaterialWire.require(body!=null&&body.length>0&&body.length<=4096,"LIFELOG_CALENDAR_REQUEST_BUDGET");
   String[] signing=inputs();Host107Login.Session login=Host107Login.session(account);check();
   String access=login.accessToken();MaterialWire.require(access!=null&&!access.isEmpty()&&access.length()<=16384&&access.indexOf('\r')<0&&access.indexOf('\n')<0,"OFFICIAL_ACCESS_HEADER_INVALID");
   String nonce=UUID.randomUUID().toString().replace("-",""),timestamp=Long.toString(System.currentTimeMillis()/1000);
   key=signing[1].getBytes(StandardCharsets.UTF_8);
   String canonical=OfficialGatewaySigning.canonical("POST",path,"",nonce,timestamp,body);
   String authorization=OfficialGatewaySigning.authorization(signing[0],key,timestamp,canonical);Arrays.fill(key,(byte)0);key=null;
   check();MaterialWire.require(account.same(Host107Login.account()),"OFFICIAL_ACCOUNT_CHANGED");
   request=(HttpsURLConnection)new URL(BASE+path).openConnection();active=request;check();
   request.setInstanceFollowRedirects(false);request.setUseCaches(false);request.setConnectTimeout(5000);request.setReadTimeout(10000);request.setRequestMethod("POST");request.setDoOutput(true);request.setFixedLengthStreamingMode(body.length);
   request.setRequestProperty("Accept","application/json");request.setRequestProperty("Accept-Encoding","identity");request.setRequestProperty("Content-Type","application/json; charset=utf-8");request.setRequestProperty("app-version","1.0.10");request.setRequestProperty("platform","android");request.setRequestProperty("lang","zh-CN");request.setRequestProperty("time-zone","Asia/Shanghai");request.setRequestProperty("xtcl-access-token",access);
   request.setRequestProperty("xtcl-app",signing[0]);request.setRequestProperty("xtcl-nonce",nonce);request.setRequestProperty("xtcl-timestamp",timestamp);request.setRequestProperty("xtcl-authorization",authorization);
   final HttpsURLConnection owned=request;long deadline=SystemClock.elapsedRealtime()+30000;
   watchdog=Executors.newSingleThreadScheduledExecutor(work->{Thread thread=new Thread(work,"lifelog-calendar-cutoff");thread.setDaemon(true);return thread;});
   cutoff=watchdog.schedule(()->{expired.set(true);owned.disconnect();},30000,TimeUnit.MILLISECONDS);
   calendarCheck(deadline,expired);MaterialWire.require(account.same(Host107Login.account()),"OFFICIAL_ACCOUNT_CHANGED");
   // The private body snapshot supplied to the signer is sent without another
   // serialization. Recheck cancellation after a potentially blocking connect.
   try(OutputStream output=request.getOutputStream()){
    calendarCheck(deadline,expired);MaterialWire.require(account.same(Host107Login.account()),"OFFICIAL_ACCOUNT_CHANGED");output.write(body);calendarCheck(deadline,expired);output.flush();
   }
   calendarCheck(deadline,expired);int status=request.getResponseCode();calendarCheck(deadline,expired);
   if(status!=200)throw new IOException(status==401||status==403?"OFFICIAL_AUTH_REQUIRED":status>=300&&status<400?"OFFICIAL_REDIRECT_REFUSED":"OFFICIAL_SOURCE_UNAVAILABLE");
   String content=request.getContentType(),encoding=request.getContentEncoding();MaterialWire.require(content!=null&&content.matches("(?i)application/json(?:\\s*;\\s*charset=utf-8)?")&&(encoding==null||encoding.equalsIgnoreCase("identity")),"OFFICIAL_RESPONSE_INVALID");MaterialWire.require(request.getContentLengthLong()<=1048576,"OFFICIAL_RESPONSE_BUDGET");
   ByteArrayOutputStream bytes=new ByteArrayOutputStream();try(InputStream in=request.getInputStream()){
    byte[] block=new byte[8192];try{while(true){calendarCheck(deadline,expired);request.setReadTimeout((int)Math.min(10000,Math.max(1,deadline-SystemClock.elapsedRealtime())));int n=in.read(block);calendarCheck(deadline,expired);if(n<0)break;MaterialWire.require(n>0,"OFFICIAL_RESPONSE_READ_STALLED");MaterialWire.require(bytes.size()+n<=1048576,"OFFICIAL_RESPONSE_BUDGET");bytes.write(block,0,n);}}finally{Arrays.fill(block,(byte)0);}
   }
   calendarCheck(deadline,expired);MaterialWire.require(account.same(Host107Login.account()),"OFFICIAL_ACCOUNT_CHANGED");return bytes.toByteArray();
  }catch(Exception failed){if(expired.get())throw new IOException("OFFICIAL_SOURCE_TIMEOUT");check();throw failed;}
  finally{if(cutoff!=null)cutoff.cancel(false);if(watchdog!=null)watchdog.shutdownNow();if(active==request)active=null;if(request!=null)request.disconnect();if(key!=null)Arrays.fill(key,(byte)0);Arrays.fill(body,(byte)0);}
 }
 private void calendarCheck(long deadline,AtomicBoolean expired)throws IOException{
  check();if(expired.get()||SystemClock.elapsedRealtime()>=deadline)throw new IOException("OFFICIAL_SOURCE_TIMEOUT");
 }
 private byte[] get(String path)throws Exception{return exchange("GET",path);}
 byte[] deleteEvent(String eventId)throws Exception{MaterialWire.require(eventId!=null&&eventId.matches("[A-Za-z0-9_-]{1,80}"),"LIFELOG_EVENT_ID_INVALID");return exchange("DELETE","/lifelog/api/v1/events/"+eventId+"?deleteType=event");}
 private byte[] exchange(String verb,String path)throws Exception{
  int maxResponse="GET".equals(verb)&&path.matches("/lifelog/api/v1/events/[A-Za-z0-9_-]{1,80}/full")?OfficialLifelogJson.MAX_EVENT_BYTES:1048576;
  check();String[] signing=inputs();Host107Login.Session login=Host107Login.session(account);check();
  Object signer=null;Method close=null;HttpsURLConnection request=null;
  try{
   Class<?> type=NavReflect.type("com.rayneo.resource.cloud.CloudDictResApi");signer=type.getConstructor().newInstance();close=type.getMethod("close");Method method=type.getDeclaredMethod("genSign",String.class,String.class,String.class,String.class);method.setAccessible(true);Object raw=method.invoke(signer,signing[0],signing[1],verb,path);MaterialWire.require(raw instanceof Map,"OFFICIAL_SIGNING_UNAVAILABLE");Map<?,?> headers=(Map<?,?>)raw;MaterialWire.require(headers.keySet().equals(new HashSet<>(Arrays.asList("xtcl-app","xtcl-nonce","xtcl-timestamp","xtcl-authorization"))),"OFFICIAL_SIGNING_UNAVAILABLE");
   check();MaterialWire.require(account.same(Host107Login.account()),"OFFICIAL_ACCOUNT_CHANGED");request=(HttpsURLConnection)new URL(BASE+path).openConnection();active=request;check();request.setInstanceFollowRedirects(false);request.setUseCaches(false);request.setConnectTimeout(5000);request.setReadTimeout(10000);request.setRequestMethod(verb);request.setRequestProperty("Accept","application/json");request.setRequestProperty("Accept-Encoding","identity");request.setRequestProperty("xtcl-access-token",login.accessToken());request.setRequestProperty("app-version","1.0.10");request.setRequestProperty("platform","android");request.setRequestProperty("lang","zh-CN");request.setRequestProperty("time-zone",readTimezone);for(Map.Entry<?,?> header:headers.entrySet())request.setRequestProperty((String)header.getKey(),(String)header.getValue());
   long deadline=SystemClock.elapsedRealtime()+30000;check();int status=request.getResponseCode();if(status!=200)throw new IOException(status==401||status==403?"OFFICIAL_AUTH_REQUIRED":status>=300&&status<400?"OFFICIAL_REDIRECT_REFUSED":"OFFICIAL_SOURCE_UNAVAILABLE");String content=request.getContentType(),encoding=request.getContentEncoding();MaterialWire.require(content!=null&&content.matches("(?i)application/json(?:\\s*;\\s*charset=utf-8)?")&&(encoding==null||encoding.equalsIgnoreCase("identity")),"OFFICIAL_RESPONSE_INVALID");MaterialWire.require(request.getContentLengthLong()<=maxResponse,"OFFICIAL_RESPONSE_BUDGET");
   ByteArrayOutputStream bytes=new ByteArrayOutputStream();try(InputStream in=request.getInputStream()){byte[] block=new byte[8192];int n;while((n=in.read(block))!=-1){check();if(SystemClock.elapsedRealtime()>deadline)throw new IOException("OFFICIAL_SOURCE_TIMEOUT");MaterialWire.require(bytes.size()+n<=maxResponse,"OFFICIAL_RESPONSE_BUDGET");bytes.write(block,0,n);}}
   check();if(SystemClock.elapsedRealtime()>deadline)throw new IOException("OFFICIAL_SOURCE_TIMEOUT");MaterialWire.require(account.same(Host107Login.account()),"OFFICIAL_ACCOUNT_CHANGED");return bytes.toByteArray();
  }finally{if(active==request)active=null;if(request!=null)request.disconnect();if(signer!=null&&close!=null)try{close.invoke(signer);}catch(Exception ignored){}}
 }
 void disable(){disabled=true;}
 public void cancel(){disable();HttpsURLConnection request=active;if(request!=null)request.disconnect();}
 public void close(){cancel();inputs=null;}
}
