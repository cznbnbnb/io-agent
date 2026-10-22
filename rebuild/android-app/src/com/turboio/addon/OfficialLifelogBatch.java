package com.turboio.addon;
import java.io.*;import java.util.*;

/** Account-checked, bounded bootstrap discovery. Logs are observations, not a
 * revision feed: conflicting snapshots require an authoritative refresh. Never
 * choose a winner by file modification time or turn missing entries into deletes. */
final class OfficialLifelogBatch {
 interface AccountSource {OfficialAccountBinding current()throws Exception;}
 final String account;final List<OfficialLifelogSnapshot.Source> sources;
 final Map<String,Set<String>> eventReferences;
 final int conflicts,unowned,invalid,pages;final long bytes;final boolean selectedInventoryComplete,scanConsistent;
 private OfficialLifelogBatch(String account,List<OfficialLifelogSnapshot.Source> sources,Map<String,Set<String>> events,int conflicts,int unowned,int invalid,int pages,long bytes,boolean complete,boolean consistent){this.account=account;this.sources=Collections.unmodifiableList(sources);Map<String,Set<String>> copy=new TreeMap<>();for(Map.Entry<String,Set<String>> entry:events.entrySet())copy.put(entry.getKey(),Collections.unmodifiableSet(new HashSet<>(entry.getValue())));eventReferences=Collections.unmodifiableMap(copy);this.conflicts=conflicts;this.unowned=unowned;this.invalid=invalid;this.pages=pages;this.bytes=bytes;selectedInventoryComplete=complete;scanConsistent=consistent;}
 static OfficialLifelogBatch read(File flutter,AccountSource login)throws Exception{
  OfficialAccountBinding before=login.current();MaterialWire.require(before!=null,"OFFICIAL_LOGIN_REQUIRED");
  Set<String> refs=OfficialHiveCache.sourceReferences(OfficialHiveCache.read(before.cacheFile(flutter)));
  Map<String,OfficialLifelogSnapshot.Source> found=new TreeMap<>();Map<String,Set<String>> events=new TreeMap<>();Set<String> conflicts=new HashSet<>(),unowned=new HashSet<>();int[] invalid={0};long[] size={0};
  OfficialLifelogLogReader.Session session=OfficialLifelogLogReader.open(new File(flutter,"appLog"));int pages=0;long bytes=0;boolean consistent=true;
  do{MaterialWire.require(before.same(login.current()),"OFFICIAL_ACCOUNT_CHANGED");OfficialLifelogLogReader.Summary page=session.next(detail->{
   List<OfficialLifelogSnapshot.Source> parsed;try{parsed=OfficialLifelogSnapshot.read(detail.eventId,detail.json);}catch(IllegalArgumentException malformed){invalid[0]++;return;}
   for(OfficialLifelogSnapshot.Source source:parsed){String key=source.sourceType+"/"+source.sourceId;if(!refs.contains(key)){unowned.add(key);MaterialWire.require(unowned.size()<=10000,"LIFELOG_BATCH_BUDGET");continue;}
    events.computeIfAbsent(detail.eventId,id->new HashSet<>()).add(key);MaterialWire.require(events.size()<=256,"LIFELOG_BATCH_BUDGET");
    OfficialLifelogSnapshot.Source old=found.get(key);if(old==null){size[0]+=source.original().length;MaterialWire.require(found.size()<256&&size[0]<=4194304,"LIFELOG_BATCH_BUDGET");found.put(key,source);}
    else if(!Arrays.equals(old.original(),source.original()))conflicts.add(key);
   }
  });bytes+=page.bytes;consistent&=page.changedFiles==0&&page.invalidUtf8==0&&page.oversizedLines==0;pages++;}while(!session.complete()&&pages<8);
  MaterialWire.require(before.same(login.current()),"OFFICIAL_ACCOUNT_CHANGED");
  // Recheck the live account cache, so records removed during discovery cannot
  // be admitted using a stale ownership snapshot. Cache loss is only omission.
  Set<String> after=OfficialHiveCache.sourceReferences(OfficialHiveCache.read(before.cacheFile(flutter)));
  MaterialWire.require(before.same(login.current()),"OFFICIAL_ACCOUNT_CHANGED");
  List<OfficialLifelogSnapshot.Source> accepted=new ArrayList<>();for(Map.Entry<String,OfficialLifelogSnapshot.Source> row:found.entrySet()){if(!after.contains(row.getKey()))unowned.add(row.getKey());else if(!conflicts.contains(row.getKey()))accepted.add(row.getValue());}
  // Incomplete selected inventory might contain a conflicting observation later.
  if(!session.complete()||!consistent)accepted.clear();
  for(Set<String> values:events.values())values.retainAll(after);events.entrySet().removeIf(entry->entry.getValue().isEmpty());
  return new OfficialLifelogBatch(before.binding,accepted,events,conflicts.size(),unowned.size(),invalid[0],pages,bytes,session.complete(),consistent);
 }
}
