package com.turboio.addon;

/** Diagnostic (2026-10-23, user: stock recording starts with 全天智记 on and shows no "退出全天智记" popup).
 * Logs RECORDING_SERVICE(14) and MARS_FOTA(9) frames in both directions so the stock start, stop and
 * status exchange can be copied. Audio (type 3) is only counted; nothing is changed or blocked.
 * Pure JVM: Host107Abi, which calls this, is built in the host-policy tests. */
final class RecordingTrace {
 private static long audio;
 private RecordingTrace(){}
 static void frame(String direction,int business,byte[] bytes){
  if(bytes==null||bytes.length>16384)return;
  try{OtaFrame f=OtaFrame.decode(bytes);
   if(business==14&&f.type==3){synchronized(RecordingTrace.class){if(++audio%100!=1)return;}System.out.println("TurboIORecTrace "+direction+" b=14 type=3 audio#"+audio);return;}
   String json=new String(WireJson.bytes(f.json),java.nio.charset.StandardCharsets.UTF_8);
   System.out.println("TurboIORecTrace "+direction+" b="+business+" type="+f.type+" bin="+f.binary.length+" json="+(json.length()>500?json.substring(0,500):json));
  }catch(RuntimeException unreadable){System.out.println("TurboIORecTrace "+direction+" b="+business+" undecodable bytes="+bytes.length);}
 }
}
