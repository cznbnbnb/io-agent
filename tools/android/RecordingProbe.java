package com.turboio.androidtests;

import android.app.*;
import android.content.*;
import android.net.LocalServerSocket;
import android.net.LocalSocket;
import android.os.*;
import java.io.*;
import java.lang.reflect.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.security.MessageDigest;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.*;
import java.util.function.LongSupplier;
import org.json.*;

/** Explicit bounded hardware diagnostic, never a normal voice entry point.
 * All capture/SDK objects come from the installed product ClassLoader: no
 * relocated recording owner, queue bypass or task submission. Readiness enrollment
 * requires its explicit preflight-only argument and a verified historical capture.
 * Physical audio may include surroundings even when the playback file is synthetic.
 */
public final class RecordingProbe extends Instrumentation {
 private static final String EXPECTED_SOURCE="7865da6dd988971da7e8da486b74d4bcd5311f3eb495f3aa21873dc6af78e31d";
 private static final Class<?>[] NONE=new Class<?>[0];
 private final Handler main=new Handler(Looper.getMainLooper());
 private final ScheduledExecutorService guard=Executors.newScheduledThreadPool(2);
 private final ExecutorService reports=Executors.newSingleThreadExecutor();
 private final AtomicBoolean aborted=new AtomicBoolean(),watchdogAck=new AtomicBoolean(),ready=new AtomicBoolean(),finished=new AtomicBoolean(),reportPending=new AtomicBoolean();
 private final AtomicBoolean stopAccepted=new AtomicBoolean(),deviceIdle=new AtomicBoolean(),nativeStarted=new AtomicBoolean(),nativeStopped=new AtomicBoolean(),nativeReleased=new AtomicBoolean(),decoderReleased=new AtomicBoolean(),recordingReleased=new AtomicBoolean();
 private final AtomicLong frames=new AtomicLong(),audioFrames=new AtomicLong(),acks=new AtomicLong(),decodedBytes=new AtomicLong(),pcmBytes=new AtomicLong(),peak=new AtomicLong(),stopCommands=new AtomicLong(),stateSequence=new AtomicLong();
 private final AtomicReference<String> error=new AtomicReference<>("");
 private final Set<String> coordinatorNotes=new ConcurrentSkipListSet<>();
 private volatile String coordinatorNote="";
 private final CountDownLatch preflight=new CountDownLatch(1),ping=new CountDownLatch(1),stoppedCommand=new CountDownLatch(1),unstartedStop=new CountDownLatch(1);
 private final ConcurrentLinkedQueue<Pending> pending=new ConcurrentLinkedQueue<>();
 private volatile String phase="CREATED",mode="preflight",nonce="",token="",peer="",peerHash="",enrollAttempt="";
 private volatile boolean readinessWritten,readinessEnrolled,enrollmentEvidenceUnchanged;
 private volatile long generation,controlExpiry,preflightAt;private volatile boolean armedEver,coordinatorReleased,answerReady,preflightPassed,preparedReleased,unarmedResourcesReleased;
 private volatile boolean expectedPreview,expectedNoChange,expectedKeep,expectedFriday;
 private volatile Object recording,cutoff,draft,voice,decoder,archive,coordinator,coordinatorListener;
 private Object journal;private ClassLoader loader;private File external,isolated;
 private Bundle arguments;private LocalServerSocket server;private volatile boolean endpointClosed;
 private volatile JSONObject publicState=new JSONObject();
 private interface Work {Object run()throws Exception;}
 private interface HandlerCall {Object run(String name,Object[] values)throws Exception;}
 private static final class Pending {final String method;final Class<?>[] signature;final Object[] values;Pending(String m,Class<?>[] s,Object[] v){method=m;signature=s;values=v;}}

 private Class<?> type(String name)throws Exception{return loader.loadClass("com.turboio.addon."+name);}
 private static void check(boolean ok,String code){if(!ok)throw new IllegalStateException(code);}
 private static String code(Throwable e){while(e.getCause()!=null)e=e.getCause();String s=e.getMessage();return s!=null&&s.matches("[A-Z][A-Z0-9_]{2,70}")?s:"RECORDING_PROBE_FAILED";}
 private Object field(Object owner,String name)throws Exception{Class<?> c=owner instanceof Class?(Class<?>)owner:owner.getClass();Field f=c.getDeclaredField(name);f.setAccessible(true);return f.get(owner instanceof Class?null:owner);}
 private Object call(Object owner,String name,Class<?>[] sig,Object...args)throws Exception{Class<?> c=owner instanceof Class?(Class<?>)owner:owner.getClass();Method m=c.getDeclaredMethod(name,sig);m.setAccessible(true);return m.invoke(owner instanceof Class?null:owner,args);}
 private Object make(String name,Class<?>[] sig,Object...args)throws Exception{Constructor<?> c=type(name).getDeclaredConstructor(sig);c.setAccessible(true);return c.newInstance(args);}
 private Object proxy(String name,HandlerCall body)throws Exception{Class<?> c=type(name);return Proxy.newProxyInstance(c.getClassLoader(),new Class<?>[]{c},(p,m,a)->{
  if(m.getDeclaringClass()==Object.class){if(m.getName().equals("hashCode"))return System.identityHashCode(p);if(m.getName().equals("equals"))return p==a[0];return "owned-recording-probe";}
  return body.run(m.getName(),a==null?new Object[0]:a);
 });}
 private Object onMain(Work work)throws Exception{
  if(Looper.myLooper()==Looper.getMainLooper())return work.run();
  AtomicBoolean pending=new AtomicBoolean(true);CountDownLatch done=new CountDownLatch(1);AtomicReference<Object> value=new AtomicReference<>();AtomicReference<Throwable> failed=new AtomicReference<>();
  check(main.post(()->{try{if(pending.compareAndSet(true,false))value.set(work.run());}catch(Throwable e){failed.set(e);}finally{done.countDown();}}),"PROBE_MAIN_UNAVAILABLE");
  boolean completed=done.await(8,TimeUnit.SECONDS);pending.set(false);check(completed,"PROBE_MAIN_TIMEOUT");if(failed.get()!=null)throw new Exception(failed.get());return value.get();
 }
 private void postMain(Work work){if(!main.post(()->{try{work.run();}catch(Exception e){fault(code(e));}}))fault("PROBE_MAIN_UNAVAILABLE");}
 private void fault(String reason){error.compareAndSet("",reason);requestStop();refresh();}
 private void requestStop(){
  aborted.set(true);stopCommands.incrementAndGet();stoppedCommand.countDown();
  Object owner=recording;
  // No journal, ASR, socket, observer or report I/O precedes this dispatch.
  if(owner!=null)try{call(owner,"deadlineStop",new Class<?>[]{String.class,String.class,long.class},token,peerHash,generation);}catch(Exception e){error.compareAndSet("",code(e));}
  Object c=coordinator;if(c!=null)try{call(c,"stop",new Class<?>[]{boolean.class},false);}catch(Exception e){error.compareAndSet("",code(e));}
 }
 private void route(String method,Class<?>[] signature,Object...values)throws Exception{
  Object c=coordinator;if(c!=null){call(c,method,signature,values);return;}
  if(pending.size()>=32){fault("PROBE_CALLBACK_BACKPRESSURE");return;}pending.add(new Pending(method,signature,values));
 }
 private void drain()throws Exception{Pending p;while((p=pending.poll())!=null)call(coordinator,p.method,p.signature,p.values);}

 /** Strict line protocol; only a nonce-bound live endpoint handshake acknowledges
  * the watchdog. A control-file boolean alone never admits capture. */
 private void openEndpoint()throws Exception{
  server=new LocalServerSocket("io-agent-recording-"+nonce);
  Thread accept=new Thread(()->{
   while(!endpointClosed)try{
    LocalSocket socket=server.accept();socket.setSoTimeout(1500);
    ScheduledFuture<?> close=guard.schedule(()->{try{socket.close();}catch(IOException ignored){}},2,TimeUnit.SECONDS);
    try{
     ByteArrayOutputStream bytes=new ByteArrayOutputStream();InputStream in=socket.getInputStream();int b;
     while((b=in.read())!=-1&&b!='\n'){check(bytes.size()<255,"PROBE_COMMAND_BUDGET");bytes.write(b);}
     check(b=='\n',"PROBE_COMMAND_INCOMPLETE");JSONObject command=new JSONObject(new String(bytes.toByteArray(),StandardCharsets.UTF_8));
     check(command.length()==2&&nonce.equals(command.optString("probe_id")),"PROBE_COMMAND_OWNER_INVALID");String op=command.optString("op","");
     check(Arrays.asList("ping","status","stop").contains(op),"PROBE_COMMAND_INVALID");
     if(op.equals("ping")){watchdogAck.set(true);ping.countDown();}
     if(op.equals("stop"))requestStop();
     refresh();byte[] response=(publicState.toString()+"\n").getBytes(StandardCharsets.UTF_8);check(response.length<=4096,"PROBE_REPLY_BUDGET");socket.getOutputStream().write(response);socket.getOutputStream().flush();
    }catch(Exception ignored){/* Invalid/oversized commands receive no privileged action. */}
    finally{close.cancel(false);try{socket.close();}catch(IOException ignored){}}
   }catch(Exception e){if(!endpointClosed){error.compareAndSet("","PROBE_ENDPOINT_FAILED");requestStop();break;}}
  },"iO-probe-independent-control");accept.setDaemon(true);accept.start();phase="ENDPOINT_READY";refresh();
 }
 private static byte[] read(File file,int limit)throws Exception{
  check(file.isFile()&&!Files.isSymbolicLink(file.toPath())&&file.length()<=limit,"PROBE_FILE_INVALID");
  try(InputStream in=new FileInputStream(file);ByteArrayOutputStream out=new ByteArrayOutputStream()){byte[] block=new byte[4096];int n;while((n=in.read(block))!=-1){check(out.size()+n<=limit,"PROBE_FILE_BUDGET");out.write(block,0,n);}return out.toByteArray();}
 }
 private static String sha(byte[] bytes)throws Exception{StringBuilder s=new StringBuilder();for(byte b:MessageDigest.getInstance("SHA-256").digest(bytes))s.append(String.format(Locale.ROOT,"%02x",b&255));return s.toString();}
 private void verifyControl(boolean beforeArm)throws Exception{
  JSONObject control=new JSONObject(new String(read(new File(external,"io-agent-recording-probe-control.json"),4096),StandardCharsets.UTF_8));
  check(nonce.equals(control.optString("probe_id"))&&control.optBoolean("source_placement_confirmed",false)&&control.opt("guard_armed") instanceof Boolean,"PROBE_GUARD_OR_PLACEMENT_REQUIRED");
  // Source/placement can be checked before the endpoint exists. Only a real
  // independent-child handshake may set guard_armed, checked again before arm.
  if(beforeArm)check(control.optBoolean("guard_armed",false),"PROBE_WATCHDOG_HANDSHAKE_REQUIRED");
  long remaining=control.optLong("expires_at",0)-System.currentTimeMillis();check(remaining>=35000&&remaining<=120000,"PROBE_GUARD_EXPIRED");controlExpiry=control.getLong("expires_at");
  check(EXPECTED_SOURCE.equals(control.optString("source_pcm_sha256")),"PROBE_SOURCE_MISMATCH");
  byte[] pcm=read(new File(external,"official-asr-synthetic.pcm"),480000);check(pcm.length>=96000&&pcm.length%2==0&&EXPECTED_SOURCE.equals(sha(pcm)),"PROBE_SOURCE_MISMATCH");
  long nonzero=0;for(int i=0;i<pcm.length;i+=2)if(pcm[i]!=0||pcm[i+1]!=0)nonzero++;check(nonzero>16000,"PROBE_SOURCE_SILENT");
  if(beforeArm)check(watchdogAck.get()&&!aborted.get(),"PROBE_WATCHDOG_HANDSHAKE_REQUIRED");
 }
 private void verifyCandidate()throws Exception{
  check("0.5.3-dev1".equals(field(type("ProductInfo"),"VERSION")),"PROBE_CANDIDATE_UNSUPPORTED");
  check(getTargetContext().getPackageManager().getPackageInfo(getTargetContext().getPackageName(),0).getLongVersionCode()==10423,"PROBE_CANDIDATE_UNSUPPORTED");
  type("Host107Recording").getDeclaredMethod("acquireRecovery",type("CaptureSession"),type("VoiceCaptureCutoff"),type("Host107Recording$Receiver"));
  type("VoiceAnswerSession").getDeclaredMethod("capturePermit");type("VoiceCaptureCutoff").getDeclaredMethod("adoptRecovery",type("CaptureSession"));
  type("VoiceAnswerCoordinator");type("VoiceProcessProof");
 }
 private void quiescent()throws Exception{
  check(Boolean.TRUE.equals(call(type("Host107Login"),"loggedIn",NONE)),"PROBE_LOGIN_REQUIRED");
  check(Boolean.FALSE.equals(call(type("FirmwareQueue"),"busy",NONE)),"PROBE_OTA_BUSY");
  Object head=field(type("HeadGestureRuntime"),"instance");check(head!=null,"PROBE_HEAD_RUNTIME_UNAVAILABLE");Object headSession=field(head,"session");
  check(Boolean.TRUE.equals(call(headSession,"healthy",NONE)),"PROBE_HEAD_STORE_UNHEALTHY");
  if(!Boolean.TRUE.equals(call(type("HeadGestureRuntime"),"voiceHandoffReady",NONE))){
   String headPhase=String.valueOf(call(headSession,"phase",NONE));
   throw new IllegalStateException(headPhase.matches("[A-Z_]{1,40}")?"PROBE_HEAD_"+headPhase:"PROBE_HEAD_GESTURE_BUSY");
  }
  Object cards=field(type("AgentCardRuntime"),"instance");check(cards!=null,"PROBE_CARD_RUNTIME_UNAVAILABLE");
  for(String name:new String[]{"fetching","checkingShow","answerBusy","pumping","localLease"})check(Boolean.FALSE.equals(field(cards,name)),"PROBE_CARD_BUSY");
  check(field(cards,"preflight")==null&&((AtomicInteger)field(cards,"queued")).get()==0,"PROBE_CARD_BUSY");
  Object session=field(cards,"session");check(Boolean.TRUE.equals(call(session,"healthy",NONE)),"PROBE_CARD_STORE_UNHEALTHY");
  for(String name:new String[]{"pending","working"})check(Boolean.FALSE.equals(call(session,name,NONE)),"PROBE_CARD_BUSY");
  check(Boolean.FALSE.equals(call(session,"cardMayExist",NONE))||call(session,"closure",NONE)!=null,"PROBE_CARD_BUSY");
  // Match the normal handoff policy: a healthy retired input closure admits
  // only fresh version/idle inspection. It does not prove physical mirror exit,
  // clear cardMayExist, or bypass the recording owner's fresh preflight lease.
 }
 private void awaitHost()throws Exception{
  ActivityMonitor monitor=addMonitor("com.rayneo.venus.MainActivity",null,false);Activity observed;phase="WAITING_FOR_HOST";refresh();
  try{getTargetContext().startActivity(new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER).setClassName(getTargetContext(),"com.rayneo.venus.MainActivity").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));observed=waitForMonitorWithTimeout(monitor,8000);}finally{removeMonitor(monitor);}
  check(observed!=null&&observed.getClassLoader()==loader,"PROBE_MAIN_ACTIVITY_UNAVAILABLE");final Activity host=observed;
  // Instrumentation replaces the launch lifecycle. Initialize the exact normal
  // extension on the observed real host, never fabricate a guard or alter it.
  onMain(()->call(type("TurboAddon"),"initialize",new Class<?>[]{Activity.class},host));
  phase="WAITING_FOR_HOST";refresh();long until=SystemClock.elapsedRealtime()+15000;String last="PROBE_HOST_UNAVAILABLE";
  do{try{onMain(()->{quiescent();check(Boolean.FALSE.equals(call(type("NativeTransfer"),"busy",NONE)),"PROBE_DEVICE_LANE_BUSY");Object link=call(type("Host107Ota"),"link",NONE);peer=(String)field(link,"peer");generation=((Number)field(link,"generation")).longValue();check(peer!=null&&!peer.isEmpty()&&generation>0,"PROBE_LINK_UNAVAILABLE");peerHash=(String)call(type("FixedPeerHash"),"of",new Class<?>[]{String.class},peer);return null;});return;}catch(Exception e){last=code(e);}Thread.sleep(200);}while(SystemClock.elapsedRealtime()<until&&!aborted.get());throw new IllegalStateException(last);
 }
 private static Map<String,Object> map(Object...pairs){Map<String,Object> out=new LinkedHashMap<>();for(int i=0;i<pairs.length;i+=2)out.put((String)pairs[i],pairs[i+1]);return out;}
 private byte[] wire(Object value)throws Exception{return (byte[])call(type("WireJson"),"bytes",new Class<?>[]{Object.class},value);}
 private Map<String,Object> item(String kind,Map<String,Object> body,long seq,long wall){return map("schema_version","1.0","kind",kind,"object_id",body.get(kind+"_id"),"revision",1L,"commit_seq",seq,"stored_at",Instant.ofEpochMilli(wall).toString(),"event_id","probe-event-"+seq,"expires_at",Instant.ofEpochMilli(wall+3600000).toString(),"state",body.get("state"),"body",body);}
 private void prepareLocal()throws Exception{
  File base=new File(getTargetContext().getFilesDir(),"voice-probes");check(!Files.isSymbolicLink(base.toPath()),"PROBE_PATH_INVALID");check(base.isDirectory()||base.mkdir(),"PROBE_PATH_INVALID");
  isolated=new File(base,nonce);check(!isolated.exists()&&isolated.mkdir(),"PROBE_ATTEMPT_ALREADY_EXISTS");
  long wall=System.currentTimeMillis();Map<String,Object> settings=map("format","turboio-task-connection/1","base_url","https://synthetic.invalid/io-api/v1","owner_id","synthetic-owner","producer_id","synthetic-phone","server_id","synthetic-server","token","AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA","token_id","c0ffee00-0000-4000-8000-000000000001","expires_at",Instant.ofEpochMilli(wall+3600000).toString(),"computer_id","synthetic-computer","agent_id","recording-probe","project_id","synthetic-project","session_id","probe-"+nonce);
  Object connection=call(type("TaskConnection"),"parse",new Class<?>[]{byte[].class,long.class},wire(settings),wall);
  Object route=call(connection,"route",NONE);
  Map<String,Object> task=item("task",map("task_id","probe-task","revision",1L,"route",route,"state","waiting_answer","command","只做本地采音诊断","allow_create_session",false),1,wall);
  Map<String,Object> question=item("request",map("request_id","probe-question","revision",1L,"task_id","probe-task","route",route,"state","pending","mode","free_text","question","保留全部测试条件","options",new ArrayList<>()),2,wall);
  journal=make("VoiceAnswerJournal",new Class<?>[]{File.class,String.class},isolated,nonce);
  draft=make("VoiceAnswerSession",new Class<?>[]{type("VoiceAnswerSession$Store")},journal);
  check(Boolean.TRUE.equals(call(draft,"prepare",new Class<?>[]{type("TaskConnection"),Map.class,Map.class,long.class},connection,question,task,wall)),"PROBE_DRAFT_PREPARE_FAILED");
  token=(String)call(draft,"token",NONE);
  Object sink=proxy("VoiceCaptureCutoff$Stop",(name,args)->{check(name.equals("request")&&token.equals(args[0])&&peerHash.equals(args[1])&&generation==((Number)args[2]).longValue(),"PROBE_CUTOFF_OWNER_INVALID");requestStop();return null;});
  cutoff=make("VoiceCaptureCutoff",new Class<?>[]{LongSupplier.class,type("VoiceCaptureCutoff$Stop")},(LongSupplier)SystemClock::elapsedRealtime,sink);
 }
 private Object receiver()throws Exception{return proxy("Host107Recording$Receiver",(name,args)->{
  switch(name){
   case "ready":if(Boolean.TRUE.equals(args[0]))preflightAt=((Number)args[1]).longValue();ready.set(Boolean.TRUE.equals(args[0]));preflight.countDown();break;
   case "frame":
    check(peer.equals(args[0])&&generation==((Number)args[1]).longValue(),"PROBE_RECEIVER_OWNER_CHANGED");frames.incrementAndGet();
    Object envelope=call(type("OtaFrame"),"decode",new Class<?>[]{byte[].class},args[2]);
    if(((Number)field(envelope,"type")).intValue()==3){
     Object body=field(envelope,"json");check(body instanceof Map,"PROBE_AUDIO_ENVELOPE_INVALID");Map<?,?> json=(Map<?,?>)body;Object offset=json.get("offset");byte[] data=(byte[])field(envelope,"binary");
     check(token.equals(json.get("uuid"))&&offset instanceof Long&&((Long)offset)>=0&&data.length>0&&((Long)offset)<=384000-data.length,"PROBE_AUDIO_ENVELOPE_INVALID");
     audioFrames.incrementAndGet();phase="CAPTURING";
    }
    route("frame",new Class<?>[]{String.class,long.class,byte[].class},args[0],args[1],args[2]);break;
   case "sent":if(((Number)args[0]).intValue()==4&&Boolean.TRUE.equals(args[1]))stopAccepted.set(true);route("sent",new Class<?>[]{int.class,boolean.class,long.class},args);break;
   case "idle":if(Boolean.TRUE.equals(args[0]))deviceIdle.set(true);route("idle",new Class<?>[]{boolean.class,long.class},args);break;
   case "noStart":unstartedStop.countDown();if(armedEver)route("noStart",new Class<?>[]{long.class},args);break;
   case "fault":error.compareAndSet("",String.valueOf(args[0]));if(armedEver)route("fault",new Class<?>[]{String.class},args);else preflight.countDown();break;
   default:throw new IllegalStateException("PROBE_RECEIVER_INVALID");
  }refresh();return null;
 });}
 private void inspect()throws Exception{
  Object receiver=receiver();onMain(()->{quiescent();recording=call(type("Host107Recording"),"acquire",new Class<?>[]{type("CaptureSession"),type("VoiceCaptureCutoff"),type("Host107Recording$Receiver")},draft,cutoff,receiver);check(recording!=null,"PROBE_RECORDING_BUSY");sameLink();call(recording,"inspect",NONE);return null;});
  phase="PREFLIGHT_QUERY";refresh();check(preflight.await(9,TimeUnit.SECONDS)&&ready.get()&&error.get().isEmpty(),"PROBE_PREFLIGHT_FAILED");preflightPassed=true;phase="PREFLIGHT_READY";refresh();
 }
 private void sameLink()throws Exception{Object link=call(type("Host107Ota"),"link",NONE);check(peer.equals(field(link,"peer"))&&generation==((Number)field(link,"generation")).longValue(),"PROBE_LINK_CHANGED");}
 private Object asrListener()throws Exception{return proxy("Host107VoiceTask$Listener",(name,args)->{
  Object target=coordinatorListener;if(target==null){if(nativeStarted.get())fault("PROBE_ASR_LISTENER_UNAVAILABLE");return null;}
  try{switch(name){case "result":call(target,name,new Class<?>[]{String.class,boolean.class},args);break;case "started":case "engineAudio":call(target,name,new Class<?>[]{boolean.class},args);break;case "error":call(target,name,new Class<?>[]{String.class},args);break;default:throw new IllegalStateException("PROBE_ASR_CALLBACK_INVALID");}}
  catch(Exception e){fault(code(e));}return null;
 });}
 private void processProof()throws Exception{
  Object stamp=call(type("VoiceProcessProof"),"parseStat",new Class<?>[]{byte[].class},readProc());int pid=((Number)field(stamp,"pid")).intValue();long ticks=((Number)field(stamp,"startTicks")).longValue();check(pid==android.os.Process.myPid(),"PROBE_PROCESS_OWNER_INVALID");
  byte[] bytes=(byte[])call(type("VoiceProcessProof"),"record",new Class<?>[]{String.class,String.class,int.class,long.class},nonce,token,pid,ticks);
  File destination=new File(isolated,"process.json");try(FileOutputStream out=new FileOutputStream(destination)){out.write(bytes);out.getFD().sync();}check(Arrays.equals(bytes,read(destination,8192)),"PROBE_PROCESS_RECORD_FAILED");
 }
 private static byte[] readProc()throws Exception{try(InputStream in=new FileInputStream("/proc/self/stat");ByteArrayOutputStream out=new ByteArrayOutputStream()){byte[] b=new byte[1024];int n;while((n=in.read(b))!=-1){check(out.size()+n<=8192,"PROBE_PROCESS_STAT_BUDGET");out.write(b,0,n);}return out.toByteArray();}}
 private Object enginePort()throws Exception{return proxy("VoiceAnswerCoordinator$Engine",(name,args)->{
  switch(name){
   case "start":return onMain(()->{check(!aborted.get()&&watchdogAck.get()&&System.currentTimeMillis()<controlExpiry,"PROBE_START_REVOKED");quiescent();sameLink();Object permit=call(draft,"capturePermit",NONE);check(Boolean.TRUE.equals(field(permit,"opening")),"PROBE_START_REVOKED");nativeStarted.set(true);return call(voice,"start",new Class<?>[]{String.class},token);});
   case "working":return "WORKING".equals(call(voice,"state",NONE));
   case "pcm":byte[] pcm=(byte[])args[0];call(voice,"pcm",new Class<?>[]{String.class,byte[].class},token,pcm);pcmBytes.addAndGet(pcm.length);return null;
   case "sealInput":return call(voice,"sealInput",new Class<?>[]{String.class},token);
   case "stop":return call(voice,"stop",new Class<?>[]{String.class},token);
   case "stopped":boolean stopped=Boolean.TRUE.equals(call(voice,"engineStopped",NONE));if(stopped)nativeStopped.set(true);return stopped;
   case "release":if(!nativeReleased.get()){call(voice,"release",new Class<?>[]{String.class},token);nativeReleased.set(true);}if(!decoderReleased.get()){call(decoder,"close",NONE);decoderReleased.set(true);}return null;
   default:throw new IllegalStateException("PROBE_ENGINE_PORT_INVALID");
  }
 });}
 private Object devicePort()throws Exception{return proxy("VoiceAnswerCoordinator$Device",(name,args)->{
  switch(name){
   case "begin":postMain(()->{check(!aborted.get(),"PROBE_START_REVOKED");quiescent();sameLink();call(recording,"begin",NONE);phase="AWAITING_AUDIO";refresh();return null;});return null;
   case "stop":call(recording,"deadlineStop",new Class<?>[]{String.class,String.class,long.class},token,peerHash,generation);return null;
   case "acknowledge":acks.incrementAndGet();postMain(()->call(recording,"acknowledge",new Class<?>[]{int.class},args));return null;
   case "inspectIdle":postMain(()->call(recording,"inspectIdle",NONE));return null;
   case "release":if(recordingReleased.get())return true;return onMain(()->{boolean released=Boolean.TRUE.equals(call(recording,"release",NONE));if(released)recordingReleased.set(true);return released;});
   default:throw new IllegalStateException("PROBE_DEVICE_PORT_INVALID");
  }
 });}
 private void capture()throws Exception{
  verifyControl(true);check(!aborted.get(),"PROBE_START_REVOKED");Object listener=asrListener();
  onMain(()->{quiescent();Object environment=call(type("Host107VoiceEnvironment"),"current",new Class<?>[]{String.class},"zh-CN");check(Boolean.TRUE.equals(call(environment,"idle",NONE)),"PROBE_OFFICIAL_ASR_BUSY");voice=call(environment,"prepare",new Class<?>[]{String.class,type("Host107VoiceTask$Listener")},token,listener);return null;});
  decoder=make("Host107VoiceDecoder",NONE);archive=make("VoiceAudioArchive",new Class<?>[]{File.class,String.class,int.class},isolated,token,14);processProof();
  Object decode=proxy("RecordingVoiceSource$Decoder",(name,args)->{check(name.equals("decode"),"PROBE_DECODER_PORT_INVALID");byte[] pcm=(byte[])call(decoder,"decode",new Class<?>[]{byte[].class},args);decodedBytes.addAndGet(pcm.length);for(int i=0;i+1<pcm.length;i+=2){long p=Math.abs((int)(short)((pcm[i]&255)|(pcm[i+1]<<8)));peak.accumulateAndGet(p,Math::max);}return pcm;});
  Object source=make("RecordingVoiceSource",new Class<?>[]{String.class,String.class,long.class,type("VoiceAudioArchive"),type("RecordingVoiceSource$Decoder")},token,peer,generation,archive,decode);
  Object device=devicePort(),engine=enginePort();Object events=proxy("VoiceAnswerCoordinator$Events",(name,args)->{
   check(name.equals("changed"),"PROBE_STATE_CALLBACK_INVALID");Object state=args[0];coordinatorReleased=Boolean.TRUE.equals(field(state,"released"));answerReady=Boolean.TRUE.equals(field(state,"answerReady"));
   String currentPhase=String.valueOf(field(state,"phase"));phase=coordinatorReleased?"RELEASED":currentPhase.equals("CAPTURING")&&audioFrames.get()==0?"AWAITING_AUDIO":currentPhase;String note=String.valueOf(field(state,"note"));
   // State.note also describes a recoverable busy/query/engine-stop retry.
   // Keep those observations without converting them into a permanent fault.
   // Fatal receiver/ASR exceptions still use error; answer_ready independently
   // requires a fault-free, complete archive and every release proof.
   if(note.matches("[A-Za-z_]{1,80}"))coordinatorNote=note;
   if(note.matches("VOICE_[A-Z_]{1,64}")&&coordinatorNotes.size()<16)coordinatorNotes.add(note);
   // Inspect only this synthetic request's isolated draft; never export transcript.
   @SuppressWarnings("unchecked") Map<String,Object> s=(Map<String,Object>)field(state,"draftSnapshot");StringBuilder text=new StringBuilder();Object segments=s.get("segments");if(segments instanceof List)for(Object raw:(List<?>)segments)if(raw instanceof Map)text.append(String.valueOf(((Map<?,?>)raw).get("text")));
   String words=text.toString();expectedPreview=words.contains("预览");expectedNoChange=words.contains("不要修改文件");expectedKeep=words.contains("保留全部资料");expectedFriday=words.contains("星期五")||words.contains("周五");
   refresh();return null;
  });
  verifyControl(true);long now=SystemClock.elapsedRealtime();
  check(Boolean.TRUE.equals(call(cutoff,"arm",new Class<?>[]{String.class,String.class,long.class,long.class},token,peerHash,generation,now+15000)),"PROBE_CUTOFF_NOT_ARMED");armedEver=true;
  check(Boolean.TRUE.equals(call(draft,"arm",new Class<?>[]{String.class,long.class,long.class,int.class,type("CaptureSession$Cutoff")},peer,generation,now,15,cutoff)),"PROBE_DRAFT_NOT_ARMED");
  coordinator=make("VoiceAnswerCoordinator",new Class<?>[]{type("CaptureSession"),String.class,long.class,type("RecordingVoiceSource"),type("VoiceAudioArchive"),type("VoiceAnswerCoordinator$Device"),LongSupplier.class,type("VoiceAnswerCoordinator$Events")},draft,peer,generation,source,archive,device,(LongSupplier)SystemClock::elapsedRealtime,events);
  coordinatorListener=call(coordinator,"listener",NONE);call(coordinator,"attachEngine",new Class<?>[]{type("VoiceAnswerCoordinator$Engine")},engine);drain();
  if(aborted.get())call(coordinator,"stop",new Class<?>[]{boolean.class},false);else call(coordinator,"start",NONE);
  guard.scheduleAtFixedRate(()->{Object c=coordinator;if(c!=null&&!coordinatorReleased)try{call(c,"tick",NONE);}catch(Exception e){fault(code(e));}},0,250,TimeUnit.MILLISECONDS);
 }
 private void releasePrepared()throws Exception{
  if(armedEver||unarmedResourcesReleased)return;long until=SystemClock.elapsedRealtime()+4000;
  if(!preparedReleased)do{if(recording==null||Boolean.TRUE.equals(onMain(()->call(recording,"releasePrepared",NONE)))){preparedReleased=true;break;}Thread.sleep(100);}while(SystemClock.elapsedRealtime()<until);
  check(preparedReleased,"PROBE_PREPARED_RELEASE_UNCONFIRMED");
  if(voice!=null&&!nativeStarted.get()&&!nativeReleased.get()){call(voice,"release",new Class<?>[]{String.class},token);nativeReleased.set(true);}
  if(decoder!=null&&!decoderReleased.get()){call(decoder,"close",NONE);decoderReleased.set(true);}if(archive!=null)call(archive,"close",NONE);
  if(cutoff!=null)call(cutoff,"close",NONE);unarmedResourcesReleased=true;
 }
 private File historicalFile(File base,String relative)throws Exception{
  File root=base.getCanonicalFile(),file=new File(root,relative).getAbsoluteFile();
  check(file.toPath().normalize().equals(file.toPath())&&file.toPath().startsWith(root.toPath())&&!file.equals(root),"PROBE_ENROLLMENT_PATH_INVALID");
  java.nio.file.Path at=root.toPath();for(java.nio.file.Path part:root.toPath().relativize(file.toPath())){at=at.resolve(part);check(!Files.isSymbolicLink(at),"PROBE_ENROLLMENT_PATH_INVALID");}
  check(file.getCanonicalFile().equals(file),"PROBE_ENROLLMENT_PATH_INVALID");return file;
 }
 @SuppressWarnings("unchecked") private Map<String,Object> object(byte[] bytes)throws Exception{
  Object value=call(type("WireJson"),"read",new Class<?>[]{byte[].class,int.class,int.class},bytes,2097152,10000);check(value instanceof Map,"PROBE_ENROLLMENT_DOCUMENT_INVALID");return (Map<String,Object>)value;
 }
 private void enrollmentFiles(File destination)throws Exception{
  // AtomicDocument opens these exact sidecars. Reject dangling links too;
  // File.exists alone would follow a link and miss an absent target.
  for(String suffix:new String[]{".partial",".lock"}){
   File sidecar=historicalFile(destination.getParentFile(),destination.getName()+suffix);
   boolean present=Files.exists(sidecar.toPath(),LinkOption.NOFOLLOW_LINKS);
   check(!present||Files.isRegularFile(sidecar.toPath(),LinkOption.NOFOLLOW_LINKS),"PROBE_ENROLLMENT_PATH_INVALID");
   if(suffix.equals(".partial"))check(!present,"PROBE_ENROLLMENT_PARTIAL");
  }
 }
 private void enrollmentFresh(){
  long now=SystemClock.elapsedRealtime();
  check(error.get().isEmpty()&&ready.get()&&preflightAt>0&&now>=preflightAt&&now-preflightAt<8000,"PROBE_ENROLLMENT_PREFLIGHT_EXPIRED_OR_FAILED");
 }
 /** Explicit enrollment joins a previous complete physical attempt with this
  * original peer's fresh preflight. It never arms capture or adopts its audio
  * as a different task answer. The ordinary preflight operation is read-only. */
 private void enrollSource()throws Exception{
  check(error.get().isEmpty()&&mode.equals("preflight")&&!armedEver&&preflightPassed&&preparedReleased&&unarmedResourcesReleased&&watchdogAck.get()&&unstartedStop.getCount()==0,"PROBE_ENROLLMENT_NOT_READY");
  enrollmentFresh();
  onMain(()->{sameLink();quiescent();return null;});
  File files=getTargetContext().getFilesDir().getCanonicalFile(),history=historicalFile(files,"voice-probes/"+enrollAttempt);
  File previousDraft=historicalFile(history,"voice-drafts/"+enrollAttempt+".json"),previousReport=historicalFile(external,"io-agent-recording-probe-"+enrollAttempt+".json");
  File draftPartial=historicalFile(previousDraft.getParentFile(),previousDraft.getName()+".partial");
  check(!Files.exists(draftPartial.toPath(),LinkOption.NOFOLLOW_LINKS),"PROBE_ENROLLMENT_PARTIAL");
  byte[] draftBytes=read(previousDraft,2097152),reportBytes=read(previousReport,16384);Map<String,Object> saved=object(draftBytes),capture=object(reportBytes);
  check("REVIEW".equals(saved.get("phase"))&&Boolean.FALSE.equals(saved.get("needs_stop"))&&peerHash.equals(saved.get("peer")),"PROBE_ENROLLMENT_PEER_OR_DRAFT_INVALID");
  Object originalToken=saved.get("token");check(originalToken instanceof String&&((String)originalToken).matches("[a-f0-9]{32}"),"PROBE_ENROLLMENT_OWNER_INVALID");
  File previousManifest=historicalFile(history,"voice-audio/"+originalToken+"/source.json");byte[] manifestBytes=read(previousManifest,65536);Map<String,Object> manifest=object(manifestBytes);
  Object store=proxy("VoiceAnswerSession$Store",(name,args)->{if(name.equals("read"))return saved;throw new IOException("PROBE_ENROLLMENT_ARCHIVE_WRITE_FORBIDDEN");});
  Object previous=make("VoiceAnswerSession",new Class<?>[]{type("VoiceAnswerSession$Store")},store);
  call(type("VoiceAnswerEvidence"),"verify",new Class<?>[]{File.class,type("VoiceAnswerSession")},history,previous);
  Map<String,Object> proof=RecordingReadinessProof.create(capture,saved,manifest,enrollAttempt);
  check(peerHash.equals(proof.get("peer_hash")),"PROBE_ENROLLMENT_PEER_CHANGED");byte[] encoded=wire(proof);
  call(type("VoiceCaptureReadiness"),"read",new Class<?>[]{byte[].class,String.class},encoded,peerHash);
  onMain(()->{sameLink();quiescent();return null;});
  check(Arrays.equals(draftBytes,read(previousDraft,2097152))&&Arrays.equals(manifestBytes,read(previousManifest,65536))&&Arrays.equals(reportBytes,read(previousReport,16384)),"PROBE_ENROLLMENT_EVIDENCE_CHANGED");
  File destination=historicalFile(files,"io-agent-voice-readiness.json");enrollmentFiles(destination);Object document=make("AtomicDocument",new Class<?>[]{File.class},destination);boolean created=false;
  try{
   Object prior=call(document,"read",NONE);check(prior==null||Boolean.TRUE.equals(call(type("TaskWire"),"same",new Class<?>[]{Object.class,Object.class},prior,proof)),"PROBE_ENROLLMENT_EXISTING_PROOF_DIFFERENT");
   enrollmentFresh();enrollmentFiles(destination);
   if(prior==null){created=true;call(document,"save",new Class<?>[]{Object.class},proof);readinessWritten=true;}
   byte[] actual=read(destination,8192);call(type("VoiceCaptureReadiness"),"read",new Class<?>[]{byte[].class,String.class},actual,peerHash);
   check(Boolean.TRUE.equals(call(type("TaskWire"),"same",new Class<?>[]{Object.class,Object.class},object(actual),proof)),"PROBE_ENROLLMENT_READBACK_FAILED");
   check(Arrays.equals(draftBytes,read(previousDraft,2097152))&&Arrays.equals(manifestBytes,read(previousManifest,65536))&&Arrays.equals(reportBytes,read(previousReport,16384)),"PROBE_ENROLLMENT_EVIDENCE_CHANGED");
   enrollmentFresh();enrollmentEvidenceUnchanged=true;readinessEnrolled=true;
  }catch(Exception failure){
   // Revoke only this operation's newly created and still identical proof.
   // Never remove or replace an unknown pre-existing enrollment.
   if(created&&destination.isFile()&&Arrays.equals(encoded,read(destination,8192))){Files.delete(destination.toPath());readinessWritten=false;}
   throw failure;
  }finally{call(document,"close",NONE);}
 }
 private void refresh(){
  try{JSONObject s=new JSONObject().put("schema",1).put("probe_id",nonce).put("mode",mode).put("phase",phase).put("sequence",stateSequence.incrementAndGet()).put("watchdog_ack",watchdogAck.get()).put("preflight_passed",preflightPassed).put("preflight_fresh_idle_verified",preflightPassed).put("preflight_stop_dispatch_verified",!armedEver&&unstartedStop.getCount()==0).put("cold_recovery_supported",false).put("armed",armedEver).put("stop_command_count",stopCommands.get()).put("stop_accepted",stopAccepted.get()).put("device_idle_verified",deviceIdle.get()).put("native_start_attempted",nativeStarted.get()).put("native_stopped_verified",nativeStopped.get()).put("native_released",nativeReleased.get()).put("recording_released",recordingReleased.get()||preparedReleased).put("coordinator_released",coordinatorReleased).put("answer_ready",answerReady).put("frame_count",frames.get()).put("audio_frames",audioFrames.get()).put("ack_count",acks.get()).put("decoded_bytes",decodedBytes.get()).put("asr_pcm_bytes",pcmBytes.get()).put("pcm_peak",peak.get()).put("error",error.get()).put("safe_to_disarm",!armedEver?preparedReleased&&unarmedResourcesReleased:coordinatorReleased&&stopAccepted.get()&&deviceIdle.get()&&(!nativeStarted.get()||nativeStopped.get())&&nativeReleased.get()&&recordingReleased.get());publicState=s;
  }catch(JSONException ignored){}
 }
 private void exportReport(){
  try{refresh();JSONObject report=new JSONObject(publicState.toString()).put("physical_capture_requested",mode.equals("capture")&&armedEver).put("capture_audio_may_include_environment",mode.equals("capture")).put("synthetic_only_claimed",false).put("task_or_answer_submitted",false).put("readiness_created",false).put("expected_preview_retained",expectedPreview).put("expected_no_file_change_retained",expectedNoChange).put("expected_keep_materials_retained",expectedKeep).put("expected_friday_retained",expectedFriday);
   report.put("coordinator_note",coordinatorNote).put("coordinator_observed_notes",new JSONArray(new ArrayList<>(coordinatorNotes))).put("readiness_created",readinessWritten).put("source_readiness_enrolled",readinessEnrolled).put("enrollment_evidence_unchanged",enrollmentEvidenceUnchanged).put("enrollment_requested",!enrollAttempt.isEmpty());
   if(external!=null){File destination=new File(external,"io-agent-recording-probe-"+nonce+".json");try(FileOutputStream out=new FileOutputStream(destination)){out.write(report.toString(2).getBytes(StandardCharsets.UTF_8));out.getFD().sync();}}
  }catch(Exception e){error.compareAndSet("","PROBE_REPORT_FAILED");}
 }
 private void finishSafe(){
  refresh();if(!publicState.optBoolean("safe_to_disarm",false)||!finished.compareAndSet(false,true))return;
  exportReport();
  // The independent PC guard must have a live endpoint opportunity to observe
  // this proven terminal state, even if its polling is behind the final report.
  // The grace period never depends on another model/runner instruction.
  guard.schedule(this::cleanupFinished,1500,TimeUnit.MILLISECONDS);
 }
 private void cleanupFinished(){
  endpointClosed=true;try{if(server!=null)server.close();}catch(IOException ignored){}guard.shutdown();reports.shutdown();
  try{if(cutoff!=null)call(cutoff,"close",NONE);if(journal!=null)call(journal,"close",NONE);}catch(Exception e){error.compareAndSet("",code(e));}
  Bundle result=new Bundle();result.putBoolean("safe_to_disarm",true);result.putBoolean("physical_capture_requested",armedEver);result.putBoolean("cold_recovery_supported",false);result.putString("probe_id",nonce);result.putString("error",error.get());result.putString("phase",phase);finish(error.get().isEmpty()?Activity.RESULT_OK:Activity.RESULT_CANCELED,result);
 }
 @Override public void onCreate(Bundle args){super.onCreate(args);arguments=args==null?new Bundle():args;start();}
 @Override public void onStart(){
  try{
   loader=getTargetContext().getClassLoader();nonce=arguments.getString("probe_id","");mode=arguments.getString("mode","preflight");enrollAttempt=arguments.getString("enroll_attempt","");check(nonce.matches("[a-f0-9]{32}")&&(enrollAttempt.isEmpty()||enrollAttempt.matches("[a-f0-9]{32}")&&!enrollAttempt.equals(nonce)&&mode.equals("preflight")),"PROBE_ID_INVALID");external=getTargetContext().getExternalFilesDir(null);check(external!=null,"PROBE_EXPORT_UNAVAILABLE");
   check(!mode.equals("recover-stop"),"PROBE_RECOVERY_NOT_IMPLEMENTED");check(mode.equals("preflight")||mode.equals("capture"),"PROBE_MODE_INVALID");verifyCandidate();
   if(mode.equals("capture"))verifyControl(false);
   openEndpoint();if(mode.equals("capture"))check(ping.await(10,TimeUnit.SECONDS)&&watchdogAck.get(),"PROBE_WATCHDOG_HANDSHAKE_REQUIRED");
   awaitHost();prepareLocal();inspect();
   if(mode.equals("preflight")){if(stoppedCommand.await(5,TimeUnit.SECONDS))check(unstartedStop.await(2,TimeUnit.SECONDS),"PROBE_PREFLIGHT_STOP_DISPATCH_UNCONFIRMED");releasePrepared();if(!enrollAttempt.isEmpty())enrollSource();phase="PREFLIGHT_COMPLETE";}
   else{capture();long until=SystemClock.elapsedRealtime()+45000;while(!coordinatorReleased&&SystemClock.elapsedRealtime()<until)Thread.sleep(100);if(!coordinatorReleased){requestStop();phase="UNRESOLVED";error.compareAndSet("","PROBE_STOP_UNCONFIRMED");}}
  }catch(Throwable e){error.compareAndSet("",code(e));if(recording!=null)requestStop();phase=armedEver?"UNRESOLVED":"REJECTED";}
  finally{
   if(!armedEver)try{releasePrepared();}catch(Exception e){error.compareAndSet("",code(e));}
   exportReport();refresh();if(publicState.optBoolean("safe_to_disarm",false))finishSafe();
   else if(!armedEver&&recording==null&&voice==null&&decoder==null&&archive==null){preparedReleased=unarmedResourcesReleased=true;refresh();finishSafe();}
   else{
    // Do not finish Instrumentation, close the endpoint/cutoff, or remove its
    // journal while a physical stop/release obligation remains unproved.
    guard.scheduleAtFixedRate(()->{try{if(coordinator!=null&&!coordinatorReleased)call(coordinator,"tick",NONE);if(reportPending.compareAndSet(false,true))reports.execute(()->{try{exportReport();finishSafe();}finally{reportPending.set(false);}});}catch(Exception e){error.compareAndSet("",code(e));}},1,1,TimeUnit.SECONDS);
   }
  }
 }
}
