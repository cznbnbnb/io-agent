"""Read-only production comparison for a verified iO source-only package."""
import argparse
import contextlib
from datetime import datetime, timezone
import io
import json
from pathlib import Path
import runpy
import stat
import sys
import urllib.request

sys.path.append('C:/Users/LENOVO/AppData/Local/Programs/Python/Python310/Lib/site-packages')
sys.path.insert(0, str(Path(__file__).resolve().parent))
from importlib import import_module
release = import_module('package-speaker-server-release')


class Quiet(io.StringIO):
    def reconfigure(self, **kwargs):
        pass


def preflight(root, archive):
    package = release.inspect(archive)
    result = {'schema': 1, 'at': datetime.now(timezone.utc).isoformat(), 'mode': 'read_only_preflight',
              'release_id': package['release_id'], 'archive_sha256': release.sha(archive.read_bytes()),
              'status': 'failed', 'applied': False, 'credentials_minted': False,
              'scope': 'known source hashes, service/HTTPS health, disk and runtime only; no user records read'}
    conn = sftp = None
    try:
        with contextlib.redirect_stdout(Quiet()), contextlib.redirect_stderr(Quiet()):
            helper = runpy.run_path('D:/Project/Kimi_Agent_手持娱乐值网站/app/.deploy/ssh.py', run_name='io_release_readonly')
            profiles = [p for p in helper['PROFILES'].values() if p.get('host') == '43.142.59.131']
            if len(profiles) != 1:
                raise ValueError('WRONG_HOST')
            helper['connect'].__globals__['P'] = profiles[0]
            conn = helper['connect']()
        sftp = conn.open_sftp()

        def run(command):
            stdin, stdout, stderr = conn.exec_command(command, timeout=15)
            out = stdout.read(16384).decode('utf-8', 'replace').strip()
            stderr.read(4096)
            if stdout.channel.recv_exit_status():
                raise ValueError('REMOTE_CHECK_FAILED')
            return out

        def snapshot():
            values = {}
            for name in release.FILES:
                path = '/opt/turboio/' + name
                try:
                    info = sftp.lstat(path)
                except OSError as error:
                    if error.errno == 2:
                        values[name] = None
                        continue
                    raise
                if not stat.S_ISREG(info.st_mode) or info.st_size > 1048576:
                    raise ValueError('REMOTE_SOURCE_TYPE_OR_SIZE_INVALID')
                with sftp.open(path, 'rb') as stream:
                    data = stream.read(1048577)
                if len(data) > 1048576:
                    raise ValueError('REMOTE_SOURCE_TYPE_OR_SIZE_INVALID')
                values[name] = release.sha(data)
            return values

        baseline = snapshot()
        result['before_sha256'] = baseline
        old=json.loads((root/'rebuild/phase1/io-server-20261012-r2-manifest.json').read_text(encoding='utf-8'))
        if old.get('archive_sha256')!='d9da06dd99f08aee9c73b9d0098b912771209a88e20a8b33c6eb496bb0c3c97b' or any(baseline.get(name)!=info['sha256'] for name,info in old['files'].items()):
            raise ValueError('REMOTE_R2_BASELINE_CHANGED')
        if baseline['docs/contracts/event-v1.2.schema.json'] not in (None,package['files']['docs/contracts/event-v1.2.schema.json']['sha256']):
            raise ValueError('ADDITIVE_SCHEMA_CHANGED')
        changes = [name for name in release.FILES if baseline[name] != package['files'][name]['sha256']]
        result['changed_files'] = changes
        # The staged code keeps the current relative schema/dependency paths.
        # This release must not change shared contracts or npm dependencies.
        unchanged = tuple(name for name in release.FILES if name not in ('rebuild/material-server/store.mjs','rebuild/material-server/validation.mjs','docs/contracts/event-v1.2.schema.json'))
        if any(name in changes for name in unchanged):
            raise ValueError('SHARED_CONTRACT_OR_DEPENDENCY_CHANGED')
        result['service_state'] = run('systemctl is-active turboio-material.service')
        result['node_version'] = run('/opt/turboio/node22/bin/node --version')
        result['unit_exec_start'] = run('systemctl show turboio-material.service --property=ExecStart --value')
        expected = '/opt/turboio/node22/bin/node /opt/turboio/rebuild/material-server/cli.mjs serve --db /var/lib/turboio-material/materials.sqlite --port 3401'
        if expected not in result['unit_exec_start'] or result['node_version'] != 'v' + package['node_version'] or result['service_state'] != 'active':
            raise ValueError('RUNTIME_OR_UNIT_MISMATCH')
        result['local_health'] = json.loads(run('curl --silent --fail --max-time 5 http://127.0.0.1:3401/health'))
        result['local_https_identity_status'] = run("curl --silent --max-time 5 --resolve cznbnb.cn:443:127.0.0.1 -o /dev/null -w '%{http_code}' https://cznbnb.cn/io-api/v1/identity")
        result['free_kib'] = int(run("df -Pk /opt/turboio/rebuild | tail -n 1 | awk '{print $4}'"))
        if result['local_health'].get('service') != 'turboio-materials' or result['local_https_identity_status'] != '401' or result['free_kib'] < 262144:
            raise ValueError('HEALTH_OR_CAPACITY_FAILED')
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        try:
            response = opener.open('https://cznbnb.cn/io-api/v1/identity', timeout=8)
            response.close()
            result['public_https_identity_status'] = response.status
        except urllib.error.HTTPError as error:
            result['public_https_identity_status'] = error.code
            error.close()
        if result['public_https_identity_status'] != 401:
            raise ValueError('PUBLIC_HTTPS_CHECK_FAILED')
        if snapshot() != baseline:
            raise ValueError('REMOTE_SOURCE_CHANGED_DURING_PREFLIGHT')
        result['status'] = 'preflight_passed'
    except Exception as error:
        code = str(error)
        result['error'] = code if code.isascii() and code.replace('_', '').isupper() else type(error).__name__
    finally:
        if sftp:
            sftp.close()
        if conn:
            conn.close()
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--archive', required=True)
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[2]
    archive = Path(args.archive).resolve()
    if not archive.is_relative_to(root / 'rebuild/phase1/artifacts'):
        raise ValueError('ARCHIVE_LOCATION_INVALID')
    result = preflight(root, archive)
    path = root / ('rebuild/phase1/' + result['release_id'] + '-preflight.json')
    path.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({k: result.get(k) for k in ('status', 'changed_files', 'service_state', 'public_https_identity_status', 'applied', 'error')}))
    raise SystemExit(0 if result['status'] == 'preflight_passed' else 1)
