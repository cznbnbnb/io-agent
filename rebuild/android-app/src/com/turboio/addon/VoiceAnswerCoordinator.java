package com.turboio.addon;

import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.*;
import java.util.function.LongSupplier;

/** One already-armed original-request capture. Ports own platform scheduling;
 * stop must only dispatch, never wait for this worker, ASR or durable storage.
 * No task submission, replacement route, microphone timer or automatic restart. */
final class VoiceAnswerCoordinator implements AutoCloseable {
 interface Engine {
  boolean start()throws Exception;boolean working()throws Exception;void pcm(byte[] bytes)throws Exception;
  void sealInput()throws Exception;boolean stop()throws Exception;boolean stopped()throws Exception;void release()throws Exception;
 }
 interface Device {
  void begin()throws Exception;void stop()throws Exception;void acknowledge(int type)throws Exception;
  void inspectIdle()throws Exception;boolean release()throws Exception;
 }
 interface Events {void changed(State state);}
 static final class State {
  final String phase,note;final Map<String,Object> draftSnapshot;final boolean released,answerReady;
  State(String phase,String note,Object draft,boolean released,boolean answerReady){this.phase=phase;this.note=note;this.draftSnapshot=freezeMap(WireJson.map(draft));this.released=released;this.answerReady=answerReady;}
  private static Map<String,Object> freezeMap(Map<String,Object> value){Map<String,Object> out=new LinkedHashMap<>();for(Map.Entry<String,Object> e:value.entrySet())out.put(e.getKey(),freeze(e.getValue()));return Collections.unmodifiableMap(out);}
  private static Object freeze(Object value){if(value instanceof Map)return freezeMap(WireJson.map(value));if(value instanceof List){List<Object> out=new ArrayList<>();for(Object item:(List<?>)value)out.add(freeze(item));return Collections.unmodifiableList(out);}return value;}
 }
 private interface Work {void run()throws Exception;}
 private static final long START_WAIT=8000,TAIL_WAIT=8000,IDLE_WAIT=8000;
 private final CaptureSession draft;private final String token,peer;private final long generation,captureDeadline;
 private final RecordingVoiceSource source;private final VoiceAudioArchive archive;private final Device device;private final LongSupplier clock;private final Events events;
 private final ThreadPoolExecutor worker;private final Host107VoiceTask.Listener listener;
 private final Object callbackAdmission=new Object();private boolean callbackAccepting=true;
 private final AtomicBoolean attached=new AtomicBoolean(),requested=new AtomicBoolean(),cancelled=new AtomicBoolean(),dispatchingStop=new AtomicBoolean();
 private final AtomicLong stopAt=new AtomicLong();private final AtomicReference<String> fault=new AtomicReference<>("");
 private volatile Engine engine;private volatile State state;private volatile boolean released,startAttempted;
 private long startAt,nextIdle,idleIssued,idleUntil;private int idleQueries,engineStopAttempts;
 private boolean startAccepted,startCallback,begun,stopSaved,cancelSaved,faultSaved,tailComplete,inputSealed,engineStopAccepted,barrierPending,engineSealed,archiveSealed,archiveComplete,archiveFailed,engineReleased,deviceReleased;
 private CaptureSession.StopProbe idleProbe;private boolean stopAccepted,idleProven;private String note="prepared";
 VoiceAnswerCoordinator(CaptureSession draft,String peer,long generation,RecordingVoiceSource source,VoiceAudioArchive archive,Device device,LongSupplier clock,Events events){
  TaskWire.require(draft!=null&&draft.healthy()&&draft.phase().equals("CAPTURING")&&peer!=null&&generation>0&&source!=null&&archive!=null&&device!=null&&clock!=null&&events!=null,"VOICE_COORDINATOR_INVALID");
  Map<String,Object> saved=WireJson.map(draft.snapshot());token=(String)saved.get("token");
  TaskWire.require(FixedPeerHash.of(peer).equals(saved.get("peer"))&&generation==TaskWire.positive(saved.get("generation"))&&archive.matches(token,14),"VOICE_COORDINATOR_OWNER_INVALID");
  this.draft=draft;this.peer=peer;this.generation=generation;captureDeadline=TaskWire.positive(saved.get("deadline"));this.source=source;this.archive=archive;this.device=device;this.clock=clock;this.events=events;
  state=new State(draft.phase(),note,saved,false,false);
  worker=new ThreadPoolExecutor(1,1,0,TimeUnit.MILLISECONDS,new ArrayBlockingQueue<>(64),r->{Thread t=new Thread(r,"iO-Agent-voice-coordinator");t.setDaemon(true);return t;});
  listener=new Host107VoiceTask.Listener(){
   public void result(String text,boolean finished){acceptCallback(()->{if(!draft.officialResult(token,peer,generation,text,finished,clock.getAsLong()))fail("VOICE_RESULT_INCOMPLETE");});}
   public void started(boolean accepted){if(!liveOwner()||!startAttempted)return;if(!accepted){fault("VOICE_ENGINE_START_REJECTED");return;}acceptCallback(()->startCallback=true);}
   public void engineAudio(boolean active){if(liveOwner()&&startAttempted&&!active)VoiceAnswerCoordinator.this.stop(false);}
   public void error(String code){if(liveOwner()&&startAttempted)fault(code);}
  };
 }
 Host107VoiceTask.Listener listener(){return listener;}
 State snapshot(){return state;}
 private boolean liveOwner(){CaptureSession.CapturePermit p=draft.capturePermit();return !released&&token.equals(p.token)&&FixedPeerHash.of(peer).equals(p.peer)&&generation==p.generation;}
 private void acceptCallback(Work action){
  if(!liveOwner()||!startAttempted)return;
  // Admission never holds the durable draft monitor. The barrier is ordered
  // after all callbacks admitted before native STOPPED was observed.
  synchronized(callbackAdmission){if(callbackAccepting)submit(action);}
 }
 void attachEngine(Engine value){TaskWire.require(value!=null&&!released&&attached.compareAndSet(false,true),"VOICE_ENGINE_ALREADY_ATTACHED");engine=value;submit(()->{});}
 void start(){if(released||!requested.compareAndSet(false,true))return;submit(()->startAt=clock.getAsLong());}
 private boolean owner(String value,long epoch){return peer.equals(value)&&generation==epoch;}
 void frame(String value,long epoch,byte[] envelope){
  if(!liveOwner()||!owner(value,epoch))return;
  final byte[] bytes;final OtaFrame frame;
  try{TaskWire.require(envelope!=null&&envelope.length<=16384,"VOICE_RECORDING_ENVELOPE_INVALID");bytes=envelope.clone();frame=OtaFrame.decode(bytes);if(!token.equals(WireJson.map(frame.json).get("uuid")))return;}
  catch(RuntimeException invalid){fault("VOICE_RECORDING_ENVELOPE_INVALID");return;}
  if(frame.type==6)physicalStop(false);
  submit(()->{
   if(frame.type==3){
    if(!begun||inputSealed){fail("VOICE_RECORDING_UNEXPECTED_AUDIO");return;}
    byte[] pcm=source.audio(peer,generation,bytes);if(pcm!=null)for(int at=0;at<pcm.length;at+=32768)engine.pcm(Arrays.copyOfRange(pcm,at,Math.min(pcm.length,at+32768)));
   }else if(frame.type==6){if(!tailComplete)tailComplete=source.ended(peer,generation,bytes);}
   else if(Arrays.asList(1,4,8,9,11).contains(frame.type)&&Long.valueOf(1).equals(WireJson.map(frame.json).get("action")))device.acknowledge(frame.type);
  });
 }
 void sent(int type,boolean accepted,long at){
  if(!liveOwner())return;if(!accepted){fault(type==4?"VOICE_STOP_SUBMISSION_UNCONFIRMED":"VOICE_RECORDING_SUBMISSION_FAILED");return;}
  if(type!=4)return;
  // The independent cutoff can submit stop before any UI/coordinator action.
  // Its bound SDK receipt starts cleanup too; it never proves physical idle.
  if(at<=0){fault("VOICE_STOP_PROOF_REJECTED");return;}draft.revokeOpening(token);stopAt.compareAndSet(0,at);
  submit(()->{if(stopAccepted||stopAt.get()==0||at<stopAt.get())return;persistStop();TaskWire.require(draft.stopSubmitted(token,peer,generation,at),"VOICE_STOP_PROOF_REJECTED");stopAccepted=true;nextIdle=clock.getAsLong();});
 }
 void idle(boolean idle,long at){if(liveOwner())submit(()->{
  // A previously received response can wait behind tick/storage while a new
  // query is issued. Reject its old timestamp without consuming the new probe.
  if(idleProbe==null||!stopAccepted||idleUntil==0||at<idleIssued||at>idleUntil)return;
  boolean proved=draft.deviceIdle(idleProbe,peer,generation,at,idle);idleProbe=null;idleIssued=idleUntil=0;nextIdle=clock.getAsLong()+1000;
  if(proved)idleProven=true;else note="VOICE_DEVICE_NOT_IDLE";
 });}
 void noStart(long at){if(liveOwner())fault("VOICE_RECORDING_NOT_STARTED");}
 void stop(boolean cancel){if(!liveOwner())return;physicalStop(cancel);submit(()->{});}
 void fault(String code){if(!liveOwner())return;fault.compareAndSet("",valid(code));physicalStop(false);submit(()->{});}
 private static String valid(String code){return code!=null&&code.matches("VOICE_[A-Z_]{1,50}")?code:"VOICE_COORDINATOR_FAILED";}
 private void physicalStop(boolean cancel){
  if(!liveOwner())return;
  if(cancel)cancelled.set(true);draft.revokeOpening(token);stopAt.compareAndSet(0,Math.max(1,clock.getAsLong()));
  if(dispatchingStop.compareAndSet(false,true))try{device.stop();}catch(Exception unavailable){fault.compareAndSet("","VOICE_STOP_DISPATCH_FAILED");}finally{dispatchingStop.set(false);}
 }
 private void fail(String code){fault.compareAndSet("",valid(code));physicalStop(false);}
 private void submit(Work action){
  if(released)return;
  try{worker.execute(()->{
   if(released)return;
   try{if(!liveOwner()){retireEngine();note="VOICE_OWNER_CHANGED";return;}action.run();advance();}
   catch(Exception failed){fail(failed.getMessage());note=valid(failed.getMessage());}
   finally{publish();}
  });}catch(RejectedExecutionException full){if(!released){fault.compareAndSet("","VOICE_COORDINATOR_BACKPRESSURE");physicalStop(false);}}
 }
 private void persistStop()throws Exception{
  synchronized(draft){
  if(!liveOwner())return;
  if(stopAt.get()!=0&&(!stopSaved||cancelled.get()&&!cancelSaved)){
   boolean cancel=cancelled.get();
   // finish may already be durable while archive/release is retrying. A close
   // still cancels this draft, never the original Agent task.
   TaskWire.require(draft.needsStop()?draft.stop(token,stopAt.get(),cancel):!cancel||draft.cancelDraft(clock.getAsLong())||draft.phase().equals("CANCELLED"),"VOICE_STOP_PROOF_REJECTED");stopSaved=true;cancelSaved=cancel;
  }
  }
 }
 private void advance()throws Exception{
  if(!liveOwner()){retireEngine();note="VOICE_OWNER_CHANGED";return;}
  long now=clock.getAsLong();Engine nativeEngine=engine;
  if(stopAt.get()==0&&requested.get()){
   if(startAt==0)startAt=now;
   if(nativeEngine!=null&&!startAttempted){startAttempted=true;startAccepted=nativeEngine.start();if(!startAccepted)fail("VOICE_ENGINE_START_REJECTED");}
   if(startAccepted&&startCallback&&!begun&&nativeEngine.working()&&stopAt.get()==0&&draft.capturePermit().opening){begun=true;device.begin();note="capturing";}
   if(!begun&&now-startAt>=START_WAIT)fail("VOICE_ENGINE_START_TIMEOUT");
  }
  persistStop();
  if(!fault.get().isEmpty()&&!faultSaved){archive.incomplete();if(draft.needsStop())TaskWire.require(draft.failed(token,peer,generation,fault.get(),now),"VOICE_STOP_PROOF_REJECTED");faultSaved=true;note=fault.get();}
  if(stopAt.get()==0)return;
  if(!tailComplete&&!faultSaved&&now-stopAt.get()>=TAIL_WAIT){fail("VOICE_RECORDING_TAIL_TIMEOUT");archive.incomplete();TaskWire.require(draft.failed(token,peer,generation,fault.get(),now),"VOICE_STOP_PROOF_REJECTED");faultSaved=true;note=fault.get();}
  if(stopAccepted&&!idleProven){
   if(idleUntil!=0&&now>idleUntil){idleProbe=null;idleIssued=idleUntil=0;nextIdle=now;note="VOICE_STOP_QUERY_TIMEOUT";}
   if(idleUntil==0&&now>=nextIdle&&idleQueries<3){idleProbe=draft.probeStop(peer,generation,now);TaskWire.require(idleProbe!=null,"VOICE_STOP_PROOF_REJECTED");idleIssued=now;idleUntil=now+IDLE_WAIT;idleQueries++;device.inspectIdle();}
  }
  if(nativeEngine!=null&&(tailComplete||faultSaved)){
   // Successful release of a never-started task is evidence of absence, not
   // an observed native STOPPED transition. No transcript callback is admitted
   // before startAttempted, and physical idle still needs separate evidence.
   if(!startAttempted&&!engineReleased){nativeEngine.release();engineReleased=true;}
   if(startAttempted){
    if(!inputSealed){nativeEngine.sealInput();inputSealed=true;}
    if(!engineStopAccepted&&engineStopAttempts<3){engineStopAttempts++;engineStopAccepted=nativeEngine.stop();if(!engineStopAccepted)note="VOICE_ENGINE_STOP_UNCONFIRMED";}
   }
   if(!barrierPending&&(engineReleased||engineStopAccepted&&nativeEngine.stopped())){
    synchronized(callbackAdmission){
     callbackAccepting=false;barrierPending=true;
     submit(()->{synchronized(draft){if(!liveOwner())return;TaskWire.require(draft.engineSealed(token,true,clock.getAsLong()),"VOICE_CALLBACK_SEAL_FAILED");engineSealed=true;}});
    }
   }
  }
  if(!engineSealed||!idleProven||!(tailComplete||faultSaved))return;
  synchronized(draft){
   if(!liveOwner())return;
   if(draft.needsStop()){TaskWire.require(draft.finish(),"VOICE_STOP_PROOF_REJECTED");note=draft.phase().equals("REVIEW")?"review":draft.phase().equals("CANCELLED")?"cancelled":"incomplete";}
  }
  if(!archiveSealed){
   try{Map<String,Object> sealed=WireJson.map(archive.seal(draft));archiveComplete=Boolean.TRUE.equals(sealed.get("complete"));archiveSealed=true;}
   catch(Exception failed){archiveFailed=true;note="VOICE_ARCHIVE_SEAL_FAILED";return;}
  }
  if(!engineReleased){nativeEngine.release();engineReleased=true;}
  if(!deviceReleased)deviceReleased=device.release();
  if(deviceReleased&&engineReleased){archive.close();released=true;worker.shutdown();}
 }
 private void retireEngine()throws Exception{
  // A newer durable generation owns the physical cleanup now. Retire only
  // this coordinator's native task; never write its token-only stop proofs.
  synchronized(callbackAdmission){callbackAccepting=false;}
  if(engine==null||engineReleased){worker.shutdown();return;}
  if(!startAttempted){engine.release();engineReleased=true;worker.shutdown();return;}
  if(!inputSealed){engine.sealInput();inputSealed=true;}
  if(!engineStopAccepted)engineStopAccepted=engine.stop();
  if(engineStopAccepted&&engine.stopped()){engine.release();engineReleased=true;worker.shutdown();}
 }
 private void publish(){try{String phase=draft.phase();boolean ready=released&&phase.equals("REVIEW")&&archiveSealed&&archiveComplete&&!archiveFailed&&fault.get().isEmpty()&&!cancelled.get();state=new State(phase,archiveFailed?"VOICE_ARCHIVE_SEAL_FAILED":note,draft.snapshot(),released,ready);events.changed(state);}catch(Exception ignored){/* Stop dispatch never depends on observers. */}}
 void tick(){if(!released){if(clock.getAsLong()>=captureDeadline&&stopAt.get()==0)physicalStop(false);submit(()->{});}}
 public void close(){stop(true);}
}
