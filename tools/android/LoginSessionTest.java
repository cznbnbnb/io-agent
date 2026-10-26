package com.turboio.addon;
import java.util.*;
public final class LoginSessionTest {
 static void check(boolean value){if(!value)throw new AssertionError("Login session policy");}
 public static void main(String[] args){
  long now=InstantMillis.NOW;Map<String,Object> record=new HashMap<>();
  check(!Host107Login.loggedIn());check(!Host107Login.valid(record,now));
  record.put("accessToken","synthetic-only");check(!Host107Login.valid(record,now));
  record.put("accessTokenExpireAt","2026-10-20T00:00:00Z");check(!Host107Login.valid(record,now));
  record.put("accessTokenExpireAt","2026-10-21T00:00:00Z");check(Host107Login.valid(record,now));
  record.put("accessToken","");check(!Host107Login.valid(record,now));
  record.put("accessToken","synthetic-only");record.put("accessTokenExpireAt",Long.MIN_VALUE);check(!Host107Login.valid(record,now));
  record.put("accessTokenExpireAt",1792540800L);check(Host107Login.valid(record,now));
  record.put("accessTokenExpireAt","bad-expiry");check(!Host107Login.valid(record,now));
  TimeZone previous=TimeZone.getDefault();try{
   TimeZone.setDefault(TimeZone.getTimeZone("Asia/Shanghai"));
   record.put("accessTokenExpireAt","2026-10-20T20:00:00.000000");check(!Host107Login.valid(record,now));
   record.put("accessTokenExpireAt","2026-10-20T20:00:00.001000");check(Host107Login.valid(record,now));
   record.put("accessTokenExpireAt","2026-10-20T20:00:01.123456");check(Host107Login.valid(record,now));check(!Host107Login.valid(record,now+2000));
   record.put("accessTokenExpireAt","2026-10-20T12:00:00.001000Z");check(Host107Login.valid(record,now));
   record.put("accessTokenExpireAt","2026-10-20T20:00:00.001000+08:00");check(Host107Login.valid(record,now));
   record.put("accessTokenExpireAt","2026-02-30T20:00:00.001000");check(!Host107Login.valid(record,now));
   record.remove("accessToken");record.put("accessTokenExpireAt","2026-10-21T20:00:00.001000");check(!Host107Login.valid(record,now));
  }finally{TimeZone.setDefault(previous);}
  Map<String,Object> stored=new HashMap<>();check(Host107Login.describe(null,now).equals("records=unavailable"));
  check(Host107Login.describe(stored,now).contains("token=missing"));
  stored.put("token","{\"accessToken\":\"secret-synthetic\",\"refreshToken\":\"refresh-synthetic\",\"accessTokenExpireAt\":\"2026-10-20T12:00:00Z\",\"refreshTokenExpireAt\":1792540800}");stored.put("user_info","{\"name\":\"private-synthetic\"}");
  String described=Host107Login.describe(stored,now);
  check(!described.contains("secret-synthetic")&&!described.contains("refresh-synthetic")&&!described.contains("private-synthetic"));
  check(described.contains("accessLen=16")&&described.contains("until=2026-10-20T12:00:00Z")&&described.contains("refreshTokenExpireAt=1792540800")&&described.contains("keys=[token, user_info]"));
  Map<String,Object> lapsed=new HashMap<>();lapsed.put("accessToken","synthetic-only");lapsed.put("accessTokenExpireAt","2026-10-20T12:00:00Z");
  check(Long.valueOf(now).equals(Host107Login.renewing(lapsed,now)));check(Long.valueOf(now).equals(Host107Login.renewing(lapsed,now+Host107Login.RENEW_GRACE_MS-1)));
  check(Host107Login.renewing(lapsed,now-1)==null);check(Host107Login.renewing(lapsed,now+Host107Login.RENEW_GRACE_MS)==null);
  lapsed.put("refreshTokenExpireAt","2026-11-19T10:10:59Z");check(Host107Login.renewing(lapsed,now+60000)!=null);
  lapsed.put("refreshTokenExpireAt","2026-10-20T12:00:30Z");check(Host107Login.renewing(lapsed,now+60000)==null);
  lapsed.put("refreshTokenExpireAt","bad-expiry");check(Host107Login.renewing(lapsed,now+60000)==null);
  lapsed.remove("refreshTokenExpireAt");lapsed.put("accessToken"," ");check(Host107Login.renewing(lapsed,now+60000)==null);
  check(Host107Login.renewingSince(now)==null&&Host107Login.loginCode().equals("OFFICIAL_LOGIN_REQUIRED"));
  System.out.println("Login session: passed (synthetic record validity/expiry/malformed/missing stock runtime; no actual login)");
 }
 static final class InstantMillis{static final long NOW=java.time.Instant.parse("2026-10-20T12:00:00Z").toEpochMilli();}
}
