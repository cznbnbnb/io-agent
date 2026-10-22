package com.turboio.addon;

import android.app.Activity;
import android.app.AlertDialog;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.view.View;

/** Our product entry; vendor functions keep their original screens and lifecycle. */
final class AgentWorkspace {
 static EditorialUI.Screen show(Activity activity){
  EditorialUI.Screen screen=new EditorialUI.Screen(activity,"iO Agent");
  LinearLayout body=screen.body;
  body.addView(EditorialUI.text(activity,"眼镜 · 手机 · 电脑",27,EditorialUI.INK));
  EditorialUI.gap(activity,body,8);
  body.addView(EditorialUI.text(activity,"把电脑任务带到眼前。",15,EditorialUI.MUTED));
  LinearLayout connection=EditorialUI.card(activity,body);
  Host107Connection device=Host107Connection.get(activity);
  TextView connected=EditorialUI.text(activity,"",19,EditorialUI.INK);connection.addView(connected);
  Runnable update=()->connected.setText(NativeTransfer.connected().isEmpty()?"眼镜尚未连接":"已连接眼镜");update.run();device.listen(update);
  screen.root.addOnAttachStateChangeListener(new View.OnAttachStateChangeListener(){public void onViewAttachedToWindow(View v){}public void onViewDetachedFromWindow(View v){device.unlisten(update);}});
  connection.addView(EditorialUI.text(activity,"已通过账号入口，设备连接使用原厂底座。",14,EditorialUI.MUTED));
  EditorialUI.button(activity,connection,"眼镜连接",false,()->GlassesConnectionUI.show(activity));
  EditorialUI.button(activity,body,"电脑任务",true,()->TaskWorkspace.show(activity));
  EditorialUI.button(activity,body,"资料同步",false,()->MaterialWorkspace.show(activity));
  EditorialUI.button(activity,body,"眼镜任务卡",false,()->AgentCardRuntime.show(activity));
  EditorialUI.button(activity,body,"原有工具与资料",false,()->EditorialUI.home(activity));
  EditorialUI.button(activity,body,"账号与云服务",false,()->{try{Host107Connection.openCloud(activity);}catch(Exception failure){EditorialUI.notice(activity,"当前连接正在操作，请结束后再打开原厂页面。");}});
  EditorialUI.button(activity,body,"固件升级状态",false,()->Fixed60UI.show(activity,screen.dialog::dismiss));
  EditorialUI.button(activity,body,"一分钟任务卡测试",false,()->MinuteCardRuntime.show(activity));
  EditorialUI.button(activity,body,"诊断",false,()->new AlertDialog.Builder(activity).setTitle("连接诊断").setMessage("iO Agent Android "+ProductInfo.VERSION+"\n官方宿主 1.0.7（230）\n"+(NativeTransfer.connected().isEmpty()?"未连接":"已连接")+"\n"+TurboAddon.status()).setPositiveButton("关闭",null).show());
  return screen;
 }
}
