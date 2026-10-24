package com.turboio.addon;
import java.io.*;import java.nio.file.*;import java.nio.charset.StandardCharsets;import java.util.*;

/** Real filesystem migration and independent old-version readers; synthetic data. */
public final class MaterialStorageTest {
 static int checks;static void yes(boolean good){checks++;if(!good)throw new AssertionError("Material storage "+checks);}interface Work{void run()throws Exception;}
 static void reject(String code,Work work)throws Exception{checks++;try{work.run();}catch(IOException|IllegalArgumentException expected){if(code==null||code.equals(expected.getMessage()))return;throw expected;}throw new AssertionError("Expected "+code);}
 static Map<String,Object> read(File file)throws Exception{return WireJson.map(WireJson.read(Files.readAllBytes(file.toPath()),33554432,2000000));}
 static void write(File file,Object value)throws Exception{Files.createDirectories(file.getParentFile().toPath());Files.write(file.toPath(),WireJson.bytes(value));}
 static File queue(File root,MaterialConfig c){return new File(root,"material-outbox/"+c.connection.binding()+"/state.json");}
 static void seed(File root,MaterialConfig c,OfficialAccountBinding account,long now)throws Exception{
  File old=MaterialStorage.legacy(root,c);
  try(MaterialOutbox q=new MaterialOutbox(old,c.connection);LifelogRevisionJournal j=new LifelogRevisionJournal(old,c.connection,c.account)){
   j.stageFresh(Collections.singletonList(OfficialLifelogSnapshotTest.read(OfficialLifelogSnapshotTest.fixture())),()->account,q,now);j.replay(()->account,q);yes(q.claim(now,Collections.singleton("1.2"))!=null);
  }
  Map<String,Object> out=read(queue(old,c));out.put("schema",3);out.remove("retired");for(Object raw:WireJson.list(out.get("rows"))){Map<String,Object> row=WireJson.map(raw);row.remove("cancellation");row.remove("superseded");}write(queue(old,c),out);
  File journal=new File(old,"lifelog-revisions/"+c.connection.binding()+"/"+c.account+"/state.json");Map<String,Object> j=read(journal);j.put("schema",1);j.remove("initials");write(journal,j);
  write(new File(old,"lifelog-import/"+c.connection.binding()+"/"+c.account+"/state.json"),WireJson.object("schema",1,"connection",c.connection.binding(),"account",c.account,"rows",WireJson.object()));
  Files.write(new File(root,"legacy-config.json").toPath(),MaterialSettingsState.legacy(c));
 }
 static void acknowledge(MaterialOutbox q,MaterialConnection c,long now)throws Exception{
  MaterialOutbox.Claim claim=q.claim(now,Collections.singleton("1.2"));yes(claim!=null);Map<String,Object> e=MaterialWire.event(claim.payload.getBytes(StandardCharsets.UTF_8),c.producer),b=WireJson.map(e.get("body"));
  Map<String,Object> receipt=WireJson.object("receipt_id","synthetic-storage-receipt-"+b.get("revision"),"subject_kind","material","subject_id",b.get("material_id"),"subject_revision",b.get("revision"),"stage","server_stored","actor_id","server-storage","related_event_id",e.get("event_id"),"error",null);
  yes(q.finish(claim,200,WireJson.bytes(WireJson.object("schema_version","1.2","event_id",e.get("event_id"),"material_id",b.get("material_id"),"revision",b.get("revision"),"commit_seq",b.get("revision"),"stored_at",TaskWire.now(now),"receipt",receipt)),now,0));
 }
 static void oldJvm(String classes,File root,String mode)throws Exception{
  Process child=new ProcessBuilder(new File(System.getProperty("java.home"),"bin/java").getPath(),"-cp",classes,"com.turboio.addon.MaterialStorageRollbackProbe",root.getAbsolutePath(),mode).inheritIO().start();yes(child.waitFor()==0);
 }
 public static void main(String[] args)throws Exception{
  File root=new File(args[0]);long now=System.currentTimeMillis();OfficialAccountBinding account=LifelogImportJournalTest.account(81);MaterialConfig c=new MaterialConfig(LifelogImportJournalTest.connection(now),account.binding,true);seed(root,c,account,now);
  byte[] oldBytes=Files.readAllBytes(queue(MaterialStorage.legacy(root,c),c).toPath()),state=MaterialSettingsState.encode(c),projection=MaterialSettingsState.legacy(c);
  yes(MaterialSettingsState.decode(state,projection).enabled&&!MaterialConfig.decode(projection).enabled);
  reject("MATERIAL_LEGACY_CONFIG_CHANGED",()->MaterialSettingsState.decode(state,c.encode()));reject("MATERIAL_LEGACY_CONFIG_CHANGED",()->MaterialSettingsState.decode(state,null));
  MaterialConfig other=new MaterialConfig(c.connection,LifelogImportJournalTest.account(82).binding,false);reject("MATERIAL_LEGACY_CONFIG_CHANGED",()->MaterialSettingsState.decode(state,other.encode()));
  Map<String,Object> corrupt=WireJson.map(WireJson.read(state));corrupt.put("legacy_sha256","0");reject("MATERIAL_LEGACY_CONFIG_CHANGED",()->MaterialSettingsState.decode(WireJson.bytes(corrupt),projection));
  File current=MaterialStorage.prepare(root,c);yes(Arrays.equals(oldBytes,Files.readAllBytes(queue(MaterialStorage.legacy(root,c),c).toPath())));yes(!current.equals(MaterialStorage.legacy(root,c)));
  OfficialLifelogSnapshot.Source large=OfficialLifelogSnapshotTest.read(MaterialHistoryTest.source(2));
  try(MaterialLocalLibrary library=new MaterialLocalLibrary(root,c.account)){yes(library.recordRead("2026-10-24","UTC",Collections.singletonList(large),now,()->c.account)==1);}
  try(MaterialOutbox q=new MaterialOutbox(current,c.connection);LifelogRevisionJournal j=new LifelogRevisionJournal(current,c.connection,c.account)){
   yes("reconcile".equals(WireJson.map(q.all().get(0)).get("state")));acknowledge(q,c.connection,now+1);j.replay(()->account,q);
   yes(j.stageFresh(Collections.singletonList(large),()->account,q,now+2)==1);j.replay(()->account,q);acknowledge(q,c.connection,now+3);yes(q.compact()==1&&j.compact(()->account,q)==1);
   yes(((String)WireJson.map(q.all().get(0)).get("payload")).getBytes(StandardCharsets.UTF_8).length>1048576);
  }
  byte[] newBytes=Files.readAllBytes(queue(current,c).toPath());oldJvm(args[1],root,"observe");
  yes(Arrays.equals(newBytes,Files.readAllBytes(queue(current,c).toPath())));yes(MaterialStorage.prepare(root,c).equals(current));
  try(MaterialOutbox q=new MaterialOutbox(current,c.connection);LifelogRevisionJournal j=new LifelogRevisionJournal(current,c.connection,c.account)){
   yes(q.retiredCount()==1&&q.all().size()==1);yes(j.replay(()->account,q)==1);yes(j.stageFresh(Collections.singletonList(large),()->account,q,now+4)==0);
  }
  File currentQueue=queue(current,c),savedQueue=new File(current,"synthetic-preserved-state.json");Files.move(currentQueue.toPath(),savedQueue.toPath());reject("MATERIAL_MIGRATION_MISSING",()->MaterialStorage.prepare(root,c));Files.createSymbolicLink(currentQueue.toPath(),savedQueue.toPath());reject("MATERIAL_MIGRATION_PATH",()->MaterialStorage.prepare(root,c));Files.delete(currentQueue.toPath());Files.move(savedQueue.toPath(),currentQueue.toPath());yes(Arrays.equals(newBytes,Files.readAllBytes(currentQueue.toPath())));
  oldJvm(args[1],root,"mutate");byte[] changedOld=Files.readAllBytes(queue(MaterialStorage.legacy(root,c),c).toPath());reject("MATERIAL_LEGACY_CHANGED",()->MaterialStorage.prepare(root,c));yes(Arrays.equals(newBytes,Files.readAllBytes(queue(current,c).toPath()))&&Arrays.equals(changedOld,Files.readAllBytes(queue(MaterialStorage.legacy(root,c),c).toPath())));
  // Cause a real filesystem failure after the first file copied; restart resumes.
  File interrupted=new File(root,"interrupted");seed(interrupted,c,account,now);File obstacle=new File(MaterialStorage.current(interrupted,c),"lifelog-import/"+c.connection.binding());Files.createDirectories(obstacle.getParentFile().toPath());Files.write(obstacle.toPath(),new byte[]{1});reject(null,()->MaterialStorage.prepare(interrupted,c));yes(queue(MaterialStorage.current(interrupted,c),c).isFile());Files.delete(obstacle.toPath());yes(MaterialStorage.prepare(interrupted,c).equals(MaterialStorage.current(interrupted,c)));
  try(MaterialOutbox q=new MaterialOutbox(MaterialStorage.current(interrupted,c),c.connection)){yes(q.all().size()==1);}
  // Unowned output, incomplete legacy writes and path aliases never overwrite data.
  File unowned=new File(root,"unowned");write(queue(MaterialStorage.current(unowned,c),c),WireJson.object("preserve",true));reject("MATERIAL_MIGRATION_UNOWNED",()->MaterialStorage.prepare(unowned,c));yes(read(queue(MaterialStorage.current(unowned,c),c)).get("preserve").equals(true));
  File partial=new File(root,"partial");seed(partial,c,account,now);File unfinished=new File(queue(MaterialStorage.legacy(partial,c),c).getPath()+".partial");Files.write(unfinished.toPath(),new byte[]{123});reject("MATERIAL_LEGACY_UNCERTAIN",()->MaterialStorage.prepare(partial,c));yes(Files.readAllBytes(unfinished.toPath())[0]==123);
  File linked=new File(root,"linked");Files.createDirectories(linked.toPath());Files.createSymbolicLink(new File(linked,"material-accounts-v2").toPath(),MaterialStorage.current(root,c).toPath());reject("MATERIAL_MIGRATION_PATH",()->MaterialStorage.prepare(linked,c));yes(Arrays.equals(newBytes,Files.readAllBytes(queue(current,c).toPath())));
  // A fresh connection has an independent namespace even under the same account.
  Map<String,Object> connection=WireJson.map(WireJson.read(c.connection.encode()));connection.put("server_id","another-synthetic-server");MaterialConfig independent=new MaterialConfig(MaterialConnection.parse(WireJson.bytes(connection),now),c.account,true);File fresh=MaterialStorage.prepare(root,independent);try(MaterialOutbox q=new MaterialOutbox(fresh,independent.connection)){yes(q.all().isEmpty());}
  System.out.println("Material storage: "+checks+" assertions passed; real dev72 readers, new long data, interruption recovery, rollback changes and isolation");
 }
}
