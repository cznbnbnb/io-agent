package com.turboio.addon;

import android.animation.ObjectAnimator;
import android.app.Activity;
import android.graphics.*;
import android.graphics.drawable.*;
import android.view.View;
import android.view.animation.LinearInterpolator;
import java.io.*;
import java.util.*;

/** Official Lucide artwork, rasterized at build time. One small bitmap per icon, shared by all pages. */
final class AgentIcons {
 private static final Map<String,Bitmap> CACHE=new HashMap<>();
 private static String asset(String name){switch(name){
  case "tasks":return "list-todo";case "materials":case "document":return "file-text";case "settings":return "settings-2";
  case "down":return "chevron-down";case "right":return "chevron-right";case "back":return "chevron-left";case "refresh":return "refresh-cw";
  case "sort":return "arrow-down-up";case "pin":return "map-pin";case "spark":return "sparkles";case "export":return "upload";
  case "trash":return "trash-2";case "audio":return "audio-lines";case "select":return "circle-check";case "alert":return "triangle-alert";case "arc":return "loader-circle";
  default:return name;
 }}
 private static synchronized Bitmap bitmap(Activity a,String name){
  String key=asset(name);Bitmap found=CACHE.get(key);if(found!=null)return found;
  // Packaging verifies every file against the pinned-source manifest. Missing assets are a build error.
  try(InputStream in=a.getAssets().open("io-agent/icons/"+key+".png")){
   BitmapFactory.Options options=new BitmapFactory.Options();options.inScaled=false;Bitmap loaded=BitmapFactory.decodeStream(in,null,options);
   if(loaded==null)throw new IllegalStateException("ICON_ASSET_INVALID: "+key);CACHE.put(key,loaded);return loaded;
  }catch(IOException failure){throw new IllegalStateException("ICON_ASSET_MISSING: "+key,failure);}
 }
 static Drawable drawable(Activity a,String name,int color,int size){BitmapDrawable d=new BitmapDrawable(a.getResources(),bitmap(a,name));d.setTint(color);int px=AgentUI.dp(a,size);d.setBounds(0,0,px,px);return d;}
 static class Icon extends View {
  private final Bitmap bitmap;private final Paint paint=new Paint(Paint.ANTI_ALIAS_FLAG|Paint.FILTER_BITMAP_FLAG);private final RectF bounds=new RectF();private ObjectAnimator spinner;private boolean spinning;
  Icon(Activity a,String name,int color){super(a);bitmap=bitmap(a,name);color(color);setImportantForAccessibility(IMPORTANT_FOR_ACCESSIBILITY_NO);}
  void color(int color){paint.setColorFilter(new PorterDuffColorFilter(color,PorterDuff.Mode.SRC_IN));invalidate();}
  void rotate(float degrees){setRotation(degrees);}
  void spinning(boolean on){spinning=on;updateMotion();}
  private void updateMotion(){boolean run=spinning&&isAttachedToWindow()&&getWindowVisibility()==VISIBLE&&isShown()&&android.animation.ValueAnimator.areAnimatorsEnabled();if(run&&spinner==null){spinner=ObjectAnimator.ofFloat(this,"rotation",0,360);spinner.setDuration(1000);spinner.setInterpolator(new LinearInterpolator());spinner.setRepeatCount(ObjectAnimator.INFINITE);spinner.start();}else if(!run&&spinner!=null){spinner.cancel();spinner=null;setRotation(0);}}
  @Override protected void onAttachedToWindow(){super.onAttachedToWindow();updateMotion();}
  @Override protected void onDetachedFromWindow(){if(spinner!=null){spinner.cancel();spinner=null;}super.onDetachedFromWindow();}
  @Override protected void onWindowVisibilityChanged(int visibility){super.onWindowVisibilityChanged(visibility);updateMotion();}
  @Override protected void onVisibilityChanged(View changed,int visibility){super.onVisibilityChanged(changed,visibility);updateMotion();}
  @Override protected void onDraw(Canvas c){super.onDraw(c);float side=Math.min(getWidth(),getHeight());bounds.set((getWidth()-side)/2,(getHeight()-side)/2,(getWidth()+side)/2,(getHeight()+side)/2);c.drawBitmap(bitmap,null,bounds,paint);}
 }
}
