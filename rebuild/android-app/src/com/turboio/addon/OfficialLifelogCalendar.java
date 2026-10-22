package com.turboio.addon;

import java.time.*;
import java.util.*;

/** Pure parser for the evidenced single-month calendar response. A validated
 * calendar is only a set of date hints: it proves neither account ownership nor
 * source membership, complete material history, absence or deletion. The caller
 * must bind the authenticated transport/account/month/timezone before using it. */
final class OfficialLifelogCalendar {
 static final int MAX_RESPONSE_BYTES=1048576,MAX_JSON_NODES=8192;
 private static final Set<String> ACCOUNT_KEYS=new HashSet<>(Arrays.asList("account","accountid","userid","userinfo","ownerid","tenantid"));
 private static final Set<String> PAGINATION_KEYS=new HashSet<>(Arrays.asList("cursor","nextcursor","offset","limit","hasmore","hasnext","hasnextpage","currentpage","totalpages","nextpage","prevpage","previouspage","nexttoken","nextid","continuation","continuationtoken","islast","islastpage"));
 private static final Set<String> DELETION_KEYS=new HashSet<>(Arrays.asList("deleted","isdeleted","deletedat","deletedids","tombstone","tombstones"));
 static final class Page {
  final YearMonth month;
  final List<String> dates;
  final int totalDays;
  private Page(YearMonth month,Collection<String> dates){this.month=month;this.dates=Collections.unmodifiableList(new ArrayList<>(dates));totalDays=month.lengthOfMonth();}
 }
 private OfficialLifelogCalendar(){}
 private static void require(boolean ok,String code){if(!ok)throw new IllegalArgumentException("LIFELOG_CALENDAR_"+code);}
 private static Map<?,?> object(Object value,String code){require(value instanceof Map,code);return (Map<?,?>)value;}
 private static String normalized(String key){return key.replace("_","").replace("-","").toLowerCase(Locale.ROOT);}
 private static void unsupported(Object value,int depth){
  require(depth<=32,"JSON_INVALID");
  if(value instanceof Map)for(Map.Entry<?,?> entry:((Map<?,?>)value).entrySet()){
   String name=normalized((String)entry.getKey());
   require(!ACCOUNT_KEYS.contains(name),"ACCOUNT_UNSUPPORTED");
   // No pagination contract has been established, even for false/null markers.
   // Reject explicit fields and namespaced pagination extensions; do not guess
   // cursor or continuation formats. Month coverage is checked independently.
   require(!PAGINATION_KEYS.contains(name)&&!name.startsWith("page")&&!name.endsWith("cursor")&&!name.contains("pagination")&&!name.contains("paging"),"PAGINATION_UNSUPPORTED");
   require(!DELETION_KEYS.contains(name),"DELETION_UNSUPPORTED");
   unsupported(entry.getValue(),depth+1);
  }else if(value instanceof List)for(Object item:(List<?>)value)unsupported(item,depth+1);
 }
 static Page read(OfficialLifelogCalendarRequest request,byte[] response){
  require(request!=null,"REQUEST_REQUIRED");require(response!=null&&response.length<=MAX_RESPONSE_BYTES,"RESPONSE_BUDGET");Object document;
  // Duplicate members are rejected, including equal duplicates. Never normalize
  // ambiguity away before checking the calendar's date/boolean contract.
  try{document=WireJson.read(response,MAX_RESPONSE_BYTES,MAX_JSON_NODES);}catch(IllegalArgumentException invalid){throw new IllegalArgumentException("LIFELOG_CALENDAR_JSON_INVALID");}
  Map<?,?> root=object(document,"ROOT_INVALID");require(Long.valueOf(0).equals(root.get("code")),"RESPONSE_REJECTED");unsupported(root,0);
  Map<?,?> data=object(root.get("data"),"DATA_INVALID");Object rawRows=data.get("dailyLifelogList");require(rawRows instanceof List,"ROWS_INVALID");List<?> rows=(List<?>)rawRows;
  YearMonth selected=request.month();require(rows.size()<=selected.lengthOfMonth(),"LIST_BUDGET");require(rows.size()==selected.lengthOfMonth(),"COVERAGE_INCOMPLETE");Set<LocalDate> seen=new HashSet<>();SortedSet<String> found=new TreeSet<>();
  for(Object raw:rows){Map<?,?> row=object(raw,"ROW_INVALID");Object date=row.get("date");require(date instanceof String&&((String)date).matches("[0-9]{4}-[0-9]{2}-[0-9]{2}"),"DATE_INVALID");LocalDate day;
   try{day=LocalDate.parse((String)date);}catch(DateTimeException invalid){throw new IllegalArgumentException("LIFELOG_CALENDAR_DATE_INVALID");}
   require(selected.equals(YearMonth.from(day)),"DATE_MONTH_MISMATCH");require(seen.add(day),"DATE_DUPLICATE");Object hasLog=row.get("hasLog");require(hasLog instanceof Boolean,"HAS_LOG_INVALID");if(Boolean.TRUE.equals(hasLog))found.add((String)date);
  }
  // Exact cardinality + uniqueness + same-month membership implies full day
  // coverage. False rows never produce a deletion or a retained-source removal.
  return new Page(selected,found);
 }
}
