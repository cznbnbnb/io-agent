package com.turboio.addon;

import android.app.Activity;
import android.view.*;
import android.widget.*;
import java.util.*;

/** Tick-box rows for the bottom sheets. Tapping a row toggles it; pressing in the
 * tick column and dragging up or down gives every row passed the first row's new
 * state. A head row owns all keys of its group and shows partial when only some are chosen. */
final class MaterialSelect extends LinearLayout {
 private static final class Item {final View row;final MaterialReadingUI.Tick tick;final List<String> keys;Item(View row,MaterialReadingUI.Tick tick,List<String> keys){this.row=row;this.tick=tick;this.keys=keys;}}
 final Set<String> chosen=new LinkedHashSet<>();private final List<Item> items=new ArrayList<>();private final Runnable changed;private final int column,slop,edge;
 private boolean armed,dragging,target;private float downY;private int anchor=-1;private Set<String> before=Collections.emptySet();
 MaterialSelect(Activity a,Set<String> initial,Runnable changed){super(a);setOrientation(VERTICAL);chosen.addAll(initial);this.changed=changed;column=AgentUI.dp(a,84);slop=ViewConfiguration.get(a).getScaledTouchSlop();edge=AgentUI.dp(a,56);}
 /** Registers a row already placed somewhere inside this layout. */
 void add(View row,MaterialReadingUI.Tick tick,List<String> keys){Item item=new Item(row,tick,keys);items.add(item);row.setFocusable(true);row.setOnClickListener(v->{set(item,state(item)!=MaterialReadingUI.Tick.ALL);});tick.set(state(item));row.setSelected(state(item)!=MaterialReadingUI.Tick.NONE);}
 private int state(Item i){int n=0;for(String k:i.keys)if(chosen.contains(k))n++;return n==0?MaterialReadingUI.Tick.NONE:n==i.keys.size()?MaterialReadingUI.Tick.ALL:MaterialReadingUI.Tick.SOME;}
 private void set(Item i,boolean on){if(on)chosen.addAll(i.keys);else chosen.removeAll(i.keys);update();}
 boolean everything(){for(Item i:items)if(state(i)!=MaterialReadingUI.Tick.ALL)return false;return !items.isEmpty();}
 void setAll(boolean on){chosen.clear();if(on)for(Item i:items)chosen.addAll(i.keys);update();}
 private void update(){for(Item i:items){i.tick.set(state(i));i.row.setSelected(state(i)!=MaterialReadingUI.Tick.NONE);}changed.run();}
 private int at(float rawY){int[] loc=new int[2];for(int i=0;i<items.size();i++){View r=items.get(i).row;r.getLocationOnScreen(loc);if(rawY>=loc[1]&&rawY<loc[1]+r.getHeight())return i;}return -1;}
 private ScrollView scroller(){for(ViewParent p=getParent();p!=null;p=p.getParent())if(p instanceof ScrollView)return (ScrollView)p;return null;}
 @Override public boolean onInterceptTouchEvent(MotionEvent e){
  switch(e.getActionMasked()){
   case MotionEvent.ACTION_DOWN:dragging=false;armed=e.getX()<column&&(anchor=at(e.getRawY()))>=0;downY=e.getRawY();
    // Keep the sheet from scrolling while a drag may start in the tick column; a plain tap still reaches the row.
    if(armed)getParent().requestDisallowInterceptTouchEvent(true);return false;
   case MotionEvent.ACTION_MOVE:if(armed&&!dragging&&Math.abs(e.getRawY()-downY)>slop){dragging=true;target=state(items.get(anchor))!=MaterialReadingUI.Tick.ALL;before=new HashSet<>(chosen);apply(e.getRawY());return true;}return dragging;
   default:return dragging;
  }
 }
 @Override public boolean onTouchEvent(MotionEvent e){
  if(!dragging)return super.onTouchEvent(e);
  switch(e.getActionMasked()){
   case MotionEvent.ACTION_MOVE:{ScrollView scroll=scroller();if(scroll!=null){int[] loc=new int[2];scroll.getLocationOnScreen(loc);float y=e.getRawY();if(y<loc[1]+edge)scroll.scrollBy(0,-edge/4);else if(y>loc[1]+scroll.getHeight()-edge)scroll.scrollBy(0,edge/4);}apply(e.getRawY());return true;}
   case MotionEvent.ACTION_UP:case MotionEvent.ACTION_CANCEL:dragging=armed=false;return true;
   default:return true;
  }
 }
 private void apply(float rawY){int to=at(rawY);if(to<0)return;chosen.clear();chosen.addAll(before);for(int i=Math.min(anchor,to);i<=Math.max(anchor,to);i++){if(target)chosen.addAll(items.get(i).keys);else chosen.removeAll(items.get(i).keys);}update();}
}
