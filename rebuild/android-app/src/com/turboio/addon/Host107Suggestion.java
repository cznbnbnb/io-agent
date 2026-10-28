package com.turboio.addon;

import android.os.*;
import java.util.*;
import java.util.concurrent.atomic.AtomicBoolean;

/** All version-specific native suggestion and read-only preflight submission lives here. */
final class Host107Suggestion {
 private static final Handler MAIN=new Handler(Looper.getMainLooper());
 static void sendCard(Fixed60Session.Link bound,AgentCardSession session,AgentCardSession.Emission emission,Host107Ota.Receipt receipt){
  sendOwned(bound,emission.bytes,()->session.permits(emission,bound.peer,bound.generation,SystemClock.elapsedRealtime(),HeadGestureRuntime.permission(session.owner(),bound.peer,bound.generation)),receipt);
 }
 static void sendTodo(Fixed60Session.Link bound,byte[] bytes,java.util.function.BooleanSupplier valid,Host107Ota.Receipt receipt){sendOwned(bound,bytes,valid,receipt);}
 private static void sendOwned(Fixed60Session.Link bound,byte[] bytes,java.util.function.BooleanSupplier valid,Host107Ota.Receipt receipt){
  AtomicBoolean completed=new AtomicBoolean();final Object[] owned={null};
  java.util.function.Consumer<Boolean> done=ok->{if(completed.compareAndSet(false,true)){if(owned[0]!=null)SuggestionGate.retire(owned[0]);MAIN.post(()->receipt.received(ok));}};
  try{
   if(Looper.myLooper()!=Looper.getMainLooper()||FirmwareQueue.busy())throw new IllegalStateException();Fixed60Session.Link current=Host107Ota.link();
   if(bound.peer==null||!bound.peer.equals(current.peer)||bound.generation!=current.generation||!valid.getAsBoolean())throw new IllegalStateException();
   OtaFrame frame=OtaFrame.decode(bytes);if(frame.binary.length!=0||frame.type!=33&&frame.type!=35)throw new IllegalStateException();
   Object manager=NavReflect.field(NavReflect.type("E3.u"),"h"),business=NavReflect.call(NavReflect.type("P3.h"),"valueOf","NOTIFICATION"),priority=NavReflect.call(NavReflect.type("E3.b"),"valueOf","NORMAL");
   Object wire=NavReflect.field(business,"b");if(!(wire instanceof Number)||((Number)wire).intValue()!=21)throw new IllegalStateException();
   Object message=NavReflect.make("E3.Q",bytes.clone(),UUID.randomUUID().toString(),bound.peer,business,null,priority,false,false,null,null);owned[0]=message;
   if(!SuggestionGate.register(message,bound.peer,bytes,valid))throw new IllegalStateException();
   Object callback=NavReflect.proxy("kotlin.jvm.functions.Function2",(name,args)->done.accept(args.length==2&&args[0]==message&&args[1]==null));MAIN.postDelayed(()->done.accept(false),AgentCardSession.SDK_MS);NavReflect.call(manager,"u",message,callback);
  }catch(Exception failure){done.accept(false);}
 }
 static void send(Fixed60Session.Link bound,MinuteCardSession.Emission emission,Host107Ota.Receipt receipt){
  AtomicBoolean completed=new AtomicBoolean();
  java.util.function.Consumer<Boolean> done=ok->{if(completed.compareAndSet(false,true))MAIN.post(()->receipt.received(ok));};
  try{
   if(Looper.myLooper()!=Looper.getMainLooper()||FirmwareQueue.busy())throw new IllegalStateException();
   Fixed60Session.Link current=Host107Ota.link();
   if(bound.peer==null||bound.peer.isEmpty()||!bound.peer.equals(current.peer)||bound.generation!=current.generation)throw new IllegalStateException();
   OtaFrame f=OtaFrame.decode(emission.bytes);
   if(f.binary.length!=0||!(emission.business==9&&(f.type==1||f.type==11)||emission.business==21&&(f.type==33||f.type==35)))throw new IllegalStateException();
   Object manager=NavReflect.field(NavReflect.type("E3.u"),"h"),business=NavReflect.call(NavReflect.type("P3.h"),"valueOf",emission.business==21?"NOTIFICATION":"MARS_FOTA"),priority=NavReflect.call(NavReflect.type("E3.b"),"valueOf","NORMAL");
   // The pinned SDK's NOTIFICATION is wire 21; PROACTIVE_AI is wire 23, a different page.
   Object wire=NavReflect.field(business,"b");if(!(wire instanceof Number)||((Number)wire).intValue()!=emission.business)throw new IllegalStateException();
   Object message=NavReflect.make("E3.Q",emission.bytes.clone(),UUID.randomUUID().toString(),bound.peer,business,null,priority,false,false,null,null);
   Object callback=NavReflect.proxy("kotlin.jvm.functions.Function2",(name,args)->done.accept(args.length==2&&args[0]==message&&args[1]==null));
   NavReflect.call(manager,"u",message,callback);
  }catch(Exception failure){done.accept(false);}
 }
}
