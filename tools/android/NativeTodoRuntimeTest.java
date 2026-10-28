package com.turboio.addon;

import android.content.Context;
import android.os.Handler;
import android.os.Looper;
import java.io.*;
import java.lang.reflect.*;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.*;

/** The production observer, decision flow, durable session, frame codec and
 * create-response boundary run unchanged. Android scheduling, account and
 * remote/native transports are finite doubles; no device or server is used. */
public final class NativeTodoRuntimeTest {
 static final AtomicInteger checks=new AtomicInteger();
 static final List<String> events=new CopyOnWriteArrayList<>();
 static final List<Map<String,Object>> actions=new CopyOnWriteArrayList<>();
 static Fixture current;
 static void yes(boolean ok,String message){checks.incrementAndGet();if(!ok)throw new AssertionError(message);}
 static void mainThread(String operation){yes(Looper.myLooper()==Looper.getMainLooper(),operation+" must run on main");}
 static void ioThread(String operation){yes(Looper.myLooper()!=Looper.getMainLooper(),operation+" must not run on main");}
 static Object get(Object owner,String name)throws Exception{Field f=owner.getClass().getDeclaredField(name);f.setAccessible(true);return f.get(owner);}
 static void set(Object owner,String name,Object value)throws Exception{Field f=owner instanceof Class?((Class<?>)owner).getDeclaredField(name):owner.getClass().getDeclaredField(name);f.setAccessible(true);f.set(owner instanceof Class?null:owner,value);}
 static String durablePhase()throws Exception{return (String)WireJson.map(WireJson.read(Files.readAllBytes(current.journal.toPath()))).get("phase");}
 static NativeTodoSession.Proposal proposal(){return new NativeTodoSession.Proposal(WireJson.object("schema_version","1.0","proposal_id","todo-"+"a".repeat(64),"content","合成回归待办","source","Codex","state","pending_confirmation","expires_at","2030-01-01T00:00:00Z"));}
 static byte[] command(String uid,Object cmd){return OtaFrame.encode(34,WireJson.object("suggestUID",uid,"suggestType",2,"cmd",cmd),null);}

 static final class Fixture implements AutoCloseable {
  final NativeTodoRuntime runtime;final NativeTodoSession session;final ExecutorService io;final File journal;final String uid;final Runnable timeout;
  Fixture(File root)throws Exception{
   Handler.clear();events.clear();actions.clear();android.util.Log.clear();Host107Connection.reads.set(0);Host107Login.reads.set(0);Host107LifelogHttp.writes.set(0);Host107LifelogHttp.failure="";Host107Suggestion.frames.clear();Host107Todo.refreshes.set(0);NativeTransfer.releases.set(0);TaskAttention.releases.set(0);
   File files=Files.createTempDirectory(root.toPath(),"native-todo-").toFile();journal=new File(files,"io-native-todo-v1.json");
   Constructor<NativeTodoRuntime> constructor=NativeTodoRuntime.class.getDeclaredConstructor(Context.class);constructor.setAccessible(true);runtime=constructor.newInstance(new Context(files));
   session=(NativeTodoSession)get(runtime,"session");io=(ExecutorService)get(runtime,"io");timeout=(Runnable)get(runtime,"timeout");
   TaskDevice device=new TaskDevice();set(runtime,"device",device);set(runtime,"allowed",(java.util.function.BooleanSupplier)()->true);
   session.shown(proposal(),device.server+":"+device.owner+":"+device.producer,Host107Login.ACCOUNT.binding,Host107Connection.PEER,1);
   uid=session.uid();set(runtime,"presenting",true);set(runtime,"lease","native-todo-"+session.id());set(runtime,"link",new Fixed60Session.Link(Host107Connection.PEER,1));set(runtime,"uid",uid);set(NativeTodoRuntime.class,"instance",runtime);
   Handler main=new Handler(Looper.getMainLooper());main.postDelayed(timeout,15000);current=this;
  }
  void idle()throws Exception{io.submit(()->{}).get(3,TimeUnit.SECONDS);}
  void deliver()throws Exception{Runnable work=Handler.next(1000);yes(work!=null,"Missing main callback");work.run();}
  void observe(Object cmd)throws Exception{
   byte[] bytes=command(uid,cmd);AtomicBoolean owned=new AtomicBoolean();Thread callback=new Thread(()->owned.set(NativeTodoRuntime.observe(21,Host107Connection.PEER,bytes)),"synthetic-glasses-callback");callback.start();callback.join(3000);yes(!callback.isAlive()&&owned.get(),"Owned suggestion callback must return without waiting for HTTP");
   idle();yes(actions.isEmpty()&&Host107LifelogHttp.writes.get()==0,"Remote actions must wait for main link snapshot");
   deliver();idle();
   yes(Host107Connection.reads.get()==1,"TODO_DECISION_MAIN_LINK: original Host107Ota.link was not acquired on main; "+android.util.Log.lines);
  }
  void flush()throws Exception{for(int pass=0;pass<4;pass++){idle();Runnable work;while((work=Handler.next(0))!=null)work.run();}idle();}
  void finished(boolean ack)throws Exception{
   flush();yes(session.phase().equals("CLOSED")&&durablePhase().equals("CLOSED"),"TODO_DECISION_TERMINAL: phase="+session.phase()+", timeout_pending="+Handler.pending(timeout));
   yes(!Handler.pending(timeout),"Confirmation timeout must be cancelled");
   if(ack){yes(Handler.fireDelayed(1500),"ACK callback must schedule removal");flush();}
   yes(!((Boolean)get(runtime,"presenting")),"Decision must release presentation");yes(NativeTransfer.releases.get()==1&&TaskAttention.releases.get()==1,"Decision must release both native and attention leases");
   yes(android.util.Log.lines.stream().noneMatch(line->line.contains("OTA_THREAD")),"No OTA_THREAD error may be swallowed");
  }
  public void close()throws Exception{
   io.shutdownNow();yes(io.awaitTermination(2,TimeUnit.SECONDS),"Runtime IO executor did not terminate");
   Object store=get(session,"store");for(Field f:store.getClass().getDeclaredFields()){f.setAccessible(true);Object value=f.get(store);if(value instanceof AtomicDocument)((AtomicDocument)value).close();}
   set(NativeTodoRuntime.class,"instance",null);Handler.clear();current=null;
  }
 }
 static List<String> actionNames(){List<String> names=new ArrayList<>();for(Map<String,Object> a:actions)names.add((String)a.get("action"));return names;}
 static void frames(String uid,boolean ack){
  List<OtaFrame> frames=Host107Suggestion.frames;yes(frames.size()==(ack?2:1),"Unexpected glasses callback frame count");
  if(ack){OtaFrame first=frames.get(0);Map<String,Object> body=BoundedJson.map(first.json);yes(first.type==35&&uid.equals(body.get("suggestUID"))&&BoundedJson.number(body.get("code"),0,0)==0,"Success ACK must use the original suggestion UID");}
  OtaFrame last=frames.get(frames.size()-1);Map<String,Object> body=BoundedJson.map(last.json);yes(last.type==33&&uid.equals(body.get("suggestUID"))&&BoundedJson.number(body.get("type"),2,2)==2,"Final callback must remove the original card");
 }
 public static void main(String[] args)throws Exception{
  Looper.getMainLooper();File root=new File(args[0]);Files.createDirectories(root.toPath());
  try(Fixture f=new Fixture(root)){
   f.observe(1);
   yes(actionNames().equals(Arrays.asList("accept","begin","created")),"Nod must accept, begin and report created in order: "+actionNames());
   yes(events.equals(Arrays.asList("link.main","server.accept","http.open","server.begin","http.create","http.close","server.created")),"Main link / IO create order changed: "+events);
   yes(Host107LifelogHttp.writes.get()==1&&Host107Login.reads.get()==1,"Nod must create exactly one original todo");
   yes(actions.get(2).get("native_id").equals("stock-synthetic-42"),"Created receipt must preserve the original task id");
   f.finished(true);yes(Host107Todo.refreshes.get()==1,"Created todo must request stock refresh on main");frames(f.uid,true);
  }
  try(Fixture f=new Fixture(root)){
   f.observe(2);yes(actionNames().equals(Collections.singletonList("decline")),"Shake must only report decline");
   yes(Host107LifelogHttp.writes.get()==0&&Host107Login.reads.get()==0,"Decline must not open the original account or write HTTP");
   f.finished(true);yes(Host107Todo.refreshes.get()==0,"Decline must not refresh stock tasks");frames(f.uid,true);
  }
  try(Fixture f=new Fixture(root)){
   f.observe("bad-command");f.finished(false);
   yes(actionNames().equals(Collections.singletonList("failed")),"Invalid owned operation must leave SHOWN and report failure");
   yes(actions.get(0).get("error").equals("TODO_ACTION_FAILED"),"Decision exception must use failShown callback");
   yes(Host107LifelogHttp.writes.get()==0&&Host107Todo.refreshes.get()==0,"Failed decision must not create or refresh");frames(f.uid,false);
  }
  try(Fixture f=new Fixture(root)){
   Host107LifelogHttp.failure="OFFICIAL_SOURCE_UNAVAILABLE";f.observe(1);f.finished(false);
   yes(actionNames().equals(Arrays.asList("accept","begin","unknown")),"Unproven create result must report unknown, not success");
   yes(Host107LifelogHttp.writes.get()==1&&Host107Todo.refreshes.get()==0,"Unproven write must not refresh or retry");frames(f.uid,false);
  }
  System.out.println("Native todo runtime: "+checks.get()+" checks passed; real observer/session/create and Host107Ota main guard, synthetic Android/transports");
 }
}

// Only platform/transport edges are doubled. State transitions, parser, UUID,
// durable writes and the Host107Ota thread assertion use production classes.
final class TaskDevice {final String server="synthetic.invalid",owner="synthetic-owner",producer="synthetic-phone";}
final class TaskApi {static String safeError(Exception e){return e.getMessage()==null?e.getClass().getSimpleName():e.getMessage();}}
final class TaskPairing {
 static List<NativeTodoSession.Proposal> todoSuggestions(TaskDevice device){throw new AssertionError("Polling is outside this decision callback test");}
 static Map<String,Object> todoAction(TaskDevice device,String id,Map<String,Object> body)throws Exception{
  NativeTodoRuntimeTest.ioThread("server todo action");String action=(String)body.get("action");NativeTodoRuntimeTest.events.add("server."+action);
  String expected=action.equals("accept")?"ACCEPTED":action.equals("begin")?"CREATING":action.equals("created")?"CREATED":action.equals("decline")?"DECLINED":action.equals("failed")?"FAILED":"UNKNOWN";
  NativeTodoRuntimeTest.yes(expected.equals(NativeTodoRuntimeTest.durablePhase()),"Remote action must follow durable "+expected);
  NativeTodoRuntimeTest.yes(id.equals(NativeTodoRuntimeTest.current.session.id()),"Remote action must retain proposal id");NativeTodoRuntimeTest.actions.add(WireJson.map(WireJson.copy(body)));return WireJson.object("may_create",true);
 }
}
final class OfficialAccountBinding {final String binding="synthetic-official-account";}
final class Host107Login {static final OfficialAccountBinding ACCOUNT=new OfficialAccountBinding();static final AtomicInteger reads=new AtomicInteger();static OfficialAccountBinding account(){NativeTodoRuntimeTest.ioThread("official account lookup");reads.incrementAndGet();return ACCOUNT;}}
final class MaterialSyncSession {interface Guard {void check()throws IOException;}}
final class Host107LifelogHttp implements AutoCloseable {
 static final AtomicInteger writes=new AtomicInteger();static String failure="";final MaterialSyncSession.Guard guard;
 Host107LifelogHttp(Context context,OfficialAccountBinding account,MaterialSyncSession.Guard guard){NativeTodoRuntimeTest.ioThread("official HTTP open");this.guard=guard;NativeTodoRuntimeTest.events.add("http.open");}
 byte[] createTodo(OfficialTodoCreate.Request request)throws Exception{
  NativeTodoRuntimeTest.ioThread("official HTTP create");guard.check();NativeTodoRuntimeTest.yes(NativeTodoRuntimeTest.durablePhase().equals("CREATING"),"Official write must follow durable intent");
  NativeTodoRuntimeTest.yes(request.method.equals("POST")&&request.path.equals("/action/api/v2/tasks/create"),"Official write route changed");Map<String,Object> body=WireJson.map(WireJson.read(request.body()));NativeTodoRuntimeTest.yes(body.get("source").equals("rayneoTasks")&&body.get("content").equals(NativeTodoRuntimeTest.proposal().content),"Official typed request changed");
  writes.incrementAndGet();NativeTodoRuntimeTest.events.add("http.create");if(!failure.isEmpty())throw new IOException(failure);return WireJson.bytes(WireJson.object("code",0,"data",WireJson.object("id","stock-synthetic-42","source","rayneoTasks")));
 }
 public void close(){NativeTodoRuntimeTest.ioThread("official HTTP close");NativeTodoRuntimeTest.events.add("http.close");}
}
final class Fixed60Session {static final class Link {final String peer;final long generation;Link(String peer,long generation){this.peer=peer;this.generation=generation;}}}
final class Host107Connection {static final String PEER="synthetic-peer";static final AtomicInteger reads=new AtomicInteger();static String otaPeer(){NativeTodoRuntimeTest.mainThread("original OTA connection read");reads.incrementAndGet();NativeTodoRuntimeTest.events.add("link.main");return PEER;}}
final class OfficialSdkReceipt {interface Observer {}static Object wrap(Class<?> c,Object original,Object message,Observer observer){throw new AssertionError("Vendor receipt is outside this callback test");}}
final class NavReflect {static Class<?> type(String name)throws Exception{throw new AssertionError("Reflection transport is outside this callback test");}static Object field(Object owner,String name)throws Exception{throw new AssertionError("Reflection transport is outside this callback test");}static Object call(Object owner,String name,Object...args)throws Exception{throw new AssertionError("Reflection transport is outside this callback test");}static Object make(String name,Object...args)throws Exception{throw new AssertionError("Reflection transport is outside this callback test");}static Object proxy(String name,java.util.function.BiConsumer<String,Object[]> callback)throws Exception{throw new AssertionError("Reflection transport is outside this callback test");}}
final class FirmwareQueue {interface Work {Object run()throws Exception;}static boolean busy(){return false;}static void submit(Object owner,Object message,String peer,byte[] bytes,boolean enabled,Work work){throw new AssertionError("Firmware transport is outside this callback test");}}
final class ProductInfo {static final boolean OTA_WRITES_ENABLED=false;}
final class HostBusiness {static int id(Object value){return -1;}}
final class AgentCardRuntime {static boolean enabled(){return true;}}
final class TaskAttention {static final AtomicInteger releases=new AtomicInteger();static boolean active(){return false;}static void hold(String owner,long millis){NativeTodoRuntimeTest.mainThread("attention hold");}static void release(String owner){NativeTodoRuntimeTest.mainThread("attention release");releases.incrementAndGet();}}
final class NewsTele {static boolean active(){return false;}}
final class HeadGestureRuntime {static boolean pending(){return false;}}
final class NativeTransfer {static final AtomicInteger releases=new AtomicInteger();static boolean acquireMessages(String owner){throw new AssertionError("Suggestion preflight is outside this callback test");}static void releaseMessages(String owner){NativeTodoRuntimeTest.mainThread("native lane release");releases.incrementAndGet();}}
final class MinuteCardSession {
 interface Store {Object read();void save(Object value);}static final class Emission {long ticket;}
 MinuteCardSession(Store store){}boolean inspect(String peer,long generation,long now,boolean resume){throw new AssertionError("Suggestion preflight is outside this callback test");}void tick(String peer,long generation,long now,boolean allowed){throw new AssertionError("Suggestion preflight is outside this callback test");}String phase(){throw new AssertionError("Suggestion preflight is outside this callback test");}boolean working(){return false;}Emission next(long now){return null;}void result(long ticket,boolean ok,long now){}void receive(String peer,long generation,int business,byte[] bytes,long now){}
}
final class Host107Suggestion {
 static final List<OtaFrame> frames=new CopyOnWriteArrayList<>();static void send(Fixed60Session.Link link,MinuteCardSession.Emission emission,Host107Ota.Receipt receipt){throw new AssertionError("Suggestion preflight is outside this callback test");}
 static void sendTodo(Fixed60Session.Link link,byte[] bytes,java.util.function.BooleanSupplier allowed,Host107Ota.Receipt receipt){NativeTodoRuntimeTest.mainThread("native todo callback");NativeTodoRuntimeTest.yes(allowed.getAsBoolean(),"Callback must retain its active presentation");frames.add(OtaFrame.decode(bytes));receipt.received(true);}
}
final class Host107Todo {static final AtomicInteger refreshes=new AtomicInteger();static boolean refresh(String id){NativeTodoRuntimeTest.mainThread("stock task refresh");refreshes.incrementAndGet();return true;}}
