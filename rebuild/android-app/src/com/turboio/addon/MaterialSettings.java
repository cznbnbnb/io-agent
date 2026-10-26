package com.turboio.addon;
import android.content.*;import android.security.keystore.*;import android.util.Base64;
import java.nio.charset.StandardCharsets;import java.security.*;import java.util.*;import javax.crypto.*;import javax.crypto.spec.GCMParameterSpec;

/** Separate authenticated Keystore envelope; no task/official credentials mixed. */
final class MaterialSettings {
 private static final Object LOCK=new Object();private static final String ALIAS="io.agent.materials.config.v1",CURRENT="material_sealed_v2";
 private static final byte[] AAD="io-agent/material-connection/1".getBytes(StandardCharsets.UTF_8),CURRENT_AAD="io-agent/material-connection/2".getBytes(StandardCharsets.UTF_8);private final SharedPreferences prefs;
 MaterialSettings(Context app){prefs=app.getSharedPreferences("io_agent_materials_v1",Context.MODE_PRIVATE);}
 private static SecretKey key(boolean create)throws Exception{KeyStore store=KeyStore.getInstance("AndroidKeyStore");store.load(null);if(store.containsAlias(ALIAS))return (SecretKey)store.getKey(ALIAS,null);if(!create)throw new IllegalStateException("MATERIAL_KEY_UNAVAILABLE");KeyGenerator gen=KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES,"AndroidKeyStore");gen.init(new KeyGenParameterSpec.Builder(ALIAS,KeyProperties.PURPOSE_ENCRYPT|KeyProperties.PURPOSE_DECRYPT).setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).setRandomizedEncryptionRequired(true).build());return gen.generateKey();}
 private static byte[] open(String text,byte[] aad,int limit)throws Exception{
  MaterialWire.require(text!=null&&text.length()<=(limit+32)*4/3+8,"MATERIAL_CONFIG_INVALID");byte[] data=Base64.decode(text,Base64.NO_WRAP);MaterialWire.require(data.length>=29&&data.length<=limit+28,"MATERIAL_CONFIG_INVALID");Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.DECRYPT_MODE,key(false),new GCMParameterSpec(128,Arrays.copyOf(data,12)));cipher.updateAAD(aad);return cipher.doFinal(Arrays.copyOfRange(data,12,data.length));
 }
 private static String seal(byte[] plain,byte[] aad)throws Exception{
  Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.ENCRYPT_MODE,key(true));cipher.updateAAD(aad);byte[] encrypted=cipher.doFinal(plain),iv=cipher.getIV();MaterialWire.require(iv.length==12,"MATERIAL_CONFIG_INVALID");byte[] sealed=new byte[12+encrypted.length];System.arraycopy(iv,0,sealed,0,12);System.arraycopy(encrypted,0,sealed,12,encrypted.length);return Base64.encodeToString(sealed,Base64.NO_WRAP);
 }
 MaterialConfig load()throws Exception{synchronized(LOCK){
  String current=prefs.getString(CURRENT,null),old=prefs.getString("sealed",null);if(current==null&&old==null)return null;
  byte[] legacy=old==null?null:open(old,AAD,12288),plain=null;
  try{
   if(current!=null){plain=open(current,CURRENT_AAD,16384);return MaterialSettingsState.decode(plain,legacy);}
   MaterialConfig config=MaterialConfig.decode(legacy);write(config);return config;
  }finally{if(legacy!=null)Arrays.fill(legacy,(byte)0);if(plain!=null)Arrays.fill(plain,(byte)0);}
 }}
 private void write(MaterialConfig config)throws Exception{
  byte[] plain=MaterialSettingsState.encode(config),legacy=MaterialSettingsState.legacy(config);
  try{
   SharedPreferences.Editor edit=prefs.edit().putString(CURRENT,seal(plain,CURRENT_AAD)).putString("sealed",seal(legacy,AAD));
   String old=prefs.getString("sealed",null);if(old!=null&&!prefs.contains("material_backup_v1"))edit.putString("material_backup_v1",old);
   if(!edit.commit())throw new IllegalStateException("MATERIAL_CONFIG_SAVE_FAILED");
   byte[] written=open(prefs.getString(CURRENT,null),CURRENT_AAD,16384),projection=open(prefs.getString("sealed",null),AAD,12288);
   try{MaterialWire.require(Arrays.equals(MaterialSettingsState.decode(written,projection).encode(),config.encode()),"MATERIAL_CONFIG_SAVE_FAILED");}finally{Arrays.fill(written,(byte)0);Arrays.fill(projection,(byte)0);}
  }finally{Arrays.fill(plain,(byte)0);Arrays.fill(legacy,(byte)0);}
 }
 void save(MaterialConfig config)throws Exception{synchronized(LOCK){MaterialConfig old=load();if(old!=null)old.replaceAllowed(config);write(config);}}
}
