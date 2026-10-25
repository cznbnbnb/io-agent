package com.turboio.addon;

import java.io.*;import java.nio.file.*;import java.util.*;import java.util.concurrent.*;

/** Real ingress/collector/journals/catalog; native context deliberately stays
 * valid after an exit, as the pinned vendor's reusable template does. */
public final class LifelogAudioRuntimeBoundaryTest extends LifelogAudioUploadCatalogTest {
 static final byte[] SILENCE={(byte)0xf8,(byte)0xff,(byte)0xfe};
 static void var(ByteArrayOutputStream b,int n){while(n>127){b.write((n&127)|128);n>>>=7;}b.write(n);}
 static byte[] packet(int version,int kind,String message,byte[] data,boolean extension){ByteArrayOutputStream b=new ByteArrayOutputStream();b.write(8);var(b,version);b.write(16);var(b,kind);b.write(26);byte[] json=WireJson.bytes(WireJson.read(message.getBytes(java.nio.charset.StandardCharsets.UTF_8)));var(b,json.length);b.write(json,0,json.length);b.write(34);var(b,data.length);b.write(data,0,data.length);if(extension){b.write(40);b.write(1);}return b.toByteArray();}
 static byte[] audio(){return packet(1,0xa3,"{\"taskId\":\"task-one\"}",SILENCE,false);}
 static Map<String,Object> row(Object v){return WireJson.map(v);}
 static AudioSyncSession.Catalog catalog()throws Exception{return LifelogAudioRuntime.catalogForUpload(A).get(6,TimeUnit.SECONDS);}
 static void scenario(File files,byte[] middle,boolean boundary,boolean accepted)throws Exception{
  scenario(files,middle,boundary,accepted,true);
 }
 static void scenario(File files,byte[] middle,boolean boundary,boolean accepted,boolean following)throws Exception{
  yes(files.mkdir());active=boot(files);try{
   long until=System.nanoTime()+TimeUnit.SECONDS.toNanos(3);while(field(active,"token")==null&&System.nanoTime()<until)Thread.sleep(1);yes(field(active,"token")!=null);
   LifelogAudioRuntime.incoming("peer-test",audio());awaitSaved(1);
   OfficialLifelogSnapshot.Source source=new OfficialLifelogSnapshot.Source();source.sourceType="conversation";source.sourceId="task-one";LifelogAudioRuntime.sources(A,Arrays.asList(source));
   AudioSyncSession.Catalog initial=catalog();yes(initial.archives.size()==1&&"open".equals(row(initial.archives.get(0)).get("phase")));String clock=(String)row(initial.sessions.get(0)).get("clock_epoch");
   // Both are queued before waiting: sealing must be between these writes,
   // rather than a later callback racing the next incoming batch.
   LifelogAudioRuntime.incoming("peer-test",middle);if(following)LifelogAudioRuntime.incoming("peer-test",AlwaysOnWire.read(middle).type==0xa5?packet(1,0xa4,"{\"taskId\":\"task-one\",\"isFinish\":false}",SILENCE,false):audio());awaitSaved(1+(accepted?1:0)+(following?1:0));
   AudioSyncSession.Catalog after=catalog();yes(after.archives.size()==(boundary&&following?2:1));
   Map<String,Object> prefix=row(after.archives.get(0));yes((boundary?"sealed":"open").equals(prefix.get("phase")));yes(((Number)prefix.get("count")).longValue()==(boundary?2:1+(accepted?1:0)+(following?1:0)));
   yes(clock.equals(row(after.sessions.get(0)).get("clock_epoch"))&&Boolean.FALSE.equals(row(after.sessions.get(0)).get("recording_complete")));
   yes("RUNNING".equals(((LifelogAudioCollector)field(active,"collector")).snapshot().get("phase")));
   if(boundary){if(following){Map<String,Object> next=row(after.archives.get(1));yes("open".equals(next.get("phase"))&&((Number)next.get("first_sequence")).longValue()==3&&((Number)next.get("count")).longValue()==1);}
    File journal=new File(files,"lifelog-audio/"+A+"/"+prefix.get("stream")+"/original.frames");byte[] before=Files.readAllBytes(journal.toPath());Map<String,Object> state=row(WireJson.read(Files.readAllBytes(journal.toPath().resolveSibling("state.json"))));state.put("raw_bytes",journal.length());state.put("tail_error","");state.put("uncertain",false);int[] count={0};
    try(InputStream input=new FileInputStream(journal)){LifelogAudioArchive.visitCopied(input,state,b->{yes(Arrays.equals(b.payload(),count[0]++==0?audio():middle));},()->{});}yes(count[0]==2);
    String digest=hash(files,prefix);for(int i=0;i<4;i++){yes(catalog().archives.size()==(following?2:1));yes(digest.equals(hash(files,prefix)));}yes(Arrays.equals(before,Files.readAllBytes(journal.toPath())));
   }
  }finally{close();}
 }
 public static void main(String[] args)throws Exception{File root=new File(args[0]);yes(root.mkdir());String task="\"taskId\":\"task-one\"";try{
  scenario(new File(root,"exit"),packet(1,0xa5,"{"+task+",\"rc\":0}",new byte[0],false),true,true);
  scenario(new File(root,"exit-idle"),packet(1,0xa5,"{"+task+",\"rc\":0}",new byte[0],false),true,true,false);
  scenario(new File(root,"abnormal-exit"),packet(1,0xa5,"{"+task+",\"rc\":-7,\"isFinish\":false}",new byte[0],false),true,true);
  scenario(new File(root,"cached-finish"),packet(1,0xa4,"{"+task+",\"isFinish\":true}",SILENCE,false),true,true);
  scenario(new File(root,"cached-empty-finish"),packet(1,0xa4,"{"+task+",\"isFinish\":true}",new byte[0],false),true,true);
  scenario(new File(root,"cached-ongoing"),packet(1,0xa4,"{"+task+",\"isFinish\":false}",SILENCE,false),false,true);
  scenario(new File(root,"cached-unknown"),packet(1,0xa4,"{"+task+"}",SILENCE,false),false,true);
  scenario(new File(root,"exit-data"),packet(1,0xa5,"{"+task+"}",SILENCE,false),false,true);
  scenario(new File(root,"exit-extension"),packet(1,0xa5,"{"+task+"}",new byte[0],true),false,true);
  scenario(new File(root,"exit-unknown-json"),packet(1,0xa5,"{"+task+",\"other\":true}",new byte[0],false),false,true);
  scenario(new File(root,"exit-wrong-task"),packet(1,0xa5,"{\"taskId\":\"task-two\"}",new byte[0],false),false,false);
  scenario(new File(root,"exit-wrong-version"),packet(0,0xa5,"{"+task+"}",new byte[0],false),false,false);
  System.out.println("Lifelog audio runtime boundary: "+checks+" checks passed; exit/cache finish seals ordered prefix without retiring or sealing metadata polls");
 }finally{close();android.os.Handler.release();}}
}
