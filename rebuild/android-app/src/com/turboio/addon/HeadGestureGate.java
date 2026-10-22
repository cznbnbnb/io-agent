package com.turboio.addon;

import java.util.*;
import java.util.function.BooleanSupplier;
import java.lang.ref.WeakReference;

/** Synchronous SDK admission observer; a newer user preference revokes card authority first. */
final class HeadGestureGate {
 interface Observer {
  boolean userWrite(String peer,HeadGestureSession.Setting setting);
  boolean unknownWrite(String peer);
 }
 private static volatile Observer observer;
 private static final WeakHashMap<Object,Own> own=new WeakHashMap<>();
 private static final class Own {
  final WeakReference<Object> identity;final String peer;final byte[] bytes;volatile BooleanSupplier valid;
  Own(Object message,String peer,byte[] bytes,BooleanSupplier valid){identity=new WeakReference<>(message);this.peer=peer;this.bytes=bytes.clone();this.valid=valid;}
 }
 static void observe(Observer next){observer=next;}
 static synchronized boolean register(Object message,String peer,byte[] bytes,BooleanSupplier valid){
  if(own.size()>=128||own.containsKey(message))return false;own.put(message,new Own(message,peer,bytes,valid));return true;
 }
 // Keep a weak tombstone: an SDK-delayed submission must not become a fresh user preference.
 static synchronized void retire(Object message){Own item=own.get(message);if(item!=null&&item.identity.get()==message)item.valid=()->false;}
 static boolean allow(Object message,String peer,byte[] bytes){
  Own request;synchronized(HeadGestureGate.class){request=own.get(message);}
  if(request!=null)return request.identity.get()==message&&Objects.equals(request.peer,peer)&&Arrays.equals(request.bytes,bytes)&&request.valid.getAsBoolean();
  Observer target=observer;if(target==null)return true;
  try{
   OtaFrame frame=OtaFrame.decode(bytes);if(frame.type!=5||frame.binary.length!=0)return true;
   Map<String,Object> root=BoundedJson.map(frame.json);if(!"head_gestures".equals(root.get("cmd")))return true;
   try{BoundedJson.keys(root,"cmd","payload");Map<String,Object> payload=BoundedJson.map(root.get("payload"));BoundedJson.keys(payload,"value","mode","data");
    if(!"".equals(payload.get("data")))return target.unknownWrite(peer);
    return target.userWrite(peer,new HeadGestureSession.Setting(BoundedJson.number(payload.get("value"),0,1)==1,BoundedJson.number(payload.get("mode"),0,1)));
   }catch(RuntimeException invalidHead){return target.unknownWrite(peer);}
  }catch(RuntimeException malformed){return target.unknownWrite(peer);}
 }
 private HeadGestureGate(){}
}
