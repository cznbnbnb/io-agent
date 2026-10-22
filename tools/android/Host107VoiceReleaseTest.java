package com.turboio.addon;

import com.rayneo.airuntime.controller.*;

/** Fault-injected official ABI doubles. No real SDK, ASR, microphone or device.
 * Release/destroy returns are call-level evidence, not physical stop evidence. */
public final class Host107VoiceReleaseTest {
 private static int checks;
 private static final String TOKEN="abcdefabcdefabcdefabcdefabcdefab";
 private interface Work {void run()throws Exception;}
 private static void yes(boolean value){checks++;if(!value)throw new AssertionError("voice release assertion "+checks);}
 private static void rejects(Work action)throws Exception{checks++;try{action.run();}catch(ReflectiveOperationException|IllegalStateException expected){return;}throw new AssertionError("Expected voice release rejection "+checks);}
 private static final class Fixture {
  final ASRController controller=new ASRController();final Host107VoiceTask voice;final ASRTask task;int callbacks;
  Fixture()throws Exception{
   voice=Host107VoiceTask.prepare(controller,new RayNeoASRConfig(),TOKEN,new Host107VoiceTask.Listener(){public void result(String text,boolean finished){callbacks++;}public void started(boolean accepted){callbacks++;}public void engineAudio(boolean active){callbacks++;}public void error(String code){callbacks++;}});
   task=controller.tasks.get("io_agent_asr_"+TOKEN);controller.automaticEnd=false;
  }
  void startedStopped()throws Exception{yes(voice.start(TOKEN));voice.sealInput(TOKEN);yes(voice.stop(TOKEN));yes(voice.engineStopped());}
  void fenced(boolean actualTerminal)throws Exception{
   int reads=task.stateReads,starts=task.starts,stops=task.stops,before=callbacks;
   rejects(()->voice.start(TOKEN));rejects(()->voice.pcm(TOKEN,new byte[640]));rejects(()->voice.stop(TOKEN));rejects(()->voice.sealInput(TOKEN));rejects(()->voice.state());
   yes(voice.engineStopped()==actualTerminal);task.listener.onAsrResult("late synthetic result",true);task.listener.onAudioRecordEnd();task.listener.onError(1,"synthetic-only");
   yes(reads==task.stateReads&&starts==task.starts&&stops==task.stops&&before==callbacks);
  }
 }
 private static void terminalRequired()throws Exception{
  Fixture f=new Fixture();yes(!f.voice.engineStopped());rejects(()->f.voice.release("ffffffffffffffffffffffffffffffff"));yes(f.task.releases==0);
  yes(f.voice.start(TOKEN));rejects(()->f.voice.release(TOKEN));yes(f.task.releases==0&&f.controller.destroyCalls==0);
  f.voice.sealInput(TOKEN);f.controller.failStop=true;yes(!f.voice.stop(TOKEN));rejects(()->f.voice.release(TOKEN));yes(f.task.releases==0);
  f.controller.failStop=false;yes(f.voice.stop(TOKEN));f.task.state=WorkState.WORKING;rejects(()->f.voice.release(TOKEN));
  f.task.state=WorkState.UNKNOWN;rejects(()->f.voice.release(TOKEN));yes(f.task.releases==0);
  f.task.state=WorkState.TERMINATED;f.voice.release(TOKEN);yes(f.task.releases==1&&f.controller.destroyCalls==1);f.fenced(false);
 }
 private static void releaseFailure(boolean throwing,boolean started)throws Exception{
  Fixture f=new Fixture();if(started)f.startedStopped();f.controller.failRelease=!throwing;f.controller.throwRelease=throwing;
  rejects(()->f.voice.release(TOKEN));yes(f.task.releases==1&&f.controller.destroyCalls==0&&!f.task.releaseAccepted);f.fenced(started);
  int reads=f.task.stateReads;f.controller.failRelease=false;f.controller.throwRelease=false;f.voice.release(TOKEN);
  yes(f.task.releases==2&&f.controller.destroyCalls==1&&f.controller.destroyed.size()==1&&f.controller.tasks.isEmpty()&&reads==f.task.stateReads);
  f.fenced(false);rejects(()->f.voice.release(TOKEN));yes(f.task.releases==2&&f.controller.destroyCalls==1);
 }
 private static void destroyFailure(boolean started,boolean afterRemoval)throws Exception{
  Fixture f=new Fixture();if(started)f.startedStopped();f.controller.destroyFailures=1;f.controller.destroyFailureAfterRemoval=afterRemoval;f.controller.throwStateAfterRelease=true;
  rejects(()->f.voice.release(TOKEN));yes(f.task.releases==1&&f.task.releaseAccepted&&f.controller.destroyCalls==1&&f.controller.destroyed.isEmpty());
  yes(f.controller.tasks.isEmpty()==afterRemoval); // Map absence alone never completes release.
  // Even if the now-released SDK state is unreadable, the captured real terminal
  // evidence survives. A never-started task still never claims engineStopped.
  int reads=f.task.stateReads;f.fenced(started);f.controller.failRelease=true;f.controller.throwRelease=true;
  rejects(()->f.voice.release("ffffffffffffffffffffffffffffffff"));yes(f.controller.destroyCalls==1);
  f.voice.release(TOKEN);yes(f.task.releases==1&&f.controller.destroyCalls==2&&f.controller.destroyed.size()==1&&f.controller.tasks.isEmpty()&&reads==f.task.stateReads);
  f.fenced(false);rejects(()->f.voice.release(TOKEN));yes(f.task.releases==1&&f.controller.destroyCalls==2);
 }
 public static void main(String[] args)throws Exception{
  terminalRequired();for(boolean started:new boolean[]{false,true}){releaseFailure(false,started);releaseFailure(true,started);destroyFailure(started,false);destroyFailure(started,true);}
  System.out.println("Official voice staged release: "+checks+" assertions passed (synthetic SDK failure fixtures only)");
 }
}
