package com.turboio.addon;

/** 2026-10-23 R2: how long a task prompter session may hold the glasses after something goes wrong.
 * A failed session used to stay "uncertain" until the user confirmed the lens by hand, so powering
 * the glasses off during an agent question blocked every later long question ("眼镜正有操作").
 * Task sessions (agent questions, notices) keep their content on the phone, so they are released
 * when the glasses link is gone or the show period is over; a same-DID frame after reconnect still
 * re-adopts the session through the persisted owner. The user's own news session keeps the manual
 * confirmation. */
final class PrompterLease {
 enum Step{KEEP,EXIT,RELEASE,UNCERTAIN}
 private PrompterLease(){}
 /** A failure (link change, missing receipt, SDK rejection) on an open session. */
 static Step failed(boolean taskOwned,boolean linked,boolean expired){
  if(!taskOwned)return Step.UNCERTAIN;
  return !linked||expired?Step.RELEASE:Step.UNCERTAIN;
 }
 /** The show period of a task session ends. */
 static Step expiry(boolean taskOwned,String phase){
  if(!taskOwned)return Step.KEEP;
  if(phase.equals("uncertain"))return Step.RELEASE;
  return phase.equals("closing")?Step.KEEP:Step.EXIT;
 }
}
