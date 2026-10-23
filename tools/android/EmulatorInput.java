package com.turboio.androidtests;

import android.app.Activity;
import android.app.Instrumentation;
import android.app.UiAutomation;
import android.os.Bundle;
import android.util.Base64;
import android.view.accessibility.AccessibilityNodeInfo;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

/** Test-only accessibility text input; no product hooks or model/runtime substitutes. */
public final class EmulatorInput extends Instrumentation {
 private Bundle arguments;
 @Override public void onCreate(Bundle args){super.onCreate(args);arguments=args;start();}
 private static void fields(AccessibilityNodeInfo node,List<AccessibilityNodeInfo> found){
  if(node==null)return;
  if("com.rayneo.venus.pub".contentEquals(node.getPackageName())&&node.isEditable()&&node.isEnabled())found.add(node);
  for(int i=0;i<node.getChildCount();i++)fields(node.getChild(i),found);
 }
 @Override public void onStart(){
  Bundle result=new Bundle();
  try{
   String encoded=arguments.getString("text64");if(encoded==null||encoded.length()>400000)throw new IllegalArgumentException();
   String text=new String(Base64.decode(encoded,Base64.NO_WRAP),StandardCharsets.UTF_8);
   UiAutomation ui=getUiAutomation();ui.waitForIdle(200,3000);
   List<AccessibilityNodeInfo> found=new ArrayList<>();fields(ui.getRootInActiveWindow(),found);
   // Optional hint selects one field on multi-field pages; the target must still be unique.
   String hint=arguments.getString("hint");if(hint!=null)found.removeIf(n->n.getHintText()==null||!n.getHintText().toString().contains(hint));
   if(found.size()!=1)throw new IllegalStateException("Expected exactly one editable product field");
   Bundle value=new Bundle();value.putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE,text);
   if(!found.get(0).performAction(AccessibilityNodeInfo.ACTION_SET_TEXT,value))throw new IllegalStateException("Text action rejected");
   found.clear();fields(ui.getRootInActiveWindow(),found);if(hint!=null)found.removeIf(n->n.getHintText()==null||!n.getHintText().toString().contains(hint));
   if(found.size()!=1||!text.contentEquals(found.get(0).getText()))throw new IllegalStateException("Full text was not preserved");
   result.putBoolean("full_text_verified",true);result.putInt("utf8_bytes",text.getBytes(StandardCharsets.UTF_8).length);finish(Activity.RESULT_OK,result);
  }catch(Exception failure){result.putString("failure",failure.getClass().getSimpleName());finish(Activity.RESULT_CANCELED,result);}
 }
}
