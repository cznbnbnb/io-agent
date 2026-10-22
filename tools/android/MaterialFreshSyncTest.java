package com.turboio.addon;
import java.io.*;import java.nio.file.*;import java.util.*;

public final class MaterialFreshSyncTest {
 static int checks;static void yes(boolean value){checks++;if(!value)throw new AssertionError("Fresh session "+checks);}interface Work{void run()throws Exception;}
 static void reject(String code,Work work)throws Exception{checks++;try{work.run();}catch(IllegalArgumentException|IOException e){if(code.equals(e.getMessage()))return;throw e;}throw new AssertionError("Expected "+code);}
 static class Source implements MaterialSyncSession.FreshSource {
  final File flutter;final OfficialLifelogRefreshTest.Owner owner=new OfficialLifelogRefreshTest.Owner();OfficialLifelogRefreshTest.Transport http;
  Source(File root,Map<String,Object> fixture)throws Exception{flutter=new File(root,"flutter");File logs=new File(flutter,"appLog");logs.mkdirs();Files.write(owner.account.cacheFile(flutter).toPath(),OfficialHiveCacheTest.frame(OfficialHiveCacheTest.URL,OfficialHiveCacheTest.cached(true),false));Files.write(new File(logs,"synthetic.log").toPath(),LifelogImportJournalTest.bytes(LifelogImportJournalTest.log(fixture)));http=new OfficialLifelogRefreshTest.Transport(fixture);}
  public OfficialAccountBinding current(){return owner.current();}public OfficialLifelogBatch read()throws Exception{return OfficialLifelogBatch.read(flutter,owner);}public OfficialLifelogRefresh.Fresh refresh(OfficialLifelogBatch observed)throws Exception{return OfficialLifelogRefresh.read(observed,owner,http);}
 }
 public static void main(String[] args)throws Exception{
  File root=new File(args[0]);Map<String,Object> original=OfficialLifelogSnapshotTest.fixture(),changed=OfficialLifelogSnapshotTest.fixture();LifelogRevisionMapperTest.rename(changed,"合成的新标签");Source source=new Source(root,original);
  MaterialConnection c=LifelogImportJournalTest.connection(System.currentTimeMillis());MaterialConfig config=new MaterialConfig(c,source.current().binding,true);MaterialSyncSession.Guard guard=()->{};MaterialSyncSessionTest.MemoryServer server=new MaterialSyncSessionTest.MemoryServer(c);File files=new File(root,"success");
  MaterialSyncSession.Status first=new MaterialSyncSession(files,config,source,guard,server).sync();yes(first.added==1&&first.stored==1&&server.posts==1);
  source.http.body=WireJson.bytes(changed);MaterialSyncSession.Status revised=new MaterialSyncSession(files,config,source,guard,server).sync();yes(revised.added==1&&revised.stored==2&&server.posts==2);
  MaterialSyncSession.Status repeat=new MaterialSyncSession(files,config,source,guard,server).sync();yes(repeat.added==0&&repeat.stored==2&&server.posts==2);
  // A refreshed material must not acquire a competing bootstrap event when
  // the official endpoint is offline and its original logfile still exists.
  source.http.fail=true;reject("OFFICIAL_SOURCE_UNAVAILABLE",()->new MaterialSyncSession(files,config,source,guard,server).sync());yes(MaterialSyncSession.status(files,config).stored==2&&server.posts==2);source.http.fail=false;
  yes(new MaterialSyncSession(files,config,source,guard,server).sync().stored==2&&server.posts==2);
  // Existing dev2 bootstrap and a newer authoritative source coexist without
  // rewriting the original revision-one envelope or its server receipt.
  File migrated=new File(root,"migrated");MaterialSyncSession.Source legacy=new MaterialSyncSession.Source(){public OfficialAccountBinding current(){return source.current();}public OfficialLifelogBatch read()throws Exception{return source.read();}};
  reject("MATERIAL_LOCAL_REVISION_CONFLICT",()->new MaterialSyncSession(files,config,legacy,guard,server).sync());yes(MaterialSyncSession.status(files,config).stored==2&&server.posts==2);
  // A rollback can leave a rejected bootstrap intent. Returning to the new
  // reader must recover without deleting either intent or duplicating a POST.
  yes(new MaterialSyncSession(files,config,source,guard,server).sync().stored==2&&server.posts==2);
  yes(new MaterialSyncSession(migrated,config,legacy,guard,server).sync().stored==1);String before;
  try(MaterialOutbox q=new MaterialOutbox(MaterialSyncSession.accountFiles(migrated,config),c)){before=(String)WireJson.map(q.all().get(0)).get("payload");}
  yes(new MaterialSyncSession(migrated,config,source,guard,server).sync().stored==2);try(MaterialOutbox q=new MaterialOutbox(MaterialSyncSession.accountFiles(migrated,config),c)){yes(before.equals(WireJson.map(q.all().get(0)).get("payload")));}
  // Offline initial discovery is durable, but its queued old body cannot be
  // sent merely to satisfy CAS after discovering different official content.
  File offline=new File(root,"offline");MaterialSyncSessionTest.MemoryServer offlineServer=new MaterialSyncSessionTest.MemoryServer(c);source.http.fail=true;reject("OFFICIAL_SOURCE_UNAVAILABLE",()->new MaterialSyncSession(offline,config,source,guard,offlineServer).sync());yes(MaterialSyncSession.status(offline,config).queued==1&&offlineServer.posts==0);source.http.fail=false;
  reject("LIFELOG_PENDING_REVISION_CHANGED",()->new MaterialSyncSession(offline,config,source,guard,offlineServer).sync());yes(offlineServer.posts==0&&offlineServer.lookups==1&&MaterialSyncSession.status(offline,config).queued==1);
  source.http.body=WireJson.bytes(original);yes(new MaterialSyncSession(offline,config,source,guard,offlineServer).sync().stored==1&&offlineServer.posts==1);
  // A lost ACK followed by a changed official source must look up the old
  // event, then publish revision two without reposting the original text.
  File lost=new File(root,"lost");MaterialSyncSessionTest.MemoryServer lostServer=new MaterialSyncSessionTest.MemoryServer(c);lostServer.drop=true;reject("SYNTHETIC_LOST_ACK",()->new MaterialSyncSession(lost,config,source,guard,lostServer).sync());source.http.body=WireJson.bytes(changed);
  MaterialSyncSession.Status recovered=new MaterialSyncSession(lost,config,source,guard,lostServer).sync();yes(recovered.stored==2&&recovered.added==1&&lostServer.posts==2&&lostServer.lookups==1);
  yes(new MaterialSyncSession(lost,config,source,guard,lostServer).sync().stored==2&&lostServer.posts==2);
  // A logout during official HTTP reception fences all durable writes/sends.
  File flip=new File(root,"flip");int posts=server.posts;source.http.during=()->source.owner.account=LifelogImportJournalTest.account(43);reject("OFFICIAL_ACCOUNT_CHANGED",()->new MaterialSyncSession(flip,config,source,guard,server).sync());yes(server.posts==posts&&MaterialSyncSession.status(flip,config).queued==0);
  System.out.println("Material fresh session: "+checks+" assertions passed");
 }
}
