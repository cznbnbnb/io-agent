package com.turboio.addon;
import java.util.*;
/** SDK transport/connection/lease doubles. Does not assert real ABI or physical idle. */
final class RecordingPlatform {
 static final List<Message> messages=new ArrayList<>();static boolean autoQueue=true;
 static final class Message {final byte[] bytes;final String peer,business;NavReflect.Callback callback;boolean queued;Message(Object[] a){bytes=(byte[])a[0];peer=(String)a[2];business=(String)a[3];}int type(){return OtaFrame.decode(bytes).type;}boolean queue(){boolean allowed=Host107Recording.allowQueue(this,business,peer,bytes);if(allowed)queued=true;return allowed;}void receipt(boolean ok)throws Exception{callback.accept("invoke",new Object[]{this,ok&&queued?null:new IllegalStateException("synthetic SDK failure")});}}
 static List<Message> sent(String business,int type){List<Message> found=new ArrayList<>();for(Message m:messages)if(business.equals(m.business)&&m.type()==type)found.add(m);return found;}
 static Message last(String business,int type){List<Message> found=sent(business,type);return found.get(found.size()-1);}
}
final class NavReflect {
 interface Callback{void accept(String name,Object[] args)throws Exception;}
 static Object type(String name){return name;}
 static Object field(Object target,String field){if(!"E3.u".equals(target)||!"h".equals(field))throw new AssertionError();return "manager";}
 static Object call(Object target,String method,Object...args)throws Exception{
  if("valueOf".equals(method))return args[0];
  if("manager".equals(target)&&"u".equals(method)){RecordingPlatform.Message m=(RecordingPlatform.Message)args[0];m.callback=(Callback)args[1];RecordingPlatform.messages.add(m);if(RecordingPlatform.autoQueue)m.queue();return null;}
  throw new AssertionError("Unexpected host call");
 }
 static Object make(String name,Object...args){if(!"E3.Q".equals(name)||args.length!=10)throw new AssertionError();return new RecordingPlatform.Message(args);}
 static Object proxy(String name,Callback callback){if(!"kotlin.jvm.functions.Function2".equals(name))throw new AssertionError();return callback;}
}
final class Fixed60Session {static final class Link {final String peer;final long generation;Link(String peer,long generation){this.peer=peer;this.generation=generation;}}}
final class Host107Ota {static String peer=VoiceAnswerTest.PEER;static long generation=1;static Fixed60Session.Link link(){return new Fixed60Session.Link(peer,generation);}}
final class NativeTransfer {
 static String owner="";static boolean blocked;
 static boolean acquireMessages(String name){if(blocked||!owner.isEmpty())return false;owner=name;return true;}
 static boolean ownsMessages(String name){return !name.isEmpty()&&owner.equals(name);}
 static void releaseMessages(String name){if(owner.equals(name))owner="";}
}
