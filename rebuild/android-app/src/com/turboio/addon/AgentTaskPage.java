package com.turboio.addon;

import android.app.Activity;
import android.content.Context;
import android.content.SharedPreferences;
import android.graphics.Typeface;
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
 private final Map<String,Integer> listPositions=new HashMap<>();
 private final List<AgentUI.Screen> forms=new ArrayList<>();
 private final Set<String> submittingControls=new HashSet<>();
 private TaskRuntime.Snapshot snapshot;
 private TaskPresentation presentation;
 private ScrollView taskScroll;
 private AgentUI.Screen detail;
 private String detailKey="",filter="running",fingerprint="";
 private boolean closed,showAllQuestions,showHistory,openingQuestion;
 private long nextExpiry=Long.MAX_VALUE;

 AgentTaskPage(Activity a,Runnable openConnections){
  activity=a;this.openConnections=openConnections;runtime=TaskRuntime.get(a);
  root=AgentUI.column(a);scroll=new ScrollView(a);scroll.setFillViewport(true);
  body=AgentUI.column(a);int side=AgentUI.dp(a,20);body.setPadding(side,AgentUI.dp(a,12),side,AgentUI.dp(a,20));scroll.addView(body);
  root.addView(scroll,new LinearLayout.LayoutParams(-1,0,1));
  LinearLayout footer=AgentUI.column(a);footer.setPadding(side,0,side,AgentUI.dp(a,12));
  create=AgentUI.button(a,footer,"＋ 交给 Agent 一件事",false,this::delegate);root.addView(footer);
  body.addView(AgentUI.text(a,"正在读取任务…",15,AgentUI.MUTED));
  observer=(value,error)->{
   if(!alive())return;snapshot=value;
   if(!fingerprint.equals(value.fingerprint)||System.currentTimeMillis()>=nextExpiry){fingerprint=value.fingerprint;render();}
  };
  runtime.observe(a,observer);
 }
 View view(){return root;}
 void refresh(){if(!closed)runtime.read(null);}
 void close(){if(closed)return;closed=true;runtime.unobserve(observer);for(AgentUI.Screen form:new ArrayList<>(forms))if(form.dialog.isShowing())form.dialog.dismiss();forms.clear();if(detail!=null&&detail.dialog.isShowing())detail.dialog.dismiss();}
 private boolean alive(){return !closed&&!activity.isFinishing()&&!activity.isDestroyed();}
 private void render(){
  if(!alive()||snapshot==null)return;int position=scroll.getScrollY();rememberList();
  List<TaskPresentation.Source> sources=new ArrayList<>();for(TaskHub.View context:snapshot.contexts)sources.add(new TaskPresentation.Source(context.profile,context.objects,context.pending));
  long now=System.currentTimeMillis();presentation=new TaskPresentation(sources,now);nextExpiry=Long.MAX_VALUE;
  for(TaskPresentation.Question question:presentation.questions){long expiry=TaskWire.stamp(question.item.get("expires_at"));if(expiry>now)nextExpiry=Math.min(nextExpiry,expiry);if(question.profile.connection.expiresAt>now)nextExpiry=Math.min(nextExpiry,question.profile.connection.expiresAt);}body.removeAllViews();
  LinearLayout connection=new LinearLayout(activity);connection.setGravity(Gravity.CENTER_VERTICAL);
  int enabled=0;for(TaskHub.View context:snapshot.contexts)if(context.profile.enabled&&context.profile.connection.expiresAt>System.currentTimeMillis())enabled++;
  TextView connected=AgentUI.text(activity,snapshot.contexts.isEmpty()?"尚未连接电脑":enabled+" 个连接已启用",12,AgentUI.MUTED);connection.addView(connected,new LinearLayout.LayoutParams(0,-2,1));
  TextView manage=link("查看连接",openConnections);connection.addView(manage);body.addView(connection);AgentUI.gap(activity,body,18);
  if(!TaskWire.set("contexts_ready","contexts_updated","ready","received","queued","awaiting_refresh","paused","unconfigured").contains(snapshot.note)){
   TextView warning=AgentUI.text(activity,TaskWorkspace.label(snapshot.note),13,AgentUI.MUTED);body.addView(warning);AgentUI.gap(activity,body,12);
  }
  int decisions=0;for(TaskPresentation.Question question:presentation.questions)if(!question.queuedAnswer())decisions++;
  TextView heading=AgentUI.text(activity,decisions>0?"需要你决定  "+decisions:presentation.questions.isEmpty()?"需要你决定":"回复进度",17,AgentUI.INK);heading.setTypeface(null,Typeface.BOLD);body.addView(heading);
  if(presentation.questions.isEmpty()){
   LinearLayout empty=AgentUI.card(activity,body);empty.addView(AgentUI.text(activity,"暂无等待回复的问题",16,AgentUI.INK));AgentUI.gap(activity,empty,6);empty.addView(AgentUI.text(activity,snapshot.contexts.isEmpty()?"添加电脑连接后，Agent 的问题会出现在这里。":"有新的问题时，会在这里等待你处理。",13,AgentUI.MUTED));
  }else{
   int limit=showAllQuestions?presentation.questions.size():1;for(int i=0;i<limit;i++)questionCard(body,presentation.questions.get(i));
   if(presentation.questions.size()>1)body.addView(link(showAllQuestions?"收起其他问题":"还有 "+(presentation.questions.size()-1)+" 个问题",()->{showAllQuestions=!showAllQuestions;render();}));
  }
  AgentUI.gap(activity,body,22);LinearLayout tabs=new LinearLayout(activity);String[] labels={"进行中 "+presentation.filter("running").size(),"已完成","全部"},keys={"running","completed","all"};
  for(int i=0;i<keys.length;i++){final String selected=keys[i];TextView tab=AgentUI.text(activity,labels[i],14,filter.equals(selected)?AgentUI.ACCENT:AgentUI.MUTED);tab.setGravity(Gravity.CENTER);tab.setPadding(0,AgentUI.dp(activity,12),0,AgentUI.dp(activity,12));tab.setSelected(filter.equals(selected));tab.setContentDescription(labels[i]+(filter.equals(selected)?"，已选择":""));tab.setFocusable(true);tabs.addView(tab,new LinearLayout.LayoutParams(0,-2,1));tab.setOnClickListener(v->{rememberList();taskScroll=null;filter=selected;render();});}
  body.addView(tabs);taskScroll=new ScrollView(activity);taskScroll.setFillViewport(true);taskScroll.setNestedScrollingEnabled(true);LinearLayout list=AgentUI.column(activity);taskScroll.addView(list);body.addView(taskScroll,new LinearLayout.LayoutParams(-1,AgentUI.dp(activity,248)));
  List<TaskPresentation.Row> rows=presentation.filter(filter);if(rows.isEmpty()){TextView empty=AgentUI.text(activity,"completed".equals(filter)?"还没有已完成的任务":"暂无任务",14,AgentUI.MUTED);empty.setGravity(Gravity.CENTER);list.addView(empty,new LinearLayout.LayoutParams(-1,AgentUI.dp(activity,240)));}else for(TaskPresentation.Row row:rows)taskRow(list,row);
  AgentUI.gap(activity,body,14);TextView note=AgentUI.text(activity,"每个回复，都会回到发起它的原任务。",12,AgentUI.MUTED);note.setGravity(Gravity.CENTER);body.addView(note);
  create.setText("＋ 交给 Agent 一件事");
  final ScrollView currentList=taskScroll;final int inner=listPositions.containsKey(filter)?listPositions.get(filter):0;
  scroll.post(()->{if(alive()){scroll.scrollTo(0,position);if(currentList==taskScroll)currentList.scrollTo(0,inner);}});
  if(detail!=null&&detail.dialog.isShowing()){TaskPresentation.Row row=presentation.find(detailKey);if(row!=null)renderDetails(row);}
 }
 private void rememberList(){if(taskScroll!=null)listPositions.put(filter,taskScroll.getScrollY());}
 private TextView link(String text,Runnable action){TextView view=AgentUI.text(activity,text,13,AgentUI.ACCENT);view.setPadding(0,AgentUI.dp(activity,10),0,AgentUI.dp(activity,10));view.setMinHeight(AgentUI.dp(activity,44));view.setGravity(Gravity.CENTER_VERTICAL);view.setFocusable(true);view.setOnClickListener(v->action.run());return view;}
 private void questionCard(LinearLayout parent,TaskPresentation.Question question){
  LinearLayout card=AgentUI.card(activity,parent);card.addView(AgentUI.text(activity,TaskPresentation.source(question.profile),12,AgentUI.MUTED));AgentUI.gap(activity,card,9);
  TextView text=AgentUI.text(activity,(String)TaskWire.body(question.item).get("question"),17,AgentUI.INK);text.setMaxLines(3);text.setEllipsize(android.text.TextUtils.TruncateAt.END);card.addView(text);
  AgentUI.gap(activity,card,7);card.addView(AgentUI.text(activity,TaskPresentation.firstLine((String)TaskWire.body(question.parent).get("command")),13,AgentUI.MUTED));
  if(question.queuedAnswer())card.addView(AgentUI.text(activity,TaskPresentation.queueStatus(question.localAnswer),12,AgentUI.MUTED));
  else if(!question.available(System.currentTimeMillis()))card.addView(AgentUI.text(activity,question.profile.enabled?"连接已到期，请更新连接后回复":"连接已暂停，恢复后可回复",12,AgentUI.MUTED));
  AgentUI.button(activity,card,question.queuedAnswer()?"查看提交状态":question.available(System.currentTimeMillis())?"查看并回复":"查看问题",true,()->openQuestion(question));
  if(!question.queuedAnswer()&&question.available(System.currentTimeMillis()))card.addView(link("在眼镜上显示问题",()->AgentCardRuntime.offer(activity,question.binding,question.id,TaskWire.positive(question.item.get("revision")))));
 }
 private void taskRow(LinearLayout parent,TaskPresentation.Row row){
  LinearLayout card=AgentUI.column(activity);card.setPadding(0,AgentUI.dp(activity,14),0,AgentUI.dp(activity,12));
  LinearLayout summary=AgentUI.column(activity);TextView title=AgentUI.text(activity,row.title(),15,AgentUI.INK);title.setMaxLines(2);title.setEllipsize(android.text.TextUtils.TruncateAt.END);summary.addView(title);
  AgentUI.gap(activity,summary,4);summary.addView(AgentUI.text(activity,TaskPresentation.source(row.profile),12,AgentUI.MUTED));AgentUI.gap(activity,summary,6);summary.addView(AgentUI.text(activity,"• "+TaskPresentation.status(row)+"   ›",12,AgentUI.MUTED));summary.setFocusable(true);summary.setContentDescription(row.title()+"，"+TaskPresentation.status(row)+"，查看任务");summary.setOnClickListener(v->openDetails(row));card.addView(summary);
  controls(card,row);
  parent.addView(card);View divider=new View(activity);divider.setBackgroundColor(0x224b725e);parent.addView(divider,new LinearLayout.LayoutParams(-1,AgentUI.dp(activity,1)));
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
