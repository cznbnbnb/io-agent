package com.turboio.addon;
import java.util.*;

/** Reconcile a fresh official snapshot with one committed material revision.
 * A speaker label is mutable. Preserve a prior speaker ID only when shared
 * utterance IDs establish a one-to-one cluster correspondence. This says nothing
 * about real-world identity or cross-record speaker recognition. */
final class LifelogRevisionMapper {
 private static void require(boolean ok,String code){MaterialWire.require(ok,code);}
 private static Map<String,Map<String,Object>> index(List<Object> values,String key){Map<String,Map<String,Object>> out=new TreeMap<>();for(Object raw:values){Map<String,Object> row=WireJson.map(raw);require(out.put((String)row.get(key),row)==null,"LIFELOG_REVISION_DUPLICATE");}return out;}
 private static boolean confirmed(Map<String,Object> speaker){return "user_confirmed".equals(speaker.get("label_basis"));}
 static byte[] reconcile(byte[] current,byte[] previous){
  Map<String,Object> fresh=WireJson.map(MaterialWire.read(current)),old=WireJson.map(MaterialWire.read(previous));MaterialWire.body(fresh);MaterialWire.body(old);
  long revision=MaterialWire.positive(fresh.get("revision"));
  require(fresh.get("material_id").equals(old.get("material_id"))&&fresh.get("source").equals("lifelog")&&old.get("source").equals("lifelog")&&old.get("operation").equals("upsert")&&fresh.get("operation").equals("upsert"),"LIFELOG_REVISION_BINDING");
  require(revision==Math.addExact(MaterialWire.positive(old.get("revision")),1),"LIFELOG_REVISION_ORDER");
  Map<String,Map<String,Object>> oldUtterances=index(WireJson.list(old.get("utterances")),"utterance_id"),newUtterances=index(WireJson.list(fresh.get("utterances")),"utterance_id");
  Map<String,Map<String,Object>> oldSpeakers=index(WireJson.list(old.get("speakers")),"speaker_id"),newSpeakers=index(WireJson.list(fresh.get("speakers")),"speaker_id");
  Map<String,Set<String>> previousByNew=new HashMap<>(),nextByOld=new HashMap<>();
  for(Map.Entry<String,Map<String,Object>> entry:newUtterances.entrySet()){
   Map<String,Object> before=oldUtterances.get(entry.getKey());if(before==null)continue;
   String prior=(String)before.get("speaker_id"),next=(String)entry.getValue().get("speaker_id");
   // Null participates in the sets: known->unknown or unknown->known is not a
   // proven rename of the complete shared cluster.
   previousByNew.computeIfAbsent(next,k->new HashSet<>()).add(prior);
   nextByOld.computeIfAbsent(prior,k->new HashSet<>()).add(next);
  }
  Map<String,String> reassigned=new HashMap<>();Set<String> retained=new HashSet<>();
  for(String next:newSpeakers.keySet()){
   Set<String> predecessors=previousByNew.get(next);if(predecessors==null||predecessors.size()!=1)continue;String prior=predecessors.iterator().next();if(prior==null)continue;
   Set<String> successors=nextByOld.get(prior);if(successors!=null&&successors.size()==1&&successors.contains(next)){reassigned.put(next,prior);retained.add(prior);}
  }
  // Never turn a user's confirmed attribution into an anonymous split/merge.
  // An explicit review workflow must resolve this conflict before publication.
  for(Map.Entry<String,Map<String,Object>> entry:oldSpeakers.entrySet())if(confirmed(entry.getValue())&&nextByOld.containsKey(entry.getKey())&&!retained.contains(entry.getKey()))throw new IllegalArgumentException("LIFELOG_SPEAKER_REVIEW_REQUIRED");
  String material=(String)fresh.get("material_id");Set<String> allocated=new HashSet<>(retained);List<Object> speakers=new ArrayList<>();
  for(Object raw:WireJson.list(fresh.get("speakers"))){Map<String,Object> speaker=WireJson.map(raw);String next=(String)speaker.get("speaker_id"),prior=reassigned.get(next);Map<String,Object> output=WireJson.map(WireJson.copy(speaker));
   if(prior!=null){Map<String,Object> before=oldSpeakers.get(prior);if(confirmed(before))output=WireJson.map(WireJson.copy(before));output.put("speaker_id",prior);}
   else{List<String> members=new ArrayList<>();for(Map.Entry<String,Map<String,Object>> utterance:newUtterances.entrySet())if(next.equals(utterance.getValue().get("speaker_id")))members.add(utterance.getKey());
    String id=material+"-s"+TaskWire.hash(WireJson.bytes(WireJson.object("revision",revision,"cluster",next,"members",members)));require(!oldSpeakers.containsKey(id)&&allocated.add(id),"LIFELOG_SPEAKER_ID_COLLISION");reassigned.put(next,id);output.put("speaker_id",id);
   }speakers.add(output);
  }
  for(Object raw:WireJson.list(fresh.get("utterances"))){Map<String,Object> utterance=WireJson.map(raw);String next=(String)utterance.get("speaker_id");if(next==null)continue;String id=reassigned.get(next);require(id!=null,"LIFELOG_SPEAKER_UNBOUND");utterance.put("speaker_id",id);Map<String,Object> prior=oldSpeakers.get(id);if(prior!=null&&confirmed(prior))utterance.put("speaker_basis","user_confirmed");}
  // Keep stable ordering when only labels/types change; wire comparisons must
  // not create a revision solely because a list iteration order changed.
  Map<String,Integer> order=new HashMap<>();int ordinal=0;for(Object raw:WireJson.list(old.get("speakers")))order.put((String)WireJson.map(raw).get("speaker_id"),ordinal++);
  speakers.sort(Comparator.comparingInt(v->order.getOrDefault((String)WireJson.map(v).get("speaker_id"),Integer.MAX_VALUE)));fresh.put("speakers",speakers);
  boolean sameText=Objects.equals(fresh.get("full_text"),old.get("full_text"))&&oldUtterances.keySet().equals(newUtterances.keySet());
  if(sameText)for(String id:newUtterances.keySet())if(!Objects.equals(newUtterances.get(id).get("text"),oldUtterances.get(id).get("text"))){sameText=false;break;}
  Map<String,Object> oldProcessing=WireJson.map(old.get("processing")),processing=WireJson.map(fresh.get("processing"));
  require(sameText||!Boolean.TRUE.equals(oldProcessing.get("user_edited")),"LIFELOG_TEXT_REVIEW_REQUIRED");
  if(Boolean.TRUE.equals(oldProcessing.get("user_edited")))processing.put("user_edited",true);
  // The material service versions the whole transcript, including speaker
  // attribution and timing. Its counter is independent of material metadata.
  boolean sameTranscript=Objects.equals(fresh.get("full_text"),old.get("full_text"))&&Objects.equals(fresh.get("utterances"),old.get("utterances"))&&Objects.equals(fresh.get("speakers"),old.get("speakers"));
  fresh.put("text_revision",sameTranscript?old.get("text_revision"):Math.addExact(MaterialWire.positive(old.get("text_revision")),1));MaterialWire.body(fresh);return WireJson.bytes(fresh);
 }
}
