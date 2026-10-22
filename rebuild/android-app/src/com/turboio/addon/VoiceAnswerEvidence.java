package com.turboio.addon;

import java.io.*;import java.nio.*;import java.nio.channels.*;import java.nio.charset.StandardCharsets;import java.nio.file.*;import java.nio.file.attribute.BasicFileAttributes;import java.util.*;

/** Read-only admission for a first voice answer. A REVIEW journal alone is not
 * proof that its source files finished sealing before a process interruption. */
final class VoiceAnswerEvidence {
 private static final Set<String> FIELDS=TaskWire.set("schema","token","business","sealed","complete","recording_source_complete","wire_format","pcm_format","frames","decoded_frames","wire_bytes","pcm_bytes","samples","nonzero_samples","peak","wire_sha256","pcm_sha256","source");
 private static final Set<String> SOURCE=TaskWire.set("binding","request_id","request_revision","task_id","request_fingerprint","asr_task","transcript_sha256");
 private static final class Invalid extends IOException {Invalid(String code){super(code);}}
 private static void require(boolean value,String code)throws Invalid{if(!value)throw new Invalid(code);}
 static void verify(File files,VoiceAnswerSession draft)throws Exception{
  try{
   require(files!=null&&draft!=null&&draft.healthy()&&"REVIEW".equals(draft.phase())&&!draft.needsStop(),"VOICE_ARCHIVE_DRAFT_NOT_READY");
   Map<String,Object> state=WireJson.map(draft.snapshot());String token=(String)state.get("token");
   require(token!=null&&token.matches("[a-f0-9]{32}"),"VOICE_ARCHIVE_OWNER_INVALID");
   Path input=files.toPath().toAbsolutePath().normalize();require(!Files.isSymbolicLink(input)&&Files.isDirectory(input,LinkOption.NOFOLLOW_LINKS),"VOICE_ARCHIVE_PATH_INVALID");
   Path root=input.toRealPath(),base=checked(root,root.resolve("voice-audio"),true),directory=checked(root,base.resolve(token),true);
   noPartial(directory);Path manifest=checked(root,directory.resolve("source.json"),false);
   byte[] raw=read(root,manifest,65536);Map<String,Object> record=WireJson.map(WireJson.read(raw,65536,256));
   require(record.keySet().equals(FIELDS),"VOICE_ARCHIVE_FIELDS_INVALID");
   require(TaskWire.positive(record.get("schema"))==1&&TaskWire.positive(record.get("business"))==14&&token.equals(record.get("token")),"VOICE_ARCHIVE_OWNER_INVALID");
   require(Boolean.TRUE.equals(record.get("sealed"))&&Boolean.TRUE.equals(record.get("complete"))&&Boolean.TRUE.equals(record.get("recording_source_complete")),"VOICE_ARCHIVE_INCOMPLETE");
   require("u32be_length_then_original_rnlink_envelope".equals(record.get("wire_format"))&&"s16le_mono_16000".equals(record.get("pcm_format")),"VOICE_ARCHIVE_FORMAT_INVALID");
   Map<String,Object> source=WireJson.map(record.get("source")),target=WireJson.map(state.get("target")),request=TaskWire.object(target.get("request"));
   require(source.keySet().equals(SOURCE),"VOICE_ARCHIVE_FIELDS_INVALID");
   require(target.get("binding").equals(source.get("binding"))&&request.get("object_id").equals(source.get("request_id"))&&TaskWire.positive(request.get("revision"))==TaskWire.positive(source.get("request_revision"))&&TaskWire.body(request).get("task_id").equals(source.get("task_id"))&&target.get("fingerprint").equals(source.get("request_fingerprint"))&&("io_agent_asr_"+token).equals(source.get("asr_task")),"VOICE_ARCHIVE_TARGET_MISMATCH");
   StringJoiner transcript=new StringJoiner("\n");for(Object value:WireJson.list(state.get("segments"))){Map<String,Object> segment=WireJson.map(value);require(Boolean.TRUE.equals(segment.get("final")),"VOICE_ARCHIVE_TRANSCRIPT_INVALID");transcript.add((String)segment.get("text"));}
   require(!transcript.toString().trim().isEmpty()&&TaskWire.hash(transcript.toString().getBytes(StandardCharsets.UTF_8)).equals(source.get("transcript_sha256")),"VOICE_ARCHIVE_TRANSCRIPT_MISMATCH");
   byte[] wire=read(root,directory.resolve("original.frames"),8388608),pcm=read(root,directory.resolve("decoded.pcm"),2097152);
   require(TaskWire.positive(record.get("wire_bytes"))==wire.length&&TaskWire.positive(record.get("pcm_bytes"))==pcm.length,"VOICE_ARCHIVE_LENGTH_MISMATCH");
   require(TaskWire.hash(wire).equals(record.get("wire_sha256"))&&TaskWire.hash(pcm).equals(record.get("pcm_sha256")),"VOICE_ARCHIVE_HASH_MISMATCH");
   long frames=0;int offset=0;
   while(offset<wire.length){require(wire.length-offset>=4,"VOICE_ARCHIVE_WIRE_INVALID");long size=((wire[offset]&255L)<<24)|((wire[offset+1]&255L)<<16)|((wire[offset+2]&255L)<<8)|(wire[offset+3]&255L);offset+=4;require(size>0&&size<=16384&&size<=wire.length-offset,"VOICE_ARCHIVE_WIRE_INVALID");offset+=(int)size;frames++;require(frames<=8192,"VOICE_ARCHIVE_WIRE_INVALID");}
   require(frames>0&&frames==TaskWire.positive(record.get("frames"))&&frames==TaskWire.positive(record.get("decoded_frames")),"VOICE_ARCHIVE_FRAME_MISMATCH");
   // Recording completion covers 240-byte Opus packets, each decoded to 640
   // PCM bytes. RNLink envelope counts are deliberately not codec packet counts.
   require(pcm.length>0&&pcm.length%640==0&&pcm.length/640<=1600,"VOICE_ARCHIVE_PCM_INVALID");
   long nonzero=0,peak=0;for(int i=0;i<pcm.length;i+=2){int sample=(short)((pcm[i]&255)|(pcm[i+1]<<8));if(sample!=0)nonzero++;peak=Math.max(peak,Math.abs(sample));}
   require(pcm.length/2==TaskWire.positive(record.get("samples"))&&nonzero>0&&nonzero==TaskWire.positive(record.get("nonzero_samples"))&&peak==TaskWire.positive(record.get("peak")),"VOICE_ARCHIVE_PCM_MISMATCH");
   noPartial(directory);checked(root,base,true);checked(root,directory,true);
   require(Arrays.equals(raw,read(root,manifest,65536)),"VOICE_ARCHIVE_CHANGED");
   require(draft.healthy()&&"REVIEW".equals(draft.phase())&&!draft.needsStop()&&TaskWire.same(state,draft.snapshot()),"VOICE_ARCHIVE_DRAFT_CHANGED");
  }catch(Invalid invalid){throw invalid;}catch(Exception invalid){throw new IOException("VOICE_ARCHIVE_INVALID");}
 }
 private static Path checked(Path root,Path file,boolean directory)throws Exception{
  Path normalized=file.toAbsolutePath().normalize();require(normalized.startsWith(root)&&!normalized.equals(root),"VOICE_ARCHIVE_PATH_INVALID");
  Path at=root;for(Path component:root.relativize(normalized)){at=at.resolve(component);require(!Files.isSymbolicLink(at),"VOICE_ARCHIVE_PATH_INVALID");}
  require(normalized.toRealPath().equals(normalized),"VOICE_ARCHIVE_PATH_INVALID");
  BasicFileAttributes attributes=Files.readAttributes(normalized,BasicFileAttributes.class,LinkOption.NOFOLLOW_LINKS);
  require(directory?attributes.isDirectory():attributes.isRegularFile(),"VOICE_ARCHIVE_PATH_INVALID");return normalized;
 }
 private static void noPartial(Path directory)throws Exception{try(DirectoryStream<Path> entries=Files.newDirectoryStream(directory)){for(Path entry:entries)require(!entry.getFileName().toString().endsWith(".partial"),"VOICE_ARCHIVE_PARTIAL");}}
 private static byte[] read(Path root,Path path,int budget)throws Exception{
  Path file=checked(root,path,false);long before=Files.size(file);require(before>0&&before<=budget,"VOICE_ARCHIVE_BUDGET");
  ByteArrayOutputStream out=new ByteArrayOutputStream((int)before);ByteBuffer block=ByteBuffer.allocate(8192);
  try(SeekableByteChannel channel=Files.newByteChannel(file,StandardOpenOption.READ,LinkOption.NOFOLLOW_LINKS)){
   int n;while((n=channel.read(block))!=-1){require(out.size()+n<=budget,"VOICE_ARCHIVE_BUDGET");out.write(block.array(),0,n);block.clear();}
  }
  checked(root,file,false);require(out.size()==before&&Files.size(file)==before,"VOICE_ARCHIVE_CHANGED");return out.toByteArray();
 }
}
