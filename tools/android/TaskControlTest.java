package com.turboio.addon;

import java.io.*;import java.nio.charset.StandardCharsets;import java.nio.file.*;import java.util.*;

/** Offline exact-turn controls through the real durable mailbox and synthetic transport. */
public final class TaskControlTest {
 static final long NOW=TaskConnection.stamp("2026-10-25T10:00:00Z");static int checks;
 interface Run{void run()throws Exception;}
 static void yes(boolean b){checks++;if(!b)throw new AssertionError("control check "+checks);}
 static void no(Run run)throws Exception{checks++;try{run.run();}catch(IllegalArgumentException|IllegalStateException|IOException expected){return;}throw new AssertionError("expected rejection "+checks);}
 static Map<String,Object> copy(Map<String,Object> v){return WireJson.map(WireJson.copy(v));}
 static String uuid(int n){return String.format(Locale.ROOT,"10000000-0000-4000-8000-%012d",n);}
 static TaskConnection connection(String session){Map<String,Object> v=TaskConnectionTest.sample();v.put("session_id",UUID.nameUUIDFromBytes(session.getBytes(StandardCharsets.UTF_8)).toString());v.put("expires_at",TaskWire.now(NOW+86400000));return TaskConnection.parse(WireJson.bytes(v),NOW);}
 static Map<String,Object> execution(int command,String turn,String phase){return WireJson.object("command_id",uuid(command),"turn_id",turn,"phase",phase);}
 static Map<String,Object> task(TaskConnection c,String state,String phase,int rev){
  Map<String,Object> body=WireJson.object("task_id","original-task","revision",rev,"route",c.route(),"command","原始完整指令\n不能改写","state",state,"allow_create_session",false,"execution",execution(1,"turn-exact",phase));return item(body,rev);
 }
 static Map<String,Object> item(Map<String,Object> body,long seq){Map<String,Object> v=WireJson.object("schema_version","1.0","kind","task","object_id",body.get("task_id"),"revision",body.get("revision"),"commit_seq",seq,"stored_at",TaskWire.now(NOW+seq),"event_id","event-"+seq,"expires_at",TaskWire.now(NOW+3600000),"state",body.get("state"),"body",copy(body));TaskWire.object(v);return v;}
 static Map<String,Object> event(Map<String,Object> row){return WireJson.map(WireJson.read(((String)row.get("payload")).getBytes(StandardCharsets.UTF_8)));}
 static Map<String,Object> ack(Map<String,Object> event){Map<String,Object> b=TaskWire.body(event);return WireJson.object("schema_version","1.0","event_id",event.get("event_id"),"kind","task","object_id",b.get("task_id"),"revision",b.get("revision"),"commit_seq",20,"stored_at",TaskWire.now(NOW),"receipt",WireJson.object("receipt_id","storage-receipt","subject_kind","task","subject_id",b.get("task_id"),"subject_revision",b.get("revision"),"stage","server_stored","actor_id","server-storage","related_event_id",event.get("event_id"),"error",null));}
 static byte[] error(String code){return WireJson.bytes(WireJson.object("schema_version","1.0","error",WireJson.object("code",code,"retryable",false)));}
 static final class Peer implements TaskApi.Transport {
  final TaskConnection c;Map<String,Object> task;boolean capability=true,offline,loseAck;int posts,lookups,reads;Map<String,Object> saved;Object advertised;
  Peer(TaskConnection c){this.c=c;task=task(c,"running","running",2);}
  TaskApi.Response ok(Object body){return new TaskApi.Response(200,WireJson.bytes(body),0);}
  public TaskApi.Response exchange(String path,byte[] payload)throws IOException{
   if(offline)throw new java.net.ConnectException("offline");
   if(path.equals("/identity")){Map<String,Object> identity=WireJson.object("schema_version","1.0","owner_id",c.owner,"producer_id",c.producer,"server_id",c.server,"expires_at",c.expires,"scopes",new ArrayList<>(TaskConnection.SCOPES));if(advertised!=null)identity.put("capabilities",advertised);else if(capability)identity.put("capabilities",Arrays.asList("task_session_control_v1",TaskSessionDirectory.CAPABILITY));return ok(identity);}
   if(path.equals("/agent-sessions"))return ok(TaskDirectoryTest.directory(c));
   if(path.startsWith("/tasks/")&&payload==null){reads++;return ok(task);}
   if(path.startsWith("/events/")){lookups++;return saved==null?new TaskApi.Response(404,error("EVENT_NOT_FOUND"),0):ok(ack(saved));}
   if(path.equals("/tasks")&&payload!=null){posts++;saved=WireJson.map(WireJson.read(payload));if(loseAck)throw new java.net.SocketTimeoutException("lost response");return new TaskApi.Response(201,WireJson.bytes(ack(saved)),0);}
   if(path.startsWith("/inbox"))return ok(WireJson.object("items",Arrays.asList(task),"has_more",false,"next_cursor","cursor-"+task.get("revision"),"server_time",TaskWire.now(NOW),"fresh_until",TaskWire.now(NOW+3000)));
   throw new AssertionError("unexpected transport "+path);
  }
  public void cancel(){}
 }
 static void wire()throws Exception{
  TaskConnection c=connection("codex");Map<String,Object> running=task(c,"running","running",2),ex=copy(TaskWire.execution(TaskWire.body(running).get("execution")));
  yes(TaskControl.eligible(running,"stop"));yes(!TaskControl.eligible(running,"resume"));
  for(String phase:new String[]{"result_pending","outcome_unknown"}){Map<String,Object> v=copy(running);TaskWire.body(v).put("execution",execution(1,"turn-exact",phase));yes(!TaskControl.eligible(v,"stop"));}
  Map<String,Object> stop=TaskControl.update(running,ex,uuid(2),"stop","",NOW,NOW+60000);yes(stop.get("state").equals("stop_requested"));yes(TaskWire.positive(stop.get("revision"))==3);yes(TaskWire.same(stop.get("execution"),ex));yes(stop.get("command").equals(TaskWire.body(running).get("command")));yes(TaskWire.same(stop.get("route"),c.route()));yes(!TaskWire.control(stop.get("control")).containsKey("text"));yes(TaskControl.current(stop,running));
  no(()->TaskControl.update(running,execution(1,"another-turn","running"),uuid(3),"stop","",NOW,NOW+60000));
  no(()->TaskControl.update(running,ex,uuid(3),"stop","hidden instruction",NOW,NOW+60000));
  no(()->TaskControl.update(running,ex,uuid(3),"stop","",NOW,NOW));
  Map<String,Object> stopped=task(c,"stopped","stopped",5),se=TaskWire.execution(TaskWire.body(stopped).get("execution"));
  String text="先修正范围，再继续。\n保留完整内容";Map<String,Object> resume=TaskControl.update(stopped,se,uuid(4),"resume",text,NOW,NOW+600000);
  yes(resume.get("state").equals("resume_requested"));yes(TaskWire.control(resume.get("control")).get("text").equals(text));yes(resume.get("command").equals(TaskWire.body(stopped).get("command")));
  no(()->TaskControl.update(stopped,se,uuid(4),"resume"," \n ",NOW,NOW+600000));
  no(()->TaskControl.update(stopped,se,uuid(4),"resume",String.join("",Collections.nCopies(10923,"汉")),NOW,NOW+600000));
  yes(TaskControl.update(stopped,se,uuid(4),"resume",String.join("",Collections.nCopies(10922,"汉")),NOW,NOW+600000)!=null);
  for(String state:new String[]{"stop_requested","stop_unconfirmed","resume_requested"}){String phase=state.equals("stop_requested")?"stop_requested":state.equals("stop_unconfirmed")?"stop_unconfirmed":"stopped";Map<String,Object> v=task(c,state,phase,6);yes(!TaskControl.eligible(v,"resume"));yes(!TaskControl.eligible(v,"stop"));}
  Map<String,Object> invalid=copy(stop);TaskWire.execution(invalid.get("execution")).put("phase","stopped");no(()->TaskWire.body("task",invalid));
  Map<String,Object> nullTurn=copy(running);TaskWire.execution(TaskWire.body(nullTurn).get("execution")).put("turn_id",null);no(()->TaskWire.object(nullTurn));
  Map<String,Object> extra=copy(TaskWire.control(resume.get("control")));extra.put("other","no");no(()->TaskWire.control(extra));
  Map<String,Object> stale=task(c,"running","running",3);yes(!TaskControl.current(stop,stale));
  Map<String,Object> mismatched=copy(stop);TaskWire.control(mismatched.get("control")).put("expected_turn_id","other-turn");yes(!TaskControl.current(mismatched,running));
 }
 static void mailbox(File dir)throws Exception{
  TaskConnection c=connection("original");Map<String,Object> running=task(c,"running","running",2),ex=TaskWire.execution(TaskWire.body(running).get("execution"));String payload;
  try(TaskMailbox box=new TaskMailbox(dir,c)){
   box.acceptDetail(running,NOW);Map<String,Object> local=box.control(uuid(10),"original-task",ex,"stop","",NOW,NOW+60000);payload=(String)local.get("payload");yes(local.get("state").equals("queued"));
   yes(box.control(uuid(10),"original-task",ex,"stop","",NOW+1,NOW+90000).get("payload").equals(payload));
   no(()->box.control(uuid(11),"original-task",ex,"stop","",NOW,NOW+60000));no(()->box.control(uuid(10),"original-task",ex,"stop","change",NOW,NOW+60000));
   Map<String,Object> moved=task(c,"stop_requested","stop_requested",4);box.acceptDetail(moved,NOW+1);
   yes(box.control(uuid(10),"original-task",ex,"stop","",NOW+2,NOW+90000).get("payload").equals(payload));
   no(()->box.control(uuid(10),"original-task",execution(1,"other","running"),"stop","",NOW+2,NOW+90000));
   TaskMailbox.Claim claim=box.claim(NOW);yes(claim.action.equals("send"));
  }
  try(TaskMailbox box=new TaskMailbox(dir,c)){
   TaskMailbox.Claim claim=box.claim(NOW+1);yes(claim.action.equals("lookup")&&claim.payload.equals(payload));box.finish(claim,200,WireJson.bytes(ack(claim.event())),NOW+1,0);
   yes(WireJson.map(box.cached("task","original-task").get("item")).get("state").equals("stop_requested"));
   Map<String,Object> stopped=task(c,"stopped","stopped",5);box.acceptDetail(stopped,NOW+2);Map<String,Object> se=TaskWire.execution(TaskWire.body(stopped).get("execution"));
   box.control(uuid(12),"original-task",se,"resume","继续完整指示",NOW+2,NOW+600002);
   TaskMailbox.Claim next=box.claim(NOW+2);yes(TaskWire.control(TaskWire.body(next.event()).get("control")).get("kind").equals("resume"));box.finish(next,409,error("REVISION_CONFLICT"),NOW+2,0);
   yes(TaskControl.pending(box.pending(),stopped,"resume")==null);box.control(uuid(13),"original-task",se,"resume","新指示",NOW+3,NOW+600003);
   next=box.claim(NOW+3);box.finish(next,0,new byte[0],NOW+3,0);no(()->box.control(uuid(14),"original-task",se,"resume","不许复制不明继续",NOW+4,NOW+600004));
  }
  // Stored-but-expired-before-dispatch resume may be followed by a new user intent,
  // only after a later authoritative stopped revision resolves the former control.
  try(TaskMailbox box=new TaskMailbox(new File(dir,"resolved"),c)){
   Map<String,Object> stopped=task(c,"stopped","stopped",5);box.acceptDetail(stopped,NOW);Map<String,Object> se=TaskWire.execution(TaskWire.body(stopped).get("execution"));
   box.control(uuid(20),"original-task",se,"resume","早先指示",NOW,NOW+60000);TaskMailbox.Claim claim=box.claim(NOW);box.finish(claim,201,WireJson.bytes(ack(claim.event())),NOW,0);
   yes(TaskControl.pending(box.pending(),stopped,"resume")!=null);Map<String,Object> later=task(c,"stopped","stopped",7);box.acceptDetail(later,NOW+70000);yes(TaskControl.pending(box.pending(),later,"resume")==null);
   box.control(uuid(21),"original-task",se,"resume","新的继续",NOW+70000,NOW+130000);yes(box.pending().size()==2);
  }
 }
 static void transport(File dir)throws Exception{
  TaskConnection a=connection("codex-original"),b=connection("claude-other");TaskProfiles profiles=TaskProfiles.empty().upsert(a,true,NOW,true).upsert(b,true,NOW,false);Map<String,Peer> peers=new HashMap<>();
  try(TaskHub hub=new TaskHub(dir,profiles,c->{Peer p=new Peer(c);peers.put(c.binding(),p);return p;})){
   Map<String,Object> ex=execution(1,"turn-exact","running");yes(!hub.view(a.binding()).sessionControl);no(()->hub.control(a.binding(),uuid(30),"original-task",ex,"stop","",NOW,NOW+60000));
   hub.pump(NOW);yes(hub.view(a.binding()).sessionControl);hub.apply(profiles.select(b.binding()));peers.get(a.binding()).offline=true;
   hub.control(a.binding(),uuid(30),"original-task",ex,"stop","",NOW+1,NOW+60000);hub.pump(NOW+5000);yes(peers.get(a.binding()).posts==0);yes(hub.view(a.binding()).pending.size()==1);yes(hub.view(b.binding()).pending.isEmpty());
   peers.get(a.binding()).offline=false;peers.get(a.binding()).loseAck=true;hub.pump(NOW+11000);yes(peers.get(a.binding()).posts==1);yes(WireJson.map(hub.view(a.binding()).pending.get(0)).get("needs_lookup").equals(true));
   // The original turn can finish while ACK is lost. Lookup must still retrieve the
   // exact receipt, rather than checking eligibility or posting a second command.
   peers.get(a.binding()).task=task(a,"stopped","stopped",4);hub.pump(NOW+50000);yes(peers.get(a.binding()).posts==1);yes(peers.get(a.binding()).lookups==1);yes(WireJson.map(hub.view(a.binding()).pending.get(0)).get("state").equals("server_stored"));yes(hub.view(a.binding()).item("task","original-task").get("state").equals("stopped"));
   TaskPresentation p=new TaskPresentation(Arrays.asList(new TaskPresentation.Source(hub.view(a.binding()).profile,hub.view(a.binding()).objects,hub.view(a.binding()).pending)),NOW);yes(p.rows.size()==1);yes(p.rows.get(0).local==null);yes(p.rows.get(0).state.equals("stopped"));
   Map<String,Object> stoppedExecution=execution(1,"turn-exact","stopped");
   hub.control(a.binding(),uuid(31),"original-task",stoppedExecution,"resume","只按新的范围继续\n保留附加条件",NOW+51000,NOW+651000);peers.get(a.binding()).loseAck=false;hub.pump(NOW+54000);
   Map<String,Object> resumeBody=TaskWire.body(peers.get(a.binding()).saved),control=TaskWire.control(resumeBody.get("control"));
   yes(peers.get(a.binding()).posts==2&&peers.get(b.binding()).posts==0);yes(TaskWire.same(resumeBody.get("route"),a.route()));yes(control.get("control_id").equals(uuid(31)));yes(control.get("expected_command_id").equals(uuid(1))&&control.get("expected_turn_id").equals("turn-exact"));
   yes(control.get("text").equals("只按新的范围继续\n保留附加条件"));yes(resumeBody.get("task_id").equals("original-task")&&resumeBody.get("command").equals("原始完整指令\n不能改写"));
   yes(hub.view(a.binding()).item("task","original-task").get("state").equals("stopped"));
   no(()->hub.control(a.binding(),uuid(32),"original-task",stoppedExecution,"resume","不能重复",NOW+55000,NOW+655000));
   Map<String,Object> accepted=copy(resumeBody);accepted.put("revision",6);accepted.put("state","agent_received");accepted.put("execution",execution(31,null,"accepted"));peers.get(a.binding()).task=item(accepted,6);hub.pump(NOW+58000);
   yes(hub.view(a.binding()).item("task","original-task").get("state").equals("agent_received"));yes(hub.profiles().selected.equals(b.binding()));
   Map<String,Object> continued=copy(accepted);continued.put("revision",7);continued.put("state","running");continued.put("execution",execution(31,"new-exact-turn","running"));peers.get(a.binding()).task=item(continued,7);hub.pump(NOW+62000);
   yes(TaskControl.eligible(hub.view(a.binding()).item("task","original-task"),"stop"));yes(peers.get(a.binding()).posts==2);
  }
  try(TaskHub hub=new TaskHub(dir,profiles,c->new Peer(c))){yes(!hub.view(a.binding()).sessionControl);yes(hub.view(a.binding()).pending.size()==2);}
  // New revision, withdrawn capability, and unavailable refresh all fail closed.
  for(int mode=0;mode<3;mode++){
   Peer peer=new Peer(a);TaskApi api=new TaskApi(a,peer);
   try(TaskMailbox box=new TaskMailbox(new File(dir,"case-"+mode),a)){
    api.pump(box,NOW);Map<String,Object> e=execution(1,"turn-exact","running");box.control(uuid(40+mode),"original-task",e,"stop","",NOW+1,NOW+60000);
    if(mode==0)peer.task=task(a,"running","running",3);if(mode==1)peer.capability=false;if(mode==2)peer.advertised="task_session_control_v1";
    api.pump(box,NOW+4000);yes(peer.posts==0);yes(WireJson.map(box.pending().get(0)).get("state").equals("blocked"));yes(!Boolean.TRUE.equals(WireJson.map(box.pending().get(0)).get("needs_lookup")));
   }
  }
 }
 static void presentation(){
  TaskConnection c=connection("presentation");Map<String,Object> task=task(c,"running","running",2);Map<String,Object> body=TaskControl.update(task,execution(1,"turn-exact","running"),uuid(90),"stop","",NOW,NOW+60000);
  Map<String,Object> event=TaskWire.envelope("task",c.producer,body,"control",NOW,NOW+60000),local=WireJson.object("payload",new String(WireJson.bytes(event),StandardCharsets.UTF_8),"state","server_stored","error","","needs_lookup",false);
  TaskPresentation p=new TaskPresentation(Arrays.asList(new TaskPresentation.Source(new TaskProfiles.Profile(c,true),Arrays.asList(WireJson.object("item",task)),Arrays.asList(local))),NOW);
  yes(p.rows.size()==1&&p.rows.get(0).local==null&&p.rows.get(0).control==local);yes(p.rows.get(0).state.equals("running"));yes(TaskPresentation.controlStatus(local).contains("等待电脑确认"));yes(!TaskPresentation.status(p.rows.get(0)).contains("已停止"));
 }
 public static void main(String[] args)throws Exception{wire();mailbox(new File(args[0],"mailbox"));transport(new File(args[0],"transport"));presentation();System.out.println("Task controls: "+checks+" checks passed (exact execution, original routes, capability, UTF-8 limits, immutable retry/restart, conflict, receipt vs stop proof, default isolation)");}
}
