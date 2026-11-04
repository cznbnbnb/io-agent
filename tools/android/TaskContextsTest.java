package com.turboio.addon;

import java.io.*;import java.nio.charset.StandardCharsets;import java.nio.file.*;import java.util.*;

/** Real durable stores and existing protocol fixtures, with three isolated registered transports. */
public final class TaskContextsTest {
 private static int checks;private static final long NOW=TaskConnection.stamp("2026-10-20T10:00:00Z");
 interface Run {void run()throws Exception;}
 static void check(boolean value){checks++;if(!value)throw new AssertionError("check "+checks);}
 static void rejects(Run run)throws Exception{checks++;try{run.run();}catch(IllegalArgumentException|IllegalStateException|IOException expected){return;}throw new AssertionError("Expected rejection "+checks);}
 static TaskConnection connection(String base,String session){Map<String,Object> v=TaskConnectionTest.sample();v.put("base_url",base);v.put("session_id",session);v.put("expires_at",TaskWire.now(NOW+86400000));return TaskConnection.parse(WireJson.bytes(v),NOW);}
 static class Peer implements TaskApi.Transport {
  final TaskConnection connection;final Map<String,Object> task,request;final List<String> posts=new ArrayList<>();final List<Object> extra=new ArrayList<>();int calls;boolean fail;
  Peer(TaskConnection c,Map<String,Map<String,Object>> fixture){connection=c;Map<String,Object> t=WireJson.map(WireJson.copy(fixture.get("task"))),r=WireJson.map(WireJson.copy(fixture.get("request")));t.put("route",c.route());r.put("route",c.route());task=item(t,"task",1);request=item(r,"request",2);}
  public void cancel(){}
  public TaskApi.Response exchange(String path,byte[] payload)throws IOException{
   calls++;if(fail)throw new IOException("TASK_UNAVAILABLE");Object body;
   if(path.equals("/identity"))body=WireJson.object("schema_version","1.0","owner_id",connection.owner,"producer_id",connection.producer,"server_id",connection.server,"expires_at",connection.expires,"scopes",new ArrayList<>(TaskConnection.SCOPES));
   else if(path.startsWith("/inbox")){List<Object> items=new ArrayList<>(Arrays.asList(task,request));items.addAll(extra);body=WireJson.object("items",items,"has_more",false,"next_cursor","cursor-same-across-realms","server_time",TaskWire.now(NOW),"fresh_until",TaskWire.now(NOW+3000));}
   else if(path.startsWith("/requests/"))body=request;
   else if(path.startsWith("/tasks/"))body=task;
   else if(payload!=null){String text=new String(payload,StandardCharsets.UTF_8);posts.add(text);TaskMailbox.Claim claim=new TaskMailbox.Claim(WireJson.object("operation_id","test","payload",text,"attempts",1,"needs_lookup",false),connection.binding());return new TaskApi.Response(201,WireJson.bytes(TaskMailboxTest.ack(claim)),0);}
   else throw new IOException("TASK_QUERY_INVALID");return new TaskApi.Response(200,WireJson.bytes(body),0);
  }
 }
 static Map<String,Object> item(Map<String,Object> body,String kind,long sequence){Map<String,Object> v=TaskMailboxTest.item(body,kind,sequence);v.put("stored_at",TaskWire.now(NOW));v.put("expires_at",TaskWire.now(NOW+3600000));return v;}
 public static void main(String[] args)throws Exception{
  TaskConnection a=connection("https://codex.example.test/v1/agent","codex-original"),b=connection("https://hermes.example.test/v1/agent","hermes-original"),c=connection("https://codex.example.test/v1/agent","dedicated-qa");
  byte[] legacy=WireJson.bytes(WireJson.object("connection",WireJson.read(a.encode()),"enabled",true));TaskProfiles p=TaskProfiles.decode(legacy);check(p.profiles.size()==1&&p.selected().enabled&&p.selected.equals(a.binding()));
  p=p.upsert(b,true,NOW).upsert(c,true,NOW);check(p.profiles.size()==3&&p.selected.equals(c.binding())&&p.get(a.binding()).enabled);byte[] persisted=p.encode();TaskProfiles loaded=TaskProfiles.decode(persisted);check(Arrays.equals(loaded.encode(),persisted));
  // Importing without the explicit default checkbox must not change where a
  // new task goes. Keep the v2 non-empty-selection invariant for old readers.
  rejects(()->TaskProfiles.empty().upsert(a,true,NOW,false));
  TaskProfiles first=TaskProfiles.empty().upsert(a,true,NOW,true);
  TaskProfiles imported=first.upsert(b,true,NOW,false);
  check(imported.selected.equals(a.binding())&&imported.profiles.size()==2);
  check(imported.get(a.binding()).enabled&&imported.get(b.binding()).enabled);
  check(Arrays.equals(imported.get(a.binding()).connection.encode(),a.encode()));
  check(TaskProfiles.decode(imported.encode()).selected.equals(a.binding()));
  TaskProfiles explicit=imported.upsert(b,true,NOW,true);
  check(explicit.selected.equals(b.binding())&&explicit.get(a.binding()).enabled);
  TaskProfiles importedPaused=imported.upsert(c,false,NOW,false);
  check(importedPaused.selected.equals(a.binding())&&!importedPaused.get(c.binding()).enabled&&importedPaused.get(b.binding()).enabled);
  TaskProfiles resumed=importedPaused.enabled(c.binding(),true,NOW);
  check(resumed.selected.equals(a.binding())&&resumed.get(a.binding()).enabled&&resumed.get(b.binding()).enabled&&resumed.get(c.binding()).enabled);
  check(TaskWire.same(resumed.get(c.binding()).connection.route(),c.route()));
  TaskProfiles selected=p.select(b.binding());check(selected.get(a.binding()).enabled&&selected.get(c.binding()).enabled);check(p.selected.equals(c.binding()));
  TaskProfiles paused=p.enabled(b.binding(),false,NOW);check(!paused.get(b.binding()).enabled&&paused.get(a.binding()).enabled&&paused.selected.equals(c.binding()));
  Map<String,Object> renewed=WireJson.map(WireJson.read(a.encode()));renewed.put("token",String.join("",Collections.nCopies(40,"z")));renewed.put("expires_at",TaskWire.now(NOW+172800000));TaskConnection fresh=TaskConnection.parse(WireJson.bytes(renewed),NOW);TaskProfiles rotated=p.upsert(fresh,true,NOW);check(fresh.binding().equals(a.binding())&&rotated.profiles.size()==3&&rotated.get(b.binding()).enabled);check(!Arrays.equals(fresh.encode(),a.encode()));
  TaskProfiles renewedWithoutDefault=p.upsert(fresh,true,NOW,false);
  check(renewedWithoutDefault.selected.equals(c.binding())&&renewedWithoutDefault.profiles.size()==3);
  check(Arrays.equals(renewedWithoutDefault.get(a.binding()).connection.encode(),fresh.encode()));
  check(Arrays.equals(renewedWithoutDefault.get(b.binding()).connection.encode(),b.encode())&&renewedWithoutDefault.get(b.binding()).enabled);
  final TaskProfiles registered=p;rejects(()->registered.get("not-registered"));
  Map<String,Object> broken=WireJson.map(WireJson.read(persisted));broken.put("selected","absent");final Map<String,Object> missing=broken;rejects(()->TaskProfiles.decode(WireJson.bytes(missing)));
  broken=WireJson.map(WireJson.read(persisted));List<Object> rows=WireJson.list(broken.get("profiles"));rows.add(WireJson.copy(rows.get(0)));final Map<String,Object> duplicate=broken;rejects(()->TaskProfiles.decode(WireJson.bytes(duplicate)));
  Map<String,Object> forged=WireJson.map(WireJson.read(persisted));WireJson.map(WireJson.list(forged.get("profiles")).get(0)).put("binding",b.binding());rejects(()->TaskProfiles.decode(WireJson.bytes(forged)));
  TaskProfiles capacity=TaskProfiles.empty();for(int i=0;i<TaskProfiles.MAX;i++)capacity=capacity.upsert(connection(a.base,"context-"+i),false,NOW);final TaskProfiles full=capacity;rejects(()->full.upsert(b,false,NOW));check(full.profiles.size()==TaskProfiles.MAX);
  // Explicitly removing a paused/expired registration frees a slot; live/default ones stay.
  String oldest=full.profiles.get(0).binding,newest=full.selected;check(full.remove(oldest,NOW).profiles.size()==TaskProfiles.MAX-1);rejects(()->full.enabled(oldest,true,NOW).remove(oldest,NOW));rejects(()->full.remove(newest,NOW+172800000));rejects(()->full.remove("missing",NOW+172800000));
  // Explicit local removal can free an offline selected target, including the final registration.
  TaskProfiles forgotten=imported.forget(a.binding());check(forgotten.profiles.size()==1&&forgotten.selected.equals(b.binding()));
  check(TaskProfiles.decode(forgotten.encode()).selected.equals(b.binding()));
  TaskProfiles none=forgotten.forget(b.binding());check(none.profiles.isEmpty()&&none.selected.isEmpty()&&none.selected()==null);
  check(TaskProfiles.decode(none.encode()).profiles.isEmpty());rejects(()->none.forget(b.binding()));
  TaskProfiles freed=full.remove(oldest,NOW+172800000);check(freed.profiles.size()==TaskProfiles.MAX-1&&freed.selected.equals(newest));rejects(()->freed.get(oldest));
  TaskProfiles refilled=freed.upsert(b,false,NOW);check(refilled.profiles.size()==TaskProfiles.MAX&&TaskProfiles.decode(refilled.encode()).profiles.size()==TaskProfiles.MAX);
  TaskProfiles expired=TaskProfiles.decode(legacy);check(expired.profiles.size()==1);rejects(()->expired.enabled(a.binding(),true,NOW+172800000));check(!expired.enabled(a.binding(),false,NOW+172800000).selected().enabled);
  Map<String,Object> fixture=WireJson.map(WireJson.read(Files.readAllBytes(Paths.get("docs/contracts/normal.json"))));Map<String,Map<String,Object>> bodies=new HashMap<>();for(Object raw:WireJson.list(fixture.get("events"))){Map<String,Object> e=WireJson.map(raw);bodies.put((String)e.get("kind"),TaskWire.body(e));}
  File dir=Files.createTempDirectory("io-agent-contexts-").toFile();Map<String,Peer> peers=new HashMap<>();TaskHub.Factory factory=conn->{Peer peer=new Peer(conn,bodies);peers.put(conn.binding(),peer);return peer;};String originalPayload;
  try(TaskHub hub=new TaskHub(dir,p,factory)){
   Map<String,Object> foreign=WireJson.map(WireJson.copy(peers.get(c.binding()).request));foreign.put("object_id","foreign-request");foreign.put("event_id","foreign-request-event");foreign.put("commit_seq",3);TaskWire.body(foreign).put("request_id","foreign-request");peers.get(a.binding()).extra.add(foreign);
   peers.get(b.binding()).fail=true;hub.pump(NOW);check(hub.view(a.binding()).objects.size()==2&&hub.view(c.binding()).objects.size()==2);check(hub.view(b.binding()).note.equals("TASK_UNAVAILABLE"));
   check(hub.view(a.binding()).item("request","foreign-request")==null);rejects(()->hub.answer(a.binding(),"foreign-context","foreign-request",1,null,"wrong source",NOW));
   String request=(String)peers.get(a.binding()).request.get("object_id");hub.apply(p.select(b.binding()));
   hub.answer(a.binding(),"same-operation",request,1,null,"完整条件\n仍回 Codex 原任务。",NOW);check(hub.view(a.binding()).pending.size()==1&&hub.view(b.binding()).pending.isEmpty());originalPayload=(String)WireJson.map(hub.view(a.binding()).pending.get(0)).get("payload");check(TaskWire.same(TaskWire.body(WireJson.map(WireJson.read(originalPayload.getBytes(StandardCharsets.UTF_8)))).get("route"),a.route()));
   rejects(()->hub.answer(b.binding(),"cannot-use-other-realm-cache",request,1,null,"wrong",NOW));check(hub.view(b.binding()).pending.isEmpty());
   peers.get(b.binding()).fail=false;hub.pump(NOW+6000);check(peers.get(a.binding()).posts.size()==1&&peers.get(b.binding()).posts.isEmpty());check(hub.view(b.binding()).objects.size()==2);
   hub.detail(b.binding(),"request",request,NOW+6001);hub.answer(b.binding(),"same-operation",request,1,null,"Hermes 自己的完整答案",NOW+6001);hub.pump(NOW+12000);check(peers.get(b.binding()).posts.size()==1&&peers.get(a.binding()).posts.size()==1);check(!peers.get(b.binding()).posts.get(0).contains("仍回 Codex"));
   hub.apply(p.enabled(a.binding(),false,NOW));int prior=peers.get(a.binding()).calls;hub.pump(NOW+18000);check(peers.get(a.binding()).calls==prior&&hub.view(a.binding()).note.equals("paused"));rejects(()->hub.answer(a.binding(),"paused-answer",request,1,null,"paused",NOW));check(hub.view(a.binding()).pending.size()==1);
   check(hub.view(a.binding()).item("request",request)!=hub.view(b.binding()).item("request",request));
  }
  try(TaskHub hub=new TaskHub(dir,rotated,factory)){
   check(hub.views().size()==3);check(originalPayload.equals(WireJson.map(hub.view(a.binding()).pending.get(0)).get("payload")));check(hub.view(b.binding()).pending.size()==1);check(hub.view(a.binding()).binding.equals(a.binding()));check(peers.get(a.binding()).connection.token().equals(fresh.token()));
  }
  // Removing and re-registering only affects the registry; durable drafts and history survive.
  TaskProfiles removed=rotated.enabled(b.binding(),false,NOW).remove(b.binding(),NOW);
  Path retained=dir.toPath().resolve("task-mailbox").resolve(b.binding()).resolve("state.json");byte[] retainedBytes=Files.readAllBytes(retained);
  try(TaskHub hub=new TaskHub(dir,removed,factory)){check(hub.views().size()==2&&Files.exists(retained));}
  check(Arrays.equals(retainedBytes,Files.readAllBytes(retained)));
  try(TaskHub hub=new TaskHub(dir,removed.upsert(b,true,NOW,false),factory)){check(hub.view(b.binding()).objects.size()==2&&hub.view(b.binding()).pending.size()==1);}
  Path corrupt=dir.toPath().resolve("task-mailbox").resolve(a.binding()).resolve("state.json");byte[] corruptBytes="{\"schema\":999}".getBytes(StandardCharsets.UTF_8);Files.write(corrupt,corruptBytes);
  try(TaskHub hub=new TaskHub(dir,rotated,factory)){hub.pump(NOW);check(hub.view(a.binding()).objects.isEmpty()&&!hub.view(a.binding()).note.equals("received"));check(hub.view(b.binding()).objects.size()==2&&hub.view(c.binding()).objects.size()==2);check(Arrays.equals(corruptBytes,Files.readAllBytes(corrupt)));}
  System.out.println("Task contexts: "+checks+" checks passed (migration, identity/route isolation, independent failure/pause, original full answers, stable queues after renewal/restart)");
 }
}
