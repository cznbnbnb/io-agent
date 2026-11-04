package com.turboio.addon;

import android.app.*;
import android.content.res.ColorStateList;
import android.graphics.*;
import android.graphics.drawable.*;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.*;
import android.widget.*;
import java.lang.ref.WeakReference;
import java.util.*;

/** Native presentation for the approved Agent workspace. No device or task side effects. */
final class AgentUI {
 static final int BG=0xff0d100f,SURFACE=0xff1c2420,INK=0xfff0f3f1,MUTED=0xffa2afa5,ACCENT=0xff02a97b;
 private static final List<WeakReference<Screen>> screens=new ArrayList<>();
 static int dp(Activity a,int value){return Math.round(a.getResources().getDisplayMetrics().density*value);}
 static LinearLayout column(Activity a){LinearLayout l=new LinearLayout(a);l.setOrientation(LinearLayout.VERTICAL);return l;}
 static TextView text(Activity a,String value,int size,int color){TextView t=new TextView(a);t.setText(value);t.setTextSize(size);t.setTextColor(color);t.setLineSpacing(dp(a,3),1);t.setIncludeFontPadding(false);return t;}
 static GradientDrawable shape(Activity a,int color,int radius){GradientDrawable d=new GradientDrawable();d.setColor(color);d.setCornerRadius(dp(a,radius));d.setStroke(dp(a,1),0xff303b35);return d;}
 static EditText input(Activity a){EditText edit=new EditText(new ContextThemeWrapper(a,android.R.style.Theme_Material_NoActionBar));edit.setTextColor(INK);edit.setHintTextColor(MUTED);edit.setTextSize(16);edit.setGravity(Gravity.TOP|Gravity.START);edit.setPadding(dp(a,14),dp(a,14),dp(a,14),dp(a,14));edit.setBackgroundTintList(null);StateListDrawable background=new StateListDrawable();GradientDrawable focused=shape(a,SURFACE,13);focused.setStroke(dp(a,2),ACCENT);background.addState(new int[]{android.R.attr.state_focused},focused);background.addState(new int[]{},shape(a,SURFACE,13));edit.setBackground(background);edit.setHighlightColor(0x6648c99c);return edit;}
 /** Builder-based dialogs (inputs, pickers) keep their content but take the Agent card look. */
 static AlertDialog.Builder alert(Activity a){return new AlertDialog.Builder(new ContextThemeWrapper(a,android.R.style.Theme_Material_Dialog_Alert)){
  @Override public AlertDialog create(){AlertDialog d=super.create();skin(a,d);return d;}
 };}
 private static void skin(Activity a,AlertDialog d){
  Window w=d.getWindow();if(w==null)return;w.setBackgroundDrawable(new InsetDrawable(shape(a,SURFACE,22),dp(a,22),dp(a,16),dp(a,22),dp(a,16)));
  // Buttons and title exist only once the dialog is attached; style them then, without taking the caller's show listener.
  w.getDecorView().addOnAttachStateChangeListener(new View.OnAttachStateChangeListener(){
   @Override public void onViewAttachedToWindow(View v){v.post(()->paint(a,d));}
   @Override public void onViewDetachedFromWindow(View v){}
  });
 }
 private static void paint(Activity a,AlertDialog d){
  ColorStateList primary=new ColorStateList(new int[][]{{-android.R.attr.state_enabled},{}},new int[]{0x66a2afa5,0xff36c49b});
  for(int id:new int[]{AlertDialog.BUTTON_POSITIVE,AlertDialog.BUTTON_NEGATIVE,AlertDialog.BUTTON_NEUTRAL}){Button b=d.getButton(id);if(b==null)continue;
   b.setAllCaps(false);b.setTextSize(15);if(id==AlertDialog.BUTTON_POSITIVE){b.setTextColor(primary);b.setTypeface(null,Typeface.BOLD);}else b.setTextColor(MUTED);}
  TextView message=d.findViewById(android.R.id.message);if(message!=null){message.setTextColor(MUTED);message.setTextSize(15);message.setLineSpacing(dp(a,3),1);}
  int titleId=a.getResources().getIdentifier("alertTitle","id","android");TextView title=titleId==0?null:d.findViewById(titleId);if(title!=null){title.setTextColor(INK);title.setTypeface(null,Typeface.BOLD);}
 }
 static void gap(Activity a,LinearLayout parent,int size){parent.addView(new View(a),new LinearLayout.LayoutParams(1,dp(a,size)));}
 static TextView button(Activity a,LinearLayout parent,String title,boolean primary,Runnable action){
  Button button=new Button(new ContextThemeWrapper(a,android.R.style.Theme_Material_NoActionBar));button.setAllCaps(false);button.setText(title);button.setTextSize(15);button.setTextColor(primary?0xff062118:INK);button.setTypeface(null,Typeface.BOLD);button.setGravity(Gravity.CENTER);button.setMinHeight(dp(a,48));button.setMinimumWidth(0);button.setMinWidth(0);button.setPadding(dp(a,14),dp(a,12),dp(a,14),dp(a,12));button.setBackground(shape(a,primary?ACCENT:SURFACE,13));button.setStateListAnimator(null);button.setOnClickListener(v->action.run());
  LinearLayout.LayoutParams p=new LinearLayout.LayoutParams(-1,-2);p.topMargin=dp(a,10);parent.addView(button,p);return button;
 }
 static LinearLayout card(Activity a,LinearLayout parent){LinearLayout c=column(a);c.setPadding(dp(a,16),dp(a,16),dp(a,16),dp(a,16));c.setBackground(shape(a,SURFACE,18));LinearLayout.LayoutParams p=new LinearLayout.LayoutParams(-1,-2);p.topMargin=dp(a,14);parent.addView(c,p);return c;}
 static TextView heading(Activity a,LinearLayout parent,String title){TextView t=text(a,title,26,INK);t.setTypeface(null,Typeface.BOLD);parent.addView(t);gap(a,parent,16);return t;}
 static void divider(Activity a,LinearLayout parent){View line=new View(a);line.setBackgroundColor(0xff2b3530);LinearLayout.LayoutParams p=new LinearLayout.LayoutParams(-1,dp(a,1));p.topMargin=dp(a,4);p.bottomMargin=dp(a,4);parent.addView(line,p);}
 static LinearLayout row(Activity a,LinearLayout parent,String title,String detail,String value,Runnable action){return iconRow(a,parent,null,title,detail,value,action);}
 static LinearLayout iconRow(Activity a,LinearLayout parent,String icon,String title,String detail,String value,Runnable action){
  LinearLayout row=new LinearLayout(a);row.setGravity(Gravity.CENTER_VERTICAL);row.setPadding(0,dp(a,12),0,dp(a,12));row.setMinimumHeight(dp(a,56));
  if(icon!=null){AgentIcons.Icon mark=new AgentIcons.Icon(a,icon,0xff80b7a2);LinearLayout.LayoutParams ip=new LinearLayout.LayoutParams(dp(a,21),dp(a,21));ip.rightMargin=dp(a,13);row.addView(mark,ip);}
  LinearLayout labels=column(a);TextView name=text(a,title,15,INK);name.setTypeface(Typeface.create("sans-serif-medium",Typeface.NORMAL));labels.addView(name);
  if(detail!=null&&!detail.isEmpty()){gap(a,labels,5);TextView sub=text(a,detail,12,MUTED);sub.setMaxLines(2);sub.setEllipsize(android.text.TextUtils.TruncateAt.END);labels.addView(sub);}row.addView(labels,new LinearLayout.LayoutParams(0,-2,1));
  if(value!=null&&!value.isEmpty()){TextView v=text(a,value,12,MUTED);v.setMaxLines(2);v.setMaxWidth(dp(a,105));v.setGravity(Gravity.END);v.setPadding(dp(a,8),0,dp(a,8),0);row.addView(v);}
  if(action!=null){row.addView(new AgentIcons.Icon(a,"right",MUTED),new LinearLayout.LayoutParams(dp(a,16),dp(a,16)));row.setOnClickListener(v->action.run());row.setFocusable(true);row.setContentDescription(title+(detail==null?"":"，"+detail)+(value==null?"":"，"+value));row.setBackground(new RippleDrawable(ColorStateList.valueOf(0x2636c49b),null,null));}parent.addView(row,new LinearLayout.LayoutParams(-1,-2));return row;
 }
 static LinearLayout section(Activity a,LinearLayout parent,String title){gap(a,parent,22);TextView label=text(a,title,12,MUTED);label.setPadding(dp(a,4),0,0,0);parent.addView(label);LinearLayout panel=card(a,parent);LinearLayout.LayoutParams lp=(LinearLayout.LayoutParams)panel.getLayoutParams();lp.topMargin=dp(a,8);panel.setPadding(dp(a,16),dp(a,3),dp(a,16),dp(a,3));return panel;}
 static LinearLayout summary(Activity a,LinearLayout parent,String icon,String title,String detail){
  LinearLayout panel=card(a,parent),line=new LinearLayout(a);((LinearLayout.LayoutParams)panel.getLayoutParams()).topMargin=0;line.setGravity(Gravity.CENTER_VERTICAL);
  // Insets belong to a separate icon well, keeping the artwork itself on the 24 dp grid.
  FrameLayout well=new FrameLayout(a);well.setBackground(MaterialReadingUI.fill(a,0xff123a2d,14));AgentIcons.Icon glyph=new AgentIcons.Icon(a,icon,0xff52c9a2);FrameLayout.LayoutParams gp=new FrameLayout.LayoutParams(dp(a,24),dp(a,24),Gravity.CENTER);well.addView(glyph,gp);LinearLayout.LayoutParams wp=new LinearLayout.LayoutParams(dp(a,48),dp(a,48));wp.rightMargin=dp(a,14);line.addView(well,wp);
  LinearLayout labels=column(a);TextView heading=text(a,title,18,INK);heading.setTypeface(Typeface.create("sans-serif-medium",Typeface.NORMAL));labels.addView(heading);if(detail!=null&&!detail.isEmpty()){gap(a,labels,5);labels.addView(text(a,detail,13,MUTED));}line.addView(labels,new LinearLayout.LayoutParams(0,-2,1));panel.addView(line);return panel;
 }
 static Switch toggle(Activity a,LinearLayout parent,String title,boolean checked,CompoundButton.OnCheckedChangeListener changed){LinearLayout row=new LinearLayout(a);row.setGravity(Gravity.CENTER_VERTICAL);row.setPadding(0,dp(a,10),0,dp(a,10));row.addView(text(a,title,15,INK),new LinearLayout.LayoutParams(0,-2,1));Switch toggle=new Switch(new ContextThemeWrapper(a,android.R.style.Theme_Material_NoActionBar));toggle.setContentDescription(title);toggle.setChecked(checked);toggle.setShowText(false);toggle.setTrackTintList(new ColorStateList(new int[][]{new int[]{android.R.attr.state_checked},new int[]{}},new int[]{ACCENT,0xff58645c}));toggle.setThumbTintList(ColorStateList.valueOf(INK));row.addView(toggle,new LinearLayout.LayoutParams(dp(a,58),dp(a,48)));parent.addView(row);toggle.setOnCheckedChangeListener(changed);return toggle;}
 /** Acknowledgement in the Agent card style; no generic app-name title. */
 static void notice(Activity a,String message){sheet(a,null,message,null,"知道了",null);}
 static void confirm(Activity a,String title,String message,Runnable action){confirm(a,title,message,"确认",action);}
 static void confirm(Activity a,String title,String message,String accept,Runnable action){sheet(a,title,message,"返回",accept,action);}
 private static void sheet(Activity a,String title,String message,String cancel,String accept,Runnable action){
  if(a.isFinishing()||a.isDestroyed())return;Dialog d=new Dialog(a);d.requestWindowFeature(Window.FEATURE_NO_TITLE);
  LinearLayout card=column(a);card.setPadding(dp(a,22),dp(a,22),dp(a,22),dp(a,16));card.setBackground(shape(a,SURFACE,22));
  if(title!=null&&!title.isEmpty()){TextView t=text(a,title,18,INK);t.setTypeface(null,Typeface.BOLD);card.addView(t);gap(a,card,10);}
  card.addView(text(a,message,16,title==null||title.isEmpty()?INK:MUTED));gap(a,card,10);
  LinearLayout actions=new LinearLayout(a);
  if(cancel!=null){LinearLayout slot=column(a);button(a,slot,cancel,false,d::dismiss);actions.addView(slot,new LinearLayout.LayoutParams(0,-2,1));View space=new View(a);actions.addView(space,new LinearLayout.LayoutParams(dp(a,10),1));}
  LinearLayout slot=column(a);button(a,slot,accept,true,()->{d.dismiss();if(action!=null)action.run();});actions.addView(slot,new LinearLayout.LayoutParams(0,-2,1));
  card.addView(actions);d.setContentView(card);d.setCanceledOnTouchOutside(true);
  Window w=d.getWindow();w.setBackgroundDrawable(new ColorDrawable(Color.TRANSPARENT));WindowManager.LayoutParams p=w.getAttributes();
  p.width=a.getResources().getDisplayMetrics().widthPixels-dp(a,48);p.dimAmount=.6f;w.setAttributes(p);w.addFlags(WindowManager.LayoutParams.FLAG_DIM_BEHIND);d.show();
 }
 /** Non-blocking confirmation for state the page already shows; never takes focus or touches. */
 static void toast(Activity a,String message){
  if(a.isFinishing()||a.isDestroyed())return;Dialog d=new Dialog(a);d.requestWindowFeature(Window.FEATURE_NO_TITLE);
  TextView t=text(a,message,14,INK);t.setPadding(dp(a,18),dp(a,13),dp(a,18),dp(a,13));GradientDrawable bg=shape(a,0xf2243429,24);bg.setStroke(dp(a,1),0xff3f5446);t.setBackground(bg);d.setContentView(t);
  Window w=d.getWindow();w.setBackgroundDrawable(new ColorDrawable(Color.TRANSPARENT));w.clearFlags(WindowManager.LayoutParams.FLAG_DIM_BEHIND);
  w.addFlags(WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE|WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE);
  WindowManager.LayoutParams p=w.getAttributes();p.width=WindowManager.LayoutParams.WRAP_CONTENT;p.gravity=Gravity.BOTTOM|Gravity.CENTER_HORIZONTAL;p.y=dp(a,96);w.setAttributes(p);
  d.show();t.postDelayed(()->{try{if(d.isShowing())d.dismiss();}catch(RuntimeException gone){}},2600);
 }
 static void minimize(Activity a){for(WeakReference<Screen> reference:new ArrayList<>(screens)){Screen screen=reference.get();if(screen!=null&&screen.activity==a&&screen.dialog.isShowing())screen.dialog.dismiss();}screens.removeIf(r->r.get()==null||!r.get().dialog.isShowing());}
 static final class Screen {
  final Activity activity;final AgentDialog dialog;final LinearLayout root,header,body,dock;final ScrollView scroll;
  private final Application application;private final Application.ActivityLifecycleCallbacks lifecycle;
  private boolean detached;
  Screen(Activity a,String title){this(a,title,true);}
  Screen(Activity a,String title,boolean scrolling){
   activity=a;dialog=new AgentDialog(a);dialog.requestWindowFeature(Window.FEATURE_NO_TITLE);root=column(a);root.setBackground(new GradientDrawable(GradientDrawable.Orientation.TOP_BOTTOM,new int[]{0xff123529,BG,BG}));header=new LinearLayout(a);header.setPadding(dp(a,14),0,dp(a,14),0);header.setGravity(Gravity.CENTER_VERTICAL);
   TextView back=headerAction(a,"‹","返回",dialog::onBackPressed);header.addView(back,new LinearLayout.LayoutParams(dp(a,48),dp(a,56)));TextView name=text(a,title,18,INK);name.setGravity(Gravity.CENTER);name.setTypeface(null,Typeface.BOLD);header.addView(name,new LinearLayout.LayoutParams(0,-2,1));header.addView(headerAction(a,"−","回到原厂 APP",()->minimize(a)),new LinearLayout.LayoutParams(dp(a,48),dp(a,56)));root.addView(header,new LinearLayout.LayoutParams(-1,-2));
   body=column(a);body.setPadding(dp(a,20),dp(a,18),dp(a,20),dp(a,24));scroll=new ScrollView(a);scroll.setFillViewport(true);scroll.setOverScrollMode(View.OVER_SCROLL_NEVER);scroll.setClipToPadding(false);if(scrolling){scroll.addView(body,new ScrollView.LayoutParams(-1,-2));root.addView(scroll,new LinearLayout.LayoutParams(-1,0,1));}else{body.setPadding(0,0,0,0);root.addView(body,new LinearLayout.LayoutParams(-1,0,1));}
   dock=column(a);dock.setPadding(dp(a,20),dp(a,6),dp(a,20),dp(a,12));root.addView(dock,new LinearLayout.LayoutParams(-1,-2));dialog.setContentView(root);dialog.show();Window w=dialog.getWindow();if(w!=null){w.setBackgroundDrawableResource(android.R.color.transparent);w.setLayout(-1,-1);w.setStatusBarColor(0xff123529);w.setNavigationBarColor(BG);w.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE);if(Build.VERSION.SDK_INT>=30){w.setDecorFitsSystemWindows(false);root.setOnApplyWindowInsetsListener((v,insets)->{Insets bars=insets.getInsets(WindowInsets.Type.systemBars()|WindowInsets.Type.displayCutout());int ime=insets.getInsets(WindowInsets.Type.ime()).bottom;v.setPadding(bars.left,bars.top,bars.right,Math.max(bars.bottom,ime));return WindowInsets.CONSUMED;});root.requestApplyInsets();}}
   application=a.getApplication();lifecycle=new Application.ActivityLifecycleCallbacks(){
    public void onActivityDestroyed(Activity host){if(host==activity){try{dialog.dismiss();}finally{detach();}}}
    public void onActivityCreated(Activity host,Bundle state){}public void onActivityStarted(Activity host){}public void onActivityResumed(Activity host){}public void onActivityPaused(Activity host){}public void onActivityStopped(Activity host){}public void onActivitySaveInstanceState(Activity host,Bundle state){}
   };application.registerActivityLifecycleCallbacks(lifecycle);
   screens.add(new WeakReference<>(this));root.addOnAttachStateChangeListener(new View.OnAttachStateChangeListener(){public void onViewAttachedToWindow(View v){}public void onViewDetachedFromWindow(View v){new Handler(Looper.getMainLooper()).post(()->{if(!dialog.isShowing())detach();});}});
  }
  void backHandler(java.util.function.BooleanSupplier action){dialog.backHandler(action);}
  private void detach(){if(detached)return;detached=true;application.unregisterActivityLifecycleCallbacks(lifecycle);screens.removeIf(r->r.get()==null||r.get()==Screen.this);}
 }
 static TextView headerAction(Activity a,String glyph,String label,Runnable action){String name="‹".equals(glyph)?"back":"›".equals(glyph)?"right":"−".equals(glyph)?"minus":"ellipsis";TextView v=text(a,"",20,MUTED);v.setGravity(Gravity.CENTER);v.setPadding(dp(a,12),0,dp(a,12),0);v.setCompoundDrawables(AgentIcons.drawable(a,name,MUTED,20),null,null,null);v.setContentDescription(label);v.setFocusable(true);v.setBackground(new RippleDrawable(ColorStateList.valueOf(0x2636c49b),null,null));v.setOnClickListener(w->action.run());return v;}

 static final class Icon extends AgentIcons.Icon {
  Icon(Activity a,String name){super(a,name,MUTED);}
 }
}
