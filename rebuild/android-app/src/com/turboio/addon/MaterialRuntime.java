package com.turboio.addon;
import android.app.*;import android.content.*;import android.os.*;
import java.io.*;import java.util.*;import java.util.concurrent.*;

/** Single owner for manual foreground material sync. Backgrounding or pausing
 * immediately fences further reads/sends; committed queue state is retained. */
final class MaterialRuntime {
 interface Result {void done(Snapshot value,String error);}
 interface MonthResult {void done(MonthSelection value,String error);}
 static final class MonthSelection {
  final OfficialLifelogMonthDiscovery.Snapshot source;final String configFingerprint;private final long owner;
  private MonthSelection(OfficialLifelogMonthDiscovery.Snapshot source,String fingerprint,long owner){this.source=source;configFingerprint=fingerprint;this.owner=owner;}
 }
 static final class Snapshot {final MaterialConfig config;final MaterialSyncSession.Status status;final String note;Snapshot(MaterialConfig c,MaterialSyncSession.Status s,String n){config=c;status=s;note=n;}}
 private static MaterialRuntime instance;private final Context app;private final MaterialSettings settings;private final Object guard=new Object();
 private final Handler main=new Handler(Looper.getMainLooper());private final ExecutorService io=Executors.newSingleThreadExecutor(),cancel=Executors.newSingleThreadExecutor();
 private final Set<Activity> foreground=Collections.newSetFromMap(new WeakHashMap<Activity,Boolean>());private volatile boolean visible=true;private volatile long generation;private volatile MaterialHttp transport;
 private volatile Host107LifelogHttp officialTransport;private MaterialConfig config;private MaterialSyncSession.Status status=new MaterialSyncSession.Status();private String note="unconfigured";
 private MaterialRuntime(Activity activity){app=activity.getApplicationContext();settings=new MaterialSettings(app);foreground.add(activity);((Application)app).registerActivityLifecycleCallbacks(new Application.ActivityLifecycleCallbacks(){
  public void onActivityStarted(Activity a){foreground.add(a);visible=true;}public void onActivityStopped(Activity a){foreground.remove(a);visible=!foreground.isEmpty();if(!visible)invalidate();}public void onActivityDestroyed(Activity a){foreground.remove(a);}public void onActivityCreated(Activity a,Bundle b){}public void onActivityResumed(Activity a){}public void onActivityPaused(Activity a){}public void onActivitySaveInstanceState(Activity a,Bundle b){}
 });}
 static synchronized MaterialRuntime get(Activity activity){if(instance==null)instance=new MaterialRuntime(activity);instance.foreground.add(activity);instance.visible=true;return instance;}
 private long invalidate(){synchronized(guard){generation++;MaterialHttp old=transport;transport=null;if(old!=null){old.disable();cancel.execute(old::cancel);}Host107LifelogHttp prior=officialTransport;officialTransport=null;if(prior!=null){prior.disable();cancel.execute(prior::cancel);}return generation;}}
 private void check(long owner)throws IOException{if(owner!=generation||!visible)throw new IOException("MATERIAL_PAUSED");}
 private OfficialAccountBinding account(long owner)throws Exception{check(owner);OfficialAccountBinding account=Host107Login.account();MaterialWire.require(account!=null,"OFFICIAL_LOGIN_REQUIRED");check(owner);return account;}
 private interface Work {void run()throws Exception;}
 private static String safe(Exception error){String code=error.getMessage();return code!=null&&code.matches("[A-Z_]{3,80}")?code:"MATERIAL_UNAVAILABLE";}
 private void counts()throws IOException{MaterialSyncSession.Status next=MaterialSyncSession.status(app.getFilesDir(),config);next.added=status.added;next.conflicts=status.conflicts;next.unowned=status.unowned;next.invalid=status.invalid;next.discovered=status.discovered;next.days=status.days;next.recordings=status.recordings;next.otherEntries=status.otherEntries;next.tooLarge=status.tooLarge;status=next;}
 private void work(Work action,Result result){io.execute(()->{String error="";try{config=settings.load();action.run();}catch(Exception failed){error=safe(failed);note=error;try{counts();}catch(Exception ignored){}}Snapshot snapshot=new Snapshot(config,status,note);String code=error;main.post(()->result.done(snapshot,code));});}
 void read(Result result){work(()->{counts();if(config==null)note="unconfigured";else if(!config.enabled)note="paused";else if(note.equals("unconfigured")||note.equals("paused"))note=status.note;if(config!=null){OfficialAccountBinding current=Host107Login.account();if(current==null||!current.binding.equals(config.account))note="OFFICIAL_ACCOUNT_CHANGED";else if(config.connection.expiresAt<=System.currentTimeMillis())note="MATERIAL_IMPORT_EXPIRED";}},result);}
 void cancelPending(){invalidate();}
 void configure(byte[] raw,boolean enabled,Result result){long owner=invalidate();byte[] input=raw.clone();work(()->{try{
  OfficialAccountBinding source=account(owner);MaterialConnection next=MaterialConnection.parse(input,System.currentTimeMillis());MaterialConfig candidate=new MaterialConfig(next,source.binding,enabled);if(config!=null)config.replaceAllowed(candidate);
  MaterialHttp http=new MaterialHttp(next);synchronized(guard){check(owner);transport=http;}
  MaterialApi api=new MaterialApi(next,new MaterialApi.Transport(){public MaterialApi.Response exchange(String path,byte[] body)throws IOException{try{MaterialWire.require(source.same(account(owner)),"OFFICIAL_ACCOUNT_CHANGED");}catch(IOException|RuntimeException failure){throw failure;}catch(Exception failure){throw new IOException("OFFICIAL_ACCOUNT_UNAVAILABLE");}return http.exchange(path,body);}public void cancel(){http.cancel();}});
  api.preflight(System.currentTimeMillis(),true);
  synchronized(guard){check(owner);MaterialWire.require(source.same(account(owner)),"OFFICIAL_ACCOUNT_CHANGED");settings.save(candidate);config=candidate;}
  status=MaterialSyncSession.status(app.getFilesDir(),config);note=enabled?"ready":"paused";
 }finally{Arrays.fill(input,(byte)0);}},result);}
 void pause(Result result){invalidate();work(()->{if(config!=null){settings.save(config.enabled(false));config=settings.load();}status=MaterialSyncSession.status(app.getFilesDir(),config);note="paused";},result);}
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
 private void sync(String date,String timezone,MonthSelection selected,List<String> chosen,boolean month,Result result){long owner=invalidate();work(()->{
  check(owner);MaterialWire.require(config!=null&&config.enabled,"MATERIAL_PAUSED");final MaterialConfig target=config;MaterialWire.require(target.connection.expiresAt>System.currentTimeMillis(),"MATERIAL_IMPORT_EXPIRED");
  List<OfficialLifelogInventory.Request> days=null;
  if(month){MaterialWire.require(selected!=null&&selected.owner+1==owner&&selected.configFingerprint.equals(target.fingerprint())&&selected.source.account.equals(target.account),"MATERIAL_MONTH_SELECTION_STALE");days=selected.source.select(chosen);}
  else if(date!=null)days=Collections.singletonList(OfficialLifelogInventory.Request.day(date,timezone));
  final List<OfficialLifelogInventory.Request> selectedDays=days;MaterialHttp http=new MaterialHttp(target.connection);synchronized(guard){check(owner);transport=http;}
  OfficialAccountBinding login=account(owner);MaterialWire.require(target.account.equals(login.binding),"OFFICIAL_ACCOUNT_CHANGED");Host107LifelogHttp official=new Host107LifelogHttp(app,login,()->check(owner));synchronized(guard){check(owner);officialTransport=official;}
  try{
   MaterialSyncSession.AccountSource source;
   if(selectedDays!=null){source=new MaterialSyncSession.DiscoverySource(){public OfficialAccountBinding current()throws Exception{return account(owner);}public OfficialLifelogDiscovery.Snapshot discover()throws Exception{return OfficialLifelogDiscovery.read(target.account,selectedDays,this::current,official);}};}else{
   File flutter=new File(app.getApplicationInfo().dataDir,"app_flutter");
   OfficialLifelogRefresh.Ownership ownership=new OfficialLifelogRefresh.Ownership(){public OfficialAccountBinding current()throws Exception{return account(owner);}public Set<String> references()throws Exception{OfficialAccountBinding current=current();return OfficialHiveCache.sourceReferences(OfficialHiveCache.read(current.cacheFile(flutter)));}};
   source=new MaterialSyncSession.FreshSource(){public OfficialAccountBinding current()throws Exception{return ownership.current();}public OfficialLifelogBatch read()throws Exception{return OfficialLifelogBatch.read(flutter,this::current);}public OfficialLifelogRefresh.Fresh refresh(OfficialLifelogBatch observed)throws Exception{return OfficialLifelogRefresh.read(observed,ownership,official);}};}
   MaterialSyncSession session=new MaterialSyncSession(app.getFilesDir(),target,source,()->check(owner),http);note="syncing";status=session.sync();note=status.note;
  }finally{official.close();synchronized(guard){if(officialTransport==official)officialTransport=null;}}
 },result);}
}
