package com.turboio.addon;

import java.util.Map;

/** One decrypted snapshot of the stock secure store, kept until the store reports a change.
 * Reading the store decrypts every entry; callers used to do that several times a second.
 * Without a change signal for the exact store instance nothing is cached. A bounded age is a
 * second line of defence, not the freshness contract. Callers must not mutate the snapshot. */
final class LoginRecordsCache {
 interface Reader {Map<?,?> read()throws Exception;}
 static final long MAX_AGE_MS=15000;
 private Object source;private Map<?,?> value;private long generation,storedAt;
 /** The watched store changed. Also discards a read that was in flight when it changed. */
 synchronized void changed(){generation++;value=null;}
 /** @param watched the store instance whose changes call changed(), or null when unwatched */
 Map<?,?> get(Object watched,long nowMs,Reader reader)throws Exception{
  long seen;
  synchronized(this){
   if(watched!=null&&watched==source&&value!=null&&nowMs>=storedAt&&nowMs-storedAt<MAX_AGE_MS)return value;
   if(watched!=source){source=null;value=null;}
   seen=generation;
  }
  Map<?,?> fresh=reader.read();
  synchronized(this){
   if(watched!=null&&fresh!=null&&seen==generation){source=watched;value=fresh;storedAt=nowMs;}
   else if(seen==generation){source=null;value=null;}
  }
  return fresh;
 }
}
