package com.turboio.addon;

import android.view.*;
import android.widget.*;

/** A right swipe reveals the export actions on the left; a left swipe reveals
 * select and delete on the right. A vertical gesture never changes direction
 * mid-stream, and recycling always closes the old record's action tray. */
final class MaterialActionsRow extends FrameLayout {
 interface Opened {void opened(MaterialActionsRow row);}
 private static final String[] LABELS={"导出文档","导出音频","多选","删除"},ICONS={"document","audio","select","trash"};
 private final View content;private final LinearLayout lead,trail;private final View[] cells=new View[4];
 private final int slop,width;private final Opened opened;private float x,y,start;private boolean horizontal,vertical,tapToClose,enabled=true;
 MaterialActionsRow(android.app.Activity c,View content,Opened opened){super(c);this.content=content;this.opened=opened;slop=ViewConfiguration.get(c).getScaledTouchSlop();width=AgentUI.dp(c,152);setClipChildren(true);
  lead=tray(c,0,MaterialReadingUI.ACCENT_BG);trail=tray(c,2,0xff2e3633);
  addView(lead,new FrameLayout.LayoutParams(width,-1,Gravity.START));addView(trail,new FrameLayout.LayoutParams(width,-1,Gravity.END));addView(content,new FrameLayout.LayoutParams(-1,-2));hideActions();
 }
 private LinearLayout tray(android.app.Activity c,int first,int background){
  LinearLayout tray=new LinearLayout(c);tray.setGravity(Gravity.CENTER_VERTICAL);tray.setBackground(MaterialReadingUI.fill(c,background,16));tray.setClipToOutline(true);
  for(int i=first;i<first+2;i++){boolean delete=i==3;int color=delete?MaterialReadingUI.ON_CORAL:i<2?0xff9fe3cb:AgentUI.INK;LinearLayout cell=AgentUI.column(c);cell.setGravity(Gravity.CENTER);
   if(delete)cell.setBackgroundColor(MaterialReadingUI.CORAL);
   MaterialReadingUI.glyph(c,cell,ICONS[i],color,22);TextView label=AgentUI.text(c,LABELS[i],12,color);label.setGravity(Gravity.CENTER);AgentUI.gap(c,cell,5);cell.addView(label);cell.setContentDescription(LABELS[i]);cell.setFocusable(true);cells[i]=cell;tray.addView(cell,new LinearLayout.LayoutParams(0,-1,1));}
  return tray;
 }
 void bind(Runnable document,Runnable audio,Runnable select,Runnable remove){close(false);Runnable[] actions={document,audio,select,remove};for(int i=0;i<4;i++){final Runnable action=actions[i];cells[i].setOnClickListener(v->{close(true);if(action!=null)action.run();});cells[i].setEnabled(action!=null);cells[i].setAlpha(action==null?.4f:1f);}}
 /** Selection mode turns swiping off so a sideways drag never hides the tick boxes. */
 void setSwipeEnabled(boolean value){enabled=value;if(!value)close(false);}
 private void hideActions(){for(LinearLayout tray:new LinearLayout[]{lead,trail}){tray.setVisibility(INVISIBLE);tray.setImportantForAccessibility(IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS);}}
 private void reveal(LinearLayout shown,LinearLayout hidden){shown.setVisibility(VISIBLE);shown.setImportantForAccessibility(IMPORTANT_FOR_ACCESSIBILITY_AUTO);hidden.setVisibility(INVISIBLE);hidden.setImportantForAccessibility(IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS);}
 void close(boolean animate){content.animate().cancel();if(animate){content.animate().translationX(0).setDuration(110).withEndAction(this::hideActions).start();}else{content.setTranslationX(0);hideActions();}horizontal=vertical=tapToClose=false;}
 private void move(float value){float t=Math.max(-width,Math.min(width,value));content.setTranslationX(t);if(t>0)reveal(lead,trail);else if(t<0)reveal(trail,lead);else hideActions();}
 private boolean onContent(float px){float t=content.getTranslationX();return t>0?px>=t:t<0&&px<=getWidth()+t;}
 @Override public boolean onInterceptTouchEvent(MotionEvent e){
  if(!enabled)return false;
  if(e.getActionMasked()==MotionEvent.ACTION_DOWN){content.animate().cancel();x=e.getX();y=e.getY();start=content.getTranslationX();horizontal=vertical=false;tapToClose=start!=0&&onContent(x);return tapToClose;}
  if(e.getActionMasked()==MotionEvent.ACTION_MOVE&&!vertical){float dx=e.getX()-x,dy=e.getY()-y;if(Math.abs(dy)>slop&&Math.abs(dy)>=Math.abs(dx)){vertical=true;return false;}if(Math.abs(dx)>slop&&Math.abs(dx)>1.5f*Math.abs(dy)){horizontal=true;tapToClose=false;getParent().requestDisallowInterceptTouchEvent(true);opened.opened(this);return true;}}
  return horizontal;
 }
 @Override public boolean onTouchEvent(MotionEvent e){if(!enabled)return false;float dx=e.getX()-x,dy=e.getY()-y;switch(e.getActionMasked()){
  case MotionEvent.ACTION_MOVE:if(!horizontal&&Math.abs(dy)>slop&&Math.abs(dy)>=Math.abs(dx))vertical=true;if(!horizontal&&!vertical&&Math.abs(dx)>slop&&Math.abs(dx)>1.5f*Math.abs(dy)){horizontal=true;tapToClose=false;getParent().requestDisallowInterceptTouchEvent(true);opened.opened(this);}if(horizontal)move(start+dx);return true;
  case MotionEvent.ACTION_UP:{float t=content.getTranslationX();if(tapToClose||!horizontal||Math.abs(t)<width*.4f)close(true);else{content.animate().translationX(t>0?width:-width).setDuration(110).start();horizontal=false;}getParent().requestDisallowInterceptTouchEvent(false);return true;}
  case MotionEvent.ACTION_CANCEL:close(false);getParent().requestDisallowInterceptTouchEvent(false);return true;
  default:return true;
 }}
 @Override protected void onDetachedFromWindow(){close(false);super.onDetachedFromWindow();}
}
