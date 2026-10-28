package com.turboio.addon;

import android.content.Context;
import android.content.SharedPreferences;
import java.util.*;

/** Names the wearer gives sessions on this phone. Local only: they never reach the computer or change a
 * route, and a cleared name falls back to the name the session joined with. */
final class TaskNames {
 private TaskNames(){}
 private static final String PREF="io_agent_session_names_v1";static final int MAX=24;
 private static SharedPreferences prefs;
 static synchronized void init(Context context){if(prefs==null)prefs=context.getApplicationContext().getSharedPreferences(PREF,Context.MODE_PRIVATE);}
 static synchronized String get(Map<String,Object> route){if(prefs==null||route==null)return "";return prefs.getString(TaskSessionDirectory.routeKey(route),"");}
 static synchronized void set(Map<String,Object> route,String name){
  String clean=clean(name);SharedPreferences.Editor e=prefs.edit();String key=TaskSessionDirectory.routeKey(route);
  if(clean.isEmpty())e.remove(key);else e.putString(key,clean);e.apply();
 }
 /** One line, trimmed, at most MAX characters. */
 static String clean(String name){String s=name==null?"":name.replaceAll("\\s+"," ").trim();return s.codePointCount(0,s.length())>MAX?s.substring(0,s.offsetByCodePoints(0,MAX)):s;}
 /** The custom name when one is set, else what the session joined with. */
 static String title(Map<String,Object> route,String label,String agent){String own=get(route);return own.isEmpty()?TaskPresentation.sessionName(label,agent):own;}
}
