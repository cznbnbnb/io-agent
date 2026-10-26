package com.turboio.addon;

import java.time.*;
import java.util.*;

/** One day's materials grouped by the official event that produced them, in a
 * clear time order. Entries sharing a start time stay distinguishable by their
 * own end time and part number. Pure view model: no I/O, no Android types. */
final class MaterialTimeline {
 static final class Item {
  final OfficialLifelogInsight.Event event;final List<MaterialCatalog.Entry> parts;final long start,end;
  Item(OfficialLifelogInsight.Event event,List<MaterialCatalog.Entry> parts){this.event=event;this.parts=Collections.unmodifiableList(parts);long s=Long.MAX_VALUE,e=0;for(MaterialCatalog.Entry p:parts){s=Math.min(s,start(p));e=Math.max(e,end(p));}start=s;end=e;}
  boolean group(){return parts.size()>1;}
  String title(){return event!=null&&!event.title.isEmpty()?event.title:parts.get(0).title;}
  String summary(){return event==null?"":event.summary;}
 }
 static final class Section {
  final String name;final List<Item> items;
  Section(String name,List<Item> items){this.name=name;this.items=Collections.unmodifiableList(items);}
  int count(){int n=0;for(Item i:items)n+=i.parts.size();return n;}
 }
 static final Comparator<MaterialCatalog.Entry> CHRONOLOGICAL=Comparator.comparingLong(MaterialTimeline::start).thenComparingLong(MaterialTimeline::end).thenComparing(e->e.id);
 /** Official sources of one event all carry the event's whole range, so parts are
  * told apart by when speech actually starts and ends inside them. */
 static long start(MaterialCatalog.Entry e){long first=Long.MAX_VALUE;for(MaterialCatalog.Segment s:e.segments)if(s.start!=null)first=Math.min(first,s.start);return first==Long.MAX_VALUE?e.startedAt:e.startedAt+first;}
 static long end(MaterialCatalog.Entry e){long last=-1;for(MaterialCatalog.Segment s:e.segments){if(s.end!=null)last=Math.max(last,s.end);else if(s.start!=null)last=Math.max(last,s.start);}return last<0?e.endedAt:Math.max(start(e),e.startedAt+last);}

 static String range(MaterialCatalog.Entry e){java.time.format.DateTimeFormatter f=java.time.format.DateTimeFormatter.ofPattern("HH:mm",Locale.ROOT);return f.format(Instant.ofEpochMilli(start(e)).atZone(e.zone))+" – "+f.format(Instant.ofEpochMilli(end(e)).atZone(e.zone));}

 /** Each entry belongs to at most one item: the earliest official event listing it. */
 static List<Item> items(List<MaterialCatalog.Entry> entries,LifelogInsightStore.Snapshot insights,String date,String timezone){
  List<MaterialCatalog.Entry> pending=new ArrayList<>(entries);pending.sort(CHRONOLOGICAL);List<Item> items=new ArrayList<>();
  OfficialLifelogInsight.Day day=insights==null?null:insights.day(date,timezone);
  if(day!=null)for(OfficialLifelogInsight.Event event:day.events){Set<String> ids=insights.materialIds(event);List<MaterialCatalog.Entry> parts=new ArrayList<>();for(Iterator<MaterialCatalog.Entry> it=pending.iterator();it.hasNext();){MaterialCatalog.Entry e=it.next();if(ids.contains(e.id)){parts.add(e);it.remove();}}if(!parts.isEmpty())items.add(new Item(event,parts));}
  // Entries read on other days may still carry their own event; look it up once.
  for(MaterialCatalog.Entry e:pending)items.add(new Item(insights==null?null:insights.eventFor(e.id),Collections.singletonList(e)));
  return items;
 }
 static List<Section> sections(List<Item> items,ZoneId zone,boolean newestFirst){
  List<Item> ordered=new ArrayList<>(items);ordered.sort(Comparator.comparingLong((Item i)->i.start).thenComparingLong(i->i.end));
  String[] names={"上午","下午","晚上"};List<List<Item>> buckets=Arrays.asList(new ArrayList<>(),new ArrayList<>(),new ArrayList<>());
  for(Item item:ordered){int hour=Instant.ofEpochMilli(item.start).atZone(zone).getHour();buckets.get(hour<12?0:hour<18?1:2).add(item);}
  List<Section> sections=new ArrayList<>();for(int i=0;i<3;i++){if(buckets.get(i).isEmpty())continue;List<Item> list=buckets.get(i);if(newestFirst)Collections.reverse(list);sections.add(new Section(names[i],list));}
  if(newestFirst)Collections.reverse(sections);return sections;
 }
 /** Outline topics that fall inside one part, or all of them when none do. */
 static List<OfficialLifelogInsight.Topic> topics(OfficialLifelogInsight.Event event,MaterialCatalog.Entry part){
  if(event==null)return Collections.emptyList();List<OfficialLifelogInsight.Topic> inside=new ArrayList<>();for(OfficialLifelogInsight.Topic t:event.outline)if(t.at>=start(part)&&t.at<=end(part))inside.add(t);return inside.isEmpty()?event.outline:inside;
 }
 /** The first transcript segment at or after an absolute time; -1 if none. */
 static int segmentAt(MaterialCatalog.Entry entry,long at){for(int i=0;i<entry.segments.size();i++){Long start=entry.segments.get(i).start;if(start!=null&&entry.startedAt+start>=at-1000)return i;}return -1;}
 /** Great-circle metres between two trail points. */
 static double metres(OfficialLifelogInsight.Point a,OfficialLifelogInsight.Point b){double r=6371000,p1=Math.toRadians(a.lat()),p2=Math.toRadians(b.lat()),dp=p2-p1,dl=Math.toRadians(b.lng()-a.lng());double h=Math.sin(dp/2)*Math.sin(dp/2)+Math.cos(p1)*Math.cos(p2)*Math.sin(dl/2)*Math.sin(dl/2);return 2*r*Math.asin(Math.min(1,Math.sqrt(h)));}
 static double travelled(List<OfficialLifelogInsight.Point> trail){double total=0;for(int i=1;i<trail.size();i++)total+=metres(trail.get(i-1),trail.get(i));return total;}
}
