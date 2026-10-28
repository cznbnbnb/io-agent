package com.turboio.addon;
import java.lang.reflect.*;import java.util.*;
/** Host 1.0.7 tags inbound FILE_TRANSFER frames with the SHARE ability (Y3.b0) and hands them only
 * to SHARE observers (stock t4.c); the RELAY bridge behind messageReceived never sees them. The
 * prompter pull (ACK, chunk requests, result) therefore needs its own observer on the live channel.
 * Attached for one prompter session only; stock t4.c still logs and ignores the unknown DID. */
final class PrompterSharePort {
 static void trace(String text){android.util.Log.i("TurboIOTransfer",text);}
 private static Object observer;private static final List<List<Object>> attached=new ArrayList<>();
 private static Object create()throws Exception{
  Class<?> g=NavReflect.type("Y3.g"),kind=NavReflect.type("j4.H");Object share=NavReflect.field(NavReflect.type("j4.w"),"c");
  Object[] kinds=(Object[])Array.newInstance(kind,2);kinds[0]=NavReflect.field(kind,"b");kinds[1]=NavReflect.field(kind,"c");
  return Proxy.newProxyInstance(g.getClassLoader(),new Class[]{g},(o,m,a)->{
   if(m.getDeclaringClass()==Object.class){if(m.getName().equals("hashCode"))return System.identityHashCode(o);if(m.getName().equals("equals"))return o==a[0];return "TurboIOPrompterShare";}
   switch(m.getName()){case "a":return share;case "d":return kinds.clone();case "c":if(a!=null&&a.length==1)deliver(a[0]);return null;default:return null;}
  });
 }
 private static void deliver(Object message){
  try{Object business=NavReflect.field(message,"p"),device=NavReflect.field(message,"a"),payload=NavReflect.field(message,"i");
   if(!(business instanceof Enum)||!((Enum<?>)business).name().equals("FILE_TRANSFER")||!(device instanceof String)||!(payload instanceof byte[])||((byte[])payload).length>8192)return;
   // SHARE frames carry the peripheral MAC; the prompter session holds the canonical D.a(MAC) id.
   String d=(String)device;if(d.matches("(?i)(?:[0-9a-f]{2}:){5}[0-9a-f]{2}")){Object canonical=NavReflect.call(NavReflect.type("Y3.D"),"a",d);if(!(canonical instanceof String))return;d=(String)canonical;}
   final String peer=d;byte[] b=((byte[])payload).clone();PrompterSharePort.trace("prompter file-rx bytes="+b.length+" type="+(b.length>0?(b[0]&255)>>>3:-1));
   NativeTransfer.MAIN.post(()->NewsTele.receiveFile(peer,b));
  }catch(Exception ignored){}
 }
 /** Adds the observer to every live channel's IO list; false when none could be reached. */
 @SuppressWarnings("unchecked")
 static synchronized boolean attach(){
  detach();
  try{if(observer==null)observer=create();Object registry=NavReflect.call(NavReflect.field(NavReflect.type("Y3.o"),"d"),"a");Map<?,?> channels=(Map<?,?>)NavReflect.field(registry,"a");Class<?> channel=NavReflect.type("Y3.l");
   for(Object c:channels.values())if(channel.isInstance(c)){List<Object> list=(List<Object>)NavReflect.field(c,"h");if(!list.contains(observer)){list.add(observer);attached.add(list);}}
  }catch(Exception e){detach();return false;}
  PrompterSharePort.trace("prompter share-port channels="+attached.size());return !attached.isEmpty();
 }
 static synchronized void detach(){for(List<Object> list:attached)try{list.remove(observer);}catch(RuntimeException ignored){}attached.clear();}
}
