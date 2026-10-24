package com.turboio.addon;

import java.io.*;import java.net.*;import java.nio.file.*;import java.util.*;import java.util.concurrent.atomic.*;

/** Production audio client against an isolated real HTTP/SQLite service. */
public final class AudioUploadHttpTest {
 private static int checks;private static final String ACCOUNT=String.join("",Collections.nCopies(64,"a"));
 private static void yes(boolean value){checks++;if(!value)throw new AssertionError("audio upload check "+checks);}
 private static Map<String,Object> row(Object v){return WireJson.map(v);}
 private static long n(Object value)throws IOException{return AudioUploadWire.number(value);}
 private static byte[] bytes(File f)throws IOException{return Files.readAllBytes(f.toPath());}
 private static File input(File root,Map<String,Object> plan)throws Exception{Map<String,Object> m=row(plan.get("manifest"));File file=new File(root,"lifelog-audio-payloads/"+ACCOUNT+"/"+m.get("sha256")+"/payload.bin");if(!file.exists()){yes(file.getParentFile().mkdirs());byte[] data=Base64.getDecoder().decode((String)plan.get("data"));Files.write(file.toPath(),data);yes(TaskWire.hash(data).equals(m.get("sha256")));}return file;}
 private static Map<String,Object> only(AudioUploadOutbox q,long now)throws Exception{List<Object> rows=q.snapshot(now);yes(rows.size()==1);return row(rows.get(0));}
 private static File staged(File root,Map<String,Object> job){return new File(root,"lifelog-audio-uploads/payloads/"+job.get("id")+".bin");}
 static final class Loopback implements MaterialApi.Transport {
  final String endpoint,token,mode;final AtomicBoolean allowed;int posts,parts;boolean halted;
  Loopback(String endpoint,String token,String mode,AtomicBoolean allowed){this.endpoint=endpoint;this.token=token;this.mode=mode;this.allowed=allowed;}
  public MaterialApi.Response exchange(String path,byte[] data)throws IOException{
   yes(path.equals("/identity")||path.startsWith("/audio-uploads"));if(data!=null){yes(data.length<=262144);posts++;}HttpURLConnection c=(HttpURLConnection)new URL(endpoint+path).openConnection();c.setInstanceFollowRedirects(false);c.setConnectTimeout(3000);c.setReadTimeout(5000);c.setRequestMethod(data==null?"GET":"POST");c.setRequestProperty("Authorization","Bearer "+token);if(data!=null){c.setDoOutput(true);c.setRequestProperty("Content-Type","application/json");try(OutputStream out=c.getOutputStream()){out.write(data);}}
   int status=c.getResponseCode();InputStream in=status>=400?c.getErrorStream():c.getInputStream();ByteArrayOutputStream out=new ByteArrayOutputStream();if(in!=null)try(InputStream source=in){byte[] block=new byte[8192];int count;while((count=source.read(block))!=-1){yes(out.size()+count<=262144);out.write(block,0,count);}}c.disconnect();byte[] response=out.toByteArray();
   if(path.contains("/parts/")){parts++;if(mode.equals("part-crash")&&status==200)Runtime.getRuntime().halt(77);if(mode.equals("pause-part")&&status==200)allowed.set(false);}
   if(path.endsWith("/finalize")&&status==200){if(mode.equals("finalize-crash"))Runtime.getRuntime().halt(78);if(mode.equals("bad-ack")){Map<String,Object> ack=row(WireJson.read(response));ack.put("expires_at",TaskWire.now(AudioUploadWire.time(ack.get("stored_at"))+AudioUploadWire.TTL+1));response=WireJson.bytes(ack);}}
   return new MaterialApi.Response(status,response,0);
  }
  public void cancel(){allowed.set(false);}
 }
 public static void main(String[] args)throws Exception{
  File root=new File(args[0]);yes(root.isDirectory());Map<String,Object> fixture=row(WireJson.read(Files.readAllBytes(Paths.get(args[1])),4194304,20000));String mode=args[2],name=args[3];Map<String,Object> plan=row(row(fixture.get("plans")).get(name)),manifest=row(plan.get("manifest"));long now=n(fixture.get("now"));AudioConnection connection=AudioConnection.parse(WireJson.bytes(fixture.get(mode.equals("scope-block")?"text_connection":"connection")),now);String bodyHash=(String)fixture.get("body_sha256");AtomicBoolean allowed=new AtomicBoolean(true);AudioUploadOutbox.Guard guard=()->{if(!allowed.get())throw new IOException("AUDIO_PAUSED");File[] copies=new File(root,"lifelog-audio-uploads/payloads").listFiles();if(copies!=null)for(File f:copies){if(mode.equals("copy-crash")&&f.getName().endsWith(".partial")&&f.length()>0)Runtime.getRuntime().halt(79);if(mode.equals("ready-crash")&&f.getName().endsWith(".bin"))Runtime.getRuntime().halt(80);}};Loopback http=new Loopback((String)fixture.get("endpoint"),connection.token(),mode,allowed);
  yes(AudioUploadWire.bodyHash(row(fixture.get("material_body"))).equals(bodyHash));
  File source=input(root,plan);String sourceHash=TaskWire.hash(bytes(source));
  try(AudioUploadOutbox q=new AudioUploadOutbox(root,connection,ACCOUNT,guard)){
   String id=q.enqueue(source,manifest,bodyHash);yes(id.equals(only(q,now).get("id")));Map<String,Object> before=only(q,now);
   if(mode.equals("retry-receipt")){yes(q.retryBlocked(id,http,()->now));}
   if(mode.equals("scope-resume")){yes(q.resumeAuthorized(http,()->now)==1);}
   if(mode.equals("auth-mid-request")){try{q.pump(http,()->now);throw new AssertionError("mid-request revoke ignored");}catch(IOException expected){yes(expected.getMessage().equals("AUDIO_AUTH_REQUIRED"));}yes(only(q,now).get("state").equals("blocked")&&staged(root,before).isFile());}
   else if(mode.equals("scope-block")){try{q.pump(http,()->now);throw new AssertionError("scope accepted");}catch(IOException expected){yes(expected.getMessage().equals("AUDIO_SCOPE_REQUIRED"));}yes(http.posts==0&&only(q,now).get("state").equals("blocked")&&staged(root,before).isFile());}
   else if(mode.equals("corrupt-stage")){yes(staged(root,before).isFile());}
   else if(mode.equals("corrupt-send")){try{q.pump(http,()->now);throw new AssertionError("corrupt bytes sent");}catch(IOException expected){yes(expected.getMessage().equals("AUDIO_PAYLOAD_CHANGED"));}yes(http.parts==0&&only(q,now).get("state").equals("blocked")&&staged(root,before).isFile());}
   else if(mode.equals("pause-part")){try{q.pump(http,()->now);throw new AssertionError("pause ignored");}catch(IOException expected){yes(expected.getMessage().equals("AUDIO_PAUSED"));}yes(http.parts==1&&staged(root,before).isFile());allowed.set(true);}
   else if(mode.equals("repeat")||mode.equals("expired")){yes(!q.pump(http,()->now));yes(http.posts==0);yes(only(q,now).get("state").equals(mode.equals("expired")?"expired":"stored"));yes(!staged(root,before).exists());}
   else{for(int i=0;i<20;i++){try{if(!q.pump(http,()->now))break;}catch(IOException expected){if(!mode.equals("bad-ack"))throw expected;yes(expected.getMessage().equals("AUDIO_RECEIPT_TIME_INVALID"));break;}if(only(q,now).get("state").equals("stored"))break;}
    Map<String,Object> done=only(q,now);if(mode.equals("bad-ack")){yes(done.get("state").equals("blocked")&&done.get("receipt")==null&&staged(root,done).isFile());}
    else{yes(done.get("state").equals("stored")&&done.get("receipt")!=null&&!staged(root,done).exists());Map<String,Object> ack=row(done.get("receipt"));yes(AudioUploadWire.time(ack.get("expires_at"))-AudioUploadWire.time(ack.get("stored_at"))==AudioUploadWire.TTL);yes(Boolean.FALSE.equals(ack.get("recording_completeness_verified")));if(mode.equals("recover"))yes(http.parts==0);}
   }
   yes(sourceHash.equals(TaskWire.hash(bytes(source))));Files.write(new File(root,"result.json").toPath(),WireJson.bytes(WireJson.object("mode",mode,"rows",q.snapshot(now),"parts_sent",http.parts,"checks",checks,"source_preserved",true)));
  }
  // Fixed transport must reject every non-audio or ambiguous route before TLS.
  AudioHttp tls=new AudioHttp(connection);for(String path:new String[]{"/material-events","/tasks","/audio-uploads/../../identity","/identity?other=1"})try{tls.exchange(path,WireJson.bytes(WireJson.object()));throw new AssertionError("path accepted");}catch(IOException expected){yes(expected.getMessage().equals("AUDIO_PATH_INVALID"));}
  System.out.println("Audio upload "+mode+": "+checks+" assertions passed");
 }
}
