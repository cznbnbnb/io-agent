package com.turboio.addon;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Instant;
import java.util.*;

/** Existing v1 task/request/answer protocol. No platform calls or implicit session. */
final class TaskWire {
 static final Set<String> TASK_STATES=set("queued","agent_received","running","waiting_answer","cancel_requested","cancelled","completed","failed","expired","execution_unknown","stop_requested","stop_unconfirmed","stopped","resume_requested");
 static final Set<String> EXECUTION_PHASES=set("queued","sending","accepted","running","result_pending","stop_requested","stop_unconfirmed","outcome_unknown","completed","failed","stopped","cancelled","expired");
 static final Set<String> REQUEST_STATES=set("pending","presented","answered","withdrawn","expired");
 static final Set<String> ACTIVE_TASKS=set("queued","agent_received","running","waiting_answer");
 static Set<String> set(String...values){return new HashSet<>(Arrays.asList(values));}
 static void require(boolean valid,String code){WireJson.require(valid,code);}
 static String text(Object value,int max,boolean empty){require(value instanceof String,"TASK_TEXT_INVALID");String s=(String)value;require((empty||!s.isEmpty())&&s.codePointCount(0,s.length())<=max,"TASK_TEXT_INVALID");return s;}
 static String id(Object value){return text(value,512,false);}
 static String uuid(Object value){String s=text(value,36,false);require(s.matches("(?i)[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}"),"TASK_UUID_INVALID");return s;}
 static long positive(Object value){require(value instanceof Long||value instanceof Integer,"TASK_NUMBER_INVALID");long n=((Number)value).longValue();require(n>0&&n<=9007199254740991L,"TASK_NUMBER_INVALID");return n;}
 static long nonnegative(Object value){require(value instanceof Long||value instanceof Integer,"TASK_NUMBER_INVALID");long n=((Number)value).longValue();require(n>=0&&n<=9007199254740991L,"TASK_NUMBER_INVALID");return n;}
 static long stamp(Object value){return TaskConnection.stamp(value);}
 static String now(long time){return Instant.ofEpochMilli(time).toString();}
 static String hash(byte[] bytes){try{byte[] raw=MessageDigest.getInstance("SHA-256").digest(bytes);char[] hex=new char[raw.length*2];String digits="0123456789abcdef";for(int i=0;i<raw.length;i++){int n=raw[i]&255;hex[i*2]=digits.charAt(n>>>4);hex[i*2+1]=digits.charAt(n&15);}return new String(hex);}catch(Exception error){throw new IllegalStateException(error);}}
 static Map<String,Object> body(Map<String,Object> item){return WireJson.map(item.get("body"));}
 static String requestFingerprint(Map<String,Object> request){
  object(request);require("request".equals(request.get("kind")),"TASK_REQUEST_INVALID");Map<String,Object> semantic=WireJson.map(WireJson.copy(body(request)));semantic.remove("state");
  return hash(WireJson.bytes(WireJson.object("request_id",request.get("object_id"),"revision",request.get("revision"),"expires_at",request.get("expires_at"),"body",semantic)));
 }
 // Inbox pages can contain other authorized routes. Their v1 schema is broader
 // than the deliberately narrow four-ID connection import format.
 static Map<String,Object> route(Object value){Map<String,Object> route=WireJson.map(value);BoundedJson.keys(route,"computer_id","agent_id","project_id","session_id");for(Object part:route.values())text(part,512,false);return route;}
 static boolean same(Object a,Object b){return Arrays.equals(WireJson.bytes(a),WireJson.bytes(b));}
 static String objectId(String kind,Map<String,Object> body){return id(body.get(kind+"_id"));}
 static long revision(String kind,Map<String,Object> body){return kind.equals("answer")||kind.equals("receipt")?1:positive(body.get("revision"));}
 static void body(String kind,Map<String,Object> b){
  objectId(kind,b);revision(kind,b);
  if(!kind.equals("receipt"))route(b.get("route"));
  switch(kind){
   case "task":
    require(TASK_STATES.contains(b.get("state"))&&Boolean.FALSE.equals(b.get("allow_create_session")),"TASK_BODY_INVALID");
    text(b.get("command"),65536,false);if(b.containsKey("execution"))execution(b.get("execution"));if(b.containsKey("control"))control(b.get("control"));taskExecution(b);break;
   case "request":
    id(b.get("task_id"));require(REQUEST_STATES.contains(b.get("state"))&&set("choice","free_text").contains(b.get("mode")),"TASK_REQUEST_INVALID");
    text(b.get("question"),4096,false);if(b.get("runtime_request_id")!=null)id(b.get("runtime_request_id"));
    List<Object> options=WireJson.list(b.get("options"));require(options.size()<=4&&(b.get("mode").equals("choice")?options.size()>=2:options.isEmpty()),"TASK_OPTIONS_INVALID");
    Set<String> seen=new HashSet<>();for(Object option:options){Map<String,Object> o=WireJson.map(option);require(seen.add(id(o.get("option_id"))),"TASK_OPTION_DUPLICATE");text(o.get("label"),512,false);}break;
   case "answer":
    id(b.get("task_id"));id(b.get("request_id"));positive(b.get("request_revision"));
    String answer=text(b.get("text"),65536,true);if(b.get("option_id")!=null)id(b.get("option_id"));
    require((b.get("option_id")!=null||!answer.trim().isEmpty())&&set("phone","voice","glasses_semantic").contains(b.get("input_source"))&&b.containsKey("raw_action")&&b.get("raw_action")==null,"TASK_ANSWER_INVALID");break;
   case "message":
    id(b.get("task_id"));if(b.get("request_id")!=null)id(b.get("request_id"));require(set("command","question","answer","progress","result","cancel").contains(b.get("channel")),"TASK_MESSAGE_INVALID");text(b.get("text"),65536,true);break;
   case "receipt":receipt(b);break;
   default:throw new IllegalArgumentException("TASK_KIND_INVALID");
  }
 }
 static Map<String,Object> execution(Object value){
  Map<String,Object> e=WireJson.map(value);BoundedJson.keys(e,"command_id","turn_id","phase");uuid(e.get("command_id"));
  if(e.get("turn_id")!=null)text(e.get("turn_id"),160,false);require(EXECUTION_PHASES.contains(e.get("phase")),"TASK_EXECUTION_INVALID");return e;
 }
 private static void taskExecution(Map<String,Object> b){
  String state=(String)b.get("state");boolean extended=b.containsKey("execution")||b.containsKey("control")||set("stop_requested","stop_unconfirmed","stopped","resume_requested").contains(state);
  if(!extended)return;require(b.containsKey("execution")&&!state.equals("queued"),"TASK_EXECUTION_INVALID");Map<String,Object> e=execution(b.get("execution"));String phase=(String)e.get("phase");boolean valid;
  switch(state){
   case "agent_received":valid=set("queued","sending","accepted").contains(phase)&&e.get("turn_id")==null;break;
   case "running":valid=set("running","result_pending").contains(phase);break;
   case "waiting_answer":valid=phase.equals("running");break;
   case "execution_unknown":valid=phase.equals("outcome_unknown");break;
   case "stop_requested":valid=set("running","stop_requested").contains(phase);break;
   case "stop_unconfirmed":valid=set("stop_unconfirmed","outcome_unknown").contains(phase);break;
   case "stopped":case "resume_requested":valid=phase.equals("stopped");break;
   case "cancel_requested":valid=set("queued","sending","accepted","running","result_pending","outcome_unknown").contains(phase);break;
   default:valid=state.equals(phase);
  }
  require(valid,"TASK_EXECUTION_INVALID");if(set("running","result_pending","stop_requested","stop_unconfirmed","stopped","completed").contains(phase))require(e.get("turn_id") instanceof String,"TASK_EXECUTION_INVALID");
 }
 static Map<String,Object> control(Object value){
  Map<String,Object> c=WireJson.map(value);String kind=id(c.get("kind"));require(set("stop","resume","end").contains(kind),"TASK_CONTROL_INVALID");
  if(kind.equals("resume"))BoundedJson.keys(c,"control_id","kind","expected_command_id","expected_turn_id","expires_at","text");
  else BoundedJson.keys(c,"control_id","kind","expected_command_id","expected_turn_id","expires_at");
  uuid(c.get("control_id"));uuid(c.get("expected_command_id"));text(c.get("expected_turn_id"),160,false);stamp(c.get("expires_at"));
  if(kind.equals("resume")){String text=text(c.get("text"),32768,false);require(!text.trim().isEmpty()&&text.getBytes(StandardCharsets.UTF_8).length<=32768,"TASK_CONTROL_TEXT_INVALID");}
  return c;
 }
 static void receipt(Map<String,Object> r){
  id(r.get("receipt_id"));id(r.get("subject_id"));positive(r.get("subject_revision"));id(r.get("actor_id"));id(r.get("related_event_id"));
  require(set("material","task","request","answer","message","receipt").contains(r.get("subject_kind"))&&set("server_stored","phone_received","glasses_displayed","user_answered","agent_received","task_resumed","task_completed","cancel_requested","cancelled","failed","expired").contains(r.get("stage")),"TASK_RECEIPT_INVALID");
  if(r.get("error")!=null){Map<String,Object> error=WireJson.map(r.get("error"));id(error.get("code"));text(error.get("detail"),512,true);require(error.get("retryable") instanceof Boolean,"TASK_RECEIPT_INVALID");}
 }
 static Map<String,Object> object(Object value){return object(value,true);}
 private static Map<String,Object> object(Object value,boolean allowAnswer){
  Map<String,Object> item=WireJson.map(value);String kind=id(item.get("kind"));require(set("task","request","message","answer").contains(kind)&&"1.0".equals(item.get("schema_version")),"TASK_OBJECT_INVALID");
  Map<String,Object> b=body(item);body(kind,b);require(id(item.get("object_id")).equals(objectId(kind,b))&&positive(item.get("revision"))==revision(kind,b),"TASK_OBJECT_MISMATCH");
  id(item.get("event_id"));positive(item.get("commit_seq"));stamp(item.get("stored_at"));stamp(item.get("expires_at"));
  require((kind.equals("task")?TASK_STATES:kind.equals("request")?REQUEST_STATES:set("recorded")).contains(item.get("state")),"TASK_STATE_INVALID");
  if(item.get("command_expires_at")!=null&&!item.get("command_expires_at").equals(""))stamp(item.get("command_expires_at"));
  if(item.get("receipts")!=null){List<Object> receipts=WireJson.list(item.get("receipts"));require(receipts.size()<=1000,"TASK_RECEIPT_BUDGET");for(Object raw:receipts){Map<String,Object> r=WireJson.map(raw);receipt(r);require(kind.equals(r.get("subject_kind"))&&item.get("object_id").equals(r.get("subject_id"))&&positive(r.get("subject_revision"))<=positive(item.get("revision")),"TASK_RECEIPT_MISMATCH");}}
  if(item.get("answer")!=null){require(allowAnswer&&kind.equals("request")&&item.get("state").equals("answered"),"TASK_ANSWER_MISMATCH");Map<String,Object> answer=object(item.get("answer"),false),a=body(answer);require(answer.get("kind").equals("answer")&&a.get("request_id").equals(item.get("object_id"))&&positive(a.get("request_revision"))==positive(item.get("revision"))&&a.get("task_id").equals(b.get("task_id"))&&same(a.get("route"),b.get("route")),"TASK_ANSWER_MISMATCH");}
  return item;
 }
 static Map<String,Object> envelope(String kind,String producer,Map<String,Object> body,String stable,long now,long expires){
  body(kind,body);require(expires>now&&expires-now<=86400000,"TASK_EXPIRY_INVALID");
  Map<String,Object> event=WireJson.object("schema_version","1.0","event_id","evt-android-"+stable,"idempotency_key","idem-android-"+stable,"producer_id",producer,"kind",kind,"created_at",now(now),"expires_at",now(expires),"body",body);
  require(WireJson.bytes(event).length<=262144,"TASK_EVENT_BUDGET");return event;
 }
 static void ack(Map<String,Object> ack,Map<String,Object> event){
  String kind=(String)event.get("kind");Map<String,Object> b=body(event),r=WireJson.map(ack.get("receipt"));receipt(r);
  require("1.0".equals(ack.get("schema_version"))&&event.get("event_id").equals(ack.get("event_id"))&&kind.equals(ack.get("kind"))&&objectId(kind,b).equals(ack.get("object_id"))&&revision(kind,b)==positive(ack.get("revision")),"TASK_ACK_MISMATCH");
  positive(ack.get("commit_seq"));stamp(ack.get("stored_at"));
  require(kind.equals(r.get("subject_kind"))&&ack.get("object_id").equals(r.get("subject_id"))&&positive(ack.get("revision"))==positive(r.get("subject_revision"))&&event.get("event_id").equals(r.get("related_event_id"))&&r.get("stage").equals("server_stored")&&r.get("actor_id").equals("server-storage")&&r.get("error")==null,"TASK_ACK_MISMATCH");
 }
 static boolean canAnswer(Map<String,Object> request,Map<String,Object> parent,long now){
  if(request==null||parent==null||!"request".equals(request.get("kind"))||!"task".equals(parent.get("kind"))||!set("pending","presented").contains(request.get("state"))||request.get("answer")!=null||stamp(request.get("expires_at"))<=now||!ACTIVE_TASKS.contains(parent.get("state")))return false;
  Map<String,Object> r=body(request);return parent.get("object_id").equals(r.get("task_id"))&&same(body(parent).get("route"),r.get("route"));
 }
}
