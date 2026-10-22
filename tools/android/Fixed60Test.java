package com.turboio.addon;

import java.io.*;
import java.nio.file.*;
import java.util.*;
import java.util.zip.*;

/** Real pinned firmware input + simulated protocol/SDK receipts; never opens a device. */
public final class Fixed60Test {
 private static int checks;
 private static Fixed60Firmware firmware;
 private static final Fixed60Session.Link LINK=new Fixed60Session.Link("synthetic-glasses",1);
 private static void check(boolean value,String why){checks++;if(!value)throw new AssertionError(why);}
 interface Throwing {void run()throws Exception;}
 private static void denied(Throwing action,String why)throws Exception{boolean failed=false;try{action.run();}catch(IOException|IllegalArgumentException|IllegalStateException expected){failed=true;}check(failed,why);}
 static final class Memory implements Fixed60Session.Store {
  Map<String,Object> saved;boolean fail;int writes;
  public Map<String,Object> read(){return saved==null?null:BoundedJson.map(BoundedJson.read(BoundedJson.canonical(saved)));}
  public void write(Map<String,Object> record)throws IOException{if(fail)throw new IOException("synthetic disk failure");Fixed60Journal.validate(record);saved=BoundedJson.map(BoundedJson.read(BoundedJson.canonical(record)));writes++;}
 }
 static final class Harness {
  final Memory store=new Memory();final Fixed60Session session;long now=100;
  Harness()throws IOException{session=new Fixed60Session(firmware,store,now);}
  byte[] frame(int type,Object json){return OtaFrame.encode(type,json,null);}
  void receive(int type,Object json){session.receive(LINK,frame(type,json),++now);}
  Fixed60Session.Transmission take(int type){Fixed60Session.Transmission tx=session.take(LINK,++now);check(tx!=null,"expected outgoing "+type+" in "+session.state()+" "+session.reason());check(OtaFrame.decode(tx.bytes()).type==type,"wire type "+type);return tx;}
  void ack(Fixed60Session.Transmission tx){session.confirmed(tx.id,true,LINK,++now);}
  void exchange(int type,int response,Object json){Fixed60Session.Transmission tx=take(type);ack(tx);receive(response,json);}
  void ready(){
   session.prepare(LINK,true,++now);
   // A valid device reply can precede the asynchronous SDK send callback.
   Fixed60Session.Transmission first=take(1);receive(1,version());check(session.state()==Fixed60Session.State.CHECK_VERSION,"early reply waits for send receipt");ack(first);
   exchange(2,2,OtaFrame.object("BatteryLevel",90));
   Fixed60Session.Transmission space=take(3);check(((Number)BoundedJson.map(OtaFrame.decode(space.bytes()).json).get("OtaSize")).intValue()==Fixed60Profile.ZIP_SIZE,"exact candidate space query");ack(space);receive(3,OtaFrame.object("Result",true));
   exchange(11,11,OtaFrame.object("Result",true));check(session.state()==Fixed60Session.State.READY,"ready after all checks");
  }
  void started()throws IOException{
   ready();session.authorize(Fixed60Profile.ID,LINK,++now);session.start(LINK,++now,1792410000000L);
   check("START_INTENT".equals(store.saved.get("phase"))&&Boolean.TRUE.equals(store.saved.get("pending")),"durable intent exists before Mode2 is taken");
   Fixed60Session.Transmission start=take(4);check(((Number)BoundedJson.map(OtaFrame.decode(start.bytes()).json).get("Mode")).intValue()==2,"files/Mode2");
   ack(start);receive(4,OtaFrame.object("Result",true));receive(5,null);exchange(5,6,OtaFrame.object("OtaVersion",Fixed60Profile.VERSION));
   Fixed60Session.Transmission manifest=take(6);check(BoundedJson.list(OtaFrame.decode(manifest.bytes()).json).size()==15,"all 15 payload rows");ack(manifest);
  }
  Fixed60Session.Transmission request(String name,int start,int size){receive(7,OtaFrame.object("Name",name,"Start",start,"Size",size));return take(7);}
  void slice(String name,int start,int size){Fixed60Session.Transmission tx=request(name,start,size);check(Arrays.equals(OtaFrame.decode(tx.bytes()).binary,firmware.slice(name,start,size)),"exact immutable slice "+name);ack(tx);}
 }
 private static Map<String,Object> version(){return OtaFrame.object("OsVersion",Fixed60Profile.VERSION,"OtaValidationStateCode",4294967295L,"OtaValidationState","idle","OtaValidationConfirmed",true,"PackageInfoVersions",Arrays.asList(1,2),"PackageTypes",Arrays.asList("files","zip"));}
 private static void firmwareTests(Path candidate,Path original,Path temporary)throws Exception{
  byte[] zip=Files.readAllBytes(candidate);firmware=Fixed60Firmware.verify(candidate);
  check(firmware.payloadNames().size()==15&&firmware.payloadBytes()==16824141,"payload count/expanded byte budget");
  denied(()->Fixed60Firmware.verify(Files.readAllBytes(original)),"original firmware cannot masquerade as patched candidate");
  byte[] changed=zip.clone();changed[changed.length/2]^=1;denied(()->Fixed60Firmware.verify(changed),"one-byte mutation rejected");
  denied(()->Fixed60Firmware.verify(Arrays.copyOf(zip,zip.length-1)),"truncated archive rejected");
  denied(()->Fixed60Firmware.verify(Arrays.copyOf(zip,zip.length+1)),"oversized archive rejected");
  denied(()->firmware.slice("../nuttx_ap.bin",0,1),"traversal denied");denied(()->firmware.slice("OtaFileInfo.json",0,1),"manifest is not a binary payload");
  denied(()->firmware.slice("nuttx_ap.bin",Integer.MAX_VALUE,51200),"integer boundary denied");denied(()->firmware.slice("nuttx_ap.bin",0,51201),"slice budget");
  denied(()->firmware.slice("nuttx_ap.bin",Fixed60Profile.AP_SIZE-1,2),"end boundary");
  byte[] slice=firmware.slice("nuttx_ap.bin",0,51200);slice[0]^=1;check(!Arrays.equals(slice,firmware.slice("nuttx_ap.bin",0,51200)),"returned bytes cannot mutate frozen firmware");
  List<Object> manifest=BoundedJson.list(firmware.manifest());BoundedJson.map(manifest.get(0)).clear();check(!BoundedJson.map(BoundedJson.list(firmware.manifest()).get(0)).isEmpty(),"manifest cannot mutate snapshot");
  Path directory=Files.createDirectory(temporary.resolve("download"));
  try(ZipInputStream in=new ZipInputStream(new ByteArrayInputStream(zip))){ZipEntry entry;while((entry=in.getNextEntry())!=null){Path target=directory.resolve(entry.getName()).normalize();check(target.getParent().equals(directory),"known flat test archive");Files.copy(in,target);}}
  Fixed60Firmware frozen=Fixed60Firmware.freezeDirectory(directory);byte[] before=frozen.slice("nuttx_audio.bin",0,51200);
  Files.write(directory.resolve("nuttx_audio.bin"),new byte[10]);check(Arrays.equals(before,frozen.slice("nuttx_audio.bin",0,51200)),"vendor directory replacement cannot alter outgoing slices");
  denied(()->Fixed60Firmware.freezeDirectory(directory),"changed directory rejected on new freeze");
  Files.write(directory.resolve("extra.bin"),new byte[]{1});denied(()->Fixed60Firmware.freezeDirectory(directory),"extra directory entry rejected");
 }
 private static void receiptOrdering()throws Exception{
  Harness h=new Harness();h.started();
  for(int start=0;start<204800;start+=51200){
   Fixed60Session.Transmission tx=start==0?h.request("nuttx_audio.bin",start,51200):h.take(7);
   check(Arrays.equals(OtaFrame.decode(tx.bytes()).binary,firmware.slice("nuttx_audio.bin",start,51200)),"ordered audio slice "+start);
   check(h.session.coveredBytes()==start,"unconfirmed bytes never count");
   if(start<153600){h.receive(8,OtaFrame.object("Progress",start));h.receive(7,OtaFrame.object("Name","nuttx_audio.bin","Start",start+51200,"Size",51200));}
   h.ack(tx);
   h.session.confirmed(tx.id,true,LINK,++h.now);check(h.session.coveredBytes()==start+51200,"duplicate/late callback ignored");
  }
  h.slice("nuttx_audio.bin",0,51200);check(h.session.coveredBytes()==204800,"repeated request does not inflate coverage");
  h.slice("nuttx_audio.bin",200000,10000);check(h.session.coveredBytes()==210000,"overlap union is exact");
  h.receive(10,OtaFrame.object("errcode",8));check(h.session.state()==Fixed60Session.State.UNKNOWN&&"DEVICE_ERROR_8".equals(h.session.reason()),"observed firmware error 8 preserved");
  check(h.session.take(LINK,++h.now)==null&&h.session.pending(),"unknown does not retry");
  Fixed60Session restored=new Fixed60Session(firmware,h.store,++h.now);check("DEVICE_ERROR_8".equals(restored.firstFailure())&&"RESTART_UNKNOWN".equals(restored.reason()),"restart retains original device failure separately from recovery status");
  check(!restored.confirmHome("已回首页",LINK,++h.now),"restored failure quiet period begins now");h.now+=120000;check(restored.confirmHome("已回首页",LINK,++h.now),"manual recovery after original failure");restored.readback(LINK,++h.now);Fixed60Session.Transmission query=restored.take(LINK,++h.now);restored.confirmed(query.id,false,LINK,++h.now);check("DEVICE_ERROR_8".equals(restored.firstFailure())&&"SDK_SEND_FAILED".equals(restored.reason())&&"DEVICE_ERROR_8".equals(h.store.saved.get("first_failure")),"recovery failure cannot overwrite original device error");
 }
 private static void fullTransferAndRecovery()throws Exception{
  Harness h=new Harness();h.started();List<String> names=new ArrayList<>(firmware.payloadNames());Collections.reverse(names);
  for(String name:names){for(int start=0;start<firmware.size(name);start+=51200)h.slice(name,start,Math.min(51200,firmware.size(name)-start));}
  check(h.session.coveredBytes()==firmware.payloadBytes()&&h.session.apCoveredBytes()==Fixed60Profile.AP_SIZE,"all payloads confirmed, including bt_controller");
  check(h.session.state()==Fixed60Session.State.TRANSFER&&!h.session.bootReadback(),"complete send alone is not install/boot evidence");
  h.receive(9,null);check(h.session.state()==Fixed60Session.State.INSTALLING&&h.session.pending(),"device install notice keeps protection");
  long installing=h.now;Fixed60Session.Link down=new Fixed60Session.Link("",1),reconnected=new Fixed60Session.Link(LINK.peer,2);
  h.session.check(down,installing+100);h.session.check(down,installing+1200);h.session.check(reconnected,installing+2000);
  denied(()->h.session.readback(reconnected,installing+3000),"install quiet period");
  h.now=installing+61000;h.session.readback(reconnected,h.now);Fixed60Session.Transmission version=h.session.take(reconnected,++h.now);check(OtaFrame.readOnly(version.bytes()),"recovery sends only read-only query");
  h.session.confirmed(version.id,true,reconnected,++h.now);h.session.receive(reconnected,OtaFrame.encode(1,version(),null),++h.now);
  Fixed60Session.Transmission idle=h.session.take(reconnected,++h.now);check(OtaFrame.decode(idle.bytes()).type==11,"boot then idle required");h.session.confirmed(idle.id,true,reconnected,++h.now);h.session.receive(reconnected,OtaFrame.encode(11,OtaFrame.object("Result",true),null),++h.now);
  check(h.session.bootReadback()&&h.session.state()==Fixed60Session.State.READBACK&&h.session.pending(),"same version/idle does not clear protection or prove patched AP");
  denied(()->h.session.release("",reconnected,++h.now),"explicit lens inspection still required");
  h.session.release("已检查镜片",reconnected,++h.now);check(!h.session.pending()&&"RELEASED".equals(h.store.saved.get("phase")),"only explicit inspection releases local protection");
 }
 private static void guardTests()throws Exception{
  Harness absent=new Harness();denied(()->absent.session.prepare(LINK,false,++absent.now),"fresh boot prerequisite cannot be omitted");
  Harness wrong=new Harness();wrong.session.prepare(LINK,true,++wrong.now);Fixed60Session.Transmission v=wrong.take(1);wrong.ack(v);Map<String,Object> old=version();old.put("OsVersion","Strix OS 1.0.4.12");wrong.receive(1,old);check(wrong.session.state()==Fixed60Session.State.LOCKED&&!wrong.session.pending(),"TAP1 version cannot be used");
  Harness expired=new Harness();expired.ready();denied(()->expired.session.authorize("TAP1",LINK,++expired.now),"TAP1 authorization not reused");expired.now+=120000;denied(()->expired.session.authorize(Fixed60Profile.ID,LINK,expired.now),"freshness window enforced");
  Harness generation=new Harness();generation.started();generation.session.check(new Fixed60Session.Link(LINK.peer,2),++generation.now);check(generation.session.state()==Fixed60Session.State.UNKNOWN,"same peer new link invalidates transfer");
  Harness terminal=new Harness();terminal.started();Fixed60Session.Transmission inFlight=terminal.request("nuttx_audio.bin",0,51200);terminal.receive(7,OtaFrame.object("Name","nuttx_audio.bin","Start",51200,"Size",51200));terminal.receive(10,OtaFrame.object("errcode",8));terminal.ack(inFlight);check(terminal.session.state()==Fixed60Session.State.UNKNOWN&&terminal.session.coveredBytes()==0&&terminal.session.take(LINK,++terminal.now)==null,"terminal device error preempts queued requests and late receipt");
  Harness rejected=new Harness();rejected.started();Fixed60Session.Transmission chunk=rejected.request("nuttx_ap.bin",0,51200);rejected.session.confirmed(chunk.id,false,LINK,++rejected.now);check(rejected.session.coveredBytes()==0&&rejected.session.state()==Fixed60Session.State.UNKNOWN,"SDK rejection never counts firmware bytes");
  Harness early=new Harness();early.started();early.receive(9,null);check("PREMATURE_INSTALL_NOTICE".equals(early.session.reason())&&Boolean.TRUE.equals(early.store.saved.get("install_notice")),"early install notice preserves unknown and notice history");
  Harness apOnly=new Harness();apOnly.started();for(int start=0;start<Fixed60Profile.AP_SIZE;start+=51200)apOnly.slice("nuttx_ap.bin",start,Math.min(51200,Fixed60Profile.AP_SIZE-start));apOnly.receive(9,null);check(apOnly.session.state()==Fixed60Session.State.UNKNOWN,"AP coverage alone cannot validate manifest transfer");
  Harness backlog=new Harness();backlog.started();backlog.request("nuttx_audio.bin",0,51200);for(int i=0;i<9;i++)backlog.receive(8,OtaFrame.object("Progress",i));check(backlog.session.state()==Fixed60Session.State.UNKNOWN&&"INBOUND_BUDGET".equals(backlog.session.reason()),"bounded early reply queue");
  Harness timeout=new Harness();timeout.started();long before=timeout.now;timeout.session.receive(LINK,OtaFrame.encode(8,OtaFrame.object("Progress",1),null),before+59999);timeout.session.check(LINK,before+60000);check(timeout.session.state()==Fixed60Session.State.UNKNOWN,"progress cannot keep stalled transfer alive");
  Harness clock=new Harness();clock.session.check(LINK,0);denied(()->clock.session.prepare(LINK,true,101),"clock reversal cannot authorize another preparation");
  Harness repeated=new Harness();repeated.started();for(int i=0;i<8;i++)repeated.slice("nuttx_audio.bin",0,51200);repeated.receive(7,OtaFrame.object("Name","nuttx_audio.bin","Start",0,"Size",51200));check("REPEATED_SLICE_BUDGET".equals(repeated.session.reason()),"duplicate transmission budget");
  Harness disk=new Harness();disk.ready();disk.session.authorize(Fixed60Profile.ID,LINK,++disk.now);disk.store.fail=true;denied(()->disk.session.start(LINK,++disk.now,1792410000000L),"failed start journal prevents Mode2");check(disk.session.take(LINK,++disk.now)==null,"no Mode2 after journal failure");
  Harness progressDisk=new Harness();progressDisk.started();Fixed60Session.Transmission pending=progressDisk.request("nuttx_ap.bin",0,51200);progressDisk.store.fail=true;progressDisk.ack(pending);check(progressDisk.session.state()==Fixed60Session.State.UNKNOWN&&!progressDisk.session.journalHealthy(),"post-start disk failure retains protection");
 }
 private static void journalAndRestart(Path temporary)throws Exception{
  Path file=temporary.resolve("io-fixed60-ota-v1.json");
  try(Fixed60Journal journal=new Fixed60Journal(file.toFile())){
   Fixed60Session session=new Fixed60Session(firmware,journal,100);check(session.state()==Fixed60Session.State.LOCKED,"new private journal");
   denied(()->new Fixed60Journal(file.toFile()),"exclusive journal owner");
   Harness h=new Harness();h.ready();h.session.authorize(Fixed60Profile.ID,LINK,++h.now);h.session.start(LINK,++h.now,1792410000000L);journal.write(h.store.saved);
   Map<String,Object> replacement=h.store.read();replacement.put("operation",UUID.randomUUID().toString());denied(()->journal.write(replacement),"pending operation cannot be replaced even by another caller");
  }
  try(Fixed60Journal journal=new Fixed60Journal(file.toFile())){
   Fixed60Session restored=new Fixed60Session(firmware,journal,1000);check(restored.state()==Fixed60Session.State.UNKNOWN&&restored.pending(),"crash before Mode2 resumes as unknown");check(restored.take(LINK,1001)==null,"restart never retransmits");
   denied(()->restored.prepare(LINK,true,1002),"pending cannot be replaced");
   check(!restored.confirmHome("已回首页",new Fixed60Session.Link("other-glasses",1),1003),"another peer cannot release saved protection");
   check(!restored.confirmHome("已回首页",LINK,1004),"restart loses connection history and requires quiet period");
   check(restored.confirmHome("已回首页",LINK,121004),"explicit home assertion after quiet/stable period");
   restored.readback(LINK,121005);check(OtaFrame.readOnly(restored.take(LINK,121006).bytes()),"restart recovery can query but never sends firmware");
  }
  Files.write(file,"{broken".getBytes(java.nio.charset.StandardCharsets.UTF_8));
  try(Fixed60Journal corrupt=new Fixed60Journal(file.toFile())){denied(()->new Fixed60Session(firmware,corrupt,1),"corrupt journal blocks construction");}
  Path archiveFile=temporary.resolve("archive-journal.json");
  try(Fixed60Journal journal=new Fixed60Journal(archiveFile.toFile())){
   Harness h=new Harness();h.started();h.receive(10,OtaFrame.object("errcode",8));Map<String,Object> old=h.store.read();journal.write(old);
   Map<String,Object> lost=h.store.read();lost.put("first_failure","");denied(()->journal.write(lost),"original failure cannot be erased from private journal");
   old.put("phase","READBACK");old.put("boot_readback",true);journal.write(old);old.put("phase","RELEASED");old.put("pending",false);journal.write(old);
   String oldOperation=(String)old.get("operation");Harness next=new Harness();next.ready();next.session.authorize(Fixed60Profile.ID,LINK,++next.now);next.session.start(LINK,++next.now,1792410000001L);journal.write(next.store.saved);
   Path archived=Paths.get(archiveFile.toString()+".history").resolve(oldOperation+".json");check(Files.isRegularFile(archived)&&"DEVICE_ERROR_8".equals(BoundedJson.map(BoundedJson.read(Files.readAllBytes(archived))).get("first_failure")),"new operation preserves completed failure history in a small metadata record");
  }
 }
 private static void inspectionAndQueue()throws Exception{
  Harness read=new Harness();read.session.inspect(LINK,++read.now);read.exchange(1,1,version());read.exchange(2,2,OtaFrame.object("BatteryLevel",90));read.exchange(11,11,OtaFrame.object("Result",true));check(read.session.state()==Fixed60Session.State.INSPECTED&&!read.session.pending()&&read.store.writes==0,"three read-only queries do not prepare or write history");denied(()->read.session.authorize(Fixed60Profile.ID,LINK,++read.now),"read-only inspection cannot grant start authorization");
  Object owner=new Object(),other=new Object();check(FirmwareQueue.acquire(owner,Fixed60Session.peerHash("synthetic-peer"))&&!FirmwareQueue.acquire(other),"single firmware queue owner");
  try{
   HostPolicyTest.Message message=new HostPolicyTest.Message(HostPolicyTest.Business.MARS_FOTA,OtaFrame.encode(1,null,null));
   check(!Host107Abi.allowQueue(message),"unowned read-only query cannot interfere with exclusive conversation");
   FirmwareQueue.submit(owner,message,message.b,(byte[])message.e,false,()->{
    HostPolicyTest.Message clone=new HostPolicyTest.Message(HostPolicyTest.Business.MARS_FOTA,((byte[])message.e).clone());check(!Host107Abi.allowQueue(clone),"same bytes different object cannot borrow ticket");
    byte[] original=(byte[])message.e;message.e=OtaFrame.encode(2,null,null);check(!Host107Abi.allowQueue(message),"message changed after ticket cannot borrow it");message.e=original;
    java.util.concurrent.atomic.AtomicBoolean leaked=new java.util.concurrent.atomic.AtomicBoolean();Thread thread=new Thread(()->leaked.set(Host107Abi.allowQueue(message)));thread.start();thread.join();check(!leaked.get(),"ticket cannot cross thread");
    check(Host107Abi.allowQueue(message)&&!Host107Abi.allowQueue(message),"exact expected ticket consumed once");
   });
   check(!Host107Abi.allowQueue(message),"ticket removed after synchronous call");
   HostPolicyTest.Message space=new HostPolicyTest.Message(HostPolicyTest.Business.MARS_FOTA,OtaFrame.encode(3,OtaFrame.object("OtaSize",Fixed60Profile.ZIP_SIZE),null));FirmwareQueue.submit(owner,space,space.b,(byte[])space.e,false,()->check(Host107Abi.allowQueue(space),"owned exact-candidate space query"));
   HostPolicyTest.Message mode=new HostPolicyTest.Message(HostPolicyTest.Business.MARS_FOTA,OtaFrame.encode(4,OtaFrame.object("Mode",2),null));denied(()->FirmwareQueue.submit(owner,mode,mode.b,(byte[])mode.e,false,()->check(!Host107Abi.allowQueue(mode),"disabled writes reject Mode2")),"unconsumed write ticket fails closed");
   HostPolicyTest.Message manifest=new HostPolicyTest.Message(HostPolicyTest.Business.MARS_FOTA,OtaFrame.encode(6,firmware.manifest(),null));FirmwareQueue.submit(owner,manifest,manifest.b,(byte[])manifest.e,true,()->check(Host107Abi.allowQueue(manifest),"exact reviewed manifest pin"));
   List<Object> rows=BoundedJson.list(firmware.manifest());BoundedJson.map(rows.get(0)).put("BurnMode",99);manifest.e=OtaFrame.encode(6,rows,null);denied(()->FirmwareQueue.submit(owner,manifest,manifest.b,(byte[])manifest.e,true,()->check(!Host107Abi.allowQueue(manifest),"manifest length alone cannot authorize changed burn instructions")),"changed manifest denied");
   HostPolicyTest.Message interactive=new HostPolicyTest.Message(HostPolicyTest.Business.LAUNCHER,new byte[0]);check(!Host107Abi.allowQueue(interactive),"interactive SDK message blocked during firmware ownership");FirmwareQueue.release(other);check(FirmwareQueue.busy(),"wrong owner cannot release");
   check(!Host107Abi.allowFile(),"raw file gate shares ownership");for(HostPolicyTest.Business biz:new HostPolicyTest.Business[]{HostPolicyTest.Business.HEARTBEAT,HostPolicyTest.Business.CONNECTION_PAIRING,HostPolicyTest.Business.VERSION_CHECK})check(Host107Abi.allowQueue(new HostPolicyTest.Message(biz,new byte[0])),"connection maintenance remains available");check(!Host107Abi.allowQueue(new HostPolicyTest.Message(HostPolicyTest.Business.WHISPER_MODE,new byte[0])),"settings mutations cannot bypass ownership");
   HostPolicyTest.Message foreignPair=new HostPolicyTest.Message(HostPolicyTest.Business.CONNECTION_PAIRING,new byte[0]);foreignPair.b="another-peer";check(!Host107Abi.allowQueue(foreignPair),"connection maintenance cannot pair a different device during firmware ownership");check(!FirmwareQueue.acquire(owner,Fixed60Session.peerHash("another-peer")),"owner cannot change its protected target");
   HostPolicyTest.Message foreignQuery=new HostPolicyTest.Message(HostPolicyTest.Business.MARS_FOTA,OtaFrame.encode(1,null,null));foreignQuery.b="another-peer";denied(()->FirmwareQueue.submit(owner,foreignQuery,foreignQuery.b,(byte[])foreignQuery.e,false,()->{}),"firmware ticket cannot target another peer even with same owner");
  }finally{FirmwareQueue.release(owner);}
  check(!FirmwareQueue.busy(),"queue ownership restored");
 }
 private static void reconnectTests()throws Exception{
  Harness h=new Harness();h.started();h.receive(10,OtaFrame.object("errcode",8));long failed=h.now;Fixed60Session.Link down=new Fixed60Session.Link("",2);
  denied(()->h.session.reconnectPermit("已自然重启回首页",down,failed+119999),"quiet time before reconnect");
  denied(()->h.session.reconnectPermit("",down,failed+120000),"direct home observation required");
  denied(()->h.session.reconnectPermit("已自然重启回首页",new Fixed60Session.Link("another-peer",2),failed+120001),"another connected peer blocks reconnect permit");
  h.now=failed+120002;Fixed60Session.ReconnectPermit permit=h.session.reconnectPermit("已自然重启回首页",down,h.now);
  check(h.session.pending()&&h.session.state()==Fixed60Session.State.UNKNOWN&&"DEVICE_ERROR_8".equals(h.store.saved.get("first_failure"))&&"USER_HOME_RECONNECT_REQUESTED".equals(h.store.saved.get("reason")),"reconnect intent retains original failure and pending state");
  check(h.session.take(down,++h.now)==null,"reconnect permit emits no OTA message");
  GlassesConnection.Peer original=new GlassesConnection.Peer(LINK.peer,"original","disconnected","disconnected","bonded",false);
  GlassesConnection.Peer lookalike=new GlassesConnection.Peer("another-peer","original","disconnected","disconnected","bonded",false);
  check(FirmwareRecoverySelection.select(Arrays.asList(lookalike,original),permit,h.now)==original,"exact hashed SDK ID selected, never display name");
  denied(()->FirmwareRecoverySelection.select(Arrays.asList(lookalike),permit,h.now),"same name cannot replace original");
  denied(()->FirmwareRecoverySelection.select(Arrays.asList(original,original),permit,h.now),"duplicate original records denied");
  denied(()->FirmwareRecoverySelection.select(Arrays.asList(new GlassesConnection.Peer(LINK.peer,"original","disconnected","disconnected","unbound",false)),permit,h.now),"recovery never pairs unbound peer");
  for(String state:Arrays.asList("connecting","connected","authIng","disconnecting"))denied(()->FirmwareRecoverySelection.select(Arrays.asList(new GlassesConnection.Peer(LINK.peer,"original",state,"disconnected","bonded",false)),permit,h.now),"in-flight connection cannot be repeated");
  denied(()->FirmwareRecoverySelection.select(Arrays.asList(original,new GlassesConnection.Peer("other","x","authSuccess","disconnected","bonded",true)),permit,h.now),"another connected device is never displaced");
  check(!permit.matches("other",h.now),"permit cannot move to another peer");permit.consume(LINK.peer,h.now);denied(()->permit.consume(LINK.peer,h.now),"one reconnect only");
  Fixed60Session.ReconnectPermit stale=h.session.reconnectPermit("已自然重启回首页",down,++h.now),newer=h.session.reconnectPermit("已自然重启回首页",down,++h.now);check(!stale.matches(LINK.peer,h.now)&&newer.matches(LINK.peer,h.now),"new permit revokes older unconsumed permit");
  check(!newer.matches(LINK.peer,h.now+30000),"bounded reconnect permit expiry");
  h.store.fail=true;denied(()->h.session.reconnectPermit("已自然重启回首页",down,++h.now),"reconnect intent must persist before SDK call");check(h.session.pending()&&!h.session.journalHealthy(),"write failure preserves interlock");
  Harness noPending=new Harness();denied(()->noPending.session.reconnectPermit("已自然重启回首页",down,200000),"ordinary session cannot borrow recovery bypass");
 }
 public static void main(String[] args)throws Exception{
  Path root=Paths.get(args[2]).toAbsolutePath().normalize();Files.createDirectories(root);Path temporary=Files.createTempDirectory(root,"fixed60-test-").toRealPath();
  try{firmwareTests(Paths.get(args[0]),Paths.get(args[1]),temporary);receiptOrdering();fullTransferAndRecovery();guardTests();journalAndRestart(temporary);inspectionAndQueue();reconnectTests();System.out.println("Fixed60 offline checks: "+checks+" passed; actual pinned ZIP, simulated protocol/receipts, no device/network/firmware write");}
  finally{
   Path resolved=temporary.toRealPath();if(!resolved.getParent().equals(root.toRealPath())||!resolved.getFileName().toString().startsWith("fixed60-test-"))throw new IOException("TEST_CLEANUP_SCOPE");
   try(java.util.stream.Stream<Path> paths=Files.walk(resolved)){Path[] entries=paths.sorted(Comparator.reverseOrder()).toArray(Path[]::new);for(Path entry:entries)Files.delete(entry);}
  }
 }
}
