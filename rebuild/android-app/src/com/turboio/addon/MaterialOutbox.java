package com.turboio.addon;

import java.io.*;import java.nio.charset.StandardCharsets;import java.util.*;

/** Durable material-only sender. No discovery, credentials, audio, task execution or background loop. */
final class MaterialOutbox implements AutoCloseable {
 static final class Claim {
  private final MaterialOutbox owner;final String eventId,payload,action;final long attempt;
  private Claim(MaterialOutbox owner,Map<String,Object> row){this.owner=owner;eventId=(String)row.get("event_id");payload=(String)row.get("payload");action=Boolean.TRUE.equals(row.get("needs_lookup"))?"lookup":"send";attempt=MaterialWire.positive(row.get("attempts"));}
 }
 private final AtomicDocument document;private final String binding,producer;private final MaterialConnection connection;private List<Object> rows;private List<Object> retired=new ArrayList<>();private boolean closed;
 MaterialOutbox(File files,MaterialConnection connection)throws IOException{
  this.connection=connection;binding=connection.binding();producer=connection.producer;File file=new File(files,"material-outbox/"+binding+"/state.json");document=new AtomicDocument(file,33554432);
  try{
   if(new File(file.getPath()+".partial").exists())throw new IOException("MATERIAL_STORE_UNCERTAIN");Object raw=document.read();rows=new ArrayList<>();
   boolean migrated=false;if(raw!=null){Map<String,Object> state=WireJson.map(raw);long schema=MaterialWire.positive(state.get("schema"));if(schema==4)BoundedJson.keys(state,"schema","binding","rows","retired");else BoundedJson.keys(state,"schema","binding","rows");MaterialWire.require((schema==1||schema==2||schema==3||schema==4)&&binding.equals(state.get("binding")),"MATERIAL_STORE_INVALID");rows=WireJson.list(MaterialWire.copy(state.get("rows")));if(schema==4)retired=WireJson.list(MaterialWire.copy(state.get("retired")));if(schema==1){for(Object item:rows){Map<String,Object> row=WireJson.map(item);BoundedJson.keys(row,"event_id","material_id","revision","payload","payload_sha256","state","attempts","next_attempt_at","needs_lookup","error","ack");row.put("history",new ArrayList<>());row.put("absence_confirmed_at",0);}migrated=true;}if(schema<3){for(Object item:rows){Map<String,Object> row=WireJson.map(item);BoundedJson.keys(row,"event_id","material_id","revision","payload","payload_sha256","state","attempts","next_attempt_at","needs_lookup","error","ack","history","absence_confirmed_at");row.put("text_revision_repair",null);}migrated=true;}for(Object item:rows){Map<String,Object> row=WireJson.map(item);if(!row.containsKey("cancellation")){row.put("cancellation",null);row.put("superseded",new ArrayList<>());migrated=true;}}validate(rows);validateRetired(retired,rows);}
   List<Object> next=copy();boolean changed=migrated;for(Object item:next){Map<String,Object> row=WireJson.map(item);if(row.get("state").equals("sending")){row.put("state","reconcile");row.put("needs_lookup",true);row.put("next_attempt_at",0);row.put("error","INTERRUPTED");changed=true;}}if(changed)save(next);
  }catch(IOException|RuntimeException invalid){document.close();throw invalid;}
 }
 private List<Object> copy(){return WireJson.list(MaterialWire.copy(rows));}
 String binding(){return binding;}
 synchronized List<Object> all(){return copy();}
 private Map<String,Object> event(Map<String,Object> row){byte[] bytes=((String)row.get("payload")).getBytes(StandardCharsets.UTF_8);MaterialWire.require(TaskWire.hash(bytes).equals(row.get("payload_sha256")),"MATERIAL_PAYLOAD_CORRUPT");return MaterialWire.event(bytes,producer);}
 private void validate(List<Object> values){
  MaterialWire.require(values.size()<=256,"MATERIAL_STORE_FULL");Set<String> events=new HashSet<>(),versions=new HashSet<>();long payloadBytes=0;
  for(Object item:values){Map<String,Object> r=WireJson.map(item);BoundedJson.keys(r,"event_id","material_id","revision","payload","payload_sha256","state","attempts","next_attempt_at","needs_lookup","error","ack","history","absence_confirmed_at","text_revision_repair","cancellation","superseded");Map<String,Object> e=event(r),b=WireJson.map(e.get("body"));
   MaterialWire.require(events.add((String)e.get("event_id"))&&versions.add(b.get("material_id")+"/"+b.get("revision"))&&e.get("event_id").equals(r.get("event_id"))&&b.get("material_id").equals(r.get("material_id"))&&MaterialWire.positive(b.get("revision"))==MaterialWire.positive(r.get("revision")),"MATERIAL_STORE_INVALID");
   MaterialWire.require(MaterialWire.choice(r.get("state"),"queued","sending","reconcile","retry_wait","server_stored","blocked","expired","cancelled")&&r.get("needs_lookup") instanceof Boolean,"MATERIAL_STORE_INVALID");MaterialWire.number(r.get("attempts"));MaterialWire.number(r.get("next_attempt_at"));MaterialWire.require(MaterialWire.text(r.get("error"),80,true).matches("[A-Z_]*"),"MATERIAL_STORE_INVALID");
   if(r.get("state").equals("server_stored")){MaterialWire.require(Boolean.FALSE.equals(r.get("needs_lookup")),"MATERIAL_STORE_INVALID");MaterialWire.ack(WireJson.map(r.get("ack")),e);}else MaterialWire.require(r.get("ack")==null,"MATERIAL_STORE_INVALID");
   if(r.get("cancellation")!=null){MaterialWire.require("cancelled".equals(r.get("state"))&&!Boolean.TRUE.equals(r.get("needs_lookup")),"MATERIAL_CANCELLATION_MISMATCH");MaterialWire.cancellation(WireJson.map(r.get("cancellation")),e,(String)r.get("payload_sha256"),connection);}else MaterialWire.require(!"cancelled".equals(r.get("state")),"MATERIAL_CANCELLATION_MISMATCH");
   List<Object> superseded=WireJson.list(r.get("superseded"));MaterialWire.require(superseded.size()<=16,"MATERIAL_SUPERSESSION_LIMIT");for(Object old:superseded){Map<String,Object> a=WireJson.map(old),proof=WireJson.map(a.get("cancellation"));BoundedJson.keys(a,"event_id","payload_sha256","cancellation");MaterialWire.require(events.add(MaterialWire.text(a.get("event_id"),512,false)),"MATERIAL_STORE_INVALID");MaterialWire.cancellation(proof,WireJson.object("event_id",a.get("event_id"),"idempotency_key",proof.get("idempotency_key"),"expires_at",proof.get("expires_at"),"body",WireJson.object("material_id",r.get("material_id"),"revision",r.get("revision"))),(String)a.get("payload_sha256"),connection);}
   long absence=MaterialWire.number(r.get("absence_confirmed_at"));MaterialWire.require(absence==0||absence>=MaterialWire.time(e.get("expires_at")),"MATERIAL_STORE_INVALID");List<Object> history=WireJson.list(r.get("history"));MaterialWire.require(history.size()<=16,"MATERIAL_RENEWAL_LIMIT");for(Object old:history){Map<String,Object> h=WireJson.map(old);BoundedJson.keys(h,"event_id","payload_sha256","expires_at","absence_confirmed_at");MaterialWire.require(events.add(MaterialWire.text(h.get("event_id"),512,false))&&MaterialWire.text(h.get("payload_sha256"),64,false).matches("[a-f0-9]{64}")&&MaterialWire.number(h.get("absence_confirmed_at"))>=MaterialWire.time(h.get("expires_at")),"MATERIAL_STORE_INVALID");}
   if(r.get("text_revision_repair")!=null){Map<String,Object> repair=WireJson.map(r.get("text_revision_repair"));BoundedJson.keys(repair,"event_id","payload","payload_sha256","base_payload_sha256","absence_confirmed_at");
    String original=MaterialWire.text(repair.get("payload"),MaterialWire.MAX_EVENT_BYTES,false);byte[] originalBytes=original.getBytes(StandardCharsets.UTF_8);Map<String,Object> originalEvent=MaterialWire.event(originalBytes,producer),originalBody=WireJson.map(originalEvent.get("body"));
    MaterialWire.require(events.add((String)originalEvent.get("event_id"))&&originalEvent.get("event_id").equals(repair.get("event_id"))&&TaskWire.hash(originalBytes).equals(repair.get("payload_sha256"))&&MaterialWire.number(repair.get("absence_confirmed_at"))>=MaterialWire.time(originalEvent.get("created_at")),"MATERIAL_REPAIR_INVALID");
    Map<String,Object> base=storedBase(values,originalBody);MaterialWire.require(base!=null&&base.get("payload_sha256").equals(repair.get("base_payload_sha256")),"MATERIAL_REPAIR_INVALID");
    Map<String,Object> corrected=correctTranscript(originalBody,WireJson.map(event(base).get("body")));MaterialWire.require(corrected!=null&&corrected.equals(b),"MATERIAL_REPAIR_INVALID");payloadBytes+=originalBytes.length;
   }
   payloadBytes+=((String)r.get("payload")).getBytes(StandardCharsets.UTF_8).length;
  }MaterialWire.require(payloadBytes<=16777216,"MATERIAL_STORE_FULL");
 }
 private void save(List<Object> next)throws IOException{MaterialWire.require(!closed,"MATERIAL_STORE_CLOSED");validate(next);validateRetired(retired,next);Map<String,Object> state=WireJson.object("schema",4,"binding",binding,"rows",next,"retired",retired);MaterialWire.require(WireJson.bytes(state).length<=33554432,"MATERIAL_STORE_FULL");document.save(state);rows=next;}
 /** Only verified stored predecessors can lose their transport copy. Retain
  * exact event hashes/aliases and receipt evidence for crash replay. */
 private void validateRetired(List<Object> history,List<Object> active){
  MaterialWire.require(history.size()<=16384,"MATERIAL_HISTORY_FULL");Set<String> ids=new HashSet<>(),versions=new HashSet<>();
  for(Object raw:active){Map<String,Object> r=WireJson.map(raw);ids.add((String)r.get("event_id"));versions.add(r.get("material_id")+"/"+r.get("revision"));}
  for(Object raw:history){Map<String,Object> r=WireJson.map(raw);BoundedJson.keys(r,"event_id","material_id","revision","payload_sha256","ack","aliases");MaterialWire.id(r.get("event_id"));MaterialWire.id(r.get("material_id"));MaterialWire.positive(r.get("revision"));
   MaterialWire.require(ids.add((String)r.get("event_id"))&&versions.add(r.get("material_id")+"/"+r.get("revision"))&&MaterialWire.text(r.get("payload_sha256"),64,false).matches("[a-f0-9]{64}"),"MATERIAL_HISTORY_INVALID");
   MaterialWire.ack(WireJson.map(r.get("ack")),WireJson.object("event_id",r.get("event_id"),"body",WireJson.object("material_id",r.get("material_id"),"revision",r.get("revision"))));
   List<Object> aliases=WireJson.list(r.get("aliases"));MaterialWire.require(aliases.size()<=33,"MATERIAL_HISTORY_INVALID");for(Object alias:aliases){Map<String,Object> a=WireJson.map(alias);if(a.containsKey("cancellation"))BoundedJson.keys(a,"event_id","payload_sha256","cancellation");else BoundedJson.keys(a,"event_id","payload_sha256");MaterialWire.id(a.get("event_id"));MaterialWire.require(ids.add((String)a.get("event_id"))&&MaterialWire.text(a.get("payload_sha256"),64,false).matches("[a-f0-9]{64}"),"MATERIAL_HISTORY_INVALID");if(a.get("cancellation")!=null){Map<String,Object> proof=WireJson.map(a.get("cancellation"));MaterialWire.cancellation(proof,WireJson.object("event_id",a.get("event_id"),"idempotency_key",proof.get("idempotency_key"),"expires_at",proof.get("expires_at"),"body",WireJson.object("material_id",r.get("material_id"),"revision",r.get("revision"))),(String)a.get("payload_sha256"),connection);}}
  }
 }
 private Map<String,Object> retiredMatch(Map<String,Object> e,String payload){
  Map<String,Object> b=WireJson.map(e.get("body"));String hash=TaskWire.hash(payload.getBytes(StandardCharsets.UTF_8));
  for(Object raw:retired){Map<String,Object> r=WireJson.map(raw);boolean sameVersion=r.get("material_id").equals(b.get("material_id"))&&MaterialWire.positive(r.get("revision"))==MaterialWire.positive(b.get("revision")),known=false,sameEvent=r.get("event_id").equals(e.get("event_id"));
   if(sameEvent&&r.get("payload_sha256").equals(hash))known=true;
   for(Object alias:WireJson.list(r.get("aliases"))){Map<String,Object> a=WireJson.map(alias);if(a.get("event_id").equals(e.get("event_id"))){sameEvent=true;if(a.get("payload_sha256").equals(hash))known=true;}}
   if(sameVersion||sameEvent){MaterialWire.require(sameVersion&&known,"MATERIAL_LOCAL_REVISION_CONFLICT");return r;}
  }return null;
 }
 synchronized boolean retiredPayload(String hash){for(Object raw:retired){Map<String,Object> r=WireJson.map(raw);if(hash.equals(r.get("payload_sha256")))return true;for(Object a:WireJson.list(r.get("aliases")))if(hash.equals(WireJson.map(a).get("payload_sha256")))return true;}return false;}
 synchronized int retiredCount(){return retired.size();}
 synchronized int compact()throws IOException{
  Map<String,Long> latest=new HashMap<>();for(Object raw:rows){Map<String,Object> r=WireJson.map(raw);if("server_stored".equals(r.get("state")))latest.merge((String)r.get("material_id"),MaterialWire.positive(r.get("revision")),Math::max);}
  Set<String> keepBases=new HashSet<>();for(Object raw:rows){Map<String,Object> r=WireJson.map(raw);if(!"server_stored".equals(r.get("state"))||MaterialWire.positive(r.get("revision"))==latest.getOrDefault((String)r.get("material_id"),0L))if(r.get("text_revision_repair")!=null)keepBases.add((String)WireJson.map(r.get("text_revision_repair")).get("base_payload_sha256"));}
  List<Object> kept=new ArrayList<>(),history=WireJson.list(MaterialWire.copy(retired));int count=0;
  for(Object raw:rows){Map<String,Object> r=WireJson.map(raw);if(!"server_stored".equals(r.get("state"))||MaterialWire.positive(r.get("revision"))>=latest.getOrDefault((String)r.get("material_id"),0L)||keepBases.contains(r.get("payload_sha256"))){kept.add(raw);continue;}
   MaterialWire.ack(WireJson.map(r.get("ack")),event(r));List<Object> aliases=new ArrayList<>();for(Object old:WireJson.list(r.get("history"))){Map<String,Object> a=WireJson.map(old);aliases.add(WireJson.object("event_id",a.get("event_id"),"payload_sha256",a.get("payload_sha256")));}
   if(r.get("text_revision_repair")!=null){Map<String,Object> a=WireJson.map(r.get("text_revision_repair"));aliases.add(WireJson.object("event_id",a.get("event_id"),"payload_sha256",a.get("payload_sha256")));}
   aliases.addAll(WireJson.list(r.get("superseded")));
   history.add(WireJson.object("event_id",r.get("event_id"),"material_id",r.get("material_id"),"revision",r.get("revision"),"payload_sha256",r.get("payload_sha256"),"ack",r.get("ack"),"aliases",aliases));count++;
  }
  if(count>0){List<Object> old=retired;retired=history;try{save(kept);}catch(IOException|RuntimeException failed){retired=old;throw failed;}}return count;
 }
 synchronized Map<String,Object> enqueue(byte[] raw)throws IOException{
  Map<String,Object> e=MaterialWire.event(raw,producer),b=WireJson.map(e.get("body"));String payload=new String(WireJson.bytes(e),StandardCharsets.UTF_8);MaterialWire.require(payload.getBytes(StandardCharsets.UTF_8).length<=MaterialWire.MAX_EVENT_BYTES,"MATERIAL_EVENT_BUDGET");
  Map<String,Object> completed=retiredMatch(e,payload);if(completed!=null)return WireJson.map(MaterialWire.copy(completed));
  for(Object item:rows){Map<String,Object> r=WireJson.map(item);if(r.get("event_id").equals(e.get("event_id"))||r.get("material_id").equals(b.get("material_id"))&&MaterialWire.positive(r.get("revision"))==MaterialWire.positive(b.get("revision"))){boolean known=r.get("payload").equals(payload);if(r.get("text_revision_repair")!=null){Map<String,Object> repair=WireJson.map(r.get("text_revision_repair"));if(repair.get("event_id").equals(e.get("event_id"))&&repair.get("payload").equals(payload))known=true;}for(Object old:WireJson.list(r.get("history"))){Map<String,Object> h=WireJson.map(old);if(h.get("event_id").equals(e.get("event_id"))&&h.get("payload_sha256").equals(TaskWire.hash(payload.getBytes(StandardCharsets.UTF_8))))known=true;}for(Object old:WireJson.list(r.get("superseded"))){Map<String,Object> h=WireJson.map(old);if(h.get("event_id").equals(e.get("event_id"))&&h.get("payload_sha256").equals(TaskWire.hash(payload.getBytes(StandardCharsets.UTF_8))))known=true;}if(!known&&r.get("cancellation")!=null)return replaceCancelled(r,e,payload);MaterialWire.require(known,"MATERIAL_LOCAL_REVISION_CONFLICT");return WireJson.map(WireJson.copy(r));}}
  if(b.get("operation").equals("upsert"))for(Object item:rows){Map<String,Object> r=WireJson.map(item);if(r.get("material_id").equals(b.get("material_id")))MaterialWire.require(!WireJson.map(event(r).get("body")).get("operation").equals("delete"),"MATERIAL_DELETED");}
  List<Object> next=copy();Map<String,Object> row=WireJson.object("event_id",e.get("event_id"),"material_id",b.get("material_id"),"revision",b.get("revision"),"payload",payload,"payload_sha256",TaskWire.hash(payload.getBytes(StandardCharsets.UTF_8)),"state","queued","attempts",0,"next_attempt_at",0,"needs_lookup",false,"error","","ack",null,"history",new ArrayList<>(),"absence_confirmed_at",0,"text_revision_repair",null,"cancellation",null,"superseded",new ArrayList<>());next.add(row);save(next);return WireJson.map(WireJson.copy(row));
 }
 synchronized Map<String,Object> pending(String eventId){for(Object raw:rows){Map<String,Object> r=WireJson.map(raw);if(eventId.equals(r.get("event_id"))&&!"server_stored".equals(r.get("state"))&&r.get("text_revision_repair")==null)return WireJson.map(MaterialWire.copy(r));}return null;}
 synchronized boolean recordCancellation(String eventId,String hash,byte[] response)throws IOException{
  List<Object> next=copy();for(Object raw:next){Map<String,Object> r=WireJson.map(raw);if(!eventId.equals(r.get("event_id")))continue;MaterialWire.require(hash.equals(r.get("payload_sha256"))&&!"sending".equals(r.get("state")),"MATERIAL_CANCELLATION_STALE");Map<String,Object> proof=WireJson.map(WireJson.read(response));
   if("cancelled".equals(proof.get("state"))){MaterialWire.cancellation(proof,event(r),hash,connection);r.put("cancellation",proof);r.put("state","cancelled");r.put("ack",null);}else{MaterialWire.ack(proof,event(r));r.put("state","server_stored");r.put("ack",proof);r.put("cancellation",null);}
   r.put("needs_lookup",false);r.put("error","");save(next);return true;
  }return false;
 }
 private Map<String,Object> replaceCancelled(Map<String,Object> previous,Map<String,Object> replacement,String payload)throws IOException{
  Map<String,Object> old=event(previous),before=WireJson.map(old.get("body")),body=WireJson.map(replacement.get("body"));
  MaterialWire.cancellation(WireJson.map(previous.get("cancellation")),old,(String)previous.get("payload_sha256"),connection);
  MaterialWire.require(previous.get("text_revision_repair")==null&&MaterialWire.choice(body.get("source"),"lifelog","agent_analysis")&&MaterialWire.choice(body.get("operation"),"upsert","delete")&&before.get("source").equals(body.get("source"))&&"upsert".equals(before.get("operation"))&&(!"delete".equals(body.get("operation"))||before.get("started_at").equals(body.get("started_at"))&&before.get("ended_at").equals(body.get("ended_at")))&&before.get("material_id").equals(body.get("material_id"))&&before.get("revision").equals(body.get("revision"))&&before.get("base_revision").equals(body.get("base_revision"))&&!old.get("event_id").equals(replacement.get("event_id"))&&!old.get("idempotency_key").equals(replacement.get("idempotency_key")),"MATERIAL_REPLACEMENT_INVALID");
  List<Object> next=copy();for(Object raw:next){Map<String,Object> r=WireJson.map(raw);MaterialWire.require(!body.get("material_id").equals(r.get("material_id"))||MaterialWire.positive(r.get("revision"))<=MaterialWire.positive(body.get("revision")),"MATERIAL_REPLACEMENT_STALE");}
  for(Object raw:next){Map<String,Object> r=WireJson.map(raw);if(!old.get("event_id").equals(r.get("event_id")))continue;
   List<Object> history=WireJson.list(r.get("superseded"));history.add(WireJson.object("event_id",old.get("event_id"),"payload_sha256",r.get("payload_sha256"),"cancellation",r.get("cancellation")));
   r.put("event_id",replacement.get("event_id"));r.put("payload",payload);r.put("payload_sha256",TaskWire.hash(payload.getBytes(StandardCharsets.UTF_8)));r.put("cancellation",null);r.put("state","queued");r.put("attempts",0);r.put("next_attempt_at",0);r.put("needs_lookup",false);r.put("error","");r.put("absence_confirmed_at",0);save(next);return WireJson.map(MaterialWire.copy(r));
  }throw new IOException("MATERIAL_REPLACEMENT_STALE");
 }
 private Map<String,Object> storedBase(List<Object> values,Map<String,Object> body){
  for(Object raw:values){Map<String,Object> row=WireJson.map(raw);if(body.get("material_id").equals(row.get("material_id"))&&MaterialWire.number(body.get("base_revision"))==MaterialWire.positive(row.get("revision"))&&"server_stored".equals(row.get("state"))){MaterialWire.ack(WireJson.map(row.get("ack")),event(row));return row;}}return null;
 }
 private static Map<String,Object> correctTranscript(Map<String,Object> bad,Map<String,Object> base){
  if(!"lifelog".equals(bad.get("source"))||!"lifelog".equals(base.get("source"))||!"upsert".equals(bad.get("operation"))||!"upsert".equals(base.get("operation"))||!bad.get("material_id").equals(base.get("material_id"))||MaterialWire.positive(bad.get("revision"))!=Math.addExact(MaterialWire.positive(base.get("revision")),1)||MaterialWire.number(bad.get("base_revision"))!=MaterialWire.positive(base.get("revision"))||!bad.get("text_revision").equals(base.get("text_revision")))return null;
  if(Objects.equals(bad.get("full_text"),base.get("full_text"))&&Objects.equals(bad.get("utterances"),base.get("utterances"))&&Objects.equals(bad.get("speakers"),base.get("speakers")))return null;
  Map<String,Object> fixed=WireJson.map(WireJson.copy(bad));fixed.put("text_revision",Math.addExact(MaterialWire.positive(base.get("text_revision")),1));MaterialWire.body(fixed);return fixed;
 }
 synchronized boolean needsTextRevisionRepair(String eventId){
  for(Object raw:rows){Map<String,Object> row=WireJson.map(raw);if(!eventId.equals(row.get("event_id"))||"server_stored".equals(row.get("state"))||"cancelled".equals(row.get("state")))continue;Map<String,Object> body=WireJson.map(event(row).get("body")),base=storedBase(rows,body);return base!=null&&correctTranscript(body,WireJson.map(event(base).get("body")))!=null;}return false;
 }
 /** Narrow recovery for the old mapper defect. A fresh, exact not-found lookup
  * and an acknowledged immutable predecessor are mandatory. This old body is
  * impossible to commit under the server's text-revision/CAS rules, even if an
  * earlier request arrives late. Arbitrary changed pending bodies are NOT
  * superseded here. The original payload stays in the same atomic document and
  * remains a replay alias for the untouched official-source journal. */
 synchronized boolean repairTextRevision(Claim lookup,int status,byte[] response,MaterialConnection connection,long now)throws IOException{
  if(lookup==null||lookup.owner!=this||!"lookup".equals(lookup.action)||status!=404)return false;
  boolean absent=false;try{Map<String,Object> r=WireJson.map(WireJson.read(response));absent="1.0".equals(r.get("schema_version"))&&"EVENT_NOT_FOUND".equals(WireJson.map(r.get("error")).get("code"));}catch(RuntimeException ignored){}if(!absent)return false;
  MaterialWire.require(binding.equals(connection.binding())&&now>=0&&connection.expiresAt>now,"MATERIAL_TARGET_CHANGED");List<Object> next=copy();
  if(next.stream().anyMatch(v->"sending".equals(WireJson.map(v).get("state"))))return false;
  for(Object raw:next){Map<String,Object> row=WireJson.map(raw);if(!lookup.eventId.equals(row.get("event_id")))continue;
   if(!lookup.payload.equals(row.get("payload"))||lookup.attempt!=MaterialWire.number(row.get("attempts"))||Boolean.TRUE.equals(row.get("needs_lookup"))||!MaterialWire.choice(row.get("state"),"queued","expired")||row.get("text_revision_repair")!=null)return false;
   Map<String,Object> old=event(row),bad=WireJson.map(old.get("body")),base=storedBase(next,bad);if(base==null)return false;
   Map<String,Object> fixed=correctTranscript(bad,WireJson.map(event(base).get("body")));if(fixed==null)return false;
   // A pending later deletion/change needs its own reconciliation workflow.
   for(Object other:next){Map<String,Object> r=WireJson.map(other);if(row.get("material_id").equals(r.get("material_id"))&&MaterialWire.positive(r.get("revision"))>MaterialWire.positive(row.get("revision")))return false;}
   Map<String,Object> replacement=WireJson.map(WireJson.copy(old));String id="material-text-fix-"+TaskWire.hash(WireJson.bytes(WireJson.object("binding",binding,"previous",lookup.eventId,"body",TaskWire.hash(WireJson.bytes(fixed)))));
   replacement.put("event_id",id);replacement.put("idempotency_key",id);replacement.put("created_at",TaskWire.now(now));replacement.put("expires_at",connection.expires);replacement.put("body",fixed);String payload=new String(WireJson.bytes(replacement),StandardCharsets.UTF_8);
   row.put("text_revision_repair",WireJson.object("event_id",lookup.eventId,"payload",lookup.payload,"payload_sha256",row.get("payload_sha256"),"base_payload_sha256",base.get("payload_sha256"),"absence_confirmed_at",now));
   row.put("event_id",id);row.put("payload",payload);row.put("payload_sha256",TaskWire.hash(payload.getBytes(StandardCharsets.UTF_8)));row.put("state","queued");row.put("attempts",0);row.put("next_attempt_at",0);row.put("error","");row.put("absence_confirmed_at",0);save(next);return true;
  }return false;
 }
 /** Called only after fresh identity verification. Expired events must first be
  * looked up after expiry; never change an event whose outcome is unknown. */
 synchronized int prepareRenewal(MaterialConnection connection,long now,Set<String> allowedMaterials)throws IOException{
  MaterialWire.require(now>=0&&binding.equals(connection.binding())&&connection.expiresAt>now,"MATERIAL_TARGET_CHANGED");List<Object> next=copy();if(next.stream().anyMatch(v->WireJson.map(v).get("state").equals("sending")))return 0;int changed=0;
  for(Object item:next){Map<String,Object> row=WireJson.map(item);if(allowedMaterials!=null&&!allowedMaterials.contains(row.get("material_id")))continue;Map<String,Object> old=event(row);if(MaterialWire.time(old.get("expires_at"))>now||row.get("state").equals("server_stored")||row.get("state").equals("blocked"))continue;
   if(!MaterialWire.choice(row.get("state"),"queued","expired","retry_wait","reconcile"))continue;
   if(Boolean.TRUE.equals(row.get("needs_lookup")))continue;
   if(!row.get("state").equals("expired")||!row.get("error").equals("EXPIRED_ABSENT")||MaterialWire.number(row.get("absence_confirmed_at"))<MaterialWire.time(old.get("expires_at"))){row.put("state","reconcile");row.put("needs_lookup",true);row.put("next_attempt_at",0);row.put("error","");changed++;continue;}
   boolean deleted=next.stream().anyMatch(v->{Map<String,Object> r=WireJson.map(v);return r.get("material_id").equals(row.get("material_id"))&&MaterialWire.positive(r.get("revision"))>MaterialWire.positive(row.get("revision"))&&WireJson.map(event(r).get("body")).get("operation").equals("delete");});if(deleted)continue;
   if(MaterialWire.number(row.get("absence_confirmed_at"))>now)continue;List<Object> history=WireJson.list(row.get("history"));MaterialWire.require(history.size()<16,"MATERIAL_RENEWAL_LIMIT");history.add(WireJson.object("event_id",old.get("event_id"),"payload_sha256",row.get("payload_sha256"),"expires_at",old.get("expires_at"),"absence_confirmed_at",row.get("absence_confirmed_at")));
   Map<String,Object> renewed=WireJson.map(WireJson.copy(old));String id="material-renew-"+TaskWire.hash(WireJson.bytes(WireJson.object("binding",binding,"previous",old.get("event_id"))));renewed.put("event_id",id);renewed.put("idempotency_key",id);renewed.put("created_at",TaskWire.now(now));renewed.put("expires_at",connection.expires);String payload=new String(WireJson.bytes(renewed),StandardCharsets.UTF_8);
   row.put("event_id",id);row.put("payload",payload);row.put("payload_sha256",TaskWire.hash(payload.getBytes(StandardCharsets.UTF_8)));row.put("state","queued");row.put("attempts",0);row.put("next_attempt_at",0);row.put("needs_lookup",false);row.put("error","");row.put("absence_confirmed_at",0);changed++;
  }if(changed>0)save(next);return changed;
 }
 synchronized Claim claim(long now,Set<String> versions)throws IOException{
  return claim(now,versions,null);
 }
 /** Outcome-only reconciliation for a changed source. Never claims a POST,
  * renews an event or removes its immutable payload. Caller verifies identity. */
 synchronized Claim claimLookup(String eventId)throws IOException{
  List<Object> next=copy();if(next.stream().anyMatch(v->WireJson.map(v).get("state").equals("sending")))return null;
  for(Object raw:next){Map<String,Object> row=WireJson.map(raw);if(!eventId.equals(row.get("event_id"))||"server_stored".equals(row.get("state"))||"cancelled".equals(row.get("state")))continue;
   row.put("needs_lookup",true);row.put("state","sending");row.put("attempts",Math.addExact(MaterialWire.number(row.get("attempts")),1));row.put("error","");save(next);return new Claim(this,row);
  }return null;
 }
 synchronized Claim claim(long now,Set<String> versions,Set<String> allowedMaterials)throws IOException{
  MaterialWire.require(now>=0&&versions!=null,"MATERIAL_CLOCK_INVALID");List<Object> next=copy();if(next.stream().anyMatch(v->WireJson.map(v).get("state").equals("sending")))return null;
  List<Map<String,Object>> ordered=new ArrayList<>();for(Object v:next)ordered.add(WireJson.map(v));ordered.sort(Comparator.comparingLong(r->MaterialWire.positive(r.get("revision"))));boolean changed=false;
  for(Map<String,Object> r:ordered){if(allowedMaterials!=null&&!allowedMaterials.contains(r.get("material_id")))continue;if(!MaterialWire.choice(r.get("state"),"queued","retry_wait","reconcile")||MaterialWire.number(r.get("next_attempt_at"))>now)continue;Map<String,Object> e=event(r),b=WireJson.map(e.get("body"));boolean lookup=Boolean.TRUE.equals(r.get("needs_lookup"));
   if(!lookup&&MaterialWire.time(e.get("expires_at"))<=now){r.put("state","expired");r.put("error","EXPIRED");changed=true;continue;}
   boolean deletion=ordered.stream().anyMatch(v->v.get("material_id").equals(r.get("material_id"))&&MaterialWire.positive(v.get("revision"))>MaterialWire.positive(r.get("revision"))&&WireJson.map(event(v).get("body")).get("operation").equals("delete"));
   // A later local deletion is never a reason to send old private text first just to
   // satisfy CAS. Unknown earlier sends may be reconciled; absent revisions need a
   // deliberate deletion reconciliation, not an invented successful tombstone.
   if(!lookup&&deletion&&b.get("operation").equals("upsert")){r.put("error","DELETE_REQUIRES_RECONCILIATION");changed=true;continue;}
   long revision=MaterialWire.positive(r.get("revision"));if(!lookup&&revision>1&&!ordered.stream().anyMatch(v->v.get("material_id").equals(r.get("material_id"))&&MaterialWire.positive(v.get("revision"))==revision-1&&v.get("state").equals("server_stored")))continue;
   if(!lookup&&!versions.contains("1.2")){r.put("error","MATERIAL_SCHEMA_UNSUPPORTED");changed=true;continue;}
   r.put("state","sending");r.put("attempts",Math.addExact(MaterialWire.number(r.get("attempts")),1));r.put("error","");save(next);return new Claim(this,r);
  }if(changed)save(next);return null;
 }
 synchronized boolean finish(Claim claim,int status,byte[] raw,long now,long retryAfter)throws IOException{
  if(claim==null||claim.owner!=this)return false;MaterialWire.require(now>=0&&retryAfter>=0&&retryAfter<=86400000&&(status==0||status>=100&&status<=599),"MATERIAL_RESULT_INVALID");List<Object> next=copy();Map<String,Object> row=null;
  for(Object v:next){Map<String,Object> r=WireJson.map(v);if(r.get("event_id").equals(claim.eventId)){row=r;break;}}
  if(row==null||!row.get("state").equals("sending")||MaterialWire.number(row.get("attempts"))!=claim.attempt||!row.get("payload").equals(claim.payload)||!claim.action.equals(Boolean.TRUE.equals(row.get("needs_lookup"))?"lookup":"send"))return false;
  if(status==200||status==201){try{MaterialWire.require(raw!=null&&raw.length<=16384,"MATERIAL_ACK_MISMATCH");Map<String,Object> ack=WireJson.map(WireJson.read(raw));if("cancelled".equals(ack.get("state"))){MaterialWire.cancellation(ack,event(row),(String)row.get("payload_sha256"),connection);row.put("state","cancelled");row.put("cancellation",ack);row.put("ack",null);}else{MaterialWire.ack(ack,event(row));row.put("state","server_stored");row.put("ack",ack);row.put("cancellation",null);}row.put("needs_lookup",false);row.put("error","");}catch(RuntimeException invalid){row.put("state","blocked");row.put("needs_lookup",true);row.put("error","ACK_INVALID");}}
  else if(status==404&&claim.action.equals("lookup")){
   boolean absent=false;try{Map<String,Object> v=WireJson.map(WireJson.read(raw));absent="1.0".equals(v.get("schema_version"))&&"EVENT_NOT_FOUND".equals(WireJson.map(v.get("error")).get("code"));}catch(RuntimeException ignored){}
   if(absent){row.put("needs_lookup",false);row.put("state",MaterialWire.time(event(row).get("expires_at"))<=now?"expired":"queued");row.put("next_attempt_at",0);row.put("error",row.get("state").equals("expired")?"EXPIRED_ABSENT":"");row.put("absence_confirmed_at",row.get("state").equals("expired")?now:0);}else{row.put("state","blocked");row.put("needs_lookup",true);row.put("error","LOOKUP_NOT_CONFIRMED");}
  }else if(status==0||status==429||status>=500){row.put("state","retry_wait");row.put("needs_lookup",true);row.put("error",status==0?"TRANSPORT_UNKNOWN":status==429?"RATE_LIMITED":"UNAVAILABLE");row.put("next_attempt_at",Math.addExact(now,Math.max(retryAfter,Math.min(30000,1000L<<Math.min(5,claim.attempt-1)))));}
  else{row.put("state","blocked");row.put("needs_lookup",true);row.put("error",status==401?"AUTH_REQUIRED":status==403?"FORBIDDEN":status==409?"CONFLICT":"REJECTED");}
  save(next);return true;
 }
 synchronized int resumeBlocked()throws IOException{List<Object> next=copy();int n=0;for(Object v:next){Map<String,Object> row=WireJson.map(v);if(row.get("state").equals("blocked")){row.put("state","reconcile");row.put("needs_lookup",true);row.put("next_attempt_at",0);row.put("error","");n++;}}if(n>0)save(next);return n;}
 public synchronized void close()throws IOException{if(!closed){document.close();closed=true;}}
}
