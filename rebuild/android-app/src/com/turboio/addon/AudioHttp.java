package com.turboio.addon;

import java.io.*;import java.net.*;import javax.net.ssl.HttpsURLConnection;

/** Explicit audio bearer, TLS-only fixed routes and bounded JSON. */
final class AudioHttp implements MaterialApi.Transport {
 private final AudioConnection connection;private volatile boolean disabled;private volatile HttpsURLConnection active;
 AudioHttp(AudioConnection connection){this.connection=connection;}
 public MaterialApi.Response exchange(String path,byte[] payload)throws IOException{
  if(disabled)throw new IOException("AUDIO_PAUSED");
  if(!(payload==null&&path.equals("/identity")||payload!=null&&payload.length<=262144&&(path.equals("/audio-uploads")||path.matches("/audio-uploads/[a-f0-9]{64}/(?:finalize|parts/(?:0|[1-9][0-9]{0,3}))"))))throw new IOException("AUDIO_PATH_INVALID");
  HttpsURLConnection request=(HttpsURLConnection)new URL(connection.base+path).openConnection();active=request;
  try{if(disabled)throw new IOException("AUDIO_PAUSED");request.setInstanceFollowRedirects(false);request.setUseCaches(false);request.setAllowUserInteraction(false);request.setConnectTimeout(5000);request.setReadTimeout(10000);request.setRequestMethod(payload==null?"GET":"POST");request.setRequestProperty("Authorization","Bearer "+connection.token());request.setRequestProperty("Accept","application/json");request.setRequestProperty("Accept-Encoding","identity");
   if(payload!=null){request.setDoOutput(true);request.setRequestProperty("Content-Type","application/json");request.setFixedLengthStreamingMode(payload.length);try(OutputStream out=request.getOutputStream()){out.write(payload);}}
   int status=request.getResponseCode();if(status>=300&&status<400)throw new IOException("AUDIO_REDIRECT_REFUSED");String type=request.getContentType(),encoding=request.getContentEncoding();if(type==null||!type.matches("(?i)application/json(?:\\s*;\\s*charset=utf-8)?")||encoding!=null&&!encoding.equalsIgnoreCase("identity"))throw new IOException("AUDIO_RESPONSE_INVALID");int limit=path.equals("/identity")?16384:262144;AudioUploadWire.check(request.getContentLengthLong()<=limit,"AUDIO_RESPONSE_BUDGET");ByteArrayOutputStream bytes=new ByteArrayOutputStream();InputStream stream=status>=400?request.getErrorStream():request.getInputStream();if(stream!=null)try(InputStream in=stream){byte[] block=new byte[8192];int n;while((n=in.read(block))!=-1){AudioUploadWire.check(bytes.size()+n<=limit,"AUDIO_RESPONSE_BUDGET");bytes.write(block,0,n);}}
   long after=0;String retry=request.getHeaderField("Retry-After");if(retry!=null&&retry.matches("[0-9]{1,6}"))after=Math.min(86400000,Long.parseLong(retry)*1000);return new MaterialApi.Response(status,bytes.toByteArray(),after);
  }finally{if(active==request)active=null;request.disconnect();}
 }
 public void cancel(){disabled=true;HttpsURLConnection old=active;if(old!=null)old.disconnect();}
}
