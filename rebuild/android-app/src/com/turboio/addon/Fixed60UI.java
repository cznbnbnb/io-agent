package com.turboio.addon;

import android.app.*;import android.os.*;import android.widget.*;

/** Product status, local candidate verification, and separate read-only device checks. */
final class Fixed60UI {
 static void show(Activity activity){
  show(activity,null);
 }
 static void show(Activity activity,Runnable closeWorkspace){
  if(ProductInfo.OFFICIAL_OTA_GUARDED){Fixed60OfficialPreparation.show(activity,closeWorkspace);return;}
  Fixed60Runtime runtime=Fixed60Runtime.get(activity);EditorialUI.Screen screen=new EditorialUI.Screen(activity,"固件升级");
  LinearLayout body=screen.body;Handler main=new Handler(Looper.getMainLooper());boolean[] closed={false};
  body.addView(EditorialUI.text(activity,"一分钟建议卡",25,EditorialUI.INK));
  body.addView(EditorialUI.text(activity,"固定60秒候选 · 适用于 Strix OS 1.0.5.5",14,EditorialUI.MUTED));
  LinearLayout card=EditorialUI.card(activity,body);TextView status=EditorialUI.text(activity,"",18,EditorialUI.INK);card.addView(status);
  TextView detail=EditorialUI.text(activity,"",14,EditorialUI.MUTED);card.addView(detail);
  body.addView(EditorialUI.text(activity,"当前可核对候选包并读取眼镜状态。升级适配验证完成后开放安装；本机校验不会向眼镜发送固件。",14,EditorialUI.MUTED));
  if(ProductInfo.OFFICIAL_OTA_PREPARATION)EditorialUI.button(activity,body,"官方下载与解压（不刷写）",false,()->Fixed60OfficialPreparation.show(activity,()->{screen.dialog.dismiss();if(closeWorkspace!=null)closeWorkspace.run();}));
  TextView picker=EditorialUI.button(activity,body,"选择候选包并核对",true,()->{if(runtime.pending()||runtime.importing())return;DocumentPicker.pick(activity,Fixed60Profile.ZIP_SIZE,bytes->{if(!closed[0])runtime.importPackage(bytes);});});
  TextView inspect=EditorialUI.button(activity,body,"读取眼镜升级状态",false,runtime::inspect);
  TextView[] installControls=new TextView[3];
  if(runtime.writesEnabled()){
   installControls[0]=EditorialUI.button(activity,body,"准备本次升级",false,()->new AlertDialog.Builder(activity).setTitle("核对本次眼镜状态").setMessage("已核对同一眼镜的新鲜启动与空闲状态，其他功能已退出。准备会读取版本、电量、空间和空闲状态，尚不开始安装。").setNegativeButton("返回",null).setPositiveButton("已核对，开始准备",(d,w)->{if(!closed[0])runtime.prepare(true);}).show());
   installControls[1]=EditorialUI.button(activity,body,"授权本次候选",false,()->new AlertDialog.Builder(activity).setTitle("授权本次候选").setMessage("只授权刚核对的固定60秒候选，仍须单独开始安装。保持蓝牙和供电，升级开始后不能当作普通操作取消。").setNegativeButton("取消",null).setPositiveButton("授权",(d,w)->{if(!closed[0])runtime.authorize(Fixed60Profile.ID);}).show());
   installControls[2]=EditorialUI.button(activity,body,"开始本次升级",true,runtime::start);
  }
  TextView cancel=EditorialUI.button(activity,body,"结束状态读取 / 关闭准备",false,runtime::cancel);
  LinearLayout recovery=EditorialUI.card(activity,body);recovery.addView(EditorialUI.text(activity,"上次结果尚未确认",18,EditorialUI.INK));recovery.addView(EditorialUI.text(activity,"等待眼镜自然重启，连接同一副眼镜后核对。计时结束或版本号相同都不代表补丁安装成功。",14,EditorialUI.MUTED));
  TextView wait=EditorialUI.text(activity,"",14,EditorialUI.MUTED);recovery.addView(wait);
  EditorialUI.button(activity,recovery,"准备眼镜连接权限",false,()->GlassesConnectionUI.show(activity));
  TextView reconnect=EditorialUI.button(activity,recovery,"恢复原眼镜连接",false,()->new AlertDialog.Builder(activity).setTitle("只恢复原眼镜连接").setMessage("确认原眼镜已自然重启并回到可操作首页。只使用原有绑定恢复连接认证，不重新配对、不解除升级结果保护，也不重传固件。若仍在更新、黑屏或情况不明，请继续等待。").setNegativeButton("继续等待",null).setPositiveButton("已回首页，恢复连接",(d,w)->{if(!closed[0])runtime.reconnect("已自然重启回首页");}).show());
  EditorialUI.button(activity,recovery,"已自然重启回首页",false,()->new AlertDialog.Builder(activity).setTitle("记录恢复观察").setMessage("只有已亲眼确认同一副眼镜自然重启并回到可操作首页，才记录此项。仍需满足保护等待并单独回读；这不会解锁或发送固件。").setNegativeButton("继续等待",null).setPositiveButton("已回首页",(d,w)->{if(!closed[0])runtime.confirmHome("已回首页");}).show());
  EditorialUI.button(activity,recovery,"只读回查上次结果",false,runtime::readback);
  EditorialUI.button(activity,recovery,"已检查镜片并结束核对",false,()->new AlertDialog.Builder(activity).setTitle("结束本次核对").setMessage("确认同一副眼镜已回首页、功能正常，并检查本次镜片表现。只有新鲜启动和空闲状态回读通过后，才能解除本机结果保护；不会重刷。").setNegativeButton("返回",null).setPositiveButton("已检查镜片",(d,w)->{if(!closed[0])runtime.release("已检查镜片");}).show());
  EditorialUI.button(activity,body,"查看升级诊断",false,()->new AlertDialog.Builder(activity).setTitle("升级诊断").setMessage(runtime.diagnostic()).setPositiveButton("关闭",null).show());
  Runnable update=()->{if(closed[0])return;status.setText(runtime.note());detail.setText((runtime.imported()?"候选包已核对":"候选包尚未载入")+(runtime.battery()<0?"":" · 上次电量 "+runtime.battery()+"%")+"\n"+(runtime.writesEnabled()?"安装受本次授权和预检保护":"安装入口尚未开放"));picker.setEnabled(!runtime.pending()&&!runtime.importing());inspect.setEnabled(!runtime.pending()&&!runtime.importing());cancel.setEnabled(!runtime.pending());recovery.setVisibility(runtime.pending()?android.view.View.VISIBLE:android.view.View.GONE);long seconds=runtime.reconnectWaitSeconds();wait.setText(runtime.reconnecting()?"连接请求进行中，请等待认证结果":seconds>0?"恢复连接保护：至少再等待 "+seconds+" 秒；到时不会自动连接":"等待期已过；仍须确认眼镜实际状态后，手动恢复连接");reconnect.setEnabled(runtime.recoveryEligible()&&!runtime.reconnecting()&&seconds==0);if(installControls[0]!=null){installControls[0].setEnabled(runtime.imported()&&!runtime.pending()&&!runtime.importing()&&(runtime.phase().equals("LOCKED")||runtime.phase().equals("INSPECTED")));installControls[1].setEnabled(runtime.phase().equals("READY"));installControls[2].setEnabled(runtime.phase().equals("AUTHORIZED"));}};
  Runnable poll=new Runnable(){public void run(){if(closed[0])return;runtime.refresh();main.postDelayed(this,1000);}};
  Application.ActivityLifecycleCallbacks lifecycle=new Application.ActivityLifecycleCallbacks(){
   public void onActivityStarted(Activity a){if(a==activity&&!closed[0]){main.removeCallbacks(poll);main.post(poll);}}
   public void onActivityStopped(Activity a){if(a==activity)main.removeCallbacks(poll);}
   public void onActivityDestroyed(Activity a){if(a==activity)screen.dialog.dismiss();}
   public void onActivityCreated(Activity a,Bundle b){}public void onActivityResumed(Activity a){}public void onActivityPaused(Activity a){}public void onActivitySaveInstanceState(Activity a,Bundle b){}
  };
  ((Application)activity.getApplication()).registerActivityLifecycleCallbacks(lifecycle);runtime.listen(update);
  screen.dialog.setOnDismissListener(dialog->{closed[0]=true;main.removeCallbacks(poll);runtime.unlisten(update);((Application)activity.getApplication()).unregisterActivityLifecycleCallbacks(lifecycle);if(!runtime.pending())runtime.cancel();});update.run();main.postDelayed(poll,1000);
 }
}
