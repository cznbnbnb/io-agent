package com.turboio.addon;

import android.Manifest;
import android.app.*;
import android.bluetooth.*;
import android.content.*;
import android.content.pm.PackageManager;
import android.os.*;
import java.lang.reflect.*;
import java.util.*;
import java.util.concurrent.atomic.AtomicBoolean;

/** Exact stock 1.0.10 ABI. Reuses stock service/core/concrete delegates and auth. */
public final class Host107Connection implements GlassesConnection {
 private static final String PLUGIN="com.rayneo.rayneo_venus_sdk_plugin.j",MANAGER="Y3.u",OWNER="com.rayneo.rayneo_venus_sdk_plugin.h";
 private static final String[] LANES={"a","b","c","e"},CALLBACKS={"H","I","K","J"};
 private static volatile Host107Connection instance;
 private static final BackgroundLocationRetry locationRetry=new BackgroundLocationRetry();
 private final Context app;private final SharedPreferences prefs;private final Handler main=new Handler(Looper.getMainLooper());
 private final Set<Runnable> listeners=new LinkedHashSet<>();private final AtomicBoolean notificationPending=new AtomicBoolean();
 private final Set<Activity> foreground=Collections.newSetFromMap(new WeakHashMap<Activity,Boolean>());
 private volatile Object plugin,stock;private Object manager,resolver,observer,savedResolver,savedObserver;private volatile boolean owned,scanning,visible;private boolean leaseOwned,recoveringEnable;private volatile long scanGeneration;private String note="DEVICE_NOT_ENABLED";
 private Host107Connection(Context context,Activity activity){
  app=context.getApplicationContext();prefs=app.getSharedPreferences("io_agent_glasses_v1",0);if(activity!=null)foreground.add(activity);visible=activity!=null;
  ((Application)app).registerActivityLifecycleCallbacks(new Application.ActivityLifecycleCallbacks(){
   public void onActivityResumed(Activity a){foreground.add(a);visible=true;if(prefs.getBoolean("enabled",false)&&!owned&&!FirmwareQueue.busy()&&!a.getClass().getName().equals("com.rayneo.venus.MainActivity"))try{enable();}catch(Exception failure){note=code(failure);}}
   public void onActivityStopped(Activity a){foreground.remove(a);visible=!foreground.isEmpty();if(!visible&&scanning)try{stopScan();}catch(Exception failure){note=code(failure);}}
   public void onActivityDestroyed(Activity a){foreground.remove(a);visible=!foreground.isEmpty();}
   public void onActivityCreated(Activity a,Bundle b){}public void onActivityStarted(Activity a){}public void onActivityPaused(Activity a){}public void onActivitySaveInstanceState(Activity a,Bundle b){}
  });
 }
 static synchronized Host107Connection get(Activity activity){if(instance==null)instance=new Host107Connection(activity,activity);return instance;}
 /** Only discovery changes; established BLE/SPP links keep their original policy. */
 public static int scanMode(){Host107Connection self=instance;return self!=null&&!self.visible?android.bluetooth.le.ScanSettings.SCAN_MODE_LOW_POWER:android.bluetooth.le.ScanSettings.SCAN_MODE_LOW_LATENCY;}
 /** Called on the host location coordinator's main thread, after its cache lookup. */
 public static boolean allowLocationRetry(){Host107Connection self=instance;return self==null||locationRetry.allow(self.visible,SystemClock.elapsedRealtime());}
 public static void locationResult(Object value,boolean cancelled){Host107Connection self=instance;if(self!=null)locationRetry.completed(value!=null,cancelled,self.visible,SystemClock.elapsedRealtime());}
 /** The independent package cannot authenticate the stock AMap signing key. Use the host's
  * existing system one-shot provider; keep its cache, cancellation, timeout and retry budget. */
 public static boolean systemOneShotLocation(){Host107Connection self=instance;return self!=null&&"cn.cznbnb.ioagent".equals(self.app.getPackageName());}
 /** No screen yet (TurboAddon.boot): cards, dictation and OTA links read the shared stock connection. */
 static synchronized void boot(Context context){if(instance==null)instance=new Host107Connection(context,null);}
 static void attach(Activity activity){Host107Connection self=get(activity);self.foreground.add(activity);self.visible=true;if(activity.getClass().getName().equals("com.rayneo.venus.MainActivity")&&self.owned)try{handoff();}catch(Exception failure){self.note=code(failure);}}
 void listen(Runnable listener){mainThread();listeners.add(listener);}
 void unlisten(Runnable listener){mainThread();listeners.remove(listener);}
 private void changed(){if(notificationPending.compareAndSet(false,true))main.postDelayed(()->{notificationPending.set(false);for(Runnable listener:new ArrayList<>(listeners))try{listener.run();}catch(RuntimeException ignored){}},100);}
 private static Class<?> type(String name)throws Exception{return Class.forName(Host107Abi.className(name));}
 private static Object field(Object owner,String name)throws Exception{return NavReflect.field(owner,name);}
 private static void set(Object owner,String name,Object value)throws Exception{Class<?> c=owner instanceof Class?(Class<?>)owner:owner.getClass();c.getField(Host107Abi.fieldName(c,name)).set(owner instanceof Class?null:owner,value);}
 private static Object call(Object owner,String name,Object...args)throws Exception{return NavReflect.call(owner,name,args);}
 private static Object make(String name,Object...args)throws Exception{return NavReflect.make(name,args);}
 private static void require(boolean condition,String code){if(!condition)throw new IllegalStateException(code);}
 private static String small(Object value,int cap){if(!(value instanceof String))return "";String s=(String)value;return s.length()<=cap?s:"";}
 private static String code(Exception failure){String message=failure.getMessage();return message!=null&&message.matches("DEVICE_[A-Z_]+")?message:"DEVICE_SDK_UNAVAILABLE";}
 private void mainThread(){require(Looper.myLooper()==Looper.getMainLooper(),"DEVICE_THREAD_INVALID");}
 private void permissions(){
  String[] required=Build.VERSION.SDK_INT>=31?new String[]{Manifest.permission.BLUETOOTH_SCAN,Manifest.permission.BLUETOOTH_CONNECT}:new String[]{Manifest.permission.ACCESS_FINE_LOCATION};
  for(String permission:required)require(app.checkSelfPermission(permission)==PackageManager.PERMISSION_GRANTED,"DEVICE_PERMISSION_REQUIRED");
 }
 private void bluetooth(){BluetoothManager b=(BluetoothManager)app.getSystemService(Context.BLUETOOTH_SERVICE);BluetoothAdapter a=b==null?null:b.getAdapter();require(a!=null,"DEVICE_BLUETOOTH_UNAVAILABLE");require(a.isEnabled(),"DEVICE_BLUETOOTH_OFF");}
 private List<?> lane(String name)throws Exception{return (List<?>)field(field(manager,name),"a");}
 private boolean foreignDelegates()throws Exception{
  for(int i=0;i<LANES.length;i++){Object own=plugin==null?null:field(plugin,CALLBACKS[i]);for(Object value:new ArrayList<>(lane(LANES[i])))if(value!=own)return true;}return false;
 }
 /** Observe the exact initialized Flutter instance. Never replaces its callbacks or lease. */
 private boolean shareStock()throws Exception{
  mainThread();if(owned)return false;Object candidate=null;
  try{
   Object engine=field(type("y8.d"),"b");if(engine!=null){Object registry=field(engine,"d"),wrapper=((Map<?,?>)field(registry,"a")).get(type("com.rayneo.rayneo_venus_sdk_plugin.f"));if(wrapper!=null)candidate=field(wrapper,"A");}
   if(candidate==null||candidate.getClass()!=type(PLUGIN)||!Boolean.TRUE.equals(field(candidate,"f"))){stock=null;return false;}
   Object existing=field(type(MANAGER),"h");require(existing!=null,"DEVICE_OTHER_OWNER");
   for(int i=0;i<LANES.length;i++){List<?> values=(List<?>)field(field(existing,LANES[i]),"a");require(values.size()==1&&values.get(0)==field(candidate,CALLBACKS[i]),"DEVICE_OTHER_OWNER");}
   for(int i=0;i<2;i++){Object callback=field(type(OWNER),i==0?"h":"i");require(callback!=null&&callback.getClass()==type("m8.x1")&&field(callback,"c")==candidate&&Integer.valueOf(i+2).equals(field(callback,"b")),"DEVICE_OTHER_OWNER");}
   manager=existing;stock=candidate;return true;
  }catch(Exception failure){stock=null;throw failure;}
 }
 private void registration(int operation)throws Exception{call(make("m8.y1",plugin,operation),"invoke");}
 private void stopOwnedRegistration()throws Exception{for(int operation:new int[]{10,1,9,8})registration(operation);owned=false;set(plugin,"f",false);}
 private void reserveResolvers(Class<?> owner)throws Exception{
  Object prior=field(owner,"h"),watch=field(owner,"i");if(prior==resolver&&watch==observer)return;
  if(prior!=null||watch!=null){
   // Stock engine attachment installs lookup/power callbacks before SDK enable.
   // Borrow only that exact dormant pair; an initialized plugin remains another owner.
   require(prior!=null&&watch!=null&&prior.getClass()==type("m8.x1")&&watch.getClass()==type("m8.x1"),"DEVICE_OTHER_OWNER");
   Object bridge=field(prior,"c");require(bridge==field(watch,"c")&&bridge.getClass()==type(PLUGIN)&&Boolean.FALSE.equals(field(bridge,"f"))&&Integer.valueOf(0).equals(field(prior,"b"))&&Integer.valueOf(1).equals(field(watch,"b")),"DEVICE_OTHER_OWNER");
  }
  savedResolver=prior;savedObserver=watch;
 }
 private void restoreResolvers(Class<?> owner)throws Exception{
  if(field(owner,"h")==resolver)set(owner,"h",savedResolver);if(field(owner,"i")==observer)set(owner,"i",savedObserver);savedResolver=savedObserver=null;
 }
 @Override public void enable()throws Exception{
  mainThread();require(!FirmwareQueue.busy()||recoveringEnable,"DEVICE_BUSY");permissions();bluetooth();if(owned){require(!foreignDelegates(),"DEVICE_OTHER_OWNER");note="DEVICE_READY";return;}
  if(!recoveringEnable&&shareStock()){note="DEVICE_STOCK_SHARED";changed();return;}
  Class<?> owner=type(OWNER);boolean acquired=field(owner,"f")==null;
  try{
   require(Boolean.TRUE.equals(call(owner,"j",app)),"DEVICE_SERVICE_UNAVAILABLE");leaseOwned=leaseOwned||acquired;
   AtomicBoolean initialized=(AtomicBoolean)field(owner,"c");if(!initialized.get()){call(field(owner,"l"),"c",app,make("m8.E1"));initialized.set(true);}
   manager=call(field(type(MANAGER),"g"),"a");require(!foreignDelegates(),"DEVICE_OTHER_OWNER");
   if(plugin==null){plugin=make(PLUGIN);set(plugin,"b",app);resolver=make("m8.x1",plugin,2);observer=make("m8.x1",plugin,3);}
   reserveResolvers(owner);
   // The stock baseline is a single shared lease. Once no other delegates or
   // resolver own it, this native session adopts it, including after a handoff.
   leaseOwned=true;
   set(owner,"h",resolver);set(owner,"i",observer);
   try{for(int operation:new int[]{3,4,5,6})registration(operation);}catch(Exception failure){stopOwnedRegistration();throw failure;}
   owned=true;set(plugin,"f",true);
   require(prefs.edit().putBoolean("enabled",true).commit(),"DEVICE_SETTINGS_UNAVAILABLE");note="DEVICE_READY";
  }catch(Exception failure){note=code(failure);
   if(owned)stopOwnedRegistration();
   if(plugin!=null){restoreResolvers(owner);set(plugin,"f",false);}
   if(otherOwnerPresent())leaseOwned=false;else if(leaseOwned)releaseLease();throw failure;
  }finally{changed();}
 }
 private boolean otherOwnerPresent(){try{return manager!=null&&foreignDelegates();}catch(Exception failure){return true;}}
 private void releaseLease()throws Exception{
  if(!leaseOwned)return;Class<?> owner=type(OWNER);Object reason=field(type("m8.F1"),"b");call(owner,"e",System.currentTimeMillis(),reason);call(owner,"o","io_agent_connection_stopped");leaseOwned=false;
 }
 private void noWork(){require(!NativeTransfer.busy()&&!NavGlasses.active()&&!NativeNavigation.active()&&!MusicBridge.active()&&!ReaderBridge.active(),"DEVICE_BUSY");}
 static String otaPeer(){
  Host107Connection self=instance;if(self==null)return null;
  try{self.mainThread();self.permissions();self.bluetooth();if(self.owned){if(self.foreignDelegates())return null;}else if(ProductInfo.OTA_WRITES_ENABLED||!self.shareStock())return null;
   String found="";for(Peer peer:self.snapshot().peers)if(peer.connected){if(!found.isEmpty()||!peer.authenticated())return null;found=peer.id;}return found;
  }catch(Exception failure){return null;}
 }
 /** Structural metadata only; no identities, pairing secrets or payloads. Main thread only. */
 static String statusDetails(String expectedHash){
  Host107Connection self=instance;if(self==null)return "连接元数据：尚未初始化";
  try{self.mainThread();Snapshot s=self.snapshot();StringBuilder result=new StringBuilder("连接元数据：").append(s.note).append(" shared=").append(s.shared).append(" owned=").append(s.owned).append(" peers=").append(s.peers.size());int count=0;
   for(Peer p:s.peers){if(++count>4)break;String hash=Fixed60Session.peerHash(p.id);result.append("\n设备状态 targetMatches=").append(hash.equals(expectedHash)).append(" connected=").append(p.connected).append(" ble=").append(stateCode(p.ble)).append(" spp=").append(stateCode(p.spp)).append(" bond=").append(stateCode(p.bond));}return result.toString();
  }catch(Exception bad){return "连接元数据：暂不可读";}
 }
 private static String stateCode(String value){return value!=null&&value.matches("[A-Za-z_]{0,64}")?value:"unknown";}
 static void reconnectFirmware(Fixed60Session.ReconnectPermit permit)throws Exception{
  Host107Connection self=instance;require(self!=null,"DEVICE_NOT_ENABLED");self.mainThread();self.permissions();self.bluetooth();
  require(!self.foreground.isEmpty(),"DEVICE_FOREGROUND_REQUIRED");
  require(permit!=null&&permit.valid(SystemClock.elapsedRealtime()),"RECOVERY_PERMIT_INVALID");
  if(!self.owned){self.recoveringEnable=true;try{self.enable();}finally{self.recoveringEnable=false;}}require(!self.foreignDelegates(),"DEVICE_OTHER_OWNER");
  self.stopScan();Peer target=FirmwareRecoverySelection.select(self.snapshot().peers,permit,SystemClock.elapsedRealtime());
  // Re-read the SDK dictionary immediately before consuming the single-use permit.
  self.peer(target.id);target=FirmwareRecoverySelection.select(self.snapshot().peers,permit,SystemClock.elapsedRealtime());
  permit.consume(target.id,SystemClock.elapsedRealtime());
  require(Boolean.TRUE.equals(call(type(OWNER),"b",self.peer(target.id),null,false,null)),"DEVICE_CONNECT_FAILED");self.note="DEVICE_CONNECTING";self.changed();
 }
 private void action()throws Exception{mainThread();permissions();bluetooth();require(owned&&manager!=null,"DEVICE_NOT_ENABLED");require(!foreignDelegates(),"DEVICE_OTHER_OWNER");noWork();}
 @Override public void scan()throws Exception{
  action();require(!scanning&&!Boolean.TRUE.equals(field(type("Y3.N"),"d")),"DEVICE_SCAN_BUSY");
  Class<?> filter=type("j4.F");Object filters=Array.newInstance(filter,2);Array.set(filters,0,field(filter,"i"));Array.set(filters,1,field(filter,"h"));
  long owner=++scanGeneration;scanning=true;
  try{require(Boolean.TRUE.equals(call(type(OWNER),"k",filters,new String[0])),"DEVICE_SCAN_FAILED");note="DEVICE_SCANNING";changed();}
  catch(Exception failure){scanning=false;scanGeneration++;note="DEVICE_SCAN_FAILED";throw failure;}
  main.postDelayed(()->{if(owner==scanGeneration&&scanning)try{stopScan();}catch(Exception failure){note=code(failure);}},10000);
 }
 @Override public void stopScan()throws Exception{
  mainThread();if(!scanning)return;require(owned&&!foreignDelegates(),"DEVICE_OTHER_OWNER");call(type("Y3.N"),"z");scanning=false;scanGeneration++;note="DEVICE_SCAN_STOPPED";changed();
 }
 private Object peer(String id)throws Exception{require(id!=null&&!id.isEmpty()&&id.length()<=256,"DEVICE_SELECTION_INVALID");Object value=call(plugin,"y",id);require(value!=null&&id.equals(field(value,"a")),"DEVICE_SELECTION_STALE");return value;}
 @Override public void connect(String id,boolean pair)throws Exception{
  action();Object device=peer(id);require(!Boolean.TRUE.equals(call(device,"b")),"DEVICE_ALREADY_CONNECTED");
  Object raw=call(type(PLUGIN),"j",device);require(raw instanceof Map,"DEVICE_SDK_UNAVAILABLE");String bond=small(((Map<?,?>)raw).get("bondState"),64);
  require(pair?(bond.equals("unbound")||bond.equals("localBondedNativeUnbound")):bond.equals("bonded"),"DEVICE_BINDING_MISMATCH");
  for(Peer p:snapshot().peers)require(!p.connected||p.id.equals(id),"DEVICE_OTHER_CONNECTED");
  stopScan();require(Boolean.TRUE.equals(call(type(OWNER),"b",device,null,pair,null)),"DEVICE_CONNECT_FAILED");note="DEVICE_CONNECTING";changed();
 }
 @Override public void disconnect(String id)throws Exception{action();peer(id);require(Boolean.TRUE.equals(call(type(OWNER),"d",id,null)),"DEVICE_DISCONNECT_FAILED");note="DEVICE_DISCONNECTING";changed();}
 @Override public void disable()throws Exception{
  mainThread();noWork();require(!otherOwnerPresent(),"DEVICE_OTHER_OWNER");
  for(Peer p:snapshot().peers)require(!p.connected,"DEVICE_DISCONNECT_FIRST");
  stopScan();if(owned)stopOwnedRegistration();Class<?> owner=type(OWNER);restoreResolvers(owner);
  releaseLease();require(prefs.edit().putBoolean("enabled",false).commit(),"DEVICE_SETTINGS_UNAVAILABLE");note="DEVICE_NOT_ENABLED";changed();
 }
 /** Explicit optional-cloud handoff: retain the stock baseline, remove only ours. */
 static void handoff()throws Exception{
  if(instance==null||!instance.owned)return;Host107Connection self=instance;self.mainThread();self.noWork();self.stopScan();self.stopOwnedRegistration();Class<?> owner=type(OWNER);
  self.restoreResolvers(owner);self.leaseOwned=false;self.note="DEVICE_CLOUD_OWNER";
 }
 static void openCloud(Activity activity)throws Exception{handoff();activity.startActivity(new Intent().setClassName(activity,"com.rayneo.venus.MainActivity"));}
 @Override public Snapshot snapshot(){
  mainThread();List<Peer> peers=new ArrayList<>();String current=note;boolean shared=false;
  try{
   if(!owned){shared=shareStock();if(shared)current="DEVICE_STOCK_SHARED";else if(current.equals("DEVICE_STOCK_SHARED"))current="DEVICE_NOT_ENABLED";}
   if(owned&&foreignDelegates())current="DEVICE_OTHER_OWNER";
   if(manager!=null){Map<String,Object> all=new LinkedHashMap<>();Object paired=call(type(MANAGER),"g");if(paired instanceof List)for(Object d:(List<?>)paired)all.put(small(field(d,"a"),256),d);
    Object found=call(type(MANAGER),"h");if(found instanceof Map)for(Object d:((Map<?,?>)found).values())all.put(small(field(d,"a"),256),d);
    require(all.size()<=64,"DEVICE_LIST_BUDGET");for(Map.Entry<String,Object> entry:all.entrySet()){if(entry.getKey().isEmpty())continue;Object raw=call(type(PLUGIN),"j",entry.getValue());require(raw instanceof Map,"DEVICE_SDK_UNAVAILABLE");Map<?,?> d=(Map<?,?>)raw;
     peers.add(new Peer(entry.getKey(),small(d.get("name"),128),small(d.get("bleState"),64),small(d.get("sppState"),64),small(d.get("bondState"),64),Boolean.TRUE.equals(d.get("isConnected"))));
    }
   }
  }catch(Exception failure){current=code(failure);}
  return new Snapshot(prefs.getBoolean("enabled",false),owned,scanning,shared,current,peers);
 }
 /** Only our sinkless instance is consumed; shared stock events still reach Flutter. */
 public static boolean event(Object source,String kind,Map<?,?> data){
  Host107Connection self=instance;if(self==null||source==null)return false;
  if(kind!=null&&(kind.endsWith("StateChanged")||kind.equals("deviceDiscovered")))self.changed();
  if(source==self.stock&&!self.owned){try{Fixed60OfficialRuntime.observe(kind,data);Host107Ota.event(kind,data);MinuteCardRuntime.observe(kind,data);HeadGestureRuntime.observe(kind,data);if(Host107Recording.observe(kind,data))return true;return AgentCardRuntime.observe(kind,data);}catch(Exception failure){self.main.post(()->self.note="DEVICE_SDK_UNAVAILABLE");}return false;}
  if(source!=self.plugin)return false;
  if(self.owned)try{
   // A directly opened stock activity can register its delegates before its
   // lifecycle callback runs. In that interval only its event path forwards.
   if(self.foreignDelegates())return true;
   Fixed60OfficialRuntime.observe(kind,data);
   MinuteCardRuntime.observe(kind,data);
   HeadGestureRuntime.observe(kind,data);
   AgentCardRuntime.observe(kind,data);
   if("discoverStateChanged".equals(kind)&&data!=null&&"end".equals(data.get("state"))){long owner=self.scanGeneration;Object error=data.get("error");String reason=error instanceof Map?small(((Map<?,?>)error).get("type"),64):"";
    self.main.post(()->{if(self.scanning&&owner==self.scanGeneration){self.scanning=false;self.scanGeneration++;self.note=reason.isEmpty()?"DEVICE_SCAN_STOPPED":reason.equals("bluetoothNotEnabled")?"DEVICE_BLUETOOTH_OFF":reason.endsWith("PermissionDenied")?"DEVICE_PERMISSION_REQUIRED":"DEVICE_SCAN_FAILED";self.changed();}});
   }
   if(!Host107Recording.observe(kind,data)&&!Host107Ota.event(kind,data))NativeTransfer.event(kind,data);
  }catch(Exception failure){self.main.post(()->self.note="DEVICE_SDK_UNAVAILABLE");}
  return true;
 }
}
