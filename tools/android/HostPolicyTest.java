package com.turboio.addon;
import java.util.*;

public final class HostPolicyTest {
 public enum Business {MARS_FOTA,LAUNCHER,HEARTBEAT,CONNECTION_PAIRING,VERSION_CHECK,WHISPER_MODE,NOTIFICATION}
 public static final class Message {public Object c,e;public String b="synthetic-peer";Message(Object business,Object bytes){c=business;e=bytes;}}
 static void check(boolean condition){if(!condition)throw new AssertionError("Host OTA boundary violated");}
 public static void main(String[] args){
  for(int type:new int[]{1,2,11}){
   byte[] query=OtaFrame.encode(type,Collections.emptyMap(),null);
   check(Host107Abi.allowQueue(new Message(Business.MARS_FOTA,query)));
   check(!Host107Abi.allowQueue(new Message(Business.MARS_FOTA,OtaFrame.encode(type,OtaFrame.object("Mode",2),null))));
  }
  for(int type:new int[]{3,4,5,6,7,8,9,10,12,255})check(!Host107Abi.allowQueue(new Message(Business.MARS_FOTA,OtaFrame.encode(type,null,null))));
  check(!Host107Abi.allowQueue(new Message(Business.MARS_FOTA,OtaFrame.encode(1,null,new byte[]{1}))));
  check(!Host107Abi.allowQueue(new Message(Business.MARS_FOTA,new byte[]{8,1,16})));
  check(!Host107Abi.allowQueue(new Message(Business.MARS_FOTA,"not bytes")));
  check(!Host107Abi.allowQueue(new Message(null,new byte[0])));
  check(!Host107Abi.allowQueue(null));
  check(Host107Abi.allowQueue(new Message(Business.LAUNCHER,new byte[]{8,1,16,7})));
  check(java.lang.reflect.Modifier.isPublic(Host107Abi.class.getModifiers()));
  check(Host107Abi.allowFile()==(!ProductInfo.OFFICIAL_OTA_PREPARATION&&!ProductInfo.OFFICIAL_OTA_GUARDED));
  byte[] borrowed=OtaFrame.encode(1,null,null);Message detached=new Message(Business.MARS_FOTA,borrowed);check(Host107Abi.allowQueue(detached));check(detached.e!=borrowed);byte first=((byte[])detached.e)[0];borrowed[0]^=1;check(((byte[])detached.e)[0]==first);
  final int[] headWrites={0};final boolean[] headAllowed={false};HeadGestureGate.observe(new HeadGestureGate.Observer(){public boolean userWrite(String peer,HeadGestureSession.Setting setting){headWrites[0]++;return headAllowed[0];}public boolean unknownWrite(String peer){return true;}});
  byte[] head=OtaFrame.encode(5,OtaFrame.object("cmd","head_gestures","payload",OtaFrame.object("value",0,"mode",1,"data","")),null);Message settings=new Message(Business.LAUNCHER,head);
  check(!Host107Abi.allowQueue(settings)&&headWrites[0]==1);headAllowed[0]=true;check(Host107Abi.allowQueue(settings)&&headWrites[0]==2&&settings.e!=head);
  check(Host107Abi.allowQueue(new Message(Business.LAUNCHER,OtaFrame.encode(5,OtaFrame.object("cmd","wakeup_config"),null)))&&headWrites[0]==2);HeadGestureGate.observe(null);
  // 2026-10-23: a stock ordinary notification body (21/type2) waits on the phone while a task is on the
  // lens; notification status, stock suggestion frames and owned task cards still pass; leases expire.
  byte[] ordinary=OtaFrame.encode(2,OtaFrame.object("title","synthetic"),null);
  check(Host107Abi.allowQueue(new Message(Business.NOTIFICATION,ordinary)));
  TaskAttention.hold("prompter",60000);check(TaskAttention.active()&&"prompter".equals(TaskAttention.owners()));
  check(!Host107Abi.allowQueue(new Message(Business.NOTIFICATION,ordinary))&&TaskAttention.blockedCount()==1);
  check(Host107Abi.allowQueue(new Message(Business.NOTIFICATION,OtaFrame.encode(3,OtaFrame.object("id",1),null))));
  check(Host107Abi.allowQueue(new Message(Business.NOTIFICATION,OtaFrame.encode(33,OtaFrame.object("suggestUID","s"),null))));
  check(Host107Abi.allowQueue(new Message(Business.NOTIFICATION,new byte[]{1,2,3})));
  Message ownedCard=new Message(Business.NOTIFICATION,ordinary);check(SuggestionGate.register(ownedCard,"synthetic-peer",ordinary,()->true)&&Host107Abi.allowQueue(ownedCard));
  TaskAttention.release("prompter");check(!TaskAttention.active()&&Host107Abi.allowQueue(new Message(Business.NOTIFICATION,ordinary)));
  TaskAttention.hold("card",-1);check(!TaskAttention.active()&&Host107Abi.allowQueue(new Message(Business.NOTIFICATION,ordinary))&&TaskAttention.blockedCount()==1);
  TaskAttention.hold("voice",60000);TaskAttention.hold("card",60000);TaskAttention.release("voice");check(!Host107Abi.allowQueue(new Message(Business.NOTIFICATION,ordinary)));TaskAttention.release("card");check(Host107Abi.allowQueue(new Message(Business.NOTIFICATION,ordinary)));
  Object owner=new Object();String peerHash=Fixed60Firmware.hash("SHA-256","synthetic-peer".getBytes(java.nio.charset.StandardCharsets.UTF_8));
  FirmwareQueue.PassivePolicy readonly=(message,peer,bytes)->OtaFrame.readOnly(bytes);
  check(FirmwareQueue.acquirePassive(owner,peerHash,readonly));check(!FirmwareQueue.acquirePassive(new Object(),peerHash,readonly));check(!Host107Abi.allowFile());
  check(Host107Abi.allowQueue(new Message(Business.MARS_FOTA,OtaFrame.encode(11,null,null))));check(!Host107Abi.allowQueue(new Message(Business.MARS_FOTA,OtaFrame.encode(4,OtaFrame.object("Mode",2),null))));
  Message other=new Message(Business.MARS_FOTA,OtaFrame.encode(1,null,null));other.b="other";check(!Host107Abi.allowQueue(other));check(!Host107Abi.allowQueue(new Message(Business.LAUNCHER,new byte[0])));
  Message maintenance=new Message(Business.CONNECTION_PAIRING,new byte[0]);check(Host107Abi.allowQueue(maintenance));maintenance.b="other";check(!Host107Abi.allowQueue(maintenance));String diagnostic=FirmwareQueue.diagnostics();check(diagnostic.contains("CONNECTION_PAIRING targetMatches=false")&&!diagnostic.contains("synthetic-peer")&&!diagnostic.contains("other\n"));check(!Host107Abi.allowQueue(new Message(Business.MARS_FOTA,OtaFrame.encode(4,OtaFrame.object("Mode",2),null))));
  byte[] query=OtaFrame.encode(2,null,null);Message owned=new Message(Business.MARS_FOTA,query);try{FirmwareQueue.submit(owner,owned,"synthetic-peer",query,false,()->check(Host107Abi.allowQueue(owned)));}catch(Exception invalid){throw new AssertionError(invalid);}
  FirmwareQueue.release(new Object());check(FirmwareQueue.busy());FirmwareQueue.release(owner);check(!FirmwareQueue.busy());check(Host107Abi.allowQueue(new Message(Business.LAUNCHER,new byte[0])));
  // Pairing uses a peripheral MAC, whereas OTA uses the stock canonical identity.
  Object aliasOwner=new Object();String canonicalHash=Fixed60Firmware.hash("SHA-256",Y3.D.FIRST.getBytes(java.nio.charset.StandardCharsets.UTF_8));check(FirmwareQueue.acquire(aliasOwner,canonicalHash));
  Message alias=new Message(Business.CONNECTION_PAIRING,new byte[]{1,2,3});alias.b="02:00:00:00:00:01";Object originalPayload=alias.e;check(Host107Abi.allowQueue(alias));check(alias.b.equals("02:00:00:00:00:01")&&alias.e==originalPayload);alias.b="020000000001";check(Host107Abi.allowQueue(alias));
  for(String id:new String[]{"02:00:00:00:00:02","02:00:00:00:00:03","02:00:00:00:00:04","not-a-mac",Y3.D.SECOND}){alias.b=id;check(!Host107Abi.allowQueue(alias));}
  Message foreignVersion=new Message(Business.VERSION_CHECK,new byte[0]);foreignVersion.b="02:00:00:00:00:01";check(!Host107Abi.allowQueue(foreignVersion));foreignVersion.b=Y3.D.FIRST;check(Host107Abi.allowQueue(foreignVersion));
  Message rawOta=new Message(Business.MARS_FOTA,OtaFrame.encode(4,OtaFrame.object("Mode",2),null));rawOta.b="02:00:00:00:00:01";check(!Host107Abi.allowQueue(rawOta));check(!Host107Abi.allowFile());FirmwareQueue.release(aliasOwner);
  System.out.println("OTA read-only policy: passed (queries, mutation, malformed, unrelated traffic)");
 }
}
