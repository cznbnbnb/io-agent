package com.turboio.addon;

import java.nio.charset.StandardCharsets;
import java.util.*;

/** Synthetic parser fixtures only. Passing these does not create physical capture evidence. */
final class VoiceCaptureReadinessTest {
 private static final String PEER="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
 private static final String EVIDENCE="bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
 private static final String ORIGINAL="a35159a82c0916f62ed6c4da271a40217300cc6678b29c54f2591d9fb592a45c";
 private static final String PATCHED="48ffd34352bf23eca928ad9c2f576347c4965a5af5ca05a35c1f1ed2ffc9fd50";
 private static int checks;
 private static void yes(boolean valid){checks++;if(!valid)throw new AssertionError("readiness assertion "+checks);}
 private static Map<String,Object> valid(){return WireJson.object(
  "format","io-agent-voice-source-readiness/1","host_lib_sha256",ORIGINAL,"firmware","Strix OS 1.0.5.5",
  "source_profile","recording-opus240-pcm16k-mono","peer_hash",PEER,"evidence_id",EVIDENCE,
  "source_audio_verified",true,"decoder_verified",true,"device_stop_verified",true);}
 private static byte[] bytes(String raw){return raw.getBytes(StandardCharsets.UTF_8);}
 private static void rejects(byte[] raw,String peer){
  try{VoiceCaptureReadiness.read(raw,peer);throw new AssertionError("unverified evidence accepted");}
  catch(IllegalArgumentException denied){yes(denied.getMessage()!=null&&denied.getMessage().matches("VOICE_SOURCE_[A-Z_]+")&&denied.getCause()==null);}
 }
 private static void changed(String field,Object value){Map<String,Object> row=valid();row.put(field,value);rejects(WireJson.bytes(row),PEER);}
 static void run(){
  byte[] good=WireJson.bytes(valid());VoiceCaptureReadiness proof=VoiceCaptureReadiness.read(good,PEER);
  yes(proof.permitted&&EVIDENCE.equals(proof.evidenceId));
  Map<String,Object> patched=valid();patched.put("host_lib_sha256",PATCHED);yes(VoiceCaptureReadiness.read(WireJson.bytes(patched),PEER).permitted);
  for(String key:valid().keySet()){
   Map<String,Object> missing=valid();missing.remove(key);rejects(WireJson.bytes(missing),PEER);changed(key,null);
  }
  for(String key:new String[]{"source_audio_verified","decoder_verified","device_stop_verified"})
   for(Object bad:new Object[]{false,"true",1L,Collections.emptyList(),Collections.emptyMap()})changed(key,bad);
  changed("format","io-agent-voice-source-readiness/2");changed("format",1L);
  changed("host_lib_sha256",PEER);changed("host_lib_sha256",ORIGINAL.toUpperCase(Locale.ROOT));
  changed("firmware","Strix OS 1.0.5.4");changed("firmware","1.0.5.5");
  changed("source_profile","recording-opus240-pcm48k-mono");
  changed("peer_hash","cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc");changed("peer_hash",PEER.toUpperCase(Locale.ROOT));
  for(Object bad:new Object[]{"",EVIDENCE+"b",EVIDENCE.substring(1),EVIDENCE.toUpperCase(Locale.ROOT),32L})changed("evidence_id",bad);
  changed("unknown",true);changed("permitted",true);changed("expires_at",0L);
  for(String peer:new String[]{null,"",PEER.substring(1),PEER.toUpperCase(Locale.ROOT),"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"})rejects(good,peer);
  String raw=new String(good,StandardCharsets.UTF_8);
  // Equal duplicates are rejected too; evidence cannot be normalized into validity.
  rejects(bytes("{\"device_stop_verified\":true,"+raw.substring(1)),PEER);
  rejects(bytes("{\"device_stop_verified\":false,"+raw.substring(1)),PEER);
  rejects(bytes(raw+"{}"),PEER);rejects(bytes(raw.substring(0,raw.length()-1)),PEER);
  for(String bad:new String[]{"null","[]","true","{}","{\"format\":\"\\ud800\"}"})rejects(bytes(bad),PEER);
  rejects(new byte[]{(byte)0xc3,(byte)0x28},PEER);rejects(null,PEER);rejects(new byte[0],PEER);
  byte[] exact=Arrays.copyOf(good,8192);Arrays.fill(exact,good.length,exact.length,(byte)' ');yes(VoiceCaptureReadiness.read(exact,PEER).permitted);
  byte[] over=Arrays.copyOf(exact,8193);over[8192]=' ';rejects(over,PEER);
  yes(Arrays.equals(good,WireJson.bytes(valid())));
 }
 public static void main(String[] args){run();System.out.println("voice capture readiness: "+checks+" assertions passed (synthetic fixtures only)");}
}
