package com.turboio.addon;

import android.app.Activity;
import android.view.*;
import android.widget.*;
import java.time.*;
import java.time.format.DateTimeFormatter;
import java.util.*;
import java.util.function.Consumer;

/** Bottom sheets for acting on several materials at once: deleting official
 * events and exporting audio parts. Both start from the rows the user picked,
 * offer select-all and drag-select, and say exactly what will happen. */
final class MaterialBatch {
 private static final DateTimeFormatter CLOCK=DateTimeFormatter.ofPattern("HH:mm",Locale.ROOT);
 private static String clock(long time,ZoneId zone){return CLOCK.format(Instant.ofEpochMilli(time).atZone(zone));}
 private static long minutes(long start,long end){return Math.max(1,(end-start+59999)/60000);}

 /** One official event as the delete sheet shows it: its parts on this day and how many the user picked. */
 static final class Choice {
  final OfficialLifelogInsight.Event event;final long start,end;final int parts,picked;
  Choice(OfficialLifelogInsight.Event event,long start,long end,int parts,int picked){this.event=event;this.start=start;this.end=end;this.parts=parts;this.picked=picked;}
 }
 /** The official service deletes whole events, so the sheet lists events and warns when a pick covers only part of one. */
 static void delete(Activity a,List<Choice> choices,Set<String> preselected,ZoneId zone,int unmatched,Consumer<List<OfficialLifelogInsight.Event>> confirmed){
  MaterialReadingUI.Sheet sheet=new MaterialReadingUI.Sheet(a,"删除智记","原厂按整条智记删除，包含其中所有段落。按住勾选框上下拖动可连续选择。",0.55f);
  Map<String,View> notes=new HashMap<>();TextView[] confirm={null};MaterialSelect[] list={null};
  Runnable changed=()->{if(list[0]==null||confirm[0]==null)return;int events=0,segments=0;for(Choice c:choices){boolean on=list[0].chosen.contains(c.event.id);if(on){events++;segments+=c.parts;}notes.get(c.event.id).setVisibility(on&&c.picked>0&&c.picked<c.parts?View.VISIBLE:View.GONE);}
   confirm[0].setText(events==0?"请选择要删除的智记":"删除 "+events+" 条智记（"+segments+" 段）");confirm[0].setEnabled(events>0);confirm[0].setAlpha(events>0?1f:.4f);sheet.action.setText(list[0].everything()?"全不选":"全选");};
  list[0]=new MaterialSelect(a,preselected,changed);sheet.body.addView(list[0]);
  for(Choice c:choices){
   LinearLayout row=new LinearLayout(a);row.setGravity(Gravity.TOP);row.setPadding(AgentUI.dp(a,4),AgentUI.dp(a,6),AgentUI.dp(a,14),AgentUI.dp(a,10));row.setBackground(MaterialReadingUI.pressable(a,selectableCard(a)));
   MaterialReadingUI.Tick tick=MaterialReadingUI.tick(a,row,MaterialReadingUI.CORAL,MaterialReadingUI.ON_CORAL);
   LinearLayout text=AgentUI.column(a);text.setPadding(AgentUI.dp(a,4),AgentUI.dp(a,10),0,0);text.addView(MaterialReadingUI.bold(MaterialReadingUI.line(a,c.event.title.isEmpty()?"未命名智记":c.event.title,15,AgentUI.INK,1)));
   TextView meta=AgentUI.text(a,clock(c.start,zone)+"–"+clock(c.end,zone)+" · "+(c.parts>1?c.parts+" 段":"单段记录"),12,AgentUI.MUTED);meta.setPadding(0,AgentUI.dp(a,4),0,0);text.addView(meta);
   TextView note=AgentUI.text(a,"你只选了其中 "+c.picked+" 段；原厂会把这条智记的 "+c.parts+" 段一起删除。",12,MaterialReadingUI.AMBER_TEXT);note.setPadding(AgentUI.dp(a,10),AgentUI.dp(a,8),AgentUI.dp(a,10),AgentUI.dp(a,8));note.setBackground(MaterialReadingUI.fill(a,MaterialReadingUI.AMBER_BG,10));LinearLayout.LayoutParams np=new LinearLayout.LayoutParams(-1,-2);np.topMargin=AgentUI.dp(a,8);text.addView(note,np);notes.put(c.event.id,note);
   row.addView(text,new LinearLayout.LayoutParams(0,-2,1));row.setContentDescription((c.event.title.isEmpty()?"未命名智记":c.event.title)+"，"+c.parts+" 段");
   LinearLayout.LayoutParams rp=new LinearLayout.LayoutParams(-1,-2);rp.topMargin=AgentUI.dp(a,10);list[0].addView(row,rp);list[0].add(row,tick,Collections.singletonList(c.event.id));
  }
  if(unmatched>0){TextView skip=AgentUI.text(a,unmatched+" 段还没有对应到原厂智记，这次不能删除；刷新后再试。",12,AgentUI.MUTED);skip.setPadding(AgentUI.dp(a,4),AgentUI.dp(a,12),0,0);sheet.body.addView(skip);}
  LinearLayout info=new LinearLayout(a);info.setGravity(Gravity.CENTER_VERTICAL);info.setPadding(AgentUI.dp(a,4),AgentUI.dp(a,12),0,0);MaterialReadingUI.glyph(a,info,"folder",AgentUI.MUTED,16);TextView kept=AgentUI.text(a,"  已导出到手机的文档和音频会保留。",12,AgentUI.MUTED);info.addView(kept);sheet.footer.addView(info);
  LinearLayout buttons=new LinearLayout(a);buttons.setPadding(0,AgentUI.dp(a,14),0,0);MaterialReadingUI.sheetButton(a,buttons,"取消",MaterialReadingUI.RAISED,AgentUI.INK,1,sheet.dialog::dismiss);buttons.addView(new View(a),new LinearLayout.LayoutParams(AgentUI.dp(a,10),1));
  confirm[0]=MaterialReadingUI.sheetButton(a,buttons,"",MaterialReadingUI.CORAL,MaterialReadingUI.ON_CORAL,2,()->{List<OfficialLifelogInsight.Event> picked=new ArrayList<>();for(Choice c:choices)if(list[0].chosen.contains(c.event.id))picked.add(c.event);if(picked.isEmpty())return;sheet.dialog.dismiss();confirmed.accept(picked);});
  sheet.footer.addView(buttons);sheet.action("全选",()->list[0].setAll(!list[0].everything()));changed.run();sheet.show();
 }

 /** Audio parts grouped like the list; preselected rows are ticked and the save folder can be changed in place. */
 static void audio(Activity a,List<MaterialTimeline.Item> items,ZoneId zone,Set<String> preselected,Consumer<List<MaterialCatalog.Entry>> export){
  MaterialReadingUI.Sheet sheet=new MaterialReadingUI.Sheet(a,"导出音频",null,0.5f);
  LinearLayout folder=new LinearLayout(a);folder.setGravity(Gravity.CENTER_VERTICAL);folder.setPadding(AgentUI.dp(a,12),0,AgentUI.dp(a,10),0);folder.setBackground(MaterialReadingUI.pressable(a,MaterialReadingUI.fill(a,MaterialReadingUI.CARD,14)));MaterialReadingUI.glyph(a,folder,"folder",MaterialReadingUI.ACCENT_SOFT,20);
  TextView where=MaterialReadingUI.line(a,"",14,AgentUI.INK,1);where.setPadding(AgentUI.dp(a,10),0,0,0);folder.addView(where,new LinearLayout.LayoutParams(0,-2,1));folder.addView(AgentUI.text(a,"更改",13,AgentUI.MUTED));MaterialReadingUI.glyph(a,folder,"right",AgentUI.MUTED,14);
  Runnable label=()->where.setText("保存到 "+ExportDestination.label(a));label.run();folder.setFocusable(true);folder.setContentDescription("更改保存位置");folder.setOnClickListener(v->ExportDestination.settings(a,()->{if(sheet.dialog.isShowing())label.run();}));
  LinearLayout.LayoutParams fp=new LinearLayout.LayoutParams(-1,AgentUI.dp(a,48));fp.topMargin=AgentUI.dp(a,4);sheet.root.addView(folder,2+(sheet.root.getChildAt(2) instanceof TextView?1:0),fp);
  List<MaterialCatalog.Entry> all=new ArrayList<>();int total=0;for(MaterialTimeline.Item item:items){all.addAll(item.parts);total+=item.parts.size();}
  TextView hint=AgentUI.text(a,"这一天 "+total+" 段 · 按住勾选框上下拖动可连续选择",12,AgentUI.MUTED);hint.setPadding(AgentUI.dp(a,4),AgentUI.dp(a,12),0,AgentUI.dp(a,2));sheet.body.addView(hint);
  TextView[] confirm={null},summary={null};MaterialSelect[] list={null};
  Runnable changed=()->{if(list[0]==null||confirm[0]==null)return;int n=0;long mins=0;for(MaterialCatalog.Entry e:all)if(list[0].chosen.contains(e.id)){n++;mins+=minutes(MaterialTimeline.start(e),MaterialTimeline.end(e));}
   summary[0].setText(n==0?"还没有选择":"已选 "+n+" 段 · 约 "+mins+" 分钟");confirm[0].setText(n==0?"导出":"导出 "+n+" 段");confirm[0].setEnabled(n>0);confirm[0].setAlpha(n>0?1f:.4f);sheet.action.setText(list[0].everything()?"全不选":"全选");};
  list[0]=new MaterialSelect(a,preselected,changed);sheet.body.addView(list[0]);
  for(MaterialTimeline.Item item:items){
   LinearLayout card=AgentUI.column(a);card.setBackground(MaterialReadingUI.fill(a,MaterialReadingUI.CARD,16));card.setClipToOutline(true);LinearLayout.LayoutParams cp=new LinearLayout.LayoutParams(-1,-2);cp.topMargin=AgentUI.dp(a,10);list[0].addView(card,cp);
   List<String> keys=new ArrayList<>();for(MaterialCatalog.Entry e:item.parts)keys.add(e.id);
   LinearLayout head=new LinearLayout(a);head.setGravity(Gravity.CENTER_VERTICAL);head.setPadding(AgentUI.dp(a,4),AgentUI.dp(a,4),AgentUI.dp(a,14),AgentUI.dp(a,4));head.setBackground(MaterialReadingUI.pressable(a,selectable(a,MaterialReadingUI.ACCENT_SOFT)));MaterialReadingUI.Tick headTick=MaterialReadingUI.tick(a,head,MaterialReadingUI.ACCENT_SOFT,MaterialReadingUI.ON_ACCENT);
   LinearLayout text=AgentUI.column(a);text.setPadding(AgentUI.dp(a,4),0,0,0);text.addView(MaterialReadingUI.bold(MaterialReadingUI.line(a,item.title(),15,AgentUI.INK,1)));TextView meta=AgentUI.text(a,clock(item.start,zone)+"–"+clock(item.end,zone)+" · "+(item.group()?item.parts.size()+" 段":minutes(item.start,item.end)+" 分钟"),12,AgentUI.MUTED);meta.setPadding(0,AgentUI.dp(a,3),0,0);text.addView(meta);head.addView(text,new LinearLayout.LayoutParams(0,-2,1));
   head.setContentDescription(item.title()+"，"+item.parts.size()+" 段");card.addView(head);list[0].add(head,headTick,keys);
   if(!item.group())continue;
   for(MaterialCatalog.Entry part:item.parts){
    LinearLayout row=new LinearLayout(a);row.setGravity(Gravity.CENTER_VERTICAL);row.setPadding(AgentUI.dp(a,24),AgentUI.dp(a,2),AgentUI.dp(a,14),AgentUI.dp(a,2));row.setBackground(MaterialReadingUI.pressable(a,selectable(a,MaterialReadingUI.ACCENT_SOFT)));
    View rule=new View(a);rule.setBackgroundColor(MaterialReadingUI.LINE);LinearLayout.LayoutParams rp=new LinearLayout.LayoutParams(-1,AgentUI.dp(a,1));rp.leftMargin=AgentUI.dp(a,14);card.addView(rule,rp);
    MaterialReadingUI.Tick tick=MaterialReadingUI.tick(a,row,MaterialReadingUI.ACCENT_SOFT,MaterialReadingUI.ON_ACCENT);TextView title=MaterialReadingUI.line(a,part.title,14,AgentUI.INK,1);title.setPadding(AgentUI.dp(a,4),0,AgentUI.dp(a,8),0);row.addView(title,new LinearLayout.LayoutParams(0,-2,1));
    LinearLayout time=AgentUI.column(a);time.setGravity(Gravity.END);long s=MaterialTimeline.start(part),e=MaterialTimeline.end(part);time.addView(AgentUI.text(a,clock(s,zone)+"–"+clock(e,zone),12,MaterialReadingUI.SOFT));TextView length=AgentUI.text(a,minutes(s,e)+" 分钟",11,AgentUI.MUTED);length.setGravity(Gravity.END);time.addView(length);row.addView(time);
    row.setContentDescription(part.title+"，"+clock(s,zone)+"到"+clock(e,zone));card.addView(row);list[0].add(row,tick,Collections.singletonList(part.id));
   }
  }
  LinearLayout bottom=new LinearLayout(a);bottom.setGravity(Gravity.CENTER_VERTICAL);bottom.setPadding(AgentUI.dp(a,4),AgentUI.dp(a,14),0,0);LinearLayout words=AgentUI.column(a);summary[0]=MaterialReadingUI.bold(AgentUI.text(a,"",15,AgentUI.INK));words.addView(summary[0]);TextView how=AgentUI.text(a,"每段保存为一个 ZIP，解压即可播放",12,AgentUI.MUTED);how.setPadding(0,AgentUI.dp(a,3),0,0);words.addView(how);bottom.addView(words,new LinearLayout.LayoutParams(0,-2,1));
  confirm[0]=MaterialReadingUI.sheetButton(a,bottom,"",MaterialReadingUI.ACCENT_SOFT,MaterialReadingUI.ON_ACCENT,0,()->{List<MaterialCatalog.Entry> picked=new ArrayList<>();for(MaterialCatalog.Entry e:all)if(list[0].chosen.contains(e.id))picked.add(e);if(picked.isEmpty())return;picked.sort(MaterialTimeline.CHRONOLOGICAL);sheet.dialog.dismiss();export.accept(picked);});
  LinearLayout.LayoutParams bp=(LinearLayout.LayoutParams)confirm[0].getLayoutParams();bp.width=-2;confirm[0].setPadding(AgentUI.dp(a,22),0,AgentUI.dp(a,22),0);sheet.footer.addView(bottom);
  sheet.action("全选",()->list[0].setAll(!list[0].everything()));changed.run();sheet.show();
 }

 /** Pick one of the recent days for a one-off daily-summary sync. */
 static void syncDay(Activity a,ZoneId zone,String target,Consumer<LocalDate> start){
  MaterialReadingUI.Sheet sheet=new MaterialReadingUI.Sheet(a,"按日期同步","把所选日期的每日 AI 总结同步到 "+target+"。原厂通常只保留最近 3 天的日报；音频和转写不会上传。",0.5f);
  LocalDate today=LocalDate.now(zone);LocalDate[] picked={today};TextView[] confirm={null};List<MaterialReadingUI.Tick> ticks=new ArrayList<>();String[] week={"一","二","三","四","五","六","日"};
  LinearLayout card=AgentUI.column(a);card.setBackground(MaterialReadingUI.fill(a,MaterialReadingUI.CARD,16));card.setClipToOutline(true);LinearLayout.LayoutParams cp=new LinearLayout.LayoutParams(-1,-2);cp.topMargin=AgentUI.dp(a,10);sheet.body.addView(card,cp);
  for(int i=0;i<7;i++){LocalDate day=today.minusDays(i);if(i>0){View rule=new View(a);rule.setBackgroundColor(MaterialReadingUI.LINE);LinearLayout.LayoutParams rp=new LinearLayout.LayoutParams(-1,AgentUI.dp(a,1));rp.leftMargin=AgentUI.dp(a,14);card.addView(rule,rp);}
   LinearLayout row=new LinearLayout(a);row.setGravity(Gravity.CENTER_VERTICAL);row.setPadding(AgentUI.dp(a,4),0,AgentUI.dp(a,14),0);row.setBackground(MaterialReadingUI.pressable(a,null));MaterialReadingUI.Tick tick=MaterialReadingUI.tick(a,row,MaterialReadingUI.ACCENT_SOFT,MaterialReadingUI.ON_ACCENT);ticks.add(tick);
   String name=(i==0?"今天 · ":i==1?"昨天 · ":"")+day.getMonthValue()+"月"+day.getDayOfMonth()+"日 周"+week[day.getDayOfWeek().getValue()-1];row.addView(AgentUI.text(a,name,15,i<3?AgentUI.INK:AgentUI.MUTED),new LinearLayout.LayoutParams(0,-2,1));if(i>=3)row.addView(AgentUI.text(a,"可能已不可用",12,AgentUI.MUTED));
   final int index=i;row.setFocusable(true);row.setContentDescription(name);row.setOnClickListener(v->{picked[0]=day;for(int k=0;k<ticks.size();k++)ticks.get(k).set(k==index?MaterialReadingUI.Tick.ALL:MaterialReadingUI.Tick.NONE);confirm[0].setText("同步 "+day.getMonthValue()+"月"+day.getDayOfMonth()+"日");});
   card.addView(row,new LinearLayout.LayoutParams(-1,AgentUI.dp(a,52)));}
  ticks.get(0).set(MaterialReadingUI.Tick.ALL);
  LinearLayout buttons=new LinearLayout(a);buttons.setPadding(0,AgentUI.dp(a,16),0,0);MaterialReadingUI.sheetButton(a,buttons,"取消",MaterialReadingUI.RAISED,AgentUI.INK,1,sheet.dialog::dismiss);buttons.addView(new View(a),new LinearLayout.LayoutParams(AgentUI.dp(a,10),1));
  confirm[0]=MaterialReadingUI.sheetButton(a,buttons,"同步 "+today.getMonthValue()+"月"+today.getDayOfMonth()+"日",MaterialReadingUI.ACCENT_SOFT,MaterialReadingUI.ON_ACCENT,2,()->{sheet.dialog.dismiss();start.accept(picked[0]);});sheet.footer.addView(buttons);sheet.show();
 }
 /** Delete card: plain card, outlined in coral once chosen. */
 private static android.graphics.drawable.Drawable selectableCard(Activity a){android.graphics.drawable.StateListDrawable d=new android.graphics.drawable.StateListDrawable();android.graphics.drawable.GradientDrawable on=MaterialReadingUI.fill(a,MaterialReadingUI.CARD,16);on.setStroke(AgentUI.dp(a,1),0xff6e3a33);d.addState(new int[]{android.R.attr.state_selected},on);d.addState(new int[]{},MaterialReadingUI.fill(a,MaterialReadingUI.CARD,16));return d;}
 /** Row background that tints when the row is selected (MaterialSelect marks rows selected). */
 private static android.graphics.drawable.Drawable selectable(Activity a,int color){android.graphics.drawable.StateListDrawable d=new android.graphics.drawable.StateListDrawable();d.addState(new int[]{android.R.attr.state_selected},new android.graphics.drawable.ColorDrawable(color==MaterialReadingUI.CORAL?0x22e06b5d:0x2236c49b));d.addState(new int[]{},new android.graphics.drawable.ColorDrawable(0));return d;}
}
