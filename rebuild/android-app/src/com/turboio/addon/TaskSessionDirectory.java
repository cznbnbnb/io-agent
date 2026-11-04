package com.turboio.addon;

import java.nio.charset.StandardCharsets;
import java.util.*;

/** Authenticated native session metadata, separate from question/mailbox connections.
 * A disk cache never restores live leases. Only a fresh GET starts a monotonic window. */
final class TaskSessionDirectory {
 static final String CAPABILITY="agent_session_directory_v1";
 static final int MAX_INPUT_BYTES=32768;
 private static volatile java.util.function.LongSupplier elapsedClock=()->System.nanoTime()/1000000L;
 // Runtime installs Android elapsedRealtime before loading any directory. Unlike nanoTime,
 // that clock includes deep sleep. Pure JVM tests retain their monotonic platform clock.
 static void elapsedClock(java.util.function.LongSupplier clock){elapsedClock=Objects.requireNonNull(clock);}
 static long elapsed(){return elapsedClock.getAsLong();}
 final String server,owner;final long serverTime;final List<Entry> sessions;
 final Map<String,Object> defaultTarget;final boolean observed;
 private final Map<String,Object> wire;
 static final class Entry {
  final Map<String,Object> route,capabilities;final String key,producer,device,host,workspace,label,instance,lease,reason;
  final long generation,liveFrom,liveUntil;final boolean online;final Boolean busy;
  Entry(Map<String,Object> value,long serverTime,long start,long end,boolean observed){
   BoundedJson.keys(value,"route","producer_id","device_id","host_kind","workspace","label","generation","instance_id","lease_id","lease_expires_at","online","busy","capabilities","reason");
   route=route(value.get("route"));key=routeKey(route);producer=TaskWire.text(value.get("producer_id"),128,false);TaskWire.require(producer.matches("[A-Za-z0-9_.:-]{1,128}"),"DIRECTORY_INVALID");
   device=uuid(value.get("device_id"));host=TaskWire.text(value.get("host_kind"),6,false);TaskWire.require(TaskWire.set("claude","codex","acp").contains(host),"DIRECTORY_INVALID");
   workspace=workspace(value.get("workspace"));
   label=TaskConnection.text(value.get("label"),256);TaskWire.require(label.equals(label.trim())&&label.length()<=64,"DIRECTORY_INVALID");
   generation=TaskWire.positive(value.get("generation"));instance=uuid(value.get("instance_id"));lease=uuid(value.get("lease_id"));
   long expiry=TaskWire.stamp(value.get("lease_expires_at"));TaskWire.require(expiry-serverTime<=60000,"DIRECTORY_INVALID");
   TaskWire.require(value.get("online") instanceof Boolean,"DIRECTORY_INVALID");online=Boolean.TRUE.equals(value.get("online"));
   TaskWire.require(value.get("busy")==null||value.get("busy") instanceof Boolean,"DIRECTORY_INVALID");busy=(Boolean)value.get("busy");
   Map<String,Object> caps=WireJson.map(value.get("capabilities"));BoundedJson.keys(caps,"can_execute","exact_turn_interrupt","descendants_proof","atomic_queue_append","native_queue_expiry");for(Object cap:caps.values())TaskWire.require(cap instanceof Boolean,"DIRECTORY_INVALID");
   TaskWire.require(Boolean.FALSE.equals(caps.get("descendants_proof"))&&Boolean.FALSE.equals(caps.get("native_queue_expiry")),"DIRECTORY_INVALID");
   Object why=value.get("reason");TaskWire.require(why==null||why instanceof String&&((String)why).matches("[a-z][a-z0-9_]{0,63}"),"DIRECTORY_INVALID");reason=(String)why;
   if(!online){TaskWire.require(busy==null&&reason!=null,"DIRECTORY_INVALID");for(Object cap:caps.values())TaskWire.require(Boolean.FALSE.equals(cap),"DIRECTORY_INVALID");}
   else TaskWire.require((Boolean.TRUE.equals(caps.get("can_execute"))||reason!=null)&&(busy!=null||!Boolean.TRUE.equals(caps.get("can_execute"))||Boolean.TRUE.equals(caps.get("atomic_queue_append"))),"DIRECTORY_INVALID");
   capabilities=Collections.unmodifiableMap(new TreeMap<>(caps));
   // Deduct the entire request round trip, not a guessed one-way latency. Local wall
   // clock changes cannot lengthen a lease, and cached server_time is never fresh proof.
   long budget=Math.max(0,Math.min(60000,expiry-serverTime)-(end-start));
   liveFrom=end;liveUntil=observed&&online&&budget>0?Math.addExact(end,budget):Long.MIN_VALUE;
  }
  boolean live(long elapsed){return online&&liveUntil!=Long.MIN_VALUE&&elapsed>=liveFrom&&elapsed<liveUntil;}
  String gate(long elapsed){if(!live(elapsed))return "DIRECTORY_TARGET_OFFLINE";if(!Boolean.TRUE.equals(capabilities.get("can_execute")))return "DIRECTORY_TARGET_UNSUPPORTED";if(!Boolean.FALSE.equals(busy)&&!Boolean.TRUE.equals(capabilities.get("atomic_queue_append")))return "DIRECTORY_TARGET_BUSY";return "";}
  String status(long elapsed){String gate=gate(elapsed);return gate.isEmpty()?(busy==null?"状态未知 · 可排队":Boolean.TRUE.equals(busy)?"忙碌 · 可排队":"可接收任务"):gate.equals("DIRECTORY_TARGET_UNSUPPORTED")?"连接未就绪 · 暂不能接收任务":gate.equals("DIRECTORY_TARGET_BUSY")?"忙碌 · 暂不能排队":"离线 · 等待电脑连接";}
  String display(){return route.get("agent_id")+" · "+route.get("computer_id")+"\n"+label+"\n工作区 · "+workspace+"\n会话 · "+route.get("session_id");}
 }
 private TaskSessionDirectory(Map<String,Object> value,String server,String owner,long start,long end,boolean observed){
  BoundedJson.keys(value,"schema_version","server_id","owner_id","server_time","sessions","default");realm(value,server,owner);TaskWire.require(end>=start,"DIRECTORY_CLOCK_INVALID");
  this.server=server;this.owner=owner;serverTime=TaskWire.stamp(value.get("server_time"));this.observed=observed;
  List<Object> items=WireJson.list(value.get("sessions"));TaskWire.require(items.size()<=128,"DIRECTORY_INVALID");List<Entry> entries=new ArrayList<>();Set<String> seen=new HashSet<>();
  for(Object item:items){Entry e=new Entry(WireJson.map(item),serverTime,start,end,observed);TaskWire.require(seen.add(e.key),"DIRECTORY_INVALID");entries.add(e);}
  sessions=Collections.unmodifiableList(entries);defaultTarget=defaultTarget(value.get("default"));wire=WireJson.map(WireJson.copy(value));
 }
 static TaskSessionDirectory fresh(byte[] bytes,String server,String owner,long start,long end){return new TaskSessionDirectory(WireJson.map(WireJson.read(bytes,1048576,50000)),server,owner,start,end,true);}
 static TaskSessionDirectory cached(byte[] bytes,String server,String owner){return new TaskSessionDirectory(WireJson.map(WireJson.read(bytes,1048576,50000)),server,owner,0,0,false);}
 static void realm(Map<String,Object> v,String server,String owner){TaskWire.require("1.0".equals(v.get("schema_version"))&&server.equals(v.get("server_id"))&&owner.equals(v.get("owner_id")),"DIRECTORY_IDENTITY_MISMATCH");TaskWire.stamp(v.get("server_time"));}
 static String workspace(Object value){
  String path=TaskConnection.text(value,2048);boolean valid=false;
  if(path.startsWith("/")&&path.indexOf('\\')<0){valid=path.equals("/")||!path.endsWith("/");if(path.contains("//"))valid=false;for(String part:path.split("/",-1))if(part.equals(".")||part.equals(".."))valid=false;}
  else if(path.indexOf('/')<0){
   if(path.matches("[A-Za-z]:\\\\.*")){valid=true;String rest=path.substring(3);if(!rest.isEmpty())for(String part:rest.split("\\\\",-1))if(part.isEmpty()||part.equals(".")||part.equals(".."))valid=false;}
   else if(path.startsWith("\\\\")){String[] parts=path.substring(2).split("\\\\",-1);valid=parts.length>=3;for(int i=0;i<parts.length;i++)if(parts[i].equals(".")||parts[i].equals("..")||parts[i].isEmpty()&&!(parts.length==3&&i==2))valid=false;}
  }
  TaskWire.require(valid,"DIRECTORY_INVALID");return path;
 }
 static String uuid(Object value){String id=TaskWire.uuid(value);TaskWire.require(id.equals(id.toLowerCase(Locale.ROOT)),"DIRECTORY_INVALID");return id;}
 static Map<String,Object> route(Object value){Map<String,Object> route=TaskWire.route(value);for(String k:new String[]{"computer_id","agent_id","project_id"})TaskWire.require(((String)route.get(k)).matches("[A-Za-z0-9_.-]{1,128}"),"DIRECTORY_ROUTE_INVALID");uuid(route.get("session_id"));return Collections.unmodifiableMap(new TreeMap<>(route));}
 static String routeKey(Map<String,Object> route){return TaskWire.hash(WireJson.bytes(route));}
 static Map<String,Object> defaultTarget(Object value){Map<String,Object> d=WireJson.map(value);BoundedJson.keys(d,"revision","route","updated_at");long revision=TaskWire.nonnegative(d.get("revision"));if(d.get("route")!=null)route(d.get("route"));if(revision==0)TaskWire.require(d.get("route")==null&&d.get("updated_at")==null,"DIRECTORY_INVALID");else TaskWire.stamp(d.get("updated_at"));return Collections.unmodifiableMap(WireJson.map(WireJson.copy(d)));}
 static Map<String,Object> defaultReply(byte[] bytes,String server,String owner){Map<String,Object> v=WireJson.map(WireJson.read(bytes));BoundedJson.keys(v,"schema_version","server_id","owner_id","server_time","default");realm(v,server,owner);return defaultTarget(v.get("default"));}
 /** A PUT acknowledgement proves only this exact CAS. A fresh GET still owns displayed state. */
 static Map<String,Object> defaultAck(byte[] bytes,String server,String owner,Map<String,Object> request){
  BoundedJson.keys(request,"request_id","expected_revision","route");uuid(request.get("request_id"));long expected=TaskWire.nonnegative(request.get("expected_revision"));if(request.get("route")!=null)route(request.get("route"));
  Map<String,Object> ack=defaultReply(bytes,server,owner);TaskWire.require(TaskWire.nonnegative(ack.get("revision"))==expected+1&&TaskWire.same(ack.get("route"),request.get("route")),"DIRECTORY_DEFAULT_ACK_MISMATCH");return ack;
 }
 /** Authentication/transport failure cannot prove that an earlier identical PUT did not commit. */
 static boolean defaultFailureResolved(String code){return TaskWire.set("DEFAULT_REVISION_CONFLICT","DEFAULT_SESSION_UNAVAILABLE","AGENT_SESSION_NOT_FOUND","INVALID_AGENT_DEFAULT","IDEMPOTENCY_CONFLICT").contains(code);}
 byte[] encode(){return WireJson.bytes(wire);}
 Entry find(Map<String,Object> route){if(route==null)return null;String key=routeKey(route);for(Entry e:sessions)if(e.key.equals(key)&&TaskWire.same(e.route,route))return e;return null;}
 Map<String,Object> defaultRoute(){return defaultTarget.get("route")==null?null:route(defaultTarget.get("route"));}
 long defaultRevision(){return TaskWire.nonnegative(defaultTarget.get("revision"));}
 String gate(Map<String,Object> route,long elapsed){if(!observed)return "DIRECTORY_REFRESH_REQUIRED";Entry e=find(route);return e==null?"DIRECTORY_TARGET_MISSING":e.gate(elapsed);}
 void requireExecutable(Map<String,Object> route,long elapsed){String error=gate(route,elapsed);TaskWire.require(error.isEmpty(),error);}
 static boolean guarded(Map<String,Object> event){if(!"task".equals(event.get("kind")))return false;Map<String,Object> b=TaskWire.body(event);return TaskWire.positive(b.get("revision"))==1||b.get("control") instanceof Map&&"resume".equals(WireJson.map(b.get("control")).get("kind"));}
 static void command(String text){TaskWire.require(text!=null&&!text.trim().isEmpty()&&text.getBytes(StandardCharsets.UTF_8).length<=MAX_INPUT_BYTES,"DIRECTORY_COMMAND_TOO_LARGE");}
 /** A cached mutation ACK can be older than a newer directory GET. Never roll it back. */
 void checkDefaultAgainst(TaskSessionDirectory prior){if(prior==null)return;TaskWire.require(server.equals(prior.server)&&owner.equals(prior.owner),"DIRECTORY_IDENTITY_MISMATCH");TaskWire.require(defaultRevision()>=prior.defaultRevision(),"DIRECTORY_DEFAULT_STALE");if(defaultRevision()==prior.defaultRevision())TaskWire.require(TaskWire.same(defaultTarget,prior.defaultTarget),"DIRECTORY_DEFAULT_CONFLICT");}
}
