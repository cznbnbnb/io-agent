package com.turboio.addon;

import java.nio.charset.StandardCharsets;
import java.time.YearMonth;
import java.util.*;

public final class OfficialLifelogCalendarRequestTest {
 private static int checks;
 private static void yes(boolean value){checks++;if(!value)throw new AssertionError("Calendar request assertion "+checks);}
 private static void denied(Runnable action){try{action.run();throw new AssertionError("Invalid calendar month accepted");}catch(IllegalArgumentException expected){yes("LIFELOG_CALENDAR_MONTH_INVALID".equals(expected.getMessage()));}}
 private static void exact(OfficialLifelogCalendarRequest request,int expected){
  byte[] bytes=("{\"startYearMonth\":"+expected+",\"endYearMonth\":"+expected+"}").getBytes(StandardCharsets.UTF_8);
  yes(request.method.equals("POST"));yes(request.path.equals("/lifelog/api/v1/calendar"));yes(request.query.isEmpty()&&!request.path.contains("?"));yes(Arrays.equals(request.body(),bytes));
  String text=new String(request.body(),StandardCharsets.UTF_8);yes(!text.contains("startMonth")&&!text.contains("endMonth")&&!text.contains("account")&&!text.contains("timezone"));
  byte[] forSigning=request.body(),forSending=request.body();yes(forSigning!=forSending&&Arrays.equals(forSigning,forSending));Arrays.fill(forSigning,(byte)'x');yes(Arrays.equals(request.body(),bytes));Arrays.fill(forSending,(byte)0);yes(Arrays.equals(request.body(),bytes));
 }
 public static void main(String[] args){
  exact(OfficialLifelogCalendarRequest.month(1970,1),197001);exact(OfficialLifelogCalendarRequest.month(9999,12),999912);
  exact(OfficialLifelogCalendarRequest.month("2023-12"),202312);exact(OfficialLifelogCalendarRequest.month("2024-01"),202401);
  exact(OfficialLifelogCalendarRequest.month(YearMonth.of(2024,2)),202402);exact(OfficialLifelogCalendarRequest.month(YearMonth.of(2023,2)),202302);
  exact(OfficialLifelogCalendarRequest.month(YearMonth.of(2000,2)),200002);exact(OfficialLifelogCalendarRequest.month(YearMonth.of(2100,2)),210002);
  for(int month=1;month<=12;month++){OfficialLifelogCalendarRequest a=OfficialLifelogCalendarRequest.month(2026,month),b=OfficialLifelogCalendarRequest.month(String.format(Locale.ROOT,"2026-%02d",month));yes(Arrays.equals(a.body(),b.body()));yes(Arrays.equals(a.body(),OfficialLifelogCalendarRequest.month(YearMonth.of(2026,month)).body()));}
  for(int year:new int[]{Integer.MIN_VALUE,-1,0,1969,10000,Integer.MAX_VALUE})denied(()->OfficialLifelogCalendarRequest.month(year,1));
  for(int month:new int[]{Integer.MIN_VALUE,-1,0,13,100,Integer.MAX_VALUE})denied(()->OfficialLifelogCalendarRequest.month(2026,month));
  denied(()->OfficialLifelogCalendarRequest.month((YearMonth)null));denied(()->OfficialLifelogCalendarRequest.month(YearMonth.of(1969,12)));denied(()->OfficialLifelogCalendarRequest.month(YearMonth.of(10000,1)));
  for(String text:new String[]{null,"","202610","2026-1","26-10","02026-10","2026-001","2026/10"," 2026-10","2026-10 ","2026-10\n","+2026-10","2026-00","2026-13","0000-01","1969-12","10000-01","２０２６-１０","2026-10-01","2026-10?account=1"})denied(()->OfficialLifelogCalendarRequest.month(text));
  // A later selection cannot change the already prepared signing payload.
  OfficialLifelogCalendarRequest december=OfficialLifelogCalendarRequest.month("2026-12");byte[] original=december.body();OfficialLifelogCalendarRequest january=OfficialLifelogCalendarRequest.month("2027-01");yes(Arrays.equals(original,december.body()));yes(!Arrays.equals(original,january.body()));
  System.out.println("Calendar request: "+checks+" checks passed");
 }
}
