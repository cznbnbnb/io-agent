package com.turboio.addon;
import java.io.*;import java.nio.file.*;import java.nio.charset.StandardCharsets;import java.util.*;

/** Narrow legacy repair must not become general pending-body replacement. */
public final class MaterialRepairTest {
 static int checks;static long now;static MaterialConnection connection;static byte[] base,bad,valid;
 static void yes(boolean v){checks++;if(!v)throw new AssertionError("Material repair "+checks);}
 interface Work{void run()throws Exception;}static void rejects(Work work)throws Exception{checks++;try{work.run();}catch(IOException|IllegalArgumentException expected){return;}throw new AssertionError("Expected repair rejection "+checks);}
 static Map<String,Object> parse(byte[] v){return WireJson.map(WireJson.read(v));}
 static Map<String,Object> last(MaterialOutbox q){return WireJson.map(q.all().get(q.all().size()-1));}
 static byte[] event(Map<String,Object> body,String id){return WireJson.bytes(WireJson.object("schema_version","1.2","event_id",id,"idempotency_key",id,"kind","material.revision","producer_id",connection.producer,"created_at",TaskWire.now(now-1000),"expires_at",connection.expires,"body",body));}
 static void seed(MaterialOutbox q,byte[] pending)throws Exception{q.enqueue(base);MaterialOutbox.Claim claim=q.claim(now,Collections.singleton("1.2"));q.finish(claim,201,MaterialTest.ack(claim),now,0);q.enqueue(pending);}
 static MaterialOutbox.Claim lookup(MaterialOutbox q,int status,byte[] response)throws Exception{MaterialOutbox.Claim claim=q.claimLookup((String)last(q).get("event_id"));yes(claim!=null&&claim.action.equals("lookup"));q.finish(claim,status,response,now,0);return claim;}
 public static void main(String[] args)throws Exception{
  File root=new File(args[0]);Map<String,Object> fixture=parse(Files.readAllBytes(Paths.get(args[1])));now=MaterialWire.number(fixture.get("now"));connection=MaterialConnection.parse(WireJson.bytes(fixture.get("connection")),now);MaterialTest.connection=connection;MaterialTest.now=now;
  String account=LifelogImportJournalTest.account(46).binding;Map<String,Object> initial=OfficialLifelogSnapshotTest.fixture(),renamed=OfficialLifelogSnapshotTest.fixture();for(Object c:WireJson.list(OfficialLifelogSnapshotTest.source(renamed).get("clips")))WireJson.map(c).put("speakerName","合成修复标签");
  Map<String,Object> first=parse(OfficialLifelogSnapshotTest.read(initial).materialBody(account,1)),second=parse(OfficialLifelogSnapshotTest.read(renamed).materialRevision(account,2,WireJson.bytes(first)));base=event(first,"repair-base");valid=event(second,"repair-valid");second.put("text_revision",1L);bad=event(second,"repair-bad");
  File recover=new File(root,"recover");String fixed;
  try(MaterialOutbox q=new MaterialOutbox(recover,connection)){
   seed(q,bad);yes(q.needsTextRevisionRepair("repair-bad"));MaterialOutbox.Claim send=q.claim(now,Collections.singleton("1.2"));yes(!q.repairTextRevision(send,404,MaterialRenewalTest.absent(),connection,now));q.finish(send,409,new byte[0],now,0);
   MaterialOutbox.Claim missing=lookup(q,404,WireJson.bytes(WireJson.object("schema_version","1.0","error",WireJson.object("code","NOT_FOUND"))));yes(!q.repairTextRevision(missing,404,WireJson.bytes(WireJson.object("schema_version","1.0","error",WireJson.object("code","NOT_FOUND"))),connection,now));yes(last(q).get("payload").equals(new String(bad,StandardCharsets.UTF_8)));
   MaterialOutbox.Claim unknown=lookup(q,503,new byte[0]);yes(!q.repairTextRevision(unknown,503,new byte[0],connection,now));yes(q.needsTextRevisionRepair("repair-bad"));
   // Stop while GET is in flight. Reopen must require another lookup.
   q.claimLookup("repair-bad");
  }
  try(MaterialOutbox q=new MaterialOutbox(recover,connection)){
   yes(last(q).get("state").equals("reconcile"));yes(last(q).get("text_revision_repair")==null);MaterialOutbox.Claim absent=lookup(q,404,MaterialRenewalTest.absent());
   rejects(()->q.repairTextRevision(absent,404,MaterialRenewalTest.absent(),connection,connection.expiresAt));yes(last(q).get("payload").equals(new String(bad,StandardCharsets.UTF_8)));
   yes(q.repairTextRevision(absent,404,MaterialRenewalTest.absent(),connection,now));fixed=(String)last(q).get("payload");yes(!q.needsTextRevisionRepair("repair-bad"));yes(!q.repairTextRevision(absent,404,MaterialRenewalTest.absent(),connection,now));
   Map<String,Object> corrected=WireJson.map(parse(fixed.getBytes(StandardCharsets.UTF_8)).get("body")),expected=WireJson.map(WireJson.copy(second));expected.put("text_revision",2L);yes(corrected.equals(expected));yes(WireJson.map(last(q).get("text_revision_repair")).get("payload").equals(new String(bad,StandardCharsets.UTF_8)));
  }
  // Crash boundary after atomic repair and before journal replay/POST.
  try(MaterialOutbox q=new MaterialOutbox(recover,connection)){
   q.enqueue(bad);yes(last(q).get("payload").equals(fixed));Map<String,Object> altered=parse(bad);altered.put("created_at",TaskWire.now(now-999));rejects(()->q.enqueue(WireJson.bytes(altered)));
   MaterialOutbox.Claim send=q.claim(now,Collections.singleton("1.2"));yes(send.action.equals("send")&&!send.eventId.equals("repair-bad"));q.finish(send,0,new byte[0],now,0);
  }
  try(MaterialOutbox q=new MaterialOutbox(recover,connection)){
   MaterialOutbox.Claim claim=q.claim(now+60000,Collections.singleton("1.2"));yes(claim.action.equals("lookup"));q.finish(claim,200,MaterialTest.ack(claim),now,0);yes(last(q).get("state").equals("server_stored"));q.enqueue(bad);yes(q.claim(now+60000,Collections.singleton("1.2"))==null);
  }
  try(MaterialOutbox q=new MaterialOutbox(new File(root,"valid"),connection)){seed(q,valid);yes(!q.needsTextRevisionRepair("repair-valid"));MaterialOutbox.Claim c=lookup(q,404,MaterialRenewalTest.absent());yes(!q.repairTextRevision(c,404,MaterialRenewalTest.absent(),connection,now));yes(last(q).get("text_revision_repair")==null);}
  try(MaterialOutbox q=new MaterialOutbox(new File(root,"base-unknown"),connection)){q.enqueue(base);q.enqueue(bad);yes(!q.needsTextRevisionRepair("repair-bad"));MaterialOutbox.Claim c=lookup(q,404,MaterialRenewalTest.absent());yes(!q.repairTextRevision(c,404,MaterialRenewalTest.absent(),connection,now));}
  try(MaterialOutbox q=new MaterialOutbox(new File(root,"already-stored"),connection)){seed(q,bad);MaterialOutbox.Claim c=q.claimLookup("repair-bad");q.finish(c,200,MaterialTest.ack(c),now,0);yes(!q.repairTextRevision(c,200,MaterialTest.ack(c),connection,now));yes(!q.needsTextRevisionRepair("repair-bad"));}
  try(MaterialOutbox q=new MaterialOutbox(new File(root,"later-delete"),connection)){seed(q,bad);MaterialOutbox.Claim c=lookup(q,404,MaterialRenewalTest.absent());Map<String,Object> tombstone=WireJson.map(WireJson.copy(second));tombstone.put("revision",3L);tombstone.put("base_revision",2L);tombstone.put("operation","delete");tombstone.put("utterances",new ArrayList<>());tombstone.put("speakers",new ArrayList<>());WireJson.map(tombstone.get("full_text")).put("text","");q.enqueue(event(tombstone,"repair-delete"));yes(!q.repairTextRevision(c,404,MaterialRenewalTest.absent(),connection,now));}
  Path state=new File(recover,"material-outbox/"+connection.binding()+"/state.json").toPath();byte[] intact=Files.readAllBytes(state);Map<String,Object> damaged=parse(intact);Map<String,Object> last=WireJson.map(WireJson.list(damaged.get("rows")).get(1));WireJson.map(last.get("text_revision_repair")).put("base_payload_sha256","0".repeat(64));Files.write(state,WireJson.bytes(damaged));byte[] damagedBytes=Files.readAllBytes(state);rejects(()->{try(MaterialOutbox q=new MaterialOutbox(recover,connection)){} });yes(Arrays.equals(damagedBytes,Files.readAllBytes(state)));Files.write(state,intact);
  // Older readers must fail closed at the version gate, before queue rewrites.
  yes(MaterialWire.positive(parse(intact).get("schema"))==3);
  Files.write(Paths.get(state.toString()+".partial"),new byte[]{1});rejects(()->{try(MaterialOutbox q=new MaterialOutbox(recover,connection)){} });yes(Arrays.equals(intact,Files.readAllBytes(state)));
  System.out.println("Material repair: "+checks+" assertions passed");
 }
}
