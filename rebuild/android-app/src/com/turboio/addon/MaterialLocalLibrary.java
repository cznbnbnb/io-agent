package com.turboio.addon;

import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.time.*;
import java.util.*;

/** Account-owned official read cache. No remote target, token, producer or
 * upload revision is needed. Only verified fresh day reads may enter this store. */
final class MaterialLocalLibrary implements AutoCloseable {
 interface Guard {String current()throws Exception;}
 static final int MAX_RECORDS=256,MAX_DAYS=366,MAX_ORIGINAL_BYTES=4194304,MAX_DOCUMENT_BYTES=8388608;
 static final class DayRead {
  final String date,timezone;final long readAt;final int sourceCount;
  DayRead(String date,String timezone,long readAt,int sourceCount){this.date=date;this.timezone=timezone;this.readAt=readAt;this.sourceCount=sourceCount;}
 }
 static final class Record {
  final String id;final OfficialLifelogSnapshot.Source source;final long revision,readAt;
  private final Set<String> memberships;
  Record(String account,OfficialLifelogSnapshot.Source source,long revision,long readAt,Set<String> memberships){this.id=source.materialId(account);this.source=source;this.revision=revision;this.readAt=readAt;this.memberships=Collections.unmodifiableSet(new TreeSet<>(memberships));}
  Set<LocalDate> dates(ZoneId zone){Set<LocalDate> result=new TreeSet<>();for(String membership:memberships){int separator=membership.indexOf('\n');if(membership.substring(separator+1).equals(zone.getId()))result.add(LocalDate.parse(membership.substring(0,separator)));}return Collections.unmodifiableSet(result);}
 }
 static final class Snapshot {
  final String account;final List<Record> records;final List<DayRead> days;final long lastReadAt;
  Snapshot(String account,List<Record> records,List<DayRead> days){this.account=account;this.records=Collections.unmodifiableList(new ArrayList<>(records));this.days=Collections.unmodifiableList(new ArrayList<>(days));long latest=0;for(DayRead day:days)latest=Math.max(latest,day.readAt);lastReadAt=latest;}
  DayRead day(String date,String timezone){String key=key(date,timezone);for(DayRead day:days)if(key.equals(key(day.date,day.timezone)))return day;return null;}
 }
 private final String account;private final AtomicDocument document;private Snapshot state;private boolean closed;
 MaterialLocalLibrary(File files,String account)throws IOException{
  require(account!=null&&account.matches("[a-f0-9]{64}"),"MATERIAL_LOCAL_BINDING");this.account=account;
  File directory=new File(new File(new File(files,"material-accounts"),account),"local-library");
  for(File path=directory;path!=null&&!path.equals(files);path=path.getParentFile())require(!Files.isSymbolicLink(path.toPath()),"MATERIAL_LOCAL_PATH");
  File file=new File(directory,"state.json");for(String suffix:new String[]{"",".partial",".lock"})require(!Files.isSymbolicLink(new File(file.getPath()+suffix).toPath()),"MATERIAL_LOCAL_PATH");
  document=new AtomicDocument(file);try{Object raw=document.read();state=raw==null?new Snapshot(account,new ArrayList<>(),new ArrayList<>()):decode(raw);}catch(IOException|RuntimeException failure){document.close();throw failure;}
 }
 private static void require(boolean value,String error){MaterialWire.require(value,error);}
 private static String key(String date,String timezone){try{require(date!=null&&date.matches("[0-9]{4}-[0-9]{2}-[0-9]{2}"),"MATERIAL_LOCAL_DATE");LocalDate.parse(date);require(timezone!=null&&timezone.length()<=80,"MATERIAL_LOCAL_DATE");ZoneId.of(timezone);return date+"\n"+timezone;}catch(DateTimeException failure){throw new IllegalArgumentException("MATERIAL_LOCAL_DATE");}}
 private static Set<String> memberships(Object raw){Set<String> result=new TreeSet<>();for(Object value:WireJson.list(raw)){Map<String,Object> date=WireJson.map(value);BoundedJson.keys(date,"date","timezone");require(result.add(key((String)date.get("date"),(String)date.get("timezone"))),"MATERIAL_LOCAL_INVALID");}require(!result.isEmpty()&&result.size()<=MAX_DAYS,"MATERIAL_LOCAL_BUDGET");return result;}
 private Snapshot decode(Object raw){Map<String,Object> input=WireJson.map(raw);BoundedJson.keys(input,"schema","account","records","days");require(MaterialWire.positive(input.get("schema"))==1&&account.equals(input.get("account")),"MATERIAL_LOCAL_BINDING");List<Record> records=new ArrayList<>();Set<String> ids=new HashSet<>();long bytes=0;
  for(Object value:WireJson.list(input.get("records"))){Map<String,Object> row=WireJson.map(value);BoundedJson.keys(row,"id","revision","read_at","original","original_sha256","memberships");byte[] original=MaterialWire.text(row.get("original"),1048576,false).getBytes(StandardCharsets.UTF_8);require(original.length<=1048576&&TaskWire.hash(original).equals(row.get("original_sha256")),"MATERIAL_LOCAL_CORRUPT");OfficialLifelogSnapshot.Source source=OfficialLifelogSnapshot.original(original);Record record=new Record(account,source,MaterialWire.positive(row.get("revision")),MaterialWire.positive(row.get("read_at")),memberships(row.get("memberships")));require(record.id.equals(row.get("id"))&&ids.add(record.id),"MATERIAL_LOCAL_BINDING");records.add(record);bytes+=original.length;}
  require(records.size()<=MAX_RECORDS&&bytes<=MAX_ORIGINAL_BYTES,"MATERIAL_LOCAL_BUDGET");List<DayRead> days=new ArrayList<>();Set<String> keys=new HashSet<>();for(Object value:WireJson.list(input.get("days"))){Map<String,Object> row=WireJson.map(value);BoundedJson.keys(row,"date","timezone","read_at","source_count");String date=(String)row.get("date"),zone=(String)row.get("timezone");require(keys.add(key(date,zone)),"MATERIAL_LOCAL_INVALID");long count=MaterialWire.number(row.get("source_count"));require(count>=0&&count<=MAX_RECORDS,"MATERIAL_LOCAL_INVALID");days.add(new DayRead(date,zone,MaterialWire.positive(row.get("read_at")),(int)count));}require(days.size()<=MAX_DAYS,"MATERIAL_LOCAL_BUDGET");return new Snapshot(account,records,days);
 }
 private Map<String,Object> encode(Snapshot snapshot){List<Object> records=new ArrayList<>(),days=new ArrayList<>();for(Record record:snapshot.records){byte[] original=record.source.original();List<Object> memberships=new ArrayList<>();for(String member:record.memberships){int separator=member.indexOf('\n');memberships.add(WireJson.object("date",member.substring(0,separator),"timezone",member.substring(separator+1)));}records.add(WireJson.object("id",record.id,"revision",record.revision,"read_at",record.readAt,"original",new String(original,StandardCharsets.UTF_8),"original_sha256",TaskWire.hash(original),"memberships",memberships));}for(DayRead day:snapshot.days)days.add(WireJson.object("date",day.date,"timezone",day.timezone,"read_at",day.readAt,"source_count",day.sourceCount));return WireJson.object("schema",1,"account",account,"records",records,"days",days);}
 synchronized Snapshot snapshot(){require(!closed,"MATERIAL_LOCAL_CLOSED");return state;}
 private void admit(Guard guard)throws Exception{require(!closed,"MATERIAL_LOCAL_CLOSED");require(guard!=null&&account.equals(guard.current()),"OFFICIAL_ACCOUNT_CHANGED");}
 /** Missing sources, an empty day and failed reads never delete retained text.
  * Revisions are local content versions, independent of server CAS revisions. */
 synchronized int recordRead(String date,String timezone,List<OfficialLifelogSnapshot.Source> sources,long now,Guard guard)throws Exception{
  String membership=key(date,timezone);require(now>0&&sources!=null&&sources.size()<=MAX_RECORDS,"MATERIAL_LOCAL_BUDGET");admit(guard);
  Map<String,Record> next=new TreeMap<>();for(Record old:state.records)next.put(old.id,old);Set<String> observed=new HashSet<>();int changed=0;
  for(OfficialLifelogSnapshot.Source source:sources){require(source!=null,"MATERIAL_LOCAL_INVALID");String id=source.materialId(account);require(observed.add(id),"LIFELOG_FRESH_SOURCE_CONFLICT");Record old=next.get(id);require(old==null||(source.start<=old.source.start&&source.end>=old.source.end),"LIFELOG_SOURCE_COVERAGE_CHANGED");boolean different=old==null||!Arrays.equals(source.original(),old.source.original());long revision=old==null?1:different?Math.addExact(old.revision,1):old.revision;Set<String> dates=old==null?new TreeSet<>():new TreeSet<>(old.memberships);dates.add(membership);next.put(id,new Record(account,source,revision,now,dates));if(different)changed++;}
  Map<String,DayRead> days=new TreeMap<>();for(DayRead day:state.days)days.put(key(day.date,day.timezone),day);days.put(membership,new DayRead(date,timezone,now,observed.size()));Snapshot candidate=new Snapshot(account,new ArrayList<>(next.values()),new ArrayList<>(days.values()));Map<String,Object> encoded=encode(candidate);
  require(WireJson.bytes(encoded).length<=MAX_DOCUMENT_BYTES,"MATERIAL_LOCAL_BUDGET");Snapshot verified=decode(encoded);admit(guard);document.save(encoded);state=verified;return changed;
 }
 @Override public synchronized void close()throws IOException{if(!closed){closed=true;document.close();}}
}
