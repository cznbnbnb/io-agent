package com.turboio.addon;
import java.util.*;import java.util.regex.*;
/** Both entry methods carry only an approval code, never the computer's renewal secret. */
final class SessionPairingCode {
 private static final String UUID="([a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12})",CODE="([a-f0-9]{64})";
 private static final Pattern TEXT=Pattern.compile("io-agent-pair/1:"+UUID+":"+CODE),QR=Pattern.compile("https://cznbnb\\.cn/io-api/v1/connect#id="+UUID+"&code="+CODE);
 final String id,code;private SessionPairingCode(String id,String code){this.id=id;this.code=code;}
 static SessionPairingCode parse(String input){TaskWire.require(input!=null&&input.length()<=512,"SESSION_PAIRING_INVALID");String s=input.trim();Matcher m=TEXT.matcher(s);if(!m.matches()){m=QR.matcher(s);TaskWire.require(m.matches(),"SESSION_PAIRING_INVALID");}return new SessionPairingCode(m.group(1),m.group(2));}
 Map<String,Object> body(){return WireJson.object("id",id,"code",code);}
 static final class Preview {
  final SessionPairingCode code;final String deviceId,owner,account,runtime,topic,workspace;final Map<String,Object> route;final long expires;
  Preview(SessionPairingCode code,TaskDevice device,String account,Map<String,Object> body){
   TaskWire.require(code.id.equals(body.get("id"))&&device.owner.equals(body.get("owner_id")),"SESSION_PAIRING_IDENTITY_CHANGED");
   this.code=code;this.deviceId=device.deviceId;this.owner=device.owner;this.account=account;expires=TaskWire.stamp(body.get("expires_at"));
   Map<String,Object> m=WireJson.map(body.get("metadata"));runtime=TaskWire.text(m.get("runtime"),32,false);topic=TaskWire.text(m.get("topic"),40,false);workspace=TaskWire.text(m.get("workspace"),512,false);route=Collections.unmodifiableMap(new LinkedHashMap<>(WireJson.map(m.get("route"))));
   TaskWire.require(route.size()==4,"SESSION_PAIRING_INVALID");for(String key:new String[]{"computer_id","agent_id","project_id","session_id"})TaskWire.id(route.get(key));
   TaskWire.require((runtime.equals("codex")?"io-current-codex":"io-"+runtime).equals(route.get("agent_id")),"SESSION_PAIRING_INVALID");
  }
 }
}
