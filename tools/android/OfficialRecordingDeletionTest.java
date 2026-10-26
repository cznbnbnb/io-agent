package com.turboio.addon;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.*;

public final class OfficialRecordingDeletionTest {
 private static int checks;
 private static final OfficialAccountBinding A=account(123),B=account(456);
 private static OfficialAccountBinding account(long id){return OfficialAccountBinding.read(WireJson.bytes(WireJson.object("accountId",id,"domain","cn")));}
 private static void yes(boolean value){checks++;if(!value)throw new AssertionError("check "+checks);}
 private interface Action {void run()throws Exception;}
 private static void no(Action action)throws Exception{checks++;try{action.run();}catch(IOException|IllegalArgumentException expected){return;}throw new AssertionError("accepted invalid source: "+checks);}
 private static Map<String,Object> operation(String id,List<String> explicit,List<String> protect,Long cutoff){return WireJson.object("id",id,"explicitTaskIds",explicit,"protectedTaskIds",protect,"cutoffMs",cutoff);}
 private static String encode(Object value){return new String(WireJson.bytes(value),StandardCharsets.UTF_8);}
 private static Map<String,Object> ledger(){return WireJson.object("deletedTaskIds",new ArrayList<>(Arrays.asList("recording-one")),"serverDeletionRetryTaskIds",new ArrayList<>(Arrays.asList("retry-only")),"pending",null,"deleteAll",null);}
 private static final class Source implements OfficialRecordingDeletion.Source {
  OfficialAccountBinding account=A;String raw=encode(ledger()),second;int reads;boolean fail,changeAccount;
  public OfficialAccountBinding current(){return account;}
  public String read(String key)throws Exception{
   yes(key.equals(account.recordingDeletionKey()));reads++;
   if(fail)throw new IOException("offline store");
   if(changeAccount)account=B;
   return reads>1&&second!=null?second:raw;
  }
 }
 private static OfficialRecordingDeletion.Snapshot read(Source source)throws Exception{return OfficialRecordingDeletion.read(A,source);}
 public static void main(String[] ignored)throws Exception{
  Source source=new Source();OfficialRecordingDeletion.Snapshot saved=read(source);
  yes(saved.present&&!saved.pending&&!saved.historical);
  yes(saved.committedTasks.equals(new TreeSet<>(Arrays.asList("recording-one"))));
  yes(!saved.committedTasks.contains("retry-only"));yes(source.reads==2);
  yes(A.recordingDeletionKey().equals("user_123_recording_deletion_ledger_v1"));
  final OfficialRecordingDeletion.Snapshot committed=saved;no(()->committed.material("retry-only"));
  OfficialLifelogSnapshot.Source original=OfficialLifelogSnapshot.original(WireJson.bytes(WireJson.object("sourceId","recording-one","sourceType","conversation","title","synthetic","startTime","1700000000000","endTime","1700000001000","clips",new ArrayList<>())));
  yes(saved.material("recording-one").equals(original.materialId(A.binding)));
  yes(!saved.material("recording-one").equals(original.materialId(B.binding)));
  source=new Source();source.raw=null;OfficialRecordingDeletion.Snapshot missing=read(source);
  yes(!missing.present&&missing.committedTasks.isEmpty());
  source.raw=encode(ledger());final Source appeared=source;no(()->missing.revalidate(appeared));
  source=new Source();Map<String,Object> value=ledger();value.put("deletedTaskIds",new ArrayList<>());source.raw=encode(value);
  yes(read(source).committedTasks.isEmpty());
  value=ledger();value.put("pending",operation("pending-1",Arrays.asList("pending-only"),Collections.emptyList(),null));source.raw=encode(value);
  OfficialRecordingDeletion.Snapshot pending=read(source);yes(pending.pending&&pending.committedTasks.isEmpty());
  value.put("pending",null);source.raw=encode(value);yes(read(source).committedTasks.contains("recording-one"));
  value=ledger();value.put("deleteAll",operation("all-1",Arrays.asList("historical-explicit"),Arrays.asList("recording-one"),1000L));source.raw=encode(value);
  saved=read(source);yes(saved.historical&&saved.committedTasks.isEmpty());
  // A cutoff and operation.explicitTaskIds are not an observed committed set.
  yes(!saved.committedTasks.contains("historical-explicit"));
  for(Object invalid:new Object[]{"null","[]","{}","{\"deletedTaskIds\":[]}"," ",encode(WireJson.object("deletedTaskIds",new ArrayList<>(),"serverDeletionRetryTaskIds",new ArrayList<>(),"pending",null,"deleteAll",null,"committed",true))}){
   final Source bad=new Source();bad.raw=(String)invalid;no(()->read(bad));
  }
  for(Object invalid:new Object[]{Arrays.asList("same","same"),Arrays.asList("../escape"),Arrays.asList(1L),Arrays.asList(""),"not a list"}){
   final Source bad=new Source();Map<String,Object> broken=ledger();broken.put("deletedTaskIds",invalid);bad.raw=encode(broken);no(()->read(bad));
  }
  final Source switching=new Source();switching.changeAccount=true;no(()->read(switching));
  final Source wrong=new Source();wrong.account=B;no(()->read(wrong));yes(wrong.reads==0);
  final Source changing=new Source();Map<String,Object> changed=ledger();changed.put("deletedTaskIds",new ArrayList<>());changing.second=encode(changed);no(()->read(changing));
  final Source failed=new Source();failed.fail=true;no(()->read(failed));
  final Source malformed=new Source();Map<String,Object> broken=ledger();broken.put("pending",operation("bad",Arrays.asList("same"),Arrays.asList("same"),0L));malformed.raw=encode(broken);no(()->read(malformed));
  final Source late=new Source();OfficialRecordingDeletion.Snapshot earlier=read(late);late.raw=null;no(()->earlier.revalidate(late));
  final Source interrupted=new Source();Thread.currentThread().interrupt();try{no(()->read(interrupted));}finally{Thread.interrupted();}yes(interrupted.reads==0);
  System.out.println("Official recording deletion: "+checks+" checks passed; synthetic settled/pending/rollback/account/store transitions; no device or deletion");
 }
}
