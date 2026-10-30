"""Deploy the authenticated admin UI and management endpoints.
Default is hash inspection; --apply snapshots SQLite and backs up touched code.
No grant, credential, site, nginx, audio or database restore is performed.
"""
import argparse,base64,hashlib,json,subprocess
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
PROFILES={
 'notifications':['store.mjs','http.mjs','devices.mjs','phone-presence.mjs','admin-console.mjs'],
 'login':['store.mjs','http.mjs','cli.mjs','admin-auth.mjs','admin/index.html','admin/app.js','admin/style.css'],
 'console':['store.mjs','http.mjs','devices.mjs','agent-sessions.mjs','phone-presence.mjs','traffic.mjs','admin-console.mjs','admin/index.html','admin/app.js','admin/console.js','admin/style.css']
}
REMOTE=r'''
import base64,hashlib,json,os,pathlib,sqlite3,subprocess,time,urllib.request,shutil
root=pathlib.Path('/opt/turboio/rebuild/material-server');service='turboio-material.service';node='/opt/turboio/node22/bin/node'
for name,item in data.items():
 p=root/name
 assert not p.is_symlink()
 assert (hashlib.sha256(p.read_bytes()).hexdigest() if p.exists() else None)==item['before'],'BASELINE_CHANGED: '+name
 assert hashlib.sha256(base64.b64decode(item['body'])).hexdigest()==item['after']
assert subprocess.check_output(['systemctl','is-active',service],text=True).strip()=='active'
if not apply:
 print(json.dumps({'inspected':True,'baseline_matches':True,'files':len(data)}));raise SystemExit(0)
backup=pathlib.Path('/var/lib/turboio-material/admin-'+profile+'-release-'+str(time.time_ns()));backup.mkdir(mode=0o700)
with sqlite3.connect('/var/lib/turboio-material/materials.sqlite') as live,sqlite3.connect(str(backup/'before.sqlite')) as copy:
 live.backup(copy);assert copy.execute('PRAGMA quick_check').fetchone()[0]=='ok'
os.chmod(backup/'before.sqlite',0o600)
for name in data:
 if (root/name).exists():
  (backup/name).parent.mkdir(parents=True,exist_ok=True);(backup/name).write_bytes((root/name).read_bytes())
switched=False
try:
 stage=backup/'verify';shutil.copytree(root,stage,ignore=shutil.ignore_patterns('node_modules'));(stage/'node_modules').symlink_to(root/'node_modules',target_is_directory=True)
 for name,item in data.items():
  p=stage/name;p.write_bytes(base64.b64decode(item['body']));os.chmod(p,0o644)
  if p.suffix in ['.js','.mjs']:subprocess.run([node,'--check',str(p)],check=True,capture_output=True,timeout=20)
 smoke="""import assert from 'node:assert/strict';import {MaterialStore} from './store.mjs';const s=new MaterialStore(':memory:');
 s.mint({owner:'caller601-admin-codex',producer:'qa',scopes:['operations:read']});await s.admin.enroll({username:'qa.admin',owner:'caller601-admin-codex',password:'synthetic-initial-password'});
 const first=await s.admin.login({username:'qa.admin',password:'synthetic-initial-password'});assert.equal(first.profile.must_change_password,true);
 const second=await s.admin.change(first.token,{current_password:'synthetic-initial-password',new_password:'synthetic-personal-password'});assert.equal(second.profile.must_change_password,false);assert.throws(()=>s.admin.session(first.token));assert.deepEqual(s.operationsForOwner('caller601-admin-codex').queue,[]);
 if(s.console){const device=s.devices.enroll({owner:'caller601-admin-codex',role:'agent',label:'QA computer'});const session=s.admin.session(second.token);
 assert.equal(s.console.read(session.owner,'devices',{},null).items.length,1);s.console.action(session,{action:'delivery',device_id:device.device_id,paused:true});assert.equal(s.inbox(device.token).delivery_paused,true);
 s.console.action(session,{action:'delivery',device_id:device.device_id,paused:false});assert.equal(s.console.read(session.owner,'audit',{},null).items.length,2);assert.equal(s.console.read(session.owner,'daily',{},null).total,0);}
 s.admin.logout(second.token);assert.throws(()=>s.admin.session(second.token));s.close();"""
 if profile=='notifications':
  smoke=smoke.replace('s.close();', """const {listen}=await import('./http.mjs');const device=s.devices.enroll({owner:'caller601-admin-codex',role:'agent',label:'QA notification'});const http=await listen(s,0);const url='http://127.0.0.1:'+http.address().port+'/v1/inbox/watch',headers={Authorization:'Bearer '+device.token};
  const marker=await(await fetch(url,{headers})).json();const pending=fetch(url+'?version='+marker.version,{headers,signal:AbortSignal.timeout(2000)});for(let n=0;n<100&&!s.inboxWaiters.size;n++)await new Promise(r=>setTimeout(r,5));assert.equal(s.inboxWaiters.size,1);s.devices.revoke(device.device_id);assert.equal((await pending).status,401);http.closeAllConnections();await new Promise(r=>http.close(r));s.close();""")
 checked=subprocess.run([node,'--input-type=module','-e',smoke],cwd=stage,capture_output=True,text=True,timeout=30)
 if checked.returncode:raise RuntimeError('ISOLATED_SMOKE_FAILED: '+checked.stderr[-3000:])
 switched=True;subprocess.run(['systemctl','stop',service],check=True,timeout=30)
 for name,item in data.items():
  p=root/name;p.write_bytes(base64.b64decode(item['body']));os.chmod(p,0o644)
 subprocess.run(['systemctl','start',service],check=True,timeout=30)
 shutil.rmtree(stage)
 for attempt in range(30):
  try:
   with urllib.request.urlopen('http://127.0.0.1:3401/health',timeout=2) as r:assert r.status==200
   break
  except Exception:
   if attempt==29:raise
   time.sleep(.2)
 assert subprocess.check_output(['systemctl','is-active',service],text=True).strip()=='active'
 print(json.dumps({'deployed':True,'backup':str(backup),'source_sha256':{n:v['after'] for n,v in data.items()},'grants_changed':False,'snapshot_checked':True,'production_runtime_smoke_passed':True}))
except Exception:
 if not switched:
  shutil.rmtree(stage,ignore_errors=True);raise
 subprocess.run(['systemctl','stop',service],check=True,timeout=30)
 for name,item in data.items():
  if item['before'] is None:(root/name).unlink(missing_ok=True)
  else:(root/name).write_bytes((backup/name).read_bytes())
 subprocess.run(['systemctl','start',service],check=True,timeout=30)
 raise
'''
def main():
 parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--profile',choices=PROFILES,default='login');parser.add_argument('--baseline',required=True);parser.add_argument('--source',required=True);parser.add_argument('--out',required=True);parser.add_argument('--apply',action='store_true');args=parser.parse_args()
 data={}
 for name in PROFILES[args.profile]:
  path='rebuild/material-server/'+name
  body=subprocess.check_output(['git','show',args.source+':'+path],cwd=ROOT)
  assert body==(ROOT/path).read_bytes(),'SOURCE_CHANGED: '+name
  old=subprocess.run(['git','show',args.baseline+':'+path],cwd=ROOT,capture_output=True)
  assert old.returncode==0 or name in ['admin-auth.mjs','admin-console.mjs','admin/console.js'],'BASELINE_UNAVAILABLE: '+name
  data[name]={'before':hashlib.sha256(old.stdout).hexdigest() if old.returncode==0 else None,'after':hashlib.sha256(body).hexdigest(),'body':base64.b64encode(body).decode()}
 r=subprocess.run(['ssh','-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','-o','ConnectTimeout=10','ubuntu@43.142.59.131','sudo -n python3 -'],input='data='+repr(data)+'\napply='+repr(args.apply)+'\nprofile='+repr(args.profile)+'\n'+REMOTE,text=True,capture_output=True,timeout=120)
 if r.returncode:raise SystemExit('ADMIN_LOGIN_RELEASE_FAILED: '+r.stderr[-1800:])
 report=json.loads(r.stdout);report['source_commit']=args.source;report['profile']=args.profile;Path(args.out).write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report))
if __name__=='__main__':main()
