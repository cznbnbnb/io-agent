package com.turboio.addon;

import android.app.*;
import android.os.*;
import android.view.WindowManager;
import android.widget.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.atomic.AtomicInteger;

/** Foreground-only native lens experiment. Dedicated durable cleanup; no audio or task execution. */
final class MinuteCardRuntime {
 private static volatile MinuteCardRuntime instance;
 private final Application app;private final Handler main=new Handler(Looper.getMainLooper());
 private final String lease="minute-card-"+UUID.randomUUID();
 private final AtomicInteger queued=new AtomicInteger();
 private final Set<Activity> foreground=Collections.newSetFromMap(new WeakHashMap<Activity,Boolean>());
 private MinuteCardSession session;private AtomicDocument document;private boolean claimed;private int screens;
 private String note="",lastExport="";private TextView view;
 private static long now(){return SystemClock.elapsedRealtime();}
 private MinuteCardRuntime(Activity activity){
  app=(Application)activity.getApplication();foreground.add(activity);
  try{document=new AtomicDocument(new File(app.getFilesDir(),"io-minute-card-v1.json"));session=new MinuteCardSession(new MinuteCardSession.Store(){public Object read()throws Exception{return document.read();}public void save(Object value)throws Exception{document.save(value);}});}
  catch(Exception failure){note="测试存储不可用，未开放发送";}
  app.registerActivityLifecycleCallbacks(new Application.ActivityLifecycleCallbacks(){
   public void onActivityResumed(Activity a){foreground.add(a);}
   public void onActivityStopped(Activity a){foreground.remove(a);}
   public void onActivityDestroyed(Activity a){foreground.remove(a);}
   public void onActivityCreated(Activity a,Bundle b){}public void onActivityStarted(Activity a){}public void onActivityPaused(Activity a){}public void onActivitySaveInstanceState(Activity a,Bundle b){}
  });
  main.post(poll);
 }
 static void init(Activity activity){if(instance==null)instance=new MinuteCardRuntime(activity);}
 static void show(Activity activity){
  init(activity);MinuteCardRuntime r=instance;
  if(r.screens>0){EditorialUI.notice(activity,"测试页已打开");return;}
  EditorialUI.Screen screen=new EditorialUI.Screen(activity,"一分钟任务卡测试");r.screens++;
  screen.dialog.getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
  screen.body.addView(EditorialUI.text(activity,"原生建议卡 · 合成内容",24,EditorialUI.INK));
  screen.body.addView(EditorialUI.text(activity,"仅验证显示与选择，不执行电脑任务。静置观察时请勿操作旋钮。手机在120秒后兜底清理；镜片实际时长需单独记录。",15,EditorialUI.MUTED));
  r.view=EditorialUI.text(activity,"",14,EditorialUI.INK);screen.body.addView(r.view);
  EditorialUI.button(activity,screen.body,"只读检查测试条件",false,()->r.inspect(false));
  EditorialUI.button(activity,screen.body,"发送一分钟原生测试卡",true,()->r.inspect(true));
  EditorialUI.button(activity,screen.body,"清理本次测试卡",false,r::remove);
  EditorialUI.button(activity,screen.body,"记录镜片已回首页",false,()->new AlertDialog.Builder(activity).setTitle("确认退出观察").setMessage("只在亲眼看到测试卡已经消失、镜片回到正常首页后记录。此项不代替一分钟、旋转续时或选择结果。").setNegativeButton("返回",null).setPositiveButton("镜片已回首页",(d,w)->{if(r.session!=null&&r.session.confirmGone("镜片已回首页"))r.note="退出观察已记录";else r.note="请先清理本卡并核对镜片";r.refresh();}).show());
  screen.dialog.setOnDismissListener(d->{r.screens--;r.view=null;if(r.session!=null&&r.session.pending())r.remove();else if(r.session!=null&&r.session.working())r.session.stop("测试页已关闭");r.refresh();});
  r.refresh();
 }
 private boolean claim(){
  if(session==null||!session.healthy()||FirmwareQueue.busy()||Fixed60OfficialRuntime.pending()||!Host107Login.loggedIn()||foreground.isEmpty())return false;
  if(!NativeTransfer.acquireMessages(lease))return false;claimed=true;return true;
 }
 private void inspect(boolean show){
  if(session==null||session.pending()||session.working()){note="请先完成本次测试或清理上次卡片";refresh();return;}
  if(!claim()){note="升级结果保护、账号或其他设备操作尚未就绪";refresh();return;}
  Fixed60Session.Link link=Host107Ota.link();
  if(!session.inspect(link.peer,link.generation,now(),show)){note="没有唯一认证眼镜，未发送";release();}else note="";
  pump();refresh();
 }
 private void remove(){
  if(!claim()){note="清理尚未提交：请恢复原眼镜连接并结束其他操作";refresh();return;}
  Fixed60Session.Link link=Host107Ota.link();
  if(!session.remove(link.peer,link.generation,now()))note="清理等待：原目标不符、提交未结束或没有待清理卡片";else note="";
  pump();refresh();
 }
 private void release(){if(claimed){NativeTransfer.releaseMessages(lease);claimed=false;}}
 private void pump(){
  if(session==null)return;
  Fixed60Session.Link fresh=Host107Ota.link();session.tick(fresh.peer,fresh.generation,now(),screens>0&&!foreground.isEmpty());
  if(!session.working()&&!session.pending())release();
  if(!claimed||FirmwareQueue.busy())return;
  MinuteCardSession.Emission e=session.next(now());if(e==null)return;
  Fixed60Session.Link bound=Host107Ota.link();
  Host107Suggestion.send(bound,e,ok->{session.result(e.ticket,ok,now());pump();refresh();});
 }
 private final Runnable poll=new Runnable(){public void run(){
  try{if(session!=null){Fixed60Session.Link link=Host107Ota.link();session.tick(link.peer,link.generation,now(),screens>0&&!foreground.isEmpty());
   if(FirmwareQueue.busy()&&session.working())session.stop("升级保护启用，测试已停止");
   pump();}refresh();
  }finally{main.postDelayed(this,250);}
 }};
 private void refresh(){
  String status="iO Agent "+ProductInfo.VERSION+"\n"+(note.isEmpty()?"":note+"\n")+(session==null?"测试不可用":session.status(now()));
  if(view!=null)view.setText(status);
  if(status.equals(lastExport))return;
  try{File dir=app.getExternalFilesDir(null);if(dir!=null){try(FileOutputStream out=new FileOutputStream(new File(dir,"io-agent-minute-card-status.txt"))){out.write(status.getBytes(StandardCharsets.UTF_8));}lastExport=status;}}catch(IOException ignored){}
 }
 static void observe(String kind,Map<?,?> data){
  MinuteCardRuntime r=instance;if(r==null||data==null||!"messageReceived".equals(kind))return;
  Object raw=data.get("message");if(!(raw instanceof Map))return;Map<?,?> m=(Map<?,?>)raw;
  int business=HostBusiness.id(m.get("businessId"));if(business!=9&&business!=21)return;
  Object target=m.get("deviceId"),payload=m.get("payload");
  if(!(target instanceof String)||((String)target).length()>256||!(payload instanceof byte[])||((byte[])payload).length>8192)return;
  if(r.queued.incrementAndGet()>16){r.queued.decrementAndGet();return;}
  String peer=(String)target;byte[] bytes=((byte[])payload).clone();
  r.main.post(()->{try{if(r.session!=null&&r.claimed){Fixed60Session.Link link=Host107Ota.link();
   r.session.tick(link.peer,link.generation,now(),r.screens>0&&!r.foreground.isEmpty());
   r.session.receive(peer,link.generation,business,bytes,now());r.pump();r.refresh();}
  }finally{r.queued.decrementAndGet();}});
 }
}
