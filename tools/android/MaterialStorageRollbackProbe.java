package com.turboio.addon;
import java.io.*;import java.nio.file.*;import java.nio.charset.StandardCharsets;import java.util.*;

/** Compiled against the actual committed dev72 readers in a separate JVM. */
public final class MaterialStorageRollbackProbe {
 public static void main(String[] args)throws Exception{
  File root=new File(args[0]);MaterialConfig config=MaterialConfig.decode(Files.readAllBytes(new File(root,"legacy-config.json").toPath()));if(config.enabled)throw new AssertionError("Rollback sync must start paused");
  OfficialAccountBinding account=OfficialAccountBinding.read(WireJson.bytes(WireJson.object("accountId",81L,"domain","synthetic")));if(!config.account.equals(account.binding))throw new AssertionError("Fixture binding");
  File old=new File(root,"material-accounts/"+config.account);
  try(MaterialLocalLibrary library=new MaterialLocalLibrary(root,config.account)){MaterialCatalog catalog=MaterialCatalog.merge(MaterialCatalog.empty(config.account,java.time.ZoneId.of("UTC")),library.snapshot());if(catalog.entries.size()!=1||catalog.entries.get(0).fullText.getBytes(StandardCharsets.UTF_8).length<=262144)throw new AssertionError("Legacy local long text unreadable");}
  try(MaterialOutbox q=new MaterialOutbox(old,config.connection);LifelogRevisionJournal j=new LifelogRevisionJournal(old,config.connection,config.account);LifelogImportJournal bootstrap=new LifelogImportJournal(old,config.connection,config.account)){
   if(q.all().size()!=1||j.replay(()->account,q)!=1||bootstrap.replay(account,q::enqueue)!=0)throw new AssertionError("Legacy content changed");
   if(args[1].equals("mutate")){
    String payload=(String)WireJson.map(q.all().get(0)).get("payload");Map<String,Object> event=WireJson.map(WireJson.read(payload.getBytes(StandardCharsets.UTF_8)));String material=(String)WireJson.map(event.get("body")).get("material_id");
    event=WireJson.map(WireJson.read(new String(WireJson.bytes(event),StandardCharsets.UTF_8).replace(material,material+"-legacy-new").getBytes(StandardCharsets.UTF_8)));event.put("event_id","legacy-explicit-new-record");event.put("idempotency_key","legacy-explicit-new-record");q.enqueue(WireJson.bytes(event));if(q.all().size()!=2)throw new AssertionError("Legacy write fixture failed");
   }
  }
  System.out.println("dev72 readers: paused config, original outbox, journals and long local-library text remain usable");
 }
}
