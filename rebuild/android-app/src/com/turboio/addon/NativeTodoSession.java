package com.turboio.addon;

import java.util.*;

/** One native suggestion, with a durable decision and write intent. A restart
 * never interprets a displayed card as acceptance or replays a possible write. */
final class NativeTodoSession {
 interface Store {Object read()throws Exception;void save(Object value)throws Exception;}
 static final String UID_PREFIX="io-todo-";
 static final class Proposal {
  final String id,content,source,state;final long expires;
  Proposal(Object raw){Map<String,Object> m=WireJson.map(raw);TaskWire.require("1.0".equals(m.get("schema_version")),"TODO_RESPONSE_INVALID");
   id=TaskWire.text(m.get("proposal_id"),69,false);content=TaskWire.text(m.get("content"),48,false);source=TaskWire.text(m.get("source"),20,false);state=TaskWire.text(m.get("state"),32,false);expires=TaskWire.stamp(m.get("expires_at"));
   TaskWire.require(id.matches("todo-[a-f0-9]{64}")&&!content.matches("(?s).*[\\r\\n].*")&&TaskWire.set("pending_confirmation","shown","accepted","creating","created","declined","expired","failed","unknown").contains(state),"TODO_RESPONSE_INVALID");}
  Map<String,Object> json(){return WireJson.object("schema_version","1.0","proposal_id",id,"content",content,"source",source,"state",state,"expires_at",java.time.Instant.ofEpochMilli(expires).toString());}
 }
 private final Store store;private Map<String,Object> record;private Proposal proposal;private boolean healthy=true;
 NativeTodoSession(Store store)throws Exception{
  this.store=store;Object raw=store.read();if(raw==null)return;record=WireJson.map(raw);
  TaskWire.require(Long.valueOf(1).equals(record.get("schema")),"TODO_JOURNAL_INVALID");proposal=new Proposal(record.get("proposal"));
  for(String k:new String[]{"phase","phone","account","peer","native_id","error"})TaskWire.text(record.get(k),512,true);
  TaskWire.nonnegative(record.get("generation"));TaskWire.require(TaskWire.set("SHOWN","ACCEPTED","DECLINED","CREATING","CREATED","FAILED","UNKNOWN","CLOSED").contains(phase()),"TODO_JOURNAL_INVALID");
  if(phase().equals("SHOWN"))fail("TODO_DISPLAY_INTERRUPTED");
  else if(phase().equals("CREATING"))unknown("TODO_WRITE_INTERRUPTED");
 }
 boolean active(){return record!=null&&!phase().equals("CLOSED");}
 boolean healthy(){return healthy;}
 private void save()throws Exception{TaskWire.require(healthy,"TODO_STORAGE_UNCERTAIN");try{store.save(record);}catch(Exception failed){healthy=false;throw failed;}}
 String phase(){return record==null?"EMPTY":(String)record.get("phase");}
 Proposal proposal(){return proposal;}
 String id(){return proposal().id;}String uid(){return UID_PREFIX+id().substring(5,37);}
 String account(){return (String)record.get("account");}String phone(){return (String)record.get("phone");}String peer(){return (String)record.get("peer");}
 long generation(){return TaskWire.nonnegative(record.get("generation"));}
 String nativeId(){return (String)record.get("native_id");}String error(){return (String)record.get("error");}
 void shown(Proposal p,String phone,String account,String peer,long generation)throws Exception{
  TaskWire.require(!active()&&p.state.equals("pending_confirmation"),"TODO_BUSY");
  proposal=p;record=WireJson.object("schema",1L,"proposal",p.json(),"phone",phone,"account",account,"peer",peer,"generation",generation,"phase","SHOWN","native_id","","error","");save();
 }
 boolean operate(String peer,long generation,byte[] bytes,long now)throws Exception{
  if(!phase().equals("SHOWN")||!peer().equals(peer)||generation()!=generation||proposal().expires<=now)return false;
  OtaFrame frame=OtaFrame.decode(bytes);if(frame.type!=34||frame.binary.length!=0)return false;
  Map<String,Object> body=BoundedJson.map(frame.json);BoundedJson.keys(body,"suggestUID","suggestType","cmd");
  if(!uid().equals(body.get("suggestUID"))||BoundedJson.number(body.get("suggestType"),2,2)!=2)return false;
  int cmd=BoundedJson.number(body.get("cmd"),1,2);record.put("phase",cmd==1?"ACCEPTED":"DECLINED");save();return true;
 }
 void creating()throws Exception{TaskWire.require(phase().equals("ACCEPTED"),"TODO_NOT_ACCEPTED");record.put("phase","CREATING");save();}
 void created(String id)throws Exception{TaskWire.require(phase().equals("CREATING"),"TODO_STATE_INVALID");record.put("native_id",id);record.put("phase","CREATED");save();}
 void fail(String code)throws Exception{record.put("phase","FAILED");record.put("error",code);save();}
 void unknown(String code)throws Exception{record.put("phase","UNKNOWN");record.put("error",code);save();}
 void closed()throws Exception{record.put("phase","CLOSED");save();}
 static boolean owns(byte[] bytes){
  try{OtaFrame f=OtaFrame.decode(bytes);if(f.type!=34||f.binary.length!=0)return false;Object id=BoundedJson.map(f.json).get("suggestUID");return id instanceof String&&((String)id).matches("io-todo-[a-f0-9]{32}");}
  catch(RuntimeException malformed){return false;}
 }
}
