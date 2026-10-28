package com.turboio.addon;

/** Exact 1.0.10(258) mapping, audited against the pinned input DEX. */
public final class Host107Abi {
 static String className(String legacy){
  switch(legacy){
   case "Ab.a":return "zc.a";
   case "E3.Q":return "O4.V";
   case "E3.V":return "O4.Y";
   case "E3.b":return "O4.c";
   case "E3.u":return "O4.v";
   case "P3.A":return "a5.A";
   case "P3.Q":return "a5.Q";
   case "P3.h":return "a5.h";
   case "Q3.p":return "b5.p";
   case "Q3.q":return "b5.q";
   case "Y3.C":return "O4.G";
   case "Y3.D":return "O4.H";
   case "Y3.N":return "O4.Q";
   case "Y3.S":return "O4.V";
   case "Y3.V":return "O4.Y";
   case "Y3.b":return "O4.c";
   case "Y3.g":return "O4.h";
   case "Y3.l":return "O4.m";
   case "Y3.o":return "O4.p";
   case "Y3.u":return "O4.v";
   case "Y3.u$a":return "O4.v$a";
   case "com.rayneo.rayneo_venus_sdk_plugin.f":return "com.rayneo.rayneo_venus_sdk_plugin.g";
   case "com.rayneo.rayneo_venus_sdk_plugin.h":return "com.rayneo.rayneo_venus_sdk_plugin.i";
   case "com.rayneo.rayneo_venus_sdk_plugin.h$b":return "com.rayneo.rayneo_venus_sdk_plugin.i$b";
   case "com.rayneo.rayneo_venus_sdk_plugin.j":return "com.rayneo.rayneo_venus_sdk_plugin.k";
   case "fa.d":return "fb.d";
   case "g7.o":return "b8.o";
   case "g7.q":return "b8.r";
   case "j4.A":return "a5.A";
   case "j4.F":return "a5.F";
   case "j4.H":return "a5.H";
   case "j4.Q":return "a5.Q";
   case "j4.h":return "a5.h";
   case "j4.w":return "a5.w";
   case "k4.p":return "b5.p";
   case "k4.q":return "b5.q";
   case "k8.k":return "g9.l";
   case "m8.E1":return "i9.F1";
   case "m8.F1":return "i9.G1";
   case "m8.k":return "i9.k";
   case "m8.x1":return "i9.z1";
   case "m8.y1":return "i9.A1";
   case "o8.m":return "k9.o";
   case "p8.a":return "l9.a";
   case "p8.e":return "l9.e";
   case "p8.g":return "l9.g";
   case "p8.k":return "l9.l";
   case "p8.o":return "l9.p";
   case "q8.c$c":return "m9.c$c";
   case "s8.a":return "o9.a";
   case "t8.b$b":return "p9.b$b";
   case "u4.m":return "l5.m";
   case "y8.d":return "u9.e";
   case "za.a0":return "yb.a0";
   case "za.n":return "yb.n";
   default:return legacy;
  }
 }
 static String fieldName(Class<?> owner,String legacy){
  if(owner.getName().equals("com.rayneo.rayneo_venus_sdk_plugin.k"))switch(legacy){case "f":return "g";case "H":return "I";case "I":return "J";case "K":return "L";case "J":return "K";}
  if(owner.getName().equals("a5.F"))switch(legacy){case "i":return "VENUS";case "h":return "V4";}
  if(owner.getName().equals("a5.H"))switch(legacy){case "b":return "LOW_BLE";case "c":return "HIGH_SPP";}
  if(owner.getName().equals("a5.w"))switch(legacy){case "c":return "SHARE";}
  if(owner.getName().equals("b5.q"))switch(legacy){case "b":return "SmallCore";case "c":return "LargeCore";}
  if(owner.getName().equals("i9.G1"))switch(legacy){case "b":return "STOPPED";}
  if(owner.getName().equals("a5.A"))switch(legacy){case "r":return "MESSAGE_SEND_FAILED";}
  return legacy;
 }
 static String methodName(Class<?> owner,String legacy,Object[] args){
  if(owner.getName().equals("O4.v")){
   if(legacy.equals("u")&&args.length==2)return "t";
   if(legacy.equals("v")&&args.length==4)return "u";
   if(legacy.equals("g")&&args.length==0)return "i";
   if(legacy.equals("h")&&args.length==0)return "j";
  }
  if(owner.getName().equals("com.rayneo.rayneo_venus_sdk_plugin.i"))switch(legacy){case "j":return "m";case "k":return "n";case "d":return "e";case "e":return "h";case "o":return "r";}
  return legacy;
 }
 /** P1: native OTA writes remain blocked until this exact host/candidate is accepted. */
 public static boolean allowQueue(Object message){
  try{
   Object business=NavReflect.field(message,"c");
   if(!(business instanceof Enum))return false;
   String kind=((Enum<?>)business).name();
   Object peer=null;try{peer=NavReflect.field(message,"b");}catch(Exception ignored){}
   if(!kind.equals("MARS_FOTA")){
    String destination=peer instanceof String?(String)peer:null;
    // Stock auth targets the peripheral identifier; connected C.a is D.a(mainBtMAC).
    // Translate only a valid MAC for pairing policy. The actual SDK message stays untouched.
    if(kind.equals("CONNECTION_PAIRING")&&FirmwareQueue.busy()&&!FirmwareQueue.matchesPeer(destination)&&destination!=null&&destination.matches("(?i)(?:[0-9a-f]{12}|(?:[0-9a-f]{2}:){5}[0-9a-f]{2})"))try{
     Object canonical=NavReflect.call(NavReflect.type("Y3.D"),"a",destination);
     if(canonical instanceof String&&((String)canonical).matches("[a-fA-F0-9]{32}")&&FirmwareQueue.matchesPeer((String)canonical))return FirmwareQueue.allow(kind,message,(String)canonical,null);
    }catch(Exception unavailable){}
    if(!FirmwareQueue.allow(kind,message,destination,null))return false;
    if(kind.equals("RECORDING_SERVICE")||kind.equals("VOICE_ASSISTANT")||kind.equals("AI_SUBTITLE")||kind.equals("TELEPROMPTER")){
     Object bytes=NavReflect.field(message,"e");if(!(bytes instanceof byte[]))return false;
     byte[] frozen=((byte[])bytes).clone();java.lang.reflect.Field payload=message.getClass().getDeclaredField("e");payload.setAccessible(true);payload.set(message,frozen);
     if(kind.equals("RECORDING_SERVICE"))RecordingTrace.frame("tx",14,frozen);
     if(!Host107Recording.allowQueue(message,kind,destination,frozen))return false;
    }
    if(kind.equals("LAUNCHER")||kind.equals("NOTIFICATION")){
     Object bytes=NavReflect.field(message,"e");if(!(bytes instanceof byte[]))return false;
     byte[] frozen=((byte[])bytes).clone();java.lang.reflect.Field payload=message.getClass().getDeclaredField("e");payload.setAccessible(true);payload.set(message,frozen);
     if(kind.equals("LAUNCHER"))LifelogTrace.frame("tx",frozen);
     return kind.equals("LAUNCHER")?HeadGestureGate.allow(message,destination,frozen):SuggestionGate.allow(message,destination,frozen);
    }
    return true;
   }
   Object bytes=NavReflect.field(message,"e");if(!(bytes instanceof byte[])||((byte[])bytes).length>65536)return false;
   // Detach vendor-owned buffers before policy approval; the SDK reads this very field.
   byte[] frozen=((byte[])bytes).clone();java.lang.reflect.Field payload=message.getClass().getDeclaredField("e");payload.setAccessible(true);payload.set(message,frozen);
   RecordingTrace.frame("tx",9,frozen);
   return FirmwareQueue.allow(kind,message,peer instanceof String?(String)peer:null,frozen);
  }catch(Exception error){return false;}
 }
 public static boolean allowFile(){return !ProductInfo.OFFICIAL_OTA_PREPARATION&&!ProductInfo.OFFICIAL_OTA_GUARDED&&!FirmwareQueue.busy();}
}
