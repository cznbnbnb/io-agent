package com.turboio.addon;
import java.io.File;import java.nio.charset.StandardCharsets;import java.util.*;
/** Synthetic official list/full shapes from lifelog-detail-shape-2026-10-26.json. */
public final class OfficialLifelogInsightTest {
 static int checks;static void yes(boolean v){checks++;if(!v)throw new AssertionError("Insight "+checks);}
 static final String A="a".repeat(64),B="b".repeat(64);
 static OfficialLifelogInventory.Request day(){return OfficialLifelogInventory.Request.day("2026-10-26","Asia/Shanghai");}
 static byte[] utf8(String s){return s.getBytes(StandardCharsets.UTF_8);}
 static String row(String id,String summary,String outline){return "{\"id\":\""+id+"\",\"eventType\":\"audio\",\"flowType\":\"event\",\"title\":\"产品评审\",\"startTime\":\"1792975740000\",\"endTime\":\"1792979520000\",\"summaryContent\":"+summary+",\"emotion\":\"平静\",\"outline\":"+outline+",\"participants\":[],\"transcriptionInfos\":[{\"sourceType\":\"conversation\",\"sourceId\":\"s1\"},{\"sourceType\":\"conversation\",\"sourceId\":\"s2\"}]}";}
 static final String TRAIL="[{\"timestamp\":1792975800000,\"latitude\":39.99123,\"longitude\":116.48021,\"accuracy\":12.5,\"altitude\":40.1,\"speed\":0.0,\"bearing\":0.0,\"pointType\":\"stay\",\"isFirst\":true,\"hiddenPointCount\":null,\"stayStartTime\":1792975620000,\"stayEndTime\":1792976700000,\"stayRadius\":31.4,\"sourceEventId\":\"700000000000000001\",\"timezone\":\"Asia/Shanghai\"},"
  +"{\"timestamp\":1792970000000,\"latitude\":39.9,\"longitude\":116.4,\"accuracy\":20,\"pointType\":\"move\",\"stayStartTime\":null,\"stayEndTime\":null,\"stayRadius\":null,\"sourceEventId\":null},"
  +"{\"timestamp\":1792980000000,\"latitude\":91.5,\"longitude\":116.4,\"pointType\":\"move\"}]";
 static byte[] list(String events,String trail){return utf8("{\"code\":0,\"msg\":\"success\",\"data\":{\"date\":\"2026-10-26\",\"timezone\":\"Asia/Shanghai\",\"events\":["+events+"],\"trailPoints\":"+trail+"}}");}
 public static void main(String[] args)throws Exception{
  String outline="[{\"timestamp\":1792976100000,\"content\":\"讨论验收标准\"},{\"timestamp\":1792975800000,\"content\":\"决定拆成两期\"},{\"timestamp\":\"bad\",\"content\":\"x\"},{\"timestamp\":1792976400000,\"content\":\"  \"}]";
  OfficialLifelogInsight.Day d=OfficialLifelogInsight.list(day(),list(row("700000000000000001","\"列表里的总结\"","null"),TRAIL));
  yes(d!=null&&d.events.size()==1&&d.events.get(0).summary.equals("列表里的总结")&&d.events.get(0).outline.isEmpty()&&d.events.get(0).refs.size()==2);
  // Out-of-range points are dropped; the rest are ordered by time and keep their stay window.
  yes(d.trail.size()==2&&d.trail.get(0).at==1792970000000L&&!d.trail.get(0).stay()&&d.trail.get(1).stay()&&d.trail.get(1).radius==31&&d.trail.get(1).latE6==39991230&&d.trail.get(1).eventId.equals("700000000000000001"));
  // Detail: outline sorted, invalid/blank topics skipped, list summary refined.
  byte[] full=utf8("{\"code\":0,\"msg\":\"success\",\"data\":"+row("700000000000000001","\"整场总结\\n第二段\"",outline)+"}");
  OfficialLifelogInsight.Event e=OfficialLifelogInsight.full("700000000000000001",WireJson.bytes(WireJson.read(full)));
  yes(e!=null&&e.outline.size()==2&&e.outline.get(0).text.equals("决定拆成两期")&&e.summary.equals("整场总结\n第二段"));
  yes(OfficialLifelogInsight.full("other",WireJson.bytes(WireJson.read(full)))==null);
  OfficialLifelogInsight.Event refined=d.events.get(0).refine(e);yes(refined.summary.equals("整场总结\n第二段")&&refined.outline.size()==2);
  OfficialLifelogInsight.Event empty=new OfficialLifelogInsight.Event("700000000000000001","","","",1,2,new ArrayList<>(),new TreeSet<>());yes(d.events.get(0).refine(empty).summary.equals("列表里的总结"));
  // Unrecognised shapes never throw.
  yes(OfficialLifelogInsight.list(day(),utf8("{\"code\":1,\"data\":{}}"))==null);
  yes(OfficialLifelogInsight.list(day(),utf8("not json"))==null);
  yes(OfficialLifelogInsight.list(OfficialLifelogInventory.Request.day("2026-10-25","Asia/Shanghai"),list("","[]"))==null);
  OfficialLifelogInsight.Day noTrail=OfficialLifelogInsight.list(day(),utf8("{\"code\":0,\"data\":{\"date\":\"2026-10-26\",\"timezone\":\"Asia/Shanghai\",\"events\":[{\"id\":\"x\"}]}}"));yes(noTrail!=null&&noTrail.events.isEmpty()&&noTrail.trail.isEmpty());
  // Store: persist, reload, merge without loss, account binding.
  File dir=new File(args[0]);MaterialLocalLibrary.Guard guard=()->A;
  OfficialLifelogInsight.Day first=new OfficialLifelogInsight.Day(d.date,d.timezone,Arrays.asList(refined),d.trail);
  try(LifelogInsightStore store=new LifelogInsightStore(dir,A)){store.record(Arrays.asList(first),guard);}
  try(LifelogInsightStore store=new LifelogInsightStore(dir,A)){LifelogInsightStore.Snapshot s=store.snapshot();OfficialLifelogInsight.Day back=s.day("2026-10-26","Asia/Shanghai");
   yes(back!=null&&back.events.get(0).summary.equals("整场总结\n第二段")&&back.events.get(0).outline.get(1).at==1792976100000L&&back.trail.size()==2&&back.trail.get(1).stayEnd==1792976700000L);
   String material=OfficialLifelogSnapshot.materialId(A,"conversation","s2");yes(s.eventFor(material)!=null&&s.eventFor(OfficialLifelogSnapshot.materialId(B,"conversation","s2"))==null);
   yes(s.trail(1792976000000L,1792976100000L).size()==1&&s.trail(1792960000000L,1792965000000L).isEmpty());
   // An empty later read keeps both events and trail.
   store.record(Arrays.asList(new OfficialLifelogInsight.Day("2026-10-26","Asia/Shanghai",new ArrayList<>(),new ArrayList<>())),guard);back=store.snapshot().day("2026-10-26","Asia/Shanghai");yes(back.events.size()==1&&back.trail.size()==2);
   boolean refused=false;try{store.record(Arrays.asList(first),()->B);}catch(IllegalArgumentException changed){refused="OFFICIAL_ACCOUNT_CHANGED".equals(changed.getMessage());}yes(refused);
  }
  try(LifelogInsightStore store=new LifelogInsightStore(dir,A)){
   OfficialLifelogInsight.Event next=new OfficialLifelogInsight.Event("700000000000000002","新分组","新总结","",refined.start,refined.end,refined.outline,refined.refs);
   store.record(Arrays.asList(new OfficialLifelogInsight.Day("2026-10-27","Asia/Shanghai",Arrays.asList(next),new ArrayList<>())),guard);String material=OfficialLifelogSnapshot.materialId(A,"conversation","s2");
   yes(store.snapshot().eventFor(material,"2026-10-26","Asia/Shanghai").id.equals(refined.id));yes(store.snapshot().eventFor(material,"2026-10-27","Asia/Shanghai").id.equals(next.id));yes(store.snapshot().eventFor(material,"2026-10-28","Asia/Shanghai")==null);
   store.record(Arrays.asList(new OfficialLifelogInsight.Day("2026-10-26","Asia/Shanghai",Arrays.asList(next),new ArrayList<>())),guard);yes(store.snapshot().day("2026-10-26","Asia/Shanghai").events.size()==1&&store.snapshot().eventFor(material,"2026-10-26","Asia/Shanghai").id.equals(next.id));
  }
  boolean bound=false;File copy=new File(dir,"material-accounts/"+B+"/local-library");copy.mkdirs();java.nio.file.Files.copy(new File(dir,"material-accounts/"+A+"/local-library/insights.json").toPath(),new File(copy,"insights.json").toPath());
  try(LifelogInsightStore other=new LifelogInsightStore(dir,B)){}catch(IllegalArgumentException wrong){bound="MATERIAL_LOCAL_BINDING".equals(wrong.getMessage());}yes(bound);
  System.out.println("Official lifelog insight: "+checks+" assertions passed");
 }
}
