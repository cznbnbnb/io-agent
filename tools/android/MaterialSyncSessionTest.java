package com.turboio.addon;
import java.io.*;import java.nio.file.*;import java.nio.charset.StandardCharsets;import java.util.*;import java.util.concurrent.atomic.*;

public final class MaterialSyncSessionTest {
 static int checks;static void yes(boolean ok){checks++;if(!ok)throw new AssertionError("Material session "+checks);}interface Work{void run()throws Exception;}static void rejects(Work work)throws Exception{checks++;try{work.run();}catch(IOException|IllegalArgumentException expected){return;}throw new AssertionError("Expected session rejection "+checks);}
 static class MemoryServer implements MaterialApi.Transport {
  final MaterialConnection connection;int posts,lookups;boolean drop,badAck,flipOnIdentity;Runnable flip=()->{};final Map<String,byte[]> saved=new HashMap<>();
  MemoryServer(MaterialConnection connection){this.connection=connection;}
  public MaterialApi.Response exchange(String path,byte[] payload)throws IOException{
   if(path.equals("/identity")){if(flipOnIdentity){flipOnIdentity=false;flip.run();}return new MaterialApi.Response(200,WireJson.bytes(WireJson.object("schema_version","1.0","owner_id",connection.owner,"producer_id",connection.producer,"server_id",connection.server,"expires_at",connection.expires,"scopes",Arrays.asList("materials:write"),"material_schema_versions",Arrays.asList("1.2"))),0);}
   if(path.startsWith("/events/")){lookups++;byte[] ack=saved.get(path.substring(8));return new MaterialApi.Response(ack==null?404:200,ack==null?WireJson.bytes(WireJson.object("schema_version","1.0","error",WireJson.object("code","EVENT_NOT_FOUND"))):ack,0);}
   if(!path.equals("/material-events"))throw new AssertionError("Unexpected task transport");posts++;Map<String,Object> event=MaterialWire.event(payload,connection.producer),body=WireJson.map(event.get("body"));String id=(String)event.get("event_id");byte[] ack=WireJson.bytes(WireJson.object("schema_version","1.2","event_id",id,"material_id",body.get("material_id"),"revision",body.get("revision"),"commit_seq",1,"stored_at",TaskWire.now(System.currentTimeMillis()),"receipt",WireJson.object("receipt_id","synthetic-sync","subject_kind","material","subject_id",body.get("material_id"),"subject_revision",body.get("revision"),"stage","server_stored","actor_id","server-storage","related_event_id",id,"error",null)));saved.put(id,ack);if(drop){drop=false;throw new IOException("SYNTHETIC_LOST_ACK");}if(badAck){badAck=false;return new MaterialApi.Response(201,new byte[]{123,125},0);}return new MaterialApi.Response(201,ack,0);
  }public void cancel(){}
 }
 public static void main(String[] args)throws Exception{
  File root=new File(args[0]),flutter=new File(root,"app_flutter"),logs=new File(flutter,"appLog");yes(logs.mkdirs());OfficialAccountBinding account=LifelogImportJournalTest.account(42),other=LifelogImportJournalTest.account(43);AtomicReference<OfficialAccountBinding> active=new AtomicReference<>(account);AtomicBoolean cancelled=new AtomicBoolean(false);
  Path log=new File(logs,"synthetic.log").toPath();byte[] cache=OfficialHiveCacheTest.frame(OfficialHiveCacheTest.URL,OfficialHiveCacheTest.cached(true),false);Files.write(account.cacheFile(flutter).toPath(),cache);Map<String,Object> fixture=OfficialLifelogSnapshotTest.fixture();Files.write(log,LifelogImportJournalTest.bytes(LifelogImportJournalTest.log(fixture)));
  MaterialConnection connection=LifelogImportJournalTest.connection(System.currentTimeMillis());MaterialConfig config=new MaterialConfig(connection,account.binding,true);yes(Arrays.equals(config.encode(),MaterialConfig.decode(config.encode()).encode()));yes(!config.enabled(false).enabled);rejects(()->config.replaceAllowed(new MaterialConfig(connection,other.binding,true)));yes(!config.fingerprint().equals(config.enabled(false).fingerprint()));
  MaterialSyncSession.Source source=new MaterialSyncSession.Source(){public OfficialAccountBinding current(){return active.get();}public OfficialLifelogBatch read()throws Exception{return OfficialLifelogBatch.read(flutter,this::current);}};
  MaterialSyncSession.Guard guard=()->{if(cancelled.get())throw new IOException("MATERIAL_PAUSED");};MemoryServer server=new MemoryServer(connection);
  File success=new File(root,"success");MaterialSyncSession.Status first=new MaterialSyncSession(success,config,source,guard,server).sync();yes(first.stored==1&&first.added==1&&server.posts==1);
  MaterialSyncSession.Status repeat=new MaterialSyncSession(success,MaterialConfig.decode(config.encode()),source,guard,server).sync();yes(repeat.stored==1&&repeat.added==0&&server.posts==1);
  active.set(other);rejects(()->new MaterialSyncSession(success,config,source,guard,server).sync());yes(server.posts==1);active.set(account);cancelled.set(true);rejects(()->new MaterialSyncSession(success,config,source,guard,server).sync());cancelled.set(false);
  rejects(()->new MaterialSyncSession(success,config.enabled(false),source,guard,server).sync());yes(MaterialSyncSession.status(success,config).stored==1);
  // Account changes after identity response but before discovery/send.
  server.flipOnIdentity=true;server.flip=()->active.set(other);rejects(()->new MaterialSyncSession(new File(root,"flip"),config,source,guard,server).sync());yes(server.posts==1);active.set(account);
  // Interrupted acknowledgement is reconciled by event ID after process-style reopen.
  File retry=new File(root,"retry");server.drop=true;rejects(()->new MaterialSyncSession(retry,config,source,guard,server).sync());yes(server.posts==2&&MaterialSyncSession.status(retry,config).reconcile==1);
  // Clear only the synthetic retry deadline via the public queue API's clock.
  try(MaterialOutbox q=new MaterialOutbox(MaterialSyncSession.accountFiles(retry,config),connection)){MaterialApi api=new MaterialApi(connection,server);yes(api.pump(q,System.currentTimeMillis()+60000));}
  MaterialSyncSession.Status recovered=new MaterialSyncSession(retry,config,source,guard,server).sync();yes(recovered.stored==1&&server.posts==2&&server.lookups==1);
  // A committed local import whose cache reference disappears must not be uploaded.
  File absent=new File(root,"absent");OfficialLifelogBatch batch=source.read();try(LifelogImportJournal journal=new LifelogImportJournal(MaterialStorage.prepare(absent,config),connection,config.account)){yes(journal.stage(batch,account,System.currentTimeMillis())==1);}
  Files.write(account.cacheFile(flutter).toPath(),OfficialHiveCacheTest.frame(OfficialHiveCacheTest.URL,null,true));MaterialSyncSession.Status held=new MaterialSyncSession(absent,config,source,guard,server).sync();yes(held.queued==1&&held.stored==0&&server.posts==2);Files.write(account.cacheFile(flutter).toPath(),cache);
  // Seeing changed content must also hold the old queued text, not silently send it.
  OfficialLifelogSnapshotTest.firstClip(fixture).put("content","更正：不要执行。");Files.write(log,LifelogImportJournalTest.bytes(LifelogImportJournalTest.log(fixture)));MaterialSyncSession.Status changed=new MaterialSyncSession(absent,config,source,guard,server).sync();yes(changed.conflicts==1&&changed.queued==1&&server.posts==2&&changed.note.equals("LIFELOG_SOURCE_REFRESH_REQUIRED"));
  // Account-specific queue directories do not expose old rows through a new login.
  yes(MaterialSyncSession.status(absent,new MaterialConfig(connection,other.binding,true)).queued==0);
  Files.write(log,LifelogImportJournalTest.bytes(LifelogImportJournalTest.log(OfficialLifelogSnapshotTest.fixture())));server.badAck=true;File blocked=new File(root,"blocked");MaterialSyncSession.Status badAck=new MaterialSyncSession(blocked,config,source,guard,server).sync();yes(badAck.blocked==1&&server.posts==3);
  MaterialSyncSession.Status retried=new MaterialSyncSession(blocked,config,source,guard,server).sync();yes(retried.stored==1&&server.posts==3&&server.lookups==2);
  File offline=new File(root,"offline");MaterialApi.Transport noNetwork=new MaterialApi.Transport(){public MaterialApi.Response exchange(String p,byte[] b)throws IOException{throw new IOException("OFFLINE");}public void cancel(){}};
  rejects(()->new MaterialSyncSession(offline,config,source,guard,noNetwork).sync());yes(MaterialSyncSession.status(offline,config).queued==1);MaterialSyncSession.Status resumed=new MaterialSyncSession(offline,config,source,guard,server).sync();yes(resumed.stored==1&&resumed.added==0&&server.posts==4);
  // A refreshed connection recovers an old import without changing its body.
  long currentTime=System.currentTimeMillis();MaterialConnection expiredConnection=LifelogImportJournalTest.connection(currentTime-3601000);File renewal=new File(root,"renewal"),renewalFiles=MaterialStorage.prepare(renewal,config);OfficialLifelogBatch originalBatch=source.read();String originalEvent;
  try(LifelogImportJournal j=new LifelogImportJournal(renewalFiles,expiredConnection,config.account);MaterialOutbox q=new MaterialOutbox(renewalFiles,expiredConnection)){yes(j.stage(originalBatch,account,currentTime-3601000)==1);j.replay(account,q::enqueue);originalEvent=(String)WireJson.map(q.all().get(0)).get("payload");}
  MemoryServer renewalServer=new MemoryServer(connection);MaterialSyncSession.Status renewed=new MaterialSyncSession(renewal,config,source,guard,renewalServer).sync();yes(renewed.stored==1&&renewed.added==0&&renewalServer.posts==1&&renewalServer.lookups==1);
  MaterialSyncSession.Status renewedAgain=new MaterialSyncSession(renewal,config,source,guard,renewalServer).sync();yes(renewedAgain.stored==1&&renewalServer.posts==1&&renewalServer.lookups==1);
  try(MaterialOutbox q=new MaterialOutbox(renewalFiles,connection)){Map<String,Object> row=WireJson.map(q.all().get(0));yes(WireJson.list(row.get("history")).size()==1);Map<String,Object> newEvent=WireJson.map(WireJson.read(((String)row.get("payload")).getBytes(StandardCharsets.UTF_8)));yes(Arrays.equals(WireJson.bytes(newEvent.get("body")),WireJson.bytes(WireJson.map(WireJson.read(originalEvent.getBytes(StandardCharsets.UTF_8))).get("body"))));}
  System.out.println("Material session: "+checks+" assertions passed");
 }
}
