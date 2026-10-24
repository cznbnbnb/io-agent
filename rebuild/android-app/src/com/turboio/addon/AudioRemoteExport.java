package com.turboio.addon;

import java.io.*;import java.nio.file.*;import java.util.*;import java.util.function.LongSupplier;

/** Explicit bounded restore/export. Never imports remote bytes into originals,
 * enables backup, changes a grant, or silently drops an unsupported live source. */
final class AudioRemoteExport {
 private static final int MAX_OBJECTS=128,PROOF_MAX=262144;
 private static void check(boolean value,String code)throws IOException{AudioUploadWire.check(value,code);}
 private static File proof(File cache,LifelogAudioExport.Draft draft)throws IOException{File root=cache.getCanonicalFile(),directory=new File(root,"lifelog-audio-exports/"+draft.id),file=new File(directory,"remote.json");check(!Files.isSymbolicLink(cache.toPath())&&directory.getAbsoluteFile().equals(directory.getCanonicalFile())&&draft.file.getCanonicalFile().equals(new File(directory,"audio.zip"))&&!Files.isSymbolicLink(file.toPath()),"AUDIO_REMOTE_PATH");check(!file.exists()||file.isFile()&&file.length()<=PROOF_MAX,"AUDIO_REMOTE_PATH");return file;}
 private static void retained(AudioConfig config,LifelogAudioArchive.Guard guard,LongSupplier clock)throws IOException{guard.check();check(config.connection.expiresAt>clock.getAsLong(),"AUDIO_CREDENTIAL_EXPIRED");}
 static LifelogAudioExport.Draft prepare(File cache,AudioConfig config,String material,List<LifelogAudioSource> local,MaterialApi.Transport transport,LifelogAudioExport.Decoders decoders,LifelogAudioArchive.Guard guard,LongSupplier clock)throws IOException{
  retained(config,guard,clock);check(local!=null&&local.size()<=256,"AUDIO_EXPORT_CONTEXT");List<Map<String,Object>> receipts=new ArrayList<>();String after=null;int listed=0;long bytes=0;
  do{AudioDownloads.Page page=AudioDownloads.list(config.connection,material,after,transport,guard,clock);listed+=page.objects.size();check(listed<=MAX_OBJECTS,"AUDIO_REMOTE_BUDGET");for(Object raw:page.objects){Map<String,Object> r=WireJson.map(raw);if("expired".equals(r.get("state")))continue;check("raw".equals(r.get("kind")),"AUDIO_EXPORT_FORMAT_UNSUPPORTED");bytes+=AudioUploadWire.number(r.get("bytes"));check(bytes<=AudioUploadWire.MAX,"AUDIO_REMOTE_BUDGET");receipts.add(r);}after=page.next;}while(after!=null);
  check(!receipts.isEmpty(),"AUDIO_REMOTE_EMPTY");List<LifelogAudioSource> sources=new ArrayList<>(local);LifelogAudioExport.Draft draft=null;boolean success=false;
  try(AudioDownloads downloads=new AudioDownloads(cache,config,guard)){
   for(Map<String,Object> receipt:receipts){AudioDownloads.Download ready=null;for(int step=0;step<128;step++){retained(config,guard,clock);try{ready=downloads.fetch(receipt,transport,clock,32);}catch(IOException stale){if(!"AUDIO_DOWNLOAD_CACHE_EXPIRED".equals(stale.getMessage()))throw stale;downloads.remove((String)receipt.get("object_id"));ready=downloads.fetch(receipt,transport,clock,32);}if(ready.complete)break;}check(ready!=null&&ready.complete,"AUDIO_REMOTE_BUDGET");sources.add(LifelogAudioRemoteSource.open(cache,config,material,ready,guard,clock));}
   draft=LifelogAudioExport.prepareSources(cache,config.account,material,sources,decoders,guard,clock.getAsLong());Map<String,Object> state=WireJson.object("schema",1,"account",config.account,"material_id",material,"fingerprint",config.fingerprint(),"receipts",receipts);check(WireJson.bytes(state).length<=PROOF_MAX,"AUDIO_REMOTE_BUDGET");try(AtomicDocument document=new AtomicDocument(proof(cache,draft),PROOF_MAX)){retained(config,guard,clock);document.save(state);}verify(cache,draft,config,transport,guard,clock);
   for(Map<String,Object> receipt:receipts)downloads.remove((String)receipt.get("object_id"));retained(config,guard,clock);success=true;return draft;
  }finally{if(!success&&draft!=null)LifelogAudioExport.remove(cache,draft.id);}
 }
 /** Recheck live scope, target and fixed server receipts before opening the
  * picker and again before copying to a user-chosen destination after resume. */
 static void verify(File cache,LifelogAudioExport.Draft draft,AudioConfig config,MaterialApi.Transport transport,LifelogAudioArchive.Guard guard,LongSupplier clock)throws IOException{
  retained(config,guard,clock);File file=proof(cache,draft);check(file.isFile()&&!new File(file.getPath()+".partial").exists(),"AUDIO_REMOTE_DRAFT");Map<String,Object> state;try{state=WireJson.map(WireJson.read(Files.readAllBytes(file.toPath()),PROOF_MAX,20000));AudioUploadWire.keys(state,"schema","account","material_id","fingerprint","receipts");check(AudioUploadWire.number(state.get("schema"))==1&&draft.account.equals(config.account)&&config.account.equals(state.get("account"))&&config.fingerprint().equals(state.get("fingerprint")),"AUDIO_CONNECTION_CHANGED");List<Object> receipts=WireJson.list(state.get("receipts"));check(!receipts.isEmpty()&&receipts.size()<=MAX_OBJECTS,"AUDIO_REMOTE_DRAFT");Set<String> seen=new HashSet<>();for(Object raw:receipts){retained(config,guard,clock);Map<String,Object> receipt=AudioDownloadWire.receipt(raw,config.connection,(String)state.get("material_id"),clock.getAsLong(),true);check("raw".equals(receipt.get("kind"))&&seen.add((String)receipt.get("object_id")),"AUDIO_REMOTE_DRAFT");AudioDownloads.recheck(config.connection,receipt,transport,guard,clock);}}catch(IllegalArgumentException|ClassCastException invalid){throw new IOException("AUDIO_REMOTE_DRAFT");}retained(config,guard,clock);
 }
}
