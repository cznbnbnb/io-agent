package com.turboio.addon;
import java.io.*;import java.nio.file.*;import java.util.*;

/** Production discovery + import + queue over the real loopback service. */
public final class MaterialImportHttpTest {
 public static void main(String[] args)throws Exception{
  File root=new File(args[0]),flutter=new File(root,"app_flutter"),logs=new File(flutter,"appLog");logs.mkdirs();Map<String,Object> fixture=WireJson.map(WireJson.read(Files.readAllBytes(Paths.get(args[1]))));MaterialConnection connection=MaterialConnection.parse(WireJson.bytes(fixture.get("connection")),System.currentTimeMillis());OfficialAccountBinding account=LifelogImportJournalTest.account(42);
  Files.write(account.cacheFile(flutter).toPath(),OfficialHiveCacheTest.frame(OfficialHiveCacheTest.URL,OfficialHiveCacheTest.cached(true),false));Files.write(new File(logs,"synthetic.log").toPath(),LifelogImportJournalTest.bytes(LifelogImportJournalTest.log(OfficialLifelogSnapshotTest.fixture())));
  MaterialSyncSession.Source source=new MaterialSyncSession.Source(){public OfficialAccountBinding current(){return account;}public OfficialLifelogBatch read()throws Exception{return OfficialLifelogBatch.read(flutter,this::current);}};
  MaterialTest.connection=connection;
  MaterialSyncSession.Status status=new MaterialSyncSession(root,new MaterialConfig(connection,account.binding,true),source,()->{},new MaterialTest.Loopback((String)fixture.get("endpoint"),false)).sync();if(status.stored!=1||status.queued!=0||status.blocked!=0)throw new AssertionError("Imported body not stored");
  String material=OfficialLifelogSnapshotTest.read(OfficialLifelogSnapshotTest.fixture()).materialId(account.binding);Files.write(new File(root,"result.json").toPath(),WireJson.bytes(WireJson.object("material_id",material,"stored",status.stored,"added",status.added)));
  System.out.println("Material source-to-server import passed; added="+status.added);
 }
}
