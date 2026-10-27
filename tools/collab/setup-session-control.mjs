#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {DESKTOP_SHARED_DAEMON_ADVICE} from '../../rebuild/agent-bridge/hosts/codex-endpoint.mjs';

const PLUGIN='io-agent-session-bridge',MARKETPLACE='io-agent-local',IDENTITY=PLUGIN+'@'+MARKETPLACE;
const OWNER='io-agent-session-control-setup/1',ENV_NAME='CODEX_APP_SERVER_USE_LOCAL_DAEMON',CLI_ENV_NAME='CODEX_CLI_PATH';
const SOURCE_FILES=['LICENSE','.claude-plugin/plugin.json','hooks/hooks.json','hooks/register.js','hooks/protocol.js'];
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const digest=value=>createHash('sha256').update(value).digest('hex');
class SetupError extends Error{constructor(code){super(code);this.code=code;}}
const need=(value,code)=>{if(!value)throw new SetupError(code);};
function json(file){return JSON.parse(fs.readFileSync(file,'utf8'));}
function privateDirectory(directory){
  // Do not follow an existing ancestor symlink into an unrelated config tree.
  for(let p=directory;;p=path.dirname(p)){
    if(fs.existsSync(p))need(!fs.lstatSync(p).isSymbolicLink(),'SETUP_DIRECTORY_UNTRUSTED');
    if(p===path.dirname(p))break;
  }
  if(!fs.existsSync(directory))fs.mkdirSync(directory,{recursive:true,mode:0o700});
  const s=fs.lstatSync(directory);need(s.isDirectory()&&!s.isSymbolicLink()&&s.uid===process.getuid?.()&&!(s.mode&0o077),'SETUP_DIRECTORY_UNTRUSTED');
}
function atomic(file,value){
  privateDirectory(path.dirname(file));const temporary=file+'.'+randomUUID()+'.partial';
  const fd=fs.openSync(temporary,'wx',0o600);try{fs.writeFileSync(fd,typeof value==='string'?value:JSON.stringify(value,null,2)+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
  fs.renameSync(temporary,file);if(process.platform!=='win32'){const dir=fs.openSync(path.dirname(file),'r');try{fs.fsyncSync(dir);}finally{fs.closeSync(dir);}}
}
function executable(name){
  for(const parent of (process.env.PATH??'').split(path.delimiter)){
    if(!parent)continue;const candidate=path.resolve(parent,name);try{fs.accessSync(candidate,fs.constants.X_OK);if(fs.statSync(candidate).isFile())return candidate;}catch{}
  }return null;
}
function sourceSnapshot(repo){
  const root=path.join(repo,'rebuild/agent-bridge/hosts/claude-mod/plugin'),files=SOURCE_FILES.map(relative=>{
    const file=path.join(root,relative),s=fs.lstatSync(file);need(s.isFile()&&!s.isSymbolicLink()&&s.size<=1024*1024,'SETUP_SOURCE_UNTRUSTED');
    const bytes=fs.readFileSync(file);return{relative,sha256:digest(bytes),text:bytes.toString('utf8')};
  });
  const manifest=JSON.parse(files.find(f=>f.relative==='.claude-plugin/plugin.json').text);
  need(manifest.name===PLUGIN&&/^\d+\.\d+\.\d+$/.test(manifest.version),'SETUP_SOURCE_MANIFEST_INVALID');
  return{root,files,manifest,sha256:digest(JSON.stringify(files.map(({relative,sha256})=>({relative,sha256}))))};
}
/** Pure plan: source/config reads only. It does not create directories, run
 * subprocesses, install plugins, start daemons, or change process environment. */
export function sessionControlSetupPlan({repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..'),home=os.homedir(),claude,codex=false,desktopProxy=false,desktopApp}={}){
  need([repo,home].every(p=>typeof p==='string'&&path.isAbsolute(p))&&typeof codex==='boolean'&&typeof desktopProxy==='boolean'&&(!desktopProxy||codex)&&(desktopApp===undefined||typeof desktopApp==='string'&&path.isAbsolute(desktopApp))&&(claude===undefined||path.isAbsolute(claude)),'SETUP_ARGUMENT_INVALID');
  const source=sourceSnapshot(repo),root=path.join(home,'.turboio/session-control'),marketplace=path.join(root,'marketplace');
  return{schema_version:1,operation:'plan',home,root,sessions:path.join(root,'sessions'),state:path.join(root,'install-state.json'),
    source:{repo,sha256:source.sha256},claude:{binary:claude??executable('claude'),identity:IDENTITY,marketplace,scope:'user',
      installArguments:['plugin','install',PLUGIN,'--marketplace',marketplace,'--scope','user','--json'],
      uninstallArguments:['plugin','uninstall',IDENTITY,'--scope','user','--keep-data','--json']},
    codex:{enabled:codex,desktopProxy,app:desktopApp??null,desktopPathRequired:codex&&!desktopApp,asar:desktopApp?path.join(desktopApp,'Contents/Resources/app.asar'):null,binary:desktopApp?path.join(desktopApp,'Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex'):null,
      ...(desktopProxy?{launcherDirectory:path.join(root,'desktop-launcher'),launcher:path.join(root,'desktop-launcher','codex'),node:process.execPath,
        launcherSources:['codex-desktop-launcher.mjs','codex-app-server.mjs'].map(relative=>{const file=path.join(repo,'rebuild/agent-bridge/hosts',relative);return{relative,file,sha256:digest(fs.readFileSync(file))};})}:{}),
      home:process.env.CODEX_HOME??path.join(home,'.codex'),
      environmentName:ENV_NAME,environmentValue:'1',requiresDesktopRestart:codex,expectedVersion:DESKTOP_SHARED_DAEMON_ADVICE.inspectedBundledCli,
      expectedSource:DESKTOP_SHARED_DAEMON_ADVICE.inspectedSource,expectedSha256:DESKTOP_SHARED_DAEMON_ADVICE.inspectedSourceSha256},
    effects:['Install only the owned user-scoped Claude plugin and its local catalog.','Existing sessions need normal plugin reload/restart; sessions without join remain inert.',
      ...(codex?(desktopProxy?['Preserve native Desktop startup overrides through a local stdio/Unix relay.','Set CODEX_CLI_PATH for future Desktop starts; preserve its previous value. No App bundle/model/approval edits.']:['Start or reuse a matching official local daemon; no remote-control flag.','Set one user launch environment flag for future Desktop processes. Current Desktop is not stopped or migrated.']):[])],
    rollback:'Run this script with --rollback --apply. Existing session data and the official daemon are preserved.'};
}

export function verifyDesktopDaemonBuild(plan){
  let fd;try{
    fd=fs.openSync(plan.codex.asar,'r');const prefix=Buffer.alloc(16);need(fs.readSync(fd,prefix,0,16,0)===16,'SETUP_CODEX_BUILD_UNVERIFIED');
    const size=prefix.readUInt32LE(12),offset=8+prefix.readUInt32LE(4);need(size>0&&size<16*1024*1024,'SETUP_CODEX_BUILD_UNVERIFIED');
    const header=Buffer.alloc(size);need(fs.readSync(fd,header,0,size,16)===size,'SETUP_CODEX_BUILD_UNVERIFIED');let entry=JSON.parse(header.toString('utf8'));
    for(const name of plan.codex.expectedSource.split('/'))entry=entry.files?.[name];
    need(entry&&Number.isSafeInteger(entry.size)&&entry.size>0&&entry.size<4*1024*1024&&/^\d+$/.test(entry.offset),'SETUP_CODEX_BUILD_UNVERIFIED');
    const bytes=Buffer.alloc(entry.size);need(fs.readSync(fd,bytes,0,bytes.length,offset+Number(entry.offset))===bytes.length&&digest(bytes)===plan.codex.expectedSha256,'SETUP_CODEX_BUILD_UNVERIFIED');return true;
  }catch{throw new SetupError('SETUP_CODEX_BUILD_UNVERIFIED');}finally{if(fd!==undefined)fs.closeSync(fd);}
}
function command(binary,args){
  const r=spawnSync(binary,args,{encoding:'utf8',timeout:60000,maxBuffer:1024*1024,windowsHide:true});
  return{status:r.status??-1,stdout:r.stdout??'',stderr:r.stderr??''};
}
function ownGlobalState(plan){
  const settings=path.join(path.dirname(path.dirname(plan.root)),'.claude/settings.json');
  // plan.root is <home>/.turboio/session-control.
  const home=path.dirname(path.dirname(plan.root)),configured=fs.existsSync(settings)?json(settings):{};
  const file=path.join(home,'.claude/plugins/known_marketplaces.json'),catalogs=fs.existsSync(file)?json(file):{};
  return{plugin:Object.hasOwn(configured.enabledPlugins??{},IDENTITY),marketplace:Object.hasOwn(catalogs,MARKETPLACE),catalog:catalogs[MARKETPLACE]};
}
function requireOwnedCatalog(plan,global){
  if(!global.marketplace)return;
  let matches=false;try{matches=typeof global.catalog?.source?.path==='string'&&fs.realpathSync(global.catalog.source.path)===fs.realpathSync(plan.claude.marketplace);}catch{}
  need(matches,'SETUP_MARKETPLACE_CHANGED');
  const catalog=json(path.join(plan.claude.marketplace,'.claude-plugin/marketplace.json'));
  need(catalog.name===MARKETPLACE&&Array.isArray(catalog.plugins)&&catalog.plugins.every(p=>p.name===PLUGIN),'SETUP_MARKETPLACE_CHANGED');
}
function ownedState(plan){
  if(!fs.existsSync(plan.state))return{schema_version:1,owner:OWNER,uid:process.getuid?.(),root:plan.root};
  const s=fs.lstatSync(plan.state);need(s.isFile()&&!s.isSymbolicLink()&&s.uid===process.getuid?.()&&!(s.mode&0o077),'SETUP_STATE_UNTRUSTED');
  const value=json(plan.state);need(value.schema_version===1&&value.owner===OWNER&&value.uid===process.getuid?.()&&value.root===plan.root,'SETUP_STATE_UNTRUSTED');return value;
}
function success(run,binary,args,code){const r=run(binary,args);need(r.status===0,code);return r;}
function daemonVersion(run,binary){
  const r=run(binary,['app-server','daemon','version']);if(r.status!==0)return null;
  let reply;try{reply=JSON.parse(r.stdout);}catch{throw new SetupError('SETUP_CODEX_VERSION_UNVERIFIED');}
  need(typeof reply.appServerVersion==='string','SETUP_CODEX_VERSION_UNVERIFIED');return reply.appServerVersion.replace(/^codex-cli /,'');
}
function getLaunchEnvironment(run,name=ENV_NAME){
  const r=run('/bin/launchctl',['getenv',name]);
  const value=r.stdout.replace(/\r?\n$/,'');need(name===CLI_ENV_NAME?value.length<=4096&&!/[\r\n\0]/.test(value)&&(!value||path.isAbsolute(value)):/^[A-Za-z0-9_.-]{0,32}$/.test(value),'SETUP_ENVIRONMENT_UNAVAILABLE');
  if(r.status===0&&value)return{present:true,value};
  // launchctl returns 0+empty for both absence and an explicitly empty value.
  // Inspect only this domain's environment block, never log/store the full
  // output (which may contain other applications' private environment data).
  need([0,1,113].includes(r.status)&&!value,'SETUP_ENVIRONMENT_UNAVAILABLE');
  const printed=success(run,'/bin/launchctl',['print','gui/'+process.getuid?.()],'SETUP_ENVIRONMENT_UNAVAILABLE');
  const match=/^([\t ])environment = \{\r?\n([\s\S]*?)^\1\}/m.exec(printed.stdout);
  need(match,'SETUP_ENVIRONMENT_UNAVAILABLE');return{present:new RegExp('^\\s*'+name+'\\s*=>','m').test(match[2]),value:''};
}
function installFiles(plan,source,version){
  const root=plan.claude.marketplace,marker=path.join(root,'.io-agent-installer.json');
  if(fs.existsSync(root)&&fs.readdirSync(root).length){need(fs.existsSync(marker)&&json(marker).owner===OWNER,'SETUP_MARKETPLACE_CONFLICT');}
  privateDirectory(root);atomic(marker,{owner:OWNER,uid:process.getuid?.()});
  const catalogFile=path.join(root,'.claude-plugin/marketplace.json');
  if(fs.existsSync(catalogFile)){const prior=json(catalogFile);need(prior.name===MARKETPLACE&&Array.isArray(prior.plugins)&&prior.plugins.every(p=>p.name===PLUGIN),'SETUP_MARKETPLACE_CONFLICT');}
  const destination=path.join(root,'plugins',PLUGIN);
  for(const file of source.files){const target=path.join(destination,file.relative);if(file.relative==='.claude-plugin/plugin.json')atomic(target,{...source.manifest,version});else atomic(target,file.text);}
  atomic(path.join(destination,'.claude-plugin/registry.json'),{schema_version:1,root:plan.sessions});
  atomic(catalogFile,{name:MARKETPLACE,owner:{name:'iO Agent project'},plugins:[{name:PLUGIN,version,source:'./plugins/'+PLUGIN,description:'Controls only explicitly joined original sessions.'}]});
}
/** The caller must explicitly authorize apply. Tests inject command runners;
 * the normal executable path never invokes this from a dry-run plan. */
export function applySessionControlSetup(plan,{run=command,verifyDesktop=verifyDesktopDaemonBuild}={}){
  need(plan.schema_version===1&&plan.operation==='plan','SETUP_PLAN_INVALID');const source=sourceSnapshot(plan.source.repo);
  need(source.sha256===plan.source.sha256,'SETUP_SOURCE_CHANGED');need(plan.claude.binary,'SETUP_CLAUDE_UNAVAILABLE');
  if(run===command)need(fs.realpathSync(plan.home)===fs.realpathSync(os.homedir()),'SETUP_HOME_MISMATCH');
  let launcherSources;
  if(plan.codex.enabled){
    need(plan.codex.app&&!plan.codex.desktopPathRequired,'SETUP_DESKTOP_PATH_REQUIRED');verifyDesktop(plan);
    const actual=success(run,plan.codex.binary,['--version'],'SETUP_CODEX_UNAVAILABLE').stdout.trim().replace(/^codex-cli /,'');need(actual===plan.codex.expectedVersion,'SETUP_CODEX_VERSION_MISMATCH');
    if(plan.codex.desktopProxy){
      launcherSources=plan.codex.launcherSources.map(s=>{const bytes=fs.readFileSync(s.file);need(digest(bytes)===s.sha256,'SETUP_SOURCE_CHANGED');return{relative:s.relative,text:bytes.toString('utf8')};});
      const prior=getLaunchEnvironment(run,CLI_ENV_NAME);need(!prior.value||prior.value===plan.codex.launcher,'SETUP_CLI_PATH_CONFLICT');
    }else{const existing=daemonVersion(run,plan.codex.binary);need(existing===null||existing===actual,'SETUP_CODEX_VERSION_MISMATCH');if(existing===null)need(!fs.existsSync(path.join(plan.codex.home,'app-server-control/app-server-control.sock')),'SETUP_CODEX_DAEMON_UNAVAILABLE');}
  }
  privateDirectory(path.dirname(plan.root));privateDirectory(plan.root);privateDirectory(plan.sessions);const state=ownedState(plan),save=()=>atomic(plan.state,state),global=ownGlobalState(plan);
  need(state.plugin||!global.plugin&&!global.marketplace,'SETUP_PLUGIN_CONFLICT');
  if(state.plugin)requireOwnedCatalog(plan,global);
  const changed=state.plugin?.sourceSha256!==source.sha256||state.plugin?.phase==='rolled_back';
  if(changed||state.plugin?.phase!=='installed'){
    const counter=changed?(state.plugin?(state.plugin.counter??0)+1:0):state.plugin.counter,[major,minor,patch]=source.manifest.version.split('.').map(Number),version=[major,minor,patch+counter].join('.');
    need(Number.isSafeInteger(patch+counter),'SETUP_SOURCE_MANIFEST_INVALID');
    const update=state.plugin?.phase==='installed'||state.plugin?.phase==='prepared'&&state.plugin.action==='update';state.plugin={phase:'prepared',action:update?'update':'install',sourceSha256:source.sha256,counter,version,binary:plan.claude.binary,identity:IDENTITY,marketplace:plan.claude.marketplace,
      uninstallArguments:[...plan.claude.uninstallArguments],removeMarketplaceArguments:['plugin','marketplace','remove',MARKETPLACE,'--scope','user','--json']};save();
    installFiles(plan,source,version);
    if(update){success(run,plan.claude.binary,['plugin','marketplace','update',MARKETPLACE,'--json'],'SETUP_CLAUDE_UPDATE_FAILED');success(run,plan.claude.binary,['plugin','update',IDENTITY,'--scope','user','--json'],'SETUP_CLAUDE_UPDATE_FAILED');}
    else success(run,plan.claude.binary,plan.claude.installArguments,'SETUP_CLAUDE_INSTALL_FAILED');
    state.plugin.phase='installed';save();
  }
  if(plan.codex.enabled&&plan.codex.desktopProxy){
    state.codex??={};const prior=getLaunchEnvironment(run,CLI_ENV_NAME);
    if(!state.codex.launcher||state.codex.launcher.phase==='rolled_back')state.codex.launcher={phase:'prepared',previousEnvironment:prior,path:plan.codex.launcher};
    need(prior.value===plan.codex.launcher||prior.present===state.codex.launcher.previousEnvironment.present&&prior.value===state.codex.launcher.previousEnvironment.value,'SETUP_ENVIRONMENT_CHANGED');save();
    privateDirectory(plan.codex.launcherDirectory);
    for(const source of launcherSources)atomic(path.join(plan.codex.launcherDirectory,source.relative),source.text);
    atomic(path.join(plan.codex.launcherDirectory,'launcher.json'),{schema_version:1,binary:plan.codex.binary,root:path.join(plan.root,'codex-desktop')});
    const quote=value=>"'"+value.replaceAll("'","'\\''")+"'";
    atomic(plan.codex.launcher,'#!/bin/sh\nexec '+quote(plan.codex.node)+' '+quote(path.join(plan.codex.launcherDirectory,'codex-desktop-launcher.mjs'))+' "$@"\n');fs.chmodSync(plan.codex.launcher,0o700);
    if(prior.value!==plan.codex.launcher)success(run,'/bin/launchctl',['setenv',CLI_ENV_NAME,plan.codex.launcher],'SETUP_ENVIRONMENT_WRITE_FAILED');
    need(getLaunchEnvironment(run,CLI_ENV_NAME).value===plan.codex.launcher,'SETUP_ENVIRONMENT_WRITE_FAILED');
    state.codex.launcher.phase='installed';state.codex.launcher.sources=plan.codex.launcherSources.map(({relative,sha256})=>({relative,sha256}));state.codex.phase='installed';save();
  }else if(plan.codex.enabled){
    let existing=daemonVersion(run,plan.codex.binary);
    if(existing===null){
      const socket=path.join(plan.codex.home,'app-server-control/app-server-control.sock');need(!fs.existsSync(socket),'SETUP_CODEX_DAEMON_UNAVAILABLE');
      state.codex??={};state.codex.daemonStartIntent=true;state.codex.daemonStartArguments=['app-server','daemon','start'];save();success(run,plan.codex.binary,state.codex.daemonStartArguments,'SETUP_CODEX_START_FAILED');existing=daemonVersion(run,plan.codex.binary);
    }
    need(existing===plan.codex.expectedVersion,'SETUP_CODEX_VERSION_MISMATCH');state.codex??={};
    if(!state.codex.previousEnvironment||state.codex.phase==='rolled_back'){state.codex.previousEnvironment=getLaunchEnvironment(run);state.codex.phase='prepared';save();}
    const now=getLaunchEnvironment(run);need(now.value==='1'||now.present===state.codex.previousEnvironment.present&&now.value===state.codex.previousEnvironment.value,'SETUP_ENVIRONMENT_CHANGED');
    if(now.value!=='1'){success(run,'/bin/launchctl',['setenv',ENV_NAME,'1'],'SETUP_ENVIRONMENT_WRITE_FAILED');need(getLaunchEnvironment(run).value==='1','SETUP_ENVIRONMENT_WRITE_FAILED');}
    state.codex.phase='installed';state.codex.daemonVersion=existing;save();
  }
  return{applied:true,claude_plugin:IDENTITY,claude_user_scope:true,codex_future_desktop_shared_daemon:state.codex?.phase==='installed'&&state.codex?.launcher?.phase!=='installed',codex_desktop_transport:state.codex?.launcher?.phase==='installed'?'stdio-unix-relay':null,desktop_restart_pending:state.codex?.phase==='installed',
    current_desktop_restarted:false,daemon_killed:false,state_file:plan.state};
}
export function rollbackSessionControlSetup(plan,{run=command}={}){
  const state=ownedState(plan);need(state.plugin||state.codex,'SETUP_NOT_INSTALLED');const save=()=>atomic(plan.state,state);
  if(state.plugin)requireOwnedCatalog(plan,ownGlobalState(plan));
  if(['installed','prepared'].includes(state.codex?.launcher?.phase)){
    const old=state.codex.launcher.previousEnvironment,now=getLaunchEnvironment(run,CLI_ENV_NAME);
    need(now.value===state.codex.launcher.path||now.present===old.present&&now.value===old.value,'SETUP_ROLLBACK_ENVIRONMENT_CHANGED');
    if(now.value!==old.value||now.present!==old.present)success(run,'/bin/launchctl',old.present?['setenv',CLI_ENV_NAME,old.value]:['unsetenv',CLI_ENV_NAME],'SETUP_ENVIRONMENT_WRITE_FAILED');
    state.codex.launcher.phase='rolled_back';save();
  }
  if(state.codex?.previousEnvironment&&(state.codex?.phase==='installed'||state.codex?.phase==='prepared')){
    const now=getLaunchEnvironment(run),old=state.codex.previousEnvironment;need(old,'SETUP_STATE_UNTRUSTED');
    need(now.value==='1'||now.value===old.value&&now.present===old.present,'SETUP_ROLLBACK_ENVIRONMENT_CHANGED');
    if(now.value!==old.value||now.present!==old.present)success(run,'/bin/launchctl',old.present?['setenv',ENV_NAME,old.value]:['unsetenv',ENV_NAME],'SETUP_ENVIRONMENT_WRITE_FAILED');
    state.codex.phase='rolled_back';save();
  }
  if(state.plugin?.phase==='installed'||state.plugin?.phase==='prepared'){
    need(state.plugin.identity===IDENTITY&&state.plugin.marketplace===plan.claude.marketplace,'SETUP_STATE_UNTRUSTED');
    success(run,state.plugin.binary,plan.claude.uninstallArguments,'SETUP_CLAUDE_UNINSTALL_FAILED');
    success(run,state.plugin.binary,['plugin','marketplace','remove',MARKETPLACE,'--scope','user','--json'],'SETUP_CLAUDE_UNINSTALL_FAILED');state.plugin.phase='rolled_back';save();
  }
  return{rolled_back:true,daemon_killed:false,session_data_preserved:true,requires_plugin_reload:true};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    const args=process.argv.slice(2),options={};let apply=false,rollback=false;
    for(let i=0;i<args.length;i++){
      const arg=args[i];if(arg==='--apply')apply=true;else if(arg==='--rollback')rollback=true;else if(arg==='--codex')options.codex=true;else if(arg==='--desktop-proxy')options.desktopProxy=true;
      else if(arg==='--claude'||arg==='--home'||arg==='--desktop-app'){need(args[i+1],'SETUP_ARGUMENT_INVALID');options[arg==='--desktop-app'?'desktopApp':arg.slice(2)]=path.resolve(args[++i]);}
      else if(arg==='--help'){process.stdout.write('Usage: node tools/collab/setup-session-control.mjs [--claude /absolute/cli] [--codex --desktop-app /absolute/Inspected.app [--desktop-proxy]] [--apply] [--rollback]\nDefault: read-only plan. --desktop-proxy preserves built-in Desktop startup overrides through a local stdio/Unix relay. --apply installs only the owned user plugin/launcher and saves previous launch environment values. Matching pinned Desktop build required. --rollback --apply restores owned environment settings and removes the plugin; sessions and the daemon are preserved.\n');process.exit(0);}
      else throw new SetupError('SETUP_ARGUMENT_INVALID');
    }
    const plan=sessionControlSetupPlan(options);process.stdout.write(JSON.stringify(apply?(rollback?rollbackSessionControlSetup(plan):applySessionControlSetup(plan)):{...plan,operation:rollback?'rollback-plan':'plan'},null,2)+'\n');
  }catch(error){process.stderr.write(JSON.stringify({ok:false,error:/^[A-Z][A-Z0-9_]+$/.test(error?.code??'')?error.code:'SETUP_FAILED'})+'\n');process.exitCode=1;}
}
