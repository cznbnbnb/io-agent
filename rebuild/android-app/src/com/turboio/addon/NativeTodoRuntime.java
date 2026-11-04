package com.turboio.addon;

import android.content.Context;
import android.os.*;
import java.io.File;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.BooleanSupplier;

/** Confirmation-gated stock todos. Uses its own I/O queue, the existing native
 * suggestion transport and stock refresh; never records audio or writes Isar. */
final class NativeTodoRuntime {
 private static volatile NativeTodoRuntime instance;
 private final Context app;private final Handler main=new Handler(Looper.getMainLooper());
 private final ExecutorService io=Executors.newSingleThreadExecutor();private final AtomicBoolean busy=new AtomicBoolean();
 private final NativeTodoSession session;private volatile TaskDevice device;private volatile BooleanSupplier allowed=()->false;
 private volatile boolean presenting;private String uid="",lease="";private Fixed60Session.Link link;private MinuteCardSession preflight;
 private long nextPoll;private String pollPhone="",pollSignal="";
 private NativeTodoRuntime(Context context)throws Exception{app=context.getApplicationContext();AtomicDocument file=new AtomicDocument(new File(app.getFilesDir(),"io-native-todo-v1.json"));session=new NativeTodoSession(new NativeTodoSession.Store(){public Object read()throws Exception{return file.read();}public void save(Object value)throws Exception{file.save(value);}});}
 static synchronized void wake(Context context,TaskDevice device,BooleanSupplier allowed,String inboxSignal){
  if(instance==null)try{instance=new NativeTodoRuntime(context);}catch(Exception unavailable){android.util.Log.w("TurboIOTodo","todo journal unavailable");return;}
  NativeTodoRuntime r=instance;r.device=device;r.allowed=allowed;if(!r.busy.compareAndSet(false,true))return;
  r.io.execute(()->{try{long now=SystemClock.elapsedRealtime();String phone=r.phone();
   if(!r.session.active()&&inboxSignal.equals(r.pollSignal)&&phone.equals(r.pollPhone)&&now<r.nextPoll)return;
   r.nextPoll=now+60000;r.pollPhone=phone;r.pollSignal=inboxSignal;r.poll();
  }catch(Exception failed){android.util.Log.w("TurboIOTodo","todo poll "+TaskApi.safeError(failed));}finally{r.busy.set(false);}});
 }
 private String phone(){TaskDevice d=device;return d.server+":"+d.owner+":"+d.producer;}
 private void check()throws java.io.IOException{TaskWire.require(session.healthy(),"TODO_STORAGE_UNCERTAIN");TaskWire.require(allowed.getAsBoolean()&&AgentCardRuntime.enabled(),"TASK_PAUSED");TaskWire.require(!session.active()||session.phone().equals(phone()),"TODO_PHONE_CHANGED");}
 private void poll()throws Exception{
  check();if(session.active()){
   if(session.proposal().expires<=System.currentTimeMillis()&&TaskWire.set("SHOWN","ACCEPTED","DECLINED","FAILED").contains(session.phase())){session.closed();main.post(this::remove);return;}
   if(session.phase().equals("SHOWN"))return;
   if(session.phase().equals("ACCEPTED")||session.phase().equals("DECLINED"))finishDecision();else report();return;
  }
  if(presenting)return;
  for(NativeTodoSession.Proposal p:TaskPairing.todoSuggestions(device)){
   if(!p.state.equals("pending_confirmation"))continue;
   presenting=true;main.post(()->prepare(p));break;
  }
 }
 private void prepare(NativeTodoSession.Proposal p){
  if(!allowed.getAsBoolean()||!AgentCardRuntime.enabled()||TaskAttention.active()||NewsTele.active()||FirmwareQueue.busy()||HeadGestureRuntime.pending()){presenting=false;return;}
  Fixed60Session.Link current=Host107Ota.link();if(current.peer==null||current.peer.isEmpty()){presenting=false;return;}
  String owner="native-todo-"+p.id;if(!NativeTransfer.acquireMessages(owner)){presenting=false;return;}
  lease=owner;link=current;preflight=new MinuteCardSession(new MinuteCardSession.Store(){public Object read(){return null;}public void save(Object value){}});
  if(!preflight.inspect(current.peer,current.generation,SystemClock.elapsedRealtime(),false)){release();return;}
  pumpPreflight(p);
 }
 private void pumpPreflight(NativeTodoSession.Proposal p){
  if(preflight==null)return;Fixed60Session.Link current=Host107Ota.link();long now=SystemClock.elapsedRealtime();preflight.tick(current.peer,current.generation,now,allowed.getAsBoolean());
  if(preflight.phase().equals("READY")){
   preflight=null;io.execute(()->{try{check();OfficialAccountBinding account=Host107Login.account();TaskWire.require(account!=null,"OFFICIAL_LOGIN_REQUIRED");TaskPairing.todoAction(device,p.id,WireJson.object("action","show"));session.shown(p,phone(),account.binding,link.peer,link.generation);main.post(()->show(p));}
    catch(Exception failed){android.util.Log.w("TurboIOTodo","todo show "+TaskApi.safeError(failed));main.post(this::release);}});return;
  }
  if(!preflight.working()){release();return;}
  MinuteCardSession.Emission emission=preflight.next(now);MinuteCardSession owned=preflight;if(emission!=null)Host107Suggestion.send(link,emission,ok->{if(preflight==owned)owned.result(emission.ticket,ok,SystemClock.elapsedRealtime());});
  main.postDelayed(()->pumpPreflight(p),250);
 }
 private void show(NativeTodoSession.Proposal p){
  uid=session.uid();TaskAttention.hold(lease,15000);
  byte[] bytes=OtaFrame.encode(33,WireJson.object("type",1,"suggestUID",uid,"suggestType",2,"title","添加待办","source",p.source,"content",p.content),null);
  Host107Suggestion.sendTodo(link,bytes,()->presenting&&allowed.getAsBoolean(),ok->{if(!ok)failShown("TODO_SHOW_FAILED");});main.postDelayed(timeout,15000);
 }
 private final Runnable timeout=()->{if(presenting)failShown("TODO_CONFIRMATION_TIMEOUT");};
 private void failShown(String code){main.removeCallbacks(timeout);io.execute(()->{try{if(session.phase().equals("SHOWN")){session.fail(code);report();}else main.post(this::remove);}catch(Exception failed){android.util.Log.w("TurboIOTodo","todo timeout "+TaskApi.safeError(failed));main.post(this::remove);}});}
 static boolean observe(int business,String peer,byte[] bytes){
  boolean own=business==21&&NativeTodoSession.owns(bytes);NativeTodoRuntime r=instance;if(r==null||!own&&business!=9)return own;
  if(peer==null||peer.isEmpty())return own;
  if(business==9)r.main.post(()->{if(r.preflight!=null)r.preflight.receive(peer,r.link.generation,9,bytes,SystemClock.elapsedRealtime());});
  else r.main.post(()->{Fixed60Session.Link current=Host107Ota.link();r.io.execute(()->{try{if(r.session.operate(peer,current.generation,bytes,System.currentTimeMillis())){android.util.Log.i("TurboIOTodo","todo action "+r.session.phase());r.main.post(()->{r.main.removeCallbacks(r.timeout);TaskAttention.hold(r.lease,60000);});r.finishDecision();}}
   catch(Exception failed){android.util.Log.w("TurboIOTodo","todo decision "+TaskApi.safeError(failed));r.main.post(()->r.failShown("TODO_ACTION_FAILED"));}});});
  return own;
 }
 private void finishDecision()throws Exception{
  check();if(session.phase().equals("DECLINED")){report();return;}
  OfficialAccountBinding account=Host107Login.account();if(account==null||!session.account().equals(account.binding)){session.fail("OFFICIAL_ACCOUNT_CHANGED");report();return;}
  TaskPairing.todoAction(device,session.id(),WireJson.object("action","accept"));check();session.creating();
  try(Host107LifelogHttp http=new Host107LifelogHttp(app,account,this::check)){
   Map<String,Object> begun=TaskPairing.todoAction(device,session.id(),WireJson.object("action","begin"));
   if(!Boolean.TRUE.equals(begun.get("may_create"))){session.unknown("TODO_WRITE_NOT_PROVEN");report();return;}
   OfficialTodoCreate.Request request=OfficialTodoCreate.request(session.id(),session.proposal().content);
   byte[] response=http.createTodo(request);session.created(OfficialTodoCreate.createdId(response));
  }catch(Exception failed){String code=TaskApi.safeError(failed);if(code.equals("TODO_CREATE_REJECTED")||code.equals("OFFICIAL_AUTH_REQUIRED"))session.fail(code);else session.unknown(code);}
  report();
 }
 private void report()throws Exception{
  check();String phase=session.phase();Map<String,Object> action;
  if(phase.equals("CREATED"))action=WireJson.object("action","created","native_id",session.nativeId());
  else if(phase.equals("DECLINED"))action=WireJson.object("action","decline");
  else if(phase.equals("FAILED"))action=WireJson.object("action","failed","error",session.error());
  else if(phase.equals("UNKNOWN"))action=WireJson.object("action","unknown","error",session.error());
  else return;
  TaskPairing.todoAction(device,session.id(),action);String finishedUid=session.uid();boolean created=phase.equals("CREATED"),declined=phase.equals("DECLINED");String id=session.id();
  session.closed();main.post(()->{
   if(created)Host107Todo.refresh(id);
   if(link!=null&&finishedUid.equals(uid)&&(created||declined))Host107Suggestion.sendTodo(link,OtaFrame.encode(35,WireJson.object("suggestUID",finishedUid,"suggestType",2,"code",0),null),()->presenting,ok->main.postDelayed(this::remove,1500));else remove();
  });
 }
 private void remove(){
  if(link==null||uid.isEmpty()){release();return;}String retired=uid;
  Host107Suggestion.sendTodo(link,OtaFrame.encode(33,WireJson.object("suggestUID",retired,"suggestType",2,"type",2),null),()->presenting,ok->release());
 }
 private void release(){main.removeCallbacks(timeout);preflight=null;if(!lease.isEmpty()){TaskAttention.release(lease);NativeTransfer.releaseMessages(lease);}lease="";uid="";link=null;presenting=false;}
}
