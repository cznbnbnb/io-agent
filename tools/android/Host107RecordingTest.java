package com.turboio.addon;

import android.os.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.*;
import java.util.function.BooleanSupplier;

/** Production adapter with deterministic main looper and SDK/idle doubles.
 * No Bluetooth, real SDK, microphone, recorded voice or physical stop claim. */
final class Host107RecordingTest {
 public static void main(String[] args)throws Exception{VoiceCaptureCutoffTest.run();run();System.out.println("Recording recovery boundaries: "+VoiceAnswerTest.checks+" assertions passed");}
 static void yes(boolean value){VoiceAnswerTest.yes(value);}
 static void waitFor(BooleanSupplier done)throws Exception{
  long end=System.nanoTime()+TimeUnit.SECONDS.toNanos(3);
  do{Handler.drain();if(done.getAsBoolean())return;Thread.sleep(2);}while(System.nanoTime()<end);
  throw new AssertionError("Recording adapter did not drain");
 }
 static boolean emit(String peer,Object business,int type,Object json,byte[] binary){return Host107Recording.observe("messageReceived",WireJson.object("message",WireJson.object("deviceId",peer,"businessId",business,"payload",OtaFrame.encode(type,json,binary))));}
 static Map<String,Object> version(){return WireJson.object("OsVersion","Strix OS 1.0.5.5","OtaValidationState","idle","OtaValidationConfirmed",true,"PackageTypes",Arrays.asList("files"));}
 static final class Sink implements Host107Recording.Receiver {
  final List<String> events=new CopyOnWriteArrayList<>();volatile byte[] bytes;volatile CountDownLatch entered,unblock;volatile boolean ignoreInterrupt;volatile long completedGeneration;
  public void frame(String peer,long gen,byte[] frame){bytes=frame;events.add("frame:"+peer+":"+gen);if(entered!=null){entered.countDown();boolean interrupted=false;while(unblock.getCount()!=0)try{unblock.await();}catch(InterruptedException e){interrupted=true;if(!ignoreInterrupt)break;}if(interrupted)Thread.currentThread().interrupt();}completedGeneration=gen;}
  public void sent(int type,boolean ok,long at){events.add("sent:"+type+":"+ok);}
  public void noStart(long at){events.add("no-start");}
  public void ready(boolean ready,long at){events.add("ready:"+ready);}
  public void idle(boolean idle,long at){events.add("idle:"+idle);}
  public void fault(String code){events.add(code);}
 }
 static final class Env implements AutoCloseable {
  final VoiceAnswerSession draft;final VoiceCaptureCutoff cutoff;final Sink sink=new Sink();final Host107Recording owner;
  Env()throws Exception{this(new VoiceAnswerTest.Memory());}
  Env(VoiceAnswerSession.Store store)throws Exception{
   yes(NativeTransfer.owner.isEmpty());RecordingPlatform.messages.clear();RecordingPlatform.autoQueue=true;Host107Ota.peer=VoiceAnswerTest.PEER;Host107Ota.generation=1;
   draft=VoiceAnswerTest.prepared(store,VoiceAnswerTest.connection("recording-host"));
   AtomicReference<Host107Recording> reference=new AtomicReference<>();
   cutoff=new VoiceCaptureCutoff(SystemClock::elapsedRealtime,(token,peer,generation)->reference.get().deadlineStop(token,peer,generation));
   owner=Host107Recording.acquire(draft,cutoff,sink);yes(owner!=null);reference.set(owner);
  }
  void ready()throws Exception{
   owner.inspect();yes(RecordingPlatform.messages.size()==2);
   for(RecordingPlatform.Message m:new ArrayList<>(RecordingPlatform.messages))m.receipt(true);
   yes(!emit(VoiceAnswerTest.PEER,9,1,version(),null));yes(!emit(VoiceAnswerTest.PEER,"MARS_FOTA",11,WireJson.object("Result",true),null));
   waitFor(()->sink.events.contains("ready:true"));
  }
  void arm()throws Exception{long now=SystemClock.elapsedRealtime();yes(cutoff.arm(draft.token(),FixedPeerHash.of(VoiceAnswerTest.PEER),1,now+15000));yes(draft.arm(VoiceAnswerTest.PEER,1,now,15,cutoff));}
  void start()throws Exception{ready();arm();owner.begin();RecordingPlatform.last("RECORDING_SERVICE",14).receipt(true);Handler.drain();yes(RecordingPlatform.sent("RECORDING_SERVICE",1).size()==1);RecordingPlatform.last("RECORDING_SERVICE",1).receipt(true);waitFor(()->sink.events.contains("sent:1:true"));}
  void proveStopped()throws Exception{
   // The SDK receipt and fresh idle here are intentionally test doubles. They
   // exercise the required distinct facts rather than treating send as stop.
   owner.stop();Handler.drain();yes(!RecordingPlatform.sent("RECORDING_SERVICE",4).isEmpty());
   RecordingPlatform.last("RECORDING_SERVICE",4).receipt(true);Handler.drain();owner.inspectIdle();
   RecordingPlatform.last("MARS_FOTA",11).receipt(true);emit(VoiceAnswerTest.PEER,9,11,WireJson.object("Result",true),null);
   waitFor(()->sink.events.contains("idle:true"));long now=SystemClock.elapsedRealtime();
   yes(draft.stop(draft.token(),now,false));yes(draft.stopSubmitted(draft.token(),VoiceAnswerTest.PEER,1,now));
   yes(draft.engineEnd(draft.token(),now));yes(draft.engineStopped(draft.token(),true));
   VoiceAnswerSession.StopProbe probe=draft.probeStop(VoiceAnswerTest.PEER,1,now);yes(draft.deviceIdle(probe,VoiceAnswerTest.PEER,1,now,true));yes(draft.finish());
  }
  public void close()throws Exception{
   if(sink.unblock!=null)sink.unblock.countDown();
   if(draft.needsStop())proveStopped();
   waitFor(()->draft.phase().equals("PREPARED")?owner.releasePrepared():owner.release());
   cutoff.close();yes(NativeTransfer.owner.isEmpty());
  }
 }
 static void run()throws Exception{
  // Busy/preflight failure never schedules recording; other owner's messages pass.
  try(Env e=new Env()){
   yes(Host107Recording.acquire(e.draft,e.cutoff,e.sink)==null);
   VoiceAnswerTest.rejects(e.owner::begin);
   e.owner.inspect();for(RecordingPlatform.Message m:RecordingPlatform.messages)m.receipt(true);
   emit(VoiceAnswerTest.PEER,9,1,version(),null);emit(VoiceAnswerTest.PEER,9,11,WireJson.object("Result",false),null);
   waitFor(()->e.sink.events.contains("VOICE_PREFLIGHT_NOT_IDLE_OR_VALIDATED"));
   yes(RecordingPlatform.sent("RECORDING_SERVICE",1).isEmpty()&&RecordingPlatform.sent("RECORDING_SERVICE",4).isEmpty());
   yes(!e.draft.needsStop());
  }
  // A queued old observation in the same millisecond cannot satisfy a new query.
  try(Env e=new Env()){
   emit(VoiceAnswerTest.PEER,9,1,version(),null);emit(VoiceAnswerTest.PEER,9,11,WireJson.object("Result",true),null);
   e.owner.inspect();Handler.drain();yes(!e.sink.events.contains("ready:true"));
   SystemClock.advance(8000);Handler.drain();waitFor(()->e.sink.events.contains("VOICE_PREFLIGHT_TIMEOUT"));
   yes(RecordingPlatform.sent("RECORDING_SERVICE",1).isEmpty());
  }
  // Valid query is still short-lived. Expired preflight does not start a mic.
  try(Env e=new Env()){
   e.ready();SystemClock.advance(8000);e.arm();VoiceAnswerTest.rejects(e.owner::begin);
   yes(RecordingPlatform.sent("RECORDING_SERVICE",1).isEmpty());
  }
  // Deadline/cancel while enable ACK is in flight must fence the late start.
  try(Env e=new Env()){
   e.ready();e.arm();e.owner.begin();RecordingPlatform.Message enable=RecordingPlatform.last("RECORDING_SERVICE",14);
   e.owner.deadlineStop(e.draft.token(),FixedPeerHash.of(VoiceAnswerTest.PEER),1);Handler.drain();
   yes(RecordingPlatform.sent("RECORDING_SERVICE",4).size()==1);enable.receipt(true);enable.receipt(true);Handler.drain();
   yes(RecordingPlatform.sent("RECORDING_SERVICE",1).isEmpty());yes(!e.owner.releasePrepared()&&!e.owner.release()&&e.draft.needsStop());
   VoiceAnswerTest.rejects(e.owner::inspectIdle); // queued stop alone is not acceptance
   RecordingPlatform.last("RECORDING_SERVICE",4).receipt(true);Handler.drain();
   emit(VoiceAnswerTest.PEER,9,11,WireJson.object("Result",true),null);e.owner.inspectIdle();Handler.drain();yes(!e.sink.events.contains("idle:true"));
   emit(VoiceAnswerTest.OTHER,9,11,WireJson.object("Result",true),null);Handler.drain();yes(!e.sink.events.contains("idle:true"));
   emit(VoiceAnswerTest.PEER,9,11,WireJson.object("Result",false),null);waitFor(()->e.sink.events.contains("idle:false"));yes(e.draft.needsStop());
  }
  // Exact integer business/UUID/peer; immutable payload before the worker reads it.
  try(Env e=new Env()){
   e.start();Object body=WireJson.object("uuid",e.draft.token(),"offset",0);
   yes(!emit(VoiceAnswerTest.PEER,14.5,3,body,new byte[]{1}));
   yes(!emit(VoiceAnswerTest.OTHER,14,3,body,new byte[]{1}));
   yes(!emit(VoiceAnswerTest.PEER,14,3,WireJson.object("uuid","ordinary-stock-record","offset",0),new byte[]{1}));
   byte[] bytes=OtaFrame.encode(3,body,new byte[]{42}),original=bytes.clone();
   yes(Host107Recording.observe("messageReceived",WireJson.object("message",WireJson.object("deviceId",VoiceAnswerTest.PEER,"businessId",14,"payload",bytes))));Arrays.fill(bytes,(byte)0);
   waitFor(()->e.sink.bytes!=null&&e.sink.events.contains("frame:"+VoiceAnswerTest.PEER+":1"));yes(Arrays.equals(original,e.sink.bytes));
   yes(e.sink.events.contains("frame:"+VoiceAnswerTest.PEER+":1"));
  }
  // Saturated transcription/storage worker cannot prevent the main SDK stop.
  try(Env e=new Env()){
   e.start();e.sink.entered=new CountDownLatch(1);e.sink.unblock=new CountDownLatch(1);
   Object body=WireJson.object("uuid",e.draft.token(),"offset",0);
   emit(VoiceAnswerTest.PEER,14,3,body,new byte[]{1});Handler.drain();yes(e.sink.entered.await(1,TimeUnit.SECONDS));
   for(int i=0;i<40;i++)emit(VoiceAnswerTest.PEER,14,3,body,new byte[]{1});
   Handler.drain();yes(RecordingPlatform.sent("RECORDING_SERVICE",4).size()==1);yes(e.draft.needsStop()&&!e.owner.release());
   e.sink.unblock.countDown();waitFor(()->e.sink.events.contains("VOICE_RECORDING_BACKPRESSURE"));
  }
  // At actual SDK admission, a saved but delayed start remains revoked after stop
  // and even after owner release. Recreating equal payload does not grant identity.
  RecordingPlatform.Message late;
  try(Env e=new Env()){
   e.ready();e.arm();e.owner.begin();RecordingPlatform.Message enable=RecordingPlatform.last("RECORDING_SERVICE",14);
   yes(enable.queued&&!enable.queue());RecordingPlatform.autoQueue=false;enable.receipt(true);Handler.drain();
   late=RecordingPlatform.last("RECORDING_SERVICE",1);yes(!late.queued);
   for(String business:Arrays.asList("RECORDING_SERVICE","VOICE_ASSISTANT","AI_SUBTITLE","TELEPROMPTER"))yes(!Host107Recording.allowQueue(new Object(),business,VoiceAnswerTest.PEER,late.bytes));
   yes(Host107Recording.allowQueue(new Object(),"HEARTBEAT",VoiceAnswerTest.PEER,new byte[0]));
   RecordingPlatform.autoQueue=true;e.owner.stop();yes(!late.queue());
   // A late start acknowledgement is cleanup, not a new microphone start.
   e.owner.acknowledge(1);yes(RecordingPlatform.last("RECORDING_SERVICE",1).queued);
  }
  yes(!late.queue());yes(Host107Recording.allowQueue(new Object(),"RECORDING_SERVICE",VoiceAnswerTest.PEER,late.bytes));
  delayedAdmission();blockedJournalAdmission();recovery();recoveryDelayedStop();
 }
 static void delayedAdmission()throws Exception{
  // Queue admission may happen after reconnect but before the runtime receives
  // its disconnect callback. An unchanged active pointer is not authority.
  for(String changed:Arrays.asList("generation","lease","durable-generation","durable-phase"))try(Env e=new Env()){
   e.ready();e.arm();RecordingPlatform.autoQueue=false;e.owner.begin();
   RecordingPlatform.Message delayed=RecordingPlatform.last("RECORDING_SERVICE",14);String lease=NativeTransfer.owner;
   if(changed.equals("generation"))Host107Ota.generation=2;
   else if(changed.equals("lease"))NativeTransfer.owner="another-owner";
   else{yes(e.draft.stop(e.draft.token(),SystemClock.elapsedRealtime(),false));if(changed.equals("durable-generation"))yes(e.draft.resumeCleanup(VoiceAnswerTest.PEER,2,SystemClock.elapsedRealtime()));}
   yes(!delayed.queue()&&!delayed.queued);
   if(changed.equals("durable-generation"))yes(e.draft.resumeCleanup(VoiceAnswerTest.PEER,1,SystemClock.elapsedRealtime()));
   Host107Ota.generation=1;NativeTransfer.owner=lease;RecordingPlatform.autoQueue=true;
  }
 }
 static final class BlockingStore implements VoiceAnswerSession.Store {
  Object value;volatile boolean block,fail;final CountDownLatch entered=new CountDownLatch(1),release=new CountDownLatch(1);
  public Object read(){return value==null?null:WireJson.copy(value);}
  public void save(Object next)throws Exception{if(block){entered.countDown();release.await();}if(fail)throw new java.io.IOException("synthetic journal failure");value=WireJson.copy(next);}
 }
 static void blockedJournalAdmission()throws Exception{
  BlockingStore store=new BlockingStore();AtomicReference<Throwable> failed=new AtomicReference<>();
  try(Env e=new Env(store)){
   e.ready();e.arm();RecordingPlatform.autoQueue=false;e.owner.begin();RecordingPlatform.Message opening=RecordingPlatform.last("RECORDING_SERVICE",14);String token=e.draft.token();
   store.block=true;Thread writer=new Thread(()->{try{e.draft.result(token,VoiceAnswerTest.PEER,1,1,1,"合成尚未提交正文",false,SystemClock.elapsedRealtime());}catch(Throwable t){failed.set(t);}});writer.setDaemon(true);writer.start();yes(store.entered.await(1,TimeUnit.SECONDS));
   Thread stopping=new Thread(()->{try{e.draft.stop(token,SystemClock.elapsedRealtime(),false);}catch(Throwable t){failed.set(t);}});stopping.setDaemon(true);stopping.start();
   try{
    waitFor(()->!e.draft.capturePermit().opening);yes(writer.isAlive()&&stopping.isAlive());
    RecordingPlatform.autoQueue=true;
    // If the final gate takes the journal monitor, fail and unblock it instead
    // of hanging the whole focused suite. This watchdog performs no SDK work.
    AtomicBoolean delayed=new AtomicBoolean();CountDownLatch admitted=new CountDownLatch(1);
    Thread watchdog=new Thread(()->{try{if(!admitted.await(1,TimeUnit.SECONDS)){delayed.set(true);store.release.countDown();}}catch(InterruptedException x){Thread.currentThread().interrupt();}});watchdog.setDaemon(true);watchdog.start();
    e.owner.stop();yes(RecordingPlatform.last("RECORDING_SERVICE",4).queued);yes(!opening.queue());admitted.countDown();watchdog.join(1500);
    yes(!delayed.get()&&store.release.getCount()==1&&writer.isAlive()&&stopping.isAlive());
   }finally{store.release.countDown();writer.join(1500);stopping.join(1500);store.block=false;RecordingPlatform.autoQueue=true;}
   yes(failed.get()==null&&!writer.isAlive()&&!stopping.isAlive()&&!e.draft.capturePermit().opening);
  }
  // A failed durable transition cannot resurrect opening or discard the last
  // proven capture binding needed by an exact-owner physical stop.
  BlockingStore broken=new BlockingStore();VoiceAnswerSession draft=VoiceAnswerTest.prepared(broken,VoiceAnswerTest.connection("permit-write-failure"));VoiceAnswerTest.arm(draft);
  VoiceAnswerSession.CapturePermit old=draft.capturePermit();yes(old.opening&&old.needsStop);broken.fail=true;
  VoiceAnswerTest.rejects(()->draft.stop(old.token,2000,false));VoiceAnswerSession.CapturePermit after=draft.capturePermit();
  yes(!after.opening&&after.needsStop&&after.token.equals(old.token)&&after.peer.equals(old.peer)&&after.generation==old.generation);
  yes(after.phase.equals("CAPTURING")&&!draft.healthy());
 }
 static void recovery()throws Exception{
  // A valid old opening ticket and its timer callback must remain tied to the
  // retired owner even when a stop-only recovery owns the same physical peer.
  Host107Recording oldOwner;RecordingPlatform.Message oldOpening;String oldToken;
  try(Env old=new Env()){
   old.ready();old.arm();RecordingPlatform.autoQueue=false;old.owner.begin();
   oldOpening=RecordingPlatform.last("RECORDING_SERVICE",14);oldOwner=old.owner;oldToken=old.draft.token();
   yes(!oldOpening.queued);RecordingPlatform.autoQueue=true;
  }
  RecordingPlatform.messages.clear();Host107Ota.peer=VoiceAnswerTest.PEER;Host107Ota.generation=2;
  VoiceAnswerTest.Memory memory=new VoiceAnswerTest.Memory();
  VoiceAnswerSession original=VoiceAnswerTest.prepared(memory,VoiceAnswerTest.connection("recording-recovery"));VoiceAnswerTest.arm(original);
  VoiceAnswerSession restored=new VoiceAnswerSession(memory);Sink sink=new Sink();AtomicInteger automaticStops=new AtomicInteger();
  try(VoiceCaptureCutoff cutoff=new VoiceCaptureCutoff(SystemClock::elapsedRealtime,(a,b,c)->automaticStops.incrementAndGet())){
   yes(restored.phase().equals("RECOVERY")&&restored.needsStop());
   yes(Host107Recording.acquireRecovery(restored,cutoff,sink)==null);
   yes(restored.resumeCleanup(VoiceAnswerTest.PEER,1,SystemClock.elapsedRealtime()));
   yes(Host107Recording.acquireRecovery(restored,cutoff,sink)==null&&!cutoff.pending());
   yes(restored.resumeCleanup(VoiceAnswerTest.PEER,2,SystemClock.elapsedRealtime()));
   Host107Ota.peer=VoiceAnswerTest.OTHER;yes(Host107Recording.acquireRecovery(restored,cutoff,sink)==null&&!cutoff.pending());
   Host107Ota.peer=VoiceAnswerTest.PEER;NativeTransfer.blocked=true;
   yes(Host107Recording.acquireRecovery(restored,cutoff,sink)==null&&!cutoff.pending());NativeTransfer.blocked=false;
   Object saved=restored.snapshot();Host107Recording owner=Host107Recording.acquireRecovery(restored,cutoff,sink);yes(owner!=null);
   yes(TaskWire.same(saved,restored.snapshot())&&cutoff.pending()&&cutoff.issued());
   yes(Host107Recording.acquireRecovery(restored,cutoff,sink)==null&&Host107Recording.acquire(restored,cutoff,sink)==null);
   yes(!cutoff.armed(restored.token(),FixedPeerHash.of(VoiceAnswerTest.PEER),2,16000));
   VoiceAnswerTest.rejects(owner::begin);VoiceAnswerTest.rejects(owner::inspect);
   for(int type:new int[]{1,4,8,9,11})VoiceAnswerTest.rejects(()->owner.acknowledge(type));
   VoiceAnswerTest.rejects(owner::inspectIdle);yes(!owner.release()&&!owner.releasePrepared());
   yes(!oldOpening.queue());oldOwner.deadlineStop(oldToken,FixedPeerHash.of(VoiceAnswerTest.PEER),1);Handler.drain();
   yes(RecordingPlatform.messages.isEmpty());
   yes(emit(VoiceAnswerTest.PEER,14,3,WireJson.object("uuid",restored.token(),"offset",0),new byte[]{1}));
   yes(emit(VoiceAnswerTest.PEER,14,6,WireJson.object("uuid",restored.token(),"completed",true),null));
   Handler.drain();yes(sink.bytes==null&&sink.events.isEmpty()&&TaskWire.same(saved,restored.snapshot()));
   yes(!emit(VoiceAnswerTest.PEER,14,3,WireJson.object("uuid","ordinary-stock-record","offset",0),new byte[]{1}));
   owner.stop();owner.stop();yes(RecordingPlatform.sent("RECORDING_SERVICE",4).size()==1);
   yes(RecordingPlatform.sent("RECORDING_SERVICE",1).isEmpty()&&RecordingPlatform.sent("RECORDING_SERVICE",14).isEmpty());
   VoiceAnswerTest.rejects(owner::inspectIdle);RecordingPlatform.last("RECORDING_SERVICE",4).receipt(true);waitFor(()->sink.events.contains("sent:4:true"));
   yes(!sink.events.contains("no-start")&&!owner.release()&&restored.needsStop());
   emit(VoiceAnswerTest.PEER,9,11,WireJson.object("Result",true),null);owner.inspectIdle();Handler.drain();yes(!sink.events.contains("idle:true"));
   emit(VoiceAnswerTest.OTHER,9,11,WireJson.object("Result",true),null);Handler.drain();yes(!sink.events.contains("idle:true"));
   emit(VoiceAnswerTest.PEER,9,11,WireJson.object("Result",true),null);waitFor(()->sink.events.contains("idle:true"));
   // The adapter forwards evidence; only the durable owner decides when its
   // engine and physical-stop proofs are complete. Merely receiving idle is not it.
   yes(!owner.release()&&restored.needsStop()&&TaskWire.same(saved,restored.snapshot()));
   long now=SystemClock.elapsedRealtime();yes(!restored.stopSubmitted(restored.token(),VoiceAnswerTest.PEER,1,now));
   yes(restored.stopSubmitted(restored.token(),VoiceAnswerTest.PEER,2,now));
   VoiceAnswerSession.StopProbe probe=restored.probeStop(VoiceAnswerTest.PEER,2,now);yes(probe!=null);
   yes(restored.deviceIdle(probe,VoiceAnswerTest.PEER,2,now,true));yes(!restored.finish()&&!owner.release());
   yes(restored.engineSealed(restored.token(),true,now)&&restored.finish());
   waitFor(owner::release);yes(NativeTransfer.owner.isEmpty()&&!cutoff.pending()&&automaticStops.get()==0);
   yes(restored.phase().equals("INCOMPLETE")&&restored.transcript().isEmpty()&&sink.bytes==null);
  }
  Host107Ota.generation=1;yes(automaticStops.get()==0);
  liveRecovery();
 }
 static void liveRecovery()throws Exception{
  // A stuck old audio receiver cannot delay stop on the reconnected epoch.
  // Its already executing callback retains generation one after handoff.
  Env old=new Env();old.start();old.sink.entered=new CountDownLatch(1);old.sink.unblock=new CountDownLatch(1);old.sink.ignoreInterrupt=true;
  emit(VoiceAnswerTest.PEER,14,3,WireJson.object("uuid",old.draft.token(),"offset",0),new byte[]{1});Handler.drain();yes(old.sink.entered.await(1,TimeUnit.SECONDS));
  Host107Ota.generation=2;old.owner.stop();
  yes(old.draft.stop(old.draft.token(),SystemClock.elapsedRealtime(),false));
  Sink recovered=new Sink();
  try(VoiceCaptureCutoff cutoff=new VoiceCaptureCutoff(SystemClock::elapsedRealtime,(a,b,c)->{throw new AssertionError("Recovery cannot schedule capture");})){
   yes(Host107Recording.acquireRecovery(old.draft,cutoff,recovered)==null);
   yes(old.draft.resumeCleanup(VoiceAnswerTest.PEER,2,SystemClock.elapsedRealtime()));
   VoiceAnswerTest.Memory cloned=new VoiceAnswerTest.Memory();cloned.value=old.draft.snapshot();VoiceAnswerSession different=new VoiceAnswerSession(cloned);yes(different.resumeCleanup(VoiceAnswerTest.PEER,2,SystemClock.elapsedRealtime()));
   yes(Host107Recording.acquireRecovery(different,cutoff,recovered)==null&&!cutoff.pending());
   yes(Host107Recording.acquireRecovery(old.draft,cutoff,old.sink)==null&&!cutoff.pending());
   final Host107Recording[] owner={Host107Recording.acquireRecovery(old.draft,cutoff,recovered)};yes(owner[0]!=null);
   yes(NativeTransfer.owner.equals("agent-voice-"+old.draft.token())&&old.draft.needsStop());
   yes(old.sink.unblock.getCount()==1&&old.sink.completedGeneration==0);
   int messages=RecordingPlatform.messages.size();Handler.drain();old.owner.stop();Handler.drain();yes(RecordingPlatform.messages.size()==messages);
   VoiceAnswerTest.rejects(owner[0]::begin);VoiceAnswerTest.rejects(()->owner[0].acknowledge(4));
   owner[0].stop();RecordingPlatform.last("RECORDING_SERVICE",4).receipt(true);waitFor(()->recovered.events.contains("sent:4:true"));
   yes(old.sink.unblock.getCount()==1&&old.sink.completedGeneration==0);
   owner[0].inspectIdle();emit(VoiceAnswerTest.PEER,9,11,WireJson.object("Result",true),null);waitFor(()->recovered.events.contains("idle:true"));
   yes(!owner[0].release()&&!recovered.events.contains("no-start"));long now=SystemClock.elapsedRealtime();
   old.sink.unblock.countDown();waitFor(()->old.sink.completedGeneration==1);
   // Wait for the retired finally block as well, rather than racing its final
   // notification with the assertion. The only blocking work is in this test.
   java.lang.reflect.Field worker=Host107Recording.class.getDeclaredField("incoming");worker.setAccessible(true);
   yes(((ThreadPoolExecutor)worker.get(old.owner)).awaitTermination(1,TimeUnit.SECONDS));
   yes(!old.sink.events.contains("VOICE_CONNECTION_CHANGED"));
   yes(recovered.bytes==null&&!old.draft.stopSubmitted(old.draft.token(),VoiceAnswerTest.PEER,1,now));
   yes(old.draft.stopSubmitted(old.draft.token(),VoiceAnswerTest.PEER,2,now));
   yes(old.draft.engineSealed(old.draft.token(),true,now));
   VoiceAnswerSession.StopProbe probe=old.draft.probeStop(VoiceAnswerTest.PEER,2,now);yes(old.draft.deviceIdle(probe,VoiceAnswerTest.PEER,2,now,true));yes(old.draft.finish());
   waitFor(owner[0]::release);yes(NativeTransfer.owner.isEmpty());
  }finally{old.sink.unblock.countDown();old.cutoff.close();Host107Ota.generation=1;}
 }
 static void recoveryDelayedStop()throws Exception{
  for(boolean durableChanged:new boolean[]{false,true}){
   RecordingPlatform.messages.clear();Host107Ota.peer=VoiceAnswerTest.PEER;Host107Ota.generation=2;
   VoiceAnswerSession draft=VoiceAnswerTest.prepared(new VoiceAnswerTest.Memory(),VoiceAnswerTest.connection("recovery-delayed-stop"));VoiceAnswerTest.arm(draft);
   yes(draft.stop(draft.token(),SystemClock.elapsedRealtime(),false));yes(draft.resumeCleanup(VoiceAnswerTest.PEER,2,SystemClock.elapsedRealtime()));
   try(VoiceCaptureCutoff first=new VoiceCaptureCutoff(SystemClock::elapsedRealtime,(a,b,c)->{});VoiceCaptureCutoff next=new VoiceCaptureCutoff(SystemClock::elapsedRealtime,(a,b,c)->{})){
    Sink old=new Sink(),fresh=new Sink();Host107Recording owner=Host107Recording.acquireRecovery(draft,first,old);yes(owner!=null);
    RecordingPlatform.autoQueue=false;owner.stop();RecordingPlatform.Message delayed=RecordingPlatform.last("RECORDING_SERVICE",4);
    if(durableChanged)yes(draft.resumeCleanup(VoiceAnswerTest.PEER,3,SystemClock.elapsedRealtime()));else Host107Ota.generation=3;
    yes(!delayed.queue()&&!delayed.queued);
    // Rebind the actual new epoch and obtain entirely new SDK/idle evidence;
    // the rejected old stop is never upgraded into a successful receipt.
    Host107Ota.generation=3;if(!durableChanged)yes(draft.resumeCleanup(VoiceAnswerTest.PEER,3,SystemClock.elapsedRealtime()));
    Host107Recording recovery=Host107Recording.acquireRecovery(draft,next,fresh);yes(recovery!=null);RecordingPlatform.autoQueue=true;
    delayed.receipt(true);Handler.drain();yes(!old.events.contains("sent:4:true"));
    recovery.stop();RecordingPlatform.last("RECORDING_SERVICE",4).receipt(true);waitFor(()->fresh.events.contains("sent:4:true"));
    recovery.inspectIdle();emit(VoiceAnswerTest.PEER,9,11,WireJson.object("Result",true),null);waitFor(()->fresh.events.contains("idle:true"));
    yes(!recovery.release());long now=SystemClock.elapsedRealtime();yes(draft.stopSubmitted(draft.token(),VoiceAnswerTest.PEER,3,now));
    yes(draft.engineSealed(draft.token(),true,now));VoiceAnswerSession.StopProbe probe=draft.probeStop(VoiceAnswerTest.PEER,3,now);
    yes(draft.deviceIdle(probe,VoiceAnswerTest.PEER,3,now,true)&&draft.finish());waitFor(recovery::release);yes(NativeTransfer.owner.isEmpty());
   }finally{RecordingPlatform.autoQueue=true;Host107Ota.generation=1;}
  }
 }
}
