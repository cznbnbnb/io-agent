package com.turboio.addon;

import java.io.*;import java.nio.file.*;import java.util.*;import java.util.concurrent.*;import java.util.concurrent.atomic.*;

/** Recorded real native synthetic callbacks -> actual durable draft and original-question outbox.
 * Device-stop inputs below are test doubles and cannot count as physical microphone evidence. */
final class VoiceOfficialCallbackTest {
 static void yes(boolean value){VoiceAnswerTest.yes(value);}
 static void deviceStopped(VoiceAnswerSession draft)throws Exception{
  yes(draft.stopSubmitted(draft.token(),VoiceAnswerTest.PEER,1,5000));
  VoiceAnswerSession.StopProbe p=draft.probeStop(VoiceAnswerTest.PEER,1,5001);
  yes(draft.deviceIdle(p,VoiceAnswerTest.PEER,1,5002,true));yes(draft.finish());
 }
 static final class Events implements VoiceDraftCallbacks.Events {
  final List<String> stops=Collections.synchronizedList(new ArrayList<>());
  public void changed(){}public void stopRequired(String token,String code){stops.add(code);}
 }
 static void run(File root,File trace)throws Exception{
  Map<String,Object> fixture=WireJson.map(WireJson.read(Files.readAllBytes(trace.toPath())));
  StringJoiner wanted=new StringJoiner("\n");for(Object s:WireJson.list(fixture.get("expected_clauses")))wanted.add((String)s);String complete=wanted.toString();
  yes(Boolean.FALSE.equals(fixture.get("audio_end_callback"))&&"STOPPED".equals(fixture.get("native_stop_state")));
  for(String route:new String[]{"current-codex","original-hermes","dedicated-qa"}){
   TaskConnection connection=VoiceAnswerTest.connection(route);VoiceAnswerTest.Memory memory=new VoiceAnswerTest.Memory();VoiceAnswerSession draft=VoiceAnswerTest.prepared(memory,connection);VoiceAnswerTest.arm(draft);
   Events events=new Events();AtomicLong now=new AtomicLong(1100);
   try(VoiceDraftCallbacks listener=new VoiceDraftCallbacks(draft,VoiceAnswerTest.PEER,1,now::incrementAndGet,events)){
    for(Object raw:WireJson.list(fixture.get("callbacks"))){Map<String,Object> event=WireJson.map(raw);listener.result((String)event.get("text"),Boolean.TRUE.equals(event.get("finished")));}
    yes(!listener.sealAfterNativeStop(false).get(2,TimeUnit.SECONDS));
    yes(listener.sealAfterNativeStop(true).get(8,TimeUnit.SECONDS));yes(draft.transcript().equals(complete));yes(draft.needsStop()&&!draft.finish());yes(events.stops.isEmpty());
    listener.result("迟到的其他结果",true);yes(draft.transcript().equals(complete));
    deviceStopped(draft);yes(draft.phase().equals("REVIEW"));
    VoiceAnswerSession restored=new VoiceAnswerSession(memory);yes(restored.transcript().equals(complete)&&restored.phase().equals("REVIEW"));
    try(TaskMailbox box=new TaskMailbox(new File(root,"native-trace-"+route),connection)){
     box.acceptDetail(VoiceAnswerTest.task(connection),VoiceAnswerTest.WALL);box.acceptDetail(VoiceAnswerTest.request(connection),VoiceAnswerTest.WALL);
     Map<String,Object> row=restored.saveAnswer(box,VoiceAnswerTest.request(connection),VoiceAnswerTest.task(connection),VoiceAnswerTest.WALL);
     Map<String,Object> answer=TaskWire.body(WireJson.map(WireJson.read(((String)row.get("payload")).getBytes(java.nio.charset.StandardCharsets.UTF_8))));
     yes(answer.get("text").equals(complete)&&answer.get("request_id").equals("voice-question")&&answer.get("task_id").equals("voice-task")&&TaskWire.same(answer.get("route"),connection.route()));yes(box.pending().size()==1);
    }
   }
  }
  TaskConnection c=VoiceAnswerTest.connection("boundary-test");
  for(boolean duplicate:new boolean[]{false,true}){
   VoiceAnswerSession s=VoiceAnswerTest.prepared(new VoiceAnswerTest.Memory(),c);VoiceAnswerTest.arm(s);
   yes(s.officialResult(s.token(),VoiceAnswerTest.PEER,1,"不要执行。",true,1100));String second=duplicate?"不要执行。":"保留资料。";
   yes(!s.officialResult(s.token(),VoiceAnswerTest.PEER,1,second,true,1101));yes(s.transcript().equals("不要执行。\n"+second));
   yes(!s.officialResult(s.token(),VoiceAnswerTest.PEER,1,"不能覆盖不确定原文",false,1102));yes(s.engineSealed(s.token(),true,1200));deviceStopped(s);yes(s.phase().equals("INCOMPLETE"));VoiceAnswerTest.rejects(()->s.saveAnswer(null,null,null,VoiceAnswerTest.WALL));
  }
  VoiceAnswerSession revised=VoiceAnswerTest.prepared(new VoiceAnswerTest.Memory(),c);VoiceAnswerTest.arm(revised);
  yes(revised.officialResult(revised.token(),VoiceAnswerTest.PEER,1,"执行",false,1100));yes(revised.officialResult(revised.token(),VoiceAnswerTest.PEER,1,"不要执行",false,1101));yes(revised.officialResult(revised.token(),VoiceAnswerTest.PEER,1,"不要执行。",true,1102));
  yes(revised.transcript().equals("不要执行。"));yes(!revised.officialResult(revised.token(),VoiceAnswerTest.OTHER,1,"外部来源",false,1103));yes(revised.engineSealed(revised.token(),true,1200));yes(!revised.result(revised.token(),VoiceAnswerTest.PEER,1,1,4,"停止后覆盖",true,1201));yes(revised.transcript().equals("不要执行。"));
  VoiceAnswerTest.Memory broken=new VoiceAnswerTest.Memory();VoiceAnswerSession s=VoiceAnswerTest.prepared(broken,c);VoiceAnswerTest.arm(s);Events failure=new Events();broken.fail=true;
  try(VoiceDraftCallbacks listener=new VoiceDraftCallbacks(s,VoiceAnswerTest.PEER,1,()->1500,failure)){
   listener.result("必须保留的条件",false);yes(!listener.sealAfterNativeStop(true).get(5,TimeUnit.SECONDS));yes(failure.stops.size()==1&&s.needsStop()&&!s.healthy());
  }
  // Hold an observer (not the draft lock) so close/seal ordering is deterministic.
  for(boolean closeEarly:new boolean[]{false,true}){
   VoiceAnswerSession pending=VoiceAnswerTest.prepared(new VoiceAnswerTest.Memory(),c);VoiceAnswerTest.arm(pending);
   CountDownLatch observed=new CountDownLatch(1),release=new CountDownLatch(1);AtomicInteger stops=new AtomicInteger();
   VoiceDraftCallbacks.Events held=new VoiceDraftCallbacks.Events(){
    public void changed(){observed.countDown();try{release.await(5,TimeUnit.SECONDS);}catch(InterruptedException stop){Thread.currentThread().interrupt();}}
    public void stopRequired(String token,String code){stops.incrementAndGet();}
   };
   try(VoiceDraftCallbacks listener=new VoiceDraftCallbacks(pending,VoiceAnswerTest.PEER,1,()->1500,held)){
    listener.result("保留已确认条件。",true);yes(observed.await(3,TimeUnit.SECONDS));
    CompletableFuture<Boolean> seal=listener.sealAfterNativeStop(true);yes(seal==listener.sealAfterNativeStop(true));
    if(closeEarly){
     // A close notification is itself user code and may take time. The pending future
     // must become false before that notification, not remain stranded in shutdownNow.
     Thread closing=new Thread(listener::close);closing.start();yes(!seal.get(2,TimeUnit.SECONDS));release.countDown();closing.join(3000);yes(!closing.isAlive());
     yes(stops.get()==1&&pending.needsStop()&&!pending.finish());
    }else{release.countDown();yes(seal.get(3,TimeUnit.SECONDS));yes(stops.get()==0&&pending.transcript().equals("保留已确认条件。"));}
   }finally{release.countDown();}
  }
 }
}
