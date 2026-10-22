package com.turboio.addon;

import java.io.*;import java.nio.file.*;import java.util.*;import java.util.concurrent.*;import java.util.concurrent.atomic.*;import java.util.function.BooleanSupplier;

/** Real draft/archive code with fake SDK, decoder and ASR. Never opens a mic,
 * contacts a server or creates an Agent answer. Physical proof is synthetic. */
public final class VoiceAnswerCoordinatorTest {
 static int checks;
 static synchronized void yes(boolean value){checks++;if(!value)throw new AssertionError("Voice coordinator "+checks);}
 static void waitFor(BooleanSupplier condition)throws Exception{long end=System.nanoTime()+TimeUnit.SECONDS.toNanos(4);while(!condition.getAsBoolean()){if(System.nanoTime()>end)throw new AssertionError("Coordinator did not settle");Thread.sleep(2);}}
 static final class Store implements VoiceAnswerSession.Store {
  final VoiceAnswerTest.Memory memory=new VoiceAnswerTest.Memory();volatile boolean block;final CountDownLatch entered=new CountDownLatch(1),unblock=new CountDownLatch(1);
  public Object read(){return memory.read();}public void save(Object value)throws Exception{if(block){entered.countDown();unblock.await();}memory.save(value);}
 }
 static final class Fixture {
  final AtomicLong clock=new AtomicLong(1000);final Store store=new Store();final VoiceAnswerSession draft;final String token;
  final File files;final VoiceAudioArchive archive;final RecordingVoiceSource source;final FakeDevice device=new FakeDevice();final FakeEngine engine=new FakeEngine();final VoiceAnswerCoordinator coordinator;
  final List<VoiceAnswerCoordinator.State> states=new CopyOnWriteArrayList<>();
  final AtomicBoolean blockObserver=new AtomicBoolean();final CountDownLatch observerEntered=new CountDownLatch(1),observerRelease=new CountDownLatch(1);
  Fixture(File root,String name)throws Exception{
   files=new File(root,name);draft=VoiceAnswerTest.prepared(store,VoiceAnswerTest.connection("coordinator-"+name));VoiceAnswerTest.arm(draft);token=draft.token();
   archive=new VoiceAudioArchive(files,token,14);source=new RecordingVoiceSource(token,VoiceAnswerTest.PEER,1,archive,packet->{byte[] pcm=new byte[640];pcm[0]=1;return pcm;});
   coordinator=new VoiceAnswerCoordinator(draft,VoiceAnswerTest.PEER,1,source,archive,device,clock::get,state->{states.add(state);if(blockObserver.get()){observerEntered.countDown();try{observerRelease.await();}catch(InterruptedException interrupted){Thread.currentThread().interrupt();}}});
   engine.listener=coordinator.listener();coordinator.attachEngine(engine);
  }
  final class FakeDevice implements VoiceAnswerCoordinator.Device {
   final AtomicInteger begins=new AtomicInteger(),stops=new AtomicInteger(),queries=new AtomicInteger(),releases=new AtomicInteger();final List<Integer> acks=new CopyOnWriteArrayList<>();
   volatile boolean acceptStop=true,reportIdle=true,replyIdle=true,allowRelease=true;
   public void begin(){begins.incrementAndGet();}
   public void stop(){stops.incrementAndGet();coordinator.sent(4,acceptStop,clock.get());}
   public void acknowledge(int type){acks.add(type);}
   public void inspectIdle(){queries.incrementAndGet();if(replyIdle)coordinator.idle(reportIdle,clock.get());}
   public boolean release(){releases.incrementAndGet();yes(!draft.needsStop());return allowRelease;}
  }
  final class FakeEngine implements VoiceAnswerCoordinator.Engine {
   Host107VoiceTask.Listener listener;final List<byte[]> pcm=new CopyOnWriteArrayList<>();final AtomicInteger starts=new AtomicInteger(),seals=new AtomicInteger(),stops=new AtomicInteger(),releases=new AtomicInteger();
   volatile boolean acceptStart=true,notifyStart=true,isWorking=true,acceptStop=true,isStopped=true;
   public boolean start(){starts.incrementAndGet();if(notifyStart)listener.started(acceptStart);return acceptStart;}
   public boolean working(){return isWorking;}
   public void pcm(byte[] value){yes(value.length>0&&value.length<=32768&&value.length%2==0);pcm.add(value.clone());}
   public void sealInput(){seals.incrementAndGet();}
   public boolean stop(){stops.incrementAndGet();return acceptStop;}
   public boolean stopped(){return isStopped;}
   public void release(){yes(starts.get()==0||seals.get()==1&&stops.get()>0&&isStopped);releases.incrementAndGet();}
  }
  void start()throws Exception{coordinator.start();waitFor(()->device.begins.get()==1);}
  byte[] audio(){return OtaFrame.encode(3,WireJson.object("uuid",token,"offset",0),new byte[240*60]);}
  void feed()throws Exception{byte[] input=audio();coordinator.frame(VoiceAnswerTest.PEER,1,input);waitFor(()->engine.pcm.size()==2);yes(engine.pcm.get(0).length==32768&&engine.pcm.get(1).length==5632);}
  void words()throws Exception{
   engine.listener.result("按新价格",false);engine.listener.result("按新价格。",true);engine.listener.result("但运费",false);engine.listener.result("但运费沿用上版，先不要发布。",true);
   waitFor(()->draft.transcript().equals("按新价格。\n但运费沿用上版，先不要发布。"));
  }
  void end(){coordinator.frame(VoiceAnswerTest.PEER,1,OtaFrame.encode(6,WireJson.object("uuid",token,"completed",true),null));}
  void settled()throws Exception{
   try{waitFor(()->coordinator.snapshot().released);}catch(AssertionError timeout){
    VoiceAnswerCoordinator.State s=coordinator.snapshot();Map<String,Object> d=s.draftSnapshot;
    throw new AssertionError("Coordinator did not settle: phase="+s.phase+", note="+s.note+", released="+s.released+", answerReady="+s.answerReady+
     ", engine starts/seals/stops/releases="+engine.starts.get()+"/"+engine.seals.get()+"/"+engine.stops.get()+"/"+engine.releases.get()+
     ", device begins/stops/queries/releases="+device.begins.get()+"/"+device.stops.get()+"/"+device.queries.get()+"/"+device.releases.get()+
     ", needs_stop="+d.get("needs_stop")+", engine_end="+d.get("engine_end")+", engine_stopped="+d.get("engine_stopped")+", device_stopped="+d.get("device_stopped")+
     ", stop_at="+d.get("stop_at")+", stop_sent="+d.get("stop_sent")+", cancelled="+d.get("cancelled")+", error="+d.get("error"),timeout);
   }yes(engine.releases.get()==1);
  }
  Map<String,Object> manifest()throws Exception{return WireJson.map(WireJson.read(Files.readAllBytes(new File(files,"voice-audio/"+token+"/source.json").toPath())));}
 }
 public static void main(String[] args)throws Exception{
  File root=new File(args[0]);
  Fixture ok=new Fixture(root,"complete");ok.start();ok.coordinator.start();yes(ok.engine.starts.get()==1&&ok.device.begins.get()==1);
  VoiceAnswerTest.rejects(()->ok.coordinator.attachEngine(ok.engine));
  ok.coordinator.frame(VoiceAnswerTest.OTHER,1,ok.audio());ok.coordinator.frame(VoiceAnswerTest.PEER,2,ok.audio());ok.coordinator.tick();Thread.sleep(20);yes(ok.engine.pcm.isEmpty());
  ok.feed();ok.coordinator.frame(VoiceAnswerTest.PEER,1,ok.audio());ok.words();ok.end();ok.settled();
  VoiceAnswerCoordinator.State complete=ok.coordinator.snapshot();yes(complete.phase.equals("REVIEW")&&complete.note.equals("review")&&complete.answerReady);
  yes(ok.draft.answerText().equals("按新价格。\n但运费沿用上版，先不要发布。"));yes(ok.device.queries.get()==1);
  yes(Boolean.TRUE.equals(ok.manifest().get("complete"))&&((Number)ok.manifest().get("frames")).intValue()==2);
  yes(Arrays.equals(ok.files.list(),new String[]{"voice-audio"})); // no mailbox/answer/transport created
  String retained=ok.draft.transcript();int stops=ok.device.stops.get();ok.engine.listener.result("迟到覆盖",true);ok.coordinator.sent(4,true,1000);ok.end();ok.coordinator.close();Thread.sleep(20);
  yes(retained.equals(ok.draft.transcript())&&ok.device.stops.get()==stops&&ok.coordinator.snapshot().phase.equals("REVIEW"));
  try{complete.draftSnapshot.put("phase","SAVED");throw new AssertionError("Mutable snapshot");}catch(UnsupportedOperationException expected){checks++;}

  // The ASR callback is stuck inside durable save. stop must dispatch before
  // that callback, coordinator publication or its own stop journal can drain.
  Fixture blocked=new Fixture(root,"blocked-save");blocked.start();blocked.store.block=true;blocked.engine.listener.result("阻塞中的完整条件",false);yes(blocked.store.entered.await(1,TimeUnit.SECONDS));
  CountDownLatch returned=new CountDownLatch(1);Thread stopThread=new Thread(()->{blocked.coordinator.stop(false);returned.countDown();});stopThread.setDaemon(true);stopThread.start();
  try{yes(returned.await(1,TimeUnit.SECONDS)&&blocked.device.stops.get()>0&&blocked.store.unblock.getCount()==1);yes(!blocked.draft.capturePermit().opening);}
  finally{blocked.store.block=false;blocked.store.unblock.countDown();}
  waitFor(()->blocked.draft.phase().equals("STOPPING"));blocked.clock.addAndGet(8001);blocked.coordinator.tick();blocked.settled();
  yes(blocked.coordinator.snapshot().phase.equals("INCOMPLETE")&&!blocked.coordinator.snapshot().answerReady&&Boolean.FALSE.equals(blocked.manifest().get("complete")));

  // A blocked observer cannot make physical stop wait on the coordinator lane.
  Fixture observer=new Fixture(root,"blocked-observer");observer.start();observer.blockObserver.set(true);observer.coordinator.tick();yes(observer.observerEntered.await(1,TimeUnit.SECONDS));
  observer.coordinator.stop(false);yes(observer.device.stops.get()>0&&observer.observerRelease.getCount()==1);observer.blockObserver.set(false);observer.observerRelease.countDown();
  observer.clock.addAndGet(8001);observer.coordinator.tick();observer.settled();yes(observer.coordinator.snapshot().phase.equals("INCOMPLETE"));

  Fixture missing=new Fixture(root,"missing-tail");missing.start();missing.feed();missing.words();missing.coordinator.stop(false);waitFor(()->missing.device.queries.get()>0);
  yes(!missing.coordinator.snapshot().released&&missing.engine.stops.get()==0);missing.clock.addAndGet(8001);missing.coordinator.tick();missing.settled();
  yes(missing.coordinator.snapshot().phase.equals("INCOMPLETE")&&missing.draft.transcript().contains("先不要发布"));yes(Boolean.FALSE.equals(missing.manifest().get("complete")));

  Fixture idle=new Fixture(root,"false-idle");idle.device.reportIdle=false;idle.start();idle.feed();idle.words();idle.end();waitFor(()->idle.device.queries.get()==1&&idle.engine.stops.get()>0&&idle.coordinator.snapshot().note.equals("VOICE_DEVICE_NOT_IDLE"));
  yes(!idle.coordinator.snapshot().released&&idle.draft.needsStop()&&idle.device.releases.get()==0);
  idle.device.reportIdle=true;idle.clock.addAndGet(1001);idle.coordinator.tick();idle.settled();yes(idle.device.queries.get()==2&&idle.coordinator.snapshot().phase.equals("REVIEW"));

  Fixture failed=new Fixture(root,"stop-failure");failed.device.acceptStop=false;failed.start();failed.feed();failed.words();failed.end();waitFor(()->failed.engine.stops.get()>0);
  yes(failed.draft.needsStop()&&!failed.coordinator.snapshot().released&&failed.device.queries.get()==0);
  // A separate synthetic retry receipt, not the earlier failed one, supplies
  // acceptance; the earlier fault remains in the incomplete retained draft.
  failed.device.acceptStop=true;failed.coordinator.stop(false);failed.settled();yes(failed.coordinator.snapshot().phase.equals("INCOMPLETE"));

  Fixture close=new Fixture(root,"close");close.start();close.feed();close.words();close.coordinator.close();waitFor(()->close.device.queries.get()>0);yes(!close.coordinator.snapshot().released);
  close.clock.addAndGet(8001);close.coordinator.tick();close.settled();yes(close.coordinator.snapshot().phase.equals("CANCELLED")&&close.draft.transcript().contains("先不要发布"));

  Fixture prepared=new Fixture(root,"close-before-start");prepared.coordinator.close();prepared.clock.addAndGet(8001);prepared.coordinator.tick();prepared.settled();
  yes(prepared.engine.starts.get()==0&&prepared.engine.stops.get()==0&&prepared.device.begins.get()==0&&prepared.engine.releases.get()==1&&prepared.coordinator.snapshot().phase.equals("CANCELLED")&&!prepared.coordinator.snapshot().answerReady);

  Fixture cutoff=new Fixture(root,"external-cutoff");cutoff.start();cutoff.feed();cutoff.words();
  // The external cutoff already sent stop: no coordinator stop() was called.
  cutoff.coordinator.sent(4,true,cutoff.clock.get());waitFor(()->cutoff.device.queries.get()==1);yes(cutoff.device.stops.get()==0&&!cutoff.coordinator.snapshot().released);
  cutoff.end();cutoff.settled();yes(cutoff.coordinator.snapshot().phase.equals("REVIEW"));

  Fixture start=new Fixture(root,"start-timeout");start.engine.notifyStart=false;start.engine.isWorking=false;start.coordinator.start();waitFor(()->start.engine.starts.get()==1);
  start.clock.addAndGet(8001);start.coordinator.tick();start.settled();yes(start.device.begins.get()==0&&start.coordinator.snapshot().phase.equals("INCOMPLETE"));

  Fixture release=new Fixture(root,"release-pending");release.device.allowRelease=false;release.start();release.feed();release.words();release.end();
  waitFor(()->release.coordinator.snapshot().phase.equals("REVIEW"));yes(!release.coordinator.snapshot().released&&!release.coordinator.snapshot().answerReady);
  release.device.allowRelease=true;release.coordinator.tick();release.settled();yes(release.coordinator.snapshot().answerReady);

  // A real filesystem failure after durable finish must never publish an
  // invented draft phase or enable submission through a partial manifest.
  Fixture seal=new Fixture(root,"archive-failure");seal.start();seal.feed();seal.words();
  File obstacle=new File(seal.files,"voice-audio/"+seal.token+"/source.json.partial");yes(obstacle.mkdir());seal.end();
  waitFor(()->seal.coordinator.snapshot().note.equals("VOICE_ARCHIVE_SEAL_FAILED"));
  VoiceAnswerCoordinator.State failedSeal=seal.coordinator.snapshot();yes(failedSeal.phase.equals("REVIEW")&&failedSeal.draftSnapshot.get("phase").equals(failedSeal.phase)&&!failedSeal.answerReady&&!failedSeal.released);
  Files.delete(obstacle.toPath());seal.coordinator.tick();seal.settled();
  yes(seal.coordinator.snapshot().note.equals("VOICE_ARCHIVE_SEAL_FAILED")&&!seal.coordinator.snapshot().answerReady&&Boolean.FALSE.equals(seal.manifest().get("complete")));

  Fixture cancelReview=new Fixture(root,"cancel-during-release");cancelReview.device.allowRelease=false;cancelReview.start();cancelReview.feed();cancelReview.words();cancelReview.end();
  waitFor(()->cancelReview.coordinator.snapshot().phase.equals("REVIEW"));cancelReview.coordinator.close();
  waitFor(()->cancelReview.coordinator.snapshot().phase.equals("CANCELLED"));yes(!cancelReview.coordinator.snapshot().answerReady);
  cancelReview.device.allowRelease=true;cancelReview.coordinator.tick();cancelReview.settled();yes(cancelReview.draft.phase().equals("CANCELLED")&&!cancelReview.coordinator.snapshot().answerReady);

  Fixture nativeWait=new Fixture(root,"native-stop-pending");nativeWait.engine.isStopped=false;nativeWait.start();nativeWait.feed();nativeWait.words();nativeWait.end();
  waitFor(()->nativeWait.engine.stops.get()>0&&nativeWait.device.queries.get()>0);yes(!nativeWait.coordinator.snapshot().released&&!Boolean.TRUE.equals(WireJson.map(nativeWait.draft.snapshot()).get("engine_stopped")));
  nativeWait.coordinator.sent(4,true,nativeWait.clock.get());nativeWait.engine.isStopped=true;nativeWait.coordinator.tick();nativeWait.settled();yes(nativeWait.device.queries.get()==1&&nativeWait.coordinator.snapshot().answerReady);

  Fixture staleIdle=new Fixture(root,"stale-idle-response");staleIdle.device.replyIdle=false;staleIdle.start();staleIdle.feed();staleIdle.words();staleIdle.end();
  waitFor(()->staleIdle.device.queries.get()==1);long oldIdleAt=staleIdle.clock.get();staleIdle.clock.addAndGet(8001);staleIdle.coordinator.tick();waitFor(()->staleIdle.device.queries.get()==2);
  // The old response must neither prove idle nor consume the newer probe.
  staleIdle.coordinator.idle(true,oldIdleAt);staleIdle.coordinator.idle(true,staleIdle.clock.get());staleIdle.settled();
  yes(staleIdle.device.queries.get()==2&&staleIdle.coordinator.snapshot().answerReady);

  // Retiring a bound worker cannot write token-only stop proofs into a newer
  // durable generation, even with accepted callbacks already waiting in it.
  Fixture owner=new Fixture(root,"owner-fence");owner.start();owner.feed();owner.words();owner.blockObserver.set(true);owner.coordinator.tick();yes(owner.observerEntered.await(1,TimeUnit.SECONDS));
  owner.engine.listener.result("旧owner排队结果",false);owner.coordinator.stop(false);
  yes(owner.draft.stop(owner.token,owner.clock.get(),false));yes(owner.draft.resumeCleanup(VoiceAnswerTest.PEER,2,owner.clock.get()));
  owner.engine.listener.engineAudio(false);owner.engine.listener.result("换绑后迟到结果",true);owner.coordinator.sent(4,true,owner.clock.get());owner.coordinator.idle(true,owner.clock.get());owner.coordinator.close();
  owner.blockObserver.set(false);owner.observerRelease.countDown();waitFor(()->owner.engine.releases.get()==1&&owner.coordinator.snapshot().note.equals("VOICE_OWNER_CHANGED"));
  Map<String,Object> rebound=WireJson.map(owner.draft.snapshot());yes(((Number)rebound.get("generation")).longValue()==2&&!Boolean.TRUE.equals(rebound.get("engine_stopped"))&&!Boolean.TRUE.equals(rebound.get("device_stopped"))&&!Boolean.TRUE.equals(rebound.get("cancelled")));
  yes(!owner.draft.transcript().contains("owner")&&!owner.draft.transcript().contains("迟到")&&!owner.coordinator.snapshot().answerReady&&owner.device.releases.get()==0);
  java.lang.reflect.Field worker=VoiceAnswerCoordinator.class.getDeclaredField("worker");worker.setAccessible(true);yes(((ExecutorService)worker.get(owner.coordinator)).isShutdown());yes(!owner.coordinator.snapshot().released);
  System.out.println("Voice coordinator: "+checks+" assertions passed");
 }
}
