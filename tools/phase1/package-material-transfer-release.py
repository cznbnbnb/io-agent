"""Prepare a reviewed source bundle only. Never connects to or deploys a service.

The historical release controllers do not accept this profile. Activation must
separately compare the live baseline, take a database backup and verify health.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess
import zipfile

RUNTIME = tuple('rebuild/material-server/' + name for name in (
    'store.mjs', 'http.mjs', 'json.mjs', 'validation.mjs', 'cli.mjs', 'traffic.mjs',
    'devices.mjs', 'material-transfer.mjs', 'package.json', 'package-lock.json',
    '.node-version', 'admin/index.html', 'admin/app.js', 'admin/style.css'))
FILES = RUNTIME + tuple('docs/contracts/' + name for name in (
    'event-v1.schema.json', 'event-v1.1.schema.json', 'event-v1.2.schema.json'))


def sha(value):
    return hashlib.sha256(value).hexdigest()


def build(root, report_path, commit, output):
    if not re.fullmatch(r'[a-f0-9]{40}', commit):
        raise ValueError('EXPLICIT_COMMIT_REQUIRED')
    report = json.loads(report_path.read_text())
    if report.get('passed') is not True or report.get('production_changed') is not False or \
            not report.get('temporary_data_removed') or not re.fullmatch(r'v22\.\d+\.\d+', report.get('node', '')):
        raise ValueError('REHEARSAL_REQUIRED')
    if [(p.get('phase'), p.get('passed')) for p in report.get('phases', [])] != \
            [(phase, True) for phase in ('seed', 'upgrade', 'rollback', 'resume')]:
        raise ValueError('ALL_REHEARSAL_PHASES_REQUIRED')
    script = root / 'tools/phase1/rehearse-material-transfer-release.mjs'
    if sha(script.read_bytes()) != report.get('rehearsal_sha256'):
        raise ValueError('REHEARSAL_SOURCE_CHANGED')
    expected = report['sources']['candidate']
    if set(expected) != set(FILES):
        raise ValueError('RUNTIME_MANIFEST_INCOMPLETE')
    payloads = {}
    for name in FILES:
        file = root / name
        if file.is_symlink() or not file.is_file() or file.stat().st_size > 2097152:
            raise ValueError('SOURCE_TYPE_OR_SIZE_INVALID')
        data = file.read_bytes()
        committed = subprocess.check_output(['git', 'show', commit + ':' + name], cwd=root)
        if data.replace(b'\r\n', b'\n') != committed.replace(b'\r\n', b'\n') or sha(data) != expected[name]:
            raise ValueError('SOURCE_NOT_COMMITTED_OR_REHEARSED')
        payloads[name] = data
    manifest = {'schema': 1, 'profile': 'material-transfer-v1-source-review',
                'production_deployed': False, 'activation_verified': False,
                'source_commit': commit, 'node': report['node'],
                'baseline_sha256': report['sources']['baseline'],
                'rehearsal_sha256': sha(report_path.read_bytes()),
                'files': {name: {'sha256': sha(data), 'bytes': len(data)} for name, data in payloads.items()}}
    with zipfile.ZipFile(output, 'x', compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr('manifest.json', json.dumps(manifest, indent=2) + '\n')
        for name, data in payloads.items():
            archive.writestr(name, data)
    with zipfile.ZipFile(output) as archive:
        if len(archive.namelist()) != len(FILES) + 1 or set(archive.namelist()) != set(FILES) | {'manifest.json'}:
            raise ValueError('ARCHIVE_SCOPE_INVALID')
        for name, data in payloads.items():
            if archive.read(name) != data:
                raise ValueError('ARCHIVE_READBACK_FAILED')
    return {'archive': str(output.resolve()), 'sha256': sha(output.read_bytes()),
            'source_files': len(payloads), 'source_commit': commit,
            'production_deployed': False, 'activation_verified': False}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--rehearsal', type=Path, required=True)
    parser.add_argument('--commit', required=True)
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args()
    print(json.dumps(build(Path(__file__).resolve().parents[2], args.rehearsal, args.commit, args.out)))
