package com.turboio.addon;
import java.io.*;import java.nio.charset.StandardCharsets;import java.nio.file.*;import java.util.*;import java.util.concurrent.atomic.AtomicInteger;

public final class LifelogImportJournalTest {
 static int checks;static void yes(boolean ok){checks++;if(!ok)throw new AssertionError("Lifelog import "+checks);}interface Work{void run()throws Exception;}static void rejects(Work work)throws Exception{checks++;try{work.run();}catch(IllegalArgumentException expected){return;}throw new AssertionError("Expected import rejection "+checks);}
 static byte[] bytes(String value){return value.getBytes(StandardCharsets.UTF_8);}
 static OfficialAccountBinding account(long id){return OfficialAccountBinding.read(WireJson.bytes(WireJson.object("accountId",id,"domain","synthetic")));}
 static String log(Map<String,Object> fixture){return "[Interceptor.Http] ← [GET https://xr-api-p.rayneo.cn/lifelog/api/v1/events/"+OfficialLifelogSnapshotTest.EVENT+"/full?#] response body: "+new String(WireJson.bytes(fixture),StandardCharsets.UTF_8)+"\n";}
 static MaterialConnection connection(long now){return MaterialConnection.parse(WireJson.bytes(WireJson.object("format",MaterialConnection.FORMAT,"base_url","https://synthetic.invalid/v1","owner_id","synthetic-owner","producer_id","synthetic-phone","server_id","synthetic-server","token",String.join("",Collections.nCopies(43,"A")),"token_id","00000000-0000-4000-8000-000000000001","expires_at",TaskWire.now(now+3600000))),now);}
 public static void main(String[] args)throws Exception{
  File root=new File(args[0]),flutter=new File(root,"app_flutter"),logs=new File(flutter,"appLog");yes(logs.mkdirs());OfficialAccountBinding account=account(42),other=account(43);Path file=new File(logs,"synthetic.log").toPath();byte[] cache=OfficialHiveCacheTest.frame(OfficialHiveCacheTest.URL,OfficialHiveCacheTest.cached(true),false);Files.write(account.cacheFile(flutter).toPath(),cache);
  Map<String,Object> original=OfficialLifelogSnapshotTest.fixture();Files.write(file,bytes(log(original)+log(original)));OfficialLifelogBatch batch=OfficialLifelogBatch.read(flutter,()->account);yes(batch.sources.size()==1&&batch.conflicts==0&&batch.selectedInventoryComplete);yes(batch.account.equals(account.binding));yes(Arrays.equals(cache,Files.readAllBytes(account.cacheFile(flutter).toPath())));
  AtomicInteger calls=new AtomicInteger();rejects(()->OfficialLifelogBatch.read(flutter,()->calls.incrementAndGet()==1?account:other));
  long now=System.currentTimeMillis();MaterialConnection connection=connection(now);String firstPayload;
  try(LifelogImportJournal journal=new LifelogImportJournal(root,connection,account.binding);MaterialOutbox outbox=new MaterialOutbox(root,connection)){
   yes(journal.stage(batch,account,now)==1);yes(journal.stage(batch,account,now+1)==0);rejects(()->journal.stage(batch,other,now));rejects(()->journal.replay(other,e->outbox.enqueue(e)));
   // Crash after queue commit, before the caller sees success. The journal must
   // replay exactly the same event, including timestamps/idempotency key.
   boolean failed=false;try{journal.replay(account,e->{outbox.enqueue(e);throw new IOException("SYNTHETIC_CRASH");});}catch(IOException expected){failed=true;}yes(failed&&outbox.all().size()==1);firstPayload=(String)WireJson.map(outbox.all().get(0)).get("payload");
  }
  try(LifelogImportJournal journal=new LifelogImportJournal(root,connection,account.binding);MaterialOutbox outbox=new MaterialOutbox(root,connection)){
   yes(journal.replay(account,e->outbox.enqueue(e))==1);yes(outbox.all().size()==1&&firstPayload.equals(WireJson.map(outbox.all().get(0)).get("payload")));
   yes(journal.stage(batch,account,now+1000)==0);
   Map<String,Object> changed=OfficialLifelogSnapshotTest.fixture();OfficialLifelogSnapshotTest.firstClip(changed).put("content","更正：仅预览，禁止执行。");Files.write(file,bytes(log(changed)+log(original)));OfficialLifelogBatch conflict=OfficialLifelogBatch.read(flutter,()->account);yes(conflict.conflicts==1&&conflict.sources.isEmpty());yes(journal.stage(conflict,account,now)==0);
   // Even if the earlier log rotates away, a different body cannot silently
   // become revision 1 or overwrite a newer reviewed/server revision.
   Files.write(file,bytes(log(changed)));OfficialLifelogBatch fresh=OfficialLifelogBatch.read(flutter,()->account);rejects(()->journal.stage(fresh,account,now));yes(outbox.all().size()==1);
   Files.write(account.cacheFile(flutter).toPath(),OfficialHiveCacheTest.frame(OfficialHiveCacheTest.URL,null,true));OfficialLifelogBatch missing=OfficialLifelogBatch.read(flutter,()->account);yes(missing.unowned==1&&missing.sources.isEmpty());yes(journal.stage(missing,account,now)==0);yes(outbox.all().size()==1);yes(WireJson.map(WireJson.map(WireJson.read(bytes(firstPayload))).get("body")).get("operation").equals("upsert"));
  }
  // Account namespace isolates the same source ID and queue remains untouched.
  Files.write(other.cacheFile(flutter).toPath(),cache);OfficialLifelogBatch separate=OfficialLifelogBatch.read(flutter,()->other);yes(!separate.sources.get(0).materialId(other.binding).equals(batch.sources.get(0).materialId(account.binding)));
  try(LifelogImportJournal empty=new LifelogImportJournal(root,connection,other.binding)){yes(empty.replay(other,e->{throw new AssertionError("wrong account replay");})==0);}
  // Missing/malformed selected response does not erase an existing journal.
  Files.write(account.cacheFile(flutter).toPath(),cache);Map<String,Object> bad=OfficialLifelogSnapshotTest.fixture();bad.put("code",401);Files.write(file,bytes(log(bad)));OfficialLifelogBatch rejected=OfficialLifelogBatch.read(flutter,()->account);yes(rejected.invalid==1&&rejected.sources.isEmpty());
  Files.write(file,OfficialHiveCacheTest.concat(bytes(log(original)),new byte[]{(byte)255,10}));OfficialLifelogBatch damaged=OfficialLifelogBatch.read(flutter,()->account);yes(!damaged.scanConsistent&&damaged.sources.isEmpty());try(LifelogImportJournal journal=new LifelogImportJournal(root,connection,account.binding)){rejects(()->journal.stage(damaged,account,now));}
  System.out.println("Lifelog import: "+checks+" assertions passed");
 }
}
