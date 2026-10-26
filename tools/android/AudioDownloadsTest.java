package com.turboio.addon;

import java.io.*;import java.net.*;import java.nio.file.*;import java.util.*;import java.util.concurrent.atomic.*;

/** Real read client/cache over isolated HTTP/SQLite; opaque synthetic bytes. */
public final class AudioDownloadsTest {
 static int checks;static void yes(boolean value){checks++;if(!value)throw new AssertionError("download check "+checks);}
 static Map<String,Object> row(Object value){return WireJson.map(value);}static long n(Object value)throws IOException{return AudioUploadWire.number(value);}
 static final class Network implements MaterialApi.Transport {
  final String base,token,mode;final AtomicBoolean allowed;final long[] now;int chunks;boolean used;
  Network(String base,String token,String mode,AtomicBoolean allowed,long[] now){this.base=base;this.token=token;this.mode=mode;this.allowed=allowed;this.now=now;}
  public MaterialApi.Response exchange(String path,byte[] payload)throws IOException{
   yes(payload==null);HttpURLConnection c=(HttpURLConnection)new URL(base+path).openConnection();c.setInstanceFollowRedirects(false);c.setConnectTimeout(3000);c.setReadTimeout(5000);c.setRequestProperty("Authorization","Bearer "+token);int status=c.getResponseCode();ByteArrayOutputStream out=new ByteArrayOutputStream();InputStream stream=status>=400?c.getErrorStream():c.getInputStream();if(stream!=null)try(InputStream in=stream){byte[] block=new byte[8192];int got;while((got=in.read(block))!=-1){yes(out.size()+got<=262144);out.write(block,0,got);}}c.disconnect();byte[] response=out.toByteArray();
   if(path.contains("?index=")){chunks++;if(mode.equals("cancel"))allowed.set(false);if(mode.equals("expires"))now[0]+=1000;
    if(!used&&Arrays.asList("bad-part","wrong-expiry","whole-mismatch").contains(mode)&&status==200){used=true;Map<String,Object> v=row(WireJson.read(response));if(mode.equals("wrong-expiry"))v.put("expires_at",TaskWire.now(AudioUploadWire.time(v.get("expires_at"))+1));else{byte[] data=Base64.getDecoder().decode((String)v.get("data"));data[0]^=1;v.put("data",Base64.getEncoder().encodeToString(data));if(mode.equals("whole-mismatch"))v.put("part_sha256",TaskWire.hash(data));}response=WireJson.bytes(v);}
   }else if(mode.equals("meta-drift")&&path.startsWith("/audio/")&&status==200){Map<String,Object> v=row(WireJson.read(response));v.put("source_body_sha256","0".repeat(64));response=WireJson.bytes(v);}return new MaterialApi.Response(status,response,0);
  }
  public void cancel(){allowed.set(false);}
 }
 interface Fails {void run()throws Exception;}static void rejects(String code,Fails action)throws Exception{try{action.run();throw new AssertionError("accepted "+code);}catch(IOException e){yes(code.equals(e.getMessage()));}}
 public static void main(String[] args)throws Exception{
  File cache=new File(args[0]);Map<String,Object> fixture=row(WireJson.read(Files.readAllBytes(Paths.get(args[1])),1048576,20000));String mode=args[2];long[] now={n(fixture.get("now"))};AudioConnection connection=AudioConnection.parse(WireJson.bytes(fixture.get(mode.equals("scope")?"text_connection":"connection")),0);AudioConfig config=new AudioConfig(connection,"a".repeat(64),false);Map<String,Object> receipt=row(fixture.get("receipt"));String material=(String)receipt.get("material_id"),object=(String)receipt.get("object_id");AtomicBoolean allowed=new AtomicBoolean(true);File dir=new File(cache,"lifelog-audio-downloads/"+config.account+"/"+connection.binding()+"/"+object);boolean[] armed={true};
  LifelogAudioArchive.Guard guard=()->{if(!allowed.get())throw new IOException("OFFICIAL_ACCOUNT_CHANGED");if(!armed[0])return;File partial=new File(dir,"payload.partial"),ready=new File(dir,"payload.bin"),state=new File(dir,"state.json");if(mode.startsWith("crash-")&&state.isFile()){
   Map<String,Object> saved=row(WireJson.read(Files.readAllBytes(state.toPath())));int count=WireJson.list(saved.get("part_hashes")).size();
   if(mode.equals("crash-tail")&&partial.length()>0&&count==0)Runtime.getRuntime().halt(88);
   if(mode.equals("crash-cursor")&&partial.length()>0&&count==1)Runtime.getRuntime().halt(89);
   if(mode.equals("crash-rename")&&ready.isFile()&&"downloading".equals(saved.get("phase")))Runtime.getRuntime().halt(90);
  }};
  Network network=new Network((String)fixture.get("endpoint"),connection.token(),mode,allowed,now);
  if(mode.equals("scope")){rejects("AUDIO_SCOPE_REQUIRED",()->AudioDownloads.list(connection,material,null,network,guard,()->now[0]));yes(network.chunks==0);return;}
  if(mode.equals("list")){Set<String> seen=new HashSet<>();String cursor=null;int pages=0;do{AudioDownloads.Page page=AudioDownloads.list(connection,material,cursor,network,guard,()->now[0]);for(Object v:page.objects)yes(seen.add((String)row(v).get("object_id")));cursor=page.next;pages++;}while(cursor!=null);yes(seen.size()==n(fixture.get("objects"))&&pages==2);return;}
  if(mode.equals("deny-first")){allowed.set(false);rejects("OFFICIAL_ACCOUNT_CHANGED",()->new AudioDownloads(cache,config,guard));yes(!new File(cache,"lifelog-audio-downloads").exists());return;}
  if(mode.equals("linked")){rejects("AUDIO_DOWNLOAD_PATH",()->new AudioDownloads(cache,config,guard));yes(network.chunks==0);return;}
  AudioDownloads.Download result=null;
  try(AudioDownloads downloads=new AudioDownloads(cache,config,guard,mode.equals("capacity")?1024:AudioUploadWire.MAX,128)){
   if(mode.equals("capacity")){rejects("AUDIO_DOWNLOAD_CAPACITY",()->downloads.fetch(receipt,network,()->now[0],1));yes(network.chunks==0);}
   else if(mode.equals("cancel")){rejects("OFFICIAL_ACCOUNT_CHANGED",()->downloads.fetch(receipt,network,()->now[0],3));yes(network.chunks==1&&new File(dir,"payload.partial").length()==0);allowed.set(true);}
   else if(mode.equals("bad-part")||mode.equals("wrong-expiry")||mode.equals("whole-mismatch")){String code=mode.equals("bad-part")?"AUDIO_DOWNLOAD_PART_INVALID":mode.equals("wrong-expiry")?"AUDIO_DOWNLOAD_PART_MISMATCH":"AUDIO_DOWNLOAD_HASH_MISMATCH";rejects(code,()->downloads.fetch(receipt,network,()->now[0],3));yes(!new File(dir,"payload.bin").exists());}
   else if(mode.equals("corrupt")){rejects("AUDIO_DOWNLOAD_CACHE_CHANGED",()->downloads.fetch(receipt,network,()->now[0],3));yes(network.chunks==0);}
   else if(mode.equals("foreign-state")){rejects("AUDIO_DOWNLOAD_STATE",()->downloads.fetch(receipt,network,()->now[0],3));rejects("AUDIO_DOWNLOAD_STATE",()->downloads.remove(object));yes(network.chunks==0&&new File(dir,"payload.partial").length()==131072);}
   else if(mode.equals("meta-drift")){rejects("AUDIO_DOWNLOAD_RECEIPT_CHANGED",()->downloads.fetch(receipt,network,()->now[0],3));yes(network.chunks==0&&!new File(dir,"payload.partial").exists());}
   else if(mode.equals("revoked")){rejects("AUDIO_AUTH_REQUIRED",()->downloads.fetch(receipt,network,()->now[0],3));yes(new File(dir,"payload.partial").length()==131072&&network.chunks==0);}
   else if(mode.equals("expires")){rejects("AUDIO_EXPIRED",()->downloads.fetch(receipt,network,()->now[0],3));yes(!new File(dir,"payload.bin").exists());}
   else if(mode.equals("cache-age")){rejects("AUDIO_DOWNLOAD_CACHE_EXPIRED",()->downloads.fetch(receipt,network,()->now[0],3));yes(network.chunks==0);}
   else if(mode.equals("remove")){
    result=downloads.fetch(receipt,network,()->now[0],3);yes(result.complete);File unknown=new File(dir,"keep-unknown");Files.write(unknown.toPath(),new byte[]{1});rejects("AUDIO_DOWNLOAD_PATH",()->downloads.remove(object));yes(result.file.exists()&&unknown.exists());Files.delete(unknown.toPath());downloads.remove(object);yes(!dir.exists());
   }else if(mode.equals("withdrawn")){rejects("MATERIAL_DELETED",()->downloads.fetch(receipt,network,()->now[0],3));yes(new File(dir,"payload.bin").isFile()&&network.chunks==0);}
   else{
    result=downloads.fetch(receipt,network,()->now[0],mode.equals("step")?1:3);
    if(mode.equals("step")){yes(!result.complete&&result.file==null&&result.confirmed==1&&network.chunks==1);}
    else{yes(result.complete&&result.confirmed==3&&result.file.isFile()&&TaskWire.hash(Files.readAllBytes(result.file.toPath())).equals(receipt.get("sha256")));int expected=mode.equals("resume")?2:mode.equals("recover-rename")||mode.equals("repeat")?0:3;yes(network.chunks==expected);}
   }
  }
  armed[0]=false;Map<String,Object> report=WireJson.object("checks",checks,"mode",mode,"chunks",network.chunks,"complete",result!=null&&result.complete,"confirmed",result==null?0:result.confirmed);if(result!=null&&result.file!=null&&result.file.exists())report.put("file_sha256",TaskWire.hash(Files.readAllBytes(result.file.toPath())));Files.write(new File(cache,"result.json").toPath(),WireJson.bytes(report));
  AudioReadHttp tls=new AudioReadHttp(connection);for(String route:new String[]{"/audio-uploads","/identity?token=bad","/audio/../../identity","/material-events"})rejects("AUDIO_PATH_INVALID",()->tls.exchange(route,null));rejects("AUDIO_PATH_INVALID",()->tls.exchange("/identity",new byte[]{1}));
  System.out.println("Audio downloads "+mode+": "+checks+" checks passed");
 }
}
