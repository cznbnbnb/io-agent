package com.turboio.addon;

import java.io.*;import java.util.*;import java.util.function.LongSupplier;

/** One bounded background round on the material owner's serial IO executor.
 * Queued payloads can progress while source discovery is unavailable. */
final class AudioSyncSession {
 interface Sources {Catalog read(String account)throws Exception;}
 static final class Catalog {
  final String account;final List<Object> sessions,archives;
  Catalog(String account,List<Object> sessions,List<Object> archives)throws IOException{AudioUploadWire.check(account!=null&&account.matches("[a-f0-9]{64}")&&sessions!=null&&archives!=null&&sessions.size()<=256&&archives.size()<=256,"AUDIO_CATALOG_INVALID");this.account=account;this.sessions=WireJson.list(WireJson.copy(sessions));this.archives=WireJson.list(WireJson.copy(archives));}
 }
 static final class Status {
  final List<Object> rows;final String error;final int prepared,pumped;final boolean attempted;final long retained,queued,blocked,expired;
  Status(List<Object> rows,String error,int prepared,int pumped,boolean attempted){this.rows=WireJson.list(WireJson.copy(rows));this.error=error;this.prepared=prepared;this.pumped=pumped;this.attempted=attempted;long r=0,q=0,b=0,e=0;for(Object v:rows){Map<String,Object> row=WireJson.map(v);if(Boolean.TRUE.equals(row.get("remote_retained")))r++;else if(Arrays.asList("queued","preparing","sending","retry_wait").contains(row.get("state")))q++;else if("expired".equals(row.get("state")))e++;else if(Arrays.asList("blocked","withdrawn").contains(row.get("state")))b++;}retained=r;queued=q;blocked=b;expired=e;}
 }
 private final File files,textFiles;private final MaterialConfig text;private final AudioConfig audio;private final Sources source;private final AudioUploadOutbox.Guard guard;private final MaterialApi.Transport http;private final LongSupplier clock;
 AudioSyncSession(File files,File textFiles,MaterialConfig text,AudioConfig audio,Sources source,AudioUploadOutbox.Guard guard,MaterialApi.Transport http,LongSupplier clock){this.files=files;this.textFiles=textFiles;this.text=text;this.audio=audio;this.source=source;this.guard=guard;this.http=http;this.clock=clock;}
 static String origin(Map<String,Object> archive)throws IOException{Map<String,Object> c=WireJson.map(archive.get("context"));AudioUploadWire.keys(c,"account","peer","generation","clock_epoch");return TaskWire.hash(WireJson.bytes(WireJson.object("context",c,"stream",archive.get("stream"),"first_sequence",archive.get("first_sequence"),"count",archive.get("count"))));}
 private static String code(Exception e){while(e.getCause() instanceof Exception)e=(Exception)e.getCause();String s=e.getMessage();return s!=null&&s.matches("[A-Z_]{3,80}")?s:"AUDIO_SYNC_UNAVAILABLE";}
 private static Set<String> eligible(MaterialOutbox outbox){Map<String,Map<String,Object>> latest=new HashMap<>();for(Object raw:outbox.all()){Map<String,Object> r=WireJson.map(raw);String id=(String)r.get("material_id");Map<String,Object> prior=latest.get(id);if(prior==null||MaterialWire.positive(r.get("revision"))>MaterialWire.positive(prior.get("revision")))latest.put(id,r);}Set<String> ids=new HashSet<>();for(Map.Entry<String,Map<String,Object>> item:latest.entrySet()){Map<String,Object> r=item.getValue();if(!"server_stored".equals(r.get("state")))continue;Map<String,Object> event=WireJson.map(MaterialWire.read(((String)r.get("payload")).getBytes(java.nio.charset.StandardCharsets.UTF_8))),body=WireJson.map(event.get("body"));if("upsert".equals(body.get("operation"))&&"lifelog".equals(body.get("source")))ids.add(item.getKey());}return ids;}
 Status run(boolean networkRecovered,int prepareLimit,int pumpLimit)throws Exception{return run(networkRecovered,prepareLimit,pumpLimit,false);}
 Status run(boolean networkRecovered,int prepareLimit,int pumpLimit,boolean force)throws Exception{
  guard.check();AudioUploadWire.check(prepareLimit>=1&&prepareLimit<=8&&pumpLimit>=1&&pumpLimit<=32,"AUDIO_SYNC_LIMIT");AudioUploadWire.check(text!=null&&audio!=null&&text.enabled&&audio.enabled,"AUDIO_PAUSED");AudioUploadWire.check(text.account.equals(audio.account)&&text.connection.binding().equals(audio.connection.binding()),"AUDIO_SOURCE_TARGET_CHANGED");AudioUploadWire.check(audio.connection.expiresAt>clock.getAsLong(),"AUDIO_CREDENTIAL_EXPIRED");
  try(AudioAutoSchedule schedule=new AudioAutoSchedule(files,audio,guard);AudioUploadOutbox queue=new AudioUploadOutbox(files,audio.connection,audio.account,guard);MaterialOutbox stored=new MaterialOutbox(textFiles,text.connection)){
   if(!schedule.begin(clock.getAsLong(),networkRecovered,force))return new Status(queue.snapshot(clock.getAsLong()),"",0,0,false);
   int prepared=0,pumped=0,calls=0;String error="";Set<String> allowed=eligible(stored);
   try{
    queue.resumeAuthorized(http,clock);while(calls<pumpLimit){guard.check();calls++;try{if(!queue.pump(http,clock,allowed))break;pumped++;}catch(Exception failed){guard.check();error=code(failed);}}
    try{
     Catalog catalog=source.read(audio.account);guard.check();AudioUploadWire.check(audio.account.equals(catalog.account),"OFFICIAL_ACCOUNT_CHANGED");Map<String,Map<String,Object>> sessions=new HashMap<>();for(Object raw:catalog.sessions){Map<String,Object> row=WireJson.map(raw);String epoch=(String)row.get("clock_epoch");AudioUploadWire.check(epoch!=null&&!sessions.containsKey(epoch),"AUDIO_CATALOG_INVALID");sessions.put(epoch,row);}
     SortedMap<String,Map<String,Object>> candidates=new TreeMap<>();for(Object raw:catalog.archives){Map<String,Object> row=WireJson.map(raw),context=WireJson.map(row.get("context"));if(!audio.account.equals(context.get("account"))||!"sealed".equals(row.get("phase"))||AudioUploadWire.number(row.get("count"))==0)continue;Map<String,Object> session=sessions.get(context.get("clock_epoch"));if(session==null||!Boolean.TRUE.equals(session.get("source_link_verified")))continue;AudioUploadWire.check(candidates.put(origin(row),row)==null,"AUDIO_CATALOG_INVALID");}
     Set<String> known=new HashSet<>();for(Object raw:queue.snapshot(clock.getAsLong())){Object key=WireJson.map(raw).get("origin");if(key instanceof String&&!((String)key).isEmpty())known.add((String)key);}List<String> order=new ArrayList<>();for(String key:candidates.keySet())if(key.compareTo(schedule.cursor())>0)order.add(key);for(String key:candidates.keySet())if(key.compareTo(schedule.cursor())<=0)order.add(key);
     int attempts=0;for(String key:order){if(known.contains(key))continue;if(attempts++>=prepareLimit)break;guard.check();schedule.advance(key);Map<String,Object> archive=candidates.get(key),session=sessions.get(WireJson.map(archive.get("context")).get("clock_epoch"));String material=(String)session.get("material_id");try{AudioUploadWire.check(allowed.contains(material),"AUDIO_SOURCE_TEXT_NOT_STORED");LifelogAudioPayloads.TextSource proof=LifelogAudioPayloads.TextSource.stored(stored,text.connection,audio.connection,material);try(LifelogAudioPayloads payloads=new LifelogAudioPayloads(files,audio.account,guard::check)){LifelogAudioPayloads.Prepared part=payloads.prepare(proof,session,archive);queue.enqueue(part.file,part.manifest(),part.bodyHash,key);}known.add(key);prepared++;}catch(LifelogAudioPayloads.NoAudio controlOnly){guard.check();/* Valid control-only journal stays local; no fake audio job or failure. */}catch(Exception failed){guard.check();error=code(failed);}}
    }catch(Exception unavailable){guard.check();error=code(unavailable);}
    while(calls<pumpLimit){guard.check();calls++;try{if(!queue.pump(http,clock,allowed))break;pumped++;}catch(Exception failed){guard.check();error=code(failed);}}
   }catch(Exception failed){guard.check();error=code(failed);}
   guard.check();schedule.finish(clock.getAsLong(),prepared>0||pumped>0,error);return new Status(queue.snapshot(clock.getAsLong()),error,prepared,pumped,true);
  }
 }
}
