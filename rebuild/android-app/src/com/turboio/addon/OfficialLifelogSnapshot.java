package com.turboio.addon;

import java.util.*;

/** Exact loaded-event schema adapter for host 1.0.7. Account ownership must be
 * proved by the caller before persisting or uploading; a log alone cannot prove
 * which logged-in user owns historical entries. No network or storage here. */
public final class OfficialLifelogSnapshot {
 private OfficialLifelogSnapshot(){}
 private static void require(boolean ok,String code){MaterialWire.require(ok,code);}
 private static String text(Object v,int max,boolean empty){return MaterialWire.text(v,max,empty);}
 private static String id(Object value){String s=text(value,128,false);require(s.matches("[A-Za-z0-9_.:-]+"),"LIFELOG_ID_INVALID");return s;}
 private static long time(Object v){String s=text(v,13,false);require(s.matches("[0-9]{13}"),"LIFELOG_TIME_INVALID");long value=Long.parseLong(s);require(value>0,"LIFELOG_TIME_INVALID");return value;}
 private static String optional(Object v,int max){return v==null?"":text(v,max,true);}
 /** Read a previously preserved canonical source; this is not freshness proof. */
 static Source original(byte[] json){return new Source(WireJson.map(WireJson.read(json)));}
 /** The host may split one source across several aggregate events. Only exact
  * duplicates or disjoint ranges with equal non-range metadata can be joined.
  * No fragment wins a conflict, and no inferred text fills the gaps. */
 static Source fragments(List<Source> input){
  require(input!=null&&!input.isEmpty()&&input.size()<=16,"LIFELOG_SOURCE_BUDGET");
  List<Source> ordered=new ArrayList<>(input);ordered.sort(Comparator.comparingLong((Source s)->s.start).thenComparingLong(s->s.end));
  List<Source> unique=new ArrayList<>();for(Source s:ordered){boolean same=false;for(Source p:unique)if(Arrays.equals(p.original,s.original)){same=true;break;}if(!same)unique.add(s);}
  if(unique.size()==1)return unique.get(0);
  Map<String,Object> merged=WireJson.map(WireJson.read(unique.get(0).original)),metadata=new TreeMap<>(merged);for(String k:new String[]{"startTime","endTime","clips"})metadata.remove(k);
  List<Object> clips=new ArrayList<>();Set<String> ids=new HashSet<>();long until=unique.get(0).start;
  for(Source source:unique){Map<String,Object> value=WireJson.map(WireJson.read(source.original)),other=new TreeMap<>(value);for(String k:new String[]{"startTime","endTime","clips"})other.remove(k);
   require(metadata.equals(other)&&source.start>=until,"LIFELOG_FRESH_SOURCE_CONFLICT");until=source.end;
   for(Object raw:WireJson.list(value.get("clips"))){require(ids.add((String)WireJson.map(raw).get("clipId")),"LIFELOG_FRESH_SOURCE_CONFLICT");clips.add(raw);}require(clips.size()<=10000,"LIFELOG_CLIP_BUDGET");
  }
  merged.put("endTime",Long.toString(until));merged.put("clips",clips);require(WireJson.bytes(merged).length<=1048576,"LIFELOG_SOURCE_BUDGET");return new Source(merged);
 }
 public static final class Clip {
  public final String id,text,speakerType,speakerName;public final long start,end;
  private Clip(Map<String,Object> v,long from,long until){id=id(v.get("clipId"));text=text(v.get("content"),65536,true);start=time(v.get("startTime"));end=time(v.get("endTime"));require(start>=from&&end>=start&&end<=until,"LIFELOG_CLIP_RANGE");speakerType=optional(v.get("speakerType"),64);speakerName=optional(v.get("speakerName"),80);}
 }
 public static final class Source {
  public final String sourceId,sourceType,title;public final long start,end;public final List<Clip> clips;private final byte[] original;
  private Source(Map<String,Object> v){sourceId=id(v.get("sourceId"));sourceType=id(v.get("sourceType"));title=text(v.get("title"),1024,true);start=time(v.get("startTime"));end=time(v.get("endTime"));require(end>=start,"LIFELOG_SOURCE_RANGE");List<Object> raw=WireJson.list(v.get("clips"));require(raw.size()<=10000,"LIFELOG_CLIP_BUDGET");List<Clip> values=new ArrayList<>();Set<String> seen=new HashSet<>();long previous=-1;
   for(Object item:raw){Clip clip=new Clip(WireJson.map(item),start,end);require(seen.add(clip.id),"LIFELOG_DUPLICATE_CLIP");require(clip.start>=previous,"LIFELOG_CLIP_ORDER");previous=clip.start;values.add(clip);}clips=Collections.unmodifiableList(values);original=WireJson.bytes(v);
  }
  /** Canonical original source, including fields not mapped to Material 1.2. */
  public byte[] original(){return original.clone();}
  /** Fresh-read caller supplies the committed prior body; logs alone cannot
   * establish freshness. Keep speaker identity across a proven cluster rename. */
  public byte[] materialRevision(String accountBinding,long revision,byte[] previous){return LifelogRevisionMapper.reconcile(materialBody(accountBinding,revision),previous);}
  public String materialId(String accountBinding){require(accountBinding!=null&&accountBinding.matches("[a-f0-9]{64}"),"LIFELOG_ACCOUNT_BINDING_REQUIRED");return "rayneo-lifelog-"+TaskWire.hash(WireJson.bytes(WireJson.object("provider","rayneo-lifelog","account",accountBinding,"source_type",sourceType,"source_id",sourceId)));}
  /** Per-original identity avoids duplicate materials when daily aggregates
   * regroup the same recording. Unknown coverage is never promoted to complete. */
  public byte[] materialBody(String accountBinding,long revision){
   require(revision>0&&revision<=9007199254740991L,"MATERIAL_REVISION_INVALID");String material=materialId(accountBinding);List<Object> utterances=new ArrayList<>(),speakers=new ArrayList<>();Map<String,String> speakerIds=new LinkedHashMap<>();StringBuilder full=new StringBuilder();boolean[] overlap=new boolean[clips.size()];long longestEnd=-1;int longest=-1;
   for(int i=0;i<clips.size();i++){Clip c=clips.get(i);if(c.end>c.start&&c.start<longestEnd){overlap[i]=true;overlap[longest]=true;}if(c.end>longestEnd&&c.end>c.start){longestEnd=c.end;longest=i;}}
   for(int i=0;i<clips.size();i++){Clip c=clips.get(i);String speaker=null;
    if(!c.speakerName.trim().isEmpty()){String key=c.speakerType+"\n"+c.speakerName;speaker=speakerIds.get(key);if(speaker==null){speaker=material+"-s"+TaskWire.hash(WireJson.bytes(Arrays.asList(c.speakerType,c.speakerName)));speakerIds.put(key,speaker);speakers.add(WireJson.object("speaker_id",speaker,"label",c.speakerName,"label_basis","anonymous","is_self",false));}}
    if(i>0)full.append('\n');full.append(c.text);utterances.add(WireJson.object("utterance_id",material+"-u"+TaskWire.hash(WireJson.bytes(c.id)),"start_ms",c.start-start,"end_ms",c.end-start,"text",c.text,"speaker_id",speaker,"speaker_basis",speaker==null?"unknown":"segment_cluster","overlap",overlap[i]));
   }
   Map<String,Object> body=WireJson.object("material_id",material,"revision",revision,"base_revision",revision-1,"operation","upsert","source","lifelog","started_at",TaskWire.now(start),"ended_at",TaskWire.now(end),"completeness","partial","text_revision",revision,"utterances",utterances,"speakers",speakers,"audio",WireJson.object("state","missing","sha256",null,"object_id",null),"full_text",WireJson.object("format","markdown","text",full.toString(),"origin","asr"),"processing",WireJson.object("transcription_state","unknown","covered_ms",null,"source_ms",null,"speaker",speakers.isEmpty()?"unknown":"processed","boundary","unverified","recognition_channel","unknown","user_edited",false));
   MaterialWire.body(body);return WireJson.bytes(body);
  }
 }
 public static List<Source> read(String expectedEventId,byte[] json){
  id(expectedEventId);Map<String,Object> response=WireJson.map(WireJson.read(json));require(response.get("code") instanceof Long&&((Long)response.get("code"))==0,"LIFELOG_RESPONSE_REJECTED");Map<String,Object> event=WireJson.map(response.get("data"));require(expectedEventId.equals(event.get("id")),"LIFELOG_EVENT_MISMATCH");
  List<Object> originals=WireJson.list(event.get("originalList")),contents=WireJson.list(event.get("transcriptionContents"));require(originals.size()<=256&&contents.size()<=256,"LIFELOG_SOURCE_BUDGET");Map<String,Map<String,Object>> owners=new HashMap<>();
  for(Object item:originals){Map<String,Object> original=WireJson.map(item);require(owners.put(id(original.get("id")),original)==null,"LIFELOG_DUPLICATE_SOURCE");}
  Set<String> seen=new HashSet<>();List<Source> result=new ArrayList<>();
  for(Object item:contents){Source source=new Source(WireJson.map(item));require(seen.add(source.sourceType+"/"+source.sourceId),"LIFELOG_DUPLICATE_SOURCE");Map<String,Object> original=owners.get(source.sourceId);require(original!=null,"LIFELOG_SOURCE_UNBOUND");require(time(original.get("startTime"))==source.start&&time(original.get("endTime"))==source.end,"LIFELOG_SOURCE_RANGE");boolean declared=false;
   for(Object info:WireJson.list(original.get("transcriptionInfos"))){Map<String,Object> link=WireJson.map(info);if(source.sourceId.equals(link.get("sourceId"))&&source.sourceType.equals(link.get("sourceType")))declared=true;}require(declared,"LIFELOG_SOURCE_UNBOUND");result.add(source);
  }
  return Collections.unmodifiableList(result);
 }
}
