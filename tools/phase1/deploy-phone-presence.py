"""Deploy the primary-phone boundary to the existing iO service only.
Default is hash inspection; --apply snapshots SQLite and backs up touched code.
No grant, credential, site, nginx, audio or database restore is performed.
"""
import argparse,base64,hashlib,json,subprocess
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
FILES=['store.mjs','http.mjs','devices.mjs','todo-suggestions.mjs','phone-presence.mjs']
REMOTE=r'''
import base64,hashlib,json,os,pathlib,sqlite3,subprocess,time,urllib.request
root=pathlib.Path('/opt/turboio/rebuild/material-server');service='turboio-material.service';node='/opt/turboio/node22/bin/node'
for name,item in data.items():
 p=root/name
 assert not p.is_symlink()
 assert (hashlib.sha256(p.read_bytes()).hexdigest() if p.exists() else None)==item['before'],'BASELINE_CHANGED: '+name
 assert hashlib.sha256(base64.b64decode(item['body'])).hexdigest()==item['after']
assert subprocess.check_output(['systemctl','is-active',service],text=True).strip()=='active'
if not apply:
 print(json.dumps({'inspected':True,'baseline_matches':True,'files':len(data)}));raise SystemExit(0)
backup=pathlib.Path('/var/lib/turboio-material/phone-presence-release-'+str(time.time_ns()));backup.mkdir(mode=0o700)
with sqlite3.connect('/var/lib/turboio-material/materials.sqlite') as live,sqlite3.connect(str(backup/'before.sqlite')) as copy:
 live.backup(copy);assert copy.execute('PRAGMA quick_check').fetchone()[0]=='ok'
os.chmod(backup/'before.sqlite',0o600)
for name in data:
 if (root/name).exists():(backup/name).write_bytes((root/name).read_bytes())
try:
 subprocess.run(['systemctl','stop',service],check=True,timeout=30)
 for name,item in data.items():
  p=root/name;p.write_bytes(base64.b64decode(item['body']));os.chmod(p,0o644)
  subprocess.run([node,'--check',str(p)],check=True,capture_output=True,timeout=20)
 smoke="""import assert from 'node:assert/strict';import {MaterialStore} from './store.mjs';const s=new MaterialStore(':memory:');
 const a=s.devices.enroll({owner:'caller601-phone-20261028-codex',role:'agent',label:'Synthetic computer'}),account_binding='a'.repeat(64);
 const pair=label=>s.devices.pair({code:s.devices.createPairing(a.token,{role:'phone',label}).code,account_binding});const old=pair('old'),next=pair('new');
 const before=s.phones.update(old.token,{account_binding});assert.equal(before.lease_ms,20000);const switched=s.phones.update(next.token,{account_binding,expected_revision:before.revision},true);
 assert.equal(switched.lease_ms,0);assert(switched.wait_ms>0);assert.equal(s.phones.update(old.token,{account_binding}).lease_ms,0);assert(s.phones.permits(s.auth(a.token)));
 assert(s.identity(next.token).capabilities.includes('primary_phone_v1'));s.close();"""
 subprocess.run([node,'--input-type=module','-e',smoke],cwd=root,check=True,capture_output=True,timeout=30)
 subprocess.run(['systemctl','start',service],check=True,timeout=30)
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
 subprocess.run(['systemctl','stop',service],check=True,timeout=30)
 for name,item in data.items():
  if item['before'] is None:(root/name).unlink(missing_ok=True)
  else:(root/name).write_bytes((backup/name).read_bytes())
 subprocess.run(['systemctl','start',service],check=True,timeout=30)
 raise
'''
def main():
 parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--baseline',required=True);parser.add_argument('--source',required=True);parser.add_argument('--out',required=True);parser.add_argument('--apply',action='store_true');args=parser.parse_args()
 data={}
 for name in FILES:
  path='rebuild/material-server/'+name
  body=subprocess.check_output(['git','show',args.source+':'+path],cwd=ROOT)
  assert body==(ROOT/path).read_bytes(),'SOURCE_CHANGED: '+name
  old=subprocess.run(['git','show',args.baseline+':'+path],cwd=ROOT,capture_output=True)
  assert old.returncode==0 or name=='phone-presence.mjs','BASELINE_UNAVAILABLE: '+name
  data[name]={'before':hashlib.sha256(old.stdout).hexdigest() if old.returncode==0 else None,'after':hashlib.sha256(body).hexdigest(),'body':base64.b64encode(body).decode()}
 r=subprocess.run(['ssh','-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','-o','ConnectTimeout=10','ubuntu@43.142.59.131','sudo -n python3 -'],input='data='+repr(data)+'\napply='+repr(args.apply)+'\n'+REMOTE,text=True,capture_output=True,timeout=120)
 if r.returncode:raise SystemExit('PHONE_RELEASE_FAILED: '+r.stderr[-1800:])
 report=json.loads(r.stdout);report['source_commit']=args.source;Path(args.out).write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report))
if __name__=='__main__':main()
