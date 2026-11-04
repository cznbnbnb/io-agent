package com.turboio.addon;

import java.util.*;

/** An explicitly addressed progress notice. It never creates a question or answer. */
final class TaskNotice {
 final String key,legacy,text,scope,binding;final long expires,retainUntil,sequence,stored;final boolean deliverable;
 private TaskNotice(String key,String legacy,String text,String scope,TaskConnection connection,Map<String,Object> item,Map<String,Object> parent){
  this.key=key;this.legacy=legacy;this.text=text;this.scope=scope;binding=connection.binding();
  retainUntil=TaskWire.taskDeadline(parent);expires=Math.min(connection.expiresAt,Math.min(TaskWire.stamp(item.get("expires_at")),retainUntil));
  sequence=TaskWire.positive(item.get("commit_seq"));stored=TaskWire.stamp(item.get("stored_at"));// A short Agent reply can finish before the phone's next inbox poll.
  // Completion does not withdraw an explicitly sent, still-unexpired notice.
  deliverable=TaskWire.ACTIVE_TASKS.contains(parent.get("state"))||"completed".equals(parent.get("state"));
 }
 boolean live(long now){return deliverable&&expires>now;}
 /** Stock 1.0.10 ordinary notification, business 21/type 2. No question, reply or prompter. */
 byte[] frame(String applicationId,String title,long now){
  return OtaFrame.encode(2,WireJson.object("notificationUID",key,"appId",applicationId,"appName","iO Agent","title",title,"subtitle","","content",oneLine(text),"timestamp",java.time.Instant.ofEpochMilli(now).toString(),"category",0,"reply",false,"type",1),null);
 }
 static String oneLine(String text){return text.trim().replaceAll("[ \\t]*[\\r\\n]+[ \\t]*","；").replaceAll("([。；，！？：、])；","$1");}
 static TaskNotice prepare(TaskConnection connection,Map<String,Object> item,Map<String,Object> parent,long now){TaskNotice n=read(connection,item,parent);TaskWire.require(n.live(now),"TASK_NOTICE_CLOSED");return n;}
 static TaskNotice read(TaskConnection connection,Map<String,Object> item,Map<String,Object> parent){
  TaskWire.object(item);TaskWire.object(parent);Map<String,Object> b=TaskWire.body(item),p=TaskWire.body(parent);
  TaskWire.require("message".equals(item.get("kind"))&&"task".equals(parent.get("kind"))&&((String)item.get("object_id")).matches("notice-[a-f0-9]{64}")&&"progress".equals(b.get("channel"))&&b.get("request_id")==null,"TASK_NOTICE_INVALID");
  TaskWire.require(TaskWire.same(b.get("route"),connection.route())&&TaskWire.same(p.get("route"),connection.route())&&b.get("task_id").equals(parent.get("object_id")),"TASK_ROUTE_MISMATCH");
  String text=TaskWire.text(b.get("text"),1800,false);TaskWire.require(!text.trim().isEmpty(),"TASK_NOTICE_INVALID");
  // 2026-10-24 (device): re-pairing derives a new binding for the same session, and every unexpired
  // notice was shown again. The key names the message on its server and route; the old binding key is
  // still honoured so notices recorded before this change are not replayed once more.
  String key="notice-"+TaskWire.hash(WireJson.bytes(WireJson.object("server",connection.server,"owner",connection.owner,"route",connection.route(),"id",item.get("object_id"),"revision",item.get("revision"))));
  String legacy="notice-"+TaskWire.hash(WireJson.bytes(WireJson.object("binding",connection.binding(),"id",item.get("object_id"),"revision",item.get("revision"))));
  String scope=TaskWire.hash(WireJson.bytes(WireJson.object("server",connection.server,"owner",connection.owner,"route",connection.route(),"task",b.get("task_id"))));
  // Since dev124 notices are ordinary notifications that leave the lens on their own: the message alone,
  // without the old prompter wrapper (agent id, task title, "long-press to exit").
  return new TaskNotice(key,legacy,text,scope,connection,item,parent);
 }
}
