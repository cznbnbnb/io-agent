package com.turboio.addon;

import android.app.*;
import android.content.Context;
import android.os.*;
import java.util.*;
import java.util.concurrent.*;

/** One IO owner for registered targets. Every answer action carries its original target binding. */
final class TaskRuntime {
 interface Result {void done(Snapshot snapshot,String error);}
 static final class Snapshot {
  final TaskSettings.Saved saved;final String binding,note,fingerprint;final List<TaskHub.View> contexts;
  Snapshot(TaskHub hub,String note){
   this.note=note;contexts=hub==null?Collections.emptyList():hub.views();TaskProfiles.Profile p=hub==null?null:hub.profiles().selected();binding=p==null?"":p.binding;saved=p==null?null:new TaskSettings.Saved(p.connection,p.enabled);
   List<Object> publicRows=new ArrayList<>();for(TaskHub.View v:contexts)publicRows.add(WireJson.object("binding",v.binding,"preview",v.profile.connection.preview(),"note",v.note,"enabled",v.profile.enabled,"pending",v.pending,"objects",v.objects));
   fingerprint=TaskWire.hash(WireJson.bytes(WireJson.object("selected",binding,"note",note,"contexts",publicRows)));
  }
  TaskHub.View context(String binding){for(TaskHub.View v:contexts)if(v.binding.equals(binding))return v;return null;}
 }
 private static TaskRuntime instance;
 private final Context app;private final TaskSettings settings;
 private final Handler main=new Handler(Looper.getMainLooper());private final ExecutorService io=Executors.newSingleThreadExecutor();
 private final Set<Activity> foreground=Collections.newSetFromMap(new WeakHashMap<Activity,Boolean>());
 private final Map<Result,Activity> observers=new LinkedHashMap<>();
 private final Map<String,TaskHttp> transports=new ConcurrentHashMap<>();private final Set<String> enabled=ConcurrentHashMap.newKeySet();
 private TaskHub hub;private String note="paused";private volatile boolean visible=true;
 private boolean initialized,ticking;private volatile long generation;
 private TaskRuntime(Activity activity){
  app=activity.getApplicationContext();settings=new TaskSettings(app);foreground.add(activity);
  ((Application)app).registerActivityLifecycleCallbacks(new Application.ActivityLifecycleCallbacks(){
   public void onActivityStarted(Activity a){foreground.add(a);visible=true;schedule();}
   public void onActivityStopped(Activity a){foreground.remove(a);visible=!foreground.isEmpty();if(!visible){cancelAll();main.removeCallbacks(tick);}}
   public void onActivityCreated(Activity a,Bundle b){}public void onActivityResumed(Activity a){}public void onActivityPaused(Activity a){}public void onActivitySaveInstanceState(Activity a,Bundle b){}public void onActivityDestroyed(Activity a){foreground.remove(a);observers.values().removeIf(owner->owner==a);}
  });
 }
 static synchronized TaskRuntime get(Activity activity){if(instance==null)instance=new TaskRuntime(activity);else instance.foreground.add(activity);instance.visible=true;return instance;}
 boolean active(Activity activity){return foreground.contains(activity)&&!activity.isFinishing()&&!activity.isDestroyed();}
 void observe(Activity owner,Result observer){observers.put(observer,owner);read(null);}
 void unobserve(Result observer){observers.remove(observer);}
 private void publish(Snapshot snapshot){main.post(()->{AgentCardRuntime.accept(snapshot);for(Map.Entry<Result,Activity> entry:new ArrayList<>(observers.entrySet()))if(observers.containsKey(entry.getKey())&&active(entry.getValue()))entry.getKey().done(snapshot,"");});}
 private Snapshot snapshot(){return new Snapshot(hub,note);}
 private void cancelAll(){for(TaskHttp t:transports.values())t.cancel();}
 private void load()throws Exception{
  if(initialized)return;TaskProfiles profiles=settings.loadAll();final long boundGeneration=generation;enabled.clear();for(TaskProfiles.Profile p:profiles.profiles)if(p.enabled)enabled.add(p.binding);
  hub=new TaskHub(app.getFilesDir(),profiles,c->{final String binding=c.binding();final TaskHttp http=new TaskHttp(c);transports.put(binding,http);return new TaskApi.Transport(){
   public TaskApi.Response exchange(String path,byte[] body)throws java.io.IOException{if(boundGeneration!=generation||!visible||!enabled.contains(binding)||!Host107Login.loggedIn())throw new java.io.IOException("TASK_PAUSED");return http.exchange(path,body);}
   public void cancel(){http.cancel();}
  };});
  note=profiles.profiles.isEmpty()?"unconfigured":"contexts_ready";initialized=true;
 }
 private interface Work {void run()throws Exception;}
 private void work(Work work,Result result){io.execute(()->{String error="";try{load();work.run();}catch(Exception failure){error=TaskApi.safeError(failure);note=error;}Snapshot state=snapshot();publish(state);String code=error;if(result!=null)main.post(()->result.done(state,code));});}
 void read(Result result){work(()->{},result);schedule();}
 void reload(Result result){AgentCardRuntime.pause(null);generation++;cancelAll();work(()->{if(hub!=null)hub.close();hub=null;transports.clear();enabled.clear();initialized=false;load();},result);schedule();}
 void select(String binding,Result result){work(()->{settings.select(binding);hub.apply(settings.loadAll());note="contexts_ready";},result);}
 void pause(String binding,Result result){
  AgentCardRuntime.pause(binding);
  enabled.remove(binding);TaskHttp t=transports.get(binding);if(t!=null)t.cancel();
  work(()->{try{settings.pause(binding);hub.apply(settings.loadAll());note="contexts_ready";}catch(Exception failure){if(hub!=null){TaskHub.View v=hub.view(binding);if(v.profile.enabled)enabled.add(binding);}throw failure;}},result);
 }
 void refresh(Result result){work(()->{TaskWire.require(Host107Login.loggedIn(),"TASK_PAUSED");hub.pump(System.currentTimeMillis());note="contexts_updated";},result);}
 private void bound(String binding){TaskWire.require(Host107Login.loggedIn()&&enabled.contains(binding),"TASK_PAUSED");TaskWire.require(hub!=null&&hub.view(binding)!=null,"TASK_TARGET_CHANGED");}
 void detail(String binding,String kind,String id,Result result){work(()->{bound(binding);hub.detail(binding,kind,id,System.currentTimeMillis());},result);}
 void delegate(String binding,String operation,String command,Result result){work(()->{bound(binding);hub.delegate(binding,operation,command,System.currentTimeMillis());},result);schedule();}
 void answer(String binding,String operation,String request,long revision,Object option,String text,Result result){work(()->{bound(binding);hub.answer(binding,operation,request,revision,option,text,System.currentTimeMillis());},result);schedule();}
 void answerGlasses(String binding,String operation,String request,long revision,Object option,String text,String fingerprint,Result result){work(()->{bound(binding);hub.answerGlasses(binding,operation,request,revision,option,text,fingerprint,System.currentTimeMillis());},result);schedule();}
 void prepareVoice(String binding,String requestId,long revision,String fingerprint,VoiceAnswerSession draft,Result result){work(()->{bound(binding);hub.prepareVoice(binding,requestId,revision,fingerprint,draft,System.currentTimeMillis());},result);}
 void answerVoice(String binding,VoiceAnswerSession draft,Result result){work(()->{bound(binding);boolean fresh=draft.phase().equals("REVIEW");if(fresh)VoiceAnswerEvidence.verify(app.getFilesDir(),draft);hub.answerVoice(binding,draft,System.currentTimeMillis());if(fresh)schedule();},result);}
 private final Runnable tick=()->{
  if(!visible||ticking)return;ticking=true;long owner=generation;io.execute(()->{try{load();if(owner==generation&&visible&&Host107Login.loggedIn())hub.pump(System.currentTimeMillis());}catch(Exception failure){note=TaskApi.safeError(failure);}finally{publish(snapshot());main.post(()->{ticking=false;if(visible){main.removeCallbacks(this.tick);main.postDelayed(this.tick,owner==generation?3000:500);}});}});
 };
 private void schedule(){main.post(()->{if(!ticking){main.removeCallbacks(tick);if(visible)main.postDelayed(tick,500);}});}
}
