package com.turboio.addon;

import android.app.*;import android.widget.*;import java.io.*;import java.time.*;import java.time.format.DateTimeFormatter;import java.util.*;

/** Normal audio-only settings, enabled only after explicit scoped enrollment. */
final class AudioWorkspace {
 static String label(String code){switch(code){
  case "unconfigured":return "尚未配置原音备份";case "ready":return "原音备份已开启";case "paused":case "AUDIO_PAUSED":return "原音备份已暂停，本机原音保留";
  case "AUDIO_CREDENTIAL_EXPIRED":case "AUDIO_AUTH_REQUIRED":return "原音授权已到期或失效，请更新连接";case "AUDIO_SCOPE_REQUIRED":return "此连接未授权原音备份";
  case "AUDIO_MATERIAL_PAUSED":return "请先开启资料同步，再开启原音备份";case "AUDIO_SOURCE_TEXT_NOT_STORED":return "等待对应智记文字同步完成";
  case "AUDIO_SOURCE_TARGET_CHANGED":case "AUDIO_MATERIAL_CHANGED":return "原音与文字连接需要属于同一账号和资料空间，请核对设置";
  case "OFFICIAL_ACCOUNT_CHANGED":case "AUDIO_ACCOUNT_REBIND_REFUSED":return "雷鸟账号已变化，请核对当前账号后重新登记";case "OFFICIAL_LOGIN_REQUIRED":case "OFFICIAL_LOGIN_UNAVAILABLE":return "请先完成雷鸟账号登录";
  case "AUDIO_CONFIG_PENDING":case "AUDIO_CONFIG_CHANGED":case "AUDIO_CONFIG_SAVE_FAILED":return "连接保存尚未完成，备份已停止，请重新保存连接";
  case "AUDIO_CONNECTION_CHANGED":return "连接已更新，请刷新后再操作";
  case "AUDIO_KEY_UNAVAILABLE":case "AUDIO_CONFIG_INVALID":return "无法读取原音连接，请重新登记";
  case "AUDIO_CAPABILITY_UNAVAILABLE":case "AUDIO_IDENTITY_UNAVAILABLE":return "服务器暂未提供原音备份，请稍后重试";
  case "AUDIO_PAYLOAD_BATCH_UNSUPPORTED":case "AUDIO_PAYLOAD_SOURCE_PENDING":case "AUDIO_PAYLOAD_SOURCE_CHANGED":return "部分原音尚待来源或格式核对，本机原件保留";
  case "AUDIO_CAPTURE_NOT_READY":case "AUDIO_CHECKPOINT_BUSY":return "正在等待已保存的原音片段，稍后自动继续";
  case "AUDIO_PAYLOAD_CAPACITY":case "AUDIO_OUTBOX_CAPACITY":case "AUDIO_OUTBOX_FULL":return "本机原音暂存空间不足，已有原件和队列保留";
  default:return "原音备份暂未完成，已有原件保留，请稍后重试";
 }}
 private static String time(long stamp){return Instant.ofEpochMilli(stamp).atZone(ZoneId.systemDefault()).format(DateTimeFormatter.ofPattern("MM-dd HH:mm"));}
 static void show(Activity activity,Runnable returned){AgentUI.Screen screen=new AgentUI.Screen(activity,"原音备份");MaterialRuntime runtime=MaterialRuntime.get(activity);boolean[] closed={false};Runnable[] refresh={null};MaterialRuntime.AudioResult render=(snapshot,error)->{if(closed[0]||activity.isDestroyed())return;screen.body.removeAllViews();AudioConfig config=snapshot==null?null:snapshot.config;String note=error.isEmpty()&&snapshot!=null?snapshot.note:error;screen.body.addView(AgentUI.text(activity,label(note),20,AgentUI.INK));screen.body.addView(AgentUI.text(activity,"已封存并与智记对应的原音会自动备份。每份原音从服务器确认保存起保留三天，重试不会延长。文字和手机导出的文件不会随之删除。",14,AgentUI.MUTED));
  if(config!=null){screen.body.addView(AgentUI.text(activity,config.connection.preview()+"\n授权至 "+time(config.connection.expiresAt),13,AgentUI.MUTED));AudioSyncSession.Status status=snapshot.status;screen.body.addView(AgentUI.text(activity,"远程保留中 "+status.retained+" · 待备份 "+status.queued+"\n待核对 "+status.blocked+" · 已到期 "+status.expired,16,AgentUI.INK));AgentUI.button(activity,screen.body,config.enabled?"暂停原音备份":"恢复原音备份",false,()->runtime.setAudioEnabled(config.fingerprint(),!config.enabled,(value,code)->{if(!closed[0]){if(!code.isEmpty())AgentUI.notice(activity,label(code));refresh[0].run();}}));if(config.enabled)AgentUI.button(activity,screen.body,"备份一次",false,()->runtime.syncAudio((value,code)->{if(!closed[0]){if(!code.isEmpty())AgentUI.notice(activity,label(code));refresh[0].run();}}));}
  AgentUI.button(activity,screen.body,"原音连接设置",true,()->configure(activity,runtime,config,refresh[0]));AgentUI.button(activity,screen.body,"刷新状态",false,refresh[0]);screen.body.addView(AgentUI.text(activity,"只备份手机已收到并保存的部分，不代表全天录音完整。没有原音授权时不会上传；暂停资料同步也会停止原音备份。",12,AgentUI.MUTED));};
  refresh[0]=()->runtime.readAudio(render);screen.dialog.setOnDismissListener(dialog->{closed[0]=true;runtime.cancelPending();if(!activity.isDestroyed())returned.run();});refresh[0].run();
 }
 private static byte[] read(InputStream input)throws IOException{try(InputStream in=input){ByteArrayOutputStream out=new ByteArrayOutputStream();byte[] buffer=new byte[2048];int count;while((count=in.read(buffer))!=-1){if(out.size()+count>8192)throw new IOException("AUDIO_CONNECTION_INVALID");out.write(buffer,0,count);}return out.toByteArray();}}
 private static void configure(Activity activity,MaterialRuntime runtime,AudioConfig saved,Runnable returned){AgentUI.Screen screen=new AgentUI.Screen(activity,"原音连接设置");TextView info=AgentUI.text(activity,"选择单独授权的原音登记文件，使用与文字同步相同的资料空间。保存前会核对服务器原音权限并绑定当前雷鸟账号。",14,AgentUI.MUTED);screen.body.addView(info);AudioConnection[] candidate={null};boolean[] closed={false};java.util.function.Consumer<byte[]> preview=raw->{try{candidate[0]=AudioConnection.parse(raw,System.currentTimeMillis());info.setText(candidate[0].preview()+"\n授权至 "+time(candidate[0].expiresAt)+"\n尚未保存。");}catch(Exception invalid){candidate[0]=null;info.setText("原音登记文件无效或已到期，请重新提供。");}finally{Arrays.fill(raw,(byte)0);}};
  AgentUI.button(activity,screen.body,"选择原音登记文件",false,()->TaskFilePicker.pick(activity,uri->{if(closed[0])return;try{InputStream in=activity.getContentResolver().openInputStream(uri);if(in==null)throw new IOException();preview.accept(read(in));}catch(Exception failure){info.setText("无法读取原音登记文件，请重新选择。");}}));
  AgentUI.button(activity,screen.body,"读取电脑登记文件",false,()->{try{File internal=new File(activity.getFilesDir(),"connection-import/audio-connection.json"),external=activity.getExternalFilesDir(null),file=internal.isFile()?internal:external==null?null:new File(external,"connection-import/audio-connection.json");if(file==null)throw new IOException();preview.accept(read(new FileInputStream(file)));}catch(Exception failure){info.setText("未找到电脑提供的原音登记文件。");}});
  if(saved!=null)AgentUI.button(activity,screen.body,"读取已保存连接",false,()->preview.accept(saved.connection.encode()));CheckBox enabled=new CheckBox(activity);enabled.setText("允许将当前账号已保存的智记原音备份到此服务器");enabled.setTextColor(AgentUI.INK);screen.body.addView(enabled);
  AgentUI.button(activity,screen.body,"核对并保存",true,()->{if(candidate[0]==null){info.setText("请先读取原音登记文件。");return;}info.setText("正在核对原音授权…");runtime.configureAudio(candidate[0].encode(),enabled.isChecked(),(value,error)->{if(closed[0])return;if(error.isEmpty()){screen.dialog.dismiss();}else info.setText(label(error));});});screen.dialog.setOnDismissListener(dialog->{closed[0]=true;candidate[0]=null;runtime.cancelPending();if(!activity.isDestroyed())returned.run();});
 }
}
