package com.turboio.addon;

import java.util.function.Consumer;

/** Observes one original interrupted attempt. Dispatch acceptance is not stop or release proof. */
final class InterruptedVoiceRecovery {
 static final long LIMIT_MS=120000;
 static final int MAX_REQUESTS=12;
 static final class State {
  final Object owner;final String binding,request;
  final boolean loaded,blocked,healthy,recovery,needsStop,released,working,connected;
  State(Object owner,String binding,String request,boolean loaded,boolean blocked,boolean healthy,boolean recovery,boolean needsStop,boolean released,boolean working,boolean connected){
   this.owner=owner;this.binding=binding;this.request=request;this.loaded=loaded;this.blocked=blocked;this.healthy=healthy;this.recovery=recovery;this.needsStop=needsStop;this.released=released;this.working=working;this.connected=connected;
  }
 }
 interface Port {
  long now();State state();void later(Runnable action,long delay);
  void cleanup(Consumer<String> dispatched);void recovered(String binding,String request);void incomplete(String reason);
 }
 private final Port port;private final long deadline;private boolean running=true,pending;private int ticket,requests;private State target;
 InterruptedVoiceRecovery(Port port){this.port=port;deadline=port.now()+LIMIT_MS;}
 boolean running(){return running;}
 void start(){poll();}
 private void stop(String reason){running=false;ticket++;if(!reason.isEmpty())port.incomplete(reason);}
 private void later(long delay){int mine=++ticket;port.later(()->{if(running&&mine==ticket)poll();},delay);}
 private void poll(){
  if(!running)return;
  if(port.now()>=deadline){stop("VOICE_RECOVERY_TIMEOUT");return;}
  State s=port.state();
  if(!s.loaded){later(1000);return;}
  if(s.blocked){stop("VOICE_RECOVERY_REQUIRED");return;}
  if(target==null){
   if(s.owner==null||!s.recovery||!s.needsStop&&s.released){stop("");return;}
   target=s;
  }
  if(s.owner!=target.owner||!target.binding.equals(s.binding)||!target.request.equals(s.request)){stop("VOICE_TARGET_CHANGED");return;}
  if(!s.healthy||!s.recovery){stop("VOICE_RECOVERY_REQUIRED");return;}
  if(!pending&&!s.working&&!s.needsStop&&s.released){stop("");port.recovered(target.binding,target.request);return;}
  if(pending||s.working){later(250);return;}
  if(!s.connected){later(2000);return;}
  if(requests>=MAX_REQUESTS){stop("VOICE_RECOVERY_REQUIRED");return;}
  int request=++requests;pending=true;later(250);
  // The callback only says the cleanup request was dispatched. Re-read the same
  // attempt after the asynchronous stop, idle proof and resource release settle.
  try{port.cleanup(error->{if(!running||!pending||request!=requests)return;pending=false;later(error==null||error.isEmpty()?250:5000);});}
  catch(RuntimeException failure){pending=false;later(5000);}
 }
}
