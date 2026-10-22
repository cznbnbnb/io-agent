"""Fetch official model bytes through the authorized server, never its secrets.

Only an owned /tmp directory is written remotely; no service/site changes.
"""
import contextlib
import io
import json
import runpy
import shlex
import sys
from pathlib import Path
import hashlib
sys.path.append('C:/Users/LENOVO/AppData/Local/Programs/Python/Python310/Lib/site-packages')
class Quiet(io.StringIO):
    def reconfigure(self, **_kwargs):
        pass
root=Path(__file__).resolve().parents[2]
cache=root/'rebuild/phase1/model-cache/zipformer-small-ctc-zh-2025-04-01'
cache.mkdir(parents=True,exist_ok=True)
connection=None
remote=None
report={'source':'model author official Hugging Face repository','server_service_changed':False}
try:
    with contextlib.redirect_stdout(Quiet()),contextlib.redirect_stderr(Quiet()):
        helper=runpy.run_path('D:/Project/Kimi_Agent_手持娱乐值网站/app/.deploy/ssh.py',run_name='turboio_model_download')
        profiles=[p for p in helper['PROFILES'].values() if p.get('host')=='43.142.59.131']
        if len(profiles)!=1:raise ValueError('wrong server')
        helper['connect'].__globals__['P']=profiles[0]
        connection=helper['connect']()
    script="""import tempfile,json,subprocess,hashlib,pathlib
d=pathlib.Path(tempfile.mkdtemp(prefix='turboio-model-'))
print(json.dumps({'directory':str(d)}),flush=True)
base='https://huggingface.co/csukuangfj/sherpa-onnx-streaming-zipformer-small-ctc-zh-int8-2025-04-01/resolve/main/'
for name in ['model.int8.onnx','tokens.txt']:
 r=subprocess.run(['curl','--silent','--show-error','--fail','--location','--connect-timeout','15','--max-time','120',base+name,'-o',str(d/name)],capture_output=True)
 if r.returncode:print(json.dumps({'failed':name,'exit':r.returncode}),flush=True);break
 print(json.dumps({'name':name,'bytes':(d/name).stat().st_size,'sha256':hashlib.sha256((d/name).read_bytes()).hexdigest()}),flush=True)
"""
    _stdin,stdout,stderr=connection.exec_command('python3 -u -c '+shlex.quote(script),timeout=150)
    header=json.loads(stdout.readline());remote=header['directory']
    if not remote.startswith('/tmp/turboio-model-') or '/' in remote[len('/tmp/'):]:raise ValueError('unexpected temporary directory')
    entries=[]
    for line in stdout:
        value=json.loads(line)
        if 'failed' in value:
            report['download_failure']=value
            raise ValueError('upstream download failed')
        entries.append(value)
    stderr.read(2048)
    if stdout.channel.recv_exit_status()!=0 or len(entries)!=2:raise ValueError('incomplete model retrieval')
    if entries[0]['sha256']!='68c9c943840f7d9cf3e8a4970ba50f404feb5277f611fa82b7e72267786fa84a':raise ValueError('model differs from author published SHA256')
    with connection.open_sftp() as sftp:
        for item in entries:
            target=cache/item['name']
            if target.exists():raise ValueError('refusing overwrite of cached model')
            sftp.get(remote+'/'+item['name'],str(target))
            if hashlib.sha256(target.read_bytes()).hexdigest()!=item['sha256']:raise ValueError('download bytes changed')
    report['files']=entries
    report['verified']=True
except Exception as error:
    report['verified']=False;report['error_type']=type(error).__name__
    note=str(error)
    if note in ['upstream download failed','incomplete model retrieval','model differs from author published SHA256','download bytes changed','refusing overwrite of cached model','wrong server','unexpected temporary directory']:report['error_code']=note
finally:
    if connection and remote and remote.startswith('/tmp/turboio-model-') and '/' not in remote[len('/tmp/'):]:
        try:
            with connection.open_sftp() as sftp:
                for name in ['model.int8.onnx','tokens.txt']:
                    try:sftp.remove(remote+'/'+name)
                    except IOError:pass
                sftp.rmdir(remote)
            report['owned_remote_cache_removed']=True
        except Exception:report['owned_remote_cache_removed']=False
    if connection:connection.close()
from datetime import datetime,timezone
stamp=datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
(cache/('retrieval-'+stamp+'.json')).write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
print(json.dumps(report))
sys.exit(0 if report.get('verified') else 1)
