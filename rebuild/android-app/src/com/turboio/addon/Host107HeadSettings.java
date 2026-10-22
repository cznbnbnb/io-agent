package com.turboio.addon;

import android.os.*;
import java.util.*;
import java.util.concurrent.atomic.AtomicBoolean;

/** Exact pinned-host launcher adapter. Device application is proved by type4, never SDK ACK. */
final class Host107HeadSettings {
 private static final Handler MAIN=new Handler(Looper.getMainLooper());
 static void send(HeadGestureSession session,Fixed60Session.Link bound,HeadGestureSession.Emission emission,Host107Ota.Receipt receipt){
  AtomicBoolean completed=new AtomicBoolean();final Object[] owned={null};
  java.util.function.Consumer<Boolean> done=ok->{if(completed.compareAndSet(false,true)){if(owned[0]!=null)HeadGestureGate.retire(owned[0]);MAIN.post(()->receipt.received(ok));}};
  try{
   if(Looper.myLooper()!=Looper.getMainLooper()||FirmwareQueue.busy())throw new IllegalStateException();
   Fixed60Session.Link current=Host107Ota.link();
   if(!Objects.equals(bound.peer,current.peer)||bound.generation!=current.generation||!session.permits(emission,current.peer,current.generation,SystemClock.elapsedRealtime()))throw new IllegalStateException();
   OtaFrame frame=OtaFrame.decode(emission.bytes);Map<String,Object> body=BoundedJson.map(frame.json);
   if(frame.binary.length!=0||!(frame.type==4&&"request_general_settings".equals(body.get("cmd"))||frame.type==5&&"head_gestures".equals(body.get("cmd"))))throw new IllegalStateException();
   Object manager=NavReflect.field(NavReflect.type("E3.u"),"h"),business=NavReflect.call(NavReflect.type("P3.h"),"valueOf","LAUNCHER"),priority=NavReflect.call(NavReflect.type("E3.b"),"valueOf","NORMAL");
   Object wire=NavReflect.field(business,"b");if(!(wire instanceof Number)||((Number)wire).intValue()!=15)throw new IllegalStateException();
   Object message=NavReflect.make("E3.Q",emission.bytes.clone(),UUID.randomUUID().toString(),bound.peer,business,null,priority,false,false,null,null);owned[0]=message;
   if(!HeadGestureGate.register(message,bound.peer,emission.bytes,()->session.permits(emission,bound.peer,bound.generation,SystemClock.elapsedRealtime())))throw new IllegalStateException();
   Object callback=NavReflect.proxy("kotlin.jvm.functions.Function2",(name,args)->done.accept(args.length==2&&args[0]==message&&args[1]==null));
   MAIN.postDelayed(()->done.accept(false),HeadGestureSession.SDK_MS);
   NavReflect.call(manager,"u",message,callback);
  }catch(Exception failure){done.accept(false);}
 }
}
