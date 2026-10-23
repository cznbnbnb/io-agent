package com.turboio.addon;

import android.app.*;
import android.content.*;
import android.os.*;
import android.widget.*;
import java.io.*;
import java.lang.ref.WeakReference;
import java.util.*;
import java.util.concurrent.atomic.AtomicInteger;

/** Foreground request cards, owned SDK routing and durable answer/setting recovery. */
final class AgentCardRuntime {
 private static volatile AgentCardRuntime instance;
 private final Application app;private final TaskRuntime tasks;private final SharedPreferences prefs;
 private final Handler main=new Handler(Looper.getMainLooper());private final AtomicInteger queued=new AtomicInteger();
 private final Set<Activity> foreground=Collections.newSetFromMap(new WeakHashMap<Activity,Boolean>());
 private final Set<TextView> views=Collections.newSetFromMap(new WeakHashMap<TextView,Boolean>());
 private final Set<String> phoneFocus=new HashSet<>(),offered=new HashSet<>();
 private final String lease="agent-card-preflight-"+UUID.randomUUID();
 private final AtomicDocument document;private final AgentCardSession session;
 private TaskRuntime.Snapshot snapshot;private MinuteCardSession preflight;
 private WeakReference<Activity> activity;private volatile long observedGeneration=Long.MIN_VALUE;
 private boolean localLease,fetching,checkingShow,answerBusy,headStarted,restoreStarted,pumping;
 private long nextAuto,lastCleanupGeneration=Long.MIN_VALUE;private String lastCleanupOwner="",message="等待电脑问题",lastExport="";
 private static long now(){return SystemClock.elapsedRealtime();}
 private static void main(){if(Looper.myLooper()!=Looper.getMainLooper())throw new IllegalStateException("AGENT_CARD_THREAD");}
 private AgentCardRuntime(Activity host)throws IOException{
  app=(Application)host.getApplication();activity=new WeakReference<>(host);foreground.add(host);tasks=TaskRuntime.get(host);prefs=app.getSharedPreferences("io_agent_card_preferences_v1",0);offered.addAll(prefs.getStringSet("offered",Collections.emptySet()));
  document=new AtomicDocument(new File(app.getFilesDir(),"io-agent-card-v1.json"));session=new AgentCardSession(new AgentCardSession.Store(){public Object read()throws Exception{return document.read();}public void save(Object value)throws Exception{document.save(value);}});
  app.registerActivityLifecycleCallbacks(new Application.ActivityLifecycleCallbacks(){
   public void onActivityStarted(Activity a){foreground.add(a);activity=new WeakReference<>(a);}
   public void onActivityStopped(Activity a){foreground.remove(a);if(foreground.isEmpty())withdraw("App已切到后台，原问题留在手机");}
   public void onActivityDestroyed(Activity a){foreground.remove(a);}
   public void onActivityCreated(Activity a,Bundle b){}public void onActivityResumed(Activity a){}public void onActivityPaused(Activity a){}public void onActivitySaveInstanceState(Activity a,Bundle b){}
  });main.post(poll);tasks.read(null);
 }
 static void init(Activity host){main();if(instance==null)try{instance=new AgentCardRuntime(host);}catch(IOException unavailable){/* No durable state means phone answers only. */}}
 // Opt-in (2026-10-23, user): nod/shake answers only the final confirm card of a dictated answer.
 static boolean nodConfirm(){AgentCardRuntime r=instance;return r!=null&&r.prefs.getBoolean("nod_confirm",false);}
 static void nodConfirm(boolean value){main();AgentCardRuntime r=instance;if(r==null)return;if(!r.prefs.edit().putBoolean("nod_confirm",value).commit())r.message="设置未能保存";r.refresh();}
 static boolean enabled(){AgentCardRuntime r=instance;return r!=null&&r.prefs.getBoolean("enabled",true);}
 static void enabled(boolean value){main();AgentCardRuntime r=instance;if(r==null)return;if(!r.prefs.edit().putBoolean("enabled",value).commit()){r.message="设置未能保存";return;}if(!value)r.withdraw("已关闭眼镜提醒，原问题留在手机");r.refresh();}
 static void accept(TaskRuntime.Snapshot value){main();AgentCardRuntime r=instance;if(r!=null){r.snapshot=value;r.pump();}}
 static void pause(String binding){main();AgentCardRuntime r=instance;if(r!=null&&r.session.request()!=null&&(binding==null||r.session.request().binding.equals(binding)))r.withdraw("会话已暂停，原问题留在手机");}
 private static String focusKey(String binding,String request){return TaskWire.hash(WireJson.bytes(WireJson.object("binding",binding,"request",request)));}
 static void enterPhone(String binding,String request){main();AgentCardRuntime r=instance;if(r!=null){r.phoneFocus.add(focusKey(binding,request));if(r.session.request()!=null&&r.session.request().binding.equals(binding)&&r.session.request().requestId.equals(request))r.withdraw("已转到手机完整回答");}}
 static void leavePhone(String binding,String request){main();AgentCardRuntime r=instance;if(r!=null)r.phoneFocus.remove(focusKey(binding,request));}
 /** Only admits the voice preflight. A retired input closure is not proof of
  * mirror exit; the recording owner must still obtain fresh version/idle. */
 static boolean voiceHandoffReady(String binding,String request){
  main();AgentCardRuntime r=instance;
  return r!=null&&r.phoneFocus.contains(focusKey(binding,request))&&!r.fetching&&!r.checkingShow&&!r.answerBusy&&!r.pumping&&r.preflight==null&&!r.localLease&&r.queued.get()==0&&r.session.healthy()&&!r.session.pending()&&!r.session.working()&&(!r.session.cardMayExist()||r.session.closure()!=null)&&HeadGestureRuntime.voiceHandoffReady();
 }
 /** Shows a finished glasses-started dictation for confirmation; failure leaves saving on the phone. */
 static boolean offerConfirm(Activity host,String binding,String request,long revision,String text){main();AgentCardRuntime r=instance;if(r==null)return false;r.activity=new WeakReference<>(host);return r.offer(binding,request,revision,true,text);}
 /** Why the last glasses offer did not go ahead, for the page that asked. */
 static String lastMessage(){AgentCardRuntime r=instance;return r==null?"眼镜任务卡暂不可用":r.message;}
 static void offer(Activity host,String binding,String request,long revision){main();AgentCardRuntime r=instance;if(r==null){TaskWorkspace.notice(host,"眼镜任务卡暂不可用，请在手机回答");return;}r.activity=new WeakReference<>(host);r.offer(binding,request,revision,false);}
 private boolean visible(){return !foreground.isEmpty();}
 private boolean usable(){return visible()&&Host107Login.loggedIn()&&!FirmwareQueue.busy()&&!Fixed60OfficialRuntime.pending();}
 private TaskHub.View context(){AgentCardRequest r=session.request();return snapshot==null||r==null?null:snapshot.context(r.binding);}
 private boolean current(){AgentCardRequest r=session.request();TaskHub.View c=context();return r!=null&&c!=null&&c.profile.enabled&&r.matches(c.item("request",r.requestId),c.item("task",r.taskId),System.currentTimeMillis())&&(!hasAnswer(c,r.requestId,r.revision,r.operation())||session.hasSelection());}
 private static boolean hasAnswer(TaskHub.View c,String id,long revision,String except){
  for(Object raw:c.pending){Map<String,Object> row=WireJson.map(raw);Map<String,Object> event=WireJson.map(WireJson.read(((String)row.get("payload")).getBytes(java.nio.charset.StandardCharsets.UTF_8)));if(!"answer".equals(event.get("kind"))||Objects.equals(except,row.get("operation_id")))continue;Map<String,Object> answer=TaskWire.body(event);
   if(id.equals(answer.get("request_id"))&&revision==TaskWire.positive(answer.get("request_revision"))&&(Boolean.TRUE.equals(row.get("needs_lookup"))||!TaskWire.set("blocked","expired","withdrawn_local").contains(row.get("state"))))return true;
  }return false;
 }
 private void notice(String text,boolean automatic){message=text;if(!automatic){Activity host=activity.get();if(host!=null&&!host.isFinishing()&&!host.isDestroyed())TaskWorkspace.notice(host,text);}refresh();}
 private void offer(String binding,String request,long revision,boolean automatic){offer(binding,request,revision,automatic,null);}
 /** False when the offer was refused before any work started; the reason is in message. */
 private boolean offer(String binding,String request,long revision,boolean automatic,String confirm){
  if(!Host107Login.loggedIn()){notice(TaskWorkspace.label("OFFICIAL_LOGIN_REQUIRED"),automatic);nextAuto=now()+10000;return false;}
  if(fetching||preflight!=null||!session.canPrepare()||HeadGestureRuntime.pending()||!usable()){notice("眼镜正有操作或恢复待完成，问题保留在手机",automatic);nextAuto=now()+10000;return false;}
  fetching=true;tasks.detail(binding,"request",request,(state,error)->{
   fetching=false;snapshot=state;if(!error.isEmpty()){notice(TaskWorkspace.label(error),automatic);nextAuto=now()+10000;return;}
   try{if(!usable()||!session.canPrepare()||HeadGestureRuntime.pending())throw new IllegalArgumentException("TASK_GLASS_BUSY");TaskHub.View source=state.context(binding);TaskWire.require(source!=null&&source.profile.enabled,"TASK_PAUSED");Map<String,Object> fresh=source.item("request",request);TaskWire.require(fresh!=null&&TaskWire.positive(fresh.get("revision"))==revision,"TASK_REQUEST_CHANGED");
    TaskWire.require(!hasAnswer(source,request,revision,null),"TASK_ANSWER_ALREADY_SAVED");Map<String,Object> parent=source.item("task",(String)TaskWire.body(fresh).get("task_id"));
    if(confirm==null&&"prompter".equals(AgentCardRequest.route(TaskWire.body(fresh)))){if(!prompt(source,fresh,parent,automatic))notice(message,automatic);return;}
    AgentCardRequest frozen=confirm!=null?AgentCardRequest.prepareConfirm(source.profile.connection,fresh,parent,System.currentTimeMillis(),confirm):AgentCardRequest.prepare(source.profile.connection,fresh,parent,System.currentTimeMillis());
    Fixed60Session.Link link=Host107Ota.link();TaskWire.require(link.peer!=null&&!link.peer.isEmpty()&&NativeTransfer.acquireMessages(lease),"TASK_GLASS_BUSY");localLease=true;
    if(!session.prepare(frozen,link.peer,link.generation))throw new IllegalArgumentException("TASK_CARD_STORE_INVALID");
    TaskWire.require(offered.size()<200||offered.contains(frozen.owner),"TASK_GLASS_HISTORY_FULL");Set<String> next=new HashSet<>(offered);next.add(frozen.owner);TaskWire.require(prefs.edit().putStringSet("offered",next).commit(),"TASK_CONFIG_SAVE_FAILED");offered.clear();offered.addAll(next);
    preflight=new MinuteCardSession(new MinuteCardSession.Store(){public Object read(){return null;}public void save(Object value){throw new IllegalStateException();}});TaskWire.require(preflight.inspect(link.peer,link.generation,now(),false),"TASK_GLASS_BUSY");message="正在核对原眼镜状态";headStarted=restoreStarted=false;lastCleanupOwner="";checkingShow=false;pump();
   }catch(Exception bad){session.cancelUnshown();releaseLocal();notice(TaskWorkspace.label(TaskApi.safeError(bad)),automatic);nextAuto=now()+10000;}
  });
  return true;
 }
 private void maybeAuto(){
  if(!enabled()||!usable()||fetching||preflight!=null||!session.canPrepare()||HeadGestureRuntime.pending()||snapshot==null||now()<nextAuto)return;
  for(TaskHub.View c:snapshot.contexts)if(c.profile.enabled)for(Object raw:c.objects){Map<String,Object> item=WireJson.map(WireJson.map(raw).get("item"));if(!"request".equals(item.get("kind")))continue;Map<String,Object> b=TaskWire.body(item);String id=(String)item.get("object_id");long revision=TaskWire.positive(item.get("revision"));if(phoneFocus.contains(focusKey(c.binding,id))||hasAnswer(c,id,revision,null))continue;
   try{AgentCardRequest r=AgentCardRequest.prepare(c.profile.connection,item,c.item("task",(String)b.get("task_id")),System.currentTimeMillis());if(offered.contains(r.owner))continue;nextAuto=now()+10000;offer(c.binding,id,revision,true);return;}
   catch(RuntimeException notDisplayable){if("TASK_GLASS_PROMPTER".equals(notDisplayable.getMessage())&&!offered.contains(prompterKey(c.binding,item))){nextAuto=now()+10000;offer(c.binding,id,revision,true);return;}/* Otherwise the full question stays in the phone inbox. */}
  }
 }
 private static String prompterKey(String binding,Map<String,Object> request){return TaskWire.hash(WireJson.bytes(WireJson.object("prompter",binding,"request",TaskWire.requestFingerprint(request))));}
 static final int PROMPTER_SPEED=120;
 /** Long question on the prompter; the wearer's long-press exit opens this question's dictation. */
 private boolean prompt(TaskHub.View source,Map<String,Object> request,Map<String,Object> parent,boolean automatic){
  try{TaskWire.require(TaskWire.canAnswer(request,parent,System.currentTimeMillis()),"TASK_REQUEST_CLOSED");}catch(RuntimeException closed){message=TaskWorkspace.label("TASK_REQUEST_CLOSED");return false;}
  if(NewsTele.active()||NativeTransfer.fileBusy()||session.pending()||preflight!=null||HeadGestureRuntime.pending()){message="眼镜正有操作，长问题保留在手机";nextAuto=now()+10000;return false;}
  String key=prompterKey(source.binding,request);if(automatic&&offered.contains(key))return false;
  if(offered.size()>=200&&!offered.contains(key)){message=TaskWorkspace.label("TASK_GLASS_HISTORY_FULL");return false;}
  String binding=source.binding,id=(String)request.get("object_id"),fingerprint=TaskWire.requestFingerprint(request);long revision=TaskWire.positive(request.get("revision"));
  // Only a started manuscript counts as offered; a refused start (e.g. glasses still connecting) is retried.
  if(!NewsTele.start(AgentCardRequest.manuscript(TaskWire.body(request),TaskWire.body(parent)),PROMPTER_SPEED,()->openPrompterVoice(binding,id,revision,fingerprint))){message="提词器暂不可用："+NewsTele.status()+"；稍后自动重试，长问题保留在手机";nextAuto=now()+10000;refresh();return false;}
  Set<String> next=new HashSet<>(offered);next.add(key);if(prefs.edit().putStringSet("offered",next).commit()){offered.clear();offered.addAll(next);}
  message="长问题已发到眼镜提词器；看完长按退出后口述";refresh();return true;
 }
 private void openPrompterVoice(String binding,String id,long revision,String fingerprint){
  Activity host=activity.get();
  if(!visible()||host==null||host.isFinishing()||host.isDestroyed()){message="已退出提词器，请在手机打开原问题口述";refresh();return;}
  message="已退出提词器，正在打开原问题语音回答";refresh();VoiceAnswerWorkspace.show(host,binding,id,revision,fingerprint,()->tasks.read(null),true);
 }
 private void openVoice(AgentCardRequest voice){
  Activity host=activity.get();
  if(!visible()||host==null||host.isFinishing()||host.isDestroyed()){message="已在眼镜选择口述，请在手机打开原问题";refresh();return;}
  message="已在眼镜选择口述，正在打开原问题语音回答";refresh();
  VoiceAnswerWorkspace.show(host,voice.binding,voice.requestId,voice.revision,voice.fingerprint,()->tasks.read(null),true);
 }
 private void confirmVoice(AgentCardRequest voice){
  message=VoiceAnswerWorkspace.confirmFromGlasses(voice.binding,voice.requestId,voice.confirm)?"已在眼镜确认，正在保存并提交原文":"手机上的口述已变化或暂不能保存，请在手机核对后保存";refresh();
 }
 private void releaseLocal(){if(localLease){NativeTransfer.releaseMessages(lease);localLease=false;}}
 private void withdraw(String reason){
  if(preflight!=null){preflight.stop(reason);preflight=null;releaseLocal();}
  if(session.pending()){if(!session.cancelUnshown())session.suspend(reason);message=reason;lastCleanupOwner="";}pump();
 }
 private boolean claimCleanup(){if(HeadGestureRuntime.claimCleanup(session.owner()))return true;if(NativeTransfer.acquireMessages(lease)){localLease=true;return true;}return false;}
 private void persistChoice(){
  AgentCardSession.Answer answer=session.pendingAnswer();if(answer==null||answerBusy||!visible()||!Host107Login.loggedIn())return;TaskHub.View c=context();if(c==null||!c.profile.enabled)return;
  answerBusy=true;tasks.answerGlasses(answer.request.binding,answer.operation,answer.request.requestId,answer.request.revision,answer.option,answer.text,answer.request.fingerprint,(state,error)->{answerBusy=false;snapshot=state;session.answerStored(answer.operation,error.isEmpty(),error);message=error.isEmpty()?"选择已保存，正在核对并提交原问题":TaskWorkspace.label(error);pump();});
 }
 private void showAfterRefresh(){
  if(checkingShow||!current()||!HeadGestureRuntime.ready(session.owner()))return;checkingShow=true;String owner=session.owner();AgentCardRequest frozen=session.request();
  tasks.detail(frozen.binding,"request",frozen.requestId,(state,error)->{checkingShow=false;snapshot=state;if(!owner.equals(session.owner()))return;
   if(!error.isEmpty()||!usable()||!current()||!HeadGestureRuntime.ready(owner)){withdraw("原问题或连接尚未就绪，请在手机回答");return;}
   Fixed60Session.Link link=Host107Ota.link();if(!session.bindGuard(HeadGestureRuntime.token(owner))||!HeadGestureRuntime.cardMayShow(owner)||!session.show(link.peer,link.generation,now(),System.currentTimeMillis(),true)){withdraw("卡片保护未能完成，请在手机回答");return;}message=HeadGestureRuntime.keepsGestures()?"已提交确认卡；点头提交，摇头留手机，也可按键":"已提交眼镜卡片；仅明确按键选择才保存答案";pump();
  });
 }
 private void pump(){
  main();if(pumping)return;pumping=true;
  try{Fixed60Session.Link link=Host107Ota.link();observedGeneration=link.generation;
   if(preflight!=null){preflight.tick(link.peer,link.generation,now(),visible());if(preflight.phase().equals("READY")&&!preflight.working()){
     preflight=null;releaseLocal();headStarted=HeadGestureRuntime.begin(session.owner(),(ready,phase)->main.post(this::pump),nodConfirm()&&session.request()!=null&&session.request().confirm!=null);if(!headStarted){session.cancelUnshown();message="交互保护尚未就绪，请在手机回答";}else message="正在准备眼镜交互保护";
    }else if(!preflight.working()){message="眼镜状态检查未通过，请在手机回答";preflight=null;releaseLocal();session.cancelUnshown();}
    else{MinuteCardSession.Emission e=preflight.next(now());MinuteCardSession bound=preflight;if(e!=null)Host107Suggestion.send(link,e,ok->{if(preflight==bound){bound.result(e.ticket,ok,now());pump();}});}
   }
   boolean head=HeadGestureRuntime.ready(session.owner());
   if(preflight==null&&session.pending()&&session.phase().equals("PREPARING")){
    if(head)showAfterRefresh();else if(headStarted&&!HeadGestureRuntime.active(session.owner())){session.cancelUnshown();message="交互保护未确认，问题保留在手机";}
   }
   session.tick(link.peer,link.generation,now(),System.currentTimeMillis(),head,visible(),current());persistChoice();
   if(session.nextPageReady(now())){if(usable()&&current()&&HeadGestureRuntime.extendForPage(session.owner())&&HeadGestureRuntime.cardMayShow(session.owner())&&session.show(link.peer,link.generation,now(),System.currentTimeMillis(),true))message="已提交下一个完整选项";else session.suspend("下一选项暂不可显示，原问题留在手机");}
   if(session.pending()&&preflight==null&&TaskWire.set("RECOVERY_PENDING","CLEANUP_PENDING","ANSWER_SAVE_FAILED").contains(session.phase())&&(!lastCleanupOwner.equals(session.owner())||lastCleanupGeneration!=link.generation)){
    if(session.cancelUnshown()){releaseLocal();}
    else if(claimCleanup()&&session.cleanup(link.peer,link.generation)){lastCleanupOwner=session.owner();lastCleanupGeneration=link.generation;}
   }
   AgentCardSession.Emission e=session.next(link.peer,link.generation,now(),head);if(e!=null)Host107Suggestion.sendCard(link,session,e,ok->{session.result(e.ticket,ok,now());pump();});
   if(!session.pending()&&preflight==null){releaseLocal();if(HeadGestureRuntime.pending()&&!restoreStarted){CardInputClosure proof=session.closure();restoreStarted=proof!=null?HeadGestureRuntime.finishClosed(session.owner(),proof):HeadGestureRuntime.finish(session.owner(),false);}
    if(!HeadGestureRuntime.pending()){AgentCardRequest voice=session.takeVoiceHandoff(now());if(voice!=null)main.post(()->{if(voice.confirm!=null)confirmVoice(voice);else openVoice(voice);});}
    if(!HeadGestureRuntime.pending()&&!session.answerFailure().isEmpty()&&TaskWire.set("TASK_ANSWER_ALREADY_SAVED","TASK_REQUEST_CLOSED","REQUEST_CLOSED","TASK_REQUEST_CHANGED","EXPIRED").contains(session.answerFailure()))session.keepUnsentDraft();
   }
   maybeAuto();refresh();
  }catch(RuntimeException unavailable){message="眼镜操作暂停，原问题和已保存选择仍保留";if(session.pending())session.suspend(message);releaseLocal();refresh();}
  finally{pumping=false;}
 }
 private final Runnable poll=new Runnable(){public void run(){try{pump();}finally{main.postDelayed(this,250);}}};
 static boolean observe(String kind,Map<?,?> data){
  if(!"messageReceived".equals(kind)||data==null)return false;Object raw=data.get("message");if(!(raw instanceof Map))return false;Map<?,?> m=(Map<?,?>)raw;int business=HostBusiness.id(m.get("businessId"));Object payload=m.get("payload"),target=m.get("deviceId");if(!(payload instanceof byte[])||((byte[])payload).length>8192)return false;
  byte[] bytes=((byte[])payload).clone();boolean ours=business==21&&AgentCardSession.ownsOperation(bytes);
  // Private task UID events never reach the stock todo handler, including after restart/corruption.
  AgentCardRuntime r=instance;if(r==null)return ours;if(!ours&&business!=9)return false;
  if(!(target instanceof String)||((String)target).isEmpty()||((String)target).length()>256)return ours;
  if(r.queued.incrementAndGet()>16){r.queued.decrementAndGet();r.main.post(()->r.withdraw("设备事件过多，已暂停眼镜回答"));return ours;}
  String peer=(String)target;long gen=r.observedGeneration;boolean taskEvent=ours;
  r.main.post(()->{try{Fixed60Session.Link fresh=Host107Ota.link();if(taskEvent)r.session.receive(peer,gen,bytes,now(),System.currentTimeMillis(),r.usable()&&r.current()&&HeadGestureRuntime.permission(r.session.owner(),peer,gen));else if(r.preflight!=null)r.preflight.receive(peer,gen,9,bytes,now());r.pump();}finally{r.queued.decrementAndGet();}});return ours;
 }
 private String text(){return message+"\n"+(HeadGestureRuntime.pending()?"待办交互设置正在保护或恢复":"待办交互设置没有待恢复记录")+(session.cardMayExist()?"\n镜片实际退场尚未另行核对":"")+(!session.answerFailure().isEmpty()?"\n"+TaskWorkspace.label(session.answerFailure()):"");}
 private void refresh(){String text=text();for(TextView view:new ArrayList<>(views))view.setText(text);String state=new String(WireJson.bytes(WireJson.object("version",ProductInfo.VERSION,"phase",session.phase(),"healthy",session.healthy(),"pending",session.pending(),"card_may_exist",session.cardMayExist(),"has_selection",session.hasSelection(),"answer_failure",session.answerFailure(),"head_pending",HeadGestureRuntime.pending(),"head_status",HeadGestureRuntime.status(),"preflight",preflight==null?"":preflight.phase(),"fetching",fetching,"checking_show",checkingShow,"answer_busy",answerBusy,"drafts",session.drafts().size(),"message",message)),java.nio.charset.StandardCharsets.UTF_8);if(state.equals(lastExport))return;
  // 2026-10-23: the wearer saw the confirm card about a minute after dictation ended; each status change
  // is logged with its time so the slow step can be found (no question or answer text is logged).
  android.util.Log.i("TurboIOCard","card phase="+session.phase()+" pending="+session.pending()+" head="+HeadGestureRuntime.pending()+" preflight="+(preflight==null?"":preflight.phase())+" fetching="+fetching+" show="+checkingShow+" busy="+answerBusy+" msg="+message);
  try{File dir=app.getExternalFilesDir(null);if(dir!=null){try(FileOutputStream stream=new FileOutputStream(new File(dir,"io-agent-card-status.json"))){stream.write(state.getBytes(java.nio.charset.StandardCharsets.UTF_8));}lastExport=state;}}catch(IOException ignored){}
 }
 static void show(Activity host){init(host);AgentCardRuntime r=instance;if(r==null){TaskWorkspace.notice(host,"眼镜交互记录暂不可用，请在手机回答");return;}EditorialUI.Screen screen=new EditorialUI.Screen(host,"眼镜任务卡");TextView status=EditorialUI.text(host,r.text(),15,EditorialUI.INK);screen.body.addView(status);r.views.add(status);
  CheckBox automatic=new CheckBox(host);automatic.setText("新问题自动显示到眼镜");automatic.setTextColor(EditorialUI.INK);automatic.setChecked(enabled());automatic.setOnCheckedChangeListener((button,value)->enabled(value));screen.body.addView(automatic);
  CheckBox nod=new CheckBox(host);nod.setText("口述确认卡允许点头提交、摇头留手机（需原厂待办头势已开启；其他卡仍只认按键）");nod.setTextColor(EditorialUI.INK);nod.setChecked(nodConfirm());nod.setOnCheckedChangeListener((button,value)->nodConfirm(value));screen.body.addView(nod);
  EditorialUI.button(host,screen.body,"停止本次眼镜显示",false,()->r.withdraw("已停止本卡输入，原问题继续等待"));
  EditorialUI.button(host,screen.body,"重试清理与设置恢复",false,()->{r.lastCleanupOwner="";r.restoreStarted=false;r.withdraw("正在重试卡片清理与设置恢复");});
  EditorialUI.button(host,screen.body,"重试保存上次选择",false,()->{if(r.session.retryAnswer())r.pump();else TaskWorkspace.notice(host,"当前没有可重试的选择");});
  EditorialUI.button(host,screen.body,"保留未提交选择到手机草稿",false,()->{if(r.session.keepUnsentDraft())r.refresh();else TaskWorkspace.notice(host,"请先完成当前卡片清理，或重试保存选择");});
  EditorialUI.button(host,screen.body,"检查眼镜交互保护",false,()->HeadGestureRuntime.check(host));
  for(Object raw:r.session.drafts()){Map<String,Object> draft=WireJson.map(raw);AgentCardRequest request=AgentCardRequest.restore(draft.get("request"));int option=BoundedJson.number(draft.get("selected"),0,request.size()-1);LinearLayout card=EditorialUI.card(host,screen.body);TextView copy=EditorialUI.text(host,request.computer+" / "+request.agent+"\n"+TaskWire.body(WireJson.map(WireJson.map(request.json()).get("request"))).get("question")+"\n选择："+request.answerText(option)+"\n"+TaskWorkspace.label((String)draft.get("error")),15,EditorialUI.INK);copy.setTextIsSelectable(true);card.addView(copy);}
  screen.dialog.setOnDismissListener(dialog->r.views.remove(status));r.refresh();
 }
}
