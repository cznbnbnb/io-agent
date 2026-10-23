package com.turboio.addon;

import java.util.Map;
import java.util.concurrent.*;
import java.util.function.LongSupplier;

/** Independent deadline for one immutable capture owner. No ASR, UI, TTS, model or
 * durable-store work runs on this timer. Android's sink queues the bound stop onto
 * the same serial SDK lane as start; it must not wait for transcription or disk I/O.
 * Issuing stop is not physical stop proof and never releases the durable obligation. */
final class VoiceCaptureCutoff implements VoiceAnswerSession.Cutoff,AutoCloseable {
 interface Stop {void request(String token,String peerHash,long generation)throws Exception;}
 private final ScheduledThreadPoolExecutor timer;private final LongSupplier clock;private final Stop stop;
 private static final class Lease {
  final String token,peer;final long generation,deadline;ScheduledFuture<?> scheduled;boolean issued,failed;
  Lease(String token,String peer,long generation,long deadline){this.token=token;this.peer=peer;this.generation=generation;this.deadline=deadline;}
 }
 private Lease active;private boolean closed;
 VoiceCaptureCutoff(LongSupplier clock,Stop stop){
  TaskWire.require(clock!=null&&stop!=null,"VOICE_CUTOFF_INVALID");this.clock=clock;this.stop=stop;
  timer=new ScheduledThreadPoolExecutor(1,r->{Thread t=new Thread(r,"iO-Agent-mic-cutoff");t.setDaemon(true);return t;});timer.setRemoveOnCancelPolicy(true);
 }
 synchronized boolean arm(String token,String peerHash,long generation,long deadline){
  long now=clock.getAsLong();
  TaskWire.require(token!=null&&token.matches("[a-f0-9]{32}")&&peerHash!=null&&peerHash.matches("[a-f0-9]{64}")&&generation>0&&now>=0&&deadline>now&&deadline-now<=VoiceAnswerSession.CAPTURE_SECONDS*1000L,"VOICE_CUTOFF_INVALID");
  if(closed||active!=null)return false;
  Lease lease=new Lease(token,peerHash,generation,deadline);active=lease;
  try{lease.scheduled=timer.schedule(()->fire(lease),deadline-now,TimeUnit.MILLISECONDS);return true;}
  catch(RejectedExecutionException unavailable){lease.failed=true;return false;}
 }
 /** Reopen only the durable cleanup obligation. This lease never authorizes
  * capture and schedules no timer; the recovery adapter must submit owned stop.
  * No engine/device proof or durable draft field is changed here. */
 boolean adoptRecovery(VoiceAnswerSession draft){
  // Do not hold the timer monitor while acquiring the durable draft monitor:
  // normal draft.arm calls back into cutoff.armed in the opposite order.
  if(draft==null||!draft.healthy())return false;
  Map<String,Object> proof=WireJson.map(draft.snapshot());
  if(!Boolean.TRUE.equals(proof.get("needs_stop"))||!"STOPPING".equals(proof.get("phase")))return false;
  String token=(String)proof.get("token"),peer=(String)proof.get("peer");
  long generation=TaskWire.nonnegative(proof.get("generation")),deadline=TaskWire.nonnegative(proof.get("deadline"));
  if(token==null||!token.matches("[a-f0-9]{32}")||peer==null||!peer.matches("[a-f0-9]{64}")||generation<=0||deadline<=0||TaskWire.nonnegative(proof.get("stop_at"))==0)return false;
  synchronized(this){if(closed||active!=null)return false;Lease lease=new Lease(token,peer,generation,deadline);lease.issued=true;active=lease;return true;}
 }
 public synchronized boolean armed(String token,String peerHash,long generation,long deadline){
  Lease l=active;return !closed&&l!=null&&!l.issued&&!l.failed&&l.token.equals(token)&&l.peer.equals(peerHash)&&l.generation==generation&&l.deadline==deadline&&clock.getAsLong()<deadline&&l.scheduled!=null&&!l.scheduled.isCancelled()&&!l.scheduled.isDone();
 }
 private void fire(Lease lease){
  synchronized(this){if(lease==null||active!=lease||lease.issued)return;lease.issued=true;}
  // This intentionally precedes any caller's journal/save/ASR work.
  try{stop.request(lease.token,lease.peer,lease.generation);}catch(Exception unavailable){synchronized(this){lease.failed=true;}}
 }
 synchronized boolean issued(){return active!=null&&active.issued;}synchronized boolean failed(){return active!=null&&active.failed;}synchronized boolean pending(){return active!=null;}
 boolean release(VoiceAnswerSession draft){
  if(draft==null||!draft.healthy()||draft.needsStop())return false;
  Map<String,Object> proof=WireJson.map(draft.snapshot());
  if(!Boolean.TRUE.equals(proof.get("device_stopped"))||!Boolean.TRUE.equals(proof.get("engine_stopped")))return false;
  synchronized(this){
   Lease l=active;if(l==null||!l.token.equals(proof.get("token"))||!l.peer.equals(proof.get("peer"))||TaskWire.nonnegative(proof.get("generation"))<l.generation)return false;
   if(l.scheduled!=null)l.scheduled.cancel(false);active=null;return true;
  }
 }
 public void close(){
  Lease l;synchronized(this){if(closed)return;closed=true;l=active;if(l!=null&&l.scheduled!=null)l.scheduled.cancel(false);}
  // Closing an unresolved guard still attempts the exact owned stop once.
  fire(l);timer.shutdown();
 }
}
