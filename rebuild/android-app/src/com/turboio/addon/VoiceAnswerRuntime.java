package com.turboio.addon;

import android.app.*;
import android.os.*;
import java.io.*;
import java.lang.ref.WeakReference;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicBoolean;

/** Android owner of an explicitly requested original-question voice draft.
 * Preparing never claims the mic. Each capture requires fresh native version/idle checks.
 * Physical stop dispatch never waits for this IO lane, ASR, or durable writes. */
final class VoiceAnswerRuntime {
 interface Result {void done(Snapshot value,String error);}
 interface Observer {void changed(Snapshot value);}
 static final class Snapshot {
  final String phase,note,text,binding,requestId;
  final boolean canStart,canSave,needsStop,cleaned;
  Snapshot(String phase,String note,String text,String binding,String requestId,boolean canStart,boolean canSave,boolean needsStop,boolean cleaned){this.phase=phase;this.note=note;this.text=text;this.binding=binding;this.requestId=requestId;this.canStart=canStart;this.canSave=canSave;this.needsStop=needsStop;this.cleaned=cleaned;}
 }
 private static VoiceAnswerRuntime instance;
 private final File files;private final TaskRuntime tasks;
 private final Handler main=new Handler(Looper.getMainLooper());
 private final ExecutorService io=Executors.newSingleThreadExecutor(r->{Thread t=new Thread(r,"iO-Agent-voice-owner");t.setDaemon(true);return t;});
 private final Map<Observer,WeakReference<Activity>> observers=new WeakHashMap<>();
 private final Set<Activity> visible=Collections.newSetFromMap(new WeakHashMap<Activity,Boolean>());
 private final List<Attempt> retained=new ArrayList<>(); // IO lane; journals stay owned until process exit.
 private volatile Attempt active;private volatile boolean blocked,loaded;
 // Glasses-started dictation that may continue with the screen off / App in background (TaskAttention).
 private volatile Object backgroundOwner;private volatile Observer headless;
 private boolean action;private long actionId;
 private InterruptedVoiceRecovery interruptedRecovery;
 private volatile Snapshot value=new Snapshot("IDLE","","","","",false,false,false,true);
 private interface Work {void run()throws Exception;}
 private static final class Attempt {
  final String id;final VoiceAnswerJournal journal;final VoiceAnswerSession draft;
  volatile String binding="",request="",peer="",token="",note="",traced="";volatile long generation,captureOperation;
  volatile boolean starting,abort,recovery,physicallyReleased=true,manifestComplete,reviewHeld;boolean audioSeen;final AtomicBoolean arming=new AtomicBoolean();
  volatile Host107Recording recording;volatile VoiceCaptureCutoff cutoff;volatile VoiceAnswerCoordinator coordinator;
  volatile Host107VoiceTask engine;volatile Host107VoiceDecoder decoder;volatile VoiceAudioArchive archive;
  volatile CaptureSession.StopProbe probe;volatile long recoveryFence;volatile boolean recovering;
  final Object resourceLock=new Object();volatile boolean nativeStartAttempted,recoveryArchiveSealed,recoveryArchiveClosed;
  volatile Host107VoiceTask releasedEngine,coordinatorEngine;volatile Host107VoiceDecoder releasedDecoder;
  volatile VoiceRecoveryProof.Warm recoveryProof;
  Attempt(String id,VoiceAnswerJournal journal){this.id=id;this.journal=journal;draft=new VoiceAnswerSession(journal);}
 }
 static synchronized VoiceAnswerRuntime get(Activity activity){
  if(instance==null)instance=new VoiceAnswerRuntime((Application)activity.getApplicationContext(),TaskRuntime.get(activity));instance.visible.add(activity);return instance;
 }
 /** No-page access for a glasses-started dictation with the App in the background. */
 static synchronized VoiceAnswerRuntime get(Application app,TaskRuntime tasks){if(instance==null)instance=new VoiceAnswerRuntime(app,tasks);return instance;}
 private boolean background(){return backgroundOwner!=null&&TaskAttention.background();}
 private boolean attended(){return !visible.isEmpty()||background();}
 /** owner keeps its capture running when no page is visible; clearing is per owner. */
 void keepInBackground(Object owner,boolean on){mainThread();if(on)backgroundOwner=owner;else if(backgroundOwner==owner){backgroundOwner=null;if(visible.isEmpty())stop(true,null);}}
 void observeHeadless(Observer observer){mainThread();headless=observer;observer.changed(value);}
 void unobserveHeadless(Observer observer){mainThread();if(headless==observer)headless=null;}
 private VoiceAnswerRuntime(Application application,TaskRuntime tasks){
  files=application.getFilesDir();this.tasks=tasks;
  application.registerActivityLifecycleCallbacks(new Application.ActivityLifecycleCallbacks(){
   public void onActivityResumed(Activity a){visible.add(a);}
   public void onActivityPaused(Activity a){visible.remove(a);if(!attended())stop(true,null);}
   public void onActivityDestroyed(Activity a){visible.remove(a);observers.entrySet().removeIf(e->e.getValue().get()==null||e.getValue().get()==a);if(!attended())stop(true,null);}
   public void onActivityCreated(Activity a,Bundle b){}public void onActivityStarted(Activity a){}public void onActivityStopped(Activity a){}public void onActivitySaveInstanceState(Activity a,Bundle b){}
  });
  io.execute(()->{try{scan();}catch(Exception invalid){blocked=true;}finally{loaded=true;if(active!=null)refresh(active,null);else publish(new Snapshot(blocked?"BLOCKED":"IDLE",blocked?"VOICE_RECOVERY_REQUIRED":"","","","",false,false,blocked,!blocked));}});
 }
 private static void mainThread(){TaskWire.require(Looper.myLooper()==Looper.getMainLooper(),"VOICE_THREAD_INVALID");}
 void observe(Activity activity,Observer observer){mainThread();observers.put(observer,new WeakReference<>(activity));observer.changed(value);}
 void unobserve(Observer observer){mainThread();observers.remove(observer);}
 private void publish(Snapshot next){publish(null,next);}
 private void publish(Attempt owner,Snapshot next){main.post(()->{if(owner!=null&&!owns(owner))return;value=next;observers.entrySet().removeIf(e->e.getValue().get()==null||e.getValue().get().isDestroyed());for(Observer observer:new ArrayList<>(observers.keySet()))try{if(observers.containsKey(observer))observer.changed(next);}catch(RuntimeException ignored){}Observer h=headless;if(h!=null)try{h.changed(next);}catch(RuntimeException ignored){}});}
 private void finish(long operation,Result result,String error){main.post(()->{if(operation>0){if(operation!=actionId||!action)return;action=false;}if(result!=null)result.done(value,error==null?"":error);});}
 private long begin(Result result){mainThread();if(action){android.util.Log.i("TurboIOVoice","runtime busy: earlier operation still open");if(result!=null)result.done(value,"VOICE_BUSY");return 0;}action=true;return ++actionId;}
 private static String error(Throwable e){String code=e.getMessage();return code!=null&&code.matches("[A-Z][A-Z0-9_]{1,63}")?code:"VOICE_RUNTIME_FAILED";}
 private void work(Attempt owner,Work work,Result result,long operation){io.execute(()->{String failure="";try{TaskWire.require(owner==active,"VOICE_TARGET_CHANGED");work.run();}catch(Exception e){failure=error(e);owner.note=failure;}refresh(owner,null);finish(operation,result,failure);});}
 private boolean handoff(Attempt a){return TaskRuntime.glassesAllowed()&&attended()&&Host107Login.loggedIn()&&AgentCardRuntime.voiceHandoffReady(a.binding,a.request)&&HeadGestureRuntime.voiceHandoffReady();}
 private boolean owns(Attempt a){return active==a;}
 private static String id(){return UUID.randomUUID().toString().replace("-","");}
 private File safe(String relative)throws IOException{
  Path base=files.toPath().toAbsolutePath().normalize(),target=base.resolve(relative).normalize();
  if(!target.startsWith(base))throw new IOException("VOICE_PATH_INVALID");
  Path cursor=base;for(Path part:base.relativize(target)){cursor=cursor.resolve(part);if(Files.isSymbolicLink(cursor))throw new IOException("VOICE_PATH_INVALID");}
  return target.toFile();
 }
 private byte[] bytes(File file,int limit)throws IOException{
  try(InputStream in=Files.newInputStream(file.toPath());ByteArrayOutputStream out=new ByteArrayOutputStream()){byte[] block=new byte[4096];int n;while((n=in.read(block))!=-1){if(out.size()+n>limit)throw new IOException("VOICE_FILE_BUDGET");out.write(block,0,n);}return out.toByteArray();}
 }
 private Attempt open(String name)throws Exception{
  safe("voice-drafts/"+name+".json");safe("voice-drafts/"+name+".json.partial");safe("voice-drafts/"+name+".json.lock");
  Attempt a=new Attempt(name,new VoiceAnswerJournal(files,name));retained.add(a);bind(a);return a;
 }
 private void bind(Attempt a){
  Map<String,Object> state=WireJson.map(a.draft.snapshot());a.token=(String)state.get("token");
  if(state.get("target") instanceof Map){Map<String,Object> target=WireJson.map(state.get("target"));a.binding=(String)target.get("binding");a.request=(String)WireJson.map(target.get("request")).get("object_id");}
 }
 private void scan()throws Exception{
  File directory=safe("voice-drafts");if(!directory.exists())return;
  File[] entries=directory.listFiles();if(entries==null||entries.length>512)throw new IOException("VOICE_RECOVERY_REQUIRED");
  Arrays.sort(entries,Comparator.comparing(File::getName));int count=0;
  for(File file:entries){String name=file.getName();if(name.matches("[a-f0-9]{32}\\.json\\.partial")){blocked=true;continue;}if(!name.matches("[a-f0-9]{32}\\.json"))continue;
   if(++count>128)throw new IOException("VOICE_RECOVERY_REQUIRED");safe("voice-drafts/"+name);if(!file.isFile()||file.length()>2097152)throw new IOException("VOICE_STORE_INVALID");
   Attempt a=open(name.substring(0,32));if(!a.draft.healthy()){blocked=true;continue;}
   if(a.draft.needsStop()){a.recovery=true;a.physicallyReleased=false;a.note="VOICE_RECOVERY_REQUIRED";if(active==null)active=a;}
  }
 }
 void prepare(String binding,String requestId,long revision,String fingerprint,Result result){
  long operation=begin(result);if(operation==0)return;
  io.execute(()->{try{
   TaskWire.require(loaded&&!blocked,"VOICE_RECOVERY_REQUIRED");
   for(Attempt item:retained)if(item.draft.needsStop()||!item.physicallyReleased){active=item;throw new IOException("VOICE_RECOVERY_REQUIRED");}
   Attempt chosen=null;
   for(Attempt item:retained)if(binding.equals(item.binding)&&requestId.equals(item.request)&&!"IDLE".equals(item.draft.phase())){
    Map<String,Object> target=WireJson.map(WireJson.map(item.draft.snapshot()).get("target"));Map<String,Object> request=WireJson.map(target.get("request"));
    if(fingerprint.equals(target.get("fingerprint"))&&revision==TaskWire.positive(request.get("revision"))&&TaskWire.set("PREPARED","REVIEW","SUBMITTING","SAVED").contains(item.draft.phase())&&!("PREPARED".equals(item.draft.phase())&&(item.arming.get()||safe("voice-process/"+item.id+".json").exists()||safe("voice-audio/"+item.token).exists())))chosen=item;
   }
   if(chosen!=null&&!"PREPARED".equals(chosen.draft.phase())){active=chosen;refresh(chosen,null);finish(operation,result,"");return;}
   Attempt a=chosen==null?open(id()):chosen;active=a;
   main.post(()->tasks.prepareVoice(binding,requestId,revision,fingerprint,a.draft,(snapshot,failure)->{
    io.execute(()->{bind(a);if(!failure.isEmpty())a.note=failure;else AgentCardRuntime.voiceStage(a.request,"question_ready");refresh(a,null);finish(operation,result,failure);});
   }));
  }catch(Exception e){if(active!=null)refresh(active,null);finish(operation,result,error(e));}});
 }
 private void refresh(Attempt a,VoiceAnswerCoordinator.State event){
  if(!owns(a))return;
  try{
   bind(a);String phase=a.draft.phase();boolean needs=a.draft.needsStop();boolean clean=!needs&&a.physicallyReleased;
   boolean review="REVIEW".equals(phase);a.manifestComplete=review&&manifest(a);
   VoiceAnswerCoordinator.State latest=a.coordinator==null?null:a.coordinator.snapshot();
   boolean save=clean&&a.draft.healthy()&&(TaskWire.set("SUBMITTING","SAVED").contains(phase)||(review&&a.manifestComplete&&(latest==null||latest.answerReady)));
   String note=a.note;if(needs&&a.recovery)note="VOICE_RECOVERY_REQUIRED";else if(review&&a.draft.timeLimited())note="VOICE_TIME_LIMIT";
   final String text=a.draft.answerText(),p=phase,n=note;final boolean canSave=save,isClean=clean,need=needs||(!a.physicallyReleased&&!a.starting);
   // Timing trace for the dictation-to-confirm delay (2026-10-23); states only, never the transcript.
   String trace="phase="+p+" note="+n+" save="+canSave+" clean="+isClean+" needs="+needs+" manifest="+a.manifestComplete+" ready="+(latest!=null&&latest.answerReady)+" released="+(latest!=null&&latest.released);if(!trace.equals(a.traced)){a.traced=trace;android.util.Log.i("TurboIOVoice","voice "+trace);}
   // The wearer sees the glasses recording view while capture runs; ordinary notifications wait (TaskAttention).
   // 2026-10-24 (device): releasing at REVIEW let a queued notice take the lens before the confirm card was
   // offered. A saveable review keeps the lens once for the confirm offer (the card then holds "card").
   if(needs)TaskAttention.hold("voice",VoiceAnswerSession.CAPTURE_SECONDS*1000L+20000);
   else if("REVIEW".equals(phase)){if(canSave&&!a.reviewHeld){a.reviewHeld=true;TaskAttention.hold("voice",20000);}}
   else if(!"PREPARED".equals(phase))TaskAttention.release("voice");
   if("PREPARED".equals(phase)&&!a.starting){
    publish(a,new Snapshot(p,blocked?"VOICE_RECOVERY_REQUIRED":"VOICE_PREFLIGHT_NOT_READY",text,a.binding,a.request,false,canSave,need,isClean));
    main.post(()->{if(!owns(a)||a.starting)return;Fixed60Session.Link link=Host107Ota.link();boolean ready=handoff(a);if(!ready)android.util.Log.i("TurboIOVoice","handoff blocked attended="+attended()+" login="+Host107Login.loggedIn()+" card="+AgentCardRuntime.handoffBlockers(a.binding,a.request));io.execute(()->{// The shipped host/decoder are checked during build. A developer enrollment file
    // belongs to old diagnostic runs, not to a new installation or phone. Actual
    // microphone admission still occurs in acquire/inspect/arm with the fresh peer.
    boolean connected=link.peer!=null&&!link.peer.isEmpty();android.util.Log.i("TurboIOVoice","prepared check connected="+connected+" ready="+ready+" blocked="+blocked+" clean="+isClean+" owns="+owns(a)+" starting="+a.starting+" action="+action);if(!owns(a)||a.starting||!"PREPARED".equals(a.draft.phase()))return;publish(a,new Snapshot(p,blocked?"VOICE_RECOVERY_REQUIRED":connected?(ready?n:"VOICE_PREFLIGHT_NOT_READY"):"VOICE_CONNECTION_CHANGED",text,a.binding,a.request,connected&&ready&&!blocked&&isClean,canSave,need,isClean));if(connected&&!ready&&!blocked)main.postDelayed(()->{if(owns(a)&&!a.starting&&attended()&&(!observers.isEmpty()||headless!=null))refreshLater(a);},500);});});
   }else publish(a,new Snapshot(p,n,text,a.binding,a.request,false,canSave,need,isClean));
  }catch(Exception invalid){a.note=error(invalid);publish(a,new Snapshot("BLOCKED",a.note,"",a.binding,a.request,false,false,true,false));}
 }
 void start(Result result){
  long operation=begin(result);if(operation==0)return;Attempt a=active;
  if(a==null||blocked||!value.canStart||!handoff(a)){finish(operation,result,"VOICE_START_NOT_READY");return;}
  Fixed60Session.Link link=Host107Ota.link();a.starting=true;a.abort=false;a.captureOperation=operation;a.peer=link.peer;a.generation=link.generation;
  io.execute(()->{try{TaskWire.require(owns(a)&&a.draft.healthy()&&"PREPARED".equals(a.draft.phase()),"VOICE_START_NOT_READY");main.post(()->acquire(a,operation,result));}
   catch(Exception e){a.starting=false;a.note=error(e);refresh(a,null);finish(operation,result,a.note);}});
 }
 private void acquire(Attempt a,long operation,Result result){
  if(!owns(a)||a.abort||!handoff(a)){a.starting=false;refreshLater(a);finish(operation,result,"VOICE_START_NOT_READY");return;}
  Fixed60Session.Link link=Host107Ota.link();if(!a.peer.equals(link.peer)||a.generation!=link.generation){a.starting=false;refreshLater(a);finish(operation,result,"VOICE_CONNECTION_CHANGED");return;}
  try{
   a.cutoff=cutoff(a);a.recording=Host107Recording.acquire(a.draft,a.cutoff,receiver(a,false,operation,result));
   TaskWire.require(a.recording!=null,"VOICE_CAPTURE_BUSY");a.physicallyReleased=false;AgentCardRuntime.voiceStage(a.request,"device_check");a.recording.inspect();
  }catch(Exception e){unarmedFailure(a,operation,result,error(e));}
 }
 private VoiceCaptureCutoff cutoff(Attempt a){return new VoiceCaptureCutoff(SystemClock::elapsedRealtime,(token,peer,generation)->{Host107Recording owner=a.recording;if(owner==null)throw new IOException("VOICE_STOP_DISPATCH_FAILED");owner.deadlineStop(token,peer,generation);});}
 private void refreshLater(Attempt a){io.execute(()->refresh(a,null));}
 private Host107Recording.Receiver receiver(Attempt a,boolean recovery,long operation,Result result){
  final long fence=a.recoveryFence;return new Host107Recording.Receiver(){
   private boolean current(){return owns(a)&&recovery==a.recovery&&(recovery?fence==a.recoveryFence:operation==a.captureOperation);}
   public void frame(String peer,long generation,byte[] data){if(current()&&!recovery&&a.coordinator!=null)a.coordinator.frame(peer,generation,data);}
   public void sent(int type,boolean accepted,long at){if(!current())return;if(!recovery){if(type==1&&accepted)AgentCardRuntime.voiceStage(a.request,"recording_command_accepted");if(a.coordinator!=null)a.coordinator.sent(type,accepted,at);return;}if(type!=4)return;
    io.execute(()->{try{TaskWire.require(current()&&accepted&&a.draft.stopSubmitted(a.token,a.peer,a.generation,at),"VOICE_STOP_SUBMISSION_UNCONFIRMED");a.probe=a.draft.probeStop(a.peer,a.generation,SystemClock.elapsedRealtime());TaskWire.require(a.probe!=null,"VOICE_STOP_PROOF_REJECTED");main.post(()->{if(current())try{a.recording.inspectIdle();}catch(Exception e){recoveryFailure(a,error(e));}});}catch(Exception e){recoveryFailure(a,error(e));}});
   }
   public void noStart(long at){if(current()&&!recovery&&a.coordinator!=null)a.coordinator.noStart(at);}
   public void ready(boolean ready,long at){if(!current()||recovery)return;if(ready){AgentCardRuntime.voiceStage(a.request,"device_ready");arm(a,operation,result);}else main.post(()->unarmedFailure(a,operation,result,"VOICE_PREFLIGHT_NOT_READY"));}
   public void idle(boolean idle,long at){if(!current())return;if(!recovery){if(a.coordinator!=null)a.coordinator.idle(idle,at);return;}
    io.execute(()->{try{TaskWire.require(current()&&a.draft.deviceIdle(a.probe,a.peer,a.generation,at,idle)&&a.draft.finish(),"VOICE_STOP_PROOF_REJECTED");completeRecoveryResources(a,fence);}catch(Exception e){recoveryFailure(a,error(e));}});
   }
   public void fault(String code){if(!current())return;if(recovery){recoveryFailure(a,code);return;}VoiceAnswerCoordinator c=a.coordinator;if(c!=null)c.fault(code);else main.post(()->unarmedFailure(a,operation,result,code));}
  };
 }
 private void unarmedFailure(Attempt a,long operation,Result result,String code){
  if(!owns(a))return;a.abort=true;a.starting=false;a.note=code;
  // Release is allowed only before arm. If the IO arm has won the race, preserve
  // the obligation and dispatch stop before asking IO to persist anything.
  physicalStop(a,true);
  io.execute(()->{
   if(a.draft.needsStop()){a.recovery=true;a.note="VOICE_RECOVERY_REQUIRED";refresh(a,null);finish(operation,result,code);return;}
   main.post(()->releaseUnarmed(a,operation,result,code,0));
  });
 }
 private void releaseUnarmed(Attempt a,long operation,Result result,String code,int retry){
  if(!owns(a)||(operation>0&&a.captureOperation!=operation))return;
  try{if(a.recording!=null)a.physicallyReleased=a.recording.releasePrepared();else{if(a.cutoff!=null)a.cutoff.close();a.physicallyReleased=true;}}catch(Exception ignored){a.physicallyReleased=false;}
  if(!a.physicallyReleased&&retry<3){main.postDelayed(()->releaseUnarmed(a,operation,result,code,retry+1),100);return;}
  if(!a.physicallyReleased)a.note="VOICE_RECOVERY_REQUIRED";io.execute(()->{refresh(a,null);finish(operation,result,code);});
 }
 private void processRecord(Attempt a)throws Exception{
  File record=safe("voice-process/"+a.id+".json");File partial=safe("voice-process/"+a.id+".json.partial");safe("voice-process/"+a.id+".json.lock");
  TaskWire.require(!record.exists()&&!partial.exists(),"VOICE_PROCESS_RECORD_EXISTS");
  VoiceProcessProof.Stamp stamp=VoiceProcessProof.parseStat(bytes(new File("/proc/self/stat"),8192));TaskWire.require(stamp.pid==android.os.Process.myPid(),"VOICE_PROCESS_STAMP_INVALID");
  byte[] proof=VoiceProcessProof.record(a.id,a.token,stamp.pid,stamp.startTicks);
  try(AtomicDocument doc=new AtomicDocument(record)){doc.save(WireJson.read(proof,8192,32));}
  TaskWire.require(!partial.exists()&&Arrays.equals(proof,bytes(record,8192)),"VOICE_PROCESS_RECORD_INVALID");
 }
 private void arm(Attempt a,long operation,Result result){
  if(!a.arming.compareAndSet(false,true))return;
  io.execute(()->{try{TaskWire.require(owns(a)&&a.starting&&!a.abort,"VOICE_START_NOT_READY");
   main.post(()->{try{
    TaskWire.require(owns(a)&&!a.abort&&handoff(a),"VOICE_START_NOT_READY");
    Host107VoiceEnvironment environment=Host107VoiceEnvironment.current("zh-CN");TaskWire.require(environment.idle(),"VOICE_ENGINE_BUSY");
    a.engine=environment.prepare(a.token,new Host107VoiceTask.Listener(){
     public void result(String text,boolean finished){VoiceAnswerCoordinator c=a.coordinator;if(owns(a)&&!a.recovery&&c!=null)c.listener().result(text,finished);}
     public void started(boolean accepted){VoiceAnswerCoordinator c=a.coordinator;if(owns(a)&&!a.recovery&&c!=null)c.listener().started(accepted);}
     public void engineAudio(boolean active){VoiceAnswerCoordinator c=a.coordinator;if(owns(a)&&!a.recovery&&c!=null)c.listener().engineAudio(active);}
     public void error(String code){VoiceAnswerCoordinator c=a.coordinator;if(owns(a)&&!a.recovery&&c!=null)c.listener().error(code);}
    });
    completeArm(a,operation,result);
   }catch(Exception e){startupFailure(a,operation,result,error(e));}});
  }catch(Exception e){startupFailure(a,operation,result,error(e));}});
 }
 private void completeArm(Attempt a,long operation,Result result){
  io.execute(()->{try{
   TaskWire.require(owns(a)&&a.starting&&!a.abort,"VOICE_START_NOT_READY");
   a.decoder=new Host107VoiceDecoder();safe("voice-audio/"+a.token);a.archive=new VoiceAudioArchive(files,a.token,14);
   processRecord(a);TaskWire.require(!a.abort,"VOICE_START_NOT_READY");
   long now=SystemClock.elapsedRealtime();TaskWire.require(a.cutoff.arm(a.token,FixedPeerHash.of(a.peer),a.generation,now+VoiceAnswerSession.CAPTURE_SECONDS*1000L)&&a.draft.arm(a.peer,a.generation,now,VoiceAnswerSession.CAPTURE_SECONDS,a.cutoff),"VOICE_START_NOT_READY");
   RecordingVoiceSource source=new RecordingVoiceSource(a.token,a.peer,a.generation,a.archive,a.decoder::decode);
   final Host107Recording captureOwner=a.recording;
   VoiceAnswerCoordinator c=new VoiceAnswerCoordinator(a.draft,a.peer,a.generation,source,a.archive,device(a),SystemClock::elapsedRealtime,state->{
    if(!owns(a)||a.recovery||a.recording!=captureOwner)return;if(state.released)a.physicallyReleased=true;a.note=state.note;io.execute(()->{if(!a.recovery&&a.recording==captureOwner)refresh(a,state);});
   });a.coordinator=c;
   final Host107VoiceTask nativeOwner=a.engine;final Host107VoiceDecoder decoderOwner=a.decoder;a.coordinatorEngine=nativeOwner;
   c.attachEngine(new VoiceAnswerCoordinator.Engine(){
    public boolean start()throws Exception{return startNative(a);}
    public boolean working()throws Exception{return "WORKING".equals(nativeOwner.state());}
    public void pcm(byte[] bytes)throws Exception{nativeOwner.pcm(a.token,bytes);if(!a.audioSeen){a.audioSeen=true;AgentCardRuntime.voiceStage(a.request,"audio_receiving");}}
    public void sealInput()throws Exception{nativeOwner.sealInput(a.token);}
    public boolean stop()throws Exception{return nativeOwner.stop(a.token);}
    public boolean stopped()throws Exception{return nativeOwner.engineStopped();}
    public void release()throws Exception{releaseOwnedEngine(a,nativeOwner,decoderOwner);}
   });
   a.starting=false;if(a.abort)c.stop(true);else c.start();tick(a,c);refresh(a,null);finish(operation,result,"");
  }catch(Exception e){startupFailure(a,operation,result,error(e));}});
 }
 private boolean startNative(Attempt a)throws Exception{
  CountDownLatch finished=new CountDownLatch(1);AtomicBoolean pending=new AtomicBoolean(true),accepted=new AtomicBoolean();
  final Host107Recording owner=a.recording;final Host107VoiceTask nativeTask=a.engine;final String token=a.token,peer=FixedPeerHash.of(a.peer);final long generation=a.generation;
  main.post(()->{try{CaptureSession.CapturePermit permit=a.draft.capturePermit();
   if(pending.compareAndSet(true,false)&&owns(a)&&a.recording==owner&&a.engine==nativeTask&&!a.abort&&!a.recovery&&handoff(a)&&permit.opening&&token.equals(permit.token)&&peer.equals(permit.peer)&&generation==permit.generation&&SystemClock.elapsedRealtime()<permit.deadline){a.nativeStartAttempted=true;accepted.set(nativeTask.start(token));}
  }catch(Exception ignored){}finally{finished.countDown();}});
  boolean completed=finished.await(8,TimeUnit.SECONDS);pending.set(false);return completed&&accepted.get();
 }
 private void startupFailure(Attempt a,long operation,Result result,String code){
  physicalStop(a,true);a.note=code;
  io.execute(()->{if(!owns(a))return;
   if(a.draft.needsStop()){a.recovery=true;a.starting=false;try{a.draft.stop(a.token,SystemClock.elapsedRealtime(),true);}catch(Exception ignored){}refresh(a,null);finish(operation,result,code);}
   else{closeUnstarted(a);if(a.cutoff!=null&&a.cutoff.pending()){blocked=true;a.note="VOICE_RECOVERY_REQUIRED";}main.post(()->unarmedFailure(a,operation,result,a.note));}
  });
 }
 private void releaseOwnedEngine(Attempt a,Host107VoiceTask nativeOwner,Host107VoiceDecoder decoderOwner)throws Exception{
  synchronized(a.resourceLock){
   TaskWire.require(nativeOwner!=null&&a.engine==nativeOwner&&a.token.equals(nativeOwner.token()),"VOICE_ENGINE_OWNER_CHANGED");
   if(a.releasedEngine!=nativeOwner){nativeOwner.release(a.token);a.releasedEngine=nativeOwner;}
   if(decoderOwner!=null&&a.releasedDecoder!=decoderOwner){TaskWire.require(a.decoder==decoderOwner,"VOICE_ENGINE_OWNER_CHANGED");decoderOwner.close();a.releasedDecoder=decoderOwner;}
  }
 }
 private void closeUnstarted(Attempt a){try{if(a.engine!=null)releaseOwnedEngine(a,a.engine,a.decoder);else if(a.decoder!=null){a.decoder.close();a.releasedDecoder=a.decoder;}}catch(Exception ignored){}try{if(a.archive!=null)a.archive.close();}catch(Exception ignored){}}
 private void tick(Attempt a,VoiceAnswerCoordinator c){main.postDelayed(()->{if(!owns(a)||a.coordinator!=c||c.snapshot().released||(a.recovery&&a.releasedEngine==a.engine&&(a.decoder==null||a.releasedDecoder==a.decoder)))return;if(!TaskRuntime.glassesAllowed())c.stop(false);c.tick();tick(a,c);},500);}
 private VoiceAnswerCoordinator.Device device(Attempt a){final Host107Recording owner=a.recording;final String token=a.token,peerHash=FixedPeerHash.of(a.peer);final long generation=a.generation;return new VoiceAnswerCoordinator.Device(){
  private void post(Work work){main.post(()->{if(!owns(a)||a.recovery||a.recording!=owner)return;try{work.run();}catch(Exception e){VoiceAnswerCoordinator c=a.coordinator;if(c!=null)c.fault(error(e));}});}
  public void begin(){post(()->{TaskWire.require(!a.abort&&handoff(a),"VOICE_START_NOT_READY");owner.begin();});}
  public void stop(){owner.deadlineStop(token,peerHash,generation);}
  public void acknowledge(int type){post(()->owner.acknowledge(type));}
  public void inspectIdle(){post(()->owner.inspectIdle());}
  public boolean release()throws Exception{
   CountDownLatch finished=new CountDownLatch(1);AtomicBoolean released=new AtomicBoolean();main.post(()->{try{if(owns(a)&&!a.recovery&&a.recording==owner)released.set(owner.release());}finally{finished.countDown();}});
   return finished.await(3,TimeUnit.SECONDS)&&released.get();
  }
 };}
 private void physicalStop(Attempt a,boolean cancel){
  if(a==null)return;a.abort=true;VoiceAnswerCoordinator c=a.coordinator;
  if(c!=null&&!a.recovery){c.stop(cancel);return;}
  Host107Recording owner=a.recording;if(owner!=null)try{owner.deadlineStop(a.token,FixedPeerHash.of(a.peer),a.generation);}catch(Exception ignored){a.note="VOICE_RECOVERY_REQUIRED";}
 }
 void stop(boolean cancel,Result result){
  mainThread();Attempt a=active;if(a==null){if(result!=null)result.done(value,"");return;}
  // No begin(): stop must remain available while prepare/start/save is busy.
  physicalStop(a,cancel);io.execute(()->{String failure="";try{
   if(a.coordinator==null&&a.draft.needsStop()){a.draft.stop(a.token,SystemClock.elapsedRealtime(),cancel);a.recovery=true;a.note="VOICE_RECOVERY_REQUIRED";}
   // PREPARED is kept intact so leaving the page preserves the unstarted draft.
   if(!a.draft.needsStop()&&a.recording!=null&&!a.physicallyReleased&&"PREPARED".equals(a.draft.phase()))main.post(()->releaseUnarmed(a,0,null,"",0));
  }catch(Exception e){failure=error(e);}refresh(a,null);final String code=failure;main.post(()->{if(result!=null)result.done(value,code);});});
 }
 /** Re-dictate: retire this question's unsaved REVIEW draft as CANCELLED (text,
  * audio and journal stay on the device) and prepare a fresh attempt for the
  * same original question. Nothing is submitted; a capture in progress is not affected. */
 void redo(String binding,String requestId,long revision,String fingerprint,Result result){
  long operation=begin(result);if(operation==0)return;Attempt a=active;
  if(a==null||!binding.equals(a.binding)||!requestId.equals(a.request)){finish(operation,result,"VOICE_TARGET_CHANGED");return;}
  io.execute(()->{try{
   TaskWire.require(owns(a)&&a.physicallyReleased&&a.draft.healthy()&&!a.draft.needsStop()&&"REVIEW".equals(a.draft.phase())&&a.draft.cancelDraft(SystemClock.elapsedRealtime()),"VOICE_ANSWER_NOT_READY");
   a.note="";
  }catch(Exception e){a.note=error(e);refresh(a,null);finish(operation,result,a.note);return;}
  finish(operation,null,"");main.post(()->prepare(binding,requestId,revision,fingerprint,result));});
 }
 void edit(String text,Result result){long operation=begin(result);if(operation==0)return;Attempt a=active;if(a==null){finish(operation,result,"VOICE_ANSWER_NOT_READY");return;}work(a,()->{TaskWire.require(a.physicallyReleased&&a.draft.edit(text),"VOICE_ANSWER_NOT_READY");},result,operation);}
 void save(Result result){
  long operation=begin(result);if(operation==0)return;Attempt a=active;if(a==null){finish(operation,result,"VOICE_ANSWER_NOT_READY");return;}
  io.execute(()->{try{
   TaskWire.require(owns(a)&&a.physicallyReleased&&a.draft.healthy()&&!a.draft.needsStop(),"VOICE_ANSWER_NOT_READY");String phase=a.draft.phase();
   TaskWire.require(TaskWire.set("REVIEW","SUBMITTING","SAVED").contains(phase),"VOICE_ANSWER_NOT_READY");
   if("REVIEW".equals(phase))TaskWire.require(manifest(a)&&(a.coordinator==null||a.coordinator.snapshot().answerReady),"VOICE_COMPLETENESS_INVALID");
   main.post(()->tasks.answerVoice(a.binding,a.draft,(snapshot,failure)->io.execute(()->{a.note=failure;refresh(a,null);finish(operation,result,failure);}))); 
  }catch(Exception e){a.note=error(e);refresh(a,null);finish(operation,result,a.note);}});
 }
 private boolean manifest(Attempt a){try{VoiceAnswerEvidence.verify(files,a.draft);return true;}catch(Exception invalid){return false;}}
 private boolean coldAdmission(Attempt a,Fixed60Session.Link link)throws Exception{
  // A readable self stat prevents an unavailable procfs from being mistaken for
  // the old PID's disappearance. Only exact ENOENT is an absence observation.
  VoiceProcessProof.Stamp self=VoiceProcessProof.parseStat(bytes(new File("/proc/self/stat"),8192));TaskWire.require(self.pid==android.os.Process.myPid(),"VOICE_PROCESS_STAMP_INVALID");
  File record=safe("voice-process/"+a.id+".json");TaskWire.require(!safe("voice-process/"+a.id+".json.partial").exists(),"VOICE_PROCESS_RECORD_INVALID");byte[] raw=bytes(record,8192);int pid=VoiceProcessProof.ownerPid(raw,a.id,a.token);
  try{return VoiceRecoveryProof.cold(a.draft,a.id,link.peer,link.generation,raw,self,android.os.Process.myPid(),VoiceProcessProof.parseStat(bytes(new File("/proc/"+pid+"/stat"),8192)),false);}
  catch(NoSuchFileException absent){return VoiceRecoveryProof.cold(a.draft,a.id,link.peer,link.generation,raw,self,android.os.Process.myPid(),null,true);}
 }
 private void recoveryFailure(Attempt a,String code){if(!owns(a))return;a.recovering=false;a.note="VOICE_RECOVERY_REQUIRED";refreshLater(a);}
 private VoiceRecoveryProof.Warm publishedWarm(Attempt a){return a.coordinator==null?null:VoiceRecoveryProof.published(a.draft,a.coordinator.snapshot().draftSnapshot,a.coordinatorEngine,a.token,a.peer,a.generation);}
 private boolean warmSeal(Attempt a){return publishedWarm(a)!=null;}
 private boolean retainedWarmSeal(Attempt a){return a.recovery&&a.recoveryProof!=null&&a.recoveryProof.current(a.draft,a.engine);}
 /** No opened audio directory is replaced or reconstructed during cleanup. A
  * published old-coordinator barrier precedes generation handoff; its remaining
  * worker actions are owner-fenced and may only retire the exact native task. */
 private void completeRecoveryResources(Attempt a,long fence){completeRecoveryResources(a,fence,SystemClock.elapsedRealtime()+10000);}
 private void completeRecoveryResources(Attempt a,long fence,long until){
  if(!owns(a)||!a.recovery||a.recoveryFence!=fence)return;
  try{
   TaskWire.require(a.draft.healthy()&&!a.draft.needsStop()&&TaskWire.set("CANCELLED","INCOMPLETE").contains(a.draft.phase()),"VOICE_RECOVERY_REQUIRED");
   if(a.engine!=null){
    if(a.releasedEngine!=a.engine){
     TaskWire.require(a.coordinator!=null&&SystemClock.elapsedRealtime()<until,"VOICE_ENGINE_RELEASE_UNCONFIRMED");
     a.coordinator.tick();main.postDelayed(()->io.execute(()->completeRecoveryResources(a,fence,until)),200);return;
    }
    // If releaseTask succeeded but decoder.close failed, retry only that owned
    // resource. A release flag is never used as proof for a started engine.
    releaseOwnedEngine(a,a.engine,a.decoder);
   }
   if(a.archive!=null&&!a.recoveryArchiveClosed){
    if(!a.recoveryArchiveSealed){a.archive.incomplete();Map<String,Object> record=WireJson.map(a.archive.seal(a.draft));TaskWire.require(Boolean.TRUE.equals(record.get("sealed"))&&Boolean.FALSE.equals(record.get("complete"))&&a.token.equals(record.get("token")),"VOICE_ARCHIVE_SEAL_FAILED");a.recoveryArchiveSealed=true;}
    a.archive.close();a.recoveryArchiveClosed=true;
   }
   main.post(()->releaseRecovery(a,fence,0));
  }catch(Exception failure){recoveryFailure(a,error(failure));}
 }
 private void releaseRecovery(Attempt a,long fence,int retry){
  if(!owns(a)||!a.recovery||a.recoveryFence!=fence)return;
  try{TaskWire.require((a.engine==null||a.releasedEngine==a.engine)&&(a.decoder==null||a.releasedDecoder==a.decoder)&&(a.archive==null||a.recoveryArchiveClosed),"VOICE_RECOVERY_REQUIRED");a.physicallyReleased=a.recording!=null&&a.recording.release();if(!a.physicallyReleased){if(retry<3){main.postDelayed(()->releaseRecovery(a,fence,retry+1),100);return;}throw new IOException("VOICE_RECOVERY_REQUIRED");}a.recovering=false;a.note="VOICE_INTERRUPTED";refreshLater(a);}
  catch(Exception failure){recoveryFailure(a,error(failure));}
 }
 /** 2026-10-23 R2: a process killed during a task dictation left the glasses recording, and nothing
  * recovered it until someone opened a voice page. Called at App start: once the store is loaded and the
  * glasses are linked, an interrupted capture is closed through the same retryCleanup a page would use;
  * recovered gets the original question so the glasses can offer it again. */
 void recoverInterrupted(java.util.function.BiConsumer<String,String> recovered){
  mainThread();if(interruptedRecovery!=null&&interruptedRecovery.running())return;
  interruptedRecovery=new InterruptedVoiceRecovery(new InterruptedVoiceRecovery.Port(){
   public long now(){return SystemClock.elapsedRealtime();}
   public void later(Runnable action,long delay){main.postDelayed(action,delay);}
   public InterruptedVoiceRecovery.State state(){
    Attempt a=active;Fixed60Session.Link link=Host107Ota.link();
    if(a==null)return new InterruptedVoiceRecovery.State(null,"","",loaded,blocked,true,false,false,true,false,false);
    boolean linked=link.peer!=null&&!link.peer.isEmpty()&&a.draft.capturePermit().peer.equals(FixedPeerHash.of(link.peer));
    return new InterruptedVoiceRecovery.State(a,a.binding,a.request,loaded,blocked,a.draft.healthy(),a.recovery,a.draft.needsStop(),a.physicallyReleased,a.recovering,linked);
   }
   public void cleanup(java.util.function.Consumer<String> dispatched){retryCleanup((snapshot,error)->dispatched.accept(error));}
   public void recovered(String binding,String request){recovered.accept(binding,request);}
   public void incomplete(String reason){android.util.Log.i("TurboIOVoice","interrupted recovery remains pending: "+reason);}
  });
  interruptedRecovery.start();
 }
 void retryCleanup(Result result){
  long operation=begin(result);if(operation==0)return;Attempt a=active;if(a==null||blocked){finish(operation,result,"VOICE_RECOVERY_REQUIRED");return;}
  if(a.recovering){finish(operation,result,"VOICE_BUSY");return;}
  physicalStop(a,true);
  if("PREPARED".equals(a.draft.capturePermit().phase)&&!a.draft.capturePermit().needsStop){releaseUnarmed(a,0,null,"",0);finish(operation,result,"");return;}
  if(a.recovery&&!value.cleaned&&!a.draft.capturePermit().needsStop){a.recovering=true;io.execute(()->completeRecoveryResources(a,a.recoveryFence));finish(operation,result,"");return;}
  Fixed60Session.Link link=Host107Ota.link();
  if(a.coordinator!=null&&!a.recovery){
   a.coordinator.stop(true);a.coordinator.fault("VOICE_INTERRUPTED");a.coordinator.tick();
   if(link.generation<=a.generation||!a.peer.equals(link.peer)){finish(operation,result,"VOICE_CONNECTION_CHANGED");return;}
   a.recovering=true;awaitWarmSeal(a,link,operation,result,SystemClock.elapsedRealtime()+10000);return;
  }
  a.recovering=true;work(a,()->recover(a,link,operation,result),result,operation);
 }
 private void awaitWarmSeal(Attempt a,Fixed60Session.Link link,long operation,Result result,long until){
  io.execute(()->{try{
   TaskWire.require(owns(a)&&a.draft.healthy(),"VOICE_RECOVERY_REQUIRED");
   if(!a.draft.needsStop()){a.recovering=false;refresh(a,null);finish(operation,result,"");return;}
   if(warmSeal(a)){recover(a,link,operation,result);refresh(a,null);finish(operation,result,"");return;}
   TaskWire.require(SystemClock.elapsedRealtime()<until,"VOICE_CALLBACK_SEAL_REQUIRED");
   a.note="VOICE_RECOVERY_REQUIRED";refresh(a,null);main.postDelayed(()->awaitWarmSeal(a,link,operation,result,until),200);
  }catch(Exception failure){recoveryFailure(a,error(failure));finish(operation,result,error(failure));}});
 }
 private void recover(Attempt a,Fixed60Session.Link link,long operation,Result result)throws Exception{
  try{
   TaskWire.require(a.draft.healthy()&&a.draft.needsStop(),"VOICE_RECOVERY_REQUIRED");
   CaptureSession.CapturePermit prior=a.draft.capturePermit();boolean cold=a.engine==null&&a.coordinator==null;
   TaskWire.require(link.peer!=null&&prior.peer.equals(FixedPeerHash.of(link.peer))&&link.generation>0&&(cold||link.generation>prior.generation),"VOICE_CONNECTION_CHANGED");
   boolean sealed=false;VoiceRecoveryProof.Warm warm=null;
   if(cold)TaskWire.require(coldAdmission(a,link),"VOICE_RECOVERY_REQUIRED");
   else if(a.coordinator!=null){warm=publishedWarm(a);if(warm==null&&retainedWarmSeal(a))warm=a.recoveryProof;TaskWire.require(warm!=null&&warm.permits(a.draft,a.engine,link.peer,link.generation),"VOICE_CALLBACK_SEAL_REQUIRED");sealed=true;}
   else{
    TaskWire.require(a.engine!=null&&!a.nativeStartAttempted&&a.abort&&!a.starting,"VOICE_ENGINE_STOP_UNCONFIRMED");
    releaseOwnedEngine(a,a.engine,a.decoder); // exactly owned, never-started external task
   }
   // This recovery intentionally gives up transcript completeness. It never
   // restarts ASR or upgrades an interrupted capture into an answer.
   synchronized(a.draft){
    TaskWire.require(a.draft.stop(a.token,SystemClock.elapsedRealtime(),true),"VOICE_RECOVERY_REQUIRED");
    TaskWire.require(a.draft.failed(a.token,link.peer,prior.generation,"VOICE_INTERRUPTED",SystemClock.elapsedRealtime()),"VOICE_RECOVERY_REQUIRED");
    TaskWire.require(a.draft.resumeCleanup(link.peer,link.generation,SystemClock.elapsedRealtime()),"VOICE_RECOVERY_REQUIRED");
    if(!sealed)TaskWire.require(a.draft.engineSealed(a.token,true,SystemClock.elapsedRealtime()),"VOICE_RECOVERY_REQUIRED");
   }
   if(warm!=null)a.recoveryProof=warm;
   a.peer=link.peer;a.generation=link.generation;a.recovery=true;a.recovering=true;a.recoveryFence++;
   if(a.coordinator!=null)a.coordinator.tick();
   main.post(()->{try{
    TaskWire.require(owns(a),"VOICE_TARGET_CHANGED");Fixed60Session.Link fresh=Host107Ota.link();TaskWire.require(a.peer.equals(fresh.peer)&&a.generation==fresh.generation,"VOICE_CONNECTION_CHANGED");
    VoiceCaptureCutoff guard=cutoff(a);Host107Recording owner=Host107Recording.acquireRecovery(a.draft,guard,receiver(a,true,operation,result));
    if(owner==null){guard.close();throw new IOException("VOICE_RECOVERY_REQUIRED");}a.cutoff=guard;a.recording=owner;a.physicallyReleased=false;owner.stop();
   }catch(Exception failure){recoveryFailure(a,error(failure));}});
  }catch(Exception failure){a.recovering=false;throw failure;}
 }
}
