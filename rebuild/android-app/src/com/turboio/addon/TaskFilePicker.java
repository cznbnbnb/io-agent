package com.turboio.addon;
import android.app.*;import android.content.*;import android.net.Uri;import android.os.Bundle;import java.util.UUID;

/** System document picker; no storage-wide permission and no user-document deletion. */
public final class TaskFilePicker extends Fragment {
 interface Selected {void take(Uri uri);}
 private Selected selected;private boolean launched;
 static void pick(Activity activity,Selected selected){TaskFilePicker picker=new TaskFilePicker();picker.selected=selected;activity.getFragmentManager().beginTransaction().add(picker,"io-task-import-"+UUID.randomUUID()).commit();}
 @Override public void onActivityCreated(Bundle state){super.onActivityCreated(state);if(selected==null){remove();return;}if(!launched){launched=true;try{startActivityForResult(new Intent(Intent.ACTION_OPEN_DOCUMENT).setType("application/json").addCategory(Intent.CATEGORY_OPENABLE),14531);}catch(RuntimeException error){TaskWorkspace.notice(getActivity(),"没有可用的文件选择器。");remove();}}}
 @Override public void onActivityResult(int request,int result,Intent data){super.onActivityResult(request,result,data);if(request==14531&&result==Activity.RESULT_OK&&data!=null&&data.getData()!=null&&selected!=null)selected.take(data.getData());selected=null;remove();}
 private void remove(){if(isAdded())getFragmentManager().beginTransaction().remove(this).commitAllowingStateLoss();}
}
