package com.turboio.addon;

import java.io.*;import java.util.*;

/** Read receipts are pinned across chunks; a server receipt is not source proof. */
final class AudioDownloadWire {
 static Map<String,Object> receipt(Object raw,AudioConnection connection,String material,long now,boolean retained)throws IOException{
  AudioUploadWire.check(connection!=null&&material!=null&&material.matches("rayneo-lifelog-[a-f0-9]{64}"),"AUDIO_DOWNLOAD_QUERY");
  try{Map<String,Object> value=WireJson.map(raw);AudioUploadWire.keys(value,"schema_version","object_id","owner_id","producer_id","source_body_sha256","state","part_bytes","parts","stored_at","expires_at","retention_seconds","storage_verified","recording_completeness_verified","material_id","material_revision","kind","media_type","bytes","sha256","capture");
   Map<String,Object> manifest=AudioUploadWire.manifest(WireJson.object("material_id",value.get("material_id"),"material_revision",value.get("material_revision"),"kind",value.get("kind"),"media_type",value.get("media_type"),"bytes",value.get("bytes"),"sha256",value.get("sha256"),"capture",value.get("capture")));
   AudioUploadWire.check("1.0".equals(value.get("schema_version"))&&connection.owner.equals(value.get("owner_id"))&&material.equals(value.get("material_id"))&&AudioUploadWire.object(connection.owner,manifest).equals(value.get("object_id")),"AUDIO_DOWNLOAD_RECEIPT_MISMATCH");
   AudioUploadWire.check(value.get("producer_id") instanceof String&&((String)value.get("producer_id")).matches("[A-Za-z0-9_.:-]{1,128}"),"AUDIO_DOWNLOAD_RECEIPT_MISMATCH");AudioUploadWire.hash(value.get("source_body_sha256"));
   long stored=AudioUploadWire.time(value.get("stored_at")),expires=AudioUploadWire.time(value.get("expires_at"));AudioUploadWire.check(expires-stored==AudioUploadWire.TTL&&stored<=now+300000&&AudioUploadWire.number(value.get("part_bytes"))==AudioUploadWire.PART&&AudioUploadWire.number(value.get("parts"))==AudioUploadWire.parts(manifest)&&AudioUploadWire.number(value.get("retention_seconds"))==259200&&Boolean.FALSE.equals(value.get("recording_completeness_verified")),"AUDIO_DOWNLOAD_RECEIPT_MISMATCH");
   boolean available="stored".equals(value.get("state"))&&Boolean.TRUE.equals(value.get("storage_verified"))&&expires>now;
   AudioUploadWire.check(available||!retained&&"expired".equals(value.get("state"))&&Boolean.FALSE.equals(value.get("storage_verified"))&&expires<=now,"AUDIO_EXPIRED");
   return WireJson.map(WireJson.copy(value));
  }catch(IllegalArgumentException|ClassCastException invalid){throw new IOException("AUDIO_DOWNLOAD_RECEIPT_INVALID");}
 }
 static Map<String,Object> receipt(byte[] raw,AudioConnection connection,String material,long now)throws IOException{try{return receipt(WireJson.read(raw,262144,20000),connection,material,now,true);}catch(IllegalArgumentException invalid){throw new IOException("AUDIO_DOWNLOAD_RECEIPT_INVALID");}}
 static byte[] part(byte[] raw,Map<String,Object> receipt,int index)throws IOException{
  try{Map<String,Object> value=WireJson.map(WireJson.read(raw,262144,100));AudioUploadWire.keys(value,"object_id","index","bytes","sha256","part_sha256","expires_at","data");
   AudioUploadWire.check(receipt.get("object_id").equals(value.get("object_id"))&&receipt.get("bytes").equals(value.get("bytes"))&&receipt.get("sha256").equals(value.get("sha256"))&&receipt.get("expires_at").equals(value.get("expires_at"))&&AudioUploadWire.number(value.get("index"))==index,"AUDIO_DOWNLOAD_PART_MISMATCH");
   String encoded=(String)value.get("data");AudioUploadWire.check(encoded!=null&&encoded.length()<=174764,"AUDIO_DOWNLOAD_PART_INVALID");byte[] bytes=Base64.getDecoder().decode(encoded);
   if(bytes.length!=Math.min(AudioUploadWire.PART,AudioUploadWire.number(receipt.get("bytes"))-(long)index*AudioUploadWire.PART)||!Base64.getEncoder().encodeToString(bytes).equals(encoded)||!TaskWire.hash(bytes).equals(AudioUploadWire.hash(value.get("part_sha256")))){Arrays.fill(bytes,(byte)0);throw new IOException("AUDIO_DOWNLOAD_PART_INVALID");}return bytes;
  }catch(IllegalArgumentException|ClassCastException invalid){throw new IOException("AUDIO_DOWNLOAD_PART_INVALID");}
 }
}
