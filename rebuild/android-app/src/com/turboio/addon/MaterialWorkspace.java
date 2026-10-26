package com.turboio.addon;
import android.app.*;import android.widget.*;import java.io.*;import java.util.*;import java.time.*;

/** Normal material sync entry. Shows server receipts separately from local queue. */
final class MaterialWorkspace {
 static String label(String code){switch(code){
  case "DAILY_SUMMARY_NOT_READY":return "原厂近期日报中尚无所选日期的 AI 总结，请稍后再试";case "DAILY_SUMMARY_PARTIAL":return "已有日报已同步，部分所选日期尚无可用日报";case "DAILY_SUMMARY_RANGE_UNSUPPORTED":return "原厂日报日期格式发生变化，未上传";case "DAILY_SUMMARY_CHANGED_PENDING":return "日报已更新，正在核对旧版本的同步结果";case "AUDIO_PHONE_ONLY":return "原音只保存在手机，可从资料页导出";
  case "unconfigured":return "尚未配置资料服务器";case "ready":return "资料连接已启用";case "paused":case "MATERIAL_PAUSED":return "同步已暂停，本机队列保留";
  case "OFFICIAL_DELETION_PENDING":return "正在等待原厂完成删除，稍后自动同步";
  case "OFFICIAL_DELETION_HISTORY_UNSUPPORTED":return "这条原厂批量删除记录需要核对，已暂缓同步";
  case "OFFICIAL_DELETION_CHANGED":case "OFFICIAL_DELETION_UNAVAILABLE":case "OFFICIAL_DELETION_STORE_UNAVAILABLE":return "原厂删除状态暂不可用，稍后重试";
  case "syncing":return "正在同步每日 AI 总结…";case "server_stored":return "服务器已确认保存";case "queued":return "资料已保存在本机，等待后续同步";case "no_loaded_sources":return "暂未发现可同步正文，请先在原厂智记中打开记录";
  case "no_day_sources":return "所选日期暂未发现可同步的智记正文";
  case "MATERIAL_AUTO_DEADLINE":return "本轮同步时间较长，队列已保留，稍后自动继续";
  case "MATERIAL_AUTO_UNCERTAIN":case "MATERIAL_AUTO_INVALID":return "自动同步计划需要核对，已有资料保留";
  case "MATERIAL_TRANSFER_UNSUPPORTED":return "服务器尚未启用长资料传输，原文和队列已保留";
  case "MATERIAL_TRANSFER_MISMATCH":return "分块回执不匹配，未标为同步成功，请重试";
  case "MATERIAL_EVENT_TOO_LARGE":return "部分智记超出当前完整传输容量，原文保留、未截断；其他资料已处理";
  case "LIFELOG_CALENDAR_MONTH_INVALID":return "月份无效，请重新选择";
  case "LIFELOG_CALENDAR_TIMEZONE_UNSUPPORTED":return "当前月份发现仅支持北京时间";
  case "MATERIAL_MONTH_SELECTION_STALE":return "账号、连接或同步状态已变化，请重新查找日期";
  case "MATERIAL_CONNECTION_CHANGED":return "资料连接已更新，请重新读取后操作";
  case "LIFELOG_CALENDAR_JSON_INVALID":case "LIFELOG_CALENDAR_ROOT_INVALID":case "LIFELOG_CALENDAR_DATA_INVALID":case "LIFELOG_CALENDAR_ROWS_INVALID":case "LIFELOG_CALENDAR_ROW_INVALID":case "LIFELOG_CALENDAR_DATE_INVALID":case "LIFELOG_CALENDAR_DATE_MONTH_MISMATCH":case "LIFELOG_CALENDAR_DATE_DUPLICATE":case "LIFELOG_CALENDAR_COVERAGE_INCOMPLETE":case "LIFELOG_CALENDAR_HAS_LOG_INVALID":case "LIFELOG_CALENDAR_PAGINATION_UNSUPPORTED":case "LIFELOG_CALENDAR_ACCOUNT_UNSUPPORTED":case "LIFELOG_CALENDAR_DELETION_UNSUPPORTED":case "LIFELOG_CALENDAR_RESPONSE_BUDGET":case "LIFELOG_CALENDAR_LIST_BUDGET":return "本月日期结果尚不能完整核对，已有资料保留，请稍后重试";
  case "LIFELOG_CALENDAR_RESPONSE_REJECTED":return "官方暂未提供本月智记日期，请稍后重试";
  case "LIFELOG_DATE_INVALID":case "LIFELOG_DISCOVERY_DAYS_INVALID":return "日期无效，请重新选择同步日期";
  case "LIFELOG_TIMEZONE_REQUIRED":case "LIFELOG_TIMEZONE_INVALID":return "无法确认日期所在时区，请检查手机日期与时区设置";
  case "LIFELOG_LIST_DATE_MISMATCH":case "LIFELOG_LIST_TIMEZONE_MISMATCH":return "官方返回的日期或时区与所选范围不一致，本次未导入，请稍后重试";
  case "LIFELOG_INVENTORY_CHANGED":case "LIFELOG_LIST_DUPLICATE":case "LIFELOG_LIST_SOURCE_DUPLICATE":return "当天智记正在变化，本次未导入，请稍后重试";
  case "LIFELOG_LIST_PAGINATION_UNSUPPORTED":return "当天记录暂不能完整读取，本次未导入";
  case "LIFELOG_LIST_DELETION_UNSUPPORTED":return "当天有记录状态需要核对，本次未导入，已有资料保留";
  case "LIFELOG_DISCOVERY_BUDGET":case "LIFELOG_LIST_BUDGET":case "LIFELOG_LIST_SOURCE_BUDGET":return "当天资料超出本次读取范围，本次未导入，已有资料保留";
  case "LIFELOG_RESPONSE_REJECTED":return "官方暂未提供当天智记，请稍后重试";
  case "OFFICIAL_LOGIN_REQUIRED":return "请先完成雷鸟账号登录";case "OFFICIAL_ACCOUNT_CHANGED":case "MATERIAL_ACCOUNT_REBIND_REFUSED":return "当前雷鸟账号与资料连接不一致，请核对账号和登记文件";
  case "MATERIAL_LEGACY_CHANGED":case "MATERIAL_LEGACY_CONFIG_CHANGED":return "旧版本中的同步记录或连接有变化，资料已保留，请先核对后再继续同步";
  case "MATERIAL_LEGACY_UNCERTAIN":case "MATERIAL_MIGRATION_CONFLICT":case "MATERIAL_MIGRATION_UNOWNED":case "MATERIAL_MIGRATION_MISSING":return "资料升级尚未确认，原资料已保留，暂不上传";
  case "MATERIAL_IMPORT_EXPIRED":case "AUTH_REQUIRED":case "expired":return "资料凭据或待发事件已到期，请更新连接并核对队列";
  case "LIFELOG_SOURCE_REFRESH_REQUIRED":return "发现正文变化，已暂停发送，等待权威修订核对";
  case "MATERIAL_TEXT_REVISION_REPAIR_REQUIRED":return "旧修订版本需要核对，资料已保留；请联网后重试同步";
  case "LIFELOG_PENDING_REVISION_CHANGED":return "待同步正文已有新修改，旧版本暂不发送，需核对其入库结果";
  case "LIFELOG_SPEAKER_REVIEW_REQUIRED":case "LIFELOG_TEXT_REVIEW_REQUIRED":return "官方更新与已确认更正冲突，保留现有资料，等待核对";
  case "OFFICIAL_AUTH_REQUIRED":return "雷鸟登录已失效，请重新登录后同步";
  case "OFFICIAL_SOURCE_UNAVAILABLE":case "OFFICIAL_SOURCE_TIMEOUT":return "暂时无法读取官方最新正文，已保留本机队列，请稍后重试";
  case "LIFELOG_SOURCE_COVERAGE_CHANGED":return "\u672c\u6b21\u53ea\u8bfb\u5230\u90e8\u5206\u65f6\u95f4\u6bb5\uff0c\u5df2\u4fdd\u7559\u5b8c\u6574\u6b63\u6587\uff0c\u8bf7\u9009\u62e9\u5b8c\u6574\u65e5\u671f\u540e\u91cd\u8bd5";
  case "LIFELOG_FRESH_SOURCE_CONFLICT":case "LIFELOG_FRESH_SOURCE_UNOWNED":return "官方正文或记录归属正在变化，本次未发送，请稍后重试";
  case "OFFICIAL_HOST_UNSUPPORTED":return "当前原厂版本尚未适配正文刷新，资料保留";
  case "FORBIDDEN":case "MATERIAL_WRITE_SCOPE_REQUIRED":return "资料连接缺少写入权限";case "MATERIAL_IDENTITY_MISMATCH":case "MATERIAL_EXPIRY_MISMATCH":return "服务器返回身份与登记文件不一致";
  case "MATERIAL_SCHEMA_UNSUPPORTED":return "服务器暂不支持当前资料格式";case "MATERIAL_CONFIG_SAVE_FAILED":return "连接保存失败，请重试";
  case "MATERIAL_KEY_UNAVAILABLE":case "MATERIAL_CONFIG_INVALID":return "无法读取本机资料连接，请重新登记";
  case "MATERIAL_RENEWAL_LIMIT":return "资料续传次数已达上限，原文和记录保留，请核对连接";
  case "MATERIAL_HISTORY_FULL":case "MATERIAL_STORE_FULL":case "LIFELOG_IMPORT_FULL":case "LIFELOG_REVISION_FULL":return "本机同步记录已满，资料保留，需整理后继续";
  case "LIFELOG_IMPORT_SCAN_INCOMPLETE":case "OFFICIAL_CACHE_CHANGED":return "资料正在变化，本次未导入，请稍后重试";
  case "deletion_sync_disabled":return "旧删除操作已保留，本次同步不再执行";
  case "blocked":return "有资料需要核对，未记为同步成功";case "MATERIAL_IMPORT_UNAVAILABLE":return "未找到资料登记文件";
  default:return "同步暂未完成，请检查网络或连接配置后重试（"+code+"）";
 }}
 static void show(Activity activity){show(activity,()->{});}
 static void show(Activity activity,Runnable returned){AgentUI.Screen screen=new AgentUI.Screen(activity,"资料同步");MaterialRuntime runtime=MaterialRuntime.get(activity);final boolean[] closed={false};final Runnable[] refresh={null};
  MaterialRuntime.Result render=(state,error)->{if(closed[0]||activity.isDestroyed())return;LinearLayout body=screen.body;body.removeAllViews();body.addView(AgentUI.text(activity,label(error.isEmpty()?state.note:error),20,AgentUI.INK));
   body.addView(AgentUI.text(activity,"开启后自动检查原厂近期每日 AI 总结，有更新时同步。当前可读取原厂最近 3 天的日报；音频、逐字转写和位置只留在手机，可在资料页导出。",14,AgentUI.MUTED));
   if(state.config!=null)body.addView(AgentUI.text(activity,state.config.connection.preview(),13,AgentUI.MUTED));
   MaterialSyncSession.Status s=state.status;body.addView(AgentUI.text(activity,"服务器已存版本 "+s.stored+" · 待同步版本 "+s.queued+"\n待核对 "+s.blocked+" · 结果未知 "+s.reconcile+" · 已过期 "+s.expired,16,AgentUI.INK));
   if(s.days>0)body.addView(AgentUI.text(activity,"本次读取每日总结 "+s.discovered+" 份；发现数量不代表服务器已保存数量。",14,AgentUI.MUTED));
   if(s.tooLarge>0)body.addView(AgentUI.text(activity,"超出单条上限 "+s.tooLarge+" 份：未上传、未截断，原文仍在原厂智记",14,AgentUI.MUTED));
   if(s.conflicts+s.unowned+s.invalid>0)body.addView(AgentUI.text(activity,"正文冲突 "+s.conflicts+" · 归属待核对 "+s.unowned+" · 无效响应 "+s.invalid,14,AgentUI.MUTED));
   AgentUI.button(activity,body,"资料连接设置",false,()->configure(activity,runtime,state.config,refresh[0]));
   if(state.config!=null&&state.config.enabled){AgentUI.button(activity,body,"同步一次",true,()->{body.addView(AgentUI.text(activity,"正在同步，可随时暂停。",14,AgentUI.MUTED));runtime.sync((done,code)->{if(!closed[0])renderResult(activity,code,refresh[0]);});});AgentUI.button(activity,body,"按日期同步",false,()->selectDay(activity,runtime,state.config,()->body.addView(AgentUI.text(activity,"正在按日期同步…",14,AgentUI.MUTED)),()->{if(!closed[0])refresh[0].run();}));AgentUI.button(activity,body,"暂停同步",false,()->runtime.pause((done,code)->{if(!closed[0])renderResult(activity,code,refresh[0]);}));}
   AgentUI.button(activity,body,"原音与导出",false,()->AudioWorkspace.show(activity,refresh[0]));
   AgentUI.button(activity,body,"刷新状态",false,refresh[0]);
  };
  refresh[0]=()->runtime.read(render);screen.dialog.setOnDismissListener(dialog->{closed[0]=true;runtime.cancelPending();if(!activity.isDestroyed())returned.run();});refresh[0].run();
 }
 private static void renderResult(Activity activity,String code,Runnable refresh){if(!code.isEmpty())AgentUI.notice(activity,label(code));refresh.run();}
 private static void selectDay(Activity activity,MaterialRuntime runtime,MaterialConfig target,Runnable starting,Runnable refresh){
  ZoneId zone=ZoneId.systemDefault();LocalDate today=LocalDate.now(zone);String timezone=zone.getId();
  DatePickerDialog picker=new DatePickerDialog(activity,(view,year,month,day)->{
   if(activity.isDestroyed())return;String date=LocalDate.of(year,month+1,day).toString();
   AgentUI.alert(activity).setTitle("按日期同步每日总结").setMessage("日期："+date+"\n时区："+timezone+"\n\n将该日可读取的 AI 总结同步至已配置资料空间：\n"+target.connection.preview()+"\n\n仅限原厂近期日报中可用的日期；音频和转写不会上传。")
    .setNegativeButton("取消",null).setPositiveButton("开始同步",(dialog,which)->{
     if(activity.isDestroyed())return;starting.run();runtime.syncDay(date,timezone,(done,code)->{if(!activity.isDestroyed())renderResult(activity,code,refresh);});
    }).show();
  },today.getYear(),today.getMonthValue()-1,today.getDayOfMonth());
  picker.setTitle("选择智记日期");picker.show();
 }
 private static byte[] read(InputStream input)throws IOException{try(InputStream in=input){ByteArrayOutputStream bytes=new ByteArrayOutputStream();byte[] block=new byte[2048];int n;while((n=in.read(block))!=-1){if(bytes.size()+n>8192)throw new IOException("MATERIAL_IMPORT_BUDGET");bytes.write(block,0,n);}return bytes.toByteArray();}}
 private static void configure(Activity activity,MaterialRuntime runtime,MaterialConfig saved,Runnable refresh){AgentUI.Screen screen=new AgentUI.Screen(activity,"资料连接设置");TextView info=AgentUI.text(activity,"选择电脑生成的资料登记文件。保存前将核对服务器身份，并绑定当前雷鸟账号。",14,AgentUI.MUTED);screen.body.addView(info);final MaterialConnection[] candidate={null};final boolean[] closed={false};
  java.util.function.Consumer<byte[]> preview=raw->{try{candidate[0]=MaterialConnection.parse(raw,System.currentTimeMillis());info.setText(candidate[0].preview()+"\n尚未保存；服务器身份将在保存时核对。");}catch(Exception failed){candidate[0]=null;info.setText("登记文件无效或已到期，请重新提供。");}finally{Arrays.fill(raw,(byte)0);}};
  AgentUI.button(activity,screen.body,"选择资料登记文件",false,()->TaskFilePicker.pick(activity,uri->{if(closed[0])return;try{InputStream in=activity.getContentResolver().openInputStream(uri);if(in==null)throw new IOException();preview.accept(read(in));}catch(Exception failure){info.setText("无法读取登记文件，请重新选择。");}}));
  AgentUI.button(activity,screen.body,"读取电脑登记文件",false,()->{try{File internal=new File(activity.getFilesDir(),"connection-import/material-connection.json"),external=activity.getExternalFilesDir(null),file=internal.isFile()?internal:external==null?null:new File(external,"connection-import/material-connection.json");if(file==null)throw new IOException();preview.accept(read(new FileInputStream(file)));}catch(Exception missing){info.setText(label("MATERIAL_IMPORT_UNAVAILABLE"));}});
  if(saved!=null)AgentUI.button(activity,screen.body,"读取已保存连接",false,()->preview.accept(saved.connection.encode()));
  CheckBox enabled=new CheckBox(activity);enabled.setText("允许将当前账号的每日 AI 总结同步到此服务器");enabled.setTextColor(AgentUI.INK);screen.body.addView(enabled);
  AgentUI.button(activity,screen.body,"核对并保存",true,()->{if(candidate[0]==null){info.setText("请先读取资料登记文件。");return;}info.setText("正在核对服务器身份…");runtime.configure(candidate[0].encode(),enabled.isChecked(),(state,error)->{refresh.run();if(closed[0])return;if(error.isEmpty()){screen.dialog.dismiss();}else info.setText(label(error));});});
  screen.dialog.setOnDismissListener(dialog->{closed[0]=true;candidate[0]=null;runtime.cancelPending();});
 }
}
