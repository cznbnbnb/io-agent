package com.turboio.addon;

import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.time.OffsetDateTime;
import java.time.format.DateTimeFormatter;
import java.time.format.ResolverStyle;
import java.util.*;

/** Runtime/platform-independent port of task-connection-v1; never enables a queue. */
final class TaskConnection {
 static final String FORMAT="turboio-task-connection/1";
 static final String[] KEYS={"format","base_url","owner_id","producer_id","server_id","token","token_id","expires_at","computer_id","agent_id","project_id","session_id"};
 static final List<String> SCOPES=Collections.unmodifiableList(Arrays.asList("tasks:read","tasks:write","tasks:update","requests:read","answers:write","messages:receive"));
 final String base,owner,producer,server,computer,agent,project,session,expires;
 final long expiresAt;
 private final Map<String,Object> values;
 private TaskConnection(Map<String,Object> values,long now){
  this.values=Collections.unmodifiableMap(new TreeMap<>(values));
  for(String key:KEYS)text(values.get(key),key.equals("token")?2048:2048);
  require(FORMAT.equals(values.get("format")),"TASK_IMPORT_FORMAT");
  base=base((String)values.get("base_url"));owner=text(values.get("owner_id"),512);producer=text(values.get("producer_id"),512);server=text(values.get("server_id"),512);
  computer=route(values.get("computer_id"));agent=route(values.get("agent_id"));project=route(values.get("project_id"));session=route(values.get("session_id"));
  require(((String)values.get("token")).matches("[A-Za-z0-9_-]{32,2048}"),"TASK_TOKEN_INVALID");
  require(((String)values.get("token_id")).matches("[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-4[a-fA-F0-9]{3}-[89abAB][a-fA-F0-9]{3}-[a-fA-F0-9]{12}"),"TASK_TOKEN_ID_INVALID");
  expires=(String)values.get("expires_at");expiresAt=stamp(expires);
  require(expiresAt>now,"TASK_IMPORT_EXPIRED");
 }
 static TaskConnection parse(byte[] data,long now){
  require(data!=null&&data.length<=8192,"TASK_IMPORT_BUDGET");
  Map<String,Object> values=BoundedJson.map(BoundedJson.read(data));BoundedJson.keys(values,KEYS);
  return new TaskConnection(values,now);
 }
 byte[] encode(){return BoundedJson.canonical(values);}
 String binding(){return TaskWire.hash(WireJson.bytes(WireJson.object("base",base,"owner",owner,"producer",producer,"server",server,"route",route())));}
 String token(){return (String)values.get("token");}
 Map<String,Object> route(){Map<String,Object> out=new TreeMap<>();for(String key:new String[]{"computer_id","agent_id","project_id","session_id"})out.put(key,values.get(key));return out;}
 String preview(){return base+"\n电脑："+computer+"\nAgent："+agent+"\n项目："+project+"\n会话："+session+"\n有效期："+expires;}
 void identity(byte[] bytes,long now){
  Map<String,Object> identity=BoundedJson.map(BoundedJson.read(bytes));
  require("1.0".equals(identity.get("schema_version"))&&owner.equals(identity.get("owner_id"))&&producer.equals(identity.get("producer_id"))&&server.equals(identity.get("server_id")),"TASK_IDENTITY_MISMATCH");
  long actual=stamp(identity.get("expires_at"));require(actual>now&&actual==expiresAt,"TASK_EXPIRY_MISMATCH");
  List<Object> scopes=BoundedJson.list(identity.get("scopes"));require(scopes.containsAll(SCOPES),"TASK_PHONE_SCOPE_REQUIRED");
 }
 static long stamp(Object value){
  String s=text(value,40);require(s.matches("[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\\.[0-9]{1,9})?Z"),"TASK_TIME_INVALID");
  try{return OffsetDateTime.parse(s,DateTimeFormatter.ISO_OFFSET_DATE_TIME.withResolverStyle(ResolverStyle.STRICT)).toInstant().toEpochMilli();}
  catch(RuntimeException error){throw new IllegalArgumentException("TASK_TIME_INVALID");}
 }
 private static String base(String s){
  try{
   URI uri=new URI(s);String host=uri.getHost(),raw=uri.getRawPath();
   require(s.length()<=2048&&"https".equals(uri.getScheme())&&host!=null&&host.matches("[A-Za-z0-9.-]+")&&!host.startsWith(".")&&!host.endsWith(".")&&!host.contains("..")&&(uri.getPort()==-1||uri.getPort()==443)&&uri.getUserInfo()==null&&uri.getRawQuery()==null&&uri.getRawFragment()==null,"TASK_TARGET_INVALID");
   require(raw!=null&&raw.matches("(?:/[A-Za-z0-9._-]+)*/?")&&!Arrays.asList(raw.split("/",-1)).contains(".")&&!Arrays.asList(raw.split("/",-1)).contains(".."),"TASK_TARGET_INVALID");
   return s.endsWith("/")?s.substring(0,s.length()-1):s;
  }catch(Exception error){throw new IllegalArgumentException("TASK_TARGET_INVALID");}
 }
 static String text(Object value,int limit){
  require(value instanceof String,"TASK_TEXT_INVALID");String s=(String)value;
  require(!s.isEmpty()&&s.getBytes(StandardCharsets.UTF_8).length<=limit,"TASK_TEXT_INVALID");
  for(char c:s.toCharArray())require(!Character.isISOControl(c),"TASK_TEXT_INVALID");return s;
 }
 private static String route(Object value){String s=text(value,128);require(s.matches("[A-Za-z0-9_.-]{1,128}"),"TASK_ROUTE_INVALID");return s;}
 static void require(boolean condition,String code){if(!condition)throw new IllegalArgumentException(code);}
}
