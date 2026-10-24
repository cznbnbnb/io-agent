package com.turboio.addon;

/** Device-independent checks that a failed task prompter session cannot hold the glasses forever. */
public final class PrompterLeaseTest {
 static int checks;
 static void yes(boolean value){checks++;if(!value)throw new AssertionError("prompter lease check "+checks);}
 public static void main(String[] args){
  PrompterLease.Step K=PrompterLease.Step.KEEP,E=PrompterLease.Step.EXIT,R=PrompterLease.Step.RELEASE,U=PrompterLease.Step.UNCERTAIN;
  // Glasses powered off or link changed during an agent question: released at once, not "uncertain".
  yes(PrompterLease.failed(true,false,false)==R);yes(PrompterLease.failed(true,false,true)==R);
  // Missing receipt while still linked: wait for the show period, then the phone lets go.
  yes(PrompterLease.failed(true,true,false)==U);yes(PrompterLease.failed(true,true,true)==R);
  // The user's own news session keeps the manual lens confirmation in every case.
  for(boolean linked:new boolean[]{true,false})for(boolean expired:new boolean[]{true,false})yes(PrompterLease.failed(false,linked,expired)==U);
  // Show period end: running sessions are asked to exit, an uncertain one is released, a pending
  // exit waits for its own receipt deadline (which then fails as expired and is released).
  for(String phase:new String[]{"prepare","file","ready","starting","playing","paused","recovering"})yes(PrompterLease.expiry(true,phase)==E);
  yes(PrompterLease.expiry(true,"uncertain")==R);yes(PrompterLease.expiry(true,"closing")==K);
  for(String phase:new String[]{"playing","uncertain","closing"})yes(PrompterLease.expiry(false,phase)==K);
  // Power-off sequence end to end: playing -> link lost -> released; nothing is left to block.
  yes(PrompterLease.failed(true,false,false)!=U);
  // Unlinked expiry sequence: playing -> exit asked -> send fails (unlinked) -> released.
  yes(PrompterLease.expiry(true,"playing")==E&&PrompterLease.failed(true,false,true)==R);
  System.out.println("prompter lease: "+checks+" assertions passed");
 }
}
