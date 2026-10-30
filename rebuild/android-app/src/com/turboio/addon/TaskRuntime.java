package com.turboio.addon;

import android.app.*;
import android.content.Context;
import android.os.*;
import java.util.*;
import java.util.concurrent.*;

/** One IO owner for registered targets. Every answer action carries its original target binding. */
final class TaskRuntime {
 static {TaskSessionDirectory.elapsedClock(SystemClock::elapsedRealtime);}
 interface Result {void done(Snapshot snapshot,String error);}
 static final class Snapshot {
  final TaskSettings.Saved saved;final String binding,note,device,pairing;final List<TaskHub.View> contexts;
  final TaskSessionDirectory directory;final String directoryNote,defaultBinding,defaultStatus,directoryProducer;final Map<String,Object> defaultRoute,pendingDefault;
  PhonePresence phone;
  private String fingerprint;
  Snapshot(TaskHub hub,String note){this(hub,note,"","");}
  Snapshot(TaskHub hub,String note,String device,String pairing){this(hub,note,device,pairing,null,"DIRECTORY_REFRESH_REQUIRED",null,"");}
  Snapshot(TaskHub hub,String note,String device,String pairing,TaskSessionDirectory directory,String directoryNote,Map<String,Object> pendingDefault,String directoryProducer){
   this.note=note;this.device=device;this.pairing=pairing;contexts=hub==null?Collections.emptyList():hub.views();TaskProfiles.Profile p=hub==null?null:hub.profiles().selected();binding=p==null?"":p.binding;saved=p==null?null:new TaskSettings.Saved(p.connection,p.enabled);
   this.directory=directory;this.directoryNote=directoryNote;this.directoryProducer=directoryProducer;this.pendingDefault=pendingDefault==null?null:WireJson.map(WireJson.copy(pendingDefault));defaultRoute=directory==null?null:directory.defaultRoute();defaultBinding=bindingFor(defaultRoute);
   TaskHub.View chosen=context(defaultBinding);defaultStatus=directory==null?"DIRECTORY_REFRESH_REQUIRED":defaultRoute==null?"DIRECTORY_DEFAULT_MISSING":chosen!=null&&!chosen.profile.enabled?"TASK_PAUSED":chosen==null&&directory.gate(defaultRoute,TaskSessionDirectory.elapsed()).isEmpty()?"TASK_PROFILES_FULL":directory.gate(defaultRoute,TaskSessionDirectory.elapsed());
  }
  String fingerprint(){if(fingerprint==null){
   List<Object> publicRows=new ArrayList<>();for(TaskHub.View v:contexts)publicRows.add(WireJson.object("binding",v.binding,"preview",v.profile.connection.preview(),"note",v.note,"enabled",v.profile.enabled,"inbox_current",v.inboxCurrent,"session_control",v.sessionControl,"pending",v.pending,"objects",v.objects));
   List<Object> directoryRows=new ArrayList<>();if(directory!=null)for(TaskSessionDirectory.Entry e:directory.sessions)directoryRows.add(WireJson.object("route",e.route,"label",e.label,"status",e.status(TaskSessionDirectory.elapsed()),"generation",e.generation));
   fingerprint=TaskWire.hash(WireJson.bytes(WireJson.object("selected",binding,"note",note,"contexts",publicRows,"device",device,"pairing",pairing,"directory",directoryRows,"directory_note",directoryNote,"default",directory==null?null:directory.defaultTarget,"default_status",defaultStatus,"default_pending",this.pendingDefault,"phone",phone==null?"":phone.fingerprint())));
  }return fingerprint;}
  TaskHub.View context(String binding){for(TaskHub.View v:contexts)if(v.binding.equals(binding))return v;return null;}
  String bindingFor(Map<String,Object> route){if(route!=null)for(TaskHub.View v:contexts)if(directory!=null&&v.profile.connection.producer.equals(directoryProducer)&&v.profile.connection.server.equals(directory.server)&&v.profile.connection.owner.equals(directory.owner)&&TaskWire.same(v.profile.connection.route(),route))return v.binding;return "";}
 }
 private static TaskRuntime instance;
 private final Context app;private final TaskSettings settings;
 private final Handler main=new Handler(Looper.getMainLooper());private final ExecutorService io=Executors.newSingleThreadExecutor(),phoneIO=Executors.newSingleThreadExecutor();
 private final Set<Activity> foreground=Collections.newSetFromMap(new WeakHashMap<Activity,Boolean>());
 private final Map<Result,Activity> observers=new LinkedHashMap<>();
 private final Map<String,TaskHttp> transports=new ConcurrentHashMap<>();private final Set<String> enabled=ConcurrentHashMap.newKeySet();
 private volatile PhonePresence phone;
 static boolean glassesAllowed(){TaskRuntime r=instance;PhonePresence p=r==null?null:r.phone;if(p==null||!p.allowed(TaskSessionDirectory.elapsed()))return false;OfficialAccountBinding account=Host107Login.account();return account!=null&&account.binding.equals(p.account);}
 private volatile TaskDevice device;private volatile String pairing="";private long nextDiscovery;private boolean deviceLoaded;
 private volatile TaskInboxWatch inboxWatch;private volatile boolean notificationPending;private boolean readSharedInbox=true,discoveryPending;private String lastInboxSignal="",sampledInboxSignal="";private volatile long nextInboxPoll;private long lastInboxPoll;
 private TaskSessionDirectory directory;private String directoryNote="DIRECTORY_REFRESH_REQUIRED";private long nextDirectory;private Map<String,Object> pendingDefault;
 private TaskHub hub;private String note="paused";private volatile boolean visible=true;
 private boolean initialized,ticking;private volatile long generation;
 private TaskRuntime(Context context,Activity activity){
  app=context.getApplicationContext();settings=new TaskSettings(app);if(activity!=null)foreground.add(activity);else visible=false;
  main.postDelayed(phoneTick,6000);
  ((Application)app).registerActivityLifecycleCallbacks(new Application.ActivityLifecycleCallbacks(){
   public void onActivityStarted(Activity a){foreground.add(a);visible=true;schedule();}
   public void onActivityStopped(Activity a){foreground.remove(a);visible=!foreground.isEmpty();if(!running()){cancelAll();main.removeCallbacks(tick);}}
   public void onActivityCreated(Activity a,Bundle b){}public void onActivityResumed(Activity a){}public void onActivityPaused(Activity a){}public void onActivitySaveInstanceState(Activity a,Bundle b){}public void onActivityDestroyed(Activity a){foreground.remove(a);observers.values().removeIf(owner->owner==a);}
  });
 }
 static synchronized TaskRuntime get(Activity activity){if(instance==null)instance=new TaskRuntime(activity,activity);else instance.foreground.add(activity);instance.visible=true;return instance;}
 /** No screen yet (TurboAddon.boot): runs only while background answering is allowed. */
 static synchronized TaskRuntime boot(Context context){if(instance==null)instance=new TaskRuntime(context,null);return instance;}
 /** On screen, or background answering allowed (TaskAttention): the mailbox keeps exchanging so a
  * question reaches the glasses and a glasses answer is submitted with the screen off. */
 private boolean running(){return visible||TaskAttention.background();}
 boolean active(Activity activity){return foreground.contains(activity)&&!activity.isFinishing()&&!activity.isDestroyed();}
 void observe(Activity owner,Result observer){observers.put(observer,owner);read(null);}
 void unobserve(Result observer){observers.remove(observer);}
 private void publish(Snapshot snapshot){main.post(()->{AgentCardRuntime.accept(snapshot);TurboAddon.pending(snapshot);for(Map.Entry<Result,Activity> entry:new ArrayList<>(observers.entrySet()))if(observers.containsKey(entry.getKey())&&active(entry.getValue()))entry.getKey().done(snapshot,"");});}
 private Snapshot snapshot(){TaskDevice d=device;Snapshot state=new Snapshot(hub,note,d==null?"":d.preview(),pairing,directory,directoryNote,pendingDefault,d==null?"":d.producer);state.phone=phone;return state;}
 private void cancelAll(){for(TaskHttp t:transports.values())t.cancel();TaskInboxWatch watch=inboxWatch;if(watch!=null)watch.close();inboxWatch=null;lastInboxSignal="";nextInboxPoll=0;}
 private void load()throws Exception{
  if(initialized)return;TaskProfiles profiles=settings.loadAll();final long boundGeneration=generation;enabled.clear();for(TaskProfiles.Profile p:profiles.profiles)if(p.enabled)enabled.add(p.binding);
  hub=new TaskHub(app.getFilesDir(),profiles,c->{final String binding=c.binding();final TaskHttp http=new TaskHttp(c);transports.put(binding,http);return new TaskApi.Transport(){
   public TaskApi.Response exchange(String path,byte[] body)throws java.io.IOException{if(boundGeneration!=generation||!running()||!enabled.contains(binding)||!Host107Login.loggedIn())throw new java.io.IOException("TASK_PAUSED");return http.exchange(path,body);}
   public void cancel(){http.cancel();}
  };});
  note=profiles.profiles.isEmpty()?"unconfigured":"contexts_ready";initialized=true;
  if(!deviceLoaded){device=settings.loadDevice();deviceLoaded=true;if(device!=null){try{directory=settings.loadDirectory(device);}catch(Exception invalid){directory=null;directoryNote=TaskApi.safeError(invalid);}try{pendingDefault=settings.defaultRequest(device);}catch(Exception invalid){directoryNote=TaskApi.safeError(invalid);}}}
 }
 private interface Work {void run()throws Exception;}
 private void work(Work work,Result result){io.execute(()->{String error="";try{load();work.run();clearLoginNote();}catch(Exception failure){error=TaskApi.safeError(failure);note=error;}Snapshot state=snapshot();publish(state);String code=error;if(result!=null)main.post(()->result.done(state,code));});}
 private void clearLoginNote(){if(note.startsWith("OFFICIAL_LOGIN_"))note="contexts_updated";}
 /** Login check for user actions. In the minute or two after the stock access token lapses the
  * stock App renews it by itself, so the action waits for that instead of failing at once. */
 private void login()throws Exception{
  if(Host107Login.loggedIn())return;
  Long since=Host107Login.renewingSince(System.currentTimeMillis());TaskWire.require(since!=null,"OFFICIAL_LOGIN_REQUIRED");
  final long owner=generation;note="OFFICIAL_LOGIN_RENEWING";publish(snapshot());
  while(System.currentTimeMillis()<since+Host107Login.RENEW_GRACE_MS){
   TaskWire.require(owner==generation&&running(),"TASK_PAUSED");Thread.sleep(1000);
   if(Host107Login.loggedIn()){clearLoginNote();return;}
  }
  TaskWire.require(false,"OFFICIAL_LOGIN_REQUIRED");
 }
 void read(Result result){work(()->{},result);schedule();}
 void reload(Result result){AgentCardRuntime.pause(null);generation++;cancelAll();work(()->{if(hub!=null)hub.close();hub=null;transports.clear();enabled.clear();initialized=false;load();},result);schedule();}
 /** Retained for old callers; the current authoritative revision is still CAS checked. */
 void select(String binding,Result result){work(()->{TaskWire.require(directory!=null,"DIRECTORY_REFRESH_REQUIRED");setDefaultInternal(hub.view(binding).profile.connection.route(),directory.defaultRevision());},result);}
 void readDirectory(Result result){work(()->{login();refreshDirectory(System.currentTimeMillis());},result);schedule();}
 void ensureTarget(Map<String,Object> route,Result result){final Map<String,Object> frozen=TaskSessionDirectory.route(route);work(()->{
  login();TaskWire.require(device!=null,"DIRECTORY_PAIRING_REQUIRED");TaskWire.require(directory!=null&&directory.find(frozen)!=null,"DIRECTORY_TARGET_MISSING");
  long now=System.currentTimeMillis();if(settings.ensureSession(device,frozen,now,keepBindings(now),onlineBindings(now)))rebuild();
 },result);}
 void setDefault(Map<String,Object> route,long expectedRevision,Result result){final Map<String,Object> frozen=route==null?null:TaskSessionDirectory.route(route);work(()->setDefaultInternal(frozen,expectedRevision),result);schedule();}
 void retryDefault(Result result){work(()->{TaskWire.require(device!=null,"DIRECTORY_PAIRING_REQUIRED");Map<String,Object> request=settings.defaultRequest(device);TaskWire.require(request!=null,"DIRECTORY_DEFAULT_MISSING");setDefaultInternal(request.get("route")==null?null:TaskSessionDirectory.route(request.get("route")),TaskWire.nonnegative(request.get("expected_revision")));},result);}
 private void setDefaultInternal(Map<String,Object> route,long expectedRevision)throws Exception{
  login();TaskWire.require(device!=null,"DIRECTORY_PAIRING_REQUIRED");TaskWire.require(device.expiresAt>System.currentTimeMillis(),"PAIRING_EXPIRED");
  Map<String,Object> request=settings.defaultRequest(device);
  if(request==null){refreshDirectory(System.currentTimeMillis());TaskWire.require(directory.defaultRevision()==expectedRevision,"DEFAULT_REVISION_CONFLICT");if(route!=null){directory.requireExecutable(route,TaskSessionDirectory.elapsed());if(settings.ensureSession(device,route,System.currentTimeMillis(),keepBindings(System.currentTimeMillis()),onlineBindings(System.currentTimeMillis())))rebuild();}
   request=WireJson.object("request_id",UUID.randomUUID().toString(),"expected_revision",expectedRevision,"route",route);settings.saveDefaultRequest(device,request);
  }else TaskWire.require(TaskWire.same(request.get("route"),route)&&TaskWire.nonnegative(request.get("expected_revision"))==expectedRevision,"DIRECTORY_DEFAULT_PENDING");
  pendingDefault=request;
  try{
   Map<String,Object> ack=TaskPairing.setDefault(device,request);
   // Replay ACKs describe the original write. Only a new GET updates the shown default.
   refreshDirectory(System.currentTimeMillis());TaskWire.require(directory.defaultRevision()>=TaskWire.nonnegative(ack.get("revision")),"DIRECTORY_DEFAULT_STALE");
   settings.clearDefaultRequest();pendingDefault=null;
  }catch(Exception failure){if(TaskSessionDirectory.defaultFailureResolved(failure.getMessage())){settings.clearDefaultRequest();pendingDefault=null;}throw failure;}
 }
 // Also reached from the background tick, which must never wait for a renewal.
 private void refreshDirectory(long now)throws Exception{
  if(!Host107Login.loggedIn())TaskWire.require(false,Host107Login.loginCode());TaskWire.require(device!=null,"DIRECTORY_PAIRING_REQUIRED");
  try{TaskSessionDirectory fresh=TaskPairing.directory(device,now);fresh.checkDefaultAgainst(directory);settings.saveDirectory(fresh);directory=fresh;
   List<Map<String,Object>> restored=new ArrayList<>();for(TaskSessionDirectory.Entry e:fresh.sessions)if(e.online)restored.add(e.route);if(settings.syncDevice(device,restored,keepBindings(now),onlineBindings(now),now))rebuild();directoryNote="";nextDirectory=now+15000;
   Map<String,Object> chosen=fresh.defaultRoute();if(chosen!=null&&fresh.find(chosen)!=null)try{if(settings.ensureSession(device,chosen,now,keepBindings(now),onlineBindings(now)))rebuild();}catch(RuntimeException capacity){if(!"TASK_PROFILES_FULL".equals(capacity.getMessage()))throw capacity;directoryNote="TASK_PROFILES_FULL";}
  }catch(Exception failure){directoryNote=TaskApi.safeError(failure);nextDirectory=now+15000;throw failure;}
 }
 void pause(String binding,Result result){
  AgentCardRuntime.pause(binding);
  enabled.remove(binding);TaskHttp t=transports.get(binding);if(t!=null)t.cancel();
  work(()->{try{settings.pause(binding);hub.apply(settings.loadAll());note="contexts_ready";}catch(Exception failure){if(hub!=null){TaskHub.View v=hub.view(binding);if(v.profile.enabled)enabled.add(binding);}throw failure;}},result);
 }
 /** Resume this registration only, after a fresh identity check. The default,
  * other channels and every pending answer retain their original bindings. */
 void resume(String binding,Result result){
  final long owner=generation;
  work(()->{
   TaskWire.require(owner==generation&&running(),"TASK_PAUSED");login();
   TaskProfiles current=settings.loadAll();TaskProfiles.Profile profile=current.get(binding);
   TaskWire.require(Arrays.equals(current.encode(),hub.profiles().encode()),"TASK_TARGET_CHANGED");
   TaskHttp probe=new TaskHttp(profile.connection);
   try{
    new TaskApi(profile.connection,probe).preflight(System.currentTimeMillis());
    TaskWire.require(owner==generation&&running(),"TASK_PAUSED");login();
    settings.resume(current,binding);hub.apply(settings.loadAll());enabled.add(binding);note="contexts_ready";
   }finally{probe.cancel();}
  },result);schedule();
 }
 /** Drops an expired, non-default registration (see TaskProfiles.remove) and reloads the
  * hub, whose channel set must match the profiles; mailbox files stay on disk. */
 void remove(String binding,Result result){AgentCardRuntime.pause(binding);generation++;cancelAll();work(()->{TaskWire.require(!binding.equals(snapshot().defaultBinding),"TASK_TARGET_SELECTED");settings.remove(binding);if(hub!=null)hub.close();hub=null;transports.clear();enabled.clear();initialized=false;load();},result);schedule();}
 void refresh(Result result){work(()->{login();hub.pump(System.currentTimeMillis());note="contexts_updated";},result);}
 private void bound(String binding)throws Exception{login();TaskWire.require(enabled.contains(binding),"TASK_PAUSED");TaskWire.require(hub!=null&&hub.view(binding)!=null,"TASK_TARGET_CHANGED");}
 void receipt(String binding,Map<String,Object> request,String stage){Map<String,Object> frozen=WireJson.map(WireJson.copy(request));work(()->{bound(binding);long now=System.currentTimeMillis();hub.receipt(binding,frozen,stage,now);hub.detail(binding,"request",(String)frozen.get("object_id"),now);},(state,error)->android.util.Log.i("TurboIOCard","receipt "+stage+(error.isEmpty()?" sent":" not sent "+error)));}
 void detail(String binding,String kind,String id,Result result){work(()->{bound(binding);hub.detail(binding,kind,id,System.currentTimeMillis());},result);}
 void delegate(String binding,String operation,String command,Result result){work(()->{bound(binding);hub.delegate(binding,operation,command,System.currentTimeMillis());},result);schedule();}
 void taskControl(String binding,String operation,String task,Map<String,Object> expected,String kind,String text,long expires,Result result){
  final Map<String,Object> frozen=WireJson.map(WireJson.copy(expected));
  work(()->{bound(binding);hub.control(binding,operation,task,frozen,kind,text,System.currentTimeMillis(),expires);},result);schedule();
 }
 void answer(String binding,String operation,String request,long revision,Object option,String text,Result result){work(()->{bound(binding);hub.answer(binding,operation,request,revision,option,text,System.currentTimeMillis());},result);schedule();}
 void answerGlasses(String binding,String operation,String request,long revision,Object option,String text,String fingerprint,Result result){work(()->{bound(binding);hub.answerGlasses(binding,operation,request,revision,option,text,fingerprint,System.currentTimeMillis());},result);schedule();}
 void prepareVoice(String binding,String requestId,long revision,String fingerprint,VoiceAnswerSession draft,Result result){work(()->{bound(binding);hub.prepareVoice(binding,requestId,revision,fingerprint,draft,System.currentTimeMillis());},result);}
 void answerVoice(String binding,VoiceAnswerSession draft,Result result){work(()->{bound(binding);boolean fresh=draft.phase().equals("REVIEW");if(fresh)VoiceAnswerEvidence.verify(app.getFilesDir(),draft);hub.answerVoice(binding,draft,System.currentTimeMillis());if(fresh)schedule();},result);}
 // One-time pairing (TaskDevice, 2026-10-24): renew the device credential in the background and give
 // every newly joined agent session its own derived connection. The hub is rebuilt only when the
 // registry changed (bindings exclude the token, so mailboxes carry over); cards are not paused.
 private void device(long now)throws Exception{
  if(!deviceLoaded){device=settings.loadDevice();deviceLoaded=true;}
  TaskDevice d=device;if(d==null){phone=null;return;}
  String account=pairingAccount(),boundAccount=settings.phoneAccount(d);TaskWire.require(boundAccount.isEmpty()||boundAccount.equals(account),"PHONE_ACCOUNT_MISMATCH");
  if(now>=d.expiresAt){phone=null;pairing="PAIRING_EXPIRED";return;}
  if(d.renewDue(now)){try{d=TaskPairing.renew(d,now);settings.saveDevice(d);device=d;}catch(java.io.IOException failure){pairing=TaskApi.safeError(failure);if(pairing.equals("PAIRING_REVOKED"))return;}}
  if(phone==null){phone=TaskPairing.phone(d,account,null);settings.phoneAccount(d,account);}
  TaskInboxWatch watch=inboxWatch;
  if(watch==null||watch.closed()||!watch.device.token.equals(d.token)){
   if(watch!=null)watch.close();watch=new TaskInboxWatch(d,new TaskHttp(d),()->{notificationPending=true;schedule();});inboxWatch=watch;lastInboxSignal="";nextInboxPoll=0;
  }
  sampledInboxSignal=watch.version();readSharedInbox=!sampledInboxSignal.equals(lastInboxSignal)||now>=nextInboxPoll||!watch.healthy()&&now-lastInboxPoll>=15000;
  List<Map<String,Object>> routes=new ArrayList<>();TaskDevice seen=d;
  if(now>=nextDiscovery&&(readSharedInbox||discoveryPending)){
   nextDiscovery=now+5000;
   for(int page=0;page<5;page++){
    Map<String,Object> p;try{p=TaskPairing.inbox(seen);}catch(java.io.IOException failure){if("CURSOR_RESET_REQUIRED".equals(failure.getMessage())){seen=seen.withCursor("");continue;}pairing=TaskApi.safeError(failure);discoveryPending=true;break;}
    routes.addAll(TaskDevice.openRoutes(p));seen=seen.withCursor(TaskWire.text(p.get("next_cursor"),4096,false));pairing="";discoveryPending=Boolean.TRUE.equals(p.get("has_more"));if(!discoveryPending)break;
   }
  }
  boolean changed=settings.syncDevice(seen,routes,keepBindings(now),onlineBindings(now),now);
  if(seen!=d){settings.saveDevice(seen);device=seen;}
  if(changed)rebuild();
  if(hub.profiles().profiles.size()>=TaskProfiles.MAX)for(Map<String,Object> route:routes){boolean found=false;for(TaskProfiles.Profile p:hub.profiles().profiles)if(TaskWire.same(p.connection.route(),route))found=true;if(!found){pairing="TASK_PROFILES_FULL";break;}}
  if(now>=nextDirectory)try{refreshDirectory(now);}catch(Exception failure){directoryNote=TaskApi.safeError(failure);}
 }
 /** Registrations a full registry must not give up: phone input not yet on the server, questions still
  * waiting for an answer, and the shared default. Delivered history alone never holds a slot. */
 private Set<String> keepBindings(long now){
  Set<String> keep=new HashSet<>();
  if(hub!=null)for(TaskHub.View v:hub.views()){
   if(TaskProfiles.unsent(v.pending)){keep.add(v.binding);continue;}
   try{if(!new TaskPresentation(Collections.singletonList(new TaskPresentation.Source(v.profile,v.objects,v.pending)),now).questions.isEmpty())keep.add(v.binding);}catch(RuntimeException unreadable){keep.add(v.binding);}
  }
  Map<String,Object> route=directory==null?null:directory.defaultRoute();if(route!=null&&device!=null)try{keep.add(device.derive(route,now).binding());}catch(RuntimeException ignored){}
  return keep;
 }
 private Set<String> onlineBindings(long now){
  Set<String> online=new HashSet<>();if(directory!=null&&device!=null)for(TaskSessionDirectory.Entry e:directory.sessions)if(e.online)try{online.add(device.derive(e.route,now).binding());}catch(RuntimeException ignored){}
  return online;
 }
 private void rebuild()throws Exception{generation++;cancelAll();if(hub!=null)hub.close();hub=null;transports.clear();enabled.clear();initialized=false;load();}
 interface SessionPreviewResult {void done(SessionPairingCode.Preview preview,String error);}
 private TaskDevice pairingDevice()throws Exception{
  login();TaskDevice d=settings.loadDevice();TaskWire.require(d!=null,"DIRECTORY_PAIRING_REQUIRED");
  TaskWire.require(d.expiresAt>System.currentTimeMillis(),"PAIRING_EXPIRED");
  if(d.renewDue(System.currentTimeMillis())){d=TaskPairing.renew(d,System.currentTimeMillis());settings.saveDevice(d);device=d;}
  return d;
 }
 private String pairingAccount(){OfficialAccountBinding a=Host107Login.account();TaskWire.require(a!=null,"OFFICIAL_LOGIN_REQUIRED");return a.binding;}
 void previewSession(String input,SessionPreviewResult result){
  final long version=generation;final SessionPairingCode.Preview[] preview={null};
  work(()->{TaskDevice d=pairingDevice();String account=pairingAccount();SessionPairingCode code=SessionPairingCode.parse(input);
   Map<String,Object> body=TaskPairing.session(d,"preview",code.body());TaskWire.require(version==generation&&account.equals(pairingAccount()),"SESSION_PAIRING_IDENTITY_CHANGED");
   preview[0]=new SessionPairingCode.Preview(code,d,account,body);
  },(state,error)->result.done(preview[0],error));
 }
 void approveSession(SessionPairingCode.Preview preview,Result result){
  final long version=generation;work(()->{TaskDevice d=pairingDevice();
   TaskWire.require(version==generation&&preview.deviceId.equals(d.deviceId)&&preview.owner.equals(d.owner)&&preview.account.equals(pairingAccount()),"SESSION_PAIRING_IDENTITY_CHANGED");
   TaskWire.require(preview.expires>System.currentTimeMillis(),"PAIRING_EXPIRED");
   Map<String,Object> ack=TaskPairing.session(d,"approve",preview.code.body());
   TaskWire.require(preview.code.id.equals(ack.get("id"))&&Boolean.TRUE.equals(ack.get("approved")),"SESSION_PAIRING_INVALID");
   TaskWire.require(version==generation&&preview.account.equals(pairingAccount()),"SESSION_PAIRING_IDENTITY_CHANGED");nextDiscovery=0;
  },result);schedule();
 }
 void makePrimary(long revision,Result result){work(()->{TaskDevice d=pairingDevice();String account=pairingAccount();phone=TaskPairing.phone(d,account,revision);settings.phoneAccount(d,account);nextDiscovery=0;},result);schedule();}
 void pair(String code,Result result){work(()->{
  login();long now=System.currentTimeMillis();
  String account=pairingAccount();TaskDevice d=TaskPairing.pair(code,account,now);TaskWire.require(account.equals(pairingAccount()),"SESSION_PAIRING_IDENTITY_CHANGED");settings.saveDevice(d);settings.phoneAccount(d,account);phone=null;device=d;deviceLoaded=true;directory=null;pendingDefault=null;pairing="";nextDiscovery=0;nextDirectory=0;device(now);note="contexts_ready";
 },result);schedule();}
 /** Unpairs this phone on the server, forgets the credential and pauses the derived connections. */
 void unpairDevice(Result result){work(()->{
  TaskDevice d=settings.loadDevice();if(d!=null){TaskPairing.unpair(d);settings.clearDevice();settings.pauseDevice(d);}
  phone=null;device=null;deviceLoaded=true;directory=null;pendingDefault=null;settings.clearDefaultRequest();directoryNote="DIRECTORY_PAIRING_REQUIRED";pairing="";rebuild();note="contexts_ready";
 },result);}
 private boolean phoneBusy;
 private final Runnable phoneTick=new Runnable(){public void run(){
  if(running()&&!phoneBusy&&device!=null){phoneBusy=true;TaskDevice d=device;phoneIO.execute(()->{try{
   String account=pairingAccount(),bound=settings.phoneAccount(d);TaskWire.require(bound.isEmpty()||bound.equals(account),"PHONE_ACCOUNT_MISMATCH");
   PhonePresence next=TaskPairing.phone(d,account,null);TaskDevice current=device;
   if(current!=null&&current.deviceId.equals(d.deviceId)&&account.equals(pairingAccount())){PhonePresence prior=phone;phone=next;if(next.allowed(TaskSessionDirectory.elapsed())&&(prior==null||!prior.allowed(TaskSessionDirectory.elapsed()))){nextInboxPoll=0;notificationPending=true;schedule();}}
  }catch(Exception unavailable){phone=null;}finally{main.post(()->{phoneBusy=false;});}});}
  main.postDelayed(this,6000);
 }};
 private final Runnable tick=()->{
  if(!running()||ticking)return;ticking=true;notificationPending=false;long owner=generation;io.execute(()->{try{load();if(owner==generation&&running()&&Host107Login.loggedIn()){clearLoginNote();long now=System.currentTimeMillis();try{device(now);}catch(Exception failure){phone=null;pairing=TaskApi.safeError(failure);}hub.pump(now,device,readSharedInbox);if(readSharedInbox){lastInboxPoll=now;lastInboxSignal=sampledInboxSignal;nextInboxPoll=now+(inboxWatch!=null&&inboxWatch.healthy()?60000:15000);}if(device!=null)NativeTodoRuntime.wake(TaskRuntime.this.app,device,()->owner==generation&&running()&&glassesAllowed());}}catch(Exception failure){note=TaskApi.safeError(failure);}finally{publish(snapshot());main.post(()->{ticking=false;if(running()){main.removeCallbacks(this.tick);main.postDelayed(this.tick,owner!=generation||notificationPending?500:visible||TaskAttention.active()?3000:10000);}});}});
 };
 private void schedule(){main.post(()->{if(!ticking){main.removeCallbacks(tick);if(running())main.postDelayed(tick,500);}});}
}
