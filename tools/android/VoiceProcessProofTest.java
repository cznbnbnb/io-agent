package com.turboio.addon;

import java.nio.charset.StandardCharsets;
import java.util.*;

/** Synthetic procfs/JSON fixtures only; these tests do not inspect or stop a process. */
final class VoiceProcessProofTest {
 private static final String ATTEMPT="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",TOKEN="bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",OTHER="cccccccccccccccccccccccccccccccc";
 private static int checks;
 private static void yes(boolean valid){checks++;if(!valid)throw new AssertionError("process proof assertion "+checks);}
 private static byte[] bytes(String value){return value.getBytes(StandardCharsets.UTF_8);}
 private static String stat(String pid,String comm,String ticks){StringBuilder s=new StringBuilder(pid+" ("+comm+") S");for(int field=4;field<=21;field++)s.append(" 0");return s.append(' ').append(ticks).append(" 0 0\n").toString();}
 private static VoiceProcessProof.Stamp stamp(int pid,long ticks){return VoiceProcessProof.parseStat(bytes(stat(Integer.toString(pid),"synthetic",Long.toString(ticks))));}
 private static void rejects(Runnable work){try{work.run();throw new AssertionError("invalid process proof accepted");}catch(IllegalArgumentException denied){yes(denied.getMessage()!=null&&denied.getMessage().matches("VOICE_PROCESS_[A-Z_]+")&&denied.getCause()==null);}}
 private static void recordChanged(String field,Object value){Map<String,Object> row=WireJson.map(WireJson.read(VoiceProcessProof.record(ATTEMPT,TOKEN,42,123)));row.put(field,value);rejects(()->VoiceProcessProof.ownerPid(WireJson.bytes(row),ATTEMPT,TOKEN));}
 static void run(){
  byte[] record=VoiceProcessProof.record(ATTEMPT,TOKEN,42,123);
  yes(VoiceProcessProof.ownerPid(record,ATTEMPT,TOKEN)==42);
  yes(!VoiceProcessProof.ended(record,ATTEMPT,TOKEN,stamp(42,123),false));
  yes(VoiceProcessProof.ended(record,ATTEMPT,TOKEN,stamp(42,124),false));
  yes(VoiceProcessProof.ended(record,ATTEMPT,TOKEN,stamp(42,122),false));
  yes(VoiceProcessProof.ended(record,ATTEMPT,TOKEN,null,true));
  yes(!VoiceProcessProof.ended(record,ATTEMPT,TOKEN,null,false));
  rejects(()->VoiceProcessProof.ended(record,ATTEMPT,TOKEN,stamp(43,124),false));
  rejects(()->VoiceProcessProof.ended(record,ATTEMPT,TOKEN,stamp(42,123),true));
  rejects(()->VoiceProcessProof.ended(record,OTHER,TOKEN,null,true));rejects(()->VoiceProcessProof.ended(record,ATTEMPT,OTHER,null,true));
  for(String comm:new String[]{"spaces in name","right)paren","both (()) ) x","line\nnew\tname","进程)",""}){
   VoiceProcessProof.Stamp s=VoiceProcessProof.parseStat(bytes(stat("42",comm,"123")));yes(s.pid==42&&s.startTicks==123);
  }
  VoiceProcessProof.Stamp max=stamp(Integer.MAX_VALUE,Long.MAX_VALUE);yes(max.pid==Integer.MAX_VALUE&&max.startTicks==Long.MAX_VALUE);
  VoiceProcessProof.Stamp min=stamp(1,1);yes(min.pid==1&&min.startTicks==1);
  byte[] maximum=VoiceProcessProof.record(ATTEMPT,TOKEN,Integer.MAX_VALUE,Long.MAX_VALUE);yes(!VoiceProcessProof.ended(maximum,ATTEMPT,TOKEN,max,false));
  for(String bad:new String[]{"0","-1","+1","2147483648","999999999999999999999","42x"," 42","042"})rejects(()->VoiceProcessProof.parseStat(bytes(stat(bad,"name","123"))));
  for(String bad:new String[]{"0","-1","+1","9223372036854775808","999999999999999999999","1.0","1e3","0123"})rejects(()->VoiceProcessProof.parseStat(bytes(stat("42","name",bad))));
  for(String bad:new String[]{"","42 name S 123","42(name) S 123","42 (name)S 123","42 (name) S","42 (name)"})rejects(()->VoiceProcessProof.parseStat(bytes(bad)));
  rejects(()->VoiceProcessProof.parseStat(bytes(stat("42","name","123").replace(") S", ") 1"))));
  rejects(()->VoiceProcessProof.parseStat(new byte[]{(byte)0xc3,(byte)0x28}));rejects(()->VoiceProcessProof.parseStat(null));rejects(()->VoiceProcessProof.parseStat(new byte[8193]));
  byte[] smallStat=bytes(stat("42","name","123")),exactStat=Arrays.copyOf(smallStat,8192);Arrays.fill(exactStat,smallStat.length,8192,(byte)' ');yes(VoiceProcessProof.parseStat(exactStat).startTicks==123);
  for(String bad:new String[]{null,"",OTHER.substring(1),OTHER.toUpperCase(Locale.ROOT)}){
   rejects(()->VoiceProcessProof.record(bad,TOKEN,42,123));rejects(()->VoiceProcessProof.record(ATTEMPT,bad,42,123));
  }
  rejects(()->VoiceProcessProof.record(ATTEMPT,TOKEN,0,123));rejects(()->VoiceProcessProof.record(ATTEMPT,TOKEN,-1,123));
  rejects(()->VoiceProcessProof.record(ATTEMPT,TOKEN,42,0));rejects(()->VoiceProcessProof.record(ATTEMPT,TOKEN,42,-1));
  Map<String,Object> row=WireJson.map(WireJson.read(record));
  for(String key:row.keySet()){
   Map<String,Object> missing=new TreeMap<>(row);missing.remove(key);rejects(()->VoiceProcessProof.ownerPid(WireJson.bytes(missing),ATTEMPT,TOKEN));recordChanged(key,null);
  }
  recordChanged("schema",2);recordChanged("schema","1");recordChanged("unknown",true);recordChanged("pid",2147483648L);recordChanged("pid",0L);recordChanged("pid","42");recordChanged("start_ticks",0L);recordChanged("start_ticks",-1L);recordChanged("start_ticks","123");
  String json=new String(record,StandardCharsets.UTF_8);
  for(String bad:new String[]{json+"{}","{\"pid\":42,"+json.substring(1),"{\"pid\":43,"+json.substring(1),"null","[]","{}",json.replace("\"pid\":42","\"pid\":42.0"),json.replace("\"start_ticks\":123","\"start_ticks\":9223372036854775808")})rejects(()->VoiceProcessProof.ownerPid(bytes(bad),ATTEMPT,TOKEN));
  rejects(()->VoiceProcessProof.ownerPid(null,ATTEMPT,TOKEN));rejects(()->VoiceProcessProof.ownerPid(new byte[]{(byte)0xc3,(byte)0x28},ATTEMPT,TOKEN));
  byte[] exact=Arrays.copyOf(record,8192);Arrays.fill(exact,record.length,8192,(byte)' ');yes(VoiceProcessProof.ownerPid(exact,ATTEMPT,TOKEN)==42);
  rejects(()->VoiceProcessProof.ownerPid(Arrays.copyOf(exact,8193),ATTEMPT,TOKEN));
 }
 public static void main(String[] args){run();System.out.println("voice process proof: "+checks+" assertions passed (synthetic fixtures only)");}
}
