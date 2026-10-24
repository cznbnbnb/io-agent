package com.turboio.addon;

import java.io.*;import java.nio.charset.StandardCharsets;import java.util.*;

/** Exact v1 audio protocol. Storage and recording completeness stay separate. */
final class AudioUploadWire {
 static final int PART=131072;static final long MAX=536870912,TTL=259200000;
 static void check(boolean value,String code)throws IOException{if(!value)throw new IOException(code);}
 static long number(Object value)throws IOException{check(value instanceof Long||value instanceof Integer,"AUDIO_NUMBER_INVALID");long n=((Number)value).longValue();check(n>=0&&n<=9007199254740991L,"AUDIO_NUMBER_INVALID");return n;}
 static String hash(Object value)throws IOException{check(value instanceof String&&((String)value).matches("[a-f0-9]{64}"),"AUDIO_HASH_INVALID");return (String)value;}
 static void keys(Map<String,Object> v,String...names)throws IOException{check(v.keySet().equals(new HashSet<>(Arrays.asList(names))),"AUDIO_FIELDS_INVALID");}
 static long time(Object value)throws IOException{try{return MaterialWire.time(value);}catch(RuntimeException invalid){throw new IOException("AUDIO_TIME_INVALID");}}
 static Map<String,Object> manifest(Object value)throws IOException{try{Map<String,Object> v=WireJson.map(value);keys(v,"material_id","material_revision","kind","media_type","bytes","sha256","capture");
  check(v.get("material_id") instanceof String&&((String)v.get("material_id")).matches("[A-Za-z0-9_.:-]{1,512}")&&number(v.get("material_revision"))>0&&number(v.get("bytes"))>0&&number(v.get("bytes"))<=MAX,"AUDIO_MANIFEST_INVALID");hash(v.get("sha256"));
  check("raw".equals(v.get("kind"))&&"application/vnd.turboio.lifelog-archive".equals(v.get("media_type"))||"playable".equals(v.get("kind"))&&"audio/ogg".equals(v.get("media_type")),"AUDIO_MANIFEST_INVALID");
  Map<String,Object> capture=WireJson.map(v.get("capture"));keys(capture,"first_received_at","last_received_at","recording_complete");check(time(capture.get("first_received_at"))<=time(capture.get("last_received_at"))&&capture.get("recording_complete") instanceof Boolean,"AUDIO_CAPTURE_INVALID");return WireJson.map(WireJson.copy(v));
 }catch(IllegalArgumentException invalid){throw new IOException("AUDIO_MANIFEST_INVALID");}}
 static String object(String owner,Map<String,Object> manifest){return TaskWire.hash(WireJson.bytes(WireJson.object("owner",owner,"material_id",manifest.get("material_id"),"kind",manifest.get("kind"),"sha256",manifest.get("sha256"))));}
 static int parts(Map<String,Object> manifest)throws IOException{return (int)((number(manifest.get("bytes"))+PART-1)/PART);}
 static Map<String,Object> status(byte[] raw,Map<String,Object> row,long now,boolean uploadStatus)throws IOException{try{
  Map<String,Object> v=WireJson.map(WireJson.read(raw,262144,20000)),m=WireJson.map(row.get("manifest"));
  Set<String> fields=new HashSet<>(Arrays.asList("schema_version","object_id","owner_id","producer_id","source_body_sha256","state","part_bytes","parts","stored_at","expires_at","retention_seconds","storage_verified","recording_completeness_verified"));fields.addAll(m.keySet());if(uploadStatus){fields.add("upload_expires_at");fields.add("received");}check(fields.equals(v.keySet()),"AUDIO_RECEIPT_FIELDS_INVALID");
  check("1.0".equals(v.get("schema_version"))&&row.get("object_id").equals(v.get("object_id"))&&row.get("owner").equals(v.get("owner_id"))&&row.get("producer").equals(v.get("producer_id"))&&row.get("body_sha256").equals(v.get("source_body_sha256")),"AUDIO_RECEIPT_MISMATCH");
  for(String k:m.keySet())check(Arrays.equals(WireJson.bytes(m.get(k)),WireJson.bytes(v.get(k))),"AUDIO_RECEIPT_MISMATCH");
  check(number(v.get("part_bytes"))==PART&&number(v.get("parts"))==parts(m)&&number(v.get("retention_seconds"))==TTL/1000&&Boolean.FALSE.equals(v.get("recording_completeness_verified")),"AUDIO_RECEIPT_MISMATCH");
  if("stored".equals(v.get("state"))){long stored=time(v.get("stored_at")),expires=time(v.get("expires_at"));check(Boolean.TRUE.equals(v.get("storage_verified"))&&expires-stored==TTL&&stored<=now+300000&&expires>now,"AUDIO_RECEIPT_TIME_INVALID");}
  else check("uploading".equals(v.get("state"))&&Boolean.FALSE.equals(v.get("storage_verified"))&&v.get("stored_at")==null&&v.get("expires_at")==null,"AUDIO_RECEIPT_STATE_INVALID");
  if(uploadStatus){check(time(v.get("upload_expires_at"))>now||"stored".equals(v.get("state")),"AUDIO_UPLOAD_EXPIRED");Set<Long> seen=new HashSet<>();for(Object p:WireJson.list(v.get("received"))){long index=number(p);check(index<parts(m)&&seen.add(index),"AUDIO_PART_STATUS_INVALID");}}
  return v;
 }catch(IllegalArgumentException invalid){throw new IOException("AUDIO_RECEIPT_INVALID");}catch(IOException invalid){String code=invalid.getMessage();if(code!=null&&(code.startsWith("AUDIO_RECEIPT")||code.equals("AUDIO_PART_STATUS_INVALID")||code.equals("AUDIO_UPLOAD_EXPIRED")))throw invalid;throw new IOException("AUDIO_RECEIPT_INVALID");}}
 static String error(MaterialApi.Response r){try{Map<String,Object> v=WireJson.map(WireJson.read(r.body,16384,1000));Object code=WireJson.map(v.get("error")).get("code");if("1.0".equals(v.get("schema_version"))&&code instanceof String&&((String)code).matches("[A-Z_]{3,80}"))return (String)code;}catch(RuntimeException ignored){}return "AUDIO_RESPONSE_REJECTED";}
 /** The material schema uses safe integers. Normalize JSON's two short control
  * escapes without touching a literal backslash-u in the user's text. */
 static String bodyHash(Map<String,Object> body){MaterialWire.body(body);String json=new String(WireJson.bytes(body),StandardCharsets.UTF_8);StringBuilder out=new StringBuilder();for(int i=0;i<json.length();i++){char c=json.charAt(i);if(c=='\\'&&i+1<json.length()){if(json.startsWith("\\u0008",i)){out.append("\\b");i+=5;continue;}if(json.startsWith("\\u000c",i)){out.append("\\f");i+=5;continue;}out.append(c).append(json.charAt(++i));}else out.append(c);}return TaskWire.hash(out.toString().getBytes(StandardCharsets.UTF_8));}
}
