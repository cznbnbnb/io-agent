package com.turboio.addon;

import java.io.*;import java.lang.reflect.*;import java.util.*;import java.util.concurrent.*;

/** Actual runtime ingress -> collector -> journal, using synthetic wire bytes.
 * Android/native boundaries are test fixtures; no codec or hardware claims. */
public final class LifelogAudioRuntimeInputTest {
 private static int checks;private static final List<LifelogAudioRuntime> all=new ArrayList<>();
 private static final String A=repeat('a',64),B=repeat('d',64),PEER="peer-test";
 private static String repeat(char c,int n){char[] a=new char[n];Arrays.fill(a,c);return new String(a);}
 private static void yes(boolean value){checks++;if(!value)throw new AssertionError("input check "+checks);}
 private static Field field(Class<?> c,String name)throws Exception{Field f=c.getDeclaredField(name);f.setAccessible(true);return f;}
 private static Object get(Object self,String name)throws Exception{return field(self.getClass(),name).get(self);}
 private static void set(Object self,String name,Object value)throws Exception{field(self.getClass(),name).set(self,value);}
 private static long n(Object self,String name)throws Exception{return ((Number)get(self,name)).longValue();}
 private static Object call(Object self,String name)throws Exception{Method m=self.getClass().getDeclaredMethod(name);m.setAccessible(true);try{return m.invoke(self);}catch(InvocationTargetException e){throw new AssertionError(e.getCause());}}
 private static void stopMonitor(LifelogAudioRuntime self)throws Exception{ScheduledExecutorService service=(ScheduledExecutorService)get(self,"contextIO");service.shutdownNow();yes(service.awaitTermination(3,TimeUnit.SECONDS));}
 private static LifelogAudioRuntime runtime(File files)throws Exception{
  yes(files.mkdir());android.os.Handler.enabled=true;android.os.Handler.hold=false;Host107Login.active=new OfficialAccountBinding(A);Host107Login.delayMs=Host107Login.readCostMs=0;android.os.SystemClock.now=100000;
  Constructor<LifelogAudioRuntime> c=LifelogAudioRuntime.class.getDeclaredConstructor(android.content.Context.class);c.setAccessible(true);LifelogAudioRuntime self=c.newInstance(new android.content.Context(files));all.add(self);
  ScheduledExecutorService io=(ScheduledExecutorService)get(self,"io");io.shutdownNow();yes(io.awaitTermination(3,TimeUnit.SECONDS));long until=System.nanoTime()+TimeUnit.SECONDS.toNanos(3);
  while(get(self,"token")==null&&System.nanoTime()<until)Thread.sleep(1);yes(get(self,"token")!=null);field(LifelogAudioRuntime.class,"instance").set(null,self);return self;
 }
 @SuppressWarnings("unchecked") private static ArrayDeque<Object> queue(LifelogAudioRuntime self)throws Exception{return (ArrayDeque<Object>)get(self,"queue");}
 private static byte[] raw(Object event)throws Exception{return (byte[])get(event,"raw");}
 private static void zero(Object event)throws Exception{for(byte b:raw(event))yes(b==0);}
 private static void empty(LifelogAudioRuntime self)throws Exception{yes(queue(self).isEmpty()&&n(self,"queuedInputs")==0&&n(self,"queuedBytes")==0);}
 private static void noDisk(File files)throws Exception{yes(!new File(files,"lifelog-audio").exists()&&!new File(files,"lifelog-audio-library").exists());}
 private static void number(ByteArrayOutputStream out,long value){while(value>127){out.write((int)(value&127)|128);value>>>=7;}out.write((int)value);}
 private static byte[] wire(String task,int marker){ByteArrayOutputStream out=new ByteArrayOutputStream();out.write(8);out.write(1);out.write(16);number(out,0xa3);byte[] message=WireJson.bytes(WireJson.object("taskId",task));out.write(26);number(out,message.length);out.write(message,0,message.length);out.write(34);number(out,240);for(int i=0;i<240;i++)out.write(marker);return out.toByteArray();}
 private static Thread tick(LifelogAudioRuntime self)throws Exception{Thread thread=new Thread(()->{try{call(self,"tick");}catch(Exception e){throw new AssertionError(e);}},"test-runtime-io");thread.start();long until=System.nanoTime()+TimeUnit.SECONDS.toNanos(1);while(thread.getState()!=Thread.State.TIMED_WAITING&&thread.isAlive()&&System.nanoTime()<until)Thread.sleep(1);yes(thread.getState()==Thread.State.TIMED_WAITING);return thread;}
 private static void join(Thread thread)throws Exception{thread.join(10000);yes(!thread.isAlive());}
 private static Object changed(Object token,String account,String peer,String task,long generation,long epoch)throws Exception{Constructor<?> c=token.getClass().getDeclaredConstructors()[0];c.setAccessible(true);return c.newInstance(account,peer,task,generation,epoch,android.os.SystemClock.now);}
 private static void close(LifelogAudioRuntime self){try{Object collector=get(self,"collector");if(collector!=null)((LifelogAudioCollector)collector).stop("capture_stopped").get(6,TimeUnit.SECONDS);Object library=get(self,"library");if(library!=null)((LifelogAudioLibrary)library).close();for(String executor:new String[]{"io","contextIO"})((ScheduledExecutorService)get(self,executor)).shutdownNow();}catch(Exception ignored){/* Preserve an earlier assertion, but always stop executors below. */}finally{for(String executor:new String[]{"io","contextIO"})try{((ScheduledExecutorService)get(self,executor)).shutdownNow();}catch(Exception ignored){}}}
 public static void main(String[] args)throws Exception{File root=new File(args[0]);try{
  File success=new File(root,"success");LifelogAudioRuntime self=runtime(success);android.os.Handler.hold=true;Host107Login.delayMs=100;android.os.SystemClock.now+=4000;
  byte[] one=wire("task-one",1),expectedOne=one.clone(),two=wire("task-one",2);long began=System.nanoTime();LifelogAudioRuntime.incoming(PEER,one);yes(TimeUnit.NANOSECONDS.toMillis(System.nanoTime()-began)<500);Object first=queue(self).peek();yes(first!=null);one[0]=0;android.os.SystemClock.now++;LifelogAudioRuntime.incoming(PEER,two);Object second=queue(self).getLast();yes(queue(self).size()==2&&n(self,"deferredInputs")==2);noDisk(success);
  Thread saving=tick(self);yes(n(self,"queuedInputs")==2&&n(self,"queuedBytes")==expectedOne.length+two.length);noDisk(success);android.os.Handler.release();join(saving);
  LifelogAudioCollector collector=(LifelogAudioCollector)get(self,"collector");yes(collector!=null);Map<String,Object> terminal=collector.stop("capture_stopped").get(8,TimeUnit.SECONDS);yes("STOPPED".equals(terminal.get("phase"))&&((Number)terminal.get("saved_batches")).longValue()==2);yes(n(self,"revalidatedInputs")==2&&n(self,"unverifiedInput")==0);empty(self);zero(first);zero(second);
  Object token=get(self,"active");String clock=(String)get(self,"clock"),peer=(String)get(token,"peer");try(LifelogAudioManager manager=new LifelogAudioManager(success,A,peer,1,clock,LifelogAudioManager.Limits.standard(),()->{})){
   int[] at={0};Object[] events={first,second};byte[][] bytes={expectedOne,two};manager.visit(1,b->{try{int i=at[0]++;yes(Arrays.equals(b.payload(),bytes[i]));yes(((Number)b.metadata.get("received_at")).longValue()==n(events[i],"at"));yes(((Number)b.metadata.get("elapsed_nanos")).longValue()==n(events[i],"elapsed"));}catch(Exception e){throw new IOException(e);}});yes(at[0]==2);
  }close(self);Host107Login.delayMs=0;
  // No pending bytes reach disk after any identity or epoch boundary, including
  // a return to the same account under a new epoch.
  for(String kind:new String[]{"account","peer","task","generation","epoch","unavailable"}){
   File denied=new File(root,"denied-"+kind);LifelogAudioRuntime reject=runtime(denied);stopMonitor(reject);Object before=get(reject,"token");android.os.SystemClock.now+=4000;LifelogAudioRuntime.incoming(PEER,wire("task-one",3));Object event=queue(reject).peek();yes(event!=null);long epoch=n(before,"epoch");String boundPeer=(String)get(before,"peer");Object after=kind.equals("unavailable")?null:changed(before,kind.equals("account")?B:A,kind.equals("peer")?repeat('e',64):boundPeer,kind.equals("task")?"task-two":"task-one",kind.equals("generation")?2:1,kind.equals("epoch")?epoch+1:epoch);set(reject,"token",after);call(reject,"tick");empty(reject);zero(event);noDisk(denied);yes(n(reject,"unverifiedInput")==1);close(reject);
  }
  File expired=new File(root,"expired");LifelogAudioRuntime late=runtime(expired);stopMonitor(late);android.os.SystemClock.now+=4000;LifelogAudioRuntime.incoming(PEER,wire("task-one",4));Object old=queue(late).peek();yes(old!=null);Object before=get(late,"token");android.os.SystemClock.now+=10001;set(late,"token",changed(before,A,(String)get(before,"peer"),"task-one",1,n(before,"epoch")));call(late,"tick");empty(late);zero(old);noDisk(expired);yes(n(late,"unverifiedInput")==1);close(late);
  // Budget includes the event removed from the queue but still awaiting native
  // verification. Overflow stops acceptance; all retained bytes are wiped.
  File bounded=new File(root,"bounded");LifelogAudioRuntime full=runtime(bounded);android.os.Handler.hold=true;android.os.SystemClock.now+=4000;byte[] large=new byte[65536];Arrays.fill(large,(byte)7);LifelogAudioRuntime.incoming(PEER,large);List<Object> held=new ArrayList<>();held.add(queue(full).peek());Thread waiting=tick(full);for(int i=0;i<31;i++)LifelogAudioRuntime.incoming(PEER,large);held.addAll(queue(full));yes(n(full,"queuedInputs")==32&&n(full,"queuedBytes")==2097152&&queue(full).size()==31);LifelogAudioRuntime.incoming(PEER,large);yes(n(full,"queuedInputs")==32&&n(full,"dropped")==1);noDisk(bounded);android.os.Handler.release();join(waiting);empty(full);noDisk(bounded);for(Object event:held)yes(Arrays.equals(raw(event),new byte[65536]));yes(n(full,"unverifiedInput")==32);close(full);
  System.out.println("Lifelog audio runtime input: "+checks+" checks passed; deferred originals, FIFO/timestamps, identity denial, expiry and inflight capacity");
 }finally{for(LifelogAudioRuntime self:all)close(self);field(LifelogAudioRuntime.class,"instance").set(null,null);android.os.Handler.release();}}
}
