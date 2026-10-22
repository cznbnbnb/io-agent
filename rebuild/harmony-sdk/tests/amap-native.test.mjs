import test from 'node:test';import assert from 'node:assert/strict';import {loadApp} from './load-app.mjs';
const settle=()=>new Promise(resolve=>setImmediate(resolve));
function setup(){
 let clock=100000,next=0,foreground=true,callbacks,poiListener,routeCalls=[],sdkCalls=[],gpsCalls=0,rejectRoute=false;
 const timers=new Map(),requests=[],sent=[];
 class LatLng{constructor(latitude,longitude){this.latitude=latitude;this.longitude=longitude;}getLatitude(){return this.latitude;}getLongitude(){return this.longitude;}}
 class NaviPoi{constructor(name,point){this.name=name;this.point=point;}}
 class Result{steps=[];distance='';duration='';}class Step{instruction='';road='';distance='';polyline='';}
 const globals={Date:class extends Date{static now(){return clock;}},setTimeout:(f,n)=>{timers.set(++next,{f,n});return next;},setInterval:(f,n)=>{timers.set(++next,{f,n,interval:true});return next;},clearTimeout:n=>timers.delete(n),clearInterval:n=>timers.delete(n)};
 const consent={updatePrivacyShow:()=>sdkCalls.push('show'),updatePrivacyAgree:()=>sdkCalls.push('agree')};
 class PoiQuery{constructor(q,t,c){this.query=q;this.city=c;}setPageSize(){}setCityLimit(){}}
 class PoiSearch{constructor(c,q){requests.push(q);}setOnPoiSearchListener(l){poiListener=l;}searchPOIAsyn(){}}
 const config={amapHarmonyKey:'test-harmony-key',amapConsent:true,amapKey:'NEVER-USE-WEB'};
 const kits={'@kit.AbilityKit':{abilityAccessCtrl:{createAtManager:()=>({requestPermissionsFromUser:async()=>({authResults:[0,0]})})}},
  '@kit.LocationKit':{geoLocationManager:{LocationRequestPriority:{ACCURACY:1},getCurrentLocation:async()=>{gpsCalls++;return {latitude:39.9,longitude:116.4,accuracy:3,timeStamp:clock};}}},
  '@amap/amap_lbs_common':{AMapPrivacyAgreeStatus:{DidAgree:1},AMapPrivacyInfoStatus:{DidContain:1},AMapPrivacyShowStatus:{DidShow:1}},
  '@amap/amap_lbs_search':{PoiQuery,PoiSearch,ServiceSettings:{...consent,getInstance:()=>({setApiKey:key=>sdkCalls.push(key)})}},
  './RemoteServices':{RouteResult:Result,RouteStep:Step,RemoteServices:class{cancel(){}},NavigationPlace:class{}},
  './DeviceFeatures':{},'./NavigationProgress':loadApp('NavigationProgress')};
 const route={getAllLength:()=>200,getAllTime:()=>160,getSteps:()=>[{getLength:()=>200,getLinks:()=>[{getRoadName:()=> '测试路'}],getIconType:()=>3,getCoords:()=>[new LatLng(39.9,116.4),new LatLng(39.901,116.401)]}]};
 const engine={setUseInnerVoice(){},setTravelInfo(){},addAMapNaviListener(l){callbacks=l;},removeAMapNaviListener(){sdkCalls.push('remove');},
  calculateWalkRouteLatLng:()=>{routeCalls.push('walk');return !rejectRoute;},calculateRideRouteLatLng:()=>{routeCalls.push('ride');return true;},calculateDriveRouteForPoi:()=>{routeCalls.push('drive');return true;},getNaviPath:()=>route,startNavi:mode=>{sdkCalls.push(`start:${mode}`);return true;},stopNavi:()=>sdkCalls.push('stop'),stopGPS:()=>sdkCalls.push('gps-stop')};
 kits['@amap/amap_lbs_navi']={NaviSetting:consent,MapsInitializer:{...consent,setDebugMode(){},setApiKey:key=>sdkCalls.push(key)},
 AMapNaviFactory:{getAMapNaviInstance:()=>engine,destroyAMapNaviInstance:()=>sdkCalls.push('destroy')},NaviLatLng:LatLng,LatLng,NaviPoi,
 CoordinateConverter:class{from(){return this;}coord(p){this.p=p;return this;}convert(){return this.p;}},CoordType:{GPS:0},AMapTravelInfo:class{},TransportType:{Walk:1,Ride:2}};
 const serviceModule=loadApp('AmapNativeServices',kits,globals);kits['./AmapNativeServices']=serviceModule;
 kits['./NavigationSession']=loadApp('NavigationSession',kits,globals);
 const features={displayActive:false,state:{connected:true,displayReady:false,display:''},show:async(t,c)=>{sent.push(['open',t,c]);features.displayActive=true;features.state.displayReady=true;},updateDisplay:async t=>sent.push(['update',t]),stopDisplay:async()=>{sent.push(['close']);features.displayActive=false;features.state.displayReady=false;}};
 const {AmapNavigationSession}=loadApp('AmapNavigationSession',kits,globals);const session=new AmapNavigationSession(features,()=>foreground);
 const context={getApplicationContext(){return this;}};
 const poiResult={getPois:()=>[{getTitle:()=> '测试起点',getSnippet:()=> '测试地址',getLatLonPoint:()=>new LatLng(39.9,116.4)}]};
 return {session,features,sent,config,kits,timers,requests,sdkCalls,routeCalls,engine,service:new serviceModule.AmapNativeServices(),context,
  callbacks:()=>callbacks,poiListener:()=>poiListener,gpsCalls:()=>gpsCalls,background:()=>foreground=false,rejectRoute:()=>rejectRoute=true,
  result:()=>poiListener.onPoiSearched(poiResult,1000),
  plan:async(mode='walking',live=false)=>{const p=session.plan(config,'测试起点','测试终点','北京',mode,live,context,'116.401,39.901');await settle();if(!live){poiListener.onPoiSearched(poiResult,1000);await settle();}return {promise:p};},
  ready:async(mode='walking',live=false)=>{const p=session.plan(config,'测试起点','测试终点','北京',mode,live,context,'116.401,39.901');await settle();if(!live){poiListener.onPoiSearched(poiResult,1000);await settle();}callbacks.onCalculateRouteSuccess({errorCode:0});await p;},
  tick:async(ms=1000)=>{clock+=ms;for(const t of [...timers.values()])if(t.interval)t.f();await settle();}};
}
test('provider consent and native key required before creating SDK search; never uses Web credential',async()=>{const s=setup();await assert.rejects(s.service.searchPlaces({...s.config,amapConsent:false},'测试','北京',s.context),/同意/);await assert.rejects(s.service.searchPlaces({...s.config,amapHarmonyKey:''},'测试','北京',s.context),/鸿蒙/);assert.equal(s.sdkCalls.length,0);assert.equal(s.requests.length,0);const p=s.service.searchPlaces(s.config,'测试','北京',s.context);s.result();assert.equal((await p)[0].location,'116.4,39.9');assert(!s.sdkCalls.includes('NEVER-USE-WEB'));assert.equal(s.timers.size,0);});
test('search cancellation ignores late provider callback; errors expose codes not credentials',async()=>{const s=setup();const p=s.service.searchPlaces(s.config,'测试','北京',s.context);const old=s.poiListener();s.service.cancel();await assert.rejects(p,/取消/);const p2=s.service.searchPlaces(s.config,'另一个','北京',s.context);old.onPoiSearched(undefined,1001);s.poiListener().onPoiSearched(undefined,1008);await assert.rejects(p2,/1008/);assert.equal(s.timers.size,0);});
test('search has bounded timeout',async()=>{const s=setup();const p=s.service.searchPlaces(s.config,'测试','北京',s.context);[...s.timers.values()].find(t=>t.n===20000).f();await assert.rejects(p,/超时/);assert.equal(s.timers.size,0);});
test('walk ride and drive use native route APIs and no location in simulation',async()=>{for(const [mode,call] of [['walking','walk'],['bicycling','ride'],['driving','drive']]){const s=setup();await s.ready(mode);assert.deepEqual(s.routeCalls,[call]);assert.equal(s.gpsCalls(),0);assert.equal(s.session.state.remaining,200);s.session.start(s.config,true);assert(s.sdkCalls.includes('start:1'));await s.session.stop();assert.equal(s.timers.size,0);}});
test('native callbacks update lens through existing continuous display lease',async()=>{const s=setup();await s.ready();s.session.start(s.config,true);await s.session.show();assert.equal(s.sent[0][2],true);s.callbacks().onNaviInfoUpdate({mRouteRemainDis:180,mSegRemainDis:80,mCurSegIndex:0,mIcon:3,mNextRoadName:'合成路',mRouteRemainTime:90});await s.tick();assert(s.sent.some(row=>row[0]==='update'&&row[1].includes('80米后右转')));assert.equal(s.session.state.remaining,180);await s.session.stop();assert.equal(s.sent.at(-1)[0],'close');});
test('stop during native calculation rejects pending promise and ignores late success',async()=>{const s=setup();const p=s.session.plan(s.config,'起点','终点','北京','walking',false,s.context,'116.401,39.901');await settle();s.result();await settle();const old=s.callbacks();await s.session.stop();old.onCalculateRouteSuccess({errorCode:0});await p;assert.equal(s.session.state.route.steps.length,0);assert(!s.session.state.busy);assert.equal(s.timers.size,0);assert(s.sdkCalls.includes('destroy'));});
test('native route refusal and timeout leave no ready route',async()=>{const s=setup();s.rejectRoute();const p=s.session.plan(s.config,'起点','终点','北京','walking',false,s.context,'116.401,39.901');const check=assert.rejects(p,/未接受/);await settle();s.result();await check;assert.equal(s.session.state.route.steps.length,0);assert.equal(s.timers.size,0);});
test('real mode permission is checked, native start uses GPS mode, background shuts down engine/display',async()=>{const s=setup();await s.ready('walking',true);assert.equal(s.gpsCalls(),1);s.session.start(s.config,false);assert(s.sdkCalls.includes('start:0'));await s.session.show();s.background();await s.tick();assert(!s.session.state.active);assert(s.sdkCalls.includes('gps-stop'));assert(s.sdkCalls.includes('destroy'));assert.equal(s.timers.size,0);assert.equal(s.sent.at(-1)[0],'close');});
test('stale navigation avoids presenting old road instructions; arrival exits after 10s',async()=>{const s=setup();await s.ready();s.session.start(s.config,true);await s.session.show();await s.tick(21000);assert(s.session.state.text.includes('等待导航位置'));s.callbacks().onArriveDestination();assert.equal(s.session.state.text,'已到达目的地');const close=[...s.timers.values()].find(t=>t.n===10000);assert(close);close.f();await settle();assert(!s.session.state.active);assert.equal(s.timers.size,0);});
test('unrelated display is never closed by a failed native display claim',async()=>{const s=setup();await s.ready();s.features.displayActive=true;await assert.rejects(s.session.show(),/其他显示/);await s.session.stop();assert.equal(s.sent.length,0);});
