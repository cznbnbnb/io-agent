package com.turboio.addon;

import android.app.Activity;
import android.content.res.ColorStateList;
import android.graphics.*;
import android.graphics.drawable.*;
import android.text.TextUtils;
import android.view.*;
import android.widget.*;
import java.util.*;

/** Small native pieces of the material reading design: glyphs, folds, chips
 * and a local trail sketch. No network: the trail is drawn without base tiles. */
final class MaterialReadingUI {
 static final int CARD=0xff1c1f1e,RAISED=0xff252a28,LINE=0xff262b29,SOFT=0xffc9cfcc,DIM=0xff5e6763,AMBER=0xfff0b455,ON_ACCENT=0xff04231a,ACCENT_SOFT=0xff36c49b,ACCENT_BG=0xff10332a;
 static final int[] SPEAKERS={0xff6fa8ff,AMBER,SOFT,0xffe58fb4,0xff8fd18a};

 static GradientDrawable fill(Activity a,int color,int radius){GradientDrawable d=new GradientDrawable();d.setColor(color);d.setCornerRadius(AgentUI.dp(a,radius));return d;}
 static GradientDrawable outline(Activity a,int radius){GradientDrawable d=new GradientDrawable();d.setColor(0);d.setCornerRadius(AgentUI.dp(a,radius));d.setStroke(AgentUI.dp(a,1),0xff2d3331);return d;}
 static Drawable pressable(Activity a,Drawable base){return new RippleDrawable(ColorStateList.valueOf(0x2636c49b),base,fill(a,0xffffffff,16));}
 /** Rounded only at the top and/or bottom, for cards split across list rows. */
 static GradientDrawable corners(Activity a,int color,int top,int bottom){GradientDrawable d=new GradientDrawable();d.setColor(color);float t=AgentUI.dp(a,top),b=AgentUI.dp(a,bottom);d.setCornerRadii(new float[]{t,t,t,t,b,b,b,b});return d;}
 /** A row that pages on a sideways swipe while taps still reach its children. */
 static final class SwipeRow extends LinearLayout {
  interface Pager{void page(int direction);}
  private final Pager pager;private final int slop,distance;private float downX,downY;private boolean dragging,vertical;
  SwipeRow(Activity a,Pager pager){super(a);this.pager=pager;slop=ViewConfiguration.get(a).getScaledTouchSlop();distance=AgentUI.dp(a,48);}
  @Override public boolean onInterceptTouchEvent(MotionEvent e){
   if(e.getActionMasked()==MotionEvent.ACTION_DOWN){downX=e.getX();downY=e.getY();dragging=vertical=false;animate().cancel();setTranslationX(0);return false;}
   if(e.getActionMasked()==MotionEvent.ACTION_MOVE){float dx=e.getX()-downX,dy=e.getY()-downY;if(vertical)return false;if(Math.abs(dy)>slop&&Math.abs(dy)>=Math.abs(dx)){vertical=true;return false;}if(Math.abs(dx)>slop&&Math.abs(dx)>Math.abs(dy)*1.5f){dragging=true;getParent().requestDisallowInterceptTouchEvent(true);return true;}}
   return false;
  }
  @Override public boolean onTouchEvent(MotionEvent e){
   float dx=e.getX()-downX;
   switch(e.getActionMasked()){
    case MotionEvent.ACTION_DOWN:downX=e.getX();downY=e.getY();return true;
    case MotionEvent.ACTION_MOVE:if(dragging)setTranslationX(dx*0.35f);return true;
    case MotionEvent.ACTION_UP:animate().translationX(0).setDuration(120).start();if(dragging&&Math.abs(dx)>=distance)pager.page(dx<0?1:-1);dragging=false;getParent().requestDisallowInterceptTouchEvent(false);return true;
    case MotionEvent.ACTION_CANCEL:animate().translationX(0).setDuration(120).start();dragging=false;getParent().requestDisallowInterceptTouchEvent(false);return true;
    default:return true;
   }
  }
 }
 static LinearLayout card(Activity a,LinearLayout parent,int topMargin){LinearLayout c=AgentUI.column(a);c.setBackground(fill(a,CARD,16));LinearLayout.LayoutParams p=new LinearLayout.LayoutParams(-1,-2);p.topMargin=AgentUI.dp(a,topMargin);parent.addView(c,p);return c;}
 static TextView line(Activity a,String value,int size,int color,int lines){TextView t=AgentUI.text(a,value,size,color);if(lines>0){t.setMaxLines(lines);t.setEllipsize(TextUtils.TruncateAt.END);}return t;}
 static TextView bold(TextView t){t.setTypeface(Typeface.create("sans-serif-medium",Typeface.NORMAL));return t;}
 static TextView chip(Activity a,LinearLayout parent,String label,int color,int background){TextView t=AgentUI.text(a,label,12,color);t.setGravity(Gravity.CENTER_VERTICAL);t.setPadding(AgentUI.dp(a,8),0,AgentUI.dp(a,8),0);t.setBackground(fill(a,background,6));LinearLayout.LayoutParams p=new LinearLayout.LayoutParams(-2,AgentUI.dp(a,24));p.rightMargin=AgentUI.dp(a,8);parent.addView(t,p);return t;}
 /** Plain one-paragraph preview of an official summary (drops markdown marks). */
 static String plain(String summary){StringBuilder out=new StringBuilder();for(String raw:summary.split("\n")){String s=raw.replace("**","").replaceFirst("^\\s*(#+|[-*•]|\\d+[.、)])\\s*","").trim();if(s.isEmpty())continue;if(out.length()>0)out.append(' ');out.append(s);}return out.toString();}
 /** Readable full summary: markdown marks dropped, list items kept as lines. */
 static String readable(String summary){StringBuilder out=new StringBuilder();for(String raw:summary.split("\n")){String s=raw.replace("**","").replaceFirst("^\\s*#+\\s*","").replaceFirst("^\\s*[-*]\\s+","• ").trim();if(s.isEmpty()){if(out.length()>0&&out.charAt(out.length()-1)!='\n')out.append('\n');continue;}if(out.length()>0)out.append('\n');out.append(s);}return out.toString().trim();}

 /** Stroke glyphs drawn on a 24-unit grid. */
 static final class Glyph extends View {
  private final Paint paint=new Paint(Paint.ANTI_ALIAS_FLAG);private final String name;private int color;private float turn;
  Glyph(Activity a,String name,int color){super(a);this.name=name;this.color=color;setImportantForAccessibility(IMPORTANT_FOR_ACCESSIBILITY_NO);}
  void rotate(float degrees){turn=degrees;invalidate();}
  @Override protected void onDraw(Canvas c){float s=Math.min(getWidth(),getHeight())/24f;c.save();c.translate((getWidth()-24*s)/2,(getHeight()-24*s)/2);c.scale(s,s);c.rotate(turn,12,12);paint.setColor(color);paint.setStyle(Paint.Style.STROKE);paint.setStrokeWidth(2f);paint.setStrokeCap(Paint.Cap.ROUND);paint.setStrokeJoin(Paint.Join.ROUND);Path p=new Path();
   switch(name){
    case "down":p.moveTo(6,9);p.lineTo(12,15);p.lineTo(18,9);break;
    case "right":p.moveTo(9,6);p.lineTo(15,12);p.lineTo(9,18);break;
    case "refresh":{float r=7.5f,from=-60,sweep=300;p.addArc(new RectF(12-r,12-r,12+r,12+r),from,sweep);double end=Math.toRadians(from+sweep);float tx=12+(float)(r*Math.cos(end)),ty=12+(float)(r*Math.sin(end));
     // Arrow head at the arc's end, pointing along its clockwise direction.
     float dx=(float)-Math.sin(end),dy=(float)Math.cos(end),nx=(float)Math.cos(end),ny=(float)Math.sin(end);p.moveTo(tx-3.5f*dx+3*nx,ty-3.5f*dy+3*ny);p.lineTo(tx,ty);p.lineTo(tx-3.5f*dx-3*nx,ty-3.5f*dy-3*ny);break;}
    case "sort":p.moveTo(7,4);p.lineTo(7,20);p.moveTo(3,16);p.lineTo(7,20);p.lineTo(11,16);p.moveTo(17,20);p.lineTo(17,4);p.moveTo(13,8);p.lineTo(17,4);p.lineTo(21,8);break;
    case "pin":p.moveTo(12,21);p.cubicTo(12,21,5,14.8f,5,9.5f);p.arcTo(new RectF(5,2.5f,19,16.5f),180,180);p.cubicTo(19,14.8f,12,21,12,21);p.addCircle(12,9.5f,2.5f,Path.Direction.CW);break;
    case "spark":p.moveTo(12,3);p.lineTo(13.8f,7.7f);p.lineTo(18.5f,9.5f);p.lineTo(13.8f,11.3f);p.lineTo(12,16);p.lineTo(10.2f,11.3f);p.lineTo(5.5f,9.5f);p.lineTo(10.2f,7.7f);p.close();p.moveTo(19,15);p.lineTo(19.8f,17.2f);p.lineTo(22,18);p.lineTo(19.8f,18.8f);p.lineTo(19,21);p.lineTo(18.2f,18.8f);p.lineTo(16,18);p.lineTo(18.2f,17.2f);p.close();break;
    case "export":p.moveTo(12,15);p.lineTo(12,3);p.moveTo(7,8);p.lineTo(12,3);p.lineTo(17,8);p.moveTo(5,14);p.lineTo(5,19);p.quadTo(5,21,7,21);p.lineTo(17,21);p.quadTo(19,21,19,19);p.lineTo(19,14);break;
    case "trash":p.moveTo(4,6);p.lineTo(20,6);p.moveTo(9,6);p.lineTo(9,3);p.lineTo(15,3);p.lineTo(15,6);p.moveTo(6,6);p.lineTo(7,21);p.lineTo(17,21);p.lineTo(18,6);p.moveTo(10,10);p.lineTo(10,17);p.moveTo(14,10);p.lineTo(14,17);break;
    case "audio":p.moveTo(4,10);p.lineTo(4,14);p.moveTo(8,6);p.lineTo(8,18);p.moveTo(12,3);p.lineTo(12,21);p.moveTo(16,7);p.lineTo(16,17);p.moveTo(20,10);p.lineTo(20,14);break;
    case "document":p.moveTo(5,3);p.lineTo(14,3);p.lineTo(19,8);p.lineTo(19,21);p.lineTo(5,21);p.close();p.moveTo(14,3);p.lineTo(14,8);p.lineTo(19,8);p.moveTo(8,12);p.lineTo(16,12);p.moveTo(8,16);p.lineTo(16,16);break;
    case "check":p.moveTo(5,12.5f);p.lineTo(10,17);p.lineTo(19,7.5f);break;
    case "alert":p.moveTo(12,6.5f);p.lineTo(12,13.5f);p.moveTo(12,17.5f);p.lineTo(12,17.6f);break;
    case "arc":p.addArc(new RectF(4,4,20,20),-90,250);break;
    case "pause":p.moveTo(9,6.5f);p.lineTo(9,17.5f);p.moveTo(15,6.5f);p.lineTo(15,17.5f);break;
    case "clock":p.addCircle(12,12,8,Path.Direction.CW);p.moveTo(12,7.5f);p.lineTo(12,12);p.lineTo(15,14);break;
    default:p.addCircle(12,12,8,Path.Direction.CW);
   }
   c.drawPath(p,paint);c.restore();}
 }
 static Glyph glyph(Activity a,LinearLayout parent,String name,int color,int size){Glyph g=new Glyph(a,name,color);parent.addView(g,new LinearLayout.LayoutParams(AgentUI.dp(a,size),AgentUI.dp(a,size)));return g;}

 /** A card whose body is built only when first opened, keeping long transcripts off the first layout pass. */
 static final class Fold {
  final LinearLayout card,content;private final Glyph chevron;private final TextView action;private final java.util.function.Consumer<LinearLayout> build;private boolean open,built;
  Fold(Activity a,LinearLayout parent,String title,String count,boolean initiallyOpen,java.util.function.Consumer<LinearLayout> build){
   this.build=build;card=card(a,parent,16);LinearLayout head=new LinearLayout(a);head.setGravity(Gravity.CENTER_VERTICAL);head.setPadding(AgentUI.dp(a,14),0,AgentUI.dp(a,10),0);head.setMinimumHeight(AgentUI.dp(a,52));head.setBackground(pressable(a,null));head.setFocusable(true);head.setClickable(true);
   head.addView(bold(AgentUI.text(a,title,16,AgentUI.INK)));TextView n=AgentUI.text(a,count,12,AgentUI.MUTED);n.setPadding(AgentUI.dp(a,8),0,0,0);head.addView(n,new LinearLayout.LayoutParams(0,-2,1));action=AgentUI.text(a,"",12,AgentUI.MUTED);head.addView(action);chevron=glyph(a,head,"down",AgentUI.MUTED,18);
   card.addView(head,new LinearLayout.LayoutParams(-1,-2));content=AgentUI.column(a);content.setPadding(AgentUI.dp(a,14),0,AgentUI.dp(a,14),AgentUI.dp(a,12));card.addView(content,new LinearLayout.LayoutParams(-1,-2));
   head.setContentDescription(title+"，"+count);head.setOnClickListener(v->set(!open));set(initiallyOpen);
  }
  boolean isOpen(){return open;}
  void set(boolean value){open=value;if(open&&!built){built=true;build.accept(content);}content.setVisibility(open?View.VISIBLE:View.GONE);action.setText(open?"收起":"展开");chevron.rotate(open?180:0);}
 }

 /** Day trail sketch: route, stay circles, start ring and end dot. */
 static final class TrailView extends View {
  private final List<OfficialLifelogInsight.Point> points;private final Paint paint=new Paint(Paint.ANTI_ALIAS_FLAG);private final float density;
  TrailView(Activity a,List<OfficialLifelogInsight.Point> points){super(a);this.points=new ArrayList<>(points);density=a.getResources().getDisplayMetrics().density;setImportantForAccessibility(IMPORTANT_FOR_ACCESSIBILITY_NO);}
  @Override protected void onDraw(Canvas c){
   int w=getWidth(),h=getHeight();c.drawColor(0xff16201c);paint.setStyle(Paint.Style.STROKE);paint.setStrokeWidth(density);paint.setColor(0xff22302b);float step=24*density;for(float x=step;x<w;x+=step)c.drawLine(x,0,x,h,paint);for(float y=step;y<h;y+=step)c.drawLine(0,y,w,y,paint);
   if(points.isEmpty())return;double minLat=90,maxLat=-90,minLng=180,maxLng=-180;for(OfficialLifelogInsight.Point p:points){minLat=Math.min(minLat,p.lat());maxLat=Math.max(maxLat,p.lat());minLng=Math.min(minLng,p.lng());maxLng=Math.max(maxLng,p.lng());}
   double k=Math.cos(Math.toRadians((minLat+maxLat)/2)),spanX=Math.max((maxLng-minLng)*k,0.0004),spanY=Math.max(maxLat-minLat,0.0004);float pad=22*density;double scale=Math.min((w-2*pad)/spanX,(h-2*pad)/spanY);
   double cx=(minLng+maxLng)/2,cy=(minLat+maxLat)/2;float[] xs=new float[points.size()],ys=new float[points.size()];for(int i=0;i<points.size();i++){xs[i]=(float)(w/2.0+(points.get(i).lng()-cx)*k*scale);ys[i]=(float)(h/2.0-(points.get(i).lat()-cy)*scale);}
   paint.setColor(AgentUI.ACCENT);paint.setStrokeWidth(3*density);paint.setStrokeCap(Paint.Cap.ROUND);paint.setStrokeJoin(Paint.Join.ROUND);Path route=new Path();route.moveTo(xs[0],ys[0]);for(int i=1;i<xs.length;i++)route.lineTo(xs[i],ys[i]);c.drawPath(route,paint);
   paint.setStyle(Paint.Style.FILL);for(int i=0;i<xs.length;i++)if(points.get(i).stay()){paint.setColor(0x2e02a97b);c.drawCircle(xs[i],ys[i],14*density,paint);paint.setColor(AgentUI.ACCENT);c.drawCircle(xs[i],ys[i],5*density,paint);}
   paint.setColor(0xff16201c);c.drawCircle(xs[0],ys[0],5*density,paint);paint.setStyle(Paint.Style.STROKE);paint.setStrokeWidth(2*density);paint.setColor(ACCENT_SOFT);c.drawCircle(xs[0],ys[0],5*density,paint);
   paint.setStyle(Paint.Style.FILL);paint.setColor(AgentUI.ACCENT);c.drawCircle(xs[xs.length-1],ys[ys.length-1],6*density,paint);
  }
 }
}
