package com.turboio.addon;
import android.app.*;import android.content.*;import android.os.*;
import java.io.*;import java.util.*;import java.util.concurrent.*;

/** Serial material owner. UI reads remain foreground-bound; authorized automatic
 * sync may continue in the background, with account and pause fences per request. */
final class MaterialRuntime {
 interface Result {void done(Snapshot value,String error);}
 interface MonthResult {void done(MonthSelection value,String error);}
 interface CatalogResult {void done(CatalogSnapshot value,String error);}
 static final class CatalogSnapshot {
  final MaterialConfig config;final MaterialCatalog catalog;final MaterialLocalLibrary.Snapshot local;final String uploadError,autoError;
  /** Official summaries/outlines/trails; null when the local copy is unreadable. */
  final LifelogInsightStore.Snapshot insights;
  CatalogSnapshot(MaterialConfig config,MaterialCatalog catalog,MaterialLocalLibrary.Snapshot local,String uploadError,String autoError,LifelogInsightStore.Snapshot insights){this.config=config;this.catalog=catalog;this.local=local;this.uploadError=uploadError;this.autoError=autoError;this.insights=insights;}
 }
 static final class MonthSelection {
  final OfficialLifelogMonthDiscovery.Snapshot source;final String configFingerprint;private final long owner;
  private MonthSelection(OfficialLifelogMonthDiscovery.Snapshot source,String fingerprint,long owner){this.source=source;configFingerprint=fingerprint;this.owner=owner;}
 }
 static final class AudioSnapshot {final AudioConfig config;final AudioSyncSession.Status status;final String account,note;AudioSnapshot(AudioConfig c,AudioSyncSession.Status s,String a,String n){config=c;status=s;account=a;note=n;}}
 interface AudioResult {void done(AudioSnapshot value,String error);}
 private volatile AudioHttp audioTransport;private AudioSyncSession.Status audioStatus=new AudioSyncSession.Status(Collections.emptyList(),"",0,0,false);private String audioNote="unconfigured";
 static final class Snapshot {final MaterialConfig config;final MaterialSyncSession.Status status;final String note;Snapshot(MaterialConfig c,MaterialSyncSession.Status s,String n){config=c;status=s;note=n;}}
 private static MaterialRuntime instance;private final Context app;private final MaterialSettings settings;private final Object guard=new Object();
 private final Handler main=new Handler(Looper.getMainLooper());private final ExecutorService io=Executors.newSingleThreadExecutor(),viewIO=Executors.newSingleThreadExecutor(),cancel=Executors.newSingleThreadExecutor();
 private volatile CatalogSnapshot recentCatalog;private volatile long recentCatalogAt;
 private final Set<Activity> foreground=Collections.newSetFromMap(new WeakHashMap<Activity,Boolean>());private volatile boolean visible;private volatile long generation,backgroundOwner=-1,lastUiAt,autoDeadline;private boolean autoQueued,networkWake;private final java.util.concurrent.atomic.AtomicInteger foregroundCatalogs=new java.util.concurrent.atomic.AtomicInteger();private volatile MaterialHttp transport;
 private volatile Host107LifelogHttp officialTransport;private MaterialConfig config;private MaterialSyncSession.Status status=new MaterialSyncSession.Status();private String note="unconfigured",autoError="",autoTarget="";private boolean prewarming;private final List<CatalogResult> prewarmWaiters=new ArrayList<>();
 private MaterialRuntime(Activity activity){this(activity,activity);}
 private MaterialRuntime(Context context,Activity activity){app=context.getApplicationContext();settings=new MaterialSettings(app);if(activity!=null){foreground.add(activity);visible=true;}((Application)app).registerActivityLifecycleCallbacks(new Application.ActivityLifecycleCallbacks(){
  public void onActivityStarted(Activity a){foreground.add(a);visible=true;}public void onActivityStopped(Activity a){foreground.remove(a);visible=!foreground.isEmpty();if(!visible&&backgroundOwner!=generation)invalidate();}public void onActivityDestroyed(Activity a){foreground.remove(a);}public void onActivityCreated(Activity a,Bundle b){}public void onActivityResumed(Activity a){}public void onActivityPaused(Activity a){}public void onActivitySaveInstanceState(Activity a,Bundle b){}
 });main.postDelayed(autoTick,10000);
  try{android.net.ConnectivityManager network=(android.net.ConnectivityManager)app.getSystemService(Context.CONNECTIVITY_SERVICE);if(network!=null)network.registerDefaultNetworkCallback(new android.net.ConnectivityManager.NetworkCallback(){public void onAvailable(android.net.Network value){main.post(()->wakeAuto(true));}});}catch(RuntimeException ignored){}
 }
 static synchronized MaterialRuntime get(Activity activity){if(instance==null)instance=new MaterialRuntime(activity);instance.foreground.add(activity);instance.visible=true;instance.prewarm();return instance;}
 static synchronized MaterialRuntime boot(Context context){if(instance==null)instance=new MaterialRuntime(context,null);return instance;}
 private void prewarm(){synchronized(guard){if(recentCatalog!=null||prewarming||foregroundCatalogs.get()>0)return;prewarming=true;}catalog((value,error)->{List<CatalogResult> waiting=new ArrayList<>(prewarmWaiters);prewarmWaiters.clear();synchronized(guard){prewarming=false;}for(CatalogResult waiter:waiting)waiter.done(value,error);});}
 private final Runnable autoTick=new Runnable(){public void run(){wakeAuto(false);main.postDelayed(this,30000);}};
 void wakeAuto(boolean networkRecovered){
  final long observed;final boolean recovered;synchronized(guard){networkWake|=networkRecovered;if(autoQueued)return;autoQueued=true;observed=generation;recovered=networkWake;networkWake=false;}
  io.execute(()->{try{autoSync(observed,recovered);}finally{boolean again;synchronized(guard){autoQueued=false;again=networkWake;}if(again)main.post(()->wakeAuto(false));}});
 }
 private void autoSync(long observed,boolean networkRecovered){
  try{
   config=settings.load();long now=System.currentTimeMillis();if(config==null||!config.enabled||observed!=generation||foregroundCatalogs.get()>0||visible&&now-lastUiAt<5000)return;
   OfficialAccountBinding login=Host107Login.account();if(login==null||!config.account.equals(login.binding))return;
   if(config.connection.expiresAt>now)try(MaterialAutoSchedule schedule=new MaterialAutoSchedule(app.getFilesDir(),config,true)){
    MaterialAutoSchedule.Plan plan=schedule.begin(now,java.time.ZoneId.systemDefault().getId(),networkRecovered);if(plan!=null){
     long owner;synchronized(guard){if(observed!=generation||foregroundCatalogs.get()>0)return;owner=invalidate();backgroundOwner=owner;autoDeadline=System.nanoTime()+120000000000L;}
     boolean success=false,progressed=false;try{performSync(owner,null,null,null,null,false,null);success=status.selectedComplete;progressed=status.progressed;autoError="";autoTarget=config.fingerprint();}catch(Exception error){if(owner==generation){note=safe(error);autoError=note;autoTarget=config.fingerprint();}}finally{try{schedule.finish(plan,System.currentTimeMillis(),success,progressed);}finally{synchronized(guard){if(backgroundOwner==owner)backgroundOwner=-1;}}}
    }
   }catch(Exception error){note=safe(error);}
   // Audio/transcripts stay on the phone under the 2026-10-26 policy.
  }catch(Exception error){note=safe(error);}
 }
 private long invalidate(){synchronized(guard){generation++;backgroundOwner=-1;AudioHttp audio=audioTransport;audioTransport=null;if(audio!=null){audio.disable();cancel.execute(audio::cancel);}if(visible)lastUiAt=System.currentTimeMillis();MaterialHttp old=transport;transport=null;if(old!=null){old.disable();cancel.execute(old::cancel);}Host107LifelogHttp prior=officialTransport;officialTransport=null;if(prior!=null){prior.disable();cancel.execute(prior::cancel);}return generation;}}
 private void check(long owner)throws IOException{if(owner==backgroundOwner&&System.nanoTime()>autoDeadline)throw new IOException("MATERIAL_AUTO_DEADLINE");if(owner!=generation||(!visible&&backgroundOwner!=owner))throw new IOException("MATERIAL_PAUSED");}
 private void checkView(long owner)throws IOException{check(owner);if(!visible)throw new IOException("MATERIAL_PAUSED");}
 private OfficialAccountBinding account(long owner)throws Exception{check(owner);OfficialAccountBinding account=Host107Login.account();MaterialWire.require(account!=null,"OFFICIAL_LOGIN_REQUIRED");check(owner);return account;}
 private interface Work {void run()throws Exception;}
 private static String safe(Exception error){String code=error.getMessage();return code!=null&&code.matches("[A-Z_]{3,80}")?code:"MATERIAL_UNAVAILABLE";}
 private void counts()throws IOException{MaterialSyncSession.Status next=DailySummarySync.status(app.getFilesDir(),config);next.added=status.added;next.conflicts=status.conflicts;next.unowned=status.unowned;next.invalid=status.invalid;next.discovered=status.discovered;next.days=status.days;next.recordings=status.recordings;next.otherEntries=status.otherEntries;next.tooLarge=status.tooLarge;status=next;}
 private void work(Work action,Result result){io.execute(()->{String error="";try{config=settings.load();action.run();}catch(Exception failed){error=safe(failed);note=error;try{counts();}catch(Exception ignored){}}Snapshot snapshot=new Snapshot(config,status,note);String code=error;main.post(()->result.done(snapshot,code));});}
 void read(Result result){work(()->{counts();if(config==null)note="unconfigured";else if(!config.enabled)note="paused";else if(note.equals("unconfigured")||note.equals("paused"))note=status.note;if(config!=null){OfficialAccountBinding current=Host107Login.account();if(current==null||!current.binding.equals(config.account))note="OFFICIAL_ACCOUNT_CHANGED";else if(config.connection.expiresAt<=System.currentTimeMillis())note="MATERIAL_IMPORT_EXPIRED";}},result);}
 /** Browsing belongs to the official signed-in account, independently of an
  * optional remote upload connection. Read-only catalogs use the view lane;
  * source refreshes, uploads and configuration writes remain on serial IO. */
 private CatalogSnapshot loadCatalog(long owner)throws Exception{
  checkView(owner);OfficialAccountBinding current=account(owner);MaterialConfig saved=null;String uploadError="";java.time.ZoneId zone=java.time.ZoneId.systemDefault();
  // Upload settings/receipts are optional views. Their failure must not hide
  // verified local records; account checks and local-library failures remain fatal.
  try{saved=settings.load();}catch(Exception failed){uploadError=safe(failed);}
  // A stale connection for another account must not expose its data or block
  // reading the currently signed-in account's official records.
  if(saved!=null&&!saved.account.equals(current.binding))saved=null;
  MaterialCatalog uploaded=MaterialCatalog.empty(current.binding,zone);
  if(saved!=null)try(MaterialOutbox outbox=new MaterialOutbox(MaterialStorage.prepare(app.getFilesDir(),saved),saved.connection)){uploaded=MaterialCatalog.fromRows(saved.account,saved.connection.producer,outbox.all(),zone);}catch(Exception failed){uploadError=safe(failed);uploaded=MaterialCatalog.empty(current.binding,zone);}
  MaterialLocalLibrary.Snapshot local;try(MaterialLocalLibrary library=new MaterialLocalLibrary(app.getFilesDir(),current.binding)){local=library.snapshot();}
  // Insights only decorate the transcript list; a damaged copy never hides it.
  LifelogInsightStore.Snapshot insights=null;try(LifelogInsightStore store=new LifelogInsightStore(app.getFilesDir(),current.binding)){insights=store.snapshot();}catch(Exception unreadable){insights=null;}
  MaterialWire.require(current.same(account(owner)),"OFFICIAL_ACCOUNT_CHANGED");check(owner);
  List<OfficialLifelogSnapshot.Source> audioSources=new ArrayList<>();for(MaterialLocalLibrary.Record record:local.records)audioSources.add(record.source);LifelogAudioRuntime.sources(current.binding,audioSources);
  MaterialCatalog catalog=MaterialCatalog.merge(uploaded,local);try(MaterialVisibility visibility=new MaterialVisibility(app.getFilesDir(),current.binding)){catalog=MaterialCatalog.visible(catalog,visibility);}
  CatalogSnapshot loaded=new CatalogSnapshot(saved,catalog,local,uploadError,saved!=null&&saved.enabled&&saved.fingerprint().equals(autoTarget)?autoError:"",insights);
  recentCatalog=loaded;recentCatalogAt=android.os.SystemClock.elapsedRealtime();return loaded;
 }
 private void deliverCatalog(long owner,CatalogSnapshot snapshot,String error,CatalogResult result){main.post(()->{
  try{checkView(owner);}catch(Exception stale){result.done(null,safe(stale));return;}
  if(snapshot==null){result.done(null,error);return;}
  // Revalidate after the result reaches the UI queue, without blocking that
  // queue on the host secure-store handler. Lifecycle generation also fences
  // a login screen transition before the final callback is allowed to render.
  viewIO.execute(()->{String rejected="";try{MaterialWire.require(snapshot.catalog.account.equals(account(owner).binding),"OFFICIAL_ACCOUNT_CHANGED");}catch(Exception stale){rejected=safe(stale);if(snapshot==recentCatalog)recentCatalog=null;}final String failure=rejected;
   main.post(()->{try{checkView(owner);}catch(Exception stale){result.done(null,safe(stale));return;}result.done(failure.isEmpty()?snapshot:null,failure.isEmpty()?error:failure);});
  });
 });}
 /** Keep automatic rounds from invalidating a foreground catalog between its
  * queued disk read, secure-store revalidation and final UI delivery. Explicit
  * pause, lifecycle and account changes still invalidate the same generation. */
 private final class CatalogCall implements CatalogResult {
  final long owner;final CatalogResult result;private final java.util.concurrent.atomic.AtomicBoolean finished=new java.util.concurrent.atomic.AtomicBoolean();
  CatalogCall(CatalogResult result,boolean takeOwnership){this.result=result;foregroundCatalogs.incrementAndGet();owner=takeOwnership?invalidate():generation;}
  public void done(CatalogSnapshot value,String error){if(!finished.compareAndSet(false,true))return;try{result.done(value,error);}finally{foregroundCatalogs.decrementAndGet();}}
 }
 void catalog(CatalogResult result){CatalogCall call;synchronized(guard){call=new CatalogCall(result,backgroundOwner==generation);}long owner=call.owner;viewIO.execute(()->{CatalogSnapshot found=null;String error="";try{found=loadCatalog(owner);}catch(Exception failed){error=safe(failed);}deliverCatalog(owner,found,error,call);});}
 /** A short-lived, immutable reading view. Revalidate the official account on
  * an independent lane so an HTTP request cannot hold an already-loaded page.
  * Settings, export and task admission keep using fresh state and their guards. */
 void browse(CatalogResult result){CatalogSnapshot cached=recentCatalog;long age=android.os.SystemClock.elapsedRealtime()-recentCatalogAt;
  if(cached==null&&prewarming){prewarmWaiters.add(result);return;}if(cached==null||age<0||age>=60000||!cached.catalog.zone.equals(java.time.ZoneId.systemDefault())){catalog(result);return;}
  verifyCatalog(cached,result);
 }
 void verifyCatalog(CatalogSnapshot snapshot,CatalogResult result){CatalogCall call=new CatalogCall(result,false);long owner=call.owner;
  if(snapshot==null){call.done(null,"MATERIAL_UNAVAILABLE");return;}deliverCatalog(owner,snapshot,"",call);
 }
 /** One foreground, account-verified official day read. No MaterialApi,
  * credentials issuance, outbox staging or remote upload is performed here. */
 long readDay(String date,String timezone,CatalogResult result){CatalogCall call=new CatalogCall(result,true);long owner=call.owner;io.execute(()->{
  CatalogSnapshot found=null;String error="";Host107LifelogHttp official=null;OfficialAccountBinding login=null;
  try{
   OfficialLifelogInventory.Request day=OfficialLifelogInventory.Request.day(date,timezone);login=account(owner);final OfficialAccountBinding expected=login;
   official=new Host107LifelogHttp(app,login,()->check(owner),timezone);synchronized(guard){check(owner);officialTransport=official;}
   OfficialLifelogDiscovery.Snapshot fresh=OfficialLifelogDiscovery.read(login.binding,Collections.singletonList(day),()->account(owner),official);
   retainDay(date,timezone,fresh,expected,owner);
   found=loadCatalog(owner);
  }catch(Exception failed){error=safe(failed);
   // A failed source refresh retains the previous verified snapshot. A changed
   // account/cancelled owner may never receive the previous account's content.
   if(login!=null&&!"OFFICIAL_ACCOUNT_CHANGED".equals(error))try{MaterialWire.require(login.same(account(owner)),"OFFICIAL_ACCOUNT_CHANGED");found=loadCatalog(owner);}catch(Exception stale){error=safe(stale);found=null;}
  }finally{if(official!=null){official.close();synchronized(guard){if(officialTransport==official)officialTransport=null;}}}
  deliverCatalog(owner,found,error,call);
 });return owner;}
 private void retainDay(String date,String timezone,OfficialLifelogDiscovery.Snapshot fresh,OfficialAccountBinding expected,long owner)throws Exception{
   synchronized(guard){check(owner);MaterialWire.require(expected.same(account(owner)),"OFFICIAL_ACCOUNT_CHANGED");
    try(MaterialLocalLibrary library=new MaterialLocalLibrary(app.getFilesDir(),expected.binding)){library.recordRead(date,timezone,fresh.sources,System.currentTimeMillis(),()->{check(owner);OfficialAccountBinding now=account(owner);MaterialWire.require(expected.same(now),"OFFICIAL_ACCOUNT_CHANGED");return now.binding;});}
    // Best effort, after the transcript is safely retained.
    if(!fresh.insights.isEmpty())try(LifelogInsightStore store=new LifelogInsightStore(app.getFilesDir(),expected.binding)){store.record(fresh.insights,()->{check(owner);OfficialAccountBinding now=account(owner);MaterialWire.require(expected.same(now),"OFFICIAL_ACCOUNT_CHANGED");return now.binding;});}catch(Exception ignored){}
   }
   try(MaterialVisibility visibility=new MaterialVisibility(app.getFilesDir(),expected.binding)){visibility.readDay(date,timezone,fresh,()->account(owner).binding);}
 }
 /** Only an explicit confirmation of this exact original event reaches here.
  * No retry after an uncertain response; the next day read reconciles the view. */
 void deleteEvent(CatalogSnapshot selected,OfficialLifelogInsight.Event event,String date,String timezone,CatalogResult result){CatalogCall call=new CatalogCall(result,true);long owner=call.owner;io.execute(()->{CatalogSnapshot found=null;String error="";Host107LifelogHttp http=null;try{OfficialAccountBinding login=account(owner);MaterialWire.require(selected!=null&&event!=null&&selected.catalog.account.equals(login.binding),"OFFICIAL_ACCOUNT_CHANGED");OfficialLifelogInventory.Request day=OfficialLifelogInventory.Request.day(date,timezone);http=new Host107LifelogHttp(app,login,()->check(owner),timezone);synchronized(guard){check(owner);officialTransport=http;}
   OfficialLifelogInsight.Event fresh=OfficialLifelogInsight.full(event.id,OfficialLifelogJson.read(http.full(event.id)).canonical);MaterialWire.require(fresh!=null&&fresh.refs.equals(event.refs)&&fresh.start==event.start&&fresh.end==event.end,"LIFELOG_DELETE_SELECTION_CHANGED");
   Map<String,Object> response=WireJson.map(WireJson.read(OfficialLifelogJson.read(http.deleteEvent(event.id)).canonical));MaterialWire.require(Long.valueOf(0).equals(response.get("code")),"LIFELOG_DELETE_REJECTED");MaterialWire.require(login.same(account(owner)),"OFFICIAL_ACCOUNT_CHANGED");
   // Re-read the complete selected day after the acknowledgement. A source may
   // belong to another event; deleting one event must never tombstone that source.
   OfficialLifelogDiscovery.Snapshot after=OfficialLifelogDiscovery.read(login.binding,Collections.singletonList(day),()->account(owner),http);retainDay(date,timezone,after,login,owner);recentCatalog=null;found=loadCatalog(owner);
  }catch(Exception failed){error=safe(failed);}finally{if(http!=null){http.close();synchronized(guard){if(officialTransport==http)officialTransport=null;}}}deliverCatalog(owner,found,error,call);});}
 /** A closed older page must never invalidate a newer read or sync owner. */
 void cancelRead(long owner){synchronized(guard){if(owner==generation)invalidate();}}
 void cancelPending(){invalidate();}
 void configure(byte[] raw,boolean enabled,Result result){long owner=invalidate();byte[] input=raw.clone();work(()->{try{
  OfficialAccountBinding source=account(owner);MaterialConnection next=MaterialConnection.parse(input,System.currentTimeMillis());MaterialConfig candidate=new MaterialConfig(next,source.binding,enabled);if(config!=null)config.replaceAllowed(candidate);
  MaterialHttp http=new MaterialHttp(next);synchronized(guard){check(owner);transport=http;}
  MaterialApi api=new MaterialApi(next,new MaterialApi.Transport(){public MaterialApi.Response exchange(String path,byte[] body)throws IOException{try{MaterialWire.require(source.same(account(owner)),"OFFICIAL_ACCOUNT_CHANGED");}catch(IOException|RuntimeException failure){throw failure;}catch(Exception failure){throw new IOException("OFFICIAL_ACCOUNT_UNAVAILABLE");}return http.exchange(path,body);}public void cancel(){http.cancel();}});
  api.preflight(System.currentTimeMillis(),true);
  synchronized(guard){check(owner);MaterialWire.require(source.same(account(owner)),"OFFICIAL_ACCOUNT_CHANGED");settings.save(candidate);config=candidate;}
  status=DailySummarySync.status(app.getFilesDir(),config);note=enabled?"ready":"paused";
 }finally{Arrays.fill(input,(byte)0);}},result);}
 void pause(Result result){invalidate();work(()->{if(config!=null){settings.save(config.enabled(false));config=settings.load();}status=DailySummarySync.status(app.getFilesDir(),config);note="paused";},result);}
 /** Toggle only the configuration the caller actually saw. Never re-import
  * credentials from a stale UI snapshot after another registration was saved. */
 void setEnabled(String expectedFingerprint,boolean enabled,Result result){long owner=invalidate();work(()->{
  check(owner);MaterialWire.require(config!=null&&config.fingerprint().equals(expectedFingerprint),"MATERIAL_CONNECTION_CHANGED");
  OfficialAccountBinding login=account(owner);MaterialWire.require(config.account.equals(login.binding),"OFFICIAL_ACCOUNT_CHANGED");MaterialConfig original=config;
  if(enabled){MaterialWire.require(original.connection.expiresAt>System.currentTimeMillis(),"MATERIAL_IMPORT_EXPIRED");MaterialHttp http=new MaterialHttp(original.connection);synchronized(guard){check(owner);transport=http;}
   try{new MaterialApi(original.connection,http).preflight(System.currentTimeMillis(),true);}finally{http.cancel();synchronized(guard){if(transport==http)transport=null;}}
  }
  synchronized(guard){check(owner);MaterialWire.require(login.same(account(owner)),"OFFICIAL_ACCOUNT_CHANGED");MaterialConfig latest=settings.load();MaterialWire.require(latest!=null&&latest.fingerprint().equals(expectedFingerprint),"MATERIAL_CONNECTION_CHANGED");settings.save(latest.enabled(enabled));config=settings.load();}
  status=DailySummarySync.status(app.getFilesDir(),config);note=enabled?"ready":"paused";
 },result);}
 void discoverMonth(String month,MonthResult result){long owner=invalidate();io.execute(()->{
  MonthSelection found=null;String error="";Host107LifelogHttp official=null;
  try{
   config=settings.load();check(owner);MaterialWire.require(config!=null&&config.enabled,"MATERIAL_PAUSED");MaterialWire.require(config.connection.expiresAt>System.currentTimeMillis(),"MATERIAL_IMPORT_EXPIRED");
   String fingerprint=config.fingerprint();OfficialAccountBinding login=account(owner);MaterialWire.require(config.account.equals(login.binding),"OFFICIAL_ACCOUNT_CHANGED");
   official=new Host107LifelogHttp(app,login,()->check(owner));synchronized(guard){check(owner);officialTransport=official;}
   OfficialLifelogMonthDiscovery.Snapshot source=OfficialLifelogMonthDiscovery.read(config.account,OfficialLifelogCalendarRequest.month(month),"Asia/Shanghai",()->account(owner),()->check(owner),official::calendar);
   check(owner);MaterialWire.require(config.fingerprint().equals(fingerprint),"MATERIAL_MONTH_SELECTION_STALE");found=new MonthSelection(source,fingerprint,owner);
  }catch(Exception failed){error=safe(failed);}finally{if(official!=null){official.close();synchronized(guard){if(officialTransport==official)officialTransport=null;}}}
  final MonthSelection selected=found;final String code=error;
  // Login reads belong to the IO owner: the host secure store may wait on its
  // own handler. The immutable result retains that account; a later sync must
  // revalidate the live account before any list/full read or upload.
  main.post(()->{if(!code.isEmpty()){result.done(null,code);return;}String deliveryError="";try{check(owner);MaterialWire.require(selected!=null&&config!=null&&selected.configFingerprint.equals(config.fingerprint()),"MATERIAL_MONTH_SELECTION_STALE");}catch(Exception stale){deliveryError=safe(stale);}result.done(deliveryError.isEmpty()?selected:null,deliveryError);});
 });}
 void sync(Result result){sync(null,null,null,null,false,result);}
 void syncDay(String date,String timezone,Result result){sync(date,timezone,null,null,false,result);}
 void syncMonthDays(MonthSelection selected,List<String> days,Result result){sync(null,null,selected,days==null?null:new ArrayList<>(days),true,result);}
 private void sync(String date,String timezone,MonthSelection selected,List<String> chosen,boolean month,Result result){long owner=invalidate();work(()->performSync(owner,date,timezone,selected,chosen,month,null),result);}
 private void performSync(long owner,String date,String timezone,MonthSelection selected,List<String> chosen,boolean month,List<OfficialLifelogInventory.Request> automatic)throws Exception{
  check(owner);MaterialWire.require(config!=null&&config.enabled,"MATERIAL_PAUSED");final MaterialConfig target=config;MaterialWire.require(target.connection.expiresAt>System.currentTimeMillis(),"MATERIAL_IMPORT_EXPIRED");
  List<OfficialLifelogInventory.Request> days=automatic;
  if(month){MaterialWire.require(selected!=null&&selected.owner+1==owner&&selected.configFingerprint.equals(target.fingerprint())&&selected.source.account.equals(target.account),"MATERIAL_MONTH_SELECTION_STALE");days=selected.source.select(chosen);}
  else if(date!=null)days=Collections.singletonList(OfficialLifelogInventory.Request.day(date,timezone));
  final List<OfficialLifelogInventory.Request> selectedDays=days;MaterialHttp http=new MaterialHttp(target.connection);synchronized(guard){check(owner);transport=http;}
  OfficialAccountBinding login=account(owner);MaterialWire.require(target.account.equals(login.binding),"OFFICIAL_ACCOUNT_CHANGED");Host107LifelogHttp official=new Host107LifelogHttp(app,login,()->check(owner),selectedDays==null?"Asia/Shanghai":selectedDays.get(0).timezone);synchronized(guard){check(owner);officialTransport=official;}
  try{
   Set<String> selectedDates=null;if(selectedDays!=null){selectedDates=new HashSet<>();for(OfficialLifelogInventory.Request request:selectedDays)selectedDates.add(request.date);}
   List<DailySummary> summaries=DailySummary.latest(official.latestJournals());MaterialWire.require(login.same(account(owner)),"OFFICIAL_ACCOUNT_CHANGED");
   MaterialApi.Transport guarded=new MaterialApi.Transport(){public MaterialApi.Response exchange(String path,byte[] body)throws IOException{try{MaterialWire.require(login.same(account(owner)),"OFFICIAL_ACCOUNT_CHANGED");MaterialApi.Response response=http.exchange(path,body);MaterialWire.require(login.same(account(owner)),"OFFICIAL_ACCOUNT_CHANGED");return response;}catch(IOException|RuntimeException failure){throw failure;}catch(Exception failure){throw new IOException("OFFICIAL_ACCOUNT_UNAVAILABLE");}}public void cancel(){http.cancel();}};
   note="syncing";status=DailySummarySync.run(app.getFilesDir(),target,summaries,selectedDates,()->check(owner),guarded);note=status.note;
  }finally{official.close();http.cancel();synchronized(guard){if(officialTransport==official)officialTransport=null;if(transport==http)transport=null;}}
 }
 private static AudioSyncSession.Status emptyAudio(){return new AudioSyncSession.Status(Collections.emptyList(),"",0,0,false);}
 private void freshAudio(long owner,AudioConfig expected,MaterialConfig source,OfficialAccountBinding login)throws Exception{
  check(owner);AudioConfig current=new AudioSettings(app).load();MaterialConfig material=settings.load();MaterialWire.require(current!=null&&current.enabled&&expected.fingerprint().equals(current.fingerprint()),"AUDIO_CONNECTION_CHANGED");MaterialWire.require(material!=null&&material.enabled&&source.fingerprint().equals(material.fingerprint()),"AUDIO_MATERIAL_CHANGED");MaterialWire.require(expected.account.equals(login.binding)&&login.same(account(owner)),"OFFICIAL_ACCOUNT_CHANGED");check(owner);
 }
 private void performAudio(long owner,AudioConfig target,MaterialConfig material,boolean recovered,boolean force)throws Exception{throw new IOException("AUDIO_PHONE_ONLY");
 }

 private AudioSnapshot audioSnapshot(long owner)throws Exception{checkView(owner);OfficialAccountBinding login=account(owner);AudioConfig target=new AudioSettings(app).load();if(target!=null&&!target.account.equals(login.binding))throw new IOException("OFFICIAL_ACCOUNT_CHANGED");AudioSyncSession.Status found=emptyAudio();String phase=target==null?"unconfigured":!target.enabled?"paused":target.connection.expiresAt<=System.currentTimeMillis()?"AUDIO_CREDENTIAL_EXPIRED":audioNote.equals("unconfigured")||audioNote.equals("paused")?"ready":audioNote;
  if(target!=null){MaterialConfig material=settings.load();if(material==null||!material.enabled)phase="paused";else if(!target.account.equals(material.account)||!target.connection.binding().equals(material.connection.binding()))phase="AUDIO_SOURCE_TARGET_CHANGED";}
  if(target!=null)try(AudioUploadOutbox queue=new AudioUploadOutbox(app.getFilesDir(),target.connection,target.account,()->checkView(owner))){found=new AudioSyncSession.Status(queue.snapshot(System.currentTimeMillis()),phase,0,0,false);}MaterialWire.require(login.same(account(owner)),"OFFICIAL_ACCOUNT_CHANGED");return new AudioSnapshot(target,found,login.binding,phase);
 }
 private void deliverAudio(long owner,AudioSnapshot snapshot,String error,AudioResult result){main.post(()->io.execute(()->{String code=error;try{checkView(owner);if(snapshot!=null&&snapshot.account!=null)MaterialWire.require(snapshot.account.equals(account(owner).binding),"OFFICIAL_ACCOUNT_CHANGED");}catch(Exception failed){code=safe(failed);}final String failure=code;main.post(()->{String rejected=failure;try{checkView(owner);}catch(Exception stale){rejected=safe(stale);}result.done(rejected.isEmpty()?snapshot:new AudioSnapshot(null,emptyAudio(),null,rejected),rejected);});}));}
 private void audioWork(long owner,Work action,AudioResult result){io.execute(()->{AudioSnapshot snapshot=null;String error="";try{checkView(owner);action.run();snapshot=audioSnapshot(owner);}catch(Exception failed){error=safe(failed);audioNote=error;}deliverAudio(owner,snapshot,error,result);});}
 void readAudio(AudioResult result){long owner=generation;audioWork(owner,()->{},result);}
 private void sameAudioMaterial(long owner,MaterialConfig expected,OfficialAccountBinding login)throws Exception{MaterialConfig latest=settings.load();MaterialWire.require(expected!=null&&latest!=null&&expected.fingerprint().equals(latest.fingerprint())&&login.same(account(owner)),"AUDIO_MATERIAL_CHANGED");}
 private void verifyAudioImport(long owner,AudioConnection connection,MaterialConfig material,OfficialAccountBinding login)throws Exception{MaterialWire.require(material!=null&&material.enabled,"AUDIO_MATERIAL_PAUSED");MaterialWire.require(login.binding.equals(material.account)&&material.connection.binding().equals(connection.binding()),"AUDIO_SOURCE_TARGET_CHANGED");sameAudioMaterial(owner,material,login);AudioHttp http=new AudioHttp(connection);synchronized(guard){check(owner);audioTransport=http;}try{MaterialApi.Response identity=http.exchange("/identity",null);sameAudioMaterial(owner,material,login);if(identity.status!=200)throw new IOException(identity.status==401?"AUDIO_AUTH_REQUIRED":identity.status==403?"AUDIO_SCOPE_REQUIRED":"AUDIO_IDENTITY_UNAVAILABLE");connection.identity(identity.body,System.currentTimeMillis());}finally{http.cancel();synchronized(guard){if(audioTransport==http)audioTransport=null;}}}
 void configureAudio(byte[] raw,boolean enabled,AudioResult result){configureAudio(null,raw,enabled,result);}
 void configureAudio(String expectedAccount,byte[] raw,boolean enabled,AudioResult result){long owner=invalidate();byte[] input=raw.clone();audioWork(owner,()->{try{OfficialAccountBinding login=account(owner);MaterialWire.require(expectedAccount==null||expectedAccount.equals(login.binding),"OFFICIAL_ACCOUNT_CHANGED");MaterialConfig material=settings.load();AudioConnection connection=AudioConnection.parse(input,System.currentTimeMillis());AudioConfig target=new AudioConfig(connection,login.binding,enabled);verifyAudioImport(owner,connection,material,login);sameAudioMaterial(owner,material,login);check(owner);new AudioSettings(app).save(target,()->check(owner));sameAudioMaterial(owner,material,login);audioNote=enabled?"ready":"paused";audioStatus=emptyAudio();}finally{Arrays.fill(input,(byte)0);}},result);}
 void setAudioEnabled(String fingerprint,boolean enabled,AudioResult result){long owner=invalidate();audioWork(owner,()->{AudioSettings saved=new AudioSettings(app);AudioConfig target=saved.load();MaterialWire.require(target!=null&&target.fingerprint().equals(fingerprint),"AUDIO_CONNECTION_CHANGED");OfficialAccountBinding login=account(owner);MaterialWire.require(target.account.equals(login.binding),"OFFICIAL_ACCOUNT_CHANGED");if(enabled){MaterialWire.require(target.connection.expiresAt>System.currentTimeMillis(),"AUDIO_CREDENTIAL_EXPIRED");verifyAudioImport(owner,target.connection,settings.load(),login);}check(owner);AudioConfig latest=saved.load();MaterialWire.require(login.same(account(owner))&&latest!=null&&fingerprint.equals(latest.fingerprint()),"AUDIO_CONNECTION_CHANGED");saved.save(target.enabled(enabled),()->check(owner));MaterialWire.require(login.same(account(owner)),"OFFICIAL_ACCOUNT_CHANGED");audioNote=enabled?"ready":"paused";},result);}
 void syncAudio(AudioResult result){syncAudio(null,result);}
 void syncAudio(String fingerprint,AudioResult result){long owner=invalidate();audioWork(owner,()->{MaterialConfig material=settings.load();AudioConfig target=new AudioSettings(app).load();MaterialWire.require(fingerprint==null||target!=null&&fingerprint.equals(target.fingerprint()),"AUDIO_CONNECTION_CHANGED");performAudio(owner,target,material,true,true);},result);}

}
