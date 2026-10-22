package com.turboio.androidtests;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.*;

/** Diagnostic evidence join only; no IO and no device admission by itself.
 * Caller MUST first run the installed product's VoiceAnswerEvidence.verify on
 * these exact retained draft/source files, including actual wire/PCM hashes.
 * Maps cannot establish file provenance, the current connected peer, or native
 * state. The caller must also pin the installed host/firmware independently. */
public final class RecordingReadinessProof {
 private RecordingReadinessProof(){}
 private static final String HOST="48ffd34352bf23eca928ad9c2f576347c4965a5af5ca05a35c1f1ed2ffc9fd50";
 private static final String[] TRUE_FLAGS={"armed","preflight_passed","preflight_fresh_idle_verified","stop_accepted","device_idle_verified","native_start_attempted","native_stopped_verified","native_released","recording_released","coordinator_released","answer_ready","safe_to_disarm","physical_capture_requested","expected_preview_retained","expected_no_file_change_retained","expected_keep_materials_retained","expected_friday_retained"};
 private static void require(boolean value,String code){if(!value)throw new IllegalArgumentException("READINESS_"+code);}
 private static void flag(Map<?,?> map,String key,boolean value){require(Boolean.valueOf(value).equals(map.get(key)),"FLAG_INVALID");}
 private static long number(Map<?,?> map,String key){Object value=map.get(key);require(value instanceof Long||value instanceof Integer,"NUMBER_INVALID");long n=((Number)value).longValue();require(n>=0,"NUMBER_INVALID");return n;}
 private static String text(Map<?,?> map,String key,String regex){Object value=map.get(key);require(value instanceof String&&((String)value).matches(regex),"TEXT_INVALID");return (String)value;}
 private static Map<?,?> map(Object value){require(value instanceof Map,"MAP_INVALID");return (Map<?,?>)value;}
 private static String sha(String text){try{StringBuilder out=new StringBuilder();for(byte b:MessageDigest.getInstance("SHA-256").digest(text.getBytes(StandardCharsets.UTF_8)))out.append(String.format(Locale.ROOT,"%02x",b&255));return out.toString();}catch(Exception e){throw new IllegalArgumentException("READINESS_HASH_UNAVAILABLE");}}
 public static Map<String,Object> create(Map<?,?> capture,Map<?,?> draft,Map<?,?> manifest,String attemptId){
  require(capture!=null&&draft!=null&&manifest!=null,"MAP_INVALID");require(attemptId!=null&&attemptId.matches("[a-f0-9]{32}")&&attemptId.equals(capture.get("probe_id")),"ATTEMPT_MISMATCH");
  require(number(capture,"schema")==1&&"capture".equals(capture.get("mode")),"CAPTURE_INVALID");
  for(String name:TRUE_FLAGS)flag(capture,name,true);
  for(String name:new String[]{"readiness_created","task_or_answer_submitted","synthetic_only_claimed"})flag(capture,name,false);
  Object error=capture.get("error");require("".equals(error)||"VOICE_DEVICE_NOT_IDLE".equals(error),"CAPTURE_ERROR");
  require(number(draft,"schema")==1&&"REVIEW".equals(draft.get("phase"))&&"".equals(draft.get("error")),"DRAFT_NOT_READY");
  for(String name:new String[]{"needs_stop","cancelled"})flag(draft,name,false);
  for(String name:new String[]{"engine_end","engine_stopped","device_stopped"})flag(draft,name,true);
  require(draft.get("frozen_text")==null&&number(draft,"generation")>0&&number(draft,"deadline")>0,"DRAFT_NOT_READY");
  long stopAt=number(draft,"stop_at"),stopSent=number(draft,"stop_sent");require(stopAt>0&&stopSent>=stopAt,"STOP_ORDER_INVALID");
  String token=text(draft,"token","[a-f0-9]{32}"),peer=text(draft,"peer","[a-f0-9]{64}");
  require(number(manifest,"schema")==1&&number(manifest,"business")==14&&token.equals(manifest.get("token")),"ARCHIVE_OWNER_INVALID");
  for(String name:new String[]{"sealed","complete","recording_source_complete"})flag(manifest,name,true);
  require("u32be_length_then_original_rnlink_envelope".equals(manifest.get("wire_format"))&&"s16le_mono_16000".equals(manifest.get("pcm_format")),"ARCHIVE_FORMAT_INVALID");
  long frames=number(manifest,"frames"),pcm=number(manifest,"pcm_bytes"),wire=number(manifest,"wire_bytes"),samples=number(manifest,"samples"),nonzero=number(manifest,"nonzero_samples"),peak=number(manifest,"peak");
  require(frames>0&&frames<=8192&&number(manifest,"decoded_frames")==frames&&wire>=frames*5&&wire<=Math.min(8388608L,frames*16388L),"ARCHIVE_FRAMES_INVALID");
  require(pcm>0&&pcm<=1024000&&pcm%640==0&&samples==pcm/2&&nonzero>0&&nonzero<=samples&&peak>0&&peak<=32768,"ARCHIVE_PCM_INVALID");
  text(manifest,"wire_sha256","[a-f0-9]{64}");text(manifest,"pcm_sha256","[a-f0-9]{64}");
  require(number(capture,"audio_frames")==frames&&number(capture,"decoded_bytes")==pcm&&number(capture,"asr_pcm_bytes")==pcm&&number(capture,"pcm_peak")==peak,"CAPTURE_ARCHIVE_MISMATCH");
  Object raw=draft.get("segments");require(raw instanceof List,"TRANSCRIPT_INVALID");List<?> segments=(List<?>)raw;require(!segments.isEmpty()&&segments.size()<=64,"TRANSCRIPT_INVALID");StringJoiner joined=new StringJoiner("\n");int index=0;
  for(Object item:segments){Map<?,?> segment=map(item);flag(segment,"final",true);require(number(segment,"index")==++index&&number(segment,"revision")>0,"TRANSCRIPT_INVALID");Object words=segment.get("text");require(words instanceof String&&!((String)words).trim().isEmpty()&&((String)words).length()<=65536,"TRANSCRIPT_INVALID");joined.add((String)words);}
  String full=joined.toString();require(full.length()<=65536&&full.contains("预览")&&full.contains("不要修改文件")&&full.contains("保留全部资料")&&(full.contains("星期五")||full.contains("周五")),"TRANSCRIPT_CONDITIONS_MISSING");
  Map<?,?> source=map(manifest.get("source")),target=map(draft.get("target")),request=map(target.get("request")),body=map(request.get("body"));
  String binding=text(target,"binding","[a-f0-9]{64}"),fingerprint=text(target,"fingerprint","[a-f0-9]{64}");
  require("request".equals(request.get("kind"))&&binding.equals(source.get("binding"))&&fingerprint.equals(source.get("request_fingerprint"))&&request.get("object_id") instanceof String&&request.get("object_id").equals(source.get("request_id"))&&body.get("task_id") instanceof String&&body.get("task_id").equals(source.get("task_id"))&&number(request,"revision")>0&&number(request,"revision")==number(source,"request_revision")&&("io_agent_asr_"+token).equals(source.get("asr_task"))&&sha(full).equals(source.get("transcript_sha256")),"ARCHIVE_TARGET_MISMATCH");
  Map<String,Object> result=new LinkedHashMap<>();result.put("format","io-agent-voice-source-readiness/1");result.put("host_lib_sha256",HOST);result.put("firmware","Strix OS 1.0.5.5");result.put("source_profile","recording-opus240-pcm16k-mono");result.put("peer_hash",peer);result.put("evidence_id",attemptId);result.put("source_audio_verified",true);result.put("decoder_verified",true);result.put("device_stop_verified",true);return Collections.unmodifiableMap(result);
 }
}
