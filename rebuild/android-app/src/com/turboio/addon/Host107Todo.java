package com.turboio.addon;

import java.util.*;

/** Exact stock push EventSink used locally to refresh the original task cache.
 * No push service message, Microsoft task, or private BLE todo is fabricated. */
final class Host107Todo {
 static boolean refresh(String proposalId){
  try{
   Object companion=NavReflect.field(NavReflect.type("k8.k"),"j"),push=NavReflect.call(companion,"d");
   if(NavReflect.field(push,"o")==null)return false;
   HashMap<String,Object> data=new HashMap<>();data.put("msgId","io-todo-refresh-"+proposalId);
   data.put("content",new String(WireJson.bytes(WireJson.object("type","microsoftTodo.refresh","body",WireJson.object())),java.nio.charset.StandardCharsets.UTF_8));
   NavReflect.call(push,"a","onMessage",data);return true;
  }catch(Exception unavailable){android.util.Log.w("TurboIOTodo","stock task refresh unavailable "+unavailable.getClass().getSimpleName());return false;}
 }
 private Host107Todo(){}
}
