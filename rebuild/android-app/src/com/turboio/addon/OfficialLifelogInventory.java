package com.turboio.addon;
import java.net.*;import java.time.*;import java.time.format.DateTimeParseException;import java.util.*;

/** Authenticated single-day list schema. An empty page is never a tombstone or
 * proof of complete history. Only audio/event aggregates have a verified /full
 * route; audio/recording belongs to a different official recording pipeline. */
final class OfficialLifelogInventory {
 private static void require(boolean ok,String code){MaterialWire.require(ok,code);}
 static final class Request {
  final String date,timezone,path;
  private Request(String date,String timezone){
   require(date!=null&&date.matches("[0-9]{4}-[0-9]{2}-[0-9]{2}"),"LIFELOG_DATE_INVALID");try{LocalDate.parse(date);}catch(DateTimeParseException invalid){throw new IllegalArgumentException("LIFELOG_DATE_INVALID");}
   if(timezone!=null)zone(timezone);this.date=date;this.timezone=timezone;
   try{path="/lifelog/api/v1/events?date="+date+(timezone==null?"":"&timezone="+URLEncoder.encode(timezone,"UTF-8"));}catch(java.io.UnsupportedEncodingException impossible){throw new AssertionError(impossible);}
  }
  static Request day(String date,String timezone){require(timezone!=null,"LIFELOG_TIMEZONE_REQUIRED");return new Request(date,timezone);}
  static Request cached(String url){
   try{URI u=new URI(url);require("https".equals(u.getScheme())&&"xr-api-p.rayneo.cn".equals(u.getHost())&&(u.getPort()==-1||u.getPort()==443)&&u.getRawUserInfo()==null&&u.getRawFragment()==null&&"/lifelog/api/v1/events".equals(u.getRawPath())&&u.getRawQuery()!=null&&url.length()<=2048,"LIFELOG_LIST_URL_INVALID");Map<String,String> query=new HashMap<>();
    for(String pair:u.getRawQuery().split("&",-1)){String[] parts=pair.split("=",2);require(parts.length==2,"LIFELOG_LIST_QUERY_INVALID");String key=URLDecoder.decode(parts[0],"UTF-8"),value=URLDecoder.decode(parts[1],"UTF-8");require((key.equals("date")||key.equals("timezone"))&&query.put(key,value)==null,"LIFELOG_LIST_QUERY_INVALID");}
    require(query.containsKey("date"),"LIFELOG_DATE_INVALID");return new Request(query.get("date"),query.get("timezone"));
   }catch(URISyntaxException|java.io.UnsupportedEncodingException invalid){throw new IllegalArgumentException("LIFELOG_LIST_URL_INVALID");}
  }
 }
 private static String zone(Object value){String s=MaterialWire.text(value,80,false);try{ZoneId.of(s);}catch(DateTimeException invalid){throw new IllegalArgumentException("LIFELOG_TIMEZONE_INVALID");}return s;}
 static final class Page {
  final String date,timezone;final Map<String,Set<String>> events;final int recordingEntries,otherEntries;
  private Page(String date,String timezone,Map<String,Set<String>> events,int recordings,int other){this.date=date;this.timezone=timezone;Map<String,Set<String>> copy=new TreeMap<>();for(Map.Entry<String,Set<String>> e:events.entrySet())copy.put(e.getKey(),Collections.unmodifiableSet(new TreeSet<>(e.getValue())));this.events=Collections.unmodifiableMap(copy);recordingEntries=recordings;otherEntries=other;}
  boolean sameMembership(Page other){return date.equals(other.date)&&timezone.equals(other.timezone)&&events.equals(other.events)&&recordingEntries==other.recordingEntries&&otherEntries==other.otherEntries;}
 }
 private static String id(Object raw){String id=MaterialWire.text(raw,128,false);require(id.matches("[A-Za-z0-9_.:-]+"),"LIFELOG_ID_INVALID");return id;}
 static Page read(Request request,byte[] response){
  require(request!=null,"LIFELOG_LIST_REQUEST_REQUIRED");Map<String,Object> root=WireJson.map(WireJson.read(OfficialLifelogJson.read(response).canonical));require(Long.valueOf(0).equals(root.get("code")),"LIFELOG_RESPONSE_REJECTED");Map<String,Object> data=WireJson.map(root.get("data"));require(request.date.equals(data.get("date")),"LIFELOG_LIST_DATE_MISMATCH");String timezone=zone(data.get("timezone"));require(request.timezone==null||request.timezone.equals(timezone),"LIFELOG_LIST_TIMEZONE_MISMATCH");
  // No pagination contract has been proven. Do not silently publish a known
  // partial day as a completed inventory scan if a future server adds one.
  for(String key:new String[]{"hasMore","hasNext","hasNextPage"})if(data.containsKey(key))require(Boolean.FALSE.equals(data.get(key)),"LIFELOG_LIST_PAGINATION_UNSUPPORTED");
  for(String key:new String[]{"nextCursor","nextPage","nextToken","nextId"})if(data.get(key)!=null)require("".equals(data.get(key)),"LIFELOG_LIST_PAGINATION_UNSUPPORTED");
  List<Object> rows=WireJson.list(data.get("events"));require(rows.size()<=256,"LIFELOG_LIST_BUDGET");Set<String> seen=new HashSet<>();Map<String,Set<String>> full=new TreeMap<>();int recordings=0,other=0;
  for(Object raw:rows){Map<String,Object> row=WireJson.map(raw);String event=id(row.get("id"));require(seen.add(event),"LIFELOG_LIST_DUPLICATE");String flow=MaterialWire.text(row.get("flowType"),40,false),kind=MaterialWire.text(row.get("eventType"),40,false);
   require(!Boolean.TRUE.equals(row.get("deleted"))&&!Boolean.TRUE.equals(row.get("isDeleted"))&&row.get("deletedAt")==null,"LIFELOG_LIST_DELETION_UNSUPPORTED");
   if("audio".equals(kind)&&"recording".equals(flow)){recordings++;continue;}
   if(!"audio".equals(kind)||!"event".equals(flow)){other++;continue;}
   require(event.matches("[A-Za-z0-9_-]{1,80}"),"LIFELOG_EVENT_ID_INVALID");List<Object> links=WireJson.list(row.get("transcriptionInfos"));require(!links.isEmpty()&&links.size()<=256,"LIFELOG_LIST_SOURCE_BUDGET");Set<String> refs=new TreeSet<>();
   for(Object link:links){Map<String,Object> v=WireJson.map(link);String ref=id(v.get("sourceType"))+"/"+id(v.get("sourceId"));require(refs.add(ref),"LIFELOG_LIST_SOURCE_DUPLICATE");}full.put(event,refs);
  }
  return new Page(request.date,timezone,full,recordings,other);
 }
}
