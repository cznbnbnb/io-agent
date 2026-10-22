package com.turboio.addon;
import java.io.*;import java.util.*;
public final class OfficialLifelogDiscoveryTest {
 static int checks;static void yes(boolean ok){checks++;if(!ok)throw new AssertionError("Discovery "+checks);}
 interface Work{void run()throws Exception;}static void reject(String code,Work work)throws Exception{checks++;try{work.run();}catch(IOException|IllegalArgumentException e){if(code.equals(e.getMessage()))return;throw e;}throw new AssertionError("Expected "+code);}
 static final OfficialAccountBinding ACCOUNT=LifelogImportJournalTest.account(47);
 static final OfficialLifelogInventory.Request DAY=OfficialLifelogInventory.Request.day("2026-10-21","Asia/Shanghai");
 static Map<String,Object> list(){Map<String,Object> root=OfficialLifelogInventoryTest.fixture(),data=OfficialLifelogInventoryTest.data(root);Map<String,Object> event=OfficialLifelogInventoryTest.event(OfficialLifelogSnapshotTest.EVENT,"event");event.put("transcriptionInfos",Arrays.asList(WireJson.object("sourceType","CONVERSATION","sourceId",OfficialLifelogSnapshotTest.SOURCE)));data.put("events",new ArrayList<>(Arrays.asList(event,OfficialLifelogInventoryTest.event("recording","recording"))));return root;}
 static class Wire implements OfficialLifelogDiscovery.Transport,OfficialLifelogDiscovery.Login {
  Map<String,Object> listing=OfficialLifelogDiscoveryTest.list(),detail=OfficialLifelogSnapshotTest.fixture();int lists,fulls;boolean switchAccount,changedAfterFull,failList,failFull,titleOnly,conflictingSecond;
  public OfficialAccountBinding current(){return switchAccount&&lists>0?LifelogImportJournalTest.account(48):ACCOUNT;}
  public byte[] list(OfficialLifelogInventory.Request request)throws Exception{lists++;if(failList)throw new IOException("SYNTHETIC_OFFLINE");Map<String,Object> response=WireJson.map(WireJson.copy(listing));OfficialLifelogInventoryTest.data(response).put("date",request.date);if(changedAfterFull&&fulls>0)OfficialLifelogInventoryTest.data(response).put("events",new ArrayList<>());if(titleOnly&&fulls>0)WireJson.map(WireJson.list(OfficialLifelogInventoryTest.data(response).get("events")).get(0)).put("title","合成新标题");if(conflictingSecond&&lists==2)WireJson.map(WireJson.list(WireJson.map(WireJson.list(OfficialLifelogInventoryTest.data(response).get("events")).get(0)).get("transcriptionInfos")).get(0)).put("sourceId","changed");return WireJson.bytes(response);}
  public byte[] full(String id)throws Exception{fulls++;if(failFull)throw new IOException("SYNTHETIC_FULL_UNAVAILABLE");return WireJson.bytes(detail);}
 }
 static OfficialLifelogDiscovery.Snapshot read(Wire w)throws Exception{return OfficialLifelogDiscovery.read(ACCOUNT.binding,Collections.singletonList(DAY),w,w);}
 public static void main(String[] args)throws Exception{
  Wire ok=new Wire();OfficialLifelogDiscovery.Snapshot snapshot=read(ok);yes(snapshot.sources.size()==1&&snapshot.sources.get(0).clips.size()==3);yes(snapshot.requests==3&&ok.lists==2&&ok.fulls==1);yes(snapshot.recordingEntries==1&&snapshot.otherEntries==0);yes(snapshot.account.equals(ACCOUNT.binding));
  Wire empty=new Wire();OfficialLifelogInventoryTest.data(empty.listing).put("events",new ArrayList<>());yes(read(empty).sources.isEmpty()&&empty.fulls==0&&empty.lists==2);
  Wire recordingOnly=new Wire();OfficialLifelogInventoryTest.data(recordingOnly.listing).put("events",Arrays.asList(OfficialLifelogInventoryTest.event("recording","recording")));yes(read(recordingOnly).recordingEntries==1&&recordingOnly.fulls==0);
  Wire changed=new Wire();changed.changedAfterFull=true;reject("LIFELOG_INVENTORY_CHANGED",()->read(changed));yes(changed.fulls==1&&changed.lists==2);
  Wire account=new Wire();account.switchAccount=true;reject("OFFICIAL_ACCOUNT_CHANGED",()->read(account));yes(account.fulls==0);
  Wire offline=new Wire();offline.failList=true;reject("SYNTHETIC_OFFLINE",()->read(offline));yes(offline.fulls==0);
  Wire noFull=new Wire();noFull.failFull=true;reject("SYNTHETIC_FULL_UNAVAILABLE",()->read(noFull));yes(noFull.lists==1);
  Wire missing=new Wire();WireJson.map(missing.detail.get("data")).put("transcriptionContents",new ArrayList<>());reject("LIFELOG_INVENTORY_CHANGED",()->read(missing));
  Wire wrong=new Wire();WireJson.map(wrong.detail.get("data")).put("id","wrong");reject("LIFELOG_EVENT_MISMATCH",()->read(wrong));
  Wire titles=new Wire();titles.titleOnly=true;yes(read(titles).sources.size()==1);
  Wire duplicate=new Wire();OfficialLifelogDiscovery.Snapshot merged=OfficialLifelogDiscovery.read(ACCOUNT.binding,Arrays.asList(DAY,OfficialLifelogInventory.Request.day("2026-10-20","Asia/Shanghai")),duplicate,duplicate);yes(merged.sources.size()==1&&duplicate.fulls==1&&duplicate.lists==4);
  Wire crossDay=new Wire();crossDay.conflictingSecond=true;reject("LIFELOG_INVENTORY_CHANGED",()->OfficialLifelogDiscovery.read(ACCOUNT.binding,Arrays.asList(DAY,OfficialLifelogInventory.Request.day("2026-10-20","Asia/Shanghai")),crossDay,crossDay));yes(crossDay.fulls==0);
  Wire dupDays=new Wire();reject("LIFELOG_DISCOVERY_DAYS_INVALID",()->OfficialLifelogDiscovery.read(ACCOUNT.binding,Arrays.asList(DAY,DAY),dupDays,dupDays));yes(dupDays.lists==0);
  Wire noZone=new Wire();reject("LIFELOG_DISCOVERY_DAYS_INVALID",()->OfficialLifelogDiscovery.read(ACCOUNT.binding,Arrays.asList(OfficialLifelogInventory.Request.cached("https://xr-api-p.rayneo.cn/lifelog/api/v1/events?date=2026-10-21")),noZone,noZone));
  Wire tooMany=new Wire();List<OfficialLifelogInventory.Request> days=new ArrayList<>();for(int i=10;i<18;i++)days.add(OfficialLifelogInventory.Request.day("2026-10-"+i,"Asia/Shanghai"));reject("LIFELOG_DISCOVERY_BUDGET",()->OfficialLifelogDiscovery.read(ACCOUNT.binding,days,tooMany,tooMany));yes(tooMany.lists==0);
  Wire interrupted=new Wire();Thread.currentThread().interrupt();try{reject("MATERIAL_PAUSED",()->read(interrupted));}finally{Thread.interrupted();}yes(interrupted.lists==0);
  System.out.println("Official lifelog discovery: "+checks+" assertions passed");
 }
}
