package com.turboio.addon;
import java.io.*;import java.time.*;import java.util.*;

/** Local-only, resumable history discovery. A checked month is a date index,
 * never a deletion feed or evidence that older history does not exist. */
final class MaterialHistorySchedule implements AutoCloseable {
 static final String ZONE="Asia/Shanghai";static final int RECENT_MONTHS=12,MAX_MONTHS=120;
 static final class Plan {
  final String month,date;final long attempt;
  Plan(String month,String date,long attempt){this.month=month;this.date=date;this.attempt=attempt;}
  boolean calendar(){return date.isEmpty();}
 }
 static final class Status {
  final String account,message;final int months,indexed,days,loaded,unverified;final boolean capacity;
  Status(String account,int months,int indexed,int days,int loaded,boolean capacity,String error,int failedMonths){this.account=account;this.months=months;this.indexed=indexed;this.days=days;this.loaded=loaded;this.capacity=capacity;unverified=months-indexed;
   String progress="已核实 "+indexed+" 月 / 待核实 "+unverified+" 月 · 正文 "+loaded+"/"+days+" 天";
   message=capacity?"正文加载已暂停：缓存达 256 条或 4 MiB 上限，进度保留。"+progress:failedMonths>0?"部分月份未核实，其他资料继续加载。"+progress:!error.isEmpty()?"部分正文暂未加载，稍后自动重试。"+progress:indexed==months&&loaded==days?"历史资料：当前范围已核实，正文已加载 "+loaded+" 天。":"历史资料正在后台补齐 · "+progress;
  }
 }
 private static final class Month {final YearMonth month;long checked,failedAt,retryAfter;int failures;String error="";final SortedSet<String> dates=new TreeSet<>(),loaded=new TreeSet<>();Month(YearMonth month){this.month=month;}}
 private final String account;private final AtomicDocument document;private final NavigableMap<YearMonth,Month> months=new TreeMap<>();private long attempt,next;private int failures;private boolean capacity,upgrade;private String error="";
 MaterialHistorySchedule(File files,String account)throws IOException{
  MaterialWire.require(account!=null&&account.matches("[a-f0-9]{64}"),"MATERIAL_HISTORY_ACCOUNT");this.account=account;File file=new File(files,"material-accounts/"+account+"/history-load/state.json");document=new AtomicDocument(file,524288);
  try{MaterialWire.require(!new File(file+".partial").exists(),"MATERIAL_HISTORY_UNCERTAIN");Object raw=document.read();if(raw==null)return;
   Map<String,Object> state=WireJson.map(raw);BoundedJson.keys(state,"schema","account","attempt","next","failures","capacity","error","months");long schema=MaterialWire.number(state.get("schema"));MaterialWire.require((schema==1||schema==2)&&account.equals(state.get("account")),"MATERIAL_HISTORY_ACCOUNT");upgrade=schema==1;
   attempt=MaterialWire.number(state.get("attempt"));next=MaterialWire.number(state.get("next"));long count=MaterialWire.number(state.get("failures"));MaterialWire.require(attempt>=0&&next>=0&&count>=0&&count<=5&&state.get("capacity") instanceof Boolean,"MATERIAL_HISTORY_INVALID");failures=(int)count;capacity=(Boolean)state.get("capacity");error=MaterialWire.text(state.get("error"),80,true);MaterialWire.require(error.isEmpty()||error.matches("[A-Z_]{3,80}"),"MATERIAL_HISTORY_INVALID");
   List<Object> rows=WireJson.list(state.get("months"));MaterialWire.require(rows.size()<=MAX_MONTHS,"MATERIAL_HISTORY_BUDGET");
   for(Object value:rows){Map<String,Object> row=WireJson.map(value);if(schema==1)BoundedJson.keys(row,"month","checked","dates","loaded");else BoundedJson.keys(row,"month","checked","dates","loaded","failed_at","retry_after","failures","error");Month month=new Month(OfficialLifelogCalendarRequest.month(MaterialWire.text(row.get("month"),7,false)).month());month.checked=MaterialWire.number(row.get("checked"));MaterialWire.require(month.checked>=0&&months.put(month.month,month)==null,"MATERIAL_HISTORY_INVALID");
    if(schema==2){month.failedAt=MaterialWire.number(row.get("failed_at"));month.retryAfter=MaterialWire.number(row.get("retry_after"));long failed=MaterialWire.number(row.get("failures"));month.error=MaterialWire.text(row.get("error"),80,true);MaterialWire.require(month.failedAt>=0&&month.retryAfter>=0&&failed>=0&&failed<=5&&(month.error.isEmpty()||month.error.matches("[A-Z_]{3,80}")),"MATERIAL_HISTORY_INVALID");month.failures=(int)failed;}
    for(Object date:WireJson.list(row.get("dates"))){String day=MaterialWire.text(date,10,false);MaterialWire.require(day.matches("[0-9]{4}-[0-9]{2}-[0-9]{2}")&&YearMonth.from(LocalDate.parse(day)).equals(month.month)&&month.dates.add(day),"MATERIAL_HISTORY_INVALID");}
    for(Object date:WireJson.list(row.get("loaded"))){String day=MaterialWire.text(date,10,false);MaterialWire.require(month.dates.contains(day)&&month.loaded.add(day),"MATERIAL_HISTORY_INVALID");}
    MaterialWire.require(month.dates.size()<=month.month.lengthOfMonth()&&(month.checked>0||month.dates.isEmpty()),"MATERIAL_HISTORY_INVALID");
   }
   // Version 1 always stopped at the newest unindexed month. Move that exact
   // failure into its own cooldown; preserve every verified date/body cursor.
   if(schema==1&&!capacity&&failures>0&&!error.isEmpty())for(Month month:months.descendingMap().values())if(month.checked==0){month.failedAt=attempt;month.retryAfter=Math.max(next,attempt+900000);month.failures=failures;month.error=error;error="";failures=0;next=Math.min(next,attempt+30000);break;}
  }catch(IOException|RuntimeException failed){document.close();throw failed;}
 }
 private void save()throws IOException{List<Object> rows=new ArrayList<>();for(Month month:months.values())rows.add(WireJson.object("month",month.month.toString(),"checked",month.checked,"dates",new ArrayList<>(month.dates),"loaded",new ArrayList<>(month.loaded),"failed_at",month.failedAt,"retry_after",month.retryAfter,"failures",month.failures,"error",month.error));document.save(WireJson.object("schema",2,"account",account,"attempt",attempt,"next",next,"failures",failures,"capacity",capacity,"error",error,"months",rows));upgrade=false;}
 void include(YearMonth month,long now)throws IOException{
  YearMonth today=YearMonth.from(Instant.ofEpochMilli(now).atZone(ZoneId.of(ZONE)));if(month.isAfter(today)||months.containsKey(month))return;MaterialWire.require(month.getYear()>=1970&&months.size()<MAX_MONTHS,"MATERIAL_HISTORY_BUDGET");months.put(month,new Month(month));save();
 }
 Plan begin(long now,boolean networkRecovered)throws IOException{
  MaterialWire.require(now>0,"MATERIAL_CLOCK_INVALID");YearMonth current=YearMonth.from(Instant.ofEpochMilli(now).atZone(ZoneId.of(ZONE)));boolean added=false;for(int i=0;i<RECENT_MONTHS;i++){YearMonth month=current.minusMonths(i);if(!months.containsKey(month)){MaterialWire.require(months.size()<MAX_MONTHS,"MATERIAL_HISTORY_BUDGET");months.put(month,new Month(month));added=true;}}if(added||upgrade)save();
  if(now>=attempt&&now<next&&(!networkRecovered||failures==0||now-attempt<30000))return null;
  Plan plan=null;
  for(Month month:months.descendingMap().values()){
   if((now>=month.retryAfter||now<month.failedAt)&&(month.checked==0||month.month.equals(current)&&(now<month.checked||now-month.checked>=21600000))){plan=new Plan(month.month.toString(),"",now);break;}
  }
  // Date discovery stays available when the text cache is full. A month whose
  // response is still unverified waits independently; verified dates can load.
  if(plan==null&&!capacity)for(Month month:months.descendingMap().values()){
   for(String date:month.dates)if(!month.loaded.contains(date)&&!LocalDate.parse(date).isAfter(Instant.ofEpochMilli(now).atZone(ZoneId.of(ZONE)).toLocalDate()))plan=new Plan(month.month.toString(),date,now);if(plan!=null)break;
  }
  if(plan!=null){attempt=now;next=Math.addExact(now,30000);save();}return plan;
 }
 void indexed(Plan plan,OfficialLifelogMonthDiscovery.Snapshot source,long now)throws IOException{
  MaterialWire.require(plan!=null&&plan.calendar()&&plan.attempt==attempt&&account.equals(source.account)&&plan.month.equals(source.month)&&ZONE.equals(source.timezone),"MATERIAL_HISTORY_STALE");
  Month month=months.get(YearMonth.parse(plan.month));month.checked=now;month.failedAt=month.retryAfter=0;month.failures=0;month.error="";month.dates.addAll(source.dates);month.loaded.remove(Instant.ofEpochMilli(now).atZone(ZoneId.of(ZONE)).toLocalDate().toString());failures=0;error="";next=now+30000;save();
 }
 void loaded(Plan plan,long now)throws IOException{MaterialWire.require(plan!=null&&!plan.calendar()&&plan.attempt==attempt,"MATERIAL_HISTORY_STALE");Month month=months.get(YearMonth.parse(plan.month));MaterialWire.require(month!=null&&month.dates.contains(plan.date),"MATERIAL_HISTORY_STALE");month.loaded.add(plan.date);failures=0;error="";next=now+30000;save();}
 void failed(Plan plan,long now,String code)throws IOException{MaterialWire.require(plan!=null&&plan.attempt==attempt&&code!=null&&code.matches("[A-Z_]{3,80}"),"MATERIAL_HISTORY_STALE");capacity|=code.equals("MATERIAL_LOCAL_BUDGET")||code.equals("STORE_BUDGET");
  if(plan.calendar()){Month month=months.get(YearMonth.parse(plan.month));month.failedAt=now;month.failures=Math.min(5,month.failures+1);month.retryAfter=now+Math.min(21600000,900000L<<(month.failures-1));month.error=code;failures=0;error="";next=now+30000;}
  else{error=code;failures=Math.min(5,failures+1);next=now+Math.min(900000,30000L<<(failures-1));}save();}
 Status status(){int checked=0,days=0,loaded=0,failed=0;for(Month month:months.values()){if(month.checked>0&&month.error.isEmpty())checked++;if(!month.error.isEmpty())failed++;days+=month.dates.size();loaded+=month.loaded.size();}return new Status(account,months.size(),checked,days,loaded,capacity,error,failed);}
 @Override public void close()throws IOException{document.close();}
}
