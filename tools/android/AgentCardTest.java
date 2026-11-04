package com.turboio.addon;

import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.*;

/** Original-route card operations through real durable mailbox/TaskApi; simulated device only. */
public final class AgentCardTest {
 static final long NOW=TaskConnection.stamp("2026-10-20T10:00:00Z");
 static final String PEER="synthetic-glasses",OTHER="other-glasses";
 static final String GUARD=String.join("",Collections.nCopies(32,"a"));
 static int checks;static long clock;
 interface Run {void run()throws Exception;}
 static void yes(boolean value){checks++;if(!value)throw new AssertionError("agent card check "+checks);}
 static void rejects(Run run)throws Exception{checks++;try{run.run();}catch(IllegalArgumentException|IOException expected){return;}throw new AssertionError("expected rejection "+checks);}
 static final class Memory implements AgentCardSession.Store {
  Object value;boolean fail;public Object read(){return value;}public void save(Object raw)throws Exception{if(fail)throw new IOException();value=WireJson.copy(raw);}
 }
 static TaskConnection connection(String agent){Map<String,Object> v=TaskConnectionTest.sample();v.put("computer_id","pc");v.put("agent_id",agent);v.put("project_id","project");v.put("session_id","original-"+agent);v.put("expires_at",TaskWire.now(NOW+86400000));return TaskConnection.parse(WireJson.bytes(v),NOW);}
 static Map<String,Object> item(String kind,Map<String,Object> body,int seq){return WireJson.object("schema_version","1.0","kind",kind,"object_id",TaskWire.objectId(kind,body),"revision",TaskWire.revision(kind,body),"commit_seq",seq,"stored_at",TaskWire.now(NOW),"event_id","event-"+kind,"expires_at",TaskWire.now(NOW+3600000),"state",body.get("state"),"body",WireJson.copy(body));}
 static Map<String,Object> task(TaskConnection c){return item("task",WireJson.object("task_id","same-task-id","revision",1,"route",c.route(),"state","waiting_answer","command","合成任务，不执行外部操作","allow_create_session",false),1);}
 static Map<String,Object> request(TaskConnection c,int count){List<Object> options=new ArrayList<>();for(int i=0;i<count;i++)options.add(WireJson.object("option_id","option-"+i,"label",new String[]{"只预览","保留资料","先修改","稍后处理"}[i]));return item("request",WireJson.object("request_id","same-question-id","revision",1,"task_id","same-task-id","route",c.route(),"state","pending","mode","choice","question","选哪个方案？","options",options),2);}
 // prepare() routes 3-4 option questions to the prompter; a paged card stored before that rule is
 // still restored and paged, which is what the session tests below exercise.
 static AgentCardRequest frozen(TaskConnection c,int count){Map<String,Object> req=request(c,count);// Choices are prompter-routed now; restore still yields the paged card older builds stored.

  return AgentCardRequest.restore(WireJson.object("schema",1,"binding",c.binding(),"fingerprint",TaskWire.requestFingerprint(req),"request",req,"computer",c.computer,"agent",c.agent));}
 static byte[] action(String uid,int cmd){return OtaFrame.encode(34,OtaFrame.object("suggestUID",uid,"suggestType",2,"cmd",cmd),null);}
 static AgentCardSession.Emission emission(AgentCardSession s){AgentCardSession.Emission e=s.next(PEER,1,clock,true);yes(e!=null);return e;}
 static AgentCardSession active(Memory m,AgentCardRequest r){
  clock=1000;AgentCardSession s=new AgentCardSession(m);yes(s.prepare(r,PEER,1));yes(s.pending()&&!s.cardMayExist());yes(s.bindGuard(GUARD));
  yes(!s.show(PEER,1,clock,NOW,false)&&s.next(PEER,1,clock,false)==null);yes(!s.show(OTHER,1,clock,NOW,true));
  yes(s.show(PEER,1,clock,NOW,true)&&s.cardMayExist());s.receive(PEER,1,action(s.uid(),1),clock,NOW,true);yes(s.pendingAnswer()==null);
  AgentCardSession.Emission e=emission(s);yes(e.type==33&&OtaFrame.decode(e.bytes).type==33&&s.permits(e,PEER,1,clock,true));
  yes(!s.permits(e,OTHER,1,clock,true)&&!s.permits(e,PEER,2,clock,true)&&!s.permits(e,PEER,1,clock,false));
  s.result(e.ticket,true,++clock);yes(s.phase().equals("ACTIVE"));return s;
 }
 static void ackAndRemove(AgentCardSession s){
  AgentCardSession.Emission e=emission(s);yes(e.type==35&&BoundedJson.number(BoundedJson.map(OtaFrame.decode(e.bytes).json).get("code"),0,0)==0);s.result(e.ticket,true,clock);
  s.tick(PEER,1,clock+2499,NOW,true,true,true);yes(s.next(PEER,1,clock+2499,true)==null);clock+=2500;s.tick(PEER,1,clock,NOW,true,true,true);
  e=emission(s);yes(e.type==33&&BoundedJson.number(BoundedJson.map(OtaFrame.decode(e.bytes).json).get("type"),2,2)==2);s.result(e.ticket,true,clock);clock+=300;
 }
 static void cleanup(AgentCardSession s,int count){
  yes(!s.cleanup(OTHER,1)&&s.cleanup(PEER,1));for(int i=0;i<count;i++){AgentCardSession.Emission e=emission(s);yes(e.purpose.equals("cleanup")&&e.type==33);s.result(e.ticket,true,clock);}
  yes(s.phase().equals("RETIRED")&&s.cardMayExist()&&!s.pending());CardInputClosure proof=s.closure();yes(proof!=null&&proof.matches(s.owner(),FixedPeerHash.of(PEER),GUARD));yes(!proof.matches(s.owner(),FixedPeerHash.of(OTHER),GUARD));yes(!proof.matches(s.owner(),FixedPeerHash.of(PEER),String.join("",Collections.nCopies(32,"b"))));yes(!s.confirmExit(PEER,1,"sdk_receipt"));yes(!s.confirmExit(PEER,1,"idle_query"));yes(!s.confirmExit(OTHER,1,"observed_home"));yes(s.confirmExit(PEER,1,"observed_home"));yes(!s.pending()&&!s.cardMayExist());
 }
 static void cache(TaskMailbox box,TaskConnection c)throws Exception{box.acceptDetail(task(c),NOW);box.acceptDetail(request(c,4),NOW);}
 static Map<String,Object> save(TaskMailbox box,AgentCardSession.Answer a)throws Exception{return box.draftAnswer(a.operation,a.request.requestId,a.request.revision,a.option,a.text,"glasses_semantic",a.request.fingerprint,NOW);}
 static final class Endpoint implements TaskApi.Transport {
  final TaskConnection connection;final Map<String,Object> task,request;final List<Map<String,Object>> posts=new ArrayList<>();
  Endpoint(TaskConnection c){connection=c;task=task(c);request=request(c,4);}
  public void cancel(){}
  public TaskApi.Response exchange(String path,byte[] payload)throws IOException{Object value;
   if(path.equals("/identity"))value=WireJson.object("schema_version","1.0","owner_id",connection.owner,"producer_id",connection.producer,"server_id",connection.server,"expires_at",connection.expires,"scopes",new ArrayList<>(TaskConnection.SCOPES));
   else if(path.startsWith("/inbox"))value=WireJson.object("items",Arrays.asList(task,request),"has_more",false,"next_cursor","cursor","server_time",TaskWire.now(NOW),"fresh_until",TaskWire.now(NOW+3000));
   else if(path.startsWith("/requests/"))value=request;
   else if(path.startsWith("/tasks/"))value=task;
   else if(path.equals("/answers")&&payload!=null){String text=new String(payload,StandardCharsets.UTF_8);Map<String,Object> event=WireJson.map(WireJson.read(payload));posts.add(event);TaskMailbox.Claim claim=new TaskMailbox.Claim(WireJson.object("operation_id","test","payload",text,"attempts",1,"needs_lookup",false),connection.binding());return new TaskApi.Response(201,WireJson.bytes(TaskMailboxTest.ack(claim)),0);}
   else throw new IOException("TASK_QUERY_INVALID");return new TaskApi.Response(200,WireJson.bytes(value),0);
  }
 }

 static void notices()throws Exception{
  TaskConnection c=connection("codex");Map<String,Object> parent=task(c),notice=item("message",WireJson.object("message_id","notice-"+String.join("",Collections.nCopies(64,"a")),"revision",1,"task_id","same-task-id","route",c.route(),"request_id",null,"channel","progress","text","等待查明录音占用，无需回答"),3);notice.put("state","recorded");
  TaskNotice prepared=TaskNotice.prepare(c,notice,parent,NOW);yes(prepared.text.equals(TaskWire.text(TaskWire.body(notice).get("text"),1800,false))&&!prepared.text.contains("长按退出"));yes(prepared.key.equals(TaskNotice.prepare(c,notice,parent,NOW).key));
  OtaFrame frame=OtaFrame.decode(prepared.frame("cn.cznbnb.ioagent","Codex提醒",NOW));Map<String,Object> payload=BoundedJson.map(frame.json);
  yes(frame.type==2&&frame.binary.length==0);yes(payload.keySet().equals(new HashSet<>(Arrays.asList("notificationUID","appId","appName","title","subtitle","content","timestamp","category","reply","type"))));
  yes(payload.get("notificationUID").equals(prepared.key)&&payload.get("appId").equals("cn.cznbnb.ioagent")&&payload.get("content").equals(prepared.text));
  yes(payload.get("reply").equals(false)&&((Number)payload.get("type")).intValue()==1&&((Number)payload.get("category")).intValue()==0);
  yes(java.time.Instant.parse((String)payload.get("timestamp")).toEpochMilli()==NOW);yes(TaskNotice.oneLine("第一行。\n第二行\r\n第三行").equals("第一行。第二行；第三行"));
  Object message=new Object();boolean[] allowed={true};byte[] bytes=prepared.frame("cn.cznbnb.ioagent","Codex提醒",NOW);
  yes(SuggestionGate.register(message,PEER,bytes,()->allowed[0]));yes(SuggestionGate.allow(message,PEER,bytes));yes(!SuggestionGate.allow(message,OTHER,bytes));
  allowed[0]=false;yes(!SuggestionGate.allow(message,PEER,bytes));allowed[0]=true;SuggestionGate.retire(message);yes(!SuggestionGate.allow(message,PEER,bytes));
  // A re-pair derives a new binding (new producer and token) for the same session: the notice is not shown again.
  {Map<String,Object> v=TaskConnectionTest.sample();v.put("computer_id","pc");v.put("agent_id",c.agent);v.put("project_id","project");v.put("session_id",c.session);v.put("expires_at",TaskWire.now(NOW+86400000));v.put("producer_id","synthetic-repaired-phone");v.put("token","B".repeat(43));
   TaskConnection repaired=TaskConnection.parse(WireJson.bytes(v),NOW);TaskNotice again=TaskNotice.prepare(repaired,notice,parent,NOW);yes(!repaired.binding().equals(c.binding())&&again.key.equals(prepared.key)&&!again.legacy.equals(prepared.legacy));}
  rejects(()->TaskNotice.prepare(connection("claude"),notice,parent,NOW));
  rejects(()->TaskNotice.prepare(c,notice,parent,NOW+3600000));
  Map<String,Object> closed=WireJson.map(WireJson.copy(parent));closed.put("state","completed");TaskWire.body(closed).put("state","completed");yes(TaskNotice.prepare(c,notice,closed,NOW).live(NOW));
  for(String end:new String[]{"cancelled","failed","expired"}){Map<String,Object> rejected=WireJson.map(WireJson.copy(parent));rejected.put("state",end);TaskWire.body(rejected).put("state",end);rejects(()->TaskNotice.prepare(c,notice,rejected,NOW));}
  Map<String,Object> other=WireJson.map(WireJson.copy(notice));TaskWire.body(other).put("request_id","some-question");final Map<String,Object> question=other;rejects(()->TaskNotice.prepare(c,question,parent,NOW));
  other=WireJson.map(WireJson.copy(notice));TaskWire.body(other).put("channel","result");final Map<String,Object> result=other;rejects(()->TaskNotice.prepare(c,result,parent,NOW));
 }
 public static void main(String[] args)throws Exception{
  notices();TaskNoticeQueueTest.run(new File(args[0]));
  TaskConnection c=connection("codex"),h=connection("hermes");AgentCardRequest r=frozen(c,4);yes(!r.owner.equals(frozen(h,4).owner));yes(r.fingerprint.equals(AgentCardRequest.restore(r.json()).fingerprint));
  for(int i=0;i<4;i++){AgentCardRequest.Copy copy=r.copy(i);yes(copy.content.contains("["+(i+1)+"/4]")&&copy.content.contains(r.answerText(i))&&copy.content.length()<=48);}
  Map<String,Object> changed=WireJson.map(WireJson.copy(request(c,4)));TaskWire.body(changed).put("question","新的问题");yes(!r.matches(changed,task(c),NOW));changed.put("revision",2);TaskWire.body(changed).put("revision",2);yes(!r.matches(changed,task(c),NOW));
  final Map<String,Object> longRequest=request(c,4);TaskWire.body(longRequest).put("question",String.join("",Collections.nCopies(60,"长")));rejects(()->AgentCardRequest.prepare(c,longRequest,task(c),NOW));
  // A card stored under an older, longer copy limit still restores (for cleanup) instead of blocking the runtime.
  final Map<String,Object> oldProbe=request(c,2);TaskWire.body(oldProbe).put("question",String.join("",Collections.nCopies(90,"长")));
  AgentCardRequest restoredProbe=AgentCardRequest.restore(WireJson.object("schema",1,"binding",c.binding(),"fingerprint",TaskWire.requestFingerprint(oldProbe),"request",oldProbe,"computer",c.computer,"agent",c.agent));yes(restoredProbe.size()==2);rejects(()->restoredProbe.copy(0));
  Memory oldStore=new Memory();AgentCardSession oldSession=active(oldStore,frozen(c,2));oldStore.value=WireJson.copy(oldStore.value);WireJson.map(oldStore.value).put("request",restoredProbe.json());yes(new AgentCardSession(oldStore).healthy());
  final Map<String,Object> newline=request(c,4);TaskWire.body(newline).put("question","保留完整\n条件");rejects(()->AgentCardRequest.prepare(c,newline,task(c),NOW));
  final Map<String,Object> textRequest=request(c,2);TaskWire.body(textRequest).put("mode","free_text");TaskWire.body(textRequest).put("options",Collections.emptyList());rejects(()->AgentCardRequest.prepare(h,request(c,4),task(c),NOW));
  voiceCards(args[0],c,textRequest);
  // Every option is reachable without interpreting skip/delete/disappearance as task refusal.
  for(int choose=0;choose<4;choose++){
   Memory m=new Memory();AgentCardSession s=active(m,r);List<String> prior=new ArrayList<>();
   for(int i=0;i<choose;i++){String old=s.uid();s.receive(PEER,1,action(old,2),clock,NOW,true);yes(s.pendingAnswer()==null);ackAndRemove(s);yes(s.phase().equals("NEXT_READY"));prior.add(old);yes(s.show(PEER,1,clock,NOW,true));AgentCardSession.Emission e=emission(s);s.result(e.ticket,true,clock);}
   for(String old:prior)s.receive(PEER,1,action(old,1),clock,NOW,true);
   s.receive(OTHER,1,action(s.uid(),1),clock,NOW,true);s.receive(PEER,2,action(s.uid(),1),clock,NOW,true);s.receive(PEER,1,action(s.uid(),1),clock,NOW,false);yes(s.pendingAnswer()==null);
   s.receive(PEER,1,action(s.uid(),1),clock,NOW,true);AgentCardSession.Answer a=s.pendingAnswer();yes(a!=null&&a.selected==choose&&a.text.equals(r.answerText(choose))&&s.next(PEER,1,clock,true)==null);
   s.receive(PEER,1,action(s.uid(),2),clock,NOW,true);yes(s.pendingAnswer().selected==choose);
   File root=new File(args[0],"option-"+choose);try(TaskMailbox box=new TaskMailbox(root,c)){cache(box,c);Map<String,Object> row=save(box,a),event=WireJson.map(WireJson.read(((String)row.get("payload")).getBytes(StandardCharsets.UTF_8))),body=TaskWire.body(event);
    yes(body.get("input_source").equals("glasses_semantic")&&body.get("raw_action")==null&&body.get("option_id").equals(r.option(choose))&&body.get("route").equals(c.route()));yes(row.get("state").equals("awaiting_refresh"));
    s.answerStored(a.operation,true,"");yes(s.pendingAnswer()==null);ackAndRemove(s);cleanup(s,choose+1);yes(!new AgentCardSession(m).pending());
   }
  }
  AgentCardSession s=active(new Memory(),r);for(int i=0;i<4;i++){s.receive(PEER,1,action(s.uid(),2),clock,NOW,true);ackAndRemove(s);if(i<3){yes(s.show(PEER,1,clock,NOW,true));AgentCardSession.Emission e=emission(s);s.result(e.ticket,true,clock);}}yes(s.pendingAnswer()==null);cleanup(s,4);
  // Receipt timeout, expired/withdrawn question and head revocation never manufacture an answer.
  for(int stop=0;stop<5;stop++){s=active(new Memory(),r);switch(stop){case 0:s.tick(PEER,1,clock+120000,NOW,true,true,true);break;case 1:s.tick(PEER,1,clock,NOW,false,true,true);break;case 2:s.tick(PEER,1,clock,NOW,true,false,true);break;case 3:s.tick(PEER,1,clock,NOW,true,true,false);break;default:s.tick(OTHER,2,clock,NOW,true,true,true);}s.receive(PEER,1,action(s.uid(),1),clock,NOW,true);yes(s.pendingAnswer()==null&&s.phase().equals("RECOVERY_PENDING"));}
  Memory m=new Memory();s=active(m,r);s.receive(PEER,1,action(s.uid(),1),clock,NOW,true);AgentCardSession.Answer a=s.pendingAnswer();AgentCardSession reboot=new AgentCardSession(m);yes(reboot.pendingAnswer()!=null&&!reboot.show(PEER,1,clock,NOW,true)&&reboot.next(PEER,1,clock,true)==null);
  try(TaskMailbox box=new TaskMailbox(new File(args[0],"crash-before-mailbox"),c)){cache(box,c);Map<String,Object> row=save(box,reboot.pendingAnswer());reboot.answerStored(a.operation,true,"");yes(reboot.next(PEER,1,clock,true)==null);yes(box.pending().size()==1);cleanup(reboot,1);}
  // Mailbox committed but the callback was lost: reopen/retry returns the same bytes after closure.
  m=new Memory();s=active(m,r);s.receive(PEER,1,action(s.uid(),1),clock,NOW,true);a=s.pendingAnswer();String payload;
  File lost=new File(args[0],"crash-after-mailbox");try(TaskMailbox box=new TaskMailbox(lost,c)){cache(box,c);payload=(String)save(box,a).get("payload");Map<String,Object> closed=request(c,4);closed.put("state","answered");box.acceptDetail(closed,NOW);}
  reboot=new AgentCardSession(m);try(TaskMailbox box=new TaskMailbox(lost,c)){yes(payload.equals(save(box,reboot.pendingAnswer()).get("payload"))&&box.pending().size()==1);reboot.answerStored(a.operation,true,"");yes(reboot.pendingAnswer()==null&&reboot.next(PEER,1,clock,true)==null);}
  // Exiting before the mailbox callback does not lose the captured original answer across restart.
  m=new Memory();s=active(m,r);s.receive(PEER,1,action(s.uid(),1),clock,NOW,true);cleanup(s,1);reboot=new AgentCardSession(m);yes(!reboot.pending()&&reboot.pendingAnswer()!=null&&!reboot.prepare(r,PEER,1));
  reboot.answerStored(reboot.pendingAnswer().operation,true,"");yes(reboot.pendingAnswer()==null);
  // Phone wins a concurrent local save; no second answer or native success ACK is created.
  m=new Memory();s=active(m,r);s.receive(PEER,1,action(s.uid(),1),clock,NOW,true);final AgentCardSession.Answer competing=s.pendingAnswer();
  try(TaskMailbox box=new TaskMailbox(new File(args[0],"phone-wins"),c)){cache(box,c);box.draftAnswer("phone-winner",r.requestId,r.revision,r.option(1),r.answerText(1),NOW);rejects(()->save(box,competing));s.answerStored(competing.operation,false,"TASK_ANSWER_ALREADY_SAVED");yes(box.pending().size()==1&&s.next(PEER,1,clock,true)==null&&new AgentCardSession(m).pendingAnswer()==null);}
  cleanup(s,1);yes(!s.prepare(r,PEER,1));yes(s.retryAnswer()&&s.pendingAnswer()!=null&&s.pendingAnswer().text.equals(competing.text));
  try(TaskMailbox box=new TaskMailbox(new File(args[0],"wrong-fingerprint"),c)){cache(box,c);rejects(()->box.draftAnswer("changed-question",r.requestId,r.revision,r.option(0),r.answerText(0),"glasses_semantic",String.join("",Collections.nCopies(64,"0")),NOW));yes(box.pending().isEmpty());}
  // Journal damage and failures before show/choice prevent sends, answers and ACKs.
  m=new Memory();m.fail=true;s=new AgentCardSession(m);yes(!s.prepare(r,PEER,1)&&!s.healthy());m=new Memory();s=active(m,r);m.fail=true;s.receive(PEER,1,action(s.uid(),1),clock,NOW,true);yes(!s.healthy()&&s.pendingAnswer()==null&&s.next(PEER,1,clock,true)==null);m=new Memory();m.value=WireJson.object("schema",1,"pending",true);yes(!new AgentCardSession(m).healthy());
  // Real two-context Hub/TaskApi path: selected default Hermes cannot reroute a Codex card answer.
  TaskProfiles profiles=TaskProfiles.empty().upsert(c,true,NOW).upsert(h,true,NOW);Map<String,Endpoint> endpoints=new HashMap<>();
  try(TaskHub hub=new TaskHub(new File(args[0],"hub"),profiles,conn->{Endpoint e=new Endpoint(conn);endpoints.put(conn.binding(),e);return e;})){
   hub.pump(NOW);Memory store=new Memory();s=active(store,r);s.receive(PEER,1,action(s.uid(),1),clock,NOW,true);AgentCardSession.Answer captured=s.pendingAnswer();
   hub.answerGlasses(captured.request.binding,captured.operation,captured.request.requestId,captured.request.revision,captured.option,captured.text,captured.request.fingerprint,NOW);
   s.answerStored(captured.operation,true,"");hub.pump(NOW+4000);Endpoint codex=endpoints.get(c.binding()),hermes=endpoints.get(h.binding());yes(codex.posts.size()==1&&hermes.posts.isEmpty()&&hub.profiles().selected.equals(h.binding()));
   Map<String,Object> full=TaskWire.body(codex.posts.get(0));yes(full.get("request_id").equals(r.requestId)&&TaskWire.positive(full.get("request_revision"))==r.revision&&full.get("task_id").equals(r.taskId)&&full.get("route").equals(c.route())&&full.get("text").equals(r.answerText(0)));
   hub.answerGlasses(captured.request.binding,captured.operation,captured.request.requestId,captured.request.revision,captured.option,captured.text,captured.request.fingerprint,NOW+5000);hub.pump(NOW+8000);yes(codex.posts.size()==1);
  }
  // A server withdrawal after the click but before POST blocks the persisted local answer.
  Map<String,Endpoint> withdrawn=new HashMap<>();try(TaskHub hub=new TaskHub(new File(args[0],"withdrawn"),TaskProfiles.empty().upsert(c,true,NOW),conn->{Endpoint e=new Endpoint(conn);withdrawn.put(conn.binding(),e);return e;})){
   hub.pump(NOW);hub.answerGlasses(c.binding(),r.operation(),r.requestId,r.revision,r.option(0),r.answerText(0),r.fingerprint,NOW);withdrawn.get(c.binding()).request.put("state","withdrawn");hub.pump(NOW+4000);yes(withdrawn.get(c.binding()).posts.isEmpty());yes(WireJson.map(hub.view(c.binding()).pending.get(0)).get("state").equals("blocked"));
  }
  // Known closed/phone-won choices can be retained as full local drafts without blocking others.
  Memory kept=new Memory();s=active(kept,r);s.receive(PEER,1,action(s.uid(),1),clock,NOW,true);s.answerStored(r.operation(),false,"TASK_ANSWER_ALREADY_SAVED");cleanup(s,1);yes(s.keepUnsentDraft());yes(s.drafts().size()==1&&s.pendingAnswer()==null&&s.canPrepare());AgentCardSession keptAgain=new AgentCardSession(kept);yes(keptAgain.drafts().size()==1&&keptAgain.canPrepare());Map<String,Object> keptDraft=WireJson.map(keptAgain.drafts().get(0));yes(AgentCardRequest.restore(keptDraft.get("request")).answerText(BoundedJson.number(keptDraft.get("selected"),0,3)).equals(r.answerText(0)));
  // Private UID events stay ours after closure; unrelated stock/minute suggestions stay stock.
  yes(AgentCardSession.ownsOperation(action(s.uid(),1)));yes(AgentCardSession.ownsOperation(action(s.uid(),3)));yes(!AgentCardSession.ownsOperation(action("minute-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",1)));yes(!AgentCardSession.ownsOperation(OtaFrame.encode(33,OtaFrame.object("suggestUID",s.uid()),null)));
  final boolean[] admitted={true};Object sdk=new Object();byte[] bytes=OtaFrame.encode(33,OtaFrame.object("suggestUID",s.uid()),null);yes(SuggestionGate.register(sdk,PEER,bytes,()->admitted[0]));yes(SuggestionGate.allow(sdk,PEER,bytes));yes(!SuggestionGate.allow(sdk,OTHER,bytes));admitted[0]=false;yes(!SuggestionGate.allow(sdk,PEER,bytes));SuggestionGate.retire(sdk);admitted[0]=true;yes(!SuggestionGate.allow(sdk,PEER,bytes));yes(SuggestionGate.allow(new Object(),PEER,bytes));
  guardIntegration(args[0],c,r);
  System.out.println("agent request cards: "+checks+" assertions passed");
 }
 // A free-text question is one dictation prompt: accept hands off to the phone voice page once, never an answer.
 static void voiceCards(String root,TaskConnection c,Map<String,Object> textRequest)throws Exception{
  final AgentCardRequest v=AgentCardRequest.prepare(c,textRequest,task(c),NOW);yes(v.voice&&v.size()==1&&v.copy(0).content.equals("选哪个方案？；＋口述回答，删除留手机"));
  rejects(()->v.option(0));rejects(()->v.answerText(0));yes(AgentCardRequest.restore(v.json()).voice);
  final Map<String,Object> fits=WireJson.map(WireJson.copy(textRequest)),tooLong=WireJson.map(WireJson.copy(textRequest));
  TaskWire.body(fits).put("question",String.join("",Collections.nCopies(36,"问")));TaskWire.body(tooLong).put("question",String.join("",Collections.nCopies(37,"问")));
  yes(AgentCardRequest.prepare(c,fits,task(c),NOW).copy(0).content.length()==48);rejects(()->AgentCardRequest.prepare(c,tooLong,task(c),NOW));
  // Accept: ACK and removal like a step, then exactly one handoff after full retirement.
  Memory m=new Memory();AgentCardSession s=active(m,v);s.receive(PEER,1,action(s.uid(),1),clock,NOW,true);
  yes(s.pendingAnswer()==null&&!s.hasSelection()&&s.phase().equals("ACK_PENDING")&&s.takeVoiceHandoff(clock)==null);
  ackAndRemove(s);yes(s.phase().equals("CLEANUP_PENDING")&&s.takeVoiceHandoff(clock)==null);
  AgentCardSession reboot=new AgentCardSession(m);yes(reboot.pendingAnswer()==null&&reboot.takeVoiceHandoff(clock)==null);
  cleanup(s,1);yes(s.takeVoiceHandoff(clock)==v&&s.takeVoiceHandoff(clock)==null&&s.pendingAnswer()==null);
  try(TaskMailbox box=new TaskMailbox(new File(root,"voice-card"),c)){yes(box.pending().isEmpty());}
  // Delete leaves it on the phone; a late or expired handoff opens nothing.
  s=active(new Memory(),v);s.receive(PEER,1,action(s.uid(),2),clock,NOW,true);ackAndRemove(s);cleanup(s,1);yes(s.takeVoiceHandoff(clock)==null&&s.pendingAnswer()==null);
  s=active(new Memory(),v);s.receive(PEER,1,action(s.uid(),1),clock,NOW,true);ackAndRemove(s);cleanup(s,1);yes(s.takeVoiceHandoff(clock+AgentCardSession.VOICE_HANDOFF_MS)==null);
  // Confirm card: the exact draft (line breaks shown as spaces) under its own owner; accept hands that text back once.
  final AgentCardRequest cf=v.confirming("文件名叫录音测试。\n内容是通过。");yes(cf.voice&&cf.size()==1&&cf.copy(0).content.equals("文件名叫录音测试。 内容是通过。"));
  yes(!cf.owner.equals(v.owner)&&!cf.owner.equals(v.confirming("文件名叫录音测试。").owner)&&cf.fingerprint.equals(v.fingerprint));
  AgentCardRequest back=AgentCardRequest.restore(cf.json());yes(cf.confirm.equals(back.confirm)&&back.owner.equals(cf.owner)&&AgentCardRequest.restore(v.json()).confirm==null);
  rejects(()->v.confirming(" "));rejects(()->cf.confirming("再确认"));{String said=String.join("",Collections.nCopies(60,"字"));AgentCardRequest longSaid=v.confirming(said);String shown=longSaid.copy(0).content;yes(shown.length()<=48&&shown.endsWith("…（共60字）")&&shown.startsWith("字字字")&&longSaid.confirm.equals(said));}yes(v.confirming(String.join("",Collections.nCopies(48,"字"))).copy(0).content.length()==48);
  m=new Memory();s=active(m,cf);s.receive(PEER,1,action(s.uid(),1),clock,NOW,true);yes(s.pendingAnswer()==null&&!s.hasSelection());ackAndRemove(s);cleanup(s,1);AgentCardRequest confirmed=s.takeVoiceHandoff(clock);yes(confirmed!=null&&confirmed.confirm.equals(cf.confirm)&&s.takeVoiceHandoff(clock)==null);
  s=active(new Memory(),cf);yes(s.receive(OTHER,1,action(s.uid(),2),clock,NOW,true)==0);yes(s.receive(PEER,1,action(s.uid(),3),clock,NOW,true)==0);yes(s.receive(PEER,1,action(s.uid(),2),clock,NOW,true)==2);yes(s.receive(PEER,1,action(s.uid(),2),clock,NOW,true)==0);ackAndRemove(s);cleanup(s,1);yes(s.takeVoiceHandoff(clock)==null&&s.pendingAnswer()==null);
  // A handoff never carries over to the next prepared question.
  s=active(new Memory(),v);s.receive(PEER,1,action(s.uid(),1),clock,NOW,true);ackAndRemove(s);cleanup(s,1);yes(s.prepare(frozen(c,4),PEER,1)&&s.takeVoiceHandoff(clock)==null);
  routes(c,textRequest);
 }
 static String code(Run run)throws Exception{checks++;try{run.run();}catch(IllegalArgumentException e){return e.getMessage();}throw new AssertionError("expected rejection "+checks);}
 /** Card/prompter routing, the prompter manuscript, dictated option numbers and choice confirm cards. */
 static void routes(TaskConnection c,Map<String,Object> textRequest)throws Exception{
  // Real Codex registration uses a computer ID longer than the native heading slot.
  Map<String,Object> longSpec=TaskConnectionTest.sample();longSpec.put("computer_id","io-mac-codex-computer");longSpec.put("agent_id","io-current-codex-agent");longSpec.put("expires_at",TaskWire.now(NOW+86400000));
  TaskConnection longConnection=TaskConnection.parse(WireJson.bytes(longSpec),NOW);
  Map<String,Object> longRequest=request(longConnection,2);
  AgentCardRequest longConfirm=AgentCardRequest.prepareConfirm(longConnection,longRequest,task(longConnection),NOW,"选二，保留所有资料");
  yes(longConfirm.copy(0).source.equals("io-mac-codex-co…")&&longConfirm.copy(0).title.length()==16&&longConfirm.copy(0).title.endsWith("…"));
  yes(longConfirm.computer.equals(longConnection.computer)&&longConfirm.agent.equals(longConnection.agent)&&longConfirm.confirm.equals("选二，保留所有资料"));
  yes(TaskWire.same(TaskWire.body(WireJson.map(WireJson.map(longConfirm.json()).get("request"))).get("route"),longConnection.route()));
  yes(AgentCardRequest.restore(longConfirm.json()).owner.equals(longConfirm.owner)&&longConfirm.matches(longRequest,task(longConnection),NOW));
  Map<String,Object> otherSpec=WireJson.map(WireJson.copy(longSpec));otherSpec.put("computer_id","io-mac-codex-competing");TaskConnection otherConnection=TaskConnection.parse(WireJson.bytes(otherSpec),NOW);
  rejects(()->AgentCardRequest.prepareConfirm(otherConnection,longRequest,task(longConnection),NOW,"选二"));
  // An unrecognised long dictation on a choice question still gets a confirm card: its start and length.
  {AgentCardRequest said=AgentCardRequest.prepareConfirm(longConnection,longRequest,task(longConnection),NOW,String.join("",Collections.nCopies(49,"字")));yes(said.copy(0).content.endsWith("…（共49字）")&&said.copy(0).content.length()<=48&&said.confirm.length()==49);}
  Map<String,Object> text=WireJson.map(WireJson.copy(TaskWire.body(textRequest)));text.put("question",String.join("",Collections.nCopies(36,"问")));yes(AgentCardRequest.route(text).equals("card"));
  text.put("question",String.join("",Collections.nCopies(37,"问")));yes(AgentCardRequest.route(text).equals("prompter"));
  // Every choice, even a short two-option one, goes to the prompter.
  yes(AgentCardRequest.route(TaskWire.body(request(c,2))).equals("prompter")&&AgentCardRequest.route(TaskWire.body(request(c,3))).equals("prompter")&&AgentCardRequest.route(TaskWire.body(request(c,4))).equals("prompter"));
  Map<String,Object> wide=request(c,2);WireJson.map(WireJson.list(TaskWire.body(wide).get("options")).get(1)).put("label",String.join("",Collections.nCopies(30,"长")));yes(AgentCardRequest.route(TaskWire.body(wide)).equals("prompter"));
  Map<String,Object> lines=WireJson.map(WireJson.copy(text));lines.put("question","短问题\n第二行");yes(AgentCardRequest.route(lines).equals("prompter"));
  yes("TASK_GLASS_PROMPTER".equals(code(()->AgentCardRequest.prepare(c,request(c,2),task(c),NOW)))&&"TASK_GLASS_PROMPTER".equals(code(()->AgentCardRequest.prepare(c,request(c,4),task(c),NOW)))&&"TASK_GLASS_PROMPTER".equals(code(()->AgentCardRequest.prepare(c,wide,task(c),NOW))));
  // The prompter shows the whole question and every option, numbered as the wearer will say them.
  String script=AgentCardRequest.manuscript(TaskWire.body(request(c,4)),TaskWire.body(task(c)));
  // The header shows the task's topic; the default registered-caller command falls back to the project.
  yes(AgentCardRequest.header(TaskWire.body(request(c,4)),WireJson.object("command","眼镜提问 CLI 改造\n第二行")).equals(c.agent+" 提问：眼镜提问 CLI 改造"));
  yes(AgentCardRequest.header(TaskWire.body(request(c,4)),WireJson.object("command","Continue the already-running registered Claude Code task.")).equals(c.agent+" 提问 · 项目 project")&&AgentCardRequest.header(TaskWire.body(request(c,4)),null).equals(c.agent+" 提问 · 项目 project"));
  yes(AgentCardRequest.header(TaskWire.body(request(c,4)),WireJson.object("command",String.join("",Collections.nCopies(50,"长")))).endsWith("…")&&!script.contains("会话"));
  yes(script.startsWith(AgentCardRequest.header(TaskWire.body(request(c,4)),TaskWire.body(task(c)))+"\n\n选哪个方案？\n")&&script.contains("\n1. 只预览\n2. 保留资料\n3. 先修改\n4. 稍后处理")&&script.endsWith("看完长按退出，然后在60秒内说“选几”，可以补充要求。"));
  yes(AgentCardRequest.manuscript(text,null).endsWith("然后在60秒内口述回答。")&&!AgentCardRequest.manuscript(text,null).contains("1. "));
  // Option numbers: one unambiguous number within range, otherwise none.
  yes(VoiceOption.index("选二",4)==1&&VoiceOption.index("我选择3，另外先备份",4)==2&&VoiceOption.index("第四项",4)==3&&VoiceOption.index("2",4)==1&&VoiceOption.index("二号吧",4)==1&&VoiceOption.index("选项一",4)==0&&VoiceOption.index("选两个中的第二个",4)==1);
  yes(VoiceOption.index("不选二，选三",4)==-1&&VoiceOption.index("第一步先备份",4)==-1&&VoiceOption.index("选一下吧",4)==-1&&VoiceOption.index("选五",4)==-1&&VoiceOption.index("选四",3)==-1&&VoiceOption.index("都不要",4)==-1&&VoiceOption.index(null,4)==-1);
  yes(!VoiceOption.extra("选二")&&!VoiceOption.extra("选二吧。")&&VoiceOption.extra("选三，另外先备份"));
  // A dictated choice confirms the recognised option; unrecognised words are shown as said.
  AgentCardRequest choice=frozen(c,4),picked=choice.confirming("选二");yes(picked.handoff&&!picked.voice&&picked.size()==1&&picked.copy(0).content.equals("选2：保留资料"));
  yes(choice.confirming("选3，但是先别动 README").copy(0).content.equals("选3：先修改；另有补充")&&choice.confirming("都不要").copy(0).content.equals("都不要"));
  rejects(()->picked.option(0));rejects(()->picked.answerText(0));rejects(()->picked.confirming("选一"));yes(AgentCardRequest.restore(picked.json()).copy(0).content.equals("选2：保留资料"));
  Map<String,Object> longLabel=request(c,4);WireJson.map(WireJson.list(TaskWire.body(longLabel).get("options")).get(1)).put("label",String.join("",Collections.nCopies(60,"长")));
  yes(AgentCardRequest.prepareConfirm(c,longLabel,task(c),NOW,"选二").copy(0).content.equals("选第2项")&&AgentCardRequest.prepareConfirm(c,longLabel,task(c),NOW,"选二，再加一条").copy(0).content.equals("选第2项；另有补充"));
  yes(AgentCardRequest.prepareConfirm(c,request(c,4),task(c),NOW,"选二").copy(0).content.equals("选2：保留资料"));
  // ＋ on a choice confirm card is a handoff back to the phone page, never a direct answer.
  Memory m=new Memory();AgentCardSession s=active(m,picked);s.receive(PEER,1,action(s.uid(),1),clock,NOW,true);yes(s.pendingAnswer()==null&&!s.hasSelection());ackAndRemove(s);cleanup(s,1);
  AgentCardRequest back=s.takeVoiceHandoff(clock);yes(back!=null&&"选二".equals(back.confirm)&&s.takeVoiceHandoff(clock)==null);
 }
 static void headRead(HeadGestureSession head,boolean enabled){HeadGestureSession.Emission e=head.next(PEER,1,clock);yes(e!=null&&OtaFrame.decode(e.bytes).type==4);head.result(e.ticket,true,clock);head.receive(PEER,1,OtaFrame.encode(4,OtaFrame.object("generalSettings",OtaFrame.object("headGestures",OtaFrame.object("enabled",enabled?1:0,"mode",0))),null),clock);clock++;}
 static void guardIntegration(String root,TaskConnection c,AgentCardRequest r)throws Exception{
  clock=1000;final Object[] persisted={null};HeadGestureSession head=new HeadGestureSession(new HeadGestureSession.Store(){public Object read(){return persisted[0];}public void save(Object value){persisted[0]=WireJson.copy(value);}});yes(head.acquire(r.owner,PEER,1,clock));headRead(head,true);HeadGestureSession.Emission w=head.next(PEER,1,clock);yes(w!=null&&OtaFrame.decode(w.bytes).type==5);head.result(w.ticket,true,clock);clock+=1500;headRead(head,false);yes(head.ready(r.owner,PEER,1,clock));
  Memory record=new Memory();AgentCardSession card=new AgentCardSession(record);yes(card.prepare(r,PEER,1)&&card.bindGuard(head.token(r.owner)));yes(head.markCardPossible(r.owner,PEER,1,clock));yes(card.show(PEER,1,clock,NOW,true));AgentCardSession.Emission e=emission(card);card.result(e.ticket,true,clock);card.receive(PEER,1,action(card.uid(),1),clock,NOW,true);
  try(TaskMailbox box=new TaskMailbox(new File(root,"guard-composition"),c)){cache(box,c);save(box,card.pendingAnswer());card.answerStored(r.operation(),true,"");ackAndRemove(card);yes(card.closure()==null);yes(card.cleanup(PEER,1));e=emission(card);card.result(e.ticket,true,clock);CardInputClosure closed=card.closure();yes(closed!=null&&head.releaseInputClosed(r.owner,PEER,1,clock,closed));headRead(head,false);w=head.next(PEER,1,clock);yes(w!=null);head.result(w.ticket,true,clock);clock+=1500;headRead(head,true);yes(!head.pending()&&card.cardMayExist()&&!card.pending());card.receive(PEER,1,action(card.uid(),1),clock,NOW,true);yes(card.pendingAnswer()==null&&box.pending().size()==1);}
 }
}
