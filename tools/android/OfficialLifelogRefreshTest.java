package com.turboio.addon;
import java.io.*;import java.nio.file.*;import java.util.*;

/** Synthetic transport responses only; never contacts the official service. */
public final class OfficialLifelogRefreshTest {
 static int checks;static void yes(boolean value){checks++;if(!value)throw new AssertionError("Refresh "+checks);}interface Work{void run()throws Exception;}
 static void reject(String code,Work work)throws Exception{checks++;try{work.run();}catch(IllegalArgumentException|IOException e){if(code==null||code.equals(e.getMessage()))return;throw e;}throw new AssertionError("Expected "+code);}
 static final class Owner implements OfficialLifelogRefresh.Ownership {
  OfficialAccountBinding account=LifelogImportJournalTest.account(42);Set<String> refs=new HashSet<>(Arrays.asList("CONVERSATION/"+OfficialLifelogSnapshotTest.SOURCE));
  public OfficialAccountBinding current(){return account;}public Set<String> references(){return new HashSet<>(refs);}
 }
 static final class Transport implements OfficialLifelogRefresh.Transport {
  int calls;byte[] body;Runnable during=()->{};boolean fail;
  Transport(Map<String,Object> f){body=WireJson.bytes(f);}public byte[] fetch(String id)throws IOException{calls++;during.run();if(fail)throw new IOException("OFFICIAL_SOURCE_UNAVAILABLE");return body;}public void cancel(){}
 }
 public static void main(String[] args)throws Exception{
  File root=new File(args[0]),flutter=new File(root,"flutter"),logs=new File(flutter,"appLog");yes(logs.mkdirs());Owner owner=new Owner();Path log=new File(logs,"synthetic.log").toPath();
  Files.write(owner.account.cacheFile(flutter).toPath(),OfficialHiveCacheTest.frame(OfficialHiveCacheTest.URL,OfficialHiveCacheTest.cached(true),false));
  Map<String,Object> old=OfficialLifelogSnapshotTest.fixture(),changed=OfficialLifelogSnapshotTest.fixture();OfficialLifelogSnapshotTest.firstClip(changed).put("content","合成的新正文；旧日志不能覆盖。");
  Files.write(log,LifelogImportJournalTest.bytes(LifelogImportJournalTest.log(old)+LifelogImportJournalTest.log(changed)));
  OfficialLifelogBatch observed=OfficialLifelogBatch.read(flutter,owner);yes(observed.conflicts==1&&observed.sources.isEmpty()&&observed.eventReferences.size()==1);
  Transport http=new Transport(changed);OfficialLifelogRefresh.Fresh fresh=OfficialLifelogRefresh.read(observed,owner,http);yes(http.calls==1&&fresh.requests==1&&fresh.sources.size()==1);yes(Arrays.equals(fresh.sources.get(0).original(),OfficialLifelogSnapshotTest.read(changed).original()));
  // Freshness admission feeds the durable journal, whose replay survives a
  // process boundary without consulting older log contents again.
  long now=System.currentTimeMillis();MaterialConnection c=LifelogImportJournalTest.connection(now);File journalRoot=new File(root,"journal");
  try(LifelogRevisionJournal j=new LifelogRevisionJournal(journalRoot,c,owner.account.binding);MaterialOutbox q=new MaterialOutbox(journalRoot,c)){yes(j.stageFresh(fresh.sources,owner::current,q,now)==1);yes(q.all().isEmpty());}
  try(LifelogRevisionJournal j=new LifelogRevisionJournal(journalRoot,c,owner.account.binding);MaterialOutbox q=new MaterialOutbox(journalRoot,c)){yes(j.replay(owner::current,q)==1&&q.all().size()==1);}
  Transport outage=new Transport(old);outage.fail=true;reject("OFFICIAL_SOURCE_UNAVAILABLE",()->OfficialLifelogRefresh.read(observed,owner,outage));yes(outage.calls==1);
  Transport wrong=new Transport(old);wrong.during=()->owner.account=LifelogImportJournalTest.account(43);reject("OFFICIAL_ACCOUNT_CHANGED",()->OfficialLifelogRefresh.read(observed,owner,wrong));owner.account=LifelogImportJournalTest.account(42);
  Transport removed=new Transport(old);removed.during=owner.refs::clear;reject("LIFELOG_FRESH_SOURCE_UNOWNED",()->OfficialLifelogRefresh.read(observed,owner,removed));
  Transport noOwner=new Transport(old);OfficialLifelogRefresh.Fresh none=OfficialLifelogRefresh.read(observed,owner,noOwner);yes(none.sources.isEmpty()&&noOwner.calls==0);owner.refs.add("CONVERSATION/"+OfficialLifelogSnapshotTest.SOURCE);
  Map<String,Object> bad=OfficialLifelogSnapshotTest.fixture();bad.put("code",1008001);Transport error=new Transport(bad);reject(null,()->OfficialLifelogRefresh.read(observed,owner,error));yes(error.calls==1);
  Map<String,Object> empty=OfficialLifelogSnapshotTest.fixture();OfficialLifelogSnapshotTest.event(empty).put("originalList",Collections.emptyList());OfficialLifelogSnapshotTest.event(empty).put("transcriptionContents",Collections.emptyList());
  OfficialLifelogRefresh.Fresh absent=OfficialLifelogRefresh.read(observed,owner,new Transport(empty));yes(absent.sources.isEmpty());
  try(LifelogRevisionJournal j=new LifelogRevisionJournal(journalRoot,c,owner.account.binding);MaterialOutbox q=new MaterialOutbox(journalRoot,c)){yes(j.stageFresh(absent.sources,owner::current,q,now+1)==0&&q.all().size()==1);yes(WireJson.map(WireJson.map(WireJson.read(((String)WireJson.map(q.all().get(0)).get("payload")).getBytes(java.nio.charset.StandardCharsets.UTF_8))).get("body")).get("operation").equals("upsert"));}
  Map<String,Object> unrelated=OfficialLifelogSnapshotTest.fixture();OfficialLifelogSnapshotTest.event(unrelated).put("id","other");reject(null,()->OfficialLifelogRefresh.read(observed,owner,new Transport(unrelated)));
  Transport huge=new Transport(old);huge.body=new byte[4194305];reject("LIFELOG_REFRESH_BUDGET",()->OfficialLifelogRefresh.read(observed,owner,huge));
  // Damaged discovery inventory never issues a request using partial evidence.
  Files.write(log,OfficialHiveCacheTest.concat(LifelogImportJournalTest.bytes(LifelogImportJournalTest.log(old)),new byte[]{(byte)255,10}));OfficialLifelogBatch damaged=OfficialLifelogBatch.read(flutter,owner);Transport unused=new Transport(old);reject("LIFELOG_IMPORT_SCAN_INCOMPLETE",()->OfficialLifelogRefresh.read(damaged,owner,unused));yes(unused.calls==0);
  OfficialLifelogDiscoveryTest.Segments segments=new OfficialLifelogDiscoveryTest.Segments();StringBuilder splitLogs=new StringBuilder();for(Map<String,Object> detail:segments.details.values())splitLogs.append(LifelogImportJournalTest.log(detail).replace("/events/"+OfficialLifelogSnapshotTest.EVENT+"/", "/events/"+OfficialLifelogSnapshotTest.event(detail).get("id")+"/"));Files.write(log,LifelogImportJournalTest.bytes(splitLogs.toString()));
  OfficialLifelogBatch split=OfficialLifelogBatch.read(flutter,owner);yes(split.conflicts==1&&split.eventReferences.size()==3);
  OfficialLifelogRefresh.Transport splitTransport=new OfficialLifelogRefresh.Transport(){public byte[] fetch(String id){return WireJson.bytes(segments.details.get(id));}public void cancel(){}};
  OfficialLifelogRefresh.Fresh combined=OfficialLifelogRefresh.read(split,owner,splitTransport);yes(combined.sources.size()==1&&combined.sources.get(0).clips.size()==9&&combined.requests==3);
  OfficialLifelogSnapshotTest.source(segments.details.get("fragment-a")).put("title","conflicting metadata");reject("LIFELOG_FRESH_SOURCE_CONFLICT",()->OfficialLifelogRefresh.read(split,owner,splitTransport));
  System.out.println("Official lifelog refresh: "+checks+" assertions passed");
 }
}
