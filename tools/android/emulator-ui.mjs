// Small ADB UI driver, deliberately restricted to our two virtual transports.
import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import {spawnSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
import {PRODUCT} from './profile.mjs';
import {exe} from './host-tools.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../rebuild/android-app');
const [action='snapshot',...args]=process.argv.slice(2);
const runtime=JSON.parse(fs.readFileSync(path.join(root,'.private/emulator-runtime.json'),'utf8').replace(/^\uFEFF/,''));
const serial=runtime.serial;if(!['emulator-5580','emulator-5582'].includes(serial))throw new Error('Only project emulator transports are allowed');
const env={...process.env,ANDROID_USER_HOME:path.join(root,'.private/android-user')},adb=path.join(root,'.tools/sdk/platform-tools',exe('adb'));
function run(args){const r=spawnSync(adb,['-s',serial,...args],{env,encoding:'utf8',timeout:30000,maxBuffer:2*1024**2});if(r.error)throw r.error;if(r.status!==0)throw new Error('ADB step failed: '+args.slice(0,2).join(' '));return r.stdout;}
function unescape(value){return value.replace(/&(?:quot|apos|lt|gt|amp|#\d+|#x[a-fA-F0-9]+);/g,e=>{const known={'&quot;':'"','&apos;':"'",'&lt;':'<','&gt;':'>','&amp;':'&'};if(known[e])return known[e];return String.fromCodePoint(e.startsWith('&#x')?parseInt(e.slice(3,-1),16):parseInt(e.slice(2,-1),10));});}
function snapshot(){
 const id=crypto.randomUUID(),remote='/data/local/tmp/io-agent-ui-'+id+'.xml',local=path.join(root,'.private/emulator-last-ui.xml');
 const result=run(['shell','uiautomator','dump',remote]);if(!result.includes('UI hierchary dumped to: '+remote))throw new Error('Fresh UI dump failed; old snapshots are not used');
 run(['pull',remote,local]);run(['shell','rm',remote]);
 const xml=fs.readFileSync(local,'utf8');if(!xml.startsWith('<?xml')||!xml.includes('<hierarchy'))throw new Error('Invalid UI dump');
 const nodes=[...xml.matchAll(/<node\s+([^>]+)>/g)].map(match=>Object.fromEntries([...match[1].matchAll(/([A-Za-z-]+)="([^"]*)"/g)].map(a=>[a[1],unescape(a[2])])));
 if(!nodes.length)throw new Error('Empty UI dump');fs.writeFileSync(path.join(root,'.private/emulator-last-ui.json'),JSON.stringify(nodes,null,2)+'\n');return nodes;
}
if(action==='start'||action==='coldstart'){
 if(action==='coldstart')run(['shell','am','force-stop','com.rayneo.venus.pub']);
 const resolved=run(['shell','cmd','package','resolve-activity','--brief','-a','android.intent.action.MAIN','-c','android.intent.category.LAUNCHER','com.rayneo.venus.pub']).trim().split(/\r?\n/).at(-1);
 if(resolved!=='com.rayneo.venus.pub/'+PRODUCT.launcher)throw new Error('Product launcher was not selected');
 const result=run(['shell','am','start','-W','-n',resolved,'-a','android.intent.action.MAIN','-c','android.intent.category.LAUNCHER']);if(!result.includes('Status: ok')||result.includes('Error:'))throw new Error('Launcher start failed');console.log(result.trim());
}else if(action==='tap'){
 if(args.length!==1)throw new Error('One exact label required');const nodes=snapshot(),matches=nodes.filter(n=>(n.text===args[0]||n['content-desc']===args[0])&&n.enabled!=='false');
 const node=matches.find(n=>n.clickable==='true')??matches[0];if(!node)throw new Error('UI label not found: '+args[0]);const b=/^\[(\d+),(\d+)\]\[(\d+),(\d+)\]$/.exec(node.bounds??'');if(!b)throw new Error('No observed bounds');run(['shell','input','tap',String(Math.floor((+b[1]+ +b[3])/2)),String(Math.floor((+b[2]+ +b[4])/2))]);console.log('Tapped observed label: '+args[0]);
}else if(action==='scroll'){
 if(args.length>1||args.length===1&&!['forward','back'].includes(args[0]))throw new Error('Scroll direction must be forward or back');
 const node=snapshot().find(n=>n.scrollable==='true'&&n.enabled!=='false');if(!node)throw new Error('No observed scrollable view');
 const b=/^\[(\d+),(\d+)\]\[(\d+),(\d+)\]$/.exec(node.bounds??'');if(!b)throw new Error('Scrollable bounds missing');
 const x=Math.floor((+b[1]+ +b[3])/2),top=Math.floor(+b[2]+(+b[4]- +b[2])*.2),bottom=Math.floor(+b[2]+(+b[4]- +b[2])*.8),back=args[0]==='back';
 run(['shell','input','swipe',String(x),String(back?top:bottom),String(x),String(back?bottom:top),'300']);console.log('Scrolled observed viewport '+(back?'back':'forward')+'.');
}else if(action==='set-file'){
 if(args.length!==1||!/^ui-[a-z0-9-]+\.txt$/.test(args[0]))throw new Error('Expected one synthetic UI fixture filename');
 const bytes=fs.readFileSync(path.join(root,'.private/https-fixture',args[0]));if(bytes.length>65536)throw new Error('UI input fixture exceeds product budget');
 const result=run(['shell','am','instrument','-w','-r','-e','text64',bytes.toString('base64'),'com.turboio.androidtests/com.turboio.androidtests.EmulatorInput']);
 if(!result.includes('full_text_verified=true')||!result.includes('INSTRUMENTATION_CODE: -1'))throw new Error('Full UI text input failed: '+result);
 console.log('Synthetic UI text set and read back exactly ('+bytes.length+' UTF-8 bytes).');
}else if(action==='back'){run(['shell','input','keyevent','KEYCODE_BACK']);console.log('Back');}
else if(action==='snapshot'){
 const nodes=snapshot(),id=crypto.randomUUID(),remote='/data/local/tmp/io-agent-ui-'+id+'.png',local=path.join(root,'.private/emulator-last-screen.png');run(['shell','screencap','-p',remote]);run(['pull',remote,local]);run(['shell','rm',remote]);
 console.log(JSON.stringify({serial,node_count:nodes.length,labels:nodes.filter(n=>n.text||n['content-desc']).map(n=>n.text||n['content-desc']),screenshot:'.private/emulator-last-screen.png'}));
}else throw new Error('Unknown emulator UI action');
