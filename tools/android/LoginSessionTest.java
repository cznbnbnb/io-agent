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
  System.out.println("Login session: passed (synthetic record validity/expiry/malformed/missing stock runtime; no actual login)");
 }
 static final class InstantMillis{static final long NOW=java.time.Instant.parse("2026-10-20T12:00:00Z").toEpochMilli();}
}
