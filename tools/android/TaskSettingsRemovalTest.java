package com.turboio.addon;
import android.content.*;
import java.security.*;
import java.util.*;

/** Real TaskSettings AES/GCM registry; only Android Keystore and preferences are substituted. */
public final class TaskSettingsRemovalTest {
 static int checks;static void yes(boolean value){checks++;if(!value)throw new AssertionError("removal check "+checks);}
 static final class Prefs implements SharedPreferences {
  final Map<String,String> values=new HashMap<>();boolean fail;
  public String getString(String key,String fallback){return values.getOrDefault(key,fallback);}public boolean contains(String key){return values.containsKey(key);}
  public Editor edit(){return new Editor(){final Map<String,String> changes=new HashMap<>();public Editor putString(String key,String value){changes.put(key,value);return this;}public Editor remove(String key){changes.put(key,null);return this;}public boolean commit(){if(fail)return false;for(Map.Entry<String,String> e:changes.entrySet())if(e.getValue()==null)values.remove(e.getKey());else values.put(e.getKey(),e.getValue());return true;}};}
 }
 static final class App extends Context {final Prefs prefs=new Prefs();public SharedPreferences getSharedPreferences(String name,int mode){yes(name.equals("io_agent_tasks_v1"));return prefs;}}
 static Map<String,Object> route(String session){return WireJson.object("computer_id","11111111-2222-4333-8444-555555555555","agent_id","codex","project_id","project","session_id",UUID.nameUUIDFromBytes(session.getBytes(java.nio.charset.StandardCharsets.UTF_8)).toString());}
 static TaskDevice device(long now,String token,String owner){return TaskDevice.issued(WireJson.bytes(WireJson.object("token",token,"token_id","aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee","expires_at",TaskWire.now(now+86400000),"refresh_after",TaskWire.now(now+43200000),"device_id","11111111-2222-4333-8444-555555555555","role","phone","label","test-phone","owner_id",owner,"producer_id","phone-11111111","server_id","80384449-a5c6-4630-bf1b-524a30454c92","scopes",Arrays.asList("materials:write","materials:read","tasks:write","tasks:read","tasks:update","requests:read","answers:write","messages:receive","receipts:phone"))),TaskDevice.BASE,null,now);}
 public static void main(String[] args)throws Exception {
  Provider provider=new Provider("AndroidKeyStore",1.0,"Synthetic boundary only"){};provider.put("KeyStore.AndroidKeyStore",MaterialSettingsTest.MemoryStore.class.getName());provider.put("KeyGenerator.AES",MaterialSettingsTest.MemoryGenerator.class.getName());Security.addProvider(provider);
  long now=System.currentTimeMillis();TaskDevice d=device(now,String.join("",Collections.nCopies(43,"A")),"owner-one");App app=new App();TaskSettings settings=new TaskSettings(app);Set<String> none=Collections.emptySet();List<Map<String,Object>> routes=Arrays.asList(route("offline"),route("online"));
  yes(settings.syncDevice(d,routes,none,none,now));String a=d.derive(routes.get(0),now).binding(),b=d.derive(routes.get(1),now).binding();yes(settings.loadAll().profiles.size()==2&&settings.loadAll().selected.equals(a));
  settings.forget(a);yes(settings.loadAll().profiles.size()==1&&settings.loadAll().selected.equals(b)&&settings.hasRemoved());
  TaskSettings restarted=new TaskSettings(app);yes(!restarted.syncDevice(d,routes,none,none,now));yes(restarted.loadAll().profiles.size()==1);
  List<Object> entries=new ArrayList<>();for(Map<String,Object> route:routes)entries.add(WireJson.object("route",route,"producer_id","agent-1234abcd","device_id","11111111-2222-4333-8444-555555555555","host_kind","codex","workspace","/project/test","label","offline","generation",1,"instance_id","11111111-2222-4333-8444-555555555555","lease_id","11111111-2222-4333-8444-555555555555","lease_expires_at",TaskWire.now(now+60000),"online",false,"busy",null,"capabilities",WireJson.object("can_execute",false,"exact_turn_interrupt",false,"descendants_proof",false,"atomic_queue_append",false,"native_queue_expiry",false),"reason","ended"));
  Map<String,Object> directoryWire=WireJson.object("schema_version","1.0","server_id",d.server,"owner_id",d.owner,"server_time",TaskWire.now(now),"sessions",entries,"default",WireJson.object("revision",0,"route",null,"updated_at",null));TaskSessionDirectory directory=TaskSessionDirectory.fresh(WireJson.bytes(directoryWire),d.server,d.owner,1000,1200);
  yes(restarted.removedRoutes(d,directory).equals(Collections.singleton(TaskSessionDirectory.routeKey(routes.get(0)))));

  TaskDevice renewed=device(now+1000,String.join("",Collections.nCopies(43,"B")),"owner-one");yes(restarted.syncDevice(renewed,routes,none,none,now+1000));yes(restarted.loadAll().profiles.size()==1&&restarted.loadAll().get(b).connection.token().equals(renewed.token));
  // Another account with the same session ids is not hidden by the old account's local removal.
  TaskDevice other=device(now,String.join("",Collections.nCopies(43,"C")),"owner-two");yes(restarted.syncDevice(other,Collections.singletonList(routes.get(0)),none,none,now));yes(restarted.loadAll().profiles.size()==2);yes(restarted.removedRoutes(other,directory).isEmpty());directoryWire.put("owner_id",other.owner);TaskSessionDirectory otherDirectory=TaskSessionDirectory.fresh(WireJson.bytes(directoryWire),other.server,other.owner,1000,1200);yes(restarted.removedRoutes(other,otherDirectory).isEmpty());
  // Explicitly picking/importing the original target restores it; automatic discovery alone does not.
  yes(restarted.ensureSession(renewed,routes.get(0),now+1000,none,none));yes(!restarted.hasRemoved()&&restarted.loadAll().profiles.size()==3);
  restarted.forget(a);yes(restarted.restoreRemoved(renewed,directory,now+1000)==1);yes(!restarted.syncDevice(renewed,routes,none,none,now+1000));yes(restarted.loadAll().profiles.size()==3);
  // Restore affects only entries in this account directory, and reports the actual count.
  restarted.forget(a);String otherBinding=other.derive(routes.get(0),now).binding();restarted.forget(otherBinding);yes(restarted.restoreRemoved(renewed,directory,now+1000)==1);yes(restarted.hasRemoved()&&restarted.removedRoutes(other,otherDirectory).size()==1);yes(restarted.restoreRemoved(renewed,directory,now+1000)==0);
  // Deleting the final local registration leaves no rollback credential, while a failed commit removes nothing.
  App single=new App();TaskSettings last=new TaskSettings(single);last.save(d.derive(route("only"),now),true,true);String only=last.loadAll().selected;single.prefs.fail=true;boolean failed=false;try{last.forget(only);}catch(IllegalStateException expected){failed=true;}yes(failed&&last.loadAll().profiles.size()==1&&!last.hasRemoved());single.prefs.fail=false;
  last.forget(only);yes(last.loadAll().profiles.isEmpty()&&last.load()==null&&!single.prefs.contains("sealed"));yes(!new TaskSettings(single).syncDevice(d,Collections.singletonList(route("only")),none,none,now));
  last.saveQuestion(d.derive(route("only"),now),true);yes(!last.hasRemoved()&&last.loadAll().profiles.size()==1);
  System.out.println("Task settings removal: "+checks+" checks passed (restart, auto-discovery, token renewal, account isolation, explicit restoration, last-target removal, atomic failure)");
 }
}
