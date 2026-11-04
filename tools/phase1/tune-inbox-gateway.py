"""Align only the inbox long-watch gateway timeout with the 25-second contract."""
import argparse,json,subprocess
from pathlib import Path
REMOTE=r'''
import pathlib,subprocess,time,json,hashlib
config=pathlib.Path('/etc/nginx/sites-enabled/ev').resolve();before=config.read_bytes();text=before.decode()
start=text.index('  location /io-api/v1/ {');end=text.index('\n  }',start)+4;original=text[start:end]
assert original.count('proxy_read_timeout 15s;')==1,'INBOX_GATEWAY_BASELINE_CHANGED'
block=original.replace('location /io-api/v1/', 'location = /io-api/v1/inbox/watch').replace('proxy_pass http://127.0.0.1:3401/v1/;', 'proxy_pass http://127.0.0.1:3401/v1/inbox/watch;').replace('proxy_read_timeout 15s;', 'proxy_read_timeout 35s;')
if 'location = /io-api/v1/inbox/watch' in text:assert block in text,'INBOX_GATEWAY_CHANGED'
after=before if block in text else (text[:start]+block+'\n\n'+text[start:]).encode()
if not apply:print(json.dumps({'inspected':True,'change_required':after!=before,'before_sha256':hashlib.sha256(before).hexdigest()}));raise SystemExit(0)
backup=pathlib.Path('/var/lib/turboio-material')/('inbox-watch-gateway-before-'+str(time.time_ns())+'.conf');backup.write_bytes(before);backup.chmod(0o600)
try:
 config.write_bytes(after);subprocess.run(['nginx','-t'],check=True,capture_output=True,timeout=20);subprocess.run(['systemctl','reload','nginx'],check=True,timeout=20)
except Exception:
 config.write_bytes(before);subprocess.run(['nginx','-t'],check=True,capture_output=True,timeout=20);subprocess.run(['systemctl','reload','nginx'],check=True,timeout=20);raise
print(json.dumps({'applied':True,'backup':str(backup),'watch_timeout_seconds':35,'other_api_timeouts_changed':False,'before_sha256':hashlib.sha256(before).hexdigest(),'after_sha256':hashlib.sha256(after).hexdigest()}))
'''
if __name__=='__main__':
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--apply',action='store_true');p.add_argument('--out',required=True);a=p.parse_args()
 r=subprocess.run(['ssh','-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','ubuntu@43.142.59.131','sudo -n python3 -'],input='apply='+repr(a.apply)+'\n'+REMOTE,text=True,capture_output=True,timeout=60)
 if r.returncode:raise SystemExit('INBOX_GATEWAY_UPDATE_FAILED: '+r.stderr[-1500:])
 v=json.loads(r.stdout);Path(a.out).write_text(json.dumps(v,indent=2)+'\n');print(json.dumps(v))
