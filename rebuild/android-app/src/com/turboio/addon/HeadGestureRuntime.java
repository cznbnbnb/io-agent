package com.turboio.addon;

import android.app.*;
import android.os.*;
import java.io.*;
import java.util.*;
import java.util.concurrent.atomic.AtomicInteger;
import android.view.WindowManager;
import android.widget.TextView;

/** Android owner of the temporary setting and its durable restoration, shared by request cards. */
final class HeadGestureRuntime {
 interface Listener {void changed(boolean ready,String phase);}
 private static volatile HeadGestureRuntime instance;
 private final Application app;
 private final Handler main=new Handler(Looper.getMainLooper());
 private final Set<Activity> foreground=Collections.newSetFromMap(new WeakHashMap<Activity,Boolean>());
 private final AtomicInteger queued=new AtomicInteger();
 private final String lease="agent-head-guard-"+UUID.randomUUID();
 private final HeadGestureSession session;private final AtomicDocument document;
 private volatile boolean claimed,available;private long recoveryGeneration=Long.MIN_VALUE;private volatile long observedGeneration=Long.MIN_VALUE;private Listener listener;private String notified="";
 private String checkOwner="",checkExport="";private long checkStarted;private boolean checkFinishing;private TextView checkView;private final Set<String> checkPhases=new LinkedHashSet<>();
 private static long now(){return SystemClock.elapsedRealtime();}
 private static void main(){if(Looper.myLooper()!=Looper.getMainLooper())throw new IllegalStateException("HEAD_GUARD_THREAD");}
 private HeadGestureRuntime(Activity activity)throws IOException{
  app=(Application)activity.getApplication();foreground.add(activity);document=new AtomicDocument(new File(activity.getFilesDir(),"io-agent-head-guard-v1.json"));
  session=new HeadGestureSession(new HeadGestureSession.Store(){public Object read()throws Exception{return document.read();}public void save(Object raw)throws Exception{document.save(raw);}});
  HeadGestureGate.observe(new HeadGestureGate.Observer(){
   public boolean userWrite(String peer,HeadGestureSession.Setting setting){boolean allowed=session.userWrite(peer,setting);main.post(()->pump());return allowed;}
   public boolean unknownWrite(String peer){boolean allowed=session.unknownWrite(peer);main.post(()->pump());return allowed;}
  });
  ((Application)activity.getApplication()).registerActivityLifecycleCallbacks(new Application.ActivityLifecycleCallbacks(){
   public void onActivityResumed(Activity a){foreground.add(a);}
   public void onActivityStopped(Activity a){foreground.remove(a);if(foreground.isEmpty()&&!TaskAttention.background()&&!session.restoring()&&(session.working()||session.phase().equals("HELD")))session.fault("App进入后台；卡片停止接收答案，封存后恢复设置");}
   public void onActivityDestroyed(Activity a){foreground.remove(a);}
   public void onActivityCreated(Activity a,Bundle b){}public void onActivityStarted(Activity a){}public void onActivityPaused(Activity a){}public void onActivitySaveInstanceState(Activity a,Bundle b){}
  });
  main.post(poll);
 }
 static void init(Activity activity){main();if(instance==null)try{instance=new HeadGestureRuntime(activity);}catch(IOException unavailable){/* No guard instance means no actionable task card. */}}
 static boolean begin(String owner,Listener callback){return begin(owner,callback,false);}
 /** keepGestures: hold the wearer's current nod/shake setting instead of turning it off (confirm cards only). */
 static boolean begin(String owner,Listener callback,boolean keepGestures){
  main();HeadGestureRuntime r=instance;if(r==null||!r.session.healthy()||r.session.pending()||r.session.working()||!r.claim())return false;
  Fixed60Session.Link link=Host107Ota.link();if(!r.session.acquire(owner,link.peer,link.generation,now(),keepGestures)){r.releaseLease();return false;}
  r.listener=callback;r.notified="";r.pump();return true;
 }
 static boolean ready(String owner){main();HeadGestureRuntime r=instance;if(r==null||!r.claimed||!r.claim())return false;Fixed60Session.Link link=Host107Ota.link();return r.session.ready(owner,link.peer,link.generation,now());}
 static boolean cardMayShow(String owner){main();HeadGestureRuntime r=instance;if(!ready(owner))return false;Fixed60Session.Link link=Host107Ota.link();return r.session.markCardPossible(owner,link.peer,link.generation,now());}
 static String token(String owner){main();HeadGestureRuntime r=instance;return r==null?"":r.session.token(owner);}
 static boolean extendForPage(String owner){main();HeadGestureRuntime r=instance;if(!ready(owner))return false;Fixed60Session.Link link=Host107Ota.link();return r.session.extendForPage(owner,link.peer,link.generation,now());}
 static boolean permission(String owner,String peer,long generation){HeadGestureRuntime r=instance;return r!=null&&r.available&&r.claimed&&r.session.ready(owner,peer,generation,now());}
 static boolean finishClosed(String owner,CardInputClosure proof){main();HeadGestureRuntime r=instance;if(r==null||!r.claimRestore())return false;if(r.session.owner().equals(owner)&&r.session.restoring())return true;Fixed60Session.Link link=Host107Ota.link();boolean accepted=r.session.releaseInputClosed(owner,link.peer,link.generation,now(),proof);r.pump();return accepted;}
 static boolean finish(String owner,boolean cardExitConfirmed){
  main();HeadGestureRuntime r=instance;if(r==null||!r.claimRestore())return false;if(r.session.owner().equals(owner)&&r.session.restoring())return true;Fixed60Session.Link link=Host107Ota.link();boolean accepted=r.session.release(owner,link.peer,link.generation,now(),cardExitConfirmed);r.pump();return accepted;
 }
 static String status(){HeadGestureRuntime r=instance;return r==null?"头势保护暂不可用":r.session.status();}
 static boolean keepsGestures(){HeadGestureRuntime r=instance;return r!=null&&r.session.keepsGestures();}
 static boolean pending(){HeadGestureRuntime r=instance;return r!=null&&r.session.pending();}
 /** Quiescence only; never claims a lease or changes restoration state. */
 static boolean voiceHandoffReady(){main();HeadGestureRuntime r=instance;return r!=null&&r.session.healthy()&&!r.session.pending()&&!r.session.working()&&!r.session.cardPending()&&!r.claimed&&r.queued.get()==0;}
 static boolean active(String owner){HeadGestureRuntime r=instance;return r!=null&&r.session.active(owner);}
 static boolean claimCleanup(String owner){main();HeadGestureRuntime r=instance;return r!=null&&r.session.owner().equals(owner)&&r.claimRestore();}
 static void check(Activity host){
  main();HeadGestureRuntime r=instance;if(r==null||r.session.pending()||r.session.working()){TaskWorkspace.notice(host,"请先完成当前眼镜操作或设置恢复");return;}
  String owner=FixedPeerHash.of("head-check/"+UUID.randomUUID());r.checkOwner=owner;r.checkStarted=System.currentTimeMillis();r.checkFinishing=false;r.checkPhases.clear();
  if(!begin(owner,(ready,phase)->{r.checkPhases.add(phase);if(ready&&!r.checkFinishing){r.checkFinishing=true;r.main.post(()->finish(owner,false));}r.refreshCheck();})){r.checkOwner="";TaskWorkspace.notice(host,"原眼镜尚未就绪，请稍后检查");return;}
  EditorialUI.Screen screen=new EditorialUI.Screen(host,"交互保护检查");screen.dialog.getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);r.checkView=EditorialUI.text(host,"正在读取原设置、检查临时保护并恢复；本次不发卡或采音。",15,EditorialUI.INK);screen.body.addView(r.checkView);
  screen.dialog.setOnDismissListener(dialog->{r.checkView=null;if(r.session.owner().equals(owner)&&r.session.pending()&&!r.session.cardPending()){r.session.fault("检查页面已退出，正在恢复设置");finish(owner,false);}});
  r.main.postDelayed(()->{if(r.checkOwner.equals(owner)&&r.session.owner().equals(owner)&&r.session.pending()&&!r.session.cardPending()){r.session.fault("检查已到截止时间，保留设置恢复义务");finish(owner,false);r.refreshCheck();}},30000);r.refreshCheck();
 }
 private void refreshCheck(){
  if(checkOwner.isEmpty()||!checkOwner.equals(session.owner()))return;Map<String,Object> facts=BoundedJson.map(session.checkFacts());boolean passed=session.healthy()&&!session.pending()&&Boolean.TRUE.equals(facts.get("off_confirmed"))&&Boolean.TRUE.equals(facts.get("restore_confirmed"))&&!Boolean.TRUE.equals(facts.get("overridden"))&&!Boolean.TRUE.equals(facts.get("uncertain"));
  if(checkView!=null)checkView.setText(passed?"交互保护检查完成，原待办设置已回读恢复。镜片动作效果仍需另行验收。":session.pending()?"交互保护检查或恢复进行中；本次不发卡、不采音。":"检查未通过，问题仍可在手机回答。" );
  String value=new String(WireJson.bytes(WireJson.object("version",ProductInfo.VERSION,"started_at",checkStarted,"check_passed",passed,"states",new ArrayList<>(checkPhases),"facts",facts,"card_or_capture_started",false)),java.nio.charset.StandardCharsets.UTF_8);if(value.equals(checkExport))return;
  try{File dir=app.getExternalFilesDir(null);if(dir!=null){try(FileOutputStream out=new FileOutputStream(new File(dir,"io-agent-head-check.json"))){out.write(value.getBytes(java.nio.charset.StandardCharsets.UTF_8));}checkExport=value;}}catch(IOException ignored){}
 }
 private boolean usable(){return (!foreground.isEmpty()||TaskAttention.background())&&Host107Login.loggedIn()&&!FirmwareQueue.busy()&&!Fixed60OfficialRuntime.pending()&&!OtaController.busy()&&!OfficialOtaBridge.busy();}
 private boolean claim(){if(!session.healthy()||!usable()||!NativeTransfer.acquireMessages(lease))return false;claimed=true;return true;}
 private boolean claimRestore(){Fixed60Session.Link link=Host107Ota.link();if(!session.healthy()||!session.pending()||!session.matchesTarget(link.peer)||FirmwareQueue.busy()||Fixed60OfficialRuntime.pending()||!NativeTransfer.acquireMessages(lease))return false;claimed=true;return true;}
 private void releaseLease(){if(claimed){NativeTransfer.releaseMessages(lease);claimed=false;}}
 private void pump(){
  main();Fixed60Session.Link link=Host107Ota.link();observedGeneration=link.generation;available=usable();session.tick(link.peer,link.generation,now());
  if(claimed&&session.pending()&&!session.matchesTarget(link.peer))releaseLease();
  if(claimed&&!NativeTransfer.acquireMessages(lease)&&(session.working()||session.phase().equals("HELD")))session.fault("其他设备操作已占用；本卡停止接收答案");
  if(!usable()&&!session.restoring()&&(session.working()||session.phase().equals("HELD")))session.fault("设备操作或账号状态变化；不再接收本卡答案");
  if(!session.pending()&&!session.working())releaseLease();
  // One cold-recovery attempt per connection. Failure stays visible and durable, without a retry loop.
  if(session.pending()&&!session.cardPending()&&!session.working()&&session.phase().equals("RECOVERY_PENDING")&&recoveryGeneration!=link.generation&&claimRestore()){
   recoveryGeneration=link.generation;session.recover(link.peer,link.generation,now());
  }
  if(claimed&&(usable()||session.restoring())&&!FirmwareQueue.busy()){
   HeadGestureSession.Emission e=session.next(link.peer,link.generation,now());
   if(e!=null)Host107HeadSettings.send(session,link,e,ok->{session.result(e.ticket,ok,now());pump();});
  }
  String state=session.status();boolean ready=session.ready(session.owner(),link.peer,link.generation,now())&&claimed&&usable();String fingerprint=ready+":"+state;
  if(listener!=null&&!fingerprint.equals(notified)){notified=fingerprint;try{listener.changed(ready,session.phase());}catch(RuntimeException unavailable){listener=null;session.fault("卡片接收方未就绪；保留设置恢复义务");}}
  refreshCheck();
 }
 private final Runnable poll=new Runnable(){public void run(){try{pump();}finally{main.postDelayed(this,250);}}};
 static void observe(String kind,Map<?,?> data){
  HeadGestureRuntime r=instance;if(r==null||data==null||!"messageReceived".equals(kind))return;
  Object raw=data.get("message");if(!(raw instanceof Map))return;Map<?,?> m=(Map<?,?>)raw;if(HostBusiness.id(m.get("businessId"))!=15)return;
  Object peer=m.get("deviceId"),payload=m.get("payload");if(!(peer instanceof String)||((String)peer).length()>256||!(payload instanceof byte[])||((byte[])payload).length>8192)return;
  if(r.queued.incrementAndGet()>16){r.queued.decrementAndGet();r.session.fault("设置事件超过处理上限；卡片权限已撤销");return;}
  String target=(String)peer;byte[] bytes=((byte[])payload).clone();long receivedGeneration=r.observedGeneration;
  r.main.post(()->{try{Fixed60Session.Link link=Host107Ota.link();r.session.tick(link.peer,link.generation,now());r.session.receive(target,receivedGeneration,bytes,now());r.pump();}finally{r.queued.decrementAndGet();}});
 }
}
