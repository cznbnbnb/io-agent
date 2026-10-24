package com.turboio.addon;
import java.io.*;import java.nio.file.*;import java.util.*;

/** Production source mapper, journal, outbox and sender across real JVM restarts. */
public final class MaterialTransferHttpTest {
 static void yes(boolean value){if(!value)throw new AssertionError("Large material transfer");}
 static Map<String,Object> source(boolean revised){
  Map<String,Object> f=OfficialLifelogSnapshotTest.fixture();List<Object> clips=new ArrayList<>();String text=String.join("",Collections.nCopies(300,"合成超长正文。"));
  for(int i=0;i<96;i++)clips.add(OfficialLifelogSnapshotTest.clip("large-"+i,i*50,i*50+30,text+(revised&&i==0?"修订":"")));
  OfficialLifelogSnapshotTest.source(f).put("clips",clips);return f;
 }
 public static void main(String[] args)throws Exception{
  File root=new File(args[0]);Map<String,Object> fixture=WireJson.map(WireJson.read(Files.readAllBytes(Paths.get(args[1]))));String mode=args[2];long now=System.currentTimeMillis();
  MaterialConnection c=MaterialConnection.parse(WireJson.bytes(fixture.get("connection")),now);MaterialTest.connection=c;OfficialAccountBinding account=LifelogImportJournalTest.account(46);
  MaterialTest.Loopback http=new MaterialTest.Loopback((String)fixture.get("endpoint"),false);boolean[] dropped={false};int[] parts={0};
  MaterialApi.Transport transport=new MaterialApi.Transport(){public MaterialApi.Response exchange(String path,byte[] data)throws IOException{
   if(data!=null)yes(data.length<=262144);MaterialApi.Response response=http.exchange(path,data);
   if(path.contains("/parts/"))parts[0]++;
   if(!dropped[0]&&(mode.equals("part-lost")&&path.endsWith("/parts/0")&&response.status==200||mode.equals("finalize-lost")&&path.endsWith("/finalize")&&response.status==201)){dropped[0]=true;throw new IOException("SYNTHETIC_LOST_REPLY");}return response;
  }public void cancel(){http.cancel();}};
  try(MaterialOutbox q=new MaterialOutbox(root,c);LifelogRevisionJournal journal=new LifelogRevisionJournal(root,c,account.binding)){
   OfficialLifelogSnapshot.Source original=OfficialLifelogSnapshotTest.read(source(false));Set<String> skipped=new HashSet<>();
   int added=journal.stageFresh(Collections.singletonList(original),()->account,q,now,skipped);yes(skipped.isEmpty());journal.replay(()->account,q);yes(q.all().size()==1);
   Map<String,Object> row=WireJson.map(q.all().get(0));yes(((String)row.get("payload")).getBytes(java.nio.charset.StandardCharsets.UTF_8).length>1048576);
   MaterialApi api=new MaterialApi(c,transport);
   if(mode.equals("part-lost")){yes(added==1);try{api.pump(q,now);throw new AssertionError("Expected lost part reply");}catch(IOException expected){yes(expected.getMessage().equals("SYNTHETIC_LOST_REPLY"));}yes(dropped[0]&&parts[0]==1);}
   else if(mode.equals("finalize-lost")){yes(added==0);yes(api.pump(q,now+60000));try{api.pump(q,now+60001);throw new AssertionError("Expected lost finalize reply");}catch(IOException expected){yes(expected.getMessage().equals("SYNTHETIC_LOST_REPLY"));}yes(dropped[0]);}
   else if(mode.equals("reconcile")){
    yes(added==0);yes(api.pump(q,now+120000));yes("server_stored".equals(WireJson.map(q.all().get(0)).get("state"))&&parts[0]==0);
    MaterialCatalog catalog=MaterialCatalog.fromRows(account.binding,c.producer,q.all(),java.time.ZoneId.of("Asia/Shanghai"));yes(catalog.entries.size()==1);
    OfficialLifelogSnapshot.Source revised=OfficialLifelogSnapshotTest.read(source(true));yes(journal.stageFresh(Collections.singletonList(revised),()->account,q,now+120001)==1);journal.replay(()->account,q);yes(api.pump(q,now+120002));yes("server_stored".equals(WireJson.map(q.all().get(1)).get("state")));
    Files.write(new File(root,"result.json").toPath(),WireJson.bytes(WireJson.object("material_id",original.materialId(account.binding),"versions",q.all().size(),"full_text_sha256",TaskWire.hash(WireJson.bytes(WireJson.map(MaterialWire.read(revised.materialBody(account.binding,2))).get("full_text"))))));
   }else throw new IllegalArgumentException("FIXTURE_MODE_INVALID");
  }
  System.out.println("Large material "+mode+": passed; source/journal/outbox/API over real HTTP");
 }
}
