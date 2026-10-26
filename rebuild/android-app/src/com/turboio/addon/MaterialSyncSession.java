package com.turboio.addon;
import java.io.*;import java.util.*;

/** One bounded manual sync. Account guard wraps every HTTP request, including
 * event reconciliation; initial import and queue files are account-isolated. */
final class MaterialSyncSession {
 interface AccountSource {OfficialAccountBinding current()throws Exception;default OfficialRecordingDeletion.Source deletions(){return null;}}
 interface Source extends AccountSource {OfficialLifelogBatch read()throws Exception;}
 interface FreshSource extends Source {OfficialLifelogRefresh.Fresh refresh(OfficialLifelogBatch observed)throws Exception;}
 interface DiscoverySource extends AccountSource {OfficialLifelogDiscovery.Snapshot discover()throws Exception;}
 interface Guard {void check()throws IOException;}
 static final class Status {
  boolean selectedComplete,progressed;
  int queued,stored,blocked,expired,reconcile,added,conflicts,unowned,invalid,discovered,days,recordings,otherEntries,tooLarge;String note="ready";
  Map<String,Object> summary(){return WireJson.object("queued",queued,"stored",stored,"blocked",blocked,"expired",expired,"reconcile",reconcile,"added",added,"conflicts",conflicts,"unowned",unowned,"invalid",invalid,"discovered",discovered,"days",days,"recordings",recordings,"other_entries",otherEntries,"too_large",tooLarge,"note",note);}
 }
 private OfficialDeletionSync deletionGuard;
 private final File root,files;private final MaterialConfig config;private final AccountSource source;private final Guard guard;private final MaterialApi api;
 MaterialSyncSession(File files,MaterialConfig config,Source source,Guard guard,MaterialApi.Transport transport){this(files,config,(AccountSource)source,guard,transport);}
 MaterialSyncSession(File files,MaterialConfig config,AccountSource source,Guard guard,MaterialApi.Transport transport){this.root=files;this.files=accountFiles(files,config);this.config=config;this.source=source;this.guard=guard;
  api=new MaterialApi(config.connection,new MaterialApi.Transport(){public MaterialApi.Response exchange(String path,byte[] body)throws IOException{admitDeletion();MaterialApi.Response response=transport.exchange(path,body);admitDeletion();return response;}public void cancel(){transport.cancel();}});
 }
 private void admitDeletion()throws IOException{admit();if(deletionGuard!=null)try{deletionGuard.check();}catch(IOException|RuntimeException failed){throw failed;}catch(Exception failed){throw new IOException("OFFICIAL_DELETION_UNAVAILABLE");}}
 private static Set<String> heldDeletions(MaterialOutbox outbox){
  Set<String> held=new HashSet<>();for(Object raw:outbox.all()){Map<String,Object> row=WireJson.map(raw);Map<String,Object> event=WireJson.map(MaterialWire.read(((String)row.get("payload")).getBytes(java.nio.charset.StandardCharsets.UTF_8)));if("delete".equals(WireJson.map(event.get("body")).get("operation")))held.add((String)row.get("material_id"));}return held;
 }
 static File accountFiles(File files,MaterialConfig config){return MaterialStorage.current(files,config);}
 private OfficialAccountBinding admit()throws IOException{
  guard.check();MaterialWire.require(config.enabled,"MATERIAL_PAUSED");try{OfficialAccountBinding now=source.current();MaterialWire.require(now!=null&&config.account.equals(now.binding),"OFFICIAL_ACCOUNT_CHANGED");return now;}catch(IOException|RuntimeException failure){throw failure;}catch(Exception failure){throw new IOException("OFFICIAL_ACCOUNT_UNAVAILABLE");}
 }
 static Status status(File files,MaterialConfig config)throws IOException{Status status=new Status();if(config==null){status.note="unconfigured";return status;}try(MaterialOutbox outbox=new MaterialOutbox(MaterialStorage.prepare(files,config),config.connection)){count(status,outbox);}if(!config.enabled)status.note="paused";return status;}
 private static void count(Status status,MaterialOutbox outbox){status.queued=status.stored=status.blocked=status.expired=status.reconcile=0;status.stored=outbox.retiredCount();for(Object raw:outbox.all()){Map<String,Object> row=WireJson.map(raw);String state=(String)row.get("state");if(state.equals("server_stored"))status.stored++;else if(state.equals("blocked"))status.blocked++;else if(state.equals("expired"))status.expired++;else{status.queued++;if(Boolean.TRUE.equals(row.get("needs_lookup")))status.reconcile++;}}}
 Status sync()throws Exception{
  admit();MaterialStorage.prepare(root,config);
  if(source instanceof FreshSource||source instanceof DiscoverySource)return syncFresh();
  admit();Status status=new Status();
  try(MaterialOutbox outbox=new MaterialOutbox(files,config.connection);LifelogImportJournal journal=new LifelogImportJournal(files,config.connection,config.account)){
   // A scan failure must not replace or clear already committed queue data.
   OfficialLifelogBatch batch=((Source)source).read();OfficialAccountBinding account=admit();status.conflicts=batch.conflicts;status.unowned=batch.unowned;status.invalid=batch.invalid;
   try{status.added=journal.stage(batch,account,System.currentTimeMillis());}catch(IllegalArgumentException changed){if(!"LIFELOG_SOURCE_REFRESH_REQUIRED".equals(changed.getMessage()))throw changed;status.note="LIFELOG_SOURCE_REFRESH_REQUIRED";status.conflicts++;}
   journal.replay(admit(),outbox::enqueue);
   Set<String> allowed=new HashSet<>();for(OfficialLifelogSnapshot.Source value:batch.sources)allowed.add(value.materialId(config.account));
   allowed.removeAll(heldDeletions(outbox));
   // Do not send an old queued body after observing a changed source. Missing
   // source/cache entries are retained locally, but cannot authorize a send.
   if(status.conflicts==0){
    // Offline discovery commits locally before a network request. A requested
    // retry reconciles blocked events only after fresh identity verification.
    admit();api.preflight(System.currentTimeMillis(),true);outbox.resumeBlocked();
    for(int i=0;i<16;i++){admit();if(!api.pump(outbox,System.currentTimeMillis(),allowed))break;}
   }
   count(status,outbox);if(status.note.equals("ready"))status.note=status.conflicts>0?"LIFELOG_SOURCE_REFRESH_REQUIRED":status.blocked>0?"blocked":status.expired>0?"expired":status.queued>0?"queued":status.stored>0?"server_stored":"no_loaded_sources";
  }return status;
 }
 private Status syncFresh()throws Exception{
  admit();Status status=new Status();
  try(MaterialOutbox outbox=new MaterialOutbox(files,config.connection);LifelogImportJournal bootstrap=new LifelogImportJournal(files,config.connection,config.account);LifelogRevisionJournal revisions=new LifelogRevisionJournal(files,config.connection,config.account)){
   count(status,outbox);int storedBefore=status.stored;
   // Both writer locks remain held throughout discovery, refresh and staging.
   // Replay committed intents before deciding whether this is a new revision.
   revisions.replay(this::admit,outbox);
   admit();outbox.compact();revisions.compact(this::admit,outbox);
   // A legacy rollback may have prepared an obsolete bootstrap revision one.
   // A validated fresh revision-one intent takes precedence, and is replayed
   // above before suppressing that conflict. Preserve both historical files.
   LifelogImportJournal.Queue replayBootstrap=event->{Map<String,Object> body=WireJson.map(MaterialWire.event(event,config.connection.producer).get("body"));if(!revisions.ownsInitial((String)body.get("material_id")))outbox.enqueue(event);};
   bootstrap.replay(admit(),replayBootstrap);
   OfficialRecordingDeletion.Source originalDeletion=source.deletions();
   if(originalDeletion!=null){
    deletionGuard=OfficialDeletionSync.read(config,new OfficialRecordingDeletion.Source(){public OfficialAccountBinding current()throws Exception{return admit();}public String read(String key)throws Exception{admit();String value=originalDeletion.read(key);admit();return value;}});
    deletionGuard.stage(outbox,api,System.currentTimeMillis());
   }
   List<OfficialLifelogSnapshot.Source> freshSources;
   if(source instanceof DiscoverySource){
    // Date discovery authenticates list/full membership itself. It must never
    // bootstrap from old detail logs when an online list is unavailable.
    OfficialLifelogDiscovery.Snapshot fresh=((DiscoverySource)source).discover();
    MaterialWire.require(fresh!=null&&config.account.equals(fresh.account),"OFFICIAL_ACCOUNT_CHANGED");admit();
    freshSources=fresh.sources;status.discovered=fresh.sources.size();status.days=fresh.days;status.recordings=fresh.recordingEntries;status.otherEntries=fresh.otherEntries;
   }else{
   FreshSource freshSource=(FreshSource)source;OfficialLifelogBatch observed=freshSource.read();admit();status.unowned=observed.unowned;status.invalid=observed.invalid;
   OfficialLifelogRefresh.Fresh fresh;
   try{fresh=freshSource.refresh(observed);}catch(IOException unavailable){
    // An unavailable official source never authorizes sending an old body.
    // Preserve new, ownership-checked observations locally for offline recovery.
    Set<String> existing=new HashSet<>();for(Object raw:outbox.all())existing.add((String)WireJson.map(raw).get("material_id"));
    bootstrap.stage(observed,admit(),System.currentTimeMillis(),existing);bootstrap.replay(admit(),replayBootstrap);throw unavailable;
   }
   MaterialWire.require(fresh!=null&&config.account.equals(fresh.account),"OFFICIAL_ACCOUNT_CHANGED");admit();freshSources=fresh.sources;
   }
   if(deletionGuard!=null){deletionGuard.check();freshSources=deletionGuard.filter(freshSources);}
   else{
    // The product no longer follows original-app deletions. A dev91 intent may
    // still exist locally: retain it, never dispatch it or re-upload that ID.
    Set<String> held=heldDeletions(outbox);List<OfficialLifelogSnapshot.Source> retained=new ArrayList<>();
    for(OfficialLifelogSnapshot.Source value:freshSources)if(!held.contains(value.materialId(config.account)))retained.add(value);
    freshSources=retained;if(!held.isEmpty())status.note="deletion_sync_disabled";
   }
   // Correct the known legacy counter defect before freshness equivalence is
   // evaluated: unchanged source text could otherwise hide an invalid counter.
   Set<String> freshIds=new HashSet<>();for(OfficialLifelogSnapshot.Source value:freshSources)freshIds.add(value.materialId(config.account));int repairBudget=0;
   for(Object raw:outbox.all()){Map<String,Object> row=WireJson.map(raw);String eventId=(String)row.get("event_id");if(freshIds.contains(row.get("material_id"))&&outbox.needsTextRevisionRepair(eventId)){
    MaterialWire.require(repairBudget++<16,"MATERIAL_TEXT_REVISION_REPAIR_REQUIRED");admit();api.reconcileOnly(outbox,eventId,System.currentTimeMillis());MaterialWire.require(!outbox.needsTextRevisionRepair(eventId),"MATERIAL_TEXT_REVISION_REPAIR_REQUIRED");
   }}
   Set<String> oversized=new TreeSet<>();
   try{status.added=revisions.stageFresh(freshSources,this::admit,outbox,System.currentTimeMillis(),oversized)+(deletionGuard==null?0:deletionGuard.added);}
   catch(IllegalArgumentException pending){
    if(!"LIFELOG_PENDING_REVISION_CHANGED".equals(pending.getMessage()))throw pending;
    Set<String> currentIds=new HashSet<>();for(OfficialLifelogSnapshot.Source value:freshSources)currentIds.add(value.materialId(config.account));int budget=0;
    for(Object raw:outbox.all()){Map<String,Object> row=WireJson.map(raw);if(currentIds.contains(row.get("material_id"))&&!"server_stored".equals(row.get("state"))&&!"cancelled".equals(row.get("state"))&&budget++<16){admit();api.reconcileOnly(outbox,(String)row.get("event_id"),System.currentTimeMillis());admit();api.cancelPending(outbox,(String)row.get("event_id"),System.currentTimeMillis());}}
    // A stored predecessor permits the next revision. A verified cancellation
    // permits replacement at the same revision; unknown outcomes still stop.
    status.added=revisions.stageFresh(freshSources,this::admit,outbox,System.currentTimeMillis(),oversized)+(deletionGuard==null?0:deletionGuard.added);
   }
   revisions.replay(this::admit,outbox);
   Set<String> allowed=new HashSet<>();for(OfficialLifelogSnapshot.Source value:freshSources)allowed.add(value.materialId(config.account));
   if(deletionGuard!=null)allowed.addAll(deletionGuard.readyMaterials);
   if(!allowed.isEmpty()){
    admit();api.preflight(System.currentTimeMillis(),true);outbox.resumeBlocked();for(int i=0;i<16;i++){admit();if(!api.pump(outbox,System.currentTimeMillis(),allowed))break;}
   }
   status.selectedComplete=oversized.isEmpty();for(Object raw:outbox.all()){Map<String,Object> row=WireJson.map(raw);if(allowed.contains(row.get("material_id"))&&!"server_stored".equals(row.get("state")))status.selectedComplete=false;}
   count(status,outbox);status.progressed=status.stored>storedBefore;status.tooLarge=oversized.size();if(status.note.equals("ready"))status.note=status.blocked>0?"blocked":status.expired>0?"expired":status.queued>0?"queued":status.tooLarge>0?"MATERIAL_EVENT_TOO_LARGE":source instanceof DiscoverySource&&freshSources.isEmpty()?"no_day_sources":status.stored>0?"server_stored":"no_loaded_sources";
  }return status;
 }
}
