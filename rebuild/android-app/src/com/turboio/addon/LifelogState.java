package com.turboio.addon;

import java.util.*;

/** Whether 全天智记 is on, as the stock App syncs it on every connect (LAUNCHER type 20
 * {"cmd":"life_log_switch","payload":{"value":1,...}}) or the glasses report it.
 *
 * 2026-10-23 (user: stock recording starts with 全天智记 on and shows no 退出全天智记 popup): stock
 * recording sends no idle query and never touches the switch; the firmware AlwaysOnStateMonitor
 * yields 全天智记 to the recorder by itself. The OTA idle predicate our voice preflight, voice stop
 * proof and card preflight read is busy whenever the 全天智记 setting is on (it checks top app, that
 * setting and AssistantService, never the recorder), so with 全天智记 known on a busy reply carries no
 * information and is read as idle. With 全天智记 off the full predicate still applies.
 * Pure JVM (built in the host-policy, voice and minute-card tests). */
final class LifelogState {
 private static volatile Integer on;
 private LifelogState(){}
 static void observe(String direction,byte[] bytes){
  if(bytes==null||bytes.length>8192)return;
  try{OtaFrame f=OtaFrame.decode(bytes);if(!(f.json instanceof Map))return;Map<?,?> root=(Map<?,?>)f.json;
   if(!"life_log_switch".equals(root.get("cmd"))||!(root.get("payload") instanceof Map))return;Object v=((Map<?,?>)root.get("payload")).get("value");
   if(v instanceof Number&&(((Number)v).intValue()==0||((Number)v).intValue()==1))on=((Number)v).intValue();
  }catch(RuntimeException unreadable){}
 }
 static boolean on(){Integer v=on;return v!=null&&v==1;}
 /** An OTA idle Result: true, or false that only 全天智记 can explain. */
 static boolean idle(Object result){
  if(Boolean.TRUE.equals(result))return true;
  if(Boolean.FALSE.equals(result)&&on()){System.out.println("TurboIOLifelog busy reply read as idle: 全天智记 on");return true;}
  return false;
 }
 static void reset(){on=null;}
 static void set(boolean value){on=value?1:0;}
}
