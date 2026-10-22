package com.turboio.addon;

import java.nio.charset.StandardCharsets;
import java.util.*;

/** Synthetic real-session transitions only: no procfs, native SDK or device IO.
 * Exercises the same admission object consumed by VoiceAnswerRuntime. */
public final class VoiceRecoveryProofTest {
 private static int checks;
 private static final String PEER=VoiceAnswerTest.PEER,OTHER=VoiceAnswerTest.OTHER,ATTEMPT="0123456789abcdef0123456789abcdef";
 private static void yes(boolean value){checks++;if(!value)throw new AssertionError("recovery proof assertion "+checks);}
 private static final class EqualOwner {public boolean equals(Object other){return other instanceof EqualOwner;}public int hashCode(){return 1;}}
 private static final class Capture {
  final VoiceAnswerTest.Memory store=new VoiceAnswerTest.Memory();final VoiceAnswerSession draft;
  final Object nativeOwner=new EqualOwner();final long generation;
  Capture(long generation)throws Exception{this(generation,"original-agent");}
  Capture(long generation,String agent)throws Exception{
   this.generation=generation;draft=VoiceAnswerTest.prepared(store,VoiceAnswerTest.connection(agent));
   yes(draft.arm(PEER,generation,1000,15,(token,peer,epoch,deadline)->token.equals(draft.token())&&peer.equals(FixedPeerHash.of(PEER))&&epoch==generation&&deadline==16000));
   yes(draft.result(draft.token(),PEER,generation,1,1,"只保留预览\n附加条件：不要发布或发送消息。",true,1100));
  }
  Map<String,Object> snapshot(){return WireJson.map(draft.snapshot());}
  void seal(boolean cancel)throws Exception{yes(draft.stop(draft.token(),2000,cancel));yes(draft.engineSealed(draft.token(),true,2001));}
  VoiceRecoveryProof.Warm published(Map<String,Object> state){return VoiceRecoveryProof.published(draft,state,nativeOwner,draft.token(),PEER,draft.capturePermit().generation);}
 }
 private static Map<String,Object> changed(Map<String,Object> state,String field,Object value){Map<String,Object> copy=WireJson.map(WireJson.copy(state));copy.put(field,value);return copy;}
 private static VoiceProcessProof.Stamp stamp(int pid,long ticks){
  StringBuilder stat=new StringBuilder(pid+" (synthetic recovery process) S");for(int field=4;field<=21;field++)stat.append(" 0");stat.append(' ').append(ticks).append(" 0\n");
  return VoiceProcessProof.parseStat(stat.toString().getBytes(StandardCharsets.UTF_8));
 }
 private static void publication()throws Exception{
  Capture stoppedOnly=new Capture(2);yes(stoppedOnly.draft.stop(stoppedOnly.draft.token(),2000,true));yes(stoppedOnly.draft.engineStopped(stoppedOnly.draft.token(),true));yes(stoppedOnly.published(stoppedOnly.snapshot())==null);
  yes(stoppedOnly.draft.engineEnd(stoppedOnly.draft.token(),2001));yes(stoppedOnly.published(stoppedOnly.snapshot())!=null);
  Capture c=new Capture(3);Map<String,Object> capturing=c.snapshot();yes(c.published(capturing)==null);
  yes(c.draft.stop(c.draft.token(),2000,true));Map<String,Object> stopping=c.snapshot();yes(c.published(stopping)==null);
  yes(c.draft.engineEnd(c.draft.token(),2001));Map<String,Object> endedOnly=c.snapshot();yes(c.published(endedOnly)==null);
  yes(c.draft.engineStopped(c.draft.token(),true));Map<String,Object> sealed=c.snapshot();VoiceRecoveryProof.Warm proof=c.published(sealed);yes(proof!=null);
  yes(c.published(capturing)==null&&c.published(stopping)==null&&c.published(endedOnly)==null);
  yes(c.draft.needsStop()&&c.draft.phase().equals("STOPPING"));yes(proof.current(c.draft,c.nativeOwner));
  yes(!proof.permits(c.draft,c.nativeOwner,PEER,3));yes(!proof.permits(c.draft,c.nativeOwner,PEER,2));yes(!proof.permits(c.draft,c.nativeOwner,OTHER,4));yes(proof.permits(c.draft,c.nativeOwner,PEER,4));
  Capture other=new Capture(3,"different-agent");other.seal(true);
  for(String field:new String[]{"token","target"})yes(c.published(changed(sealed,field,other.snapshot().get(field)))==null);
  yes(c.published(changed(sealed,"peer",FixedPeerHash.of(OTHER)))==null);
  yes(c.published(changed(sealed,"generation",2L))==null);yes(c.published(changed(sealed,"generation",4L))==null);
  yes(c.published(changed(sealed,"phase","RECOVERY"))==null);
  for(String field:new String[]{"needs_stop","engine_end","engine_stopped","cancelled"}){
   yes(c.published(changed(sealed,field,false))==null);yes(c.published(changed(sealed,field,null))==null);
   Map<String,Object> missing=WireJson.map(WireJson.copy(sealed));missing.remove(field);yes(c.published(missing)==null);
  }
  yes(VoiceRecoveryProof.published(c.draft,sealed,null,c.draft.token(),PEER,3)==null);
  yes(c.published(null)==null);yes(VoiceRecoveryProof.published(null,sealed,c.nativeOwner,c.draft.token(),PEER,3)==null);
  yes(VoiceRecoveryProof.published(c.draft,sealed,c.nativeOwner,other.draft.token(),PEER,3)==null);
  yes(VoiceRecoveryProof.published(c.draft,sealed,c.nativeOwner,c.draft.token(),OTHER,3)==null);
  yes(VoiceRecoveryProof.published(c.draft,sealed,c.nativeOwner,c.draft.token(),PEER,4)==null);
  yes(!proof.current(c.draft,new EqualOwner()));yes(!proof.current(c.draft,null));yes(!proof.current(other.draft,c.nativeOwner));
  yes(!proof.permits(c.draft,new EqualOwner(),PEER,4));
  // A comparison on another worker cannot overwrite either published or durable data.
  yes(TaskWire.same(sealed,c.snapshot()));
  yes(c.draft.engineStopped(c.draft.token(),false));yes(c.published(sealed)==null&&!proof.current(c.draft,c.nativeOwner));
  yes(c.draft.engineStopped(c.draft.token(),true));yes(proof.current(c.draft,c.nativeOwner));
 }
 private static void cancellationAndEpochs()throws Exception{
  Capture c=new Capture(8);c.seal(false);Map<String,Object> uncancelled=c.snapshot();yes(c.published(uncancelled)==null);
  yes(c.draft.stop(c.draft.token(),2100,true));yes(c.published(uncancelled)==null);
  Map<String,Object> before=c.snapshot();VoiceRecoveryProof.Warm proof=c.published(before);yes(proof!=null&&proof.permits(c.draft,c.nativeOwner,PEER,9));
  // The production handoff preserves old ASR proof but resets device-stop proof.
  yes(c.draft.failed(c.draft.token(),PEER,8,"VOICE_INTERRUPTED",2101));yes(c.draft.resumeCleanup(PEER,9,2200));
  yes(c.published(before)==null);yes(proof.current(c.draft,c.nativeOwner));yes(!proof.permits(c.draft,c.nativeOwner,PEER,9));yes(proof.permits(c.draft,c.nativeOwner,PEER,10));
  Map<String,Object> ninth=c.snapshot();yes(VoiceRecoveryProof.published(c.draft,ninth,c.nativeOwner,c.draft.token(),PEER,8)==null);
  yes(c.draft.resumeCleanup(PEER,10,2300));Map<String,Object> tenth=c.snapshot();yes(c.published(ninth)==null&&c.published(tenth)!=null);
  yes(!proof.permits(c.draft,c.nativeOwner,PEER,1));yes(proof.permits(c.draft,c.nativeOwner,PEER,11));
  VoiceAnswerTest.Memory copy=new VoiceAnswerTest.Memory();copy.value=WireJson.copy(c.store.value);VoiceAnswerSession restored=new VoiceAnswerSession(copy);
  yes(restored.resumeCleanup(PEER,10,2400));yes(restored.stop(restored.token(),2401,true));yes(restored.engineSealed(restored.token(),true,2402));
  yes(!proof.current(restored,c.nativeOwner)); // Even equivalent durable state is a different live owner.
  yes(c.draft.stopSubmitted(c.draft.token(),PEER,10,2400));VoiceAnswerSession.StopProbe probe=c.draft.probeStop(PEER,10,2401);yes(c.draft.deviceIdle(probe,PEER,10,2402,true));yes(c.draft.finish());
  yes(c.draft.phase().equals("CANCELLED")&&!proof.current(c.draft,c.nativeOwner));yes(!proof.permits(c.draft,c.nativeOwner,PEER,11));
  Capture failed=new Capture(2);failed.seal(false);Map<String,Object> failedBefore=failed.snapshot();failed.store.fail=true;
  try{failed.draft.stop(failed.draft.token(),2200,true);throw new AssertionError("write failure expected");}catch(java.io.IOException expected){yes(true);}
  yes(!failed.draft.healthy());yes(failed.published(failedBefore)==null);
 }
 private static void cold()throws Exception{
  Capture live=new Capture(19);VoiceAnswerSession restored=new VoiceAnswerSession(live.store);yes(restored.phase().equals("RECOVERY")&&restored.needsStop());
  byte[] record=VoiceProcessProof.record(ATTEMPT,restored.token(),42,1000);VoiceProcessProof.Stamp self=stamp(84,2000),oldLive=stamp(42,1000),reused=stamp(42,3000);
  yes(VoiceRecoveryProof.cold(restored,ATTEMPT,PEER,1,record,self,84,null,true));
  yes(VoiceRecoveryProof.cold(restored,ATTEMPT,PEER,1,record,self,84,reused,false));
  yes(!VoiceRecoveryProof.cold(restored,ATTEMPT,PEER,1,record,self,84,oldLive,false));
  yes(!VoiceRecoveryProof.cold(restored,ATTEMPT,PEER,1,record,self,84,null,false));
  yes(!VoiceRecoveryProof.cold(restored,ATTEMPT,OTHER,1,record,self,84,null,true));
  yes(!VoiceRecoveryProof.cold(restored,ATTEMPT,PEER,0,record,self,84,null,true));
  yes(!VoiceRecoveryProof.cold(restored,ATTEMPT,PEER,1,null,self,84,null,true));
  yes(!VoiceRecoveryProof.cold(restored,ATTEMPT,PEER,1,WireJson.bytes(Collections.emptyMap()),self,84,null,true));
  yes(!VoiceRecoveryProof.cold(restored,ATTEMPT,PEER,1,record,null,84,null,true));
  yes(!VoiceRecoveryProof.cold(restored,ATTEMPT,PEER,1,record,self,85,null,true));
  yes(!VoiceRecoveryProof.cold(restored,"ffffffffffffffffffffffffffffffff",PEER,1,record,self,84,null,true));
  byte[] wrongToken=VoiceProcessProof.record(ATTEMPT,new Capture(1).draft.token(),42,1000);
  yes(!VoiceRecoveryProof.cold(restored,ATTEMPT,PEER,1,wrongToken,self,84,null,true));
  yes(!VoiceRecoveryProof.cold(restored,ATTEMPT,PEER,1,record,self,84,stamp(43,3000),false));
  yes(!VoiceRecoveryProof.cold(restored,ATTEMPT,PEER,1,record,self,84,reused,true));
  // A self PID cannot simultaneously be absent; PID reuse must match current self stat.
  yes(!VoiceRecoveryProof.cold(restored,ATTEMPT,PEER,1,record,oldLive,42,null,true));
  yes(!VoiceRecoveryProof.cold(restored,ATTEMPT,PEER,1,record,oldLive,42,reused,false));
  yes(VoiceRecoveryProof.cold(restored,ATTEMPT,PEER,1,record,reused,42,reused,false));
  yes(!VoiceRecoveryProof.cold(live.draft,ATTEMPT,PEER,1,record,self,84,null,true)); // Still CAPTURING.
  yes(restored.stop(restored.token(),3000,true));yes(restored.failed(restored.token(),PEER,19,"VOICE_INTERRUPTED",3001));yes(restored.resumeCleanup(PEER,1,3002));
  yes(restored.engineSealed(restored.token(),true,3003));yes(restored.stopSubmitted(restored.token(),PEER,1,3004));
  VoiceAnswerSession.StopProbe check=restored.probeStop(PEER,1,3005);yes(restored.deviceIdle(check,PEER,1,3006,true));yes(restored.finish());
  yes(restored.phase().equals("CANCELLED")&&restored.transcript().contains("附加条件"));
  yes(!VoiceRecoveryProof.cold(restored,ATTEMPT,PEER,2,record,self,84,null,true));
 }
 public static void main(String[] args)throws Exception{publication();cancellationAndEpochs();cold();System.out.println("voice recovery owner proof: "+checks+" assertions passed (synthetic session/process fixtures only)");}
}
