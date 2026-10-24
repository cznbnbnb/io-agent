package com.turboio.addon;

import java.nio.charset.StandardCharsets;
import java.util.*;

/** One-time phone pairing (2026-10-24, user: pair once instead of importing a file per session).
 * The phone keeps one renewing device credential; every agent session that joins on a computer
 * shows up in its inbox as a task route, and gets its own ordinary connection derived from the
 * device credential. Bindings exclude the token, so a renewal keeps every mailbox. */
final class TaskDevice {
 static final String FORMAT="io-agent-task-device/1",BASE="https://cznbnb.cn/io-api/v1/";
 static final String[] KEYS={"format","base_url","owner_id","producer_id","server_id","token","token_id","expires_at","refresh_after","device_id","label","cursor"};
 private static final String ALPHABET="23456789ABCDEFGHJKMNPQRSTVWXYZ";
 final String base,owner,producer,server,token,tokenId,expires,refresh,deviceId,label,cursor;
 final long expiresAt,refreshAt;
 private TaskDevice(Map<String,Object> v){
  BoundedJson.keys(v,KEYS);TaskConnection.require(FORMAT.equals(v.get("format")),"TASK_DEVICE_INVALID");
  base=TaskConnection.text(v.get("base_url"),2048);owner=TaskConnection.text(v.get("owner_id"),512);producer=TaskConnection.text(v.get("producer_id"),512);server=TaskConnection.text(v.get("server_id"),512);
  token=TaskConnection.text(v.get("token"),2048);tokenId=TaskConnection.text(v.get("token_id"),64);expires=TaskConnection.text(v.get("expires_at"),40);refresh=TaskConnection.text(v.get("refresh_after"),40);
  deviceId=TaskConnection.text(v.get("device_id"),64);label=TaskConnection.text(v.get("label"),256);
  TaskConnection.require(v.get("cursor") instanceof String&&((String)v.get("cursor")).length()<=4096,"TASK_DEVICE_INVALID");cursor=(String)v.get("cursor");
  TaskConnection.require(producer.matches("phone-[0-9a-f]{8}")&&deviceId.matches("[0-9a-f-]{36}")&&token.matches("[A-Za-z0-9_-]{43}"),"TASK_DEVICE_INVALID");
  expiresAt=TaskConnection.stamp(expires);refreshAt=TaskConnection.stamp(refresh);TaskConnection.require(refreshAt<expiresAt,"TASK_DEVICE_INVALID");
  derive(route("pairing-check","pairing-check","pairing-check","pairing-check"),0);
 }
 private static Map<String,Object> route(String c,String a,String p,String s){Map<String,Object> r=new TreeMap<>();r.put("computer_id",c);r.put("agent_id",a);r.put("project_id",p);r.put("session_id",s);return r;}
 /** Codes are shown as XXXXX-XXXXX; spaces, dashes and case do not matter. */
 static String code(String input){
  String s=input==null?"":input.toUpperCase(Locale.ROOT).replaceAll("[\\s-]","");
  TaskConnection.require(s.length()==10,"PAIRING_CODE_INVALID");for(char c:s.toCharArray())TaskConnection.require(ALPHABET.indexOf(c)>=0,"PAIRING_CODE_INVALID");return s;
 }
 static byte[] pairBody(String input){return WireJson.bytes(WireJson.object("code",code(input)));}
 /** Server reply of POST /v1/pair or /v1/credentials/refresh. A renewal must keep the device. */
 static TaskDevice issued(byte[] body,String base,TaskDevice prior,long now){
  Map<String,Object> r=BoundedJson.map(BoundedJson.read(body));
  TaskConnection.require("phone".equals(r.get("role")),"TASK_DEVICE_INVALID");
  List<Object> scopes=BoundedJson.list(r.get("scopes"));TaskConnection.require(scopes.containsAll(TaskConnection.SCOPES),"TASK_PHONE_SCOPE_REQUIRED");
  Map<String,Object> v=new TreeMap<>();v.put("format",FORMAT);v.put("base_url",base);
  for(String k:new String[]{"owner_id","producer_id","server_id","token","token_id","expires_at","refresh_after","device_id","label"})v.put(k,r.get(k));
  v.put("cursor",prior==null?"":prior.cursor);
  TaskDevice d=new TaskDevice(v);TaskConnection.require(d.expiresAt>now,"TASK_IMPORT_EXPIRED");
  if(prior!=null)TaskConnection.require(d.deviceId.equals(prior.deviceId)&&d.producer.equals(prior.producer)&&d.owner.equals(prior.owner)&&d.server.equals(prior.server),"TASK_IDENTITY_MISMATCH");
  return d;
 }
 static TaskDevice decode(byte[] bytes){return new TaskDevice(BoundedJson.map(BoundedJson.read(bytes)));}
 byte[] encode(){return BoundedJson.canonical(values(cursor));}
 private Map<String,Object> values(String nextCursor){
  Map<String,Object> v=new TreeMap<>();v.put("format",FORMAT);v.put("base_url",base);v.put("owner_id",owner);v.put("producer_id",producer);v.put("server_id",server);
  v.put("token",token);v.put("token_id",tokenId);v.put("expires_at",expires);v.put("refresh_after",refresh);v.put("device_id",deviceId);v.put("label",label);v.put("cursor",nextCursor);return v;
 }
 TaskDevice withCursor(String next){TaskConnection.require(next!=null&&next.length()<=4096,"TASK_PAGE_INVALID");return new TaskDevice(values(next));}
 boolean renewDue(long now){return now>=refreshAt&&now<expiresAt;}
 /** An ordinary connection for one joined session, carrying this device's current token. */
 TaskConnection derive(Map<String,Object> route,long now){
  Map<String,Object> v=new TreeMap<>();v.put("format",TaskConnection.FORMAT);v.put("base_url",base);v.put("owner_id",owner);v.put("producer_id",producer);v.put("server_id",server);
  v.put("token",token);v.put("token_id",tokenId);v.put("expires_at",expires);for(String k:new String[]{"computer_id","agent_id","project_id","session_id"})v.put(k,route.get(k));
  return TaskConnection.parse(WireJson.bytes(v),now);
 }
 boolean owns(TaskConnection c){return c.owner.equals(owner)&&c.producer.equals(producer)&&c.server.equals(server)&&c.base.equals(base.endsWith("/")?base.substring(0,base.length()-1):base);}
 /** Routes of open tasks on an inbox page that the four-ID connection format can carry. */
 static List<Map<String,Object>> openRoutes(Map<String,Object> page){
  List<Map<String,Object>> out=new ArrayList<>();Set<String> seen=new HashSet<>();
  for(Object raw:WireJson.list(page.get("items"))){
   Map<String,Object> item=WireJson.map(raw);if(!"task".equals(item.get("kind"))||!TaskWire.set("queued","agent_received","running","waiting_answer").contains(item.get("state")))continue;
   Map<String,Object> route=TaskWire.route(TaskWire.body(item).get("route"));boolean usable=true;
   for(Object part:route.values())usable&=part instanceof String&&((String)part).matches("[A-Za-z0-9_.-]{1,128}");
   if(usable&&seen.add(new String(WireJson.bytes(route),StandardCharsets.UTF_8)))out.add(route);
  }
  return out;
 }
 String preview(){return "已配对："+label+"\n有效期至："+expires+"（自动续期）";}
}
