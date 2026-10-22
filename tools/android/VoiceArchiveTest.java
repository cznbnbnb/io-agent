package com.turboio.addon;

import java.io.*;import java.nio.file.*;import java.util.*;

/** Real audio files/manifests; synthetic byte fixtures, no decoder, SDK, microphone or server. */
final class VoiceArchiveTest {
 static void yes(boolean value){VoiceAnswerTest.yes(value);}
 static VoiceAnswerSession review()throws Exception{
  VoiceAnswerSession s=VoiceAnswerTest.prepared(new VoiceAnswerTest.Memory(),VoiceAnswerTest.connection("archive-original"));
  VoiceAnswerTest.arm(s);yes(s.result(s.token(),VoiceAnswerTest.PEER,1,1,1,"只预览。\n保留全部条件和原音。",true,1200));VoiceAnswerTest.stopped(s,1);return s;
 }
 static File directory(File root,VoiceAnswerSession s){return new File(root,"voice-audio/"+s.token());}
 static Object manifest(File root,VoiceAnswerSession s)throws Exception{return WireJson.read(Files.readAllBytes(new File(directory(root,s),"source.json").toPath()));}
 static void pair(VoiceAudioArchive a)throws Exception{a.original(new byte[]{1,2,3});a.decoded(new byte[]{0,(byte)128,0,0,(byte)232,3});}
 static void hashes(File root,VoiceAnswerSession s,Map<String,Object> record)throws Exception{
  for(String[] f:new String[][]{{"original.frames","wire_sha256"},{"decoded.pcm","pcm_sha256"}})yes(record.get(f[1]).equals(TaskWire.hash(Files.readAllBytes(new File(directory(root,s),f[0]).toPath()))));
 }
 static void run(File root)throws Exception{
  VoiceAnswerSession s=review();
  try(VoiceAudioArchive a=new VoiceAudioArchive(root,s.token(),13)){
   yes(Boolean.FALSE.equals(WireJson.map(manifest(root,s)).get("sealed")));pair(a);pair(a);
   Map<String,Object> m=WireJson.map(a.seal(s));yes(Boolean.TRUE.equals(m.get("complete"))&&TaskWire.positive(m.get("frames"))==2&&TaskWire.positive(m.get("decoded_frames"))==2);
   yes(TaskWire.positive(m.get("peak"))==32768&&TaskWire.positive(m.get("samples"))==6&&TaskWire.positive(m.get("nonzero_samples"))==4&&TaskWire.positive(m.get("business"))==13);hashes(root,s,m);
   Map<String,Object> source=WireJson.map(m.get("source"));yes(source.get("binding").equals(VoiceAnswerTest.connection("archive-original").binding()));yes(source.get("transcript_sha256").equals(TaskWire.hash(s.transcript().getBytes(java.nio.charset.StandardCharsets.UTF_8))));
   yes(source.get("request_id").equals("voice-question")&&source.get("task_id").equals("voice-task")&&TaskWire.positive(source.get("request_revision"))==1);
   byte[] wire=Files.readAllBytes(new File(directory(root,s),"original.frames").toPath());yes(Arrays.equals(wire,new byte[]{0,0,0,3,1,2,3,0,0,0,3,1,2,3}));
   VoiceAnswerTest.rejects(()->a.original(new byte[]{4}));VoiceAnswerTest.rejects(()->a.decoded(new byte[]{0,1}));VoiceAnswerTest.rejects(()->a.seal(s));yes(TaskWire.same(m,manifest(root,s)));
  }
  VoiceAnswerTest.rejects(()->new VoiceAudioArchive(root,s.token(),14));
  VoiceAnswerTest.rejects(()->new VoiceAudioArchive(root,"invalid-owner",14));VoiceAnswerTest.rejects(()->new VoiceAudioArchive(root,"ffffffffffffffffffffffffffffffff",15));
  for(String failure:new String[]{"missing-decode","second-original","decode-first","odd-pcm","oversize","silence","cancel","still-recording"}){
   VoiceAnswerSession v=review();if(failure.equals("cancel"))yes(v.cancelDraft(3000));
   if(failure.equals("still-recording")){v=VoiceAnswerTest.prepared(new VoiceAnswerTest.Memory(),VoiceAnswerTest.connection("archive-original"));VoiceAnswerTest.arm(v);}
   try(VoiceAudioArchive a=new VoiceAudioArchive(root,v.token(),13)){
    if(failure.equals("decode-first"))VoiceAnswerTest.rejects(()->a.decoded(new byte[]{0,1}));
    else if(failure.equals("odd-pcm")){a.original(new byte[]{1});VoiceAnswerTest.rejects(()->a.decoded(new byte[]{1}));}
    else if(failure.equals("missing-decode"))a.original(new byte[]{1});
    else if(failure.equals("second-original")){a.original(new byte[]{1});VoiceAnswerTest.rejects(()->a.original(new byte[]{2}));}
    else if(failure.equals("silence")){a.original(new byte[]{1});a.decoded(new byte[]{0,0});}
    else{pair(a);if(failure.equals("oversize"))VoiceAnswerTest.rejects(()->a.original(new byte[16385]));}
    Map<String,Object> m=WireJson.map(a.seal(v));yes(Boolean.FALSE.equals(m.get("complete"))&&Boolean.TRUE.equals(m.get("sealed")));hashes(root,v,m);
   }
  }
  VoiceAnswerSession retry=review();
  try(VoiceAudioArchive a=new VoiceAudioArchive(root,retry.token(),14)){
   pair(a);Path partial=new File(directory(root,retry),"source.json.partial").toPath();Files.createDirectory(partial);
   VoiceAnswerTest.rejects(()->a.seal(retry));yes(Boolean.FALSE.equals(WireJson.map(manifest(root,retry)).get("sealed")));
   byte[] original=Files.readAllBytes(new File(directory(root,retry),"original.frames").toPath());VoiceAnswerTest.rejects(()->a.original(new byte[]{7}));
   Files.delete(partial);Map<String,Object> m=WireJson.map(a.seal(retry));yes(Boolean.FALSE.equals(m.get("complete")));hashes(root,retry,m);yes(Arrays.equals(original,Files.readAllBytes(new File(directory(root,retry),"original.frames").toPath())));
  }
  VoiceAnswerSession owner=review(),other=review();
  try(VoiceAudioArchive a=new VoiceAudioArchive(root,owner.token(),13)){pair(a);VoiceAnswerTest.rejects(()->a.seal(other));yes(Boolean.TRUE.equals(WireJson.map(a.seal(owner)).get("complete")));}
  VoiceAnswerSession unverifiedRecording=review();try(VoiceAudioArchive a=new VoiceAudioArchive(root,unverifiedRecording.token(),14)){
   pair(a);yes(Boolean.FALSE.equals(WireJson.map(a.seal(unverifiedRecording)).get("complete"))); // No owned recording end/coverage proof.
  }
  VoiceAnswerSession budget=review();try(VoiceAudioArchive a=new VoiceAudioArchive(root,budget.token(),14)){
   byte[] pcm=new byte[8192];pcm[0]=1;for(int i=0;i<256;i++){a.original(new byte[]{1});a.decoded(pcm);}a.original(new byte[]{1});VoiceAnswerTest.rejects(()->a.decoded(pcm));yes(Boolean.FALSE.equals(WireJson.map(a.seal(budget)).get("complete")));
  }
  VoiceAnswerSession unsealed=review();try(VoiceAudioArchive a=new VoiceAudioArchive(root,unsealed.token(),14)){pair(a);}
  yes(Boolean.FALSE.equals(WireJson.map(manifest(root,unsealed)).get("complete")));yes(new File(directory(root,unsealed),"original.frames").length()>0);
 }
}
