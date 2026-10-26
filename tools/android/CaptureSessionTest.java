package com.turboio.addon;

import java.io.File;
import java.lang.reflect.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.*;
import java.util.function.LongSupplier;

/** Neutral-type regression over the existing question owner. All stop/ASR facts
 * are synthetic; no independent delegation owner or physical recording is made. */
final class CaptureSessionTest {
 private static int checks;
 private static void yes(boolean value){checks++;if(!value)throw new AssertionError("capture session assertion "+checks);}
 private static final Set<String> JOURNAL=TaskWire.set("schema","phase","target","token","peer","generation","deadline","stop_at","stop_sent","needs_stop","engine_end","engine_stopped","device_stopped","cancelled","error","segments","edited","frozen_text");
 private static void abi()throws Exception{
  yes(CaptureSession.class.isInterface()&&CaptureSession.class.isAssignableFrom(VoiceAnswerSession.class));
  yes(CaptureSession.CAPTURE_SECONDS==60&&VoiceAnswerSession.CAPTURE_SECONDS==60&&RecordingVoiceSource.MAX_PACKETS==3200);
  for(Method method:CaptureSession.class.getDeclaredMethods()){
   yes(!TaskWire.set("prepare","saveAnswer","confirm","enqueue").contains(method.getName()));
   for(Class<?> type:method.getParameterTypes())yes(type!=TaskConnection.class&&type!=TaskMailbox.class);
  }
  for(Class<?> type:new Class<?>[]{Host107Recording.class,VoiceAnswerCoordinator.class,VoiceDraftCallbacks.class})yes(type.getDeclaredField("draft").getType()==CaptureSession.class);
  yes(VoiceAnswerSession.class.getDeclaredMethod("capturePermit").getReturnType()==CaptureSession.CapturePermit.class);
  yes(!Modifier.isSynchronized(VoiceAnswerSession.class.getDeclaredMethod("capturePermit").getModifiers()));
  yes(!Modifier.isSynchronized(VoiceAnswerSession.class.getDeclaredMethod("revokeOpening",String.class).getModifiers()));
  yes(Modifier.isSynchronized(VoiceAnswerSession.class.getDeclaredMethod("deviceIdle",CaptureSession.StopProbe.class,String.class,long.class,long.class,boolean.class).getModifiers()));
  for(String name:new String[]{"phase","token","peer"})yes(CaptureSession.CapturePermit.class.getDeclaredField(name).getType()==String.class);
  for(String name:new String[]{"needsStop","opening"})yes(CaptureSession.CapturePermit.class.getDeclaredField(name).getType()==boolean.class);
  for(String method:new String[]{"acquire","acquireRecovery"})yes(Host107Recording.class.getDeclaredMethod(method,CaptureSession.class,VoiceCaptureCutoff.class,Host107Recording.Receiver.class)!=null);
  for(String method:new String[]{"adoptRecovery","release"})yes(VoiceCaptureCutoff.class.getDeclaredMethod(method,CaptureSession.class)!=null);
  yes(VoiceAnswerSession.class.getDeclaredMethod("arm",String.class,long.class,long.class,int.class,CaptureSession.Cutoff.class)!=null);
  yes(VoiceAnswerCoordinator.class.getDeclaredConstructor(CaptureSession.class,String.class,long.class,RecordingVoiceSource.class,VoiceAudioArchive.class,VoiceAnswerCoordinator.Device.class,LongSupplier.class,VoiceAnswerCoordinator.Events.class)!=null);
  yes(VoiceAudioArchive.class.getDeclaredMethod("seal",CaptureSession.class)!=null);
 }
 private static void unchangedJournalAndSource(File root)throws Exception{
  VoiceAnswerTest.Memory store=new VoiceAnswerTest.Memory();TaskConnection connection=VoiceAnswerTest.connection("neutral-capture");
  CaptureSession capture=VoiceAnswerTest.prepared(store,connection);String token=capture.token(),peer=VoiceAnswerTest.PEER,hash=FixedPeerHash.of(peer);
  Map<String,Object> target=WireJson.map(WireJson.map(capture.snapshot()).get("target"));
  yes(target.keySet().equals(TaskWire.set("binding","fingerprint","request")));
  yes(capture.arm(peer,7,1000,60,(t,p,g,d)->token.equals(t)&&hash.equals(p)&&g==7&&d==61000));
  yes(WireJson.map(store.value).keySet().equals(JOURNAL)&&TaskWire.positive(WireJson.map(store.value).get("schema"))==1);
  CaptureSession.CapturePermit permit=capture.capturePermit();yes(permit.opening&&permit.needsStop&&permit.deadline==61000&&permit.generation==7&&permit.peer.equals(hash));
  String text="保留原问题与完整条件。";yes(capture.officialResult(token,peer,7,text,true,1100));
  yes(capture.stop(token,2000,false)&&!capture.capturePermit().opening&&capture.needsStop());
  yes(capture.stopSubmitted(token,peer,7,2001)&&capture.engineSealed(token,true,2002)&&!capture.finish());
  CaptureSession.StopProbe actual=capture.probeStop(peer,7,2003);
  yes(actual!=null);
  // A matching freshly constructed probe gained no authority when its type moved.
  CaptureSession.StopProbe copy=new CaptureSession.StopProbe(capture,2003,7,token,hash);
  yes(!capture.deviceIdle(copy,peer,7,2004,true)&&!capture.finish());
  yes(capture.deviceIdle(actual,peer,7,2004,true)&&!capture.deviceIdle(actual,peer,7,2005,true));
  yes(capture.finish()&&!capture.needsStop()&&capture.phase().equals("REVIEW"));
  yes(WireJson.map(store.value).keySet().equals(JOURNAL)&&TaskWire.same(target,WireJson.map(store.value).get("target")));
  Object before=WireJson.copy(store.value);CaptureSession restored=new VoiceAnswerSession(store);yes(TaskWire.same(before,restored.snapshot()));
  try(VoiceAudioArchive archive=new VoiceAudioArchive(root,token,14)){
   byte[] pcm=new byte[640];pcm[0]=1;archive.original(OtaFrame.encode(3,WireJson.object("uuid",token,"offset",0),new byte[240]));archive.decodedRecording(pcm);archive.recordingComplete(token,240,1);
   Map<String,Object> manifest=WireJson.map(archive.seal(restored)),source=WireJson.map(manifest.get("source")),request=WireJson.map(target.get("request"));
   Object expected=WireJson.object("binding",target.get("binding"),"request_id",request.get("object_id"),"request_revision",request.get("revision"),"task_id",TaskWire.body(request).get("task_id"),"request_fingerprint",target.get("fingerprint"),"asr_task","io_agent_asr_"+token,"transcript_sha256",TaskWire.hash(text.getBytes(StandardCharsets.UTF_8)));
   yes(Boolean.TRUE.equals(manifest.get("complete"))&&TaskWire.same(expected,source));
  }
  VoiceAnswerEvidence.verify(root,(VoiceAnswerSession)restored);yes(true);
 }
 private static void nonblockingRevocationAndFailedWrite()throws Exception{
  VoiceAnswerTest.Memory store=new VoiceAnswerTest.Memory();CaptureSession capture=VoiceAnswerTest.prepared(store,VoiceAnswerTest.connection("neutral-permit"));
  yes(capture.arm(VoiceAnswerTest.PEER,3,1000,15,(t,p,g,d)->true));
  CaptureSession.CapturePermit prior=capture.capturePermit();CountDownLatch held=new CountDownLatch(1),release=new CountDownLatch(1),done=new CountDownLatch(1);
  Thread holder=new Thread(()->{synchronized(capture){held.countDown();try{release.await();}catch(InterruptedException e){Thread.currentThread().interrupt();}}});holder.setDaemon(true);holder.start();
  Thread revoker=new Thread(()->{capture.revokeOpening(prior.token);capture.capturePermit();done.countDown();});revoker.setDaemon(true);
  try{yes(held.await(1,TimeUnit.SECONDS));revoker.start();yes(done.await(1,TimeUnit.SECONDS)&&release.getCount()==1);yes(!capture.capturePermit().opening);}
  finally{release.countDown();holder.join(1000);revoker.join(1000);}
  store.fail=true;try{capture.stop(prior.token,2000,false);throw new AssertionError("write failure expected");}catch(java.io.IOException expected){yes(true);}
  CaptureSession.CapturePermit after=capture.capturePermit();yes(!capture.healthy()&&capture.needsStop()&&!after.opening&&after.needsStop&&after.token.equals(prior.token)&&after.peer.equals(prior.peer)&&after.generation==prior.generation&&after.deadline==prior.deadline);
  // Reload the last durable capture: never reopens it, and retains its cleanup.
  store.fail=false;CaptureSession restored=new VoiceAnswerSession(store);yes(restored.phase().equals("RECOVERY")&&restored.needsStop()&&!restored.capturePermit().opening);
  yes(!restored.arm(VoiceAnswerTest.PEER,4,3000,15,(t,p,g,d)->true));
 }
 public static void main(String[] args)throws Exception{abi();unchangedJournalAndSource(new File(args[0]));nonblockingRevocationAndFailedWrite();System.out.println("Neutral capture session: "+checks+" assertions passed (synthetic question owner; no device)");}
}
