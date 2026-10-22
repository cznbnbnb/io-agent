package com.turboio.addon;

import java.util.*;

/** Material 1.2 shape/cross-field checks. Historic parent verification remains server-authoritative. */
final class MaterialWire {
 static void require(boolean value,String code){if(!value)throw new IllegalArgumentException(code);}
 static String text(Object value,int max,boolean empty){require(value instanceof String,"MATERIAL_TEXT_INVALID");String s=(String)value;require((empty||!s.isEmpty())&&s.codePointCount(0,s.length())<=max,"MATERIAL_TEXT_INVALID");return s;}
 static String id(Object v){return text(v,512,false);}
 static long number(Object v){require(v instanceof Long||v instanceof Integer,"MATERIAL_NUMBER_INVALID");long n=((Number)v).longValue();require(n>=0&&n<=9007199254740991L,"MATERIAL_NUMBER_INVALID");return n;}
 static long positive(Object v){long n=number(v);require(n>0,"MATERIAL_NUMBER_INVALID");return n;}
 static long time(Object v){try{return TaskConnection.stamp(v);}catch(RuntimeException invalid){throw new IllegalArgumentException("MATERIAL_TIME_INVALID");}}
 static boolean choice(Object v,String...allowed){return Arrays.asList(allowed).contains(v);}
 static Map<String,Object> event(byte[] raw,String producer){
  require(raw!=null&&raw.length<=262144,"MATERIAL_EVENT_BUDGET");Map<String,Object> e=WireJson.map(WireJson.read(raw));
  BoundedJson.keys(e,"schema_version","event_id","idempotency_key","kind","producer_id","created_at","expires_at","body");
  require("1.2".equals(e.get("schema_version"))&&"material.revision".equals(e.get("kind"))&&producer.equals(e.get("producer_id")),"MATERIAL_EVENT_INVALID");require(!choice(id(e.get("event_id")),".",".."),"MATERIAL_EVENT_INVALID");String key=text(e.get("idempotency_key"),256,false);require(key.length()>=8,"MATERIAL_EVENT_INVALID");long created=time(e.get("created_at")),expires=time(e.get("expires_at"));require(created<expires,"MATERIAL_EVENT_TIME_INVALID");body(WireJson.map(e.get("body")));return e;
 }
 static void body(Map<String,Object> b){
  BoundedJson.keys(b,"material_id","revision","base_revision","operation","source","started_at","ended_at","completeness","text_revision","utterances","audio","full_text","processing","speakers");String material=id(b.get("material_id"));long revision=positive(b.get("revision"));require(revision==number(b.get("base_revision"))+1,"MATERIAL_REVISION_INVALID");number(b.get("text_revision"));
  require(choice(b.get("operation"),"upsert","delete")&&choice(b.get("source"),"recording","lifelog","agent_analysis")&&choice(b.get("completeness"),"complete","partial","gap"),"MATERIAL_BODY_INVALID");long duration=time(b.get("ended_at"))-time(b.get("started_at"));require(duration>=0,"MATERIAL_TIME_INVALID");
  Map<String,Object> audio=WireJson.map(b.get("audio"));BoundedJson.keys(audio,"state","sha256","object_id");require(choice(audio.get("state"),"local","missing","not_retained")&&audio.get("object_id")==null,"MATERIAL_AUDIO_NOT_VERIFIED");if(audio.get("sha256")!=null)require(text(audio.get("sha256"),64,false).matches("[a-f0-9]{64}"),"MATERIAL_AUDIO_INVALID");
  Map<String,Object> full=WireJson.map(b.get("full_text"));BoundedJson.keys(full,"format","text","origin");require("markdown".equals(full.get("format"))&&choice(full.get("origin"),"none","legacy","asr","user"),"MATERIAL_TEXT_INVALID");text(full.get("text"),1000000,true);
  Map<String,Object> p=WireJson.map(b.get("processing"));BoundedJson.keys(p,"transcription_state","covered_ms","source_ms","speaker","boundary","recognition_channel","user_edited");require(choice(p.get("transcription_state"),"unknown","pending","partial","complete")&&choice(p.get("speaker"),"unknown","pending","processed","unavailable")&&choice(p.get("boundary"),"unknown","unverified","token_starts","no_speech")&&choice(p.get("recognition_channel"),"unknown","mix","left","right","legacy_mix")&&p.get("user_edited") instanceof Boolean,"MATERIAL_PROCESSING_INVALID");
  Long covered=p.get("covered_ms")==null?null:number(p.get("covered_ms")),source=p.get("source_ms")==null?null:number(p.get("source_ms"));require(covered==null||source==null||covered<=source,"MATERIAL_COVERAGE_INVALID");
  if(p.get("transcription_state").equals("unknown"))require(covered==null&&source==null,"MATERIAL_COVERAGE_INVALID");
  if(p.get("transcription_state").equals("pending"))require(covered!=null&&covered==0,"MATERIAL_COVERAGE_INVALID");
  if(choice(p.get("transcription_state"),"partial","complete"))require(covered!=null&&source!=null,"MATERIAL_COVERAGE_INVALID");
  if(p.get("transcription_state").equals("complete"))require(covered.equals(source)&&b.get("completeness").equals("complete"),"MATERIAL_COVERAGE_INVALID");
  List<Object> speakers=WireJson.list(b.get("speakers"));require(speakers.size()<=1000,"MATERIAL_SPEAKER_INVALID");Set<String> ids=new HashSet<>();int self=0;
  for(Object raw:speakers){Map<String,Object> s=WireJson.map(raw);BoundedJson.keys(s,"speaker_id","label","label_basis","is_self");String sid=id(s.get("speaker_id")),label=text(s.get("label"),80,false);require(sid.startsWith(material+"-s")&&sid.substring((material+"-s").length()).matches("[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}")&&ids.add(sid)&&label.length()<=80&&!label.trim().isEmpty()&&choice(s.get("label_basis"),"anonymous","user_confirmed","role_match")&&s.get("is_self") instanceof Boolean,"MATERIAL_SPEAKER_INVALID");for(char c:label.toCharArray())require(!Character.isISOControl(c),"MATERIAL_SPEAKER_INVALID");if(Boolean.TRUE.equals(s.get("is_self")))require(s.get("label_basis").equals("user_confirmed")&&++self<=1,"MATERIAL_SPEAKER_INVALID");}
  List<Object> utterances=WireJson.list(b.get("utterances"));require(utterances.size()<=10000,"MATERIAL_UTTERANCE_INVALID");Set<String> seen=new HashSet<>();
  for(Object raw:utterances){Map<String,Object> u=WireJson.map(raw);Set<String> keys=new HashSet<>(u.keySet());keys.remove("source_range");require(keys.equals(new HashSet<>(Arrays.asList("utterance_id","start_ms","end_ms","text","speaker_id","speaker_basis","overlap"))),"MATERIAL_UTTERANCE_INVALID");require(seen.add(id(u.get("utterance_id")))&&u.get("overlap") instanceof Boolean&&choice(u.get("speaker_basis"),"unknown","segment_cluster","user_confirmed"),"MATERIAL_UTTERANCE_INVALID");text(u.get("text"),65536,true);
   Object speaker=u.get("speaker_id");require((speaker==null)==u.get("speaker_basis").equals("unknown")&&(speaker==null||ids.contains(speaker)),"MATERIAL_SPEAKER_INVALID");Long start=u.get("start_ms")==null?null:number(u.get("start_ms")),end=u.get("end_ms")==null?null:number(u.get("end_ms"));require((start==null)==(end==null)&&(start!=null||u.get("source_range")!=null),"MATERIAL_RANGE_INVALID");if(start!=null)require(end>=start&&end<=duration&&(covered==null||end<=covered),"MATERIAL_RANGE_INVALID");
   if(u.containsKey("source_range")){Map<String,Object> range=WireJson.map(u.get("source_range"));BoundedJson.keys(range,"parent_utterance_id","parent_revision","start_ms","end_ms","text_start","text_end");id(range.get("parent_utterance_id"));long rstart=number(range.get("start_ms")),rend=number(range.get("end_ms"));require(positive(range.get("parent_revision"))<revision&&rend>=rstart&&rend<=duration&&number(range.get("text_end"))>number(range.get("text_start"))&&(start==null||start>=rstart&&end<=rend)&&(covered==null||rend<=covered),"MATERIAL_RANGE_INVALID");}
  }
  if(b.get("operation").equals("delete"))require(utterances.isEmpty()&&speakers.isEmpty()&&full.get("text").equals(""),"MATERIAL_TOMBSTONE_INVALID");
 }
 static void ack(Map<String,Object> ack,Map<String,Object> event){
  Map<String,Object> b=WireJson.map(event.get("body")),r=WireJson.map(ack.get("receipt"));
  require("1.2".equals(ack.get("schema_version"))&&event.get("event_id").equals(ack.get("event_id"))&&b.get("material_id").equals(ack.get("material_id"))&&positive(b.get("revision"))==positive(ack.get("revision")),"MATERIAL_ACK_MISMATCH");positive(ack.get("commit_seq"));time(ack.get("stored_at"));id(r.get("receipt_id"));
  require("material".equals(r.get("subject_kind"))&&b.get("material_id").equals(r.get("subject_id"))&&positive(r.get("subject_revision"))==positive(b.get("revision"))&&"server_stored".equals(r.get("stage"))&&"server-storage".equals(r.get("actor_id"))&&event.get("event_id").equals(r.get("related_event_id"))&&r.containsKey("error")&&r.get("error")==null,"MATERIAL_ACK_MISMATCH");
 }
}
