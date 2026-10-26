package com.turboio.addon;

import android.app.Activity;
import android.content.res.ColorStateList;
import android.widget.*;
import java.text.SimpleDateFormat;
import java.util.*;

/** Connection controls stay in detail. Selecting a default never retargets an answer. */
final class AgentConnectionsPage {
 static void show(Activity activity){new Page(activity,"list",null).open();}
 static void defaults(Activity activity){new Page(activity,"defaults",null).open();}
 private static void detail(Activity activity,String binding){new Page(activity,"detail",binding).open();}

 private static final class Page {
  final Activity activity;final String mode,binding;final TaskRuntime runtime;final AgentUI.Screen screen;
  TaskRuntime.Snapshot snapshot;String last="",choice="",feedback="";boolean closed,busy,history,choiceMade;long choiceRevision;
  final TaskRuntime.Result observer=this::accept;
  Page(Activity activity,String mode,String binding){
   this.activity=activity;this.mode=mode;this.binding=binding;runtime=TaskRuntime.get(activity);
   screen=new AgentUI.Screen(activity,"defaults".equals(mode)?"默认 Agent 与工作区":"detail".equals(mode)?"连接详情":"电脑连接");
  }
  void open(){
   screen.body.addView(AgentUI.text(activity,"正在读取已登记连接…",15,AgentUI.MUTED));
   screen.dialog.setOnDismissListener(dialog->{closed=true;runtime.unobserve(observer);});runtime.observe(activity,observer);runtime.readDirectory((state,error)->{if(visible())accept(state,error);});
  }
  boolean visible(){return !closed&&screen.dialog.isShowing()&&!activity.isFinishing()&&!activity.isDestroyed();}
  void accept(TaskRuntime.Snapshot state,String error){
   snapshot=state;if(!visible()||busy)return;
   if(!error.isEmpty())feedback=TaskWorkspace.label(error);
   else if(state.contexts.isEmpty()&&state.note.matches("[A-Z][A-Z0-9_]+"))feedback=TaskWorkspace.label(state.note);
   String key=state.fingerprint()+"/"+feedback+"/"+history+"/"+choice;
   for(TaskHub.View view:state.contexts)key+="/"+(view.profile.connection.expiresAt<=System.currentTimeMillis());
   if(key.equals(last))return;last=key;render();
  }
  void redraw(){last="";if(snapshot!=null)accept(snapshot,"");}
  void done(TaskRuntime.Snapshot state,String error,String success){
   busy=false;feedback=error.isEmpty()?success:TaskWorkspace.label(error);last="";accept(state,"");
  }
  void render(){
   int y=screen.scroll.getScrollY();screen.body.removeAllViews();screen.dock.removeAllViews();
   if(!feedback.isEmpty())screen.body.addView(AgentUI.text(activity,feedback,14,AgentUI.ACCENT));
   if("defaults".equals(mode))renderDefaults();else if("detail".equals(mode))renderDetail();else renderList();
   screen.scroll.post(()->{if(visible())screen.scroll.scrollTo(0,y);});
  }
  void register(String source){new TaskConnectionUI(activity,()->runtime.reload((state,error)->done(state,error,"连接已保存。")),source).show();}
  // One-time pairing (2026-10-24): the computer shows a code (device.mjs pair-phone); after that every
  // agent session that joins appears here by itself, and the credential renews in the background.
  void pairingCard(){
   LinearLayout card=AgentUI.card(activity,screen.body);
   if(snapshot.device.isEmpty()){
    card.addView(AgentUI.text(activity,"手机配对",17,AgentUI.INK));
    card.addView(AgentUI.text(activity,"在电脑上运行 device.mjs pair-phone 得到配对码，输入一次即可；之后电脑上的 Agent 会话会自动出现在这里，无需再导入登记文件。",14,AgentUI.MUTED));
    AgentUI.button(activity,card,"输入配对码",true,this::askCode);
   }else{
    card.addView(AgentUI.text(activity,snapshot.device,15,AgentUI.INK));
    if(!snapshot.pairing.isEmpty())card.addView(AgentUI.text(activity,snapshot.pairing.equals("PAIRING_REVOKED")||snapshot.pairing.equals("PAIRING_EXPIRED")?"配对已失效，请在电脑上生成新的配对码后重新配对":"配对同步暂时失败："+TaskWorkspace.label(snapshot.pairing),14,AgentUI.ACCENT));
    AgentUI.button(activity,card,"解除配对",false,()->AgentUI.confirm(activity,"解除这台手机的配对？","服务器会作废这台手机的凭据，自动出现的会话连接会暂停；已有任务和回复记录继续保留。",()->{busy=true;runtime.unpairDevice((state,error)->done(state,error,"已解除配对。"));}));
   }
   AgentUI.gap(activity,screen.body,12);
  }
  void askCode(){
   android.widget.EditText edit=AgentUI.input(activity);edit.setHint("XXXXX-XXXXX");edit.setSingleLine(true);
   // Visible-password variation keeps Chinese IMEs in plain ASCII mode (pinyin composition ate the code).
   edit.setInputType(android.text.InputType.TYPE_CLASS_TEXT|android.text.InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD|android.text.InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS);edit.setFilters(new android.text.InputFilter[]{new android.text.InputFilter.AllCaps(),new android.text.InputFilter.LengthFilter(16)});
   AgentUI.alert(activity).setTitle("输入配对码").setMessage("配对码 10 分钟内有效，只能用一次。").setView(edit).setNegativeButton("取消",null)
    .setPositiveButton("配对",(dialog,which)->{String code=edit.getText().toString();try{TaskDevice.code(code);}catch(IllegalArgumentException invalid){feedback="配对码格式不对，应为 10 位字母数字";redraw();return;}
     busy=true;feedback="正在配对…";redraw();runtime.pair(code,(state,error)->done(state,error,"配对成功。电脑上的 Agent 会话会自动出现在这里。"));}).show();
  }
  void renderList(){
   pairingCard();
   AgentUI.button(activity,screen.body,"选择默认 Agent 与工作区",false,()->defaults(activity));
   screen.body.addView(AgentUI.text(activity,"每条连接都保留自己的任务和回复。暂停连接会暂停手机交换消息，电脑上的任务不会因此暂停。",14,AgentUI.MUTED));
   List<TaskHub.View> expired=new ArrayList<>();int shown=0;long now=System.currentTimeMillis();
   for(TaskHub.View view:snapshot.contexts){if(view.profile.connection.expiresAt<=now)expired.add(view);else{connectionCard(view);shown++;}}
   if(shown==0)screen.body.addView(AgentUI.text(activity,snapshot.contexts.isEmpty()?(snapshot.device.isEmpty()?"还没有电脑连接。请先完成手机配对。":"已配对，等待电脑上的 Agent 会话加入。"):"暂无有效连接。",16,AgentUI.INK));
   if(!expired.isEmpty()){
    AgentUI.gap(activity,screen.body,16);
    AgentUI.button(activity,screen.body,(history?"收起":"查看")+"已到期连接（"+expired.size()+"）",false,()->{history=!history;redraw();});
    if(history)for(TaskHub.View view:expired)connectionCard(view);
   }
   AgentUI.button(activity,screen.dock,"添加电脑连接",true,()->register(null));
  }
  void connectionCard(TaskHub.View view){
   TaskConnection connection=view.profile.connection;LinearLayout card=AgentUI.card(activity,screen.body);
   card.addView(AgentUI.text(activity,connection.agent+(view.binding.equals(snapshot.defaultBinding)?" · 默认":""),18,AgentUI.INK));
   card.addView(AgentUI.text(activity,connection.computer+" · "+connection.project,14,AgentUI.MUTED));
   String topic=topic(view);if(!topic.isEmpty()){TextView text=AgentUI.text(activity,topic,15,AgentUI.INK);text.setMaxLines(2);text.setEllipsize(android.text.TextUtils.TruncateAt.END);card.addView(text);}
   AgentUI.gap(activity,card,10);card.addView(AgentUI.text(activity,status(view),13,AgentUI.MUTED));
   AgentUI.button(activity,card,"查看连接",false,()->detail(activity,view.binding));
  }
  void renderDetail(){
   TaskHub.View view=snapshot.context(binding);
   if(view==null){screen.body.addView(AgentUI.text(activity,"这条连接已变化，请返回连接列表。",16,AgentUI.INK));return;}
   TaskConnection connection=view.profile.connection;boolean expired=connection.expiresAt<=System.currentTimeMillis();
   LinearLayout card=AgentUI.card(activity,screen.body);
   field(card,"Agent",connection.agent);field(card,"电脑",connection.computer);field(card,"工作区",connection.project);field(card,"登记会话",connection.session);
   String topic=topic(view);if(!topic.isEmpty())field(card,"任务主题",topic);
   field(card,"连接状态",status(view));field(card,"登记有效期",date(connection.expiresAt));
   field(card,"默认目标",binding.equals(snapshot.defaultBinding)?"当前默认 Agent 与工作区":"未设为默认");
   screen.body.addView(AgentUI.text(activity,"默认用于之后的新任务。已有问题的回复始终回到它原来的 Agent 和会话。",14,AgentUI.MUTED));
   if(expired){
    AgentUI.button(activity,screen.body,"重新登记连接",true,()->register(binding));
   }else{
    TextView toggle=AgentUI.button(activity,screen.body,view.profile.enabled?"暂停连接":"恢复连接",true,()->{
     busy=true;feedback=view.profile.enabled?"正在暂停连接…":"正在核对身份并恢复连接…";render();
     TaskRuntime.Result callback=(state,error)->done(state,error,view.profile.enabled?"连接已暂停，已有任务和回复记录仍保留。":"连接已启用，正在继续同步。");
     if(view.profile.enabled)runtime.pause(binding,callback);else runtime.resume(binding,callback);
    });toggle.setEnabled(!busy);
    screen.body.addView(AgentUI.text(activity,"暂停连接不会暂停电脑正在执行的任务。要调整任务，请在任务详情中操作。",13,AgentUI.MUTED));
    if(!binding.equals(snapshot.defaultBinding)){
     TextView select=AgentUI.button(activity,screen.body,"设为默认 Agent 与工作区",false,()->{
      long expected=snapshot.directory.defaultRevision();busy=true;feedback="正在保存默认目标…";render();runtime.setDefault(connection.route(),expected,(state,error)->done(state,error,"默认设置已核对，以当前显示为准。"));
     });select.setEnabled(!busy&&snapshot.pendingDefault==null&&snapshot.directory!=null&&snapshot.directory.gate(connection.route(),TaskSessionDirectory.elapsed()).isEmpty());
    }
    TextView edit=AgentUI.button(activity,screen.body,"更新登记文件",false,()->register(binding));edit.setEnabled(!busy);
   }
   if(expired&&!binding.equals(snapshot.defaultBinding)&&!binding.equals(snapshot.binding))AgentUI.button(activity,screen.body,"移除已到期登记",false,()->AgentUI.confirm(activity,"移除这条登记？","只移除已到期连接，已有任务和回复记录继续保留。",()->{
    busy=true;runtime.remove(binding,(state,error)->{if(error.isEmpty())screen.dialog.dismiss();else done(state,error,"");});
   }));
  }
  void renderDefaults(){
   screen.body.addView(AgentUI.text(activity,"手机和电脑 CLI 共用这个默认目标。临时选择其他会话下发任务，不会修改默认；原问题始终回到原会话。",14,AgentUI.MUTED));
   TaskSessionDirectory directory=snapshot.directory;
   LinearLayout current=AgentUI.card(activity,screen.body);current.addView(AgentUI.text(activity,"当前默认目标",14,AgentUI.MUTED));
   TaskSessionDirectory.Entry selected=directory==null?null:directory.find(snapshot.defaultRoute);
   String currentText=snapshot.defaultRoute==null?"尚未设置":selected==null?snapshot.defaultRoute.get("agent_id")+" · "+snapshot.defaultRoute.get("computer_id")+"\n会话 · "+snapshot.defaultRoute.get("session_id"):selected.display();
   current.addView(AgentUI.text(activity,currentText,16,AgentUI.INK));if(!snapshot.defaultStatus.isEmpty())current.addView(AgentUI.text(activity,TaskWorkspace.label(snapshot.defaultStatus),13,AgentUI.MUTED));
   if(!snapshot.directoryNote.isEmpty())screen.body.addView(AgentUI.text(activity,TaskWorkspace.label(snapshot.directoryNote),14,AgentUI.ACCENT));
   TextView refresh=AgentUI.button(activity,screen.body,"刷新真实会话",false,()->{busy=true;runtime.readDirectory((state,error)->done(state,error,"会话状态已更新。"));});refresh.setEnabled(!busy);
   if(snapshot.device.isEmpty()){AgentUI.button(activity,screen.dock,"完成手机配对",true,()->show(activity));return;}
   if(snapshot.pendingDefault!=null){
    screen.body.addView(AgentUI.text(activity,"上次默认设置的结果尚未核对。重试会保留同一操作，不会覆盖后来在其他设备设置的默认。",14,AgentUI.MUTED));
    TextView retry=AgentUI.button(activity,screen.body,"重试上次保存",true,()->{busy=true;runtime.retryDefault((state,error)->done(state,error,"默认设置已核对，以当前显示为准。"));});retry.setEnabled(!busy);
   }
   if(directory==null||directory.sessions.isEmpty()){screen.body.addView(AgentUI.text(activity,"暂无已连接的真实会话。请在电脑的目标 Claude 或 Codex 会话启动原生连接；仅登记问答不会出现在此列表。",15,AgentUI.MUTED));return;}
   if(!choiceMade){choice=snapshot.defaultRoute==null?"":TaskSessionDirectory.routeKey(snapshot.defaultRoute);choiceRevision=directory.defaultRevision();}
   RadioGroup options=new RadioGroup(activity);options.setOrientation(LinearLayout.VERTICAL);screen.body.addView(options);
   long now=TaskSessionDirectory.elapsed();
   for(TaskSessionDirectory.Entry entry:directory.sessions){
    RadioButton option=new RadioButton(activity);option.setId(android.view.View.generateViewId());option.setTag(entry.key);option.setTextColor(AgentUI.INK);option.setTextSize(15);option.setButtonTintList(ColorStateList.valueOf(AgentUI.ACCENT));
    option.setText(entry.display()+"\n"+entry.status(now));option.setPadding(0,AgentUI.dp(activity,12),0,AgentUI.dp(activity,12));options.addView(option,new RadioGroup.LayoutParams(-1,-2));option.setChecked(entry.key.equals(choice));option.setEnabled(!busy&&snapshot.pendingDefault==null&&entry.gate(now).isEmpty());
   }
   screen.body.addView(AgentUI.text(activity,"默认离线、忙碌或连接暂停时会保留原目标，不会改投其他会话。",13,AgentUI.MUTED));
   TextView save=AgentUI.button(activity,screen.dock,"保存默认目标",true,()->{
    TaskSessionDirectory.Entry target=chosen();if(target==null||!target.gate(TaskSessionDirectory.elapsed()).isEmpty())return;
    long expected=choiceRevision;busy=true;feedback="正在保存默认目标…";render();runtime.setDefault(target.route,expected,(state,error)->{choiceMade=false;done(state,error,"默认设置已核对，以当前显示为准。");});
   });TaskSessionDirectory.Entry target=chosen();save.setEnabled(!busy&&snapshot.pendingDefault==null&&target!=null&&target.gate(now).isEmpty());
   options.setOnCheckedChangeListener((group,id)->{RadioButton option=group.findViewById(id);if(option!=null){choice=(String)option.getTag();choiceMade=true;choiceRevision=snapshot.directory.defaultRevision();save.setEnabled(!busy&&snapshot.pendingDefault==null);}});
   if(snapshot.defaultRoute!=null){TextView clear=AgentUI.button(activity,screen.body,"清除默认目标",false,()->{long expected=snapshot.directory.defaultRevision();busy=true;runtime.setDefault(null,expected,(state,error)->{choiceMade=false;done(state,error,"默认设置已核对，以当前显示为准。");});});clear.setEnabled(!busy&&snapshot.pendingDefault==null);}
  }
  TaskSessionDirectory.Entry chosen(){if(snapshot.directory!=null)for(TaskSessionDirectory.Entry entry:snapshot.directory.sessions)if(entry.key.equals(choice))return entry;return null;}
  void field(LinearLayout parent,String label,String value){parent.addView(AgentUI.text(activity,label,12,AgentUI.MUTED));TextView text=AgentUI.text(activity,value,16,AgentUI.INK);text.setTextIsSelectable(true);parent.addView(text);AgentUI.gap(activity,parent,12);}
 }
 private static String status(TaskHub.View view){
  if(view.profile.connection.expiresAt<=System.currentTimeMillis())return "已到期，需要重新登记";
  if(!view.profile.enabled)return "连接已暂停";
  if("paused".equals(view.note)||"ready".equals(view.note))return "已启用，等待同步";
  return TaskWorkspace.label(view.note);
 }
 private static String date(long time){return new SimpleDateFormat("yyyy-MM-dd HH:mm",Locale.getDefault()).format(new Date(time));}
 private static String topic(TaskHub.View view){
  String result="";for(Object raw:view.objects){Map<String,Object> item=WireJson.map(WireJson.map(raw).get("item"));if("task".equals(item.get("kind"))){Object command=TaskWire.body(item).get("command");if(command instanceof String){String first=((String)command).trim().split("\\R",2)[0];if(!first.isEmpty())result=first;}}}return result;
 }
}
