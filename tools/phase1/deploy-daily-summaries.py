"""Deploy the daily-summary reader and the user's explicit paired-computer read grant.
Checks the exact baseline; backs up SQLite/code; rollback changes code and touched scopes only.
Never restores an old database over live phone writes or changes single-session authorization.
"""
import argparse,base64,hashlib,json,subprocess
from pathlib import Path

ROOT=Path(__file__).resolve().parents[2]
FILES=['store.mjs','http.mjs','devices.mjs']
REMOTE=r'''
import base64,hashlib,json,os,pathlib,sqlite3,subprocess,time,urllib.request
root=pathlib.Path('/opt/turboio/rebuild/material-server');database='/var/lib/turboio-material/materials.sqlite'
node='/opt/turboio/node22/bin/node';service='turboio-material.service'
def run(args):return subprocess.check_output(args,text=True,timeout=30).strip()
for name,item in data.items():
 path=root/name
 assert not path.is_symlink() and hashlib.sha256(path.read_bytes()).hexdigest()==item['before'],'BASELINE_CHANGED: '+name
 assert hashlib.sha256(base64.b64decode(item['body'])).hexdigest()==item['after']
assert run(['systemctl','is-active',service])=='active'
backup=pathlib.Path('/var/lib/turboio-material/daily-reader-release-'+str(time.time_ns()));backup.mkdir(mode=0o700)
with sqlite3.connect(database) as live,sqlite3.connect(str(backup/'before.sqlite')) as copy:
 live.backup(copy);assert copy.execute('PRAGMA quick_check').fetchone()[0]=='ok'
os.chmod(backup/'before.sqlite',0o600)
for name in data:(backup/name).write_bytes((root/name).read_bytes())
changed=[]
try:
 subprocess.run(['systemctl','stop',service],check=True,timeout=30)
 for name,item in data.items():
  temp=root/(name+'.codex-new');assert not temp.exists();temp.write_bytes(base64.b64decode(item['body']));os.chmod(temp,0o644);os.replace(temp,root/name)
  subprocess.run([node,'--check',str(root/name)],check=True,capture_output=True,timeout=20)
 smoke="""import assert from 'node:assert/strict';import {MaterialStore} from './store.mjs';
 const s=new MaterialStore(':memory:');const a=s.devices.enroll({owner:'caller600-daily-20261027-codex',role:'agent',label:'Synthetic daily reader'});
 assert(s.identity(a.token).scopes.includes('daily-summaries:read'));assert(s.identity(a.token).capabilities.includes('daily_summaries_v1'));
 assert.equal(s.page(a.token,'daily-summaries',{}).items.length,0);assert.throws(()=>s.page(a.token,'materials',{}),{code:'FORBIDDEN'});s.close();"""
 subprocess.run([node,'--input-type=module','-e',smoke],cwd=root,check=True,capture_output=True,timeout=30)
 with sqlite3.connect(database) as db:
  rows=db.execute("SELECT c.token_id,c.scopes FROM credentials c JOIN device_tokens t ON t.token_id=c.token_id JOIN devices d ON d.device_id=t.device_id WHERE d.owner=? AND d.role='agent' AND d.revoked_at IS NULL AND c.revoked=0 AND c.expires>? AND NOT EXISTS(SELECT 1 FROM session_bindings b WHERE b.owner=d.owner AND b.producer=d.producer)",(owner,int(time.time()*1000))).fetchall()
  assert rows,'NO_PAIRED_COMPUTER'
  for token_id,old in rows:
   scopes=json.loads(old)
   if 'daily-summaries:read' not in scopes:
    changed.append([token_id,old]);db.execute('UPDATE credentials SET scopes=? WHERE token_id=?',(json.dumps(scopes+['daily-summaries:read']),token_id))
  (backup/'scope-before.json').write_text(json.dumps(changed));os.chmod(backup/'scope-before.json',0o600)
 subprocess.run(['systemctl','start',service],check=True,timeout=30)
 for attempt in range(30):
  try:
   with urllib.request.urlopen('http://127.0.0.1:3401/health',timeout=2) as r:assert r.status==200
   break
  except Exception:
   if attempt==29:raise
   time.sleep(.2)
 assert run(['systemctl','is-active',service])=='active'
 print(json.dumps({'deployed':True,'backup':str(backup),'node':run([node,'--version']),'source_sha256':{n:v['after'] for n,v in data.items()},'paired_computer_tokens_granted':len(changed),'owner':owner,'single_session_grants_unchanged':True,'sqlite_snapshot_checked':True,'production_runtime_smoke_passed':True}))
except Exception:
 subprocess.run(['systemctl','stop',service],check=True,timeout=30)
 for name in data:(root/name).write_bytes((backup/name).read_bytes())
 with sqlite3.connect(database) as db:
  for token_id,old in changed:db.execute('UPDATE credentials SET scopes=? WHERE token_id=?',(old,token_id))
 subprocess.run(['systemctl','start',service],check=True,timeout=30)
 raise
'''

def main():
 parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--owner',required=True);parser.add_argument('--baseline',default='HEAD');args=parser.parse_args()
 data={}
 for name in FILES:
  body=(ROOT/'rebuild/material-server'/name).read_bytes();old=subprocess.check_output(['git','show',args.baseline+':rebuild/material-server/'+name],cwd=ROOT)
  data[name]={'body':base64.b64encode(body).decode(),'before':hashlib.sha256(old).hexdigest(),'after':hashlib.sha256(body).hexdigest()}
 script='data='+repr(data)+'\nowner='+repr(args.owner)+'\n'+REMOTE
 result=subprocess.run(['ssh','-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','-o','ConnectTimeout=10','ubuntu@43.142.59.131','sudo -n python3 -'],input=script,text=True,capture_output=True,timeout=120)
 if result.returncode:raise SystemExit('DAILY_READER_DEPLOY_FAILED: '+result.stderr[-2000:])
 report=json.loads(result.stdout);Path('/tmp/io-daily-server-release.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report))

if __name__=='__main__':main()
