package com.turboio.addon;

import java.io.*;
import java.util.*;

/** Device-independent tests of persistence, setting ownership and fail-closed card permission. */
public final class HeadGestureTest {
 static int checks;static long clock;
 static final String PEER="synthetic-original",OTHER="synthetic-other",OWNER=FixedPeerHash.of("request/route/revision"),SECOND=FixedPeerHash.of("another-request");
 static void yes(boolean condition){checks++;if(!condition)throw new AssertionError("head guard check "+checks);}
 static final class Memory implements HeadGestureSession.Store {
  Object value;boolean fail;
  public Object read(){return value;}
  public void save(Object raw)throws Exception{if(fail)throw new IOException("test");value=BoundedJson.read(BoundedJson.canonical(raw));}
 }
 static byte[] setting(boolean on,int mode){return OtaFrame.encode(4,OtaFrame.object("generalSettings",OtaFrame.object("headGestures",OtaFrame.object("enabled",on?1:0,"mode",mode),"wakeupConfig",OtaFrame.object("headupSwitch",1))),null);}
 static HeadGestureSession.Emission next(HeadGestureSession s){HeadGestureSession.Emission e=s.next(PEER,1,clock);yes(e!=null);return e;}
 static void query(HeadGestureSession s,boolean on,int mode){
  HeadGestureSession.Emission e=next(s);yes(OtaFrame.decode(e.bytes).type==4);yes(s.permits(e,PEER,1,clock));
  s.receive(PEER,1,setting(on,mode),clock+1);s.result(e.ticket,true,clock+2);clock+=3;
 }
 static HeadGestureSession held(Memory m,boolean original,int mode){
  clock=1000;HeadGestureSession s=new HeadGestureSession(m);yes(s.acquire(OWNER,PEER,1,clock));
  yes(!s.pending()&&s.working()&&s.active(OWNER)&&!s.active(SECOND));
  // Cached-before-query, other peer, different generation and write echoes never certify anything.
  s.receive(PEER,1,setting(false,mode),clock);yes(!s.pending());
  HeadGestureSession.Emission q=next(s);
  s.receive(OTHER,1,setting(false,mode),clock);s.receive(PEER,2,setting(false,mode),clock);
  s.receive(PEER,1,OtaFrame.encode(6,OtaFrame.object("cmd","head_gestures"),null),clock);s.result(q.ticket,true,clock);yes(!s.pending());
  s.receive(PEER,1,setting(original,mode),clock+1);clock+=2;yes(s.pending());
  if(original){
   HeadGestureSession.Emission w=next(s);OtaFrame f=OtaFrame.decode(w.bytes);Map<String,Object> j=BoundedJson.map(f.json),p=BoundedJson.map(j.get("payload"));
   yes(f.type==5&&"head_gestures".equals(j.get("cmd")));yes(p.size()==3&&BoundedJson.number(p.get("value"),0,0)==0&&BoundedJson.number(p.get("mode"),mode,mode)==mode&&"".equals(p.get("data")));
   yes(!s.ready(OWNER,PEER,1,clock));s.result(w.ticket,true,clock);yes(s.next(PEER,1,clock+1499)==null);
   clock+=1500;query(s,false,mode);
  }
  yes(s.ready(OWNER,PEER,1,clock));yes(!s.ready(SECOND,PEER,1,clock));yes(!s.ready(OWNER,OTHER,1,clock));yes(!s.ready(OWNER,PEER,2,clock));return s;
 }
 static void restore(HeadGestureSession s,boolean original,int mode){
  yes(s.release(OWNER,PEER,1,clock,false));query(s,false,mode);
  if(original){HeadGestureSession.Emission w=next(s);Map<String,Object> p=BoundedJson.map(BoundedJson.map(OtaFrame.decode(w.bytes).json).get("payload"));yes(BoundedJson.number(p.get("value"),1,1)==1&&BoundedJson.number(p.get("mode"),mode,mode)==mode);s.result(w.ticket,true,clock);clock+=1500;query(s,true,mode);}
  yes(!s.pending()&&s.phase().equals("IDLE")&&!s.active(OWNER));
 }
 public static void main(String[] args)throws Exception{
  // Keep mode (opt-in confirm cards): an enabled setting is held with no write and released with no restore write.
  for(int mode=0;mode<=1;mode++){clock=1000;HeadGestureSession k=new HeadGestureSession(new Memory());yes(k.acquire(OWNER,PEER,1,clock,true));query(k,true,mode);
   yes(k.ready(OWNER,PEER,1,clock)&&k.keepsGestures());yes(k.release(OWNER,PEER,1,clock,false));query(k,true,mode);yes(!k.pending()&&k.phase().equals("IDLE")&&!k.keepsGestures());}
  // Keep mode with gestures already off behaves as before: nothing to disable, nothing to restore.
  clock=1000;HeadGestureSession off=new HeadGestureSession(new Memory());yes(off.acquire(OWNER,PEER,1,clock,true));query(off,false,0);yes(off.ready(OWNER,PEER,1,clock));
  for(boolean enabled:new boolean[]{true,false})for(int mode=0;mode<=1;mode++){
   Memory m=new Memory();HeadGestureSession s=held(m,enabled,mode);yes(!s.acquire(SECOND,PEER,1,clock));restore(s,enabled,mode);
   yes(!new HeadGestureSession(m).pending());
  }
  Memory m=new Memory();HeadGestureSession s=held(m,true,1);
  yes(s.markCardPossible(OWNER,PEER,1,clock));yes(!s.release(OWNER,PEER,1,clock,false));yes(!s.release(SECOND,PEER,1,clock,true));yes(!s.release(OWNER,OTHER,1,clock,true));
  HeadGestureSession reboot=new HeadGestureSession(m);yes(reboot.pending()&&reboot.cardPending()&&!reboot.ready(OWNER,PEER,1,clock));yes(!reboot.recover(PEER,2,clock));yes(reboot.next(PEER,2,clock)==null);
  yes(reboot.release(OWNER,PEER,2,clock,true));yes(reboot.next(PEER,2,clock+9499)==null);clock+=9500;HeadGestureSession.Emission e=reboot.next(PEER,2,clock);yes(e!=null);reboot.result(e.ticket,true,clock);reboot.receive(PEER,2,setting(false,1),clock);e=reboot.next(PEER,2,clock);yes(e!=null&&OtaFrame.decode(e.bytes).type==5);
  reboot.result(e.ticket,true,clock);clock+=1500;e=reboot.next(PEER,2,clock);reboot.result(e.ticket,true,clock);reboot.receive(PEER,2,setting(true,1),clock);yes(!reboot.pending());
  // Disconnect invalidates authority. Recovery reads only the immutable original peer.
  m=new Memory();s=held(m,true,0);s.tick(OTHER,2,clock);yes(!s.ready(OWNER,PEER,1,clock));yes(!s.recover(OTHER,2,clock));yes(s.recover(PEER,1,clock));query(s,true,0);yes(!s.pending());
  // Cold recovery without a shown card never repeats the disable; another mode is preserved.
  m=new Memory();s=held(m,true,0);reboot=new HeadGestureSession(m);yes(reboot.recover(PEER,1,clock));clock+=9500;query(reboot,false,1);yes(!reboot.pending()&&reboot.next(PEER,1,clock)==null);
  // A user's explicit OFF while already temporarily OFF must not turn back ON.
  s=held(new Memory(),true,0);yes(s.userWrite(PEER,new HeadGestureSession.Setting(false,0)));yes(!s.ready(OWNER,PEER,1,clock));yes(s.release(OWNER,PEER,1,clock,false));query(s,false,0);yes(!s.pending());
  // Newer ON/mode1 overrides the captured ON/mode0; only that explicit intent may be applied.
  s=held(new Memory(),true,0);yes(s.userWrite(PEER,new HeadGestureSession.Setting(true,1)));yes(s.release(OWNER,PEER,1,clock,false));query(s,false,0);e=next(s);Map<String,Object> p=BoundedJson.map(BoundedJson.map(OtaFrame.decode(e.bytes).json).get("payload"));yes(BoundedJson.number(p.get("value"),1,1)==1&&BoundedJson.number(p.get("mode"),1,1)==1);
  s.result(e.ticket,true,clock);clock+=1500;query(s,true,1);yes(!s.pending());
  // Unparseable newer setting traffic revokes authority and preserves a fresh actual value.
  m=new Memory();s=held(m,true,0);yes(s.unknownWrite(PEER));reboot=new HeadGestureSession(m);yes(!reboot.ready(OWNER,PEER,1,clock)&&reboot.recover(PEER,1,clock));clock+=9500;query(reboot,false,0);yes(!reboot.pending()&&reboot.next(PEER,1,clock)==null);
  // A queued restore cannot overwrite a setting changed after its inspection but before SDK admission.
  s=held(new Memory(),true,0);yes(s.userWrite(OTHER,new HeadGestureSession.Setting(false,1))&&s.ready(OWNER,PEER,1,clock));
  yes(s.release(OWNER,PEER,1,clock,false));query(s,false,0);e=next(s);final HeadGestureSession boundSession=s;final HeadGestureSession.Emission staleRestore=e;final long admissionAt=clock;Object staleMessage=new Object();
  yes(HeadGestureGate.register(staleMessage,PEER,e.bytes,()->boundSession.permits(staleRestore,PEER,1,admissionAt)));
  yes(s.userWrite(PEER,new HeadGestureSession.Setting(false,1)));yes(!HeadGestureGate.allow(staleMessage,PEER,e.bytes));HeadGestureGate.retire(staleMessage);
  yes(s.release(OWNER,PEER,1,clock,false));yes(s.next(PEER,1,clock+9499)==null);clock+=9500;query(s,false,1);yes(!s.pending());
  // User write before original read aborts acquisition with no mutation or restoration journal.
  s=new HeadGestureSession(new Memory());yes(s.acquire(OWNER,PEER,1,clock));e=next(s);yes(s.userWrite(PEER,new HeadGestureSession.Setting(true,1)));yes(!s.pending()&&!s.permits(e,PEER,1,clock)&&s.next(PEER,1,clock)==null);
  // Lost write callback: wait its deadline then inspect, with no duplicate write.
  s=new HeadGestureSession(new Memory());yes(s.acquire(OWNER,PEER,1,clock));query(s,true,0);e=next(s);long writeAt=clock;s.tick(PEER,1,writeAt+8000);yes(s.pending()&&!s.ready(OWNER,PEER,1,clock));yes(s.next(PEER,1,writeAt+9499)==null);clock=writeAt+9500;query(s,false,0);yes(s.ready(OWNER,PEER,1,clock));
  // A fresh ON read after disable denies the card and retains the restore obligation.
  s=new HeadGestureSession(new Memory());yes(s.acquire(OWNER,PEER,1,clock));query(s,true,0);e=next(s);s.result(e.ticket,false,clock);clock+=1500;query(s,true,0);yes(s.pending()&&!s.ready(OWNER,PEER,1,clock)&&s.next(PEER,1,clock)==null);
  // A successful SDK receipt without a type4 reply cannot grant or close the obligation.
  s=new HeadGestureSession(new Memory());yes(s.acquire(OWNER,PEER,1,clock));e=next(s);s.result(e.ticket,true,clock);s.tick(PEER,1,clock+8000);yes(!s.pending()&&!s.ready(OWNER,PEER,1,clock));
  // Strict numeric wire contract; unknown and boolean settings never disable or grant.
  s=new HeadGestureSession(new Memory());yes(s.acquire(OWNER,PEER,1,clock));e=next(s);s.result(e.ticket,true,clock);
  s.receive(PEER,1,OtaFrame.encode(4,OtaFrame.object("generalSettings",OtaFrame.object("headGestures",OtaFrame.object("enabled",false,"mode",0))),null),clock);yes(!s.pending());
  s.receive(PEER,1,setting(true,1),clock);yes(s.pending());
  // Save failure prevents even a disable emission. Failure after hold revokes the lease immediately.
  m=new Memory();m.fail=true;s=new HeadGestureSession(m);yes(s.acquire(OWNER,PEER,1,clock));query(s,true,0);yes(!s.healthy()&&s.next(PEER,1,clock)==null);
  m=new Memory();s=held(m,true,0);m.fail=true;yes(!s.markCardPossible(OWNER,PEER,1,clock));yes(!s.ready(OWNER,PEER,1,clock));
  m=new Memory();s=held(m,true,0);m.fail=true;yes(!s.userWrite(PEER,new HeadGestureSession.Setting(false,1)));yes(!s.healthy()&&!s.ready(OWNER,PEER,1,clock));
  // Expiry never fabricates an answer or clears a card that may still be present.
  s=held(new Memory(),true,0);yes(s.markCardPossible(OWNER,PEER,1,clock));s.tick(PEER,1,clock+120000);yes(!s.ready(OWNER,PEER,1,clock+120000)&&s.cardPending()&&!s.recover(PEER,1,clock+120000));
  // Durable schema is strict, including corruption/foreign bindings.
  m=new Memory();m.value=OtaFrame.object("schema",1,"pending",true);yes(!new HeadGestureSession(m).healthy());
  try(AtomicDocument disk=new AtomicDocument(new File(args[0],"head.json"))){
   HeadGestureSession.Store real=new HeadGestureSession.Store(){public Object read()throws Exception{return disk.read();}public void save(Object raw)throws Exception{disk.save(raw);}};
   s=new HeadGestureSession(real);yes(s.acquire(OWNER,PEER,1,clock));query(s,false,1);yes(s.markCardPossible(OWNER,PEER,1,clock));yes(new HeadGestureSession(real).cardPending());
  }
  // A durable input closure is bound to this exact acquisition, not merely the same question.
  s=held(new Memory(),true,0);String token=s.token(OWNER);yes(token.matches("[a-f0-9]{32}"));yes(s.markCardPossible(OWNER,PEER,1,clock));
  CardInputClosure proof=(owner,peer,lease)->owner.equals(OWNER)&&peer.equals(FixedPeerHash.of(PEER))&&lease.equals(token);
  yes(!s.releaseInputClosed(OWNER,PEER,1,clock,null));yes(!s.releaseInputClosed(SECOND,PEER,1,clock,proof));yes(!s.releaseInputClosed(OWNER,OTHER,1,clock,proof));yes(s.releaseInputClosed(OWNER,PEER,1,clock,proof));query(s,false,0);e=next(s);s.result(e.ticket,true,clock);clock+=1500;query(s,true,0);yes(!s.pending());
  s=held(new Memory(),true,0);yes(!s.token(OWNER).equals(token));yes(s.markCardPossible(OWNER,PEER,1,clock));yes(!s.releaseInputClosed(OWNER,PEER,1,clock,proof));
  // Only a current, explicit page transition can extend the still-disabled guard.
  s=held(new Memory(),true,0);long firstExpiry=clock+HeadGestureSession.LEASE_MS;yes(!s.extendForPage(SECOND,PEER,1,clock+1000));yes(s.extendForPage(OWNER,PEER,1,clock+1000));yes(s.ready(OWNER,PEER,1,firstExpiry+1));s.tick(PEER,1,firstExpiry+1000);yes(!s.ready(OWNER,PEER,1,firstExpiry+1000));
  gateChecks();System.out.println("head gesture guard: "+checks+" assertions passed");
 }
 static void gateChecks(){
  final int[] writes={0},unknown={0};final boolean[] valid={true};
  HeadGestureGate.observe(new HeadGestureGate.Observer(){public boolean userWrite(String peer,HeadGestureSession.Setting s){writes[0]++;return valid[0];}public boolean unknownWrite(String peer){unknown[0]++;return valid[0];}});
  byte[] bytes=new HeadGestureSession.Emission(1,"disable",new HeadGestureSession.Setting(false,1)).bytes;
  Object own=new Object();yes(HeadGestureGate.register(own,PEER,bytes,()->valid[0]));yes(HeadGestureGate.allow(own,PEER,bytes)&&writes[0]==0);yes(!HeadGestureGate.allow(own,OTHER,bytes));
  byte[] mutated=bytes.clone();mutated[mutated.length-1]^=1;yes(!HeadGestureGate.allow(own,PEER,mutated));
  valid[0]=false;yes(!HeadGestureGate.allow(own,PEER,bytes));HeadGestureGate.retire(own);valid[0]=true;yes(!HeadGestureGate.allow(own,PEER,bytes)&&writes[0]==0);
  yes(HeadGestureGate.allow(new Object(),PEER,bytes)&&writes[0]==1);
  yes(HeadGestureGate.allow(new Object(),PEER,OtaFrame.encode(5,OtaFrame.object("cmd","wakeup_config","payload",OtaFrame.object("value",1)),null))&&writes[0]==1&&unknown[0]==0);
  yes(HeadGestureGate.allow(new Object(),PEER,OtaFrame.encode(6,OtaFrame.object("cmd","head_gestures"),null))&&writes[0]==1);
  valid[0]=false;yes(!HeadGestureGate.allow(new Object(),PEER,bytes));yes(writes[0]==2);
  yes(!HeadGestureGate.allow(new Object(),PEER,OtaFrame.encode(5,OtaFrame.object("cmd","head_gestures","payload",OtaFrame.object("value",3,"mode",0,"data","")),null))&&unknown[0]==1);
  HeadGestureGate.observe(null);
 }
}
