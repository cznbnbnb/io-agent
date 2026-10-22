package com.turboio.addon;

import android.app.*;import android.content.*;import android.os.*;
import java.io.*;import java.util.*;

/** Main-thread session owner; only immutable firmware verification runs off-thread. */
final class Fixed60Runtime {
 private static Fixed60Runtime instance;
 private final Context app;private final Handler main=new Handler(Looper.getMainLooper());
 private final Object queueOwner=new Object();private final String lease="fixed60-"+UUID.randomUUID();
 private final Set<Runnable> listeners=new LinkedHashSet<>();private final Set<Activity> foreground=Collections.newSetFromMap(new WeakHashMap<Activity,Boolean>());
 private Fixed60Journal journal;private Fixed60Session session;private Fixed60Firmware firmware;
 private boolean importing,blocked,sending,claimed,serviceOwned,reconnecting;private long generation,importGeneration,reconnectDeadline;
 private String note="尚未核对候选包",fingerprint="",serviceToken="";private long inspectedAt;private Fixed60Session.State settledState;
 private Fixed60Runtime(Context context){
  app=context.getApplicationContext();
  try{journal=new Fixed60Journal(new File(app.getFilesDir(),"io-fixed60-ota-v1.json"));session=new Fixed60Session(null,journal,now());
   if(session.pending()){FirmwareQueue.acquire(queueOwner,session.expectedPeerHash());note="上次升级结果尚未确认，请先恢复核对";main.post(tick);}
  }catch(Exception failure){blocked=true;FirmwareQueue.acquire(queueOwner);note="升级保护记录不可读取，保持锁定";}
  ((Application)app).registerActivityLifecycleCallbacks(new Application.ActivityLifecycleCallbacks(){
   public void onActivityResumed(Activity activity){foreground.add(activity);schedule();}
   public void onActivityStopped(Activity activity){foreground.remove(activity);background();}
   public void onActivityDestroyed(Activity activity){foreground.remove(activity);background();}
   public void onActivityCreated(Activity a,Bundle b){}public void onActivityStarted(Activity a){}public void onActivityPaused(Activity a){}public void onActivitySaveInstanceState(Activity a,Bundle b){}
  });
 }
 static Fixed60Runtime get(Context context){requireMain();if(instance==null)instance=new Fixed60Runtime(context);if(context instanceof Activity)instance.foreground.add((Activity)context);return instance;}
 static boolean ownsLease(String value){return instance!=null&&instance.lease.equals(value);}
 private static void requireMain(){if(Looper.myLooper()!=Looper.getMainLooper())throw new IllegalStateException("OTA_THREAD");}
 private static long now(){return SystemClock.elapsedRealtime();}
 boolean pending(){return blocked||session!=null&&session.pending();}boolean imported(){return firmware!=null;}boolean importing(){return importing;}
 String note(){return note;}String phase(){return blocked?"BLOCKED":session==null?"LOCKED":session.state().name();}
 int battery(){return session==null?-1:session.battery();}int covered(){return session==null?0:session.coveredBytes();}
 boolean writesEnabled(){return ProductInfo.OTA_WRITES_ENABLED;}
 long reconnectWaitSeconds(){return session==null?120:(session.reconnectWait(now())+999)/1000;}
 boolean reconnecting(){return reconnecting;}
 boolean recoveryEligible(){return !blocked&&session!=null&&session.recoveryState();}
 String diagnostic(){return "候选 "+Fixed60Profile.ID+"\n固件 "+Fixed60Profile.VERSION+"\n阶段 "+phase()+"\n"+note+"\n当前原因 "+(session==null?"":session.reason())+"\n首次失败 "+(session==null?"":session.firstFailure())+"\n请求 "+(session==null?0:session.requests())+" · SDK确认 "+(session==null?0:session.confirmedMessages())+"\n确认覆盖 "+covered()+" / 16824141 字节\n写入入口 "+(writesEnabled()?"受控开启":"锁定")+"\n上次读取 "+(inspectedAt==0?"尚无":new java.text.SimpleDateFormat("HH:mm:ss",Locale.ROOT).format(new Date(inspectedAt)))+"\nZIP SHA-256 "+Fixed60Profile.ZIP_SHA;}
 void listen(Runnable update){requireMain();listeners.add(update);}void unlisten(Runnable update){requireMain();listeners.remove(update);}
 private void changed(){String value=note+phase()+importing+imported()+reconnecting+battery()+covered()+reconnectWaitSeconds();if(value.equals(fingerprint))return;fingerprint=value;for(Runnable update:new ArrayList<>(listeners))try{update.run();}catch(RuntimeException ignored){}}
 private boolean active(){if(session==null)return false;switch(session.state()){case LOCKED:case INSPECTED:case UNKNOWN:case INSTALLING:case READBACK:return false;default:return true;}}
 private boolean readingRecovery(){return session!=null&&(session.state()==Fixed60Session.State.READ_VERSION||session.state()==Fixed60Session.State.READ_IDLE);}
 private void schedule(){main.removeCallbacks(tick);if(!blocked&&session!=null&&((!foreground.isEmpty()&&(claimed||pending()))||(active()&&serviceOwned)))main.postDelayed(tick,active()?250:1000);}
 private void background(){
  if(!foreground.isEmpty())return;
  if(!pending()){importGeneration++;importing=false;if(claimed)cancel();}
  else{if(reconnecting){reconnecting=false;note="连接请求结果尚未核对，回前台后检查；保护保持";}if(readingRecovery())abort("RECOVERY_LEFT_FOREGROUND");else if(active()&&!serviceOwned)abort("OTA_SERVICE_LOST");}
  schedule();
 }
 void importPackage(byte[] bytes){
  requireMain();if(blocked||pending()||claimed||importing){note="当前操作尚未结束，未替换候选包";changed();return;}
  firmware=null;importing=true;long token=++importGeneration;note="正在本机核对候选包…";changed();
  new Thread(()->{Fixed60Firmware checked=null;try{checked=Fixed60Firmware.verify(bytes);}catch(Exception ignored){}Fixed60Firmware result=checked;
   main.post(()->{if(token!=importGeneration)return;importing=false;if(pending()||claimed)return;firmware=result;
    try{session=new Fixed60Session(firmware,journal,now());note=result==null?"候选包不匹配，未载入、未发送":"候选包核对通过；尚未发送到眼镜";}
    catch(Exception failure){blocked=true;FirmwareQueue.acquire(queueOwner);note="保护记录不可读取，保持锁定";}
    changed();});
  },"iO-fixed60-verify").start();
 }
 private boolean acquire(){
  if(blocked||session==null||importing||foreground.isEmpty()){note="请回到升级页面完成当前操作";return false;}
  Fixed60Session.Link link=Host107Ota.link();if(link.peer==null||link.peer.isEmpty()){note="请先连接眼镜并完成设备认证";return false;}
  if(!NativeTransfer.acquireFirmwareMessages(lease)){note="眼镜有其他操作，请先结束后重试";return false;}
  if(!FirmwareQueue.acquire(queueOwner,Fixed60Session.peerHash(link.peer))){NativeTransfer.releaseMessages(lease);note="其他升级或原设备保护正在使用连接";return false;}
  claimed=true;Host107Ota.receive(new Host107Ota.Receiver(){
   public void receive(String peer,byte[] bytes){if(session!=null&&peer.equals(session.peer())){session.receive(Host107Ota.link(),bytes,now());pump();}}
   public void fault(String reason){abort(reason);}
  });return true;
 }
 void inspect(){requireMain();if(pending()||claimed){note="有待核对的操作，请先处理恢复状态";changed();return;}if(acquire())try{session.inspect(Host107Ota.link(),now());note="读取版本、电量和空闲状态…";pump();}catch(RuntimeException failure){abort("INSPECT_REJECTED");}else changed();}
 void prepare(boolean freshBootObserved){requireMain();if(!writesEnabled()){note="升级适配验证尚未完成，写入入口锁定";changed();return;}if(!imported()||pending()||claimed){note="请先核对候选包及上次操作结果";changed();return;}if(acquire())try{session.prepare(Host107Ota.link(),freshBootObserved,now());pump();}catch(RuntimeException failure){abort("PREPARE_REJECTED");}else changed();}
 void authorize(String candidate){requireMain();try{if(!writesEnabled()||foreground.isEmpty())throw new IllegalStateException();session.authorize(candidate,Host107Ota.link(),now());note="本次候选已授权，尚未开始";}catch(RuntimeException failure){note="授权条件未满足，未开始升级";}changed();}
 void start(){
  requireMain();if(!writesEnabled()||foreground.isEmpty()||session==null||!claimed){note="当前不能开始升级，未发送";changed();return;}
  if(!serviceOwned||!OtaService.alive()){try{if(!serviceOwned)serviceToken=UUID.randomUUID().toString();serviceOwned=true;app.startForegroundService(new Intent(app,OtaService.class).putExtra("io_fixed60_lease",serviceToken));note="升级服务正在准备，请就绪后再次开始";}catch(RuntimeException failure){serviceOwned=false;serviceToken="";note="升级服务未能启动，未发送";}changed();return;}
  try{session.start(Host107Ota.link(),now(),System.currentTimeMillis());note="升级开始；保持蓝牙与供电";pump();}catch(Exception failure){note="开始条件或保护记录未通过，未重试";settle();}
 }
 void cancel(){requireMain();if(pending()){note="升级结果待核对，不能作为普通操作取消";changed();return;}importGeneration++;importing=false;if(session!=null)session.cancel(now());releaseTransport();note="准备已关闭，未开始升级";changed();}
 void confirmHome(String assertion){requireMain();if(session!=null&&session.confirmHome(assertion,Host107Ota.link(),now()))note="回首页确认已记录，仍需单独回读";else note="恢复确认条件尚未满足，请继续等待并核对同一眼镜";changed();}
 void reconnect(String assertion){
  requireMain();if(blocked||session==null||foreground.isEmpty()||reconnecting){note="当前不能开始恢复连接，保护保持";changed();return;}
  try{Fixed60Session.ReconnectPermit permit=session.reconnectPermit(assertion,Host107Ota.link(),now());
   if(!FirmwareQueue.acquire(queueOwner,session.expectedPeerHash())||!NativeTransfer.acquireFirmwareRecovery(lease))throw new IllegalStateException("RECOVERY_OTHER_WORK");
   claimed=true;Host107Connection.reconnectFirmware(permit);reconnecting=true;reconnectDeadline=now()+30000;note="正在恢复原眼镜的连接认证；不会重传固件";schedule();
  }catch(Exception failure){String reason=failure.getMessage();note="RECOVERY_RECONNECT_NOT_READY".equals(reason)?"请先观察自然重启回首页，并等待恢复保护时间结束":"RECOVERY_ORIGINAL_NOT_FOUND".equals(reason)?"未找到原眼镜的已有绑定；不会扫描配对或选择其他设备":"RECOVERY_BOND_REQUIRED".equals(reason)?"原眼镜的绑定已变化；未重新配对，保护保持":"RECOVERY_CONNECTION_IN_PROGRESS".equals(reason)?"连接或认证仍在进行，请等待后核对":"恢复连接未能开始，请检查权限、蓝牙及原绑定；保护保持";}
  changed();
 }
 private void checkReconnect(Fixed60Session.Link link){if(!reconnecting)return;if(session!=null&&session.samePeer(link.peer)){reconnecting=false;note="原眼镜连接认证已恢复，结果保护保持；请确认首页后只读回查";}else if(link.peer!=null&&!link.peer.isEmpty()||now()>=reconnectDeadline){reconnecting=false;note="原眼镜连接未得到确认，保护保持；不会自动重试";}}
 void readback(){requireMain();if(!pending()||blocked){note="当前没有可回读的升级操作";changed();return;}if(acquire())try{session.readback(Host107Ota.link(),now());note="只读取同一眼镜的启动与空闲状态…";pump();}catch(RuntimeException failure){note="恢复保护条件未满足，未发送";settle();}else changed();}
 void release(String assertion){requireMain();try{session.release(assertion,Host107Ota.link(),now());note="本次结果保护已解除；版本号不证明补丁内容";releaseTransport();}catch(Exception failure){note="检查或保护记录未通过，继续保持锁定";}changed();}
 void refresh(){requireMain();if(session!=null){Fixed60Session.Link link=Host107Ota.link();checkReconnect(link);session.check(link,now());settle();}}
 private void abort(String reason){if(session!=null)session.abort(reason,now());note="操作未完成，请查看诊断及恢复状态";settle();}
 private void pump(){
  if(session==null||blocked)return;Fixed60Session.Link link=Host107Ota.link();checkReconnect(link);session.check(link,now());
  if(session.pending()&&active()&&!readingRecovery()&&(!serviceOwned||!OtaService.alive())){abort("OTA_SERVICE_LOST");return;}settle();
  if(!claimed||sending)return;Fixed60Session.Transmission next=session.take(link,now());if(next==null)return;
  sending=true;long token=generation;Host107Ota.send(queueOwner,link,next.bytes(),ok->{if(token!=generation||session==null)return;sending=false;session.confirmed(next.id,ok,Host107Ota.link(),now());pump();});
 }
 private void settle(){
  if(session==null)return;Fixed60Session.State state=session.state();
  if(state==Fixed60Session.State.LOCKED||state==Fixed60Session.State.INSPECTED){if(state==Fixed60Session.State.INSPECTED){if(claimed)inspectedAt=System.currentTimeMillis();note="版本、电量和空闲状态读取通过；未开始升级";}else if(!session.reason().isEmpty())note=session.reason().equals("CONNECTION_CHANGED")?"眼镜连接已变化，请重新读取状态":session.reason().equals("VERSION_MISMATCH")?"眼镜固件版本不匹配，未开始升级":session.reason().equals("PREPARATION_CANCELLED")?"准备已关闭，未开始升级":"状态读取或准备未完成，请核对连接后重试";releaseTransport();}
  if(state==Fixed60Session.State.UNKNOWN){if(sending||settledState!=state)generation++;sending=false;firmware=null;Host107Ota.receive(null);finishService();}
  if(state==Fixed60Session.State.INSTALLING){firmware=null;sending=false;if(settledState!=state)note="眼镜报告进入安装，等待自然重启；尚未证明安装成功";finishService();}
  if(state==Fixed60Session.State.READBACK){note="同一眼镜启动与空闲状态已回读，仍需检查镜片";finishService();}
  settledState=state;schedule();changed();
 }
 private void releaseTransport(){generation++;sending=false;claimed=false;Host107Ota.receive(null);NativeTransfer.releaseMessages(lease);if(!pending())FirmwareQueue.release(queueOwner);main.removeCallbacks(tick);if(!pending())finishService();}
 private void finishService(){if(serviceOwned){serviceOwned=false;serviceToken="";OtaService.finish();}}
 private final Runnable tick=new Runnable(){public void run(){pump();}};
 static boolean acceptService(String token){return instance!=null&&instance.serviceOwned&&instance.claimed&&!instance.serviceToken.isEmpty()&&instance.serviceToken.equals(token);}
 static void serviceLost(){if(instance!=null&&instance.serviceOwned&&instance.claimed&&instance.active()&&!instance.readingRecovery())instance.abort("OTA_SERVICE_LOST");}
}
