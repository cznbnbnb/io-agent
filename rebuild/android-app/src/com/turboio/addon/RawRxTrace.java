package com.turboio.addon;

/** Diagnostic (2026-10-23, user: shake twice to leave the task prompter / task recording).
 * HostBusiness only names 9/15/17/19/20/21, so a head-gesture signal on any other business would be
 * dropped unseen. Logs every vendor event kind and every received message's raw business value,
 * length and first bytes. Large frames (audio) are only counted; nothing is changed or blocked. */
final class RawRxTrace {
 private static long large,window;private static int lines;
 private RawRxTrace(){}
 static void event(String kind,java.util.Map<?,?> data){
  try{
   if(!"messageReceived".equals(kind)){if(!"messageSendSuccess".equals(kind))log("TurboIORawRx event="+kind);return;}
   Object raw=data==null?null:data.get("message");if(!(raw instanceof java.util.Map))return;java.util.Map<?,?> m=(java.util.Map<?,?>)raw;
   Object biz=m.get("businessId"),payload=m.get("payload");byte[] b=payload instanceof byte[]?(byte[])payload:new byte[0];
   if(b.length>160){synchronized(RawRxTrace.class){if(++large%100!=1)return;}log("TurboIORawRx b="+biz+" len="+b.length+" large#"+large);return;}
   StringBuilder hex=new StringBuilder();for(int i=0;i<Math.min(b.length,48);i++)hex.append(String.format("%02x",b[i]));
   log("TurboIORawRx b="+biz+" len="+b.length+" hex="+hex+" text="+printable(b));
  }catch(RuntimeException ignored){}
 }
 private static String printable(byte[] b){StringBuilder s=new StringBuilder();for(int i=0;i<Math.min(b.length,120);i++){int c=b[i]&0xff;s.append(c>=32&&c<127?(char)c:'.');}return s.toString();}
 private static void log(String line){
  long now=System.currentTimeMillis()/60000;
  synchronized(RawRxTrace.class){if(now!=window){window=now;lines=0;}if(++lines>600)return;}
  System.out.println(line);
 }
}
