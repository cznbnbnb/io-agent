"""Inspect by default; activate only a committed, rehearsed audio release.

Backs up text only. Never restores databases, copies original audio, changes
permissions or issues credentials. Unknown outcomes use the same release ID.
"""
import argparse
import contextlib
import hashlib
import json
import os
from pathlib import Path
import re
import shlex
import sqlite3
import subprocess
import zipfile

ROOT = Path(__file__).resolve().parents[2]
TOOLS = Path(__file__).resolve().parent


def load(file):
    values = {'__name__': 'audio_release_module', '__file__': str(file)}
    exec(file.read_text(), values)
    return values


def sha(data):
    return hashlib.sha256(data).hexdigest()


def reviewed(archive, rehearsal):
    package = load(TOOLS / 'package-audio-release.py')
    m = package['inspect_bundle'](archive)
    report = json.loads(rehearsal.read_text())
    if sha(rehearsal.read_bytes()) != m['rehearsal_sha256'] or report.get('passed') is not True or \
            report.get('production_changed') is not False or report.get('temporary_data_removed') is not True or \
            [(p.get('phase'), p.get('passed')) for p in report.get('phases', [])] != [(p, True) for p in package['PHASES']] or \
            sha((TOOLS / 'rehearse-audio-release.mjs').read_bytes()) != report.get('rehearsal_sha256'):
        raise ValueError('AUDIO_REHEARSAL_NOT_BOUND')
    with zipfile.ZipFile(archive) as z:
        for name in package['FILES']:
            data = z.read(name)
            if sha((ROOT / name).read_bytes()) != sha(data) or sha(data) != report['sources']['candidate'].get(name):
                raise ValueError('CURRENT_SOURCE_DIFFERS')
            committed = subprocess.check_output(['git', 'show', m['source_commit'] + ':' + name], cwd=ROOT)
            if data.replace(b'\r\n', b'\n') != committed.replace(b'\r\n', b'\n'):
                raise ValueError('SOURCE_NOT_COMMITTED')
    if m['baseline_sha256'] != report['sources']['baseline']:
        raise ValueError('BASELINE_NOT_REHEARSED')
    # The remotely executed publisher and expiry unit policy are reviewed code,
    # too: refuse edits made after the explicit source commit.
    for n in ('deploy-audio-release.py', 'package-audio-release.py', 'audio-release-support.py', 'remote-server-release.py', 'rehearse-audio-release.mjs'):
        actual = (TOOLS / n).read_bytes()
        committed = subprocess.check_output(['git', 'show', m['source_commit'] + ':tools/phase1/' + n], cwd=ROOT)
        if actual.replace(b'\r\n', b'\n') != committed.replace(b'\r\n', b'\n'):
            raise ValueError('PUBLISHER_NOT_COMMITTED')
    preflight = json.loads((ROOT / 'rebuild/android-app/build/audio-release-live-preflight.json').read_text())
    if not re.fullmatch(r'[a-f0-9]{64}', preflight.get('server_id_sha256', '')) or preflight.get('audio_db_exists') is not False:
        raise ValueError('FIRST_AUDIO_PREFLIGHT_REQUIRED')
    return {'release_id': m['release_id'], 'archive_sha256': sha(archive.read_bytes()),
            'source_git_commit': m['source_commit'], 'before_sha256': m['baseline_sha256'],
            'server_id_sha256': preflight['server_id_sha256']}


def backup_text(controller, metadata):
    db = Path(controller['DB'])
    out = db.parent / (metadata['release_id'] + '-before-text.sqlite')
    if db.is_symlink() or not db.is_file() or out.exists() or out.is_symlink():
        raise ValueError('TEXT_BACKUP_PATH')
    fd = os.open(out, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    os.close(fd)
    with contextlib.closing(sqlite3.connect('file:' + str(db) + '?mode=ro', uri=True)) as source, \
            contextlib.closing(sqlite3.connect(out)) as target:
        source.backup(target)
        if target.execute('PRAGMA quick_check').fetchall() != [('ok',)]:
            raise ValueError('TEXT_BACKUP_INTEGRITY')
        if target.execute("SELECT name FROM sqlite_master WHERE name IN ('audio_objects','audio_parts')").fetchall():
            raise ValueError('AUDIO_IN_TEXT_BACKUP')
    with out.open('rb') as stream:
        os.fsync(stream.fileno())
    controller['sync_dir'](out.parent)
    return {'path': str(out), 'bytes': out.stat().st_size, 'quick_check': 'ok',
            'audio_backed_up': False, 'restored': False}


def remote_apply(controller, package, support, metadata, data):
    if len(data) > 8388608 or sha(data) != metadata['archive_sha256']:
        raise ValueError('ARCHIVE_HASH_MISMATCH')
    paths = controller['locations'](metadata['release_id'])
    if any(paths[n].exists() or paths[n].is_symlink() for n in ('journal', 'archive', 'stage', 'backup', 'rejected')):
        raise ValueError('RELEASE_EXISTS_INSPECT_FIRST')
    if Path(controller['DB'] + '.audio.sqlite').exists() or Path(controller['DB'] + '.audio.sqlite').is_symlink():
        raise ValueError('EXISTING_AUDIO_DATABASE_REVIEW_REQUIRED')
    if controller['source_hashes'](paths['current'], package['RUNTIME']) != {
            n: metadata['before_sha256'][n] for n in package['RUNTIME']}:
        raise ValueError('LIVE_BASELINE_CHANGED')
    controller['verify_contracts'](controller['BASE'], package['CONTRACTS'], metadata['before_sha256'])
    support['server_id'](controller, metadata)
    backup = backup_text(controller, metadata)
    profile = {'FILES': package['FILES'], 'CONTRACTS': package['CONTRACTS'],
               'inspect': package['inspect_bundle'], 'RELEASE_PROFILE': package['PROFILE'],
               'prepare_expiry': lambda manifest: support['prepare'](controller, metadata, manifest),
               'audio_health': lambda: support['health'](controller, metadata)}
    result = controller['run_remote'](metadata, data, profile)
    result['text_database_backup'] = backup
    return result


def remote_inspect(controller, support, metadata):
    result = controller['inspect_remote'](metadata)
    result['audio_db_exists'] = Path(controller['DB'] + '.audio.sqlite').exists()
    result['expiry_unit_files'] = {n: (support['UNIT_ROOT'] / n).is_file() for n in (support['SERVICE'], support['TIMER'])}
    if all(result['expiry_unit_files'].values()):
        try:
            support['verify_timer'](controller)
            result['expiry_timer_healthy'] = True
        except Exception:
            result['expiry_timer_healthy'] = False
    return result


def execute(metadata, archive, apply):
    script = 'import sys,json\n'
    for variable, name in (('_wrapper', 'deploy-audio-release.py'), ('_controller', 'remote-server-release.py'),
                           ('_package', 'package-audio-release.py'), ('_support', 'audio-release-support.py')):
        script += variable + '={"__name__":"audio_remote","__file__":' + repr('/opt/turboio/tools/phase1/' + name) + '}\nexec(' + repr((TOOLS / name).read_text()) + ',' + variable + ')\n'
    script += '_metadata=json.loads(' + repr(json.dumps(metadata)) + ')\n'
    script += '_result=' + ('_wrapper["remote_apply"](_controller,_package,_support,_metadata,sys.stdin.buffer.read(8388609))' if apply else '_wrapper["remote_inspect"](_controller,_support,_metadata)') + '\nprint(json.dumps(_result))\n'
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
    p.add_argument('--rehearsal', type=Path, required=True)
    p.add_argument('--apply', action='store_true')
    a = p.parse_args()
    metadata = reviewed(a.archive, a.rehearsal)
    report = dict(metadata, apply_requested=a.apply, credentials_minted=False, audio_uploaded=False, database_restored=False)
    try:
        report['remote'] = execute(metadata, a.archive, a.apply)
        report['status'] = report['remote'].get('phase', report['remote'].get('status'))
    except Exception as error:
        report['status'] = 'outcome_unknown' if a.apply else 'inspection_failed'
        report['error'] = str(error) if re.fullmatch(r'[A-Z_]{3,90}', str(error)) else type(error).__name__
        if a.apply:
            try:
                report['inspection'] = execute(metadata, a.archive, False)
            except Exception:
                report['inspection'] = {'status': 'unavailable'}
    out = ROOT / 'rebuild/android-app/build' / ('audio-release-activation.json' if a.apply else 'audio-release-inspection.json')
    out.write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({'status': report['status'], 'release_id': metadata['release_id'], 'report': str(out)}))
    return 0 if report['status'] in ('deployed', 'not_recorded') else 1


if __name__ == '__main__':
    raise SystemExit(main())
