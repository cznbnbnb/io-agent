package com.turboio.addon;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.*;

/** Passive fixed1.0.5.5 policy, derived from the pinned upstream OfficialOtaGate.
 * Never generates or sends a command. The adapter must forward only the returned frozen bytes.
 * Admitted bytes mean policy approval, never SDK/device receipt or installation proof.
 */
final class Fixed60OfficialGate {
 interface Store {Map<String,Object> read()throws IOException;void write(Map<String,Object> record)throws IOException;}
 enum Phase {LOCKED,ARMED,STARTING,VERSION,MANIFEST,TRANSFER,INSTALLING,UNKNOWN,READBACK,RELEASED}
 static final long FRESH_MS=120000,QUERY_MS=15000,GRANT_MS=900000,TRANSFER_MS=900000;
 private final Store store;
 private Phase phase=Phase.LOCKED;
 private Fixed60Firmware firmware;
 private String peer="",peerHash="",operation="",error="",firstFailure="";
 private long connection=-1,last,grant,deadline,transferUntil,startEpoch,recoverySince=-1,readbackUntil,inspectionUntil;
 private final long[] requested=new long[12],fresh=new long[12];
 private final boolean[] good=new boolean[12];
 private boolean pending,healthy=true,clockHealthy=true,wantVersion,wantManifest,installNotice,bootReadback;
 private Map<String,Object> requestedSlice;
 private int requests,messages,bytes,apCovered,events;
 private final TreeMap<Integer,Integer> apRanges=new TreeMap<>();
 private final Map<String,Integer> repeats=new HashMap<>();
 private OtaRecoveryGuard recovery;

 Fixed60OfficialGate(Store store,long now)throws IOException{
  if(store==null||now<0)throw new IllegalArgumentException("OFFICIAL_GATE_CONSTRUCTOR");this.store=store;last=now;clearReads();
  Map<String,Object> saved=store.read();if(saved==null)return;
  try{Fixed60OfficialJournal.validate(saved);}catch(RuntimeException invalid){throw new IOException("OFFICIAL_JOURNAL_INVALID",invalid);}
  if(Boolean.TRUE.equals(saved.get("pending"))){
   pending=true;phase=Phase.UNKNOWN;peerHash=(String)saved.get("peer_sha256");operation=(String)saved.get("operation");startEpoch=((Number)saved.get("started_at_epoch_ms")).longValue();
   requests=num(saved,"requests");messages=num(saved,"admitted_messages");bytes=num(saved,"admitted_bytes");apCovered=num(saved,"ap_covered_bytes");
   installNotice=Boolean.TRUE.equals(saved.get("install_notice"));firstFailure=(String)saved.get("first_failure");error="RESTART_UNKNOWN";recoverySince=now;
  }
 }
 private static int num(Map<String,Object> r,String k){return ((Number)r.get(k)).intValue();}
 private static String hashPeer(String p){return Fixed60Firmware.hash("SHA-256",p.getBytes(StandardCharsets.UTF_8));}
 private void clearReads(){Arrays.fill(requested,-1);Arrays.fill(fresh,-1);Arrays.fill(good,false);}
 synchronized Phase phase(){return phase;}synchronized boolean pending(){return pending;}synchronized String error(){return error;}
 synchronized String firstFailure(){return firstFailure;}synchronized boolean healthy(){return healthy&&clockHealthy;}
 synchronized int requests(){return requests;}synchronized int admittedMessages(){return messages;}synchronized int admittedBytes(){return bytes;}
 synchronized int apCovered(){return apCovered;}synchronized boolean installNotice(){return installNotice;}
 synchronized boolean bootReadback(){return bootReadback;}
 synchronized String expectedPeerHash(){return peerHash;}
 synchronized boolean queryPending(int type,long now){return type>0&&type<requested.length&&requested[type]>=0&&now>=requested[type]&&now-requested[type]<=QUERY_MS;}
 synchronized String recoveryStatus(long now){return recovery==null?"":recovery.status(now);}
 private boolean clock(long now){if(now<0||now<last){clockHealthy=false;fail("MONOTONIC_CLOCK_REVERSED",last);return false;}last=now;return clockHealthy;}
 private static boolean validPeer(String p){return p!=null&&!p.isEmpty()&&p.length()<=256;}
 private boolean same(String p,long generation){return peer.equals(p)&&connection==generation;}
 synchronized void bind(String current,long generation,long now){
  require(clock(now)&&healthy&&!pending&&phase==Phase.LOCKED&&validPeer(current)&&generation>=0,"BIND_DENIED");
  if(!same(current,generation)){peer=current;connection=generation;clearReads();}
 }
 private boolean recent(int type,long now){return good[type]&&fresh[type]>=0&&now>=fresh[type]&&now-fresh[type]<FRESH_MS;}
 synchronized boolean ready(long now){return clock(now)&&healthy&&!pending&&phase==Phase.LOCKED&&recent(1,now)&&recent(2,now)&&recent(11,now);}
 synchronized String preflight(long now){return "版本="+recent(1,now)+" 电量="+recent(2,now)+" 空闲="+recent(11,now)+" 空间="+recent(3,now);}
 /** Allows only the vendor's exact space query; does not create a Mode2 grant. */
 synchronized void inspectCandidate(Fixed60Firmware candidate,String current,long generation,long now){
  require(ready(now)&&candidate!=null&&same(current,generation),"INSPECTION_DENIED");firmware=candidate;inspectionUntil=now+FRESH_MS;
 }
 synchronized void arm(Fixed60Firmware candidate,String token,String current,long generation,long now){
  require(ready(now)&&candidate!=null&&Fixed60Profile.ID.equals(token)&&same(current,generation),"ARM_DENIED");
  firmware=candidate;operation=UUID.randomUUID().toString();peerHash=hashPeer(peer);grant=now+GRANT_MS;inspectionUntil=0;phase=Phase.ARMED;error=firstFailure="";
  requests=messages=bytes=apCovered=events=0;apRanges.clear();repeats.clear();requestedSlice=null;wantVersion=wantManifest=installNotice=bootReadback=false;
  good[3]=false;fresh[3]=requested[3]=-1;
 }
 synchronized void tick(String current,long generation,long now,boolean foreground,boolean serviceReady){
  if(!clock(now))return;
  if(!pending&&phase==Phase.LOCKED&&inspectionUntil>0&&now>=inspectionUntil){inspectionUntil=0;firmware=null;good[3]=false;}
  if(pending&&(phase==Phase.UNKNOWN||phase==Phase.INSTALLING)&&validPeer(current)&&generation>=0&&peerHash.equals(hashPeer(current))&&!same(current,generation)){
   // A transport generation may change; the original canonical identity cannot.
   peer=current;connection=generation;clearReads();bootReadback=false;readbackUntil=0;recovery=new OtaRecoveryGuard(peer,recoverySince<0?now:recoverySince,true);
  }
  if(recovery!=null){if(connection!=generation)recovery.observe("",now);recovery.observe(current,now);}
  if(phase==Phase.ARMED&&(!same(current,generation)||!foreground||!serviceReady||now>=grant)){fail("UNUSED_GRANT_REVOKED",now);return;}
  if(pending&&phase!=Phase.UNKNOWN&&phase!=Phase.INSTALLING){
   if(!same(current,generation)||!foreground||phase!=Phase.READBACK&&!serviceReady){fail("TRANSFER_CONTEXT_LOST",now);return;}
   if(phase!=Phase.READBACK&&(now>=transferUntil||deadline>0&&now>=deadline)){fail("OFFICIAL_RESPONSE_TIMEOUT",now);return;}
  }
  if(bootReadback&&(!same(current,generation)||now>=readbackUntil)){bootReadback=false;fail("READBACK_EXPIRED",now);}
 }
 /** Null denies; non-null is the exact detached wire image that the SDK may enqueue once. */
 synchronized byte[] outbound(String current,long generation,byte[] raw,long now,long epoch,boolean foreground,boolean serviceReady){
  tick(current,generation,now,foreground,serviceReady);
  try{
   require(healthy&&clockHealthy&&validPeer(current)&&same(current,generation)&&foreground,"OUTBOUND_CONTEXT_INVALID");
   require(raw!=null&&raw.length<=65536,"OUTBOUND_BUDGET");byte[] frozen=raw.clone();OtaFrame f=OtaFrame.decode(frozen);
   if(OtaFrame.readOnly(frozen)){
    if(pending&&(phase==Phase.UNKNOWN||phase==Phase.INSTALLING||phase==Phase.READBACK))require(recoveryAllowed(current,generation,now)&&now<readbackUntil,"RECOVERY_READ_NOT_AUTHORIZED");
    requested[f.type]=now;return frozen;
   }
   if(f.type==3){require((phase==Phase.ARMED||phase==Phase.LOCKED&&now<inspectionUntil)&&!pending&&firmware!=null&&f.binary.length==0&&sameJson(f.json,OtaFrame.object("OtaSize",Fixed60Profile.ZIP_SIZE)),"SPACE_REQUEST_INVALID");requested[3]=now;return frozen;}
   if(f.type==4){
    require(!pending&&phase==Phase.ARMED&&now<grant&&firmware!=null,"UNUSED_GRANT_REQUIRED");
    require(serviceReady&&f.binary.length==0&&sameJson(f.json,OtaFrame.object("Mode",2)),"MODE2_REQUIRED");
    require(recent(1,now)&&recent(2,now)&&recent(3,now)&&recent(11,now)&&epoch>0,"PREFLIGHT_REQUIRED");
    startEpoch=epoch;pending=true;messages=1;phase=Phase.STARTING;grant=0;deadline=now+30000;transferUntil=now+TRANSFER_MS;
    // A failed or ambiguous durable write blocks this very first command.
    if(!save("START_INTENT",now))return null;return frozen;
   }
   require(pending&&firmware!=null&&serviceReady,"LIVE_TRANSFER_REQUIRED");
   if(f.type==5){require(phase==Phase.VERSION&&wantVersion&&f.binary.length==0&&sameJson(f.json,OtaFrame.object("OtaVersion",Fixed60Profile.VERSION)),"VERSION_RESPONSE_INVALID");wantVersion=false;phase=Phase.MANIFEST;deadline=now+30000;}
   else if(f.type==6){require(phase==Phase.MANIFEST&&wantManifest&&f.binary.length==0&&sameJson(f.json,firmware.manifest()),"MANIFEST_INVALID");wantManifest=false;phase=Phase.TRANSFER;deadline=now+60000;}
   else if(f.type==7){
    require(phase==Phase.TRANSFER&&requestedSlice!=null&&sameJson(f.json,requestedSlice),"SLICE_NOT_REQUESTED");
    String name=(String)requestedSlice.get("Name");int start=num(requestedSlice,"Start"),size=num(requestedSlice,"Size");
    require(Arrays.equals(f.binary,firmware.slice(name,start,size)),"SLICE_BYTES_DIFFER");
    require(bytes<=firmware.payloadBytes()*3-size,"TRANSFER_BUDGET");requestedSlice=null;bytes+=size;if("nuttx_ap.bin".equals(name))cover(start,start+size);deadline=now+60000;
   }else throw new IllegalStateException("OUTGOING_TYPE_UNSUPPORTED");
   require(messages<12000,"MESSAGE_BUDGET");messages++;if(!save(phase.name(),now))return null;return frozen;
  }catch(RuntimeException invalid){fail(code(invalid,"OUTBOUND_INVALID"),now);return null;}
 }
 /** Synchronous observation must run before forwarding the unchanged event to Flutter. */
 synchronized void inbound(String source,long generation,byte[] raw,long now){
  if(!clock(now)||!same(source,generation))return;
  try{
   require(raw!=null&&raw.length<=8192&&(!(pending||phase==Phase.ARMED)||++events<=8192),"INBOUND_BUDGET");OtaFrame f=OtaFrame.decode(raw.clone());require(f.binary.length==0,"INBOUND_BINARY");Map<String,Object> j=BoundedJson.map(f.json);
   if(f.type==1||f.type==2||f.type==3||f.type==11){
    if(requested[f.type]<0||now-requested[f.type]>QUERY_MS)return;requested[f.type]=-1;good[f.type]=false;fresh[f.type]=now;
    if(f.type==1)good[1]=Fixed60Profile.VERSION.equals(j.get("OsVersion"))&&"idle".equals(j.get("OtaValidationState"))&&Boolean.TRUE.equals(j.get("OtaValidationConfirmed"))&&BoundedJson.list(j.get("PackageTypes")).contains("files");
    else if(f.type==2)good[2]=BoundedJson.number(j.get("BatteryLevel"),0,100)>=50;
    else good[f.type]=Boolean.TRUE.equals(j.get("Result"));
    if(pending&&now<readbackUntil&&recent(1,now)&&recent(11,now)&&recoveryAllowed(source,generation,now)){phase=Phase.READBACK;bootReadback=true;save("READBACK",now);}return;
   }
   if(!pending||phase==Phase.UNKNOWN||phase==Phase.READBACK)return;
   if(f.type==10)throw new IllegalStateException("DEVICE_ERROR_"+BoundedJson.number(j.get("errcode"),0,65535));
   if(f.type==8){BoundedJson.keys(j,"Progress");BoundedJson.number(j.get("Progress"),0,1000000);return;}
   if(phase==Phase.INSTALLING){require(f.type==9&&j.isEmpty(),"INSTALL_TRAFFIC_INVALID");return;}
   require(now<transferUntil&&(deadline==0||now<deadline),"OFFICIAL_RESPONSE_TIMEOUT");
   if(f.type==4){require(phase==Phase.STARTING&&Boolean.TRUE.equals(j.get("Result")),"START_REJECTED");phase=Phase.VERSION;deadline=now+30000;}
   else if(f.type==5){require(phase==Phase.VERSION&&!wantVersion&&j.isEmpty(),"VERSION_REQUEST_INVALID");wantVersion=true;}
   else if(f.type==6){require(phase==Phase.MANIFEST&&!wantManifest&&sameJson(j,OtaFrame.object("OtaVersion",Fixed60Profile.VERSION)),"MANIFEST_REQUEST_INVALID");wantManifest=true;}
   else if(f.type==7){
    require(phase==Phase.TRANSFER&&requestedSlice==null&&firmware!=null,"SLICE_REQUEST_OVERLAP");BoundedJson.keys(j,"Name","Start","Size");
    String name=BoundedJson.text(j.get("Name"),64);int start=BoundedJson.number(j.get("Start"),0,Integer.MAX_VALUE),size=BoundedJson.number(j.get("Size"),1,51200);firmware.slice(name,start,size);
    require(requests<2000&&bytes<=firmware.payloadBytes()*3-size,"REQUEST_BUDGET");String key=name+":"+start+":"+size;int count=repeats.containsKey(key)?repeats.get(key):0;require(count<8,"REPEATED_SLICE_BUDGET");repeats.put(key,count+1);requests++;
    requestedSlice=OtaFrame.object("Name",name,"Start",start,"Size",size);deadline=now+60000;
   }else if(f.type==9){
    require(phase==Phase.TRANSFER&&requestedSlice==null&&j.isEmpty()&&apCovered==Fixed60Profile.AP_SIZE,"PREMATURE_INSTALL_NOTICE");
    installNotice=true;phase=Phase.INSTALLING;firmware=null;deadline=0;recoverySince=now;recovery=new OtaRecoveryGuard(peer,now,true);clearReads();
   }else throw new IllegalStateException("INCOMING_TYPE_UNSUPPORTED");
   save(phase.name(),now);
  }catch(RuntimeException invalid){if(raw!=null)try{int type=OtaFrame.decode(raw).type;if(type<12){good[type]=false;requested[type]=-1;}}catch(RuntimeException ignored){}fail(code(invalid,"INBOUND_INVALID"),now);}
 }
 private boolean recoveryAllowed(String current,long generation,long now){return pending&&healthy&&clockHealthy&&same(current,generation)&&recovery!=null&&recovery.allowed(current,now);}
 synchronized boolean confirmHome(String assertion,String current,long generation,long now){
  if(!clock(now)||!pending||!healthy||!(phase==Phase.UNKNOWN||phase==Phase.INSTALLING)||!validPeer(current)||!peerHash.equals(hashPeer(current)))return false;
  if(!same(current,generation)){peer=current;connection=generation;clearReads();readbackUntil=0;recovery=new OtaRecoveryGuard(peer,recoverySince<0?now:recoverySince,true);}
  if(recovery==null)recovery=new OtaRecoveryGuard(peer,recoverySince<0?now:recoverySince,true);
  return recovery.confirmHome(assertion,current,now);
 }
 synchronized boolean beginReadback(String current,long generation,long now){
  if(!clock(now)||!(phase==Phase.UNKNOWN||phase==Phase.INSTALLING)||!recoveryAllowed(current,generation,now))return false;
  clearReads();bootReadback=false;readbackUntil=now+FRESH_MS;return true;
 }
 synchronized boolean release(String assertion,String current,long generation,long now){
  if(!clock(now)||!"已检查镜片".equals(assertion)||phase!=Phase.READBACK||!bootReadback||now>=readbackUntil||!recent(1,now)||!recent(11,now)||!recoveryAllowed(current,generation,now))return false;
  try{store.write(record("RELEASED",false));}catch(IOException|RuntimeException bad){healthy=false;fail("RELEASE_JOURNAL_FAILED",now);return false;}
  pending=false;phase=Phase.RELEASED;firmware=null;recovery=null;return true;
 }
 synchronized void revoke(long now){if(clock(now)&&!pending)fail("UNUSED_GRANT_REVOKED",now);}
 synchronized void abort(String reason,long now){if(clock(now))fail(reason!=null&&reason.matches("[A-Z0-9_]{1,128}")?reason:"ADAPTER_FAILURE",now);}
 private void cover(int start,int end){Map.Entry<Integer,Integer> e=apRanges.floorEntry(start);if(e!=null&&e.getValue()>=start){start=e.getKey();end=Math.max(end,e.getValue());apCovered-=e.getValue()-e.getKey();apRanges.remove(e.getKey());}while((e=apRanges.ceilingEntry(start))!=null&&e.getKey()<=end){end=Math.max(end,e.getValue());apCovered-=e.getValue()-e.getKey();apRanges.remove(e.getKey());}apRanges.put(start,end);apCovered+=end-start;}
 private Map<String,Object> record(String p,boolean unresolved){return OtaFrame.object("schema",1,"candidate",Fixed60Profile.ZIP_SHA,"operation",operation,"peer_sha256",peerHash,"pending",unresolved,"phase",p,"first_failure",firstFailure,"started_at_epoch_ms",startEpoch,"requests",requests,"admitted_messages",messages,"admitted_bytes",bytes,"ap_covered_bytes",apCovered,"install_notice",installNotice,"boot_readback",bootReadback);}
 private boolean save(String p,long now){try{store.write(record(p,true));return true;}catch(IOException|RuntimeException bad){healthy=false;fail("JOURNAL_FAILED",now);return false;}}
 private void fail(String why,long now){
  boolean firstUnknown=phase!=Phase.UNKNOWN;error=why;grant=deadline=readbackUntil=inspectionUntil=0;firmware=null;requestedSlice=null;wantVersion=wantManifest=bootReadback=false;clearReads();phase=pending?Phase.UNKNOWN:Phase.LOCKED;
  if(pending){if(firstFailure.isEmpty())firstFailure=why;if(firstUnknown||recoverySince<0){recoverySince=now;recovery=validPeer(peer)?new OtaRecoveryGuard(peer,now,true):null;}if(healthy)try{store.write(record("UNKNOWN",true));}catch(IOException|RuntimeException bad){healthy=false;}}
 }
 private static boolean sameJson(Object a,Object b){return Arrays.equals(BoundedJson.canonical(a),BoundedJson.canonical(b));}
 private static String code(RuntimeException e,String fallback){String s=e.getMessage();return s!=null&&s.matches("[A-Z0-9_]{1,128}")?s:fallback;}
 private static void require(boolean ok,String why){if(!ok)throw new IllegalStateException(why);}
}
