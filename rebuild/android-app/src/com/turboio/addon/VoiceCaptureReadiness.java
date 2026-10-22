package com.turboio.addon;

import java.util.*;

/** Reads an internal, device-evidence admission record. It never creates evidence,
 * starts capture, or relaxes the independent stop/recovery obligations. */
final class VoiceCaptureReadiness {
 private static final String ORIGINAL_HOST="a35159a82c0916f62ed6c4da271a40217300cc6678b29c54f2591d9fb592a45c";
 private static final String PATCHED_HOST="48ffd34352bf23eca928ad9c2f576347c4965a5af5ca05a35c1f1ed2ffc9fd50";
 private static final Set<String> FIELDS=Collections.unmodifiableSet(new HashSet<>(Arrays.asList(
  "format","host_lib_sha256","firmware","source_profile","peer_hash","evidence_id",
  "source_audio_verified","decoder_verified","device_stop_verified")));
 final String evidenceId;
 final boolean permitted;
 private VoiceCaptureReadiness(String evidenceId){this.evidenceId=evidenceId;permitted=true;}
 private static void require(boolean valid,String code){if(!valid)throw new IllegalArgumentException(code);}
 static VoiceCaptureReadiness read(byte[] raw,String peerHash){
  require(peerHash!=null&&peerHash.matches("[a-f0-9]{64}"),"VOICE_SOURCE_PEER_INVALID");
  require(raw!=null&&raw.length>0,"VOICE_SOURCE_PROOF_INVALID");
  require(raw.length<=8192,"VOICE_SOURCE_PROOF_BUDGET");
  Map<String,Object> record;
  try{record=WireJson.map(WireJson.read(raw,8192,64));}
  catch(RuntimeException malformed){throw new IllegalArgumentException("VOICE_SOURCE_PROOF_INVALID");}
  require(record.keySet().equals(FIELDS),"VOICE_SOURCE_PROOF_FIELDS_INVALID");
  require("io-agent-voice-source-readiness/1".equals(record.get("format")),"VOICE_SOURCE_PROOF_FORMAT_INVALID");
  Object host=record.get("host_lib_sha256");
  require(ORIGINAL_HOST.equals(host)||PATCHED_HOST.equals(host),"VOICE_SOURCE_HOST_MISMATCH");
  require("Strix OS 1.0.5.5".equals(record.get("firmware")),"VOICE_SOURCE_FIRMWARE_MISMATCH");
  require("recording-opus240-pcm16k-mono".equals(record.get("source_profile")),"VOICE_SOURCE_PROFILE_MISMATCH");
  require(peerHash.equals(record.get("peer_hash")),"VOICE_SOURCE_PEER_MISMATCH");
  Object evidence=record.get("evidence_id");
  require(evidence instanceof String&&((String)evidence).matches("[a-f0-9]{32}"),"VOICE_SOURCE_EVIDENCE_INVALID");
  require(Boolean.TRUE.equals(record.get("source_audio_verified"))&&Boolean.TRUE.equals(record.get("decoder_verified"))&&Boolean.TRUE.equals(record.get("device_stop_verified")),"VOICE_SOURCE_VERIFICATION_REQUIRED");
  return new VoiceCaptureReadiness((String)evidence);
 }
}
