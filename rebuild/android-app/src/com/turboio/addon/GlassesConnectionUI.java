package com.turboio.addon;

import android.app.*;import android.content.*;import android.net.Uri;import android.os.*;import android.provider.Settings;import android.widget.*;import java.util.*;

/** Logged-in device entry. Existing stock connections are observed without reinitialization. */
final class GlassesConnectionUI {
 private interface Action{void run()throws Exception;}
 private static String label(String code){switch(code){
  case "DEVICE_NOT_ENABLED":return "眼镜连接尚未启用";case "DEVICE_READY":return "连接已准备，可以扫描或选择眼镜";
  case "DEVICE_STOCK_SHARED":return "正在复用原厂眼镜连接";
  case "DEVICE_SCANNING":return "正在扫描眼镜…";case "DEVICE_SCAN_STOPPED":return "扫描已结束";
  case "DEVICE_CONNECTING":return "正在连接并核对设备认证";case "DEVICE_DISCONNECTING":return "正在断开连接";
  case "DEVICE_PERMISSION_REQUIRED":return "需要允许附近设备权限，才能寻找和连接眼镜";
  case "DEVICE_BLUETOOTH_UNAVAILABLE":return "此设备没有可用的蓝牙适配器";case "DEVICE_BLUETOOTH_OFF":return "蓝牙已关闭，请先打开蓝牙";
  case "DEVICE_OTHER_OWNER":case "DEVICE_CLOUD_OWNER":return "原厂页面正在管理连接，请关闭它后重试";
  case "DEVICE_BUSY":return "眼镜有正在进行的功能，请先结束当前操作";
  case "DEVICE_SCAN_BUSY":return "已有扫描正在进行，请等待它结束";
  case "DEVICE_SELECTION_INVALID":case "DEVICE_SELECTION_STALE":return "这副眼镜已不在当前列表，请重新扫描";
  case "DEVICE_ALREADY_CONNECTED":return "这副眼镜已经连接";case "DEVICE_OTHER_CONNECTED":return "已有另一副眼镜连接，请先断开它";
  case "DEVICE_DISCONNECT_FIRST":return "请先断开眼镜，再停用连接";
  case "DEVICE_BINDING_MISMATCH":return "这副眼镜的绑定状态已变化，请重新核对后连接";
  case "DEVICE_CONNECT_FAILED":return "连接未能开始，请核对眼镜状态后重试";case "DEVICE_DISCONNECT_FAILED":return "断开请求未能开始，请重新核对状态";
  case "DEVICE_SCAN_FAILED":return "扫描未能开始，请检查蓝牙和附近设备权限";
  case "DEVICE_SERVICE_UNAVAILABLE":return "系统未允许连接服务启动，请回到此页面后重试";
  case "DEVICE_SETTINGS_UNAVAILABLE":return "连接设置未能保存，请重试";
  default:return "设备连接暂不可用，请检查权限或重新打开此页面";
 }}
 static void show(Activity activity){
  AgentUI.Screen screen=new AgentUI.Screen(activity,"眼镜连接");GlassesConnection connection=Host107Connection.get(activity);Handler main=new Handler(Looper.getMainLooper());
  final boolean[] closed={false};final String[] error={""},previous={""};final Runnable[] update={null};
  java.util.function.Consumer<Action> action=work->{try{work.run();error[0]="";}catch(Exception failure){error[0]=label(failure.getMessage());}previous[0]="";update[0].run();};
  update[0]=()->{
   if(closed[0]||activity.isFinishing()||activity.isDestroyed())return;
   GlassesConnection.Snapshot state=connection.snapshot();StringBuilder key=new StringBuilder(state.note).append(state.enabled).append(state.owned).append(state.shared).append(state.scanning).append(error[0]).append(GlassesPermission.missing(activity).length).append(FirmwareQueue.busy());
   for(GlassesConnection.Peer p:state.peers)key.append(p.id).append(p.name).append(p.ble).append(p.spp).append(p.bond).append(p.connected);
   if(previous[0].equals(key.toString()))return;previous[0]=key.toString();LinearLayout body=screen.body;ScrollView scroll=(ScrollView)body.getParent();int position=scroll.getScrollY();body.removeAllViews();
   AgentUI.summary(activity,body,"glasses",error[0].isEmpty()?label(state.note):error[0],state.shared?"连接由原厂底座管理":"连接状态与附近设备");AgentUI.gap(activity,body,16);
   body.addView(AgentUI.text(activity,state.shared?"原厂页面负责连接与配对，这里同步显示状态。状态读取不会重新配对或发送固件。":"登录后使用原厂底座连接眼镜，连接成功后仍需通过设备认证。",14,AgentUI.MUTED));
   boolean firmware=FirmwareQueue.busy();if(firmware)body.addView(AgentUI.text(activity,"升级结果待核对，普通连接操作暂不可用。请回固件升级页恢复原眼镜连接。",15,AgentUI.INK));
   if(GlassesPermission.missing(activity).length>0)AgentUI.button(activity,body,"允许附近设备",true,()->GlassesPermission.request(activity,()->{if(!closed[0]&&!FirmwareQueue.busy())action.accept(connection::enable);}));
   else if(!state.owned&&!state.shared&&!firmware)AgentUI.button(activity,body,"启用眼镜连接",true,()->action.accept(connection::enable));
   if(state.owned||state.shared){
    if(state.owned&&!firmware)AgentUI.button(activity,body,state.scanning?"停止扫描":"扫描眼镜（10秒）",true,()->action.accept(state.scanning?connection::stopScan:connection::scan));
    for(GlassesConnection.Peer peer:state.peers){LinearLayout card=AgentUI.card(activity,body);card.addView(AgentUI.text(activity,peer.name.isEmpty()?"眼镜":peer.name,18,AgentUI.INK));card.addView(AgentUI.text(activity,"设备尾号 "+peer.suffix(),13,AgentUI.MUTED));
     card.addView(AgentUI.text(activity,peer.authenticated()?"已连接 · 设备认证通过":peer.connected?"已连接 · 认证尚未完成":"尚未连接",15,AgentUI.INK));
     if(state.owned&&peer.connected&&!firmware)AgentUI.button(activity,card,"断开这副眼镜",false,()->action.accept(()->connection.disconnect(peer.id)));
     else if(state.owned&&!firmware&&(peer.bond.equals("bonded")||peer.bond.equals("unbound")||peer.bond.equals("localBondedNativeUnbound"))){
      boolean pair=!peer.bond.equals("bonded");AgentUI.button(activity,card,pair?"配对并连接":"连接这副眼镜",false,()->AgentUI.alert(activity).setTitle(pair?"配对并连接":"连接眼镜").setMessage((peer.name.isEmpty()?"眼镜":peer.name)+"\n设备尾号 "+peer.suffix()+(pair?"\n请按系统提示完成配对。":"")).setNegativeButton("取消",null).setPositiveButton("连接",(d,w)->{if(!closed[0])action.accept(()->connection.connect(peer.id,pair));}).show());
     }else if(state.owned&&!firmware)card.addView(AgentUI.text(activity,"设备绑定与当前手机不一致，请先核对原厂绑定状态。",14,AgentUI.MUTED));
    }
    if(state.peers.isEmpty())body.addView(AgentUI.text(activity,state.shared?"原厂底座尚未连接眼镜，请在原厂页面连接。":state.scanning?"寻找附近眼镜，请稍候。":"暂未发现眼镜，可以开启扫描。",15,AgentUI.MUTED));
    if(state.owned&&!firmware)AgentUI.button(activity,body,"停用眼镜连接",false,()->action.accept(connection::disable));
   }
   LinearLayout system=AgentUI.section(activity,body,"系统设置");AgentUI.iconRow(activity,system,"bluetooth","系统蓝牙设置",null,null,()->activity.startActivity(new Intent(Settings.ACTION_BLUETOOTH_SETTINGS)));
   AgentUI.divider(activity,system);AgentUI.iconRow(activity,system,"shield-check","应用权限设置",null,null,()->activity.startActivity(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,Uri.parse("package:"+activity.getPackageName()))));
   scroll.post(()->{if(screen.dialog.isShowing())scroll.scrollTo(0,position);});
  };
  Runnable poll=new Runnable(){public void run(){if(closed[0])return;update[0].run();main.postDelayed(this,1000);}};
  Application.ActivityLifecycleCallbacks lifecycle=new Application.ActivityLifecycleCallbacks(){
   public void onActivityStarted(Activity a){if(a==activity&&!closed[0]){main.removeCallbacks(poll);main.post(poll);}}
   public void onActivityStopped(Activity a){if(a==activity)main.removeCallbacks(poll);}
   public void onActivityDestroyed(Activity a){if(a==activity)screen.dialog.dismiss();}
   public void onActivityCreated(Activity a,Bundle b){}public void onActivityResumed(Activity a){}public void onActivityPaused(Activity a){}public void onActivitySaveInstanceState(Activity a,Bundle b){}
  };
  ((Application)activity.getApplication()).registerActivityLifecycleCallbacks(lifecycle);
  screen.dialog.setOnDismissListener(dialog->{closed[0]=true;main.removeCallbacks(poll);((Application)activity.getApplication()).unregisterActivityLifecycleCallbacks(lifecycle);try{connection.stopScan();}catch(Exception ignored){}});update[0].run();main.postDelayed(poll,1000);
 }
}
