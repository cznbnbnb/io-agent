package com.turboio.addon;

import java.nio.charset.StandardCharsets;
import java.time.YearMonth;

/** One explicitly selected month only. This describes a known request, not a
 * response parser, history inventory, transport, or authorization grant. */
final class OfficialLifelogCalendarRequest {
 final String method="POST",path="/lifelog/api/v1/calendar",query="";
 private final YearMonth selectedMonth;
 private final byte[] body;
 private OfficialLifelogCalendarRequest(YearMonth month){
  require(month!=null&&month.getYear()>=1970&&month.getYear()<=9999);
  selectedMonth=month;
  int selected=month.getYear()*100+month.getMonthValue();
  // Construct once; signing and sending consume copies of these exact UTF-8
  // bytes, never separately serialized mutable maps.
  body=("{\"startYearMonth\":"+selected+",\"endYearMonth\":"+selected+"}").getBytes(StandardCharsets.UTF_8);
 }
 private static void require(boolean valid){if(!valid)throw new IllegalArgumentException("LIFELOG_CALENDAR_MONTH_INVALID");}
 static OfficialLifelogCalendarRequest month(YearMonth selected){return new OfficialLifelogCalendarRequest(selected);}
 static OfficialLifelogCalendarRequest month(int year,int month){
  require(year>=1970&&year<=9999&&month>=1&&month<=12);return month(YearMonth.of(year,month));
 }
 static OfficialLifelogCalendarRequest month(String selected){
  require(selected!=null&&selected.matches("[0-9]{4}-[0-9]{2}"));
  return month(Integer.parseInt(selected.substring(0,4)),Integer.parseInt(selected.substring(5,7)));
 }
 byte[] body(){return body.clone();}
 YearMonth month(){return selectedMonth;}
}
