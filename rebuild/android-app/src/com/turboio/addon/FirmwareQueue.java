package com.turboio.addon;

import java.util.*;

/** Exact synchronous SDK queue ticket. No ambient write authorization or automatic retry. */
final class FirmwareQueue {
 interface Submission {void send()throws Exception;}
 interface PassivePolicy {boolean allow(Object message,String peer,byte[] bytes);}
 private static final Set<String> CONNECTION_ONLY=new HashSet<>(Arrays.asList("HEARTBEAT","CONNECTION_PAIRING","VERSION_CHECK"));
 private static volatile Object owner;private static volatile String ownerPeerHash;
 private static volatile Passive passive;
 private static long maintenanceAllowed,maintenanceDenied,otherDenied;private static String lastDenied="";
 private static final class Passive {final Object key;final PassivePolicy policy;Passive(Object key,PassivePolicy policy){this.key=key;this.policy=policy;}}
 private static final ThreadLocal<Ticket> ticket=new ThreadLocal<>();
 private static final class Ticket {
  final Object owner,message;final String peer;final byte[] bytes;final boolean writes;boolean consumed;
  Ticket(Object owner,Object message,String peer,byte[] bytes,boolean writes){this.owner=owner;this.message=message;this.peer=peer;this.bytes=bytes.clone();this.writes=writes;}
 }
 static synchronized boolean acquire(Object key){if(key==null||owner!=null&&owner!=key)return false;owner=key;return true;}
 static synchronized boolean acquire(Object key,String peerHash){if(peerHash==null||!peerHash.matches("[a-f0-9]{64}")||key==null||owner!=null&&owner!=key||ownerPeerHash!=null&&!ownerPeerHash.equals(peerHash))return false;owner=key;ownerPeerHash=peerHash;return true;}
 static synchronized boolean acquirePassive(Object key,String peerHash,PassivePolicy policy){if(policy==null||passive!=null&&(passive.key!=key||passive.policy!=policy)||!acquire(key,peerHash))return false;passive=new Passive(key,policy);return true;}
 static synchronized void release(Object key){if(owner==key){passive=null;owner=null;ownerPeerHash=null;}}
 static boolean busy(){return owner!=null;}
 static boolean matchesPeer(String peer){String expected=ownerPeerHash;return owner!=null&&expected!=null&&peer!=null&&expected.equals(peerHash(peer));}
 private static String peerHash(String peer){return Fixed60Firmware.hash("SHA-256",peer.getBytes(java.nio.charset.StandardCharsets.UTF_8));}
 static void submit(Object key,Object message,String peer,byte[] bytes,boolean writes,Submission submission)throws Exception{
  if(key==null||owner!=key||message==null||peer==null||peer.isEmpty()||bytes==null||ticket.get()!=null||ownerPeerHash!=null&&!ownerPeerHash.equals(peerHash(peer)))throw new IllegalStateException("FIRMWARE_TICKET_DENIED");
  Ticket issued=new Ticket(key,message,peer,bytes,writes);ticket.set(issued);try{submission.send();if(!issued.consumed)throw new IllegalStateException("FIRMWARE_QUEUE_NOT_ENTERED");}finally{ticket.remove();}
 }
 private static synchronized boolean nonFirmware(String business,String peer){
  if(!busy())return true;
  boolean samePeer=ownerPeerHash!=null&&peer!=null&&peerHash(peer).equals(ownerPeerHash),maintenance=CONNECTION_ONLY.contains(business);
  boolean allowed="HEARTBEAT".equals(business)||maintenance&&samePeer;
  if(maintenance){if(allowed)maintenanceAllowed++;else maintenanceDenied++;}else if(!allowed)otherDenied++;
  if(!allowed)lastDenied=(business!=null&&business.matches("[A-Z0-9_]{1,40}")?business:"UNKNOWN")+" targetMatches="+samePeer;
  return allowed;
 }
 static synchronized String diagnostics(){return "连接维护放行="+maintenanceAllowed+" 拒绝="+maintenanceDenied+" 其他业务拒绝="+otherDenied+(lastDenied.isEmpty()?"":" 最近拒绝="+lastDenied);}
 static boolean allow(String business,Object message,String peer,byte[] bytes){
  if(!"MARS_FOTA".equals(business))return nonFirmware(business,peer);
  Ticket claim=ticket.get();
  if(!busy())return OtaFrame.readOnly(bytes);
  if(ownerPeerHash!=null&&(peer==null||!ownerPeerHash.equals(peerHash(peer))))return false;
  Passive observed=passive;
  if(claim==null&&observed!=null&&observed.key==owner)try{return observed.policy.allow(message,peer,bytes);}catch(RuntimeException invalid){return false;}
  if(claim==null||claim.owner!=owner||claim.consumed||claim.message!=message||!claim.peer.equals(peer)||!Arrays.equals(claim.bytes,bytes))return false;
  boolean ok=shape(bytes,claim.writes);if(ok&&observed!=null&&observed.key==owner)try{ok=observed.policy.allow(message,peer,bytes);}catch(RuntimeException invalid){ok=false;}if(ok)claim.consumed=true;return ok;
 }
 private static boolean shape(byte[] bytes,boolean writes){
  if(OtaFrame.readOnly(bytes))return true;
  try{OtaFrame frame=OtaFrame.decode(bytes);
   if(frame.type==3){Map<String,Object> json=BoundedJson.map(frame.json);BoundedJson.keys(json,"OtaSize");return frame.binary.length==0&&BoundedJson.number(json.get("OtaSize"),Fixed60Profile.ZIP_SIZE,Fixed60Profile.ZIP_SIZE)==Fixed60Profile.ZIP_SIZE;}
   if(!writes)return false;
   if(frame.type==4){Map<String,Object> json=BoundedJson.map(frame.json);BoundedJson.keys(json,"Mode");return frame.binary.length==0&&BoundedJson.number(json.get("Mode"),2,2)==2;}
   if(frame.type==5){Map<String,Object> json=BoundedJson.map(frame.json);BoundedJson.keys(json,"OtaVersion");return frame.binary.length==0&&Fixed60Profile.VERSION.equals(json.get("OtaVersion"));}
   // The exact expected bytes additionally come from the immutable Fixed60Session emission.
   if(frame.type==6)return frame.binary.length==0&&BoundedJson.list(frame.json).size()==15&&Fixed60Firmware.hash("SHA-256",BoundedJson.canonical(frame.json)).equals("4a082aa76fd45791c188aa04adbf51c039ac0e9fe551acfee818a69cefae86a4");
   if(frame.type==7){Map<String,Object> json=BoundedJson.map(frame.json);BoundedJson.keys(json,"Name","Start","Size");String name=BoundedJson.text(json.get("Name"),64);int start=BoundedJson.number(json.get("Start"),0,Fixed60Profile.AP_SIZE),size=BoundedJson.number(json.get("Size"),1,51200);for(String row:Fixed60Profile.PINS){String[] pin=row.split(" ");if(pin[0].equals(name)&&!name.equals("OtaFileInfo.json"))return frame.binary.length==size&&start<=Integer.parseInt(pin[1])-size;}return false;}
  }catch(RuntimeException ignored){}
  return false;
 }
}
