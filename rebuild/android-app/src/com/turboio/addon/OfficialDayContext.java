package com.turboio.addon;

import java.io.*;import java.math.BigDecimal;import java.time.*;import java.util.*;

/** A projection of existing official day responses, with no sensor or calendar-provider access. */
final class OfficialDayContext {
 static final int MAX_BYTES=4194304;
 static Map<String,Object> read(String account,OfficialLifelogInventory.Request request,byte[] response){
  Map<String,Object> root=WireJson.map(WireJson.read(OfficialLifelogJson.read(response).canonical)),data=WireJson.map(root.get("data"));
  MaterialWire.require(Long.valueOf(0).equals(root.get("code"))&&request.date.equals(data.get("date")),"DAY_CONTEXT_SOURCE_INVALID");
  List<Object> events=new ArrayList<>(),trail=new ArrayList<>();
  for(Object raw:WireJson.list(data.get("events"))){Map<String,Object> e=WireJson.map(raw);Object type=e.get("eventType");if(!TaskWire.set("stayPoint","trajectory","schedule").contains(type))continue;String kind=(String)type;
   long start=epoch(e.get("startTime")),end=epoch(e.get("endTime"));MaterialWire.require(end>=start,"DAY_CONTEXT_SOURCE_INVALID");
   Map<String,Object> event=WireJson.object("id",MaterialWire.text(e.get("id"),160,false),"kind",kind,"started_at_ms",start,"ended_at_ms",end,"title",e.get("title")==null?"":MaterialWire.text(e.get("title"),2000,true));
   for(String[] names:new String[][]{{"content","content"},{"location","location"},{"poiName","poi_name"},{"poiAddress","poi_address"},{"travelMode","travel_mode"}})if(e.get(names[0])!=null)event.put(names[1],MaterialWire.text(e.get(names[0]),16000,true));
   if(e.get("distanceMeters")!=null){double n=number(e.get("distanceMeters"));MaterialWire.require(n>=0&&n<=1e8,"DAY_CONTEXT_SOURCE_INVALID");event.put("distance_m",e.get("distanceMeters"));}
   events.add(event);
  }
  if(data.get("trailPoints")!=null)for(Object raw:WireJson.list(data.get("trailPoints"))){Map<String,Object> p=WireJson.map(raw);double lat=number(p.get("latitude")),lng=number(p.get("longitude"));MaterialWire.require(Math.abs(lat)<=90&&Math.abs(lng)<=180,"DAY_CONTEXT_SOURCE_INVALID");
   String kind=p.get("pointType")==null?"unknown":MaterialWire.text(p.get("pointType"),20,false);MaterialWire.require(TaskWire.set("rawPoint","stayPoint","unknown").contains(kind),"DAY_CONTEXT_SOURCE_INVALID");
   Map<String,Object> point=WireJson.object("at_ms",epoch(p.get("timestamp")),"lat_e6",Math.round(lat*1e6),"lng_e6",Math.round(lng*1e6),"kind",kind,"event_id",p.get("sourceEventId")==null?"":MaterialWire.text(p.get("sourceEventId"),160,true));
   if(p.get("accuracy")!=null){double n=number(p.get("accuracy"));MaterialWire.require(n>=0&&n<=1e6,"DAY_CONTEXT_SOURCE_INVALID");point.put("accuracy_m",p.get("accuracy"));}
   if(p.get("stayStartTime")!=null)point.put("stay_start_ms",epoch(p.get("stayStartTime")));if(p.get("stayEndTime")!=null)point.put("stay_end_ms",epoch(p.get("stayEndTime")));
   trail.add(point);
  }
  MaterialWire.require(events.size()<=3000&&trail.size()<=20000,"DAY_CONTEXT_SOURCE_BUDGET");
  Map<String,Object> source=WireJson.object("id","context-"+TaskWire.hash(WireJson.bytes(Arrays.asList(account,request.date,request.timezone))),"date",request.date,"timezone",request.timezone,"origin","official_lifelog","coordinate_system","source_unspecified","coverage","source_snapshot","events",events,"trail",trail);
  MaterialWire.require(WireJson.bytes(source).length<=MAX_BYTES,"DAY_CONTEXT_SOURCE_BUDGET");return source;
 }
 private static long epoch(Object value){long time=value instanceof String&&((String)value).matches("[0-9]{13}")?Long.parseLong((String)value):MaterialWire.number(value);MaterialWire.require(time>=1000000000000L&&time<10000000000000L,"DAY_CONTEXT_SOURCE_INVALID");return time;}
 private static double number(Object value){MaterialWire.require(value instanceof Long||value instanceof Integer||value instanceof BigDecimal,"DAY_CONTEXT_SOURCE_INVALID");double n=((Number)value).doubleValue();MaterialWire.require(Double.isFinite(n),"DAY_CONTEXT_SOURCE_INVALID");return n;}
 static File file(File root,String account,String date,String timezone){LocalDate.parse(date);ZoneId.of(timezone);MaterialWire.require(account.matches("[a-f0-9]{64}"),"MATERIAL_LOCAL_BINDING");return new File(root,"material-accounts/"+account+"/day-context/"+date+"-"+TaskWire.hash(timezone.getBytes(java.nio.charset.StandardCharsets.UTF_8)).substring(0,16)+".json");}
 static Map<String,Object> saved(File root,String account,String date,String timezone)throws IOException{
  try(AtomicDocument doc=new AtomicDocument(file(root,account,date,timezone),MAX_BYTES+4096)){Object raw=doc.read();if(raw==null)return null;Map<String,Object> saved=WireJson.map(raw);BoundedJson.keys(saved,"schema","account","source");Map<String,Object> source=WireJson.map(saved.get("source"));MaterialWire.require(Long.valueOf(1).equals(saved.get("schema"))&&account.equals(saved.get("account"))&&date.equals(source.get("date"))&&timezone.equals(source.get("timezone")),"DAY_CONTEXT_LOCAL_INVALID");return source;}
 }
 static void retain(File root,String account,Map<String,Object> source,MaterialLocalLibrary.Guard guard)throws Exception{
  MaterialWire.require(account.equals(guard.current()),"OFFICIAL_ACCOUNT_CHANGED");try(AtomicDocument doc=new AtomicDocument(file(root,account,(String)source.get("date"),(String)source.get("timezone")),MAX_BYTES+4096)){doc.save(WireJson.object("schema",1L,"account",account,"source",source));}
 }
}
