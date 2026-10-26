package com.turboio.addon;

import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.LongSupplier;

/** One bound native ASR listener; serial durable updates never use a mutable default route. */
final class VoiceDraftCallbacks implements Host107VoiceTask.Listener,AutoCloseable {
 interface Events {void changed();void stopRequired(String token,String code);}
 private final CaptureSession draft;private final String token,peer;private final long generation;
 private final LongSupplier clock;private final Events events;private final ThreadPoolExecutor worker;
 private final AtomicBoolean fault=new AtomicBoolean();private boolean accepting=true,closed;private volatile boolean drained;
 private CompletableFuture<Boolean> sealing;
 VoiceDraftCallbacks(CaptureSession draft,String peer,long generation,LongSupplier clock,Events events){
  TaskWire.require(draft!=null&&draft.healthy()&&draft.phase().equals("CAPTURING")&&clock!=null&&events!=null,"VOICE_CALLBACK_OWNER_INVALID");
  Map<String,Object> saved=WireJson.map(draft.snapshot());
  TaskWire.require(peer!=null&&FixedPeerHash.of(peer).equals(saved.get("peer"))&&generation==TaskWire.positive(saved.get("generation")),"VOICE_CALLBACK_OWNER_INVALID");
  this.draft=draft;this.token=draft.token();this.peer=peer;this.generation=generation;this.clock=clock;this.events=events;
  worker=new ThreadPoolExecutor(1,1,0,TimeUnit.MILLISECONDS,new ArrayBlockingQueue<>(128),r->{Thread t=new Thread(r,"iO-Agent-ASR-draft");t.setDaemon(true);return t;});
 }
 private void changed(){try{events.changed();}catch(RuntimeException ignored){}}
 private void requestStop(String code){try{events.stopRequired(token,code);}catch(RuntimeException ignored){/* Independent capture cutoff remains armed. */}}
 private void fail(String code){if(fault.compareAndSet(false,true)){requestStop(code);try{draft.failed(token,peer,generation,code,clock.getAsLong());}catch(Exception ignored){}changed();}}
 private void enqueue(Runnable action){
  boolean rejected=false;
  synchronized(this){
   if(closed||!accepting)return;
   try{worker.execute(()->{try{action.run();}catch(RuntimeException failed){fail("VOICE_CALLBACK_DISPATCH_FAILED");}});}
   catch(RejectedExecutionException full){accepting=false;rejected=true;}
  }
  // Never call the owner or acquire the durable draft lock while holding admission.
  if(rejected)fail("VOICE_CALLBACK_BACKPRESSURE");
 }
 public void result(String text,boolean finished){enqueue(()->{
  if(fault.get())return;
  try{if(!draft.officialResult(token,peer,generation,text,finished,clock.getAsLong())){fail("VOICE_RESULT_INCOMPLETE");return;}changed();}
  catch(Exception failed){fail("VOICE_TRANSCRIPT_SAVE_FAILED");}
 });}
 public void started(boolean accepted){if(!accepted)enqueue(()->fail("VOICE_ENGINE_START_REJECTED"));}
 public void engineAudio(boolean active){if(!active)enqueue(()->{
  try{draft.engineEnd(token,clock.getAsLong());requestStop("VOICE_ENGINE_ENDED");changed();}catch(Exception failed){fail("VOICE_TRANSCRIPT_SAVE_FAILED");}
 });}
 public void error(String code){enqueue(()->fail(code!=null&&code.matches("VOICE_[A-Z_]{1,50}")?code:"VOICE_ENGINE_ERROR"));}
 /** Native task must already be stopped. The barrier drains previously accepted callbacks;
  * it does not acknowledge the glasses microphone and cannot submit an answer. */
 CompletableFuture<Boolean> sealAfterNativeStop(boolean stopped){
  CompletableFuture<Boolean> done;boolean rejected=false;
  synchronized(this){
   if(closed||!stopped)return CompletableFuture.completedFuture(false);
   if(sealing!=null)return sealing;
   done=sealing=new CompletableFuture<>();accepting=false;
   try{worker.execute(()->{
    try{
     boolean saved=draft.engineSealed(token,true,clock.getAsLong());
     boolean finished;synchronized(this){drained=saved&&!closed;finished=drained;}done.complete(finished);
     changed();
    }catch(Exception failed){fail("VOICE_TRANSCRIPT_SAVE_FAILED");done.complete(false);}
   });}catch(RejectedExecutionException full){rejected=true;done.complete(false);}
  }
  if(rejected)fail("VOICE_CALLBACK_BACKPRESSURE");return done;
 }
 public void close(){
  boolean clean;CompletableFuture<Boolean> pending;
  synchronized(this){if(closed)return;closed=true;accepting=false;clean=drained;pending=sealing;}
  if(pending!=null&&!clean)pending.complete(false);
  if(!clean){fail("VOICE_CALLBACK_DISPATCH_CLOSED");worker.shutdownNow();}else worker.shutdown();
 }
}
