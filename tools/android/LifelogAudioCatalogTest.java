package com.turboio.addon;

import java.io.*;import java.nio.file.*;import java.util.*;import java.util.concurrent.*;import java.util.concurrent.atomic.*;

/** Real manager/collector ordering and bounded read-only discovery, not capture. */
public final class LifelogAudioCatalogTest {
 static int checks;static final String A=repeat('a',64),P=repeat('b',64),C=repeat('c',32);
 static String repeat(char c,int n){char[] v=new char[n];Arrays.fill(v,c);return new String(v);}
 static void yes(boolean v){checks++;if(!v)throw new AssertionError("catalog check "+checks);}
 static long n(Map<String,Object> v,String key){return ((Number)v.get(key)).longValue();}
 static List<Object> await(CompletableFuture<List<Object>> f)throws Exception{return f.get(8,TimeUnit.SECONDS);}
 static void denied(CompletableFuture<List<Object>> f,String code)throws Exception{try{await(f);throw new AssertionError("barrier accepted");}catch(ExecutionException e){yes(code.equals(e.getCause().getMessage()));}}
 static Map<String,Object> stop(LifelogAudioCollector c)throws Exception{return c.stop("capture_stopped").get(8,TimeUnit.SECONDS);}
 static Map<String,Object> context(){return WireJson.object("account",A,"peer",P,"generation",1L,"clock_epoch",C);}
 static LifelogAudioCollector.Offer offer(LifelogAudioCollector c,int value){return c.offer(P,1,"A3","{}",new byte[]{(byte)value},1000+value,2+value);}
 static final class Health implements LifelogAudioCollector.Health {
  public void start(Map<String,Object> v){}public void finish(Map<String,Object> v){}public Map<String,Object> snapshot(){return null;}public void close(){}
 }
 static final class Sink implements LifelogAudioCollector.Sink {
  final CountDownLatch appendEntered=new CountDownLatch(1),appendRelease=new CountDownLatch(1),catalogEntered=new CountDownLatch(1),catalogRelease=new CountDownLatch(1);
  final List<Object> values=new ArrayList<>();final List<Integer> sealedAt=new ArrayList<>();boolean blockAppend,blockCatalog,failCatalog,fatalCatalog;int seals,ends;
  public long next(){return 1;}
  static void waitFor(CountDownLatch latch)throws IOException{try{if(!latch.await(5,TimeUnit.SECONDS))throw new IOException("TEST_BARRIER_TIMEOUT");}catch(InterruptedException e){Thread.currentThread().interrupt();throw new IOException("TEST_INTERRUPTED");}}
  public void append(long seq,String kind,String message,byte[] raw,long at,long elapsed)throws IOException{appendEntered.countDown();if(blockAppend)waitFor(appendRelease);values.add(WireJson.object("sequence",seq));}
  public List<Object> catalog()throws IOException{catalogEntered.countDown();if(blockCatalog)waitFor(catalogRelease);if(fatalCatalog)throw new AssertionError("TEST_FATAL_CATALOG");if(failCatalog)throw new IOException("AUDIO_CATALOG_READ_FAILED");return values;}
  public List<Object> checkpoint()throws IOException{seals++;sealedAt.add(values.size());return catalog();}public void end(String reason){ends++;}public void close(){}
 }
 static LifelogAudioCollector fake(Sink sink,AtomicBoolean gate)throws Exception{return new LifelogAudioCollector(context(),sink,new Health(),LifelogAudioCollector.Limits.standard(),(p,g)->gate.get());}
 public static void main(String[] args)throws Exception{
  File files=new File(args[0]);yes(files.mkdir());
  LifelogAudioCollector real=LifelogAudioCollector.open(files,A,P,1,C,LifelogAudioManager.Limits.standard(),LifelogAudioCollector.Limits.standard(),(p,g)->true,()->{});
  String stream=null;for(int i=0;i<320;i++){yes(offer(real,i)==LifelogAudioCollector.Offer.QUEUED);List<Object> rows=await(real.catalog());yes(rows.size()==1);Map<String,Object> row=WireJson.map(rows.get(0));yes("open".equals(row.get("phase"))&&n(row,"count")==i+1);yes(A.equals(WireJson.map(row.get("context")).get("account")));if(stream==null)stream=(String)row.get("stream");else yes(stream.equals(row.get("stream")));}
  // Repeated reads leave all journal and manager receipt bytes unchanged.
  Path manager=new File(files,"lifelog-audio/manager.json").toPath(),journal=new File(files,"lifelog-audio/"+A+"/"+stream+"/original.frames").toPath(),state=journal.resolveSibling("state.json");
  byte[] beforeManager=Files.readAllBytes(manager),beforeJournal=Files.readAllBytes(journal),beforeState=Files.readAllBytes(state);
  List<Object> isolated=await(real.catalog());WireJson.map(WireJson.map(isolated.get(0)).get("context")).put("account","mutated");
  for(int i=0;i<320;i++)yes(await(real.catalog()).size()==1);
  yes(Arrays.equals(beforeManager,Files.readAllBytes(manager))&&Arrays.equals(beforeJournal,Files.readAllBytes(journal))&&Arrays.equals(beforeState,Files.readAllBytes(state)));
  List<Object> sealed=await(real.checkpoint());yes(sealed.size()==1&&"sealed".equals(WireJson.map(sealed.get(0)).get("phase")));
  yes(offer(real,321)==LifelogAudioCollector.Offer.QUEUED);List<Object> continued=await(real.catalog());yes(continued.size()==2);yes("open".equals(WireJson.map(continued.get(1)).get("phase"))&&n(WireJson.map(continued.get(1)),"first_sequence")==321);yes(A.equals(WireJson.map(WireJson.map(continued.get(1)).get("context")).get("account")));
  Map<String,Object> terminal=stop(real);yes(n(terminal,"accepted_batches")==321&&n(terminal,"saved_batches")==321&&n(terminal,"unconfirmed_batches")==0);yes(Boolean.FALSE.equals(terminal.get("recording_complete")));denied(real.catalog(),"AUDIO_CHECKPOINT_BUSY");

  Sink ordered=new Sink();ordered.blockAppend=true;LifelogAudioCollector c=fake(ordered,new AtomicBoolean(true));yes(offer(c,1)==LifelogAudioCollector.Offer.QUEUED);yes(ordered.appendEntered.await(3,TimeUnit.SECONDS));CompletableFuture<List<Object>> pending=c.catalog();yes(!pending.isDone());denied(c.catalog(),"AUDIO_CHECKPOINT_BUSY");denied(c.checkpoint(),"AUDIO_CHECKPOINT_BUSY");yes(offer(c,2)==LifelogAudioCollector.Offer.QUEUED);ordered.appendRelease.countDown();List<Object> first=await(pending);yes(first.size()==1&&n(WireJson.map(first.get(0)),"sequence")==1);yes(await(c.catalog()).size()==2);yes(first.size()==1);yes(ordered.seals==0);terminal=stop(c);yes(n(terminal,"saved_batches")==2&&ordered.ends==1);

  Sink draining=new Sink();draining.blockCatalog=true;c=fake(draining,new AtomicBoolean(true));pending=c.catalog();yes(draining.catalogEntered.await(3,TimeUnit.SECONDS));CompletableFuture<Map<String,Object>> stopping=c.stop("capture_stopped");yes(!stopping.isDone());draining.catalogRelease.countDown();yes(await(pending).isEmpty());yes("STOPPED".equals(stopping.get(8,TimeUnit.SECONDS).get("phase"))&&draining.seals==0&&draining.ends==1);

  Sink changed=new Sink();changed.blockCatalog=true;AtomicBoolean gate=new AtomicBoolean(true);c=fake(changed,gate);pending=c.catalog();yes(changed.catalogEntered.await(3,TimeUnit.SECONDS));gate.set(false);changed.catalogRelease.countDown();denied(pending,"AUDIO_COLLECTOR_CONTEXT_CHANGED");terminal=stop(c);yes("FAILED".equals(terminal.get("phase"))&&changed.ends==0&&n(terminal,"accepted_batches")==0);

  Sink failed=new Sink();failed.failCatalog=true;c=fake(failed,new AtomicBoolean(true));denied(c.catalog(),"AUDIO_CATALOG_READ_FAILED");terminal=stop(c);yes("AUDIO_CATALOG_READ_FAILED".equals(terminal.get("error"))&&failed.ends==0);denied(c.catalog(),"AUDIO_CHECKPOINT_BUSY");
  Sink fatal=new Sink();fatal.fatalCatalog=true;c=fake(fatal,new AtomicBoolean(true));denied(c.catalog(),"TEST_FATAL_CATALOG");terminal=stop(c);yes("FAILED".equals(terminal.get("phase"))&&fatal.ends==0);

  // A source boundary shares the raw event's existing memory budget and FIFO
  // position. Later accepted bytes remain writable; no delayed seal callback.
  Sink boundary=new Sink();boundary.blockAppend=true;c=fake(boundary,new AtomicBoolean(true));yes(offer(c,1)==LifelogAudioCollector.Offer.QUEUED);yes(boundary.appendEntered.await(3,TimeUnit.SECONDS));yes(c.offer(P,1,"A5","{}",new byte[]{2},1002,4,true)==LifelogAudioCollector.Offer.QUEUED);yes(offer(c,3)==LifelogAudioCollector.Offer.QUEUED);boundary.appendRelease.countDown();yes(await(c.catalog()).size()==3);yes(boundary.seals==1&&boundary.sealedAt.equals(Arrays.asList(2)));yes("RUNNING".equals(c.snapshot().get("phase")));terminal=stop(c);yes(n(terminal,"saved_batches")==3&&n(terminal,"unconfirmed_batches")==0);

  // Append can be durable while the seal fails. Do not acknowledge that event
  // as fully saved or write later events after the failing boundary.
  Sink sealFailure=new Sink();sealFailure.blockAppend=true;sealFailure.failCatalog=true;c=fake(sealFailure,new AtomicBoolean(true));yes(c.offer(P,1,"A5","{}",new byte[]{1},1001,3,true)==LifelogAudioCollector.Offer.QUEUED);yes(sealFailure.appendEntered.await(3,TimeUnit.SECONDS));yes(offer(c,2)==LifelogAudioCollector.Offer.QUEUED);sealFailure.appendRelease.countDown();terminal=stop(c);yes("AUDIO_CATALOG_READ_FAILED".equals(terminal.get("error"))&&n(terminal,"saved_batches")==0&&n(terminal,"unconfirmed_batches")==2);yes(sealFailure.values.size()==1&&sealFailure.ends==0);

  Sink staleBoundary=new Sink();staleBoundary.blockCatalog=true;AtomicBoolean fresh=new AtomicBoolean(true);c=fake(staleBoundary,fresh);yes(c.offer(P,1,"A5","{}",new byte[]{1},1001,3,true)==LifelogAudioCollector.Offer.QUEUED);yes(staleBoundary.catalogEntered.await(3,TimeUnit.SECONDS));yes(offer(c,2)==LifelogAudioCollector.Offer.QUEUED);fresh.set(false);staleBoundary.catalogRelease.countDown();terminal=stop(c);yes("AUDIO_COLLECTOR_CONTEXT_CHANGED".equals(terminal.get("error"))&&n(terminal,"saved_batches")==0&&n(terminal,"unconfirmed_batches")==2);yes(staleBoundary.values.size()==1&&staleBoundary.ends==0);
  System.out.println("Lifelog audio catalog: "+checks+" checks passed; ordered metadata only, no seal on polling");
 }
}
