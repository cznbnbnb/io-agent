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
  final String title,who,workspace,session,host,status;final int tone;
  Target(String title,String who,String workspace,String session,String host,String status,int tone){this.title=title;this.who=who;this.workspace=workspace;this.session=session;this.host=host;this.status=status;this.tone=tone;}
  static Target of(TaskSessionDirectory.Entry e,long elapsed){
   String agent=String.valueOf(e.route.get("agent_id")),gate=e.gate(elapsed);
   int tone=!gate.isEmpty()?MaterialReadingUI.DIM:Boolean.FALSE.equals(e.busy)?MaterialReadingUI.ACCENT_SOFT:MaterialReadingUI.AMBER;
   return new Target(e.label.isEmpty()?agent:e.label,agent+" · "+e.route.get("computer_id"),shortPath(e.workspace),String.valueOf(e.route.get("session_id")),"codex".equals(e.host)?"Codex":"Claude",e.status(elapsed),tone);
  }
  static Target saved(TaskConnection c){return new Target(c.agent,c.agent+" · "+c.computer,shortPath(c.project),c.session,"","状态待更新",MaterialReadingUI.DIM);}
 }
 static boolean ready(TaskSessionDirectory.Entry e,long elapsed){return e.gate(elapsed).isEmpty();}
 /** The last two folders are what tells sessions apart; the full path stays in details. */
 static String shortPath(String path){
  List<String> parts=new ArrayList<>();for(String p:path.replace('\\','/').split("/"))if(!p.isEmpty())parts.add(p);
  return parts.size()<=2?path:"…/"+parts.get(parts.size()-2)+"/"+parts.get(parts.size()-1);
 }

 /** Fills a card. `action` (e.g. "更换") marks the delegate page's tappable summary; `note` is an extra warning line. */
 static void bind(Activity a,LinearLayout card,Target t,boolean isDefault,boolean selected,String action,String note,String topic,int background){
  card.removeAllViews();card.setOrientation(LinearLayout.VERTICAL);card.setPadding(dp(a,14),dp(a,13),dp(a,12),dp(a,13));
  GradientDrawable base=MaterialReadingUI.fill(a,background,16);if(selected)base.setStroke(dp(a,2),MaterialReadingUI.ACCENT_SOFT);card.setBackground(MaterialReadingUI.pressable(a,base));card.setClickable(true);card.setFocusable(true);
  LinearLayout top=row(a);card.addView(top,new LinearLayout.LayoutParams(-1,-2));
  if(t==null){
   top.addView(MaterialReadingUI.bold(MaterialReadingUI.line(a,"选择交给哪个会话",16,AgentUI.INK,1)),new LinearLayout.LayoutParams(0,-2,1));actionLabel(a,top,action==null?"选择":action);
   if(note!=null&&!note.isEmpty()){TextView n=MaterialReadingUI.line(a,note,13,AgentUI.MUTED,3);n.setPadding(0,dp(a,6),0,0);card.addView(n);}
   card.setContentDescription("选择交给哪个会话");return;
  }
  View dot=new View(a);dot.setBackground(MaterialReadingUI.fill(a,t.tone,4));LinearLayout.LayoutParams dl=new LinearLayout.LayoutParams(dp(a,8),dp(a,8));dl.rightMargin=dp(a,8);top.addView(dot,dl);
  top.addView(MaterialReadingUI.bold(MaterialReadingUI.line(a,t.title,16,AgentUI.INK,1)),new LinearLayout.LayoutParams(0,-2,1));
  if(selected)MaterialReadingUI.glyph(a,top,"check",MaterialReadingUI.ACCENT_SOFT,20);
  if(action!=null)actionLabel(a,top,action);
  int indent=dp(a,16);
  TextView who=MaterialReadingUI.line(a,t.who,13,MaterialReadingUI.SOFT,1);who.setPadding(indent,dp(a,6),0,0);card.addView(who);
  TextView where=MaterialReadingUI.line(a,t.workspace,12,AgentUI.MUTED,1);where.setEllipsize(TextUtils.TruncateAt.MIDDLE);where.setPadding(indent,dp(a,3),0,0);card.addView(where);
  if(topic!=null&&!topic.isEmpty()){TextView last=MaterialReadingUI.line(a,"最近："+topic,12,AgentUI.MUTED,1);last.setPadding(indent,dp(a,3),0,0);card.addView(last);}
  LinearLayout meta=row(a);meta.setPadding(indent,dp(a,8),0,0);card.addView(meta,new LinearLayout.LayoutParams(-1,-2));
  TextView status=AgentUI.text(a,t.status,12,t.tone==MaterialReadingUI.DIM?AgentUI.MUTED:t.tone);status.setPadding(0,0,dp(a,8),0);meta.addView(status);
  if(isDefault)MaterialReadingUI.chip(a,meta,"默认",MaterialReadingUI.ACCENT_SOFT,MaterialReadingUI.ACCENT_BG);
  if(!t.host.isEmpty())MaterialReadingUI.chip(a,meta,t.host,MaterialReadingUI.SOFT,MaterialReadingUI.RAISED);
  meta.addView(new View(a),new LinearLayout.LayoutParams(0,1,1));
  meta.addView(AgentUI.text(a,"会话 "+(t.session.length()>8?t.session.substring(0,8):t.session),12,MaterialReadingUI.DIM));
  if(note!=null&&!note.isEmpty()){TextView n=MaterialReadingUI.line(a,note,12,MaterialReadingUI.AMBER,2);n.setPadding(indent,dp(a,6),0,0);card.addView(n);}
  card.setContentDescription(t.title+"，"+t.who+"，"+t.status+(isDefault?"，默认":"")+(selected?"，已选":""));
 }

 /** Bottom sheet listing every session. Choosing one dismisses the sheet and hands the entry back. */
 static Dialog pick(Activity a,List<TaskSessionDirectory.Entry> sessions,Predicate<TaskSessionDirectory.Entry> isDefault,Predicate<TaskSessionDirectory.Entry> isSelected,Consumer<TaskSessionDirectory.Entry> chosen){
  long now=TaskSessionDirectory.elapsed();Dialog d=new Dialog(a,android.R.style.Theme_Material_NoActionBar);d.requestWindowFeature(Window.FEATURE_NO_TITLE);
  LinearLayout root=AgentUI.column(a);root.setBackground(MaterialReadingUI.corners(a,SHEET,22,0));root.setPadding(dp(a,16),dp(a,10),dp(a,16),dp(a,8));
  View handle=new View(a);handle.setBackground(MaterialReadingUI.fill(a,0xff3a423f,2));LinearLayout.LayoutParams hp=new LinearLayout.LayoutParams(dp(a,36),dp(a,4));hp.gravity=Gravity.CENTER_HORIZONTAL;hp.bottomMargin=dp(a,14);root.addView(handle,hp);
  root.addView(MaterialReadingUI.bold(AgentUI.text(a,"本次交给",18,AgentUI.INK)));
  TextView sub=AgentUI.text(a,"只用于这次委托，默认目标不变",12,AgentUI.MUTED);sub.setPadding(0,dp(a,4),0,dp(a,6));root.addView(sub);
  int max=(int)(a.getResources().getDisplayMetrics().heightPixels*0.68f);
  ScrollView scroll=new ScrollView(a){@Override protected void onMeasure(int w,int h){super.onMeasure(w,View.MeasureSpec.makeMeasureSpec(max,View.MeasureSpec.AT_MOST));}};
  scroll.setOverScrollMode(View.OVER_SCROLL_NEVER);scroll.setVerticalScrollBarEnabled(false);LinearLayout list=AgentUI.column(a);list.setPadding(0,0,0,dp(a,8));scroll.addView(list,new ScrollView.LayoutParams(-1,-2));root.addView(scroll,new LinearLayout.LayoutParams(-1,-2));
  List<TaskSessionDirectory.Entry> live=new ArrayList<>(),other=new ArrayList<>();for(TaskSessionDirectory.Entry e:sessions)(ready(e,now)?live:other).add(e);
  Comparator<TaskSessionDirectory.Entry> first=Comparator.comparingInt(e->isSelected.test(e)?0:isDefault.test(e)?1:2);live.sort(first);other.sort(first);
  BiConsumer<LinearLayout,TaskSessionDirectory.Entry> add=(parent,e)->{
   LinearLayout card=AgentUI.column(a);LinearLayout.LayoutParams p=new LinearLayout.LayoutParams(-1,-2);p.topMargin=dp(a,10);parent.addView(card,p);
   bind(a,card,Target.of(e,now),isDefault.test(e),isSelected.test(e),null,null,null,parent==list?MaterialReadingUI.CARD:MaterialReadingUI.RAISED);
   card.setOnClickListener(v->{d.dismiss();chosen.accept(e);});
  };
  if(!live.isEmpty()){section(a,list,"可以接收",live.size());for(TaskSessionDirectory.Entry e:live)add.accept(list,e);}
  else{TextView none=AgentUI.text(a,"现在没有在线、可接收任务的会话。请先在电脑上打开原会话；也可以先选一个离线会话写好草稿，上线后再提交。",13,AgentUI.MUTED);none.setPadding(0,dp(a,10),0,0);list.addView(none);}
  if(!other.isEmpty())new MaterialReadingUI.Fold(a,list,"离线或暂不可用",other.size()+" 个",live.isEmpty(),c->{for(TaskSessionDirectory.Entry e:other)add.accept(c,e);});
  TextView cancel=AgentUI.text(a,"取消",15,AgentUI.MUTED);cancel.setGravity(Gravity.CENTER);cancel.setBackground(MaterialReadingUI.pressable(a,null));cancel.setOnClickListener(v->d.dismiss());root.addView(cancel,new LinearLayout.LayoutParams(-1,dp(a,48)));
  d.setContentView(root);d.setCanceledOnTouchOutside(true);d.show();
  Window w=d.getWindow();if(w!=null){w.setBackgroundDrawableResource(android.R.color.transparent);w.setLayout(-1,-2);w.setGravity(Gravity.BOTTOM);w.setWindowAnimations(android.R.style.Animation_InputMethod);w.addFlags(WindowManager.LayoutParams.FLAG_DIM_BEHIND);w.setDimAmount(0.55f);w.setNavigationBarColor(SHEET);}
  return d;
 }
 private static void section(Activity a,LinearLayout parent,String name,int count){
  LinearLayout r=row(a);r.setPadding(0,dp(a,8),0,0);r.addView(AgentUI.text(a,name,13,AgentUI.MUTED));TextView n=AgentUI.text(a,"  "+count,13,MaterialReadingUI.DIM);r.addView(n);parent.addView(r);
 }
 private static void actionLabel(Activity a,LinearLayout parent,String label){TextView t=AgentUI.text(a,label,13,AgentUI.MUTED);t.setPadding(dp(a,8),0,dp(a,2),0);parent.addView(t);MaterialReadingUI.glyph(a,parent,"right",AgentUI.MUTED,16);}
 private static LinearLayout row(Activity a){LinearLayout r=new LinearLayout(a);r.setOrientation(LinearLayout.HORIZONTAL);r.setGravity(Gravity.CENTER_VERTICAL);return r;}
 private static int dp(Activity a,int v){return AgentUI.dp(a,v);}
}
