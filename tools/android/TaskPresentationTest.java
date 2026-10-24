package com.turboio.addon;

import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;

/** Synthetic real-schema facts: list grouping must not lose routes or invent task acknowledgements. */
public final class TaskPresentationTest {
 private static int checks;
 private static final long NOW=TaskConnection.stamp("2026-10-23T10:00:00Z");
 private static void check(boolean value){checks++;if(!value)throw new AssertionError("check "+checks);}
 private static TaskConnection connection(String session){Map<String,Object> value=TaskConnectionTest.sample();value.put("session_id",session);value.put("expires_at",TaskWire.now(NOW+86400000));return TaskConnection.parse(WireJson.bytes(value),NOW);}
 private static Map<String,Object> task(TaskConnection c,String id,String state,long seq){return item(WireJson.object("task_id",id,"revision",1,"route",c.route(),"state",state,"command","整理讨论\n完整保留第二行条件。","allow_create_session",false),"task",seq);}
 private static Map<String,Object> item(Map<String,Object> body,String kind,long seq){Map<String,Object> item=WireJson.object("schema_version","1.0","kind",kind,"object_id",TaskWire.objectId(kind,body),"revision",TaskWire.revision(kind,body),"commit_seq",seq,"stored_at",TaskWire.now(NOW+seq),"event_id","event-"+seq,"expires_at",TaskWire.now(NOW+3600000),"state",body.get("state"),"body",body);TaskWire.object(item);return item;}
 private static Object cached(Map<String,Object> item){return WireJson.object("item",item,"detail_at",NOW);}
 private static Map<String,Object> queued(String kind,Map<String,Object> body,String phase){Map<String,Object> event=TaskWire.envelope(kind,"phone-test",body,UUID.randomUUID().toString(),NOW,NOW+3600000);return WireJson.object("payload",new String(WireJson.bytes(event),StandardCharsets.UTF_8),"state",phase,"error","");}
 public static void main(String[] args)throws Exception{
  TaskConnection a=connection("codex-original"),b=connection("claude-original");TaskProfiles.Profile pa=new TaskProfiles.Profile(a,true),pb=new TaskProfiles.Profile(b,false);
  Map<String,Object> ta=task(a,"same-id","waiting_answer",1),tb=task(b,"same-id","running",2),done=task(a,"finished","completed",3),cancelled=task(a,"stopped","cancelled",4),unknown=task(a,"unknown","execution_unknown",5);
  Map<String,Object> requestBody=WireJson.object("request_id","question-a","revision",1,"route",a.route(),"task_id","same-id","state","pending","mode","choice","question","如何整理？\n完整条件保留。","options",Arrays.asList(WireJson.object("option_id","first","label","第一种"),WireJson.object("option_id","second","label","第二种")));
  Map<String,Object> question=item(requestBody,"request",6),answerBody=WireJson.object("answer_id","answer-a","request_id","question-a","request_revision",1,"task_id","same-id","route",a.route(),"option_id","second","text","附加条件\n不能删减。","input_source","phone","raw_action",null);
  Map<String,Object> localTask=queued("task",TaskWire.body(ta),"server_stored"),answer=queued("answer",answerBody,"awaiting_refresh"),newTask=queued("task",TaskWire.body(task(a,"local-only","queued",7)),"queued");
  List<Object> objects=new ArrayList<>(Arrays.asList(cached(ta),cached(done),cached(cancelled),cached(unknown),cached(question))),pending=new ArrayList<>(Arrays.asList(localTask,answer,newTask));
  byte[] before=WireJson.bytes(WireJson.object("objects",objects,"pending",pending));
  TaskPresentation value=new TaskPresentation(Arrays.asList(new TaskPresentation.Source(pa,objects,pending),new TaskPresentation.Source(pb,Arrays.asList(cached(tb)),Collections.emptyList())),NOW);
  check(value.rows.size()==6);check(value.filter("running").size()==4);check(value.filter("completed").size()==1);check(value.filter("all").size()==6);
  check(value.find(a.binding()+"/same-id").profile==pa);check(value.find(b.binding()+"/same-id").profile==pb);check(!value.find(a.binding()+"/same-id").localOnly());check(value.find(a.binding()+"/local-only").localOnly());
  check(TaskPresentation.status(value.find(a.binding()+"/same-id")).equals("等待你的回复"));check(TaskPresentation.status(value.find(a.binding()+"/local-only")).contains("本机"));check(value.find(a.binding()+"/same-id").command().contains("\n完整保留"));
  check(value.questions.size()==1);TaskPresentation.Question q=value.questions.get(0);check(q.binding.equals(a.binding())&&q.parent==ta);check(q.queuedAnswer()&&q.localAnswer==answer);check(q.available(NOW));check(!q.available(NOW+86400001));
  check(Arrays.equals(before,WireJson.bytes(WireJson.object("objects",objects,"pending",pending))));
  // The default target and connection pause do not rewrite a task state or steal its original question.
  TaskPresentation paused=new TaskPresentation(Arrays.asList(new TaskPresentation.Source(new TaskProfiles.Profile(a,false),objects,pending)),NOW);check(!paused.questions.get(0).available(NOW));check(paused.questions.get(0).binding.equals(a.binding()));check(paused.find(a.binding()+"/same-id").state.equals("waiting_answer"));
  Map<String,Object> stoppedParent=task(a,"same-id","cancel_requested",8);List<Object> stopped=Arrays.asList(cached(stoppedParent),cached(question));check(new TaskPresentation(Arrays.asList(new TaskPresentation.Source(pa,stopped,Collections.emptyList())),NOW).questions.isEmpty());
  check(new TaskPresentation(Arrays.asList(new TaskPresentation.Source(pa,objects,pending)),NOW+3600001).questions.isEmpty());
  Map<String,Object> blocked=queued("answer",answerBody,"blocked");TaskPresentation retriable=new TaskPresentation(Arrays.asList(new TaskPresentation.Source(pa,objects,Arrays.asList(blocked))),NOW);check(!retriable.questions.get(0).queuedAnswer());
  blocked.put("needs_lookup",true);TaskPresentation uncertain=new TaskPresentation(Arrays.asList(new TaskPresentation.Source(pa,objects,Arrays.asList(blocked))),NOW);check(uncertain.questions.get(0).queuedAnswer());check(TaskPresentation.queueStatus(uncertain.questions.get(0).localAnswer).equals("提交结果待核对"));
  check(TaskPresentation.receipt("server_stored").equals("服务器已保存"));check(!TaskPresentation.receipt("server_stored").contains("继续"));check(TaskPresentation.receipt("task_resumed").equals("原任务已继续"));
  System.out.println("Task presentation: "+checks+" checks passed (route isolation, durable queue deduplication, literal completion, pending answers, no invented receipt/state, immutable full text)");
 }
}
