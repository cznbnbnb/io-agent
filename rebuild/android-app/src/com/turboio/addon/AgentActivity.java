package com.turboio.addon;

import android.app.Activity;
import android.content.Intent;
import android.os.Bundle;

/** Compatibility entry for old shortcuts: always return to the stock login flow. */
public final class AgentActivity extends Activity {
 @Override public void onCreate(Bundle state){
  setTheme(android.R.style.Theme_Material_NoActionBar);
  super.onCreate(state);
  startActivity(new Intent().setClassName(this,"com.rayneo.venus.MainActivity").addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP|Intent.FLAG_ACTIVITY_SINGLE_TOP));
  finish();
 }
}
