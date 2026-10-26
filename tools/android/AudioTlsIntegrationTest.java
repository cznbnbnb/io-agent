package com.turboio.addon;

import java.io.*;import java.nio.file.*;import java.util.*;

/** Actual fixed AudioHttp over public TLS, isolated synthetic bytes only. */
public final class AudioTlsIntegrationTest {
 private static int checks;
 private static void yes(boolean value){checks++;if(!value)throw new AssertionError("TLS check "+checks);}
 public static void main(String[] args)throws Exception{
  File root=new File(args[0]);Map<String,Object> fixture=WireJson.map(WireJson.read(Files.readAllBytes(Paths.get(args[1])),1048576,20000));String mode=args[2],account=String.join("",Collections.nCopies(64,"a"));long now=System.currentTimeMillis();
  AudioConnection connection=AudioConnection.parse(WireJson.bytes(fixture.get("connection")),now);Map<String,Object> manifest=WireJson.map(fixture.get("manifest"));byte[] data=Base64.getDecoder().decode((String)fixture.get("data"));yes(TaskWire.hash(data).equals(manifest.get("sha256")));
  File source=new File(root,"lifelog-audio-payloads/"+account+"/"+manifest.get("sha256")+"/payload.bin");if(!source.exists()){yes(source.getParentFile().mkdirs());Files.write(source.toPath(),data);}else yes(Arrays.equals(Files.readAllBytes(source.toPath()),data));
  AudioHttp tls=new AudioHttp(connection);int[] parts={0};
  MaterialApi.Transport actual=new MaterialApi.Transport(){public MaterialApi.Response exchange(String path,byte[] bytes)throws IOException{MaterialApi.Response r=tls.exchange(path,bytes);if(path.contains("/parts/")&&r.status==200){parts[0]++;if(mode.equals("crash-part-response"))Runtime.getRuntime().halt(87);}return r;}public void cancel(){tls.cancel();}};
  try(AudioUploadOutbox queue=new AudioUploadOutbox(root,connection,account,()->{})){
   queue.enqueue(source,manifest,(String)fixture.get("body_sha256"));
   for(int n=0;n<12;n++){if(!queue.pump(actual,System::currentTimeMillis))break;Map<String,Object> row=WireJson.map(queue.snapshot(System.currentTimeMillis()).get(0));if(row.get("state").equals("stored"))break;}
   Map<String,Object> row=WireJson.map(queue.snapshot(System.currentTimeMillis()).get(0));yes(row.get("state").equals("stored"));Map<String,Object> receipt=WireJson.map(row.get("receipt"));yes(Boolean.FALSE.equals(receipt.get("recording_completeness_verified")));yes(AudioUploadWire.time(receipt.get("expires_at"))-AudioUploadWire.time(receipt.get("stored_at"))==AudioUploadWire.TTL);
   yes(parts[0]==2);yes(!queue.pump(actual,System::currentTimeMillis));yes(Arrays.equals(Files.readAllBytes(source.toPath()),data));
   Files.write(new File(root,"tls-result.json").toPath(),WireJson.bytes(WireJson.object("checks",checks,"parts_sent_after_resume",parts[0],"receipt",receipt,"source_preserved",true)));
   AudioConnection reader=AudioConnection.parse(WireJson.bytes(fixture.get("reader_connection")),System.currentTimeMillis());AudioConfig config=new AudioConfig(reader,account,false);File cache=new File(root,"reader-cache");yes(cache.mkdir());AudioReadHttp read=new AudioReadHttp(reader);
   try{AudioDownloads.Page page=AudioDownloads.list(reader,(String)manifest.get("material_id"),null,read,()->{},System::currentTimeMillis);yes(page.objects.size()==1&&page.next==null&&Arrays.equals(WireJson.bytes(page.objects.get(0)),WireJson.bytes(receipt)));
    try(AudioDownloads downloads=new AudioDownloads(cache,config,()->{})){AudioDownloads.Download partial=downloads.fetch(receipt,read,System::currentTimeMillis,1);yes(!partial.complete&&partial.confirmed==1);}
    try(AudioDownloads downloads=new AudioDownloads(cache,config,()->{})){AudioDownloads.Download restored=downloads.fetch(receipt,read,System::currentTimeMillis,32);yes(restored.complete&&Arrays.equals(Files.readAllBytes(restored.file.toPath()),data));AudioDownloads.recheck(reader,receipt,read,()->{},System::currentTimeMillis);downloads.remove((String)receipt.get("object_id"));yes(!restored.file.exists());}
    for(String path:new String[]{"/audio-uploads","/audio/../identity"}){try{read.exchange(path,null);throw new AssertionError("read route accepted write/traversal");}catch(IOException expected){yes("AUDIO_PATH_INVALID".equals(expected.getMessage()));}}
    try{read.exchange("/identity",new byte[0]);throw new AssertionError("reader accepted payload");}catch(IOException expected){yes("AUDIO_PATH_INVALID".equals(expected.getMessage()));}
   }finally{read.cancel();}
   Files.write(new File(root,"tls-result.json").toPath(),WireJson.bytes(WireJson.object("checks",checks,"parts_sent_after_resume",parts[0],"receipt",receipt,"source_preserved",true,"actual_read_tls_resumed",true,"independent_reader_other_producer",true,"derived_read_cache_removed",true)));
  }finally{tls.cancel();Arrays.fill(data,(byte)0);}
  System.out.println("Public TLS audio checks: "+checks);
 }
}
