package com.turboio.addon;

import android.content.Context;
import android.os.SystemClock;
import java.io.*;
import java.lang.reflect.*;
import java.nio.channels.*;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.*;

/** Passive normal-process observer. No SDK start/stop, mic, decoder, playback or
 * network. Callback copies at most 64 KiB into a 32-batch/2 MiB memory budget. */
public final class LifelogAudioObservationRuntime {
 private static volatile LifelogAudioObservationRuntime instance;
 private static final class Event {final String peer;final byte[] raw;final long at;Event(String peer,byte[] raw){this.peer=peer;this.raw=raw.clone();at=System.currentTimeMillis();}}
 private final Context app;private final ScheduledExecutorService io=Executors.newSingleThreadScheduledExecutor();private final ArrayDeque<Event> queue=new ArrayDeque<>();
 private final LifelogAudioObservation model=new LifelogAudioObservation(UUID.randomUUID().toString().replace("-",""));
 private int outstanding,queuedBytes;private long dropped,lastRefresh,lastSave,contextAt,lastErrorLog;private boolean dirty=true;private AtomicDocument journal;private String account="",error="",stage="initial";private Set<String> conversations,cachedIds;private String cachedAccount="";private long cachedLength=-1,cachedModified=-1;private Map<String,Object> nativeContext=WireJson.object("available",false);
 private LifelogAudioObservationRuntime(Context context){app=context.getApplicationContext();io.scheduleWithFixedDelay(this::tick,1,200,TimeUnit.MILLISECONDS);}
 static synchronized void boot(Context context){if(instance==null)instance=new LifelogAudioObservationRuntime(context);LifelogAudioRuntime.boot(context);}
 public static void incoming(String peer,byte[] raw){
  try{LifelogAudioRuntime.incoming(peer,raw);}catch(RuntimeException ignored){}
  LifelogAudioObservationRuntime self=instance;if(self==null)return;
  synchronized(self){if(peer==null||peer.length()>256||raw==null||raw.length>AlwaysOnWire.MAX_BYTES||self.outstanding>=32||self.queuedBytes+raw.length>2097152){self.dropped++;return;}self.queue.add(new Event(peer,raw));self.outstanding++;self.queuedBytes+=raw.length;}
 }
 private static Object field(Object owner,String name)throws Exception{Field f=owner.getClass().getDeclaredField(name);f.setAccessible(true);return f.get(owner);}
 private void refresh(long now){
  account="";conversations=null;contextAt=0;nativeContext=WireJson.object("available",false);lastRefresh=now;
  try{
   OfficialAccountBinding before=Host107Login.account();if(before==null)return;
   Set<String> ids=new HashSet<>();File flutter=new File(app.getApplicationInfo().dataDir,"app_flutter");boolean cacheAvailable=false;
   try{File cache=before.cacheFile(flutter);long length=cache.length(),modified=cache.lastModified();if(before.binding.equals(cachedAccount)&&cachedIds!=null&&length==cachedLength&&modified==cachedModified)ids.addAll(cachedIds);else{for(String ref:OfficialHiveCache.sourceReferences(OfficialHiveCache.read(cache)))if(ref.startsWith("conversation/"))ids.add(LifelogAudioObservation.hash(ref.substring("conversation/".length())));cachedAccount=before.binding;cachedLength=length;cachedModified=modified;cachedIds=new HashSet<>(ids);}cacheAvailable=true;}catch(Exception unavailable){cachedIds=null;cachedAccount="";/* No cache does not prove absence or deletion. */}
   List<Object> contexts=new ArrayList<>();Object listeners=Class.forName("com.rayneo.rayneo_venus_sdk_plugin.e").getField("c").get(null);
   if(listeners instanceof java.util.concurrent.CopyOnWriteArrayList){Object[] values=((java.util.concurrent.CopyOnWriteArrayList<?>)listeners).toArray();if(values.length<=16)for(Object listener:values){if(listener==null||!listener.getClass().getName().equals(Host107Abi.className("t8.b$b")))continue;Object manager=field(field(listener,"a"),"b");if(!manager.getClass().getName().equals(Host107Abi.className("o8.m")))continue;Object config=field(manager,"C");Map<String,Object> observed=WireJson.object("config_present",config!=null,"session_origin_verified",false);
    if(config!=null){String task=(String)NavReflect.call(config,"getTaskId"),dialog=(String)NavReflect.call(config,"getDialogId"),user=(String)NavReflect.call(config,"getUserName"),format=(String)NavReflect.call(config,"getInputAudioFormat");Object id=field(before,"accountId");observed.put("username_equals_account_id",String.valueOf(id).equals(user));observed.put("task_equals_dialog",Objects.equals(task,dialog));observed.put("input_format",Arrays.asList("opus","pcm").contains(format)?format:"other");observed.put("input_rate",NavReflect.call(config,"getInputAudioRate"));if(task!=null&&!task.isEmpty()&&task.length()<=512){String hash=LifelogAudioObservation.hash(task);observed.put("task_sha256",hash);observed.put("exact_conversation_cache_match",cacheAvailable?ids.contains(hash):null);}}
    contexts.add(observed);
   }}
   if(!before.same(Host107Login.account()))return;account=before.binding;contextAt=System.currentTimeMillis();conversations=cacheAvailable?ids:null;nativeContext=WireJson.object("available",true,"contexts",contexts,"observation_only",true,"session_origin_verified",false);
  }catch(Exception unavailable){account="";conversations=null;contextAt=0;}
 }
 private void tick(){
  try{
   boolean pending;synchronized(this){pending=!queue.isEmpty()||dropped>0;}long now=SystemClock.elapsedRealtime();
   if(pending&&(lastRefresh==0||now-lastRefresh>=10000))refresh(now);
   for(int i=0;i<32;i++){Event event;long lost;synchronized(this){event=queue.poll();lost=dropped;dropped=0;}if(lost>0){model.dropped(lost);dirty=true;}if(event==null)break;
    try{model.accept(event.peer,event.raw,event.at,account,contextAt,conversations);dirty=true;}finally{synchronized(this){outstanding--;queuedBytes-=event.raw.length;}}
   }
   if(dirty&&(lastSave==0||now-lastSave>=30000)){lastSave=now;save();dirty=false;}
  }catch(Exception failed){String message=failed.getMessage();error=message!=null&&message.matches("[A-Z_]{3,90}")?message:"AUDIO_OBSERVATION_UNAVAILABLE";long at=SystemClock.elapsedRealtime();if(lastErrorLog==0||at-lastErrorLog>=60000){lastErrorLog=at;android.util.Log.w("TurboIOLifelogObserver",error+" stage="+stage+" class="+failed.getClass().getSimpleName());}}
 }
 private void save()throws IOException{
  stage="path";File file=LifelogObservationPath.file(app.getFilesDir());
  stage="open";if(journal==null)journal=new AtomicDocument(file,65536);Map<String,Object> snapshot=model.snapshot();snapshot.put("native_context",nativeContext);snapshot.put("error",error);stage="save";journal.save(snapshot);
  stage="directory_sync";try(FileChannel directory=FileChannel.open(file.getParentFile().toPath(),StandardOpenOption.READ)){directory.force(true);}
  android.util.Log.i("TurboIOLifelogObserver","metadata saved packets="+snapshot.get("packets")+" kinds="+snapshot.get("kinds")+" dropped="+snapshot.get("dropped_packets"));stage="ready";List<Object> samples=WireJson.list(snapshot.get("samples"));if(!samples.isEmpty()){byte[] last=WireJson.bytes(samples.get(samples.size()-1));if(last.length<=2048)android.util.Log.i("TurboIOLifelogObserver","latest metadata "+new String(last,java.nio.charset.StandardCharsets.UTF_8));}
 }
}
