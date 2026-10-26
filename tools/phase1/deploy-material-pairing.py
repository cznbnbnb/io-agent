"""Narrow additive pairing release: exact baseline, SQLite snapshot, code-only rollback.
No task schemas, audio database, nginx settings or existing material history are changed.
"""
import base64,hashlib,json,subprocess,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
SESSION='--session' in sys.argv
BASELINE=sys.argv[sys.argv.index('--baseline')+1] if '--baseline' in sys.argv else 'HEAD'
FILES=['store.mjs','http.mjs','session-pairings.mjs'] if SESSION else ['store.mjs','http.mjs','cli.mjs','material-pairings.mjs']
REMOTE=r'''
import base64,hashlib,json,os,pathlib,sqlite3,subprocess,time
root=pathlib.Path('/opt/turboio/rebuild/material-server');node='/opt/turboio/node22/bin/node';service='turboio-material.service'
def sha(b):return hashlib.sha256(b).hexdigest()
def run(args):return subprocess.check_output(args,text=True,timeout=30).strip()
for name,value in data.items():
 p=root/name
 assert not p.is_symlink()
 assert (sha(p.read_bytes()) if p.exists() else None)==value['before'], 'BASELINE_CHANGED'
 assert sha(base64.b64decode(value['body']))==value['after']
assert run(['systemctl','is-active',service])=='active'
backup=pathlib.Path('/var/lib/turboio-material/pairing-release-'+str(time.time_ns()));backup.mkdir(mode=0o700)
with sqlite3.connect('/var/lib/turboio-material/materials.sqlite') as live,sqlite3.connect(str(backup/'before.sqlite')) as copy:
 live.backup(copy);assert copy.execute('PRAGMA quick_check').fetchone()[0]=='ok'
os.chmod(backup/'before.sqlite',0o600)
for name in data:
 if (root/name).exists():(backup/name).write_bytes((root/name).read_bytes())
(backup/'manifest.json').write_text(json.dumps({n:{k:v[k] for k in ['before','after']} for n,v in data.items()}))
try:
 subprocess.run(['systemctl','stop',service],check=True,timeout=30)
 for name,value in data.items():
  temp=root/(name+'.codex-new');assert not temp.exists();temp.write_bytes(base64.b64decode(value['body']));os.chmod(temp,0o644);os.replace(temp,root/name)
 # Test exactly the production Node runtime and source, with an isolated in-memory DB.
 script="""import {MaterialStore} from './store.mjs';import assert from 'node:assert/strict';let t=Date.now();const s=new MaterialStore(':memory:',{clock:()=>t});const p=s.materialPairings.enroll({owner:'synthetic-codex',producer:'phone',account:'a'.repeat(64)});t+=40*86400000;const input={pairing_id:p.pairing_id,account_binding:'a'.repeat(64)};const r=s.materialPairings.refresh(p.refresh_secret,input);assert.equal(s.auth(r.token).owner,'synthetic-codex');assert.deepEqual(s.materialPairings.refresh(p.refresh_secret,input),r);s.materialPairings.revokeBy(p.refresh_secret,input);assert.throws(()=>s.auth(r.token));s.close();"""
 if session:
  script="""import {MaterialStore} from './store.mjs';import assert from 'node:assert/strict';import {randomUUID,randomBytes} from 'node:crypto';let t=Date.now();const s=new MaterialStore(':memory:',{clock:()=>t});const phone=s.devices.enroll({owner:'synthetic-codex',role:'phone',label:'Synthetic'});const input={id:randomUUID(),claim_secret:randomBytes(32).toString('base64url'),metadata:{runtime:'workbuddy',route:{computer_id:'c',agent_id:'io-workbuddy',project_id:'p',session_id:'s'},topic:'Synthetic',workspace:'test'}};const r=s.sessionPairings.start(input);const q=new URLSearchParams(new URL(r.qr_url).hash.slice(1));s.sessionPairings.approve(phone.token,{id:q.get('id'),code:q.get('code')});const claim={id:input.id,claim_secret:input.claim_secret};const a=s.sessionPairings.claim(claim);assert(s.auth(a.token).sessionRoute);t+=40*86400000;const b=s.sessionPairings.claim(claim);assert.notEqual(a.token,b.token);s.devices.revoke(b.device_id);assert.throws(()=>s.sessionPairings.claim(claim));s.close();"""
 subprocess.run([node,'--input-type=module','-e',script],cwd=root,check=True,capture_output=True,timeout=30)
 subprocess.run(['systemctl','start',service],check=True,timeout=30)
 assert run(['systemctl','is-active',service])=='active'
 import urllib.request
 for i in range(30):
  try:
   with urllib.request.urlopen('http://127.0.0.1:3401/health',timeout=2) as r:assert r.status==200
   break
  except Exception:
   if i==29:raise
   time.sleep(.2)
 print(json.dumps({'deployed':True,'backup':str(backup),'node':run([node,'--version']),'source_sha256':{n:v['after'] for n,v in data.items()},'memory_recovery_revoke_test':True}))
except Exception:
 subprocess.run(['systemctl','stop',service],check=True,timeout=30)
 for name,value in data.items():
  if value['before'] is None:(root/name).unlink(missing_ok=True)
  else:(root/name).write_bytes((backup/name).read_bytes())
 subprocess.run(['systemctl','start',service],check=True,timeout=30)
 raise
'''
def main():
 data={}
 for name in FILES:
  body=(ROOT/'rebuild/material-server'/name).read_bytes()
  old=subprocess.run(['git','show',BASELINE+':rebuild/material-server/'+name],cwd=ROOT,capture_output=True)
  data[name]={'body':base64.b64encode(body).decode(),'before':hashlib.sha256(old.stdout).hexdigest() if old.returncode==0 else None,'after':hashlib.sha256(body).hexdigest()}
 script='data='+repr(data)+'\nsession='+repr(SESSION)+'\n'+REMOTE
 result=subprocess.run(['ssh','-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','-o','ConnectTimeout=10','ubuntu@43.142.59.131','sudo -n python3 -'],input=script,text=True,capture_output=True,timeout=90)
 if result.returncode:raise SystemExit('PAIRING_DEPLOY_FAILED: '+result.stderr[-2000:])
 report=json.loads(result.stdout);(ROOT/('rebuild/android-app/build/session-pairing-release.json' if SESSION else 'rebuild/android-app/build/material-pairing-release.json')).write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report))
if __name__=='__main__':main()
