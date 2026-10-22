package com.turboio.addon;

import android.content.*;
import android.security.keystore.*;
import android.util.Base64;
import java.nio.charset.StandardCharsets;
import java.security.*;
import java.util.*;
import javax.crypto.*;
import javax.crypto.spec.GCMParameterSpec;

/** Atomic encrypted target registry; old single-target data is read without eager migration. */
final class TaskSettings {
 private static final Object LOCK=new Object();
 private static final String ALIAS="io.agent.tasks.config.v1",MULTI="profiles_sealed_v2";
 private static final byte[] AAD="io-agent/task-connection/1".getBytes(StandardCharsets.UTF_8),MULTI_AAD="io-agent/task-profiles/2".getBytes(StandardCharsets.UTF_8);
 private final SharedPreferences prefs;
 static final class Saved {final TaskConnection connection;final boolean enabled;Saved(TaskConnection c,boolean enabled){connection=c;this.enabled=enabled;}}
 TaskSettings(Context context){prefs=context.getSharedPreferences("io_agent_tasks_v1",Context.MODE_PRIVATE);}
 private static SecretKey key(boolean create)throws Exception{
  KeyStore store=KeyStore.getInstance("AndroidKeyStore");store.load(null);
  if(store.containsAlias(ALIAS))return (SecretKey)store.getKey(ALIAS,null);
  if(!create)throw new IllegalStateException("TASK_KEY_UNAVAILABLE");
  KeyGenerator generator=KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES,"AndroidKeyStore");
  generator.init(new KeyGenParameterSpec.Builder(ALIAS,KeyProperties.PURPOSE_ENCRYPT|KeyProperties.PURPOSE_DECRYPT).setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).setRandomizedEncryptionRequired(true).build());return generator.generateKey();
 }
 private static byte[] open(String text,byte[] aad,int limit)throws Exception{
  if(text.length()>(limit+32L)*4/3+8)throw new IllegalStateException("TASK_CONFIG_INVALID");byte[] data=Base64.decode(text,Base64.NO_WRAP);
  if(data.length<29||data.length>limit+28)throw new IllegalStateException("TASK_CONFIG_INVALID");
  Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.DECRYPT_MODE,key(false),new GCMParameterSpec(128,Arrays.copyOf(data,12)));cipher.updateAAD(aad);return cipher.doFinal(Arrays.copyOfRange(data,12,data.length));
 }
 private static String seal(byte[] plain,byte[] aad)throws Exception{
  Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.ENCRYPT_MODE,key(true));cipher.updateAAD(aad);byte[] encrypted=cipher.doFinal(plain),iv=cipher.getIV();
  if(iv.length!=12)throw new IllegalStateException("TASK_CONFIG_INVALID");byte[] sealed=new byte[iv.length+encrypted.length];System.arraycopy(iv,0,sealed,0,iv.length);System.arraycopy(encrypted,0,sealed,iv.length,encrypted.length);return Base64.encodeToString(sealed,Base64.NO_WRAP);
 }
 TaskProfiles loadAll()throws Exception{synchronized(LOCK){
  String multi=prefs.getString(MULTI,null),legacy=multi==null?prefs.getString("sealed",null):null;if(multi==null&&legacy==null)return TaskProfiles.empty();
  byte[] plain=open(multi==null?legacy:multi,multi==null?AAD:MULTI_AAD,multi==null?24576:TaskProfiles.MAX_BYTES);
  try{return TaskProfiles.decode(plain);}finally{Arrays.fill(plain,(byte)0);}
 }}
 Saved load()throws Exception{synchronized(LOCK){TaskProfiles.Profile p=loadAll().selected();return p==null?null:new Saved(p.connection,p.enabled);}}
 private void write(TaskProfiles profiles)throws Exception{
  byte[] plain=profiles.encode();TaskProfiles.Profile selected=profiles.selected();
  // A rollback host can read its selected target and original mailbox, but starts paused.
  // All registered targets remain in the separate v2 envelope for a forward upgrade.
  byte[] legacy=selected==null?null:WireJson.bytes(WireJson.object("connection",WireJson.read(selected.connection.encode()),"enabled",false));
  try{
   SharedPreferences.Editor edit=prefs.edit().putString(MULTI,seal(plain,MULTI_AAD));
   String old=prefs.getString("sealed",null);if(old!=null&&!prefs.contains("single_backup_v1"))edit.putString("single_backup_v1",old);
   if(legacy!=null)edit.putString("sealed",seal(legacy,AAD));
   if(!edit.commit())throw new IllegalStateException("TASK_CONFIG_SAVE_FAILED");
   if(!Arrays.equals(loadAll().encode(),plain))throw new IllegalStateException("TASK_CONFIG_SAVE_FAILED");
  }finally{Arrays.fill(plain,(byte)0);if(legacy!=null)Arrays.fill(legacy,(byte)0);}
 }
 void save(TaskConnection connection,boolean enabled)throws Exception{synchronized(LOCK){write(loadAll().upsert(connection,enabled,System.currentTimeMillis()));}}
 void select(String binding)throws Exception{synchronized(LOCK){write(loadAll().select(binding));}}
 void pause(String binding)throws Exception{synchronized(LOCK){write(loadAll().enabled(binding,false,System.currentTimeMillis()));}}
}
