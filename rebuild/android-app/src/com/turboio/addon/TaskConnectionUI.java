package com.turboio.addon;

import android.app.*;import android.net.Uri;import android.os.*;import android.widget.*;
import java.io.*;import java.util.*;import java.util.concurrent.*;

/** Explicit preview/save. Closing, backgrounding and rereading invalidate old work. */
final class TaskConnectionUI {
 private static final Handler MAIN=new Handler(Looper.getMainLooper());
 private static final ExecutorService IO=Executors.newSingleThreadExecutor(),CANCEL=Executors.newFixedThreadPool(2);
 private final Activity activity;private final Runnable saved;private final TaskSettings store;private final Object guard=new Object();private final String sourceBinding;
 private AgentUI.Screen screen;private TextView status,preview,saveButton;private CheckBox enabled;
 private TaskConnection candidate;private File delivery;private byte[] deliveryBytes;
 private volatile long generation;private volatile boolean closed;private volatile TaskHttp pending;
 private final Application.ActivityLifecycleCallbacks lifecycle=new Application.ActivityLifecycleCallbacks(){
  public void onActivityStopped(Activity a){if(a==activity){cancel();preview.setText("");enabled.setChecked(false);status.setText("页面已暂停，请重新读取连接。");}}
  public void onActivityDestroyed(Activity a){if(a==activity){closed=true;cancel();((Application)activity.getApplication()).unregisterActivityLifecycleCallbacks(this);}}
  public void onActivityCreated(Activity a,Bundle b){}public void onActivityStarted(Activity a){}public void onActivityResumed(Activity a){}public void onActivityPaused(Activity a){}public void onActivitySaveInstanceState(Activity a,Bundle b){}
 };
 TaskConnectionUI(Activity activity,Runnable saved){this(activity,saved,null);}
 TaskConnectionUI(Activity activity,Runnable saved,String binding){this.activity=activity;this.saved=saved;sourceBinding=binding;store=new TaskSettings(activity.getApplicationContext());}
 void show(){
  screen=new AgentUI.Screen(activity,"登记电脑连接");status=AgentUI.text(activity,"读取电脑提供的登记文件，核对 Agent 和工作区后保存。已有任务和回复仍保留在原连接。",15,AgentUI.MUTED);screen.body.addView(status);preview=AgentUI.text(activity,"",14,AgentUI.INK);screen.body.addView(preview);
  AgentUI.button(activity,screen.body,"选择登记文件",false,()->TaskFilePicker.pick(activity,this::loadUri));
  AgentUI.button(activity,screen.body,"读取电脑登记文件",false,this::loadDelivery);
  if(sourceBinding!=null)AgentUI.button(activity,screen.body,"读取这条已保存连接",false,this::loadSaved);
  enabled=new CheckBox(activity);enabled.setText("启用这条电脑连接");enabled.setTextColor(AgentUI.INK);enabled.setButtonTintList(android.content.res.ColorStateList.valueOf(AgentUI.ACCENT));enabled.setChecked(false);screen.body.addView(enabled);
  screen.body.addView(AgentUI.text(activity,"登记文件用于原任务问答，不会修改共享默认。新委托的目标请到「默认 Agent 与工作区」选择已连接的真实会话。",13,AgentUI.MUTED));
  saveButton=AgentUI.button(activity,screen.body,"保存连接",true,this::save);
  ((Application)activity.getApplication()).registerActivityLifecycleCallbacks(lifecycle);
  screen.dialog.setOnDismissListener(dialog->{closed=true;cancel();((Application)activity.getApplication()).unregisterActivityLifecycleCallbacks(lifecycle);});
 }
 private boolean valid(long owner){return !closed&&owner==generation;}
 private void cancel(){synchronized(guard){generation++;candidate=null;delivery=null;deliveryBytes=null;TaskHttp old=pending;pending=null;if(old!=null){old.disable();CANCEL.execute(old::cancel);}}}
 private byte[] read(InputStream in)throws IOException{try(InputStream source=in){ByteArrayOutputStream out=new ByteArrayOutputStream();byte[] buffer=new byte[2048];int n;while((n=source.read(buffer))!=-1){if(out.size()+n>8192)throw new IOException("TASK_IMPORT_BUDGET");out.write(buffer,0,n);}return out.toByteArray();}}
 private interface Source {byte[] get()throws Exception;}
 private void preflight(TaskConnection connection,long owner)throws Exception{
  TaskHttp http=new TaskHttp(connection);synchronized(guard){if(!valid(owner))return;pending=http;}
  new TaskApi(connection,http).preflight(System.currentTimeMillis());
 }
 private void parse(Source source,File file){
  cancel();enabled.setChecked(false);saveButton.setEnabled(true);preview.setText("");status.setText("读取并核对连接身份…");long owner=generation;
  IO.execute(()->{try{if(!valid(owner))return;byte[] data=source.get();TaskConnection next=TaskConnection.parse(data,System.currentTimeMillis());preflight(next,owner);
   MAIN.post(()->{synchronized(guard){if(!valid(owner))return;pending=null;candidate=next;delivery=file;deliveryBytes=file==null?null:data;}preview.setText("Agent："+next.agent+"\n电脑："+next.computer+"\n工作区："+next.project+"\n已登记会话："+next.session+"\n有效期："+next.expires);status.setText("身份核对通过。勾选启用后保存，才开始交换任务和回复。");});
  }catch(Exception error){showError(owner,error);}});
 }
 private void loadUri(Uri uri){parse(()->{InputStream in=activity.getContentResolver().openInputStream(uri);if(in==null)throw new IOException("TASK_IMPORT_UNAVAILABLE");return read(in);},null);}
 private void loadDelivery(){File internal=new File(activity.getFilesDir(),"connection-import/task-connection.json"),external=activity.getExternalFilesDir(null);File file=internal.isFile()?internal:external==null?null:new File(external,"connection-import/task-connection.json");if(file==null){status.setText("电脑登记目录暂不可用，请选择登记文件。");return;}parse(()->read(new FileInputStream(file)),file);}
 private void loadSaved(){parse(()->{TaskProfiles profiles=store.loadAll();TaskProfiles.Profile value=sourceBinding==null?profiles.selected():profiles.get(sourceBinding);if(value==null)throw new IOException("TASK_IMPORT_UNAVAILABLE");return value.connection.encode();},null);}
 private static String errorLabel(String code){return TaskWorkspace.label(code);}
 private void showError(long owner,Exception error){String code=TaskApi.safeError(error);MAIN.post(()->{if(valid(owner)){pending=null;saveButton.setEnabled(true);status.setText(errorLabel(code));}});}
 private void save(){
  final TaskConnection next;final long owner;final File source;final byte[] original;final boolean turnOn=enabled.isChecked();
  synchronized(guard){if(candidate==null){status.setText("请先读取并核对连接文件。");return;}next=candidate;owner=generation;source=delivery;original=deliveryBytes;}
  saveButton.setEnabled(false);status.setText("保存连接…");
  IO.execute(()->{try{
   if(turnOn)preflight(next,owner);
   synchronized(guard){if(!valid(owner))return;store.saveQuestion(next,turnOn);candidate=null;}
   boolean retained=false;
   if(source!=null&&source.isFile())try{byte[] current=read(new FileInputStream(source));TaskProfiles.Profile actual=store.loadAll().get(next.binding());if(Arrays.equals(current,original)&&actual.enabled==turnOn&&Arrays.equals(actual.connection.encode(),next.encode()))retained=!source.delete();else retained=true;}catch(Exception cleanupError){retained=true;}
   boolean keep=retained;MAIN.post(()->{saved.run();if(valid(owner)){pending=null;screen.dialog.dismiss();if(keep)AgentUI.notice(activity,"连接已保存，电脑登记文件未清理，请核对后手动移除。");}});
  }catch(Exception error){showError(owner,error);}});
 }
}
