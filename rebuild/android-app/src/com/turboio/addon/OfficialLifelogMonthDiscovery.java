package com.turboio.addon;
import java.io.*;import java.time.*;import java.util.*;

/** A single authenticated month is a date hint, never a source or deletion feed. */
final class OfficialLifelogMonthDiscovery {
 interface Login {OfficialAccountBinding current()throws Exception;}
 interface Guard {void check()throws Exception;}
 interface Transport {byte[] calendar(OfficialLifelogCalendarRequest request)throws Exception;}
 static final class Snapshot {
  final String account,month,timezone,requestBodyHash;
  final List<String> dates;
  final int totalDays;
  private Snapshot(String account,OfficialLifelogCalendarRequest request,OfficialLifelogCalendar.Page page){
   this.account=account;month=request.month().toString();timezone="Asia/Shanghai";requestBodyHash=TaskWire.hash(request.body());
   dates=Collections.unmodifiableList(new ArrayList<>(page.dates));totalDays=page.totalDays;
  }
  List<OfficialLifelogInventory.Request> select(List<String> selected){
   MaterialWire.require(selected!=null&&!selected.isEmpty()&&selected.size()<=7,"LIFELOG_DISCOVERY_DAYS_INVALID");
   List<OfficialLifelogInventory.Request> result=new ArrayList<>();Set<String> unique=new HashSet<>();
   for(String date:selected){MaterialWire.require(date!=null&&dates.contains(date)&&unique.add(date),"LIFELOG_DISCOVERY_DAYS_INVALID");result.add(OfficialLifelogInventory.Request.day(date,timezone));}
   return Collections.unmodifiableList(result);
  }
 }
 private static void admit(String account,Login login,Guard guard,long deadline)throws Exception{
  guard.check();if(Thread.currentThread().isInterrupted())throw new InterruptedIOException("MATERIAL_PAUSED");
  MaterialWire.require(System.nanoTime()<=deadline,"OFFICIAL_SOURCE_TIMEOUT");
  OfficialAccountBinding current=login.current();MaterialWire.require(current!=null&&account.equals(current.binding),"OFFICIAL_ACCOUNT_CHANGED");guard.check();
 }
 static Snapshot read(String account,OfficialLifelogCalendarRequest request,String timezone,Login login,Guard guard,Transport transport)throws Exception{
  MaterialWire.require(account!=null&&account.matches("[a-f0-9]{64}")&&request!=null&&login!=null&&guard!=null&&transport!=null,"LIFELOG_CALENDAR_REQUEST_REQUIRED");
  MaterialWire.require("Asia/Shanghai".equals(timezone),"LIFELOG_CALENDAR_TIMEZONE_UNSUPPORTED");
  long deadline=System.nanoTime()+35000000000L;admit(account,login,guard,deadline);
  byte[] raw=transport.calendar(request);admit(account,login,guard,deadline);
  OfficialLifelogCalendar.Page page=OfficialLifelogCalendar.read(request,raw);admit(account,login,guard,deadline);
  return new Snapshot(account,request,page);
 }
}
