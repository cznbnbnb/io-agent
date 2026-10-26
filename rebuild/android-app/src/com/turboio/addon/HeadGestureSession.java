package com.turboio.addon;

import java.util.*;

/** Durable, request-owned temporary head-gesture setting. No card or task execution. */
final class HeadGestureSession {
 interface Store { Object read() throws Exception; void save(Object value) throws Exception; }
 static final long SDK_MS=8000, READ_MS=8000, SETTLE_MS=1500, LEASE_MS=120000;
 static final class Setting {
  final boolean enabled; final int mode;
  Setting(boolean enabled,int mode){if(mode!=0&&mode!=1)throw new IllegalArgumentException();this.enabled=enabled;this.mode=mode;}
  Object json(){return OtaFrame.object("enabled",enabled,"mode",mode);}
  boolean same(Setting other){return other!=null&&enabled==other.enabled&&mode==other.mode;}
  static Setting read(Object raw){Map<String,Object> j=BoundedJson.map(raw);BoundedJson.keys(j,"enabled","mode");if(!(j.get("enabled") instanceof Boolean))throw new IllegalArgumentException();return new Setting((Boolean)j.get("enabled"),BoundedJson.number(j.get("mode"),0,1));}
 }
 static final class Emission {
  final long ticket; final String purpose; final byte[] bytes;
  Emission(long ticket,String purpose,Setting setting){this.ticket=ticket;this.purpose=purpose;
   bytes=OtaFrame.encode(setting==null?4:5,OtaFrame.object("cmd",setting==null?"request_general_settings":"head_gestures","payload",OtaFrame.object("value",setting==null?0:setting.enabled?1:0,"mode",setting==null?0:setting.mode,"data","")),null);
  }
 }
 private final Store store;
 private String phase="IDLE",note="",owner="",peerHash="",peer="",readPurpose="",guardToken="";
 private Setting original,desired,reply;
 private boolean healthy=true,pending,cardPending,override,uncertain,querySent,queryReceipt,coldRecovery,offConfirmed,restoreConfirmed;
 // 2026-10-23 (user): the last confirm card for a dictated answer is low risk, so the wearer may opt in
 // to answer it by nod (accept) / shake (reject). Such a guard reads the setting and holds it as is.
 private boolean keep;
 private int disableAttempts,restoreAttempts;
 private long generation,serial,flightUntil,readUntil,queryAt,heldUntil,writesSettledAt;
 private Emission flight,queued;

 HeadGestureSession(Store store){
  this.store=store;
  try{Object raw=store.read();if(raw!=null){Map<String,Object> j=BoundedJson.map(raw);BoundedJson.keys(j,"schema","pending","owner","peerHash","guardToken","original","desired","cardPending","override","uncertain");
   BoundedJson.number(j.get("schema"),1,1);if(!(j.get("pending") instanceof Boolean))throw new IllegalArgumentException();pending=(Boolean)j.get("pending");
   if(pending){coldRecovery=true;owner=key(j.get("owner"));peerHash=key(j.get("peerHash"));guardToken=BoundedJson.text(j.get("guardToken"),32);if(!guardToken.matches("[a-f0-9]{32}"))throw new IllegalArgumentException();original=Setting.read(j.get("original"));desired=Setting.read(j.get("desired"));
    if(!(j.get("cardPending") instanceof Boolean)||!(j.get("override") instanceof Boolean)||!(j.get("uncertain") instanceof Boolean))throw new IllegalArgumentException();cardPending=(Boolean)j.get("cardPending");override=(Boolean)j.get("override");uncertain=(Boolean)j.get("uncertain");
    if(!override&&!original.same(desired))throw new IllegalArgumentException();phase="RECOVERY_PENDING";note=cardPending?"原卡输入尚待结清，等待封存和清理":"需核对并恢复原设备设置";
   }
  }}catch(Exception invalid){healthy=false;phase="BLOCKED";note="头势保护记录不可读；不开放任务卡";}
 }
 private static String key(Object value){String s=BoundedJson.text(value,64);if(!s.matches("[a-f0-9]{64}"))throw new IllegalArgumentException();return s;}
 synchronized boolean healthy(){return healthy;}
 synchronized boolean pending(){return pending;}
 synchronized boolean cardPending(){return cardPending;}
 synchronized boolean matchesTarget(String target){return targetMatches(target);}
 synchronized boolean restoring(){return pending&&!cardPending&&("RESTORING".equals(phase)||"VERIFYING_RESTORED".equals(phase));}
 synchronized Object checkFacts(){return OtaFrame.object("phase",phase,"healthy",healthy,"pending",pending,"original",original==null?null:original.json(),"desired",desired==null?null:desired.json(),"off_confirmed",offConfirmed,"restore_confirmed",restoreConfirmed,"disable_attempts",disableAttempts,"restore_attempts",restoreAttempts,"overridden",override,"uncertain",uncertain);}
 synchronized String phase(){return phase;}
 synchronized String owner(){return owner;}
 synchronized String token(String request){return healthy&&pending&&owner.equals(request)?guardToken:"";}
 synchronized String status(){return phase+" · "+note;}
 synchronized boolean working(){return flight!=null||queued!=null||!readPurpose.isEmpty();}
 synchronized boolean active(String request){return healthy&&owner.equals(request)&&(pending||working());}
 synchronized boolean interested(String target){return targetMatches(target)&&(pending||working());}
 synchronized boolean ready(String request,String target,long gen,long now){return healthy&&pending&&!override&&phase.equals("HELD")&&owner.equals(request)&&same(target,gen)&&now<heldUntil;}

 synchronized boolean acquire(String request,String target,long gen,long now){return acquire(request,target,gen,now,false);}
 synchronized boolean keepsGestures(){return keep&&pending;}
 synchronized boolean acquire(String request,String target,long gen,long now,boolean keepGestures){
  if(!healthy||pending||working()||target==null||target.isEmpty()||target.length()>256||now<0)return false;
  try{key(request);}catch(RuntimeException bad){return false;}
  owner=request;peer=target;peerHash=FixedPeerHash.of(target);guardToken=UUID.randomUUID().toString().replace("-","");generation=gen;original=desired=null;override=cardPending=uncertain=false;
  offConfirmed=restoreConfirmed=false;keep=keepGestures;disableAttempts=restoreAttempts=0;phase="READING_ORIGINAL";note="读取待办头势原设置";read("original",now);return true;
 }
 /** Must be durably marked BEFORE a native show can enter the SDK queue. */
 synchronized boolean markCardPossible(String request,String target,long gen,long now){
  if(!ready(request,target,gen,now))return false;if(cardPending)return true;cardPending=true;return save();
 }
 synchronized boolean extendForPage(String request,String target,long gen,long now){if(!ready(request,target,gen,now))return false;heldUntil=now+LEASE_MS;return true;}
 synchronized boolean releaseInputClosed(String request,String target,long gen,long now,CardInputClosure proof){
  if(!healthy||!pending||proof==null||!owner.equals(request)||!targetMatches(target)||!proof.matches(owner,peerHash,guardToken))return false;
  // This closes the task input capability; it never certifies physical disappearance.
  return release(request,target,gen,now,true);
 }
 /** Direct observed exit, or releaseInputClosed's bound durable retirement, is required. */
 synchronized boolean release(String request,String target,long gen,long now,boolean cardExitConfirmed){
  if(!healthy||!pending||!owner.equals(request)||!targetMatches(target)||cardPending&&!cardExitConfirmed)return false;
  if(flight!=null&&(flight.purpose.equals("disable")||flight.purpose.equals("restore_write")))return false;
  cancel();peer=target;generation=gen;heldUntil=0;phase="RESTORING";note="核对原设备设置后恢复";
  if(cardPending){cardPending=false;if(!save())return false;}
  if(coldRecovery){writesSettledAt=Math.max(writesSettledAt,now+SDK_MS+SETTLE_MS);coldRecovery=false;}
  read("restore_inspect",Math.max(now,writesSettledAt));return true;
 }
 /** Cold recovery never grants a card lease or replays a previous request. */
 synchronized boolean recover(String target,long gen,long now){
  if(!healthy||!pending||cardPending||working()||!targetMatches(target))return false;
  return release(owner,target,gen,now,false);
 }
 synchronized Emission next(String target,long gen,long now){
  tick(target,gen,now);
  if(!healthy||flight!=null||!same(target,gen))return null;
  if(queued==null&&!readPurpose.isEmpty()&&!querySent&&now>=queryAt){queued=new Emission(++serial,readPurpose,null);querySent=true;queryReceipt=false;reply=null;readUntil=now+READ_MS;}
  if(queued==null)return null;flight=queued;queued=null;flightUntil=now+SDK_MS;if(flight.purpose.equals("disable")||flight.purpose.equals("restore_write")){writesSettledAt=flightUntil+SETTLE_MS;if(flight.purpose.equals("disable"))disableAttempts++;else restoreAttempts++;}return flight;
 }
 /** Last check at SDK admission, including after a newer user setting write. */
 synchronized boolean permits(Emission emission,String target,long gen,long now){
  tick(target,gen,now);return healthy&&same(target,gen)&&flight==emission;
 }
 synchronized void result(long ticket,boolean ok,long now){
  if(flight==null||flight.ticket!=ticket)return;Emission sent=flight;flight=null;
  if(sent.purpose.equals("disable")||sent.purpose.equals("restore_write")){
   // Even a failed/lost transport receipt may have applied the setting. Inspect, never blindly retry.
   phase=sent.purpose.equals("disable")?"VERIFYING_DISABLED":"VERIFYING_RESTORED";
   note=ok?"写入已提交，等待新鲜设置回读":"提交结果未知，读取实际设置";
   writesSettledAt=now+SETTLE_MS;read(sent.purpose.equals("disable")?"disabled":"restored",writesSettledAt);return;
  }
  if(!ok){stop("设置读取提交失败；未开放任务卡");return;}
  queryReceipt=true;if(reply!=null)finishRead(reply,now);
 }
 synchronized void receive(String target,long gen,byte[] bytes,long now){
  if(!healthy||!same(target,gen)||readPurpose.isEmpty()||!querySent||now<queryAt||now>=readUntil||reply!=null)return;
  try{OtaFrame f=OtaFrame.decode(bytes);if(f.type!=4||f.binary.length!=0)return;
   Map<String,Object> j=BoundedJson.map(f.json),general=BoundedJson.map(j.get("generalSettings"));
   // Settings frames contain other groups. Only the addressed head-gesture fields are consumed.
   Map<String,Object> h=BoundedJson.map(general.get("headGestures"));
   reply=new Setting(BoundedJson.number(h.get("enabled"),0,1)==1,BoundedJson.number(h.get("mode"),0,1));
   if(queryReceipt)finishRead(reply,now);
  }catch(RuntimeException malformed){/* An echo, malformed, unrelated or cached-before-query frame cannot certify disable. */}
 }
 private void finishRead(Setting actual,long now){
  String purpose=readPurpose;cancel();
  if(purpose.equals("original")){
   original=desired=actual;pending=true;phase="PREPARING";
   if(!save())return;
   if(actual.enabled&&keep){offConfirmed=false;phase="HELD";heldUntil=now+LEASE_MS;note="确认卡保留点头/摇头：点头提交，摇头留手机";}
   else if(actual.enabled){queued=new Emission(++serial,"disable",new Setting(false,actual.mode));phase="DISABLING";note="临时关闭待办点头/摇头确认";}
   else held(now);
  }else if(purpose.equals("disabled")){
   if(actual.same(new Setting(false,original.mode))&&!override)held(now);
   else stop("无法确认头势已关闭；保留恢复义务，使用手机待答");
  }else if(purpose.equals("restore_inspect")){
   if(uncertain){desired=actual;override=true;uncertain=false;if(!save())return;clear();return;}
   if(actual.same(desired)){clear();return;}
   // After restart, a different mode/value can be an unobserved newer preference. Preserve it.
   if(!override&&!actual.same(new Setting(false,original.mode))){desired=actual;override=true;if(!save())return;clear();return;}
   if(!original.enabled&&!override){desired=actual;override=true;if(!save())return;clear();return;}
   queued=new Emission(++serial,"restore_write",desired);phase="RESTORING";note="恢复用户最新的待办头势设置";
  }else if(purpose.equals("restored")){
   if(actual.same(desired))clear();else stop("恢复尚未回读确认；保留记录，不重复写入");
  }else stop("未知设置读取阶段");
 }
 private void held(long now){offConfirmed=true;phase="HELD";heldUntil=now+LEASE_MS;note="待办头势已确认关闭；仅原问题可使用此保护";}
 private void clear(){pending=false;cardPending=false;if(!save()){pending=true;return;}restoreConfirmed=true;phase="IDLE";note="待办头势设置已回读确认，保护结束";}
 private void read(String purpose,long at){readPurpose=purpose;queryAt=at;querySent=queryReceipt=false;reply=null;readUntil=0;}
 private void cancel(){flight=queued=null;readPurpose="";querySent=queryReceipt=false;reply=null;readUntil=0;}
 private void stop(String reason){cancel();heldUntil=0;phase=pending?"RECOVERY_PENDING":"BLOCKED";note=reason;}
 synchronized void fault(String reason){stop(reason);}
 synchronized void tick(String target,long gen,long now){
  if(!healthy)return;
  if((working()||phase.equals("HELD"))&&!same(target,gen)){stop("连接已变化；等待原设备恢复，不发送旧操作");return;}
  if(phase.equals("HELD")&&now>=heldUntil){stop("任务卡保护期限已到；等待卡片清理后恢复");return;}
  if(flight!=null&&now>=flightUntil){result(flight.ticket,false,now);return;}
  if(querySent&&now>=readUntil)stop("设置回读超时；不开放任务卡");
 }
 /** SDK admission hook calls this synchronously BEFORE accepting another head-setting write. */
 synchronized boolean userWrite(String target,Setting setting){
  if(!targetMatches(target)||!pending&&!working())return true;
  if(!pending){stop("用户正在更改头势设置；本次不发任务卡");return true;}
  cancel();heldUntil=0;desired=setting;override=true;uncertain=false;phase="RECOVERY_PENDING";note="已采用用户最新设置；任务卡需退出后才核对恢复";
  return save();
 }
 synchronized boolean unknownWrite(String target){
  if(!interested(target))return true;
  if(!pending){stop("设置流量无法识别；本次不发任务卡");return true;}
  cancel();heldUntil=0;uncertain=true;phase="RECOVERY_PENDING";note="出现无法识别的设置流量；保留实际设置，卡片需退出";return save();
 }
 private boolean targetMatches(String target){return target!=null&&!target.isEmpty()&&target.length()<=256&&peerHash.equals(FixedPeerHash.of(target));}
 private boolean same(String target,long gen){return !peer.isEmpty()&&peer.equals(target)&&generation==gen;}
 private boolean save(){
  try{store.save(OtaFrame.object("schema",1,"pending",pending,"owner",owner,"peerHash",peerHash,"guardToken",guardToken,"original",original==null?null:original.json(),"desired",desired==null?null:desired.json(),"cardPending",cardPending,"override",override,"uncertain",uncertain));return true;}
  catch(Exception failure){healthy=false;cancel();heldUntil=0;phase="BLOCKED";note="保护记录保存失败；不发卡，不覆盖用户设置";return false;}
 }
}
