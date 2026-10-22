package com.turboio.addon;

import java.util.*;

/** Frozen original request and route, with full-copy native pages. Never contains a credential. */
final class AgentCardRequest {
 static final class Copy {final String title,source,content;Copy(String title,String source,String content){this.title=title;this.source=source;this.content=content;}}
 final String binding,fingerprint,owner,requestId,taskId,computer,agent;
 final long revision,expiresAt;private final Map<String,Object> request;
 private AgentCardRequest(String binding,Map<String,Object> original,String computer,String agent){
  TaskWire.require(binding!=null&&binding.matches("[a-f0-9]{64}"),"TASK_TARGET_CHANGED");
  this.binding=binding;request=TaskWire.object(WireJson.copy(original));TaskWire.require("request".equals(request.get("kind")),"TASK_REQUEST_INVALID");
  Map<String,Object> b=TaskWire.body(request),route=TaskWire.route(b.get("route"));
  TaskWire.require(TaskWire.id(computer).equals(route.get("computer_id"))&&TaskWire.id(agent).equals(route.get("agent_id")),"TASK_ROUTE_MISMATCH");
  this.computer=computer;this.agent=agent;requestId=(String)request.get("object_id");taskId=(String)b.get("task_id");revision=TaskWire.positive(request.get("revision"));expiresAt=TaskWire.stamp(request.get("expires_at"));
  fingerprint=TaskWire.requestFingerprint(request);owner=TaskWire.hash(WireJson.bytes(WireJson.object("binding",binding,"request",fingerprint)));
 }
 static AgentCardRequest prepare(TaskConnection connection,Map<String,Object> request,Map<String,Object> parent,long now){
  TaskWire.object(request);TaskWire.object(parent);TaskWire.require(TaskWire.same(connection.route(),TaskWire.body(request).get("route"))&&TaskWire.canAnswer(request,parent,now),"TASK_REQUEST_CLOSED");
  AgentCardRequest frozen=new AgentCardRequest(connection.binding(),request,connection.computer,connection.agent);frozen.checkCopy();return frozen;
 }
 static AgentCardRequest restore(Object raw){
  Map<String,Object> j=WireJson.map(raw);BoundedJson.keys(j,"schema","binding","fingerprint","request","computer","agent");TaskWire.require(TaskWire.positive(j.get("schema"))==1,"TASK_CARD_STORE_INVALID");
  AgentCardRequest result=new AgentCardRequest(TaskWire.text(j.get("binding"),64,false),WireJson.map(j.get("request")),TaskWire.id(j.get("computer")),TaskWire.id(j.get("agent")));
  TaskWire.require(result.fingerprint.equals(j.get("fingerprint")),"TASK_REQUEST_CHANGED");result.checkCopy();return result;
 }
 Object json(){return WireJson.object("schema",1,"binding",binding,"fingerprint",fingerprint,"request",WireJson.copy(request),"computer",computer,"agent",agent);}
 int size(){return WireJson.list(TaskWire.body(request).get("options")).size();}
 Object option(int index){return WireJson.map(WireJson.list(TaskWire.body(request).get("options")).get(index)).get("option_id");}
 String answerText(int index){return (String)WireJson.map(WireJson.list(TaskWire.body(request).get("options")).get(index)).get("label");}
 String operation(){return "agent-card-"+owner;}
 boolean matches(Map<String,Object> fresh,Map<String,Object> parent,long now){try{TaskWire.object(parent);return TaskWire.canAnswer(fresh,parent,now)&&fingerprint.equals(TaskWire.requestFingerprint(fresh));}catch(RuntimeException invalid){return false;}}
 Copy copy(int index){
  TaskWire.require(index>=0&&index<size(),"TASK_OPTION_INVALID");
  String content=TaskWire.body(request).get("question")+" ["+(index+1)+"/"+size()+"] "+answerText(index)+"；＋选此项，删除"+(index+1<size()?"下一项":"留手机");
  // Conservative previously tested copy limits. Do not truncate a question, condition or option.
  TaskWire.require(agent.length()<=16&&computer.length()<=16&&content.length()<=48&&clean(agent)&&clean(computer)&&clean(content),"TASK_GLASS_COPY_TOO_LONG");
  return new Copy(agent,computer,content);
 }
 private void checkCopy(){TaskWire.require("choice".equals(TaskWire.body(request).get("mode")),"TASK_GLASS_PHONE_ANSWER");for(int i=0;i<size();i++)copy(i);}
 private static boolean clean(String text){if(text.trim().isEmpty())return false;for(int i=0;i<text.length();i++)if(Character.isISOControl(text.charAt(i)))return false;return true;}
}
