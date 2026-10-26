package com.turboio.addon;

import java.nio.charset.StandardCharsets;
import java.time.*;
import java.time.format.DateTimeFormatter;
import java.util.*;

/** Immutable, account-scoped view of the latest retained material revisions.
 * The runtime owns the queue lock. This class never opens files or sends data. */
final class MaterialCatalog {
 static final class Segment {
  final String text,speaker;final Long start,end;
  Segment(String text,String speaker,Long start,Long end){this.text=text;this.speaker=speaker;this.start=start;this.end=end;}
 }
 static final class Entry {
  final String id,title,source,state,error,fullText,audioState,coverage;
  final long revision,startedAt,endedAt,storedAt,observedAt;final LocalDate day;final ZoneId zone;final Set<LocalDate> dates;
  final List<Segment> segments;
  Entry(Map<String,Object> body,Map<String,Object> row,ZoneId zone){this(body,row,zone,null,Collections.emptySet(),0);}
  Entry(Map<String,Object> body,Map<String,Object> row,ZoneId zone,String originalTitle,Set<LocalDate> memberships,long observedAt){
   this.zone=zone;id=(String)body.get("material_id");source=(String)body.get("source");revision=MaterialWire.positive(body.get("revision"));
   startedAt=MaterialWire.time(body.get("started_at"));endedAt=MaterialWire.time(body.get("ended_at"));day=Instant.ofEpochMilli(startedAt).atZone(zone).toLocalDate();
   title=originalTitle!=null&&!originalTitle.trim().isEmpty()?originalTitle:("recording".equals(source)?"录音":"agent_analysis".equals(source)?"分析记录":"智记")+" · "+DateTimeFormatter.ofPattern("M月d日 HH:mm",Locale.CHINA).format(Instant.ofEpochMilli(startedAt).atZone(zone));
   this.observedAt=observedAt;Set<LocalDate> dates=new TreeSet<>(memberships);dates.add(day);this.dates=Collections.unmodifiableSet(dates);
   state=(String)row.get("state");error=(String)row.get("error");storedAt="server_stored".equals(state)?MaterialWire.time(WireJson.map(row.get("ack")).get("stored_at")):0;
   fullText=(String)WireJson.map(body.get("full_text")).get("text");audioState=(String)WireJson.map(body.get("audio")).get("state");
   String completeness=(String)body.get("completeness");coverage="complete".equals(completeness)?"转写范围完整":"gap".equals(completeness)?"转写存在缺段":"转写范围尚未完整确认";
   Map<String,String> speakers=new HashMap<>();for(Object raw:WireJson.list(body.get("speakers"))){Map<String,Object> speaker=WireJson.map(raw);speakers.put((String)speaker.get("speaker_id"),(String)speaker.get("label"));}
   List<Segment> list=new ArrayList<>();for(Object raw:WireJson.list(body.get("utterances"))){Map<String,Object> u=WireJson.map(raw);list.add(new Segment((String)u.get("text"),speakers.getOrDefault(u.get("speaker_id"),"未标记说话人"),u.get("start_ms")==null?null:MaterialWire.number(u.get("start_ms")),u.get("end_ms")==null?null:MaterialWire.number(u.get("end_ms"))));}
   segments=Collections.unmodifiableList(list);
  }
  private Entry(Entry entry,String title,Set<LocalDate> memberships){id=entry.id;this.title=title==null||title.trim().isEmpty()?entry.title:title;source=entry.source;state=entry.state;error=entry.error;fullText=entry.fullText;audioState=entry.audioState;coverage=entry.coverage;revision=entry.revision;startedAt=entry.startedAt;endedAt=entry.endedAt;storedAt=entry.storedAt;observedAt=entry.observedAt;day=entry.day;zone=entry.zone;segments=entry.segments;Set<LocalDate> dates=new TreeSet<>(memberships);this.dates=Collections.unmodifiableSet(dates);}
  String timeRange(){DateTimeFormatter f=DateTimeFormatter.ofPattern("HH:mm",Locale.ROOT);return f.format(Instant.ofEpochMilli(startedAt).atZone(zone))+" – "+f.format(Instant.ofEpochMilli(endedAt).atZone(zone));}
  String syncLabel(){switch(state){case "local_only":return "文字已读取 · 仅保存在手机";case "local_updated":return "文字已更新 · 尚未上传";case "server_stored":return "文字已同步";case "blocked":return "同步需处理";case "expired":return "同步凭据或事件已到期";case "reconcile":return "正在核对同步结果";case "sending":return "正在同步";default:return "文字待同步";}}
 }
 final String account;final ZoneId zone;final List<Entry> entries;final Set<LocalDate> dates;
 final int stored,pending,attention,localOnly;final long lastStoredAt;private final Set<String> deleted;
 private MaterialCatalog(String account,ZoneId zone,List<Entry> entries,long lastStoredAt){this(account,zone,entries,lastStoredAt,Collections.emptySet());}
 private MaterialCatalog(String account,ZoneId zone,List<Entry> entries,long lastStoredAt,Set<String> deleted){
  this.account=account;this.zone=zone;this.entries=Collections.unmodifiableList(entries);this.lastStoredAt=lastStoredAt;
  this.deleted=Collections.unmodifiableSet(new HashSet<>(deleted));Set<LocalDate> dates=new TreeSet<>();int stored=0,pending=0,attention=0,localOnly=0;for(Entry e:entries){dates.addAll(e.dates);if(e.state.equals("server_stored"))stored++;else if(e.state.equals("local_only")||e.state.equals("local_updated"))localOnly++;else if(e.state.equals("blocked")||e.state.equals("expired")||e.state.equals("reconcile"))attention++;else pending++;}
  this.dates=Collections.unmodifiableSet(dates);this.stored=stored;this.pending=pending;this.attention=attention;this.localOnly=localOnly;
 }
 static MaterialCatalog visible(MaterialCatalog source,MaterialVisibility visibility){MaterialWire.require(source.account.equals(visibility.account),"OFFICIAL_ACCOUNT_CHANGED");List<Entry> entries=new ArrayList<>();for(Entry entry:source.entries){Set<LocalDate> dates=visibility.visible(entry);if(!dates.isEmpty())entries.add(new Entry(entry,entry.title,dates));}return new MaterialCatalog(source.account,source.zone,entries,source.lastStoredAt,source.deleted);}
 static MaterialCatalog empty(String account,ZoneId zone){return new MaterialCatalog(account,zone,new ArrayList<>(),0);}
 static MaterialCatalog fromRows(String account,String producer,List<Object> rows,ZoneId zone){
  MaterialWire.require(account!=null&&account.matches("[a-f0-9]{64}")&&zone!=null,"MATERIAL_CATALOG_BINDING");
  Map<String,Map<String,Object>> latest=new HashMap<>();long stored=0;
  for(Object raw:rows){Map<String,Object> row=WireJson.map(raw);byte[] payload=((String)row.get("payload")).getBytes(StandardCharsets.UTF_8);MaterialWire.require(TaskWire.hash(payload).equals(row.get("payload_sha256")),"MATERIAL_PAYLOAD_CORRUPT");Map<String,Object> event=MaterialWire.event(payload,producer),body=WireJson.map(event.get("body"));
   MaterialWire.require(body.get("material_id").equals(row.get("material_id"))&&MaterialWire.positive(body.get("revision"))==MaterialWire.positive(row.get("revision")),"MATERIAL_STORE_INVALID");
   if("server_stored".equals(row.get("state"))){MaterialWire.ack(WireJson.map(row.get("ack")),event);stored=Math.max(stored,MaterialWire.time(WireJson.map(row.get("ack")).get("stored_at")));}
   String id=(String)body.get("material_id");Map<String,Object> prior=latest.get(id);if(prior==null||MaterialWire.positive(row.get("revision"))>MaterialWire.positive(prior.get("revision")))latest.put(id,row);
  }
  List<Entry> entries=new ArrayList<>();Set<String> deleted=new HashSet<>();for(Map<String,Object> row:latest.values()){Map<String,Object> event=WireJson.map(MaterialWire.read(((String)row.get("payload")).getBytes(StandardCharsets.UTF_8))),body=WireJson.map(event.get("body"));if(!"delete".equals(body.get("operation")))entries.add(new Entry(body,row,zone,null,Collections.emptySet(),MaterialWire.time(event.get("created_at"))));else deleted.add((String)body.get("material_id"));}
  entries.sort(Comparator.comparingLong((Entry e)->e.startedAt).reversed().thenComparing(e->e.id));return new MaterialCatalog(account,zone,entries,stored,deleted);
 }
 /** Compare exported transcript semantics, not independent local/server revision
  * numbers or mutable speaker IDs. Timing/labels must also match before using a receipt. */
 private static boolean sameContent(Entry a,Entry b){if(!a.id.equals(b.id)||!a.source.equals(b.source)||a.startedAt!=b.startedAt||a.endedAt!=b.endedAt||!a.fullText.equals(b.fullText)||!a.audioState.equals(b.audioState)||!a.coverage.equals(b.coverage)||a.segments.size()!=b.segments.size())return false;for(int i=0;i<a.segments.size();i++){Segment x=a.segments.get(i),y=b.segments.get(i);if(!x.text.equals(y.text)||!x.speaker.equals(y.speaker)||!Objects.equals(x.start,y.start)||!Objects.equals(x.end,y.end))return false;}return true;}
 static MaterialCatalog merge(MaterialCatalog uploaded,MaterialLocalLibrary.Snapshot local){MaterialWire.require(uploaded!=null&&local!=null&&local.account.equals(uploaded.account),"MATERIAL_CATALOG_BINDING");Map<String,Entry> combined=new HashMap<>();for(Entry entry:uploaded.entries)combined.put(entry.id,entry);
  for(MaterialLocalLibrary.Record record:local.records){if(uploaded.deleted.contains(record.id))continue;Map<String,Object> body=WireJson.map(WireJson.read(record.source.materialBody(local.account,record.revision),8388608,500000));Entry prior=combined.get(record.id);Map<String,Object> row=WireJson.object("state",prior==null?"local_only":"local_updated","error","","ack",null);Entry current=new Entry(body,row,uploaded.zone,record.source.title,record.dates(uploaded.zone),record.readAt);
   // An outbox event can be renewed or repaired long after its source was read.
   // created_at is never source freshness proof and must not replace local text.
   if(prior!=null&&sameContent(prior,current))combined.put(record.id,new Entry(prior,record.source.title,current.dates));else combined.put(record.id,current);
  }
  List<Entry> entries=new ArrayList<>(combined.values());entries.sort(Comparator.comparingLong((Entry e)->e.startedAt).reversed().thenComparing(e->e.id));return new MaterialCatalog(local.account,uploaded.zone,entries,uploaded.lastStoredAt,uploaded.deleted);
 }
 List<Entry> on(LocalDate day){List<Entry> found=new ArrayList<>();for(Entry entry:entries)if(entry.dates.contains(day))found.add(entry);return Collections.unmodifiableList(found);}
}
