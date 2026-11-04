"""Publish an installed, hash-checked iO Agent build. Inspect by default.
The phone receives a public manifest and signed APK, never a signing key.
"""
import argparse, hashlib, json, re, subprocess, uuid
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
HOST='ubuntu@43.142.59.131'
REMOTE=r"""
import hashlib,json,pathlib,subprocess,shutil,os,time
def sha(file):
 h=hashlib.sha256()
 with file.open('rb') as stream:
  for block in iter(lambda:stream.read(1048576),b''):h.update(block)
 return h.hexdigest()
upload=pathlib.Path(upload);assert upload.is_file() and not upload.is_symlink()
assert upload.stat().st_size==manifest['bytes'] and sha(upload)==manifest['sha256']
root=pathlib.Path('/var/lib/turboio-updates');assert not root.is_symlink()
nginx=pathlib.Path('/etc/nginx/sites-enabled/ev').resolve();before=nginx.read_bytes();text=before.decode()
block='''  location /io-updates/ {
    alias /var/lib/turboio-updates/;
    autoindex off;
    add_header Cache-Control "no-store" always;
    add_header X-Content-Type-Options "nosniff" always;
    types { application/json json; application/vnd.android.package-archive apk; }
  }

'''
if 'location /io-updates/' not in text:
 anchor='  location /io-api/v1/ {';assert text.count(anchor)==1;after=text.replace(anchor,block+anchor).encode()
else:
 assert block in text,'UPDATE_NGINX_CHANGED';after=before
if not apply:
 print(json.dumps({'inspected':True,'artifact_verified':True,'nginx_change_required':after!=before}));raise SystemExit(0)
backup=pathlib.Path('/var/lib/turboio-material/app-update-release-'+str(time.time_ns()));backup.mkdir(mode=0o700);(backup/'nginx-before.conf').write_bytes(before)
root.mkdir(mode=0o755,exist_ok=True);latest=root/'latest.json';old=latest.read_bytes() if latest.exists() else None
if old is not None:(backup/'latest-before.json').write_bytes(old)
target=root/pathlib.PurePosixPath(manifest['url']).name
if target.exists():assert sha(target)==manifest['sha256'],'VERSION_ARTIFACT_CHANGED'
else:shutil.copyfile(upload,target);os.chmod(target,0o644)
try:
 nginx.write_bytes(after);subprocess.run(['nginx','-t'],check=True,capture_output=True,timeout=20)
 temporary=root/'latest.json.tmp';temporary.write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n');os.chmod(temporary,0o644);temporary.replace(latest)
 subprocess.run(['systemctl','reload','nginx'],check=True,timeout=20)
except Exception:
 nginx.write_bytes(before)
 if old is None:latest.unlink(missing_ok=True)
 else:latest.write_bytes(old)
 subprocess.run(['nginx','-t'],check=True,capture_output=True,timeout=20);subprocess.run(['systemctl','reload','nginx'],check=True,timeout=20);raise
keep={target.name}
if old is not None:keep.add(pathlib.PurePosixPath(json.loads(old)['url']).name)
for artifact in root.glob('iO-Agent-Android-*.apk'):
 if artifact.name not in keep and artifact.is_file() and not artifact.is_symlink():artifact.unlink()
print(json.dumps({'published':True,'backup':str(backup),'version':manifest['version'],'sha256':manifest['sha256'],'manifest':'https://cznbnb.cn/io-updates/latest.json','firmware_changed':False}))
"""
def main():
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--notes',required=True);p.add_argument('--apply',action='store_true');p.add_argument('--out',required=True);a=p.parse_args()
 candidate=json.loads((ROOT/'rebuild/android-app/candidate.json').read_text());assert candidate.get('installed') is True and candidate['application_id']=='cn.cznbnb.ioagent','INSTALLED_BUILD_REQUIRED'
 apk=ROOT/'rebuild/android-app'/candidate['apk'];assert apk.is_file() and apk.stat().st_size==candidate['bytes']
 digest=hashlib.sha256()
 with apk.open('rb') as stream:
  for block in iter(lambda:stream.read(1048576),b''):digest.update(block)
 assert digest.hexdigest()==candidate['sha256']
 assert re.fullmatch(r'iO-Agent-Android-[A-Za-z0-9.-]+\.apk',apk.name)
 notes=json.loads(Path(a.notes).read_text());assert isinstance(notes,list) and len(notes)<=20 and all(isinstance(v,str) and 0<len(v)<=500 for v in notes)
 manifest={'schema':1,'application_id':candidate['application_id'],'version':candidate['version'],'version_code':candidate['version_code'],'url':'https://cznbnb.cn/io-updates/'+apk.name,'bytes':candidate['bytes'],'sha256':candidate['sha256'],'signer_sha256':candidate['signer_sha256'],'host_version':candidate['host_version'],'notes':notes}
 upload='/var/tmp/io-app-update-'+uuid.uuid4().hex+'.apk'
 subprocess.run(['scp','-q','-o','BatchMode=yes','-o','StrictHostKeyChecking=yes',str(apk),HOST+':'+upload],check=True,timeout=900)
 try:
  script='upload='+repr(upload)+'\nmanifest='+repr(manifest)+'\napply='+repr(a.apply)+'\n'+REMOTE
  result=subprocess.run(['ssh','-o','BatchMode=yes','-o','StrictHostKeyChecking=yes',HOST,'sudo -n python3 -'],input=script,text=True,capture_output=True,timeout=90)
  if result.returncode:raise RuntimeError('UPDATE_PUBLISH_FAILED: '+result.stderr[-1800:])
  report=json.loads(result.stdout);Path(a.out).write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n');print(json.dumps(report,ensure_ascii=False))
 finally:subprocess.run(['ssh','-o','BatchMode=yes',HOST,'rm',upload],check=True,timeout=20)
if __name__=='__main__':main()
