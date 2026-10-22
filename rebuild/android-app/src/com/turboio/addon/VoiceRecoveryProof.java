package com.turboio.addon;

import java.util.Map;

/** Pure admission for a stopped local engine crossing a recording-owner epoch.
 * No SDK calls, writes, task-map inference, or physical-mic stop proof. A Warm
 * value retains both the exact live draft and exact native-task Java identity. */
final class VoiceRecoveryProof {
 private VoiceRecoveryProof(){}
 static final class Warm {
  private final VoiceAnswerSession draft;private final Object nativeOwner,target;
  private final String token,peer;private final long generation;
  private Warm(VoiceAnswerSession draft,Object nativeOwner,Map<String,Object> state){
   this.draft=draft;this.nativeOwner=nativeOwner;token=(String)state.get("token");peer=(String)state.get("peer");generation=TaskWire.positive(state.get("generation"));target=WireJson.copy(state.get("target"));
  }
  boolean current(VoiceAnswerSession candidate,Object candidateNative){
   if(candidate!=draft||candidateNative!=nativeOwner||candidateNative==null)return false;
   try{Map<String,Object> state=stopped(candidate);return state!=null&&token.equals(state.get("token"))&&peer.equals(state.get("peer"))&&TaskWire.positive(state.get("generation"))>=generation&&TaskWire.same(target,state.get("target"));}
   catch(RuntimeException invalid){return false;}
  }
  boolean permits(VoiceAnswerSession candidate,Object candidateNative,String nextPeer,long nextGeneration){
   try{return current(candidate,candidateNative)&&nextPeer!=null&&peer.equals(FixedPeerHash.of(nextPeer))&&nextGeneration>candidate.capturePermit().generation;}
   catch(RuntimeException invalid){return false;}
  }
 }
 private static Map<String,Object> stopped(VoiceAnswerSession draft){
  if(draft==null||!draft.healthy()||!draft.needsStop())return null;
  Map<String,Object> state=WireJson.map(draft.snapshot());
  if(!"STOPPING".equals(state.get("phase")))return null;
  for(String key:new String[]{"needs_stop","engine_end","engine_stopped","cancelled"})if(!Boolean.TRUE.equals(state.get(key)))return null;
  return state;
 }
 /** Call only with this coordinator's published snapshot and captured engine.
  * Publication follows its native terminal check and admitted-callback barrier;
  * every binding must still match the durable draft on the receiving IO worker. */
 static Warm published(VoiceAnswerSession draft,Map<String,Object> published,Object nativeOwner,String expectedToken,String expectedPeer,long expectedGeneration){
  try{
   Map<String,Object> current=stopped(draft);if(current==null||published==null||nativeOwner==null||expectedPeer==null)return null;
   for(String key:new String[]{"token","peer","generation","target","phase"})if(!TaskWire.same(published.get(key),current.get(key)))return null;
   for(String key:new String[]{"needs_stop","engine_end","engine_stopped","cancelled"})if(!Boolean.TRUE.equals(published.get(key)))return null;
   if(!current.get("token").equals(expectedToken)||!current.get("peer").equals(FixedPeerHash.of(expectedPeer))||TaskWire.positive(current.get("generation"))!=expectedGeneration)return null;
   return new Warm(draft,nativeOwner,current);
  }catch(RuntimeException invalid){return null;}
 }
 /** Cold admission consumes exact process evidence, never a boolean saying that
  * a task map is empty. The caller establishes ENOENT and reads self procfs;
  * this checks the parsed self PID and same-attempt/token process record too.
  * A new process may restart its link counter at any positive generation. */
 static boolean cold(VoiceAnswerSession draft,String attempt,String nextPeer,long nextGeneration,byte[] processRecord,VoiceProcessProof.Stamp self,int selfPid,VoiceProcessProof.Stamp oldObserved,boolean oldAbsentConfirmed){
  try{
   if(draft==null||!draft.healthy()||!draft.needsStop()||self==null||selfPid<=0||self.pid!=selfPid||self.startTicks<=0||nextPeer==null||nextGeneration<=0)return false;
   VoiceAnswerSession.CapturePermit permit=draft.capturePermit();
   if(!TaskWire.set("RECOVERY","STOPPING").contains(permit.phase)||!permit.peer.equals(FixedPeerHash.of(nextPeer)))return false;
   int oldPid=VoiceProcessProof.ownerPid(processRecord,attempt,draft.token());
   if(oldPid==self.pid&&(oldAbsentConfirmed||oldObserved==null||oldObserved.startTicks!=self.startTicks))return false;
   return VoiceProcessProof.ended(processRecord,attempt,draft.token(),oldObserved,oldAbsentConfirmed);
  }catch(RuntimeException invalid){return false;}
 }
}
