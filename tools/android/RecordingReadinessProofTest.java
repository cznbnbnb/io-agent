package com.turboio.androidtests;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.*;

/** Synthetic map admission tests only; never authorizes real device readiness. */
public final class RecordingReadinessProofTest {
 private static final String ATTEMPT="0123456789abcdef0123456789abcdef",TOKEN="abcdef0123456789abcdef0123456789",HASH=String.join("",Collections.nCopies(64,"a")),PEER=String.join("",Collections.nCopies(64,"b"));
 private static final String FIRST="先做预览，不要修改文件。",SECOND="附加条件：保留全部资料，到星期五再确认。";private static int checks;
 private static Map<String,Object> map(Object... pairs){Map<String,Object> out=new LinkedHashMap<>();for(int i=0;i<pairs.length;i+=2)out.put((String)pairs[i],pairs[i+1]);return out;}
 private static String sha(String text)throws Exception{StringBuilder out=new StringBuilder();for(byte b:MessageDigest.getInstance("SHA-256").digest(text.getBytes(StandardCharsets.UTF_8)))out.append(String.format(Locale.ROOT,"%02x",b&255));return out.toString();}
 private static final class Fixture {
  final Map<String,Object> capture=map("schema",1L,"probe_id",ATTEMPT,"mode","capture","error","","audio_frames",4L,"decoded_bytes",2560L,"asr_pcm_bytes",2560L,"pcm_peak",42L);
  final Map<String,Object> first=map("index",1L,"revision",2L,"text",FIRST,"final",true),second=map("index",2L,"revision",1L,"text",SECOND,"final",true);
  final Map<String,Object> request=map("kind","request","object_id","request-one","revision",1L,"body",map("task_id","task-one","route",map("session_id","original-session")));
  final Map<String,Object> target=map("binding",HASH,"fingerprint",HASH,"request",request);
  final Map<String,Object> draft=map("schema",1L,"phase","REVIEW","error","","needs_stop",false,"cancelled",false,"engine_end",true,"engine_stopped",true,"device_stopped",true,"frozen_text",null,"generation",3L,"deadline",16000L,"stop_at",9000L,"stop_sent",9001L,"token",TOKEN,"peer",PEER,"target",target,"segments",Arrays.asList(first,second));
  final Map<String,Object> source=map("binding",HASH,"request_id","request-one","request_revision",1L,"task_id","task-one","request_fingerprint",HASH,"asr_task","io_agent_asr_"+TOKEN);
  final Map<String,Object> manifest=map("schema",1L,"business",14L,"token",TOKEN,"sealed",true,"complete",true,"recording_source_complete",true,"wire_format","u32be_length_then_original_rnlink_envelope","pcm_format","s16le_mono_16000","frames",4L,"decoded_frames",4L,"wire_bytes",1000L,"pcm_bytes",2560L,"samples",1280L,"nonzero_samples",1200L,"peak",42L,"wire_sha256",HASH,"pcm_sha256",HASH,"source",source);
  Fixture()throws Exception{for(String key:TRUE_FLAGS)capture.put(key,true);for(String key:FALSE_FLAGS)capture.put(key,false);source.put("transcript_sha256",sha(FIRST+"\n"+SECOND));}
  Map<String,Object> create(){return RecordingReadinessProof.create(capture,draft,manifest,ATTEMPT);}
 }
 private static final String[] TRUE_FLAGS={"armed","preflight_passed","preflight_fresh_idle_verified","stop_accepted","device_idle_verified","native_start_attempted","native_stopped_verified","native_released","recording_released","coordinator_released","answer_ready","safe_to_disarm","physical_capture_requested","expected_preview_retained","expected_no_file_change_retained","expected_keep_materials_retained","expected_friday_retained"};
 private static final String[] FALSE_FLAGS={"readiness_created","task_or_answer_submitted","synthetic_only_claimed"};
 private interface Change {void apply(Fixture f)throws Exception;}
 private static void yes(boolean ok){checks++;if(!ok)throw new AssertionError("Readiness check "+checks);}
 private static void denied(Change change)throws Exception{Fixture f=new Fixture();change.apply(f);try{f.create();throw new AssertionError("Invalid evidence admitted");}catch(IllegalArgumentException expected){yes(expected.getMessage().matches("READINESS_[A-Z_]+"));}}
 public static void main(String[] args)throws Exception{
  Fixture good=new Fixture();Map<String,Object> proof=good.create();yes(proof.size()==9);yes(proof.get("peer_hash").equals(PEER));yes(proof.get("evidence_id").equals(ATTEMPT));yes(proof.get("firmware").equals("Strix OS 1.0.5.5"));yes(Boolean.TRUE.equals(proof.get("device_stop_verified")));yes(!good.capture.containsKey("peer_hash"));
  good.capture.put("error","VOICE_DEVICE_NOT_IDLE");yes(good.create().equals(proof));
  for(String key:TRUE_FLAGS)for(Object bad:new Object[]{false,null,"true"})denied(f->{if(bad==null)f.capture.remove(key);else f.capture.put(key,bad);});
  for(String key:FALSE_FLAGS)for(Object bad:new Object[]{true,null,"false"})denied(f->{if(bad==null)f.capture.remove(key);else f.capture.put(key,bad);});
  for(String error:new String[]{"VOICE_STOP_UNCONFIRMED","VOICE_DEVICE_NOT_IDLE ","VOICE_ENGINE_ERROR","PROBE_REPORT_FAILED","unknown"})denied(f->f.capture.put("error",error));denied(f->f.capture.remove("error"));
  denied(f->f.capture.put("probe_id",TOKEN));denied(f->f.capture.put("mode","preflight"));denied(f->f.capture.put("schema",2L));
  for(String key:new String[]{"audio_frames","decoded_bytes","asr_pcm_bytes","pcm_peak"})for(Object bad:new Object[]{0L,3L,2.0,null})denied(f->f.capture.put(key,bad));
  for(String key:new String[]{"needs_stop","cancelled"})denied(f->f.draft.put(key,true));
  for(String key:new String[]{"engine_end","engine_stopped","device_stopped"})denied(f->{f.capture.put("error","VOICE_DEVICE_NOT_IDLE");f.draft.put(key,false);});
  for(String phase:new String[]{"RECOVERY","INCOMPLETE","SUBMITTING","SAVED"})denied(f->f.draft.put("phase",phase));
  denied(f->f.draft.put("error","VOICE_DEVICE_NOT_IDLE"));denied(f->f.draft.put("peer","not-a-peer"));denied(f->f.draft.put("peer",HASH.toUpperCase(Locale.ROOT)));denied(f->f.draft.put("stop_at",0L));denied(f->f.draft.put("stop_sent",8999L));denied(f->f.draft.put("frozen_text","submitted"));denied(f->f.draft.put("generation",0L));
  for(String key:new String[]{"sealed","complete","recording_source_complete"})denied(f->f.manifest.put(key,false));
  denied(f->f.manifest.put("token",ATTEMPT));denied(f->f.manifest.put("business",13L));denied(f->f.manifest.put("wire_format","raw"));denied(f->f.manifest.put("pcm_format","s16le_stereo_16000"));
  for(String key:new String[]{"frames","decoded_frames","wire_bytes","pcm_bytes","samples","nonzero_samples","peak"})denied(f->f.manifest.put(key,0L));
  denied(f->f.manifest.put("wire_bytes",19L));denied(f->f.manifest.put("samples",1281L));denied(f->f.manifest.put("nonzero_samples",1281L));denied(f->f.manifest.put("peak",32769L));denied(f->f.manifest.put("decoded_frames",3L));denied(f->f.manifest.put("pcm_sha256","unknown"));
  denied(f->f.second.put("final",false));denied(f->f.second.put("index",3L));denied(f->f.second.put("revision",0L));denied(f->f.second.put("text"," "));denied(f->f.draft.put("segments",Collections.emptyList()));
  for(String omitted:new String[]{"预览","不要修改文件","保留全部资料","星期五"})denied(f->{f.first.put("text",FIRST.replace(omitted,""));f.second.put("text",SECOND.replace(omitted,""));f.source.put("transcript_sha256",sha(f.first.get("text")+"\n"+f.second.get("text")));});
  for(String key:new String[]{"binding","request_id","task_id","request_fingerprint","asr_task","transcript_sha256"})denied(f->f.source.put(key,"wrong"));denied(f->f.source.put("request_revision",2L));denied(f->f.target.put("binding",PEER));denied(f->f.target.put("fingerprint",PEER));
  Fixture friday=new Fixture();friday.second.put("text",SECOND.replace("星期五","周五"));friday.source.put("transcript_sha256",sha(FIRST+"\n"+friday.second.get("text")));yes(friday.create().size()==9);
  System.out.println("Recording readiness proof: "+checks+" checks passed (synthetic maps only; no readiness file created)");
 }
}
