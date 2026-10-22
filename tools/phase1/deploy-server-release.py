"""Fixed iO source package publisher. Default is read-only remote inspection.

--apply is the only mutation entry. Interrupted observation is reported unknown;
it is never retried. Inspect the same durable remote journal first.
"""
import argparse
import contextlib
import importlib.util
import io
import json
from pathlib import Path
import re
import runpy
import shlex
import sys

sys.path.append('C:/Users/LENOVO/AppData/Local/Programs/Python/Python310/Lib/site-packages')
ROOT = Path(__file__).resolve().parents[2]
TOOLS = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('release_package', TOOLS / 'package-server-release.py')
package = importlib.util.module_from_spec(spec)
spec.loader.exec_module(package)


class Quiet(io.StringIO):
    def reconfigure(self, **kwargs):
        pass


def connect():
    with contextlib.redirect_stdout(Quiet()), contextlib.redirect_stderr(Quiet()):
        helper = runpy.run_path('D:/Project/Kimi_Agent_手持娱乐值网站/app/.deploy/ssh.py', run_name='io_full_release')
        profiles = [p for p in helper['PROFILES'].values() if p.get('host') == '43.142.59.131']
        if len(profiles) != 1:
            raise ValueError('WRONG_HOST')
        helper['connect'].__globals__['P'] = profiles[0]
        return helper['connect']()


def reviewed(archive):
    if archive.is_symlink() or not archive.resolve().is_relative_to(ROOT / 'rebuild/phase1/artifacts'):
        raise ValueError('ARCHIVE_PATH_INVALID')
    manifest = package.inspect(archive)
    release_id = manifest['release_id']
    baseline = json.loads((ROOT / ('rebuild/phase1/' + release_id + '-preflight.json')).read_text(encoding='utf-8'))
    rehearsal = json.loads((ROOT / ('rebuild/phase1/' + release_id + '-rehearsal.json')).read_text(encoding='utf-8'))
    digest = package.sha(archive.read_bytes())
    if baseline.get('status') != 'preflight_passed' or rehearsal.get('status') != 'passed' or \
       baseline.get('release_id') != release_id or rehearsal.get('release_id') != release_id or \
       any(r.get('archive_sha256') != digest for r in (baseline, rehearsal)) or \
       set(baseline.get('before_sha256', {})) != set(package.FILES):
        raise ValueError('REVIEW_EVIDENCE_MISMATCH')
    if manifest['verified_tests'] >= 47:
        required = {'upgrade_closes_preexisting_expired_question', 'expiry_preserves_original_question_envelope',
                    'upgrade_withdraws_question_after_parent_cancel', 'accepted_answer_survives_parent_cancel',
                    'rollback_keeps_question_and_closure_expire', 'rollback_keeps_question_and_closure_withdraw',
                    'rollback_keeps_preexisting_accepted_answer', 'rollback_rejects_answer_to_closed_question'}
        if rehearsal.get('scenario') != 'request-lifecycle' or rehearsal.get('production_changed') is not False or \
           rehearsal.get('rehearsal_source_sha256') != package.sha((TOOLS / 'rehearse-server-release.mjs').read_bytes()) or \
           not required.issubset(set(rehearsal.get('checks', []))):
            raise ValueError('LIFECYCLE_REHEARSAL_NOT_VERIFIED')
    # The archive cannot borrow green checks from changed local runtime files.
    verification, payloads = package.sources(ROOT)
    if any(package.sha(data) != manifest['files'][name]['sha256'] for name, data in payloads.items()):
        raise ValueError('LOCAL_VERIFIED_SOURCE_DIFFERS_FROM_PACKAGE')
    return {'release_id': release_id, 'archive_sha256': digest, 'before_sha256': baseline['before_sha256']}


def execute(connection, metadata, archive=None):
    source = (TOOLS / 'remote-server-release.py').read_text(encoding='utf-8')
    script = 'import json,sys\n'
    if archive is not None:
        packaging = (TOOLS / 'package-server-release.py').read_text(encoding='utf-8')
        script += '_package={"__name__":"io_source_package"}\nexec(' + repr(packaging) + ',_package)\n'
    script += '_remote={"__name__":"io_remote_release"}\nexec(' + repr(source) + ',_remote)\n'
    script += '_metadata=json.loads(' + repr(json.dumps(metadata)) + ')\n'
    if archive is not None:
        script += '_result=_remote["run_remote"](_metadata,sys.stdin.buffer.read(8388609),_package)\n'
    else:
        script += '_result=_remote["inspect_remote"](_metadata)\n'
    script += 'print(json.dumps(_result))\n'
    stdin, stdout, stderr = connection.exec_command('sudo -n /usr/bin/python3 -c ' + shlex.quote(script), timeout=120)
    if archive is not None:
        stdin.write(archive.read_bytes())
        stdin.flush()
    stdin.channel.shutdown_write()
    output = stdout.read(65537)
    stderr.read(4096)  # Diagnostics never expose helper credentials/content.
    if stdout.channel.recv_exit_status() or len(output) > 65536:
        raise ValueError('REMOTE_RESULT_NOT_CONFIRMED')
    result = json.loads(output.decode('utf-8'))
    if result.get('release_id') != metadata['release_id']:
        raise ValueError('REMOTE_RESULT_BINDING_MISMATCH')
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--archive', required=True)
    modes = parser.add_mutually_exclusive_group()
    modes.add_argument('--apply', action='store_true')
    modes.add_argument('--inspect', action='store_true')
    args = parser.parse_args()
    archive = Path(args.archive).resolve()
    metadata = reviewed(archive)
    report = {'schema': 1, 'mode': 'apply' if args.apply else 'inspect', **metadata,
              'status': 'not_confirmed', 'credentials_minted': False,
              'scope': 'isolated iO code directory, source archive, deployment journal and service restart only; no site/nginx/credential/database restore'}
    report['publisher_source_sha256'] = {name: package.sha((TOOLS / name).read_bytes()) for name in
                                        ('package-server-release.py', 'remote-server-release.py', 'deploy-server-release.py')}
    connection = None
    try:
        connection = connect()
        result = execute(connection, metadata, archive if args.apply else None)
        report['remote'] = result
        report['status'] = result.get('phase', result.get('status', 'not_confirmed'))
    except Exception as error:
        code = str(error)
        report['error'] = code if re.fullmatch(r'[A-Z_]{3,90}', code) else type(error).__name__
        report['status'] = 'outcome_unknown' if args.apply else 'inspect_unavailable'
        # Observe the same journal on a new connection. No second apply/stop/
        # rollback is sent merely because the first SSH observation failed.
        if args.apply:
            if connection:
                connection.close()
                connection = None
            try:
                connection = connect()
                report['inspection_after_error'] = execute(connection, metadata)
            except Exception:
                report['inspection_after_error'] = {'status': 'unavailable'}
    finally:
        if connection:
            connection.close()
    suffix = '-deploy.json' if args.apply else '-deployment-inspection.json'
    path = ROOT / ('rebuild/phase1/' + metadata['release_id'] + suffix)
    path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'mode': report['mode'], 'status': report['status'], 'release_id': metadata['release_id'], 'error': report.get('error')}))
    return 0 if report['status'] in ('deployed', 'not_recorded') else 1


if __name__ == '__main__':
    raise SystemExit(main())
