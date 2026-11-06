package com.turboio.addon;
import android.content.SharedPreferences;
import android.graphics.Rect;
import android.view.*;

/** The entry lives in the host content view. Store fractions of its usable travel,
 * not screen pixels, so rotation, system bars and badge width do not hide it. */
final class FloatingEntryPosition implements View.OnTouchListener, View.OnLayoutChangeListener {
 private final View button;private final ViewGroup root;private final SharedPreferences prefs;
 private final Rect frame=new Rect();private final int[] origin=new int[2];private final int slop;
 private float fx,fy,downX,downY,startX,startY;private boolean dragging;
 private FloatingEntryPosition(View b,ViewGroup r,SharedPreferences p){button=b;root=r;prefs=p;slop=ViewConfiguration.get(b.getContext()).getScaledTouchSlop();fx=p.getFloat("entry_fraction_x",-1);fy=p.getFloat("entry_fraction_y",-1);}
 static void attach(View button,ViewGroup root,SharedPreferences prefs){FloatingEntryPosition p=new FloatingEntryPosition(button,root,prefs);button.setOnTouchListener(p);button.addOnLayoutChangeListener(p);root.addOnLayoutChangeListener(p);button.addOnAttachStateChangeListener(new View.OnAttachStateChangeListener(){public void onViewAttachedToWindow(View v){}public void onViewDetachedFromWindow(View v){root.removeOnLayoutChangeListener(p);}});}
 private void bounds(){root.getWindowVisibleDisplayFrame(frame);root.getLocationOnScreen(origin);frame.offset(-origin[0],-origin[1]);frame.left=Math.max(0,frame.left);frame.top=Math.max(0,frame.top);frame.right=Math.max(frame.left,Math.min(root.getWidth(),frame.right)-button.getWidth());frame.bottom=Math.max(frame.top,Math.min(root.getHeight(),frame.bottom)-button.getHeight());}
 public void onLayoutChange(View v,int l,int t,int r,int b,int ol,int ot,int or,int ob){if(fx<0||fy<0||dragging||button.getWidth()==0)return;bounds();button.setX(frame.left+fx*frame.width());button.setY(frame.top+fy*frame.height());}
 public boolean onTouch(View v,MotionEvent e){float x=e.getRawX(),y=e.getRawY();switch(e.getActionMasked()){
  case MotionEvent.ACTION_DOWN:downX=x;downY=y;startX=v.getX();startY=v.getY();dragging=false;return true;
  case MotionEvent.ACTION_MOVE:if(!dragging&&Math.hypot(x-downX,y-downY)<=slop)return true;dragging=true;root.requestDisallowInterceptTouchEvent(true);bounds();v.setX(Math.max(frame.left,Math.min(frame.right,startX+x-downX)));v.setY(Math.max(frame.top,Math.min(frame.bottom,startY+y-downY)));return true;
  case MotionEvent.ACTION_UP:if(dragging){bounds();fx=frame.width()==0?0:(v.getX()-frame.left)/frame.width();fy=frame.height()==0?0:(v.getY()-frame.top)/frame.height();prefs.edit().putFloat("entry_fraction_x",fx).putFloat("entry_fraction_y",fy).apply();}else v.performClick();break;
  case MotionEvent.ACTION_CANCEL:if(dragging){v.setX(startX);v.setY(startY);}break;
  default:return true;
 }dragging=false;root.requestDisallowInterceptTouchEvent(false);return true;}
}
