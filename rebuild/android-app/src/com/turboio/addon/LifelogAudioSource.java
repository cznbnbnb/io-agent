package com.turboio.addon;

import java.io.*;import java.nio.file.*;import java.util.*;

/** One immutable source proof and read-only batches, shared by local/remote ZIP
 * export. No source is trusted merely because its receipt or catalog says so. */
abstract class LifelogAudioSource {
 interface Frames {void take(List<AlwaysOnAudioBatch.Frame> frames,long received)throws IOException;}
 static final class Summary {final long frames,samples,skipped,first,last;Summary(long f,long s,long u,long a,long z){frames=f;samples=s;skipped=u;first=a;last=z;}}
 private final Map<String,Object> proof,origin;final String account,material,stream,clock,task;final boolean strict;final long batches,firstSequence;
 LifelogAudioSource(Map<String,Object> value,Map<String,Object> origin,boolean strict)throws IOException{
  proof=WireJson.map(WireJson.copy(value));this.origin=WireJson.map(WireJson.copy(origin));this.strict=strict;account=(String)proof.get("account");material=(String)proof.get("material_id");stream=(String)proof.get("stream");clock=(String)proof.get("clock_epoch");task=(String)proof.get("task_sha256");batches=number(proof,"count");firstSequence=number(proof,"first_sequence");
  require(proof.keySet().equals(new HashSet<>(Arrays.asList("account","material_id","peer","generation","stream","clock_epoch","task_sha256","first_sequence","count","raw_bytes","chain")))&&account!=null&&account.matches("[a-f0-9]{64}")&&material!=null&&material.matches("rayneo-lifelog-[a-f0-9]{64}")&&stream!=null&&stream.matches("[a-f0-9]{32}")&&clock!=null&&clock.matches("[a-f0-9]{32}")&&task!=null&&task.matches("[a-f0-9]{64}")&&proof.get("peer") instanceof String&&((String)proof.get("peer")).matches("[a-f0-9]{64}")&&number(proof,"generation")>0&&firstSequence>0&&batches>0&&batches<=LifelogAudioArchive.MAX_RECORDS&&number(proof,"raw_bytes")>=8&&number(proof,"raw_bytes")<=LifelogAudioArchive.MAX_BYTES&&proof.get("chain") instanceof String&&((String)proof.get("chain")).matches("[a-f0-9]{64}"),"AUDIO_EXPORT_PROVENANCE");
 }
 static void require(boolean value,String code)throws IOException{LifelogAudioLibrary.require(value,code);}
 static long number(Map<String,Object> row,String key)throws IOException{return LifelogAudioLibrary.number(row,key);}
 Map<String,Object> proof(){return WireJson.map(WireJson.copy(proof));}Map<String,Object> origin(){return WireJson.map(WireJson.copy(origin));}
 String identity(){return account+":"+proof.get("peer")+":"+proof.get("generation")+":"+stream;}
 void current(LifelogAudioArchive.Guard guard)throws IOException{guard.check();}
 protected abstract void read(LifelogAudioArchive.Visitor visitor,LifelogAudioArchive.Guard guard)throws IOException;
 protected void range(long first,long last)throws IOException{}
 final Summary visit(Frames visitor,LifelogAudioArchive.Guard guard)throws IOException{
  current(guard);long[] total={0,0,0,Long.MAX_VALUE,0,0};read(batch->{current(guard);require(clock.equals(batch.metadata.get("clock_epoch")),"AUDIO_EXPORT_PROVENANCE");total[5]++;long at=number(batch.metadata,"received_at");total[3]=Math.min(total[3],at);total[4]=Math.max(total[4],at);
   if(!"A3".equals(batch.metadata.get("kind"))){require(!strict,"AUDIO_EXPORT_BATCH_UNSUPPORTED");total[2]++;return;}
   AlwaysOnAudioBatch parsed;try{byte[] bytes=batch.payload();AlwaysOnWire wire;try{wire=strict?AlwaysOnWire.readKnown(bytes):AlwaysOnWire.read(bytes);}finally{Arrays.fill(bytes,(byte)0);}require(wire.type==0xa3&&(!strict||wire.version==1)&&wire.message.equals(batch.metadata.get("message")),"AUDIO_EXPORT_PROVENANCE");parsed=AlwaysOnAudioBatch.parse(wire.message,wire.data());require(parsed.taskId!=null&&task.equals(LifelogAudioLibrary.hash(parsed.taskId))&&material.equals(LifelogAudioLibrary.material(account,parsed.taskId)),"AUDIO_EXPORT_PROVENANCE");require(!parsed.clamped&&parsed.unparsedBytes==0&&!parsed.frames.isEmpty(),"AUDIO_EXPORT_BATCH_UNSUPPORTED");}catch(IllegalArgumentException invalid){throw new IOException("AUDIO_EXPORT_BATCH_UNSUPPORTED");}
   for(AlwaysOnAudioBatch.Frame frame:parsed.frames){byte[] packet=frame.bytes();try{total[0]++;total[1]+=OpusFile.samples48(packet);}finally{Arrays.fill(packet,(byte)0);}}visitor.take(parsed.frames,at);
  },()->current(guard));require(total[5]==batches,"AUDIO_EXPORT_PROVENANCE");range(total[3],total[4]);current(guard);return new Summary(total[0],total[1],total[2],total[3],total[4]);
 }
 static Map<String,Object> proof(String material,Map<String,Object> context,Map<String,Object> snapshot,String task,long first)throws IOException{
  Map<String,Object> owner=WireJson.map(snapshot.get("owner"));return WireJson.object("account",context.get("account"),"material_id",material,"peer",context.get("peer"),"generation",context.get("generation"),"stream",owner.get("stream"),"clock_epoch",context.get("clock_epoch"),"task_sha256",task,"first_sequence",first,"count",snapshot.get("count"),"raw_bytes",snapshot.get("raw_bytes"),"chain",snapshot.get("chain"));
 }
 static List<LifelogAudioSource> local(File files,String account,String material,List<Object> sessions,List<Object> archives,LifelogAudioArchive.Guard guard)throws IOException{
  guard.check();require(account!=null&&account.matches("[a-f0-9]{64}")&&material!=null&&material.matches("rayneo-lifelog-[a-f0-9]{64}")&&sessions.size()<=256&&archives.size()<=256,"AUDIO_EXPORT_CONTEXT");Map<String,Map<String,Object>> selected=new HashMap<>();for(Object raw:sessions){Map<String,Object> row=WireJson.map(raw);if(material.equals(row.get("material_id"))&&Boolean.TRUE.equals(row.get("source_link_verified"))&&"opus".equals(row.get("format")))selected.put((String)row.get("clock_epoch"),row);}require(!selected.isEmpty(),"AUDIO_EXPORT_SOURCE_PENDING");List<LifelogAudioSource> result=new ArrayList<>();
  for(Object raw:archives){Map<String,Object> archive=WireJson.map(raw),context=WireJson.map(WireJson.copy(archive.get("context")));if(!account.equals(context.get("account")))continue;Map<String,Object> session=selected.get(context.get("clock_epoch"));if(session==null||!"sealed".equals(archive.get("phase"))||number(archive,"count")==0)continue;
   final String peer=(String)context.get("peer"),stream=(String)archive.get("stream");final long generation=number(context,"generation");require(stream!=null&&stream.matches("[a-f0-9]{32}")&&Objects.equals(peer,session.get("peer"))&&generation==number(session,"generation"),"AUDIO_EXPORT_PROVENANCE");File dir=new File(files.getCanonicalFile(),"lifelog-audio/"+account+"/"+stream);for(File f:new File[]{dir,new File(dir,"state.json"),new File(dir,"original.frames")})require(f.exists()&&!Files.isSymbolicLink(f.toPath())&&f.getAbsoluteFile().equals(f.getCanonicalFile()),"AUDIO_EXPORT_SOURCE_MISSING");
   Map<String,Object> snapshot;try(LifelogAudioArchive source=new LifelogAudioArchive(files,account,peer,generation,stream,guard)){snapshot=LifelogAudioArchive.copiedState(source.snapshot());}require(number(snapshot,"count")==number(archive,"count"),"AUDIO_EXPORT_PROVENANCE");final Map<String,Object> pinned=snapshot;
   result.add(new LifelogAudioSource(proof(material,context,snapshot,(String)session.get("task_sha256"),number(archive,"first_sequence")),WireJson.object("location","phone"),false){protected void read(LifelogAudioArchive.Visitor visitor,LifelogAudioArchive.Guard current)throws IOException{
    current.check();for(File f:new File[]{dir,new File(dir,"state.json"),new File(dir,"original.frames")})require(f.exists()&&!Files.isSymbolicLink(f.toPath())&&f.getAbsoluteFile().equals(f.getCanonicalFile()),"AUDIO_EXPORT_SOURCE_MISSING");try(LifelogAudioArchive source=new LifelogAudioArchive(files,account,peer,generation,stream,current)){require(Arrays.equals(WireJson.bytes(pinned),WireJson.bytes(source.snapshot())),"AUDIO_EXPORT_CHANGED");source.visit(visitor,current);}
   }});
  }return result;
 }
}
