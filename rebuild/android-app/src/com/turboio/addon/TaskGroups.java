package com.turboio.addon;

import java.util.*;

/** Workspace folders organize records without changing their original session-bound keys. */
final class TaskGroups {
 static final class Group {
  final String key,title,workspace;
  final TaskConnection connection;
  final TaskSessionDirectory.Entry entry;
  final List<TaskPresentation.Row> rows=new ArrayList<>();
  long latest;
  Group(String key,TaskConnection c,TaskSessionDirectory.Entry e){
   this.key=key;connection=c;entry=e;workspace=e==null?"":e.workspace;
   title=e==null?"历史工作区":TaskPresentation.folder(workspace);
  }
 }
 static List<Group> collect(List<TaskPresentation.Row> rows,TaskSessionDirectory directory){
  Map<String,Group> groups=new LinkedHashMap<>(),bindings=new HashMap<>();
  for(TaskPresentation.Row row:rows){
   Group group=bindings.get(row.binding);
   if(group==null){
    TaskConnection c=row.profile.connection;
    TaskSessionDirectory.Entry e=directory!=null&&c.server.equals(directory.server)&&c.owner.equals(directory.owner)?directory.find(c.route()):null;
    // A saved project id is an identity, not a filesystem path. Missing directory
    // metadata stays separate from known folders, even when their display names match.
    String key=TaskWire.hash(WireJson.bytes(Arrays.asList(c.base,c.server,c.owner,c.computer,e==null?"project":"workspace",e==null?c.project:e.workspace)));
    group=groups.get(key);
    if(group==null){group=new Group(key,c,e);groups.put(key,group);}
    bindings.put(row.binding,group);
   }
   group.rows.add(row);group.latest=Math.max(group.latest,row.order());
  }
  List<Group> ordered=new ArrayList<>(groups.values());
  ordered.sort(Comparator.comparingLong((Group g)->g.latest).reversed().thenComparing(g->g.key));
  return ordered;
 }
}
