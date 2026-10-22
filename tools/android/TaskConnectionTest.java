package com.turboio.addon;
import java.nio.charset.StandardCharsets;
import java.util.*;

public final class TaskConnectionTest {
 static Map<String,Object> sample(){Map<String,Object> m=new TreeMap<>();m.put("format",TaskConnection.FORMAT);m.put("base_url","https://synthetic.invalid/io-api/v1");for(String k:new String[]{"owner_id","producer_id","server_id","computer_id","agent_id","project_id","session_id"})m.put(k,"synthetic-"+k);m.put("token","AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");m.put("token_id","c0ffee00-0000-4000-8000-000000000001");m.put("expires_at","2026-10-20T10:00:00.000Z");return m;}
 static final long NOW=TaskConnection.stamp("2026-10-19T10:00:00Z");
 static void rejects(Runnable run){try{run.run();}catch(IllegalArgumentException expected){return;}throw new AssertionError("Rejected input was accepted");}
 static void mutation(String key,Object value){Map<String,Object> m=sample();m.put(key,value);rejects(()->TaskConnection.parse(BoundedJson.canonical(m),NOW));}
 public static void main(String[] args){
  TaskConnection c=TaskConnection.parse(BoundedJson.canonical(sample()),NOW);
  if(!Arrays.equals(c.encode(),BoundedJson.canonical(sample()))||c.preview().contains(c.token()))throw new AssertionError();
  for(String url:new String[]{"http://synthetic.invalid/io-api/v1","https://user:pw@synthetic.invalid/","https://synthetic.invalid/x?token=x","https://synthetic.invalid/x#y","https://synthetic.invalid/a/../v1","https://synthetic.invalid/a/%2e%2e/v1","https://synthetic.invalid:8443/v1","https://synthetic.invalid//v1"})mutation("base_url",url);
  mutation("format","turboio-material-connection/1");mutation("computer_id","../command");mutation("session_id","x\ncommand");mutation("token",42);mutation("enabled","true");mutation("token_id","not-a-uuid");
  for(String time:new String[]{"2026-02-29T10:00:00Z","2026-10-20T24:00:00Z","2026-10-20T10:00:60Z","2026-10-18T10:00:00Z","2026-10-20T10:00:00+00:00"})mutation("expires_at",time);
  String json=new String(BoundedJson.canonical(sample()),StandardCharsets.UTF_8);
  rejects(()->TaskConnection.parse((json.substring(0,json.length()-1)+",\"tok\\u0065n\":\"duplicate\"}").getBytes(StandardCharsets.UTF_8),NOW));
  rejects(()->TaskConnection.parse((json+" trailing").getBytes(StandardCharsets.UTF_8),NOW));rejects(()->TaskConnection.parse(new byte[8193],NOW));
  Map<String,Object> identity=new TreeMap<>();identity.put("schema_version","1.0");for(String key:new String[]{"owner_id","producer_id","server_id","expires_at"})identity.put(key,sample().get(key));identity.put("scopes",TaskConnection.SCOPES);c.identity(BoundedJson.canonical(identity),NOW);
  identity.put("owner_id","another-owner");rejects(()->c.identity(BoundedJson.canonical(identity),NOW));identity.put("owner_id",sample().get("owner_id"));identity.put("scopes",Arrays.asList("materials:read"));rejects(()->c.identity(BoundedJson.canonical(identity),NOW));identity.put("scopes",TaskConnection.SCOPES);identity.put("expires_at","2026-10-20T11:00:00Z");rejects(()->c.identity(BoundedJson.canonical(identity),NOW));
  System.out.println("Task connection contract: passed (strict import, URL, expiry, route, identity, scopes, secret-free preview)");
 }
}
