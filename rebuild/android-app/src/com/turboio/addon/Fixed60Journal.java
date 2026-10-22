package com.turboio.addon;

import java.io.*;
import java.nio.ByteBuffer;
import java.nio.channels.FileChannel;
import java.nio.file.*;
import java.util.*;

/** Separate namespace from upstream TAP1. Corrupt or foreign history blocks preparation. */
final class Fixed60Journal implements Fixed60Session.Store,AutoCloseable {
 private final AtomicDocument document;
 private final Path history;
 Fixed60Journal(File file)throws IOException{history=Paths.get(file.getPath()+".history");document=new AtomicDocument(file);}
 public Map<String,Object> read()throws IOException{
  Object value=document.read();if(value==null)return null;
  try{Map<String,Object> record=BoundedJson.map(value);validate(record);return record;}
  catch(RuntimeException error){throw new IOException("FIXED60_JOURNAL_INVALID",error);}
 }
 public void write(Map<String,Object> record)throws IOException{
  try{validate(record);}catch(RuntimeException error){throw new IOException("FIXED60_JOURNAL_INVALID",error);}
  Map<String,Object> old=read();
  if(old!=null){
   boolean same=old.get("operation").equals(record.get("operation"));
   if(Boolean.TRUE.equals(old.get("pending"))){
    if(!same||!old.get("peer_sha256").equals(record.get("peer_sha256"))||!old.get("started_at_epoch_ms").equals(record.get("started_at_epoch_ms")))throw new IOException("FIXED60_PENDING_REPLACEMENT");
    for(String key:Arrays.asList("requests","confirmed_messages","confirmed_bytes","covered_bytes","ap_covered_bytes"))if(((Number)record.get(key)).longValue()<((Number)old.get(key)).longValue())throw new IOException("FIXED60_HISTORY_DECREASED");
    if(!((String)old.get("first_failure")).isEmpty()&&!old.get("first_failure").equals(record.get("first_failure")))throw new IOException("FIXED60_FAILURE_REPLACED");
    if(Boolean.TRUE.equals(old.get("install_notice"))&&!Boolean.TRUE.equals(record.get("install_notice")))throw new IOException("FIXED60_INSTALL_HISTORY_LOST");
    if(!Boolean.TRUE.equals(record.get("pending"))&&!"READBACK".equals(old.get("phase")))throw new IOException("FIXED60_RELEASE_WITHOUT_READBACK");
   }else{
    if(same||!"START_INTENT".equals(record.get("phase")))throw new IOException("FIXED60_RELEASED_OPERATION_REUSED");
    archive(old); // Preserve the small completed-operation record before a new intent replaces it.
   }
  }
  document.save(record);
 }
 private void archive(Map<String,Object> old)throws IOException{
  if(!Files.exists(history,LinkOption.NOFOLLOW_LINKS))Files.createDirectory(history);
  if(!Files.isDirectory(history,LinkOption.NOFOLLOW_LINKS))throw new IOException("FIXED60_HISTORY_DIRECTORY");
  Path file=history.resolve((String)old.get("operation")+".json");byte[] bytes=BoundedJson.canonical(old);
  if(Files.exists(file,LinkOption.NOFOLLOW_LINKS)){
   if(!Files.isRegularFile(file,LinkOption.NOFOLLOW_LINKS)||Files.size(file)!=bytes.length||!Arrays.equals(Files.readAllBytes(file),bytes))throw new IOException("FIXED60_HISTORY_CONFLICT");
   return;
  }
  try(FileChannel channel=FileChannel.open(file,StandardOpenOption.CREATE_NEW,StandardOpenOption.WRITE,LinkOption.NOFOLLOW_LINKS)){
   ByteBuffer buffer=ByteBuffer.wrap(bytes);while(buffer.hasRemaining())channel.write(buffer);channel.force(true);
  }
 }
 static void validate(Map<String,Object> r){
  BoundedJson.keys(r,"schema","candidate","operation","peer_sha256","pending","phase","reason","first_failure","started_at_epoch_ms","requests","confirmed_messages","confirmed_bytes","covered_bytes","ap_covered_bytes","install_notice","boot_readback");
  require(BoundedJson.number(r.get("schema"),1,1)==1&&Fixed60Profile.ZIP_SHA.equals(r.get("candidate")));
  require(BoundedJson.text(r.get("operation"),36).matches("[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}"));
  require(BoundedJson.text(r.get("peer_sha256"),64).matches("[a-f0-9]{64}"));
  require(r.get("pending") instanceof Boolean&&r.get("install_notice") instanceof Boolean&&r.get("boot_readback") instanceof Boolean);
  require(Arrays.asList("START_INTENT","STARTING","VERSION","MANIFEST","TRANSFER","INSTALLING","UNKNOWN","READ_VERSION","READ_IDLE","READBACK","RELEASED").contains(r.get("phase")));
  require(r.get("reason") instanceof String&&((String)r.get("reason")).matches("[A-Z0-9_]{0,128}"));
  require(r.get("first_failure") instanceof String&&((String)r.get("first_failure")).matches("[A-Z0-9_]{0,128}"));
  Object epoch=r.get("started_at_epoch_ms");require((epoch instanceof Long||epoch instanceof Integer)&&((Number)epoch).longValue()>0);
  BoundedJson.number(r.get("requests"),0,2000);BoundedJson.number(r.get("confirmed_messages"),0,12000);
  int sent=BoundedJson.number(r.get("confirmed_bytes"),0,Fixed60Profile.EXPANDED_SIZE*3);
  int covered=BoundedJson.number(r.get("covered_bytes"),0,Fixed60Profile.EXPANDED_SIZE-2714);
  int ap=BoundedJson.number(r.get("ap_covered_bytes"),0,Fixed60Profile.AP_SIZE);
  require(ap<=covered&&covered<=sent);
  if(!Boolean.TRUE.equals(r.get("pending")))require("RELEASED".equals(r.get("phase"))&&Boolean.TRUE.equals(r.get("boot_readback")));
 }
 private static void require(boolean ok){if(!ok)throw new IllegalArgumentException("FIXED60_JOURNAL_FIELDS");}
 public void close()throws IOException{document.close();}
}
