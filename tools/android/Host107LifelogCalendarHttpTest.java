package com.turboio.addon;

import android.content.Context;
import java.io.*;
import java.net.*;
import java.lang.reflect.Field;
import java.nio.charset.StandardCharsets;
import java.security.Principal;
import java.security.cert.Certificate;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicReference;
import javax.net.ssl.HttpsURLConnection;

/** No sockets: URL connections, login and Android context are finite test doubles.
 * The production HTTP adapter, month request and signing algorithm are compiled
 * unchanged. No installed APK, credentials or user data are read. */
public final class Host107LifelogCalendarHttpTest {
 static int checks,opens;static Fake next;static Runnable opened=()->{};
 static final OfficialAccountBinding OWNER=new OfficialAccountBinding("synthetic-owner"),OTHER=new OfficialAccountBinding("other-owner");
 static final String APP="calendar-test-app",KEY="synthetic-only-signing-key";
 interface Work{void run()throws Exception;}
 static void yes(boolean condition){checks++;if(!condition)throw new AssertionError("calendar transport check "+checks);}
 static void fails(String code,Work work)throws Exception{try{work.run();throw new AssertionError("expected "+code);}catch(Exception error){yes(code.equals(error.getMessage()));}}
 static OfficialLifelogCalendarRequest month(){return OfficialLifelogCalendarRequest.month(2026,10);}
 static Fake fresh()throws Exception{Host107Login.current=OWNER;Host107Login.token="synthetic-access";opens=0;opened=()->{};return next=new Fake();}
 static Host107LifelogHttp adapter()throws Exception{return adapter(()->{});}
 static Host107LifelogHttp adapter(MaterialSyncSession.Guard guard)throws Exception{
  Host107LifelogHttp adapter=new Host107LifelogHttp(new Context(),OWNER,guard);Field inputs=Host107LifelogHttp.class.getDeclaredField("inputs");inputs.setAccessible(true);inputs.set(adapter,new String[]{APP,KEY});return adapter;
 }
 static final class Fake extends HttpsURLConnection {
  final ByteArrayOutputStream sent=new ByteArrayOutputStream();final CountDownLatch entered=new CountDownLatch(1),disconnected=new CountDownLatch(1);
  byte[] response="{\"code\":0,\"data\":{}}".getBytes(StandardCharsets.UTF_8);String content="application/json; charset=utf-8",encoding;long length=-1;int status=200,outputCalls,responseCalls,readCalls;boolean stallConnect,zeroRead;Runnable outputHook=()->{},readHook=()->{};
  Fake()throws Exception{super(new URL("https://xr-api-p.rayneo.cn/lifelog/api/v1/calendar"));}
  public void connect(){}public void disconnect(){disconnected.countDown();}public boolean usingProxy(){return false;}
  public String getCipherSuite(){return "synthetic";}public Certificate[] getLocalCertificates(){return null;}public Certificate[] getServerCertificates(){return null;}public Principal getPeerPrincipal(){return null;}public Principal getLocalPrincipal(){return null;}
  public OutputStream getOutputStream()throws IOException{outputCalls++;entered.countDown();outputHook.run();if(stallConnect){try{if(!disconnected.await(35,TimeUnit.SECONDS))throw new IOException("TEST_GUARD_MISSING");}catch(InterruptedException e){Thread.currentThread().interrupt();throw new IOException("TEST_INTERRUPTED");}throw new IOException("TEST_DISCONNECTED");}return sent;}
  public int getResponseCode(){responseCalls++;return status;}public String getContentType(){return content;}public String getContentEncoding(){return encoding;}public long getContentLengthLong(){return length;}
  public InputStream getInputStream(){return new ByteArrayInputStream(response){public synchronized int read(byte[] bytes,int off,int count){readCalls++;readHook.run();return zeroRead?0:super.read(bytes,off,count);}};}
  int fixedLength(){return fixedContentLength;}
 }
 public static void main(String[] args)throws Exception{
  URL.setURLStreamHandlerFactory(protocol->"https".equals(protocol)?new URLStreamHandler(){protected URLConnection openConnection(URL url){opens++;if(!"https://xr-api-p.rayneo.cn/lifelog/api/v1/calendar".equals(url.toString()))throw new AssertionError("non-calendar URL");opened.run();return next;}}:null);
  Fake f=fresh();Host107LifelogHttp a=adapter();OfficialLifelogCalendarRequest request=month();byte[] exposed=request.body();Arrays.fill(exposed,(byte)'x');byte[] result=a.calendar(request);
  yes(Arrays.equals(result,f.response));yes(opens==1&&f.outputCalls==1&&f.responseCalls==1);yes(f.disconnected.getCount()==0);
  yes("POST".equals(f.getRequestMethod())&&f.getDoOutput()&&!f.getUseCaches()&&!f.getInstanceFollowRedirects());yes(f.getConnectTimeout()==5000&&f.getReadTimeout()>0&&f.getReadTimeout()<=10000);yes(f.fixedLength()==request.body().length);yes(Arrays.equals(f.sent.toByteArray(),request.body()));
  yes("Asia/Shanghai".equals(f.getRequestProperty("time-zone")));yes("identity".equals(f.getRequestProperty("Accept-Encoding")));yes("application/json; charset=utf-8".equals(f.getRequestProperty("Content-Type")));yes("synthetic-access".equals(f.getRequestProperty("xtcl-access-token")));
  String nonce=f.getRequestProperty("xtcl-nonce"),timestamp=f.getRequestProperty("xtcl-timestamp");String canonical=OfficialGatewaySigning.canonical("POST","/lifelog/api/v1/calendar","",nonce,timestamp,f.sent.toByteArray());
  yes(OfficialGatewaySigning.authorization(APP,KEY.getBytes(StandardCharsets.UTF_8),timestamp,canonical).equals(f.getRequestProperty("xtcl-authorization")));
  f=fresh();a=adapter();a.cancel();final Host107LifelogHttp cancelled=a;fails("MATERIAL_PAUSED",()->cancelled.calendar(month()));yes(opens==0);
  f=fresh();a=adapter(()->{throw new IOException("MATERIAL_PAUSED");});final Host107LifelogHttp paused=a;fails("MATERIAL_PAUSED",()->paused.calendar(month()));yes(opens==0);
  f=fresh();a=adapter();Host107Login.current=OTHER;final Host107LifelogHttp wrongOwner=a;fails("OFFICIAL_ACCOUNT_CHANGED",()->wrongOwner.calendar(month()));yes(opens==0);
  f=fresh();a=adapter();opened=()->Host107Login.current=OTHER;final Host107LifelogHttp swappedBeforeSend=a;fails("OFFICIAL_ACCOUNT_CHANGED",()->swappedBeforeSend.calendar(month()));yes(f.outputCalls==0&&f.sent.size()==0&&f.disconnected.getCount()==0);
  f=fresh();a=adapter();final Host107LifelogHttp cancelledDuringOpen=a;f.outputHook=a::cancel;fails("MATERIAL_PAUSED",()->cancelledDuringOpen.calendar(month()));yes(f.sent.size()==0&&f.responseCalls==0);
  f=fresh();a=adapter();f.outputHook=()->Host107Login.current=OTHER;final Host107LifelogHttp swappedDuringOpen=a;fails("OFFICIAL_ACCOUNT_CHANGED",()->swappedDuringOpen.calendar(month()));yes(f.sent.size()==0);
  f=fresh();a=adapter();f.readHook=()->Host107Login.current=OTHER;final Host107LifelogHttp swappedAfterSend=a;fails("OFFICIAL_ACCOUNT_CHANGED",()->swappedAfterSend.calendar(month()));yes(f.outputCalls==1&&f.disconnected.getCount()==0);
  f=fresh();a=adapter();f.readHook=a::cancel;final Host107LifelogHttp cancelledAfterSend=a;fails("MATERIAL_PAUSED",()->cancelledAfterSend.calendar(month()));yes(f.disconnected.getCount()==0);
  f=fresh();a=adapter();Host107Login.token="bad\r\nheader";final Host107LifelogHttp badToken=a;fails("OFFICIAL_ACCESS_HEADER_INVALID",()->badToken.calendar(month()));yes(opens==0);
  for(int status:new int[]{301,302,307,308,401,403,429,500}){
   f=fresh();f.status=status;final Host107LifelogHttp failing=adapter();fails(status==401||status==403?"OFFICIAL_AUTH_REQUIRED":status<400?"OFFICIAL_REDIRECT_REFUSED":"OFFICIAL_SOURCE_UNAVAILABLE",()->failing.calendar(month()));yes(opens==1&&f.outputCalls==1&&f.responseCalls==1&&f.readCalls==0&&f.disconnected.getCount()==0);
  }
  f=fresh();f.content="text/html";final Host107LifelogHttp html=adapter();fails("OFFICIAL_RESPONSE_INVALID",()->html.calendar(month()));yes(f.readCalls==0);
  f=fresh();f.encoding="gzip";final Host107LifelogHttp gzip=adapter();fails("OFFICIAL_RESPONSE_INVALID",()->gzip.calendar(month()));yes(f.readCalls==0);
  f=fresh();f.length=1048577;final Host107LifelogHttp largeLength=adapter();fails("OFFICIAL_RESPONSE_BUDGET",()->largeLength.calendar(month()));yes(f.readCalls==0);
  f=fresh();f.response=new byte[1048577];final Host107LifelogHttp largeBody=adapter();fails("OFFICIAL_RESPONSE_BUDGET",()->largeBody.calendar(month()));yes(f.disconnected.getCount()==0);
  f=fresh();f.zeroRead=true;final Host107LifelogHttp stalled=adapter();fails("OFFICIAL_RESPONSE_READ_STALLED",()->stalled.calendar(month()));yes(f.readCalls==1);
  f=fresh();final Host107LifelogHttp nullRequest=adapter();fails("LIFELOG_CALENDAR_REQUEST_REQUIRED",()->nullRequest.calendar(null));yes(opens==0);
  // Cancelling a blocked connection requires no request worker progress.
  f=fresh();f.stallConnect=true;final Fake blocked=f;final Host107LifelogHttp blocking=adapter();AtomicReference<Throwable> failure=new AtomicReference<>();Thread worker=new Thread(()->{try{blocking.calendar(month());}catch(Throwable error){failure.set(error);}},"calendar-test-blocked");worker.start();yes(blocked.entered.await(2,TimeUnit.SECONDS));blocking.cancel();worker.join(2000);yes(!worker.isAlive()&&failure.get()!=null&&"MATERIAL_PAUSED".equals(failure.get().getMessage()));yes(blocked.sent.size()==0);
  // The real 30-second scheduled disconnect releases a worker held inside
  // getOutputStream. No cooperative read loop, fake clock or model drives it.
  f=fresh();f.stallConnect=true;final Fake timed=f;final Host107LifelogHttp timeout=adapter();long began=System.nanoTime();fails("OFFICIAL_SOURCE_TIMEOUT",()->timeout.calendar(month()));long elapsed=TimeUnit.NANOSECONDS.toMillis(System.nanoTime()-began);yes(elapsed>=29000&&elapsed<34000);yes(timed.disconnected.getCount()==0&&timed.outputCalls==1&&timed.sent.size()==0&&timed.responseCalls==0);
  System.out.println("Calendar transport: "+checks+" checks passed; fake HTTPS only, real independent deadline");
 }
}

// Only the adapter's platform/account boundaries are stubbed.
final class OfficialAccountBinding{final String binding;OfficialAccountBinding(String value){binding=value;}boolean same(OfficialAccountBinding other){return other!=null&&binding.equals(other.binding);}}
final class Host107Login{static OfficialAccountBinding current;static String token;static OfficialAccountBinding account(){return current;}static Session session(OfficialAccountBinding owner){MaterialWire.require(owner.same(current),"OFFICIAL_ACCOUNT_CHANGED");return new Session();}static final class Session{String accessToken(){return token;}}}
final class MaterialWire{static void require(boolean condition,String code){if(!condition)throw new IllegalArgumentException(code);}}
final class MaterialSyncSession{interface Guard{void check()throws IOException;}}
final class OfficialLifelogRefresh{interface Transport{byte[] fetch(String id)throws Exception;}}
final class OfficialLifelogDiscovery{interface Transport{byte[] full(String id)throws Exception;byte[] list(OfficialLifelogInventory.Request request)throws Exception;}}
final class OfficialLifelogInventory{static final class Request{String date,timezone,path;static Request day(String date,String zone){throw new UnsupportedOperationException("not a calendar dependency");}}}
final class NavReflect{static Class<?> type(String name){throw new UnsupportedOperationException("not a calendar dependency");}}
