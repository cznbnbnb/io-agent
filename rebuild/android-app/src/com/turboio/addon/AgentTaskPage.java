package com.turboio.addon;

import android.app.Activity;
import android.content.Context;
import android.content.SharedPreferences;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.text.InputFilter;
import android.text.InputType;
import android.view.Gravity;
import android.view.View;
import android.widget.*;
import java.util.*;

/** Task tab backed by the original route-bound runtime. Only explicit submission queues a draft. */
final class AgentTaskPage {
 private final Activity activity;
 private final Runnable openConnections;
 private final TaskRuntime runtime;
 private final LinearLayout root,body;
 private final ScrollView scroll;
 private final TextView create;
 private final TaskRuntime.Result observer;
 private final List<AgentUI.Screen> forms=new ArrayList<>();
 private final Set<String> submittingControls=new HashSet<>();
 private TaskRuntime.Snapshot snapshot;
 private TaskPresentation presentation;
 private AgentUI.Screen detail;
 private String detailKey="",filter="running",fingerprint="";
 private boolean active,closed,showHistory,openingQuestion;
 private long nextExpiry=Long.MAX_VALUE;

 AgentTaskPage(Activity a,Runnable openConnections){
  activity=a;this.openConnections=openConnections;runtime=TaskRuntime.get(a);
  root=AgentUI.column(a);scroll=new ScrollView(a);scroll.setFillViewport(true);
  body=AgentUI.column(a);int side=AgentUI.dp(a,16);body.setPadding(side,AgentUI.dp(a,12),side,AgentUI.dp(a,20));scroll.addView(body);
  root.addView(scroll,new LinearLayout.LayoutParams(-1,0,1));
  LinearLayout footer=AgentUI.column(a);footer.setPadding(side,0,side,AgentUI.dp(a,12));
  create=AgentUI.button(a,footer,"＋ 交给 Agent 一件事",false,this::delegate);root.addView(footer);
  body.addView(AgentUI.text(a,"正在读取任务…",15,AgentUI.MUTED));
  observer=(value,error)->{
   if(!active||!alive())return;snapshot=value;
   if(!fingerprint.equals(value.fingerprint())||System.currentTimeMillis()>=nextExpiry){fingerprint=value.fingerprint();render();}
  };
  runtime.observe(a,observer);
 }
 View view(){return root;}
 void setActive(boolean value){active=value;}
 void refresh(){if(!closed&&active)runtime.read(null);}
 void close(){if(closed)return;closed=true;runtime.unobserve(observer);for(AgentUI.Screen form:new ArrayList<>(forms))if(form.dialog.isShowing())form.dialog.dismiss();forms.clear();if(detail!=null&&detail.dialog.isShowing())detail.dialog.dismiss();}
 private boolean alive(){return !closed&&!activity.isFinishing()&&!activity.isDestroyed();}
 private void render(){
  if(!alive()||snapshot==null)return;int position=scroll.getScrollY();Activity a=activity;
  List<TaskPresentation.Source> sources=new ArrayList<>();for(TaskHub.View context:snapshot.contexts)sources.add(new TaskPresentation.Source(context.profile,context.objects,context.pending));
  long now=System.currentTimeMillis();presentation=new TaskPresentation(sources,now);nextExpiry=Long.MAX_VALUE;
  for(TaskPresentation.Question question:presentation.questions){long expiry=TaskWire.stamp(question.item.get("expires_at"));if(expiry>now)nextExpiry=Math.min(nextExpiry,expiry);if(question.profile.connection.expiresAt>now)nextExpiry=Math.min(nextExpiry,question.profile.connection.expiresAt);}body.removeAllViews();
  // Connection strip: one tappable line instead of a heading plus a link.
  int enabled=0;for(TaskHub.View context:snapshot.contexts)if(context.profile.enabled&&context.profile.connection.expiresAt>now)enabled++;
  LinearLayout connection=new LinearLayout(a);connection.setGravity(Gravity.CENTER_VERTICAL);connection.setPadding(AgentUI.dp(a,12),0,AgentUI.dp(a,8),0);connection.setBackground(MaterialReadingUI.pressable(a,MaterialReadingUI.fill(a,0xff161918,10)));
  View dot=new View(a);dot.setBackground(MaterialReadingUI.fill(a,enabled>0?MaterialReadingUI.ACCENT_SOFT:MaterialReadingUI.DIM,4));LinearLayout.LayoutParams dp=new LinearLayout.LayoutParams(AgentUI.dp(a,7),AgentUI.dp(a,7));dp.rightMargin=AgentUI.dp(a,8);connection.addView(dot,dp);
  String connected=snapshot.contexts.isEmpty()?"尚未连接电脑":enabled>0?enabled+" 个电脑连接可用":"电脑连接都已暂停或到期";connection.addView(AgentUI.text(a,connected,13,AgentUI.MUTED),new LinearLayout.LayoutParams(0,-2,1));connection.addView(AgentUI.text(a,"查看连接",12,AgentUI.MUTED));MaterialReadingUI.glyph(a,connection,"right",AgentUI.MUTED,14);
  connection.setFocusable(true);connection.setContentDescription(connected+"，查看连接");connection.setOnClickListener(v->openConnections.run());body.addView(connection,new LinearLayout.LayoutParams(-1,AgentUI.dp(a,40)));
  if(!TaskWire.set("contexts_ready","contexts_updated","ready","received","queued","awaiting_refresh","paused","unconfigured").contains(snapshot.note)){TextView warning=AgentUI.text(a,TaskWorkspace.label(snapshot.note),13,MaterialReadingUI.AMBER);warning.setPadding(0,AgentUI.dp(a,10),0,0);body.addView(warning);}
  // Questions first: the one decision that matters now, others as single lines.
  int decisions=0;for(TaskPresentation.Question question:presentation.questions)if(!question.queuedAnswer())decisions++;
  LinearLayout heading=new LinearLayout(a);heading.setGravity(Gravity.BOTTOM);heading.setPadding(0,AgentUI.dp(a,22),0,AgentUI.dp(a,2));heading.addView(MaterialReadingUI.bold(AgentUI.text(a,decisions>0||presentation.questions.isEmpty()?"等你回复":"回复进度",17,AgentUI.INK)));
  if(decisions>0){TextView n=MaterialReadingUI.bold(AgentUI.text(a,"  "+decisions,17,MaterialReadingUI.AMBER));heading.addView(n);}body.addView(heading);
  if(presentation.questions.isEmpty()){LinearLayout empty=MaterialReadingUI.card(a,body,10);empty.setPadding(AgentUI.dp(a,16),AgentUI.dp(a,14),AgentUI.dp(a,16),AgentUI.dp(a,14));empty.addView(AgentUI.text(a,"暂无等待回复的问题",15,AgentUI.INK));AgentUI.gap(a,empty,4);empty.addView(AgentUI.text(a,snapshot.contexts.isEmpty()?"添加电脑连接后，Agent 的问题会出现在这里。":"Agent 提问时会出现在这里，也会推到眼镜上。",12,AgentUI.MUTED));}
  else{questionCard(body,presentation.questions.get(0));for(int i=1;i<presentation.questions.size();i++)questionLine(body,presentation.questions.get(i));}
  // Tasks: filter pills, then one card holding the rows.
  LinearLayout bar=new LinearLayout(a);bar.setGravity(Gravity.CENTER_VERTICAL);bar.setPadding(0,AgentUI.dp(a,24),0,AgentUI.dp(a,10));bar.addView(MaterialReadingUI.bold(AgentUI.text(a,"任务",17,AgentUI.INK)),new LinearLayout.LayoutParams(0,-2,1));
  String[] labels={"进行中 "+presentation.filter("running").size(),"已完成","全部"},keys={"running","completed","all"};
  for(int i=0;i<keys.length;i++){final String selected=keys[i];boolean on=filter.equals(selected);TextView pill=AgentUI.text(a,labels[i],13,on?0xff0f1110:AgentUI.MUTED);if(on)MaterialReadingUI.bold(pill);pill.setGravity(Gravity.CENTER);pill.setPadding(AgentUI.dp(a,12),0,AgentUI.dp(a,12),0);pill.setBackground(on?MaterialReadingUI.fill(a,AgentUI.INK,15):MaterialReadingUI.outline(a,15));pill.setContentDescription(labels[i]+(on?"，已选择":""));pill.setFocusable(true);pill.setOnClickListener(v->{filter=selected;shown=PAGE;render();});LinearLayout.LayoutParams pp=new LinearLayout.LayoutParams(-2,AgentUI.dp(a,30));pp.leftMargin=AgentUI.dp(a,6);bar.addView(pill,pp);}
  body.addView(bar);
  List<TaskPresentation.Row> rows=presentation.filter(filter);
  if(rows.isEmpty()){TextView empty=AgentUI.text(a,"completed".equals(filter)?"还没有已完成的任务":"running".equals(filter)?"没有进行中的任务":"暂无任务",14,AgentUI.MUTED);empty.setGravity(Gravity.CENTER);empty.setBackground(MaterialReadingUI.fill(a,MaterialReadingUI.CARD,16));body.addView(empty,new LinearLayout.LayoutParams(-1,AgentUI.dp(a,96)));}
  else{LinearLayout list=MaterialReadingUI.card(a,body,0);int limit=Math.min(rows.size(),shown);for(int i=0;i<limit;i++)taskRow(list,rows.get(i),i>0);
   if(rows.size()>limit){TextView more=AgentUI.text(a,"再显示 "+Math.min(PAGE,rows.size()-limit)+" 个（共 "+rows.size()+" 个）",13,AgentUI.ACCENT);more.setGravity(Gravity.CENTER);more.setFocusable(true);more.setOnClickListener(v->{shown+=PAGE;render();});body.addView(more,new LinearLayout.LayoutParams(-1,AgentUI.dp(a,44)));}}
  if("running".equals(filter)){int done=presentation.filter("completed").size();if(done>0){TextView history=AgentUI.text(a,"已完成 "+done+" 个  ›",13,AgentUI.MUTED);history.setGravity(Gravity.CENTER);history.setFocusable(true);history.setOnClickListener(v->{filter="completed";shown=PAGE;render();});body.addView(history,new LinearLayout.LayoutParams(-1,AgentUI.dp(a,44)));}}
  AgentUI.gap(a,body,10);TextView note=AgentUI.text(a,"每个回复，都会回到发起它的原任务。",12,AgentUI.MUTED);note.setGravity(Gravity.CENTER);body.addView(note);
  create.setText("＋ 交给 Agent 一件事");
  scroll.post(()->{if(alive())scroll.scrollTo(0,position);});
  if(detail!=null&&detail.dialog.isShowing()){TaskPresentation.Row row=presentation.find(detailKey);if(row!=null)renderDetails(row);}
 }
 private static final int PAGE=30;private int shown=PAGE;
 private TextView link(String text,Runnable action){TextView view=AgentUI.text(activity,text,13,AgentUI.ACCENT);view.setPadding(0,AgentUI.dp(activity,10),0,AgentUI.dp(activity,10));view.setMinHeight(AgentUI.dp(activity,44));view.setGravity(Gravity.CENTER_VERTICAL);view.setFocusable(true);view.setOnClickListener(v->action.run());return view;}
 private static String ago(long time){if(time<=0)return "";long minutes=(System.currentTimeMillis()-time)/60000;if(minutes<1)return "刚刚";if(minutes<60)return minutes+" 分钟前";java.time.ZonedDateTime at=java.time.Instant.ofEpochMilli(time).atZone(java.time.ZoneId.systemDefault());if(at.toLocalDate().equals(java.time.LocalDate.now()))return String.format(Locale.ROOT,"%02d:%02d",at.getHour(),at.getMinute());return at.getMonthValue()+"月"+at.getDayOfMonth()+"日";}
 private static long stamp(Object value){try{return TaskWire.stamp(value);}catch(RuntimeException invalid){return 0;}}
 /** The most urgent question: what is asked, by whom, and one clear way to answer. */
 private void questionCard(LinearLayout parent,TaskPresentation.Question question){Activity a=activity;long now=System.currentTimeMillis();boolean open=!question.queuedAnswer()&&question.available(now);
  LinearLayout card=MaterialReadingUI.card(a,parent,10);card.setPadding(AgentUI.dp(a,16),AgentUI.dp(a,14),AgentUI.dp(a,16),AgentUI.dp(a,8));GradientDrawable frame=MaterialReadingUI.fill(a,MaterialReadingUI.CARD,16);frame.setStroke(AgentUI.dp(a,1),open?0xff3a3220:0xff2d3331);card.setBackground(frame);
  LinearLayout meta=new LinearLayout(a);meta.setGravity(Gravity.CENTER_VERTICAL);MaterialReadingUI.chip(a,meta,question.queuedAnswer()?"已回复":open?"需要决定":"暂不可回复",open?MaterialReadingUI.AMBER:MaterialReadingUI.SOFT,open?0xff2e2614:MaterialReadingUI.RAISED);meta.addView(MaterialReadingUI.line(a,TaskPresentation.source(question.profile),12,AgentUI.MUTED,1),new LinearLayout.LayoutParams(0,-2,1));meta.addView(AgentUI.text(a,ago(stamp(question.item.get("stored_at"))),12,AgentUI.MUTED));card.addView(meta);
  TextView text=AgentUI.text(a,(String)TaskWire.body(question.item).get("question"),16,AgentUI.INK);text.setLineSpacing(AgentUI.dp(a,4),1);text.setMaxLines(4);text.setEllipsize(android.text.TextUtils.TruncateAt.END);LinearLayout.LayoutParams tp=new LinearLayout.LayoutParams(-1,-2);tp.topMargin=AgentUI.dp(a,12);card.addView(text,tp);
  TextView task=MaterialReadingUI.line(a,"来自任务："+TaskPresentation.firstLine((String)TaskWire.body(question.parent).get("command")),12,AgentUI.MUTED,1);LinearLayout.LayoutParams kp=new LinearLayout.LayoutParams(-1,-2);kp.topMargin=AgentUI.dp(a,8);card.addView(task,kp);
  if(question.queuedAnswer())card.addView(AgentUI.text(a,TaskPresentation.queueStatus(question.localAnswer),12,AgentUI.MUTED));
  else if(!question.available(now))card.addView(AgentUI.text(a,question.profile.enabled?"连接已到期，请更新连接后回复":"连接已暂停，恢复后可回复",12,AgentUI.MUTED));
  AgentUI.button(a,card,question.queuedAnswer()?"查看提交状态":open?"查看并回复":"查看问题",open,()->openQuestion(question));
  if(open)card.addView(link("在眼镜上显示这个问题",()->AgentCardRuntime.offer(a,question.binding,question.id,TaskWire.positive(question.item.get("revision")))));
 }
 private void questionLine(LinearLayout parent,TaskPresentation.Question question){Activity a=activity;LinearLayout row=new LinearLayout(a);row.setGravity(Gravity.CENTER_VERTICAL);row.setPadding(AgentUI.dp(a,14),AgentUI.dp(a,12),AgentUI.dp(a,10),AgentUI.dp(a,12));row.setBackground(MaterialReadingUI.pressable(a,MaterialReadingUI.fill(a,MaterialReadingUI.CARD,14)));
  View dot=new View(a);dot.setBackground(MaterialReadingUI.fill(a,question.queuedAnswer()?MaterialReadingUI.DIM:MaterialReadingUI.AMBER,4));LinearLayout.LayoutParams dp=new LinearLayout.LayoutParams(AgentUI.dp(a,8),AgentUI.dp(a,8));dp.rightMargin=AgentUI.dp(a,12);row.addView(dot,dp);
  LinearLayout text=AgentUI.column(a);text.addView(MaterialReadingUI.line(a,(String)TaskWire.body(question.item).get("question"),15,AgentUI.INK,1));AgentUI.gap(a,text,3);text.addView(MaterialReadingUI.line(a,TaskPresentation.source(question.profile)+" · "+ago(stamp(question.item.get("stored_at"))),12,AgentUI.MUTED,1));row.addView(text,new LinearLayout.LayoutParams(0,-2,1));MaterialReadingUI.glyph(a,row,"right",AgentUI.MUTED,14);
  row.setFocusable(true);row.setContentDescription((String)TaskWire.body(question.item).get("question"));row.setOnClickListener(v->openQuestion(question));LinearLayout.LayoutParams lp=new LinearLayout.LayoutParams(-1,-2);lp.topMargin=AgentUI.dp(a,8);parent.addView(row,lp);}
 /** One task line: status icon, title, how it is going, where it runs. Controls live in the task detail. */
 private void taskRow(LinearLayout parent,TaskPresentation.Row row,boolean rule){Activity a=activity;
  if(rule){View line=new View(a);line.setBackgroundColor(MaterialReadingUI.LINE);LinearLayout.LayoutParams lp=new LinearLayout.LayoutParams(-1,AgentUI.dp(a,1));lp.leftMargin=AgentUI.dp(a,58);parent.addView(line,lp);}
  String status=TaskPresentation.status(row);boolean waiting="waiting_answer".equals(row.state),running=TaskWire.set("running","agent_received").contains(row.state),done=row.completed(),stopping=TaskWire.set("cancel_requested","stop_requested","stop_unconfirmed","stopped","resume_requested","execution_unknown").contains(row.state);
  int tone=waiting?MaterialReadingUI.AMBER:running?MaterialReadingUI.ACCENT_SOFT:done?0xff7f8a84:AgentUI.MUTED;int toneBg=waiting?0xff2e2614:running?MaterialReadingUI.ACCENT_BG:MaterialReadingUI.RAISED;
  LinearLayout line=new LinearLayout(a);line.setPadding(AgentUI.dp(a,14),AgentUI.dp(a,14),AgentUI.dp(a,14),AgentUI.dp(a,14));line.setBackground(MaterialReadingUI.pressable(a,null));
  LinearLayout icon=new LinearLayout(a);icon.setGravity(Gravity.CENTER);icon.setBackground(MaterialReadingUI.fill(a,toneBg,16));MaterialReadingUI.glyph(a,icon,waiting?"alert":running?"arc":done?"check":stopping?"pause":"clock",tone,16);LinearLayout.LayoutParams ip=new LinearLayout.LayoutParams(AgentUI.dp(a,32),AgentUI.dp(a,32));ip.rightMargin=AgentUI.dp(a,12);line.addView(icon,ip);
  LinearLayout text=AgentUI.column(a);LinearLayout first=new LinearLayout(a);first.addView(MaterialReadingUI.bold(MaterialReadingUI.line(a,row.title(),15,AgentUI.INK,1)),new LinearLayout.LayoutParams(0,-2,1));TextView when=AgentUI.text(a,ago(row.order()),12,AgentUI.MUTED);when.setPadding(AgentUI.dp(a,8),0,0,0);first.addView(when);text.addView(first);
  LinearLayout.LayoutParams sp=new LinearLayout.LayoutParams(-1,-2);sp.topMargin=AgentUI.dp(a,5);text.addView(MaterialReadingUI.line(a,status,13,waiting?MaterialReadingUI.AMBER:done?AgentUI.MUTED:MaterialReadingUI.SOFT,2),sp);
  LinearLayout.LayoutParams op=new LinearLayout.LayoutParams(-1,-2);op.topMargin=AgentUI.dp(a,4);text.addView(MaterialReadingUI.line(a,TaskPresentation.source(row.profile),12,AgentUI.MUTED,1),op);line.addView(text,new LinearLayout.LayoutParams(0,-2,1));
  line.setFocusable(true);line.setContentDescription(row.title()+"，"+status+"，查看任务");line.setOnClickListener(v->openDetails(row));parent.addView(line);
 }
 private void delegate(){
  if(snapshot==null)return;
  AgentUI.Screen form=TaskWorkspace.delegate(activity,runtime,snapshot.defaultBinding,this::refresh);track(form);
 }
 private void openQuestion(TaskPresentation.Question question){
  if(question.queuedAnswer()||!question.available(System.currentTimeMillis())){
   AgentUI.Screen form=new AgentUI.Screen(activity,question.queuedAnswer()?"提交状态":"查看问题");track(form);full(form.body,(String)TaskWire.body(question.item).get("question"),18);
   if(question.queuedAnswer()){AgentUI.gap(activity,form.body,18);form.body.addView(AgentUI.text(activity,TaskPresentation.queueStatus(question.localAnswer),15,AgentUI.ACCENT));Map<String,Object> event=WireJson.map(WireJson.read(((String)question.localAnswer.get("payload")).getBytes(java.nio.charset.StandardCharsets.UTF_8))),answer=TaskWire.body(event);full(form.body,answerText(question.item,answer),16);if(!"".equals(question.localAnswer.get("error")))form.body.addView(AgentUI.text(activity,TaskWorkspace.label((String)question.localAnswer.get("error")),13,AgentUI.MUTED));}
   else{AgentUI.gap(activity,form.body,16);form.body.addView(AgentUI.text(activity,"恢复原连接后才能回复。问题不会转交其他 Agent。",14,AgentUI.MUTED));AgentUI.button(activity,form.body,"查看连接",true,()->{form.dialog.dismiss();openConnections.run();});}return;
  }
  if(openingQuestion)return;openingQuestion=true;
  runtime.detail(question.binding,"request",question.id,(updated,error)->{
   openingQuestion=false;
   if(!alive()||!runtime.active(activity))return;if(!error.isEmpty()){AgentUI.notice(activity,TaskWorkspace.label(error));return;}
   TaskHub.View source=updated.context(question.binding);Map<String,Object> fresh=source==null?null:source.item("request",question.id);
   if(fresh==null){AgentUI.notice(activity,"原问题暂不可用，请刷新后重试。");return;}
   track(TaskWorkspace.answer(activity,runtime,source,fresh,this::refresh));
  });
 }
 private void openDetails(TaskPresentation.Row row){
  if(detail!=null&&detail.dialog.isShowing())detail.dialog.dismiss();detailKey=row.key;showHistory=false;detail=new AgentUI.Screen(activity,"任务详情");AgentUI.Screen current=detail;current.dialog.setOnDismissListener(d->{if(detail==current){detail=null;detailKey="";}});renderDetails(row);
  if(!row.localOnly()&&row.profile.enabled&&row.profile.connection.expiresAt>System.currentTimeMillis())runtime.detail(row.binding,"task",row.id,(updated,error)->{if(alive()&&detail==current&&current.dialog.isShowing()&&!error.isEmpty())AgentUI.notice(activity,TaskWorkspace.label(error));});
 }
 private void renderDetails(TaskPresentation.Row row){
  if(detail==null)return;int position=detail.scroll.getScrollY();LinearLayout content=detail.body;content.removeAllViews();
  content.addView(AgentUI.text(activity,TaskPresentation.source(row.profile),13,AgentUI.MUTED));content.addView(AgentUI.text(activity,"工作区 · "+row.profile.connection.project,13,AgentUI.MUTED));AgentUI.gap(activity,content,14);full(content,row.command(),20);
  LinearLayout status=AgentUI.card(activity,content);status.addView(AgentUI.text(activity,TaskPresentation.status(row),16,AgentUI.ACCENT));
  if(!row.profile.enabled||row.profile.connection.expiresAt<=System.currentTimeMillis())status.addView(AgentUI.text(activity,row.profile.enabled?"连接已到期，以上为最近收到的任务状态。":"连接已暂停，以上为最近收到的任务状态。暂停连接不会停止电脑任务。",13,AgentUI.MUTED));
  if(row.local!=null){status.addView(AgentUI.text(activity,TaskPresentation.queueStatus(row.local),13,AgentUI.MUTED));if(!"".equals(row.local.get("error")))status.addView(AgentUI.text(activity,TaskWorkspace.label((String)row.local.get("error")),13,AgentUI.MUTED));}
  for(TaskPresentation.Question question:presentation.questions)if(question.binding.equals(row.binding)&&question.taskId.equals(row.id))questionCard(content,question);
  controls(content,row);
  String draft=instructions().getString(instructionKey(row),"");if(!draft.isEmpty()){LinearLayout saved=AgentUI.card(activity,content);saved.addView(AgentUI.text(activity,"本机指示草稿 · 未发送",14,AgentUI.ACCENT));full(saved,draft,15);}
  TaskHub.View context=snapshot.context(row.binding);List<Map<String,Object>> messages=new ArrayList<>(),previousQuestions=new ArrayList<>();if(context!=null)for(Object raw:context.objects){Map<String,Object> item=WireJson.map(WireJson.map(raw).get("item"));if(!row.id.equals(TaskWire.body(item).get("task_id")))continue;if("message".equals(item.get("kind")))messages.add(item);else if("request".equals(item.get("kind"))&&!TaskWire.canAnswer(item,row.item,System.currentTimeMillis()))previousQuestions.add(item);}
  if(!previousQuestions.isEmpty()){AgentUI.gap(activity,content,18);content.addView(AgentUI.text(activity,"往来问题",16,AgentUI.INK));for(Map<String,Object> request:previousQuestions){LinearLayout card=AgentUI.card(activity,content);card.addView(AgentUI.text(activity,TaskPresentation.questionStatus(request,row.item,System.currentTimeMillis()),12,AgentUI.MUTED));full(card,(String)TaskWire.body(request).get("question"),15);if(request.get("answer")!=null){AgentUI.gap(activity,card,12);card.addView(AgentUI.text(activity,"你的完整回复",12,AgentUI.ACCENT));Map<String,Object> answer=WireJson.map(request.get("answer"));full(card,answerText(request,TaskWire.body(answer)),15);receiptLines(card,answer);}receiptLines(card,request);}}
  if(context!=null)for(Object raw:context.pending){Map<String,Object> local=WireJson.map(raw),event=WireJson.map(WireJson.read(((String)local.get("payload")).getBytes(java.nio.charset.StandardCharsets.UTF_8)));if(!"answer".equals(event.get("kind")))continue;Map<String,Object> answer=TaskWire.body(event);if(!row.id.equals(answer.get("task_id")))continue;Map<String,Object> request=context.item("request",(String)answer.get("request_id"));if("server_stored".equals(local.get("state"))&&request!=null&&request.get("answer")!=null)continue;LinearLayout card=AgentUI.card(activity,content);card.addView(AgentUI.text(activity,"本机完整回复 · "+TaskPresentation.queueStatus(local),13,AgentUI.MUTED));full(card,request==null?(String)answer.get("text"):answerText(request,answer),15);if(!"".equals(local.get("error")))card.addView(AgentUI.text(activity,TaskWorkspace.label((String)local.get("error")),13,AgentUI.MUTED));}
  if(!messages.isEmpty()){AgentUI.gap(activity,content,18);content.addView(AgentUI.text(activity,"电脑进展",16,AgentUI.INK));int first=showHistory?0:Math.max(0,messages.size()-1);for(int i=first;i<messages.size();i++){Map<String,Object> message=TaskWire.body(messages.get(i));LinearLayout card=AgentUI.card(activity,content);card.addView(AgentUI.text(activity,"result".equals(message.get("channel"))?"任务结果":"电脑消息",12,AgentUI.MUTED));full(card,(String)message.get("text"),15);}if(messages.size()>1&&!showHistory)content.addView(link("查看此前 "+(messages.size()-1)+" 条消息",()->{showHistory=true;renderDetails(row);}));}
  if(row.item!=null&&row.item.get("receipts")!=null&&!WireJson.list(row.item.get("receipts")).isEmpty()){AgentUI.gap(activity,content,20);content.addView(AgentUI.text(activity,"送达回执",15,AgentUI.INK));receiptLines(content,row.item);}
  AgentUI.gap(activity,content,18);content.addView(AgentUI.text(activity,"状态与回执来自原电脑任务。保存到服务器不代表电脑已继续执行。",12,AgentUI.MUTED));
  AgentUI.Screen current=detail;current.scroll.post(()->{if(alive()&&detail==current)current.scroll.scrollTo(0,position);});
 }
 private void full(LinearLayout parent,String text,int size){TextView view=AgentUI.text(activity,text,size,AgentUI.INK);view.setTextIsSelectable(true);parent.addView(view);}
 private void track(AgentUI.Screen form){forms.removeIf(prior->!prior.dialog.isShowing());forms.add(form);}
 private void receiptLines(LinearLayout parent,Map<String,Object> item){if(item.get("receipts")==null)return;for(Object raw:WireJson.list(item.get("receipts"))){Map<String,Object> receipt=WireJson.map(raw);parent.addView(AgentUI.text(activity,"• "+TaskPresentation.receipt((String)receipt.get("stage")),13,AgentUI.MUTED));}}
 private SharedPreferences instructions(){return activity.getSharedPreferences("io_agent_task_instruction_drafts_v1",Context.MODE_PRIVATE);}
 private static String instructionKey(TaskPresentation.Row row){return TaskWire.hash(row.key.getBytes(java.nio.charset.StandardCharsets.UTF_8));}
 private void controls(LinearLayout parent,TaskPresentation.Row row){
  if(row.control!=null){parent.addView(AgentUI.text(activity,TaskPresentation.controlStatus(row.control),12,AgentUI.MUTED));if(!"".equals(row.control.get("error")))parent.addView(AgentUI.text(activity,TaskWorkspace.label((String)row.control.get("error")),12,AgentUI.MUTED));}
  String kind=TaskControl.eligible(row.item,"stop")?"stop":TaskControl.eligible(row.item,"resume")?"resume":"";
  if(kind.isEmpty()){
   if(TaskWire.set("stop_requested","stop_unconfirmed","resume_requested").contains(row.state))parent.addView(AgentUI.text(activity,row.state.equals("resume_requested")?"已保存继续指示，等待原电脑开始下一轮。":"等待原电脑确认，确认停止后才可追加指示继续。",12,AgentUI.MUTED));
   else if(TaskWire.set("running","waiting_answer").contains(row.state)&&!row.body.containsKey("execution")){TextView unavailable=AgentUI.button(activity,parent,"打断任务",false,()->{});unavailable.setEnabled(false);unavailable.setAlpha(.45f);parent.addView(AgentUI.text(activity,"此任务尚未提供原会话执行信息，暂不能在手机打断。",12,AgentUI.MUTED));}
   return;
  }
  TaskHub.View source=snapshot==null?null:snapshot.context(row.binding);
  if(source!=null&&TaskControl.pending(source.pending,row.item,kind)!=null)return;
  TextView button=AgentUI.button(activity,parent,kind.equals("stop")?"打断任务":"追加指示并继续",false,()->{
   if(kind.equals("stop"))submitControl(row,"stop","",null,null);else instruction(row);
  });
  boolean available=source!=null&&source.sessionControl&&row.profile.enabled&&row.profile.connection.expiresAt>System.currentTimeMillis()&&!submittingControls.contains(row.key+"/"+kind);
  button.setEnabled(available);button.setAlpha(available?1f:.45f);
  if(!available)parent.addView(AgentUI.text(activity,source!=null&&!source.sessionControl?"当前连接尚未确认支持此功能，刷新后再试。":!row.profile.enabled?"恢复原连接后可操作。":"原连接暂不可用，请查看连接。",12,AgentUI.MUTED));
 }
 private void instruction(TaskPresentation.Row row){
  if(!TaskControl.eligible(row.item,"resume"))return;
  AgentUI.Screen form=new AgentUI.Screen(activity,"追加指示并继续");track(form);form.body.addView(AgentUI.text(activity,row.title(),18,AgentUI.INK));AgentUI.gap(activity,form.body,12);
  form.body.addView(AgentUI.text(activity,"原任务已停止。指示将回到 "+TaskPresentation.source(row.profile)+" 的原会话，沿用当前任务。",15,AgentUI.MUTED));AgentUI.gap(activity,form.body,14);
  form.body.addView(AgentUI.text(activity,"继续会恢复原会话的执行，也会处理该会话已有的排队指令。具体顺序由原 Agent 管理。",13,AgentUI.MUTED));AgentUI.gap(activity,form.body,14);
  EditText edit=AgentUI.input(activity);edit.setTextColor(AgentUI.INK);edit.setHintTextColor(AgentUI.MUTED);edit.setHint("写下调整要求，例如：先整理结论，再补充依据");edit.setInputType(InputType.TYPE_CLASS_TEXT|InputType.TYPE_TEXT_FLAG_MULTI_LINE);edit.setMinLines(4);edit.setFilters(new InputFilter[]{new InputFilter.LengthFilter(32768)});edit.setText(instructions().getString(instructionKey(row),""));form.body.addView(edit,new LinearLayout.LayoutParams(-1,-2));
  boolean[] sent={false};edit.addTextChangedListener(new android.text.TextWatcher(){public void beforeTextChanged(CharSequence s,int start,int count,int after){}public void onTextChanged(CharSequence s,int start,int before,int count){}public void afterTextChanged(android.text.Editable text){if(!sent[0])instructions().edit().putString(instructionKey(row),text.toString()).apply();}});
  AgentUI.gap(activity,form.body,14);form.body.addView(AgentUI.text(activity,"草稿自动保存在本机。提交后若断网，会核对原任务再发送；不会转交其他会话。",13,AgentUI.MUTED));
  TextView[] submit={null};submit[0]=AgentUI.button(activity,form.body,"按此继续",true,()->{
   edit.setEnabled(false);submit[0].setEnabled(false);
   submitControl(row,"resume",edit.getText().toString(),()->{sent[0]=true;instructions().edit().remove(instructionKey(row)).commit();form.dialog.dismiss();},()->{edit.setEnabled(true);submit[0].setEnabled(true);});
  });
  form.dialog.setOnDismissListener(d->{if(!sent[0])instructions().edit().putString(instructionKey(row),edit.getText().toString()).apply();if(alive())render();});
 }
 private void submitControl(TaskPresentation.Row row,String kind,String text,Runnable saved,Runnable failed){
  String flight=row.key+"/"+kind;if(!submittingControls.add(flight)){if(failed!=null)failed.run();return;}
  try{
   TaskHub.View source=snapshot.context(row.binding);TaskWire.require(source!=null&&source.sessionControl,"TASK_CONTROL_UNSUPPORTED");
   TaskWire.require(source.profile.enabled,"TASK_PAUSED");
   Map<String,Object> expected=TaskWire.execution(row.body.get("execution")),current=source.item("task",row.id);
   TaskWire.require(TaskControl.eligible(current,kind)&&TaskWire.same(expected,TaskWire.body(current).get("execution")),"TASK_CONTROL_STALE");
   TaskWire.require(TaskControl.pending(source.pending,current,kind)==null,"TASK_CONTROL_ALREADY_SAVED");
   String key="control/"+TaskWire.hash((row.key+"/"+kind+"/"+expected.get("command_id")+"/"+expected.get("turn_id")).getBytes(java.nio.charset.StandardCharsets.UTF_8));
   long now=System.currentTimeMillis(),expires=now+(kind.equals("stop")?60000:600000);String operation=UUID.randomUUID().toString();
   String previous=instructions().getString(key,"");
   if(!previous.isEmpty()){
    Map<String,Object> draft=WireJson.map(WireJson.read(previous.getBytes(java.nio.charset.StandardCharsets.UTF_8)));boolean recorded=false;
    for(Object raw:source.pending)if(draft.get("operation").equals(WireJson.map(raw).get("operation_id")))recorded=true;
    // A previous callback may have been lost. Reuse its operation if it has not yet
    // appeared in the durable mailbox; once recorded, pending() above owns its fate.
    if(!recorded&&text.equals(draft.get("text"))&&TaskWire.stamp(draft.get("expires_at"))>now){operation=TaskWire.uuid(draft.get("operation"));expires=TaskWire.stamp(draft.get("expires_at"));}
   }
   TaskControl.update(current,expected,operation,kind,text,now,expires);
   Map<String,Object> draft=WireJson.object("operation",operation,"text",text,"expires_at",TaskWire.now(expires));
   TaskWire.require(instructions().edit().putString(key,new String(WireJson.bytes(draft),java.nio.charset.StandardCharsets.UTF_8)).commit(),"TASK_CONFIG_SAVE_FAILED");
   runtime.taskControl(row.binding,operation,row.id,expected,kind,text,expires,(updated,error)->{
    submittingControls.remove(flight);if(!alive())return;snapshot=updated;
    if(error.isEmpty()){if(saved!=null)saved.run();AgentUI.notice(activity,kind.equals("stop")?"打断请求已保存在本机，等待电脑确认停止。":"继续指示已保存在本机，等待原电脑接收。");}
    else{if(failed!=null)failed.run();AgentUI.notice(activity,TaskWorkspace.label(error));}render();
   });
  }catch(Exception invalid){submittingControls.remove(flight);if(failed!=null)failed.run();AgentUI.notice(activity,TaskWorkspace.label(TaskApi.safeError(invalid)));}
 }
 private static String answerText(Map<String,Object> request,Map<String,Object> answer){StringBuilder text=new StringBuilder();if(answer.get("option_id")!=null)for(Object raw:WireJson.list(TaskWire.body(request).get("options"))){Map<String,Object> option=WireJson.map(raw);if(answer.get("option_id").equals(option.get("option_id")))text.append(option.get("label")).append("\n");}text.append((String)answer.get("text"));return text.toString();}
}
