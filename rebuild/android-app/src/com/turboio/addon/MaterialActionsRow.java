package com.turboio.addon;

import android.content.Context;
import android.view.*;
import android.widget.*;

/** A right swipe reveals actions. A vertical gesture never changes direction
 * mid-stream, and recycling always closes the old record's action tray. */
final class MaterialActionsRow extends FrameLayout {
 interface Opened {void opened(MaterialActionsRow row);}
 private final View content;private final LinearLayout tray;private final TextView[] buttons=new TextView[3];
 private final int slop,width;private final Opened opened;private float x,y,start;private boolean horizontal,vertical,tapToClose;
 MaterialActionsRow(android.app.Activity c,View content,Opened opened){super(c);this.content=content;this.opened=opened;slop=ViewConfiguration.get(c).getScaledTouchSlop();width=AgentUI.dp(c,198);setClipChildren(true);
  tray=new LinearLayout(c);tray.setGravity(Gravity.CENTER_VERTICAL);String[] labels={"删除","导出音频","导出文档"};String[] icons={"trash","audio","document"};
  for(int i=0;i<3;i++){LinearLayout cell=AgentUI.column(c);cell.setGravity(Gravity.CENTER);MaterialReadingUI.glyph(c,cell,icons[i],i==0?0xffe6aaa4:AgentUI.INK,22);TextView label=AgentUI.text(c,labels[i],11,i==0?0xffe6aaa4:AgentUI.INK);label.setGravity(Gravity.CENTER);AgentUI.gap(c,cell,6);cell.addView(label);cell.setContentDescription(labels[i]);cell.setFocusable(true);cell.setMinimumHeight(AgentUI.dp(c,64));tray.addView(cell,new LinearLayout.LayoutParams(0,-1,1));buttons[i]=label;}
  tray.setBackground(MaterialReadingUI.fill(c,0xff24352e,16));addView(tray,new FrameLayout.LayoutParams(width,-1));addView(content,new FrameLayout.LayoutParams(-1,-2));hideActions();
 }
 void bind(Runnable remove,Runnable audio,Runnable document){close(false);Runnable[] actions={remove,audio,document};for(int i=0;i<3;i++){View button=(View)buttons[i].getParent();final Runnable action=actions[i];button.setOnClickListener(v->{close(true);if(action!=null)action.run();});button.setEnabled(action!=null);button.setAlpha(action==null?.4f:1f);}}
 private void hideActions(){tray.setVisibility(INVISIBLE);tray.setImportantForAccessibility(IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS);}
 void close(boolean animate){content.animate().cancel();if(animate){content.animate().translationX(0).setDuration(110).withEndAction(this::hideActions).start();}else{content.setTranslationX(0);hideActions();}horizontal=vertical=tapToClose=false;}
 private void move(float value){content.setTranslationX(Math.max(0,Math.min(width,value)));if(content.getTranslationX()>0){tray.setVisibility(VISIBLE);tray.setImportantForAccessibility(IMPORTANT_FOR_ACCESSIBILITY_AUTO);}else hideActions();}
 @Override public boolean onInterceptTouchEvent(android.view.MotionEvent e){
  if(e.getActionMasked()==MotionEvent.ACTION_DOWN){content.animate().cancel();x=e.getX();y=e.getY();start=content.getTranslationX();horizontal=vertical=false;tapToClose=start>0&&x>=start;return tapToClose;}
  if(e.getActionMasked()==MotionEvent.ACTION_MOVE&&!vertical){float dx=e.getX()-x,dy=e.getY()-y;if(Math.abs(dy)>slop&&Math.abs(dy)>=Math.abs(dx)){vertical=true;return false;}if(Math.abs(dx)>slop&&Math.abs(dx)>1.5f*Math.abs(dy)&&(dx>0||start>0)){horizontal=true;tapToClose=false;getParent().requestDisallowInterceptTouchEvent(true);opened.opened(this);return true;}}
  return horizontal;
 }
 @Override public boolean onTouchEvent(MotionEvent e){float dx=e.getX()-x,dy=e.getY()-y;switch(e.getActionMasked()){
  case MotionEvent.ACTION_MOVE:if(!horizontal&&Math.abs(dy)>slop&&Math.abs(dy)>=Math.abs(dx))vertical=true;if(!horizontal&&!vertical&&Math.abs(dx)>slop&&Math.abs(dx)>1.5f*Math.abs(dy)){horizontal=true;tapToClose=false;getParent().requestDisallowInterceptTouchEvent(true);opened.opened(this);}if(horizontal)move(start+dx);return true;
  case MotionEvent.ACTION_UP:if(tapToClose||!horizontal||content.getTranslationX()<width*.4f)close(true);else{content.animate().translationX(width).setDuration(110).start();horizontal=false;}getParent().requestDisallowInterceptTouchEvent(false);return true;
  case MotionEvent.ACTION_CANCEL:close(false);getParent().requestDisallowInterceptTouchEvent(false);return true;
  default:return true;
 }}
 @Override protected void onDetachedFromWindow(){close(false);super.onDetachedFromWindow();}
}
