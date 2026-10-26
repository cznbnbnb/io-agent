package com.turboio.addon;

import java.io.*;
import java.nio.file.Files;
import java.util.*;

/** Account-owned local copy of official summaries, outlines and day trails.
 * Sits beside the local library; reading only, never staged for upload. Like
 * the library, a later empty or partial read never removes what was retained. */
final class LifelogInsightStore implements AutoCloseable {
 static final int MAX_DAYS=120,MAX_BYTES=16777216;
 static final class Snapshot {
  final String account;private final Map<String,OfficialLifelogInsight.Day> days;
  Snapshot(String account,Map<String,OfficialLifelogInsight.Day> days){this.account=account;this.days=Collections.unmodifiableMap(new TreeMap<>(days));}
  OfficialLifelogInsight.Day day(String date,String timezone){return days.get(date+"\n"+timezone);}
  /** The official event that lists this material as one of its sources. */
  OfficialLifelogInsight.Event eventFor(String materialId){for(OfficialLifelogInsight.Day day:days.values())for(OfficialLifelogInsight.Event event:day.events)if(materialIds(event).contains(materialId))return event;return null;}
  /** Mutating/export actions must use the same day as the visible timeline. */
  OfficialLifelogInsight.Event eventFor(String materialId,String date,String timezone){OfficialLifelogInsight.Day day=day(date,timezone);if(day!=null)for(OfficialLifelogInsight.Event event:day.events)if(materialIds(event).contains(materialId))return event;return null;}
  Set<String> materialIds(OfficialLifelogInsight.Event event){Set<String> ids=new HashSet<>();for(String ref:event.refs){int slash=ref.indexOf('/');if(slash>0)ids.add(OfficialLifelogSnapshot.materialId(account,ref.substring(0,slash),ref.substring(slash+1)));}return ids;}
  /** Trail points recorded during [from, to] on any retained day. */
  List<OfficialLifelogInsight.Point> trail(long from,long to){List<OfficialLifelogInsight.Point> found=new ArrayList<>();Set<Long> seen=new HashSet<>();for(OfficialLifelogInsight.Day day:days.values())for(OfficialLifelogInsight.Point p:day.trail){boolean during=p.at>=from&&p.at<=to||p.stay()&&p.stayStart<=to&&p.stayEnd>=from;if(during&&seen.add(p.at))found.add(p);}found.sort(Comparator.comparingLong(p->p.at));return found;}
 }
 private final String account;private final AtomicDocument document;private Snapshot state;private boolean closed;
 LifelogInsightStore(File files,String account)throws IOException{
  MaterialWire.require(account!=null&&account.matches("[a-f0-9]{64}"),"MATERIAL_LOCAL_BINDING");this.account=account;
  File directory=new File(new File(new File(files,"material-accounts"),account),"local-library");
  for(File path=directory;path!=null&&!path.equals(files);path=path.getParentFile())MaterialWire.require(!Files.isSymbolicLink(path.toPath()),"MATERIAL_LOCAL_PATH");
  File file=new File(directory,"insights.json");for(String suffix:new String[]{"",".partial",".lock"})MaterialWire.require(!Files.isSymbolicLink(new File(file.getPath()+suffix).toPath()),"MATERIAL_LOCAL_PATH");
  document=new AtomicDocument(file,MAX_BYTES);try{Object raw=document.read();state=raw==null?new Snapshot(account,new TreeMap<>()):decode(raw);}catch(IOException|RuntimeException failure){document.close();throw failure;}
 }
 private Snapshot decode(Object raw){Map<String,Object> input=WireJson.map(raw);BoundedJson.keys(input,"schema","account","days");MaterialWire.require(MaterialWire.positive(input.get("schema"))==1&&account.equals(input.get("account")),"MATERIAL_LOCAL_BINDING");Map<String,OfficialLifelogInsight.Day> days=new TreeMap<>();for(Object value:WireJson.list(input.get("days"))){OfficialLifelogInsight.Day day=OfficialLifelogInsight.decode(value);MaterialWire.require(days.put(day.date+"\n"+day.timezone,day)==null,"MATERIAL_LOCAL_INVALID");}MaterialWire.require(days.size()<=MAX_DAYS,"MATERIAL_LOCAL_BUDGET");return new Snapshot(account,days);}
 synchronized Snapshot snapshot(){MaterialWire.require(!closed,"MATERIAL_LOCAL_CLOSED");return state;}
 /** Events merge by id (new values win, missing ones stay); a non-empty trail replaces the day's trail. */
 synchronized void record(List<OfficialLifelogInsight.Day> fresh,MaterialLocalLibrary.Guard guard)throws Exception{
  MaterialWire.require(!closed,"MATERIAL_LOCAL_CLOSED");MaterialWire.require(guard!=null&&account.equals(guard.current()),"OFFICIAL_ACCOUNT_CHANGED");
  Map<String,OfficialLifelogInsight.Day> days=new TreeMap<>(state.days);
  for(OfficialLifelogInsight.Day day:fresh){String key=day.date+"\n"+day.timezone;OfficialLifelogInsight.Day old=days.get(key);Map<String,OfficialLifelogInsight.Event> events=new LinkedHashMap<>();Set<String> freshRefs=new HashSet<>();for(OfficialLifelogInsight.Event e:day.events)freshRefs.addAll(e.refs);if(old!=null)for(OfficialLifelogInsight.Event e:old.events)if(Collections.disjoint(e.refs,freshRefs))events.put(e.id,e);for(OfficialLifelogInsight.Event e:day.events)events.put(e.id,e);
   List<OfficialLifelogInsight.Event> merged=new ArrayList<>(events.values());merged.sort(Comparator.comparingLong(e->e.start));while(merged.size()>OfficialLifelogInsight.MAX_EVENTS)merged.remove(0);
   days.put(key,new OfficialLifelogInsight.Day(day.date,day.timezone,merged,day.trail.isEmpty()&&old!=null?old.trail:day.trail));}
  while(days.size()>MAX_DAYS)days.remove(((TreeMap<String,OfficialLifelogInsight.Day>)days).firstKey());
  List<Object> encoded=new ArrayList<>();for(OfficialLifelogInsight.Day day:days.values())encoded.add(OfficialLifelogInsight.encode(day));Map<String,Object> document=WireJson.object("schema",1,"account",account,"days",encoded);
  Snapshot verified=decode(WireJson.read(WireJson.bytes(document),MAX_BYTES,2000000));MaterialWire.require(account.equals(guard.current()),"OFFICIAL_ACCOUNT_CHANGED");this.document.save(document);state=verified;
 }
 @Override public synchronized void close()throws IOException{if(!closed){closed=true;document.close();}}
}
