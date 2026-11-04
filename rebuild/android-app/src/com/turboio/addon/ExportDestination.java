package com.turboio.addon;

import android.app.*;
import android.content.*;
import android.net.Uri;
import android.os.*;
import android.provider.*;
import java.io.*;
import java.util.concurrent.*;

/** User-selected SAF directory, or app-created files in Download/IO 文档. */
public final class ExportDestination extends Fragment {
 private static final String PREF="io_export_destination_v1",TREE="tree",LABEL="label";
 private static final int PICK=14535;private Runnable changed;
 private static final ExecutorService IO=Executors.newSingleThreadExecutor();
 private static final Handler MAIN=new Handler(Looper.getMainLooper());
 interface Writer {void write(OutputStream output)throws Exception;}
 static String label(Context context){return context.getSharedPreferences(PREF,0).getString(LABEL,"Download/IO 文档");}
 static void settings(Activity a,Runnable changed){
  AgentUI.Screen screen=new AgentUI.Screen(a,"默认保存位置");
  AgentUI.summary(a,screen.body,"folder-open","导出到手机",label(a));AgentUI.gap(a,screen.body,18);screen.body.addView(AgentUI.text(a,"音频与带时间、标签的摘要文档，都会保存到这个文件夹。",14,AgentUI.MUTED));
  AgentUI.button(a,screen.dock,"选择文件夹",true,()->{screen.dialog.dismiss();ExportDestination picker=new ExportDestination();picker.changed=changed;a.getFragmentManager().beginTransaction().add(picker,"io-export-directory").commit();});
  AgentUI.button(a,screen.body,"恢复默认文件夹",false,()->{Context app=a.getApplicationContext();IO.execute(()->{boolean ok=app.getSharedPreferences(PREF,0).edit().remove(TREE).remove(LABEL).commit();MAIN.post(()->{if(!a.isDestroyed()){screen.dialog.dismiss();AgentUI.notice(a,ok?"已恢复默认保存位置":"保存位置未能更新");changed.run();}});});});
  screen.body.addView(AgentUI.text(a,"首次导出时自动创建 IO 文档文件夹。同名导出另存，不覆盖已有文件。",13,AgentUI.MUTED));
  screen.dialog.setOnDismissListener(d->changed.run());
 }
 @Override public void onCreate(Bundle saved){super.onCreate(saved);if(saved==null)try{startActivityForResult(new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION|Intent.FLAG_GRANT_WRITE_URI_PERMISSION|Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION|Intent.FLAG_GRANT_PREFIX_URI_PERMISSION),PICK);}catch(RuntimeException error){finish("无法打开文件夹选择器");}}
 @Override public void onActivityResult(int request,int result,Intent data){super.onActivityResult(request,result,data);if(request!=PICK)return;if(result!=Activity.RESULT_OK||data==null||data.getData()==null){finish(null);return;}Activity a=getActivity();if(a==null)return;Context app=a.getApplicationContext();Uri uri=data.getData();int flags=data.getFlags()&(Intent.FLAG_GRANT_READ_URI_PERMISSION|Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
  IO.execute(()->{String message;try{if((flags&Intent.FLAG_GRANT_WRITE_URI_PERMISSION)==0||!DocumentsContract.isTreeUri(uri))throw new IOException();app.getContentResolver().takePersistableUriPermission(uri,flags);String name="所选文件夹";Uri document=DocumentsContract.buildDocumentUriUsingTree(uri,DocumentsContract.getTreeDocumentId(uri));try(android.database.Cursor c=app.getContentResolver().query(document,new String[]{DocumentsContract.Document.COLUMN_DISPLAY_NAME},null,null,null)){if(c!=null&&c.moveToFirst())name=c.getString(0);}if(!app.getSharedPreferences(PREF,0).edit().putString(TREE,uri.toString()).putString(LABEL,name).commit())throw new IOException();message="默认保存位置已更新";}catch(Exception failure){message="没有取得文件夹写入权限，请重新选择";}String done=message;MAIN.post(()->finish(done));});
 }
 private void finish(String message){Activity a=getActivity();if(changed!=null&&a!=null&&!a.isDestroyed())changed.run();if(a!=null&&message!=null)AgentUI.notice(a,message);if(isAdded())getFragmentManager().beginTransaction().remove(this).commitAllowingStateLoss();}
 /** Invoked off the UI thread. Deletes only a newly created, incomplete output. */
 static String write(Context app,String name,String mime,Writer writer)throws Exception{
  if(name==null||name.isEmpty()||name.length()>200||name.contains("/")||name.contains("\\")||name.indexOf('\0')>=0)throw new IOException("EXPORT_NAME_INVALID");
  ContentResolver resolver=app.getContentResolver();String tree=app.getSharedPreferences(PREF,0).getString(TREE,"");String destinationLabel=label(app);Uri made=null;boolean done=false;
  try{
   if(tree.isEmpty()){ContentValues values=new ContentValues();values.put(MediaStore.MediaColumns.DISPLAY_NAME,name);values.put(MediaStore.MediaColumns.MIME_TYPE,mime);values.put(MediaStore.MediaColumns.RELATIVE_PATH,Environment.DIRECTORY_DOWNLOADS+"/IO 文档/");values.put(MediaStore.MediaColumns.IS_PENDING,1);made=resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI,values);}
   else{Uri uri=Uri.parse(tree);boolean granted=false;for(UriPermission permission:resolver.getPersistedUriPermissions())if(permission.getUri().equals(uri)&&permission.isWritePermission())granted=true;if(!granted)throw new IOException("EXPORT_DIRECTORY_UNAVAILABLE");made=DocumentsContract.createDocument(resolver,DocumentsContract.buildDocumentUriUsingTree(uri,DocumentsContract.getTreeDocumentId(uri)),mime,name);}
   if(made==null)throw new IOException("EXPORT_DIRECTORY_UNAVAILABLE");try(OutputStream stream=resolver.openOutputStream(made,"w")){if(stream==null)throw new IOException("EXPORT_DIRECTORY_UNAVAILABLE");writer.write(stream);stream.flush();}
   if(tree.isEmpty()){ContentValues values=new ContentValues();values.put(MediaStore.MediaColumns.IS_PENDING,0);if(resolver.update(made,values,null,null)!=1)throw new IOException("EXPORT_PUBLISH_FAILED");}
   String actualName=name;try(android.database.Cursor cursor=resolver.query(made,new String[]{MediaStore.MediaColumns.DISPLAY_NAME},null,null,null)){if(cursor!=null&&cursor.moveToFirst())actualName=cursor.getString(0);}done=true;return destinationLabel+"/"+actualName;
  }finally{if(!done&&made!=null)try{if(tree.isEmpty())resolver.delete(made,null,null);else DocumentsContract.deleteDocument(resolver,made);}catch(Exception ignored){}}
 }
}
