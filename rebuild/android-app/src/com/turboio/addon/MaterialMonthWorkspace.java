package com.turboio.addon;
import android.app.*;import android.widget.*;import java.time.*;import java.util.*;import java.util.function.BooleanSupplier;

/** Explicit month discovery followed by the existing bounded day sync. */
final class MaterialMonthWorkspace {
 static void show(Activity activity,MaterialRuntime runtime,MaterialConfig target,BooleanSupplier available,Runnable starting,Runnable refresh){
  YearMonth now=YearMonth.now(ZoneId.of("Asia/Shanghai"));LinearLayout fields=new LinearLayout(activity);fields.setOrientation(LinearLayout.HORIZONTAL);
  NumberPicker year=new NumberPicker(activity),month=new NumberPicker(activity);year.setMinValue(1970);year.setMaxValue(9999);year.setValue(now.getYear());year.setWrapSelectorWheel(false);month.setMinValue(1);month.setMaxValue(12);month.setValue(now.getMonthValue());
  year.setContentDescription("年份");month.setContentDescription("月份");fields.addView(year,new LinearLayout.LayoutParams(0,-2,1));fields.addView(month,new LinearLayout.LayoutParams(0,-2,1));
  AlertDialog picker=new AlertDialog.Builder(activity).setTitle("选择智记月份").setMessage("日期按北京时间读取。先查找有智记的日期，再选择最多 7 天同步正文。").setView(fields).setNegativeButton("取消",null).setPositiveButton("查找日期",(dialog,which)->{
   if(activity.isDestroyed()||!available.getAsBoolean())return;fields.clearFocus();String selected=YearMonth.of(year.getValue(),month.getValue()).toString();starting.run();
   runtime.discoverMonth(selected,(found,error)->{
    if(activity.isDestroyed()||!available.getAsBoolean())return;
    if(!error.isEmpty()){AgentUI.notice(activity,MaterialWorkspace.label(error));refresh.run();return;}
    selectDays(activity,runtime,target,found,available,starting,refresh);
   });
  }).create();picker.setOnCancelListener(dialog->runtime.cancelPending());picker.show();
 }
 private static void selectDays(Activity activity,MaterialRuntime runtime,MaterialConfig target,MaterialRuntime.MonthSelection found,BooleanSupplier available,Runnable starting,Runnable refresh){
  if(found.source.dates.isEmpty()){new AlertDialog.Builder(activity).setTitle(found.source.month+" 智记日期").setMessage("本月暂未发现有智记的日期。已有资料保留。").setPositiveButton("返回",(dialog,which)->refresh.run()).setOnCancelListener(dialog->refresh.run()).show();return;}
  String[] dates=found.source.dates.toArray(new String[0]);boolean[] selected=new boolean[dates.length];final AlertDialog[] holder={null};
  // Cancel has no runtime callback, so re-render to clear the "reading" line added when discovery started.
  Runnable cancel=()->{runtime.cancelPending();refresh.run();};
  TextView title=AgentUI.text(activity,found.source.month+" · 北京时间\n选择 1–7 天同步正文至：\n"+target.connection.preview(),16,AgentUI.INK);
  AlertDialog dialog=new AlertDialog.Builder(activity).setCustomTitle(title).setMultiChoiceItems(dates,selected,(choice,index,checked)->{
   int count=0;for(boolean item:selected)if(item)count++;if(count>7){selected[index]=false;((AlertDialog)choice).getListView().setItemChecked(index,false);AgentUI.notice(activity,"每批最多同步 7 天，请分批选择。");count--;}
   if(holder[0]!=null)holder[0].getButton(AlertDialog.BUTTON_POSITIVE).setEnabled(count>0);
  }).setNegativeButton("取消",(choice,which)->cancel.run()).setPositiveButton("同步选中日期",(choice,which)->{
   if(activity.isDestroyed()||!available.getAsBoolean())return;List<String> chosen=new ArrayList<>();for(int i=0;i<dates.length;i++)if(selected[i])chosen.add(dates[i]);
   starting.run();runtime.syncMonthDays(found,chosen,(done,error)->{if(!activity.isDestroyed()&&available.getAsBoolean()){if(!error.isEmpty())AgentUI.notice(activity,MaterialWorkspace.label(error));refresh.run();}});
  }).create();holder[0]=dialog;dialog.setOnCancelListener(choice->cancel.run());dialog.setOnShowListener(choice->dialog.getButton(AlertDialog.BUTTON_POSITIVE).setEnabled(false));dialog.show();
 }
}
