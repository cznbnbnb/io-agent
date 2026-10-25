package com.turboio.addon;

import java.io.*;import java.nio.file.*;import java.security.*;import java.util.*;

/** Private original wire + PCM source, fsynced before a completed source manifest is published. */
final class VoiceAudioArchive implements AutoCloseable {
 private final String token;private final int business;private final File directory;private final AtomicDocument manifest;
 private FileOutputStream wire,pcm;private String wireDigest,pcmDigest;private Object frozenSource;
 private long wireBytes,pcmBytes,frames,decodedFrames,samples,nonzero,peak;private boolean failed,closed,sealed,freezing,recordingComplete;
 VoiceAudioArchive(File files,String token,int business)throws Exception{
  if(token==null||!token.matches("[a-f0-9]{32}")||(business!=13&&business!=14))throw new IOException("VOICE_OWNER_INVALID");this.token=token;this.business=business;
  directory=new File(files,"voice-audio/"+token);if(directory.exists()||!directory.mkdirs())throw new IOException("VOICE_AUDIO_EXISTS");
  manifest=new AtomicDocument(new File(directory,"source.json"));
  try{manifest.save(record(false,false,null));wire=new FileOutputStream(new File(directory,"original.frames"));pcm=new FileOutputStream(new File(directory,"decoded.pcm"));}
  catch(Exception error){failed=true;closeStreams();manifest.close();throw error;}
 }
 private Map<String,Object> record(boolean sealed,boolean complete,Object source){return WireJson.object("schema",1,"token",token,"business",business,"sealed",sealed,"complete",complete,"recording_source_complete",recordingComplete,"wire_format","u32be_length_then_original_rnlink_envelope","pcm_format","s16le_mono_16000","frames",frames,"decoded_frames",decodedFrames,"wire_bytes",sealed?new File(directory,"original.frames").length():wireBytes,"pcm_bytes",sealed?new File(directory,"decoded.pcm").length():pcmBytes,"samples",samples,"nonzero_samples",nonzero,"peak",peak,"wire_sha256",sealed?wireDigest:null,"pcm_sha256",sealed?pcmDigest:null,"source",source);}
 private static String hex(byte[] raw){StringBuilder s=new StringBuilder();for(byte b:raw)s.append(String.format(Locale.ROOT,"%02x",b&255));return s.toString();}
 synchronized void original(byte[] envelope)throws IOException{
  if(closed||sealed||freezing)throw new IOException("VOICE_AUDIO_CLOSED");
  if(failed||frames!=decodedFrames||envelope==null||envelope.length==0||envelope.length>16384||frames>=8192||wireBytes+envelope.length+4>8388608){failed=true;throw new IOException("VOICE_AUDIO_BUDGET_OR_ORDER");}
  recordingComplete=false;
  byte[] length=new byte[]{(byte)(envelope.length>>>24),(byte)(envelope.length>>>16),(byte)(envelope.length>>>8),(byte)envelope.length};
  try{wire.write(length);wire.write(envelope);wireBytes+=4+envelope.length;frames++;}
  catch(IOException error){failed=true;throw error;}
 }
 synchronized void decoded(byte[] bytes)throws IOException{
  decoded(bytes,false);
 }
 /** A recording-service message may contain a partial/repeated packet, or close an
  * earlier gap and release many Opus frames. Keep exactly one archive pairing per
  * original RNLink message without pretending message boundaries are codec frames. */
 synchronized void decodedRecording(byte[] bytes)throws IOException{
  if(business!=14)throw new IOException("VOICE_SOURCE_MISMATCH");decoded(bytes,true);
 }
 synchronized boolean matches(String owner,int expectedBusiness){return !closed&&!sealed&&!freezing&&!failed&&token.equals(owner)&&business==expectedBusiness;}
 synchronized void incomplete(){failed=true;}
 synchronized void recordingComplete(String owner,int opusBytes,int packets)throws IOException{
  if(!matches(owner,14)||packets<=0||packets>RecordingVoiceSource.MAX_PACKETS||opusBytes!=packets*240||pcmBytes!=packets*640L||frames!=decodedFrames)throw new IOException("VOICE_RECORDING_INCOMPLETE");recordingComplete=true;
 }
 private void decoded(byte[] bytes,boolean recording)throws IOException{
  if(closed||sealed||freezing)throw new IOException("VOICE_AUDIO_CLOSED");
  if(failed||frames!=decodedFrames+1||bytes==null||(!recording&&bytes.length==0)||bytes.length>(recording?1024000:8192)||bytes.length%2!=0||pcmBytes+bytes.length>2097152){failed=true;throw new IOException("VOICE_AUDIO_BUDGET_OR_ORDER");}
  try{pcm.write(bytes);pcmBytes+=bytes.length;for(int i=0;i<bytes.length;i+=2){int value=(short)((bytes[i]&255)|(bytes[i+1]<<8));samples++;if(value!=0)nonzero++;peak=Math.max(peak,Math.abs(value));}decodedFrames++;}
  catch(IOException error){failed=true;throw error;}
 }
 synchronized Object seal(CaptureSession session)throws Exception{
  if(closed||sealed)throw new IOException("VOICE_AUDIO_CLOSED");Map<String,Object> draft=WireJson.map(session.snapshot());
  if(!token.equals(draft.get("token")))throw new IOException("VOICE_SOURCE_MISMATCH");
  boolean complete=session.healthy()&&!Boolean.TRUE.equals(draft.get("needs_stop"))&&TaskWire.set("REVIEW","SUBMITTING","SAVED").contains(draft.get("phase"))&&frames>0&&frames==decodedFrames&&samples>0&&nonzero>0&&!failed&&(business!=14||recordingComplete);
  Map<String,Object> target=WireJson.map(draft.get("target"));Map<String,Object> original=WireJson.map(target.get("request"));
  StringJoiner text=new StringJoiner("\n");for(Object raw:WireJson.list(draft.get("segments")))text.add((String)WireJson.map(raw).get("text"));
  Object source=WireJson.object("binding",target.get("binding"),"request_id",original.get("object_id"),"request_revision",original.get("revision"),"task_id",TaskWire.body(original).get("task_id"),"request_fingerprint",target.get("fingerprint"),"asr_task","io_agent_asr_"+token,"transcript_sha256",TaskWire.hash(text.toString().getBytes(java.nio.charset.StandardCharsets.UTF_8)));
  if(frozenSource!=null&&!TaskWire.same(frozenSource,source))throw new IOException("VOICE_SOURCE_MISMATCH");
  try{if(!freezing){freezing=true;frozenSource=WireJson.copy(source);try{wire.getFD().sync();pcm.getFD().sync();}finally{closeStreams();}}
   // Hash actual retained bytes, including any partial I/O from a failed frame. Cache each
   // digest so retrying a failed manifest write never turns it into the empty-file hash.
   if(wireDigest==null)wireDigest=digest(new File(directory,"original.frames"));if(pcmDigest==null)pcmDigest=digest(new File(directory,"decoded.pcm"));
   Map<String,Object> record=record(true,complete&&!failed,frozenSource);manifest.save(record);sealed=true;return WireJson.copy(record);}
  catch(Exception error){failed=true;throw error;}
 }
 private static String digest(File file)throws Exception{MessageDigest hash=MessageDigest.getInstance("SHA-256");try(InputStream in=new FileInputStream(file)){byte[] block=new byte[8192];int n;while((n=in.read(block))!=-1)hash.update(block,0,n);}return hex(hash.digest());}
 private void closeStreams(){try{if(wire!=null)wire.close();}catch(IOException ignored){}try{if(pcm!=null)pcm.close();}catch(IOException ignored){}}
 public synchronized void close()throws IOException{if(!closed){closeStreams();manifest.close();closed=true;}}
}
