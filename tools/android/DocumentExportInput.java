package com.turboio.androidtests;
import android.app.*;import android.os.*;import android.view.accessibility.*;import java.util.*;
/** Set only the one system Save-As filename for this task's new export.
 * Self-targeted instrumentation leaves the product and its export picker alive. */
public final class DocumentExportInput extends Instrumentation {
 private String name;
 @Override public void onCreate(Bundle b){super.onCreate(b);name=b.getString("file_name","");start();}
 private static void visit(AccessibilityNodeInfo node,List<AccessibilityNodeInfo> fields){if(node==null)return;if("com.google.android.documentsui".contentEquals(node.getPackageName())&&node.isEditable()&&node.isEnabled()&&"android:id/title".equals(node.getViewIdResourceName()))fields.add(node);for(int i=0;i<node.getChildCount();i++)visit(node.getChild(i),fields);}
 @Override public void onStart(){Bundle out=new Bundle();try{if(!name.matches("io-agent-audio-export-20261024-codex-[a-f0-9]{6}\\.zip"))throw new IllegalArgumentException();android.app.UiAutomation ui=getUiAutomation();ui.waitForIdle(200,4000);List<AccessibilityNodeInfo> fields=new ArrayList<>();visit(ui.getRootInActiveWindow(),fields);if(fields.size()!=1)throw new IllegalStateException();Bundle args=new Bundle();args.putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE,name);if(!fields.get(0).performAction(AccessibilityNodeInfo.ACTION_SET_TEXT,args))throw new IllegalStateException();fields.clear();visit(ui.getRootInActiveWindow(),fields);if(fields.size()!=1||!name.contentEquals(fields.get(0).getText()))throw new IllegalStateException();out.putBoolean("file_name_verified",true);finish(Activity.RESULT_OK,out);}catch(Exception failure){out.putString("error",failure.getClass().getSimpleName());finish(Activity.RESULT_CANCELED,out);}}
}
