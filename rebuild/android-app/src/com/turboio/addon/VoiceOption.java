package com.turboio.addon;

import java.util.*;
import java.util.regex.*;

/** Maps a dictated answer to a choice question onto one option, deterministically, so a frozen
 * draft always replays to the same option. The full dictated text stays the answer text, which
 * keeps any extra conditions. Anything ambiguous ("不选二，选三") maps to no option. */
final class VoiceOption {
 // "选/选择/选项" may omit the unit ("选二"); "第" needs one, so "第一步" is not an option.
 private static final Pattern MARK=Pattern.compile("(?:选择|选项|选)\\s*([1-4一二两三四])(?!下)\\s*(?:个|项|号|条|种)?|第\\s*([1-4一二两三四])\\s*(?:个|项|号|条|种)");
 private static final Pattern LEAD=Pattern.compile("^\\s*([1-4一二两三四])\\s*(?:号|项|个|条|[.、，,：:。！!]|$)");
 private static final String FILLER="\\s，。,.、！!？?：:；;吧吗呢啊呀的了就我那嗯";
 private VoiceOption(){}
 private static int digit(String s){switch(s){case "1":case "一":return 1;case "2":case "二":case "两":return 2;case "3":case "三":return 3;case "4":case "四":return 4;default:return 0;}}
 /** Zero-based option index, or -1 when no single option number was said. */
 static int index(String text,int count){
  if(text==null||count<1)return -1;Set<Integer> said=new HashSet<>();
  Matcher m=MARK.matcher(text);while(m.find())said.add(digit(m.group(1)!=null?m.group(1):m.group(2)));
  Matcher lead=LEAD.matcher(text);if(lead.find())said.add(digit(lead.group(1)));
  if(said.size()!=1)return -1;int n=said.iterator().next();return n>=1&&n<=count?n-1:-1;
 }
 /** True when the text says more than the option number itself. */
 static boolean extra(String text){
  String rest=MARK.matcher(text).replaceAll("");rest=LEAD.matcher(rest).replaceFirst("");return !rest.replaceAll("["+FILLER+"]","").isEmpty();
 }
 /** Glasses confirm copy for a dictated choice, or null when no option was recognised. */
 static String confirmCopy(String text,List<String> labels,int limit){
  int i=index(text,labels.size());if(i<0)return null;String more=extra(text)?"；另有补充":"";
  String full="选"+(i+1)+"："+labels.get(i)+more;return full.length()<=limit?full:"选第"+(i+1)+"项"+more;
 }
}
