package com.turboio.addon;

import java.io.*;import java.nio.charset.StandardCharsets;import java.nio.file.*;import java.util.*;

/** Synthetic archive bytes only. Passing these fixtures is not device/source verification. */
public final class VoiceAnswerEvidenceTest {
 static int checks,linkSkips;
 interface Work {void run()throws Exception;}
 interface Mutation {void apply(Map<String,Object> record)throws Exception;}
 static void yes(boolean value){checks++;if(!value)throw new AssertionError("voice evidence assertion "+checks);}
 static void rejects(Work action)throws Exception{
  checks++;try{action.run();}catch(IOException expected){if(expected.getMessage()!=null&&expected.getMessage().matches("VOICE_ARCHIVE_[A-Z_]+")&&expected.getCause()==null)return;throw new AssertionError("unsafe evidence error");}
  throw new AssertionError("voice evidence expected rejection "+checks);
 }
 static final class Fixture {
  final File files;final VoiceAnswerSession draft;final Path directory,manifest,wire,pcm;final byte[] originalManifest,originalWire,originalPcm;
  Fixture(File files)throws Exception{
   this.files=files;draft=VoiceAnswerTest.prepared(new VoiceAnswerTest.Memory(),VoiceAnswerTest.connection("evidence-original"));VoiceAnswerTest.arm(draft);
   yes(draft.result(draft.token(),VoiceAnswerTest.PEER,1,1,1,"请只预览，不执行。",true,1100));
   yes(draft.result(draft.token(),VoiceAnswerTest.PEER,1,2,1,"保留原音和全部条件。\n预算不超过200元。",true,1200));VoiceAnswerTest.stopped(draft,1);
   try(VoiceAudioArchive archive=new VoiceAudioArchive(files,draft.token(),14)){
    byte[] decoded=new byte[640];decoded[1]=(byte)128;decoded[2]=42;
    archive.original(new byte[]{1,2,3});archive.decodedRecording(decoded);
    archive.original(new byte[]{4,5});archive.decodedRecording(decoded);
    archive.recordingComplete(draft.token(),480,2);yes(Boolean.TRUE.equals(WireJson.map(archive.seal(draft)).get("complete")));
   }
   directory=new File(files,"voice-audio/"+draft.token()).toPath();manifest=directory.resolve("source.json");wire=directory.resolve("original.frames");pcm=directory.resolve("decoded.pcm");
   originalManifest=Files.readAllBytes(manifest);originalWire=Files.readAllBytes(wire);originalPcm=Files.readAllBytes(pcm);
  }
  void verify()throws Exception{VoiceAnswerEvidence.verify(files,draft);}
  void mutate(Mutation mutation)throws Exception{Map<String,Object> value=WireJson.map(WireJson.read(originalManifest));mutation.apply(value);try{Files.write(manifest,WireJson.bytes(value));rejects(this::verify);}finally{Files.write(manifest,originalManifest);}}
  void raw(byte[] value)throws Exception{try{Files.write(manifest,value);rejects(this::verify);}finally{Files.write(manifest,originalManifest);}}
  void data(Path file,byte[] bytes,boolean fixHash)throws Exception{
   byte[] original=file.equals(wire)?originalWire:originalPcm;
   try{Files.write(file,bytes);if(fixHash){Map<String,Object> value=WireJson.map(WireJson.read(originalManifest));value.put(file.equals(wire)?"wire_sha256":"pcm_sha256",TaskWire.hash(bytes));value.put(file.equals(wire)?"wire_bytes":"pcm_bytes",bytes.length);Files.write(manifest,WireJson.bytes(value));}rejects(this::verify);}
   finally{Files.write(file,original);Files.write(manifest,originalManifest);}
  }
 }
 static void links(Fixture fixture,Path original)throws Exception{
  Path retained=original.resolveSibling(original.getFileName()+"-retained");Files.move(original,retained);boolean made=false;
  try{
   try{Files.createSymbolicLink(original,retained.toAbsolutePath());made=true;}catch(UnsupportedOperationException|FileSystemException unsupported){linkSkips++;return;}
   rejects(fixture::verify);
  }finally{if(made)Files.delete(original);Files.move(retained,original);}
 }
 static void run(File root)throws Exception{
  File files=new File(root,"voice-evidence-"+UUID.randomUUID().toString());Fixture f=new Fixture(files);f.verify();checks++;
  // Edits are independently saved answers; source hashes bind the original multi-sentence transcript.
  yes(f.draft.edit("请仅保存新的完整修订，原转写仍保留。"));f.verify();checks++;
  for(String field:new String[]{"sealed","complete","recording_source_complete"})f.mutate(m->m.put(field,false));
  for(String field:new String[]{"schema","business","frames","decoded_frames","wire_bytes","pcm_bytes","samples","nonzero_samples","peak"})f.mutate(m->m.put(field,0));
  for(String field:new String[]{"wire_format","pcm_format","token","wire_sha256","pcm_sha256"})f.mutate(m->m.put(field,"wrong"));
  f.mutate(m->m.put("unknown",true));f.mutate(m->m.remove("samples"));f.mutate(m->m.put("schema","1"));f.mutate(m->m.put("business",13));
  f.mutate(m->m.put("frames",3));f.mutate(m->m.put("decoded_frames",3));f.mutate(m->m.put("nonzero_samples",1));f.mutate(m->m.put("peak",42));
  for(String key:new String[]{"binding","request_id","task_id","request_fingerprint","asr_task","transcript_sha256"})f.mutate(m->WireJson.map(m.get("source")).put(key,"unrelated"));
  f.mutate(m->WireJson.map(m.get("source")).put("request_revision",2));f.mutate(m->WireJson.map(m.get("source")).put("extra",true));
  f.mutate(m->WireJson.map(m.get("source")).put("transcript_sha256",TaskWire.hash(f.draft.answerText().getBytes(StandardCharsets.UTF_8))));
  String json=new String(f.originalManifest,StandardCharsets.UTF_8);f.raw(json.replace("\"schema\":1","\"schema\":1,\"schema\":1").getBytes(StandardCharsets.UTF_8));
  f.raw(new byte[]{(byte)0xff});f.raw("{} trailing".getBytes(StandardCharsets.UTF_8));f.raw(new byte[65537]);
  f.data(f.wire,Arrays.copyOf(f.originalWire,f.originalWire.length-1),false);
  f.data(f.pcm,Arrays.copyOf(f.originalPcm,f.originalPcm.length-1),true);
  byte[] altered=f.originalPcm.clone();altered[20]=1;f.data(f.pcm,altered,false);
  f.data(f.pcm,new byte[f.originalPcm.length],true);
  byte[] invalidWire=f.originalWire.clone();invalidWire[0]=(byte)255;f.data(f.wire,invalidWire,true);
  invalidWire=f.originalWire.clone();invalidWire[3]=0;f.data(f.wire,invalidWire,true);
  f.data(f.wire,Arrays.copyOf(f.originalWire,3),true);
  for(Path missing:new Path[]{f.manifest,f.wire,f.pcm}){Path held=missing.resolveSibling(missing.getFileName()+"-held");Files.move(missing,held);try{rejects(f::verify);}finally{Files.move(held,missing);}}
  for(String name:new String[]{"source.json.partial","original.frames.partial","decoded.pcm.partial"}){Path partial=f.directory.resolve(name);Files.write(partial,new byte[]{1});try{rejects(f::verify);}finally{Files.delete(partial);}}
  Path partialDirectory=f.directory.resolve("source.json.partial");Files.createDirectory(partialDirectory);try{rejects(f::verify);}finally{Files.delete(partialDirectory);}
  try(RandomAccessFile oversized=new RandomAccessFile(f.wire.toFile(),"rw")){oversized.setLength(8388609);}
  try{rejects(f::verify);}finally{Files.write(f.wire,f.originalWire);}
  try(RandomAccessFile oversized=new RandomAccessFile(f.pcm.toFile(),"rw")){oversized.setLength(2097153);}
  try{rejects(f::verify);}finally{Files.write(f.pcm,f.originalPcm);}
  links(f,f.manifest);links(f,f.wire);links(f,f.directory);links(f,f.directory.getParent());f.verify();checks++;
  VoiceAnswerSession prepared=VoiceAnswerTest.prepared(new VoiceAnswerTest.Memory(),VoiceAnswerTest.connection("evidence-other"));rejects(()->VoiceAnswerEvidence.verify(files,prepared));
  VoiceAnswerSession other=VoiceArchiveTest.review();rejects(()->VoiceAnswerEvidence.verify(files,other));
  VoiceAnswerTest.Memory blocked=new VoiceAnswerTest.Memory();Map<String,Object> invalid=WireJson.map(f.draft.snapshot());invalid.put("engine_stopped",false);blocked.value=invalid;rejects(()->VoiceAnswerEvidence.verify(files,new VoiceAnswerSession(blocked)));
  yes(f.draft.cancelDraft(5000));rejects(f::verify);
 }
 public static void main(String[] args)throws Exception{run(new File(args[0]));System.out.println("Voice answer evidence: "+checks+" synthetic assertions passed; unsupported symbolic-link fixtures: "+linkSkips);}
}
