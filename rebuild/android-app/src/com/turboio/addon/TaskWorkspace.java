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
  case "unconfigured":return "尚未登记电脑连接";case "paused":case "TASK_PAUSED":return "连接已暂停";
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
  case "TASK_PROFILES_FULL":return "已登记会话达到上限，原连接和队列仍保留";
  case "STORE_IN_USE":return "这个会话正由另一连接程序使用";
  case "TASK_TEXT_INVALID":case "TASK_ANSWER_INVALID":return "请填写完整内容，或为问题选择一个答案";
  case "TASK_STORE_FULL":return "本机会话记录已满，请先保留并整理历史记录";
  default:return "连接暂不可用，请检查网络或重新登记";
 }}
 static void show(Activity activity){
  EditorialUI.Screen screen=new EditorialUI.Screen(activity,"电脑任务");TaskRuntime runtime=TaskRuntime.get(activity);
  final Runnable[] redraw={null};final boolean[] closed={false};final String[] previous={""};
  TaskRuntime.Result render=(state,error)->{if(!closed[0]&&screen.dialog.isShowing()&&runtime.active(activity)&&!previous[0].equals(state.fingerprint)){
   previous[0]=state.fingerprint;ScrollView scroll=(ScrollView)screen.body.getParent();int position=scroll.getScrollY();render(activity,screen,state,error,runtime,redraw[0]);scroll.post(()->{if(screen.dialog.isShowing())scroll.scrollTo(0,position);});
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
  for(TaskHub.View context:s.contexts){
   final String binding=context.binding;LinearLayout section=EditorialUI.card(a,body);section.addView(EditorialUI.text(a,title(context.profile)+(s.binding.equals(binding)?" · 当前委托":""),17,EditorialUI.INK));section.addView(EditorialUI.text(a,label(context.note),14,EditorialUI.MUTED));
   if(context.profile.enabled)EditorialUI.button(a,section,"暂停此会话",false,()->runtime.pause(binding,(state,code)->{if(!code.isEmpty())notice(a,label(code));refresh.run();}));
   EditorialUI.button(a,section,"启用或更新此会话",false,()->new TaskConnectionUI(a,()->runtime.reload((state,code)->refresh.run()),binding).show());
   for(Object value:context.pending){Map<String,Object> row=WireJson.map(value);Map<String,Object> event=WireJson.map(WireJson.read(((String)row.get("payload")).getBytes(java.nio.charset.StandardCharsets.UTF_8))),b=TaskWire.body(event);boolean answered=event.get("kind").equals("answer"),stored="server_stored".equals(row.get("state"));if(stored&&!answered)continue;LinearLayout card=EditorialUI.card(a,section);card.addView(EditorialUI.text(a,answered?(stored?"已提交的完整答案":"待提交的完整答案"):"本机任务",17,EditorialUI.INK));String phase=label((String)row.get("state"));if(!row.get("error").equals(""))phase+=" · "+label((String)row.get("error"));card.addView(EditorialUI.text(a,phase,14,EditorialUI.MUTED));TextView full=EditorialUI.text(a,(String)b.get(answered?"text":"command"),15,EditorialUI.INK);full.setTextIsSelectable(true);card.addView(full);}
  List<Object> items=new ArrayList<>(context.objects);Collections.reverse(items);
  for(Object value:items){Map<String,Object> item=WireJson.map(WireJson.map(value).get("item")),b=TaskWire.body(item);
   shown++;String kind=(String)item.get("kind");LinearLayout card=EditorialUI.card(a,section);
   if(kind.equals("request")){
    card.addView(EditorialUI.text(a,"问题 · "+requestState((String)item.get("state")),17,EditorialUI.INK));TextView question=EditorialUI.text(a,(String)b.get("question"),17,EditorialUI.INK);question.setTextIsSelectable(true);card.addView(question);
    if(item.get("answer")!=null)card.addView(EditorialUI.text(a,"已提交："+TaskWire.body(WireJson.map(item.get("answer"))).get("text"),15,EditorialUI.MUTED));
    if(context.profile.enabled&&"choice".equals(b.get("mode"))&&TaskWire.canAnswer(item,context.item("task",(String)b.get("task_id")),System.currentTimeMillis()))EditorialUI.button(a,card,"在眼镜上选择",false,()->AgentCardRuntime.offer(a,binding,(String)item.get("object_id"),TaskWire.positive(item.get("revision"))));
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
 private static String title(TaskProfiles.Profile p){return p.connection.computer+" / "+p.connection.agent+"\n"+p.connection.project+" / "+p.connection.session;}
 private static void choose(Activity a,TaskRuntime runtime,TaskRuntime.Snapshot snapshot,Runnable refresh){String[] labels=new String[snapshot.contexts.size()];for(int i=0;i<labels.length;i++){TaskHub.View v=snapshot.contexts.get(i);labels[i]=title(v.profile)+" · "+label(v.note);}new AlertDialog.Builder(a).setTitle("选择新委托的目标").setItems(labels,(d,index)->runtime.select(snapshot.contexts.get(index).binding,(state,code)->{if(!code.isEmpty())notice(a,label(code));refresh.run();})).setNegativeButton("返回",null).show();}
 private static String requestState(String state){switch(state){case "pending":case "presented":return "等待回答";case "answered":return "已回答";case "withdrawn":return "已撤回";case "expired":return "已过期";default:return state;}}
 private static String receipt(String stage){switch(stage){case "server_stored":return "服务器已保存";case "phone_received":return "手机已接收";case "glasses_displayed":return "眼镜已显示";case "user_answered":return "用户已回答";case "agent_received":return "电脑已接收";case "task_resumed":return "原任务已继续";case "task_completed":return "任务已完成";default:return label(stage);}}
 private static EditText input(Activity a,LinearLayout parent,String hint){EditText edit=new EditText(a);edit.setTextColor(EditorialUI.INK);edit.setHintTextColor(EditorialUI.MUTED);edit.setHint(hint);edit.setInputType(InputType.TYPE_CLASS_TEXT|InputType.TYPE_TEXT_FLAG_MULTI_LINE);edit.setMinLines(3);edit.setFilters(new InputFilter[]{new InputFilter.LengthFilter(65536)});parent.addView(edit,new LinearLayout.LayoutParams(-1,-2));return edit;}
 private static void delegate(Activity a,TaskRuntime runtime,String binding,Runnable refresh){
  EditorialUI.Screen form=new EditorialUI.Screen(a,"委托电脑任务");EditText edit=input(a,form.body,"完整描述需要电脑完成的事情");String operation=UUID.randomUUID().toString();
  TextView send=EditorialUI.button(a,form.body,"保存并提交到当前会话",true,()->{});send.setOnClickListener(v->{send.setEnabled(false);runtime.delegate(binding,operation,edit.getText().toString(),(state,code)->{if(!form.dialog.isShowing()||!runtime.active(a))return;if(code.isEmpty()){form.dialog.dismiss();refresh.run();}else{send.setEnabled(true);notice(a,label(code));}});});
 }
 private static void answer(Activity a,TaskRuntime runtime,TaskHub.View state,Map<String,Object> request,Runnable refresh){
  Map<String,Object> b=TaskWire.body(request),parent=null;for(Object raw:state.objects){Map<String,Object> item=WireJson.map(WireJson.map(raw).get("item"));if(item.get("kind").equals("task")&&item.get("object_id").equals(b.get("task_id")))parent=item;}
  EditorialUI.Screen form=new EditorialUI.Screen(a,"完整回答");TextView question=EditorialUI.text(a,(String)b.get("question"),18,EditorialUI.INK);question.setTextIsSelectable(true);form.body.addView(question);
  if(!TaskWire.canAnswer(request,parent,System.currentTimeMillis())){form.body.addView(EditorialUI.text(a,"原问题已结束、过期或任务不再等待，不能提交新答案。",15,EditorialUI.MUTED));return;}
  String requestId=(String)request.get("object_id");AgentCardRuntime.enterPhone(state.binding,requestId);form.dialog.setOnDismissListener(dialog->AgentCardRuntime.leavePhone(state.binding,requestId));
  RadioGroup options=new RadioGroup(a);for(Object raw:WireJson.list(b.get("options"))){Map<String,Object> option=WireJson.map(raw);RadioButton button=new RadioButton(a);button.setId(android.view.View.generateViewId());button.setText((String)option.get("label"));button.setTextColor(EditorialUI.INK);button.setTag(option.get("option_id"));options.addView(button);}form.body.addView(options);
  EditText text=input(a,form.body,"补充完整条件；文字会原样交给这个问题的原任务");String operation=UUID.randomUUID().toString();
  final String voiceFingerprint=TaskWire.requestFingerprint(request);final long voiceRevision=TaskWire.positive(request.get("revision"));
  EditorialUI.button(a,form.body,"用眼镜口述",false,()->VoiceAnswerWorkspace.show(a,state.binding,requestId,voiceRevision,voiceFingerprint,refresh));
  TextView send=EditorialUI.button(a,form.body,"保存完整答案",true,()->{});send.setOnClickListener(v->{Object option=null;RadioButton selected=options.findViewById(options.getCheckedRadioButtonId());if(selected!=null)option=selected.getTag();send.setEnabled(false);runtime.answer(state.binding,operation,(String)request.get("object_id"),TaskWire.positive(request.get("revision")),option,text.getText().toString(),(updated,code)->{if(!form.dialog.isShowing()||!runtime.active(a))return;if(code.isEmpty()){form.dialog.dismiss();refresh.run();}else{send.setEnabled(true);notice(a,label(code));}});});
 }
 static void notice(Activity a,String text){if(!a.isFinishing())new AlertDialog.Builder(a).setMessage(text).setPositiveButton("知道了",null).show();}
}
