package com.turboio.addon;
import java.io.*;
import java.nio.file.*;
import java.util.*;

/** Real policy and inbox/store integration; no SDK sends or lens-observation claims. */
final class TaskNoticeQueueTest {
 static final long NOW=AgentCardTest.NOW;
 static final class Disk implements TaskNoticeQueue.Store,AutoCloseable {
  final AtomicDocument doc;final Set<String> offered=new HashSet<>();boolean fail;
  Disk(File dir)throws Exception{doc=new AtomicDocument(new File(dir,"progress.json"));}
  public Object read()throws Exception{return doc.read();}
  public void save(Object value,String key)throws Exception{if(fail)throw new IOException("simulated write failure");doc.save(value);if(key!=null)offered.add(key);}
  public void close()throws Exception{doc.close();}
 }
 static Map<String,Object> message(TaskConnection c,int seq){Map<String,Object> n=AgentCardTest.item("message",WireJson.object("message_id","notice-"+String.format("%064x",seq),"revision",1,"task_id","same-task-id","route",c.route(),"request_id",null,"channel","progress","text","synthetic progress "+seq),seq);n.put("state","recorded");n.put("stored_at",TaskWire.now(NOW+seq));return n;}
 static TaskNotice notice(TaskConnection c,int seq){return TaskNotice.read(c,message(c,seq),AgentCardTest.task(c));}
 static void yes(boolean b){AgentCardTest.yes(b);}
 static void run(File root)throws Exception{
  TaskConnection c=AgentCardTest.connection("codex");TaskNotice a=notice(c,3),b=notice(c,4),d=notice(c,5);
  List<TaskNotice> backlog=Arrays.asList(b,a,d);File dir=new File(root,"notice-restart");dir.mkdirs();
  try(Disk disk=new Disk(dir)){
   TaskNoticeQueue q=new TaskNoticeQueue(disk);yes(q.healthy());yes(q.select(backlog,disk.offered,NOW)==d);
   yes(q.claim(d,NOW));yes(disk.offered.contains(d.key));yes(!q.claim(d,NOW));
   yes(q.select(backlog,disk.offered,NOW+1)==null);
   // Exit followed 0.3 seconds later by polling must never drain the backlog.
   q.closed(NOW+10000);yes(q.select(backlog,disk.offered,NOW+10300)==null);
   TaskNotice newer=notice(c,6);yes(q.select(Arrays.asList(a,newer),disk.offered,NOW+69999)==null);
   // Recreate the owner, then simulate a new binding: durable cursor and quiet time survive.
   q=new TaskNoticeQueue(disk);yes(q.select(Arrays.asList(newer),disk.offered,NOW+69999)==null);
   yes(q.select(Arrays.asList(newer),disk.offered,NOW+70000)==newer);
  }
  try(Disk disk=new Disk(dir)){
   TaskNoticeQueue q=new TaskNoticeQueue(disk);yes(q.select(Arrays.asList(a,b,d),Collections.emptySet(),NOW+70000)==null);
   Map<String,Object> v=WireJson.map(WireJson.read(c.encode()));v.put("producer_id","new-phone-registration");v.put("token","B".repeat(43));TaskConnection paired=TaskConnection.parse(WireJson.bytes(v),NOW);
   TaskNotice same=notice(paired,5);yes(same.scope.equals(d.scope)&&same.key.equals(d.key)&&!same.binding.equals(d.binding));
   yes(q.select(Arrays.asList(same),Collections.emptySet(),NOW+70000)==null);
   // A separate Agent/task is not discarded by the first stream's cursor, but shares cooldown.
   TaskNotice other=notice(AgentCardTest.connection("claude"),4);yes(q.select(Arrays.asList(other),Collections.emptySet(),NOW+70000)==other);
   yes(q.claim(other,NOW+70000));yes(q.select(Arrays.asList(notice(c,7)),Collections.emptySet(),NOW+70001)==null);
  }
  File migrated=new File(root,"notice-migration");migrated.mkdirs();
  try(Disk disk=new Disk(migrated)){
   TaskNoticeQueue q=new TaskNoticeQueue(disk);yes(q.select(backlog,Collections.singleton(d.legacy),NOW)==null);
   // Even a late older page without the newest item cannot resurrect its predecessors.
   yes(new TaskNoticeQueue(disk).select(Arrays.asList(a,b),Collections.emptySet(),NOW)==null);
  }
  File expiry=new File(root,"notice-expiry");expiry.mkdirs();
  try(Disk disk=new Disk(expiry)){
   Map<String,Object> exp=message(c,8);exp.put("expires_at",TaskWire.now(NOW-1));TaskNotice expired=TaskNotice.read(c,exp,AgentCardTest.task(c));
   TaskNoticeQueue q=new TaskNoticeQueue(disk);yes(q.select(Arrays.asList(a,expired),Collections.emptySet(),NOW)==null);
   yes(q.select(Arrays.asList(a,expired),Collections.singleton(expired.key),NOW)==null);
   yes(q.select(Arrays.asList(a),Collections.emptySet(),NOW)==null);
  }
  // Reproduce the real seven-second reply: the task completes before the phone
  // catches up or its previous notice cooldown ends. Explicit delivery survives.
  File completedDir=new File(root,"notice-completed-reply");completedDir.mkdirs();
  try(Disk disk=new Disk(completedDir)){
   Map<String,Object> done=AgentCardTest.task(c);done.put("state","completed");TaskWire.body(done).put("state","completed");
   TaskNotice reply=TaskNotice.read(c,message(c,20),done);TaskNoticeQueue q=new TaskNoticeQueue(disk);
   q.closed(NOW);yes(q.select(Arrays.asList(reply),disk.offered,NOW+59000)==null);
   yes(q.select(Arrays.asList(reply),disk.offered,NOW+60000)==reply);yes(q.claim(reply,NOW+60000));
   q.closed(NOW+60000);yes(new TaskNoticeQueue(disk).select(Arrays.asList(reply),disk.offered,NOW+120000)==null);
   yes(!reply.live(reply.expires));
  }
  File failure=new File(root,"notice-failure");failure.mkdirs();
  try(Disk disk=new Disk(failure)){
   TaskNoticeQueue q=new TaskNoticeQueue(disk);disk.fail=true;yes(!q.claim(d,NOW));yes(!q.healthy());yes(q.select(backlog,Collections.emptySet(),NOW)==null);yes(disk.offered.isEmpty());
  }
  TaskNoticeQueue invalid=new TaskNoticeQueue(new TaskNoticeQueue.Store(){public Object read(){return WireJson.object("schema",99);}public void save(Object v,String key){throw new AssertionError();}});
  yes(!invalid.healthy()&&invalid.select(backlog,Collections.emptySet(),NOW)==null);
  // A real mailbox and TaskApi fetch multiple pages; progress is withheld until the final page.
  File paging=new File(root,"notice-paging");paging.mkdirs();final int[] page={0};final boolean[] fail={false};
  AgentCardTest.Endpoint base=new AgentCardTest.Endpoint(c);TaskApi.Transport endpoint=new TaskApi.Transport(){public void cancel(){}public TaskApi.Response exchange(String path,byte[] payload)throws IOException{
   if(path.startsWith("/inbox")){if(fail[0])throw new IOException("TASK_UNAVAILABLE");page[0]++;boolean more=page[0]==1;List<Object> items=more?Arrays.asList(base.task,base.request,message(c,3)):Arrays.asList(message(c,4),message(c,5));return new TaskApi.Response(200,WireJson.bytes(WireJson.object("items",items,"has_more",more,"next_cursor","page-"+page[0],"server_time",TaskWire.now(NOW),"fresh_until",TaskWire.now(NOW+3000))),0);}return base.exchange(path,payload);
  }};
  try(TaskHub hub=new TaskHub(paging,TaskProfiles.empty().upsert(c,true,NOW),conn->endpoint);Disk disk=new Disk(new File(root,"notice-pages-state"))){
   TaskNoticeQueue q=new TaskNoticeQueue(disk);yes(TaskNoticeQueue.collect(hub.views()).isEmpty());hub.pump(NOW);yes(!hub.views().get(0).inboxCurrent);yes(TaskNoticeQueue.collect(hub.views()).isEmpty());
   // Pending questions are still accessible while progress waits for catch-up.
   yes(hub.views().get(0).item("request","same-question-id")!=null);
   hub.pump(NOW+1);yes(hub.views().get(0).inboxCurrent);List<TaskNotice> caught=TaskNoticeQueue.collect(hub.views());yes(caught.size()==3);TaskNotice selected=q.select(caught,Collections.emptySet(),NOW+1);yes(selected.sequence==5);yes(q.claim(selected,NOW+1));
   q.closed(NOW+10);yes(q.select(caught,Collections.emptySet(),NOW+60010)==null);
   yes(hub.views().get(0).objects.size()==5); // Original task, question and all three notices retained.
   fail[0]=true;hub.pump(NOW+4000);yes(!hub.views().get(0).inboxCurrent&&TaskNoticeQueue.collect(hub.views()).isEmpty());
   fail[0]=false;hub.pump(NOW+10000);yes(hub.views().get(0).inboxCurrent);yes(q.select(TaskNoticeQueue.collect(hub.views()),Collections.emptySet(),NOW+70000)==null);
   hub.apply(hub.profiles().enabled(c.binding(),false,NOW));yes(TaskNoticeQueue.collect(hub.views()).isEmpty());
  }
 }
}
