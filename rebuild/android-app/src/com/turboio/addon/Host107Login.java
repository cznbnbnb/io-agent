package com.turboio.addon;

import java.util.*;
import java.nio.charset.StandardCharsets;
import java.time.*;
import java.time.format.DateTimeParseException;
import java.util.concurrent.*;

/** Read the already-open stock secure store. Never initializes, writes or exports it. */
final class Host107Login {
 private Host107Login(){}
 private static Map<?,?> records()throws Exception{
   Object engine=NavReflect.field(NavReflect.type("y8.d"),"b");if(engine==null)return null;
   Object registry=NavReflect.field(engine,"d");
   Object plugin=((Map<?,?>)NavReflect.field(registry,"a")).get(NavReflect.type("g7.q"));if(plugin==null)return null;
   Map<?,?> stores=(Map<?,?>)NavReflect.field(plugin,"d");Object store;
   synchronized(stores){store=stores.get("FlutterSecureStorage");}if(store==null)return null;
   final Object openedStore=store;FutureTask<Object> read=new FutureTask<>(()->NavReflect.call(openedStore,"x"));
   if(!Boolean.TRUE.equals(NavReflect.call(NavReflect.field(plugin,"f"),"post",read)))return null;
   Object values=read.get(1500,TimeUnit.MILLISECONDS);return values instanceof Map?(Map<?,?>)values:null;
 }
 private static boolean validRecords(Map<?,?> values){
   if(values==null)return false;Object token=values.get("token");if(!(token instanceof String)||((String)token).length()>16384)return false;
   Object parsed=WireJson.read(((String)token).getBytes(StandardCharsets.UTF_8),65536,100);return parsed instanceof Map&&valid((Map<?,?>)parsed,System.currentTimeMillis());
 }
 static OfficialAccountBinding account(){
  try{Map<?,?> values=records();if(!validRecords(values)||!(values.get("user_info") instanceof String))return null;return OfficialAccountBinding.read(((String)values.get("user_info")).getBytes(StandardCharsets.UTF_8));}catch(Exception unavailable){return null;}
 }
 /** Ephemeral current-account read credential for the fixed official API only.
  * No refresh, persistence, or credential forwarding to our material server. */
 static final class Session {
  final OfficialAccountBinding account;private final String access;
  private Session(OfficialAccountBinding account,String access){this.account=account;this.access=access;}
  String accessToken(){return access;}
  @Override public String toString(){return "OfficialSession[redacted]";}
 }
 static Session session(OfficialAccountBinding expected)throws Exception{
  Map<?,?> values=records();MaterialWire.require(expected!=null&&validRecords(values)&&values.get("user_info") instanceof String,"OFFICIAL_LOGIN_REQUIRED");
  OfficialAccountBinding current=OfficialAccountBinding.read(((String)values.get("user_info")).getBytes(StandardCharsets.UTF_8));MaterialWire.require(expected.same(current),"OFFICIAL_ACCOUNT_CHANGED");
  Map<?,?> token=WireJson.map(WireJson.read(((String)values.get("token")).getBytes(StandardCharsets.UTF_8),65536,100));String access=(String)token.get("accessToken");MaterialWire.require(access.length()<=16384&&access.indexOf('\r')<0&&access.indexOf('\n')<0,"OFFICIAL_TOKEN_INVALID");return new Session(current,access);
 }
 /** Before any screen the stock cached Flutter engine may not exist yet; start it the way the stock
  * background events do (y8.d.a), so the login records below can be read. */
 static void warm(android.content.Context context)throws Exception{Class<?> holder=NavReflect.type("y8.d");if(holder.getField("b").get(null)!=null)return;Object d=holder.getField("a").get(null);holder.getMethod("a",android.content.Context.class).invoke(d,context);}
 static boolean loggedIn(){
  Map<?,?> values=null;String failure=null;boolean ok;
  try{values=records();ok=validRecords(values);}catch(Exception unavailable){failure=unavailable.getClass().getSimpleName();ok=false;}
  note(ok,values,failure);return ok;
 }
 private static volatile Boolean lastOk;private static volatile long lastNote;
 /** Redacted login diagnosis: field names, lengths and expiry times only, never token values.
  * Logged on each change, and at most once a minute while rejected. */
 private static void note(boolean ok,Map<?,?> values,String failure){
  long now=System.currentTimeMillis();Boolean last=lastOk;
  if(last!=null&&last==ok&&(ok||now-lastNote<60000))return;
  lastOk=ok;lastNote=now;
  try{android.util.Log.i("TurboIOLogin",(ok?"login valid ":"login rejected ")+(failure!=null?"records="+failure:describe(values,now)));}
  catch(LinkageError jvmTest){}
 }
 static String describe(Map<?,?> values,long now){
  if(values==null)return "records=unavailable";
  StringBuilder b=new StringBuilder("keys=").append(names(values));
  Object token=values.get("token");
  if(!(token instanceof String))return b.append(" token=").append(token==null?"missing":token.getClass().getSimpleName()).toString();
  b.append(" tokenLen=").append(((String)token).length());
  Object parsed;
  try{parsed=WireJson.read(((String)token).getBytes(StandardCharsets.UTF_8),65536,100);}catch(RuntimeException bad){return b.append(" token=unparsed").toString();}
  if(!(parsed instanceof Map))return b.append(" token=notObject").toString();
  Map<?,?> record=(Map<?,?>)parsed;
  Object access=record.get("accessToken");
  b.append(" fields=").append(names(record)).append(" accessLen=").append(access instanceof String?((String)access).length():-1);
  for(Map.Entry<?,?> e:record.entrySet()){
   if(!String.valueOf(e.getKey()).toLowerCase(Locale.ROOT).contains("expire"))continue;
   Object v=e.getValue();b.append(' ').append(e.getKey()).append('=').append(v instanceof String||v instanceof Number?v:v==null?"null":v.getClass().getSimpleName());
  }
  Long until=expiresAt(record.get("accessTokenExpireAt"));
  b.append(" until=").append(until==null?"unparsed":Instant.ofEpochMilli(until).toString()).append(" now=").append(Instant.ofEpochMilli(now)).append(" zone=").append(ZoneId.systemDefault());
  if(until!=null)b.append(" remainingMin=").append((until-now)/60000);
  return b.toString();
 }
 private static TreeSet<String> names(Map<?,?> map){TreeSet<String> out=new TreeSet<>();for(Object k:map.keySet())out.add(String.valueOf(k));return out;}
 static boolean valid(Map<?,?> record,long now){
  Object access=record.get("accessToken");
  if(!(access instanceof String)||((String)access).trim().isEmpty())return false;
  Long until=expiresAt(record.get("accessTokenExpireAt"));
  return until!=null&&until>now;
 }
 static Long expiresAt(Object expiry){
  try{
   long until;
   if(expiry instanceof String){
    // Stock TokenData uses Dart local ISO dates (including six fractional digits).
    // An explicit offset wins; otherwise use the device timezone, as Dart does.
    String value=(String)expiry;
    try{until=OffsetDateTime.parse(value).toInstant().toEpochMilli();}
    catch(DateTimeParseException local){until=LocalDateTime.parse(value).atZone(ZoneId.systemDefault()).toInstant().toEpochMilli();}
   }
   else if(expiry instanceof Long){until=(Long)expiry;if(until<100000000000L)until=Math.multiplyExact(until,1000);}
   else return null;
   return until;
  }catch(RuntimeException invalid){return null;}
 }
}
