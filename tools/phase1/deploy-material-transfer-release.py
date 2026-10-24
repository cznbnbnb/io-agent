"""Activate the reviewed R4 bundle with the existing code-switch controller.

Default is inspection. --apply takes an on-server SQLite backup before switching
code; it never restores data or issues credentials. Unknown outcomes are inspected
under the same release ID, never retried with a new ID.
"""
import argparse
import contextlib
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import shlex
import sqlite3
import subprocess
import sys
import zipfile

ROOT = Path(__file__).resolve().parents[2]
TOOLS = Path(__file__).resolve().parent
FILES = tuple('rebuild/material-server/' + n for n in (
    'store.mjs', 'http.mjs', 'json.mjs', 'validation.mjs', 'cli.mjs', 'traffic.mjs',
    'devices.mjs', 'material-transfer.mjs', 'package.json', 'package-lock.json',
    '.node-version', 'admin/index.html', 'admin/app.js', 'admin/style.css')) + tuple(
    'docs/contracts/' + n for n in ('event-v1.schema.json', 'event-v1.1.schema.json', 'event-v1.2.schema.json'))
CONTRACTS = tuple(n for n in FILES if n.startswith('docs/'))


def sha(data):
    return hashlib.sha256(data).hexdigest()


def inspect_bundle(path):
    if path.is_symlink() or not path.is_file() or path.stat().st_size > 8388608:
        raise ValueError('ARCHIVE_TYPE_OR_SIZE')
    with zipfile.ZipFile(path) as archive:
        if len(archive.namelist()) != len(FILES) + 1 or set(archive.namelist()) != set(FILES) | {'manifest.json'}:
            raise ValueError('ARCHIVE_SCOPE')
        if any(i.file_size > 2097152 for i in archive.infolist()) or sum(i.file_size for i in archive.infolist()) > 8388608:
            raise ValueError('ARCHIVE_BUDGET')
        m = json.loads(archive.read('manifest.json'))
        if m.get('profile') != 'material-transfer-v1-source-review' or m.get('schema') != 1 or \
                m.get('node') != 'v22.23.2' or m.get('production_deployed') is not False or \
                m.get('activation_verified') is not False or not re.fullmatch(r'[a-f0-9]{40}', m.get('source_commit', '')) or set(m.get('files', {})) != set(FILES):
            raise ValueError('MANIFEST_INVALID')
        expected_old = set(FILES) - {'rebuild/material-server/material-transfer.mjs'}
        if set(m.get('baseline_sha256', {})) != expected_old or any(not re.fullmatch(r'[a-f0-9]{64}', h) for h in m['baseline_sha256'].values()):
            raise ValueError('BASELINE_INVALID')
        for name in FILES:
            data = archive.read(name)
            if m['files'][name] != {'sha256': sha(data), 'bytes': len(data)}:
                raise ValueError('SOURCE_HASH_MISMATCH')
        if b"./audio.mjs" in archive.read('rebuild/material-server/store.mjs'):
            raise ValueError('AUDIO_RELEASE_PROFILE_REQUIRED')
    m['release_id'] = 'r4-transfer-' + m['source_commit'][:12] + '-' + sha(path.read_bytes())[:12]
    return m


def reviewed(archive):
    m = inspect_bundle(archive)
    proof = json.loads((ROOT / 'rebuild/android-app/r4-server-release-preparation-2026-10-24.json').read_text())
    if proof.get('passed') is not True or proof.get('production_changed') is not False or \
            proof.get('bundle', {}).get('sha256') != sha(archive.read_bytes()) or \
            proof.get('rehearsal_sha256') != sha((TOOLS / 'rehearse-material-transfer-release.mjs').read_bytes()) or \
            not proof.get('temporary_data_removed') or \
            [(p.get('phase'), p.get('passed')) for p in proof.get('phases', [])] != [(p, True) for p in ('seed', 'upgrade', 'rollback', 'resume')]:
        raise ValueError('REHEARSAL_NOT_BOUND')
    with zipfile.ZipFile(archive) as z:
        for name in FILES:
            data = z.read(name)
            if sha((ROOT / name).read_bytes()) != sha(data):
                raise ValueError('CURRENT_SOURCE_DIFFERS')
            committed = subprocess.check_output(['git', 'show', m['source_commit'] + ':' + name], cwd=ROOT)
            if committed.replace(b'\r\n', b'\n') != data.replace(b'\r\n', b'\n'):
                raise ValueError('SOURCE_NOT_COMMITTED')
    before = dict(m['baseline_sha256'])
    before['rebuild/material-server/material-transfer.mjs'] = None
    return {'release_id': m['release_id'], 'archive_sha256': sha(archive.read_bytes()),
            'source_git_commit': m['source_commit'], 'before_sha256': before}


def backup_database(db_path, destination):
    if db_path.is_symlink() or not db_path.is_file() or destination.exists() or destination.is_symlink():
        raise ValueError('BACKUP_PATH_INVALID')
    fd = os.open(destination, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    os.close(fd)
    with contextlib.closing(sqlite3.connect('file:' + str(db_path) + '?mode=ro', uri=True)) as source, \
            contextlib.closing(sqlite3.connect(destination)) as target:
        source.backup(target)
        if target.execute('PRAGMA quick_check').fetchall() != [('ok',)]:
            raise ValueError('BACKUP_INTEGRITY_FAILED')
    with destination.open('rb') as stream:
        os.fsync(stream.fileno())
    fd = os.open(destination.parent, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)
    return {'path': str(destination), 'bytes': destination.stat().st_size, 'quick_check': 'ok', 'restored': False}


def remote_apply(controller, metadata, data):
    if len(data) > 8388608 or sha(data) != metadata['archive_sha256']:
        raise ValueError('ARCHIVE_HASH_MISMATCH')
    paths = controller['locations'](metadata['release_id'])
    if any(paths[k].exists() for k in ('journal', 'archive', 'stage', 'backup', 'rejected')):
        raise ValueError('RELEASE_EXISTS_INSPECT_FIRST')
    names = [n for n in FILES if n.startswith('rebuild/material-server/')]
    if controller['source_hashes'](paths['current'], names) != {n: metadata['before_sha256'][n] for n in names}:
        raise ValueError('LIVE_BASELINE_CHANGED')
    controller['verify_contracts'](controller['BASE'], CONTRACTS, metadata['before_sha256'])
    backup = backup_database(Path(controller['DB']), Path(controller['DB']).parent / (metadata['release_id'] + '-before.sqlite'))
    result = controller['run_remote'](metadata, data, {'FILES': FILES, 'CONTRACTS': CONTRACTS, 'inspect': inspect_bundle})
    result['database_backup'] = backup
    return result


def execute(metadata, archive, apply):
    source = Path(__file__).read_text()
    controller = (TOOLS / 'remote-server-release.py').read_text()
    script = 'import sys,json\n'
    script += '_wrapper={"__name__":"r4_remote", "__file__":"/opt/turboio/tools/phase1/deploy-material-transfer-release.py"}\nexec(' + repr(source) + ',_wrapper)\n'
    script += '_controller={"__name__":"r4_switch"}\nexec(' + repr(controller) + ',_controller)\n'
    script += '_metadata=json.loads(' + repr(json.dumps(metadata)) + ')\n'
    script += '_result=' + ('_wrapper["remote_apply"](_controller,_metadata,sys.stdin.buffer.read(8388609))' if apply else '_controller["inspect_remote"](_metadata)') + '\nprint(json.dumps(_result))\n'
    r = subprocess.run(['ssh', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=10',
                        'ubuntu@43.142.59.131', 'sudo -n /usr/bin/python3 -c ' + shlex.quote(script)],
                       input=archive.read_bytes() if apply else b'', capture_output=True, timeout=180)
    if r.returncode or len(r.stdout) > 65536:
        raise ValueError('REMOTE_OUTCOME_UNCONFIRMED')
    result = json.loads(r.stdout)
    if result.get('release_id') != metadata['release_id']:
        raise ValueError('REMOTE_RESULT_MISMATCH')
    return result


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--archive', type=Path, required=True)
    p.add_argument('--apply', action='store_true')
    args = p.parse_args()
    metadata = reviewed(args.archive)
    report = dict(metadata, applied_requested=args.apply, credentials_minted=False, database_restored=False)
    try:
        report['remote'] = execute(metadata, args.archive, args.apply)
        report['status'] = report['remote'].get('phase', report['remote'].get('status'))
    except Exception as error:
        report['status'] = 'outcome_unknown' if args.apply else 'inspection_failed'
        report['error'] = str(error) if re.fullmatch(r'[A-Z_]{3,90}', str(error)) else type(error).__name__
        if args.apply:
            try:
                report['inspection'] = execute(metadata, args.archive, False)
            except Exception:
                report['inspection'] = {'status': 'unavailable'}
    path = ROOT / 'rebuild/android-app/build' / ('r4-server-activation.json' if args.apply else 'r4-server-inspection.json')
    path.write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({'status': report['status'], 'release_id': metadata['release_id'], 'report': str(path)}))
    return 0 if report['status'] in ('deployed', 'not_recorded') else 1


if __name__ == '__main__':
    raise SystemExit(main())
