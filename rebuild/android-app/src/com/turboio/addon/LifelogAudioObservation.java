package com.turboio.addon;

import java.nio.charset.StandardCharsets;
import java.security.*;
import java.util.*;

/** Bounded metadata, not audio storage or codec/source proof. No original message,
 * payload, transcription or clear device/task identity leaves accept(). */
final class LifelogAudioObservation {
 private final String process;private long packets,bytes,invalid,ignored,dropped,lastAt;
 private final Map<String,Long> kinds=new TreeMap<>();private final LinkedHashMap<String,Map<String,Object>> samples=new LinkedHashMap<>();
 LifelogAudioObservation(String process){if(process==null||!process.matches("[a-f0-9]{32}"))throw new IllegalArgumentException("AUDIO_OBSERVATION_PROCESS");this.process=process;}
 static String hash(String value){try{byte[] bytes=MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8));StringBuilder out=new StringBuilder();for(byte b:bytes){int n=b&255;out.append("0123456789abcdef".charAt(n>>>4)).append("0123456789abcdef".charAt(n&15));}return out.toString();}catch(NoSuchAlgorithmException impossible){throw new AssertionError(impossible);}}
 void dropped(long count){dropped+=count;}
 void accept(String peer,byte[] raw,long at,String account,long contextAt,Set<String> conversations){
  packets++;bytes+=raw.length;lastAt=at;
  try{
   AlwaysOnWire wire=AlwaysOnWire.read(raw);if(wire.type!=0xa1&&wire.type!=0xa3&&wire.type!=0xa4&&wire.type!=0xa5){ignored++;return;}
   String kind="A"+Integer.toHexString(wire.type-0xa0);kinds.put(kind,kinds.getOrDefault(kind,0L)+1);
   byte[] data=wire.data();String task="";Map<String,Object> row=WireJson.object("kind",kind,"peer_sha256",hash(peer),"wire_version",wire.version,"data_bytes",data.length,"message_bytes",wire.message.getBytes(StandardCharsets.UTF_8).length,"observed_at",at,"account_observed",account,"context_observed_at",contextAt,"context_observed_after_receive",contextAt>at,"account_origin_verified",false,"source_link_verified",false);
   Map<String,Object> meta=null;try{if(!wire.message.isEmpty())meta=WireJson.map(WireJson.read(wire.message.getBytes(StandardCharsets.UTF_8),16384,1000));}catch(RuntimeException error){row.put("metadata_parse_error",true);}
   if(meta!=null){Object id=meta.get("taskId");if(id instanceof String&&((String)id).matches("[A-Za-z0-9_.:-]{1,128}"))task=(String)id;row.put("metadata_field_count",meta.size());Object finish=meta.get("isFinish");if(finish instanceof Boolean)row.put("is_finish",finish);}
   String taskHash=task.isEmpty()?"":hash(task);row.put("task_id_present",!task.isEmpty());row.put("task_id_sha256",taskHash);row.put("exact_conversation_cache_match",account.isEmpty()||contextAt<=0||conversations==null?null:!task.isEmpty()&&conversations.contains(taskHash));
   if(wire.type==0xa3)try{
    AlwaysOnAudioBatch batch=AlwaysOnAudioBatch.parse(wire.message,data);row.put("frame_count",batch.frames.size());row.put("modern",batch.modern);row.put("clamped",batch.clamped);row.put("unparsed_bytes",batch.unparsedBytes);
    Set<String> headers=new TreeSet<>();for(AlwaysOnAudioBatch.Frame f:batch.frames){byte[] b=f.bytes();if(b.length>0&&headers.size()<8)headers.add(String.format(Locale.ROOT,"%02x",b[0]&255));}row.put("first_byte_profiles",new ArrayList<>(headers));row.put("codec_verified",false);
   }catch(RuntimeException unsupported){row.put("batch_parse_error",true);}
   String key=hash(kind+"/"+peer+"/"+taskHash+"/"+account);Map<String,Object> old=samples.remove(key);row.put("batches",old==null?1L:((Number)old.get("batches")).longValue()+1);samples.put(key,row);while(samples.size()>24)samples.remove(samples.keySet().iterator().next());
  }catch(RuntimeException unreadable){invalid++;}
 }
 Map<String,Object> snapshot(){return WireJson.object("schema",1,"process_epoch",process,"observer_only",true,"audio_persisted",false,"source_link_verified",false,"packets",packets,"bytes",bytes,"invalid_wire",invalid,"ignored_types",ignored,"dropped_packets",dropped,"last_received_at",lastAt,"kinds",new TreeMap<>(kinds),"samples",WireJson.copy(new ArrayList<>(samples.values())));}
}
