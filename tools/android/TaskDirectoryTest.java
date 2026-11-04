package com.turboio.addon;

import java.io.*;import java.nio.charset.StandardCharsets;import java.nio.file.*;import java.util.*;

/** JVM tests of authenticated directory leases and the actual mailbox/HTTP dispatch boundary. */
public final class TaskDirectoryTest {
 static final long NOW=TaskControlTest.NOW;static int checks;
 interface Run{void run()throws Exception;}
 static void yes(boolean value){checks++;if(!value)throw new AssertionError("directory check "+checks);}
 static void no(Run action)throws Exception{checks++;try{action.run();}catch(IllegalArgumentException|IllegalStateException|IOException expected){return;}throw new AssertionError("expected directory rejection "+checks);}
 static Map<String,Object> copy(Map<String,Object> value){return WireJson.map(WireJson.copy(value));}
 static String uuid(int n){return TaskControlTest.uuid(n);}
 static TaskConnection connection(int n){Map<String,Object> value=TaskConnectionTest.sample();value.put("session_id",uuid(n));value.put("expires_at",TaskWire.now(NOW+86400000));return TaskConnection.parse(WireJson.bytes(value),NOW);}
 static Map<String,Object> entry(TaskConnection c){return WireJson.object("route",c.route(),"producer_id","agent-1234abcd","device_id",uuid(800),"host_kind","codex","workspace","/project/real-session","label","当前任务","generation",1,"instance_id",uuid(801),"lease_id",uuid(802),"lease_expires_at",TaskWire.now(NOW+60000),"online",true,"busy",false,"capabilities",WireJson.object("can_execute",true,"exact_turn_interrupt",true,"descendants_proof",false,"atomic_queue_append",true,"native_queue_expiry",false),"reason",null);}
 static Map<String,Object> directory(TaskConnection c){return WireJson.object("schema_version","1.0","server_id",c.server,"owner_id",c.owner,"server_time",TaskWire.now(NOW),"sessions",new ArrayList<>(Arrays.asList(entry(c))),"default",WireJson.object("revision",1,"route",c.route(),"updated_at",TaskWire.now(NOW)));}
 static Map<String,Object> first(Map<String,Object> directory){return WireJson.map(WireJson.list(directory.get("sessions")).get(0));}
 static TaskSessionDirectory fresh(Map<String,Object> value,TaskConnection c){return TaskSessionDirectory.fresh(WireJson.bytes(value),c.server,c.owner,1000,1200);}
 static void parsing()throws Exception{
  TaskConnection c=connection(1);Map<String,Object> wire=directory(c);TaskSessionDirectory d=fresh(wire,c);
  yes(d.defaultRevision()==1&&TaskWire.same(d.defaultRoute(),c.route()));yes(d.gate(c.route(),60999).isEmpty());yes(d.gate(c.route(),61000).equals("DIRECTORY_TARGET_OFFLINE"));
  Map<String,Object> generic=copy(wire);first(generic).put("host_kind","acp");yes(fresh(generic,c).sessions.get(0).host.equals("acp"));
  TaskSessionDirectory restart=TaskSessionDirectory.cached(d.encode(),c.server,c.owner);yes(TaskWire.same(restart.defaultRoute(),c.route()));yes(!restart.sessions.get(0).live(1200));yes(restart.gate(c.route(),1200).equals("DIRECTORY_REFRESH_REQUIRED"));
  // RTT consumes the whole lease. No local wall-clock timestamp participates in these checks.
  yes(!TaskSessionDirectory.fresh(d.encode(),c.server,c.owner,0,60000).sessions.get(0).live(60000));
  Map<String,Object> expired=copy(wire);first(expired).put("lease_expires_at",TaskWire.now(NOW-1));yes(fresh(expired,c).gate(c.route(),1200).equals("DIRECTORY_TARGET_OFFLINE"));
  no(()->TaskSessionDirectory.fresh(d.encode(),c.server,c.owner,500,499));no(()->TaskSessionDirectory.fresh(d.encode(),c.server,"another-owner",0,1));
  Map<String,Object> unknown=copy(wire);first(unknown).put("busy",null);yes(fresh(unknown,c).gate(c.route(),1200).isEmpty());yes(fresh(unknown,c).sessions.get(0).status(1200).startsWith("状态未知"));WireJson.map(first(unknown).get("capabilities")).put("atomic_queue_append",false);no(()->fresh(unknown,c));
  Map<String,Object> busy=copy(wire);first(busy).put("busy",true);WireJson.map(first(busy).get("capabilities")).put("atomic_queue_append",false);yes(fresh(busy,c).gate(c.route(),1200).equals("DIRECTORY_TARGET_BUSY"));
  Map<String,Object> unsupported=copy(wire);WireJson.map(first(unsupported).get("capabilities")).put("can_execute",false);first(unsupported).put("reason","native_unavailable");yes(fresh(unsupported,c).gate(c.route(),1200).equals("DIRECTORY_TARGET_UNSUPPORTED"));yes(fresh(unsupported,c).sessions.get(0).status(1200).startsWith("连接未就绪"));
  Map<String,Object> offline=copy(wire);first(offline).put("online",false);first(offline).put("busy",null);first(offline).put("reason","lease_expired");Map<String,Object> caps=WireJson.map(first(offline).get("capabilities"));for(String key:caps.keySet())caps.put(key,false);TaskSessionDirectory od=fresh(offline,c);yes(od.defaultRoute()!=null);yes(od.gate(c.route(),1200).equals("DIRECTORY_TARGET_OFFLINE"));yes(od.sessions.get(0).status(1200).startsWith("离线"));
  Map<String,Object> forgedOffline=copy(offline);WireJson.map(first(forgedOffline).get("capabilities")).put("can_execute",true);no(()->fresh(forgedOffline,c));
  Map<String,Object> tooLong=copy(wire);first(tooLong).put("lease_expires_at",TaskWire.now(NOW+60001));no(()->fresh(tooLong,c));
  for(String field:Arrays.asList("device_id","instance_id","lease_id")){Map<String,Object> invalid=copy(wire);first(invalid).put(field,"AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA");no(()->fresh(invalid,c));}
  Map<String,Object> badRoute=copy(wire);WireJson.map(first(badRoute).get("route")).put("session_id","latest");no(()->fresh(badRoute,c));
  Map<String,Object> badName=copy(wire);first(badName).put("label",String.join("",Collections.nCopies(33,"😀")));no(()->fresh(badName,c));
  yes(!d.sessions.get(0).live(1199));
  long[] elapsed={1200};TaskSessionDirectory.elapsedClock(()->elapsed[0]);yes(d.gate(c.route(),TaskSessionDirectory.elapsed()).isEmpty());elapsed[0]+=8*3600000;yes(d.gate(c.route(),TaskSessionDirectory.elapsed()).equals("DIRECTORY_TARGET_OFFLINE"));TaskSessionDirectory.elapsedClock(()->System.nanoTime()/1000000L);
  for(String absolute:Arrays.asList("/","/path/to/project","C:\\","C:\\path\\project","\\\\host\\share\\","\\\\host\\share\\project"))yes(TaskSessionDirectory.workspace(absolute).equals(absolute));
  for(String malformed:Arrays.asList("/path/../other","/path//other","/path/","C:/project","C:\\path\\..\\other","C:\\path\\","\\\\host\\share","\\\\host\\share\\.\\project"))no(()->TaskSessionDirectory.workspace(malformed));
  Map<String,Object> rel=copy(wire);first(rel).put("workspace","../project");no(()->fresh(rel,c));
  Map<String,Object> extra=copy(wire);first(extra).put("surprise",true);no(()->fresh(extra,c));
  Map<String,Object> duplicate=copy(wire);WireJson.list(duplicate.get("sessions")).add(entry(c));no(()->fresh(duplicate,c));
  Map<String,Object> many=copy(wire);List<Object> rows=WireJson.list(many.get("sessions"));rows.clear();for(int n=1;n<=128;n++)rows.add(entry(connection(n)));yes(fresh(many,c).sessions.size()==128);rows.add(entry(connection(129)));no(()->fresh(many,c));
  Map<String,Object> zero=copy(wire);zero.put("default",WireJson.object("revision",0,"route",null,"updated_at",null));yes(fresh(zero,c).defaultRoute()==null);WireJson.map(zero.get("default")).put("route",c.route());no(()->fresh(zero,c));
  Map<String,Object> cleared=copy(wire);cleared.put("default",WireJson.object("revision",2,"route",null,"updated_at",TaskWire.now(NOW+1000)));TaskSessionDirectory newer=fresh(cleared,c);yes(newer.defaultRevision()==2&&newer.defaultRoute()==null);newer.checkDefaultAgainst(d);no(()->d.checkDefaultAgainst(newer));
  Map<String,Object> conflict=copy(wire);WireJson.map(conflict.get("default")).put("route",connection(2).route());no(()->fresh(conflict,c).checkDefaultAgainst(d));
  Map<String,Object> ack=copy(wire);ack.remove("sessions");Map<String,Object> historical=TaskSessionDirectory.defaultReply(WireJson.bytes(ack),c.server,c.owner);yes(TaskWire.nonnegative(historical.get("revision"))==1&&newer.defaultRevision()==2); // parsing an old ACK never changes a new GET
  Map<String,Object> pending=WireJson.object("request_id",uuid(900),"expected_revision",0,"route",c.route());byte[] frozen=WireJson.bytes(pending);
  yes(TaskWire.same(TaskSessionDirectory.defaultAck(WireJson.bytes(ack),c.server,c.owner,pending).get("route"),c.route()));
  Map<String,Object> wrongAck=copy(ack);WireJson.map(wrongAck.get("default")).put("route",connection(2).route());no(()->TaskSessionDirectory.defaultAck(WireJson.bytes(wrongAck),c.server,c.owner,pending));
  Map<String,Object> wrongRevision=copy(ack);WireJson.map(wrongRevision.get("default")).put("revision",2);no(()->TaskSessionDirectory.defaultAck(WireJson.bytes(wrongRevision),c.server,c.owner,pending));
  Map<String,Object> clearRequest=WireJson.object("request_id",uuid(901),"expected_revision",1,"route",null),clearAck=copy(ack);clearAck.put("default",cleared.get("default"));yes(TaskSessionDirectory.defaultAck(WireJson.bytes(clearAck),c.server,c.owner,clearRequest).get("route")==null);
  // First PUT committed but its ACK was lost. Neither revoked auth nor a malformed ACK
  // releases the persisted request; an eventual retry must keep the original CAS bytes.
  for(String unknownError:Arrays.asList("FORBIDDEN","DEVICE_REQUIRED","AUTH_REQUIRED","UNAUTHENTICATED","PAIRING_REVOKED","TASK_UNAVAILABLE","DIRECTORY_DEFAULT_ACK_MISMATCH")){yes(!TaskSessionDirectory.defaultFailureResolved(unknownError));yes(Arrays.equals(frozen,WireJson.bytes(pending)));}
  for(String definitive:Arrays.asList("DEFAULT_REVISION_CONFLICT","DEFAULT_SESSION_UNAVAILABLE","AGENT_SESSION_NOT_FOUND","INVALID_AGENT_DEFAULT","IDEMPOTENCY_CONFLICT"))yes(TaskSessionDirectory.defaultFailureResolved(definitive));
  String max=String.join("",Collections.nCopies(10922,"汉"))+"ab";TaskSessionDirectory.command(max);yes(max.getBytes(StandardCharsets.UTF_8).length==32768);no(()->TaskSessionDirectory.command(max+"x"));no(()->TaskSessionDirectory.command(" \n "));
 }
 static final class Peer implements TaskApi.Transport{
  final TaskConnection c;Map<String,Object> data,task,request;boolean cap=true,failDirectory,loseAck;int taskPosts,answerPosts,lookups,directoryReads;Map<String,Object> saved;
  Peer(TaskConnection c)throws Exception{this.c=c;data=directory(c);task=TaskControlTest.task(c,"running","running",2);Map<String,Object> fixture=WireJson.map(WireJson.read(Files.readAllBytes(Paths.get("docs/contracts/normal.json"))));for(Object raw:WireJson.list(fixture.get("events"))){Map<String,Object> e=WireJson.map(raw);if("request".equals(e.get("kind"))){Map<String,Object> b=copy(TaskWire.body(e));b.put("route",c.route());b.put("task_id","original-task");request=TaskMailboxTest.item(b,"request",3);request.put("expires_at",TaskWire.now(NOW+3600000));request.put("stored_at",TaskWire.now(NOW));}}}
  TaskApi.Response ok(Object value){return new TaskApi.Response(200,WireJson.bytes(value),0);}
  Map<String,Object> ack(Map<String,Object> event){return TaskMailboxTest.ack(new TaskMailbox.Claim(WireJson.object("operation_id","synthetic-op","payload",new String(WireJson.bytes(event),StandardCharsets.UTF_8),"attempts",1,"needs_lookup",false),c.binding()));}
  public TaskApi.Response exchange(String path,byte[] bytes)throws IOException{
   if(path.equals("/identity"))return ok(WireJson.object("schema_version","1.0","owner_id",c.owner,"producer_id",c.producer,"server_id",c.server,"expires_at",c.expires,"scopes",new ArrayList<>(TaskConnection.SCOPES),"capabilities",cap?Arrays.asList(TaskSessionDirectory.CAPABILITY,"task_session_control_v1"):Arrays.asList("task_session_control_v1")));
   if(path.equals("/agent-sessions")){directoryReads++;if(failDirectory)throw new java.net.ConnectException("unreachable");return ok(data);}
   if(path.startsWith("/requests/"))return ok(request);
   if(path.startsWith("/tasks/"))return ok(task);
   if(path.startsWith("/events/")){lookups++;return saved==null?new TaskApi.Response(404,TaskControlTest.error("EVENT_NOT_FOUND"),0):ok(ack(saved));}
   if(path.equals("/tasks")||path.equals("/answers")){if(path.equals("/tasks"))taskPosts++;else answerPosts++;saved=WireJson.map(WireJson.read(bytes));if(loseAck)throw new java.net.SocketTimeoutException("lost");return new TaskApi.Response(201,WireJson.bytes(ack(saved)),0);}
   if(path.startsWith("/inbox")){List<Object> items=new ArrayList<>(Arrays.asList(task,request));items.sort(Comparator.comparingLong(v->TaskWire.positive(WireJson.map(v).get("commit_seq"))));return ok(WireJson.object("items",items,"has_more",false,"next_cursor","current-cursor","server_time",TaskWire.now(NOW),"fresh_until",TaskWire.now(NOW+3000)));}
   throw new AssertionError("unexpected directory transport "+path);
  }
  public void cancel(){}
 }
 static Map<String,Object> row(TaskMailbox box,int n){return WireJson.map(box.pending().get(n));}
 static void gate(File base)throws Exception{
  TaskConnection c=connection(1);
  for(int mode=0;mode<3;mode++){
   Peer peer=new Peer(c);TaskApi api=new TaskApi(c,peer);if(mode==0)peer.cap=false;if(mode==1)peer.failDirectory=true;if(mode==2)first(peer.data).put("lease_expires_at",TaskWire.now(NOW-1));File path=new File(base,"blocked-"+mode);String payload;
   try(TaskMailbox box=new TaskMailbox(path,c)){
    box.acceptDetail(peer.task,NOW);box.acceptDetail(peer.request,NOW);payload=(String)box.delegate("delegate", "原会话完整委托",NOW,NOW+600000).get("payload");box.draftAnswer("answer",(String)peer.request.get("object_id"),1,null,"旧问题仍正常回答",NOW);
    api.pump(box,NOW);yes(peer.taskPosts==0&&peer.answerPosts==1);yes(row(box,0).get("state").equals("awaiting_target"));yes(TaskWire.nonnegative(row(box,0).get("attempts"))==0);yes(!Boolean.TRUE.equals(row(box,0).get("needs_lookup")));yes(row(box,1).get("state").equals("server_stored"));
   }
   try(TaskMailbox box=new TaskMailbox(path,c)){yes(row(box,0).get("payload").equals(payload));yes(row(box,0).get("state").equals("awaiting_target"));peer.cap=true;peer.failDirectory=false;peer.data=directory(c);api.pump(box,NOW+6000);yes(peer.taskPosts==1&&TaskWire.same(TaskWire.body(peer.saved).get("route"),c.route()));yes(row(box,0).get("payload").equals(payload)&&row(box,0).get("state").equals("server_stored"));}
  }
  // Ambiguous sends reconcile even if capability is subsequently removed and the event expired.
  Peer lost=new Peer(c);lost.loseAck=true;File path=new File(base,"lost");String frozen;
  try(TaskMailbox box=new TaskMailbox(path,c)){frozen=(String)box.delegate("once","不能重复执行",NOW,NOW+5000).get("payload");TaskApi api=new TaskApi(c,lost);no(()->api.pump(box,NOW));yes(lost.taskPosts==1&&Boolean.TRUE.equals(row(box,0).get("needs_lookup")));}
  lost.cap=false;lost.failDirectory=true;
  try(TaskMailbox box=new TaskMailbox(path,c)){new TaskApi(c,lost).pump(box,NOW+30000);yes(lost.taskPosts==1&&lost.lookups==1);yes(row(box,0).get("state").equals("server_stored")&&row(box,0).get("payload").equals(frozen));}
  // After an authoritative absence response, retry POST needs the target gate again.
  Peer absent=new Peer(c);absent.cap=false;
  try(TaskMailbox box=new TaskMailbox(new File(base,"absent"),c)){box.delegate("absent","精确重试",NOW,NOW+600000);TaskMailbox.Claim claim=box.claim(NOW);box.finish(claim,0,new byte[0],NOW,0);TaskApi api=new TaskApi(c,absent);api.pump(box,NOW+6000);yes(absent.lookups==1&&row(box,0).get("state").equals("queued"));api.pump(box,NOW+12000);yes(absent.taskPosts==0&&row(box,0).get("state").equals("awaiting_target"));}
  // A lease disappearing before actual POST has no unknown send to reconcile.
  try(TaskMailbox box=new TaskMailbox(new File(base,"late"),c)){box.delegate("late","稍后投递",NOW,NOW+6000);TaskMailbox.Claim claim=box.claim(NOW);box.deferTarget(claim,"DIRECTORY_TARGET_OFFLINE",NOW);yes(!Boolean.TRUE.equals(row(box,0).get("needs_lookup")));yes(box.claim(NOW+7000,event->"DIRECTORY_TARGET_OFFLINE")==null);yes(row(box,0).get("state").equals("expired"));}
  // Stop requests remain independent of the new-execution directory; resume does not.
  for(boolean resume:new boolean[]{false,true}){Peer peer=new Peer(c);peer.cap=false;if(resume)peer.task=TaskControlTest.task(c,"stopped","stopped",4);
   try(TaskMailbox box=new TaskMailbox(new File(base,resume?"resume":"stop"),c)){box.acceptDetail(peer.task,NOW);box.control(uuid(resume?91:90),"original-task",TaskWire.execution(TaskWire.body(peer.task).get("execution")),resume?"resume":"stop",resume?"继续完整条件":"",NOW,NOW+60000);new TaskApi(c,peer).pump(box,NOW);yes(peer.taskPosts==(resume?0:1));yes(row(box,0).get("state").equals(resume?"awaiting_target":"server_stored"));}
  }
 }
 static void hub(File path)throws Exception{
  TaskConnection c=connection(1);Peer peer=new Peer(c);TaskProfiles profiles=TaskProfiles.empty().upsert(c,true,NOW,true);
  try(TaskHub hub=new TaskHub(path,profiles,ignored->peer)){
   peer.cap=false;no(()->hub.delegate(c.binding(),"blocked","不可用不排入",NOW));yes(hub.view(c.binding()).pending.isEmpty());
   peer.cap=true;hub.delegate(c.binding(),"same","完整指令",NOW);yes(peer.directoryReads==1);String payload=(String)WireJson.map(hub.view(c.binding()).pending.get(0)).get("payload");peer.cap=false;peer.failDirectory=true;hub.delegate(c.binding(),"same","完整指令",NOW+1);yes(hub.view(c.binding()).pending.size()==1&&payload.equals(WireJson.map(hub.view(c.binding()).pending.get(0)).get("payload")));no(()->hub.delegate(c.binding(),"same","变更内容",NOW+2));
  }
 }
 public static void main(String[] args)throws Exception{parsing();gate(new File(args[0],"gates"));hub(new File(args[0],"hub"));System.out.println("Session directory: "+checks+" checks passed (bounded authenticated metadata, conservative/restart leases, shared default revisions, exact route gates, answer coexistence, unknown receipt reconciliation)");}
}
