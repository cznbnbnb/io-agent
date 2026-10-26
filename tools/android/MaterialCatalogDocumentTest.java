package com.turboio.addon;

import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.time.*;
import java.util.*;
import java.util.zip.*;
import javax.xml.parsers.DocumentBuilderFactory;

/** Synthetic retained revisions only; no Android, network or real files. */
public final class MaterialCatalogDocumentTest {
 private static int checks;
 private static void yes(boolean value){checks++;if(!value)throw new AssertionError("Material catalog/document check "+checks);}
 private static Map<String,Object> row(Map<String,Object> event,String state){String payload=new String(WireJson.bytes(event),StandardCharsets.UTF_8);Map<String,Object> body=WireJson.map(event.get("body"));Map<String,Object> row=WireJson.object("payload",payload,"payload_sha256",TaskWire.hash(payload.getBytes(StandardCharsets.UTF_8)),"material_id",body.get("material_id"),"revision",body.get("revision"),"state",state,"error","","ack",null);
  if(state.equals("server_stored"))row.put("ack",WireJson.object("schema_version","1.2","event_id",event.get("event_id"),"material_id",body.get("material_id"),"revision",body.get("revision"),"commit_seq",1,"stored_at","2026-10-13T01:00:00Z","receipt",WireJson.object("receipt_id","synthetic-receipt","subject_kind","material","subject_id",body.get("material_id"),"subject_revision",body.get("revision"),"stage","server_stored","actor_id","server-storage","related_event_id",event.get("event_id"),"error",null)));return row;
 }
 private static MaterialCatalog catalog(List<Object> rows,ZoneId zone){return MaterialCatalog.fromRows("a".repeat(64),"phone-test",rows,zone);}
 public static void main(String[] args)throws Exception{
  Map<String,Object> fixture=WireJson.map(WireJson.read(Files.readAllBytes(Path.of(args[0]))));List<Object> events=WireJson.list(fixture.get("events"));Map<String,Object> first=WireJson.map(WireJson.copy(events.get(0))),last=WireJson.map(WireJson.copy(events.get(3)));
  List<Object> rows=new ArrayList<>();rows.add(row(first,"server_stored"));rows.add(row(last,"queued"));MaterialCatalog catalog=catalog(rows,ZoneId.of("Asia/Shanghai"));yes(catalog.entries.size()==1&&catalog.pending==1&&catalog.stored==0);yes(catalog.lastStoredAt==Instant.parse("2026-10-13T01:00:00Z").toEpochMilli());MaterialCatalog.Entry entry=catalog.entries.get(0);yes(entry.revision==4&&entry.day.equals(LocalDate.of(2026,10,11)));yes(catalog.on(entry.day).size()==1&&catalog.dates.contains(entry.day));yes(entry.segments.size()>0);yes(catalog.on(LocalDate.of(2026,10,12)).isEmpty());
  MaterialCatalog western=catalog(rows,ZoneId.of("America/Los_Angeles"));yes(western.entries.get(0).day.equals(LocalDate.of(2026,10,10)));yes(entry.segments.stream().anyMatch(segment->segment.start==null));
  for(MaterialDocument.Format format:MaterialDocument.Format.values()){
   byte[] bytes=MaterialDocument.encode(entry,format);yes(bytes.length>0);String filename=MaterialDocument.filename(entry,format);yes(filename.matches("iO-[0-9]{8}-[0-9]{4}-[a-f0-9]{8}\\."+format.extension));
   if(format==MaterialDocument.Format.DOCX){Map<String,String> parts=new HashMap<>();try(ZipInputStream zip=new ZipInputStream(new ByteArrayInputStream(bytes))){for(ZipEntry part;(part=zip.getNextEntry())!=null;){String xml=new String(zip.readAllBytes(),StandardCharsets.UTF_8);DocumentBuilderFactory factory=DocumentBuilderFactory.newInstance();factory.setFeature("http://apache.org/xml/features/disallow-doctype-decl",true);factory.newDocumentBuilder().parse(new ByteArrayInputStream(xml.getBytes(StandardCharsets.UTF_8)));parts.put(part.getName(),xml);}}yes(parts.keySet().equals(new HashSet<>(Arrays.asList("[Content_Types].xml","_rels/.rels","word/document.xml"))));yes(parts.get("word/document.xml").contains("转写正文")&&parts.get("word/document.xml").contains("逐段原文"));}
   else{String text=new String(bytes,StandardCharsets.UTF_8);yes(text.contains(entry.fullText)&&text.contains(entry.id)&&text.contains("时间未标定"));}
  }
  Map<String,Object> textEvent=WireJson.map(WireJson.copy(first));Map<String,Object> body=WireJson.map(textEvent.get("body"));WireJson.map(body.get("full_text")).put("text","中文 😀 <标签> & \"引号\"\n下一行");MaterialCatalog.Entry special=catalog(Arrays.asList(row(textEvent,"expired")),ZoneId.of("UTC")).entries.get(0);yes(special.fullText.contains("😀")&&special.state.equals("expired"));try(ZipInputStream zip=new ZipInputStream(new ByteArrayInputStream(MaterialDocument.encode(special,MaterialDocument.Format.DOCX)))){for(ZipEntry part;(part=zip.getNextEntry())!=null;)if(part.getName().equals("word/document.xml")){String xml=new String(zip.readAllBytes(),StandardCharsets.UTF_8);yes(xml.contains("😀")&&xml.contains("&lt;标签&gt; &amp; &quot;引号&quot;"));}}
  Map<String,Object> deletion=WireJson.map(WireJson.copy(last)),deleted=WireJson.map(deletion.get("body"));deleted.put("revision",5);deleted.put("base_revision",4);deleted.put("operation","delete");deleted.put("utterances",new ArrayList<>());deleted.put("speakers",new ArrayList<>());WireJson.map(deleted.get("full_text")).put("text","");deletion.put("event_id","synthetic-deletion");rows.add(row(deletion,"queued"));yes(catalog(rows,ZoneId.of("UTC")).entries.isEmpty());
  Map<String,Object> corrupt=row(first,"queued");corrupt.put("payload_sha256","0".repeat(64));boolean rejected=false;try{catalog(Arrays.asList(corrupt),ZoneId.of("UTC"));}catch(IllegalArgumentException expected){rejected=true;}yes(rejected);
  yes(MaterialCatalog.empty("",ZoneId.of("UTC")).entries.isEmpty());
  Path cache=Files.createTempDirectory("io-material-export-test-");try{
   long now=1800000000000L;MaterialExportCache.Draft draft=MaterialExportCache.prepare(cache.toFile(),"a".repeat(64),entry,MaterialDocument.Format.DOCX,now);
   MaterialExportCache.Draft restored=MaterialExportCache.load(cache.toFile(),draft.id,draft.account,draft.format,draft.title,now+100);yes(Arrays.equals(MaterialDocument.encode(entry,MaterialDocument.Format.DOCX),MaterialExportCache.bytes(cache.toFile(),restored,now+100)));
   boolean wrongOwner=false;try{MaterialExportCache.load(cache.toFile(),draft.id,"b".repeat(64),draft.format,draft.title,now);}catch(IOException expected){wrongOwner=true;}yes(wrongOwner);
   boolean wrongFormat=false;try{MaterialExportCache.load(cache.toFile(),draft.id,draft.account,"TEXT",draft.title,now);}catch(IOException expected){wrongFormat=true;}yes(wrongFormat);
   boolean expired=false;try{MaterialExportCache.load(cache.toFile(),draft.id,draft.account,draft.format,draft.title,now+MaterialExportCache.TTL+1);}catch(IOException expected){expired=true;}yes(expired);
   Path payload=cache.resolve("io-material-document-exports").resolve(draft.id).resolve("document.bin");Files.write(payload,new byte[]{1,2,3});boolean damaged=false;try{MaterialExportCache.bytes(cache.toFile(),restored,now);}catch(IOException expected){damaged=true;}yes(damaged);MaterialExportCache.remove(cache.toFile(),draft.id);yes(!Files.exists(payload));
   Path unrelated=cache.resolve("retained-user-record.txt");Files.writeString(unrelated,"preserve");boolean traversal=false;try{MaterialExportCache.remove(cache.toFile(),"../retained-user-record.txt");}catch(IOException expected){traversal=true;}yes(traversal&&Files.readString(unrelated).equals("preserve"));
   MaterialExportCache.Draft old=MaterialExportCache.prepare(cache.toFile(),"a".repeat(64),entry,MaterialDocument.Format.TEXT,now);MaterialExportCache.prune(cache.toFile(),now+MaterialExportCache.TTL+1);yes(!Files.exists(cache.resolve("io-material-document-exports").resolve(old.id))&&Files.exists(unrelated));
   for(int i=0;i<MaterialExportCache.MAX_DRAFTS;i++)MaterialExportCache.prepare(cache.toFile(),"a".repeat(64),entry,MaterialDocument.Format.TEXT,now);boolean full=false;try{MaterialExportCache.prepare(cache.toFile(),"a".repeat(64),entry,MaterialDocument.Format.TEXT,now);}catch(IOException expected){full=true;}yes(full);
  }finally{try(java.util.stream.Stream<Path> files=Files.walk(cache)){for(Path file:(Iterable<Path>)files.sorted(Comparator.reverseOrder())::iterator)Files.delete(file);}}
  System.out.println("Material catalog/document: "+checks+" checks passed");
 }
}
