package com.turboio.addon;

import android.app.Activity;
import android.content.Context;
import android.content.SharedPreferences;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.SystemClock;
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
  Object choices=TaskWire.body(question.item).get("options");
  if(open&&choices instanceof List&&!((List<?>)choices).isEmpty()){
   // Same numbering as the glasses prompter, so "选二" there means the second line here.
   List<?> options=(List<?>)choices;for(int i=0;i<options.size();i++){Map<String,Object> option=WireJson.map(options.get(i));LinearLayout line=new LinearLayout(a);line.setGravity(Gravity.CENTER_VERTICAL);
    TextView number=MaterialReadingUI.bold(AgentUI.text(a,String.valueOf(i+1),13,AgentUI.INK));number.setGravity(Gravity.CENTER);number.setBackground(MaterialReadingUI.fill(a,MaterialReadingUI.RAISED,6));line.addView(number,new LinearLayout.LayoutParams(AgentUI.dp(a,22),AgentUI.dp(a,22)));
    TextView label=MaterialReadingUI.line(a,String.valueOf(option.get("label")),14,MaterialReadingUI.SOFT,2);label.setPadding(AgentUI.dp(a,10),0,0,0);line.addView(label,new LinearLayout.LayoutParams(0,-2,1));
    LinearLayout.LayoutParams lp=new LinearLayout.LayoutParams(-1,-2);lp.topMargin=AgentUI.dp(a,i==0?12:8);card.addView(line,lp);}
   TextView hint=AgentUI.text(a,"编号与眼镜一致，口述时说「选二」，可以补充条件",11,AgentUI.MUTED);hint.setPadding(0,AgentUI.dp(a,8),0,0);card.addView(hint);
  }
  steps(card,new String[]{"眼镜显示","你回答","电脑收到","任务继续"},replyStage(question),MaterialReadingUI.ACCENT_SOFT);
  if(question.queuedAnswer())card.addView(AgentUI.text(a,TaskPresentation.queueStatus(question.localAnswer),12,AgentUI.MUTED));
  else if(!question.available(now))card.addView(AgentUI.text(a,question.profile.enabled?"连接已到期，请更新连接后回复":"连接已暂停，恢复后可回复",12,AgentUI.MUTED));
  AgentUI.button(a,card,question.queuedAnswer()?"查看提交状态":open?"查看并回复":"查看问题",open,()->openQuestion(question));
  if(open)card.addView(link("在眼镜上显示这个问题",()->AgentCardRuntime.offer(a,question.binding,question.id,TaskWire.positive(question.item.get("revision")))));
 }
 /** How far a reply has travelled, from the receipts on the question and its answer. */
 private static int replyStage(TaskPresentation.Question question){
  Set<String> seen=new HashSet<>();receipts(seen,question.item);Object answer=question.item.get("answer");if(answer!=null)receipts(seen,WireJson.map(answer));
  if(answer!=null&&seen.contains("task_resumed"))return 4;if(answer!=null&&seen.contains("agent_received"))return 3;
  if(answer!=null||question.queuedAnswer()||seen.contains("user_answered"))return 2;return seen.contains("glasses_displayed")?1:0;
 }
 private static void receipts(Set<String> seen,Map<String,Object> item){if(item.get("receipts")==null)return;for(Object raw:WireJson.list(item.get("receipts")))seen.add(String.valueOf(WireJson.map(raw).get("stage")));}
 /** A short progress strip: one bar and label per step, the first `done` lit. */
 private void steps(LinearLayout parent,String[] labels,int done,int tone){Activity a=activity;LinearLayout strip=new LinearLayout(a);
  for(int i=0;i<labels.length;i++){LinearLayout cell=AgentUI.column(a);View bar=new View(a);bar.setBackground(MaterialReadingUI.fill(a,i<done?tone:0xff3a423f,2));cell.addView(bar,new LinearLayout.LayoutParams(-1,AgentUI.dp(a,4)));
   TextView label=MaterialReadingUI.line(a,labels[i],11,i<done?MaterialReadingUI.SOFT:AgentUI.MUTED,1);label.setPadding(0,AgentUI.dp(a,6),0,0);cell.addView(label);
   LinearLayout.LayoutParams p=new LinearLayout.LayoutParams(0,-2,1);if(i>0)p.leftMargin=AgentUI.dp(a,6);strip.addView(cell,p);}
  StringBuilder said=new StringBuilder();for(int i=0;i<labels.length;i++)said.append(labels[i]).append(i<done?"，已完成；":"，未完成；");strip.setContentDescription(said);
  LinearLayout.LayoutParams sp=new LinearLayout.LayoutParams(-1,-2);sp.topMargin=AgentUI.dp(a,14);parent.addView(strip,sp);
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
  if(detail!=null&&detail.dialog.isShowing())detail.dialog.dismiss();detailKey=row.key;showHistory=false;timelineFilter="all";openEntries.clear();detail=new AgentUI.Screen(activity,"任务详情");AgentUI.Screen current=detail;current.dialog.setOnDismissListener(d->{if(detail==current){detail=null;detailKey="";}});renderDetails(row);
  if(!row.localOnly()&&row.profile.enabled&&row.profile.connection.expiresAt>System.currentTimeMillis())runtime.detail(row.binding,"task",row.id,(updated,error)->{if(alive()&&detail==current&&current.dialog.isShowing()&&!error.isEmpty())AgentUI.notice(activity,TaskWorkspace.label(error));});
 }
 private void renderDetails(TaskPresentation.Row row){
  if(detail==null)return;int position=detail.scroll.getScrollY();LinearLayout content=detail.body;content.removeAllViews();
  content.addView(AgentUI.text(activity,TaskPresentation.source(row.profile),13,AgentUI.MUTED));content.addView(AgentUI.text(activity,"工作区 · "+row.profile.connection.project,13,AgentUI.MUTED));AgentUI.gap(activity,content,14);full(content,row.command(),20);
  int stopStep=TaskWire.set("stop_requested","stop_unconfirmed").contains(row.state)?1:"stopped".equals(row.state)?2:"resume_requested".equals(row.state)?3:0;
  LinearLayout status=AgentUI.card(activity,content);status.addView(AgentUI.text(activity,TaskPresentation.status(row),16,stopStep>0?MaterialReadingUI.CORAL_TEXT:AgentUI.ACCENT));
  if(stopStep>0)steps(status,new String[]{"已打断","电脑确认停止","追加指示","继续执行"},stopStep,MaterialReadingUI.ACCENT_SOFT);
  if(!row.profile.enabled||row.profile.connection.expiresAt<=System.currentTimeMillis())status.addView(AgentUI.text(activity,row.profile.enabled?"连接已到期，以上为最近收到的任务状态。":"连接已暂停，以上为最近收到的任务状态。暂停连接不会停止电脑任务。",13,AgentUI.MUTED));
  if(row.local!=null){status.addView(AgentUI.text(activity,TaskPresentation.queueStatus(row.local),13,AgentUI.MUTED));if(!"".equals(row.local.get("error")))status.addView(AgentUI.text(activity,TaskWorkspace.label((String)row.local.get("error")),13,AgentUI.MUTED));}
  for(TaskPresentation.Question question:presentation.questions)if(question.binding.equals(row.binding)&&question.taskId.equals(row.id))questionCard(content,question);
  controls(content,row);
  String draft=instructions().getString(instructionKey(row),"");if(!draft.isEmpty()){LinearLayout saved=AgentUI.card(activity,content);saved.addView(AgentUI.text(activity,"本机指示草稿 · 未发送",14,AgentUI.ACCENT));full(saved,draft,15);}
  timeline(content,row);
  if(row.item!=null&&row.item.get("receipts")!=null&&!WireJson.list(row.item.get("receipts")).isEmpty())new MaterialReadingUI.Fold(activity,content,"送达回执",WireJson.list(row.item.get("receipts")).size()+" 条",false,box->receiptLines(box,row.item));
  AgentUI.gap(activity,content,18);content.addView(AgentUI.text(activity,"状态与回执来自原电脑任务。保存到服务器不代表电脑已继续执行。",12,AgentUI.MUTED));
  AgentUI.Screen current=detail;current.scroll.post(()->{if(alive()&&detail==current)current.scroll.scrollTo(0,position);});
 }
 /** One timeline card. "qa" covers questions and replies; the other kinds are computer-side updates. */
 private static final class Entry {
  final String key,kind,label,summary,sub;final long at;final java.util.function.Consumer<LinearLayout> full;
  Entry(String key,String kind,String label,String summary,String sub,long at,java.util.function.Consumer<LinearLayout> full){this.key=key;this.kind=kind;this.label=label;this.summary=summary;this.sub=sub;this.at=at;this.full=full;}
  boolean qa(){return kind.equals("qa")||kind.equals("local");}
 }
 private static final int QA_BLUE=0xff6fa8ff;
 private final Map<String,Boolean> openEntries=new HashMap<>();private String timelineFilter="all";
 private static long storedAt(Object item){try{return item instanceof Map&&((Map<?,?>)item).get("stored_at")!=null?TaskWire.stamp(((Map<?,?>)item).get("stored_at")):0;}catch(RuntimeException bad){return 0;}}
 private static final java.util.regex.Pattern POINT=java.util.regex.Pattern.compile("^已完成：(.*?)(?:[；;\\s]*下一步：(.*))?$",java.util.regex.Pattern.DOTALL);
 /** Task history newest first: color-coded by kind, only the newest open, the rest one-line summaries. */
 private void timeline(LinearLayout content,TaskPresentation.Row row){
  TaskHub.View context=snapshot.context(row.binding);if(context==null)return;long now=System.currentTimeMillis();List<Entry> entries=new ArrayList<>();
  for(Object raw:context.objects){
   Map<String,Object> item=WireJson.map(WireJson.map(raw).get("item")),body=TaskWire.body(item);if(!row.id.equals(body.get("task_id")))continue;
   if("message".equals(item.get("kind"))){
    String text=String.valueOf(body.get("text")).trim();java.util.regex.Matcher m=POINT.matcher(text);boolean result="result".equals(body.get("channel")),point=!result&&m.matches(),late=text.startsWith("已超过约定报到时间");
    String done=point?m.group(1).trim():text,next=point&&m.group(2)!=null?m.group(2).trim():"";
    entries.add(new Entry("m/"+item.get("object_id"),result?"result":point?"progress":"alert",result?"任务结果":point?"进度":late?"超时提醒":"提醒",done,next.isEmpty()?"":"下一步："+next,storedAt(item),box->{
     if(!point){full(box,text,15);return;}
     box.addView(AgentUI.text(activity,"已完成",12,AgentUI.MUTED));full(box,done,15);
     if(!next.isEmpty()){AgentUI.gap(activity,box,10);box.addView(AgentUI.text(activity,"下一步",12,AgentUI.MUTED));full(box,next,15);}
    }));
   }else if("request".equals(item.get("kind"))&&!TaskWire.canAnswer(item,row.item,now)){
    Map<String,Object> answer=item.get("answer")==null?null:WireJson.map(item.get("answer"));String reply=answer==null?"":AgentCardRuntime.oneLine(answerText(item,TaskWire.body(answer)));
    entries.add(new Entry("q/"+item.get("object_id"),"qa","问答 · "+TaskPresentation.questionStatus(item,row.item,now),String.valueOf(body.get("question")),answer==null?"":"你答："+reply,Math.max(storedAt(item),storedAt(answer)),box->{
     full(box,(String)body.get("question"),15);
     if(answer!=null){AgentUI.gap(activity,box,12);box.addView(AgentUI.text(activity,"你的完整回复",12,QA_BLUE));full(box,reply,15);receiptLines(box,answer);}
     receiptLines(box,item);
    }));
   }
  }
  for(Object raw:context.pending){
   Map<String,Object> local=WireJson.map(raw),event=WireJson.map(WireJson.read(((String)local.get("payload")).getBytes(java.nio.charset.StandardCharsets.UTF_8)));if(!"answer".equals(event.get("kind")))continue;
   Map<String,Object> answer=TaskWire.body(event);if(!row.id.equals(answer.get("task_id")))continue;Map<String,Object> request=context.item("request",(String)answer.get("request_id"));
   if("server_stored".equals(local.get("state"))&&request!=null&&request.get("answer")!=null)continue;
   String text=request==null?(String)answer.get("text"):answerText(request,answer);
   entries.add(new Entry("l/"+local.get("operation_id"),"local","本机回复 · "+TaskPresentation.queueStatus(local),text,request==null?"":"回复：「"+TaskWire.body(request).get("question")+"」",now,box->{
    full(box,text,15);if(!"".equals(local.get("error")))box.addView(AgentUI.text(activity,TaskWorkspace.label((String)local.get("error")),13,AgentUI.MUTED));
   }));
  }
  if(entries.isEmpty())return;
  entries.sort((x,y)->Long.compare(y.at,x.at));
  int qa=0;for(Entry e:entries)if(e.qa())qa++;
  AgentUI.gap(activity,content,22);LinearLayout head=new LinearLayout(activity);head.setGravity(Gravity.CENTER_VERTICAL);
  head.addView(MaterialReadingUI.bold(AgentUI.text(activity,"动态",17,AgentUI.INK)),new LinearLayout.LayoutParams(0,-2,1));
  String[][] filters={{"all","全部 "+entries.size()},{"qa","问答 "+qa},{"work","进展 "+(entries.size()-qa)}};
  for(String[] f:filters){boolean on=f[0].equals(timelineFilter);TextView chip=MaterialReadingUI.chip(activity,head,f[1],on?MaterialReadingUI.ACCENT_SOFT:AgentUI.MUTED,on?MaterialReadingUI.ACCENT_BG:MaterialReadingUI.RAISED);
   chip.setOnClickListener(v->{timelineFilter=f[0];showHistory=false;renderDetails(row);});}
  content.addView(head);
  List<Entry> visible=new ArrayList<>();for(Entry e:entries)if(timelineFilter.equals("all")||timelineFilter.equals("qa")==e.qa())visible.add(e);
  if(visible.isEmpty()){content.addView(AgentUI.text(activity,"这一类暂时没有记录。",13,AgentUI.MUTED));return;}
  int limit=showHistory?visible.size():Math.min(visible.size(),6);
  for(int i=0;i<limit;i++)entryCard(content,visible.get(i),openEntries.getOrDefault(visible.get(i).key,i==0),row);
  if(visible.size()>limit)content.addView(link("查看更早 "+(visible.size()-limit)+" 条",()->{showHistory=true;renderDetails(row);}));
 }
 private int tone(String kind){switch(kind){case "qa":return QA_BLUE;case "alert":return MaterialReadingUI.AMBER;case "local":return MaterialReadingUI.SOFT;default:return MaterialReadingUI.ACCENT_SOFT;}}
 private void entryCard(LinearLayout parent,Entry e,boolean open,TaskPresentation.Row row){
  Activity a=activity;int color=tone(e.kind);
  LinearLayout outer=new LinearLayout(a);outer.setBackground(AgentUI.shape(a,e.kind.equals("result")?MaterialReadingUI.ACCENT_BG:AgentUI.SURFACE,16));
  LinearLayout.LayoutParams lp=new LinearLayout.LayoutParams(-1,-2);lp.topMargin=AgentUI.dp(a,10);parent.addView(outer,lp);
  View stripe=new View(a);GradientDrawable bar=new GradientDrawable();bar.setColor(color);bar.setCornerRadius(AgentUI.dp(a,2));stripe.setBackground(bar);
  LinearLayout.LayoutParams sp=new LinearLayout.LayoutParams(AgentUI.dp(a,3),-1);sp.setMargins(AgentUI.dp(a,12),AgentUI.dp(a,14),0,AgentUI.dp(a,14));outer.addView(stripe,sp);
  LinearLayout col=AgentUI.column(a);col.setPadding(AgentUI.dp(a,12),AgentUI.dp(a,12),AgentUI.dp(a,14),AgentUI.dp(a,14));outer.addView(col,new LinearLayout.LayoutParams(0,-2,1));
  LinearLayout head=new LinearLayout(a);head.setGravity(Gravity.CENTER_VERTICAL);head.setMinimumHeight(AgentUI.dp(a,26));
  TextView label=MaterialReadingUI.bold(AgentUI.text(a,e.label,12,color));head.addView(label);
  TextView time=AgentUI.text(a,e.at>0&&!e.kind.equals("local")?"  ·  "+ago(e.at):"",12,AgentUI.MUTED);head.addView(time,new LinearLayout.LayoutParams(0,-2,1));
  head.addView(AgentUI.text(a,open?"收起":"展开",12,AgentUI.MUTED));col.addView(head);AgentUI.gap(a,col,6);
  Runnable toggle=()->{openEntries.put(e.key,!open);renderDetails(row);};
  head.setOnClickListener(v->toggle.run());head.setContentDescription(e.label+(open?"，已展开":"，已收起"));
  if(open){e.full.accept(col);return;}
  TextView summary=AgentUI.text(a,e.summary,15,AgentUI.INK);summary.setMaxLines(2);summary.setEllipsize(android.text.TextUtils.TruncateAt.END);col.addView(summary);
  if(!e.sub.isEmpty()){AgentUI.gap(a,col,6);TextView sub=AgentUI.text(a,e.sub,13,e.qa()?QA_BLUE:AgentUI.MUTED);sub.setMaxLines(1);sub.setEllipsize(android.text.TextUtils.TruncateAt.END);col.addView(sub);}
  outer.setOnClickListener(v->toggle.run());
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
   else if(TaskWire.set("running","waiting_answer").contains(row.state)&&!row.body.containsKey("execution")){TextView unavailable=AgentUI.button(activity,parent,"打断任务",false,()->{});stopStyle(unavailable,row);unavailable.setEnabled(false);unavailable.setAlpha(.45f);parent.addView(AgentUI.text(activity,"此任务尚未提供原会话执行信息，暂不能在手机打断。",12,AgentUI.MUTED));}
   return;
  }
  TaskHub.View source=snapshot==null?null:snapshot.context(row.binding);
  if(source!=null&&(TaskControl.pending(source.pending,row.item,kind)!=null||kind.equals("resume")&&TaskControl.pending(source.pending,row.item,"end")!=null))return;
  boolean stop=kind.equals("stop");TextView[] ref={null};
  // Stopping needs two taps within STOP_CONFIRM_MS: the first only arms the red button.
  TextView button=ref[0]=AgentUI.button(activity,parent,stop?"打断任务":"追加指示并继续",!stop,()->{
   if(!stop){instruction(row);return;}
   if(armed(row)){armedStop="";stopStyle(ref[0],row);submitControl(row,"stop","",null,null);return;}
   armedStop=row.key;armedAt=SystemClock.uptimeMillis();stopStyle(ref[0],row);
  });
  if(stop){stopStyle(button,row);TextView hint=AgentUI.text(activity,"连点两下打断 · 电脑停在当前一步，之后可追加指示再继续",12,AgentUI.MUTED);hint.setGravity(Gravity.CENTER);hint.setPadding(0,AgentUI.dp(activity,8),0,0);parent.addView(hint);}
  boolean available=source!=null&&source.sessionControl&&row.profile.enabled&&row.profile.connection.expiresAt>System.currentTimeMillis()&&!submittingControls.contains(row.key+"/"+kind);
  button.setEnabled(available);button.setAlpha(available?1f:.45f);
  // A proven stop can also be closed for good; ending needs no computer confirmation.
  if(!stop&&available)AgentUI.button(activity,parent,"结束任务",false,()->AgentUI.confirm(activity,"结束这个任务？","电脑已停在当前一步。结束后不能再追加指示继续，任务记录会保留。","结束任务",()->submitControl(row,"end","",null,null)));
  if(!available)parent.addView(AgentUI.text(activity,source!=null&&!source.sessionControl?"当前连接尚未确认支持此功能，刷新后再试。":!row.profile.enabled?"恢复原连接后可操作。":"原连接暂不可用，请查看连接。",12,AgentUI.MUTED));
 }
 private static final long STOP_CONFIRM_MS=3000;private String armedStop="";private long armedAt;
 private boolean armed(TaskPresentation.Row row){return armedStop.equals(row.key)&&SystemClock.uptimeMillis()-armedAt<STOP_CONFIRM_MS;}
 /** Red outline at rest; once armed, solid red asking for the second tap, falling back after STOP_CONFIRM_MS. */
 private void stopStyle(TextView button,TaskPresentation.Row row){Activity a=activity;boolean on=armed(row);
  GradientDrawable shape=MaterialReadingUI.fill(a,on?MaterialReadingUI.CORAL:0,13);if(!on)shape.setStroke(Math.round(a.getResources().getDisplayMetrics().density*1.5f),MaterialReadingUI.CORAL);
  button.setBackground(shape);button.setTextColor(on?MaterialReadingUI.ON_CORAL:MaterialReadingUI.CORAL_TEXT);button.setText(on?"再点一次，确认打断":"打断任务");
  button.setContentDescription(on?"再点一次，确认打断任务":"打断任务，需要连点两下");
  if(on)button.postDelayed(()->{if(!armed(row))stopStyle(button,row);},STOP_CONFIRM_MS-(SystemClock.uptimeMillis()-armedAt)+20);
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
   if(edit.getText().toString().trim().isEmpty()){AgentUI.notice(activity,"先写下要追加的指示，再继续。");return;}
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
    if(error.isEmpty()){if(saved!=null)saved.run();AgentUI.toast(activity,kind.equals("stop")?"已发出打断，等待电脑确认停止":kind.equals("end")?"已提交结束任务":"已发出继续指示，等待电脑接收");}
    else{if(failed!=null)failed.run();AgentUI.notice(activity,TaskWorkspace.label(error));}render();
   });
  }catch(Exception invalid){submittingControls.remove(flight);if(failed!=null)failed.run();AgentUI.notice(activity,TaskWorkspace.label(TaskApi.safeError(invalid)));}
 }
 private static String answerText(Map<String,Object> request,Map<String,Object> answer){StringBuilder text=new StringBuilder();if(answer.get("option_id")!=null)for(Object raw:WireJson.list(TaskWire.body(request).get("options"))){Map<String,Object> option=WireJson.map(raw);if(answer.get("option_id").equals(option.get("option_id")))text.append(option.get("label")).append("\n");}text.append((String)answer.get("text"));return text.toString();}
}
