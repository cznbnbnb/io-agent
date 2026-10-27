// Execute the actual SwipeRow source and AgentDialog against small lifecycle/touch fakes.
// These tests deliberately detach the row in page(), matching render()'s removeAllViews().
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {spawnSync} from 'node:child_process';
const repo=process.cwd(),temp=fs.mkdtempSync(path.join(os.tmpdir(),'io-navigation-test-'));
function put(name,text){const p=path.join(temp,name);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,text);}
function run(cmd,args){const r=spawnSync(cmd,args,{encoding:'utf8',timeout:30000});if(r.status!==0)throw Error(r.stdout+r.stderr);if(r.stdout)process.stdout.write(r.stdout);}
put('android/R.java','package android;public class R {public static class style {public static final int Theme_Material_NoActionBar=1;}}');
put('android/app/Activity.java','package android.app;public class Activity {public void runOnUiThread(Runnable r){r.run();}public boolean isDestroyed(){return false;}}');
put('android/util/Log.java','package android.util;public class Log {public static int i(String tag,String message){return 0;}}');
put('android/os/Build.java','package android.os;public class Build {public static class VERSION {public static int SDK_INT=36;}}');
put('android/window/OnBackInvokedCallback.java','package android.window;public interface OnBackInvokedCallback {void onBackInvoked();}');
put('android/window/OnBackInvokedDispatcher.java','package android.window;public class OnBackInvokedDispatcher {public static final int PRIORITY_DEFAULT=0;public OnBackInvokedCallback callback;public int adds,removes;public void registerOnBackInvokedCallback(int p,OnBackInvokedCallback c){callback=c;adds++;}public void unregisterOnBackInvokedCallback(OnBackInvokedCallback c){if(callback!=c)throw new AssertionError();callback=null;removes++;}}');
put('android/app/Dialog.java','package android.app;public class Dialog {boolean shown;public int cancelled;public final android.window.OnBackInvokedDispatcher dispatcher=new android.window.OnBackInvokedDispatcher();public Dialog(Activity a,int style){}protected void onStart(){}protected void onStop(){}public void show(){shown=true;onStart();}public boolean isShowing(){return shown;}public void onBackPressed(){cancelled++;dismiss();}public void dismiss(){shown=false;onStop();}public android.window.OnBackInvokedDispatcher getOnBackInvokedDispatcher(){return dispatcher;}}');
put('android/view/ViewParent.java','package android.view;public interface ViewParent {void requestDisallowInterceptTouchEvent(boolean block);}');
put('android/view/MotionEvent.java','package android.view;public class MotionEvent {public static final int ACTION_DOWN=0,ACTION_UP=1,ACTION_MOVE=2,ACTION_CANCEL=3;int a;float x,y;public MotionEvent(int a,float x,float y){this.a=a;this.x=x;this.y=y;}public int getActionMasked(){return a;}public float getX(){return x;}public float getY(){return y;}}');
put('android/view/ViewConfiguration.java','package android.view;public class ViewConfiguration {public static ViewConfiguration get(android.app.Activity a){return new ViewConfiguration();}public int getScaledTouchSlop(){return 8;}}');
put('android/view/View.java',`package android.view;public class View {public ViewParent parent;public float translation;public final java.util.List<Runnable> posted=new java.util.ArrayList<>();public ViewParent getParent(){return parent;}public boolean isAttachedToWindow(){return parent!=null;}public void setTranslationX(float v){translation=v;}public Animator animate(){return new Animator();}public boolean post(Runnable r){posted.add(r);return true;}public void drain(){for(Runnable r:new java.util.ArrayList<>(posted)){posted.remove(r);r.run();}}public class Animator {public void cancel(){}public Animator translationX(float v){translation=v;return this;}public Animator setDuration(long n){return this;}public void start(){}}}`);
put('android/widget/LinearLayout.java','package android.widget;public class LinearLayout extends android.view.View {public LinearLayout(android.app.Activity a){}public boolean onInterceptTouchEvent(android.view.MotionEvent e){return false;}public boolean onTouchEvent(android.view.MotionEvent e){return false;}}');
put('com/turboio/addon/AgentUI.java','package com.turboio.addon;class AgentUI {static int dp(android.app.Activity a,int n){return n;}}');
put('com/turboio/addon/AgentDialog.java',fs.readFileSync('rebuild/android-app/src/com/turboio/addon/AgentDialog.java','utf8'));
put('com/turboio/addon/NavigationTest.java',`package com.turboio.addon;
import android.view.*;import android.app.*;import android.os.Build;
public class NavigationTest {
 static void check(boolean value){if(!value)throw new AssertionError();}
 static MotionEvent e(int a,float x,float y){return new MotionEvent(a,x,y);}
 static void swipe(MaterialReadingUI.SwipeRow row,float x){row.onInterceptTouchEvent(e(0,0,0));check(row.onInterceptTouchEvent(e(2,x,0)));row.onTouchEvent(e(2,x,0));}
 public static void main(String[] args){
  Activity a=new Activity();int[] pages={0};boolean[] blocked={false};MaterialReadingUI.SwipeRow[] row={null};
  row[0]=new MaterialReadingUI.SwipeRow(a,d->{pages[0]+=d;row[0].parent=null;});row[0].parent=b->blocked[0]=b;swipe(row[0],-80);
  if(args.length>0){try{row[0].onTouchEvent(e(1,-80,0));throw new AssertionError("old row did not crash");}catch(NullPointerException expected){System.out.println("Original SwipeRow: reproduced detach-parent NullPointerException");}return;}
  check(row[0].translation==-80);row[0].onTouchEvent(e(1,-80,0));check(!blocked[0]&&pages[0]==0);row[0].drain();check(pages[0]==1);row[0].onTouchEvent(e(1,-80,0));row[0].drain();check(pages[0]==1);
  row[0].parent=b->blocked[0]=b;swipe(row[0],80);row[0].onTouchEvent(e(3,80,0));row[0].drain();check(pages[0]==1&&!blocked[0]);
  row[0].onInterceptTouchEvent(e(0,0,0));check(!row[0].onInterceptTouchEvent(e(2,10,80)));check(!row[0].onInterceptTouchEvent(e(2,100,80)));
  swipe(row[0],80);row[0].parent=null;row[0].onTouchEvent(e(1,80,0));row[0].drain();check(pages[0]==1);
  for(int sdk:new int[]{29,33,36}){Build.VERSION.SDK_INT=sdk;AgentDialog root=new AgentDialog(a);boolean[] selecting={true};root.backHandler(()->{if(!selecting[0])return false;selecting[0]=false;return true;});root.show();AgentDialog sheet=new AgentDialog(a);sheet.show();
   if(sdk>=33){check(sheet.dispatcher.adds==1);sheet.dispatcher.callback.onBackInvoked();check(sheet.dispatcher.removes==1);}else sheet.onBackPressed();check(!sheet.isShowing()&&root.isShowing()&&selecting[0]);
   if(sdk>=33)root.dispatcher.callback.onBackInvoked();else root.onBackPressed();check(root.isShowing()&&!selecting[0]&&root.cancelled==0);
   root.onBackPressed();check(!root.isShowing()&&root.cancelled==1);if(sdk>=33)check(root.dispatcher.removes==1);
   root.show();root.dismiss();if(sdk>=33)check(root.dispatcher.adds==2&&root.dispatcher.removes==2);
  }
  System.out.println("UI navigation: deferred swipe, detached/cancelled/vertical gestures, 1:1 tracking; SDK29/33/36 sheet-selection-page back and callback cleanup passed");
 }
}`);
// Execute the actual voice page completion/exit methods against an asynchronous
// runtime. No microphone, phone input or model reply is simulated as real evidence.
function voiceSource(source){
 function method(name){const start=source.indexOf('  void '+name+'(',source.indexOf('private static final class Page'));if(start<0)throw Error('Voice method missing');let braces=0,opened=false;for(let i=start;i<source.length;i++){if(source[i]==='{'){braces++;opened=true;}else if(source[i]==='}'&&--braces===0&&opened)return source.slice(start,i+1);}throw Error('Voice method incomplete');}
 put('com/turboio/addon/VoiceAnswerRuntime.java',`package com.turboio.addon;class VoiceAnswerRuntime {
  interface Result {void done(Snapshot value,String code);} static class Snapshot {String phase;boolean needsStop,canSave,canStart;Snapshot(String phase,boolean stop,boolean save){this.phase=phase;needsStop=stop;canSave=save;}}
  Result pending;int stops,edits;String edited;void stop(boolean cancel,Result reply){stops++;pending=reply;}void edit(String text,Result reply){edits++;edited=text;pending=reply;}void finish(Snapshot value,String code){Result reply=pending;pending=null;if(reply==null)throw new AssertionError();reply.done(value,code);}
 }`);
 put('com/turboio/addon/VoicePageTest.java',`package com.turboio.addon;
 import android.app.Activity;import android.os.Build;
 public class VoicePageTest {
  final Activity activity=new Activity();final VoiceAnswerRuntime runtime=new VoiceAnswerRuntime();VoiceAnswerRuntime.Snapshot latest;
  boolean closed,busy,dirty,autoStart=true,fromGlasses,glassesSave,exitPending,exitStopRequested,owns=true;int leaves;
  final Text text=new Text();static class Text {String value="edited answer";String getText(){return value;}}
  boolean owned(){return owns&&latest!=null;}void begin(){busy=true;}void render(VoiceAnswerRuntime.Snapshot v,String code){latest=v;}void leave(){closed=true;leaves++;}
  ${method('completed')}
  ${method('exit')}
  static void check(boolean b){if(!b)throw new AssertionError();}
  static VoiceAnswerRuntime.Snapshot v(String phase,boolean stop,boolean save){return new VoiceAnswerRuntime.Snapshot(phase,stop,save);}
  public static void main(String[] args){
   VoicePageTest p=new VoicePageTest();p.latest=v("CAPTURING",true,false);p.exit();check(p.exitPending&&p.runtime.stops==1&&!p.closed);p.runtime.finish(v("CANCELLED",false,false),"");
   if(args.length>0){check(!p.closed&&p.exitPending);System.out.println("Original voice exit: reproduced stopped capture trapped behind exitPending");return;}
   check(p.closed&&p.leaves==1&&!p.autoStart);
   p=new VoicePageTest();p.busy=true;p.exit();check(!p.autoStart&&p.exitPending);p.completed(v("PREPARED",false,false),"");check(p.closed&&p.runtime.stops==0);
   p=new VoicePageTest();p.latest=v("REVIEW",false,true);p.dirty=true;p.exit();check(p.runtime.edits==1&&!p.closed);p.runtime.finish(v("REVIEW",false,true),"");check(p.closed&&!p.dirty&&p.runtime.edited.equals("edited answer"));
   p=new VoicePageTest();p.latest=v("CAPTURING",true,false);p.exit();p.runtime.finish(v("RECOVERY",true,false),"VOICE_STOP_QUERY_FAILED");check(!p.closed&&!p.exitPending);
   p=new VoicePageTest();p.latest=v("CAPTURING",true,false);p.exit();p.runtime.finish(v("STOPPING",true,false),"");check(!p.closed&&p.runtime.stops==1);
   p=new VoicePageTest();p.latest=v("CAPTURING",true,false);p.exit();p.owns=false;p.runtime.finish(v("CAPTURING",true,false),"");check(p.closed&&p.runtime.stops==1);
   for(int sdk:new int[]{29,33,36}){Build.VERSION.SDK_INT=sdk;final VoicePageTest page=new VoicePageTest();page.latest=v("REVIEW",false,true);AgentDialog dialog=new AgentDialog(page.activity);dialog.backHandler(()->{page.exit();return true;});dialog.show();if(sdk>=33)dialog.dispatcher.callback.onBackInvoked();else dialog.onBackPressed();check(page.closed&&page.leaves==1);dialog.dismiss();if(sdk>=33)check(dialog.dispatcher.removes==1);}
   System.out.println("Voice back: SDK29/33/36 shared gesture dispatch, stop-before-exit, deferred prepare, draft preservation, stop failure and foreign owner passed");
  }
 }`);
}
function sources(){const out=[];function walk(p){for(const e of fs.readdirSync(p,{withFileTypes:true})){const f=path.join(p,e.name);if(e.isDirectory())walk(f);else if(f.endsWith('.java'))out.push(f);}}walk(temp);return out;}
function swipeSource(source){const a=source.indexOf(' static final class SwipeRow'),b=source.indexOf(' static LinearLayout card',a);put('com/turboio/addon/MaterialReadingUI.java','package com.turboio.addon;import android.app.Activity;import android.view.*;import android.widget.*;class MaterialReadingUI {\n'+source.slice(a,b)+'\n}');}
try{
 const old=spawnSync('git',['show','fa2968b:rebuild/android-app/src/com/turboio/addon/MaterialReadingUI.java'],{encoding:'utf8'});if(old.status!==0)throw Error('Missing regression baseline');
 swipeSource(old.stdout);run('javac',['-d',path.join(temp,'old'),...sources()]);run('java',['-cp',path.join(temp,'old'),'com.turboio.addon.NavigationTest','baseline']);
 voiceSource(spawnSync('git',['show','ca48682:rebuild/android-app/src/com/turboio/addon/VoiceAnswerWorkspace.java'],{encoding:'utf8'}).stdout);run('javac',['-d',path.join(temp,'voice-old'),...sources()]);run('java',['-cp',path.join(temp,'voice-old'),'com.turboio.addon.VoicePageTest','baseline']);
 voiceSource(fs.readFileSync('rebuild/android-app/src/com/turboio/addon/VoiceAnswerWorkspace.java','utf8'));
 swipeSource(fs.readFileSync('rebuild/android-app/src/com/turboio/addon/MaterialReadingUI.java','utf8'));run('javac',['-d',path.join(temp,'new'),...sources()]);run('java',['-cp',path.join(temp,'new'),'com.turboio.addon.NavigationTest']);run('java',['-cp',path.join(temp,'new'),'com.turboio.addon.VoicePageTest']);
}finally{fs.rmSync(temp,{recursive:true,force:true});}
