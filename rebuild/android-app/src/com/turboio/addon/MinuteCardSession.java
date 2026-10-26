package com.turboio.addon;

import java.util.*;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;

/** Isolated synthetic native suggestion. No task, microphone, or server capability. */
final class MinuteCardSession {
 interface Store {Object read()throws Exception;void save(Object value)throws Exception;}
 static final long GUARD_MS=120000, QUERY_MS=15000, SDK_MS=8000;
 static final class Emission {
  final long ticket;final int business,type;final byte[] bytes;
  Emission(long ticket,int business,int type,Object json){this.ticket=ticket;this.business=business;this.type=type;bytes=OtaFrame.encode(type,json,null);}
 }
 private final Store store;private final ArrayDeque<Emission> queue=new ArrayDeque<>();
 private Emission flight;private long serial,generation,queryUntil,flightUntil,started,cleanupAt;
 private String peer="",peerHash="",uid="",phase="IDLE",note="等待测试";
 private boolean pending,healthy=true,version,idle,showAfterCheck;private int action,showSent,removeSent,ackSent;
 MinuteCardSession(Store store){
  this.store=store;
  try{Object raw=store.read();if(raw!=null){Map<String,Object> j=BoundedJson.map(raw);
   if(BoundedJson.number(j.get("schema"),1,1)!=1)throw new IllegalStateException();
   pending=Boolean.TRUE.equals(j.get("pending"));
   if(pending){uid=BoundedJson.text(j.get("uid"),64);peerHash=BoundedJson.text(j.get("peerHash"),64);
    if(!uid.matches("minute-[a-f0-9]{32}")||!peerHash.matches("[a-f0-9]{64}"))throw new IllegalStateException();
    action=BoundedJson.number(j.get("action"),0,2);phase="CLEANUP_PENDING";note="上次测试未核对退出；仅可清理原卡，不会重放";}
  }}catch(Exception bad){healthy=false;phase="BLOCKED";note="测试记录不可读";}
 }
 boolean pending(){return pending;}boolean healthy(){return healthy;}
 String phase(){return phase;}String uid(){return uid;}int action(){return action;}
 boolean working(){return flight!=null||!queue.isEmpty()||phase.equals("CHECKING")||phase.equals("ACTIVE")||phase.equals("ACK_WAIT")||phase.equals("REMOVING");}
 String status(long now){return "阶段="+phase+" · 退出待确认="+pending+"\n"+note+
  "\n原生显示提交="+showSent+" · 选择="+(action==1?"接受":action==2?"拒绝":"未收到")+" · 应答提交="+ackSent+" · 清理提交="+removeSent+
  (started>0&&pending&&working()?"\n显示尝试后="+Math.max(0,(now-started)/1000)+"秒":"")+
  "\nApp兜底清理=120秒；发送成功不等于镜片显示或一分钟通过";}
 boolean inspect(String target,long gen,long now,boolean show){
  if(!healthy||pending||working()||target==null||target.isEmpty())return false;
  peer=target;peerHash=hash(target);generation=gen;phase="CHECKING";note="正在只读核对版本、验证状态及空闲";
  version=idle=false;showAfterCheck=show;queryUntil=now+QUERY_MS;started=cleanupAt=0;action=showSent=removeSent=ackSent=0;
  add(9,1,null);add(9,11,null);return true;
 }
 Emission next(long now){if(!healthy||flight!=null||queue.isEmpty())return null;flight=queue.removeFirst();flightUntil=now+SDK_MS;
  if(flight.business==21){if(flight.type==35)ackSent++;else if(phase.equals("SHOWING"))showSent++;else removeSent++;}
  return flight;
 }
 void result(long ticket,boolean ok,long now){
  if(flight==null||flight.ticket!=ticket)return;Emission sent=flight;flight=null;
  if(!ok){stop("SDK提交失败或超时；不自动重试");return;}
  if(sent.business==9)return;
  if(sent.type==35){phase="ACK_WAIT";cleanupAt=Math.min(started+GUARD_MS,now+2500);note="选择已记录并应答，等待退出动画";}
  else if(phase.equals("SHOWING")){phase="ACTIVE";note="原生卡已获SDK发送确认，请观察镜片实际时长";}
  else if(phase.equals("REMOVING")){phase="REMOVAL_SUBMITTED";note="清理已获SDK发送确认；仍需观察镜片回首页";}
 }
 void receive(String target,long gen,int business,byte[] bytes,long now){
  if(!healthy||!same(target,gen))return;
  try{OtaFrame f=OtaFrame.decode(bytes);if(f.binary.length!=0)return;Map<String,Object> j=BoundedJson.map(f.json);
   if(business==9&&phase.equals("CHECKING")&&now<queryUntil){
    // Only accept replies to queries actually submitted, never unsolicited cached status.
    boolean asked=flight!=null&&flight.business==9&&flight.type==f.type||!queue.stream().anyMatch(e->e.business==9&&e.type==f.type);
    if(!asked)return;
    if(f.type==1){version="Strix OS 1.0.5.5".equals(j.get("OsVersion"))&&"idle".equals(j.get("OtaValidationState"))&&Boolean.TRUE.equals(j.get("OtaValidationConfirmed"))&&BoundedJson.list(j.get("PackageTypes")).contains("files");if(!version){stop("版本或验证状态未满足");return;}}
    else if(f.type==11){idle=LifelogState.idle(j.get("Result"));if(!idle){stop("眼镜当前不空闲");return;}}else return;
    if(version&&idle){if(!showAfterCheck){phase="READY";note="只读检查通过；发送前仍会重新检查";}else show(now);}return;
   }
   if(business!=21||f.type!=34||!pending||!(phase.equals("ACTIVE")||phase.equals("SHOWING"))||action!=0||now>=started+GUARD_MS)return;
   BoundedJson.keys(j,"suggestUID","suggestType","cmd");
   if(!uid.equals(j.get("suggestUID"))||BoundedJson.number(j.get("suggestType"),2,2)!=2)return;
   int cmd=BoundedJson.number(j.get("cmd"),1,2);action=cmd;
   if(!save()){stop("选择记录写入失败，未应答");return;}
   add(21,35,OtaFrame.object("suggestUID",uid,"suggestType",2,"code",0));phase="ACK_PENDING";note="已收到本卡选择；等待原生应答";
  }catch(RuntimeException malformed){/* Other or malformed messages never become user actions. */}
 }
 private void show(long now){
  uid="minute-"+UUID.randomUUID().toString().replace("-","");pending=true;started=now;cleanupAt=now+GUARD_MS;
  phase="SHOWING";note="已保存退出意图，准备原生卡";
  if(!save()){stop("无法保存退出意图，未显示");return;}
  add(21,33,OtaFrame.object("suggestUID",uid,"suggestType",2,"type",1,"title","一分钟验证","source","本地实验","content","静置观察；本卡不执行电脑任务"));
 }
 void tick(String target,long gen,long now,boolean foreground){
  if(!healthy)return;
  if(working()&&!same(target,gen)){stop("连接变化；保留原卡清理记录");return;}
  if(!foreground&&working()){if(pending)remove(target,gen,now);else stop("测试页已退出");}
  if(flight!=null&&now>=flightUntil){result(flight.ticket,false,now);return;}
  if(phase.equals("CHECKING")&&now>=queryUntil){stop("只读检查超时，未显示");return;}
  if((phase.equals("ACTIVE")||phase.equals("ACK_WAIT")||phase.equals("ACK_PENDING")||phase.equals("SHOWING"))&&pending&&now>=cleanupAt&&flight==null)remove(target,gen,now);
 }
 boolean remove(String target,long gen,long now){
  if(!healthy||!pending||flight!=null||target==null||!peerHash.equals(hash(target)))return false;
  peer=target;generation=gen;queue.clear();phase="REMOVING";note="清理同一副眼镜的原卡";
  add(21,33,OtaFrame.object("suggestUID",uid,"suggestType",2,"type",2,"title","","source","","content",""));return true;
 }
 boolean confirmGone(String observation){
  if(!healthy||!pending||!phase.equals("REMOVAL_SUBMITTED")||flight!=null||!"镜片已回首页".equals(observation))return false;
  pending=false;if(!save()){pending=true;return false;}phase="IDLE";note="已记录镜片回首页；一分钟结果另行登记";return true;
 }
 void stop(String reason){queue.clear();flight=null;phase=pending?"CLEANUP_PENDING":"BLOCKED";note=reason;}
 private boolean same(String target,long gen){return !peer.isEmpty()&&peer.equals(target)&&generation==gen;}
 private void add(int business,int type,Object json){queue.addLast(new Emission(++serial,business,type,json));}
 private boolean save(){try{store.save(OtaFrame.object("schema",1,"pending",pending,"uid",uid,"peerHash",peerHash,"action",action));return true;}catch(Exception failure){healthy=false;return false;}}
 private static String hash(String value){try{byte[] bytes=MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8));StringBuilder s=new StringBuilder();for(byte b:bytes)s.append(String.format(java.util.Locale.ROOT,"%02x",b&255));return s.toString();}catch(Exception e){throw new IllegalStateException(e);}}
}
