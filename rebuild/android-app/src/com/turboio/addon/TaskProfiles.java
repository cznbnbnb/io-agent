package com.turboio.addon;

import java.util.*;

/** Explicit registered targets. Selection is only an outgoing default, never an answer route. */
final class TaskProfiles {
 static final int MAX=16,MAX_BYTES=196608;
 static final String FORMAT="io-agent-task-profiles/2";
 static final class Profile {
  final String binding;final TaskConnection connection;final boolean enabled;
  Profile(TaskConnection c,boolean enabled){connection=c;binding=c.binding();this.enabled=enabled;}
 }
 final String selected;final List<Profile> profiles;
 private TaskProfiles(String selected,List<Profile> profiles){
  TaskWire.require(profiles.size()<=MAX,"TASK_PROFILES_FULL");Set<String> seen=new HashSet<>();
  for(Profile p:profiles)TaskWire.require(seen.add(p.binding),"TASK_CONFIG_INVALID");
  TaskWire.require(profiles.isEmpty()?selected.isEmpty():seen.contains(selected),"TASK_CONFIG_INVALID");
  this.selected=selected;this.profiles=Collections.unmodifiableList(new ArrayList<>(profiles));
 }
 static TaskProfiles empty(){return new TaskProfiles("",Collections.emptyList());}
 Profile get(String binding){for(Profile p:profiles)if(p.binding.equals(binding))return p;throw new IllegalArgumentException("TASK_TARGET_CHANGED");}
 Profile selected(){return profiles.isEmpty()?null:get(selected);}
 static TaskProfiles decode(byte[] bytes){
  Map<String,Object> value=WireJson.map(WireJson.read(bytes,MAX_BYTES,20000));
  if(value.containsKey("connection")){
   BoundedJson.keys(value,"connection","enabled");TaskWire.require(value.get("enabled") instanceof Boolean,"TASK_CONFIG_INVALID");
   Profile p=new Profile(TaskConnection.parse(WireJson.bytes(value.get("connection")),0),Boolean.TRUE.equals(value.get("enabled")));
   return new TaskProfiles(p.binding,Collections.singletonList(p));
  }
  BoundedJson.keys(value,"format","selected","profiles");TaskWire.require(FORMAT.equals(value.get("format"))&&value.get("selected") instanceof String,"TASK_CONFIG_INVALID");
  List<Object> raw=WireJson.list(value.get("profiles"));TaskWire.require(raw.size()<=MAX,"TASK_PROFILES_FULL");List<Profile> profiles=new ArrayList<>();
  for(Object r:raw){Map<String,Object> row=WireJson.map(r);BoundedJson.keys(row,"binding","connection","enabled");TaskWire.require(row.get("enabled") instanceof Boolean,"TASK_CONFIG_INVALID");Profile p=new Profile(TaskConnection.parse(WireJson.bytes(row.get("connection")),0),Boolean.TRUE.equals(row.get("enabled")));TaskWire.require(p.binding.equals(row.get("binding")),"TASK_CONFIG_INVALID");profiles.add(p);}
  return new TaskProfiles((String)value.get("selected"),profiles);
 }
 byte[] encode(){List<Object> rows=new ArrayList<>();for(Profile p:profiles)rows.add(WireJson.object("binding",p.binding,"connection",WireJson.read(p.connection.encode()),"enabled",p.enabled));byte[] result=WireJson.bytes(WireJson.object("format",FORMAT,"selected",selected,"profiles",rows));TaskWire.require(result.length<=MAX_BYTES,"TASK_CONFIG_INVALID");return result;}
 TaskProfiles upsert(TaskConnection c,boolean enabled,long now){
  return upsert(c,enabled,now,true);
 }
 /** New UI callers opt into changing the outgoing default explicitly. Keep the
  * v2 invariant (a non-empty registry has a selected target) for rollback hosts. */
 TaskProfiles upsert(TaskConnection c,boolean enabled,long now,boolean makeDefault){
  TaskWire.require(makeDefault||!selected.isEmpty(),"TASK_DEFAULT_REQUIRED");
  TaskWire.require(!enabled||c.expiresAt>now,"TASK_IMPORT_EXPIRED");Profile next=new Profile(c,enabled);List<Profile> rows=new ArrayList<>();boolean replaced=false;
  for(Profile p:profiles){if(p.binding.equals(next.binding)){rows.add(next);replaced=true;}else rows.add(p);}if(!replaced)rows.add(next);return new TaskProfiles(makeDefault?next.binding:selected,rows);
 }
 TaskProfiles select(String binding){get(binding);return new TaskProfiles(binding,profiles);}
 /** Frees a slot held by an expired registration. The current default target is
  * never removed, and its mailbox files are left on disk for the same binding. */
 TaskProfiles remove(String binding,long now){
  Profile prior=get(binding);TaskWire.require(!binding.equals(selected),"TASK_TARGET_SELECTED");TaskWire.require(prior.connection.expiresAt<=now,"TASK_PROFILE_ACTIVE");
  List<Profile> rows=new ArrayList<>();for(Profile p:profiles)if(!p.binding.equals(binding))rows.add(p);return new TaskProfiles(selected,rows);
 }
 /** Frees a slot held by an idle session connection derived from the paired device (TaskDevice);
  * its mailbox files stay on disk and a later join of the same session finds them again. */
 TaskProfiles drop(String binding){
  get(binding);TaskWire.require(!binding.equals(selected),"TASK_TARGET_SELECTED");
  List<Profile> rows=new ArrayList<>();for(Profile p:profiles)if(!p.binding.equals(binding))rows.add(p);return new TaskProfiles(selected,rows);
 }
 TaskProfiles enabled(String binding,boolean enabled,long now){
  Profile prior=get(binding);TaskWire.require(!enabled||prior.connection.expiresAt>now,"TASK_IMPORT_EXPIRED");List<Profile> rows=new ArrayList<>();for(Profile p:profiles)rows.add(p.binding.equals(binding)?new Profile(p.connection,enabled):p);return new TaskProfiles(selected,rows);
 }
}
