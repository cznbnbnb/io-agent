package com.turboio.addon;
import android.app.*;import android.widget.*;import android.net.Uri;import java.io.*;import java.util.*;

/** Executes the real workspace against explicit Android/widget/IO boundaries. */
public final class AudioWorkspaceLifecycleTest {
 static int checks;static void yes(boolean value){checks++;if(!value)throw new AssertionError("audio UI check "+checks);}
 static final class Fixture implements AutoCloseable {
  final Application app=new Application();final Activity activity=new Activity(app);final MaterialRuntime runtime=new MaterialRuntime();final AgentUI.Screen outer;int returned;
  Fixture(){AgentUI.screens.clear();MaterialRuntime.current=runtime;AudioWorkspace.show(activity,()->returned++);outer=AgentUI.screens.get(0);}
  void read(String account,AudioConfig config){runtime.reads.remove(0).done(new MaterialRuntime.AudioSnapshot(account,config),"");}
  AgentUI.Screen configure(){click(outer,"原音连接设置");AgentUI.Screen s=AgentUI.screens.get(1);read("account-a",null);return s;}
  void stop(){app.stop(activity);}void resume(){app.resume(activity);}void freshBoth(){read("account-a",null);read("account-a",null);}
  public void close(){outer.dialog.dismiss();yes(app.callbacks.isEmpty());}
 }
 static TextView find(AgentUI.Screen s,String text){for(TextView v:s.body.items)if(text.equals(v.text))return v;throw new AssertionError("missing button "+text);}
 static boolean has(AgentUI.Screen s,String text){for(TextView v:s.body.items)if(v.text.contains(text))return true;return false;}
 static void click(AgentUI.Screen s,String text){find(s,text).click.run();}
 static CheckBox check(AgentUI.Screen s){for(TextView v:s.body.items)if(v instanceof CheckBox)return (CheckBox)v;throw new AssertionError("missing checkbox");}
 public static void main(String[] args){
  try(Fixture f=new Fixture()){
   yes(!has(f.outer,"原音连接设置"));f.read("account-a",null);AgentUI.Screen inner=f.configure();
   click(inner,"选择原音登记文件");f.stop();yes(has(inner,"返回后将重新核对")&&!has(inner,"核对并保存"));TaskFilePicker.selected.take(new Uri());yes(f.activity.resolver.opens==0);
   f.resume();yes(!has(inner,"核对并保存"));f.freshBoth();yes(f.activity.resolver.opens==1&&has(inner,"synthetic-preview"));yes(!check(inner).isChecked());check(inner).setChecked(true);click(inner,"核对并保存");yes(f.runtime.saves==1&&f.runtime.savedAccount.equals("account-a")&&f.runtime.enabled);
   f.stop();f.runtime.saved.done(new MaterialRuntime.AudioSnapshot("account-a",null),"");yes(inner.dialog.isShowing()&&f.returned==0);f.resume();f.freshBoth();yes(!has(inner,"synthetic-preview")&&!check(inner).isChecked());click(inner,"核对并保存");yes(f.runtime.saves==1);
  }
  try(Fixture f=new Fixture()){
   f.read("account-a",null);AgentUI.Screen inner=f.configure();click(inner,"选择原音登记文件");f.stop();f.resume();TaskFilePicker.selected.take(new Uri());f.read("account-a",null);f.read("account-a",null);yes(f.activity.resolver.opens==0);f.read("account-a",null);yes(f.activity.resolver.opens==1&&has(inner,"synthetic-preview")&&!check(inner).isChecked());
  }
  try(Fixture f=new Fixture()){
   f.read("account-a",null);AgentUI.Screen inner=f.configure();click(inner,"选择原音登记文件");f.stop();TaskFilePicker.selected.take(new Uri());f.resume();f.read("account-b",null);f.read("account-b",null);yes(f.activity.resolver.opens==0&&!has(inner,"核对并保存")&&f.runtime.saves==0);yes(has(inner,"账号已变化"));
   f.outer.dialog.dismiss();TaskFilePicker.selected.take(new Uri());yes(f.activity.resolver.opens==0&&!inner.dialog.isShowing());
  }
  try(Fixture f=new Fixture()){
   MaterialRuntime.AudioResult stale=f.runtime.reads.remove(0);f.stop();f.resume();stale.done(new MaterialRuntime.AudioSnapshot("account-a",new AudioConfig("old",true)),"");yes(!has(f.outer,"synthetic-preview"));f.read("account-a",new AudioConfig("target-a",true));click(f.outer,"备份一次");yes(f.runtime.syncFingerprint.equals("target-a"));
   f.stop();f.runtime.synced.done(new MaterialRuntime.AudioSnapshot("account-a",null),"");yes(has(f.outer,"返回后将重新核对"));f.resume();f.read("account-b",null);yes(!has(f.outer,"备份一次"));
  }
  try(Fixture f=new Fixture()){
   f.read("account-a",null);AgentUI.Screen inner=f.configure();click(inner,"读取电脑登记文件");yes(!has(inner,"synthetic-preview"));click(inner,"选择原音登记文件");TaskFilePicker.selected.take(new Uri());f.read("account-a",null);yes(has(inner,"synthetic-preview"));click(inner,"核对并保存");f.runtime.saved.done(null,"AUDIO_CONFIG_SAVE_FAILED");yes(f.runtime.reads.size()==1);f.read("account-a",null);yes(!has(inner,"synthetic-preview")&&!check(inner).isChecked());
  }
  try(Fixture f=new Fixture()){
   f.read("account-a",new AudioConfig("saved",false));yes(has(f.outer,"synthetic-preview"));AgentUI.Screen inner=f.configure();f.activity.destroyed=true;for(Application.ActivityLifecycleCallbacks c:new ArrayList<>(f.app.callbacks))c.onActivityDestroyed(f.activity);yes(!inner.dialog.isShowing()&&!f.outer.dialog.isShowing()&&f.returned==0);
  }
  System.out.println("Audio workspace lifecycle: "+checks+" checks passed");
 }
}
final class AgentUI {
 static final int INK=1,MUTED=2;static final List<Screen> screens=new ArrayList<>();
 static final class Screen {final LinearLayout body=new LinearLayout();final Dialog dialog=new Dialog();Screen(Activity a,String title){screens.add(this);}}
 static TextView text(Activity a,String text,int size,int color){return new TextView(text);}
 static TextView button(Activity a,LinearLayout body,String text,boolean primary,Runnable action){TextView v=new TextView(text);v.click=action;body.addView(v);return v;}
 static void notice(Activity a,String text){}
}
final class MaterialRuntime {
 static MaterialRuntime current;static MaterialRuntime get(Activity a){return current;}interface AudioResult {void done(AudioSnapshot value,String error);}
 static final class AudioSnapshot {final String account,note="unconfigured";final AudioConfig config;final AudioSyncSession.Status status=new AudioSyncSession.Status();AudioSnapshot(String account,AudioConfig config){this.account=account;this.config=config;}}
 final List<AudioResult> reads=new ArrayList<>();AudioResult saved,synced;int saves,cancels;boolean enabled;String savedAccount,syncFingerprint;
 void readAudio(AudioResult result){reads.add(result);}void cancelPending(){cancels++;}
 void configureAudio(String account,byte[] input,boolean on,AudioResult result){savedAccount=account;enabled=on;saves++;saved=result;}
 void syncAudio(String fingerprint,AudioResult result){syncFingerprint=fingerprint;synced=result;}
 void setAudioEnabled(String fingerprint,boolean on,AudioResult result){}
}
final class AudioConnection {final long expiresAt=System.currentTimeMillis()+600000;static AudioConnection parse(byte[] input,long now){return new AudioConnection();}String preview(){return "synthetic-preview";}byte[] encode(){return new byte[]{1};}}
final class AudioConfig {final String id;final boolean enabled;final AudioConnection connection=new AudioConnection();AudioConfig(String id,boolean enabled){this.id=id;this.enabled=enabled;}String fingerprint(){return id;}}
final class AudioSyncSession {static final class Status {int retained,queued,blocked,expired;}}
final class TaskFilePicker {interface Selected {void take(Uri uri);}static Selected selected;static void pick(Activity a,Selected callback){selected=callback;}}
