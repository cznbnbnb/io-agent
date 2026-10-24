package com.turboio.addon;
import java.io.*;import java.util.*;

/** Read a bounded set of explicitly selected days without relying on opened
 * detail logs. Account and list/full membership are checked before admission.
 * This is not a complete-history or deletion feed. No persistence or uploads. */
final class OfficialLifelogDiscovery {
 interface Login {OfficialAccountBinding current()throws Exception;}
 interface Transport {byte[] list(OfficialLifelogInventory.Request request)throws Exception;byte[] full(String eventId)throws Exception;}
 static final class Snapshot {
  final String account;final List<OfficialLifelogSnapshot.Source> sources;final int requests,days,recordingEntries,otherEntries;
  private Snapshot(String account,List<OfficialLifelogSnapshot.Source> sources,int requests,int days,int recordingEntries,int otherEntries){this.account=account;this.sources=Collections.unmodifiableList(sources);this.requests=requests;this.days=days;this.recordingEntries=recordingEntries;this.otherEntries=otherEntries;}
 }
 private static void require(boolean ok,String code){MaterialWire.require(ok,code);}
 private static void admit(String account,Login login,long deadline)throws Exception{OfficialAccountBinding current=login.current();require(current!=null&&account.equals(current.binding),"OFFICIAL_ACCOUNT_CHANGED");if(Thread.currentThread().isInterrupted())throw new InterruptedIOException("MATERIAL_PAUSED");if(System.nanoTime()>deadline)throw new IOException("OFFICIAL_SOURCE_TIMEOUT");}
 private static long budget(byte[] response,long used){require(response!=null&&response.length<=1048576&&used+response.length<=8388608,"LIFELOG_DISCOVERY_BUDGET");return used+response.length;}
 static Snapshot read(String account,List<OfficialLifelogInventory.Request> days,Login login,Transport transport)throws Exception{
  require(account!=null&&account.matches("[a-f0-9]{64}")&&days!=null&&!days.isEmpty()&&days.size()<=7,"LIFELOG_DISCOVERY_BUDGET");long deadline=System.nanoTime()+90000000000L,bytes=0;admit(account,login,deadline);
  Set<String> unique=new HashSet<>();for(OfficialLifelogInventory.Request day:days)require(day!=null&&day.timezone!=null&&unique.add(day.path),"LIFELOG_DISCOVERY_DAYS_INVALID");
  List<OfficialLifelogInventory.Page> pages=new ArrayList<>();Map<String,Set<String>> events=new TreeMap<>();int requests=0,recordings=0,other=0;
  for(OfficialLifelogInventory.Request day:days){admit(account,login,deadline);byte[] raw=transport.list(day);requests++;bytes=budget(raw,bytes);admit(account,login,deadline);OfficialLifelogInventory.Page page=OfficialLifelogInventory.read(day,raw);pages.add(page);recordings+=page.recordingEntries;other+=page.otherEntries;
   for(Map.Entry<String,Set<String>> event:page.events.entrySet()){Set<String> prior=events.put(event.getKey(),event.getValue());require(prior==null||prior.equals(event.getValue()),"LIFELOG_INVENTORY_CHANGED");}require(events.size()<=16,"LIFELOG_DISCOVERY_BUDGET");
  }
  Map<String,List<OfficialLifelogSnapshot.Source>> found=new TreeMap<>();
  for(Map.Entry<String,Set<String>> event:events.entrySet()){admit(account,login,deadline);byte[] raw=transport.full(event.getKey());requests++;bytes=budget(raw,bytes);admit(account,login,deadline);List<OfficialLifelogSnapshot.Source> sources=OfficialLifelogSnapshot.read(event.getKey(),OfficialLifelogJson.read(raw).canonical);Set<String> actual=new TreeSet<>();
   for(OfficialLifelogSnapshot.Source source:sources){String key=source.sourceType+"/"+source.sourceId;actual.add(key);found.computeIfAbsent(key,k->new ArrayList<>()).add(source);require(found.size()<=256,"LIFELOG_DISCOVERY_BUDGET");}
   require(event.getValue().equals(actual),"LIFELOG_INVENTORY_CHANGED");
  }
  // A disappearing/re-grouped aggregate invalidates this batch, but never asks
  // a downstream caller to remove material already retained locally/server-side.
  for(int i=0;i<days.size();i++){admit(account,login,deadline);byte[] raw=transport.list(days.get(i));requests++;bytes=budget(raw,bytes);admit(account,login,deadline);require(pages.get(i).sameMembership(OfficialLifelogInventory.read(days.get(i),raw)),"LIFELOG_INVENTORY_CHANGED");}
  List<OfficialLifelogSnapshot.Source> merged=new ArrayList<>();for(List<OfficialLifelogSnapshot.Source> fragments:found.values())merged.add(OfficialLifelogSnapshot.fragments(fragments));admit(account,login,deadline);return new Snapshot(account,merged,requests,days.size(),recordings,other);
 }
}
