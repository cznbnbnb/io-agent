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
 // Questions whose interrupted dictation was closed after a restart; offered again once.
 private final Set<String> reoffer=new HashSet<>(),cancelledPrompters=new HashSet<>(),noticeChecks=new HashSet<>(),questionChecks=new HashSet<>(),retiredPrompters=new HashSet<>();
 private long nextAuto,lastCleanupGeneration=Long.MIN_VALUE;private String lastCleanupOwner="",message="等待电脑问题",lastExport="";
 private static long now(){return SystemClock.elapsedRealtime();}
 private static void main(){if(Looper.myLooper()!=Looper.getMainLooper())throw new IllegalStateException("AGENT_CARD_THREAD");}
 private AgentCardRuntime(Application application,Activity host)throws IOException{
  app=application;activity=new WeakReference<>(host);if(host!=null)foreground.add(host);tasks=host!=null?TaskRuntime.get(host):TaskRuntime.boot(application);prefs=app.getSharedPreferences("io_agent_card_preferences_v1",0);offered.addAll(prefs.getStringSet("offered",Collections.emptySet()));TaskAttention.background(prefs.getBoolean("background_answer",true));
  NewsTele.orphans=this::orphan;
  NewsTele.closed=did->{retiredPrompters.add(did);TaskPrompterNotice notice=prompterNotice();if(notice!=null&&notice.did.equals(did))prefs.edit().remove("prompter_notice_owner").commit();};
  VoiceAnswerRuntime.get(app,tasks).recoverInterrupted((binding,request)->{reoffer.add(binding+"\n"+request);message="口述被中断，已结束眼镜录音；这道题会重新发到眼镜";nextAuto=0;refresh();pump();});
  document=new AtomicDocument(new File(app.getFilesDir(),"io-agent-card-v1.json"));session=new AgentCardSession(new AgentCardSession.Store(){public Object read()throws Exception{return document.read();}public void save(Object value)throws Exception{document.save(value);}});
  app.registerActivityLifecycleCallbacks(new Application.ActivityLifecycleCallbacks(){
   public void onActivityStarted(Activity a){foreground.add(a);activity=new WeakReference<>(a);}
   public void onActivityStopped(Activity a){foreground.remove(a);if(foreground.isEmpty()&&!TaskAttention.background())withdraw("App已切到后台，原问题留在手机");}
   public void onActivityDestroyed(Activity a){foreground.remove(a);}
   public void onActivityCreated(Activity a,Bundle b){}public void onActivityResumed(Activity a){}public void onActivityPaused(Activity a){}public void onActivitySaveInstanceState(Activity a,Bundle b){}
  });main.post(poll);tasks.read(null);
 }
 static void init(Activity host){main();if(instance==null)try{instance=new AgentCardRuntime(host.getApplication(),host);}catch(IOException unavailable){/* No durable state means phone answers only. */}
  else if(instance.foreground.add(host))instance.activity=new WeakReference<>(host);}
 /** Started by TurboAddon.boot before any screen; the first resumed screen joins through init. */
 static void boot(Application application){main();if(instance==null)try{instance=new AgentCardRuntime(application,null);}catch(IOException unavailable){/* Phone answers only. */}}
 // Opt-in (2026-10-23, user): nod/shake answers only the final confirm card of a dictated answer.
 static boolean nodConfirm(){AgentCardRuntime r=instance;return r!=null&&r.prefs.getBoolean("nod_confirm",false);}
 static void nodConfirm(boolean value){main();AgentCardRuntime r=instance;if(r==null)return;if(!r.prefs.edit().putBoolean("nod_confirm",value).commit())r.message="设置未能保存";r.refresh();}
 static boolean backgroundAnswer(){return TaskAttention.background();}
 static void backgroundAnswer(boolean value){main();AgentCardRuntime r=instance;if(r==null)return;if(!r.prefs.edit().putBoolean("background_answer",value).commit()){r.message="设置未能保存";return;}TaskAttention.background(value);if(!value&&!r.visible())r.withdraw("已关闭后台回答，原问题留在手机");r.refresh();}
 static boolean enabled(){AgentCardRuntime r=instance;return r!=null&&r.prefs.getBoolean("enabled",true);}
 static void enabled(boolean value){main();AgentCardRuntime r=instance;if(r==null)return;if(!r.prefs.edit().putBoolean("enabled",value).commit()){r.message="设置未能保存";return;}if(!value)r.withdraw("已关闭眼镜提醒，原问题留在手机");r.refresh();}
 static void accept(TaskRuntime.Snapshot value){main();AgentCardRuntime r=instance;if(r!=null){r.snapshot=value;r.pump();}}
 static void pause(String binding){main();AgentCardRuntime r=instance;if(r!=null){r.withdrawPrompter(binding,null,"会话已暂停，原问题留在手机");if(r.session.request()!=null&&(binding==null||r.session.request().binding.equals(binding)))r.withdrawCard("会话已暂停，原问题留在手机");}}
 private static String focusKey(String binding,String request){return TaskWire.hash(WireJson.bytes(WireJson.object("binding",binding,"request",request)));}
 static void enterPhone(String binding,String request){main();AgentCardRuntime r=instance;if(r!=null){r.phoneFocus.add(focusKey(binding,request));r.withdrawPrompter(binding,request,"已转到手机完整回答");if(r.session.request()!=null&&r.session.request().binding.equals(binding)&&r.session.request().requestId.equals(request))r.withdrawCard("已转到手机完整回答");}}
 static void leavePhone(String binding,String request){main();AgentCardRuntime r=instance;if(r!=null)r.phoneFocus.remove(focusKey(binding,request));}
 /** Only admits the voice preflight. A retired input closure is not proof of
  * mirror exit; the recording owner must still obtain fresh version/idle. */
 /** Diagnostic: which voiceHandoffReady condition is false (2026-10-23 R2, dictation stuck at PREPARED). */
 static String handoffBlockers(String binding,String request){
  AgentCardRuntime r=instance;if(r==null)return "no-runtime";StringBuilder b=new StringBuilder();
  if(!r.phoneFocus.contains(focusKey(binding,request)))b.append(" focus");if(r.fetching)b.append(" fetching");if(r.checkingShow)b.append(" checkingShow");if(r.answerBusy)b.append(" answerBusy");if(r.pumping)b.append(" pumping");
  if(r.preflight!=null)b.append(" preflight");if(r.localLease)b.append(" localLease");if(r.queued.get()!=0)b.append(" queued=").append(r.queued.get());if(!r.session.healthy())b.append(" unhealthy");if(r.session.pending())b.append(" pending");
  if(r.session.working())b.append(" working");if(r.session.cardMayExist()&&r.session.closure()==null)b.append(" cardMayExist");if(!HeadGestureRuntime.voiceHandoffReady())b.append(" head");return b.toString();
 }
 static boolean voiceHandoffReady(String binding,String request){
  main();AgentCardRuntime r=instance;
  return r!=null&&r.phoneFocus.contains(focusKey(binding,request))&&!r.fetching&&!r.checkingShow&&!r.answerBusy&&!r.pumping&&r.preflight==null&&!r.localLease&&r.queued.get()==0&&r.session.healthy()&&!r.session.pending()&&!r.session.working()&&(!r.session.cardMayExist()||r.session.closure()!=null)&&HeadGestureRuntime.voiceHandoffReady();
 }
 /** Shows a finished glasses-started dictation for confirmation; failure leaves saving on the phone. */
 static boolean offerConfirm(Activity host,String binding,String request,long revision,String text){main();AgentCardRuntime r=instance;if(r==null)return false;if(host!=null)r.activity=new WeakReference<>(host);return r.offer(binding,request,revision,true,text);}
 /** Why the last glasses offer did not go ahead, for the page that asked. */
 static String lastMessage(){AgentCardRuntime r=instance;return r==null?"眼镜任务卡暂不可用":r.message;}
 static void offer(Activity host,String binding,String request,long revision){main();AgentCardRuntime r=instance;if(r==null){TaskWorkspace.notice(host,"眼镜任务卡暂不可用，请在手机回答");return;}r.activity=new WeakReference<>(host);r.offer(binding,request,revision,false);}
 private boolean visible(){return !foreground.isEmpty();}
 /** The App is on screen, or the wearer allowed answering with the screen off / App in background. */
 private boolean attended(){return visible()||TaskAttention.background();}
 private boolean usable(){return attended()&&Host107Login.loggedIn()&&!FirmwareQueue.busy()&&!Fixed60OfficialRuntime.pending();}
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
    showCard(source,fresh,parent,confirm);
   }catch(Exception bad){session.cancelUnshown();releaseLocal();notice(TaskWorkspace.label(TaskApi.safeError(bad)),automatic);nextAuto=now()+10000;}
  });
  return true;
 }
 private void showCard(TaskHub.View source,Map<String,Object> fresh,Map<String,Object> parent,String confirm)throws Exception{
    AgentCardRequest frozen=confirm!=null?AgentCardRequest.prepareConfirm(source.profile.connection,fresh,parent,System.currentTimeMillis(),confirm):AgentCardRequest.prepare(source.profile.connection,fresh,parent,System.currentTimeMillis());
    Fixed60Session.Link link=Host107Ota.link();TaskWire.require(link.peer!=null&&!link.peer.isEmpty()&&NativeTransfer.acquireMessages(lease),"TASK_GLASS_BUSY");localLease=true;
    if(!session.prepare(frozen,link.peer,link.generation))throw new IllegalArgumentException("TASK_CARD_STORE_INVALID");
    TaskWire.require(offered.size()<200||offered.contains(frozen.owner),"TASK_GLASS_HISTORY_FULL");Set<String> next=new HashSet<>(offered);next.add(frozen.owner);TaskWire.require(prefs.edit().putStringSet("offered",next).commit(),"TASK_CONFIG_SAVE_FAILED");offered.clear();offered.addAll(next);
    preflight=new MinuteCardSession(new MinuteCardSession.Store(){public Object read(){return null;}public void save(Object value){throw new IllegalStateException();}});TaskWire.require(preflight.inspect(link.peer,link.generation,now(),false),"TASK_GLASS_BUSY");message="正在核对原眼镜状态";headStarted=restoreStarted=false;lastCleanupOwner="";checkingShow=false;pump();
 }
 private void maybeAuto(){
  if(!enabled()||!usable()||fetching||preflight!=null||!session.canPrepare()||HeadGestureRuntime.pending()||snapshot==null||now()<nextAuto)return;
  for(TaskHub.View c:snapshot.contexts)if(c.profile.enabled)for(Object raw:c.objects){Map<String,Object> item=WireJson.map(WireJson.map(raw).get("item"));if(!"request".equals(item.get("kind")))continue;Map<String,Object> b=TaskWire.body(item);String id=(String)item.get("object_id");long revision=TaskWire.positive(item.get("revision"));if(phoneFocus.contains(focusKey(c.binding,id))||hasAnswer(c,id,revision,null))continue;
   if(reoffer.remove(c.binding+"\n"+id)){forget(prompterKey(c.binding,item));try{forget(AgentCardRequest.prepare(c.profile.connection,item,c.item("task",(String)b.get("task_id")),System.currentTimeMillis()).owner);}catch(RuntimeException prompterOnly){}}
   try{AgentCardRequest r=AgentCardRequest.prepare(c.profile.connection,item,c.item("task",(String)b.get("task_id")),System.currentTimeMillis());if(offered.contains(r.owner))continue;nextAuto=now()+10000;offer(c.binding,id,revision,true);return;}
   catch(RuntimeException notDisplayable){if("TASK_GLASS_PROMPTER".equals(notDisplayable.getMessage())&&!offered.contains(prompterKey(c.binding,item))){nextAuto=now()+10000;offer(c.binding,id,revision,true);return;}/* Otherwise the full question stays in the phone inbox. */}
  }
  maybeNotice();
 }
 private void maybeNotice(){
  if(TaskAttention.active()||NewsTele.active()||NativeTransfer.busy())return;
  for(TaskHub.View c:snapshot.contexts)if(c.profile.enabled)for(Object raw:c.objects){
   Map<String,Object> item=WireJson.map(WireJson.map(raw).get("item"));if(!"message".equals(item.get("kind")))continue;
   try{TaskNotice notice=TaskNotice.prepare(c.profile.connection,item,c.item("task",(String)TaskWire.body(item).get("task_id")),System.currentTimeMillis());
    if(offered.contains(notice.key)||offered.contains(notice.legacy)||offered.size()>=200)continue;
    nextAuto=now()+10000;if(!noticePrompt(notice.text,notice.expires-System.currentTimeMillis(),c.binding))return;
    Set<String> next=new HashSet<>(offered);next.add(notice.key);
    if(!prefs.edit().putStringSet("offered",next).commit()){NewsTele.control(6);message="通知显示记录未保存，内容保留在手机";return;}
    offered.clear();offered.addAll(next);message="任务提醒已提交到眼镜；长按退出，无需回答";return;
   }catch(RuntimeException closedOrUnrelated){/* Expired/closed/other progress stays in the phone history. */}
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
  // Only a started manuscript counts as offered; a refused start (e.g. glasses still connecting) is retried.
  long startedAt=System.currentTimeMillis(),until=TaskPrompterOwner.deadline(source.profile.connection,request,startedAt);String[] display={""};
  if(!NewsTele.question(AgentCardRequest.manuscript(TaskWire.body(request),TaskWire.body(parent)),PROMPTER_SPEED,until-startedAt,()->openPrompterVoice(display[0]))){message="提词器暂不可用："+NewsTele.status()+"；稍后自动重试，长问题保留在手机";nextAuto=now()+10000;refresh();return false;}
  display[0]=NewsTele.did();TaskPrompterOwner owner=TaskPrompterOwner.create(display[0],NativeTransfer.connected(),source.profile.connection,request,startedAt);
  Set<String> next=new HashSet<>(offered);next.add(key);
  if(!prefs.edit().putStringSet("offered",next).putString("prompter_owner",owner.encode()).commit()){NewsTele.cancelTask(display[0]);message="显示记录未保存，已请求退出；问题保留在手机";return false;}
  offered.clear();offered.addAll(next);
  message="长问题已发到眼镜提词器；看完长按退出后口述";refresh();return true;
 }
 private void forget(String key){if(!offered.contains(key))return;Set<String> next=new HashSet<>(offered);next.remove(key);if(prefs.edit().putStringSet("offered",next).commit()){offered.clear();offered.addAll(next);}}
 private TaskPrompterNotice prompterNotice(){return TaskPrompterNotice.read(prefs.getString("prompter_notice_owner","{}"));}
 private boolean noticePrompt(String text,long duration,String binding){
  long started=System.currentTimeMillis();if(!NewsTele.notice(text,duration))return false;
  TaskPrompterNotice owner=TaskPrompterNotice.create(NewsTele.did(),NativeTransfer.connected(),binding,duration,started);
  if(prefs.edit().putString("prompter_notice_owner",owner.encode()).commit())return true;
  NewsTele.cancelTask(owner.did);return false;
 }
 private boolean noticeAllowed(TaskPrompterNotice owner){
  if(!enabled()||!attended()||cancelledPrompters.contains(owner.did))return false;
  if(owner.binding==null||snapshot==null)return true;TaskHub.View c=snapshot.context(owner.binding);
  return c!=null&&c.profile.enabled&&c.profile.connection.expiresAt>System.currentTimeMillis();
 }
 private TaskPrompterOwner prompter(){return TaskPrompterOwner.read(prefs.getString("prompter_owner","{}"));}
 private boolean prompterAllowed(TaskPrompterOwner owner,TaskRuntime.Snapshot state){
  if(owner==null||cancelledPrompters.contains(owner.did)||state==null||!enabled()||!attended())return false;TaskHub.View c=state.context(owner.binding);if(c==null)return false;
  Map<String,Object> request=c.item("request",owner.id),parent=request==null?null:c.item("task",(String)TaskWire.body(request).get("task_id"));
  return owner.allows(c.profile.connection,c.profile.enabled,request,parent,phoneFocus.contains(focusKey(owner.binding,owner.id)),hasAnswer(c,owner.id,owner.revision,null),System.currentTimeMillis());
 }
 private void withdrawPrompter(String binding,String id,String reason){
  TaskPrompterNotice notice=prompterNotice();if(id==null&&notice!=null&&notice.matches(binding)){
   cancelledPrompters.add(notice.did);if(!notice.cancelled)prefs.edit().putString("prompter_notice_owner",notice.cancel().encode()).commit();
   if(NewsTele.cancelTask(notice.did))message=reason;
  }
  TaskPrompterOwner owner=prompter();if(owner==null||!owner.matches(binding,id))return;
  // Persist withdrawal even if the process has not re-adopted its manuscript yet.
  cancelledPrompters.add(owner.did);
  if(!owner.cancelled)prefs.edit().putString("prompter_owner",owner.cancel().encode()).commit();
  if(NewsTele.cancelTask(owner.did))message=reason;
 }
 private void checkPrompter(){
  TaskPrompterNotice notice=prompterNotice();
  if(notice!=null&&NewsTele.canRecoverTask(notice.did)&&notice.peer.equals(NativeTransfer.connected())){
   String attempt=notice.did+"@"+Host107Ota.link().generation;
   if(!noticeChecks.contains(attempt)&&NewsTele.recoverNotice(notice.did,notice.peer,notice.remaining(NativeTransfer.connected(),noticeAllowed(notice),System.currentTimeMillis())))noticeChecks.add(attempt);
  }
  if(notice!=null&&notice.did.equals(NewsTele.did())&&notice.remaining(NativeTransfer.connected(),noticeAllowed(notice),System.currentTimeMillis())<=0)withdrawPrompter(notice.binding,null,"通知显示已结束，正在退出提词器");
  TaskPrompterOwner owner=prompter();if(owner==null)return;
  if(NewsTele.canRecoverTask(owner.did)&&!retiredPrompters.contains(owner.did)&&!owner.peer.isEmpty()&&owner.peer.equals(NativeTransfer.connected())){
   String attempt=owner.did+"@"+Host107Ota.link().generation;
   if(!questionChecks.contains(attempt)){
    NewsTele.Adoption adoption=orphan(owner.did);
    if(adoption!=null&&NewsTele.recoverTask(owner.did,owner.peer,adoption.remaining,adoption.exited))questionChecks.add(attempt);
   }
  }
  if(!owner.did.equals(NewsTele.did()))return;
  // Missing startup snapshot is unknown; the durable deadline still applies.
  if(!owner.live(System.currentTimeMillis())||!enabled()||!attended()||snapshot!=null&&!prompterAllowed(owner,snapshot))withdrawPrompter(owner.binding,owner.id,"原问题已失效或转到手机，正在退出提词器");
 }
 /** A matching expired/withdrawn DID is adopted for stop-only recovery, never for recording. */
 private NewsTele.Adoption orphan(String did){
  // A delayed exit frame cannot re-adopt a manuscript while its original exit callback is queued.
  if(retiredPrompters.contains(did))return null;
  TaskPrompterNotice notice=prompterNotice();if(notice!=null&&notice.did.equals(did)){
   if(!notice.peer.equals(NativeTransfer.connected()))return null;
   return new NewsTele.Adoption(null,notice.remaining(NativeTransfer.connected(),noticeAllowed(notice),System.currentTimeMillis()));
  }
  TaskPrompterOwner owner=prompter();if(owner==null||!owner.did.equals(did)||!owner.peer.isEmpty()&&!owner.peer.equals(NativeTransfer.connected()))return null;
  boolean live=!cancelledPrompters.contains(did)&&owner.live(System.currentTimeMillis())&&!owner.peer.isEmpty()&&enabled()&&attended()&&(snapshot==null||prompterAllowed(owner,snapshot));
  message=live?"已接回重启前的眼镜提词器；退出后重新核对原问题":"正在清理重启前已失效的提词器";refresh();
  return new NewsTele.Adoption(live?()->openPrompterVoice(did):null,live?owner.until-System.currentTimeMillis():0);
 }
 private void openPrompterVoice(String did){
  TaskPrompterOwner owner=prompter();if(owner==null||!owner.did.equals(did)||cancelledPrompters.contains(did)||!owner.live(System.currentTimeMillis())){TaskAttention.release("voice");return;}
  // The exit event may have been queued before a pause, phone answer, revision, or restart.
  tasks.detail(owner.binding,"request",owner.id,(state,error)->{
   TaskPrompterOwner current=prompter();if(current==null||!did.equals(current.did)){TaskAttention.release("voice");return;}
   boolean allowed=error.isEmpty()&&prompterAllowed(current,state);snapshot=state;
   prefs.edit().remove("prompter_owner").commit();
   if(!allowed||!openGlassesVoice(current.binding,current.id,current.revision,current.fingerprint)){TaskAttention.release("voice");message="已退出提词器，原问题暂不可口述；请在手机查看";refresh();return;}
   message=visible()?"已退出提词器，正在打开原问题语音回答":"已退出提词器，手机在后台开始原问题口述";refresh();
  });
 }
 private void openVoice(AgentCardRequest voice){
  if(!openGlassesVoice(voice.binding,voice.requestId,voice.revision,voice.fingerprint)){message="已在眼镜选择口述，请在手机打开原问题";refresh();return;}
  message=visible()?"已在眼镜选择口述，正在打开原问题语音回答":"已在眼镜选择口述，手机在后台开始口述";refresh();
 }
 /** A live App page (also when stopped by screen-off) shows the voice page; with no page left the
  * same glasses flow runs without UI, if background answering is allowed. */
 private boolean openGlassesVoice(String binding,String id,long revision,String fingerprint){
  Activity host=activity.get();boolean page=host!=null&&!host.isFinishing()&&!host.isDestroyed();
  if(!visible()&&!TaskAttention.background())return false;
  TaskAttention.hold("voice",30000);
  if(page)try{VoiceAnswerWorkspace.show(host,binding,id,revision,fingerprint,()->tasks.read(null),true);return true;}catch(RuntimeException windowGone){page=false;}
  if(!TaskAttention.background())return false;
  VoiceAnswerWorkspace.showHeadless(app,tasks,binding,id,revision,fingerprint,()->tasks.read(null));
  return true;
 }
 static final String BUSY_NOTICE="iO Agent 提醒：口述没有开始\n\n眼镜回报正忙：语音助手或其他应用可能还没退出。\n\n这道题保留在手机：可以直接在手机回答，或回到眼镜桌面后，在手机打开这道题重新口述。\n\n仅通知，无需回答；长按退出。";
 /** 2026-10-23: a glasses-started dictation refused as busy used to end silently on the lens after
  * the long press. One lens notice per attempt says why. (全天智记 alone no longer counts: LifelogState.) */
 static void glassesBusy(){
  main();AgentCardRuntime r=instance;if(r==null)return;
  r.message="眼镜正忙，口述没有开始（语音助手或其他应用可能未退出）；问题留在手机";r.refresh();
  r.busyNotice(0);
 }
 // The refused recording may still hold the message lane for a moment; retry briefly, then give up.
 private void busyNotice(int attempt){
  if(!NewsTele.active()&&!NativeTransfer.fileBusy()&&noticePrompt(BUSY_NOTICE,60000,null)){android.util.Log.i("TurboIOCard","glasses busy notice shown attempt="+attempt);return;}
  if(attempt<8)main.postDelayed(()->busyNotice(attempt+1),1000);else android.util.Log.i("TurboIOCard","glasses busy notice not shown");
 }
 private void confirmVoice(AgentCardRequest voice){
  message=VoiceAnswerWorkspace.confirmFromGlasses(voice.binding,voice.requestId,voice.confirm)?"已在眼镜确认，正在保存并提交原文":"手机上的口述已变化或暂不能保存，请在手机核对后保存";refresh();
 }
 private void releaseLocal(){if(localLease){NativeTransfer.releaseMessages(lease);localLease=false;}}
 private void withdraw(String reason){
  withdrawPrompter(null,null,reason);withdrawCard(reason);
 }
 private void withdrawCard(String reason){
  if(preflight!=null){preflight.stop(reason);preflight=null;releaseLocal();}
  if(session.pending()){if(!session.cancelUnshown())session.suspend(reason);message=reason;lastCleanupOwner="";}pump();
 }
 private boolean claimCleanup(){if(HeadGestureRuntime.claimCleanup(session.owner()))return true;if(NativeTransfer.acquireMessages(lease)){localLease=true;return true;}return false;}
 private void persistChoice(){
  AgentCardSession.Answer answer=session.pendingAnswer();if(answer==null||answerBusy||!attended()||!Host107Login.loggedIn())return;TaskHub.View c=context();if(c==null||!c.profile.enabled)return;
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
  try{checkPrompter();Fixed60Session.Link link=Host107Ota.link();observedGeneration=link.generation;
   if(preflight!=null){preflight.tick(link.peer,link.generation,now(),attended());if(preflight.phase().equals("READY")&&!preflight.working()){
     preflight=null;releaseLocal();headStarted=HeadGestureRuntime.begin(session.owner(),(ready,phase)->main.post(this::pump),nodConfirm()&&session.request()!=null&&session.request().confirm!=null);if(!headStarted){session.cancelUnshown();message="交互保护尚未就绪，请在手机回答";}else message="正在准备眼镜交互保护";
    }else if(!preflight.working()){message="眼镜状态检查未通过，请在手机回答";preflight=null;releaseLocal();session.cancelUnshown();}
    else{MinuteCardSession.Emission e=preflight.next(now());MinuteCardSession bound=preflight;if(e!=null)Host107Suggestion.send(link,e,ok->{if(preflight==bound){bound.result(e.ticket,ok,now());pump();}});}
   }
   boolean head=HeadGestureRuntime.ready(session.owner());
   if(preflight==null&&session.pending()&&session.phase().equals("PREPARING")){
    if(head)showAfterRefresh();else if(headStarted&&!HeadGestureRuntime.active(session.owner())){session.cancelUnshown();message="交互保护未确认，问题保留在手机";}
   }
   session.tick(link.peer,link.generation,now(),System.currentTimeMillis(),head,attended(),current());persistChoice();
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
 private void refresh(){// Only a live card counts: cardMayExist() stays true after retirement until a lens exit is proven.
  if(session.pending()||preflight!=null)TaskAttention.hold("card",20000);else TaskAttention.release("card");String text=text();for(TextView view:new ArrayList<>(views))view.setText(text);String state=new String(WireJson.bytes(WireJson.object("version",ProductInfo.VERSION,"phase",session.phase(),"healthy",session.healthy(),"pending",session.pending(),"card_may_exist",session.cardMayExist(),"has_selection",session.hasSelection(),"answer_failure",session.answerFailure(),"head_pending",HeadGestureRuntime.pending(),"head_status",HeadGestureRuntime.status(),"preflight",preflight==null?"":preflight.phase(),"fetching",fetching,"checking_show",checkingShow,"answer_busy",answerBusy,"drafts",session.drafts().size(),"background",TaskAttention.background(),"attention",TaskAttention.owners(),"notifications_held",TaskAttention.blockedCount(),"message",message)),java.nio.charset.StandardCharsets.UTF_8);if(state.equals(lastExport))return;
  // 2026-10-23: the wearer saw the confirm card about a minute after dictation ended; each status change
  // is logged with its time so the slow step can be found (no question or answer text is logged).
  android.util.Log.i("TurboIOCard","card phase="+session.phase()+" pending="+session.pending()+" head="+HeadGestureRuntime.pending()+" preflight="+(preflight==null?"":preflight.phase())+" fetching="+fetching+" show="+checkingShow+" busy="+answerBusy+" msg="+message);
  try{File dir=app.getExternalFilesDir(null);if(dir!=null){try(FileOutputStream stream=new FileOutputStream(new File(dir,"io-agent-card-status.json"))){stream.write(state.getBytes(java.nio.charset.StandardCharsets.UTF_8));}lastExport=state;}}catch(IOException ignored){}
 }
 static void show(Activity host){init(host);AgentCardRuntime r=instance;if(r==null){TaskWorkspace.notice(host,"眼镜交互记录暂不可用，请在手机回答");return;}EditorialUI.Screen screen=new EditorialUI.Screen(host,"眼镜任务卡");TextView status=EditorialUI.text(host,r.text(),15,EditorialUI.INK);screen.body.addView(status);r.views.add(status);
  CheckBox automatic=new CheckBox(host);automatic.setText("新问题自动显示到眼镜");automatic.setTextColor(EditorialUI.INK);automatic.setChecked(enabled());automatic.setOnCheckedChangeListener((button,value)->enabled(value));screen.body.addView(automatic);
  CheckBox background=new CheckBox(host);background.setText("熄屏或App在后台时也在眼镜提问、口述并确认");background.setTextColor(EditorialUI.INK);background.setChecked(backgroundAnswer());background.setOnCheckedChangeListener((button,value)->backgroundAnswer(value));screen.body.addView(background);
  screen.body.addView(EditorialUI.text(host,"任务提词器、任务卡或任务口述在镜片上时，手机普通通知暂不发到眼镜，手机上照常保留。",13,EditorialUI.MUTED));
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
