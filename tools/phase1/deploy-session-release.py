"""Inspect by default; prepare an existing-audio directory/control release.

Runtime and release-local schemas switch together. Shared schemas, the audio
database and independent expiry unit stay unchanged. Once any extended task
revision exists, automatic rollback to the legacy server is forbidden: preserve
the new code/data and use a compatible recovery release or a forward fix. Never
delete task history or restore a database to make that guard pass.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re
import shlex
import sqlite3
import stat
import subprocess

ROOT = Path(__file__).resolve().parents[2]
TOOLS = Path(__file__).resolve().parent
TARGET = 'ubuntu@43.142.59.131'


def load(name):
    values = {'__name__': 'session_release_module', '__file__': str(TOOLS / name)}
    exec((TOOLS / name).read_text(), values)
    return values


def sha(data):
    return hashlib.sha256(data).hexdigest()


def rollback_guard(db_file):
    # History, not just heads: an old phone can start from an earlier cursor.
    p = Path(db_file)
    if p.is_symlink() or not p.is_file():
        raise ValueError('ROLLBACK_DATABASE_INVALID')
    with sqlite3.connect('file:' + str(p) + '?mode=ro', uri=True) as db:
        count = db.execute("""SELECT COUNT(*) FROM queue_revisions WHERE kind='task' AND (
            state IN ('stop_requested','stop_unconfirmed','stopped','resume_requested') OR
            json_type(body,'$.execution') IS NOT NULL OR json_type(body,'$.control') IS NOT NULL)""").fetchone()[0]
    if count:
        raise ValueError('SESSION_DATA_PREVENTS_LEGACY_ROLLBACK')
    return {'legacy_rollback_allowed': True, 'extended_task_revisions': 0}


def existing_audio(controller, support, metadata):
    """Read metadata and pinned expiry assets only; never starts the cleaner."""
    db_file = Path(controller['DB'])
    if db_file.is_symlink() or not db_file.is_file():
        raise ValueError('TEXT_DATABASE_INVALID')
    with sqlite3.connect('file:' + str(db_file) + '?mode=ro', uri=True) as db:
        if db.execute('PRAGMA user_version').fetchone()[0] != 2:
            raise ValueError('TEXT_DATABASE_VERSION')
        sid = db.execute("SELECT value FROM meta WHERE key='server_id'").fetchone()[0]
    sid_hash = sha(sid.encode())
    if metadata.get('server_id_sha256') not in (None, sid_hash):
        raise ValueError('SERVER_BINDING_CHANGED')
    audio = Path(str(db_file) + '.audio.sqlite')
    if audio.is_symlink() or not audio.is_file() or not stat.S_ISREG(audio.lstat().st_mode):
        raise ValueError('EXISTING_AUDIO_DATABASE_REQUIRED')
    with sqlite3.connect('file:' + str(audio) + '?mode=ro', uri=True) as db:
        if db.execute('PRAGMA application_id').fetchone()[0] != 0x694f4175 or db.execute('PRAGMA user_version').fetchone()[0] != 1 or \
                db.execute('SELECT server_id FROM binding').fetchall() != [(sid,)]:
            raise ValueError('AUDIO_DATABASE_BINDING')
    digest = metadata['before_sha256']['rebuild/material-server/audio-expiry.mjs']
    module = controller['BASE'] / 'audio-expiry-v1' / digest / 'audio-expiry.mjs'
    if sha(controller['regular_bytes'](module)) != digest:
        raise ValueError('EXPIRY_MODULE_CHANGED')
    expected = support['units'](controller['NODE'], module, controller['DB'], sid)
    for name, data in expected.items():
        if controller['regular_bytes'](support['UNIT_ROOT'] / name) != data:
            raise ValueError('EXPIRY_UNIT_CHANGED')
    support['verify_timer'](controller)
    controller['verify_contracts'](controller['BASE'], tuple(metadata['shared_contract_sha256']), metadata['shared_contract_sha256'])
    return {'server_id_sha256': sid_hash, 'text_inode': db_file.stat().st_ino, 'audio_inode': audio.stat().st_ino,
            'expiry_module_sha256': digest, 'expiry_timer_healthy': True, 'shared_contracts_unchanged': True}


def remote_preflight(controller, support, metadata):
    current = controller['BASE'] / 'rebuild/material-server'
    if controller['source_hashes'](current, tuple(metadata['before_sha256'])) != metadata['before_sha256']:
        raise ValueError('LIVE_BASELINE_CHANGED')
    if controller['run']([controller['NODE'], '--version']) != 'v22.23.2' or controller['run'](['systemctl', 'is-active', controller['SERVICE']]) != 'active':
        raise ValueError('RUNTIME_NOT_EXPECTED')
    args = controller['run'](['systemctl', 'show', controller['SERVICE'], '--property=ExecStart', '--value'])
    match = re.search(r'argv\[\]=(.*?)\s*;', args)
    if not match or match[1].strip() != controller['EXPECTED_START']:
        raise ValueError('SERVICE_COMMAND_CHANGED')
    audio = existing_audio(controller, support, metadata)
    try:
        recovery = rollback_guard(controller['DB'])
    except ValueError as e:
        if str(e) != 'SESSION_DATA_PREVENTS_LEGACY_ROLLBACK':
            raise
        recovery = {'legacy_rollback_allowed': False, 'reason': str(e)}
    if controller['source_hashes'](current, tuple(metadata['before_sha256'])) != metadata['before_sha256']:
        raise ValueError('LIVE_BASELINE_CHANGED')
    return {'status': 'preflight_passed', 'node': 'v22.23.2', 'production_changed': False,
            'baseline_commit': metadata['baseline_commit'], 'before_sha256': metadata['before_sha256'],
            'shared_contract_sha256': metadata['shared_contract_sha256'], **audio, **recovery}


def remote_apply(controller, package, support, backup, metadata, data):
    if len(data) > 8388608 or sha(data) != metadata['archive_sha256']:
        raise ValueError('ARCHIVE_HASH_MISMATCH')
    paths = controller['locations'](metadata['release_id'])
    if any(paths[n].exists() or paths[n].is_symlink() for n in ('journal', 'archive', 'stage', 'backup', 'rejected')):
        raise ValueError('RELEASE_EXISTS_INSPECT_FIRST')
    checked = remote_preflight(controller, support, metadata)
    if not checked['legacy_rollback_allowed']:
        raise ValueError('COMPATIBLE_RECOVERY_RELEASE_REQUIRED')
    # Existing audio is never backed up or copied. The old database remains the
    # live database through both code versions; this backup is not auto-restored.
    saved = backup['backup_text'](controller, metadata)
    profile = {'FILES': package['FILES'], 'CONTRACTS': (), 'LOCAL_CONTRACTS': package['LOCAL'],
               'inspect': package['inspect_bundle'], 'RELEASE_PROFILE': package['PROFILE'],
               'existing_audio_health': lambda: existing_audio(controller, support, metadata),
               'rollback_guard': lambda: rollback_guard(controller['DB'])}
    result = controller['run_remote'](metadata, data, profile)
    result['text_database_backup'] = saved
    return result


def execute(metadata, action, data=b''):
    script = 'import sys,json\n'
    for variable, name in (('_wrapper', 'deploy-session-release.py'), ('_controller', 'remote-server-release.py'),
                           ('_package', 'package-session-release.py'), ('_support', 'audio-release-support.py'), ('_backup', 'deploy-audio-release.py')):
        script += variable + '={"__name__":"session_remote","__file__":' + repr('/opt/turboio/tools/phase1/' + name) + '}\nexec(' + repr((TOOLS / name).read_text()) + ',' + variable + ')\n'
    script += '_metadata=json.loads(' + repr(json.dumps(metadata)) + ')\n'
    if action == 'apply':
        script += '_result=_wrapper["remote_apply"](_controller,_package,_support,_backup,_metadata,sys.stdin.buffer.read(8388609))\n'
    elif action == 'preflight':
        script += '_result=_wrapper["remote_preflight"](_controller,_support,_metadata)\n'
    else:
        script += '_result=_controller["inspect_remote"](_metadata)\n_result["existing_audio"]=_wrapper["existing_audio"](_controller,_support,_metadata)\n'
    script += 'print(json.dumps(_result))\n'
    r = subprocess.run(['ssh', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=10', TARGET,
                        'sudo -n /usr/bin/python3 -c ' + shlex.quote(script)], input=data, capture_output=True, timeout=180)
    if r.returncode or len(r.stdout) > 65536:
        raise ValueError('REMOTE_OUTCOME_UNCONFIRMED')
    result = json.loads(r.stdout)
    if action != 'preflight' and result.get('release_id') != metadata['release_id']:
        raise ValueError('REMOTE_RESULT_MISMATCH')
    return result


def baseline_metadata(root, commit, package):
    if not re.fullmatch(r'[a-f0-9]{40}', commit):
        raise ValueError('EXPLICIT_BASELINE_COMMIT_REQUIRED')
    source = lambda n: subprocess.check_output(['git', 'show', commit + ':' + n], cwd=root)
    return {'baseline_commit': commit, 'before_sha256': {n: None if n in package['ADDED'] else sha(source(n)) for n in package['FILES']},
            'shared_contract_sha256': {n: sha(source(n)) for n in package['SHARED']}}


def reviewed(archive, rehearsal, preflight):
    package = load('package-session-release.py')
    m = package['inspect_bundle'](archive)
    r, p = json.loads(rehearsal.read_text()), json.loads(preflight.read_text())
    if sha(rehearsal.read_bytes()) != m['rehearsal_sha256'] or r.get('passed') is not True or r.get('production_changed') is not False or r.get('temporary_data_removed') is not True or \
            r.get('node') != 'v22.23.2' or [(v.get('phase'), v.get('passed')) for v in r.get('phases', [])] != [(v, True) for v in package['PHASES']] or \
            sha((TOOLS / 'rehearse-session-release.mjs').read_bytes()) != r.get('rehearsal_sha256'):
        raise ValueError('SESSION_REHEARSAL_NOT_BOUND')
    if p.get('status') != 'preflight_passed' or p.get('production_changed') is not False or p.get('legacy_rollback_allowed') is not True or \
            p.get('before_sha256') != m['baseline_sha256'] or p.get('shared_contract_sha256') != m['shared_contract_sha256'] or \
            p.get('baseline_commit') != m['baseline_commit'] or \
            not re.fullmatch(r'[a-f0-9]{64}', str(p.get('server_id_sha256', ''))):
        raise ValueError('SESSION_PREFLIGHT_REQUIRED')
    expected = package['payloads']({n: (ROOT / n).read_bytes() for n in package['SOURCES']})
    hashes = {n: sha(v) for n, v in expected.items()}
    if hashes != r.get('sources', {}).get('candidate') or hashes != {n: m['files'][n]['sha256'] for n in package['FILES']} or \
            m['baseline_sha256'] != r.get('sources', {}).get('baseline') or m['shared_contract_sha256'] != r.get('shared_contract_sha256'):
        raise ValueError('SOURCE_NOT_REHEARSED')
    baseline = baseline_metadata(ROOT, m['baseline_commit'], package)
    if baseline['before_sha256'] != m['baseline_sha256'] or baseline['shared_contract_sha256'] != m['shared_contract_sha256']:
        raise ValueError('BASELINE_NOT_COMMITTED')
    for n in package['SOURCES'] + tuple('tools/phase1/' + n for n in package['TOOLS'] + ('audio-release-support.py', 'deploy-audio-release.py')):
        if (ROOT / n).read_bytes() != subprocess.check_output(['git', 'show', m['source_commit'] + ':' + n], cwd=ROOT):
            raise ValueError('SOURCE_NOT_COMMITTED')
    return {'release_id': m['release_id'], 'archive_sha256': sha(archive.read_bytes()), 'source_git_commit': m['source_commit'],
            'baseline_commit': m['baseline_commit'], 'before_sha256': m['baseline_sha256'],
            'shared_contract_sha256': m['shared_contract_sha256'], 'server_id_sha256': p['server_id_sha256']}


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--inspect-baseline', action='store_true')
    p.add_argument('--baseline-commit')
    p.add_argument('--archive', type=Path)
    p.add_argument('--rehearsal', type=Path)
    p.add_argument('--preflight', type=Path)
    p.add_argument('--apply', action='store_true')
    p.add_argument('--out', type=Path, required=True)
    a = p.parse_args()
    if a.inspect_baseline:
        if a.apply or a.archive or not a.baseline_commit:
            p.error('baseline inspection requires only an explicit baseline commit and output')
        report = execute(baseline_metadata(ROOT, a.baseline_commit, load('package-session-release.py')), 'preflight')
    else:
        if not all((a.archive, a.rehearsal, a.preflight)):
            p.error('archive, rehearsal and preflight reports are required')
        metadata = reviewed(a.archive, a.rehearsal, a.preflight)
        report = {'apply_requested': a.apply, **metadata}
        try:
            report['remote'] = execute(metadata, 'apply' if a.apply else 'inspect', a.archive.read_bytes() if a.apply else b'')
        except Exception:
            report['status'] = 'outcome_unknown' if a.apply else 'inspection_failed'
            if a.apply:
                try:
                    report['inspection'] = execute(metadata, 'inspect')
                except Exception:
                    report['inspection'] = {'status': 'unavailable'}
    a.out.write_text(json.dumps(report, indent=2) + '\n')
    status = report.get('status', report.get('remote', {}).get('phase', report.get('remote', {}).get('status')))
    print(json.dumps({'report': str(a.out.resolve()), 'status': status}))
    raise SystemExit(0 if status in ('preflight_passed', 'deployed', 'not_recorded') else 1)
