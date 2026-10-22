package com.turboio.addon;

import java.util.*;

/** Exact Linux process identity for a local native ASR instance. Process exit does
 * not prove remote task cancellation, transcript completeness, or glasses mic stop. */
final class VoiceProcessProof {
 private static final Set<String> FIELDS=Collections.unmodifiableSet(new HashSet<>(Arrays.asList("schema","attempt","token","pid","start_ticks")));
 static final class Stamp {
  final int pid;
  final long startTicks;
  private Stamp(int pid,long startTicks){this.pid=pid;this.startTicks=startTicks;}
 }
 private VoiceProcessProof(){}
 private static void require(boolean valid,String code){if(!valid)throw new IllegalArgumentException(code);}
 private static void owner(String attempt,String token){
  require(attempt!=null&&attempt.matches("[a-f0-9]{32}")&&token!=null&&token.matches("[a-f0-9]{32}"),"VOICE_PROCESS_OWNER_INVALID");
 }
 static byte[] record(String attempt,String token,int pid,long startTicks){
  owner(attempt,token);require(pid>0&&startTicks>0,"VOICE_PROCESS_STAMP_INVALID");
  return WireJson.bytes(WireJson.object("schema",1,"attempt",attempt,"token",token,"pid",pid,"start_ticks",startTicks));
 }
 private static long positive(String value,long max){
  require(value!=null&&value.length()<=19&&value.matches("[1-9][0-9]*"),"VOICE_PROCESS_STAT_INVALID");
  try{long number=Long.parseLong(value);require(number>0&&number<=max,"VOICE_PROCESS_STAT_INVALID");return number;}
  catch(NumberFormatException invalid){throw new IllegalArgumentException("VOICE_PROCESS_STAT_INVALID");}
 }
 static Stamp parseStat(byte[] utf8){
  require(utf8!=null&&utf8.length>0&&utf8.length<=8192,"VOICE_PROCESS_STAT_INVALID");
  String line;
  try{line=BoundedJson.utf8(utf8);}catch(RuntimeException invalid){throw new IllegalArgumentException("VOICE_PROCESS_STAT_INVALID");}
  // comm is not escaped by procfs and may contain spaces, newlines and ')'.
  // Fields after its final ')' contain no parentheses.
  int open=line.indexOf('('),close=line.lastIndexOf(')');
  require(open>=2&&close>open&&line.charAt(open-1)==' '&&close+1<line.length()&&line.charAt(close+1)==' ',"VOICE_PROCESS_STAT_INVALID");
  int pid=(int)positive(line.substring(0,open-1),Integer.MAX_VALUE);
  String tail=line.substring(close+1).trim();
  require(!tail.isEmpty(),"VOICE_PROCESS_STAT_INVALID");
  String[] fields=tail.split("[ \\t\\r\\n]+");
  require(fields.length>=20&&fields[0].matches("[A-Za-z]"),"VOICE_PROCESS_STAT_INVALID");
  long start=positive(fields[19],Long.MAX_VALUE); // tail[0] is field 3; starttime is field 22.
  return new Stamp(pid,start);
 }
 private static Stamp recorded(byte[] raw,String attempt,String token){
  owner(attempt,token);require(raw!=null&&raw.length>0&&raw.length<=8192,"VOICE_PROCESS_RECORD_INVALID");
  Map<String,Object> value;
  try{value=WireJson.map(WireJson.read(raw,8192,32));}catch(RuntimeException invalid){throw new IllegalArgumentException("VOICE_PROCESS_RECORD_INVALID");}
  require(value.keySet().equals(FIELDS)&&Long.valueOf(1).equals(value.get("schema")),"VOICE_PROCESS_RECORD_INVALID");
  require(attempt.equals(value.get("attempt"))&&token.equals(value.get("token")),"VOICE_PROCESS_OWNER_MISMATCH");
  Object pid=value.get("pid"),ticks=value.get("start_ticks");
  require(pid instanceof Long&&ticks instanceof Long,"VOICE_PROCESS_RECORD_INVALID");
  long p=(Long)pid,t=(Long)ticks;
  require(p>0&&p<=Integer.MAX_VALUE&&t>0,"VOICE_PROCESS_RECORD_INVALID");
  return new Stamp((int)p,t);
 }
 static int ownerPid(byte[] raw,String attempt,String token){return recorded(raw,attempt,token).pid;}
 static boolean ended(byte[] raw,String attempt,String token,Stamp observed,boolean absentConfirmed){
  Stamp prior=recorded(raw,attempt,token);
  require(!absentConfirmed||observed==null,"VOICE_PROCESS_OBSERVATION_INVALID");
  if(observed==null)return absentConfirmed;
  require(observed.pid==prior.pid,"VOICE_PROCESS_OBSERVATION_MISMATCH");
  return observed.startTicks!=prior.startTicks;
 }
}
