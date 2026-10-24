package com.turboio.addon;
import java.io.*;import java.nio.file.*;import java.util.*;import java.util.concurrent.atomic.AtomicReference;

public final class LifelogRevisionJournalTest {
 static int checks;static void yes(boolean b){checks++;if(!b)throw new AssertionError("Revision journal "+checks);}interface Work{void run()throws Exception;}
 static void reject(String code,Work work)throws Exception{checks++;try{work.run();}catch(IllegalArgumentException|IOException e){if(code.equals(e.getMessage()))return;throw e;}throw new AssertionError("Expected "+code);}
 static List<OfficialLifelogSnapshot.Source> sources(Map<String,Object> f){return Arrays.asList(OfficialLifelogSnapshotTest.read(f));}
 static byte[] bytes(Object value){return WireJson.bytes(value);}
 /** Same fixture under another source id, with synthetic clips well past the 256KiB event limit. */
 static Map<String,Object> oversized(String sourceId){
  Map<String,Object> f=WireJson.map(WireJson.read(new String(bytes(OfficialLifelogSnapshotTest.fixture()),java.nio.charset.StandardCharsets.UTF_8).replace(OfficialLifelogSnapshotTest.SOURCE,sourceId).getBytes(java.nio.charset.StandardCharsets.UTF_8)));
  List<Object> clips=new ArrayList<>();String text=String.join("",Collections.nCopies(300,"合成超长正文。"));for(int i=0;i<32;i++)clips.add(OfficialLifelogSnapshotTest.clip("clip-big-"+i,i*200,i*200+100,text));
  OfficialLifelogSnapshotTest.source(f).put("clips",clips);return f;
 }
 public static void main(String[] args)throws Exception{
  File root=new File(args[0]);long now=System.currentTimeMillis();MaterialConnection c=LifelogImportJournalTest.connection(now);OfficialAccountBinding account=LifelogImportJournalTest.account(42),other=LifelogImportJournalTest.account(43);AtomicReference<OfficialAccountBinding> current=new AtomicReference<>(account);LifelogRevisionJournal.Guard guard=current::get;
  MaterialSyncSessionTest.MemoryServer server=new MaterialSyncSessionTest.MemoryServer(c);MaterialApi api=new MaterialApi(c,server);Map<String,Object> original=OfficialLifelogSnapshotTest.fixture(),renamed=OfficialLifelogSnapshotTest.fixture();LifelogRevisionMapperTest.rename(renamed,"合成修订标签");String initialPayload;
  // Crash after source intent fsync, before any outbox enqueue. Reopen must replay
  // the exact event rather than prepare a second event with fresh timestamps.
  try(LifelogRevisionJournal j=new LifelogRevisionJournal(root,c,account.binding);MaterialOutbox q=new MaterialOutbox(root,c)){
   yes(j.stageFresh(sources(original),guard,q,now)==1);yes(q.all().isEmpty());reject("LIFELOG_REVISION_REPLAY_REQUIRED",()->j.stageFresh(sources(original),guard,q,now+1));
  }
  try(LifelogRevisionJournal j=new LifelogRevisionJournal(root,c,account.binding);MaterialOutbox q=new MaterialOutbox(root,c)){
   yes(j.replay(guard,q)==1);initialPayload=(String)WireJson.map(q.all().get(0)).get("payload");yes(j.replay(guard,q)==1&&q.all().size()==1);yes(j.stageFresh(sources(original),guard,q,now+2)==0);
   reject("LIFELOG_PENDING_REVISION_CHANGED",()->j.stageFresh(sources(renamed),guard,q,now+3));yes(q.all().size()==1&&server.posts==0);yes(api.pump(q,now+4));yes(server.posts==1);
   current.set(other);reject("OFFICIAL_ACCOUNT_CHANGED",()->j.stageFresh(sources(renamed),guard,q,now+5));current.set(account);yes(j.stageFresh(sources(renamed),guard,q,now+6)==1);yes(q.all().size()==1);
  }
  try(LifelogRevisionJournal j=new LifelogRevisionJournal(root,c,account.binding);MaterialOutbox q=new MaterialOutbox(root,c)){
   yes(j.replay(guard,q)==2&&q.all().size()==2);yes(initialPayload.equals(WireJson.map(q.all().get(0)).get("payload")));yes(j.stageFresh(sources(renamed),guard,q,now+7)==0);
   Map<String,Object> second=WireJson.map(q.all().get(1)),event=WireJson.map(WireJson.read(((String)second.get("payload")).getBytes(java.nio.charset.StandardCharsets.UTF_8))),body=WireJson.map(event.get("body"));yes(body.get("revision").equals(2L)&&body.get("base_revision").equals(1L)&&body.get("text_revision").equals(2L));
   // A server receipt lost after commit is looked up, never counted as absent.
   server.drop=true;try{api.pump(q,now+8);throw new AssertionError("expected transport loss");}catch(IOException lost){yes("SYNTHETIC_LOST_ACK".equals(lost.getMessage()));}
   yes(server.posts==2);yes(j.stageFresh(sources(renamed),guard,q,now+9)==0);
  }
  try(LifelogRevisionJournal j=new LifelogRevisionJournal(root,c,account.binding);MaterialOutbox q=new MaterialOutbox(root,c)){
   j.replay(guard,q);yes(api.pump(q,now+60000));yes(server.lookups==1&&server.posts==2);yes(j.stageFresh(sources(renamed),guard,q,now+60001)==0);
   yes(j.stageFresh(Collections.emptyList(),guard,q,now+60002)==0&&q.all().size()==2); // absence is not deletion
   reject("LIFELOG_FRESH_SOURCE_CONFLICT",()->j.stageFresh(Arrays.asList(OfficialLifelogSnapshotTest.read(original),OfficialLifelogSnapshotTest.read(renamed)),guard,q,now+60003));yes(q.all().size()==2);
   // Changes in an unmapped official speaker type must not create a product
   // revision when label/cluster identity and all product fields are unchanged.
   Map<String,Object> typeOnly=WireJson.map(WireJson.copy(renamed));for(Object clip:WireJson.list(OfficialLifelogSnapshotTest.source(typeOnly).get("clips")))WireJson.map(clip).put("speakerType","NEW_HOST_INTERNAL_TYPE");yes(j.stageFresh(sources(typeOnly),guard,q,now+60004)==0);
   Map<String,Object> corrected=WireJson.map(WireJson.copy(renamed));OfficialLifelogSnapshotTest.firstClip(corrected).put("content","合成正文修订三。");yes(j.stageFresh(sources(corrected),guard,q,now+60005)==1);j.replay(guard,q);yes(api.pump(q,now+60006));yes(server.posts==3);yes(j.stageFresh(sources(corrected),guard,q,now+60007)==0);
  }
  // Binding/partial-file errors cannot overwrite durable history or bootstrap
  // a conflicting row. Files here are isolated synthetic fixtures only.
  File state=new File(root,"lifelog-revisions/"+c.binding()+"/"+account.binding+"/state.json");byte[] saved=Files.readAllBytes(state.toPath());Files.write(new File(state.getPath()+".partial").toPath(),new byte[]{123});reject("LIFELOG_REVISION_UNCERTAIN",()->{try(LifelogRevisionJournal ignored=new LifelogRevisionJournal(root,c,account.binding)) {}});yes(Arrays.equals(saved,Files.readAllBytes(state.toPath())));Files.delete(new File(state.getPath()+".partial").toPath());
  try(LifelogRevisionJournal empty=new LifelogRevisionJournal(root,c,other.binding);MaterialOutbox q=new MaterialOutbox(new File(root,"other"),c)){current.set(other);yes(empty.replay(guard,q)==0&&q.all().isEmpty());}
  // Formerly skipped >256KiB sources now retain one exact material revision for transfer.
  File big=new File(root,"oversized");current.set(account);String bigSource="fedcba9876543210fedcba9876543210";
  try(LifelogRevisionJournal j=new LifelogRevisionJournal(big,c,account.binding);MaterialOutbox q=new MaterialOutbox(big,c)){
   OfficialLifelogSnapshot.Source normal=OfficialLifelogSnapshotTest.read(original),huge=OfficialLifelogSnapshotTest.read(oversized(bigSource));
   Set<String> skipped=new TreeSet<>();yes(j.stageFresh(Arrays.asList(huge,normal),guard,q,now,skipped)==2&&skipped.isEmpty());
   yes(j.replay(guard,q)==2&&q.all().size()==2);
   yes(j.stageFresh(Arrays.asList(huge,normal),guard,q,now+1,skipped)==0&&skipped.isEmpty());
   MaterialSyncSessionTest.MemoryServer bigServer=new MaterialSyncSessionTest.MemoryServer(c);MaterialApi bigApi=new MaterialApi(c,bigServer);
   yes(bigApi.pump(q,now+2,Collections.singleton(normal.materialId(account.binding)))&&bigServer.posts==1);
   reject("MATERIAL_TRANSFER_UNSUPPORTED",()->bigApi.pump(q,now+3,Collections.singleton(huge.materialId(account.binding))));yes(bigServer.posts==1);
   Map<String,Object> grown=oversized(OfficialLifelogSnapshotTest.SOURCE);
   yes(j.stageFresh(sources(grown),guard,q,now+4,skipped)==1&&skipped.isEmpty());yes(j.replay(guard,q)==3);
  }
  reject("MATERIAL_EVENT_BUDGET",()->MaterialWire.event(new byte[MaterialWire.MAX_EVENT_BYTES+1],c.producer));
  System.out.println("Lifelog revision journal: "+checks+" assertions passed");
 }
}
