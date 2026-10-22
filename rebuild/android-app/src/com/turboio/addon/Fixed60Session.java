package com.turboio.addon;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.*;

/** Transport-independent files/Mode2 conversation. No SDK, Android calls, or automatic retry. */
final class Fixed60Session {
 enum State {LOCKED,CHECK_VERSION,CHECK_BATTERY,CHECK_SPACE,CHECK_IDLE,INSPECTED,READY,AUTHORIZED,STARTING,VERSION,MANIFEST,TRANSFER,INSTALLING,UNKNOWN,READ_VERSION,READ_IDLE,READBACK}
 interface Store {Map<String,Object> read()throws IOException;void write(Map<String,Object> record)throws IOException;}
 static final class Link {
  final String peer;final long generation;
  Link(String peer,long generation){if(generation<0)throw new IllegalArgumentException("LINK_GENERATION");this.peer=peer;this.generation=generation;}
 }
 static final class Transmission {
  final long id;private final byte[] bytes;
  private Transmission(long id,byte[] bytes){this.id=id;this.bytes=bytes.clone();}
  byte[] bytes(){return bytes.clone();}
 }
 private static final int MAX_REQUESTS=2000,MAX_EVENTS=8192,MAX_QUEUE=8;
 private static final long PREPARE_MS=900000,FRESH_MS=120000,SEND_MS=15000,TRANSFER_MS=900000;
 private final Store journal;
 private Fixed60Firmware firmware;
 private State state=State.LOCKED;
 private String peer="",peerHash="",operation="",reason="",firstFailure="";
 private long last=-1,preparation,fresh,grant,deadline,transferUntil,startEpoch,serial,connection=-1,observedConnection=-1,recoverySince=-1,reconnectSerial;
 private int battery=-1,requests,confirmed,sent,covered,apCovered,events,progress=-1;
 private boolean pending,installNotice,bootReadback,journalHealthy=true,clockHealthy=true,taken,inspecting;
 private Transmission outbound;
 private String chunkName="";private int chunkStart,chunkSize;
 private OtaRecoveryGuard recovery;
 private final ArrayDeque<byte[]> incoming=new ArrayDeque<>();
 private final Map<String,TreeMap<Integer,Integer>> coverage=new HashMap<>();
 private final Map<String,Integer> repeats=new HashMap<>();
 Fixed60Session(Fixed60Firmware firmware,Store journal,long now)throws IOException{
  if(journal==null||now<0)throw new IllegalArgumentException("FIXED60_CONSTRUCTOR");
  this.firmware=firmware;this.journal=journal;last=now;
  Map<String,Object> saved=journal.read();
  if(saved!=null){
   try{Fixed60Journal.validate(saved);}catch(RuntimeException error){throw new IOException("FIXED60_JOURNAL_INVALID",error);}
   if(Boolean.TRUE.equals(saved.get("pending"))){
    pending=true;state=State.UNKNOWN;this.firmware=null;reason="RESTART_UNKNOWN";recoverySince=now;
    peerHash=(String)saved.get("peer_sha256");operation=(String)saved.get("operation");startEpoch=((Number)saved.get("started_at_epoch_ms")).longValue();
    requests=num(saved,"requests");confirmed=num(saved,"confirmed_messages");sent=num(saved,"confirmed_bytes");covered=num(saved,"covered_bytes");apCovered=num(saved,"ap_covered_bytes");
    installNotice=Boolean.TRUE.equals(saved.get("install_notice"));firstFailure=(String)saved.get("first_failure");
    // Historical counts and readback cannot become fresh ranges, authorization, or boot evidence.
   }
  }
 }
 private static int num(Map<String,Object> map,String key){return ((Number)map.get(key)).intValue();}
 State state(){return state;}String reason(){return reason;}String firstFailure(){return firstFailure;}boolean pending(){return pending;}
 int requests(){return requests;}int confirmedMessages(){return confirmed;}int sentBytes(){return sent;}
 int coveredBytes(){return covered;}int apCoveredBytes(){return apCovered;}int battery(){return battery;}int progress(){return progress;}
 boolean bootReadback(){return bootReadback;}boolean journalHealthy(){return journalHealthy;}
 String peer(){return peer;}
 long reconnectWait(long now){return recoverySince<0?120000:Math.max(0,120000-(now-recoverySince));}
 boolean recoveryState(){return pending&&(state==State.UNKNOWN||state==State.INSTALLING);}
 boolean samePeer(String current){return current!=null&&!current.isEmpty()&&peerHash.equals(peerHash(current));}
 String expectedPeerHash(){return peerHash;}
 void inspect(Link link,long now){
  check(link,now);require((state==State.LOCKED||state==State.INSPECTED)&&!pending&&journalHealthy&&clockHealthy,"INSPECT_DENIED");
  peer=BoundedJson.text(link.peer,256);connection=link.generation;inspecting=true;reason="";battery=-1;events=confirmed=0;preparation=now+PREPARE_MS;
  query(State.CHECK_VERSION,1,null,now);
 }
 static String peerHash(String peer){return Fixed60Firmware.hash("SHA-256",peer.getBytes(StandardCharsets.UTF_8));}
 void prepare(Link link,boolean freshBootObserved,long now){
  check(link,now);
  require(state==State.LOCKED&&!pending&&firmware!=null&&journalHealthy&&clockHealthy&&freshBootObserved,"PREPARE_DENIED");
  peer=BoundedJson.text(link.peer,256);connection=link.generation;peerHash=peerHash(peer);operation=UUID.randomUUID().toString();reason=firstFailure="";
  requests=confirmed=sent=covered=apCovered=events=0;coverage.clear();repeats.clear();installNotice=bootReadback=false;battery=progress=-1;
  inspecting=false;preparation=now+PREPARE_MS;query(State.CHECK_VERSION,1,null,now);
 }
 void authorize(String candidate,Link link,long now){
  check(link,now);require(state==State.READY&&Fixed60Profile.ID.equals(candidate)&&peer.equals(link.peer)&&now-fresh<FRESH_MS&&outbound==null,"AUTHORIZE_DENIED");
  state=State.AUTHORIZED;grant=Math.min(preparation,now+FRESH_MS);
 }
 void start(Link link,long now,long epoch)throws IOException{
  check(link,now);require(state==State.AUTHORIZED&&peer.equals(link.peer)&&now<grant&&now-fresh<FRESH_MS&&battery>=50&&outbound==null&&epoch>0,"START_DENIED");
  startEpoch=epoch;
  // A failed/ambiguous fsync never permits Mode2; a successfully persisted intent survives a crash before send.
  try{journal.write(record("START_INTENT",true));}
  catch(IOException|RuntimeException error){pending=true;state=State.UNKNOWN;journalHealthy=false;reason=firstFailure="START_JOURNAL_FAILED";firmware=null;throw new IOException(reason,error);}
  pending=true;grant=0;transferUntil=now+TRANSFER_MS;state=State.STARTING;emit(4,OtaFrame.object("Mode",2),null,now);
 }
 Transmission take(Link link,long now){check(link,now);if(outbound==null||taken)return null;taken=true;return outbound;}
 void confirmed(long id,boolean ok,Link link,long now){
  check(link,now);if(outbound==null||!taken||outbound.id!=id)return; // Ignore stale callback; never acknowledge a newer message.
  if(!ok){fail("SDK_SEND_FAILED",now);return;}
  if(!peer.equals(link.peer)){fail("CONNECTION_CHANGED",now);return;}
  confirmed++;
  if(chunkSize>0){sent+=chunkSize;cover(chunkName,chunkStart,chunkStart+chunkSize);}
  outbound=null;taken=false;chunkName="";chunkSize=0;deadline=now+replyWindow();
  if(pending&&!checkpoint(now))return;
  drain(now);
 }
 void receive(Link link,byte[] bytes,long now){
  check(link,now);
  if(state==State.LOCKED||state==State.UNKNOWN||state==State.READBACK)return;
  if(!peer.equals(link.peer)){fail("CONNECTION_CHANGED",now);return;}
  if(bytes==null||bytes.length>8192||incoming.size()>=MAX_QUEUE||++events>MAX_EVENTS){fail("INBOUND_BUDGET",now);return;}
  // Terminal device errors preempt queued slice requests, even while a prior SDK receipt is pending.
  try{OtaFrame frame=OtaFrame.decode(bytes);if(frame.binary.length!=0)throw new IllegalArgumentException();if(frame.type==10){int code=BoundedJson.number(BoundedJson.map(frame.json).get("errcode"),0,65535);fail("DEVICE_ERROR_"+code,now);return;}}
  catch(RuntimeException error){fail("PROTOCOL_INVALID",now);return;}
  incoming.add(bytes.clone());drain(now);
 }
 private void drain(long now){
  while(outbound==null&&!incoming.isEmpty()&&state!=State.UNKNOWN&&state!=State.LOCKED){
   byte[] bytes=incoming.removeFirst();
   try{accept(OtaFrame.decode(bytes),now);}catch(RuntimeException error){fail(error.getMessage()!=null&&error.getMessage().matches("[A-Z0-9_]{1,128}")?error.getMessage():"PROTOCOL_INVALID",now);}
  }
 }
 private void accept(OtaFrame frame,long now){
  require(frame.binary.length==0,"UNEXPECTED_BINARY");Map<String,Object> json=BoundedJson.map(frame.json);
  if(frame.type==10){int code=BoundedJson.number(json.get("errcode"),0,65535);throw new IllegalArgumentException("DEVICE_ERROR_"+code);}
  switch(state){
   case CHECK_VERSION:case READ_VERSION:
    require(frame.type==1&&Fixed60Profile.VERSION.equals(json.get("OsVersion")),"VERSION_MISMATCH");
    require("idle".equals(json.get("OtaValidationState"))&&Boolean.TRUE.equals(json.get("OtaValidationConfirmed"))&&BoundedJson.list(json.get("PackageTypes")).contains("files"),"BOOT_VALIDATION_REQUIRED");
    query(state==State.READ_VERSION?State.READ_IDLE:State.CHECK_BATTERY,state==State.READ_VERSION?11:2,null,now);break;
   case CHECK_BATTERY:
    require(frame.type==2,"EXPECTED_BATTERY");battery=BoundedJson.number(json.get("BatteryLevel"),50,100);
    query(inspecting?State.CHECK_IDLE:State.CHECK_SPACE,inspecting?11:3,inspecting?null:OtaFrame.object("OtaSize",Fixed60Profile.ZIP_SIZE),now);break;
   case CHECK_SPACE:
    require(frame.type==3&&Boolean.TRUE.equals(json.get("Result")),"SPACE_REJECTED");query(State.CHECK_IDLE,11,null,now);break;
   case CHECK_IDLE:case READ_IDLE:
    require(frame.type==11&&Boolean.TRUE.equals(json.get("Result")),"DEVICE_BUSY");
    if(state==State.READ_IDLE){state=State.READBACK;bootReadback=true;checkpoint(now);}else state=inspecting?State.INSPECTED:State.READY;
    fresh=now;deadline=0;break;
   case STARTING:
    require(frame.type==4&&Boolean.TRUE.equals(json.get("Result")),"START_REJECTED");state=State.VERSION;deadline=now+30000;checkpoint(now);break;
   case VERSION:
    require(frame.type==5&&json.isEmpty(),"EXPECTED_VERSION_REQUEST");query(State.MANIFEST,5,OtaFrame.object("OtaVersion",Fixed60Profile.VERSION),now);break;
   case MANIFEST:
    require(frame.type==6&&Fixed60Profile.VERSION.equals(json.get("OtaVersion")),"EXPECTED_MANIFEST_REQUEST");query(State.TRANSFER,6,firmware.manifest(),now);break;
   case TRANSFER:
    if(frame.type==8){BoundedJson.keys(json,"Progress");progress=BoundedJson.number(json.get("Progress"),0,1000000);break;} // Does not extend the slice deadline.
    if(frame.type==9){
     installNotice=true;
     require(json.isEmpty()&&covered==firmware.payloadBytes(),"PREMATURE_INSTALL_NOTICE");
     state=State.INSTALLING;deadline=0;recoverySince=now;recovery=new OtaRecoveryGuard(peer,now,false);firmware=null;checkpoint(now);break;
    }
    require(frame.type==7,"EXPECTED_SLICE_REQUEST");BoundedJson.keys(json,"Name","Start","Size");
    String name=BoundedJson.text(json.get("Name"),64);int start=BoundedJson.number(json.get("Start"),0,Integer.MAX_VALUE),size=BoundedJson.number(json.get("Size"),1,51200);
    byte[] data=firmware.slice(name,start,size);
    require(requests<MAX_REQUESTS&&sent+size<=firmware.payloadBytes()*3,"TRANSFER_BUDGET");
    String key=name+":"+start+":"+size;int count=repeats.containsKey(key)?repeats.get(key):0;require(count<8,"REPEATED_SLICE_BUDGET");repeats.put(key,count+1);requests++;
    chunkName=name;chunkStart=start;chunkSize=size;emit(7,json,data,now);break;
   case INSTALLING:
    // A delayed install notice can repeat; other traffic cannot prove boot/install success.
    require(frame.type==9&&json.isEmpty(),"UNEXPECTED_INSTALL_TRAFFIC");break;
   default:throw new IllegalArgumentException("UNEXPECTED_REPLY");
  }
 }
 void check(Link link,long now){
  if(now<0||now<last){clockHealthy=false;fail("MONOTONIC_CLOCK_REVERSED",Math.max(0,last));return;}last=now;
  if(recovery!=null){if(observedConnection!=link.generation)recovery.observe("",now);recovery.observe(link.peer,now);}observedConnection=link.generation;
  if(state==State.LOCKED||state==State.UNKNOWN||state==State.INSTALLING)return;
  if(!peer.equals(link.peer)||connection!=link.generation){fail("CONNECTION_CHANGED",now);return;}
  if(state==State.READBACK)return;
  if(state==State.INSPECTED)return;
  if(!pending&&now>=preparation){fail("PREPARATION_EXPIRED",now);return;}
  if(pending&&state!=State.READ_VERSION&&state!=State.READ_IDLE&&now>=transferUntil){fail("TRANSFER_EXPIRED",now);return;}
  if(deadline>0&&now>=deadline)fail(outbound!=null?"SDK_SEND_TIMEOUT":"REPLY_TIMEOUT",now);
 }
 void cancel(long now){if(pending)throw new IllegalStateException("STARTED_REQUIRES_RECOVERY");fail("PREPARATION_CANCELLED",now);}
 void abort(String code,long now){require(code!=null&&code.matches("[A-Z0-9_]{1,128}"),"INVALID_FAILURE_CODE");fail(code,now);}
 void disconnect(Link link,long now){check(link,now);}
 /** A user-observed home permits only one same-ID reconnect, never pairing or firmware. */
 static final class ReconnectPermit {
  private final Fixed60Session owner;private final String operation;private final long serial,issued,expires;private boolean used;
  private ReconnectPermit(Fixed60Session owner,long now){this.owner=owner;operation=owner.operation;serial=owner.reconnectSerial;issued=now;expires=now+30000;}
  boolean valid(long now){return !used&&owner.pending&&owner.journalHealthy&&owner.clockHealthy&&operation.equals(owner.operation)&&serial==owner.reconnectSerial&&now>=issued&&now>=owner.last&&now<expires&&(owner.state==State.UNKNOWN||owner.state==State.INSTALLING);}
  boolean matches(String candidate,long now){return valid(now)&&candidate!=null&&!candidate.isEmpty()&&owner.peerHash.equals(peerHash(candidate));}
  void consume(String candidate,long now){require(matches(candidate,now),"RECOVERY_PERMIT_INVALID");used=true;}
 }
 ReconnectPermit reconnectPermit(String assertion,Link link,long now){
  check(link,now);
  require("已自然重启回首页".equals(assertion)&&pending&&journalHealthy&&clockHealthy&&(state==State.UNKNOWN||state==State.INSTALLING)&&(link.peer==null||link.peer.isEmpty())&&recoverySince>=0&&now-recoverySince>=120000,"RECOVERY_RECONNECT_NOT_READY");
  reason="USER_HOME_RECONNECT_REQUESTED";require(checkpoint(now),"RECOVERY_JOURNAL_FAILED");reconnectSerial++;return new ReconnectPermit(this,now);
 }
 boolean confirmHome(String assertion,Link link,long now){
  if(!recoverPeer(link,now))return false;return recovery.confirmHome(assertion,link.peer,now);
 }
 private boolean recoverPeer(Link link,long now){
  check(link,now);
  String current=link.peer;
  if(!pending||!clockHealthy||!(state==State.UNKNOWN||state==State.INSTALLING||state==State.READBACK)||current==null||current.isEmpty()||!peerHash.equals(peerHash(current)))return false;
  if(peer.isEmpty())peer=current;
  if(recovery==null)recovery=new OtaRecoveryGuard(peer,recoverySince>=0?recoverySince:now,true);
  recovery.observe(current,now);return true;
 }
 void readback(Link link,long now){
  require(recoverPeer(link,now)&&recovery.allowed(link.peer,now),"RECOVERY_NOT_READY");
  connection=link.generation;bootReadback=false;reason="";query(State.READ_VERSION,1,null,now);
 }
 void release(String assertion,Link link,long now)throws IOException{
  check(link,now);
  require("已检查镜片".equals(assertion)&&state==State.READBACK&&bootReadback&&peer.equals(link.peer)&&now-fresh<FRESH_MS&&recovery!=null&&recovery.allowed(link.peer,now)&&journalHealthy,"INSPECTION_REQUIRED");
  journal.write(record("RELEASED",false));pending=false;state=State.LOCKED;recovery=null;firmware=null;
 }
 private void query(State next,int type,Object json,long now){state=next;emit(type,json,null,now);}
 private void emit(int type,Object json,byte[] binary,long now){require(outbound==null,"OUTBOUND_CONFLICT");outbound=new Transmission(++serial,OtaFrame.encode(type,json,binary));taken=false;deadline=now+SEND_MS;}
 private long replyWindow(){return state==State.TRANSFER?60000:state==State.STARTING||state==State.VERSION||state==State.MANIFEST?30000:15000;}
 private void cover(String name,int start,int end){
  TreeMap<Integer,Integer> ranges=coverage.get(name);if(ranges==null){ranges=new TreeMap<>();coverage.put(name,ranges);}
  int delta=0;Map.Entry<Integer,Integer> entry=ranges.floorEntry(start);
  if(entry!=null&&entry.getValue()>=start){start=entry.getKey();end=Math.max(end,entry.getValue());delta-=entry.getValue()-entry.getKey();ranges.remove(entry.getKey());}
  while((entry=ranges.ceilingEntry(start))!=null&&entry.getKey()<=end){end=Math.max(end,entry.getValue());delta-=entry.getValue()-entry.getKey();ranges.remove(entry.getKey());}
  ranges.put(start,end);delta+=end-start;covered+=delta;if("nuttx_ap.bin".equals(name))apCovered+=delta;
 }
 private Map<String,Object> record(String phase,boolean unresolved){return OtaFrame.object("schema",1,"candidate",Fixed60Profile.ZIP_SHA,"operation",operation,"peer_sha256",peerHash,"pending",unresolved,"phase",phase,"reason",reason,"first_failure",firstFailure,"started_at_epoch_ms",startEpoch,"requests",requests,"confirmed_messages",confirmed,"confirmed_bytes",sent,"covered_bytes",covered,"ap_covered_bytes",apCovered,"install_notice",installNotice,"boot_readback",bootReadback);}
 private boolean checkpoint(long now){try{journal.write(record(state.name(),true));return true;}catch(IOException|RuntimeException error){journalHealthy=false;fail("PROGRESS_JOURNAL_FAILED",now);return false;}}
 private void fail(String why,long now){
  State previous=state;
  reason=why;state=pending?State.UNKNOWN:State.LOCKED;outbound=null;taken=false;incoming.clear();deadline=grant=0;bootReadback=false;
  if(pending&&firstFailure.isEmpty())firstFailure=why;
  if(pending){firmware=null;if(previous!=State.UNKNOWN||recoverySince<0){recoverySince=now;reconnectSerial++;recovery=peer.isEmpty()?null:new OtaRecoveryGuard(peer,now,true);}if(journalHealthy)try{journal.write(record("UNKNOWN",true));}catch(IOException|RuntimeException error){journalHealthy=false;}}
 }
 private static void require(boolean ok,String reason){if(!ok)throw new IllegalStateException(reason);}
}
