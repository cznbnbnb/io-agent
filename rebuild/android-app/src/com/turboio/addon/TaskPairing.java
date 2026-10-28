package com.turboio.addon;

import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import javax.net.ssl.HttpsURLConnection;

/** Device pairing calls (TaskDevice). Same transport rules as TaskHttp: default TLS trust, no
 * redirects, bounded bodies, no credential logs. Pairing itself is the only call without a bearer. */
final class TaskPairing {
 private TaskPairing(){}
 static TaskDevice pair(String code,long now)throws IOException{
  TaskApi.Response r=exchange("POST",TaskDevice.BASE+"pair",null,TaskDevice.pairBody(code));
  if(r.status!=200)throw new IOException(error(r));return TaskDevice.issued(r.body,TaskDevice.BASE,null,now);
 }
 /** 409: this token already renewed (an earlier reply was lost); the caller keeps the old one until it lapses. */
 static TaskDevice renew(TaskDevice d,long now)throws IOException{
  TaskApi.Response r=exchange("POST",d.base+"credentials/refresh",d.token,"{}".getBytes(StandardCharsets.UTF_8));
  if(r.status!=200)throw new IOException(r.status==401?"PAIRING_REVOKED":error(r));return TaskDevice.issued(r.body,d.base,d,now);
 }
 static Map<String,Object> inbox(TaskDevice d)throws IOException{
  TaskApi.Response r=exchange("GET",d.base+"inbox?limit=20"+(d.cursor.isEmpty()?"":"&cursor="+URLEncoder.encode(d.cursor,"UTF-8")),d.token,null);
  if(r.status==410)throw new IOException("CURSOR_RESET_REQUIRED");if(r.status!=200)throw new IOException(r.status==401?"PAIRING_REVOKED":error(r));
  return WireJson.map(WireJson.read(r.body));
 }
 static java.util.List<NativeTodoSession.Proposal> todoSuggestions(TaskDevice d)throws IOException{
  TaskApi.Response r=exchange("GET",d.base+"todo-suggestions",d.token,null);
  if(r.status==404)return java.util.Collections.emptyList();if(r.status!=200)throw new IOException(error(r));
  Map<String,Object> body=WireJson.map(WireJson.read(r.body));TaskWire.require("1.0".equals(body.get("schema_version")),"TODO_RESPONSE_INVALID");
  java.util.List<Object> rows=WireJson.list(body.get("items"));TaskWire.require(rows.size()<=20,"TODO_RESPONSE_INVALID");java.util.List<NativeTodoSession.Proposal> result=new java.util.ArrayList<>();
  for(Object row:rows)result.add(new NativeTodoSession.Proposal(row));return result;
 }
 static Map<String,Object> todoAction(TaskDevice d,String id,Map<String,Object> action)throws IOException{
  TaskWire.require(id.matches("todo-[a-f0-9]{64}"),"TODO_ID_INVALID");
  TaskApi.Response r=exchange("POST",d.base+"todo-suggestions/"+id,d.token,WireJson.bytes(action));if(r.status!=200)throw new IOException(error(r));
  Map<String,Object> body=WireJson.map(WireJson.read(r.body));TaskWire.require(id.equals(body.get("proposal_id")),"TODO_RESPONSE_INVALID");return body;
 }
 static TaskSessionDirectory directory(TaskDevice d,long now)throws IOException{
  TaskWire.require(d.expiresAt>now,"PAIRING_EXPIRED");TaskApi.Response identity=exchange("GET",d.base+"identity",d.token,null);if(identity.status!=200)throw new IOException(error(identity));
  Map<String,Object> who=WireJson.map(WireJson.read(identity.body));TaskWire.require("1.0".equals(who.get("schema_version"))&&d.owner.equals(who.get("owner_id"))&&d.server.equals(who.get("server_id"))&&d.producer.equals(who.get("producer_id"))&&d.expiresAt==TaskWire.stamp(who.get("expires_at")),"DIRECTORY_IDENTITY_MISMATCH");
  Object scopes=who.get("scopes");TaskWire.require(scopes instanceof java.util.List&&WireJson.list(scopes).containsAll(TaskConnection.SCOPES),"TASK_PHONE_SCOPE_REQUIRED");
  Object caps=who.get("capabilities");TaskWire.require(caps instanceof java.util.List&&WireJson.list(caps).contains(TaskSessionDirectory.CAPABILITY),"DIRECTORY_UNSUPPORTED");
  long start=TaskSessionDirectory.elapsed();TaskApi.Response reply=exchange("GET",d.base+"agent-sessions",d.token,null);long end=TaskSessionDirectory.elapsed();if(reply.status!=200)throw new IOException(error(reply));return TaskSessionDirectory.fresh(reply.body,d.server,d.owner,start,end);
 }
 static Map<String,Object> setDefault(TaskDevice d,Map<String,Object> request)throws IOException{
  TaskApi.Response reply=exchange("PUT",d.base+"agent-default",d.token,WireJson.bytes(request));if(reply.status!=200)throw new IOException(error(reply));return TaskSessionDirectory.defaultAck(reply.body,d.server,d.owner,request);
 }
 static void unpair(TaskDevice d)throws IOException{
  TaskApi.Response r=exchange("DELETE",d.base+"devices/"+d.deviceId,d.token,null);
  if(r.status!=200&&r.status!=401)throw new IOException(error(r));
 }
 static Map<String,Object> session(TaskDevice d,String action,Map<String,Object> body)throws IOException{
  if(!action.equals("preview")&&!action.equals("approve"))throw new IOException("SESSION_PAIRING_INVALID");
  TaskApi.Response r=exchange("POST",d.base+"session-pairings/"+action,d.token,WireJson.bytes(body));
  if(r.status!=200)throw new IOException(error(r));return WireJson.map(WireJson.read(r.body));
 }
 private static String error(TaskApi.Response r){try{Object code=WireJson.map(WireJson.map(WireJson.read(r.body)).get("error")).get("code");if(code instanceof String&&((String)code).matches("[A-Z][A-Z0-9_]{0,63}"))return (String)code;}catch(RuntimeException ignored){}return "TASK_HTTP_"+r.status;}
 private static TaskApi.Response exchange(String method,String url,String bearer,byte[] payload)throws IOException{
  if(!url.startsWith(TaskDevice.BASE)||url.indexOf('#')>=0||url.indexOf('\r')>=0||url.indexOf('\n')>=0)throw new IOException("TASK_PATH_INVALID");
  HttpsURLConnection request=(HttpsURLConnection)new URL(url).openConnection();
  try{
   request.setInstanceFollowRedirects(false);request.setUseCaches(false);request.setConnectTimeout(5000);request.setReadTimeout(10000);
   request.setRequestMethod(method);request.setRequestProperty("Accept","application/json");request.setRequestProperty("Accept-Encoding","identity");
   if(bearer!=null)request.setRequestProperty("Authorization","Bearer "+bearer);
   if(payload!=null){request.setDoOutput(true);request.setRequestProperty("Content-Type","application/json");request.setFixedLengthStreamingMode(payload.length);try(OutputStream out=request.getOutputStream()){out.write(payload);}}
   int status=request.getResponseCode();String content=request.getContentType();
   if(content==null||!content.matches("(?i)application/json(?:\\s*;\\s*charset=utf-8)?"))throw new IOException("TASK_RESPONSE_INVALID");
   InputStream incoming=status>=400?request.getErrorStream():request.getInputStream();ByteArrayOutputStream bytes=new ByteArrayOutputStream();
   if(incoming!=null)try(InputStream in=incoming){byte[] buffer=new byte[8192];int n;while((n=in.read(buffer))!=-1){if(bytes.size()+n>1048576)throw new IOException("TASK_RESPONSE_BUDGET");bytes.write(buffer,0,n);}}
   return new TaskApi.Response(status,bytes.toByteArray(),0);
  }finally{request.disconnect();}
 }
}
