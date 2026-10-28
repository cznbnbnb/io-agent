package com.turboio.addon;

import android.app.*;import android.widget.*;import java.io.*;import java.time.*;import java.time.format.DateTimeFormatter;import java.util.*;

/** Normal audio-only settings, enabled only after explicit scoped enrollment. */
final class AudioWorkspace {
 static String label(String code){switch(code){
  case "unconfigured":return "尚未配置原音备份";case "ready":return "原音备份已开启";case "paused":case "AUDIO_PAUSED":return "原音备份已暂停，本机原音保留";
  case "AUDIO_CREDENTIAL_EXPIRED":case "AUDIO_AUTH_REQUIRED":return "原音授权已到期或失效，请更新连接";case "AUDIO_SCOPE_REQUIRED":return "此连接未授权原音备份";
  case "AUDIO_MATERIAL_PAUSED":return "请先开启资料同步，再开启原音备份";case "AUDIO_SOURCE_TEXT_NOT_STORED":return "等待对应智记文字同步完成";
  case "AUDIO_SOURCE_TARGET_CHANGED":case "AUDIO_MATERIAL_CHANGED":return "原音与文字连接需要属于同一账号和资料空间，请核对设置";
  case "OFFICIAL_ACCOUNT_CHANGED":case "AUDIO_ACCOUNT_REBIND_REFUSED":return "原厂账号已变化，请核对当前账号后重新登记";case "OFFICIAL_LOGIN_REQUIRED":case "OFFICIAL_LOGIN_UNAVAILABLE":return "请先完成原厂账号登录";
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
 /** Each dialog drops visible configuration on stop and rebinds before resume. */
 private static final class UiOwner {
  final Activity activity;final MaterialRuntime runtime;final AgentUI.Screen screen;final Runnable returned;final UiOwner parent;
  final java.util.List<UiOwner> children=new ArrayList<>();final Application.ActivityLifecycleCallbacks lifecycle;
  boolean closed,suspended,verified;long epoch;String account;Runnable refresh,clear=()->{},hide=()->{};
  UiOwner(Activity a,String title,String binding,Runnable back,UiOwner parent){activity=a;runtime=MaterialRuntime.get(a);account=binding;returned=back;this.parent=parent;screen=new AgentUI.Screen(a,title);if(parent!=null)parent.children.add(this);
   lifecycle=new Application.ActivityLifecycleCallbacks(){
    public void onActivityStopped(Activity a){if(a==activity&&!closed){suspended=true;verified=false;epoch++;runtime.cancelPending();hide.run();screen.body.removeAllViews();screen.body.addView(AgentUI.text(activity,"返回后将重新核对账号与原音连接…",14,AgentUI.MUTED));}}
    public void onActivityResumed(Activity a){if(a==activity&&!closed&&suspended){suspended=false;if(refresh!=null)refresh.run();}}
    public void onActivityDestroyed(Activity a){if(a==activity)close();}
    public void onActivityCreated(Activity a,android.os.Bundle b){}public void onActivityStarted(Activity a){}public void onActivityPaused(Activity a){}public void onActivitySaveInstanceState(Activity a,android.os.Bundle b){}
   };activity.getApplication().registerActivityLifecycleCallbacks(lifecycle);screen.dialog.setOnDismissListener(d->close());
  }
  boolean live(long ticket){return !closed&&!suspended&&!activity.isDestroyed()&&screen.dialog.isShowing()&&ticket==epoch;}
  boolean active(){return live(epoch)&&verified;}
  void load(java.util.function.Consumer<MaterialRuntime.AudioSnapshot> render){if(closed||suspended||activity.isDestroyed())return;long ticket=++epoch;verified=false;screen.body.removeAllViews();screen.body.addView(AgentUI.text(activity,"正在核对账号与原音连接…",14,AgentUI.MUTED));runtime.readAudio((snapshot,error)->{
   if(!live(ticket))return;String problem=error;if(problem.isEmpty()&&(snapshot==null||snapshot.account==null))problem="OFFICIAL_LOGIN_UNAVAILABLE";
   if(problem.isEmpty()&&account!=null&&!account.equals(snapshot.account))problem="OFFICIAL_ACCOUNT_CHANGED";
   if(!problem.isEmpty()){clear.run();screen.body.removeAllViews();screen.body.addView(AgentUI.text(activity,label(problem),16,AgentUI.MUTED));screen.body.addView(AgentUI.text(activity,"账号变化后请关闭此页，再从当前账号重新进入。",13,AgentUI.MUTED));AgentUI.button(activity,screen.body,"重新核对",false,refresh);return;}
   account=snapshot.account;verified=true;render.accept(snapshot);
  });}
  void close(){if(closed)return;closed=true;verified=false;epoch++;clear.run();runtime.cancelPending();activity.getApplication().unregisterActivityLifecycleCallbacks(lifecycle);for(UiOwner child:new ArrayList<>(children))child.close();if(parent!=null)parent.children.remove(this);if(screen.dialog.isShowing())screen.dialog.dismiss();if(!activity.isDestroyed()&&!suspended&&returned!=null)returned.run();}
 }
 static void show(Activity activity,Runnable returned){AgentUI.Screen screen=new AgentUI.Screen(activity,"原音与导出");screen.body.addView(AgentUI.text(activity,"原音只保存在手机",20,AgentUI.INK));screen.body.addView(AgentUI.text(activity,"原音和逐字转写不再自动上传服务器。可在资料卡右滑，导出音频或摘要文档到手机。既有服务器历史不自动清除。",14,AgentUI.MUTED));AgentUI.button(activity,screen.body,"默认保存位置",false,()->ExportDestination.settings(activity,()->{}));screen.dialog.setOnDismissListener(d->returned.run());}

 private static byte[] read(InputStream input)throws IOException{try(InputStream in=input){ByteArrayOutputStream out=new ByteArrayOutputStream();byte[] buffer=new byte[2048];int count;while((count=in.read(buffer))!=-1){if(out.size()+count>8192)throw new IOException("AUDIO_CONNECTION_INVALID");out.write(buffer,0,count);}return out.toByteArray();}}
 private static void configure(UiOwner parent){Activity activity=parent.activity;MaterialRuntime runtime=parent.runtime;UiOwner owner=new UiOwner(activity,"原音连接设置",parent.account,()->{if(parent.active())parent.refresh.run();},parent);AudioConnection[] candidate={null};android.net.Uri[] pending={null};
  owner.hide=()->{candidate[0]=null;};owner.clear=()->{candidate[0]=null;pending[0]=null;};
  owner.refresh=()->owner.load(snapshot->{AgentUI.Screen screen=owner.screen;screen.body.removeAllViews();TextView info=AgentUI.text(activity,"选择单独授权的原音登记文件，使用与文字同步相同的资料空间。保存前会核对服务器原音权限并绑定当前原厂账号。",14,AgentUI.MUTED);screen.body.addView(info);long rendered=owner.epoch;
   java.util.function.Consumer<byte[]> preview=raw->{try{if(!owner.live(rendered)||!owner.verified)return;candidate[0]=AudioConnection.parse(raw,System.currentTimeMillis());info.setText(candidate[0].preview()+"\n授权至 "+time(candidate[0].expiresAt)+"\n尚未保存。");}catch(Exception invalid){candidate[0]=null;info.setText("原音登记文件无效或已到期，请重新提供。");}finally{Arrays.fill(raw,(byte)0);}};
   AgentUI.button(activity,screen.body,"选择原音登记文件",false,()->{if(!owner.active())return;TaskFilePicker.pick(activity,uri->{if(owner.closed)return;pending[0]=uri;if(!owner.suspended)owner.refresh.run();});});
   AgentUI.button(activity,screen.body,"读取电脑登记文件",false,()->{if(!owner.active())return;try{File internal=new File(activity.getFilesDir(),"connection-import/audio-connection.json"),external=activity.getExternalFilesDir(null),file=internal.isFile()?internal:external==null?null:new File(external,"connection-import/audio-connection.json");if(file==null)throw new IOException();preview.accept(read(new FileInputStream(file)));}catch(Exception failure){candidate[0]=null;info.setText("未找到电脑提供的原音登记文件。");}});
   if(snapshot.config!=null)AgentUI.button(activity,screen.body,"读取已保存连接",false,()->{if(owner.active())preview.accept(snapshot.config.connection.encode());});CheckBox enabled=new CheckBox(activity);enabled.setText("允许将当前账号已保存的智记原音备份到此服务器");enabled.setTextColor(AgentUI.INK);enabled.setChecked(false);screen.body.addView(enabled);
   AgentUI.button(activity,screen.body,"核对并保存",true,()->{if(!owner.active())return;if(candidate[0]==null){info.setText("请先读取原音登记文件。");return;}long ticket=++owner.epoch;info.setText("正在核对原音授权…");runtime.configureAudio(owner.account,candidate[0].encode(),enabled.isChecked(),(value,error)->{if(!owner.live(ticket))return;if(error.isEmpty())owner.close();else{candidate[0]=null;enabled.setChecked(false);AgentUI.notice(activity,label(error));owner.refresh.run();}});});
   if(pending[0]!=null){android.net.Uri uri=pending[0];pending[0]=null;try{InputStream in=activity.getContentResolver().openInputStream(uri);if(in==null)throw new IOException();preview.accept(read(in));}catch(Exception failure){candidate[0]=null;info.setText("无法读取原音登记文件，请重新选择。");}}
  });owner.refresh.run();
 }
}
