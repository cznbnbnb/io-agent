package com.turboio.addon;

import android.app.*;import android.os.Bundle;import android.os.SystemClock;import android.text.*;import android.view.*;import android.widget.*;

/** Original-question voice review. Runtime alone owns source verification/capture. */
final class VoiceAnswerWorkspace {
 static String label(String code){if(code==null)return "语音状态暂不可用";switch(code){
  case "IDLE":return "正在核对原问题";case "PREPARED":case "prepared":case "voice_prepared":return "原问题已绑定，尚未开始采音";
  case "CAPTURING":case "capturing":return "正在接收口述";case "STOPPING":return "正在停止采音并核对结束状态";case "RECOVERY":case "VOICE_RECOVERY_REQUIRED":return "上次采音需要完成停止核对";
  case "REVIEW":case "review":return "口述已结束，请检查完整答案";case "VOICE_TIME_LIMIT":return "已到60秒采音上限：最后一句按截止时的识别保留，请核对；没说完可在这里补全后保存";case "INCOMPLETE":case "incomplete":return "口述尚不完整，已保留草稿";case "CANCELLED":case "cancelled":return "本次口述已停止，草稿保留";
  case "SUBMITTING":return "正在保存完整答案到本机";case "SAVED":return "完整答案已保存到本机";case "BLOCKED":return "语音记录需要核对，暂不能继续";
  case "VOICE_SOURCE_VERIFICATION_REQUIRED":return "开发者尚需完成真实声源与停止保护验证，当前不能开始口述，无需现在朗读。";
  case "VOICE_REQUEST_CHANGED":case "TASK_REQUEST_CHANGED":case "TASK_REVISION_CONFLICT":return "原问题内容或版本已变化，草稿保留，请返回重新查看问题";
  case "VOICE_REQUEST_CLOSED":case "TASK_REQUEST_CLOSED":case "REQUEST_CLOSED":case "REQUEST_NOT_FOUND":case "TASK_NOT_FOUND":return "原问题已结束或暂不可回答，草稿保留";
  case "VOICE_TARGET_CHANGED":case "TASK_TARGET_CHANGED":case "TASK_ROUTE_MISMATCH":return "当前语音草稿与原任务不一致，请返回原问题查看";
  case "VOICE_DRAFT_NOT_READY":case "VOICE_ANSWER_NOT_READY":case "VOICE_BUSY":case "VOICE_CAPTURE_BUSY":case "STORE_IN_USE":return "已有语音流程尚未结束，请先处理已有草稿或停止核对";
  case "VOICE_START_NOT_READY":case "VOICE_PREFLIGHT_NOT_READY":case "VOICE_PREFLIGHT_NOT_IDLE_OR_VALIDATED":case "VOICE_PREFLIGHT_IDLE_INVALID":case "VOICE_PREFLIGHT_VERSION_INVALID":return "眼镜尚未满足采音条件，请保持连接并等待其他功能结束";
  case "VOICE_GLASSES_BUSY":return "眼镜正忙，口述没有开始：语音助手或其他应用可能还没退出。可直接在这里回答，或回到眼镜桌面后重新口述";
  case "VOICE_PREFLIGHT_TIMEOUT":case "VOICE_PREFLIGHT_SUBMISSION_FAILED":case "VOICE_CONNECTION_CHANGED":return "眼镜连接或状态核对未完成，草稿保留";
  case "VOICE_STOP_QUERY_NOT_READY":case "VOICE_STOP_QUERY_FAILED":case "VOICE_STOP_QUERY_TIMEOUT":case "VOICE_STOP_SUBMISSION_UNCONFIRMED":case "VOICE_STOP_DISPATCH_FAILED":case "VOICE_STOP_OBLIGATION_INVALID":return "尚未确认采音停止，请保持眼镜连接并重试停止核对";
  case "VOICE_INTERRUPTED":return "语音流程曾中断，需要先完成停止核对";
  case "VOICE_ENGINE_ERROR":case "VOICE_ENGINE_UNAVAILABLE":case "VOICE_RECORDING_ACK_FAILED":case "VOICE_RECORDING_RECEIVER_FAILED":case "VOICE_RECORDING_BACKPRESSURE":case "VOICE_RECORDING_ENVELOPE_INVALID":case "VOICE_SOURCE_DISPATCH_FAILED":return "语音处理未能完成，正在保留草稿并停止采音";
  case "VOICE_RESULT_INCOMPLETE":case "VOICE_RESULT_INVALID":case "VOICE_RESULT_CONFLICT":case "VOICE_SEGMENT_BOUNDARY_UNCERTAIN":case "VOICE_COMPLETENESS_INVALID":return "口述完整性尚未确认，草稿保留，暂不能保存为答案";
  case "VOICE_TEXT_EMPTY":return "请保留完整的回答内容后再保存";case "VOICE_TRANSCRIPT_TOO_LONG":case "TASK_TEXT_INVALID":return "回答内容超出当前长度限制，完整草稿需先核对";
  case "VOICE_STORE_INVALID":case "VOICE_STORE_BUDGET":case "VOICE_FROZEN_TEXT_INVALID":return "本机语音记录需要核对，暂不能覆盖或提交";
  case "TASK_PAUSED":return "原任务连接已暂停，草稿保留";
  case "OFFICIAL_LOGIN_REQUIRED":return "官方账号登录已过期，草稿保留：打开官方 App 任一页面刷新后再保存";
  case "AUTH_REQUIRED":case "UNAUTHENTICATED":case "TASK_IMPORT_EXPIRED":return "原任务连接凭据已到期，草稿保留，请更新连接";
  case "TASK_ANSWER_ALREADY_SAVED":return "原问题已有保存的答案，请回到电脑任务查看提交状态";
  case "TASK_UNAVAILABLE":case "REFRESH_UNAVAILABLE":return "暂时无法核对原问题，草稿保留，请稍后重试";
  case "awaiting_refresh":case "queued":return "答案已保存在本机，等待核对原问题并提交";
  case "server_stored":return "服务器已确认保存答案";
  default:return "语音操作暂未完成，草稿状态需核对，请稍后重试";
 }}
 static void show(Activity activity,String binding,String requestId,long revision,String fingerprint,Runnable refresh){show(activity,binding,requestId,revision,fingerprint,refresh,false);}
 /** fromGlasses: the wearer pressed ＋ on this question's card, which is the explicit start. */
 static void show(Activity activity,String binding,String requestId,long revision,String fingerprint,Runnable refresh,boolean fromGlasses){new Page(activity,binding,requestId,revision,fingerprint,refresh,fromGlasses).open();}
 private static java.lang.ref.WeakReference<Page> glassesPage=new java.lang.ref.WeakReference<>(null);
 /** The confirm card was accepted: save only if the open page still shows exactly that unedited draft. */
 static boolean confirmFromGlasses(String binding,String requestId,String text){Page page=glassesPage.get();if(page!=null&&page.confirmed(binding,requestId,text))return true;Headless h=headless;return h!=null&&h.confirmed(binding,requestId,text);}
 private static Headless headless;
 /** Glasses-started dictation with no App page (screen off, App in background). */
 static void showHeadless(Application app,TaskRuntime tasks,String binding,String requestId,long revision,String fingerprint,Runnable refresh){
  if(headless!=null)headless.close("replaced");new Headless(VoiceAnswerRuntime.get(app,tasks),binding,requestId,revision,fingerprint,refresh).open();
 }
 /** The page's glasses steps without UI (2026-10-23, user: dictation must work with the screen off):
  * prepare, start once within 20 s, let the wearer end on the glasses or at 60 s, offer the unedited
  * transcript to the confirm card, and save only when that card is confirmed. Anything else leaves
  * the draft on the phone, where opening the question resumes it. Closes itself after 5 minutes. */
 private static final class Headless {
  static final long LIFETIME_MS=300000;
  final VoiceAnswerRuntime runtime;final String binding,requestId,fingerprint;final long revision;final Runnable refresh;
  final android.os.Handler main=new android.os.Handler(android.os.Looper.getMainLooper());
  final long autoUntil=SystemClock.elapsedRealtime()+20000;final VoiceAnswerRuntime.Observer observer=value->main.post(()->render(value));
  final Runnable expire=()->close("lifetime");
  boolean autoStart=true,busy,closed,glassesSave,started,busyNoticed;String offeredText;long retryAt;VoiceAnswerRuntime.Snapshot latest;
  Headless(VoiceAnswerRuntime runtime,String binding,String requestId,long revision,String fingerprint,Runnable refresh){this.runtime=runtime;this.binding=binding;this.requestId=requestId;this.revision=revision;this.fingerprint=fingerprint;this.refresh=refresh;}
  void open(){headless=this;AgentCardRuntime.enterPhone(binding,requestId);runtime.keepInBackground(this,true);busy=true;runtime.observeHeadless(observer);main.postDelayed(expire,LIFETIME_MS);android.util.Log.i("TurboIOVoice","headless open");runtime.prepare(binding,requestId,revision,fingerprint,this::completed);}
  boolean owned(){return latest!=null&&binding.equals(latest.binding)&&requestId.equals(latest.requestId);}
  void completed(VoiceAnswerRuntime.Snapshot value,String code){main.post(()->{if(closed)return;busy=false;boolean failed=code!=null&&!code.isEmpty();noticeBusy(code,value);if(failed){glassesSave=false;android.util.Log.i("TurboIOVoice","headless step failed: "+code);}
   if(glassesSave&&"SAVED".equals(value.phase)){close("saved");return;}
   if(failed&&!value.needsStop&&!"REVIEW".equals(value.phase)){close("failed");return;}render(value);});}
  void render(VoiceAnswerRuntime.Snapshot value){
   if(closed||value==null)return;latest=value;if(!owned())return;noticeBusy("",value);if(busy)return;
   if(autoStart&&(!TaskWire.set("IDLE","PREPARED").contains(value.phase)||SystemClock.elapsedRealtime()>=autoUntil)){autoStart=false;if(!started&&!value.needsStop&&!"REVIEW".equals(value.phase)){close("not started");return;}}
   if(autoStart&&value.canStart){autoStart=false;started=true;busy=true;runtime.start(this::completed);return;}
   if(autoStart&&"PREPARED".equals(value.phase))main.postDelayed(()->{if(!closed&&latest!=null)render(latest);},1000);
   if(TaskWire.set("CANCELLED","INCOMPLETE","BLOCKED").contains(value.phase)&&!value.needsStop){close(value.phase);return;}
   if("SAVED".equals(value.phase)&&!value.needsStop){close("saved");return;}
   if("REVIEW".equals(value.phase)&&value.canSave&&value.cleaned&&!value.needsStop&&value.text!=null&&!value.text.equals(offeredText)&&SystemClock.elapsedRealtime()>=retryAt){
    if(AgentCardRuntime.offerConfirm(null,binding,requestId,revision,value.text)){offeredText=value.text;android.util.Log.i("TurboIOVoice","headless confirm offered");}
    else{android.util.Log.i("TurboIOVoice","headless confirm refused: "+AgentCardRuntime.lastMessage());retryAt=SystemClock.elapsedRealtime()+3000;main.postDelayed(()->{if(!closed&&latest!=null)render(latest);},3100);}
   }
  }
  void noticeBusy(String code,VoiceAnswerRuntime.Snapshot value){if(!busyNoticed&&("VOICE_GLASSES_BUSY".equals(code)||value!=null&&"VOICE_GLASSES_BUSY".equals(value.note))){busyNoticed=true;AgentCardRuntime.glassesBusy();}}
  boolean confirmed(String b,String r,String expected){
   if(closed||!binding.equals(b)||!requestId.equals(r)||!owned()||busy||!"REVIEW".equals(latest.phase)||!latest.canSave||!expected.equals(latest.text))return false;
   glassesSave=true;busy=true;runtime.edit(expected,(value,code)->main.post(()->{if(closed)return;if(code!=null&&!code.isEmpty()){completed(value,code);return;}runtime.save(this::completed);}));return true;
  }
  void close(String why){
   if(closed)return;closed=true;main.removeCallbacks(expire);android.util.Log.i("TurboIOVoice","headless close: "+why);
   if(latest!=null&&owned()&&latest.needsStop)runtime.stop(true,(value,code)->{});
   AgentCardRuntime.leavePhone(binding,requestId);runtime.unobserveHeadless(observer);runtime.keepInBackground(this,false);if(headless==this)headless=null;if(refresh!=null)refresh.run();
  }
 }
 private static final class Page {
  final Activity activity;final String binding,requestId,fingerprint;final long revision;final Runnable refresh;
  final VoiceAnswerRuntime runtime;final EditorialUI.Screen screen;final TextView status,explanation,localState;final EditText text;final LinearLayout actions,editor;
  final VoiceAnswerRuntime.Observer observer;final Application application;final Application.ActivityLifecycleCallbacks lifecycle;
  final boolean fromGlasses;final long autoUntil;boolean autoStart,glassesSave,busyNoticed;String offeredText,refused="";long retryAt;
  VoiceAnswerRuntime.Snapshot latest;boolean closed,busy,dirty,programmatic,exitPending,exitStopRequested;String error="";
  Page(Activity activity,String binding,String requestId,long revision,String fingerprint,Runnable refresh,boolean fromGlasses){
   this.fromGlasses=autoStart=fromGlasses;autoUntil=SystemClock.elapsedRealtime()+20000;
   this.activity=activity;this.binding=binding;this.requestId=requestId;this.revision=revision;this.fingerprint=fingerprint;this.refresh=refresh;runtime=VoiceAnswerRuntime.get(activity);application=(Application)activity.getApplicationContext();
   screen=new EditorialUI.Screen(activity,"原问题语音回答");agentLook(activity,screen);status=MaterialReadingUI.bold(AgentUI.text(activity,"正在核对原问题…",20,AgentUI.INK));screen.body.addView(status);AgentUI.gap(activity,screen.body,8);
   explanation=AgentUI.text(activity,fromGlasses?"已在眼镜上选择口述回答。眼镜就绪后自动开始采音，说完点“结束口述并检查全文”。":"口述答案始终返回刚才的问题及原任务。准备完成后仍需明确点击开始。",14,AgentUI.MUTED);screen.body.addView(explanation);
   // The transcript sits in the Agent workspace's dark card; amber marks stay legible on it.
   editor=AgentUI.column(activity);editor.setPadding(AgentUI.dp(activity,16),AgentUI.dp(activity,14),AgentUI.dp(activity,16),AgentUI.dp(activity,12));editor.setBackground(frame(activity,false));
   editor.addView(AgentUI.text(activity,"完整原话（可直接改字）",12,AgentUI.MUTED));
   text=new EditText(new ContextThemeWrapper(activity,android.R.style.Theme_Material_NoActionBar));text.setBackground(null);text.setPadding(0,AgentUI.dp(activity,8),0,0);text.setTextSize(18);text.setLineSpacing(AgentUI.dp(activity,5),1);text.setGravity(Gravity.TOP|Gravity.START);
   text.setTextColor(AgentUI.INK);text.setHintTextColor(AgentUI.MUTED);text.setHint("完整口述及附加条件将显示在这里，结束后可检查和更正");text.setInputType(InputType.TYPE_CLASS_TEXT|InputType.TYPE_TEXT_FLAG_MULTI_LINE);text.setMinLines(5);text.setEnabled(false);editor.addView(text,new LinearLayout.LayoutParams(-1,-2));
   LinearLayout.LayoutParams ep=new LinearLayout.LayoutParams(-1,-2);ep.topMargin=AgentUI.dp(activity,18);screen.body.addView(editor,ep);
   localState=AgentUI.text(activity,"完整答案先保存到本机；服务器接收、电脑继续执行的状态分别在电脑任务页显示。",12,AgentUI.MUTED);localState.setPadding(0,AgentUI.dp(activity,10),0,AgentUI.dp(activity,4));screen.body.addView(localState);
   // Never silently truncate dictated/user-edited text. The durable layer validates
   // its length and keeps the full draft if it cannot be accepted.
   text.addTextChangedListener(new TextWatcher(){public void beforeTextChanged(CharSequence s,int start,int count,int after){}public void onTextChanged(CharSequence s,int start,int before,int count){if(!programmatic){dirty=true;if(fromGlasses)AgentCardRuntime.enterPhone(binding,requestId);}}public void afterTextChanged(Editable e){markRisky(e);}});
   actions=AgentUI.column(activity);screen.body.addView(actions);
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
  void open(){if(fromGlasses){glassesPage=new java.lang.ref.WeakReference<>(this);AgentCardRuntime.enterPhone(binding,requestId);runtime.keepInBackground(this,true);}application.registerActivityLifecycleCallbacks(lifecycle);busy=true;runtime.observe(activity,observer);runtime.prepare(binding,requestId,revision,fingerprint,this::completed);}
  boolean owned(){return latest!=null&&binding.equals(latest.binding)&&requestId.equals(latest.requestId);}
  void detach(){if(closed)return;closed=true;if(fromGlasses){AgentCardRuntime.leavePhone(binding,requestId);runtime.keepInBackground(this,false);}runtime.unobserve(observer);application.unregisterActivityLifecycleCallbacks(lifecycle);}
  void completed(VoiceAnswerRuntime.Snapshot value,String code){activity.runOnUiThread(()->{if(closed||activity.isDestroyed())return;busy=false;if(fromGlasses)android.util.Log.i("TurboIOVoice","page step done code="+code+" phase="+(value==null?null:value.phase)+" canStart="+(value!=null&&value.canStart)+" auto="+autoStart);if(code!=null&&!code.isEmpty()){exitPending=false;glassesSave=false;}render(value,code);if(glassesSave&&"SAVED".equals(value.phase)&&!closed){glassesSave=false;leave();return;}if(exitPending&&!closed){if(owned()&&value.needsStop&&!exitStopRequested){exitStopRequested=true;begin();runtime.stop(true,this::completed);}else if(!owned())leave();}});}
  void render(VoiceAnswerRuntime.Snapshot value,String code){
   if(closed||activity.isDestroyed()||value==null)return;latest=value;if(code!=null&&!code.isEmpty())error=code;
   boolean same=owned();if(!same){status.setText(error.isEmpty()?"正在核对原问题…":label(error));text.setEnabled(false);actions.removeAllViews();EditorialUI.button(activity,actions,"返回原问题",false,this::exit);return;}
   boolean review="REVIEW".equals(value.phase);
   if(fromGlasses&&!busyNoticed&&("VOICE_GLASSES_BUSY".equals(error)||"VOICE_GLASSES_BUSY".equals(value.note))){busyNoticed=true;AgentCardRuntime.glassesBusy();}
   // A note that only repeats the phase (e.g. "review") carries no extra information.
   boolean note=value.note!=null&&!value.note.isEmpty()&&!label(value.note).equals(label(value.phase));
   status.setText(error.isEmpty()?label(value.phase):label(error));explanation.setText(autoStart&&!"VOICE_SOURCE_VERIFICATION_REQUIRED".equals(value.note)?"已在眼镜上选择口述回答。眼镜就绪后自动开始采音，说完点“结束口述并检查全文”。":"VOICE_SOURCE_VERIFICATION_REQUIRED".equals(value.note)?label(value.note):note?label(value.note):review?"标黄的是数字和“不/没/别”等否定词，识别错一个字意思可能相反，请再看一眼。有误可直接改字，或重新口述。":"停止采音只结束本次口述，不会取消电脑任务。完整附加条件会随答案保留。");
   localState.setText(exitPending?"退出前正在停止采音或保留编辑；确认结束后会返回，草稿保留。":"SAVED".equals(value.phase)?"完整答案已保存到本机。请在电脑任务页查看服务器保存和原任务继续的回执。":"完整答案先保存到本机；服务器接收和电脑执行状态另行核对。");
   if(!dirty&&!text.getText().toString().equals(value.text==null?"":value.text)){programmatic=true;text.setText(value.text==null?"":value.text);programmatic=false;}
   boolean editable=!busy&&value.canSave&&"REVIEW".equals(value.phase);text.setEnabled(editable);editor.setBackground(frame(activity,editable));actions.removeAllViews();
   // Only a fresh PREPARED draft may auto-start; a retained review/saved draft, an error or a stale page never records.
   // 2026-10-23 R2: while this page's own prepare runs, the runtime may still show the same question's
   // interrupted attempt (CANCELLED after a restart recovery); that must not switch auto-start off.
   if(autoStart&&!busy&&(!TaskWire.set("IDLE","PREPARED").contains(value.phase)||!error.isEmpty()||SystemClock.elapsedRealtime()>=autoUntil)){autoStart=false;android.util.Log.i("TurboIOVoice","page auto-start off phase="+value.phase+" error="+error+" late="+(SystemClock.elapsedRealtime()>=autoUntil));}
   if(fromGlasses&&autoStart&&"PREPARED".equals(value.phase))android.util.Log.i("TurboIOVoice","page prepared canStart="+value.canStart+" busy="+busy+" note="+value.note);
   if(autoStart&&value.canStart&&!busy){autoStart=false;begin();runtime.start(this::completed);return;}
   if(value.canStart)button("开始用眼镜口述",true,()->{begin();runtime.start(this::completed);});
   if(value.needsStop){button("结束口述并检查全文",true,()->{begin();runtime.stop(false,this::completed);});button("停止本次口述并保留草稿",false,()->{begin();runtime.stop(true,this::completed);});if(!"CAPTURING".equals(value.phase))button("重试停止核对",false,()->{begin();runtime.retryCleanup(this::completed);});}
   // Glasses-started dictation: the finished, unedited draft is offered once per text for knob confirmation.
   // A refused offer (busy glasses, expired login) is retried every 3 s while this exact draft is on screen.
   if(fromGlasses&&review&&value.canSave&&value.cleaned&&!value.needsStop&&!busy&&!dirty&&value.text!=null&&!value.text.equals(offeredText)&&SystemClock.elapsedRealtime()>=retryAt){
    if(AgentCardRuntime.offerConfirm(activity,binding,requestId,revision,value.text)){offeredText=value.text;refused="";android.util.Log.i("TurboIOVoice","confirm offered");}
    else{refused=AgentCardRuntime.lastMessage();android.util.Log.i("TurboIOVoice","confirm refused: "+refused);retryAt=SystemClock.elapsedRealtime()+3000;text.postDelayed(()->{if(!closed&&latest!=null)render(latest,"");},3100);}
   }
   if(fromGlasses&&review&&!dirty&&value.text!=null&&value.text.equals(offeredText))localState.setText("识别文字已提交给眼镜确认卡：眼镜上出现后按＋提交；没出现或按删除，就在这里核对后保存。");
   else if(fromGlasses&&review&&!dirty&&!refused.isEmpty())localState.setText("确认卡暂未发到眼镜："+refused+"。稍后自动重试，也可以在这里核对后保存。");
   if(value.canSave)button("保存并回复电脑",true,this::save);
   if(review&&value.cleaned&&!value.needsStop)button("识别有误，重新口述",false,this::redo);
   button("SAVED".equals(value.phase)?"返回查看提交状态":"返回原问题",false,this::exit);
   if(exitPending&&!busy&&!value.needsStop&&value.cleaned)leave();
  }
  void button(String title,boolean primary,Runnable action){TextView button=AgentUI.button(activity,actions,title,primary,action);button.setEnabled(!busy);if(busy)button.setAlpha(.45f);}
  /** Same palette as the task pages: dark green ground, card surface, green outline while editable. */
  static void agentLook(Activity a,EditorialUI.Screen s){
   s.root.setBackground(new android.graphics.drawable.GradientDrawable(android.graphics.drawable.GradientDrawable.Orientation.TOP_BOTTOM,new int[]{0xff123529,AgentUI.BG,AgentUI.BG}));
   Window w=s.dialog.getWindow();if(w!=null){w.setStatusBarColor(0xff123529);w.setNavigationBarColor(AgentUI.BG);}
   ViewGroup header=(ViewGroup)s.root.getChildAt(0);for(int i=0;i<header.getChildCount();i++){View child=header.getChildAt(i);if(!(child instanceof TextView))continue;TextView t=(TextView)child;
    if("返回".contentEquals(t.getContentDescription()==null?"":t.getContentDescription())){t.setTextColor(AgentUI.MUTED);t.setTextSize(28);}else{t.setTextSize(18);t.setTextColor(AgentUI.INK);}}
  }
  static android.graphics.drawable.GradientDrawable frame(Activity a,boolean editable){android.graphics.drawable.GradientDrawable d=MaterialReadingUI.fill(a,AgentUI.SURFACE,18);d.setStroke(AgentUI.dp(a,editable?2:1),editable?AgentUI.ACCENT:0xff34463b);return d;}
  void begin(){error="";busy=true;if(latest!=null)render(latest,"");}
  void save(){if(!owned()||!latest.canSave||busy)return;String complete=text.getText().toString();begin();
   if("REVIEW".equals(latest.phase))runtime.edit(complete,(value,code)->activity.runOnUiThread(()->{if(closed||activity.isDestroyed())return;if(code!=null&&!code.isEmpty()){completed(value,code);return;}dirty=false;runtime.save(this::completed);}));
   else runtime.save(this::completed); // Frozen SUBMITTING/SAVED operations cannot be edited.
  }
  /** Marks digits, Chinese numerals and negations in amber: one misheard character there flips the meaning.
   * Style only; the text itself (and so every draft comparison) is unchanged. */
  static void markRisky(Editable e){
   for(Risky old:e.getSpans(0,e.length(),Risky.class))e.removeSpan(old);
   java.util.regex.Matcher m=RISKY.matcher(e);while(m.find())e.setSpan(new Risky(),m.start(),m.end(),Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
  }
  static final java.util.regex.Pattern RISKY=java.util.regex.Pattern.compile("[0-9０-９]+(?:[.:：．][0-9０-９]+)*|[零〇一二两三四五六七八九十百千万亿半]+|[不没别无未勿莫否]");
  static final class Risky extends android.text.style.CharacterStyle implements android.text.style.UpdateAppearance{@Override public void updateDrawState(TextPaint paint){paint.bgColor=MaterialReadingUI.AMBER_BG;paint.setColor(MaterialReadingUI.AMBER_TEXT);}}
  /** The current text, including manual edits, is retired with the draft; it stays in the local record only. */
  void redo(){if(!owned()||busy||!"REVIEW".equals(latest.phase))return;
   AgentUI.confirm(activity,"重新口述？","当前识别文字和改动将不会作为答案，只保留在本机记录中。之后需要重新点击开始口述。","重新口述",
    ()->{if(!owned()||busy||!"REVIEW".equals(latest.phase))return;dirty=false;begin();runtime.redo(binding,requestId,revision,fingerprint,this::completed);});
  }
  boolean confirmed(String b,String r,String expected){
   if(closed||activity.isDestroyed()||!binding.equals(b)||!requestId.equals(r)||!owned()||busy||dirty||!"REVIEW".equals(latest.phase)||!latest.canSave||!expected.equals(latest.text)||!expected.equals(text.getText().toString()))return false;
   glassesSave=true;save();return true;
  }
  void leave(){screen.dialog.dismiss();if(refresh!=null)refresh.run();}
  void exit(){if(closed)return;if(busy){exitPending=true;return;}if(owned()&&latest.needsStop){exitPending=true;exitStopRequested=true;begin();runtime.stop(true,this::completed);return;}
   if(owned()&&dirty&&latest.canSave&&"REVIEW".equals(latest.phase)){String complete=text.getText().toString();exitPending=true;begin();runtime.edit(complete,(value,code)->{if(code==null||code.isEmpty())dirty=false;completed(value,code);});return;}leave();}
 }
}
