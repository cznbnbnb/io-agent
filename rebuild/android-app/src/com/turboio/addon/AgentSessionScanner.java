package com.turboio.addon;
import android.Manifest;import android.app.*;import android.content.pm.PackageManager;import android.hardware.Camera;import android.os.*;import android.view.*;import android.widget.*;import java.util.*;import java.util.concurrent.*;
import com.google.zxing.*;import com.google.zxing.common.HybridBinarizer;
/** Foreground-only QR scanner. Frames stay in memory, never saved or uploaded. */
@SuppressWarnings("deprecation")
public final class AgentSessionScanner extends Fragment implements SurfaceHolder.Callback {
 interface Result {void take(String value);}
 private Result result;private AgentUI.Screen screen;private SurfaceView surface;private TextView status;private Camera camera;private boolean ready,resumed,decoding,closed;private long lastFrame;
 private final Handler main=new Handler(Looper.getMainLooper());private final ExecutorService worker=Executors.newSingleThreadExecutor();
 private final Runnable timeout=()->finish(null);
 static void scan(Activity activity,Result result){AgentSessionScanner f=new AgentSessionScanner();f.result=result;activity.getFragmentManager().beginTransaction().add(f,"io-session-qr-"+UUID.randomUUID()).commit();}
 @Override public void onActivityCreated(Bundle state){super.onActivityCreated(state);if(result==null){finish(null);return;}Activity a=getActivity();screen=new AgentUI.Screen(a,"扫描配对二维码");screen.body.addView(AgentUI.text(a,"将电脑上的二维码放入取景框",18,AgentUI.INK));AgentUI.gap(a,screen.body,16);
  surface=new SurfaceView(a);surface.getHolder().addCallback(this);screen.body.addView(surface,new LinearLayout.LayoutParams(-1,AgentUI.dp(a,300)));AgentUI.gap(a,screen.body,16);status=AgentUI.text(a,"仅识别 iO Agent 会话配对码。",14,AgentUI.MUTED);screen.body.addView(status);AgentUI.button(a,screen.dock,"返回",false,()->finish(null));screen.dialog.setOnDismissListener(d->finish(null));main.postDelayed(timeout,120000);
  if(a.checkSelfPermission(Manifest.permission.CAMERA)!=PackageManager.PERMISSION_GRANTED)requestPermissions(new String[]{Manifest.permission.CAMERA},14532);
 }
 @Override public void onResume(){super.onResume();resumed=true;open();}
 @Override public void onPause(){resumed=false;release();super.onPause();}
 @Override public void onDestroy(){closed=true;main.removeCallbacks(timeout);release();worker.shutdownNow();if(screen!=null&&screen.dialog.isShowing())screen.dialog.dismiss();super.onDestroy();}
 @Override public void onRequestPermissionsResult(int code,String[] permissions,int[] granted){super.onRequestPermissionsResult(code,permissions,granted);if(code!=14532||closed)return;if(granted.length>0&&granted[0]==PackageManager.PERMISSION_GRANTED)open();else if(status!=null)status.setText("相机权限未开启。可以返回后粘贴配对字符串。");}
 public void surfaceCreated(SurfaceHolder h){ready=true;open();}public void surfaceChanged(SurfaceHolder h,int format,int width,int height){}public void surfaceDestroyed(SurfaceHolder h){ready=false;release();}
 private void open(){
  if(closed||!resumed||!ready||camera!=null||getActivity()==null||getActivity().checkSelfPermission(Manifest.permission.CAMERA)!=PackageManager.PERMISSION_GRANTED)return;
  try{int index=-1;Camera.CameraInfo info=new Camera.CameraInfo();for(int n=0;n<Camera.getNumberOfCameras();n++){Camera.getCameraInfo(n,info);if(info.facing==Camera.CameraInfo.CAMERA_FACING_BACK){index=n;break;}}if(index<0)throw new IllegalStateException();camera=Camera.open(index);Camera.Parameters p=camera.getParameters();Camera.Size chosen=null;
   for(Camera.Size size:p.getSupportedPreviewSizes())if(size.width<=1280&&size.height<=960&&(chosen==null||size.width*size.height>chosen.width*chosen.height))chosen=size;
   if(chosen==null)throw new IllegalStateException();p.setPreviewSize(chosen.width,chosen.height);p.setPreviewFormat(android.graphics.ImageFormat.NV21);if(p.getSupportedFocusModes().contains(Camera.Parameters.FOCUS_MODE_CONTINUOUS_PICTURE))p.setFocusMode(Camera.Parameters.FOCUS_MODE_CONTINUOUS_PICTURE);camera.setParameters(p);
   int rotation=getActivity().getWindowManager().getDefaultDisplay().getRotation()*90;int angle=(info.orientation-rotation+360)%360;camera.setDisplayOrientation(angle);
   int previewHeight=AgentUI.dp(getActivity(),300),available=Math.max(1,screen.body.getWidth()-screen.body.getPaddingLeft()-screen.body.getPaddingRight());float ratio=angle%180==0?(float)chosen.width/chosen.height:(float)chosen.height/chosen.width;int previewWidth=Math.min(available,Math.round(previewHeight*ratio));previewHeight=Math.round(previewWidth/ratio);LinearLayout.LayoutParams size=new LinearLayout.LayoutParams(previewWidth,previewHeight);size.gravity=Gravity.CENTER_HORIZONTAL;surface.setLayoutParams(size);camera.setPreviewDisplay(surface.getHolder());
   final int width=chosen.width,height=chosen.height;camera.setPreviewCallback((data,source)->frame(data,width,height));camera.startPreview();
  }catch(Exception failure){release();if(status!=null)status.setText("相机暂时不可用。可以返回后粘贴配对字符串。");}
 }
 private void frame(byte[] data,int width,int height){
  long now=SystemClock.elapsedRealtime();if(closed||!resumed||decoding||now-lastFrame<350||data==null||data.length<width*height)return;lastFrame=now;decoding=true;byte[] frame=data.clone();
  worker.execute(()->{String decoded=null;try{MultiFormatReader reader=new MultiFormatReader();Map<DecodeHintType,Object> hints=new EnumMap<>(DecodeHintType.class);hints.put(DecodeHintType.POSSIBLE_FORMATS,Collections.singletonList(BarcodeFormat.QR_CODE));reader.setHints(hints);decoded=reader.decodeWithState(new BinaryBitmap(new HybridBinarizer(new PlanarYUVLuminanceSource(frame,width,height,0,0,width,height,false)))).getText();}catch(Exception ignored){}finally{Arrays.fill(frame,(byte)0);}String value=decoded;main.post(()->{decoding=false;if(closed||!resumed||value==null)return;try{SessionPairingCode.parse(value);finish(value);}catch(RuntimeException invalid){status.setText("这不是 iO Agent 配对二维码，请扫描当前会话生成的二维码。");}});});
 }
 private void release(){if(camera!=null){try{camera.setPreviewCallback(null);camera.stopPreview();}catch(RuntimeException ignored){}finally{camera.release();camera=null;}}}
 private void finish(String value){if(closed)return;closed=true;main.removeCallbacks(timeout);release();worker.shutdownNow();Result callback=result;result=null;if(screen!=null&&screen.dialog.isShowing())screen.dialog.dismiss();if(isAdded())getFragmentManager().beginTransaction().remove(this).commitAllowingStateLoss();if(value!=null&&callback!=null)callback.take(value);}
}
