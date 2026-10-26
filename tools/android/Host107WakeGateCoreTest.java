package com.turboio.addon;

import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.*;

/** JVM doubles only: no smali hook, SDK, Android, ASR, mic or stop evidence. */
public final class Host107WakeGateCoreTest {
 static final AtomicInteger assertions=new AtomicInteger();static int scenarios;
 interface Check {void run()throws Exception;}
 static void yes(boolean ok){assertions.incrementAndGet();if(!ok)throw new AssertionError("check "+assertions.get());}
 static void rejects(String code,Check action)throws Exception{try{action.run();throw new AssertionError("Expected "+code);}catch(IllegalStateException error){yes(code.equals(error.getMessage()));}}
 static void worker(Check action)throws Exception{AtomicReference<Throwable> failure=new AtomicReference<>();Thread thread=new Thread(()->{try{action.run();}catch(Throwable error){failure.set(error);}},"synthetic-stock-input");thread.start();thread.join(2000);yes(!thread.isAlive());if(failure.get()!=null)throw new AssertionError("worker failed",failure.get());}
 static void scenario(String name,Check action)throws Exception{action.run();scenarios++;System.out.println("PASS "+name);}
 static Host107WakeGateCore.Selection selected(String binding,String route,long revision){return new Host107WakeGateCore.Selection(binding,route,revision);}
 static Host107WakeGateCore.Current current(String peer,long epoch,Host107WakeGateCore.Selection selection){return new Host107WakeGateCore.Current(peer,epoch,selection);}
 static final class Fixture implements Host107WakeGateCore.Host {
  final Thread main=Thread.currentThread();final ArrayDeque<Runnable> tasks=new ArrayDeque<>();
  final Host107WakeGateCore gate=new Host107WakeGateCore(this);
  Host107WakeGateCore.Current current=Host107WakeGateCoreTest.current("peer-A",4,selected("codex-binding","route-A",7));
  long clock=100;boolean ready=true,release=true,post=true,throwPost,throwRelease,throwActivate,throwCurrent,throwOriginal,throwFatalActivate,throwCleanup,postThenThrow;
  int starts,releases,cleanups,originals;String lastOwner,lastCleanup;Runnable onRelease;Host107WakeGateCore.ReadyPermit permit;
  public boolean isMainThread(){return Thread.currentThread()==main;}
  public long elapsed(){return clock;}
  public Host107WakeGateCore.Current current(){yes(isMainThread());if(throwCurrent)throw new IllegalStateException("SYNTHETIC_CURRENT");return current;}
  public boolean postToMain(Runnable action){if(throwPost)throw new IllegalStateException("SYNTHETIC_POST");if(!post)return false;synchronized(tasks){tasks.add(action);}if(postThenThrow)throw new IllegalStateException("SYNTHETIC_POST_RECEIPT_LOST");return true;}
  public boolean preparedReady(Host107WakeGateCore.ReadyPermit value){yes(isMainThread());return ready;}
  public boolean releasePrepared(Host107WakeGateCore.ReadyPermit value){yes(isMainThread());releases++;if(onRelease!=null)onRelease.run();if(throwRelease)throw new IllegalStateException("SYNTHETIC_RELEASE");return release;}
  public void activate(Host107WakeGateCore.ReadyPermit value){yes(isMainThread());starts++;lastOwner=value.captureOwner;yes("COMMITTED".equals(gate.state(value)));if(throwActivate)throw new IllegalStateException("SYNTHETIC_START_RECEIPT_LOST");if(throwFatalActivate)throw new LinkageError("SYNTHETIC_ABI_CHANGED");}
  public void cleanup(Host107WakeGateCore.ReadyPermit value,String reason){yes(isMainThread());cleanups++;lastCleanup=reason;if(throwCleanup)throw new LinkageError("SYNTHETIC_CLEANUP_UNKNOWN");}
  void original(String expectedPeer,long expectedEpoch){originals++;if(throwOriginal)throw new IllegalStateException("SYNTHETIC_ORIGINAL_RECEIPT_LOST");}
  Host107WakeGateCore.ReadyPermit prepare(){return permit=gate.prepare(current,"delegate-capture-A",2000);}
  void runMain(){for(int n=0;n<50;n++){Runnable next;synchronized(tasks){next=tasks.poll();}if(next==null)return;next.run();}throw new AssertionError("unbounded callbacks");}
  Host107WakeGateCore.Decision wake(String peer,long epoch,int type,int rc,int mode,int callbackRc,Integer callbackMode,Integer link)throws Exception{
   AtomicReference<Host107WakeGateCore.Decision> out=new AtomicReference<>();worker(()->{try(Host107WakeGateCore.Inbound source=gate.beginTransport(peer,epoch,type,rc,mode,link)){out.set(gate.onWake(source,callbackRc,callbackMode,link,this::original));}});return out.get();
  }
  Host107WakeGateCore.Decision key()throws Exception{return wake("peer-A",4,1,3,0,3,null,2);}
 }
 static void ordinaryFallback()throws Exception{
  Fixture noPermit=new Fixture();yes(noPermit.key().disposition==Host107WakeGateCore.Disposition.ORIGINAL);yes(noPermit.originals==1&&noPermit.starts==0);
  Fixture f=new Fixture();f.prepare();worker(()->yes(f.gate.onWake(null,3,null,2,f::original).disposition==Host107WakeGateCore.Disposition.ORIGINAL));
  f.wake("peer-A",4,1,7,1,7,1,2);f.wake("peer-A",4,0xa1,3,0,3,null,2);f.wake("peer-A",4,0xa3,3,0,3,null,2);
  f.wake("peer-A",4,1,3,1,3,null,2);f.wake("peer-A",4,1,3,0,1,null,2);f.wake("peer-A",4,1,3,0,3,1,2);
  worker(()->{try(Host107WakeGateCore.Inbound scope=f.gate.beginTransport("peer-A",4,1,3,0,1)){f.gate.onWake(scope,3,null,2,f::original);}});
  yes(f.originals==8&&f.starts==0&&f.releases==0&&"READY".equals(f.gate.state(f.permit)));
 }
 static void exactOwnership()throws Exception{
  Fixture f=new Fixture();Host107WakeGateCore.ReadyPermit permit=f.prepare();Host107WakeGateCore.Decision first=f.key();yes(first.disposition==Host107WakeGateCore.Disposition.CLAIMED&&f.starts==0&&f.originals==0);
  for(int n=0;n<8;n++)yes(f.key().disposition==Host107WakeGateCore.Disposition.SUPPRESSED);
  f.runMain();yes(f.starts==1&&f.lastOwner.equals("delegate-capture-A")&&f.originals==0&&f.releases==0);f.runMain();f.gate.drain();yes(f.starts==1);
  yes(f.key().disposition==Host107WakeGateCore.Disposition.SUPPRESSED);rejects("WAKE_OWNER_BUSY",f::prepare);
  f.clock+=10000;f.gate.drain();yes(f.cleanups==0&&"COMMITTED".equals(f.gate.state(first.claim))); // capture cutoff is separate
  f.gate.captureReleased(permit);yes("RELEASED".equals(f.gate.state(permit)));f.prepare();f.key();f.runMain();yes(f.starts==2&&f.originals==0);
  rejects("WAKE_PERMIT_CHANGED",()->f.gate.captureReleased(permit));
 }
 static void sourceIdentity()throws Exception{
  Fixture f=new Fixture();f.prepare();f.wake("peer-B",4,1,3,0,3,null,2);f.wake("peer-A",3,1,3,0,3,null,2);f.wake("peer-A",5,1,3,0,3,null,2);
  yes(f.originals==3&&"READY".equals(f.gate.state(f.permit)));f.key();f.runMain();yes(f.starts==1);
 }
 static void frozenDefaults()throws Exception{
  for(int variant=0;variant<6;variant++){
   Fixture f=new Fixture();Host107WakeGateCore.ReadyPermit permit=f.prepare();f.key();
   if(variant==0)f.current=current("peer-A",4,selected("claude-binding","route-A",7));
   if(variant==1)f.current=current("peer-A",4,selected("codex-binding","route-B",7));
   if(variant==2)f.current=current("peer-A",4,selected("codex-binding","route-A",9)); // changed away and back
   if(variant==3)f.current=current("peer-B",4,selected("codex-binding","route-A",7));
   if(variant==4)f.current=current("peer-A",5,selected("codex-binding","route-A",7));
   if(variant==5)f.current=current("peer-A",4,null);
   int expectedOriginal=variant==3||variant==4?0:1;
   f.runMain();yes(f.starts==0&&f.releases==1&&f.originals==expectedOriginal&&f.cleanups==0);yes(permit.selection.binding.equals("codex-binding")&&permit.selection.revision==7&&permit.selection.routeFingerprint.equals("route-A"));
   f.gate.drain();f.runMain();yes(f.originals==expectedOriginal&&f.releases==1);
  }
 }
 static void revokedAndLateMain()throws Exception{
  Fixture f=new Fixture();Host107WakeGateCore.ReadyPermit p=f.prepare();Host107WakeGateCore.Decision d=f.key();worker(()->f.gate.revoke(p,"DEFAULT_CHANGED"));
  f.runMain();yes(f.starts==0&&f.releases==1&&f.originals==1&&"ORIGINAL_ATTEMPTED".equals(f.gate.state(d.claim)));
  f.gate.drain();f.runMain();yes(f.originals==1);rejects("WAKE_PERMIT_CHANGED",()->f.gate.revoke(p,"STALE"));
  Fixture late=new Fixture();late.prepare();late.key();late.clock=1100;late.gate.drain();yes(late.originals==1&&late.starts==0);
  Host107WakeGateCore.ReadyPermit newer=late.prepare();late.runMain();yes(late.starts==0&&"READY".equals(late.gate.state(newer)));late.key();late.runMain();yes(late.starts==1);
 }
 static void postingFailures()throws Exception{
  for(int mode=0;mode<3;mode++){
   Fixture f=new Fixture();f.prepare();f.post=mode!=0;f.throwPost=mode==1;f.key();
   yes(f.originals==0&&f.starts==0); // Cannot fallback while prepared release is still unknown.
   if(mode==2)f.clock=1100;
   f.gate.drain();yes(f.originals==1&&f.starts==0&&f.releases==1);f.runMain();yes(f.originals==1&&f.releases==1);
  }
  Fixture unknown=new Fixture();unknown.prepare();unknown.postThenThrow=true;unknown.key();unknown.runMain();yes(unknown.starts==0&&unknown.originals==1&&unknown.releases==1);
 }
 static void releaseUncertainty()throws Exception{
  for(boolean throwsRelease:new boolean[]{false,true}){
   Fixture f=new Fixture();f.prepare();f.key();f.ready=false;f.release=false;f.throwRelease=throwsRelease;f.runMain();
   yes(f.starts==0&&f.originals==0&&f.releases==1&&"RELEASE_BLOCKED".equals(f.gate.state(f.permit)));
   f.gate.drain();f.gate.revoke(f.permit,"RETRY_IS_NOT_PROOF");f.runMain();yes(f.releases==1&&f.originals==0);rejects("WAKE_OWNER_BUSY",f::prepare);
   rejects("WAKE_RELEASE_NOT_OWNED",()->f.gate.captureReleased(f.permit));
  }
 }
 static void committedFailures()throws Exception{
  Fixture f=new Fixture();f.prepare();f.throwActivate=true;Host107WakeGateCore.Decision d=f.key();f.runMain();
  yes(f.starts==1&&f.originals==0&&f.releases==0&&f.cleanups==1&&"CLEANUP".equals(f.gate.state(d.claim)));yes(f.lastCleanup.equals("WAKE_ACTIVATION_UNKNOWN"));
  f.gate.revoke(f.permit,"CONNECTION_CHANGED");f.runMain();f.gate.drain();yes(f.cleanups==1&&f.originals==0&&f.starts==1);
  f.gate.captureReleased(f.permit);f.prepare();f.runMain();yes(f.starts==1);
  Fixture changed=new Fixture();changed.prepare();changed.key();changed.runMain();changed.current=current("peer-A",4,selected("claude","route-C",8));
  worker(()->changed.gate.revoke(changed.permit,"DEFAULT_CHANGED"));changed.runMain();yes(changed.cleanups==1&&changed.originals==0&&changed.releases==0&&changed.lastOwner.equals("delegate-capture-A"));
  Fixture abi=new Fixture();abi.prepare();abi.throwFatalActivate=true;abi.throwCleanup=true;abi.key();abi.runMain();abi.gate.drain();yes(abi.starts==1&&abi.cleanups==1&&abi.originals==0&&"CLEANUP".equals(abi.gate.state(abi.permit)));
 }
 static void scopes()throws Exception{
  Fixture f=new Fixture();f.prepare();
  try(Host107WakeGateCore.Inbound outer=f.gate.beginTransport("peer-A",4,1,3,0,null)){
   try(Host107WakeGateCore.Inbound nested=f.gate.beginTransport("peer-A",4,0xa3,0,0,null)){
    rejects("WAKE_SCOPE_THREAD",outer::close);
    yes(f.gate.onWake(outer,3,null,null,f::original).disposition==Host107WakeGateCore.Disposition.SUPPRESSED);
    f.gate.onWake(nested,0,null,null,f::original);
   }
   worker(()->yes(f.gate.onWake(outer,3,null,null,f::original).disposition==Host107WakeGateCore.Disposition.SUPPRESSED));
   Host107WakeGateCore.Decision d=f.gate.onWake(outer,3,null,null,f::original);yes(d.disposition==Host107WakeGateCore.Disposition.CLAIMED);
   yes(f.gate.onWake(outer,3,null,null,f::original).disposition==Host107WakeGateCore.Disposition.SUPPRESSED);
  }
  f.runMain();yes(f.starts==1&&f.originals==1);
  Host107WakeGateCore.Inbound closed=f.gate.beginTransport("peer-A",4,1,3,0,null);closed.close();yes(f.gate.onWake(closed,3,null,null,f::original).disposition==Host107WakeGateCore.Disposition.SUPPRESSED);yes(f.originals==1);
  rejects("WAKE_SCOPE_THREAD",closed::close);
 }
 static void expiry()throws Exception{
  for(boolean backwards:new boolean[]{false,true}){
   Fixture f=new Fixture();f.prepare();f.key();f.clock=backwards?50:2100;f.runMain();yes(f.starts==0&&f.originals==1&&f.releases==1);
  }
  Fixture before=new Fixture();before.prepare();before.clock=2100;before.key();before.runMain();yes(before.starts==0&&before.originals==1&&before.releases==1);
  Fixture stale=new Fixture();stale.prepare();try(Host107WakeGateCore.Inbound source=stale.gate.beginTransport("peer-A",4,1,3,0,null)){stale.clock=1101;yes(stale.gate.onWake(source,3,null,null,stale::original).disposition==Host107WakeGateCore.Disposition.SUPPRESSED);}yes(stale.starts==0&&stale.originals==0);
  Fixture unclaimed=new Fixture();Host107WakeGateCore.ReadyPermit p=unclaimed.prepare();unclaimed.clock=2100;unclaimed.gate.drain();unclaimed.gate.drain();yes(unclaimed.releases==1&&unclaimed.originals==0&&"RELEASED".equals(unclaimed.gate.state(p)));
 }
 static void mainAndValidation()throws Exception{
  Fixture f=new Fixture();worker(()->rejects("WAKE_MAIN_REQUIRED",f::prepare));f.prepare();
  worker(()->rejects("WAKE_MAIN_REQUIRED",f.gate::drain));worker(()->rejects("WAKE_MAIN_REQUIRED",()->f.gate.captureReleased(f.permit)));
  rejects("WAKE_OWNER_BUSY",f::prepare);rejects("WAKE_ID_INVALID",()->selected(" ","route",1));rejects("WAKE_TIME_INVALID",()->selected("binding","route",0));
  Fixture none=new Fixture();none.current=current("peer-A",4,null);rejects("WAKE_DEFAULT_MISSING",none::prepare);
  Fixture stale=new Fixture();Host107WakeGateCore.Current old=stale.current;stale.current=current("peer-B",4,selected("codex-binding","route-A",7));rejects("WAKE_TARGET_CHANGED",()->stale.gate.prepare(old,"owner",100));
  Fixture notReady=new Fixture();notReady.ready=false;rejects("WAKE_CAPTURE_NOT_READY",notReady::prepare);yes(notReady.starts==0&&notReady.releases==0);
  Fixture bounds=new Fixture();rejects("WAKE_READY_WINDOW_INVALID",()->bounds.gate.prepare(bounds.current,"owner",5001));rejects("WAKE_READY_WINDOW_INVALID",()->bounds.gate.prepare(bounds.current,"owner",0));
  Fixture lookup=new Fixture();lookup.prepare();lookup.key();lookup.throwCurrent=true;lookup.runMain();yes(lookup.originals==0&&lookup.starts==0&&lookup.releases==1);
 }
 static void fallbackConnectionFence()throws Exception{
  for(boolean reconnect:new boolean[]{false,true}){
   Fixture changed=new Fixture();changed.prepare();changed.key();changed.ready=false;
   changed.onRelease=()->changed.current=current(reconnect?"peer-A":"peer-B",reconnect?5:4,selected("codex-binding","route-A",7));
   changed.runMain();yes(changed.releases==1&&changed.originals==0&&changed.starts==0&&"RELEASED".equals(changed.gate.state(changed.permit)));changed.runMain();yes(changed.originals==0);
   Fixture late=new Fixture();late.prepare();ArrayDeque<Runnable> sdkExecutor=new ArrayDeque<>();AtomicInteger dispatches=new AtomicInteger();
   worker(()->{try(Host107WakeGateCore.Inbound source=late.gate.beginTransport("peer-A",4,1,3,0,2)){
    late.gate.onWake(source,3,null,2,(peer,epoch)->{dispatches.incrementAndGet();yes("peer-A".equals(peer)&&epoch==4);sdkExecutor.add(()->{if(peer.equals(late.current.peer)&&epoch==late.current.epoch)late.original(peer,epoch);});});
   }});
   late.ready=false;late.runMain();yes(dispatches.get()==1&&late.originals==0&&sdkExecutor.size()==1);
   late.current=current(reconnect?"peer-A":"peer-B",reconnect?5:4,selected("codex-binding","route-A",7));sdkExecutor.remove().run();late.gate.drain();late.runMain();yes(late.originals==0&&dispatches.get()==1);
  }
 }
 static void originalUnknown()throws Exception{
  Fixture f=new Fixture();f.prepare();f.key();f.throwOriginal=true;f.ready=false;f.runMain();f.runMain();f.gate.drain();yes(f.originals==1&&f.releases==1&&f.starts==0);
  Fixture plain=new Fixture();plain.throwOriginal=true;plain.key();yes(plain.originals==1&&plain.starts==0);
 }
 static void concurrentWakes()throws Exception{
  Fixture f=new Fixture();f.prepare();CountDownLatch barrier=new CountDownLatch(1);AtomicReference<Throwable> error=new AtomicReference<>();AtomicInteger claims=new AtomicInteger();List<Thread> threads=new ArrayList<>();
  for(int n=0;n<12;n++){Thread thread=new Thread(()->{try{yes(barrier.await(2,TimeUnit.SECONDS));try(Host107WakeGateCore.Inbound scope=f.gate.beginTransport("peer-A",4,1,3,0,null)){if(f.gate.onWake(scope,3,null,null,f::original).disposition==Host107WakeGateCore.Disposition.CLAIMED)claims.incrementAndGet();}}catch(Throwable failure){error.compareAndSet(null,failure);}},"synthetic-simultaneous-input-"+n);threads.add(thread);thread.start();}
  barrier.countDown();for(Thread thread:threads){thread.join(2000);yes(!thread.isAlive());}if(error.get()!=null)throw new AssertionError("concurrent input failed",error.get());
  yes(claims.get()==1&&f.originals==0);f.runMain();yes(f.starts==1&&f.releases==0&&f.cleanups==0);
 }
 public static void main(String[] args)throws Exception{
  scenario("stock fallback and non-KEY isolation",Host107WakeGateCoreTest::ordinaryFallback);
  scenario("one exact capture owner and duplicate wake",Host107WakeGateCoreTest::exactOwnership);
  scenario("peer and connection epoch",Host107WakeGateCoreTest::sourceIdentity);
  scenario("frozen default revision and route",Host107WakeGateCoreTest::frozenDefaults);
  scenario("revocation and late MAIN callback",Host107WakeGateCoreTest::revokedAndLateMain);
  scenario("failed or missing MAIN delivery",Host107WakeGateCoreTest::postingFailures);
  scenario("unconfirmed prepared release blocks fallback",Host107WakeGateCoreTest::releaseUncertainty);
  scenario("post-commit failures only clean up",Host107WakeGateCoreTest::committedFailures);
  scenario("scope provenance thread lifetime and nesting",Host107WakeGateCoreTest::scopes);
  scenario("clock boundaries and unused preparation",Host107WakeGateCoreTest::expiry);
  scenario("MAIN affinity and explicit prerequisites",Host107WakeGateCoreTest::mainAndValidation);
  scenario("original dispatch lost receipt is not retried",Host107WakeGateCoreTest::originalUnknown);
  scenario("fallback connection and final executor fence",Host107WakeGateCoreTest::fallbackConnectionFence);
  scenario("concurrent ingress claims one permit",Host107WakeGateCoreTest::concurrentWakes);
  System.out.println("Wake gate core: "+scenarios+" scenarios, "+assertions.get()+" assertions passed; JVM doubles only, no hardware or runtime hook");
 }
}
