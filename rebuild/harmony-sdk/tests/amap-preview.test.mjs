import test from 'node:test';
import assert from 'node:assert/strict';
import {loadApp} from './load-app.mjs';

function setup(){
 const registered=new Set(),timers=new Map(),calls=[],reports=[],selected=[];let next=0,fetch,ready,click,failDraw=false;
 class ArrayList extends Array{add(p){this.push(p);}}
 class LatLng{constructor(latitude,longitude){this.latitude=latitude;this.longitude=longitude;}}
 class LatLngBounds{constructor(sw,ne){this.sw=sw;this.ne=ne;}}
 class PolylineOptions{addAll(p){this.points=p;return this;}setWidth(){return this;}setColor(){return this;}}
 class MarkerOptions{setPosition(p){this.position=p;return this;}setTitle(){return this;}}
 const manager={registerMapViewCreatedCallback:f=>registered.add(f),unregisterMapViewCreatedCallback:f=>registered.delete(f)};
 const sdk={MapViewManager:{getInstance:()=>manager},LatLng,LatLngBounds,PolylineOptions,MarkerOptions,CameraUpdateFactory:{newLatLngZoom:(p,z)=>({p,z}),newLatLngBounds:(bounds,padding)=>({bounds,padding})}};
 const {AmapPreviewController}=loadApp('AmapPreviewController',{'@kit.ArkTS':{ArrayList},'@amap/amap_lbs_navi':sdk},{setTimeout:(f,ms)=>{timers.set(++next,{f,ms});return next;},clearTimeout:id=>timers.delete(id)});
 const make=()=>new AmapPreviewController((note,failed)=>reports.push({note,failed}),p=>selected.push(p));
 const controller=make();
 const map={getUiSettings:()=>({setZoomControlsEnabled:()=>calls.push('zoom-ui')}),moveCamera:c=>calls.push(['camera',c]),clear:()=>{if(failDraw)throw Error('SDK draw failed');calls.push('clear');},addPolyline:p=>calls.push(['line',p]),addMarker:p=>calls.push(['marker',p]),addOnMapReadyDelayListener:f=>ready=f,setOnMapClickListener:f=>click=f};
 const view={onCreate:()=>calls.push('create'),onResume:()=>calls.push('resume'),getMapAsync:f=>fetch=f,onPause:()=>calls.push('pause'),onDestroy:()=>calls.push('destroy')};
 return {controller,make,reports,selected,calls,timers,registered,map,view,failDraw:()=>failDraw=true,
  create:()=>[...registered][0](view,controller.name),fetch:()=>fetch(map),ready:()=>ready(map),click:()=>click(new LatLng(39.9,116.4))};
}
test('map camera and overlays wait for delayed ready and draw the latest content',()=>{
 const s=setup();s.controller.setContent('116.3,39.8;116.4,39.9','116.4,39.9');s.controller.open();s.create();s.fetch();
 s.controller.setContent('116.4,39.9;116.5,40.0','116.5,40.0');assert.deepEqual(s.calls,['create','resume']);
 s.ready();assert(s.calls.some(c=>c[0]==='line'&&c[1].points[0].longitude===116.4));assert.equal(s.timers.size,0);
 assert.deepEqual(s.reports.at(-1),{note:'地图已加载',failed:false});s.click();assert.deepEqual(s.selected,['116.400000,39.900000']);s.controller.dispose();
});
test('leaving before getMapAsync resolves ignores stale callbacks and closes native view once',()=>{
 const s=setup();s.controller.open();s.create();const oldCallback=[...s.registered][0];s.controller.dispose();s.controller.dispose();
 s.fetch();oldCallback(s.view,s.controller.name);assert.deepEqual(s.calls,['create','resume','pause','destroy']);
 assert.equal(s.registered.size,0);assert.equal(s.timers.size,0);
});
test('leaving before ready ignores delayed draw and taps',()=>{
 const s=setup();s.controller.open();s.create();s.fetch();s.controller.dispose();s.ready();s.click();
 assert.equal(s.selected.length,0);assert(!s.calls.some(c=>c[0]==='camera'));assert.equal(s.reports.length,1);
});
test('duplicate or foreign map creation does not create another native map',()=>{
 const s=setup();s.controller.open();const callback=[...s.registered][0];callback(s.view,'unrelated');s.create();s.create();
 assert.deepEqual(s.calls,['create','resume']);s.controller.dispose();
});
test('load timeout gives a retryable state and a replacement gets its own map identity',()=>{
 const s=setup();s.controller.open();s.create();s.fetch();const [id,t]=[...s.timers][0];s.timers.delete(id);t.f();
 assert(s.reports.at(-1).failed);assert.match(s.reports.at(-1).note,/尚未完成加载/);
 s.controller.dispose();const replacement=s.make();assert.notEqual(replacement.name,s.controller.name);replacement.open();
 assert.equal(s.registered.size,1);s.ready();assert.equal(s.reports.at(-1).note,'地图加载中…');replacement.dispose();assert.equal(s.timers.size,0);
});
test('SDK draw failure is shown without escaping callback and disposal still releases resources',()=>{
 const s=setup();s.controller.open();s.create();s.fetch();s.failDraw();assert.doesNotThrow(()=>s.ready());
 assert(s.reports.at(-1).failed);assert.equal(s.timers.size,0);s.controller.dispose();assert(s.calls.includes('destroy'));
});
test('invalid coordinates never create overlays and repeated ready does not reset camera',()=>{
 const s=setup();s.controller.setContent('NaN,39;181,90;','0,91');s.controller.open();s.create();s.fetch();s.ready();const count=s.calls.length;s.ready();
 assert.equal(s.calls.length,count);assert(!s.calls.some(c=>c[0]==='line'||c[0]==='marker'));s.controller.dispose();
});
