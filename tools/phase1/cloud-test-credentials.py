"""Explicit one-hour synthetic-owner credentials for this PC's cloud verifier.

No public registration endpoint or automatic reissue. Secrets travel through
captured SSH stdout to ACL-protected local files, never argv/logs/reports.
"""
import argparse
from datetime import datetime, timezone
import importlib.util
import json
from pathlib import Path
import re
import sys
from urllib.error import HTTPError
from urllib.request import build_opener, HTTPSHandler, HTTPRedirectHandler, ProxyHandler, Request

ROOT = Path(__file__).resolve().parents[2]
TOOLS = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / 'rebuild/agent-bridge/hermes'))
from enroll_home import protect_directory, write_new

spec = importlib.util.spec_from_file_location('io_publisher', TOOLS / 'deploy-server-release.py')
publisher = importlib.util.module_from_spec(spec)
spec.loader.exec_module(publisher)

ROLES = {
    'phone': ['tasks:write', 'tasks:read', 'tasks:update', 'requests:read', 'answers:write', 'messages:receive'],
    'agent': ['tasks:read', 'tasks:update', 'requests:write', 'messages:receive', 'messages:write', 'receipts:agent'],
    'operations': ['operations:read'],
}


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        raise ValueError('CLOUD_CREDENTIAL_REDIRECT_REFUSED')


def verify_revocation(directory):
    opener = build_opener(ProxyHandler({}), HTTPSHandler(), NoRedirect())
    statuses = {}
    for role in ROLES:
        file = directory / (role + '.json')
        if not file.exists():
            continue  # A partial issue may never have transferred this secret.
        credential = json.loads(file.read_text(encoding='utf-8'))
        token = credential.get('token', '')
        if not re.fullmatch(r'[A-Za-z0-9_-]{43}', token):
            raise ValueError('CLOUD_CREDENTIAL_INVALID')
        request = Request('https://cznbnb.cn/io-api/v1/identity', headers={'Authorization': 'Bearer ' + token})
        try:
            with opener.open(request, timeout=10) as response:
                statuses[role] = response.status
        except HTTPError as error:
            statuses[role] = error.code
            error.close()
        if statuses[role] != 401:
            raise ValueError('CLOUD_CREDENTIAL_REVOCATION_NOT_ENFORCED')
    return statuses


def remote(connection, action, run_id, ttl_ms=3600000):
    parameters = {'action': action, 'run_id': run_id, 'roles': ROLES, 'ttl_ms': ttl_ms}
    script = '''import json,os,pathlib,sqlite3,subprocess
p=PARAMETERS
root=pathlib.Path('/var/lib/turboio-material/cloud-tests')/p['run_id']
owner='synthetic-cloud-'+p['run_id']
node='/opt/turboio/node22/bin/node'
cli='/opt/turboio/rebuild/material-server/cli.mjs'
db='/var/lib/turboio-material/materials.sqlite'
def run(args):
 result=subprocess.run(args,stdin=subprocess.DEVNULL,capture_output=True,timeout=15)
 if result.returncode or len(result.stdout)>16384: raise RuntimeError('CLOUD_CREDENTIAL_COMMAND_FAILED')
 return json.loads(result.stdout)
if p['action']=='issue':
 root.parent.mkdir(mode=0o700,exist_ok=True)
 root.mkdir(mode=0o700,exist_ok=False)
 output={}
 for role,scopes in p['roles'].items():
  target=root/(role+'.json')
  run([node,cli,'mint','--db',db,'--owner',owner,'--producer','cloud-'+role,'--scopes',','.join(scopes),'--ttl-ms',str(p['ttl_ms']),'--out',str(target)])
  output[role]=json.loads(target.read_text())
 with sqlite3.connect('file:'+db+'?mode=ro',uri=True) as connection:
  server_id=connection.execute("SELECT value FROM meta WHERE key='server_id'").fetchone()[0]
 print(json.dumps({'owner_id':owner,'server_id':server_id,'credentials':output}))
else:
 revoked=[]
 for role in p['roles']:
  with sqlite3.connect('file:'+db+'?mode=ro',uri=True) as connection:
   rows=connection.execute('SELECT token_id FROM credentials WHERE owner=? AND producer=? AND revoked=0',(owner,'cloud-'+role)).fetchall()
  # Also covers a partial issue whose SSH response or output file was lost.
  # This exclusive run owner is synthetic; never sweep the user's owner.
  for (token_id,) in rows:
   result=run([node,cli,'revoke','--db',db,'--token-id',token_id])
   if result.get('revoked') is not True: raise RuntimeError('CLOUD_CREDENTIAL_REVOKE_FAILED')
  revoked.append(role)
 with sqlite3.connect('file:'+db+'?mode=ro',uri=True) as connection:
  if connection.execute('SELECT count(*) FROM credentials WHERE owner=? AND revoked=0',(owner,)).fetchone()[0]: raise RuntimeError('CLOUD_CREDENTIAL_REVOKE_INCOMPLETE')
 print(json.dumps({'owner_id':owner,'revoked_roles':revoked}))
'''.replace('PARAMETERS', repr(parameters))
    stdin, stdout, stderr = connection.exec_command('sudo -n /usr/bin/python3 -', timeout=60)
    stdin.write(script)
    stdin.flush()
    stdin.channel.shutdown_write()
    value = stdout.read(16385)
    stderr.read(4096)  # Never expose command stderr or credential text.
    if stdout.channel.recv_exit_status() or len(value) > 16384:
        raise ValueError('CLOUD_CREDENTIAL_OPERATION_NOT_CONFIRMED')
    return json.loads(value.decode('utf-8'))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('action', choices=['issue', 'revoke'])
    parser.add_argument('--run-id', required=True)
    parser.add_argument('--ttl-ms', type=int, choices=[900000, 3600000], default=3600000)
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    if not args.apply or not re.fullmatch(r'[a-z0-9][a-z0-9-]{0,47}', args.run_id):
        raise ValueError('EXPLICIT_SYNTHETIC_CREDENTIAL_OPERATION_REQUIRED')
    directory = ROOT / ('rebuild/agent-bridge/private/cloud-' + args.run_id)
    if args.action == 'issue':
        directory.mkdir(parents=True, exist_ok=False)
        protect_directory(directory)
    connection = None
    report = {'at': datetime.now(timezone.utc).isoformat(), 'action': args.action, 'run_id': args.run_id,
              'status': 'not_confirmed', 'ttl_ms': args.ttl_ms, 'recipient': 'local PC synthetic cloud verifier',
              'roles': ROLES, 'user_owner_data_touched': False}
    try:
        connection = publisher.connect()
        result = remote(connection, args.action, args.run_id, args.ttl_ms)
        if result.get('owner_id') != 'synthetic-cloud-' + args.run_id:
            raise ValueError('CLOUD_CREDENTIAL_BINDING_MISMATCH')
        if args.action == 'issue':
            credentials = result['credentials']
            if set(credentials) != set(ROLES):
                raise ValueError('CLOUD_CREDENTIAL_ROLES_MISMATCH')
            bundle = {'schema_version': '1.0', 'purpose': 'synthetic-cloud-verification', 'run_id': args.run_id}
            for role, credential in credentials.items():
                if not re.fullmatch(r'[A-Za-z0-9_-]{43}', credential.get('token', '')):
                    raise ValueError('CLOUD_CREDENTIAL_INVALID')
                file = directory / (role + '.json')
                write_new(file, credential)
                bundle[role] = {'schema_version': '1.0', 'base_url': 'https://cznbnb.cn/io-api/v1/',
                    'owner_id': result['owner_id'], 'producer_id': 'cloud-' + role,
                    'server_id': result['server_id'], 'credential_file': str(file), 'timeout_ms': 10000}
            if 'agent' in bundle:
                bundle['agent'].update(computer_id='io-cloud-test-computer', agent_id='io-cloud-test-hermes')
            write_new(directory / 'bundle.json', bundle)
            report['credentials'] = {role: {key: value[key] for key in ['token_id', 'expires_at']} for role, value in credentials.items()}
            report['status'] = 'issued'
        else:
            if set(result.get('revoked_roles', [])) != set(ROLES):
                raise ValueError('CLOUD_CREDENTIAL_REVOKE_INCOMPLETE')
            report['remote_revoked'] = True
            report['revoked_roles'] = result['revoked_roles']
            report['public_identity_status'] = verify_revocation(directory)
            report['status'] = 'revoked'
    except Exception as error:
        code = str(error)
        report['error'] = code if re.fullmatch(r'[A-Z_]{3,90}', code) else type(error).__name__
    finally:
        if connection:
            connection.close()
    (ROOT / ('rebuild/phase1/cloud-' + args.run_id + '-credentials-' + args.action + '.json')).write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({key: report[key] for key in ['status', 'action', 'run_id']}))
    return 0 if report['status'] in {'issued', 'revoked'} else 1


if __name__ == '__main__':
    raise SystemExit(main())
