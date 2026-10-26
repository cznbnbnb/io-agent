package com.turboio.addon;

import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.*;

/** Production draft + real durable mailbox, with synthetic text/release events.
 * No microphone, glasses, network or real host execution is exercised. */
public final class AgentDelegateSessionTest {
 static int checks;static final long NOW=TaskConnection.stamp("2026-10-25T10:00:00Z");
 static final String TEXT="请整理今天的讨论。\n保留原文和原音，不发送任何消息。";
 interface Work {void run()throws Exception;}
 static void yes(boolean value){checks++;if(!value)throw new AssertionError("delegate assertion "+checks);}
 static void rejects(String code,Work work)throws Exception{checks++;try{work.run();}catch(Exception expected){if(code==null||code.equals(expected.getMessage()))return;throw new AssertionError("expected "+code+", got "+expected,expected);}throw new AssertionError("expected rejection "+code+" at "+checks);}
 static Map<String,Object> map(Object value){return WireJson.map(value);}
 static final class Memory implements AgentDelegateSession.Store {
  Object value;String failPhase="";boolean failAfterCommit;int writes;
  public Object read(){return value==null?null:WireJson.copy(value);}
  public void save(Object next)throws IOException{
   writes++;boolean fail=failPhase.equals(map(next).get("phase"));if(fail&&!failAfterCommit){failPhase="";throw new IOException("SYNTHETIC_SAVE_LOST");}
   value=WireJson.copy(next);if(fail){failPhase="";throw new IOException("SYNTHETIC_SAVE_LOST");}
  }
 }
 static TaskConnection connection(String agent,String session){
  Map<String,Object> m=WireJson.object("format",TaskConnection.FORMAT,"base_url","https://synthetic.invalid/io-api/v1","owner_id","synthetic-owner","producer_id","synthetic-phone","server_id","synthetic-server","computer_id","synthetic-computer","agent_id",agent,"project_id","synthetic-project","session_id",session,"token","AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA","token_id","c0ffee00-0000-4000-8000-000000000001","expires_at","2026-10-26T10:00:00Z");return TaskConnection.parse(WireJson.bytes(m),NOW);
 }
 static final TaskConnection CODEX=connection("codex","existing-codex"),CLAUDE=connection("claude","existing-claude");
 static TaskProfiles profiles(){return TaskProfiles.empty().upsert(CODEX,true,NOW).upsert(CLAUDE,true,NOW,false);}
 static AgentDelegateSession prepared(Memory memory)throws Exception{AgentDelegateSession s=new AgentDelegateSession(memory);yes(s.healthy()&&s.phase().equals("IDLE"));yes(s.prepare(profiles(),NOW,CODEX.binding(),AgentDelegateSession.TargetStatus.AVAILABLE));return s;}
 static AgentDelegateSession review(Memory memory)throws Exception{
  AgentDelegateSession s=prepared(memory);String op=s.operation();yes(s.begin(op,1000));yes(s.transcript(op,1,TEXT,1001));yes(s.stop(op,2000,false));yes(s.needsCaptureRelease());yes(s.captureReleased(op));yes(s.phase().equals("REVIEW")&&!s.needsCaptureRelease());return s;
 }
 static Map<String,Object> event(Map<String,Object> row){return map(WireJson.read(((String)row.get("payload")).getBytes(StandardCharsets.UTF_8)));}
 static void verifyTask(AgentDelegateSession s,Map<String,Object> row){
  Map<String,Object> e=event(row),b=TaskWire.body(e);yes("task".equals(e.get("kind")));yes(s.operation().equals(row.get("operation_id")));yes(TaskWire.same(b.get("route"),CODEX.route()));yes(TEXT.equals(b.get("command")));yes(Boolean.FALSE.equals(b.get("allow_create_session")));yes(!b.containsKey("request_id")&&!b.containsKey("input_source"));
 }
 static void frozenTarget(File root)throws Exception{
  Memory memory=new Memory();AgentDelegateSession s=review(memory);String op=s.operation();TaskProfiles changed=profiles().select(CLAUDE.binding());
  yes(!s.prepare(changed,NOW+1,CLAUDE.binding(),AgentDelegateSession.TargetStatus.AVAILABLE)&&op.equals(s.operation()));yes(!s.begin(op,3000));
  String saved=new String(WireJson.bytes(memory.value),StandardCharsets.UTF_8);yes(!saved.contains(CODEX.token())&&!saved.contains("token_id")&&!saved.contains("request_id"));
  Map<String,Object> exposed=map(s.snapshot());map(map(exposed.get("target")).get("route")).put("session_id","wrong");yes(TaskWire.same(map(map(s.snapshot()).get("target")).get("route"),CODEX.route()));
  yes(s.confirm(changed,op,s.reviewFingerprint(),NOW+2,AgentDelegateSession.TargetStatus.BUSY));
  try(TaskMailbox correct=new TaskMailbox(new File(root,"frozen"),CODEX);TaskMailbox wrong=new TaskMailbox(new File(root,"frozen"),CLAUDE)){
   rejects("DELEGATE_TARGET_CHANGED",()->s.enqueue(s.operation(),wrong,changed,NOW+3,AgentDelegateSession.TargetStatus.AVAILABLE));yes(wrong.pending().isEmpty());
   Map<String,Object> row=s.enqueue(s.operation(),correct,changed,NOW+3,AgentDelegateSession.TargetStatus.BUSY);verifyTask(s,row);yes(s.phase().equals("QUEUED")&&"queued".equals(row.get("state"))&&correct.pending().size()==1);
   String bytes=(String)row.get("payload");for(int i=0;i<3;i++)yes(bytes.equals(s.enqueue(s.operation(),correct,changed,NOW+4+i,AgentDelegateSession.TargetStatus.AVAILABLE).get("payload")));yes(correct.pending().size()==1);
  }
 }
 static void captureBoundaries()throws Exception{
  AgentDelegateSession s=prepared(new Memory());String op=s.operation();yes(s.begin(op,1000));
  rejects("DELEGATE_OPERATION_CHANGED",()->s.transcript("another",1,TEXT,1001));yes(s.transcript(op,1,TEXT,1001));yes(s.transcript(op,1,TEXT,1001));
  rejects("DELEGATE_TRANSCRIPT_CONFLICT",()->s.transcript(op,1,"different",1002));rejects("DELEGATE_STALE_TRANSCRIPT",()->s.transcript(op,3,TEXT,1002));rejects("DELEGATE_STALE_CAPTURE",()->s.transcript(op,2,TEXT,999));
  yes(!s.captureReleased(op));rejects("DELEGATE_OPERATION_CHANGED",()->s.captureReleased("unrelated"));yes(!s.tick(op,60999));yes(s.tick(op,61000));rejects("DELEGATE_NOT_REVIEWABLE",s::reviewFingerprint);yes(!s.transcript(op,2,"late",61001));yes(s.captureReleased(op));yes(s.phase().equals("REVIEW")&&s.text().equals(TEXT));
  String old=s.reviewFingerprint();yes(s.edit(op,TEXT+"\n补充条件"));rejects("DELEGATE_REVIEW_CHANGED",()->s.confirm(profiles(),op,old,NOW,AgentDelegateSession.TargetStatus.AVAILABLE));
  yes(s.edit(op,TEXT));String current=s.reviewFingerprint();yes(!old.equals(current));yes(s.confirm(profiles(),op,current,NOW,AgentDelegateSession.TargetStatus.AVAILABLE));yes(s.confirm(profiles(),op,current,NOW+1,AgentDelegateSession.TargetStatus.AVAILABLE));yes(!s.edit(op,"changed")&&!s.stop(op,62000,false));
  AgentDelegateSession empty=prepared(new Memory());String emptyOp=empty.operation();yes(empty.begin(emptyOp,1));yes(empty.stop(emptyOp,2,false));yes(empty.captureReleased(emptyOp));rejects("DELEGATE_NOT_REVIEWABLE",()->empty.confirm(profiles(),emptyOp,empty.reviewFingerprint(),NOW,AgentDelegateSession.TargetStatus.AVAILABLE));
 }
 static void finalDrain()throws Exception{
  for(boolean timeout:new boolean[]{false,true}){
   AgentDelegateSession s=prepared(new Memory());String op=s.operation();long cutoff=timeout?61000:2000;yes(s.begin(op,1000));yes(s.transcript(op,1,"整理今天",cutoff-10));yes(!s.finalTranscript(op,2,"录音中不能终结",cutoff-5));
   yes(timeout?s.tick(op,cutoff):s.stop(op,cutoff,false));yes(s.phase().equals("STOPPING")&&s.needsCaptureRelease());yes(!s.transcript(op,2,"普通回调不能越过截止",cutoff+200));
   rejects("DELEGATE_OPERATION_CHANGED",()->s.finalTranscript("old-operation",2,TEXT,cutoff));rejects("DELEGATE_CAPTURE_WATERMARK_INVALID",()->s.finalTranscript(op,2,TEXT,999));rejects("DELEGATE_CAPTURE_WATERMARK_INVALID",()->s.finalTranscript(op,2,TEXT,cutoff+1));
   rejects("DELEGATE_STALE_TRANSCRIPT",()->s.finalTranscript(op,3,TEXT,cutoff));rejects("DELEGATE_TRANSCRIPT_CONFLICT",()->s.finalTranscript(op,1,TEXT,cutoff));
   // The adapter has stopped ASR. Its late final contains words captured before
   // the fixed audio boundary; no callback-arrival time extends that boundary.
   yes(s.finalTranscript(op,2,TEXT,cutoff));yes(s.text().equals(TEXT)&&s.needsCaptureRelease());yes(s.finalTranscript(op,2,TEXT,cutoff));
   rejects("DELEGATE_FINAL_TRANSCRIPT_CONFLICT",()->s.finalTranscript(op,2,"冲突文本",cutoff));rejects("DELEGATE_FINAL_TRANSCRIPT_CONFLICT",()->s.finalTranscript(op,3,TEXT,cutoff));rejects("DELEGATE_FINAL_TRANSCRIPT_CONFLICT",()->s.finalTranscript(op,1,TEXT,cutoff));rejects("DELEGATE_FINAL_TRANSCRIPT_CONFLICT",()->s.finalTranscript(op,2,TEXT,cutoff-1));
   yes(s.captureReleased(op));yes(s.phase().equals("REVIEW")&&s.text().equals(TEXT)&&!s.needsCaptureRelease());yes(!s.finalTranscript(op,3,"释放后的旧回调",cutoff));yes(s.text().equals(TEXT));
  }
  AgentDelegateSession noPartial=prepared(new Memory());String op=noPartial.operation();yes(noPartial.begin(op,1000));yes(noPartial.tick(op,61500));yes(noPartial.finalTranscript(op,1,"截止前已说，终止引擎后才返回的首个结果",61000));yes(noPartial.captureReleased(op));yes(noPartial.text().contains("首个结果"));
  AgentDelegateSession same=prepared(new Memory());String sameOp=same.operation();yes(same.begin(sameOp,1000));yes(same.transcript(sameOp,1,TEXT,1500));yes(same.stop(sameOp,2000,false));yes(same.stop(sameOp,5000,false));
  rejects("DELEGATE_CAPTURE_WATERMARK_INVALID",()->same.finalTranscript(sameOp,2,"重复停止不能扩展采音",5000));yes(same.finalTranscript(sameOp,1,TEXT,2000));yes(same.captureReleased(sameOp));
  AgentDelegateSession delayed=prepared(new Memory());String delayedOp=delayed.operation();yes(delayed.begin(delayedOp,1000));yes(delayed.transcript(delayedOp,1,"已有",1990));yes(delayed.transcript(delayedOp,2,"已有部分",1995));yes(delayed.stop(delayedOp,2000,false));
  // A watermark names captured audio, not callback-arrival time. ASR may report
  // the partial at 1990 for audio ending at 1900; the final preserves that audio.
  rejects("DELEGATE_STALE_TRANSCRIPT",()->delayed.finalTranscript(delayedOp,1,"已有",1900));yes(delayed.finalTranscript(delayedOp,3,"已有部分及引擎排空后的尾句",1900));yes(delayed.captureReleased(delayedOp));yes(delayed.text().endsWith("尾句"));
  Memory cancelledMemory=new Memory();AgentDelegateSession cancelled=prepared(cancelledMemory);String cancelledOp=cancelled.operation();yes(cancelled.begin(cancelledOp,1000));yes(cancelled.transcript(cancelledOp,1,TEXT,1500));yes(cancelled.stop(cancelledOp,2000,true));yes(!cancelled.finalTranscript(cancelledOp,2,"取消后不能改稿",2000));
  AgentDelegateSession recovered=new AgentDelegateSession(cancelledMemory);yes(recovered.phase().equals("RECOVERY")&&!recovered.finalTranscript(cancelledOp,2,"恢复清理不能改稿",2000));yes(recovered.captureReleased(cancelledOp));yes(recovered.phase().equals("CANCELLED")&&recovered.text().equals(TEXT));
 }
 static void unavailableTargets(File root)throws Exception{
  AgentDelegateSession s=review(new Memory());String op=s.operation(),fp=s.reviewFingerprint();
  for(AgentDelegateSession.TargetStatus status:new AgentDelegateSession.TargetStatus[]{AgentDelegateSession.TargetStatus.OFFLINE,AgentDelegateSession.TargetStatus.UNSUPPORTED}){rejects(null,()->s.confirm(profiles(),op,fp,NOW,status));yes(s.phase().equals("REVIEW")&&s.text().equals(TEXT));}
  TaskProfiles paused=profiles().enabled(CODEX.binding(),false,NOW);rejects("TASK_PAUSED",()->s.confirm(paused,op,fp,NOW,AgentDelegateSession.TargetStatus.AVAILABLE));
  TaskProfiles missing=TaskProfiles.empty().upsert(CLAUDE,true,NOW);rejects("TASK_TARGET_CHANGED",()->s.confirm(missing,op,fp,NOW,AgentDelegateSession.TargetStatus.AVAILABLE));
  rejects("TASK_IMPORT_EXPIRED",()->s.confirm(profiles(),op,fp,CODEX.expiresAt,AgentDelegateSession.TargetStatus.AVAILABLE));yes(s.phase().equals("REVIEW"));
  yes(s.confirm(profiles(),op,fp,NOW,AgentDelegateSession.TargetStatus.AVAILABLE));
  try(TaskMailbox box=new TaskMailbox(new File(root,"offline"),CODEX)){
   rejects("DELEGATE_TARGET_OFFLINE",()->s.enqueue(s.operation(),box,profiles(),NOW+1,AgentDelegateSession.TargetStatus.OFFLINE));rejects("TASK_PAUSED",()->s.enqueue(s.operation(),box,paused,NOW+2,AgentDelegateSession.TargetStatus.AVAILABLE));yes(box.pending().isEmpty()&&s.phase().equals("SUBMITTING"));
   rejects("DELEGATE_COMMAND_EXPIRED",()->s.enqueue(s.operation(),box,profiles(),NOW+3600000,AgentDelegateSession.TargetStatus.AVAILABLE));yes(box.pending().isEmpty());
  }
  AgentDelegateSession noDefault=new AgentDelegateSession(new Memory());rejects("DELEGATE_DEFAULT_MISSING",()->noDefault.prepare(TaskProfiles.empty(),NOW,"",AgentDelegateSession.TargetStatus.AVAILABLE));rejects("TASK_PAUSED",()->noDefault.prepare(paused,NOW,CODEX.binding(),AgentDelegateSession.TargetStatus.AVAILABLE));yes(noDefault.phase().equals("IDLE"));
 }
 static void cancellationAndRecovery(File root)throws Exception{
  for(String phase:Arrays.asList("PREPARED","LISTENING","STOPPING","REVIEW")){
   Memory memory=new Memory();AgentDelegateSession s=prepared(memory);String op=s.operation();
   if(!phase.equals("PREPARED")){yes(s.begin(op,1000));yes(s.transcript(op,1,TEXT,1001));}
   if(phase.equals("STOPPING")||phase.equals("REVIEW"))yes(s.stop(op,1002,false));if(phase.equals("REVIEW"))yes(s.captureReleased(op));
   yes(s.stop(op,1003,true));if(s.needsCaptureRelease()){yes(s.phase().equals("STOPPING"));yes(s.captureReleased(op));}yes(s.phase().equals("CANCELLED"));
   try(TaskMailbox box=new TaskMailbox(new File(root,"cancel-"+phase),CODEX)){rejects("DELEGATE_NOT_CONFIRMED",()->s.enqueue(s.operation(),box,profiles(),NOW,AgentDelegateSession.TargetStatus.AVAILABLE));yes(box.pending().isEmpty());}
  }
  for(boolean stopping:new boolean[]{false,true}){
   Memory memory=new Memory();AgentDelegateSession s=prepared(memory);String op=s.operation();yes(s.begin(op,1000));yes(s.transcript(op,1,TEXT,1001));if(stopping)yes(s.stop(op,1002,false));
   AgentDelegateSession recovered=new AgentDelegateSession(memory);yes(recovered.phase().equals("RECOVERY")&&recovered.needsCaptureRelease()&&recovered.text().equals(TEXT));yes(!recovered.begin(op,10000));yes(!recovered.transcript(op,2,"late",10001));yes(recovered.captureReleased(op));yes(recovered.phase().equals("CANCELLED")&&!recovered.needsCaptureRelease());
  }
 }
 static void admissionRecovery(File root)throws Exception{
  Memory memory=new Memory();AgentDelegateSession s=review(memory);String op=s.operation(),fp=s.reviewFingerprint();yes(s.confirm(profiles(),op,fp,NOW,AgentDelegateSession.TargetStatus.AVAILABLE));
  File dir=new File(root,"admission");String payload;
  try(TaskMailbox box=new TaskMailbox(dir,CODEX)){
   memory.failPhase="QUEUED";rejects("SYNTHETIC_SAVE_LOST",()->s.enqueue(s.operation(),box,profiles(),NOW+1,AgentDelegateSession.TargetStatus.AVAILABLE));yes(!s.healthy()&&box.pending().size()==1&&"SUBMITTING".equals(map(memory.value).get("phase")));payload=(String)map(box.pending().get(0)).get("payload");
   rejects("DELEGATE_STORE_UNCERTAIN",()->s.enqueue(s.operation(),box,profiles(),NOW+2,AgentDelegateSession.TargetStatus.AVAILABLE));
  }
  AgentDelegateSession restored=new AgentDelegateSession(memory);
  try(TaskMailbox lost=new TaskMailbox(new File(root,"lost-submitting-mailbox"),CODEX)){
   rejects("DELEGATE_ADMISSION_UNKNOWN",()->restored.enqueue(restored.operation(),lost,profiles(),NOW+2,AgentDelegateSession.TargetStatus.AVAILABLE));yes(lost.pending().isEmpty()&&!restored.clearFinished(op));
  }
  try(TaskMailbox box=new TaskMailbox(dir,CODEX)){
   // Reconcile the saved operation even if its target was removed/default changed or TTL expired.
   Map<String,Object> row=restored.enqueue(restored.operation(),box,TaskProfiles.empty(),NOW+172800000,AgentDelegateSession.TargetStatus.OFFLINE);yes(restored.phase().equals("QUEUED")&&payload.equals(row.get("payload"))&&box.pending().size()==1);verifyTask(restored,row);
   yes(restored.confirm(TaskProfiles.empty(),op,fp,NOW+172800001,AgentDelegateSession.TargetStatus.OFFLINE));
  }
  try(TaskMailbox lost=new TaskMailbox(new File(root,"lost-mailbox"),CODEX)){rejects("DELEGATE_MAILBOX_RECEIPT_MISSING",()->restored.enqueue(restored.operation(),lost,profiles(),NOW+2,AgentDelegateSession.TargetStatus.AVAILABLE));yes(lost.pending().isEmpty());}
  Memory conflictMemory=new Memory();AgentDelegateSession conflict=review(conflictMemory);yes(conflict.confirm(profiles(),conflict.operation(),conflict.reviewFingerprint(),NOW,AgentDelegateSession.TargetStatus.AVAILABLE));
  try(TaskMailbox box=new TaskMailbox(new File(root,"conflict"),CODEX)){box.delegate(conflict.operation(),"different command",NOW,NOW+3600000);rejects("DELEGATE_OPERATION_CONFLICT",()->conflict.enqueue(conflict.operation(),box,profiles(),NOW+1,AgentDelegateSession.TargetStatus.AVAILABLE));yes(box.pending().size()==1&&conflict.phase().equals("SUBMITTING"));}
 }
 static void attemptJournal(File root)throws Exception{
  for(boolean committed:new boolean[]{false,true}){
   Memory memory=new Memory();AgentDelegateSession s=review(memory);String op=s.operation(),fp=s.reviewFingerprint();yes(s.confirm(profiles(),op,fp,NOW,AgentDelegateSession.TargetStatus.AVAILABLE));Map<String,Object> original=s.confirmedEvent();
   memory.failPhase="SUBMITTING";memory.failAfterCommit=committed;
   try(TaskMailbox box=new TaskMailbox(new File(root,"attempt-"+committed),CODEX)){
    rejects("SYNTHETIC_SAVE_LOST",()->s.enqueue(s.operation(),box,profiles(),NOW+1,AgentDelegateSession.TargetStatus.AVAILABLE));yes(!s.healthy()&&box.pending().isEmpty());
    AgentDelegateSession restored=new AgentDelegateSession(memory);yes(restored.phase().equals("SUBMITTING")&&restored.operation().equals(op)&&TaskWire.same(original,restored.confirmedEvent()));yes(!restored.clearFinished(op));
    if(committed){
     // The attempt marker can commit before mailbox.delegate runs. Absence is
     // deliberately ambiguous; duplicate confirmation cannot reset that marker.
     yes(restored.confirm(profiles(),op,fp,NOW+2,AgentDelegateSession.TargetStatus.AVAILABLE));
     yes(!restored.stop(op,0,true));
     for(int i=0;i<2;i++)rejects("DELEGATE_ADMISSION_UNKNOWN",()->restored.enqueue(restored.operation(),box,profiles(),NOW+3,AgentDelegateSession.TargetStatus.AVAILABLE));yes(box.pending().isEmpty());
     // Simulate restoring the exact durable row from the owning mailbox. The
     // core verifies all bytes before releasing the uncertainty, not just op.
     box.delegate(op,TEXT,NOW,NOW+AgentDelegateSession.COMMAND_MILLIS);
    }
    verifyTask(restored,restored.enqueue(restored.operation(),box,profiles(),NOW+4,AgentDelegateSession.TargetStatus.AVAILABLE));yes(restored.phase().equals("QUEUED")&&box.pending().size()==1);
    Map<String,Object> exposed=restored.confirmedEvent();TaskWire.body(exposed).put("command","wrong");yes(TaskWire.same(original,restored.confirmedEvent()));
   }
  }
 }
 static void unsentCancellation(File root)throws Exception{
  for(String reason:Arrays.asList("offline","paused","expired"))for(boolean restart:new boolean[]{false,true}){
   Memory memory=new Memory();AgentDelegateSession s=review(memory);String op=s.operation(),fp=s.reviewFingerprint();yes(s.confirm(profiles(),op,fp,NOW,AgentDelegateSession.TargetStatus.AVAILABLE));
   TaskProfiles targets=reason.equals("paused")?profiles().enabled(CODEX.binding(),false,NOW):profiles();long wall=reason.equals("expired")?NOW+AgentDelegateSession.COMMAND_MILLIS:NOW+1;
   AgentDelegateSession.TargetStatus status=reason.equals("offline")?AgentDelegateSession.TargetStatus.OFFLINE:AgentDelegateSession.TargetStatus.AVAILABLE;String error=reason.equals("offline")?"DELEGATE_TARGET_OFFLINE":reason.equals("paused")?"TASK_PAUSED":"DELEGATE_COMMAND_EXPIRED";
   try(TaskMailbox box=new TaskMailbox(new File(root,"cancel-unsent-"+reason+"-"+restart),CODEX)){
    AgentDelegateSession original=s;rejects(error,()->original.enqueue(op,box,targets,wall,status));yes(box.pending().isEmpty()&&Boolean.FALSE.equals(map(s.snapshot()).get("admission_attempted")));
    if(restart)s=new AgentDelegateSession(memory);yes(s.phase().equals("SUBMITTING")&&s.operation().equals(op));yes(s.stop(op,0,true));yes(s.phase().equals("CANCELLED")&&s.text().equals(TEXT));Map<String,Object> cancelled=map(s.snapshot());yes(TaskWire.nonnegative(cancelled.get("confirmed_at"))==0&&TaskWire.nonnegative(cancelled.get("expires_at"))==0&&"".equals(cancelled.get("confirmed_fingerprint")));
    yes(s.clearFinished(op));yes(s.prepare(profiles().select(CLAUDE.binding()),NOW+2,CLAUDE.binding(),AgentDelegateSession.TargetStatus.AVAILABLE));yes(!op.equals(s.operation())&&box.pending().isEmpty());AgentDelegateSession current=s;rejects("DELEGATE_OPERATION_CHANGED",()->current.enqueue(op,box,profiles(),NOW+3,AgentDelegateSession.TargetStatus.AVAILABLE));
   }
  }
 }
 static void lifecycleReset(File root)throws Exception{
  Memory memory=new Memory();AgentDelegateSession s=prepared(memory);String old=s.operation();yes(!s.clearFinished(old));yes(s.begin(old,1000));yes(!s.clearFinished(old));yes(s.transcript(old,1,TEXT,1001));yes(s.stop(old,1002,true));yes(!s.clearFinished(old));
  s=new AgentDelegateSession(memory);yes(s.phase().equals("RECOVERY")&&!s.clearFinished(old));yes(s.captureReleased(old));yes(s.clearFinished(old));yes(s.phase().equals("IDLE")&&s.operation().isEmpty()&&s.text().isEmpty()&&!s.needsCaptureRelease());
  TaskProfiles changed=profiles().select(CLAUDE.binding());yes(s.prepare(changed,NOW+1,CLAUDE.binding(),AgentDelegateSession.TargetStatus.AVAILABLE));String next=s.operation();yes(!next.equals(old));AgentDelegateSession current=s;
  rejects("DELEGATE_OPERATION_CHANGED",()->current.transcript(old,2,"stale",1003));rejects("DELEGATE_OPERATION_CHANGED",()->current.captureReleased(old));rejects("DELEGATE_OPERATION_CHANGED",()->current.stop(old,1004,true));rejects("DELEGATE_OPERATION_CHANGED",()->current.confirm(profiles(),old,"stale",NOW+1,AgentDelegateSession.TargetStatus.AVAILABLE));rejects("DELEGATE_OPERATION_CHANGED",()->current.clearFinished(old));
  rejects("DELEGATE_OPERATION_CHANGED",()->current.finalTranscript(old,2,"旧录音的末尾",1003));
  yes(s.begin(next,2000));yes(s.transcript(next,1,"新任务",2001));yes(s.stop(next,2002,false));yes(s.captureReleased(next));yes(!s.clearFinished(next));String fp=s.reviewFingerprint();yes(s.confirm(changed,next,fp,NOW+2,AgentDelegateSession.TargetStatus.AVAILABLE));yes(!s.clearFinished(next));
  try(TaskMailbox box=new TaskMailbox(new File(root,"next-lifecycle"),CLAUDE)){
   rejects("DELEGATE_OPERATION_CHANGED",()->current.enqueue(old,box,changed,NOW+3,AgentDelegateSession.TargetStatus.AVAILABLE));yes(box.pending().isEmpty());
   Map<String,Object> row=s.enqueue(s.operation(),box,changed,NOW+3,AgentDelegateSession.TargetStatus.AVAILABLE);yes(TaskWire.same(TaskWire.body(event(row)).get("route"),CLAUDE.route()));yes(s.clearFinished(next));yes(s.phase().equals("IDLE")&&box.pending().size()==1);yes(s.prepare(profiles(),NOW+4,CODEX.binding(),AgentDelegateSession.TargetStatus.AVAILABLE));yes(!s.operation().equals(next));
   rejects("DELEGATE_OPERATION_CHANGED",()->current.confirm(changed,next,fp,NOW+5,AgentDelegateSession.TargetStatus.AVAILABLE));rejects("DELEGATE_OPERATION_CHANGED",()->current.clearFinished(next));yes(box.pending().size()==1);
  }
  for(boolean committed:new boolean[]{false,true}){
   Memory broken=new Memory();AgentDelegateSession cancel=prepared(broken);String op=cancel.operation();yes(cancel.stop(op,0,true));broken.failPhase="IDLE";broken.failAfterCommit=committed;
   rejects("SYNTHETIC_SAVE_LOST",()->cancel.clearFinished(op));yes(!cancel.healthy());rejects("DELEGATE_STORE_UNCERTAIN",()->cancel.prepare(changed,NOW+1,CLAUDE.binding(),AgentDelegateSession.TargetStatus.AVAILABLE));AgentDelegateSession restored=new AgentDelegateSession(broken);yes(restored.phase().equals(committed?"IDLE":"CANCELLED"));if(!committed)yes(restored.clearFinished(op));yes(restored.prepare(changed,NOW+2,CLAUDE.binding(),AgentDelegateSession.TargetStatus.AVAILABLE)&&!restored.operation().equals(op));
  }
 }
 static void saveFailuresAndDisk(File root)throws Exception{
  for(boolean committed:new boolean[]{false,true}){
   Memory memory=new Memory();AgentDelegateSession s=review(memory);String op=s.operation(),fp=s.reviewFingerprint();memory.failPhase="SUBMITTING";memory.failAfterCommit=committed;
   rejects("SYNTHETIC_SAVE_LOST",()->s.confirm(profiles(),op,fp,NOW,AgentDelegateSession.TargetStatus.AVAILABLE));yes(!s.healthy());AgentDelegateSession restored=new AgentDelegateSession(memory);yes(restored.phase().equals(committed?"SUBMITTING":"REVIEW"));
   if(!committed)yes(restored.confirm(profiles(),op,fp,NOW,AgentDelegateSession.TargetStatus.AVAILABLE));try(TaskMailbox box=new TaskMailbox(new File(root,"save-"+committed),CODEX)){verifyTask(restored,restored.enqueue(restored.operation(),box,profiles(),NOW+1,AgentDelegateSession.TargetStatus.AVAILABLE));yes(box.pending().size()==1);}
  }
  File file=new File(root,"durable/draft.json");String operation;
  try(AtomicDocument disk=new AtomicDocument(file)){
   AgentDelegateSession s=new AgentDelegateSession(new AgentDelegateSession.Store(){public Object read()throws Exception{return disk.read();}public void save(Object next)throws Exception{disk.save(next);}});yes(s.prepare(profiles(),NOW,CODEX.binding(),AgentDelegateSession.TargetStatus.AVAILABLE));operation=s.operation();yes(s.begin(operation,100));yes(s.transcript(operation,1,TEXT,101));yes(s.stop(operation,102,false));yes(s.captureReleased(operation));
  }
  try(AtomicDocument disk=new AtomicDocument(file)){
   AgentDelegateSession s=new AgentDelegateSession(new AgentDelegateSession.Store(){public Object read()throws Exception{return disk.read();}public void save(Object next)throws Exception{disk.save(next);}});yes(s.phase().equals("REVIEW")&&s.operation().equals(operation)&&s.text().equals(TEXT));
  }
  Memory invalid=new Memory();review(invalid);map(invalid.value).put("format","io-agent-voice-draft/1");yes(!new AgentDelegateSession(invalid).healthy());
  Memory changed=new Memory();review(changed);map(map(map(changed.value).get("target")).get("route")).put("session_id","wrong");yes(!new AgentDelegateSession(changed).healthy());
 }
 static void envelopeAndRace(File root)throws Exception{
  AgentDelegateSession over=review(new Memory());String overOp=over.operation();char[] escaped=new char[65536];Arrays.fill(escaped,'\u0000');yes(over.edit(overOp,new String(escaped)));
  // NUL-only text trims empty: include visible content, then verify the actual wire limit.
  escaped[0]='a';yes(over.edit(overOp,new String(escaped)));String visibleFingerprint=over.reviewFingerprint();rejects("DIRECTORY_COMMAND_TOO_LARGE",()->over.confirm(profiles(),overOp,visibleFingerprint,NOW,AgentDelegateSession.TargetStatus.AVAILABLE));yes(over.phase().equals("REVIEW"));
  AgentDelegateSession s=review(new Memory());String op=s.operation(),fp=s.reviewFingerprint();File dir=new File(root,"race");List<Throwable> failures=Collections.synchronizedList(new ArrayList<>());
  try(TaskMailbox box=new TaskMailbox(dir,CODEX)){
   Runnable repeat=()->{try{for(int i=0;i<5;i++){s.confirm(profiles(),op,fp,NOW,AgentDelegateSession.TargetStatus.AVAILABLE);s.enqueue(s.operation(),box,profiles(),NOW+1,AgentDelegateSession.TargetStatus.AVAILABLE);}}catch(Throwable failure){failures.add(failure);}};
   Thread one=new Thread(repeat),two=new Thread(repeat);one.start();two.start();one.join(5000);two.join(5000);yes(!one.isAlive()&&!two.isAlive()&&failures.isEmpty());yes(box.pending().size()==1);verifyTask(s,map(box.pending().get(0)));
  }
  AgentDelegateSession nearExpiry=review(new Memory());long admitted=CODEX.expiresAt-1000;yes(nearExpiry.confirm(profiles(),nearExpiry.operation(),nearExpiry.reviewFingerprint(),admitted,AgentDelegateSession.TargetStatus.AVAILABLE));
  try(TaskMailbox box=new TaskMailbox(new File(root,"near-expiry"),CODEX)){Map<String,Object> e=event(nearExpiry.enqueue(nearExpiry.operation(),box,profiles(),admitted+1,AgentDelegateSession.TargetStatus.AVAILABLE));yes(TaskWire.stamp(e.get("expires_at"))==CODEX.expiresAt&&TaskWire.stamp(e.get("created_at"))==admitted);}
 }
 static void explicitSharedDefault()throws Exception{
  AgentDelegateSession missing=new AgentDelegateSession(new Memory());
  rejects("DELEGATE_DEFAULT_MISSING",()->missing.prepare(profiles(),NOW,"",AgentDelegateSession.TargetStatus.AVAILABLE));
  rejects("DELEGATE_TARGET_OFFLINE",()->missing.prepare(profiles(),NOW,CLAUDE.binding(),AgentDelegateSession.TargetStatus.OFFLINE));
  rejects("DELEGATE_TARGET_UNSUPPORTED",()->missing.prepare(profiles(),NOW,CLAUDE.binding(),null));
  yes(missing.phase().equals("IDLE"));
  // The old question profile still selects Codex, but this explicit shared
  // default is Claude. Preparing must neither change nor follow old selection.
  TaskProfiles oldSelection=profiles();yes(oldSelection.selected().binding.equals(CODEX.binding()));
  yes(missing.prepare(oldSelection,NOW,CLAUDE.binding(),AgentDelegateSession.TargetStatus.BUSY));
  yes(TaskWire.same(map(map(missing.snapshot()).get("target")).get("route"),CLAUDE.route()));
  yes(oldSelection.selected().binding.equals(CODEX.binding()));
 }
 public static void main(String[] args)throws Exception{
  File root=new File(args[0]);explicitSharedDefault();frozenTarget(root);captureBoundaries();finalDrain();unavailableTargets(root);cancellationAndRecovery(root);admissionRecovery(root);attemptJournal(root);unsentCancellation(root);lifecycleReset(root);saveFailuresAndDisk(root);envelopeAndRace(root);
  // Check the exact cutoff boundary and preserve its unfinished text for review.
  AgentDelegateSession s=prepared(new Memory());String op=s.operation();yes(s.begin(op,1000));yes(s.transcript(op,1,"截止前尚未说完😀",60999));yes(!s.transcript(op,2,"晚到内容",61000));yes(s.phase().equals("STOPPING")&&s.needsCaptureRelease());yes(s.captureReleased(op));yes(s.phase().equals("REVIEW")&&s.text().equals("截止前尚未说完😀"));
  System.out.println("Agent delegate draft: "+checks+" checks passed (synthetic capture events, real durable mailbox; no device or host execution)");
 }
}
