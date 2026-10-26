package com.turboio.addon;

import java.io.*;import java.util.*;

/** Explicit audio-only permission, bound to one signed-in official account. */
final class AudioConfig {
 final AudioConnection connection;final String account;final boolean enabled;
 AudioConfig(AudioConnection connection,String account,boolean enabled)throws IOException{AudioUploadWire.check(connection!=null&&account!=null&&account.matches("[a-f0-9]{64}"),"AUDIO_CONFIG_ACCOUNT");this.connection=connection;this.account=account;this.enabled=enabled;}
 byte[] encode(){return WireJson.bytes(WireJson.object("schema",1,"connection",WireJson.read(connection.encode()),"account",account,"enabled",enabled));}
 static AudioConfig decode(byte[] bytes)throws IOException{try{Map<String,Object> v=WireJson.map(WireJson.read(bytes,12288,200));AudioUploadWire.keys(v,"schema","connection","account","enabled");AudioUploadWire.check(AudioUploadWire.number(v.get("schema"))==1&&v.get("enabled") instanceof Boolean,"AUDIO_CONFIG_INVALID");return new AudioConfig(AudioConnection.parse(WireJson.bytes(v.get("connection")),0),(String)v.get("account"),(Boolean)v.get("enabled"));}catch(IllegalArgumentException|ClassCastException invalid){throw new IOException("AUDIO_CONFIG_INVALID");}}
 AudioConfig enabled(boolean value)throws IOException{return new AudioConfig(connection,account,value);}
 String fingerprint(){return TaskWire.hash(encode());}
 void replaceAllowed(AudioConfig next)throws IOException{AudioUploadWire.check(!connection.binding().equals(next.connection.binding())||account.equals(next.account),"AUDIO_ACCOUNT_REBIND_REFUSED");}
}
