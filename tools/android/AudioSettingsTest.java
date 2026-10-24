package com.turboio.addon;

import android.content.*;import java.io.*;import java.nio.file.*;import java.security.*;import java.util.*;

/** Production settings + real AES/GCM and files. Keystore/prefs are substitutes. */
public final class AudioSettingsTest {
 static int checks;static void yes(boolean value){checks++;if(!value)throw new AssertionError("audio settings "+checks);}interface Work{void run()throws Exception;}
 static void denied(Work work)throws Exception{try{work.run();throw new AssertionError("settings accepted");}catch(Exception expected){checks++;}}
 static void code(Work work,String expected)throws Exception{try{work.run();throw new AssertionError("settings accepted "+expected);}catch(IOException e){yes(expected.equals(e.getMessage()));}}
 static final class Prefs implements SharedPreferences {
  final Map<String,String> values=new HashMap<>();boolean fail,halt;int commits;
  public String getString(String k,String fallback){return values.getOrDefault(k,fallback);}public boolean contains(String k){return values.containsKey(k);}
  public Editor edit(){return new Editor(){final Map<String,String> pending=new HashMap<>();public Editor putString(String k,String v){pending.put(k,v);return this;}public boolean commit(){commits++;if(halt)Runtime.getRuntime().halt(83);values.putAll(pending);return !fail;}};}
 }
 static final class App extends Context {
  final File files;final Map<String,Prefs> namespaces=new HashMap<>();App(File files)throws Exception{this.files=files.getCanonicalFile();yes(this.files.isDirectory());}
  public File getFilesDir(){return files;}public SharedPreferences getSharedPreferences(String name,int mode){return namespaces.computeIfAbsent(name,k->new Prefs());}
  Prefs audio(){return namespaces.get("io_agent_audio_sync_v1");}
 }
 static AudioConfig config(long expiry)throws Exception{Map<String,Object> connection=WireJson.object("format",AudioConnection.FORMAT,"base_url","https://synthetic.invalid/v1","owner_id","synthetic-owner","producer_id","synthetic-phone","server_id","synthetic-server","token",String.join("",Collections.nCopies(43,"A")),"token_id","00000000-0000-4000-8000-000000000001","expires_at",TaskWire.now(expiry));return new AudioConfig(AudioConnection.parse(WireJson.bytes(connection),0),String.join("",Collections.nCopies(64,"a")),true);}
 static void provider(){Provider p=new Provider("AndroidKeyStore",1.0,"Synthetic boundary only"){};p.put("KeyStore.AndroidKeyStore",MaterialSettingsTest.MemoryStore.class.getName());p.put("KeyGenerator.AES",MaterialSettingsTest.MemoryGenerator.class.getName());Security.addProvider(p);}
 public static void main(String[] args)throws Exception{
  provider();App app=new App(new File(args[0]));AudioSettings settings=new AudioSettings(app);AudioConfig initial=config(System.currentTimeMillis()+3600000);Path fence=new File(app.files,"audio-sync-settings/state.json").toPath();
  if(args.length>1){if(args[1].equals("crash")){settings.save(initial);app.audio().halt=true;settings.save(initial.enabled(false));throw new AssertionError("halt not reached");}code(settings::load,"AUDIO_CONFIG_PENDING");yes("pending".equals(WireJson.map(WireJson.read(Files.readAllBytes(fence))).get("phase")));settings.save(initial.enabled(false));yes(!settings.load().enabled);System.out.println("Audio settings independent JVM: pending intent blocks old enabled recovery");return;}
  yes(settings.load()==null&&app.audio().values.isEmpty());settings.save(initial);yes(Arrays.equals(initial.encode(),settings.load().encode()));yes(initial.fingerprint().equals(AudioConfig.decode(initial.encode()).fingerprint()));yes(!initial.fingerprint().equals(initial.enabled(false).fingerprint()));String encrypted=app.audio().values.get("sealed_audio_v1");yes(!encrypted.contains(initial.connection.token()));
  Map<String,Object> target=WireJson.map(WireJson.read(initial.connection.encode()));target.put("format",MaterialConnection.FORMAT);MaterialConfig text=new MaterialConfig(MaterialConnection.parse(WireJson.bytes(target),0),initial.account,true);MaterialSettings material=new MaterialSettings(app);material.save(text);Map<String,String> textBefore=new HashMap<>(app.namespaces.get("io_agent_materials_v1").values);yes(MaterialSettingsTest.keys.containsKey("io.agent.audio.config.v1")&&MaterialSettingsTest.keys.containsKey("io.agent.materials.config.v1"));yes(!MaterialSettingsTest.keys.get("io.agent.audio.config.v1").equals(MaterialSettingsTest.keys.get("io.agent.materials.config.v1")));
  app.audio().values.put("sealed_audio_v1",textBefore.get("material_sealed_v2"));denied(settings::load);yes(textBefore.equals(app.namespaces.get("io_agent_materials_v1").values));app.audio().values.put("sealed_audio_v1",encrypted);yes(settings.load().enabled);
  byte[] changed=Base64.getDecoder().decode(encrypted);changed[changed.length-1]^=1;app.audio().values.put("sealed_audio_v1",Base64.getEncoder().encodeToString(changed));denied(settings::load);app.audio().values.put("sealed_audio_v1",encrypted);
  byte[] ready=Files.readAllBytes(fence);yes(!new String(ready,"UTF-8").contains(initial.account)&&!new String(ready,"UTF-8").contains(initial.connection.token()));Map<String,Object> bad=WireJson.map(WireJson.read(ready));bad.put("fingerprint",String.join("",Collections.nCopies(64,"0")));Files.write(fence,WireJson.bytes(bad));code(settings::load,"AUDIO_CONFIG_CHANGED");Files.write(fence,ready);
  Path partial=Paths.get(fence+".partial");Files.write(partial,ready);code(settings::load,"AUDIO_CONFIG_PENDING");Files.delete(partial);yes(settings.load().enabled);
  // Android may update the in-memory preference even when commit returns false.
  app.audio().fail=true;code(()->settings.save(initial.enabled(false)),"AUDIO_CONFIG_SAVE_FAILED");code(()->new AudioSettings(app).load(),"AUDIO_CONFIG_PENDING");app.audio().values.put("sealed_audio_v1",encrypted);code(()->new AudioSettings(app).load(),"AUDIO_CONFIG_PENDING");app.audio().fail=false;settings.save(initial.enabled(false));yes(!new AudioSettings(app).load().enabled);
  byte[] paused=Files.readAllBytes(fence);AudioConfig other=new AudioConfig(initial.connection,String.join("",Collections.nCopies(64,"b")),true);code(()->settings.save(other),"AUDIO_ACCOUNT_REBIND_REFUSED");yes(Arrays.equals(paused,Files.readAllBytes(fence))&&!settings.load().enabled);
  String cipher=app.audio().values.get("sealed_audio_v1");Files.delete(fence);code(settings::load,"AUDIO_CONFIG_CHANGED");yes(cipher.equals(app.audio().values.get("sealed_audio_v1")));settings.save(initial.enabled(false));yes(!settings.load().enabled);
  Key key=MaterialSettingsTest.keys.remove("io.agent.audio.config.v1");code(settings::load,"AUDIO_KEY_UNAVAILABLE");yes(!MaterialSettingsTest.keys.containsKey("io.agent.audio.config.v1"));MaterialSettingsTest.keys.put("io.agent.audio.config.v1",key);yes(!settings.load().enabled);
  Map<String,Object> invalid=WireJson.map(WireJson.read(initial.encode()));invalid.put("unexpected",true);denied(()->AudioConfig.decode(WireJson.bytes(invalid)));invalid.remove("unexpected");WireJson.map(invalid.get("connection")).put("format",MaterialConnection.FORMAT);code(()->AudioConfig.decode(WireJson.bytes(invalid)),"AUDIO_CONNECTION_FORMAT");
  AudioConfig expired=config(1000);yes(AudioConfig.decode(expired.encode()).connection.expiresAt==1000);yes(textBefore.equals(app.namespaces.get("io_agent_materials_v1").values));
  System.out.println("Audio settings: "+checks+" assertions passed; real GCM/files, separate slot/key/AAD and durable failed-save fence");
 }
}
