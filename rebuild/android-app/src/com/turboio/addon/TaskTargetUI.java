package com.turboio.addon;

import android.app.Activity;
import android.app.Dialog;
import android.graphics.drawable.GradientDrawable;
import android.text.TextUtils;
import android.view.*;
import android.widget.*;
import java.util.*;
import java.util.function.*;

/** The delegate target card and the "本次交给" sheet. One card per real session:
 * what it is, where it works and whether it can take a task now. Ready sessions
 * come first; offline ones stay folded so a long history never buries them. */
final class TaskTargetUI {
 private static final int SHEET=0xff141816;
 /** What a card shows, from a live directory entry or, before the directory loads, the saved connection. */
 static final class Target {
  // agent = which Agent, computer = which machine, title = which session (its label, else the workspace).
  final String agent,computer,title,workspace,session,status,kind;final int tone;
  Target(String agent,String computer,String title,String workspace,String session,String status,int tone,String kind){this.agent=agent;this.computer=computer;this.title=title;this.workspace=workspace;this.session=session;this.status=status;this.tone=tone;this.kind=kind;}
  static Target of(TaskSessionDirectory.Entry e,long elapsed){
   String gate=e.gate(elapsed);
   int tone=!gate.isEmpty()?MaterialReadingUI.DIM:Boolean.FALSE.equals(e.busy)?MaterialReadingUI.ACCENT_SOFT:MaterialReadingUI.AMBER;
   return new Target("codex".equals(e.host)?"Codex":"claude".equals(e.host)?"Claude Code":String.valueOf(e.route.get("agent_id")).contains("workbuddy")?"WorkBuddy":"ACP Agent",computer(e),e.label.isEmpty()?shortPath(e.workspace):e.label,shortPath(e.workspace),String.valueOf(e.route.get("session_id")),e.status(elapsed),tone,TaskTones.kind(e.workspace,e.label));
  }
  static Target saved(TaskConnection c){return new Target(TaskPresentation.agentName(c.agent),TaskPresentation.computerName(c.computer),shortPath(c.project),shortPath(c.project),c.session,"状态待更新",MaterialReadingUI.DIM,"");}
 }
 /** The directory carries no machine name, only an opaque computer id; the workspace's home folder tells the
  * wearer which machine it is ("Mac · alice"). Falls back to a short id. */
 static String computer(TaskSessionDirectory.Entry e){
  java.util.regex.Matcher m=java.util.regex.Pattern.compile("^/(Users|home)/([^/]+)").matcher(e.workspace);
  if(m.find())return (m.group(1).equals("Users")?"Mac":"Linux")+" · "+m.group(2);
  m=java.util.regex.Pattern.compile("^[A-Za-z]:[\\\\/]Users[\\\\/]([^\\\\/]+)").matcher(e.workspace);
  if(m.find())return "Windows · "+m.group(1);
  return shortId(String.valueOf(e.route.get("computer_id")));
 }
 private static String shortId(String id){return TaskPresentation.shortComputer(id);}
 static boolean ready(TaskSessionDirectory.Entry e,long elapsed){return e.gate(elapsed).isEmpty();}
 /** The last two folders are what tells sessions apart; the full path stays in details. */
 static String shortPath(String path){
  List<String> parts=new ArrayList<>();for(String p:path.replace('\\','/').split("/"))if(!p.isEmpty())parts.add(p);
  return parts.size()<=2?path:"…/"+parts.get(parts.size()-2)+"/"+parts.get(parts.size()-1);
 }

 /** Fills a card. `action` (e.g. "更换") marks the delegate page's tappable summary; `note` is an extra warning line. */
 static void bind(Activity a,LinearLayout card,Target t,boolean isDefault,boolean selected,String action,String note,String topic,int background){bind(a,card,t,isDefault,selected,action,note,topic,background,true);}
 /** Three lines: Agent and its status; the computer (left out under a computer heading); the session. */
 static void bind(Activity a,LinearLayout card,Target t,boolean isDefault,boolean selected,String action,String note,String topic,int background,boolean showComputer){
  card.removeAllViews();card.setOrientation(LinearLayout.VERTICAL);card.setPadding(dp(a,14),dp(a,13),dp(a,12),dp(a,13));
  GradientDrawable base=MaterialReadingUI.fill(a,background,16);if(selected)base.setStroke(dp(a,2),MaterialReadingUI.ACCENT_SOFT);card.setBackground(MaterialReadingUI.pressable(a,base));card.setClickable(true);card.setFocusable(true);
  LinearLayout top=row(a);card.addView(top,new LinearLayout.LayoutParams(-1,-2));
  if(t==null){
   top.addView(MaterialReadingUI.bold(MaterialReadingUI.line(a,"选择交给哪个会话",16,AgentUI.INK,1)),new LinearLayout.LayoutParams(0,-2,1));actionLabel(a,top,action==null?"选择":action);
   if(note!=null&&!note.isEmpty()){TextView n=MaterialReadingUI.line(a,note,13,AgentUI.MUTED,3);n.setPadding(0,dp(a,6),0,0);card.addView(n);}
   card.setContentDescription("选择交给哪个会话");return;
  }
  View dot=new View(a);dot.setBackground(MaterialReadingUI.fill(a,t.tone,4));LinearLayout.LayoutParams dl=new LinearLayout.LayoutParams(dp(a,8),dp(a,8));dl.rightMargin=dp(a,8);top.addView(dot,dl);
  top.addView(MaterialReadingUI.bold(MaterialReadingUI.line(a,t.agent,16,TaskTones.agent(t.agent)[0],1)));
  if(!t.kind.isEmpty()){LinearLayout.LayoutParams kp=new LinearLayout.LayoutParams(-2,dp(a,20));kp.leftMargin=dp(a,8);int[] tint=TaskTones.agent(t.agent);MaterialReadingUI.chip(a,top,t.kind,tint[0],tint[1]).setLayoutParams(kp);}
  if(isDefault){LinearLayout.LayoutParams cp=new LinearLayout.LayoutParams(-2,dp(a,20));cp.leftMargin=dp(a,8);TextView chip=MaterialReadingUI.chip(a,top,"默认",MaterialReadingUI.ACCENT_SOFT,MaterialReadingUI.ACCENT_BG);chip.setLayoutParams(cp);}
  top.addView(new View(a),new LinearLayout.LayoutParams(0,1,1));
  TextView status=MaterialReadingUI.line(a,t.status,12,t.tone==MaterialReadingUI.DIM?AgentUI.MUTED:t.tone,1);status.setPadding(dp(a,8),0,0,0);top.addView(status);
  if(selected){View gap=new View(a);top.addView(gap,new LinearLayout.LayoutParams(dp(a,6),1));MaterialReadingUI.glyph(a,top,"check",MaterialReadingUI.ACCENT_SOFT,18);}
  if(action!=null)actionLabel(a,top,action);
  int indent=dp(a,16);
  if(showComputer){TextView machine=MaterialReadingUI.line(a,"电脑 · "+t.computer,13,MaterialReadingUI.SOFT,1);machine.setPadding(indent,dp(a,6),0,0);card.addView(machine);}
  String shortSession=t.session.length()>6?t.session.substring(0,6):t.session;
  TextView session=MaterialReadingUI.line(a,"会话 · "+t.title+" · "+shortSession,12,AgentUI.MUTED,1);session.setEllipsize(TextUtils.TruncateAt.MIDDLE);session.setPadding(indent,dp(a,showComputer?3:5),0,0);card.addView(session);
  if(topic!=null&&!topic.isEmpty()){TextView last=MaterialReadingUI.line(a,"最近："+topic,12,AgentUI.MUTED,1);last.setPadding(indent,dp(a,3),0,0);card.addView(last);}
  if(note!=null&&!note.isEmpty()){TextView n=MaterialReadingUI.line(a,note,12,MaterialReadingUI.AMBER,2);n.setPadding(indent,dp(a,6),0,0);card.addView(n);}
  card.setContentDescription(t.agent+"，电脑 "+t.computer+"，会话 "+t.title+"，"+t.status+(isDefault?"，默认":"")+(selected?"，已选":""));
 }

 /** Bottom sheet listing every session. Choosing one dismisses the sheet and hands the entry back. */
 static Dialog pick(Activity a,List<TaskSessionDirectory.Entry> sessions,Predicate<TaskSessionDirectory.Entry> isDefault,Predicate<TaskSessionDirectory.Entry> isSelected,Consumer<TaskSessionDirectory.Entry> chosen){
  long now=TaskSessionDirectory.elapsed();Dialog d=new AgentDialog(a);d.requestWindowFeature(Window.FEATURE_NO_TITLE);
  LinearLayout root=AgentUI.column(a);root.setBackground(MaterialReadingUI.corners(a,SHEET,22,0));root.setPadding(dp(a,16),dp(a,10),dp(a,16),dp(a,8));
  View handle=new View(a);handle.setBackground(MaterialReadingUI.fill(a,0xff3a423f,2));LinearLayout.LayoutParams hp=new LinearLayout.LayoutParams(dp(a,36),dp(a,4));hp.gravity=Gravity.CENTER_HORIZONTAL;hp.bottomMargin=dp(a,14);root.addView(handle,hp);
  root.addView(MaterialReadingUI.bold(AgentUI.text(a,"交给谁",18,AgentUI.INK)));
  TextView sub=AgentUI.text(a,"电脑 › Agent › 会话 · 只用于这次委托，默认目标不变",12,AgentUI.MUTED);sub.setPadding(0,dp(a,4),0,dp(a,6));root.addView(sub);
  int max=(int)(a.getResources().getDisplayMetrics().heightPixels*0.68f);
  ScrollView scroll=new ScrollView(a){@Override protected void onMeasure(int w,int h){super.onMeasure(w,View.MeasureSpec.makeMeasureSpec(max,View.MeasureSpec.AT_MOST));}};
  scroll.setOverScrollMode(View.OVER_SCROLL_NEVER);scroll.setVerticalScrollBarEnabled(false);LinearLayout list=AgentUI.column(a);list.setPadding(0,0,0,dp(a,8));scroll.addView(list,new ScrollView.LayoutParams(-1,-2));root.addView(scroll,new LinearLayout.LayoutParams(-1,-2));
  List<TaskSessionDirectory.Entry> live=new ArrayList<>(),other=new ArrayList<>();for(TaskSessionDirectory.Entry e:sessions)(ready(e,now)?live:other).add(e);
  Comparator<TaskSessionDirectory.Entry> first=Comparator.comparingInt(e->isSelected.test(e)?0:isDefault.test(e)?1:2);live.sort(first);other.sort(first);
  BiConsumer<LinearLayout,TaskSessionDirectory.Entry> add=(parent,e)->{
   LinearLayout card=AgentUI.column(a);LinearLayout.LayoutParams p=new LinearLayout.LayoutParams(-1,-2);p.topMargin=dp(a,8);parent.addView(card,p);
   bind(a,card,Target.of(e,now),isDefault.test(e),isSelected.test(e),null,null,null,parent==list?MaterialReadingUI.CARD:MaterialReadingUI.RAISED,false);
   card.setOnClickListener(v->{d.dismiss();chosen.accept(e);});
  };
  // Sessions grouped under the computer they run on (by the name the wearer sees, since one machine can hold
  // several computer ids), so the same Agent on two machines never looks alike.
  BiConsumer<LinearLayout,List<TaskSessionDirectory.Entry>> grouped=(parent,entries)->{
   Map<String,List<TaskSessionDirectory.Entry>> machines=new LinkedHashMap<>();for(TaskSessionDirectory.Entry e:entries)machines.computeIfAbsent(computer(e),k->new ArrayList<>()).add(e);
   for(Map.Entry<String,List<TaskSessionDirectory.Entry>> group:machines.entrySet()){int ready=0;for(TaskSessionDirectory.Entry e:group.getValue())if(ready(e,now))ready++;machine(a,parent,group.getKey(),ready>0?"在线 · "+ready+" 个可接收":"离线",ready>0);for(TaskSessionDirectory.Entry e:group.getValue())add.accept(parent,e);}
  };
  if(!live.isEmpty())grouped.accept(list,live);
  else{TextView none=AgentUI.text(a,"现在没有在线、可接收任务的会话。请先在电脑上打开原会话；也可以先选一个离线会话写好草稿，上线后再提交。",13,AgentUI.MUTED);none.setPadding(0,dp(a,10),0,0);list.addView(none);}
  if(!other.isEmpty())new MaterialReadingUI.Fold(a,list,"离线或暂不可用",other.size()+" 个",live.isEmpty(),c->grouped.accept(c,other));
  TextView cancel=AgentUI.text(a,"取消",15,AgentUI.MUTED);cancel.setGravity(Gravity.CENTER);cancel.setBackground(MaterialReadingUI.pressable(a,null));cancel.setOnClickListener(v->d.dismiss());root.addView(cancel,new LinearLayout.LayoutParams(-1,dp(a,48)));
  d.setContentView(root);d.setCanceledOnTouchOutside(true);d.show();
  Window w=d.getWindow();if(w!=null){w.setBackgroundDrawableResource(android.R.color.transparent);w.setLayout(-1,-2);w.setGravity(Gravity.BOTTOM);w.setWindowAnimations(android.R.style.Animation_InputMethod);w.addFlags(WindowManager.LayoutParams.FLAG_DIM_BEHIND);w.setDimAmount(0.55f);w.setNavigationBarColor(SHEET);}
  return d;
 }
 private static void machine(Activity a,LinearLayout parent,String name,String state,boolean online){
  LinearLayout r=row(a);r.setPadding(dp(a,2),dp(a,14),dp(a,2),0);r.addView(MaterialReadingUI.bold(MaterialReadingUI.line(a,name,13,AgentUI.INK,1)),new LinearLayout.LayoutParams(0,-2,1));
  r.addView(AgentUI.text(a,state,12,online?MaterialReadingUI.ACCENT_SOFT:AgentUI.MUTED));parent.addView(r);
 }
 private static void actionLabel(Activity a,LinearLayout parent,String label){TextView t=AgentUI.text(a,label,13,AgentUI.MUTED);t.setPadding(dp(a,8),0,dp(a,2),0);parent.addView(t);MaterialReadingUI.glyph(a,parent,"right",AgentUI.MUTED,16);}
 private static LinearLayout row(Activity a){LinearLayout r=new LinearLayout(a);r.setOrientation(LinearLayout.HORIZONTAL);r.setGravity(Gravity.CENTER_VERTICAL);return r;}
 private static int dp(Activity a,int v){return AgentUI.dp(a,v);}
}
