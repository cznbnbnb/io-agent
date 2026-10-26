package com.turboio.addon;

import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.*;

/** Source-authorized tombstones in the existing durable material outbox.
 * Uncertain old uploads are reconciled/cancelled, never sent to make room for a
 * deletion. No original sound, source cache, or user export is removed here.
 */
final class OfficialDeletionSync {
 final OfficialRecordingDeletion.Snapshot snapshot;
 final Set<String> deletedMaterials;
 final Set<String> readyMaterials=new TreeSet<>();
 private final OfficialRecordingDeletion.Source source;
 private final MaterialConfig config;
 int added;
 private OfficialDeletionSync(MaterialConfig config,OfficialRecordingDeletion.Source source,OfficialRecordingDeletion.Snapshot snapshot){
  this.config=config;this.source=source;this.snapshot=snapshot;
  Set<String> ids=new TreeSet<>();for(String task:snapshot.committedTasks)ids.add(snapshot.material(task));
  deletedMaterials=Collections.unmodifiableSet(ids);
 }
 static OfficialDeletionSync read(MaterialConfig config,OfficialRecordingDeletion.Source source)throws Exception{
  if(source==null)return null;
  OfficialAccountBinding account=source.current();
  MaterialWire.require(account!=null&&config.account.equals(account.binding),"OFFICIAL_ACCOUNT_CHANGED");
  OfficialRecordingDeletion.Snapshot snapshot=OfficialRecordingDeletion.read(account,source);
  // Historical rules need their own proven task-time predicate. Do not guess
  // from dates or allow a stale source to be uploaded during that gap.
  MaterialWire.require(!snapshot.pending,"OFFICIAL_DELETION_PENDING");
  MaterialWire.require(!snapshot.historical,"OFFICIAL_DELETION_HISTORY_UNSUPPORTED");
  return new OfficialDeletionSync(config,source,snapshot);
 }
 void check()throws Exception{snapshot.revalidate(source);}
 private static Map<String,Object> event(Map<String,Object> row,String producer){return MaterialWire.event(((String)row.get("payload")).getBytes(StandardCharsets.UTF_8),producer);}
 private Map<String,Object> latest(MaterialOutbox outbox,String id,boolean stored){
  Map<String,Object> result=null;
  for(Object raw:outbox.all()){
   Map<String,Object> row=WireJson.map(raw);
   if(!id.equals(row.get("material_id"))||stored&&!"server_stored".equals(row.get("state")))continue;
   if(result==null||MaterialWire.positive(row.get("revision"))>MaterialWire.positive(result.get("revision")))result=row;
  }
  return result;
 }
 void stage(MaterialOutbox outbox,MaterialApi api,long now)throws Exception{
  MaterialWire.require(config.connection.binding().equals(outbox.binding()),"MATERIAL_TARGET_CHANGED");check();
  Set<String> known=new TreeSet<>();for(Object raw:outbox.all()){String id=(String)WireJson.map(raw).get("material_id");if(deletedMaterials.contains(id))known.add(id);}
  int budget=0;
  for(String id:known){
   check();Map<String,Object> current=latest(outbox,id,false);
   Map<String,Object> before=WireJson.map(event(current,config.connection.producer).get("body"));
   if("delete".equals(before.get("operation"))){readyMaterials.add(id);continue;}
   if(budget++>=16)continue;
   // An old body may have reached the server before the source was deleted.
   // Resolve that outcome first, then obtain the server's durable cancellation
   // proof for every remaining envelope; a failed/unknown outcome stops here.
   for(Object raw:outbox.all()){
    Map<String,Object> row=WireJson.map(raw);
    if(!id.equals(row.get("material_id"))||"server_stored".equals(row.get("state"))||"cancelled".equals(row.get("state")))continue;
    check();String eventId=(String)row.get("event_id");api.reconcileOnly(outbox,eventId,now);check();
    Map<String,Object> latest=outbox.pending(eventId);
    if(latest!=null&&!"server_stored".equals(latest.get("state"))&&!"cancelled".equals(latest.get("state"))){
     MaterialWire.require(api.cancelPending(outbox,eventId,now),"MATERIAL_CANCELLATION_UNAVAILABLE");check();
    }
   }
   current=latest(outbox,id,false);Map<String,Object> stored=latest(outbox,id,true);
   before=WireJson.map(event(current,config.connection.producer).get("body"));
   boolean cancelled="cancelled".equals(current.get("state"));
   MaterialWire.require(cancelled||"server_stored".equals(current.get("state")),"OFFICIAL_DELETION_OUTCOME_UNCERTAIN");
   long revision=MaterialWire.positive(before.get("revision"))+(cancelled?0:1);
   long textRevision=stored==null?1:MaterialWire.positive(WireJson.map(event(stored,config.connection.producer).get("body")).get("text_revision"));
   Map<String,Object> body=WireJson.map(WireJson.copy(before));
   body.put("operation","delete");body.put("revision",revision);body.put("base_revision",revision-1);body.put("text_revision",textRevision);
   body.put("utterances",new ArrayList<>());body.put("speakers",new ArrayList<>());
   Map<String,Object> full=WireJson.map(WireJson.copy(body.get("full_text")));full.put("text","");body.put("full_text",full);
   body.put("audio",WireJson.object("state","missing","sha256",null,"object_id",null));
   MaterialWire.body(body);
   String eventId="official-delete-"+TaskWire.hash(WireJson.bytes(WireJson.object("account",config.account,"connection",config.connection.binding(),"body",body)));
   byte[] payload=WireJson.bytes(WireJson.object("schema_version","1.2","event_id",eventId,"idempotency_key",eventId,"kind","material.revision","producer_id",config.connection.producer,"created_at",TaskWire.now(now),"expires_at",config.connection.expires,"body",body));
   check();outbox.enqueue(payload);check();readyMaterials.add(id);added++;
  }
 }
 List<OfficialLifelogSnapshot.Source> filter(List<OfficialLifelogSnapshot.Source> fresh){
  List<OfficialLifelogSnapshot.Source> retained=new ArrayList<>();
  for(OfficialLifelogSnapshot.Source value:fresh)if(!deletedMaterials.contains(value.materialId(config.account)))retained.add(value);
  return retained;
 }
}
