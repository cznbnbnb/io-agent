package com.turboio.addon;
import java.util.*;

public final class NativeTodoSessionTest {
 static int checks;static void yes(boolean value){checks++;if(!value)throw new AssertionError("check "+checks);}
 static final class Memory implements NativeTodoSession.Store {Object value;boolean fail;public Object read(){return value==null?null:WireJson.copy(value);}public void save(Object value)throws Exception{if(fail)throw new java.io.IOException("synthetic storage error");this.value=WireJson.copy(value);}}
 static NativeTodoSession.Proposal proposal(){return new NativeTodoSession.Proposal(WireJson.object("schema_version","1.0","proposal_id","todo-"+"a".repeat(64),"content","合成待办","source","Codex","state","pending_confirmation","expires_at","2030-01-01T00:00:00Z"));}
 static byte[] operation(String uid,int cmd){return OtaFrame.encode(34,WireJson.object("suggestUID",uid,"suggestType",2,"cmd",cmd),null);}
 public static void main(String[] args)throws Exception{
  Memory store=new Memory();NativeTodoSession s=new NativeTodoSession(store);yes(!s.active());
  s.shown(proposal(),"phone","account","peer",4);yes(s.phase().equals("SHOWN"));String uid=s.uid();
  yes(NativeTodoSession.owns(operation(uid,1)));yes(!NativeTodoSession.owns(operation("stock-owned",1)));
  yes(!s.operate("different",4,operation(uid,1),100));yes(!s.operate("peer",5,operation(uid,1),100));yes(!s.operate("peer",4,operation("io-todo-"+"b".repeat(32),1),100));yes(s.phase().equals("SHOWN"));
  yes(s.operate("peer",4,operation(uid,1),100));yes(s.phase().equals("ACCEPTED"));yes(!s.operate("peer",4,operation(uid,1),100));
  s=new NativeTodoSession(store);yes(s.phase().equals("ACCEPTED"));s.creating();yes(s.phase().equals("CREATING"));
  NativeTodoSession recovered=new NativeTodoSession(store);yes(recovered.phase().equals("UNKNOWN"));yes(recovered.nativeId().isEmpty());
  boolean blocked=false;try{recovered.creating();}catch(IllegalArgumentException expected){blocked=true;}yes(blocked);
  recovered.closed();yes(!recovered.active());recovered.shown(proposal(),"phone","account","peer",4);yes(recovered.operate("peer",4,operation(uid,2),100));yes(recovered.phase().equals("DECLINED"));
  blocked=false;try{recovered.creating();}catch(IllegalArgumentException expected){blocked=true;}yes(blocked);
  recovered.closed();recovered.shown(proposal(),"phone","account","peer",4);yes(new NativeTodoSession(store).phase().equals("FAILED"));
  Memory result=new Memory();s=new NativeTodoSession(result);s.shown(proposal(),"phone","account","peer",4);s.operate("peer",4,operation(s.uid(),1),100);s.creating();s.created("native-opaque-id");
  NativeTodoSession after=new NativeTodoSession(result);yes(after.phase().equals("CREATED"));yes(after.nativeId().equals("native-opaque-id"));
  blocked=false;try{after.creating();}catch(IllegalArgumentException expected){blocked=true;}yes(blocked);
  Memory broken=new Memory();s=new NativeTodoSession(broken);s.shown(proposal(),"phone","account","peer",4);broken.fail=true;blocked=false;try{s.operate("peer",4,operation(s.uid(),1),100);}catch(java.io.IOException expected){blocked=true;}yes(blocked);yes(!s.healthy());broken.fail=false;yes(new NativeTodoSession(broken).phase().equals("FAILED"));
  System.out.println("Native todo session: "+checks+" synthetic checks passed");
 }
}
