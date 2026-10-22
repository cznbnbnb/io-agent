"""Close one expired synthetic check, then revoke all credentials for its run owner."""
import importlib.util
import json
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('native_credentials', ROOT / 'tools/android/native-card-test-credentials.py')
native = importlib.util.module_from_spec(spec)
spec.loader.exec_module(native)
issuer = native.module

def main():
    if len(sys.argv) != 3 or sys.argv[2] != '--apply' or not re.fullmatch(r'native205-20261020-[a-z]', sys.argv[1]):
        raise ValueError('EXPLICIT_SYNTHETIC_RUN_REQUIRED')
    run_id = sys.argv[1]
    directory = ROOT / ('rebuild/agent-bridge/private/cloud-' + run_id)
    plan = json.loads((directory / 'native-card-plan.json').read_text(encoding='utf-8'))
    if plan['run_id'] != run_id or not re.fullmatch(r'task-native-[0-9a-f-]{36}', plan['task_id']) or not re.fullmatch(r'request-native-[0-9a-f-]{36}', plan['request_id']):
        raise ValueError('SYNTHETIC_PLAN_MISMATCH')
    parameters = {key: plan[key] for key in ['run_id', 'task_id', 'request_id']}
    script = r'''import json,pathlib,sqlite3,subprocess
p=PARAMETERS
owner='synthetic-cloud-'+p['run_id']
node='/opt/turboio/node22/bin/node'
cli='/opt/turboio/rebuild/material-server/cli.mjs'
db='/var/lib/turboio-material/materials.sqlite'
root=pathlib.Path('/var/lib/turboio-material/cloud-tests')/p['run_id']
if not root.is_dir(): raise RuntimeError('ORIGINAL_SYNTHETIC_RUN_REQUIRED')
target=root/'cleanup-phone.json'
if target.exists(): raise RuntimeError('CLEANUP_ALREADY_ATTEMPTED')
def run(args):
 r=subprocess.run(args,stdin=subprocess.DEVNULL,capture_output=True,timeout=40)
 if r.returncode or len(r.stdout)>16384: raise RuntimeError('BOUNDED_CLEANUP_FAILED')
 return json.loads(r.stdout)
result={}
try:
 run([node,cli,'mint','--db',db,'--owner',owner,'--producer','cloud-phone','--scopes','tasks:read,tasks:update,requests:read,requests:write','--ttl-ms','900000','--out',str(target)])
 js=r"""const fs=require('node:fs'),crypto=require('node:crypto');
 const p=JSON.parse(process.argv[1]),credential=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
 async function api(method,path,body){const r=await fetch('https://cznbnb.cn/io-api/v1/'+path,{method,redirect:'error',signal:AbortSignal.timeout(10000),headers:{Authorization:'Bearer '+credential.token,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});const text=await r.text();if(text.length>1048576||!r.ok)throw Error('CLEANUP_API_'+r.status);return JSON.parse(text);}
 (async()=>{const identity=await api('GET','identity');if(identity.owner_id!=='synthetic-cloud-'+p.run_id||identity.producer_id!=='cloud-phone')throw Error('CLEANUP_IDENTITY_MISMATCH');
 let request=await api('GET','requests/'+p.request_id);if(request.object_id!==p.request_id||request.body.task_id!==p.task_id)throw Error('CLEANUP_REQUEST_MISMATCH');
 if(['pending','presented'].includes(request.state)){const v=await api('POST','requests/'+p.request_id+'/reconcile',{schema_version:'1.0',request_revision:request.revision});request=v.item;}
 if(!['expired','withdrawn','answered'].includes(request.state))throw Error('REQUEST_NOT_TERMINAL');
 let task=await api('GET','tasks/'+p.task_id);if(task.object_id!==p.task_id)throw Error('CLEANUP_TASK_MISMATCH');
 for(const state of ['cancel_requested','cancelled']){if(task.state==='cancelled')break;if(task.state===state)continue;const now=Date.now(),body={...task.body,revision:task.revision+1,state};await api('POST','tasks',{schema_version:'1.0',event_id:crypto.randomUUID(),idempotency_key:crypto.randomUUID(),producer_id:'cloud-phone',kind:'task',created_at:new Date(now).toISOString(),expires_at:new Date(now+300000).toISOString(),body});task=await api('GET','tasks/'+p.task_id);}
 if(task.state!=='cancelled')throw Error('TASK_NOT_TERMINAL');console.log(JSON.stringify({task_closed:true,request_state:request.state,real_agent_started:false}));})().catch(()=>{process.exitCode=1});"""
 result=run([node,'-e',js,json.dumps(p),str(target)])
finally:
 with sqlite3.connect('file:'+db+'?mode=ro',uri=True) as connection:
  tokens=connection.execute('SELECT token_id FROM credentials WHERE owner=? AND revoked=0',(owner,)).fetchall()
 for (token_id,) in tokens:
  if run([node,cli,'revoke','--db',db,'--token-id',token_id]).get('revoked') is not True: raise RuntimeError('REVOKE_FAILED')
 with sqlite3.connect('file:'+db+'?mode=ro',uri=True) as connection:
  if connection.execute('SELECT count(*) FROM credentials WHERE owner=? AND revoked=0',(owner,)).fetchone()[0]: raise RuntimeError('REVOKE_INCOMPLETE')
 result['all_run_credentials_revoked']=True
print(json.dumps(result))
'''.replace('PARAMETERS', repr(parameters))
    connection = issuer.publisher.connect()
    try:
        stdin, stdout, stderr = connection.exec_command('sudo -n /usr/bin/python3 -', timeout=60)
        stdin.write(script)
        stdin.flush()
        stdin.channel.shutdown_write()
        output = stdout.read(16385)
        stderr.read(4096)
        if stdout.channel.recv_exit_status() or len(output) > 16384:
            raise ValueError('SYNTHETIC_CLEANUP_NOT_CONFIRMED')
        report = json.loads(output)
        report['original_credentials_identity_status'] = issuer.verify_revocation(directory)
        report['run_id'] = run_id
        (ROOT / ('rebuild/phase1/cloud-' + run_id + '-expired-cleanup.json')).write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
        print(json.dumps(report))
    finally:
        connection.close()
    return 0

if __name__ == '__main__':
    raise SystemExit(main())
