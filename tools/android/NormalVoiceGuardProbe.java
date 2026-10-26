package com.turboio.androidtests;

import android.app.*;
import android.content.Intent;
import android.net.LocalServerSocket;
import android.net.LocalSocket;
import android.os.*;
import java.io.*;
import java.lang.reflect.*;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.*;
import org.json.*;

/** Test-side observer and stop-only guard for ONE normal UI voice attempt.
 * Start Instrumentation before opening the voice page. It never prepares,
 * starts, edits, saves, adopts, or rebinds a product attempt. The PC must wait
 * for bound=true and a real watchdog ping before clicking the normal start UI.
 * This is controlled-test coordination, not a product-wide UI start interlock.
 * No files, audio bodies, answer text, credentials or original task IDs are
 * exported. Safe terminal metadata includes only the local evidence attempt ID.
 */
public final class NormalVoiceGuardProbe extends Instrumentation {
 private static final Class<?>[] NONE=new Class<?>[0];
 private final Handler main=new Handler(Looper.getMainLooper());
 // Monitor may inspect initial PREPARED state; it must not hold up the cutoff.
 private final ScheduledExecutorService monitor=Executors.newSingleThreadScheduledExecutor();
 private final ScheduledExecutorService timer=Executors.newScheduledThreadPool(2);
 private final AtomicBoolean pinged=new AtomicBoolean(),stopRequested=new AtomicBoolean(),finished=new AtomicBoolean(),poisoned=new AtomicBoolean();
 private final AtomicLong stopCalls=new AtomicLong(),sequence=new AtomicLong();
 private final AtomicReference<String> failure=new AtomicReference<>("");
 private volatile boolean bound,everArmed,safe,unstartedSafe,endpointClosed,hostInitialized;
 private volatile long guardDeadline;
 private volatile String phase="WAITING_FOR_HOST";
 private String nonce="",binding="",requestId="",fingerprint="",abiLocation="";private long revision;
 private ClassLoader loader;private Bundle arguments;private LocalServerSocket server;
 private volatile Object runtime,attempt,draft,recording,coordinator;
 private volatile String attemptId="",token="",peer="",peerHash="",taskId="";private volatile long generation;
 private byte[] originalRequest;
 private volatile JSONObject published=new JSONObject();

 private Class<?> type(String name)throws Exception{return loader.loadClass("com.turboio.addon."+name);}
 private static void require(boolean ok,String code){if(!ok)throw new IllegalStateException(code);}
 private Object field(Object owner,String name)throws Exception{Class<?> c=owner instanceof Class?(Class<?>)owner:owner.getClass();Field f=c.getDeclaredField(name);f.setAccessible(true);return f.get(owner instanceof Class?null:owner);}
 private void set(Object owner,String name,Object value)throws Exception{Field f=owner.getClass().getDeclaredField(name);f.setAccessible(true);f.set(owner,value);}
 private Object call(Object owner,String name,Class<?>[] signature,Object...args)throws Exception{Class<?> c=owner instanceof Class?(Class<?>)owner:owner.getClass();Method m=c.getDeclaredMethod(name,signature);m.setAccessible(true);return m.invoke(owner instanceof Class?null:owner,args);}
 private void abiField(Class<?> owner,String name,Class<?> expected,boolean isStatic,boolean isFinal,boolean isVolatile)throws Exception{
  abiLocation=owner.getSimpleName()+"."+name;
  Field field=owner.getDeclaredField(name);int modifiers=field.getModifiers();require(field.getType()==expected&&Modifier.isStatic(modifiers)==isStatic&&Modifier.isFinal(modifiers)==isFinal&&Modifier.isVolatile(modifiers)==isVolatile,"NORMAL_VOICE_ABI_FIELD_MISMATCH");field.setAccessible(true);
 }
 private void abiMethod(Class<?> owner,String name,Class<?> returns,boolean isStatic,boolean maySynchronize,Class<?>...parameters)throws Exception{
  abiLocation=owner.getSimpleName()+"."+name;
  Method method=owner.getDeclaredMethod(name,parameters);int modifiers=method.getModifiers();require(method.getReturnType()==returns&&Modifier.isStatic(modifiers)==isStatic&&(maySynchronize||!Modifier.isSynchronized(modifiers)),"NORMAL_VOICE_ABI_METHOD_MISMATCH");method.setAccessible(true);
 }
 /** Resolve the complete reflected ABI before launching an Activity or opening
  * a control endpoint. ClassLoader.loadClass and member resolution do not read
  * static fields, invoke class initializers, obtain Runtime, or call SDK APIs. */
 private void verifyAbi()throws Exception{
  try{
   Class<?> runtimeType=type("VoiceAnswerRuntime"),attemptType=type("VoiceAnswerRuntime$Attempt"),resultType=type("VoiceAnswerRuntime$Result"),runtimeState=type("VoiceAnswerRuntime$Snapshot");
   Class<?> session=type("VoiceAnswerSession"),capture=type("CaptureSession"),permit=type("CaptureSession$CapturePermit"),recordingType=type("Host107Recording"),coordinatorType=type("VoiceAnswerCoordinator"),state=type("VoiceAnswerCoordinator$State");
   Class<?> engine=type("Host107VoiceTask"),decoder=type("Host107VoiceDecoder"),archive=type("VoiceAudioArchive"),cutoff=type("VoiceCaptureCutoff");
   require(resultType.isInterface(),"NORMAL_VOICE_ABI_METHOD_MISMATCH");
   abiField(runtimeType,"instance",runtimeType,true,false,false);abiField(runtimeType,"active",attemptType,false,false,true);abiField(runtimeType,"action",boolean.class,false,false,false);
   abiMethod(runtimeType,"stop",void.class,false,false,boolean.class,resultType);abiMethod(resultType,"done",void.class,false,false,runtimeState,String.class);
   abiField(attemptType,"id",String.class,false,true,false);abiField(attemptType,"draft",session,false,true,false);abiField(attemptType,"arming",AtomicBoolean.class,false,true,false);
   for(String name:new String[]{"binding","request","token","peer"})abiField(attemptType,name,String.class,false,false,true);
   abiField(attemptType,"generation",long.class,false,false,true);
   for(String name:new String[]{"abort","starting","recovery","physicallyReleased","nativeStartAttempted"})abiField(attemptType,name,boolean.class,false,false,true);
   abiField(attemptType,"recording",recordingType,false,false,true);abiField(attemptType,"coordinator",coordinatorType,false,false,true);abiField(attemptType,"cutoff",cutoff,false,false,true);
   for(String name:new String[]{"engine","releasedEngine","coordinatorEngine"})abiField(attemptType,name,engine,false,false,true);
   for(String name:new String[]{"decoder","releasedDecoder"})abiField(attemptType,name,decoder,false,false,true);abiField(attemptType,"archive",archive,false,false,true);
   abiMethod(session,"capturePermit",permit,false,false);abiMethod(session,"snapshot",Object.class,false,true);
   for(String name:new String[]{"phase","token"})abiField(permit,name,String.class,false,true,false);
   for(String name:new String[]{"needsStop","opening"})abiField(permit,name,boolean.class,false,true,false);
   abiField(recordingType,"draft",capture,false,true,false);for(String name:new String[]{"token","peer","peerHash"})abiField(recordingType,name,String.class,false,true,false);
   abiField(recordingType,"generation",long.class,false,true,false);abiField(recordingType,"closed",boolean.class,false,false,true);abiMethod(recordingType,"deadlineStop",void.class,false,false,String.class,String.class,long.class);
   abiField(coordinatorType,"draft",capture,false,true,false);abiField(coordinatorType,"archive",archive,false,true,false);for(String name:new String[]{"token","peer"})abiField(coordinatorType,name,String.class,false,true,false);abiField(coordinatorType,"generation",long.class,false,true,false);
   abiMethod(coordinatorType,"stop",void.class,false,false,boolean.class);abiMethod(coordinatorType,"snapshot",state,false,false);
   abiField(state,"draftSnapshot",Map.class,false,true,false);abiField(state,"phase",String.class,false,true,false);for(String name:new String[]{"released","answerReady"})abiField(state,name,boolean.class,false,true,false);
   for(String name:new String[]{"frames","pcmBytes"})abiField(archive,name,long.class,false,false,false);
   abiMethod(type("WireJson"),"read",Object.class,true,false,byte[].class,int.class,int.class);abiMethod(type("WireJson"),"bytes",byte[].class,true,false,Object.class);
   abiMethod(type("TurboAddon"),"initialize",void.class,true,true,Activity.class);
  }catch(Exception mismatch){throw new IllegalStateException("NORMAL_VOICE_ABI_UNSUPPORTED");}
 }
 private static String code(Throwable error){for(int i=0;i<12&&error.getCause()!=null;i++)error=error.getCause();String text=error.getMessage();return text!=null&&text.matches("NORMAL_VOICE_[A-Z_]{1,64}")?text:"NORMAL_VOICE_GUARD_FAILED";}
 private static long number(Object n){require(n instanceof Long||n instanceof Integer,"NORMAL_VOICE_STATE_INVALID");return ((Number)n).longValue();}
 private static Map<?,?> map(Object value){require(value instanceof Map,"NORMAL_VOICE_STATE_INVALID");return (Map<?,?>)value;}
 private void fail(String code){failure.compareAndSet("",code);poisoned.set(true);safe=false;if(bound)stopNow();}

 /** No main-thread wait, draft monitor, native task call, or report IO here.
  * Immutable Host107Recording owner performs its own final token/peer/epoch
  * fencing when the queued physical stop reaches the Android main looper. */
 private void stopNow(){
  if(safe&&!poisoned.get())return;
  stopRequested.set(true);stopCalls.incrementAndGet();safe=false;
  Object a=attempt,r=recording,c=coordinator;
  try{if(a!=null)set(a,"abort",true);}catch(Exception e){failure.compareAndSet("","NORMAL_VOICE_ABORT_UNCONFIRMED");poisoned.set(true);}
  if(r!=null)try{call(r,"deadlineStop",new Class<?>[]{String.class,String.class,long.class},token,peerHash,generation);}catch(Exception e){failure.compareAndSet("","NORMAL_VOICE_STOP_DISPATCH_FAILED");poisoned.set(true);}
  if(c!=null)try{call(c,"stop",new Class<?>[]{boolean.class},false);}catch(Exception e){failure.compareAndSet("","NORMAL_VOICE_COORDINATOR_STOP_FAILED");poisoned.set(true);}
  // Runtime.stop is supplementary cleanup for the original still-unbound-to-a-
  // coordinator attempt. Its target must be checked again on the main thread.
  if(a!=null&&c==null)main.post(()->{try{
   if(field(runtime,"active")!=a||field(a,"recording")!=recording||field(a,"coordinator")!=null)return;
   call(runtime,"stop",new Class<?>[]{boolean.class,type("VoiceAnswerRuntime$Result")},false,null);
  }catch(Exception e){failure.compareAndSet("","NORMAL_VOICE_STOP_CLEANUP_FAILED");}});
 }
 private void ping()throws Exception{
  require(bound&&!poisoned.get()&&!stopRequested.get(),"NORMAL_VOICE_BINDING_NOT_READY");
  if(pinged.compareAndSet(false,true)){
   guardDeadline=SystemClock.elapsedRealtime()+20000;
   timer.schedule(()->{if(!safe&&!finished.get())stopNow();},20000,TimeUnit.MILLISECONDS);
  }
 }
 private void endpoint()throws Exception{
  server=new LocalServerSocket("io-agent-normal-voice-"+nonce);
  Thread accept=new Thread(()->{while(!endpointClosed)try{
   LocalSocket socket=server.accept();socket.setSoTimeout(1000);ScheduledFuture<?> timeout=timer.schedule(()->{try{socket.close();}catch(IOException ignored){}},1500,TimeUnit.MILLISECONDS);
   boolean finishAfterReply=false;
   try{
    ByteArrayOutputStream data=new ByteArrayOutputStream();int next;InputStream in=socket.getInputStream();while((next=in.read())!=-1&&next!='\n'){require(data.size()<255,"NORMAL_VOICE_COMMAND_BUDGET");data.write(next);}require(next=='\n',"NORMAL_VOICE_COMMAND_INCOMPLETE");
    Object raw=call(type("WireJson"),"read",new Class<?>[]{byte[].class,int.class,int.class},data.toByteArray(),256,8);Map<?,?> command=map(raw);
    require(command.size()==2&&nonce.equals(command.get("probe_id"))&&command.get("op") instanceof String,"NORMAL_VOICE_COMMAND_INVALID");String op=(String)command.get("op");require(Arrays.asList("ping","status","stop","finish").contains(op),"NORMAL_VOICE_COMMAND_INVALID");
    if(op.equals("ping"))ping();
    if(op.equals("stop"))stopNow();
    if(op.equals("finish")){require(safe&&bound&&(everArmed||unstartedSafe)&&!poisoned.get(),"NORMAL_VOICE_STOP_UNCONFIRMED");finishAfterReply=true;}
    JSONObject reply=response();socket.getOutputStream().write((reply.toString()+"\n").getBytes(StandardCharsets.UTF_8));socket.getOutputStream().flush();
   }catch(Exception ignored){/* No actions or raw exception export for invalid commands. */}
   finally{timeout.cancel(false);try{socket.close();}catch(IOException ignored){}}
   if(finishAfterReply)finishConfirmed();
  }catch(Exception e){if(!endpointClosed){fail("NORMAL_VOICE_ENDPOINT_FAILED");break;}}},"iO-normal-voice-control");accept.setDaemon(true);accept.start();
 }
 private JSONObject response()throws JSONException{
  JSONObject out=new JSONObject(published.toString());out.put("schema",1).put("probe_id",nonce).put("mode","capture").put("phase",phase).put("sequence",sequence.incrementAndGet()).put("bound",bound).put("watchdog_ack",pinged.get()).put("armed",everArmed).put("stop_requested",stopRequested.get()).put("stop_command_count",stopCalls.get()).put("safe_to_disarm",safe&&!poisoned.get()).put("error",failure.get()).put("guard_deadline_set",guardDeadline>0).put("readiness_created",false).put("guard_task_or_answer_submitted",false).put("synthetic_only_claimed",false).put("capture_audio_may_include_environment",true).put("controlled_ui_only",true);
  return out;
 }
 private void initializeHost()throws Exception{
  try{
   ActivityMonitor activityMonitor=addMonitor("com.rayneo.venus.MainActivity",null,false);Activity observed;
   try{getTargetContext().startActivity(new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER).setClassName(getTargetContext(),"com.rayneo.venus.MainActivity").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));observed=waitForMonitorWithTimeout(activityMonitor,15000);}finally{removeMonitor(activityMonitor);}
   require(observed!=null&&observed.getClassLoader()==loader,"NORMAL_VOICE_HOST_UNAVAILABLE");
   final Activity activity=observed;CountDownLatch initialized=new CountDownLatch(1);AtomicReference<Throwable> invalid=new AtomicReference<>();
   main.post(()->{try{call(type("TurboAddon"),"initialize",new Class<?>[]{Activity.class},activity);hostInitialized=true;}catch(Throwable e){invalid.set(e);}finally{initialized.countDown();}});
   require(initialized.await(8,TimeUnit.SECONDS)&&invalid.get()==null&&hostInitialized,"NORMAL_VOICE_HOST_UNAVAILABLE");phase="WAITING_FOR_ORIGINAL_QUESTION";
  }catch(Throwable error){phase="BLOCKED";throw new IllegalStateException(code(error));}
 }
 private void bindPrepared()throws Exception{
  Object current=field(type("VoiceAnswerRuntime"),"instance");if(current==null)return;Object a=field(current,"active");if(a==null)return;
  if(!binding.equals(field(a,"binding"))||!requestId.equals(field(a,"request")))return;
  require(!Boolean.TRUE.equals(field(a,"starting"))&&field(a,"recording")==null&&field(a,"coordinator")==null&&!Boolean.TRUE.equals(field(a,"recovery")),"NORMAL_VOICE_ALREADY_STARTED");
  Object s=field(a,"draft"),permit=call(s,"capturePermit",NONE);require("PREPARED".equals(field(permit,"phase"))&&Boolean.FALSE.equals(field(permit,"needsStop")),"NORMAL_VOICE_DRAFT_NOT_PREPARED");
  // Only initial non-capturing preparation reads a synchronized draft snapshot.
  Map<?,?> saved=map(call(s,"snapshot",NONE)),target=map(saved.get("target")),request=map(target.get("request"));
  require("PREPARED".equals(saved.get("phase"))&&Boolean.FALSE.equals(saved.get("needs_stop"))&&binding.equals(target.get("binding"))&&fingerprint.equals(target.get("fingerprint"))&&requestId.equals(request.get("object_id"))&&number(request.get("revision"))==revision,"NORMAL_VOICE_ORIGINAL_REQUEST_MISMATCH");
  Object task=map(request.get("body")).get("task_id");require(task instanceof String&&!((String)task).isEmpty()&&"request".equals(request.get("kind")),"NORMAL_VOICE_ORIGINAL_REQUEST_MISMATCH");
  String id=String.valueOf(field(a,"id")),uuid=String.valueOf(saved.get("token"));require(id.matches("[a-f0-9]{32}")&&uuid.matches("[a-f0-9]{32}")&&uuid.equals(field(a,"token")),"NORMAL_VOICE_ATTEMPT_INVALID");
  require(field(current,"active")==a&&!Boolean.TRUE.equals(field(a,"starting"))&&field(a,"recording")==null&&field(a,"coordinator")==null,"NORMAL_VOICE_BINDING_RACED");
  originalRequest=(byte[])call(type("WireJson"),"bytes",new Class<?>[]{Object.class},request);taskId=(String)task;
  runtime=current;draft=s;attemptId=id;token=uuid;attempt=a;bound=true;phase="PREPARED";
 }
 private void observe()throws Exception{
  if(!hostInitialized||poisoned.get())return;if(!bound){bindPrepared();return;}
  Object a=attempt;require(field(runtime,"active")==a&&attemptId.equals(field(a,"id"))&&token.equals(field(a,"token"))&&binding.equals(field(a,"binding"))&&requestId.equals(field(a,"request"))&&field(a,"draft")==draft&&!Boolean.TRUE.equals(field(a,"recovery")),"NORMAL_VOICE_OWNER_CHANGED");
  if(stopRequested.get())set(a,"abort",true);
  Object owner=field(a,"recording");
  if(owner!=null&&recording==null){
   require(field(owner,"draft")==draft&&token.equals(field(owner,"token")),"NORMAL_VOICE_RECORDING_OWNER_CHANGED");
   String rawPeer=String.valueOf(field(owner,"peer")),hash=String.valueOf(field(owner,"peerHash"));long epoch=number(field(owner,"generation"));require(!rawPeer.isEmpty()&&hash.matches("[a-f0-9]{64}")&&epoch>0&&rawPeer.equals(field(a,"peer"))&&epoch==number(field(a,"generation")),"NORMAL_VOICE_RECORDING_OWNER_CHANGED");
   peer=rawPeer;peerHash=hash;generation=epoch;recording=owner;
   // A stop racing owner creation must dispatch before cached-state observation.
   if(stopRequested.get())stopNow();
  }
  require(owner==recording,"NORMAL_VOICE_RECORDING_REBOUND");
  Object c=field(a,"coordinator");if(c!=null&&coordinator==null){
   require(recording!=null&&field(c,"draft")==draft&&token.equals(field(c,"token"))&&peer.equals(field(c,"peer"))&&generation==number(field(c,"generation")),"NORMAL_VOICE_COORDINATOR_OWNER_CHANGED");coordinator=c;if(stopRequested.get())stopNow();
  }
  require(c==coordinator,"NORMAL_VOICE_COORDINATOR_REBOUND");
  if(unstartedSafe&&(owner!=null||c!=null||Boolean.TRUE.equals(field(a,"starting"))||((AtomicBoolean)field(a,"arming")).get())){unstartedSafe=false;fail("NORMAL_VOICE_RESTART_AFTER_STOP");return;}
  if(recording!=null)require(peer.equals(field(a,"peer"))&&generation==number(field(a,"generation")),"NORMAL_VOICE_GENERATION_CHANGED");
  Object permit=call(draft,"capturePermit",NONE);boolean needs=Boolean.TRUE.equals(field(permit,"needsStop"));
  if(needs){everArmed=true;if(!pinged.get()){fail("NORMAL_VOICE_STARTED_WITHOUT_GUARD");return;}}
  JSONObject state=new JSONObject().put("stop_accepted",false).put("device_idle_verified",false).put("native_start_attempted",Boolean.TRUE.equals(field(a,"nativeStartAttempted"))).put("native_stopped_verified",false).put("native_released",false).put("recording_released",false).put("coordinator_released",false).put("answer_ready",false).put("audio_frames",0).put("asr_pcm_bytes",0);
  if(c==null){
   // A PREPARED snapshot alone is never a terminal. This exception requires an
   // explicit stop and a main-looper check that the normal UI has no pending
   // prepare/start action and no owned capture resources. Controlled PC input
   // must not click start again after stop/expiry; this is not a UI interlock.
   if(stopRequested.get()&&!everArmed&&!unstartedSafe)checkUnstarted(a);
   safe=unstartedSafe&&!poisoned.get();phase=safe?"NOT_STARTED_STOPPED":stopRequested.get()?"STOPPING":"PREPARED";state.put("recording_released",safe);published=state;return;
  }
  Object snapshot=call(c,"snapshot",NONE);Map<?,?> s=map(field(snapshot,"draftSnapshot")),target=map(s.get("target")),request=map(target.get("request"));
  require(token.equals(s.get("token"))&&peerHash.equals(s.get("peer"))&&generation==number(s.get("generation"))&&binding.equals(target.get("binding"))&&fingerprint.equals(target.get("fingerprint"))&&requestId.equals(request.get("object_id"))&&revision==number(request.get("revision")),"NORMAL_VOICE_PUBLISHED_OWNER_CHANGED");
  require(taskId.equals(map(request.get("body")).get("task_id"))&&Arrays.equals(originalRequest,(byte[])call(type("WireJson"),"bytes",new Class<?>[]{Object.class},request)),"NORMAL_VOICE_ORIGINAL_REQUEST_MISMATCH");
  // Presence of this exact armed coordinator also establishes everArmed even
  // if a short capture finished between monitor samples.
  everArmed=true;if(!pinged.get()){fail("NORMAL_VOICE_STARTED_WITHOUT_GUARD");return;}
  String currentPhase=String.valueOf(field(snapshot,"phase"));require(currentPhase.matches("[A-Z_]{1,32}"),"NORMAL_VOICE_STATE_INVALID");phase=currentPhase;
  boolean stop=number(s.get("stop_at"))>0&&number(s.get("stop_sent"))>=number(s.get("stop_at"));boolean idle=Boolean.TRUE.equals(s.get("device_stopped")),nativeStopped=Boolean.TRUE.equals(s.get("engine_end"))&&Boolean.TRUE.equals(s.get("engine_stopped"));
  Object engine=field(a,"engine"),decoder=field(a,"decoder");boolean nativeReleased=engine!=null&&field(a,"coordinatorEngine")==engine&&field(a,"releasedEngine")==engine&&decoder!=null&&field(a,"releasedDecoder")==decoder;
  boolean released=Boolean.TRUE.equals(field(snapshot,"released")),recordingReleased=Boolean.TRUE.equals(field(a,"physicallyReleased"))&&recording!=null&&Boolean.TRUE.equals(field(recording,"closed"));
  boolean terminal=Arrays.asList("REVIEW","INCOMPLETE","CANCELLED").contains(currentPhase)&&Boolean.FALSE.equals(s.get("needs_stop"));
  safe=stop&&idle&&nativeStopped&&nativeReleased&&released&&recordingReleased&&terminal&&!poisoned.get();
  state.put("stop_accepted",stop).put("device_idle_verified",idle).put("native_stopped_verified",nativeStopped).put("native_released",nativeReleased).put("recording_released",recordingReleased).put("coordinator_released",released).put("answer_ready",Boolean.TRUE.equals(field(snapshot,"answerReady")));
  // Counters are observational only, never stop/completeness evidence. No bytes
  // or text are read. The coordinator's volatile published state fences release.
  Object archive=field(a,"archive");if(archive!=null&&field(c,"archive")==archive){long frames=number(field(archive,"frames")),pcm=number(field(archive,"pcmBytes"));if(frames>=0&&frames<=8192&&pcm>=0&&pcm<=2097152)state.put("audio_frames",frames).put("asr_pcm_bytes",pcm);}
  if(safe){state.put("evidence_id",attemptId).put("original_request_matches",true).put("original_task_matches",true).put("original_revision_matches",true).put("original_fingerprint_matches",true).put("original_route_matches",true);transcriptMetadata(s,state);}
  published=state;
 }
 private void transcriptMetadata(Map<?,?> snapshot,JSONObject state)throws Exception{
  Object raw=snapshot.get("segments");require(raw instanceof List,"NORMAL_VOICE_TRANSCRIPT_INVALID");List<?> segments=(List<?>)raw;require(segments.size()<=64,"NORMAL_VOICE_TRANSCRIPT_INVALID");StringJoiner joined=new StringJoiner("\n");boolean finals=!segments.isEmpty();int index=0;
  for(Object value:segments){Map<?,?> segment=map(value);Object text=segment.get("text");require(text instanceof String&&((String)text).length()<=65536&&number(segment.get("index"))==++index,"NORMAL_VOICE_TRANSCRIPT_INVALID");finals&=Boolean.TRUE.equals(segment.get("final"));joined.add((String)text);}
  state.put("transcript_all_segments_final",finals).put("transcript_segment_count",segments.size());if(!finals)return;
  String text=joined.toString();require(text.length()<=65536,"NORMAL_VOICE_TRANSCRIPT_INVALID");Object frozen=snapshot.get("frozen_text");boolean frozenPresent=frozen!=null;
  state.put("published_frozen_text_present",frozenPresent);if(frozenPresent){require(frozen instanceof String&&text.equals(frozen),"NORMAL_VOICE_FROZEN_TEXT_MISMATCH");state.put("published_frozen_text_matches",true);}
  // Coordinator publication is capture evidence; it does not follow later
  // Runtime edits/submission. Never claim this observes the SAVED outbox.
  state.put("submission_verified_by_guard",false).put("transcript_sha256",hex(MessageDigest.getInstance("SHA-256").digest(text.getBytes(StandardCharsets.UTF_8)))).put("transcript_codepoints",text.codePointCount(0,text.length())).put("expected_preview_retained",text.contains("预览")).put("expected_no_file_change_retained",text.contains("不要修改文件")).put("expected_keep_materials_retained",text.contains("保留全部资料")).put("expected_friday_retained",text.contains("星期五")||text.contains("周五"));
 }
 private static String hex(byte[] value){StringBuilder text=new StringBuilder();for(byte b:value)text.append(String.format(Locale.ROOT,"%02x",b&255));return text.toString();}
 private void checkUnstarted(Object a){
  main.post(()->{try{
   if(!bound||everArmed||poisoned.get()||!stopRequested.get()||attempt!=a||field(runtime,"active")!=a)return;
   if(!Boolean.TRUE.equals(field(a,"abort"))||Boolean.TRUE.equals(field(a,"starting"))||Boolean.TRUE.equals(field(runtime,"action"))||((AtomicBoolean)field(a,"arming")).get()||Boolean.TRUE.equals(field(a,"nativeStartAttempted"))||!Boolean.TRUE.equals(field(a,"physicallyReleased")))return;
   for(String name:new String[]{"recording","coordinator","engine","decoder","archive","cutoff"})if(field(a,name)!=null)return;
   if(recording!=null||coordinator!=null)return;
   Object permit=call(draft,"capturePermit",NONE);if(!"PREPARED".equals(field(permit,"phase"))||!token.equals(field(permit,"token"))||!Boolean.FALSE.equals(field(permit,"needsStop"))||!Boolean.FALSE.equals(field(permit,"opening")))return;
   unstartedSafe=true;
  }catch(Exception e){fail("NORMAL_VOICE_UNSTARTED_UNCONFIRMED");}});
 }
 private void finishConfirmed(){
  if(!safe||poisoned.get()||!finished.compareAndSet(false,true))return;endpointClosed=true;
  try{server.close();}catch(IOException ignored){}monitor.shutdownNow();timer.shutdown();
  Bundle result=new Bundle();result.putString("probe_id",nonce);result.putBoolean("safe_to_disarm",true);result.putBoolean("guard_started_microphone",false);result.putBoolean("guard_submitted_answer",false);result.putBoolean("readiness_created",false);result.putBoolean("original_attempt_only",true);result.putString("error",failure.get());finish(Activity.RESULT_OK,result);
 }
 @Override public void onCreate(Bundle args){super.onCreate(args);arguments=args==null?new Bundle():args;start();}
 @Override public void onStart(){
  try{
   loader=getTargetContext().getClassLoader();nonce=arguments.getString("probe_id","");binding=arguments.getString("binding","");requestId=arguments.getString("request_id","");fingerprint=arguments.getString("request_fingerprint","");String requestedRevision=arguments.getString("request_revision","");
   boolean abiOnly="true".equals(arguments.getString("abi_only","false"));
   require(nonce.matches("[a-f0-9]{32}")&&(abiOnly||binding.matches("[a-f0-9]{64}")&&fingerprint.matches("[a-f0-9]{64}")&&requestId.matches("[A-Za-z0-9._:-]{1,160}")&&requestedRevision.matches("[1-9][0-9]{0,17}")),"NORMAL_VOICE_ARGUMENT_INVALID");revision=abiOnly?1:Long.parseLong(requestedRevision);
   android.content.pm.PackageInfo info=getTargetContext().getPackageManager().getPackageInfo(getTargetContext().getPackageName(),0);require("com.rayneo.venus.pub".equals(getTargetContext().getPackageName())&&info.getLongVersionCode()==10427&&"0.5.3-dev5".equals(info.versionName),"NORMAL_VOICE_CANDIDATE_MISMATCH");
   verifyAbi();
   if(abiOnly){monitor.shutdownNow();timer.shutdownNow();Bundle report=new Bundle();report.putString("probe_id",nonce);report.putBoolean("abi_verified",true);report.putBoolean("sdk_methods_called",false);report.putBoolean("microphone_started",false);report.putBoolean("task_or_answer_submitted",false);report.putBoolean("control_endpoint_opened",false);finish(Activity.RESULT_OK,report);return;}
   endpoint();initializeHost();
   monitor.scheduleWithFixedDelay(()->{try{observe();}catch(Throwable error){fail(code(error));phase="NEEDS_PHYSICAL_STOP";}},0,100,TimeUnit.MILLISECONDS);
   // Repeat stop dispatch independently from the monitor/model/playback. Never
   // terminate an unknown microphone obligation because the observer is stuck.
   timer.scheduleWithFixedDelay(()->{if(stopRequested.get()&&!safe&&!finished.get())stopNow();},250,250,TimeUnit.MILLISECONDS);
  }catch(Throwable error){fail(code(error));phase="BLOCKED";
   // Before any binding the guard has touched no recording owner. Report setup
   // failure without claiming that the device itself was independently idle.
   if(!bound){endpointClosed=true;try{if(server!=null)server.close();}catch(IOException ignored){}monitor.shutdownNow();timer.shutdownNow();Bundle result=new Bundle();result.putString("probe_id",nonce.matches("[a-f0-9]{32}")?nonce:"");result.putString("error",failure.get());if(abiLocation.matches("[A-Za-z0-9$_.]{1,160}"))result.putString("abi_location",abiLocation);result.putBoolean("safe_to_disarm",false);result.putBoolean("guard_started_microphone",false);finish(Activity.RESULT_CANCELED,result);}
  }
 }
}
