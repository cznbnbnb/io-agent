package com.turboio.addon;

import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.*;

/** Durable Android port of the existing mailbox: immutable wire + explicit facts. */
final class TaskMailbox implements AutoCloseable {
 private final AtomicDocument disk;private final TaskConnection connection;final String binding;
 private Map<String,Object> state;
 static final class Claim {
  final String operation,payload,action,binding;final long attempt;
  Claim(Map<String,Object> row,String binding){operation=(String)row.get("operation_id");payload=(String)row.get("payload");action=Boolean.TRUE.equals(row.get("needs_lookup"))?"lookup":"send";attempt=TaskWire.positive(row.get("attempts"));this.binding=binding;}
  Map<String,Object> event(){return WireJson.map(WireJson.read(payload.getBytes(StandardCharsets.UTF_8)));}
 }
 TaskMailbox(File files,TaskConnection connection)throws IOException{
  this.connection=connection;binding=connection.binding();
  disk=new AtomicDocument(new File(files,"task-mailbox/"+binding+"/state.json"));
  try{
   Object loaded=disk.read();state=loaded==null?WireJson.object("schema",1,"binding",binding,"cursor","","outbox",new ArrayList<>(),"objects",new ArrayList<>()):WireJson.map(loaded);validate(state);
   Map<String,Object> recovered=copy();boolean changed=false;
   for(Object raw:rows(recovered,"outbox")){Map<String,Object> row=WireJson.map(raw);if("sending".equals(row.get("state"))){row.put("state","reconcile");row.put("needs_lookup",true);row.put("next_attempt_at",0);row.put("error","INTERRUPTED");changed=true;}}
   if(changed)publish(recovered);
  }catch(IOException|RuntimeException error){disk.close();throw error;}
 }
 private static List<Object> rows(Map<String,Object> state,String key){return WireJson.list(state.get(key));}
 private Map<String,Object> copy(){return WireJson.map(WireJson.copy(state));}
 private void validate(Map<String,Object> s){
  TaskWire.require(TaskWire.positive(s.get("schema"))==1&&binding.equals(s.get("binding")),"TASK_STORE_BINDING");TaskWire.text(s.get("cursor"),4096,true);
  List<Object> outbox=rows(s,"outbox"),objects=rows(s,"objects");TaskWire.require(outbox.size()<=300&&objects.size()<=500,"TASK_STORE_FULL");Set<String> operations=new HashSet<>(),events=new HashSet<>(),ids=new HashSet<>();int sending=0;
  for(Object value:outbox){Map<String,Object> row=WireJson.map(value);TaskWire.require(operations.add(TaskWire.id(row.get("operation_id"))),"TASK_OPERATION_DUPLICATE");
   String payload=TaskWire.text(row.get("payload"),262144,false);TaskWire.require(payload.getBytes(StandardCharsets.UTF_8).length<=262144,"TASK_EVENT_BUDGET");
   Map<String,Object> e=WireJson.map(WireJson.read(payload.getBytes(StandardCharsets.UTF_8)));String kind=TaskWire.id(e.get("kind"));
   TaskWire.require(TaskWire.set("task","answer").contains(kind)&&"1.0".equals(e.get("schema_version"))&&connection.producer.equals(e.get("producer_id"))&&events.add(TaskWire.id(e.get("event_id"))),"TASK_STORE_EVENT");
   TaskWire.body(kind,TaskWire.body(e));TaskWire.require(TaskWire.same(TaskWire.body(e).get("route"),connection.route())&&TaskWire.stamp(e.get("expires_at"))>TaskWire.stamp(e.get("created_at")),"TASK_STORE_ROUTE");TaskWire.text(e.get("idempotency_key"),256,false);
   String phase=TaskWire.id(row.get("state"));TaskWire.require(TaskWire.set("awaiting_refresh","queued","sending","reconcile","retry_wait","server_stored","expired","blocked","withdrawn_local").contains(phase)&&row.get("needs_lookup") instanceof Boolean,"TASK_STORE_STATE");
   TaskWire.nonnegative(row.get("attempts"));TaskWire.nonnegative(row.get("next_attempt_at"));TaskWire.text(row.get("error"),64,true);
   if(phase.equals("sending"))sending++;
   if(phase.equals("awaiting_refresh"))TaskWire.require(kind.equals("answer")&&TaskWire.nonnegative(row.get("attempts"))==0&&!Boolean.TRUE.equals(row.get("needs_lookup")),"TASK_STORE_DRAFT");
   if(phase.equals("server_stored")){TaskWire.ack(WireJson.map(row.get("ack")),e);TaskWire.require(!Boolean.TRUE.equals(row.get("needs_lookup")),"TASK_STORE_ACK");}else TaskWire.require(row.get("ack")==null,"TASK_STORE_ACK");
  }
  TaskWire.require(sending<=1,"TASK_STORE_CLAIM");
  for(Object value:objects){Map<String,Object> cached=WireJson.map(value),item=TaskWire.object(cached.get("item"));TaskWire.require(ids.add(item.get("kind")+":"+item.get("object_id")),"TASK_STORE_DUPLICATE");TaskWire.nonnegative(cached.get("detail_at"));}
 }
 private void publish(Map<String,Object> next)throws IOException{validate(next);disk.save(next);state=next;}
 synchronized String cursor(){return (String)state.get("cursor");}
 synchronized List<Object> pending(){return rows(copy(),"outbox");}
 synchronized List<Object> objects(){return rows(copy(),"objects");}
 synchronized Map<String,Object> cached(String kind,String id){return find(rows(copy(),"objects"),kind,id);}
 private static Map<String,Object> find(List<Object> objects,String kind,String id){for(Object value:objects){Map<String,Object> cached=WireJson.map(value),item=WireJson.map(cached.get("item"));if(kind.equals(item.get("kind"))&&id.equals(item.get("object_id")))return cached;}return null;}
 private Map<String,Object> enqueue(String operation,String kind,Map<String,Object> body,long now,long expires,String phase)throws IOException{
  TaskWire.id(operation);TaskWire.body(kind,body);TaskWire.require(TaskWire.same(body.get("route"),connection.route()),"TASK_ROUTE_MISMATCH");
  for(Object value:rows(state,"outbox")){Map<String,Object> old=WireJson.map(value);if(operation.equals(old.get("operation_id"))){Map<String,Object> e=WireJson.map(WireJson.read(((String)old.get("payload")).getBytes(StandardCharsets.UTF_8)));TaskWire.require(kind.equals(e.get("kind"))&&TaskWire.same(body,TaskWire.body(e)),"TASK_OPERATION_CONFLICT");return WireJson.map(WireJson.copy(old));}}
  Map<String,Object> next=copy(),event=TaskWire.envelope(kind,connection.producer,body,TaskWire.hash((binding+"/"+operation).getBytes(StandardCharsets.UTF_8)),now,expires);
  Map<String,Object> row=WireJson.object("operation_id",operation,"payload",new String(WireJson.bytes(event),StandardCharsets.UTF_8),"state",phase,"attempts",0,"needs_lookup",false,"next_attempt_at",0,"error","","ack",null);
  rows(next,"outbox").add(row);publish(next);return WireJson.map(WireJson.copy(row));
 }
 synchronized Map<String,Object> delegate(String operation,String command,long now,long expires)throws IOException{
  TaskWire.require(!TaskWire.text(command,65536,false).trim().isEmpty(),"TASK_COMMAND_INVALID");
  return enqueue(operation,"task",WireJson.object("task_id","task-android-"+TaskWire.hash((binding+"/"+operation).getBytes(StandardCharsets.UTF_8)),"revision",1,"route",connection.route(),"state","queued","command",command,"allow_create_session",false),now,expires,"queued");
 }
 synchronized Map<String,Object> draftAnswer(String operation,String requestId,long revision,Object option,String text,long now)throws IOException{
  return draftAnswer(operation,requestId,revision,option,text,"phone",null,now);
 }
 synchronized Map<String,Object> draftAnswer(String operation,String requestId,long revision,Object option,String text,String source,String expectedRequest,long now)throws IOException{
  TaskWire.id(operation);TaskWire.id(requestId);TaskWire.positive(revision);
  TaskWire.require(TaskWire.set("phone","voice","glasses_semantic").contains(source),"TASK_ANSWER_INVALID");TaskWire.text(text,65536,true);
  if(!source.equals("phone"))TaskWire.require(expectedRequest!=null&&expectedRequest.matches("[a-f0-9]{64}"),"TASK_REQUEST_CHANGED");
  // Reconciliation of the very same operation must return its exact durable bytes, even after
  // the cached question becomes answered/expired. This never creates or mutates an answer.
  for(Object value:rows(state,"outbox")){Map<String,Object> old=WireJson.map(value);if(operation.equals(old.get("operation_id"))){
   Map<String,Object> event=WireJson.map(WireJson.read(((String)old.get("payload")).getBytes(StandardCharsets.UTF_8))),answer=TaskWire.body(event);
   TaskWire.require("answer".equals(event.get("kind"))&&requestId.equals(answer.get("request_id"))&&revision==TaskWire.positive(answer.get("request_revision"))&&TaskWire.same(option,answer.get("option_id"))&&text.equals(answer.get("text"))&&source.equals(answer.get("input_source")),"TASK_OPERATION_CONFLICT");
   return WireJson.map(WireJson.copy(old));
  }}
  Map<String,Object> cached=cached("request",requestId);TaskWire.require(cached!=null,"TASK_REFRESH_REQUIRED");Map<String,Object> request=TaskWire.object(cached.get("item")),body=TaskWire.body(request);Map<String,Object> parent=cached("task",(String)body.get("task_id"));
  TaskWire.require(TaskWire.positive(request.get("revision"))==revision&&TaskWire.same(body.get("route"),connection.route())&&TaskWire.canAnswer(request,parent==null?null:WireJson.map(parent.get("item")),now),"TASK_REQUEST_CLOSED");
  if(expectedRequest!=null)TaskWire.require(expectedRequest.equals(TaskWire.requestFingerprint(request)),"TASK_REQUEST_CHANGED");
  for(Object value:rows(state,"outbox")){Map<String,Object> old=WireJson.map(value),event=WireJson.map(WireJson.read(((String)old.get("payload")).getBytes(StandardCharsets.UTF_8)));if(!"answer".equals(event.get("kind")))continue;Map<String,Object> answer=TaskWire.body(event);
   if(requestId.equals(answer.get("request_id"))&&revision==TaskWire.positive(answer.get("request_revision")))TaskWire.require(!Boolean.TRUE.equals(old.get("needs_lookup"))&&TaskWire.set("blocked","expired","withdrawn_local").contains(old.get("state")),"TASK_ANSWER_ALREADY_SAVED");
  }
  if(option!=null){boolean found=false;for(Object o:WireJson.list(body.get("options")))if(option.equals(WireJson.map(o).get("option_id")))found=true;TaskWire.require(found,"TASK_OPTION_INVALID");}
  Map<String,Object> answer=WireJson.object("answer_id","answer-android-"+TaskWire.hash((binding+"/"+operation).getBytes(StandardCharsets.UTF_8)),"request_id",requestId,"request_revision",revision,"task_id",body.get("task_id"),"route",connection.route(),"option_id",option,"text",text,"input_source",source,"raw_action",null);
  return enqueue(operation,"answer",answer,now,Math.min(now+86400000,TaskWire.stamp(request.get("expires_at"))),"awaiting_refresh");
 }
 private void merge(Map<String,Object> next,Map<String,Object> item,long detailAt){
  TaskWire.object(item);Map<String,Object> old=find(rows(next,"objects"),(String)item.get("kind"),(String)item.get("object_id"));
  if(old!=null){Map<String,Object> prior=WireJson.map(old.get("item"));long rev=TaskWire.positive(item.get("revision")),before=TaskWire.positive(prior.get("revision"));
   TaskWire.require(TaskWire.same(TaskWire.body(prior).get("route"),TaskWire.body(item).get("route")),"TASK_ROUTE_MISMATCH");if(rev<before)return;
   if(rev==before){TaskWire.require(prior.get("event_id").equals(item.get("event_id"))&&prior.get("commit_seq").equals(item.get("commit_seq"))&&TaskWire.same(TaskWire.body(prior),TaskWire.body(item)),"TASK_REVISION_CONFLICT");
    if(detailAt==0||TaskWire.set("answered","withdrawn","expired").contains(prior.get("state"))){if(prior.get("receipts")!=null)item.put("receipts",prior.get("receipts"));if(prior.get("answer")!=null)item.put("answer",prior.get("answer"));if(TaskWire.set("answered","withdrawn","expired").contains(prior.get("state")))item.put("state",prior.get("state"));}
   }
   rows(next,"objects").remove(old);
  }
  rows(next,"objects").add(WireJson.object("item",item,"detail_at",detailAt));
 }
 synchronized void acceptPage(Map<String,Object> page,String expected)throws IOException{
  TaskWire.require(cursor().equals(expected),"TASK_CURSOR_STALE");List<Object> items=WireJson.list(page.get("items"));TaskWire.require(items.size()<=20&&page.get("has_more") instanceof Boolean&&(!Boolean.TRUE.equals(page.get("has_more"))||!items.isEmpty()),"TASK_PAGE_INVALID");
  String cursor=TaskWire.text(page.get("next_cursor"),4096,false);TaskWire.stamp(page.get("server_time"));TaskWire.stamp(page.get("fresh_until"));
  Map<String,Object> next=copy();long previous=0;
  for(Object value:items){Map<String,Object> item=TaskWire.object(WireJson.copy(value));long seq=TaskWire.positive(item.get("commit_seq"));TaskWire.require(seq>previous&&TaskWire.set("task","request","message").contains(item.get("kind")),"TASK_PAGE_ORDER");previous=seq;merge(next,item,0);}
  next.put("cursor",cursor);publish(next);
 }
 synchronized void acceptDetail(Map<String,Object> item,long now)throws IOException{Map<String,Object> next=copy();merge(next,WireJson.map(WireJson.copy(item)),now);publish(next);}
 synchronized void resetCursor(String expected)throws IOException{TaskWire.require(cursor().equals(expected),"TASK_CURSOR_STALE");Map<String,Object> next=copy();next.put("cursor","");publish(next);}
 synchronized void confirmDraft(String operation,Map<String,Object> request,Map<String,Object> parent,long now)throws IOException{
  TaskWire.object(request);TaskWire.object(parent);Map<String,Object> next=copy();Map<String,Object> row=operationRow(next,operation);TaskWire.require(row.get("state").equals("awaiting_refresh"),"TASK_DRAFT_STALE");
  Map<String,Object> answer=TaskWire.body(WireJson.map(WireJson.read(((String)row.get("payload")).getBytes(StandardCharsets.UTF_8))));
  boolean valid=answer.get("request_id").equals(request.get("object_id"))&&TaskWire.positive(answer.get("request_revision"))==TaskWire.positive(request.get("revision"))&&answer.get("task_id").equals(parent.get("object_id"))&&TaskWire.same(answer.get("route"),TaskWire.body(request).get("route"))&&TaskWire.canAnswer(request,parent,now);
  row.put("state",valid?"queued":"blocked");row.put("error",valid?"":"REQUEST_CLOSED");merge(next,WireJson.map(WireJson.copy(request)),now);merge(next,WireJson.map(WireJson.copy(parent)),now);publish(next);
 }
 static Map<String,Object> operationRow(Map<String,Object> state,String operation){for(Object value:rows(state,"outbox")){Map<String,Object> row=WireJson.map(value);if(operation.equals(row.get("operation_id")))return row;}throw new IllegalArgumentException("TASK_OPERATION_NOT_FOUND");}
 synchronized void blockDraft(String operation,String code)throws IOException{Map<String,Object> next=copy(),row=operationRow(next,operation);TaskWire.require("awaiting_refresh".equals(row.get("state")),"TASK_DRAFT_STALE");row.put("state","blocked");row.put("error",code);publish(next);}
 synchronized Claim claim(long now)throws IOException{
  Map<String,Object> next=copy();for(Object value:rows(next,"outbox"))if(WireJson.map(value).get("state").equals("sending"))return null;boolean changed=false;
  for(Object value:rows(next,"outbox")){Map<String,Object> row=WireJson.map(value);if(!TaskWire.set("queued","reconcile","retry_wait").contains(row.get("state"))||TaskWire.nonnegative(row.get("next_attempt_at"))>now)continue;
   Map<String,Object> event=WireJson.map(WireJson.read(((String)row.get("payload")).getBytes(StandardCharsets.UTF_8)));
   if(!Boolean.TRUE.equals(row.get("needs_lookup"))&&TaskWire.stamp(event.get("expires_at"))<=now){row.put("state","expired");row.put("error","EXPIRED");changed=true;continue;}
   row.put("state","sending");row.put("attempts",TaskWire.nonnegative(row.get("attempts"))+1);publish(next);return new Claim(row,binding);
  }
  if(changed)publish(next);return null;
 }
 synchronized void finish(Claim claim,int status,byte[] response,long now,long retryAfter)throws IOException{
  TaskWire.require(binding.equals(claim.binding),"TASK_CLAIM_STALE");Map<String,Object> next=copy(),row=operationRow(next,claim.operation);
  TaskWire.require(row.get("state").equals("sending")&&TaskWire.positive(row.get("attempts"))==claim.attempt&&row.get("payload").equals(claim.payload),"TASK_CLAIM_STALE");
  Map<String,Object> ack=null;String code="";boolean absent=false;
  try{Map<String,Object> parsed=WireJson.map(WireJson.read(response));if(status==200||status==201){TaskWire.ack(parsed,claim.event());ack=parsed;}else if("1.0".equals(parsed.get("schema_version"))){Map<String,Object> error=WireJson.map(parsed.get("error"));String candidate=(String)error.get("code");if(candidate!=null&&candidate.matches("[A-Z][A-Z0-9_]{0,63}")){code=candidate;absent=status==404&&candidate.equals("EVENT_NOT_FOUND")&&Boolean.FALSE.equals(error.get("retryable"));}}}catch(RuntimeException ignored){}
  if(ack!=null){row.put("state","server_stored");row.put("needs_lookup",false);row.put("error","");row.put("ack",ack);}
  else if(claim.action.equals("lookup")&&absent){boolean expired=TaskWire.stamp(claim.event().get("expires_at"))<=now;row.put("needs_lookup",false);row.put("state",expired?"expired":"queued");row.put("next_attempt_at",0);row.put("error",expired?"EXPIRED":"");}
  else if(status==0||status==429||status>=500||status>=200&&status<300){row.put("state","retry_wait");row.put("needs_lookup",true);row.put("error",status==0?"TRANSPORT_UNKNOWN":code.isEmpty()?"RESPONSE_UNKNOWN":code);long delay=Math.min(30000,1000L<<Math.min(claim.attempt-1,5));row.put("next_attempt_at",now+Math.max(delay+Math.abs(claim.operation.hashCode()%201)*delay/1000,Math.max(0,retryAfter)));}
  else{row.put("state",status==410&&code.equals("EXPIRED")?"expired":"blocked");row.put("needs_lookup",claim.action.equals("lookup"));row.put("error",code.isEmpty()?"HTTP_REJECTED":code);}
  publish(next);
 }
 @Override public synchronized void close()throws IOException{disk.close();}
}
