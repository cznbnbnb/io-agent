package com.turboio.addon;

import java.io.*;
import java.util.*;

/** One IO-thread owner; each explicit target retains its own transport, cursor and durable queue. */
final class TaskHub implements AutoCloseable {
 interface Factory {TaskApi.Transport create(TaskConnection connection)throws Exception;}
 static final class View {
  final TaskProfiles.Profile profile;final boolean inboxCurrent,sessionControl;final String binding,note;final List<Object> pending,objects;
  View(Channel c){inboxCurrent=c.api!=null&&c.api.inboxCurrent();sessionControl=c.api!=null&&c.api.sessionControl();profile=c.profile;binding=profile.binding;note=c.note;pending=c.mailbox==null?Collections.emptyList():c.mailbox.pending();List<Object> visible=new ArrayList<>();if(c.mailbox!=null)for(Object raw:c.mailbox.objects())if(TaskWire.same(TaskWire.body(WireJson.map(WireJson.map(raw).get("item"))).get("route"),profile.connection.route()))visible.add(raw);objects=Collections.unmodifiableList(visible);}
  Map<String,Object> item(String kind,String id){for(Object raw:objects){Map<String,Object> item=WireJson.map(WireJson.map(raw).get("item"));if(kind.equals(item.get("kind"))&&id.equals(item.get("object_id")))return item;}return null;}
 }
 private static final class Channel {
  TaskProfiles.Profile profile;TaskMailbox mailbox;TaskApi api;String note;
  Channel(TaskProfiles.Profile p){profile=p;note=p.enabled?"ready":"paused";}
 }
 private final Map<String,Channel> channels=new LinkedHashMap<>();private TaskProfiles profiles;
 TaskHub(File files,TaskProfiles profiles,Factory factory){
  this.profiles=profiles;
  for(TaskProfiles.Profile profile:profiles.profiles){Channel c=new Channel(profile);channels.put(profile.binding,c);
   try{c.mailbox=new TaskMailbox(files,profile.connection);c.api=new TaskApi(profile.connection,factory.create(profile.connection));if(profile.enabled&&profile.connection.expiresAt<=System.currentTimeMillis())c.note="AUTH_REQUIRED";}
   catch(Exception failure){if(c.mailbox!=null)try{c.mailbox.close();}catch(IOException ignored){}c.mailbox=null;c.api=null;c.note=TaskApi.safeError(failure);}
  }
 }
 TaskProfiles profiles(){return profiles;}
 List<View> views(){List<View> result=new ArrayList<>();for(Channel c:channels.values())result.add(new View(c));return Collections.unmodifiableList(result);}
 View view(String binding){return new View(channel(binding,false));}
 private Channel channel(String binding,boolean requireEnabled){Channel c=channels.get(binding);TaskWire.require(c!=null,"TASK_TARGET_CHANGED");if(requireEnabled){TaskWire.require(c.profile.enabled,"TASK_PAUSED");TaskWire.require(c.mailbox!=null&&c.api!=null,c.note);}return c;}
 void apply(TaskProfiles next){
  TaskWire.require(next.profiles.size()==channels.size(),"TASK_TARGET_CHANGED");
  for(TaskProfiles.Profile p:next.profiles)TaskWire.require(Arrays.equals(channel(p.binding,false).profile.connection.encode(),p.connection.encode()),"TASK_TARGET_CHANGED");
  profiles=next;for(TaskProfiles.Profile p:next.profiles){Channel c=channels.get(p.binding);c.profile=p;if(!p.enabled)c.note="paused";}
 }
 void pump(long now){pump(now,null,true);}
 boolean catchingUp(){for(Channel c:channels.values())if(c.profile.enabled&&c.api!=null&&c.api.catchingUp())return true;return false;}
 void pump(long now,TaskDevice device,boolean readInbox){for(Channel c:channels.values())if(c.profile.enabled&&c.api!=null){TaskConnection connection=c.profile.connection;
  boolean shared=device!=null&&device.owner.equals(connection.owner)&&device.server.equals(connection.server)&&device.producer.equals(connection.producer);
  try{if(shared&&readInbox)c.api.inboxChanged();c.api.pump(c.mailbox,now,readInbox||!shared);c.note=c.api.note;}catch(Exception failure){c.note=TaskApi.safeError(failure);}}}
 void receipt(String binding,Map<String,Object> request,String stage,long now)throws IOException{Channel c=channel(binding,true);c.api.receipt(request,stage,now);}
 void detail(String binding,String kind,String id,long now)throws IOException{Channel c=channel(binding,true);Map<String,Object> fresh=c.api.refresh(c.mailbox,kind,id,now);TaskWire.require(TaskWire.same(TaskWire.body(fresh).get("route"),c.profile.connection.route()),"TASK_ROUTE_MISMATCH");c.note="received";}
 void delegate(String binding,String operation,String command,long now)throws IOException{Channel c=channel(binding,true);TaskSessionDirectory.command(command);
  // Existing operations reconcile their exact bytes even when the target is now offline.
  boolean saved=false;for(Object raw:c.mailbox.pending())if(operation.equals(WireJson.map(raw).get("operation_id")))saved=true;
  if(!saved)c.api.directory(now).requireExecutable(c.profile.connection.route(),TaskSessionDirectory.elapsed());
  c.mailbox.delegate(operation,command,now,now+3600000);c.note="queued";
 }
 void control(String binding,String operation,String task,Map<String,Object> expected,String kind,String text,long now,long expires)throws IOException{
  Channel c=channel(binding,true);TaskWire.require(c.api.sessionControl(),"TASK_CONTROL_UNSUPPORTED");
  TaskWire.require(c.profile.connection.expiresAt>now,"TASK_IMPORT_EXPIRED");
  c.mailbox.control(operation,task,expected,kind,text,now,expires);c.note="queued";
 }
 void answer(String binding,String operation,String request,long revision,Object option,String text,long now)throws IOException{Channel c=channel(binding,true);c.mailbox.draftAnswer(operation,request,revision,option,text,now);c.note="awaiting_refresh";}
 void answerGlasses(String binding,String operation,String request,long revision,Object option,String text,String fingerprint,long now)throws IOException{Channel c=channel(binding,true);c.mailbox.draftAnswer(operation,request,revision,option,text,"glasses_semantic",fingerprint,now);c.note="awaiting_refresh";}
 private Map<String,Object> voiceRequest(Channel c,String id,long revision,String fingerprint,long now)throws IOException{
  TaskWire.id(id);TaskWire.positive(revision);TaskWire.require(fingerprint!=null&&fingerprint.matches("[a-f0-9]{64}"),"VOICE_REQUEST_CHANGED");
  // refresh(request) also refreshes its original parent into this same mailbox.
  Map<String,Object> fresh;
  try{fresh=c.api.refresh(c.mailbox,"request",id,now);}
  catch(IOException failure){
   // 2026-10-23 R2 (user: dictation with Wi-Fi off did not start): only an unreachable server falls back
   // to the last observed copy. The voice answer is still saved as awaiting_refresh, so the pump checks
   // the original question with the server before anything is sent; server refusals are not bypassed.
   if(!offline(failure))throw failure;
   Map<String,Object> cached=c.mailbox.cached("request",id);TaskWire.require(cached!=null,"TASK_UNAVAILABLE");fresh=TaskWire.object(cached.get("item"));
   TaskWire.require(TaskWire.canAnswer(fresh,voiceParent(c,fresh),now),"TASK_REQUEST_CLOSED");
  }
  TaskWire.require(TaskWire.same(TaskWire.body(fresh).get("route"),c.profile.connection.route()),"TASK_ROUTE_MISMATCH");
  TaskWire.require(TaskWire.positive(fresh.get("revision"))==revision&&fingerprint.equals(TaskWire.requestFingerprint(fresh)),"VOICE_REQUEST_CHANGED");
  Map<String,Object> cached=c.mailbox.cached("request",id);TaskWire.require(cached!=null,"TASK_REFRESH_REQUIRED");Map<String,Object> request=TaskWire.object(cached.get("item"));
  // A stale server response must not override a newer/closed local observation.
  TaskWire.require(TaskWire.positive(request.get("revision"))==revision&&fingerprint.equals(TaskWire.requestFingerprint(request)),"VOICE_REQUEST_CHANGED");
  return request;
 }
 static boolean offline(IOException e){return e instanceof java.net.UnknownHostException||e instanceof java.net.ConnectException||e instanceof java.net.NoRouteToHostException||e instanceof java.net.SocketTimeoutException;}
 private Map<String,Object> voiceParent(Channel c,Map<String,Object> request){
  Map<String,Object> cached=c.mailbox.cached("task",(String)TaskWire.body(request).get("task_id"));TaskWire.require(cached!=null,"TASK_REFRESH_REQUIRED");Map<String,Object> parent=TaskWire.object(cached.get("item"));
  TaskWire.require(TaskWire.same(TaskWire.body(parent).get("route"),c.profile.connection.route()),"TASK_ROUTE_MISMATCH");return parent;
 }
 void prepareVoice(String binding,String requestId,long revision,String fingerprint,VoiceAnswerSession draft,long now)throws Exception{
  Channel c=channel(binding,true);TaskWire.require(draft!=null&&draft.healthy()&&"IDLE".equals(draft.phase()),"VOICE_DRAFT_NOT_READY");
  Map<String,Object> request=voiceRequest(c,requestId,revision,fingerprint,now),parent=voiceParent(c,request);
  TaskWire.require(draft.prepare(c.profile.connection,request,parent,now),"VOICE_DRAFT_NOT_READY");c.note="voice_prepared";
 }
 void answerVoice(String binding,VoiceAnswerSession draft,long now)throws Exception{
  Channel c=channel(binding,true);TaskWire.require(draft!=null&&draft.healthy()&&TaskWire.set("REVIEW","SUBMITTING","SAVED").contains(draft.phase()),"VOICE_ANSWER_NOT_READY");
  Map<String,Object> target=WireJson.map(WireJson.map(draft.snapshot()).get("target"));TaskWire.require(binding.equals(target.get("binding")),"VOICE_TARGET_CHANGED");
  Map<String,Object> original=TaskWire.object(target.get("request"));TaskWire.require(TaskWire.same(TaskWire.body(original).get("route"),c.profile.connection.route()),"TASK_ROUTE_MISMATCH");
  Map<String,Object> request=null,parent=null;if("REVIEW".equals(draft.phase())){request=voiceRequest(c,(String)original.get("object_id"),TaskWire.positive(original.get("revision")),(String)target.get("fingerprint"),now);parent=voiceParent(c,request);}
  // SUBMITTING/SAVED replay their frozen operation locally, even if the remote
  // question has since closed or the network is down. Delivery remains the pump's job.
  Map<String,Object> saved=draft.saveAnswer(c.mailbox,request,parent,now);c.note=(String)saved.get("state");
 }
 @Override public void close()throws IOException{IOException problem=null;for(Channel c:channels.values()){if(c.api!=null)c.api.cancel();if(c.mailbox!=null)try{c.mailbox.close();}catch(IOException failure){problem=failure;}}channels.clear();if(problem!=null)throw problem;}
}
