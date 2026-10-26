package com.turboio.addon;
import java.io.*;import java.nio.charset.StandardCharsets;import java.nio.file.*;import java.util.*;

/** Large evolving source; real journals/outbox/filesystem, synthetic receipts. */
public final class MaterialHistoryTest {
 static int checks;static void yes(boolean ok){checks++;if(!ok)throw new AssertionError("Material history "+checks);}
 static Map<String,Object> source(int revision){Map<String,Object> value=OfficialLifelogSnapshotTest.fixture();List<Object> clips=new ArrayList<>();String text=String.join("",Collections.nCopies(300,"合成超长正文。"));for(int i=0;i<96;i++)clips.add(OfficialLifelogSnapshotTest.clip("large-"+i,i*50,i*50+30,text));OfficialLifelogSnapshotTest.source(value).put("clips",clips);OfficialLifelogSnapshotTest.firstClip(value).put("content","修订"+revision+String.join("",Collections.nCopies(300,"合成超长正文。")));return value;}
 public static void main(String[] args)throws Exception{
  File root=new File(args[0]);long now=System.currentTimeMillis();MaterialConnection c=LifelogImportJournalTest.connection(now);OfficialAccountBinding account=LifelogImportJournalTest.account(81);String initial=null;long maximum=0;
  MaterialSyncSessionTest.MemoryServer server=new MaterialSyncSessionTest.MemoryServer(c);
  for(int revision=1;revision<=12;revision++){
   try(MaterialOutbox q=new MaterialOutbox(root,c);LifelogRevisionJournal journal=new LifelogRevisionJournal(root,c,account.binding)){
    journal.replay(()->account,q);q.compact();journal.compact(()->account,q);
    OfficialLifelogSnapshot.Source current=OfficialLifelogSnapshotTest.read(source(revision));
    yes(journal.stageFresh(Collections.singletonList(current),()->account,q,now+revision)==1);journal.replay(()->account,q);
    List<Object> rows=q.all();Map<String,Object> row=WireJson.map(rows.get(rows.size()-1));if(revision==1)initial=(String)row.get("payload");
    yes(rows.size()<=2);yes(q.compact()==0); // Current pending revision and its stored base both survive.
    yes(journal.ownsInitial(current.materialId(account.binding)));
    MaterialOutbox.Claim claim=q.claim(now+revision,Collections.singleton("1.2"));yes(claim!=null&&claim.action.equals("send"));
    MaterialApi.Response response=server.exchange("/material-events",claim.payload.getBytes(StandardCharsets.UTF_8));yes(q.finish(claim,response.status,response.body,now+revision,0));
    yes(q.compact()==(revision==1?0:1));yes(q.all().size()==1);
    // Simulate a kill here: old journal is not yet compacted, new outbox is durable.
   }
   try(MaterialOutbox q=new MaterialOutbox(root,c);LifelogRevisionJournal journal=new LifelogRevisionJournal(root,c,account.binding)){
    journal.replay(()->account,q);yes(q.all().size()==1);yes(journal.compact(()->account,q)==(revision==1?0:1));
    q.enqueue(initial.getBytes(StandardCharsets.UTF_8));yes(q.all().size()==1); // Legacy bootstrap replay is harmless.
    yes(q.claim(now+revision+1,Collections.singleton("1.2"))==null);
    Map<String,Object> row=WireJson.map(q.all().get(0));yes(MaterialWire.positive(row.get("revision"))==revision);
    yes(journal.stageFresh(Collections.singletonList(OfficialLifelogSnapshotTest.read(source(revision))),()->account,q,now+revision+1)==0);
    MaterialCatalog catalog=MaterialCatalog.fromRows(account.binding,c.producer,q.all(),java.time.ZoneId.of("Asia/Shanghai"));yes(catalog.entries.size()==1&&catalog.entries.get(0).fullText.startsWith("修订"+revision));
    Map<String,Object> wrong=WireJson.map(MaterialWire.read(initial.getBytes(StandardCharsets.UTF_8)));WireJson.map(WireJson.map(wrong.get("body")).get("full_text")).put("text","changed");
    try{q.enqueue(WireJson.bytes(wrong));throw new AssertionError("conflicting replay accepted");}catch(IllegalArgumentException expected){yes(expected.getMessage().equals("MATERIAL_LOCAL_REVISION_CONFLICT"));}
   }
   long total=0;try(java.util.stream.Stream<Path> files=Files.walk(root.toPath())){for(Path p:(Iterable<Path>)files::iterator)if(Files.isRegularFile(p))total+=Files.size(p);}maximum=Math.max(maximum,total);
  }
  yes(maximum<5*1048576L); // Twelve >1MiB revisions no longer fill the old 4MiB ledger.
  File state=new File(root,"material-outbox/"+c.binding()+"/state.json");Map<String,Object> saved=WireJson.map(WireJson.read(Files.readAllBytes(state.toPath()),33554432,2000000));
  yes(WireJson.list(saved.get("retired")).size()==11&&WireJson.list(saved.get("rows")).size()==1);
  Map<String,Object> receipt=WireJson.map(WireJson.map(WireJson.list(saved.get("retired")).get(0)).get("ack"));receipt.put("revision",99);Files.write(state.toPath(),WireJson.bytes(saved));
  try(MaterialOutbox ignored=new MaterialOutbox(root,c)){throw new AssertionError("corrupt receipt accepted");}catch(IllegalArgumentException expected){yes(expected.getMessage().equals("MATERIAL_ACK_MISMATCH"));}
  System.out.println("Material history: "+checks+" assertions passed; bounded payloads, restart replay and receipts");
 }
}
