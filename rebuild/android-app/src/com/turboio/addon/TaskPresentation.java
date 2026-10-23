package com.turboio.addon;

import java.nio.charset.StandardCharsets;
import java.util.*;

/** Read-only projection of real mailbox facts. Never changes a task or its original route. */
final class TaskPresentation {
 static final class Source {
  final TaskProfiles.Profile profile;
  final List<Object> objects,pending;
  Source(TaskProfiles.Profile profile,List<Object> objects,List<Object> pending){this.profile=profile;this.objects=objects;this.pending=pending;}
 }
 static final class Row {
  final TaskProfiles.Profile profile;
  final String binding,id,state,key;
  final Map<String,Object> item,body,local;
  Row(Source source,Map<String,Object> item,Map<String,Object> local){
   profile=source.profile;binding=profile.binding;this.item=item;this.local=local;
   Map<String,Object> event=item==null?event(local):item;body=TaskWire.body(event);
   id=(String)body.get("task_id");state=item==null?"queued":(String)item.get("state");key=binding+"/"+id;
  }
  boolean completed(){return "completed".equals(state);}
  boolean active(){return TaskWire.set("queued","agent_received","running","waiting_answer","cancel_requested","execution_unknown").contains(state)&&!(item==null&&local!=null&&TaskWire.set("expired","withdrawn_local").contains(local.get("state")));}
  boolean localOnly(){return item==null;}
  String command(){return (String)body.get("command");}
  String title(){return firstLine(command());}
  long order(){return stamp(item==null?event(local).get("created_at"):item.get("stored_at"));}
 }
 static final class Question {
  final TaskProfiles.Profile profile;
  final String binding,id,taskId;
  final Map<String,Object> item,parent,localAnswer;
  Question(Source source,Map<String,Object> item,Map<String,Object> parent,Map<String,Object> answer){profile=source.profile;binding=profile.binding;this.item=item;this.parent=parent;localAnswer=answer;id=(String)item.get("object_id");taskId=(String)TaskWire.body(item).get("task_id");}
  boolean queuedAnswer(){return localAnswer!=null;}
  boolean available(long now){return profile.enabled&&profile.connection.expiresAt>now;}
 }
 final List<Row> rows;
 final List<Question> questions;
 TaskPresentation(List<Source> sources,long now){
  List<Row> rows=new ArrayList<>();List<Question> questions=new ArrayList<>();
  for(Source source:sources){
   Map<String,Map<String,Object>> tasks=new LinkedHashMap<>(),queuedTasks=new LinkedHashMap<>(),answers=new HashMap<>();
   for(Object raw:source.objects){Map<String,Object> item=WireJson.map(WireJson.map(raw).get("item"));if("task".equals(item.get("kind")))tasks.put((String)item.get("object_id"),item);}
   for(Object raw:source.pending){Map<String,Object> local=WireJson.map(raw),event=event(local),body=TaskWire.body(event);
    if("task".equals(event.get("kind")))queuedTasks.put((String)body.get("task_id"),local);
    else if("answer".equals(event.get("kind"))&&(Boolean.TRUE.equals(local.get("needs_lookup"))||!TaskWire.set("blocked","expired","withdrawn_local").contains(local.get("state"))))answers.put(body.get("request_id")+"/"+body.get("request_revision"),local);
   }
   for(Map.Entry<String,Map<String,Object>> task:tasks.entrySet())rows.add(new Row(source,task.getValue(),queuedTasks.remove(task.getKey())));
   for(Map<String,Object> local:queuedTasks.values())rows.add(new Row(source,null,local));
   for(Object raw:source.objects){Map<String,Object> item=WireJson.map(WireJson.map(raw).get("item"));if(!"request".equals(item.get("kind")))continue;
    Map<String,Object> body=TaskWire.body(item),parent=tasks.get(body.get("task_id"));
    if(TaskWire.canAnswer(item,parent,now))questions.add(new Question(source,item,parent,answers.get(item.get("object_id")+"/"+item.get("revision"))));
   }
  }
  rows.sort(Comparator.comparingLong(Row::order).reversed().thenComparing(row->row.key));
  questions.sort(Comparator.comparingInt((Question q)->q.queuedAnswer()?1:0).thenComparing(Comparator.comparingLong((Question q)->stamp(q.item.get("stored_at"))).reversed()).thenComparing(q->q.binding+"/"+q.id));
  this.rows=Collections.unmodifiableList(rows);this.questions=Collections.unmodifiableList(questions);
 }
 List<Row> filter(String filter){List<Row> out=new ArrayList<>();for(Row row:rows)if("all".equals(filter)||("completed".equals(filter)?row.completed():row.active()))out.add(row);return out;}
 Row find(String key){for(Row row:rows)if(row.key.equals(key))return row;return null;}
 static String firstLine(String text){String trimmed=text==null?"":text.trim();if(trimmed.isEmpty())return "未命名任务";return trimmed.split("\\R",2)[0];}
 static String source(TaskProfiles.Profile p){return p.connection.agent+" · "+p.connection.computer;}
 static String status(Row row){
  if(row.localOnly())return "server_stored".equals(row.local.get("state"))?"服务器已保存，等待电脑接收":queueStatus(row.local);
  switch(row.state){case "queued":return "等待电脑接收";case "agent_received":return "电脑已接收";case "running":return "进行中";case "waiting_answer":return "等待你的回复";case "completed":return "已完成";case "cancel_requested":return "已请求停止，等待电脑确认";case "cancelled":return "已停止";case "failed":return "执行失败";case "expired":return "已过期";case "execution_unknown":return "执行结果待核对";default:return "等待更新";}
 }
 static String queueStatus(String phase){switch(phase){case "awaiting_refresh":return "答案已保存在本机，等待核对原问题";case "queued":return "已保存到本机，等待提交";case "sending":return "正在提交";case "server_stored":return "服务器已保存";case "reconcile":case "retry_wait":return "提交结果待核对";case "blocked":return "提交需要处理";case "expired":return "已过期，未继续提交";case "withdrawn_local":return "本机提交已撤回";default:return "等待提交状态更新";}}
 static String queueStatus(Map<String,Object> row){return Boolean.TRUE.equals(row.get("needs_lookup"))?"提交结果待核对":queueStatus((String)row.get("state"));}
 static String receipt(String stage){switch(stage){case "server_stored":return "服务器已保存";case "phone_received":return "手机已接收";case "glasses_displayed":return "眼镜已显示";case "user_answered":return "用户已回答";case "agent_received":return "电脑已接收";case "task_resumed":return "原任务已继续";case "task_completed":return "任务已完成";case "cancel_requested":return "已收到停止请求";case "cancelled":return "电脑已确认停止";case "failed":return "执行失败";case "expired":return "已过期";default:return "收到回执";}}
 private static Map<String,Object> event(Map<String,Object> local){return WireJson.map(WireJson.read(((String)local.get("payload")).getBytes(StandardCharsets.UTF_8)));}
 private static long stamp(Object value){try{return TaskWire.stamp(value);}catch(RuntimeException invalid){return 0;}}
}
