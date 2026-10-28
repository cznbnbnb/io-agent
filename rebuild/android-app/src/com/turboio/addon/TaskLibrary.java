package com.turboio.addon;

import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.function.Function;

/** Local task-list organization. The mailbox, computer session and execution are never modified. */
final class TaskLibrary {
 private final Set<String> favorites,deleted,selected=new LinkedHashSet<>(),pending=new HashSet<>();
 private final Map<String,String> search=new HashMap<>();
 private TaskPresentation presentation;

 /** The caller owns the two typed preference sets and persists snapshots after an explicit action. */
 TaskLibrary(Set<String> favorites,Set<String> deleted){this.favorites=new HashSet<>(favorites);this.deleted=new HashSet<>(deleted);}
 Set<String> favorites(){return new HashSet<>(favorites);}
 Set<String> deleted(){return new HashSet<>(deleted);}
 Set<String> selection(){return new LinkedHashSet<>(selected);}
 boolean favorite(String key){return favorites.contains(key);}
 boolean deleted(String key){return deleted.contains(key);}
 boolean selected(String key){return selected.contains(key);}
 void setFavorite(Collection<String> keys,boolean value){if(value)favorites.addAll(keys);else favorites.removeAll(keys);}
 void restore(Collection<String> keys){deleted.removeAll(keys);selected.removeAll(keys);}
 void toggle(String key){if(!selected.remove(key))selected.add(key);}
 void clearSelection(){selected.clear();}
 void selectAll(List<TaskPresentation.Row> rows){selected.clear();for(TaskPresentation.Row row:rows)selected.add(row.key);}
 void retainVisible(List<TaskPresentation.Row> rows){Set<String> visible=new HashSet<>();for(TaskPresentation.Row row:rows)visible.add(row.key);selected.retainAll(visible);}

 /** Rebuild once for a new mailbox snapshot, not for each search keystroke. Inputs already passed
  * the mailbox schema. A binding hashes server, account, producer and full route, not a display name. */
 void update(TaskPresentation presentation,List<TaskPresentation.Source> sources,Function<TaskPresentation.Row,String> extraText){
  this.presentation=presentation;pending.clear();search.clear();Map<String,StringBuilder> text=new HashMap<>();
  for(TaskPresentation.Row row:presentation.rows)text.put(row.key,new StringBuilder(row.command()).append('\n').append(extraText.apply(row)));
  for(TaskPresentation.Source source:sources){
   for(Object raw:source.objects){Map<String,Object> item=WireJson.map(WireJson.map(raw).get("item"));
    if(!"message".equals(item.get("kind")))continue;Map<String,Object> body=TaskWire.body(item);StringBuilder target=text.get(source.profile.binding+"/"+body.get("task_id"));
    if(target!=null)target.append('\n').append(body.get("text"));
   }
   for(Object raw:source.pending){Map<String,Object> local=WireJson.map(raw);
    if(!Boolean.TRUE.equals(local.get("needs_lookup"))&&TaskWire.set("server_stored","expired","withdrawn_local").contains(local.get("state")))continue;
    Map<String,Object> event=WireJson.map(WireJson.read(((String)local.get("payload")).getBytes(StandardCharsets.UTF_8)));
    String kind=(String)event.get("kind");if("task".equals(kind)||"answer".equals(kind))pending.add(source.profile.binding+"/"+TaskWire.body(event).get("task_id"));
   }
  }
  for(TaskPresentation.Question question:presentation.questions)pending.add(question.binding+"/"+question.taskId);
  for(Map.Entry<String,StringBuilder> entry:text.entrySet())search.put(entry.getKey(),entry.getValue().toString().toLowerCase(Locale.ROOT));
  selected.retainAll(text.keySet());
 }
 List<TaskPresentation.Row> filter(String state,String query,boolean favoritesOnly,boolean deletedOnly){
  String needle=query.trim().toLowerCase(Locale.ROOT);List<TaskPresentation.Row> out=new ArrayList<>();
  if(presentation==null)return out;
  for(TaskPresentation.Row row:presentation.filter(state))if(deleted.contains(row.key)==deletedOnly&&(!favoritesOnly||favorites.contains(row.key))&&(needle.isEmpty()||search.get(row.key).contains(needle)))out.add(row);
  return out;
 }
 /** Offline/expired records may be removed from this phone, without claiming the computer stopped.
  * Unsent input and unanswered questions stay reachable even when the task is otherwise ended. */
 boolean canDelete(TaskPresentation.Row row){
  return !deleted.contains(row.key)&&!pending.contains(row.key)&&(!row.active()||presentation.expired(row));
 }
 int delete(Collection<String> keys){
  int count=0;for(String key:keys){TaskPresentation.Row row=presentation.find(key);if(row!=null&&canDelete(row)&&deleted.add(key))count++;}
  selected.removeAll(deleted);return count;
 }
}
