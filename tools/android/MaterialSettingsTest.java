package com.turboio.addon;
import android.content.*;import android.security.keystore.*;
import java.io.*;import java.security.*;import java.security.spec.*;import java.util.*;import javax.crypto.*;import javax.crypto.spec.*;

/** Production settings with real JCA AES/GCM. Android key/prefs boundaries are
 * in-memory substitutes; this is not a hardware-backed Android Keystore test. */
public final class MaterialSettingsTest {
 static int checks;static void yes(boolean b){checks++;if(!b)throw new AssertionError("Material settings "+checks);}interface Work{void run()throws Exception;}
 static void rejects(Work w)throws Exception{checks++;try{w.run();}catch(Exception expected){return;}throw new AssertionError("Expected settings rejection");}
 static final Map<String,Key> keys=new HashMap<>();static final String ALIAS="io.agent.materials.config.v1";
 public static final class MemoryStore extends KeyStoreSpi {
  public Key engineGetKey(String a,char[] p){return keys.get(a);}public java.security.cert.Certificate[] engineGetCertificateChain(String a){return null;}public java.security.cert.Certificate engineGetCertificate(String a){return null;}public Date engineGetCreationDate(String a){return new Date(0);}public void engineSetKeyEntry(String a,Key k,char[] p,java.security.cert.Certificate[] c){keys.put(a,k);}public void engineSetKeyEntry(String a,byte[] k,java.security.cert.Certificate[] c){throw new UnsupportedOperationException();}public void engineSetCertificateEntry(String a,java.security.cert.Certificate c){throw new UnsupportedOperationException();}public void engineDeleteEntry(String a){keys.remove(a);}public Enumeration<String> engineAliases(){return Collections.enumeration(keys.keySet());}public boolean engineContainsAlias(String a){return keys.containsKey(a);}public int engineSize(){return keys.size();}public boolean engineIsKeyEntry(String a){return keys.containsKey(a);}public boolean engineIsCertificateEntry(String a){return false;}public String engineGetCertificateAlias(java.security.cert.Certificate c){return null;}public void engineStore(OutputStream s,char[] p){}public void engineLoad(InputStream s,char[] p){}
 }
 public static final class MemoryGenerator extends KeyGeneratorSpi {
  String alias;protected void engineInit(SecureRandom r){}protected void engineInit(int bits,SecureRandom r){}protected void engineInit(AlgorithmParameterSpec p,SecureRandom r){alias=((KeyGenParameterSpec)p).alias;}protected SecretKey engineGenerateKey(){byte[] bytes=new byte[32];new SecureRandom().nextBytes(bytes);SecretKey key=new SecretKeySpec(bytes,"AES");keys.put(alias,key);return key;}
 }
 static final class Prefs implements SharedPreferences {
  final Map<String,String> values=new HashMap<>();int commits;boolean fail;
  public String getString(String key,String fallback){return values.getOrDefault(key,fallback);}public boolean contains(String key){return values.containsKey(key);}
  public Editor edit(){return new Editor(){final Map<String,String> pending=new HashMap<>();public Editor putString(String k,String v){pending.put(k,v);return this;}public boolean commit(){commits++;if(fail)return false;values.putAll(pending);return true;}};}
 }
 static final class App extends Context {final Prefs prefs=new Prefs();public SharedPreferences getSharedPreferences(String name,int mode){yes(name.equals("io_agent_materials_v1"));return prefs;}}
 static String seal(byte[] bytes,String aad)throws Exception{Cipher c=Cipher.getInstance("AES/GCM/NoPadding");c.init(Cipher.ENCRYPT_MODE,keys.get(ALIAS));c.updateAAD(aad.getBytes("UTF-8"));byte[] encrypted=c.doFinal(bytes),out=new byte[12+encrypted.length];System.arraycopy(c.getIV(),0,out,0,12);System.arraycopy(encrypted,0,out,12,encrypted.length);return Base64.getEncoder().encodeToString(out);}
 static byte[] open(String text,String aad)throws Exception{byte[] bytes=Base64.getDecoder().decode(text);Cipher c=Cipher.getInstance("AES/GCM/NoPadding");c.init(Cipher.DECRYPT_MODE,keys.get(ALIAS),new GCMParameterSpec(128,Arrays.copyOf(bytes,12)));c.updateAAD(aad.getBytes("UTF-8"));return c.doFinal(Arrays.copyOfRange(bytes,12,bytes.length));}
 public static void main(String[] args)throws Exception{
  Provider provider=new Provider("AndroidKeyStore",1.0,"Synthetic boundary only"){};provider.put("KeyStore.AndroidKeyStore",MemoryStore.class.getName());provider.put("KeyGenerator.AES",MemoryGenerator.class.getName());Security.addProvider(provider);
  long now=System.currentTimeMillis();MaterialConnection connection=MaterialConnection.parse(WireJson.bytes(WireJson.object("format",MaterialConnection.FORMAT,"base_url","https://synthetic.invalid/v1","owner_id","synthetic-owner","producer_id","synthetic-phone","server_id","synthetic-server","token",String.join("",Collections.nCopies(43,"A")),"token_id","00000000-0000-4000-8000-000000000001","expires_at",TaskWire.now(now+3600000))),now);
  MaterialConfig config=new MaterialConfig(connection,String.join("",Collections.nCopies(64,"a")),true);App empty=new App();MaterialSettings settings=new MaterialSettings(empty);yes(settings.load()==null&&empty.prefs.values.isEmpty());settings.save(config);yes(settings.load().enabled&&empty.prefs.commits==1);
  String projection=empty.prefs.values.get("sealed");yes(!MaterialConfig.decode(open(projection,"io-agent/material-connection/1")).enabled);yes(Arrays.equals(config.encode(),MaterialSettingsState.decode(open(empty.prefs.values.get("material_sealed_v2"),"io-agent/material-connection/2"),open(projection,"io-agent/material-connection/1")).encode()));
  rejects(()->open(empty.prefs.values.get("material_sealed_v2"),"io-agent/material-connection/1"));
  App legacy=new App();String old=seal(config.encode(),"io-agent/material-connection/1");legacy.prefs.values.put("sealed",old);MaterialSettings upgraded=new MaterialSettings(legacy);yes(upgraded.load().enabled&&legacy.prefs.commits==1);yes(legacy.prefs.values.get("material_backup_v1").equals(old));yes(!MaterialConfig.decode(open(legacy.prefs.values.get("sealed"),"io-agent/material-connection/1")).enabled);upgraded.load();yes(legacy.prefs.commits==1);
  upgraded.save(config.enabled(false));yes(!new MaterialSettings(legacy).load().enabled);String current=legacy.prefs.values.get("material_sealed_v2"),paused=legacy.prefs.values.get("sealed");byte[] corrupt=Base64.getDecoder().decode(current);corrupt[corrupt.length-1]^=1;legacy.prefs.values.put("material_sealed_v2",Base64.getEncoder().encodeToString(corrupt));rejects(upgraded::load);yes(paused.equals(legacy.prefs.values.get("sealed")));legacy.prefs.values.put("material_sealed_v2",current);
  legacy.prefs.values.put("sealed",seal(config.encode(),"io-agent/material-connection/1"));rejects(upgraded::load);yes(current.equals(legacy.prefs.values.get("material_sealed_v2")));legacy.prefs.values.put("sealed",paused);
  legacy.prefs.fail=true;rejects(()->upgraded.save(config));yes(current.equals(legacy.prefs.values.get("material_sealed_v2"))&&paused.equals(legacy.prefs.values.get("sealed")));legacy.prefs.fail=false;
  MaterialConfig other=new MaterialConfig(connection,String.join("",Collections.nCopies(64,"b")),true);rejects(()->upgraded.save(other));yes(!upgraded.load().enabled);
  App failing=new App();failing.prefs.values.put("sealed",old);failing.prefs.fail=true;rejects(()->new MaterialSettings(failing).load());yes(failing.prefs.values.size()==1&&old.equals(failing.prefs.values.get("sealed")));
  Map<String,Object> paired=new LinkedHashMap<>(WireJson.map(WireJson.read(connection.encode())));paired.put("format","turboio-material-sync/2");paired.put("pairing_id","test-pairing");paired.put("refresh_secret",String.join("",Collections.nCopies(43,"R")));paired.put("account_binding",config.account);
  MaterialConnection pc=MaterialConnection.parse(WireJson.bytes(paired),now+40L*86400000);yes(pc.paired()&&pc.renewDue(now+40L*86400000));
  MaterialConfig pairConfig=new MaterialConfig(pc,config.account,true);settings.save(pairConfig);yes(settings.load().connection.paired());yes(!MaterialConfig.decode(open(empty.prefs.values.get("sealed"),"io-agent/material-connection/1")).connection.paired());
  yes(!new String(pairConfig.connection.legacy().encode(),"UTF-8").contains("refresh_secret"));
  rejects(()->new MaterialConfig(pc,String.join("",Collections.nCopies(64,"b")),true));
  Map<String,Object> reply=new LinkedHashMap<>(paired);reply.remove("format");reply.remove("base_url");reply.remove("refresh_secret");reply.put("expires_at",TaskWire.now(now+86400000));
  MaterialConnection renewed=pc.renewed(WireJson.bytes(reply),now);yes(renewed.binding().equals(pc.binding())&&renewed.refreshSecret.equals(pc.refreshSecret)&&!renewed.renewDue(now));
  reply.put("owner_id","other");rejects(()->pc.renewed(WireJson.bytes(reply),now));reply.put("owner_id",pc.owner);reply.put("expires_at",TaskWire.now(now-1));rejects(()->pc.renewed(WireJson.bytes(reply),now));
  System.out.println("Material settings: "+checks+" assertions passed; real AES/GCM, atomic preference adapter, paused rollback projection and no tamper fallback");
 }
}
