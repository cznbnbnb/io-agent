package com.turboio.addon;

import android.app.*;import android.os.*;import android.widget.*;
import java.io.*;import java.util.*;import java.nio.charset.StandardCharsets;
import java.util.concurrent.*;

/** Reuses vendor download/extraction; optional guarded installation is owned by the runtime. */
final class Fixed60OfficialPreparation {
 private static Fixed60OfficialPreparation instance;
 private final Application app;private final Handler main=new Handler(Looper.getMainLooper());
 private final Set<Activity> foreground=Collections.newSetFromMap(new WeakHashMap<Activity,Boolean>());
 private Fixed60OfficialFeed feed;private volatile boolean available;private volatile long generation;private String peerHash="";
 private final ExecutorService verifier=Executors.newSingleThreadExecutor(r->{Thread t=new Thread(r,"iO-official-fixed60-verify");t.setDaemon(true);return t;});
 private String note="尚未开放候选下载",directory="官方准备目录：尚未核对",lastExport="";
 private boolean verifying,directoryVerified;
 private Fixed60OfficialPreparation(Activity host){
  app=(Application)host.getApplication();foreground.add(host);
  try{feed=new Fixed60OfficialFeed(SystemClock::elapsedRealtime,()->available&&(!FirmwareQueue.busy()||Fixed60OfficialRuntime.sourceCompatible()),ProductInfo.OFFICIAL_OTA_GUARDED);feed.start(18794);}
  catch(IOException unavailable){feed=null;note="本机更新源无法启动，保持禁止安装";}
  app.registerActivityLifecycleCallbacks(new Application.ActivityLifecycleCallbacks(){
   public void onActivityResumed(Activity a){foreground.add(a);}
   public void onActivityStopped(Activity a){foreground.remove(a);if(foreground.isEmpty())disarm("已离开App，候选下载来源已关闭");}
   public void onActivityDestroyed(Activity a){foreground.remove(a);if(foreground.isEmpty())disarm("页面已关闭，候选下载来源已关闭");}
   public void onActivityCreated(Activity a,Bundle b){}public void onActivityStarted(Activity a){}public void onActivityPaused(Activity a){}public void onActivitySaveInstanceState(Activity a,Bundle b){}
  });
  main.post(new Runnable(){public void run(){
   if(feed!=null&&feed.armed())try{if(!safe()||!peerHash.equals(hashPeer()))disarm("账号、连接或占用已变化，候选下载来源已关闭");}catch(Exception invalid){disarm("连接状态不能确认，候选下载来源已关闭");}
   exportStatus();main.postDelayed(this,1000);
  }});
 }
 static void init(Activity host){if((ProductInfo.OFFICIAL_OTA_PREPARATION||ProductInfo.OFFICIAL_OTA_GUARDED)&&instance==null)instance=new Fixed60OfficialPreparation(host);}
 private boolean safe(){if(!(ProductInfo.OFFICIAL_OTA_PREPARATION||ProductInfo.OFFICIAL_OTA_GUARDED)||ProductInfo.OTA_WRITES_ENABLED||foreground.isEmpty()||FirmwareQueue.busy()&&!Fixed60OfficialRuntime.sourceCompatible()||Fixed60Runtime.get(app).pending()||OtaController.critical()||OfficialOtaBridge.busy()||!Host107Login.loggedIn())return false;String peer=Host107Connection.otaPeer();return peer!=null&&!peer.isEmpty();}
 private String hashPeer(){String peer=Host107Connection.otaPeer();return peer==null||peer.isEmpty()?"":Fixed60Session.peerHash(peer);}
 private void disarm(String reason){available=false;generation++;verifying=false;peerHash="";if(feed!=null)feed.disarm();note=reason;}
 private void load(byte[] zip){
  disarm("正在核对固定候选，尚未开放下载");directoryVerified=false;directory="官方准备目录：本次尚未核对";
  if(feed==null||!safe()){note="请先登录并连接原眼镜，结束其他操作后再选择候选";return;}
  available=true;peerHash=hashPeer();if(peerHash.isEmpty()){disarm("设备认证尚未完成，未开放下载");return;}
  verifying=true;long epoch=++generation;
  verifier.execute(()->{if(epoch!=generation)return;boolean ok=false;try{feed.arm(zip);ok=true;}catch(Exception invalid){}final boolean accepted=ok;
   main.post(()->{if(epoch!=generation)return;verifying=false;if(!accepted||!safe()||!peerHash.equals(hashPeer())){disarm("候选或当前连接校验未通过，未开放下载");return;}note="固定候选已核对；请在原厂页面检测并下载，安装需另行授权";});
  });
 }
 private void checkDirectory(){
  if(verifying){note="候选仍在核对，请稍候";return;}long epoch=generation;directory="官方准备目录：只读核对中";directoryVerified=false;
  new Thread(()->{File root=app.getFilesDir();File[] dirs={new File(root,"ota/Strix_OS_1.0.5.5"),new File(root.getParentFile(),"app_flutter/ota/Strix_OS_1.0.5.5")};int found=0,valid=0;
   for(File d:dirs)if(d.exists()){found++;try{Fixed60Firmware.freezeDirectory(d.toPath());valid++;}catch(IOException invalid){}}
   final int seen=found,matched=valid;main.post(()->{if(epoch!=generation)return;directoryVerified=seen==1&&matched==1;directory=directoryVerified?"官方准备目录：16/16成员固定摘要通过；未向眼镜发送":"官方准备目录：发现 "+seen+" 处，匹配 "+matched+" 处；尚未确认唯一候选";exportStatus();});
  },"iO-official-fixed60-directory").start();
 }
 private String status(){return "官方升级准备 · Strix OS 1.0.5.5\n"+note+"\n"+(feed==null?"本机更新源未启动":feed.status())+"\n"+directory+"\n"+(ProductInfo.OFFICIAL_OTA_GUARDED?"固件发送由单次授权保护":"固件写入：锁定")+"\n\n"+Fixed60OfficialRuntime.status();}
 private void exportStatus(){try{String text=status();if(text.equals(lastExport))return;File root=app.getExternalFilesDir(null);if(root==null)return;File tmp=new File(root,"io-agent-official-preparation-status.tmp"),out=new File(root,"io-agent-official-preparation-status.txt");try(FileOutputStream f=new FileOutputStream(tmp)){f.write(text.getBytes(StandardCharsets.UTF_8));f.getFD().sync();}if(tmp.renameTo(out))lastExport=text;}catch(IOException ignored){}}
 static void show(Activity host,Runnable returnToOfficial){
  init(host);Fixed60OfficialPreparation runtime=instance;if(runtime==null)return;
  EditorialUI.Screen screen=new EditorialUI.Screen(host,ProductInfo.OFFICIAL_OTA_GUARDED?"官方升级":"官方下载与解压");
  screen.body.addView(EditorialUI.text(host,ProductInfo.OFFICIAL_OTA_GUARDED?"原厂负责下载、解压及安装。先只读预检，再单独授权一次；授权不会自动开始。":"由原厂App检测、下载并解压固定一分钟候选。本批不能安装到眼镜。",16,EditorialUI.INK));
  TextView status=EditorialUI.text(host,runtime.status(),14,EditorialUI.MUTED);
  EditorialUI.button(host,screen.body,"选择固定候选，开放15分钟下载",true,()->DocumentPicker.pick(host,Fixed60Profile.ZIP_SIZE,zip->{if(screen.dialog.isShowing())runtime.load(zip);}));
  EditorialUI.button(host,screen.body,"返回原厂App检测更新",false,()->{screen.dialog.dismiss();if(returnToOfficial!=null)returnToOfficial.run();});
  EditorialUI.button(host,screen.body,"下载后核对解压目录",false,runtime::checkDirectory);
  EditorialUI.button(host,screen.body,"关闭候选下载来源",false,()->runtime.disarm("下载来源已关闭；升级状态以本次授权及结果保护为准"));
  EditorialUI.button(host,screen.body,ProductInfo.OFFICIAL_OTA_GUARDED?"官方安装前预检（不授权）":"官方安装前预检（禁止刷写）",false,()->Fixed60OfficialRuntime.begin(host));
  TextView authorize=ProductInfo.OFFICIAL_OTA_GUARDED?EditorialUI.button(host,screen.body,"允许一次官方安装",true,()->Fixed60OfficialRuntime.authorization(host)):null;
  EditorialUI.button(host,screen.body,ProductInfo.OFFICIAL_OTA_GUARDED?"撤销未使用授权 / 结束预检":"结束官方只读预检",false,Fixed60OfficialRuntime::end);
  if(ProductInfo.OFFICIAL_OTA_GUARDED){
   EditorialUI.button(host,screen.body,"已自然重启回首页",false,()->Fixed60OfficialRuntime.home(host));
   EditorialUI.button(host,screen.body,"只读回查本次结果",false,Fixed60OfficialRuntime::readback);
   EditorialUI.button(host,screen.body,"已检查镜片并结束核对",false,()->Fixed60OfficialRuntime.release(host));
  }
  screen.body.addView(status);
  Handler main=new Handler(Looper.getMainLooper());Runnable tick=new Runnable(){public void run(){if(!screen.dialog.isShowing())return;status.setText(runtime.status());if(authorize!=null)authorize.setEnabled(Fixed60OfficialRuntime.canAuthorize());main.postDelayed(this,500);}};main.post(tick);screen.dialog.setOnDismissListener(d->main.removeCallbacks(tick));
 }
}
