package com.turboio.addon;
import java.io.*;import java.util.*;
public final class LifelogTextSyncTest {
 static int checks;static void yes(boolean x){checks++;if(!x)throw new AssertionError("Text sync "+checks);}
 static OfficialLifelogSnapshot.Source source(String word){return OfficialLifelogSnapshot.original(WireJson.bytes(WireJson.object("sourceId","record-1","sourceType","recording","title","合成标题","startTime","1793581200000","endTime","1793584800000","audioUrl","DO_NOT_UPLOAD_AUDIO","latitude",30,"clips",Arrays.asList(WireJson.object("clipId","one","content",word,"startTime","1793581200000","endTime","1793581201000","speakerName","说话人1")))));}
 static final class Server implements MaterialApi.Transport {final Map<String,Map<String,Object>> rows=new HashMap<>();int posts,reads;boolean drop;
  public MaterialApi.Response exchange(String path,byte[] bytes)throws IOException{Map<String,Object> input=WireJson.map(WireJson.read(bytes));if(path.equals("/lifelog-text/head")){reads++;String id=(String)input.get("id");Map<String,Object> row=rows.get(id);return new MaterialApi.Response(200,WireJson.bytes(WireJson.object("id",id,"revision",row==null?0:row.get("revision"),"hash",row==null?null:row.get("hash"))),0);}
   yes(path.equals("/lifelog-text/source"));Map<String,Object> source=WireJson.map(input.get("source"));String encoded=new String(WireJson.bytes(source),java.nio.charset.StandardCharsets.UTF_8);yes(!encoded.contains("DO_NOT_UPLOAD_AUDIO")&&!encoded.contains("latitude"));String id=(String)source.get("id");Map<String,Object> old=rows.get(id);long prior=old==null?0:MaterialWire.number(old.get("revision"));yes(MaterialWire.number(input.get("base_revision"))==prior);Map<String,Object> ack=WireJson.object("id",id,"revision",prior+1,"hash",TaskWire.hash(WireJson.bytes(source)),"server_stored",true,"unchanged",false);rows.put(id,ack);posts++;if(drop){drop=false;throw new IOException("lost_ack");}return new MaterialApi.Response(200,WireJson.bytes(ack),0);
  }public void cancel(){}
 }
 public static void main(String[] args)throws Exception{File root=new File(args[0]);root.mkdirs();String account="a".repeat(64);MaterialConfig config=new MaterialConfig(LifelogImportJournalTest.connection(System.currentTimeMillis()),account,true);Server server=new Server();String day="2026-11-02",zone="Asia/Shanghai";
  try(MaterialLocalLibrary library=new MaterialLocalLibrary(root,account)){library.recordRead(day,zone,Arrays.asList(source("原始转写")),1,()->account);}
  MaterialSyncSession.Status first=LifelogTextSync.run(root,config,null,()->{},server);yes(first.stored==1&&first.selectedComplete&&server.posts==1);yes(LifelogTextSync.status(root,config).stored==1);yes(!LifelogTextSync.run(root,config,Collections.singleton("2026-10-01"),()->{},server).selectedComplete);yes(new String(WireJson.bytes("\b\f中文"),java.nio.charset.StandardCharsets.UTF_8).equals("\"\\b\\f中文\""));
  LifelogTextSync.run(root,config,null,()->{},server);yes(server.posts==1&&server.reads==1);
  try(MaterialLocalLibrary library=new MaterialLocalLibrary(root,account)){library.recordRead(day,zone,Arrays.asList(source("手机补全转写")),2,()->account);}
  server.drop=true;boolean failed=false;try{LifelogTextSync.run(root,config,null,()->{},server);}catch(IOException e){failed=true;}yes(failed&&server.posts==2);
  LifelogTextSync.run(root,config,null,()->{},server);yes(server.posts==2&&server.reads==3);
  List<OfficialLifelogInsight.Topic> topics=Arrays.asList(new OfficialLifelogInsight.Topic(1793581200000L,"任务标签"));OfficialLifelogInsight.Event event=new OfficialLifelogInsight.Event("event-1","分段主题","摘要","",1793581200000L,1793584800000L,topics,Collections.singleton("recording/record-1"));
  List<Map<String,Object>> projected;try(MaterialLocalLibrary library=new MaterialLocalLibrary(root,account)){projected=LifelogTextSync.project(account,zone,library.snapshot(day,zone),new OfficialLifelogInsight.Day(day,zone,Arrays.asList(event),Collections.emptyList()));}
  yes(projected.size()==2);yes(WireJson.list(projected.get(1).get("related_ids")).get(0).equals(projected.get(0).get("id")));yes(WireJson.list(projected.get(1).get("blocks")).size()==3);
  LifelogTextSync.run(root,new MaterialConfig(config.connection,"b".repeat(64),true),null,()->{},server);yes(server.posts==2);
  boolean guarded=false;try{LifelogTextSync.run(root,config,null,()->{throw new IOException("account_changed");},server);}catch(IOException e){guarded=true;}yes(guarded&&server.posts==2);
  System.out.println("Lifelog text sync: "+checks+" checks passed");
 }
}
