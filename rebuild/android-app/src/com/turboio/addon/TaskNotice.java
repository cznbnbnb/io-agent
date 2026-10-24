package com.turboio.addon;

import java.util.*;

/** An explicitly addressed progress notice. It never creates a question or answer. */
final class TaskNotice {
 final String key,legacy,text;final long expires;
 private TaskNotice(String key,String legacy,String text,long expires){this.key=key;this.legacy=legacy;this.text=text;this.expires=expires;}
 static TaskNotice prepare(TaskConnection connection,Map<String,Object> item,Map<String,Object> parent,long now){
  TaskWire.object(item);TaskWire.object(parent);Map<String,Object> b=TaskWire.body(item),p=TaskWire.body(parent);
  TaskWire.require("message".equals(item.get("kind"))&&"task".equals(parent.get("kind"))&&((String)item.get("object_id")).matches("notice-[a-f0-9]{64}")&&"progress".equals(b.get("channel"))&&b.get("request_id")==null,"TASK_NOTICE_INVALID");
  TaskWire.require(TaskWire.same(b.get("route"),connection.route())&&TaskWire.same(p.get("route"),connection.route())&&b.get("task_id").equals(parent.get("object_id")),"TASK_ROUTE_MISMATCH");
  long expires=TaskWire.stamp(item.get("expires_at"));TaskWire.require(connection.expiresAt>now&&expires>now&&TaskWire.stamp(parent.get("expires_at"))>now&&TaskWire.ACTIVE_TASKS.contains(parent.get("state")),"TASK_NOTICE_CLOSED");
  String text=TaskWire.text(b.get("text"),1800,false);TaskWire.require(!text.trim().isEmpty(),"TASK_NOTICE_INVALID");
  // 2026-10-24 (device): re-pairing derives a new binding for the same session, and every unexpired
  // notice was shown again. The key names the message on its server and route; the old binding key is
  // still honoured so notices recorded before this change are not replayed once more.
  String key="notice-"+TaskWire.hash(WireJson.bytes(WireJson.object("server",connection.server,"owner",connection.owner,"route",connection.route(),"id",item.get("object_id"),"revision",item.get("revision"))));
  String legacy="notice-"+TaskWire.hash(WireJson.bytes(WireJson.object("binding",connection.binding(),"id",item.get("object_id"),"revision",item.get("revision"))));
  return new TaskNotice(key,legacy,connection.agent+" 提醒："+TaskWire.text(p.get("command"),65536,false)+"\n\n"+text+"\n\n仅通知，无需回答；长按退出。",expires);
 }
}
