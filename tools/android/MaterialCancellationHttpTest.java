package com.turboio.addon;
import java.io.*;import java.nio.charset.StandardCharsets;import java.nio.file.*;import java.util.*;

/** Real HTTP cancellation, source growth and durable handoff across JVMs. */
public final class MaterialCancellationHttpTest {
 static void yes(boolean ok){if(!ok)throw new AssertionError("Material cancellation recovery");}
 public static void main(String[] args)throws Exception{
  File root=new File(args[0]),flutter=new File(root,"app_flutter"),logs=new File(flutter,"appLog");logs.mkdirs();
  Map<String,Object> fixture=WireJson.map(WireJson.read(Files.readAllBytes(Paths.get(args[1]))));String mode=args[2];
  MaterialConnection c=MaterialConnection.parse(WireJson.bytes(fixture.get("connection")),System.currentTimeMillis());OfficialAccountBinding account=LifelogImportJournalTest.account(47);MaterialConfig config=new MaterialConfig(c,account.binding,true);
  Map<String,Object> initial=MaterialTransferHttpTest.source(false),changed=MaterialTransferHttpTest.source(false),finished=MaterialTransferHttpTest.source(false);
  OfficialLifelogSnapshotTest.firstClip(changed).put("content","最新正文，完整保留条件。🙂");OfficialLifelogSnapshotTest.firstClip(finished).put("content","最新正文，完整保留条件。🙂 完结");
  Files.write(account.cacheFile(flutter).toPath(),OfficialHiveCacheTest.frame(OfficialHiveCacheTest.URL,OfficialHiveCacheTest.cached(true),false));Files.write(new File(logs,"synthetic.log").toPath(),LifelogImportJournalTest.bytes(LifelogImportJournalTest.log(initial)));
  final byte[][] content={WireJson.bytes(mode.equals("seed")?initial:mode.equals("repeat")?finished:changed)};
  OfficialLifelogRefresh.Ownership owner=new OfficialLifelogRefresh.Ownership(){public OfficialAccountBinding current(){return account;}public Set<String> references()throws Exception{return OfficialHiveCache.sourceReferences(OfficialHiveCache.read(account.cacheFile(flutter)));}};
  OfficialLifelogRefresh.Transport official=new OfficialLifelogRefresh.Transport(){public byte[] fetch(String id){return content[0];}public void cancel(){}};
  MaterialSyncSession.FreshSource source=new MaterialSyncSession.FreshSource(){public OfficialAccountBinding current(){return account;}public OfficialLifelogBatch read()throws Exception{return OfficialLifelogBatch.read(flutter,owner);}public OfficialLifelogRefresh.Fresh refresh(OfficialLifelogBatch observed)throws Exception{return OfficialLifelogRefresh.read(observed,owner,official);}};
  MaterialTest.connection=c;MaterialTest.Loopback http=new MaterialTest.Loopback((String)fixture.get("endpoint"),false);boolean[] dropped={false};
  MaterialApi.Transport transport=new MaterialApi.Transport(){public MaterialApi.Response exchange(String path,byte[] body)throws IOException{
   MaterialApi.Response result=http.exchange(path,body);
   if(!dropped[0]&&result.status==200&&(mode.equals("seed")&&path.endsWith("/parts/0")||mode.equals("cancel-lost")&&path.equals("/material-cancellations"))){dropped[0]=true;throw new IOException("SYNTHETIC_REPLY_LOST");}return result;
  }public void cancel(){http.cancel();}};
  File files=MaterialSyncSession.accountFiles(root,config),oldFile=new File(root,"old-event.json");
  if(mode.equals("seed")||mode.equals("cancel-lost")){
   try{new MaterialSyncSession(root,config,source,()->{},transport).sync();throw new AssertionError("Expected lost response");}catch(IOException expected){yes(expected.getMessage().equals("SYNTHETIC_REPLY_LOST"));}
   yes(dropped[0]);try(MaterialOutbox q=new MaterialOutbox(files,c)){yes(q.all().size()==1);Map<String,Object> row=WireJson.map(q.all().get(0));yes(!"server_stored".equals(row.get("state")));if(mode.equals("seed"))Files.write(oldFile.toPath(),((String)row.get("payload")).getBytes(StandardCharsets.UTF_8));else yes(Arrays.equals(Files.readAllBytes(oldFile.toPath()),((String)row.get("payload")).getBytes(StandardCharsets.UTF_8)));}
  }else{
   MaterialSyncSession.Status resumed=new MaterialSyncSession(root,config,source,()->{},transport).sync();yes(resumed.selectedComplete&&resumed.queued==0&&resumed.blocked==0);
   if(mode.equals("recover")){
    yes(resumed.stored==1);byte[] old=Files.readAllBytes(oldFile.toPath());MaterialApi.Response late=MaterialTransfer.send(http,old,MaterialWire.event(old,c.producer));yes(late.status==409&&"MATERIAL_EVENT_CANCELLED".equals(WireJson.map(WireJson.map(WireJson.read(late.body)).get("error")).get("code")));
    try(MaterialOutbox q=new MaterialOutbox(files,c)){Map<String,Object> row=WireJson.map(q.all().get(0));yes(WireJson.list(row.get("superseded")).size()==1);q.enqueue(old);yes(q.all().size()==1);}
    content[0]=WireJson.bytes(finished);yes(new MaterialSyncSession(root,config,source,()->{},transport).sync().stored==2);
    yes(new MaterialSyncSession(root,config,source,()->{},transport).sync().selectedComplete);
   }else yes(mode.equals("repeat")&&resumed.added==0&&resumed.stored==2);
   try(MaterialOutbox q=new MaterialOutbox(files,c)){yes(q.all().size()==1&&q.retiredCount()==1);q.enqueue(Files.readAllBytes(oldFile.toPath()));yes(q.all().size()==1);Map<String,Object> row=WireJson.map(q.all().get(0));yes(MaterialWire.positive(row.get("revision"))==2);}
   Files.write(new File(root,"result.json").toPath(),WireJson.bytes(WireJson.object("material_id",OfficialLifelogSnapshotTest.read(initial).materialId(account.binding))));
  }
  System.out.println("Material cancellation "+mode+": passed; real HTTP, source growth, late delivery and JVM restart");
 }
}
