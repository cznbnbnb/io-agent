package com.turboio.addon;
import java.io.*;import java.time.*;import java.util.*;

/** Local-only, resumable history discovery. A checked month is a date index,
 * never a deletion feed or evidence that older history does not exist. */
final class MaterialHistorySchedule implements AutoCloseable {
 static final String ZONE="Asia/Shanghai";static final int RECENT_MONTHS=12,MAX_MONTHS=120,PRELOAD_DAYS=3;
 static final class Plan {
  final String month,date;final long attempt;
  Plan(String month,String date,long attempt){this.month=month;this.date=date;this.attempt=attempt;}
  boolean calendar(){return date.isEmpty();}
 }
 static final class Status {
  final String account,message;final int months,indexed,days,loaded,unverified;final boolean capacity;final Set<LocalDate> dates;
  Status(String account,int months,int indexed,int days,int loaded,boolean capacity,String error,int failedMonths,Set<LocalDate> dates){this.account=account;this.months=months;this.indexed=indexed;this.days=days;this.loaded=loaded;this.capacity=capacity;unverified=months-indexed;this.dates=Collections.unmodifiableSet(dates);
   String progress="最近有智记 "+days+" 天 · 已预载 "+loaded+"/"+days+" 天";
   message=(capacity?"部分日期正文较大，其他日期继续。":!error.isEmpty()?"部分正文稍后重试。":"")+progress+"；更早日期点选加载。"+(failedMonths>0?"部分日历标记待核实。":"");
  }
 }
 private static final class Month {final YearMonth month;long checked,failedAt,retryAfter;int failures;String error="";final SortedSet<String> dates=new TreeSet<>(),loaded=new TreeSet<>();Month(YearMonth month){this.month=month;}}
 private final String account;private final AtomicDocument document;private final NavigableMap<YearMonth,Month> months=new TreeMap<>();private final Set<String> blockedDates=new TreeSet<>();private long attempt,next,reference=System.currentTimeMillis();private int failures;private boolean capacity,upgrade;private String error="";private YearMonth requested;
 MaterialHistorySchedule(File files,String account)throws IOException{
  MaterialWire.require(account!=null&&account.matches("[a-f0-9]{64}"),"MATERIAL_HISTORY_ACCOUNT");this.account=account;File file=new File(files,"material-accounts/"+account+"/history-load/state.json");document=new AtomicDocument(file,524288);
  try{MaterialWire.require(!new File(file+".partial").exists(),"MATERIAL_HISTORY_UNCERTAIN");Object raw=document.read();if(raw==null)return;
   Map<String,Object> state=WireJson.map(raw);long schema=MaterialWire.number(state.get("schema"));if(schema==3)BoundedJson.keys(state,"schema","account","attempt","next","failures","capacity","error","months","blocked_dates");else BoundedJson.keys(state,"schema","account","attempt","next","failures","capacity","error","months");MaterialWire.require((schema==1||schema==2||schema==3)&&account.equals(state.get("account")),"MATERIAL_HISTORY_ACCOUNT");upgrade=schema<3;
   attempt=MaterialWire.number(state.get("attempt"));next=MaterialWire.number(state.get("next"));long count=MaterialWire.number(state.get("failures"));MaterialWire.require(attempt>=0&&next>=0&&count>=0&&count<=5&&state.get("capacity") instanceof Boolean,"MATERIAL_HISTORY_INVALID");failures=(int)count;capacity=(Boolean)state.get("capacity");error=MaterialWire.text(state.get("error"),80,true);MaterialWire.require(error.isEmpty()||error.matches("[A-Z_]{3,80}"),"MATERIAL_HISTORY_INVALID");
   if(schema==3){for(Object value:WireJson.list(state.get("blocked_dates"))){String date=MaterialWire.text(value,10,false);MaterialWire.require(date.matches("[0-9]{4}-[0-9]{2}-[0-9]{2}")&&LocalDate.parse(date).toString().equals(date)&&blockedDates.add(date),"MATERIAL_HISTORY_INVALID");}MaterialWire.require(blockedDates.size()<=3660,"MATERIAL_HISTORY_BUDGET");}
   else if(capacity){capacity=false;error="";failures=0;next=0;} // The old account-wide body limit no longer applies.
   List<Object> rows=WireJson.list(state.get("months"));MaterialWire.require(rows.size()<=MAX_MONTHS,"MATERIAL_HISTORY_BUDGET");
   for(Object value:rows){Map<String,Object> row=WireJson.map(value);if(schema==1)BoundedJson.keys(row,"month","checked","dates","loaded");else BoundedJson.keys(row,"month","checked","dates","loaded","failed_at","retry_after","failures","error");Month month=new Month(OfficialLifelogCalendarRequest.month(MaterialWire.text(row.get("month"),7,false)).month());month.checked=MaterialWire.number(row.get("checked"));MaterialWire.require(month.checked>=0&&months.put(month.month,month)==null,"MATERIAL_HISTORY_INVALID");
    if(schema>=2){month.failedAt=MaterialWire.number(row.get("failed_at"));month.retryAfter=MaterialWire.number(row.get("retry_after"));long failed=MaterialWire.number(row.get("failures"));month.error=MaterialWire.text(row.get("error"),80,true);MaterialWire.require(month.failedAt>=0&&month.retryAfter>=0&&failed>=0&&failed<=5&&(month.error.isEmpty()||month.error.matches("[A-Z_]{3,80}")),"MATERIAL_HISTORY_INVALID");month.failures=(int)failed;}
    for(Object date:WireJson.list(row.get("dates"))){String day=MaterialWire.text(date,10,false);MaterialWire.require(day.matches("[0-9]{4}-[0-9]{2}-[0-9]{2}")&&YearMonth.from(LocalDate.parse(day)).equals(month.month)&&month.dates.add(day),"MATERIAL_HISTORY_INVALID");}
    for(Object date:WireJson.list(row.get("loaded"))){String day=MaterialWire.text(date,10,false);MaterialWire.require(month.dates.contains(day)&&month.loaded.add(day),"MATERIAL_HISTORY_INVALID");}
    MaterialWire.require(month.dates.size()<=month.month.lengthOfMonth()&&(month.checked>0||month.dates.isEmpty()),"MATERIAL_HISTORY_INVALID");
   }
   // Version 1 always stopped at the newest unindexed month. Move that exact
   // failure into its own cooldown; preserve every verified date/body cursor.
   if(schema==1&&!capacity&&failures>0&&!error.isEmpty())for(Month month:months.descendingMap().values())if(month.checked==0){month.failedAt=attempt;month.retryAfter=Math.max(next,attempt+900000);month.failures=failures;month.error=error;error="";failures=0;next=Math.min(next,attempt+30000);break;}
  }catch(IOException|RuntimeException failed){document.close();throw failed;}
 }
 private void save()throws IOException{List<Object> rows=new ArrayList<>();for(Month month:months.values())rows.add(WireJson.object("month",month.month.toString(),"checked",month.checked,"dates",new ArrayList<>(month.dates),"loaded",new ArrayList<>(month.loaded),"failed_at",month.failedAt,"retry_after",month.retryAfter,"failures",month.failures,"error",month.error));document.save(WireJson.object("schema",3,"account",account,"attempt",attempt,"next",next,"failures",failures,"capacity",capacity,"error",error,"months",rows,"blocked_dates",new ArrayList<>(blockedDates)));upgrade=false;}
 private SortedSet<String> recent(){SortedSet<String> dates=new TreeSet<>(Collections.reverseOrder());String today=Instant.ofEpochMilli(reference).atZone(ZoneId.of(ZONE)).toLocalDate().toString();for(Month month:months.values())for(String date:month.dates)if(date.compareTo(today)<=0)dates.add(date);while(dates.size()>PRELOAD_DAYS)dates.remove(dates.last());return dates;}
 void include(YearMonth month,long now)throws IOException{
  YearMonth today=YearMonth.from(Instant.ofEpochMilli(now).atZone(ZoneId.of(ZONE)));if(month.isAfter(today))return;if(months.containsKey(month)){Month seen=months.get(month);if(now<seen.checked||now-seen.checked>=21600000)requested=month;return;}MaterialWire.require(month.getYear()>=1970&&months.size()<MAX_MONTHS,"MATERIAL_HISTORY_BUDGET");months.put(month,new Month(month));requested=month;save();
 }
 Plan begin(long now,boolean networkRecovered)throws IOException{
  MaterialWire.require(now>0,"MATERIAL_CLOCK_INVALID");reference=now;YearMonth current=YearMonth.from(Instant.ofEpochMilli(now).atZone(ZoneId.of(ZONE)));boolean added=false;for(int i=0;i<RECENT_MONTHS;i++){YearMonth month=current.minusMonths(i);if(!months.containsKey(month)){MaterialWire.require(months.size()<MAX_MONTHS,"MATERIAL_HISTORY_BUDGET");months.put(month,new Month(month));added=true;}}if(added||upgrade)save();
  if(now>=attempt&&now<next&&(!networkRecovered||failures==0||now-attempt<30000))return null;
  Plan plan=null;
  boolean browsing=requested!=null;Month first=months.get(requested==null?current:requested);requested=null;
  if(first!=null&&(now>=first.retryAfter||now<first.failedAt)&&(first.checked==0||(browsing||first.month.equals(current))&&(now<first.checked||now-first.checked>=21600000)))plan=new Plan(first.month.toString(),"",now);
  if(plan==null)for(Month month:months.descendingMap().values())if((now>=month.retryAfter||now<month.failedAt)&&month.checked==0){plan=new Plan(month.month.toString(),"",now);break;}
  if(plan==null)for(String date:recent()){Month month=months.get(YearMonth.from(LocalDate.parse(date)));if(!month.loaded.contains(date)&&!blockedDates.contains(date)){plan=new Plan(month.month.toString(),date,now);break;}}
  if(plan!=null){attempt=now;next=Math.addExact(now,30000);save();}return plan;
 }
 void indexed(Plan plan,OfficialLifelogMonthDiscovery.Snapshot source,long now)throws IOException{
  MaterialWire.require(plan!=null&&plan.calendar()&&plan.attempt==attempt&&account.equals(source.account)&&plan.month.equals(source.month)&&ZONE.equals(source.timezone),"MATERIAL_HISTORY_STALE");
  Month month=months.get(YearMonth.parse(plan.month));month.checked=now;month.failedAt=month.retryAfter=0;month.failures=0;month.error="";month.dates.clear();month.dates.addAll(source.dates);month.loaded.retainAll(month.dates);month.loaded.remove(Instant.ofEpochMilli(now).atZone(ZoneId.of(ZONE)).toLocalDate().toString());failures=0;error="";next=now+30000;save();
 }
 void loaded(Plan plan,long now)throws IOException{MaterialWire.require(plan!=null&&!plan.calendar()&&plan.attempt==attempt,"MATERIAL_HISTORY_STALE");Month month=months.get(YearMonth.parse(plan.month));MaterialWire.require(month!=null&&month.dates.contains(plan.date),"MATERIAL_HISTORY_STALE");month.loaded.add(plan.date);failures=0;error="";next=now+30000;save();}
 void empty(Plan plan,long now)throws IOException{MaterialWire.require(plan!=null&&!plan.calendar()&&plan.attempt==attempt,"MATERIAL_HISTORY_STALE");Month month=months.get(YearMonth.parse(plan.month));month.dates.remove(plan.date);month.loaded.remove(plan.date);blockedDates.remove(plan.date);error="";failures=0;next=now+30000;save();}
 void failed(Plan plan,long now,String code)throws IOException{MaterialWire.require(plan!=null&&plan.attempt==attempt&&code!=null&&code.matches("[A-Z_]{3,80}"),"MATERIAL_HISTORY_STALE");capacity|=code.equals("MATERIAL_LOCAL_BUDGET")||code.equals("STORE_BUDGET");
  if(plan.calendar()){Month month=months.get(YearMonth.parse(plan.month));month.failedAt=now;month.failures=Math.min(5,month.failures+1);month.retryAfter=now+Math.min(21600000,900000L<<(month.failures-1));month.error=code;failures=0;error="";next=now+30000;}
  else if(code.equals("MATERIAL_LOCAL_BUDGET")||code.equals("STORE_BUDGET")){blockedDates.add(plan.date);error="";failures=0;next=now+30000;}
  else{error=code;failures=Math.min(5,failures+1);next=now+Math.min(900000,30000L<<(failures-1));}save();}
 Status status(){int checked=0,loaded=0,failed=0;Set<LocalDate> hints=new TreeSet<>();SortedSet<String> dates=recent();boolean limited=false;for(Month month:months.values()){if(month.checked>0&&month.error.isEmpty())checked++;if(!month.error.isEmpty())failed++;for(String date:month.dates)hints.add(LocalDate.parse(date));for(String date:dates)if(month.loaded.contains(date))loaded++;}for(String date:dates)limited|=blockedDates.contains(date);return new Status(account,months.size(),checked,dates.size(),loaded,limited,error,failed,hints);}
 @Override public void close()throws IOException{document.close();}
}
