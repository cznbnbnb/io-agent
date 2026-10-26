package com.turboio.addon;

import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.time.*;
import java.util.*;

/** Synthetic local library + queue view only. Never opens Android/user data. */
public final class MaterialLocalLibraryTest {
 private static int checks;private static final String ACCOUNT="a".repeat(64),OTHER="b".repeat(64),DATE="2026-10-23",ZONE="Asia/Shanghai";
 private static final long START=Instant.parse("2026-10-22T15:30:00Z").toEpochMilli(),NOW=Instant.parse("2026-10-23T03:00:00Z").toEpochMilli();
 private static void yes(boolean value){checks++;if(!value)throw new AssertionError("Local library check "+checks);}
 private interface Action {void run()throws Exception;}
 private static void rejects(Action action)throws Exception{boolean failed=false;try{action.run();}catch(IllegalArgumentException|IOException expected){failed=true;}yes(failed);}
 private static OfficialLifelogSnapshot.Source source(String id,String title,String speaker,String...texts){List<Object> clips=new ArrayList<>();for(int i=0;i<texts.length;i++)clips.add(WireJson.object("clipId","clip-"+i,"content",texts[i],"startTime",Long.toString(START+i*3600000L),"endTime",Long.toString(START+(i+1)*3600000L),"speakerType","anonymous","speakerName",speaker));return OfficialLifelogSnapshot.original(WireJson.bytes(WireJson.object("sourceId",id,"sourceType","lifelog","title",title,"startTime",Long.toString(START),"endTime",Long.toString(START+texts.length*3600000L),"clips",clips,"preservedMetadata","synthetic-original")));}
 private static Map<String,Object> row(OfficialLifelogSnapshot.Source source,long revision,String state,long created,boolean deleted){Map<String,Object> body=WireJson.map(WireJson.read(source.materialBody(ACCOUNT,revision),8388608,500000));if(deleted){body.put("operation","delete");body.put("utterances",new ArrayList<>());body.put("speakers",new ArrayList<>());WireJson.map(body.get("full_text")).put("text","");}String eventId="synthetic-local-"+revision;Map<String,Object> event=WireJson.object("schema_version","1.2","event_id",eventId,"idempotency_key",eventId,"kind","material.revision","producer_id","phone-test","created_at",TaskWire.now(created),"expires_at","2030-01-01T00:00:00Z","body",body);String payload=new String(WireJson.bytes(event),StandardCharsets.UTF_8);Map<String,Object> row=WireJson.object("payload",payload,"payload_sha256",TaskWire.hash(payload.getBytes(StandardCharsets.UTF_8)),"material_id",body.get("material_id"),"revision",revision,"state",state,"error","","ack",null);
  if(state.equals("server_stored"))row.put("ack",WireJson.object("schema_version","1.2","event_id",eventId,"material_id",body.get("material_id"),"revision",revision,"commit_seq",1,"stored_at",TaskWire.now(created+1),"receipt",WireJson.object("receipt_id","synthetic-local-receipt","subject_kind","material","subject_id",body.get("material_id"),"subject_revision",revision,"stage","server_stored","actor_id","server-storage","related_event_id",eventId,"error",null)));return row;
 }
 private static MaterialCatalog merge(MaterialLocalLibrary.Snapshot local,Object...rows){MaterialCatalog uploaded=rows.length==0?MaterialCatalog.empty(ACCOUNT,ZoneId.of(ZONE)):MaterialCatalog.fromRows(ACCOUNT,"phone-test",Arrays.asList(rows),ZoneId.of(ZONE));return MaterialCatalog.merge(uploaded,local);}
 public static void main(String[] args)throws Exception{
  Path root=Files.createTempDirectory("io-material-local-test-");try{
   OfficialLifelogSnapshot.Source first=source("first","真正的原厂标题","说话人甲","第一段原文"),grown=source("first","真正的原厂标题","说话人甲","第一段原文","全天智记新增的第二段");
   MaterialLocalLibrary.Snapshot snapshot;
   try(MaterialLocalLibrary library=new MaterialLocalLibrary(root.toFile(),ACCOUNT)){
    yes(library.snapshot().records.isEmpty()&&library.snapshot().day(DATE,ZONE)==null);
    yes(library.recordRead(DATE,ZONE,Arrays.asList(first),NOW,()->ACCOUNT)==1);snapshot=library.snapshot();yes(snapshot.day(DATE,ZONE).sourceCount==1&&snapshot.day(DATE,ZONE).readAt==NOW);yes(snapshot.records.get(0).revision==1&&Arrays.equals(snapshot.records.get(0).source.original(),first.original()));
    MaterialCatalog catalog=merge(snapshot);yes(catalog.localOnly==1&&catalog.pending==0&&catalog.stored==0);yes(catalog.entries.get(0).title.equals(first.title)&&catalog.entries.get(0).state.equals("local_only"));yes(catalog.on(LocalDate.parse(DATE)).size()==1&&catalog.dates.contains(LocalDate.parse(DATE)));yes(catalog.entries.get(0).day.equals(LocalDate.of(2026,10,22)));yes(catalog.on(LocalDate.of(2026,10,24)).isEmpty());
    yes(library.recordRead(DATE,ZONE,Arrays.asList(first),NOW+1,()->ACCOUNT)==0&&library.snapshot().records.get(0).revision==1);
    yes(library.recordRead(DATE,ZONE,Arrays.asList(grown),NOW+2,()->ACCOUNT)==1);snapshot=library.snapshot();yes(snapshot.records.size()==1&&snapshot.records.get(0).revision==2&&snapshot.records.get(0).id.equals(first.materialId(ACCOUNT)));yes(merge(snapshot).entries.get(0).fullText.contains("第二段"));
    byte[] expanded=Files.readAllBytes(root.resolve("material-accounts/"+ACCOUNT+"/local-library/state.json"));rejects(()->library.recordRead(DATE,ZONE,Arrays.asList(first),NOW+3,()->ACCOUNT));yes(Arrays.equals(expanded,Files.readAllBytes(root.resolve("material-accounts/"+ACCOUNT+"/local-library/state.json"))));
    MaterialCatalog same=merge(snapshot,row(grown,17,"server_stored",NOW-100,false));yes(same.stored==1&&same.localOnly==0&&same.entries.get(0).revision==17&&same.entries.get(0).title.equals(first.title));
    MaterialCatalog updated=merge(snapshot,row(first,1,"server_stored",NOW-100,false));yes(updated.stored==0&&updated.localOnly==1&&updated.pending==0&&updated.entries.get(0).state.equals("local_updated")&&updated.entries.get(0).fullText.contains("第二段"));
    yes(merge(snapshot,row(grown,17,"queued",NOW-100,false)).pending==1);yes(merge(snapshot,row(grown,18,"queued",NOW-100,true)).entries.isEmpty());
    OfficialLifelogSnapshot.Source speakerChanged=source("first",first.title,"说话人乙","第一段原文","全天智记新增的第二段");library.recordRead(DATE,ZONE,Arrays.asList(speakerChanged),NOW+3,()->ACCOUNT);yes(merge(library.snapshot(),row(grown,17,"server_stored",NOW-100,false)).localOnly==1);
    MaterialCatalog renewedOld=merge(library.snapshot(),row(first,1,"server_stored",NOW+100,false));yes(renewedOld.stored==0&&renewedOld.localOnly==1&&renewedOld.entries.get(0).fullText.contains("第二段")&&renewedOld.entries.get(0).segments.get(0).speaker.equals("说话人乙"));
    MaterialCatalog repairedOld=merge(library.snapshot(),row(grown,17,"server_stored",NOW+100,false));yes(repairedOld.stored==0&&repairedOld.localOnly==1&&repairedOld.entries.get(0).segments.get(0).speaker.equals("说话人乙"));
    library.recordRead(DATE,ZONE,Collections.emptyList(),NOW+4,()->ACCOUNT);yes(library.snapshot().records.size()==1&&library.snapshot().day(DATE,ZONE).sourceCount==0&&merge(library.snapshot()).on(LocalDate.parse(DATE)).size()==1);
    byte[] before=Files.readAllBytes(root.resolve("material-accounts/"+ACCOUNT+"/local-library/state.json"));rejects(()->library.recordRead(DATE,ZONE,Arrays.asList(first),NOW+5,()->OTHER));final int[] visits={0};rejects(()->library.recordRead(DATE,ZONE,Arrays.asList(first),NOW+5,()->++visits[0]==1?ACCOUNT:OTHER));yes(Arrays.equals(before,Files.readAllBytes(root.resolve("material-accounts/"+ACCOUNT+"/local-library/state.json"))));
    rejects(()->library.recordRead(DATE,ZONE,Arrays.asList(first,first),NOW+5,()->ACCOUNT));rejects(()->library.recordRead("2026-02-31",ZONE,Arrays.asList(first),NOW+5,()->ACCOUNT));rejects(()->MaterialCatalog.merge(MaterialCatalog.empty(OTHER,ZoneId.of(ZONE)),library.snapshot()));snapshot=library.snapshot();
   }
   Path committed=root.resolve("material-accounts/"+ACCOUNT+"/local-library/state.json");Files.writeString(Path.of(committed+".partial"),"incomplete-new-write");try(MaterialLocalLibrary reopened=new MaterialLocalLibrary(root.toFile(),ACCOUNT)){yes(reopened.snapshot().records.size()==1&&reopened.snapshot().records.get(0).revision==3&&reopened.snapshot().day(DATE,ZONE).sourceCount==0);}
   try(MaterialLocalLibrary other=new MaterialLocalLibrary(root.toFile(),OTHER)){yes(other.snapshot().records.isEmpty());}
   try(MaterialLocalLibrary library=new MaterialLocalLibrary(root.toFile(),ACCOUNT)){
    String text="长".repeat(20000);OfficialLifelogSnapshot.Source large=source("large","超过上传事件预算的全天正文","说话人",text,text,text,text,text,text);yes(large.original().length>262144);library.recordRead(DATE,ZONE,Arrays.asList(large),NOW+10,()->ACCOUNT);MaterialCatalog catalog=merge(library.snapshot());MaterialCatalog.Entry entry=catalog.entries.stream().filter(e->e.id.equals(large.materialId(ACCOUNT))).findFirst().get();yes(entry.fullText.getBytes(StandardCharsets.UTF_8).length>262144&&entry.segments.size()==6);yes(new String(MaterialDocument.encode(entry,MaterialDocument.Format.TEXT),StandardCharsets.UTF_8).contains(entry.fullText));
    byte[] before=Files.readAllBytes(committed);List<OfficialLifelogSnapshot.Source> tooMany=new ArrayList<>();for(int i=0;i<MaterialLocalLibrary.MAX_RECORDS;i++)tooMany.add(source("extra-"+i,"独立记录","","合成"));rejects(()->library.recordRead(DATE,ZONE,tooMany,NOW+11,()->ACCOUNT));yes(Arrays.equals(before,Files.readAllBytes(committed)));
    List<OfficialLifelogSnapshot.Source> tooLarge=new ArrayList<>();for(int i=0;i<12;i++)tooLarge.add(source("large-"+i,"合成大记录","",text,text,text,text,text,text));rejects(()->library.recordRead(DATE,ZONE,tooLarge,NOW+12,()->ACCOUNT));yes(Arrays.equals(before,Files.readAllBytes(committed)));
   }
   Map<String,Object> corrupted=WireJson.map(WireJson.read(Files.readAllBytes(committed),8388608,500000));WireJson.map(WireJson.list(corrupted.get("records")).get(0)).put("original_sha256","0".repeat(64));Files.write(committed,WireJson.bytes(corrupted));rejects(()->{try(MaterialLocalLibrary ignored=new MaterialLocalLibrary(root.toFile(),ACCOUNT)){} });
   Path symlink=root.resolve("material-accounts/"+"c".repeat(64));Files.createSymbolicLink(symlink,root.resolve("material-accounts/"+ACCOUNT));rejects(()->{try(MaterialLocalLibrary ignored=new MaterialLocalLibrary(root.toFile(),"c".repeat(64))){} });
  }finally{try(java.util.stream.Stream<Path> paths=Files.walk(root)){for(Path path:(Iterable<Path>)paths.sorted(Comparator.reverseOrder())::iterator)Files.delete(path);}}
  System.out.println("Material local library: "+checks+" checks passed");
 }
}
