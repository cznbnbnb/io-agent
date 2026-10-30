package com.turboio.addon;

import android.app.Activity;
import android.animation.*;
import android.view.animation.DecelerateInterpolator;
import android.view.*;
import android.view.accessibility.AccessibilityNodeInfo;
import android.widget.*;
import java.time.LocalDate;
import java.util.*;
import java.util.function.Consumer;

/** Browsing weeks never selects a day. Only an explicit day click invokes picked. */
final class MaterialWeekStrip extends HorizontalScrollView {
 private static final int CENTER=3,PAGES=7;
 private final LinearLayout track;private final LinearLayout[] pages=new LinearLayout[PAGES];
 private final Consumer<LocalDate> picked,browsed;private final Runnable idle;private final Set<LocalDate> dates;
 private final LinearLayout[][] cells=new LinearLayout[PAGES][7];private final TextView[][] weekdays=new TextView[PAGES][7],numbers=new TextView[PAGES][7];private final View[][] dots=new View[PAGES][7];private LocalDate shownMonday;
 private final LocalDate selected;private final int slop;private boolean touching,moving,layingOut,disposed,vertical,cancelled;
 private float downX,downY;private int width,lastX;private long generation;
 private final Runnable check=this::checkSettled;private ValueAnimator animation;
 MaterialWeekStrip(Activity a,LocalDate selected,LocalDate shown,Set<LocalDate> dates,Consumer<LocalDate> picked,Consumer<LocalDate> browsed,Runnable idle){
  super(a);this.selected=selected;this.shownMonday=shown.minusDays(shown.getDayOfWeek().getValue()-1L);this.dates=new HashSet<>(dates);this.picked=picked;this.browsed=browsed;this.idle=idle;slop=ViewConfiguration.get(a).getScaledTouchSlop();
  setHorizontalScrollBarEnabled(false);setOverScrollMode(OVER_SCROLL_NEVER);setFillViewport(false);setClipToPadding(true);setSmoothScrollingEnabled(true);
  track=new LinearLayout(a);addView(track,new FrameLayout.LayoutParams(-2,AgentUI.dp(a,58)));
  for(int p=0;p<PAGES;p++){LinearLayout week=new LinearLayout(a);pages[p]=week;track.addView(week,new LinearLayout.LayoutParams(1,AgentUI.dp(a,58)));
   for(int i=0;i<7;i++){final LinearLayout cell=AgentUI.column(a);cells[p][i]=cell;cell.setGravity(Gravity.CENTER);
    TextView weekday=AgentUI.text(a,new String[]{"一","二","三","四","五","六","日"}[i],11,AgentUI.MUTED);weekdays[p][i]=weekday;weekday.setGravity(Gravity.CENTER);cell.addView(weekday);AgentUI.gap(a,cell,4);
    TextView number=MaterialReadingUI.bold(AgentUI.text(a,"",16,AgentUI.INK));numbers[p][i]=number;number.setGravity(Gravity.CENTER);cell.addView(number);AgentUI.gap(a,cell,4);
    View dot=new View(a);dots[p][i]=dot;cell.addView(dot,new LinearLayout.LayoutParams(AgentUI.dp(a,4),AgentUI.dp(a,4)));
    cell.setFocusable(true);cell.setOnClickListener(v->{if(!moving&&!disposed)picked.accept((LocalDate)cell.getTag());});LinearLayout.LayoutParams cp=new LinearLayout.LayoutParams(0,-1,1);cp.leftMargin=cp.rightMargin=AgentUI.dp(a,2);week.addView(cell,cp);
   }
  }
  bindDates(a);
 }
 private void bindDates(Activity a){for(int p=0;p<PAGES;p++)for(int i=0;i<7;i++){
  LocalDate day=shownMonday.plusWeeks(p-CENTER).plusDays(i);boolean on=day.equals(selected),has=dates.contains(day);LinearLayout cell=cells[p][i];cell.setTag(day);cell.setContentDescription(day+(has?"，有智记":"，暂无智记标记"));
  weekdays[p][i].setTextColor(on?MaterialReadingUI.ON_ACCENT:AgentUI.MUTED);numbers[p][i].setText(Integer.toString(day.getDayOfMonth()));numbers[p][i].setTextColor(on?MaterialReadingUI.ON_ACCENT:has?AgentUI.INK:MaterialReadingUI.DIM);
  dots[p][i].setBackground(MaterialReadingUI.fill(a,has?(on?MaterialReadingUI.ON_ACCENT:MaterialReadingUI.ACCENT_SOFT):0,2));cell.setBackground(on?MaterialReadingUI.fill(a,AgentUI.ACCENT,14):null);
 }}
 void updateDates(Set<LocalDate> values){if(dates.equals(values))return;dates.clear();dates.addAll(values);bindDates((Activity)getContext());}

 boolean busy(){return touching||moving;}
 @Override protected void onMeasure(int w,int h){int next=MeasureSpec.getSize(w)-getPaddingLeft()-getPaddingRight();if(next>0&&next!=width){width=next;for(LinearLayout page:pages)page.getLayoutParams().width=width;layingOut=true;}super.onMeasure(w,h);}
 @Override protected void onLayout(boolean changed,int l,int t,int r,int b){super.onLayout(changed,l,t,r,b);if(layingOut){scrollTo(CENTER*width,0);lastX=getScrollX();layingOut=false;}}
 @Override protected void onAttachedToWindow(){super.onAttachedToWindow();disposed=false;}
 @Override protected void onDetachedFromWindow(){disposed=true;generation++;cancelAnimation();touching=moving=false;removeCallbacks(check);super.onDetachedFromWindow();}
 @Override public boolean dispatchTouchEvent(MotionEvent e){
  int action=e.getActionMasked();if(action==MotionEvent.ACTION_DOWN){generation++;cancelAnimation();touching=true;cancelled=false;vertical=false;downX=e.getX();downY=e.getY();removeCallbacks(check);}
  if(action==MotionEvent.ACTION_MOVE&&!moving){float dx=Math.abs(e.getX()-downX),dy=Math.abs(e.getY()-downY);if(dy>slop&&dy>=dx)vertical=true;if(!vertical&&dx>slop&&dx>dy*1.5f)moving=true;}
  boolean handled=super.dispatchTouchEvent(e);
  if(action==MotionEvent.ACTION_UP||action==MotionEvent.ACTION_CANCEL){touching=false;cancelled=action==MotionEvent.ACTION_CANCEL;if(!disposed){lastX=getScrollX();if(cancelled){cancelAnimation();snapTo(CENTER*width,0);}else if(animation==null)queueCheck();}}
  return handled;
 }
 @Override public boolean onInterceptTouchEvent(MotionEvent e){if(vertical)return false;return super.onInterceptTouchEvent(e);}
 @Override protected void onScrollChanged(int x,int y,int oldX,int oldY){super.onScrollChanged(x,y,oldX,oldY);if(disposed||layingOut)return;moving=true;if(!touching&&animation==null){lastX=x;queueCheck();}}
 private void queueCheck(){removeCallbacks(check);postDelayed(check,80);}
 private void checkSettled(){
  if(disposed||touching||width<=0||animation!=null)return;int x=getScrollX();if(x!=lastX){lastX=x;queueCheck();return;}
  int target=cancelled?CENTER*width:pageTarget(x);
  if(x!=target){snapTo(target,0);return;}
  int delta=target/width-CENTER;long owner=++generation;
  // Never detach/replace a row inside native scroll or touch dispatch.
  post(()->{if(disposed||touching||owner!=generation)return;
   if(delta!=0){shownMonday=shownMonday.plusWeeks(delta);layingOut=true;bindDates((Activity)getContext());scrollTo(CENTER*width,0);lastX=getScrollX();layingOut=false;browsed.accept(shownMonday);}
   moving=false;idle.run();
  });
 }
 /** Own just the settle motion: native touch tracking stays 1:1, with no restart gap. */
 @Override public void fling(int velocityX){
  if(disposed||width<=0)return;float travel=Math.max(-2f*width,Math.min(2f*width,velocityX*.14f));
  snapTo(pageTarget(getScrollX()+travel),velocityX);
 }
 private int pageTarget(float x){return Math.max(CENTER-1,Math.min(CENTER+1,Math.round(x/width)))*width;}
 private void cancelAnimation(){ValueAnimator previous=animation;animation=null;if(previous!=null)previous.cancel();}
 private void snapTo(int requested,int velocity){
  if(disposed||width<=0)return;cancelAnimation();removeCallbacks(check);int target=pageTarget(requested),start=getScrollX();moving=true;
  if(start==target){lastX=start;queueCheck();return;}
  ValueAnimator next=ValueAnimator.ofInt(start,target);animation=next;long owner=generation;
  int distance=Math.abs(target-start);next.setDuration(Math.max(150,Math.min(340,160+distance*130/width)));next.setInterpolator(new DecelerateInterpolator(2f));
  next.addUpdateListener(value->{if(animation==next&&!disposed&&owner==generation)scrollTo((Integer)value.getAnimatedValue(),0);});
  next.addListener(new AnimatorListenerAdapter(){public void onAnimationEnd(Animator ignored){if(animation!=next)return;animation=null;if(disposed||owner!=generation)return;lastX=getScrollX();queueCheck();}});next.start();
 }
 @Override public void onInitializeAccessibilityNodeInfo(AccessibilityNodeInfo info){super.onInitializeAccessibilityNodeInfo(info);info.setScrollable(true);info.addAction(AccessibilityNodeInfo.AccessibilityAction.ACTION_SCROLL_FORWARD);info.addAction(AccessibilityNodeInfo.AccessibilityAction.ACTION_SCROLL_BACKWARD);}
 @Override public boolean performAccessibilityAction(int action,android.os.Bundle args){if(action==AccessibilityNodeInfo.ACTION_SCROLL_FORWARD||action==AccessibilityNodeInfo.ACTION_SCROLL_BACKWARD){snapTo(getScrollX()+(action==AccessibilityNodeInfo.ACTION_SCROLL_FORWARD?width:-width),0);return true;}return super.performAccessibilityAction(action,args);}
}
