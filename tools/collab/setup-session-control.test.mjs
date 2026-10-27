import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {sessionControlSetupPlan,applySessionControlSetup,rollbackSessionControlSetup,disableCodexDesktopSetup} from './setup-session-control.mjs';

const ID='io-agent-session-bridge@io-agent-local';
function fixture(t,{codex=false,desktopProxy=false,daemonVersion=null,environment,environmentPresent=environment!==undefined}={}){
  const directory=fs.realpathSync(fs.mkdtempSync('/tmp/io-setup-')),repo=path.join(directory,'repo'),home=path.join(directory,'home');
  fs.mkdirSync(home,{mode:0o700});const source=path.join(repo,'rebuild/agent-bridge/hosts/claude-mod/plugin');
  fs.mkdirSync(path.join(source,'.claude-plugin'),{recursive:true});fs.mkdirSync(path.join(source,'hooks'));
  fs.writeFileSync(path.join(source,'.claude-plugin/plugin.json'),JSON.stringify({name:'io-agent-session-bridge',version:'0.2.0'}));
  fs.writeFileSync(path.join(source,'LICENSE'),'synthetic public license');fs.writeFileSync(path.join(source,'hooks/hooks.json'),'{}');
  fs.writeFileSync(path.join(source,'hooks/register.js'),'// synthetic public module\n');fs.writeFileSync(path.join(source,'hooks/protocol.js'),'// synthetic public protocol\n');
  if(desktopProxy)for(const name of ['codex-desktop-launcher.mjs','codex-app-server.mjs'])fs.writeFileSync(path.join(repo,'rebuild/agent-bridge/hosts',name),'// synthetic launcher source\n');
  const settings=path.join(home,'.claude/settings.json'),marketplaces=path.join(home,'.claude/plugins/known_marketplaces.json');
  fs.mkdirSync(path.dirname(marketplaces),{recursive:true});
  const original={enabledPlugins:{'other-plugin@other-market':true},otherSetting:{keep:'untouched'}};
  fs.writeFileSync(settings,JSON.stringify(original));fs.writeFileSync(marketplaces,JSON.stringify({'other-market':{source:{source:'directory',path:'/synthetic/other'}}}));
  const calls=[],f={directory,repo,home,source,settings,marketplaces,original,calls,daemonVersion,environment,environmentPresent,starts:0,installs:0,updates:0,cachedVersion:null};
  f.plan=(extra={})=>sessionControlSetupPlan({repo,home,claude:'/synthetic/claude',codex,desktopProxy,desktopApp:'/synthetic/InspectedDesktop.app',...extra});
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
    if(binary==='/bin/launchctl'){
      if(args[0]==='getenv')return ok(args[1]==='CODEX_CLI_PATH'?(f.cliEnvironment??''):f.environmentPresent?(f.environment??'')+'\n':'');
      if(args[0]==='print')return ok('gui/'+process.getuid()+' = {\n\tenvironment = {\n\t\tOTHER_APP_SECRET => must-not-leak\n'+(f.environmentPresent?'\t\tCODEX_APP_SERVER_USE_LOCAL_DAEMON => '+(f.environment??'')+'\n':'')+(f.cliEnvironment?'\t\tCODEX_CLI_PATH => '+f.cliEnvironment+'\n':'')+'\t}\n}\n');
      if(args[0]==='setenv'){if(args[1]==='CODEX_CLI_PATH'){f.cliEnvironment=args[2];return ok();}assert.equal(args[1],'CODEX_APP_SERVER_USE_LOCAL_DAEMON');f.environment=args[2];f.environmentPresent=true;return ok();}
      if(args[0]==='unsetenv'){if(args[1]==='CODEX_CLI_PATH'){f.cliEnvironment=undefined;return ok();}assert.equal(args[1],'CODEX_APP_SERVER_USE_LOCAL_DAEMON');f.environment=undefined;f.environmentPresent=false;return ok();}
    }
    assert.fail('Unexpected subprocess '+binary+' '+args.join(' '));
  };
  f.apply=()=>applySessionControlSetup(f.plan(),{run:f.run});f.rollback=()=>rollbackSessionControlSetup(f.plan(),{run:f.run});
  f.disable=()=>disableCodexDesktopSetup(f.plan(),{run:f.run});
  f.seedLegacyCodex=()=>{
    const plan=f.plan({codex:false,desktopProxy:false});applySessionControlSetup(plan,{run:f.run});
    const state=JSON.parse(fs.readFileSync(plan.state));
    state.codex={phase:'installed',previousEnvironment:{present:f.environmentPresent,value:f.environment??''},launcher:{phase:'installed',
      path:path.join(plan.root,'desktop-launcher','codex'),previousEnvironment:{present:!!f.cliEnvironment,value:f.cliEnvironment??''}}};
    fs.writeFileSync(plan.state,JSON.stringify(state),{mode:0o600});
    f.cliEnvironment=state.codex.launcher.path;f.environment='1';f.environmentPresent=true;
  };
  t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));return f;
}

test('default plan reads public sources only and does not create local management or execute commands',t=>{
  const f=fixture(t),plan=f.plan();assert.equal(plan.operation,'plan');assert.equal(plan.codex.enabled,false);assert.equal(fs.existsSync(path.join(f.home,'.turboio')),false);assert.equal(f.calls.length,0);
  const codex=sessionControlSetupPlan({repo:f.repo,home:f.home,claude:'/synthetic/claude',codex:true});assert.equal(codex.codex.supported,false);assert.equal(codex.codex.reason,'SETUP_CODEX_DESKTOP_DISABLED');
});
test('both legacy Desktop install modes are blocked before any command or filesystem write',t=>{
  for(const desktopProxy of [false,true]){
    const f=fixture(t,{codex:true,desktopProxy});
    assert.throws(()=>f.apply(),{code:'SETUP_CODEX_DESKTOP_DISABLED'});
    assert.equal(f.calls.length,0);assert.equal(fs.existsSync(path.join(f.home,'.turboio')),false);
  }
});
test('disabling owned Desktop integration clears only our active overrides and preserves Claude/data',t=>{
  const f=fixture(t);f.seedLegacyCodex();const plan=f.plan(),before=fs.readFileSync(f.settings);
  const file=path.join(plan.sessions,'synthetic-session.txt');fs.writeFileSync(file,'preserve synthetic session');
  const result=f.disable();assert.equal(result.codex_desktop_disabled,true);
  assert.deepEqual(result.cleared_environment,['CODEX_CLI_PATH','CODEX_APP_SERVER_USE_LOCAL_DAEMON']);
  assert.equal(f.cliEnvironment,undefined);assert.equal(f.environmentPresent,false);assert.deepEqual(fs.readFileSync(f.settings),before);
  assert.equal(fs.readFileSync(file,'utf8'),'preserve synthetic session');assert.equal(f.starts,0);
  const state=JSON.parse(fs.readFileSync(plan.state));assert.equal(state.plugin.phase,'installed');assert.equal(state.codex.phase,'disabled');assert.equal(state.codex.launcher.phase,'disabled');
  assert(!f.calls.some(c=>c.args[1]==='uninstall'||c.args.includes('stop')));
});
test('already-cleared Desktop settings stay absent across disable, repeated disable and Claude setup',t=>{
  const f=fixture(t);f.seedLegacyCodex();f.cliEnvironment=undefined;f.environment=undefined;f.environmentPresent=false;
  const priorWrites=f.calls.filter(c=>['setenv','unsetenv'].includes(c.args[0])).length;
  assert.deepEqual(f.disable().cleared_environment,[]);f.disable();const result=f.apply();
  assert.equal(result.codex_desktop_transport,null);assert.equal(result.desktop_restart_pending,false);
  assert.equal(f.calls.filter(c=>['setenv','unsetenv'].includes(c.args[0])).length,priorWrites);
  assert.equal(f.environmentPresent,false);assert.equal(f.cliEnvironment,undefined);
});
test('disable without an old Codex install is a no-op and never installs the Claude plugin',t=>{
  const f=fixture(t);assert.equal(f.disable().codex_desktop_disabled,true);assert.equal(f.calls.length,0);
  assert.equal(fs.existsSync(path.join(f.home,'.turboio')),false);
});
test('disable preserves external overrides and preexisting daemon settings',t=>{
  const f=fixture(t,{environment:'1'});f.seedLegacyCodex();f.cliEnvironment='/synthetic/other-cli';
  const result=f.disable();assert.deepEqual(result.cleared_environment,[]);
  assert.deepEqual(result.preserved_external_environment,['CODEX_CLI_PATH','CODEX_APP_SERVER_USE_LOCAL_DAEMON']);
  assert.equal(f.cliEnvironment,'/synthetic/other-cli');assert.equal(f.environment,'1');assert(!f.calls.some(c=>c.args[0]==='unsetenv'));
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
test('legacy full rollback can still restore original values and uninstall only the owned Claude plugin',t=>{
  const f=fixture(t,{environment:'0'});f.seedLegacyCodex();f.rollback();
  assert.equal(f.environment,'0');assert.equal(f.environmentPresent,true);assert.equal(f.cliEnvironment,undefined);
  assert.deepEqual(JSON.parse(fs.readFileSync(f.settings)),f.original);
  assert.equal(JSON.parse(fs.readFileSync(f.marketplaces))['other-market'].source.path,'/synthetic/other');
});
test('rollback distinguishes an absent flag from an originally present empty value',t=>{
  for(const present of [true,false]){
    const f=fixture(t,{environment:'',environmentPresent:present});f.seedLegacyCodex();assert(!JSON.stringify(JSON.parse(fs.readFileSync(f.plan().state))).includes('must-not-leak'));f.rollback();
    assert.equal(f.environmentPresent,present);assert.equal(f.environment??'','');
  }
});
test('a third-party change after installation prevents rollback from overwriting environment',t=>{
  const f=fixture(t);f.seedLegacyCodex();f.environment='third-party';assert.throws(()=>f.rollback(),{code:'SETUP_ROLLBACK_ENVIRONMENT_CHANGED'});assert.equal(f.environment,'third-party');assert.equal(JSON.parse(fs.readFileSync(f.settings)).enabledPlugins[ID],true);
});
test('a repointed marketplace is not overwritten or uninstalled as though it still belonged to setup',t=>{
  const f=fixture(t);f.apply();const catalogs=JSON.parse(fs.readFileSync(f.marketplaces));catalogs['io-agent-local'].source.path='/unrelated/replacement';fs.writeFileSync(f.marketplaces,JSON.stringify(catalogs));
  assert.throws(()=>f.rollback(),{code:'SETUP_MARKETPLACE_CHANGED'});assert.throws(()=>f.apply(),{code:'SETUP_MARKETPLACE_CHANGED'});
  assert.equal(JSON.parse(fs.readFileSync(f.settings)).enabledPlugins[ID],true);assert(!f.calls.some(c=>c.args[1]==='uninstall'));
});
test('source mutation after plan generation is rejected before any command or directory mutation',t=>{
  const f=fixture(t),plan=f.plan();fs.appendFileSync(path.join(f.source,'hooks/protocol.js'),'// source changed');assert.throws(()=>applySessionControlSetup(plan,{run:f.run}),{code:'SETUP_SOURCE_CHANGED'});assert.equal(f.calls.length,0);assert.equal(fs.existsSync(path.join(f.home,'.turboio')),false);
});
