package com.turboio.addon;

import java.util.*;

/** Real validated directory/task schemas; grouping never rewrites a route or task key. */
public final class TaskGroupsTest {
 static final long NOW=TaskConnection.stamp("2026-10-28T10:00:00Z");
 static int checks;
 static void check(boolean value,String why){checks++;if(!value)throw new AssertionError(why);}
 static String uuid(int n){return String.format(Locale.ROOT,"00000000-0000-4000-8000-%012d",n);}
 static TaskConnection connection(int n,String... changes){
  Map<String,Object> value=TaskConnectionTest.sample();value.put("session_id",uuid(n));value.put("expires_at",TaskWire.now(NOW+86400000));
  for(int i=0;i<changes.length;i+=2)value.put(changes[i],changes[i+1]);
  return TaskConnection.parse(WireJson.bytes(value),NOW);
 }
 static TaskPresentation.Source source(TaskConnection c,int count,long latest){
  List<Object> objects=new ArrayList<>();for(int i=0;i<count;i++){
   Map<String,Object> body=WireJson.object("task_id","task-"+i,"revision",1,"route",c.route(),"state","completed","command","任务 "+i,"allow_create_session",false);
   Map<String,Object> item=WireJson.object("schema_version","1.0","kind","task","object_id","task-"+i,"revision",1,"commit_seq",i+1,"stored_at",TaskWire.now(latest-i),"event_id","event-"+i,"expires_at",TaskWire.now(NOW+3600000),"state","completed","body",body);
   TaskWire.object(item);objects.add(WireJson.object("item",item,"detail_at",NOW));
  }
  return new TaskPresentation.Source(new TaskProfiles.Profile(c,true),objects,Collections.emptyList());
 }
 static Map<String,Object> entry(TaskConnection c,String path){return WireJson.object("route",c.route(),"producer_id","agent-test","device_id",uuid(800),"host_kind","codex","workspace",path,"label","测试会话","generation",1,"instance_id",uuid(801),"lease_id",uuid(802),"lease_expires_at",TaskWire.now(NOW+60000),"online",true,"busy",false,"capabilities",WireJson.object("can_execute",true,"exact_turn_interrupt",true,"descendants_proof",false,"atomic_queue_append",true,"native_queue_expiry",false),"reason",null);}
 @SafeVarargs static TaskSessionDirectory directory(TaskConnection c,Map<String,Object>... entries){return TaskSessionDirectory.fresh(WireJson.bytes(WireJson.object("schema_version","1.0","server_id",c.server,"owner_id",c.owner,"server_time",TaskWire.now(NOW),"sessions",Arrays.asList(entries),"default",WireJson.object("revision",0,"route",null,"updated_at",null))),c.server,c.owner,1000,1001);}
 static List<TaskPresentation.Row> rows(TaskPresentation.Source... sources){return new TaskPresentation(Arrays.asList(sources),NOW).rows;}
 public static void main(String[] args){
  TaskConnection codex=connection(1,"agent_id","codex","project_id","project-one"),claude=connection(2,"agent_id","claude","project_id","different-id-same-folder"),other=connection(3,"project_id","project-two");
  String folder="/Users/alice/Work/project";
  TaskSessionDirectory d=directory(codex,entry(codex,folder),entry(claude,folder),entry(other,"/Users/alice/Personal/project"));
  List<TaskPresentation.Row> input=rows(source(codex,2,NOW-50),source(claude,2,NOW-10),source(other,1,NOW-20));
  List<TaskGroups.Group> groups=TaskGroups.collect(input,d);
  check(groups.size()==2,"same absolute workspace across agents/sessions forms one group");
  TaskGroups.Group combined=groups.get(0);check(combined.rows.size()==4&&combined.workspace.equals(folder),"latest active workspace sorted first");
  check(groups.get(1).title.equals(combined.title)&&!groups.get(1).key.equals(combined.key),"same folder name does not merge different paths");
  List<TaskPresentation.Row> expected=new ArrayList<>();for(TaskPresentation.Row row:input)if(row!=groups.get(1).rows.get(0))expected.add(row);
  check(combined.rows.equals(expected),"within-group task ordering preserved");
  check(combined.rows.get(0).profile.connection==claude&&combined.rows.get(3).profile.connection==codex,"session routes remain exact");
  check(TaskGroups.collect(Collections.emptyList(),d).isEmpty(),"empty filtered results");
  check(TaskGroups.collect(Collections.singletonList(input.get(0)),d).get(0).rows.size()==1,"filtered group count is visible matching rows only");
  TaskSessionDirectory cached=TaskSessionDirectory.cached(d.encode(),codex.server,codex.owner);
  check(TaskGroups.collect(input,cached).get(0).key.equals(combined.key),"offline cached metadata keeps known workspace identity");
  Map<String,Object> offline=entry(claude,folder);offline.put("online",false);offline.put("busy",null);offline.put("reason","lease_expired");for(String cap:WireJson.map(offline.get("capabilities")).keySet())WireJson.map(offline.get("capabilities")).put(cap,false);
  check(TaskGroups.collect(input,directory(codex,entry(codex,folder),offline,entry(other,"/Users/alice/Personal/project"))).size()==2,"offline sessions group with their workspace");
  TaskConnection machine=connection(4,"computer_id","second-machine"),account=connection(1,"owner_id","another-account","agent_id","codex","project_id","project-one"),server=connection(1,"server_id","another-server","agent_id","codex","project_id","project-one"),host=connection(1,"base_url","https://other.invalid/io-api/v1","agent_id","codex","project_id","project-one");
  List<TaskPresentation.Row> scoped=rows(source(codex,1,NOW-1),source(machine,1,NOW-1),source(account,1,NOW-1),source(server,1,NOW-1),source(host,1,NOW-1));
  List<TaskGroups.Group> separated=TaskGroups.collect(scoped,directory(codex,entry(codex,folder),entry(machine,folder)));
  check(separated.size()==5,"computer/account/server/base URL boundaries never merge");
  for(TaskGroups.Group g:separated)if(g.connection==account||g.connection==server)check(g.entry==null&&g.workspace.isEmpty(),"different account/server cannot borrow directory metadata");
  TaskConnection oldA=connection(5,"agent_id","codex","project_id","old-work"),oldB=connection(6,"agent_id","claude","project_id","old-work"),oldOther=connection(7,"project_id","other-old-work");
  List<TaskPresentation.Row> old=rows(source(oldA,1,NOW-5),source(oldB,1,NOW-4),source(oldOther,1,NOW-3));
  List<TaskGroups.Group> oldGroups=TaskGroups.collect(old,d);
  check(oldGroups.size()==2,"missing sessions fall back to scoped saved project identity");
  check(oldGroups.get(1).rows.size()==2&&oldGroups.get(1).title.equals("历史工作区")&&oldGroups.get(1).workspace.isEmpty(),"fallback never invents directory from a project id");
  check(TaskGroups.collect(old,null).get(1).key.equals(oldGroups.get(1).key),"missing entire directory has same fallback");
  TaskConnection knownOld=connection(8,"project_id","old-work");
  List<TaskPresentation.Row> mixed=rows(source(oldA,1,NOW-1),source(knownOld,1,NOW-2));
  check(TaskGroups.collect(mixed,directory(codex,entry(knownOld,"/old-work"))).size()==2,"unknown workspace not guessed from another session or its basename");
  TaskConnection windows=connection(9),windowsOther=connection(10);
  TaskSessionDirectory wd=directory(windows,entry(windows,"C:\\Users\\Alice\\Work"),entry(windowsOther,"C:\\Users\\Alice\\work"));
  check(TaskGroups.collect(rows(source(windows,1,NOW),source(windowsOther,1,NOW)),wd).size()==2,"workspace identity is exact and never lowercased");
  // Collapsing/rendering does not narrow the model used for global selection and local cleanup.
  List<TaskPresentation.Source> manySources=Arrays.asList(source(codex,75,NOW-1),source(claude,4,NOW-2),source(other,8,NOW-3));
  TaskPresentation presentation=new TaskPresentation(manySources,NOW);TaskLibrary library=new TaskLibrary(Collections.emptySet(),Collections.emptySet());library.update(presentation,manySources,row->row.profile.connection.project);
  List<TaskPresentation.Row> all=library.filter("all","",false,false);List<TaskGroups.Group> many=TaskGroups.collect(all,d);
  check(many.size()==2&&many.get(0).rows.size()==79,"group retains all rows beyond page limit");
  library.selectAll(all);check(library.selection().size()==87,"full-filter select includes collapsed groups and unrendered rows");
  Set<String> allKeys=new LinkedHashSet<>(library.selection());library.setFavorite(allKeys,true);check(library.filter("all","",true,false).size()==87,"bulk favorite retains exact session keys");
  check(library.delete(allKeys)==87&&library.filter("all","",false,false).isEmpty(),"delete covers full-filter selection");
  library.restore(allKeys);check(library.filter("all","",false,false).size()==87,"restore retains folder membership and all records");
  String one=codex.binding()+"/task-0",otherSession=claude.binding()+"/task-0";library.delete(Collections.singleton(one));check(library.deleted(one)&&!library.deleted(otherSession),"same task id in same folder stays session isolated");
  System.out.println("Task workspace groups: "+checks+" checks passed (cross-Agent folders, scope isolation, exact history fallback, sort, full-filter actions)");
 }
}
