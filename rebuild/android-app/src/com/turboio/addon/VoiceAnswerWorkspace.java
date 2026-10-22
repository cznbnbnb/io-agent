package com.turboio.addon;

import android.app.*;import android.os.Bundle;import android.text.*;import android.view.*;import android.widget.*;

/** Original-question voice review. Runtime alone owns source verification/capture. */
final class VoiceAnswerWorkspace {
 static String label(String code){if(code==null)return "语音状态暂不可用";switch(code){
  case "IDLE":return "正在核对原问题";case "PREPARED":case "prepared":case "voice_prepared":return "原问题已绑定，尚未开始采音";
  case "CAPTURING":case "capturing":return "正在接收口述";case "STOPPING":return "正在停止采音并核对结束状态";case "RECOVERY":case "VOICE_RECOVERY_REQUIRED":return "上次采音需要完成停止核对";
  case "REVIEW":case "review":return "口述已结束，请检查完整答案";case "INCOMPLETE":case "incomplete":return "口述尚不完整，已保留草稿";case "CANCELLED":case "cancelled":return "本次口述已停止，草稿保留";
  case "SUBMITTING":return "正在保存完整答案到本机";case "SAVED":return "完整答案已保存到本机";case "BLOCKED":return "语音记录需要核对，暂不能继续";
  case "VOICE_SOURCE_VERIFICATION_REQUIRED":return "开发者尚需完成真实声源与停止保护验证，当前不能开始口述，无需现在朗读。";
  case "VOICE_REQUEST_CHANGED":case "TASK_REQUEST_CHANGED":case "TASK_REVISION_CONFLICT":return "原问题内容或版本已变化，草稿保留，请返回重新查看问题";
  case "VOICE_REQUEST_CLOSED":case "TASK_REQUEST_CLOSED":case "REQUEST_CLOSED":case "REQUEST_NOT_FOUND":case "TASK_NOT_FOUND":return "原问题已结束或暂不可回答，草稿保留";
  case "VOICE_TARGET_CHANGED":case "TASK_TARGET_CHANGED":case "TASK_ROUTE_MISMATCH":return "当前语音草稿与原任务不一致，请返回原问题查看";
  case "VOICE_DRAFT_NOT_READY":case "VOICE_ANSWER_NOT_READY":case "VOICE_BUSY":case "VOICE_CAPTURE_BUSY":case "STORE_IN_USE":return "已有语音流程尚未结束，请先处理已有草稿或停止核对";
  case "VOICE_START_NOT_READY":case "VOICE_PREFLIGHT_NOT_READY":case "VOICE_PREFLIGHT_NOT_IDLE_OR_VALIDATED":return "眼镜尚未满足采音条件，请保持连接并等待其他功能结束";
  case "VOICE_PREFLIGHT_TIMEOUT":case "VOICE_PREFLIGHT_SUBMISSION_FAILED":case "VOICE_CONNECTION_CHANGED":return "眼镜连接或状态核对未完成，草稿保留";
  case "VOICE_STOP_QUERY_NOT_READY":case "VOICE_STOP_QUERY_FAILED":case "VOICE_STOP_QUERY_TIMEOUT":case "VOICE_STOP_SUBMISSION_UNCONFIRMED":case "VOICE_STOP_DISPATCH_FAILED":case "VOICE_STOP_OBLIGATION_INVALID":return "尚未确认采音停止，请保持眼镜连接并重试停止核对";
  case "VOICE_INTERRUPTED":return "语音流程曾中断，需要先完成停止核对";
  case "VOICE_ENGINE_ERROR":case "VOICE_ENGINE_UNAVAILABLE":case "VOICE_RECORDING_ACK_FAILED":case "VOICE_RECORDING_RECEIVER_FAILED":case "VOICE_RECORDING_BACKPRESSURE":case "VOICE_RECORDING_ENVELOPE_INVALID":case "VOICE_SOURCE_DISPATCH_FAILED":return "语音处理未能完成，正在保留草稿并停止采音";
  case "VOICE_RESULT_INCOMPLETE":case "VOICE_RESULT_INVALID":case "VOICE_RESULT_CONFLICT":case "VOICE_SEGMENT_BOUNDARY_UNCERTAIN":case "VOICE_COMPLETENESS_INVALID":return "口述完整性尚未确认，草稿保留，暂不能保存为答案";
  case "VOICE_TEXT_EMPTY":return "请保留完整的回答内容后再保存";case "VOICE_TRANSCRIPT_TOO_LONG":case "TASK_TEXT_INVALID":return "回答内容超出当前长度限制，完整草稿需先核对";
  case "VOICE_STORE_INVALID":case "VOICE_STORE_BUDGET":case "VOICE_FROZEN_TEXT_INVALID":return "本机语音记录需要核对，暂不能覆盖或提交";
  case "TASK_PAUSED":return "原任务连接已暂停，草稿保留";
  case "AUTH_REQUIRED":case "UNAUTHENTICATED":case "TASK_IMPORT_EXPIRED":return "原任务连接凭据已到期，草稿保留，请更新连接";
  case "TASK_ANSWER_ALREADY_SAVED":return "原问题已有保存的答案，请回到电脑任务查看提交状态";
  case "TASK_UNAVAILABLE":case "REFRESH_UNAVAILABLE":return "暂时无法核对原问题，草稿保留，请稍后重试";
  case "awaiting_refresh":case "queued":return "答案已保存在本机，等待核对原问题并提交";
  case "server_stored":return "服务器已确认保存答案";
  default:return "语音操作暂未完成，草稿状态需核对，请稍后重试";
 }}
 static void show(Activity activity,String binding,String requestId,long revision,String fingerprint,Runnable refresh){new Page(activity,binding,requestId,revision,fingerprint,refresh).open();}
 private static final class Page {
  final Activity activity;final String binding,requestId,fingerprint;final long revision;final Runnable refresh;
  final VoiceAnswerRuntime runtime;final EditorialUI.Screen screen;final TextView status,explanation,localState;final EditText text;final LinearLayout actions;
  final VoiceAnswerRuntime.Observer observer;final Application application;final Application.ActivityLifecycleCallbacks lifecycle;
  VoiceAnswerRuntime.Snapshot latest;boolean closed,busy,dirty,programmatic,exitPending,exitStopRequested;String error="";
  Page(Activity activity,String binding,String requestId,long revision,String fingerprint,Runnable refresh){
   this.activity=activity;this.binding=binding;this.requestId=requestId;this.revision=revision;this.fingerprint=fingerprint;this.refresh=refresh;runtime=VoiceAnswerRuntime.get(activity);application=(Application)activity.getApplicationContext();
   screen=new EditorialUI.Screen(activity,"原问题语音回答");status=EditorialUI.text(activity,"正在核对原问题…",20,EditorialUI.INK);screen.body.addView(status);
   explanation=EditorialUI.text(activity,"口述答案始终返回刚才的问题及原任务。准备完成后仍需明确点击开始。",14,EditorialUI.MUTED);screen.body.addView(explanation);
   localState=EditorialUI.text(activity,"完整答案先保存到本机；服务器接收、电脑继续执行的状态分别在电脑任务页显示。",14,EditorialUI.MUTED);screen.body.addView(localState);
   text=new EditText(activity);text.setTextColor(EditorialUI.INK);text.setHintTextColor(EditorialUI.MUTED);text.setHint("完整口述及附加条件将显示在这里，结束后可检查和更正");text.setInputType(InputType.TYPE_CLASS_TEXT|InputType.TYPE_TEXT_FLAG_MULTI_LINE);text.setMinLines(7);text.setEnabled(false);screen.body.addView(text,new LinearLayout.LayoutParams(-1,-2));
   // Never silently truncate dictated/user-edited text. The durable layer validates
   // its length and keeps the full draft if it cannot be accepted.
   text.addTextChangedListener(new TextWatcher(){public void beforeTextChanged(CharSequence s,int start,int count,int after){}public void onTextChanged(CharSequence s,int start,int before,int count){if(!programmatic)dirty=true;}public void afterTextChanged(Editable e){}});
   actions=EditorialUI.column(activity);screen.body.addView(actions);
   observer=value->activity.runOnUiThread(()->render(value,""));
   lifecycle=new Application.ActivityLifecycleCallbacks(){
    public void onActivityDestroyed(Activity a){if(a==activity){if(owned()&&(busy||latest.needsStop))runtime.stop(true,(value,code)->{});detach();}}
    public void onActivityCreated(Activity a,Bundle b){}public void onActivityStarted(Activity a){}public void onActivityResumed(Activity a){}public void onActivityPaused(Activity a){}public void onActivityStopped(Activity a){}public void onActivitySaveInstanceState(Activity a,Bundle b){}
   };
   screen.dialog.setCanceledOnTouchOutside(false);screen.dialog.setCancelable(false);
   screen.dialog.setOnKeyListener((dialog,key,event)->{if(key!=KeyEvent.KEYCODE_BACK)return false;if(event.getAction()==KeyEvent.ACTION_UP)exit();return true;});
   ViewGroup header=(ViewGroup)screen.root.getChildAt(0);for(int i=0;i<header.getChildCount();i++){View child=header.getChildAt(i);if("返回".contentEquals(child.getContentDescription()==null?"":child.getContentDescription()))child.setOnClickListener(v->exit());}
   screen.dialog.setOnDismissListener(dialog->{if(owned()&&(busy||latest.needsStop))runtime.stop(true,(value,code)->{});detach();});
  }
  void open(){application.registerActivityLifecycleCallbacks(lifecycle);busy=true;runtime.observe(activity,observer);runtime.prepare(binding,requestId,revision,fingerprint,this::completed);}
  boolean owned(){return latest!=null&&binding.equals(latest.binding)&&requestId.equals(latest.requestId);}
  void detach(){if(closed)return;closed=true;runtime.unobserve(observer);application.unregisterActivityLifecycleCallbacks(lifecycle);}
  void completed(VoiceAnswerRuntime.Snapshot value,String code){activity.runOnUiThread(()->{if(closed||activity.isDestroyed())return;busy=false;if(code!=null&&!code.isEmpty())exitPending=false;render(value,code);if(exitPending&&!closed){if(owned()&&value.needsStop&&!exitStopRequested){exitStopRequested=true;begin();runtime.stop(true,this::completed);}else if(!owned())leave();}});}
  void render(VoiceAnswerRuntime.Snapshot value,String code){
   if(closed||activity.isDestroyed()||value==null)return;latest=value;if(code!=null&&!code.isEmpty())error=code;
   boolean same=owned();if(!same){status.setText(error.isEmpty()?"正在核对原问题…":label(error));text.setEnabled(false);actions.removeAllViews();EditorialUI.button(activity,actions,"返回原问题",false,this::exit);return;}
   status.setText(error.isEmpty()?label(value.phase):label(error));explanation.setText("VOICE_SOURCE_VERIFICATION_REQUIRED".equals(value.note)?label(value.note):value.note!=null&&!value.note.isEmpty()?label(value.note):"停止采音只结束本次口述，不会取消电脑任务。完整附加条件会随答案保留。");
   localState.setText(exitPending?"退出前正在停止采音或保留编辑；确认结束后会返回，草稿保留。":"SAVED".equals(value.phase)?"完整答案已保存到本机。请在电脑任务页查看服务器保存和原任务继续的回执。":"完整答案先保存到本机；服务器接收和电脑执行状态另行核对。");
   if(!dirty&&!text.getText().toString().equals(value.text==null?"":value.text)){programmatic=true;text.setText(value.text==null?"":value.text);programmatic=false;}
   text.setEnabled(!busy&&value.canSave&&"REVIEW".equals(value.phase));actions.removeAllViews();
   if(value.canStart)button("开始用眼镜口述",true,()->{begin();runtime.start(this::completed);});
   if(value.needsStop){button("结束口述并检查全文",true,()->{begin();runtime.stop(false,this::completed);});button("停止本次口述并保留草稿",false,()->{begin();runtime.stop(true,this::completed);});if(!"CAPTURING".equals(value.phase))button("重试停止核对",false,()->{begin();runtime.retryCleanup(this::completed);});}
   if(value.canSave)button("保存完整口述答案",true,this::save);
   button("SAVED".equals(value.phase)?"返回查看提交状态":"返回原问题",false,this::exit);
   if(exitPending&&!busy&&!value.needsStop&&value.cleaned)leave();
  }
  void button(String title,boolean primary,Runnable action){TextView button=EditorialUI.button(activity,actions,title,primary,action);button.setEnabled(!busy);}
  void begin(){error="";busy=true;if(latest!=null)render(latest,"");}
  void save(){if(!owned()||!latest.canSave||busy)return;String complete=text.getText().toString();begin();
   if("REVIEW".equals(latest.phase))runtime.edit(complete,(value,code)->activity.runOnUiThread(()->{if(closed||activity.isDestroyed())return;if(code!=null&&!code.isEmpty()){completed(value,code);return;}dirty=false;runtime.save(this::completed);}));
   else runtime.save(this::completed); // Frozen SUBMITTING/SAVED operations cannot be edited.
  }
  void leave(){screen.dialog.dismiss();if(refresh!=null)refresh.run();}
  void exit(){if(closed)return;if(busy){exitPending=true;return;}if(owned()&&latest.needsStop){exitPending=true;exitStopRequested=true;begin();runtime.stop(true,this::completed);return;}
   if(owned()&&dirty&&latest.canSave&&"REVIEW".equals(latest.phase)){String complete=text.getText().toString();exitPending=true;begin();runtime.edit(complete,(value,code)->{if(code==null||code.isEmpty())dirty=false;completed(value,code);});return;}leave();}
 }
}
