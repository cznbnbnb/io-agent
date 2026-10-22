package com.turboio.addon;

/** Exact 1.0.7(230) mapping, audited against the pinned input DEX. */
public final class Host107Abi {
 static String className(String legacy){
  switch(legacy){
   case "E3.u":return "Y3.u";case "E3.Q":return "Y3.S";case "E3.V":return "Y3.V";
   case "E3.b":return "Y3.b";case "P3.h":return "j4.h";case "P3.Q":return "j4.Q";
   case "P3.A":return "j4.A";case "Q3.q":return "k4.q";case "Q3.p":return "k4.p";
   default:return legacy;
  }
 }
 static String methodName(Class<?> owner,String legacy,Object[] args){
  if(owner.getName().equals("Y3.u")){
   if(legacy.equals("u")&&args.length==2)return "t";
   if(legacy.equals("v")&&args.length==4)return "u";
  }
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
     if(!Host107Recording.allowQueue(message,kind,destination,frozen))return false;
    }
    if(kind.equals("LAUNCHER")||kind.equals("NOTIFICATION")){
     Object bytes=NavReflect.field(message,"e");if(!(bytes instanceof byte[]))return false;
     byte[] frozen=((byte[])bytes).clone();java.lang.reflect.Field payload=message.getClass().getDeclaredField("e");payload.setAccessible(true);payload.set(message,frozen);
     return kind.equals("LAUNCHER")?HeadGestureGate.allow(message,destination,frozen):SuggestionGate.allow(message,destination,frozen);
    }
    return true;
   }
   Object bytes=NavReflect.field(message,"e");if(!(bytes instanceof byte[])||((byte[])bytes).length>65536)return false;
   // Detach vendor-owned buffers before policy approval; the SDK reads this very field.
   byte[] frozen=((byte[])bytes).clone();java.lang.reflect.Field payload=message.getClass().getDeclaredField("e");payload.setAccessible(true);payload.set(message,frozen);
   return FirmwareQueue.allow(kind,message,peer instanceof String?(String)peer:null,frozen);
  }catch(Exception error){return false;}
 }
 public static boolean allowFile(){return !ProductInfo.OFFICIAL_OTA_PREPARATION&&!ProductInfo.OFFICIAL_OTA_GUARDED&&!FirmwareQueue.busy();}
}
