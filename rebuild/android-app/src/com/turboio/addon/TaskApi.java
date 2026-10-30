package com.turboio.addon;

import java.io.*;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.*;

/** Task pump over existing endpoints. Reception, storage and task progress stay separate. */
final class TaskApi {
 interface Transport {Response exchange(String path,byte[] payload)throws IOException;void cancel();}
 static final class Response {final int status;final byte[] body;final long retryAfter;Response(int status,byte[] body,long retryAfter){this.status=status;this.body=body;this.retryAfter=retryAfter;}}
 private final TaskConnection connection;private final Transport transport;
 private long nextCheck,nextStatusCheck,identityUntil;private boolean running,inboxCurrent,sessionControl,sessionDirectory;
 boolean inboxCurrent(){return inboxCurrent;}
 boolean sessionControl(){return sessionControl;}
 String note="paused";
 TaskApi(TaskConnection connection,Transport transport){this.connection=connection;this.transport=transport;}
 static String encode(String value){try{return URLEncoder.encode(value,"UTF-8").replace("+","%20");}catch(Exception impossible){throw new IllegalStateException(impossible);}}
 static String error(Response response){try{Map<String,Object> value=WireJson.map(WireJson.read(response.body)),e=WireJson.map(value.get("error"));String code=(String)e.get("code");if(code!=null&&code.matches("[A-Z][A-Z0-9_]{0,63}"))return code;}catch(RuntimeException ignored){}return response.status==401?"AUTH_REQUIRED":response.status==403?"FORBIDDEN":"TASK_UNAVAILABLE";}
 void preflight(long now)throws IOException{preflight(now,false);}
 private void preflight(long now,boolean idle)throws IOException{
  TaskWire.require(connection.expiresAt>now,"TASK_IMPORT_EXPIRED");if(idle&&now<identityUntil)return;Response result=transport.exchange("/identity",null);sessionControl=false;sessionDirectory=false;if(result.status!=200)throw new IOException(error(result));connection.identity(result.body,now);
  Object capabilities=WireJson.map(WireJson.read(result.body)).get("capabilities");
  sessionControl=capabilities instanceof List&&WireJson.list(capabilities).contains("task_session_control_v1");
  sessionDirectory=capabilities instanceof List&&WireJson.list(capabilities).contains(TaskSessionDirectory.CAPABILITY);identityUntil=Math.min(connection.expiresAt,now+60000);
 }
 synchronized TaskSessionDirectory directory(long now)throws IOException{preflight(now);return readDirectory();}
 private TaskSessionDirectory readDirectory()throws IOException{
  TaskWire.require(sessionDirectory,"DIRECTORY_UNSUPPORTED");long start=TaskSessionDirectory.elapsed();Response reply=transport.exchange("/agent-sessions",null);long end=TaskSessionDirectory.elapsed();if(reply.status!=200)throw new IOException(error(reply));return TaskSessionDirectory.fresh(reply.body,connection.server,connection.owner,start,end);
 }
 /** One receipt for an exact request revision; its id is derived from the facts, so a repeat is an idempotent duplicate. */
 void receipt(Map<String,Object> request,String stage,long now)throws IOException{
  String id=TaskWire.id(request.get("object_id"));long revision=TaskWire.positive(request.get("revision"));
  String stable=TaskWire.hash(WireJson.bytes(WireJson.object("receipt",stage,"request",id,"revision",revision,"producer",connection.producer)));
  Map<String,Object> body=WireJson.object("receipt_id","rcpt-android-"+stable,"subject_kind","request","subject_id",id,"subject_revision",revision,"stage",stage,"actor_id",connection.producer,"related_event_id",request.get("event_id"),"error",null);
  Response response=transport.exchange("/receipts",WireJson.bytes(TaskWire.envelope("receipt",connection.producer,body,stable,now,now+3600000)));
  if(response.status!=200&&response.status!=201)throw new IOException(error(response));
 }
 private Map<String,Object> detail(String kind,String id)throws IOException{
  TaskWire.require(TaskWire.set("task","request","message").contains(kind)&&!TaskWire.set(".","..").contains(TaskWire.id(id)),"TASK_QUERY_INVALID");
  Response response=transport.exchange("/"+kind+"s/"+encode(id),null);if(response.status!=200)throw new IOException(error(response));
  Map<String,Object> item=TaskWire.object(WireJson.read(response.body));TaskWire.require(kind.equals(item.get("kind"))&&id.equals(item.get("object_id")),"TASK_RESPONSE_MISMATCH");return item;
 }
 synchronized Map<String,Object> refresh(TaskMailbox mailbox,String kind,String id,long now)throws IOException{
  preflight(now);Map<String,Object> item=detail(kind,id);mailbox.acceptDetail(item,now);
  if(kind.equals("request")){Map<String,Object> parent=detail("task",(String)TaskWire.body(item).get("task_id"));mailbox.acceptDetail(parent,now);}return item;
 }
 synchronized void inboxChanged(){if(inboxCurrent)nextCheck=0;}
 boolean pump(TaskMailbox mailbox,long now)throws IOException{return pump(mailbox,now,true);}
 synchronized boolean pump(TaskMailbox mailbox,long now,boolean readInbox)throws IOException{
  if(running||now<nextCheck)return false;running=true;TaskMailbox.Claim claim=null;boolean requestStarted=false;
  try{
   note="checking";preflight(now,!TaskProfiles.unsent(mailbox.pending()));
   for(Object raw:mailbox.pending()){
    Map<String,Object> row=WireJson.map(raw);if(!row.get("state").equals("awaiting_refresh"))continue;
    Map<String,Object> e=WireJson.map(WireJson.read(((String)row.get("payload")).getBytes(StandardCharsets.UTF_8))),answer=TaskWire.body(e);
    try{Map<String,Object> request=detail("request",(String)answer.get("request_id")),parent=detail("task",(String)answer.get("task_id"));mailbox.confirmDraft((String)row.get("operation_id"),request,parent,now);}
    catch(IOException error){if(TaskWire.set("REQUEST_NOT_FOUND","TASK_NOT_FOUND","REQUEST_CLOSED","EXPIRED").contains(error.getMessage()))mailbox.blockDraft((String)row.get("operation_id"),error.getMessage());else throw error;}
    break;
   }
   TaskSessionDirectory directory=null;String directoryFailure="";boolean needsDirectory=false;
   for(Object raw:mailbox.pending()){Map<String,Object> row=WireJson.map(raw);if(!Boolean.TRUE.equals(row.get("needs_lookup"))&&TaskWire.set("queued","awaiting_target","retry_wait").contains(row.get("state"))&&TaskWire.nonnegative(row.get("next_attempt_at"))<=now&&TaskSessionDirectory.guarded(WireJson.map(WireJson.read(((String)row.get("payload")).getBytes(StandardCharsets.UTF_8))))){needsDirectory=true;break;}}
   if(needsDirectory)try{directory=readDirectory();}catch(IOException|RuntimeException unavailable){directoryFailure=safeError(unavailable);}
   final TaskSessionDirectory checkedDirectory=directory;final String gateFailure=directoryFailure;
   claim=mailbox.claim(now,event->!TaskSessionDirectory.guarded(event)?"":checkedDirectory==null?(gateFailure.isEmpty()?"DIRECTORY_REFRESH_REQUIRED":gateFailure):checkedDirectory.gate(TaskWire.route(TaskWire.body(event).get("route")),TaskSessionDirectory.elapsed()));
   if(claim!=null){
    Map<String,Object> event=claim.event(),b=TaskWire.body(event);
    if(claim.action.equals("send")&&event.get("kind").equals("task")&&b.containsKey("control")){
     String rejection=sessionControl?"":"TASK_CONTROL_UNSUPPORTED";
     if(rejection.isEmpty()){
      Map<String,Object> task=detail("task",(String)b.get("task_id"));mailbox.acceptDetail(task,now);
      if(!TaskControl.current(b,task))rejection="TASK_CONTROL_STALE";
     }
     if(!rejection.isEmpty()){
      mailbox.finish(claim,409,WireJson.bytes(WireJson.object("schema_version","1.0","error",WireJson.object("code",rejection,"retryable",false))),now,0);claim=null;note=rejection;return true;
     }
    }
    // A queued answer is checked again immediately before the first actual POST.
    if(claim.action.equals("send")&&event.get("kind").equals("answer")){
     Map<String,Object> request=detail("request",(String)b.get("request_id")),parent=detail("task",(String)b.get("task_id"));
     if(TaskWire.positive(b.get("request_revision"))!=TaskWire.positive(request.get("revision"))||!TaskWire.same(b.get("route"),TaskWire.body(request).get("route"))||!TaskWire.canAnswer(request,parent,now)){
      mailbox.finish(claim,409,WireJson.bytes(WireJson.object("schema_version","1.0","error",WireJson.object("code","REQUEST_CLOSED","retryable",false))),now,0);claim=null;note="REQUEST_CLOSED";return true;
     }
    }
    String lateGate=claim.action.equals("send")&&TaskSessionDirectory.guarded(event)?checkedDirectory.gate(TaskWire.route(b.get("route")),TaskSessionDirectory.elapsed()):"";
    if(!lateGate.isEmpty()){mailbox.deferTarget(claim,lateGate,now);claim=null;}
    else{
     String path=claim.action.equals("lookup")?"/events/"+encode((String)event.get("event_id")):event.get("kind").equals("answer")?"/answers":"/tasks";
     note=claim.action.equals("lookup")?"reconciling":"sending";requestStarted=true;
     Response response=transport.exchange(path,claim.action.equals("lookup")?null:claim.payload.getBytes(StandardCharsets.UTF_8));
     mailbox.finish(claim,response.status,response.body,now,response.retryAfter);claim=null;
    }
   }
   if(readInbox||!inboxCurrent){String cursor=mailbox.cursor();Response inbox=transport.exchange("/inbox?limit=20"+(cursor.isEmpty()?"":"&cursor="+encode(cursor)),null);
   if(inbox.status!=200){String code=error(inbox);if(inbox.status==410&&code.equals("CURSOR_RESET_REQUIRED"))mailbox.resetCursor(cursor);throw new IOException(code);}
   Map<String,Object> page=WireJson.map(WireJson.read(inbox.body));mailbox.acceptPage(page,cursor);inboxCurrent=!Boolean.TRUE.equals(page.get("has_more"));note="received";nextCheck=now+(Boolean.TRUE.equals(page.get("has_more"))?0:3000);}
   // One bounded status read per pump, after queue delivery/inbox work. Failure cannot undo a saved
   // answer or starve incoming tasks; each route keeps its own cursor and status cooldown.
   if(now>=nextStatusCheck){String request=mailbox.staleRequest(now);if(request!=null){
    nextStatusCheck=now+3000;
    try{Map<String,Object> fresh=detail("request",request);TaskWire.require(TaskWire.same(TaskWire.body(fresh).get("route"),connection.route()),"TASK_ROUTE_MISMATCH");mailbox.acceptDetail(fresh,now);}
    catch(IOException|RuntimeException unavailable){nextStatusCheck=now+15000;note=safeError(unavailable);}
   }}
   return true;
  }catch(IOException|RuntimeException error){
   inboxCurrent=false;identityUntil=0;
   if(claim!=null){mailbox.finish(claim,0,new byte[0],now,0);note=requestStarted?"TRANSPORT_UNKNOWN":"REFRESH_UNAVAILABLE";}
   else note=safeError(error);
   nextCheck=now+5000;throw error;
  }finally{running=false;}
 }
 static String safeError(Exception error){String message=error.getMessage();return message!=null&&message.matches("[A-Z][A-Z0-9_]{0,63}")?message:"TASK_UNAVAILABLE";}
 void cancel(){transport.cancel();}
}
