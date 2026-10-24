package com.turboio.addon;

import java.io.*;import java.net.*;import javax.net.ssl.HttpsURLConnection;

/** TLS-only audio reader. No write routes, redirects or ambient credentials. */
final class AudioReadHttp implements MaterialApi.Transport {
 private final AudioConnection connection;private volatile boolean disabled;private volatile HttpsURLConnection active;
 AudioReadHttp(AudioConnection connection){this.connection=connection;}
 public MaterialApi.Response exchange(String path,byte[] payload)throws IOException{
  if(disabled)throw new IOException("AUDIO_PAUSED");
  if(payload!=null||!(path.equals("/identity")||path.matches("/material-audio/rayneo-lifelog-[a-f0-9]{64}\\?limit=50(?:&after=[a-f0-9]{64})?")||path.matches("/audio/[a-f0-9]{64}(?:\\?index=(?:0|[1-9][0-9]{0,3}))?")))throw new IOException("AUDIO_PATH_INVALID");
  HttpsURLConnection request=(HttpsURLConnection)new URL(connection.base+path).openConnection();active=request;
  try{if(disabled)throw new IOException("AUDIO_PAUSED");request.setInstanceFollowRedirects(false);request.setUseCaches(false);request.setAllowUserInteraction(false);request.setConnectTimeout(5000);request.setReadTimeout(10000);request.setRequestMethod("GET");request.setRequestProperty("Authorization","Bearer "+connection.token());request.setRequestProperty("Accept","application/json");request.setRequestProperty("Accept-Encoding","identity");
   int status=request.getResponseCode();if(status>=300&&status<400)throw new IOException("AUDIO_REDIRECT_REFUSED");String type=request.getContentType(),encoding=request.getContentEncoding();if(type==null||!type.matches("(?i)application/json(?:\\s*;\\s*charset=utf-8)?")||encoding!=null&&!encoding.equalsIgnoreCase("identity"))throw new IOException("AUDIO_RESPONSE_INVALID");int limit=path.equals("/identity")?16384:262144;AudioUploadWire.check(request.getContentLengthLong()<=limit,"AUDIO_RESPONSE_BUDGET");ByteArrayOutputStream bytes=new ByteArrayOutputStream();InputStream stream=status>=400?request.getErrorStream():request.getInputStream();if(stream!=null)try(InputStream in=stream){byte[] block=new byte[8192];int n;while((n=in.read(block))!=-1){AudioUploadWire.check(bytes.size()+n<=limit,"AUDIO_RESPONSE_BUDGET");bytes.write(block,0,n);}}
   return new MaterialApi.Response(status,bytes.toByteArray(),0);
  }finally{if(active==request)active=null;request.disconnect();}
 }
 void disable(){disabled=true;}
 public void cancel(){disable();HttpsURLConnection old=active;if(old!=null)old.disconnect();}
}
