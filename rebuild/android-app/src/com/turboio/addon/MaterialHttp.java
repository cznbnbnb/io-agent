package com.turboio.addon;

import java.io.*;import java.net.*;import javax.net.ssl.HttpsURLConnection;

/** Bounded TLS-only material transport. No cookies, redirects, task paths or ambient credentials. */
final class MaterialHttp implements MaterialApi.Transport {
 private final MaterialConnection connection;private volatile HttpsURLConnection active;private volatile boolean disabled;
 MaterialHttp(MaterialConnection connection){this.connection=connection;}
 public MaterialApi.Response exchange(String path,byte[] payload)throws IOException{
  if(disabled)throw new IOException("MATERIAL_PAUSED");
  boolean pairing=path.equals("/material-pairing/refresh")||path.equals("/material-pairing/revoke");
  if(!(payload!=null&&(path.equals("/lifelog-text/source")||path.equals("/daily-context/source"))&&payload.length<=4198400||payload!=null&&(path.equals("/lifelog-text/head")||path.equals("/daily-context/head"))&&payload.length<=1024||pairing&&connection.paired()&&payload!=null&&payload.length<=1024||path.equals("/material-pairing/recover")&&payload!=null&&payload.length<=1024||payload==null&&(path.equals("/identity")||path.matches("/events/(?:[A-Za-z0-9._~-]|%[A-Fa-f0-9]{2}){1,4608}"))||payload!=null&&(path.equals("/daily-summary-head")||path.equals("/material-events")||path.equals("/material-cancellations")||path.equals("/material-uploads")||path.matches("/material-uploads/[a-f0-9]{64}/(?:finalize|parts/(?:0|[1-9][0-9]{0,2}))"))&&payload.length<=262144))throw new IOException("MATERIAL_PATH_INVALID");
  HttpsURLConnection request=(HttpsURLConnection)new URL(connection.base+path).openConnection();active=request;
  try{if(disabled)throw new IOException("MATERIAL_PAUSED");request.setInstanceFollowRedirects(false);request.setUseCaches(false);request.setConnectTimeout(5000);request.setReadTimeout(10000);request.setRequestMethod(payload==null?"GET":"POST");request.setRequestProperty("Authorization","Bearer "+(pairing?connection.refreshSecret:connection.token()));request.setRequestProperty("Accept","application/json");request.setRequestProperty("Accept-Encoding","identity");
   if(payload!=null){request.setDoOutput(true);request.setRequestProperty("Content-Type","application/json");request.setFixedLengthStreamingMode(payload.length);try(OutputStream out=request.getOutputStream()){out.write(payload);}}
   int status=request.getResponseCode();if(status>=300&&status<400)throw new IOException("MATERIAL_REDIRECT_REFUSED");String type=request.getContentType(),encoding=request.getContentEncoding();if(type==null||!type.matches("(?i)application/json(?:\\s*;\\s*charset=utf-8)?")||encoding!=null&&!encoding.equalsIgnoreCase("identity"))throw new IOException("MATERIAL_RESPONSE_INVALID");
   int limit=(pairing||path.equals("/material-pairing/recover")||path.equals("/identity"))?16384:1048576;if(request.getContentLengthLong()>limit)throw new IOException("MATERIAL_RESPONSE_BUDGET");ByteArrayOutputStream bytes=new ByteArrayOutputStream();InputStream stream=status>=400?request.getErrorStream():request.getInputStream();if(stream!=null)try(InputStream in=stream){byte[] block=new byte[8192];int n;while((n=in.read(block))!=-1){if(bytes.size()+n>limit)throw new IOException("MATERIAL_RESPONSE_BUDGET");bytes.write(block,0,n);}}
   long after=0;String retry=request.getHeaderField("Retry-After");if(retry!=null&&retry.matches("[0-9]{1,6}"))after=Math.min(86400000,Long.parseLong(retry)*1000);return new MaterialApi.Response(status,bytes.toByteArray(),after);
  }finally{if(active==request)active=null;request.disconnect();}
 }
 void disable(){disabled=true;}
 public void cancel(){disable();HttpsURLConnection request=active;if(request!=null)request.disconnect();}
}
