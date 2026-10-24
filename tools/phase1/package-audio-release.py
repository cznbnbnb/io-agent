"""Build a committed, rehearsed audio source bundle; never access a service."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess
import zipfile

PROFILE = 'material-audio-v1'
RUNTIME = tuple('rebuild/material-server/' + n for n in (
    'store.mjs', 'http.mjs', 'json.mjs', 'validation.mjs', 'cli.mjs', 'traffic.mjs',
    'devices.mjs', 'material-transfer.mjs', 'audio.mjs', 'audio-expiry.mjs',
    'package.json', 'package-lock.json', '.node-version',
    'admin/index.html', 'admin/app.js', 'admin/style.css'))
CONTRACTS = tuple('docs/contracts/' + n for n in (
    'event-v1.schema.json', 'event-v1.1.schema.json', 'event-v1.2.schema.json'))
FILES = RUNTIME + CONTRACTS
ADDED = {'rebuild/material-server/audio.mjs', 'rebuild/material-server/audio-expiry.mjs'}
PHASES = ('seed', 'upgrade', 'rollback', 'expiry', 'resume')


def sha(data):
    return hashlib.sha256(data).hexdigest()


def inspect_bundle(file):
    if file.is_symlink() or not file.is_file() or file.stat().st_size > 8388608:
        raise ValueError('ARCHIVE_TYPE_OR_SIZE')
    with zipfile.ZipFile(file) as z:
        if len(z.namelist()) != len(FILES) + 1 or set(z.namelist()) != set(FILES) | {'manifest.json'}:
            raise ValueError('ARCHIVE_SCOPE')
        if any(i.file_size > 2097152 for i in z.infolist()) or sum(i.file_size for i in z.infolist()) > 8388608:
            raise ValueError('ARCHIVE_BUDGET')
        m = json.loads(z.read('manifest.json'))
        if m.get('schema') != 1 or m.get('profile') != PROFILE or m.get('node') != 'v22.23.2' or \
                m.get('production_deployed') is not False or set(m.get('files', {})) != set(FILES) or \
                not re.fullmatch(r'[a-f0-9]{40}', m.get('source_commit', '')) or \
                not re.fullmatch(r'[a-f0-9]{64}', m.get('rehearsal_sha256', '')):
            raise ValueError('MANIFEST_INVALID')
        old = m.get('baseline_sha256', {})
        if set(old) != set(FILES) or any(old[n] is not None if n in ADDED else
                not re.fullmatch(r'[a-f0-9]{64}', str(old[n])) for n in FILES):
            raise ValueError('BASELINE_INVALID')
        for n in FILES:
            data = z.read(n)
            if m['files'][n] != {'sha256': sha(data), 'bytes': len(data)}:
                raise ValueError('SOURCE_HASH_MISMATCH')
        if b'./audio-expiry.mjs' not in z.read('rebuild/material-server/audio.mjs') or \
                b'./audio.mjs' not in z.read('rebuild/material-server/store.mjs'):
            raise ValueError('AUDIO_RUNTIME_INCOMPLETE')
    m['release_id'] = 'r4-audio-' + m['source_commit'][:12] + '-' + sha(file.read_bytes())[:12]
    return m


def build(root, rehearsal, commit, output):
    if not re.fullmatch(r'[a-f0-9]{40}', commit):
        raise ValueError('EXPLICIT_COMMIT_REQUIRED')
    report = json.loads(rehearsal.read_text())
    if report.get('passed') is not True or report.get('production_changed') is not False or \
            report.get('temporary_data_removed') is not True or report.get('node') != 'v22.23.2' or \
            [(p.get('phase'), p.get('passed')) for p in report.get('phases', [])] != [(p, True) for p in PHASES]:
        raise ValueError('AUDIO_REHEARSAL_REQUIRED')
    if sha((root / 'tools/phase1/rehearse-audio-release.mjs').read_bytes()) != report.get('rehearsal_sha256'):
        raise ValueError('REHEARSAL_SOURCE_CHANGED')
    if set(report['sources']['candidate']) != set(FILES) or set(report['sources']['baseline']) != set(FILES):
        raise ValueError('REHEARSAL_SCOPE')
    payloads = {}
    for n in FILES:
        p = root / n
        if p.is_symlink() or not p.is_file() or p.stat().st_size > 2097152:
            raise ValueError('SOURCE_TYPE_OR_SIZE')
        data = p.read_bytes()
        committed = subprocess.check_output(['git', 'show', commit + ':' + n], cwd=root)
        if data.replace(b'\r\n', b'\n') != committed.replace(b'\r\n', b'\n') or sha(data) != report['sources']['candidate'][n]:
            raise ValueError('SOURCE_NOT_COMMITTED_OR_REHEARSED')
        payloads[n] = data
    manifest = {'schema': 1, 'profile': PROFILE, 'node': report['node'],
                'source_commit': commit, 'production_deployed': False,
                'rehearsal_sha256': sha(rehearsal.read_bytes()),
                'baseline_sha256': report['sources']['baseline'],
                'files': {n: {'sha256': sha(v), 'bytes': len(v)} for n, v in payloads.items()}}
    with zipfile.ZipFile(output, 'x', compression=zipfile.ZIP_DEFLATED) as z:
        z.writestr('manifest.json', json.dumps(manifest, indent=2) + '\n')
        for n, data in payloads.items():
            z.writestr(n, data)
    inspected = inspect_bundle(output)
    return {'archive': str(output.resolve()), 'sha256': sha(output.read_bytes()),
            'source_commit': commit, 'source_files': len(FILES),
            'release_id': inspected['release_id'], 'production_deployed': False}


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--rehearsal', type=Path, required=True)
    p.add_argument('--commit', required=True)
    p.add_argument('--out', type=Path, required=True)
    a = p.parse_args()
    print(json.dumps(build(Path(__file__).resolve().parents[2], a.rehearsal, a.commit, a.out)))
