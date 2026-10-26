package com.turboio.addon;

import java.math.BigDecimal;
import java.util.*;

/** Official AI summary, per-time outline and day location trail, read from the
 * same day list and event/full responses the transcript pipeline already uses.
 * Best effort: a shape this adapter does not recognise yields no insight and
 * never fails the transcript read. Local reading only; never uploaded. */
final class OfficialLifelogInsight {
 static final int MAX_SUMMARY=8000,MAX_TOPIC=500,MAX_TOPICS=100,MAX_EVENTS=64,MAX_POINTS=2000;
 static final class Topic {
  final long at;final String text;
  Topic(long at,String text){this.at=at;this.text=text;}
 }
 static final class Event {
  final String id,title,summary,emotion;final long start,end;final List<Topic> outline;final Set<String> refs;
  Event(String id,String title,String summary,String emotion,long start,long end,List<Topic> outline,Set<String> refs){this.id=id;this.title=title;this.summary=summary;this.emotion=emotion;this.start=start;this.end=end;this.outline=Collections.unmodifiableList(new ArrayList<>(outline));this.refs=Collections.unmodifiableSet(new TreeSet<>(refs));}
  /** A detail response refines the list row; an empty detail field keeps the list value. */
  Event refine(Event detail){if(detail==null||!detail.id.equals(id))return this;return new Event(id,detail.title.isEmpty()?title:detail.title,detail.summary.isEmpty()?summary:detail.summary,detail.emotion.isEmpty()?emotion:detail.emotion,detail.start,detail.end,detail.outline.isEmpty()?outline:detail.outline,detail.refs.isEmpty()?refs:detail.refs);}
 }
 /** Coordinates are kept as integer micro-degrees; distances in metres. */
 static final class Point {
  final long at,stayStart,stayEnd;final int latE6,lngE6,radius,accuracy;final String type,eventId;
  Point(long at,int latE6,int lngE6,String type,long stayStart,long stayEnd,int radius,int accuracy,String eventId){this.at=at;this.latE6=latE6;this.lngE6=lngE6;this.type=type;this.stayStart=stayStart;this.stayEnd=stayEnd;this.radius=radius;this.accuracy=accuracy;this.eventId=eventId;}
  boolean stay(){return stayStart>0&&stayEnd>=stayStart;}
  double lat(){return latE6/1e6;}double lng(){return lngE6/1e6;}
 }
 static final class Day {
  final String date,timezone;final List<Event> events;final List<Point> trail;
  Day(String date,String timezone,List<Event> events,List<Point> trail){this.date=date;this.timezone=timezone;this.events=Collections.unmodifiableList(new ArrayList<>(events));this.trail=Collections.unmodifiableList(new ArrayList<>(trail));}
 }

 /** The day list: one row per official event plus `trailPoints`. */
 static Day list(OfficialLifelogInventory.Request request,byte[] response){
  try{Map<String,Object> data=data(WireJson.read(OfficialLifelogJson.read(response).canonical));if(!request.date.equals(data.get("date")))return null;
   List<Event> events=new ArrayList<>();Object rows=data.get("events");if(rows instanceof List)for(Object raw:(List<?>)rows){Event e=event(raw);if(e!=null&&events.size()<MAX_EVENTS)events.add(e);}
   List<Point> trail=new ArrayList<>();Object points=data.get("trailPoints");if(points instanceof List)for(Object raw:(List<?>)points){Point p=point(raw);if(p!=null&&trail.size()<MAX_POINTS)trail.add(p);}
   trail.sort(Comparator.comparingLong(p->p.at));return new Day(request.date,request.timezone,events,trail);
  }catch(RuntimeException unrecognised){return null;}
 }
 /** `/lifelog/api/v1/events/:id/full`, already canonicalised by the transcript reader. */
 static Event full(String eventId,byte[] canonical){
  try{Event e=event(data(WireJson.read(canonical)));return e!=null&&e.id.equals(eventId)?e:null;}catch(RuntimeException unrecognised){return null;}
 }
 private static Map<String,Object> data(Object root){Map<String,Object> response=WireJson.map(root);MaterialWire.require(Long.valueOf(0).equals(response.get("code")),"LIFELOG_RESPONSE_REJECTED");return WireJson.map(response.get("data"));}
 private static Event event(Object raw){
  if(!(raw instanceof Map))return null;Map<String,Object> row=WireJson.map(raw);String id=string(row.get("id"),80);if(id.isEmpty()||!id.matches("[A-Za-z0-9_-]+"))return null;
  long start=epoch(row.get("startTime")),end=epoch(row.get("endTime"));if(start<=0||end<start)return null;
  List<Topic> outline=new ArrayList<>();Object topics=row.get("outline");if(topics instanceof List)for(Object item:(List<?>)topics){if(!(item instanceof Map)||outline.size()>=MAX_TOPICS)continue;Map<String,Object> t=WireJson.map(item);long at=epoch(t.get("timestamp"));String text=string(t.get("content"),MAX_TOPIC).trim();if(at>0&&!text.isEmpty())outline.add(new Topic(at,text));}
  outline.sort(Comparator.comparingLong(t->t.at));
  Set<String> refs=new TreeSet<>();Object links=row.get("transcriptionInfos");if(links instanceof List)for(Object link:(List<?>)links){if(!(link instanceof Map))continue;Map<String,Object> v=WireJson.map(link);String type=string(v.get("sourceType"),128),source=string(v.get("sourceId"),128);if(!type.isEmpty()&&!source.isEmpty())refs.add(type+"/"+source);}
  return new Event(id,string(row.get("title"),200).trim(),string(row.get("summaryContent"),MAX_SUMMARY).trim(),string(row.get("emotion"),20).trim(),start,end,outline,refs);
 }
 private static Point point(Object raw){
  if(!(raw instanceof Map))return null;Map<String,Object> v=WireJson.map(raw);long at=epoch(v.get("timestamp"));Double lat=decimal(v.get("latitude")),lng=decimal(v.get("longitude"));
  if(at<=0||lat==null||lng==null||Math.abs(lat)>90||Math.abs(lng)>180)return null;Double radius=decimal(v.get("stayRadius")),accuracy=decimal(v.get("accuracy"));String event=string(v.get("sourceEventId"),80);
  return new Point(at,(int)Math.round(lat*1e6),(int)Math.round(lng*1e6),string(v.get("pointType"),20),epoch(v.get("stayStartTime")),epoch(v.get("stayEndTime")),radius==null?0:(int)Math.min(100000,Math.max(0,Math.round(radius))),accuracy==null?0:(int)Math.min(100000,Math.max(0,Math.round(accuracy))),event.matches("[A-Za-z0-9_-]*")?event:"");
 }
 private static String string(Object v,int max){if(!(v instanceof String))return "";String s=(String)v;return s.codePointCount(0,s.length())<=max?s:s.substring(0,s.offsetByCodePoints(0,max));}
 private static Double decimal(Object v){if(v instanceof Long||v instanceof Integer)return ((Number)v).doubleValue();if(v instanceof BigDecimal)return ((BigDecimal)v).doubleValue();return null;}
 /** Official times are epoch milliseconds, as a number or 13-digit string. */
 private static long epoch(Object v){if(v instanceof Long){long n=(Long)v;return n>=1000000000000L&&n<=9999999999999L?n:0;}if(v instanceof String&&((String)v).matches("[0-9]{13}"))return Long.parseLong((String)v);return 0;}

 // Local document form (see LifelogInsightStore). Strict on read: this is our own file.
 static Map<String,Object> encode(Day day){
  List<Object> events=new ArrayList<>(),trail=new ArrayList<>();
  for(Event e:day.events){List<Object> outline=new ArrayList<>();for(Topic t:e.outline)outline.add(WireJson.object("at",t.at,"text",t.text));events.add(WireJson.object("id",e.id,"title",e.title,"summary",e.summary,"emotion",e.emotion,"start",e.start,"end",e.end,"outline",outline,"refs",new ArrayList<Object>(e.refs)));}
  for(Point p:day.trail)trail.add(WireJson.object("at",p.at,"lat_e6",(long)p.latE6,"lng_e6",(long)p.lngE6,"type",p.type,"stay_start",p.stayStart,"stay_end",p.stayEnd,"radius",(long)p.radius,"accuracy",(long)p.accuracy,"event",p.eventId));
  return WireJson.object("date",day.date,"timezone",day.timezone,"events",events,"trail",trail);
 }
 static Day decode(Object raw){
  Map<String,Object> v=WireJson.map(raw);BoundedJson.keys(v,"date","timezone","events","trail");List<Event> events=new ArrayList<>();List<Point> trail=new ArrayList<>();
  for(Object item:WireJson.list(v.get("events"))){Map<String,Object> e=WireJson.map(item);BoundedJson.keys(e,"id","title","summary","emotion","start","end","outline","refs");List<Topic> outline=new ArrayList<>();for(Object t:WireJson.list(e.get("outline"))){Map<String,Object> m=WireJson.map(t);BoundedJson.keys(m,"at","text");outline.add(new Topic(MaterialWire.positive(m.get("at")),MaterialWire.text(m.get("text"),MAX_TOPIC,false)));}Set<String> refs=new TreeSet<>();for(Object r:WireJson.list(e.get("refs")))refs.add(MaterialWire.text(r,300,false));
   MaterialWire.require(outline.size()<=MAX_TOPICS,"LIFELOG_INSIGHT_BUDGET");events.add(new Event(MaterialWire.text(e.get("id"),80,false),MaterialWire.text(e.get("title"),200,true),MaterialWire.text(e.get("summary"),MAX_SUMMARY,true),MaterialWire.text(e.get("emotion"),20,true),MaterialWire.positive(e.get("start")),MaterialWire.positive(e.get("end")),outline,refs));}
  for(Object item:WireJson.list(v.get("trail"))){Map<String,Object> p=WireJson.map(item);BoundedJson.keys(p,"at","lat_e6","lng_e6","type","stay_start","stay_end","radius","accuracy","event");trail.add(new Point(MaterialWire.positive(p.get("at")),coordinate(p.get("lat_e6"),90),coordinate(p.get("lng_e6"),180),MaterialWire.text(p.get("type"),20,true),MaterialWire.number(p.get("stay_start")),MaterialWire.number(p.get("stay_end")),(int)Math.min(100000,MaterialWire.number(p.get("radius"))),(int)Math.min(100000,MaterialWire.number(p.get("accuracy"))),MaterialWire.text(p.get("event"),80,true)));}
  MaterialWire.require(events.size()<=MAX_EVENTS&&trail.size()<=MAX_POINTS,"LIFELOG_INSIGHT_BUDGET");return new Day(MaterialWire.text(v.get("date"),10,false),MaterialWire.text(v.get("timezone"),80,false),events,trail);
 }
 private static int coordinate(Object v,int limit){MaterialWire.require(v instanceof Long,"LIFELOG_INSIGHT_INVALID");long n=(Long)v;MaterialWire.require(Math.abs(n)<=limit*1000000L,"LIFELOG_INSIGHT_INVALID");return (int)n;}
}
