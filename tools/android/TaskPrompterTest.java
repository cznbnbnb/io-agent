package com.turboio.addon;
import java.util.*;
import java.lang.reflect.*;
import android.os.*;

/** Executes the real NewsTele receiver/control/timer and durable question-owner policy. */
public final class TaskPrompterTest {
 static int checks,voice;static final long NOW=1792490400000L;
 static void yes(boolean v){checks++;if(!v)throw new AssertionError("prompter check "+checks);}
 static void set(String key,Object value)throws Exception{Field f=NewsTele.class.getDeclaredField(key);f.setAccessible(true);f.set(null,value);}
 static void clear()throws Exception{Method m=NewsTele.class.getDeclaredMethod("clear");m.setAccessible(true);m.invoke(null);Handler.clear();NavReflect.sent.clear();voice=0;NewsTele.orphans=null;NewsTele.closed=null;NativeTransfer.peer="glasses";SystemClock.time=10000;}
 static String start()throws Exception{clear();yes(NewsTele.question("Synthetic question",120,30000,()->voice++));return NewsTele.did();}
 static void frame(String peer,String did,int type,int action,int code){NewsTele.receive(peer,OtaFrame.encode(type,WireJson.object("did",did,"action",action,"code",code),null));}
 static long stops(){return NavReflect.sent.stream().filter(b->NavCore.decode(b).type==6).count();}
 static TaskConnection connection(){Map<String,Object> c=WireJson.object("format",TaskConnection.FORMAT,"base_url","https://synthetic.invalid/v1","owner_id","synthetic-owner","producer_id","synthetic-phone","server_id","synthetic-server","computer_id","pc","agent_id","codex","project_id","project","session_id","original-session","token","A".repeat(43),"token_id","c0ffee00-0000-4000-8000-000000000001","expires_at",TaskWire.now(NOW+3600000));return TaskConnection.parse(WireJson.bytes(c),NOW);}
 static Map<String,Object> item(String kind,Map<String,Object> body){return WireJson.object("schema_version","1.0","kind",kind,"object_id",body.get(kind+"_id"),"revision",1,"state",body.get("state"),"expires_at",TaskWire.now(NOW+60000),"commit_seq",1,"stored_at",TaskWire.now(NOW),"event_id","synthetic-event-"+kind,"body",body);}
 static Map<String,Object> task(TaskConnection c){return item("task",WireJson.object("task_id","task","revision",1,"route",c.route(),"state","waiting_answer","command","合成任务","allow_create_session",false));}
 static Map<String,Object> request(TaskConnection c){return item("request",WireJson.object("request_id","question","revision",1,"task_id","task","route",c.route(),"question","合成问题","state","pending","mode","free_text","options",Collections.emptyList()));}
 static Map<String,Object> copy(Map<String,Object> v){return WireJson.map(WireJson.copy(v));}
 static boolean allows(TaskPrompterOwner o,TaskConnection c,Map<String,Object> r,Map<String,Object> p){return o.allows(c,true,r,p,false,false,NOW);}
 public static void main(String[] args)throws Exception{
  TaskConnection c=connection();Map<String,Object> r=request(c),p=task(c);TaskPrompterOwner o=TaskPrompterOwner.create("test-did","glasses",c,r,NOW);
  yes(o.until==NOW+60000);yes(TaskPrompterOwner.deadline(c,r,NOW+60000)==NOW+60000);
  Map<String,Object> longer=copy(r);longer.put("expires_at",TaskWire.now(NOW+7200000));yes(TaskPrompterOwner.deadline(c,longer,NOW)==NOW+180000);yes(TaskPrompterOwner.deadline(c,longer,c.expiresAt-1000)==c.expiresAt);
  yes(allows(o,c,r,p));yes(allows(TaskPrompterOwner.read(o.encode()),c,r,p));yes(!allows(TaskPrompterOwner.read(o.cancel().encode()),c,r,p));
  yes(!o.allows(c,false,r,p,false,false,NOW));yes(!o.allows(c,true,r,p,true,false,NOW));yes(!o.allows(c,true,r,p,false,true,NOW));yes(!o.allows(c,true,r,p,false,false,o.until));
  for(String state:new String[]{"withdrawn","expired","answered"}){Map<String,Object> x=copy(r);x.put("state",state);yes(!allows(o,c,x,p));}
  for(String state:new String[]{"cancelled","completed","failed"}){Map<String,Object> x=copy(p);x.put("state",state);yes(!allows(o,c,r,x));}
  Map<String,Object> x=copy(r);x.put("revision",2);yes(!allows(o,c,x,p));x=copy(r);TaskWire.body(x).put("question","changed");yes(!allows(o,c,x,p));x=copy(r);x.put("answer",WireJson.object("answer_id","saved"));yes(!allows(o,c,x,p));
  yes(!allows(o,c,null,p));yes(!allows(o,c,r,null));yes(TaskPrompterOwner.read("broken")==null);yes(o.matches(c.binding(),"question"));yes(!o.matches("other","question"));yes(!o.matches(c.binding(),"other"));
  Map<String,Object> other=WireJson.map(WireJson.read(c.encode()));other.put("session_id","another-session");yes(!allows(o,TaskConnection.parse(WireJson.bytes(other),NOW),r,p));
  TaskPrompterNotice notice=TaskPrompterNotice.create("notice-did","glasses",c.binding(),999999,NOW);
  yes(notice.until==NOW+180000);yes(notice.remaining("glasses",true,NOW)==180000);yes(notice.remaining("other",true,NOW)==0);yes(notice.remaining("glasses",false,NOW)==0);yes(notice.remaining("glasses",true,NOW+180000)==0);
  yes(TaskPrompterNotice.read(notice.encode()).remaining("glasses",true,NOW)==180000);yes(TaskPrompterNotice.read(notice.cancel().encode()).remaining("glasses",true,NOW)==0);yes(TaskPrompterNotice.read("broken")==null);yes(!notice.matches("other")&&notice.matches(c.binding()));
  clear();NewsTele.orphans=id->id.equals("notice-did")?new NewsTele.Adoption(null,10000):null;frame("glasses","notice-did",4,1,1);Handler.ready();yes(NewsTele.active());Handler.advance(10000);yes(stops()==1);frame("glasses","notice-did",6,1,1);Handler.ready();yes(voice==0&&!NewsTele.active());
  // Silent notices do not need an unsolicited frame after restart: query only their stored DID.
  clear();yes(!NewsTele.recoverNotice("old","other",1000));yes(!NewsTele.active());yes(NewsTele.recoverNotice("old","glasses",1000));yes(NavCore.decode(NavReflect.sent.get(0)).type==10);yes(stops()==0);
  NewsTele.receive("glasses",OtaFrame.encode(10,WireJson.object("did","wrong","action",2,"state",4),null));yes(stops()==0&&NewsTele.active());
  NewsTele.receive("glasses",OtaFrame.encode(10,WireJson.object("did","old","action",2,"state",4),null));Handler.advance(999);yes(stops()==0);Handler.advance(1);yes(stops()==1);frame("glasses","old",6,2,1);yes(!NewsTele.active()&&voice==0);
  clear();yes(NewsTele.recoverNotice("expired","glasses",0));yes(stops()==0);NewsTele.receive("glasses",OtaFrame.encode(10,WireJson.object("did","expired","action",2,"state",1),null));yes(stops()==1);frame("glasses","expired",6,2,1);yes(!NewsTele.active());
  clear();int[] retired={0};NewsTele.closed=id->retired[0]++;yes(NewsTele.recoverNotice("absent","glasses",1000));NewsTele.receive("glasses",OtaFrame.encode(10,WireJson.object("did","absent","action",2,"state",0),null));yes(stops()==0&&!NewsTele.active()&&retired[0]==1);
  clear();yes(NewsTele.recoverNotice("cancelled","glasses",10000));yes(NewsTele.cancelTask("cancelled"));yes(stops()==0);NewsTele.receive("glasses",OtaFrame.encode(10,WireJson.object("did","cancelled","action",2,"state",4),null));yes(stops()==1);
  // A direct phone stop wins even if the wearer exit arrives before its ACK, including duplicates.
  String did=start();NewsTele.control(6);yes(stops()==1);frame("glasses",did,6,1,1);Handler.ready();yes(voice==0&&!NewsTele.active());frame("glasses",did,6,1,1);Handler.ready();yes(voice==0);
  // Normal wearer exit remains exactly once; foreign DID/peer cannot retire the owner.
  did=start();frame("other",did,6,1,1);frame("glasses","other",6,1,1);yes(NewsTele.active());frame("glasses",did,6,1,1);frame("glasses",did,6,1,1);Handler.ready();yes(voice==1&&!NewsTele.active());
  did=start();yes(!NewsTele.cancelTask("other"));yes(stops()==0);yes(NewsTele.cancelTask(did));yes(NewsTele.cancelTask(did));yes(stops()==1);frame("glasses",did,6,2,1);Handler.ready();yes(voice==0&&!NewsTele.active());
  // A scheduled timeout exits without creating an answer or starting voice.
  did=start();set("phase","playing");set("waiting",0);Handler.advance(30000);yes(stops()==1);frame("glasses",did,6,1,1);Handler.ready();yes(voice==0);
  // The start guard must not lose a deferred stop when playback starts in the meantime.
  did=start();set("phase","starting");set("startAck",SystemClock.time);NewsTele.control(6);yes(stops()==0);set("phase","playing");set("waiting",0);Handler.advance(3500);yes(stops()==1);frame("glasses",did,6,1,1);Handler.ready();yes(voice==0);
  // A stale deferred stop cannot close a replacement manuscript.
  did=start();set("phase","starting");set("startAck",SystemClock.time);NewsTele.control(6);frame("glasses",did,6,1,1);Handler.ready();yes(voice==0);yes(NewsTele.question("replacement",120,30000,()->voice++));String newer=NewsTele.did();NavReflect.sent.clear();Handler.advance(3500);yes(stops()==0&&newer.equals(NewsTele.did()));
  // Timeout/withdrawn records can reclaim only their DID after process loss, for stop-only cleanup.
  clear();NewsTele.orphans=id->id.equals("orphan")?new NewsTele.Adoption(null,0):null;frame("glasses","foreign",4,1,1);yes(!NewsTele.active());frame("glasses","orphan",4,1,1);Handler.ready();yes(NewsTele.active()&&stops()==1);frame("glasses","orphan",6,1,1);Handler.ready();yes(voice==0&&!NewsTele.active());
  // Uncertain/disconnected ownership never releases the lane or repeatedly retries stops.
  did=start();set("phase","uncertain");NavReflect.sent.clear();yes(NewsTele.cancelTask(did));yes(stops()==0&&NewsTele.active());frame("glasses",did,6,1,1);Handler.ready();yes(voice==0);
  clear();NewsTele.start("stock manuscript",120);yes(!NewsTele.cancelTask(NewsTele.did()));yes(NewsTele.active());clear();
  System.out.println("Task prompter: "+checks+" checks passed");
 }
}
// Synthetic SDK/Android boundaries. Production framing, transfer format and NewsTele are compiled.
final class NativeTransfer {static String peer="glasses";static final Handler MAIN=new Handler();static String connected(){return peer;}static boolean acquireMessages(String owner){return !peer.isEmpty();}static void releaseMessages(String owner){}static boolean fileBusy(){return false;}}
final class BackgroundWork {static void acquire(String key,int n){}static void release(String key){}}
final class TaskAttention {static void hold(String key,long ms){}static void release(String key){}}
final class PrompterSharePort {static boolean attach(){return true;}static void detach(){}static void trace(String s){}}
final class NavReflect {interface Callback{void run(String n,Object[] args);}static final List<byte[]> sent=new ArrayList<>();static Object type(String s){return s;}static Object field(Object o,String s){return o;}static Object proxy(String s,Callback c){return c;}static Object make(String s,Object...args){return args[0];}static Object call(Object o,String s,Object...args){if(s.equals("u"))sent.add((byte[])args[0]);return s;}}
