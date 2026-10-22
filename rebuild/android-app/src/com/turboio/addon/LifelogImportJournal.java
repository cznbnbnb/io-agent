package com.turboio.addon;
import java.io.*;import java.nio.charset.StandardCharsets;import java.util.*;

/** Durable handoff of account-proven initial snapshots to MaterialOutbox.
 * Commit the exact event before enqueue; replay repairs either crash boundary.
 * Subsequent edits need a fresh authoritative source, not logfile timestamps. */
final class LifelogImportJournal implements AutoCloseable {
 interface Queue {void enqueue(byte[] event)throws IOException;}
 private final AtomicDocument document;private final MaterialConnection connection;private final String account;private Map<String,Object> rows;private boolean closed;
 LifelogImportJournal(File files,MaterialConnection connection,String account)throws IOException{
  MaterialWire.require(account!=null&&account.matches("[a-f0-9]{64}"),"OFFICIAL_ACCOUNT_INVALID");this.account=account;this.connection=connection;
  File file=new File(files,"lifelog-import/"+connection.binding()+"/"+account+"/state.json");document=new AtomicDocument(file);
  try{if(new File(file.getPath()+".partial").exists())throw new IOException("LIFELOG_IMPORT_UNCERTAIN");Object raw=document.read();rows=new TreeMap<>();if(raw!=null){Map<String,Object> state=WireJson.map(raw);BoundedJson.keys(state,"schema","account","connection","rows");MaterialWire.require(MaterialWire.positive(state.get("schema"))==1&&account.equals(state.get("account"))&&connection.binding().equals(state.get("connection")),"LIFELOG_IMPORT_BINDING");rows=WireJson.map(state.get("rows"));validate(rows);}}
  catch(IOException|RuntimeException failed){document.close();throw failed;}
 }
 private void validate(Map<String,Object> entries){MaterialWire.require(entries.size()<=256,"LIFELOG_IMPORT_FULL");long total=0;
  for(Map.Entry<String,Object> entry:entries.entrySet()){Map<String,Object> row=WireJson.map(entry.getValue());BoundedJson.keys(row,"source_sha256","original","event");String original=MaterialWire.text(row.get("original"),1048576,false),encoded=MaterialWire.text(row.get("event"),262144,false);Map<String,Object> event=MaterialWire.event(encoded.getBytes(StandardCharsets.UTF_8),connection.producer),body=WireJson.map(event.get("body"));MaterialWire.require(entry.getKey().equals(body.get("material_id"))&&MaterialWire.positive(body.get("revision"))==1&&"upsert".equals(body.get("operation"))&&TaskWire.hash(original.getBytes(StandardCharsets.UTF_8)).equals(row.get("source_sha256")),"LIFELOG_IMPORT_CORRUPT");total+=original.getBytes(StandardCharsets.UTF_8).length+encoded.getBytes(StandardCharsets.UTF_8).length;}
  MaterialWire.require(total<=4194304,"LIFELOG_IMPORT_FULL");
 }
 /** Caller supplies the current valid account again immediately before commit. */
 synchronized int stage(OfficialLifelogBatch batch,OfficialAccountBinding current,long now)throws IOException{
  return stage(batch,current,now,Collections.emptySet());
 }
 /** Offline bootstrap is permitted only for materials with no existing intent.
  * Fresh revisions and their original journal records must never be replaced by
  * a second revision-one event discovered in an older logfile. */
 synchronized int stage(OfficialLifelogBatch batch,OfficialAccountBinding current,long now,Set<String> existing)throws IOException{
  MaterialWire.require(!closed&&current!=null&&account.equals(current.binding)&&account.equals(batch.account),"LIFELOG_IMPORT_BINDING");MaterialWire.require(batch.selectedInventoryComplete&&batch.scanConsistent,"LIFELOG_IMPORT_SCAN_INCOMPLETE");MaterialWire.require(now>=0&&connection.expiresAt>now,"MATERIAL_IMPORT_EXPIRED");
  Map<String,Object> next=WireJson.map(WireJson.copy(rows));int added=0;
  for(OfficialLifelogSnapshot.Source source:batch.sources){String id=source.materialId(account),hash=TaskWire.hash(source.original());Map<String,Object> prior=next.containsKey(id)?WireJson.map(next.get(id)):null;
   if(existing.contains(id))continue;
   if(prior!=null){MaterialWire.require(hash.equals(prior.get("source_sha256")),"LIFELOG_SOURCE_REFRESH_REQUIRED");continue;}
   String eventId="lifelog-"+TaskWire.hash(WireJson.bytes(WireJson.object("connection",connection.binding(),"material",id,"revision",1)));
   Map<String,Object> event=WireJson.object("schema_version","1.2","event_id",eventId,"idempotency_key",eventId,"kind","material.revision","producer_id",connection.producer,"created_at",TaskWire.now(now),"expires_at",connection.expires,"body",WireJson.read(source.materialBody(account,1)));
   next.put(id,WireJson.object("source_sha256",hash,"original",new String(source.original(),StandardCharsets.UTF_8),"event",new String(WireJson.bytes(event),StandardCharsets.UTF_8)));added++;
  }
  if(added>0){validate(next);document.save(WireJson.object("schema",1,"account",account,"connection",connection.binding(),"rows",next));rows=next;}return added;
 }
 synchronized int replay(OfficialAccountBinding current,Queue queue)throws IOException{MaterialWire.require(!closed&&current!=null&&account.equals(current.binding),"LIFELOG_IMPORT_BINDING");int count=0;for(Object raw:rows.values()){Map<String,Object> row=WireJson.map(raw);queue.enqueue(((String)row.get("event")).getBytes(StandardCharsets.UTF_8));count++;}return count;}
 public synchronized void close()throws IOException{if(!closed){document.close();closed=true;}}
}
