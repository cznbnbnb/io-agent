package com.turboio.addon;

/** Pinned SDK business names/wire values. Never ordinal or substring matching. */
public final class HostBusiness {
 private HostBusiness(){}
 public static int id(Object value){
  if(value instanceof Byte||value instanceof Short||value instanceof Integer||value instanceof Long){long n=((Number)value).longValue();return n==9||n==15||n==19||n==20||n==21?(int)n:-1;}
  if(!(value instanceof String))return -1;
  switch((String)value){
   case "MARS_FOTA":case "9":return 9;
   case "LAUNCHER":case "15":return 15;
   case "AI_SUBTITLE":case "19":return 19;
   case "TELEPROMPTER":case "20":return 20;
   case "NOTIFICATION":case "21":return 21;
   default:return -1;
  }
 }
}
