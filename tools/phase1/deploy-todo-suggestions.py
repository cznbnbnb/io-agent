"""Publish native-todo suggestions without changing grants or restoring live data."""
import base64,hashlib,json,subprocess
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
FILES=['store.mjs','http.mjs','todo-suggestions.mjs']
REMOTE=r'''
import base64,hashlib,json,os,pathlib,sqlite3,subprocess,time,urllib.request
root=pathlib.Path('/opt/turboio/rebuild/material-server');service='turboio-material.service';node='/opt/turboio/node22/bin/node'
for name,item in data.items():
 p=root/name
 assert not p.is_symlink()
 assert (hashlib.sha256(p.read_bytes()).hexdigest() if p.exists() else None)==item['before'],'BASELINE_CHANGED: '+name
 assert hashlib.sha256(base64.b64decode(item['body'])).hexdigest()==item['after']
assert subprocess.check_output(['systemctl','is-active',service],text=True).strip()=='active'
backup=pathlib.Path('/var/lib/turboio-material/todo-release-'+str(time.time_ns()));backup.mkdir(mode=0o700)
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
 const a=s.devices.enroll({owner:'caller600-todo-20261027-codex',role:'agent',label:'Synthetic todo agent'}),p=s.devices.enroll({owner:'caller600-todo-20261027-codex',role:'phone',label:'Synthetic phone'});
 const r=s.todoSuggestions.create(a.token,{todo_key:'smoke',content:'synthetic native todo'});assert.equal(r.native_created,false);
 assert.throws(()=>s.todoSuggestions.phone(p.token,r.proposal_id,{action:'begin'}),{code:'TODO_STATE_CONFLICT'});
 assert(s.identity(a.token).capabilities.includes('todo_suggestions_v1'));s.close();"""
 subprocess.run([node,'--input-type=module','-e',smoke],cwd=root,check=True,capture_output=True,timeout=30)
 subprocess.run(['systemctl','start',service],check=True,timeout=30)
 for attempt in range(30):
  try:
   with urllib.request.urlopen('http://127.0.0.1:3401/health',timeout=2) as r:assert r.status==200
   break
  except Exception:
   if attempt==29:raise
   time.sleep(.2)
 print(json.dumps({'deployed':True,'backup':str(backup),'source_sha256':{n:v['after'] for n,v in data.items()},'grants_changed':False,'snapshot_checked':True,'production_smoke_passed':True}))
except Exception:
 subprocess.run(['systemctl','stop',service],check=True,timeout=30)
 for name,item in data.items():
  if item['before'] is None:(root/name).unlink(missing_ok=True)
  else:(root/name).write_bytes((backup/name).read_bytes())
 subprocess.run(['systemctl','start',service],check=True,timeout=30)
 raise
'''
data={}
for name in FILES:
 body=(ROOT/'rebuild/material-server'/name).read_bytes()
 old=None if name=='todo-suggestions.mjs' else subprocess.check_output(['git','show','HEAD:rebuild/material-server/'+name],cwd=ROOT)
 data[name]={'before':None if old is None else hashlib.sha256(old).hexdigest(),'after':hashlib.sha256(body).hexdigest(),'body':base64.b64encode(body).decode()}
r=subprocess.run(['ssh','-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','-o','ConnectTimeout=10','ubuntu@43.142.59.131','sudo -n python3 -'],input='data='+repr(data)+'\n'+REMOTE,text=True,capture_output=True,timeout=120)
if r.returncode:raise SystemExit('TODO_DEPLOY_FAILED: '+r.stderr[-1800:])
report=json.loads(r.stdout);Path('/tmp/io-todo-server-release.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report))
