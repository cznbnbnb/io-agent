package com.turboio.addon;

import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.time.*;
import java.util.*;

/** Synthetic calendar responses only; no claims about transport/account binding. */
final class OfficialLifelogCalendarTest {
 private static int checks;
 private static void yes(boolean value){checks++;if(!value)throw new AssertionError("calendar assertion "+checks);}
 private static void denied(String expected,Runnable action){try{action.run();throw new AssertionError("invalid calendar accepted");}catch(IllegalArgumentException invalid){yes(("LIFELOG_CALENDAR_"+expected).equals(invalid.getMessage())&&invalid.getCause()==null);}}
 private static Map<String,Object> fixture(String month){YearMonth selected=YearMonth.parse(month);List<Object> rows=new ArrayList<>();for(int day=1;day<=selected.lengthOfMonth();day++)rows.add(WireJson.object("date",selected.atDay(day).toString(),"hasLog",day==1||day==10||day==20,"dailySummaryList",day==1?Arrays.asList(WireJson.object("title","synthetic ignored text","id","synthetic-summary")):null));return WireJson.object("code",0L,"data",WireJson.object("dailyLifelogList",rows,"extension",WireJson.object("synthetic",true)),"message","synthetic");}
 private static Map<String,Object> data(Map<String,Object> root){return WireJson.map(root.get("data"));}
 private static List<Object> rows(Map<String,Object> root){return WireJson.list(data(root).get("dailyLifelogList"));}
 private static Map<String,Object> row(Map<String,Object> root,int n){return WireJson.map(rows(root).get(n));}
 private static OfficialLifelogCalendar.Page read(String month,Map<String,Object> root){return OfficialLifelogCalendar.read(OfficialLifelogCalendarRequest.month(month),WireJson.bytes(root));}
 private static void badDate(Object date,String error){Map<String,Object> root=fixture("2026-10");row(root,0).put("date",date);denied(error,()->read("2026-10",root));}
 public static void main(String[] args){
  for(String month:new String[]{"1970-01","2000-02","2023-02","2024-02","2026-04","2026-10","2026-12","2027-01","2100-02","9999-12"}){
   Map<String,Object> root=fixture(month);Collections.reverse(rows(root));OfficialLifelogCalendarRequest request=OfficialLifelogCalendarRequest.month(month);byte[] prepared=request.body();OfficialLifelogCalendar.Page parsed=OfficialLifelogCalendar.read(request,WireJson.bytes(root));yes(parsed.month.equals(YearMonth.parse(month)));yes(request.month().equals(parsed.month));yes(parsed.totalDays==YearMonth.parse(month).lengthOfMonth());yes(parsed.dates.equals(Arrays.asList(month+"-01",month+"-10",month+"-20")));yes(Arrays.equals(prepared,request.body()));
   try{parsed.dates.clear();throw new AssertionError("mutable calendar");}catch(UnsupportedOperationException expected){yes(true);}rows(root).clear();yes(parsed.dates.size()==3);
  }
  Map<String,Object> empty=fixture("2026-10");for(Object item:rows(empty))WireJson.map(item).put("hasLog",false);OfficialLifelogCalendar.Page none=read("2026-10",empty);yes(none.dates.isEmpty());yes(none.totalDays==31); // No tombstone/model operations exist.
  Map<String,Object> all=fixture("2026-10");for(Object item:rows(all))WireJson.map(item).put("hasLog",true);yes(read("2026-10",all).dates.size()==31);
  for(Object code:new Object[]{null,1L,-1L,"0",false,new BigDecimal("0.0")}){Map<String,Object> root=fixture("2026-10");root.put("code",code);denied("RESPONSE_REJECTED",()->read("2026-10",root));}
  Map<String,Object> noCode=fixture("2026-10");noCode.remove("code");denied("RESPONSE_REJECTED",()->read("2026-10",noCode));
  for(Object value:new Object[]{null,"{}",new ArrayList<>(),0L}){Map<String,Object> root=fixture("2026-10");root.put("data",value);denied("DATA_INVALID",()->read("2026-10",root));}
  for(Object value:new Object[]{null,"[]",new TreeMap<>(),false}){Map<String,Object> root=fixture("2026-10");data(root).put("dailyLifelogList",value);denied("ROWS_INVALID",()->read("2026-10",root));}
  Map<String,Object> missing=fixture("2026-10");rows(missing).remove(30);denied("COVERAGE_INCOMPLETE",()->read("2026-10",missing));rows(missing).clear();denied("COVERAGE_INCOMPLETE",()->read("2026-10",missing));
  Map<String,Object> excess=fixture("2026-10");rows(excess).add(rows(excess).get(0));denied("LIST_BUDGET",()->read("2026-10",excess));
  for(Object value:new Object[]{null,"row",true,Arrays.asList(1)}){Map<String,Object> root=fixture("2026-10");rows(root).set(0,value);denied("ROW_INVALID",()->read("2026-10",root));}
  for(Object value:new Object[]{null,20261001L,false,"2026-10-32","2026-02-29","2026-10-1","20261001","2026-10-01T00:00:00","2026-10-01 ","２０２６-１０-０１"})badDate(value,"DATE_INVALID");
  for(String value:new String[]{"2026-09-30","2026-11-01","2025-10-01","2027-01-01"})badDate(value,"DATE_MONTH_MISMATCH");badDate("2026-10-02","DATE_DUPLICATE");
  Map<String,Object> noDate=fixture("2026-10");row(noDate,0).remove("date");denied("DATE_INVALID",()->read("2026-10",noDate));
  for(Object value:new Object[]{null,"true","false",0L,1L,new ArrayList<>(),new TreeMap<>()}){Map<String,Object> root=fixture("2026-10");row(root,0).put("hasLog",value);denied("HAS_LOG_INVALID",()->read("2026-10",root));}
  Map<String,Object> noFlag=fixture("2026-10");row(noFlag,0).remove("hasLog");denied("HAS_LOG_INVALID",()->read("2026-10",noFlag));
  for(String field:new String[]{"accountId","account_id","AccountID","account","userId","user_info","ownerId","tenantId"})for(int level=0;level<3;level++){Map<String,Object> root=fixture("2026-10");(level==0?root:level==1?data(root):row(root,0)).put(field,null);denied("ACCOUNT_UNSUPPORTED",()->read("2026-10",root));}
  for(String field:new String[]{"hasMore","hasNext","hasNextPage","nextCursor","cursor","nextPage","nextToken","nextId","continuationToken","offset","limit","page","pageSize","totalPages","pagination","paging","paginationState","pageState","continuationCursor"})for(int level=0;level<3;level++){Map<String,Object> root=fixture("2026-10");(level==0?root:level==1?data(root):row(root,0)).put(field,false);denied("PAGINATION_UNSUPPORTED",()->read("2026-10",root));}
  for(String field:new String[]{"deleted","isDeleted","deletedAt","deletedIds","tombstone","tombstones"}){Map<String,Object> root=fixture("2026-10");data(root).put(field,null);denied("DELETION_UNSUPPORTED",()->read("2026-10",root));}
  Map<String,Object> nested=fixture("2026-10");row(nested,0).put("dailySummaryList",Arrays.asList(WireJson.object("accountId",12L)));denied("ACCOUNT_UNSUPPORTED",()->read("2026-10",nested));
  OfficialLifelogCalendarRequest request=OfficialLifelogCalendarRequest.month("2026-10");byte[] good=WireJson.bytes(fixture("2026-10"));String text=new String(good,StandardCharsets.UTF_8);
  denied("RESPONSE_REJECTED",()->OfficialLifelogCalendar.read(request,text.replace("\"code\":0","\"code\":0e0").getBytes(StandardCharsets.UTF_8)));
  for(String invalid:new String[]{"", "null", "[]", "{\"code\":0,\"code\":0,\"data\":{}}",text+"{}",text.replace("\"hasLog\":true","\"hasLog\":true,\"hasLog\":true"),text.replace("\"date\":\"2026-10-01\"","\"date\":\"2026-10-01\",\"date\":\"2026-10-01\"")}){String error=invalid.equals("null")||invalid.equals("[]")?"ROOT_INVALID":"JSON_INVALID";denied(error,()->OfficialLifelogCalendar.read(request,invalid.getBytes(StandardCharsets.UTF_8)));}
  denied("REQUEST_REQUIRED",()->OfficialLifelogCalendar.read(null,good));denied("RESPONSE_BUDGET",()->OfficialLifelogCalendar.read(request,null));denied("RESPONSE_BUDGET",()->OfficialLifelogCalendar.read(request,new byte[OfficialLifelogCalendar.MAX_RESPONSE_BYTES+1]));denied("JSON_INVALID",()->OfficialLifelogCalendar.read(request,new byte[]{(byte)0xc0,(byte)0xaf}));
  byte[] exact=Arrays.copyOf(good,OfficialLifelogCalendar.MAX_RESPONSE_BYTES);Arrays.fill(exact,good.length,exact.length,(byte)' ');yes(OfficialLifelogCalendar.read(request,exact).dates.size()==3);
  Map<String,Object> nodes=fixture("2026-10");List<Object> many=new ArrayList<>();for(int i=0;i<8193;i++)many.add(null);data(nodes).put("extension",many);denied("JSON_INVALID",()->read("2026-10",nodes));
  String deepJson=text.substring(0,text.length()-1)+",\"extension\":"+new String(new char[34]).replace('\0','[')+"null"+new String(new char[34]).replace('\0',']')+"}";denied("JSON_INVALID",()->OfficialLifelogCalendar.read(request,deepJson.getBytes(StandardCharsets.UTF_8)));
  System.out.println("Calendar parser: "+checks+" synthetic checks passed");
 }
}
