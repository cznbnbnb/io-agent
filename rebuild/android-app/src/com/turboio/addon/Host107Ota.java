package com.turboio.addon;

import android.os.*;
import java.util.*;
import java.util.concurrent.atomic.*;

/** Exact 1.0.7 SDK submission/event adapter. Never implements BLE fragmentation or auth. */
final class Host107Ota {
 interface Receipt {void received(boolean ok);}
 interface Receiver {void receive(String peer,byte[] bytes);void fault(String reason);}
 private static final Handler MAIN=new Handler(Looper.getMainLooper());
 private static final AtomicInteger queued=new AtomicInteger();
 private static final AtomicBoolean faultQueued=new AtomicBoolean();
 private static final Map<String,String> states=new HashMap<>();
 private static long connectionGeneration;private static String previous;
 private static volatile Receiver receiver;
 static void receive(Receiver next){main();receiver=next;}
 static void replacePayload(Object message,byte[] bytes)throws Exception{java.lang.reflect.Field payload=message.getClass().getDeclaredField("e");payload.setAccessible(true);payload.set(message,bytes);}
 static void observeVendorReceipt(Object message,OfficialSdkReceipt.Observer observer)throws Exception{java.lang.reflect.Field callback=message.getClass().getDeclaredField("k");callback.setAccessible(true);Object original=callback.get(message);if(original!=null)callback.set(message,OfficialSdkReceipt.wrap(NavReflect.type("kotlin.jvm.functions.Function2"),original,message,observer));}
 private static void main(){if(Looper.myLooper()!=Looper.getMainLooper())throw new IllegalStateException("OTA_THREAD");}
 static Fixed60Session.Link link(){
  main();String peer=Host107Connection.otaPeer();
  if(!Objects.equals(previous,peer)){previous=peer;connectionGeneration++;}
  return new Fixed60Session.Link(peer,connectionGeneration);
 }
 static void send(Object owner,Fixed60Session.Link link,byte[] frame,Receipt receipt){
  main();AtomicBoolean completed=new AtomicBoolean();
  java.util.function.Consumer<Boolean> done=ok->{if(completed.compareAndSet(false,true))MAIN.post(()->receipt.received(ok));};
  try{
   Fixed60Session.Link current=link();if(link.peer==null||link.peer.isEmpty()||!link.peer.equals(current.peer)||link.generation!=current.generation)throw new IllegalStateException("OTA_LINK_CHANGED");
   Object manager=NavReflect.field(NavReflect.type("E3.u"),"h"),business=NavReflect.call(NavReflect.type("P3.h"),"valueOf","MARS_FOTA"),priority=NavReflect.call(NavReflect.type("E3.b"),"valueOf","NORMAL");
   byte[] expected=frame.clone();Object message=NavReflect.make("E3.Q",expected,UUID.randomUUID().toString(),link.peer,business,null,priority,false,false,null,null);
   Object callback=NavReflect.proxy("kotlin.jvm.functions.Function2",(name,args)->done.accept(args.length==2&&args[0]==message&&args[1]==null));
   FirmwareQueue.submit(owner,message,link.peer,expected,ProductInfo.OTA_WRITES_ENABLED,()->NavReflect.call(manager,"u",message,callback));
  }catch(Exception failure){done.accept(false);}
 }
 /** Native owner or verified stock observer. Stock event delivery is always preserved. */
 static boolean event(String kind,Map<?,?> data){
  if(data==null||kind==null)return false;
  Receiver target=receiver;
  if(Arrays.asList("bleStateChanged","brStateChanged","bondStateChanged").contains(kind)){
   Object raw=data.get("device"),state=data.get("newState");String id=raw instanceof Map?small(((Map<?,?>)raw).get("id"),256):"",value=small(state,64);
   if(!id.isEmpty()&&!value.isEmpty()&&queued.incrementAndGet()<=16)MAIN.post(()->{try{String key=kind+":"+id,old=states.put(key,value);if(id.equals(previous)&&old!=null&&!old.equals(value))connectionGeneration++;if(states.size()>192){states.clear();connectionGeneration++;}}finally{queued.decrementAndGet();}});
   else if(!id.isEmpty()&&!value.isEmpty()){queued.decrementAndGet();fault(target);}
   return false;
  }
  if(!"messageReceived".equals(kind)||target==null)return false;
  Object raw=data.get("message");if(!(raw instanceof Map))return false;Map<?,?> message=(Map<?,?>)raw;
  if(HostBusiness.id(message.get("businessId"))!=9)return false;
  String peer=small(message.get("deviceId"),256);Object payload=message.get("payload");
  if(peer.isEmpty()||!(payload instanceof byte[])||((byte[])payload).length>8192){fault(target);return true;}
  if(queued.incrementAndGet()>16){queued.decrementAndGet();fault(target);return true;}
  byte[] bytes=((byte[])payload).clone();MAIN.post(()->{try{if(receiver==target)target.receive(peer,bytes);}finally{queued.decrementAndGet();}});return true;
 }
 private static String small(Object value,int limit){return value instanceof String&&((String)value).length()<=limit?(String)value:"";}
 private static void fault(Receiver target){if(target!=null&&faultQueued.compareAndSet(false,true))MAIN.post(()->{faultQueued.set(false);if(receiver==target)target.fault("OTA_EVENT_BUDGET");});}
}
