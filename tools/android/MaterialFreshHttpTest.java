package com.turboio.addon;
import java.io.*;import java.nio.file.*;import java.util.*;

/** Fresh revision sessions against the real material HTTP/SQLite validator. */
public final class MaterialFreshHttpTest {
 public static void main(String[] args)throws Exception{
  File root=new File(args[0]),flutter=new File(root,"app_flutter"),logs=new File(flutter,"appLog");logs.mkdirs();Map<String,Object> fixture=WireJson.map(WireJson.read(Files.readAllBytes(Paths.get(args[1]))));MaterialConnection connection=MaterialConnection.parse(WireJson.bytes(fixture.get("connection")),System.currentTimeMillis());String mode=args.length>2?args[2]:"first";boolean recovery=mode.equals("legacy")||mode.equals("recover")||mode.equals("recovered-repeat");OfficialAccountBinding account=LifelogImportJournalTest.account(recovery?45:44);
  Map<String,Object> initial=OfficialLifelogSnapshotTest.fixture(),renamed=OfficialLifelogSnapshotTest.fixture();for(Object raw:WireJson.list(OfficialLifelogSnapshotTest.source(renamed).get("clips")))WireJson.map(raw).put("speakerName","HTTP合成修订标签");
  Map<String,Object> corrected=WireJson.map(WireJson.copy(renamed));OfficialLifelogSnapshotTest.firstClip(corrected).put("content","HTTP合成正文更正；禁止执行真实任务。");
  Files.write(account.cacheFile(flutter).toPath(),OfficialHiveCacheTest.frame(OfficialHiveCacheTest.URL,OfficialHiveCacheTest.cached(true),false));Files.write(new File(logs,"synthetic.log").toPath(),LifelogImportJournalTest.bytes(LifelogImportJournalTest.log(initial)));
  final byte[][] response={WireJson.bytes(initial)};OfficialLifelogRefresh.Ownership owner=new OfficialLifelogRefresh.Ownership(){public OfficialAccountBinding current(){return account;}public Set<String> references()throws Exception{return OfficialHiveCache.sourceReferences(OfficialHiveCache.read(account.cacheFile(flutter)));}};
  OfficialLifelogRefresh.Transport official=new OfficialLifelogRefresh.Transport(){public byte[] fetch(String id){return response[0];}public void cancel(){}};
  MaterialSyncSession.FreshSource source=new MaterialSyncSession.FreshSource(){public OfficialAccountBinding current(){return account;}public OfficialLifelogBatch read()throws Exception{return OfficialLifelogBatch.read(flutter,owner);}public OfficialLifelogRefresh.Fresh refresh(OfficialLifelogBatch b)throws Exception{return OfficialLifelogRefresh.read(b,owner,official);}};
  MaterialTest.connection=connection;MaterialTest.Loopback loopback=new MaterialTest.Loopback((String)fixture.get("endpoint"),false);String[] rejected={""};
  MaterialApi.Transport api=new MaterialApi.Transport(){public MaterialApi.Response exchange(String path,byte[] body)throws IOException{MaterialApi.Response r=loopback.exchange(path,body);if(r.status>=400)try{rejected[0]=(String)WireJson.map(WireJson.map(WireJson.read(r.body)).get("error")).get("code");}catch(RuntimeException ignored){}return r;}public void cancel(){loopback.cancel();}};
  MaterialConfig config=new MaterialConfig(connection,account.binding,true);boolean repeat=args.length>2&&args[2].equals("repeat");MaterialSyncSession.Status status;
  if(recovery){
   File accountFiles=MaterialSyncSession.accountFiles(root,config);String material=OfficialLifelogSnapshotTest.read(initial).materialId(account.binding);
   if(mode.equals("legacy")){
    status=new MaterialSyncSession(root,config,source,()->{},api).sync();if(status.stored!=1)throw new AssertionError("LEGACY_INITIAL");
    // Recreate the exact old mapper defect in a synthetic durable intent.
    try(MaterialOutbox q=new MaterialOutbox(accountFiles,connection);LifelogRevisionJournal journal=new LifelogRevisionJournal(accountFiles,connection,account.binding)){journal.stageFresh(Collections.singletonList(OfficialLifelogSnapshotTest.read(renamed)),()->account,q,System.currentTimeMillis());}
    File journalFile=new File(accountFiles,"lifelog-revisions/"+connection.binding()+"/"+account.binding+"/state.json");Map<String,Object> journalState=WireJson.map(WireJson.read(Files.readAllBytes(journalFile.toPath()))),intent=WireJson.map(WireJson.list(journalState.get("records")).get(1));Map<String,Object> bad=WireJson.map(WireJson.read(((String)intent.get("event")).getBytes(java.nio.charset.StandardCharsets.UTF_8)));WireJson.map(bad.get("body")).put("text_revision",1L);bad.put("event_id","synthetic-legacy-text-counter");bad.put("idempotency_key","synthetic-legacy-text-counter");intent.put("event",new String(WireJson.bytes(bad),java.nio.charset.StandardCharsets.UTF_8));try(AtomicDocument d=new AtomicDocument(journalFile)){d.save(journalState);}
    try(MaterialOutbox q=new MaterialOutbox(accountFiles,connection);LifelogRevisionJournal journal=new LifelogRevisionJournal(accountFiles,connection,account.binding)){journal.replay(()->account,q);if(!new MaterialApi(connection,api).pump(q,System.currentTimeMillis()))throw new AssertionError("LEGACY_NOT_SENT");if(!"TEXT_REVISION_CONFLICT".equals(rejected[0])||!"blocked".equals(WireJson.map(q.all().get(1)).get("state")))throw new AssertionError("LEGACY_NOT_REPRODUCED");}
    // A real v2 queue is the input to the next process's migration.
    Path queue=new File(accountFiles,"material-outbox/"+connection.binding()+"/state.json").toPath();Map<String,Object> state=WireJson.map(WireJson.read(Files.readAllBytes(queue)));state.put("schema",2);for(Object raw:WireJson.list(state.get("rows")))WireJson.map(raw).remove("text_revision_repair");Files.write(queue,WireJson.bytes(state));
   }else{
    response[0]=WireJson.bytes(renamed);status=new MaterialSyncSession(root,config,source,()->{},api).sync();if(status.stored!=2||status.queued!=0||status.blocked!=0)throw new AssertionError("LEGACY_RECOVERY_"+rejected[0]);
    try(MaterialOutbox q=new MaterialOutbox(accountFiles,connection)){Map<String,Object> row=WireJson.map(q.all().get(1)),repair=WireJson.map(row.get("text_revision_repair"));if(!repair.get("event_id").equals("synthetic-legacy-text-counter")||!new String(WireJson.bytes(WireJson.map(WireJson.read(((String)repair.get("payload")).getBytes(java.nio.charset.StandardCharsets.UTF_8))).get("body")),java.nio.charset.StandardCharsets.UTF_8).contains("\"text_revision\":1"))throw new AssertionError("LEGACY_AUDIT_LOST");}
   }
   Files.write(new File(root,"result.json").toPath(),WireJson.bytes(WireJson.object("material_id",material)));System.out.println("Material fresh HTTP "+mode+": passed");return;
  }
  if(!repeat){status=new MaterialSyncSession(root,config,source,()->{},api).sync();if(status.stored!=1)throw new AssertionError("INITIAL_"+rejected[0]);response[0]=WireJson.bytes(renamed);status=new MaterialSyncSession(root,config,source,()->{},api).sync();if(status.stored!=2||status.blocked!=0)throw new AssertionError("LABEL_REVISION_"+rejected[0]);}
  response[0]=WireJson.bytes(corrected);status=new MaterialSyncSession(root,config,source,()->{},api).sync();if(status.stored!=3||status.blocked!=0||status.queued!=0||(repeat&&status.added!=0))throw new AssertionError("TEXT_REVISION_"+rejected[0]);
  String material=OfficialLifelogSnapshotTest.read(initial).materialId(account.binding);Files.write(new File(root,"result.json").toPath(),WireJson.bytes(WireJson.object("material_id",material,"stored",status.stored,"added",status.added)));
  System.out.println("Material fresh HTTP "+(repeat?"repeat":"first")+": passed");
 }
}
