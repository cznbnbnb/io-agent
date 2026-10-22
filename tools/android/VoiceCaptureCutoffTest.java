package com.turboio.addon;

import java.util.concurrent.*;import java.util.concurrent.atomic.*;

/** Actual independent JVM timer; SDK stop sink and physical idle remain test doubles. */
final class VoiceCaptureCutoffTest {
 static void yes(boolean v){VoiceAnswerTest.yes(v);}
 static void run()throws Exception{
  VoiceAnswerSession s=VoiceAnswerTest.prepared(new VoiceAnswerTest.Memory(),VoiceAnswerTest.connection("cutoff-owner"));
  String hash=FixedPeerHash.of(VoiceAnswerTest.PEER);CountDownLatch stopped=new CountDownLatch(1),releaseOther=new CountDownLatch(1);AtomicInteger calls=new AtomicInteger();AtomicReference<String> owner=new AtomicReference<>();
  // Simulate unrelated synthesis/storage being blocked for the duration of capture.
  Thread blocked=new Thread(()->{try{releaseOther.await();}catch(InterruptedException e){Thread.currentThread().interrupt();}});blocked.setDaemon(true);blocked.start();
  long origin=System.nanoTime();java.util.function.LongSupplier clock=()->1000+TimeUnit.NANOSECONDS.toMillis(System.nanoTime()-origin);
  try(VoiceCaptureCutoff guard=new VoiceCaptureCutoff(clock,(token,peer,gen)->{owner.set(token+":"+peer+":"+gen);calls.incrementAndGet();stopped.countDown();})){
   long now=clock.getAsLong(),deadline=now+4000;yes(guard.arm(s.token(),hash,1,deadline));
   yes(!guard.armed(s.token(),hash,2,deadline));yes(!guard.armed(s.token(),hash,1,deadline+1));
   yes(!guard.arm("ffffffffffffffffffffffffffffffff",hash,2,clock.getAsLong()+4000));
   yes(s.arm(VoiceAnswerTest.PEER,1,now,4,guard));yes(!guard.release(s));
   yes(stopped.await(6,TimeUnit.SECONDS));yes(blocked.isAlive());
   yes(owner.get().equals(s.token()+":"+hash+":1")&&calls.get()==1&&guard.issued()&&guard.pending()&&!guard.failed());
   yes(!guard.armed(s.token(),hash,1,deadline)&&s.needsStop()&&!s.finish());
   VoiceAnswerTest.stopped(s,1);yes(s.phase().equals("INCOMPLETE"));yes(guard.release(s)&&!guard.pending());
  }finally{releaseOther.countDown();blocked.join(1000);}
  yes(calls.get()==1);
  VoiceAnswerSession active=VoiceAnswerTest.prepared(new VoiceAnswerTest.Memory(),VoiceAnswerTest.connection("cutoff-close"));AtomicInteger closedCalls=new AtomicInteger();
  VoiceCaptureCutoff closed=new VoiceCaptureCutoff(()->1000,(token,peer,gen)->{closedCalls.incrementAndGet();throw new IllegalStateException("synthetic unavailable stop sink");});
  yes(closed.arm(active.token(),hash,1,5000));closed.close();closed.close();yes(closedCalls.get()==1&&closed.issued()&&closed.failed()&&closed.pending());
  yes(!closed.armed(active.token(),hash,1,5000));yes(!closed.release(active));
  VoiceAnswerSession ended=VoiceAnswerTest.prepared(new VoiceAnswerTest.Memory(),VoiceAnswerTest.connection("cutoff-disarm"));VoiceAnswerTest.arm(ended);VoiceAnswerTest.stopped(ended,1);AtomicInteger unneeded=new AtomicInteger();
  try(VoiceCaptureCutoff guard=new VoiceCaptureCutoff(()->1000,(a,b,c)->unneeded.incrementAndGet())){yes(guard.arm(ended.token(),hash,1,5000));yes(guard.release(ended));}
  yes(unneeded.get()==0);
  // A delayed old stop sink may fail after its proven-idle owner was released and
  // a new lease armed. That exception must never poison/stop the new owner.
  CountDownLatch oldEntered=new CountDownLatch(1),oldReturn=new CountDownLatch(1);AtomicInteger oldCalls=new AtomicInteger();
  VoiceAnswerSession next=VoiceAnswerTest.prepared(new VoiceAnswerTest.Memory(),VoiceAnswerTest.connection("cutoff-next"));
  try(VoiceCaptureCutoff guard=new VoiceCaptureCutoff(()->1000,(token,peer,gen)->{oldCalls.incrementAndGet();if(token.equals(ended.token())){oldEntered.countDown();oldReturn.await();throw new IllegalStateException("late old failure");}})){
   yes(guard.arm(ended.token(),hash,1,1010));yes(oldEntered.await(2,TimeUnit.SECONDS));yes(guard.release(ended));
   yes(guard.arm(next.token(),hash,1,6000));oldReturn.countDown();
   java.lang.reflect.Field field=VoiceCaptureCutoff.class.getDeclaredField("timer");field.setAccessible(true);
   ((ScheduledThreadPoolExecutor)field.get(guard)).submit(()->{}).get(2,TimeUnit.SECONDS);
   yes(!guard.failed()&&!guard.issued()&&guard.armed(next.token(),hash,1,6000)&&oldCalls.get()==1);
  }finally{oldReturn.countDown();}
  yes(oldCalls.get()==2);
  // Reopening a stopped-only cleanup cannot schedule another capture or claim
  // physical stop. The coordinator persists its peer/epoch before adoption.
  VoiceAnswerTest.Memory memory=new VoiceAnswerTest.Memory();
  VoiceAnswerSession interrupted=VoiceAnswerTest.prepared(memory,VoiceAnswerTest.connection("cutoff-recovery"));
  AtomicInteger recoveryCalls=new AtomicInteger();
  try(VoiceCaptureCutoff recovery=new VoiceCaptureCutoff(()->2000,(a,b,c)->recoveryCalls.incrementAndGet())){
   yes(!recovery.adoptRecovery(interrupted));VoiceAnswerTest.arm(interrupted);yes(!recovery.adoptRecovery(interrupted));
   VoiceAnswerSession restored=new VoiceAnswerSession(memory);yes(restored.phase().equals("RECOVERY"));yes(!recovery.adoptRecovery(restored));
   yes(restored.resumeCleanup(VoiceAnswerTest.PEER,2,1500));Object before=restored.snapshot();
   yes(recovery.adoptRecovery(restored)&&recovery.pending()&&recovery.issued()&&!recovery.failed());
   yes(TaskWire.same(before,restored.snapshot())&&recoveryCalls.get()==0);
   yes(!recovery.armed(restored.token(),hash,2,16000));
   yes(!recovery.arm(restored.token(),hash,2,5000)&&!recovery.adoptRecovery(restored));
   yes(!recovery.release(restored)&&restored.needsStop());
   VoiceAnswerTest.stopped(restored,2);yes(recovery.release(restored)&&!recovery.pending());
   yes(!recovery.adoptRecovery(restored));
  }
  yes(recoveryCalls.get()==0);
  VoiceCaptureCutoff alreadyClosed=new VoiceCaptureCutoff(()->2000,(a,b,c)->recoveryCalls.incrementAndGet());alreadyClosed.close();
  VoiceAnswerSession needsCleanup=VoiceAnswerTest.prepared(new VoiceAnswerTest.Memory(),VoiceAnswerTest.connection("cutoff-closed-recovery"));VoiceAnswerTest.arm(needsCleanup);yes(needsCleanup.stop(needsCleanup.token(),1500,false));
  yes(!alreadyClosed.adoptRecovery(needsCleanup)&&needsCleanup.needsStop()&&!alreadyClosed.pending());
 }
}
