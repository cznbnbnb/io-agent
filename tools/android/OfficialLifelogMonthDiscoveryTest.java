package com.turboio.addon;

import java.io.*;
import java.time.YearMonth;
import java.util.*;

/** Synthetic accounts/responses and in-memory transport only. */
final class OfficialLifelogMonthDiscoveryTest {
 private static int checks;
 private interface Work {void run()throws Exception;}
 private static void yes(boolean ok){checks++;if(!ok)throw new AssertionError("Month discovery assertion "+checks);}
 private static void denied(String code,Work work)throws Exception{try{work.run();throw new AssertionError("Expected "+code);}catch(IOException|IllegalArgumentException e){yes(code.equals(e.getMessage()));}}
 private static void immutable(Work work)throws Exception{try{work.run();throw new AssertionError("Mutable result");}catch(UnsupportedOperationException expected){yes(true);}}
 private static OfficialAccountBinding account(long id){return OfficialAccountBinding.read(WireJson.bytes(WireJson.object("accountId",id,"domain","synthetic-calendar-test")));}
 private static final OfficialAccountBinding OWNER=account(47),OTHER=account(48);
 private static final OfficialLifelogCalendarRequest REQUEST=OfficialLifelogCalendarRequest.month("2026-10");
 private static byte[] response(String month,boolean all){YearMonth ym=YearMonth.parse(month);List<Object> rows=new ArrayList<>();for(int day=1;day<=ym.lengthOfMonth();day++)rows.add(WireJson.object("date",ym.atDay(day).toString(),"hasLog",all||day==1||day==10||day==20));return WireJson.bytes(WireJson.object("code",0L,"data",WireJson.object("dailyLifelogList",rows)));}
 private static final class Wire implements OfficialLifelogMonthDiscovery.Login,OfficialLifelogMonthDiscovery.Guard,OfficialLifelogMonthDiscovery.Transport {
  int logins,guards,transfers,changeAt,nullAt,cancelAt;boolean offline,interruptInTransfer,loginFail;byte[] raw=response("2026-10",false);OfficialLifelogCalendarRequest sent;final List<String> trace=new ArrayList<>();
  public OfficialAccountBinding current()throws Exception{trace.add("L"+(++logins));if(loginFail)throw new IOException("SYNTHETIC_LOGIN_UNAVAILABLE");return logins==nullAt?null:logins==changeAt?OTHER:OWNER;}
  public void check()throws Exception{trace.add("G"+(++guards));if(guards==cancelAt)throw new IOException("SYNTHETIC_CANCELLED");}
  public byte[] calendar(OfficialLifelogCalendarRequest request)throws Exception{trace.add("T"+(++transfers));sent=request;if(offline)throw new IOException("SYNTHETIC_OFFLINE");if(interruptInTransfer)Thread.currentThread().interrupt();return raw;}
 }
 private static OfficialLifelogMonthDiscovery.Snapshot read(Wire wire)throws Exception{return OfficialLifelogMonthDiscovery.read(OWNER.binding,REQUEST,"Asia/Shanghai",wire,wire,wire);}
 public static void main(String[] args)throws Exception{
  Wire good=new Wire();OfficialLifelogMonthDiscovery.Snapshot snap=read(good);
  yes(good.transfers==1&&good.logins==3&&good.guards==6&&good.sent==REQUEST);
  yes(good.trace.equals(Arrays.asList("G1","L1","G2","T1","G3","L2","G4","G5","L3","G6")));
  yes(snap.account.equals(OWNER.binding)&&!snap.account.equals(OTHER.binding));yes("2026-10".equals(snap.month));yes("Asia/Shanghai".equals(snap.timezone));yes(snap.totalDays==31);
  // Independently precomputed SHA-256 of the exact 47-byte synthetic month body.
  yes("3f5e75ff8e087ce6fd7b7814b1f6e128bf98ef6d143b75ae4a8b0a7620e1df66".equals(snap.requestBodyHash));
  yes(snap.dates.equals(Arrays.asList("2026-10-01","2026-10-10","2026-10-20")));immutable(()->snap.dates.clear());immutable(()->snap.dates.set(0,"2026-10-02"));
  Arrays.fill(good.raw,(byte)0);byte[] body=REQUEST.body();Arrays.fill(body,(byte)0);yes(snap.dates.size()==3&&snap.month.equals("2026-10"));yes(snap.requestBodyHash.equals("3f5e75ff8e087ce6fd7b7814b1f6e128bf98ef6d143b75ae4a8b0a7620e1df66"));
  List<String> selected=new ArrayList<>(Arrays.asList("2026-10-20","2026-10-01"));List<OfficialLifelogInventory.Request> days=snap.select(selected);selected.clear();yes(days.size()==2&&days.get(0).date.equals("2026-10-20")&&days.get(1).date.equals("2026-10-01"));
  for(OfficialLifelogInventory.Request day:days){yes(day.timezone.equals("Asia/Shanghai"));yes(day.path.equals("/lifelog/api/v1/events?date="+day.date+"&timezone=Asia%2FShanghai"));}immutable(()->days.clear());immutable(()->days.set(0,days.get(1)));
  for(List<String> selection:Arrays.<List<String>>asList(null,Collections.emptyList(),Arrays.asList((String)null),Arrays.asList("2026-10-02"),Arrays.asList("2026-09-01"),Arrays.asList("2026-10-01","2026-10-01"),Arrays.asList("2026-10-1"),Arrays.asList("2026-10-01","2026-10-20","2026-10-99")))denied("LIFELOG_DISCOVERY_DAYS_INVALID",()->snap.select(selection));
  Wire every=new Wire();every.raw=response("2026-10",true);OfficialLifelogMonthDiscovery.Snapshot full=read(every);List<String> seven=new ArrayList<>(full.dates.subList(0,7));yes(full.select(seven).size()==7);seven.add(full.dates.get(7));denied("LIFELOG_DISCOVERY_DAYS_INVALID",()->full.select(seven));yes(every.transfers==1);
  for(int phase=1;phase<=3;phase++){
   Wire changed=new Wire();changed.changeAt=phase;denied("OFFICIAL_ACCOUNT_CHANGED",()->read(changed));yes(changed.logins==phase&&changed.transfers==(phase==1?0:1));
   Wire absent=new Wire();absent.nullAt=phase;denied("OFFICIAL_ACCOUNT_CHANGED",()->read(absent));yes(absent.logins==phase&&absent.transfers==(phase==1?0:1));
  }
  for(int phase=1;phase<=6;phase++){Wire cancel=new Wire();cancel.cancelAt=phase;denied("SYNTHETIC_CANCELLED",()->read(cancel));yes(cancel.guards==phase&&cancel.transfers==(phase<=2?0:1));}
  for(String zone:new String[]{null,"","UTC","Asia/Tokyo","Asia/Shanghai ","asia/shanghai"}){Wire wire=new Wire();denied("LIFELOG_CALENDAR_TIMEZONE_UNSUPPORTED",()->OfficialLifelogMonthDiscovery.read(OWNER.binding,REQUEST,zone,wire,wire,wire));yes(wire.transfers==0&&wire.guards==0&&wire.logins==0);}
  for(String month:new String[]{null,"2026-00","2026-13","2026-1","1969-12","10000-01","2026-10-01"}){Wire wire=new Wire();denied("LIFELOG_CALENDAR_MONTH_INVALID",()->OfficialLifelogMonthDiscovery.read(OWNER.binding,OfficialLifelogCalendarRequest.month(month),"Asia/Shanghai",wire,wire,wire));yes(wire.transfers==0&&wire.guards==0);}
  for(String binding:new String[]{null,"","unbound",OWNER.binding.toUpperCase(Locale.ROOT),OWNER.binding+"0"}){Wire wire=new Wire();denied("LIFELOG_CALENDAR_REQUEST_REQUIRED",()->OfficialLifelogMonthDiscovery.read(binding,REQUEST,"Asia/Shanghai",wire,wire,wire));yes(wire.transfers==0&&wire.logins==0);}
  for(int missing=0;missing<4;missing++){final int slot=missing;Wire wire=new Wire();denied("LIFELOG_CALENDAR_REQUEST_REQUIRED",()->OfficialLifelogMonthDiscovery.read(OWNER.binding,slot==0?null:REQUEST,"Asia/Shanghai",slot==1?null:wire,slot==2?null:wire,slot==3?null:wire));yes(wire.transfers==0&&wire.guards==0);}
  Wire wrongMonth=new Wire();wrongMonth.raw=response("2026-12",false);denied("LIFELOG_CALENDAR_DATE_MONTH_MISMATCH",()->read(wrongMonth));yes(wrongMonth.transfers==1&&wrongMonth.logins==2&&wrongMonth.guards==4); // No result or inferred request month.
  Wire invalid=new Wire();invalid.raw=new byte[]{'{'};invalid.changeAt=3;denied("LIFELOG_CALENDAR_JSON_INVALID",()->read(invalid));yes(invalid.logins==2); // Third login occurs only after successful parse.
  Wire changedInvalid=new Wire();changedInvalid.raw=new byte[]{'{'};changedInvalid.changeAt=2;denied("OFFICIAL_ACCOUNT_CHANGED",()->read(changedInvalid));yes(changedInvalid.logins==2); // Account fence precedes parsing.
  Wire offline=new Wire();offline.offline=true;denied("SYNTHETIC_OFFLINE",()->read(offline));yes(offline.transfers==1&&offline.logins==1); // No retry.
  Wire loginFail=new Wire();loginFail.loginFail=true;denied("SYNTHETIC_LOGIN_UNAVAILABLE",()->read(loginFail));yes(loginFail.transfers==0);
  Wire earlyInterrupt=new Wire();Thread.currentThread().interrupt();try{denied("MATERIAL_PAUSED",()->read(earlyInterrupt));yes(earlyInterrupt.transfers==0&&earlyInterrupt.logins==0);}finally{Thread.interrupted();}
  Wire lateInterrupt=new Wire();lateInterrupt.interruptInTransfer=true;try{denied("MATERIAL_PAUSED",()->read(lateInterrupt));yes(lateInterrupt.transfers==1&&lateInterrupt.logins==1);}finally{Thread.interrupted();}
  System.out.println("Month discovery: "+checks+" synthetic checks passed");
 }
}
