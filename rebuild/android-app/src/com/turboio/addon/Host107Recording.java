package com.turboio.addon;

import android.os.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.*;
import java.lang.ref.*;

/** Exact host recording-service adapter. Private owned UUIDs are intercepted before
 * Flutter's ordinary-recording flow; unrelated records keep their normal delivery.
 * Acquires a prepared durable draft, then reads fresh version/idle before capture.
 * Starting additionally requires an armed independent cutoff and exclusive SDK lane.
 * No UI/automatic startup path calls begin until physical prerequisites are ready. */
final class Host107Recording {
 interface Receiver {
  void frame(String peer,long generation,byte[] envelope);
  void sent(int type,boolean accepted,long at);
  void noStart(long at);
  void ready(boolean ready,long at);
  void idle(boolean idle,long at);
  void fault(String code);
 }
 private static final Handler MAIN=new Handler(Looper.getMainLooper());
 private static volatile Host107Recording active;
 private static final ReferenceQueue<Object> expiredTickets=new ReferenceQueue<>();
 private static final Map<IdentityKey,Ticket> tickets=new HashMap<>();
 private static final class IdentityKey extends WeakReference<Object> {
  final int hash;IdentityKey(Object message,ReferenceQueue<Object> queue){super(message,queue);hash=System.identityHashCode(message);}
  public int hashCode(){return hash;}public boolean equals(Object other){if(this==other)return true;Object value=get();return value!=null&&other instanceof IdentityKey&&value==((IdentityKey)other).get();}
 }
 private static synchronized void ticket(Object message,Ticket value){Reference<?> dead;while((dead=expiredTickets.poll())!=null)tickets.remove(dead);tickets.put(new IdentityKey(message,expiredTickets),value);}
 private static synchronized Ticket ticket(Object message){Reference<?> dead;while((dead=expiredTickets.poll())!=null)tickets.remove(dead);return tickets.get(new IdentityKey(message,null));}
 private static final class Ticket {
  final Host107Recording owner;final byte[] bytes;final boolean opening;final int type;final long until;boolean consumed;
  Ticket(Host107Recording owner,byte[] bytes,int type){this.owner=owner;this.bytes=bytes.clone();this.type=type;opening=type==14||(type==1&&TaskWire.nonnegative(WireJson.map(OtaFrame.decode(bytes).json).get("action"))==1);until=SystemClock.elapsedRealtime()+5000;}
 }
 private final VoiceAnswerSession draft;private final VoiceCaptureCutoff cutoff;private final Receiver receiver;
 private final String token,peer,peerHash,lease;private final long generation;private final boolean recoveryOnly;private long deadline;
 private final ThreadPoolExecutor incoming;
 private final AtomicBoolean faultPosted=new AtomicBoolean();
 private final AtomicBoolean faultDelivered=new AtomicBoolean();private final AtomicInteger posting=new AtomicInteger();
 private final AtomicLong events=new AtomicLong();
 private volatile String faultCode="";private volatile boolean closed;
 private boolean begun;private volatile boolean startAttempted,stopRequested,stopAccepted;
 private long idleSent,idleUntil,idleFence,checkSent,checkUntil,checkFence,readyUntil;private boolean checkedVersion,checkedIdle;
 private Host107Recording(VoiceAnswerSession draft,VoiceCaptureCutoff cutoff,Receiver receiver,String peer,long generation,boolean recoveryOnly){
  this.draft=draft;this.cutoff=cutoff;this.receiver=receiver;token=draft.token();this.peer=peer;peerHash=FixedPeerHash.of(peer);this.generation=generation;this.recoveryOnly=recoveryOnly;lease="agent-voice-"+token;
  incoming=new ThreadPoolExecutor(1,1,0,TimeUnit.MILLISECONDS,new ArrayBlockingQueue<>(32),r->{Thread t=new Thread(r,"iO-Agent-recording-source");t.setDaemon(true);return t;});
 }
 private static void main(){if(Looper.myLooper()!=Looper.getMainLooper())throw new IllegalStateException("VOICE_THREAD_INVALID");}
 private boolean sameLink(){Fixed60Session.Link link=Host107Ota.link();return peer.equals(link.peer)&&generation==link.generation;}
 private boolean current(){return active==this&&!closed&&NativeTransfer.ownsMessages(lease);}
 private boolean mayStart(){
  if(recoveryOnly||!current()||faultPosted.get()||stopRequested||SystemClock.elapsedRealtime()>=readyUntil||!sameLink()||!cutoff.armed(token,peerHash,generation,deadline)||!draft.healthy()||!draft.phase().equals("CAPTURING"))return false;
  Map<String,Object> state=WireJson.map(draft.snapshot());
  return token.equals(state.get("token"))&&peerHash.equals(state.get("peer"))&&generation==TaskWire.positive(state.get("generation"))&&deadline==TaskWire.positive(state.get("deadline"));
 }
 static Host107Recording acquire(VoiceAnswerSession draft,VoiceCaptureCutoff cutoff,Receiver receiver){
  main();if(active!=null||draft==null||cutoff==null||receiver==null||cutoff.pending()||!draft.healthy()||!draft.phase().equals("PREPARED"))return null;
  Fixed60Session.Link link=Host107Ota.link();if(link.peer==null||link.peer.isEmpty())return null;
  if(link.generation<=0)return null;
  String lease="agent-voice-"+draft.token();if(!NativeTransfer.acquireMessages(lease))return null;
  try{Host107Recording owner=new Host107Recording(draft,cutoff,receiver,link.peer,link.generation,false);active=owner;return owner;}
  catch(RuntimeException failure){NativeTransfer.releaseMessages(lease);throw failure;}
 }
 /** The IO owner must first persist resumeCleanup for this exact peer/epoch.
  * Acquisition never resumes audio, edits the draft or invents stop evidence. */
 static Host107Recording acquireRecovery(VoiceAnswerSession draft,VoiceCaptureCutoff cutoff,Receiver receiver){
  main();if(draft==null||cutoff==null||receiver==null||cutoff.pending()||!draft.healthy()||!draft.needsStop()||!"STOPPING".equals(draft.phase()))return null;
  Fixed60Session.Link link=Host107Ota.link();if(link.peer==null||link.peer.isEmpty()||link.generation<=0)return null;
  Map<String,Object> proof=WireJson.map(draft.snapshot());
  if(!FixedPeerHash.of(link.peer).equals(proof.get("peer"))||link.generation!=TaskWire.nonnegative(proof.get("generation")))return null;
  Host107Recording prior=active;
  if(prior!=null){
   // Never wait for an old audio/ASR receiver to free the physical stop lane.
   // Only this exact durable draft may transfer, to a distinct bound receiver.
   // An already executing old callback retains its original peer/generation.
   if(prior.draft!=draft||prior.cutoff==cutoff||prior.receiver==receiver||!prior.current()||!prior.token.equals(draft.token())||!prior.peer.equals(link.peer)||link.generation<=prior.generation)return null;
   Host107Recording owner=new Host107Recording(draft,cutoff,receiver,link.peer,link.generation,true);
   if(!cutoff.adoptRecovery(draft)){owner.incoming.shutdown();return null;}
   prior.stopRequested=true;prior.closed=true;active=owner;prior.incoming.shutdownNow();prior.cutoff.close();return owner;
  }
  String lease="agent-voice-"+draft.token();if(!NativeTransfer.acquireMessages(lease))return null;
  try{
   if(!cutoff.adoptRecovery(draft)){NativeTransfer.releaseMessages(lease);return null;}
   Host107Recording owner=new Host107Recording(draft,cutoff,receiver,link.peer,link.generation,true);active=owner;return owner;
  }catch(RuntimeException failure){NativeTransfer.releaseMessages(lease);throw failure;}
 }
 void inspect(){
  main();if(recoveryOnly||!current()||faultPosted.get()||begun||cutoff.pending()||!draft.phase().equals("PREPARED")||!sameLink()||checkSent!=0)throw new IllegalStateException("VOICE_PREFLIGHT_NOT_READY");
  readyUntil=0;checkedVersion=checkedIdle=false;checkSent=SystemClock.elapsedRealtime();checkUntil=checkSent+8000;checkFence=events.get();
  for(int type:new int[]{1,11})send(9,type,null,(ok,at)->{if(!ok){checkUntil=readyUntil=0;fault("VOICE_PREFLIGHT_SUBMISSION_FAILED");}});
  long requested=checkSent;MAIN.postDelayed(()->{if(current()&&checkSent==requested&&checkUntil!=0){checkUntil=0;fault("VOICE_PREFLIGHT_TIMEOUT");}},8000);
 }
 void begin(){
  main();deadline=TaskWire.nonnegative(WireJson.map(draft.snapshot()).get("deadline"));
  if(begun||!mayStart())throw new IllegalStateException("VOICE_START_NOT_READY");begun=true;
  // Same Android looper serializes start with a deadline stop posted from the timer.
  // If the timer wins before this callback, mayStart rejects the late start.
  send(14,14,WireJson.object("isAppForeground",true),(ok,at)->{
   dispatch(()->receiver.sent(14,ok,at));
   if(!ok){stop();return;}if(!mayStart()){stop();return;}
   startAttempted=true;
   send(14,1,WireJson.object("uuid",token,"action",1,"mode",1,"code",1,"type",1),(accepted,when)->{if(!accepted)stop();dispatch(()->receiver.sent(1,accepted,when));});
  });
 }
 /** Safe to call from the independent cutoff thread; immutable owner is checked again. */
 void deadlineStop(String owner,String targetHash,long epoch){
  if(!token.equals(owner)||!peerHash.equals(targetHash)||generation!=epoch)throw new IllegalArgumentException("VOICE_CUTOFF_OWNER_CHANGED");
  if(!MAIN.post(()->{if(active==this&&!closed)stop();}))throw new IllegalStateException("VOICE_STOP_DISPATCH_FAILED");
 }
 void stop(){
  main();if(!current()||stopRequested)return;stopRequested=true;draft.revokeOpening(token);readyUntil=checkUntil=0;
  if(!recoveryOnly&&!startAttempted){long at=SystemClock.elapsedRealtime();dispatch(()->receiver.noStart(at));}
  // Read-only preflight failure has never scheduled capture. Once armed, submit an
  // exact-UUID stop even if the enable ACK has not arrived; late start is fenced.
  if(!begun&&!cutoff.pending())return;
  if(!sameLink()){fault("VOICE_CONNECTION_CHANGED");return;}
  send(14,4,WireJson.object("uuid",token,"action",1,"code",2),(ok,at)->{stopAccepted=ok;dispatch(()->receiver.sent(4,ok,at));if(!ok)fault("VOICE_STOP_SUBMISSION_UNCONFIRMED");});
 }
 void acknowledge(int type){
  main();if(recoveryOnly||!current()||!sameLink()||!startAttempted||!Arrays.asList(1,4,8,9,11).contains(type))throw new IllegalStateException("VOICE_ACK_NOT_READY");
  Object body=type==1?WireJson.object("uuid",token,"action",2,"mode",1,"code",1,"type",1):WireJson.object("uuid",token,"action",2,"code",1);
  send(14,type,body,(ok,at)->{if(!ok){fault("VOICE_RECORDING_ACK_FAILED");stop();}});
 }
 void inspectIdle(){
  main();if(!current()||!stopRequested||!stopAccepted||!sameLink()||idleUntil!=0)throw new IllegalStateException("VOICE_STOP_QUERY_NOT_READY");
  idleSent=SystemClock.elapsedRealtime();idleUntil=idleSent+8000;idleFence=events.get();
  send(9,11,null,(ok,at)->{if(!ok){idleSent=idleUntil=0;fault("VOICE_STOP_QUERY_FAILED");}});
  long requested=idleSent;MAIN.postDelayed(()->{if(active==this&&idleSent==requested&&idleUntil!=0){idleSent=idleUntil=0;fault("VOICE_STOP_QUERY_TIMEOUT");}},8000);
 }
 private interface Receipt {void result(boolean accepted,long at);}
 private void send(int businessId,int type,Object body,Receipt result){
  main();AtomicBoolean done=new AtomicBoolean();
  java.util.function.Consumer<Boolean> finish=ok->{if(done.compareAndSet(false,true))MAIN.post(()->{if(active==this&&!closed)result.result(ok,SystemClock.elapsedRealtime());});};
  try{
   if(!current()||!sameLink())throw new IllegalStateException("VOICE_CONNECTION_CHANGED");
   Object manager=NavReflect.field(NavReflect.type("E3.u"),"h");
   Object business=NavReflect.call(NavReflect.type("P3.h"),"valueOf",businessId==14?"RECORDING_SERVICE":"MARS_FOTA");
   byte[] bytes=OtaFrame.encode(type,body,null);if(businessId==9&&!OtaFrame.readOnly(bytes))throw new IllegalStateException("VOICE_QUERY_INVALID");
   Object priority=NavReflect.call(NavReflect.type("E3.b"),"valueOf","NORMAL");
   Object message=NavReflect.make("E3.Q",bytes,UUID.randomUUID().toString(),peer,business,null,priority,false,false,null,null);
   if(businessId==14)ticket(message,new Ticket(this,bytes,type));
   Object callback=NavReflect.proxy("kotlin.jvm.functions.Function2",(name,args)->finish.accept(args.length==2&&args[0]==message&&args[1]==null));
   NavReflect.call(manager,"u",message,callback);MAIN.postDelayed(()->finish.accept(false),5000);
  }catch(Exception failure){finish.accept(false);}
 }
 /** Called at the final SDK queue boundary. Retained weak tickets reject a late
  * owned start even after its session released; absence of a live owner must not
  * turn a previously authorized capture into an ordinary stock recording. */
 static boolean allowQueue(Object message,String business,String peer,byte[] bytes){
  Ticket ticket=ticket(message);Host107Recording owner=active;
  if(ticket!=null)synchronized(ticket){
   if(ticket.consumed)return false;ticket.consumed=true;
   Host107Recording issued=ticket.owner;
   if(owner!=issued||!issued.current()||!issued.sameLink()||!"RECORDING_SERVICE".equals(business)||!issued.peer.equals(peer)||bytes==null||!Arrays.equals(ticket.bytes,bytes)||SystemClock.elapsedRealtime()>=ticket.until)return false;
   VoiceAnswerSession.CapturePermit durable=issued.draft.capturePermit();
   if(!durable.needsStop||!issued.token.equals(durable.token)||!issued.peerHash.equals(durable.peer)||issued.generation!=durable.generation)return false;
   if(issued.recoveryOnly)return !ticket.opening&&ticket.type==4&&"STOPPING".equals(durable.phase);
   if(ticket.opening)return durable.opening&&durable.deadline==issued.deadline&&!issued.stopRequested&&!issued.faultPosted.get()&&issued.cutoff.armed(issued.token,issued.peerHash,issued.generation,issued.deadline);
   return true;
  }
  if(owner==null)return true;
  // These stock modes share the microphone/ASR path. Releasing our lease restores
  // their normal queue policy; unrelated settings, pairing and heartbeat continue.
  return !Arrays.asList("RECORDING_SERVICE","VOICE_ASSISTANT","AI_SUBTITLE","TELEPROMPTER").contains(business);
 }
 private void fault(String code){
  if(faultPosted.compareAndSet(false,true)){
   faultCode=code;MAIN.post(()->{if(active==this&&!closed)stop();});
   dispatch(()->{});
  }
 }
 private void dispatch(Runnable action){
  try{incoming.execute(()->{
   if(active!=this||closed)return;
   // Stop receipts/idle evidence must still reach the owner after an audio fault.
   try{action.run();}catch(RuntimeException error){fault("VOICE_RECORDING_RECEIVER_FAILED");}
   finally{if(current()&&!faultCode.isEmpty()&&faultDelivered.compareAndSet(false,true))try{receiver.fault(faultCode);}catch(RuntimeException ignored){}}
  });}catch(RejectedExecutionException full){fault("VOICE_RECORDING_BACKPRESSURE");}
 }
 /** Only called from an already verified stock/owned plugin event path. */
 // Probe (2026-10-23, user wants a double head shake to stop task dictation): each event kind seen
 // during a task capture is logged once by name only, to find a head-gesture signal if one exists.
 private static final Set<String> probed=Collections.synchronizedSet(new HashSet<>());
 static boolean observe(String kind,Map<?,?> data){
  Host107Recording owner=active;if(owner==null||data==null||kind==null)return false;
  if(probed.size()<64&&probed.add(kind))System.out.println("TurboIOVoice capture probe kind="+kind+" keys="+data.keySet());// logcat tag System.out; this class also builds in JVM tests
  if(Arrays.asList("bleStateChanged","brStateChanged","bondStateChanged").contains(kind)){
   MAIN.post(()->{if(owner.current()&&!owner.sameLink())owner.fault("VOICE_CONNECTION_CHANGED");});return false;
  }
  if(!"messageReceived".equals(kind))return false;
  Object raw=data.get("message");if(!(raw instanceof Map))return false;Map<?,?> message=(Map<?,?>)raw;
  if(!owner.peer.equals(message.get("deviceId")))return false;
  Object business=message.get("businessId"),payload=message.get("payload");
  boolean integer=business instanceof Byte||business instanceof Short||business instanceof Integer||business instanceof Long;
  boolean recording="RECORDING_SERVICE".equals(business)||"14".equals(business)||(integer&&((Number)business).longValue()==14);
  boolean idle=HostBusiness.id(business)==9;
  if(!recording&&!idle)return false;
  if(!(payload instanceof byte[])||((byte[])payload).length>16384){if(recording)owner.fault("VOICE_RECORDING_ENVELOPE_INVALID");return false;}
  byte[] bytes=((byte[])payload).clone();long received=SystemClock.elapsedRealtime(),event=owner.events.incrementAndGet();
  try{
   OtaFrame frame=OtaFrame.decode(bytes);Map<String,Object> body=WireJson.map(frame.json);
   if(idle){
    if(frame.binary.length==0&&(frame.type==1||frame.type==11))MAIN.post(()->owner.preflight(frame.type,body,received,event));
    if(frame.type==11&&frame.binary.length==0&&body.get("Result") instanceof Boolean)MAIN.post(()->{
     if(owner.current()&&owner.sameLink()&&owner.idleUntil!=0&&event>owner.idleFence&&received>=owner.idleSent&&received<=owner.idleUntil){
      owner.idleSent=owner.idleUntil=0;owner.dispatch(()->owner.receiver.idle((Boolean)body.get("Result"),received));
     }
    });
    return false;
   }
   if(!owner.token.equals(body.get("uuid")))return false;
   // Late historic audio stays out of both the new draft and stock recording
   // delivery while this UUID is being stopped. Only fresh idle is forwarded.
   if(owner.recoveryOnly)return true;
   if(owner.posting.incrementAndGet()>32){owner.posting.decrementAndGet();owner.fault("VOICE_RECORDING_BACKPRESSURE");return true;}
   if(!MAIN.post(()->{try{
    if(!owner.current())return;if(!owner.sameLink()){owner.fault("VOICE_CONNECTION_CHANGED");return;}
    owner.dispatch(()->{if(!owner.faultPosted.get())owner.receiver.frame(owner.peer,owner.generation,bytes);});
   }finally{owner.posting.decrementAndGet();}})){owner.posting.decrementAndGet();owner.fault("VOICE_SOURCE_DISPATCH_FAILED");}
   return true;
  }catch(RuntimeException invalid){if(recording)owner.fault("VOICE_RECORDING_ENVELOPE_INVALID");return false;}
 }
 private void preflight(int type,Map<String,Object> body,long received,long event){
  main();if(!current()||!sameLink()||faultPosted.get()||checkUntil==0||event<=checkFence||received<checkSent||received>=checkUntil)return;
  boolean valid=type==1?"Strix OS 1.0.5.5".equals(body.get("OsVersion"))&&"idle".equals(body.get("OtaValidationState"))&&Boolean.TRUE.equals(body.get("OtaValidationConfirmed"))&&body.get("PackageTypes") instanceof List&&((List<?>)body.get("PackageTypes")).contains("files"):Boolean.TRUE.equals(body.get("Result"));
  if(!valid){checkUntil=readyUntil=0;dispatch(()->receiver.ready(false,received));fault("VOICE_PREFLIGHT_NOT_IDLE_OR_VALIDATED");return;}
  if(type==1)checkedVersion=true;else checkedIdle=true;
  if(checkedVersion&&checkedIdle){readyUntil=checkUntil;checkUntil=0;dispatch(()->receiver.ready(true,received));}
 }
 /** Only an unarmed preparation can be abandoned without physical stop evidence. */
 boolean releasePrepared(){
  main();if(!current()||begun||startAttempted||cutoff.pending()||!draft.healthy()||!draft.phase().equals("PREPARED")||posting.get()!=0||incoming.getActiveCount()!=0||!incoming.getQueue().isEmpty())return false;
  cutoff.close();dispose();return true;
 }
 private void dispose(){closed=true;active=null;incoming.shutdown();NativeTransfer.releaseMessages(lease);}
 boolean release(){
  main();if(!current()||draft.needsStop()||!draft.healthy()||posting.get()!=0||incoming.getActiveCount()!=0||!incoming.getQueue().isEmpty())return false;
  Map<String,Object> proof=WireJson.map(draft.snapshot());
  if(!token.equals(proof.get("token"))||!peerHash.equals(proof.get("peer"))||(recoveryOnly&&generation!=TaskWire.nonnegative(proof.get("generation")))||!Boolean.TRUE.equals(proof.get("device_stopped"))||!Boolean.TRUE.equals(proof.get("engine_stopped"))||!cutoff.release(draft))return false;
  dispose();return true;
 }
}
