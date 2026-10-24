package com.turboio.addon;

import java.util.*;
import java.util.function.Consumer;

/** Production recovery observer with deterministic async dispatch, link and resource boundaries. */
public final class InterruptedVoiceRecoveryTest {
 static int checks;
 static void yes(boolean value){checks++;if(!value)throw new AssertionError("interrupted recovery check "+checks);}
 static final class Job {final long at,sequence;final Runnable action;Job(long at,long sequence,Runnable action){this.at=at;this.sequence=sequence;this.action=action;}}
 static final class Fixture implements InterruptedVoiceRecovery.Port {
  long time,sequence;Object owner=new Object();String binding="original-binding",request="original-request";
  boolean loaded=true,blocked,healthy=true,recovery=true,needsStop=true,released,working,connected=true,accept=true,throwsDispatch;
  int dispatched,completed;String completedTarget="",failure="";
  final List<Consumer<String>> callbacks=new ArrayList<>();
  final PriorityQueue<Job> jobs=new PriorityQueue<>(Comparator.comparingLong((Job j)->j.at).thenComparingLong(j->j.sequence));
  final InterruptedVoiceRecovery observer=new InterruptedVoiceRecovery(this);
  public long now(){return time;}
  public InterruptedVoiceRecovery.State state(){return new InterruptedVoiceRecovery.State(owner,binding,request,loaded,blocked,healthy,recovery,needsStop,released,working,connected);}
  public void later(Runnable action,long delay){jobs.add(new Job(time+delay,sequence++,action));}
  public void cleanup(Consumer<String> callback){dispatched++;callbacks.add(callback);if(throwsDispatch)throw new IllegalStateException();if(accept){working=true;callback.accept("");}}
  public void recovered(String binding,String request){completed++;completedTarget=binding+"/"+request;}
  public void incomplete(String reason){failure=reason;}
  void advance(long delta){long until=time+delta;int loops=0;while(!jobs.isEmpty()&&jobs.peek().at<=until){if(loops++>2000)throw new AssertionError("unbounded loop");Job j=jobs.remove();time=j.at;j.action.run();}time=until;}
  void clean(){needsStop=false;released=true;working=false;}
 }
 public static void main(String[] args){
  // The old bug: dispatch returns success before either stop proof or release.
  Fixture f=new Fixture();f.observer.start();yes(f.dispatched==1&&f.completed==0);f.advance(1000);yes(f.completed==0&&f.dispatched==1);
  f.needsStop=false;f.advance(1000);yes(f.completed==0);f.released=true;f.advance(1000);yes(f.completed==0);
  f.working=false;f.advance(250);yes(f.completed==1&&f.completedTarget.equals("original-binding/original-request"));f.advance(120000);yes(f.completed==1&&!f.observer.running());
  // No single completion flag can stand in for all three proofs.
  for(boolean stop:new boolean[]{false,true})for(boolean released:new boolean[]{false,true})for(boolean working:new boolean[]{false,true}){
   f=new Fixture();f.observer.start();f.needsStop=stop;f.released=released;f.working=working;f.advance(250);
   yes((f.completed==1)==(!stop&&released&&!working));
  }
  // A stale callback cannot mark the new attempt or route as recovered.
  for(int change=0;change<3;change++){
   f=new Fixture();f.accept=false;f.observer.start();Consumer<String> old=f.callbacks.get(0);
   if(change==0)f.owner=new Object();else if(change==1)f.binding="another-binding";else f.request="another-request";
   f.clean();old.accept("");f.advance(250);yes(f.completed==0&&!f.observer.running()&&f.failure.equals("VOICE_TARGET_CHANGED"));
  }
  // Returning link permits cleanup, never capture. Waiting is bounded without commands to another peer.
  f=new Fixture();f.connected=false;f.observer.start();f.advance(60000);yes(f.dispatched==0&&f.completed==0);f.connected=true;f.advance(2000);yes(f.dispatched==1&&f.completed==0);f.clean();f.advance(250);yes(f.completed==1);
  f=new Fixture();f.connected=false;f.observer.start();f.advance(120000);yes(!f.observer.running()&&f.dispatched==0&&f.failure.equals("VOICE_RECOVERY_TIMEOUT"));
  // Loaded empty store and clean old attempts are not completion events.
  f=new Fixture();f.owner=null;f.observer.start();yes(!f.observer.running()&&f.completed==0&&f.dispatched==0);
  f=new Fixture();f.clean();f.observer.start();yes(!f.observer.running()&&f.completed==0&&f.dispatched==0);
  f=new Fixture();f.loaded=false;f.observer.start();f.advance(2000);yes(f.dispatched==0);f.loaded=true;f.advance(1000);yes(f.dispatched==1);
  // Durable stop already finished, but the resource release failed: retry that cleanup too.
  f=new Fixture();f.needsStop=false;f.observer.start();yes(f.dispatched==1&&f.completed==0);f.clean();f.advance(250);yes(f.completed==1);
  for(int bad=0;bad<3;bad++){
   f=new Fixture();f.observer.start();f.clean();if(bad==0)f.healthy=false;else if(bad==1)f.blocked=true;else f.recovery=false;
   f.advance(250);yes(f.completed==0&&!f.observer.running()&&f.failure.equals("VOICE_RECOVERY_REQUIRED"));
  }
  // A request whose callback never arrives cannot keep the observer alive forever.
  f=new Fixture();f.accept=false;f.observer.start();f.clean();f.advance(120000);yes(f.completed==0&&f.dispatched==1&&!f.observer.running());f.callbacks.get(0).accept("");f.advance(250);yes(f.completed==0);
  // Failed dispatch is retried, duplicate callbacks from the old request are ignored.
  f=new Fixture();f.accept=false;f.observer.start();Consumer<String> first=f.callbacks.get(0);first.accept("VOICE_BUSY");f.advance(4999);yes(f.dispatched==1);f.advance(1);yes(f.dispatched==2);
  f.clean();first.accept("");f.advance(250);yes(f.completed==0);f.callbacks.get(1).accept("");f.advance(250);yes(f.completed==1);
  // Errors and synchronous throws keep obligations and terminate within a bounded retry budget.
  f=new Fixture();f.throwsDispatch=true;f.observer.start();f.advance(120000);yes(f.dispatched==InterruptedVoiceRecovery.MAX_REQUESTS&&f.completed==0&&!f.observer.running());
  f=new Fixture();f.observer.start();f.advance(120000);yes(f.dispatched==1&&f.completed==0&&f.failure.equals("VOICE_RECOVERY_TIMEOUT"));
  System.out.println("Interrupted voice recovery: "+checks+" checks passed");
 }
}
