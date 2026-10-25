package com.turboio.addon;

import java.nio.charset.StandardCharsets;
import java.util.*;

/** Exact original-task controls. A request is never proof that a turn stopped. */
final class TaskControl {
 private TaskControl(){}
 static boolean eligible(Map<String,Object> task,String kind){
  if(task==null||!TaskWire.set("stop","resume").contains(kind))return false;
  try{
   TaskWire.object(task);if(!"task".equals(task.get("kind")))return false;
   Map<String,Object> e=TaskWire.execution(TaskWire.body(task).get("execution"));
   String expected=kind.equals("stop")?"running":"stopped";
   return expected.equals(task.get("state"))&&expected.equals(e.get("phase"))&&e.get("turn_id") instanceof String;
  }catch(RuntimeException invalid){return false;}
 }
 static Map<String,Object> update(Map<String,Object> task,Map<String,Object> expected,String operation,String kind,String text,long now,long expires){
  TaskWire.uuid(operation);TaskWire.execution(expected);TaskWire.require(eligible(task,kind),"TASK_CONTROL_NOT_READY");
  Map<String,Object> original=TaskWire.body(task);
  TaskWire.require(TaskWire.same(expected,original.get("execution")),"TASK_EXECUTION_CHANGED");
  TaskWire.require(expires>now&&expires-now<=86400000,"TASK_EXPIRY_INVALID");
  Map<String,Object> control=WireJson.object("control_id",operation,"kind",kind,"expected_command_id",expected.get("command_id"),"expected_turn_id",expected.get("turn_id"),"expires_at",TaskWire.now(expires));
  if(kind.equals("resume"))control.put("text",text);else TaskWire.require(text==null||text.isEmpty(),"TASK_CONTROL_TEXT_INVALID");
  TaskWire.control(control);
  Map<String,Object> body=WireJson.map(WireJson.copy(original));
  body.put("revision",Math.addExact(TaskWire.positive(task.get("revision")),1));body.put("state",kind.equals("stop")?"stop_requested":"resume_requested");
  body.put("execution",WireJson.copy(expected));body.put("control",control);TaskWire.body("task",body);return body;
 }
 static boolean sameIntent(Map<String,Object> body,String taskId,Map<String,Object> expected,String operation,String kind,String text){
  if(!taskId.equals(body.get("task_id"))||!(body.get("control") instanceof Map))return false;
  Map<String,Object> control=TaskWire.control(body.get("control"));
  return TaskWire.same(expected,body.get("execution"))&&operation.equals(control.get("control_id"))&&kind.equals(control.get("kind"))&&
   expected.get("command_id").equals(control.get("expected_command_id"))&&Objects.equals(expected.get("turn_id"),control.get("expected_turn_id"))&&
   (kind.equals("stop")?(text==null||text.isEmpty())&& !control.containsKey("text"):Objects.equals(text,control.get("text")));
 }
 /** All retained local receipts are inspected; server_stored still awaits native evidence. */
 static Map<String,Object> pending(List<Object> rows,Map<String,Object> task,String kind){
  if(task==null)return null;String taskId=(String)task.get("object_id");Map<String,Object> execution=TaskWire.body(task).get("execution") instanceof Map?TaskWire.execution(TaskWire.body(task).get("execution")):null;
  if(execution==null)return null;
  for(int i=rows.size()-1;i>=0;i--){
   Map<String,Object> row=WireJson.map(rows.get(i));
   if(!Boolean.TRUE.equals(row.get("needs_lookup"))&&TaskWire.set("blocked","expired","withdrawn_local").contains(row.get("state")))continue;
   Map<String,Object> event=WireJson.map(WireJson.read(((String)row.get("payload")).getBytes(StandardCharsets.UTF_8))),body=TaskWire.body(event);
   if(!"task".equals(event.get("kind"))||!taskId.equals(body.get("task_id"))||!(body.get("control") instanceof Map))continue;
   Map<String,Object> control=TaskWire.control(body.get("control"));
   // A later authoritative revision has resolved this stored request. For example, an
   // undispatched resume can expire and return to the same stopped command/turn.
   if("server_stored".equals(row.get("state"))&&!Boolean.TRUE.equals(row.get("needs_lookup"))&&TaskWire.positive(task.get("revision"))>TaskWire.positive(body.get("revision")))continue;
   if(kind.equals(control.get("kind"))&&Objects.equals(execution.get("command_id"),control.get("expected_command_id"))&&Objects.equals(execution.get("turn_id"),control.get("expected_turn_id")))return row;
  }
  return null;
 }
 /** Check the frozen control against a fresh original task before POST. Never rebase it. */
 static boolean current(Map<String,Object> body,Map<String,Object> task){
  try{Map<String,Object> c=TaskWire.control(body.get("control"));return eligible(task,(String)c.get("kind"))&&
   body.get("task_id").equals(task.get("object_id"))&&TaskWire.positive(body.get("revision"))==TaskWire.positive(task.get("revision"))+1&&
   c.get("expected_command_id").equals(TaskWire.execution(body.get("execution")).get("command_id"))&&Objects.equals(c.get("expected_turn_id"),TaskWire.execution(body.get("execution")).get("turn_id"))&&
   TaskWire.same(body.get("execution"),TaskWire.body(task).get("execution"))&&TaskWire.same(body.get("route"),TaskWire.body(task).get("route"))&&
   Objects.equals(body.get("command"),TaskWire.body(task).get("command"));
  }catch(RuntimeException invalid){return false;}
 }
}
