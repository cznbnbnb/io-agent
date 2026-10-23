package com.turboio.addon;

import android.app.Activity;
import android.graphics.Typeface;
import android.view.*;
import android.widget.*;
import java.lang.ref.WeakReference;

/** One native workspace over the original App. Vendor pages and lifecycles are retained. */
final class AgentWorkspace {
 private static WeakReference<AgentWorkspace> current=new WeakReference<>(null);
 private static int lastTab;
 private final Activity activity;private final AgentUI.Screen screen;private final FrameLayout content;
 private final View[] pages=new View[3];private final TextView[] labels=new TextView[3];private final AgentUI.Icon[] icons=new AgentUI.Icon[3];
 private final TaskRuntime tasks;private final TaskRuntime.Result observer;
 private AgentTaskPage taskPage;private AgentMaterialPage materialPage;private LinearLayout settingsBody;
 private TaskRuntime.Snapshot snapshot;private String fingerprint="";private boolean closed;
 static AgentUI.Screen show(Activity a){AgentWorkspace prior=current.get();if(prior!=null&&!prior.closed&&prior.activity==a&&prior.screen.dialog.isShowing())return prior.screen;AgentWorkspace w=new AgentWorkspace(a);current=new WeakReference<>(w);return w.screen;}
 private AgentWorkspace(Activity a){
  activity=a;screen=new AgentUI.Screen(a,"iO Agent",false);screen.header.removeAllViews();
  TextView brand=AgentUI.text(a,"iO  Agent",22,AgentUI.INK);brand.setTypeface(null,Typeface.BOLD);brand.setPadding(AgentUI.dp(a,8),0,0,0);brand.setGravity(Gravity.CENTER_VERTICAL);screen.header.addView(brand,new LinearLayout.LayoutParams(0,AgentUI.dp(a,56),1));
  screen.header.addView(AgentUI.headerAction(a,"···","工作区信息",this::about),new LinearLayout.LayoutParams(AgentUI.dp(a,44),AgentUI.dp(a,56)));
  screen.header.addView(AgentUI.headerAction(a,"−","回到原厂 APP",()->AgentUI.minimize(a)),new LinearLayout.LayoutParams(AgentUI.dp(a,44),AgentUI.dp(a,56)));
  content=new FrameLayout(a);screen.body.addView(content,new LinearLayout.LayoutParams(-1,-1));screen.dock.setPadding(AgentUI.dp(a,10),AgentUI.dp(a,6),AgentUI.dp(a,10),AgentUI.dp(a,4));screen.dock.setBackgroundColor(0xff101a14);
  LinearLayout navigation=new LinearLayout(a);String[] titles={"任务","资料","设置"},names={"tasks","materials","settings"};
  for(int i=0;i<3;i++){final int index=i;LinearLayout item=AgentUI.column(a);item.setGravity(Gravity.CENTER);item.setPadding(0,AgentUI.dp(a,8),0,AgentUI.dp(a,8));icons[i]=new AgentUI.Icon(a,names[i]);item.addView(icons[i],new LinearLayout.LayoutParams(AgentUI.dp(a,23),AgentUI.dp(a,23)));AgentUI.gap(a,item,5);labels[i]=AgentUI.text(a,titles[i],12,AgentUI.MUTED);labels[i].setGravity(Gravity.CENTER);item.addView(labels[i]);item.setContentDescription(titles[i]);item.setFocusable(true);item.setOnClickListener(v->select(index));navigation.addView(item,new LinearLayout.LayoutParams(0,AgentUI.dp(a,64),1));}
  screen.dock.addView(navigation);tasks=TaskRuntime.get(a);observer=(value,error)->{if(closed)return;snapshot=value;String stateKey=settingsKey(value);if(!stateKey.equals(fingerprint)){fingerprint=stateKey;if(settingsBody!=null)renderSettings();}};tasks.observe(a,observer);
  screen.dialog.setOnDismissListener(dialog->{closed=true;tasks.unobserve(observer);if(taskPage!=null)taskPage.close();if(materialPage!=null)materialPage.close();});select(lastTab);
 }
 private void select(int index){
  if(closed)return;lastTab=index;
  if(pages[index]==null){if(index==0){taskPage=new AgentTaskPage(activity,()->AgentConnectionsPage.show(activity));pages[index]=taskPage.view();}else if(index==1){materialPage=new AgentMaterialPage(activity);pages[index]=materialPage.view();}else{ScrollView scroll=new ScrollView(activity);scroll.setFillViewport(true);settingsBody=AgentUI.column(activity);settingsBody.setPadding(AgentUI.dp(activity,20),AgentUI.dp(activity,20),AgentUI.dp(activity,20),AgentUI.dp(activity,24));scroll.addView(settingsBody,new ScrollView.LayoutParams(-1,-2));pages[index]=scroll;renderSettings();}content.addView(pages[index],new FrameLayout.LayoutParams(-1,-1));}
  for(int i=0;i<3;i++){if(pages[i]!=null)pages[i].setVisibility(i==index?View.VISIBLE:View.GONE);icons[i].color(i==index?AgentUI.ACCENT:AgentUI.MUTED);labels[i].setTextColor(i==index?AgentUI.ACCENT:AgentUI.MUTED);((View)labels[i].getParent()).setSelected(i==index);}
  if(index==0&&taskPage!=null)taskPage.refresh();if(index==1&&materialPage!=null)materialPage.refresh();if(index==2)renderSettings();
 }
 private String settingsKey(TaskRuntime.Snapshot value){int enabled=0;for(TaskHub.View context:value.contexts)if(context.profile.enabled&&context.profile.connection.expiresAt>System.currentTimeMillis())enabled++;return value.fingerprint+"/"+NativeTransfer.connected()+"/"+enabled+"/"+AgentCardRuntime.enabled();}
 private void renderSettings(){
  if(closed||settingsBody==null)return;int scrollY=((ScrollView)settingsBody.getParent()).getScrollY();settingsBody.removeAllViews();Activity a=activity;AgentUI.heading(a,settingsBody,"设置");
  AgentUI.row(a,settingsBody,"雷鸟 iO",NativeTransfer.connected().isEmpty()?"眼镜尚未连接":"眼镜已连接","",()->GlassesConnectionUI.show(a));
  LinearLayout connection=AgentUI.card(a,settingsBody);int enabled=0;if(snapshot!=null)for(TaskHub.View c:snapshot.contexts)if(c.profile.enabled&&c.profile.connection.expiresAt>System.currentTimeMillis())enabled++;
  AgentUI.row(a,connection,"电脑连接","",snapshot==null?"读取中":enabled+" 个已启用",()->AgentConnectionsPage.show(a));AgentUI.divider(a,connection);
  String target=snapshot==null||snapshot.saved==null?"尚未设置":snapshot.saved.connection.agent+" / "+snapshot.saved.connection.project;
  AgentUI.row(a,connection,"默认 Agent 与工作区",target,"",()->AgentConnectionsPage.defaults(a));AgentUI.divider(a,connection);
  AgentUI.row(a,connection,"眼镜提醒","",AgentCardRuntime.enabled()?"已开启":"已关闭",this::reminders);AgentUI.divider(a,connection);
  AgentUI.row(a,connection,"资料同步","开关与同步方式","",()->AgentMaterialPage.settings(a));
  AgentUI.gap(a,settingsBody,24);settingsBody.addView(AgentUI.text(a,"更多",13,AgentUI.MUTED));LinearLayout more=AgentUI.card(a,settingsBody);
  AgentUI.row(a,more,"扩展工具","阅读、导航及原有扩展","",()->EditorialUI.home(a));AgentUI.divider(a,more);AgentUI.row(a,more,"账号与设备","沿用原厂登录和配对","",this::account);AgentUI.divider(a,more);AgentUI.row(a,more,"关于 iO Agent","","",this::about);
  AgentUI.gap(a,settingsBody,24);settingsBody.addView(AgentUI.text(a,"高级",13,AgentUI.MUTED));LinearLayout advanced=AgentUI.card(a,settingsBody);AgentUI.row(a,advanced,"开发者选项","测试、诊断与固件","",this::developer);
  AgentUI.gap(a,settingsBody,24);settingsBody.addView(AgentUI.text(a,"iO Agent "+ProductInfo.VERSION,12,AgentUI.MUTED));ScrollView scroll=(ScrollView)settingsBody.getParent();scroll.post(()->{if(!closed)scroll.scrollTo(0,scrollY);});
 }
 private void reminders(){Activity a=activity;AgentUI.Screen s=new AgentUI.Screen(a,"眼镜提醒");s.body.addView(AgentUI.text(a,"需要你决定时，在眼镜上提醒。关闭后仍可在手机处理原问题。",15,AgentUI.MUTED));LinearLayout card=AgentUI.card(a,s.body);AgentUI.toggle(a,card,"任务与问题提醒",AgentCardRuntime.enabled(),(v,on)->{AgentCardRuntime.enabled(on);if(AgentCardRuntime.enabled()!=on){v.setChecked(AgentCardRuntime.enabled());AgentUI.notice(a,"设置未能保存，请重试。");}});AgentUI.divider(a,card);AgentUI.toggle(a,card,"手机熄屏时继续回答",AgentCardRuntime.backgroundAnswer(),(v,on)->{AgentCardRuntime.backgroundAnswer(on);if(AgentCardRuntime.backgroundAnswer()!=on){v.setChecked(AgentCardRuntime.backgroundAnswer());AgentUI.notice(a,"设置未能保存，请重试。");}});AgentUI.divider(a,card);AgentUI.toggle(a,card,"点头确认完整答案",AgentCardRuntime.nodConfirm(),(v,on)->{AgentCardRuntime.nodConfirm(on);if(AgentCardRuntime.nodConfirm()!=on){v.setChecked(AgentCardRuntime.nodConfirm());AgentUI.notice(a,"设置未能保存，请重试。");}});AgentUI.gap(a,s.body,18);s.body.addView(AgentUI.text(a,"提词问题最多显示 3 分钟。暂未回答的问题留在手机；关闭提醒不会取消电脑任务。",13,AgentUI.MUTED));s.dialog.setOnDismissListener(d->renderSettings());}
 private void account(){Activity a=activity;AgentUI.Screen s=new AgentUI.Screen(a,"账号与设备");AgentUI.heading(a,s.body,"雷鸟 iO");s.body.addView(AgentUI.text(a,"账号登录、眼镜配对和基础设备设置继续由原厂 App 管理。",15,AgentUI.MUTED));AgentUI.button(a,s.dock,"回到原厂 APP",true,()->AgentUI.minimize(a));}
 private void about(){Activity a=activity;AgentUI.Screen s=new AgentUI.Screen(a,"iO Agent");AgentUI.heading(a,s.body,"让任务回到视线中心");s.body.addView(AgentUI.text(a,"任务、资料和设置共用一个工作区。新委托使用默认目标，已有问题始终回到发起它的原任务。",15,AgentUI.MUTED));AgentUI.gap(a,s.body,24);s.body.addView(AgentUI.text(a,"版本 "+ProductInfo.VERSION+"\n宿主适配：原厂 1.0.7",13,AgentUI.MUTED));AgentUI.button(a,s.dock,"回到原厂 APP",true,()->AgentUI.minimize(a));}
 private void developer(){Activity a=activity;AgentUI.Screen s=new AgentUI.Screen(a,"开发者选项");s.body.addView(AgentUI.text(a,"测试与诊断集中在这里。日常任务和资料无需进入此页。",14,AgentUI.MUTED));LinearLayout card=AgentUI.card(a,s.body);AgentUI.row(a,card,"连接诊断","设备与运行状态","",()->AgentUI.notice(a,"iO Agent "+ProductInfo.VERSION+"\n"+(NativeTransfer.connected().isEmpty()?"眼镜未连接":"眼镜已连接")+"\n"+TurboAddon.status()));AgentUI.divider(a,card);AgentUI.row(a,card,"任务卡与口述诊断","查看已有任务交互状态","",()->AgentCardRuntime.show(a));AgentUI.divider(a,card);AgentUI.row(a,card,"一分钟任务卡测试","会操作眼镜","",()->MinuteCardRuntime.show(a));AgentUI.divider(a,card);AgentUI.row(a,card,"固件与兼容性","查看升级状态","",()->Fixed60UI.show(a,s.dialog::dismiss));}
}
