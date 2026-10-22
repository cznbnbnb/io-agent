package com.turboio.addon;
import java.util.*;

public final class LifelogRevisionMapperTest {
 static int checks;static void yes(boolean ok){checks++;if(!ok)throw new AssertionError("Revision mapping "+checks);}
 interface Work{void run();}static void reject(String code,Work work){checks++;try{work.run();}catch(IllegalArgumentException e){if(code.equals(e.getMessage()))return;throw e;}throw new AssertionError("Expected "+code);}
 static Map<String,Object> map(byte[] b){return WireJson.map(WireJson.read(b));}
 static List<Object> clips(Map<String,Object> fixture){return WireJson.list(OfficialLifelogSnapshotTest.source(fixture).get("clips"));}
 static List<Object> speakers(Map<String,Object> body){return WireJson.list(body.get("speakers"));}
 static List<Object> utterances(Map<String,Object> body){return WireJson.list(body.get("utterances"));}
 static String sid(Map<String,Object> body){return (String)WireJson.map(speakers(body).get(0)).get("speaker_id");}
 static void rename(Map<String,Object> fixture,String label){for(Object raw:clips(fixture)){Map<String,Object> clip=WireJson.map(raw);clip.put("speakerName",label);clip.put("speakerType","REFRESHED_ANONYMOUS");}}
 static Map<String,Object> revise(Map<String,Object> fixture,Map<String,Object> prior){return map(OfficialLifelogSnapshotTest.read(fixture).materialRevision(OfficialLifelogSnapshotTest.ACCOUNT,2,WireJson.bytes(prior)));}
 public static void main(String[] args){
  Map<String,Object> fixture=OfficialLifelogSnapshotTest.fixture(),old=map(OfficialLifelogSnapshotTest.read(fixture).materialBody(OfficialLifelogSnapshotTest.ACCOUNT,1));byte[] unchanged=WireJson.bytes(old);
  Map<String,Object> renamed=OfficialLifelogSnapshotTest.fixture();rename(renamed,"合成新标签");Map<String,Object> next=revise(renamed,old);
  yes(sid(next).equals(sid(old)));yes(WireJson.map(speakers(next).get(0)).get("label").equals("合成新标签"));yes(next.get("text_revision").equals(2L));yes(next.get("revision").equals(2L)&&next.get("base_revision").equals(1L));yes(next.get("full_text").equals(old.get("full_text")));yes(Arrays.equals(unchanged,WireJson.bytes(old)));
  for(Object raw:utterances(next))yes(WireJson.map(raw).get("speaker_id").equals(sid(old)));
  yes(Arrays.equals(WireJson.bytes(next),WireJson.bytes(revise(renamed,old))));
  Map<String,Object> typeOnly=OfficialLifelogSnapshotTest.fixture();rename(typeOnly,"合成发言人");Map<String,Object> noProductChange=revise(typeOnly,old);noProductChange.put("revision",1L);noProductChange.put("base_revision",0L);yes(noProductChange.equals(old));
  Map<String,Object> confirmed=map(unchanged);Map<String,Object> confirmedSpeaker=WireJson.map(speakers(confirmed).get(0));confirmedSpeaker.put("label","合成本人");confirmedSpeaker.put("label_basis","user_confirmed");confirmedSpeaker.put("is_self",true);for(Object u:utterances(confirmed))WireJson.map(u).put("speaker_basis","user_confirmed");
  Map<String,Object> kept=revise(renamed,confirmed);yes(speakers(kept).equals(speakers(confirmed)));for(Object u:utterances(kept))yes(WireJson.map(u).get("speaker_basis").equals("user_confirmed"));
  Map<String,Object> split=OfficialLifelogSnapshotTest.fixture();WireJson.map(clips(split).get(0)).put("speakerName","合成拆分A");WireJson.map(clips(split).get(1)).put("speakerName","合成拆分B");WireJson.map(clips(split).get(2)).put("speakerName","合成拆分B");Map<String,Object> splitBody=revise(split,old);yes(speakers(splitBody).size()==2);for(Object sp:speakers(splitBody))yes(!sid(old).equals(WireJson.map(sp).get("speaker_id")));reject("LIFELOG_SPEAKER_REVIEW_REQUIRED",()->revise(split,confirmed));
  Map<String,Object> oldSplit=map(OfficialLifelogSnapshotTest.read(split).materialBody(OfficialLifelogSnapshotTest.ACCOUNT,1));Map<String,Object> merged=revise(fixture,oldSplit);yes(speakers(merged).size()==1);for(Object sp:speakers(oldSplit))yes(!sid(merged).equals(WireJson.map(sp).get("speaker_id")));
  Map<String,Object> unknown=OfficialLifelogSnapshotTest.fixture();WireJson.map(clips(unknown).get(0)).put("speakerName","");reject("LIFELOG_SPEAKER_REVIEW_REQUIRED",()->revise(unknown,confirmed));yes(utterances(revise(unknown,old)).size()==3);
  Map<String,Object> unrelated=OfficialLifelogSnapshotTest.fixture();for(int i=0;i<clips(unrelated).size();i++)WireJson.map(clips(unrelated).get(i)).put("clipId","new-"+i);yes(!sid(revise(unrelated,old)).equals(sid(old)));
  Map<String,Object> appended=OfficialLifelogSnapshotTest.fixture();List<Object> expanded=new ArrayList<>(clips(appended));expanded.add(OfficialLifelogSnapshotTest.clip("clip-4",3000,4000,"新增的合成条件。"));OfficialLifelogSnapshotTest.source(appended).put("clips",expanded);Map<String,Object> longer=revise(appended,old);yes(sid(longer).equals(sid(old))&&utterances(longer).size()==4);yes(longer.get("text_revision").equals(2L));
  Map<String,Object> corrected=OfficialLifelogSnapshotTest.fixture();OfficialLifelogSnapshotTest.firstClip(corrected).put("content","合成更正正文。");yes(revise(corrected,old).get("text_revision").equals(2L));
  Map<String,Object> userEdited=map(unchanged);WireJson.map(userEdited.get("processing")).put("user_edited",true);reject("LIFELOG_TEXT_REVIEW_REQUIRED",()->revise(corrected,userEdited));yes(WireJson.map(revise(renamed,userEdited).get("processing")).get("user_edited").equals(true));
  Map<String,Object> metadataVersions=map(unchanged);metadataVersions.put("revision",5L);metadataVersions.put("base_revision",4L);metadataVersions.put("text_revision",2L);
  Map<String,Object> afterGap=map(OfficialLifelogSnapshotTest.read(renamed).materialRevision(OfficialLifelogSnapshotTest.ACCOUNT,6,WireJson.bytes(metadataVersions)));yes(afterGap.get("text_revision").equals(3L));yes(afterGap.get("revision").equals(6L));
  Map<String,Object> stableGap=map(OfficialLifelogSnapshotTest.read(fixture).materialRevision(OfficialLifelogSnapshotTest.ACCOUNT,6,WireJson.bytes(metadataVersions)));yes(stableGap.get("text_revision").equals(2L));
  Map<String,Object> timing=OfficialLifelogSnapshotTest.fixture();OfficialLifelogSnapshotTest.firstClip(timing).put("endTime",Long.toString(OfficialLifelogSnapshotTest.START+900));yes(revise(timing,old).get("text_revision").equals(2L));
  reject("LIFELOG_REVISION_ORDER",()->OfficialLifelogSnapshotTest.read(fixture).materialRevision(OfficialLifelogSnapshotTest.ACCOUNT,3,unchanged));
  reject("LIFELOG_REVISION_BINDING",()->OfficialLifelogSnapshotTest.read(fixture).materialRevision(OfficialLifelogSnapshotTest.ACCOUNT.replace('a','b'),2,unchanged));
  System.out.println("Lifelog revision mapping: "+checks+" assertions passed");
 }
}
