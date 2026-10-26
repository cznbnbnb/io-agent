package com.turboio.addon;

/** Logs LAUNCHER frames that mention the 全天智记 switch, in both directions, and feeds LifelogState.
 * Read-only diagnostic (2026-10-23); nothing is changed or blocked.
 * Pure JVM: Host107Abi, which calls this, is built in the host-policy tests. */
final class LifelogTrace {
 private LifelogTrace(){}
 static void frame(String direction,byte[] bytes){
  if(bytes==null||bytes.length>8192)return;
  LifelogState.observe(direction,bytes);
  try{OtaFrame f=OtaFrame.decode(bytes);String json=String.valueOf(new String(WireJson.bytes(f.json),java.nio.charset.StandardCharsets.UTF_8));
   if(!json.contains("life_log")&&!json.contains("lifelog"))return;
   System.out.println("TurboIOLifelog "+direction+" type="+f.type+" json="+(json.length()>600?json.substring(0,600):json));
  }catch(RuntimeException unreadable){}
 }
}
