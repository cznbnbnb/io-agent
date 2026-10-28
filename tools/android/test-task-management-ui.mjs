// Execute the task page's real management methods with parent-aware UI fakes and
// the real task projection/library. Confirmation rendering is a test boundary;
// page actions and AgentDialog back dispatch are real. No phone/network is used.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'io-task-management-ui-'));
function put(name,text){const p=path.join(temp,name);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,text);return p;}
const source=fs.readFileSync(path.join(repo,'rebuild/android-app/src/com/turboio/addon/AgentTaskPage.java'),'utf8');
function method(signature){
 const start=source.indexOf(signature);if(start<0)throw Error('Missing task management method '+signature);
 let depth=0,opened=false,quote='',escape=false;
 for(let i=start;i<source.length;i++){const ch=source[i];if(quote){if(escape)escape=false;else if(ch==='\\')escape=true;else if(ch===quote)quote='';continue;}if(ch==='"'||ch==="'"){quote=ch;continue;}if(ch==='{'){depth++;opened=true;}else if(ch==='}'&&--depth===0&&opened)return source.slice(start,i+1);}
 throw Error('Unclosed task management method '+signature);
}
const inputs=[];
inputs.push(put('android/R.java','package android;public class R {public static class style {public static final int Theme_Material_NoActionBar=1;}}'));
inputs.push(put('android/app/Activity.java','package android.app;public class Activity {}'));
inputs.push(put('android/os/Build.java','package android.os;public class Build {public static class VERSION {public static int SDK_INT=36;}}'));
inputs.push(put('android/window/OnBackInvokedCallback.java','package android.window;public interface OnBackInvokedCallback {void onBackInvoked();}'));
inputs.push(put('android/window/OnBackInvokedDispatcher.java','package android.window;public class OnBackInvokedDispatcher {public static final int PRIORITY_DEFAULT=0;public OnBackInvokedCallback callback;public int adds,removes;public void registerOnBackInvokedCallback(int p,OnBackInvokedCallback c){callback=c;adds++;}public void unregisterOnBackInvokedCallback(OnBackInvokedCallback c){if(callback!=c)throw new AssertionError();callback=null;removes++;}}'));
inputs.push(put('android/app/Dialog.java','package android.app;public class Dialog {boolean shown;public int cancelled;public final android.window.OnBackInvokedDispatcher dispatcher=new android.window.OnBackInvokedDispatcher();public Dialog(Activity a,int style){}protected void onStart(){}protected void onStop(){}public void show(){shown=true;onStart();}public boolean isShowing(){return shown;}public void onBackPressed(){cancelled++;dismiss();}public void dismiss(){shown=false;onStop();}public android.window.OnBackInvokedDispatcher getOnBackInvokedDispatcher(){return dispatcher;}}'));
inputs.push(put('android/view/Gravity.java','package android.view;public class Gravity {public static final int CENTER=1,CENTER_VERTICAL=2;}'));
inputs.push(put('android/view/View.java',`package android.view;public class View {
 public ViewGroup parent;Object tag;public boolean enabled=true,focused;public OnClickListener click;
 public interface OnClickListener{void onClick(View v);}public ViewGroup getParent(){return parent;}public Object getTag(){return tag;}public void setTag(Object v){tag=v;}
 public void setOnClickListener(OnClickListener v){click=v;}public void performClick(){if(enabled&&click!=null)click.onClick(this);}public void setEnabled(boolean v){enabled=v;}
 public void setBackground(Object v){}public void setPadding(int a,int b,int c,int d){}public void setMinHeight(int v){}public void setFocusable(boolean v){}public void setContentDescription(String v){}public void clearFocus(){focused=false;}
 }`));
inputs.push(put('android/view/ViewGroup.java',`package android.view;public class ViewGroup extends View {
 public final java.util.List<View> children=new java.util.ArrayList<>();public void addView(View v){if(v.parent!=null)throw new IllegalStateException("The specified child already has a parent");children.add(v);v.parent=this;}public void addView(View v,Object p){addView(v);}public void removeView(View v){if(children.remove(v))v.parent=null;}public void removeAllViews(){for(View v:children)v.parent=null;children.clear();}public int getChildCount(){return children.size();}public View getChildAt(int i){return children.get(i);}
 }`));
inputs.push(put('android/widget/LinearLayout.java','package android.widget;public class LinearLayout extends android.view.ViewGroup {public LinearLayout(android.app.Activity a){}public void setGravity(int v){}public static class LayoutParams {public LayoutParams(int a,int b){}public LayoutParams(int a,int b,float c){}}}'));
inputs.push(put('android/widget/TextView.java','package android.widget;public class TextView extends android.view.View {public String text="";public void setText(String v){text=v;}public String getText(){return text;}public void setTextColor(int v){}public void setGravity(int v){}}'));
inputs.push(put('android/widget/EditText.java','package android.widget;public class EditText extends TextView {public java.util.function.Consumer<String> changed;@Override public void setText(String v){super.setText(v);if(changed!=null)changed.accept(v);}}'));
inputs.push(put('com/turboio/addon/MaterialReadingUI.java','package com.turboio.addon;class MaterialReadingUI {static final int DIM=1;static android.widget.TextView bold(android.widget.TextView v){return v;}static Object pressable(android.app.Activity a,Object v){return v;}}'));
inputs.push(put('com/turboio/addon/AgentUI.java',`package com.turboio.addon;import android.app.Activity;import android.widget.*;
class AgentUI {
 static final int MUTED=1,INK=2,ACCENT=3;static String notice="",toast="",confirmText="";static Runnable accepted;static AgentDialog confirmation;
 static int dp(Activity a,int n){return n;}static LinearLayout column(Activity a){return new LinearLayout(a);}static TextView text(Activity a,String v,int size,int color){TextView t=new TextView();t.setText(v);return t;}
 static void notice(Activity a,String v){notice=v;}static void toast(Activity a,String v){toast=v;}
 static void confirm(Activity a,String title,String text,String label,Runnable action){confirmText=text;accepted=action;confirmation=new AgentDialog(a);confirmation.show();}
 static void accept(){if(confirmation==null||!confirmation.isShowing())throw new AssertionError("No active confirmation");confirmation.dismiss();Runnable action=accepted;accepted=null;action.run();}
 static void reset(){notice=toast=confirmText="";accepted=null;confirmation=null;}
 static class Screen {final AgentDialog dialog;Screen(Activity a){dialog=new AgentDialog(a);dialog.show();}}
 interface Pick {void choose(Object d,int i);}static class Alert {Alert setTitle(String s){return this;}Alert setItems(String[] a,Pick p){return this;}Alert setNegativeButton(String s,Object l){return this;}void show(){}}
 static Alert alert(Activity a){return new Alert();}
 }`));
inputs.push(put('com/turboio/addon/TaskManagementUITest.java',`package com.turboio.addon;
import android.app.Activity;import android.os.Build;import android.view.Gravity;import android.widget.*;import java.util.*;
public final class TaskManagementUITest {
 static int checks;static void check(boolean v,String why){checks++;if(!v)throw new AssertionError(why);}
 final Activity activity=new Activity();final TaskLibrary library=new TaskLibrary(Collections.emptySet(),Collections.emptySet());
 final LinearLayout tools=new LinearLayout(activity),footer=new LinearLayout(activity);final EditText search=new EditText();final TextView create=new TextView();
 TaskPresentation presentation;List<TaskPresentation.Row> visibleRows=Collections.emptyList();boolean selecting,deletedOnly,resetScroll;String query="",filter="all",detailKey="";int renders,saves;AgentUI.Screen detail;
 TaskManagementUITest(){search.changed=v->{query=v;library.clearSelection();render();};}
 void render(){renders++;renderTools();}void saveLibrary(){saves++;}void hideKeyboard(){search.clearFocus();}void enterSelection(){selecting=true;hideKeyboard();render();}
 ${method(' boolean back(')}
 ${method(' private void selectAll(')}
 ${method(' private void confirmDelete(')}
 ${method(' private TextView tool(')}
 ${method(' private void renderTools(')}
 static final long NOW=TaskConnection.stamp("2026-10-28T05:00:00Z");
 static TaskProfiles.Profile profile(){Map<String,Object> value=TaskConnectionTest.sample();value.put("expires_at",TaskWire.now(NOW+86400000));return new TaskProfiles.Profile(TaskConnection.parse(WireJson.bytes(value),NOW),true);}
 void load(int total,int running){TaskProfiles.Profile p=profile();List<Object> objects=new ArrayList<>();for(int i=0;i<total;i++){
  String state=i<running?"running":"completed";Map<String,Object> body=WireJson.object("task_id","task-"+i,"revision",1,"route",p.connection.route(),"state",state,"command","任务 "+i,"allow_create_session",false);
  Map<String,Object> item=WireJson.object("schema_version","1.0","kind","task","object_id","task-"+i,"revision",1,"commit_seq",i+1,"stored_at",TaskWire.now(NOW+i),"event_id","event-"+i,"expires_at",TaskWire.now(NOW+3600000),"state",state,"body",body);TaskWire.object(item);objects.add(WireJson.object("item",item,"detail_at",NOW));
 }List<TaskPresentation.Source> sources=Collections.singletonList(new TaskPresentation.Source(p,objects,Collections.emptyList()));presentation=new TaskPresentation(sources,NOW);library.update(presentation,sources,row->"Codex 测试会话");visibleRows=library.filter("all","",false,false);}
 static void back(AgentDialog dialog,int sdk){if(sdk>=33)dialog.dispatcher.callback.onBackInvoked();else dialog.onBackPressed();}
 public static void main(String[] args){
  TaskManagementUITest p=new TaskManagementUITest();p.load(45,0);p.render();Object firstParent=p.search.getParent();p.search.focused=true;p.render();check(p.search.getParent()==firstParent&&p.search.focused,"query/snapshot redraw must retain input focus and parent");
  p.enterSelection();p.selectAll();check(p.library.selection().size()==45,"select all includes rows beyond the 30-row page");p.selectAll();check(p.library.selection().isEmpty(),"select all toggles off");
  check(p.back()&&!p.selecting,"back leaves selection");check(p.search.getParent()!=null,"input reattaches after selection");
  p.enterSelection();p.back();check(p.search.getParent()!=null,"repeated selection roundtrip reattaches input");
  for(int sdk:new int[]{29,33,36}){
   Build.VERSION.SDK_INT=sdk;AgentUI.reset();p=new TaskManagementUITest();p.load(45,0);p.query="任务";p.deletedOnly=true;p.enterSelection();p.selectAll();final TaskManagementUITest current=p;
   AgentDialog page=new AgentDialog(p.activity);page.backHandler(current::back);page.show();p.confirmDelete(p.library.selection());check(AgentUI.confirmation.isShowing(),"delete confirmation opens");
   back(AgentUI.confirmation,sdk);check(!AgentUI.confirmation.isShowing()&&page.isShowing()&&p.selecting&&p.saves==0&&p.library.deleted().isEmpty(),"first back cancels delete only");
   back(page,sdk);check(page.isShowing()&&!p.selecting&&p.library.selection().isEmpty(),"second back exits selection");
   back(page,sdk);check(page.isShowing()&&p.query.isEmpty()&&p.deletedOnly,"third back clears query only");
   back(page,sdk);check(page.isShowing()&&!p.deletedOnly&&p.filter.equals("all")&&p.resetScroll,"fourth back exits deleted view and resets list position");
   back(page,sdk);check(!page.isShowing(),"last back leaves task page");if(sdk>=33)check(page.dispatcher.adds==page.dispatcher.removes,"page callback cleanup");
  }
  p=new TaskManagementUITest();p.load(4,0);p.enterSelection();p.selectAll();Set<String> original=p.library.selection();p.confirmDelete(original);original.clear();check(AgentUI.confirmText.contains("电脑原会话")&&AgentUI.confirmText.contains("恢复"),"confirmation states local deletion and restore");
  p.load(4,1);AgentUI.accept();check(p.library.deleted().size()==3&&p.saves==1&&!p.selecting,"confirmed batch uses frozen keys and rechecks changed task state");check(AgentUI.toast.contains("状态变化"),"partial deletion reports state change");
  AgentUI.reset();p=new TaskManagementUITest();p.load(4,1);p.enterSelection();p.selectAll();String protectedKey="";for(TaskPresentation.Row row:p.presentation.rows)if(row.active())protectedKey=row.key;
  p.confirmDelete(p.library.selection());check(AgentUI.confirmText.contains("其余 1 条仍需处理"),"confirmation excludes protected task from announced batch");
  p.load(4,0);AgentUI.accept();check(p.library.deleted().size()==3&&!p.library.deleted(protectedKey),"task protected at confirmation stays even if it completes before accept");check(p.saves==1&&AgentUI.toast.startsWith("已删除 3 条"),"confirmed count never expands after background update");
  AgentUI.reset();p=new TaskManagementUITest();p.load(2,2);p.selectAll();p.confirmDelete(p.library.selection());check(AgentUI.confirmation==null&&p.saves==0&&p.library.deleted().isEmpty(),"live tasks cannot open deletion confirmation");check(AgentUI.notice.contains("进行中"),"live task refusal explains reason");
  System.out.println("Task management UI: "+checks+" checks passed; actual page methods, parent-aware search reuse, 45-row select-all, SDK29/33/36 layered back, cancel and latest-state confirm");
 }
}`));
const realRoot=path.join(repo,'rebuild/android-app');
inputs.push(path.join(realRoot,'upstream/android-addon/src/com/turboio/addon/BoundedJson.java'));
for(const name of ['WireJson','TaskWire','TaskConnection','TaskDevice','TaskProfiles','TaskPresentation','TaskLibrary','AgentDialog'])inputs.push(path.join(realRoot,'src/com/turboio/addon',name+'.java'));
inputs.push(path.join(repo,'tools/android/TaskConnectionTest.java'));
try{
 for(const [command,args] of [['javac',['-encoding','UTF-8','-d',temp,...inputs]],['java',['-cp',temp,'com.turboio.addon.TaskManagementUITest']]]){
  const r=spawnSync(command,args,{cwd:repo,encoding:'utf8',timeout:30000});if(r.stdout)process.stdout.write(r.stdout);if(r.status!==0)throw r.error??Error(r.stderr||command+' failed');
 }
}finally{fs.rmSync(temp,{recursive:true,force:true});}
