package com.turboio.addon;
import android.app.Activity;import android.app.Dialog;import android.os.Build;import java.util.function.BooleanSupplier;
/** One back action for header, legacy back key and Android 13+ system gesture.
 * The focused dialog owns its callback; it never forwards a sheet's back to the host Activity. */
@SuppressWarnings("deprecation")
final class AgentDialog extends Dialog {
 private BooleanSupplier back;private Runnable unregister;
 AgentDialog(Activity activity){super(activity,android.R.style.Theme_Material_NoActionBar);}
 void backHandler(BooleanSupplier action){back=action;}
 @Override protected void onStart(){super.onStart();if(Build.VERSION.SDK_INT>=33)unregister=Api33.attach(this,this::onBackPressed);}
 @Override protected void onStop(){if(unregister!=null){unregister.run();unregister=null;}super.onStop();}
 @Override public void onBackPressed(){if(!isShowing())return;if(back!=null&&back.getAsBoolean())return;super.onBackPressed();}
 private static final class Api33 {
  static Runnable attach(Dialog dialog,Runnable action){android.window.OnBackInvokedDispatcher dispatcher=dialog.getOnBackInvokedDispatcher();android.window.OnBackInvokedCallback callback=action::run;dispatcher.registerOnBackInvokedCallback(android.window.OnBackInvokedDispatcher.PRIORITY_DEFAULT,callback);return ()->dispatcher.unregisterOnBackInvokedCallback(callback);}
 }
}
