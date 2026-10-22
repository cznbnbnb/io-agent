package com.turboio.addon;
import java.io.*;import java.nio.charset.StandardCharsets;import java.util.*;

/** Durable handoff for authoritative fresh reads. Keep this owner open while
 * fetching and staging: its file lock serializes fresh reads across processes.
 * Bootstrap observations stay in their existing journal. Neither absence from a
 * response nor a failed GET creates a deletion here. */
final class LifelogRevisionJournal implements AutoCloseable {
 interface Guard {OfficialAccountBinding current()throws Exception;}
 private final AtomicDocument document;private final MaterialConnection connection;private final String account;
 private List<Object> records;private boolean closed;
 LifelogRevisionJournal(File files,MaterialConnection connection,String account)throws IOException{
  MaterialWire.require(account!=null&&account.matches("[a-f0-9]{64}"),"OFFICIAL_ACCOUNT_INVALID");this.connection=connection;this.account=account;
  File file=new File(files,"lifelog-revisions/"+connection.binding()+"/"+account+"/state.json");document=new AtomicDocument(file);
  try{if(new File(file.getPath()+".partial").exists())throw new IOException("LIFELOG_REVISION_UNCERTAIN");Object raw=document.read();records=new ArrayList<>();if(raw!=null){Map<String,Object> state=WireJson.map(raw);BoundedJson.keys(state,"schema","account","connection","records");MaterialWire.require(MaterialWire.positive(state.get("schema"))==1&&account.equals(state.get("account"))&&connection.binding().equals(state.get("connection")),"LIFELOG_REVISION_BINDING");records=WireJson.list(state.get("records"));validate(records);}}
  catch(IOException|RuntimeException failure){document.close();throw failure;}
 }
 private void admit(Guard guard)throws Exception{MaterialWire.require(!closed,"LIFELOG_REVISION_CLOSED");OfficialAccountBinding current=guard.current();MaterialWire.require(current!=null&&account.equals(current.binding),"OFFICIAL_ACCOUNT_CHANGED");}
 private void validate(List<Object> rows){
  MaterialWire.require(rows.size()<=256,"LIFELOG_REVISION_FULL");Set<String> unique=new HashSet<>();long bytes=0;
  for(Object raw:rows){Map<String,Object> row=WireJson.map(raw);BoundedJson.keys(row,"original","original_sha256","event");String original=MaterialWire.text(row.get("original"),1048576,false),encoded=MaterialWire.text(row.get("event"),262144,false);byte[] sourceBytes=original.getBytes(StandardCharsets.UTF_8);MaterialWire.require(TaskWire.hash(sourceBytes).equals(row.get("original_sha256")),"LIFELOG_REVISION_CORRUPT");
   OfficialLifelogSnapshot.Source source=OfficialLifelogSnapshot.original(sourceBytes);Map<String,Object> event=MaterialWire.event(encoded.getBytes(StandardCharsets.UTF_8),connection.producer),body=WireJson.map(event.get("body"));String id=source.materialId(account);long revision=MaterialWire.positive(body.get("revision"));MaterialWire.require(id.equals(body.get("material_id"))&&"lifelog".equals(body.get("source"))&&"upsert".equals(body.get("operation"))&&unique.add(id+"/"+revision),"LIFELOG_REVISION_CORRUPT");bytes+=sourceBytes.length+encoded.getBytes(StandardCharsets.UTF_8).length;
  }MaterialWire.require(bytes<=4194304,"LIFELOG_REVISION_FULL");
 }
 /** Replays exact prepared payloads. It must run before stageFresh so an earlier
  * interrupted journal->queue handoff cannot be mistaken for a new revision. */
 synchronized int replay(Guard guard,MaterialOutbox outbox)throws Exception{
  admit(guard);MaterialWire.require(connection.binding().equals(outbox.binding()),"MATERIAL_TARGET_CHANGED");int n=0;
  for(Object raw:records){admit(guard);outbox.enqueue(((String)WireJson.map(raw).get("event")).getBytes(StandardCharsets.UTF_8));n++;}return n;
 }
 synchronized boolean ownsInitial(String materialId){
  MaterialWire.require(!closed,"LIFELOG_REVISION_CLOSED");for(Object raw:records){Map<String,Object> event=WireJson.map(WireJson.read(((String)WireJson.map(raw).get("event")).getBytes(StandardCharsets.UTF_8))),body=WireJson.map(event.get("body"));if(materialId.equals(body.get("material_id"))&&MaterialWire.positive(body.get("revision"))==1)return true;}return false;
 }
 private static Map<String,Object> body(Map<String,Object> row){return WireJson.map(WireJson.map(WireJson.read(((String)row.get("payload")).getBytes(StandardCharsets.UTF_8))).get("body"));}
 private static boolean equivalent(Map<String,Object> fresh,Map<String,Object> before){Map<String,Object> a=new TreeMap<>(fresh),b=new TreeMap<>(before);a.remove("revision");a.remove("base_revision");b.remove("revision");b.remove("base_revision");return a.equals(b);}
 /** Only fresh successful authenticated full responses belong here. Missing
  * records are retained. A changed pending revision needs outcome reconciliation
  * (and, if absent, deliberate supersession), never an automatic stale upload. */
 synchronized int stageFresh(List<OfficialLifelogSnapshot.Source> sources,Guard guard,MaterialOutbox outbox,long now)throws Exception{
  admit(guard);MaterialWire.require(now>=0&&connection.expiresAt>now&&connection.binding().equals(outbox.binding()),"MATERIAL_IMPORT_EXPIRED");MaterialWire.require(sources!=null&&sources.size()<=256,"LIFELOG_REVISION_FULL");
  Map<String,OfficialLifelogSnapshot.Source> selected=new TreeMap<>();for(OfficialLifelogSnapshot.Source source:sources){String id=source.materialId(account);OfficialLifelogSnapshot.Source prior=selected.put(id,source);MaterialWire.require(prior==null||Arrays.equals(prior.original(),source.original()),"LIFELOG_FRESH_SOURCE_CONFLICT");}
  Map<String,Map<String,Object>> latest=new HashMap<>();Set<String> queuedPayloads=new HashSet<>();
  for(Object raw:outbox.all()){Map<String,Object> row=WireJson.map(raw),b=body(row);String id=(String)b.get("material_id");Map<String,Object> prior=latest.get(id);if(prior==null||MaterialWire.positive(b.get("revision"))>MaterialWire.positive(prior.get("revision")))latest.put(id,row);queuedPayloads.add((String)row.get("payload_sha256"));if(row.get("text_revision_repair")!=null)queuedPayloads.add((String)WireJson.map(row.get("text_revision_repair")).get("payload_sha256"));for(Object history:WireJson.list(row.get("history")))queuedPayloads.add((String)WireJson.map(history).get("payload_sha256"));}
  // The caller must replay any durable intent first, including aliases retained
  // when an expired event was renewed by MaterialOutbox.
  for(Object raw:records)MaterialWire.require(queuedPayloads.contains(TaskWire.hash(((String)WireJson.map(raw).get("event")).getBytes(StandardCharsets.UTF_8))),"LIFELOG_REVISION_REPLAY_REQUIRED");
  List<Object> next=WireJson.list(WireJson.copy(records));int added=0;
  for(Map.Entry<String,OfficialLifelogSnapshot.Source> item:selected.entrySet()){
   String id=item.getKey();OfficialLifelogSnapshot.Source source=item.getValue();Map<String,Object> prior=latest.get(id),mapped;long revision=1;
   if(prior==null)mapped=WireJson.map(WireJson.read(source.materialBody(account,1)));
   else{Map<String,Object> before=body(prior);MaterialWire.require("upsert".equals(before.get("operation")),"LIFELOG_SOURCE_DELETED_REVIEW_REQUIRED");revision=Math.addExact(MaterialWire.positive(before.get("revision")),1);mapped=WireJson.map(WireJson.read(source.materialRevision(account,revision,WireJson.bytes(before))));
    if(equivalent(mapped,before))continue;
    MaterialWire.require("server_stored".equals(prior.get("state")),"LIFELOG_PENDING_REVISION_CHANGED");MaterialWire.ack(WireJson.map(prior.get("ack")),WireJson.map(WireJson.read(((String)prior.get("payload")).getBytes(StandardCharsets.UTF_8))));
   }
   String eventId="lifelog-refresh-"+TaskWire.hash(WireJson.bytes(WireJson.object("connection",connection.binding(),"material",id,"revision",revision,"body",TaskWire.hash(WireJson.bytes(mapped)))));
   Map<String,Object> event=WireJson.object("schema_version","1.2","event_id",eventId,"idempotency_key",eventId,"kind","material.revision","producer_id",connection.producer,"created_at",TaskWire.now(now),"expires_at",connection.expires,"body",mapped);byte[] payload=WireJson.bytes(event);MaterialWire.event(payload,connection.producer);byte[] original=source.original();
   next.add(WireJson.object("original",new String(original,StandardCharsets.UTF_8),"original_sha256",TaskWire.hash(original),"event",new String(payload,StandardCharsets.UTF_8)));added++;
  }
  if(added>0){validate(next);admit(guard);document.save(WireJson.object("schema",1,"account",account,"connection",connection.binding(),"records",next));records=next;}return added;
 }
 public synchronized void close()throws IOException{if(!closed){closed=true;document.close();}}
}
