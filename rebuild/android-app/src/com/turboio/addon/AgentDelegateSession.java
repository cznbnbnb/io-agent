package com.turboio.addon;

import java.nio.charset.StandardCharsets;
import java.util.*;

/** A new, wearer-initiated task draft; deliberately not a reply to a server request.
 * No microphone, wake hook, ASR, clock or network is owned here. The capture runtime
 * must enforce its independent stop deadline and call captureReleased only after its
 * own physical-stop/resource-release evidence. A text deadline is not stop evidence.
 * One runtime owner must retain this instance for repeated wake events. */
final class AgentDelegateSession {
 interface Store {Object read()throws Exception;void save(Object value)throws Exception;}
 enum TargetStatus {AVAILABLE,BUSY,OFFLINE,UNSUPPORTED}
 static final long CAPTURE_MILLIS=60000,COMMAND_MILLIS=3600000;
 private static final String FORMAT="io-agent-delegate-draft/1";
 private static final Set<String> PHASES=TaskWire.set("IDLE","PREPARED","LISTENING","STOPPING","RECOVERY","REVIEW","CANCELLED","SUBMITTING","QUEUED");
 private final Store store;private Map<String,Object> state;private boolean healthy=true;

 AgentDelegateSession(Store store){
  if(store==null)throw new IllegalArgumentException("DELEGATE_STORE_REQUIRED");this.store=store;
  try{
   Object raw=store.read();state=raw==null?empty():WireJson.map(WireJson.copy(raw));validate(state);
   // Elapsed time cannot be carried across a process/reboot as capture permission.
   // Preserve the obligation and text, but never resume or submit interrupted capture.
   if(flag("capture_pending")){Map<String,Object> next=copy();next.put("phase","RECOVERY");next.put("cancelled",true);save(next);}
  }catch(Exception invalid){healthy=false;if(state==null)state=empty();}
 }
 private static Map<String,Object> empty(){return WireJson.object("format",FORMAT,"phase","IDLE","target",null,"operation","","text","","text_revision",0,"started_elapsed",0,"deadline_elapsed",0,"last_elapsed",0,"capture_end_elapsed",0,"final_captured_through",0,"capture_pending",false,"cancelled",false,"time_limited",false,"confirmed_at",0,"expires_at",0,"confirmed_fingerprint","","admission_attempted",false);}
 private Map<String,Object> copy(){return WireJson.map(WireJson.copy(state));}
 private String string(String key){return (String)state.get(key);}
 private long number(String key){return TaskWire.nonnegative(state.get(key));}
 private boolean flag(String key){return Boolean.TRUE.equals(state.get(key));}
 private void requireHealthy(){TaskWire.require(healthy,"DELEGATE_STORE_UNCERTAIN");}
 private void owned(String operation){requireHealthy();TaskWire.require(!"IDLE".equals(string("phase"))&&string("operation").equals(operation),"DELEGATE_OPERATION_CHANGED");}
 private void save(Map<String,Object> next)throws Exception{
  validate(next);try{store.save(next);}catch(Exception failure){healthy=false;throw failure;}state=next;
 }
 private static String binding(Map<String,Object> target){return TaskWire.hash(WireJson.bytes(WireJson.object("base",target.get("base"),"owner",target.get("owner"),"producer",target.get("producer"),"server",target.get("server"),"route",target.get("route"))));}
 private static Map<String,Object> target(TaskConnection c){return WireJson.object("kind","delegate","binding",c.binding(),"base",c.base,"owner",c.owner,"producer",c.producer,"server",c.server,"route",c.route());}
 private static Map<String,Object> validateTarget(Object raw){
  Map<String,Object> t=WireJson.map(raw);BoundedJson.keys(t,"kind","binding","base","owner","producer","server","route");
  TaskWire.require("delegate".equals(t.get("kind")),"DELEGATE_TARGET_INVALID");
  for(String key:new String[]{"base","owner","producer","server"})TaskWire.text(t.get(key),2048,false);
  TaskWire.route(t.get("route"));for(Object part:WireJson.map(t.get("route")).values())TaskWire.require(((String)part).matches("[A-Za-z0-9_.-]{1,128}"),"DELEGATE_TARGET_INVALID");
  TaskWire.require(binding(t).equals(t.get("binding")),"DELEGATE_TARGET_INVALID");return t;
 }
 private static void validate(Map<String,Object> s){
  BoundedJson.keys(s,"format","phase","target","operation","text","text_revision","started_elapsed","deadline_elapsed","last_elapsed","capture_end_elapsed","final_captured_through","capture_pending","cancelled","time_limited","confirmed_at","expires_at","confirmed_fingerprint","admission_attempted");
  TaskWire.require(FORMAT.equals(s.get("format"))&&PHASES.contains(s.get("phase")),"DELEGATE_STORE_INVALID");
  String phase=(String)s.get("phase");TaskWire.text(s.get("text"),65536,true);
  for(String key:new String[]{"text_revision","started_elapsed","deadline_elapsed","last_elapsed","capture_end_elapsed","final_captured_through","confirmed_at","expires_at"})TaskWire.nonnegative(s.get(key));
  for(String key:new String[]{"capture_pending","cancelled","time_limited","admission_attempted"})TaskWire.require(s.get(key) instanceof Boolean,"DELEGATE_STORE_INVALID");
  String op=TaskWire.text(s.get("operation"),128,true),fingerprint=TaskWire.text(s.get("confirmed_fingerprint"),64,true);
  if("IDLE".equals(phase)){TaskWire.require(TaskWire.same(s,empty()),"DELEGATE_STORE_INVALID");return;}
  validateTarget(s.get("target"));TaskWire.require(op.matches("agent-delegate-[a-f0-9]{32}"),"DELEGATE_OPERATION_INVALID");
  long start=TaskWire.nonnegative(s.get("started_elapsed")),deadline=TaskWire.nonnegative(s.get("deadline_elapsed")),last=TaskWire.nonnegative(s.get("last_elapsed"));
  long end=TaskWire.nonnegative(s.get("capture_end_elapsed")),drained=TaskWire.nonnegative(s.get("final_captured_through"));
  boolean pending=Boolean.TRUE.equals(s.get("capture_pending")),cancelled=Boolean.TRUE.equals(s.get("cancelled"));
  TaskWire.require(pending==TaskWire.set("LISTENING","STOPPING","RECOVERY").contains(phase),"DELEGATE_CAPTURE_STATE_INVALID");
  if(start==0)TaskWire.require(deadline==0&&last==0&&end==0&&drained==0&&TaskWire.set("PREPARED","CANCELLED").contains(phase),"DELEGATE_CAPTURE_STATE_INVALID");
  else TaskWire.require(deadline-start==CAPTURE_MILLIS&&last>=start,"DELEGATE_CAPTURE_STATE_INVALID");
  if(end>0)TaskWire.require(end>=start&&end<=deadline&&end<=last,"DELEGATE_CAPTURE_STATE_INVALID");
  if(drained>0)TaskWire.require(end>0&&drained>=start&&drained<=end&&TaskWire.set("STOPPING","RECOVERY","REVIEW","CANCELLED","SUBMITTING","QUEUED").contains(phase),"DELEGATE_CAPTURE_STATE_INVALID");
  if(TaskWire.set("REVIEW","SUBMITTING","QUEUED").contains(phase))TaskWire.require(end>0,"DELEGATE_CAPTURE_STATE_INVALID");
  if("PREPARED".equals(phase))TaskWire.require(start==0&&((String)s.get("text")).isEmpty()&&TaskWire.nonnegative(s.get("text_revision"))==0&&!Boolean.TRUE.equals(s.get("time_limited")),"DELEGATE_CAPTURE_STATE_INVALID");
  if("LISTENING".equals(phase))TaskWire.require(last<deadline&&end==0&&drained==0&&!Boolean.TRUE.equals(s.get("time_limited")),"DELEGATE_CAPTURE_STATE_INVALID");
  TaskWire.require(!cancelled||TaskWire.set("STOPPING","RECOVERY","CANCELLED").contains(phase),"DELEGATE_CAPTURE_STATE_INVALID");
  if(TaskWire.set("RECOVERY","CANCELLED").contains(phase))TaskWire.require(cancelled,"DELEGATE_CAPTURE_STATE_INVALID");
  boolean confirmed=TaskWire.set("SUBMITTING","QUEUED").contains(phase);
  if(confirmed){
   long created=TaskWire.positive(s.get("confirmed_at")),expires=TaskWire.positive(s.get("expires_at"));
   TaskWire.require(expires>created&&expires-created<=COMMAND_MILLIS&&!((String)s.get("text")).trim().isEmpty()&&fingerprint.equals(fingerprint(s)),"DELEGATE_CONFIRMATION_INVALID");
   event(s); // Check the actual mailbox envelope's byte budget, not just characters.
  }else TaskWire.require(TaskWire.nonnegative(s.get("confirmed_at"))==0&&TaskWire.nonnegative(s.get("expires_at"))==0&&fingerprint.isEmpty()&&!Boolean.TRUE.equals(s.get("admission_attempted")),"DELEGATE_CONFIRMATION_INVALID");
  if("QUEUED".equals(phase))TaskWire.require(Boolean.TRUE.equals(s.get("admission_attempted")),"DELEGATE_CONFIRMATION_INVALID");
  TaskWire.require(WireJson.bytes(s).length<=524288,"DELEGATE_STORE_BUDGET");
 }
 private static String fingerprint(Map<String,Object> s){return TaskWire.hash(WireJson.bytes(WireJson.object("operation",s.get("operation"),"target",s.get("target"),"revision",s.get("text_revision"),"text",s.get("text"))));}
 private static Map<String,Object> event(Map<String,Object> s){
  Map<String,Object> t=WireJson.map(s.get("target"));String stable=TaskWire.hash((t.get("binding")+"/"+s.get("operation")).getBytes(StandardCharsets.UTF_8));
  return TaskWire.envelope("task",(String)t.get("producer"),WireJson.object("task_id","task-android-"+stable,"revision",1,"route",WireJson.copy(t.get("route")),"state","queued","command",s.get("text"),"allow_create_session",false),stable,TaskWire.positive(s.get("confirmed_at")),TaskWire.positive(s.get("expires_at")));
 }
 synchronized boolean healthy(){return healthy;}
 synchronized String phase(){return healthy?string("phase"):"BLOCKED";}
 synchronized String operation(){return healthy?string("operation"):"";}
 synchronized String text(){return healthy?string("text"):"";}
 synchronized boolean needsCaptureRelease(){return !healthy||flag("capture_pending");}
 synchronized Object snapshot(){requireHealthy();return WireJson.copy(state);}
 synchronized String reviewFingerprint(){requireHealthy();TaskWire.require("REVIEW".equals(string("phase")),"DELEGATE_NOT_REVIEWABLE");return fingerprint(state);}
 /** Release only a finished local draft. A queued task remains owned by the
  * mailbox; an unknown admission must be reconciled before this can be cleared. */
 synchronized boolean clearFinished(String operation)throws Exception{
  owned(operation);if(flag("capture_pending")||!TaskWire.set("QUEUED","CANCELLED").contains(string("phase")))return false;
  save(empty());return true;
 }
 /** Immutable identity for reconciliation, never authorization to bypass the
  * mailbox's lookup/receipt rules or to send a different task. */
 synchronized Map<String,Object> confirmedEvent(){
  requireHealthy();TaskWire.require(TaskWire.set("SUBMITTING","QUEUED").contains(string("phase")),"DELEGATE_NOT_CONFIRMED");return event(state);
 }

 /** Capture the selected target once. Repeated wakes must reuse this owner, not
  * create new sessions. No credentials are copied into the draft. */
 synchronized boolean prepare(TaskProfiles profiles,long wall,String defaultBinding,TargetStatus status)throws Exception{
  requireHealthy();if(!"IDLE".equals(string("phase")))return false;
  // The authoritative shared default is separate from the old question profile
  // selection. The runtime supplies the exact binding after a fresh directory
  // check; never infer it from the most recently imported/selected question.
  TaskWire.positive(wall);TaskWire.require(profiles!=null&&defaultBinding!=null&&!defaultBinding.isEmpty(),"DELEGATE_DEFAULT_MISSING");
  TaskProfiles.Profile selected=profiles.get(defaultBinding);
  TaskWire.require(selected.enabled,"TASK_PAUSED");TaskWire.require(selected.connection.expiresAt>wall,"TASK_IMPORT_EXPIRED");
  TaskWire.require(status==TargetStatus.AVAILABLE||status==TargetStatus.BUSY,status==TargetStatus.OFFLINE?"DELEGATE_TARGET_OFFLINE":"DELEGATE_TARGET_UNSUPPORTED");
  Map<String,Object> next=empty();next.put("phase","PREPARED");next.put("target",target(selected.connection));next.put("operation","agent-delegate-"+UUID.randomUUID().toString().replace("-",""));save(next);return true;
 }
 /** Called only when the real capture adapter has armed its independent cutoff. */
 synchronized boolean begin(String operation,long elapsed)throws Exception{
  owned(operation);if(!"PREPARED".equals(string("phase")))return false;TaskWire.positive(elapsed);
  Map<String,Object> next=copy();next.put("phase","LISTENING");next.put("started_elapsed",elapsed);next.put("deadline_elapsed",Math.addExact(elapsed,CAPTURE_MILLIS));next.put("last_elapsed",elapsed);next.put("capture_pending",true);save(next);return true;
 }
 /** Complete, revisioned text from an owning capture adapter, never raw stock
  * ASR callbacks. observedElapsed is monotonic callback-observation time, NOT an
  * audio watermark. Before cutoff it updates the visible draft. After stopping,
  * the owner's finalTranscript can drain already-captured audio into the draft. */
 synchronized boolean transcript(String operation,long revision,String text,long observedElapsed)throws Exception{
  owned(operation);if(!"LISTENING".equals(string("phase")))return false;
  TaskWire.positive(observedElapsed);TaskWire.require(observedElapsed>=number("last_elapsed"),"DELEGATE_STALE_CAPTURE");
  if(observedElapsed>=number("deadline_elapsed")){stop(operation,observedElapsed,false);return false;}
  TaskWire.positive(revision);TaskWire.text(text,65536,true);
  if(revision==number("text_revision")){TaskWire.require(text.equals(string("text")),"DELEGATE_TRANSCRIPT_CONFLICT");return true;}
  TaskWire.require(revision==number("text_revision")+1,"DELEGATE_STALE_TRANSCRIPT");
  Map<String,Object> next=copy();next.put("text",text);next.put("text_revision",revision);next.put("last_elapsed",observedElapsed);save(next);return true;
 }
 /** Drain the owning ASR engine after it has terminated, before captureReleased.
  * This is the complete final text of audio already captured through the supplied
  * watermark, not permission to collect more audio. The trusted adapter must
  * derive that watermark from its capture boundary; this numeric input is not
  * physical-stop/ASR-termination evidence. It must not be a guessed callback time.
  * One final revision is accepted; exact repeats are idempotent. */
 synchronized boolean finalTranscript(String operation,long revision,String text,long capturedThroughElapsed)throws Exception{
  owned(operation);if(!"STOPPING".equals(string("phase"))||flag("cancelled"))return false;
  TaskWire.positive(revision);TaskWire.text(text,65536,true);TaskWire.positive(capturedThroughElapsed);
  TaskWire.require(capturedThroughElapsed>=number("started_elapsed")&&capturedThroughElapsed<=number("capture_end_elapsed")&&capturedThroughElapsed<=number("deadline_elapsed"),"DELEGATE_CAPTURE_WATERMARK_INVALID");
  if(number("final_captured_through")>0){TaskWire.require(revision==number("text_revision")&&text.equals(string("text"))&&capturedThroughElapsed==number("final_captured_through"),"DELEGATE_FINAL_TRANSCRIPT_CONFLICT");return true;}
  TaskWire.require(revision==number("text_revision")||revision==number("text_revision")+1,"DELEGATE_STALE_TRANSCRIPT");
  if(revision==number("text_revision"))TaskWire.require(text.equals(string("text")),"DELEGATE_TRANSCRIPT_CONFLICT");
  Map<String,Object> next=copy();next.put("text",text);next.put("text_revision",revision);next.put("final_captured_through",capturedThroughElapsed);save(next);return true;
 }
 synchronized boolean tick(String operation,long elapsed)throws Exception{
  owned(operation);if(!"LISTENING".equals(string("phase"))||elapsed<number("deadline_elapsed"))return false;return stop(operation,elapsed,false);
 }
 synchronized boolean stop(String operation,long elapsed,boolean cancel)throws Exception{
  owned(operation);String phase=string("phase");if(TaskWire.set("QUEUED","CANCELLED").contains(phase))return false;
  // Confirmation may be waiting for an available target without ever touching
  // the mailbox. That known-unsent draft can still be cancelled. Once admission
  // was attempted, only reconciliation may release its uncertain responsibility.
  if("SUBMITTING".equals(phase)){
   if(!cancel||flag("admission_attempted"))return false;Map<String,Object> next=copy();next.put("phase","CANCELLED");next.put("cancelled",true);next.put("confirmed_at",0);next.put("expires_at",0);next.put("confirmed_fingerprint","");save(next);return true;
  }
  if("PREPARED".equals(phase)||"REVIEW".equals(phase)){
   if(!cancel)return false;Map<String,Object> next=copy();next.put("cancelled",true);next.put("phase","CANCELLED");save(next);return true;
  }
  TaskWire.require(elapsed>=number("last_elapsed"),"DELEGATE_STALE_CAPTURE");Map<String,Object> next=copy();
  if("LISTENING".equals(phase))next.put("capture_end_elapsed",Math.min(elapsed,number("deadline_elapsed")));
  if(!"RECOVERY".equals(phase))next.put("phase","STOPPING");next.put("cancelled",cancel||flag("cancelled"));next.put("last_elapsed",elapsed);
  next.put("time_limited",flag("time_limited")||elapsed>=number("deadline_elapsed"));save(next);return true;
 }
 /** An input from the capture owner, not proof generated by this text core.
  * Must follow real physical stop, ASR termination and resource release. */
 synchronized boolean captureReleased(String operation)throws Exception{
  owned(operation);if(!TaskWire.set("STOPPING","RECOVERY").contains(string("phase")))return false;
  Map<String,Object> next=copy();next.put("capture_pending",false);next.put("phase",flag("cancelled")?"CANCELLED":"REVIEW");save(next);return true;
 }
 synchronized boolean edit(String operation,String text)throws Exception{
  owned(operation);if(!"REVIEW".equals(string("phase")))return false;TaskWire.text(text,65536,true);
  if(text.equals(string("text")))return true;Map<String,Object> next=copy();next.put("text",text);next.put("text_revision",number("text_revision")+1);save(next);return true;
 }
 private TaskConnection available(TaskProfiles profiles,long wall,TargetStatus status){
  Map<String,Object> t=WireJson.map(state.get("target"));TaskProfiles.Profile p=profiles.get((String)t.get("binding"));
  TaskWire.require(TaskWire.same(target(p.connection),t),"DELEGATE_TARGET_CHANGED");TaskWire.require(p.enabled,"TASK_PAUSED");TaskWire.require(p.connection.expiresAt>wall,"TASK_IMPORT_EXPIRED");
  TaskWire.require(status==TargetStatus.AVAILABLE||status==TargetStatus.BUSY,status==TargetStatus.OFFLINE?"DELEGATE_TARGET_OFFLINE":"DELEGATE_TARGET_UNSUPPORTED");return p.connection;
 }
 /** A confirmation names the exact review, not whatever text/default is current.
  * BUSY admits a queued task; it does not imply interruption of another turn. */
 synchronized boolean confirm(TaskProfiles profiles,String operation,String expectedFingerprint,long wall,TargetStatus status)throws Exception{
  owned(operation);TaskWire.require(fingerprint(state).equals(expectedFingerprint),"DELEGATE_REVIEW_CHANGED");
  if(TaskWire.set("SUBMITTING","QUEUED").contains(string("phase")))return true;
  TaskWire.require("REVIEW".equals(string("phase"))&&!flag("capture_pending")&&!string("text").trim().isEmpty(),"DELEGATE_NOT_REVIEWABLE");
  TaskSessionDirectory.command(string("text"));
  TaskWire.positive(wall);TaskConnection connection=available(profiles,wall,status);Map<String,Object> next=copy();next.put("phase","SUBMITTING");next.put("confirmed_at",wall);next.put("expires_at",Math.min(Math.addExact(wall,COMMAND_MILLIS),connection.expiresAt));next.put("confirmed_fingerprint",expectedFingerprint);save(next);return true;
 }
 /** Local mailbox admission only, never a computer/server receipt. A lost result
  * is reconciled against the exact operation before attempting a fresh enqueue.
  * The mailbox owner must have exclusive process ownership (AtomicDocument).
  * Paused/offline targets can reconcile an existing row but cannot add a new one.
  * TaskMailbox.pending currently retains every durable outbox row. A missing row
  * after an attempted admission is ambiguous (lost save/reset/future pruning),
  * not evidence of non-admission: only the exact existing row can resolve it. */
 synchronized Map<String,Object> enqueue(String operation,TaskMailbox mailbox,TaskProfiles profiles,long wall,TargetStatus status)throws Exception{
  owned(operation);TaskWire.require(TaskWire.set("SUBMITTING","QUEUED").contains(string("phase")),"DELEGATE_NOT_CONFIRMED");
  TaskWire.require(mailbox!=null&&WireJson.map(state.get("target")).get("binding").equals(mailbox.binding),"DELEGATE_TARGET_CHANGED");
  Map<String,Object> expected=event(state),row=null;
  for(Object raw:mailbox.pending()){Map<String,Object> candidate=WireJson.map(raw);if(string("operation").equals(candidate.get("operation_id"))){row=candidate;break;}}
  if(row==null){
   // QUEUED is positive evidence that the mailbox already admitted it. Absence
   // after pruning/reset must never replay the same command as new work.
   TaskWire.require(!"QUEUED".equals(string("phase")),"DELEGATE_MAILBOX_RECEIPT_MISSING");
   TaskWire.require(!flag("admission_attempted"),"DELEGATE_ADMISSION_UNKNOWN");
   TaskWire.positive(wall);TaskWire.require(wall<number("expires_at"),"DELEGATE_COMMAND_EXPIRED");available(profiles,wall,status);
   Map<String,Object> next=copy();next.put("admission_attempted",true);save(next);
   row=mailbox.delegate(string("operation"),string("text"),number("confirmed_at"),number("expires_at"));
  }
  Map<String,Object> actual=WireJson.map(WireJson.read(((String)row.get("payload")).getBytes(StandardCharsets.UTF_8)));
  TaskWire.require(TaskWire.same(expected,actual),"DELEGATE_OPERATION_CONFLICT");
  if(!"QUEUED".equals(string("phase"))){Map<String,Object> next=copy();next.put("phase","QUEUED");next.put("admission_attempted",true);save(next);}return WireJson.map(WireJson.copy(row));
 }
}
