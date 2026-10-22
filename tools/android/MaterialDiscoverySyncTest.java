package com.turboio.addon;

import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;

/** Synthetic day-list/full transports and local temporary journals only. */
public final class MaterialDiscoverySyncTest {
 static int checks;
 static void yes(boolean value){checks++;if(!value)throw new AssertionError("Discovery session "+checks);}
 interface Work {void run()throws Exception;}
 static void reject(String code,Work work)throws Exception{
  checks++;try{work.run();}catch(IOException|IllegalArgumentException e){if(code.equals(e.getMessage()))return;throw e;}
  throw new AssertionError("Expected "+code);
 }
 static final class Source extends OfficialLifelogDiscoveryTest.Wire implements MaterialSyncSession.DiscoverySource {
  public OfficialLifelogDiscovery.Snapshot discover()throws Exception{
   lists=fulls=0;
   return OfficialLifelogDiscovery.read(OfficialLifelogDiscoveryTest.ACCOUNT.binding,
     Collections.singletonList(OfficialLifelogDiscoveryTest.DAY),this,this);
  }
 }
 static final MaterialSyncSession.Guard GUARD=()->{};
 static MaterialSyncSession.Status sync(File root,MaterialConfig config,MaterialSyncSession.AccountSource source,MaterialApi.Transport server)throws Exception{
  return new MaterialSyncSession(root,config,source,GUARD,server).sync();
 }
 static List<String> payloads(File root,MaterialConfig config)throws Exception{
  List<String> result=new ArrayList<>();
  try(MaterialOutbox q=new MaterialOutbox(MaterialSyncSession.accountFiles(root,config),config.connection)){
   for(Object raw:q.all())result.add((String)WireJson.map(raw).get("payload"));
  }
  return result;
 }
 static Map<String,Object> body(String payload){return WireJson.map(WireJson.map(WireJson.read(payload.getBytes(StandardCharsets.UTF_8))).get("body"));}
 static Source changed(){Source source=new Source();OfficialLifelogSnapshotTest.firstClip(source.detail).put("content","合成修订：周五再处理。\n保留完整附加条件 😀");return source;}
 static final MaterialApi.Transport OFFLINE=new MaterialApi.Transport(){
  public MaterialApi.Response exchange(String path,byte[] payload)throws IOException{throw new IOException("SYNTHETIC_SERVER_OFFLINE");}
  public void cancel(){}
 };
 public static void main(String[] args)throws Exception{
  File root=new File(args[0]);
  MaterialConnection connection=LifelogImportJournalTest.connection(System.currentTimeMillis());
  MaterialConfig config=new MaterialConfig(connection,OfficialLifelogDiscoveryTest.ACCOUNT.binding,true);

  // A brand-new account needs no Flutter cache or detail log to import a day.
  File firstRoot=new File(root,"no-logs");Source source=new Source();
  MaterialSyncSessionTest.MemoryServer server=new MaterialSyncSessionTest.MemoryServer(connection);
  MaterialSyncSession.Status first=sync(firstRoot,config,source,server);
  yes(first.added==1&&first.stored==1&&server.posts==1);
  yes(first.discovered==1&&first.days==1&&first.recordings==1&&first.otherEntries==0);
  yes(source.lists==2&&source.fulls==1);
  yes(!new File(firstRoot,"app_flutter").exists()&&!new File(firstRoot,"flutter").exists());
  List<String> initial=payloads(firstRoot,config);
  MaterialSyncSession.Status repeat=sync(firstRoot,config,new Source(),server);
  yes(repeat.added==0&&repeat.stored==1&&server.posts==1);
  yes(initial.equals(payloads(firstRoot,config)));
  MaterialSyncSession.Status revised=sync(firstRoot,config,changed(),server);
  yes(revised.added==1&&revised.stored==2&&server.posts==2);
  List<String> versions=payloads(firstRoot,config);yes(versions.size()==2&&versions.get(0).equals(initial.get(0)));
  Map<String,Object> before=body(versions.get(0)),after=body(versions.get(1));
  yes(before.get("material_id").equals(after.get("material_id")));
  yes(((Number)after.get("revision")).intValue()==2&&((Number)after.get("base_revision")).intValue()==1);
  yes(((Number)after.get("text_revision")).intValue()==2);
  yes(((String)WireJson.map(after.get("full_text")).get("text")).startsWith("合成修订：周五再处理。\n保留完整附加条件 😀\n"));
  yes(sync(firstRoot,config,changed(),server).added==0&&server.posts==2);

  // A day disappearing from the inventory does not imply deletion, nor does
  // an unsupported ordinary recording authorize uploading a lifelog body.
  Source empty=new Source();OfficialLifelogInventoryTest.data(empty.listing).put("events",Collections.emptyList());
  MaterialSyncSession.Status absent=sync(firstRoot,config,empty,server);
  yes(absent.stored==2&&absent.added==0&&absent.discovered==0&&absent.note.equals("no_day_sources"));
  yes(empty.fulls==0&&server.posts==2&&versions.equals(payloads(firstRoot,config)));
  for(String payload:payloads(firstRoot,config))yes(body(payload).get("operation").equals("upsert"));
  Source recording=new Source();OfficialLifelogInventoryTest.data(recording.listing).put("events",Collections.singletonList(OfficialLifelogInventoryTest.event("recording-only","recording")));
  MaterialSyncSession.Status deferred=sync(new File(root,"recording-only"),config,recording,server);
  yes(deferred.discovered==0&&deferred.recordings==1&&deferred.stored==0&&recording.fulls==0&&server.posts==2);

  // A valid source can be journaled before an unavailable material service.
  // Subsequent discovery failures must never flush that previously seen body.
  File pendingRoot=new File(root,"pending");
  reject("SYNTHETIC_SERVER_OFFLINE",()->sync(pendingRoot,config,new Source(),OFFLINE));
  List<String> pending=payloads(pendingRoot,config);yes(pending.size()==1&&MaterialSyncSession.status(pendingRoot,config).queued==1);
  MaterialSyncSessionTest.MemoryServer pendingServer=new MaterialSyncSessionTest.MemoryServer(connection);
  Source changedList=new Source();changedList.changedAfterFull=true;
  reject("LIFELOG_INVENTORY_CHANGED",()->sync(pendingRoot,config,changedList,pendingServer));
  yes(pendingServer.posts==0&&pending.equals(payloads(pendingRoot,config)));
  Source accountChange=new Source();accountChange.switchAccount=true;
  reject("OFFICIAL_ACCOUNT_CHANGED",()->sync(pendingRoot,config,accountChange,pendingServer));
  yes(pendingServer.posts==0&&pending.equals(payloads(pendingRoot,config)));
  Source offlineList=new Source();offlineList.failList=true;
  reject("SYNTHETIC_OFFLINE",()->sync(pendingRoot,config,offlineList,pendingServer));
  yes(pendingServer.posts==0&&pending.equals(payloads(pendingRoot,config)));
  Source offlineFull=new Source();offlineFull.failFull=true;
  reject("SYNTHETIC_FULL_UNAVAILABLE",()->sync(pendingRoot,config,offlineFull,pendingServer));
  yes(pendingServer.posts==0&&pending.equals(payloads(pendingRoot,config)));
  Source emptyPending=new Source();OfficialLifelogInventoryTest.data(emptyPending.listing).put("events",Collections.emptyList());
  sync(pendingRoot,config,emptyPending,pendingServer);
  yes(pendingServer.posts==0&&pending.equals(payloads(pendingRoot,config))&&MaterialSyncSession.status(pendingRoot,config).queued==1);
  // Even a valid changed full cannot replace or send a never-acknowledged
  // predecessor just to obtain the revision sequence it needs.
  reject("LIFELOG_PENDING_REVISION_CHANGED",()->sync(pendingRoot,config,changed(),pendingServer));
  yes(pendingServer.posts==0&&pendingServer.lookups==1&&pending.equals(payloads(pendingRoot,config)));
  yes(sync(pendingRoot,config,new Source(),pendingServer).stored==1&&pendingServer.posts==1);

  // A process-style reopen after a lost ACK reconciles the event ID before
  // committing newer text. The initial POST is never duplicated.
  File lostRoot=new File(root,"lost-ack");MaterialSyncSessionTest.MemoryServer lostServer=new MaterialSyncSessionTest.MemoryServer(connection);lostServer.drop=true;
  reject("SYNTHETIC_LOST_ACK",()->sync(lostRoot,config,new Source(),lostServer));
  List<String> lostPayloads=payloads(lostRoot,config);
  yes(lostServer.posts==1&&MaterialSyncSession.status(lostRoot,config).reconcile==1);
  MaterialSyncSession.Status recovered=sync(lostRoot,config,changed(),lostServer);
  yes(recovered.stored==2&&recovered.added==1&&lostServer.posts==2&&lostServer.lookups==1);
  yes(payloads(lostRoot,config).get(0).equals(lostPayloads.get(0)));
  yes(sync(lostRoot,config,changed(),lostServer).added==0&&lostServer.posts==2&&lostServer.lookups==1);

  // Transition from the old logged-URL fresh reader to date discovery keeps
  // the same stable material identity, original envelope and server receipt.
  File legacyRoot=new File(root,"legacy"),flutter=new File(root,"legacy-flutter"),logs=new File(flutter,"appLog");yes(logs.mkdirs());
  OfficialLifelogRefreshTest.Owner owner=new OfficialLifelogRefreshTest.Owner();owner.account=OfficialLifelogDiscoveryTest.ACCOUNT;
  Files.write(owner.account.cacheFile(flutter).toPath(),OfficialHiveCacheTest.frame(OfficialHiveCacheTest.URL,OfficialHiveCacheTest.cached(true),false));
  Files.write(new File(logs,"synthetic.log").toPath(),LifelogImportJournalTest.bytes(LifelogImportJournalTest.log(OfficialLifelogSnapshotTest.fixture())));
  MaterialSyncSession.FreshSource legacy=new MaterialSyncSession.FreshSource(){
   public OfficialAccountBinding current(){return owner.current();}
   public OfficialLifelogBatch read()throws Exception{return OfficialLifelogBatch.read(flutter,owner);}
   public OfficialLifelogRefresh.Fresh refresh(OfficialLifelogBatch observed)throws Exception{return OfficialLifelogRefresh.read(observed,owner,new OfficialLifelogRefreshTest.Transport(OfficialLifelogSnapshotTest.fixture()));}
  };
  MaterialSyncSessionTest.MemoryServer legacyServer=new MaterialSyncSessionTest.MemoryServer(connection);
  yes(sync(legacyRoot,config,legacy,legacyServer).stored==1&&legacyServer.posts==1);
  List<String> legacyPayloads=payloads(legacyRoot,config);
  Files.delete(new File(logs,"synthetic.log").toPath());Files.delete(owner.account.cacheFile(flutter).toPath());
  MaterialSyncSession.Status migrated=sync(legacyRoot,config,new Source(),legacyServer);
  yes(migrated.added==0&&migrated.stored==1&&legacyServer.posts==1);
  yes(legacyPayloads.equals(payloads(legacyRoot,config)));
  yes(sync(legacyRoot,config,changed(),legacyServer).stored==2&&legacyServer.posts==2);
  yes(payloads(legacyRoot,config).get(0).equals(legacyPayloads.get(0)));
  System.out.println("Material discovery session: "+checks+" assertions passed");
 }
}
