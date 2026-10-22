package com.turboio.addon;

import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import javax.net.ssl.HttpsURLConnection;

/** Bounded HTTPS transport. Default TLS trust, no redirect/cookie/credential logs. */
final class TaskHttp implements TaskApi.Transport {
 private final TaskConnection connection;private volatile HttpsURLConnection active;
 private volatile boolean disabled;
 TaskHttp(TaskConnection connection){this.connection=connection;}
 public TaskApi.Response exchange(String path,byte[] payload)throws IOException{
  if(disabled)throw new IOException("TASK_PAUSED");
  if(!path.startsWith("/")||path.startsWith("//")||path.indexOf('#')>=0||path.indexOf('\r')>=0||path.indexOf('\n')>=0)throw new IOException("TASK_PATH_INVALID");
  if(payload!=null&&payload.length>262144)throw new IOException("TASK_EVENT_BUDGET");
  HttpsURLConnection request=(HttpsURLConnection)new URL(connection.base+path).openConnection();active=request;
  try{
   if(disabled)throw new IOException("TASK_PAUSED");
   request.setInstanceFollowRedirects(false);request.setUseCaches(false);request.setConnectTimeout(5000);request.setReadTimeout(10000);
   request.setRequestMethod(payload==null?"GET":"POST");request.setRequestProperty("Authorization","Bearer "+connection.token());request.setRequestProperty("Accept","application/json");request.setRequestProperty("Accept-Encoding","identity");
   if(payload!=null){request.setDoOutput(true);request.setRequestProperty("Content-Type","application/json");request.setFixedLengthStreamingMode(payload.length);try(OutputStream out=request.getOutputStream()){out.write(payload);}}
   int status=request.getResponseCode();String content=request.getContentType();
   if(content==null||!content.matches("(?i)application/json(?:\\s*;\\s*charset=utf-8)?"))throw new IOException("TASK_RESPONSE_INVALID");
   if(request.getContentLengthLong()>1048576)throw new IOException("TASK_RESPONSE_BUDGET");
   InputStream incoming=status>=400?request.getErrorStream():request.getInputStream();ByteArrayOutputStream bytes=new ByteArrayOutputStream();
   if(incoming!=null)try(InputStream in=incoming){byte[] buffer=new byte[8192];int n;while((n=in.read(buffer))!=-1){if(bytes.size()+n>1048576)throw new IOException("TASK_RESPONSE_BUDGET");bytes.write(buffer,0,n);}}
   long retry=0;String after=request.getHeaderField("Retry-After");if(after!=null&&after.matches("[0-9]{1,6}"))retry=Math.min(86400000,Long.parseLong(after)*1000);
   return new TaskApi.Response(status,bytes.toByteArray(),retry);
  }finally{if(active==request)active=null;request.disconnect();}
 }
 public void cancel(){HttpsURLConnection request=active;if(request!=null)request.disconnect();}
 void disable(){disabled=true;}
}
