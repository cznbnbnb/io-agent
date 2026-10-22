package com.turboio.addon;

import java.io.*;import java.nio.file.*;import java.util.*;
import com.rayneo.airuntime.controller.*;

/** Real durable mailbox/journals, synthetic capture and reflection ABI doubles. No real mic/ASR. */
public final class VoiceAnswerTest {
 static int checks;static final long WALL=TaskConnection.stamp("2026-10-19T12:00:00Z");
 static final String PEER="synthetic-voice-peer",OTHER="synthetic-other",TOKEN="0123456789abcdef0123456789abcdef";
 interface Throwing {void run()throws Exception;}
 static void yes(boolean value){checks++;if(!value)throw new AssertionError("voice assertion "+checks);}
 static void rejects(Throwing work)throws Exception{checks++;try{work.run();}catch(IllegalArgumentException|IllegalStateException|IOException expected){return;}throw new AssertionError("Expected rejection at "+checks);}
 static final class Memory implements VoiceAnswerSession.Store {
  Object value;boolean fail;
  public Object read(){return value==null?null:WireJson.copy(value);}public void save(Object v)throws IOException{if(fail)throw new IOException("synthetic write failure");value=WireJson.copy(v);}
 }
 static TaskConnection connection(String agent){Map<String,Object> value=TaskConnectionTest.sample();value.put("agent_id",agent);return TaskConnection.parse(WireJson.bytes(value),WALL);}
 static Map<String,Object> item(String kind,Map<String,Object> body,long seq){return WireJson.object("schema_version","1.0","kind",kind,"object_id",TaskWire.objectId(kind,body),"revision",TaskWire.revision(kind,body),"commit_seq",seq,"stored_at",TaskWire.now(WALL),"event_id","voice-event-"+seq,"expires_at",TaskWire.now(WALL+3600000),"state",body.get("state"),"body",WireJson.copy(body));}
 static Map<String,Object> task(TaskConnection c){return item("task",WireJson.object("task_id","voice-task","revision",1,"route",c.route(),"state","waiting_answer","command","只预览合成方案","allow_create_session",false),1);}
 static Map<String,Object> request(TaskConnection c){return item("request",WireJson.object("request_id","voice-question","revision",1,"task_id","voice-task","route",c.route(),"state","pending","mode","free_text","question","请完整补充条件","options",new ArrayList<>()),2);}
 static VoiceAnswerSession prepared(VoiceAnswerSession.Store store,TaskConnection c)throws Exception{VoiceAnswerSession s=new VoiceAnswerSession(store);yes(s.prepare(c,request(c),task(c),WALL));return s;}
 static void arm(VoiceAnswerSession s)throws Exception{yes(!s.arm(PEER,1,1000,15,null));yes(!s.arm(PEER,1,1000,15,(token,peer,gen,deadline)->false));yes(s.phase().equals("PREPARED")&&!s.needsStop());yes(s.arm(PEER,1,1000,15,(token,peer,gen,deadline)->token.equals(s.token())&&peer.equals(FixedPeerHash.of(PEER))&&gen==1&&deadline==16000));yes(s.needsStop());}
 static void stopped(VoiceAnswerSession s,long gen)throws Exception{
  yes(s.stop(s.token(),2000,false));yes(s.stopSubmitted(s.token(),PEER,gen,2001));
  yes(s.engineEnd(s.token(),2002));yes(!s.finish());yes(s.engineStopped(s.token(),true));yes(!s.finish());
  VoiceAnswerSession.StopProbe p=s.probeStop(PEER,gen,2003);yes(p!=null);yes(!s.deviceIdle(p,OTHER,gen,2004,true));yes(!s.deviceIdle(p,PEER,gen+1,2004,true));yes(s.deviceIdle(p,PEER,gen,2004,true));yes(!s.deviceIdle(p,PEER,gen,2005,true));yes(s.finish());yes(!s.needsStop());
 }
 static void core(File root)throws Exception{
  TaskConnection c=connection("original-agent");String first="请只预览，不发布。",second="补充：保留所有原始资料\n预算不超过200元，周五再执行。";String complete=first+"\n"+second;
  Memory m=new Memory();VoiceAnswerSession s=prepared(m,c);String token=s.token();yes(token.length()==32&&!WireJson.map(s.snapshot()).toString().contains(c.token()));arm(s);
  yes(!s.result(token,OTHER,1,1,1,"wrong",true,1100));yes(!s.result("ffffffffffffffffffffffffffffffff",PEER,1,1,1,"wrong",true,1100));
  yes(s.result(token,PEER,1,1,1,"请只",false,1101));yes(s.result(token,PEER,1,1,2,first,true,1102));yes(s.result(token,PEER,1,1,2,first,true,1103));yes(s.result(token,PEER,1,2,1,second,true,1104));yes(s.transcript().equals(complete));
  yes(!s.edit("不能提前改写"));yes(!s.finish());yes(s.probeStop(PEER,1,1200)==null);stopped(s,1);yes(s.phase().equals("REVIEW"));yes(s.transcript().equals(complete));
  String revised=complete+"\n再次明确：不要发送任何消息。";yes(s.edit(revised));yes(s.transcript().equals(complete)&&s.answerText().equals(revised));
  try(TaskMailbox box=new TaskMailbox(new File(root,"mailbox"),c);TaskMailbox foreign=new TaskMailbox(new File(root,"other-mailbox"),connection("different-agent"))){
   box.acceptDetail(task(c),WALL);box.acceptDetail(request(c),WALL);
   rejects(()->s.saveAnswer(foreign,request(c),task(c),WALL));
   Map<String,Object> changed=WireJson.map(WireJson.copy(request(c)));TaskWire.body(changed).put("question","同版本正文被改");rejects(()->s.saveAnswer(box,changed,task(c),WALL));yes(s.phase().equals("REVIEW"));
   rejects(()->box.draftAnswer("unbound-voice","voice-question",1,null,"未绑定全文","voice",null,WALL));
   Map<String,Object> row=s.saveAnswer(box,request(c),task(c),WALL);String payload=(String)row.get("payload");Map<String,Object> event=WireJson.map(WireJson.read(payload.getBytes(java.nio.charset.StandardCharsets.UTF_8))),answer=TaskWire.body(event);
   yes(answer.get("text").equals(revised));yes(answer.get("input_source").equals("voice")&&answer.get("raw_action")==null&&answer.get("option_id")==null);yes(TaskWire.same(answer.get("route"),c.route())&&answer.get("task_id").equals("voice-task")&&answer.get("request_id").equals("voice-question"));
   yes(s.phase().equals("SAVED")&&!s.edit("覆盖已保存答案"));VoiceAnswerSession restored=new VoiceAnswerSession(m);yes(restored.phase().equals("SAVED")&&restored.transcript().equals(complete));
   yes(restored.saveAnswer(box,null,null,WALL+3600001).get("payload").equals(payload));
   rejects(()->box.draftAnswer("phone-competes","voice-question",1,null,"手机第二份答案",WALL));yes(box.pending().size()==1);
   yes(box.claim(WALL)==null);box.confirmDraft(s.operation(),request(c),task(c),WALL);TaskMailbox.Claim claimed=box.claim(WALL);yes(claimed!=null&&claimed.action.equals("send")&&claimed.payload.equals(payload));
  }
  for(String fault:new String[]{"unfinished","conflict","oversize","gap"}){
   VoiceAnswerSession v=prepared(new Memory(),c);arm(v);yes(v.result(v.token(),PEER,1,1,1,"完整条件待处理",!fault.equals("unfinished"),1100));
   if(fault.equals("conflict"))yes(!v.result(v.token(),PEER,1,1,1,"被覆盖的冲突",true,1101));
   if(fault.equals("oversize"))yes(!v.result(v.token(),PEER,1,1,2,String.join("",Collections.nCopies(65537,"长")),true,1101));
   if(fault.equals("gap"))yes(!v.result(v.token(),PEER,1,3,1,"漏掉一段",true,1101));
   stopped(v,1);yes(v.phase().equals("INCOMPLETE")&&v.transcript().equals("完整条件待处理"));rejects(()->v.saveAnswer(null,null,null,WALL));
  }
  VoiceAnswerSession cancel=prepared(new Memory(),c);arm(cancel);yes(cancel.result(cancel.token(),PEER,1,1,1,complete,true,1200));yes(cancel.cancelDraft(1300));stopped(cancel,1);yes(cancel.phase().equals("CANCELLED")&&cancel.transcript().equals(complete));rejects(()->cancel.saveAnswer(null,null,null,WALL));
  VoiceAnswerSession before=prepared(new Memory(),c);yes(before.cancelDraft(1500)&&before.phase().equals("CANCELLED")&&!before.needsStop());
  Memory cold=new Memory();VoiceAnswerSession running=prepared(cold,c);arm(running);yes(running.result(running.token(),PEER,1,1,1,complete,true,1300));VoiceAnswerSession resumed=new VoiceAnswerSession(cold);yes(resumed.phase().equals("RECOVERY")&&resumed.transcript().equals(complete)&&resumed.needsStop());yes(!resumed.arm(PEER,2,2000,15,(a,b,d,e)->true));yes(!resumed.resumeCleanup(OTHER,2,1500));yes(resumed.resumeCleanup(PEER,2,1500));stopped(resumed,2);yes(resumed.phase().equals("INCOMPLETE"));
  VoiceAnswerSession deadline=prepared(new Memory(),c);arm(deadline);deadline.tick(PEER,1,16000);yes(deadline.phase().equals("STOPPING")&&deadline.needsStop());
  VoiceAnswerSession disconnected=prepared(new Memory(),c);arm(disconnected);disconnected.tick(OTHER,2,1200);yes(disconnected.phase().equals("STOPPING")&&!disconnected.stopSubmitted(disconnected.token(),OTHER,2,1300));
  VoiceAnswerSession expired=prepared(new Memory(),c);arm(expired);yes(expired.stop(expired.token(),2000,false));yes(expired.stopSubmitted(expired.token(),PEER,1,2001));VoiceAnswerSession.StopProbe p=expired.probeStop(PEER,1,2002);yes(!expired.deviceIdle(p,PEER,1,10003,true));yes(!expired.finish());
  Memory failure=new Memory();VoiceAnswerSession denied=prepared(failure,c);failure.fail=true;rejects(()->denied.arm(PEER,1,1000,15,(a,b,d,e)->true));yes(!denied.healthy()&&denied.needsStop());
  Memory forged=new Memory();Map<String,Object> invalid=WireJson.map(m.value);invalid.put("engine_end",false);forged.value=invalid;VoiceAnswerSession blocked=new VoiceAnswerSession(forged);yes(!blocked.healthy()&&blocked.phase().equals("BLOCKED")&&blocked.needsStop());
  String fileId="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  try(VoiceAnswerJournal journal=new VoiceAnswerJournal(root,fileId)){VoiceAnswerSession real=prepared(journal,c);arm(real);yes(real.result(real.token(),PEER,1,1,1,complete,true,1400));}
  try(VoiceAnswerJournal journal=new VoiceAnswerJournal(root,fileId)){VoiceAnswerSession real=new VoiceAnswerSession(journal);yes(real.phase().equals("RECOVERY")&&real.transcript().equals(complete));}
  Path file=new File(root,"voice-drafts/"+fileId+".json").toPath(),partial=Paths.get(file+".partial");byte[] previous=Files.readAllBytes(file),uncertain="{uncertain".getBytes(java.nio.charset.StandardCharsets.UTF_8);Files.write(partial,uncertain);
  try(VoiceAnswerJournal journal=new VoiceAnswerJournal(root,fileId)){VoiceAnswerSession real=new VoiceAnswerSession(journal);yes(!real.healthy()&&real.needsStop());yes(Arrays.equals(Files.readAllBytes(file),previous)&&Arrays.equals(Files.readAllBytes(partial),uncertain));}
 }
 static void adapter()throws Exception{
  ASRController controller=new ASRController();ASRTask stock=controller.createTask("venus_teleprompter_asr");stock.state=WorkState.WORKING;
  List<String> texts=new ArrayList<>(),errors=new ArrayList<>();int[] callbacks=new int[2];
  Host107VoiceTask.Listener sink=new Host107VoiceTask.Listener(){public void result(String text,boolean end){texts.add(text);}public void started(boolean accepted){if(accepted)callbacks[0]++;}public void engineAudio(boolean started){callbacks[1]++;}public void error(String code){errors.add(code);}};
  RayNeoASRConfig bad=new RayNeoASRConfig();bad.format="opus";rejects(()->Host107VoiceTask.prepare(controller,bad,TOKEN,sink));yes(controller.tasks.size()==1);
  rejects(()->Host107VoiceTask.prepare(new Object(),new RayNeoASRConfig(),TOKEN,sink));
  Host107VoiceTask voice=Host107VoiceTask.prepare(controller,new RayNeoASRConfig(),TOKEN,sink);ASRTask task=controller.tasks.get("io_agent_asr_"+TOKEN);yes(task!=null&&task.recorder.getClass().getName().equals("p8.o")&&task.starts==0);
  rejects(()->voice.pcm(TOKEN,new byte[640]));rejects(()->voice.start("wrong"));yes(voice.start(TOKEN));yes(callbacks[0]==1&&callbacks[1]==1);
  rejects(()->voice.start(TOKEN));rejects(()->voice.pcm(TOKEN,new byte[3]));rejects(()->voice.pcm("wrong",new byte[640]));
  byte[] audio=new byte[640];audio[0]=42;voice.pcm(TOKEN,audio);audio[0]=0;yes(task.recorder.retained[0]==42);
  voice.sealInput(TOKEN);voice.sealInput(TOKEN);yes(task.recorder.stops==1&&!voice.engineStopped());rejects(()->voice.pcm(TOKEN,new byte[640]));
  String complete="不要执行\n保留所有条件和原始资料。";task.listener.onAsrResult(complete,true);yes(texts.equals(Arrays.asList(complete)));
  task.listener.onError(7,"secret-fixture-must-not-be-forwarded");yes(errors.equals(Arrays.asList("VOICE_ENGINE_ERROR")));
  task.listener.onProactiveHint(new RayNeoProactiveHint());task.listener.onVadStatusChange(1);yes(texts.size()==1&&errors.size()==1);
  rejects(()->voice.release(TOKEN));controller.automaticEnd=false;controller.failStop=true;yes(!voice.stop(TOKEN));yes(!voice.engineStopped());rejects(()->voice.release(TOKEN));rejects(()->voice.pcm(TOKEN,new byte[640]));
  controller.failStop=false;yes(voice.stop(TOKEN));yes(voice.engineStopped());yes(callbacks[1]==1); // No end callback, same as physical external-data task.
  task.state=WorkState.WORKING;yes(!voice.engineStopped());task.state=WorkState.UNKNOWN;yes(!voice.engineStopped());task.state=WorkState.STOPPED;yes(voice.engineStopped());
  voice.release(TOKEN);yes(task.releases==1&&controller.destroyed.equals(Arrays.asList("io_agent_asr_"+TOKEN))&&controller.tasks.get("venus_teleprompter_asr")==stock&&stock.state==WorkState.WORKING&&stock.stops==0);
  task.listener.onAsrResult("迟到结果",true);yes(texts.size()==1);rejects(()->voice.state());
  controller.failInit=true;rejects(()->Host107VoiceTask.prepare(controller,new RayNeoASRConfig(),"11111111111111111111111111111111",sink));yes(controller.tasks.size()==1&&stock.stops==0);
 }
 public static void main(String[] args)throws Exception{File root=new File(args[0]);core(root);adapter();VoiceArchiveTest.run(root);VoiceEnvironmentTest.run();VoiceOfficialCallbackTest.run(root,new File(args[1]));RecordingVoiceSourceTest.run(root);VoiceCaptureCutoffTest.run();Host107RecordingTest.run();System.out.println("Official voice integration core: "+checks+" assertions passed");}
}
