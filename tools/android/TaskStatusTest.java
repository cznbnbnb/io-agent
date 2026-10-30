package com.turboio.addon;

import java.io.*;
import java.nio.file.*;
import java.util.*;

/** A cursor-only inbox stays empty when an answer changes an existing request's head state. */
public final class TaskStatusTest {
 private static final long NOW=TaskConnection.stamp("2026-10-20T10:00:00Z");
 private static int checks;
 private static void yes(boolean value){checks++;if(!value)throw new AssertionError("status check "+checks);}
 private static Map<String,Object> copy(Map<String,Object> value){return WireJson.map(WireJson.copy(value));}
 private static final class Peer implements TaskApi.Transport {
  final TaskConnection connection;final Map<String,Object> task,request;
  int identityCalls,inboxCalls,requestReads;boolean first=true,failStatus,foreignStatus;List<Object> extra=Collections.emptyList();
  Peer(TaskConnection c)throws Exception{
   connection=c;Map<String,Object> fixture=WireJson.map(WireJson.read(Files.readAllBytes(Paths.get("docs/contracts/normal.json"))));
   Map<String,Object> t=null,r=null;for(Object raw:WireJson.list(fixture.get("events"))){Map<String,Object> e=WireJson.map(raw);if("task".equals(e.get("kind")))t=copy(TaskWire.body(e));if("request".equals(e.get("kind")))r=copy(TaskWire.body(e));}
   t.put("route",c.route());r.put("route",c.route());task=TaskContextsTest.item(t,"task",1);request=TaskContextsTest.item(r,"request",2);
  }
  TaskApi.Response ok(Object body){return new TaskApi.Response(200,WireJson.bytes(body),0);}
  public TaskApi.Response exchange(String path,byte[] body)throws IOException{
   if(body!=null)throw new AssertionError("Status reads must never write answers or tasks");
   if(path.equals("/identity")){identityCalls++;return ok(WireJson.object("schema_version","1.0","owner_id",connection.owner,"producer_id",connection.producer,"server_id",connection.server,"expires_at",connection.expires,"scopes",new ArrayList<>(TaskConnection.SCOPES)));}
   if(path.startsWith("/inbox?")){inboxCalls++;List<Object> items=first?Arrays.asList(task,request):extra;first=false;extra=Collections.emptyList();return ok(WireJson.object("items",items,"has_more",false,"next_cursor","cursor-"+inboxCalls,"server_time",TaskWire.now(NOW),"fresh_until",TaskWire.now(NOW)));}
   if(path.startsWith("/requests/")){requestReads++;if(failStatus)throw new IOException("STATUS_UNAVAILABLE");Map<String,Object> result=copy(request);if(foreignStatus){Map<String,Object> route=copy(TaskWire.body(result));Map<String,Object> other=copy(connection.route());other.put("session_id","foreign");route.put("route",other);result.put("body",route);}return ok(result);}
   throw new AssertionError("Unexpected path "+path);
  }
  public void cancel(){}
 }
 private static String state(TaskMailbox box,String id){return (String)WireJson.map(box.cached("request",id).get("item")).get("state");}
 public static void main(String[] args)throws Exception{
  TaskConnection c=TaskContextsTest.connection("https://status.example.test/v1/agent","codex-status");
  File dir=Files.createTempDirectory("io-status-").toFile();Peer peer=new Peer(c);TaskApi api=new TaskApi(c,peer);String id=(String)peer.request.get("object_id");
  try(TaskMailbox box=new TaskMailbox(dir,c)){
   yes(api.pump(box,NOW));yes(peer.requestReads==1);yes(state(box,id).equals("pending"));
   // No new inbox event/revision is created by the other device's accepted answer.
   peer.request.put("state","answered");yes(api.pump(box,NOW+3000));yes(peer.requestReads==1);yes(state(box,id).equals("pending"));
   yes(api.pump(box,NOW+15000));yes(peer.requestReads==2);yes(state(box,id).equals("answered"));
   yes(box.staleRequest(NOW+30000)==null);yes(api.pump(box,NOW+30000));yes(peer.requestReads==2);
   // A replayed old inbox item cannot reopen the answered request or erase its observation time.
   Map<String,Object> stale=copy(peer.request);stale.put("state","pending");peer.extra=Arrays.asList(stale);
   yes(api.pump(box,NOW+33000));yes(state(box,id).equals("answered"));yes(TaskWire.nonnegative(box.cached("request",id).get("detail_at"))==NOW+15000);
  }
  try(TaskMailbox restored=new TaskMailbox(dir,c)){yes(state(restored,id).equals("answered"));yes(restored.staleRequest(NOW+60000)==null);}
  // Idle notification cycles do not hit identity/inbox; explicit operations still preflight,
  // and a wake bypasses the last successful three-second polling cooldown.
  Peer idle=new Peer(c);TaskApi cached=new TaskApi(c,idle);
  try(TaskMailbox box=new TaskMailbox(Files.createTempDirectory("io-status-idle-").toFile(),c)){
   yes(cached.pump(box,NOW));int reads=idle.identityCalls;
   for(int n=1;n<=10;n++)cached.pump(box,NOW+n*3000,false);
   yes(idle.inboxCalls==1);yes(idle.identityCalls==reads);
   cached.preflight(NOW+31000);yes(idle.identityCalls==reads+1);
   cached.pump(box,NOW+32000,true);int before=idle.inboxCalls;
   cached.inboxChanged();cached.pump(box,NOW+32500,true);yes(idle.inboxCalls==before+1);
   cached.pump(box,NOW+100000,false);yes(idle.identityCalls==reads+2);
  }
  // A status request failure does not discard a received message, reset the cursor or retry every tick.
  Peer unavailable=new Peer(c);unavailable.failStatus=true;TaskApi retry=new TaskApi(c,unavailable);
  try(TaskMailbox box=new TaskMailbox(Files.createTempDirectory("io-status-retry-").toFile(),c)){
   yes(retry.pump(box,NOW));yes(box.cursor().equals("cursor-1"));yes(state(box,id).equals("pending"));yes(retry.note.equals("STATUS_UNAVAILABLE"));
   yes(retry.pump(box,NOW+3000));yes(unavailable.requestReads==1);yes(box.cursor().equals("cursor-2"));
   unavailable.failStatus=false;unavailable.request.put("state","withdrawn");yes(retry.pump(box,NOW+15000));yes(state(box,id).equals("withdrawn"));
  }
  Peer foreign=new Peer(c);foreign.foreignStatus=true;TaskApi guarded=new TaskApi(c,foreign);
  try(TaskMailbox box=new TaskMailbox(Files.createTempDirectory("io-status-route-").toFile(),c)){
   yes(guarded.pump(box,NOW));yes(guarded.note.equals("TASK_ROUTE_MISMATCH"));yes(TaskWire.same(TaskWire.body(WireJson.map(box.cached("request",id).get("item"))).get("route"),c.route()));
  }
  // Oldest first, one request per pump; another route is never queried. Once a pending request
  // has been read after its deadline, its local expired presentation does not need endless polling.
  try(TaskMailbox box=new TaskMailbox(Files.createTempDirectory("io-status-bounded-").toFile(),c)){
   Map<String,Object> first=copy(peer.request);first.put("state","pending");first.put("expires_at",TaskWire.now(NOW+1000));
   box.acceptDetail(first,NOW);yes(box.staleRequest(NOW+999)==null);yes(box.staleRequest(NOW+15000).equals(id));
   box.acceptDetail(first,NOW+15000);yes(box.staleRequest(NOW+30000)==null);
   Map<String,Object> other=copy(first);other.put("object_id","second");TaskWire.body(other).put("request_id","second");other.put("event_id","second-event");other.put("commit_seq",3);other.put("expires_at",TaskWire.now(NOW+3600000));
   box.acceptDetail(other,NOW);yes(box.staleRequest(NOW+30000).equals("second"));
   Map<String,Object> foreignItem=copy(other);foreignItem.put("object_id","foreign");TaskWire.body(foreignItem).put("request_id","foreign");Map<String,Object> route=copy(c.route());route.put("session_id","other");TaskWire.body(foreignItem).put("route",route);foreignItem.put("event_id","foreign-event");foreignItem.put("commit_seq",4);
   box.acceptDetail(foreignItem,0);yes(box.staleRequest(NOW+30000).equals("second"));
   box.acceptDetail(other,NOW+30000);yes(box.staleRequest(NOW+30000)==null);
  }
  System.out.println("Task status: "+checks+" checks passed (empty incremental inbox, accepted answer, restart, bounded refresh, route isolation, failed read, deadline)");
 }
}
