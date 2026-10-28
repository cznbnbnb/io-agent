package com.turboio.addon;

import java.nio.charset.StandardCharsets;
import java.util.*;

/** Real mailbox schemas, synthetic tasks: local organization never controls or edits a remote task. */
public final class TaskLibraryTest {
 private static final long NOW=TaskConnection.stamp("2026-10-28T10:00:00Z");
 private static int checks;
 private static void check(boolean value,String name){checks++;if(!value)throw new AssertionError(name);}
 private static TaskConnection connection(String session,String owner){Map<String,Object> value=TaskConnectionTest.sample();value.put("session_id",session);value.put("owner_id",owner);value.put("expires_at",TaskWire.now(NOW+86400000));return TaskConnection.parse(WireJson.bytes(value),NOW);}
 private static Map<String,Object> task(TaskConnection c,String id,String state){Map<String,Object> body=WireJson.object("task_id",id,"revision",1,"route",c.route(),"state",state,"command","整理讨论 "+id+"\n完整条件 ORIGINAL","allow_create_session",false);if(TaskWire.set("stop_requested","stop_unconfirmed","stopped","resume_requested").contains(state))body.put("execution",WireJson.object("command_id",UUID.randomUUID().toString(),"turn_id","turn-"+id,"phase",state.equals("resume_requested")?"stopped":state));return item("task",body);}
 private static Map<String,Object> item(String kind,Map<String,Object> body){Map<String,Object> item=WireJson.object("schema_version","1.0","kind",kind,"object_id",TaskWire.objectId(kind,body),"revision",TaskWire.revision(kind,body),"commit_seq",1,"stored_at",TaskWire.now(NOW-1),"event_id","event-"+UUID.randomUUID(),"expires_at",TaskWire.now(NOW+3600000),"state",kind.equals("message")?"recorded":body.get("state"),"body",body);TaskWire.object(item);return item;}
 private static Map<String,Object> local(String kind,Map<String,Object> body,String state){Map<String,Object> event=TaskWire.envelope(kind,"phone-test",body,UUID.randomUUID().toString(),NOW,NOW+3600000);return WireJson.object("payload",new String(WireJson.bytes(event),StandardCharsets.UTF_8),"state",state,"error","");}
 private static TaskPresentation.Source source(TaskConnection c,List<Map<String,Object>> items,List<Object> pending){List<Object> objects=new ArrayList<>();for(Map<String,Object> i:items)objects.add(WireJson.object("item",i,"detail_at",NOW));return new TaskPresentation.Source(new TaskProfiles.Profile(c,true),objects,pending);}
 private static TaskPresentation update(TaskLibrary library,List<TaskPresentation.Source> sources){TaskPresentation p=new TaskPresentation(sources,NOW);library.update(p,sources,row->"Codex 工作 Mac 会话：产品讨论 "+row.state);return p;}
 private static TaskLibrary empty(){return new TaskLibrary(Collections.emptySet(),Collections.emptySet());}
 public static void main(String[] args){
  TaskConnection a=connection("session-a","owner-a"),b=connection("session-b","owner-a"),foreign=connection("session-a","owner-b");
  String key=a.binding()+"/same",other=b.binding()+"/same",foreignKey=foreign.binding()+"/same";
  Map<String,Object> completed=task(a,"same","completed");
  Map<String,Object> result=item("message",WireJson.object("message_id","result-a","revision",1,"route",a.route(),"task_id","same","channel","result","text","最终结果：ALPHA 完整原文"));
  List<TaskPresentation.Source> sources=Arrays.asList(source(a,Arrays.asList(completed,result,task(a,"live","running")),Collections.emptyList()),source(b,Arrays.asList(task(b,"same","completed")),Collections.emptyList()),source(foreign,Arrays.asList(task(foreign,"same","completed")),Collections.emptyList()));
  byte[] original=WireJson.bytes(sources.get(0).objects);TaskLibrary library=empty();TaskPresentation p=update(library,sources);
  check(library.filter("all","",false,false).size()==4,"all ordinary tasks");
  check(library.filter("running","",false,false).size()==1,"status filter retained");
  check(library.filter("all","original",false,false).size()==4,"full command search case folded");
  check(library.filter("all"," alpha ",false,false).size()==1,"full result search trimmed case folded");
  check(library.filter("all","工作 mac",false,false).size()==4,"extra agent session text searchable");
  check(library.filter("all","missing",false,false).isEmpty(),"no matches");
  check(library.filter("all","",true,false).isEmpty(),"empty favorites");
  library.setFavorite(Arrays.asList(key),true);check(library.favorite(key)&&!library.favorite(other)&&!library.favorite(foreignKey),"favorite scoped to session and account");
  check(library.filter("all","",true,false).size()==1,"favorite filter");
  Set<String> favorites=library.favorites();favorites.clear();check(library.favorite(key),"preference snapshot detached");
  library.toggle(key);library.toggle(other);check(library.selection().size()==2,"multi select");library.toggle(other);check(library.selection().equals(new LinkedHashSet<>(Arrays.asList(key))),"unselect exact task");
  check(library.canDelete(p.find(key)),"completed removable");check(!library.canDelete(p.find(a.binding()+"/live")),"active task protected");
  check(library.delete(Arrays.asList(key,a.binding()+"/live","missing"))==1,"mixed delete skips running and absent");
  check(library.selection().isEmpty(),"deleted selection cleared");check(library.filter("all","",false,false).size()==3,"removed from normal view");check(library.filter("all","",false,true).size()==1,"deleted view");
  check(library.favorite(key),"favorite preserved for restore");check(library.delete(Arrays.asList(key))==0,"repeat delete idempotent");
  TaskLibrary reopened=new TaskLibrary(library.favorites(),library.deleted());update(reopened,sources);check(reopened.deleted(key)&&reopened.favorite(key),"restart persists local state");
  check(reopened.filter("all","alpha",false,false).isEmpty()&&reopened.filter("all","alpha",false,true).size()==1,"deleted search honors view");
  reopened.restore(Arrays.asList(key));check(reopened.filter("all","",true,false).size()==1,"restore with favorite");
  reopened.setFavorite(Arrays.asList(key),false);check(reopened.filter("all","",true,false).isEmpty(),"remove favorite");
  check(Arrays.equals(original,WireJson.bytes(sources.get(0).objects)),"local actions never mutate mailbox facts");
  Map<String,Object> renewed=WireJson.map(WireJson.read(a.encode()));renewed.put("expires_at",TaskWire.now(NOW+172800000));renewed.put("token","BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB");check(TaskConnection.parse(WireJson.bytes(renewed),NOW).binding().equals(a.binding()),"token renewal does not lose favorites");
  List<Map<String,Object>> many=new ArrayList<>();for(int i=0;i<75;i++)many.add(task(a,"page-"+i,"completed"));
  update(library,Arrays.asList(source(a,many,Collections.emptyList())));List<TaskPresentation.Row> all=library.filter("completed","",false,false);library.selectAll(all);check(library.selection().size()==75,"select all exceeds first page");
  List<TaskPresentation.Row> narrow=library.filter("completed","page-7",false,false);library.retainVisible(narrow);check(library.selection().size()==6,"search does not leave hidden selections");library.clearSelection();check(library.selection().isEmpty(),"back clears selection");
  library.selectAll(all);update(library,Arrays.asList(source(a,many.subList(0,2),Collections.emptyList())));check(library.selection().size()==2,"refresh removes vanished selections");
  check(library.filter("all","alpha",false,false).isEmpty(),"refresh removes old search result index");
  // Every terminal state is removable, but each kind of unconfirmed input keeps its task accessible.
  for(String state:Arrays.asList("completed","cancelled","failed","expired")){
   TaskLibrary model=empty();TaskPresentation view=update(model,Arrays.asList(source(a,Arrays.asList(task(a,"end",state)),Collections.emptyList())));check(model.canDelete(view.rows.get(0)),"terminal "+state);
  }
  for(String state:Arrays.asList("queued","agent_received","running","waiting_answer","execution_unknown","stop_requested","stop_unconfirmed","stopped","resume_requested")){
   TaskLibrary model=empty();TaskPresentation view=update(model,Arrays.asList(source(a,Arrays.asList(task(a,"active",state)),Collections.emptyList())));check(!model.canDelete(view.rows.get(0)),"protect "+state);
  }
  for(String state:Arrays.asList("queued","sending","retry_wait","reconcile","blocked","awaiting_refresh","awaiting_target")){
   TaskLibrary model=empty();Map<String,Object> queued=local("task",TaskWire.body(completed),state);TaskPresentation view=update(model,Arrays.asList(source(a,Arrays.asList(completed),Arrays.asList(queued))));check(!model.canDelete(view.find(key)),"unsent "+state);
  }
  for(String state:Arrays.asList("server_stored","expired","withdrawn_local")){
   TaskLibrary model=empty();Map<String,Object> queued=local("task",TaskWire.body(completed),state);TaskPresentation view=update(model,Arrays.asList(source(a,Arrays.asList(completed),Arrays.asList(queued))));check(model.canDelete(view.find(key)),"settled input "+state);
   queued.put("needs_lookup",true);view=update(model,Arrays.asList(source(a,Arrays.asList(completed),Arrays.asList(queued))));check(!model.canDelete(view.find(key)),"unknown input "+state);
  }
  Map<String,Object> answer=WireJson.object("answer_id","answer-a","request_id","q-a","request_revision",1,"task_id","same","route",a.route(),"option_id",null,"text","我的回答","input_source","phone","raw_action",null);
  TaskLibrary answerModel=empty();TaskPresentation answerView=update(answerModel,Arrays.asList(source(a,Arrays.asList(completed),Arrays.asList(local("answer",answer,"sending")))));check(!answerModel.canDelete(answerView.find(key)),"pending answer protects ended task");
  TaskLibrary unrelated=empty();TaskPresentation unrelatedView=update(unrelated,Arrays.asList(source(a,Arrays.asList(completed),Arrays.asList(local("task",TaskWire.body(task(a,"other","queued")),"queued")))));check(unrelated.canDelete(unrelatedView.find(key)),"different pending task does not block cleanup");
  // Offline classification permits local cleanup, not a claim that an original execution stopped.
  Map<String,Object> orphan=task(a,"orphan","running");orphan.put("stored_at",TaskWire.now(NOW-TaskPresentation.ORPHAN_GRACE-1));
  List<TaskPresentation.Source> orphanSources=Arrays.asList(source(a,Arrays.asList(orphan),Collections.emptyList()));TaskPresentation orphanView=new TaskPresentation(orphanSources,NOW,new HashSet<>(Arrays.asList(a.binding())));TaskLibrary orphanModel=empty();orphanModel.update(orphanView,orphanSources,row->"");
  check(orphanModel.canDelete(orphanView.rows.get(0)),"orphan local record removable");check(orphanModel.delete(Arrays.asList(a.binding()+"/orphan"))==1&&"running".equals(orphan.get("state")),"orphan cleanup does not cancel execution");
  Map<String,Object> question=item("request",WireJson.object("request_id","q-orphan","revision",1,"route",a.route(),"task_id","orphan","state","pending","mode","free_text","question","需要确认","options",Collections.emptyList()));
  orphanSources=Arrays.asList(source(a,Arrays.asList(orphan,question),Collections.emptyList()));orphanView=new TaskPresentation(orphanSources,NOW,new HashSet<>(Arrays.asList(a.binding())));orphanModel=empty();orphanModel.update(orphanView,orphanSources,row->"");check(!orphanModel.canDelete(orphanView.rows.get(0)),"orphan with unanswered question protected");
  System.out.println("Task library: "+checks+" checks passed (scoped favorite/delete/restore, searchable full text, full-filter selection, pending-input protection, unchanged execution)");
 }
}
