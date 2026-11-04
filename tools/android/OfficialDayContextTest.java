package com.turboio.addon;
import java.io.*;import java.nio.file.*;import java.util.*;

/** The official response is the only unknown boundary; retained data is account-local. */
final class OfficialDayContextTest {
 static int checks;
 static void yes(boolean value){checks++;if(!value)throw new AssertionError("context check "+checks);}
 public static void main(String[] args)throws Exception{
  String account="a".repeat(64);OfficialLifelogInventory.Request day=OfficialLifelogInventory.Request.day("2026-10-30","Asia/Shanghai");long start=1793318400000L;
  Map<String,Object> stay=WireJson.object("id","stay-1","eventType","stayPoint","startTime",Long.toString(start),"endTime",start+60000,"title","合成停留","poiName","合成地点","poiAddress","合成地址");
  Map<String,Object> plan=WireJson.object("id","plan-1","eventType","schedule","startTime",start,"endTime",start+120000,"title","合成日历","content","只是计划","location","合成会议室");
  Map<String,Object> recording=WireJson.object("eventType","audio","audioUrl","must-not-upload","content","逐字内容另走文字同步");
  Map<String,Object> point=WireJson.object("timestamp",start,"latitude",new java.math.BigDecimal("22.1234567"),"longitude",new java.math.BigDecimal("113.7654321"),"pointType","rawPoint","accuracy",5);
  Map<String,Object> data=WireJson.object("date",day.date,"events",Arrays.asList(stay,plan,recording),"trailPoints",Arrays.asList(point));
  Map<String,Object> source=OfficialDayContext.read(account,day,WireJson.bytes(WireJson.object("code",0,"data",data)));
  yes(WireJson.list(source.get("events")).size()==2);yes(WireJson.list(source.get("trail")).size()==1);
  yes(MaterialWire.number(WireJson.map(WireJson.list(source.get("trail")).get(0)).get("lat_e6"))==22123457);
  yes(!new String(WireJson.bytes(source),java.nio.charset.StandardCharsets.UTF_8).contains("must-not-upload"));yes(!source.containsKey("steps")&&!source.containsKey("calories"));
  Path files=Files.createTempDirectory("io-original-context-");try{
   OfficialDayContext.retain(files.toFile(),account,source,()->account);yes(OfficialDayContext.saved(files.toFile(),account,day.date,day.timezone).equals(source));
   yes(OfficialDayContext.saved(files.toFile(),"b".repeat(64),day.date,day.timezone)==null);
   data.put("events",Collections.emptyList());data.put("trailPoints",Collections.emptyList());
   Map<String,Object> empty=OfficialDayContext.read(account,day,WireJson.bytes(WireJson.object("code",0,"data",data)));OfficialDayContext.retain(files.toFile(),account,empty,()->account);yes(WireJson.list(OfficialDayContext.saved(files.toFile(),account,day.date,day.timezone).get("trail")).isEmpty());
   data.put("date","2026-10-29");boolean rejected=false;try{OfficialDayContext.read(account,day,WireJson.bytes(WireJson.object("code",0,"data",data)));}catch(IllegalArgumentException expected){rejected=true;}yes(rejected);
  }finally{try(java.util.stream.Stream<Path> paths=Files.walk(files)){for(Path p:(Iterable<Path>)paths.sorted(Comparator.reverseOrder())::iterator)Files.delete(p);}}
  System.out.println("Official existing day context: "+checks+" checks passed");
 }
}
