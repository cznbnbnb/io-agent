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
  final Map<String,Object> item,body,local,control;
  Row(Source source,Map<String,Object> item,Map<String,Object> local){
   profile=source.profile;binding=profile.binding;this.item=item;this.local=local;this.control=item==null?null:latestControl(source.pending,item);
   Map<String,Object> event=item==null?event(local):item;body=TaskWire.body(event);
   id=(String)body.get("task_id");state=item==null?"queued":(String)item.get("state");key=binding+"/"+id;
  }
  boolean completed(){return "completed".equals(state);}
  boolean active(){return TaskWire.set("queued","agent_received","running","waiting_answer","cancel_requested","execution_unknown","stop_requested","stop_unconfirmed","stopped","resume_requested").contains(state)&&!(item==null&&local!=null&&TaskWire.set("expired","withdrawn_local").contains(local.get("state")));}
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
    if("task".equals(event.get("kind"))&&!body.containsKey("control"))queuedTasks.put((String)body.get("task_id"),local);
    else if("answer".equals(event.get("kind"))&&(Boolean.TRUE.equals(local.get("needs_lookup"))||!TaskWire.set("blocked","expired","withdrawn_local").contains(local.get("state"))))answers.put(body.get("request_id")+"/"+body.get("request_revision"),local);
   }
   for(Map.Entry<String,Map<String,Object>> task:tasks.entrySet())rows.add(new Row(source,task.getValue(),queuedTasks.remove(task.getKey())));
   for(Map<String,Object> local:queuedTasks.values())rows.add(new Row(source,null,local));
   for(Object raw:source.objects){Map<String,Object> item=WireJson.map(WireJson.map(raw).get("item"));if(!"request".equals(item.get("kind")))continue;
    Map<String,Object> body=TaskWire.body(item),parent=tasks.get(body.get("task_id"));
    Map<String,Object> local=answers.get(item.get("object_id")+"/"+item.get("revision"));
    if(TaskWire.canAnswer(item,parent,now)&&!(local!=null&&"server_stored".equals(local.get("state"))&&!Boolean.TRUE.equals(local.get("needs_lookup"))))questions.add(new Question(source,item,parent,local));
   }
  }
  rows.sort(Comparator.comparingLong(Row::order).reversed().thenComparing(row->row.key));
  questions.sort(Comparator.comparingInt((Question q)->q.queuedAnswer()?1:0).thenComparing(Comparator.comparingLong((Question q)->stamp(q.item.get("stored_at"))).reversed()).thenComparing(q->q.binding+"/"+q.id));
  this.rows=Collections.unmodifiableList(rows);this.questions=Collections.unmodifiableList(questions);
 }
 List<Row> filter(String filter){List<Row> out=new ArrayList<>();for(Row row:rows)if("all".equals(filter)||("completed".equals(filter)?row.completed():row.active()))out.add(row);return out;}
 Row find(String key){for(Row row:rows)if(row.key.equals(key))return row;return null;}
 static String firstLine(String text){String trimmed=text==null?"":text.trim();if(trimmed.isEmpty())return "未命名任务";return trimmed.split("\\R",2)[0];}
 static String source(TaskProfiles.Profile p){return agentName(p.connection.agent)+" · "+computerName(p.connection.computer);}
 /** Wire ids read as product names: io-claude-code → Claude Code, generated computer ids shortened. */
 static String agentName(String id){String s=id.toLowerCase(Locale.ROOT);return s.contains("codex")?"Codex":s.contains("claude")?"Claude Code":id;}
 static String computerName(String id){return id.startsWith("computer-")?"电脑 "+shortComputer(id):id;}
 static String shortComputer(String id){String s=id.replaceFirst("^computer-","");return s.length()>6?s.substring(0,6):s;}
 private static Map<String,Object> latestControl(List<Object> pending,Map<String,Object> task){
  for(int i=pending.size()-1;i>=0;i--){Map<String,Object> local=WireJson.map(pending.get(i)),event=event(local),body=TaskWire.body(event);
   if(!"task".equals(event.get("kind"))||!body.containsKey("control")||!task.get("object_id").equals(body.get("task_id")))continue;
   if("server_stored".equals(local.get("state"))&&!Boolean.TRUE.equals(local.get("needs_lookup"))&&TaskWire.positive(task.get("revision"))>TaskWire.positive(body.get("revision")))continue;
   return local;
  }return null;
 }
 static String controlStatus(Map<String,Object> local){
  String kind=(String)TaskWire.control(TaskWire.body(event(local)).get("control")).get("kind"),prefix=kind.equals("stop")?"打断请求":kind.equals("end")?"结束任务":"继续指示";
  // Ending a proven stop takes effect once stored; there is no computer step to wait for.
  return prefix+" · "+("server_stored".equals(local.get("state"))&&!Boolean.TRUE.equals(local.get("needs_lookup"))?(kind.equals("end")?"已生效":"服务器已收到，等待电脑确认"):queueStatus(local));
 }
 static String status(Row row){
  if(row.localOnly())return "server_stored".equals(row.local.get("state"))?"服务器已保存，等待电脑接收":queueStatus(row.local);
  switch(row.state){case "queued":return "等待电脑接收";case "agent_received":return "电脑已接收";case "running":return "进行中";case "waiting_answer":return "等待你的回复";case "completed":return "已完成";case "cancel_requested":case "stop_requested":return "正在停止，等待电脑确认";case "stop_unconfirmed":return "停止尚未确认，暂不能继续";case "stopped":return "已停止，可追加指示继续";case "resume_requested":return "继续指示已收到，等待电脑执行";case "cancelled":return row.body.get("control") instanceof Map&&"end".equals(((Map<?,?>)row.body.get("control")).get("kind"))?"已结束":"已停止";case "failed":return "执行失败";case "expired":return "已过期";case "execution_unknown":return "执行结果待核对";default:return "等待更新";}
 }
 static String queueStatus(String phase){switch(phase){case "awaiting_refresh":return "答案已保存在本机，等待核对原问题";case "queued":return "已保存到本机，等待提交";case "awaiting_target":return "原会话暂不可执行，内容保留在本机";case "sending":return "正在提交";case "server_stored":return "服务器已保存";case "reconcile":case "retry_wait":return "提交结果待核对";case "blocked":return "提交需要处理";case "expired":return "已过期，未继续提交";case "withdrawn_local":return "本机提交已撤回";default:return "等待提交状态更新";}}
 static String queueStatus(Map<String,Object> row){return Boolean.TRUE.equals(row.get("needs_lookup"))?"提交结果待核对":queueStatus((String)row.get("state"));}
 static String questionStatus(Map<String,Object> request,Map<String,Object> parent,long now){
  String state=(String)request.get("state");
  if("answered".equals(state)||request.get("answer")!=null)return "已回答";
  if("withdrawn".equals(state))return "已撤回";
  if("expired".equals(state)||TaskWire.stamp(request.get("expires_at"))<=now)return "已过期";
  return TaskWire.canAnswer(request,parent,now)?"等待回答":"当前不可回复";
 }
 static String receipt(String stage){switch(stage){case "server_stored":return "服务器已保存";case "phone_received":return "手机已接收";case "glasses_displayed":return "眼镜已显示";case "user_answered":return "用户已回答";case "agent_received":return "电脑已接收";case "task_resumed":return "原任务已继续";case "task_completed":return "任务已完成";case "cancel_requested":return "已收到停止请求";case "cancelled":return "电脑已确认停止";case "failed":return "执行失败";case "expired":return "已过期";default:return "收到回执";}}
 private static Map<String,Object> event(Map<String,Object> local){return WireJson.map(WireJson.read(((String)local.get("payload")).getBytes(StandardCharsets.UTF_8)));}
 private static long stamp(Object value){try{return TaskWire.stamp(value);}catch(RuntimeException invalid){return 0;}}
}
