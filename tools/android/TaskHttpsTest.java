package com.turboio.addon;

import java.io.*;import java.nio.charset.StandardCharsets;import java.nio.file.*;import java.util.*;

/** Real HTTPS + unchanged server/AgentBridge, with a labelled synthetic runtime. */
public final class TaskHttpsTest {
 static void check(boolean value,String code){if(!value)throw new AssertionError(code);}
 static Map<String,Object> item(TaskMailbox box,String kind,String task){
  for(Object value:box.objects()){Map<String,Object> current=WireJson.map(WireJson.map(value).get("item")),body=TaskWire.body(current);if(kind.equals(current.get("kind"))&&(kind.equals("task")?task.equals(current.get("object_id")):task.equals(body.get("task_id"))))return current;}return null;
 }
 static boolean stored(TaskMailbox box,String operation){for(Object value:box.pending()){Map<String,Object> row=WireJson.map(value);if(operation.equals(row.get("operation_id")))return row.get("state").equals("server_stored");}return false;}
 static void pump(TaskApi api,TaskMailbox box){try{api.pump(box,System.currentTimeMillis());}catch(Exception expectedDuringFault){}}
 static long count(Path stats,String key)throws Exception{return TaskWire.nonnegative(WireJson.map(WireJson.read(Files.readAllBytes(stats))).get(key));}
 public static void main(String[] args)throws Exception{
  Path privateRoot=Paths.get("rebuild/android-app/.private"),dir=privateRoot.resolve("https-fixture"),tls=privateRoot.resolve("fixture-tls");
  System.setProperty("javax.net.ssl.trustStore",tls.resolve("truststore.jks").toAbsolutePath().toString());System.setProperty("javax.net.ssl.trustStorePassword",new String(Files.readAllBytes(tls.resolve("truststore-pass.txt")),StandardCharsets.US_ASCII));System.setProperty("sun.net.http.retryPost","false");
  byte[] config=Files.readAllBytes(dir.resolve("task-connection.json"));TaskConnection connection=TaskConnection.parse(config,System.currentTimeMillis());TaskApi api=new TaskApi(connection,new TaskHttp(connection));api.preflight(System.currentTimeMillis());
  Map<String,Object> forged=WireJson.map(WireJson.read(config));forged.put("owner_id","another-owner");TaskConnection wrong=TaskConnection.parse(WireJson.bytes(forged),System.currentTimeMillis());boolean rejected=false;try{new TaskApi(wrong,new TaskHttp(wrong)).preflight(System.currentTimeMillis());}catch(IllegalArgumentException expected){rejected=true;}check(rejected,"IDENTITY_NOT_BOUND");
  String operation="https-"+UUID.randomUUID(),reply="answer-"+operation;Path stats=dir.resolve("stats.json");long beforeIntakes=count(stats,"task_intakes"),beforeAnswers=count(stats,"answer_intakes"),beforePosts=count(stats,"tls_answer_posts");
  String complete="采用 A，但完整保留这条附加条件：仅生成预览。\n不要发送邮件、不要发布，不修改任何现有资料。";
  long started=System.currentTimeMillis();boolean unknownObserved=false;
  try(TaskMailbox box=new TaskMailbox(dir.resolve("jvm-mailbox").toFile(),connection)){
   Map<String,Object> queued=box.delegate(operation,"合成联调任务：保留原会话及完整条件，不执行外部操作。",started,started+3600000);Map<String,Object> envelope=WireJson.map(WireJson.read(((String)queued.get("payload")).getBytes(StandardCharsets.UTF_8)));String task=(String)TaskWire.body(envelope).get("task_id");
   Map<String,Object> request=null;long deadline=System.currentTimeMillis()+45000;
   while(System.currentTimeMillis()<deadline){pump(api,box);request=item(box,"request",task);if(request!=null)break;Thread.sleep(250);}
   check(request!=null,"REQUEST_NOT_RECEIVED");api.refresh(box,"request",(String)request.get("object_id"),System.currentTimeMillis());request=item(box,"request",task);
   Object option=WireJson.map(WireJson.list(TaskWire.body(request).get("options")).get(0)).get("option_id");
   Files.write(dir.resolve("drop-next-answer.flag"),new byte[]{1});box.draftAnswer(reply,(String)request.get("object_id"),TaskWire.positive(request.get("revision")),option,complete,System.currentTimeMillis());
   deadline=System.currentTimeMillis()+60000;boolean completed=false;
   while(System.currentTimeMillis()<deadline){pump(api,box);for(Object raw:box.pending()){Map<String,Object> row=WireJson.map(raw);if(reply.equals(row.get("operation_id"))&&Boolean.TRUE.equals(row.get("needs_lookup")))unknownObserved=true;}
    Map<String,Object> parent=item(box,"task",task),message=item(box,"message",task);if(stored(box,reply)&&parent!=null&&parent.get("state").equals("completed")&&message!=null&&TaskWire.body(message).get("text").equals("合成任务已在原会话继续。完整答案：\n"+complete)){completed=true;break;}Thread.sleep(250);
   }
   check(completed,"COMPLETE_RESULT_NOT_RECEIVED");check(unknownObserved,"LOST_REPLY_NOT_RECONCILED");check(count(stats,"task_intakes")==beforeIntakes+1,"DUPLICATE_RUNTIME_TASK");check(count(stats,"answer_intakes")==beforeAnswers+1,"DUPLICATE_RUNTIME_ANSWER");
   Map<String,Object> detail=api.refresh(box,"request",(String)request.get("object_id"),System.currentTimeMillis());check(TaskWire.body(WireJson.map(detail.get("answer"))).get("text").equals(complete),"ANSWER_TRUNCATED");
   Map<String,Object> report=WireJson.object("schema",1,"at",TaskWire.now(System.currentTimeMillis()),"https",true,"production_http_transport",true,"actual_material_server",true,"actual_desktop_bridge",true,"runtime","synthetic deterministic existing-session fixture","real_codex",false,"real_hermes",false,"phone_io",false,"identity_mismatch_rejected",true,"lost_answer_reply_reconciled",true,"complete_multiline_answer_preserved",true,"task_intake_delta",1,"answer_intake_delta",1,"answer_post_delta",count(stats,"tls_answer_posts")-beforePosts,"elapsed_ms",System.currentTimeMillis()-started);
   Files.write(Paths.get("rebuild/android-app/https-test-results.json"),WireJson.bytes(report));
  }
  System.out.println("HTTPS integration: passed (real transport/server/bridge, original task/answer, lost-reply reconciliation, complete multiline answer, no duplicate runtime intake; deterministic fixture runtime)");
 }
}
