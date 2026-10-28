// Compile and execute the actual workspace-folder rendering method with small
// view fakes, so collapsed and paged groups cannot silently allocate every task.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'io-task-groups-ui-'));
function put(name,text){const p=path.join(temp,name);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,text);return p;}
const source=fs.readFileSync(path.join(repo,'rebuild/android-app/src/com/turboio/addon/AgentTaskPage.java'),'utf8');
function method(signature){
 const start=source.indexOf(signature);if(start<0)throw Error('Missing workspace group method '+signature);
 let depth=0,opened=false,quote='',escape=false;
 for(let i=start;i<source.length;i++){const ch=source[i];if(quote){if(escape)escape=false;else if(ch==='\\')escape=true;else if(ch===quote)quote='';continue;}if(ch==='"'||ch==="'"){quote=ch;continue;}if(ch==='{'){depth++;opened=true;}else if(ch==='}'&&--depth===0&&opened)return source.slice(start,i+1);}
 throw Error('Unclosed workspace group method '+signature);
}
const inputs=[];
inputs.push(put('android/app/Activity.java','package android.app;public class Activity {}'));
inputs.push(put('android/view/Gravity.java','package android.view;public class Gravity {public static final int CENTER=1,CENTER_VERTICAL=2;}'));
inputs.push(put('android/text/TextUtils.java','package android.text;public class TextUtils {public enum TruncateAt {MIDDLE}}'));
inputs.push(put('android/view/View.java',`package android.view;public class View {
 public Object params;public String description="";public OnClickListener click;
 public interface OnClickListener{void onClick(View v);}public void setOnClickListener(OnClickListener v){click=v;}public void performClick(){if(click!=null)click.onClick(this);}public Object getLayoutParams(){return params;}
 public void setBackground(Object v){}public void setPadding(int a,int b,int c,int d){}public void setMinHeight(int v){}public void setFocusable(boolean v){}public void setContentDescription(String v){description=v;}
}`));
inputs.push(put('android/view/ViewGroup.java',`package android.view;public class ViewGroup extends View {
 public final java.util.List<View> children=new java.util.ArrayList<>();public void addView(View v){children.add(v);}public void addView(View v,Object p){v.params=p;addView(v);}public void removeAllViews(){children.clear();}public int getChildCount(){return children.size();}public View getChildAt(int i){return children.get(i);}
}`));
inputs.push(put('android/widget/LinearLayout.java','package android.widget;public class LinearLayout extends android.view.ViewGroup {public LinearLayout(android.app.Activity a){}public void setGravity(int v){}public static class LayoutParams {public int rightMargin;public LayoutParams(int a,int b){}public LayoutParams(int a,int b,float c){}}}'));
inputs.push(put('android/widget/TextView.java','package android.widget;public class TextView extends android.view.View {public String text="";public void setText(String v){text=v;}public String getText(){return text;}public void setTextColor(int v){}public void setGravity(int v){}public void setEllipsize(android.text.TextUtils.TruncateAt v){}}'));
inputs.push(put('com/turboio/addon/AgentUI.java','package com.turboio.addon;import android.app.Activity;import android.widget.*;class AgentUI {static final int MUTED=1,INK=2,ACCENT=3;static int dp(Activity a,int n){return n;}static LinearLayout column(Activity a){return new LinearLayout(a);}static TextView text(Activity a,String s,int size,int color){TextView v=new TextView();v.setText(s);return v;}}'));
inputs.push(put('com/turboio/addon/MaterialReadingUI.java',`package com.turboio.addon;import android.app.Activity;import android.widget.*;
class MaterialReadingUI {static final int ACCENT_SOFT=1;static TextView bold(TextView v){return v;}static Object pressable(Activity a,Object v){return v;}static TextView line(Activity a,String s,int size,int color,int lines){return AgentUI.text(a,s,size,color);}
 static LinearLayout card(Activity a,LinearLayout p,int gap){LinearLayout c=new LinearLayout(a);p.addView(c);return c;}
 static class Glyph extends android.view.View {float rotation;void rotate(float degrees){rotation=degrees;}}
 static Glyph glyph(Activity a,LinearLayout p,String name,int color,int size){Glyph g=new Glyph();p.addView(g,new LinearLayout.LayoutParams(size,size));return g;}
}`));
inputs.push(put('com/turboio/addon/TaskTargetUI.java','package com.turboio.addon;class TaskTargetUI {static String computer(TaskSessionDirectory.Entry e){return (String)e.route.get("computer_id");}}'));
inputs.push(put('com/turboio/addon/TaskGroupsUITest.java',`package com.turboio.addon;
import android.app.Activity;import android.view.*;import android.widget.*;import java.util.*;
public class TaskGroupsUITest {
 static int checks;static void check(boolean v,String why){checks++;if(!v)throw new AssertionError(why);}
 final Activity activity=new Activity();final LinearLayout body=new LinearLayout(activity);final TaskLibrary library=new TaskLibrary(Collections.emptySet(),Collections.emptySet());
 final Set<String> openGroups=new HashSet<>(),closedSearchGroups=new HashSet<>();final Map<String,Integer> groupLimits=new HashMap<>();
 static final int PAGE=30;String query="";boolean selecting;TaskPresentation presentation;List<TaskPresentation.Row> visibleRows;int renderedRows;
 ${method(' private void taskGroup(')}
 ${method(' private TextView tool(')}
 ${method(' private static String ago(')}
 void taskRow(LinearLayout p,TaskPresentation.Row row,boolean rule){renderedRows++;p.addView(AgentUI.text(activity,row.title(),15,0));}
 void load(){List<TaskPresentation.Source> sources=Arrays.asList(TaskGroupsTest.source(TaskGroupsTest.connection(1,"project_id","one"),45,TaskGroupsTest.NOW),TaskGroupsTest.source(TaskGroupsTest.connection(2,"project_id","two"),4,TaskGroupsTest.NOW-100));presentation=new TaskPresentation(sources,TaskGroupsTest.NOW);library.update(presentation,sources,row->row.profile.connection.project);visibleRows=library.filter("all","",false,false);render();}
 void render(){body.removeAllViews();renderedRows=0;for(TaskGroups.Group g:TaskGroups.collect(visibleRows,null))taskGroup(g);}
 LinearLayout card(int i){return (LinearLayout)body.getChildAt(i);}View head(int i){return card(i).getChildAt(0);}void more(int i){LinearLayout c=card(i);c.getChildAt(c.getChildCount()-1).performClick();}
 public static void main(String[] args){
  TaskGroupsUITest p=new TaskGroupsUITest();p.load();check(p.body.getChildCount()==2&&p.renderedRows==0,"all workspace groups initially collapsed, no task views allocated");
  check(p.head(0).description.contains("45 条任务")&&p.head(0).description.contains("展开工作区"),"collapsed header announces count and action");
  p.head(0).performClick();check(p.renderedRows==30&&p.card(0).getChildCount()==32,"expanded folder renders first 30 plus header and load more");
  p.head(1).performClick();check(p.renderedRows==34&&p.card(1).getChildCount()==5,"each group has an independent page budget");
  p.more(0);check(p.renderedRows==49&&p.card(0).getChildCount()==46,"load more affects only its own group");
  p.head(0).performClick();check(p.renderedRows==4,"collapsing large folder drops task views");
  p.head(0).performClick();check(p.renderedRows==49,"explicit expanded page preserved during view updates");
  p=new TaskGroupsUITest();p.load();p.query="任务";p.visibleRows=p.library.filter("all",p.query,false,false);p.render();check(p.renderedRows==34,"search automatically opens all matching groups within page limits");
  p.head(0).performClick();check(p.renderedRows==4,"search folder may still be collapsed manually");
  p.query="";p.render();check(p.renderedRows==0&&p.openGroups.isEmpty(),"search expansion does not change normal collapse state");
  p.selecting=true;p.library.selectAll(p.visibleRows);p.render();check(p.renderedRows==0&&p.library.selection().size()==49,"selection includes every row in collapsed and unrendered groups");check(p.head(0).description.contains("已选 45 / 45 条"),"collapsed folder reports selected count");
  p.head(0).performClick();check(p.renderedRows==30&&p.library.selection().size()==49,"opening selected folder does not narrow selection");
  System.out.println("Task workspace group UI: "+checks+" checks passed (actual folder method, collapsed allocations, independent 30-row pages, search expansion, full selection)");
 }
}`));
const realRoot=path.join(repo,'rebuild/android-app');
inputs.push(path.join(realRoot,'upstream/android-addon/src/com/turboio/addon/BoundedJson.java'));
for(const name of ['WireJson','TaskWire','TaskConnection','TaskDevice','TaskProfiles','TaskPresentation','TaskSessionDirectory','TaskLibrary','TaskGroups'])inputs.push(path.join(realRoot,'src/com/turboio/addon',name+'.java'));
for(const name of ['TaskConnectionTest','TaskGroupsTest'])inputs.push(path.join(repo,'tools/android',name+'.java'));
try{
 for(const [command,args] of [['javac',['-encoding','UTF-8','-d',temp,...inputs]],['java',['-cp',temp,'com.turboio.addon.TaskGroupsUITest']]]){
  const r=spawnSync(command,args,{cwd:repo,encoding:'utf8',timeout:30000});if(r.stdout)process.stdout.write(r.stdout);if(r.status!==0)throw r.error??Error(r.stderr||command+' failed');
 }
}finally{fs.rmSync(temp,{recursive:true,force:true});}
