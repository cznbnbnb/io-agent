package com.turboio.addon;

import android.app.Activity;
import android.content.res.ColorStateList;
import android.view.Gravity;
import android.widget.*;
import java.text.SimpleDateFormat;
import java.util.*;

/** Connection controls stay in detail. Selecting a default never retargets an answer. */
final class AgentConnectionsPage {
 static void show(Activity activity){TaskNames.init(activity);new Page(activity,"list",null).open();}
 static void phones(Activity activity){new Page(activity,"phones",null).open();}
 static void defaults(Activity activity){new Page(activity,"defaults",null).open();}
 private static void detail(Activity activity,String binding){new Page(activity,"detail",binding).open();}

 private static final class Page {
  final Activity activity;final String mode,binding;final TaskRuntime runtime;final AgentUI.Screen screen;
  TaskRuntime.Snapshot snapshot;String last="",choice="",feedback="";boolean closed,busy,history,offline,choiceMade;long choiceRevision;
  final TaskRuntime.Result observer=this::accept;
  Page(Activity activity,String mode,String binding){
   this.activity=activity;this.mode=mode;this.binding=binding;runtime=TaskRuntime.get(activity);
   screen=new AgentUI.Screen(activity,"phones".equals(mode)?"手机与换机":"defaults".equals(mode)?"默认 Agent 与工作区":"detail".equals(mode)?"连接详情":"电脑连接");
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
   String key=state.fingerprint()+"/"+feedback+"/"+history+"/"+offline+"/"+choice;
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
   if("phones".equals(mode))renderPhones();else if("defaults".equals(mode))renderDefaults();else if("detail".equals(mode))renderDetail();else renderList();
   screen.scroll.post(()->{if(visible())screen.scroll.scrollTo(0,y);});
  }
  void register(String source){new TaskConnectionUI(activity,()->runtime.reload((state,error)->done(state,error,"连接已保存。")),source).show();}
  // One-time pairing (2026-10-24): the computer shows a code (device.mjs pair-phone); after that every
  // agent session that joins appears here by itself, and the credential renews in the background.
  void pairingCard(){
   if(snapshot.device.isEmpty()){
    LinearLayout card=AgentUI.summary(activity,screen.body,"smartphone","恢复账号连接","换手机后，一次恢复已配对电脑与默认工作区。");
    AgentUI.button(activity,card,"输入恢复码",true,this::askCode);
   }else{
    LinearLayout card=AgentUI.summary(activity,screen.body,"shield-check","手机已配对",snapshot.phone==null?"同账号电脑与会话自动恢复":snapshot.phone.status());
    if(!snapshot.pairing.isEmpty()){AgentUI.gap(activity,card,10);card.addView(AgentUI.text(activity,snapshot.pairing.equals("PAIRING_REVOKED")||snapshot.pairing.equals("PAIRING_EXPIRED")?"授权已失效，请重新恢复连接":"配对同步暂未完成："+TaskWorkspace.label(snapshot.pairing),13,MaterialReadingUI.AMBER));}
    if("phones".equals(mode)){AgentUI.divider(activity,card);AgentUI.iconRow(activity,card,"link","配对信息",null,null,()->AgentUI.notice(activity,snapshot.device));AgentUI.iconRow(activity,card,"x","解除这台手机配对",null,null,()->AgentUI.confirm(activity,"解除这台手机的配对？","这台手机将停止自动同步。已有任务、回复和资料继续保留。","解除配对",()->{busy=true;runtime.unpairDevice((state,error)->done(state,error,"已解除配对。"));}));}
    else{AgentUI.divider(activity,card);AgentUI.iconRow(activity,card,"smartphone","手机与换机",null,null,()->phones(activity));}
   }
   AgentUI.gap(activity,screen.body,16);
  }
  void renderPhones(){
   pairingCard();screen.body.addView(AgentUI.text(activity,"仅主手机自动向眼镜投送问题、提醒与待办。其他手机保留资料，不会重复投送。",14,AgentUI.MUTED));
   PhonePresence p=snapshot.phone;if(p==null){screen.body.addView(AgentUI.text(activity,snapshot.device.isEmpty()?"让已配对电脑上的 Agent 生成手机恢复码，10 分钟内有效。":"正在核对主手机状态，请稍候或重新打开此页。",14,AgentUI.MUTED));return;}
   LinearLayout list=AgentUI.section(activity,screen.body,"已授权手机");for(PhonePresence.Phone phone:p.phones){if(phone.revoked)continue;AgentUI.iconRow(activity,list,"smartphone",phone.label,phone.id.equals(p.device)?"这台手机":"已授权手机",phone.id.equals(p.primary)?"主手机":"",null);AgentUI.divider(activity,list);}
   if(!p.primary.equals(p.device)){TextView button=AgentUI.button(activity,screen.dock,"设为主手机",true,()->AgentUI.confirm(activity,"将这台设为主手机？","旧手机停止自动投送，已有资料和电脑配对保留。切换最多等待 20 秒。",()->{busy=true;feedback="正在切换主手机…";render();runtime.makePrimary(p.revision,(state,error)->done(state,error,"已保存主手机选择，旧手机退出后自动接手。"));}));button.setEnabled(!busy);}
   else screen.body.addView(AgentUI.text(activity,p.waitMillis>0?"正在切换，旧手机退出后自动接手（最多 20 秒）。":"这台手机接收眼镜投送。换机不改变默认 Agent 与工作区。",14,AgentUI.ACCENT));
  }
  void askCode(){
   android.widget.EditText edit=AgentUI.input(activity);edit.setHint("XXXXX-XXXXX");edit.setSingleLine(true);
   // Visible-password variation keeps Chinese IMEs in plain ASCII mode (pinyin composition ate the code).
   edit.setInputType(android.text.InputType.TYPE_CLASS_TEXT|android.text.InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD|android.text.InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS);edit.setFilters(new android.text.InputFilter[]{new android.text.InputFilter.AllCaps(),new android.text.InputFilter.LengthFilter(16)});
   AgentUI.alert(activity).setTitle("输入手机恢复码").setMessage("由已配对电脑生成，10 分钟内有效。恢复当前账号的连接，不会逐个重新绑定 Agent。").setView(edit).setNegativeButton("取消",null)
    .setPositiveButton("恢复连接",(dialog,which)->{String code=edit.getText().toString();try{TaskDevice.code(code);}catch(IllegalArgumentException invalid){feedback="配对码格式不对，应为 10 位字母数字";redraw();return;}
     busy=true;feedback="正在恢复连接…";redraw();runtime.pair(code,(state,error)->done(state,error,"已恢复同账号连接。请在“手机与换机”中将这台设为主手机。"));}).show();
  }
  /** Sessions grouped by whether they can take work now: online first, offline and expired folded. */
  void renderList(){
   pairingCard();
   long now=System.currentTimeMillis(),elapsed=TaskSessionDirectory.elapsed();List<TaskHub.View> live=new ArrayList<>(),idle=new ArrayList<>(),expired=new ArrayList<>();
   for(TaskHub.View view:snapshot.contexts){if(view.profile.connection.expiresAt<=now)expired.add(view);else{TaskSessionDirectory.Entry e=entry(view);if(view.profile.enabled&&e!=null&&TaskTargetUI.ready(e,elapsed))live.add(view);else idle.add(view);}}
   section("可接收任务",live.size());
   if(live.isEmpty())screen.body.addView(AgentUI.text(activity,snapshot.contexts.isEmpty()?(snapshot.device.isEmpty()?"还没有电脑连接。请先完成手机配对。":"已配对，等待电脑上的 Agent 会话加入。"):"暂无可接收任务的会话。请在电脑打开对应会话并完成 CLI 连接。",14,AgentUI.MUTED));
   for(TaskHub.View view:live)sessionCard(view,elapsed);
   if(!idle.isEmpty()){fold("离线与未就绪",idle.size(),offline,()->{offline=!offline;redraw();});if(offline)for(TaskHub.View view:idle)sessionCard(view,elapsed);}
   if(!expired.isEmpty()){fold("已到期登记",expired.size(),history,()->{history=!history;redraw();});if(history)for(TaskHub.View view:expired)sessionCard(view,elapsed);}
   if(!idle.isEmpty()||!expired.isEmpty()){AgentUI.gap(activity,screen.body,10);screen.body.addView(AgentUI.text(activity,"长按未就绪的会话，可移除本机入口。任务记录与电脑文件保留。",12,AgentUI.MUTED));}
   if(!snapshot.removedRoutes.isEmpty()){AgentUI.button(activity,screen.body,"恢复已移除的会话",false,()->AgentUI.confirm(activity,"恢复会话入口？","恢复当前账号目录中被移除的会话，不替换已有登记。旧式连接文件需要重新导入。","恢复",()->{busy=true;runtime.restoreRemoved((state,error,count)->done(state,error,count==0?"账号目录中暂无可恢复的会话，或登记名额已满。旧式连接请重新导入。":"已恢复 "+count+" 个会话入口。"+(state.removedRoutes.isEmpty()?"":"还有 "+state.removedRoutes.size()+" 个待恢复，请先整理登记名额。")));}));}
   AgentUI.gap(activity,screen.body,18);
   AgentUI.button(activity,screen.body,"选择默认 Agent 与工作区",false,()->defaults(activity));AgentUI.gap(activity,screen.body,8);
   screen.body.addView(AgentUI.text(activity,"手机已登记 "+snapshot.contexts.size()+" / "+TaskProfiles.MAX+" 个会话。满了会自动替换最久没用的离线会话；只有默认会话、还在等你回复或有未发出内容的会话会被保留。",12,AgentUI.MUTED));
   AgentUI.button(activity,screen.dock,"添加 Agent 会话",true,()->AgentSessionPairUI.show(activity));
   TextView legacy=AgentUI.text(activity,"导入旧版连接",13,AgentUI.MUTED);legacy.setGravity(android.view.Gravity.CENTER);legacy.setFocusable(true);legacy.setOnClickListener(v->register(null));screen.body.addView(legacy,new LinearLayout.LayoutParams(-1,AgentUI.dp(activity,44)));
  }
  /** A local name for this session; empty restores the name it joined with. */
  void rename(TaskSessionDirectory.Entry e,String agent){
   android.widget.EditText edit=AgentUI.input(activity);edit.setSingleLine(true);edit.setText(TaskNames.get(e.route));edit.setHint(TaskPresentation.sessionName(e.label,agent));edit.setFilters(new android.text.InputFilter[]{new android.text.InputFilter.LengthFilter(TaskNames.MAX)});
   AgentUI.alert(activity).setTitle("修改名称").setMessage("只改这台手机上显示的名称，不影响电脑上的会话。留空恢复原名称。").setView(edit).setNegativeButton("取消",null)
    .setPositiveButton("保存",(dialog,which)->{TaskNames.set(e.route,edit.getText().toString());feedback="名称已更新。";redraw();}).show();
  }
  TaskSessionDirectory.Entry entry(TaskHub.View view){return snapshot.directory==null?null:snapshot.directory.find(view.profile.connection.route());}
  void section(String title,int count){
   LinearLayout head=new LinearLayout(activity);head.setGravity(android.view.Gravity.BOTTOM);head.setPadding(0,AgentUI.dp(activity,6),0,AgentUI.dp(activity,8));
   head.addView(MaterialReadingUI.bold(AgentUI.text(activity,title,16,AgentUI.INK)));head.addView(AgentUI.text(activity,"  "+count,14,AgentUI.MUTED));screen.body.addView(head);
  }
  void fold(String title,int count,boolean open,Runnable toggle){
   LinearLayout row=new LinearLayout(activity);row.setGravity(android.view.Gravity.CENTER_VERTICAL);row.setPadding(AgentUI.dp(activity,14),0,AgentUI.dp(activity,10),0);row.setBackground(MaterialReadingUI.pressable(activity,MaterialReadingUI.fill(activity,MaterialReadingUI.CARD,14)));
   row.addView(AgentUI.text(activity,title,14,MaterialReadingUI.SOFT));row.addView(AgentUI.text(activity,"  "+count,13,AgentUI.MUTED),new LinearLayout.LayoutParams(0,-2,1));
   row.addView(AgentUI.text(activity,open?"收起":"展开",13,AgentUI.MUTED));MaterialReadingUI.glyph(activity,row,open?"down":"right",AgentUI.MUTED,14);
   row.setFocusable(true);row.setContentDescription(title+" "+count+"，"+(open?"收起":"展开"));row.setOnClickListener(v->toggle.run());
   LinearLayout.LayoutParams lp=new LinearLayout.LayoutParams(-1,AgentUI.dp(activity,46));lp.topMargin=AgentUI.dp(activity,14);screen.body.addView(row,lp);
  }
  void sessionCard(TaskHub.View view,long elapsed){
   TaskSessionDirectory.Entry e=entry(view);TaskTargetUI.Target t=e!=null?TaskTargetUI.Target.of(e,elapsed):TaskTargetUI.Target.saved(view.profile.connection);
   LinearLayout card=new LinearLayout(activity);LinearLayout.LayoutParams lp=new LinearLayout.LayoutParams(-1,-2);lp.topMargin=AgentUI.dp(activity,8);screen.body.addView(card,lp);
   String note=view.profile.connection.expiresAt<=System.currentTimeMillis()?"登记已到期，需要重新登记":!view.profile.enabled?"手机收发已暂停":null;
   TaskTargetUI.bind(activity,card,t,view.binding.equals(snapshot.defaultBinding),false,"",note,topic(view),MaterialReadingUI.CARD);
   card.setOnClickListener(v->detail(activity,view.binding));
   boolean removable=view.profile.connection.expiresAt<=System.currentTimeMillis()||!view.profile.enabled||e==null||!e.live(elapsed)||!Boolean.TRUE.equals(e.capabilities.get("can_execute"));
   if(removable){card.setOnLongClickListener(v->{remove(view);return true;});card.setContentDescription(card.getContentDescription()+"，长按移除会话入口");}

  }
  void remove(TaskHub.View view){
   if(busy)return;boolean pending=TaskProfiles.unsent(view.pending)||!new TaskPresentation(Collections.singletonList(new TaskPresentation.Source(view.profile,view.objects,view.pending)),System.currentTimeMillis()).questions.isEmpty();
   if(pending){AgentUI.notice(activity,"这条会话还有未发出的内容或等待回答的问题。请先在任务页处理，再移除会话入口。");return;}
   TaskSessionDirectory.Entry entry=entry(view);boolean accountEntry=entry!=null&&view.binding.equals(snapshot.bindingFor(entry.route));
   String message="只移除这台手机的会话入口，任务记录、电脑文件和账号配对都会保留。"+(accountEntry?"刷新后不会自动恢复，可通过“恢复已移除的会话”找回。":"这是旧式导入登记；需要时重新导入同一会话的连接文件，才能找回记录。");
   if(view.binding.equals(snapshot.defaultBinding))message+="\n\n这也是当前默认工作区；移除时会清除账号的默认选择，之后需重新选择。";
   AgentUI.confirm(activity,"移除这条会话入口？",message,"移除",()->{busy=true;runtime.remove(view.binding,(state,error)->{if(error.isEmpty()&&"detail".equals(mode))screen.dialog.dismiss();else done(state,error,"已移除本机会话入口。");});});
  }
  void renderDetail(){
   TaskHub.View view=snapshot.context(binding);if(view==null){AgentUI.summary(activity,screen.body,"info","会话入口已移除","返回列表查看其他会话。");return;}
   TaskConnection connection=view.profile.connection;boolean expired=connection.expiresAt<=System.currentTimeMillis();TaskSessionDirectory.Entry e=entry(view);long elapsed=TaskSessionDirectory.elapsed();String agent=e==null?TaskPresentation.agentName(connection.agent):TaskTargetUI.agent(e);
   AgentUI.summary(activity,screen.body,"monitor",e==null?connection.project:TaskNames.title(e.route,e.label,agent),agent+" · "+(e==null?"状态待更新":e.status(elapsed)));
   LinearLayout info=AgentUI.section(activity,screen.body,"会话信息");
   AgentUI.iconRow(activity,info,"monitor","电脑",null,e==null?TaskPresentation.computerName(connection.computer):TaskTargetUI.computer(e),null);AgentUI.divider(activity,info);
   AgentUI.iconRow(activity,info,"folder","工作区",e==null?connection.project:e.workspace,null,null);AgentUI.divider(activity,info);
   AgentUI.iconRow(activity,info,"star","默认工作区",null,binding.equals(snapshot.defaultBinding)?"当前默认":"未设为默认",null);
   if(e!=null){AgentUI.divider(activity,info);AgentUI.iconRow(activity,info,"file-text","会话名称",TaskNames.title(e.route,e.label,agent),"修改",()->rename(e,agent));}
   String topic=topic(view);if(!topic.isEmpty()){AgentUI.divider(activity,info);AgentUI.row(activity,info,"最近任务",topic,null,null);}
   LinearLayout controls=AgentUI.section(activity,screen.body,"连接管理");
   if(expired){AgentUI.iconRow(activity,controls,"refresh","重新登记连接","当前登记已到期",null,()->register(binding));}
   else{
    AgentUI.iconRow(activity,controls,view.profile.enabled?"pause":"refresh",view.profile.enabled?"暂停连接":"恢复连接","只控制手机收发，不停止电脑任务",null,()->{if(busy)return;busy=true;TaskRuntime.Result done=(state,error)->done(state,error,view.profile.enabled?"连接已暂停。":"连接已恢复。");if(view.profile.enabled)runtime.pause(binding,done);else runtime.resume(binding,done);});
    if(!binding.equals(snapshot.defaultBinding)){AgentUI.divider(activity,controls);LinearLayout select=AgentUI.iconRow(activity,controls,"star","设为默认工作区","用于之后的新任务",null,()->{if(busy)return;long expected=snapshot.directory.defaultRevision();busy=true;runtime.setDefault(connection.route(),expected,(state,error)->done(state,error,"默认工作区已更新。"));});boolean can=!busy&&snapshot.pendingDefault==null&&e!=null&&e.gate(elapsed).isEmpty();select.setEnabled(can);select.setAlpha(can?1f:.45f);}
   }
   AgentUI.divider(activity,controls);AgentUI.iconRow(activity,controls,"info","登记与诊断信息","会话标识、有效期和登记文件",null,()->{AgentUI.Screen diagnostics=new AgentUI.Screen(activity,"登记信息");LinearLayout details=AgentUI.section(activity,diagnostics.body,"当前登记");field(details,"会话 ID",connection.session);field(details,"工作目录",e==null?connection.project:e.workspace);field(details,"连接状态",status(view));field(details,"登记有效期",date(connection.expiresAt));AgentUI.button(activity,diagnostics.dock,"更新登记文件",false,()->register(binding));});
   boolean removable=expired||!view.profile.enabled||e==null||!e.live(elapsed)||!Boolean.TRUE.equals(e.capabilities.get("can_execute"));
   if(removable){TextView remove=AgentUI.button(activity,screen.dock,"移除会话入口",false,()->remove(view));remove.setTextColor(MaterialReadingUI.CORAL_TEXT);remove.setEnabled(!busy);}
   AgentUI.gap(activity,screen.body,18);screen.body.addView(AgentUI.text(activity,"已有问题始终回复到原会话。修改默认工作区不会转移正在进行的任务。",13,AgentUI.MUTED));
  }
  void renderDefaults(){
   screen.body.addView(AgentUI.text(activity,"手机和电脑 CLI 共用这个默认目标。临时选择其他会话下发任务，不会修改默认；原问题始终回到原会话。",14,AgentUI.MUTED));
   TaskSessionDirectory directory=snapshot.directory;
   LinearLayout current=AgentUI.section(activity,screen.body,"当前默认工作区");
   TaskSessionDirectory.Entry selected=directory==null?null:directory.find(snapshot.defaultRoute);
   String currentText=snapshot.defaultRoute==null?"尚未设置":selected==null?snapshot.defaultRoute.get("agent_id")+" · "+snapshot.defaultRoute.get("computer_id")+"\n会话 · "+snapshot.defaultRoute.get("session_id"):TaskNames.title(selected.route,selected.label,TaskTargetUI.agent(selected))+"\n"+TaskTargetUI.agent(selected)+" · "+TaskTargetUI.computer(selected);
   current.addView(AgentUI.text(activity,currentText,16,AgentUI.INK));if(!snapshot.defaultStatus.isEmpty())current.addView(AgentUI.text(activity,TaskWorkspace.label(snapshot.defaultStatus),13,AgentUI.MUTED));
   if(!snapshot.directoryNote.isEmpty())screen.body.addView(AgentUI.text(activity,TaskWorkspace.label(snapshot.directoryNote),14,AgentUI.ACCENT));
   TextView refresh=AgentUI.button(activity,screen.body,"刷新真实会话",false,()->{busy=true;runtime.readDirectory((state,error)->done(state,error,"会话状态已更新。"));});refresh.setEnabled(!busy);
   if(snapshot.device.isEmpty()){AgentUI.button(activity,screen.dock,"完成手机配对",true,()->show(activity));return;}
   if(snapshot.pendingDefault!=null){
    screen.body.addView(AgentUI.text(activity,"上次默认设置的结果尚未核对。重试会保留同一操作，不会覆盖后来在其他设备设置的默认。",14,AgentUI.MUTED));
    TextView retry=AgentUI.button(activity,screen.body,"重试上次保存",true,()->{busy=true;runtime.retryDefault((state,error)->done(state,error,"默认设置已核对，以当前显示为准。"));});retry.setEnabled(!busy);
   }
   if(directory==null||snapshot.visibleSessions().isEmpty()){screen.body.addView(AgentUI.text(activity,"暂无已连接的真实会话。请在电脑的目标 Claude 或 Codex 会话启动原生连接；仅登记问答不会出现在此列表。",15,AgentUI.MUTED));return;}
   if(!choiceMade){choice=snapshot.defaultRoute==null?"":TaskSessionDirectory.routeKey(snapshot.defaultRoute);choiceRevision=directory.defaultRevision();}
   RadioGroup options=new RadioGroup(activity);options.setOrientation(LinearLayout.VERTICAL);screen.body.addView(options);
   long now=TaskSessionDirectory.elapsed();
   for(TaskSessionDirectory.Entry entry:snapshot.visibleSessions()){
    RadioButton option=new RadioButton(activity);option.setId(android.view.View.generateViewId());option.setTag(entry.key);option.setTextColor(AgentUI.INK);option.setTextSize(15);option.setButtonTintList(ColorStateList.valueOf(AgentUI.ACCENT));
    option.setText(TaskNames.title(entry.route,entry.label,TaskTargetUI.agent(entry))+"\n"+TaskTargetUI.agent(entry)+" · "+TaskTargetUI.shortPath(entry.workspace)+"\n"+entry.status(now));option.setPadding(AgentUI.dp(activity,10),AgentUI.dp(activity,12),AgentUI.dp(activity,12),AgentUI.dp(activity,12));option.setBackground(MaterialReadingUI.pressable(activity,MaterialReadingUI.fill(activity,AgentUI.SURFACE,14)));RadioGroup.LayoutParams optionLayout=new RadioGroup.LayoutParams(-1,-2);optionLayout.topMargin=AgentUI.dp(activity,8);options.addView(option,optionLayout);option.setChecked(entry.key.equals(choice));option.setEnabled(!busy&&snapshot.pendingDefault==null&&entry.gate(now).isEmpty());
   }
   screen.body.addView(AgentUI.text(activity,"默认离线、忙碌或连接暂停时会保留原目标，不会改投其他会话。",13,AgentUI.MUTED));
   TextView save=AgentUI.button(activity,screen.dock,"保存默认目标",true,()->{
    TaskSessionDirectory.Entry target=chosen();if(target==null||!target.gate(TaskSessionDirectory.elapsed()).isEmpty())return;
    long expected=choiceRevision;busy=true;feedback="正在保存默认目标…";render();runtime.setDefault(target.route,expected,(state,error)->{choiceMade=false;done(state,error,"默认设置已核对，以当前显示为准。");});
   });TaskSessionDirectory.Entry target=chosen();save.setEnabled(!busy&&snapshot.pendingDefault==null&&target!=null&&target.gate(now).isEmpty());
   options.setOnCheckedChangeListener((group,id)->{RadioButton option=group.findViewById(id);if(option!=null){choice=(String)option.getTag();choiceMade=true;choiceRevision=snapshot.directory.defaultRevision();save.setEnabled(!busy&&snapshot.pendingDefault==null);}});
   if(snapshot.defaultRoute!=null){TextView clear=AgentUI.button(activity,screen.body,"清除默认目标",false,()->{long expected=snapshot.directory.defaultRevision();busy=true;runtime.setDefault(null,expected,(state,error)->{choiceMade=false;done(state,error,"默认设置已核对，以当前显示为准。");});});clear.setEnabled(!busy&&snapshot.pendingDefault==null);}
  }
  TaskSessionDirectory.Entry chosen(){if(snapshot.directory!=null)for(TaskSessionDirectory.Entry entry:snapshot.visibleSessions())if(entry.key.equals(choice))return entry;return null;}
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
