package com.turboio.addon;

import java.util.*;

/** Best-effort progress display, never the question/answer queue. History stays in the mailbox. */
final class TaskNoticeQueue {
 interface Store {Object read()throws Exception;void save(Object value,String offeredKey)throws Exception;}
 static final long QUIET_MS=60000,MAX_DISPLAY_MS=180000;
 private final Store store;private Map<String,Object> state;private boolean healthy=true;
 TaskNoticeQueue(Store store){this.store=store;try{Object raw=store.read();state=raw==null?WireJson.object("schema",1,"quiet_until",0,"streams",new TreeMap<>()):WireJson.map(raw);validate(state);}catch(Exception invalid){healthy=false;}}
 private static void validate(Map<String,Object> s){
  TaskWire.require(TaskWire.positive(s.get("schema"))==1,"TASK_NOTICE_QUEUE_INVALID");TaskWire.nonnegative(s.get("quiet_until"));Map<String,Object> streams=WireJson.map(s.get("streams"));TaskWire.require(streams.size()<=500,"TASK_NOTICE_QUEUE_FULL");
  for(Map.Entry<String,Object> e:streams.entrySet()){TaskWire.require(e.getKey().matches("[a-f0-9]{64}"),"TASK_NOTICE_QUEUE_INVALID");Map<String,Object> row=WireJson.map(e.getValue());TaskWire.positive(row.get("sequence"));TaskWire.positive(row.get("until"));}
 }
 boolean healthy(){return healthy;}
 private Map<String,Object> copy(){return WireJson.map(WireJson.copy(state));}
 private boolean save(Map<String,Object> next,String key){try{validate(next);store.save(next,key);state=next;return true;}catch(Exception failed){healthy=false;return false;}}
 private static long sequence(Map<String,Object> s,String scope){Object raw=WireJson.map(s.get("streams")).get(scope);return raw==null?0:TaskWire.positive(WireJson.map(raw).get("sequence"));}
 private static void advance(Map<String,Object> s,TaskNotice n){Map<String,Object> streams=WireJson.map(s.get("streams"));Object old=streams.get(n.scope);long until=old==null?n.retainUntil:Math.max(n.retainUntil,TaskWire.positive(WireJson.map(old).get("until")));streams.put(n.scope,WireJson.object("sequence",Math.max(sequence(s,n.scope),n.sequence),"until",until));}
 /** Only fully caught-up routes may contribute progress; questions use their separate path. */
 static List<TaskNotice> collect(List<TaskHub.View> contexts){
  List<TaskNotice> candidates=new ArrayList<>();
  for(TaskHub.View c:contexts)if(c.profile.enabled&&c.inboxCurrent)for(Object raw:c.objects){
   Map<String,Object> item=WireJson.map(WireJson.map(raw).get("item"));if(!"message".equals(item.get("kind")))continue;
   try{candidates.add(TaskNotice.read(c.profile.connection,item,c.item("task",(String)TaskWire.body(item).get("task_id"))));}
   catch(RuntimeException unrelated){/* All original messages remain in phone history. */}
  }return candidates;
 }
 /** Pick the newest per task BEFORE checking offered/expiry. Never fall back to an older notice. */
 TaskNotice select(List<TaskNotice> candidates,Set<String> offered,long now){
  if(!healthy)return null;Map<String,Object> next=copy();WireJson.map(next.get("streams")).entrySet().removeIf(e->TaskWire.positive(WireJson.map(e.getValue()).get("until"))<=now);
  Map<String,TaskNotice> latest=new TreeMap<>();
  for(TaskNotice n:candidates){
   if(n.retainUntil<=now)continue;
   // Import old display keys, including expired notices, without reoffering their predecessors.
   if(offered.contains(n.key)||offered.contains(n.legacy))advance(next,n);
   TaskNotice old=latest.get(n.scope);if(old==null||n.sequence>old.sequence)latest.put(n.scope,n);
  }
  if(!TaskWire.same(state,next)&&!save(next,null))return null;
  if(now<TaskWire.nonnegative(state.get("quiet_until")))return null;
  TaskNotice choice=null;for(TaskNotice n:latest.values())if(n.live(now)&&n.sequence>sequence(state,n.scope)){
   if(choice==null||n.stored>choice.stored||n.stored==choice.stored&&n.key.compareTo(choice.key)>0)choice=n;
  }return choice;
 }
 /** Save before any SDK side effect. An interrupted/uncertain attempt is never automatically replayed. */
 boolean claim(TaskNotice n,long now){
  if(!healthy||!n.live(now)||now<TaskWire.nonnegative(state.get("quiet_until"))||n.sequence<=sequence(state,n.scope))return false;
  Map<String,Object> next=copy();advance(next,n);next.put("quiet_until",now+MAX_DISPLAY_MS+QUIET_MS);return save(next,n.key);
 }
 /** Also called after a question's exit; its recording/confirm path remains independent. */
 void closed(long now){if(healthy){Map<String,Object> next=copy();next.put("quiet_until",now+QUIET_MS);save(next,null);}}
}
