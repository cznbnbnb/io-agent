package com.turboio.addon;

import java.util.*;

/** Two task-only policies (2026-10-23, user):
 * 1. Background answering: a registered agent question reaches the glasses, and a glasses-started
 *    dictation records, confirms and saves, with the phone screen off or the App in the background.
 *    Opt-out on the 眼镜任务卡 page (stored by AgentCardRuntime); stock prompter/recording are unchanged.
 * 2. While a task prompter, task card or task dictation is on the lens, a mirrored ordinary phone
 *    notification (business 21 type 2) is not sent, so it cannot cover the task. The phone keeps it.
 * Each hold is a lease its owner renews, so a stalled owner cannot hold notifications back for long.
 * Pure JVM: SuggestionGate, which calls this, is built in the host-policy tests. */
final class TaskAttention {
 private static volatile boolean background=true;
 private static final Map<String,Long> holds=new HashMap<>();
 private static long blocked;
 private TaskAttention(){}
 static boolean background(){return background;}
 static void background(boolean value){background=value;}
 static synchronized void hold(String owner,long millis){holds.put(owner,System.currentTimeMillis()+millis);}
 static synchronized void release(String owner){holds.remove(owner);}
 static synchronized boolean active(){long now=System.currentTimeMillis();holds.values().removeIf(until->until<=now);return !holds.isEmpty();}
 static synchronized String owners(){active();return String.join(",",new TreeSet<>(holds.keySet()));}
 /** True for a stock ordinary notification body while a task is on the lens: it is not sent. */
 static boolean blocksNotification(byte[] bytes){
  if(bytes==null||!active())return false;
  try{if(OtaFrame.decode(bytes).type!=2)return false;}catch(RuntimeException unknown){return false;}
  synchronized(TaskAttention.class){blocked++;}
  System.out.println("TurboIOCard ordinary notification held back during task owners="+owners());return true;
 }
 static synchronized long blockedCount(){return blocked;}
}
