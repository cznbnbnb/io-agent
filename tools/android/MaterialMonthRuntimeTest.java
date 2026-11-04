package com.turboio.addon;

import android.app.*;import android.os.Handler;
import java.io.*;import java.lang.reflect.*;import java.nio.file.*;import java.time.*;import java.util.*;import java.util.concurrent.*;

/** Real Runtime, persistent local library, catalog, day/month discovery and source
 * mapping. Only Android, settings and network/session boundaries are synthetic. */
public final class MaterialMonthRuntimeTest {
 static int checks;static File root;
 static final OfficialAccountBinding OWNER=account(71),OTHER=account(72);
 static OfficialAccountBinding account(long id){return OfficialAccountBinding.read(WireJson.bytes(WireJson.object("accountId",id,"domain","runtime-test.invalid")));}
 static void yes(boolean ok){checks++;if(!ok)throw new AssertionError("Runtime month check "+checks);}
 static MaterialConfig config(String token,boolean enabled,long expiry){return new MaterialConfig(MaterialConnection.parse(WireJson.bytes(WireJson.object("format","turboio-material-sync/1","base_url","https://synthetic.invalid/io-api/v1","owner_id","synthetic-owner","producer_id","phone-test","server_id","synthetic-server","token",token.repeat(43),"token_id","12345678-1234-4234-8234-123456789abc","expires_at",Instant.ofEpochMilli(expiry).toString())),0),OWNER.binding,enabled);}
 static byte[] calendar(){return calendar("2026-10",first(8));}
 static byte[] calendar(String value,List<String> logged){YearMonth month=YearMonth.parse(value);List<Object> rows=new ArrayList<>();for(int day=1;day<=month.lengthOfMonth();day++){String date=month.atDay(day).toString();rows.add(WireJson.object("date",date,"hasLog",logged.contains(date)));}return WireJson.bytes(WireJson.object("code",0,"data",WireJson.object("dailyLifelogList",rows)));}
 static OfficialLifelogMonthDiscovery.Snapshot index(String account,String month,List<String> dates)throws Exception{OfficialAccountBinding login=account.equals(OWNER.binding)?OWNER:OTHER;return OfficialLifelogMonthDiscovery.read(account,OfficialLifelogCalendarRequest.month(month),"Asia/Shanghai",()->login,()->{},request->calendar(month,dates));}
 static Future<?> history(Fixture f,long now)throws Exception{Field field=MaterialRuntime.class.getDeclaredField("generation");field.setAccessible(true);long generation=field.getLong(f.runtime);Method method=MaterialRuntime.class.getDeclaredMethod("historyRound",long.class,boolean.class,long.class);method.setAccessible(true);return f.io.submit(()->{try{method.invoke(f.runtime,generation,false,now);}catch(ReflectiveOperationException failed){throw new RuntimeException(failed);}});}

 static final class Month implements MaterialRuntime.MonthResult{MaterialRuntime.MonthSelection value;String error;int calls;public void done(MaterialRuntime.MonthSelection v,String e){value=v;error=e;calls++;}}
 static final class Done implements MaterialRuntime.Result{MaterialRuntime.Snapshot value;String error;int calls;public void done(MaterialRuntime.Snapshot v,String e){value=v;error=e;calls++;}}
 static final class Catalog implements MaterialRuntime.CatalogResult{MaterialRuntime.CatalogSnapshot value;String error;int calls;public void done(MaterialRuntime.CatalogSnapshot v,String e){value=v;error=e;calls++;}}
 static final class AudioDone implements MaterialRuntime.AudioResult{MaterialRuntime.AudioSnapshot value;String error;int calls;public void done(MaterialRuntime.AudioSnapshot v,String e){value=v;error=e;calls++;}}
 static final class Fixture implements AutoCloseable{
  final File files=Files.createTempDirectory(root.toPath(),"runtime-fixture-").toFile();final Application app=new Application(files);final Activity activity=new Activity(app);final MaterialRuntime runtime;final ExecutorService io,viewIO,cancel;
  Fixture()throws Exception{
   Handler.clear();TaskSettings.value=null;MaterialHttp.reply=null;MaterialHttp.after=null;AudioSettings.value=null;AudioHttp.created=AudioHttp.exchanges=AudioHttp.posts=0;AudioHttp.after=null;AudioHttp.entered=AudioHttp.release=null;Host107Login.current=OWNER;MaterialSettings.failure="";MaterialSettings.value=config("a",true,System.currentTimeMillis()+600000);Host107LifelogHttp.reset();MaterialSyncSession.reset();MaterialHttp.created=MaterialHttp.exchanges=0;Host107Login.reads=0;Host107Login.onRead=null;OfficialLifelogBatch.reads=0;OfficialHiveCache.reads=0;OfficialLifelogRefresh.refreshes=0;
   Constructor<MaterialRuntime> constructor=MaterialRuntime.class.getDeclaredConstructor(Activity.class);constructor.setAccessible(true);runtime=constructor.newInstance(activity);io=executor("io");viewIO=executor("viewIO");cancel=executor("cancel");
  }
  ExecutorService executor(String name)throws Exception{Field f=MaterialRuntime.class.getDeclaredField(name);f.setAccessible(true);return (ExecutorService)f.get(runtime);}
  void idle()throws Exception{io.submit(()->{}).get(3,TimeUnit.SECONDS);viewIO.submit(()->{}).get(3,TimeUnit.SECONDS);}
  void deliver()throws Exception{Runnable action=Handler.next(3000);if(action==null)throw new AssertionError("Missing main callback");Host107Login.delivering=true;try{action.run();}finally{Host107Login.delivering=false;}}
  void finish(Catalog result)throws Exception{for(int i=0;i<3&&result.calls==0;i++){idle();deliver();}yes(result.calls==1);}
  void finish(AudioDone result)throws Exception{for(int i=0;i<8&&result.calls==0;i++){idle();deliver();}yes(result.calls==1);}
  Catalog day(String date,String timezone)throws Exception{Catalog result=new Catalog();runtime.readDay(date,timezone,result);finish(result);return result;}
  Catalog catalog()throws Exception{Catalog result=new Catalog();runtime.catalog(result);finish(result);return result;}
  Month pending()throws Exception{Month result=new Month();runtime.discoverMonth("2026-10",result);idle();yes(result.calls==0);return result;}
  MaterialRuntime.MonthSelection selection()throws Exception{Month result=pending();deliver();yes(result.calls==1&&result.error.isEmpty()&&result.value!=null);return result.value;}
  Done sync(MaterialRuntime.MonthSelection selected,List<String> days)throws Exception{Done done=new Done();runtime.syncMonthDays(selected,days,done);idle();deliver();return done;}
  public void close()throws Exception{runtime.cancelPending();io.shutdownNow();viewIO.shutdownNow();cancel.shutdownNow();yes(io.awaitTermination(2,TimeUnit.SECONDS)&&viewIO.awaitTermination(2,TimeUnit.SECONDS)&&cancel.awaitTermination(2,TimeUnit.SECONDS));Handler.clear();}
 }
 static List<String> first(int count){List<String> days=new ArrayList<>();for(int n=1;n<=count;n++)days.add(String.format(Locale.ROOT,"2026-10-%02d",n));return days;}
 static void denied(Done result,String code){yes(result.calls==1&&code.equals(result.error));yes(MaterialSyncSession.started==0&&Host107LifelogHttp.discoveryCalls==0);}
 static void noUpload(){yes(MaterialHttp.created==0&&MaterialHttp.exchanges==0&&MaterialSyncSession.started==0&&MaterialSyncSession.completed==0);yes(OfficialLifelogBatch.reads==0&&OfficialHiveCache.reads==0&&OfficialLifelogRefresh.refreshes==0);}
 static MaterialLocalLibrary.Snapshot local(Fixture f,String binding)throws Exception{try(MaterialLocalLibrary library=new MaterialLocalLibrary(f.files,binding)){return library.snapshot();}}
 static byte[] localBytes(Fixture f,String binding)throws Exception{File file=new File(f.files,"material-accounts/"+binding+"/local-library/index-v2.json");return file.exists()?Files.readAllBytes(file.toPath()):new byte[0];}
 static void good(Catalog result){yes(result.calls==1&&result.error.isEmpty()&&result.value!=null);}
 static void rejected(Catalog result,String code){yes(result.calls==1&&result.value==null&&code.equals(result.error));}
 static TaskDevice phone(){long now=System.currentTimeMillis();return TaskDevice.decode(WireJson.bytes(WireJson.object("format",TaskDevice.FORMAT,"base_url","https://synthetic.invalid/io-api/v1","owner_id","synthetic-owner","producer_id","phone-12345678","server_id","synthetic-server","token","T".repeat(43),"token_id","12345678-1234-4234-8234-123456789abc","expires_at",TaskWire.now(now+86400000),"refresh_after",TaskWire.now(now+43200000),"device_id","12345678-1234-4234-8234-123456789abc","label","Synthetic phone","cursor","")));}
 static MaterialApi.Response recovered(MaterialConnection c,String path){if(!path.equals("/material-pairing/recover"))return new MaterialApi.Response();return new MaterialApi.Response(200,WireJson.bytes(WireJson.object("owner_id",c.owner,"producer_id",c.producer,"server_id",c.server,"pairing_id","synthetic-material-pair","account_binding",OWNER.binding,"token","C".repeat(43),"token_id","12345678-1234-4234-8234-123456789abd","expires_at",TaskWire.now(System.currentTimeMillis()+86400000))),0);}
 static void materialRecovery()throws Exception{
  try(Fixture f=new Fixture()){MaterialSettings.value=null;TaskSettings.value=phone();MaterialHttp.reply=MaterialMonthRuntimeTest::recovered;Done d=new Done();f.runtime.restore(d);f.idle();f.deliver();yes(d.calls==1&&d.error.isEmpty());yes(MaterialSettings.value.enabled&&MaterialSettings.value.connection.paired()&&MaterialSettings.value.connection.producer.equals(TaskSettings.value.producer));yes(MaterialHttp.exchanges==2);}
  try(Fixture f=new Fixture()){MaterialSettings.value=config("a",false,System.currentTimeMillis()+60000);TaskSettings.value=phone();Done d=new Done();f.runtime.restore(d);f.idle();f.deliver();yes(d.error.isEmpty()&&!MaterialSettings.value.enabled&&MaterialHttp.exchanges==0);}
  try(Fixture f=new Fixture()){MaterialSettings.value=null;TaskSettings.value=phone();MaterialHttp.reply=(c,path)->new MaterialApi.Response(503,new byte[0],0);Done failed=new Done();f.runtime.restore(failed);f.idle();f.deliver();yes(failed.error.equals("MATERIAL_RECOVERY_UNAVAILABLE")&&MaterialSettings.value==null);MaterialHttp.reply=MaterialMonthRuntimeTest::recovered;Done retry=new Done();f.runtime.restore(retry);f.idle();f.deliver();yes(retry.error.isEmpty()&&MaterialSettings.value.connection.paired());}
  try(Fixture f=new Fixture()){MaterialSettings.value=null;TaskSettings.value=phone();MaterialHttp.reply=MaterialMonthRuntimeTest::recovered;MaterialHttp.after=()->Host107Login.current=OTHER;Done d=new Done();f.runtime.restore(d);f.idle();f.deliver();yes(d.error.equals("OFFICIAL_ACCOUNT_CHANGED")&&MaterialSettings.value==null);}
  try(Fixture f=new Fixture()){MaterialSettings.value=null;TaskSettings.value=phone();MaterialHttp.reply=MaterialMonthRuntimeTest::recovered;MaterialHttp.after=()->TaskSettings.value=null;Done d=new Done();f.runtime.restore(d);f.idle();f.deliver();yes(d.error.equals("MATERIAL_CONNECTION_CHANGED")&&MaterialSettings.value==null);}
  try(Fixture f=new Fixture()){MaterialSettings.value=null;TaskSettings.value=phone();MaterialHttp.reply=MaterialMonthRuntimeTest::recovered;f.app.callbacks.onActivityStopped(f.activity);f.runtime.wakeAuto(false);f.idle();yes(MaterialSettings.value!=null&&MaterialSettings.value.enabled&&MaterialSettings.value.connection.paired());}
 }
 static void dayReads()throws Exception{
  TimeZone old=TimeZone.getDefault();TimeZone.setDefault(TimeZone.getTimeZone("Asia/Shanghai"));
  try{
   // Remote configuration has no authority over browsing the official account.
   for(int mode=0;mode<4;mode++)try(Fixture f=new Fixture()){
    if(mode==0)MaterialSettings.value=null;
    if(mode==1)MaterialSettings.value=config("a",false,System.currentTimeMillis()+600000);
    if(mode==2)MaterialSettings.value=config("a",true,System.currentTimeMillis()-1000);
    if(mode==3)Host107Login.current=OTHER; // Saved remote target belongs to OWNER.
    OfficialAccountBinding account=Host107Login.current;String fingerprint=MaterialSettings.value==null?null:MaterialSettings.value.fingerprint();
    Catalog result=f.day("2026-10-23","Asia/Shanghai");good(result);
    yes(result.value.catalog.account.equals(account.binding)&&result.value.catalog.entries.size()==1);
    yes(result.value.catalog.localOnly==1&&result.value.catalog.pending==0&&result.value.catalog.stored==0);
    yes(result.value.catalog.on(LocalDate.parse("2026-10-23")).size()==1); // Source starts at 23:59 on the 22nd.
    yes(result.value.catalog.entries.get(0).fullText.equals(Host107LifelogHttp.content));
    yes(result.value.local.day("2026-10-23","Asia/Shanghai").sourceCount==1);
    yes(Host107LifelogHttp.lists==2&&Host107LifelogHttp.fulls==1&&Host107LifelogHttp.closed==1&&Host107LifelogHttp.calendars==0);
    yes(!new File(f.files,"app_flutter").exists());yes(Objects.equals(fingerprint,MaterialSettings.value==null?null:MaterialSettings.value.fingerprint()));
    if(mode==3)yes(result.value.config==null&&local(f,OWNER.binding).records.isEmpty());
    noUpload();
   }
   // Upload-view failures do not change source admission or hide local text.
   // Exercise the real outbox's unresolved atomic write, preserving that file.
   try(Fixture f=new Fixture()){
    good(f.day("2026-10-23","Asia/Shanghai"));MaterialConfig saved=MaterialSettings.value;
    File partial=new File(MaterialSyncSession.accountFiles(f.files,saved),"material-outbox/"+saved.connection.binding()+"/state.json.partial");
    Files.createDirectories(partial.getParentFile().toPath());byte[] unfinished=WireJson.bytes(WireJson.object("synthetic","unfinished upload"));Files.write(partial.toPath(),unfinished);
    Host107LifelogHttp.grow=true;Catalog updated=f.day("2026-10-23","Asia/Shanghai");good(updated);
    yes(updated.value.uploadError.equals("MATERIAL_STORE_UNCERTAIN")&&updated.value.config==saved&&updated.value.catalog.entries.get(0).revision==2);
    yes(updated.value.catalog.entries.get(0).fullText.endsWith("新增长的第二段，不截断。")&&Arrays.equals(unfinished,Files.readAllBytes(partial.toPath())));
    Catalog cached=f.catalog();good(cached);yes(cached.value.uploadError.equals("MATERIAL_STORE_UNCERTAIN")&&cached.value.catalog.entries.size()==1);noUpload();
   }
   try(Fixture f=new Fixture()){
    MaterialSettings.failure="MATERIAL_CONFIG_INVALID";Catalog readable=f.day("2026-10-23","Asia/Shanghai");good(readable);
    yes(readable.value.config==null&&readable.value.uploadError.equals("MATERIAL_CONFIG_INVALID")&&readable.value.catalog.entries.size()==1);
    Catalog cached=f.catalog();good(cached);yes(cached.value.config==null&&cached.value.uploadError.equals("MATERIAL_CONFIG_INVALID"));noUpload();
   }
   // A fatal local/account problem must not be softened into an upload warning.
   try(Fixture f=new Fixture()){
    good(f.day("2026-10-23","Asia/Shanghai"));File state=new File(f.files,"material-accounts/"+OWNER.binding+"/local-library/index-v2.json");
    Map<String,Object> corrupt=WireJson.map(WireJson.read(Files.readAllBytes(state.toPath()),8388608,500000));corrupt.put("account",OTHER.binding);Files.write(state.toPath(),WireJson.bytes(corrupt));
    MaterialSettings.failure="MATERIAL_CONFIG_INVALID";Catalog fatal=f.catalog();rejected(fatal,"MATERIAL_LOCAL_BINDING");noUpload();
   }
   try(Fixture f=new Fixture()){
    MaterialSettings.failure="MATERIAL_CONFIG_INVALID";Host107Login.current=null;Catalog fatal=f.catalog();rejected(fatal,"OFFICIAL_LOGIN_REQUIRED");noUpload();
   }
   // Closing a stale page cancels only its owner, never a newer in-flight read.
   try(Fixture f=new Fixture()){
    Catalog first=new Catalog();long oldOwner=f.runtime.readDay("2026-10-23","Asia/Shanghai",first);f.finish(first);good(first);
    Host107LifelogHttp.grow=true;Host107LifelogHttp.entered=new CountDownLatch(1);Host107LifelogHttp.release=new CountDownLatch(1);
    Catalog newer=new Catalog();long nextOwner=f.runtime.readDay("2026-10-23","Asia/Shanghai",newer);yes(nextOwner!=oldOwner&&Host107LifelogHttp.entered.await(2,TimeUnit.SECONDS));
    f.runtime.cancelRead(oldOwner);Host107LifelogHttp.release.countDown();f.finish(newer);good(newer);yes(newer.value.catalog.entries.get(0).revision==2);noUpload();
   }
   try(Fixture f=new Fixture()){
    Host107LifelogHttp.entered=new CountDownLatch(1);Host107LifelogHttp.release=new CountDownLatch(1);
    Catalog pending=new Catalog();long owner=f.runtime.readDay("2026-10-23","Asia/Shanghai",pending);yes(Host107LifelogHttp.entered.await(2,TimeUnit.SECONDS));
    f.runtime.cancelRead(owner);Host107LifelogHttp.release.countDown();f.finish(pending);rejected(pending,"MATERIAL_PAUSED");yes(local(f,OWNER.binding).records.isEmpty());noUpload();
   }
   // Same source grows in place, survives a separate disk read, and never needs
   // a remote revision/receipt or a prior full-event log to become visible.
   try(Fixture f=new Fixture()){
    MaterialSettings.value=null;Catalog first=f.day("2026-10-23","Asia/Shanghai");good(first);String id=first.value.catalog.entries.get(0).id;
    Host107LifelogHttp.grow=true;Catalog grown=f.day("2026-10-23","Asia/Shanghai");good(grown);
    MaterialCatalog.Entry entry=grown.value.catalog.entries.get(0);yes(entry.id.equals(id)&&entry.revision==2&&entry.segments.size()==2&&entry.fullText.endsWith("新增长的第二段，不截断。"));
    yes(entry.endedAt>first.value.catalog.entries.get(0).endedAt&&entry.state.equals("local_only"));
    Catalog stable=f.day("2026-10-23","Asia/Shanghai");good(stable);yes(stable.value.catalog.entries.get(0).revision==2);
    Catalog disk=f.catalog();good(disk);yes(disk.value.catalog.entries.get(0).fullText.equals(entry.fullText)&&disk.value.local.records.get(0).revision==2);
    Host107LifelogHttp.sourceId="brand-new-source";Host107LifelogHttp.eventId="brand-new-event";Host107LifelogHttp.content="新日期中从未打开过的正文。";Host107LifelogHttp.grow=false;
    Catalog next=f.day("2026-10-24","Asia/Shanghai");good(next);yes(next.value.catalog.entries.size()==1&&next.value.local.day("2026-10-24","Asia/Shanghai").sourceCount==1&&local(f,OWNER.binding).records.size()==2);
    noUpload();
   }
   // A failed refresh preserves the exact previously committed local document.
   for(String failure:Arrays.asList("list","full","membership"))try(Fixture f=new Fixture()){
    good(f.day("2026-10-23","Asia/Shanghai"));byte[] before=localBytes(f,OWNER.binding);
    Host107LifelogHttp.reset();Host107LifelogHttp.grow=true;if(failure.equals("membership"))Host107LifelogHttp.changeMembership=true;else Host107LifelogHttp.fail=failure;
    Catalog failed=f.day("2026-10-23","Asia/Shanghai");yes(failed.value!=null&&failed.value.catalog.entries.size()==1&&!failed.error.isEmpty());
    yes(failed.value.catalog.entries.get(0).revision==1&&Arrays.equals(before,localBytes(f,OWNER.binding)));
    String expected=failure.equals("list")?"SYNTHETIC_LIST_UNAVAILABLE":failure.equals("full")?"SYNTHETIC_FULL_UNAVAILABLE":"LIFELOG_INVENTORY_CHANGED";yes(expected.equals(failed.error));noUpload();
   }
   try(Fixture f=new Fixture()){
    good(f.day("2026-10-23","Asia/Shanghai"));Host107LifelogHttp.empty=true;
    Catalog empty=f.day("2026-10-24","Asia/Shanghai");good(empty);yes(empty.value.local.day("2026-10-24","Asia/Shanghai").sourceCount==0&&empty.value.catalog.entries.isEmpty()&&local(f,OWNER.binding).records.size()==1);noUpload();
   }
   // Account changes during network completion cannot persist either account's
   // data. Switching after IO but before UI delivery cannot reveal old text.
   try(Fixture f=new Fixture()){
    Host107LifelogHttp.afterFull=()->Host107Login.current=OTHER;Catalog changed=f.day("2026-10-23","Asia/Shanghai");rejected(changed,"OFFICIAL_ACCOUNT_CHANGED");
    yes(local(f,OWNER.binding).records.isEmpty()&&local(f,OTHER.binding).records.isEmpty());noUpload();
   }
   try(Fixture f=new Fixture()){
    Catalog pending=new Catalog();f.runtime.readDay("2026-10-23","Asia/Shanghai",pending);f.idle();yes(pending.calls==0);Host107Login.current=OTHER;f.finish(pending);rejected(pending,"OFFICIAL_ACCOUNT_CHANGED");
    yes(local(f,OWNER.binding).records.size()==1&&local(f,OTHER.binding).records.isEmpty());Catalog now=f.catalog();good(now);yes(now.value.catalog.entries.isEmpty()&&now.value.catalog.account.equals(OTHER.binding));noUpload();
   }
   // Interrupt at the final list/full boundary, after a prior good snapshot:
   // no new local revision, no fallback text callback and no remote IO.
   for(boolean background:Arrays.asList(false,true))try(Fixture f=new Fixture()){
    good(f.day("2026-10-23","Asia/Shanghai"));byte[] before=localBytes(f,OWNER.binding);Host107LifelogHttp.grow=true;
    Host107LifelogHttp.afterFull=()->{if(background)f.app.callbacks.onActivityStopped(f.activity);else f.runtime.cancelPending();};
    Catalog cancelled=f.day("2026-10-23","Asia/Shanghai");rejected(cancelled,"MATERIAL_PAUSED");yes(Arrays.equals(before,localBytes(f,OWNER.binding)));noUpload();
   }
   try(Fixture f=new Fixture()){
    Catalog pending=new Catalog();f.runtime.readDay("2026-10-23","Asia/Shanghai",pending);f.idle();f.deliver();f.idle();yes(pending.calls==0);f.runtime.cancelPending();f.deliver();rejected(pending,"MATERIAL_PAUSED");noUpload();
   }
   try(Fixture f=new Fixture()){
    Host107Login.current=null;Catalog absent=f.day("2026-10-23","Asia/Shanghai");rejected(absent,"OFFICIAL_LOGIN_REQUIRED");yes(Host107LifelogHttp.lists==0&&Host107LifelogHttp.fulls==0);noUpload();
   }
   try(Fixture f=new Fixture()){
    Catalog invalid=f.day("2026-02-30","Asia/Shanghai");rejected(invalid,"LIFELOG_DATE_INVALID");yes(Host107LifelogHttp.lists==0);noUpload();
   }
   // The selected zone is retained in the official query and local day index.
   TimeZone.setDefault(TimeZone.getTimeZone("America/Los_Angeles"));
   try(Fixture f=new Fixture()){
    MaterialSettings.value=null;Catalog western=f.day("2026-10-23","America/Los_Angeles");good(western);
    yes(Host107LifelogHttp.selected.get(0).timezone.equals("America/Los_Angeles"));yes(western.value.local.day("2026-10-23","America/Los_Angeles")!=null);
    yes(western.value.catalog.on(LocalDate.parse("2026-10-23")).size()==1&&western.value.catalog.zone.equals(ZoneId.of("America/Los_Angeles")));noUpload();
   }
  }finally{TimeZone.setDefault(old);}
 }
 static void autoSync()throws Exception{
  for(int mode=0;mode<4;mode++)try(Fixture f=new Fixture()){
   if(mode==0)MaterialSettings.value=null;if(mode==1)MaterialSettings.value=config("a",false,System.currentTimeMillis()+600000);if(mode==2)MaterialSettings.value=config("a",true,System.currentTimeMillis()-1);if(mode==3)Host107Login.current=OTHER;
   f.runtime.wakeAuto(false);f.idle();noUpload();
  }
  for(boolean background:Arrays.asList(false,true))try(Fixture f=new Fixture()){
   if(background)f.app.callbacks.onActivityStopped(f.activity);else Host107LifelogHttp.afterFull=()->f.app.callbacks.onActivityStopped(f.activity);
   f.runtime.wakeAuto(false);f.runtime.wakeAuto(false);f.idle();yes(MaterialSyncSession.started==1&&MaterialSyncSession.completed==1);yes(Host107LifelogHttp.selected.size()==2);
   f.runtime.wakeAuto(true);f.idle();yes(MaterialSyncSession.started==1); // Network callbacks cannot spin within 30 seconds.
   Catalog hidden=f.catalog();rejected(hidden,"MATERIAL_PAUSED"); // Background upload does not authorize UI content.
  }
  try(Fixture f=new Fixture()){
   Host107LifelogHttp.afterFull=()->Host107Login.current=OTHER;f.runtime.wakeAuto(false);f.idle();yes(MaterialSyncSession.completed==0);
  }
  try(Fixture f=new Fixture()){
   Host107LifelogHttp.entered=new CountDownLatch(1);Host107LifelogHttp.release=new CountDownLatch(1);f.runtime.wakeAuto(false);yes(Host107LifelogHttp.entered.await(2,TimeUnit.SECONDS));
   Done stopped=new Done();f.runtime.pause(stopped);Host107LifelogHttp.release.countDown();f.idle();f.deliver();yes(stopped.calls==1&&stopped.error.isEmpty()&&!MaterialSettings.value.enabled&&MaterialSyncSession.completed==0);yes(Host107LifelogHttp.disabled>0);
  }
  // The actual headless constructor does not fabricate a foreground Activity.
  try(Fixture f=new Fixture()){
   Constructor<MaterialRuntime> ctor=MaterialRuntime.class.getDeclaredConstructor(android.content.Context.class,Activity.class);ctor.setAccessible(true);MaterialRuntime headless=ctor.newInstance(f.app,null);
   Field field=MaterialRuntime.class.getDeclaredField("io");field.setAccessible(true);ExecutorService io=(ExecutorService)field.get(headless);Field cancel=MaterialRuntime.class.getDeclaredField("cancel");cancel.setAccessible(true);
   try{headless.wakeAuto(false);io.submit(()->{}).get(3,TimeUnit.SECONDS);yes(MaterialSyncSession.started==1&&MaterialSyncSession.completed==1);}finally{io.shutdownNow();((ExecutorService)cancel.get(headless)).shutdownNow();}
  }
 }
 static void foregroundCatalogPriority()throws Exception{
  // A previously queued automatic round must yield to a foreground read before
  // taking a new generation, even if it entered the serial queue first.
  try(Fixture f=new Fixture()){
   CountDownLatch entered=new CountDownLatch(1),release=new CountDownLatch(1);
   f.io.execute(()->{entered.countDown();try{release.await();}catch(InterruptedException e){Thread.currentThread().interrupt();}});
   yes(entered.await(2,TimeUnit.SECONDS));f.runtime.wakeAuto(false);Catalog result=new Catalog();f.runtime.catalog(result);release.countDown();f.finish(result);good(result);noUpload();
   f.runtime.wakeAuto(false);f.idle();yes(MaterialSyncSession.completed==1);
  }
  // The account revalidation and final UI delivery still own the read; finishing
  // disk work alone must not let an automatic tick invalidate the result.
  try(Fixture f=new Fixture()){
   Catalog first=new Catalog(),second=new Catalog();f.runtime.catalog(first);f.runtime.catalog(second);f.idle();f.runtime.wakeAuto(false);f.idle();noUpload();
   for(int n=0;n<8&&(first.calls==0||second.calls==0);n++){f.idle();f.deliver();}
   good(first);good(second);f.runtime.wakeAuto(false);f.idle();yes(MaterialSyncSession.completed==1);
  }
  // A long official day read is also protected past the ordinary 5s debounce.
  try(Fixture f=new Fixture()){
   Host107LifelogHttp.afterFull=()->{try{Field field=MaterialRuntime.class.getDeclaredField("lastUiAt");field.setAccessible(true);field.setLong(f.runtime,0);f.runtime.wakeAuto(false);}catch(Exception e){throw new RuntimeException(e);}};
   Catalog result=f.day("2026-10-23","Asia/Shanghai");good(result);noUpload();
  }
  // A text round already in flight cannot take a second generation for audio
  // after the catalog has joined the queue behind it.
  try(Fixture f=new Fixture()){
   AudioSettings.value=audioConfig(MaterialSettings.value,true,System.currentTimeMillis()+600000);
   Host107LifelogHttp.entered=new CountDownLatch(1);Host107LifelogHttp.release=new CountDownLatch(1);
   f.runtime.wakeAuto(false);yes(Host107LifelogHttp.entered.await(2,TimeUnit.SECONDS));
   Catalog result=new Catalog();f.runtime.catalog(result);Host107LifelogHttp.release.countDown();f.finish(result);good(result);yes(MaterialSyncSession.completed==0&&AudioHttp.created==0&&Host107LifelogHttp.disabled>0);
   Field debounce=MaterialRuntime.class.getDeclaredField("lastUiAt");debounce.setAccessible(true);debounce.setLong(f.runtime,0); // Next ordinary tick, beyond the 5s UI debounce.
   f.runtime.wakeAuto(false);f.idle();yes(AudioHttp.exchanges>0);
  }
  // Real cancellation continues to reject content and releases the priority.
  try(Fixture f=new Fixture()){
   Catalog result=new Catalog();f.runtime.catalog(result);f.idle();f.runtime.cancelPending();f.deliver();rejected(result,"MATERIAL_PAUSED");
   Field field=MaterialRuntime.class.getDeclaredField("lastUiAt");field.setAccessible(true);field.setLong(f.runtime,0);f.runtime.wakeAuto(false);f.idle();yes(MaterialSyncSession.completed==1);
  }
 }
 static void readingLatency()throws Exception{
  // A selected entry is already immutable and validated. Reading it and
  // reopening the recent list must complete while the HTTP/disk lane is held.
  try(Fixture f=new Fixture()){
   MaterialSettings.value=null;Catalog loaded=f.day("2026-10-23","Asia/Shanghai");good(loaded);
   CountDownLatch entered=new CountDownLatch(1),release=new CountDownLatch(1);Field guardField=MaterialRuntime.class.getDeclaredField("guard");guardField.setAccessible(true);Object guard=guardField.get(f.runtime);
   f.io.execute(()->{synchronized(guard){entered.countDown();try{release.await();}catch(InterruptedException e){Thread.currentThread().interrupt();}}});yes(entered.await(2,TimeUnit.SECONDS));
   try{
    Catalog detail=new Catalog(),list=new Catalog();int originalReads=Host107LifelogHttp.discoveryCalls;
    CompletableFuture.runAsync(()->{f.runtime.verifyCatalog(loaded.value,detail);f.runtime.browse(list);}).get(1,TimeUnit.SECONDS);
    for(int n=0;n<8&&(detail.calls==0||list.calls==0);n++){f.viewIO.submit(()->{}).get(2,TimeUnit.SECONDS);f.deliver();}
    good(detail);good(list);yes(detail.value==loaded.value&&list.value==loaded.value&&Host107LifelogHttp.discoveryCalls==originalReads&&release.getCount()==1);
    // Still enforce account revalidation after the first UI boundary.
    Catalog changed=new Catalog();f.runtime.verifyCatalog(loaded.value,changed);f.viewIO.submit(()->{}).get(2,TimeUnit.SECONDS);Host107Login.current=OTHER;
    for(int n=0;n<3&&changed.calls==0;n++){f.deliver();f.viewIO.submit(()->{}).get(2,TimeUnit.SECONDS);}rejected(changed,"OFFICIAL_ACCOUNT_CHANGED");
    release.countDown();f.io.submit(()->{}).get(2,TimeUnit.SECONDS);Host107Login.current=OWNER;Catalog hidden=new Catalog();f.runtime.verifyCatalog(loaded.value,hidden);f.viewIO.submit(()->{}).get(2,TimeUnit.SECONDS);f.app.callbacks.onActivityStopped(f.activity);f.deliver();rejected(hidden,"MATERIAL_PAUSED");
   }finally{release.countDown();}
  }
  // Opening during the startup prewarm joins that one read instead of queuing
  // another complete account/library load behind it.
  try(Fixture f=new Fixture()){
   Method prewarm=MaterialRuntime.class.getDeclaredMethod("prewarm");prewarm.setAccessible(true);prewarm.invoke(f.runtime);
   Catalog first=new Catalog(),second=new Catalog();f.runtime.browse(first);f.runtime.browse(second);f.finish(first);f.finish(second);good(first);good(second);yes(first.value==second.value&&Host107Login.reads==3);
  }
  // A stale list must load from disk; a cache is not permission to serve old
  // content indefinitely or reuse the previous account after a login switch.
  try(Fixture f=new Fixture()){
   MaterialSettings.value=null;Catalog loaded=f.day("2026-10-23","Asia/Shanghai");good(loaded);
   Field age=MaterialRuntime.class.getDeclaredField("recentCatalogAt");age.setAccessible(true);age.setLong(f.runtime,android.os.SystemClock.elapsedRealtime()-60001);
   Catalog fresh=new Catalog();f.runtime.browse(fresh);f.finish(fresh);good(fresh);yes(fresh.value!=loaded.value);
   Host107Login.current=OTHER;Catalog denied=new Catalog();f.runtime.browse(denied);f.finish(denied);rejected(denied,"OFFICIAL_ACCOUNT_CHANGED");
   Catalog next=new Catalog();f.runtime.browse(next);f.finish(next);good(next);yes(next.value.catalog.account.equals(OTHER.binding)&&next.value.catalog.entries.isEmpty());
  }
 }
 static void autoSchedule()throws Exception{
  try(Fixture f=new Fixture()){
   MaterialConfig config=MaterialSettings.value;long start=Instant.parse("2026-10-24T01:00:00Z").toEpochMilli();
   try(MaterialAutoSchedule schedule=new MaterialAutoSchedule(f.files,config)){
    MaterialAutoSchedule.Plan p=schedule.begin(start,"Asia/Shanghai",false);yes(p.days.get(0).date.equals("2026-10-24")&&p.days.get(1).date.equals("2026-10-23"));schedule.finish(p,start+1000,true);
    yes(schedule.begin(start+30000,"Asia/Shanghai",false)==null);yes(schedule.begin(start+30000,"Asia/Shanghai",true)==null);
   }
   // Offline for three days: always include today, then advance one missed day per successful round.
   long later=start+3*86400000L;
   try(MaterialAutoSchedule schedule=new MaterialAutoSchedule(f.files,config)){
    MaterialAutoSchedule.Plan p=schedule.begin(later,"Asia/Shanghai",false);yes(p.days.get(0).date.equals("2026-10-27")&&p.days.get(1).date.equals("2026-10-24"));schedule.finish(p,later,false);
    yes(schedule.begin(later+29999,"Asia/Shanghai",true)==null);p=schedule.begin(later+30000,"Asia/Shanghai",true);yes(p.days.get(1).date.equals("2026-10-24"));schedule.finish(p,later+30000,true);
   }
   try(MaterialAutoSchedule schedule=new MaterialAutoSchedule(f.files,config)){
    MaterialAutoSchedule.Plan p=schedule.begin(later+90001,"Asia/Shanghai",false);yes(p.days.get(1).date.equals("2026-10-25"));schedule.finish(p,later+90001,true);
    p=schedule.begin(later+150002,"America/Los_Angeles",false);yes(p.days.get(0).date.equals("2026-10-26")&&p.days.get(1).date.equals("2026-10-25"));schedule.finish(p,later+150002,true);
    yes(schedule.begin(start,"Asia/Shanghai",false)!=null); // Clock rollback cannot freeze synchronization.
   }
   // A killed round has a durable cooldown, but no falsely advanced catch-up date.
   try(MaterialAutoSchedule schedule=new MaterialAutoSchedule(f.files,config)){yes(schedule.begin(start+1000,"Asia/Shanghai",false)==null);MaterialAutoSchedule.Plan p=schedule.begin(start+60001,"Asia/Shanghai",false);yes(p!=null);}
   long retry=start+120002;
   try(MaterialAutoSchedule schedule=new MaterialAutoSchedule(f.files,config)){
    MaterialAutoSchedule.Plan p=schedule.begin(retry,"Asia/Shanghai",false);yes(p!=null);schedule.finish(p,retry,false);
    p=schedule.begin(retry+60001,"Asia/Shanghai",false);yes(p!=null);schedule.finish(p,retry+60001,false);yes(schedule.begin(retry+120002,"Asia/Shanghai",false)==null);
    p=schedule.begin(retry+180002,"Asia/Shanghai",false);String pendingDay=p.days.get(1).date;schedule.finish(p,retry+180002,false,true);
    yes(schedule.begin(retry+210003,"Asia/Shanghai",true)==null);
   }
   // Process restart keeps the healthy minute interval without advancing a
   // partially uploaded day. A following real failure starts at one minute.
   try(MaterialAutoSchedule schedule=new MaterialAutoSchedule(f.files,config)){
    MaterialAutoSchedule.Plan p=schedule.begin(retry+240003,"Asia/Shanghai",false);yes(p!=null&&p.days.get(1).date.equals("2026-10-23"));schedule.finish(p,retry+240003,false);
    yes(schedule.begin(retry+300004,"Asia/Shanghai",false)!=null);
   }
  }
 }
 static void historySchedule()throws Exception{
  long now=Instant.parse("2026-10-29T02:00:00Z").toEpochMilli();
  try(Fixture f=new Fixture()){
   long at=now;MaterialHistorySchedule.Plan pending;
   try(MaterialHistorySchedule schedule=new MaterialHistorySchedule(f.files,OWNER.binding)){
    pending=schedule.begin(at,false);yes(pending.calendar()&&pending.month.equals("2026-10"));yes(schedule.status().months==12&&schedule.status().indexed==0);
    schedule.indexed(pending,index(OWNER.binding,"2026-10",Arrays.asList("2026-10-25","2026-10-28")),at+1);yes(schedule.status().days==2&&schedule.status().loaded==0);yes(schedule.begin(at+15000,true)==null);
   }
   try(MaterialHistorySchedule schedule=new MaterialHistorySchedule(f.files,OWNER.binding)){
    for(int i=1;i<12;i++){at+=31000;pending=schedule.begin(at,false);yes(pending!=null&&pending.calendar());schedule.indexed(pending,index(OWNER.binding,pending.month,Collections.emptyList()),at+1);}
    yes(schedule.status().indexed==12&&schedule.status().days==2);at+=31000;pending=schedule.begin(at,false);yes(pending.date.equals("2026-10-28"));schedule.failed(pending,at+1,"SYNTHETIC_LIST_UNAVAILABLE");
    yes(schedule.begin(at+29999,true)==null);at+=31000;pending=schedule.begin(at,true);yes(pending.date.equals("2026-10-28"));schedule.loaded(pending,at+1);yes(schedule.status().loaded==1);
    at+=31000;pending=schedule.begin(at,false);yes(pending.date.equals("2026-10-25")); // Killed before completion.
   }
   try(MaterialHistorySchedule schedule=new MaterialHistorySchedule(f.files,OWNER.binding)){
    yes(schedule.begin(at+1000,false)==null);at+=31000;pending=schedule.begin(at,false);yes(pending.date.equals("2026-10-25"));schedule.failed(pending,at+1,"MATERIAL_LOCAL_BUDGET");yes(schedule.status().capacity&&schedule.status().message.contains("正文"));
   }
   try(MaterialHistorySchedule schedule=new MaterialHistorySchedule(f.files,OWNER.binding)){
    yes(schedule.status().loaded==1&&schedule.status().indexed==12&&schedule.status().capacity);yes(schedule.begin(at+31000,false)==null);
    schedule.include(YearMonth.of(2020,1),at+31000);MaterialHistorySchedule.Plan older=schedule.begin(at+31000,false);yes(older!=null&&older.calendar()&&older.month.equals("2020-01")); // Full text capacity does not block index discovery.
   }
   try(MaterialHistorySchedule schedule=new MaterialHistorySchedule(f.files,OTHER.binding)){yes(schedule.status().months==0&&schedule.status().loaded==0&&!schedule.status().capacity);yes(schedule.begin(now,false)!=null);}
  }
  try(Fixture f=new Fixture();MaterialHistorySchedule schedule=new MaterialHistorySchedule(f.files,OWNER.binding)){
   long at=now;for(int i=0;i<12;i++){MaterialHistorySchedule.Plan p=schedule.begin(at,false);yes(p!=null&&p.calendar());schedule.indexed(p,index(OWNER.binding,p.month,Collections.emptyList()),at+1);at+=31000;}
   yes(schedule.begin(at,false)==null&&schedule.status().indexed==12&&schedule.status().loaded==schedule.status().days);
   schedule.include(YearMonth.of(2020,1),at);schedule.include(YearMonth.of(2027,1),at);yes(schedule.status().months==13);
   MaterialHistorySchedule.Plan older=schedule.begin(at,false);yes(older!=null&&older.month.equals("2020-01"));schedule.failed(older,at+1,"SYNTHETIC_CALENDAR_UNAVAILABLE");
   yes(schedule.begin(at+31000,false)==null);MaterialHistorySchedule.Plan retry=schedule.begin(at+900001,false);yes(retry!=null&&retry.month.equals("2020-01"));schedule.failed(retry,at+900002,"SYNTHETIC_CALENDAR_UNAVAILABLE");yes(schedule.begin(at+930002,false)==null);yes(schedule.begin(at+930002,true)==null);
  }
 }
 static void partialHistory()throws Exception{
  long now=Instant.parse("2026-10-29T02:00:00Z").toEpochMilli(),at=now;
  try(Fixture f=new Fixture()){
   try(MaterialHistorySchedule schedule=new MaterialHistorySchedule(f.files,OWNER.binding)){
    MaterialHistorySchedule.Plan p=schedule.begin(at,false);schedule.indexed(p,index(OWNER.binding,p.month,Arrays.asList("2026-10-25","2026-10-28")),at+1);
    for(int i=0;i<11;i++){at+=31000;p=schedule.begin(at,false);yes(p!=null&&p.calendar()&&!p.month.equals("2026-10"));schedule.failed(p,at+1,"LIFELOG_CALENDAR_COVERAGE_INCOMPLETE");}
    yes(schedule.status().indexed==1&&schedule.status().unverified==11&&schedule.status().days==2&&schedule.status().loaded==0);
    yes(schedule.status().message.contains("日历标记待核实")&&!schedule.status().message.contains("联网"));
   }
   // Per-month cooldown survives a restart; known dates do not wait for it.
   try(MaterialHistorySchedule schedule=new MaterialHistorySchedule(f.files,OWNER.binding)){
    at+=31000;MaterialHistorySchedule.Plan day=schedule.begin(at,false);yes(day!=null&&day.date.equals("2026-10-28"));schedule.loaded(day,at+1);
    at+=31000;day=schedule.begin(at,false);yes(day!=null&&day.date.equals("2026-10-25"));schedule.loaded(day,at+1);yes(schedule.status().loaded==2&&schedule.status().indexed==1);
    yes(schedule.begin(at+31000,true)==null);MaterialHistorySchedule.Plan retry=schedule.begin(now+1000000,false);yes(retry!=null&&retry.calendar()&&retry.month.equals("2026-09"));
    schedule.indexed(retry,index(OWNER.binding,retry.month,Collections.emptyList()),now+1000001);yes(schedule.status().indexed==2&&schedule.status().unverified==10&&schedule.status().loaded==2);
    schedule.include(YearMonth.of(2020,1),now+1000001);MaterialHistorySchedule.Plan capacity=schedule.begin(now+1031002,false);schedule.failed(capacity,now+1031003,"MATERIAL_LOCAL_BUDGET");yes(!schedule.status().capacity);
    MaterialHistorySchedule.Plan unrelated=schedule.begin(now+1062004,false);yes(unrelated!=null&&unrelated.calendar());schedule.failed(unrelated,now+1062005,"LIFELOG_CALENDAR_COVERAGE_INCOMPLETE");yes(!schedule.status().capacity);
   }
  }
  // Upgrade the exact dev155 failure shape: October's verified dates remain,
  // September alone receives the old cooldown, and other months can continue.
  try(Fixture f=new Fixture()){
   File file=new File(f.files,"material-accounts/"+OWNER.binding+"/history-load/state.json");List<Object> rows=new ArrayList<>();
   for(int i=0;i<12;i++){String month=YearMonth.of(2026,10).minusMonths(i).toString();rows.add(WireJson.object("month",month,"checked",i==0?now-60000:0,"dates",i==0?Arrays.asList("2026-10-25","2026-10-28"):Collections.emptyList(),"loaded",i==0?Arrays.asList("2026-10-25"):Collections.emptyList()));}
   try(AtomicDocument journal=new AtomicDocument(file,524288)){journal.save(WireJson.object("schema",1,"account",OWNER.binding,"attempt",now,"next",now+480000,"failures",5,"capacity",false,"error","LIFELOG_CALENDAR_COVERAGE_INCOMPLETE","months",rows));}
   try(MaterialHistorySchedule schedule=new MaterialHistorySchedule(f.files,OWNER.binding)){
    yes(schedule.status().indexed==1&&schedule.status().loaded==1&&schedule.status().unverified==11);MaterialHistorySchedule.Plan next=schedule.begin(now+31000,false);yes(next!=null&&next.calendar()&&next.month.equals("2026-08"));
   }
   try(AtomicDocument journal=new AtomicDocument(file,524288)){Map<String,Object> saved=WireJson.map(journal.read());yes(Long.valueOf(3).equals(saved.get("schema")));List<Object> persisted=WireJson.list(saved.get("months"));Map<String,Object> september=null;for(Object row:persisted){Map<String,Object> month=WireJson.map(row);if(month.get("month").equals("2026-09"))september=month;}yes(september!=null&&Long.valueOf(now+900000).equals(september.get("retry_after"))&&"LIFELOG_CALENDAR_COVERAGE_INCOMPLETE".equals(september.get("error")));}
   try(MaterialHistorySchedule schedule=new MaterialHistorySchedule(f.files,OWNER.binding)){yes(schedule.status().loaded==1&&schedule.status().indexed==1&&schedule.status().unverified==11);}
  }
 }
 static void calendarReplacement()throws Exception{
  long now=Instant.parse("2026-11-04T02:00:00Z").toEpochMilli();
  try(Fixture f=new Fixture();MaterialHistorySchedule schedule=new MaterialHistorySchedule(f.files,OWNER.binding)){
   MaterialHistorySchedule.Plan p=schedule.begin(now,false);schedule.indexed(p,index(OWNER.binding,p.month,Arrays.asList("2026-11-01")),now+1);
   schedule.include(YearMonth.of(2026,10),now+31000);p=schedule.begin(now+31000,false);yes(p.calendar()&&p.month.equals("2026-10"));
   schedule.indexed(p,index(OWNER.binding,p.month,Arrays.asList("2026-10-28","2026-10-30")),now+31001);
   long later=now+21631002;schedule.include(YearMonth.of(2026,10),later);p=schedule.begin(later,false);yes(p!=null&&p.calendar()&&p.month.equals("2026-10"));
   schedule.indexed(p,index(OWNER.binding,p.month,Arrays.asList("2026-10-28")),later+1);
   yes(!schedule.status().dates.contains(LocalDate.of(2026,10,30))&&schedule.status().dates.contains(LocalDate.of(2026,10,28)));
  }
 }
 static void recentHistoryWindow()throws Exception{
  calendarReplacement();
  long now=Instant.parse("2026-10-29T02:00:00Z").toEpochMilli();
  try(Fixture f=new Fixture();MaterialHistorySchedule schedule=new MaterialHistorySchedule(f.files,OWNER.binding)){
   long at=now;for(int i=0;i<12;i++){MaterialHistorySchedule.Plan p=schedule.begin(at,false);yes(p.calendar());List<String> days=p.month.equals("2026-10")?Arrays.asList("2026-10-25"):p.month.equals("2026-09")?Arrays.asList("2026-09-10","2026-09-20","2026-09-30"):Collections.emptyList();schedule.indexed(p,index(OWNER.binding,p.month,days),at+1);at+=31000;}
   List<String> loaded=new ArrayList<>();for(int i=0;i<3;i++){MaterialHistorySchedule.Plan p=schedule.begin(at,false);yes(p!=null&&!p.calendar());loaded.add(p.date);schedule.loaded(p,at+1);at+=31000;}
   yes(loaded.equals(Arrays.asList("2026-10-25","2026-09-30","2026-09-20")));yes(schedule.begin(at,false)==null&&schedule.status().days==3&&schedule.status().loaded==3);
   yes(schedule.status().dates.contains(LocalDate.of(2026,9,10))); // A dot without a background body read.
   schedule.include(YearMonth.of(2020,1),at);MaterialHistorySchedule.Plan old=schedule.begin(at,false);yes(old.calendar());schedule.indexed(old,index(OWNER.binding,old.month,Arrays.asList("2020-01-01")),at+1);yes(schedule.begin(at+31000,false)==null&&schedule.status().dates.contains(LocalDate.of(2020,1,1)));
  }
  // A known date whose authoritative day read is empty does not occupy a slot.
  try(Fixture f=new Fixture();MaterialHistorySchedule schedule=new MaterialHistorySchedule(f.files,OWNER.binding)){
   long at=now;for(int i=0;i<12;i++){MaterialHistorySchedule.Plan p=schedule.begin(at,false);schedule.indexed(p,index(OWNER.binding,p.month,p.month.equals("2026-10")?Arrays.asList("2026-10-01","2026-10-10","2026-10-20","2026-10-29"):Collections.emptyList()),at+1);at+=31000;}
   MaterialHistorySchedule.Plan p=schedule.begin(at,false);yes(p.date.equals("2026-10-29"));schedule.empty(p,at+1);yes(!schedule.status().dates.contains(LocalDate.of(2026,10,29)));
   at+=31000;p=schedule.begin(at,false);yes(p.date.equals("2026-10-20"));schedule.failed(p,at+1,"MATERIAL_LOCAL_BUDGET");at+=31000;p=schedule.begin(at,false);yes(p.date.equals("2026-10-10"));schedule.loaded(p,at+1);yes(schedule.status().capacity&&schedule.status().loaded==1);
  }
  // dev156's latched account-wide capacity flag is migrated, not carried over.
  try(Fixture f=new Fixture()){
   File file=new File(f.files,"material-accounts/"+OWNER.binding+"/history-load/state.json");List<Object> rows=new ArrayList<>();
   for(int i=0;i<12;i++){String month=YearMonth.of(2026,10).minusMonths(i).toString();rows.add(WireJson.object("month",month,"checked",now-60000,"dates",i==0?Arrays.asList("2026-10-01","2026-10-10","2026-10-20","2026-10-29"):Collections.emptyList(),"loaded",i==0?Arrays.asList("2026-10-01","2026-10-10","2026-10-20"):Collections.emptyList(),"failed_at",0,"retry_after",0,"failures",0,"error",""));}
   try(AtomicDocument document=new AtomicDocument(file,524288)){document.save(WireJson.object("schema",2,"account",OWNER.binding,"attempt",now,"next",now+900000,"failures",5,"capacity",true,"error","MATERIAL_LOCAL_BUDGET","months",rows));}
   try(MaterialHistorySchedule schedule=new MaterialHistorySchedule(f.files,OWNER.binding)){MaterialHistorySchedule.Plan p=schedule.begin(now+1,false);yes(p!=null&&p.date.equals("2026-10-29")&&!schedule.status().capacity&&schedule.status().days==3&&schedule.status().loaded==2);schedule.loaded(p,now+2);yes(schedule.status().loaded==3);}
  }
  // A selected old date loads only its own bodies; cached date metadata stays available.
  try(Fixture f=new Fixture()){
   MaterialSettings.value=null;good(f.day("2026-10-23","Asia/Shanghai"));Host107LifelogHttp.sourceId="older-on-demand";good(f.day("2026-08-01","Asia/Shanghai"));
   Catalog selected=new Catalog();int reads=Host107LifelogHttp.fulls;f.runtime.browse("2026-10-23","Asia/Shanghai",selected);f.finish(selected);good(selected);yes(selected.value.local.records.size()==1&&selected.value.date.equals("2026-10-23")&&selected.value.catalog.dates.contains(LocalDate.of(2026,8,1))&&Host107LifelogHttp.fulls==reads);noUpload();
  }
 }
 static long historyIndexed(Fixture f,long now)throws Exception{for(int i=0;i<12;i++)history(f,now+i*31000).get(3,TimeUnit.SECONDS);return now+12*31000;}
 static void historyRuntime()throws Exception{
  TimeZone old=TimeZone.getDefault();TimeZone.setDefault(TimeZone.getTimeZone("Asia/Shanghai"));long now=System.currentTimeMillis();
  try{
   // History belongs to the signed-in source account, not optional uploads.
   try(Fixture f=new Fixture()){
    MaterialSettings.value=null;long dayAt=historyIndexed(f,now);if(Host107LifelogHttp.calendars!=12||Host107LifelogHttp.lists!=0)throw new AssertionError("history count calendars="+Host107LifelogHttp.calendars+" lists="+Host107LifelogHttp.lists+" status="+f.runtime.historyStatus(OWNER.binding));noUpload();
    history(f,dayAt).get(3,TimeUnit.SECONDS);yes(Host107LifelogHttp.calendars==12&&Host107LifelogHttp.lists==2&&Host107LifelogHttp.fulls==1);yes(local(f,OWNER.binding).days.size()==1);noUpload();
    try(MaterialHistorySchedule schedule=new MaterialHistorySchedule(f.files,OWNER.binding)){yes(schedule.status().loaded==1&&schedule.status().indexed==12);}
    yes(f.runtime.historyStatus(OWNER.binding).contains("12 个月")&&!f.runtime.historyStatus(OTHER.binding).contains("已检查"));
   }
   // Real parser failure from eleven incomplete responses cannot hold the
   // verified October dates behind the failed September request.
   try(Fixture f=new Fixture()){
    MaterialSettings.value=null;YearMonth current=YearMonth.from(Instant.ofEpochMilli(now).atZone(ZoneId.of("Asia/Shanghai")));for(int i=0;i<12;i++)if(!current.minusMonths(i).equals(YearMonth.of(2026,10)))Host107LifelogHttp.partialMonths.add(current.minusMonths(i).toString());
    long dayAt=historyIndexed(f,now);if(Host107LifelogHttp.calendars!=12||Host107LifelogHttp.lists!=0)throw new AssertionError("history count calendars="+Host107LifelogHttp.calendars+" lists="+Host107LifelogHttp.lists+" status="+f.runtime.historyStatus(OWNER.binding));
    history(f,dayAt).get(3,TimeUnit.SECONDS);history(f,dayAt+31000).get(3,TimeUnit.SECONDS);yes(Host107LifelogHttp.lists==4&&local(f,OWNER.binding).days.size()==2);
    try(MaterialHistorySchedule schedule=new MaterialHistorySchedule(f.files,OWNER.binding)){yes(schedule.status().indexed==1&&schedule.status().unverified==11&&schedule.status().loaded==2);yes(schedule.status().message.contains("日历标记待核实")&&!schedule.status().message.contains("联网"));}noUpload();
   }
   // Foreground ownership cancels an in-flight day before persistence.
   try(Fixture f=new Fixture()){
    MaterialSettings.value=null;long dayAt=historyIndexed(f,now);Host107LifelogHttp.entered=new CountDownLatch(1);Host107LifelogHttp.release=new CountDownLatch(1);
    Future<?> background=history(f,dayAt);yes(Host107LifelogHttp.entered.await(2,TimeUnit.SECONDS));Catalog front=new Catalog();f.runtime.catalog(front);Host107LifelogHttp.release.countDown();background.get(3,TimeUnit.SECONDS);f.finish(front);good(front);yes(front.value.catalog.entries.isEmpty()&&Host107LifelogHttp.disabled>0);
    try(MaterialHistorySchedule schedule=new MaterialHistorySchedule(f.files,OWNER.binding)){yes(schedule.status().loaded==0&&!schedule.status().capacity);}noUpload();
   }
   // A queued foreground catalog wins even before the background starts.
   try(Fixture f=new Fixture()){
    MaterialSettings.value=null;Catalog front=new Catalog();f.runtime.catalog(front);history(f,now).get(3,TimeUnit.SECONDS);f.finish(front);good(front);yes(Host107LifelogHttp.calendars==0);noUpload();
   }
   try(Fixture f=new Fixture()){
    MaterialSettings.value=config("a",false,now+600000);long dayAt=historyIndexed(f,now);Host107LifelogHttp.afterFull=()->Host107Login.current=OTHER;history(f,dayAt).get(3,TimeUnit.SECONDS);
    yes(local(f,OWNER.binding).records.isEmpty()&&local(f,OTHER.binding).records.isEmpty());try(MaterialHistorySchedule schedule=new MaterialHistorySchedule(f.files,OWNER.binding)){yes(schedule.status().loaded==0);}noUpload();
   }
   // Capacity never evicts old text or advances the pending date.
   try(Fixture f=new Fixture()){
    MaterialSettings.value=null;good(f.day("2026-10-23","Asia/Shanghai"));OfficialLifelogSnapshot.Source base=local(f,OWNER.binding).records.get(0).source;List<OfficialLifelogSnapshot.Source> records=new ArrayList<>();records.add(base);
    for(int i=1;i<256;i++){Map<String,Object> value=WireJson.map(WireJson.read(base.original()));value.put("sourceId","capacity-"+i);records.add(OfficialLifelogSnapshot.original(WireJson.bytes(value)));}
    try(MaterialLocalLibrary library=new MaterialLocalLibrary(f.files,OWNER.binding)){library.recordRead("2026-10-23","Asia/Shanghai",records,now,()->OWNER.binding);}byte[] before=localBytes(f,OWNER.binding);
    long dayAt=historyIndexed(f,now+60000);Host107LifelogHttp.sourceId="beyond-capacity";history(f,dayAt).get(3,TimeUnit.SECONDS);
    try(MaterialLocalLibrary library=new MaterialLocalLibrary(f.files,OWNER.binding)){yes(library.snapshot("2026-10-23","Asia/Shanghai").records.size()==256&&library.snapshot().records.size()==257);}
    try(MaterialHistorySchedule schedule=new MaterialHistorySchedule(f.files,OWNER.binding)){yes(!schedule.status().capacity&&schedule.status().loaded==1);}yes(!f.runtime.historyStatus(OWNER.binding).contains("256"));noUpload();
   }
   TimeZone.setDefault(TimeZone.getTimeZone("America/Los_Angeles"));try(Fixture f=new Fixture()){MaterialSettings.value=null;history(f,now).get(3,TimeUnit.SECONDS);yes(Host107LifelogHttp.calendars==0&&f.runtime.historyStatus(OWNER.binding).contains("中国时区"));noUpload();}
  }finally{TimeZone.setDefault(old);}
 }
 static AudioConfig audioConfig(MaterialConfig material,boolean enabled,long expires)throws Exception{Map<String,Object> raw=WireJson.map(WireJson.read(material.connection.encode()));raw.put("format",AudioConnection.FORMAT);raw.put("expires_at",TaskWire.now(expires));return new AudioConfig(AudioConnection.parse(WireJson.bytes(raw),0),material.account,enabled);}
 static void audioRuntime()throws Exception{
  try(Fixture f=new Fixture()){AudioDone read=new AudioDone();f.runtime.readAudio(read);f.finish(read);yes(read.error.isEmpty()&&read.value.config==null&&read.value.status.rows.isEmpty()&&AudioHttp.created==0);}
  try(Fixture f=new Fixture()){AudioConfig next=audioConfig(MaterialSettings.value,true,System.currentTimeMillis()+600000);AudioDone configured=new AudioDone();f.runtime.configureAudio(OWNER.binding,next.connection.encode(),true,configured);f.finish(configured);yes(configured.error.isEmpty()&&AudioSettings.value.enabled&&AudioHttp.exchanges==1&&AudioHttp.posts==0);yes(MaterialHttp.created==0&&MaterialSyncSession.started==0);AudioDone paused=new AudioDone();f.runtime.setAudioEnabled(AudioSettings.value.fingerprint(),false,paused);f.finish(paused);yes(paused.error.isEmpty()&&!AudioSettings.value.enabled&&AudioHttp.exchanges==1);}
  try(Fixture f=new Fixture()){AudioSettings.value=audioConfig(MaterialSettings.value,true,System.currentTimeMillis()+600000);String old=AudioSettings.value.fingerprint();AudioSettings.value=AudioSettings.value.enabled(false);String current=AudioSettings.value.fingerprint();AudioDone result=new AudioDone();f.runtime.setAudioEnabled(old,false,result);f.finish(result);yes("AUDIO_CONNECTION_CHANGED".equals(result.error)&&AudioSettings.value.fingerprint().equals(current)&&AudioHttp.created==0);}
  try(Fixture f=new Fixture()){AudioConfig next=audioConfig(MaterialSettings.value,true,System.currentTimeMillis()+600000);AudioDone result=new AudioDone();f.runtime.configureAudio(OTHER.binding,next.connection.encode(),true,result);f.finish(result);yes("OFFICIAL_ACCOUNT_CHANGED".equals(result.error)&&AudioSettings.value==null&&AudioHttp.created==0);}
  try(Fixture f=new Fixture()){AudioSettings.value=audioConfig(MaterialSettings.value,true,System.currentTimeMillis()+600000);AudioDone result=new AudioDone();f.runtime.syncAudio("stale-ui-fingerprint",result);f.finish(result);yes("AUDIO_CONNECTION_CHANGED".equals(result.error)&&AudioHttp.created==0&&AudioHttp.posts==0);}
  try(Fixture f=new Fixture()){AudioConfig next=audioConfig(MaterialSettings.value,true,System.currentTimeMillis()+600000);AudioHttp.after=()->Host107Login.current=OTHER;AudioDone result=new AudioDone();f.runtime.configureAudio(next.connection.encode(),true,result);f.finish(result);yes(!result.error.isEmpty()&&AudioSettings.value==null&&AudioHttp.posts==0);}
  try(Fixture f=new Fixture()){AudioSettings.value=audioConfig(MaterialSettings.value,true,System.currentTimeMillis()+600000);AudioHttp.after=()->Host107Login.current=OTHER;AudioDone result=new AudioDone();f.runtime.syncAudio(result);f.finish(result);yes("OFFICIAL_ACCOUNT_CHANGED".equals(result.error)&&result.value.config==null&&AudioHttp.posts==0);}
  try(Fixture f=new Fixture()){AudioSettings.value=audioConfig(MaterialSettings.value,true,System.currentTimeMillis()+600000);AudioHttp.after=()->{try{AudioSettings.value=AudioSettings.value.enabled(false);}catch(IOException e){throw new RuntimeException(e);}};AudioDone result=new AudioDone();f.runtime.syncAudio(result);f.finish(result);yes(result.error.isEmpty()&&!AudioSettings.value.enabled&&result.value.note.equals("paused")&&AudioHttp.posts==0);}
  try(Fixture f=new Fixture()){AudioSettings.value=audioConfig(MaterialSettings.value,true,System.currentTimeMillis()+600000);AudioHttp.after=()->MaterialSettings.value=MaterialSettings.value.enabled(false);AudioDone result=new AudioDone();f.runtime.syncAudio(result);f.finish(result);yes(result.error.isEmpty()&&result.value.note.equals("paused")&&AudioHttp.posts==0);}
  try(Fixture f=new Fixture()){AudioSettings.value=audioConfig(MaterialSettings.value,true,System.currentTimeMillis()+600000);AudioHttp.entered=new CountDownLatch(1);AudioHttp.release=new CountDownLatch(1);AudioDone audio=new AudioDone();f.runtime.syncAudio(audio);yes(AudioHttp.entered.await(2,TimeUnit.SECONDS));Done pause=new Done();f.runtime.pause(pause);AudioHttp.release.countDown();f.finish(audio);while(pause.calls==0){f.idle();f.deliver();}yes("MATERIAL_PAUSED".equals(audio.error)&&pause.error.isEmpty()&&!MaterialSettings.value.enabled&&AudioHttp.posts==0);}
  // Audio can use already stored text evidence after the text upload grant
  // expires; it still requires its own fresh grant and the global enabled flag.
  try(Fixture f=new Fixture()){AudioSettings.value=audioConfig(MaterialSettings.value,true,System.currentTimeMillis()+600000);MaterialSettings.value=config("a",true,System.currentTimeMillis()-1);f.app.callbacks.onActivityStopped(f.activity);f.runtime.wakeAuto(false);f.idle();yes(MaterialSyncSession.started==0&&AudioHttp.exchanges==1&&AudioHttp.posts==0);int before=AudioHttp.exchanges;f.runtime.wakeAuto(false);f.idle();yes(AudioHttp.exchanges==before);}
  try(Fixture f=new Fixture()){AudioSettings.value=audioConfig(MaterialSettings.value,true,System.currentTimeMillis()-1);f.runtime.wakeAuto(false);f.idle();yes(AudioHttp.created==0&&MaterialSyncSession.completed==1);}
 }
 public static void main(String[] args)throws Exception{
  root=new File(args[0]);
  if(args.length>1&&args[1].equals("history")){materialRecovery();dayReads();readingLatency();historySchedule();partialHistory();recentHistoryWindow();historyRuntime();System.out.println("Material month runtime: "+checks+" checks passed; real Runtime and month core, synthetic Android/IO boundaries");return;}
  // Catalog reads use the real serialized runtime and queue, reject another
  // account before revealing text, and permit local reading after upload expiry.
  try(Fixture f=new Fixture()){MaterialSettings.value=config("a",false,System.currentTimeMillis()-1000);Catalog result=new Catalog();f.runtime.catalog(result);f.finish(result);yes(result.calls==1&&result.error.isEmpty()&&result.value.catalog.account.equals(OWNER.binding));yes(result.value.catalog.entries.isEmpty()&&MaterialHttp.created==0);}
  try(Fixture f=new Fixture()){Host107Login.current=OTHER;Catalog result=new Catalog();f.runtime.catalog(result);f.finish(result);yes(result.error.isEmpty()&&result.value.config==null&&result.value.catalog.account.equals(OTHER.binding)&&result.value.catalog.entries.isEmpty());}
  try(Fixture f=new Fixture()){Catalog result=new Catalog();f.runtime.catalog(result);f.idle();f.runtime.cancelPending();f.deliver();yes(result.value==null&&"MATERIAL_PAUSED".equals(result.error));}
  // A stale UI may not restore old credentials while merely changing a switch.
  try(Fixture f=new Fixture()){String old=MaterialSettings.value.fingerprint();MaterialSettings.value=config("b",false,System.currentTimeMillis()+600000);String current=MaterialSettings.value.fingerprint();Done done=new Done();f.runtime.setEnabled(old,true,done);f.idle();f.deliver();yes("MATERIAL_CONNECTION_CHANGED".equals(done.error)&&MaterialSettings.value.fingerprint().equals(current));yes(MaterialHttp.created==0);}
  try(Fixture f=new Fixture()){MaterialSettings.value=config("a",false,System.currentTimeMillis()+600000);Done enabled=new Done();f.runtime.setEnabled(MaterialSettings.value.fingerprint(),true,enabled);f.idle();f.deliver();yes(enabled.error.isEmpty()&&MaterialSettings.value.enabled&&MaterialHttp.created==1);Done paused=new Done();f.runtime.setEnabled(MaterialSettings.value.fingerprint(),false,paused);f.idle();f.deliver();yes(paused.error.isEmpty()&&!MaterialSettings.value.enabled&&MaterialHttp.created==1);}
  try(Fixture f=new Fixture()){String before=MaterialSettings.value.fingerprint();Host107Login.current=OTHER;Done done=new Done();f.runtime.setEnabled(before,false,done);f.idle();f.deliver();yes("OFFICIAL_ACCOUNT_CHANGED".equals(done.error)&&MaterialSettings.value.fingerprint().equals(before));}
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
   yes(done.error.isEmpty()&&MaterialSyncSession.started==1&&MaterialSyncSession.completed==1);yes(MaterialSyncSession.kind.equals("discovery")&&Host107LifelogHttp.discoveryCalls==1&&Host107LifelogHttp.selected.size()==7);yes(Host107LifelogHttp.calendars==1&&OfficialLifelogBatch.reads==0&&OfficialHiveCache.reads==0&&OfficialLifelogRefresh.refreshes==0);
   for(int i=0;i<7;i++){OfficialLifelogInventory.Request day=Host107LifelogHttp.selected.get(i);yes(day.date.equals(first(7).get(i))&&day.timezone.equals("Asia/Shanghai"));}
   Done repeat=f.sync(selected,first(1));yes("MATERIAL_MONTH_SELECTION_STALE".equals(repeat.error)&&MaterialSyncSession.completed==1);
  }
  // Cancelling while the selected source is in flight must be observed before
  // the downstream session's commit boundary. The fake source cannot authorize it.
  try(Fixture f=new Fixture()){
   MaterialRuntime.MonthSelection selected=f.selection();Host107LifelogHttp.entered=new CountDownLatch(1);Host107LifelogHttp.release=new CountDownLatch(1);Done done=new Done();f.runtime.syncMonthDays(selected,first(1),done);yes(Host107LifelogHttp.entered.await(2,TimeUnit.SECONDS));f.runtime.cancelPending();Host107LifelogHttp.release.countDown();f.idle();f.deliver();yes("MATERIAL_PAUSED".equals(done.error)&&MaterialSyncSession.completed==0);yes(Host107LifelogHttp.disabled>0);
  }
  // The two existing entry points retain their original source routing.
  try(Fixture f=new Fixture()){Done done=new Done();f.runtime.sync(done);f.idle();f.deliver();yes(done.error.isEmpty()&&MaterialSyncSession.kind.equals("fresh")&&MaterialSyncSession.completed==1);yes(Host107LifelogHttp.calendars==0&&OfficialLifelogBatch.reads==1&&OfficialLifelogRefresh.refreshes==1&&Host107LifelogHttp.discoveryCalls==0);}
  try(Fixture f=new Fixture()){Done done=new Done();f.runtime.syncDay("2026-10-10","Asia/Shanghai",done);f.idle();f.deliver();yes(done.error.isEmpty()&&MaterialSyncSession.kind.equals("discovery")&&MaterialSyncSession.completed==1);yes(Host107LifelogHttp.calendars==0&&Host107LifelogHttp.selected.size()==1&&Host107LifelogHttp.selected.get(0).date.equals("2026-10-10"));}
  dayReads();autoSync();foregroundCatalogPriority();readingLatency();autoSchedule();historySchedule();partialHistory();historyRuntime();audioRuntime();
  System.out.println("Material month runtime: "+checks+" checks passed; real Runtime and month core, synthetic Android/IO boundaries");
 }
}

// Finite interface doubles. No copy of generation, fingerprint or day-selection
// admission logic: those decisions run only in the production classes above.
final class Host107Login{static volatile OfficialAccountBinding current;static boolean delivering;static int reads;static java.util.function.IntConsumer onRead;static OfficialAccountBinding account(){reads++;if(onRead!=null)onRead.accept(reads);if(delivering&&Thread.currentThread().getName().equals("main"))throw new AssertionError("Main callback must not perform login IO");return current;}}
final class Host107RecordingDeletion implements OfficialRecordingDeletion.Source{public OfficialAccountBinding current(){return Host107Login.account();}public String read(String key){return null;}}
final class TaskSettings{static TaskDevice value;TaskSettings(android.content.Context app){}TaskDevice loadDevice(){return value;}String phoneAccount(TaskDevice phone){return MaterialMonthRuntimeTest.OWNER.binding;}}
final class MaterialSettings{static volatile MaterialConfig value;static String failure="";MaterialSettings(android.content.Context app){}String recoverySecret(String identity){return "R".repeat(43);}MaterialConfig load()throws IOException{if(!failure.isEmpty())throw new IOException(failure);return value;}void save(MaterialConfig v){value=v;}}
final class Host107LifelogHttp implements AutoCloseable,OfficialLifelogDiscovery.Transport{
 static int calendars,closed,discoveryCalls,lists,fulls;static volatile int disabled;
 static List<OfficialLifelogInventory.Request> selected;static CountDownLatch entered,release;
 static String eventId,sourceId,content,fail;static Set<String> partialMonths;static boolean grow,empty,changeMembership;static Runnable afterFull;
 final MaterialSyncSession.Guard guard;final String timezone;boolean firstList=true;
 Host107LifelogHttp(android.content.Context app,OfficialAccountBinding owner,MaterialSyncSession.Guard guard){this(app,owner,guard,"Asia/Shanghai");}
 Host107LifelogHttp(android.content.Context app,OfficialAccountBinding owner,MaterialSyncSession.Guard guard,String timezone){this.guard=guard;this.timezone=timezone;}
 static void reset(){calendars=closed=disabled=discoveryCalls=lists=fulls=0;selected=new ArrayList<>();partialMonths=new HashSet<>();entered=release=null;eventId="synthetic-event";sourceId="synthetic-source";content="合成当天智记。\n保留完整条件 😀";fail="";grow=empty=changeMembership=false;afterFull=null;}
 byte[] latestJournals()throws Exception{guard.check();return WireJson.bytes(WireJson.object("code",0,"data",Collections.emptyList()));}
 byte[] deleteEvent(String id)throws Exception{guard.check();throw new IOException("TEST_DELETE_NOT_AUTHORIZED");}
 byte[] calendar(OfficialLifelogCalendarRequest request)throws Exception{guard.check();calendars++;if(fail.equals("calendar"))throw new IOException("SYNTHETIC_CALENDAR_UNAVAILABLE");if(partialMonths.contains(request.month().toString()))return WireJson.bytes(WireJson.object("code",0,"data",WireJson.object("dailyLifelogList",Collections.emptyList())));return MaterialMonthRuntimeTest.calendar(request.month().toString(),request.month().toString().equals("2026-10")?MaterialMonthRuntimeTest.first(8):Collections.emptyList());}
 public byte[] list(OfficialLifelogInventory.Request request)throws Exception{
  if(firstList){discoveryCalls++;firstList=false;}if(selected.stream().noneMatch(q->q.path.equals(request.path)))selected.add(request);lists++;
  if(entered!=null){entered.countDown();if(!release.await(2,TimeUnit.SECONDS))throw new IOException("TEST_RELEASE_MISSING");}
  guard.check();if(fail.equals("list"))throw new IOException("SYNTHETIC_LIST_UNAVAILABLE");
  List<Object> events=new ArrayList<>();if(!empty&&!(changeMembership&&fulls>0))events.add(WireJson.object("id",eventId,"eventType","audio","flowType","event","transcriptionInfos",Arrays.asList(link())));
  return WireJson.bytes(WireJson.object("code",0,"data",WireJson.object("date",request.date,"timezone",request.timezone,"events",events)));
 }
 static Map<String,Object> link(){return WireJson.object("sourceType","CONVERSATION","sourceId",sourceId);}
 public byte[] full(String id)throws Exception{
  guard.check();fulls++;if(fail.equals("full"))throw new IOException("SYNTHETIC_FULL_UNAVAILABLE");
  long start=Instant.parse("2026-10-22T15:59:00Z").toEpochMilli(),end=start+(grow?180000:120000);
  List<Object> clips=new ArrayList<>();clips.add(WireJson.object("clipId","first","content",content,"startTime",Long.toString(start),"endTime",Long.toString(start+1000),"speakerType","OTHERS","speakerName","合成说话人"));
  if(grow)clips.add(WireJson.object("clipId","second","content","新增长的第二段，不截断。","startTime",Long.toString(start+121000),"endTime",Long.toString(end),"speakerType","OTHERS","speakerName","合成说话人"));
  byte[] result=WireJson.bytes(WireJson.object("code",0,"data",WireJson.object("id",id,"originalList",Arrays.asList(WireJson.object("id",sourceId,"startTime",Long.toString(start),"endTime",Long.toString(end),"transcriptionInfos",Arrays.asList(link()))),"transcriptionContents",Arrays.asList(WireJson.object("sourceId",sourceId,"sourceType","CONVERSATION","title","合成测试资料","startTime",Long.toString(start),"endTime",Long.toString(end),"clips",clips)))));
  if(afterFull!=null)afterFull.run();return result;
 }
 void disable(){disabled++;}void cancel(){disable();}public void close(){closed++;}
}
final class MaterialHttp implements MaterialApi.Transport{static int created,exchanges;static java.util.function.BiFunction<MaterialConnection,String,MaterialApi.Response> reply;static Runnable after;final MaterialConnection connection;MaterialHttp(MaterialConnection c){connection=c;created++;}void disable(){}public void cancel(){}public MaterialApi.Response exchange(String path,byte[] body){exchanges++;MaterialApi.Response result=reply==null?new MaterialApi.Response():reply.apply(connection,path);if(path.equals("/material-pairing/recover")&&after!=null)after.run();return result;}}
final class MaterialApi{interface Transport{Response exchange(String path,byte[] body)throws IOException;void cancel();}static final class Response{final int status;final byte[] body;final long retryAfter;Response(){this(200,new byte[0],0);}Response(int status,byte[] body,long retryAfter){this.status=status;this.body=body;this.retryAfter=retryAfter;}}final Transport http;MaterialApi(MaterialConnection connection,Transport http){this.http=http;}void preflight(long now,boolean versions)throws IOException{http.exchange("/identity",null);}}
final class MaterialSyncSession{
 interface Guard{void check()throws IOException;}interface AccountSource{OfficialAccountBinding current()throws Exception;default OfficialRecordingDeletion.Source deletions(){return null;}}interface DiscoverySource extends AccountSource{OfficialLifelogDiscovery.Snapshot discover()throws Exception;}interface FreshSource extends AccountSource{OfficialLifelogBatch read()throws Exception;OfficialLifelogRefresh.Fresh refresh(OfficialLifelogBatch observed)throws Exception;}
 static final class Status{boolean selectedComplete=true,progressed;int queued,stored,blocked,expired,reconcile,added,conflicts,unowned,invalid,discovered,days,recordings,otherEntries,tooLarge;String note="ready";}
 static int started,completed;static String kind;static void reset(){started=completed=0;kind="";}final AccountSource source;final Guard guard;
 MaterialSyncSession(File dir,MaterialConfig cfg,AccountSource source,Guard guard,MaterialHttp http){started++;this.source=source;this.guard=guard;}
 static Status status(File dir,MaterialConfig config){return new Status();}
 static File accountFiles(File dir,MaterialConfig config){return MaterialStorage.current(dir,config);}
 Status sync()throws Exception{guard.check();if(source.deletions()!=null)throw new IOException("PRODUCT_DELETION_SYNC_MUST_BE_DISABLED");source.current();if(source instanceof DiscoverySource){kind="discovery";((DiscoverySource)source).discover();}else{kind="fresh";FreshSource fresh=(FreshSource)source;fresh.refresh(fresh.read());}guard.check();source.current();completed++;return new Status();}
}

final class OfficialLifelogBatch{interface Login{OfficialAccountBinding current()throws Exception;}static int reads;static OfficialLifelogBatch read(File root,Login login)throws Exception{reads++;login.current();return new OfficialLifelogBatch();}}
final class OfficialLifelogRefresh{interface Ownership{OfficialAccountBinding current()throws Exception;Set<String> references()throws Exception;}static final class Fresh{final List<OfficialLifelogSnapshot.Source> sources=Collections.emptyList();}static int refreshes;static Fresh read(OfficialLifelogBatch batch,Ownership owner,Host107LifelogHttp http)throws Exception{refreshes++;owner.current();owner.references();return new Fresh();}}
final class OfficialHiveCache{static int reads;static Object read(File file){reads++;return new Object();}static Set<String> sourceReferences(Object data){return Collections.emptySet();}}

// Audio uses the production config, session, schedule and queue. Only its
// settings, HTTP peer and capture-directory provider are finite boundaries.
final class AudioSettings{static volatile AudioConfig value;AudioSettings(android.content.Context app){}AudioConfig load(){return value;}interface Guard{void check()throws IOException;}void save(AudioConfig config)throws IOException{save(config,()->{});}void save(AudioConfig config,Guard guard)throws IOException{guard.check();if(value!=null)value.replaceAllowed(config);value=config;guard.check();}}
final class AudioHttp implements MaterialApi.Transport{static int created,exchanges,posts;static Runnable after;static CountDownLatch entered,release;final AudioConnection config;volatile boolean disabled;AudioHttp(AudioConnection config){this.config=config;created++;}void disable(){disabled=true;}public void cancel(){disable();}public MaterialApi.Response exchange(String path,byte[] body)throws IOException{if(disabled)throw new IOException("AUDIO_PAUSED");if(entered!=null){entered.countDown();try{if(!release.await(3,TimeUnit.SECONDS))throw new IOException("TEST_AUDIO_RELEASE_MISSING");}catch(InterruptedException e){Thread.currentThread().interrupt();throw new IOException("TEST_INTERRUPTED");}}if(disabled)throw new IOException("AUDIO_PAUSED");exchanges++;if(body!=null)posts++;if(!path.equals("/identity"))throw new IOException("SYNTHETIC_AUDIO_ROUTE_NOT_PREPARED");byte[] response=WireJson.bytes(WireJson.object("schema_version","1.0","owner_id",config.owner,"producer_id",config.producer,"server_id",config.server,"expires_at",TaskWire.now(config.expiresAt),"scopes",Arrays.asList("audio:write"),"capabilities",Arrays.asList("audio_archive_v1")));if(after!=null)after.run();return new MaterialApi.Response(200,response,0);}}
final class LifelogAudioRuntime{static void sources(String account,List<OfficialLifelogSnapshot.Source> sources){}static CompletableFuture<AudioSyncSession.Catalog> catalogForUpload(String account){try{return CompletableFuture.completedFuture(new AudioSyncSession.Catalog(account,Collections.emptyList(),Collections.emptyList()));}catch(IOException e){CompletableFuture<AudioSyncSession.Catalog> f=new CompletableFuture<>();f.completeExceptionally(e);return f;}}}

final class DailySummarySync {
 static MaterialSyncSession.Status status(File root,MaterialConfig config){return new MaterialSyncSession.Status();}
 static MaterialSyncSession.Status run(File root,MaterialConfig config,List<DailySummary> summaries,Set<String> dates,MaterialSyncSession.Guard guard,MaterialApi.Transport transport)throws Exception{throw new AssertionError("Local history must not call summary upload");}
}

// Upload remains a forbidden boundary in the history-only runtime suite.
final class LifelogTextSync {
 static MaterialSyncSession.Status status(File root,MaterialConfig config){return new MaterialSyncSession.Status();}
 static MaterialSyncSession.Status run(File root,MaterialConfig config,Set<String> dates,MaterialSyncSession.Guard guard,MaterialApi.Transport transport)throws Exception{throw new IOException("HISTORY_FIXTURE_UPLOAD_DISABLED");}
}
