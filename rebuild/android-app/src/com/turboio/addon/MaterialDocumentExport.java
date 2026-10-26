package com.turboio.addon;

import android.app.*;import android.content.*;import android.net.Uri;import android.os.*;import android.widget.Toast;
import java.io.*;import java.lang.ref.WeakReference;import java.util.concurrent.*;

/** Restorable picker with exact bytes prepared in a bounded private cache. */
public final class MaterialDocumentExport extends Fragment {
 private static final int REQUEST=14532;
 private static final ExecutorService IO=Executors.newSingleThreadExecutor();
 private static final Handler MAIN=new Handler(Looper.getMainLooper());
 private boolean launched,finished,working;private String pendingUri,completion;private int persistedFlags;
 static void summary(Activity activity,String account,MaterialCatalog.Entry entry,OfficialLifelogInsight.Event event){summary(activity,account,entry,event,false);}
 static void summary(Activity activity,String account,MaterialCatalog.Entry entry,OfficialLifelogInsight.Event event,boolean whole){
  Context app=activity.getApplicationContext();WeakReference<Activity> host=new WeakReference<>(activity);Toast.makeText(activity,"正在保存摘要文档…",Toast.LENGTH_SHORT).show();
  IO.execute(()->{try{notify(host,"已保存到 "+writeSummary(app,account,entry,event,whole));}catch(Exception failed){notify(host,"MATERIAL_SUMMARY_UNAVAILABLE".equals(failed.getMessage())?"原厂尚未生成这条记录的 AI 总结":"保存失败，请检查默认保存位置后重试");}});
 }
 private static String writeSummary(Context app,String account,MaterialCatalog.Entry entry,OfficialLifelogInsight.Event event,boolean whole)throws Exception{
  OfficialAccountBinding current=Host107Login.account();MaterialWire.require(current!=null&&account.equals(current.binding),"OFFICIAL_ACCOUNT_CHANGED");byte[] bytes=MaterialDocument.summary(entry,event,MaterialDocument.Format.DOCX,whole);MaterialWire.require(bytes.length<=MaterialExportCache.MAX_BYTES,"MATERIAL_EXPORT_BUDGET");
  return ExportDestination.write(app,MaterialDocument.filename(entry,MaterialDocument.Format.DOCX).replace("iO-","iO-摘要-"),MaterialDocument.Format.DOCX.mime,out->{OfficialAccountBinding fresh=Host107Login.account();MaterialWire.require(fresh!=null&&account.equals(fresh.binding),"OFFICIAL_ACCOUNT_CHANGED");out.write(bytes);});
 }
 /** One summary document: a whole official event, or one part of it. */
 static final class Job {final MaterialCatalog.Entry entry;final OfficialLifelogInsight.Event event;final boolean whole;Job(MaterialCatalog.Entry entry,OfficialLifelogInsight.Event event,boolean whole){this.entry=entry;this.event=event;this.whole=whole;}}
 /** Several documents in one background pass, reported once. */
 static void summaries(Activity activity,String account,java.util.List<Job> jobs){
  if(jobs.isEmpty())return;if(jobs.size()==1){Job j=jobs.get(0);summary(activity,account,j.entry,j.event,j.whole);return;}
  Context app=activity.getApplicationContext();WeakReference<Activity> host=new WeakReference<>(activity);Toast.makeText(activity,"正在保存 "+jobs.size()+" 份摘要文档…",Toast.LENGTH_SHORT).show();
  IO.execute(()->{int saved=0,missing=0,failed=0;for(Job j:jobs){try{writeSummary(app,account,j.entry,j.event,j.whole);saved++;}catch(Exception f){if("MATERIAL_SUMMARY_UNAVAILABLE".equals(f.getMessage()))missing++;else failed++;}}
   notify(host,(saved>0?"已保存 "+saved+" 份摘要文档到 "+ExportDestination.label(app):"没有保存文档")+(missing>0?"；"+missing+" 份原厂尚未生成 AI 总结":"")+(failed>0?"；"+failed+" 份保存失败，请检查保存位置":""));});
 }
 static void save(Activity activity,String account,MaterialCatalog.Entry entry,MaterialDocument.Format format){
  Context app=activity.getApplicationContext();WeakReference<Activity> host=new WeakReference<>(activity);Toast.makeText(activity,"正在准备文档…",Toast.LENGTH_SHORT).show();
  IO.execute(()->{MaterialExportCache.Draft draft=null;try{OfficialAccountBinding current=Host107Login.account();MaterialWire.require(current!=null&&account.equals(current.binding),"OFFICIAL_ACCOUNT_CHANGED");draft=MaterialExportCache.prepare(app.getCacheDir(),account,entry,format,System.currentTimeMillis());}catch(Exception failed){notify(host,"文档准备失败，请重新打开资料后重试");}
   if(draft==null)return;MaterialExportCache.Draft ready=draft;MAIN.post(()->{Activity a=host.get();if(a==null||a.isFinishing()||a.isDestroyed()){IO.execute(()->cleanup(app,ready.id));return;}MaterialDocumentExport picker=new MaterialDocumentExport();Bundle args=new Bundle();args.putString("id",ready.id);args.putString("account",ready.account);args.putString("format",ready.format);args.putString("title",ready.title);picker.setArguments(args);try{a.getFragmentManager().beginTransaction().add(picker,"io-material-export-"+ready.id).commit();}catch(RuntimeException stopped){IO.execute(()->cleanup(app,ready.id));notify(host,"页面已切换，请重新选择导出");}});
  });
 }
 @Override public void onCreate(Bundle state){super.onCreate(state);setRetainInstance(true);if(state!=null){launched=state.getBoolean("launched",false);finished=state.getBoolean("finished",false);pendingUri=state.getString("pending_uri");persistedFlags=state.getInt("persisted_flags",0);completion=state.getString("completion");}}
 @Override public void onSaveInstanceState(Bundle state){state.putBoolean("launched",launched);state.putBoolean("finished",finished);state.putString("pending_uri",pendingUri);state.putInt("persisted_flags",persistedFlags);state.putString("completion",completion);super.onSaveInstanceState(state);}
 @Override public void onActivityCreated(Bundle state){super.onActivityCreated(state);if(finished){deliverCompletion();return;}if(getArguments()==null){fail("导出准备已失效，请重新选择导出");return;}if(working)return;if(pendingUri!=null){writeResult(Uri.parse(pendingUri));return;}if(!launched)preparePicker();else validateWaiting();}
 private void validateWaiting(){Activity a=getActivity();if(a==null)return;Context app=a.getApplicationContext();Bundle args=new Bundle(getArguments());IO.execute(()->{boolean valid=true;try{MaterialExportCache.Draft draft=load(app,args);MaterialExportCache.bytes(app.getCacheDir(),draft,System.currentTimeMillis());}catch(Exception failed){valid=false;}boolean ready=valid;MAIN.post(()->{if(!ready&&!finished&&!working&&pendingUri==null&&isAdded())fail("导出准备已失效，请重新选择导出");});});}
 private void preparePicker(){working=true;Activity a=getActivity();if(a==null){working=false;return;}Context app=a.getApplicationContext();Bundle args=new Bundle(getArguments());IO.execute(()->{MaterialExportCache.Draft draft=null;try{MaterialExportCache.Draft candidate=load(app,args);OfficialAccountBinding account=Host107Login.account();MaterialWire.require(account!=null&&candidate.account.equals(account.binding),"OFFICIAL_ACCOUNT_CHANGED");MaterialExportCache.bytes(app.getCacheDir(),candidate,System.currentTimeMillis());draft=candidate;}catch(Exception ignored){}MaterialExportCache.Draft ready=draft;MAIN.post(()->{working=false;if(finished)return;if(!isAdded())return;if(ready==null){fail("导出准备已失效，请重新选择导出");return;}if(launched)return;launched=true;try{startActivityForResult(new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType(ready.mime).putExtra(Intent.EXTRA_TITLE,ready.title).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION|Intent.FLAG_GRANT_WRITE_URI_PERMISSION|Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION),REQUEST);}catch(RuntimeException failure){fail("没有可用的文件保存位置，请重试");}});});}
 @Override public void onActivityResult(int request,int result,Intent data){super.onActivityResult(request,result,data);if(request!=REQUEST||finished||working)return;if(result!=Activity.RESULT_OK||data==null||data.getData()==null){finish();return;}Activity a=getActivity();if(a==null){fail("无法完成文档保存，请重试");return;}pendingUri=data.getData().toString();int flags=data.getFlags()&(Intent.FLAG_GRANT_READ_URI_PERMISSION|Intent.FLAG_GRANT_WRITE_URI_PERMISSION);if((data.getFlags()&Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION)!=0)try{a.getContentResolver().takePersistableUriPermission(data.getData(),flags);persistedFlags=flags;}catch(RuntimeException ignored){}writeResult(data.getData());}
 private void writeResult(Uri uri){Activity a=getActivity();if(a==null)return;working=true;Context app=a.getApplicationContext();Bundle args=getArguments()==null?null:new Bundle(getArguments());final int grants=persistedFlags;
  IO.execute(()->{String message;try{MaterialExportCache.Draft draft=load(app,args);OfficialAccountBinding current=Host107Login.account();MaterialWire.require(current!=null&&draft.account.equals(current.binding),"OFFICIAL_ACCOUNT_CHANGED");byte[] bytes=MaterialExportCache.bytes(app.getCacheDir(),draft,System.currentTimeMillis());current=Host107Login.account();MaterialWire.require(current!=null&&draft.account.equals(current.binding),"OFFICIAL_ACCOUNT_CHANGED");try(OutputStream out=app.getContentResolver().openOutputStream(uri,"w")){if(out==null)throw new IOException("MATERIAL_EXPORT_UNAVAILABLE");out.write(bytes);out.flush();}message="文档已保存到你选择的位置";}catch(Exception failure){message="OFFICIAL_ACCOUNT_CHANGED".equals(failure.getMessage())?"账号已变化，未写入导出文件":"文档未完整保存；准备可能已失效，请重新导出。原记录未改动";}
   if(args!=null)cleanup(app,args.getString("id"));if(grants!=0)try{app.getContentResolver().releasePersistableUriPermission(uri,grants);}catch(RuntimeException ignored){}String notice=message;MAIN.post(()->{working=false;finished=true;pendingUri=null;persistedFlags=0;completion=notice;deliverCompletion();});
  });
 }
 private static MaterialExportCache.Draft load(Context app,Bundle args)throws IOException{if(args==null)throw new IOException("MATERIAL_EXPORT_CACHE_INVALID");return MaterialExportCache.load(app.getCacheDir(),args.getString("id"),args.getString("account"),args.getString("format"),args.getString("title"),System.currentTimeMillis());}
 private void deliverCompletion(){Activity a=getActivity();if(a==null)return;if(completion!=null){Toast.makeText(a,completion,Toast.LENGTH_LONG).show();completion=null;}remove();}
 private void fail(String message){completion=message;finish();}
 private void finish(){finished=true;Activity a=getActivity();Bundle args=getArguments();if(a!=null&&args!=null){Context app=a.getApplicationContext();String id=args.getString("id");IO.execute(()->cleanup(app,id));}deliverCompletion();}
 private static void cleanup(Context app,String id){try{MaterialExportCache.remove(app.getCacheDir(),id);}catch(Exception ignored){}}
 private static void notify(WeakReference<Activity> host,String message){MAIN.post(()->{Activity a=host.get();if(a!=null&&!a.isFinishing()&&!a.isDestroyed())Toast.makeText(a,message,Toast.LENGTH_LONG).show();});}
 private void remove(){if(isAdded())getFragmentManager().beginTransaction().remove(this).commitAllowingStateLoss();}
}
