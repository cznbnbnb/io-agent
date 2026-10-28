package com.turboio.addon;
import java.util.*;
import android.os.Handler;

/** Production observer against the pinned 1.0.10 SDK shape; synthetic reflection boundary. */
public final class PrompterSharePortTest {
 public enum Ability {SHARE;public static final Ability c=SHARE;}
 public enum ChannelKind {LOW_BLE,HIGH_SPP;public static final ChannelKind b=LOW_BLE,c=HIGH_SPP;}
 public enum Business {FILE_TRANSFER,LAUNCHER}
 public interface ShareObserver {Ability a();void c(Message message);ChannelKind[] d();}
 public static final class Message {public final Business p;public final String a;public final byte[] i;public Message(Business b,String peer,byte[] payload){p=b;a=peer;i=payload;}}
 public static final class Channel {public final List<Object> h=new java.util.concurrent.CopyOnWriteArrayList<>(),i=new java.util.concurrent.CopyOnWriteArrayList<>();}
 public static final class Registry {public static final Registry live=new Registry();public static final Companion d=new Companion();public final Map<String,Object> a=new LinkedHashMap<>();}
 public static final class Companion {public Registry a(){return Registry.live;}}
 public static final class Identity {public static final String FIRST="0123456789abcdef0123456789abcdef";public static String a(String peer){return peer.equals("02:00:00:00:00:01")?FIRST:null;}}
 static int checks;
 static void yes(boolean condition,String name){checks++;if(!condition)throw new AssertionError(name);}
 public static void main(String[] args)throws Exception{
  Channel first=new Channel(),second=new Channel();Object stockLife=new Object(),stockIo=new Object();
  first.h.add(stockLife);first.i.add(stockIo);Registry.live.a.put("first",first);Registry.live.a.put("second",second);Registry.live.a.put("unrelated",new Object());
  yes(PrompterSharePort.attach(),"SHARE_ATTACH");
  yes(first.i.size()==2&&second.i.size()==1,"SHARE_RX_LIST");yes(first.h.size()==1&&first.h.get(0)==stockLife,"SHARE_LIFECYCLE_UNCHANGED");yes(first.i.get(0)==stockIo,"SHARE_STOCK_OBSERVER_PRESERVED");
  ShareObserver observer=(ShareObserver)first.i.get(1);yes(observer==second.i.get(0),"SHARE_SAME_OBSERVER");yes(observer.a()==Ability.SHARE,"SHARE_ABILITY");
  ChannelKind[] kinds=observer.d();yes(Arrays.equals(kinds,new ChannelKind[]{ChannelKind.LOW_BLE,ChannelKind.HIGH_SPP}),"SHARE_CHANNEL_KINDS");kinds[0]=null;yes(observer.d()[0]==ChannelKind.LOW_BLE,"SHARE_CHANNEL_KINDS_COPY");
  byte[] payload={8,9,10};observer.c(new Message(Business.FILE_TRANSFER,"02:00:00:00:00:01",payload));yes(NewsTele.bytes==null,"SHARE_MAIN_HANDOFF_DEFERRED");payload[0]=99;Handler.drain();yes(Arrays.equals(NewsTele.bytes,new byte[]{8,9,10}),"SHARE_PAYLOAD_FROZEN");yes(NewsTele.peer.equals(Identity.FIRST),"SHARE_CANONICAL_PEER");
  int received=NewsTele.received;observer.c(new Message(Business.LAUNCHER,"peer",new byte[]{1}));observer.c(new Message(Business.FILE_TRANSFER,"peer",new byte[8193]));Handler.drain();yes(NewsTele.received==received,"SHARE_OTHER_BUSINESS_AND_BUDGET");
  yes(PrompterSharePort.attach(),"SHARE_REATTACH");yes(first.i.size()==2&&second.i.size()==1,"SHARE_NO_DUPLICATE");PrompterSharePort.detach();yes(first.i.size()==1&&first.i.get(0)==stockIo&&second.i.isEmpty(),"SHARE_DETACH_EXACT");yes(first.h.size()==1&&first.h.get(0)==stockLife,"SHARE_DETACH_LIFECYCLE_UNCHANGED");
  Registry.live.a.clear();yes(!PrompterSharePort.attach(),"SHARE_NO_CHANNEL_REFUSED");
  System.out.println("Prompter SHARE: "+checks+" checks passed");
 }
}
final class NativeTransfer {static final Handler MAIN=new Handler();}
final class NewsTele {static byte[] bytes;static String peer;static int received;static void receiveFile(String p,byte[] b){peer=p;bytes=b;received++;}}

/** SDK names are mapped to portable stand-ins; pinned real descriptors are checked by verifyHost. */
final class NavReflect {
 static Class<?> type(String name){switch(name){case "Y3.g":return PrompterSharePortTest.ShareObserver.class;case "j4.H":return PrompterSharePortTest.ChannelKind.class;case "j4.w":return PrompterSharePortTest.Ability.class;case "Y3.o":return PrompterSharePortTest.Registry.class;case "Y3.l":return PrompterSharePortTest.Channel.class;case "Y3.D":return PrompterSharePortTest.Identity.class;default:throw new AssertionError(name);}}
 static Object field(Object target,String name)throws Exception{Class<?> c=target instanceof Class?(Class<?>)target:target.getClass();return c.getField(name).get(target instanceof Class?null:target);}
 static Object call(Object target,String name,Object...args)throws Exception{Class<?> c=target instanceof Class?(Class<?>)target:target.getClass();return c.getMethod(name,args.length==0?new Class<?>[0]:new Class<?>[]{String.class}).invoke(target instanceof Class?null:target,args);}
}
