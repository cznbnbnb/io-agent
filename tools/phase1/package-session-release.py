"""Package the existing-audio service's session directory/control upgrade only."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess
import zipfile

PROFILE = 'agent-session-directory-v1'
PREFIX = 'rebuild/material-server/'
RUNTIME = tuple(PREFIX + n for n in (
    'store.mjs', 'http.mjs', 'json.mjs', 'validation.mjs', 'cli.mjs', 'traffic.mjs',
    'devices.mjs', 'material-transfer.mjs', 'audio.mjs', 'audio-expiry.mjs', 'agent-sessions.mjs',
    'package.json', 'package-lock.json', '.node-version', 'admin/index.html', 'admin/app.js', 'admin/style.css'))
SCHEMAS = ('event-v1.schema.json', 'event-v1.1.schema.json', 'event-v1.2.schema.json')
SHARED = tuple('docs/contracts/' + n for n in SCHEMAS)
LOCAL = tuple(PREFIX + 'contracts/' + n for n in SCHEMAS)
MARKER = PREFIX + 'release-contracts.json'
FILES = RUNTIME + LOCAL + (MARKER,)
SOURCES = RUNTIME + SHARED
ADDED = {PREFIX + 'agent-sessions.mjs', *LOCAL, MARKER}
UNCHANGED = tuple(n for n in RUNTIME if n not in (PREFIX + 'store.mjs', PREFIX + 'http.mjs', PREFIX + 'validation.mjs', PREFIX + 'agent-sessions.mjs'))
PHASES = ('seed', 'upgrade', 'rollback', 'expiry', 'resume')
TOOLS = ('package-session-release.py', 'deploy-session-release.py', 'rehearse-session-release.mjs', 'remote-server-release.py')


def sha(data):
    return hashlib.sha256(data).hexdigest()


def payloads(source):
    result = {n: source[n] for n in RUNTIME}
    for source_name, target in zip(SHARED, LOCAL):
        result[target] = source[source_name]
    result[MARKER] = (json.dumps({'schema': 1, 'files': {n: sha(source['docs/contracts/' + n]) for n in SCHEMAS}}, sort_keys=True, separators=(',', ':')) + '\n').encode()
    return result


def inspect_bundle(file):
    if file.is_symlink() or not file.is_file() or file.stat().st_size > 8388608:
        raise ValueError('ARCHIVE_TYPE_OR_SIZE')
    with zipfile.ZipFile(file) as z:
        if len(z.namelist()) != len(FILES) + 1 or set(z.namelist()) != set(FILES) | {'manifest.json'}:
            raise ValueError('ARCHIVE_SCOPE')
        if any(i.is_dir() or i.file_size > 2097152 or (i.external_attr >> 16) & 0o170000 == 0o120000 for i in z.infolist()) or sum(i.file_size for i in z.infolist()) > 8388608:
            raise ValueError('ARCHIVE_BUDGET')
        m = json.loads(z.read('manifest.json'))
        if m.get('schema') != 1 or m.get('profile') != PROFILE or m.get('node') != 'v22.23.2' or m.get('production_deployed') is not False or \
                any(not re.fullmatch(r'[a-f0-9]{40}', str(m.get(k, ''))) for k in ('source_commit', 'baseline_commit')) or \
                not re.fullmatch(r'[a-f0-9]{64}', str(m.get('rehearsal_sha256', ''))) or set(m.get('files', {})) != set(FILES):
            raise ValueError('MANIFEST_INVALID')
        before = m.get('baseline_sha256', {})
        if set(before) != set(FILES) or any(before[n] is not None if n in ADDED else not re.fullmatch(r'[a-f0-9]{64}', str(before[n])) for n in FILES):
            raise ValueError('BASELINE_INVALID')
        shared = m.get('shared_contract_sha256', {})
        if set(shared) != set(SHARED) or any(not re.fullmatch(r'[a-f0-9]{64}', str(v)) for v in shared.values()):
            raise ValueError('SHARED_BASELINE_INVALID')
        for name in FILES:
            data = z.read(name)
            if m['files'][name] != {'sha256': sha(data), 'bytes': len(data)}:
                raise ValueError('SOURCE_HASH_MISMATCH')
        expected = payloads({**{n: z.read(n) for n in RUNTIME}, **{s: z.read(t) for s, t in zip(SHARED, LOCAL)}})
        if z.read(MARKER) != expected[MARKER]:
            raise ValueError('RELEASE_CONTRACT_MARKER_INVALID')
        if any(m['files'][n]['sha256'] != before[n] for n in UNCHANGED):
            raise ValueError('UNRELATED_RUNTIME_CHANGED')
        if b'./agent-sessions.mjs' not in z.read(PREFIX + 'store.mjs') or b'./release-contracts.json' not in z.read(PREFIX + 'validation.mjs'):
            raise ValueError('SESSION_RUNTIME_INCOMPLETE')
    m['release_id'] = 'sessions-' + m['source_commit'][:12] + '-' + sha(file.read_bytes())[:12]
    return m


def build(root, rehearsal, commit, output):
    if not re.fullmatch(r'[a-f0-9]{40}', commit):
        raise ValueError('EXPLICIT_COMMIT_REQUIRED')
    report = json.loads(rehearsal.read_text())
    if report.get('passed') is not True or report.get('production_changed') is not False or report.get('temporary_data_removed') is not True or report.get('node') != 'v22.23.2' or \
            [(p.get('phase'), p.get('passed')) for p in report.get('phases', [])] != [(p, True) for p in PHASES]:
        raise ValueError('SESSION_REHEARSAL_REQUIRED')
    if sha((root / 'tools/phase1/rehearse-session-release.mjs').read_bytes()) != report.get('rehearsal_sha256'):
        raise ValueError('REHEARSAL_SOURCE_CHANGED')
    source = {}
    for name in SOURCES:
        file = root / name
        if file.is_symlink() or not file.is_file() or file.stat().st_size > 2097152:
            raise ValueError('SOURCE_TYPE_OR_SIZE')
        data = file.read_bytes()
        if data != subprocess.check_output(['git', 'show', commit + ':' + name], cwd=root):
            raise ValueError('SOURCE_NOT_COMMITTED')
        source[name] = data
    values = payloads(source)
    if {n: sha(v) for n, v in values.items()} != report.get('sources', {}).get('candidate'):
        raise ValueError('SOURCE_NOT_REHEARSED')
    manifest = {'schema': 1, 'profile': PROFILE, 'node': report['node'], 'source_commit': commit,
                'baseline_commit': report['baseline_commit'], 'production_deployed': False,
                'rehearsal_sha256': sha(rehearsal.read_bytes()), 'baseline_sha256': report['sources']['baseline'],
                'shared_contract_sha256': report['shared_contract_sha256'],
                'files': {n: {'sha256': sha(v), 'bytes': len(v)} for n, v in values.items()}}
    with zipfile.ZipFile(output, 'x', compression=zipfile.ZIP_DEFLATED) as z:
        z.writestr('manifest.json', json.dumps(manifest, indent=2) + '\n')
        for n, data in values.items():
            z.writestr(n, data)
    m = inspect_bundle(output)
    return {'archive': str(output.resolve()), 'sha256': sha(output.read_bytes()), 'release_id': m['release_id'], 'source_files': len(FILES), 'production_deployed': False}


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--rehearsal', type=Path, required=True)
    p.add_argument('--commit', required=True)
    p.add_argument('--out', type=Path, required=True)
    a = p.parse_args()
    print(json.dumps(build(Path(__file__).resolve().parents[2], a.rehearsal, a.commit, a.out)))
