package com.turboio.addon;
import java.io.*;import java.util.*;

/** Authenticated fresh source admission, independent of Android. Logged full
 * URLs discover aggregate identities only; their old text never wins a refresh.
 * The caller holds the revision journal's writer lock across read and stage. */
final class OfficialLifelogRefresh {
 interface Transport {byte[] fetch(String eventId)throws Exception;void cancel();}
 interface Ownership extends OfficialLifelogBatch.AccountSource {Set<String> references()throws Exception;}
 static final class Fresh {final String account;final List<OfficialLifelogSnapshot.Source> sources;final int requests;private Fresh(String account,List<OfficialLifelogSnapshot.Source> sources,int requests){this.account=account;this.sources=Collections.unmodifiableList(sources);this.requests=requests;}}
 private static void require(boolean ok,String code){MaterialWire.require(ok,code);}
 private static void admit(String expected,Ownership owner)throws Exception{OfficialAccountBinding current=owner.current();require(current!=null&&expected.equals(current.binding),"OFFICIAL_ACCOUNT_CHANGED");if(Thread.currentThread().isInterrupted())throw new InterruptedIOException("MATERIAL_PAUSED");}
 static Fresh read(OfficialLifelogBatch observed,Ownership owner,Transport transport)throws Exception{
  require(observed!=null&&observed.selectedInventoryComplete&&observed.scanConsistent,"LIFELOG_IMPORT_SCAN_INCOMPLETE");admit(observed.account,owner);require(observed.eventReferences.size()<=16,"LIFELOG_REFRESH_BUDGET");Set<String> owned=new HashSet<>(owner.references());admit(observed.account,owner);Map<String,List<OfficialLifelogSnapshot.Source>> found=new TreeMap<>();int requests=0;long bytes=0,deadline=System.nanoTime()+60000000000L;
  for(Map.Entry<String,Set<String>> entry:observed.eventReferences.entrySet()){
   admit(observed.account,owner);if(Collections.disjoint(owned,entry.getValue()))continue;require(entry.getKey().matches("[A-Za-z0-9_-]{1,80}"),"LIFELOG_EVENT_ID_INVALID");if(System.nanoTime()>deadline)throw new IOException("OFFICIAL_SOURCE_TIMEOUT");byte[] response=transport.fetch(entry.getKey());requests++;admit(observed.account,owner);if(System.nanoTime()>deadline)throw new IOException("OFFICIAL_SOURCE_TIMEOUT");require(response!=null&&response.length<=1048576&&(bytes+=response.length)<=8388608,"LIFELOG_REFRESH_BUDGET");
   for(OfficialLifelogSnapshot.Source source:OfficialLifelogSnapshot.read(entry.getKey(),OfficialLifelogJson.read(response).canonical)){
    String key=source.sourceType+"/"+source.sourceId;require(owned.contains(key),"LIFELOG_FRESH_SOURCE_UNOWNED");found.computeIfAbsent(key,k->new ArrayList<>()).add(source);require(found.size()<=256,"LIFELOG_REFRESH_BUDGET");
   }
  }
  admit(observed.account,owner);Set<String> after=owner.references();admit(observed.account,owner);require(after.containsAll(found.keySet()),"LIFELOG_FRESH_SOURCE_UNOWNED");List<OfficialLifelogSnapshot.Source> merged=new ArrayList<>();for(List<OfficialLifelogSnapshot.Source> fragments:found.values())merged.add(OfficialLifelogSnapshot.fragments(fragments));return new Fresh(observed.account,merged,requests);
 }
}
