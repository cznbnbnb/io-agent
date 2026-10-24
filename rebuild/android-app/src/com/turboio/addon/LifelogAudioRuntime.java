package com.turboio.addon;

import android.content.Context;import android.os.*;
import java.io.*;import java.lang.reflect.*;import java.util.*;import java.util.concurrent.*;

/** Passive durable original-audio capture. Never opens a microphone, changes
 * SDK callbacks, starts/stops a recording, plays audio or uploads data. */
final class LifelogAudioRuntime {
 interface Result {void done(List<Object> sessions,String error);}
 interface Frozen {void done(List<Object> sessions,List<Object> archives,String error);}
 private static volatile LifelogAudioRuntime instance;
 private static final Handler MAIN=new Handler(Looper.getMainLooper());
 private static final class Token {
  final String account,peer,task;final long generation,epoch,checked;
  Token(String account,String peer,String task,long generation,long epoch,long checked){this.account=account;this.peer=peer;this.task=task;this.generation=generation;this.epoch=epoch;this.checked=checked;}
  boolean same(Token other){return other!=null&&account.equals(other.account)&&peer.equals(other.peer)&&task.equals(other.task)&&generation==other.generation;}
 }
 private static final class Event {final Token token;final byte[] raw;final long at,elapsed;Event(Token token,byte[] raw){this.token=token;this.raw=raw.clone();at=System.currentTimeMillis();elapsed=SystemClock.elapsedRealtimeNanos();}}
 private final Context app;private final ScheduledExecutorService io=Executors.newSingleThreadScheduledExecutor(),contextIO=Executors.newSingleThreadScheduledExecutor();private final ArrayDeque<Event> queue=new ArrayDeque<>();
 private volatile Token token;private volatile long blockedEpoch;private volatile Map<String,Object> diagnostics=WireJson.object("phase","IDLE","remote_stored",false);
 private long epoch,lastSave,lastAssociation,lastReceived;private int queuedBytes;private long dropped;private String clock="",owner="",error="",captureError="";private Token active;
 private LifelogAudioLibrary library;private LifelogAudioCollector collector;private boolean retiring;
 private LifelogAudioRuntime(Context context){app=context.getApplicationContext();contextIO.execute(this::pollContext);io.scheduleWithFixedDelay(this::tick,1,200,TimeUnit.MILLISECONDS);}
 static synchronized void boot(Context context){if(instance==null)instance=new LifelogAudioRuntime(context);}
 static void incoming(String peer,byte[] raw){LifelogAudioRuntime self=instance;if(self==null)return;Token bound=self.token;if(bound==null||SystemClock.elapsedRealtime()-bound.checked>3000||raw==null||peer==null||peer.length()>256||!bound.peer.equals(FixedPeerHash.of(peer)))return;
  synchronized(self){if(raw.length>AlwaysOnWire.MAX_BYTES||self.queue.size()>=32||self.queuedBytes+raw.length>2097152){self.dropped++;self.blockedEpoch=bound.epoch;return;}if(self.blockedEpoch==bound.epoch)return;self.queue.add(new Event(bound,raw));self.queuedBytes+=raw.length;}
 }
 private static Object field(Object owner,String name)throws Exception{Field f=owner.getClass().getDeclaredField(name);f.setAccessible(true);return f.get(owner);}
 private void pollContext(){OfficialAccountBinding observed=Host107Login.account();MAIN.post(()->pollNative(observed));}
 private void pollNative(OfficialAccountBinding account){Token candidate=null;try{
  Fixed60Session.Link link=Host107Ota.link();
  if(account!=null&&link.peer!=null&&!link.peer.isEmpty()&&link.generation>0){Object raw=Class.forName("com.rayneo.rayneo_venus_sdk_plugin.e").getField("c").get(null);if(raw instanceof CopyOnWriteArrayList){Object[] listeners=((CopyOnWriteArrayList<?>)raw).toArray();String task=null;int valid=0;
   if(listeners.length<=16)for(Object listener:listeners){if(listener==null||!listener.getClass().getName().equals("t8.b$b"))continue;Object manager=field(field(listener,"a"),"b");if(!manager.getClass().getName().equals("o8.m"))continue;Object config=field(manager,"C");if(config==null)continue;String id=(String)NavReflect.call(config,"getTaskId");
    if(id!=null&&id.matches("[A-Za-z0-9_-]{1,128}")&&id.equals(NavReflect.call(config,"getDialogId"))&&String.valueOf(field(account,"accountId")).equals(NavReflect.call(config,"getUserName"))&&"opus".equals(NavReflect.call(config,"getInputAudioFormat"))&&Integer.valueOf(16000).equals(NavReflect.call(config,"getInputAudioRate"))){task=id;valid++;}}
   if(valid==1)candidate=new Token(account.binding,FixedPeerHash.of(link.peer),task,link.generation,0,SystemClock.elapsedRealtime());
  }}
 }catch(Exception ignored){}Token captured=candidate;contextIO.execute(()->{try{Token verified=captured;if(account==null||!account.same(Host107Login.account())||captured==null||SystemClock.elapsedRealtime()-captured.checked>3000)verified=null;Token previous=token;if(verified==null){if(previous!=null)epoch++;token=null;}else{if(!verified.same(previous))epoch++;token=new Token(verified.account,verified.peer,verified.task,verified.generation,epoch,verified.checked);}}finally{contextIO.schedule(this::pollContext,1000,TimeUnit.MILLISECONDS);}});}

 private boolean current(Token bound){Token now=token;return now!=null&&bound.epoch==now.epoch&&bound.same(now)&&SystemClock.elapsedRealtime()-now.checked<=3000;}
 static void account(String binding)throws IOException{OfficialAccountBinding current=Host107Login.account();LifelogAudioLibrary.require(current!=null&&binding.equals(current.binding),"OFFICIAL_ACCOUNT_CHANGED");}
 private void writerGuard(Token bound)throws IOException{account(bound.account);LifelogAudioLibrary.require(current(bound),"AUDIO_CAPTURE_CONTEXT_CHANGED");}
 private static String code(Throwable e){while(e.getCause()!=null)e=e.getCause();String message=e.getMessage();return message!=null&&message.matches("[A-Z_]{3,90}")?message:"AUDIO_CAPTURE_UNAVAILABLE";}
 private void library(String account)throws IOException{account(account);if(library!=null&&!owner.equals(account)){library.close();library=null;}if(library==null){library=new LifelogAudioLibrary(app.getFilesDir(),account,()->account(account));owner=account;lastAssociation=0;}}
 private void associate()throws IOException{if(library==null)return;long now=SystemClock.elapsedRealtime();if(lastAssociation!=0&&now-lastAssociation<30000)return;lastAssociation=now;try{OfficialAccountBinding before=Host107Login.account();if(before==null||!owner.equals(before.binding))return;Set<String> ids=new HashSet<>();for(String ref:OfficialHiveCache.sourceReferences(OfficialHiveCache.read(before.cacheFile(new File(app.getApplicationInfo().dataDir,"app_flutter")))))if(ref.startsWith("conversation/"))ids.add(ref.substring(13));if(before.same(Host107Login.account()))library.associate(ids,System.currentTimeMillis());}catch(Exception ignored){/* A missing cache never revokes a proven link or deletes audio. */}}
 private Map<String,Object> status(){Map<String,Object> value=collector==null?WireJson.object("phase","IDLE"):collector.snapshot();if(!captureError.isEmpty()){value.put("phase","FAILED");value.put("error",captureError);value.put("rejected_batches",((Number)value.getOrDefault("rejected_batches",0)).longValue()+dropped);}return value;}
 private void save()throws IOException{if(collector!=null&&library!=null){library.update(clock,status(),lastReceived);lastSave=SystemClock.elapsedRealtime();}Map<String,Object> value=status();value.put("account",owner);value.put("clock_epoch",clock);value.put("runtime_error",error);value.put("remote_stored",false);value.put("input_dropped",dropped);diagnostics=WireJson.map(WireJson.copy(value));}
 private void retire(String reason){if(collector==null||retiring)return;retiring=true;LifelogAudioCollector stopping=collector;stopping.stop(reason).whenComplete((result,failed)->io.execute(()->{try{save();}catch(Exception e){error=code(e);}collector=null;active=null;retiring=false;}));}
 private void tick(){try{
  if(retiring)return;if(collector!=null){if(!current(active)){retire("disconnected");return;}if(blockedEpoch==active.epoch){captureError="AUDIO_CAPTURE_QUEUE_FULL";retire("capture_stopped");return;}String phase=(String)collector.snapshot().get("phase");if(!"RUNNING".equals(phase)){blockedEpoch=active.epoch;retire("capture_stopped");return;}}
  for(int n=0;n<32;n++){Event event;synchronized(this){event=queue.poll();if(event!=null)queuedBytes-=event.raw.length;}if(event==null)break;
   try{if(!current(event.token)||blockedEpoch==event.token.epoch)continue;AlwaysOnWire wire=AlwaysOnWire.read(event.raw);if(wire.version!=1||wire.type<0xa3||wire.type>0xa5)continue;
    Map<String,Object> metadata=WireJson.map(WireJson.read(wire.message.getBytes(java.nio.charset.StandardCharsets.UTF_8)));if(!event.token.task.equals(metadata.get("taskId")))continue;
    if(collector==null){library(event.token.account);active=event.token;clock=UUID.randomUUID().toString().replace("-","");captureError="";dropped=0;lastReceived=event.at;library.start(clock,active.peer,active.generation,active.task,event.at);final Token bound=active;collector=LifelogAudioCollector.open(app.getFilesDir(),bound.account,bound.peer,bound.generation,clock,LifelogAudioManager.Limits.standard(),LifelogAudioCollector.Limits.standard(),(p,g)->current(bound),()->writerGuard(bound));}
    lastReceived=event.at;String kind="A"+(wire.type-0xa0);LifelogAudioCollector.Offer accepted=collector.offer(active.peer,active.generation,kind,wire.message,event.raw,event.at,event.elapsed);if(accepted!=LifelogAudioCollector.Offer.QUEUED){error="AUDIO_CAPTURE_WRITE_STOPPED";blockedEpoch=event.token.epoch;break;}
   }finally{Arrays.fill(event.raw,(byte)0);}
  }
  if(library!=null)associate();if(collector!=null&&(lastSave==0||SystemClock.elapsedRealtime()-lastSave>=10000))save();
 }catch(Exception failed){error=code(failed);Token now=token;if(now!=null)blockedEpoch=now.epoch;if(collector!=null){captureError=error;retire("capture_stopped");}diagnostics=WireJson.object("phase","FAILED","runtime_error",error,"remote_stored",false);android.util.Log.w("TurboIOLifelogAudio",error);}}
 static void read(String account,String material,Result result){LifelogAudioRuntime self=instance;if(self==null){result.done(Collections.emptyList(),"AUDIO_CAPTURE_NOT_READY");return;}self.io.execute(()->{try{if(self.active!=null&&!account.equals(self.active.account))throw new IOException("OFFICIAL_ACCOUNT_CHANGED");self.library(account);self.associate();if(self.retiring)throw new IOException("AUDIO_CHECKPOINT_BUSY");if(self.collector!=null)self.save();else self.recoverCatalog(account);List<Object> rows=self.library.selected(material);MAIN.post(()->{try{account(account);result.done(rows,"");}catch(IOException changed){result.done(Collections.emptyList(),code(changed));}});}catch(Exception failed){String error=code(failed);MAIN.post(()->result.done(Collections.emptyList(),error));}});}
 static void freeze(String account,String material,Frozen result){LifelogAudioRuntime self=instance;if(self==null){result.done(Collections.emptyList(),Collections.emptyList(),"AUDIO_CAPTURE_NOT_READY");return;}self.io.execute(()->{try{if(self.active!=null&&!account.equals(self.active.account))throw new IOException("OFFICIAL_ACCOUNT_CHANGED");self.library(account);self.associate();if(self.retiring)throw new IOException("AUDIO_CHECKPOINT_BUSY");
   if(self.collector!=null){self.collector.checkpoint().whenComplete((rows,error)->self.io.execute(()->self.frozen(account,material,rows,error,result)));}
   else self.frozen(account,material,self.recoverCatalog(account),null,result);
  }catch(Exception failed){String error=code(failed);MAIN.post(()->result.done(Collections.emptyList(),Collections.emptyList(),error));}});}
 private void frozen(String account,String material,List<Object> rows,Throwable failure,Frozen result){try{if(failure!=null)throw new IOException(code(failure));account(account);if(collector!=null)save();List<Object> sessions=library.selected(material);MAIN.post(()->{try{account(account);result.done(sessions,rows,"");}catch(IOException changed){result.done(Collections.emptyList(),Collections.emptyList(),code(changed));}});}catch(Exception failed){String error=code(failed);MAIN.post(()->result.done(Collections.emptyList(),Collections.emptyList(),error));}}
 private List<Object> recoverCatalog(String account)throws IOException{String recoveryClock=UUID.randomUUID().toString().replace("-","");List<Object> rows;try(LifelogAudioManager manager=new LifelogAudioManager(app.getFilesDir(),account,LifelogAudioLibrary.hash("read-only-recovery"),1,recoveryClock,LifelogAudioManager.Limits.standard(),()->account(account))){rows=manager.catalog();}library.recover(rows);return rows;}
 /** Fresh official reads and the account-owned local library also carry exact
  * source IDs. Association must not depend on the Flutter page refreshing Hive. */
 static void sources(String account,List<OfficialLifelogSnapshot.Source> sources){LifelogAudioRuntime self=instance;if(self==null)return;Set<String> ids=new HashSet<>();for(OfficialLifelogSnapshot.Source source:sources)if("conversation".equals(source.sourceType))ids.add(source.sourceId);if(ids.isEmpty()||ids.size()>10000)return;self.io.execute(()->{try{account(account);if(self.active!=null&&!account.equals(self.active.account))return;self.library(account);self.library.associate(ids,System.currentTimeMillis());}catch(Exception failed){android.util.Log.w("TurboIOLifelogAudio",code(failed));}});}
}
