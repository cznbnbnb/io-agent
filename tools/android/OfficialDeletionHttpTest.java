package com.turboio.addon;

import java.io.*;
import java.nio.file.*;
import java.util.*;

/** Real production sync/outbox/API against the loopback HTTP/SQLite service.
 * Original account, day API, and committed ledger are explicit fixtures.
 */
public final class OfficialDeletionHttpTest {
 private static void yes(boolean value){if(!value)throw new AssertionError("deletion HTTP assertion");}
 private static final class Source extends OfficialLifelogDiscoveryTest.Wire implements MaterialSyncSession.DiscoverySource,OfficialRecordingDeletion.Source {
  final OfficialAccountBinding account;String ledger;int ledgerReads;
  Source(long accountId){account=LifelogImportJournalTest.account(accountId);conversationTypes(detail);conversationTypes(listing);}
  private static void conversationTypes(Object value){if(value instanceof Map){Map<String,Object> map=WireJson.map(value);if("CONVERSATION".equals(map.get("sourceType")))map.put("sourceType","conversation");for(Object child:map.values())conversationTypes(child);}else if(value instanceof List)for(Object child:(List<?>)value)conversationTypes(child);}
  @Override public OfficialAccountBinding current(){return account;}
  public OfficialRecordingDeletion.Source deletions(){return this;}
  public String read(String key){yes(key.equals(account.recordingDeletionKey()));ledgerReads++;return ledger;}
  public OfficialLifelogDiscovery.Snapshot discover()throws Exception{return OfficialLifelogDiscovery.read(account.binding,Collections.singletonList(OfficialLifelogDiscoveryTest.DAY),this,this);}
 }
 private static void budget(File root,MaterialConfig config,Source source,MaterialApi.Transport transport)throws Exception{
  List<String> tasks=new ArrayList<>(),materials=new ArrayList<>();long now=System.currentTimeMillis();
  try(MaterialOutbox outbox=new MaterialOutbox(MaterialStorage.prepare(root,config),config.connection)){
   for(int i=0;i<18;i++){
    String task="source-budget-"+i;tasks.add(task);
    Map<String,Object> original=WireJson.map(WireJson.read(OfficialLifelogSnapshotTest.read(source.detail).original()));original.put("sourceId",task);
    OfficialLifelogSnapshot.Source item=OfficialLifelogSnapshot.original(WireJson.bytes(original));materials.add(item.materialId(config.account));
    String id="budget-seed-"+item.materialId(config.account);
    outbox.enqueue(WireJson.bytes(WireJson.object("schema_version","1.2","event_id",id,"idempotency_key",id,"kind","material.revision","producer_id",config.connection.producer,"created_at",TaskWire.now(now),"expires_at",config.connection.expires,"body",WireJson.read(item.materialBody(config.account,1)))));
   }
   source.ledger=new String(WireJson.bytes(WireJson.object("deletedTaskIds",tasks,"serverDeletionRetryTaskIds",Collections.emptyList(),"pending",null,"deleteAll",null)),java.nio.charset.StandardCharsets.UTF_8);
   MaterialApi api=new MaterialApi(config.connection,transport);
   OfficialDeletionSync first=OfficialDeletionSync.read(config,source);first.stage(outbox,api,now);
   yes(first.added==16&&first.readyMaterials.size()==16&&first.deletedMaterials.size()==18);
   for(int i=0;i<32&&api.pump(outbox,now,first.readyMaterials);i++){}
   // The two unstaged original bodies must remain unsent. An existing settled
   // tombstone must not consume the next round's admission budget forever.
   int oldQueued=0;for(Object raw:outbox.all()){Map<String,Object> row=WireJson.map(raw);if(!"server_stored".equals(row.get("state"))){yes("upsert".equals(WireJson.map(MaterialWire.event(((String)row.get("payload")).getBytes(java.nio.charset.StandardCharsets.UTF_8),config.connection.producer).get("body")).get("operation")));oldQueued++;}}
   yes(oldQueued==2);
   OfficialDeletionSync second=OfficialDeletionSync.read(config,source);second.stage(outbox,api,now);yes(second.added==2&&second.readyMaterials.size()==18);
   for(int i=0;i<32&&api.pump(outbox,now,second.readyMaterials);i++){}
   for(Object raw:outbox.all())yes("server_stored".equals(WireJson.map(raw).get("state")));
  }
  Files.write(new File(root,"result.json").toPath(),WireJson.bytes(WireJson.object("material_id",materials.get(0),"materials",materials)));
 }
 public static void main(String[] args)throws Exception{
  File root=new File(args[0]);root.mkdirs();
  Map<String,Object> fixture=WireJson.map(WireJson.read(Files.readAllBytes(Paths.get(args[1]))));
  String mode=args[2];Source source=new Source(((Number)fixture.get("account_id")).longValue());
  String task=OfficialLifelogSnapshotTest.read(source.detail).sourceId;
  String material=OfficialLifelogSnapshotTest.read(source.detail).materialId(source.account.binding);
  MaterialConnection connection=MaterialConnection.parse(WireJson.bytes(fixture.get("connection")),System.currentTimeMillis());
  MaterialConfig config=new MaterialConfig(connection,source.account.binding,true);MaterialTest.connection=connection;
  if(mode.equals("budget")){budget(root,config,source,new MaterialTest.Loopback((String)fixture.get("endpoint"),false));System.out.println("Official deletion HTTP budget: passed; two rounds, no stale upload or starvation");return;}
  if(!mode.equals("seed")&&!mode.equals("offline-seed")&&!mode.equals("rollback")){
   Object pending=mode.equals("pending")?WireJson.object("id","pending-1","explicitTaskIds",Arrays.asList(task),"protectedTaskIds",Collections.emptyList(),"cutoffMs",null):null;
   Object all=mode.equals("historical")?WireJson.object("id","all-1","explicitTaskIds",Collections.emptyList(),"protectedTaskIds",Collections.emptyList(),"cutoffMs",1700000000000L):null;
   source.ledger=new String(WireJson.bytes(WireJson.object("deletedTaskIds",pending==null?Arrays.asList(task):Collections.emptyList(),"serverDeletionRetryTaskIds",Collections.emptyList(),"pending",pending,"deleteAll",all)),java.nio.charset.StandardCharsets.UTF_8);
  }
  MaterialTest.Loopback http=new MaterialTest.Loopback((String)fixture.get("endpoint"),false);
  boolean[] dropped={false};
  MaterialApi.Transport transport=new MaterialApi.Transport(){
   public MaterialApi.Response exchange(String path,byte[] payload)throws IOException{
    if(mode.equals("offline-seed"))throw new IOException("SYNTHETIC_OFFLINE");
    MaterialApi.Response result=http.exchange(path,payload);
    if(!dropped[0]&&result.status>=200&&result.status<300&&(mode.equals("lost-cancel")&&path.equals("/material-cancellations")||mode.equals("lost-delete")&&path.equals("/material-events")&&"delete".equals(WireJson.map(MaterialWire.event(payload,connection.producer).get("body")).get("operation")))){
     dropped[0]=true;throw new IOException("SYNTHETIC_REPLY_LOST");
    }
    return result;
   }
   public void cancel(){http.cancel();}
  };
  if(mode.equals("recover"))try(MaterialOutbox outbox=new MaterialOutbox(MaterialStorage.prepare(root,config),connection)){
   OfficialDeletionSync authority=OfficialDeletionSync.read(config,source);authority.check();
   new MaterialApi(connection,transport).pump(outbox,System.currentTimeMillis()+60000,Collections.singleton(material));authority.check();
  }
  boolean failure=mode.equals("offline-seed")||mode.equals("lost-cancel")||mode.equals("lost-delete")||mode.equals("pending")||mode.equals("historical");
  try{
   MaterialSyncSession.Status status=new MaterialSyncSession(root,config,source,()->{},transport).sync();
   yes(!failure&&status.queued==0&&status.blocked==0&&status.selectedComplete);
  }catch(IOException|IllegalArgumentException expected){
   if(!failure)throw expected;String code=expected.getMessage();
   yes(mode.equals("offline-seed")&&code.equals("SYNTHETIC_OFFLINE")||mode.startsWith("lost-")&&code.equals("SYNTHETIC_REPLY_LOST")||mode.equals("pending")&&code.equals("OFFICIAL_DELETION_PENDING")||mode.equals("historical")&&code.equals("OFFICIAL_DELETION_HISTORY_UNSUPPORTED"));
  }
  if(mode.startsWith("lost-"))yes(dropped[0]);
  if(!failure)try(MaterialOutbox outbox=new MaterialOutbox(MaterialSyncSession.accountFiles(root,config),connection)){
   Map<String,Object> latest=null;
   for(Object raw:outbox.all()){Map<String,Object> row=WireJson.map(raw);if(latest==null||MaterialWire.positive(row.get("revision"))>MaterialWire.positive(latest.get("revision")))latest=row;}
   yes(latest!=null&&"server_stored".equals(latest.get("state")));
   Map<String,Object> body=WireJson.map(MaterialWire.event(((String)latest.get("payload")).getBytes(java.nio.charset.StandardCharsets.UTF_8),connection.producer).get("body"));
   yes((mode.equals("seed")||mode.equals("rollback")?"upsert":"delete").equals(body.get("operation")));
   if("delete".equals(body.get("operation")))yes(WireJson.list(body.get("utterances")).isEmpty()&&"".equals(WireJson.map(body.get("full_text")).get("text")));
  }
  Files.write(new File(root,"result.json").toPath(),WireJson.bytes(WireJson.object("material_id",material,"ledger_reads",source.ledgerReads)));
  System.out.println("Official deletion HTTP "+mode+": passed; real sync/outbox and HTTP, fixture source ledger");
 }
}
