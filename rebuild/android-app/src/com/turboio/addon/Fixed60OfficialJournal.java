package com.turboio.addon;

import java.io.*;
import java.nio.ByteBuffer;
import java.nio.channels.FileChannel;
import java.nio.file.*;
import java.util.*;

/** Separate from native-sender and upstream TAP1 history; all counts are admitted, not confirmed. */
final class Fixed60OfficialJournal implements Fixed60OfficialGate.Store,AutoCloseable {
 private final AtomicDocument document;private final Path history;
 Fixed60OfficialJournal(File file)throws IOException{history=Paths.get(file.getPath()+".history");document=new AtomicDocument(file);}
 public synchronized Map<String,Object> read()throws IOException{
  Object value=document.read();if(value==null)return null;
  try{Map<String,Object> r=BoundedJson.map(value);validate(r);return r;}catch(RuntimeException bad){throw new IOException("OFFICIAL_JOURNAL_INVALID",bad);}
 }
 public synchronized void write(Map<String,Object> record)throws IOException{
  try{validate(record);}catch(RuntimeException bad){throw new IOException("OFFICIAL_JOURNAL_INVALID",bad);}
  Map<String,Object> old=read();
  if(old!=null){
   boolean same=old.get("operation").equals(record.get("operation"));
   if(Boolean.TRUE.equals(old.get("pending"))){
    require(same&&old.get("peer_sha256").equals(record.get("peer_sha256"))&&old.get("started_at_epoch_ms").equals(record.get("started_at_epoch_ms")),"OFFICIAL_PENDING_REPLACEMENT");
    for(String k:Arrays.asList("requests","admitted_messages","admitted_bytes","ap_covered_bytes"))require(((Number)record.get(k)).longValue()>=((Number)old.get(k)).longValue(),"OFFICIAL_HISTORY_DECREASED");
    require(((String)old.get("first_failure")).isEmpty()||old.get("first_failure").equals(record.get("first_failure")),"OFFICIAL_FAILURE_REPLACED");
    require(!Boolean.TRUE.equals(old.get("install_notice"))||Boolean.TRUE.equals(record.get("install_notice")),"OFFICIAL_INSTALL_HISTORY_LOST");
    require(!"START_INTENT".equals(record.get("phase")),"OFFICIAL_START_REUSED");
    if(!Boolean.TRUE.equals(record.get("pending")))require("READBACK".equals(old.get("phase")),"OFFICIAL_RELEASE_WITHOUT_READBACK");
   }else{require(!same&&"START_INTENT".equals(record.get("phase")),"OFFICIAL_OPERATION_REUSED");archive(old);}
  }else require("START_INTENT".equals(record.get("phase")),"OFFICIAL_START_INTENT_MISSING");
  document.save(record);
 }
 private void archive(Map<String,Object> old)throws IOException{
  if(!Files.exists(history,LinkOption.NOFOLLOW_LINKS))Files.createDirectory(history);
  require(Files.isDirectory(history,LinkOption.NOFOLLOW_LINKS),"OFFICIAL_HISTORY_DIRECTORY");
  Path target=history.resolve((String)old.get("operation")+".json");byte[] bytes=BoundedJson.canonical(old);
  if(Files.exists(target,LinkOption.NOFOLLOW_LINKS)){require(Files.isRegularFile(target,LinkOption.NOFOLLOW_LINKS)&&Files.size(target)==bytes.length&&Arrays.equals(Files.readAllBytes(target),bytes),"OFFICIAL_HISTORY_CONFLICT");return;}
  try(FileChannel out=FileChannel.open(target,StandardOpenOption.CREATE_NEW,StandardOpenOption.WRITE,LinkOption.NOFOLLOW_LINKS)){ByteBuffer b=ByteBuffer.wrap(bytes);while(b.hasRemaining())out.write(b);out.force(true);}
 }
 static void validate(Map<String,Object> r){
  BoundedJson.keys(r,"schema","candidate","operation","peer_sha256","pending","phase","first_failure","started_at_epoch_ms","requests","admitted_messages","admitted_bytes","ap_covered_bytes","install_notice","boot_readback");
  if(BoundedJson.number(r.get("schema"),1,1)!=1||!Fixed60Profile.ZIP_SHA.equals(r.get("candidate"))||!BoundedJson.text(r.get("operation"),36).matches("[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}")||!BoundedJson.text(r.get("peer_sha256"),64).matches("[a-f0-9]{64}"))throw new IllegalArgumentException("OFFICIAL_JOURNAL_IDENTITY");
  if(!(r.get("pending") instanceof Boolean)||!(r.get("install_notice") instanceof Boolean)||!(r.get("boot_readback") instanceof Boolean)||!Arrays.asList("START_INTENT","STARTING","VERSION","MANIFEST","TRANSFER","INSTALLING","UNKNOWN","READBACK","RELEASED").contains(r.get("phase"))||!(r.get("first_failure") instanceof String)||!((String)r.get("first_failure")).matches("[A-Z0-9_]{0,128}"))throw new IllegalArgumentException("OFFICIAL_JOURNAL_STATE");
  Object epoch=r.get("started_at_epoch_ms");if(!(epoch instanceof Integer||epoch instanceof Long)||((Number)epoch).longValue()<=0)throw new IllegalArgumentException("OFFICIAL_JOURNAL_TIME");
  BoundedJson.number(r.get("requests"),0,2000);BoundedJson.number(r.get("admitted_messages"),1,12000);int bytes=BoundedJson.number(r.get("admitted_bytes"),0,(Fixed60Profile.EXPANDED_SIZE-2714)*3),ap=BoundedJson.number(r.get("ap_covered_bytes"),0,Fixed60Profile.AP_SIZE);if(ap>bytes)throw new IllegalArgumentException("OFFICIAL_JOURNAL_COUNTS");
  if(!Boolean.TRUE.equals(r.get("pending"))&&(!"RELEASED".equals(r.get("phase"))||!Boolean.TRUE.equals(r.get("boot_readback"))))throw new IllegalArgumentException("OFFICIAL_JOURNAL_RELEASE");
 }
 private static void require(boolean ok,String why)throws IOException{if(!ok)throw new IOException(why);}
 public void close()throws IOException{document.close();}
}
