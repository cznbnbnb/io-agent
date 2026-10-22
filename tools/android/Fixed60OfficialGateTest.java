package com.turboio.addon;

import java.io.*;
import java.nio.file.*;
import java.util.*;

/** Actual pinned firmware, adversarial/simulated official frames, real fsync journal. No Android/SDK/device IO. */
public final class Fixed60OfficialGateTest {
 static Fixed60Firmware firmware;static int checks;static long now=1000;static final String PEER="synthetic-official-peer";static final long LINK=7;
 static void yes(boolean b){checks++;if(!b)throw new AssertionError("check "+checks);}
 interface Checked {void run()throws Exception;}
 static void denied(Checked c){boolean rejected=false;try{c.run();}catch(Exception expected){rejected=true;}yes(rejected);}
 @SuppressWarnings("unchecked") static Map<String,Object> copy(Map<String,Object> r){return r==null?null:BoundedJson.map(BoundedJson.read(BoundedJson.canonical(r)));}
 static final class Memory implements Fixed60OfficialGate.Store {
  Map<String,Object> value;boolean failBefore,failAfter;int writes;
  public Map<String,Object> read(){return copy(value);}
  public void write(Map<String,Object> r)throws IOException{if(failBefore)throw new IOException("test");Fixed60OfficialJournal.validate(r);value=copy(r);writes++;if(failAfter)throw new IOException("ambiguous");}
 }
 static Fixed60OfficialGate create(Fixed60OfficialGate.Store store)throws Exception{Fixed60OfficialGate g=new Fixed60OfficialGate(store,now++);g.bind(PEER,LINK,now++);return g;}
 static byte[] f(int type,Object json){return OtaFrame.encode(type,json,null);}
 static Object version(){return OtaFrame.object("OsVersion",Fixed60Profile.VERSION,"OtaValidationState","idle","OtaValidationConfirmed",true,"PackageTypes",Arrays.asList("files"));}
 static byte[] out(Fixed60OfficialGate g,byte[] raw){return g.outbound(PEER,LINK,raw,now++,1760000000000L,true,true);}
 static void in(Fixed60OfficialGate g,int type,Object json){g.inbound(PEER,LINK,f(type,json),now++);}
 static void read(Fixed60OfficialGate g,int type,Object request,Object reply){yes(out(g,f(type,request))!=null);in(g,type,reply);}
 static void basic(Fixed60OfficialGate g){read(g,1,null,version());read(g,2,null,OtaFrame.object("BatteryLevel",67));read(g,11,null,OtaFrame.object("Result",true));}
 static void arm(Fixed60OfficialGate g){g.arm(firmware,Fixed60Profile.ID,PEER,LINK,now++);read(g,3,OtaFrame.object("OtaSize",Fixed60Profile.ZIP_SIZE),OtaFrame.object("Result",true));}
 static Fixed60OfficialGate armed(Memory m)throws Exception{Fixed60OfficialGate g=create(m);basic(g);arm(g);return g;}
 static void start(Fixed60OfficialGate g){yes(out(g,f(4,OtaFrame.object("Mode",2)))!=null);in(g,4,OtaFrame.object("Result",true));}
 static void manifest(Fixed60OfficialGate g){in(g,5,null);yes(out(g,f(5,OtaFrame.object("OtaVersion",Fixed60Profile.VERSION)))!=null);in(g,6,OtaFrame.object("OtaVersion",Fixed60Profile.VERSION));yes(out(g,f(6,firmware.manifest()))!=null);}
 static Fixed60OfficialGate transfer(Memory m)throws Exception{Fixed60OfficialGate g=armed(m);start(g);manifest(g);return g;}
 static Map<String,Object> request(String name,int start,int size){return OtaFrame.object("Name",name,"Start",start,"Size",size);}
 static void chunk(Fixed60OfficialGate g,String name,int start,int size){Map<String,Object> q=request(name,start,size);in(g,7,q);yes(out(g,OtaFrame.encode(7,q,firmware.slice(name,start,size)))!=null);}
 static void wholeAp(Fixed60OfficialGate g){for(int at=0;at<Fixed60Profile.AP_SIZE;at+=51200)chunk(g,"nuttx_ap.bin",at,Math.min(51200,Fixed60Profile.AP_SIZE-at));yes(g.apCovered()==Fixed60Profile.AP_SIZE);}
 static void unknown(Fixed60OfficialGate g){yes(g.pending()&&g.phase()==Fixed60OfficialGate.Phase.UNKNOWN);yes(out(g,f(4,OtaFrame.object("Mode",2)))==null);}
 static void recover(Fixed60OfficialGate g){
  now+=120001;g.tick(PEER,LINK,now++,true,true);now+=2001;g.tick(PEER,LINK,now++,true,true);
  yes(!g.confirmHome("incorrect",PEER,LINK,now++));yes(g.confirmHome("已回首页",PEER,LINK,now++));yes(g.beginReadback(PEER,LINK,now++));
  read(g,1,null,version());read(g,11,null,OtaFrame.object("Result",true));yes(g.phase()==Fixed60OfficialGate.Phase.READBACK&&g.bootReadback());
 }
 public static void main(String[] args)throws Exception{
  firmware=Fixed60Firmware.verify(Paths.get(args[0]));Path folder=Paths.get(args[1]);Files.createDirectories(folder);
  // No unused grant, no write of any kind. Unsolicited/late replies cannot establish preflight.
  for(int t=1;t<=12;t++){Memory m=new Memory();Fixed60OfficialGate g=create(m);yes((out(g,f(t,null))!=null)==(t==1||t==2||t==11));yes(!g.pending()&&m.writes==0);}
  Memory m=new Memory();Fixed60OfficialGate g=create(m);in(g,1,version());in(g,2,OtaFrame.object("BatteryLevel",80));in(g,11,OtaFrame.object("Result",true));yes(!g.ready(now++));
  yes(out(g,f(1,null))!=null);now+=15001;in(g,1,version());read(g,2,null,OtaFrame.object("BatteryLevel",80));read(g,11,null,OtaFrame.object("Result",true));yes(!g.ready(now++));
  g=create(new Memory());basic(g);yes(g.ready(now++));yes(out(g,f(11,null))!=null);yes(g.ready(now++));in(g,11,OtaFrame.object("Result",false));yes(!g.ready(now++));
  m=new Memory();g=create(m);basic(g);g.inspectCandidate(firmware,PEER,LINK,now++);yes(g.outbound(PEER,LINK,f(3,OtaFrame.object("OtaSize",Fixed60Profile.ZIP_SIZE)),now++,0,true,false)!=null);in(g,3,OtaFrame.object("Result",true));yes(g.preflight(now++).contains("空间=true"));yes(out(g,f(4,OtaFrame.object("Mode",2)))==null);yes(!g.pending()&&m.writes==0);
  g=create(new Memory());basic(g);final Fixed60OfficialGate tokenGate=g;denied(()->tokenGate.arm(firmware,"TAP1-TEST-01",PEER,LINK,now++));denied(()->tokenGate.arm(firmware,Fixed60Profile.ID,"other",LINK,now++));denied(()->tokenGate.arm(firmware,Fixed60Profile.ID,PEER,LINK+1,now++));
  for(int bad=0;bad<9;bad++){
   m=new Memory();g=armed(m);byte[] raw=f(4,OtaFrame.object("Mode",bad==0?1:2));String peer=bad==1?"other":PEER;long link=bad==2?LINK+1:LINK;boolean foreground=bad!=3,service=bad!=4;if(bad==5)now+=120001;if(bad==6)now+=900001;if(bad==7)read(g,2,null,OtaFrame.object("BatteryLevel",49));if(bad==8)read(g,11,null,OtaFrame.object("Result",false));
   yes(g.outbound(peer,link,raw,now++,1760000000000L,foreground,service)==null);yes(!g.pending()&&m.writes==0);
  }
  // First command cannot escape a failed/ambiguous START_INTENT commit.
  for(boolean after:new boolean[]{false,true}){m=new Memory();g=armed(m);m.failBefore=!after;m.failAfter=after;yes(out(g,f(4,OtaFrame.object("Mode",2)))==null);yes(g.pending()&&!g.healthy());if(after){m.failAfter=false;Fixed60OfficialGate restored=new Fixed60OfficialGate(m,now++);yes(restored.pending()&&restored.phase()==Fixed60OfficialGate.Phase.UNKNOWN);yes(!restored.bootReadback());}}
  m=new Memory();g=armed(m);byte[] original=f(4,OtaFrame.object("Mode",2)),frozen=out(g,original);yes(frozen!=null&&frozen!=original&&"START_INTENT".equals(m.value.get("phase")));byte first=frozen[0];original[0]^=1;yes(frozen[0]==first);yes(m.value.get("peer_sha256").equals(Fixed60Firmware.hash("SHA-256",PEER.getBytes(java.nio.charset.StandardCharsets.UTF_8))));yes(!new String(BoundedJson.canonical(m.value),java.nio.charset.StandardCharsets.UTF_8).contains(PEER));unknownAfterDuplicate(g);
  // Version/manifest use the actual fixed candidate, including burn metadata, not names alone.
  g=armed(new Memory());start(g);in(g,5,null);yes(out(g,f(5,OtaFrame.object("OtaVersion","Strix OS 1.0.4.12")))==null);unknown(g);
  g=armed(new Memory());start(g);in(g,5,null);yes(out(g,f(5,OtaFrame.object("OtaVersion",Fixed60Profile.VERSION)))!=null);in(g,6,OtaFrame.object("OtaVersion",Fixed60Profile.VERSION));List<Object> badManifest=BoundedJson.list(firmware.manifest());BoundedJson.map(badManifest.get(0)).put("BurnAddr",1);yes(out(g,f(6,badManifest))==null);unknown(g);
  for(int variant=0;variant<8;variant++){
   g=transfer(new Memory());Map<String,Object> q=request("nuttx_ap.bin",0,32);byte[] b=firmware.slice("nuttx_ap.bin",0,32);
   if(variant!=0)in(g,7,q);
   if(variant==1)b[2]^=1;if(variant==2)q.put("Start",1);if(variant==3)q.put("Size",31);if(variant==4)q.put("extra",0);if(variant==5)q.put("Name","images.bin");if(variant==6)b=Arrays.copyOf(b,31);if(variant==7)in(g,7,q);
   yes(out(g,OtaFrame.encode(7,q,b))==null);unknown(g);
  }
  for(Map<String,Object> invalid:Arrays.asList(request("../nuttx_ap.bin",0,1),request("OtaFileInfo.json",0,1),request("nuttx_ap.bin",Fixed60Profile.AP_SIZE,1),request("nuttx_ap.bin",0,51201),request("nuttx_ap.bin",-1,1))){g=transfer(new Memory());in(g,7,invalid);unknown(g);}
  g=transfer(new Memory());chunk(g,"nuttx_ap.bin",0,100);chunk(g,"nuttx_ap.bin",0,100);chunk(g,"nuttx_ap.bin",50,100);yes(g.apCovered()==150&&g.admittedBytes()==300);yes(out(g,OtaFrame.encode(7,request("nuttx_ap.bin",50,100),firmware.slice("nuttx_ap.bin",50,100)))==null);unknown(g);
  g=transfer(new Memory());for(int i=0;i<8;i++)chunk(g,"nuttx_ap.bin",0,1);in(g,7,request("nuttx_ap.bin",0,1));unknown(g);
  g=transfer(new Memory());for(int i=0;i<2000;i++)chunk(g,"nuttx_ap.bin",i,1);yes(g.requests()==2000);in(g,7,request("nuttx_ap.bin",2000,1));unknown(g);
  // Every member is pinned; unchanged members need not be requested by a diff OTA.
  g=transfer(new Memory());for(String name:firmware.payloadNames())chunk(g,name,0,Math.min(32,firmware.size(name)));yes(g.apCovered()==32);in(g,9,null);unknown(g);
  g=transfer(new Memory());long deadline=now+60001;in(g,8,OtaFrame.object("Progress",1000000));g.tick(PEER,LINK,deadline,true,true);now=deadline+1;unknown(g);
  g=transfer(new Memory());in(g,10,OtaFrame.object("errcode",8));yes("DEVICE_ERROR_8".equals(g.firstFailure()));unknown(g);yes("DEVICE_ERROR_8".equals(g.firstFailure()));
  for(int mode=0;mode<4;mode++){g=transfer(new Memory());if(mode==0)g.tick("",LINK,now++,true,true);if(mode==1)g.tick(PEER,LINK+1,now++,true,true);if(mode==2)g.tick(PEER,LINK,now++,false,true);if(mode==3)g.tick(PEER,LINK,now++,true,false);unknown(g);}
  g=transfer(new Memory());g.tick(PEER,LINK,now-100,true,true);yes(!g.healthy());unknown(g);
  g=transfer(new Memory());g.inbound("other",LINK,f(10,OtaFrame.object("errcode",8)),now++);yes(g.phase()==Fixed60OfficialGate.Phase.TRANSFER);g.inbound(PEER,LINK+1,f(10,OtaFrame.object("errcode",8)),now++);yes(g.phase()==Fixed60OfficialGate.Phase.TRANSFER);
  // Natural installation is an observed notice only. Recovery remains explicitly authorized.
  m=new Memory();g=transfer(m);wholeAp(g);in(g,9,null);yes(g.phase()==Fixed60OfficialGate.Phase.INSTALLING&&g.pending()&&g.installNotice()&&!g.bootReadback());yes(!g.release("已检查镜片",PEER,LINK,now++));yes(!g.beginReadback(PEER,LINK,now++));
  g.tick("",LINK+1,now++,true,true);yes(g.phase()==Fixed60OfficialGate.Phase.INSTALLING);g.tick(PEER,LINK+1,now++,true,true);yes(!g.confirmHome("已回首页",PEER,LINK+1,now++));
  Fixed60OfficialGate restored=new Fixed60OfficialGate(m,now++);yes(restored.pending()&&restored.apCovered()==Fixed60Profile.AP_SIZE&&restored.installNotice()&&!restored.bootReadback());yes(out(restored,f(4,OtaFrame.object("Mode",2)))==null);
  recover(restored);restored.tick(PEER,LINK,now++,true,false);yes(restored.phase()==Fixed60OfficialGate.Phase.READBACK);yes(restored.outbound(PEER,LINK,f(2,null),now++,0,true,false)!=null);in(restored,2,OtaFrame.object("BatteryLevel",65));yes(restored.bootReadback());yes(!restored.release("incorrect",PEER,LINK,now++));yes(!restored.release("已检查镜片","other",LINK,now++));yes(restored.release("已检查镜片",PEER,LINK,now++));yes(!restored.pending()&&restored.phase()==Fixed60OfficialGate.Phase.RELEASED);
  // Real durable namespace: monotonic history, no pending replacement, archive before a new intent.
  Path journalFile=folder.resolve("official-journal.json");
  try(Fixed60OfficialJournal j=new Fixed60OfficialJournal(journalFile.toFile())){
   g=create(j);basic(g);arm(g);start(g);manifest(g);chunk(g,"nuttx_ap.bin",0,64);g.abort("DEVICE_ERROR_8",now++);Map<String,Object> saved=j.read();
   Map<String,Object> changed=copy(saved);changed.put("operation",UUID.randomUUID().toString());final Map<String,Object> newOperation=changed;denied(()->j.write(newOperation));changed=copy(saved);changed.put("admitted_bytes",63);final Map<String,Object> decreased=changed;denied(()->j.write(decreased));changed=copy(saved);changed.put("first_failure","REPLACED");final Map<String,Object> replaced=changed;denied(()->j.write(replaced));changed=copy(saved);changed.put("phase","START_INTENT");final Map<String,Object> repeated=changed;denied(()->j.write(repeated));
  }
  try(Fixed60OfficialJournal j=new Fixed60OfficialJournal(journalFile.toFile())){g=new Fixed60OfficialGate(j,now++);yes(g.pending()&&g.apCovered()==64&&g.admittedBytes()==64&&"DEVICE_ERROR_8".equals(g.firstFailure()));recover(g);yes(g.release("已检查镜片",PEER,LINK,now++));String oldOperation=(String)j.read().get("operation");g=create(j);basic(g);arm(g);start(g);yes(Files.isRegularFile(Paths.get(journalFile+".history").resolve(oldOperation+".json")));}
  // AP coverage or an installation notice cannot authorize a different identity.
  // Exercise real journal immutability, then finish recovery on the original peer.
  for(boolean notice:new boolean[]{false,true}){
   Path file=folder.resolve(notice?"recovery-with-notice.json":"recovery-ap-only.json");
   try(Fixed60OfficialJournal j=new Fixed60OfficialJournal(file.toFile())){
    g=create(j);basic(g);arm(g);start(g);manifest(g);wholeAp(g);if(notice)in(g,9,null);
    String expected=g.expectedPeerHash();g=new Fixed60OfficialGate(j,now++);now+=120001;g.tick("unrelated-peer",LINK+1,now++,true,false);now+=2001;g.tick("unrelated-peer",LINK+1,now++,true,false);
    yes(expected.equals(g.expectedPeerHash()));yes(!g.confirmHome("已回首页","unrelated-peer",LINK+1,now++));yes(!g.beginReadback("unrelated-peer",LINK+1,now++));yes(g.healthy());yes(expected.equals(j.read().get("peer_sha256")));
    recover(g);yes(g.healthy());yes(g.release("已检查镜片",PEER,LINK,now++));yes(!g.pending());
   }
  }
  Path corrupt=folder.resolve("corrupt-journal.json");Files.write(corrupt,"{\"candidate\":\"foreign\"}".getBytes(java.nio.charset.StandardCharsets.UTF_8));try(Fixed60OfficialJournal j=new Fixed60OfficialJournal(corrupt.toFile())){denied(()->new Fixed60OfficialGate(j,now++));}
  System.out.println("Fixed60 official passive gate: "+checks+" assertions passed. Actual pinned ZIP and simulated frames only; no SDK or device writes.");
 }
 static void unknownAfterDuplicate(Fixed60OfficialGate g){yes(out(g,f(4,OtaFrame.object("Mode",2)))==null);unknown(g);}
}
