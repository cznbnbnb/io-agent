package com.turboio.addon;

import java.util.*;

/** Request-owned suggestion lifecycle. Durable semantic choice precedes mailbox and native ACK. */
final class AgentCardSession {
 interface Store {Object read()throws Exception;void save(Object value)throws Exception;}
 static final long SDK_MS=8000,CARD_MS=120000,ANIMATION_MS=2500;
 static final class Emission {
  final long ticket;final String purpose,uid;final int type;final byte[] bytes;
  Emission(long ticket,String purpose,String uid,int type,Object body){this.ticket=ticket;this.purpose=purpose;this.uid=uid;this.type=type;bytes=OtaFrame.encode(type,body,null);}
 }
 static final class Answer {
  final AgentCardRequest request;final int selected;final String operation,text;final Object option;
  Answer(AgentCardRequest request,int selected){this.request=request;this.selected=selected;operation=request.operation();text=request.answerText(selected);option=request.option(selected);}
 }
 private final Store store;private final List<String> uids=new ArrayList<>();private final List<Object> drafts=new ArrayList<>();
 private AgentCardRequest request;private String peer="",peerHash="",phase="IDLE",note="",uid="",answerFailure="",guardToken="";
 private boolean healthy=true,pending,cardMayExist,answerSaved,choiceSeen,showSubmitted,inputRetired,cleanupSubmitted;
 private int index,selected=-1,cleanupIndex;private long generation,serial,flightUntil,deadline,after,answerAt;
 private Emission queued,flight;
 AgentCardSession(Store store){
  this.store=store;
  try{Object raw=store.read();if(raw!=null){Map<String,Object> j=WireJson.map(raw);BoundedJson.keys(j,"schema","pending","request","peerHash","guardToken","uids","index","selected","answerSaved","answerFailure","cardMayExist","choiceSeen","answerAt","inputRetired","cleanupSubmitted","drafts");
   TaskWire.require(TaskWire.positive(j.get("schema"))==1&&j.get("pending") instanceof Boolean,"TASK_CARD_STORE_INVALID");pending=(Boolean)j.get("pending");
   List<Object> savedDrafts=WireJson.list(j.get("drafts"));TaskWire.require(savedDrafts.size()<=64,"TASK_CARD_STORE_INVALID");for(Object value:savedDrafts){Map<String,Object> draft=WireJson.map(value);BoundedJson.keys(draft,"request","selected","error","at");AgentCardRequest old=AgentCardRequest.restore(draft.get("request"));BoundedJson.number(draft.get("selected"),0,old.size()-1);TaskWire.require(TaskWire.text(draft.get("error"),64,false).matches("[A-Z][A-Z0-9_]{0,63}"),"TASK_CARD_STORE_INVALID");TaskWire.positive(draft.get("at"));drafts.add(WireJson.copy(draft));}
   if(pending||j.get("request")!=null){request=AgentCardRequest.restore(j.get("request"));peerHash=hashKey(j.get("peerHash"));
    for(Object value:WireJson.list(j.get("uids"))){String id=TaskWire.id(value);TaskWire.require(isOwnUid(id)&&!uids.contains(id),"TASK_CARD_STORE_INVALID");uids.add(id);}
    TaskWire.require(!uids.isEmpty()&&uids.size()<=4,"TASK_CARD_STORE_INVALID");uid=uids.get(uids.size()-1);index=BoundedJson.number(j.get("index"),0,request.size()-1);selected=BoundedJson.number(j.get("selected"),-1,request.size()-1);
    TaskWire.require(j.get("answerSaved") instanceof Boolean&&j.get("cardMayExist") instanceof Boolean&&j.get("choiceSeen") instanceof Boolean&&j.get("inputRetired") instanceof Boolean&&j.get("cleanupSubmitted") instanceof Boolean,"TASK_CARD_STORE_INVALID");answerSaved=(Boolean)j.get("answerSaved");cardMayExist=(Boolean)j.get("cardMayExist");choiceSeen=(Boolean)j.get("choiceSeen");inputRetired=(Boolean)j.get("inputRetired");cleanupSubmitted=(Boolean)j.get("cleanupSubmitted");answerAt=TaskWire.nonnegative(j.get("answerAt"));guardToken=TaskWire.text(j.get("guardToken"),32,true);TaskWire.require(guardToken.isEmpty()||guardToken.matches("[a-f0-9]{32}"),"TASK_CARD_STORE_INVALID");
    answerFailure=TaskWire.text(j.get("answerFailure"),64,true);TaskWire.require(answerFailure.isEmpty()||answerFailure.matches("[A-Z][A-Z0-9_]{0,63}"),"TASK_CARD_STORE_INVALID");
    TaskWire.require(!answerSaved||selected>=0&&answerFailure.isEmpty(),"TASK_CARD_STORE_INVALID");TaskWire.require(index==uids.size()-1&&(!cardMayExist||pending||inputRetired&&cleanupSubmitted),"TASK_CARD_STORE_INVALID");TaskWire.require(!cleanupSubmitted||inputRetired,"TASK_CARD_STORE_INVALID");TaskWire.require(selected<0?answerAt==0&&answerFailure.isEmpty():selected==index&&choiceSeen&&answerAt>0&&answerAt<request.expiresAt,"TASK_CARD_STORE_INVALID");
    phase=pending||selected>=0&&!answerSaved&&answerFailure.isEmpty()?"RECOVERY_PENDING":inputRetired?"RETIRED":"IDLE";note="仅恢复已保存选择和清理原卡；不重放问题";
   }
  }}catch(Exception invalid){healthy=false;phase="BLOCKED";note="任务卡记录不可读；不发卡或生成答案";}
 }
 private static String hashKey(Object raw){String value=TaskWire.text(raw,64,false);TaskWire.require(value.matches("[a-f0-9]{64}"),"TASK_CARD_STORE_INVALID");return value;}
 static boolean isOwnUid(String value){return value!=null&&value.matches("ioa-[a-f0-9]{32}");}
 static boolean ownsOperation(byte[] bytes){try{OtaFrame frame=OtaFrame.decode(bytes);Object value=BoundedJson.map(frame.json).get("suggestUID");return frame.type==34&&value instanceof String&&isOwnUid((String)value);}catch(RuntimeException invalid){return false;}}
 synchronized boolean healthy(){return healthy;}
 synchronized boolean pending(){return pending;}
 synchronized boolean cardMayExist(){return cardMayExist;}
 synchronized String phase(){return phase;}
 synchronized String uid(){return uid;}
 synchronized String owner(){return request==null?"":request.owner;}
 synchronized boolean nextPageReady(long now){return phase.equals("NEXT_READY")&&now>=after;}
 synchronized boolean hasSelection(){return selected>=0;}
 synchronized boolean canPrepare(){return healthy&&!pending&&!working()&&!(request!=null&&selected>=0&&!answerSaved);}
 synchronized boolean cancelUnshown(){if(!healthy||!pending||cardMayExist||showSubmitted||selected>=0)return false;queued=flight=null;pending=false;inputRetired=cleanupSubmitted=true;phase="RETIRED";note="未提交显示，原问题保留在手机";return save();}
 synchronized AgentCardRequest request(){return request;}
 synchronized List<Object> drafts(){return WireJson.list(WireJson.copy(drafts));}
 synchronized String answerFailure(){return answerFailure;}
 synchronized String status(){return phase+" · "+note;}
 synchronized boolean working(){return flight!=null||queued!=null||TaskWire.set("SHOWING","ACTIVE","SAVING_ANSWER","ACK_WAIT","NEXT_READY").contains(phase);}
 synchronized boolean prepare(AgentCardRequest next,String target,long gen){
  if(!healthy||pending||working()||request!=null&&selected>=0&&!answerSaved||target==null||target.isEmpty()||target.length()>256)return false;
  request=next;peer=target;peerHash=FixedPeerHash.of(target);generation=gen;index=0;selected=-1;choiceSeen=answerSaved=cardMayExist=showSubmitted=inputRetired=cleanupSubmitted=false;answerAt=0;answerFailure=guardToken="";uids.clear();newUid();pending=true;phase="PREPARING";note="原问题已冻结，等待设备和头势保护";return save();
 }
 synchronized boolean bindGuard(String token){if(!healthy||!pending||!phase.equals("PREPARING")||token==null||!token.matches("[a-f0-9]{32}")||!guardToken.isEmpty()&&!guardToken.equals(token))return false;guardToken=token;return save();}
 private void newUid(){uid="ioa-"+UUID.randomUUID().toString().replace("-","");uids.add(uid);}
 synchronized boolean show(String target,long gen,long now,long wallNow,boolean headReady){
  if(!healthy||!pending||inputRetired||guardToken.isEmpty()||!same(target,gen)||!headReady||flight!=null||queued!=null||!TaskWire.set("PREPARING","NEXT_READY").contains(phase)||now<after||wallNow>=request.expiresAt)return false;
  AgentCardRequest.Copy copy=request.copy(index);cardMayExist=true;phase="SHOWING";note="仅本问题的明确操作可保存选项";deadline=now+Math.min(CARD_MS,request.expiresAt-wallNow);
  if(!save())return false;queued=message("show",uid,33,OtaFrame.object("suggestUID",uid,"suggestType",2,"type",1,"title",copy.title,"source",copy.source,"content",copy.content));return true;
 }
 synchronized Emission next(String target,long gen,long now,boolean headReady){
  if(!healthy||flight!=null||queued==null||!same(target,gen))return null;
  if(queued.purpose.equals("show")&&(!headReady||now>=deadline)){suspend("头势保护或卡片已过期，未提交卡片");return null;}
  flight=queued;queued=null;flightUntil=now+SDK_MS;if(flight.purpose.equals("show"))showSubmitted=true;return flight;
 }
 synchronized boolean permits(Emission e,String target,long gen,long now,boolean headReady){return healthy&&same(target,gen)&&flight==e&&now<flightUntil&&(!e.purpose.equals("show")||headReady&&now<deadline);}
 synchronized void result(long ticket,boolean ok,long now){
  if(flight==null||flight.ticket!=ticket)return;Emission sent=flight;flight=null;
  if(!ok){suspend("原生提交结果未知，保留同UID清理；不重发问题");return;}
  switch(sent.purpose){
   case "show":if(phase.equals("SHOWING")){phase="ACTIVE";note="卡片已提交；镜片实际显示另核对";}break;
   case "ack":phase="ACK_WAIT";after=now+ANIMATION_MS;note=selected>=0?"完整选项已保存，等待原生反馈动画":"仅保存了查看下一项的操作，没有拒绝任务";break;
   case "remove_step":
    if(selected<0&&index+1<request.size()){index++;choiceSeen=showSubmitted=false;newUid();phase="NEXT_READY";after=now+300;note="下一完整选项待显示";save();}
    else{phase="CLEANUP_PENDING";note="当前卡清理已提交；仍需核对全部退出";}
    break;
   case "cleanup":cleanupIndex++;if(cleanupIndex<uids.size())queueCleanup();else{cleanupSubmitted=true;pending=false;phase="RETIRED";note="原UID输入已封存、移除已提交；镜片实际退场另核对";save();}break;
   default:suspend("未知原生卡提交阶段");
  }
 }
 synchronized void receive(String target,long gen,byte[] bytes,long now,long wallNow,boolean headReady){
  if(!healthy||!pending||inputRetired||!showSubmitted||!same(target,gen)||!headReady||choiceSeen||!TaskWire.set("SHOWING","ACTIVE").contains(phase)||now>=deadline||wallNow>=request.expiresAt)return;
  try{OtaFrame f=OtaFrame.decode(bytes);if(f.type!=34||f.binary.length!=0)return;Map<String,Object> j=BoundedJson.map(f.json);BoundedJson.keys(j,"suggestUID","suggestType","cmd");
   if(!uid.equals(j.get("suggestUID"))||BoundedJson.number(j.get("suggestType"),2,2)!=2)return;int command=BoundedJson.number(j.get("cmd"),1,2);
   // A received action may beat the show SDK callback. It invalidates that callback and freezes
   // the UID before any IO owner can persist/send an answer or acknowledge this operation.
   queued=flight=null;choiceSeen=true;
   if(command==1){selected=index;answerAt=wallNow;phase="SAVING_ANSWER";note="语义选择已保存，等待原问题答案队列";save();}
   else{phase="STEP_SAVED";note="仅保存下一项/留手机的操作";if(save())queueAck();}
  }catch(RuntimeException malformed){/* Wrong UID, late/duplicate and malformed input are never an answer. */}
 }
 synchronized Answer pendingAnswer(){return healthy&&selected>=0&&!answerSaved&&answerFailure.isEmpty()&&TaskWire.set("SAVING_ANSWER","RECOVERY_PENDING","CLOSED","RETIRED").contains(phase)?new Answer(request,selected):null;}
 synchronized void answerStored(String operation,boolean stored,String error){
  if(!healthy||request==null||!request.operation().equals(operation)||selected<0||answerSaved)return;
  boolean live=phase.equals("SAVING_ANSWER")&&!inputRetired;if(!stored){answerFailure=error!=null&&error.matches("[A-Z][A-Z0-9_]{0,63}")?error:"TASK_UNAVAILABLE";phase="ANSWER_SAVE_FAILED";note="完整选择未能进入答案队列，需在手机核对";save();return;}
  answerSaved=true;answerFailure="";if(!save())return;
  if(live)queueAck();else{phase=pending?"RECOVERY_PENDING":"CLOSED";note="已核对原选择的持久答案；仅清理旧卡，不重放显示或回执";}
 }
 synchronized boolean retryAnswer(){if(!healthy||request==null||selected<0||answerSaved||answerFailure.isEmpty())return false;answerFailure="";phase="RECOVERY_PENDING";note="仅重试原选择的持久保存；不重放卡片或改变答案";return save();}
 synchronized boolean keepUnsentDraft(){if(!healthy||pending||selected<0||answerSaved||answerFailure.isEmpty()||drafts.size()>=64)return false;drafts.add(WireJson.object("request",request.json(),"selected",selected,"error",answerFailure,"at",answerAt));selected=-1;answerAt=0;answerFailure="";phase="RETIRED";note="完整选择已保留在手机草稿，未提交；其他问题可继续";return save();}
 private void queueAck(){queued=message("ack",uid,35,OtaFrame.object("suggestUID",uid,"suggestType",2,"code",0));phase="ACK_PENDING";}
 synchronized void tick(String target,long gen,long now,long wallNow,boolean headReady,boolean foreground,boolean requestCurrent){
  if(!healthy||!pending)return;
  if(working()&&(!same(target,gen)||!foreground||!requestCurrent&&selected<0)){suspend("原连接、前台或问题状态已变化；不生成新答案");return;}
  if(flight!=null&&now>=flightUntil){result(flight.ticket,false,now);return;}
  if(TaskWire.set("SHOWING","ACTIVE","NEXT_READY").contains(phase)&&(!headReady||now>=deadline&&!phase.equals("NEXT_READY")||wallNow>=request.expiresAt)){suspend("卡片或保护已过期；消失不表示拒绝");return;}
  if(phase.equals("ACK_WAIT")&&now>=after&&flight==null){phase="STEP_REMOVING";queued=remove("remove_step",uid);}
 }
 synchronized void suspend(String reason){queued=flight=null;phase=pending?"RECOVERY_PENDING":"IDLE";note=reason;if(pending){inputRetired=true;save();}}
 synchronized boolean cleanup(String target,long gen){
  if(!healthy||(!pending&&!cardMayExist)||target==null||target.length()>256||!peerHash.equals(FixedPeerHash.of(target))||flight!=null)return false;
  peer=target;generation=gen;queued=null;pending=inputRetired=true;cleanupSubmitted=false;phase="CLEANING";cleanupIndex=0;if(!save())return false;queueCleanup();return true;
 }
 synchronized CardInputClosure closure(){
  if(!healthy||pending||!inputRetired||!cleanupSubmitted||guardToken.isEmpty())return null;
  final String closedOwner=owner(),closedPeer=peerHash,closedToken=guardToken;
  return (wantedOwner,wantedPeer,wantedToken)->{synchronized(AgentCardSession.this){return healthy&&!pending&&inputRetired&&cleanupSubmitted&&owner().equals(closedOwner)&&peerHash.equals(closedPeer)&&guardToken.equals(closedToken)&&closedOwner.equals(wantedOwner)&&closedPeer.equals(wantedPeer)&&closedToken.equals(wantedToken);}};
 }
 private void queueCleanup(){queued=remove("cleanup",uids.get(cleanupIndex));}
 /** Only a real UID-specific device exit or a direct current-home observation can close this. */
 synchronized boolean confirmExit(String target,long gen,String evidence){
  if(!healthy||pending||!inputRetired||!cleanupSubmitted||!same(target,gen)||!TaskWire.set("device_uid_exit","observed_home").contains(evidence))return false;
  cardMayExist=false;if(!save())return false;phase="CLOSED";note="原卡实际退出已另行核对";return true;
 }
 private Emission remove(String purpose,String id){return message(purpose,id,33,OtaFrame.object("suggestUID",id,"suggestType",2,"type",2,"title","","source","","content",""));}
 private Emission message(String purpose,String id,int type,Object body){return new Emission(++serial,purpose,id,type,body);}
 private boolean same(String target,long gen){return !peer.isEmpty()&&peer.equals(target)&&generation==gen;}
 private boolean save(){try{store.save(WireJson.object("schema",1,"pending",pending,"request",request==null?null:request.json(),"peerHash",peerHash,"guardToken",guardToken,"uids",new ArrayList<>(uids),"index",index,"selected",selected,"answerSaved",answerSaved,"answerFailure",answerFailure,"cardMayExist",cardMayExist,"choiceSeen",choiceSeen,"answerAt",answerAt,"inputRetired",inputRetired,"cleanupSubmitted",cleanupSubmitted,"drafts",WireJson.copy(drafts)));return true;}catch(Exception failure){healthy=false;queued=flight=null;phase="BLOCKED";note="任务卡记录保存失败；不确认操作或开放下一卡";return false;}}
}
