package com.turboio.addon;

import java.nio.charset.StandardCharsets;
import java.util.Map;

/** Durable identity of one question manuscript; never a saved answer or permission to record. */
final class TaskPrompterOwner {
 final String did,peer,binding,id,fingerprint;final long revision,until;final boolean cancelled;
 private TaskPrompterOwner(String did,String peer,String binding,String id,long revision,String fingerprint,long until,boolean cancelled){
  this.did=TaskConnection.text(did,128);this.peer=peer==null?"":peer;this.binding=TaskConnection.text(binding,128);this.id=TaskConnection.text(id,512);this.revision=revision;this.fingerprint=TaskConnection.text(fingerprint,128);this.until=until;this.cancelled=cancelled;
  TaskWire.require(revision>0&&until>0,"TASK_PROMPTER_OWNER_INVALID");
 }
 static long deadline(TaskConnection connection,Map<String,Object> request,long now){return Math.min(now+180000,Math.min(connection.expiresAt,TaskWire.stamp(request.get("expires_at"))));}
 static TaskPrompterOwner create(String did,String peer,TaskConnection connection,Map<String,Object> request,long now){
  return new TaskPrompterOwner(did,TaskConnection.text(peer,256),connection.binding(),(String)request.get("object_id"),TaskWire.positive(request.get("revision")),TaskWire.requestFingerprint(request),deadline(connection,request,now),false);
 }
 static TaskPrompterOwner read(String text){
  try{Map<String,Object> o=WireJson.map(WireJson.read(text.getBytes(StandardCharsets.UTF_8)));return new TaskPrompterOwner((String)o.get("did"),o.containsKey("peer")?(String)o.get("peer"):"",(String)o.get("binding"),(String)o.get("id"),TaskWire.positive(o.get("revision")),(String)o.get("fingerprint"),TaskWire.positive(o.get("until")),Boolean.TRUE.equals(o.get("cancelled")));}catch(RuntimeException invalid){return null;}
 }
 String encode(){return new String(WireJson.bytes(WireJson.object("did",did,"peer",peer,"binding",binding,"id",id,"revision",revision,"fingerprint",fingerprint,"until",until,"cancelled",cancelled)),StandardCharsets.UTF_8);}
 TaskPrompterOwner cancel(){return new TaskPrompterOwner(did,peer,binding,id,revision,fingerprint,until,true);}
 boolean matches(String binding,String id){return (binding==null||this.binding.equals(binding))&&(id==null||this.id.equals(id));}
 boolean live(long now){return !cancelled&&now<until;}
 boolean allows(TaskConnection connection,boolean enabled,Map<String,Object> request,Map<String,Object> parent,boolean phoneFocused,boolean answered,long now){
  try{return live(now)&&connection!=null&&binding.equals(connection.binding())&&connection.expiresAt>now&&enabled&&!phoneFocused&&!answered&&request!=null&&id.equals(request.get("object_id"))&&revision==TaskWire.positive(request.get("revision"))&&fingerprint.equals(TaskWire.requestFingerprint(request))&&TaskWire.same(connection.route(),TaskWire.body(request).get("route"))&&TaskWire.canAnswer(request,parent,now);}catch(RuntimeException invalid){return false;}
 }
}
