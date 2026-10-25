package com.turboio.addon;

import java.util.Objects;

/** Unwired, process-local arbitration for a future 1.0.7 KEY wake hook.
 *
 * The transport adapter, not this model, must authenticate the connected peer,
 * decode AssistantMsg/WakeBean and open an inbound scope only inside the real
 * e.c callback. A KEY enum or mock callback alone is not provenance. A scope is
 * a local callback identity, NOT a firmware gesture nonce or replay proof.
 *
 * prepare() is called on MAIN only after the delegate's exact default target is
 * durably frozen and an independent capturer is prepared with its own cutoff.
 * preparedReady() must recheck that capturer, peer generation, native policy and
 * physical prerequisites. This class neither proves mic idle nor starts an ASR
 * engine, reads a phone setting, creates a task or sends a hardware command.
 *
 * All resource callbacks run on MAIN and must be bounded/nonblocking. activate
 * runs at the commit boundary; it must retain its own cancellation/send fences
 * and deadline. releasePrepared=true means no start was attempted and prepared
 * resources were actually released. Unknown release blocks original fallback.
 * The original callback must dispatch once to the host's required executor and
 * recheck the supplied peer/epoch AT EXECUTION, not just when enqueueing. They
 * are null/0 only for an unscoped stock passthrough, never for claimed fallback.
 * An exception/lost dispatch receipt is never retried. Runtime must call drain
 * on MAIN after posting failure or before the handoff deadline, and recover its
 * durable capture owner after process death. This class is not that journal.
 */
final class Host107WakeGateCore {
 static final long MAX_READY_MILLIS=5000,MAX_HANDOFF_MILLIS=1000,MAX_INBOUND_MILLIS=1000;
 interface Original {void dispatch(String expectedPeer,long expectedEpoch);}
 interface Host {
  boolean isMainThread();
  long elapsed();
  Current current();
  boolean postToMain(Runnable action);
  boolean preparedReady(ReadyPermit permit);
  boolean releasePrepared(ReadyPermit permit);
  void activate(ReadyPermit permit);
  void cleanup(ReadyPermit permit,String reason);
 }
 static final class Selection {
  final String binding,routeFingerprint;final long revision;
  Selection(String binding,String routeFingerprint,long revision){
   this.binding=text(binding,256);this.routeFingerprint=text(routeFingerprint,256);positive(revision);this.revision=revision;
  }
  boolean same(Selection other){return other!=null&&binding.equals(other.binding)&&routeFingerprint.equals(other.routeFingerprint)&&revision==other.revision;}
 }
 static final class Current {
  final String peer;final long epoch;final Selection selection;
  Current(String peer,long epoch,Selection selection){this.peer=text(peer,256);positive(epoch);this.epoch=epoch;this.selection=selection;}
 }
 static final class ReadyPermit {
  final String peer,captureOwner;final long epoch,preparedAt,expiresAt;final Selection selection;
  private final Host107WakeGateCore gate;
  private String state="READY",reason="";private boolean revoked;
  private ReadyPermit(Host107WakeGateCore gate,Current current,String owner,long now,long until){this.gate=gate;peer=current.peer;epoch=current.epoch;selection=current.selection;captureOwner=owner;preparedAt=now;expiresAt=until;}
 }
 static final class Claim {
  final ReadyPermit permit;final long deadline;
  private final Host107WakeGateCore gate;private final Original original;
  private String state="PENDING",reason="";private boolean releaseAttempted,originalAttempted,cleanupAttempted;
  private Claim(Host107WakeGateCore gate,ReadyPermit permit,Original original,long deadline){this.gate=gate;this.permit=permit;this.original=original;this.deadline=deadline;}
 }
 enum Disposition {ORIGINAL,CLAIMED,SUPPRESSED}
 static final class Decision {
  final Disposition disposition;final Claim claim;
  private Decision(Disposition disposition,Claim claim){this.disposition=disposition;this.claim=claim;}
 }
 final class Inbound implements AutoCloseable {
  private final Host107WakeGateCore gate=Host107WakeGateCore.this;private final Thread thread=Thread.currentThread();
  private final String peer;private final long epoch,at;private final int type,rc,mode;private final Integer linkType;
  private final Inbound parent;private boolean open=true,seen;
  private Inbound(String peer,long epoch,int type,int rc,int mode,Integer linkType){this.peer=peer;this.epoch=epoch;this.type=type;this.rc=rc;this.mode=mode;this.linkType=linkType;at=now();parent=inbound.get();}
  public void close(){synchronized(Host107WakeGateCore.this){require(Thread.currentThread()==thread&&inbound.get()==this,"WAKE_SCOPE_THREAD");require(open,"WAKE_SCOPE_CLOSED");open=false;if(parent==null)inbound.remove();else inbound.set(parent);}}
 }
 private final Host host;private final ThreadLocal<Inbound> inbound=new ThreadLocal<>();
 private ReadyPermit permit;private Claim claim;
 Host107WakeGateCore(Host host){this.host=Objects.requireNonNull(host);}
 private static void require(boolean ok,String code){if(!ok)throw new IllegalStateException(code);}
 private static String text(String value,int limit){require(value!=null&&!value.trim().isEmpty()&&value.length()<=limit,"WAKE_ID_INVALID");return value;}
 private static void positive(long value){require(value>0,"WAKE_TIME_INVALID");}
 private long now(){long value=host.elapsed();require(value>=0,"WAKE_TIME_INVALID");return value;}
 private void main(){require(host.isMainThread(),"WAKE_MAIN_REQUIRED");}
 private void owned(ReadyPermit value){require(value!=null&&value.gate==this&&permit==value,"WAKE_PERMIT_CHANGED");}
 private void owned(Claim value){require(value!=null&&value.gate==this&&claim==value&&permit==value.permit,"WAKE_CLAIM_CHANGED");}
 synchronized String state(ReadyPermit value){require(value!=null&&value.gate==this,"WAKE_PERMIT_CHANGED");return value.state;}
 synchronized String state(Claim value){require(value!=null&&value.gate==this,"WAKE_CLAIM_CHANGED");return value.state;}

 ReadyPermit prepare(Current frozen,String captureOwner,long validForMillis){
  main();Objects.requireNonNull(frozen);require(frozen.selection!=null,"WAKE_DEFAULT_MISSING");text(captureOwner,256);
  require(validForMillis>0&&validForMillis<=MAX_READY_MILLIS,"WAKE_READY_WINDOW_INVALID");
  synchronized(this){require(permit==null,"WAKE_OWNER_BUSY");Current current=host.current();require(same(frozen,current),"WAKE_TARGET_CHANGED");long at=now();ReadyPermit next=new ReadyPermit(this,frozen,captureOwner,at,Math.addExact(at,validForMillis));require(host.preparedReady(next),"WAKE_CAPTURE_NOT_READY");permit=next;return next;}
 }
 /** Trusted transport integration only. Never call from mock/UI/ASR callbacks. */
 Inbound beginTransport(String peer,long epoch,int type,int rc,int mode,Integer linkType){
  text(peer,256);positive(epoch);require(type>=0&&rc>=0&&mode>=0,"WAKE_FRAME_INVALID");
  Inbound scope=new Inbound(peer,epoch,type,rc,mode,linkType);inbound.set(scope);return scope;
 }
 private static boolean same(Current left,Current right){return right!=null&&left.peer.equals(right.peer)&&left.epoch==right.epoch&&left.selection!=null&&left.selection.same(right.selection);}
 private boolean matches(ReadyPermit value,Current current){return current!=null&&value.peer.equals(current.peer)&&value.epoch==current.epoch&&value.selection.same(current.selection);}
 private static void original(Original original,String peer,long epoch){try{original.dispatch(peer,epoch);}catch(Throwable unknown){/* Attempt may have reached the SDK; never retry. */}}

 /** Called synchronously inside the scoped real transport callback. Invalid or
  * absent provenance preserves the stock callback. A stale/used issued scope is
  * suppressed, rather than replaying an old original callback after takeover. */
 Decision onWake(Inbound source,int wakeCode,Integer sharedMode,Integer linkType,Original original){
  Objects.requireNonNull(original);Claim next=null;boolean passthrough=false;
  synchronized(this){
   if(source==null||source.gate!=this){passthrough=true;}
   else if(source.seen||!source.open||source.thread!=Thread.currentThread()||inbound.get()!=source){return new Decision(Disposition.SUPPRESSED,null);}
   else{
    source.seen=true;long at=now();
    if(at<source.at||at-source.at>MAX_INBOUND_MILLIS)return new Decision(Disposition.SUPPRESSED,null);
    boolean key=source.type==1&&source.rc==3&&source.mode==0&&wakeCode==3&&sharedMode==null&&Objects.equals(source.linkType,linkType);
    if(!key){passthrough=true;}
    else if(permit==null||!permit.peer.equals(source.peer)||permit.epoch!=source.epoch){passthrough=true;}
    else if(!"READY".equals(permit.state)){return new Decision(Disposition.SUPPRESSED,claim);}
    else{
     long deadline=Math.min(permit.expiresAt,Math.addExact(at,MAX_HANDOFF_MILLIS));
     claim=next=new Claim(this,permit,original,deadline);permit.state="CLAIMED";
     if(at<permit.preparedAt||at>=permit.expiresAt){next.reason="WAKE_PERMIT_EXPIRED";permit.revoked=true;}
    }
   }
  }
  if(passthrough){boolean scoped=source!=null&&source.gate==this;original(original,scoped?source.peer:null,scoped?source.epoch:0);return new Decision(Disposition.ORIGINAL,null);}
  final Claim issued=next;boolean posted=false;try{posted=host.postToMain(()->handoff(issued));}catch(Throwable ignored){}
  if(!posted)synchronized(this){if(claim==issued&&"PENDING".equals(issued.state)){issued.permit.revoked=true;issued.reason="WAKE_HANDOFF_UNAVAILABLE";}}
  return new Decision(Disposition.CLAIMED,issued);
 }
 /** Revocation is allowed from an input/connection thread; effects stay on MAIN.
  * If MAIN posting is unavailable, drain() is required; no second owner is issued. */
 void revoke(ReadyPermit value,String reason){
  text(reason,128);synchronized(this){owned(value);value.revoked=true;value.reason=reason;if(claim!=null&&claim.reason.isEmpty())claim.reason=reason;}
  try{host.postToMain(this::drain);}catch(Throwable ignored){}
 }
 private void handoff(Claim value){
  main();synchronized(this){if(claim!=value||permit!=value.permit||!"PENDING".equals(value.state))return;}
  boolean ready=false;String failure="WAKE_CAPTURE_NOT_READY";
  try{Current current=host.current();ready=matches(value.permit,current)&&host.preparedReady(value.permit);if(!matches(value.permit,current))failure="WAKE_TARGET_CHANGED";}catch(Throwable unavailable){failure="WAKE_READINESS_UNAVAILABLE";}
  synchronized(this){
   if(claim!=value||permit!=value.permit||!"PENDING".equals(value.state))return;
   long at=now();if(value.permit.revoked||at<value.permit.preparedAt||at>=value.deadline||!ready){if(value.reason.isEmpty())value.reason=value.permit.revoked?value.permit.reason:(at>=value.deadline||at<value.permit.preparedAt?"WAKE_HANDOFF_EXPIRED":failure);}
   else{
    // Serialize commit/start-attempt against an off-MAIN revocation. activate
    // must enqueue bounded work, never wait on the SDK/input thread or network.
    value.state="COMMITTED";value.permit.state="COMMITTED";
    try{host.activate(value.permit);}catch(Throwable unknown){value.permit.revoked=true;value.reason="WAKE_ACTIVATION_UNKNOWN";}
    if(!value.permit.revoked)return;
   }
  }
  settle(value);
 }
 private void settle(Claim value){
  main();boolean cleanup=false,release=false;
  synchronized(this){
   if(claim!=value||permit!=value.permit)return;
   if("COMMITTED".equals(value.state)){value.state="CLEANUP";value.permit.state="CLEANUP";if(!value.cleanupAttempted){value.cleanupAttempted=true;cleanup=true;}}
   else if("PENDING".equals(value.state)&&!value.releaseAttempted){value.state="RELEASING";value.permit.state="RELEASING";value.releaseAttempted=true;release=true;}
  }
  if(cleanup){try{host.cleanup(value.permit,value.reason);}catch(Throwable unknown){}return;}
  if(!release)return;
  boolean released=false;try{released=host.releasePrepared(value.permit);}catch(Throwable unknown){}
  // A released preparation does not authorize replaying this old wake against
  // a new connection. Default changes may fall back on the same glasses; peer
  // changes, reconnects and an unreadable current connection must not.
  boolean sameConnection=false;if(released)try{Current current=host.current();sameConnection=current!=null&&value.permit.peer.equals(current.peer)&&value.permit.epoch==current.epoch;}catch(Throwable unavailable){}
  synchronized(this){
   if(claim!=value||permit!=value.permit||!"RELEASING".equals(value.state))return;
   if(!released){value.state="RELEASE_BLOCKED";value.permit.state="RELEASE_BLOCKED";return;}
   value.permit.state="RELEASED";
   if(!sameConnection){value.state="ORIGINAL_STALE";claim=null;permit=null;return;}
   value.state="ORIGINAL_ATTEMPTED";value.originalAttempted=true;
   // Keep this owner installed until the one original dispatch returns, so a
   // reentrant preparation cannot interleave with the fallback submission.
  }
  original(value.original,value.permit.peer,value.permit.epoch);
  synchronized(this){if(claim==value&&permit==value.permit){claim=null;permit=null;}}
 }
 /** MAIN lifecycle/timer drain. No automatic start is ever performed here. */
 void drain(){
  main();Claim pending;ReadyPermit unclaimed=null;
  synchronized(this){
   if(permit==null)return;long at=now();pending=claim;
   if(pending!=null){
    if("PENDING".equals(pending.state)&&!permit.revoked&&at>=permit.preparedAt&&at<pending.deadline)return;
    if("COMMITTED".equals(pending.state)&&!permit.revoked)return;
    if(pending.reason.isEmpty())pending.reason=permit.reason.isEmpty()?"WAKE_HANDOFF_EXPIRED":permit.reason;
   }else if(permit.revoked||at<permit.preparedAt||at>=permit.expiresAt){if(!"READY".equals(permit.state))return;unclaimed=permit;unclaimed.state="RELEASING";}else return;
  }
  if(pending!=null){settle(pending);return;}
  boolean released=false;try{released=host.releasePrepared(unclaimed);}catch(Throwable unknown){}
  synchronized(this){if(permit==unclaimed){unclaimed.state=released?"RELEASED":"RELEASE_BLOCKED";if(released)permit=null;}}
 }
 /** Trusted capturer acknowledgement after its independent physical/engine
  * release proof. This method does not manufacture that proof. Never call just
  * because an SDK stop was submitted or an idle/timeout callback was observed. */
 void captureReleased(ReadyPermit value){
  main();synchronized(this){owned(value);require("COMMITTED".equals(value.state)||"CLEANUP".equals(value.state),"WAKE_RELEASE_NOT_OWNED");value.state="RELEASED";if(claim!=null)claim.state="RELEASED";claim=null;permit=null;}
 }
}
