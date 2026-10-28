package com.turboio.addon;

/** Color blocks shared by the task list, task detail, session picker and connections page:
 * one pair (text, background) per task status and per kind of Agent, so the two never look alike. */
final class TaskTones {
 private TaskTones(){}
 /** {text, background} for a task status. */
 static int[] status(TaskPresentation.Tone tone){
  switch(tone){
   case WAITING:return new int[]{MaterialReadingUI.AMBER,0xff2e2614};
   case RUNNING:return new int[]{MaterialReadingUI.ACCENT_SOFT,MaterialReadingUI.ACCENT_BG};
   case STOPPING:return new int[]{0xffb7a3e8,0xff241f33};
   case DONE:return new int[]{0xff9fd3bd,0xff1d2a24};
   case FAILED:return new int[]{MaterialReadingUI.CORAL_TEXT,MaterialReadingUI.CORAL_BG};
   case EXPIRED:return new int[]{0xff8a938f,0xff202422};
   default:return new int[]{MaterialReadingUI.SOFT,MaterialReadingUI.RAISED};
  }
 }
 static String label(TaskPresentation.Tone tone){
  switch(tone){case WAITING:return "待回复";case RUNNING:return "进行中";case STOPPING:return "已打断";case DONE:return "已完成";case ENDED:return "已结束";case FAILED:return "失败";default:return "已过期";}
 }
 /** {text, background} for an Agent: Claude (desktop) orange, Claude Code (background) sand, Codex blue, anything else neutral. */
 static int[] agent(String name){
  return name.equals("Claude Code")?new int[]{0xffd9b98c,0xff2c2519}:name.startsWith("Claude")?new int[]{0xffeaa57f,0xff33231a}:name.startsWith("Codex")?new int[]{0xff8ab8ff,0xff19263a}:new int[]{MaterialReadingUI.SOFT,MaterialReadingUI.RAISED};
 }

}
