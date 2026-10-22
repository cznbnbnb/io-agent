package com.turboio.addon;
import java.io.*;import java.nio.charset.StandardCharsets;import java.nio.file.*;import java.util.*;

/** Same persisted fixtures/protocol used by the server and Harmony tests. */
public final class TaskMailboxTest {
 static long now=TaskConnection.stamp("2026-10-19T12:00:00Z");
 static void check(boolean value){if(!value)throw new AssertionError();}
 static void rejects(Throwing run)throws Exception{try{run.run();}catch(IllegalArgumentException|IOException|java.nio.channels.OverlappingFileLockException expected){return;}throw new AssertionError("Expected rejection");}
 interface Throwing {void run()throws Exception;}
 static TaskConnection connection(Map<String,Object> route){Map<String,Object> m=TaskConnectionTest.sample();m.putAll(route);m.put("owner_id","owner-a");m.put("producer_id","phone-app");m.put("server_id","server-a");return TaskConnection.parse(WireJson.bytes(m),now);}
 static Map<String,Object> item(Map<String,Object> b,String kind,long seq){return WireJson.object("schema_version","1.0","kind",kind,"object_id",TaskWire.objectId(kind,b),"revision",TaskWire.revision(kind,b),"commit_seq",seq,"stored_at",TaskWire.now(now),"event_id","event-"+kind+"-"+seq,"expires_at",TaskWire.now(now+3600000),"state",kind.equals("message")?"recorded":b.get("state"),"body",WireJson.copy(b));}
 static Map<String,Object> ack(TaskMailbox.Claim claim){Map<String,Object> e=claim.event(),b=TaskWire.body(e);String kind=(String)e.get("kind");String object=TaskWire.objectId(kind,b);long revision=TaskWire.revision(kind,b);return WireJson.object("schema_version","1.0","event_id",e.get("event_id"),"kind",kind,"object_id",object,"revision",revision,"commit_seq",1,"stored_at",TaskWire.now(now),"receipt",WireJson.object("receipt_id","receipt-server","subject_kind",kind,"subject_id",object,"subject_revision",revision,"stage","server_stored","actor_id","server-storage","related_event_id",e.get("event_id"),"error",null));}
 public static void main(String[] args)throws Exception{
  Map<String,Object> fixture=WireJson.map(WireJson.read(Files.readAllBytes(Paths.get("docs/contracts/normal.json"))));Map<String,Map<String,Object>> bodies=new HashMap<>();for(Object raw:WireJson.list(fixture.get("events"))){Map<String,Object> e=WireJson.map(raw);bodies.put((String)e.get("kind"),TaskWire.body(e));}
  TaskConnection connection=connection(WireJson.map(bodies.get("task").get("route")));File root=Files.createTempDirectory("io-agent-mailbox-").toFile();
  String command="整理方案\n保留完整条件；只预览，别发布。";String payload;
  try(TaskMailbox box=new TaskMailbox(root,connection)){
   rejects(()->new TaskMailbox(root,connection));
   Map<String,Object> row=box.delegate("operation-1",command,now,now+60000);payload=(String)row.get("payload");
   check(TaskWire.body(WireJson.map(WireJson.read(payload.getBytes(StandardCharsets.UTF_8)))).get("command").equals(command));
   check(box.delegate("operation-1",command,now+1,now+60001).get("payload").equals(payload));rejects(()->box.delegate("operation-1","changed",now,now+60000));
   TaskMailbox.Claim first=box.claim(now);check(first.action.equals("send"));check(box.claim(now)==null);
  }
  try(TaskMailbox box=new TaskMailbox(root,connection)){
   TaskMailbox.Claim recovered=box.claim(now);check(recovered.action.equals("lookup")&&recovered.payload.equals(payload));
   box.finish(recovered,404,WireJson.bytes(WireJson.object("schema_version","1.0","error",WireJson.object("code","EVENT_NOT_FOUND","retryable",false))),now,0);
   TaskMailbox.Claim same=box.claim(now);check(same.action.equals("send")&&same.payload.equals(payload));box.finish(same,201,WireJson.bytes(ack(same)),now,0);
   check(box.pending().get(0) instanceof Map&&WireJson.map(box.pending().get(0)).get("state").equals("server_stored"));rejects(()->box.finish(same,201,WireJson.bytes(ack(same)),now,0));
   Map<String,Object> task=item(bodies.get("task"),"task",1),request=item(bodies.get("request"),"request",2),message=item(bodies.get("message"),"message",3);
   Map<String,Object> otherTask=WireJson.map(WireJson.copy(task)),otherRequest=WireJson.map(WireJson.copy(request));
   String otherTaskId="其他电脑任务/"+String.join("",Collections.nCopies(200,"远")),otherRequestId="其他问题";
   Map<String,Object> otherRoute=WireJson.map(WireJson.copy(bodies.get("task").get("route")));otherRoute.put("session_id","另一个会话/"+String.join("",Collections.nCopies(200,"远")));
   otherTask.put("object_id",otherTaskId);otherTask.put("commit_seq",4);otherTask.put("event_id","event-other-task");TaskWire.body(otherTask).put("task_id",otherTaskId);TaskWire.body(otherTask).put("route",otherRoute);
   otherRequest.put("object_id",otherRequestId);otherRequest.put("commit_seq",5);otherRequest.put("event_id","event-other-request");TaskWire.body(otherRequest).put("request_id",otherRequestId);TaskWire.body(otherRequest).put("task_id",otherTaskId);TaskWire.body(otherRequest).put("route",otherRoute);
   WireJson.map(WireJson.list(TaskWire.body(otherRequest).get("options")).get(0)).put("label","保留换行\n完整选项");
   box.acceptPage(WireJson.object("items",Arrays.asList(task,request,message,otherTask,otherRequest),"has_more",false,"next_cursor","cursor-1","server_time",TaskWire.now(now),"fresh_until",TaskWire.now(now)),"");
   check(box.cached("task",otherTaskId)!=null&&box.cached("request",otherRequestId)!=null);
   rejects(()->box.draftAnswer("wrong-route",otherRequestId,1,null,"不能回答另一个会话",now));
   check(TaskWire.text(String.join("",Collections.nCopies(512,"😀")),512,false).codePointCount(0,1024)==512);
   rejects(()->TaskWire.text(String.join("",Collections.nCopies(513,"😀")),512,false));
   rejects(()->box.acceptPage(WireJson.object("items",Collections.emptyList(),"has_more",false,"next_cursor","bad","server_time",TaskWire.now(now),"fresh_until",TaskWire.now(now)),""));check(box.cursor().equals("cursor-1"));
   String requestId=(String)request.get("object_id"),answer="采用 A，但完整保留这条附加条件：仅生成预览。\n不要发送或发布。";Object option=WireJson.map(WireJson.list(bodies.get("request").get("options")).get(0)).get("option_id");
   Map<String,Object> draft=box.draftAnswer("reply-1",requestId,1,option,answer,now);check(draft.get("state").equals("awaiting_refresh"));check(box.claim(now)==null);
   box.confirmDraft("reply-1",request,task,now);TaskMailbox.Claim reply=box.claim(now);check(reply.event().get("kind").equals("answer")&&TaskWire.body(reply.event()).get("text").equals(answer));
   box.finish(reply,0,new byte[0],now,0);check(box.claim(now)==null);
   TaskMailbox.Claim lookup=box.claim(now+40000);check(lookup.action.equals("lookup"));box.finish(lookup,200,WireJson.bytes(ack(lookup)),now+40000,0);
   Map<String,Object> answered=WireJson.map(WireJson.copy(request));answered.put("state","answered");box.acceptDetail(answered,now+50000);
   box.acceptPage(WireJson.object("items",Arrays.asList(request),"has_more",false,"next_cursor","cursor-2","server_time",TaskWire.now(now),"fresh_until",TaskWire.now(now)),"cursor-1");
   check(WireJson.map(box.cached("request",requestId).get("item")).get("state").equals("answered"));rejects(()->box.draftAnswer("reply-2",requestId,1,option,"another",now));
   Map<String,Object> wrong=WireJson.map(WireJson.copy(request));TaskWire.body(wrong).put("question","stale changed question");rejects(()->box.acceptDetail(wrong,now));
   box.delegate("expired-command","expired locally",now,now+1);check(box.claim(now+2)==null);check(WireJson.map(box.pending().get(2)).get("state").equals("expired"));
  }
  System.out.println("Task mailbox: passed (real fixtures, immutable commands/answers, fsync/restart, ambiguous receipt lookup, stale version/cursor, close/expiry, single writer)");
 }
}
