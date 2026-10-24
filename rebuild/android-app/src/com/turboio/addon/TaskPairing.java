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
 static void unpair(TaskDevice d)throws IOException{
  TaskApi.Response r=exchange("DELETE",d.base+"devices/"+d.deviceId,d.token,null);
  if(r.status!=200&&r.status!=401)throw new IOException(error(r));
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
