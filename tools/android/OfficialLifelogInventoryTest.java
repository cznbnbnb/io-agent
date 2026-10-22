package com.turboio.addon;
import java.util.*;
public final class OfficialLifelogInventoryTest {
 static int checks;static void yes(boolean v){checks++;if(!v)throw new AssertionError("Inventory "+checks);}
 interface Work{void run();}static void reject(String code,Work work){checks++;try{work.run();}catch(IllegalArgumentException e){if(code.equals(e.getMessage()))return;throw e;}throw new AssertionError("Expected "+code);}
 static Map<String,Object> event(String id,String flow){return WireJson.object("id",id,"eventType","audio","flowType",flow,"deletable",true,"transcriptionInfos",Arrays.asList(WireJson.object("sourceType","CONVERSATION","sourceId","synthetic-source")));}
 static Map<String,Object> fixture(){return WireJson.object("code",0,"data",WireJson.object("date","2026-10-21","timezone","Asia/Shanghai","events",new ArrayList<>(Arrays.asList(event("synthetic-event","event"),event("synthetic-recording","recording")))));}
 static Map<String,Object> data(Map<String,Object> root){return WireJson.map(root.get("data"));}
 static OfficialLifelogInventory.Page read(Map<String,Object> root){return OfficialLifelogInventory.read(OfficialLifelogInventory.Request.day("2026-10-21","Asia/Shanghai"),WireJson.bytes(root));}
 public static void main(String[] args){
  OfficialLifelogInventory.Request q=OfficialLifelogInventory.Request.cached("https://xr-api-p.rayneo.cn/lifelog/api/v1/events?timezone=Asia%2FShanghai&date=2026-10-21");yes(q.path.equals("/lifelog/api/v1/events?date=2026-10-21&timezone=Asia%2FShanghai"));yes(q.date.equals("2026-10-21"));
  yes(OfficialLifelogInventory.Request.cached("https://xr-api-p.rayneo.cn/lifelog/api/v1/events?date=2026-10-21").timezone==null);
  for(String u:Arrays.asList("http://xr-api-p.rayneo.cn/lifelog/api/v1/events?date=2026-10-21","https://xr-api-p.rayneo.cn.evil.invalid/lifelog/api/v1/events?date=2026-10-21","https://x@xr-api-p.rayneo.cn/lifelog/api/v1/events?date=2026-10-21","https://xr-api-p.rayneo.cn/lifelog/api/v1/events?date=2026-10-21#x","https://xr-api-p.rayneo.cn/lifelog/api/v1/events/x?date=2026-10-21"))reject("LIFELOG_LIST_URL_INVALID",()->OfficialLifelogInventory.Request.cached(u));
  for(String suffix:Arrays.asList("date=2026-10-21&date=2026-10-22","date=2026-10-21&cursor=abc","date=2026-10-21&","date"))reject("LIFELOG_LIST_QUERY_INVALID",()->OfficialLifelogInventory.Request.cached("https://xr-api-p.rayneo.cn/lifelog/api/v1/events?"+suffix));
  for(String date:Arrays.asList("2026-02-30","2026-1-1","bad"))reject("LIFELOG_DATE_INVALID",()->OfficialLifelogInventory.Request.day(date,"Asia/Shanghai"));reject("LIFELOG_TIMEZONE_INVALID",()->OfficialLifelogInventory.Request.day("2026-10-21","Bad/Zone"));reject("LIFELOG_TIMEZONE_REQUIRED",()->OfficialLifelogInventory.Request.day("2026-10-21",null));
  Map<String,Object> fixture=fixture();OfficialLifelogInventory.Page page=read(fixture);yes(page.events.size()==1&&page.events.get("synthetic-event").equals(Collections.singleton("CONVERSATION/synthetic-source")));yes(page.recordingEntries==1&&page.otherEntries==0);yes(page.sameMembership(read(fixture)));
  Map<String,Object> changed=fixture();WireJson.map(WireJson.list(data(changed).get("events")).get(0)).put("title","合成显示标题变化");yes(page.sameMembership(read(changed)));WireJson.map(WireJson.list(data(changed).get("events")).get(0)).put("id","different");yes(!page.sameMembership(read(changed)));
  Map<String,Object> empty=fixture();data(empty).put("events",new ArrayList<>());yes(read(empty).events.isEmpty()&&read(empty).recordingEntries==0);
  Map<String,Object> unknown=fixture();WireJson.list(data(unknown).get("events")).add(event("unknown","future_flow"));yes(read(unknown).otherEntries==1&&read(unknown).events.size()==1);
  for(String key:Arrays.asList("hasMore","hasNext","hasNextPage","nextCursor","nextPage","nextToken","nextId")){Map<String,Object> f=fixture();data(f).put(key,key.startsWith("has")?true:"next");reject("LIFELOG_LIST_PAGINATION_UNSUPPORTED",()->read(f));}
  Map<String,Object> date=fixture();data(date).put("date","2026-10-20");reject("LIFELOG_LIST_DATE_MISMATCH",()->read(date));Map<String,Object> timezone=fixture();data(timezone).put("timezone","UTC");reject("LIFELOG_LIST_TIMEZONE_MISMATCH",()->read(timezone));
  Map<String,Object> error=fixture();error.put("code",1008001L);reject("LIFELOG_RESPONSE_REJECTED",()->read(error));
  for(String key:Arrays.asList("deleted","isDeleted","deletedAt")){Map<String,Object> f=fixture();WireJson.map(WireJson.list(data(f).get("events")).get(0)).put(key,key.equals("deletedAt")?"2026-10-21":true);reject("LIFELOG_LIST_DELETION_UNSUPPORTED",()->read(f));}
  Map<String,Object> duplicate=fixture();WireJson.list(data(duplicate).get("events")).add(event("synthetic-event","event"));reject("LIFELOG_LIST_DUPLICATE",()->read(duplicate));
  Map<String,Object> links=fixture();Map<String,Object> row=WireJson.map(WireJson.list(data(links).get("events")).get(0));row.put("transcriptionInfos",Arrays.asList(WireJson.object("sourceType","CONVERSATION","sourceId","a"),WireJson.object("sourceType","CONVERSATION","sourceId","a")));reject("LIFELOG_LIST_SOURCE_DUPLICATE",()->read(links));
  Map<String,Object> noLinks=fixture();WireJson.map(WireJson.list(data(noLinks).get("events")).get(0)).put("transcriptionInfos",new ArrayList<>());reject("LIFELOG_LIST_SOURCE_BUDGET",()->read(noLinks));
  Map<String,Object> big=fixture();List<Object> many=new ArrayList<>();for(int i=0;i<257;i++)many.add(event("e"+i,"event"));data(big).put("events",many);reject("LIFELOG_LIST_BUDGET",()->read(big));
  System.out.println("Official lifelog inventory: "+checks+" assertions passed");
 }
}
