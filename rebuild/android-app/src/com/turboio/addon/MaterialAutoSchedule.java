package com.turboio.addon;
import java.io.*;import java.time.*;import java.util.*;

/** Durable minute cadence and bounded date catch-up; contains no credentials. */
final class MaterialAutoSchedule implements AutoCloseable {
 static final class Plan {
  final List<OfficialLifelogInventory.Request> days;final String through,zone;final long attempt;
  Plan(List<OfficialLifelogInventory.Request> days,String through,String zone,long attempt){this.days=days;this.through=through;this.zone=zone;this.attempt=attempt;}
 }
 private final boolean recentOnly;private final AtomicDocument document;private final String binding,account;private Map<String,Object> state;
 MaterialAutoSchedule(File files,MaterialConfig config)throws IOException{this(files,config,false);}
 MaterialAutoSchedule(File files,MaterialConfig config,boolean recentOnly)throws IOException{this.recentOnly=recentOnly;
  binding=config.connection.binding();account=config.account;File file=new File(MaterialSyncSession.accountFiles(files,config),(recentOnly?"daily-auto-sync/":"auto-sync/")+binding+"/state.json");document=new AtomicDocument(file,16384);
  try{if(new File(file+".partial").exists())throw new IOException("MATERIAL_AUTO_UNCERTAIN");Object raw=document.read();state=raw==null?WireJson.object("schema",1,"binding",binding,"account",account,"zone","","through","","attempt",0,"next",0,"failures",0):WireJson.map(raw);
   BoundedJson.keys(state,"schema","binding","account","zone","through","attempt","next","failures");MaterialWire.require(MaterialWire.positive(state.get("schema"))==1&&binding.equals(state.get("binding"))&&account.equals(state.get("account")),"MATERIAL_AUTO_INVALID");MaterialWire.number(state.get("attempt"));MaterialWire.number(state.get("next"));MaterialWire.require(MaterialWire.number(state.get("failures"))<=5,"MATERIAL_AUTO_INVALID");String zone=MaterialWire.text(state.get("zone"),80,true),day=MaterialWire.text(state.get("through"),10,true);if(!zone.isEmpty())ZoneId.of(zone);if(!day.isEmpty())LocalDate.parse(day);
  }catch(IOException|RuntimeException error){document.close();throw error;}
 }
 Plan begin(long now,String zone,boolean networkRecovered)throws IOException{
  MaterialWire.require(now>0,"MATERIAL_CLOCK_INVALID");long previous=MaterialWire.number(state.get("attempt")),due=MaterialWire.number(state.get("next"));
  if(now>=previous&&now<due&&(!networkRecovered||MaterialWire.number(state.get("failures"))==0||now-previous<30000))return null;
  LocalDate today=Instant.ofEpochMilli(now).atZone(ZoneId.of(zone)).toLocalDate(),yesterday=today.minusDays(1);String saved=(String)state.get("through");
  LocalDate cursor=recentOnly||saved.isEmpty()||!zone.equals(state.get("zone"))?yesterday:LocalDate.parse(saved).plusDays(1);if(cursor.isAfter(yesterday))cursor=yesterday;
  List<OfficialLifelogInventory.Request> days=Arrays.asList(OfficialLifelogInventory.Request.day(today.toString(),zone),OfficialLifelogInventory.Request.day(cursor.toString(),zone));
  Map<String,Object> next=WireJson.map(WireJson.copy(state));next.put("attempt",now);next.put("next",Math.addExact(now,60000));document.save(next);state=next;return new Plan(days,cursor.toString(),zone,now);
 }
 void finish(Plan plan,long now,boolean success)throws IOException{finish(plan,now,success,false);}
 // A bounded batch making durable progress is healthy, but has not finished its day.
 void finish(Plan plan,long now,boolean success,boolean progressed)throws IOException{
  MaterialWire.require(plan!=null&&plan.attempt==MaterialWire.number(state.get("attempt"))&&now>0,"MATERIAL_AUTO_STALE");Map<String,Object> next=WireJson.map(WireJson.copy(state));long failures=success||progressed?0:Math.min(5,MaterialWire.number(state.get("failures"))+1);
  next.put("failures",failures);next.put("next",Math.addExact(now,success||progressed?60000:Math.min(900000,60000L<<(failures-1))));
  if(success){next.put("through",plan.through);next.put("zone",plan.zone);}document.save(next);state=next;
 }
 public void close()throws IOException{document.close();}
}
