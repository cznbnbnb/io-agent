package com.turboio.addon;

import java.io.*;import java.lang.reflect.*;import java.nio.charset.StandardCharsets;import java.util.*;

/** Existing TaskHub/mailbox with synthetic transport and capture; no device/network. */
public final class TaskVoiceBridgeTest {
 static int checks;static final long NOW=TaskConnection.stamp("2026-10-19T12:00:00Z");
 static final String PEER="synthetic-voice-bridge-peer",TEXT="请先生成完整预览。\n附加条件：保留全部原音和文字，不发送消息。\n预算不超过 200 元；周五确认后才执行。";
 interface Work {void run()throws Exception;}
 static void yes(boolean value){checks++;if(!value)throw new AssertionError("voice bridge assertion "+checks);}
 static void rejects(Work action)throws Exception{checks++;try{action.run();}catch(IOException|IllegalArgumentException|IllegalStateException expected){return;}throw new AssertionError("voice bridge expected rejection "+checks);}
 static Map<String,Object> copy(Object value){return WireJson.map(WireJson.copy(value));}
 static TaskConnection connection(String agent,String session){Map<String,Object> m=WireJson.object("format",TaskConnection.FORMAT,"base_url","https://synthetic.invalid/io-api/v1","owner_id","synthetic-owner","producer_id","synthetic-phone","server_id","synthetic-server","computer_id","synthetic-computer","agent_id",agent,"project_id","synthetic-project","session_id",session,"token","AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA","token_id","c0ffee00-0000-4000-8000-000000000001","expires_at","2026-10-20T10:00:00.000Z");return TaskConnection.parse(WireJson.bytes(m),NOW);}
 static Map<String,Object> item(String kind,Map<String,Object> body,long seq){return WireJson.object("schema_version","1.0","kind",kind,"object_id",TaskWire.objectId(kind,body),"revision",TaskWire.revision(kind,body),"commit_seq",seq,"stored_at",TaskWire.now(NOW),"event_id","voice-bridge-event-"+seq,"expires_at",TaskWire.now(NOW+3600000),"state",body.get("state"),"body",WireJson.copy(body));}
 static Map<String,Object> task(TaskConnection c){return item("task",WireJson.object("task_id","bridge-task","revision",1,"route",c.route(),"state","waiting_answer","command","只准备合成预览","allow_create_session",false),1);}
 static Map<String,Object> request(TaskConnection c){return item("request",WireJson.object("request_id","bridge-request","revision",1,"task_id","bridge-task","route",c.route(),"state","pending","mode","free_text","question","请完整说明附加条件","options",new ArrayList<>()),2);}
 static final class Memory implements VoiceAnswerSession.Store {
  Object value;boolean failSaved;
  public Object read(){return value==null?null:WireJson.copy(value);}
  public void save(Object next)throws IOException{if(failSaved&&"SAVED".equals(WireJson.map(next).get("phase"))){failSaved=false;throw new IOException("SYNTHETIC_DRAFT_SAVE_INTERRUPTED");}value=WireJson.copy(next);}
 }
 static final class MemoryServer implements TaskApi.Transport {
  final TaskConnection connection;Map<String,Object> request,parent,committed,ack;boolean offline,unreachable,loseResponse;int calls,posts,lookups,cursor;
  MemoryServer(TaskConnection c){connection=c;request=request(c);parent=task(c);}
  TaskApi.Response response(int status,Object value){return new TaskApi.Response(status,WireJson.bytes(value),0);}
  public TaskApi.Response exchange(String path,byte[] payload)throws IOException{
   calls++;if(offline)throw new IOException("SYNTHETIC_OFFLINE");
   if(unreachable)throw new java.net.ConnectException("synthetic: network unreachable");
   if(path.equals("/identity")){Map<String,Object> input=WireJson.map(WireJson.read(connection.encode()));return response(200,WireJson.object("schema_version","1.0","owner_id",input.get("owner_id"),"producer_id",input.get("producer_id"),"server_id",input.get("server_id"),"expires_at",input.get("expires_at"),"scopes",TaskConnection.SCOPES));}
   if(path.equals("/requests/bridge-request"))return response(200,request);
   if(path.equals("/tasks/bridge-task"))return response(200,parent);
   if(path.equals("/answers")){
    posts++;Map<String,Object> event=WireJson.map(WireJson.read(payload));if(committed!=null)yes(TaskWire.same(committed,event));committed=copy(event);Map<String,Object> body=TaskWire.body(event);
    ack=WireJson.object("schema_version","1.0","event_id",event.get("event_id"),"kind","answer","object_id",body.get("answer_id"),"revision",1,"commit_seq",3,"stored_at",TaskWire.now(NOW),"receipt",WireJson.object("receipt_id","bridge-server-receipt","subject_kind","answer","subject_id",body.get("answer_id"),"subject_revision",1,"stage","server_stored","actor_id","server-storage","related_event_id",event.get("event_id"),"error",null));
    request.put("state","answered");if(loseResponse){loseResponse=false;throw new IOException("SYNTHETIC_RESPONSE_LOST");}return response(201,ack);
   }
   if(path.startsWith("/events/")){lookups++;if(committed!=null&&path.equals("/events/"+TaskApi.encode((String)committed.get("event_id"))))return response(200,ack);return response(404,WireJson.object("schema_version","1.0","error",WireJson.object("code","EVENT_NOT_FOUND","retryable",false)));}
   if(path.startsWith("/inbox?"))return response(200,WireJson.object("items",new ArrayList<>(),"has_more",false,"next_cursor","bridge-cursor-"+(++cursor),"server_time",TaskWire.now(NOW),"fresh_until",TaskWire.now(NOW)));
   throw new IOException("SYNTHETIC_PATH_NOT_ALLOWED");
  }
  public void cancel(){}
 }
 static final class Env implements AutoCloseable {
  final File root;final List<TaskConnection> connections=Arrays.asList(connection("codex","original-codex"),connection("hermes","original-hermes"),connection("hermes","dedicated-qa"));
  final Map<String,MemoryServer> servers=new LinkedHashMap<>();final TaskHub hub;
  Env(File parent,String name)throws Exception{root=new File(parent,name);TaskProfiles profiles=TaskProfiles.empty();for(TaskConnection c:connections){profiles=profiles.upsert(c,true,NOW);servers.put(c.binding(),new MemoryServer(c));}hub=new TaskHub(root,profiles,c->servers.get(c.binding()));for(TaskConnection c:connections)yes(hub.view(c.binding()).pending.isEmpty());}
  TaskConnection first(){return connections.get(0);}MemoryServer server(){return servers.get(first().binding());}
  void prepare(TaskConnection c,VoiceAnswerSession draft)throws Exception{hub.prepareVoice(c.binding(),"bridge-request",1,TaskWire.requestFingerprint(request(c)),draft,NOW);}
  void prepare(VoiceAnswerSession draft)throws Exception{prepare(first(),draft);}
  public void close()throws Exception{hub.close();}
 }
 static Object mailbox(TaskHub hub,String binding)throws Exception{Field channels=TaskHub.class.getDeclaredField("channels");channels.setAccessible(true);Object channel=((Map<?,?>)channels.get(hub)).get(binding);Field box=channel.getClass().getDeclaredField("mailbox");box.setAccessible(true);return box.get(channel);}
 static void review(VoiceAnswerSession draft)throws Exception{
  yes(draft.phase().equals("PREPARED"));yes(draft.arm(PEER,1,1000,15,(token,peer,generation,deadline)->token.equals(draft.token())&&peer.equals(FixedPeerHash.of(PEER))&&generation==1&&deadline==16000));
  yes(draft.result(draft.token(),PEER,1,1,1,TEXT,true,1100));yes(draft.stop(draft.token(),1200,false));yes(draft.stopSubmitted(draft.token(),PEER,1,1201));yes(draft.engineEnd(draft.token(),1202));yes(draft.engineStopped(draft.token(),true));CaptureSession.StopProbe probe=draft.probeStop(PEER,1,1203);yes(probe!=null&&draft.deviceIdle(probe,PEER,1,1204,true));yes(draft.finish()&&draft.phase().equals("REVIEW"));
 }
 static Map<String,Object> only(TaskHub hub,String binding){List<Object> pending=hub.view(binding).pending;yes(pending.size()==1);return WireJson.map(pending.get(0));}
 static Map<String,Object> answer(Map<String,Object> row){return TaskWire.body(WireJson.map(WireJson.read(((String)row.get("payload")).getBytes(StandardCharsets.UTF_8))));}
 static void routes(File root)throws Exception{
  try(Env e=new Env(root,"routes")){
   for(TaskConnection c:e.connections){Memory memory=new Memory();VoiceAnswerSession draft=new VoiceAnswerSession(memory);Object originalBox=mailbox(e.hub,c.binding());e.prepare(c,draft);yes(draft.phase().equals("PREPARED")&&e.servers.get(c.binding()).calls==3);review(draft);String complete=TEXT+"\n补充：本次授权只包含预览。";yes(draft.edit(complete));
    // Selecting another target must never reroute this captured answer.
    e.hub.apply(e.hub.profiles().select(e.connections.get((e.connections.indexOf(c)+1)%3).binding()));e.hub.answerVoice(c.binding(),draft,NOW+1);
    Map<String,Object> row=only(e.hub,c.binding()),body=answer(row);yes(draft.phase().equals("SAVED"));yes(row.get("operation_id").equals(draft.operation())&&row.get("state").equals("awaiting_refresh"));yes(body.get("text").equals(complete)&&body.get("input_source").equals("voice")&&body.get("option_id")==null&&body.get("raw_action")==null);yes(TaskWire.same(body.get("route"),c.route())&&body.get("request_id").equals("bridge-request")&&body.get("task_id").equals("bridge-task")&&TaskWire.positive(body.get("request_revision"))==1);
    MemoryServer server=e.servers.get(c.binding());yes(server.posts==0&&server.calls==6);server.offline=true;int before=server.calls;VoiceAnswerSession restored=new VoiceAnswerSession(memory);e.hub.answerVoice(c.binding(),restored,NOW+172800000);yes(server.calls==before&&only(e.hub,c.binding()).get("payload").equals(row.get("payload")));yes(mailbox(e.hub,c.binding())==originalBox);rejects(()->new TaskMailbox(e.root,c));server.offline=false;
   }
   yes(e.hub.views().size()==3);for(TaskConnection c:e.connections)yes(e.hub.view(c.binding()).pending.size()==1);
  }
 }
 static void boundaries(File root)throws Exception{
  try(Env e=new Env(root,"paused")){VoiceAnswerSession draft=new VoiceAnswerSession(new Memory());e.hub.apply(e.hub.profiles().enabled(e.first().binding(),false,NOW));rejects(()->e.prepare(draft));yes(draft.phase().equals("IDLE")&&e.server().calls==0);e.hub.apply(e.hub.profiles().enabled(e.first().binding(),true,NOW));e.prepare(draft);review(draft);e.hub.apply(e.hub.profiles().enabled(e.first().binding(),false,NOW));int calls=e.server().calls;rejects(()->e.hub.answerVoice(e.first().binding(),draft,NOW));yes(draft.phase().equals("REVIEW")&&e.server().calls==calls&&e.hub.view(e.first().binding()).pending.isEmpty());}
  try(Env e=new Env(root,"offline")){VoiceAnswerSession draft=new VoiceAnswerSession(new Memory());e.server().offline=true;rejects(()->e.prepare(draft));yes(draft.phase().equals("IDLE"));e.server().offline=false;e.prepare(draft);review(draft);e.server().offline=true;rejects(()->e.hub.answerVoice(e.first().binding(),draft,NOW));yes(draft.phase().equals("REVIEW")&&draft.answerText().equals(TEXT)&&e.hub.view(e.first().binding()).pending.isEmpty());e.server().offline=false;e.hub.answerVoice(e.first().binding(),draft,NOW);yes(draft.phase().equals("SAVED")&&e.server().posts==0);}
  // R2 2026-10-23: with the server unreachable (not refusing), dictation uses the last observed copy and the
  // answer is only saved for the pump to verify; nothing is posted and a never-seen question still fails.
  try(Env e=new Env(root,"unreachable")){VoiceAnswerSession cold=new VoiceAnswerSession(new Memory());e.server().unreachable=true;rejects(()->e.prepare(cold));yes(cold.phase().equals("IDLE"));
   e.server().unreachable=false;e.hub.detail(e.first().binding(),"request","bridge-request",NOW);e.server().unreachable=true;
   VoiceAnswerSession draft=new VoiceAnswerSession(new Memory());e.prepare(draft);review(draft);e.hub.answerVoice(e.first().binding(),draft,NOW);
   yes(draft.phase().equals("SAVED")&&e.server().posts==0&&e.hub.view(e.first().binding()).pending.size()==1);}
  for(String changed:Arrays.asList("revision","route","parent_closed","request_closed","fingerprint"))try(Env e=new Env(root,"changed-"+changed)){
   VoiceAnswerSession draft=new VoiceAnswerSession(new Memory());e.prepare(draft);review(draft);Map<String,Object> request=e.server().request;
   if(changed.equals("revision")){Map<String,Object> body=copy(TaskWire.body(request));body.put("revision",2);e.server().request=item("request",body,4);}
   if(changed.equals("route"))TaskWire.body(request).put("route",e.connections.get(1).route());
   if(changed.equals("parent_closed"))e.server().parent.put("state","completed");
   if(changed.equals("request_closed"))request.put("state","answered");
   if(changed.equals("fingerprint"))TaskWire.body(request).put("question","同版本问题被换成另一件事");
   rejects(()->e.hub.answerVoice(e.first().binding(),draft,NOW));yes(draft.phase().equals("REVIEW")&&draft.answerText().equals(TEXT)&&e.hub.view(e.first().binding()).pending.isEmpty()&&e.server().posts==0);
  }
  try(Env e=new Env(root,"wrong-target")){VoiceAnswerSession draft=new VoiceAnswerSession(new Memory());String binding=e.first().binding();rejects(()->e.hub.prepareVoice(binding,"bridge-request",2,TaskWire.requestFingerprint(request(e.first())),draft,NOW));yes(draft.phase().equals("IDLE"));rejects(()->e.hub.prepareVoice(binding,"bridge-request",1,String.join("",Collections.nCopies(64,"0")),draft,NOW));yes(draft.phase().equals("IDLE"));e.prepare(draft);rejects(()->e.prepare(draft));review(draft);int calls=e.servers.get(e.connections.get(1).binding()).calls;rejects(()->e.hub.answerVoice(e.connections.get(1).binding(),draft,NOW));yes(e.servers.get(e.connections.get(1).binding()).calls==calls&&draft.phase().equals("REVIEW"));}
 }
 static void interruptedSave(File root)throws Exception{
  try(Env e=new Env(root,"interrupted-local-save")){Memory memory=new Memory();VoiceAnswerSession draft=new VoiceAnswerSession(memory);e.prepare(draft);review(draft);memory.failSaved=true;rejects(()->e.hub.answerVoice(e.first().binding(),draft,NOW));yes(!draft.healthy()&&WireJson.map(memory.value).get("phase").equals("SUBMITTING"));Map<String,Object> saved=only(e.hub,e.first().binding());yes(answer(saved).get("text").equals(TEXT)&&e.server().posts==0);
   e.server().request.put("state","answered");e.hub.detail(e.first().binding(),"request","bridge-request",NOW+1);e.server().offline=true;int calls=e.server().calls;VoiceAnswerSession restored=new VoiceAnswerSession(memory);yes(restored.phase().equals("SUBMITTING"));e.hub.answerVoice(e.first().binding(),restored,NOW+172800000);yes(restored.phase().equals("SAVED")&&e.server().calls==calls&&only(e.hub,e.first().binding()).get("payload").equals(saved.get("payload")));e.hub.answerVoice(e.first().binding(),restored,NOW+172800001);yes(e.server().calls==calls&&e.hub.view(e.first().binding()).pending.size()==1);
  }
 }
 static void lostResponse(File root)throws Exception{
  try(Env e=new Env(root,"lost-server-response")){Memory memory=new Memory();VoiceAnswerSession draft=new VoiceAnswerSession(memory);String binding=e.first().binding();e.prepare(draft);review(draft);e.hub.answerVoice(binding,draft,NOW);String payload=(String)only(e.hub,binding).get("payload");e.server().loseResponse=true;e.hub.pump(NOW);yes(e.server().posts==1&&only(e.hub,binding).get("state").equals("retry_wait"));int calls=e.server().calls;e.hub.answerVoice(binding,draft,NOW+1);yes(e.server().calls==calls&&only(e.hub,binding).get("payload").equals(payload));e.hub.pump(NOW+40000);yes(e.server().posts==1&&e.server().lookups==1&&only(e.hub,binding).get("state").equals("server_stored"));e.server().offline=true;calls=e.server().calls;e.hub.answerVoice(binding,new VoiceAnswerSession(memory),NOW+40001);yes(e.server().calls==calls&&only(e.hub,binding).get("payload").equals(payload));}
 }
 public static void main(String[] args)throws Exception{File root=new File(args[0]);routes(root);boundaries(root);interruptedSave(root);lostResponse(root);System.out.println("Task voice bridge: "+checks+" assertions passed (synthetic transport/capture, original routes and durable mailbox)");}
}
