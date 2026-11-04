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
 private void write(TaskProfiles profiles)throws Exception{write(profiles,null);}
 private void write(TaskProfiles profiles,Set<String> removed)throws Exception{
  byte[] plain=profiles.encode();TaskProfiles.Profile selected=profiles.selected();
  // A rollback host can read its selected target and original mailbox, but starts paused.
  // All registered targets remain in the separate v2 envelope for a forward upgrade.
  byte[] legacy=selected==null?null:WireJson.bytes(WireJson.object("connection",WireJson.read(selected.connection.encode()),"enabled",false));
  try{
   SharedPreferences.Editor edit=prefs.edit().putString(MULTI,seal(plain,MULTI_AAD));
   String old=prefs.getString("sealed",null);if(old!=null&&!prefs.contains("single_backup_v1"))edit.putString("single_backup_v1",old);
   if(legacy!=null)edit.putString("sealed",seal(legacy,AAD));else edit.remove("sealed");
   if(removed!=null)edit.putString("removed_bindings_v1",new String(WireJson.bytes(new ArrayList<>(removed)),StandardCharsets.UTF_8));
   if(!edit.commit())throw new IllegalStateException("TASK_CONFIG_SAVE_FAILED");
   if(!Arrays.equals(loadAll().encode(),plain))throw new IllegalStateException("TASK_CONFIG_SAVE_FAILED");
  }finally{Arrays.fill(plain,(byte)0);if(legacy!=null)Arrays.fill(legacy,(byte)0);}
 }
 void saveQuestion(TaskConnection connection,boolean enabled)throws Exception{synchronized(LOCK){TaskProfiles current=loadAll();Set<String> hidden=removed();hidden.remove(connection.binding());write(current.upsert(connection,enabled,System.currentTimeMillis(),current.selected()==null),hidden);}}
 void save(TaskConnection connection,boolean enabled)throws Exception{save(connection,enabled,true);}
 void save(TaskConnection connection,boolean enabled,boolean makeDefault)throws Exception{synchronized(LOCK){Set<String> hidden=removed();hidden.remove(connection.binding());write(loadAll().upsert(connection,enabled,System.currentTimeMillis(),makeDefault),hidden);}}
 /** Identity was checked for this exact registry. Do not restore stale tokens or
  * replace a default changed while the network preflight was in flight. */
 void resume(TaskProfiles expected,String binding)throws Exception{synchronized(LOCK){
  TaskProfiles current=loadAll();TaskWire.require(Arrays.equals(current.encode(),expected.encode()),"TASK_TARGET_CHANGED");
  write(current.enabled(binding,true,System.currentTimeMillis()));
 }}
 void select(String binding)throws Exception{synchronized(LOCK){write(loadAll().select(binding));}}
 void pause(String binding)throws Exception{synchronized(LOCK){write(loadAll().enabled(binding,false,System.currentTimeMillis()));}}
 void remove(String binding)throws Exception{synchronized(LOCK){write(loadAll().remove(binding,System.currentTimeMillis()));}}
 private Set<String> removed(){Set<String> result=new HashSet<>();for(Object value:WireJson.list(WireJson.read(prefs.getString("removed_bindings_v1","[]").getBytes(StandardCharsets.UTF_8)))){TaskWire.require(value instanceof String&&((String)value).matches("[a-f0-9]{64}"),"TASK_CONFIG_INVALID");result.add((String)value);}return result;}
 boolean hasRemoved(){synchronized(LOCK){return !removed().isEmpty();}}
 Set<String> removedRoutes(TaskDevice device,TaskSessionDirectory directory){synchronized(LOCK){
  if(device==null||directory==null||!device.server.equals(directory.server)||!device.owner.equals(directory.owner))return Collections.emptySet();
  Set<String> hidden=removed(),routes=new HashSet<>();for(TaskSessionDirectory.Entry entry:directory.sessions)if(hidden.contains(device.derive(entry.route,0).binding()))routes.add(entry.key);return Collections.unmodifiableSet(routes);
 }}
 void forget(String binding)throws Exception{synchronized(LOCK){TaskProfiles next=loadAll().forget(binding);Set<String> hidden=removed();hidden.add(binding);write(next,hidden);}}
 int restoreRemoved(TaskDevice device,TaskSessionDirectory directory,long now)throws Exception{synchronized(LOCK){
  TaskWire.require(device.server.equals(directory.server)&&device.owner.equals(directory.owner),"TASK_IDENTITY_MISMATCH");TaskProfiles next=loadAll();Set<String> hidden=removed();int restored=0;
  for(TaskSessionDirectory.Entry entry:directory.sessions){TaskConnection connection=device.derive(entry.route,now);if(!hidden.contains(connection.binding()))continue;boolean known=false;for(TaskProfiles.Profile profile:next.profiles)if(profile.binding.equals(connection.binding()))known=true;if(!known&&next.profiles.size()>=TaskProfiles.MAX)continue;
   next=next.upsert(connection,true,now,next.selected()==null);hidden.remove(connection.binding());restored++;
  }
  if(restored>0)write(next,hidden);return restored;
 }}

 // One-time pairing (TaskDevice): the device credential has its own sealed slot; derived session
 // connections are ordinary profiles and are rewritten together whenever the token renews.
 private static final String DEVICE="device_sealed_v1";private static final byte[] DEVICE_AAD="io-agent/task-device/1".getBytes(StandardCharsets.UTF_8);
 TaskDevice loadDevice()throws Exception{synchronized(LOCK){String text=prefs.getString(DEVICE,null);if(text==null)return null;byte[] plain=open(text,DEVICE_AAD,16384);try{return TaskDevice.decode(plain);}finally{Arrays.fill(plain,(byte)0);}}}
 void saveDevice(TaskDevice device)throws Exception{synchronized(LOCK){byte[] plain=device.encode();try{if(!prefs.edit().putString(DEVICE,seal(plain,DEVICE_AAD)).commit())throw new IllegalStateException("TASK_CONFIG_SAVE_FAILED");}finally{Arrays.fill(plain,(byte)0);}}}
 String phoneAccount(TaskDevice d){return prefs.getString("phone_account_"+d.deviceId,"");}
 void phoneAccount(TaskDevice d,String account){TaskWire.require(prefs.edit().putString("phone_account_"+d.deviceId,account).commit(),"TASK_CONFIG_SAVE_FAILED");}
 void clearDevice(){synchronized(LOCK){prefs.edit().remove(DEVICE).commit();}}
 private static final String DIRECTORY="session_directory_v1",DEFAULT_REQUEST="session_default_request_v1";
 private static final byte[] DIRECTORY_AAD="io-agent/session-directory/1".getBytes(StandardCharsets.UTF_8),DEFAULT_AAD="io-agent/default-request/1".getBytes(StandardCharsets.UTF_8);
 TaskSessionDirectory loadDirectory(TaskDevice d)throws Exception{synchronized(LOCK){String value=prefs.getString(DIRECTORY,null);if(value==null)return null;byte[] bytes=open(value,DIRECTORY_AAD,1048576);try{return TaskSessionDirectory.cached(bytes,d.server,d.owner);}finally{Arrays.fill(bytes,(byte)0);}}}
 void saveDirectory(TaskSessionDirectory directory)throws Exception{synchronized(LOCK){TaskWire.require(prefs.edit().putString(DIRECTORY,seal(directory.encode(),DIRECTORY_AAD)).commit(),"TASK_CONFIG_SAVE_FAILED");}}
 Map<String,Object> defaultRequest(TaskDevice d)throws Exception{synchronized(LOCK){String value=prefs.getString(DEFAULT_REQUEST,null);if(value==null)return null;byte[] bytes=open(value,DEFAULT_AAD,8192);try{Map<String,Object> saved=WireJson.map(WireJson.read(bytes));if(!d.server.equals(saved.get("server"))||!d.owner.equals(saved.get("owner"))||!d.deviceId.equals(saved.get("device")))return null;Map<String,Object> request=WireJson.map(saved.get("request"));BoundedJson.keys(request,"request_id","expected_revision","route");TaskSessionDirectory.uuid(request.get("request_id"));TaskWire.nonnegative(request.get("expected_revision"));if(request.get("route")!=null)TaskSessionDirectory.route(request.get("route"));return request;}finally{Arrays.fill(bytes,(byte)0);}}}
 void saveDefaultRequest(TaskDevice d,Map<String,Object> request)throws Exception{synchronized(LOCK){byte[] bytes=WireJson.bytes(WireJson.object("server",d.server,"owner",d.owner,"device",d.deviceId,"request",request));TaskWire.require(prefs.edit().putString(DEFAULT_REQUEST,seal(bytes,DEFAULT_AAD)).commit(),"TASK_CONFIG_SAVE_FAILED");}}
 void clearDefaultRequest()throws Exception{synchronized(LOCK){TaskWire.require(prefs.edit().remove(DEFAULT_REQUEST).commit(),"TASK_CONFIG_SAVE_FAILED");}}
 /** Only explicit picker/default use materializes a directory target. A full registry makes room
  * with TaskProfiles.makeRoom; a connection with unanswered questions is never the one given up. */
 boolean ensureSession(TaskDevice device,Map<String,Object> route,long now,Set<String> keep,Set<String> online)throws Exception{synchronized(LOCK){
  TaskSessionDirectory.route(route);TaskProfiles current=loadAll();TaskConnection connection=device.derive(route,now);
  for(TaskProfiles.Profile p:current.profiles)if(p.binding.equals(connection.binding())){if(p.connection.token().equals(device.token))return false;write(current.upsert(connection,p.enabled,now,false));return true;}
  current=current.makeRoom(device,keep,online,now);Set<String> hidden=removed();hidden.remove(connection.binding());write(current.upsert(connection,true,now,current.selected()==null),hidden);return true;
 }}
 void pauseDevice(TaskDevice device)throws Exception{synchronized(LOCK){TaskProfiles next=loadAll();long now=System.currentTimeMillis();for(TaskProfiles.Profile p:next.profiles)if(device.owns(p.connection)&&p.enabled)next=next.enabled(p.binding,false,now);write(next);}}
 /** Adds connections for newly joined sessions and moves every derived connection to the device's
  * current token in one write. When full, a new session takes the oldest idle slot (TaskProfiles.makeRoom); if
  * every slot is busy or the default, capacity is reported explicitly. */
 boolean syncDevice(TaskDevice device,List<Map<String,Object>> routes,Set<String> busy,Set<String> online,long now)throws Exception{synchronized(LOCK){
  TaskProfiles current=loadAll(),next=current;Set<String> hidden=removed();
  for(TaskProfiles.Profile p:current.profiles)if(device.owns(p.connection)&&!p.connection.token().equals(device.token))next=next.upsert(device.derive(p.connection.route(),now),p.enabled,now,false);
  for(Map<String,Object> route:routes){
   TaskConnection c=device.derive(route,now);if(hidden.contains(c.binding()))continue;boolean known=false;for(TaskProfiles.Profile p:next.profiles)known|=p.binding.equals(c.binding());if(known)continue;
   try{next=next.makeRoom(device,busy,online,now);}catch(RuntimeException full){if(!"TASK_PROFILES_FULL".equals(full.getMessage()))throw full;break;}
   // Discovery never substitutes another session for an explicit default, even when
   // that default is paused or expired. Only an empty registry needs an initial choice.
   TaskProfiles.Profile selected=next.selected();next=next.upsert(c,true,now,selected==null);
  }
  if(Arrays.equals(next.encode(),current.encode()))return false;write(next);return true;
 }}
}
