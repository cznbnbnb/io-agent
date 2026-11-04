package com.turboio.addon;

import java.util.*;

/** Portable original-question voice draft. No microphone, SDK, network or implicit task cancel. */
final class VoiceAnswerSession implements CaptureSession {
 interface Store {Object read()throws Exception;void save(Object value)throws Exception;}
 // 2026-10-23 (user): 30 s was too short for a prompter answer with conditions; 60 s, and a stop at
 // the limit still goes to review. The 30 s rule for synthetic capture experiments (AGENTS.md) is separate.
 static final int CAPTURE_SECONDS=CaptureSession.CAPTURE_SECONDS;
 private static final Set<String> PHASES=TaskWire.set("IDLE","PREPARED","CAPTURING","STOPPING","RECOVERY","REVIEW","INCOMPLETE","CANCELLED","SUBMITTING","SAVED");
 private final Store store;private Map<String,Object> state;private boolean healthy=true;private StopProbe probe;
 private volatile CapturePermit permit=new CapturePermit(empty(),false);private volatile boolean openingRevoked=true;
 VoiceAnswerSession(Store store){
  this.store=store;
  try{Object raw=store.read();state=raw==null?empty():WireJson.map(WireJson.copy(raw));validate(state);permit=new CapturePermit(state,false);
   if(needsStop()){Map<String,Object> next=copy();next.put("phase","RECOVERY");next.put("engine_end",false);next.put("engine_stopped",false);next.put("device_stopped",false);next.put("stop_sent",0);next.put("error","VOICE_INTERRUPTED");save(next);}
  }catch(Exception invalid){healthy=false;state=empty();}
 }
 private static Map<String,Object> empty(){return WireJson.object("schema",1,"phase","IDLE","target",null,"token","","peer","","generation",0,"deadline",0,"stop_at",0,"stop_sent",0,"needs_stop",false,"engine_end",false,"engine_stopped",false,"device_stopped",false,"cancelled",false,"error","","segments",new ArrayList<>(),"edited",null,"frozen_text",null);}
 private String string(String key){return (String)state.get(key);}private long number(String key){return TaskWire.nonnegative(state.get(key));}
 private boolean flag(String key){return Boolean.TRUE.equals(state.get(key));}private Map<String,Object> copy(){return WireJson.map(WireJson.copy(state));}
 private void save(Map<String,Object> next)throws Exception{
  if(!"CAPTURING".equals(next.get("phase")))revokeOpening();validate(next);
  try{store.save(next);}catch(Exception failure){healthy=false;revokeOpening();throw failure;}
  state=next;permit=new CapturePermit(next,!openingRevoked);
 }
 private void revokeOpening(){openingRevoked=true;}
 public void revokeOpening(String token){if(token!=null&&token.equals(permit.token))revokeOpening();}
 public CapturePermit capturePermit(){CapturePermit current=permit;return openingRevoked&&current.opening?new CapturePermit(current):current;}
 private static Map<String,Object> target(Map<String,Object> value){
  BoundedJson.keys(value,"binding","fingerprint","request");TaskWire.require(TaskWire.text(value.get("binding"),64,false).matches("[a-f0-9]{64}"),"VOICE_TARGET_INVALID");
  Map<String,Object> request=TaskWire.object(value.get("request"));TaskWire.require("request".equals(request.get("kind"))&&TaskWire.requestFingerprint(request).equals(value.get("fingerprint")),"VOICE_REQUEST_CHANGED");return value;
 }
 private static String text(Map<String,Object> s){StringJoiner joined=new StringJoiner("\n");for(Object raw:WireJson.list(s.get("segments")))joined.add((String)WireJson.map(raw).get("text"));return joined.toString();}
 private static void validate(Map<String,Object> s){
  BoundedJson.keys(s,"schema","phase","target","token","peer","generation","deadline","stop_at","stop_sent","needs_stop","engine_end","engine_stopped","device_stopped","cancelled","error","segments","edited","frozen_text");
  TaskWire.require(TaskWire.positive(s.get("schema"))==1&&PHASES.contains(s.get("phase")),"VOICE_STORE_INVALID");
  for(String key:new String[]{"needs_stop","engine_end","engine_stopped","device_stopped","cancelled"})TaskWire.require(s.get(key) instanceof Boolean,"VOICE_STORE_INVALID");
  for(String key:new String[]{"generation","deadline","stop_at","stop_sent"})TaskWire.nonnegative(s.get(key));
  TaskWire.text(s.get("error"),64,true);String token=TaskWire.text(s.get("token"),32,true),peer=TaskWire.text(s.get("peer"),64,true);
  List<Object> segments=WireJson.list(s.get("segments"));TaskWire.require(segments.size()<=64,"VOICE_TRANSCRIPT_TOO_LONG");
  for(int i=0;i<segments.size();i++){Map<String,Object> segment=WireJson.map(segments.get(i));BoundedJson.keys(segment,"index","revision","text","final");TaskWire.require(TaskWire.positive(segment.get("index"))==i+1&&segment.get("final") instanceof Boolean,"VOICE_STORE_INVALID");TaskWire.positive(segment.get("revision"));TaskWire.text(segment.get("text"),65536,true);}
  TaskWire.text(text(s),65536,true);for(String k:new String[]{"edited","frozen_text"})if(s.get(k)!=null)TaskWire.require(!TaskWire.text(s.get(k),65536,false).trim().isEmpty(),"VOICE_TEXT_EMPTY");
  if(s.get("phase").equals("IDLE"))TaskWire.require(s.get("target")==null&&token.isEmpty()&&peer.isEmpty()&&segments.isEmpty()&&!Boolean.TRUE.equals(s.get("needs_stop")),"VOICE_STORE_INVALID");
  else{target(WireJson.map(s.get("target")));TaskWire.require(token.matches("[a-f0-9]{32}")&&(peer.isEmpty()||peer.matches("[a-f0-9]{64}")),"VOICE_STORE_INVALID");}
  if(Boolean.TRUE.equals(s.get("needs_stop")))TaskWire.require(!peer.isEmpty()&&TaskWire.positive(s.get("generation"))>0&&TaskWire.positive(s.get("deadline"))>0&&TaskWire.set("CAPTURING","STOPPING","RECOVERY").contains(s.get("phase")),"VOICE_STOP_OBLIGATION_INVALID");
  TaskWire.require(Boolean.TRUE.equals(s.get("needs_stop"))==TaskWire.set("CAPTURING","STOPPING","RECOVERY").contains(s.get("phase")),"VOICE_STOP_OBLIGATION_INVALID");
  if(TaskWire.set("IDLE","PREPARED").contains(s.get("phase")))TaskWire.require(peer.isEmpty()&&segments.isEmpty()&&s.get("edited")==null&&s.get("error").equals("")&&!Boolean.TRUE.equals(s.get("cancelled"))&&!Boolean.TRUE.equals(s.get("engine_end"))&&!Boolean.TRUE.equals(s.get("engine_stopped"))&&!Boolean.TRUE.equals(s.get("device_stopped"))&&TaskWire.nonnegative(s.get("generation"))==0&&TaskWire.nonnegative(s.get("deadline"))==0&&TaskWire.nonnegative(s.get("stop_at"))==0&&TaskWire.nonnegative(s.get("stop_sent"))==0,"VOICE_STORE_INVALID");
  if(TaskWire.nonnegative(s.get("stop_sent"))>0)TaskWire.require(TaskWire.positive(s.get("stop_at"))<=TaskWire.nonnegative(s.get("stop_sent")),"VOICE_STOP_OBLIGATION_INVALID");
  if(Boolean.TRUE.equals(s.get("device_stopped")))TaskWire.positive(s.get("stop_sent"));
  if(TaskWire.set("REVIEW","SUBMITTING","SAVED").contains(s.get("phase")))TaskWire.require(!Boolean.TRUE.equals(s.get("needs_stop"))&&!Boolean.TRUE.equals(s.get("cancelled"))&&Boolean.TRUE.equals(s.get("engine_end"))&&Boolean.TRUE.equals(s.get("engine_stopped"))&&Boolean.TRUE.equals(s.get("device_stopped"))&&s.get("error").equals("")&&!text(s).trim().isEmpty()&&allFinal(s),"VOICE_COMPLETENESS_INVALID");
  TaskWire.require((s.get("frozen_text")!=null)==TaskWire.set("SUBMITTING","SAVED").contains(s.get("phase")),"VOICE_FROZEN_TEXT_INVALID");
  TaskWire.require(WireJson.bytes(s).length<=2097152,"VOICE_STORE_BUDGET");
 }
 private static boolean allFinal(Map<String,Object> s){for(Object raw:WireJson.list(s.get("segments")))if(!Boolean.TRUE.equals(WireJson.map(raw).get("final")))return false;return !WireJson.list(s.get("segments")).isEmpty();}
 public synchronized boolean healthy(){return healthy;}public synchronized String phase(){return healthy?string("phase"):"BLOCKED";}public synchronized String token(){return string("token");}
 public synchronized boolean needsStop(){return !healthy||flag("needs_stop");}synchronized String transcript(){return text(state);}synchronized String answerText(){return state.get("edited")==null?transcript():(String)state.get("edited");}
 synchronized String operation(){return "agent-voice-"+token();}public synchronized Object snapshot(){return WireJson.copy(state);}
 synchronized boolean prepare(TaskConnection connection,Map<String,Object> request,Map<String,Object> parent,long wall)throws Exception{
  if(!healthy||!TaskWire.set("IDLE","PREPARED").contains(phase()))return false;TaskWire.object(request);TaskWire.object(parent);
  TaskWire.require(TaskWire.canAnswer(request,parent,wall)&&TaskWire.same(TaskWire.body(request).get("route"),connection.route()),"VOICE_REQUEST_CLOSED");
  if(phase().equals("PREPARED")){Map<String,Object> original=WireJson.map(state.get("target"));return connection.binding().equals(original.get("binding"))&&TaskWire.requestFingerprint(request).equals(original.get("fingerprint"));}
  Map<String,Object> next=empty();next.put("phase","PREPARED");next.put("token",UUID.randomUUID().toString().replace("-",""));next.put("target",WireJson.object("binding",connection.binding(),"fingerprint",TaskWire.requestFingerprint(request),"request",WireJson.copy(request)));save(next);return true;
 }
 public synchronized boolean arm(String peer,long generation,long now,int seconds,Cutoff cutoff)throws Exception{
  if(!healthy||!phase().equals("PREPARED"))return false;TaskWire.require(peer!=null&&!peer.isEmpty()&&generation>0&&now>0&&seconds>=3&&seconds<=CAPTURE_SECONDS,"VOICE_CAPTURE_INVALID");String hash=FixedPeerHash.of(peer);long deadline=Math.addExact(now,seconds*1000L);
  if(cutoff==null||!cutoff.armed(token(),hash,generation,deadline))return false;
  Map<String,Object> next=copy();next.put("phase","CAPTURING");next.put("peer",hash);next.put("generation",generation);next.put("deadline",deadline);next.put("needs_stop",true);openingRevoked=false;save(next);return true;
 }
 private boolean owned(String token,String peer,long generation){return healthy&&token().equals(token)&&peer!=null&&string("peer").equals(FixedPeerHash.of(peer))&&number("generation")==generation;}
 private void fault(String code,long now)throws Exception{Map<String,Object> next=copy();next.put("error",code);if(needsStop()){next.put("phase","STOPPING");if(number("stop_at")==0)next.put("stop_at",now);}save(next);}
 // The platform adapter supplies stable segment/revision semantics. No guessing whether an
 // arbitrary official callback is a cumulative capture or a sentence; that mapping needs separate verification.
 synchronized boolean result(String token,String peer,long generation,int index,long revision,String fullText,boolean finished,long now)throws Exception{
  if(!owned(token,peer,generation)||flag("engine_stopped")||!TaskWire.set("CAPTURING","STOPPING").contains(phase()))return false;
  Map<String,Object> next=copy();List<Object> segments=WireJson.list(next.get("segments"));
  try{TaskWire.text(fullText,65536,true);TaskWire.require(index>0&&index<=64&&index<=segments.size()+1&&revision>0,"VOICE_RESULT_INVALID");
   if(index==segments.size()+1){TaskWire.require(revision==1&&(segments.isEmpty()||Boolean.TRUE.equals(WireJson.map(segments.get(segments.size()-1)).get("final"))),"VOICE_RESULT_INVALID");segments.add(WireJson.object("index",index,"revision",revision,"text",fullText,"final",finished));}
   else{Map<String,Object> old=WireJson.map(segments.get(index-1));long prior=TaskWire.positive(old.get("revision"));if(revision==prior){TaskWire.require(fullText.equals(old.get("text"))&&Boolean.valueOf(finished).equals(old.get("final")),"VOICE_RESULT_CONFLICT");return true;}TaskWire.require(revision==prior+1,"VOICE_RESULT_INVALID");segments.set(index-1,WireJson.object("index",index,"revision",revision,"text",fullText,"final",finished));}
   save(next);return true;
  }catch(IllegalArgumentException invalid){fault("VOICE_RESULT_INCOMPLETE",now);return false;}
 }
 /** Host 1.0.7 named ASR: current-sentence replacements followed by sentence finals.
  * No stable vendor segment ID exists in this callback. A consecutive final without a
  * new partial is ambiguous (duplicate versus another sentence): preserve its text,
  * mark the draft incomplete, and require cleanup instead of silently dropping it.
  */
 public synchronized boolean officialResult(String token,String peer,long generation,String fullText,boolean finished,long now)throws Exception{
  if(!owned(token,peer,generation)||flag("engine_stopped")||!string("error").isEmpty()||!TaskWire.set("CAPTURING","STOPPING").contains(phase()))return false;
  try{TaskWire.text(fullText,65536,false);TaskWire.require(!fullText.trim().isEmpty(),"VOICE_RESULT_INVALID");}
  catch(IllegalArgumentException invalid){fault("VOICE_RESULT_INCOMPLETE",now);return false;}
  List<Object> segments=WireJson.list(state.get("segments"));int count=segments.size();
  Map<String,Object> last=count==0?null:WireJson.map(segments.get(count-1));
  boolean priorFinal=last!=null&&Boolean.TRUE.equals(last.get("final"));
  if(priorFinal&&finished){
   // Keep the incoming words too; never present this uncertain boundary as complete.
   Map<String,Object> next=copy();List<Object> retained=WireJson.list(next.get("segments"));
   if(count<64){retained.add(WireJson.object("index",count+1,"revision",1,"text",fullText,"final",false));
    try{validate(next);}catch(IllegalArgumentException tooLong){fault("VOICE_RESULT_INCOMPLETE",now);return false;}
   }
   next.put("error","VOICE_SEGMENT_BOUNDARY_UNCERTAIN");next.put("phase","STOPPING");if(number("stop_at")==0)next.put("stop_at",now);save(next);return false;
  }
  int index=last==null||priorFinal?count+1:count;
  long revision=last==null||priorFinal?1:TaskWire.positive(last.get("revision"))+1;
  if(last!=null&&!priorFinal&&!finished&&fullText.equals(last.get("text")))return true;
  return result(token,peer,generation,index,revision,fullText,finished,now);
 }
 public synchronized boolean failed(String token,String peer,long generation,String code,long now)throws Exception{
  if(!owned(token,peer,generation)||!needsStop())return false;
  TaskWire.require(code!=null&&code.matches("VOICE_[A-Z_]{1,50}"),"VOICE_ERROR_INVALID");if(string("error").isEmpty())fault(code,now);return true;
 }
 /** Called only after the owned native task accepted stop and returned a terminal state,
  * and all preceding callbacks have drained. Physical mic stop remains a separate proof. */
 public synchronized boolean engineSealed(String token,boolean terminal,long now)throws Exception{
  if(!healthy||!token().equals(token)||!needsStop()||!terminal)return false;
  Map<String,Object> next=copy();next.put("phase","STOPPING");if(number("stop_at")==0)next.put("stop_at",now);next.put("engine_end",true);next.put("engine_stopped",true);save(next);return true;
 }
 public boolean stop(String token,long now,boolean cancel)throws Exception{
  revokeOpening(token);synchronized(this){
   if(!healthy||!token().equals(token)||!needsStop())return false;Map<String,Object> next=copy();next.put("phase","STOPPING");if(number("stop_at")==0)next.put("stop_at",now);next.put("cancelled",flag("cancelled")||cancel);save(next);return true;
  }
 }
 public synchronized boolean stopSubmitted(String token,String peer,long generation,long now)throws Exception{
  if(!owned(token,peer,generation)||!needsStop()||number("stop_at")==0||now<number("stop_at"))return false;Map<String,Object> next=copy();next.put("stop_sent",now);next.put("device_stopped",false);save(next);probe=null;return true;
 }
 public synchronized boolean resumeCleanup(String peer,long generation,long now)throws Exception{
  if(!healthy||!needsStop()||!TaskWire.set("STOPPING","RECOVERY").contains(phase())||peer==null||!string("peer").equals(FixedPeerHash.of(peer))||generation<=0||now<=0)return false;
  Map<String,Object> next=copy();next.put("generation",generation);next.put("phase","STOPPING");next.put("stop_at",now);next.put("stop_sent",0);next.put("device_stopped",false);save(next);probe=null;return true;
 }
 public synchronized boolean engineEnd(String token,long now)throws Exception{
  if(!healthy||!token().equals(token)||!needsStop())return false;stop(token,now,false);Map<String,Object> next=copy();next.put("engine_end",true);save(next);return true;
 }
 synchronized boolean engineStopped(String token,boolean stopped)throws Exception{
  if(!healthy||!token().equals(token)||!needsStop())return false;Map<String,Object> next=copy();next.put("engine_stopped",stopped);save(next);return true;
 }
 public synchronized StopProbe probeStop(String peer,long generation,long now){if(!healthy||!needsStop()||!owned(token(),peer,generation)||number("stop_sent")==0||now<number("stop_sent"))return null;probe=new StopProbe(this,now,number("generation"),token(),string("peer"));return probe;}
 public synchronized boolean deviceIdle(StopProbe check,String peer,long generation,long now,boolean micIdle)throws Exception{
  if(check==null||check!=probe||check.owner!=this||!owned(check.token,peer,generation)||!check.peer.equals(string("peer"))||check.generation!=generation||now<check.issued||now-check.issued>8000)return false;probe=null;
  Map<String,Object> next=copy();next.put("device_stopped",micIdle);save(next);return micIdle;
 }
 /** True when the capture was ended by its own time limit, not by the wearer or an error. */
 synchronized boolean timeLimited(){return healthy&&number("deadline")>0&&number("stop_at")==number("deadline");}
 public synchronized boolean finish()throws Exception{
  if(!healthy||!needsStop()||!flag("engine_end")||!flag("engine_stopped")||!flag("device_stopped"))return false;
  Map<String,Object> next=copy();next.put("needs_stop",false);
  // 2026-10-23 (user): "已说内容照常进入确认流程". A stop that leaves the last sentence unfinalised
  // (the time limit, or the engine ending ~0.1 s after a stop, seen with a 40 s answer) keeps the words
  // recognised at that moment and goes to REVIEW, where the wearer still confirms or edits before
  // anything is saved. Errors, uncertain sentence boundaries (both set error) and a cancel still end
  // INCOMPLETE or CANCELLED.
  if(!flag("cancelled")&&string("error").isEmpty()&&!transcript().trim().isEmpty()){
   List<Object> segments=WireJson.list(next.get("segments"));
   for(int i=0;i<segments.size();i++){Map<String,Object> segment=WireJson.map(segments.get(i));if(!Boolean.TRUE.equals(segment.get("final"))){segment.put("final",true);segment.put("revision",TaskWire.positive(segment.get("revision"))+1);}}
  }
next.put("phase",flag("cancelled")?"CANCELLED":string("error").isEmpty()&&allFinal(next)&&!transcript().trim().isEmpty()?"REVIEW":"INCOMPLETE");save(next);return true;
 }
 // A stop forced by the time limit is stamped with the deadline itself, so finish() can tell it apart
 // from a wearer stop, a lost link or a restart cleanup (resumeCleanup stamps its own time).
 synchronized void tick(String peer,long generation,long now)throws Exception{if(!needsStop())return;boolean owner=owned(token(),peer,generation);if(owner&&now>=number("deadline"))stop(token(),number("deadline"),false);else if(!owner)stop(token(),now,false);}
 synchronized boolean edit(String completeText)throws Exception{
  if(!healthy||!phase().equals("REVIEW"))return false;TaskWire.require(!TaskWire.text(completeText,65536,false).trim().isEmpty(),"VOICE_TEXT_EMPTY");Map<String,Object> next=copy();next.put("edited",completeText);save(next);return true;
 }
 public boolean cancelDraft(long now)throws Exception{
  revokeOpening();synchronized(this){
   if(!healthy||TaskWire.set("IDLE","SUBMITTING","SAVED","CANCELLED").contains(phase()))return false;
   if(needsStop())return stop(token(),now,true);Map<String,Object> next=copy();next.put("cancelled",true);next.put("phase","CANCELLED");save(next);return true;
  }
 }
 /** SAVED means local durable outbox only; remote delivery/execution facts belong to TaskMailbox. */
 synchronized Map<String,Object> saveAnswer(TaskMailbox mailbox,Map<String,Object> fresh,Map<String,Object> parent,long wall)throws Exception{
  TaskWire.require(healthy&&TaskWire.set("REVIEW","SUBMITTING","SAVED").contains(phase()),"VOICE_ANSWER_NOT_READY");Map<String,Object> t=target(WireJson.map(state.get("target"))),original=WireJson.map(t.get("request"));TaskWire.require(mailbox.binding.equals(t.get("binding")),"VOICE_TARGET_CHANGED");
  if(phase().equals("REVIEW")){TaskWire.require(TaskWire.canAnswer(fresh,parent,wall)&&t.get("fingerprint").equals(TaskWire.requestFingerprint(fresh)),"VOICE_REQUEST_CHANGED");Map<String,Object> next=copy();next.put("phase","SUBMITTING");next.put("frozen_text",answerText());save(next);}
  String frozen=(String)state.get("frozen_text");Object option=null;Map<String,Object> body=TaskWire.body(original);
  // A dictated choice carries the option it names; derived from the frozen text, so replays agree.
  if("choice".equals(body.get("mode"))){List<Object> options=WireJson.list(body.get("options"));int i=VoiceOption.index(frozen,options.size());if(i>=0)option=WireJson.map(options.get(i)).get("option_id");}
  Map<String,Object> result=mailbox.draftAnswer(operation(),(String)original.get("object_id"),TaskWire.positive(original.get("revision")),option,frozen,"voice",(String)t.get("fingerprint"),wall);
  Map<String,Object> next=copy();next.put("phase","SAVED");save(next);return result;
 }
}
