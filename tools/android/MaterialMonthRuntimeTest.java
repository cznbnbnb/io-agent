package com.turboio.addon;

import android.app.*;import android.os.Handler;
import java.io.*;import java.lang.reflect.*;import java.time.*;import java.util.*;import java.util.concurrent.*;

/** Real Runtime, month discovery/parser and configuration; only Android,
 * encrypted settings and downstream IO/session interfaces are synthetic. */
public final class MaterialMonthRuntimeTest {
 static int checks;static File root;
 static final OfficialAccountBinding OWNER=account(71),OTHER=account(72);
 static OfficialAccountBinding account(long id){return OfficialAccountBinding.read(WireJson.bytes(WireJson.object("accountId",id,"domain","runtime-test.invalid")));}
 static void yes(boolean ok){checks++;if(!ok)throw new AssertionError("Runtime month check "+checks);}
 static MaterialConfig config(String token,boolean enabled,long expiry){return new MaterialConfig(MaterialConnection.parse(WireJson.bytes(WireJson.object("format","turboio-material-sync/1","base_url","https://synthetic.invalid/io-api/v1","owner_id","synthetic-owner","producer_id","phone-test","server_id","synthetic-server","token",token.repeat(43),"token_id","12345678-1234-4234-8234-123456789abc","expires_at",Instant.ofEpochMilli(expiry).toString())),0),OWNER.binding,enabled);}
 static byte[] calendar(){List<Object> rows=new ArrayList<>();for(int day=1;day<=31;day++)rows.add(WireJson.object("date",String.format(Locale.ROOT,"2026-10-%02d",day),"hasLog",day<=8));return WireJson.bytes(WireJson.object("code",0,"data",WireJson.object("dailyLifelogList",rows)));}
 static final class Month implements MaterialRuntime.MonthResult{MaterialRuntime.MonthSelection value;String error;int calls;public void done(MaterialRuntime.MonthSelection v,String e){value=v;error=e;calls++;}}
 static final class Done implements MaterialRuntime.Result{MaterialRuntime.Snapshot value;String error;int calls;public void done(MaterialRuntime.Snapshot v,String e){value=v;error=e;calls++;}}
 static final class Fixture implements AutoCloseable{
  final Application app=new Application(root);final Activity activity=new Activity(app);final MaterialRuntime runtime;final ExecutorService io,cancel;
  Fixture()throws Exception{
   Handler.clear();Host107Login.current=OWNER;MaterialSettings.value=config("a",true,System.currentTimeMillis()+600000);Host107LifelogHttp.reset();MaterialSyncSession.reset();MaterialHttp.created=0;OfficialLifelogDiscovery.reset();OfficialLifelogBatch.reads=0;OfficialHiveCache.reads=0;OfficialLifelogRefresh.refreshes=0;
   Constructor<MaterialRuntime> constructor=MaterialRuntime.class.getDeclaredConstructor(Activity.class);constructor.setAccessible(true);runtime=constructor.newInstance(activity);io=executor("io");cancel=executor("cancel");
  }
  ExecutorService executor(String name)throws Exception{Field f=MaterialRuntime.class.getDeclaredField(name);f.setAccessible(true);return (ExecutorService)f.get(runtime);}
  void idle()throws Exception{io.submit(()->{}).get(3,TimeUnit.SECONDS);}
  void deliver()throws Exception{Runnable action=Handler.next(3000);if(action==null)throw new AssertionError("Missing main callback");Host107Login.delivering=true;try{action.run();}finally{Host107Login.delivering=false;}}
  Month pending()throws Exception{Month result=new Month();runtime.discoverMonth("2026-10",result);idle();yes(result.calls==0);return result;}
  MaterialRuntime.MonthSelection selection()throws Exception{Month result=pending();deliver();yes(result.calls==1&&result.error.isEmpty()&&result.value!=null);return result.value;}
  Done sync(MaterialRuntime.MonthSelection selected,List<String> days)throws Exception{Done done=new Done();runtime.syncMonthDays(selected,days,done);idle();deliver();return done;}
  public void close()throws Exception{runtime.cancelPending();io.shutdownNow();cancel.shutdownNow();yes(io.awaitTermination(2,TimeUnit.SECONDS)&&cancel.awaitTermination(2,TimeUnit.SECONDS));Handler.clear();}
 }
 static List<String> first(int count){List<String> days=new ArrayList<>();for(int n=1;n<=count;n++)days.add(String.format(Locale.ROOT,"2026-10-%02d",n));return days;}
 static void denied(Done result,String code){yes(result.calls==1&&code.equals(result.error));yes(MaterialSyncSession.started==0&&OfficialLifelogDiscovery.calls==0);}
 public static void main(String[] args)throws Exception{
  root=new File(args[0]);
  // Login changes after IO must not cause blocking login IO on main. The shown
  // snapshot remains explicitly bound to its original account; using it for
  // synchronization must fail before a session can commit any data.
  try(Fixture f=new Fixture()){Month m=f.pending();Host107Login.current=OTHER;f.deliver();yes(m.value!=null&&m.error.isEmpty()&&m.value.source.account.equals(OWNER.binding));yes(Host107LifelogHttp.calendars==1&&Host107LifelogHttp.closed==1&&MaterialSyncSession.started==0);denied(f.sync(m.value,first(1)),"OFFICIAL_ACCOUNT_CHANGED");}
  try(Fixture f=new Fixture()){Month m=f.pending();f.runtime.cancelPending();f.deliver();yes(m.value==null&&"MATERIAL_PAUSED".equals(m.error));}
  try(Fixture f=new Fixture()){Month m=f.pending();f.app.callbacks.onActivityStopped(f.activity);f.deliver();yes(m.value==null&&"MATERIAL_PAUSED".equals(m.error));}
  try(Fixture f=new Fixture()){Month m=f.pending();Done configured=new Done();f.runtime.configure(config("b",true,System.currentTimeMillis()+600000).connection.encode(),true,configured);f.idle();f.deliver();f.deliver();yes(m.value==null&&"MATERIAL_PAUSED".equals(m.error)&&configured.error.isEmpty());}
  try(Fixture f=new Fixture()){Month first=f.pending();Month second=new Month();f.runtime.discoverMonth("2026-10",second);f.idle();f.deliver();f.deliver();yes(first.value==null&&"MATERIAL_PAUSED".equals(first.error));yes(second.value!=null&&second.error.isEmpty());}
  // The original selection cannot survive an intervening ownership generation.
  try(Fixture f=new Fixture()){MaterialRuntime.MonthSelection selected=f.selection();f.runtime.cancelPending();denied(f.sync(selected,first(1)),"MATERIAL_MONTH_SELECTION_STALE");}
  try(Fixture f=new Fixture()){MaterialRuntime.MonthSelection selected=f.selection();Done paused=new Done();f.runtime.pause(paused);f.idle();f.deliver();yes(paused.error.isEmpty()&&!MaterialSettings.value.enabled);denied(f.sync(selected,first(1)),"MATERIAL_PAUSED");}
  try(Fixture f=new Fixture()){MaterialRuntime.MonthSelection selected=f.selection();f.app.callbacks.onActivityStopped(f.activity);f.app.callbacks.onActivityStarted(f.activity);denied(f.sync(selected,first(1)),"MATERIAL_MONTH_SELECTION_STALE");}
  // A persisted credential change without a lifecycle event still changes the
  // real configuration fingerprint when the worker reloads encrypted settings.
  try(Fixture f=new Fixture()){MaterialRuntime.MonthSelection selected=f.selection();MaterialSettings.value=config("b",true,System.currentTimeMillis()+600000);denied(f.sync(selected,first(1)),"MATERIAL_MONTH_SELECTION_STALE");}
  try(Fixture f=new Fixture()){MaterialRuntime.MonthSelection selected=f.selection();Host107Login.current=OTHER;denied(f.sync(selected,first(1)),"OFFICIAL_ACCOUNT_CHANGED");}
  try(Fixture f=new Fixture()){MaterialRuntime.MonthSelection selected=f.selection();MaterialSettings.value=config("a",true,System.currentTimeMillis()-1000);denied(f.sync(selected,first(1)),"MATERIAL_IMPORT_EXPIRED");}
  // Selection limits come from the production month snapshot, before creating
  // a material session or interpreting any calendar absence as a deletion.
  for(List<String> invalid:Arrays.<List<String>>asList(null,Collections.emptyList(),first(8),Arrays.asList("2026-10-01","2026-10-01"),Arrays.asList("2026-10-09"),Arrays.asList("2026-09-01")))try(Fixture f=new Fixture()){
   MaterialRuntime.MonthSelection selected=f.selection();denied(f.sync(selected,invalid),"LIFELOG_DISCOVERY_DAYS_INVALID");yes(MaterialHttp.created==0);
  }
  try(Fixture f=new Fixture()){
   MaterialRuntime.MonthSelection selected=f.selection();CountDownLatch entered=new CountDownLatch(1),release=new CountDownLatch(1);f.io.execute(()->{entered.countDown();try{release.await();}catch(InterruptedException e){Thread.currentThread().interrupt();}});yes(entered.await(2,TimeUnit.SECONDS));
   List<String> days=first(7);Done done=new Done();f.runtime.syncMonthDays(selected,days,done);days.clear();release.countDown();f.idle();f.deliver();
   yes(done.error.isEmpty()&&MaterialSyncSession.started==1&&MaterialSyncSession.completed==1);yes(MaterialSyncSession.kind.equals("discovery")&&OfficialLifelogDiscovery.calls==1&&OfficialLifelogDiscovery.selected.size()==7);yes(Host107LifelogHttp.calendars==1&&OfficialLifelogBatch.reads==0&&OfficialHiveCache.reads==0&&OfficialLifelogRefresh.refreshes==0);
   for(int i=0;i<7;i++){OfficialLifelogInventory.Request day=OfficialLifelogDiscovery.selected.get(i);yes(day.date.equals(first(7).get(i))&&day.timezone.equals("Asia/Shanghai"));}
   Done repeat=f.sync(selected,first(1));yes("MATERIAL_MONTH_SELECTION_STALE".equals(repeat.error)&&MaterialSyncSession.completed==1);
  }
  // Cancelling while the selected source is in flight must be observed before
  // the downstream session's commit boundary. The fake source cannot authorize it.
  try(Fixture f=new Fixture()){
   MaterialRuntime.MonthSelection selected=f.selection();OfficialLifelogDiscovery.entered=new CountDownLatch(1);OfficialLifelogDiscovery.release=new CountDownLatch(1);Done done=new Done();f.runtime.syncMonthDays(selected,first(1),done);yes(OfficialLifelogDiscovery.entered.await(2,TimeUnit.SECONDS));f.runtime.cancelPending();OfficialLifelogDiscovery.release.countDown();f.idle();f.deliver();yes("MATERIAL_PAUSED".equals(done.error)&&MaterialSyncSession.completed==0);yes(Host107LifelogHttp.disabled>0);
  }
  // The two existing entry points retain their original source routing.
  try(Fixture f=new Fixture()){Done done=new Done();f.runtime.sync(done);f.idle();f.deliver();yes(done.error.isEmpty()&&MaterialSyncSession.kind.equals("fresh")&&MaterialSyncSession.completed==1);yes(Host107LifelogHttp.calendars==0&&OfficialLifelogBatch.reads==1&&OfficialLifelogRefresh.refreshes==1&&OfficialLifelogDiscovery.calls==0);}
  try(Fixture f=new Fixture()){Done done=new Done();f.runtime.syncDay("2026-10-10","Asia/Shanghai",done);f.idle();f.deliver();yes(done.error.isEmpty()&&MaterialSyncSession.kind.equals("discovery")&&MaterialSyncSession.completed==1);yes(Host107LifelogHttp.calendars==0&&OfficialLifelogDiscovery.selected.size()==1&&OfficialLifelogDiscovery.selected.get(0).date.equals("2026-10-10"));}
  System.out.println("Material month runtime: "+checks+" checks passed; real Runtime and month core, synthetic Android/IO boundaries");
 }
}

// Finite interface doubles. No copy of generation, fingerprint or day-selection
// admission logic: those decisions run only in the production classes above.
final class Host107Login{static volatile OfficialAccountBinding current;static boolean delivering;static OfficialAccountBinding account(){if(delivering)throw new AssertionError("Main callback must not perform login IO");return current;}}
final class MaterialSettings{static volatile MaterialConfig value;MaterialSettings(android.content.Context app){}MaterialConfig load(){return value;}void save(MaterialConfig v){value=v;}}
final class Host107LifelogHttp implements AutoCloseable{static int calendars,closed;static volatile int disabled;final MaterialSyncSession.Guard guard;Host107LifelogHttp(android.content.Context app,OfficialAccountBinding owner,MaterialSyncSession.Guard guard){this.guard=guard;}static void reset(){calendars=closed=disabled=0;}byte[] calendar(OfficialLifelogCalendarRequest request)throws Exception{guard.check();calendars++;return MaterialMonthRuntimeTest.calendar();}void disable(){disabled++;}void cancel(){disable();}public void close(){closed++;}}
final class MaterialHttp implements MaterialApi.Transport{static int created;MaterialHttp(MaterialConnection connection){created++;}void disable(){}public void cancel(){}public MaterialApi.Response exchange(String path,byte[] body){return new MaterialApi.Response();}}
final class MaterialApi{interface Transport{Response exchange(String path,byte[] body)throws IOException;void cancel();}static final class Response{}final Transport http;MaterialApi(MaterialConnection connection,Transport http){this.http=http;}void preflight(long now,boolean versions)throws IOException{http.exchange("/identity",null);}}
final class MaterialSyncSession{
 interface Guard{void check()throws IOException;}interface AccountSource{OfficialAccountBinding current()throws Exception;}interface DiscoverySource extends AccountSource{OfficialLifelogDiscovery.Snapshot discover()throws Exception;}interface FreshSource extends AccountSource{OfficialLifelogBatch read()throws Exception;OfficialLifelogRefresh.Fresh refresh(OfficialLifelogBatch observed)throws Exception;}
 static final class Status{int added,conflicts,unowned,invalid,discovered,days,recordings,otherEntries;String note="ready";}
 static int started,completed;static String kind;static void reset(){started=completed=0;kind="";}final AccountSource source;final Guard guard;
 MaterialSyncSession(File dir,MaterialConfig cfg,AccountSource source,Guard guard,MaterialHttp http){started++;this.source=source;this.guard=guard;}
 static Status status(File dir,MaterialConfig config){return new Status();}
 Status sync()throws Exception{guard.check();source.current();if(source instanceof DiscoverySource){kind="discovery";((DiscoverySource)source).discover();}else{kind="fresh";FreshSource fresh=(FreshSource)source;fresh.refresh(fresh.read());}guard.check();source.current();completed++;return new Status();}
}
final class OfficialLifelogDiscovery{interface Login{OfficialAccountBinding current()throws Exception;}static final class Snapshot{}static int calls;static List<OfficialLifelogInventory.Request> selected;static CountDownLatch entered,release;static void reset(){calls=0;selected=null;entered=release=null;}static Snapshot read(String owner,List<OfficialLifelogInventory.Request> days,Login login,Host107LifelogHttp http)throws Exception{calls++;selected=new ArrayList<>(days);if(entered!=null){entered.countDown();if(!release.await(2,TimeUnit.SECONDS))throw new IOException("TEST_RELEASE_MISSING");}login.current();return new Snapshot();}}
final class OfficialLifelogBatch{interface Login{OfficialAccountBinding current()throws Exception;}static int reads;static OfficialLifelogBatch read(File root,Login login)throws Exception{reads++;login.current();return new OfficialLifelogBatch();}}
final class OfficialLifelogRefresh{interface Ownership{OfficialAccountBinding current()throws Exception;Set<String> references()throws Exception;}static final class Fresh{}static int refreshes;static Fresh read(OfficialLifelogBatch batch,Ownership owner,Host107LifelogHttp http)throws Exception{refreshes++;owner.current();owner.references();return new Fresh();}}
final class OfficialHiveCache{static int reads;static Object read(File file){reads++;return new Object();}static Set<String> sourceReferences(Object data){return Collections.emptySet();}}
