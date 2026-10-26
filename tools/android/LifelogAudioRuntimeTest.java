package com.turboio.addon;

import java.io.*;import java.lang.reflect.*;import java.util.*;import java.util.concurrent.*;

/** Exercises the production runtime guard, including the growing recovery scan
 * which used to synchronously read the secure store for each journal record. */
public final class LifelogAudioRuntimeTest {
 private static int checks;
 private static final String A=repeat('a',64),B=repeat('d',64),P=repeat('b',64),C=repeat('c',32);
 private static String repeat(char c,int n){char[] a=new char[n];Arrays.fill(a,c);return new String(a);}
 private static void yes(boolean value){checks++;if(!value)throw new AssertionError("check "+checks);}
 private static Field field(Class<?> c,String name)throws Exception{Field f=c.getDeclaredField(name);f.setAccessible(true);return f;}
 private static Object token(String account,String peer,String task,long generation,long epoch,long at)throws Exception{
  Constructor<?> c=Class.forName("com.turboio.addon.LifelogAudioRuntime$Token").getDeclaredConstructors()[0];c.setAccessible(true);return c.newInstance(account,peer,task,generation,epoch,at);
 }
 private static void checkGuard(LifelogAudioRuntime self,Object bound)throws IOException{
  try{Method m=LifelogAudioRuntime.class.getDeclaredMethod("writerGuard",bound.getClass());m.setAccessible(true);m.invoke(self,bound);}catch(InvocationTargetException e){if(e.getCause() instanceof IOException)throw (IOException)e.getCause();throw new AssertionError(e.getCause());}catch(ReflectiveOperationException e){throw new AssertionError(e);}
 }
 private static void rejected(LifelogAudioRuntime self,Object bound,String code)throws Exception{try{checkGuard(self,bound);throw new AssertionError("guard accepted "+code);}catch(IOException expected){yes(code.equals(expected.getMessage()));}}
 private static LifelogAudioRuntime monitored(Constructor<LifelogAudioRuntime> constructor)throws Exception{LifelogAudioRuntime self=constructor.newInstance(new android.content.Context());((ScheduledExecutorService)field(LifelogAudioRuntime.class,"io").get(self)).shutdownNow();long until=System.nanoTime()+TimeUnit.SECONDS.toNanos(3);while(field(LifelogAudioRuntime.class,"token").get(self)==null&&System.nanoTime()<until)Thread.sleep(1);yes(field(LifelogAudioRuntime.class,"token").get(self)!=null);return self;}
 private static void closeMonitor(LifelogAudioRuntime self)throws Exception{ScheduledExecutorService service=(ScheduledExecutorService)field(LifelogAudioRuntime.class,"contextIO").get(self);service.shutdownNow();yes(service.awaitTermination(3,TimeUnit.SECONDS));}
 public static void main(String[] args)throws Exception{
  Host107Login.active=new OfficialAccountBinding(A);
  Constructor<LifelogAudioRuntime> c=LifelogAudioRuntime.class.getDeclaredConstructor(android.content.Context.class);c.setAccessible(true);LifelogAudioRuntime self=c.newInstance(new android.content.Context());
  for(String name:new String[]{"io","contextIO"}){ScheduledExecutorService service=(ScheduledExecutorService)field(LifelogAudioRuntime.class,name).get(self);service.shutdownNow();yes(service.awaitTermination(3,TimeUnit.SECONDS));}
  Object bound=token(A,P,"task-one",1,1,1000);Field current=field(LifelogAudioRuntime.class,"token");current.set(self,bound);
  Host107Login.reads=0;Host107Login.readCostMs=100;
  // A secure-store read which consumes 100ms per guard would expire the lease
  // while scanning a growing journal. No such IO belongs on this writer path.
  File files=new File(args[0]);int[] guarded={0};
  LifelogAudioArchive.Guard guard=()->{guarded[0]++;checkGuard(self,bound);};
  LifelogAudioCollector collector=LifelogAudioCollector.open(files,A,P,1,C,new LifelogAudioManager.Limits(262144,131072,16),LifelogAudioCollector.Limits.standard(),(p,g)->true,guard);
  for(int i=0;i<150;i++){
   yes(collector.offer(P,1,"A3","{}",new byte[128],10000+i,i)==LifelogAudioCollector.Offer.QUEUED);
   long until=System.nanoTime()+TimeUnit.SECONDS.toNanos(3);while(((Number)collector.snapshot().get("saved_batches")).longValue()<i+1&&"RUNNING".equals(collector.snapshot().get("phase"))&&System.nanoTime()<until)Thread.sleep(1);
   yes(((Number)collector.snapshot().get("saved_batches")).longValue()==i+1);
  }
  Map<String,Object> result=collector.stop("capture_stopped").get(8,TimeUnit.SECONDS);
  yes("STOPPED".equals(result.get("phase")));yes(((Number)result.get("saved_batches")).longValue()==150);
  yes(guarded[0]>1000);yes(Host107Login.reads==0);yes(android.os.SystemClock.now==1000);
  try(LifelogAudioManager manager=new LifelogAudioManager(files,A,P,1,C,new LifelogAudioManager.Limits(262144,131072,16),guard)){
   int[] stored={0};manager.visit(1,b->{yes(b.payload().length==128);stored[0]++;});yes(stored[0]==150);
  }
  // A slow account read is removed; all actual admission boundaries still fail
  // closed. Neither fresh unrelated snapshots nor a return to the same account
  // with a new epoch can revive an old writer.
  android.os.SystemClock.now=4001;rejected(self,bound,"AUDIO_CAPTURE_CONTEXT_STALE");
  android.os.SystemClock.now=1001;current.set(self,null);rejected(self,bound,"AUDIO_CAPTURE_CONTEXT_UNAVAILABLE");
  current.set(self,token(B,P,"task-one",1,2,1000));rejected(self,bound,"OFFICIAL_ACCOUNT_CHANGED");
  for(Object changed:new Object[]{token(A,repeat('e',64),"task-one",1,1,1000),token(A,P,"task-one",2,1,1000),token(A,P,"task-two",1,1,1000),token(A,P,"task-one",1,2,1000)}){current.set(self,changed);rejected(self,bound,"AUDIO_CAPTURE_CONTEXT_CHANGED");}
  current.set(self,token(A,P,"task-one",1,1,1001));checkGuard(self,bound);yes(true);
  current.set(self,token(A,P,"task-one",1,1,1002));rejected(self,bound,"AUDIO_CAPTURE_CONTEXT_STALE");
  Host107Login.readCostMs=0;Host107Login.active=null;try{LifelogAudioRuntime.account(A);throw new AssertionError();}catch(IOException e){yes("OFFICIAL_LOGIN_UNAVAILABLE".equals(e.getMessage()));}
  Host107Login.active=new OfficialAccountBinding(B);try{LifelogAudioRuntime.account(A);throw new AssertionError();}catch(IOException e){yes("OFFICIAL_ACCOUNT_CHANGED".equals(e.getMessage()));}
  // Exercise the actual asynchronous account -> main/native -> account monitor.
  // Twenty expired writer checks share one refresh, while the original 3s
  // freshness limit and all identity checks remain in effect.
  Host107Login.active=new OfficialAccountBinding(A);Host107Login.delayMs=25;android.os.Handler.enabled=true;android.os.SystemClock.now=10000;
  LifelogAudioRuntime wake=monitored(c);Object sleeping=current.get(wake);long epoch=field(sleeping.getClass(),"epoch").getLong(sleeping);int before=Host107Login.reads;
  android.os.SystemClock.now+=4000;ExecutorService writers=Executors.newFixedThreadPool(20);List<Future<?>> pending=new ArrayList<>();
  for(int i=0;i<20;i++)pending.add(writers.submit(()->{checkGuard(wake,sleeping);return null;}));
  for(Future<?> writer:pending){writer.get(5,TimeUnit.SECONDS);yes(true);}writers.shutdown();yes(writers.awaitTermination(3,TimeUnit.SECONDS));
  yes(Host107Login.reads-before==2);yes(field(current.get(wake).getClass(),"epoch").getLong(current.get(wake))==epoch);yes(android.os.SystemClock.now-field(current.get(wake).getClass(),"checked").getLong(current.get(wake))<=3000);
  Thread.sleep(1200);yes(Host107Login.reads-before==4); // one periodic chain after urgent refresh
  Host107Login.active=new OfficialAccountBinding(B);android.os.SystemClock.now+=4000;rejected(wake,sleeping,"OFFICIAL_ACCOUNT_CHANGED");
  File denied=new File(files,"changed-account");yes(denied.mkdir());try{new LifelogAudioManager(denied,A,P,1,repeat('e',32),new LifelogAudioManager.Limits(262144,131072,16),()->checkGuard(wake,sleeping));throw new AssertionError("wrong-account write");}catch(IOException e){yes("OFFICIAL_ACCOUNT_CHANGED".equals(e.getMessage()));}yes(!new File(denied,"lifelog-audio").exists());closeMonitor(wake);
  Host107Login.active=new OfficialAccountBinding(A);LifelogAudioRuntime stalled=monitored(c);Object stale=current.get(stalled);android.os.Handler.enabled=false;android.os.SystemClock.now+=4000;long began=System.nanoTime();rejected(stalled,stale,"AUDIO_CAPTURE_CONTEXT_STALE");long waited=TimeUnit.NANOSECONDS.toMillis(System.nanoTime()-began);yes(waited>=3500&&waited<5000);yes(field(LifelogAudioRuntime.class,"refreshTimeouts").getLong(stalled)==1);
  boolean[] interrupted={false,false};Thread cancelled=new Thread(()->{try{checkGuard(stalled,stale);}catch(IOException e){interrupted[0]="AUDIO_CAPTURE_CONTEXT_STALE".equals(e.getMessage());interrupted[1]=Thread.currentThread().isInterrupted();}});cancelled.start();long waiting=System.nanoTime()+TimeUnit.SECONDS.toNanos(1);while(cancelled.getState()!=Thread.State.TIMED_WAITING&&System.nanoTime()<waiting)Thread.sleep(1);yes(cancelled.getState()==Thread.State.TIMED_WAITING);cancelled.interrupt();cancelled.join(1000);yes(!cancelled.isAlive()&&interrupted[0]&&interrupted[1]);closeMonitor(stalled);Host107Login.delayMs=0;
  System.out.println("Lifelog audio runtime: "+checks+" checks passed; real filesystem; "+guarded[0]+" nonblocking guard calls");
 }
}
