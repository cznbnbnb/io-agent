package com.turboio.addon;

import java.io.*;import java.util.*;

/** Explicit audio grant. Reuses target syntax, never material authorization. */
final class AudioConnection {
 static final String FORMAT="turboio-audio-sync/1";
 private final MaterialConnection target;
 final String base,owner,producer,server;final long expiresAt;
 private AudioConnection(MaterialConnection target){this.target=target;base=target.base;owner=target.owner;producer=target.producer;server=target.server;expiresAt=target.expiresAt;}
 static AudioConnection parse(byte[] bytes,long now)throws IOException{
  try{AudioUploadWire.check(bytes!=null&&bytes.length<=8192,"AUDIO_CONNECTION_INVALID");Map<String,Object> v=WireJson.map(WireJson.read(bytes));AudioUploadWire.check(FORMAT.equals(v.get("format")),"AUDIO_CONNECTION_FORMAT");v.put("format",MaterialConnection.FORMAT);return new AudioConnection(MaterialConnection.parse(WireJson.bytes(v),now));}
  catch(IllegalArgumentException invalid){throw new IOException("AUDIO_CONNECTION_INVALID");}
 }
 String preview(){return target.preview();}
 String token(){return target.token();}String binding(){return target.binding();}
 byte[] encode(){Map<String,Object> v=WireJson.map(WireJson.read(target.encode()));v.put("format",FORMAT);return WireJson.bytes(v);}
 void identity(byte[] raw,long now)throws IOException{identity(raw,now,"audio:write");}
 void readIdentity(byte[] raw,long now)throws IOException{identity(raw,now,"audio:read");}
 private void identity(byte[] raw,long now,String scope)throws IOException{
  try{Map<String,Object> v=WireJson.map(WireJson.read(raw,16384,1000));
   AudioUploadWire.check(expiresAt>now,"AUDIO_CREDENTIAL_EXPIRED");
   AudioUploadWire.check("1.0".equals(v.get("schema_version"))&&owner.equals(v.get("owner_id"))&&producer.equals(v.get("producer_id"))&&server.equals(v.get("server_id"))&&MaterialWire.time(v.get("expires_at"))==expiresAt,"AUDIO_IDENTITY_MISMATCH");
   AudioUploadWire.check(WireJson.list(v.get("scopes")).contains(scope),"AUDIO_SCOPE_REQUIRED");
   AudioUploadWire.check(v.get("capabilities") instanceof List&&WireJson.list(v.get("capabilities")).contains("audio_archive_v1"),"AUDIO_CAPABILITY_UNAVAILABLE");
  }catch(IllegalArgumentException invalid){throw new IOException("AUDIO_IDENTITY_INVALID");}
 }
}
