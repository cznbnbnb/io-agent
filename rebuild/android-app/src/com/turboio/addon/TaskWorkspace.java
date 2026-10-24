package com.turboio.addon;

import android.app.Activity;
import android.app.AlertDialog;
import android.text.InputFilter;
import android.text.InputType;
import android.widget.*;
import java.util.*;

/** Registered-context inbox. A default target never changes an existing answer's binding. */
final class TaskWorkspace {
 static String label(String code){switch(code){
  case "PAIRING_CODE_INVALID":return "配对码无效、已用过或已过期，请在电脑上重新生成";
  case "PAIRING_RATE_LIMITED":return "配对尝试太多，请 10 分钟后再试";
  case "PAIRING_REVOKED":case "PAIRING_EXPIRED":return "配对已失效，请在电脑上生成新的配对码后重新配对";
  case "TASK_DEVICE_INVALID":return "服务器返回的配对凭据不完整，未保存";
  case "unconfigured":return "尚未登记电脑连接";case "paused":case "TASK_PAUSED":return "连接已暂停";case "OFFICIAL_LOGIN_REQUIRED":return "官方账号登录已过期：打开官方 App 任一页面让它刷新后，再点刷新";
  case "contexts_ready":return "已加载登记会话";case "contexts_updated":return "会话状态已更新";
  case "ready":return "连接已启用";case "checking":return "正在核对身份";case "sending":return "正在提交";
  case "reconciling":return "正在核对上次提交";case "received":return "已同步收件箱";case "queued":return "已保存到本机，等待提交";
  case "awaiting_refresh":return "答案已保存，等待核对原问题";case "server_stored":return "服务器已保存";
  case "AUTH_REQUIRED":case "UNAUTHENTICATED":case "TASK_IMPORT_EXPIRED":return "连接凭据已到期，请重新登记";
  case "FORBIDDEN":case "TASK_PHONE_SCOPE_REQUIRED":return "连接权限不足，请核对电脑登记";
  case "TASK_IDENTITY_MISMATCH":case "TASK_EXPIRY_MISMATCH":return "连接身份或期限不匹配";
  case "TASK_TARGET_CHANGED":return "目标连接已变化，请重新打开这条任务";
  case "TASK_ROUTE_MISMATCH":return "返回内容与原会话不匹配，未提交答案";
  case "REQUEST_CLOSED":case "TASK_REQUEST_CLOSED":return "原问题已结束或版本已变化";
  case "TASK_REQUEST_CHANGED":return "问题内容已变化，请重新查看";
  case "TASK_ANSWER_ALREADY_SAVED":return "这个问题已有保存的答案，请查看提交状态";
  case "TASK_GLASS_BUSY":return "眼镜已有操作或尚未连接，原问题保留在手机";
  case "TASK_GLASS_COPY_TOO_LONG":case "TASK_GLASS_PHONE_ANSWER":return "这个问题请在手机完整回答";
  case "TASK_CARD_STORE_INVALID":return "眼镜交互记录暂不可用，请在手机回答";
  case "TASK_GLASS_PROMPTER":return "长问题将显示在眼镜提词器上";
  case "TASK_GLASS_HISTORY_FULL":return "眼镜提醒记录已满，原问题保留在手机";
  case "EXPIRED":case "expired":return "已过期";case "blocked":return "需要处理";
  case "TRANSPORT_UNKNOWN":case "INTERRUPTED":return "提交结果待核对";case "TASK_UNAVAILABLE":case "REFRESH_UNAVAILABLE":return "暂时无法连接，资料仍保存在本机";
  case "retry_wait":return "等待网络恢复后核对";case "queued_task":return "任务已提交，等待电脑接收";
  case "agent_received":return "电脑已接收";case "running":return "正在执行";case "waiting_answer":return "等待回答";
  case "completed":return "已完成";case "failed":return "执行失败";case "execution_unknown":return "执行结果待核对";
  case "cancel_requested":return "已请求停止";case "cancelled":return "已停止";
  case "reconcile":return "正在核对上次提交";case "TASK_IMPORT_UNAVAILABLE":return "没有可读取的登记文件，请从电脑重新提供";
  case "TASK_KEY_UNAVAILABLE":case "TASK_CONFIG_INVALID":return "本机连接无法读取，请重新登记";
  case "TASK_CONFIG_SAVE_FAILED":return "连接未能保存，请重试";
  case "TASK_PROFILES_FULL":return "已登记会话达到上限，可先移除已到期会话，原连接和队列仍保留";
  case "TASK_PROFILE_ACTIVE":return "会话凭据仍有效，不能移除";case "TASK_TARGET_SELECTED":return "当前委托会话不能移除，请先切换委托会话";
  case "STORE_IN_USE":return "这个会话正由另一连接程序使用";
  case "TASK_TEXT_INVALID":case "TASK_ANSWER_INVALID":return "请填写完整内容，或为问题选择一个答案";
  case "TASK_STORE_FULL":return "本机会话记录已满，请先保留并整理历史记录";
  default:return "连接暂不可用，请检查网络或重新登记";
 }}
 static void show(Activity activity){
  EditorialUI.Screen screen=new EditorialUI.Screen(activity,"电脑任务");TaskRuntime runtime=TaskRuntime.get(activity);
  final Runnable[] redraw={null};final boolean[] closed={false};final String[] previous={""};
  TaskRuntime.Result render=(state,error)->{if(!closed[0]&&screen.dialog.isShowing()&&runtime.active(activity)&&!previous[0].equals(state.fingerprint+"#"+foldVersion)){
   previous[0]=state.fingerprint+"#"+foldVersion;ScrollView scroll=(ScrollView)screen.body.getParent();int position=scroll.getScrollY();render(activity,screen,state,error,runtime,redraw[0]);scroll.post(()->{if(screen.dialog.isShowing())scroll.scrollTo(0,position);});
  }};
  redraw[0]=()->runtime.read(null);screen.dialog.setOnDismissListener(dialog->{closed[0]=true;runtime.unobserve(render);});runtime.observe(activity,render);
 }
 private static void render(Activity a,EditorialUI.Screen screen,TaskRuntime.Snapshot s,String error,TaskRuntime runtime,Runnable refresh){
  LinearLayout body=screen.body;body.removeAllViews();body.addView(EditorialUI.text(a,label(error.isEmpty()?s.note:error),20,EditorialUI.INK));
  if(s.saved!=null)body.addView(EditorialUI.text(a,"委托目标："+s.saved.connection.computer+" / "+s.saved.connection.agent+"\n会话："+s.saved.connection.session+"\n已登记 "+s.contexts.size()+" 个会话；回答始终返回原问题。",14,EditorialUI.MUTED));
  EditorialUI.button(a,body,"连接设置",false,()->new TaskConnectionUI(a,()->runtime.reload((state,code)->refresh.run())).show());
  EditorialUI.button(a,body,"眼镜任务卡",false,()->AgentCardRuntime.show(a));
  if(s.saved==null)return;
  EditorialUI.button(a,body,"切换委托会话",false,()->choose(a,runtime,s,refresh));
  EditorialUI.button(a,body,"刷新任务与问题",false,()->runtime.refresh((state,code)->refresh.run()));
  if(s.saved.enabled)EditorialUI.button(a,body,"委托电脑任务",true,()->delegate(a,runtime,s.binding,refresh));
  else body.addView(EditorialUI.text(a,"当前委托会话已暂停，其他已启用会话继续接收。本机队列已保留。",14,EditorialUI.MUTED));
  int shown=0;
  // 2026-10-23 (user): finding the current question meant scrolling past every old session and closed
  // task. The current delegate comes first, then sessions with open items; closed items and idle
  // sessions are folded behind one button each (state kept for this process only).
  List<TaskHub.View> ordered=new ArrayList<>(s.contexts);long now=System.currentTimeMillis();
  ordered.sort(Comparator.comparingInt((TaskHub.View v)->s.binding.equals(v.binding)?0:openCount(v,now)>0?1:2));
  for(TaskHub.View context:ordered){
   final String binding=context.binding;boolean current=s.binding.equals(binding);int open=openCount(context,now),closed=context.objects.size()-openObjects(context,now).size()+storedAnswers(context);boolean showClosed=CLOSED_SHOWN.contains(binding);
   LinearLayout section=EditorialUI.card(a,body);section.addView(EditorialUI.text(a,title(context.profile)+(current?" · 当前委托":""),17,EditorialUI.INK));section.addView(EditorialUI.text(a,label(context.note)+(open>0?" · "+open+" 项进行中":""),14,EditorialUI.MUTED));
   boolean removable=!current&&context.profile.connection.expiresAt<=now;
   if(!current&&open==0&&!EXPANDED.contains(binding)){EditorialUI.button(a,section,"展开此会话（"+closed+" 项已结束）",false,()->{EXPANDED.add(binding);foldVersion++;refresh.run();});if(removable)removeButton(a,section,runtime,binding,refresh);continue;}
   if(context.profile.enabled)EditorialUI.button(a,section,"暂停此会话",false,()->runtime.pause(binding,(state,code)->{if(!code.isEmpty())notice(a,label(code));refresh.run();}));
   EditorialUI.button(a,section,"启用或更新此会话",false,()->new TaskConnectionUI(a,()->runtime.reload((state,code)->refresh.run()),binding).show());
   if(removable)removeButton(a,section,runtime,binding,refresh);
   for(Object value:context.pending){Map<String,Object> row=WireJson.map(value);Map<String,Object> event=WireJson.map(WireJson.read(((String)row.get("payload")).getBytes(java.nio.charset.StandardCharsets.UTF_8))),b=TaskWire.body(event);boolean answered=event.get("kind").equals("answer"),stored="server_stored".equals(row.get("state"));if(stored&&(!answered||!showClosed))continue;LinearLayout card=EditorialUI.card(a,section);card.addView(EditorialUI.text(a,answered?(stored?"已提交的完整答案":"待提交的完整答案"):"本机任务",17,EditorialUI.INK));String phase=label((String)row.get("state"));if(!row.get("error").equals(""))phase+=" · "+label((String)row.get("error"));card.addView(EditorialUI.text(a,phase,14,EditorialUI.MUTED));TextView full=EditorialUI.text(a,(String)b.get(answered?"text":"command"),15,EditorialUI.INK);full.setTextIsSelectable(true);card.addView(full);}
  List<Object> openItems=openObjects(context,now);
  List<Object> items=new ArrayList<>();for(Object value:context.objects)if(showClosed||openItems.contains(value))items.add(value);Collections.reverse(items);
  if(closed>0)EditorialUI.button(a,section,showClosed?"收起已结束的 "+closed+" 项":"显示已结束的 "+closed+" 项",false,()->{if(!CLOSED_SHOWN.remove(binding))CLOSED_SHOWN.add(binding);foldVersion++;refresh.run();});
  for(Object value:items){Map<String,Object> item=WireJson.map(WireJson.map(value).get("item")),b=TaskWire.body(item);
   shown++;String kind=(String)item.get("kind");LinearLayout card=EditorialUI.card(a,section);
   if(kind.equals("request")){
    card.addView(EditorialUI.text(a,"问题 · "+requestState((String)item.get("state")),17,EditorialUI.INK));TextView question=EditorialUI.text(a,(String)b.get("question"),17,EditorialUI.INK);question.setTextIsSelectable(true);card.addView(question);
    if(item.get("answer")!=null)card.addView(EditorialUI.text(a,"已提交："+TaskWire.body(WireJson.map(item.get("answer"))).get("text"),15,EditorialUI.MUTED));
    if(context.profile.enabled&&TaskWire.set("choice","free_text").contains(b.get("mode"))&&TaskWire.canAnswer(item,context.item("task",(String)b.get("task_id")),System.currentTimeMillis()))EditorialUI.button(a,card,"prompter".equals(AgentCardRequest.route(b))?"在眼镜提词器上显示":"choice".equals(b.get("mode"))?"在眼镜上选择":"在眼镜上提示口述",false,()->AgentCardRuntime.offer(a,binding,(String)item.get("object_id"),TaskWire.positive(item.get("revision"))));
    EditorialUI.button(a,card,"查看与回答",true,()->runtime.detail(binding,"request",(String)item.get("object_id"),(updated,code)->{if(!screen.dialog.isShowing()||!runtime.active(a))return;if(!code.isEmpty()){notice(a,label(code));return;}TaskHub.View source=updated.context(binding);Map<String,Object> fresh=source==null?null:source.item("request",(String)item.get("object_id"));if(fresh!=null)answer(a,runtime,source,fresh,refresh);}));
   }else if(kind.equals("task")){
    card.addView(EditorialUI.text(a,label(item.get("state").equals("queued")?"queued_task":(String)item.get("state")),17,EditorialUI.INK));card.addView(EditorialUI.text(a,(String)b.get("command"),15,EditorialUI.INK));
    if(item.get("receipts")!=null)for(Object receipt:WireJson.list(item.get("receipts")))card.addView(EditorialUI.text(a,"回执："+receipt((String)WireJson.map(receipt).get("stage")),13,EditorialUI.MUTED));
   }else if(kind.equals("message")){
    card.addView(EditorialUI.text(a,"result".equals(b.get("channel"))?"电脑结果":"电脑消息",17,EditorialUI.INK));TextView full=EditorialUI.text(a,(String)b.get("text"),16,EditorialUI.INK);full.setTextIsSelectable(true);card.addView(full);
   }
  }
  }
  if(shown==0)body.addView(EditorialUI.text(a,"已登记会话暂无任务或待答问题。",15,EditorialUI.MUTED));
 }
 private static final Set<String> EXPANDED=new HashSet<>(),CLOSED_SHOWN=new HashSet<>();
 // Folding is local view state; bumping it makes the next read re-render even if the data did not change.
 private static int foldVersion;
 private static void removeButton(Activity a,LinearLayout section,TaskRuntime runtime,String binding,Runnable refresh){EditorialUI.button(a,section,"移除已到期会话",false,()->new android.app.AlertDialog.Builder(a).setTitle("移除已到期会话？").setMessage("只移除这条登记，腾出名额；本机队列和已提交答案记录仍保留。需要时可重新登记同一会话。").setNegativeButton("取消",null).setPositiveButton("移除",(dialog,which)->runtime.remove(binding,(state,code)->{if(!code.isEmpty())notice(a,label(code));refresh.run();})).show());}
 private static final Set<String> OPEN_TASK=TaskWire.set("queued","agent_received","running","waiting_answer","cancel_requested");
 /** Objects still needing attention: answerable questions, unfinished tasks and messages of those tasks. */
 private static List<Object> openObjects(TaskHub.View context,long now){
  List<Object> out=new ArrayList<>();
  // An expired registration cannot move anything forward; all of it counts as ended.
  if(context.profile.connection.expiresAt<=now)return out;
  for(Object value:context.objects){Map<String,Object> item=WireJson.map(WireJson.map(value).get("item")),b=TaskWire.body(item);String kind=(String)item.get("kind");boolean open;
   if(kind.equals("request"))open=TaskWire.set("pending","presented").contains(item.get("state"))&&TaskWire.canAnswer(item,context.item("task",(String)b.get("task_id")),now);
   else if(kind.equals("task"))open=OPEN_TASK.contains(item.get("state"));
   else{Map<String,Object> task=b.get("task_id") instanceof String?context.item("task",(String)b.get("task_id")):null;open=task!=null&&OPEN_TASK.contains(task.get("state"));}
   if(open)out.add(value);}
  return out;
 }
 private static int storedAnswers(TaskHub.View context){int n=0;for(Object value:context.pending){Map<String,Object> row=WireJson.map(value);if("server_stored".equals(row.get("state"))&&"answer".equals(WireJson.map(WireJson.read(((String)row.get("payload")).getBytes(java.nio.charset.StandardCharsets.UTF_8))).get("kind")))n++;}return n;}
 private static int openCount(TaskHub.View context,long now){int n=0;for(Object value:openObjects(context,now))if("request".equals(WireJson.map(WireJson.map(value).get("item")).get("kind")))n++;return n>0?n:openObjects(context,now).size();}
 private static String title(TaskProfiles.Profile p){return p.connection.computer+" / "+p.connection.agent+"\n"+p.connection.project+" / "+p.connection.session;}
 private static void choose(Activity a,TaskRuntime runtime,TaskRuntime.Snapshot snapshot,Runnable refresh){String[] labels=new String[snapshot.contexts.size()];for(int i=0;i<labels.length;i++){TaskHub.View v=snapshot.contexts.get(i);labels[i]=title(v.profile)+" · "+label(v.note);}AgentUI.alert(a).setTitle("选择新委托的目标").setItems(labels,(d,index)->runtime.select(snapshot.contexts.get(index).binding,(state,code)->{if(!code.isEmpty())notice(a,label(code));refresh.run();})).setNegativeButton("返回",null).show();}
 private static String requestState(String state){switch(state){case "pending":case "presented":return "等待回答";case "answered":return "已回答";case "withdrawn":return "已撤回";case "expired":return "已过期";default:return state;}}
 private static String receipt(String stage){switch(stage){case "server_stored":return "服务器已保存";case "phone_received":return "手机已接收";case "glasses_displayed":return "眼镜已显示";case "user_answered":return "用户已回答";case "agent_received":return "电脑已接收";case "task_resumed":return "原任务已继续";case "task_completed":return "任务已完成";default:return label(stage);}}
 private static EditText input(Activity a,LinearLayout parent,String hint){EditText edit=AgentUI.input(a);edit.setTextColor(EditorialUI.INK);edit.setHintTextColor(EditorialUI.MUTED);edit.setHint(hint);edit.setInputType(InputType.TYPE_CLASS_TEXT|InputType.TYPE_TEXT_FLAG_MULTI_LINE);edit.setMinLines(3);edit.setFilters(new InputFilter[]{new InputFilter.LengthFilter(65536)});parent.addView(edit,new LinearLayout.LayoutParams(-1,-2));return edit;}
 static AgentUI.Screen delegate(Activity a,TaskRuntime runtime,String binding,Runnable refresh){return new DelegateForm(a,runtime,binding,refresh,null,"").screen;}
 static AgentUI.Screen delegateMaterial(Activity a,TaskRuntime runtime,String binding,MaterialCatalog.Entry entry,String expectedAccount,Runnable refresh){
  try{TaskWire.require(expectedAccount!=null&&expectedAccount.matches("[a-f0-9]{64}"),"MATERIAL_TASK_SOURCE_INVALID");return new DelegateForm(a,runtime,binding,refresh,new MaterialTaskDraft(entry),expectedAccount).screen;}
  catch(Exception failure){AgentUI.Screen screen=new AgentUI.Screen(a,"基于资料委托任务");screen.body.addView(AgentUI.text(a,materialDraftError(failure.getMessage()),16,AgentUI.INK));AgentUI.gap(a,screen.body,12);screen.body.addView(AgentUI.text(a,"原文没有截断，也没有创建任务。请回到资料详情，使用「导出文档」保存完整资料后，再交给电脑处理。",14,AgentUI.MUTED));AgentUI.button(a,screen.body,"返回资料详情",true,screen.dialog::dismiss);return screen;}
 }
 private static String materialDraftError(String code){return "MATERIAL_TASK_INSTRUCTION_REQUIRED".equals(code)?"请先填写你希望 Agent 做什么，不能只提交资料正文。":"MATERIAL_TASK_TOO_LARGE".equals(code)?"这份资料和任务要求合计超过任务长度上限，请先导出文档。":"所选资料暂时无法用于委托，请重新打开资料后再试。";}
 /** Each temporary target owns its own text and operation. Selection never edits the global default. */
 private static final class DelegateForm {
  final Activity activity;final TaskRuntime runtime;final Runnable refresh;final AgentUI.Screen screen;final MaterialTaskDraft material;
  final EditText edit;final TextView target,change,status,send,newDraft;
  String binding,key,operation;final String materialAccount;boolean submitted,sending,choosing,materialVerified,draftConsumed;TaskRuntime.Snapshot targets;AlertDialog chooser;android.app.Application.ActivityLifecycleCallbacks materialLifecycle;
  DelegateForm(Activity a,TaskRuntime runtime,String initial,Runnable refresh,MaterialTaskDraft material,String expectedAccount){
   activity=a;this.runtime=runtime;this.refresh=refresh;this.material=material;this.materialAccount=expectedAccount;screen=new AgentUI.Screen(a,material==null?"交给 Agent 一件事":"基于资料委托任务");
   if(material!=null){screen.body.addView(AgentUI.text(a,material.entry.title,20,AgentUI.INK));screen.body.addView(AgentUI.text(a,material.entry.day+" · "+material.entry.timeRange()+" · 修订 "+material.entry.revision,13,AgentUI.MUTED));AgentUI.gap(a,screen.body,14);}
   target=AgentUI.text(a,"正在读取默认目标…",14,AgentUI.MUTED);screen.body.addView(target);
   change=AgentUI.button(a,screen.body,"本次交给  ›",false,this::chooseTarget);
   AgentUI.gap(a,screen.body,14);edit=agentInput(a,screen.body,material==null?"完整描述需要电脑完成的事情":"填写具体要求，例如：提炼讨论结论，并列出待办事项");if(material!=null)edit.setFilters(new InputFilter[0]);
   status=AgentUI.text(a,"返回会保留本机草稿。切换目标时分别保存和读取各自草稿，不改变默认 Agent 与工作区。",12,AgentUI.MUTED);screen.body.addView(status);
   if(material!=null){AgentUI.gap(a,screen.body,16);screen.body.addView(AgentUI.text(a,"提交时会将以下文字交给所选 Agent",14,AgentUI.ACCENT));TextView source=AgentUI.text(a,material.document,14,AgentUI.MUTED);source.setTextIsSelectable(true);screen.body.addView(source);}
   send=AgentUI.button(a,material==null?screen.body:screen.dock,"提交给 Agent",true,this::submit);send.setEnabled(false);newDraft=AgentUI.button(a,material==null?screen.body:screen.dock,"将这份文字作为新任务草稿",false,()->{if(!draftConsumed||sending)return;operation=UUID.randomUUID().toString();draftConsumed=false;preserve();showTarget();status.setText("这是独立的新任务草稿。此前任务保持原状态，只有再点提交才会创建新任务。");});newDraft.setVisibility(android.view.View.GONE);loadTarget(initial);
   if(material!=null){materialLifecycle=new android.app.Application.ActivityLifecycleCallbacks(){
    public void onActivityStopped(Activity owner){if(owner==activity&&screen.dialog.isShowing())screen.dialog.dismiss();}
    public void onActivityDestroyed(Activity owner){if(owner==activity&&screen.dialog.isShowing())screen.dialog.dismiss();}
    public void onActivityCreated(Activity owner,android.os.Bundle state){}public void onActivityStarted(Activity owner){}public void onActivityResumed(Activity owner){}public void onActivityPaused(Activity owner){}public void onActivitySaveInstanceState(Activity owner,android.os.Bundle state){}
   };activity.getApplication().registerActivityLifecycleCallbacks(materialLifecycle);}
   screen.dialog.setOnDismissListener(d->{preserve();if(chooser!=null)chooser.dismiss();if(materialLifecycle!=null){activity.getApplication().unregisterActivityLifecycleCallbacks(materialLifecycle);materialLifecycle=null;}});
   runtime.read((state,error)->{if(!screen.dialog.isShowing())return;targets=state;showTarget();if(!error.isEmpty())status.setText(label(error));});
   if(material!=null)checkMaterial(()->showTarget(),message->{status.setText(message);showTarget();});
  }
  void loadTarget(String next){binding=next;key=uiDraftKey(next,material==null?"delegate":material.scope);Map<String,Object> draft=readUiDraft(uiDrafts(activity).getString(key,""));operation=draft.get("operation") instanceof String?(String)draft.get("operation"):UUID.randomUUID().toString();edit.setText(draft.get("text") instanceof String?(String)draft.get("text"):"");submitted=false;showTarget();}
  void preserve(){if(!submitted)saveUiDraft(activity,key,operation,edit.getText().toString(),null);}
  boolean available(){TaskHub.View source=targets==null?null:targets.context(binding);return source!=null&&source.profile.enabled&&source.profile.connection.expiresAt>System.currentTimeMillis();}
  void showTarget(){
   TaskHub.View source=targets==null?null:targets.context(binding);if(source==null)target.setText(targets==null?"正在读取目标…":"这条登记暂不可用，可选择其他目标；原草稿仍保留。");
   else target.setText((binding.equals(targets.binding)?"默认目标":"本次目标")+"\n"+delegateTargetLabel(source,ambiguousTarget(targets,source))+(!source.profile.enabled?"\n连接已暂停":source.profile.connection.expiresAt<=System.currentTimeMillis()?"\n连接已到期":""));
   draftConsumed=false;if(source!=null)for(Object raw:source.pending){Map<String,Object> pending=WireJson.map(raw);if(operation.equals(pending.get("operation_id"))){draftConsumed=true;status.setText("这份委托已进入提交队列："+TaskPresentation.queueStatus(pending)+"。原提交内容不能在这里修改；可明确另建任务草稿。");break;}}
   edit.setEnabled(!sending&&targets!=null&&!draftConsumed);newDraft.setVisibility(draftConsumed?android.view.View.VISIBLE:android.view.View.GONE);newDraft.setEnabled(!sending);
   send.setEnabled(!sending&&!draftConsumed&&available()&&(material==null||materialVerified));
  }
  void chooseTarget(){
   if(sending||choosing)return;choosing=true;change.setEnabled(false);
   runtime.read((state,error)->{
    choosing=false;if(!screen.dialog.isShowing())return;change.setEnabled(!sending);targets=state;showTarget();if(sending)return;
    if(state.contexts.isEmpty()){AgentUI.notice(activity,"尚无已登记的电脑目标，请先添加电脑连接。");return;}
    String[] labels=new String[state.contexts.size()];int selected=-1;
    for(int i=0;i<labels.length;i++){TaskHub.View source=state.contexts.get(i);labels[i]=delegateTargetLabel(source,ambiguousTarget(state,source))+(source.binding.equals(state.binding)?"\n默认目标":"")+(!source.profile.enabled?" · 已暂停":source.profile.connection.expiresAt<=System.currentTimeMillis()?" · 已到期":"");if(source.binding.equals(binding))selected=i;}
    chooser=new AlertDialog.Builder(new android.view.ContextThemeWrapper(activity,android.R.style.Theme_Material_Dialog_Alert)).setTitle("本次交给").setSingleChoiceItems(labels,selected,(dialog,index)->{
     dialog.dismiss();if(!screen.dialog.isShowing()||sending)return;String next=state.contexts.get(index).binding;if(next.equals(binding))return;
     boolean hadDraft=!edit.getText().toString().isEmpty();preserve();loadTarget(next);
     if(!draftConsumed)status.setText(hadDraft?"已保留原目标的草稿。现在显示所选目标自己的草稿，默认目标未改变。":"已切换本次目标，默认目标未改变。返回会保留此目标的草稿。");
    }).setNegativeButton("返回",null).show();
   });
  }
  void submit(){
   if(sending||draftConsumed||!available())return;String instruction=edit.getText().toString();if(instruction.trim().isEmpty()){AgentUI.notice(activity,material==null?"请先填写任务内容。":materialDraftError("MATERIAL_TASK_INSTRUCTION_REQUIRED"));return;}
   final String command;try{command=material==null?instruction:material.command(targets.context(binding).profile.connection,operation,instruction,System.currentTimeMillis());}catch(RuntimeException invalid){preserve();AgentUI.notice(activity,materialDraftError(invalid.getMessage()));return;}
   preserve();sending=true;send.setEnabled(false);change.setEnabled(false);edit.setEnabled(false);
   final String sentBinding=binding,sentKey=key,sentOperation=operation;
   Runnable dispatch=()->runtime.delegate(sentBinding,sentOperation,command,(state,error)->{
    sending=false;
    if(error.isEmpty()){submitted=true;clearMatchingDraft(activity,sentKey,sentOperation,instruction,null);if(screen.dialog.isShowing())screen.dialog.dismiss();refresh.run();}
    else if(screen.dialog.isShowing()){targets=state;edit.setEnabled(true);change.setEnabled(true);showTarget();if(runtime.active(activity))AgentUI.notice(activity,label(error));}
   });
   if(material==null)dispatch.run();else checkMaterial(dispatch,message->{sending=false;if(screen.dialog.isShowing()){edit.setEnabled(true);change.setEnabled(true);status.setText(message);showTarget();if(runtime.active(activity))AgentUI.notice(activity,message);}});
  }
  void checkMaterial(Runnable success,java.util.function.Consumer<String> failure){
   materialVerified=false;MaterialRuntime.get(activity).catalog((value,error)->{
    if(!screen.dialog.isShowing())return;
    if(!error.isEmpty()||value==null||value.catalog.account.isEmpty()){failure.accept("资料账号暂时无法核对，尚未创建任务。请返回资料页重新读取。");return;}
    if(!materialAccount.equals(value.catalog.account)){failure.accept("资料账号已变化，尚未创建任务。请返回资料页重新选择。");return;}
    for(MaterialCatalog.Entry current:value.catalog.entries)if(material.same(current)){materialVerified=true;success.run();return;}
    failure.accept("资料修订或归属已变化，尚未创建任务。请返回资料页重新选择这份资料。");
   });
  }

 }
 private static boolean ambiguousTarget(TaskRuntime.Snapshot state,TaskHub.View source){String label=delegateTargetLabel(source,false);for(TaskHub.View other:state.contexts)if(!other.binding.equals(source.binding)&&label.equals(delegateTargetLabel(other,false)))return true;return false;}
 private static String delegateTargetLabel(TaskHub.View source,boolean includeSession){
  TaskConnection connection=source.profile.connection;String topic="";
  for(int i=source.objects.size()-1;i>=0;i--){Map<String,Object> item=WireJson.map(WireJson.map(source.objects.get(i)).get("item"));if("task".equals(item.get("kind"))){topic=TaskPresentation.firstLine((String)TaskWire.body(item).get("command"));break;}}
  if(topic.startsWith(AgentCardRequest.DEFAULT_COMMAND_PREFIX))topic="";if(topic.length()>80)topic=topic.substring(0,79)+"…";
  return connection.agent+" · "+connection.computer+"\n工作区 · "+connection.project+(topic.isEmpty()?"":"\n主题 · "+topic)+(includeSession?"\n登记对话 · "+connection.session:"");
 }
 static AgentUI.Screen answer(Activity a,TaskRuntime runtime,TaskHub.View state,Map<String,Object> request,Runnable refresh){
  Map<String,Object> b=TaskWire.body(request),parent=null;for(Object raw:state.objects){Map<String,Object> item=WireJson.map(WireJson.map(raw).get("item"));if(item.get("kind").equals("task")&&item.get("object_id").equals(b.get("task_id")))parent=item;}
  AgentUI.Screen form=new AgentUI.Screen(a,"回复原任务");form.body.addView(AgentUI.text(a,state.profile.connection.agent+" · "+state.profile.connection.computer,13,AgentUI.MUTED));AgentUI.gap(a,form.body,12);TextView question=AgentUI.text(a,(String)b.get("question"),18,AgentUI.INK);question.setTextIsSelectable(true);form.body.addView(question);
  Map<String,Object> queuedAnswer=pendingAnswer(state,request);if(queuedAnswer!=null){AgentUI.gap(a,form.body,14);form.body.addView(AgentUI.text(a,TaskPresentation.queueStatus(queuedAnswer),15,AgentUI.ACCENT));Map<String,Object> saved=TaskWire.body(WireJson.map(WireJson.read(((String)queuedAnswer.get("payload")).getBytes(java.nio.charset.StandardCharsets.UTF_8))));StringBuilder complete=new StringBuilder();if(saved.get("option_id")!=null)for(Object raw:WireJson.list(b.get("options"))){Map<String,Object> option=WireJson.map(raw);if(saved.get("option_id").equals(option.get("option_id")))complete.append(option.get("label")).append("\n");}complete.append((String)saved.get("text"));TextView answer=AgentUI.text(a,complete.toString(),16,AgentUI.INK);answer.setTextIsSelectable(true);form.body.addView(answer);form.body.addView(AgentUI.text(a,"原答案已在持久队列中，结果明确前不能重复回答。",13,AgentUI.MUTED));return form;}
  if(!TaskWire.canAnswer(request,parent,System.currentTimeMillis())){form.body.addView(AgentUI.text(a,"原问题已结束、过期或任务不再等待，不能提交新答案。",15,AgentUI.MUTED));return form;}
  String requestId=(String)request.get("object_id");final String voiceFingerprint=TaskWire.requestFingerprint(request);final long voiceRevision=TaskWire.positive(request.get("revision"));
  String key=uiDraftKey(state.binding,requestId+"/"+voiceRevision+"/"+voiceFingerprint);Map<String,Object> draft=readUiDraft(uiDrafts(a).getString(key,""));
  AgentCardRuntime.enterPhone(state.binding,requestId);
  RadioGroup options=new RadioGroup(a);for(Object raw:WireJson.list(b.get("options"))){Map<String,Object> option=WireJson.map(raw);RadioButton button=new RadioButton(new android.view.ContextThemeWrapper(a,android.R.style.Theme_Material_NoActionBar));button.setButtonTintList(android.content.res.ColorStateList.valueOf(AgentUI.ACCENT));button.setId(android.view.View.generateViewId());button.setText((String)option.get("label"));button.setTextColor(AgentUI.INK);button.setTag(option.get("option_id"));options.addView(button);if(option.get("option_id").equals(draft.get("option")))button.setChecked(true);}form.body.addView(options);
  EditText text=agentInput(a,form.body,"补充完整条件；文字会原样交给这个问题的原任务");text.setText(draft.get("text") instanceof String?(String)draft.get("text"):"");String priorOperation=draft.get("operation") instanceof String?(String)draft.get("operation"):"";boolean consumed=false;for(Object raw:state.pending)if(priorOperation.equals(WireJson.map(raw).get("operation_id")))consumed=true;final String operation=priorOperation.isEmpty()||consumed?UUID.randomUUID().toString():priorOperation;final boolean[] submitted={false};
  Runnable preserve=()->{if(submitted[0])return;RadioButton selected=options.findViewById(options.getCheckedRadioButtonId());saveUiDraft(a,key,operation,text.getText().toString(),selected==null?null:selected.getTag());};
  form.dialog.setOnDismissListener(dialog->{preserve.run();AgentCardRuntime.leavePhone(state.binding,requestId);});
  form.body.addView(AgentUI.text(a,"返回会保留本机草稿，不会提交。回复始终返回这个问题的原任务。",12,AgentUI.MUTED));
  TextView voice=AgentUI.button(a,form.body,"用眼镜口述",false,()->{preserve.run();VoiceAnswerWorkspace.show(a,state.binding,requestId,voiceRevision,voiceFingerprint,refresh);});
  TextView send=AgentUI.button(a,form.body,"保存完整答案",true,()->{});send.setOnClickListener(v->{Object option=null;RadioButton selected=options.findViewById(options.getCheckedRadioButtonId());if(selected!=null)option=selected.getTag();preserve.run();final Object savedOption=option;send.setEnabled(false);voice.setEnabled(false);text.setEnabled(false);for(int i=0;i<options.getChildCount();i++)options.getChildAt(i).setEnabled(false);runtime.answer(state.binding,operation,requestId,voiceRevision,option,text.getText().toString(),(updated,code)->{
   if(code.isEmpty()){submitted[0]=true;clearMatchingDraft(a,key,operation,text.getText().toString(),savedOption);if(form.dialog.isShowing())form.dialog.dismiss();refresh.run();}
   else if(form.dialog.isShowing()){send.setEnabled(true);voice.setEnabled(true);text.setEnabled(true);for(int i=0;i<options.getChildCount();i++)options.getChildAt(i).setEnabled(true);if(runtime.active(a))AgentUI.notice(a,label(code));}
  });});return form;
 }
 private static Map<String,Object> pendingAnswer(TaskHub.View source,Map<String,Object> request){for(Object raw:source.pending){Map<String,Object> row=WireJson.map(raw),event=WireJson.map(WireJson.read(((String)row.get("payload")).getBytes(java.nio.charset.StandardCharsets.UTF_8)));if(!"answer".equals(event.get("kind")))continue;Map<String,Object> answer=TaskWire.body(event);if(request.get("object_id").equals(answer.get("request_id"))&&TaskWire.positive(request.get("revision"))==TaskWire.positive(answer.get("request_revision"))&&(Boolean.TRUE.equals(row.get("needs_lookup"))||!TaskWire.set("blocked","expired","withdrawn_local").contains(row.get("state"))))return row;}return null;}
 private static void clearMatchingDraft(Activity a,String key,String operation,String text,Object option){Map<String,Object> current=readUiDraft(uiDrafts(a).getString(key,""));if(operation.equals(current.get("operation"))&&text.equals(current.get("text"))&&Objects.equals(option,current.get("option")))uiDrafts(a).edit().remove(key).apply();}
 private static EditText agentInput(Activity a,LinearLayout parent,String hint){EditText edit=AgentUI.input(a);edit.setTextColor(AgentUI.INK);edit.setHintTextColor(AgentUI.MUTED);edit.setHint(hint);edit.setInputType(InputType.TYPE_CLASS_TEXT|InputType.TYPE_TEXT_FLAG_MULTI_LINE);edit.setMinLines(3);edit.setFilters(new InputFilter[]{new InputFilter.LengthFilter(65536)});parent.addView(edit,new LinearLayout.LayoutParams(-1,-2));return edit;}
 private static android.content.SharedPreferences uiDrafts(Activity a){return a.getSharedPreferences("io_agent_task_ui_drafts_v1",android.content.Context.MODE_PRIVATE);}
 private static String uiDraftKey(String binding,String subject){return TaskWire.hash((binding+"/"+subject).getBytes(java.nio.charset.StandardCharsets.UTF_8));}
 private static Map<String,Object> readUiDraft(String value){try{return value.isEmpty()?Collections.emptyMap():WireJson.map(WireJson.read(value.getBytes(java.nio.charset.StandardCharsets.UTF_8)));}catch(RuntimeException invalid){return Collections.emptyMap();}}
 private static void saveUiDraft(Activity a,String key,String operation,String text,Object option){android.content.SharedPreferences.Editor editor=uiDrafts(a).edit();if(text.isEmpty()&&option==null)editor.remove(key);else editor.putString(key,new String(WireJson.bytes(WireJson.object("operation",operation,"text",text,"option",option)),java.nio.charset.StandardCharsets.UTF_8));editor.apply();}
 static void notice(Activity a,String text){if(!a.isFinishing())AgentUI.alert(a).setMessage(text).setPositiveButton("知道了",null).show();}
}
