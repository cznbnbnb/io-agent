import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {sessionControlSetupPlan,applySessionControlSetup,rollbackSessionControlSetup} from './setup-session-control.mjs';

const ID='io-agent-session-bridge@io-agent-local';
function fixture(t,{codex=false,daemonVersion=null,environment,environmentPresent=environment!==undefined}={}){
  const directory=fs.realpathSync(fs.mkdtempSync('/tmp/io-setup-')),repo=path.join(directory,'repo'),home=path.join(directory,'home');
  fs.mkdirSync(home,{mode:0o700});const source=path.join(repo,'rebuild/agent-bridge/hosts/claude-mod/plugin');
  fs.mkdirSync(path.join(source,'.claude-plugin'),{recursive:true});fs.mkdirSync(path.join(source,'hooks'));
  fs.writeFileSync(path.join(source,'.claude-plugin/plugin.json'),JSON.stringify({name:'io-agent-session-bridge',version:'0.2.0'}));
  fs.writeFileSync(path.join(source,'LICENSE'),'synthetic public license');fs.writeFileSync(path.join(source,'hooks/hooks.json'),'{}');
  fs.writeFileSync(path.join(source,'hooks/register.js'),'// synthetic public module\n');fs.writeFileSync(path.join(source,'hooks/protocol.js'),'// synthetic public protocol\n');
  const settings=path.join(home,'.claude/settings.json'),marketplaces=path.join(home,'.claude/plugins/known_marketplaces.json');
  fs.mkdirSync(path.dirname(marketplaces),{recursive:true});
  const original={enabledPlugins:{'other-plugin@other-market':true},otherSetting:{keep:'untouched'}};
  fs.writeFileSync(settings,JSON.stringify(original));fs.writeFileSync(marketplaces,JSON.stringify({'other-market':{source:{source:'directory',path:'/synthetic/other'}}}));
  const calls=[],f={directory,repo,home,source,settings,marketplaces,original,calls,daemonVersion,environment,environmentPresent,starts:0,installs:0,updates:0,cachedVersion:null};
  f.plan=()=>sessionControlSetupPlan({repo,home,claude:'/synthetic/claude',codex,desktopApp:'/synthetic/InspectedDesktop.app'});
  f.run=(binary,args)=>{
    calls.push({binary,args:[...args]});
    const ok=(stdout='')=>({status:0,stdout,stderr:''}),read=p=>JSON.parse(fs.readFileSync(p,'utf8')),write=(p,j)=>fs.writeFileSync(p,JSON.stringify(j));
    if(binary==='/synthetic/claude'){
      const plan=f.plan(),state=read(plan.state);assert.equal(state.owner,'io-agent-session-control-setup/1');
      if(args[1]==='install'||args[1]==='update'){
        assert.equal(state.plugin.phase,'prepared');assert(args.includes('--scope')&&args.includes('user'));
        const s=read(settings);s.enabledPlugins[ID]=true;write(settings,s);
        const m=read(marketplaces);m['io-agent-local']={source:{source:'directory',path:plan.claude.marketplace}};write(marketplaces,m);
        f.cachedVersion=read(path.join(plan.claude.marketplace,'plugins/io-agent-session-bridge/.claude-plugin/plugin.json')).version;
        if(args[1]==='install')f.installs++;else f.updates++;return ok('{"success":true}');
      }
      if(args[1]==='uninstall'){const s=read(settings);delete s.enabledPlugins[ID];write(settings,s);return ok('{"success":true}');}
      if(args[1]==='marketplace'&&args[2]==='update'){assert.equal(args[3],'io-agent-local');return ok('{"success":true}');}
      if(args[1]==='marketplace'&&args[2]==='remove'){assert(args.includes('--scope')&&args.includes('user'));const m=read(marketplaces);delete m['io-agent-local'];write(marketplaces,m);return ok('{"success":true}');}
    }
    if(args.length===1&&args[0]==='--version')return ok('codex-cli '+f.plan().codex.expectedVersion+'\n');
    if(args.join(' ')==='app-server daemon version')return f.daemonVersion?ok(JSON.stringify({appServerVersion:f.daemonVersion})):{status:1,stdout:'',stderr:'synthetic missing daemon'};
    if(args.join(' ')==='app-server daemon start'){f.starts++;f.daemonVersion=f.plan().codex.expectedVersion;return ok();}
    if(binary==='/bin/launchctl'){
      if(args[0]==='getenv')return ok(f.environmentPresent?(f.environment??'')+'\n':'');
      if(args[0]==='print')return ok('gui/'+process.getuid()+' = {\n\tenvironment = {\n\t\tOTHER_APP_SECRET => must-not-leak\n'+(f.environmentPresent?'\t\tCODEX_APP_SERVER_USE_LOCAL_DAEMON => '+(f.environment??'')+'\n':'')+'\t}\n}\n');
      if(args[0]==='setenv'){assert.equal(args[1],'CODEX_APP_SERVER_USE_LOCAL_DAEMON');f.environment=args[2];f.environmentPresent=true;return ok();}
      if(args[0]==='unsetenv'){assert.equal(args[1],'CODEX_APP_SERVER_USE_LOCAL_DAEMON');f.environment=undefined;f.environmentPresent=false;return ok();}
    }
    assert.fail('Unexpected subprocess '+binary+' '+args.join(' '));
  };
  f.apply=()=>applySessionControlSetup(f.plan(),{run:f.run,verifyDesktop:()=>true});f.rollback=()=>rollbackSessionControlSetup(f.plan(),{run:f.run});
  t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));return f;
}

test('default plan reads public sources only and does not create local management or execute commands',t=>{
  const f=fixture(t),plan=f.plan();assert.equal(plan.operation,'plan');assert.equal(plan.codex.enabled,false);assert.equal(fs.existsSync(path.join(f.home,'.turboio')),false);assert.equal(f.calls.length,0);
  const codex=sessionControlSetupPlan({repo:f.repo,home:f.home,claude:'/synthetic/claude',codex:true});assert.equal(codex.codex.desktopPathRequired,true);assert.equal(codex.codex.app,null);
});
test('owned user-scoped plugin installation is durable, private and idempotent',t=>{
  const f=fixture(t),result=f.apply();assert.equal(result.applied,true);assert.equal(f.installs,1);assert.equal(f.cachedVersion,'0.2.0');
  const plan=f.plan(),registry=path.join(plan.claude.marketplace,'plugins/io-agent-session-bridge/.claude-plugin/registry.json');
  assert.deepEqual(JSON.parse(fs.readFileSync(registry)),{schema_version:1,root:plan.sessions});assert.equal(fs.statSync(registry).mode&0o777,0o600);assert.equal(fs.statSync(plan.sessions).mode&0o777,0o700);
  assert.equal(JSON.parse(fs.readFileSync(f.settings)).otherSetting.keep,'untouched');f.apply();assert.equal(f.installs,1);assert.equal(f.updates,0);
});
test('changed public source updates only the owned catalog/plugin with a new cache version',t=>{
  const f=fixture(t);f.apply();fs.appendFileSync(path.join(f.source,'hooks/register.js'),'// changed public source\n');f.apply();
  assert.equal(f.installs,1);assert.equal(f.updates,1);assert.equal(f.cachedVersion,'0.2.1');
  assert(f.calls.some(c=>c.args.join(' ')==='plugin marketplace update io-agent-local --json'));
  assert(f.calls.some(c=>c.args.join(' ')==='plugin update '+ID+' --scope user --json'));
  assert.equal(JSON.parse(fs.readFileSync(f.settings)).enabledPlugins['other-plugin@other-market'],true);
});
test('preexisting unmanaged plugin or catalog is not overwritten',t=>{
  for(const kind of ['plugin','marketplace']){
    const f=fixture(t);if(kind==='plugin'){const s=JSON.parse(fs.readFileSync(f.settings));s.enabledPlugins[ID]=false;fs.writeFileSync(f.settings,JSON.stringify(s));}
    else{const m=JSON.parse(fs.readFileSync(f.marketplaces));m['io-agent-local']={source:{source:'directory',path:'/unrelated'}};fs.writeFileSync(f.marketplaces,JSON.stringify(m));}
    assert.throws(()=>f.apply(),{code:'SETUP_PLUGIN_CONFLICT'});assert.equal(f.calls.length,0);
  }
});
test('a symlink under the owned marketplace cannot redirect plugin writes elsewhere',t=>{
  const f=fixture(t),plan=f.plan(),outside=path.join(f.directory,'outside');f.apply();
  const plugins=path.join(plan.claude.marketplace,'plugins');fs.renameSync(plugins,outside);fs.symlinkSync(outside,plugins);
  const before=fs.readFileSync(path.join(outside,'io-agent-session-bridge/hooks/register.js'));fs.appendFileSync(path.join(f.source,'hooks/register.js'),'// second version\n');
  assert.throws(()=>f.apply(),{code:'SETUP_DIRECTORY_UNTRUSTED'});assert.deepEqual(fs.readFileSync(path.join(outside,'io-agent-session-bridge/hooks/register.js')),before);
});
test('Codex requires an explicit inspected Desktop path and verified matching build before global writes',t=>{
  const f=fixture(t,{codex:true}),noPath=sessionControlSetupPlan({repo:f.repo,home:f.home,claude:'/synthetic/claude',codex:true});
  assert.throws(()=>applySessionControlSetup(noPath,{run:f.run,verifyDesktop:()=>assert.fail('must require path first')}),{code:'SETUP_DESKTOP_PATH_REQUIRED'});
  assert.throws(()=>applySessionControlSetup(f.plan(),{run:f.run,verifyDesktop:()=>{throw Object.assign(Error('unverified'),{code:'SETUP_CODEX_BUILD_UNVERIFIED'});}}),{code:'SETUP_CODEX_BUILD_UNVERIFIED'});
  assert.equal(f.calls.length,0);assert.equal(fs.existsSync(path.join(f.home,'.turboio')),false);
});
test('an incompatible existing daemon is not restarted or replaced',t=>{
  const f=fixture(t,{codex:true,daemonVersion:'0.1.0'});assert.throws(()=>f.apply(),{code:'SETUP_CODEX_VERSION_MISMATCH'});assert.equal(f.starts,0);assert.equal(f.installs,0);assert.equal(fs.existsSync(path.join(f.home,'.turboio')),false);
});
test('Codex installation uses one official daemon start and records exact environment for safe rollback',t=>{
  const f=fixture(t,{codex:true,environment:'0'}),result=f.apply();assert.equal(f.starts,1);assert.equal(f.environment,'1');assert.equal(result.desktop_restart_pending,true);assert.equal(result.current_desktop_restarted,false);
  const state=JSON.parse(fs.readFileSync(f.plan().state));assert.deepEqual(state.codex.previousEnvironment,{present:true,value:'0'});assert(!JSON.stringify(state).includes('must-not-leak'));
  f.apply();assert.equal(f.starts,1);assert.equal(f.installs,1);f.rollback();assert.equal(f.environment,'0');assert.equal(f.environmentPresent,true);
  assert.deepEqual(JSON.parse(fs.readFileSync(f.settings)),f.original);assert.equal(JSON.parse(fs.readFileSync(f.marketplaces))['other-market'].source.path,'/synthetic/other');
  assert(!f.calls.some(c=>c.args.includes('stop')||c.args.includes('restart')||c.args.includes('--remote-control')));
});
test('rollback distinguishes an absent flag from an originally present empty value',t=>{
  for(const present of [true,false]){
    const f=fixture(t,{codex:true,environment:'',environmentPresent:present});f.apply();assert(!JSON.stringify(JSON.parse(fs.readFileSync(f.plan().state))).includes('must-not-leak'));f.rollback();
    assert.equal(f.environmentPresent,present);assert.equal(f.environment??'','');
  }
});
test('a third-party change after installation prevents rollback from overwriting environment',t=>{
  const f=fixture(t,{codex:true});f.apply();f.environment='third-party';assert.throws(()=>f.rollback(),{code:'SETUP_ROLLBACK_ENVIRONMENT_CHANGED'});assert.equal(f.environment,'third-party');assert.equal(JSON.parse(fs.readFileSync(f.settings)).enabledPlugins[ID],true);
});
test('a repointed marketplace is not overwritten or uninstalled as though it still belonged to setup',t=>{
  const f=fixture(t);f.apply();const catalogs=JSON.parse(fs.readFileSync(f.marketplaces));catalogs['io-agent-local'].source.path='/unrelated/replacement';fs.writeFileSync(f.marketplaces,JSON.stringify(catalogs));
  assert.throws(()=>f.rollback(),{code:'SETUP_MARKETPLACE_CHANGED'});assert.throws(()=>f.apply(),{code:'SETUP_MARKETPLACE_CHANGED'});
  assert.equal(JSON.parse(fs.readFileSync(f.settings)).enabledPlugins[ID],true);assert(!f.calls.some(c=>c.args[1]==='uninstall'));
});
test('source mutation after plan generation is rejected before any command or directory mutation',t=>{
  const f=fixture(t),plan=f.plan();fs.appendFileSync(path.join(f.source,'hooks/protocol.js'),'// source changed');assert.throws(()=>applySessionControlSetup(plan,{run:f.run}),{code:'SETUP_SOURCE_CHANGED'});assert.equal(f.calls.length,0);assert.equal(fs.existsSync(path.join(f.home,'.turboio')),false);
});
