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
  TaskRuntime.Snapshot snapshot;String last="",choice="",feedback="";boolean closed,busy,history,choiceMade;
  final TaskRuntime.Result observer=this::accept;
  Page(Activity activity,String mode,String binding){
   this.activity=activity;this.mode=mode;this.binding=binding;runtime=TaskRuntime.get(activity);
   screen=new AgentUI.Screen(activity,"defaults".equals(mode)?"默认 Agent 与工作区":"detail".equals(mode)?"连接详情":"电脑连接");
  }
  void open(){
   screen.body.addView(AgentUI.text(activity,"正在读取已登记连接…",15,AgentUI.MUTED));
   screen.dialog.setOnDismissListener(dialog->{closed=true;runtime.unobserve(observer);});runtime.observe(activity,observer);
  }
  boolean visible(){return !closed&&screen.dialog.isShowing()&&!activity.isFinishing()&&!activity.isDestroyed();}
  void accept(TaskRuntime.Snapshot state,String error){
   snapshot=state;if(!visible()||busy)return;
   if(!error.isEmpty())feedback=TaskWorkspace.label(error);
   else if(state.contexts.isEmpty()&&state.note.matches("[A-Z][A-Z0-9_]+"))feedback=TaskWorkspace.label(state.note);
   String key=state.fingerprint+"/"+feedback+"/"+history+"/"+choice;
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
  void renderList(){
   screen.body.addView(AgentUI.text(activity,"每条连接都保留自己的任务和回复。暂停连接会暂停手机交换消息，电脑上的任务不会因此暂停。",14,AgentUI.MUTED));
   List<TaskHub.View> expired=new ArrayList<>();int shown=0;long now=System.currentTimeMillis();
   for(TaskHub.View view:snapshot.contexts){if(view.profile.connection.expiresAt<=now)expired.add(view);else{connectionCard(view);shown++;}}
   if(shown==0)screen.body.addView(AgentUI.text(activity,snapshot.contexts.isEmpty()?"还没有电脑连接。请从电脑提供登记文件。":"暂无有效连接，请重新登记。",16,AgentUI.INK));
   if(!expired.isEmpty()){
    AgentUI.gap(activity,screen.body,16);
    AgentUI.button(activity,screen.body,(history?"收起":"查看")+"已到期连接（"+expired.size()+"）",false,()->{history=!history;redraw();});
    if(history)for(TaskHub.View view:expired)connectionCard(view);
   }
   AgentUI.button(activity,screen.dock,"添加电脑连接",true,()->register(null));
  }
  void connectionCard(TaskHub.View view){
   TaskConnection connection=view.profile.connection;LinearLayout card=AgentUI.card(activity,screen.body);
   card.addView(AgentUI.text(activity,connection.agent+(view.binding.equals(snapshot.binding)?" · 默认":""),18,AgentUI.INK));
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
   field(card,"默认目标",binding.equals(snapshot.binding)?"当前默认 Agent 与工作区":"未设为默认");
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
    if(!binding.equals(snapshot.binding)){
     TextView select=AgentUI.button(activity,screen.body,"设为默认 Agent 与工作区",false,()->{
      busy=true;feedback="正在保存默认目标…";render();runtime.select(binding,(state,error)->done(state,error,"已设为默认 Agent 与工作区。"));
     });select.setEnabled(!busy);
    }
    TextView edit=AgentUI.button(activity,screen.body,"更新登记文件",false,()->register(binding));edit.setEnabled(!busy);
   }
   if(expired&&!binding.equals(snapshot.binding))AgentUI.button(activity,screen.body,"移除已到期登记",false,()->AgentUI.confirm(activity,"移除这条登记？","只移除已到期连接，已有任务和回复记录继续保留。",()->{
    busy=true;runtime.remove(binding,(state,error)->{if(error.isEmpty())screen.dialog.dismiss();else done(state,error,"");});
   }));
  }
  void renderDefaults(){
   screen.body.addView(AgentUI.text(activity,"选择已登记的 Agent 和工作区，作为之后新任务的默认目标。每个选项仍绑定电脑登记的原会话。",14,AgentUI.MUTED));
   if(!choiceMade)choice=snapshot.binding;
   if(snapshot.contexts.isEmpty()){
    screen.body.addView(AgentUI.text(activity,"先登记一个电脑连接，再设置默认目标。",16,AgentUI.INK));
    AgentUI.button(activity,screen.dock,"添加电脑连接",true,()->register(null));return;
   }
   RadioGroup options=new RadioGroup(activity);options.setOrientation(LinearLayout.VERTICAL);screen.body.addView(options);
   boolean any=false;long now=System.currentTimeMillis();
   for(TaskHub.View view:snapshot.contexts){
    TaskConnection connection=view.profile.connection;boolean expired=connection.expiresAt<=now;
    if(expired&&!view.binding.equals(snapshot.binding))continue;
    RadioButton option=new RadioButton(activity);option.setId(android.view.View.generateViewId());option.setTag(view.binding);option.setTextColor(AgentUI.INK);option.setTextSize(15);option.setButtonTintList(ColorStateList.valueOf(AgentUI.ACCENT));
    option.setText(connection.agent+" · "+connection.computer+"\n工作区："+connection.project+"\n"+(topic(view).isEmpty()?"登记会话："+connection.session:topic(view))+"\n"+status(view));
    option.setPadding(0,AgentUI.dp(activity,12),0,AgentUI.dp(activity,12));options.addView(option,new RadioGroup.LayoutParams(-1,-2));option.setChecked(view.binding.equals(choice));option.setEnabled(!expired&&!busy);if(!expired)any=true;
   }
   if(!any)screen.body.addView(AgentUI.text(activity,"已登记连接均已到期，请先重新登记。",14,AgentUI.MUTED));
   screen.body.addView(AgentUI.text(activity,"暂停的默认连接会保持暂停，不会自动改用其他 Agent。默认目标也为后续眼镜主动唤起预留。",13,AgentUI.MUTED));
   TextView save=AgentUI.button(activity,screen.dock,"保存默认目标",true,()->{
    TaskHub.View target=snapshot.context(choice);
    if(target==null||target.profile.connection.expiresAt<=System.currentTimeMillis()){feedback="请选择仍有效的已登记连接。";redraw();return;}
    busy=true;feedback="正在保存默认目标…";render();runtime.select(choice,(state,error)->done(state,error,"默认 Agent 与工作区已保存。"));
   });TaskHub.View target=snapshot.context(choice);save.setEnabled(!busy&&target!=null&&target.profile.connection.expiresAt>now);
   options.setOnCheckedChangeListener((group,id)->{RadioButton selected=group.findViewById(id);if(selected!=null){choice=(String)selected.getTag();choiceMade=true;save.setEnabled(!busy);}});
  }
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
