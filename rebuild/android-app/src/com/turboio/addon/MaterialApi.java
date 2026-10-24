package com.turboio.addon;

import java.io.*;import java.net.URLEncoder;import java.nio.charset.StandardCharsets;import java.util.*;

/** Material-only identity, event and transfer paths; never dispatches an Agent task. */
final class MaterialApi {
 interface Transport {Response exchange(String path,byte[] payload)throws IOException;void cancel();}
 static final class Response {final int status;final byte[] body;final long retryAfter;Response(int status,byte[] body,long retryAfter){this.status=status;this.body=body;this.retryAfter=retryAfter;}}
 private final MaterialConnection connection;private final Transport transport;private boolean running,transfers;String note="paused";
 MaterialApi(MaterialConnection connection,Transport transport){this.connection=connection;this.transport=transport;}
 Set<String> preflight(long now,boolean requireVersion)throws IOException{MaterialWire.require(connection.expiresAt>now,"MATERIAL_IMPORT_EXPIRED");Response r=transport.exchange("/identity",null);if(r.status!=200)throw new IOException(r.status==401?"AUTH_REQUIRED":r.status==403?"FORBIDDEN":"MATERIAL_IDENTITY_UNAVAILABLE");Set<String> versions=connection.identity(r.body,now,requireVersion);Map<String,Object> identity=WireJson.map(WireJson.read(r.body));transfers=identity.get("capabilities") instanceof List&&WireJson.list(identity.get("capabilities")).contains("material_transfer_v1");return versions;}
 synchronized boolean pump(MaterialOutbox outbox,long now)throws IOException{
  return pump(outbox,now,null);
 }
 synchronized boolean reconcileOnly(MaterialOutbox outbox,String eventId,long now)throws IOException{
  MaterialWire.require(connection.binding().equals(outbox.binding()),"MATERIAL_TARGET_CHANGED");if(running)return false;running=true;MaterialOutbox.Claim claim=null;
  try{preflight(now,true);claim=outbox.claimLookup(eventId);if(claim==null)return false;
   Response response=transport.exchange("/events/"+URLEncoder.encode(claim.eventId,"UTF-8").replace("+","%20"),null);if(outbox.finish(claim,response.status,response.body,now,response.retryAfter))outbox.repairTextRevision(claim,response.status,response.body,connection,now);claim=null;return true;
  }catch(IOException|RuntimeException failure){if(claim!=null)outbox.finish(claim,0,new byte[0],now,0);throw failure;}finally{running=false;}
 }
 synchronized boolean pump(MaterialOutbox outbox,long now,Set<String> allowedMaterials)throws IOException{
  MaterialWire.require(connection.binding().equals(outbox.binding()),"MATERIAL_TARGET_CHANGED");if(running)return false;running=true;MaterialOutbox.Claim claim=null;
  try{note="checking";Set<String> versions=preflight(now,false);if(versions.contains("1.2"))outbox.prepareRenewal(connection,now,allowedMaterials);claim=outbox.claim(now,versions,allowedMaterials);if(claim==null){note="idle";return false;}note=claim.action.equals("lookup")?"reconciling":"sending";
   String path=claim.action.equals("lookup")?"/events/"+URLEncoder.encode(claim.eventId,"UTF-8").replace("+","%20"):"/material-events";byte[] payload=claim.action.equals("send")?claim.payload.getBytes(StandardCharsets.UTF_8):null;Response response;if(payload!=null&&payload.length>262144){if(!transfers)throw new IOException("MATERIAL_TRANSFER_UNSUPPORTED");response=MaterialTransfer.send(transport,payload,MaterialWire.event(payload,connection.producer));}else response=transport.exchange(path,payload);outbox.finish(claim,response.status,response.body,now,response.retryAfter);claim=null;note="processed";return true;
  }catch(IOException|RuntimeException failure){if(claim!=null)outbox.finish(claim,0,new byte[0],now,0);String code=failure.getMessage();note=code!=null&&code.matches("[A-Z_]{3,80}")?code:"MATERIAL_UNAVAILABLE";throw failure;}finally{running=false;}
 }
 void cancel(){transport.cancel();}
}
