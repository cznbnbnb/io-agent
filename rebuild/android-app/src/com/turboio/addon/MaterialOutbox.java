package com.turboio.addon;

import java.io.*;import java.nio.charset.StandardCharsets;import java.util.*;

/** Durable material-only sender. No discovery, credentials, audio, task execution or background loop. */
final class MaterialOutbox implements AutoCloseable {
 static final class Claim {
  private final MaterialOutbox owner;final String eventId,payload,action;final long attempt;
  private Claim(MaterialOutbox owner,Map<String,Object> row){this.owner=owner;eventId=(String)row.get("event_id");payload=(String)row.get("payload");action=Boolean.TRUE.equals(row.get("needs_lookup"))?"lookup":"send";attempt=MaterialWire.positive(row.get("attempts"));}
 }
 private final AtomicDocument document;private final String binding,producer;private List<Object> rows;private boolean closed;
 MaterialOutbox(File files,MaterialConnection connection)throws IOException{
  binding=connection.binding();producer=connection.producer;File file=new File(files,"material-outbox/"+binding+"/state.json");document=new AtomicDocument(file);
  try{
   if(new File(file.getPath()+".partial").exists())throw new IOException("MATERIAL_STORE_UNCERTAIN");Object raw=document.read();rows=new ArrayList<>();
   boolean migrated=false;if(raw!=null){Map<String,Object> state=WireJson.map(raw);BoundedJson.keys(state,"schema","binding","rows");long schema=MaterialWire.positive(state.get("schema"));MaterialWire.require((schema==1||schema==2||schema==3)&&binding.equals(state.get("binding")),"MATERIAL_STORE_INVALID");rows=WireJson.list(WireJson.copy(state.get("rows")));if(schema==1){for(Object item:rows){Map<String,Object> row=WireJson.map(item);BoundedJson.keys(row,"event_id","material_id","revision","payload","payload_sha256","state","attempts","next_attempt_at","needs_lookup","error","ack");row.put("history",new ArrayList<>());row.put("absence_confirmed_at",0);}migrated=true;}if(schema<3){for(Object item:rows){Map<String,Object> row=WireJson.map(item);BoundedJson.keys(row,"event_id","material_id","revision","payload","payload_sha256","state","attempts","next_attempt_at","needs_lookup","error","ack","history","absence_confirmed_at");row.put("text_revision_repair",null);}migrated=true;}validate(rows);}
   List<Object> next=copy();boolean changed=migrated;for(Object item:next){Map<String,Object> row=WireJson.map(item);if(row.get("state").equals("sending")){row.put("state","reconcile");row.put("needs_lookup",true);row.put("next_attempt_at",0);row.put("error","INTERRUPTED");changed=true;}}if(changed)save(next);
  }catch(IOException|RuntimeException invalid){document.close();throw invalid;}
 }
 private List<Object> copy(){return WireJson.list(WireJson.copy(rows));}
 String binding(){return binding;}
 synchronized List<Object> all(){return copy();}
 private Map<String,Object> event(Map<String,Object> row){byte[] bytes=((String)row.get("payload")).getBytes(StandardCharsets.UTF_8);MaterialWire.require(TaskWire.hash(bytes).equals(row.get("payload_sha256")),"MATERIAL_PAYLOAD_CORRUPT");return MaterialWire.event(bytes,producer);}
 private void validate(List<Object> values){
  MaterialWire.require(values.size()<=256,"MATERIAL_STORE_FULL");Set<String> events=new HashSet<>(),versions=new HashSet<>();long payloadBytes=0;
  for(Object item:values){Map<String,Object> r=WireJson.map(item);BoundedJson.keys(r,"event_id","material_id","revision","payload","payload_sha256","state","attempts","next_attempt_at","needs_lookup","error","ack","history","absence_confirmed_at","text_revision_repair");Map<String,Object> e=event(r),b=WireJson.map(e.get("body"));
   MaterialWire.require(events.add((String)e.get("event_id"))&&versions.add(b.get("material_id")+"/"+b.get("revision"))&&e.get("event_id").equals(r.get("event_id"))&&b.get("material_id").equals(r.get("material_id"))&&MaterialWire.positive(b.get("revision"))==MaterialWire.positive(r.get("revision")),"MATERIAL_STORE_INVALID");
   MaterialWire.require(MaterialWire.choice(r.get("state"),"queued","sending","reconcile","retry_wait","server_stored","blocked","expired")&&r.get("needs_lookup") instanceof Boolean,"MATERIAL_STORE_INVALID");MaterialWire.number(r.get("attempts"));MaterialWire.number(r.get("next_attempt_at"));MaterialWire.require(MaterialWire.text(r.get("error"),80,true).matches("[A-Z_]*"),"MATERIAL_STORE_INVALID");
   if(r.get("state").equals("server_stored")){MaterialWire.require(Boolean.FALSE.equals(r.get("needs_lookup")),"MATERIAL_STORE_INVALID");MaterialWire.ack(WireJson.map(r.get("ack")),e);}else MaterialWire.require(r.get("ack")==null,"MATERIAL_STORE_INVALID");
   long absence=MaterialWire.number(r.get("absence_confirmed_at"));MaterialWire.require(absence==0||absence>=MaterialWire.time(e.get("expires_at")),"MATERIAL_STORE_INVALID");List<Object> history=WireJson.list(r.get("history"));MaterialWire.require(history.size()<=16,"MATERIAL_RENEWAL_LIMIT");for(Object old:history){Map<String,Object> h=WireJson.map(old);BoundedJson.keys(h,"event_id","payload_sha256","expires_at","absence_confirmed_at");MaterialWire.require(events.add(MaterialWire.text(h.get("event_id"),512,false))&&MaterialWire.text(h.get("payload_sha256"),64,false).matches("[a-f0-9]{64}")&&MaterialWire.number(h.get("absence_confirmed_at"))>=MaterialWire.time(h.get("expires_at")),"MATERIAL_STORE_INVALID");}
   if(r.get("text_revision_repair")!=null){Map<String,Object> repair=WireJson.map(r.get("text_revision_repair"));BoundedJson.keys(repair,"event_id","payload","payload_sha256","base_payload_sha256","absence_confirmed_at");
    String original=MaterialWire.text(repair.get("payload"),MaterialWire.MAX_EVENT_BYTES,false);byte[] originalBytes=original.getBytes(StandardCharsets.UTF_8);Map<String,Object> originalEvent=MaterialWire.event(originalBytes,producer),originalBody=WireJson.map(originalEvent.get("body"));
    MaterialWire.require(events.add((String)originalEvent.get("event_id"))&&originalEvent.get("event_id").equals(repair.get("event_id"))&&TaskWire.hash(originalBytes).equals(repair.get("payload_sha256"))&&MaterialWire.number(repair.get("absence_confirmed_at"))>=MaterialWire.time(originalEvent.get("created_at")),"MATERIAL_REPAIR_INVALID");
    Map<String,Object> base=storedBase(values,originalBody);MaterialWire.require(base!=null&&base.get("payload_sha256").equals(repair.get("base_payload_sha256")),"MATERIAL_REPAIR_INVALID");
    Map<String,Object> corrected=correctTranscript(originalBody,WireJson.map(event(base).get("body")));MaterialWire.require(corrected!=null&&corrected.equals(b),"MATERIAL_REPAIR_INVALID");payloadBytes+=originalBytes.length;
   }
   payloadBytes+=((String)r.get("payload")).getBytes(StandardCharsets.UTF_8).length;
  }MaterialWire.require(payloadBytes<=4194304,"MATERIAL_STORE_FULL");
 }
 private void save(List<Object> next)throws IOException{MaterialWire.require(!closed,"MATERIAL_STORE_CLOSED");validate(next);Map<String,Object> state=WireJson.object("schema",3,"binding",binding,"rows",next);MaterialWire.require(WireJson.bytes(state).length<=8388608,"MATERIAL_STORE_FULL");document.save(state);rows=next;}
 synchronized Map<String,Object> enqueue(byte[] raw)throws IOException{
  Map<String,Object> e=MaterialWire.event(raw,producer),b=WireJson.map(e.get("body"));String payload=new String(WireJson.bytes(e),StandardCharsets.UTF_8);MaterialWire.require(payload.getBytes(StandardCharsets.UTF_8).length<=MaterialWire.MAX_EVENT_BYTES,"MATERIAL_EVENT_BUDGET");
  for(Object item:rows){Map<String,Object> r=WireJson.map(item);if(r.get("event_id").equals(e.get("event_id"))||r.get("material_id").equals(b.get("material_id"))&&MaterialWire.positive(r.get("revision"))==MaterialWire.positive(b.get("revision"))){boolean known=r.get("payload").equals(payload);if(r.get("text_revision_repair")!=null){Map<String,Object> repair=WireJson.map(r.get("text_revision_repair"));if(repair.get("event_id").equals(e.get("event_id"))&&repair.get("payload").equals(payload))known=true;}for(Object old:WireJson.list(r.get("history"))){Map<String,Object> h=WireJson.map(old);if(h.get("event_id").equals(e.get("event_id"))&&h.get("payload_sha256").equals(TaskWire.hash(payload.getBytes(StandardCharsets.UTF_8))))known=true;}MaterialWire.require(known,"MATERIAL_LOCAL_REVISION_CONFLICT");return WireJson.map(WireJson.copy(r));}}
  if(b.get("operation").equals("upsert"))for(Object item:rows){Map<String,Object> r=WireJson.map(item);if(r.get("material_id").equals(b.get("material_id")))MaterialWire.require(!WireJson.map(event(r).get("body")).get("operation").equals("delete"),"MATERIAL_DELETED");}
  List<Object> next=copy();Map<String,Object> row=WireJson.object("event_id",e.get("event_id"),"material_id",b.get("material_id"),"revision",b.get("revision"),"payload",payload,"payload_sha256",TaskWire.hash(payload.getBytes(StandardCharsets.UTF_8)),"state","queued","attempts",0,"next_attempt_at",0,"needs_lookup",false,"error","","ack",null,"history",new ArrayList<>(),"absence_confirmed_at",0,"text_revision_repair",null);next.add(row);save(next);return WireJson.map(WireJson.copy(row));
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
  for(Object raw:rows){Map<String,Object> row=WireJson.map(raw);if(!eventId.equals(row.get("event_id"))||"server_stored".equals(row.get("state")))continue;Map<String,Object> body=WireJson.map(event(row).get("body")),base=storedBase(rows,body);return base!=null&&correctTranscript(body,WireJson.map(event(base).get("body")))!=null;}return false;
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
  for(Object raw:next){Map<String,Object> row=WireJson.map(raw);if(!eventId.equals(row.get("event_id"))||"server_stored".equals(row.get("state")))continue;
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
  if(status==200||status==201){try{MaterialWire.require(raw!=null&&raw.length<=16384,"MATERIAL_ACK_MISMATCH");Map<String,Object> ack=WireJson.map(WireJson.read(raw));MaterialWire.ack(ack,event(row));row.put("state","server_stored");row.put("ack",ack);row.put("needs_lookup",false);row.put("error","");}catch(RuntimeException invalid){row.put("state","blocked");row.put("needs_lookup",true);row.put("error","ACK_INVALID");}}
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
