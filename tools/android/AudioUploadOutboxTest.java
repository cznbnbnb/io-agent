package com.turboio.addon;

import java.io.*;import java.nio.file.*;import java.util.*;import java.util.concurrent.atomic.*;

/** Wire denial, private staging capacity and crash-state recovery boundaries. */
public final class AudioUploadOutboxTest {
 private static int checks;private static final String A=String.join("",Collections.nCopies(64,"a")),B=String.join("",Collections.nCopies(64,"b"));
 private interface Work {void run()throws Exception;}
 private static void yes(boolean value){checks++;if(!value)throw new AssertionError("audio outbox "+checks);}
 private static void denied(Work work)throws Exception{try{work.run();throw new AssertionError("accepted invalid audio state");}catch(IOException expected){checks++;}}
 private static Map<String,Object> map(Object v){return WireJson.map(v);}
 private static Map<String,Object> copy(Object v){return map(WireJson.copy(v));}
 private static File dir(File parent,String name)throws Exception{File f=new File(parent,name);yes(f.mkdir());return f;}
 private static File source(File root,Map<String,Object> m,byte[] data)throws Exception{File f=new File(root,"lifelog-audio-payloads/"+A+"/"+m.get("sha256")+"/payload.bin");yes(f.getParentFile().mkdirs());Files.write(f.toPath(),data);return f;}
 public static void main(String[] args)throws Exception{
  File base=new File(args[0]);Map<String,Object> fixture=map(WireJson.read(Files.readAllBytes(Paths.get(args[1])),4194304,20000));long now=AudioUploadWire.number(fixture.get("now"));Map<String,Object> c=map(fixture.get("connection"));AudioConnection connection=AudioConnection.parse(WireJson.bytes(c),now);String body=(String)fixture.get("body_sha256");
  for(String url:new String[]{"http://127.0.0.1/v1","https://example.invalid:444/v1","https://u:p@example.invalid/v1","https://example.invalid/v1?x=1","https://example.invalid/v1/../v1"}){Map<String,Object> bad=copy(c);bad.put("base_url",url);denied(()->AudioConnection.parse(WireJson.bytes(bad),now));}
  Map<String,Object> text=copy(c);text.put("format",MaterialConnection.FORMAT);denied(()->AudioConnection.parse(WireJson.bytes(text),now));yes(connection.binding().equals(AudioConnection.parse(connection.encode(),now).binding()));
  Map<String,Object> job=map(fixture.get("stored_job")),receipt=map(job.get("receipt"));AudioUploadWire.status(WireJson.bytes(receipt),job,now,false);checks++;
  for(String key:new String[]{"owner_id","producer_id","object_id","source_body_sha256","sha256","material_revision","bytes","parts","part_bytes","retention_seconds","recording_completeness_verified","storage_verified","unexpected_field"}){
   Map<String,Object> invalid=copy(receipt);Object value=invalid.get(key);invalid.put(key,value instanceof Number?999999L:value instanceof Boolean?!((Boolean)value):"foreign");denied(()->AudioUploadWire.status(WireJson.bytes(invalid),job,now,false));
  }
  Map<String,Object> future=copy(receipt);future.put("stored_at",TaskWire.now(now+600000));future.put("expires_at",TaskWire.now(now+600000+AudioUploadWire.TTL));denied(()->AudioUploadWire.status(WireJson.bytes(future),job,now,false));
  Map<String,Object> upload=copy(receipt);upload.put("state","uploading");upload.put("storage_verified",false);upload.put("stored_at",null);upload.put("expires_at",null);upload.put("upload_expires_at",TaskWire.now(now+10000));upload.put("received",Arrays.asList(0L,0L));denied(()->AudioUploadWire.status(WireJson.bytes(upload),job,now,true));upload.put("received",Arrays.asList(999999L));denied(()->AudioUploadWire.status(WireJson.bytes(upload),job,now,true));
  Map<String,Object> invalidManifest=copy(job.get("manifest"));map(invalidManifest.get("capture")).put("recording_complete","yes");denied(()->AudioUploadWire.manifest(invalidManifest));Map<String,Object> oversized=copy(job.get("manifest"));oversized.put("bytes",AudioUploadWire.MAX+1);denied(()->AudioUploadWire.manifest(oversized));
  Map<String,Object> m=copy(job.get("manifest"));byte[] first=new byte[600],second=new byte[600];Arrays.fill(first,(byte)3);Arrays.fill(second,(byte)4);m.put("bytes",600L);m.put("sha256",TaskWire.hash(first));File limited=dir(base,"capacity");File original=source(limited,m,first);AudioUploadOutbox.Limits limits=new AudioUploadOutbox.Limits(1024,8);String id;
  try(AudioUploadOutbox q=new AudioUploadOutbox(limited,connection,A,()->{},limits)){
   id=q.enqueue(original,m,body);yes(q.snapshot(now).size()==1&&!Boolean.TRUE.equals(map(q.snapshot(now).get(0)).get("remote_retained")));yes(id.equals(q.enqueue(original,m,body)));yes(new File(limited,"lifelog-audio-uploads/payloads").listFiles().length==1);Map<String,Object> altered=copy(m);altered.put("sha256",TaskWire.hash(second));File another=source(limited,altered,second);denied(()->q.enqueue(another,altered,body));yes(q.snapshot(now).size()==1);
   String origin=String.join("",Collections.nCopies(64,"c"));yes(id.equals(q.enqueue(original,m,body,origin)));yes(origin.equals(map(q.snapshot(now).get(0)).get("origin")));denied(()->q.enqueue(original,m,body,String.join("",Collections.nCopies(64,"d"))));
   Map<String,Object> newer=copy(m);newer.put("material_revision",AudioUploadWire.number(m.get("material_revision"))+1);String newBody=String.join("",Collections.nCopies(64,"1"));yes(id.equals(q.enqueue(original,newer,newBody)));yes(map(q.snapshot(now).get(0)).get("manifest").equals(m)&&body.equals(map(q.snapshot(now).get(0)).get("body_sha256")));Map<String,Object> changedCapture=copy(newer);map(changedCapture.get("capture")).put("recording_complete",true);denied(()->q.enqueue(original,changedCapture,newBody));
   denied(()->q.enqueue(original,m,String.join("",Collections.nCopies(64,"0"))));Map<String,Object> result=map(q.snapshot(now).get(0));result.put("state","stored");yes(map(q.snapshot(now).get(0)).get("state").equals("queued"));
  }
  try(AudioUploadOutbox q=new AudioUploadOutbox(limited,connection,B,()->{},limits)){yes(q.snapshot(now).isEmpty());}
  Map<String,Object> other=copy(c);other.put("base_url","https://other.invalid/v1");AudioConnection foreign=AudioConnection.parse(WireJson.bytes(other),now);try(AudioUploadOutbox q=new AudioUploadOutbox(limited,foreign,A,()->{},limits)){yes(q.snapshot(now).isEmpty());}
  File metadata=new File(limited,"lifelog-audio-uploads/state.json");byte[] before=Files.readAllBytes(metadata.toPath());denied(()->{try(AudioUploadOutbox ignored=new AudioUploadOutbox(limited,connection,A,()->{},new AudioUploadOutbox.Limits(2048,8))){}});yes(Arrays.equals(before,Files.readAllBytes(metadata.toPath())));
  File orphan=new File(limited,"lifelog-audio-uploads/payloads/"+String.join("",Collections.nCopies(64,"0"))+".bin");Files.write(orphan.toPath(),new byte[]{9});denied(()->{try(AudioUploadOutbox ignored=new AudioUploadOutbox(limited,connection,A,()->{},limits)){}});yes(orphan.isFile()&&Arrays.equals(before,Files.readAllBytes(metadata.toPath())));Files.delete(orphan.toPath());
  File guarded=dir(base,"guarded");AtomicBoolean allowed=new AtomicBoolean(false);denied(()->{try(AudioUploadOutbox ignored=new AudioUploadOutbox(guarded,connection,A,()->{if(!allowed.get())throw new IOException("OFFICIAL_ACCOUNT_CHANGED");})){}});yes(!new File(guarded,"lifelog-audio-uploads").exists());
  File legacyState=new File(limited,"lifelog-audio-uploads/state.json");Map<String,Object> legacy=map(WireJson.read(Files.readAllBytes(legacyState.toPath())));legacy.put("schema",1);for(Object value:WireJson.list(legacy.get("rows")))map(value).remove("origin");Files.write(legacyState.toPath(),WireJson.bytes(legacy));try(AudioUploadOutbox migrated=new AudioUploadOutbox(limited,connection,A,()->{},limits)){yes("".equals(map(migrated.snapshot(now).get(0)).get("origin")));yes(id.equals(map(migrated.snapshot(now).get(0)).get("id")));}yes(AudioUploadWire.number(map(WireJson.read(Files.readAllBytes(legacyState.toPath()))).get("schema"))==2);
  File origins=dir(base,"origins");File originFirst=source(origins,m,first);Map<String,Object> secondManifest=copy(m);secondManifest.put("sha256",TaskWire.hash(second));File originSecond=source(origins,secondManifest,second);String originKey=String.join("",Collections.nCopies(64,"e"));try(AudioUploadOutbox q=new AudioUploadOutbox(origins,connection,A,()->{})){q.enqueue(originFirst,m,body,originKey);try{q.enqueue(originSecond,secondManifest,body,originKey);throw new AssertionError("origin reassigned");}catch(IOException expected){yes("AUDIO_ORIGIN_CONFLICT".equals(expected.getMessage()));}yes(q.snapshot(now).size()==1);}
  File paths=dir(base,"paths");try(AudioUploadOutbox q=new AudioUploadOutbox(paths,connection,A,()->{})){
   File outside=new File(paths,"outside.bin");Files.write(outside.toPath(),first);denied(()->q.enqueue(outside,m,body));yes(Arrays.equals(first,Files.readAllBytes(outside.toPath()))&&q.snapshot(now).isEmpty());
   File link=new File(paths,"lifelog-audio-payloads/"+A+"/"+m.get("sha256")+"/payload.bin");yes(link.getParentFile().mkdirs());Files.createSymbolicLink(link.toPath(),outside.toPath());denied(()->q.enqueue(link,m,body));yes(q.snapshot(now).isEmpty()&&outside.isFile());
  }
  File broken=dir(base,"broken-preparing");Map<String,Object> intended=copy(m);File invalidSource=source(broken,intended,second);denied(()->{try(AudioUploadOutbox q=new AudioUploadOutbox(broken,connection,A,()->{})){q.enqueue(invalidSource,intended,body);}});
  try(AudioUploadOutbox q=new AudioUploadOutbox(broken,connection,A,()->{})){Map<String,Object> blocked=map(q.snapshot(now).get(0));yes(blocked.get("state").equals("blocked")&&blocked.get("error").equals("AUDIO_PAYLOAD_CHANGED"));}
  yes(Arrays.equals(second,Files.readAllBytes(invalidSource.toPath())));
  System.out.println("Audio upload outbox: "+checks+" assertions passed; denial, quota, paths, ownership and preparation integrity");
 }
}
