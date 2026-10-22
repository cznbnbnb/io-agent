"""Guarded single-file deployment of reviewed iO queue fixes, with rollback.

Uses existing private SSH helper without exposing its credentials. Only the
isolated turboio-material service and its store.mjs are changed, no site/schema.
Default is read-only preflight; --apply replaces the expected old source only.
"""
import argparse
import contextlib
import hashlib
import io
import json
from pathlib import Path
import re
import runpy
import shlex
import stat
import sys
import time
import traceback
import uuid
from datetime import datetime, timezone

# The machine's .pth is broken; do not execute it or change the installation.
sys.path.append('C:/Users/LENOVO/AppData/Local/Programs/Python/Python310/Lib/site-packages')

p = argparse.ArgumentParser()
p.add_argument('--apply', action='store_true')
args = p.parse_args()
root = Path(__file__).resolve().parents[2]
directory = '/opt/turboio/rebuild/material-server'
target = directory + '/store.mjs'
service = 'turboio-material.service'
result = {'at': datetime.now(timezone.utc).isoformat(), 'mode': 'apply' if args.apply else 'preflight',
          'scope': 'only reviewed store.mjs and isolated iO service restart; no database rows, credentials, nginx or existing site changes',
          'status': 'failed', 'checks': {}, 'applied': False}
connection = sftp = None
swapped = False
replacement_attempted = False
old_bytes = None
baseline = {}
local = {}

class QuietStream(io.StringIO):
    def reconfigure(self, **_kwargs):
        pass

def sha(data):
    return hashlib.sha256(data).hexdigest()

def run(command):
    _stdin, stdout, stderr = connection.exec_command(command, timeout=20)
    data = stdout.read(65536).decode('utf-8', 'replace').strip()
    stderr.read(4096)  # Private remote diagnostics never enter reports.
    code = stdout.channel.recv_exit_status()
    if code:
        raise RuntimeError('REMOTE_COMMAND_FAILED')
    return data

def read_code(name):
    path = directory + '/' + name
    attributes = sftp.lstat(path)
    if not stat.S_ISREG(attributes.st_mode) or attributes.st_size > 1048576:
        raise RuntimeError('REMOTE_SOURCE_UNEXPECTED')
    with sftp.open(path, 'rb') as stream:
        return stream.read(1048577)

def source_hashes():
    return {name: sha(read_code(name)) for name in baseline}

def health():
    state = run('systemctl is-active turboio-material.service')
    payload = json.loads(run('curl --silent --fail --max-time 5 http://127.0.0.1:3401/health'))
    tls = run("curl --silent --max-time 5 --resolve cznbnb.cn:443:127.0.0.1 -o /dev/null -w '%{http_code}' https://cznbnb.cn/io-api/v1/identity")
    if state != 'active' or payload.get('service') != 'turboio-materials' or tls != '401':
        raise RuntimeError('HEALTH_CHECK_FAILED')
    return {'service_state': state, 'health_service': payload['service'], 'tls_unauthenticated_status': tls}

def upload(path, data, attributes=None):
    # The existing deployment account can read this root-owned directory but
    # cannot SFTP-write it. Elevate only this fixed-path upload, without chmod
    # of the directory or exposing source/payload in argv or diagnostic logs.
    if not path.startswith(directory + '/.store-') or len(data) > 1048576:
        raise RuntimeError('UPLOAD_SCOPE_MISMATCH')
    mode = stat.S_IMODE(attributes.st_mode) if attributes else 0o600
    uid = attributes.st_uid if attributes else 0
    gid = attributes.st_gid if attributes else 0
    script = '''import hashlib,os,sys
path,mode,uid,gid,expected = %r,%r,%r,%r,%r
payload=sys.stdin.buffer.read(1048577)
assert len(payload)<=1048576 and hashlib.sha256(payload).hexdigest()==expected
fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
with os.fdopen(fd,'wb') as stream:
 stream.write(payload)
 stream.flush()
 os.fchown(stream.fileno(),uid,gid)
 os.fchmod(stream.fileno(),mode)
 os.fsync(stream.fileno())
with open(path,'rb') as stream: assert hashlib.sha256(stream.read()).hexdigest()==expected
fd=os.open(os.path.dirname(path),os.O_RDONLY)
try: os.fsync(fd)
finally: os.close(fd)
print('UPLOAD_VERIFIED')
''' % (path, mode, uid, gid, sha(data))
    stdin, stdout, stderr = connection.exec_command('sudo -n /usr/bin/python3 -c ' + shlex.quote(script), timeout=20)
    stdin.write(data)
    stdin.flush()
    stdin.channel.shutdown_write()
    confirmation = stdout.read(1024).decode('utf-8', 'replace').strip()
    stderr.read(4096)
    if stdout.channel.recv_exit_status() or confirmation != 'UPLOAD_VERIFIED':
        raise RuntimeError('UPLOAD_HASH_MISMATCH')

def replace_expected(stage, expected_current, expected_next):
    # Final compare immediately before atomic replacement. Paths are fixed
    # deployment paths/our UUID stage, never user-supplied shell fragments.
    script = '''import hashlib,os,stat
target,stage,current,next_hash = %r,%r,%r,%r
info=os.lstat(target)
assert stat.S_ISREG(info.st_mode) and info.st_nlink==1
with open(target,'rb') as f: assert hashlib.sha256(f.read()).hexdigest()==current
with open(stage,'rb') as f: assert hashlib.sha256(f.read()).hexdigest()==next_hash
os.chown(stage,info.st_uid,info.st_gid)
os.chmod(stage,stat.S_IMODE(info.st_mode))
with open(stage,'rb') as f: os.fsync(f.fileno())
os.replace(stage,target)
fd=os.open(os.path.dirname(target),os.O_RDONLY)
try: os.fsync(fd)
finally: os.close(fd)
print('PATCH_SWAPPED')
''' % (target, stage, expected_current, expected_next)
    if run('sudo -n /usr/bin/python3 -c ' + shlex.quote(script)) != 'PATCH_SWAPPED':
        raise RuntimeError('SWAP_NOT_CONFIRMED')

try:
    verification = json.loads((root / 'rebuild/material-server/verification/result.json').read_text(encoding='utf-8'))
    if verification.get('status') != 'passed' or verification.get('failed') != 0 or verification.get('tests', 0) < 31:
        raise RuntimeError('LOCAL_VERIFICATION_MISSING')
    audit = json.loads((root / 'rebuild/phase1/server-review-ssh-2026-10-12.json').read_text(encoding='utf-8'))
    for line in audit['checks']['service_code_sha256']['result'].splitlines():
        digest, path = line.split(None, 1)
        if not re.fullmatch('[0-9a-f]{64}', digest) or not path.strip().startswith(directory + '/'):
            raise RuntimeError('BASELINE_INVALID')
        baseline[Path(path.strip()).name] = digest
    if set(baseline) != {'store.mjs', 'http.mjs', 'json.mjs', 'cli.mjs', 'validation.mjs'}:
        raise RuntimeError('BASELINE_INVALID')
    for name in baseline:
        local[name] = sha((root / 'rebuild/material-server' / name).read_bytes())
        if local[name] != verification['source_sha256'].get(name):
            raise RuntimeError('LOCAL_SOURCE_NOT_VERIFIED')
        if name != 'store.mjs' and local[name] != baseline[name]:
            raise RuntimeError('DEPLOY_SCOPE_MISMATCH')
    result['local_source_sha256'] = local
    result['checks']['local_verified_tests'] = verification['tests']
    with contextlib.redirect_stdout(QuietStream()), contextlib.redirect_stderr(QuietStream()):
        helper = runpy.run_path('D:/Project/Kimi_Agent_手持娱乐值网站/app/.deploy/ssh.py', run_name='turboio_guarded_store_release')
    profiles = [profile for profile in helper['PROFILES'].values() if profile.get('host') == '43.142.59.131']
    if len(profiles) != 1:
        raise RuntimeError('WRONG_HOST')
    helper['connect'].__globals__['P'] = profiles[0]
    with contextlib.redirect_stdout(QuietStream()), contextlib.redirect_stderr(QuietStream()):
        connection = helper['connect']()
    sftp = connection.open_sftp()
    observed = source_hashes()
    result['before_source_sha256'] = observed
    result['checks']['before_health'] = health()
    result['checks']['deployment_permissions'] = run("id -u; stat -c '%u:%g %a' /opt/turboio/rebuild/material-server; if sudo -n true 2>/dev/null; then echo SUDO_NONINTERACTIVE_AVAILABLE; else echo SUDO_NONINTERACTIVE_UNAVAILABLE; fi")
    if observed == local:
        result['status'] = 'already_current'
    elif observed != baseline:
        raise RuntimeError('REMOTE_SOURCE_CHANGED')
    else:
        result['checks']['expected_baseline_matches'] = True
        if not args.apply:
            result['status'] = 'preflight_passed'
        else:
            attributes = sftp.lstat(target)
            old_bytes = read_code('store.mjs')
            release_id = uuid.uuid4().hex
            backup = directory + '/.store-backup-' + release_id + '.mjs'
            stage = directory + '/.store-stage-' + release_id + '.mjs'
            upload(backup, old_bytes, attributes)
            upload(stage, (root / 'rebuild/material-server/store.mjs').read_bytes(), attributes)
            result['backup_source'] = backup
            run('/opt/turboio/node22/bin/node --check ' + shlex.quote(stage))
            result['checks']['staged_syntax'] = True
            replacement_attempted = True
            result['apply_state'] = 'replacement_attempted'
            replace_expected(stage, baseline['store.mjs'], local['store.mjs'])
            swapped = result['applied'] = True
            result['apply_state'] = 'swap_confirmed'
            run('sudo -n systemctl restart turboio-material.service')
            final_health = None
            for attempt in range(8):
                try:
                    final_health = health()
                    break
                except Exception:
                    if attempt == 7:
                        raise
                    time.sleep(.5)
            result['checks']['after_health'] = final_health
            result['after_source_sha256'] = source_hashes()
            if result['after_source_sha256'] != local:
                raise RuntimeError('POST_DEPLOY_HASH_MISMATCH')
            result['status'] = 'deployed'
except Exception as error:
    result['error_location'] = [{'function': frame.name, 'line': frame.lineno} for frame in traceback.extract_tb(error.__traceback__) if frame.filename == __file__]
    code = str(error)
    result['error'] = code if re.fullmatch('[A-Z_]{3,64}', code) else type(error).__name__
    if replacement_attempted and not swapped:
        # SSH acknowledgement can be lost after rename. Inspect before claiming
        # nothing changed or attempting a rollback over an unknown generation.
        try:
            current_hash = sha(read_code('store.mjs'))
            if current_hash == local['store.mjs']:
                swapped = result['applied'] = True
                result['apply_state'] = 'swap_confirmed_after_error'
            elif current_hash == baseline['store.mjs']:
                result['apply_state'] = 'old_source_confirmed'
            else:
                result['applied'] = None
                result['apply_state'] = 'source_conflict'
        except Exception:
            result['applied'] = None
            result['apply_state'] = 'unknown'
    if swapped and old_bytes is not None:
        try:
            # Refuse to roll back over another writer's subsequent edit.
            rollback_stage = directory + '/.store-rollback-' + uuid.uuid4().hex + '.mjs'
            upload(rollback_stage, old_bytes, sftp.lstat(target))
            replace_expected(rollback_stage, local['store.mjs'], baseline['store.mjs'])
            run('sudo -n systemctl restart turboio-material.service')
            result['rollback'] = {'status': 'restored', 'health': health()}
            result['status'] = 'rolled_back'
        except Exception as rollback_error:
            result['rollback'] = {'status': 'not_confirmed', 'error_type': type(rollback_error).__name__}
finally:
    if sftp is not None:
        sftp.close()
    if connection is not None:
        connection.close()
output = root / ('rebuild/phase1/server-store-deploy-2026-10-12.json' if args.apply else 'rebuild/phase1/server-store-preflight-2026-10-12.json')
output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(json.dumps({key: result[key] for key in ['mode', 'status', 'applied']} | {'error': result.get('error')}))
raise SystemExit(0 if result['status'] in {'preflight_passed', 'already_current', 'deployed'} else 1)
