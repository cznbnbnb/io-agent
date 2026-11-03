package com.turboio.addon;
import java.io.*;import java.time.*;import java.util.*;

/** Only the new, explicitly allowed text projection is sent. No old outbox,
 * original JSON, audio URL, location trail or server correction is read here. */
final class LifelogTextSync {
 static String sourceId(String account,String type,String id){return "text-"+TaskWire.hash(WireJson.bytes(Arrays.asList(account,type,id)));}
 static List<Map<String,Object>> project(String account,String timezone,MaterialLocalLibrary.Snapshot local,OfficialLifelogInsight.Day insights){
  List<Map<String,Object>> result=new ArrayList<>();ZoneId zone=ZoneId.of(timezone);
  for(MaterialLocalLibrary.Record record:local.records){OfficialLifelogSnapshot.Source s=record.source;List<Object> blocks=new ArrayList<>();blocks.add(WireJson.object("id","title","kind","title","text",s.title));
   for(OfficialLifelogSnapshot.Clip c:s.clips)blocks.add(WireJson.object("id","clip-"+TaskWire.hash(WireJson.bytes(c.id)),"kind","utterance","text",c.text,"started_at",TaskWire.now(c.start),"ended_at",TaskWire.now(c.end),"speaker",c.speakerName));
   result.add(WireJson.object("id",sourceId(account,s.sourceType,s.sourceId),"date",Instant.ofEpochMilli(s.start).atZone(zone).toLocalDate().toString(),"timezone",timezone,"kind","transcript","started_at",TaskWire.now(s.start),"ended_at",TaskWire.now(s.end),"blocks",blocks,"related_ids",Collections.emptyList()));
  }
  if(insights!=null)for(OfficialLifelogInsight.Event e:insights.events){List<Object> blocks=new ArrayList<>(),related=new ArrayList<>();blocks.add(WireJson.object("id","title","kind","title","text",e.title));blocks.add(WireJson.object("id","summary","kind","summary","text",e.summary));
   int i=0;for(OfficialLifelogInsight.Topic topic:e.outline)blocks.add(WireJson.object("id","outline-"+(i++),"kind","outline","text",topic.text,"started_at",TaskWire.now(topic.at)));
   for(String ref:e.refs){int slash=ref.indexOf('/');if(slash>0)related.add(sourceId(account,ref.substring(0,slash),ref.substring(slash+1)));}
   result.add(WireJson.object("id",sourceId(account,"event",e.id),"date",Instant.ofEpochMilli(e.start).atZone(zone).toLocalDate().toString(),"timezone",timezone,"kind","segment","started_at",TaskWire.now(e.start),"ended_at",TaskWire.now(e.end),"blocks",blocks,"related_ids",related));
  }return result;
 }
 static MaterialSyncSession.Status status(File root,MaterialConfig config)throws IOException{
  MaterialSyncSession.Status status=DailySummarySync.status(root,config);if(config==null)return status;
  try(AtomicDocument ledger=new AtomicDocument(new File(MaterialStorage.prepare(root,config),"lifelog-text-v1/state.json"),2097152);MaterialLocalLibrary library=new MaterialLocalLibrary(root,config.account)){
   Object raw=ledger.read();Map<String,Object> days=Collections.emptyMap();
   if(raw!=null){Map<String,Object> state=WireJson.map(raw);BoundedJson.keys(state,"schema","account","days","sources");MaterialWire.require(Long.valueOf(1).equals(state.get("schema"))&&config.account.equals(state.get("account")),"LIFELOG_TEXT_STATE_INVALID");days=WireJson.map(state.get("days"));status.stored+=WireJson.map(state.get("sources")).size();}
   for(MaterialLocalLibrary.DayRead day:library.days())if(!Long.valueOf(day.readAt).equals(days.get(day.date+"/"+day.timezone)))status.queued++;
   if(status.queued>0)status.note="LIFELOG_TEXT_PENDING";return status;
  }
 }
 static MaterialSyncSession.Status run(File root,MaterialConfig config,Set<String> selected,MaterialSyncSession.Guard guard,MaterialApi.Transport transport)throws Exception{
  MaterialSyncSession.Status status=new MaterialSyncSession.Status();guard.check();MaterialWire.require(config.enabled,"MATERIAL_PAUSED");
  File folder=new File(MaterialStorage.prepare(root,config),"lifelog-text-v1");
  try(AtomicDocument ledger=new AtomicDocument(new File(folder,"state.json"),2097152);MaterialLocalLibrary library=new MaterialLocalLibrary(root,config.account);MaterialVisibility visibility=new MaterialVisibility(root,config.account)){
   Object raw=ledger.read();Map<String,Object> state=raw==null?WireJson.object("schema",1L,"account",config.account,"days",new TreeMap<>(),"sources",new TreeMap<>()):WireJson.map(raw);BoundedJson.keys(state,"schema","account","days","sources");MaterialWire.require(Long.valueOf(1).equals(state.get("schema"))&&config.account.equals(state.get("account")),"LIFELOG_TEXT_STATE_INVALID");
   Map<String,Object> days=WireJson.map(state.get("days")),saved=WireJson.map(state.get("sources"));List<MaterialLocalLibrary.DayRead> available=new ArrayList<>(library.days());available.sort((a,b)->Long.compare(b.readAt,a.readAt));
   LifelogInsightStore.Snapshot insights=null;int sent=0;boolean pending=false;Set<String> seenDays=new HashSet<>();
   for(MaterialLocalLibrary.DayRead day:available){if(selected!=null&&!selected.contains(day.date))continue;seenDays.add(day.date);String key=day.date+"/"+day.timezone;
    if(Long.valueOf(day.readAt).equals(days.get(key)))continue;
    if(sent>=8){pending=true;continue;}
    if(insights==null)try(LifelogInsightStore store=new LifelogInsightStore(root,config.account)){insights=store.snapshot();}
    guard.check();MaterialLocalLibrary.Snapshot cached=library.snapshot(day.date,day.timezone);List<MaterialLocalLibrary.Record> visible=new ArrayList<>();for(MaterialLocalLibrary.Record record:cached.records)if(visibility.contains(day.date,day.timezone,record.id))visible.add(record);OfficialLifelogInsight.Day insight=insights.day(day.date,day.timezone);if(insight!=null){List<OfficialLifelogInsight.Event> events=new ArrayList<>();for(OfficialLifelogInsight.Event event:insight.events){boolean present=event.refs.isEmpty();for(String ref:event.refs){int slash=ref.indexOf('/');if(slash>0&&visibility.contains(day.date,day.timezone,OfficialLifelogSnapshot.materialId(config.account,ref.substring(0,slash),ref.substring(slash+1))))present=true;}if(present)events.add(event);}insight=new OfficialLifelogInsight.Day(day.date,day.timezone,events,Collections.emptyList());}List<Map<String,Object>> sources=project(config.account,day.timezone,new MaterialLocalLibrary.Snapshot(config.account,visible,cached.days),insight);boolean complete=true;
    for(Map<String,Object> source:sources){String id=(String)source.get("id"),hash=TaskWire.hash(WireJson.bytes(source));Map<String,Object> old=saved.containsKey(id)?WireJson.map(saved.get(id)):null;if(old!=null&&hash.equals(old.get("hash")))continue;
     if(sent>=8){complete=false;pending=true;continue;}
     guard.check();MaterialApi.Response head=transport.exchange("/lifelog-text/head",WireJson.bytes(WireJson.object("id",id)));MaterialWire.require(head.status==200,"LIFELOG_TEXT_HEAD_UNAVAILABLE");Map<String,Object> current=WireJson.map(WireJson.read(head.body));BoundedJson.keys(current,"id","revision","hash");MaterialWire.require(id.equals(current.get("id")),"MATERIAL_IDENTITY_MISMATCH");long revision=MaterialWire.number(current.get("revision"));
     if(!hash.equals(current.get("hash"))){byte[] payload=WireJson.bytes(WireJson.object("base_revision",revision,"source",source));MaterialWire.require(payload.length<=4198400,"LIFELOG_TEXT_TOO_LARGE");guard.check();MaterialApi.Response response=transport.exchange("/lifelog-text/source",payload);MaterialWire.require(response.status==200,"LIFELOG_TEXT_UPLOAD_FAILED");Map<String,Object> ack=WireJson.map(WireJson.read(response.body));BoundedJson.keys(ack,"id","revision","hash","server_stored","unchanged");MaterialWire.require(id.equals(ack.get("id"))&&hash.equals(ack.get("hash"))&&Boolean.TRUE.equals(ack.get("server_stored")),"MATERIAL_ACK_MISMATCH");revision=MaterialWire.positive(ack.get("revision"));status.added++;}
     guard.check();saved.put(id,WireJson.object("revision",revision,"hash",hash));ledger.save(state);sent++;
    }
    if(complete){guard.check();days.put(key,day.readAt);ledger.save(state);status.days++;}
   }
   status.stored=saved.size();status.queued=pending?1:0;status.selectedComplete=!pending&&(selected==null||seenDays.containsAll(selected));status.progressed=sent>0;status.note=pending?"LIFELOG_TEXT_PENDING":!status.selectedComplete?"LIFELOG_TEXT_NOT_LOADED":"server_stored";return status;
  }
 }
}
