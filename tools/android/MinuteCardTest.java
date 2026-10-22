package com.turboio.addon;
import java.util.*;
import java.io.*;

public final class MinuteCardTest {
 static int checks;
 static void yes(boolean value){checks++;if(!value)throw new AssertionError("check "+checks);}
 static final class Memory implements MinuteCardSession.Store{
  Object value;boolean fail;public Object read(){return value;}public void save(Object v)throws Exception{if(fail)throw new IOException();value=BoundedJson.read(BoundedJson.canonical(v));}
 }
 static final String PEER="original-glasses",FOREIGN="other-glasses";
 static final byte[] VERSION=OtaFrame.encode(1,OtaFrame.object("OsVersion","Strix OS 1.0.5.5","OtaValidationState","idle","OtaValidationConfirmed",true,"PackageTypes",Arrays.asList("files")),null);
 static final byte[] IDLE=OtaFrame.encode(11,OtaFrame.object("Result",true),null);
 static byte[] choice(String uid,int cmd){return OtaFrame.encode(34,OtaFrame.object("suggestUID",uid,"suggestType",2,"cmd",cmd),null);}
 static void inspected(MinuteCardSession s,boolean show){
  yes(s.inspect(PEER,1,1000,show));
  s.receive(PEER,1,9,IDLE,1001);yes(s.phase().equals("CHECKING"));
  MinuteCardSession.Emission e=s.next(1002);yes(e.business==9&&e.type==1);
  s.receive(FOREIGN,1,9,VERSION,1003);yes(s.phase().equals("CHECKING"));
  s.receive(PEER,1,9,VERSION,1004);s.result(e.ticket,true,1005);
  e=s.next(1006);yes(e.business==9&&e.type==11);
  s.receive(PEER,1,9,IDLE,1007);s.result(e.ticket,true,1008);
 }
 static MinuteCardSession active(Memory m){MinuteCardSession s=new MinuteCardSession(m);inspected(s,true);
  yes(s.pending()&&m.value!=null);MinuteCardSession.Emission e=s.next(1010);yes(e.business==21&&e.type==33);
  Map<String,Object> body=BoundedJson.map(OtaFrame.decode(e.bytes).json);yes(BoundedJson.number(body.get("type"),1,1)==1);yes(body.get("suggestUID").equals(s.uid()));
  s.result(e.ticket,true,1011);yes(s.phase().equals("ACTIVE"));return s;
 }
 public static void main(String[] args)throws Exception{
  yes(HostBusiness.id("NOTIFICATION")==21);yes(HostBusiness.id("PROACTIVE_AI")==-1);yes(HostBusiness.id(21)==21);yes(HostBusiness.id(23)==-1);yes(HostBusiness.id(21.0)==-1);
  Memory m=new Memory();MinuteCardSession s=active(m);
  s.tick(PEER,1,66000,true);yes(s.phase().equals("ACTIVE")&&s.next(66000)==null&&s.action()==0);
  s.tick(PEER,1,121006,true);yes(s.next(121006)==null);
  s.tick(PEER,1,121007,true);MinuteCardSession.Emission e=s.next(121007);yes(e.type==33&&BoundedJson.number(BoundedJson.map(OtaFrame.decode(e.bytes).json).get("type"),2,2)==2);
  s.result(e.ticket,true,121008);yes(s.pending()&&s.action()==0);yes(!s.confirmGone("log success"));yes(s.confirmGone("镜片已回首页"));yes(!s.pending());
  for(int cmd=1;cmd<=2;cmd++){s=active(new Memory());
   s.receive(FOREIGN,1,21,choice(s.uid(),cmd),2000);s.receive(PEER,2,21,choice(s.uid(),cmd),2000);s.receive(PEER,1,21,choice("wrong",cmd),2000);yes(s.action()==0);
   s.receive(PEER,1,21,choice(s.uid(),cmd),2000);yes(s.action()==cmd);e=s.next(2000);yes(e.type==35&&e.business==21);
   s.receive(PEER,1,21,choice(s.uid(),3-cmd),2001);s.receive(PEER,1,21,choice(s.uid(),cmd),2001);yes(s.action()==cmd);
   s.result(e.ticket,true,2002);s.tick(PEER,1,4501,true);yes(s.next(4501)==null);
   s.tick(PEER,1,4502,true);e=s.next(4502);yes(e.type==33);s.result(e.ticket,true,4503);yes(s.phase().equals("REMOVAL_SUBMITTED"));
  }
  m=new Memory();s=active(m);MinuteCardSession restored=new MinuteCardSession(m);
  yes(restored.pending()&&!restored.working()&&restored.next(2000)==null);yes(!restored.inspect(PEER,2,2000,true));yes(!restored.remove(FOREIGN,2,2000));
  yes(restored.remove(PEER,2,2000));e=restored.next(2000);yes(e.type==33&&BoundedJson.number(BoundedJson.map(OtaFrame.decode(e.bytes).json).get("type"),2,2)==2);restored.result(e.ticket,true,2001);yes(restored.confirmGone("镜片已回首页"));
  s=active(new Memory());s.tick(FOREIGN,2,2000,true);yes(s.phase().equals("CLEANUP_PENDING")&&s.next(2000)==null);s.receive(PEER,1,21,choice(s.uid(),1),2001);yes(s.action()==0);
  s=active(new Memory());s.tick(PEER,1,2000,false);e=s.next(2000);yes(e.type==33);
  s=new MinuteCardSession(new Memory());inspected(s,false);yes(s.phase().equals("READY")&&!s.pending()&&s.next(2000)==null);
  s=new MinuteCardSession(new Memory());yes(s.inspect(PEER,1,1000,true));e=s.next(1001);s.result(e.ticket,false,1002);yes(!s.pending()&&s.next(1003)==null);
  s=new MinuteCardSession(new Memory());yes(s.inspect(PEER,1,1000,true));e=s.next(1001);s.tick(PEER,1,9001,true);yes(!s.working());s.result(e.ticket,true,9002);yes(!s.working());
  m=new Memory();m.fail=true;s=new MinuteCardSession(m);inspected(s,true);yes(!s.healthy()&&s.next(2000)==null);
  // A lost show callback retains the durable same-UID cleanup, with no retry.
  m=new Memory();s=new MinuteCardSession(m);inspected(s,true);e=s.next(1010);s.result(e.ticket,false,1011);yes(s.pending()&&s.next(1100)==null);yes(s.remove(PEER,1,1200));yes(s.next(1200).type==33);
  // Real atomic journal survives restart and preserves cleanup binding.
  try(AtomicDocument doc=new AtomicDocument(new File(args[0],"minute.json"))){MinuteCardSession.Store store=new MinuteCardSession.Store(){public Object read()throws Exception{return doc.read();}public void save(Object o)throws Exception{doc.save(o);}};s=new MinuteCardSession(store);inspected(s,true);yes(new MinuteCardSession(store).pending());}
  System.out.println("minute card: "+checks+" assertions passed");
 }
}
